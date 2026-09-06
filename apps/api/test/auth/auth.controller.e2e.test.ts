import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { closeDefaultPool } from "@orquestra/db";
import { bootstrap } from "../../src/bootstrap";
import { createTenantWithOwner } from "../../src/identity/identity.repository";
import { hashPassword } from "@orquestra/core";
import { SESSION_COOKIE_NAME } from "../../src/auth/session.guard";
import { startTestDatabase, type TestDatabase } from "../support/test-database";

const PASSWORD = "senha-correta-123";
const PASSWORD_COST = { memoryCost: 1024, timeCost: 2, parallelism: 1 };

function baseEnv(databaseUrl: string): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: databaseUrl,
    DATABASE_MIGRATION_URL: databaseUrl,
    REDIS_URL: "redis://localhost:6379",
    SESSION_SECRET: "a".repeat(32),
    API_PORT: "3000",
    PROCESS_ROLE: "api"
  };
}

function extractCookie(response: request.Response): string | undefined {
  const raw = response.headers["set-cookie"] as unknown as string[] | undefined;
  return raw?.find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
}

describe("AuthController", () => {
  let db: TestDatabase;
  let app: INestApplication;
  let seedCounter = 0;

  async function seedTenant(): Promise<{ email: string; tenantId: string; userId: string }> {
    seedCounter += 1;
    const email = `usuario${seedCounter}@exemplo.com`;
    const passwordHash = await hashPassword(PASSWORD, PASSWORD_COST);
    const created = await createTenantWithOwner({
      tenantName: `Tenant ${seedCounter}`,
      email,
      passwordHash
    });
    return { email, tenantId: created.tenantId, userId: created.userId };
  }

  beforeAll(async () => {
    db = await startTestDatabase();
    const env = baseEnv(db.ownerUrl);
    // DATABASE_URL usa o app role de verdade, para exercitar RLS/privilégio real.
    env.DATABASE_URL = db.appUrl;
    // Os repositórios usados diretamente pelo teste (seedTenant) leem @orquestra/db's
    // pool default do process.env global, não do objeto `env` passado ao bootstrap.
    process.env.DATABASE_URL = db.appUrl;

    const result = await bootstrap(env);
    app = result.app!;
    await app.init();
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await closeDefaultPool();
    await db.close();
  });

  it("login com credencial válida devolve cookie httpOnly, secure e sameSite, sem token no corpo", async () => {
    const seeded = await seedTenant();
    const response = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: seeded.email, password: PASSWORD });

    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toContain("token");

    const cookie = extractCookie(response);
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it("login devolve user/tenant/role no corpo", async () => {
    const seeded = await seedTenant();
    const response = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: seeded.email, password: PASSWORD });

    expect(response.body).toEqual({
      user: { id: seeded.userId, email: seeded.email },
      tenant: { id: seeded.tenantId, name: expect.any(String) },
      role: "owner"
    });
  });

  it("login com senha errada responde 401 com código estável", async () => {
    const seeded = await seedTenant();
    const response = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: seeded.email, password: "senha-errada" });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ code: "INVALID_CREDENTIALS", message: expect.any(String) });
  });

  it("corpo de requisição inválido (e-mail malformado) responde 400", async () => {
    const response = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "nao-e-email", password: "qualquer" });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it("GET /auth/me com cookie válido devolve o contexto autenticado", async () => {
    const seeded = await seedTenant();
    const loginResponse = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: seeded.email, password: PASSWORD });
    const cookie = extractCookie(loginResponse)!;

    const meResponse = await request(app.getHttpServer()).get("/auth/me").set("Cookie", cookie);

    expect(meResponse.status).toBe(200);
    expect(meResponse.body.user.email).toBe(seeded.email);
    expect(meResponse.body.role).toBe("owner");
  });

  it("GET /auth/me sem cookie responde 401", async () => {
    const response = await request(app.getHttpServer()).get("/auth/me");
    expect(response.status).toBe(401);
  });

  it("após logout, o cookie capturado passa a receber 401 na mesma rota", async () => {
    const seeded = await seedTenant();
    const loginResponse = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: seeded.email, password: PASSWORD });
    const cookie = extractCookie(loginResponse)!;

    const logoutResponse = await request(app.getHttpServer()).post("/auth/logout").set("Cookie", cookie);
    expect(logoutResponse.status).toBe(204);

    const meAfterLogout = await request(app.getHttpServer()).get("/auth/me").set("Cookie", cookie);
    expect(meAfterLogout.status).toBe(401);
  });

  it("acima do limite de tentativas, a resposta é idêntica para senha certa e errada", async () => {
    const seeded = await seedTenant();

    for (let i = 0; i < 5; i += 1) {
      await request(app.getHttpServer())
        .post("/auth/login")
        .send({ email: seeded.email, password: "senha-errada" });
    }

    const withWrongPassword = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: seeded.email, password: "senha-errada" });
    const withCorrectPassword = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: seeded.email, password: PASSWORD });

    expect(withWrongPassword.status).toBe(429);
    expect(withCorrectPassword.status).toBe(429);
    expect(withWrongPassword.body).toEqual(withCorrectPassword.body);
  });

  it("nenhuma resposta de erro contém a senha, hash ou string de conexão", async () => {
    const seeded = await seedTenant();
    const responses = await Promise.all([
      request(app.getHttpServer()).post("/auth/login").send({ email: seeded.email, password: "errada-123" }),
      request(app.getHttpServer()).post("/auth/login").send({ email: "inexistente@exemplo.com", password: PASSWORD }),
      request(app.getHttpServer()).get("/auth/me")
    ]);

    for (const response of responses) {
      const body = JSON.stringify(response.body);
      expect(body).not.toContain(PASSWORD);
      expect(body).not.toContain("errada-123");
      expect(body).not.toContain(db.appUrl);
      expect(body).not.toContain("$argon2");
    }
  });
});
