# Automations & Events

> **Last updated:** May 2026. Reflects pg-boss job queue (Task #2481), compliance-expiration job (Task #2674), RLS-scoped job context (Task #2673), and new event types added since January 2026.

## Overview

SmartManageAI has two classes of background processing:

1. **pg-boss Job Queue** (`server/jobQueue/`) — for heavyweight, long-running work that must run outside the HTTP request lifecycle with retries, dead-letter handling, and per-tenant fairness.
2. **In-Process Schedulers** (`server/jobs/jobRunner.ts` + individual scheduler files) — for lightweight recurring cron tasks. All use `withSchedulerLock` which automatically wraps ticks in `withSystemJobContext`.

All background jobs use RLS-scoped DB contexts (`withJobOrgContext` for per-tenant, `withSystemJobContext` for cross-tenant) — never raw DB access.

---

## pg-boss Job Queue

**Files:** `server/jobQueue/index.ts`, `server/worker.ts`, `server/jobQueue/handlers/`

### How it works

```
HTTP route → enqueueJob(name, payload, { idempotencyKey })
                 │
                 ▼
         pg-boss queue (Postgres)
                 │
                 ▼
       server/worker.ts (dedicated process)
                 │
                 ▼
       withOrgContext({ organizationId, source: "job:<name>" }) → handler(payload)
                 │
                 ├─ progress(%) → messagingBus → SSE clients
                 └─ result in pgboss.job
```

### Queue Configuration
- `retryLimit=5, retryBackoff=true, retryDelay=10s`
- `teamSize=8, teamConcurrency=8` per queue
- Per-tenant semaphore inside handler for fairness (one heavy tenant can't starve the queue)
- Failed jobs surfaced in Super Admin job queue UI (`/admin/job-queue`)
- Idempotency via `singletonKey` (same key = no-op while original is queued/running)

### Current Job Handlers
| Job Name | Handler | Trigger | Description |
|----------|---------|---------|-------------|
| `ai_takeoff_analyze` | `server/jobQueue/handlers/ai_takeoff_analyze.ts` | POST /api/ai/takeoff/analyze | AI plan analysis for auto-takeoff |
| `ai_document_analyze` | `server/jobQueue/handlers/ai_document_analyze.ts` | POST /api/ai/document-analyze | AI document analysis + AV scan |

### Worker Process
**File:** `server/worker.ts`

Boots only the pg-boss queue and handlers — no HTTP server. Runs as the `Job worker` workflow in development and as a separate Reserved-VM deployment in production.

---

## In-Process Schedulers (Cron)

All schedulers use `withSchedulerLock(name, fn)` which:
1. Acquires a distributed lock (prevents duplicate runs on multi-pod setups)
2. Wraps the tick body in `withSystemJobContext(name, fn)` for cross-tenant RLS elevation
3. Per-org loops inside the tick use `withJobOrgContext(jobName, orgId, fn)` for per-tenant RLS scoping

### AI Analysis Scheduler

**File:** `server/ai/scheduler.ts`

**Trigger:** Cron schedule (configurable; disabled in dev by default, active in production)

**Actions:**
1. Iterate through active organizations
2. Build data snapshot for each (wrapped in `withJobOrgContext`)
3. Run AI PM analysis via `routedGeneralChatCompletion`
4. Store results
5. Create notification if critical issues found

**Status:** ✅ Working (production only)

---

### AI Notes Analysis Scheduler

**File:** `server/aiNotesScheduler.ts`

**Trigger:** Every few hours via `withSchedulerLock`

**Actions:**
1. Fetch recent unanalyzed notes per org
2. Send to AI for classification
3. Create insights with severity
4. Link to source notes
5. Create tasks if critical

**Status:** ✅ Working

---

### Compliance Expiration Job (added Task #2674)

**File:** `server/jobs/jobRunner.ts` — `processComplianceExpirations`

**Trigger:** Nightly cron run (via `withSchedulerLock`)

**Scope:** Checks each organization's compliance documents for upcoming or past expirations:
- DBE certifications
- Surety bonds
- Insurance certificates
- Other org compliance documents (`organization_documents` table)

**Actions per org (wrapped in `withJobOrgContext("compliance.expirationCheck", org.organizationId, …)`):**
1. Query `organization_documents` for records expiring within the alert window
2. Create compliance expiration notifications
3. Deduplicate notifications (same doc/org) — only new alerts inserted per run

**Status:** ✅ Working

---

### Equipment PM Generation Job

**File:** `server/jobs/jobRunner.ts` — `processEquipmentPmGeneration`

**Trigger:** Nightly cron

**Actions per org (wrapped in `withJobOrgContext("equipment.pmGeneration", orgId, …)`):**
1. Check equipment with PM schedules due
2. Create work order records for due maintenance
3. Send MAINTENANCE_REQUEST notifications to Equipment/Maintenance Managers

**Status:** ✅ Working

---

### CRM Contact Birthday Digests

**File:** `server/jobs/jobRunner.ts` — `processCrmContactBirthdayDailyDigest` / `processCrmContactBirthdayWeeklyDigest`

**Trigger:** Daily / Weekly cron

**Actions per org (wrapped in `withJobOrgContext`):**
1. Find contacts with upcoming birthdays
2. Send digest notification to relationship owners

**Status:** ✅ Working

---

### Certified Payroll Weekly Digest

**File:** `server/jobs/jobRunner.ts` — `processCertifiedPayrollWeeklyDigest`

**Trigger:** Weekly cron (day after payroll week end)

**Actions per org (wrapped in `withJobOrgContext("payroll.certifiedPayrollDigest", org.id, …)`):**
1. Aggregate certified payroll data for the closed week
2. Send digest to Office Manager / Admin

**Status:** ✅ Working

---

### Other Scheduled Tasks
| Scheduler | File | Trigger | Purpose |
|-----------|------|---------|---------|
| CRM Task Reminders | `server/crmTaskReminderScheduler.ts` | Daily | Send reminders for overdue CRM tasks |
| CRM Alert Digest Backfill | `server/crmBackfillAlertDigestScheduler.ts` | Hourly | Process pending alert digests |
| Status Probe | `server/statusProbeScheduler.ts` | Every 5 min | Ping external integrations for health |
| Support Weekly Report | `server/supportWeeklyReport.ts` | Weekly | Generate platform support summary |

---

## Event-Driven Automations

### Time Clock Events

**Trigger:** Clock in/out actions
**File:** `server/timeClockRoutes.ts`

| Event | Actions |
|-------|---------|
| CLOCK_IN | Create shift record (status: PENDING), log GPS, start timer |
| CLOCK_OUT | Close shift, calculate hours, check overtime |
| AUTO_CLOCK_OUT | System closes abandoned shifts at midnight |

---

### Shift Approval Events

**Trigger:** Superintendent/Manager approves shift

**Actions:**
1. Update shift status to APPROVED
2. Update labor hours on project
3. Check week completion → trigger payroll report if all shifts approved
4. Log approval in audit trail
5. Audit log entry: `APPROVE` action on `timeClockShifts`

---

### Bid Status Changes

**File:** `server/bidRoutes2.ts`

| Status Change | Actions |
|---------------|---------|
| DRAFT → SUBMITTED | Log submission time (`submittedAt`), notify estimators, emit `bid.submitted` + `bid.status_changed` domain events |
| → AWARDED (conversion) | Create project, carry over estimates/quotes/docs, seed SOV, create draft contract, notify team, emit `bid.converted_to_project` |
| SUBMITTED → LOST | Archive bid, update analytics |
| SUBMITTED → CANCELLED | Archive, log |

---

### Project Status Changes

| Status Change | Trigger | Side Effects |
|---------------|---------|-------------|
| BID → PLANNING | Manual | Initialize project setup tasks |
| PLANNING → ACTIVE | Manual | Notify superintendent, enable time tracking |
| ACTIVE → COMPLETE | Manual | Trigger closeout checklist |
| COMPLETE → CLOSED | Manual | Archive, generate final reports |

All transitions emit `project.status_changed` domain events and write audit log entries.

---

### Change Order Events

**File:** `server/changeOrderRoutes.ts`, `server/changeOrderHelpers.ts`

| Status Change | Actions |
|---------------|---------|
| → SUBMITTED | Auto-bootstrap approval chain, notify approvers, start workflow engine if active for `CHANGE_ORDER` |
| → APPROVED | Update budget line items, update SOV, notify requester + office managers, audit log |
| → REJECTED | Notify submitter, revert to PCO or DRAFT |
| → VOIDED | Reverse budget impact, audit log |

---

### Pay Run Events

**File:** `server/payrollRoutes.ts`

| Transition | Side Effect |
|------------|-------------|
| → APPROVED | `approvedById/At` set; cost ledger postings created in DB transaction; `payroll.run.completed` emitted |
| → PAID | `paidAt` set; cost ledger postings created; payroll notifications to employees |
| Any | Audit log entry (old/new status) |

---

### AIA Pay Application Events

**File:** `server/sovRoutes.ts`

| Action | Side Effect |
|--------|-------------|
| Create | Audit log `CREATE` on `payApplications` |
| Status change | Audit log `APPROVE`/`REJECT` |
| Record payment | Audit log payment event |

---

### Delay Events

**File:** `server/delayRoutes.ts`

| Event | Actions |
|-------|---------|
| Delay Created | Log delay record (status: DRAFT) |
| Delay Submitted | Generate notification email to GC/Owner; 48-hour reminder queued |
| Delay Acknowledged | Update status, log response |
| Delay Unresponded (48hrs) | Send reminder notification |

---

### Upload & AV Scan Events

**File:** `server/auditBillingStorageRoutes.ts`

Every confirmed upload (`POST /api/objects/confirm` and multipart complete) triggers:
1. AV scan via `scanConfirmedUpload(...)` (EICAR head-check → Cloudmersive if key set → custom scanner)
2. Audit log entry (`entityType: "upload_av_scan"`, `action: APPROVE` for clean/skipped, `REJECT` for blocked)
3. Blocked uploads: object deleted from GCS before 422 response (quarantine)

---

## Notification System

### Notification Types

| Type | Trigger | Recipients |
|------|---------|------------|
| BILLING_READY | SoV line item ready to bill | Office Manager |
| CHANGE_ORDER_PENDING | CO awaiting approval | Approvers |
| CHANGE_ORDER_APPROVED | CO approved | Requester, Office Manager |
| TIME_OFF_REQUEST | PTO submitted | Manager |
| GENERAL | Various system events | Relevant users |
| MATERIAL_OVERAGE | Budget threshold (90%) exceeded | PM, Superintendent |
| PROJECT_ASSIGNMENT | User assigned to project | Assigned user |
| MAINTENANCE_REQUEST | Equipment maintenance due | Maintenance/Equipment Manager |
| REPAIR_REQUEST | Equipment repair needed | Maintenance Manager |
| DELAY_SUBMITTED | Delay logged | PM, Superintendent |
| DELAY_ACKNOWLEDGED | GC responded to delay | PM |
| DELAY_CHANGE_ORDER_NEEDED | Delay requires CO | Estimator, PM |
| TM_TICKET_SUBMITTED | T&M ticket submitted | Project Manager |
| TM_TICKET_APPROVED | T&M ticket approved | Submitter |
| TM_INVOICE_AUTO_CREATED | Invoice generated from T&M | Office Manager |
| COMPLIANCE_EXPIRING | Doc expiring within alert window | Admin, Office Manager |
| PROCUREMENT_PR_SUBMITTED | Purchase request submitted | Approvers |
| PROCUREMENT_PO_APPROVED | PO approved | Requester |

### Delivery Channels
1. **In-App** — Notification bell in header
2. **Email** — Critical notifications (configurable; sent via SendGrid)

---

## Bid Network Automations

### Bid Request Matching

**Trigger:** New bid request published
**File:** `server/bidNetworkNotifications.ts`

**Actions:**
1. Identify matching subcontractors by trade type
2. Generate invitation list
3. Send notifications to matches
4. Track view counts

---

## Material Budget Alerts

**Trigger:** Material usage updated
**Condition:** Usage ≥ configured threshold (default 90%)

**Actions:**
1. Set `alertTriggered` flag on `projectMaterialBudgets`
2. Create `MATERIAL_OVERAGE` notification for PM

---

## Audit Trail Events

All significant actions are logged to the append-only `audit_log` table. See `server/auditLogger.ts` for the typed helpers: `logCreate`, `logUpdate`, `logDelete`, `logAuthEvent`, `logRoleChange`.

| Action | Logged Data |
|--------|-------------|
| CREATE | Entity type, ID, creator, org, full data |
| UPDATE | Entity type, ID, updater, before/after |
| DELETE | Entity type, ID, deleter, deleted data |
| APPROVE | Entity type, ID, approver |
| REJECT | Entity type, ID, rejecter, reason |
| CLOCK_IN | User, project, time, GPS |
| CLOCK_OUT | User, project, time, GPS, duration |
| LOGIN / LOGIN_FAILED / LOGOUT | User, IP, timestamp |
| PASSWORD_CHANGE / PASSWORD_RESET | User, timestamp |
| MFA_ENABLED / MFA_DISABLED | User, timestamp |
| ROLE_CHANGED / ROLE_GRANTED / ROLE_REVOKED | Actor, target user, old/new role |

---

## Failure Handling

### Retry Logic (pg-boss Jobs)
- `retryLimit=5`, `retryBackoff=true`, `retryDelay=10s`
- Jobs exhausting retries land in pg-boss `failed` archive
- Super Admin can retry or archive failed jobs via `/admin/job-queue`

### Retry Logic (In-Process Schedulers)
- External API calls (AI, email): max 3 retries, exponential backoff
- Log failures with correlation ID + Sentry

### Fallback Behavior
When automation fails:
1. Log error with `x-request-id` correlation
2. Continue with remaining items (per-org loops use `continue` or `return`)
3. Alert admin if critical
4. Provide manual fallback where available

---

## Configuration

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `NODE_ENV` | Enable/disable schedulers (production only for some) |
| `STRICT_TENANT_RLS` | Must be `true` in production; schedulers require correct context wrappers |
| `AI_SCAN_CRON` | AI analysis schedule override |
| `NOTIFICATION_EMAIL_ENABLED` | Email notifications toggle |
| `UPLOAD_AV_SCAN_MODE` | `enforce` (default prod), `permissive` (dev), `disabled` |
| `CLOUDMERSIVE_AV_API_KEY` | Enable Cloudmersive AV scanning for uploads |

### Feature Flags

Automations can be enabled/disabled via:
- Subscription tier
- Add-on status (`ai_pm`, `ai_cfo`, etc.)
- Organization-level feature flags (Super Admin UI)
- Per-org AI provider flags (`AI_PROVIDER_TAKEOFF`, `AI_PROVIDER_GENERAL`)
