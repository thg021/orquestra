import { AsyncLocalStorage } from "node:async_hooks";
import type { Pool, PoolClient } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { getDefaultPool } from "./pool";

export type Tx = NodePgDatabase;

const tenantStorage = new AsyncLocalStorage<string>();

/**
 * Lê o tenant do escopo atual, populado por withTenant. É conveniência de aplicação —
 * quem decide o que é visível é a policy de RLS avaliando o setting da transação, não
 * este valor em si.
 */
export function getTenantId(): string {
  const tenantId = tenantStorage.getStore();
  if (!tenantId) {
    throw new Error("Nenhum contexto de tenant ativo. Chame dentro de withTenant().");
  }
  return tenantId;
}

async function runInTransaction<T>(
  pool: Pool,
  fn: (tx: Tx, client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      const result = await fn(drizzle(client), client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    client.release();
  }
}

/**
 * Abre uma transação e estabelece o contexto de tenant com escopo transacional
 * (`set_config('app.tenant_id', $1, true)`, terceiro argumento `true` = local à
 * transação). Como o setting não sobrevive ao fim da transação, o pooling de conexões
 * não vaza contexto entre operações de tenants diferentes (RLS-05).
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: Tx) => Promise<T>,
  pool: Pool = getDefaultPool()
): Promise<T> {
  return runInTransaction(pool, async (tx, client) => {
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    return tenantStorage.run(tenantId, () => fn(tx));
  });
}

/**
 * Abre uma transação sem estabelecer contexto de tenant, para tabelas globais
 * (users, sessions). Tabelas com RLS continuam retornando zero linhas nesse escopo
 * (RLS-04) — esta função não contorna a policy, apenas não a alimenta.
 */
export async function withoutTenant<T>(
  fn: (tx: Tx) => Promise<T>,
  pool: Pool = getDefaultPool()
): Promise<T> {
  return runInTransaction(pool, (tx) => fn(tx));
}
