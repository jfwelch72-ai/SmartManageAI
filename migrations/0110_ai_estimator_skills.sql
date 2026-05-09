-- Task #2703 — AI Estimator Skills System
-- Adds ai_estimator_skills table for structured methodology rules that
-- shape every estimate. Supports global / trade / csi_division /
-- project_type scoping with priority ordering.

CREATE TABLE IF NOT EXISTS "ai_estimator_skills" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" varchar REFERENCES "organizations"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "description" text,
  "rule_body" text NOT NULL,
  "scope" text NOT NULL DEFAULT 'global',
  "scope_value" text,
  "priority" integer NOT NULL DEFAULT 100,
  "is_active" boolean NOT NULL DEFAULT true,
  "is_read_only" boolean NOT NULL DEFAULT false,
  "source_type" text NOT NULL DEFAULT 'user_authored',
  "source_lesson_id" varchar,
  "created_by_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "ai_estimator_skills_org_idx" ON "ai_estimator_skills" ("organization_id");
CREATE INDEX IF NOT EXISTS "ai_estimator_skills_org_active_idx" ON "ai_estimator_skills" ("organization_id", "is_active");
CREATE INDEX IF NOT EXISTS "ai_estimator_skills_priority_idx" ON "ai_estimator_skills" ("priority");
