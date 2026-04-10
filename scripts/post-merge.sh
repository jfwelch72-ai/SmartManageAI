#!/bin/bash
set -e
npm install
timeout 60 npm run db:push -- --force 2>&1 || echo "[post-merge] db:push skipped or timed out (schema handled by startup migrations)"
