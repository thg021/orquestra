import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  runMigrations,
  withTenant,
  closeDefaultPool,
  insertServiceInstance,
  insertServiceRun,
  findServiceRunById,
  transitionServiceRunStatus
} from "@orquestra/db";
import { executeRunJob } from "../../src/execution/run-executor";
import type { RunJob } from "../../src/execution/queue";
import { startTestDatabase, type TestDatabase } from "../support/test-database";

describe("execution/run-executor", () => {
  let db: TestDatabase;
  const tenantA = randomUUID();
  const tenantB = randomUUID();

  beforeAll(async () => {
    db = await startTestDatabase();
    await runMigrations({ connectionString: db.ownerUrl });
    process.env.DATABASE_URL = db.appUrl;
  }, 180_000);

  afterAll(async () => {
    await closeDefaultPool();
    await db.close();
  });

  async function seedActiveInstance(tenantId: string): Promise<string> {
    const id = randomUUID();
    await withTenant(tenantId, (tx) =>
      insertServiceInstance({ id, tenantId, agentKey: "exercise", agentVersion: "1.0.0", name: `Instância ${id}` }, tx)
    );
    return id;
  }

  async function seedRun(tenantId: string, instanceId: string): Promise<string> {
    const id = randomUUID();
    await withTenant(tenantId, (tx) =>
      insertServiceRun({ id, tenantId, serviceInstanceId: instanceId, trigger: "manual" }, tx)
    );
    return id;
  }

  function jobFor(tenantId: string, serviceInstanceId: string, runId: string): RunJob {
    return { tenantId, serviceInstanceId, runId, trigger: "manual" };
  }

  it("estabelece o contexto de tenant antes de qualquer leitura — run de outro tenant é invisível, não um erro", async () => {
    const instanceId = await seedActiveInstance(tenantA);
    const runId = await seedRun(tenantA, instanceId);

    // Job com o tenant errado: RLS faz o run "sumir" em vez de aparecer sob o tenant certo.
    await executeRunJob(jobFor(tenantB, instanceId, runId));

    const stillQueued = await withTenant(tenantA, (tx) => findServiceRunById(runId, tx));
    expect(stillQueued?.status).toBe("queued");
  });

  it("run já concluído (reentrega do mesmo job) não executa nada", async () => {
    const instanceId = await seedActiveInstance(tenantA);
    const runId = await seedRun(tenantA, instanceId);
    await withTenant(tenantA, (tx) => transitionServiceRunStatus(runId, "running", tx));
    await withTenant(tenantA, (tx) => transitionServiceRunStatus(runId, "succeeded", tx));
    const before = await withTenant(tenantA, (tx) => findServiceRunById(runId, tx));

    await executeRunJob(jobFor(tenantA, instanceId, runId));

    const after = await withTenant(tenantA, (tx) => findServiceRunById(runId, tx));
    expect(after?.status).toBe("succeeded");
    expect(after?.updatedAt).toEqual(before?.updatedAt);
  });

  it("run já running (worker derrubado antes) retoma sem reiniciar startedAt, e termina succeeded", async () => {
    const instanceId = await seedActiveInstance(tenantA);
    const runId = await seedRun(tenantA, instanceId);
    await withTenant(tenantA, (tx) => transitionServiceRunStatus(runId, "running", tx));
    const midCrash = await withTenant(tenantA, (tx) => findServiceRunById(runId, tx));

    // Ciclo de vida do run é o que esta suíte testa, não o grafo — o default real
    // (T10, `graph-runner`) tem sua própria suíte de integração dedicada.
    await executeRunJob(jobFor(tenantA, instanceId, runId), {
      runAgentGraphFn: async () => ({ status: "completed" })
    });

    const after = await withTenant(tenantA, (tx) => findServiceRunById(runId, tx));
    expect(after?.status).toBe("succeeded");
    expect(after?.startedAt).toEqual(midCrash?.startedAt);
  });

  it("run queued vira running e depois succeeded no caminho feliz", async () => {
    const instanceId = await seedActiveInstance(tenantA);
    const runId = await seedRun(tenantA, instanceId);

    await executeRunJob(jobFor(tenantA, instanceId, runId), {
      runAgentGraphFn: async () => ({ status: "completed" })
    });

    const after = await withTenant(tenantA, (tx) => findServiceRunById(runId, tx));
    expect(after?.status).toBe("succeeded");
    expect(after?.startedAt).not.toBeNull();
    expect(after?.finishedAt).not.toBeNull();
  });

  it("falha inesperada grava o erro sanitizado no run, sem segredo nem string de conexão", async () => {
    const instanceId = await seedActiveInstance(tenantA);
    const runId = await seedRun(tenantA, instanceId);
    const secret = "postgres://orquestra_owner:senha-secreta@host:5432/db";

    await executeRunJob(jobFor(tenantA, instanceId, runId), {
      runAgentGraphFn: async () => {
        throw new Error(`falha ao conectar em ${secret}`);
      }
    });

    const after = await withTenant(tenantA, (tx) => findServiceRunById(runId, tx));
    expect(after?.status).toBe("failed");
    expect(after?.error).not.toContain(secret);
    expect(after?.error).not.toContain("senha-secreta");
    expect(after?.error).toBe("Error");
  });

  it("grafo pausa em interrupt: run vai pra awaiting_approval, nunca succeeded (APR-01)", async () => {
    const instanceId = await seedActiveInstance(tenantA);
    const runId = await seedRun(tenantA, instanceId);
    const payload = { plan: "entregar 1 item de exercício" };

    await executeRunJob(jobFor(tenantA, instanceId, runId), {
      runAgentGraphFn: async () => ({ status: "interrupted", payload })
    });

    const after = await withTenant(tenantA, (tx) => findServiceRunById(runId, tx));
    expect(after?.status).toBe("awaiting_approval");
  });

  it("run em awaiting_approval não é retomado por reentrega da fila — só por decisão", async () => {
    const instanceId = await seedActiveInstance(tenantA);
    const runId = await seedRun(tenantA, instanceId);
    await withTenant(tenantA, (tx) => transitionServiceRunStatus(runId, "running", tx));
    await withTenant(tenantA, (tx) => transitionServiceRunStatus(runId, "awaiting_approval", tx));
    const before = await withTenant(tenantA, (tx) => findServiceRunById(runId, tx));

    // Se o worker chegasse a chamar o grafo de novo, este mock provaria isso lançando.
    await executeRunJob(jobFor(tenantA, instanceId, runId), {
      runAgentGraphFn: async () => {
        throw new Error("não deveria ser chamado: run já está aguardando aprovação");
      }
    });

    const after = await withTenant(tenantA, (tx) => findServiceRunById(runId, tx));
    expect(after?.status).toBe("awaiting_approval");
    expect(after?.updatedAt).toEqual(before?.updatedAt);
  });
});
