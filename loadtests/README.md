# Load tests, performance budgets & capacity plan

This directory contains the [k6](https://k6.io/) suite that proves the
SmartManageAI API holds at the concurrency we promise customers, plus
the per-endpoint performance budgets that gate PRs.

See `docs/ops/capacity.md` for the capacity plan and current bottlenecks.

## Layout

```
loadtests/
├── budgets.json                  # per-endpoint p95 + error-rate budgets
├── check-budgets.mjs             # CI gate: parses k6 summary → fail on regression
├── lib/
│   ├── auth.js                   # VU login + CSRF helper (cached per VU)
│   ├── config.js                 # env-driven profile + thresholds
│   └── endpoints.js              # the canonical "top 20" list
└── scenarios/
    ├── smoke.js                  # ~60s smoke run (PR gate)
    ├── top-endpoints.js          # full nightly run
    └── noisy-neighbor.js         # 1 heavy tenant + N quiet tenants
```

## Profiles

Set `LOAD_PROFILE`:

| Profile   | VUs / shape                                  | When |
| --------- | -------------------------------------------- | ---- |
| `smoke`   | 5 VUs · 60s steady                           | PR gate |
| `baseline`| 25 VUs · 2 min steady                        | Capturing budgets |
| `nightly` | ramp 0→50 over 4 min, hold 5 min, drain 1 min| Nightly CI |
| `spike`   | ramp to 100 VUs                              | Manual ad-hoc |

Override per-run with `LOAD_USERS` / `LOAD_DURATION`.

## Required env

| Var                  | Default                       | Notes |
| -------------------- | ----------------------------- | ----- |
| `BASE_URL`           | `http://localhost:5000`       | Target host (no trailing slash) |
| `LOAD_TENANT_USERS`  | `loadtest@example.com:loadtest` | Comma-separated `email:password` pairs. Provide ≥2 for the noisy-neighbor scenario. |
| `LOAD_PROFILE`       | `smoke`                       | See profile table |
| `LOAD_NOISY_RATIO`   | `0.2`                         | Fraction of VUs that act as the heavy tenant |

## Local run

```sh
# Install k6 once: https://k6.io/docs/getting-started/installation/
brew install k6     # or: choco install k6 / apt-get install k6

# Smoke (single tenant)
BASE_URL=http://localhost:5000 \
LOAD_TENANT_USERS="loadtest@example.com:loadtest" \
  k6 run --summary-export loadtests/results/smoke-summary.json \
         loadtests/scenarios/smoke.js

# Compare against budgets — exits 1 on regression
node loadtests/check-budgets.mjs loadtests/results/smoke-summary.json

# Noisy-neighbor (≥2 tenants)
LOAD_TENANT_USERS="heavy@a.com:pw,quiet@b.com:pw" \
  k6 run -e LOAD_PROFILE=baseline \
         --summary-export loadtests/results/noisy-summary.json \
         loadtests/scenarios/noisy-neighbor.js
node loadtests/check-budgets.mjs --cohort=quiet loadtests/results/noisy-summary.json
```

The convenience runner `scripts/run-load-test.sh` wraps the above and
is what the GitHub workflow calls.

## Editing budgets

`budgets.json` is the single source of truth. Bump a number ONLY with a
PR that explains why (e.g. "added pagination cursor → p95 down 30%, new
budget reflects steady-state"). The schema:

```json
{
  "regressionTolerance": 0.15,         // 15% headroom over the budget
  "endpoints": {
    "GET /api/projects": { "p95Ms": 600, "errorRate": 0.01 }
  }
}
```

Endpoint keys MUST match the `name` field in `lib/endpoints.js`.
