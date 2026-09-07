import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  integer,
  customType,
  pgPolicy,
  unique,
  uniqueIndex,
  index
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// bytea não tem tipo nativo no drizzle-orm/pg-core 0.36 — mesmo padrão do citext em
// identity.ts. Segredo e DEK nunca em `text`: evita conversão de codificação silenciosa
// e torna óbvio, para quem lê o esquema, que aquilo não é para ser lido (data-drizzle-postgres.md).
const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  }
});

/**
 * O serviço que o tenant instalou. `agent_key`/`agent_version` não têm FK — o
 * catálogo é código, não tabela (D22); a integridade é responsabilidade do gate de
 * ativação, não do banco.
 */
export const serviceInstances = pgTable(
  "service_instances",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    agentKey: text("agent_key").notNull(),
    agentVersion: text("agent_version").notNull(),
    name: text("name").notNull(),
    config: jsonb("config").notNull().default({}),
    // installed | active | paused | removed
    status: text("status").notNull(),
    statusReason: text("status_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    removedAt: timestamp("removed_at", { withTimezone: true })
  },
  (table) => [
    // Parcial: nome pode repetir entre uma instância removida e uma nova — remoção é
    // lógica (spec INST-05), então o nome antigo precisa ficar livre para reuso.
    uniqueIndex("service_instances_tenant_name_active_unique")
      .on(table.tenantId, table.name)
      .where(sql`${table.removedAt} is null`),
    index("service_instances_tenant_status_idx").on(table.tenantId, table.status),
    pgPolicy("tenant_isolation", {
      as: "permissive",
      for: "all",
      to: "public",
      using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '')::uuid`,
      withCheck: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '')::uuid`
    })
  ]
).enableRLS();

/**
 * Uma credencial cifrada, pertencente ao tenant e reutilizável por vários serviços.
 * `secretEnvelope`/`dekEnvelope` são o formato binário único do cofre
 * (versão‖IV‖tag‖ciphertext, packages/core/src/vault/envelope.ts) — nunca texto claro.
 */
export const connectorConnections = pgTable(
  "connector_connections",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    connectorKey: text("connector_key").notNull(),
    name: text("name").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    secretEnvelope: bytea("secret_envelope").notNull(),
    dekEnvelope: bytea("dek_envelope").notNull(),
    keyVersion: integer("key_version").notNull(),
    last4: text("last4").notNull(),
    // active | revoked
    status: text("status").notNull(),
    // unverified | ok | failed — nulo até a primeira verificação (CHK-01 a CHK-03)
    lastCheckStatus: text("last_check_status"),
    lastCheckAt: timestamp("last_check_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true })
  },
  (table) => [
    unique("connector_connections_tenant_connector_name_unique").on(
      table.tenantId,
      table.connectorKey,
      table.name
    ),
    index("connector_connections_tenant_connector_idx").on(table.tenantId, table.connectorKey),
    pgPolicy("tenant_isolation", {
      as: "permissive",
      for: "all",
      to: "public",
      using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '')::uuid`,
      withCheck: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '')::uuid`
    })
  ]
).enableRLS();

/**
 * Liga uma capability exigida por um `ServiceInstance` a uma `ConnectorConnection`
 * que a satisfaz. Único por `(service_instance_id, capability)`: no máximo uma
 * conexão por necessidade (BIND-02) — ligar de novo substitui, nunca soma.
 */
export const connectorBindings = pgTable(
  "connector_bindings",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    serviceInstanceId: uuid("service_instance_id")
      .notNull()
      .references(() => serviceInstances.id),
    capability: text("capability").notNull(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connectorConnections.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    unique("connector_bindings_instance_capability_unique").on(table.serviceInstanceId, table.capability),
    // Serve à revogação (ROT-01/ROT-02): achar rápido quais instâncias dependem de
    // uma conexão que acabou de ser revogada.
    index("connector_bindings_connection_idx").on(table.connectionId),
    pgPolicy("tenant_isolation", {
      as: "permissive",
      for: "all",
      to: "public",
      using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '')::uuid`,
      withCheck: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '')::uuid`
    })
  ]
).enableRLS();
