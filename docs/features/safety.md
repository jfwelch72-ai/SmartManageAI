# safety — Safety Incidents, OSHA Tracking, Quality Issues, Safety Training, Toolbox Talks, Checklist Instances, PPE

## Overview

The safety module provides construction site safety management: incident reporting (with OSHA recordable/reportable classification), quality issue tracking, safety training assignment and completion tracking, toolbox talk content library and sign-off records, customizable checklist templates for inspections and job hazard analyses (JHAs), and PPE requirement tracking per project role.

## Data Models

**Key tables (`shared/schema/features/safety.ts`, `shared/schema/operations.ts`)**

| Table | Description |
|---|---|
| `safety_incidents` | `projectId`, `incidentDate`, `type` (NEAR_MISS/FIRST_AID/RECORDABLE/REPORTABLE/FATALITY), `description`, `injuredPersonId`, `bodyPart`, `treatmentType`, `lostWorkDays`, `restrictedDutyDays`, `status`, `oshaRecordable`, `oshaReportable`, `rootCause` |
| `osha_incidents` | Detailed OSHA 300 log entries linked to `safety_incidents` |
| `quality_issues` | `projectId`, `type` (DEFICIENCY/NCR/REWORK), `description`, `location`, `severity` (LOW/MEDIUM/HIGH/CRITICAL), `status` (OPEN/IN_PROGRESS/CLOSED), `assignedToId`, `dueDate`, `resolutionNotes`, `costImpact` |
| `quality_issue_photos` | Photos attached to quality issues |
| `safety_trainings` | Training catalog: `name`, `category`, `durationMinutes`, `expiresAfterDays`, `contentUrl`, `isRequired` |
| `user_training_completions` | Worker training completions: `userId`, `trainingId`, `completedAt`, `expiresAt`, `score`, `certificationNumber` |
| `training_assignments` | Required training assignments: `userId` or `projectId`, `trainingId`, `dueDate` |
| `toolbox_talks` | Talk templates: `title`, `topic`, `content`, `attachmentUrl`, `organizationId` |
| `toolbox_talk_sessions` | Delivered sessions: `talkId`, `projectId`, `conductedById`, `sessionDate`, `attendeeCount` |
| `toolbox_talk_sign_offs` | Per-worker sign-off: `sessionId`, `userId`, `signedAt`, `signatureData` |
| `safety_checklist_templates` | Inspection/JHA templates: `name`, `category`, `items` (JSON array), `frequency`, `organizationId` |
| `safety_checklist_instances` | Completed checklists: `templateId`, `projectId`, `completedById`, `completedAt`, `results` (JSON) |
| `ppe_requirements` | Required PPE per project/role: `projectId`, `role`, `ppeItems` (JSON array) |
| `project_safety_plans` | Safety plan documents per project |
| `behavior_based_safety_observations` | BBS observations: `projectId`, `observerId`, `category`, `behavior`, `isSafe`, `feedbackGiven` |

## Backend Routes

**File: `server/safetyIncidentRoutes.ts`**
| Method | Path | Description | Auth |
|---|---|---|---|
| GET | `/api/safety/incidents` | Lists incidents (filter: project, type, OSHA) | `canViewSafety` |
| POST | `/api/safety/incidents` | Reports incident | `canReportSafetyIncidents` |
| GET | `/api/safety/incidents/:id` | Incident detail | `canViewSafety` |
| PATCH | `/api/safety/incidents/:id` | Updates incident | `canManageSafety` |
| POST | `/api/safety/incidents/:id/close` | Closes with resolution | `canManageSafety` |
| GET | `/api/safety/osha-300-log` | OSHA 300 log for year | `canManageSafety` |
| GET | `/api/safety/osha-summary` | OSHA 300A annual summary | `canManageSafety` |

**File: `server/qualityIssueRoutes.ts`**
| Method | Path | Description |
|---|---|---|
| GET | `/api/quality-issues` | Lists quality issues |
| POST | `/api/quality-issues` | Creates quality issue |
| PATCH | `/api/quality-issues/:id` | Updates / resolves issue |

**File: `server/safetyTrainingRoutes.ts`**
| Method | Path | Description |
|---|---|---|
| GET | `/api/safety/trainings` | Lists training catalog |
| POST | `/api/safety/trainings` | Creates training |
| POST | `/api/safety/trainings/:id/assign` | Assigns to users/project |
| POST | `/api/safety/trainings/:id/complete` | Records completion |
| GET | `/api/safety/training-matrix` | Compliance matrix (users × required trainings) |

**File: `server/toolboxTalkRoutes.ts`**
| Method | Path | Description |
|---|---|---|
| GET | `/api/toolbox-talks` | Lists talks |
| POST | `/api/toolbox-talks` | Creates talk |
| POST | `/api/toolbox-talks/:id/sessions` | Records session delivery |
| POST | `/api/toolbox-talks/:id/sessions/:sessionId/sign-off` | Worker sign-off |

**File: `server/safetyChecklistRoutes.ts`**
| Method | Path | Description |
|---|---|---|
| GET | `/api/safety/checklist-templates` | Lists templates |
| POST | `/api/safety/checklist-templates` | Creates template |
| POST | `/api/safety/checklists` | Creates and completes a checklist instance |
| GET | `/api/safety/checklists` | Lists completed checklists |

**File: `server/safetyObservationRoutes.ts`** — BBS observations

## Frontend Pages & Components

| Route | Page File | Description |
|---|---|---|
| `/safety` | `client/src/pages/safety.tsx` | Safety management hub |
| `/compliance` | `client/src/pages/compliance.tsx` | Compliance overview across projects |

## Roles & Permissions

| Action | Gate |
|---|---|
| View safety data | `canViewSafety` — all roles |
| Report incidents | `canReportSafetyIncidents` — all authenticated roles |
| Manage safety | `canManageSafety` — ADMIN, MANAGER, SUPERINTENDENT |
| View OSHA logs | `canViewOshaLogs` — ADMIN, MANAGER |
| Manage training | `canManageSafetyTraining` — ADMIN, MANAGER |

## Integration Points

- **Incident OSHA classification** — `oshaClassificationService.ts` auto-classifies incidents based on `injuryType`, `lostWorkDays`, and treatment type
- **Safety widget on dashboard** — `GET /api/dashboard/safety-summary` computes TRIR (Total Recordable Incident Rate) and DART rates from `safety_incidents`
- **Notifications** — CRITICAL severity quality issues and REPORTABLE incidents send immediate push/email notifications to org ADMIN users
- **Training matrix** — `training_assignments` joined with `user_training_completions` drives the compliance matrix and expiry alerts
- **Mobile** — FIELD_WORKER mobile app includes incident reporting and toolbox talk sign-off; syncs via `mobileSyncRoutes.ts`
- **GCS photos** — quality issue and incident photos uploaded to GCS; signed URLs returned for display
