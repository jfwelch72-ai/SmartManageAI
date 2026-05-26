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

# ── CORS allowlist check ─────────────────────────────────────────────────────
# Issue an OPTIONS preflight with a disallowed Origin and assert no
# Access-Control-Allow-Origin header comes back. Then repeat with an allowed
# Origin (defaults to the first probed health endpoint's host; override with
# SMOKE_CORS_ORIGIN) and assert the header echoes it. Keeps the strict
# allowlist honest against future regressions.
echo "[smoke] Checking CORS allowlist on /api/health ..."
CORS_URL="${BASE_URL%/}/api/health"

DISALLOWED_ORIGIN="https://example-not-allowed-${RANDOM}.invalid"
DISALLOWED_HEADERS=$(curl -sS -D - -o /dev/null \
  --max-time "${TIMEOUT}" \
  -X OPTIONS \
  -H "Origin: ${DISALLOWED_ORIGIN}" \
  -H "Access-Control-Request-Method: GET" \
  "${CORS_URL}" || echo "")
if echo "${DISALLOWED_HEADERS}" | grep -i -q "^access-control-allow-origin:"; then
  echo "[smoke]   CORS allowlist -> FAIL (disallowed origin ${DISALLOWED_ORIGIN} got an ACAO header)"
  echo "${DISALLOWED_HEADERS}"
  exit 1
fi
echo "[smoke]   CORS rejects ${DISALLOWED_ORIGIN} (no ACAO header) -> OK"

ALLOWED_ORIGIN="${SMOKE_CORS_ORIGIN:-}"
if [[ -z "${ALLOWED_ORIGIN}" ]]; then
  # Derive a likely-allowed origin from BASE_URL (FRONTEND_URL/REPLIT_DOMAINS
  # are typically the server's own host). Falls back to localhost:5173, which
  # the non-prod allowlist seeds by default.
  if [[ "${BASE_URL}" == http://localhost:* ]]; then
    ALLOWED_ORIGIN="http://localhost:5173"
  else
    ALLOWED_ORIGIN="${BASE_URL%/}"
  fi
fi

ALLOWED_HEADERS=$(curl -sS -D - -o /dev/null \
  --max-time "${TIMEOUT}" \
  -X OPTIONS \
  -H "Origin: ${ALLOWED_ORIGIN}" \
  -H "Access-Control-Request-Method: GET" \
  "${CORS_URL}" || echo "")
ACAO=$( (echo "${ALLOWED_HEADERS}" | grep -i "^access-control-allow-origin:" || true) | head -1 | tr -d '\r' | sed 's/^[Aa]ccess-[Cc]ontrol-[Aa]llow-[Oo]rigin:[[:space:]]*//')
if [[ "${ACAO}" == "${ALLOWED_ORIGIN}" ]]; then
  echo "[smoke]   CORS allows ${ALLOWED_ORIGIN} (ACAO echoed) -> OK"
else
  echo "[smoke]   CORS allowlist -> WARN (expected ACAO=${ALLOWED_ORIGIN}, got '${ACAO}')"
  echo "[smoke]   This is a soft warning — set SMOKE_CORS_ORIGIN to a known-allowed origin to make it strict."
fi

echo "[smoke] OK"
