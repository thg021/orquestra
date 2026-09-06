import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";

const APP_PASSWORD = "test_app_pw";
const OWNER_PASSWORD = "test_owner_pw";

export interface TestDatabase {
  container: StartedPostgreSqlContainer;
  /** Conexão como orquestra_owner — DDL, migrações. */
  ownerUrl: string;
  /** Conexão como orquestra_app — DML apenas, NOBYPASSRLS. Espelha o runtime da aplicação. */
  appUrl: string;
  close(): Promise<void>;
}

/**
 * Sobe um Postgres descartável e replica o bootstrap de papéis do docker/postgres/init.sh
 * (orquestra_owner + orquestra_app, default privileges, extensão citext), para que os
 * testes de integração exerçam o mesmo isolamento que a aplicação real usa em runtime.
 */
export async function startTestDatabase(): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer("postgres:17-alpine")
    .withUsername("orquestra_owner")
    .withPassword(OWNER_PASSWORD)
    .withDatabase("orquestra_test")
    .start();

  const ownerUrl = container.getConnectionUri();
  const appUrl = ownerUrl.replace(
    `orquestra_owner:${OWNER_PASSWORD}`,
    `orquestra_app:${APP_PASSWORD}`
  );

  const ownerClient = new Client({ connectionString: ownerUrl });
  await ownerClient.connect();
  try {
    await ownerClient.query(`
      CREATE ROLE orquestra_app LOGIN PASSWORD '${APP_PASSWORD}'
        NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
      GRANT USAGE ON SCHEMA public TO orquestra_app;
      ALTER DEFAULT PRIVILEGES FOR ROLE orquestra_owner IN SCHEMA public
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO orquestra_app;
      ALTER DEFAULT PRIVILEGES FOR ROLE orquestra_owner IN SCHEMA public
        GRANT USAGE, SELECT ON SEQUENCES TO orquestra_app;
      CREATE EXTENSION IF NOT EXISTS citext;
    `);
  } finally {
    await ownerClient.end();
  }

  return {
    container,
    ownerUrl,
    appUrl,
    async close() {
      await container.stop();
    }
  };
}
