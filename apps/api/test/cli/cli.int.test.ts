import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { runMigrations, closeDefaultPool } from "@orquestra/db";
import { verifyPassword, DuplicateTenantNameError, WeakPasswordError, UserNotFoundError } from "@orquestra/core";
import { runTenantCreate } from "../../src/cli/commands/tenant-create";
import { runUserResetPassword } from "../../src/cli/commands/user-reset-password";
import { findUserByEmail } from "../../src/identity/identity.repository";
import { startTestDatabase, type TestDatabase } from "../support/test-database";

describe("CLI do operador", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
    await runMigrations({ connectionString: db.ownerUrl });
    process.env.DATABASE_URL = db.appUrl;
  }, 180_000);

  afterAll(async () => {
    await closeDefaultPool();
    await db.close();
  });

  beforeEach(async () => {
    await db.truncateIdentityTables();
  });

  it("tenant:create cria tenant, usuário e membership owner numa transação", async () => {
    const result = await runTenantCreate({
      name: "Acme",
      email: "owner@exemplo.com",
      password: "senha-com-doze-chars"
    });

    expect(result.tenantId).toBeDefined();
    expect(result.userId).toBeDefined();

    const user = await findUserByEmail("owner@exemplo.com");
    expect(user).toBeDefined();
  });

  it("e-mail já existente (normalizado) vincula o usuário em vez de duplicar", async () => {
    const first = await runTenantCreate({
      name: "Tenant A",
      email: "dono@exemplo.com",
      password: "senha-com-doze-chars"
    });
    const second = await runTenantCreate({
      name: "Tenant B",
      email: "Dono@Exemplo.com",
      password: "outra-senha-valida"
    });

    expect(second.userId).toBe(first.userId);
  });

  it("nome de tenant duplicado recusa com DuplicateTenantNameError e não escreve nada", async () => {
    await runTenantCreate({ name: "Acme", email: "a@b.com", password: "senha-com-doze-chars" });

    await expect(
      runTenantCreate({ name: "Acme", email: "novo@exemplo.com", password: "senha-com-doze-chars" })
    ).rejects.toBeInstanceOf(DuplicateTenantNameError);

    const orphan = await findUserByEmail("novo@exemplo.com");
    expect(orphan).toBeUndefined();
  });

  it("senha abaixo do mínimo recusa antes de criar qualquer registro", async () => {
    await expect(
      runTenantCreate({ name: "Acme", email: "a@b.com", password: "curta" })
    ).rejects.toBeInstanceOf(WeakPasswordError);

    const user = await findUserByEmail("a@b.com");
    expect(user).toBeUndefined();
  });

  it("user:reset-password substitui o hash e a senha nova passa a verificar", async () => {
    await runTenantCreate({ name: "Acme", email: "a@b.com", password: "senha-original-123" });

    await runUserResetPassword({ email: "a@b.com", password: "senha-nova-456789" });

    const user = await findUserByEmail("a@b.com");
    expect(await verifyPassword("senha-nova-456789", user!.passwordHash)).toBe(true);
    expect(await verifyPassword("senha-original-123", user!.passwordHash)).toBe(false);
  });

  it("user:reset-password para e-mail inexistente lança UserNotFoundError", async () => {
    await expect(
      runUserResetPassword({ email: "nao-existe@exemplo.com", password: "senha-valida-123" })
    ).rejects.toBeInstanceOf(UserNotFoundError);
  });

  it("a senha não aparece em nenhum campo do resultado ou do erro", async () => {
    const password = "senha-secreta-de-verdade";
    const result = await runTenantCreate({ name: "Acme", email: "a@b.com", password });
    expect(JSON.stringify(result)).not.toContain(password);

    let caught: unknown;
    try {
      await runTenantCreate({ name: "Acme", email: "outro@exemplo.com", password });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DuplicateTenantNameError);
    expect((caught as Error).message).not.toContain(password);
  });
});
