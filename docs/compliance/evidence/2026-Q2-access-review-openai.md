# Quarterly Access Review — OpenAI

- **Quarter:** 2026-Q2
- **System:** OpenAI — AI features (bid analysis, contract analysis,
  suggestions). Opt-in per organization. See `../sub-processors.md`.
- **Review date:** 2026-06-15
- **Reviewer:** Security Lead
- **Approver:** Head of Engineering (SOC 2 program owner)
- **Controls addressed:** CC5.3, CC5.4, CC6.7, P6.1
- **Policy:** `../policies/02-access-control-policy.md` §3, §5

## Method

1. Exported the OpenAI organization member list and role assignments
   from the OpenAI platform console.
2. Listed all OpenAI API keys, their scopes, owners, and last-used
   date.
3. Reconciled human members against the engineering roster in HRIS.
4. Verified the data-retention setting on the org is still set to
   **zero data retention (ZDR)** for API traffic, and that "do not
   train on my data" is on.

## Accounts reviewed

| Account class                                | Count | Verified appropriate | Action |
| -------------------------------------------- | ----- | -------------------- | ------ |
| Org owner                                    | 1     | 1                    | None   |
| Org admin                                    | 2     | 2                    | None   |
| Org reader (engineering)                     | 5     | 5                    | None   |
| API key — production (`prod-app-openai`)     | 1     | 1                    | None   |
| API key — staging (`staging-app-openai`)     | 1     | 1                    | None   |
| API key — owned by departed staff            | 1     | 0                    | 1 revoked + new key issued (see revocations) |
| **Total**                                    | **11**| **10**               | **1 change** |

## Revocations / changes made

| Item                                | Change                       | Reason                                                                     | Ticket |
| ----------------------------------- | ---------------------------- | -------------------------------------------------------------------------- | ------ |
| API key `eval-script-2025` (owner: ex-engineer who left 2026-05-12) | Revoked, then rotated as `eval-script-2026` and re-owned by current eval lead. Updated Replit Secret. | Owner had departed; key was no longer attributable to a current owner. | ACC-2026Q2-05 |

## Outcome

- **PASS** with one rotation completed.
- ZDR setting confirmed; "do not train" setting confirmed.
- AI features remain opt-in at the customer organization level.

## Sign-off

| Role                              | Name | Date       |
| --------------------------------- | ---- | ---------- |
| Reviewer (Security Lead)          |      | 2026-06-15 |
| Approver (Head of Engineering)    |      | 2026-06-15 |
