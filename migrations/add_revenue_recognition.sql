CREATE TABLE IF NOT EXISTS "revenue_recognition" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "project_id" varchar NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "period" varchar(7) NOT NULL,
  "snapshot_date" date NOT NULL,
  "contract_value" decimal(14, 2) DEFAULT '0',
  "change_order_adjustments" decimal(14, 2) DEFAULT '0',
  "adjusted_contract_value" decimal(14, 2) DEFAULT '0',
  "costs_to_date" decimal(14, 2) DEFAULT '0',
  "estimated_total_cost" decimal(14, 2) DEFAULT '0',
  "percent_complete" decimal(7, 4) DEFAULT '0',
  "earned_revenue" decimal(14, 2) DEFAULT '0',
  "billings_to_date" decimal(14, 2) DEFAULT '0',
  "over_under_billing" decimal(14, 2) DEFAULT '0',
  "gross_profit" decimal(14, 2) DEFAULT '0',
  "gross_profit_percent" decimal(7, 4) DEFAULT '0',
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "rev_rec_org_idx" ON "revenue_recognition" ("organization_id");
CREATE INDEX IF NOT EXISTS "rev_rec_project_idx" ON "revenue_recognition" ("project_id");
CREATE INDEX IF NOT EXISTS "rev_rec_period_idx" ON "revenue_recognition" ("period");
CREATE INDEX IF NOT EXISTS "rev_rec_snapshot_idx" ON "revenue_recognition" ("snapshot_date");
CREATE UNIQUE INDEX IF NOT EXISTS "rev_rec_project_period_idx" ON "revenue_recognition" ("project_id", "period");
