# Business Continuity & Disaster Recovery Policy

| Owner | CTO |
| ----- | --- |
| Approver | CEO |
| Review cadence | Annual; after each drill |

## 1. Purpose

Define the Company's commitments and procedures for keeping the Service
available, recovering from disasters, and continuing critical business
functions during disruptive events.

## 2. Recovery objectives

| Tier | System | RTO | RPO |
| ---- | ------ | --- | --- |
| 1 | Production application + Postgres database | 4 hours | 15 minutes |
| 1 | Object storage (customer files) | 4 hours | 0 (cross-region replicated) |
| 2 | Email / notification pipeline | 24 hours | 1 hour |
| 2 | Internal admin tools | 24 hours | 1 hour |
| 3 | Marketing site | 72 hours | 24 hours |

RTO = Recovery Time Objective. RPO = Recovery Point Objective.

## 3. Backup strategy

- **Postgres** (Neon): point-in-time recovery enabled with a 7-day window.
  Daily logical dumps are written to a separate cloud account's GCS bucket
  with 30-day retention and object-lock.
- **Object storage** (GCS): turn on cross-region replication for all
  buckets that hold customer files.
- **Configuration / IaC**: source controlled in git; mirrored to a
  separate VCS organization.

## 4. Drills

- **Backup restore drill**: quarterly. Run
  `runbooks/backup-restore-drill.md`. Restore the most recent backup to
  an isolated environment, validate that the database is queryable and
  that a sample object can be downloaded. Sign off and file in
  `evidence/`.
- **DR exercise**: at least annually. Walk the full
  `runbooks/disaster-recovery-runbook.md`, simulating loss of the primary
  region. File in `evidence/`.
- **IR tabletop**: at least annually (see policy #04).

## 5. Continuity of business operations

- Staff can work from anywhere; no single office is critical.
- Communications fail over from Slack/email to a secondary channel
  documented in the DR runbook.
- A current organization chart and contact list (including auditors,
  legal counsel, and key vendors) is maintained in the GRC platform.

## 6. Customer commitments

The Company publishes its current uptime and any active incidents on the
status page (linked from `/status` and the public Trust page). The Service
target uptime is 99.9% measured monthly, excluding announced maintenance.
