import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { runMigrations } from "../src/migrate";
import { startTestDatabase, type TestDatabase } from "./support/test-database";

describe("runMigrations", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("aplica as migrações e cria as quatro tabelas de identidade", async () => {
    await runMigrations({ connectionString: db.ownerUrl });

    const client = new Client({ connectionString: db.ownerUrl });
    await client.connect();
    try {
      const { rows } = await client.query<{ table_name: string }>(
        `select table_name from information_schema.tables
         where table_schema = 'public' and table_type = 'BASE TABLE'
         order by table_name`
      );
      const names = rows.map((r) => r.table_name);
      expect(names).toEqual(
        expect.arrayContaining(["tenants", "users", "memberships", "sessions"])
      );
    } finally {
      await client.end();
    }
  });

  it("registra a migração aplicada e não a reaplica numa segunda chamada", async () => {
    await runMigrations({ connectionString: db.ownerUrl });
    await runMigrations({ connectionString: db.ownerUrl });

    const client = new Client({ connectionString: db.ownerUrl });
    await client.connect();
    try {
      const { rows } = await client.query<{ count: string }>(
        `select count(*)::text as count from drizzle.__drizzle_migrations`
      );
      expect(rows[0]?.count).toBe("1");
    } finally {
      await client.end();
    }
  });

  it("cria as chaves estrangeiras de memberships (tenants, users) e sessions (users)", async () => {
    const client = new Client({ connectionString: db.ownerUrl });
    await client.connect();
    try {
      const { rows } = await client.query<{ table_name: string; count: string }>(
        `select tc.table_name, count(*)::text as count
         from information_schema.table_constraints tc
         where tc.constraint_type = 'FOREIGN KEY'
           and tc.table_schema = 'public'
         group by tc.table_name
         order by tc.table_name`
      );
      const counts = Object.fromEntries(rows.map((r) => [r.table_name, r.count]));
      expect(counts).toEqual({ memberships: "2", sessions: "1" });
    } finally {
      await client.end();
    }
  });

  it("migração que falha no meio reverte a transação, sem deixar tabela parcial", async () => {
    const brokenFolder = path.join(__dirname, "fixtures", "broken-migrations");

    await expect(
      runMigrations({ connectionString: db.ownerUrl, migrationsFolder: brokenFolder })
    ).rejects.toThrow();

    const client = new Client({ connectionString: db.ownerUrl });
    await client.connect();
    try {
      const { rows } = await client.query<{ exists: boolean }>(
        `select exists(
           select 1 from information_schema.tables
           where table_schema = 'public' and table_name = 'scratch_ok'
         ) as exists`
      );
      expect(rows[0]?.exists).toBe(false);
    } finally {
      await client.end();
    }
  });

  it("duas execuções concorrentes serializam pelo advisory lock e aplicam cada migração uma única vez", async () => {
    await Promise.all([
      runMigrations({ connectionString: db.ownerUrl }),
      runMigrations({ connectionString: db.ownerUrl })
    ]);

    const client = new Client({ connectionString: db.ownerUrl });
    await client.connect();
    try {
      const { rows } = await client.query<{ count: string }>(
        `select count(*)::text as count from drizzle.__drizzle_migrations`
      );
      expect(rows[0]?.count).toBe("1");
    } finally {
      await client.end();
    }
  });
});
