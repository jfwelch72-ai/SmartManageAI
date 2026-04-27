-- Task #2143: Self-serve "Request access" flow.
--
-- When a user hits a 403 (e.g. exporting an estimate PDF without
-- `hasManagementAccess`), the friendlier 403 toast now offers a
-- "Request access" action that POSTs an `access_requests` row and fans
-- out an in-app + email notification to org admins. Admins approve or
-- deny from the new "Access requests" tab in /company-settings?tab=users.
-- Approval bumps the user's role to `requested_role` (when set) and/or
-- flips the requested permission flags on `user_dashboard_permissions`.
-- Denial sends the requester a short note explaining why.
--
-- Indexes:
--   * (organization_id, status) — admin queue list (pending first).
--   * (requester_user_id) — user's own "My requests" view.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'access_request_status') THEN
    CREATE TYPE access_request_status AS ENUM ('PENDING', 'APPROVED', 'DENIED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "access_requests" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  "requester_user_id" varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "requested_role" user_role,
  "requested_permissions" text[],
  "feature_context" text,
  "reason" text NOT NULL,
  "status" access_request_status NOT NULL DEFAULT 'PENDING',
  "decided_by_id" varchar REFERENCES users(id) ON DELETE SET NULL,
  "decided_at" timestamp,
  "decision_note" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "access_requests_org_status_idx"
  ON "access_requests" ("organization_id", "status");
CREATE INDEX IF NOT EXISTS "access_requests_requester_idx"
  ON "access_requests" ("requester_user_id");

-- Ensure the notification_type enum carries the values inserted by the
-- access request fan-out. Older databases may have skipped the enum entry
-- if their startup migration ran before this task shipped.
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'ACCESS_REQUEST_NEW';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'ACCESS_REQUEST_APPROVED';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'ACCESS_REQUEST_DENIED';
