/**
 * Express 4 does NOT forward rejected promises from async route handlers
 * to the central error middleware. A bare
 *
 *   app.get("/x", async (req, res) => { throw new Error("nope") })
 *
 * will hang the request, never persist to `error_logs`, and never reach
 * Sentry. The runbook (`docs/runbooks/observability.md`) tells authors
 * to wrap each async handler in `asyncHandler(...)`, but it's easy to
 * forget — and historically several routes in this codebase did, which
 * is what Task #2438 is fixing.
 *
 * This shim monkey-patches Express's internal `Layer.prototype.handle_request`
 * so that every request handler (existing and future) automatically has
 * its returned promise's rejection forwarded to `next(err)`. It is the
 * same approach used by the popular `express-async-errors` package, but
 * vendored here so we don't add a runtime dependency.
 *
 * Express 5 fixes the underlying behavior; once we upgrade we can remove
 * this shim. Until then, calling `installAsyncErrorShim()` exactly once
 * from `server/index.ts` is the safe default — it eliminates an entire
 * class of "hung request, no Sentry event" bugs without requiring
 * authors to remember the wrapper.
 */
import { createRequire } from "node:module";

let installed = false;

export function installAsyncErrorShim(): void {
  if (installed) return;
  // Use createRequire so this works under both CommonJS and ESM builds
  // without baking in an Express path. Resolves the same module Express
  // itself uses internally (a single Layer prototype is shared across
  // all Routers).
  const req = createRequire(import.meta.url);
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Layer = req("express/lib/router/layer");

  const originalHandleRequest = Layer.prototype.handle_request;

  Layer.prototype.handle_request = function patchedHandleRequest(
    request: unknown,
    response: unknown,
    next: (err?: unknown) => void,
  ) {
    const fn = this.handle as (...args: unknown[]) => unknown;
    // 4-arg functions are error handlers — leave them to handle_error.
    if (typeof fn !== "function" || fn.length > 3) {
      return originalHandleRequest.call(this, request, response, next);
    }
    let ret: unknown;
    try {
      ret = fn.call(this, request, response, next);
    } catch (err) {
      return next(err);
    }
    if (ret && typeof (ret as PromiseLike<unknown>).then === "function") {
      Promise.resolve(ret as PromiseLike<unknown>).catch(next);
    }
  };

  installed = true;
}

export function __resetAsyncErrorShimForTests(): void {
  // Test-only helper. The shim mutates a module-level prototype, so
  // re-installing in the same process is a no-op anyway, but resetting
  // the flag lets a test assert that the patch is idempotent.
  installed = false;
}
