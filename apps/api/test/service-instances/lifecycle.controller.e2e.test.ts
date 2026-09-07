import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { closeDefaultPool, withTenant, insertConnectorConnection } from "@orquestra/db";
import { hashPassword } from "@orquestra/core";
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
const VALID_CONFIG = { signature: "X", defaultDeadline: "dia 20", defaultCc: [] };

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

describe("lifecycle (activate/pause)", () => {
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

  async function seedInstance(cookie: string, config: Record<string, unknown> = VALID_CONFIG): Promise<string> {
    const response = await request(app.getHttpServer())
      .post("/service-instances")
      .set("Cookie", cookie)
      .send({ agentKey: "accounting-routine", name: `Instância ${randomUUID()}`, config });
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

  async function bind(cookie: string, instanceId: string, capability: string, connectionId: string) {
    return request(app.getHttpServer())
      .put(`/service-instances/${instanceId}/bindings/${capability}`)
      .set("Cookie", cookie)
      .send({ connectionId });
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

  it("ativação recusada devolve 409 com a lista de impedimentos codificada", async () => {
    const { cookie } = await seedOwner();
    const instanceId = await seedInstance(cookie);
    // Nenhuma capability ligada: file-storage e email são obrigatórias.

    const response = await request(app.getHttpServer())
      .post(`/service-instances/${instanceId}/activate`)
      .set("Cookie", cookie);

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("ACTIVATION_BLOCKED");
    expect(response.body.impediments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "CAPABILITY_UNBOUND",
          capabilities: expect.arrayContaining(["file-storage", "email"])
        })
      ])
    );
  });

  it("ativa com as obrigatórias ligadas e as opcionais vazias", async () => {
    const { tenantId, cookie } = await seedOwner();
    const instanceId = await seedInstance(cookie);
    const fileStorage = await seedConnection(tenantId, "platform-upload");
    const email = await seedConnection(tenantId, "gmail");
    await bind(cookie, instanceId, "file-storage", fileStorage);
    await bind(cookie, instanceId, "email", email);
    // document-delivery e messaging (opcionais) ficam sem vínculo de propósito.

    const response = await request(app.getHttpServer())
      .post(`/service-instances/${instanceId}/activate`)
      .set("Cookie", cookie);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("active");
  });

  it("pausar preserva config e vínculos, e reativar passa pelo gate de novo", async () => {
    const { tenantId, cookie } = await seedOwner();
    const instanceId = await seedInstance(cookie);
    const fileStorage = await seedConnection(tenantId, "platform-upload");
    const email = await seedConnection(tenantId, "gmail");
    await bind(cookie, instanceId, "file-storage", fileStorage);
    await bind(cookie, instanceId, "email", email);
    await request(app.getHttpServer()).post(`/service-instances/${instanceId}/activate`).set("Cookie", cookie);

    const pauseResponse = await request(app.getHttpServer())
      .post(`/service-instances/${instanceId}/pause`)
      .set("Cookie", cookie);
    expect(pauseResponse.status).toBe(200);
    expect(pauseResponse.body.status).toBe("paused");
    expect(pauseResponse.body.config).toEqual(VALID_CONFIG);

    // Reativar com tudo intacto funciona — prova que pause não apagou vínculo/config.
    const reactivateResponse = await request(app.getHttpServer())
      .post(`/service-instances/${instanceId}/activate`)
      .set("Cookie", cookie);
    expect(reactivateResponse.status).toBe(200);
    expect(reactivateResponse.body.status).toBe("active");
  });

  it("desligar uma capability obrigatória depois de pausar bloqueia a reativação — o gate roda de novo, não é pulado", async () => {
    const { tenantId, cookie } = await seedOwner();
    const instanceId = await seedInstance(cookie);
    const fileStorage = await seedConnection(tenantId, "platform-upload");
    const email = await seedConnection(tenantId, "gmail");
    await bind(cookie, instanceId, "file-storage", fileStorage);
    await bind(cookie, instanceId, "email", email);
    await request(app.getHttpServer()).post(`/service-instances/${instanceId}/activate`).set("Cookie", cookie);
    await request(app.getHttpServer()).post(`/service-instances/${instanceId}/pause`).set("Cookie", cookie);

    await request(app.getHttpServer())
      .delete(`/service-instances/${instanceId}/bindings/email`)
      .set("Cookie", cookie);

    const reactivateResponse = await request(app.getHttpServer())
      .post(`/service-instances/${instanceId}/activate`)
      .set("Cookie", cookie);

    expect(reactivateResponse.status).toBe(409);
    expect(reactivateResponse.body.impediments).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "CAPABILITY_UNBOUND", capabilities: ["email"] })])
    );
  });

  it("config inválida bloqueia a ativação com CONFIG_INVALID entre os impedimentos", async () => {
    // Instala direto no repositório para poder produzir um estado que o endpoint de
    // criação nunca deixaria existir (config já validada na T11) — aqui simulamos uma
    // instância legada cuja config ficou inválida por outro motivo.
    const { tenantId, cookie } = await seedOwner();
    const instanceId = await seedInstance(cookie);
    const fileStorage = await seedConnection(tenantId, "platform-upload");
    const email = await seedConnection(tenantId, "gmail");
    await bind(cookie, instanceId, "file-storage", fileStorage);
    await bind(cookie, instanceId, "email", email);

    // Corrompe a config diretamente no banco, contornando a validação da T11 de propósito.
    const { serviceManagementSchema } = await import("@orquestra/db");
    const { eq } = await import("drizzle-orm");
    await withTenant(tenantId, (tx) =>
      tx
        .update(serviceManagementSchema.serviceInstances)
        .set({ config: { defaultDeadline: "dia 20", defaultCc: [] } }) // falta signature
        .where(eq(serviceManagementSchema.serviceInstances.id, instanceId))
    );

    const response = await request(app.getHttpServer())
      .post(`/service-instances/${instanceId}/activate`)
      .set("Cookie", cookie);

    expect(response.status).toBe(409);
    expect(response.body.impediments).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "CONFIG_INVALID" })])
    );
  });
});
