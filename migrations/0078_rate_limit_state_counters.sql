-- Task #2427 — multi-instance correctness for express-rate-limit.
--
-- The autoscale deployment runs N Node replicas behind the load balancer.
-- All five limiters in `server/rateLimiter.ts` (auth/sensitive/api/export
-- /feedback) used the default in-memory MemoryStore, so a client that
-- round-robined across pods could effectively get N times the configured
-- per-window quota — which means the 15/15min auth-burst cap, the
-- 1000/15min API cap, etc. were not actually enforced globally.
--
-- This migration extends the existing `rate_limit_state` table (originally
-- introduced in 0067 as a one-row-per-key debounce store) with two
-- nullable counter columns so the same physical table can back BOTH:
--   1. The Task #1831 debounces (one row per key, only `last_invoked_at`
--      is read/written).
--   2. The Task #2427 express-rate-limit Store (one row per key, sets
--      `hit_count` + `window_expires_at`; `last_invoked_at` is also
--      bumped on every increment so a single TTL sweep can prune both
--      record types).
--
-- Distinct callers use distinct key prefixes (`debounce:` vs `erl:`) so
-- the two record sets never collide on the primary key.
ALTER TABLE "rate_limit_state"
  ADD COLUMN IF NOT EXISTS "hit_count" integer,
  ADD COLUMN IF NOT EXISTS "window_expires_at" timestamptz;

-- Cheap predicate-style index used by the periodic prune so old expired
-- counter rows can be swept without a full table scan once usage grows.
CREATE INDEX IF NOT EXISTS "rate_limit_state_window_expires_idx"
  ON "rate_limit_state" ("window_expires_at")
  WHERE "window_expires_at" IS NOT NULL;
