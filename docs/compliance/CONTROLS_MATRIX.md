# SOC 2 Controls Matrix

This matrix maps each in-scope control to (a) the policy that documents it
and (b) the code, configuration, or runbook that implements it. Auditors
should be able to follow any row from "control" to "evidence" without asking
us a clarifying question.

Legend for **Status**: `Implemented` (technical control in production),
`Documented` (policy + process exist, evidence collected manually),
`Monitored` (continuously verified by Vanta).

## Common Criteria — Security (CC)

| #     | Control                                                | Status        | Policy   | Implementation / evidence |
| ----- | ------------------------------------------------------ | ------------- | -------- | ------------------------- |
| CC1.1 | Code of Conduct & integrity                            | Documented    | 08       | `policies/08-acceptable-use-policy.md` + signed acknowledgement on hire |
| CC1.4 | Hiring screen, background checks                       | Documented    | 02       | HRIS workflow; evidence in HRIS export |
| CC2.1 | Internal communication of policies                     | Documented    | 01       | Policies published in repo + employee portal; ack required on hire and on change |
| CC2.3 | Customer communication of security commitments         | Implemented   | 01       | Public Trust page (`/trust`), sub-processor list (`/sub-processors`), status page (`/status`) |
| CC3.1 | Risk assessment performed annually                     | Documented    | 01       | `evidence/YYYY-risk-assessment.md` (annual) |
| CC4.1 | Monitoring of controls                                 | Monitored     | 11       | Vanta continuous tests + `server/auditLogger.ts` + `server/auditExportRoutes.ts` |
| CC5.1 | Logical access — authentication                        | Implemented   | 02       | `server/auth.ts`: JWT + bcrypt + token version invalidation. Passkeys via `server/passkeyRoutes.ts` |
| CC5.2 | Logical access — MFA                                   | Implemented   | 02       | WebAuthn passkeys (`server/passkeyRoutes.ts`); IdP-enforced MFA for staff (Vanta-monitored) |
| CC5.3 | Logical access — RBAC + least privilege                | Implemented   | 02       | `server/auth.ts` `requireRole` / `requireFeaturePermission`; quarterly access review export via `server/auditExportRoutes.ts` |
| CC5.4 | Logical access — provisioning / deprovisioning         | Implemented   | 02       | `revokeUserTokens()` in `server/auth.ts`; HRIS-driven user lifecycle |
| CC5.5 | Physical access                                        | Inherited     | 01       | Inherited from cloud provider SOC 2 (sub-processor list) |
| CC5.6 | External access — SSO/SAML                             | Implemented   | 02       | `server/ssoRoutes.ts` (SAML 2.0) |
| CC5.7 | Logical access — protect against threats               | Implemented   | 02       | `server/rateLimiter.ts`, `server/csrf.ts`, `server/sanitization.ts`, `server/objectAcl.ts` |
| CC5.8 | Detect and prevent malicious software                  | Implemented   | 09, 11   | CI: dep audit + SAST + secret scan + IaC scan (`scripts/ci-security.sh`); blocks merges on critical findings |
| CC6.1 | Encryption at rest                                     | Implemented   | 10       | Neon Postgres (AES-256), GCS object storage (AES-256). Verified by Vanta. |
| CC6.6 | Encryption in transit                                  | Implemented   | 10       | TLS 1.2+ enforced; `secure: true` cookies in production; HSTS via reverse proxy |
| CC6.7 | Data transmission integrity                            | Implemented   | 10       | TLS + JWT signatures + WebAuthn signatures |
| CC6.8 | Prevent unauthorized software                          | Documented    | 12       | Endpoint MDM policy; Vanta endpoint agent on staff laptops |
| CC7.1 | Detection of vulnerabilities                           | Monitored     | 09       | CI dep audit (npm audit), SAST in CI, weekly Vanta vuln scan |
| CC7.2 | Anomaly detection / monitoring                         | Implemented   | 11       | Centralized logs; admin actions in `auditLog` table; alerting in monitoring tool |
| CC7.3 | Incident evaluation & response                         | Documented    | 04       | `policies/04-incident-response-policy.md` + tabletop drill in `runbooks/incident-response-tabletop.md` |
| CC7.4 | Incident communication                                 | Documented    | 04       | Status page + customer notification SLA in IR policy |
| CC7.5 | Recovery from incidents                                | Documented    | 07       | `runbooks/disaster-recovery-runbook.md` + quarterly drill |
| CC8.1 | Change management                                      | Implemented   | 03       | Branch protection on `main`; PR review required; CI must pass; deployment gated; `auditLog` entries for prod changes |
| CC9.1 | Risk mitigation — business disruptions                 | Documented    | 07       | DR runbook + automated backups + RTO/RPO targets |
| CC9.2 | Vendor management                                      | Documented    | 05       | `policies/05-vendor-management-policy.md`; vendor inventory + annual review in `evidence/` |

## Availability (A)

| #     | Control                                                | Status        | Policy   | Implementation / evidence |
| ----- | ------------------------------------------------------ | ------------- | -------- | ------------------------- |
| A1.1  | Performance monitoring                                 | Implemented   | 11       | App + DB metrics; alerting; status page |
| A1.2  | Backup of data                                         | Implemented   | 07       | Neon Postgres point-in-time recovery (PITR) — 7 day window; daily logical dump to GCS (30 day retention) |
| A1.3  | Recovery testing                                       | Documented    | 07       | `runbooks/backup-restore-drill.md` — quarterly, results in `evidence/` |

## Processing Integrity (PI)

| #     | Control                                                | Status        | Policy   | Implementation / evidence |
| ----- | ------------------------------------------------------ | ------------- | -------- | ------------------------- |
| PI1.1 | Inputs are validated                                   | Implemented   | 09       | `server/sanitization.ts`; Zod validation on every route; insert-schemas in `shared/schema.ts` |
| PI1.2 | Processing is complete & accurate                      | Implemented   | 03, 09   | Drizzle migrations; idempotent endpoints; audit log for mutations |
| PI1.3 | Outputs are accurate                                   | Implemented   | 09       | Test suite + e2e tests in `e2e/`; PR review required |

## Confidentiality (C)

| #     | Control                                                | Status        | Policy   | Implementation / evidence |
| ----- | ------------------------------------------------------ | ------------- | -------- | ------------------------- |
| C1.1  | Identify and classify confidential data                | Documented    | 06       | `policies/06-data-classification-policy.md` |
| C1.2  | Restrict access to confidential data                   | Implemented   | 02, 06   | `server/objectAcl.ts` (per-object ACL); RBAC; tenant isolation by `organizationId` |

## Privacy (P)

| #     | Control                                                | Status        | Policy   | Implementation / evidence |
| ----- | ------------------------------------------------------ | ------------- | -------- | ------------------------- |
| P1.1  | Privacy notice provided                                | Implemented   | 06       | `/trust` page links to privacy policy + DPA |
| P5.1  | Data subject access / deletion                         | Implemented   | 06       | Data export endpoint + account deletion endpoint; documented turnaround in DPA |
| P6.1  | Sub-processors disclosed                               | Implemented   | 05       | `/sub-processors` page; sourced from `sub-processors.md` |
| P8.1  | Monitor compliance with privacy commitments            | Monitored     | 06       | Audit log of admin access to customer data via `server/auditLogger.ts` |

## How to update this matrix

1. When you add a control, add a row here first.
2. Reference the policy and the file path that implements it.
3. If the control is automated by Vanta, mark it `Monitored`; otherwise file
   the manual evidence in `evidence/` with a date-stamped filename.
