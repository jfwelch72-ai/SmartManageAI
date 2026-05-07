// Full nightly load test — exercises all top-20 endpoints with realistic
// per-endpoint weighting, ramps to the configured concurrency, and
// resolves real entity ids (project, bid) up-front so the `:id` reads
// return real payloads instead of 404s.
//
// k6 run -e LOAD_PROFILE=nightly loadtests/scenarios/top-endpoints.js \
//        --summary-export loadtests/results/nightly-summary.json

import http from 'k6/http';
import { sleep, group } from 'k6';
import { Trend, Rate } from 'k6/metrics';
import { BASE_URL, options as buildOptions, parseTenantUsers } from '../lib/config.js';
import { READ_ENDPOINTS, buildWeightedPool } from '../lib/endpoints.js';
import { loginAllTenants, sessionFor } from '../lib/auth.js';

export const options = buildOptions({
  thresholds: {
    'http_req_failed': ['rate<0.02'],
    'http_req_duration': ['p(95)<2000'],
  },
  tags: { scenario: 'top-endpoints' },
});

// k6 invokes setup() exactly once in a dedicated init VU. Logging in
// here (instead of per-VU) means the auth limiter is hit once per
// tenant for the whole run, regardless of how high the configured VU
// count climbs — which is the whole point: per-VU login was 429ing
// most of the ramp from a single GitHub-runner IP.
export function setup() {
  return { auth: loginAllTenants() };
}

const trends = {};
const errors = {};
for (const e of READ_ENDPOINTS) {
  trends[e.name] = new Trend(`dur_${slug(e.name)}`, true);
  errors[e.name] = new Rate(`err_${slug(e.name)}`);
}

const POOL = buildWeightedPool(READ_ENDPOINTS);
const TENANTS = parseTenantUsers();

// Per-VU resolved sample ids so the `:id` endpoints see real rows.
const sampleIds = {}; // __VU -> { project, bid }

export default function (data) {
  const user = TENANTS[(__VU - 1) % TENANTS.length];
  const session = sessionFor(data.auth, user);

  if (!sampleIds[__VU]) sampleIds[__VU] = resolveSampleIds(session);
  const ids = sampleIds[__VU];

  const ep = POOL[Math.floor(Math.random() * POOL.length)];
  if (ep.requires === 'project' && !ids.project) return;
  if (ep.requires === 'bid' && !ids.bid) return;

  const path = ep.path
    .replace('__PROJECT__', ids.project || '_first_')
    .replace('__BID__', ids.bid || '_first_');

  group(ep.name, () => {
    const res = http.get(`${BASE_URL}${path}`, {
      headers: ep.auth ? session.headers : undefined,
      tags: { endpoint: ep.name, name: ep.name },
    });
    trends[ep.name].add(res.timings.duration);
    errors[ep.name].add(!(res.status >= 200 && res.status < 400));
  });

  sleep(0.1 + Math.random() * 0.3);
}

function resolveSampleIds(session) {
  const out = { project: null, bid: null };
  try {
    const p = http.get(`${BASE_URL}/api/projects?limit=1`, { headers: session.headers, tags: { name: 'sample_projects' } });
    if (p.status === 200) {
      const body = p.json();
      const first = Array.isArray(body) ? body[0] : (body?.data?.[0] || body?.items?.[0]);
      if (first?.id) out.project = first.id;
    }
  } catch (_e) {}
  try {
    const b = http.get(`${BASE_URL}/api/bids?limit=1`, { headers: session.headers, tags: { name: 'sample_bids' } });
    if (b.status === 200) {
      const body = b.json();
      const first = Array.isArray(body) ? body[0] : (body?.data?.[0] || body?.items?.[0]);
      if (first?.id) out.bid = first.id;
    }
  } catch (_e) {}
  return out;
}

function slug(s) {
  return s.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').toLowerCase();
}
