import { and, eq } from "drizzle-orm";
import { approvalRequests } from "../schema/execution";
import type { Tx } from "../tenant-context";

export interface ApprovalRequestRow {
  id: string;
  tenantId: string;
  runId: string;
  payload: unknown;
  status: string;
  decidedBy: string | null;
  decidedAt: Date | null;
  createdAt: Date;
}

export interface CreateApprovalRequestInput {
  id: string;
  tenantId: string;
  runId: string;
  payload: unknown;
}

/** Nasce `pending` — a unicidade de pendente por run é o índice parcial da T1. */
export async function createApprovalRequest(input: CreateApprovalRequestInput, tx: Tx): Promise<string> {
  await tx.insert(approvalRequests).values({
    id: input.id,
    tenantId: input.tenantId,
    runId: input.runId,
    payload: input.payload,
    status: "pending"
  });
  return input.id;
}

export async function findApprovalRequestById(id: string, tx: Tx): Promise<ApprovalRequestRow | undefined> {
  const rows = await tx.select().from(approvalRequests).where(eq(approvalRequests.id, id)).limit(1);
  return rows[0] as ApprovalRequestRow | undefined;
}

export class AlreadyDecidedError extends Error {
  constructor(id: string) {
    super(`Pedido de aprovação "${id}" já foi decidido.`);
    this.name = "AlreadyDecidedError";
  }
}

/**
 * `UPDATE ... WHERE status = 'pending'` é a guarda atômica contra decidir duas vezes
 * (APR-05) — sem SELECT antes, sem janela para uma segunda decisão colar no meio.
 */
export async function decideApprovalRequest(
  id: string,
  status: "approved" | "rejected",
  decidedBy: string,
  tx: Tx
): Promise<void> {
  const updated = await tx
    .update(approvalRequests)
    .set({ status, decidedBy, decidedAt: new Date() })
    .where(and(eq(approvalRequests.id, id), eq(approvalRequests.status, "pending")))
    .returning({ id: approvalRequests.id });

  if (updated.length === 0) {
    throw new AlreadyDecidedError(id);
  }
}
