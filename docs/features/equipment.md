# equipment — Fleet Management, Assignments, Repairs, Maintenance History, Rental Catalog, CSV Import/Export

## Overview

The equipment module manages the company's owned and rented equipment fleet. Each piece of equipment has a catalog record with type, make, model, year, and meter readings. Equipment is assigned to projects by date range; maintenance schedules and repair logs track service history; rental catalog provides pricing for billing T&M tickets; and utilization reports compare billable hours vs. idle time.

## Data Models

**Key tables (`shared/schema/features/equipment.ts`)**

| Table | Description |
|---|---|
| `equipment` | Catalog: `name`, `type`, `make`, `model`, `year`, `serialNumber`, `licensePlate`, `status` (ACTIVE/IN_REPAIR/RETIRED), `purchaseCost`, `currentMileage`, `hoursMeter`, `organizationId` |
| `equipment_assignments` | Project assignments: `equipmentId`, `projectId`, `startDate`, `endDate`, `assignedById`, `dailyRate`, `notes` |
| `equipment_maintenance_logs` | Service records: `equipmentId`, `maintenanceType`, `serviceDate`, `mileageAtService`, `hoursAtService`, `cost`, `vendor`, `notes`, `performedById` |
| `equipment_maintenance_schedules` | Recurring maintenance triggers: `equipmentId`, `maintenanceType`, `intervalDays`, `intervalHours`, `lastServiceDate`, `nextDueDate` |
| `equipment_repairs` | Repair orders: `equipmentId`, `reportedAt`, `description`, `priority` (LOW/MEDIUM/HIGH/CRITICAL), `status` (OPEN/IN_PROGRESS/COMPLETED), `estimatedCost`, `actualCost`, `completedAt` |
| `equipment_repair_items` | Parts and labor line items on a repair order |
| `equipment_fuel_logs` | Fuel fill-up records: `equipmentId`, `date`, `gallons`, `costPerGallon`, `odometer`, `projectId` |
| `equipment_rentals` | Rental catalog: `name`, `category`, `dailyRate`, `weeklyRate`, `monthlyRate`, `minimumCharge`, `organizationId` |
| `equipment_rental_agreements` | Active rental agreements: `rentalItemId`, `projectId`, `startDate`, `endDate`, `quantity`, `totalCost` |
| `equipment_utilization_entries` | Billable vs. idle hours per day per equipment per project |
| `equipment_documents` | Attached documents (registration, insurance, inspection certs): `equipmentId`, `type`, `documentUrl`, `expirationDate` |
| `equipment_meter_readings` | Historical meter readings log |

## Backend Routes

**File: `server/equipmentRoutes.ts`**
| Method | Path | Description | Auth |
|---|---|---|---|
| GET | `/api/equipment` | Lists equipment (filter: status, type) | `requireAuth` + `canViewEquipment` |
| POST | `/api/equipment` | Creates equipment record | `canManageEquipment` |
| GET | `/api/equipment/:id` | Equipment detail | `canViewEquipment` |
| PATCH | `/api/equipment/:id` | Updates equipment | `canManageEquipment` |
| DELETE | `/api/equipment/:id` | Retires equipment | `canManageEquipment` |
| GET | `/api/equipment/:id/assignments` | Lists assignments | `canViewEquipment` |
| POST | `/api/equipment/:id/assignments` | Creates assignment | `canManageEquipment` |
| PATCH | `/api/equipment/:id/assignments/:assignId` | Updates assignment | `canManageEquipment` |
| GET | `/api/equipment/:id/maintenance` | Lists maintenance logs | `canViewEquipment` |
| POST | `/api/equipment/:id/maintenance` | Creates maintenance log | `canManageEquipment` |
| POST | `/api/equipment/:id/maintenance/schedule` | Sets maintenance schedule | `canManageEquipment` |
| GET | `/api/equipment/:id/repairs` | Lists repair orders | `canViewEquipment` |
| POST | `/api/equipment/:id/repairs` | Creates repair order | `canManageEquipment` |
| PATCH | `/api/equipment/:id/repairs/:repairId/status` | Updates repair status | `canManageEquipment` |
| POST | `/api/equipment/:id/fuel-logs` | Logs fuel fill-up | `canManageEquipment` |
| GET | `/api/equipment/rentals` | Lists rental catalog | `canViewEquipment` |
| POST | `/api/equipment/rentals` | Creates rental item | `canManageEquipment` |
| GET | `/api/equipment/utilization` | Equipment utilization report | `canViewEquipment` |
| POST | `/api/equipment/import` | CSV import | `canManageEquipment` + `exportLimiter` |
| GET | `/api/equipment/export` | CSV export | `canViewEquipment` + `exportLimiter` |

## Frontend Pages & Components

| Route | Page File | Description |
|---|---|---|
| `/equipment` | `client/src/pages/equipment.tsx` | Fleet management hub |

The equipment page uses tabs: **Fleet** (catalog list + map), **Assignments** (Gantt-style project timeline), **Maintenance** (upcoming/overdue), **Repairs** (repair order kanban), **Rentals** (catalog), **Reports** (utilization charts).

## Roles & Permissions

| Action | Gate |
|---|---|
| View equipment | `canViewEquipment` — ADMIN, MANAGER, SUPERINTENDENT, ESTIMATOR |
| Manage equipment | `canManageEquipment` — ADMIN, MANAGER |
| Track equipment costs | `canTrackEquipmentCosts` |

## Integration Points

- **T&M billing** — equipment rentals and assignment daily rates can be pulled into T&M ticket line items
- **Cost ledger** — equipment costs (fuel, repairs, rental) post to `cost_ledger_postings` with `source = 'equipment'`
- **Maintenance alerts** — `aiNotesScheduler.ts` checks `equipment_maintenance_schedules.nextDueDate` and emits overdue-maintenance notifications
- **GCS documents** — equipment registration, insurance, and inspection cert documents stored in GCS via `objectStorageRoutes.ts`
- **Export** — CSV export uses `exportLimiter` (15 min / 20 requests) to prevent abuse
