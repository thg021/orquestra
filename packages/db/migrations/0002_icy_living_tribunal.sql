CREATE TABLE IF NOT EXISTS "connector_bindings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"service_instance_id" uuid NOT NULL,
	"capability" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connector_bindings_instance_capability_unique" UNIQUE("service_instance_id","capability")
);
--> statement-breakpoint
ALTER TABLE "connector_bindings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "connector_bindings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "connector_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connector_key" text NOT NULL,
	"name" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secret_envelope" "bytea" NOT NULL,
	"dek_envelope" "bytea" NOT NULL,
	"key_version" integer NOT NULL,
	"last4" text NOT NULL,
	"status" text NOT NULL,
	"last_check_status" text,
	"last_check_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "connector_connections_tenant_connector_name_unique" UNIQUE("tenant_id","connector_key","name")
);
--> statement-breakpoint
ALTER TABLE "connector_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "connector_connections" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_instances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_key" text NOT NULL,
	"agent_version" text NOT NULL,
	"name" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text NOT NULL,
	"status_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "service_instances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "service_instances" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "connector_bindings" ADD CONSTRAINT "connector_bindings_service_instance_id_service_instances_id_fk" FOREIGN KEY ("service_instance_id") REFERENCES "public"."service_instances"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "connector_bindings" ADD CONSTRAINT "connector_bindings_connection_id_connector_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connector_connections"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connector_bindings_connection_idx" ON "connector_bindings" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connector_connections_tenant_connector_idx" ON "connector_connections" USING btree ("tenant_id","connector_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "service_instances_tenant_name_active_unique" ON "service_instances" USING btree ("tenant_id","name") WHERE "service_instances"."removed_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_instances_tenant_status_idx" ON "service_instances" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "connector_bindings" AS PERMISSIVE FOR ALL TO public USING ("connector_bindings"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("connector_bindings"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "connector_connections" AS PERMISSIVE FOR ALL TO public USING ("connector_connections"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("connector_connections"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "service_instances" AS PERMISSIVE FOR ALL TO public USING ("service_instances"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("service_instances"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);