import type { ServiceRunRow } from "@orquestra/db";
import type { ServiceRunSummary } from "@orquestra/contracts";

export function toServiceRunSummary(row: ServiceRunRow): ServiceRunSummary {
  return {
    id: row.id,
    serviceInstanceId: row.serviceInstanceId,
    trigger: row.trigger,
    status: row.status,
    error: row.error,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}
