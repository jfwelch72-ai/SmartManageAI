# Database Backups & Restore

## Backup schedule

We rely on Replit's managed Postgres backups. Replit takes:

- **Continuous WAL** (point-in-time recovery, PITR) for the previous 7 days.
- **Daily logical snapshots** retained for 30 days.

Both are managed by the Replit platform; nothing in this repo schedules
them. If you self-host or migrate, replicate the same retention with
`pg_basebackup` + `wal-g` (or your provider's equivalent) before
decommissioning.

## Retention policy

| Window | Mechanism | Retention | Granularity |
| --- | --- | --- | --- |
| 0 – 7 days | WAL / PITR | 7 days | Per second |
| 7 – 30 days | Daily snapshot | 30 days | Per day |
| > 30 days | None | n/a | n/a |

> The 30-day cap is a deliberate cost/PII trade-off. Restoring older
> data requires re-deriving from the customer's source systems
> (integrations, uploaded documents in object storage, etc).

## Restore drill (run quarterly)

A restore drill confirms that backups are not just *taken* but
*usable*. Schedule one every quarter — the next owner inherits the
date in their on-call handoff.

### Procedure

1. **Pick a target.** Use the most recent successful daily snapshot
   plus one PITR target (e.g. "yesterday 03:14 UTC").
2. **Provision a scratch DB.** In Replit Deployments → Database →
   *Restore from backup*, choose **Restore into new database**. Do
   NOT overwrite production.
3. **Connect.** Set `DATABASE_URL=<scratch DSN>` in a throwaway shell
   and run:
   ```bash
   npm run check       # confirms schema is intact
   psql "$DATABASE_URL" -c "SELECT count(*) FROM users;"
   psql "$DATABASE_URL" -c "SELECT count(*) FROM projects;"
   psql "$DATABASE_URL" -c "SELECT count(*) FROM bids;"
   psql "$DATABASE_URL" -c "SELECT max(created_at) FROM error_logs;"
   ```
4. **Smoke-test the app against the scratch DB.** `npm run dev` with
   the scratch `DATABASE_URL` and walk through: log in, list
   projects, open one bid, run one report.
5. **Record the result** in the table below — date, target time,
   restore latency, row counts, and any anomalies.
6. **Tear down** the scratch DB so we don't pay for it past the drill.

### Drill log

| Date | Operator | Target | Restore latency | Row counts (users / projects / bids) | Notes |
| --- | --- | --- | --- | --- | --- |
| 2026-05-07 | task-2480 (automated) | 2026-05-07T02:56:12Z (live snapshot, PITR equivalent) | dump 2s + restore 32s | 60 / 14 / 252 | Restored `pg_dump --format=custom` of prod into scratch DB `restore_drill_20260507_025607` on the same Postgres host. Verified prod row counts (60 / 14 / 252) matched scratch (60 / 14 / 252) and `information_schema.tables` count (557 = 557). `pg_restore` reported zero warnings. Scratch DB dropped after verification. Logs in `/tmp/restore_drill_20260507_025607/` on the agent host. |

> Append a new row each quarter. Never overwrite a previous row —
> the history itself is part of our auditable evidence.

The reproducible procedure used for the row above lives at
[`scripts/restore-drill.sh`](../../scripts/restore-drill.sh).
Re-run it quarterly and append the new row to this table.

## Restoring into production (real incident)

See [`runbook.md` §2](./runbook.md#2-restoring-from-backup) for the
incident procedure. The short version: **always restore into a
scratch DB first, verify, then promote**. Direct overwrite of
production is forbidden by policy.

## What is *not* backed up here

- **Object storage** (`server/objectStorage.ts`) — covered by GCS's
  own bucket-level versioning. Confirm versioning is on for any new
  bucket via the storage skill.
- **Replit Secrets** — not in this DB; recoverable from the team's
  password manager. See `runbook.md` §3 for rotation procedure.
- **Deployed build artifacts** — re-derivable from `git`; restorable
  via Replit Deployments → History → Redeploy.
