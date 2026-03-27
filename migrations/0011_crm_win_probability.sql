ALTER TABLE "crm_opportunities" ADD COLUMN IF NOT EXISTS "ai_win_probability" integer;
ALTER TABLE "crm_opportunities" ADD COLUMN IF NOT EXISTS "ai_win_probability_rationale" text;
ALTER TABLE "bids" ADD COLUMN IF NOT EXISTS "ai_win_probability" integer;
