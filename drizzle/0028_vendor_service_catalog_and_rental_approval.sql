CREATE TABLE IF NOT EXISTS "vendor_service_catalog" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "crm_organisation_id" varchar NOT NULL,
  "organization_id" varchar,
  "service_name" text NOT NULL,
  "service_code" text,
  "category" text NOT NULL,
  "description" text,
  "unit" text NOT NULL,
  "rate" numeric(12, 4) NOT NULL,
  "minimum_hours" numeric(10, 2),
  "travel_fee" numeric(10, 2),
  "lead_time_days" integer,
  "approval_status" "pricing_approval_status" DEFAULT 'AUTO_APPROVED',
  "effective_quarter" text NOT NULL,
  "effective_date" timestamp NOT NULL,
  "expiration_date" timestamp,
  "source_type" "pricing_source_type" NOT NULL DEFAULT 'MANUAL',
  "submitted_by_vendor_user_id" varchar,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "vendor_service_catalog_crm_org_idx" ON "vendor_service_catalog" ("crm_organisation_id");
CREATE INDEX IF NOT EXISTS "vendor_service_catalog_org_idx" ON "vendor_service_catalog" ("organization_id");
CREATE INDEX IF NOT EXISTS "vendor_service_catalog_category_idx" ON "vendor_service_catalog" ("category");
CREATE INDEX IF NOT EXISTS "vendor_service_catalog_active_idx" ON "vendor_service_catalog" ("is_active");

ALTER TABLE "rental_equipment_catalog" ADD COLUMN IF NOT EXISTS "organization_id" varchar;
ALTER TABLE "rental_equipment_catalog" ADD COLUMN IF NOT EXISTS "rental_approval_status" "pricing_approval_status" DEFAULT 'AUTO_APPROVED';
ALTER TABLE "rental_equipment_catalog" ADD COLUMN IF NOT EXISTS "rental_source_type" "pricing_source_type" NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "rental_equipment_catalog" ADD COLUMN IF NOT EXISTS "effective_quarter" text;
ALTER TABLE "rental_equipment_catalog" ADD COLUMN IF NOT EXISTS "effective_date" timestamp;
ALTER TABLE "rental_equipment_catalog" ADD COLUMN IF NOT EXISTS "expiration_date" timestamp;
ALTER TABLE "rental_equipment_catalog" ADD COLUMN IF NOT EXISTS "submitted_by_vendor_user_id" varchar;
