-- Operator-managed list of recipients for Gantt PDF queue/disconnect alerts.
-- When at least one row exists here, it overrides both the GANTT_PDF_ALERT_EMAILS
-- env var fallback and the active-super-admin fallback in server/gantt-pdf-alerts.ts.

CREATE TABLE IF NOT EXISTS "gantt_pdf_alert_recipients" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "email" text NOT NULL UNIQUE,
  "notify_in_app" boolean NOT NULL DEFAULT true,
  "user_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
