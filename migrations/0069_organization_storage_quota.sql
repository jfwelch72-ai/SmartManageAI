-- Task #1955: Re-introduce a per-organization object-storage quota that
-- both the website builder image library and the social-media post media
-- uploader can enforce. The hard 3 GB cap that lived in those routes was
-- removed so users weren't blocked, but with effectively-unlimited
-- per-file caps an org could now upload tens or hundreds of GB without
-- any guardrail.
--
-- The default lifts the ceiling to 100 GB (107,374,182,400 bytes) so
-- existing organizations are not surprised, but the value is now
-- configurable per-org via the admin UI and is enforced server-side.
-- Stored as bigint because byte-sized values for GB-scale quotas
-- overflow Postgres `integer` (max ~2.1 GB). Idempotent ADD COLUMN IF
-- NOT EXISTS so existing deployments pick it up on boot.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS storage_quota_bytes bigint NOT NULL DEFAULT 107374182400;
