import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import { runMigrations } from "../src/migrate";
import { withTenant, withoutTenant } from "../src/tenant-context";
import { startTestDatabase, type TestDatabase } from "./support/test-database";

describe("service_records sob row-level security", () => {
  let db: TestDatabase;
  let pool: Pool;
  const tenantA = randomUUID();
  const tenantB = randomUUID();

  beforeAll(async () => {
    db = await startTestDatabase();
    await runMigrations({ connectionString: db.ownerUrl });
    pool = new Pool({ connectionString: db.appUrl });

    await withTenant(
      tenantA,
      (tx) =>
        tx.execute(
          sql`insert into service_records (id, tenant_id, service_instance_id, collection, key, data)
              values (${randomUUID()}, ${tenantA}, ${randomUUID()}, 'customers', 'c1', '{"nome":"A"}'::jsonb)`
        ),
      pool
    );
    await withTenant(
      tenantB,
      (tx) =>
        tx.execute(
          sql`insert into service_records (id, tenant_id, service_instance_id, collection, key, data)
              values (${randomUUID()}, ${tenantB}, ${randomUUID()}, 'customers', 'c1', '{"nome":"B"}'::jsonb)`
        ),
      pool
    );
  }, 180_000);

  afterAll(async () => {
    await pool.end();
    await db.close();
  });

  it("sob contexto de A, select * sem where devolve só linhas de A", async () => {
    const rows = await withTenant(
      tenantA,
      async (tx) => (await tx.execute(sql`select tenant_id from service_records`)).rows,
      pool
    );
    expect(rows).toHaveLength(1);
    expect((rows[0] as { tenant_id: string }).tenant_id).toBe(tenantA);
  });

  it("sob contexto de B, select * sem where devolve só linhas de B", async () => {
    const rows = await withTenant(
      tenantB,
      async (tx) => (await tx.execute(sql`select tenant_id from service_records`)).rows,
      pool
    );
    expect(rows).toHaveLength(1);
    expect((rows[0] as { tenant_id: string }).tenant_id).toBe(tenantB);
  });

  it("insert com tenant_id de B sob contexto de A é recusado pelo with check", async () => {
    await expect(
      withTenant(
        tenantA,
        (tx) =>
          tx.execute(
            sql`insert into service_records (id, tenant_id, service_instance_id, collection, key, data)
                values (${randomUUID()}, ${tenantB}, ${randomUUID()}, 'customers', 'c2', '{}'::jsonb)`
          ),
        pool
      )
    ).rejects.toThrow();
  });

  it("update que tentaria mover linha para outro tenant é recusado", async () => {
    await expect(
      withTenant(
        tenantA,
        (tx) =>
          tx.execute(sql`update service_records set tenant_id = ${tenantB} where tenant_id = ${tenantA}`),
        pool
      )
    ).rejects.toThrow();
  });

  it("sem contexto estabelecido, a tabela devolve zero linhas em vez de erro", async () => {
    const rows = await withoutTenant(
      async (tx) => (await tx.execute(sql`select tenant_id from service_records`)).rows,
      pool
    );
    expect(rows).toHaveLength(0);
  });

  it("orquestra_app não contorna a policy mesmo com força de leitura ampla", async () => {
    // FORCE ROW LEVEL SECURITY é o que impede o dono/superusuário de contornar a policy;
    // como orquestra_app não é dono da tabela, este teste também vale como smoke: a
    // policy se aplica à conexão da aplicação de ponta a ponta, não só em teoria.
    const rows = await withTenant(
      tenantA,
      async (tx) =>
        (await tx.execute(sql`select data ->> 'nome' as nome from service_records`)).rows,
      pool
    );
    expect(rows).toEqual([{ nome: "A" }]);
  });
});
