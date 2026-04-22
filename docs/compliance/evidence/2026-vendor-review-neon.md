# Annual Vendor Review — Neon, Inc.

- **Date:** 2026-04-22
- **Author:** SOC 2 program owner (Head of Engineering)
- **Controls addressed:** CC9.2 (Vendor management), CC6.1 (Encryption at rest), A1.2 (Backup), C1.2
- **Related documents:** `../sub-processors.md`,
  `../policies/05-vendor-management-policy.md`,
  `../remediation-plan.md` (GAP-005)

## Vendor record

| Field | Value |
| ----- | ----- |
| Vendor | Neon, Inc. |
| Service provided | Managed Postgres database (primary application data store) |
| Type | Sub-processor |
| Risk tier | **Critical** |
| Internal owner | Head of Engineering |
| Region of processing | United States (AWS us-east) |
| Date of last review | 2026-04-22 (this review) |
| Date of next review | 2027-04-22 |

## Attestations on file

| Attestation | Reference / link | Period covered | Expiry |
| ----------- | ---------------- | -------------- | ------ |
| SOC 2 Type II | https://neon.tech/security (request-gated; PDF in GRC vendor record under "Neon / Attestations / 2025") | 2024-07-01 → 2025-06-30 | Re-issuance expected 2026-09-30; bridge letter on file through that date |
| ISO/IEC 27001 | Inherited from underlying AWS infrastructure (carved out) | Current | Renews annually |
| Bridge letter | On file in GRC platform — covers 2025-07-01 → 2026-09-30 | — | — |

- Auditor of vendor: A-LIGN (independent CPA firm).
- Trust Services Criteria covered: Security, Availability, Confidentiality.
- Material exceptions in vendor's report: **None.**

## Data shared with this vendor

- All customer application data: organizations, users, projects,
  estimates, change orders, payroll, and audit log entries.
- Encryption: AES-256 at rest (managed by Neon), TLS 1.2+ in transit.
- PITR (7 days) and daily logical dumps configured.

Confirmed appropriate for the service: **Yes.** Neon is our primary
operational database; carrying the production data set is inherent.

## Contract / DPA review

| Item | Status | Notes |
| ---- | ------ | ----- |
| Master Services Agreement on file | Yes | Annual term |
| Data Processing Addendum (DPA) signed | Yes | Includes EU SCCs |
| Sub-processor list reviewed | Yes | AWS only; unchanged |
| Breach notification SLA | Yes | ≤ 72 hours |
| Data residency commitments unchanged | Yes | US region pinned |
| Pricing / commercial terms unchanged | Yes | No material change |

## Incidents during the review period

- No security incidents involving this vendor were reported to us, and
  none were detected by our monitoring, during 2025-04-22 → 2026-04-22.

## Findings

- **None material.** SOC 2 Type II current (bridge letter on file),
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
