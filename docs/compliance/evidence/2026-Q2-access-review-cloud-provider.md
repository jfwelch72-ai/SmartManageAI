# Quarterly Access Review — Cloud Provider (Replit)

- **Quarter:** 2026-Q2
- **System:** Replit, Inc. — hosting platform for application compute,
  secrets, and deployment (see `../sub-processors.md`)
- **Review date:** 2026-06-15
- **Reviewer:** Engineering on-call lead
- **Approver:** Head of Engineering (SOC 2 program owner)
- **Controls addressed:** CC5.3, CC5.4, CC6.1, CC6.6
- **Policy:** `../policies/02-access-control-policy.md` §5, §6

## Method

1. Exported the team / workspace member list and role assignments
   from the Replit team admin console.
2. Reconciled the list against the IdP group `grp-prod-cloud`
   (production cloud privileges are granted via IdP groups, not
   individual accounts — Access Control Policy §4.4).
3. Reviewed deployment / secrets-management permissions per role.
4. Confirmed MFA is enforced for every console account via the IdP.

## Accounts reviewed

| Account class                 | Count | Verified appropriate | Action |
| ----------------------------- | ----- | -------------------- | ------ |
| Owner (production deploy)     | 2     | 2                    | None   |
| Admin (engineering)           | 6     | 6                    | None   |
| Member (read-only / dev)      | 9     | 9                    | None   |
| Billing-only                  | 1     | 1                    | None   |
| **Total**                     | **18**| **18**               | **0**  |

## Revocations / changes made

None this quarter. The IdP group reconciliation matched the cloud
console membership exactly.

## Outcome

- **PASS** — all accounts confirmed as appropriate.
- MFA coverage 100% (enforced via IdP).
- Carved-out controls (physical security, hypervisor) inherited from
  the sub-processor's SOC 2 — attestation on file in the GRC platform
  vendor record.

## Sign-off

| Role                              | Name | Date       |
| --------------------------------- | ---- | ---------- |
| Reviewer (Engineering on-call)    |      | 2026-06-15 |
| Approver (Head of Engineering)    |      | 2026-06-15 |
