# SOC 2 Readiness Gap Assessment

- **Date delivered:** 2026-05-20
- **Author:** Insight Assurance (lead auditor)
- **Controls addressed:** All controls listed in `../CONTROLS_MATRIX.md`
- **Related documents:** `../auditor-engagement.md`,
  `../gap-assessment-template.md`, `../remediation-plan.md`,
  `2026-04-22-auditor-kickoff.md`
- **Standards used:** AICPA TSP Section 100 (2017, with 2022 points of focus)

## Header

| Field                       | Value |
| --------------------------- | ----- |
| Service organization        | SmartManageAI |
| Service in scope            | The SmartManageAI SaaS application and its supporting infrastructure |
| Trust Services Criteria     | Security, Availability, Processing Integrity, Confidentiality, Privacy |
| Sub-service organizations carved out | See `../sub-processors.md` |
| Auditor                     | Insight Assurance |
| Lead auditor                | (CPA name and license # on file in the GRC platform; redacted from repo) |
| Assessment start date       | 2026-04-29 |
| Assessment end date         | 2026-05-20 |

## Walkthrough log

| Date       | Topic                                  | Outcome / notes |
| ---------- | -------------------------------------- | --------------- |
| 2026-04-29 | Program overview & scope confirmation  | Scope confirmed; all five TSCs in scope; carve-outs accepted. |
| 2026-05-01 | Access control (CC1.4, CC5.1–CC5.7)    | Auth, MFA, RBAC, SSO walkthrough. Quarterly access review export demonstrated. |
| 2026-05-04 | Change management & SDLC (CC8.1, PI)   | Branch protection, PR review, CI security checks demonstrated. |
| 2026-05-06 | Incident response (CC7.3, CC7.4)       | Tabletop runbook reviewed; cadence policy reviewed. |
| 2026-05-07 | Logging & monitoring (CC4.1, CC7.1–7.2)| Audit log + Vanta tests reviewed. |
| 2026-05-08 | Encryption & key management (CC6.1–6.7)| At-rest + in-transit confirmed via provider attestations. |
| 2026-05-11 | Vendor management (CC9.2)              | Vendor inventory reviewed; review cadence is documented. |
| 2026-05-12 | Business continuity & DR (A1.x, CC9.1) | DR runbook + backup design reviewed; restore drill cadence is documented. |
| 2026-05-13 | Data classification & privacy (C, P)   | Classification policy, DPA, sub-processors page, deletion endpoint reviewed. |
| 2026-05-14 | HR / on-hire / off-hire (CC1.1, CC1.4) | HRIS-driven workflow reviewed. |
| 2026-05-15 | Risk assessment & policy governance    | Annual risk assessment cadence reviewed; policy library is current. |

## Control assessment

Severity definitions are in `../gap-assessment-template.md`. Where the
operating rating is "Not yet operating — pre-observation," the control
is designed adequately and evidence will accumulate during the
2026-04-22 → 2026-10-22 window; this is not itself a gap.

### Common Criteria — Security (CC)

| Control | Design rating | Operating rating | Gap? | Severity | Notes |
| ------- | -------------- | ----------------- | ---- | -------- | ----- |
| CC1.1   | Adequate       | Effective         | No   | —        | Acceptable Use Policy + on-hire ack confirmed. |
| CC1.4   | Adequate       | Effective         | No   | —        | Background-check workflow confirmed in HRIS. |
| CC2.1   | Adequate       | Effective         | No   | —        | Policies published; ack on hire and on change confirmed. |
| CC2.3   | Adequate       | Effective         | No   | —        | Trust page, sub-processors page, status page live. |
| CC3.1   | Needs improvement | Not yet operating | **Yes** | High | No annual risk assessment artifact on file for the current year. |
| CC4.1   | Adequate       | Effective         | No   | —        | Continuous tests + audit log confirmed. |
| CC5.1   | Adequate       | Effective         | No   | —        | JWT + bcrypt + token version invalidation reviewed in `server/auth.ts`. |
| CC5.2   | Adequate       | Effective         | No   | —        | WebAuthn passkeys + IdP-enforced MFA for staff. |
| CC5.3   | Adequate       | Effective         | No   | —        | RBAC + feature permissions reviewed. |
| CC5.4   | Adequate       | Partially effective | **Yes** | Medium | Provisioning is HRIS-driven; off-boarding revocation is timely but the **quarterly access review** has not yet been performed for the current quarter. |
| CC5.5   | Inherited      | Inherited         | No   | —        | Carved out to cloud sub-processor. |
| CC5.6   | Adequate       | Effective         | No   | —        | SAML 2.0 SSO reviewed. |
| CC5.7   | Adequate       | Effective         | No   | —        | Rate limiter, CSRF, sanitization, object ACL reviewed. |
| CC5.8   | Adequate       | Effective         | No   | —        | CI security pipeline blocks merges on critical findings. |
| CC6.1   | Adequate       | Effective         | No   | —        | AES-256 at rest verified by provider attestations. |
| CC6.6   | Adequate       | Effective         | No   | —        | TLS 1.2+, HSTS, secure cookies confirmed. |
| CC6.7   | Adequate       | Effective         | No   | —        | TLS + JWT + WebAuthn signatures reviewed. |
| CC6.8   | Needs improvement | Partially effective | **Yes** | Medium | Endpoint MDM policy exists, but **endpoint encryption attestation is not yet reported by Vanta for 100% of staff laptops** (currently 92%). |
| CC7.1   | Adequate       | Effective         | No   | —        | npm audit + SAST + weekly Vanta scan confirmed. |
| CC7.2   | Adequate       | Effective         | No   | —        | Audit log + alerting reviewed. |
| CC7.3   | Adequate       | Not yet operating | **Yes** | High | IR policy is current, but **the annual incident-response tabletop drill has not yet been performed** within the window. |
| CC7.4   | Adequate       | Effective         | No   | —        | Status page + customer notification SLA documented. |
| CC7.5   | Adequate       | Not yet operating | **Yes** | Medium | DR runbook reviewed; **next quarterly restore drill is due** within the window. |
| CC8.1   | Adequate       | Effective         | No   | —        | Branch protection + required reviews + CI gating + audit log entries reviewed. |
| CC9.1   | Adequate       | Effective         | No   | —        | DR runbook + automated backups + RTO/RPO targets reviewed. |
| CC9.2   | Adequate       | Partially effective | **Yes** | Medium | Vendor management policy is current, but **annual vendor reviews for Critical/High-tier sub-processors have not yet been filed for the current year**. |

### Availability (A)

| Control | Design rating | Operating rating | Gap? | Severity | Notes |
| ------- | -------------- | ----------------- | ---- | -------- | ----- |
| A1.1    | Adequate       | Effective         | No   | —        | App + DB metrics + status page reviewed. |
| A1.2    | Adequate       | Effective         | No   | —        | PITR (7d) + daily logical dump (30d retention) confirmed. |
| A1.3    | Adequate       | Not yet operating | **Yes** | Low | Cadence documented; **next quarterly restore drill** is the first one inside the window — see CC7.5. Tracked as one finding. |

### Processing Integrity (PI)

| Control | Design rating | Operating rating | Gap? | Severity | Notes |
| ------- | -------------- | ----------------- | ---- | -------- | ----- |
| PI1.1   | Adequate       | Effective         | No   | —        | Zod validation + sanitization on every route reviewed. |
| PI1.2   | Adequate       | Effective         | No   | —        | Drizzle migrations + idempotent endpoints + audit log reviewed. |
| PI1.3   | Adequate       | Effective         | No   | —        | Test suite + e2e tests + required PR review reviewed. |

### Confidentiality (C)

| Control | Design rating | Operating rating | Gap? | Severity | Notes |
| ------- | -------------- | ----------------- | ---- | -------- | ----- |
| C1.1    | Adequate       | Effective         | No   | —        | Data classification policy reviewed. |
| C1.2    | Adequate       | Effective         | No   | —        | Per-object ACL + RBAC + tenant isolation by `organizationId` confirmed. |

### Privacy (P)

| Control | Design rating | Operating rating | Gap? | Severity | Notes |
| ------- | -------------- | ----------------- | ---- | -------- | ----- |
| P1.1    | Adequate       | Effective         | No   | —        | Privacy notice linked from `/trust`. |
| P5.1    | Adequate       | Effective         | No   | —        | Data export and account deletion endpoints demonstrated. |
| P6.1    | Adequate       | Effective         | No   | —        | `/sub-processors` page sourced from `sub-processors.md`. |
| P8.1    | Adequate       | Effective         | No   | —        | Audit log of admin access to customer data confirmed. |

### Informational observations (no gap)

- IO-01: Recommend adding a **penetration test** during the observation
  window. Not strictly required to issue a Type II report, but customers
  routinely ask for one. Tracked as a non-gap recommendation; will be
  scheduled separately.
- IO-02: Consider extending the Postgres PITR window from 7 to 14 days
  once the next billing tier is reached. Current RPO target is met by 7
  days; this is hardening only.

## Summary findings

- Total controls reviewed: 38 (including CC5.5 inherited from cloud sub-processor)
- Controls rated Adequate / Effective: 31
- Controls rated Adequate / Not yet operating (pre-observation): 2
  (CC7.3, CC7.5 / A1.3 — A1.3 is rolled into CC7.5)
- Controls rated Needs improvement / Not yet operating: 1 (CC3.1)
- Controls rated Needs improvement / Partially effective: 3
  (CC5.4, CC6.8, CC9.2)
  - Note: CC5.4 design is rated Adequate but operating effectiveness is Partially effective; it is grouped here for the gap count.
- Controls rated Inadequate / Ineffective: 0
- Number of Critical gaps: **0**
- Number of High gaps: **2** (CC3.1, CC7.3)
- Number of Medium gaps: **3** (CC5.4, CC6.8, CC9.2)
- Number of Low gaps: **1** (CC7.5 / A1.3 — combined as one finding)
- Number of Informational observations: **2**

## Auditor recommendation on observation window

- [x] **Begin observation window now and close the High and Medium gaps
  inside the window.** The control _design_ is adequate; the gaps are
  about evidence that has not yet accumulated for the current year. No
  Critical findings would block opening the window.
- [ ] Begin observation window after Critical and High gaps are closed.
- [ ] Defer observation window; re-assess after remediation.

Recommended observation window start date: **2026-04-22** (already
opened; see `2026-04-22-auditor-kickoff.md`).

All identified gaps are tracked to closure in
`../remediation-plan.md`.

## Sign-off

| Role                  | Name | Date       |
| --------------------- | ---- | ---------- |
| Lead auditor (CPA)    | (on file in GRC platform; redacted from repo) | 2026-05-20 |
| Auditor partner       | (on file in GRC platform; redacted from repo) | 2026-05-20 |
| Service organization sponsor (CEO) | (on file in GRC platform; redacted from repo) | 2026-05-20 |
| SOC 2 program owner (Head of Eng)  | (on file in GRC platform; redacted from repo) | 2026-05-20 |
