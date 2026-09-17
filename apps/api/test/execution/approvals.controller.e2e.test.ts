import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import {
  closeDefaultPool,
  withoutTenant,
  withTenant,
  identitySchema,
  insertServiceInstance,
  insertServiceRun,
  transitionServiceRunStatus,
  createApprovalRequest,
  findServiceRunById,
  findApprovalRequestById
} from "@orquestra/db";
import { hashPassword, newId } from "@orquestra/core";
import { bootstrap } from "../../src/bootstrap";
import { createTenantWithOwner } from "../../src/identity/identity.repository";
import { createSession } from "../../src/auth/session.repository";
import { SESSION_COOKIE_NAME } from "../../src/auth/session.guard";
import { createRunQueueConnection, type RunJob } from "../../src/execution/queue";
import { createRunWorker, closeRunWorker } from "../../src/execution/worker";
import { startTestDatabase, type TestDatabase } from "../support/test-database";
import { startTestRedis, type TestRedis } from "../support/test-redis";
import { createTestKekDir } from "../support/test-kek";

const PASSWORD = "senha-correta-123";
const PASSWORD_COST = { memoryCost: 1024, timeCost: 2, parallelism: 1 };
const KEK_DIR = createTestKekDir();
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function cookieHeader(token: string): string {
  return `${SESSION_COOKIE_NAME}=${token}`;
}

describe("ApprovalsController", () => {
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

  /** Seed direto via repositório — não precisa rodar o grafo de verdade até `awaiting_approval` (padrão já usado em `approval.service.int.test.ts`). */
  async function seedAwaitingApproval(
    tenantId: string,
    payload: unknown = { plan: "entregar 1 item de exercício" }
  ): Promise<{ runId: string; approvalId: string }> {
    const instanceId = randomUUID();
    await withTenant(tenantId, (tx) =>
      insertServiceInstance(
        { id: instanceId, tenantId, agentKey: "exercise", agentVersion: "1.0.0", name: `Instância ${instanceId}` },
        tx
      )
    );
    const runId = randomUUID();
    await withTenant(tenantId, (tx) =>
      insertServiceRun({ id: runId, tenantId, serviceInstanceId: instanceId, trigger: "manual" }, tx)
    );
    await withTenant(tenantId, (tx) => transitionServiceRunStatus(runId, "running", tx));
    await withTenant(tenantId, (tx) => transitionServiceRunStatus(runId, "awaiting_approval", tx));
    const approvalId = randomUUID();
    await withTenant(tenantId, (tx) => createApprovalRequest({ id: approvalId, tenantId, runId, payload }, tx));
    return { runId, approvalId };
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

  it("aprovar registra quem e quando, e reenfileira o run", async () => {
    const { tenantId, cookie } = await seedOwner();
    const { runId, approvalId } = await seedAwaitingApproval(tenantId);

    // Consumidor próprio, só para observar o que chega na fila — não processa de verdade.
    const received: RunJob[] = [];
    const workerConnection = createRunQueueConnection(redis.url);
    const worker = createRunWorker(workerConnection, async (job) => {
      received.push(job.data);
    });
    const jobArrived = new Promise<void>((resolve) => worker.on("completed", () => resolve()));

    const response = await request(app.getHttpServer())
      .post(`/approvals/${approvalId}/approve`)
      .set("Cookie", cookie);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("approved");
    expect(response.body.decidedAt).not.toBeNull();

    await jobArrived;
    await closeRunWorker(worker);
    workerConnection.disconnect();

    expect(received).toContainEqual(expect.objectContaining({ tenantId, runId }));

    const approval = await withTenant(tenantId, (tx) => findApprovalRequestById(approvalId, tx));
    expect(approval?.status).toBe("approved");
    expect(approval?.decidedAt).not.toBeNull();
  });

  it("recusar encerra o run sem executar o pendente, registrando quem e quando", async () => {
    const { tenantId, cookie } = await seedOwner();
    const { runId, approvalId } = await seedAwaitingApproval(tenantId);

    const response = await request(app.getHttpServer())
      .post(`/approvals/${approvalId}/reject`)
      .set("Cookie", cookie);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("rejected");
    expect(response.body.decidedAt).not.toBeNull();

    const run = await withTenant(tenantId, (tx) => findServiceRunById(runId, tx));
    expect(run?.status).toBe("failed");

    const approval = await withTenant(tenantId, (tx) => findApprovalRequestById(approvalId, tx));
    expect(approval?.status).toBe("rejected");
  });

  it("segunda decisão sobre o mesmo pedido recebe 409 e não tem efeito", async () => {
    const { tenantId, cookie } = await seedOwner();
    const { approvalId } = await seedAwaitingApproval(tenantId);

    const first = await request(app.getHttpServer()).post(`/approvals/${approvalId}/reject`).set("Cookie", cookie);
    expect(first.status).toBe(200);
    const decidedAtAfterFirst = first.body.decidedAt;

    const second = await request(app.getHttpServer()).post(`/approvals/${approvalId}/approve`).set("Cookie", cookie);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("APPROVAL_ALREADY_DECIDED");

    const approval = await withTenant(tenantId, (tx) => findApprovalRequestById(approvalId, tx));
    expect(approval?.status).toBe("rejected");
    expect(approval?.decidedAt?.toISOString()).toBe(decidedAtAfterFirst);
  });

  it("operator recebe 403 ao decidir, e 200 ao listar", async () => {
    const { tenantId, cookie: ownerCookie } = await seedOwner();
    const { cookie: operatorCookie } = await seedOperatorInTenant(tenantId);
    const { approvalId } = await seedAwaitingApproval(tenantId);

    const list = await request(app.getHttpServer()).get("/approvals").set("Cookie", operatorCookie);
    expect(list.status).toBe(200);
    expect(list.body.some((item: { id: string }) => item.id === approvalId)).toBe(true);

    const decideAttempt = await request(app.getHttpServer())
      .post(`/approvals/${approvalId}/approve`)
      .set("Cookie", operatorCookie);
    expect(decideAttempt.status).toBe(403);
    expect(decideAttempt.body.code).toBe("INSUFFICIENT_ROLE");

    const approval = await withTenant(tenantId, (tx) => findApprovalRequestById(approvalId, tx));
    expect(approval?.status).toBe("pending");

    const ownerAttempt = await request(app.getHttpServer())
      .post(`/approvals/${approvalId}/reject`)
      .set("Cookie", ownerCookie);
    expect(ownerAttempt.status).toBe(200);
  });

  it("aprovação de outro tenant responde 404, indistinguível de inexistente", async () => {
    const { cookie: ownerACookie } = await seedOwner();
    const { tenantId: tenantB } = await seedOwner();
    const { approvalId } = await seedAwaitingApproval(tenantB);

    const crossTenant = await request(app.getHttpServer())
      .post(`/approvals/${approvalId}/approve`)
      .set("Cookie", ownerACookie);
    expect(crossTenant.status).toBe(404);
    expect(crossTenant.body.code).toBe("APPROVAL_REQUEST_NOT_FOUND");

    const nonExistent = await request(app.getHttpServer())
      .post(`/approvals/${randomUUID()}/approve`)
      .set("Cookie", ownerACookie);
    expect(nonExistent.status).toBe(404);
    expect(nonExistent.body.code).toBe("APPROVAL_REQUEST_NOT_FOUND");
  });
});
