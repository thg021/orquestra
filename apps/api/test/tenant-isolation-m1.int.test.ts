import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { Client } from "pg";
import { closeDefaultPool } from "@orquestra/db";
import { hashPassword, loadKeks, createVault, OpenError } from "@orquestra/core";
import { bootstrap } from "../src/bootstrap";
import { createTenantWithOwner } from "../src/identity/identity.repository";
import { createSession } from "../src/auth/session.repository";
import { SESSION_COOKIE_NAME } from "../src/auth/session.guard";
import { startTestDatabase, type TestDatabase } from "./support/test-database";
import { createTestKekDir } from "./support/test-kek";

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

/**
 * Gate T24 — as três tabelas novas (`service_instances`, `connector_connections`,
 * `connector_bindings`) já são cobertas automaticamente pelo teste de introspecção
 * de RLS do M0 (`packages/db/test/rls-coverage.int.test.ts`), que varre TODA tabela
 * com coluna `tenant_id` — nada deste arquivo precisou ser editado para o M1 entrar
 * na cobertura. A rotação de ponta a ponta com as duas versões de KEK legíveis já
 * está provada em `apps/api/test/cli/kek-rotate.int.test.ts` (T8, teste "interromper
 * no meio deixa as duas versões convivendo, ambas legíveis"). Este arquivo cobre só
 * o que faltava: uma conexão de verdade, persistida no Postgres, cujo envelope não
 * decifra sob o tenant errado — não apenas em memória (isso o vault.unit.test já
 * prova), mas a partir de bytes reais lidos de volta do banco.
 */
describe("gate: isolamento e criptografia de ponta a ponta (T24)", () => {
  let db: TestDatabase;
  let app: INestApplication;
  let introspectionClient: Client;

  beforeAll(async () => {
    db = await startTestDatabase();
    const env = baseEnv(db.ownerUrl);
    env.DATABASE_URL = db.appUrl;
    process.env.DATABASE_URL = db.appUrl;

    const result = await bootstrap(env);
    app = result.app!;
    await app.init();

    introspectionClient = new Client({ connectionString: db.ownerUrl });
    await introspectionClient.connect();
  }, 180_000);

  afterAll(async () => {
    await introspectionClient.end();
    await app.close();
    await closeDefaultPool();
    await db.close();
  });

  async function seedOwner(): Promise<{ tenantId: string; cookie: string }> {
    const passwordHash = await hashPassword(PASSWORD, PASSWORD_COST);
    const created = await createTenantWithOwner({
      tenantName: `Tenant ${randomUUID()}`,
      email: `owner-${randomUUID()}@exemplo.com`,
      passwordHash
    });
    const session = await createSession({ userId: created.userId, tenantId: created.tenantId, ttlMs: ONE_DAY_MS });
    return { tenantId: created.tenantId, cookie: cookieHeader(session.token) };
  }

  it("uma conexão criada por A é invisível para B via API (RLS), mesmo sabendo o id", async () => {
    const { cookie: cookieA } = await seedOwner();
    const { cookie: cookieB } = await seedOwner();

    const created = await request(app.getHttpServer())
      .post("/connections")
      .set("Cookie", cookieA)
      .send({ connectorKey: "platform-upload", name: `Conexão ${randomUUID()}`, auth: { apiKey: "chave-do-tenant-a" } });

    const listAsB = await request(app.getHttpServer()).get("/connections").set("Cookie", cookieB);
    expect(listAsB.body.map((c: { id: string }) => c.id)).not.toContain(created.body.id);
  });

  it("o envelope de uma conexão persistida no banco não decifra sob outro tenant (AAD amarra o tenant_id)", async () => {
    const { tenantId: tenantA, cookie: cookieA } = await seedOwner();
    const { tenantId: tenantB } = await seedOwner();

    const created = await request(app.getHttpServer())
      .post("/connections")
      .set("Cookie", cookieA)
      .send({ connectorKey: "platform-upload", name: `Conexão ${randomUUID()}`, auth: { apiKey: "chave-9999" } });
    expect(created.status).toBe(201);

    // Lê os bytes reais persistidos, sem passar pelo RLS (papel de operador/backup).
    const { rows } = await introspectionClient.query(
      `select secret_envelope, dek_envelope, key_version, last4 from connector_connections where id = $1`,
      [created.body.id]
    );
    const row = rows[0] as { secret_envelope: Buffer; dek_envelope: Buffer; key_version: number; last4: string };

    const vault = createVault(loadKeks(KEK_DIR));

    // Sob o tenant certo, abre normalmente — prova que os bytes lidos são os de verdade.
    const opened = vault.open(tenantA, created.body.id, {
      secretEnvelope: row.secret_envelope,
      dekEnvelope: row.dek_envelope,
      keyVersion: row.key_version,
      last4: row.last4
    });
    expect(JSON.parse(opened)).toEqual({ apiKey: "chave-9999" });

    // O mesmo envelope, "movido" (reatribuído) para outro tenant, não decifra: o AAD
    // amarra tenantId + connectionId nas duas camadas (DEK e segredo) — D34.
    expect(() =>
      vault.open(tenantB, created.body.id, {
        secretEnvelope: row.secret_envelope,
        dekEnvelope: row.dek_envelope,
        keyVersion: row.key_version,
        last4: row.last4
      })
    ).toThrowError(OpenError);
  });
});
