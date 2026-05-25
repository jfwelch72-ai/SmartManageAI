# workforce — Crews, Skills, Certifications, Talent Pool, Hiring (ATS), Performance Reviews, Attendance, Leave Management

## Overview

The workforce module manages the human capital side of construction operations. It covers: **crews** (named groups of workers with supervisor and scheduling); **skills and certifications** per worker (OSHA 10/30, first aid, equipment licenses); a **talent pool** of pre-qualified workers; an integrated **ATS (Applicant Tracking System)** for hiring; **performance reviews** (360-degree with peer ratings and supervisor notes); **attendance** tracking with attendance records and streak metrics; and **leave management** (PTO, sick, FMLA, unpaid leave).

## Data Models

**Key tables (`shared/schema/features/crew.ts`, `shared/schema/features/hiring.ts`, `shared/schema/features/performance.ts`, `shared/schema/core.ts`)**

| Table | Description |
|---|---|
| `crews` | `name`, `type` (FOREMAN/GENERAL/SPECIALTY), `projectId`, `supervisorId`, `organizationId`, `defaultShiftStart`, `defaultShiftEnd` |
| `crew_members` | `crewId`, `userId`, `role` (LEAD/MEMBER), `startDate`, `endDate` |
| `crew_templates` | Reusable crew configurations with default members |
| `user_skills` | `userId`, `skill`, `proficiencyLevel` (BEGINNER/INTERMEDIATE/ADVANCED/EXPERT), `verifiedById` |
| `user_certifications` | `userId`, `certificationType`, `issuer`, `issuedAt`, `expiresAt`, `certificationNumber`, `documentUrl`, `isVerified` |
| `talent_profiles` | Pre-qualified workers (not yet users): `name`, `trade`, `skills`, `availability`, `rateExpectation`, `source` |
| `talent_profile_notes` | Notes on a talent profile |
| `hiring_jobs` | Job postings: `title`, `trade`, `location`, `status` (DRAFT/PUBLISHED/CLOSED), `description`, `requirements`, `salaryRange` |
| `hiring_candidates` | Candidates: `jobId`, `talentProfileId`, `name`, `email`, `status` (APPLIED/PHONE_SCREEN/INTERVIEW/OFFER/HIRED/REJECTED), `source` |
| `hiring_stages` | Configurable ATS pipeline stages |
| `hiring_interviews` | Scheduled interviews: `candidateId`, `interviewerId`, `scheduledAt`, `type` (VIDEO/PHONE/ONSITE), `outcome` |
| `performance_reviews` | Review cycles: `revieweeId`, `reviewerId`, `period`, `status`, `overallRating`, `comments` |
| `performance_categories` | Review category scores (quality, safety, communication, productivity) |
| `peer_ratings` | 360 peer ratings: `rateeId`, `raterId`, `rating`, `comment` |
| `supervisor_notes` | Supervisor notes per worker per date |
| `attendance_records` | Daily attendance: `userId`, `date`, `status` (PRESENT/ABSENT/LATE/HALF_DAY/REMOTE) |
| `leave_requests` | Leave requests: `userId`, `type` (PTO/SICK/FMLA/UNPAID), `startDate`, `endDate`, `status` (PENDING/APPROVED/REJECTED), `approvedById` |
| `leave_balances` | Available leave balances per user per type |
| `employee_classifications` | Classification assignments: `userId`, `jobClassificationId`, `effectiveDate` |

## Backend Routes

**File: `server/crewRoutes2.ts`** — crew management:
| Method | Path | Description | Auth |
|---|---|---|---|
| GET | `/api/crews` | Lists crews | `canViewCrews` |
| POST | `/api/crews` | Creates crew | `canManageScheduling` |
| PATCH | `/api/crews/:id` | Updates crew | `canManageScheduling` |
| POST | `/api/crews/:id/members` | Adds member | `canManageScheduling` |
| DELETE | `/api/crews/:id/members/:userId` | Removes member | `canManageScheduling` |

**File: `server/workforceRoutes.ts`** — users + skills:
| Method | Path | Description |
|---|---|---|
| GET | `/api/users` | Lists org users |
| POST | `/api/users` | Creates user (invitation) |
| PATCH | `/api/users/:id` | Updates user profile |
| PATCH | `/api/users/:id/role` | Changes user role (logs `ROLE_CHANGED`) |
| GET | `/api/users/:id/skills` | Lists user skills |
| POST | `/api/users/:id/skills` | Adds skill |
| GET | `/api/users/:id/certifications` | Lists certifications |
| POST | `/api/users/:id/certifications` | Adds certification |

**File: `server/hiringRoutes.ts`** — ATS:
| Method | Path | Description |
|---|---|---|
| GET | `/api/hiring/jobs` | Lists job postings |
| POST | `/api/hiring/jobs` | Creates posting |
| GET | `/api/hiring/candidates` | Lists candidates |
| PATCH | `/api/hiring/candidates/:id/stage` | Moves candidate in pipeline |
| POST | `/api/hiring/interviews` | Schedules interview |

**File: `server/performanceRoutes.ts`** — performance reviews

**File: `server/attendanceRoutes.ts`** — attendance records

**File: `server/leaveManagementRoutes.ts`** — leave requests + approvals:
| Method | Path | Description |
|---|---|---|
| GET | `/api/leave/requests` | Lists leave requests |
| POST | `/api/leave/requests` | Creates request |
| PATCH | `/api/leave/requests/:id/status` | Approve/reject |
| GET | `/api/leave/balances/:userId` | Returns leave balances |

**File: `server/talentRoutes.ts`** — talent pool management

**File: `server/manageWorkersRoutes.ts`** — manage workers page data (pay rates, classifications)

## Frontend Pages & Components

| Route | Page File | Description |
|---|---|---|
| `/crews` | `client/src/pages/crews.tsx` | Crew management |
| `/crew-templates` | `client/src/pages/crew-templates.tsx` | Template library |
| `/hiring` | `client/src/pages/hiring.tsx` | ATS kanban board |
| `/manage-workers` | `client/src/pages/manage-workers.tsx` | Worker profiles, rates, classifications |
| `/leave-management` | `client/src/pages/leave-management.tsx` | Leave calendar and approvals |
| `/dispatch-board` | `client/src/pages/dispatch-board.tsx` | Crew-to-project scheduling |

## Roles & Permissions

| Action | Gate |
|---|---|
| View user list | `canViewUsers` — ADMIN, MANAGER |
| Manage users | `canManageUsers` — ADMIN |
| Change roles | `requireRole('ADMIN','SUPER_ADMIN')` |
| Manage scheduling | `canManageScheduling` |
| Manage hiring | `canManageHiring` — ADMIN, MANAGER |
| Approve leave | `canApproveLeave` — ADMIN, MANAGER, SUPERINTENDENT |
| View performance reviews | `canViewPerformanceReviews` |
| Manage training | `canManageSafetyTraining` |

## Integration Points

- **Payroll** — `crew_members` and `employee_classifications` drive prevailing wage rate lookups in `buildRateMap()` and DOL Davis-Bacon integration
- **Scheduling** — crew assignments link to `dispatch_assignments` for the dispatch board view
- **Training matrix** — `user_certifications` with `expiresAt` feeds the safety training compliance matrix
- **ATS → org users** — `POST /api/hiring/candidates/:id/hire` creates a new org user from the candidate record
- **Audit log** — `ROLE_CHANGED`, `ROLE_GRANTED`, `ROLE_REVOKED` logged via `logRoleChange()` in `auditLogger.ts`
- **HUSTLER role** — HUSTLER users access multiple orgs' workforce data; `effectiveRole` from `hustler_organizations` governs per-org permissions
