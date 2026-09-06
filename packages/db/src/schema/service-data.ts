import { pgTable, uuid, text, jsonb, timestamp, pgPolicy } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Primeira tabela sob a convenção normativa do M0: toda tabela de tenant com dado de
 * negócio carrega tenant_id e nasce com RLS. Formato final do design (§4 Modelo de
 * domínio) — service_instance_id ainda sem FK porque ServiceInstance chega só no M1.
 * Serve de corpo de prova real para os testes de isolamento em vez de uma tabela
 * descartável.
 */
export const serviceRecords = pgTable(
  "service_records",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    serviceInstanceId: uuid("service_instance_id").notNull(),
    collection: text("collection").notNull(),
    key: text("key").notNull(),
    data: jsonb("data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    pgPolicy("tenant_isolation", {
      as: "permissive",
      for: "all",
      to: "public",
      using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '')::uuid`,
      withCheck: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '')::uuid`
    })
  ]
).enableRLS();
