import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import {
  closeDefaultPool,
  withoutTenant,
  withTenant,
  identitySchema,
  insertConnectorConnection,
  listServiceRunsByInstance
} from "@orquestra/db";
import { hashPassword, newId } from "@orquestra/core";
import { bootstrap } from "../../src/bootstrap";
import { createTenantWithOwner } from "../../src/identity/identity.repository";
import { createSession } from "../../src/auth/session.repository";
import { SESSION_COOKIE_NAME } from "../../src/auth/session.guard";
import { startTestDatabase, type TestDatabase } from "../support/test-database";
import { startTestRedis, type TestRedis } from "../support/test-redis";
import { createTestKekDir } from "../support/test-kek";

const PASSWORD = "senha-correta-123";
const PASSWORD_COST = { memoryCost: 1024, timeCost: 2, parallelism: 1 };
const KEK_DIR = createTestKekDir();
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const VALID_CONFIG = { signature: "X", defaultDeadline: "dia 20", defaultCc: [] };

function cookieHeader(token: string): string {
  return `${SESSION_COOKIE_NAME}=${token}`;
}

describe("RunsController", () => {
  let db: TestDatabase;
  let redis: TestRedis;
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

  async function seedInstance(cookie: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post("/service-instances")
      .set("Cookie", cookie)
      .send({ agentKey: "accounting-routine", name: `Instância ${randomUUID()}`, config: VALID_CONFIG });
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

  async function seedActiveInstance(cookie: string, tenantId: string): Promise<string> {
    const instanceId = await seedInstance(cookie);
    const fileStorage = await seedConnection(tenantId, "platform-upload");
    const email = await seedConnection(tenantId, "gmail");
    await request(app.getHttpServer())
      .put(`/service-instances/${instanceId}/bindings/file-storage`)
      .set("Cookie", cookie)
      .send({ connectionId: fileStorage });
    await request(app.getHttpServer())
      .put(`/service-instances/${instanceId}/bindings/email`)
      .set("Cookie", cookie)
      .send({ connectionId: email });
    await request(app.getHttpServer()).post(`/service-instances/${instanceId}/activate`).set("Cookie", cookie);
    return instanceId;
  }

  beforeAll(async () => {
    db = await startTestDatabase();
    redis = await startTestRedis();

    const env: NodeJS.ProcessEnv = {
      DATABASE_URL: db.appUrl,
      DATABASE_MIGRATION_URL: db.ownerUrl,
      REDIS_URL: redis.url,
      SESSION_SECRET: "a".repeat(32),
      API_PORT: "3000",
      PROCESS_ROLE: "api",
      KEK_DIR
    };
    process.env.DATABASE_URL = db.appUrl;

    const result = await bootstrap(env);
    app = result.app!;
    await app.init();
  }, 180_000);

  afterAll(async () => {
    await app.close();
    await closeDefaultPool();
    await db.close();
    await redis.close();
  });

  it("instância active cria run queued e enfileira", async () => {
    const { tenantId, cookie } = await seedOwner();
    const instanceId = await seedActiveInstance(cookie, tenantId);

    const response = await request(app.getHttpServer())
      .post(`/service-instances/${instanceId}/runs`)
      .set("Cookie", cookie);

    expect(response.status).toBe(201);
    expect(response.body.serviceInstanceId).toBe(instanceId);
    expect(response.body.trigger).toBe("manual");
    expect(response.body.status).toBe("queued");
  });

  it("instância em qualquer outro estado recebe 409 nomeando o status atual, sem criar run", async () => {
    const { tenantId, cookie } = await seedOwner();
    const instanceId = await seedInstance(cookie); // fica "installed" — nunca ativada

    const response = await request(app.getHttpServer())
      .post(`/service-instances/${instanceId}/runs`)
      .set("Cookie", cookie);

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("INSTANCE_NOT_ACTIVE");
    expect(response.body.message).toContain("installed");

    const runs = await withTenant(tenantId, (tx) => listServiceRunsByInstance(instanceId, tx));
    expect(runs).toHaveLength(0);
  });

  it("operator recebe 403; owner/admin passam", async () => {
    const { tenantId, cookie: ownerCookie } = await seedOwner();
    const { cookie: operatorCookie } = await seedOperatorInTenant(tenantId);
    const instanceId = await seedActiveInstance(ownerCookie, tenantId);

    const operatorAttempt = await request(app.getHttpServer())
      .post(`/service-instances/${instanceId}/runs`)
      .set("Cookie", operatorCookie);
    expect(operatorAttempt.status).toBe(403);
    expect(operatorAttempt.body.code).toBe("INSUFFICIENT_ROLE");

    const runsAfterDenied = await withTenant(tenantId, (tx) => listServiceRunsByInstance(instanceId, tx));
    expect(runsAfterDenied).toHaveLength(0);

    const ownerAttempt = await request(app.getHttpServer())
      .post(`/service-instances/${instanceId}/runs`)
      .set("Cookie", ownerCookie);
    expect(ownerAttempt.status).toBe(201);
  });
});
