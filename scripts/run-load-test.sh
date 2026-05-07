#!/usr/bin/env bash
# Convenience wrapper around the k6 load tests + budget checker.
#
# Usage:
#   scripts/run-load-test.sh smoke
#   scripts/run-load-test.sh nightly
#   scripts/run-load-test.sh noisy
#
# Honors the same env vars as the k6 scripts (BASE_URL, LOAD_PROFILE,
# LOAD_TENANT_USERS, LOAD_NOISY_RATIO, LOAD_USERS, LOAD_DURATION).
#
# Exits 0 when budgets pass, 1 on regression, 2 on missing prerequisite
# (k6 not installed, server not reachable).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

mode="${1:-smoke}"
BASE_URL="${BASE_URL:-http://localhost:5000}"
export BASE_URL
RESULTS_DIR="${ROOT}/loadtests/results"
mkdir -p "${RESULTS_DIR}"

if ! command -v k6 >/dev/null 2>&1; then
  echo "[load] k6 binary not found on PATH."
  echo "[load] Install: https://k6.io/docs/getting-started/installation/"
  echo "[load] CI installs k6 via grafana/setup-k6-action."
  exit 2
fi

# Wait for the target to come up (max 30s).
for i in $(seq 1 30); do
  if curl -sS -o /dev/null --max-time 2 "${BASE_URL}/healthz" 2>/dev/null; then
    break
  fi
  sleep 1
done
if ! curl -sS -o /dev/null --max-time 2 "${BASE_URL}/healthz" 2>/dev/null; then
  echo "[load] target ${BASE_URL} is not reachable" >&2
  exit 2
fi

run_k6() {
  local scenario="$1"; shift
  local summary="$1"; shift
  k6 run \
    --summary-export "${summary}" \
    --quiet \
    "$@" \
    "loadtests/scenarios/${scenario}"
}

case "${mode}" in
  smoke)
    SUM="${RESULTS_DIR}/smoke-summary.json"
    run_k6 smoke.js "${SUM}" -e LOAD_PROFILE=smoke
    node loadtests/check-budgets.mjs "${SUM}"
    ;;
  nightly)
    SUM="${RESULTS_DIR}/nightly-summary.json"
    run_k6 top-endpoints.js "${SUM}" -e LOAD_PROFILE=nightly
    # Nightly is the canonical full-coverage run: every endpoint in
    # budgets.json MUST be measured. If a required endpoint is missing
    # (e.g. seed user lost its access, or someone added a budget without
    # adding it to the scenario), fail loudly.
    node loadtests/check-budgets.mjs --require-all "${SUM}"
    ;;
  baseline)
    SUM="${RESULTS_DIR}/baseline-summary.json"
    run_k6 top-endpoints.js "${SUM}" -e LOAD_PROFILE=baseline
    node loadtests/check-budgets.mjs --require-all "${SUM}"
    ;;
  noisy|noisy-neighbor)
    SUM="${RESULTS_DIR}/noisy-summary.json"
    run_k6 noisy-neighbor.js "${SUM}" -e LOAD_PROFILE=baseline
    # The noisy scenario only exercises the auth'd, no-`requires` subset
    # of the top-endpoint mix for the quiet cohort (the heavy cohort
    # generates the contention; we don't budget against its noise).
    # Coverage of every budget entry is the nightly job's contract;
    # here we only assert that the quiet cohort's *measured* endpoints
    # stay within budget despite the heavy neighbour. Hence no
    # `--require-all` — that would be unsatisfiable by construction.
    #
    # `--min-measured=5` is the coverage floor: the quiet cohort pool
    # has 8 candidate endpoints, so falling under 5 measured indicates
    # either (a) the heavy cohort starved the quiet cohort to the point
    # of zero successful requests on most paths — exactly the
    # regression this scenario is meant to detect — or (b) the auth
    # fixture didn't seed and login() failed. Both should fail the run.
    node loadtests/check-budgets.mjs --cohort=quiet --min-measured=5 "${SUM}"
    ;;
  spike)
    SUM="${RESULTS_DIR}/spike-summary.json"
    run_k6 top-endpoints.js "${SUM}" -e LOAD_PROFILE=spike
    # Spike is informational — we do NOT fail the build on a spike
    # regression, we just keep the summary for analysis.
    node loadtests/check-budgets.mjs "${SUM}" || true
    ;;
  *)
    echo "[load] unknown mode: ${mode}"
    echo "[load] valid modes: smoke | baseline | nightly | noisy | spike"
    exit 2
    ;;
esac
