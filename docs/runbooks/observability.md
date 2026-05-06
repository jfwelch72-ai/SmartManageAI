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
handlers. A bare `async (req, res) => { throw … }` will time the request
out and Sentry will never see the error. Always either `try/catch(err) {
next(err) }` or wrap the handler in the shared `asyncHandler`:

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

## Disabling Sentry locally

Just don't set `SENTRY_DSN`. Both `initSentry()` and `initBrowserSentry()`
short-circuit when their DSN is absent, so dev environments never reach out.
