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

export interface UpdateConnectorConnectionSecretInput {
  secretEnvelope: Buffer;
  dekEnvelope: Buffer;
  keyVersion: number;
  last4: string;
  metadata?: unknown;
}

/** PATCH de credencial (T17, ROT-03) — troca só o segredo; nome e vínculos ficam intactos. */
export async function updateConnectorConnectionSecret(
  id: string,
  input: UpdateConnectorConnectionSecretInput,
  tx: Tx
): Promise<void> {
  const changes: Record<string, unknown> = {
    secretEnvelope: input.secretEnvelope,
    dekEnvelope: input.dekEnvelope,
    keyVersion: input.keyVersion,
    last4: input.last4,
    updatedAt: new Date()
  };
  if (input.metadata !== undefined) changes.metadata = input.metadata;
  await tx.update(connectorConnections).set(changes).where(eq(connectorConnections.id, id));
}

/** Revogação (ROT-01, ROT-02) — nunca é bloqueada por dependência (design §Revogação). */
export async function revokeConnectorConnection(id: string, tx: Tx): Promise<void> {
  await tx
    .update(connectorConnections)
    .set({ status: "revoked", revokedAt: new Date(), updatedAt: new Date() })
    .where(eq(connectorConnections.id, id));
}

/** Verificação (T18, CHK-01/CHK-02) — grava resultado e data; a chamada real ao fornecedor entra no M3. */
export async function updateConnectorConnectionCheck(id: string, status: string, tx: Tx): Promise<void> {
  await tx
    .update(connectorConnections)
    .set({ lastCheckStatus: status, lastCheckAt: new Date(), updatedAt: new Date() })
    .where(eq(connectorConnections.id, id));
}

export async function listConnectorConnections(tx: Tx): Promise<ConnectorConnectionRow[]> {
  const rows = await tx.select().from(connectorConnections);
  return rows as ConnectorConnectionRow[];
}
