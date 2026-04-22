# Quarterly Access Review — Stripe

- **Quarter:** 2026-Q2
- **System:** Stripe — subscription billing and payment processing.
  See `../sub-processors.md`. (Card numbers never touch our servers;
  Stripe Elements posts directly to Stripe.)
- **Review date:** 2026-06-15
- **Reviewer:** Finance Lead, with Security Lead co-review
- **Approver:** Head of Engineering (SOC 2 program owner)
- **Controls addressed:** CC5.3, CC5.4
- **Policy:** `../policies/02-access-control-policy.md` §3, §5

## Method

1. Exported the Stripe Dashboard team-member list and per-member
   permissions from Stripe → Settings → Team.
2. Listed all Stripe API keys (restricted + webhook signing) and
   their last-used date.
3. Reconciled human dashboard users against finance + engineering
   rosters in HRIS.
4. Confirmed MFA enforced on every dashboard user via the IdP.

## Accounts reviewed

| Account class                                  | Count | Verified appropriate | Action |
| ---------------------------------------------- | ----- | -------------------- | ------ |
| Dashboard — Administrator                      | 1     | 1                    | None — CFO |
| Dashboard — Developer                          | 2     | 2                    | None   |
| Dashboard — Analyst (read-only)                | 2     | 2                    | None   |
| Restricted API key — production (subscription billing scope) | 1 | 1 | None   |
| Restricted API key — staging                   | 1     | 1                    | None   |
| Webhook signing secret                         | 1     | 1                    | None   |
| **Total**                                      | **8** | **8**                | **0**  |

## Revocations / changes made

None this quarter.

## Outcome

- **PASS** — team membership and API keys are minimal and least-privilege.
- MFA coverage 100% (enforced via IdP).

## Sign-off

| Role                              | Name | Date       |
| --------------------------------- | ---- | ---------- |
| Reviewer (Finance Lead)           |      | 2026-06-15 |
| Co-reviewer (Security Lead)       |      | 2026-06-15 |
| Approver (Head of Engineering)    |      | 2026-06-15 |
