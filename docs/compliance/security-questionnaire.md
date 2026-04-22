# Security Questionnaire — Standard Responses

This document holds canonical answers to the questions the Company is
asked most often by enterprise InfoSec teams. It is structured so the
Sales team can copy answers directly into a customer-supplied
questionnaire (CAIQ-Lite, SIG-Lite, vendor-specific). When a question
is not covered, route it to security@.

Last reviewed: 2026-04-22.

## A — Compliance & Audits

| # | Question | Answer |
| - | -------- | ------ |
| A1 | Do you maintain a SOC 2 Type II report? | The Company is in active observation for its first SOC 2 Type II audit. Type I report and bridge letter available under NDA. |
| A2 | Will you provide the report under NDA? | Yes. Request via security@. |
| A3 | Do you maintain ISO/IEC 27001 certification? | Not at this time. SOC 2 work is the foundation; ISO 27001 is on the roadmap. |
| A4 | Do you have a public Trust page? | Yes — `/trust` on the marketing site. |
| A5 | Do you have a public sub-processor list? | Yes — `/sub-processors`. |

## B — Governance

| # | Question | Answer |
| - | -------- | ------ |
| B1 | Do you have an Information Security Policy? | Yes. Approved by the CEO; reviewed annually. See `docs/compliance/policies/01`. |
| B2 | Is there a designated security owner? | Yes — the CTO, who reports security posture to the CEO. |
| B3 | Do all staff complete security awareness training? | Yes — on hire and annually. Tracked in the GRC platform. |
| B4 | Do you carry cyber-liability insurance? | Yes. Limits available under NDA. |

## C — Identity & Access

| # | Question | Answer |
| - | -------- | ------ |
| C1 | Is MFA enforced for all staff? | Yes — at the IdP, mandatory. |
| C2 | Do you offer SSO (SAML 2.0) for customer admins? | Yes. Configurable per organization; can be enforced. |
| C3 | Do you offer phishing-resistant MFA for customers? | Yes — WebAuthn passkeys. |
| C4 | How is least-privilege enforced inside the application? | Role-based access control + per-feature permissions, enforced server-side; tenant isolation by `organizationId`. |
| C5 | How is access reviewed? | Quarterly per system. Access export available via the audit-export endpoint. |
| C6 | How is access revoked on termination? | Same-day at the IdP; long-lived tokens revoked via `revokeUserTokens`. |

## D — Encryption & Cryptography

| # | Question | Answer |
| - | -------- | ------ |
| D1 | TLS version supported? | TLS 1.2 minimum. TLS 1.3 preferred at the edge. |
| D2 | Encryption at rest? | AES-256 for the database (Neon) and object storage (GCS). |
| D3 | Where are secrets stored? | Managed environment-variable vault. Not in the repository. |
| D4 | How are passwords stored? | bcrypt, cost factor 10. |
| D5 | Do you have access to customer encryption keys? | Provider-managed keys for at-rest encryption. We do not currently offer customer-managed keys (BYOK). |

## E — Application & Infrastructure Security

| # | Question | Answer |
| - | -------- | ------ |
| E1 | Where is data hosted? | United States, on Replit (compute), Neon (database), and Google Cloud (object storage). |
| E2 | Is data segregated per customer? | Yes — logical isolation by `organizationId` enforced server-side on every query. |
| E3 | Do you penetration test? | Annually by a qualified third party. Most recent summary available under NDA. |
| E4 | Do you scan for vulnerabilities? | Yes — dependency audit + SAST + secret scan + IaC scan in CI on every PR; weekly scans on `main`. |
| E5 | Do you have a vulnerability disclosure / bug-bounty program? | Yes — security@ accepts reports; safe harbor language is on the Trust page. |
| E6 | How are changes to production controlled? | Branch protection on `main`, mandatory PR review, all CI checks pass, automated deploy with health-check gating and rollback. |
| E7 | What logging do you keep? | Application audit log (1 year minimum, tamper-evident), HTTP/system logs (90 days), infra audit logs (1 year). |

## F — Availability & Resilience

| # | Question | Answer |
| - | -------- | ------ |
| F1 | What is your uptime SLA? | 99.9% monthly, excluding announced maintenance. Live status at `/status`. |
| F2 | RTO / RPO? | Tier-1: RTO 4h, RPO 15m. |
| F3 | Backup strategy? | Postgres PITR with 7-day window; daily logical dumps to a separate cloud account with 30-day retention and object-lock. |
| F4 | Cross-region replication for files? | Yes — GCS cross-region replication on customer file buckets. |
| F5 | Restore drills? | Quarterly. Evidence retained. |

## G — Incident Response

| # | Question | Answer |
| - | -------- | ------ |
| G1 | Do you have an IR plan? | Yes — see policy #04. |
| G2 | Customer notification timeline for confirmed data breach? | Within 72 hours, or any tighter contractual SLA. |
| G3 | IR plan tested? | Annually via tabletop. |

## H — Privacy & Data Handling

| # | Question | Answer |
| - | -------- | ------ |
| H1 | Do you sign a DPA? | Yes — see `dpa-template.md`. |
| H2 | Where is personal data processed? | United States. |
| H3 | Sub-processors? | Listed at `/sub-processors`. 30 days advance notice on additions. |
| H4 | Data subject access / deletion timeline? | Within 30 days of request. |
| H5 | Data retention after account deletion? | Soft-delete immediately; hard-delete within 30 days; backups age out within 30 days. |
| H6 | Cross-border transfers? | Service is US-hosted. SCCs available for EU customers on request. |

## I — Endpoint & Personnel

| # | Question | Answer |
| - | -------- | ------ |
| I1 | Are staff laptops centrally managed? | Yes — MDM with disk encryption, screen lock, OS update enforcement, EDR. |
| I2 | Background checks? | Yes — for all staff with access to production or customer data, where permitted by law. |
| I3 | Confidentiality agreements? | Yes — required of all employees and contractors. |

## J — AI

| # | Question | Answer |
| - | -------- | ------ |
| J1 | Do you use AI / LLMs? | Yes, for opt-in features (bid analysis, contract analysis, suggestions). |
| J2 | Is customer data used to train models? | No. Our agreement with the AI provider prohibits training on customer data. |
| J3 | Where are AI requests processed? | OpenAI, US region. |
| J4 | Can the customer disable AI features? | Yes — at the organization level. |
