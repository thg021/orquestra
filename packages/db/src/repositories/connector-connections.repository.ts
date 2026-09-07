import { and, eq } from "drizzle-orm";
import { connectorConnections } from "../schema/service-management";
import type { Tx } from "../tenant-context";

export interface ConnectorConnectionRow {
  id: string;
  tenantId: string;
  connectorKey: string;
  name: string;
  metadata: unknown;
  secretEnvelope: Buffer;
  dekEnvelope: Buffer;
  keyVersion: number;
  last4: string;
  status: string;
  lastCheckStatus: string | null;
  lastCheckAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  revokedAt: Date | null;
}

export interface InsertConnectorConnectionInput {
  id: string;
  tenantId: string;
  connectorKey: string;
  name: string;
  metadata?: unknown;
  secretEnvelope: Buffer;
  dekEnvelope: Buffer;
  keyVersion: number;
  last4: string;
}

/** Sempre nasce `active` — é o cadastro write-only descrito no ADR-001 (SEC-01). */
export async function insertConnectorConnection(input: InsertConnectorConnectionInput, tx: Tx): Promise<void> {
  await tx.insert(connectorConnections).values({
    id: input.id,
    tenantId: input.tenantId,
    connectorKey: input.connectorKey,
    name: input.name,
    metadata: input.metadata ?? {},
    secretEnvelope: input.secretEnvelope,
    dekEnvelope: input.dekEnvelope,
    keyVersion: input.keyVersion,
    last4: input.last4,
    status: "active",
    lastCheckStatus: "unverified"
  });
}

export async function findConnectorConnectionById(
  id: string,
  tx: Tx
): Promise<ConnectorConnectionRow | undefined> {
  const rows = await tx.select().from(connectorConnections).where(eq(connectorConnections.id, id)).limit(1);
  return rows[0] as ConnectorConnectionRow | undefined;
}

/** Checagem de duplicidade antes de cifrar (T16) — casa o índice único da tabela. */
export async function findConnectorConnectionByName(
  connectorKey: string,
  name: string,
  tx: Tx
): Promise<ConnectorConnectionRow | undefined> {
  const rows = await tx
    .select()
    .from(connectorConnections)
    .where(and(eq(connectorConnections.connectorKey, connectorKey), eq(connectorConnections.name, name)))
    .limit(1);
  return rows[0] as ConnectorConnectionRow | undefined;
}

export async function listConnectorConnections(tx: Tx): Promise<ConnectorConnectionRow[]> {
  const rows = await tx.select().from(connectorConnections);
  return rows as ConnectorConnectionRow[];
}
