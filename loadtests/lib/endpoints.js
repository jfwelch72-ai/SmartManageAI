// The "top 20 endpoints" exercised by the load suite. These were picked
// by frequency in production access logs (read paths dominate). Mutating
// routes are intentionally NOT in the steady-state mix — see
// scenarios/mutations.js for the small write workload.
//
// Each entry's `name` MUST match a key in loadtests/budgets.json so the
// CI checker can map measured p95 → budget.

export const READ_ENDPOINTS = [
  { name: 'GET /healthz',                        path: '/healthz',                        auth: false, weight: 2 },
  { name: 'GET /readyz',                         path: '/readyz',                         auth: false, weight: 1 },
  { name: 'GET /api/auth/me',                    path: '/api/auth/me',                    auth: true,  weight: 8 },
  { name: 'GET /api/dashboard',                  path: '/api/dashboard',                  auth: true,  weight: 6 },
  { name: 'GET /api/projects',                   path: '/api/projects',                   auth: true,  weight: 6 },
  { name: 'GET /api/projects/:id',               path: '/api/projects/__PROJECT__',       auth: true,  weight: 4, requires: 'project' },
  { name: 'GET /api/bids',                       path: '/api/bids',                       auth: true,  weight: 4 },
  { name: 'GET /api/bids/:id',                   path: '/api/bids/__BID__',               auth: true,  weight: 2, requires: 'bid' },
  { name: 'GET /api/estimates',                  path: '/api/estimates',                  auth: true,  weight: 3 },
  { name: 'GET /api/change-orders',              path: '/api/change-orders',              auth: true,  weight: 2 },
  { name: 'GET /api/notifications',              path: '/api/notifications?limit=20',     auth: true,  weight: 5 },
  { name: 'GET /api/notifications/unread-count', path: '/api/notifications/unread-count', auth: true,  weight: 8 },
  { name: 'GET /api/integration-status',         path: '/api/integration-status',         auth: true,  weight: 2 },
  { name: 'GET /api/users/me/preferences',       path: '/api/users/me/preferences',       auth: true,  weight: 2 },
  { name: 'GET /api/feature-flags',              path: '/api/feature-flags',              auth: true,  weight: 4 },
  { name: 'GET /api/crm/contacts',               path: '/api/crm/contacts?limit=25',      auth: true,  weight: 3 },
  { name: 'GET /api/crm/organizations',          path: '/api/crm/organizations?limit=25', auth: true,  weight: 2 },
  { name: 'GET /api/time-clock/status',          path: '/api/time-clock/status',          auth: true,  weight: 3 },
  { name: 'GET /api/rfis',                       path: '/api/rfis?limit=25',              auth: true,  weight: 2 },
  { name: 'GET /api/submittals',                 path: '/api/submittals?limit=25',        auth: true,  weight: 2 },
];

// Build a weighted pool so a simple random index gives proportional traffic.
export function buildWeightedPool(endpoints) {
  const pool = [];
  for (const e of endpoints) {
    for (let i = 0; i < e.weight; i++) pool.push(e);
  }
  return pool;
}
