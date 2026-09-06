import { Pool, type PoolConfig } from "pg";

export function createAppPool(config: PoolConfig): Pool {
  return new Pool(config);
}

let defaultPool: Pool | undefined;

/**
 * Pool de conexão da aplicação (orquestra_app). Não é exportado pelo índice público
 * do pacote — o único acesso a dado de tenant é por withTenant/withoutTenant.
 */
export function getDefaultPool(): Pool {
  if (!defaultPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL não definida. Esta é a conexão de runtime (orquestra_app), distinta de DATABASE_MIGRATION_URL."
      );
    }
    defaultPool = createAppPool({ connectionString });
  }
  return defaultPool;
}

export async function closeDefaultPool(): Promise<void> {
  if (defaultPool) {
    await defaultPool.end();
    defaultPool = undefined;
  }
}
