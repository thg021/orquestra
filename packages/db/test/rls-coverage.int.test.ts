import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { runMigrations } from "../src/migrate";
import { startTestDatabase, type TestDatabase } from "./support/test-database";

/**
 * Tabelas globais que carregam tenant_id por desenho mas são deliberadamente isentas de
 * RLS, porque precisam ser legíveis ANTES de existir contexto de tenant — é a
 * autenticação que produz o contexto (M0 design §Modelo de dados):
 * - memberships: consultado para resolver o tenant ativo do usuário
 * - sessions: consultado para resolver a sessão antes de qualquer coisa
 * Qualquer tabela fora desta lista com coluna tenant_id precisa de RLS completa.
 */
const GLOBAL_TABLES_EXEMPT_FROM_RLS = new Set(["memberships", "sessions"]);

interface TenantTableRow {
  table_name: string;
  relrowsecurity: boolean;
  relforcerowsecurity: boolean;
  policy_count: string;
}

interface CoverageGap {
  table: string;
  missing: string[];
}

async function findRlsCoverageGaps(client: Client): Promise<CoverageGap[]> {
  const { rows } = await client.query<TenantTableRow>(`
    select
      c.relname as table_name,
      c.relrowsecurity as relrowsecurity,
      c.relforcerowsecurity as relforcerowsecurity,
      (
        select count(*)::text from pg_policies p
        where p.schemaname = 'public' and p.tablename = c.relname
      ) as policy_count
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and exists (
        select 1 from information_schema.columns col
        where col.table_schema = 'public'
          and col.table_name = c.relname
          and col.column_name = 'tenant_id'
      )
    order by c.relname
  `);

  const gaps: CoverageGap[] = [];
  for (const row of rows) {
    if (GLOBAL_TABLES_EXEMPT_FROM_RLS.has(row.table_name)) {
      continue;
    }
    const missing: string[] = [];
    if (!row.relrowsecurity) missing.push("ENABLE ROW LEVEL SECURITY");
    if (!row.relforcerowsecurity) missing.push("FORCE ROW LEVEL SECURITY");
    if (Number(row.policy_count) === 0) missing.push("policy");
    if (missing.length > 0) {
      gaps.push({ table: row.table_name, missing });
    }
  }
  return gaps;
}

describe("cobertura de RLS por introspecção", () => {
  let db: TestDatabase;
  let client: Client;

  beforeAll(async () => {
    db = await startTestDatabase();
    await runMigrations({ connectionString: db.ownerUrl });
    client = new Client({ connectionString: db.ownerUrl });
    await client.connect();
  }, 180_000);

  afterAll(async () => {
    await client.end();
    await db.close();
  });

  it("passa com o esquema atual: toda tabela de tenant não isenta tem RLS completa", async () => {
    const gaps = await findRlsCoverageGaps(client);
    expect(gaps, `Tabelas sem cobertura de RLS: ${JSON.stringify(gaps)}`).toEqual([]);
  });

  it("falha nomeando uma tabela criada com tenant_id sem nenhuma proteção de RLS", async () => {
    await client.query(`
      create table "sabotage_no_rls" (
        id uuid primary key,
        tenant_id uuid not null
      )
    `);
    try {
      const gaps = await findRlsCoverageGaps(client);
      const sabotageGap = gaps.find((g) => g.table === "sabotage_no_rls");
      expect(sabotageGap).toBeDefined();
      expect(sabotageGap?.missing).toEqual(
        expect.arrayContaining(["ENABLE ROW LEVEL SECURITY", "FORCE ROW LEVEL SECURITY", "policy"])
      );
    } finally {
      await client.query('drop table "sabotage_no_rls"');
    }
  });

  it("falha nomeando uma tabela com RLS ativada mas sem FORCE e sem policy", async () => {
    await client.query(`
      create table "sabotage_partial_rls" (
        id uuid primary key,
        tenant_id uuid not null
      );
      alter table "sabotage_partial_rls" enable row level security;
    `);
    try {
      const gaps = await findRlsCoverageGaps(client);
      const sabotageGap = gaps.find((g) => g.table === "sabotage_partial_rls");
      expect(sabotageGap).toBeDefined();
      expect(sabotageGap?.missing).toEqual(
        expect.arrayContaining(["FORCE ROW LEVEL SECURITY", "policy"])
      );
      expect(sabotageGap?.missing).not.toContain("ENABLE ROW LEVEL SECURITY");
    } finally {
      await client.query('drop table "sabotage_partial_rls"');
    }
  });
});
