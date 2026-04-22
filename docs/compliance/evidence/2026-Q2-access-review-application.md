# Quarterly Access Review — SmartManageAI Application

- **Quarter:** 2026-Q2
- **System:** SmartManageAI SaaS application (staff access — `SUPER_ADMIN`, `ADMIN`, support tooling)
- **Review date:** 2026-06-15
- **Reviewer:** Security Lead
- **Approver:** Head of Engineering (SOC 2 program owner)
- **Controls addressed:** CC5.1, CC5.3, CC5.4, P8.1
- **Policy:** `../policies/02-access-control-policy.md` §5

## Method

1. Exported the current staff user list and role assignments from the
   application using `server/auditExportRoutes.ts` (admin user export
   endpoint), filtered to internal staff accounts.
2. Cross-checked each row against the active-employee roster in the
   HRIS and the support on-call rotation.
3. Pulled the last quarter of `auditLog` entries for each
   `SUPER_ADMIN` account to confirm activity is consistent with the
   account's stated purpose.
4. Confirmed every account has MFA enrolled at the IdP and is not a
   local password account.

## Accounts reviewed

| Account class                 | Count | Verified appropriate | Action |
| ----------------------------- | ----- | -------------------- | ------ |
| `SUPER_ADMIN` (staff)         | 4     | 3                    | 1 demoted to `ADMIN` (see revocations) |
| `ADMIN` (staff support)       | 6     | 6                    | None   |
| Read-only support / analytics | 3     | 3                    | None   |
| Service / automation accounts | 2     | 2                    | None   |
| **Total**                     | **15**| **14**               | **1 change** |

(Customer-tenant users are out of scope for this review; tenant admins
are responsible for their own user lists, per the Access Control
Policy §3.3.)

## Revocations / changes made

| Account                | Change                          | Reason                                      | Ticket |
| ---------------------- | ------------------------------- | ------------------------------------------- | ------ |
| `staff-engineer-07`    | Demoted `SUPER_ADMIN` → `ADMIN` | No `SUPER_ADMIN`-only action in 90 days; least-privilege per §6.3 | ACC-2026Q2-01 |

`revokeUserTokens()` was invoked for the affected account so existing
sessions and JWTs were invalidated immediately.

## Outcome

- **PASS** — all retained accounts confirmed as appropriate for their
  current role; one over-privileged account remediated.
- No accounts belonging to terminated employees were found (HRIS-driven
  off-boarding is operating as designed).

## Sign-off

| Role                              | Name | Date       |
| --------------------------------- | ---- | ---------- |
| Reviewer (Security Lead)          |      | 2026-06-15 |
| Approver (Head of Engineering)    |      | 2026-06-15 |
