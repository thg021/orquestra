import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { closeDefaultPool, withoutTenant, identitySchema } from "@orquestra/db";
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

describe("ConnectionsController", () => {
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

  it("cria conexão separando segredo (cofre) de metadado, e a resposta não tem campo de segredo", async () => {
    const { cookie } = await seedOwner();

    const response = await request(app.getHttpServer())
      .post("/connections")
      .set("Cookie", cookie)
      .send({
        connectorKey: "whatsapp",
        name: `Conexão ${randomUUID()}`,
        auth: { accessToken: "token-secreto-9999", phoneNumberId: "5511999999999" }
      });

    expect(response.status).toBe(201);
    expect(response.body.metadata).toEqual({ phoneNumberId: "5511999999999" });
    expect(response.body.last4).toBe("9999");
    expect(response.body).not.toHaveProperty("auth");
    expect(response.body).not.toHaveProperty("secretEnvelope");
    expect(response.body).not.toHaveProperty("dekEnvelope");
    expect(JSON.stringify(response.body)).not.toContain("token-secreto-9999");
  });

  it("lista conexões do tenant, sem segredo em nenhuma delas", async () => {
    const { cookie } = await seedOwner();
    await request(app.getHttpServer())
      .post("/connections")
      .set("Cookie", cookie)
      .send({ connectorKey: "platform-upload", name: `Conexão ${randomUUID()}`, auth: { apiKey: "chave-abc123" } });

    const response = await request(app.getHttpServer()).get("/connections").set("Cookie", cookie);

    expect(response.status).toBe(200);
    expect(response.body.length).toBeGreaterThan(0);
    expect(JSON.stringify(response.body)).not.toContain("chave-abc123");
  });

  it("connectorKey inexistente recebe 404 CONNECTOR_NOT_FOUND", async () => {
    const { cookie } = await seedOwner();

    const response = await request(app.getHttpServer())
      .post("/connections")
      .set("Cookie", cookie)
      .send({ connectorKey: "nao-existe", name: "X", auth: {} });

    expect(response.status).toBe(404);
    expect(response.body.code).toBe("CONNECTOR_NOT_FOUND");
  });

  it("nome duplicado no mesmo conector é recusado (409), sem duplicar a linha", async () => {
    const { cookie } = await seedOwner();
    const name = `Conexão ${randomUUID()}`;

    const first = await request(app.getHttpServer())
      .post("/connections")
      .set("Cookie", cookie)
      .send({ connectorKey: "platform-upload", name, auth: { apiKey: "chave-primeira" } });
    expect(first.status).toBe(201);

    const second = await request(app.getHttpServer())
      .post("/connections")
      .set("Cookie", cookie)
      .send({ connectorKey: "platform-upload", name, auth: { apiKey: "chave-segunda" } });

    expect(second.status).toBe(409);
    expect(second.body.code).toBe("CONNECTION_NAME_DUPLICATE");

    const list = await request(app.getHttpServer()).get("/connections").set("Cookie", cookie);
    expect(list.body.filter((c: { name: string }) => c.name === name)).toHaveLength(1);
  });

  it("auth inválida (campo de segredo ausente) recebe 422 com os campos", async () => {
    const { cookie } = await seedOwner();

    const response = await request(app.getHttpServer())
      .post("/connections")
      .set("Cookie", cookie)
      .send({ connectorKey: "platform-upload", name: `Conexão ${randomUUID()}`, auth: {} });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe("AUTH_INVALID");
    expect(response.body.fields).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "apiKey" })])
    );
  });

  it("PATCH substitui o segredo mantendo nome e id (T17, ROT-03)", async () => {
    const { cookie } = await seedOwner();
    const name = `Conexão ${randomUUID()}`;

    const created = await request(app.getHttpServer())
      .post("/connections")
      .set("Cookie", cookie)
      .send({ connectorKey: "platform-upload", name, auth: { apiKey: "chave-original-1111" } });

    const patched = await request(app.getHttpServer())
      .patch(`/connections/${created.body.id}`)
      .set("Cookie", cookie)
      .send({ auth: { apiKey: "chave-nova-2222" } });

    expect(patched.status).toBe(200);
    expect(patched.body.id).toBe(created.body.id);
    expect(patched.body.name).toBe(name);
    expect(patched.body.last4).toBe("2222");
    expect(JSON.stringify(patched.body)).not.toContain("chave-nova-2222");
  });

  it("revoga sem bloqueio, pausa instância que perdeu capability obrigatória e mantém ativa a que perdeu opcional", async () => {
    const { cookie } = await seedOwner();

    const connection = await request(app.getHttpServer())
      .post("/connections")
      .set("Cookie", cookie)
      .send({ connectorKey: "platform-upload", name: `Conexão ${randomUUID()}`, auth: { apiKey: "chave-req" } });
    const email = await request(app.getHttpServer())
      .post("/connections")
      .set("Cookie", cookie)
      .send({ connectorKey: "gmail", name: `Email ${randomUUID()}`, auth: { refreshToken: "token-req" } });

    const instance = await request(app.getHttpServer())
      .post("/service-instances")
      .set("Cookie", cookie)
      .send({
        agentKey: "accounting-routine",
        name: `Instância ${randomUUID()}`,
        config: { signature: "X", defaultDeadline: "dia 20", defaultCc: [] }
      });

    await request(app.getHttpServer())
      .put(`/service-instances/${instance.body.id}/bindings/file-storage`)
      .set("Cookie", cookie)
      .send({ connectionId: connection.body.id });
    await request(app.getHttpServer())
      .put(`/service-instances/${instance.body.id}/bindings/email`)
      .set("Cookie", cookie)
      .send({ connectionId: email.body.id });

    await request(app.getHttpServer()).post(`/service-instances/${instance.body.id}/activate`).set("Cookie", cookie);

    const revokeResponse = await request(app.getHttpServer())
      .post(`/connections/${connection.body.id}/revoke`)
      .set("Cookie", cookie);
    expect(revokeResponse.status).toBe(200);
    expect(revokeResponse.body.status).toBe("revoked");
    expect(revokeResponse.body.pausedInstanceCount).toBe(1);

    const pausedInstance = await request(app.getHttpServer())
      .get(`/service-instances/${instance.body.id}`)
      .set("Cookie", cookie);
    expect(pausedInstance.body.status).toBe("paused");
    expect(pausedInstance.body.statusReason).toBe("conexão revogada");
  });

  it("revoga uma conexão ligada só a capability opcional, e a instância segue ativa", async () => {
    const { cookie } = await seedOwner();

    const fileStorage = await request(app.getHttpServer())
      .post("/connections")
      .set("Cookie", cookie)
      .send({ connectorKey: "platform-upload", name: `Conexão ${randomUUID()}`, auth: { apiKey: "chave-req-2" } });
    const email = await request(app.getHttpServer())
      .post("/connections")
      .set("Cookie", cookie)
      .send({ connectorKey: "gmail", name: `Email ${randomUUID()}`, auth: { refreshToken: "token-req-2" } });
    // document-delivery é opcional para o agente contábil.
    const documentDelivery = await request(app.getHttpServer())
      .post("/connections")
      .set("Cookie", cookie)
      .send({
        connectorKey: "fortes-conecta",
        name: `Fortes ${randomUUID()}`,
        auth: { baseUrl: "https://conecta.fortestecnologia.com.br", apiKey: "chave-opcional" }
      });

    const instance = await request(app.getHttpServer())
      .post("/service-instances")
      .set("Cookie", cookie)
      .send({
        agentKey: "accounting-routine",
        name: `Instância ${randomUUID()}`,
        config: { signature: "X", defaultDeadline: "dia 20", defaultCc: [] }
      });

    await request(app.getHttpServer())
      .put(`/service-instances/${instance.body.id}/bindings/file-storage`)
      .set("Cookie", cookie)
      .send({ connectionId: fileStorage.body.id });
    await request(app.getHttpServer())
      .put(`/service-instances/${instance.body.id}/bindings/email`)
      .set("Cookie", cookie)
      .send({ connectionId: email.body.id });
    await request(app.getHttpServer())
      .put(`/service-instances/${instance.body.id}/bindings/document-delivery`)
      .set("Cookie", cookie)
      .send({ connectionId: documentDelivery.body.id });

    await request(app.getHttpServer()).post(`/service-instances/${instance.body.id}/activate`).set("Cookie", cookie);

    const revokeOptional = await request(app.getHttpServer())
      .post(`/connections/${documentDelivery.body.id}/revoke`)
      .set("Cookie", cookie);
    expect(revokeOptional.body.pausedInstanceCount).toBe(0);

    const stillActive = await request(app.getHttpServer())
      .get(`/service-instances/${instance.body.id}`)
      .set("Cookie", cookie);
    expect(stillActive.body.status).toBe("active");
  });

  it("check grava unverified e a data, e ela aparece na listagem (T18)", async () => {
    const { cookie } = await seedOwner();
    const created = await request(app.getHttpServer())
      .post("/connections")
      .set("Cookie", cookie)
      .send({ connectorKey: "platform-upload", name: `Conexão ${randomUUID()}`, auth: { apiKey: "chave-check" } });
    expect(created.body.lastCheckStatus).toBe("unverified");
    expect(created.body.lastCheckAt).toBeNull();

    const checked = await request(app.getHttpServer())
      .post(`/connections/${created.body.id}/check`)
      .set("Cookie", cookie);
    expect(checked.status).toBe(200);
    expect(checked.body.lastCheckStatus).toBe("unverified");
    expect(checked.body.lastCheckAt).not.toBeNull();

    const list = await request(app.getHttpServer()).get("/connections").set("Cookie", cookie);
    const listed = list.body.find((c: { id: string }) => c.id === created.body.id);
    expect(listed.lastCheckStatus).toBe("unverified");
    expect(listed.lastCheckAt).toBe(checked.body.lastCheckAt);
  });

  it("operator recebe 403 ao criar, e 200 ao listar", async () => {
    const { tenantId } = await seedOwner();
    const { cookie: operatorCookie } = await seedOperatorInTenant(tenantId);

    const createAttempt = await request(app.getHttpServer())
      .post("/connections")
      .set("Cookie", operatorCookie)
      .send({ connectorKey: "platform-upload", name: `Conexão ${randomUUID()}`, auth: { apiKey: "chave-op" } });
    expect(createAttempt.status).toBe(403);
    expect(createAttempt.body.code).toBe("INSUFFICIENT_ROLE");

    const listAttempt = await request(app.getHttpServer()).get("/connections").set("Cookie", operatorCookie);
    expect(listAttempt.status).toBe(200);
  });
});
