-- Task #2056: Persistent, cross-replica backing store for the short-lived
-- OAuth state values issued by the Apple Sign-In initiator and consumed by
-- the cross-site form_post callback. Previously this lived in a per-process
-- in-memory Map (`server/oauthStateStore.ts`), which silently broke whenever:
--   1. The Node process restarted (e.g. a deploy) between the user clicking
--      "Continue with Apple" and Apple posting the callback back, or
--   2. Traffic was load-balanced across more than one replica and the
--      callback POST landed on a different pod than the initiator.
-- Both cases bounced the user to "Your Apple sign-in session expired or was
-- blocked by your browser." Storing the state in Postgres lets every replica
-- see every issued state for the full ~10-minute TTL, and the atomic
-- `DELETE ... WHERE expires_at > now() RETURNING` consume preserves the
-- one-time-use semantics under concurrent callbacks.
--
-- The `state` column is a 32-byte random hex string (256 bits of entropy),
-- so it is globally unique on its own and serves as the primary key. The
-- `provider` column is namespaced by the caller so an Apple state cannot be
-- consumed as a Google state.
CREATE TABLE IF NOT EXISTS "oauth_state" (
  "state" text PRIMARY KEY,
  "provider" text NOT NULL,
  "expires_at" timestamptz NOT NULL
);

-- Supports the periodic background sweep that purges expired rows so the
-- table doesn't grow unboundedly (consume already filters on expires_at,
-- but rejected/abandoned flows would otherwise leak rows for the TTL).
CREATE INDEX IF NOT EXISTS "oauth_state_expires_at_idx"
  ON "oauth_state" ("expires_at");
