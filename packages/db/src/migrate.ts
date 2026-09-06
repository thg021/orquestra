import path from "node:path";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate as drizzleMigrate } from "drizzle-orm/node-postgres/migrator";

// Chave arbitrária e estável para o advisory lock de migração. Qualquer bigint serve —
// o valor em si não tem significado, só precisa ser o mesmo em todas as execuções.
const MIGRATION_LOCK_KEY = 823_000_001;

export interface RunMigrationsOptions {
  /** String de conexão do papel com DDL (orquestra_owner). Nunca a de runtime da aplicação. */
  connectionString: string;
  /** Pasta com os arquivos de migração gerados pelo drizzle-kit. */
  migrationsFolder?: string;
}

/**
 * Aplica as migrações pendentes. Serializa execuções concorrentes por advisory lock:
 * a segunda chamada bloqueia até a primeira liberar e, ao rodar, encontra tudo já
 * registrado em drizzle.__drizzle_migrations e não reaplica nada (DATA-01).
 *
 * drizzle-orm agrupa todas as migrações pendentes numa única transação — se qualquer
 * uma falhar, a transação inteira reverte, deixando o banco no estado anterior à
 * execução (DATA-03).
 */
export async function runMigrations(options: RunMigrationsOptions): Promise<void> {
  const client = new Client({ connectionString: options.connectionString });
  await client.connect();

  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    try {
      const db = drizzle(client);
      await drizzleMigrate(db, {
        migrationsFolder: options.migrationsFolder ?? path.join(__dirname, "..", "migrations")
      });
    } finally {
      await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    }
  } finally {
    await client.end();
  }
}
