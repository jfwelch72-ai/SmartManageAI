# procurement — Purchase Requisitions, Purchase Orders, Receipts, Invoices, 3-Way Match

## Overview

The procurement module manages the full purchase-to-pay lifecycle: field workers or managers create purchase requisitions; ADMINs approve and convert them to purchase orders (POs) sent to vendors; goods are received via receipts; vendor invoices are matched against the PO and receipt (3-way match) before payment approval. All PO values are tracked against the project budget and cost ledger.

## Data Models

**Key tables (`shared/schema/operations.ts`)**

| Table | Description |
|---|---|
| `procurement_items` | Legacy procurement line items (used for simpler material tracking) |
| `purchase_orders` | `projectId`, `vendorId`, `poNumber`, `status` (DRAFT/SENT/PARTIALLY_RECEIVED/RECEIVED/INVOICED/CLOSED), `totalAmount`, `taxAmount`, `shippingAmount`, `deliveryDate`, `notes` |
| `purchase_order_items` | Line items: `description`, `quantity`, `unit`, `unitPrice`, `lineTotal`, `costCode`, `deliveredQuantity` |
| `vendor_invoices` | `purchaseOrderId`, `invoiceNumber`, `invoiceDate`, `amount`, `status` (PENDING/MATCHED/APPROVED/PAID/DISPUTED), `dueDate` |
| `po_receipts` | Goods received records: `purchaseOrderId`, `receivedDate`, `receivedById`, `notes` |
| `po_receipt_items` | `poReceiptId`, `purchaseOrderItemId`, `quantityReceived`, `condition` |
| `receipts` | Project expense receipts (smaller purchases, credit card expenses): `projectId`, `userId`, `amount`, `vendor`, `category`, `receiptDate`, `imageUrl` |
| `subcontractors` | Vendor / subcontractor master record |
| `subcontractor_contracts` | Contract record with values and retainage % |
| `subcontractor_payments` | Payment history for subs |
| `subcontractor_billing_schedule` | Scheduled billing milestones for subs |

## Backend Routes

**File: `server/procurementModuleRoutes.ts`** — full PO lifecycle:
| Method | Path | Description | Auth |
|---|---|---|---|
| GET | `/api/procurement/purchase-orders` | Lists POs for org | `requireAuth` + `canManageProcurement` |
| POST | `/api/procurement/purchase-orders` | Creates PO | same |
| GET | `/api/procurement/purchase-orders/:id` | PO detail with items | same |
| PATCH | `/api/procurement/purchase-orders/:id` | Updates PO | same |
| POST | `/api/procurement/purchase-orders/:id/send` | Marks PO as sent to vendor | same |
| POST | `/api/procurement/purchase-orders/:id/receive` | Creates receipt against PO | same |
| GET | `/api/procurement/invoices` | Lists vendor invoices | same |
| POST | `/api/procurement/invoices` | Creates invoice | same |
| POST | `/api/procurement/invoices/:id/match` | Runs 3-way match | same |
| POST | `/api/procurement/invoices/:id/approve` | Approves matched invoice | same |
| GET | `/api/procurement/receipts` | Lists project receipts | same |
| POST | `/api/procurement/receipts` | Creates expense receipt | same |

**Routes in `server/routes.ts`** (legacy):
| Method | Path | Description |
|---|---|---|
| GET | `/api/procurement-items` | Lists procurement items for project |
| POST | `/api/procurement-items` | Creates procurement item |
| PATCH | `/api/procurement-items/:id` | Updates item |
| DELETE | `/api/procurement-items/:id` | Deletes item |

**File: `server/subcontractRoutes.ts`** — subcontractor contracts:
| Method | Path | Description |
|---|---|---|
| GET | `/api/subcontracts` | Lists subcontractor contracts |
| POST | `/api/subcontracts` | Creates contract |
| PATCH | `/api/subcontracts/:id` | Updates contract |

**File: `server/subcontractorPayablesRoutes.ts`** — sub billing and payments

## Frontend Pages & Components

| Route | Page File | Description |
|---|---|---|
| `/subcontracts` | `client/src/pages/subcontracts.tsx` | Subcontract management hub |
| Project procurement tab | Part of `project-detail.tsx` | POs, invoices, receipts per project |

## Roles & Permissions

| Action | Gate |
|---|---|
| View procurement | `canManageProcurement` — ADMIN, MANAGER, ESTIMATOR, SUPERINTENDENT |
| Approve POs | `canManageProcurement` + ADMIN / MANAGER role |
| View/edit subcontracts | `canAccessSubcontracts` |
| View procurement data | `canViewProjectProcurement` |

## Integration Points

- **3-way match logic** — `POST /api/procurement/invoices/:id/match` compares invoice amount vs. PO value and receipt quantities; flags discrepancies over configurable tolerance
- **Cost ledger** — approved invoices post to `cost_ledger_postings` for budget-vs-actual tracking
- **Event bus** — `po.created`, `invoice.matched`, `invoice.approved` events trigger notifications to PM and approvers
- **Vendor portal** — vendors can view POs and submit invoices via sub-portal (see `portals` module)
- **QuickBooks sync** — approved invoices and POs can be synced to QBO via `server/integrations/providers/quickbooks/` (see `integrations` module)
