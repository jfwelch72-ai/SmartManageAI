#!/bin/bash
set -e
npm install
timeout 30 npx tsx scripts/scrub-legacy-roles.ts 2>&1 || echo "[post-merge] legacy role scrub skipped"
timeout 60 npm run db:push -- --force 2>&1 || echo "[post-merge] db:push skipped or timed out (schema handled by startup migrations)"
