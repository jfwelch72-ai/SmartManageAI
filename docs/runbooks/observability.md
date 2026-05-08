# Observability Runbook

This runbook explains how to triage a production error from the moment a user
hits "Something went wrong" through to the responsible code path.

## What's wired up

| Layer | Mechanism | Source |
| --- | --- | --- |
| Correlation ID | `correlationIdMiddleware` (AsyncLocalStorage) | `server/middleware/correlationId.ts` |
| Structured logger | `logDebug/logInfo/logWarn/logError` | `server/utils/logger.ts` |
| Central error middleware | Last `app.use((err, req, res, next) => …)` | `server/index.ts` |
| Database error rows | `errorLogService.persistErrorLog` → `error_logs` table | `server/services/errorLogService.ts` |
| Sentry (server) | Initialized in `server/sentry.ts` (no-op without `SENTRY_DSN`) | `server/sentry.ts` |
| Sentry (browser) | Initialized in `client/src/sentry.ts` (no-op without `VITE_SENTRY_DSN`) | `client/src/sentry.ts` |

## Prompt-injection detection counter (Task #2683)

`/metrics` exposes:

```
ai_prompt_injection_detections_total{route="...",pattern_id="...",action="flagged|refused|quarantined"}
```

Triage a spike:

1. **Identify the noisy series.** Sort by delta over the last 15 min.
   The label tuple tells you which AI surface fired (`route`), which
   attack class (`pattern_id`), and whether the guard refused
   (`action="refused"`) or merely quarantined (`action="quarantined"`).
2. **Pull the audit trail.** Each `refused` increment also writes a
   `logWarn` line with the `correlationId`. Search structured logs for
   the route + correlationId to recover the `userId` /
   `organizationId` and the upload that triggered it.
3. **Decide intent.** A single hit on `pattern_id="role_override"` is
   often a false positive (legitimate spec language like "you are now
   the responsible party"). Two or more co-occurring high-signal
   patterns (`ignore_previous` + `exfiltration`, `role_override` +
   `exfiltration`) is the refusal threshold and almost always
   adversarial.
4. **Block at source if needed.** For repeated adversarial uploads from
   the same actor, suspend the offending user via
   `revokeUserTokens(userId)` and (for an external portal vendor)
   revoke the bid invitation token.

Pattern-id taxonomy and the canonical wiring example live at
`docs/architecture/prompt-injection.md`.

## Required environment variables

| Var | Where | Required? |
| --- | --- | --- |
| `SENTRY_DSN` | Server | Optional. When unset, Sentry is a no-op. |
| `SENTRY_RELEASE` | Server | Optional. Stamps every event with the deployed release tag. |
| `VITE_SENTRY_DSN` | Build-time client env | Optional. When unset, browser Sentry is a no-op. |
| `VITE_SENTRY_RELEASE` | Build-time client env | Optional. |

Both DSNs are scrubbed for PII via `beforeSend` (passwords, tokens, cookies,
auth headers, user emails are dropped). Trace sample rate is 0 — only error
breadcrumbs are sent.

## The correlation ID

Every request gets an ID:

1. If the inbound request carries `x-request-id`, we accept it (must match
   `[A-Za-z0-9._\-:]{6,128}`). Otherwise we generate a UUID v4.
2. We echo it on the response as `x-request-id`.
3. We stash it in AsyncLocalStorage so `logger.ts` automatically attaches it
   to every log line written from inside the request.
4. The central error middleware copies it into the `error_logs` row and into
   the JSON error response (`{ "requestId": "…" }`).
5. Sentry events are tagged with `correlationId=<id>`.

Outbound HTTP calls to other services should forward the same header so the
ID survives across hops:

```ts
import { getCorrelationId } from "../middleware/correlationId";

await fetch(url, {
  headers: { "x-request-id": getCorrelationId() ?? "" },
});
```

## Triaging an error from a correlation ID

When a user reports something like "I got a 500 with requestId
`6f7c…d2`", do this:

### 1. Find it in Sentry (if `SENTRY_DSN` is configured)

In the Sentry UI, open **Issues → Search**:

```
correlationId:6f7c…d2
```

The matching event will show the stack trace, the sanitized request, the
user id (no email), and the breadcrumbs leading up to the throw.

### 2. Find it in `error_logs`

```sql
SELECT created_at, level, status_code, method, path, user_id, organization_id,
       message, substr(stack, 1, 2000) AS stack
FROM error_logs
WHERE request_id = '6f7c…d2'
ORDER BY created_at DESC;
```

This row is the system-of-record for production errors. It carries the same
context Sentry got, plus the IP and User-Agent.

### 3. Find it in stdout / log aggregator

Logs are JSON in production. Search for the correlation ID:

```bash
# Replit logs / your aggregator of choice
grep '"correlationId":"6f7c…d2"' app.log
```

A typical production line:

```json
{
  "timestamp": "2026-05-05T18:13:42.918Z",
  "level": "error",
  "message": "Unhandled error in request",
  "context": {
    "method": "POST",
    "path": "/api/projects/123/estimates",
    "requestId": "6f7c…d2",
    "correlationId": "6f7c…d2",
    "userId": "u_…",
    "organizationId": "org_…",
    "statusCode": 500
  },
  "error": {
    "name": "TypeError",
    "message": "Cannot read properties of undefined (reading 'id')",
    "stack": "TypeError: Cannot read … at handler …"
  }
}
```

## What the user sees

* **Production**: `{ "success": false, "error": "Internal Server Error", "requestId": "…" }`
  for 5xx; their original message for 4xx. No stack traces.
* **Development**: same shape plus `stack` and (when present) `details`.

The `requestId` is what they should quote in support tickets.

## Adding a new log site

Always import from the central logger — never call `console.*`:

```ts
import { logInfo, logWarn, logError } from "./utils/logger";

logInfo("Bid created", { bidId, organizationId });
logError("Bid creation failed", { bidId }, err);
```

CI runs `node scripts/codemod-console-to-logger.mjs --check` to make sure
no `console.*` slips back into `server/`. The two intentional exceptions
(`server/utils/logger.ts` and the migration capture in
`server/utils/runStartupMigrations.ts`) are listed in the codemod's
`ALLOW_LIST`.

## Throwing errors that pass through cleanly

Throw plain `Error` objects (or anything with `.status`/`.statusCode`) and
the central middleware will pick them up:

```ts
const err: any = new Error("Estimate not found");
err.status = 404;
throw err;
```

**Express 4 does NOT auto-forward rejected promises** from async route
handlers — but at boot we install a shim
(`server/utils/expressAsyncShim.ts`, mirroring the popular
`express-async-errors` package) that monkey-patches
`Layer.prototype.handle_request` so any handler returning a rejected
promise is forwarded to `next(err)` automatically. That means a bare
`async (req, res) => { throw … }` in this app will already reach the
central error middleware, persist to `error_logs`, and surface in
Sentry.

You should still prefer one of the explicit patterns below for new
code — it documents intent and keeps the codebase portable to
environments where the shim hasn't been installed (tests built
ad-hoc, scripts spinning up their own Express apps, etc):

```ts
import { asyncHandler } from "@/server/utils/asyncHandler"; // or define inline

app.get("/things/:id", asyncHandler(async (req, res) => {
  const thing = await getOrThrow(req.params.id);
  res.json(thing);
}));
```

The wrapper is one line:

```ts
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res, next)).catch(next);
```

Express 5 fixes this; until we upgrade, the wrapper is the safe default.

## Outbound trace propagation

The inbound `x-request-id` is automatically forwarded on every outbound
`fetch(...)` call (see `server/utils/correlatedFetch.ts`, installed once
at boot from `server/index.ts`). That covers the integration providers
under `server/integrations/providers/**` and the AI providers under
`server/ai/providers/**` because they all use `fetch` (directly or via
the SDKs that delegate to `fetch`). When a vendor exposes the request
ID back to us in a webhook/callback, the inbound correlation middleware
honors that header so the trace closes the loop.

If you add a new integration that uses a non-`fetch` HTTP client (e.g.
`got`, `node:http`), call `getCorrelationId()` from
`server/middleware/correlationId.ts` and set `x-request-id` on the
outbound request yourself.

## Web Vitals quality alert

The frontend RUM pipeline (`client/src/lib/webVitals.ts` →
`POST /api/observability/web-vitals` → `app_web_vitals_*` gauges on
`/metrics`) is alerted on in two places (Task #2525):

| Layer | Source | Channel |
| --- | --- | --- |
| Prometheus / Alertmanager | `ops/prometheus/web-vitals-alerts.rules.yml`, routed via `ops/prometheus/alertmanager-routes.yml` | `#load-test-alerts` (Slack, via Alertmanager) |
| GitHub Actions (every 30m) | `.github/workflows/web-vitals-alert.yml` runs `scripts/check-web-vitals.mjs` | `#load-test-alerts` (Slack, via `SLACK_WEBHOOK_URL` + `notify-slack-on-failure`) |

Both fire when `app_web_vitals_good_ratio{metric="LCP"} < 0.75`
(and the equivalents for `INP` and `CLS`) is sustained for 30 minutes
**and** at least 100 samples have been collected for that metric. The
samples gate keeps a fresh process — autoscale event, deploy — from
paging on the first one or two beacons.

### Triage steps

1. **Confirm the breach is real.** Open `/metrics` (Bearer
   `OPS_METRICS_TOKEN`) and check the `app_web_vitals_good_ratio` and
   `app_web_vitals_samples_total` series. A breach with samples in the
   single hundreds spread over only one replica is usually noise from
   one slow client; cross-check against your Prometheus / Grafana
   dashboard for the same metric across replicas.
2. **Identify which page regressed.** Search the structured logs for
   `rum.web_vitals` and group by `pathname`. The slowest paths bubble
   up via the `values.<METRIC>` field in each beacon line.
3. **Correlate with deploys.** Check the most recent deploy SHA
   against the regression onset. The first suspect for an LCP / INP
   regression is a fat new bundle or a new blocking third-party
   script; for CLS, a recently-changed above-the-fold layout.
4. **If the regression is one tenant.** The aggregator is
   org-agnostic, but the structured `rum.web_vitals` lines carry the
   path. If a single tenant's heavy dashboard view dominates the
   beacons, page that team rather than rolling back globally.
5. **Rolling back.** If the breach started at a deploy boundary,
   revert that deploy. The good-ratio recovers as soon as fresh
   beacons land — the in-memory aggregator resets on each process
   restart, so a redeploy clears the alert as soon as the window
   refills with healthy samples (`for: 30m` will then naturally
   resolve).
6. **Silence vs. ack.** Acknowledge in the Slack thread; only silence
   the alert (Alertmanager UI) if you are actively rolling back and
   expect the breach to clear within the next 30 minutes. The GitHub
   Actions check has no silence — pause it via
   "Disable workflow" in the Actions tab if you must.

### Tuning the thresholds

The 0.75 floor and 100-sample gate live in two files (kept in lockstep):

- `ops/prometheus/web-vitals-alerts.rules.yml` — `< 0.75` and
  `samples_total > 100` per rule.
- `.github/workflows/web-vitals-alert.yml` — `WEB_VITALS_GOOD_RATIO_FLOOR`
  and `WEB_VITALS_MIN_SAMPLES` env vars consumed by
  `scripts/check-web-vitals.mjs`.

If you change one, change the other. The 0.75 number comes from
Google's documented "good" cutoff for Core Web Vitals (see
`docs/ops/capacity.md` § "Frontend Web Vitals").

## Disabling Sentry locally

Just don't set `SENTRY_DSN`. Both `initSentry()` and `initBrowserSentry()`
short-circuit when their DSN is absent, so dev environments never reach out.
