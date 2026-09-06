import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { runMigrations } from "../src/migrate";
import { withTenant, withoutTenant } from "../src/tenant-context";
import {
  insertServiceInstance,
  findServiceInstanceById,
  listServiceInstances,
  updateServiceInstance,
  removeServiceInstance
} from "../src/repositories/service-instances.repository";
import { startTestDatabase, type TestDatabase } from "./support/test-database";

describe("service-instances.repository", () => {
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

  it("insere e lê de volta uma instância", async () => {
    const id = randomUUID();
    await withTenant(
      tenantA,
      (tx) =>
        insertServiceInstance(
          { id, tenantId: tenantA, agentKey: "accounting-routine", agentVersion: "1.0.0", name: "Instância 1" },
          tx
        ),
      pool
    );

    const found = await withTenant(tenantA, (tx) => findServiceInstanceById(id, tx), pool);
    expect(found?.name).toBe("Instância 1");
    expect(found?.status).toBe("installed");
    expect(found?.config).toEqual({});
  });

  it("list() omite instâncias removidas", async () => {
    const ativaId = randomUUID();
    const removidaId = randomUUID();
    await withTenant(
      tenantA,
      async (tx) => {
        await insertServiceInstance(
          { id: ativaId, tenantId: tenantA, agentKey: "accounting-routine", agentVersion: "1.0.0", name: "Ativa" },
          tx
        );
        await insertServiceInstance(
          {
            id: removidaId,
            tenantId: tenantA,
            agentKey: "accounting-routine",
            agentVersion: "1.0.0",
            name: "Vai ser removida"
          },
          tx
        );
        await removeServiceInstance(removidaId, tx);
      },
      pool
    );

    const rows = await withTenant(tenantA, (tx) => listServiceInstances(tx), pool);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(ativaId);
    expect(ids).not.toContain(removidaId);
  });

  it("update() altera nome e config preservando o resto", async () => {
    const id = randomUUID();
    await withTenant(
      tenantA,
      (tx) =>
        insertServiceInstance(
          { id, tenantId: tenantA, agentKey: "accounting-routine", agentVersion: "1.0.0", name: "Original" },
          tx
        ),
      pool
    );

    await withTenant(
      tenantA,
      (tx) => updateServiceInstance(id, { name: "Renomeada", config: { signature: "X" } }, tx),
      pool
    );

    const found = await withTenant(tenantA, (tx) => findServiceInstanceById(id, tx), pool);
    expect(found?.name).toBe("Renomeada");
    expect(found?.config).toEqual({ signature: "X" });
    expect(found?.agentKey).toBe("accounting-routine");
  });

  it("removeServiceInstance() marca removed_at e status sem apagar a linha", async () => {
    const id = randomUUID();
    await withTenant(
      tenantA,
      (tx) =>
        insertServiceInstance(
          { id, tenantId: tenantA, agentKey: "accounting-routine", agentVersion: "1.0.0", name: "A remover" },
          tx
        ),
      pool
    );

    await withTenant(tenantA, (tx) => removeServiceInstance(id, tx), pool);

    const found = await withTenant(tenantA, (tx) => findServiceInstanceById(id, tx), pool);
    expect(found?.status).toBe("removed");
    expect(found?.removedAt).not.toBeNull();
  });

  it("isolamento: instância de B não aparece em list() nem em findById() sob contexto de A", async () => {
    const idB = randomUUID();
    await withTenant(
      tenantB,
      (tx) =>
        insertServiceInstance(
          { id: idB, tenantId: tenantB, agentKey: "accounting-routine", agentVersion: "1.0.0", name: "De B" },
          tx
        ),
      pool
    );

    const rowsSobA = await withTenant(tenantA, (tx) => listServiceInstances(tx), pool);
    expect(rowsSobA.map((r) => r.id)).not.toContain(idB);

    const foundSobA = await withTenant(tenantA, (tx) => findServiceInstanceById(idB, tx), pool);
    expect(foundSobA).toBeUndefined();
  });

  it("sem contexto de tenant, list() devolve vazio", async () => {
    const rows = await withoutTenant((tx) => listServiceInstances(tx), pool);
    expect(rows).toHaveLength(0);
  });
});
