# Quarterly Access Review — GRC Platform (Vanta)

- **Quarter:** 2026-Q2
- **System:** Vanta — continuous compliance monitoring, evidence
  collection, vendor inventory, auditor-shared portal
- **Review date:** 2026-06-15
- **Reviewer:** SOC 2 program owner (Head of Engineering)
- **Approver:** CEO (executive sponsor)
- **Controls addressed:** CC4.1, CC5.3, CC5.4, CC9.2
- **Policy:** `../policies/02-access-control-policy.md` §3, §5, §6

## Method

1. Exported the Vanta workspace member list and role assignments from
   the Vanta admin console.
2. Reconciled members against IdP group `grp-grc-admin` (admins) and
   the SOC 2 working group roster.
3. Listed connected integrations (cloud, IdP, GitHub, GCS, HRIS,
   endpoint MDM, etc.) and confirmed each connector account is the
   intended automation principal.
4. Verified the auditor (Insight Assurance) has read-only / auditor
   role only, scoped to the SOC 2 audit project.

## Accounts reviewed

| Account class                              | Count | Verified appropriate | Action |
| ------------------------------------------ | ----- | -------------------- | ------ |
| Workspace admin                            | 2     | 2                    | None   |
| Workspace member — SOC 2 working group     | 4     | 4                    | None   |
| Workspace member — read-only (executives)  | 2     | 2                    | None   |
| Auditor (Insight Assurance) — auditor role | 2     | 2                    | None — scoped to SOC 2 project, expires at audit close |
| Connected integrations (service principals)| 7     | 7                    | None   |
| **Total**                                  | **17**| **17**               | **0**  |

## Revocations / changes made

None this quarter.

## Outcome

- **PASS** — all accounts confirmed as appropriate.
- Auditor access is correctly scoped and time-bounded.
- All integrations green; no offline connector for >24h.

## Sign-off

| Role                              | Name | Date       |
| --------------------------------- | ---- | ---------- |
| Reviewer (SOC 2 program owner)    |      | 2026-06-15 |
| Approver (CEO)                    |      | 2026-06-15 |
