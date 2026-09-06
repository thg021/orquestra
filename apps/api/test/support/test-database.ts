import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";

const APP_PASSWORD = "test_app_pw";
const OWNER_PASSWORD = "test_owner_pw";

export interface TestDatabase {
  container: StartedPostgreSqlContainer;
  ownerUrl: string;
  appUrl: string;
  truncateIdentityTables(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Réplica do harness de packages/db/test/support — cada app/pacote mantém o próprio,
 * em vez de importar por caminho relativo entre pacotes.
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
    async truncateIdentityTables() {
      const client = new Client({ connectionString: ownerUrl });
      await client.connect();
      try {
        await client.query(
          `truncate table memberships, sessions, users, tenants restart identity cascade`
        );
      } finally {
        await client.end();
      }
    },
    async close() {
      await container.stop();
    }
  };
}
