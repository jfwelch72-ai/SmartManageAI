# Disaster Recovery Runbook

| Owner | CTO |
| ----- | --- |
| Last full exercise | (file `evidence/YYYY-MM-DD-dr-exercise.md`) |
| Next exercise due | Annually |

This runbook covers loss of the **primary production region** or
catastrophic data loss in the primary database. It assumes the recovery
objectives in policy #07: **RTO 4h, RPO 15m** for tier-1 systems.

> If the situation is "production is degraded" rather than "production
> is gone", use the standard incident response process in policy #04
> first.

## 0. Declare a disaster

Required to declare:
- Primary region completely unreachable for > 30 minutes, **or**
- Primary database confirmed lost or corrupted with no in-region recovery
  path, **or**
- Confirmed destructive intrusion in the primary environment.

Decision-maker: **Incident Commander**, on-call until the CTO joins.

## 1. Stand up the war room

1. Open the `#incident-dr` Slack channel; if Slack is the failure, fall
   back to the secondary channel listed in the GRC platform.
2. Page: CTO, on-call engineer, on-call SRE, communications lead.
3. Open the incident ticket, set severity SEV-1, assign IC.
4. Post initial status to the public status page: "Investigating."

## 2. Communications

- **Internal**: post in `#incident-dr` every 30 minutes.
- **Customers**: status page update every 60 minutes minimum.
- **Sales/CS**: pull copy-paste blurb from the IR policy.
- **Auditor / regulators** (if breach involved): handled by Legal in
  parallel.

## 3. Recover the database

### Option A — point-in-time restore in the same provider, different region
Preferred when the issue is data corruption or a region outage and the
provider supports cross-region PITR.

```
neon branches create \
  --project-id $NEON_PROJECT_ID \
  --name dr-restore-$(date -u +%Y%m%dT%H%M%S) \
  --parent-timestamp "<ISO8601 timestamp 5 minutes before incident>"
```

Validate:
- `SELECT now();` returns; query a few known rows.
- Row counts on `users`, `organizations`, `projects` are within ±0.1% of
  the last known-good metric.

### Option B — restore from offsite logical dump
Used if the provider itself is unavailable or the project is gone.

1. Stand up a replacement Postgres in the secondary cloud account.
2. Pull the most recent dump from the offsite backup bucket
   (`gs://<offsite-backup-bucket>`); validate object hash against the
   manifest in the same bucket.
3. `pg_restore -d $NEW_DB_URL latest.dump`
4. Apply any forward migrations from the deployment artifact.
5. Validate as in Option A.

## 4. Recover object storage

If the primary GCS bucket is unavailable:
1. Promote the cross-region replica to active.
2. Update `OBJECT_STORAGE_BUCKET` in the secret store to the replica.
3. Confirm `server/objectAcl.ts` policies are intact (the
   `objectAclPolicies` table is the authoritative mirror).

## 5. Bring up the application

1. Update the application's `DATABASE_URL` and `OBJECT_STORAGE_BUCKET`
   secrets to point at the recovered systems.
2. Deploy the latest known-good build to the DR environment.
3. Run the post-deploy smoke tests:
   - `GET /api/health` returns 200.
   - Login with the synthetic test account.
   - Create / read / delete a synthetic project.
   - Upload + download a 1 MB file.
4. Cut DNS over to the DR environment.
5. Status page: "Service restored, monitoring."

## 6. Validate
- Customer-visible alarms clear.
- Audit log writes are succeeding.
- Backup job re-runs and succeeds.

## 7. Stand down
- Status page: "Resolved."
- Customer notification email if the outage exceeded the contractual SLA
  or any customer data was lost.
- Schedule the blameless retrospective within 5 business days.

## 8. Evidence to file

After every drill or real event, file in `docs/compliance/evidence/`:
- Timeline (start, milestones, end)
- Whether RTO and RPO were met
- Issues found and follow-up actions
- Sign-off from IC and CTO
