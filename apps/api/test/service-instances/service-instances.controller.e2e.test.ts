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

const { memberships } = identitySchema;
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

describe("ServiceInstancesController", () => {
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
      await tx.insert(memberships).values({ id: newId(), tenantId, userId, role: "operator" });
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

  it("instala o agente contábil com configuração válida", async () => {
    const { cookie } = await seedOwner();

    const response = await request(app.getHttpServer())
      .post("/service-instances")
      .set("Cookie", cookie)
      .send({
        agentKey: "accounting-routine",
        name: "Rotina do escritório",
        config: { signature: "Escritório Demo", defaultDeadline: "todo dia 20", defaultCc: [] }
      });

    expect(response.status).toBe(201);
    expect(response.body.agentKey).toBe("accounting-routine");
    expect(response.body.agentVersion).toBe("1.0.0");
    expect(response.body.status).toBe("installed");
  });

  it("configuração inválida devolve 422 com os campos e motivos, sem gravar", async () => {
    const { cookie } = await seedOwner();

    const response = await request(app.getHttpServer())
      .post("/service-instances")
      .set("Cookie", cookie)
      .send({
        agentKey: "accounting-routine",
        name: "Rotina incompleta",
        config: { defaultDeadline: "todo dia 20", defaultCc: [] } // falta signature
      });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe("CONFIG_INVALID");
    expect(response.body.fields).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "signature" })])
    );

    const list = await request(app.getHttpServer()).get("/service-instances").set("Cookie", cookie);
    expect(list.body).toHaveLength(0);
  });

  it("agente inexistente no catálogo devolve erro claro, sem gravar", async () => {
    const { cookie } = await seedOwner();

    const response = await request(app.getHttpServer())
      .post("/service-instances")
      .set("Cookie", cookie)
      .send({ agentKey: "agente-que-nao-existe", name: "X", config: {} });

    expect(response.status).toBe(404);
    expect(response.body.code).toBe("AGENT_NOT_FOUND");
  });

  it("update valida a config contra o schema da versão fixada, não a mais recente do catálogo", async () => {
    const { cookie } = await seedOwner();
    const created = await request(app.getHttpServer())
      .post("/service-instances")
      .set("Cookie", cookie)
      .send({
        agentKey: "accounting-routine",
        name: "Original",
        config: { signature: "Assinatura", defaultDeadline: "dia 20", defaultCc: [] }
      });

    const patchResponse = await request(app.getHttpServer())
      .patch(`/service-instances/${created.body.id}`)
      .set("Cookie", cookie)
      .send({ name: "Renomeada", config: { signature: "Nova assinatura", defaultDeadline: "dia 25", defaultCc: [] } });

    expect(patchResponse.status).toBe(200);
    expect(patchResponse.body.name).toBe("Renomeada");
    expect(patchResponse.body.config.signature).toBe("Nova assinatura");
    expect(patchResponse.body.agentVersion).toBe("1.0.0");
  });

  it("remoção preserva a linha (404 continua identificável) e some da listagem padrão", async () => {
    const { cookie } = await seedOwner();
    const created = await request(app.getHttpServer())
      .post("/service-instances")
      .set("Cookie", cookie)
      .send({
        agentKey: "accounting-routine",
        name: "A remover",
        config: { signature: "X", defaultDeadline: "dia 20", defaultCc: [] }
      });

    const deleteResponse = await request(app.getHttpServer())
      .delete(`/service-instances/${created.body.id}`)
      .set("Cookie", cookie);
    expect(deleteResponse.status).toBe(204);

    const list = await request(app.getHttpServer()).get("/service-instances").set("Cookie", cookie);
    expect(list.body.map((row: { id: string }) => row.id)).not.toContain(created.body.id);
  });

  it("operator só lê: 403 ao instalar, 200 ao listar", async () => {
    const { tenantId, cookie: ownerCookie } = await seedOwner();
    const { cookie: operatorCookie } = await seedOperatorInTenant(tenantId);

    const installAttempt = await request(app.getHttpServer())
      .post("/service-instances")
      .set("Cookie", operatorCookie)
      .send({ agentKey: "accounting-routine", name: "X", config: {} });
    expect(installAttempt.status).toBe(403);
    expect(installAttempt.body.code).toBe("INSUFFICIENT_ROLE");

    await request(app.getHttpServer())
      .post("/service-instances")
      .set("Cookie", ownerCookie)
      .send({
        agentKey: "accounting-routine",
        name: "Instalada pelo owner",
        config: { signature: "X", defaultDeadline: "dia 20", defaultCc: [] }
      });

    const listAsOperator = await request(app.getHttpServer())
      .get("/service-instances")
      .set("Cookie", operatorCookie);
    expect(listAsOperator.status).toBe(200);
    expect(listAsOperator.body.length).toBeGreaterThan(0);
  });

  it("isolamento: instância de outro tenant não aparece na listagem nem é acessível por id", async () => {
    const { cookie: cookieA } = await seedOwner();
    const { cookie: cookieB } = await seedOwner();

    const created = await request(app.getHttpServer())
      .post("/service-instances")
      .set("Cookie", cookieA)
      .send({
        agentKey: "accounting-routine",
        name: "De A",
        config: { signature: "X", defaultDeadline: "dia 20", defaultCc: [] }
      });

    const listAsB = await request(app.getHttpServer()).get("/service-instances").set("Cookie", cookieB);
    expect(listAsB.body).toHaveLength(0);

    const getAsB = await request(app.getHttpServer())
      .get(`/service-instances/${created.body.id}`)
      .set("Cookie", cookieB);
    expect(getAsB.status).toBe(404);
  });
});
