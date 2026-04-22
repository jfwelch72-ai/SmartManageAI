# Backup Restore Drill

| Owner | SRE on-call |
| ----- | ----------- |
| Cadence | Quarterly |
| Duration | ~2 hours |

Confirms that backups exist, are intact, and can be restored to a usable
state inside the **RTO of 4 hours and RPO of 15 minutes** committed to
in policy #07.

## Pre-checks (5 min)

- [ ] Confirm the most recent automated backup completed: check the
      monitoring alarm for "backup-job".
- [ ] Confirm the offsite logical dump for the prior day exists in
      `gs://<offsite-backup-bucket>` and the manifest hash matches.
- [ ] Choose a target time `T = (now - 30 min)` for the PITR restore.

## Postgres PITR restore (30 min)

1. Create a new restore branch from the production project at time `T`.
2. Connect with `psql` using the restore branch's connection string.
3. Run validation queries:
   ```sql
   SELECT now();
   SELECT count(*) FROM users;
   SELECT count(*) FROM organizations;
   SELECT count(*) FROM projects;
   SELECT max(created_at) FROM audit_log;
   ```
4. Compare counts to the snapshot saved in `evidence/baseline-counts.md`
   (refreshed quarterly). Each count must be within ±0.5%.
5. `max(created_at)` from `audit_log` must be ≥ `T - 15 minutes`,
   confirming RPO is met.

## Offsite logical-dump restore (45 min)

1. Provision an empty Postgres instance in the secondary cloud account.
2. `pg_restore -d $RESTORE_DB_URL /tmp/latest.dump`
3. Run the same validation queries as above.

## Object storage restore (15 min)

1. Pick 5 known object keys from production.
2. Download each from the cross-region replica bucket directly.
3. Confirm bytes match the production object (compare ETag/MD5).

## ACL mirror sanity (5 min)

```sql
SELECT count(*) FROM object_acl_policies;
```
Compare to the production count; should be within ±0.5%.

## Tear-down (10 min)

- Drop the Postgres restore branch.
- Drop the secondary-account restore instance.
- Confirm no production data was written to during the drill.

## Evidence (5 min)

File `docs/compliance/evidence/YYYY-MM-DD-restore-drill.md` containing:
- Timestamps for each step
- Whether RTO and RPO were met (each: PASS / FAIL)
- Any anomalies
- Names and roles of participants
- Sign-off by SRE on-call

## If anything fails

Open a SEV-2 ticket, assign to the SRE team, and re-test within 7 days.
The control is considered failing until a clean drill is filed.
