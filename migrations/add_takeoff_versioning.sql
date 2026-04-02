-- Takeoff Versioning: new enums, tables, and columns
-- Task #306: Takeoff Data Engine & Versioning

DO $$ BEGIN
  CREATE TYPE "takeoff_version_status" AS ENUM ('DRAFT', 'LOCKED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "installation_status" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETE', 'ON_HOLD');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "takeoff_versions" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" varchar,
  "bid_id" varchar,
  "sheet_id" varchar NOT NULL,
  "version_number" integer NOT NULL DEFAULT 1,
  "label" text,
  "status" "takeoff_version_status" NOT NULL DEFAULT 'DRAFT',
  "created_by_id" varchar,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "takeoff_versions_sheet_idx" ON "takeoff_versions" ("sheet_id");
CREATE INDEX IF NOT EXISTS "takeoff_versions_project_idx" ON "takeoff_versions" ("project_id");
CREATE INDEX IF NOT EXISTS "takeoff_versions_bid_idx" ON "takeoff_versions" ("bid_id");

ALTER TABLE takeoff_measurements ADD COLUMN IF NOT EXISTS takeoff_version_id varchar;
ALTER TABLE takeoff_measurements ADD COLUMN IF NOT EXISTS subcontractor_id varchar;
ALTER TABLE takeoff_measurements ADD COLUMN IF NOT EXISTS supplier_id varchar;
ALTER TABLE takeoff_measurements ADD COLUMN IF NOT EXISTS location_tag text;
ALTER TABLE takeoff_measurements ADD COLUMN IF NOT EXISTS origin_measurement_id varchar;

DO $$ BEGIN
  ALTER TABLE takeoff_measurements ADD COLUMN installation_status installation_status DEFAULT 'NOT_STARTED';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "takeoff_measurements_version_idx" ON "takeoff_measurements" ("takeoff_version_id");
