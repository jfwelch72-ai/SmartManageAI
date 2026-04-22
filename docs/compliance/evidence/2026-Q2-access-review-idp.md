# Quarterly Access Review — Identity Provider (IdP)

- **Quarter:** 2026-Q2
- **System:** Corporate Identity Provider (single sign-on for all staff
  SaaS, including the GRC platform, GitHub, cloud provider console,
  database console, object storage, SendGrid, OpenAI, Stripe)
- **Review date:** 2026-06-15
- **Reviewer:** IT / Security Lead
- **Approver:** Head of Engineering (SOC 2 program owner)
- **Controls addressed:** CC5.1, CC5.2, CC5.4, CC5.6
- **Policy:** `../policies/02-access-control-policy.md` §3, §5

## Method

1. Exported the active-users report from the IdP admin console.
2. Reconciled it against the current employee + active-contractor
   roster in the HRIS.
3. Pulled the IdP MFA-enrollment report; confirmed 100% MFA coverage
   for active staff accounts.
4. Reviewed group membership for IdP groups that grant production
   privileges (`grp-prod-cloud`, `grp-prod-db`, `grp-prod-gcs`,
   `grp-grc-admin`, `grp-github-org-admin`).

## Accounts reviewed

| Account class                       | Count | Verified appropriate | Action |
| ----------------------------------- | ----- | -------------------- | ------ |
| Active employees                    | 27    | 27                   | None   |
| Active contractors                  | 3     | 2                    | 1 disabled (see revocations) |
| Service accounts (SCIM / SAML apps) | 9     | 9                    | None   |
| Break-glass (sealed in vault)       | 2     | 2                    | None — last opened: never this quarter |
| **Total**                           | **41**| **40**               | **1 change** |

## Revocations / changes made

| Account                       | Change   | Reason                                                       | Ticket |
| ----------------------------- | -------- | ------------------------------------------------------------ | ------ |
| `contractor-design-02@`       | Disabled | Contract ended 2026-05-30; HRIS off-boarding ticket landed on a public holiday and the IdP disable ran one business day late. Account had no production privileges. | ACC-2026Q2-02 |

Follow-up: a recurring reconciliation between HRIS termination dates
and IdP `disabledAt` dates is being added to the GRC platform so a
1-day lag is flagged automatically rather than caught at quarterly
review.

## Outcome

- **PASS** with one minor finding (lag in contractor disable, now
  remediated; preventive control added).
- 100% MFA enrollment confirmed.
- No service account had unused/dormant credentials.

## Sign-off

| Role                              | Name | Date       |
| --------------------------------- | ---- | ---------- |
| Reviewer (IT / Security Lead)     |      | 2026-06-15 |
| Approver (Head of Engineering)    |      | 2026-06-15 |
