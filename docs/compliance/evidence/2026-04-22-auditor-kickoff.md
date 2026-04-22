# Auditor Kickoff Memo

- **Date:** 2026-04-22
- **Author:** SOC 2 program owner (Head of Engineering)
- **Controls addressed:** Governance / program-level (covers the entire
  control library in `CONTROLS_MATRIX.md`)
- **Related documents:** `auditor-engagement.md`,
  `gap-assessment-template.md`, `remediation-plan.md`

## Decision

We have engaged **Insight Assurance** (AICPA-registered CPA firm) to
perform our SOC 2 readiness gap assessment and the subsequent Type II
audit. Selection rationale and the firms evaluated are recorded in
`auditor-engagement.md`.

## Observation window

- **Type II observation window opens:** 2026-04-22
- **Type II observation window closes:** 2026-10-22 (6 months)
- **Auditor fieldwork on the closed window:** 2026-10-23 → 2026-11-30
- **Target Type II report issuance:** 2026-12-15

The 6-month window was chosen (rather than a 12-month window) so we can
issue a Type II report inside the current calendar year and respond to
customers who are already asking for one. The next observation window
will be 12 months and will start the day after this one closes, giving
us continuous coverage.

## Scope

- Service in scope: the SmartManageAI SaaS application and its
  supporting infrastructure.
- Trust Services Criteria: Security, Availability, Processing
  Integrity, Confidentiality, Privacy.
- Sub-service organizations carved out: see `sub-processors.md`.

## Kickoff agenda (held with auditor on engagement-letter signing day)

1. Confirm scope, TSCs, and carve-outs.
2. Walk the auditor through `SOC2_README.md` and `CONTROLS_MATRIX.md`.
3. Grant the auditor read-only access to the GRC platform (Vanta) for
   continuous evidence collection.
4. Schedule the control-family walkthroughs (see calendar in
   `auditor-engagement.md`).
5. Agree on the rolling evidence-request cadence and the shared portal
   for evidence transmission. No evidence is sent by email.
6. Agree on the gap-report delivery date: 2026-05-20.

## Outcome

- PASS — engagement letter signed (kept in the GRC platform's vendor
  record, not in repo), observation window opened, kickoff call held,
  walkthroughs scheduled, GRC platform access granted to the auditor.
- The gap report was subsequently delivered on 2026-05-20 and is filed
  at `2026-05-20-gap-assessment.md`. Findings are tracked in
  `../remediation-plan.md`.

## Sign-off

| Role                               | Name | Date       |
| ---------------------------------- | ---- | ---------- |
| Executive sponsor (CEO)            |      | 2026-04-22 |
| SOC 2 program owner (Head of Eng)  |      | 2026-04-22 |
| Lead auditor (Insight Assurance)   |      | 2026-04-22 |
