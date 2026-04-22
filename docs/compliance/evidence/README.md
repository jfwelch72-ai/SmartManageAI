# Evidence

This directory holds dated evidence files referenced by `CONTROLS_MATRIX.md`.
Most controls are continuously monitored by the GRC platform; the items
below need a manual artifact filed here.

## Observation window

| Item | Date |
| ---- | ---- |
| Type II observation window opens | 2026-04-22 |
| Type II observation window closes | 2026-10-22 |
| Auditor engaged | (file kickoff memo at `2026-04-XX-auditor-kickoff.md`) |

## Required artifacts and cadence

| Artifact | Cadence | Filename pattern |
| -------- | ------- | ---------------- |
| Annual risk assessment | Annual | `YYYY-risk-assessment.md` |
| Penetration test summary | Annual | `YYYY-pentest-summary.md` |
| Disaster recovery exercise | Annual | `YYYY-MM-DD-dr-exercise.md` |
| IR tabletop drill | Annual | `YYYY-MM-DD-ir-tabletop.md` |
| Backup restore drill | Quarterly | `YYYY-MM-DD-restore-drill.md` |
| Quarterly access review (per system) | Quarterly | `YYYY-Q#-access-review-<system>.md` |
| Vendor reviews (Critical / High tier) | Annual | `YYYY-vendor-review-<vendor>.md` |
| Security training completion | Annual | `YYYY-security-training.md` |
| Policy acknowledgements | On hire / on change | exported from HRIS |
| Auditor kickoff & evidence requests | Once per audit | `YYYY-MM-DD-auditor-kickoff.md` |
| Baseline counts (for restore drill comparison) | Quarterly refresh | `baseline-counts.md` |

## How to file evidence

1. Use the filename pattern above so files sort chronologically.
2. Top of the file: title, date, author, control(s) addressed.
3. Body: what was tested, how, and the outcome (PASS / FAIL).
4. Bottom: sign-off line(s) with names and roles.

> Do **not** check in raw evidence that contains customer PII or
> production secrets. Reference the artifact in the GRC platform
> instead, or redact before committing.
