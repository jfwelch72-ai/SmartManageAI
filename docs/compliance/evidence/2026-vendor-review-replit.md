# Annual Vendor Review — Replit, Inc.

- **Date:** 2026-04-22
- **Author:** SOC 2 program owner (Head of Engineering)
- **Controls addressed:** CC9.2 (Vendor management), CC5.5 (Inherited controls), C1.2
- **Related documents:** `../sub-processors.md`,
  `../policies/05-vendor-management-policy.md`,
  `../remediation-plan.md` (GAP-005)

## Vendor record

| Field | Value |
| ----- | ----- |
| Vendor | Replit, Inc. |
| Service provided | Hosting platform for application compute, secrets, and deployment |
| Type | Sub-processor / sub-service organization (carved out of our SOC 2) |
| Risk tier | **Critical** |
| Internal owner | Head of Engineering |
| Region of processing | United States |
| Date of last review | 2026-04-22 (this review) |
| Date of next review | 2027-04-22 |

## Attestations on file

| Attestation | Reference / link | Period covered | Expiry |
| ----------- | ---------------- | -------------- | ------ |
| SOC 2 Type II | https://replit.com/site/security (request-gated; PDF stored in GRC platform vendor record under "Replit / Attestations / 2025") | 2024-10-01 → 2025-09-30 | Re-issuance expected by 2026-12-31; current report acceptable through that date per AICPA bridge-letter convention |
| SOC 3 (public) | https://replit.com/site/security (public summary) | Same period as SOC 2 Type II above | Same |
| Bridge letter | On file in GRC platform — covers 2025-10-01 → 2026-12-31 | — | — |

- Auditor of vendor: Prescient Assurance (independent CPA firm).
- Trust Services Criteria covered: Security, Availability, Confidentiality.
- Material exceptions in vendor's report: **None.**

## Data shared with this vendor

- All customer application data in transit through the application tier.
- Environment-variable secrets used by the application at runtime.
- No customer data is intentionally stored by the vendor outside the
  application's own configured datastores (Neon, GCS); the vendor's
  ephemeral compute may hold request/response data in memory only.

Confirmed appropriate for the service: **Yes.** This is the platform on
which the Service runs; data exposure is inherent to the service model
and is acknowledged in our public sub-processors list.

## Contract / DPA review

| Item | Status | Notes |
| ---- | ------ | ----- |
| Master Services Agreement on file | Yes | GRC platform vendor record |
| Data Processing Addendum (DPA) signed | Yes | Includes EU SCCs (module 3) |
| Sub-processor list reviewed | Yes | No new sub-processors since last review |
| Breach notification SLA | Yes | ≤ 72 hours, meets our DPA commitment to customers |
| Data residency commitments unchanged | Yes | US region |
| Pricing / commercial terms unchanged | Yes | No material change |

## Incidents during the review period

- No security incidents involving this vendor were reported to us, and
  none were detected by our monitoring, during 2025-04-22 → 2026-04-22.

## Findings

- **None material.** Vendor's SOC 2 Type II is current (with bridge
  letter), DPA is in force, sub-processor list is unchanged, and no
  incidents were reported.
- No remediation-plan entry required.

## Outcome

- **PASS** — relationship continues; next review due 2027-04-22.

## Sign-off

| Role | Name | Date |
| ---- | ---- | ---- |
| Internal owner (Head of Engineering) | (on file in GRC platform) | 2026-04-22 |
| SOC 2 program owner | (on file in GRC platform) | 2026-04-22 |
| CTO (per policy §3 for Critical-tier) | (on file in GRC platform) | 2026-04-22 |
