-- Task #2487 — Customer onboarding, data import/export & privacy.
--
-- Adds the three lifecycle tables that back the "Data Management" UI:
--   * org_csv_imports        — dry-run + commit history for CSV imports
--   * org_exports            — async ZIP-export jobs ("export my org")
--   * org_deletion_requests  — soft-delete + scheduled hard-delete flow
--
-- All three are tenant-scoped via organization_id and inherit the global
-- tenant_isolation RLS policy installed in 0096_enable_tenant_rls.sql via
-- server/utils/ensureRlsPolicies.ts on boot.
--
-- Idempotent: safe to re-apply.

CREATE TABLE IF NOT EXISTS "org_csv_imports" (
  "id"             varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "entity_type"    varchar(40) NOT NULL,
  "status"         varchar(20) NOT NULL DEFAULT 'DRY_RUN',
  "total_rows"     integer NOT NULL DEFAULT 0,
  "valid_rows"     integer NOT NULL DEFAULT 0,
  "error_rows"     integer NOT NULL DEFAULT 0,
  "inserted_rows"  integer NOT NULL DEFAULT 0,
  "errors"         jsonb DEFAULT '[]'::jsonb,
  "file_name"      text,
  "created_by_id"  varchar NOT NULL REFERENCES "users"("id"),
  "created_at"     timestamp NOT NULL DEFAULT now(),
  "completed_at"   timestamp
);
CREATE INDEX IF NOT EXISTS "org_csv_imports_org_idx" ON "org_csv_imports" ("organization_id");

CREATE TABLE IF NOT EXISTS "org_exports" (
  "id"             varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "status"         varchar(20) NOT NULL DEFAULT 'PENDING',
  "object_key"     text,
  "bytes"          integer,
  "error_message"  text,
  "requested_by_id" varchar NOT NULL REFERENCES "users"("id"),
  "emailed_to"     text,
  "created_at"     timestamp NOT NULL DEFAULT now(),
  "completed_at"   timestamp,
  "expires_at"     timestamp
);
CREATE INDEX IF NOT EXISTS "org_exports_org_idx" ON "org_exports" ("organization_id");

CREATE TABLE IF NOT EXISTS "org_deletion_requests" (
  "id"             varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "status"         varchar(20) NOT NULL DEFAULT 'AWAITING_CONFIRMATION',
  "reason"         text,
  "confirmation_token"   varchar(80) NOT NULL UNIQUE,
  "confirmation_sent_to" text NOT NULL,
  "requested_by_id" varchar NOT NULL REFERENCES "users"("id"),
  "confirmed_at"   timestamp,
  "hard_delete_scheduled_at" timestamp,
  "hard_deleted_at" timestamp,
  "cancelled_at"   timestamp,
  "cancelled_by_id" varchar REFERENCES "users"("id"),
  "created_at"     timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "org_deletion_requests_org_idx" ON "org_deletion_requests" ("organization_id");
CREATE INDEX IF NOT EXISTS "org_deletion_requests_status_idx" ON "org_deletion_requests" ("status");
