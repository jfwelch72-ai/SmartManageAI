# document-control — RFIs, Submittals, Transmittals, Drawing Sets, Contracts, Closeout Packages

## Overview

Document control manages the formal document exchange workflows required on construction projects. **RFIs** (Requests for Information) track questions and responses between the GC and design team. **Submittals** manage approval of shop drawings and product data. **Transmittals** provide a formal cover letter for document packages. **Drawing sets** version-control plan documents with revision history and markup pins. **Contracts** include redlines, approvals, e-signature, and a clause library. **Closeout packages** bundle all required handoff documents (warranties, O&M manuals, as-builts, punch lists) into a ZIP export.

## Data Models

**Key tables (`shared/schema/features/rfi.ts`, `shared/schema/features/contracts.ts`, `shared/schema/features/closeout.ts`, `shared/schema/features/drawings.ts`)**

| Table | Description |
|---|---|
| `rfis` | `rfiNumber`, `projectId`, `subject`, `question`, `response`, `status` (OPEN/RESPONDED/CLOSED), `dueDate`, `submittedById`, `assignedToId`, `respondedAt` |
| `submittals` | `submittalNumber`, `projectId`, `title`, `specSection`, `status` (PENDING/SUBMITTED/UNDER_REVIEW/APPROVED/REJECTED/REVISE_RESUBMIT), `dueDate` |
| `submittal_items` | File attachments within a submittal package |
| `transmittals` | `transmittalNumber`, `projectId`, `sentTo`, `subject`, `description`, `deliveryMethod`, `transmittalDate` |
| `transmittal_items` | Documents included in a transmittal |
| `drawing_sets` | `projectId`, `setNumber`, `revisionDate`, `description`, `status` |
| `plan_document_markups` | Markup annotations (pins, shapes, comments) on plan documents |
| `plan_pins` | Location-linked pins on plan sheets |
| `document_revisions` | Revision history for any project document |
| `contracts` | `projectId`, `type`, `status` (DRAFT/UNDER_REVIEW/APPROVED/EXECUTED), `value`, `startDate`, `endDate`, `signedAt`, `signedByIds` |
| `contract_clauses` | Individual contract clauses linked to a contract |
| `clause_library_items` | Org-level reusable clause library |
| `closeout_packages` | Closeout package per project: `status`, `dueDate`, `completionPercent` |
| `closeout_items` | Individual checklist items: `category`, `title`, `status`, `requiredDocumentType`, `documentId` |
| `closeout_templates` | Org-level closeout checklist templates |
| `addenda` | Design addenda tracking: `number`, `date`, `description`, `affectedScopeItems` |
| `punch_list_items` | Deficiency punch list: `location`, `trade`, `description`, `status`, `assignedTo`, `dueDate` |
| `warranty_items` | Warranty tracking: `equipment`, `startDate`, `expiryDate`, `vendor`, `documentUrl` |

## Backend Routes

**File: `server/rfiRoutes.ts`**
| Method | Path | Description | Auth |
|---|---|---|---|
| GET | `/api/rfis` | Lists RFIs for org | `requireAuth` |
| POST | `/api/rfis` | Creates RFI | `requireAuth` |
| GET | `/api/rfis/:id` | RFI detail | `requireAuth` |
| PATCH | `/api/rfis/:id` | Updates RFI | `requireAuth` |
| POST | `/api/rfis/:id/respond` | Records response | `requireAuth` |
| POST | `/api/rfis/:id/close` | Closes RFI | `requireRole('ADMIN','MANAGER')` |

**File: `server/submittalRoutes.ts`**
| Method | Path | Description |
|---|---|---|
| GET | `/api/submittals` | Lists submittals |
| POST | `/api/submittals` | Creates submittal |
| PATCH | `/api/submittals/:id/status` | Status transition |
| POST | `/api/submittals/:id/items` | Adds document to submittal |

**File: `server/transmittalRoutes.ts`** — transmittal CRUD

**File: `server/drawingSetRoutes.ts`** — drawing set management:
| Method | Path | Description |
|---|---|---|
| GET | `/api/projects/:id/drawing-sets` | Lists drawing sets |
| POST | `/api/projects/:id/drawing-sets` | Creates drawing set |
| PATCH | `/api/projects/:id/drawing-sets/:setId` | Updates set |

**File: `server/planPinsRoutes.ts`** — plan pins and markups

**File: `server/planDocumentMarkupRoutes.ts`** — markup annotations

**File: `server/documentRevisionRoutes.ts`** — document revision history

**File: `server/contractRoutes.ts`** — contracts + e-signature:
| Method | Path | Description |
|---|---|---|
| GET | `/api/contracts` | Lists contracts |
| POST | `/api/contracts` | Creates contract |
| PATCH | `/api/contracts/:id` | Updates contract |
| POST | `/api/contracts/:id/sign` | Records e-signature |
| POST | `/api/contracts/:id/send-for-signature` | Initiates signing workflow |

**File: `server/clauseLibraryRoutes.ts`** — clause library management

**File: `server/closeoutRoutes.ts`** — closeout packages:
| Method | Path | Description |
|---|---|---|
| GET | `/api/closeout/packages` | Lists closeout packages |
| POST | `/api/closeout/packages/:id/export-zip` | Generates ZIP with TOC |
| POST | `/api/closeout/auto-pull` | Auto-populates package from project documents |

**File: `server/addendaRoutes.ts`** — addenda tracking

**File: `server/punchListRoutes.ts`** — punch list items

**File: `server/warrantyRoutes.ts`** — warranty tracking

## Frontend Pages & Components

Document control surfaces primarily through the project detail page tabs:
- **RFI tab** — RFI list, create, respond
- **Submittals tab** — submittal workflow board
- **Documents tab** — drawing sets, plan viewer with markup
- **Contracts tab** — contract list, clause builder
- **Closeout tab** — closeout checklist and export

## Roles & Permissions

| Action | Gate |
|---|---|
| Create/manage RFIs | `requireAuth` + org project access |
| Manage contracts | `canManageContracts` — ADMIN, MANAGER, SUPERINTENDENT |
| Use AI contract analysis | `canUseAiContractAnalysis` |
| Manage drawing sets | `requireRole('ADMIN','MANAGER','ESTIMATOR')` |
| Create closeout package | `requireRole('ADMIN','MANAGER','SUPERINTENDENT')` |

## Integration Points

- **Object storage** — all document uploads stored in GCS under `${orgId}/uploads/`; download via signed URLs from `server/objectStorage.ts`
- **AI contract analysis** — `canUseAiContractAnalysis` feature gates AI analysis of uploaded contract PDFs via `aiDocumentRoutes.ts`
- **Distribution lists** — `projectDistributionListRoutes.ts` manages email distribution lists used for RFI/submittal notifications
- **Project log email schedules** — `projectLogEmailScheduleRoutes.ts` sends daily project log digests
- **Approval workflow** — `approvalRoutes.ts` provides a generic multi-step approval workflow used by submittals and contracts
- **Closeout ZIP** — `closeoutRoutes.ts` generates a ZIP archive with a generated table-of-contents PDF; stored temporarily in GCS for download
