# Status Page Vantage Points (Multi-Region Probes)

The `/status` page probes each public component (notably the "Web application")
from one or more vantage points. A component only flips to a failing state when
the majority of vantage points agree it is failing. Running with more than one
vantage point catches geo-specific outages (regional CDN/DNS issues) that a
single in-container probe would miss.

Probe wiring lives in `server/statusProbeScheduler.ts`. The probe worker source
that backs the remote vantage points lives in `probes/cloudflare-worker/`.

## Current production topology

Production runs three vantage points:

| Region label | Source | Notes |
| --- | --- | --- |
| `local` | In-container `fetch` from the Replit deployment | Always present. |
| `us-east` | Status probe Worker we operate | Deployed from `probes/cloudflare-worker/` (env `us_east`). |
| `eu-west` | Status probe Worker we operate | Deployed from `probes/cloudflare-worker/` (env `eu_west`). |

Two of the three must report failure for the consensus rule to flip a
component, so a single regional blip will not page anyone.

The previous setup that routed through public CORS proxies
(`corsproxy.io`, `api.allorigins.win`) has been retired – those third-party
proxies were themselves rate-limited often enough to add noise. The
`STATUS_ENABLE_REMOTE_PROBES` flag is now a no-op (it logs a deprecation
notice on startup if still set).

## Defaults

- **Development**: only the in-container `local` vantage point runs. No remote
  probes by default.
- **Production**: `STATUS_PROBE_REGIONS_JSON` enumerates `local` plus the two
  Worker endpoints we operate.

## Environment variables

| Variable | Effect |
| --- | --- |
| `STATUS_PROBE_REGIONS_JSON` | JSON array of `{ region, proxyTemplate? }`. Replaces the default vantage list entirely. Use `{url}` as the placeholder in `proxyTemplate`; it will be filled with the URL-encoded target. Omit `proxyTemplate` to probe directly from the local container under that region label. |
| `STATUS_PUBLIC_WEB_URL` | Overrides the public URL probed for the "Web application" component. Defaults to `https://smartmanageai.ai`. |
| `STATUS_DISABLE_PUBLIC_WEB_PROBE` | Truthy disables the public web probe entirely (probes report `ok` with a "disabled" note). |
| `STATUS_ENABLE_REMOTE_PROBES` | **Deprecated/no-op.** Previously enabled bundled public CORS proxies. Use `STATUS_PROBE_REGIONS_JSON` instead. |

## Production STATUS_PROBE_REGIONS_JSON

The current production value (collapsed to one line for the secrets pane):

```json
[
  { "region": "local" },
  { "region": "us-east", "proxyTemplate": "https://smartmanageai-status-probe-us-east.<workers-subdomain>.workers.dev/?url={url}" },
  { "region": "eu-west", "proxyTemplate": "https://smartmanageai-status-probe-eu-west.<workers-subdomain>.workers.dev/?url={url}" }
]
```

Replace `<workers-subdomain>` with the account's `workers.dev` subdomain (or a
custom hostname if the workers are routed through one). The shared
`PROBE_TOKEN` is enforced **inside** the worker via the `x-probe-token` header
– the scheduler currently does not send custom headers, so leave `PROBE_TOKEN`
unset on the worker if you want unauthenticated probes, or front the workers
with a Cloudflare Access policy / IP allow list instead.

## Adding or rotating a vantage point

1. **Deploy a new worker** in the desired region:
   ```bash
   cd probes/cloudflare-worker
   npx wrangler deploy --env <region_env>
   ```
   See `probes/cloudflare-worker/README.md` for the full deploy walkthrough.
2. **Smoke-test it**:
   ```bash
   curl -i "https://<worker-host>/?url=https://smartmanageai.ai"
   ```
   You should see the public site's status code mirrored back.
3. **Update `STATUS_PROBE_REGIONS_JSON`** in the Production secrets pane to
   include (or remove) the entry. Keep an odd total so the majority rule has a
   clear winner; three vantage points is the sweet spot.
4. **Restart the deployment.** Within ~60s the scheduler will start writing
   probe rows for the new region and the `/status` page will render a region
   pill per vantage point next to the "Web application" component.

## Verifying after a change

- Open `/status` in production. The "Web application" row should display one
  pill per configured vantage point.
- In SQL, recent probe rows can be inspected with:
  ```sql
  SELECT region, ok, status_code, response_ms, error, checked_at
  FROM status_probes
  WHERE component_id = (SELECT id FROM status_components WHERE key = 'web')
  ORDER BY checked_at DESC
  LIMIT 20;
  ```
- A component is only marked failing when **strictly more than half** of the
  vantage points report failure in a sweep. With three vantage points that
  means at least two must fail before the public status flips.

## Operational notes

- Probe results older than 35 days are pruned automatically by the scheduler.
- The 90-day uptime chart is backed by a daily rollup retained for ~13 months.
- Alert thresholds are evaluated after every sweep
  (`server/statusAlertService.ts`); the consensus rule above is what feeds it.
- If a Worker region goes down for an extended period, remove it from
  `STATUS_PROBE_REGIONS_JSON` rather than letting it perpetually fail – the
  consensus rule will otherwise treat it as a permanent failing vote.
