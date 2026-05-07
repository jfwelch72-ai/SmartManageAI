// Noisy-neighbor scenario — verifies one heavy tenant cannot blow the
// performance budgets for everyone else. The "heavy" cohort hammers
// expensive endpoints (search, list with no cache hit) while the
// "quiet" cohort stays on the normal read mix and is the one we
// budget against.
//
// Set LOAD_TENANT_USERS to at least two `email:password` pairs:
//   LOAD_TENANT_USERS="heavy@a.com:pw,quiet@b.com:pw"
//
// k6 run -e LOAD_PROFILE=baseline loadtests/scenarios/noisy-neighbor.js \
//        --summary-export loadtests/results/noisy-summary.json
//
// The CI checker is invoked with `--cohort=quiet` so only the quiet
// tenant's metrics are compared against budgets.json.

import http from 'k6/http';
import { sleep, group } from 'k6';
import { Trend, Rate } from 'k6/metrics';
import { BASE_URL, options as buildOptions, parseTenantUsers, noisyRatio } from '../lib/config.js';
import { READ_ENDPOINTS, buildWeightedPool } from '../lib/endpoints.js';
import { loginAllTenants, sessionFor } from '../lib/auth.js';

export const options = buildOptions({
  thresholds: {
    'http_req_failed{cohort:quiet}': ['rate<0.02'],
    'http_req_duration{cohort:quiet}': ['p(95)<2000'],
  },
  tags: { scenario: 'noisy-neighbor' },
});

// Fail fast (before any VU starts) if the runner is misconfigured with
// fewer than two tenants — silently degrading to a single-tenant run
// would let the budget gate report "no quiet metrics" as a SKIP and
// the build would go green without ever exercising noisy-neighbor
// isolation, defeating the whole point of the scenario.
export function setup() {
  const users = parseTenantUsers();
  if (users.length < 2) {
    throw new Error(
      `[noisy-neighbor] requires at least 2 tenants in LOAD_TENANT_USERS, got ${users.length}. ` +
        `Run \`npx tsx scripts/seed-loadtest-user.ts\` (seeds heavy + quiet) or set LOAD_TENANT_USERS to "heavy@x:pw,quiet@y:pw".`,
    );
  }
  // Pre-issue cookies for every configured tenant once. See
  // lib/auth.js — per-VU login bursts would 429 against authLimiter
  // and silently shrink effective concurrency.
  return { tenantCount: users.length, auth: loginAllTenants() };
}

const QUIET_POOL = buildWeightedPool(
  READ_ENDPOINTS.filter((e) => !e.requires && e.auth),
);

// Heavy tenant deliberately chooses the most expensive paths.
const HEAVY_PATHS = [
  '/api/projects?limit=200',
  '/api/bids?limit=200',
  '/api/crm/contacts?limit=200',
  '/api/crm/organizations?limit=200',
  '/api/notifications?limit=200',
  '/api/estimates?limit=200',
];

const trendsQuiet = {};
const errorsQuiet = {};
for (const e of READ_ENDPOINTS) {
  trendsQuiet[e.name] = new Trend(`quiet_dur_${slug(e.name)}`, true);
  errorsQuiet[e.name] = new Rate(`quiet_err_${slug(e.name)}`);
}

export default function (data) {
  const users = parseTenantUsers();
  // setup() already enforced this; the per-iteration check is a
  // belt-and-suspenders so a future refactor that drops setup() can't
  // silently re-introduce the single-tenant bypass.
  if (users.length < 2) return;
  const heavyShare = noisyRatio();
  const isHeavy = (__VU - 1) / Math.max(1, options.vus || 1) < heavyShare;
  const cohort = isHeavy ? 'heavy' : 'quiet';
  const user = isHeavy ? users[0] : users[1 + ((__VU - 1) % (users.length - 1))];
  const session = sessionFor(data.auth, user);
  if (!session.ok) return;

  if (isHeavy) {
    const path = HEAVY_PATHS[Math.floor(Math.random() * HEAVY_PATHS.length)];
    http.get(`${BASE_URL}${path}`, {
      headers: session.headers,
      tags: { cohort, endpoint: 'heavy_burst', name: 'heavy_burst' },
    });
    // Heavy tenant fires back-to-back with minimal think time.
    sleep(0.05);
  } else {
    const ep = QUIET_POOL[Math.floor(Math.random() * QUIET_POOL.length)];
    group(ep.name, () => {
      const res = http.get(`${BASE_URL}${ep.path}`, {
        headers: session.headers,
        tags: { cohort, endpoint: ep.name, name: ep.name },
      });
      trendsQuiet[ep.name].add(res.timings.duration);
      errorsQuiet[ep.name].add(!(res.status >= 200 && res.status < 400));
    });
    sleep(0.3 + Math.random() * 0.4);
  }
}

function slug(s) {
  return s.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').toLowerCase();
}
