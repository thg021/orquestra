import { and, eq } from "drizzle-orm";
import { newId } from "@orquestra/core";
import { connectorBindings } from "../schema/service-management";
import type { Tx } from "../tenant-context";

export interface ConnectorBindingRow {
  id: string;
  tenantId: string;
  serviceInstanceId: string;
  capability: string;
  connectionId: string;
  createdAt: Date;
}

export interface BindConnectorCapabilityInput {
  tenantId: string;
  serviceInstanceId: string;
  capability: string;
  connectionId: string;
}

/**
 * Liga uma capability a uma conexão. No máximo uma conexão por `(instância,
 * capability)` (BIND-02) — ligar de novo substitui via `ON CONFLICT`, nunca soma uma
 * segunda linha.
 */
export async function bindConnectorCapability(input: BindConnectorCapabilityInput, tx: Tx): Promise<void> {
  await tx
    .insert(connectorBindings)
    .values({
      id: newId(),
      tenantId: input.tenantId,
      serviceInstanceId: input.serviceInstanceId,
      capability: input.capability,
      connectionId: input.connectionId
    })
    .onConflictDoUpdate({
      target: [connectorBindings.serviceInstanceId, connectorBindings.capability],
      set: { connectionId: input.connectionId }
    });
}

export async function unbindConnectorCapability(
  serviceInstanceId: string,
  capability: string,
  tx: Tx
): Promise<void> {
  await tx
    .delete(connectorBindings)
    .where(
      and(
        eq(connectorBindings.serviceInstanceId, serviceInstanceId),
        eq(connectorBindings.capability, capability)
      )
    );
}

export async function listBindingsByInstance(
  serviceInstanceId: string,
  tx: Tx
): Promise<ConnectorBindingRow[]> {
  const rows = await tx
    .select()
    .from(connectorBindings)
    .where(eq(connectorBindings.serviceInstanceId, serviceInstanceId));
  return rows as ConnectorBindingRow[];
}

/** Serve à revogação (ROT-01/ROT-02): achar rápido quem depende de uma conexão. */
export async function listBindingsByConnection(connectionId: string, tx: Tx): Promise<ConnectorBindingRow[]> {
  const rows = await tx.select().from(connectorBindings).where(eq(connectorBindings.connectionId, connectionId));
  return rows as ConnectorBindingRow[];
}
