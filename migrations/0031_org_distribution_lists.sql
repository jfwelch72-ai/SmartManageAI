-- Allow organization-wide email distribution lists by making project_id nullable
-- and adding a partial unique index on (organization_id, name) for org-level lists.

ALTER TABLE "project_email_distribution_lists"
  ALTER COLUMN "project_id" DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "project_email_lists_org_name_uniq"
  ON "project_email_distribution_lists" ("organization_id", "name")
  WHERE "project_id" IS NULL;
