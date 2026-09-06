import { randomUUID, randomBytes } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import { runMigrations } from "../src/migrate";
import { withTenant, withoutTenant } from "../src/tenant-context";
import { startTestDatabase, type TestDatabase } from "./support/test-database";

describe("tabelas do M1 (service_instances, connector_connections, connector_bindings)", () => {
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

  it("segredo e DEK são gravados e lidos como bytea, byte a byte idênticos", async () => {
    const connectionId = randomUUID();
    const secretEnvelope = randomBytes(61);
    const dekEnvelope = randomBytes(61);

    await withTenant(
      tenantA,
      (tx) =>
        tx.execute(
          sql`insert into connector_connections
              (id, tenant_id, connector_key, name, secret_envelope, dek_envelope, key_version, last4, status)
              values (${connectionId}, ${tenantA}, 'fortes-conecta', 'principal', ${secretEnvelope}, ${dekEnvelope}, 1, '9876', 'active')`
        ),
      pool
    );

    const rows = await withTenant(
      tenantA,
      async (tx) =>
        (
          await tx.execute(
            sql`select secret_envelope, dek_envelope, key_version from connector_connections where id = ${connectionId}`
          )
        ).rows,
      pool
    );

    const row = rows[0] as { secret_envelope: Buffer; dek_envelope: Buffer; key_version: number };
    expect(Buffer.from(row.secret_envelope).equals(secretEnvelope)).toBe(true);
    expect(Buffer.from(row.dek_envelope).equals(dekEnvelope)).toBe(true);
    expect(row.key_version).toBe(1);
  });

  it("uma capability só pode ter uma conexão por instância — segunda tentativa é recusada", async () => {
    const instanceId = randomUUID();
    const connectionId1 = randomUUID();
    const connectionId2 = randomUUID();

    await withTenant(
      tenantA,
      (tx) =>
        tx.execute(
          sql`insert into service_instances (id, tenant_id, agent_key, agent_version, name, status)
              values (${instanceId}, ${tenantA}, 'accounting-routine', '1.0.0', 'Instancia 1', 'installed')`
        ),
      pool
    );
    for (const connectionId of [connectionId1, connectionId2]) {
      await withTenant(
        tenantA,
        (tx) =>
          tx.execute(
            sql`insert into connector_connections
                (id, tenant_id, connector_key, name, secret_envelope, dek_envelope, key_version, last4, status)
                values (${connectionId}, ${tenantA}, 'platform-upload', ${connectionId}, ${randomBytes(
              10
            )}, ${randomBytes(10)}, 1, '0000', 'active')`
          ),
        pool
      );
    }

    await withTenant(
      tenantA,
      (tx) =>
        tx.execute(
          sql`insert into connector_bindings (id, tenant_id, service_instance_id, capability, connection_id)
              values (${randomUUID()}, ${tenantA}, ${instanceId}, 'file-storage', ${connectionId1})`
        ),
      pool
    );

    await expect(
      withTenant(
        tenantA,
        (tx) =>
          tx.execute(
            sql`insert into connector_bindings (id, tenant_id, service_instance_id, capability, connection_id)
                values (${randomUUID()}, ${tenantA}, ${instanceId}, 'file-storage', ${connectionId2})`
          ),
        pool
      )
    ).rejects.toThrow();
  });

  it("nome de instância pode repetir depois que a anterior foi removida (índice único é parcial)", async () => {
    const originalId = randomUUID();
    const novoId = randomUUID();
    const nome = `Repetivel-${randomUUID()}`;

    await withTenant(
      tenantA,
      (tx) =>
        tx.execute(
          sql`insert into service_instances (id, tenant_id, agent_key, agent_version, name, status, removed_at)
              values (${originalId}, ${tenantA}, 'accounting-routine', '1.0.0', ${nome}, 'removed', now())`
        ),
      pool
    );

    // Não deveria lançar: a instância anterior está removida, então o nome está livre.
    await withTenant(
      tenantA,
      (tx) =>
        tx.execute(
          sql`insert into service_instances (id, tenant_id, agent_key, agent_version, name, status)
              values (${novoId}, ${tenantA}, 'accounting-routine', '1.0.0', ${nome}, 'installed')`
        ),
      pool
    );

    const rows = await withTenant(
      tenantA,
      async (tx) => (await tx.execute(sql`select id from service_instances where name = ${nome}`)).rows,
      pool
    );
    expect(rows).toHaveLength(2);
  });

  it("duas instâncias ativas do mesmo tenant não podem ter o mesmo nome", async () => {
    const nome = `Unico-${randomUUID()}`;
    await withTenant(
      tenantA,
      (tx) =>
        tx.execute(
          sql`insert into service_instances (id, tenant_id, agent_key, agent_version, name, status)
              values (${randomUUID()}, ${tenantA}, 'accounting-routine', '1.0.0', ${nome}, 'installed')`
        ),
      pool
    );

    await expect(
      withTenant(
        tenantA,
        (tx) =>
          tx.execute(
            sql`insert into service_instances (id, tenant_id, agent_key, agent_version, name, status)
                values (${randomUUID()}, ${tenantA}, 'accounting-routine', '1.0.0', ${nome}, 'installed')`
          ),
        pool
      )
    ).rejects.toThrow();
  });

  it("isolamento: sob contexto de A, connector_connections de B não aparece", async () => {
    await withTenant(
      tenantB,
      (tx) =>
        tx.execute(
          sql`insert into connector_connections
              (id, tenant_id, connector_key, name, secret_envelope, dek_envelope, key_version, last4, status)
              values (${randomUUID()}, ${tenantB}, 'gmail', 'conta-b', ${randomBytes(10)}, ${randomBytes(
            10
          )}, 1, '1111', 'active')`
        ),
      pool
    );

    const rows = await withTenant(
      tenantA,
      async (tx) =>
        (await tx.execute(sql`select tenant_id from connector_connections where connector_key = 'gmail'`))
          .rows,
      pool
    );
    expect(rows).toHaveLength(0);
  });

  it("sem contexto de tenant, as três tabelas devolvem zero linhas", async () => {
    const instances = await withoutTenant(
      async (tx) => (await tx.execute(sql`select id from service_instances`)).rows,
      pool
    );
    const connections = await withoutTenant(
      async (tx) => (await tx.execute(sql`select id from connector_connections`)).rows,
      pool
    );
    const bindings = await withoutTenant(
      async (tx) => (await tx.execute(sql`select id from connector_bindings`)).rows,
      pool
    );

    expect(instances).toHaveLength(0);
    expect(connections).toHaveLength(0);
    expect(bindings).toHaveLength(0);
  });
});
