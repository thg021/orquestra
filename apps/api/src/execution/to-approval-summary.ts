import type { ApprovalRequestRow } from "@orquestra/db";
import type { ApprovalRequestSummary } from "@orquestra/contracts";

export function toApprovalRequestSummary(row: ApprovalRequestRow): ApprovalRequestSummary {
  return {
    id: row.id,
    runId: row.runId,
    payload: row.payload,
    status: row.status,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString()
  };
}
