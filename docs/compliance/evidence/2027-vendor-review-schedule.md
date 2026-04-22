# 2027 Vendor Review Schedule

- **Filed:** 2026-04-22
- **Author:** SOC 2 program owner (Head of Engineering)
- **Controls addressed:** CC9.2 (Vendor management)
- **Related documents:** `../policies/05-vendor-management-policy.md`,
  `../sub-processors.md`, `../vendor-attestation-tracker.md`,
  the 2026 vendor review files (`2026-vendor-review-*.md`) in this directory

## Purpose

Per the Vendor Management Policy §4, Critical-tier vendors are reviewed
**annually + on any incident** and High-tier vendors are reviewed
**annually**. The first round of annual reviews was filed on
2026-04-22. This document schedules the 2027 round so nothing slips, and
mirrors the entries that have been booked on the team calendar and in
the GRC platform's review-task queue.

## 2027 review cycle

Each review is a recurring annual task in the GRC platform with a
calendar event on the security-program team calendar. Reviews are
scheduled to start **two weeks before** the policy due date so there is
buffer for sign-off; the policy due date for every vendor below is
**2027-04-22** (one year after the 2026 reviews).

| Vendor | Tier | Internal owner | Review window opens | Policy due date | Sign-off required |
| ------ | ---- | -------------- | ------------------- | --------------- | ----------------- |
| Replit, Inc. | Critical | Head of Engineering | 2027-04-08 | 2027-04-22 | Owner + SOC 2 program owner + CTO |
| Neon, Inc. | Critical | Head of Engineering | 2027-04-08 | 2027-04-22 | Owner + SOC 2 program owner + CTO |
| Google Cloud (GCS) | Critical | Head of Engineering | 2027-04-08 | 2027-04-22 | Owner + SOC 2 program owner + CTO |
| OpenAI, L.L.C. | High | Head of Engineering | 2027-04-08 | 2027-04-22 | Owner + SOC 2 program owner + CTO |
| Twilio — SendGrid | High | Head of Engineering | 2027-04-08 | 2027-04-22 | Owner + SOC 2 program owner + CTO |
| Stripe, Inc. | High | Head of Engineering | 2027-04-08 | 2027-04-22 | Owner + SOC 2 program owner + CTO |

Each review is filed at `docs/compliance/evidence/2027-vendor-review-<vendor>.md`
following the filename pattern in `README.md` and the checklist in the
"Vendor review runbook" section of that file.

## Calendar entries (recurring annual)

One recurring calendar event per Critical / High vendor has been booked
on the security-program team calendar with the SOC 2 program owner as
organizer and the listed internal owner as required attendee. Each
event corresponds to a recurring annual review task in the GRC
platform, ID noted below for audit traceability.

| # | Calendar event | Date | Recurrence | GRC task ID |
| - | -------------- | ---- | ---------- | ----------- |
| 1 | 2027 vendor review — Replit, Inc. (Critical) | 2027-04-08 → 2027-04-22 | Annual | GRC-VR-REPLIT-2027 |
| 2 | 2027 vendor review — Neon, Inc. (Critical) | 2027-04-08 → 2027-04-22 | Annual | GRC-VR-NEON-2027 |
| 3 | 2027 vendor review — Google Cloud / GCS (Critical) | 2027-04-08 → 2027-04-22 | Annual | GRC-VR-GCS-2027 |
| 4 | 2027 vendor review — OpenAI, L.L.C. (High) | 2027-04-08 → 2027-04-22 | Annual | GRC-VR-OPENAI-2027 |
| 5 | 2027 vendor review — Twilio / SendGrid (High) | 2027-04-08 → 2027-04-22 | Annual | GRC-VR-SENDGRID-2027 |
| 6 | 2027 vendor review — Stripe, Inc. (High) | 2027-04-08 → 2027-04-22 | Annual | GRC-VR-STRIPE-2027 |
| 7 | All vendor reviews due (policy deadline) | 2027-04-22 | Annual | GRC-VR-DEADLINE-2027 |
| 8 | Mid-cycle attestation check (see tracker) | 2026-10-22 | Semi-annual | GRC-VR-MIDCYCLE-2026H2 |

The mid-cycle check exists so attestation re-issuances and bridge-letter
expiries that fall between annual reviews are not missed; it is driven
off `../vendor-attestation-tracker.md`.

## Out-of-cycle triggers

A vendor review is also booked, regardless of the schedule above, when
any of the following occur (per policy §4):

- A security incident involving the vendor is reported or detected.
- The vendor publishes a new sub-processor (notice clock starts; see policy §5).
- An attestation lapses without a bridge letter (see tracker).
- A material change to the vendor's services, region of processing, or
  commercial terms.

When triggered, the SOC 2 program owner files an interim review using
the same template and links it from the next annual review.
