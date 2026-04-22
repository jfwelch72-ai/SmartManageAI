# Quarterly Access Review — GitHub

- **Quarter:** 2026-Q2
- **System:** GitHub Organization — source control, CI, branch
  protection on `main`
- **Review date:** 2026-06-15
- **Reviewer:** Security Lead
- **Approver:** Head of Engineering (SOC 2 program owner)
- **Controls addressed:** CC5.3, CC5.4, CC8.1
- **Policy:** `../policies/02-access-control-policy.md` §3, §5

## Method

1. Exported the GitHub Org member list (`gh api orgs/<org>/members`)
   plus outside-collaborator list (`/outside_collaborators`).
2. Reconciled members against IdP group `grp-github-org-admin`
   (admins) and the engineering distribution group (members).
3. Listed personal access tokens (PATs) and fine-grained tokens with
   org access via SAML SSO authorization.
4. Confirmed branch protection on `main`: required reviews ≥ 1,
   required status checks (CI security pipeline must pass),
   dismiss-stale-reviews, no force-push, no bypass.
5. Confirmed SAML SSO is enforced at the org level (no local
   GitHub-only logins).

## Accounts reviewed

| Account class                              | Count | Verified appropriate | Action |
| ------------------------------------------ | ----- | -------------------- | ------ |
| Org owners                                 | 2     | 2                    | None   |
| Org members (engineering)                  | 18    | 17                   | 1 removed (see revocations) |
| Outside collaborators (specific repo only) | 1     | 1                    | None — pen-test contractor, scoped to a single repo, expires 2026-08-31 |
| Machine accounts (CI deploy)               | 2     | 2                    | None   |
| Personal/fine-grained tokens with org access | 11  | 10                   | 1 revoked (see revocations) |
| **Total**                                  | **34**| **32**               | **2 changes** |

## Revocations / changes made

| Account / token                          | Change   | Reason                                                                        | Ticket |
| ---------------------------------------- | -------- | ----------------------------------------------------------------------------- | ------ |
| `ex-engineer-04` (org member)            | Removed  | Departed 2026-05-12. HRIS off-boarding revoked IdP/SSO same-day, but the GitHub org seat was not auto-removed because account had been added before SCIM was enabled. | ACC-2026Q2-03 |
| Fine-grained PAT `ci-bot-legacy` (45-day idle) | Revoked  | Superseded by the new GitHub App; no longer in use. Least-privilege cleanup.  | ACC-2026Q2-04 |

Follow-up: SCIM provisioning will be enabled for GitHub this quarter
so the seat is reclaimed automatically on IdP disable. Tracked as a
GAP-002 sibling task in the GRC platform (not a new SOC 2 gap; the
control was effective via IdP SSO — the user could not have logged in
even though the seat remained).

## Outcome

- **PASS** with two least-privilege cleanups completed.
- Branch protection settings on `main` unchanged and effective.
- No PR merged to `main` this quarter without a passing CI security
  pipeline.

## Sign-off

| Role                              | Name | Date       |
| --------------------------------- | ---- | ---------- |
| Reviewer (Security Lead)          |      | 2026-06-15 |
| Approver (Head of Engineering)    |      | 2026-06-15 |
