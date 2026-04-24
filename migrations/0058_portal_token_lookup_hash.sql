-- Task #1614 — index-driven portal-token lookup.
--
-- `requirePortalAuth` was selecting every active, non-expired row from
-- `subcontractor_portal_tokens` and bcrypt-comparing each one. As external
-- doc emails (Task #1599) ramp up the active token set grows linearly with
-- every invitation, so each portal page load was paying an O(N) bcrypt
-- cost. bcrypt's per-hash salt makes a direct hash-equality lookup
-- impossible, so we add a deterministic lookup key — HMAC-SHA256 of the
-- raw token using SESSION_SECRET — populated alongside the bcrypt hash
-- and indexed for an O(1) "find the candidate row" query. The bcrypt hash
-- in `token_hash` is still verified against the candidate row so the
-- final auth decision is unchanged.
--
-- Backfill: existing rows can't be backfilled because we never persist
-- the raw token. The column is therefore nullable; the auth path falls
-- back to scanning the (bounded) set of legacy rows where
-- `token_lookup_hash IS NULL` and opportunistically backfills them on a
-- successful bcrypt match. Once the legacy rows have all been
-- re-authenticated, expired, or revoked the fallback drains to zero.

ALTER TABLE subcontractor_portal_tokens
  ADD COLUMN IF NOT EXISTS token_lookup_hash text;

CREATE INDEX IF NOT EXISTS sub_portal_tokens_token_lookup_idx
  ON subcontractor_portal_tokens(token_lookup_hash);
