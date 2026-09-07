import { and, desc, eq, notInArray } from "drizzle-orm";
import { serviceRuns } from "../schema/execution";
import type { Tx } from "../tenant-context";

export interface ServiceRunRow {
  id: string;
  tenantId: string;
  serviceInstanceId: string;
  trigger: string;
  status: string;
  error: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InsertServiceRunInput {
  id: string;
  tenantId: string;
  serviceInstanceId: string;
  trigger: string;
}

/** succeeded/failed nunca saem de onde estão — quem chegou lá terminou de verdade. */
const FINAL_STATUSES = ["succeeded", "failed"] as const;

export class IllegalRunTransitionError extends Error {
  constructor(id: string, toStatus: string) {
    super(`Run "${id}" está num estado final e não pode transicionar para "${toStatus}".`);
    this.name = "IllegalRunTransitionError";
  }
}

/** Sempre nasce `queued` — quem move para `running` é quem consome o job (T7). */
export async function insertServiceRun(input: InsertServiceRunInput, tx: Tx): Promise<void> {
  await tx.insert(serviceRuns).values({
    id: input.id,
    tenantId: input.tenantId,
    serviceInstanceId: input.serviceInstanceId,
    trigger: input.trigger,
    status: "queued"
  });
}

export async function findServiceRunById(id: string, tx: Tx): Promise<ServiceRunRow | undefined> {
  const rows = await tx.select().from(serviceRuns).where(eq(serviceRuns.id, id)).limit(1);
  return rows[0] as ServiceRunRow | undefined;
}

/** Mais recente primeiro — é assim que o painel lista (OBS-01). */
export async function listServiceRunsByInstance(serviceInstanceId: string, tx: Tx): Promise<ServiceRunRow[]> {
  const rows = await tx
    .select()
    .from(serviceRuns)
    .where(eq(serviceRuns.serviceInstanceId, serviceInstanceId))
    .orderBy(desc(serviceRuns.createdAt));
  return rows as ServiceRunRow[];
}

export interface TransitionServiceRunStatusOptions {
  error?: string;
}

/**
 * `UPDATE ... WHERE status NOT IN (final)` é a guarda: atômica, sem janela entre ler
 * e escrever. Zero linha afetada e o run existe → estava num estado final (T2).
 * `running` grava `startedAt`; `succeeded`/`failed` gravam `finishedAt` — uma vez só,
 * a primeira vez que o run entra nesses estados.
 */
export async function transitionServiceRunStatus(
  id: string,
  toStatus: string,
  tx: Tx,
  options: TransitionServiceRunStatusOptions = {}
): Promise<void> {
  const changes: Record<string, unknown> = { status: toStatus, updatedAt: new Date() };
  if (toStatus === "running") changes.startedAt = new Date();
  if (toStatus === "succeeded" || toStatus === "failed") changes.finishedAt = new Date();
  if (options.error !== undefined) changes.error = options.error;

  const updated = await tx
    .update(serviceRuns)
    .set(changes)
    .where(and(eq(serviceRuns.id, id), notInArray(serviceRuns.status, [...FINAL_STATUSES])))
    .returning({ id: serviceRuns.id });

  if (updated.length === 0) {
    throw new IllegalRunTransitionError(id, toStatus);
  }
}
