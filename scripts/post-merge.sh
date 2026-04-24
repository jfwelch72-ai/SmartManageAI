#!/bin/bash
set -e
npm install
timeout 30 npx tsx scripts/scrub-legacy-roles.ts 2>&1 || echo "[post-merge] legacy role scrub skipped"

# Sync the populated dev DB schema using a hash-based fast path.
#
# `scripts/dev-schema-sync.ts` computes a SHA-256 of `shared/schema/*` and
# `drizzle.config.ts`, compares it against `_dev_schema_meta.schema_hash`
# stored inside the dev DB, and:
#   * skips entirely on a hash hit (~1-2s — the common post-merge case
#     where the merge didn't change `shared/schema/*`), or
#   * runs `drizzle-kit push --force` to apply an additive diff and then
#     stamps the new hash (the rare path; capped by
#     DEV_SCHEMA_PUSH_TIMEOUT_MS, default 180s).
#
# This replaces the previous "apply hand-curated idempotent SQL files
# then attempt push with a 60s timeout" path, which routinely timed out
# and required maintaining a whitelist of `migrations/add_*.sql` fixups.
# See DATABASE_MIGRATION_STRATEGY.md for details.
timeout 200 npx tsx scripts/dev-schema-sync.ts 2>&1 \
  || echo "[post-merge] dev schema sync skipped or failed (schema handled by startup migrations)"

# Task #1866 — keep Playwright's bundled WebKit launchable on the Replit
# dev container. The setup script is idempotent: when WebKit is already
# installed and patched it is a no-op (~50ms). When the WebKit cache is
# wiped or upgraded by `npx playwright install` it re-applies the
# `MiniBrowser` LD_LIBRARY_PATH fix so `--project=webkit` keeps working.
# Failures are tolerated so a Playwright cache hiccup never blocks merges.
timeout 60 bash scripts/setup-playwright-webkit.sh 2>&1 \
  || echo "[post-merge] playwright webkit setup skipped or failed (run scripts/setup-playwright-webkit.sh manually)"
