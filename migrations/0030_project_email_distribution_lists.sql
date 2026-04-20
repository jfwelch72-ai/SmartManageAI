-- Reusable named distribution lists for project email blasts (e.g. Gantt sends).
-- Stores a snapshot of selected directory contact emails plus any free-form
-- extra emails the sender typed in. Scoped to organization + project.

CREATE TABLE IF NOT EXISTS "project_email_distribution_lists" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "project_id" varchar NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "contact_emails" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "extra_emails" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "created_by_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "project_email_lists_org_idx"
  ON "project_email_distribution_lists" ("organization_id");

CREATE INDEX IF NOT EXISTS "project_email_lists_project_idx"
  ON "project_email_distribution_lists" ("project_id");

CREATE UNIQUE INDEX IF NOT EXISTS "project_email_lists_project_name_uniq"
  ON "project_email_distribution_lists" ("project_id", "name");
