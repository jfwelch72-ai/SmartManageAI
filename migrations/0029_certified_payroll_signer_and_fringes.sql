-- Add WH-347 / certified-payroll signer + contractor + default fringe option
-- to organization payroll settings, plus per-classification fringe-rate
-- breakdown columns to prevailing_wage_rates.

ALTER TABLE "organization_payroll_settings"
  ADD COLUMN IF NOT EXISTS "signer_name" text,
  ADD COLUMN IF NOT EXISTS "signer_title" text,
  ADD COLUMN IF NOT EXISTS "contractor_address" text,
  ADD COLUMN IF NOT EXISTS "default_fringe_option" text NOT NULL DEFAULT 'PLAN';

ALTER TABLE "prevailing_wage_rates"
  ADD COLUMN IF NOT EXISTS "fringe_health_rate" numeric(10, 2) NOT NULL DEFAULT '0',
  ADD COLUMN IF NOT EXISTS "fringe_pension_rate" numeric(10, 2) NOT NULL DEFAULT '0',
  ADD COLUMN IF NOT EXISTS "fringe_vacation_rate" numeric(10, 2) NOT NULL DEFAULT '0',
  ADD COLUMN IF NOT EXISTS "fringe_training_rate" numeric(10, 2) NOT NULL DEFAULT '0';
