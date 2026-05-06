/**
 * Outbound correlation-ID propagation.
 *
 * Monkey-patches the global `fetch` once at boot so every outbound HTTP
 * request from any integration provider (QBO, Sage, DocuSign, Bluebeam,
 * Anthropic, OpenAI, Google, Microsoft, Dropbox, Box, Autodesk, etc.)
 * automatically carries the inbound request's `x-request-id` header.
 *
 * The header is only attached when an ALS correlation context exists for
 * the current call stack — background jobs and boot-time fetches stay
 * un-tagged. The header is also never overwritten if the caller already
 * set one explicitly.
 *
 * See `docs/runbooks/observability.md` for the end-to-end trace story.
 */
import { getCorrelationId } from "../middleware/correlationId";

const HEADER = "x-request-id";

let installed = false;

export function installCorrelatedFetch(): void {
  if (installed) return;
  installed = true;

  const original = globalThis.fetch;
  if (typeof original !== "function") return;

  const wrapped: typeof fetch = async (input, init) => {
    const correlationId = getCorrelationId();
    if (!correlationId) {
      return original(input as any, init);
    }

    let nextInit: RequestInit | undefined = init;

    if (input instanceof Request) {
      if (!input.headers.has(HEADER)) {
        const headers = new Headers(input.headers);
        headers.set(HEADER, correlationId);
        const cloned = new Request(input, { headers });
        return original(cloned, init);
      }
      return original(input as any, init);
    }

    const headers = new Headers(init?.headers ?? {});
    if (!headers.has(HEADER)) {
      headers.set(HEADER, correlationId);
      nextInit = { ...(init ?? {}), headers };
    }

    return original(input as any, nextInit);
  };

  Object.defineProperty(wrapped, "name", { value: "correlatedFetch" });
  globalThis.fetch = wrapped;
}

export function isCorrelatedFetchInstalled(): boolean {
  return installed;
}
