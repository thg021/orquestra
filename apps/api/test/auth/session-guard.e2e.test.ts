import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Controller, Get, INestApplication, Module, Req } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import type { Request } from "express";
import { runMigrations, closeDefaultPool } from "@orquestra/db";
import { Protected } from "../../src/auth/protected.decorator";
import { getFullAuthContext } from "../../src/auth/auth-context";
import { SESSION_COOKIE_NAME } from "../../src/auth/session.guard";
import { createTenantWithOwner } from "../../src/identity/identity.repository";
import { createSession } from "../../src/auth/session.repository";
import { createUserWithoutMembershipForTest } from "../support/create-orphan-user";
import { startTestDatabase, type TestDatabase } from "../support/test-database";

@Controller("__test")
class TestController {
  @Get("protected")
  @Protected()
  protectedRoute(@Req() req: Request) {
    const ctx = getFullAuthContext(req);
    return { userId: ctx.userId, tenantId: ctx.tenantId, tenantName: ctx.tenantName, role: ctx.role };
  }
}

@Module({ controllers: [TestController] })
class TestModule {}

function cookieHeader(token: string): string {
  return `${SESSION_COOKIE_NAME}=${token}`;
}

describe("SessionGuard + TenantScopeInterceptor", () => {
  let db: TestDatabase;
  let app: INestApplication;

  beforeAll(async () => {
    db = await startTestDatabase();
    await runMigrations({ connectionString: db.ownerUrl });
    process.env.DATABASE_URL = db.appUrl;

    app = await NestFactory.create(TestModule, { logger: false });
    app.use(cookieParser());
    await app.init();
  }, 180_000);

  afterAll(async () => {
    await app.close();
    await closeDefaultPool();
    await db.close();
  });

  beforeEach(async () => {
    await db.truncateIdentityTables();
  });

  it("sem cookie responde 401", async () => {
    const response = await request(app.getHttpServer()).get("/__test/protected");
    expect(response.status).toBe(401);
  });

  it("cookie adulterado responde 401 com o mesmo formato de corpo", async () => {
    const withoutCookie = await request(app.getHttpServer()).get("/__test/protected");
    const withGarbageCookie = await request(app.getHttpServer())
      .get("/__test/protected")
      .set("Cookie", cookieHeader("valor-adulterado-que-nao-existe"));

    expect(withGarbageCookie.status).toBe(401);
    expect(withGarbageCookie.body).toEqual(withoutCookie.body);
  });

  it("sessão expirada responde 401 com o mesmo formato de corpo", async () => {
    const seeded = await createTenantWithOwner({
      tenantName: "Acme",
      email: "a@b.com",
      passwordHash: "hash"
    });
    const expired = await createSession({ userId: seeded.userId, tenantId: seeded.tenantId, ttlMs: -1 });

    const withoutCookie = await request(app.getHttpServer()).get("/__test/protected");
    const withExpiredCookie = await request(app.getHttpServer())
      .get("/__test/protected")
      .set("Cookie", cookieHeader(expired.token));

    expect(withExpiredCookie.status).toBe(401);
    expect(withExpiredCookie.body).toEqual(withoutCookie.body);
  });

  it("usuário sem membership responde 403 com código distinto do 401", async () => {
    const userId = await createUserWithoutMembershipForTest("orfao@exemplo.com", "hash");
    const session = await createSession({
      userId,
      tenantId: "00000000-0000-0000-0000-000000000000",
      ttlMs: 60_000
    });

    const response = await request(app.getHttpServer())
      .get("/__test/protected")
      .set("Cookie", cookieHeader(session.token));

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("NO_MEMBERSHIP");
  });

  it("sessão válida atravessa a rota com o tenant do vínculo mais antigo", async () => {
    const first = await createTenantWithOwner({
      tenantName: "Primeiro",
      email: "multi@exemplo.com",
      passwordHash: "hash"
    });
    await createTenantWithOwner({
      tenantName: "Segundo",
      email: "multi@exemplo.com",
      passwordHash: "hash"
    });
    const session = await createSession({
      userId: first.userId,
      tenantId: first.tenantId,
      ttlMs: 60_000
    });

    const response = await request(app.getHttpServer())
      .get("/__test/protected")
      .set("Cookie", cookieHeader(session.token));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      userId: first.userId,
      tenantId: first.tenantId,
      tenantName: "Primeiro",
      role: "owner"
    });
  });
});
