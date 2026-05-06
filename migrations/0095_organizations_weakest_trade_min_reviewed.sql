-- Task #2464 — per-org "weakest trade" callout threshold.
--
-- Adds `organizations.weakest_trade_min_reviewed` so the /profile
-- "weakest trade" heads-up can be tuned per tenant. Default of 5
-- mirrors the historical hardcoded `WEAKEST_TRADE_MIN_REVIEWED` in
-- client/src/pages/profile.tsx so existing orgs see no behavior
-- change. Constants live in shared/schema/core.ts
-- (WEAKEST_TRADE_MIN_REVIEWED_DEFAULT/MIN/MAX).
--
-- Idempotent: safe to replay against a DB where the boot-time
-- reconcileSchemaDrift already added the column.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS weakest_trade_min_reviewed integer NOT NULL DEFAULT 5;
