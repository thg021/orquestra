import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import {
  closeDefaultPool,
  withTenant,
  withoutTenant,
  identitySchema,
  insertConnectorConnection,
  listBindingsByInstance
} from "@orquestra/db";
import { hashPassword, newId } from "@orquestra/core";
import { bootstrap } from "../../src/bootstrap";
import { createTenantWithOwner } from "../../src/identity/identity.repository";
import { createSession } from "../../src/auth/session.repository";
import { SESSION_COOKIE_NAME } from "../../src/auth/session.guard";
import { startTestDatabase, type TestDatabase } from "../support/test-database";
import { createTestKekDir } from "../support/test-kek";

const PASSWORD = "senha-correta-123";
const PASSWORD_COST = { memoryCost: 1024, timeCost: 2, parallelism: 1 };
const KEK_DIR = createTestKekDir();
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function baseEnv(databaseUrl: string): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: databaseUrl,
    DATABASE_MIGRATION_URL: databaseUrl,
    REDIS_URL: "redis://localhost:6379",
    SESSION_SECRET: "a".repeat(32),
    API_PORT: "3000",
    PROCESS_ROLE: "api",
    KEK_DIR
  };
}

function cookieHeader(token: string): string {
  return `${SESSION_COOKIE_NAME}=${token}`;
}

describe("BindingsController", () => {
  let db: TestDatabase;
  let app: INestApplication;
  let seedCounter = 0;

  async function seedOwner(): Promise<{ tenantId: string; cookie: string }> {
    seedCounter += 1;
    const passwordHash = await hashPassword(PASSWORD, PASSWORD_COST);
    const created = await createTenantWithOwner({
      tenantName: `Tenant ${seedCounter}`,
      email: `owner${seedCounter}@exemplo.com`,
      passwordHash
    });
    const session = await createSession({ userId: created.userId, tenantId: created.tenantId, ttlMs: ONE_DAY_MS });
    return { tenantId: created.tenantId, cookie: cookieHeader(session.token) };
  }

  async function seedOperatorInTenant(tenantId: string): Promise<{ cookie: string }> {
    const passwordHash = await hashPassword(PASSWORD, PASSWORD_COST);
    const userId = newId();
    await withoutTenant(async (tx) => {
      await tx.insert(identitySchema.users).values({
        id: userId,
        email: `operator-${userId}@exemplo.com`,
        passwordHash
      });
      await tx.insert(identitySchema.memberships).values({ id: newId(), tenantId, userId, role: "operator" });
    });
    const session = await createSession({ userId, tenantId, ttlMs: ONE_DAY_MS });
    return { cookie: cookieHeader(session.token) };
  }

  async function seedInstance(tenantId: string, cookie: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post("/service-instances")
      .set("Cookie", cookie)
      .send({
        agentKey: "accounting-routine",
        name: `Instância ${randomUUID()}`,
        config: { signature: "X", defaultDeadline: "dia 20", defaultCc: [] }
      });
    return response.body.id;
  }

  async function seedConnection(tenantId: string, connectorKey: string): Promise<string> {
    const id = randomUUID();
    await withTenant(tenantId, (tx) =>
      insertConnectorConnection(
        {
          id,
          tenantId,
          connectorKey,
          name: `Conexão ${id}`,
          secretEnvelope: Buffer.from("cifrado-fake-secret"),
          dekEnvelope: Buffer.from("cifrado-fake-dek"),
          keyVersion: 1,
          last4: "0000"
        },
        tx
      )
    );
    return id;
  }

  beforeAll(async () => {
    db = await startTestDatabase();
    const env = baseEnv(db.ownerUrl);
    env.DATABASE_URL = db.appUrl;
    process.env.DATABASE_URL = db.appUrl;

    const result = await bootstrap(env);
    app = result.app!;
    await app.init();
  }, 180_000);

  afterAll(async () => {
    await app.close();
    await closeDefaultPool();
    await db.close();
  });

  it("liga uma capability a uma conexão compatível", async () => {
    const { tenantId, cookie } = await seedOwner();
    const instanceId = await seedInstance(tenantId, cookie);
    const connectionId = await seedConnection(tenantId, "platform-upload");

    const response = await request(app.getHttpServer())
      .put(`/service-instances/${instanceId}/bindings/file-storage`)
      .set("Cookie", cookie)
      .send({ connectionId });

    expect(response.status).toBe(200);

    const bindings = await withTenant(tenantId, (tx) => listBindingsByInstance(instanceId, tx));
    expect(bindings).toHaveLength(1);
    expect(bindings[0]?.connectionId).toBe(connectionId);
  });

  it("conexão de conector incompatível é recusada, nomeando a incompatibilidade", async () => {
    const { tenantId, cookie } = await seedOwner();
    const instanceId = await seedInstance(tenantId, cookie);
    // gmail satisfaz "email", não "file-storage".
    const connectionId = await seedConnection(tenantId, "gmail");

    const response = await request(app.getHttpServer())
      .put(`/service-instances/${instanceId}/bindings/file-storage`)
      .set("Cookie", cookie)
      .send({ connectionId });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("CAPABILITY_MISMATCH");

    const bindings = await withTenant(tenantId, (tx) => listBindingsByInstance(instanceId, tx));
    expect(bindings).toHaveLength(0);
  });

  it("conexão de outro tenant responde 404, indistinguível de conexão inexistente", async () => {
    const { tenantId: tenantA, cookie: cookieA } = await seedOwner();
    const { tenantId: tenantB } = await seedOwner();
    const instanceId = await seedInstance(tenantA, cookieA);
    const connectionOfB = await seedConnection(tenantB, "platform-upload");

    const responseWithOthersConnection = await request(app.getHttpServer())
      .put(`/service-instances/${instanceId}/bindings/file-storage`)
      .set("Cookie", cookieA)
      .send({ connectionId: connectionOfB });

    const responseWithRandomId = await request(app.getHttpServer())
      .put(`/service-instances/${instanceId}/bindings/file-storage`)
      .set("Cookie", cookieA)
      .send({ connectionId: randomUUID() });

    expect(responseWithOthersConnection.status).toBe(404);
    expect(responseWithRandomId.status).toBe(404);
    expect(responseWithOthersConnection.body).toEqual(responseWithRandomId.body);
  });

  it("ligar a mesma capability de novo substitui, sem criar segunda linha", async () => {
    const { tenantId, cookie } = await seedOwner();
    const instanceId = await seedInstance(tenantId, cookie);
    const connectionId1 = await seedConnection(tenantId, "platform-upload");
    const connectionId2 = await seedConnection(tenantId, "onedrive");

    await request(app.getHttpServer())
      .put(`/service-instances/${instanceId}/bindings/file-storage`)
      .set("Cookie", cookie)
      .send({ connectionId: connectionId1 });
    await request(app.getHttpServer())
      .put(`/service-instances/${instanceId}/bindings/file-storage`)
      .set("Cookie", cookie)
      .send({ connectionId: connectionId2 });

    const bindings = await withTenant(tenantId, (tx) => listBindingsByInstance(instanceId, tx));
    expect(bindings).toHaveLength(1);
    expect(bindings[0]?.connectionId).toBe(connectionId2);
  });

  it("desligar remove o vínculo", async () => {
    const { tenantId, cookie } = await seedOwner();
    const instanceId = await seedInstance(tenantId, cookie);
    const connectionId = await seedConnection(tenantId, "platform-upload");

    await request(app.getHttpServer())
      .put(`/service-instances/${instanceId}/bindings/file-storage`)
      .set("Cookie", cookie)
      .send({ connectionId });

    const deleteResponse = await request(app.getHttpServer())
      .delete(`/service-instances/${instanceId}/bindings/file-storage`)
      .set("Cookie", cookie);
    expect(deleteResponse.status).toBe(204);

    const bindings = await withTenant(tenantId, (tx) => listBindingsByInstance(instanceId, tx));
    expect(bindings).toHaveLength(0);
  });

  it("instância de outro tenant responde 404 ao tentar ligar capability", async () => {
    const { cookie: cookieA } = await seedOwner();
    const { tenantId: tenantB, cookie: cookieB } = await seedOwner();
    const instanceOfB = await seedInstance(tenantB, cookieB);
    const connectionId = await seedConnection(tenantB, "platform-upload");

    const response = await request(app.getHttpServer())
      .put(`/service-instances/${instanceOfB}/bindings/file-storage`)
      .set("Cookie", cookieA)
      .send({ connectionId });

    expect(response.status).toBe(404);
  });

  it("operator recebe 403 (distinto de 401) ao tentar ligar ou desligar capability", async () => {
    const { tenantId, cookie: ownerCookie } = await seedOwner();
    const { cookie: operatorCookie } = await seedOperatorInTenant(tenantId);
    const instanceId = await seedInstance(tenantId, ownerCookie);
    const connectionId = await seedConnection(tenantId, "platform-upload");

    const bindAttempt = await request(app.getHttpServer())
      .put(`/service-instances/${instanceId}/bindings/file-storage`)
      .set("Cookie", operatorCookie)
      .send({ connectionId });
    expect(bindAttempt.status).toBe(403);
    expect(bindAttempt.body.code).toBe("INSUFFICIENT_ROLE");

    // Owner liga de verdade, pra testar a negação do unbind sobre um vínculo real.
    await request(app.getHttpServer())
      .put(`/service-instances/${instanceId}/bindings/file-storage`)
      .set("Cookie", ownerCookie)
      .send({ connectionId });

    const unbindAttempt = await request(app.getHttpServer())
      .delete(`/service-instances/${instanceId}/bindings/file-storage`)
      .set("Cookie", operatorCookie);
    expect(unbindAttempt.status).toBe(403);

    const bindings = await withTenant(tenantId, (tx) => listBindingsByInstance(instanceId, tx));
    expect(bindings).toHaveLength(1); // nenhuma das duas tentativas do operator surtiu efeito
  });
});
