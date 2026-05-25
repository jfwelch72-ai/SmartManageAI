# projects — Project CRUD, Detail Tabs, Tasks, Schedule (Gantt/CPM), Project Templates, Project Health Snapshots

## Overview

Projects are the central entity for active construction work. Each project has a unique `code`, links to an organization (tenant), and aggregates all field operations, financials, documents, and workforce data. The project detail page uses tab-based navigation for Overview, Schedule, Financials, Documents, Workforce, and more. The schedule module implements a CPM critical-path engine with baseline comparison, resource loading, and PDF export. Project templates allow cloning standard configurations.

## Data Models

**Key tables (`shared/schema/core.ts`, `shared/schema/features/schedule.ts`, `shared/schema/features/reports.ts`)**

| Table | Description |
|---|---|
| `projects` | `id`, `code`, `name`, `gcOrganizationId`, `status` (enum), `startDate`, `endDate`, `address`, `geofenceRadius`, `clientName`, `clientContactEmail`, `estimatorId`, `superintendentId`, `projectManagerId`, `contractValue`, `budgetAmount`, `lat`, `lng` |
| `project_geofence_zones` | Polygon geofences for field check-in verification |
| `project_notes` | Rich-text notes linked to a project |
| `project_note_pages` | Notion-style note pages with block editor |
| `project_plans` | Uploaded plan documents; links sheets to plan revisions |
| `project_delays` | Delay events with cause code, duration, and financial impact |
| `calendar_events` | Project and org calendar events |
| `tasks` | General task management with assignees, due dates, priority |
| `project_schedules` | CPM schedule container; `projectId`, `baselineSnapshot`, `forecastedEndDate` |
| `schedule_activities` | Activity rows: `wbsCode`, `name`, `startDate`, `endDate`, `duration`, `float`, `predecessors`, `resourceAssignments` |
| `project_health_snapshots` | Nightly snapshots: budget %, schedule variance, safety recordable rate |
| `project_templates` | Cloneable project templates with default SOV, schedule, crews |
| `mobilization_checklist_items` | Checklist items for project kick-off |
| `risks` | Risk register: `probability`, `impact`, `category`, `mitigationPlan` |
| `scope_items` | Detailed scope-of-work line items for project |

## Backend Routes

**File: `server/projectCrudRoutes.ts`** — project CRUD:
| Method | Path | Description | Auth |
|---|---|---|---|
| GET | `/api/projects` | Lists projects for org (filters: status, manager, date range) | `requireAuth` + `canAccessProjects` |
| GET | `/api/projects/:code` | Project detail | `requireAuth` |
| POST | `/api/projects` | Creates project | `requireRole('ADMIN','MANAGER','ESTIMATOR')` + `canCreateProjects` |
| PATCH | `/api/projects/:code` | Updates project | `requireRole('ADMIN','MANAGER','SUPERINTENDENT')` + `canEditProjects` |
| DELETE | `/api/projects/:code` | Archives project | `requireRole('ADMIN','MANAGER')` |

**File: `server/projectContentRoutes.ts`** — notes, tasks, documents:
| Method | Path | Description |
|---|---|---|
| GET/POST/PATCH | `/api/projects/:id/notes` | Project notes CRUD |
| GET/POST/PATCH | `/api/projects/:id/note-pages` | Notion-style note pages |
| GET/POST | `/api/projects/:id/tasks` | Task management |
| GET/POST | `/api/projects/:id/delays` | Delay tracking |
| GET | `/api/projects/:id/calendar` | Project calendar events |

**File: `server/projectOpsRoutes.ts`** — operational data:
| Method | Path | Description |
|---|---|---|
| GET | `/api/projects/:id/health` | Health snapshot (budget, schedule, safety) |
| GET | `/api/projects/:id/scope` | Scope item list |
| POST | `/api/projects/:id/scope` | Add scope item |

**File: `server/scheduleRoutes.ts`** — CPM schedule engine:
| Method | Path | Description |
|---|---|---|
| GET | `/api/projects/:id/schedule` | Full schedule with CPM analysis |
| POST | `/api/projects/:id/schedule/activities` | Creates activity |
| PATCH | `/api/projects/:id/schedule/activities/:actId` | Updates activity |
| POST | `/api/projects/:id/schedule/baseline` | Locks baseline snapshot |
| GET | `/api/projects/:id/schedule/forecast` | Forecasted end date from CPM |
| POST | `/api/projects/:id/schedule/pdf` | Generates Gantt PDF |

**File: `server/projectTemplateRoutes.ts`**
| Method | Path | Description |
|---|---|---|
| GET | `/api/project-templates` | Lists org project templates |
| POST | `/api/project-templates` | Creates template |
| POST | `/api/project-templates/:id/apply` | Creates project from template |

**File: `server/projectFinancialRoutes.ts`** — project-level financial roll-ups

**File: `server/riskRoutes.ts`** — risk register

## Frontend Pages & Components

| Route | Page File | Description |
|---|---|---|
| `/projects` | `client/src/pages/projects.tsx` | Project list with map toggle |
| `/projects/:code` | `client/src/pages/project-detail.tsx` | Tabbed project detail |
| `/templates/projects` | `client/src/pages/project-templates.tsx` | Template library |

Project detail tabs: Overview, Schedule (Gantt), Financials, SOV/Billing, Documents/RFI/Submittals, Workforce/Time, Safety, Change Orders, Daily Reports.

## Roles & Permissions

| Action | Gate |
|---|---|
| View projects | `canAccessProjects`; FIELD_WORKER limited to `projectScope: ACTIVE_ONLY` |
| Create projects | `canCreateProjects` — ADMIN, MANAGER, ESTIMATOR |
| Edit projects | `canEditProjects` — ADMIN, MANAGER, SUPERINTENDENT |
| View budget | `canViewProjectBudget` |
| View estimates | `canViewProjectEstimates` |
| View time entries | `canViewProjectTimeEntries` |
| Manage scheduling | `canManageScheduling` |
| Lock daily reports | `canLockDailyReports` |
| Manage templates | `canManageProjectTemplates` — ADMIN, MANAGER |

## Integration Points

- **Geofencing** — `project_geofence_zones` + `organizations.geofenceRadius`; used by time-clock check-in to verify location
- **Event bus** — `project.created`, `project.status_changed` events emitted for notification service
- **Schedule engine** — CPM critical-path calculation runs in-process in `server/services/scheduleEngine.ts`
- **Health snapshots** — nightly job in `server/aiNotesScheduler.ts` computes budget %, schedule variance, safety score and inserts `project_health_snapshots`
- **Drawing sets** — `drawingSetRoutes.ts` + `planPinsRoutes.ts` handle plan document uploads and markup pins
- **Addenda** — `addendaRoutes.ts` tracks design changes and links to affected scope items
- **Portfolio** — `portfolioRoutes.ts` aggregates across all projects for ADMIN / MANAGER landing page
