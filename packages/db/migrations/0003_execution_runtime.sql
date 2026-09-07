CREATE TABLE IF NOT EXISTS "approval_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approval_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "approval_requests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "delivery_receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"service_instance_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"run_id" uuid NOT NULL,
	"delivered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_receipts_instance_key_unique" UNIQUE("tenant_id","service_instance_id","idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "delivery_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "delivery_receipts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "graph_checkpoints" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"checkpoint_id" text NOT NULL,
	"parent_checkpoint_id" text,
	"state" jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "graph_checkpoints_run_checkpoint_unique" UNIQUE("run_id","checkpoint_id")
);
--> statement-breakpoint
ALTER TABLE "graph_checkpoints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "graph_checkpoints" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "run_steps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"tokens_in" integer,
	"tokens_out" integer,
	"cost_usd" numeric(12, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_steps_run_seq_unique" UNIQUE("run_id","seq")
);
--> statement-breakpoint
ALTER TABLE "run_steps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "run_steps" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "schedules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"service_instance_id" uuid NOT NULL,
	"cron" text NOT NULL,
	"timezone" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"last_claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedules_instance_unique" UNIQUE("service_instance_id")
);
--> statement-breakpoint
ALTER TABLE "schedules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "schedules" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"service_instance_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "service_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "service_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_run_id_service_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."service_runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "delivery_receipts" ADD CONSTRAINT "delivery_receipts_service_instance_id_service_instances_id_fk" FOREIGN KEY ("service_instance_id") REFERENCES "public"."service_instances"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "graph_checkpoints" ADD CONSTRAINT "graph_checkpoints_run_id_service_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."service_runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "run_steps" ADD CONSTRAINT "run_steps_run_id_service_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."service_runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schedules" ADD CONSTRAINT "schedules_service_instance_id_service_instances_id_fk" FOREIGN KEY ("service_instance_id") REFERENCES "public"."service_instances"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_runs" ADD CONSTRAINT "service_runs_service_instance_id_service_instances_id_fk" FOREIGN KEY ("service_instance_id") REFERENCES "public"."service_instances"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "approval_requests_run_pending_unique" ON "approval_requests" USING btree ("run_id") WHERE "approval_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_requests_tenant_status_idx" ON "approval_requests" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delivery_receipts_run_idx" ON "delivery_receipts" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "graph_checkpoints_run_idx" ON "graph_checkpoints" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "run_steps_run_idx" ON "run_steps" USING btree ("run_id","seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "schedules_due_idx" ON "schedules" USING btree ("next_run_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_runs_tenant_instance_idx" ON "service_runs" USING btree ("tenant_id","service_instance_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_runs_status_idx" ON "service_runs" USING btree ("status");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "approval_requests" AS PERMISSIVE FOR ALL TO public USING ("approval_requests"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("approval_requests"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "delivery_receipts" AS PERMISSIVE FOR ALL TO public USING ("delivery_receipts"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("delivery_receipts"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "graph_checkpoints" AS PERMISSIVE FOR ALL TO public USING ("graph_checkpoints"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("graph_checkpoints"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "run_steps" AS PERMISSIVE FOR ALL TO public USING ("run_steps"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("run_steps"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "schedules" AS PERMISSIVE FOR ALL TO public USING ("schedules"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("schedules"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "service_runs" AS PERMISSIVE FOR ALL TO public USING ("service_runs"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("service_runs"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);