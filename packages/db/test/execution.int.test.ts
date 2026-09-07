import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import { runMigrations } from "../src/migrate";
import { withTenant, withoutTenant } from "../src/tenant-context";
import { startTestDatabase, type TestDatabase } from "./support/test-database";

/**
 * As seis tabelas do runtime (T1). O isolamento em si é coberto automaticamente pelo
 * teste de introspecção de RLS — aqui provamos as garantias que são específicas
 * destas tabelas: unicidade de recibo, pedido de aprovação único por run, e o
 * checkpoint invisível de fora do tenant.
 */
describe("tabelas do M2 (runtime de execução)", () => {
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

  /** `service_runs` tem FK para `service_instances` — o run precisa de uma instância de verdade. */
  async function insertInstance(tenantId: string): Promise<string> {
    const instanceId = randomUUID();
    await withTenant(
      tenantId,
      (tx) =>
        tx.execute(
          sql`insert into service_instances (id, tenant_id, agent_key, agent_version, name, config, status)
              values (${instanceId}, ${tenantId}, 'exercise', '1.0.0', ${`Instância ${instanceId}`}, '{}'::jsonb, 'active')`
        ),
      pool
    );
    return instanceId;
  }

  async function insertRun(tenantId: string, runId: string, instanceId: string): Promise<void> {
    await withTenant(
      tenantId,
      (tx) =>
        tx.execute(
          sql`insert into service_runs (id, tenant_id, service_instance_id, trigger, status)
              values (${runId}, ${tenantId}, ${instanceId}, 'manual', 'queued')`
        ),
      pool
    );
  }

  it("um run guarda gatilho e estado, e é lido de volta sob o mesmo tenant", async () => {
    const runId = randomUUID();
    const instanceId = await insertInstance(tenantA);
    await insertRun(tenantA, runId, instanceId);

    const rows = await withTenant(
      tenantA,
      async (tx) => (await tx.execute(sql`select trigger, status from service_runs where id = ${runId}`)).rows,
      pool
    );

    expect(rows[0]).toMatchObject({ trigger: "manual", status: "queued" });
  });

  it("passo de execução guarda tokens e custo, e sai na ordem em que aconteceu", async () => {
    const runId = randomUUID();
    await insertRun(tenantA, runId, await insertInstance(tenantA));

    await withTenant(
      tenantA,
      async (tx) => {
        await tx.execute(
          sql`insert into run_steps (id, tenant_id, run_id, seq, kind, status, tokens_in, tokens_out, cost_usd)
              values (${randomUUID()}, ${tenantA}, ${runId}, 2, 'document_read', 'succeeded', 1200, 80, 0.0042)`
        );
        await tx.execute(
          sql`insert into run_steps (id, tenant_id, run_id, seq, kind, status)
              values (${randomUUID()}, ${tenantA}, ${runId}, 1, 'graph_node', 'succeeded')`
        );
      },
      pool
    );

    const rows = await withTenant(
      tenantA,
      async (tx) =>
        (await tx.execute(sql`select seq, kind, cost_usd from run_steps where run_id = ${runId} order by seq`)).rows,
      pool
    );

    expect(rows.map((row) => (row as { kind: string }).kind)).toEqual(["graph_node", "document_read"]);
    expect(Number((rows[1] as { cost_usd: string }).cost_usd)).toBeCloseTo(0.0042, 6);
  });

  it("o mesmo run não pode ter dois pedidos de aprovação pendentes", async () => {
    const runId = randomUUID();
    await insertRun(tenantA, runId, await insertInstance(tenantA));

    await withTenant(
      tenantA,
      (tx) =>
        tx.execute(
          sql`insert into approval_requests (id, tenant_id, run_id, payload, status)
              values (${randomUUID()}, ${tenantA}, ${runId}, '{"items":[]}'::jsonb, 'pending')`
        ),
      pool
    );

    const second = withTenant(
      tenantA,
      (tx) =>
        tx.execute(
          sql`insert into approval_requests (id, tenant_id, run_id, payload, status)
              values (${randomUUID()}, ${tenantA}, ${runId}, '{"items":[]}'::jsonb, 'pending')`
        ),
      pool
    );

    await expect(second).rejects.toThrow();
  });

  it("um pedido já decidido não bloqueia um novo pedido pendente para o mesmo run", async () => {
    const runId = randomUUID();
    await insertRun(tenantA, runId, await insertInstance(tenantA));

    await withTenant(
      tenantA,
      async (tx) => {
        await tx.execute(
          sql`insert into approval_requests (id, tenant_id, run_id, payload, status, decided_at)
              values (${randomUUID()}, ${tenantA}, ${runId}, '{"items":[]}'::jsonb, 'rejected', now())`
        );
        await tx.execute(
          sql`insert into approval_requests (id, tenant_id, run_id, payload, status)
              values (${randomUUID()}, ${tenantA}, ${runId}, '{"items":[]}'::jsonb, 'pending')`
        );
      },
      pool
    );

    const rows = await withTenant(
      tenantA,
      async (tx) => (await tx.execute(sql`select count(*)::int as total from approval_requests where run_id = ${runId}`)).rows,
      pool
    );

    expect((rows[0] as { total: number }).total).toBe(2);
  });

  it("recibo de entrega é único por (tenant, instância, chave) — a segunda gravação é recusada pelo banco", async () => {
    const instanceId = await insertInstance(tenantA);
    const key = `cliente-1|2026-03|tem_funcionario|email`;

    await withTenant(
      tenantA,
      (tx) =>
        tx.execute(
          sql`insert into delivery_receipts (id, tenant_id, service_instance_id, idempotency_key, run_id)
              values (${randomUUID()}, ${tenantA}, ${instanceId}, ${key}, ${randomUUID()})`
        ),
      pool
    );

    const duplicate = withTenant(
      tenantA,
      (tx) =>
        tx.execute(
          sql`insert into delivery_receipts (id, tenant_id, service_instance_id, idempotency_key, run_id)
              values (${randomUUID()}, ${tenantA}, ${instanceId}, ${key}, ${randomUUID()})`
        ),
      pool
    );

    await expect(duplicate).rejects.toThrow();
  });

  it("a mesma chave de entrega em outra instância é permitida", async () => {
    const key = `cliente-9|2026-03|comercio|email`;
    const instanceOne = await insertInstance(tenantA);
    const instanceTwo = await insertInstance(tenantA);

    await withTenant(
      tenantA,
      async (tx) => {
        await tx.execute(
          sql`insert into delivery_receipts (id, tenant_id, service_instance_id, idempotency_key, run_id)
              values (${randomUUID()}, ${tenantA}, ${instanceOne}, ${key}, ${randomUUID()})`
        );
        await tx.execute(
          sql`insert into delivery_receipts (id, tenant_id, service_instance_id, idempotency_key, run_id)
              values (${randomUUID()}, ${tenantA}, ${instanceTwo}, ${key}, ${randomUUID()})`
        );
      },
      pool
    );

    const rows = await withTenant(
      tenantA,
      async (tx) =>
        (await tx.execute(sql`select count(*)::int as total from delivery_receipts where idempotency_key = ${key}`)).rows,
      pool
    );

    expect((rows[0] as { total: number }).total).toBe(2);
  });

  it("uma instância tem no máximo um agendamento", async () => {
    const instanceId = await insertInstance(tenantA);

    await withTenant(
      tenantA,
      (tx) =>
        tx.execute(
          sql`insert into schedules (id, tenant_id, service_instance_id, cron, timezone, next_run_at)
              values (${randomUUID()}, ${tenantA}, ${instanceId}, '0 9 2 * *', 'America/Sao_Paulo', now())`
        ),
      pool
    );

    const second = withTenant(
      tenantA,
      (tx) =>
        tx.execute(
          sql`insert into schedules (id, tenant_id, service_instance_id, cron, timezone, next_run_at)
              values (${randomUUID()}, ${tenantA}, ${instanceId}, '0 9 7 * *', 'America/Sao_Paulo', now())`
        ),
      pool
    );

    await expect(second).rejects.toThrow();
  });

  it("checkpoint do grafo é gravado e lido de volta idêntico, e some sob outro tenant", async () => {
    const runId = randomUUID();
    await insertRun(tenantA, runId, await insertInstance(tenantA));
    const state = { node: "montar_plano", cursor: 7 };

    await withTenant(
      tenantA,
      (tx) =>
        tx.execute(
          sql`insert into graph_checkpoints (id, tenant_id, run_id, checkpoint_id, state)
              values (${randomUUID()}, ${tenantA}, ${runId}, 'ckpt-1', ${JSON.stringify(state)}::jsonb)`
        ),
      pool
    );

    const own = await withTenant(
      tenantA,
      async (tx) => (await tx.execute(sql`select state from graph_checkpoints where run_id = ${runId}`)).rows,
      pool
    );
    expect((own[0] as { state: unknown }).state).toEqual(state);

    const foreign = await withTenant(
      tenantB,
      async (tx) => (await tx.execute(sql`select state from graph_checkpoints where run_id = ${runId}`)).rows,
      pool
    );
    expect(foreign).toHaveLength(0);
  });

  it("sem contexto de tenant, nenhuma das tabelas novas devolve linha", async () => {
    const counts = await withoutTenant(
      async (tx) =>
        (
          await tx.execute(sql`
            select
              (select count(*) from service_runs)      as runs,
              (select count(*) from run_steps)         as steps,
              (select count(*) from approval_requests) as approvals,
              (select count(*) from delivery_receipts) as receipts,
              (select count(*) from schedules)         as schedules,
              (select count(*) from graph_checkpoints) as checkpoints
          `)
        ).rows,
      pool
    );

    expect(Object.values(counts[0] as Record<string, string>).map(Number)).toEqual([0, 0, 0, 0, 0, 0]);
  });
});
