# estimating — Bid Lifecycle, Estimate Versions, Vendor Quotes, Bid Wizard, Hit-Rate Analytics, Cost Book, Price Book

## Overview

The estimating module manages the full bid-to-project lifecycle. A **bid** is the top-level entity (client, due date, status); it can have multiple **estimate versions**, each containing **line items** that track material, labor, equipment, consumable, and subcontract costs. Organization-level **estimating factors** (overhead %, profit %, bond %, labor burden %, etc.) are applied to produce a factorized grand total. The AI estimator can auto-generate line items from plan documents. The bid wizard (`/bids/new`) guides step-by-step bid creation.

## Data Models

**Key tables (`shared/schema/operations.ts`, `shared/schema/features/estimate.ts`, `shared/schema/features/ai_estimator.ts`, `shared/schema/features/cost_book.ts`)**

| Table | Description |
|---|---|
| `bids` | `id`, `code` (auto-incremented slug), `name`, `clientName`, `gcOrganizationId`, `status` (DRAFT/ACTIVE/SUBMITTED/AWARDED/LOST/CANCELLED), `bidAmount`, `dueDate`, `estimatorId` |
| `bid_documents` | Uploaded plan PDFs and attachments linked to a bid |
| `estimates` | One or more estimate versions per bid or project; `bidId`, `projectId`, `status`, `estimatingFactorsOverride` (JSON) |
| `estimate_line_items` | Cost rows: `description`, `quantity`, `unit`, `unitPrice`, `materialCost`, `laborCost`, `laborHours`, `equipmentCost`, `consumablesCost`, `subcontractCost`, `overheadAllocation`, `profitAllocation`, `totalCost`, `category` (40+ enum values), `dotPayItemId` |
| `estimate_versions` | Immutable snapshots of line items at a point in time; used for version history / compare |
| `estimate_benchmark_refreshes` | Tracks when AI benchmark pricing was last refreshed |
| `bid_subcontractor_quotes` | Vendor quote amounts linked to estimate line items |
| `scope_items` | Detailed scope records within a bid/project |
| `org_estimating_factors` | Org-level default factors: `laborBurdenPercent`, `smallToolsPercent`, `overheadPercent`, `profitPercent`, `bondPercent`, `escalationPercent`, `defaultWasteFactor` |
| `cost_book_items` | Custom org cost book (material + labor unit prices by trade) |
| `vendor_pricing_catalogs` | Vendor price lists matched to estimate line items using fuzzy string matching |
| `job_classifications` | Labor classifications used for prevailing wage / certified payroll |
| `ai_bid_document_analysis` | AI analysis records for plan documents (extracted scope, suggested line items) |
| `ai_estimator_learned_rates` | Machine-learned unit cost rates per SOW category built from historical estimates |

## Backend Routes

**File: `server/bidRoutes.ts`** — bid CRUD + lifecycle:
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/bids` | `requireAuth` | Lists bids with latest estimate summary |
| GET | `/api/bids/:code` | `requireAuth` | Bid detail with estimates |
| POST | `/api/bids` | `requireRole('ADMIN','MANAGER','ESTIMATOR')` | Creates bid with auto-assigned code (3-retry collision guard) |
| PATCH | `/api/bids/:code` | `requireRole('ADMIN','MANAGER','ESTIMATOR')` | Updates bid fields; validates allowed status transitions |
| DELETE | `/api/bids/:code` | `requireRole('ADMIN','MANAGER','ESTIMATOR')` | Soft-deletes bid |
| POST | `/api/bids/:code/convert-to-project` | `requireFeaturePermission('canConvertBidToProject')` | Converts AWARDED bid to project |
| GET | `/api/bids/:code/scope-document` | `requireAuth` | Returns signed URL for latest AI scope document |

**File: `server/estimateRoutes.ts`** — estimates + line items:
| Method | Path | Description |
|---|---|---|
| GET | `/api/bids/:code/estimates` | Lists estimates for bid |
| POST | `/api/bids/:code/estimates` | Creates estimate |
| GET | `/api/bids/:code/estimates/:id/line-items` | Lists line items |
| POST | `/api/bids/:code/estimates/:id/line-items` | Adds line item |
| PATCH | `/api/bids/:code/estimates/:id/line-items/:lineId` | Updates line item |
| DELETE | `/api/bids/:code/estimates/:id/line-items/:lineId` | Removes line item |
| GET | `/api/bids/:code/estimates/:id/totals` | Returns factorized totals |
| POST | `/api/bids/:code/estimates/:id/snapshot` | Creates version snapshot |
| GET | `/api/bids/:code/estimates/:id/versions` | Lists snapshots |
| GET | `/api/projects/:projectId/estimate` | Active estimate for a project |

**File: `server/bidAnalyticsRoutes.ts`**
| Method | Path | Description |
|---|---|---|
| GET | `/api/bids/analytics/hit-rate` | Win/loss rate by period, trade, estimator |
| GET | `/api/bids/analytics/pipeline` | Weighted pipeline by status |

**File: `server/costBookRoutes.ts`**
| Method | Path | Description |
|---|---|---|
| GET | `/api/cost-book/items` | Lists org cost book items |
| POST | `/api/cost-book/items` | Creates cost book item |
| PATCH | `/api/cost-book/items/:id` | Updates item |
| DELETE | `/api/cost-book/items/:id` | Deletes item |
| POST | `/api/cost-book/import` | CSV import |

**File: `server/orgEstimatingFactorsRoutes.ts`**
| Method | Path | Description |
|---|---|---|
| GET | `/api/org-estimating-factors` | Returns org's factor overrides |
| PUT | `/api/org-estimating-factors` | Upserts factor overrides |

## Frontend Pages & Components

| Route | Page File | Description |
|---|---|---|
| `/bids` | `client/src/pages/bids.tsx` | Bid list with filters |
| `/bids/new` | `client/src/pages/bid-wizard.tsx` | Step-by-step bid creation wizard |
| `/bids/hit-rate` | `client/src/pages/bid-hit-rate.tsx` | Win/loss analytics |
| `/bids/:code` | `client/src/pages/bid-detail.tsx` | Bid detail + document uploads |
| `/bids/:code/estimate` | `client/src/pages/bid-estimate.tsx` | Line item grid + factor controls |
| `/historical-costs` | `client/src/pages/historical-costs.tsx` | Benchmark pricing explorer |
| `/cost-book` | `client/src/pages/cost-book.tsx` | Org cost book management |

## Roles & Permissions

| Action | Gate |
|---|---|
| View bids | `canViewBids` |
| Create/edit bids | `canEditBids` — ADMIN, MANAGER, ESTIMATOR |
| Delete bids | `canDeleteBids` — ADMIN, MANAGER |
| Generate bid PDFs | `canGenerateBidPDFs` |
| Convert bid to project | `canConvertBidToProject` |
| Access bid network | `canAccessBidNetworkGC` |
| Use AI bid analysis | `canUseAiBidAnalysis` |
| Access historical costs | `canAccessHistoricalCosts` |

## Integration Points

- **Storage seam** — `BidStorageDrizzle` in `server/bids/storage.drizzle.ts` implements `IBidStorage` interface; `CrossOrgAccessError` is thrown on cross-tenant reads and mapped to HTTP 403
- **Vendor pricing match** — `matchVendorPricing()` in `estimateRoutes.ts` uses Levenshtein + token-overlap scoring to auto-link vendor catalog prices to line items
- **AI document analysis** — `POST /api/ai/bids/:bidId/analyze-documents` in `aiOrchestrationRoutes.ts` extracts scope from uploaded PDFs
- **Event bus** — `bid.assigned` event fires when estimator is set; used by notification service
- **Org factors** — `applyOrgFactors()` + `resolveAppliedFactors()` in `server/services/aiEstimator/orgFactorsApply.ts` ensures bid, project, and export totals agree
- **PDF export** — `generateInternalBidSummaryPDF()` and `generateCustomerQuotePDF()` via `server/pdf-service.ts`
- **DOT pay items** — `dotPayItemId` FK links line items to DOT library for heavy-civil projects; validated by `validateDotPayItemLink()` in `server/utils/dotPayItemValidation.ts`
