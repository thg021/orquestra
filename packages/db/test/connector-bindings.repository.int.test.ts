import { randomUUID, randomBytes } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { runMigrations } from "../src/migrate";
import { withTenant, withoutTenant } from "../src/tenant-context";
import { insertServiceInstance } from "../src/repositories/service-instances.repository";
import { insertConnectorConnection } from "../src/repositories/connector-connections.repository";
import {
  bindConnectorCapability,
  unbindConnectorCapability,
  listBindingsByInstance,
  listBindingsByConnection
} from "../src/repositories/connector-bindings.repository";
import { startTestDatabase, type TestDatabase } from "./support/test-database";

describe("connector-bindings.repository", () => {
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

  async function seedInstanceAndConnections(tenantId: string) {
    const instanceId = randomUUID();
    const connectionId1 = randomUUID();
    const connectionId2 = randomUUID();
    await withTenant(
      tenantId,
      async (tx) => {
        await insertServiceInstance(
          { id: instanceId, tenantId, agentKey: "accounting-routine", agentVersion: "1.0.0", name: `Instancia-${instanceId}` },
          tx
        );
        for (const connectionId of [connectionId1, connectionId2]) {
          await insertConnectorConnection(
            {
              id: connectionId,
              tenantId,
              connectorKey: "platform-upload",
              name: connectionId,
              secretEnvelope: randomBytes(10),
              dekEnvelope: randomBytes(10),
              keyVersion: 1,
              last4: "0000"
            },
            tx
          );
        }
      },
      pool
    );
    return { instanceId, connectionId1, connectionId2 };
  }

  it("bindConnectorCapability() liga uma capability a uma conexão", async () => {
    const { instanceId, connectionId1 } = await seedInstanceAndConnections(tenantA);

    await withTenant(
      tenantA,
      (tx) => bindConnectorCapability({ tenantId: tenantA, serviceInstanceId: instanceId, capability: "file-storage", connectionId: connectionId1 }, tx),
      pool
    );

    const bindings = await withTenant(tenantA, (tx) => listBindingsByInstance(instanceId, tx), pool);
    expect(bindings).toHaveLength(1);
    expect(bindings[0]?.capability).toBe("file-storage");
    expect(bindings[0]?.connectionId).toBe(connectionId1);
  });

  it("ligar a mesma capability de novo substitui a conexão anterior, sem duplicar linha", async () => {
    const { instanceId, connectionId1, connectionId2 } = await seedInstanceAndConnections(tenantA);

    await withTenant(
      tenantA,
      (tx) => bindConnectorCapability({ tenantId: tenantA, serviceInstanceId: instanceId, capability: "file-storage", connectionId: connectionId1 }, tx),
      pool
    );
    await withTenant(
      tenantA,
      (tx) => bindConnectorCapability({ tenantId: tenantA, serviceInstanceId: instanceId, capability: "file-storage", connectionId: connectionId2 }, tx),
      pool
    );

    const bindings = await withTenant(tenantA, (tx) => listBindingsByInstance(instanceId, tx), pool);
    expect(bindings).toHaveLength(1);
    expect(bindings[0]?.connectionId).toBe(connectionId2);
  });

  it("unbindConnectorCapability() remove o vínculo", async () => {
    const { instanceId, connectionId1 } = await seedInstanceAndConnections(tenantA);
    await withTenant(
      tenantA,
      (tx) => bindConnectorCapability({ tenantId: tenantA, serviceInstanceId: instanceId, capability: "email", connectionId: connectionId1 }, tx),
      pool
    );

    await withTenant(tenantA, (tx) => unbindConnectorCapability(instanceId, "email", tx), pool);

    const bindings = await withTenant(tenantA, (tx) => listBindingsByInstance(instanceId, tx), pool);
    expect(bindings).toHaveLength(0);
  });

  it("listBindingsByConnection() acha as instâncias que dependem de uma conexão", async () => {
    const { instanceId, connectionId1 } = await seedInstanceAndConnections(tenantA);
    await withTenant(
      tenantA,
      (tx) => bindConnectorCapability({ tenantId: tenantA, serviceInstanceId: instanceId, capability: "file-storage", connectionId: connectionId1 }, tx),
      pool
    );

    const bindings = await withTenant(tenantA, (tx) => listBindingsByConnection(connectionId1, tx), pool);
    expect(bindings.map((b) => b.serviceInstanceId)).toContain(instanceId);
  });

  it("isolamento: bindings de B não aparecem sob contexto de A", async () => {
    const { instanceId: instanceB, connectionId1: connectionB } = await seedInstanceAndConnections(tenantB);
    await withTenant(
      tenantB,
      (tx) => bindConnectorCapability({ tenantId: tenantB, serviceInstanceId: instanceB, capability: "file-storage", connectionId: connectionB }, tx),
      pool
    );

    const bindingsSobA = await withTenant(tenantA, (tx) => listBindingsByInstance(instanceB, tx), pool);
    expect(bindingsSobA).toHaveLength(0);
  });

  it("sem contexto de tenant, listBindingsByInstance() devolve vazio", async () => {
    const rows = await withoutTenant((tx) => listBindingsByInstance(randomUUID(), tx), pool);
    expect(rows).toHaveLength(0);
  });
});
