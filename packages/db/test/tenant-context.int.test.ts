import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import { withTenant, withoutTenant, getTenantId } from "../src/tenant-context";
import { startTestDatabase, type TestDatabase } from "./support/test-database";
import * as indexExports from "../src/index";

describe("withTenant / withoutTenant", () => {
  let db: TestDatabase;
  let pool: Pool;

  beforeAll(async () => {
    db = await startTestDatabase();
    pool = new Pool({ connectionString: db.appUrl });
  }, 180_000);

  afterAll(async () => {
    await pool.end();
    await db.close();
  });

  it("estabelece o setting no escopo da transação e o commit encerra o contexto", async () => {
    const seen = await withTenant(
      "11111111-1111-1111-1111-111111111111",
      async (tx) => {
        const result = await tx.execute(sql`select current_setting('app.tenant_id', true) as value`);
        return (result.rows[0] as { value: string }).value;
      },
      pool
    );
    expect(seen).toBe("11111111-1111-1111-1111-111111111111");

    const afterCommit = await pool.query<{ value: string | null }>(
      "select current_setting('app.tenant_id', true) as value"
    );
    expect(afterCommit.rows[0]?.value).toBe("");
  });

  it("getTenantId() lança quando chamado fora de withTenant", () => {
    expect(() => getTenantId()).toThrow();
  });

  it("getTenantId() resolve dentro de withTenant e não vaza para withoutTenant", async () => {
    await withTenant(
      "22222222-2222-2222-2222-222222222222",
      async () => {
        expect(getTenantId()).toBe("22222222-2222-2222-2222-222222222222");
      },
      pool
    );

    await withoutTenant(async () => {
      expect(() => getTenantId()).toThrow();
    }, pool);
  });

  it("com pool max: 1, operações alternando tenant A e B não vazam contexto entre transações", async () => {
    const smallPool = new Pool({ connectionString: db.appUrl, max: 1 });
    try {
      const tenantA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
      const tenantB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

      for (let i = 0; i < 5; i += 1) {
        const seenA = await withTenant(
          tenantA,
          async (tx) => {
            const r = await tx.execute(sql`select current_setting('app.tenant_id', true) as value`);
            return (r.rows[0] as { value: string }).value;
          },
          smallPool
        );
        expect(seenA).toBe(tenantA);

        const seenB = await withTenant(
          tenantB,
          async (tx) => {
            const r = await tx.execute(sql`select current_setting('app.tenant_id', true) as value`);
            return (r.rows[0] as { value: string }).value;
          },
          smallPool
        );
        expect(seenB).toBe(tenantB);
      }
    } finally {
      await smallPool.end();
    }
  });

  it("o pool não é exportado no índice público do pacote", () => {
    expect("getDefaultPool" in indexExports).toBe(false);
    expect("createAppPool" in indexExports).toBe(false);
  });
});
