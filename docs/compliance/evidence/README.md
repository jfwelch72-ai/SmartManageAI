# Evidence

This directory holds dated evidence files referenced by `CONTROLS_MATRIX.md`.
Most controls are continuously monitored by the GRC platform; the items
below need a manual artifact filed here.

## Observation window

| Item | Date |
| ---- | ---- |
| Type II observation window opens | 2026-04-22 |
| Type II observation window closes | 2026-10-22 |
| Auditor engaged | Insight Assurance — see `2026-04-22-auditor-kickoff.md` |
| Gap assessment delivered | 2026-05-20 — see `2026-05-20-gap-assessment.md` |
| Gaps identified | 0 Critical / 2 High / 3 Medium / 1 Low — tracked in `../remediation-plan.md` |
| Annual penetration test executed | 2026-07-13 → 2026-07-31 — see `2026-pentest-summary.md` (0 Critical / 0 High) |
| First quarterly access review filed | 2026-06-15 — see `2026-Q2-access-review-*.md` (10 systems) |
| Next quarterly access review due | 2026-09-30 (2026-Q3) — see `../runbooks/access-review-runbook.md` |

## Required artifacts and cadence

| Artifact | Cadence | Filename pattern |
| -------- | ------- | ---------------- |
| Annual risk assessment | Annual | `YYYY-risk-assessment.md` |
| Penetration test summary | Annual | `YYYY-pentest-summary.md` |
| Disaster recovery exercise | Annual | `YYYY-MM-DD-dr-exercise.md` |
| IR tabletop drill | Annual | `YYYY-MM-DD-ir-tabletop.md` |
| Backup restore drill | Quarterly | `YYYY-MM-DD-restore-drill.md` |
| Quarterly access review (per system) | Quarterly | `YYYY-Q#-access-review-<system>.md` (procedure: `../runbooks/access-review-runbook.md`) |
| Vendor reviews (Critical / High tier) | Annual | `YYYY-vendor-review-<vendor>.md` |
| Security training completion | Annual | `YYYY-security-training.md` |
| Policy acknowledgements | On hire / on change | exported from HRIS |
| Auditor kickoff & evidence requests | Once per audit | `YYYY-MM-DD-auditor-kickoff.md` |
| Auditor gap assessment | Once per audit | `YYYY-MM-DD-gap-assessment.md` |
| Baseline counts (for restore drill comparison) | Quarterly refresh | `baseline-counts.md` |

## How to file evidence

1. Use the filename pattern above so files sort chronologically.
2. Top of the file: title, date, author, control(s) addressed.
3. Body: what was tested, how, and the outcome (PASS / FAIL).
4. Bottom: sign-off line(s) with names and roles.

> Do **not** check in raw evidence that contains customer PII or
> production secrets. Reference the artifact in the GRC platform
> instead, or redact before committing.

## Vendor review runbook

Use this checklist when running an annual vendor review for a
Critical- or High-tier sub-processor. Schedule, owners, and policy due
dates are tracked in `2027-vendor-review-schedule.md`. Attestation
re-issuances and bridge-letter expiries between annual reviews are
tracked in `../vendor-attestation-tracker.md`.

The 2026 vendor review files
(`2026-vendor-review-replit.md`, `…-neon.md`, `…-google-cloud-storage.md`,
`…-openai.md`, `…-sendgrid.md`, `…-stripe.md`) are the canonical
templates. Copy the closest one and edit in place.

### Before you start

1. Confirm the vendor is still in `../sub-processors.md` and that the
   tier in the policy (`../policies/05-vendor-management-policy.md` §4)
   matches the tier in the previous review.
2. Open the vendor's record in the GRC platform and pull the latest
   attestations, DPA, and sub-processor list.
3. Check `../vendor-attestation-tracker.md` for any attestation that
   expired since the last review and confirm it was refreshed.

### Fields to refresh in the review file

- **Date / Author** — set to today and the SOC 2 program owner.
- **Vendor record table** — confirm service, tier, owner, region,
  set "Date of last review" to today, set "Date of next review" to
  today + 1 year.
- **Attestations on file** — for each attestation: update period
  covered, expiry, and bridge-letter window from the GRC vendor record.
- **Data shared with this vendor** — confirm the data set has not
  expanded; if it has, escalate before completing the review.
- **Contract / DPA review** — re-verify each row (MSA, DPA, SCCs,
  sub-processor list, breach SLA, residency, commercial terms).
- **Incidents during the review period** — query the incident log and
  the vendor's status page / security advisories for the window since
  the previous review.
- **Findings** — list any material findings or write
  "**None material.**" If anything material, open a remediation-plan
  entry and link it.
- **Outcome** — `PASS`, `PASS with conditions`, or `FAIL`. Set the
  next review date.
- **Sign-off** — Internal owner + SOC 2 program owner are always
  required; CTO is required for Critical- and High-tier vendors per
  policy §3.

### After filing

1. Update "Last reviewed" for the vendor in `../sub-processors.md`.
2. Update `../vendor-attestation-tracker.md` with the new periods,
   expiries, and reminder dates from the refreshed attestations.
3. Mark the review task complete in the GRC platform and confirm the
   next year's recurring task is scheduled.
