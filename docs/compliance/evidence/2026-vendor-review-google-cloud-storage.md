# Annual Vendor Review — Google Cloud (Object Storage / GCS)

- **Date:** 2026-04-22
- **Author:** SOC 2 program owner (Head of Engineering)
- **Controls addressed:** CC9.2 (Vendor management), CC6.1 (Encryption at rest), C1.2 (Per-object ACL)
- **Related documents:** `../sub-processors.md`,
  `../policies/05-vendor-management-policy.md`,
  `../remediation-plan.md` (GAP-005)

## Vendor record

| Field | Value |
| ----- | ----- |
| Vendor | Google LLC — Google Cloud Platform (Cloud Storage / GCS) |
| Service provided | Object storage for customer file uploads (plans, photos, documents) |
| Type | Sub-processor / sub-service organization (carved out of our SOC 2) |
| Risk tier | **Critical** |
| Internal owner | Head of Engineering |
| Region of processing | United States (multi-region: `US`) |
| Date of last review | 2026-04-22 (this review) |
| Date of next review | 2027-04-22 |

## Attestations on file

| Attestation | Reference / link | Period covered | Expiry |
| ----------- | ---------------- | -------------- | ------ |
| SOC 2 Type II | https://cloud.google.com/security/compliance/soc-2 (download via Compliance Reports Manager; PDF stored in GRC platform vendor record under "GCP / Attestations / 2025") | 2024-05-01 → 2025-04-30 | Re-issued annually; latest report covering window 2025-05-01 → 2026-04-30 published 2026-06 (per Google's typical cadence). Bridge letter on file through 2026-06-30. |
| SOC 3 (public) | https://cloud.google.com/security/compliance/soc-3 | Same period | Same |
| ISO/IEC 27001, 27017, 27018 | https://cloud.google.com/security/compliance | Current | Renews annually |
| FedRAMP High (informational) | Not relied on by us | — | — |

- Auditor of vendor: EY (independent CPA firm).
- Trust Services Criteria covered: Security, Availability, Confidentiality, Processing Integrity.
- Material exceptions in vendor's report: **None.**

## Data shared with this vendor

- Customer-uploaded files: drawings, plans, photos, attachments, exports.
- Object metadata (filename, size, content type, owning org/user IDs).
- Encryption: AES-256 at rest (Google-managed keys), TLS 1.2+ in transit.
- Access control: per-object ACL plus signed URLs; bucket is private.

Confirmed appropriate for the service: **Yes.** Object storage of
customer-uploaded files is the intended use.

## Contract / DPA review

| Item | Status | Notes |
| ---- | ------ | ----- |
| Google Cloud Terms of Service on file | Yes | Online TOS plus signed enterprise order form |
| Data Processing Addendum (Cloud DPA) | Yes | Includes EU SCCs (module 2 + 3) |
| Sub-processor list reviewed | Yes | https://cloud.google.com/terms/subprocessors — no material change |
| Breach notification SLA | Yes | "Without undue delay," meets our DPA |
| Data residency commitments unchanged | Yes | US multi-region pinned |
| Pricing / commercial terms unchanged | Yes | No material change |

## Incidents during the review period

- No security incidents involving this vendor that affected our tenant
  were reported to us, and none were detected by our monitoring,
  during 2025-04-22 → 2026-04-22.

## Findings

- **None material.** SOC 2 Type II current with bridge letter, Cloud
  DPA in force, sub-processor list unchanged, no incidents.
- No remediation-plan entry required.

## Outcome

- **PASS** — relationship continues; next review due 2027-04-22.

## Sign-off

| Role | Name | Date |
| ---- | ---- | ---- |
| Internal owner (Head of Engineering) | (on file in GRC platform) | 2026-04-22 |
| SOC 2 program owner | (on file in GRC platform) | 2026-04-22 |
| CTO (per policy §3 for Critical-tier) | (on file in GRC platform) | 2026-04-22 |
