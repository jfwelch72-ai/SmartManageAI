# SOC 2 Auditor Engagement

This document records how we selected a CPA firm to perform the SOC 2 Type II
readiness gap assessment and ongoing audit, the evaluation criteria we used,
and the resulting engagement.

The companion documents are:

- `gap-assessment-template.md` — the structured worksheet the auditor fills out
- `remediation-plan.md` — gaps identified by the auditor and how/when we close them
- `evidence/2026-04-22-auditor-kickoff.md` — kickoff memo and observation window
- `CONTROLS_MATRIX.md` — the controls we are asking the auditor to assess

## Scope of the engagement

We are engaging the firm for three sequential phases:

1. **Readiness gap assessment.** A point-in-time review against the controls
   in `CONTROLS_MATRIX.md` and the policies in `policies/`. Output is a written
   gap report with severity ratings and remediation recommendations.
2. **Type I report (optional).** Point-in-time attestation that controls are
   designed appropriately. Used only if a customer requires it before the
   Type II window closes.
3. **Type II report.** Attestation that controls operated effectively over
   the observation window. This is the deliverable customers actually want.

Trust Services Criteria in scope: **Security, Availability, Processing
Integrity, Confidentiality, Privacy** (all five). Same scope as
`SOC2_README.md`.

Sub-service organizations carved out: cloud hosting, managed Postgres,
object storage, email delivery, and the identity provider — see
`sub-processors.md`. The auditor will rely on each vendor's own SOC 2
report for those carve-outs.

## Evaluation criteria

We evaluated firms against the following weighted criteria:

| Criterion                                              | Weight |
| ------------------------------------------------------ | ------ |
| AICPA-registered CPA firm in good standing             | Required |
| Demonstrated SOC 2 experience with SaaS at our stage   | 25%    |
| Familiarity with our GRC platform (Vanta integrations) | 15%    |
| Fixed-fee or capped pricing for Type II                | 15%    |
| Turnaround time on gap report (≤ 4 weeks)              | 15%    |
| Willingness to issue rolling evidence requests         | 10%    |
| Reference customers in construction / SaaS verticals   | 10%    |
| Ability to bundle ISO 27001 in the future              | 10%    |

Disqualifiers:

- Not an AICPA-registered CPA firm
- Reseller / "audit-as-a-service" wrapper without the issuing CPA on staff
- Refusal to share a redacted sample report
- Hourly-only pricing with no cap

## Firms evaluated

The following firms returned an RFP response. Pricing is the all-in quote
for the gap assessment plus the first Type II window.

| Firm                | AICPA CPA | GRC integration | Gap fee   | Type II fee | Notes                                                                 |
| ------------------- | --------- | --------------- | --------- | ----------- | --------------------------------------------------------------------- |
| Prescient Assurance | Yes       | Vanta, Drata    | $$        | $$$         | Strong SaaS book of business; common Vanta partner; fast turnaround   |
| Insight Assurance   | Yes       | Vanta, Drata    | $$        | $$$         | Fixed-fee; well reviewed; combined SOC 2 + ISO 27001 path             |
| A-LIGN              | Yes       | Vanta, Drata    | $$$       | $$$$        | Largest, most enterprise-recognized, highest cost                     |
| Johanson Group      | Yes       | Vanta, Drata    | $$        | $$$         | Strong on construction/field-services references                      |
| Sensiba             | Yes       | Vanta, Drata    | $$$       | $$$$        | Bay Area; broader assurance practice                                  |

Specific dollar quotes are kept out of this repo because they are under
NDA — see the GRC platform's vendor record for the signed engagement
letter and the actual fees.

## Selection

**Selected firm:** Insight Assurance.

Rationale:

- AICPA-registered CPA firm with an in-house issuing partner.
- Fixed-fee pricing for both the gap assessment and the Type II window,
  removing budget risk.
- Native Vanta integration so the auditor can pull evidence directly from
  our GRC platform during fieldwork.
- Committed to a 3-week turnaround on the gap report so we can begin
  remediation inside the same observation window rather than after it.
- Provides a documented path to add ISO 27001 in year two using the same
  policy library, which lines up with our roadmap.

The runner-up is Prescient Assurance and is held as a backup if Insight
becomes unavailable mid-engagement.

## Engagement deliverables and timeline

| Milestone                                          | Target date  | Status |
| -------------------------------------------------- | ------------ | ------ |
| Engagement letter signed                           | 2026-04-22   | Done — letter on file in the GRC platform's vendor record (not in repo) |
| Kickoff call and evidence request list received    | 2026-04-29   | Done — see `evidence/2026-04-22-auditor-kickoff.md` |
| Walkthroughs (one per control family)              | 2026-05-01 → 2026-05-15 | Done — log in `evidence/2026-05-20-gap-assessment.md` |
| Gap report delivered                               | 2026-05-20   | Done — `evidence/2026-05-20-gap-assessment.md` |
| Remediation plan populated from gap report         | 2026-05-20   | Done — `remediation-plan.md` |
| Type II observation window opens                   | 2026-04-22   | Open |
| Type II observation window closes                  | 2026-10-22   | Pending |
| Auditor fieldwork on the closed window             | 2026-10-23 → 2026-11-30 | Pending |
| Type II report issued                              | 2026-12-15   | Pending |

The observation window starts on the same day the engagement letter is
signed so that evidence collected from day one counts toward the report.
This is also the date stamped in `evidence/README.md`.

## Roles

| Role                       | Owner                 |
| -------------------------- | --------------------- |
| Executive sponsor          | CEO                   |
| SOC 2 program owner        | Head of Engineering   |
| Day-to-day auditor liaison | Security Lead         |
| Evidence collection (auto) | GRC platform (Vanta)  |
| Evidence collection (manual) | Security Lead       |
| Legal / contracting        | CEO                   |

## Communication cadence

- Weekly 30-minute status call with the auditor during gap fieldwork.
- Monthly check-in during the observation window.
- Shared evidence portal in the GRC platform; no evidence transmitted by
  email.
- All auditor questions tracked in the GRC platform's request tracker so
  we have an audit trail of what was asked and answered.

## Renewal

The engagement letter covers the gap assessment plus one Type II window.
Re-engagement for the next annual Type II report will be re-evaluated
90 days before the next observation window opens, using the same
criteria above.
