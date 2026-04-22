# SOC 2 Gap Remediation Plan

This document tracks every gap identified during the readiness gap
assessment performed by the engaged CPA firm, the action we are taking
to close it, the owner, and the target close date.

It is the source of truth for remediation status. Gaps closed here are
also marked closed in the GRC platform and reflected back into
`CONTROLS_MATRIX.md` once the underlying control is updated.

The findings below were lifted from the gap report at
`evidence/2026-05-20-gap-assessment.md`. Severity definitions are in
`gap-assessment-template.md`.

## How to use

1. When the auditor delivers the gap report, copy each finding into the
   table below — one row per finding.
2. Assign an owner and a target date based on the severity table in
   `gap-assessment-template.md`.
3. Update the **Status** column at least weekly. Allowed values:
   `Open`, `In progress`, `In review`, `Closed`, `Accepted (risk)`.
4. When a finding is `Closed`, link the evidence file under `evidence/`
   that demonstrates the fix.
5. When the entire table is `Closed` (or `Accepted (risk)` with executive
   sign-off), notify the auditor so they can re-test before the
   observation window closes.

## Findings

| ID      | Control(s) | Severity | Finding                                                                                              | Remediation action                                                                                                              | Owner                | Target date | Status      | Evidence (when closed)                                  |
| ------- | ---------- | -------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ----------- | ----------- | ------------------------------------------------------- |
| GAP-001 | CC3.1      | High     | No annual risk assessment artifact on file for the current year.                                     | Run the annual risk assessment workshop and file the output at `evidence/2026-risk-assessment.md`.                              | SOC 2 program owner  | 2026-06-30  | Open        | `evidence/2026-risk-assessment.md`                      |
| GAP-002 | CC7.3      | High     | Annual incident-response tabletop drill has not yet been performed within the observation window.    | Execute the tabletop using `runbooks/incident-response-tabletop.md` and file results at `evidence/2026-MM-DD-ir-tabletop.md`.   | Security Lead        | 2026-07-15  | Open        | `evidence/2026-MM-DD-ir-tabletop.md`                    |
| GAP-003 | CC5.4      | Medium   | Quarterly access review has not yet been performed for the current quarter, per system.              | Run Q2 access review for every in-scope system; file at `evidence/2026-Q2-access-review-<system>.md`. Track ongoing in calendar.| Security Lead        | 2026-07-01  | Open        | `evidence/2026-Q2-access-review-<system>.md` (per system) |
| GAP-004 | CC6.8      | Medium   | Endpoint encryption attestation is reported for 92% of staff laptops; target is 100%.                | Identify the 8% gap via the GRC platform endpoint inventory; remediate or revoke; reach 100% encryption attestation.            | IT / Security Lead   | 2026-07-15  | Open        | GRC platform endpoint inventory snapshot (link in row)  |
| GAP-005 | CC9.2      | Medium   | Annual vendor reviews for Critical/High-tier sub-processors have not yet been filed for the year.    | Complete vendor reviews for every Critical/High-tier vendor in `sub-processors.md`; file each at `evidence/2026-vendor-review-<vendor>.md`. | SOC 2 program owner  | 2026-08-31  | Open        | `evidence/2026-vendor-review-<vendor>.md` (per vendor)  |
| GAP-006 | CC7.5 / A1.3 | Low    | Next quarterly restore drill is due inside the observation window.                                   | Execute the drill using `runbooks/backup-restore-drill.md` and file at `evidence/2026-MM-DD-restore-drill.md`.                  | Engineering on-call  | 2026-09-30  | Open        | `evidence/2026-MM-DD-restore-drill.md`                  |

(Add new rows with the next sequential ID — `GAP-007`, `GAP-008`, etc.
— if the auditor identifies additional findings during fieldwork, or if
the annual penetration test produces any Critical or High finding —
see `evidence/2026-pentest-summary.md`. The 2026 pentest produced
0 Critical and 0 High findings, so no new rows were added from it;
its Medium and Low items are tracked in the GRC platform issue tracker
with IDs `PEN-2026-*`.)

## Risk acceptance

A gap may be marked `Accepted (risk)` only with all of the following:

- Written rationale recorded in the row's **Remediation action** cell.
- Compensating control identified and linked in `CONTROLS_MATRIX.md`.
- Approval from the executive sponsor (CEO) and the SOC 2 program
  owner (Head of Engineering), with names and date.
- Auditor notified; auditor's response captured in the row.

Accepted-risk findings are reviewed at every quarterly access review
to confirm the risk acceptance is still valid.

## Status summary

Snapshot as of 2026-05-20 (date the gap report was filed):

| Severity      | Open | In progress | In review | Closed | Accepted (risk) |
| ------------- | ---- | ----------- | --------- | ------ | --------------- |
| Critical      | 0    | 0           | 0         | 0      | 0               |
| High          | 2    | 0           | 0         | 0      | 0               |
| Medium        | 3    | 0           | 0         | 0      | 0               |
| Low           | 1    | 0           | 0         | 0      | 0               |
| Informational | 0    | 0           | 0         | 0      | 0               |

Update the summary whenever a row changes status.

## Related documents

- `auditor-engagement.md` — selection of the firm and engagement scope
- `gap-assessment-template.md` — worksheet the auditor fills in
- `evidence/2026-05-20-gap-assessment.md` — completed gap report
- `evidence/2026-04-22-auditor-kickoff.md` — observation window decision
- `CONTROLS_MATRIX.md` — the underlying controls
