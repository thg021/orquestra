import type { ConnectorConnectionRow } from "@orquestra/db";
import type { ConnectionSummary } from "@orquestra/contracts";

export function toConnectionSummary(row: ConnectorConnectionRow): ConnectionSummary {
  return {
    id: row.id,
    connectorKey: row.connectorKey,
    name: row.name,
    metadata: row.metadata,
    last4: row.last4,
    status: row.status,
    lastCheckStatus: row.lastCheckStatus,
    lastCheckAt: row.lastCheckAt ? row.lastCheckAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}
