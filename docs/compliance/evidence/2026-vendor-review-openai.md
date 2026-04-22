# Annual Vendor Review — OpenAI

- **Date:** 2026-04-22
- **Author:** SOC 2 program owner (Head of Engineering)
- **Controls addressed:** CC9.2 (Vendor management), C1.1 (Data classification), P1.1, P5.1
- **Related documents:** `../sub-processors.md`,
  `../policies/05-vendor-management-policy.md`,
  `../remediation-plan.md` (GAP-005)

## Vendor record

| Field | Value |
| ----- | ----- |
| Vendor | OpenAI, L.L.C. |
| Service provided | AI features (bid analysis, contract analysis, suggestions) — **opt-in at the organization level** |
| Type | Sub-processor (only when feature is enabled by the customer) |
| Risk tier | **High** |
| Internal owner | Head of Engineering |
| Region of processing | United States |
| Date of last review | 2026-04-22 (this review) |
| Date of next review | 2027-04-22 |

## Attestations on file

| Attestation | Reference / link | Period covered | Expiry |
| ----------- | ---------------- | -------------- | ------ |
| SOC 2 Type II | https://trust.openai.com (request-gated; PDF in GRC vendor record under "OpenAI / Attestations / 2025") | 2024-11-01 → 2025-10-31 | Re-issuance expected 2026-12-31; bridge letter on file through that date |
| CSA STAR | Listed at https://cloudsecurityalliance.org/star/registry | Current | Annual |

- Auditor of vendor: Schellman & Co. (independent CPA firm).
- Trust Services Criteria covered: Security, Confidentiality.
- Material exceptions in vendor's report: **None.**

## Data shared with this vendor

- **Only** data the customer voluntarily submits to AI features after
  enabling them at the organization level.
- API access uses the **zero-data-retention** API tier (no training on
  our data; prompts/completions not retained beyond ≤30-day abuse
  monitoring window per OpenAI's API policy).
- No customer PII is sent unless the customer's submitted content
  includes it; this is disclosed in our privacy notice and in the AI
  features in-app disclosure.

Confirmed appropriate for the service: **Yes**, contingent on the
opt-in gate remaining enforced. Verified the org-level feature flag is
respected at the API call site.

## Contract / DPA review

| Item | Status | Notes |
| ---- | ------ | ----- |
| OpenAI API Terms on file | Yes | Standard API terms plus enterprise addendum |
| Data Processing Addendum (DPA) signed | Yes | Includes EU SCCs |
| Zero-data-retention attestation | Yes | Letter on file in GRC vendor record |
| Sub-processor list reviewed | Yes | https://openai.com/policies/sub-processor-list — no material change |
| Breach notification SLA | Yes | ≤ 72 hours per DPA |
| Data residency commitments | Yes | US region (best effort; documented in privacy notice) |
| Pricing / commercial terms unchanged | Yes | No material change |

## Incidents during the review period

- No security incidents involving this vendor that affected our tenant
  were reported to us during 2025-04-22 → 2026-04-22.
- We tracked the broader industry-wide discussions about AI provider
  data handling; none required notification action under our DPA.

## Findings

- **None material.** SOC 2 Type II current (bridge letter on file),
  DPA in force, ZDR confirmed, opt-in gate verified, no incidents.
- No remediation-plan entry required.

## Outcome

- **PASS** — relationship continues; next review due 2027-04-22.

## Sign-off

| Role | Name | Date |
| ---- | ---- | ---- |
| Internal owner (Head of Engineering) | (on file in GRC platform) | 2026-04-22 |
| SOC 2 program owner | (on file in GRC platform) | 2026-04-22 |
| CTO (per policy §3 for High-tier) | (on file in GRC platform) | 2026-04-22 |
