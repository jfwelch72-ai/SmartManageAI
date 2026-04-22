# Logging & Monitoring Policy

| Owner | CTO |
| ----- | --- |
| Approver | CEO |
| Review cadence | Annual |

## 1. What we log

### Application audit log (`auditLog` table, `server/auditLogger.ts`)
Every mutation that affects customer data or security state writes a row:
- Authentication events (login, logout, MFA enrollment, password change,
  token revocation)
- Authorization changes (role assignment, permission grant/revoke)
- SSO configuration changes (`server/ssoRoutes.ts`)
- Admin/SUPER_ADMIN actions on customer data
- CRUD on financially-material entities (bids, contracts, change orders,
  payroll, payments)

Each row records: actor `userId`, `entityType`, `entityId`, `action`,
`oldValue`, `newValue`, `ipAddress`, `userAgent`, `createdAt`.

### Application access log
- Every HTTP request: timestamp, method, path, status, duration,
  user/org id (when authenticated), correlation id.
- Sensitive request bodies (auth, payment) have their payload redacted at
  the logger.

### Infrastructure log
- Cloud provider audit log (console + API) — exported to the central log
  store.
- Database audit log — exported to the central log store.

## 2. Where we log it

- **In-database** for the application audit log (queryable, exportable
  via `server/auditExportRoutes.ts`).
- **Centralized log store** (cloud-provider managed) for application and
  infrastructure logs.
- **Tamper-evident retention**: the central log store has its bucket
  configured with object-lock for the retention period.

## 3. Retention

| Source | Retention | Rationale |
| ------ | --------- | --------- |
| Application audit log (`auditLog`) | 1 year minimum, tamper-evident | SOC 2 + customer commitments |
| Application HTTP / system logs | 90 days | Operational |
| Infrastructure audit logs | 1 year | Forensics + compliance |
| Backup access logs | 30 days | Operational |

Audit log rows are not editable through any application endpoint; the
only mutations on the table are `INSERT` from `auditLogger.ts`.

## 4. Monitoring & alerting

| Signal | Alert |
| ------ | ----- |
| Auth failures > N for one user / IP | Page security on-call |
| 5xx error rate above baseline | Page on-call |
| p95 latency above baseline for 10 min | Page on-call |
| Backup job failure | Page on-call |
| TLS certificate expiring < 30 days | Email security |
| Vanta control failure (Critical/High) | Page security |
| New SUPER_ADMIN session | Security channel |

## 5. Log review

- The security on-call reviews alerts daily (or as they fire).
- Audit log spot-check: monthly, security samples 50 admin actions and
  confirms the justification matches an open ticket.
- Customer admins can run their own audit-log searches via the
  `/api/audit/search` endpoint (see `server/auditExportRoutes.ts`).

## 6. PII in logs

We do not log:
- Passwords, tokens, session cookies, API keys
- Full request bodies for `/api/auth/*` or payment endpoints
- Customer file contents

Where needed for debugging, identifiers (user id, org id, project id)
are logged; the corresponding human-readable data is fetched on demand.

## 7. Vulnerability triage SLAs

Same as policy #09 §3.
