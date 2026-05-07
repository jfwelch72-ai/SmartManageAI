#!/usr/bin/env bash
# Baseline CI script for SmartManageAI.
#
# Runs the green-baseline checks documented in CONTRIBUTING.md:
#   1. TypeScript typecheck
#   2. Production build
#   3. Boot the built server and HTTP-smoke-test it
#
# Designed to be runnable locally and from CI in the same way. Honors:
#   PORT       (default 5000)
#   BASE_URL   (default http://localhost:${PORT})
#   SKIP_TYPECHECK=1   skip step 1 (e.g. while the typecheck backlog is
#                       being burned down — see CONTRIBUTING.md)
#   SKIP_BUILD=1       skip step 2
#   SKIP_SMOKE=1       skip step 3

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

PORT="${PORT:-5000}"
export PORT
BASE_URL="${BASE_URL:-http://localhost:${PORT}}"
export BASE_URL

fail=0

run_step() {
  local label="$1"; shift
  echo ""
  echo "=========================================="
  echo "[ci] ${label}"
  echo "=========================================="
  if "$@"; then
    echo "[ci] ${label} OK"
  else
    echo "[ci] ${label} FAILED" >&2
    fail=1
  fi
}

if [[ "${SKIP_TYPECHECK:-0}" != "1" ]]; then
  run_step "typecheck (npm run check)" npm run check
else
  echo "[ci] SKIP typecheck (SKIP_TYPECHECK=1)"
fi

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  run_step "build (npm run build)" npm run build
else
  echo "[ci] SKIP build (SKIP_BUILD=1)"
fi

if [[ "${SKIP_SMOKE:-0}" != "1" ]]; then
  echo ""
  echo "=========================================="
  echo "[ci] smoke test"
  echo "=========================================="
  # Boot the built server in the background, smoke-test it, then kill it.
  if [[ ! -f "dist/index.js" ]]; then
    echo "[ci] dist/index.js missing — cannot smoke test (was build skipped?)" >&2
    fail=1
  else
    NODE_ENV=production node dist/index.js &
    server_pid=$!
    cleanup() {
      if kill -0 "${server_pid}" 2>/dev/null; then
        kill "${server_pid}" 2>/dev/null || true
        wait "${server_pid}" 2>/dev/null || true
      fi
    }
    trap cleanup EXIT

    # Wait for the server to bind its port (max ~30s).
    for i in $(seq 1 30); do
      if curl -sS -o /dev/null --max-time 2 "${BASE_URL}/" 2>/dev/null; then
        break
      fi
      sleep 1
    done

    if bash "${ROOT}/scripts/smoke-test.sh"; then
      echo "[ci] smoke test OK"
    else
      echo "[ci] smoke test FAILED" >&2
      fail=1
    fi

    cleanup
    trap - EXIT
  fi
else
  echo "[ci] SKIP smoke (SKIP_SMOKE=1)"
fi

if [[ "${fail}" -ne 0 ]]; then
  echo ""
  echo "[ci] one or more steps FAILED" >&2
  exit 1
fi

echo ""
echo "[ci] all steps OK"
