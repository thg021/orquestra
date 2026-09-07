import { and, eq, isNull } from "drizzle-orm";
import { serviceInstances } from "../schema/service-management";
import type { Tx } from "../tenant-context";

export interface ServiceInstanceRow {
  id: string;
  tenantId: string;
  agentKey: string;
  agentVersion: string;
  name: string;
  config: unknown;
  status: string;
  statusReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  removedAt: Date | null;
}

export interface InsertServiceInstanceInput {
  id: string;
  tenantId: string;
  agentKey: string;
  agentVersion: string;
  name: string;
  config?: unknown;
}

/** Sempre nasce `installed` — ativar passa pelo gate (T12), nunca pela instalação. */
export async function insertServiceInstance(input: InsertServiceInstanceInput, tx: Tx): Promise<void> {
  await tx.insert(serviceInstances).values({
    id: input.id,
    tenantId: input.tenantId,
    agentKey: input.agentKey,
    agentVersion: input.agentVersion,
    name: input.name,
    config: input.config ?? {},
    status: "installed"
  });
}

export async function findServiceInstanceById(id: string, tx: Tx): Promise<ServiceInstanceRow | undefined> {
  const rows = await tx.select().from(serviceInstances).where(eq(serviceInstances.id, id)).limit(1);
  return rows[0] as ServiceInstanceRow | undefined;
}

/** Omite as removidas — quem quiser ver o histórico consulta por id diretamente (INST-06). */
export async function listServiceInstances(tx: Tx): Promise<ServiceInstanceRow[]> {
  const rows = await tx.select().from(serviceInstances).where(isNull(serviceInstances.removedAt));
  return rows as ServiceInstanceRow[];
}

export interface UpdateServiceInstanceInput {
  name?: string;
  config?: unknown;
}

/** Atualiza só os campos passados, preservando o resto (INST-04). */
export async function updateServiceInstance(
  id: string,
  input: UpdateServiceInstanceInput,
  tx: Tx
): Promise<void> {
  const changes: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) changes.name = input.name;
  if (input.config !== undefined) changes.config = input.config;
  await tx.update(serviceInstances).set(changes).where(eq(serviceInstances.id, id));
}

export async function updateServiceInstanceStatus(
  id: string,
  status: string,
  statusReason: string | null,
  tx: Tx
): Promise<void> {
  await tx
    .update(serviceInstances)
    .set({ status, statusReason, updatedAt: new Date() })
    .where(eq(serviceInstances.id, id));
}

/** Remoção lógica (INST-05): marca `removed_at`/status, nunca apaga a linha. */
export async function removeServiceInstance(id: string, tx: Tx): Promise<void> {
  await tx
    .update(serviceInstances)
    .set({ status: "removed", removedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(serviceInstances.id, id), isNull(serviceInstances.removedAt)));
}
