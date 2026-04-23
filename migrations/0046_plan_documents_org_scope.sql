-- Task #491 — DBE/MBE/WBE certification documents need full revision
-- history just like surety bonds and material certs. Org certs are not
-- project-scoped, so plan_documents.project_id can no longer be NOT NULL.
--
-- This migration is mirrored at boot by
-- server/utils/ensurePlanDocumentsOrgScope.ts and
-- server/utils/ensureCrmOrgCertDocumentColumn.ts so fresh checkouts that
-- never run drizzle-kit still get the schema applied.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'plan_document_scope') THEN
    CREATE TYPE "plan_document_scope" AS ENUM ('PROJECT', 'ORG');
  END IF;
END$$;

ALTER TABLE "plan_documents"
  ADD COLUMN IF NOT EXISTS "scope" "plan_document_scope" NOT NULL DEFAULT 'PROJECT';

ALTER TABLE "plan_documents"
  ADD COLUMN IF NOT EXISTS "organization_id" varchar
  REFERENCES "organizations"("id") ON DELETE CASCADE;

ALTER TABLE "plan_documents" ALTER COLUMN "project_id" DROP NOT NULL;

UPDATE "plan_documents" pd
SET "organization_id" = p."gc_organization_id"
FROM "projects" p
WHERE pd."organization_id" IS NULL
  AND pd."project_id" IS NOT NULL
  AND pd."project_id" = p."id";

CREATE INDEX IF NOT EXISTS "plan_documents_org_idx" ON "plan_documents" ("organization_id");

ALTER TABLE "crm_organisation_certifications"
  ADD COLUMN IF NOT EXISTS "document_id" varchar
  REFERENCES "plan_documents"("id") ON DELETE SET NULL;
