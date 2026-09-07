import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { Client } from "pg";
import { closeDefaultPool } from "@orquestra/db";
import { hashPassword } from "@orquestra/core";
import { bootstrap } from "../src/bootstrap";
import { createTenantWithOwner } from "../src/identity/identity.repository";
import { createSession } from "../src/auth/session.repository";
import { SESSION_COOKIE_NAME } from "../src/auth/session.guard";
import { startTestDatabase, type TestDatabase } from "./support/test-database";
import { createTestKekDir } from "./support/test-kek";
import { assertNoSentinelLeak } from "./support/secret-scan";
import { scanDatabaseForSentinel } from "./support/scan-database-for-sentinel";

const PASSWORD = "senha-correta-123";
const PASSWORD_COST = { memoryCost: 1024, timeCost: 2, parallelism: 1 };
const KEK_DIR = createTestKekDir();
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const SENTINEL = `SENTINELA-${randomUUID()}-NUNCA-DEVE-VAZAR`;

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

describe("gate: contenção de segredo (T23)", () => {
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

  it(
    "o sentinela não aparece em nenhuma resposta HTTP, em nenhum log, nem em nenhuma coluna de texto/jsonb do banco",
    async () => {
      const logSpies = (["log", "warn", "error", "info", "debug"] as const).map((method) =>
        vi.spyOn(console, method).mockImplementation(() => undefined)
      );

      const httpResponses: { label: string; value: unknown }[] = [];
      function record(label: string, body: unknown): void {
        httpResponses.push({ label, value: body });
      }

      try {
        // 1. Cadastro — o segredo entra pela primeira vez, dentro do valor de `auth`.
        const passwordHash = await hashPassword(PASSWORD, PASSWORD_COST);
        const created = await createTenantWithOwner({
          tenantName: `Tenant ${randomUUID()}`,
          email: `owner-${randomUUID()}@exemplo.com`,
          passwordHash
        });
        const session = await createSession({ userId: created.userId, tenantId: created.tenantId, ttlMs: ONE_DAY_MS });
        const cookie = cookieHeader(session.token);

        const createConnectionResponse = await request(app.getHttpServer())
          .post("/connections")
          .set("Cookie", cookie)
          .send({ connectorKey: "platform-upload", name: `Conexão ${randomUUID()}`, auth: { apiKey: SENTINEL } });
        record("POST /connections", createConnectionResponse.body);
        expect(createConnectionResponse.status).toBe(201);
        const connectionId = createConnectionResponse.body.id as string;

        // 2. Listagem.
        const listConnectionsResponse = await request(app.getHttpServer()).get("/connections").set("Cookie", cookie);
        record("GET /connections", listConnectionsResponse.body);

        // 3. Instância + vínculo.
        const instanceResponse = await request(app.getHttpServer())
          .post("/service-instances")
          .set("Cookie", cookie)
          .send({
            agentKey: "accounting-routine",
            name: `Instância ${randomUUID()}`,
            config: { signature: "X", defaultDeadline: "dia 20", defaultCc: [] }
          });
        record("POST /service-instances", instanceResponse.body);
        const instanceId = instanceResponse.body.id as string;

        const emailConnectionResponse = await request(app.getHttpServer())
          .post("/connections")
          .set("Cookie", cookie)
          .send({ connectorKey: "gmail", name: `Email ${randomUUID()}`, auth: { refreshToken: "token-email" } });

        const bindResponse = await request(app.getHttpServer())
          .put(`/service-instances/${instanceId}/bindings/file-storage`)
          .set("Cookie", cookie)
          .send({ connectionId });
        record("PUT bindings/file-storage", bindResponse.body);
        await request(app.getHttpServer())
          .put(`/service-instances/${instanceId}/bindings/email`)
          .set("Cookie", cookie)
          .send({ connectionId: emailConnectionResponse.body.id });

        // 4. Ativação.
        const activateResponse = await request(app.getHttpServer())
          .post(`/service-instances/${instanceId}/activate`)
          .set("Cookie", cookie);
        record("POST activate", activateResponse.body);

        // 5. Erro de validação — manda o sentinela de novo, agora num payload que a
        // API recusa (nome duplicado), pra provar que nem a mensagem de erro ecoa.
        const duplicateResponse = await request(app.getHttpServer())
          .post("/connections")
          .set("Cookie", cookie)
          .send({ connectorKey: "platform-upload", name: createConnectionResponse.body.name, auth: { apiKey: SENTINEL } });
        record("POST /connections (nome duplicado)", duplicateResponse.body);
        expect(duplicateResponse.status).toBe(409);

        const invalidAuthResponse = await request(app.getHttpServer())
          .post("/connections")
          .set("Cookie", cookie)
          .send({ connectorKey: "whatsapp", name: `Conexão ${randomUUID()}`, auth: { phoneNumberId: SENTINEL } });
        record("POST /connections (auth inválida)", invalidAuthResponse.body);
        expect(invalidAuthResponse.status).toBe(422);

        // 6. Substituição de credencial (novo sentinela) e revogação.
        const patchResponse = await request(app.getHttpServer())
          .patch(`/connections/${connectionId}`)
          .set("Cookie", cookie)
          .send({ auth: { apiKey: SENTINEL } });
        record("PATCH /connections/:id", patchResponse.body);

        const revokeResponse = await request(app.getHttpServer())
          .post(`/connections/${connectionId}/revoke`)
          .set("Cookie", cookie);
        record("POST /connections/:id/revoke", revokeResponse.body);

        // --- Varredura 1: respostas HTTP capturadas ---
        assertNoSentinelLeak(httpResponses, SENTINEL);

        // --- Varredura 2: tudo que passou por console.* durante o teste ---
        const logCandidates = logSpies.flatMap((spy, index) =>
          spy.mock.calls.map((call, callIndex) => ({
            label: `console.${(["log", "warn", "error", "info", "debug"] as const)[index]}#${callIndex}`,
            value: call
          }))
        );
        assertNoSentinelLeak(logCandidates, SENTINEL);

        // --- Varredura 3: toda coluna de texto/jsonb de toda tabela do banco ---
        const dbHits = await scanDatabaseForSentinel(introspectionClient, SENTINEL);
        expect(dbHits).toEqual([]);
      } finally {
        logSpies.forEach((spy) => spy.mockRestore());
      }
    },
    30_000
  );
});
