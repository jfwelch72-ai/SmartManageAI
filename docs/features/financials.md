# financials — Schedule of Values, AIA Progress Billing, Payroll, Cost Ledger, WIP Report, Revenue Recognition, Unified Payments, Lien Waivers

## Overview

The financials module is the platform's money-path engine. It covers: **Schedule of Values (SOV)** for defining the billing breakdown per project; **AIA G702/G703** pay application workflow (DRAFT → SUBMITTED → APPROVED → PAID); **certified payroll** (prevailing wage, WH-347, Davis-Bacon compliance); **cost ledger** for actual cost tracking against budgets; **WIP report** and revenue recognition for accounting integration; and **unified payments** for recording owner payments and lien waiver issuance. All mutations write to `audit_log`.

## Data Models

**Key tables (`shared/schema/features/financial.ts`, `shared/schema/core.ts`)**

| Table | Description |
|---|---|
| `schedule_of_values` | `sovNumber`, `projectId`, `organizationId`, `contractValue`, `retainagePercent`, `status`, `totalCompletedToDate` |
| `sov_line_items` | Line items: `lineNumber`, `description`, `scheduledValue`, `workCompleted`, `materialsStored`, `percentComplete`, `balanceToFinish`, `dotPayItemId` |
| `sov_payments` | Owner payments against an SOV |
| `pay_applications` | AIA G702 records: `applicationNumber`, `periodTo`, `originalContractSum`, `contractSumToDate`, `totalCompletedAndStored`, `currentPaymentDue`, `totalRetained`, `balanceToFinish`, `status`, `createdById`, `approvedById` |
| `stored_materials` | On-site or off-site stored materials tracked for G703 |
| `retention_releases` | Partial retainage release records |
| `lien_waivers` | Conditional/unconditional lien waivers; `type`, `amount`, `status`, `signedAt` |
| `pay_runs` | Payroll processing runs: `payPeriodStart`, `payPeriodEnd`, `status`, `organizationId` |
| `pay_run_line_items` | Per-worker pay details within a pay run |
| `payroll_deduction_types` | Org-defined deduction categories (health, 401k, garnishment) |
| `employee_deductions` | Per-worker deduction assignments |
| `pay_stubs` | Generated pay stub records |
| `certified_payroll_reports` | WH-347 certified payroll report records |
| `cost_ledger_postings` | Actual cost entries against budget codes: `projectId`, `costCode`, `amount`, `source` (payroll, invoice, PO) |
| `overhead_cost_items` | Org-level overhead allocations per period |
| `unified_payments` | Owner payments received: `projectId`, `amount`, `method`, `referenceNumber`, `appliedToSOV` |
| `revenue_recognition_entries` | Period revenue recognition (percentage-of-completion) |
| `wip_snapshots` | Work-in-progress report snapshots |
| `organization_payroll_settings` | `payFrequency`, `prevailingWageEnabled`, `defaultOvertimeRules` |
| `prevailing_wage_rates` | Davis-Bacon wage determination cache by classification |
| `dol_classification_mappings` | Internal classification → DOL Davis-Bacon classification mappings |

## Backend Routes

**File: `server/sovRoutes.ts`** — SOV management:
| Method | Path | Description | Auth |
|---|---|---|---|
| GET | `/api/sov/projects/:id` | SOV for project | `requireFeaturePermission('canViewFinancials')` |
| POST | `/api/sov/projects/:id` | Creates SOV | `requireFeaturePermission('canEditFinancials')` |
| PATCH | `/api/sov/:sovId/line-items/:lineId` | Updates line item progress | `requireFeaturePermission('canEditFinancials')` |
| POST | `/api/sov/:sovId/import-estimate` | Seeds SOV from estimate line items | `requireRole('ADMIN','MANAGER')` |

**File: `server/aiaBillingRoutes.ts`** — AIA pay application workflow:
| Method | Path | Description | Auth |
|---|---|---|---|
| GET | `/api/aia-billing/pay-applications` | Lists pay apps | `requireFeaturePermission('canViewFinancials')` |
| POST | `/api/aia-billing/pay-applications` | Creates pay app; auto-computes totals; COI gating check | `requireRoleOrFeature(['ADMIN','MANAGER'], 'canAccessProgressBilling')` |
| GET | `/api/aia-billing/pay-applications/:id` | Get pay app with line items | same |
| PATCH | `/api/aia-billing/pay-applications/:id/status` | Status transition (SUBMITTED → APPROVED etc.) | same |
| POST | `/api/aia-billing/pay-applications/:id/record-payment` | Records owner payment | same |
| POST | `/api/aia-billing/pay-applications/:id/sync-totals` | Re-syncs totals from SOV | same |
| GET | `/api/aia-billing/pay-applications/:id/g702-pdf` | Generates G702 PDF | same |
| GET | `/api/aia-billing/pay-applications/:id/g703-pdf` | Generates G703 PDF | same |
| POST | `/api/aia-billing/pay-applications/roll-forward` | Creates next pay app from prior | same |
| GET | `/api/aia-billing/billing-hub/summary` | Cross-project billing hub | same |

**File: `server/payrollRoutes.ts`** — payroll (≈ 5,000 lines):
| Method | Path | Description | Auth |
|---|---|---|---|
| GET | `/api/payroll/pay-runs` | Lists pay runs | `canManagePayroll` |
| POST | `/api/payroll/pay-runs` | Creates pay run | same |
| GET | `/api/payroll/pay-runs/:id` | Pay run details | same |
| PUT/PATCH | `/api/payroll/pay-runs/:id/status` | Status update (DRAFT → PROCESSING → COMPLETED) | same |
| DELETE | `/api/payroll/pay-runs/:id` | Deletes pay run | same |
| GET | `/api/payroll/pay-runs/:id/certified-report` | WH-347 certified report | same |
| GET | `/api/payroll/workers` | Workers with rates | same |
| GET | `/api/payroll/time-entries` | Time entries for payroll period | same |
| GET | `/api/payroll/settings` | Org payroll settings | same |
| PUT | `/api/payroll/settings` | Updates settings | same |
| GET | `/api/payroll/overview` | Dashboard summary | same |

**File: `server/costLedgerRoutes.ts`** — cost ledger postings

**File: `server/revenueRecognitionRoutes.ts`** — percentage-of-completion entries

**File: `server/paymentRoutes.ts`** — unified payment recording:
| Method | Path | Description |
|---|---|---|
| GET | `/api/payments` | Lists payments |
| POST | `/api/payments` | Records a payment |
| PATCH | `/api/payments/:id` | Updates payment |

**File: `server/retentionRoutes.ts`** — retainage tracking and releases

## Frontend Pages & Components

| Route | Page File | Description |
|---|---|---|
| `/progress-billing` | `client/src/pages/progress-billing.tsx` | AIA pay application management |
| `/tm-billing` | `client/src/pages/tm-billing.tsx` | T&M billing and tickets |
| `/subcontracts` | `client/src/pages/subcontracts.tsx` | Sub pay apps and retainage |
| `/cost-rates` | `client/src/pages/cost-rates.tsx` | Labor rate management |
| Project financials tab | Part of `project-detail.tsx` | SOV progress, budget vs. actual |

## Roles & Permissions

| Action | Gate |
|---|---|
| View financials | `canViewFinancials` — ADMIN, MANAGER, SUPERINTENDENT (read), ESTIMATOR |
| Edit financials | `canEditFinancials` — ADMIN, MANAGER |
| Access progress billing | `canAccessProgressBilling` |
| Manage payroll | `canManagePayroll` — ADMIN, MANAGER |
| Access T&M billing | `canAccessTMBilling` |
| Access subcontracts | `canAccessSubcontracts` |
| Access overhead costs | `canAccessOverheadCosts` |

## Integration Points

- **COI gating** — `POST /api/aia-billing/pay-applications` calls `isReleaseBlocked()` in `server/services/coiGating.ts`; blocks pay-app creation when a sub's insurance is non-compliant unless an audited override exists in `coi_release_overrides`
- **Audit log** — `logCreate`, `logApprove`, `logUpdate` called for pay apps, pay runs, and payments; see `docs/ops/security-quickref.md`
- **Davis-Bacon** — `server/integrations/providers/dol_davis_bacon/sync.ts` syncs DOL wage determinations; `lookupCachedWageRate()` used during payroll to compute prevailing wage differentials; rate change alerts written to `wageDecisionRateChanges` and surfaced to admins via `payrollRoutes.ts`
- **AIA PDF** — `generateAIAG702PDF()` / `generateAIAG703PDF()` in `server/aia-pdf-service.ts`
- **Event bus** — `pay_application.submitted`, `pay_run.completed` events trigger notifications
- **Subcontract payables** — `subcontractorPayablesRoutes.ts` tracks sub pay apps linked to prime pay apps; retainage flows through `subcontractManagementRoutes.ts`
- **Lien waiver chain** — lien waivers are issued on payment recording; conditional waivers require release after payment clears
