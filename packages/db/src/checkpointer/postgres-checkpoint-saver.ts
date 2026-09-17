import {
  BaseCheckpointSaver,
  WRITES_IDX_MAP,
  type Checkpoint,
  type CheckpointTuple,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type CheckpointPendingWrite,
  type PendingWrite
} from "@langchain/langgraph-checkpoint";
import type { RunnableConfig } from "@langchain/core/runnables";
import { and, desc, eq, lt } from "drizzle-orm";
import { newId } from "@orquestra/core";
import { graphCheckpoints, graphCheckpointWrites } from "../schema/execution";
import type { Tx } from "../tenant-context";

/** Subgrafo não é suportado — nenhum agente do catálogo usa `checkpoint_ns` hoje. */
export class UnsupportedCheckpointNamespaceError extends Error {
  constructor(checkpointNs: string) {
    super(`checkpoint_ns "${checkpointNs}" não suportado — este checkpointer não lida com subgrafos.`);
    this.name = "UnsupportedCheckpointNamespaceError";
  }
}

function assertNoNamespace(checkpointNs: unknown): void {
  if (checkpointNs !== undefined && checkpointNs !== "") {
    throw new UnsupportedCheckpointNamespaceError(String(checkpointNs));
  }
}

/**
 * Envelope do que `this.serde` (JsonPlusSerializer) devolve — `[type, bytes]`. As
 * colunas `state`/`metadata`/`value` são `jsonb`, não `bytea`, então os bytes viram
 * base64 dentro do jsonb em vez de uma coluna binária própria (diferença da referência
 * oficial do LangGraph, que usa `bytea` — aqui a T1 já tinha fixado `jsonb`).
 */
interface SerializedEnvelope {
  type: string;
  data: string;
}

/**
 * Implementação própria de `BaseCheckpointSaver` sobre `graph_checkpoints` +
 * `graph_checkpoint_writes` — nunca o checkpointer de Postgres pronto do LangGraph,
 * que criaria tabela sem `tenant_id` (T8, GRA-04). Uma instância vive dentro de uma
 * única transação já sob `withTenant`; nunca abre conexão própria.
 */
class PostgresCheckpointSaver extends BaseCheckpointSaver {
  constructor(
    private readonly tenantId: string,
    private readonly tx: Tx
  ) {
    super();
  }

  private async encode(value: unknown): Promise<SerializedEnvelope> {
    const [type, bytes] = await this.serde.dumpsTyped(value);
    return { type, data: Buffer.from(bytes).toString("base64") };
  }

  private async decode<T>(envelope: unknown): Promise<T> {
    const { type, data } = envelope as SerializedEnvelope;
    return (await this.serde.loadsTyped(type, Buffer.from(data, "base64"))) as T;
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    assertNoNamespace(config.configurable?.checkpoint_ns);
    const threadId = config.configurable?.thread_id as string;
    const checkpointId = config.configurable?.checkpoint_id as string | undefined;

    const rows = checkpointId
      ? await this.tx
          .select()
          .from(graphCheckpoints)
          .where(and(eq(graphCheckpoints.runId, threadId), eq(graphCheckpoints.checkpointId, checkpointId)))
          .limit(1)
      : await this.tx
          .select()
          .from(graphCheckpoints)
          .where(eq(graphCheckpoints.runId, threadId))
          .orderBy(desc(graphCheckpoints.checkpointId))
          .limit(1);
    const row = rows[0];
    if (!row) return undefined;

    const [checkpoint, metadata] = await Promise.all([
      this.decode<Checkpoint>(row.state),
      this.decode<CheckpointMetadata>(row.metadata)
    ]);

    const writeRows = await this.tx
      .select()
      .from(graphCheckpointWrites)
      .where(and(eq(graphCheckpointWrites.runId, threadId), eq(graphCheckpointWrites.checkpointId, row.checkpointId)))
      .orderBy(graphCheckpointWrites.taskId, graphCheckpointWrites.idx);

    const pendingWrites: CheckpointPendingWrite[] = await Promise.all(
      writeRows.map(
        async (writeRow) => [writeRow.taskId, writeRow.channel, await this.decode(writeRow.value)] as CheckpointPendingWrite
      )
    );

    const tuple: CheckpointTuple = {
      config: { configurable: { thread_id: threadId, checkpoint_ns: "", checkpoint_id: row.checkpointId } },
      checkpoint,
      metadata,
      pendingWrites
    };
    if (row.parentCheckpointId) {
      tuple.parentConfig = {
        configurable: { thread_id: threadId, checkpoint_ns: "", checkpoint_id: row.parentCheckpointId }
      };
    }
    return tuple;
  }

  async *list(config: RunnableConfig, options: CheckpointListOptions = {}): AsyncGenerator<CheckpointTuple> {
    assertNoNamespace(config.configurable?.checkpoint_ns);
    const threadId = config.configurable?.thread_id as string;
    const beforeCheckpointId = options.before?.configurable?.checkpoint_id as string | undefined;

    // `checkpoint_id` é um uuid6 — ordena cronologicamente como texto, sem precisar
    // de outra coluna. Mesma comparação lexicográfica que a referência do LangGraph usa.
    const conditions = [eq(graphCheckpoints.runId, threadId)];
    if (beforeCheckpointId) {
      conditions.push(lt(graphCheckpoints.checkpointId, beforeCheckpointId));
    }

    const rows = await this.tx
      .select()
      .from(graphCheckpoints)
      .where(and(...conditions))
      .orderBy(desc(graphCheckpoints.checkpointId));

    let yielded = 0;
    for (const row of rows) {
      if (options.limit !== undefined && yielded >= options.limit) break;

      const metadata = await this.decode<CheckpointMetadata>(row.metadata);
      if (options.filter && !Object.entries(options.filter).every(([key, value]) => (metadata as Record<string, unknown>)[key] === value)) {
        continue;
      }

      const checkpoint = await this.decode<Checkpoint>(row.state);
      const writeRows = await this.tx
        .select()
        .from(graphCheckpointWrites)
        .where(and(eq(graphCheckpointWrites.runId, threadId), eq(graphCheckpointWrites.checkpointId, row.checkpointId)))
        .orderBy(graphCheckpointWrites.taskId, graphCheckpointWrites.idx);
      const pendingWrites: CheckpointPendingWrite[] = await Promise.all(
        writeRows.map(
          async (writeRow) =>
            [writeRow.taskId, writeRow.channel, await this.decode(writeRow.value)] as CheckpointPendingWrite
        )
      );

      const tuple: CheckpointTuple = {
        config: { configurable: { thread_id: threadId, checkpoint_ns: "", checkpoint_id: row.checkpointId } },
        checkpoint,
        metadata,
        pendingWrites
      };
      if (row.parentCheckpointId) {
        tuple.parentConfig = {
          configurable: { thread_id: threadId, checkpoint_ns: "", checkpoint_id: row.parentCheckpointId }
        };
      }
      yielded += 1;
      yield tuple;
    }
  }

  async put(config: RunnableConfig, checkpoint: Checkpoint, metadata: CheckpointMetadata): Promise<RunnableConfig> {
    assertNoNamespace(config.configurable?.checkpoint_ns);
    const threadId = config.configurable?.thread_id as string;
    const parentCheckpointId = (config.configurable?.checkpoint_id as string | undefined) ?? null;

    const [state, encodedMetadata] = await Promise.all([this.encode(checkpoint), this.encode(metadata)]);

    await this.tx
      .insert(graphCheckpoints)
      .values({
        id: newId(),
        tenantId: this.tenantId,
        runId: threadId,
        checkpointId: checkpoint.id,
        parentCheckpointId,
        state,
        metadata: encodedMetadata
      })
      .onConflictDoUpdate({
        target: [graphCheckpoints.runId, graphCheckpoints.checkpointId],
        set: { state, metadata: encodedMetadata }
      });

    return { configurable: { thread_id: threadId, checkpoint_ns: "", checkpoint_id: checkpoint.id } };
  }

  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    assertNoNamespace(config.configurable?.checkpoint_ns);
    const threadId = config.configurable?.thread_id as string;
    const checkpointId = config.configurable?.checkpoint_id as string;

    // Canal especial (erro, agendamento) sobrescreve; write comum nunca sobrescreve —
    // é o que torna `putWrites` idempotente numa reentrega do mesmo passo.
    const allSpecial = writes.every(([channel]) => channel in WRITES_IDX_MAP);

    for (const [index, [channel, value]] of writes.entries()) {
      const idx = WRITES_IDX_MAP[channel] ?? index;
      const encodedValue = await this.encode(value);
      const row = {
        id: newId(),
        tenantId: this.tenantId,
        runId: threadId,
        checkpointId,
        taskId,
        idx,
        channel,
        value: encodedValue
      };
      const target = [
        graphCheckpointWrites.runId,
        graphCheckpointWrites.checkpointId,
        graphCheckpointWrites.taskId,
        graphCheckpointWrites.idx
      ];

      if (allSpecial) {
        await this.tx.insert(graphCheckpointWrites).values(row).onConflictDoUpdate({
          target,
          set: { channel, value: encodedValue }
        });
      } else {
        await this.tx.insert(graphCheckpointWrites).values(row).onConflictDoNothing({ target });
      }
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.tx.delete(graphCheckpointWrites).where(eq(graphCheckpointWrites.runId, threadId));
    await this.tx.delete(graphCheckpoints).where(eq(graphCheckpoints.runId, threadId));
  }
}

/** Um checkpointer por transação — nunca compartilhado entre tenants ou fora de `withTenant`. */
export function createCheckpointSaver(tenantId: string, tx: Tx): BaseCheckpointSaver {
  return new PostgresCheckpointSaver(tenantId, tx);
}
