// Smoke load test — runs on every PR. Hits a representative subset of
// the read endpoints from `lib/endpoints.js` for ~60s with 5 VUs and
// emits a JSON summary that `loadtests/check-budgets.mjs` can compare
// against `loadtests/budgets.json`.
//
// k6 run loadtests/scenarios/smoke.js --summary-export loadtests/results/smoke-summary.json

import http from 'k6/http';
import { sleep, group } from 'k6';
import { Trend, Rate } from 'k6/metrics';
import { BASE_URL, parseTenantUsers } from '../lib/config.js';
import { options as buildOptions } from '../lib/config.js';
import { READ_ENDPOINTS, buildWeightedPool } from '../lib/endpoints.js';
import { loginAllTenants, sessionFor } from '../lib/auth.js';

export const options = buildOptions({
  thresholds: {
    'http_req_failed': ['rate<0.05'],
    'http_req_duration{endpoint:GET /healthz}': ['p(95)<100'],
    'http_req_duration{endpoint:GET /readyz}':  ['p(95)<400'],
  },
  tags: { scenario: 'smoke' },
});

const endpointTrends = {};
const endpointErrors = {};
for (const e of READ_ENDPOINTS) {
  endpointTrends[e.name] = new Trend(`dur_${slug(e.name)}`, true);
  endpointErrors[e.name] = new Rate(`err_${slug(e.name)}`);
}

// Smoke runs without resolving real entity ids, so endpoints that
// require a `:id` placeholder are excluded — otherwise they would
// hammer 404s and breach error budgets that the checker is supposed
// to enforce. The nightly scenario fetches a real id and exercises
// those routes for real.
const POOL = buildWeightedPool(READ_ENDPOINTS.filter((e) => !e.requires));
const TENANTS = parseTenantUsers();
const NEEDS_AUTH = POOL.some((e) => e.auth);

// Setup-time login (see lib/auth.js for rationale): per-VU login bursts
// would 429 against the auth limiter and silently shrink effective load.
export function setup() {
  if (!NEEDS_AUTH) return { auth: {} };
  return { auth: loginAllTenants() };
}

export default function (data) {
  let session = null;
  if (NEEDS_AUTH) {
    const user = TENANTS[(__VU - 1) % TENANTS.length];
    session = sessionFor(data.auth, user);
  }

  const ep = POOL[Math.floor(Math.random() * POOL.length)];
  if (ep.auth && (!session || !session.ok)) return;

  group(ep.name, () => {
    const res = http.get(`${BASE_URL}${ep.path}`, {
      headers: ep.auth ? session.headers : undefined,
      tags: { endpoint: ep.name, name: ep.name },
    });
    endpointTrends[ep.name].add(res.timings.duration);
    endpointErrors[ep.name].add(!(res.status >= 200 && res.status < 400));
  });

  sleep(0.2 + Math.random() * 0.4);
}

function slug(s) {
  return s.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').toLowerCase();
}
