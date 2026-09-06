import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Client } from "pg";
import { runMigrations, closeDefaultPool } from "@orquestra/db";
import { newId } from "@orquestra/core";
import { createSession, resolveSession, revokeSession } from "../../src/auth/session.repository";
import { createTenantWithOwner } from "../../src/identity/identity.repository";
import { startTestDatabase, type TestDatabase } from "../support/test-database";

const ONE_HOUR_MS = 60 * 60 * 1000;

describe("session.repository", () => {
  let db: TestDatabase;
  let userId: string;
  let tenantId: string;

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
    const created = await createTenantWithOwner({
      tenantName: "Acme",
      email: "owner@exemplo.com",
      passwordHash: "hash"
    });
    userId = created.userId;
    tenantId = created.tenantId;
  });

  it("a coluna persistida é o hash — o token cru não aparece em nenhuma coluna", async () => {
    const created = await createSession({ userId, tenantId, ttlMs: ONE_HOUR_MS });
    const client = new Client({ connectionString: db.ownerUrl });
    await client.connect();
    try {
      const { rows } = await client.query<{ token_hash: string }>(
        "select token_hash from sessions where id = $1",
        [created.sessionId]
      );
      expect(rows[0]?.token_hash).not.toBe(created.token);
      expect(rows[0]?.token_hash).toHaveLength(64); // sha256 em hex
    } finally {
      await client.end();
    }
  });

  it("resolveSession devolve o vínculo correto para um token válido", async () => {
    const created = await createSession({ userId, tenantId, ttlMs: ONE_HOUR_MS });
    const resolved = await resolveSession(created.token);
    expect(resolved?.userId).toBe(userId);
    expect(resolved?.tenantId).toBe(tenantId);
  });

  it("sessão expirada não resolve, mesmo com token correto", async () => {
    const created = await createSession({ userId, tenantId, ttlMs: -1 });
    const resolved = await resolveSession(created.token);
    expect(resolved).toBeUndefined();
  });

  it("revoke remove a linha e a resolução seguinte falha", async () => {
    const created = await createSession({ userId, tenantId, ttlMs: ONE_HOUR_MS });
    await revokeSession(created.sessionId);
    const resolved = await resolveSession(created.token);
    expect(resolved).toBeUndefined();
  });

  it("token inexistente resolve como ausente, sem lançar", async () => {
    await expect(resolveSession("token-que-nunca-existiu")).resolves.toBeUndefined();
  });

  it("token vazio ou malformado resolve como ausente, sem lançar", async () => {
    await expect(resolveSession("")).resolves.toBeUndefined();
    await expect(resolveSession(newId())).resolves.toBeUndefined();
  });
});
