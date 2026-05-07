#!/usr/bin/env bash
# Minimal HTTP smoke test for a booted SmartManageAI server.
#
# Usage:
#   scripts/smoke-test.sh                  # hits http://localhost:5000
#   BASE_URL=https://staging.example.com scripts/smoke-test.sh
#
# Exits 0 when at least one of the probed endpoints returns a 2xx/3xx
# status. Designed for local pre-push checks and CI; intentionally
# does NOT spin up the server itself so the caller can decide how to
# host it (workflow, `npm start`, Docker, etc).

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:5000}"
TIMEOUT="${SMOKE_TIMEOUT:-10}"
PATHS=("/healthz" "/api/health" "/")

echo "[smoke] Probing ${BASE_URL} (timeout=${TIMEOUT}s)"

ok=0
for p in "${PATHS[@]}"; do
  url="${BASE_URL%/}${p}"
  status=$(curl -sS -o /dev/null -w "%{http_code}" --max-time "${TIMEOUT}" "${url}" || echo "000")
  echo "[smoke]   ${p} -> ${status}"
  if [[ "${status}" =~ ^[23][0-9][0-9]$ ]]; then
    ok=1
  fi
done

if [[ "${ok}" -ne 1 ]]; then
  echo "[smoke] FAIL — no probed endpoint returned 2xx/3xx"
  exit 1
fi

echo "[smoke] OK"
