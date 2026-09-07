import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Pool } from "pg";
import { runMigrations } from "../src/migrate";
import { withTenant, withoutTenant } from "../src/tenant-context";
import * as identitySchema from "../src/schema/identity";
import { insertServiceInstance } from "../src/repositories/service-instances.repository";
import { insertServiceRun } from "../src/repositories/service-runs.repository";
import {
  createApprovalRequest,
  decideApprovalRequest,
  findApprovalRequestById,
  AlreadyDecidedError
} from "../src/repositories/approval-requests.repository";
import { insertDeliveryReceipt, findDeliveryReceipts, DuplicateDeliveryError } from "../src/repositories/delivery-receipts.repository";
import { upsertSchedule, claimDueSchedules } from "../src/repositories/schedules.repository";
import { startTestDatabase, type TestDatabase } from "./support/test-database";

describe("approval-requests / delivery-receipts / schedules", () => {
  let db: TestDatabase;
  let pool: Pool;
  const tenantA = randomUUID();

  beforeAll(async () => {
    db = await startTestDatabase();
    await runMigrations({ connectionString: db.ownerUrl });
    pool = new Pool({ connectionString: db.appUrl });
    // claimDueSchedules varre `tenants` (tabela global) para saber que tenant existe —
    // sem esta linha, tenantA é invisível para ela mesmo com schedules sob seu RLS.
    await withoutTenant((tx) => tx.insert(identitySchema.tenants).values({ id: tenantA, name: "Tenant do teste" }), pool);
  }, 180_000);

  afterAll(async () => {
    await pool.end();
    await db.close();
  });

  async function seedInstance(): Promise<string> {
    const id = randomUUID();
    await withTenant(
      tenantA,
      (tx) => insertServiceInstance({ id, tenantId: tenantA, agentKey: "exercise", agentVersion: "1.0.0", name: `Instância ${id}` }, tx),
      pool
    );
    return id;
  }

  async function seedRun(instanceId: string): Promise<string> {
    const id = randomUUID();
    await withTenant(
      tenantA,
      (tx) => insertServiceRun({ id, tenantId: tenantA, serviceInstanceId: instanceId, trigger: "manual" }, tx),
      pool
    );
    return id;
  }

  describe("approval-requests", () => {
    it("cria pendente, aprova, e decidir de novo é recusado sem sobrescrever a decisão", async () => {
      const runId = await seedRun(await seedInstance());
      const decidedBy = randomUUID();

      const requestId = await withTenant(
        tenantA,
        (tx) => createApprovalRequest({ id: randomUUID(), tenantId: tenantA, runId, payload: { items: [] } }, tx),
        pool
      );

      await withTenant(tenantA, (tx) => decideApprovalRequest(requestId, "approved", decidedBy, tx), pool);

      const second = withTenant(
        tenantA,
        (tx) => decideApprovalRequest(requestId, "rejected", randomUUID(), tx),
        pool
      );
      await expect(second).rejects.toThrow(AlreadyDecidedError);

      const found = await withTenant(tenantA, (tx) => findApprovalRequestById(requestId, tx), pool);
      expect(found?.status).toBe("approved");
      expect(found?.decidedBy).toBe(decidedBy);
    });

    it("um pedido decidido não impede um novo pedido pendente no mesmo run", async () => {
      const runId = await seedRun(await seedInstance());

      const firstId = await withTenant(
        tenantA,
        (tx) => createApprovalRequest({ id: randomUUID(), tenantId: tenantA, runId, payload: { items: [] } }, tx),
        pool
      );
      await withTenant(tenantA, (tx) => decideApprovalRequest(firstId, "rejected", randomUUID(), tx), pool);

      const secondId = await withTenant(
        tenantA,
        (tx) => createApprovalRequest({ id: randomUUID(), tenantId: tenantA, runId, payload: { items: [] } }, tx),
        pool
      );

      const found = await withTenant(tenantA, (tx) => findApprovalRequestById(secondId, tx), pool);
      expect(found?.status).toBe("pending");
    });
  });

  describe("delivery-receipts", () => {
    it("recibo com chave repetida na mesma instância é recusado pelo banco", async () => {
      const instanceId = await seedInstance();
      const runId = await seedRun(instanceId);
      const key = "cliente-1|2026-03|tem_funcionario|email";

      await withTenant(
        tenantA,
        (tx) => insertDeliveryReceipt({ id: randomUUID(), tenantId: tenantA, serviceInstanceId: instanceId, idempotencyKey: key, runId }, tx),
        pool
      );

      const duplicate = withTenant(
        tenantA,
        (tx) => insertDeliveryReceipt({ id: randomUUID(), tenantId: tenantA, serviceInstanceId: instanceId, idempotencyKey: key, runId }, tx),
        pool
      );

      await expect(duplicate).rejects.toThrow(DuplicateDeliveryError);
    });

    it("acha os recibos existentes entre um conjunto de chaves, para saber o que já foi entregue", async () => {
      const instanceId = await seedInstance();
      const runId = await seedRun(instanceId);

      await withTenant(
        tenantA,
        (tx) =>
          insertDeliveryReceipt(
            { id: randomUUID(), tenantId: tenantA, serviceInstanceId: instanceId, idempotencyKey: "a", runId },
            tx
          ),
        pool
      );

      const found = await withTenant(
        tenantA,
        (tx) => findDeliveryReceipts(instanceId, ["a", "b", "c"], tx),
        pool
      );

      expect(found).toEqual(["a"]);
    });
  });

  describe("schedules", () => {
    // claimDueSchedules varre TODO tenant — sobra de um teste anterior (schedule com
    // next_run_at no passado) seria "achada" pelo próximo, do mesmo jeito que a lição
    // do kek-rotate no M1. Isolar só por tenant não basta; é preciso truncar a tabela.
    afterEach(async () => {
      const owner = new Pool({ connectionString: db.ownerUrl });
      try {
        await owner.query("truncate table schedules");
      } finally {
        await owner.end();
      }
    });

    it("upsert cria e depois substitui a recorrência da mesma instância, sem duplicar", async () => {
      const instanceId = await seedInstance();
      const first = new Date("2026-03-02T12:00:00.000Z");
      const second = new Date("2026-04-02T12:00:00.000Z");

      await withTenant(
        tenantA,
        (tx) => upsertSchedule({ tenantId: tenantA, serviceInstanceId: instanceId, cron: "0 9 2 * *", timezone: "America/Sao_Paulo", nextRunAt: first }, tx),
        pool
      );
      await withTenant(
        tenantA,
        (tx) => upsertSchedule({ tenantId: tenantA, serviceInstanceId: instanceId, cron: "0 10 2 * *", timezone: "America/Sao_Paulo", nextRunAt: second }, tx),
        pool
      );

      const rows = await withTenant(
        tenantA,
        async (tx) => tx.execute(`select cron, next_run_at from schedules where service_instance_id = '${instanceId}'`),
        pool
      );
      expect(rows.rows).toHaveLength(1);
      expect((rows.rows[0] as { cron: string }).cron).toBe("0 10 2 * *");
    });

    it("claimDueSchedules reivindica só quem venceu, avança next_run_at a partir de agora, e nenhum outro claim vê a mesma linha", async () => {
      const dueInstance = await seedInstance();
      const notDueInstance = await seedInstance();
      const now = new Date();

      await withTenant(
        tenantA,
        (tx) =>
          upsertSchedule(
            { tenantId: tenantA, serviceInstanceId: dueInstance, cron: "* * * * *", timezone: "UTC", nextRunAt: new Date(now.getTime() - 60_000) },
            tx
          ),
        pool
      );
      await withTenant(
        tenantA,
        (tx) =>
          upsertSchedule(
            { tenantId: tenantA, serviceInstanceId: notDueInstance, cron: "0 0 1 1 *", timezone: "UTC", nextRunAt: new Date(now.getTime() + 3600_000) },
            tx
          ),
        pool
      );

      const claimed = await claimDueSchedules(now, pool);
      expect(claimed.map((row) => row.serviceInstanceId)).toEqual([dueInstance]);
      expect(claimed[0]!.nextRunAt.getTime()).toBeGreaterThan(now.getTime());

      const claimedAgain = await claimDueSchedules(now, pool);
      expect(claimedAgain).toHaveLength(0);
    });
  });
});
