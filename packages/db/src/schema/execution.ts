import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  integer,
  numeric,
  boolean,
  unique,
  uniqueIndex,
  index,
  pgPolicy
} from "drizzle-orm/pg-core";
import { sql, type ColumnBaseConfig, type ColumnDataType } from "drizzle-orm";
import type { ExtraConfigColumn } from "drizzle-orm/pg-core";
import { serviceInstances } from "./service-management";

/** A coluna, como o callback de config de tabela do Drizzle a entrega. */
type ConfigColumn = ExtraConfigColumn<ColumnBaseConfig<ColumnDataType, string>>;

/**
 * Policy de isolamento no padrão do M0 — o `nullif` é obrigatório: sem ele a policy
 * quebra quando o pool reaproveita uma conexão que já teve o GUC tocado (lição da T5).
 */
function tenantIsolation(tenantIdColumn: ConfigColumn) {
  return pgPolicy("tenant_isolation", {
    as: "permissive",
    for: "all",
    to: "public",
    using: sql`${tenantIdColumn} = nullif(current_setting('app.tenant_id', true), '')::uuid`,
    withCheck: sql`${tenantIdColumn} = nullif(current_setting('app.tenant_id', true), '')::uuid`
  });
}

/**
 * Uma execução de uma instância. É a fonte de verdade do runtime — o job na fila é
 * ponteiro descartável, e some sem consequência (design §Riscos residuais).
 */
export const serviceRuns = pgTable(
  "service_runs",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    serviceInstanceId: uuid("service_instance_id")
      .notNull()
      .references(() => serviceInstances.id),
    // manual | scheduled
    trigger: text("trigger").notNull(),
    // queued | running | awaiting_approval | succeeded | failed
    status: text("status").notNull(),
    // Erro já sanitizado: nunca segredo, chave ou string de conexão.
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("service_runs_tenant_instance_idx").on(table.tenantId, table.serviceInstanceId, table.createdAt),
    index("service_runs_status_idx").on(table.status),
    tenantIsolation(table.tenantId)
  ]
).enableRLS();

/**
 * Um passo por nó do grafo, por documento lido e por item entregue. Sucessor do
 * `log.jsonl` da skill original: é daqui que sai tudo o que o painel mostra.
 */
export const runSteps = pgTable(
  "run_steps",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    runId: uuid("run_id")
      .notNull()
      .references(() => serviceRuns.id),
    // Ordem dentro do run — o relógio não serve, dois passos podem cair no mesmo instante.
    seq: integer("seq").notNull(),
    // graph_node | document_read | delivery_item | approval
    kind: text("kind").notNull(),
    // succeeded | failed | skipped
    status: text("status").notNull(),
    // O que aconteceu, sem segredo: identificadores, contagens, motivo de falha.
    detail: jsonb("detail").notNull().default({}),
    error: text("error"),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    // numeric, não float: custo é dinheiro e some centavo em arredondamento binário.
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    unique("run_steps_run_seq_unique").on(table.runId, table.seq),
    index("run_steps_run_idx").on(table.runId, table.seq),
    tenantIsolation(table.tenantId)
  ]
).enableRLS();

/**
 * O pedido de decisão humana. O `payload` guarda o plano de entrega — dado, nunca
 * segredo (D40). Um run só pode ter um pedido pendente por vez; decididos convivem.
 */
export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    runId: uuid("run_id")
      .notNull()
      .references(() => serviceRuns.id),
    payload: jsonb("payload").notNull(),
    // pending | approved | rejected
    status: text("status").notNull(),
    decidedBy: uuid("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    // Parcial: só um pendente por run. Um pedido já decidido não impede um novo —
    // é o que permite um run pedir aprovação mais de uma vez ao longo do grafo.
    uniqueIndex("approval_requests_run_pending_unique")
      .on(table.runId)
      .where(sql`${table.status} = 'pending'`),
    index("approval_requests_tenant_status_idx").on(table.tenantId, table.status),
    tenantIsolation(table.tenantId)
  ]
).enableRLS();

/**
 * O que já foi entregue. Sucessor do marcador `_controle/<mês>_<categoria>.enviado`.
 * Vive fora do run de propósito: a rodada do mês que vem precisa enxergar a do mês
 * passado. A unicidade é do banco, não de checagem em memória (DEL-05).
 */
export const deliveryReceipts = pgTable(
  "delivery_receipts",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    serviceInstanceId: uuid("service_instance_id")
      .notNull()
      .references(() => serviceInstances.id),
    // Composta pelo agente: só ele sabe o que significa "a mesma entrega".
    idempotencyKey: text("idempotency_key").notNull(),
    runId: uuid("run_id").notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    unique("delivery_receipts_instance_key_unique").on(
      table.tenantId,
      table.serviceInstanceId,
      table.idempotencyKey
    ),
    index("delivery_receipts_run_idx").on(table.runId),
    tenantIsolation(table.tenantId)
  ]
).enableRLS();

/** Recorrência por instância. `next_run_at` é o que o scheduler reivindica (SCH-04). */
export const schedules = pgTable(
  "schedules",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    serviceInstanceId: uuid("service_instance_id")
      .notNull()
      .references(() => serviceInstances.id),
    cron: text("cron").notNull(),
    timezone: text("timezone").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull(),
    lastClaimedAt: timestamp("last_claimed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    unique("schedules_instance_unique").on(table.serviceInstanceId),
    index("schedules_due_idx").on(table.nextRunAt),
    tenantIsolation(table.tenantId)
  ]
).enableRLS();

/**
 * Estado do grafo. Tabela nossa, e não a que o LangGraph criaria: a da biblioteca
 * nasce sem `tenant_id`, o que a tornaria invisível para o teste de introspecção do
 * M0 enquanto guardaria estado de todos os escritórios no mesmo lugar.
 */
export const graphCheckpoints = pgTable(
  "graph_checkpoints",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    runId: uuid("run_id")
      .notNull()
      .references(() => serviceRuns.id),
    checkpointId: text("checkpoint_id").notNull(),
    parentCheckpointId: text("parent_checkpoint_id"),
    state: jsonb("state").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    unique("graph_checkpoints_run_checkpoint_unique").on(table.runId, table.checkpointId),
    index("graph_checkpoints_run_idx").on(table.runId, table.createdAt),
    tenantIsolation(table.tenantId)
  ]
).enableRLS();
