# inventory — Locations, Materials, Stock Levels, Transactions, Cycle Counts

## Overview

The inventory module manages on-site and warehouse material stock. Locations (warehouses, job sites, trucks) hold materials with current quantity-on-hand. All stock changes are recorded as transactions (receive, issue, transfer, adjust, cycle-count). Reorder points trigger low-stock alerts. Materials can be linked to cost codes for budget tracking.

## Data Models

**Key tables (`shared/schema/features/inventory.ts`)**

| Table | Description |
|---|---|
| `inventory_locations` | `name`, `type` (WAREHOUSE/JOBSITE/VEHICLE), `address`, `organizationId`, `isDefault` |
| `inventory_items` | Material master: `name`, `sku`, `category`, `unit`, `unitCost`, `reorderPoint`, `reorderQuantity`, `costCode`, `organizationId` |
| `inventory_stock` | Current stock level: `locationId`, `itemId`, `quantityOnHand`, `quantityReserved`, `quantityOnOrder` |
| `inventory_transactions` | Audit trail of every stock change: `itemId`, `locationId`, `type` (RECEIVE/ISSUE/TRANSFER/ADJUST/COUNT), `quantity` (positive or negative), `referenceId`, `referenceType` (po/daily-report/transfer), `notes`, `performedById`, `transactedAt` |
| `inventory_transfer_requests` | Transfer request between locations: `fromLocationId`, `toLocationId`, `status`, `requestedById`, `approvedById` |
| `inventory_transfer_items` | Line items within a transfer request |
| `inventory_cycle_counts` | Cycle count sessions: `locationId`, `scheduledDate`, `status` (PLANNED/IN_PROGRESS/COMPLETE), `conductedById` |
| `inventory_cycle_count_items` | Per-item count entries: `cycleCountId`, `itemId`, `expectedQuantity`, `countedQuantity`, `variance` |
| `inventory_purchase_orders` | Inventory-specific POs (linked to procurement module POs) |

## Backend Routes

**File: `server/inventoryRoutes.ts`**
| Method | Path | Description | Auth |
|---|---|---|---|
| GET | `/api/inventory/locations` | Lists locations | `canViewInventory` |
| POST | `/api/inventory/locations` | Creates location | `canManageInventory` |
| PATCH | `/api/inventory/locations/:id` | Updates location | `canManageInventory` |
| GET | `/api/inventory/items` | Lists items (filter: category, location) | `canViewInventory` |
| POST | `/api/inventory/items` | Creates item | `canManageInventory` |
| PATCH | `/api/inventory/items/:id` | Updates item | `canManageInventory` |
| DELETE | `/api/inventory/items/:id` | Archives item | `canManageInventory` |
| GET | `/api/inventory/stock` | Current stock levels for all items/locations | `canViewInventory` |
| GET | `/api/inventory/stock/low` | Items below reorder point | `canViewInventory` |
| POST | `/api/inventory/transactions/receive` | Records receipt of goods | `canManageInventory` |
| POST | `/api/inventory/transactions/issue` | Issues materials to project | `canManageInventory` |
| POST | `/api/inventory/transactions/transfer` | Creates transfer request | `canManageInventory` |
| PATCH | `/api/inventory/transfer-requests/:id/approve` | Approves transfer | `canManageInventory` |
| GET | `/api/inventory/transactions` | Transaction log (paginated) | `canViewInventory` |
| POST | `/api/inventory/cycle-counts` | Creates cycle count session | `canManageInventory` |
| PATCH | `/api/inventory/cycle-counts/:id/items` | Submits count entries | `canManageInventory` |
| POST | `/api/inventory/cycle-counts/:id/complete` | Finalizes count and posts adjustments | `canManageInventory` |
| POST | `/api/inventory/import` | CSV import of items | `canManageInventory` |
| GET | `/api/inventory/export` | CSV export | `canViewInventory` + `exportLimiter` |

## Frontend Pages & Components

| Route | Page File | Description |
|---|---|---|
| `/inventory` | `client/src/pages/inventory.tsx` | Inventory management hub |

Tabs: **Locations** (stock by location), **Items** (master catalog), **Transactions** (ledger), **Transfers** (request/approve), **Cycle Counts** (schedule + conduct), **Reports** (valuation, variance).

## Roles & Permissions

| Action | Gate |
|---|---|
| View inventory | `canViewInventory` — ADMIN, MANAGER, SUPERINTENDENT, ESTIMATOR |
| Manage inventory | `canManageInventory` — ADMIN, MANAGER, SUPERINTENDENT |

## Integration Points

- **Procurement** — `POST /api/inventory/transactions/receive` can reference a `purchase_order_items` row; updates `purchase_order_items.deliveredQuantity` for 3-way match
- **Daily reports** — material issues can be linked from a daily report's scope progress entry, referencing an `inventory_transactions` row
- **Cost ledger** — material issues post to `cost_ledger_postings` with `source = 'inventory'`
- **Low-stock alerts** — `aiNotesScheduler.ts` checks `inventory_stock.quantityOnHand <= inventory_items.reorderPoint` and inserts notifications
- **Estimate integration** — `estimate_line_items.materialCost` can reference `inventory_items.unitCost` for current pricing
