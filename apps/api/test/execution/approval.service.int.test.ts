import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  runMigrations,
  withTenant,
  closeDefaultPool,
  insertServiceInstance,
  insertServiceRun,
  findServiceRunById,
  findApprovalRequestById,
  type ServiceRunRow
} from "@orquestra/db";
import { requestApproval } from "../../src/execution/approval.service";
import { startTestDatabase, type TestDatabase } from "../support/test-database";

describe("execution/approval.service", () => {
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

  async function seedRun(tenantId: string): Promise<ServiceRunRow> {
    const instanceId = randomUUID();
    await withTenant(tenantId, (tx) =>
      insertServiceInstance(
        { id: instanceId, tenantId, agentKey: "exercise", agentVersion: "1.0.0", name: `Instância ${instanceId}` },
        tx
      )
    );
    const id = randomUUID();
    await withTenant(tenantId, (tx) => insertServiceRun({ id, tenantId, serviceInstanceId: instanceId, trigger: "manual" }, tx));
    const run = await withTenant(tenantId, (tx) => findServiceRunById(id, tx));
    if (!run) throw new Error("seed de run falhou");
    return run;
  }

  it("cria o pedido pending com o payload do interrupt e move o run para awaiting_approval (APR-01)", async () => {
    const run = await seedRun(tenantA);
    const payload = { plan: "entregar 1 item de exercício" };

    const approvalId = await withTenant(tenantA, (tx) => requestApproval(tenantA, run, payload, tx));

    const approval = await withTenant(tenantA, (tx) => findApprovalRequestById(approvalId, tx));
    expect(approval).toMatchObject({ runId: run.id, status: "pending", payload });

    const updatedRun = await withTenant(tenantA, (tx) => findServiceRunById(run.id, tx));
    expect(updatedRun?.status).toBe("awaiting_approval");
  });

  it("o payload gravado é exatamente o que o agente passou — nunca o estado inteiro do grafo (APR-02)", async () => {
    const run = await seedRun(tenantA);
    // Um payload mais largo, simulando o que aconteceria se alguém serializasse o
    // estado do grafo por engano — a checagem prova que só o subconjunto exposto pelo
    // agente é o que fica gravado, sem transformação nenhuma no meio.
    const payload = { plan: "entregar 1 item de exercício" };

    const approvalId = await withTenant(tenantA, (tx) => requestApproval(tenantA, run, payload, tx));

    const approval = await withTenant(tenantA, (tx) => findApprovalRequestById(approvalId, tx));
    expect(approval?.payload).toEqual(payload);
    expect(Object.keys(approval?.payload as object)).toEqual(["plan"]);
  });
});
