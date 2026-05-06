# SmartManageAI

White-label construction-management SaaS. See `replit.md` for the full feature/architecture overview and `docs/` for deeper references (`docs/WORKFLOWS.md`, `docs/ARCHITECTURE_MAP.md`, `docs/SYSTEM_FEATURE_BIBLE.md`, `docs/runbooks/`).

## Local development

```bash
npm install
npm run db:push     # sync Drizzle schema to your local Postgres
npm run dev         # Express + Vite dev server on $PORT (default 5000)
```

Required env vars for local dev: `DATABASE_URL`, `SESSION_SECRET`, `JWT_SECRET`. See the `environment-secrets` skill notes for managed secrets in Replit.

## Test commands

| Command | What it runs |
| --- | --- |
| `npm run check` | TypeScript typecheck (`tsc`). Covers `client/src/**`, `server/**`, `shared/**` **including `**/*.test.ts`** so test code stays in sync with production types. |
| `npm test` | Vitest unit + integration suites (server, shared, client). Requires a Postgres reachable at `DATABASE_URL`; the global setup pushes the Drizzle schema before suites run. |
| `npm run test:coverage` | Same as `npm test` with v8 coverage written to `coverage/`. |
| `npm run test:e2e` | Playwright end-to-end suite (Chromium / Firefox / WebKit + the touch-enabled `chromium-touch` project). |

Use `npm run test:watch` while developing.

## How CI works

Every pull request and every push to `main` runs `.github/workflows/ci.yml`. The jobs that gate merges are:

- **Build & Test** — `npm ci` → `npm run check` → estimate-component vitest slice → `npm run build`.
- **Unit Tests (vitest)** — `npm ci` → `npm test` against an ephemeral Postgres 16 service.
- **E2E Tests (Playwright)** — `npm ci` → `playwright install --with-deps` → `npm run db:push --force` → all four Playwright projects (`chromium`, `firefox`, `webkit`, `chromium-touch`). Playwright runs with `workers: 4` and `fullyParallel: true` in CI (see `playwright.config.ts`); locally it stays single-worker.
- **E2E Canvas Specs (firefox/webkit × shard 1-2)** + **Merge Canvas Test Reports** — sharded canvas-heavy specs across a 2×2 matrix, then a single merged HTML report.
- **E2E WebKit (Takeoff)** — Safari-only takeoff history coverage.
- **Cloud Import Security Tests**, **Sage Sync Tests** — focused vitest suites that block merges for security- and billing-sensitive surfaces.
- **Code Quality** — repo-specific lint scripts (`scripts/audit-next-without-param.mjs`, `scripts/audit-audit-logger-userid.mjs`).
- **Security Gate (SOC 2 CC8.1 / CC7.1)** — `scripts/ci-security.sh` (semgrep, gitleaks, checkov, dependency + license audits).

On failure, the Playwright HTML report uploads as the `playwright-report` artifact (and `playwright-report-canvas` for the merged canvas runs); vitest coverage uploads as `vitest-coverage`; the security scanner output uploads as `ci-security-report`. Triagers can grab the artifact from the run page without re-running anything.

### Required status checks

The team should mark these checks as **required** in GitHub branch protection for `main`:

- `Build & Test`
- `Unit Tests (vitest)`
- `E2E Tests (Playwright)`
- `E2E Canvas Specs (firefox shard 1/2)` + `(firefox shard 2/2)` + `(webkit shard 1/2)` + `(webkit shard 2/2)`
- `E2E WebKit (Takeoff)`
- `Cloud Import Security Tests`
- `Sage Sync Tests`
- `Code Quality`
- `Security Gate (SOC 2 CC8.1 / CC7.1)`

Failures on `main` also fan out to Slack via `.github/actions/notify-slack-on-failure` when `SLACK_WEBHOOK_URL` is configured.

## Production

- Replit Deployments serves the production build (`npm run build` → `npm start`). See the `deployment` skill for environment-specific runbooks.
- The production database lives in Replit's managed Postgres (Neon). Use the `database` skill for read-only production queries; `npm run db:push` only ever targets the env's `DATABASE_URL`.
