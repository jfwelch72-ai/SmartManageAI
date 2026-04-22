# Annual Vendor Review — Stripe, Inc.

- **Date:** 2026-04-22
- **Author:** SOC 2 program owner (Head of Engineering)
- **Controls addressed:** CC9.2 (Vendor management), C1.1, PI1.1
- **Related documents:** `../sub-processors.md`,
  `../policies/05-vendor-management-policy.md`,
  `../remediation-plan.md` (GAP-005)

## Vendor record

| Field | Value |
| ----- | ----- |
| Vendor | Stripe, Inc. |
| Service provided | Subscription billing and payment processing |
| Type | Sub-processor |
| Risk tier | **High** |
| Internal owner | Head of Engineering |
| Region of processing | United States |
| Date of last review | 2026-04-22 (this review) |
| Date of next review | 2027-04-22 |

## Attestations on file

| Attestation | Reference / link | Period covered | Expiry |
| ----------- | ---------------- | -------------- | ------ |
| SOC 1 Type II | https://stripe.com/docs/security (request-gated; PDF in GRC vendor record under "Stripe / Attestations / 2025") | 2024-10-01 → 2025-09-30 | Re-issued annually; bridge letter on file through 2026-12-31 |
| SOC 2 Type II | Same source | 2024-10-01 → 2025-09-30 | Same |
| PCI DSS Level 1 (Service Provider) | https://stripe.com/docs/security — Attestation of Compliance | Current | Renews annually |
| ISO/IEC 27001 | Same source | Current | Annual |

- Auditor of vendor: Deloitte & Touche LLP (independent CPA firm).
- Trust Services Criteria covered: Security, Availability, Confidentiality, Processing Integrity.
- Material exceptions in vendor's report: **None.**

## Data shared with this vendor

- Billing-contact name and email, organization name, subscription plan,
  invoice line items, and Stripe customer/subscription identifiers.
- **No card numbers, CVC, or expiry are ever transmitted through our
  systems.** Card data is collected by the Stripe Elements iframe and
  posted directly from the customer's browser to Stripe (verified in
  the checkout component). Our backend stores only Stripe-issued IDs.
- Webhook signatures verified server-side.

Confirmed appropriate for the service: **Yes.** This is the minimum
necessary data set for the billing relationship; PCI scope is
minimized by design.

## Contract / DPA review

| Item | Status | Notes |
| ---- | ------ | ----- |
| Stripe Services Agreement on file | Yes | Online SSA + signed order form |
| Data Processing Addendum (DPA) signed | Yes | Includes EU SCCs |
| Sub-processor list reviewed | Yes | https://stripe.com/legal/subprocessors — no material change |
| Breach notification SLA | Yes | ≤ 72 hours per DPA |
| Data residency commitments unchanged | Yes | US region |
| Pricing / commercial terms unchanged | Yes | No material change |

## Incidents during the review period

- No security incidents involving this vendor that affected our tenant
  were reported to us during 2025-04-22 → 2026-04-22.

## Findings

- **None material.** SOC 1/2 Type II current (bridge letter on file),
  PCI DSS Level 1 AOC current, DPA in force, sub-processor list
  unchanged, no incidents. Verified card data continues to bypass our
  servers via Stripe Elements.
- No remediation-plan entry required.

## Outcome

- **PASS** — relationship continues; next review due 2027-04-22.

## Sign-off

| Role | Name | Date |
| ---- | ---- | ---- |
| Internal owner (Head of Engineering) | (on file in GRC platform) | 2026-04-22 |
| SOC 2 program owner | (on file in GRC platform) | 2026-04-22 |
| CTO (per policy §3 for High-tier) | (on file in GRC platform) | 2026-04-22 |
