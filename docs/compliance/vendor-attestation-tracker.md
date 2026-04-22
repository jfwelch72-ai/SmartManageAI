# Vendor Attestation & Bridge-Letter Tracker

- **Filed:** 2026-04-22
- **Owner:** SOC 2 program owner (Head of Engineering)
- **Controls addressed:** CC9.2 (Vendor management), CC5.5 (Inherited controls)
- **Related documents:** `policies/05-vendor-management-policy.md`,
  `sub-processors.md`, `evidence/2027-vendor-review-schedule.md`,
  the 2026 vendor review files in `evidence/`

## Purpose

Track each Critical / High-tier sub-processor's SOC 2 / SOC 1 / PCI / ISO
re-issuance dates and bridge-letter expiries, so we never enter auditor
fieldwork with an expired attestation. Each row below is mirrored as a
recurring task in the GRC platform with a **reminder 30 days before the
expiry date** routed to the internal owner and the SOC 2 program owner.

## How to read this table

- **Expiry** is the date by which the *next* attestation (or refreshed
  bridge letter) must be on file.
- **Reminder date** is `Expiry − 30 days`; the GRC platform fires the
  task to the owner on that date.
- **Action on reminder** is what the owner does when the reminder fires:
  download the new report, request an updated bridge letter, or both.
- When a new attestation is filed, update the row (new period covered,
  new expiry, recompute reminder) and note the change in
  "Change history" at the bottom.

## Tracker

| # | Vendor | Tier | Attestation | Period covered (latest on file) | Expiry | Reminder date (T-30) | Action on reminder | Owner |
| - | ------ | ---- | ----------- | ------------------------------- | ------ | -------------------- | ------------------ | ----- |
| 1 | Google Cloud (GCS) | Critical | SOC 2 Type II + bridge letter | 2024-05-01 → 2025-04-30 (bridge through 2026-06-30) | 2026-06-30 | 2026-05-31 | Download 2025-05-01 → 2026-04-30 SOC 2 Type II from Compliance Reports Manager; refresh bridge letter if new report not yet published | Head of Engineering |
| 2 | Neon, Inc. | Critical | SOC 2 Type II + bridge letter | 2024-07-01 → 2025-06-30 (bridge through 2026-09-30) | 2026-09-30 | 2026-08-31 | Request 2025-07-01 → 2026-06-30 SOC 2 Type II from Neon; refresh bridge letter if new report not yet issued | Head of Engineering |
| 3 | Twilio — SendGrid | High | SOC 2 Type II + bridge letter | 2024-10-01 → 2025-09-30 (bridge through 2026-11-30) | 2026-11-30 | 2026-10-31 | Download 2025-10-01 → 2026-09-30 SOC 2 Type II from Twilio compliance portal; refresh bridge letter if needed | Head of Engineering |
| 4 | Replit, Inc. | Critical | SOC 2 Type II + bridge letter | 2024-10-01 → 2025-09-30 (bridge through 2026-12-31) | 2026-12-31 | 2026-12-01 | Request 2025-10-01 → 2026-09-30 SOC 2 Type II via Replit security portal; refresh bridge letter if needed | Head of Engineering |
| 5 | OpenAI, L.L.C. | High | SOC 2 Type II + bridge letter | 2024-11-01 → 2025-10-31 (bridge through 2026-12-31) | 2026-12-31 | 2026-12-01 | Download 2025-11-01 → 2026-10-31 SOC 2 Type II from trust.openai.com; refresh bridge letter and re-confirm zero-data-retention attestation | Head of Engineering |
| 6 | Stripe, Inc. | High | SOC 1 Type II + bridge letter | 2024-10-01 → 2025-09-30 (bridge through 2026-12-31) | 2026-12-31 | 2026-12-01 | Download new SOC 1 Type II from Stripe security portal; refresh bridge letter if needed | Head of Engineering |
| 7 | Stripe, Inc. | High | SOC 2 Type II + bridge letter | 2024-10-01 → 2025-09-30 (bridge through 2026-12-31) | 2026-12-31 | 2026-12-01 | Download new SOC 2 Type II alongside SOC 1 above | Head of Engineering |
| 8 | Stripe, Inc. | High | PCI DSS Level 1 (Service Provider) AOC | Current as of last review (annual) | 2027-04-22 (re-verify at next annual review) | 2027-03-23 | Download refreshed AOC from Stripe security portal | Head of Engineering |
| 9 | Google Cloud (GCS) | Critical | ISO/IEC 27001 / 27017 / 27018 | Current (annual recertification) | 2027-04-22 (re-verify at next annual review) | 2027-03-23 | Confirm certificates remain current at cloud.google.com/security/compliance | Head of Engineering |
| 10 | Neon, Inc. | Critical | ISO/IEC 27001 (inherited from AWS) | Current | 2027-04-22 (re-verify at next annual review) | 2027-03-23 | Confirm AWS ISO certificate still listed on Neon's security page | Head of Engineering |
| 11 | Twilio — SendGrid | High | ISO/IEC 27001 / 27017 / 27018 | Current | 2027-04-22 (re-verify at next annual review) | 2027-03-23 | Confirm certificates still listed on Twilio compliance page | Head of Engineering |
| 12 | Stripe, Inc. | High | ISO/IEC 27001 | Current | 2027-04-22 (re-verify at next annual review) | 2027-03-23 | Confirm certificate still listed on Stripe security page | Head of Engineering |
| 13 | OpenAI, L.L.C. | High | CSA STAR (registry listing) | Current | 2027-04-22 (re-verify at next annual review) | 2027-03-23 | Confirm registry entry at cloudsecurityalliance.org/star/registry | Head of Engineering |

## Operating rules

1. **Never let an attestation lapse without a bridge letter.** If the
   re-issued report is not yet available on the reminder date, request
   an updated bridge letter from the vendor that extends coverage.
2. **File the new artifact in the GRC platform** under the vendor's
   "Attestations / <year>" folder, then update the row above and note
   it in change history.
3. **If a vendor will not provide a bridge letter or updated report,**
   open a remediation-plan entry, notify the CTO, and re-tier the vendor
   if the gap is material.
4. **Mid-cycle check (2026-10-22):** the SOC 2 program owner walks this
   tracker top-to-bottom to confirm every reminder fired and every
   action was taken; the result is filed as
   `evidence/2026-10-22-vendor-attestation-midcycle.md`.

## Change history

| Date | Change |
| ---- | ------ |
| 2026-04-22 | Initial tracker created from the 2026 vendor reviews |
