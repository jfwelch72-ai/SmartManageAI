# Status Probe Worker

A tiny edge worker that proxies a single GET request to an allow-listed target.
Used by the `/status` page as a geographically-distinct vantage point so a
regional CDN/DNS outage is caught even when the in-container probe still works.

See `docs/runbooks/status-probe-vantage-points.md` for the operator runbook.

## Endpoints

- `GET /?url=<target>` – proxies the request and mirrors the upstream status.
  Requires `x-probe-token: <PROBE_TOKEN>` when `PROBE_TOKEN` is set.
  `<target>` must appear in the `ALLOWED_TARGETS` comma-separated list.
  If `ALLOWED_TARGETS` is unset/empty the worker fails closed with `503` to
  avoid acting as an open proxy.
- `GET /healthz` – returns `200 ok`. Useful as a smoke test after deploy.

## Deploy (Cloudflare Workers)

Two regions are recommended (e.g. `us-east` and `eu-west`).

```bash
cd probes/cloudflare-worker

# Authenticate once.
npx wrangler login

# Set the shared probe token for each environment.
npx wrangler secret put PROBE_TOKEN --env us_east
npx wrangler secret put PROBE_TOKEN --env eu_west

# Deploy.
npx wrangler deploy --env us_east
npx wrangler deploy --env eu_west
```

After deploying, smoke-test each endpoint:

```bash
curl -H "x-probe-token: $TOKEN" \
  "https://smartmanageai-status-probe-us-east.<account>.workers.dev/?url=https://smartmanageai.ai"
```

Then point production at them by setting `STATUS_PROBE_REGIONS_JSON`
(see runbook for the exact JSON shape).

## Deploying somewhere else

The worker is a single ~80-line script with no Cloudflare-specific APIs beyond
the standard `fetch` handler. It runs unchanged on any Workers-compatible
runtime (Deno Deploy, Bun, Node 20+ behind a reverse proxy, a small VM, etc.)
as long as the same env vars (`PROBE_REGION`, `PROBE_TOKEN`,
`ALLOWED_TARGETS`) are honored.
