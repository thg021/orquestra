CREATE TABLE IF NOT EXISTS "service_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"service_instance_id" uuid NOT NULL,
	"collection" text NOT NULL,
	"key" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "service_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "service_records" AS PERMISSIVE FOR ALL TO public USING ("service_records"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("service_records"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "service_records" FORCE ROW LEVEL SECURITY;
