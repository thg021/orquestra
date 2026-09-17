import { newId } from "@orquestra/core";
import {
  createCheckpointSaver,
  findServiceInstanceById,
  insertRunStep,
  listRunSteps,
  type ServiceRunRow,
  type Tx
} from "@orquestra/db";
import { findAgentDefinition, type AgentGraphFactory } from "@orquestra/catalog";
import { evaluateInstanceActivation } from "../service-instances/lifecycle.service";
import type { GateImpediment } from "@orquestra/core";

export class ServiceInstanceNotFoundError extends Error {
  constructor(serviceInstanceId: string) {
    super(`Instância "${serviceInstanceId}" não encontrada para o run.`);
    this.name = "ServiceInstanceNotFoundError";
  }
}

export class AgentDefinitionNotFoundError extends Error {
  constructor(agentKey: string, agentVersion: string) {
    super(`Definição "${agentKey}@${agentVersion}" não existe no catálogo.`);
    this.name = "AgentDefinitionNotFoundError";
  }
}

/** GRA-03: gate reavaliado falhou — o run falha sem o grafo ter tocado em nada. */
export class ActivationGateFailedError extends Error {
  constructor(public readonly impediments: readonly GateImpediment[]) {
    super("O gate de ativação recusou a execução.");
    this.name = "ActivationGateFailedError";
  }
}

/** Nunca `error.message` cru — pode carregar segredo ou string de conexão do que falhou. */
function sanitizeGraphError(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

/**
 * Executa um grafo já resolvido (fábrica preguiçosa do catálogo, ou — em teste — um
 * grafo minimalista construído na hora) contra o checkpointer da transação. `seq`
 * continua de onde `run_steps` parou: uma reentrega antes de T11 saber retomar de
 * verdade não pode colidir com a unicidade de `(run_id, seq)`.
 *
 * Cada chunk do `stream` em modo `updates` é `{ [nó]: estado-parcial }` — exceto
 * quando o grafo pausa por `interrupt()`, cuja chave é `__interrupt__`. Isso não é um
 * nó que terminou (não gera `RunStep`) nem uma falha (T12 decide o que fazer com a
 * pausa; T10 só precisa não quebrar).
 */
export async function executeGraph(
  tenantId: string,
  run: ServiceRunRow,
  tx: Tx,
  graphFactory: AgentGraphFactory
): Promise<void> {
  const checkpointer = createCheckpointSaver(tenantId, tx);
  const compiled = graphFactory().compile({ checkpointer });
  const config = { configurable: { thread_id: run.id } };

  const existingSteps = await listRunSteps(run.id, tx);
  let seq = existingSteps.length;

  try {
    const stream = await compiled.stream({}, { ...config, streamMode: "updates" });
    for await (const chunk of stream) {
      for (const [node, output] of Object.entries(chunk as Record<string, unknown>)) {
        if (node === "__interrupt__") continue;
        seq += 1;
        await insertRunStep(
          {
            id: newId(),
            tenantId,
            runId: run.id,
            seq,
            kind: "graph_node",
            status: "succeeded",
            detail: { node, output }
          },
          tx
        );
      }
    }
  } catch (error) {
    // O nó que falhou nunca chega a virar checkpoint (só nós completos são gravados
    // pelo `put` do checkpointer) — por isso é o primeiro de `state.next`.
    const state = await compiled.getState(config);
    const failingNode = state.next[0] ?? "unknown";
    seq += 1;
    await insertRunStep(
      {
        id: newId(),
        tenantId,
        runId: run.id,
        seq,
        kind: "graph_node",
        status: "failed",
        detail: { node: failingNode },
        error: sanitizeGraphError(error)
      },
      tx
    );
    throw error;
  }
}

/**
 * O que o worker chama de fato (T10). Reavalia o gate do M1 dentro da mesma
 * transação do run — se uma conexão foi revogada desde a última vez, o run falha
 * aqui, antes do grafo tocar em qualquer coisa (GRA-03, design §Fluxos).
 */
export async function runAgentGraph(tenantId: string, run: ServiceRunRow, tx: Tx): Promise<void> {
  const instance = await findServiceInstanceById(run.serviceInstanceId, tx);
  if (!instance) {
    throw new ServiceInstanceNotFoundError(run.serviceInstanceId);
  }

  const gate = await evaluateInstanceActivation(tenantId, instance, tx);
  if (!gate.ok) {
    throw new ActivationGateFailedError(gate.impediments);
  }

  const agent = findAgentDefinition(instance.agentKey, instance.agentVersion);
  if (!agent) {
    throw new AgentDefinitionNotFoundError(instance.agentKey, instance.agentVersion);
  }

  await executeGraph(tenantId, run, tx, agent.graph);
}
