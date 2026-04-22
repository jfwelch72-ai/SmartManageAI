#!/bin/bash
set -e
npm install
timeout 30 npx tsx scripts/scrub-legacy-roles.ts 2>&1 || echo "[post-merge] legacy role scrub skipped"

# Apply the small set of idempotent SQL migrations that capture schema fixes
# the Drizzle schema relies on but which `drizzle-kit push` may skip when it
# times out. These mirror the list in `server/__tests__/globalSetup.ts`
# (REQUIRED_IDEMPOTENT_MIGRATIONS) so both test runs and post-merge stay in
# sync. Each file MUST be safe to run repeatedly.
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
