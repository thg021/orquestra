import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { z } from "zod";
import { StateGraph, START, END } from "@langchain/langgraph";
import {
  runMigrations,
  withTenant,
  closeDefaultPool,
  insertServiceInstance,
  insertServiceRun,
  insertConnectorConnection,
  bindConnectorCapability,
  findServiceRunById,
  listRunSteps,
  createCheckpointSaver,
  type ServiceRunRow
} from "@orquestra/db";
import {
  executeGraph,
  runAgentGraph,
  ActivationGateFailedError,
  ExecutionTimeoutError
} from "../../src/execution/graph-runner";
import { startTestDatabase, type TestDatabase } from "../support/test-database";

/**
 * Grafo minimalista construído só aqui — o `exercise` do catálogo interrompe no meio
 * (T9), o que não deixa provar "cada nó grava um RunStep" e "falha preserva o
 * checkpoint" até o fim. Sem interrupt nenhum, 3 nós lineares bastam.
 */
const linearStateSchema = z.object({ trail: z.array(z.string()).default([]) });

function buildLinearGraph() {
  return new StateGraph(linearStateSchema)
    .addNode("stepOne", async (state) => ({ trail: [...state.trail, "stepOne"] }))
    .addNode("stepTwo", async (state) => ({ trail: [...state.trail, "stepTwo"] }))
    .addNode("stepThree", async (state) => ({ trail: [...state.trail, "stepThree"] }))
    .addEdge(START, "stepOne")
    .addEdge("stepOne", "stepTwo")
    .addEdge("stepTwo", "stepThree")
    .addEdge("stepThree", END);
}

function buildFailingGraph() {
  return new StateGraph(linearStateSchema)
    .addNode("stepOne", async (state) => ({ trail: [...state.trail, "stepOne"] }))
    .addNode("stepTwo", async () => {
      throw new Error("falha de propósito no meio do grafo");
    })
    .addNode("stepThree", async (state) => ({ trail: [...state.trail, "stepThree"] }))
    .addEdge(START, "stepOne")
    .addEdge("stepOne", "stepTwo")
    .addEdge("stepTwo", "stepThree")
    .addEdge("stepThree", END);
}

describe("execution/graph-runner", () => {
  let db: TestDatabase;
  const tenantA = randomUUID();

  beforeAll(async () => {
    db = await startTestDatabase();
    await runMigrations({ connectionString: db.ownerUrl });
    process.env.DATABASE_URL = db.appUrl;
  }, 180_000);

  afterAll(async () => {
    await closeDefaultPool();
    await db.close();
  });

  async function seedInstance(tenantId: string, agentKey: string, agentVersion: string): Promise<string> {
    const id = randomUUID();
    await withTenant(tenantId, (tx) =>
      insertServiceInstance({ id, tenantId, agentKey, agentVersion, name: `Instância ${id}` }, tx)
    );
    return id;
  }

  async function seedRun(tenantId: string, instanceId: string): Promise<ServiceRunRow> {
    const id = randomUUID();
    await withTenant(tenantId, (tx) =>
      insertServiceRun({ id, tenantId, serviceInstanceId: instanceId, trigger: "manual" }, tx)
    );
    const run = await withTenant(tenantId, (tx) => findServiceRunById(id, tx));
    if (!run) throw new Error("seed de run falhou");
    return run;
  }

  it("cada nó executado grava um RunStep, na ordem em que rodou", async () => {
    const instanceId = await seedInstance(tenantA, "exercise", "1.0.0");
    const run = await seedRun(tenantA, instanceId);

    await withTenant(tenantA, (tx) => executeGraph(tenantA, run, tx, buildLinearGraph));

    const steps = await withTenant(tenantA, (tx) => listRunSteps(run.id, tx));
    expect(steps.map((step) => (step.detail as { node: string }).node)).toEqual(["stepOne", "stepTwo", "stepThree"]);
    expect(steps.every((step) => step.status === "succeeded")).toBe(true);
    expect(steps.map((step) => step.seq)).toEqual([1, 2, 3]);
  });

  it("falha no meio preserva o checkpoint do que já rodou, com o erro no passo correspondente", async () => {
    const instanceId = await seedInstance(tenantA, "exercise", "1.0.0");
    const run = await seedRun(tenantA, instanceId);

    // A rejeição precisa ser tratada DENTRO do callback de `withTenant` — é isso que o
    // `run-executor` faz de verdade (T7: captura o erro e transiciona o run, sem deixar
    // a exceção subir e disparar ROLLBACK da transação, o que apagaria os RunSteps e o
    // checkpoint que já tinham sido gravados pelos nós que rodaram com sucesso).
    await withTenant(tenantA, async (tx) => {
      await expect(executeGraph(tenantA, run, tx, buildFailingGraph)).rejects.toThrow(
        "falha de propósito no meio do grafo"
      );
    });

    const steps = await withTenant(tenantA, (tx) => listRunSteps(run.id, tx));
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ status: "succeeded", detail: { node: "stepOne" } });
    expect(steps[1]).toMatchObject({ status: "failed", detail: { node: "stepTwo" } });
    // Sanitizado: só o nome da classe do erro, nunca a mensagem crua (pode carregar detalhe interno).
    expect(steps[1]?.error).toBe("Error");
    expect(steps[1]?.error).not.toContain("propósito");

    // O checkpoint de stepOne sobreviveu — é o que a retomada do T11 vai carregar.
    const checkpointCount = await withTenant(tenantA, async (tx) => {
      const saver = createCheckpointSaver(tenantA, tx);
      let count = 0;
      for await (const tuple of saver.list({ configurable: { thread_id: run.id } })) {
        if (tuple) count += 1;
      }
      return count;
    });
    expect(checkpointCount).toBeGreaterThan(0);
  });

  it("gate do M1 reavaliado antes de executar: falha faz o run recusar sem tocar em nada", async () => {
    // exercise exige email como capability obrigatória — sem binding nenhum, o gate
    // reprova antes do grafo tocar em qualquer coisa.
    const instanceId = await seedInstance(tenantA, "exercise", "1.0.0");
    const run = await seedRun(tenantA, instanceId);

    await expect(withTenant(tenantA, (tx) => runAgentGraph(tenantA, run, tx))).rejects.toThrow(
      ActivationGateFailedError
    );

    const steps = await withTenant(tenantA, (tx) => listRunSteps(run.id, tx));
    expect(steps).toHaveLength(0);
  });

  it("pausar em interrupt não é tratado como falha — o agente de exercício para em requestApproval", async () => {
    const instanceId = await seedInstance(tenantA, "exercise", "1.0.0");
    const connectionId = randomUUID();
    await withTenant(tenantA, (tx) =>
      insertConnectorConnection(
        {
          id: connectionId,
          tenantId: tenantA,
          connectorKey: "gmail",
          name: `Conexão ${connectionId}`,
          secretEnvelope: Buffer.from("cifrado-fake-secret"),
          dekEnvelope: Buffer.from("cifrado-fake-dek"),
          keyVersion: 1,
          last4: "0000"
        },
        tx
      )
    );
    await withTenant(tenantA, (tx) =>
      bindConnectorCapability(
        { tenantId: tenantA, serviceInstanceId: instanceId, capability: "email", connectionId },
        tx
      )
    );
    const run = await seedRun(tenantA, instanceId);

    // Não lança — pausar por interrupt não é falha. O outcome sinaliza a pausa e
    // carrega exatamente o valor passado a `interrupt(...)` no nó `requestApproval`
    // (T12): nunca o estado inteiro do grafo, só o que o agente decidiu expor.
    const outcome = await withTenant(tenantA, (tx) => runAgentGraph(tenantA, run, tx));
    expect(outcome).toEqual({
      status: "interrupted",
      payload: { plan: "entregar 1 item de exercício" }
    });

    const steps = await withTenant(tenantA, (tx) => listRunSteps(run.id, tx));
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ status: "succeeded", detail: { node: "prepare" } });

    // O checkpoint de `prepare` sobreviveu à pausa — é o que a retomada (T14) vai
    // carregar depois da decisão humana.
    const checkpointCount = await withTenant(tenantA, async (tx) => {
      const saver = createCheckpointSaver(tenantA, tx);
      let count = 0;
      for await (const tuple of saver.list({ configurable: { thread_id: run.id } })) {
        if (tuple) count += 1;
      }
      return count;
    });
    expect(checkpointCount).toBeGreaterThan(0);
  });

  it("retomada: nó já concluído não roda de novo, e não ganha um segundo RunStep", async () => {
    const instanceId = await seedInstance(tenantA, "exercise", "1.0.0");
    const run = await seedRun(tenantA, instanceId);

    // stepThree só falha na primeira vez que roda — simula o worker sendo derrubado
    // depois que stepOne e stepTwo já foram checkpointados. Os contadores provam que a
    // retomada não reexecuta nó nenhum que já tinha completado.
    const calls = { stepOne: 0, stepTwo: 0, stepThree: 0 };
    function buildCrashOnceGraph() {
      return new StateGraph(linearStateSchema)
        .addNode("stepOne", async (state) => {
          calls.stepOne += 1;
          return { trail: [...state.trail, "stepOne"] };
        })
        .addNode("stepTwo", async (state) => {
          calls.stepTwo += 1;
          return { trail: [...state.trail, "stepTwo"] };
        })
        .addNode("stepThree", async (state) => {
          calls.stepThree += 1;
          if (calls.stepThree === 1) {
            throw new Error("queda simulada do worker depois do stepTwo");
          }
          return { trail: [...state.trail, "stepThree"] };
        })
        .addEdge(START, "stepOne")
        .addEdge("stepOne", "stepTwo")
        .addEdge("stepTwo", "stepThree")
        .addEdge("stepThree", END);
    }

    await withTenant(tenantA, async (tx) => {
      await expect(executeGraph(tenantA, run, tx, buildCrashOnceGraph)).rejects.toThrow(
        "queda simulada do worker depois do stepTwo"
      );
    });
    expect(calls).toEqual({ stepOne: 1, stepTwo: 1, stepThree: 1 });

    // Reentrega do mesmo run/thread — se `executeGraph` passasse `{}` de novo em vez de
    // `null`, o LangGraph trataria como novo input a partir do START e reexecutaria
    // stepOne e stepTwo.
    await withTenant(tenantA, (tx) => executeGraph(tenantA, run, tx, buildCrashOnceGraph));
    expect(calls).toEqual({ stepOne: 1, stepTwo: 1, stepThree: 2 });

    const steps = await withTenant(tenantA, (tx) => listRunSteps(run.id, tx));
    expect(
      steps.map((step) => [(step.detail as { node: string }).node, step.status])
    ).toEqual([
      ["stepOne", "succeeded"],
      ["stepTwo", "succeeded"],
      ["stepThree", "failed"],
      ["stepThree", "succeeded"]
    ]);
  });

  it("execução que passa do tempo máximo encerra como falha, sem ficar rodando", async () => {
    const instanceId = await seedInstance(tenantA, "exercise", "1.0.0");
    const run = await seedRun(tenantA, instanceId);

    function buildSlowGraph() {
      return new StateGraph(linearStateSchema)
        .addNode("stepOne", async (state) => ({ trail: [...state.trail, "stepOne"] }))
        .addNode("stepTwo", async (state, config) => {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, 2_000);
            config?.signal?.addEventListener("abort", () => {
              clearTimeout(timer);
              reject(new Error("nó abortado pelo teste"));
            });
          });
          return { trail: [...state.trail, "stepTwo"] };
        })
        .addEdge(START, "stepOne")
        .addEdge("stepOne", "stepTwo")
        .addEdge("stepTwo", END);
    }

    await withTenant(tenantA, async (tx) => {
      await expect(
        executeGraph(tenantA, run, tx, buildSlowGraph, { maxDurationMs: 50 })
      ).rejects.toThrow(ExecutionTimeoutError);
    });

    const steps = await withTenant(tenantA, (tx) => listRunSteps(run.id, tx));
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ status: "succeeded", detail: { node: "stepOne" } });
    expect(steps[1]).toMatchObject({ status: "failed", detail: { node: "stepTwo" } });
    // Sanitizado: nunca o AbortError cru da lib, e nunca a mensagem interna do nó.
    expect(steps[1]?.error).toBe("ExecutionTimeoutError");
  });
});
