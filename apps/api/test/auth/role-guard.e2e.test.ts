import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Controller, Get, INestApplication, Module, Req } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import type { Request } from "express";
import { eq } from "drizzle-orm";
import { runMigrations, closeDefaultPool, withoutTenant, identitySchema } from "@orquestra/db";
import { newId, LastOwnerError } from "@orquestra/core";
import { RequireRole } from "../../src/auth/role.guard";
import { getFullAuthContext } from "../../src/auth/auth-context";
import { SESSION_COOKIE_NAME } from "../../src/auth/session.guard";
import { createTenantWithOwner } from "../../src/identity/identity.repository";
import { createSession } from "../../src/auth/session.repository";
import { removeMembership, changeMembershipRole } from "../../src/identity/membership.service";
import { startTestDatabase, type TestDatabase } from "../support/test-database";

const { memberships } = identitySchema;

@Controller("__test")
class TestController {
  @Get("owner-only")
  @RequireRole("owner")
  ownerOnly(@Req() req: Request) {
    const ctx = getFullAuthContext(req);
    return { role: ctx.role };
  }

  @Get("admin-or-above")
  @RequireRole("admin")
  adminOrAbove(@Req() req: Request) {
    const ctx = getFullAuthContext(req);
    return { role: ctx.role };
  }
}

@Module({ controllers: [TestController] })
class TestModule {}

function cookieHeader(token: string): string {
  return `${SESSION_COOKIE_NAME}=${token}`;
}

async function addMembership(tenantId: string, userId: string, role: "owner" | "admin" | "operator") {
  const membershipId = newId();
  await withoutTenant(async (tx) => {
    await tx.insert(memberships).values({ id: membershipId, tenantId, userId, role });
  });
  return membershipId;
}

describe("RoleGuard / regra do último owner", () => {
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

  it("papel insuficiente responde 403 de autorização, distinto do 401", async () => {
    const seeded = await createTenantWithOwner({
      tenantName: "Acme",
      email: "operador@exemplo.com",
      passwordHash: "hash"
    });
    // rebaixa o único membership para operator, abrindo espaço pra outro owner não ser exigido aqui
    await withoutTenant((tx) =>
      tx.update(memberships).set({ role: "operator" }).where(eq(memberships.userId, seeded.userId))
    );
    const session = await createSession({ userId: seeded.userId, tenantId: seeded.tenantId, ttlMs: 60_000 });

    const response = await request(app.getHttpServer())
      .get("/__test/owner-only")
      .set("Cookie", cookieHeader(session.token));

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("INSUFFICIENT_ROLE");
  });

  it("papel suficiente atravessa a rota de exemplo", async () => {
    const seeded = await createTenantWithOwner({
      tenantName: "Acme",
      email: "owner@exemplo.com",
      passwordHash: "hash"
    });
    const session = await createSession({ userId: seeded.userId, tenantId: seeded.tenantId, ttlMs: 60_000 });

    const response = await request(app.getHttpServer())
      .get("/__test/owner-only")
      .set("Cookie", cookieHeader(session.token));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ role: "owner" });
  });

  it("rebaixar ou remover o último owner é recusado", async () => {
    const seeded = await createTenantWithOwner({
      tenantName: "Acme",
      email: "owner@exemplo.com",
      passwordHash: "hash"
    });
    const membershipRow = await withoutTenant((tx) =>
      tx.select().from(memberships).where(eq(memberships.userId, seeded.userId))
    );
    const membershipId = membershipRow[0]!.id;

    await expect(changeMembershipRole(membershipId, "admin")).rejects.toBeInstanceOf(LastOwnerError);
    await expect(removeMembership(membershipId)).rejects.toBeInstanceOf(LastOwnerError);
  });

  it("com dois owners, rebaixar ou remover um deles passa", async () => {
    const seeded = await createTenantWithOwner({
      tenantName: "Acme",
      email: "owner1@exemplo.com",
      passwordHash: "hash"
    });
    const secondOwnerUserId = newId();
    await withoutTenant((tx) =>
      tx.insert(identitySchema.users).values({ id: secondOwnerUserId, email: "owner2@exemplo.com", passwordHash: "hash" })
    );
    const secondMembershipId = await addMembership(seeded.tenantId, secondOwnerUserId, "owner");

    await expect(changeMembershipRole(secondMembershipId, "admin")).resolves.toBeUndefined();
  });

  it("admin atravessa admin-or-above mas é recusado em owner-only", async () => {
    const seeded = await createTenantWithOwner({
      tenantName: "Acme",
      email: "admin@exemplo.com",
      passwordHash: "hash"
    });
    await withoutTenant((tx) =>
      tx.update(memberships).set({ role: "admin" }).where(eq(memberships.userId, seeded.userId))
    );
    const session = await createSession({ userId: seeded.userId, tenantId: seeded.tenantId, ttlMs: 60_000 });

    const adminOrAbove = await request(app.getHttpServer())
      .get("/__test/admin-or-above")
      .set("Cookie", cookieHeader(session.token));
    const ownerOnly = await request(app.getHttpServer())
      .get("/__test/owner-only")
      .set("Cookie", cookieHeader(session.token));

    expect(adminOrAbove.status).toBe(200);
    expect(ownerOnly.status).toBe(403);
  });
});
