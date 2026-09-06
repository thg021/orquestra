import { pgTable, uuid, timestamp, text, customType, unique } from "drizzle-orm/pg-core";

// citext não tem tipo nativo no drizzle-orm/pg-core; declarado como custom type.
const citext = customType<{ data: string }>({
  dataType() {
    return "citext";
  }
});

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  email: citext("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const membershipRoleValues = ["owner", "admin", "operator"] as const;

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role", { enum: membershipRoleValues }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [unique("memberships_tenant_user_unique").on(table.tenantId, table.userId)]
);

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  tokenHash: text("token_hash").notNull().unique(),
  tenantId: uuid("tenant_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow()
});
