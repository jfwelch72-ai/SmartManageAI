# Mobile Feature: Field Ops

> Mirrors `docs/module-directory.md` §6 (Field Ops). Part of the
> [Mobile App Architecture Blueprint](../README.md).

## 1. Purpose on mobile

Field Ops (equipment, dispatch, inventory, procurement, permits, LiDAR, BIM)
is a mixed bag on mobile: dispatch and equipment status checks are strong
mobile use cases; LiDAR/BIM are explicitly desktop-only (see
`00-overview.md` §6).

## 2. Screens & navigation

| Screen | Maps to web page | Notes |
| --- | --- | --- |
| Dispatch Board (today) | `dispatch-board.tsx` | Read-only "my crew today" view for SUPERINTENDENT; full drag-and-drop dispatch editing stays web-only. |
| Equipment Status | `equipment.tsx` | Read equipment list/status; log a quick issue/repair request with a photo (write, offline-capable). |
| Inventory Lookup | `inventory.tsx` | Barcode/QR lookup (camera) of a material's stock level — read-only; issue/transfer transactions stay web-only in v1 given they require costing context. |
| Permits | `permits.tsx` | Read-only permit status + expiry; no mobile creation. |
| Haul Tickets (heavy civil) | `haul-tickets.tsx` | Full offline create — camera-based ticket capture at remote sites with poor connectivity; this is one of the app's primary offline-first use cases alongside time clock and daily reports. |
| Calculator | `calculator.tsx` | Trade material calculators — pure client-side compute, works fully offline with no sync at all. |
| LiDAR / BIM | `lidar-scans.tsx`, BIM viewer | **Not on mobile** — heavy client-side rendering and desktop input patterns; see `00-overview.md` §6. |

## 3. Offline behavior

| Data | Offline read | Offline write |
| --- | --- | --- |
| Dispatch (today's assignment) | Cached | N/A (read-only on mobile) |
| Equipment list/status | Cached | Issue/repair report queues via outbox, `APPEND_ONLY` (new report, no conflict) |
| Inventory lookup | Cached last-fetched stock snapshot, clearly labeled as potentially stale | N/A (no mobile write in v1) |
| Permits | Cached | N/A |
| Haul tickets | N/A (creation-only) | Outbox, `LAST_WRITE_WINS` per `ENTITY_STRATEGY_MAP` (`shared/schema/features/mobileSync.ts`) — each ticket edit within the dedupe window resolves to the most recent write rather than being kept as separate rows; camera photo attaches via the standard media-upload flow |
| Calculators | N/A — pure local compute | N/A |

## 4. API surface

| Endpoint | Method | Notes |
| --- | --- | --- |
| `/api/dispatch/today` | GET | Scoped to the caller's crew(s) |
| `/api/equipment` | GET | List/status |
| `/api/equipment/:id/repairs` | POST | Issue/repair report |
| `/api/inventory/materials/by-barcode/:code` | GET | Existing barcode lookup route (`server/inventoryRoutes.ts`) — reused as-is |
| `/api/permits` | GET | Read-only |
| `/api/haul-tickets` | GET/POST | Full offline create |

## 5. Permissions per role

> Covers all 18 roles from `docs/ACCOUNT_ROLES_RBAC.md`; see
> [`00-overview.md` §4](../00-overview.md#4-roles--mobile-access-matrix) for
> the canonical-role remap. `DISPATCHER` (→ `SUPERINTENDENT`) and
> `PROCUREMENT_MANAGER` (→ `MANAGER`) have real Field Ops carve-outs:
> Dispatch is `DISPATCHER`'s primary landing tab, and material
> request/PO creation is surfaced for `PROCUREMENT_MANAGER` where
> `MANAGER` otherwise sees it read-only. `MAINTENANCE_MANAGER` /
> `EQUIPMENT_MANAGER` (→ `FIELD_WORKER`) get an added Equipment
> read/work-order carve-out beyond the plain `FIELD_WORKER` row.

| Role | Dispatch (read) | Equipment (read + issue report) | Inventory lookup | Permits (read) | Haul tickets |
| --- | --- | --- | --- | --- | --- |
| ADMIN | Yes | Yes | Yes | Yes | Yes |
| MANAGER | Yes | Yes | Yes | Yes | Yes |
| SUPERINTENDENT | Yes | Yes | Yes | Yes | Yes |
| ESTIMATOR | No (web read-only per RBAC, not surfaced on mobile) | Read | Read | Read | Read |
| FIELD_WORKER | No | No (equipment access excludes FIELD_WORKER per RBAC) | No | No | Yes (heavy-civil field crews) |
| VENDOR | No | No | No | No | No |

## 6. Gaps vs. today

- The legacy `docs/feature-G-mobile-offline.md` "trade-specific tool
  configuration" concept (roofing/electrical/plumbing per-trade mobile tool
  sets) has never shipped in any form. This blueprint does not build it —
  the Calculator screen above (generic trade calculators, already shipped
  on web) is the closest existing analog. If a future task wants
  trade-specific mobile tools, it should be scoped as new work referencing
  this gap, not assumed to already exist.
- Inventory issue/transfer transactions are read-only on mobile in v1
  because they carry costing implications (average unit cost burden per
  `docs/architecture/decisions.md` "Materials Inventory & PM Engine")
  better handled with a full screen and confirmation flow than a phone-sized
  quick action.
