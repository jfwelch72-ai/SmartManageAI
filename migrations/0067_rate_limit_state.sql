-- Task #1831: Cross-replica backing store for the per-key debounces that
-- previously lived in module-level Maps inside
-- `server/projectLogEmailScheduleRoutes.ts` (`sendNowLastInvocation` and
-- `testDigestLastInvocation`). Module-level state is per-process, so the
-- same in-memory Map cannot enforce a debounce window across multiple
-- Node replicas behind a load balancer — a user clicking "Send now"
-- could fan out N sends, one per replica, instead of one. This table
-- moves the "last successful claim" timestamp into Postgres so a single
-- `INSERT ... ON CONFLICT DO UPDATE ... WHERE` statement can atomically
-- gate the next attempt regardless of how many pods are serving traffic.
--
-- `key` is opaque to the table; callers prefix their own namespace
-- (e.g. `send-now:<schedule-id>`, `test-digest:<organization-id>`) so
-- distinct debounces can't collide on the same primary key.
CREATE TABLE IF NOT EXISTS "rate_limit_state" (
  "key" text PRIMARY KEY,
  "last_invoked_at" timestamptz NOT NULL DEFAULT now()
);
