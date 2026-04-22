# Quarterly Access Review — SendGrid

- **Quarter:** 2026-Q2
- **System:** SendGrid (Twilio) — outbound transactional and
  notification email. See `../sub-processors.md`.
- **Review date:** 2026-06-15
- **Reviewer:** Security Lead
- **Approver:** Head of Engineering (SOC 2 program owner)
- **Controls addressed:** CC5.3, CC5.4
- **Policy:** `../policies/02-access-control-policy.md` §3, §5

## Method

1. Exported the SendGrid teammate list and per-teammate scopes from
   the SendGrid admin console.
2. Listed all SendGrid API keys (production + staging), their scopes,
   and their last-used date.
3. Reconciled human teammates against the engineering + support roster
   in the HRIS.
4. Confirmed all API keys with `mail.send` scope are stored only in
   Replit Secrets and not in the repository (re-ran the secret-scan CI
   check).

## Accounts reviewed

| Account class                              | Count | Verified appropriate | Action |
| ------------------------------------------ | ----- | -------------------- | ------ |
| Teammate — admin                           | 2     | 2                    | None   |
| Teammate — read-only (deliverability mon.) | 2     | 2                    | None   |
| API key — production (`prod-mail-send`, restricted to `mail.send`) | 1 | 1 | None |
| API key — staging (`staging-mail-send`)    | 1     | 1                    | None   |
| API key — webhook signing                  | 1     | 1                    | None   |
| **Total**                                  | **7** | **7**                | **0**  |

All keys had been used in the past 90 days (no idle keys).

## Revocations / changes made

None this quarter.

## Outcome

- **PASS** — all teammates and API keys appropriate and least-privilege.
- No API key was found in the source tree.

## Sign-off

| Role                              | Name | Date       |
| --------------------------------- | ---- | ---------- |
| Reviewer (Security Lead)          |      | 2026-06-15 |
| Approver (Head of Engineering)    |      | 2026-06-15 |
