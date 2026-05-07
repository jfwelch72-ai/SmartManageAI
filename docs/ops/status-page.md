# Status Page

We run a public status page so customers can self-serve incident
information without opening a support ticket. This document explains
which provider we use, who can post updates, and the standard
update cadence.

## Provider

- **Tool**: BetterStack Status Pages (free tier covers our component
  count). Self-hosted [statping-ng](https://github.com/statping-ng/statping-ng)
  is the documented fallback if we ever need to bring it in-house.
- **Public URL**: `https://status.smartmanage.ai` (CNAME managed in
  Replit DNS → BetterStack).
- **Subscribers**: customers can subscribe via email or webhook from
  the public page.

## Components

The page surfaces these components, each backed by a check we already
run (see `server/statusProbeScheduler.ts` and the Super Admin →
*Status Components* page):

| Component | Backed by | Healthy when… |
| --- | --- | --- |
| Web app | `/healthz` probe from BetterStack | 200 within 5s |
| API | `/readyz` probe from BetterStack | 200 within 5s |
| Database | `/readyz` (DB ping) | DB latency < 1s |
| AI / Takeoff | `statusProbeScheduler` AI providers probe | last sample < 10m, no `failed` |
| Email delivery | `statusProbeScheduler` SendGrid probe | last sample < 30m, no `failed` |
| Object storage | `statusProbeScheduler` GCS probe | last sample < 30m, no `failed` |
| Background jobs | `pool_health` + `app_job_counter_total` | no `waitingSaturated` and no rising `failed` |

When the in-app probe flips a component to *degraded* or *down*, the
on-call must mirror that on the public page within five minutes.

## Posting an incident

Use the standard *Investigating → Identified → Monitoring → Resolved*
lifecycle. Keep updates to two sentences max — what's broken and what
we're doing.

| Stage | When | Template |
| --- | --- | --- |
| Investigating | First five minutes — even if you have no diagnosis yet | "We are investigating elevated error rates on `<component>`. We will post an update within 30 minutes." |
| Identified | Once you know the root cause | "We have identified the cause as `<one-sentence>`. A fix is being applied now." |
| Monitoring | Mitigation deployed, watching metrics | "A fix has been deployed and `<component>` is recovering. We are monitoring." |
| Resolved | Metrics back to baseline for ≥ 15 minutes | "This incident is resolved. A post-mortem will be published within five business days." |

## Who can post

- **Default**: the engineer holding the on-call pager.
- **Backup**: any Super Admin with the BetterStack login (stored in
  the team password manager under *BetterStack Status*).
- **Never**: customer support — they escalate to on-call, who posts.

## Maintenance windows

Schedule at least 48 hours in advance. Open a *Scheduled Maintenance*
event on BetterStack with the affected components and the start/end
window in UTC. Email subscribers automatically get the notice.

## Post-mortem

Within five business days of every customer-visible incident, attach
a public post-mortem to the resolved incident on the status page.
Use the template at `docs/runbooks/observability.md` (triage section)
to gather the timeline and root cause.
