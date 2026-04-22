# Annual Vendor Review — SendGrid (Twilio)

- **Date:** 2026-04-22
- **Author:** SOC 2 program owner (Head of Engineering)
- **Controls addressed:** CC9.2 (Vendor management), C1.1, P1.1
- **Related documents:** `../sub-processors.md`,
  `../policies/05-vendor-management-policy.md`,
  `../remediation-plan.md` (GAP-005)

## Vendor record

| Field | Value |
| ----- | ----- |
| Vendor | Twilio Inc. — SendGrid |
| Service provided | Outbound transactional and notification email |
| Type | Sub-processor |
| Risk tier | **High** |
| Internal owner | Head of Engineering |
| Region of processing | United States |
| Date of last review | 2026-04-22 (this review) |
| Date of next review | 2027-04-22 |

## Attestations on file

| Attestation | Reference / link | Period covered | Expiry |
| ----------- | ---------------- | -------------- | ------ |
| SOC 2 Type II (Twilio, including SendGrid product) | https://www.twilio.com/en-us/legal/compliance (request-gated; PDF in GRC vendor record under "Twilio-SendGrid / Attestations / 2025") | 2024-10-01 → 2025-09-30 | Re-issuance expected 2026-11-30; bridge letter on file through that date |
| ISO/IEC 27001 | Same source | Current | Annual |
| ISO/IEC 27017, 27018 | Same source | Current | Annual |

- Auditor of vendor: Schellman & Co. (independent CPA firm).
- Trust Services Criteria covered: Security, Availability, Confidentiality.
- Material exceptions in vendor's report: **None.**

## Data shared with this vendor

- Recipient email addresses for transactional and notification email.
- Email subject and body content (which may contain customer-supplied
  text such as project names, change-order summaries, and similar
  metadata). No payment card data, no SSNs, no passwords.
- API key authentication; SPF, DKIM, and DMARC configured for our
  sending domain.

Confirmed appropriate for the service: **Yes.** Email delivery requires
the recipient address and message content; this is the minimum
necessary set.

## Contract / DPA review

| Item | Status | Notes |
| ---- | ------ | ----- |
| Master Services Agreement on file | Yes | Twilio enterprise order form |
| Data Processing Addendum (DPA) signed | Yes | Includes EU SCCs |
| Sub-processor list reviewed | Yes | https://www.twilio.com/en-us/legal/sub-processors — no material change |
| Breach notification SLA | Yes | ≤ 72 hours per DPA |
| Data residency commitments unchanged | Yes | US region |
| Pricing / commercial terms unchanged | Yes | No material change |

## Incidents during the review period

- No security incidents involving this vendor that affected our tenant
  were reported to us during 2025-04-22 → 2026-04-22.

## Findings

- **None material.** SOC 2 Type II current (bridge letter on file),
  DPA in force, sub-processor list unchanged, sending-domain
  authentication intact, no incidents.
- No remediation-plan entry required.

## Outcome

- **PASS** — relationship continues; next review due 2027-04-22.

## Sign-off

| Role | Name | Date |
| ---- | ---- | ---- |
| Internal owner (Head of Engineering) | (on file in GRC platform) | 2026-04-22 |
| SOC 2 program owner | (on file in GRC platform) | 2026-04-22 |
| CTO (per policy §3 for High-tier) | (on file in GRC platform) | 2026-04-22 |
