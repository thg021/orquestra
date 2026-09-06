import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import * as core from "@orquestra/core";
import { InvalidCredentialsError, NoMembershipError } from "@orquestra/core";
import { runMigrations, closeDefaultPool } from "@orquestra/db";
import { login, logout, me } from "../../src/auth/auth.service";
import { createTenantWithOwner } from "../../src/identity/identity.repository";
import { resolveSession } from "../../src/auth/session.repository";
import { startTestDatabase, type TestDatabase } from "../support/test-database";
import { createUserWithoutMembershipForTest } from "../support/create-orphan-user";

describe("auth.service", () => {
  let db: TestDatabase;
  const password = "senha-correta-123";

  beforeAll(async () => {
    db = await startTestDatabase();
    await runMigrations({ connectionString: db.ownerUrl });
    process.env.DATABASE_URL = db.appUrl;
  }, 120_000);

  afterAll(async () => {
    await closeDefaultPool();
    await db.close();
  });

  beforeEach(async () => {
    await db.truncateIdentityTables();
  });

  async function seedUser(email: string) {
    const passwordHash = await core.hashPassword(password, { memoryCost: 1024, timeCost: 2, parallelism: 1 });
    return createTenantWithOwner({ tenantName: `Tenant ${email}`, email, passwordHash });
  }

  it("credencial válida cria sessão e devolve o token cru uma única vez", async () => {
    const seeded = await seedUser("ana@exemplo.com");
    const result = await login("ana@exemplo.com", password);

    expect(result.token).toMatch(/^[0-9a-f]{64}$/);
    expect(result.userId).toBe(seeded.userId);
    expect(result.tenantId).toBe(seeded.tenantId);
    expect(result.role).toBe("owner");

    const resolved = await resolveSession(result.token);
    expect(resolved?.userId).toBe(seeded.userId);
  });

  it("e-mail inexistente e senha errada produzem o mesmo erro, com o mesmo código", async () => {
    await seedUser("ana@exemplo.com");

    let errorForMissingEmail: unknown;
    try {
      await login("nao-existe@exemplo.com", password);
    } catch (error) {
      errorForMissingEmail = error;
    }

    let errorForWrongPassword: unknown;
    try {
      await login("ana@exemplo.com", "senha-errada");
    } catch (error) {
      errorForWrongPassword = error;
    }

    expect(errorForMissingEmail).toBeInstanceOf(InvalidCredentialsError);
    expect(errorForWrongPassword).toBeInstanceOf(InvalidCredentialsError);
    expect((errorForMissingEmail as InvalidCredentialsError).code).toBe(
      (errorForWrongPassword as InvalidCredentialsError).code
    );
  });

  it("e-mail inexistente ainda executa uma verificação contra hash descartável", async () => {
    const verifySpy = vi.spyOn(core, "verifyPassword");

    await expect(login("nao-existe@exemplo.com", password)).rejects.toBeInstanceOf(InvalidCredentialsError);

    expect(verifySpy).toHaveBeenCalledTimes(1);
    verifySpy.mockRestore();
  });

  it("usuário sem vínculo não recebe sessão, mesmo com credencial correta", async () => {
    // usuário criado direto, sem tenant/membership: simula a órfã (edge case teórico,
    // já que createTenantWithOwner sempre cria o vínculo — mas login precisa recusar
    // se, por qualquer razão, o vínculo não existir).
    const passwordHash = await core.hashPassword(password, {
      memoryCost: 1024,
      timeCost: 2,
      parallelism: 1
    });
    await createUserWithoutMembershipForTest("orfao@exemplo.com", passwordHash);

    await expect(login("orfao@exemplo.com", password)).rejects.toBeInstanceOf(NoMembershipError);
  });

  it("logout invalida a sessão no servidor", async () => {
    await seedUser("ana@exemplo.com");
    const result = await login("ana@exemplo.com", password);

    const resolvedBefore = await resolveSession(result.token);
    expect(resolvedBefore).toBeDefined();

    // sessionId não é devolvido por login() (só o token) — resolve pra achar o id.
    const sessionId = resolvedBefore!.sessionId;
    await logout(sessionId);

    const resolvedAfter = await resolveSession(result.token);
    expect(resolvedAfter).toBeUndefined();
  });

  it("me() devolve usuário, tenant ativo e papel", async () => {
    const seeded = await seedUser("ana@exemplo.com");
    const result = await me(seeded.userId);

    expect(result.userEmail).toBe("ana@exemplo.com");
    expect(result.tenantId).toBe(seeded.tenantId);
    expect(result.role).toBe("owner");
  });

  it("me() lança NoMembershipError para usuário inexistente", async () => {
    await expect(me("00000000-0000-0000-0000-000000000000")).rejects.toBeInstanceOf(NoMembershipError);
  });
});
