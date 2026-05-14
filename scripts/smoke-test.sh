#!/usr/bin/env bash
# Minimal HTTP smoke test for a booted SmartManageAI server.
#
# Usage:
#   scripts/smoke-test.sh                  # hits http://localhost:5000
#   BASE_URL=https://staging.example.com scripts/smoke-test.sh
#
# Optional — if SUPER_ADMIN_COOKIE is set the script also calls
# GET /api/ops/beta-readiness and asserts all controls are green:
#   SUPER_ADMIN_COOKIE="token=<jwt>" scripts/smoke-test.sh
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

# ── Beta-readiness check ─────────────────────────────────────────────────────
# If SUPER_ADMIN_COOKIE is set, call /api/ops/beta-readiness and assert that
# every control reports ok=true. This catches misconfigured beta environments
# before real users are onboarded.
if [[ -n "${SUPER_ADMIN_COOKIE:-}" ]]; then
  echo "[smoke] Checking /api/ops/beta-readiness ..."
  READINESS_URL="${BASE_URL%/}/api/ops/beta-readiness"
  READINESS_BODY=$(curl -sS \
    --max-time "${TIMEOUT}" \
    -H "Cookie: ${SUPER_ADMIN_COOKIE}" \
    -H "Content-Type: application/json" \
    "${READINESS_URL}" || echo "")

  if [[ -z "${READINESS_BODY}" ]]; then
    echo "[smoke]   beta-readiness -> FAIL (empty response — auth failure or endpoint unreachable)"
    echo "[smoke] FAIL — /api/ops/beta-readiness returned an empty response"
    exit 1
  fi

  READY=$(echo "${READINESS_BODY}" | grep -o '"ready":[^,}]*' | head -1 | grep -o 'true\|false' || echo "")
  # Also verify no individual control reports ok:false — this catches any
  # control that failed but where the top-level ready flag was somehow wrong.
  FAILING_CONTROL=$(echo "${READINESS_BODY}" | grep -o '"ok":false' | head -1 || echo "")

  if [[ "${READY}" == "true" && -z "${FAILING_CONTROL}" ]]; then
    echo "[smoke]   beta-readiness -> OK (all controls green)"
  else
    echo "[smoke]   beta-readiness -> FAIL"
    echo "[smoke]   Response: ${READINESS_BODY}"
    if [[ "${READY}" != "true" ]]; then
      echo "[smoke]   ready flag is not true (got: '${READY}')"
    fi
    if [[ -n "${FAILING_CONTROL}" ]]; then
      echo "[smoke]   one or more controls have ok:false"
    fi
    echo "[smoke] FAIL — beta-readiness check did not pass"
    exit 1
  fi
else
  echo "[smoke] Skipping /api/ops/beta-readiness check (SUPER_ADMIN_COOKIE not set)"
fi

echo "[smoke] OK"
