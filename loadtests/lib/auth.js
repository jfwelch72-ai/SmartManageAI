// Tiny k6 helper that logs the configured tenants in ONCE during k6's
// `setup()` lifecycle and shares the resulting cookie + CSRF tokens with
// every VU via setupData. Per-VU `login()` was incompatible with the
// server's `authLimiter` (15 attempts / 15 min / IP, see
// `server/rateLimiter.ts`): a 50-VU nightly ramp from a single GitHub
// runner IP would 429 the majority of logins and silently collapse the
// declared concurrency, invalidating any capacity conclusions.
//
// Usage from a scenario:
//
//   import { loginAllTenants, sessionFor } from '../lib/auth.js';
//   export function setup() { return { auth: loginAllTenants() }; }
//   export default function (data) {
//     const session = sessionFor(data.auth, user);
//     http.get(url, { headers: session.headers });
//   }

import http from 'k6/http';
import { check, fail } from 'k6';
import { BASE_URL, parseTenantUsers } from './config.js';

const AUTH_COOKIE_NAME = 'auth_token'; // matches `COOKIE_NAME` in server/auth.ts

// Logs every tenant in `LOAD_TENANT_USERS` exactly once and returns a
// map keyed by lowercased email. Call from `setup()` only — never from
// the per-iteration default function.
export function loginAllTenants() {
  const users = parseTenantUsers();
  const sessions = {};
  for (const user of users) {
    // Prime CSRF cookie. Each call inside `setup()` runs in a single
    // dedicated init-VU, so all priming + login traffic comes from one
    // logical source and uses the auth limiter budget once per tenant.
    const seed = http.get(`${BASE_URL}/api/integration-status`, {
      tags: { name: 'auth_seed', endpoint: 'auth_seed' },
    });
    const csrf = extractCookie(seed, 'csrf_token');

    const res = http.post(
      `${BASE_URL}/api/auth/login`,
      JSON.stringify({ email: user.email, password: user.password }),
      {
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrf || '',
        },
        tags: { name: 'POST /api/auth/login', endpoint: 'POST /api/auth/login' },
      },
    );
    const ok = check(res, {
      [`setup login 2xx for ${user.email}`]: (r) => r.status >= 200 && r.status < 300,
    });
    if (!ok) {
      // Fail the whole run rather than let VUs proceed without a
      // session — masking auth failures was the original capacity-
      // conclusion footgun this rewrite is here to fix.
      fail(`[auth.setup] login failed for ${user.email}: status=${res.status}`);
    }

    const authCookie = extractCookie(res, AUTH_COOKIE_NAME);
    if (!authCookie) {
      fail(`[auth.setup] no ${AUTH_COOKIE_NAME} cookie issued for ${user.email}`);
    }

    sessions[user.email.toLowerCase()] = {
      cookie: `${AUTH_COOKIE_NAME}=${authCookie}; csrf_token=${csrf || ''}`,
      csrf: csrf || '',
      email: user.email,
    };
  }
  return sessions;
}

// Returns a headers bundle a VU can pass directly to http.get/post.
// Cookies are sent via the explicit `Cookie` header (instead of k6's
// per-VU jar) so the single setup-issued JWT is reused across all VUs
// without anyone re-hitting `/api/auth/login`.
export function sessionFor(authMap, user) {
  const key = (user && user.email ? user.email : '').toLowerCase();
  const s = authMap[key];
  if (!s) {
    fail(`[auth] no preloaded session for ${user && user.email}`);
  }
  return {
    user,
    ok: true,
    csrf: s.csrf,
    headers: {
      Cookie: s.cookie,
      'x-csrf-token': s.csrf,
      'Content-Type': 'application/json',
    },
  };
}

function extractCookie(res, name) {
  const sc = res.headers['Set-Cookie'] || res.headers['set-cookie'];
  if (sc) {
    const m = String(sc).match(new RegExp(`${name}=([^;]+)`));
    if (m) return decodeURIComponent(m[1]);
  }
  // Fallback: k6's per-VU cookie jar (works inside setup()).
  const jar = http.cookieJar();
  const cookies = jar.cookiesForURL(BASE_URL);
  if (cookies && cookies[name]) {
    return Array.isArray(cookies[name]) ? cookies[name][0] : cookies[name];
  }
  return null;
}
