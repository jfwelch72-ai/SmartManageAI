# CRM Transcript Backfill — Heartbeat Staleness Runbook

This runbook documents the `CRM_BACKFILL_HEARTBEAT_STALE_SECONDS` environment
variable (introduced in Task #1078) that controls how long the CRM transcript
backfill waits before declaring a worker dead and reaping its row.

It is aimed at on-call / ops staff who need to tune the lever or explain its
behavior to support.

---

## What it controls

The CRM transcript backfill writes a `heartbeatAt` timestamp to its job row
every time a recording finishes processing (see `persistJobProgress` in
`server/crmCallsRoutes.ts`). Several code paths consult that timestamp to
decide whether the worker that owns a `RUNNING` row is still alive:

- **Boot-time resume** (`crmCallsRoutes.ts` ~line 2193): on server start, a
  `RUNNING` row whose heartbeat is _fresher_ than the staleness window is left
  alone (assumed to be owned by another live instance). A row whose heartbeat
  is _older_ than the window is reaped to `FAILED`.
- **Cancel handler** (`crmCallsRoutes.ts` ~line 3763, `~3989`): the admin
  Cancel button cooperatively asks a fresh-heartbeat worker to stop after the
  current recording, but force-reaps a stale-heartbeat row to `FAILED`
  immediately because the worker is presumed dead.
- **Start-a-new-job guard** (`crmCallsRoutes.ts` ~lines 2675 / 3876): a
  caller trying to start a new backfill while a `RUNNING` row exists is
  rejected if that row's heartbeat is still fresh, and is allowed to take
  over if the heartbeat is stale.
- **Admin UI hint copy** (`client/src/pages/admin-transcript-backfill.tsx`
  ~line 1413): the cross-org Cancel hint reads the live, server-resolved
  window from the notification-config endpoint
  (`heartbeatStaleMs`) so the copy stays in sync with whatever ops has
  configured. See "Cross-references" below.

In short: the staleness window is the **sole knob** that defines "presumed
dead" for the backfill worker.

---

## The setting

| | |
| --- | --- |
| **Env var** | `CRM_BACKFILL_HEARTBEAT_STALE_SECONDS` |
| **Unit** | seconds (parsed as a number, multiplied to ms internally) |
| **Default** | `300` (5 minutes) |
| **Minimum** | `30` (30 seconds) — values below this are clamped up |
| **Maximum** | `3600` (60 minutes) — values above this are clamped down |
| **Invalid / empty** | falls back silently to the default (5 min) |
| **Resolved at** | process start. Restart the server after changing it. |
| **Defined in** | `server/crmCallsRoutes.ts` (`resolveBackfillHeartbeatStaleMs`) |

Bounds rationale:

- **Below 30s** races the heartbeat cadence. The worker only writes
  `heartbeatAt` after each recording finishes (see `persistJobProgress`); a
  long-running transcription can easily exceed any sub-30s threshold and be
  reaped while it is still healthy.
- **Above 60 minutes** effectively disables reaping. A truly-dead worker will
  hold its row in `RUNNING` for an hour before any operator action (cancel,
  resume on boot, or starting a new job) can recover it.

---

## When to change it

The default of **5 minutes** is correct for the typical workload (short call
recordings, transcription completing in well under a minute per row). Consider
raising it when:

- **Recordings are unusually long.** The heartbeat is bumped only when a
  recording finishes processing. A queue of 30+ minute call recordings can
  legitimately leave `heartbeatAt` untouched for the duration of a single
  transcription. If you see healthy jobs being incorrectly reaped to `FAILED`
  on cancel or boot, raise the window above the longest expected per-recording
  transcription time.
- **The transcription provider is degraded / slow.** During an upstream
  outage where individual transcription calls are taking many minutes, raise
  the window temporarily so in-flight jobs are not reaped while waiting on the
  provider.
- **You are debugging a stuck job and want to delay the auto-reap** so an
  engineer can inspect the worker before the row flips to `FAILED`. Raise
  temporarily, then revert.

Consider lowering it (toward the 30s floor) **only** in dev/staging, where
the cost of a false-positive reap is low and you want a snappier "clear the
RUNNING row after a crash" experience. Do **not** lower below the default in
production.

Recommended values:

| Scenario | Suggested value |
| --- | --- |
| Default production | `300` (5 min) — leave unset |
| Long-form recordings (>5 min audio) | `600`–`1200` (10–20 min) |
| Provider degradation / incident mode | `1800` (30 min), revert after |
| Local dev wanting fast reap | `60`–`120` (1–2 min) |

---

## How to change it

1. Set `CRM_BACKFILL_HEARTBEAT_STALE_SECONDS` in the environment for the
   server process (deployment env vars, secrets manager, `.env`, etc.).
2. Restart the server. The value is resolved once at module load
   (`BACKFILL_HEARTBEAT_STALE_MS`) and is not re-read at runtime.
3. Verify the new value is live by hitting the notification-config endpoint
   the admin UI uses; the response includes a `heartbeatStaleMs` field
   (resolved value, in milliseconds, post-clamp).
4. Reload the **Admin → Transcript Backfill** page. The cross-org Cancel hint
   ("…if its heartbeat is older than X minutes the worker is presumed dead…")
   should now show the new window.

If the env var is missing or blank, the resolver falls back to the 5-minute
default silently — that case is treated as "ops did not opt in" and is not
worth a log line. If the env var **is** set but is non-numeric, `<= 0`, or
outside the `[30, 3600]` range, the resolver still falls back / clamps but
also emits a `warn`-level log line at startup naming the bad value and the
default-or-clamped value it used (Task #1126). Grep the boot logs for
`CRM_BACKFILL_HEARTBEAT_STALE_SECONDS` to catch misconfigurations
immediately. To confirm what the server actually resolved post-clamp, check
the `heartbeatStaleMs` field on the notification-config response (step 3).

---

## Interaction with the worker heartbeat cadence

The worker does **not** run on a fixed interval timer. It writes
`heartbeatAt` in the `finally` block of each per-recording iteration inside
`runTranscriptBackfill` (via `persistJobProgress`). In practice this means:

- On a healthy job processing short recordings, the heartbeat is bumped every
  few seconds.
- On a healthy job processing a single very long recording, no heartbeat is
  written until that recording finishes.

The staleness window must therefore be **strictly greater** than the worst
realistic per-recording processing time, with margin for the transcription
provider's tail latency. The 30-second floor exists specifically to prevent
operators from configuring a window narrower than the cadence of even a
short-recording workload.

---

## Cross-references

- **Cross-org Cancel hint copy** — `client/src/pages/admin-transcript-backfill.tsx`
  (search for `text-cross-org-cancel-hint`). The user-facing line
  > "Cancel asks the worker to stop after the current recording. If its
  > heartbeat is older than _N minutes_ the worker is presumed dead and the
  > row is reaped immediately to FAILED."
  reads _N_ from `notificationConfig.heartbeatStaleMs`, which is the
  server-resolved value of this env var. Tuning the env var automatically
  updates this hint — there is no separate copy change to ship.
- **Resolver and clamping logic** — `server/crmCallsRoutes.ts`
  (`resolveBackfillHeartbeatStaleMs`, `BACKFILL_HEARTBEAT_STALE_MS`).
- **Originating task** — Task #1078 (made the threshold configurable and
  surfaced the resolved value to the admin UI).
