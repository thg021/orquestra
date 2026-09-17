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
import { INTERRUPT, type Interrupt } from "@langchain/langgraph";
import { evaluateInstanceActivation } from "../service-instances/lifecycle.service";
import type { GateImpediment } from "@orquestra/core";

/**
 * T12: o que `executeGraph`/`runAgentGraph` devolvem no lugar de `void` — quem chama
 * precisa distinguir "terminou" de "pausou pedindo aprovação" (APR-01). `payload` é
 * exatamente o valor passado para `interrupt(valor)` dentro do nó do agente — nunca o
 * estado inteiro do grafo.
 */
export type GraphRunOutcome = { status: "completed" } | { status: "interrupted"; payload: unknown };

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

/** GRA-05: o grafo passou do tempo máximo — o run precisa terminar, não ficar preso. */
export class ExecutionTimeoutError extends Error {
  constructor(public readonly maxDurationMs: number) {
    super(`A execução passou do tempo limite (${maxDurationMs}ms).`);
    this.name = "ExecutionTimeoutError";
  }
}

export interface ExecuteGraphOptions {
  /**
   * Injetável em teste — não dá para esperar minutos reais num assert. O default é de
   * produção: um agente que não termina nesse tempo é considerado preso (GRA-05).
   */
  maxDurationMs?: number;
}

const DEFAULT_MAX_DURATION_MS = 5 * 60_000; // 5 minutos

/** Nunca `error.message` cru — pode carregar segredo ou string de conexão do que falhou. */
function sanitizeGraphError(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

/**
 * Executa um grafo já resolvido (fábrica preguiçosa do catálogo, ou — em teste — um
 * grafo minimalista construído na hora) contra o checkpointer da transação. `seq`
 * continua de onde `run_steps` parou: uma reentrega não pode colidir com a unicidade
 * de `(run_id, seq)`.
 *
 * Cada chunk do `stream` em modo `updates` é `{ [nó]: estado-parcial }` — exceto
 * quando o grafo pausa por `interrupt()`, cuja chave é `__interrupt__` (a constante
 * `INTERRUPT` exportada por `@langchain/langgraph`). Isso não é um nó que terminou
 * (não gera `RunStep`) nem uma falha — é sinalizado no retorno como
 * `{ status: "interrupted", payload }`, e quem decide o que fazer com a pausa (nascer
 * `ApprovalRequest`, mover o run) é o `run-executor` via `approval.service.ts` (T12).
 * Se a lib entregar mais de um interrupt no mesmo chunk (não acontece hoje — o
 * `exercise` só tem um — mas a assinatura da lib permite array), só o primeiro vira o
 * payload do pedido: é o caso razoável sem inventar escopo maior que o necessário.
 *
 * GRA-02: retomar é continuar o `thread_id`, nunca recomeçar. `stream(input, ...)`
 * aceita `InputType | CommandType | null` — passar `{}` (mesmo vazio) é um input de
 * verdade, aplicado a partir do `START`, e reexecutaria os nós já concluídos. Só
 * `null` diz ao LangGraph "continue exatamente de onde o checkpoint parou". Por isso o
 * input depende de já existir checkpoint para este `thread_id` (`getTuple`).
 */
export async function executeGraph(
  tenantId: string,
  run: ServiceRunRow,
  tx: Tx,
  graphFactory: AgentGraphFactory,
  options: ExecuteGraphOptions = {}
): Promise<GraphRunOutcome> {
  const maxDurationMs = options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
  const checkpointer = createCheckpointSaver(tenantId, tx);
  const compiled = graphFactory().compile({ checkpointer });
  const config = { configurable: { thread_id: run.id } };

  const existingSteps = await listRunSteps(run.id, tx);
  let seq = existingSteps.length;

  const existingCheckpoint = await checkpointer.getTuple(config);
  const input = existingCheckpoint ? null : {};

  // GRA-05: teto real de tempo, não decorativo. `signal` é o que aciona o corte
  // cooperativo dentro do LangGraph e de qualquer adapter real que o respeite — mas a
  // decisão de "estourou o tempo" é nossa própria corrida contra o consumo do stream,
  // não a reação (assíncrona, e não determinística no tempo) do LangGraph ao abort.
  // Depender só do `signal` para decidir "quem falhou" é uma corrida: o `getState`
  // pode rodar antes do LangGraph terminar de registrar a tarefa abortada, e `next`
  // vem vazio — o nó certo só é confiável quando ele nunca chegou a ser resolvido do
  // nosso lado.
  const timeoutController = new AbortController();
  let timeoutTimer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutTimer = setTimeout(() => {
      timeoutController.abort();
      reject(new ExecutionTimeoutError(maxDurationMs));
    }, maxDurationMs);
  });
  timeoutPromise.catch(() => {}); // evita unhandledRejection quando o grafo termina antes

  let interrupted: { payload: unknown } | undefined;

  try {
    const stream = await compiled.stream(input, {
      ...config,
      streamMode: "updates",
      signal: timeoutController.signal
    });
    const iterator = stream[Symbol.asyncIterator]();
    for (;;) {
      const nextPromise = iterator.next();
      nextPromise.catch(() => {}); // idem, se o timeout vencer a corrida abaixo
      const result = await Promise.race([nextPromise, timeoutPromise]);
      if (result.done) break;

      for (const [node, output] of Object.entries(result.value as Record<string, unknown>)) {
        if (node === INTERRUPT) {
          const interrupts = output as Interrupt[];
          interrupted = { payload: interrupts[0]?.value };
          continue;
        }
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

    return interrupted ? { status: "interrupted", payload: interrupted.payload } : { status: "completed" };
  } catch (error) {
    // O timeout vira `ExecutionTimeoutError` — nunca o `AbortError` cru da lib, que não
    // diz por que a execução parou (regra do sanitizador: nome da classe, nada mais).
    const effectiveError =
      error instanceof ExecutionTimeoutError
        ? error
        : timeoutController.signal.aborted
          ? new ExecutionTimeoutError(maxDurationMs)
          : error;

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
        error: sanitizeGraphError(effectiveError)
      },
      tx
    );
    throw effectiveError;
  } finally {
    clearTimeout(timeoutTimer!);
  }
}

/**
 * O que o worker chama de fato (T10). Reavalia o gate do M1 dentro da mesma
 * transação do run — se uma conexão foi revogada desde a última vez, o run falha
 * aqui, antes do grafo tocar em qualquer coisa (GRA-03, design §Fluxos).
 */
export async function runAgentGraph(
  tenantId: string,
  run: ServiceRunRow,
  tx: Tx,
  options: ExecuteGraphOptions = {}
): Promise<GraphRunOutcome> {
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

  return executeGraph(tenantId, run, tx, agent.graph, options);
}
