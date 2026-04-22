#!/bin/bash
set -e
npm install
timeout 30 npx tsx scripts/scrub-legacy-roles.ts 2>&1 || echo "[post-merge] legacy role scrub skipped"

# Apply a small set of idempotent SQL migrations that capture schema fixes
# the Drizzle schema relies on but which `drizzle-kit push` may skip when it
# times out against this dev DB. The vitest globalSetup no longer needs
# these (it rebuilds the test DB from `drizzle-kit export`), but they are
# still useful here to keep the populated dev DB in sync without waiting
# for a full destructive rebuild. Each file MUST be safe to run repeatedly.
if [ -n "$DATABASE_URL" ] && command -v psql >/dev/null 2>&1; then
  for f in \
    migrations/add_users_quiet_hours_digest_locale_format.sql \
    migrations/add_offline_entity_types_field_sync.sql; do
    if [ -f "$f" ]; then
      echo "[post-merge] Applying idempotent migration $f"
      psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f" \
        || echo "[post-merge] Failed to apply $f (continuing)"
    fi
  done
fi

timeout 60 npm run db:push -- --force 2>&1 || echo "[post-merge] db:push skipped or timed out (schema handled by startup migrations)"
