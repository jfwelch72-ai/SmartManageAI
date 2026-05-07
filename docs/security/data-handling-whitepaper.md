# SmartManageAI Data Handling Whitepaper

_Last updated: 2026-05-07_

## 1. Purpose

This whitepaper describes how SmartManageAI collects, processes, stores, secures,
and ultimately deletes Customer Data. It is intended for prospective and existing
customers, security reviewers, and procurement teams. It complements the
[Privacy Policy](/privacy), [Terms of Service](/terms), [Data Processing
Addendum](/dpa), and [Sub-processor list](/sub-processors).

## 2. Data categories

| Category | Examples | Where stored |
| -------- | -------- | ------------ |
| Account / identity | name, work email, phone, role, hashed password, MFA factors | PostgreSQL (Neon) |
| Customer Data — operational | bids, projects, change orders, RFIs, schedules, daily reports, payroll | PostgreSQL |
| Customer Data — documents | plans (PDF), contracts, certifications, photos | Replit Object Storage (GCS) |
| Telemetry | structured server logs, request IDs, sanitized error events | Internal log store |
| Audit | append-only money-path mutations | PostgreSQL `audit_log` table |
| Billing | Stripe customer / subscription IDs (no card data) | Stripe (PCI-DSS L1) |

We do not collect or store cardholder data; payment instruments live exclusively
with Stripe.

## 3. Tenant isolation

- Logical separation: every multi-tenant table carries `organization_id`.
- Defense-in-depth: Postgres Row-Level Security (RLS) policies on every
  multi-tenant table fail closed. Cross-tenant access by SUPER_ADMIN must call
  `runAsSuperadmin(reason, ...)`, which writes to a dedicated
  `superadmin_access_log` table _before_ elevation and refuses on audit failure.
- Object Storage: every upload is keyed under `${PRIVATE_OBJECT_DIR}/${orgId}/...`
  and an ACL policy with the owning `organizationId` is checked on every read.
- See: [docs/architecture/tenant-isolation.md](../architecture/tenant-isolation.md).

## 4. Encryption

- **In transit**: TLS 1.2+ for all client/API and API/sub-processor traffic.
- **At rest**: AES-256 on Neon Postgres volumes and on Replit Object Storage / GCS.
- **Backups**: AES-256, retained 30 days, encrypted with the same key envelopes
  as primary storage.

## 5. Access control

- Server-side RBAC (`ADMIN`, `MANAGER`, `ESTIMATOR`, `WORKER`, `SUPER_ADMIN`,
  `HUSTLER`, plus per-feature permission keys).
- HUSTLER role uses `effectiveRole` from the `hustler_organizations` join so a
  single human identity can switch between orgs without privilege bleed.
- JWT cookies are HTTP-only, `SameSite=Lax`, `Secure` in production. Each user
  has a `tokenVersion`; `revokeUserTokens()` invalidates all sessions
  immediately.
- SAML SSO and passkeys are available on Enterprise tier (gated by the `SSO`
  feature flag).

## 6. Authentication & abuse prevention

- bcrypt(10) password hashing.
- Per-window Postgres-backed rate limiters: `auth` 15/15min, `sensitive` 100/15min,
  `api` 1000/15min, `export` 20/15min, `upload` 200/15min.
- All upload routes pass through `scanConfirmedUpload` for AV scanning before
  the ACL policy is written (Cloudmersive in production, EICAR head-check
  fallback). See `threat_model.md` § 5.4.

## 7. Audit log

- Append-only `audit_log` table; no DELETE / UPDATE routes exposed.
- Required `userId` is runtime-asserted to a non-empty string (lint guard at
  `scripts/audit-audit-logger-userid.mjs`).
- Coverage: pay runs, change orders, billing events, AIA pay applications,
  auth events, exports, organization lifecycle (import / export / deletion).

## 8. Data lifecycle

### 8.1 Import

Customers can bulk-load CSV data for vendors, subs, cost codes, employees,
equipment, projects, and historical bids via the `/data-management` page. Every
import runs through a server-side **dry-run** first that validates each row and
returns a per-row error report. Rows are committed only when zero errors remain.
Imports are recorded in `org_csv_imports` and audited.

### 8.2 Export

The "Export my org" workflow on `/data-management` enqueues a background job
that streams a ZIP archive to Object Storage:

- `manifest.json` with table → row count and `exportedAt` timestamp
- one CSV per major table (organizations, users, projects, bids,
  subcontractors, equipment, cost_codes, …)
- a `README.txt` with re-import instructions

A 24-hour signed download URL is emailed to the requesting administrator. Each
export is recorded in `org_exports` and audited.

### 8.3 Soft- & hard-delete

- A delete request requires an admin to confirm via an email link sent from
  `/data-management`.
- On confirmation: the org is **soft-deleted immediately** (`isActive=false`,
  recorded in `org_deletion_requests` with `hardDeleteScheduledAt = now + 30d`).
- Within the 30-day grace window the request can be cancelled by any admin,
  which reactivates the org.
- After the grace window, a scheduled job hard-deletes all org-scoped rows and
  Object Storage blobs.
- Both events write to `audit_log`.

### 8.4 Per-record retention

`DATA_RETENTION` feature flag enables policy-driven retention for time entries,
notes, and other long-tail data. See `server/retentionRoutes.ts` and
`docs/ops/runbook.md`.

## 9. Privacy / DSR

`/api/privacy/...` (in `server/privacyRoutes.ts`) implements:

- Data Processing Records inventory (Art. 30)
- Data Subject Requests (access, correction, deletion, portability) with
  state machine and SLA tracking
- Consent receipts and audit trail

End users may exercise rights by emailing `privacy@smartmanage.ai`.

## 10. AI / sub-processor handling

- AI features are opt-in at the org level; per-feature `AI_*` flags gate
  enablement.
- Untrusted document text is wrapped in a `<UNTRUSTED_DOCUMENT>` quarantine
  envelope before reaching any LLM (`server/ai/promptInjectionGuard.ts`).
- All LLM JSON outputs pass a Zod schema check before any DB write.
- Customer Data is never used to train sub-processor models.
- The full sub-processor list (Neon, GCS, OpenAI, Anthropic, SendGrid /
  Resend, Stripe, Cloudmersive) lives at [/sub-processors](/sub-processors).
  We notify Customer admins of additions with at least 30 days' notice.

## 11. Incident response

- 24/7 alerting via Sentry / Statuspage probes; status posted at
  [/trust](/trust) and the public summary at `GET /api/public/status/summary`.
- Customer admins are notified within 72 hours of confirmed personal-data
  incidents (the GDPR notification window).
- Root-cause writeups attach to the relevant incident on the status page.

## 12. Sub-processor change log

Tracked at [/sub-processors](/sub-processors). Material changes generate a
notification to Customer admins.

## 13. Contact

- General security: `security@smartmanage.ai`
- Privacy / DSR:    `privacy@smartmanage.ai`
- Legal / DPA:      `legal@smartmanage.ai`
