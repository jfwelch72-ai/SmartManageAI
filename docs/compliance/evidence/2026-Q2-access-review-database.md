# Quarterly Access Review — Database (Neon Postgres)

- **Quarter:** 2026-Q2
- **System:** Neon, Inc. — managed Postgres for primary application
  data (see `../sub-processors.md`)
- **Review date:** 2026-06-15
- **Reviewer:** Engineering on-call lead
- **Approver:** Head of Engineering (SOC 2 program owner)
- **Controls addressed:** CC5.1, CC5.3, CC5.4, CC6.1
- **Policy:** `../policies/02-access-control-policy.md` §3, §5, §6

## Method

1. Exported the project member list and role assignments from the
   Neon project console.
2. Listed Postgres roles inside the production database via
   `\du` — separated into application service roles, migration
   roles, and human break-glass roles.
3. Reconciled human accounts against IdP group `grp-prod-db`.
4. Verified that production console access is gated by ticket +
   time-boxed elevation per Access Control Policy §6.1.

## Accounts reviewed

| Account class                            | Count | Verified appropriate | Action |
| ---------------------------------------- | ----- | -------------------- | ------ |
| Project owners (Neon console)            | 2     | 2                    | None   |
| Project members — engineering (read-only DDL preview) | 4 | 4 | None |
| App service role (`app_rw`)              | 1     | 1                    | None   |
| Migration role (`migrator`)              | 1     | 1                    | None   |
| Read-only analytics role (`bi_ro`)       | 1     | 1                    | None   |
| Break-glass DBA (sealed credential)      | 1     | 1                    | None — last opened: never this quarter |
| **Total**                                | **10**| **10**               | **0**  |

Production console elevations during the quarter (from ticket queue):
**3** elevations, all justified, all auto-expired within 4 hours per
policy.

## Revocations / changes made

None this quarter.

## Outcome

- **PASS** — all accounts and roles confirmed as appropriate.
- All elevation events were ticketed, time-boxed, and auto-expired.
- MFA coverage 100% (enforced via IdP).

## Sign-off

| Role                              | Name | Date       |
| --------------------------------- | ---- | ---------- |
| Reviewer (Engineering on-call)    |      | 2026-06-15 |
| Approver (Head of Engineering)    |      | 2026-06-15 |
