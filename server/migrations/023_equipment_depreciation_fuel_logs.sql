ALTER TABLE "equipment" ADD COLUMN IF NOT EXISTS "depreciation_method" text;
ALTER TABLE "equipment" ADD COLUMN IF NOT EXISTS "useful_life_years" integer;
ALTER TABLE "equipment" ADD COLUMN IF NOT EXISTS "salvage_value" numeric(12, 2);
ALTER TABLE "equipment" ADD COLUMN IF NOT EXISTS "in_service_date" date;

CREATE TABLE IF NOT EXISTS "equipment_fuel_logs" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "equipment_id" varchar NOT NULL REFERENCES "equipment"("id") ON DELETE CASCADE,
  "project_id" varchar REFERENCES "projects"("id") ON DELETE SET NULL,
  "date" date NOT NULL,
  "gallons" numeric(10, 2) NOT NULL,
  "price_per_gallon" numeric(10, 4) NOT NULL,
  "total_cost" numeric(12, 2) NOT NULL,
  "fuel_type" text NOT NULL DEFAULT 'DIESEL',
  "meter_reading" numeric(10, 1),
  "submitted_by_id" varchar NOT NULL REFERENCES "users"("id"),
  "notes" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "equipment_fuel_logs_equipment_idx" ON "equipment_fuel_logs" ("equipment_id");
CREATE INDEX IF NOT EXISTS "equipment_fuel_logs_project_idx" ON "equipment_fuel_logs" ("project_id");
CREATE INDEX IF NOT EXISTS "equipment_fuel_logs_date_idx" ON "equipment_fuel_logs" ("date");
