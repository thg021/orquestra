import { and, eq, lte } from "drizzle-orm";
import type { Pool } from "pg";
import { computeNextRunAt, newId } from "@orquestra/core";
import { schedules } from "../schema/execution";
import * as identitySchema from "../schema/identity";
import { withTenant, withoutTenant, type Tx } from "../tenant-context";

export interface ScheduleRow {
  id: string;
  tenantId: string;
  serviceInstanceId: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  nextRunAt: Date;
  lastClaimedAt: Date | null;
}

export interface UpsertScheduleInput {
  tenantId: string;
  serviceInstanceId: string;
  cron: string;
  timezone: string;
  nextRunAt: Date;
}

/** No máximo um agendamento por instância (SCH-01) — o índice único da T1 faz o resto. */
export async function upsertSchedule(input: UpsertScheduleInput, tx: Tx): Promise<void> {
  await tx
    .insert(schedules)
    .values({
      id: newId(),
      tenantId: input.tenantId,
      serviceInstanceId: input.serviceInstanceId,
      cron: input.cron,
      timezone: input.timezone,
      nextRunAt: input.nextRunAt
    })
    .onConflictDoUpdate({
      target: schedules.serviceInstanceId,
      set: { cron: input.cron, timezone: input.timezone, nextRunAt: input.nextRunAt, updatedAt: new Date() }
    });
}

export async function findScheduleByInstance(serviceInstanceId: string, tx: Tx): Promise<ScheduleRow | undefined> {
  const rows = await tx.select().from(schedules).where(eq(schedules.serviceInstanceId, serviceInstanceId)).limit(1);
  return rows[0] as ScheduleRow | undefined;
}

export async function deleteSchedule(serviceInstanceId: string, tx: Tx): Promise<void> {
  await tx.delete(schedules).where(eq(schedules.serviceInstanceId, serviceInstanceId));
}

/**
 * Varre TODO tenant (como o `kek:rotate` da T8 do M1) porque agendamento é decisão de
 * cada escritório, não algo que uma sessão de tenant único enxerga inteiro. Para cada
 * agendamento vencido, `next_run_at` é recalculado a partir de `now` — nunca da janela
 * perdida (SCH-04) — e a reivindicação em si é o `UPDATE ... WHERE next_run_at <= now`:
 * a segunda chamada, rodando depois que a primeira já avançou a data, não acha nada.
 * É essa condição no WHERE (repetida na hora de escrever, não só de ler) que garante
 * um disparo por janela mesmo com dois processos de scheduler concorrentes (SCH-05).
 */
export async function claimDueSchedules(now: Date, pool: Pool): Promise<ScheduleRow[]> {
  const tenantIds = await withoutTenant(async (tx) => {
    const rows = await tx.select({ id: identitySchema.tenants.id }).from(identitySchema.tenants);
    return rows.map((row) => row.id);
  }, pool);

  const claimed: ScheduleRow[] = [];

  for (const tenantId of tenantIds) {
    await withTenant(
      tenantId,
      async (tx) => {
        const due = await tx
          .select()
          .from(schedules)
          .where(and(eq(schedules.enabled, true), lte(schedules.nextRunAt, now)));

        for (const row of due) {
          const nextRunAt = computeNextRunAt(row.cron, row.timezone, now);
          const updated = await tx
            .update(schedules)
            .set({ nextRunAt, lastClaimedAt: new Date(), updatedAt: new Date() })
            .where(and(eq(schedules.id, row.id), lte(schedules.nextRunAt, now)))
            .returning();

          if (updated.length > 0) {
            claimed.push(updated[0] as ScheduleRow);
          }
        }
      },
      pool
    );
  }

  return claimed;
}
