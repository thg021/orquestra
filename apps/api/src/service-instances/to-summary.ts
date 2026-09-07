import type { ServiceInstanceRow } from "@orquestra/db";
import type { ServiceInstanceSummary } from "@orquestra/contracts";

export function toServiceInstanceSummary(row: ServiceInstanceRow): ServiceInstanceSummary {
  return {
    id: row.id,
    agentKey: row.agentKey,
    agentVersion: row.agentVersion,
    name: row.name,
    config: row.config,
    status: row.status,
    statusReason: row.statusReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}
