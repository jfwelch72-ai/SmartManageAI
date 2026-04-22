# Status Page Vantage Points (Multi-Region Probes)

The `/status` page probes each public component (notably the "Web application")
from one or more vantage points. A component only flips to a failing state when
the majority of vantage points agree it is failing. Running with more than one
vantage point catches geo-specific outages (regional CDN/DNS issues) that a
single in-container probe would miss.

Probe wiring lives in `server/statusProbeScheduler.ts`.

## Defaults

- **Development**: only the in-container `local` vantage point runs. Public HTTP
  proxies are intentionally off so flaky third parties don't generate false
  alerts during day-to-day development.
- **Production**: `STATUS_ENABLE_REMOTE_PROBES=true` is set so `local` plus the
  bundled remote vantage points (`corsproxy-io`, `allorigins-eu`) all run. That
  gives at least three signals, including one geographically distinct from the
  Replit container, before consensus flips the component status.

## Environment variables

| Variable | Effect |
| --- | --- |
| `STATUS_ENABLE_REMOTE_PROBES` | When truthy (`1`/`true`/`yes`), enables the bundled remote vantage points (`corsproxy-io`, `allorigins-eu`) alongside `local`. Ignored when `STATUS_PROBE_REGIONS_JSON` is set. |
| `STATUS_PROBE_REGIONS_JSON` | JSON array of `{ region, proxyTemplate? }`. When provided, replaces the default vantage list entirely. Use `{url}` as the placeholder in `proxyTemplate`; it will be filled with the URL-encoded target. Omit `proxyTemplate` to probe directly from the local container under that region label. |
| `STATUS_PUBLIC_WEB_URL` | Overrides the public URL probed for the "Web application" component. Defaults to `https://smartmanageai.ai`. |
| `STATUS_DISABLE_PUBLIC_WEB_PROBE` | Truthy disables the public web probe entirely (probes report `ok` with a "disabled" note). |

## Adding or removing a vantage point

1. **Quickest path** (use the bundled proxies):
   - Production already has `STATUS_ENABLE_REMOTE_PROBES=true`. Toggle it off
     in the Secrets pane (Production scope) to fall back to `local`-only.
2. **Custom list** (recommended when you have a dedicated proxy/edge worker):
   - Set `STATUS_PROBE_REGIONS_JSON` in the Production environment to a JSON
     array. Example with three regions:
     ```json
     [
       { "region": "local" },
       { "region": "us-east", "proxyTemplate": "https://us-east-probe.example.com/?url={url}" },
       { "region": "eu-west", "proxyTemplate": "https://eu-west-probe.example.com/?url={url}" }
     ]
     ```
   - When `STATUS_PROBE_REGIONS_JSON` is present it fully replaces the bundled
     list, so include `local` (no `proxyTemplate`) if you still want the
     in-container signal.
3. Restart the deployment. The next probe sweep (within 60s) will start writing
   rows for the new regions and the `/status` page will render a region pill per
   vantage point next to the "Web application" component.

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

- Public proxies (`corsproxy.io`, `api.allorigins.win`) are best-effort. If they
  start producing chronic false negatives, switch to a custom
  `STATUS_PROBE_REGIONS_JSON` list pointing at infrastructure you control.
- Probe results older than 35 days are pruned automatically by the scheduler.
- Alert thresholds are evaluated after every sweep
  (`server/statusAlertService.ts`); the consensus rule above is what feeds it.
