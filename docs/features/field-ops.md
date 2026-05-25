# field-ops — Daily Reports, Time Clock, Time Entry, Dispatch Board, Field Productivity, Issue Captures

## Overview

The field-ops module covers all on-site operational tracking: foremen submit daily reports (weather, crew, progress, equipment, issues); workers clock in/out via mobile or web with optional geofence verification; time entries are approved by supervisors and fed into payroll; the dispatch board manages crew assignments across projects; and field productivity metrics track production rates against SOW budgets.

## Data Models

**Key tables (`shared/schema/operations.ts`, `shared/schema/core.ts`)**

| Table | Description |
|---|---|
| `daily_reports` | `projectId`, `reportDate`, `weatherCondition`, `temperature`, `crewCount`, `notes`, `workPerformed`, `status` (DRAFT/SUBMITTED/APPROVED/LOCKED), `submittedById` |
| `daily_scope_progress` | Progress entries within a daily report; `scopeItemId`, `quantityCompleted`, `unitOfMeasure` |
| `tm_tickets` | T&M authorizations: `projectId`, `description`, `laborHours`, `materialCost`, `status`, `approvedById` |
| `time_entries` | Approved time records: `userId`, `projectId`, `date`, `regularHours`, `overtimeHours`, `costCode`, `status` |
| `time_clock_shifts` | Raw clock-in/out events: `userId`, `projectId`, `clockInAt`, `clockOutAt`, `geofenceVerified`, `deviceId` |
| `overtime_rules` | Per-org or per-project OT thresholds: `dailyThreshold`, `weeklyThreshold`, `doubleTimeThreshold`, `otMultiplier` |
| `field_productivity_entries` | Production quantities vs. budget: `projectId`, `sowItemId`, `quantity`, `unit`, `laborHours`, `date` |
| `project_inspections` | Scheduled inspections: `type`, `scheduledAt`, `inspector`, `result`, `notes` |
| `project_issues` | Captured field issues (photos, description, priority, status) |
| `worker_logs` | Per-worker activity log for daily report sign-offs |
| `tm_daily_sheets` | T&M daily cost sheets per project |
| `dispatch_assignments` | Crew-to-project date assignments for dispatch board |

## Backend Routes

**File: `server/timeClockRoutes.ts`**
| Method | Path | Description | Auth |
|---|---|---|---|
| POST | `/api/time-clock/clock-in` | Records clock-in with optional geofence check | `requireAuth` + `canAccessTimeClock` |
| POST | `/api/time-clock/clock-out` | Records clock-out | `requireAuth` + `canAccessTimeClock` |
| GET | `/api/time-clock/current` | Returns active shift for current user | `requireAuth` |
| GET | `/api/time-clock/shifts` | Lists shifts for org (manager view) | `requireAuth` + `canManageTimeClock` |
| PATCH | `/api/time-clock/shifts/:id` | Admin correction of shift times | `requireRole('ADMIN','MANAGER','SUPERINTENDENT')` |

**File: `server/timeEntryRoutes.ts`**
| Method | Path | Description | Auth |
|---|---|---|---|
| GET | `/api/time-entries` | Lists time entries (filter by project, user, date) | `requireAuth` |
| POST | `/api/time-entries` | Creates time entry | `requireAuth` |
| PATCH | `/api/time-entries/:id` | Updates entry | `requireAuth` |
| POST | `/api/time-entries/:id/approve` | Approves entry | `requireRole('ADMIN','MANAGER','SUPERINTENDENT')` + `canApproveTime` |
| POST | `/api/time-entries/bulk-approve` | Bulk approves for a period | `requireRole('ADMIN','MANAGER','SUPERINTENDENT')` |

**File: `server/fieldProductivityRoutes.ts`**
| Method | Path | Description |
|---|---|---|
| GET | `/api/field-productivity/summary` | Production rate summary vs. budget |
| POST | `/api/field-productivity/entries` | Records a daily production entry |
| GET | `/api/field-productivity/projects/:id/trend` | Production trend over time |

**File: `server/reportRoutes.ts`** — daily reports:
| Method | Path | Description |
|---|---|---|
| GET | `/api/projects/:id/daily-reports` | Lists daily reports for project |
| POST | `/api/projects/:id/daily-reports` | Creates report (DRAFT) |
| PATCH | `/api/projects/:id/daily-reports/:reportId` | Updates report |
| POST | `/api/projects/:id/daily-reports/:reportId/submit` | Submits for approval |
| POST | `/api/projects/:id/daily-reports/:reportId/approve` | Approves/locks report |

**File: `server/dispatchBoardRoutes.ts`** (or via `server/crewRoutes2.ts`):
| Method | Path | Description |
|---|---|---|
| GET | `/api/dispatch-board` | Returns crew assignments for date range |
| POST | `/api/dispatch-board/assign` | Assigns crew to project/date |
| DELETE | `/api/dispatch-board/assignments/:id` | Removes assignment |

**File: `server/overtimeRoutes.ts`** — OT rule management and approvals

## Frontend Pages & Components

| Route | Page File | Description |
|---|---|---|
| `/daily-reports` | `client/src/pages/daily-reports.tsx` | Daily report list and submission |
| `/time-clock` | `client/src/pages/time-clock.tsx` | Clock in/out with geofence map |
| `/time-entry` | `client/src/pages/time-entry.tsx` | Manual time entry grid |
| `/dispatch-board` | `client/src/pages/dispatch-board.tsx` | Visual crew scheduling board |
| `/my-day` | `client/src/pages/my-day.tsx` | Personal today view: assigned tasks, time, weather |
| `/my-work` | `client/src/pages/my-work.tsx` | Worker's personal work queue |

## Roles & Permissions

| Action | Gate |
|---|---|
| Clock in/out | `canAccessTimeClock` — all roles except VENDOR |
| Manage time clock (corrections) | `canManageTimeClock` — ADMIN, MANAGER, SUPERINTENDENT |
| Approve time | `canApproveTime` — ADMIN, MANAGER, SUPERINTENDENT |
| Access T&M billing | `canAccessTMBilling` |
| Lock daily reports | `canLockDailyReports` — ADMIN, MANAGER, SUPERINTENDENT |
| Field productivity | `canAccessProductionRates` |

## Integration Points

- **Geofencing** — `time_clock_shifts.geofenceVerified` uses project's `geofenceRadius` and `project_geofence_zones`; mobile GPS coordinates compared server-side
- **Payroll integration** — approved `time_entries` are pulled by `buildRateMap()` in `payrollRoutes.ts` to compute pay run line items
- **Overtime engine** — `resolveWorkerOtConfig()` in `payrollRoutes.ts` applies per-project or org OT rules when computing shift totals
- **Event bus** — `report.submitted`, `report.approved` events trigger manager notifications
- **Mobile sync** — `mobileSyncRoutes.ts` provides offline-capable batch sync for field workers; entries created on device are reconciled server-side
- **AI notes** — `aiNotesService.ts` + `aiNotesScheduler.ts` generate daily AI summaries of field notes and productivity
