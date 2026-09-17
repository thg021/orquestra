import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { uuid6, ERROR, type Checkpoint, type CheckpointMetadata } from "@langchain/langgraph-checkpoint";
import { runMigrations } from "../src/migrate";
import { withTenant } from "../src/tenant-context";
import { insertServiceInstance } from "../src/repositories/service-instances.repository";
import { insertServiceRun } from "../src/repositories/service-runs.repository";
import { createCheckpointSaver, UnsupportedCheckpointNamespaceError } from "../src/checkpointer";
import { startTestDatabase, type TestDatabase } from "./support/test-database";

function fixtureCheckpoint(overrides: Partial<Checkpoint> = {}): Checkpoint {
  return {
    v: 4,
    id: uuid6(0),
    ts: new Date().toISOString(),
    channel_values: { greeting: "olá" },
    channel_versions: { greeting: 1 },
    versions_seen: {},
    ...overrides
  };
}

const fixtureMetadata: CheckpointMetadata = { source: "loop", step: 0, parents: {} };

describe("checkpointer (BaseCheckpointSaver sobre graph_checkpoints)", () => {
  let db: TestDatabase;
  let pool: Pool;
  const tenantA = randomUUID();
  const tenantB = randomUUID();

  beforeAll(async () => {
    db = await startTestDatabase();
    await runMigrations({ connectionString: db.ownerUrl });
    pool = new Pool({ connectionString: db.appUrl });
  }, 180_000);

  afterAll(async () => {
    await pool.end();
    await db.close();
  });

  async function seedRun(tenantId: string): Promise<string> {
    const instanceId = randomUUID();
    const runId = randomUUID();
    await withTenant(
      tenantId,
      (tx) =>
        insertServiceInstance(
          { id: instanceId, tenantId, agentKey: "exercise", agentVersion: "1.0.0", name: `Instância ${instanceId}` },
          tx
        ),
      pool
    );
    await withTenant(
      tenantId,
      (tx) => insertServiceRun({ id: runId, tenantId, serviceInstanceId: instanceId, trigger: "manual" }, tx),
      pool
    );
    return runId;
  }

  it("nenhuma tabela da biblioteca aparece no banco depois da migração", async () => {
    const client = await pool.connect();
    try {
      const result = await client.query<{ table_name: string }>(
        `select table_name from information_schema.tables
         where table_schema = 'public'
           and table_name = any($1::text[])`,
        [["checkpoints", "checkpoint_blobs", "checkpoint_writes", "checkpoint_migrations"]]
      );
      expect(result.rows).toHaveLength(0);
    } finally {
      client.release();
    }
  });

  it("ida e volta: grava um checkpoint e lê de volta exatamente o mesmo estado", async () => {
    const runId = await seedRun(tenantA);
    const checkpoint = fixtureCheckpoint({ channel_values: { count: 42, nested: { ok: true } } });

    await withTenant(
      tenantA,
      async (tx) => {
        const saver = createCheckpointSaver(tenantA, tx);
        await saver.put({ configurable: { thread_id: runId } }, checkpoint, fixtureMetadata, {});

        const tuple = await saver.getTuple({ configurable: { thread_id: runId } });
        expect(tuple?.checkpoint).toEqual(checkpoint);
        expect(tuple?.metadata).toEqual(fixtureMetadata);
        expect(tuple?.parentConfig).toBeUndefined();
      },
      pool
    );
  });

  it("retomada: put com checkpoint_id no config vira parentConfig do novo checkpoint", async () => {
    const runId = await seedRun(tenantA);
    const first = fixtureCheckpoint();
    const second = fixtureCheckpoint();

    await withTenant(
      tenantA,
      async (tx) => {
        const saver = createCheckpointSaver(tenantA, tx);
        await saver.put({ configurable: { thread_id: runId } }, first, fixtureMetadata, {});
        await saver.put(
          { configurable: { thread_id: runId, checkpoint_id: first.id } },
          second,
          { ...fixtureMetadata, step: 1 },
          {}
        );

        const latest = await saver.getTuple({ configurable: { thread_id: runId } });
        expect(latest?.checkpoint.id).toBe(second.id);
        expect(latest?.parentConfig?.configurable?.checkpoint_id).toBe(first.id);
      },
      pool
    );
  });

  it("list devolve os checkpoints do run, do mais recente pro mais antigo", async () => {
    const runId = await seedRun(tenantA);
    const first = fixtureCheckpoint();
    const second = fixtureCheckpoint();

    await withTenant(
      tenantA,
      async (tx) => {
        const saver = createCheckpointSaver(tenantA, tx);
        await saver.put({ configurable: { thread_id: runId } }, first, fixtureMetadata, {});
        await saver.put({ configurable: { thread_id: runId } }, second, fixtureMetadata, {});

        const tuples = [];
        for await (const tuple of saver.list({ configurable: { thread_id: runId } })) {
          tuples.push(tuple);
        }
        expect(tuples.map((t) => t.checkpoint.id)).toEqual([second.id, first.id]);
      },
      pool
    );
  });

  it("putWrites: write comum não se sobrescreve (idempotente); canal especial se sobrescreve", async () => {
    const runId = await seedRun(tenantA);
    const checkpoint = fixtureCheckpoint();

    await withTenant(
      tenantA,
      async (tx) => {
        const saver = createCheckpointSaver(tenantA, tx);
        await saver.put({ configurable: { thread_id: runId } }, checkpoint, fixtureMetadata, {});
        const config = { configurable: { thread_id: runId, checkpoint_id: checkpoint.id } };

        // Write comum: reentrega da mesma tarefa não deve duplicar nem sobrescrever.
        await saver.putWrites(config, [["output", "primeira-tentativa"]], "task-1");
        await saver.putWrites(config, [["output", "reentrega-nao-deveria-aparecer"]], "task-1");

        // Canal especial (erro): a segunda chamada sobrescreve a primeira.
        await saver.putWrites(config, [[ERROR, "erro-antigo"]], "task-2");
        await saver.putWrites(config, [[ERROR, "erro-novo"]], "task-2");

        const tuple = await saver.getTuple({ configurable: { thread_id: runId } });
        const writesByTask = new Map(tuple?.pendingWrites?.map((w) => [w[0], w]));
        expect(writesByTask.get("task-1")).toEqual(["task-1", "output", "primeira-tentativa"]);
        expect(writesByTask.get("task-2")).toEqual(["task-2", ERROR, "erro-novo"]);
      },
      pool
    );
  });

  it("deleteThread remove checkpoints e writes do run", async () => {
    const runId = await seedRun(tenantA);
    const checkpoint = fixtureCheckpoint();

    await withTenant(
      tenantA,
      async (tx) => {
        const saver = createCheckpointSaver(tenantA, tx);
        await saver.put({ configurable: { thread_id: runId } }, checkpoint, fixtureMetadata, {});
        await saver.putWrites({ configurable: { thread_id: runId, checkpoint_id: checkpoint.id } }, [["x", 1]], "task-1");

        await saver.deleteThread(runId);

        const tuple = await saver.getTuple({ configurable: { thread_id: runId } });
        expect(tuple).toBeUndefined();
      },
      pool
    );
  });

  it("checkpoint de um tenant não é legível sob o contexto de outro", async () => {
    const runId = await seedRun(tenantA);
    const checkpoint = fixtureCheckpoint();

    await withTenant(
      tenantA,
      async (tx) => {
        const saver = createCheckpointSaver(tenantA, tx);
        await saver.put({ configurable: { thread_id: runId } }, checkpoint, fixtureMetadata, {});
      },
      pool
    );

    await withTenant(
      tenantB,
      async (tx) => {
        const saver = createCheckpointSaver(tenantB, tx);
        const tuple = await saver.getTuple({ configurable: { thread_id: runId } });
        expect(tuple).toBeUndefined();

        const tuples = [];
        for await (const t of saver.list({ configurable: { thread_id: runId } })) tuples.push(t);
        expect(tuples).toHaveLength(0);
      },
      pool
    );
  });

  it("checkpoint_ns não vazio é recusado — subgrafo não é suportado", async () => {
    const runId = await seedRun(tenantA);

    await withTenant(
      tenantA,
      async (tx) => {
        const saver = createCheckpointSaver(tenantA, tx);
        await expect(
          saver.getTuple({ configurable: { thread_id: runId, checkpoint_ns: "sub" } })
        ).rejects.toThrow(UnsupportedCheckpointNamespaceError);
      },
      pool
    );
  });
});
