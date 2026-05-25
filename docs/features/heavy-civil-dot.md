# heavy-civil-dot — DOT Library, Pay Items, Haul Tickets, Daily Inspector Reports, SWPPP Inspections, DBE Goals, Surety Bonds, Material Certifications

## Overview

The heavy-civil DOT module extends the platform for highway, bridge, and infrastructure projects governed by state/federal DOT requirements. It provides: a DOT pay item library (CSI/DOT codes) that links to estimate line items and SOV; haul ticket tracking for earthwork; daily inspector reports (IDR) with DOT-mandated fields; SWPPP inspection logs; DBE (Disadvantaged Business Enterprise) goal tracking with paid-to-date reporting; surety bond management; and material certifications for compliance.

## Data Models

**Key tables (`shared/schema/features/dot.ts`)**

| Table | Description |
|---|---|
| `dot_pay_items` | DOT pay item library: `itemCode`, `description`, `unit`, `unitPrice`, `category`, `stateCode`, `organizationId` |
| `haul_tickets` | `projectId`, `organizationId`, `ticketNumber`, `date`, `truckId`, `driverName`, `materialType`, `quantity`, `unit`, `sourceLocation`, `destinationLocation`, `status` (PENDING/APPROVED/REJECTED), `approvedById` |
| `haul_ticket_stations` | Station/chainage tags for source and destination (for mass-haul curve rendering) |
| `daily_inspector_reports` | DOT IDR: `projectId`, `reportDate`, `inspectorId`, `weatherCondition`, `temperature`, `contractorPresent`, `workItems` (JSON — pay items completed), `status`, `signedAt` |
| `daily_inspector_report_items` | Per-pay-item progress within an IDR: `dotPayItemId`, `quantityCompleted`, `unit`, `notes` |
| `swppp_inspections` | SWPPP log: `projectId`, `inspectionDate`, `inspectorId`, `rainfall24h`, `findings`, `bmpsInspected`, `correctionsDue`, `status` |
| `swppp_bmp_items` | Individual BMP (Best Management Practice) inspection items |
| `dbe_goals` | DBE goal record: `projectId`, `goalPercent`, `subcontractorId`, `certificationNumber`, `expirationDate`, `awardedAmount` |
| `dbe_payments` | DBE paid-to-date: `dbeGoalId`, `paymentDate`, `amount`, `description` |
| `surety_bonds` | `projectId`, `bondNumber`, `bondType` (performance/payment), `amount`, `issuer`, `effectiveDate`, `expirationDate`, `status` |
| `material_certifications` | `projectId`, `material`, `supplier`, `testDate`, `certificationNumber`, `result` (PASS/FAIL/PENDING), `documentUrl` |
| `material_test_results` | Test result data for certifications |

## Backend Routes

**File: `server/routes.ts`** and dedicated DOT route files:

| Method | Path | Description | Auth |
|---|---|---|---|
| GET | `/api/dot/pay-items` | Lists DOT pay items (filter by org or platform) | `requireAuth` + `canViewDotLibrary` |
| POST | `/api/dot/pay-items` | Creates pay item | `requireAuth` + `canManageDotLibrary` |
| PATCH | `/api/dot/pay-items/:id` | Updates pay item | same |
| DELETE | `/api/dot/pay-items/:id` | Deletes pay item | same |
| POST | `/api/dot/pay-items/import` | CSV bulk import | `canManageDotLibrary` |
| GET | `/api/haul-tickets` | Lists haul tickets for project | `canViewHaulTickets` |
| POST | `/api/haul-tickets` | Creates haul ticket | `canManageHaulTickets` |
| PATCH | `/api/haul-tickets/:id` | Updates ticket | `canManageHaulTickets` |
| POST | `/api/haul-tickets/:id/approve` | Approves ticket | `canApproveHaulTickets` |
| GET | `/api/daily-inspector-reports` | Lists IDRs | `canViewInspectorReports` |
| POST | `/api/daily-inspector-reports` | Creates IDR | `canSubmitInspectorReports` |
| PATCH | `/api/daily-inspector-reports/:id` | Updates IDR | `canManageInspectorReports` |
| POST | `/api/daily-inspector-reports/:id/approve` | Approves IDR | `canApproveInspectorReports` |
| GET | `/api/swppp-inspections` | Lists SWPPP inspections | `canViewSwppp` |
| POST | `/api/swppp-inspections` | Creates inspection | `canManageSwppp` |
| GET | `/api/dbe-goals` | Lists DBE goals for project | `canViewDbeGoals` |
| POST | `/api/dbe-goals` | Creates DBE goal | `canManageDbeGoals` |
| POST | `/api/dbe-goals/:id/payments` | Records DBE payment | `canManageDbeGoals` |
| GET | `/api/surety-bonds` | Lists surety bonds | `canViewSuretyBonds` |
| POST | `/api/surety-bonds` | Creates bond record | `canManageSuretyBonds` |
| GET | `/api/material-certifications` | Lists material certifications | `canViewMaterialCertifications` |
| POST | `/api/material-certifications` | Creates certification | `canManageMaterialCertifications` |
| POST | `/api/material-certifications/:id/verify` | Verifies certification | `canVerifyMaterialCertifications` |

**File: `server/materialTestRoutes.ts`** — material test results

## Frontend Pages & Components

Heavy-civil features surface through:
- Project detail DOT tab (haul tickets, IDRs, SWPPP)
- `/compliance` page — aggregated compliance dashboard
- Company settings — DOT library management
- Estimate line items — `dotPayItemId` FK linkage

## Roles & Permissions

| Action | Gate |
|---|---|
| View DOT library | `canViewDotLibrary` — all non-VENDOR roles |
| Manage DOT library | `canManageDotLibrary` — ADMIN, MANAGER (not HUSTLER) |
| View haul tickets | `canViewHaulTickets` |
| Manage haul tickets | `canManageHaulTickets` |
| Approve haul tickets | `canApproveHaulTickets` — ADMIN, MANAGER, SUPERINTENDENT |
| View/submit IDRs | `canViewInspectorReports`, `canSubmitInspectorReports` — FIELD_WORKER+ |
| Approve IDRs | `canApproveInspectorReports` — ADMIN, MANAGER, SUPERINTENDENT |
| SWPPP | `canViewSwppp`, `canManageSwppp` |
| DBE goals | `canViewDbeGoals`, `canManageDbeGoals` |
| Surety bonds | `canViewSuretyBonds`, `canManageSuretyBonds` |
| Material certifications | `canViewMaterialCertifications`, `canManageMaterialCertifications`, `canVerifyMaterialCertifications` |

## Integration Points

- **DOT pay item → estimate** — `dotPayItemId` FK on `estimate_line_items` and `sov_line_items`; `validateDotPayItemLink()` in `server/utils/dotPayItemValidation.ts` enforces referential integrity server-side
- **Haul ticket stations** — `haul_ticket_stations` stores source/destination chainage so the mass-haul curve can be rendered (earthwork balance chart)
- **Compliance dashboard** — `complianceRoutes.ts` aggregates surety bond expirations, DBE goal compliance, and material certification status for the `/compliance` view
- **DBE paid-to-date** — `dbe_payments` table tracks cumulative payments to DBE subs; compliance % computed against `dbe_goals.goalPercent`
- **AI Heavy Civil** — `server/aiHeavyCivilFeatureRoutes.ts` provides AI-assisted IDR field auto-fill and SWPPP inspection suggestions
- **Nightly checks** — scheduled jobs check surety bond expirations and DBE certification expiry dates; see task for `Schedule nightly DBE certification and surety bond checks`
