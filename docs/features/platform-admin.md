# platform-admin — Super Admin Dashboard, Org Management, Impersonation, Feature Flags, Billing, Audit Logs, Support Tickets, Job Queue, One-Shot Jobs, Analytics Monitoring

## Overview

The platform-admin module provides SUPER_ADMIN–only tools for operating the SmartManageAI platform. It covers: a multi-tenant org management dashboard (create, suspend, delete orgs); user impersonation (audited, time-limited); global and per-org feature flag management; billing subscription management; the append-only audit log viewer; support ticket inbox; the asynchronous job queue dashboard; one-shot maintenance jobs; and production monitoring (error rates, AI usage, API latency).

## Data Models

**Key tables (`shared/schema/core.ts`, `shared/schema/features/compliance.ts`, `shared/schema/features/flags.ts`)**

| Table | Description |
|---|---|
| `organizations` | Tenant master record; `isActive`, `subscriptionStatus`, `subscriptionTier`, `trialEndsAt`, `maxUsers`, `billingEmail` |
| `users` | Platform user records; `role = 'SUPER_ADMIN'` grants platform-wide access |
| `audit_log` | Append-only audit trail: `userId`, `action`, `entityType`, `entityId`, `oldValue` (JSON), `newValue` (JSON), `ipAddress`, `correlationId`, `createdAt` |
| `error_logs` | Server error records: `message`, `stack`, `route`, `method`, `statusCode`, `correlationId`, `organizationId`, `userId`, `createdAt` |
| `feature_flags` | Platform-level feature flags: `key` (FEATURE_FLAG_KEYS enum), `isEnabled`, `rolloutPercent`, `enabledOrgIds` (JSON array) |
| `org_feature_flags` | Per-org feature flag overrides |
| `feature_flag_presets` | Named preset bundles of flags |
| `feature_flag_manual_changes` | Audit trail for flag changes |
| `support_tickets` | `subject`, `description`, `status` (OPEN/IN_PROGRESS/RESOLVED/CLOSED), `priority`, `organizationId`, `reportedById`, `assignedToId` |
| `support_ticket_messages` | Threaded messages within a ticket |
| `support_ratings` | End-of-ticket satisfaction ratings |
| `job_queue_items` | Async job records: `jobType`, `payload` (JSON), `status` (QUEUED/RUNNING/COMPLETED/FAILED/RETRYING), `priority`, `attempts`, `maxAttempts`, `scheduledFor`, `startedAt`, `completedAt`, `errorMessage` |
| `impersonation_sessions` | Audited impersonation records: `adminUserId`, `targetUserId`, `targetOrgId`, `startedAt`, `endedAt`, `reason` |
| `billing_events` | Billing state change audit records |
| `org_csv_imports` | Bulk org data import sessions |
| `platform_announcements` | Platform-wide announcements shown in UI banner |

## Backend Routes

**File: `server/platformRoutes.ts`** — org and user management (≈ 1,800 lines):
| Method | Path | Description | Auth |
|---|---|---|---|
| GET | `/api/platform/organizations` | Lists all orgs with tier/status | `SUPER_ADMIN` |
| POST | `/api/platform/organizations` | Creates new org | `SUPER_ADMIN` |
| PATCH | `/api/platform/organizations/:id` | Updates org (tier, status, limits) | `SUPER_ADMIN` |
| DELETE | `/api/platform/organizations/:id` | Suspends / soft-deletes org | `SUPER_ADMIN` |
| POST | `/api/platform/organizations/:id/restore` | Restores suspended org | `SUPER_ADMIN` |
| GET | `/api/platform/users` | Lists all platform users | `SUPER_ADMIN` |
| PATCH | `/api/platform/users/:id/role` | Changes user role (logs `ROLE_CHANGED`) | `SUPER_ADMIN` |
| POST | `/api/platform/impersonate` | Creates impersonation session | `SUPER_ADMIN` |
| DELETE | `/api/platform/impersonate` | Ends impersonation | `SUPER_ADMIN` |
| GET | `/api/platform/audit-logs` | Paginated audit log | `SUPER_ADMIN` |
| GET | `/api/platform/error-logs` | Error log viewer | `SUPER_ADMIN` |
| GET | `/api/platform/analytics` | Platform-wide usage analytics | `SUPER_ADMIN` |
| GET | `/api/platform/ai-usage` | Org-by-org AI spend summary | `SUPER_ADMIN` |
| POST | `/api/platform/one-shot-jobs` | Triggers a maintenance job | `SUPER_ADMIN` |

**File: `server/featureFlagRoutes.ts`** — feature flag management:
| Method | Path | Description | Auth |
|---|---|---|---|
| GET | `/api/platform/feature-flags` | Lists all flags | `SUPER_ADMIN` |
| POST | `/api/platform/feature-flags/:key/enable` | Enables flag globally | `SUPER_ADMIN` |
| POST | `/api/platform/feature-flags/:key/disable` | Disables flag | `SUPER_ADMIN` |
| POST | `/api/platform/feature-flags/:key/org-override` | Sets per-org override | `SUPER_ADMIN` |
| GET | `/api/feature-flags` | Returns active flags for current org | `requireAuth` |
| GET | `/api/platform/feature-flag-presets` | Lists presets | `SUPER_ADMIN` |
| POST | `/api/platform/feature-flag-presets` | Creates preset | `SUPER_ADMIN` |
| POST | `/api/platform/feature-flag-presets/:id/apply` | Applies preset to org | `SUPER_ADMIN` |

**File: `server/supportRoutes.ts`** — support tickets:
| Method | Path | Description | Auth |
|---|---|---|---|
| GET | `/api/support/tickets` | Lists tickets (SUPER_ADMIN: all; others: own org) | `requireAuth` |
| POST | `/api/support/tickets` | Creates ticket | `requireAuth` |
| PATCH | `/api/support/tickets/:id/status` | Updates status | `SUPER_ADMIN` or ticket owner |
| POST | `/api/support/tickets/:id/messages` | Adds message | `requireAuth` |
| POST | `/api/support/rate/:token` | Records satisfaction rating | public (token-gated) |

**File: `server/jobQueueRoutes.ts`** — job queue dashboard:
| Method | Path | Description | Auth |
|---|---|---|---|
| GET | `/api/platform/job-queue` | Lists job queue items (filter: status, type) | `SUPER_ADMIN` |
| POST | `/api/platform/job-queue/:id/retry` | Retries a failed job | `SUPER_ADMIN` |
| DELETE | `/api/platform/job-queue/:id` | Cancels a queued job | `SUPER_ADMIN` |

**File: `server/auditLogRoutes.ts`** — audit log (also available to ADMIN):
| Method | Path | Description | Auth |
|---|---|---|---|
| GET | `/api/audit-logs` | Paginated audit log for current org | `requireRole('ADMIN','SUPER_ADMIN')` |

## Frontend Pages & Components

| Route | Page File | Description |
|---|---|---|
| `/admin` | `client/src/pages/admin.tsx` | Platform admin dashboard |
| `/admin/organizations` | `client/src/pages/admin-organizations.tsx` | Org list and management |
| `/admin/analytics` | `client/src/pages/admin-analytics.tsx` | Platform analytics |
| `/admin/job-queue` | `client/src/pages/admin-job-queue.tsx` | Job queue dashboard |
| `/admin/email-outbox` | `client/src/pages/admin-email-outbox.tsx` | SendGrid email outbox viewer |
| `/admin/status` | `client/src/pages/admin-status.tsx` | Server health and status |
| `/audit-logs` | `client/src/pages/audit-logs.tsx` | Audit log viewer (ADMIN+) |
| `/enterprise-settings` | `client/src/pages/enterprise-settings.tsx` | Enterprise feature configuration |

## Roles & Permissions

All platform-admin routes require `role = 'SUPER_ADMIN'`. The `RoutePermissions.PLATFORM_ADMIN` function enforces this on the frontend. No feature flags bypass SUPER_ADMIN role checks.

Audit log viewing (`/audit-logs`) is extended to `ADMIN` role for viewing their own org's logs only; SUPER_ADMIN can view across all orgs.

## Integration Points

- **Impersonation** — `POST /api/platform/impersonate` creates `impersonation_sessions` record; issues a new JWT with `impersonatedById` claim; all requests under impersonation tag `audit_log` entries with `impersonatedBy: adminUserId`
- **Feature flags** — `isFeatureEnabled(orgId, flagKey)` in `server/services/featureFlagService.ts` checks `feature_flags` + `org_feature_flags` with a 30-second in-process cache
- **Job queue worker** — `server/jobWorker.ts` polls `job_queue_items WHERE status = 'QUEUED' AND scheduled_for <= NOW()` every 5 seconds; runs jobs by `jobType` handler registry; writes back `status`, `completedAt`, `errorMessage`
- **Metrics** — `/metrics` endpoint exports Prometheus-format counters: `api_requests_total`, `api_latency_ms`, `ai_calls_total`, `ai_spend_usd_total`, `ai_prompt_injection_detections_total`
- **Audit log integrity** — `audit_log` table has no DELETE or UPDATE routes; append-only enforced at DB level by REVOKE; `userId` is runtime-asserted non-empty string via `scripts/audit-audit-logger-userid.mjs`
- **One-shot jobs** — maintenance jobs (e.g., `backfill-project-health-snapshots`, `re-score-ai-learned-rates`) are registered in `server/oneShotJobs.ts`; triggered by SUPER_ADMIN via the admin dashboard
- **STRICT_TENANT_RLS** — if `STRICT_TENANT_RLS=true`, the job worker also sets `app.current_org_id` before processing each job to enforce RLS even on background tasks
