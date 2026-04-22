# SOC 2 Readiness Gap Assessment — Worksheet Template

This is the worksheet the engaged CPA firm fills in during the readiness
gap assessment. One row per control listed in `CONTROLS_MATRIX.md`.

The completed worksheet is filed under
`evidence/YYYY-MM-DD-gap-assessment.md` and any identified gaps are also
copied into `remediation-plan.md` for tracking.

## Header

| Field                       | Value |
| --------------------------- | ----- |
| Service organization        | SmartManageAI |
| Service in scope            | The SmartManageAI SaaS application and its supporting infrastructure |
| Trust Services Criteria     | Security, Availability, Processing Integrity, Confidentiality, Privacy |
| Sub-service organizations carved out | See `sub-processors.md` |
| Auditor                     | (firm name) |
| Lead auditor                | (name, CPA license #) |
| Assessment start date       | YYYY-MM-DD |
| Assessment end date         | YYYY-MM-DD |
| Standards used              | AICPA TSP Section 100 (2017, with 2022 points of focus) |

## Control assessment table

| Control ID | Control description (from CONTROLS_MATRIX.md) | Evidence reviewed | Design rating | Operating rating | Gap? | Severity | Recommendation |
| ---------- | --------------------------------------------- | ----------------- | -------------- | ----------------- | ---- | -------- | -------------- |
|            |                                               |                   | Adequate / Needs improvement / Inadequate | Effective / Partially effective / Ineffective / Not yet operating | Yes / No | Critical / High / Medium / Low / Informational | |

Fill one row per control in `CONTROLS_MATRIX.md`. The "Operating rating"
column may be "Not yet operating — pre-observation" for controls whose
evidence will only exist after the window opens; that is not a gap on its
own.

## Severity definitions

| Severity      | Meaning                                                                                          | Target close-by |
| ------------- | ------------------------------------------------------------------------------------------------ | --------------- |
| Critical      | Would cause an audit qualification or a material exception. Blocks Type II.                      | Before window opens |
| High          | Would likely cause an exception in the report. Strongly recommended to close before window opens.| Within 30 days  |
| Medium        | Control is partially effective; recommend strengthening to avoid an observation note.            | Within 90 days  |
| Low           | Control is effective but could be hardened.                                                      | Within the window |
| Informational | No gap. Recorded as auditor commentary or future-looking guidance.                               | N/A             |

## Walkthrough log

| Date       | Topic                                  | Attendees (us)        | Attendees (auditor) | Outcome / notes |
| ---------- | -------------------------------------- | --------------------- | ------------------- | --------------- |
| YYYY-MM-DD | Access control                         |                       |                     |                 |
| YYYY-MM-DD | Change management & SDLC               |                       |                     |                 |
| YYYY-MM-DD | Incident response                      |                       |                     |                 |
| YYYY-MM-DD | Logging & monitoring                   |                       |                     |                 |
| YYYY-MM-DD | Encryption & key management            |                       |                     |                 |
| YYYY-MM-DD | Vendor management                      |                       |                     |                 |
| YYYY-MM-DD | Business continuity & DR               |                       |                     |                 |
| YYYY-MM-DD | Data classification, privacy, DPA      |                       |                     |                 |
| YYYY-MM-DD | HR / on-hire / off-hire                |                       |                     |                 |
| YYYY-MM-DD | Risk assessment & policy governance    |                       |                     |                 |

## Summary findings

- Total controls reviewed:
- Controls rated Adequate / Effective:
- Controls rated Needs improvement / Partially effective:
- Controls rated Inadequate / Ineffective:
- Number of Critical gaps:
- Number of High gaps:
- Number of Medium gaps:
- Number of Low gaps:

## Auditor recommendation on observation window

- [ ] Ready to begin observation window now.
- [ ] Begin observation window after Critical and High gaps are closed.
- [ ] Defer observation window; re-assess after remediation.

Recommended observation window start date:

## Sign-off

| Role                  | Name | Date | Signature |
| --------------------- | ---- | ---- | --------- |
| Lead auditor (CPA)    |      |      |           |
| Auditor partner       |      |      |           |
| Service organization sponsor (CEO) |      |      |           |
| SOC 2 program owner (Head of Eng)  |      |      |           |
