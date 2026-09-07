import { asc, eq, sql } from "drizzle-orm";
import { runSteps } from "../schema/execution";
import type { Tx } from "../tenant-context";

export interface RunStepRow {
  id: string;
  tenantId: string;
  runId: string;
  seq: number;
  kind: string;
  status: string;
  detail: unknown;
  error: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: string | null;
  createdAt: Date;
}

export interface InsertRunStepInput {
  id: string;
  tenantId: string;
  runId: string;
  seq: number;
  kind: string;
  status: string;
  detail?: unknown;
  error?: string;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
}

export async function insertRunStep(input: InsertRunStepInput, tx: Tx): Promise<void> {
  await tx.insert(runSteps).values({
    id: input.id,
    tenantId: input.tenantId,
    runId: input.runId,
    seq: input.seq,
    kind: input.kind,
    status: input.status,
    detail: input.detail ?? {},
    ...(input.error !== undefined ? { error: input.error } : {}),
    ...(input.tokensIn !== undefined ? { tokensIn: input.tokensIn } : {}),
    ...(input.tokensOut !== undefined ? { tokensOut: input.tokensOut } : {}),
    ...(input.costUsd !== undefined ? { costUsd: input.costUsd.toString() } : {})
  });
}

/** Na ordem em que aconteceu (`seq`) — o relógio não serve, dois passos cabem no mesmo instante. */
export async function listRunSteps(runId: string, tx: Tx): Promise<RunStepRow[]> {
  const rows = await tx.select().from(runSteps).where(eq(runSteps.runId, runId)).orderBy(asc(runSteps.seq));
  return rows as RunStepRow[];
}

/** Soma calculada no banco, não em memória (T2) — e `0`, nunca `null`, quando não há passo. */
export async function sumRunCost(runId: string, tx: Tx): Promise<number> {
  const rows = await tx
    .select({ total: sql<string>`coalesce(sum(${runSteps.costUsd}), 0)` })
    .from(runSteps)
    .where(eq(runSteps.runId, runId));
  return Number(rows[0]?.total ?? 0);
}
