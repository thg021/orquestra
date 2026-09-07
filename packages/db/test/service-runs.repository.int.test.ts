import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { runMigrations } from "../src/migrate";
import { withTenant } from "../src/tenant-context";
import { insertServiceInstance } from "../src/repositories/service-instances.repository";
import {
  insertServiceRun,
  findServiceRunById,
  listServiceRunsByInstance,
  transitionServiceRunStatus,
  IllegalRunTransitionError
} from "../src/repositories/service-runs.repository";
import { insertRunStep, listRunSteps, sumRunCost } from "../src/repositories/run-steps.repository";
import { startTestDatabase, type TestDatabase } from "./support/test-database";

describe("service-runs.repository", () => {
  let db: TestDatabase;
  let pool: Pool;
  const tenantA = randomUUID();
  const tenantB = randomUUID();

  beforeAll(async () => {
    db = await startTestDatabase();
    await runMigrations({ connectionString: db.ownerUrl });
    pool = new Pool({ connectionString: db.appUrl });
  }, 180_000);

  afterAll(async () => {
    await pool.end();
    await db.close();
  });

  async function seedInstance(tenantId: string): Promise<string> {
    const id = randomUUID();
    await withTenant(
      tenantId,
      (tx) =>
        insertServiceInstance(
          { id, tenantId, agentKey: "exercise", agentVersion: "1.0.0", name: `Instância ${id}` },
          tx
        ),
      pool
    );
    return id;
  }

  it("insere um run queued e lê de volta", async () => {
    const instanceId = await seedInstance(tenantA);
    const id = randomUUID();

    await withTenant(
      tenantA,
      (tx) => insertServiceRun({ id, tenantId: tenantA, serviceInstanceId: instanceId, trigger: "manual" }, tx),
      pool
    );

    const found = await withTenant(tenantA, (tx) => findServiceRunById(id, tx), pool);
    expect(found?.status).toBe("queued");
    expect(found?.trigger).toBe("manual");
  });

  it("transição normal muda o status e grava o horário de início ao entrar em running", async () => {
    const instanceId = await seedInstance(tenantA);
    const id = randomUUID();
    await withTenant(
      tenantA,
      (tx) => insertServiceRun({ id, tenantId: tenantA, serviceInstanceId: instanceId, trigger: "manual" }, tx),
      pool
    );

    await withTenant(tenantA, (tx) => transitionServiceRunStatus(id, "running", tx), pool);

    const found = await withTenant(tenantA, (tx) => findServiceRunById(id, tx), pool);
    expect(found?.status).toBe("running");
    expect(found?.startedAt).not.toBeNull();
  });

  it("recusa transicionar um run que já está num estado final", async () => {
    const instanceId = await seedInstance(tenantA);
    const id = randomUUID();
    await withTenant(
      tenantA,
      (tx) => insertServiceRun({ id, tenantId: tenantA, serviceInstanceId: instanceId, trigger: "manual" }, tx),
      pool
    );
    await withTenant(tenantA, (tx) => transitionServiceRunStatus(id, "running", tx), pool);
    await withTenant(tenantA, (tx) => transitionServiceRunStatus(id, "succeeded", tx), pool);

    await expect(withTenant(tenantA, (tx) => transitionServiceRunStatus(id, "running", tx), pool)).rejects.toThrow(
      IllegalRunTransitionError
    );

    const found = await withTenant(tenantA, (tx) => findServiceRunById(id, tx), pool);
    expect(found?.status).toBe("succeeded");
  });

  it("isolamento: run de outro tenant não aparece na listagem nem por id", async () => {
    const instanceB = await seedInstance(tenantB);
    const idB = randomUUID();
    await withTenant(
      tenantB,
      (tx) => insertServiceRun({ id: idB, tenantId: tenantB, serviceInstanceId: instanceB, trigger: "manual" }, tx),
      pool
    );

    const foundUnderA = await withTenant(tenantA, (tx) => findServiceRunById(idB, tx), pool);
    expect(foundUnderA).toBeUndefined();

    const listUnderA = await withTenant(tenantA, (tx) => listServiceRunsByInstance(instanceB, tx), pool);
    expect(listUnderA).toHaveLength(0);
  });

  it("passos saem na ordem em que aconteceram, e o custo do run é a soma calculada no banco", async () => {
    const instanceId = await seedInstance(tenantA);
    const runId = randomUUID();
    await withTenant(
      tenantA,
      (tx) => insertServiceRun({ id: runId, tenantId: tenantA, serviceInstanceId: instanceId, trigger: "manual" }, tx),
      pool
    );

    await withTenant(
      tenantA,
      async (tx) => {
        await insertRunStep(
          { id: randomUUID(), tenantId: tenantA, runId, seq: 2, kind: "document_read", status: "succeeded", costUsd: 0.004 },
          tx
        );
        await insertRunStep(
          { id: randomUUID(), tenantId: tenantA, runId, seq: 1, kind: "graph_node", status: "succeeded" },
          tx
        );
        await insertRunStep(
          { id: randomUUID(), tenantId: tenantA, runId, seq: 3, kind: "document_read", status: "succeeded", costUsd: 0.0011 },
          tx
        );
      },
      pool
    );

    const steps = await withTenant(tenantA, (tx) => listRunSteps(runId, tx), pool);
    expect(steps.map((step) => step.seq)).toEqual([1, 2, 3]);

    const total = await withTenant(tenantA, (tx) => sumRunCost(runId, tx), pool);
    expect(total).toBeCloseTo(0.0051, 6);
  });

  it("run sem passo nenhum tem custo zero, não nulo", async () => {
    const instanceId = await seedInstance(tenantA);
    const runId = randomUUID();
    await withTenant(
      tenantA,
      (tx) => insertServiceRun({ id: runId, tenantId: tenantA, serviceInstanceId: instanceId, trigger: "manual" }, tx),
      pool
    );

    const total = await withTenant(tenantA, (tx) => sumRunCost(runId, tx), pool);
    expect(total).toBe(0);
  });
});
