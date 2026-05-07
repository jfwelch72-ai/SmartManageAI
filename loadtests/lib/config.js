// Shared k6 config helpers. Reads tunables from environment variables so
// the same scripts can run locally, in CI smoke mode, or against a real
// staging URL.
//
//   BASE_URL           default http://localhost:5000
//   LOAD_PROFILE       smoke | baseline | nightly | spike  (default smoke)
//   LOAD_USERS         override target VUs for the active profile
//   LOAD_DURATION      override stage duration (e.g. "60s", "5m")
//   LOAD_TENANT_USERS  comma-separated list of "email:password" pairs
//                      to rotate through; defaults to a single dev user.
//   LOAD_NOISY_RATIO   fraction (0-1) of VUs that act as the heavy
//                      tenant in the noisy-neighbor scenario.

export const BASE_URL = (__ENV.BASE_URL || 'http://localhost:5000').replace(/\/$/, '');

export const PROFILE = (__ENV.LOAD_PROFILE || 'smoke').toLowerCase();

const PROFILES = {
  // Fast PR-gate run: a handful of VUs, ~60 seconds, fails the build on
  // budget regressions but is cheap enough to run on every push.
  smoke: {
    vus: 5,
    duration: '60s',
    stages: null,
  },
  // Baseline used to (re)capture budgets — moderate steady load.
  baseline: {
    vus: 25,
    duration: '2m',
    stages: null,
  },
  // Full nightly run: ramps up to target concurrency over 10 minutes.
  nightly: {
    vus: 50,
    duration: null,
    stages: [
      { duration: '1m', target: 10 },
      { duration: '3m', target: 50 },
      { duration: '5m', target: 50 },
      { duration: '1m', target: 0 },
    ],
  },
  // Burst test — push to find the next bottleneck.
  spike: {
    vus: 100,
    duration: null,
    stages: [
      { duration: '30s', target: 25 },
      { duration: '30s', target: 100 },
      { duration: '1m',  target: 100 },
      { duration: '30s', target: 0 },
    ],
  },
};

export function options(extra = {}) {
  const cfg = PROFILES[PROFILE] || PROFILES.smoke;
  const userOverride = __ENV.LOAD_USERS ? Number(__ENV.LOAD_USERS) : null;
  const durOverride = __ENV.LOAD_DURATION || null;

  const base = cfg.stages && !userOverride && !durOverride
    ? { stages: cfg.stages }
    : {
        vus: userOverride || cfg.vus,
        duration: durOverride || cfg.duration || '1m',
      };

  return {
    ...base,
    // Default thresholds — individual scenarios add per-endpoint
    // thresholds via tagged trends. Global ceiling guards against
    // catastrophic regressions even if endpoint tags are missing.
    thresholds: {
      http_req_failed: ['rate<0.05'],
      http_req_duration: ['p(95)<2000'],
      ...(extra.thresholds || {}),
    },
    // Turn off TLS verification for self-signed dev certs.
    insecureSkipTLSVerify: true,
    // Useful tags for downstream analysis.
    tags: {
      profile: PROFILE,
      ...(extra.tags || {}),
    },
    ...Object.fromEntries(
      Object.entries(extra).filter(([k]) => k !== 'thresholds' && k !== 'tags'),
    ),
  };
}

export function parseTenantUsers() {
  // Default matches the two tenants seeded by
  // `scripts/seed-loadtest-user.ts` so the noisy-neighbor scenario has
  // a realistic heavy-vs-quiet split out of the box.
  const raw =
    __ENV.LOAD_TENANT_USERS ||
    'loadtest-heavy@example.com:loadtest,loadtest-quiet@example.com:loadtest';
  return raw
    .split(',')
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const [email, password] = pair.split(':');
      return { email, password };
    });
}

export function noisyRatio() {
  const v = Number(__ENV.LOAD_NOISY_RATIO || '0.2');
  if (Number.isNaN(v) || v < 0 || v > 1) return 0.2;
  return v;
}
