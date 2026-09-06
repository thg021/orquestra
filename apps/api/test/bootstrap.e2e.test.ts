import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import { bootstrap } from "../src/bootstrap";
import { InvalidConfigError } from "../src/config/load-config";

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

describe("bootstrap", () => {
  let container: StartedPostgreSqlContainer | undefined;

  afterEach(async () => {
    if (container) {
      await container.stop();
      container = undefined;
    }
  });

  it(
    "/health/ready só responde pronto depois das migrações aplicadas",
    async () => {
      container = await new PostgreSqlContainer("postgres:17-alpine").start();
      const connectionUri = container.getConnectionUri();

      const extensionClient = new Client({ connectionString: connectionUri });
      await extensionClient.connect();
      await extensionClient.query("create extension if not exists citext");
      await extensionClient.end();

      const env = baseEnv(connectionUri);

      const result = await bootstrap(env);
      expect(result.app).toBeDefined();

      await result.app!.init();
      const response = await request(result.app!.getHttpServer()).get("/health/ready");
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: "ok" });

      const liveResponse = await request(result.app!.getHttpServer()).get("/health/live");
      expect(liveResponse.status).toBe(200);

      await result.app!.close();
    },
    180_000
  );

  it("variável faltante encerra a inicialização sem tentar conectar ao banco", async () => {
    const incomplete = baseEnv("postgres://ignored");
    delete (incomplete as Partial<NodeJS.ProcessEnv>).DATABASE_URL;
    let runMigrationsCalled = false;

    await expect(
      bootstrap(incomplete, {
        runMigrationsFn: async () => {
          runMigrationsCalled = true;
        }
      })
    ).rejects.toBeInstanceOf(InvalidConfigError);

    expect(runMigrationsCalled).toBe(false);
  });

  it("Postgres indisponível gera retry com backoff e, esgotado o limite, rejeita", async () => {
    let attempts = 0;
    const env = baseEnv("postgres://ignored:ignored@localhost:1/ignored");

    await expect(
      bootstrap(env, {
        maxMigrationRetries: 3,
        retryDelayMs: 1,
        runMigrationsFn: async () => {
          attempts += 1;
          throw new Error("postgres indisponível (simulado)");
        }
      })
    ).rejects.toThrow("postgres indisponível (simulado)");

    expect(attempts).toBe(3);
  });

  it('PROCESS_ROLE=worker sobe sem registrar rotas HTTP', async () => {
    const env = { ...baseEnv("postgres://ignored"), PROCESS_ROLE: "worker" };

    const result = await bootstrap(env, {
      runMigrationsFn: async () => {}
    });

    expect(result.app).toBeUndefined();
    expect(result.config.PROCESS_ROLE).toBe("worker");
  });
});
