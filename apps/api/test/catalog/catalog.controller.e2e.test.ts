import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { bootstrap } from "../../src/bootstrap";
import { createTestKekDir } from "../support/test-kek";

const KEK_DIR = createTestKekDir();

function baseEnv(): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: "postgres://ignored:ignored@localhost:5432/ignored",
    DATABASE_MIGRATION_URL: "postgres://ignored:ignored@localhost:5432/ignored",
    REDIS_URL: "redis://localhost:6379",
    SESSION_SECRET: "a".repeat(32),
    API_PORT: "3000",
    PROCESS_ROLE: "api",
    KEK_DIR
  };
}

describe("CatalogController", () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("GET /catalog/agents devolve o catálogo com o schema de configuração embutido, sem tocar o banco", async () => {
    // runMigrationsFn nunca conecta de verdade: prova, por construção, que a rota não
    // depende de banco algum (CAT-05) — não é um Postgres real e mesmo assim funciona.
    const result = await bootstrap(baseEnv(), { runMigrationsFn: async () => {} });
    app = result.app;
    await app!.init();

    const response = await request(app!.getHttpServer()).get("/catalog/agents");

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(2);
    const accountingRoutine = response.body.find((a: { key: string }) => a.key === "accounting-routine");
    expect(accountingRoutine.capabilities).toContainEqual({
      capability: "file-storage",
      required: true
    });
    expect(accountingRoutine.configSchema.properties.signature).toBeDefined();
  });

  it("GET /catalog/connectors devolve os seis conectores, com o campo secreto marcado e sem valor algum", async () => {
    const result = await bootstrap(baseEnv(), { runMigrationsFn: async () => {} });
    app = result.app;
    await app!.init();

    const response = await request(app!.getHttpServer()).get("/catalog/connectors");

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(6);

    const fortes = response.body.find((c: { key: string }) => c.key === "fortes-conecta");
    expect(fortes.authSchema.properties.apiKey.secret).toBe(true);
    expect(fortes.authSchema.properties.apiKey.default).toBeUndefined();
    expect(JSON.stringify(fortes)).not.toContain("chave-de-teste");
  });
});
