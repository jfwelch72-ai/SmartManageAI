# takeoff — Takeoff Workspace, Sheet Management, Measurements, Assemblies, AI Takeoff, Calibration, Review Queue

## Overview

The takeoff module provides a canvas-based quantity extraction tool. Users upload plan PDFs (auto-expanded to one sheet per page), calibrate the scale using a two-point reference, then draw LINEAR, AREA, PITCHED_AREA, SURFACE_AREA, VOLUME, and COUNT measurements. Measurements carry provenance metadata (scale at capture, calibration source, snap hit ratio) and are automatically flagged `needsReview` when uncalibrated, AI-detected, low-snap, or high-value. Assemblies bundle measurements into cost components. Real-time collaboration is achieved via WebSocket broadcast.

## Data Models

**Key tables (`shared/schema/features/takeoff.ts`)**

| Table | Description |
|---|---|
| `takeoff_sheets` | One row per plan page; `bidId` or `projectId`, `imageUrl`, `sheetIndex`, `sheetName`, `scalePxPerFoot`, `scaleLabel`, `scaleSource`, `scaleConfidence`, `scaleLockedToRevision` |
| `takeoff_measurements` | `sheetId`, `takeoffVersionId`, `type` (enum), `points` (JSON array), `computedLengthFt`, `computedAreaFt2`, `computedVolumeCy`, `computedSurfaceAreaFt2`, `count`, `unitCost`, `category`, `label`, `color`, `needsReview`, `scaleAtCapturePxPerFoot`, `scaleAtCaptureLabel`, `calibrationSource`, `snapHitRatio` |
| `takeoff_versions` | Named versions of a sheet's measurements; `sheetId`, `label`, `isCurrent`, `isLocked` |
| `takeoff_measurement_groups` | Logical groupings of measurements (e.g., by floor, zone) |
| `takeoff_assemblies` | Pre-built component packages: `name`, `items` (JSON), `orgId` |
| `takeoff_assembly_items` | Line items within an assembly |
| `takeoff_measurement_assemblies` | Junction table linking measurements to assemblies |
| `quantity_categories` | Display categories for measurements: `name`, `color`, `lineStyle`, `lineWidth`, `wasteFactor`, `unitCost` |
| `takeoff_issues` | Review-queue items flagged for human review |
| `takeoff_calibration_zones` | Named calibration reference zones per sheet |
| `bim_storey_associations` | Links sheets to BIM model storeys |
| `plan_sets` | Set of sheets imported from a single plan document |

## Backend Routes

**File: `server/takeoffSheetRoutes.ts`** — sheet + category management:
| Method | Path | Description |
|---|---|---|
| GET | `/api/bids/:bidId/takeoff/sheets` | Lists sheets for a bid |
| POST | `/api/bids/:bidId/takeoff/import-plan` | Imports plan from bid document (PDF page expansion) |
| POST | `/api/bids/:bidId/takeoff/plans` | Direct file URL upload |
| GET | `/api/bids/:bidId/takeoff/categories` | Lists measurement categories |
| POST | `/api/bids/:bidId/takeoff/categories` | Creates category |
| PATCH | `/api/bids/:bidId/takeoff/sheets/reorder` | Reorders sheet index |
| GET | `/api/projects/:projectId/takeoff/sheets` | Lists sheets for a project |

**File: `server/takeoffMeasurementRoutes.ts`** — measurement CRUD + calibration:
| Method | Path | Description |
|---|---|---|
| GET | `/api/takeoff/sheets/:sheetId/measurements` | Lists measurements (version-aware) |
| POST | `/api/takeoff/sheets/:sheetId/measurements` | Creates measurement with provenance stamping |
| PATCH | `/api/takeoff/sheets/:sheetId/measurements/:id` | Updates measurement (strips immutable scale fields) |
| DELETE | `/api/takeoff/sheets/:sheetId/measurements/:id` | Deletes measurement |
| POST | `/api/takeoff/sheets/:sheetId/calibrate` | Applies new scale; triggers batch rescale of all measurements |
| GET | `/api/bids/:bidId/takeoff/all-measurements` | Returns all measurements across bid's sheets |
| GET | `/api/projects/:projectId/takeoff/all-measurements` | Returns all measurements across project's sheets |

**File: `server/standaloneTakeoffRoutes.ts`** — standalone takeoff sessions

**File: `server/takeoffPaginationRoutes.ts`** — cursor-based pagination for large measurement sets

**File: `server/takeoffCrossModuleRoutes.ts`** — routes that link takeoff quantities to estimate line items

**File: `server/takeoffScopeRoutes.ts`** — scope items extracted from takeoff

**File: `server/assemblyRoutes.ts`** — assembly CRUD

**File: `server/aiTakeoffFeatureRoutes.ts`** — AI auto-detect measurements from plan images

## Frontend Pages & Components

| Route | Page File | Description |
|---|---|---|
| `/takeoff/:bidCode` | `client/src/pages/takeoff.tsx` | Canvas takeoff workspace for a bid |
| `/takeoff/standalone/:id` | `client/src/pages/standalone-takeoff.tsx` | Standalone session (not tied to a bid) |
| `/bids/:code` | `client/src/pages/bid-detail.tsx` | Includes plan uploads and takeoff workspace link |

Key components: `TakeoffCanvas`, `MeasurementToolbar`, `CategoryPanel`, `AssemblyPanel`, `ScaleCalibrator`, `ReviewQueue`, `VersionSelector`.

## Roles & Permissions

| Action | Gate |
|---|---|
| View takeoff | `requireAuth` + org access via `verifySheetAccess()` |
| Create/edit measurements | `requireRole('ADMIN','MANAGER','ESTIMATOR')` |
| Manage sheets | `requireRole('ADMIN','MANAGER','ESTIMATOR')` |
| Lock a version | `requireRole('ADMIN','MANAGER')` |
| AI auto-takeoff | `canUseAiEstimator` |

## Integration Points

- **WebSocket broadcast** — `broadcastTakeoffEvent(roomId, type, payload)` in `server/takeoffCollaboration.ts`; room is `bidId` or `projectId`; triggered from REST mutations via `broadcastMeasurementMutation()`
- **PDF page-count** — `getPdfPageCountFromGcs()` in `server/utils/pdfPageCount.ts` uses pdf-parse to count pages during plan import
- **Geometry library** — `shared/utils/geometry.ts` — `computePolygonAreaInFt2`, `computePolygonPerimeterInFt`, `computeDistanceInFeet`, `computeVolumeInCY`, `computePitchedAreaFt2`, `createArcSegment`
- **Needs-review rule** — `applyProvenanceForInsert()` in `takeoffMeasurementRoutes.ts` runs server-side; uses org's `takeoffReviewValueThreshold` from `organizations` table
- **Cross-module send-to-estimate** — `takeoffSendToEstimateRoutes.ts` creates estimate line items from selected measurements
- **AI Takeoff** — `server/aiTakeoffHelpers.ts` + `server/ai/providers/` calls vision model to detect measurements from plan images
- **BIM** — `bimRoutes.ts` handles IFC file uploads; `bimStoreyAssociations` links sheets to BIM model storeys
- **Scale constant** — `MEASUREMENT_NEEDS_REVIEW_DEFAULT_VALUE_THRESHOLD` and `MEASUREMENT_NEEDS_REVIEW_SNAP_RATIO_THRESHOLD` are exported from `@shared/schema`
