# Quarterly Access Review Runbook

| Owner | Security Lead |
| ----- | ------------- |
| Cadence | Quarterly (calendar quarters) |
| Control(s) | CC5.3, CC5.4 (and per-system: CC4.1, C1.2, P8.1) |
| Policy | `../policies/02-access-control-policy.md` §5 |

## Purpose

Confirm that every account on every in-scope production system is
appropriate for the current employee/contractor's role, and revoke
anything that isn't, **once per calendar quarter**, with a dated
artifact filed for the auditor.

## In-scope systems (one review per system, per quarter)

| System | Filename pattern | Reviewer |
| ------ | ---------------- | -------- |
| SmartManageAI application (staff)  | `evidence/YYYY-Q#-access-review-application.md`     | Security Lead |
| Identity provider (IdP)            | `evidence/YYYY-Q#-access-review-idp.md`             | IT / Security Lead |
| Cloud provider (Replit)            | `evidence/YYYY-Q#-access-review-cloud-provider.md`  | Engineering on-call |
| Database (Neon Postgres)           | `evidence/YYYY-Q#-access-review-database.md`        | Engineering on-call |
| Object storage (Google Cloud Storage) | `evidence/YYYY-Q#-access-review-object-storage.md` | Engineering on-call |
| GitHub                             | `evidence/YYYY-Q#-access-review-github.md`          | Security Lead |
| SendGrid                           | `evidence/YYYY-Q#-access-review-sendgrid.md`        | Security Lead |
| OpenAI                             | `evidence/YYYY-Q#-access-review-openai.md`          | Security Lead |
| GRC platform (Vanta)               | `evidence/YYYY-Q#-access-review-grc-platform.md`    | SOC 2 program owner |
| Stripe                             | `evidence/YYYY-Q#-access-review-stripe.md`          | Finance Lead + Security Lead |

If a new sub-processor is added to `../sub-processors.md`, add a row
here in the same change.

## Procedure (per system)

1. Export the current account / role / API-key list from the system's
   admin console.
2. Reconcile every human account against the active employee +
   contractor roster in HRIS, and against the IdP group that grants
   that system's access (where applicable).
3. Reconcile every service account / API key against a known workload.
   Any key with no last-used activity in 90 days is a candidate for
   revocation.
4. Confirm MFA is enforced on every console account (via the IdP).
5. Revoke anything not justified. Record each revocation in the
   evidence file with the reason and a ticket reference. For
   application accounts, call `revokeUserTokens()` so existing
   sessions/JWTs are invalidated.
6. Save the evidence file using the filename pattern above. Sign it
   (reviewer + approver). Mark PASS / PASS-with-findings / FAIL.
7. Notify the SOC 2 program owner once all systems for the quarter
   are filed.

## Cadence and reminders

The review is due in the **first calendar month of each quarter** and
must be filed before the quarter ends.

| Quarter   | Window for performing review | Filing deadline | Status |
| --------- | ---------------------------- | --------------- | ------ |
| 2026-Q2   | 2026-04 → 2026-06            | 2026-06-30      | **Done** — see `../evidence/2026-Q2-access-review-*.md` |
| 2026-Q3   | 2026-07 → 2026-09            | 2026-09-30      | Scheduled |
| 2026-Q4   | 2026-10 → 2026-12            | 2026-12-31      | Scheduled |
| 2027-Q1   | 2027-01 → 2027-03            | 2027-03-31      | Scheduled |

Reminders are set as recurring calendar events on the Security Lead's
calendar (and on the Head of Engineering's, as backup) on the first
business day of each quarter, and as a recurring task in the GRC
platform that surfaces in the SOC 2 program owner's weekly digest.

If a quarter is missed, file a **late** evidence file with the actual
review date plus a short explanation, and add a row to
`../remediation-plan.md` so the auditor sees the lapse and the
corrective action.

## Sign-off conventions

- **Reviewer** is the person who performed the review for that system
  (see table above).
- **Approver** is the SOC 2 program owner (Head of Engineering) for
  every system except the GRC platform itself, where the approver is
  the CEO (separation of duties: the SOC 2 program owner is also a
  user of the GRC platform).
