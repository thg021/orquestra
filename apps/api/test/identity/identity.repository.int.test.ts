import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { runMigrations, closeDefaultPool } from "@orquestra/db";
import { DuplicateTenantNameError } from "@orquestra/core";
import {
  findUserByEmail,
  createTenantWithOwner,
  findActiveMembership
} from "../../src/identity/identity.repository";
import { startTestDatabase, type TestDatabase } from "../support/test-database";

describe("identity.repository", () => {
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
    // dados limpos entre testes: trunca as tabelas de identidade via owner
    await db.truncateIdentityTables();
  });

  it("busca por e-mail é insensível a caixa e a espaço nas bordas", async () => {
    await createTenantWithOwner({
      tenantName: "Acme",
      email: "  Ana@Exemplo.com  ",
      passwordHash: "hash-1"
    });

    const found = await findUserByEmail("ana@exemplo.com");
    expect(found).toBeDefined();
    expect(found?.email).toBe("ana@exemplo.com");
  });

  it("e-mail já existente vincula o usuário em vez de duplicar", async () => {
    const first = await createTenantWithOwner({
      tenantName: "Tenant A",
      email: "ana@exemplo.com",
      passwordHash: "hash-1"
    });
    const second = await createTenantWithOwner({
      tenantName: "Tenant B",
      email: "Ana@Exemplo.com",
      passwordHash: "hash-2"
    });

    expect(second.userId).toBe(first.userId);
    expect(second.tenantId).not.toBe(first.tenantId);
  });

  it("nome de tenant duplicado viola a unicidade e é traduzido para DuplicateTenantNameError", async () => {
    await createTenantWithOwner({ tenantName: "Acme", email: "a@b.com", passwordHash: "h" });

    await expect(
      createTenantWithOwner({ tenantName: "Acme", email: "c@d.com", passwordHash: "h2" })
    ).rejects.toBeInstanceOf(DuplicateTenantNameError);
  });

  it("tenant duplicado não deixa usuário novo órfão (transação reverte tudo)", async () => {
    await createTenantWithOwner({ tenantName: "Acme", email: "a@b.com", passwordHash: "h" });

    await expect(
      createTenantWithOwner({ tenantName: "Acme", email: "novo@exemplo.com", passwordHash: "h2" })
    ).rejects.toBeInstanceOf(DuplicateTenantNameError);

    const orphan = await findUserByEmail("novo@exemplo.com");
    expect(orphan).toBeUndefined();
  });

  it("findActiveMembership devolve o vínculo mais antigo de forma determinística", async () => {
    const first = await createTenantWithOwner({
      tenantName: "Primeiro Tenant",
      email: "multi@exemplo.com",
      passwordHash: "h"
    });
    await createTenantWithOwner({
      tenantName: "Segundo Tenant",
      email: "multi@exemplo.com",
      passwordHash: "h"
    });

    const active = await findActiveMembership(first.userId);
    expect(active?.tenantId).toBe(first.tenantId);
    expect(active?.role).toBe("owner");
  });

  it("findActiveMembership devolve undefined para usuário sem nenhum vínculo", async () => {
    const active = await findActiveMembership("00000000-0000-0000-0000-000000000000");
    expect(active).toBeUndefined();
  });
});
