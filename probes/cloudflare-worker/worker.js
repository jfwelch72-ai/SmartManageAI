// Status page probe worker.
//
// Deploy this script as a Cloudflare Worker (or any equivalent edge runtime)
// in a region you control. It accepts `GET /?url=<target>` and proxies a GET
// request to the target, returning the upstream status code and body. The
// `/status` page scheduler uses workers like this as geographically-distinct
// vantage points (see `server/statusProbeScheduler.ts` and
// `docs/runbooks/status-probe-vantage-points.md`).
//
// Behaviour:
//   * Only the URL listed in ALLOWED_TARGETS (set as a Worker secret/var) is
//     proxied. This prevents the worker from being abused as an open proxy.
//   * Requests must include the `x-probe-token` header matching PROBE_TOKEN
//     when PROBE_TOKEN is configured. Unauthenticated requests get 401.
//   * The upstream status code is mirrored so the scheduler's `2xx == ok`
//     check works without translation.
//   * A 15s upstream timeout is enforced to bound worker CPU time.

const UPSTREAM_TIMEOUT_MS = 15_000;

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function parseAllowed(env) {
  const raw = (env.ALLOWED_TARGETS || "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") {
      return new Response("ok", { status: 200 });
    }
    if (request.method !== "GET") {
      return jsonError(405, "method not allowed");
    }
    const expectedToken = (env.PROBE_TOKEN || "").trim();
    if (expectedToken) {
      const provided = request.headers.get("x-probe-token") || "";
      if (provided !== expectedToken) return jsonError(401, "unauthorized");
    }
    const target = url.searchParams.get("url");
    if (!target) return jsonError(400, "missing ?url= parameter");

    const allowed = parseAllowed(env);
    if (allowed.length === 0) {
      // Fail closed: refuse to act as an open proxy when no allow-list is set.
      return jsonError(503, "ALLOWED_TARGETS not configured");
    }
    if (!allowed.includes(target)) {
      return jsonError(403, "target not in ALLOWED_TARGETS");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const upstream = await fetch(target, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: { "user-agent": "smartmanageai-status-probe/1.0" },
      });
      const body = await upstream.arrayBuffer();
      return new Response(body, {
        status: upstream.status,
        headers: {
          "content-type":
            upstream.headers.get("content-type") || "application/octet-stream",
          "x-probe-region": env.PROBE_REGION || "unknown",
          "cache-control": "no-store",
        },
      });
    } catch (err) {
      const aborted = err && err.name === "AbortError";
      return jsonError(
        aborted ? 504 : 502,
        aborted ? `upstream timeout after ${UPSTREAM_TIMEOUT_MS}ms` : String(err),
      );
    } finally {
      clearTimeout(timer);
    }
  },
};
