import type { Client } from "pg";

interface TextColumn {
  table_name: string;
  column_name: string;
}

/**
 * Varre toda coluna de texto/jsonb de toda tabela do schema public por um valor —
 * genérico o bastante para pegar uma tabela nova que ninguém lembrou de excluir da
 * lista (T23). `bytea` fica de fora de propósito: é onde o segredo cifrado mora, e lá
 * o sentinela em texto claro não apareceria de qualquer jeito.
 */
export async function scanDatabaseForSentinel(
  client: Client,
  sentinel: string
): Promise<{ table: string; column: string }[]> {
  const { rows } = await client.query<TextColumn>(`
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'public'
      and data_type in ('text', 'character varying', 'jsonb', 'json')
  `);

  const hits: { table: string; column: string }[] = [];
  for (const { table_name: table, column_name: column } of rows) {
    const result = await client.query(
      `select 1 from "${table}" where "${column}"::text ilike $1 limit 1`,
      [`%${sentinel}%`]
    );
    if ((result.rowCount ?? 0) > 0) {
      hits.push({ table, column });
    }
  }
  return hits;
}
