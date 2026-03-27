CREATE TYPE "public"."geofence_enforcement" AS ENUM('OFF', 'WARN', 'BLOCK');--> statement-breakpoint
CREATE TYPE "public"."message_entity_type" AS ENUM('RFI', 'CHANGE_ORDER', 'TASK');--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'TM_INVOICE_AUTO_CREATED';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'DOCUMENT_REVISION_CREATED';--> statement-breakpoint
CREATE TABLE "cost_ledger_postings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pay_run_id" varchar NOT NULL,
	"project_id" varchar NOT NULL,
	"cost_code" text,
	"regular_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"overtime_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"double_time_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"burden_multiplier" numeric(5, 4) DEFAULT '1.0000' NOT NULL,
	"burdened_total_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"regular_hours" numeric(8, 2) DEFAULT '0' NOT NULL,
	"overtime_hours" numeric(8, 2) DEFAULT '0' NOT NULL,
	"double_time_hours" numeric(8, 2) DEFAULT '0' NOT NULL,
	"posted_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "overtime_rules" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"project_id" varchar,
	"daily_threshold" numeric(5, 2) DEFAULT '8' NOT NULL,
	"weekly_threshold" numeric(5, 2) DEFAULT '40' NOT NULL,
	"double_time_threshold" numeric(5, 2),
	"weekly_dt_threshold" numeric(5, 2) DEFAULT '60',
	"ot_multiplier" numeric(4, 2) DEFAULT '1.50' NOT NULL,
	"dt_multiplier" numeric(4, 2) DEFAULT '2.00' NOT NULL,
	"consecutive_day_rule" boolean DEFAULT false NOT NULL,
	"consecutive_day_threshold" integer DEFAULT 7,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_cost_codes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "project_cost_codes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"project_id" varchar NOT NULL,
	"cost_code" varchar(20) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_cost_codes_project_code_uniq" UNIQUE("project_id","cost_code")
);
--> statement-breakpoint
CREATE TABLE "drawing_set_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"drawing_set_id" varchar NOT NULL,
	"sheet_id" varchar NOT NULL,
	"revision_id" varchar,
	"pinned_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "drawing_set_items_set_sheet" UNIQUE("drawing_set_id","sheet_id")
);
--> statement-breakpoint
CREATE TABLE "drawing_sets" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"organization_id" varchar NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_by_user_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment_fuel_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"equipment_id" varchar NOT NULL,
	"project_id" varchar,
	"date" date NOT NULL,
	"gallons" numeric(10, 2) NOT NULL,
	"price_per_gallon" numeric(10, 4) NOT NULL,
	"total_cost" numeric(12, 2) NOT NULL,
	"fuel_type" text DEFAULT 'DIESEL' NOT NULL,
	"meter_reading" numeric(10, 1),
	"submitted_by_id" varchar NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_entity_links" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" varchar NOT NULL,
	"entity_type" "message_entity_type" NOT NULL,
	"entity_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "message_entity_links_unique" UNIQUE("message_id","entity_type","entity_id")
);
--> statement-breakpoint
CREATE TABLE "osha_incidents" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"case_number" text NOT NULL,
	"project_id" varchar,
	"employee_name" text NOT NULL,
	"employee_job_title" text,
	"date_of_injury" text NOT NULL,
	"time_of_event" text,
	"location_of_incident" text,
	"event_description" text NOT NULL,
	"injury_illness_type" text NOT NULL,
	"body_part_affected" text NOT NULL,
	"object_or_substance" text,
	"treatment_type" text NOT NULL,
	"hospital_name" text,
	"was_hospitalized" boolean DEFAULT false NOT NULL,
	"days_away_from_work" integer DEFAULT 0,
	"days_of_restricted_duty" integer DEFAULT 0,
	"classification" text NOT NULL,
	"is_recordable" boolean DEFAULT true NOT NULL,
	"resulted_in_death" boolean DEFAULT false NOT NULL,
	"reported_by" varchar,
	"reported_by_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "safety_checklist_instances" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" varchar NOT NULL,
	"organization_id" varchar NOT NULL,
	"project_id" varchar,
	"completed_by" varchar NOT NULL,
	"completed_by_name" text,
	"status" text DEFAULT 'IN_PROGRESS' NOT NULL,
	"responses_json" text DEFAULT '[]' NOT NULL,
	"notes" text,
	"photo_urls" text,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "safety_checklist_templates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"items_json" text DEFAULT '[]' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "toolbox_talk_attendance" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scheduled_talk_id" varchar NOT NULL,
	"employee_id" varchar NOT NULL,
	"signed_at" timestamp DEFAULT now() NOT NULL,
	"signature" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "toolbox_talk_scheduled" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"topic_id" varchar NOT NULL,
	"project_id" varchar,
	"scheduled_date" text NOT NULL,
	"presenter" text,
	"presenter_id" varchar,
	"status" text DEFAULT 'SCHEDULED' NOT NULL,
	"notes" text,
	"completed_at" timestamp,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "toolbox_talk_topics" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"title" text NOT NULL,
	"content" text,
	"category" text NOT NULL,
	"attachments" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bids" ADD COLUMN "ai_win_probability" integer;--> statement-breakpoint
ALTER TABLE "pay_run_line_items" ADD COLUMN "double_time_hours" numeric(8, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "pay_run_line_items" ADD COLUMN "double_time_rate" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "geofence_enforcement" "geofence_enforcement" DEFAULT 'OFF' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "auto_invoice" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD COLUMN "expected_delivery_date" timestamp;--> statement-breakpoint
ALTER TABLE "time_clock_shifts" ADD COLUMN "cost_code" text;--> statement-breakpoint
ALTER TABLE "tm_tickets" ADD COLUMN "client_signoff_name" text;--> statement-breakpoint
ALTER TABLE "tm_tickets" ADD COLUMN "client_signoff_signature" text;--> statement-breakpoint
ALTER TABLE "tm_tickets" ADD COLUMN "client_signoff_at" timestamp;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "rfi_id" varchar;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "change_order_id" varchar;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "task_id" varchar;--> statement-breakpoint
ALTER TABLE "crm_opportunities" ADD COLUMN "ai_win_probability" integer;--> statement-breakpoint
ALTER TABLE "crm_opportunities" ADD COLUMN "ai_win_probability_rationale" text;--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "depreciation_method" text;--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "useful_life_years" integer;--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "salvage_value" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "in_service_date" date;--> statement-breakpoint
ALTER TABLE "project_health_snapshots" ADD COLUMN "cost_score" integer;--> statement-breakpoint
ALTER TABLE "project_health_snapshots" ADD COLUMN "trend_direction" text;--> statement-breakpoint
ALTER TABLE "project_health_snapshots" ADD COLUMN "ai_explanation" text;--> statement-breakpoint
ALTER TABLE "cost_ledger_postings" ADD CONSTRAINT "cost_ledger_postings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_rules" ADD CONSTRAINT "overtime_rules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_cost_codes" ADD CONSTRAINT "project_cost_codes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drawing_set_items" ADD CONSTRAINT "drawing_set_items_drawing_set_id_drawing_sets_id_fk" FOREIGN KEY ("drawing_set_id") REFERENCES "public"."drawing_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drawing_set_items" ADD CONSTRAINT "drawing_set_items_sheet_id_takeoff_sheets_id_fk" FOREIGN KEY ("sheet_id") REFERENCES "public"."takeoff_sheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drawing_sets" ADD CONSTRAINT "drawing_sets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drawing_sets" ADD CONSTRAINT "drawing_sets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drawing_sets" ADD CONSTRAINT "drawing_sets_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_fuel_logs" ADD CONSTRAINT "equipment_fuel_logs_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_fuel_logs" ADD CONSTRAINT "equipment_fuel_logs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_fuel_logs" ADD CONSTRAINT "equipment_fuel_logs_submitted_by_id_users_id_fk" FOREIGN KEY ("submitted_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_entity_links" ADD CONSTRAINT "message_entity_links_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "osha_incidents" ADD CONSTRAINT "osha_incidents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "osha_incidents" ADD CONSTRAINT "osha_incidents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "osha_incidents" ADD CONSTRAINT "osha_incidents_reported_by_users_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_checklist_instances" ADD CONSTRAINT "safety_checklist_instances_template_id_safety_checklist_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."safety_checklist_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_checklist_instances" ADD CONSTRAINT "safety_checklist_instances_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_checklist_instances" ADD CONSTRAINT "safety_checklist_instances_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_checklist_instances" ADD CONSTRAINT "safety_checklist_instances_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_checklist_templates" ADD CONSTRAINT "safety_checklist_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_checklist_templates" ADD CONSTRAINT "safety_checklist_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "toolbox_talk_attendance" ADD CONSTRAINT "toolbox_talk_attendance_scheduled_talk_id_toolbox_talk_scheduled_id_fk" FOREIGN KEY ("scheduled_talk_id") REFERENCES "public"."toolbox_talk_scheduled"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "toolbox_talk_attendance" ADD CONSTRAINT "toolbox_talk_attendance_employee_id_users_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "toolbox_talk_scheduled" ADD CONSTRAINT "toolbox_talk_scheduled_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "toolbox_talk_scheduled" ADD CONSTRAINT "toolbox_talk_scheduled_topic_id_toolbox_talk_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."toolbox_talk_topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "toolbox_talk_scheduled" ADD CONSTRAINT "toolbox_talk_scheduled_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "toolbox_talk_scheduled" ADD CONSTRAINT "toolbox_talk_scheduled_presenter_id_users_id_fk" FOREIGN KEY ("presenter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "toolbox_talk_scheduled" ADD CONSTRAINT "toolbox_talk_scheduled_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "toolbox_talk_topics" ADD CONSTRAINT "toolbox_talk_topics_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "toolbox_talk_topics" ADD CONSTRAINT "toolbox_talk_topics_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cost_ledger_postings_pay_run_idx" ON "cost_ledger_postings" USING btree ("pay_run_id");--> statement-breakpoint
CREATE INDEX "cost_ledger_postings_project_idx" ON "cost_ledger_postings" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "cost_ledger_postings_cost_code_idx" ON "cost_ledger_postings" USING btree ("cost_code");--> statement-breakpoint
CREATE INDEX "overtime_rules_org_idx" ON "overtime_rules" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "overtime_rules_project_idx" ON "overtime_rules" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_cost_codes_project_idx" ON "project_cost_codes" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "drawing_set_items_set_idx" ON "drawing_set_items" USING btree ("drawing_set_id");--> statement-breakpoint
CREATE INDEX "drawing_set_items_sheet_idx" ON "drawing_set_items" USING btree ("sheet_id");--> statement-breakpoint
CREATE INDEX "drawing_sets_project_idx" ON "drawing_sets" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "drawing_sets_org_idx" ON "drawing_sets" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "equipment_fuel_logs_equipment_idx" ON "equipment_fuel_logs" USING btree ("equipment_id");--> statement-breakpoint
CREATE INDEX "equipment_fuel_logs_project_idx" ON "equipment_fuel_logs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "equipment_fuel_logs_date_idx" ON "equipment_fuel_logs" USING btree ("date");--> statement-breakpoint
CREATE INDEX "message_entity_links_message_idx" ON "message_entity_links" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "message_entity_links_entity_idx" ON "message_entity_links" USING btree ("entity_type","entity_id");--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_rfi_id_rfis_id_fk" FOREIGN KEY ("rfi_id") REFERENCES "public"."rfis"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_change_order_id_change_orders_id_fk" FOREIGN KEY ("change_order_id") REFERENCES "public"."change_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_rfi_id_idx" ON "conversations" USING btree ("rfi_id");--> statement-breakpoint
CREATE INDEX "conversations_change_order_id_idx" ON "conversations" USING btree ("change_order_id");--> statement-breakpoint
CREATE INDEX "conversations_task_id_idx" ON "conversations" USING btree ("task_id");