import { randomUUID, randomBytes } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { runMigrations } from "../src/migrate";
import { withTenant, withoutTenant } from "../src/tenant-context";
import {
  insertConnectorConnection,
  findConnectorConnectionById,
  listConnectorConnections
} from "../src/repositories/connector-connections.repository";
import { startTestDatabase, type TestDatabase } from "./support/test-database";

describe("connector-connections.repository", () => {
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

  it("insere e lê de volta com os envelopes intactos, byte a byte", async () => {
    const id = randomUUID();
    const secretEnvelope = randomBytes(48);
    const dekEnvelope = randomBytes(48);

    await withTenant(
      tenantA,
      (tx) =>
        insertConnectorConnection(
          {
            id,
            tenantId: tenantA,
            connectorKey: "fortes-conecta",
            name: "principal",
            metadata: { baseUrl: "https://conecta.fortestecnologia.com.br" },
            secretEnvelope,
            dekEnvelope,
            keyVersion: 1,
            last4: "9876"
          },
          tx
        ),
      pool
    );

    const found = await withTenant(tenantA, (tx) => findConnectorConnectionById(id, tx), pool);
    expect(found?.secretEnvelope.equals(secretEnvelope)).toBe(true);
    expect(found?.dekEnvelope.equals(dekEnvelope)).toBe(true);
    expect(found?.keyVersion).toBe(1);
    expect(found?.status).toBe("active");
    expect(found?.metadata).toEqual({ baseUrl: "https://conecta.fortestecnologia.com.br" });
  });

  it("isolamento: conexão de B não aparece em list() nem em findById() sob contexto de A", async () => {
    const idB = randomUUID();
    await withTenant(
      tenantB,
      (tx) =>
        insertConnectorConnection(
          {
            id: idB,
            tenantId: tenantB,
            connectorKey: "gmail",
            name: "conta-b",
            secretEnvelope: randomBytes(20),
            dekEnvelope: randomBytes(20),
            keyVersion: 1,
            last4: "0000"
          },
          tx
        ),
      pool
    );

    const rowsSobA = await withTenant(tenantA, (tx) => listConnectorConnections(tx), pool);
    expect(rowsSobA.map((r) => r.id)).not.toContain(idB);

    const foundSobA = await withTenant(tenantA, (tx) => findConnectorConnectionById(idB, tx), pool);
    expect(foundSobA).toBeUndefined();
  });

  it("sem contexto de tenant, list() devolve vazio", async () => {
    const rows = await withoutTenant((tx) => listConnectorConnections(tx), pool);
    expect(rows).toHaveLength(0);
  });
});
