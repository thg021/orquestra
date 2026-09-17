CREATE TABLE IF NOT EXISTS "graph_checkpoint_writes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"checkpoint_id" text NOT NULL,
	"task_id" text NOT NULL,
	"idx" integer NOT NULL,
	"channel" text NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "graph_checkpoint_writes_unique" UNIQUE("run_id","checkpoint_id","task_id","idx")
);
--> statement-breakpoint
ALTER TABLE "graph_checkpoint_writes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "graph_checkpoint_writes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "graph_checkpoint_writes" ADD CONSTRAINT "graph_checkpoint_writes_run_id_service_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."service_runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "graph_checkpoint_writes_lookup_idx" ON "graph_checkpoint_writes" USING btree ("run_id","checkpoint_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "graph_checkpoint_writes" AS PERMISSIVE FOR ALL TO public USING ("graph_checkpoint_writes"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("graph_checkpoint_writes"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);