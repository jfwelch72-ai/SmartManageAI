# Workflows & Entity Lifecycles

This document describes every workflow and entity lifecycle in the application. It covers statuses, valid transitions, role permissions, side effects (notifications, audit logs, conversions), and the flexible workflow engine.

**Source of truth**: Status enums are defined in `shared/schema/enums.ts`. Transition maps and business logic live in the corresponding route and service files (e.g., `server/bidRoutes2.ts`, `server/changeOrderHelpers.ts`, `server/payrollRoutes.ts`, `server/contractRoutes.ts`, `server/delayRoutes.ts`, `server/services/workflowEngine.ts`, `server/services/projectHealthService.ts`). If this document conflicts with the code, the code is authoritative.

---

## Table of Contents

1. [Bid Lifecycle](#1-bid-lifecycle)
2. [Project Lifecycle](#2-project-lifecycle)
3. [Estimate Lifecycle](#3-estimate-lifecycle)
4. [Change Order Lifecycle](#4-change-order-lifecycle)
5. [Pay Run (Payroll) Lifecycle](#5-pay-run-payroll-lifecycle)
6. [T&M Ticket and Billing Lifecycle](#6-tm-ticket-and-billing-lifecycle)
7. [Procurement Lifecycle](#7-procurement-lifecycle)
8. [Contract Lifecycle](#8-contract-lifecycle)
9. [Delay Tracking Lifecycle](#9-delay-tracking-lifecycle)
10. [Inspection Lifecycle](#10-inspection-lifecycle)
11. [Equipment Lifecycle](#11-equipment-lifecycle)
12. [Flexible Workflow Engine](#12-flexible-workflow-engine)
13. [Supporting Lifecycles](#13-supporting-lifecycles)
14. [Project Health Scoring](#14-project-health-scoring)

---

## 1. Bid Lifecycle

A bid represents a proposal for a construction project. It progresses from creation through submission to a final outcome.

### Statuses

| Status | Description |
|---|---|
| **DRAFT** | Bid is being prepared internally. Estimates, documents, and pricing are being assembled. |
| **ACTIVE** | Bid is finalized internally and ready for review or submission. |
| **SUBMITTED** | Bid has been sent to the client (optionally via email). |
| **AWARDED** | Client has accepted the bid. Terminal state (unless admin-overridden). |
| **LOST** | Client selected another contractor. Terminal state (unless admin-overridden). |
| **CANCELLED** | Bid was withdrawn or abandoned. Terminal state (unless admin-overridden). |

### Transition Map

| From | Allowed Transitions |
|---|---|
| DRAFT | ACTIVE, SUBMITTED, CANCELLED |
| ACTIVE | SUBMITTED, AWARDED, LOST, CANCELLED |
| SUBMITTED | AWARDED, LOST, CANCELLED |
| AWARDED | _(none — terminal)_ |
| LOST | _(none — terminal)_ |
| CANCELLED | _(none — terminal)_ |

### Admin Force-Override Transitions

Administrators can override terminal states to reopen bids:

| From | Admin Can Force To |
|---|---|
| AWARDED | ACTIVE |
| LOST | ACTIVE, DRAFT |
| CANCELLED | DRAFT |

### Email Submission Flow

1. User triggers the "Submit to Client" action on an ACTIVE or DRAFT bid.
2. System composes an HTML email with bid details (project name, reference code, amount, due date, location, description).
3. Email is sent to the client contact via SendGrid.
4. Bid status transitions to **SUBMITTED** and `submittedAt` timestamp is recorded.
5. An audit log entry is created.
6. Domain events `bid.submitted` and `bid.status_changed` are emitted.

### Bid-to-Project Conversion

A bid can be converted into a project while it is in any non-AWARDED status (DRAFT, ACTIVE, or SUBMITTED). Once converted, the bid status is set to **AWARDED** and the conversion endpoint blocks further conversions. The caller can choose the initial project status: **ACTIVE** (default) or **PLANNING**.

1. A new project is created with the bid's code, name, client information, budget, and location.
2. Estimates and line items are carried over to the project.
3. Selected subcontractor quotes are transferred as subcontractor contracts.
4. Selected material quotes are transferred.
5. Equipment selections become project equipment plans (status: PLANNED).
6. Bid documents are transferred to project plan documents.
7. A draft contract is auto-created for the project.
8. SOV (Schedule of Values) is seeded from the estimate.
9. Budget line items are seeded from the estimate breakdown.
10. Labor rates are seeded from job classifications.
11. Notifications are sent to assigned superintendent, project manager, project engineer, and foreman.
12. The bid record is updated with `convertedToProjectId`.
13. Audit log records `bid.converted_to_project`.

### Who Can Do What

| Action | Required Roles |
|---|---|
| Create / edit bid | ADMIN, MANAGER, ESTIMATOR |
| Change bid status | ADMIN, MANAGER, ESTIMATOR (transition rules enforced) |
| Force-override terminal status | ADMIN, SUPER_ADMIN (with `force: true` flag) |
| Submit via email | ADMIN, MANAGER, ESTIMATOR |
| Convert to project | ADMIN, MANAGER, ESTIMATOR |

---

## 2. Project Lifecycle

A project represents an active construction engagement, typically created from an awarded bid.

### Statuses

| Status | Description |
|---|---|
| **BID** | Project exists at the bid stage (not yet converted or in early planning). |
| **PLANNING** | Pre-construction phase: scheduling, procurement, crew assignment. Projects converted from bids can start here. |
| **ACTIVE** | Construction is underway. Time tracking, daily logs, and progress billing are active. This is the default starting status when converting a bid to a project. |
| **COMPLETE** | Substantial completion achieved. Punch list and closeout activities may still be in progress. |
| **CLOSED** | All work finished, final billing done, project archived. |

### Transition Map

| From | Allowed Transitions |
|---|---|
| BID | PLANNING |
| PLANNING | ACTIVE |
| ACTIVE | COMPLETE |
| COMPLETE | CLOSED |

### What Triggers Each Transition

| Transition | Trigger |
|---|---|
| BID → PLANNING | Manual action by project manager or admin. |
| PLANNING → ACTIVE | Manual action once pre-construction tasks are complete (contracts signed, schedule finalized, crews assigned). |
| ACTIVE → COMPLETE | Manual action when substantial completion is reached. |
| COMPLETE → CLOSED | Manual action after final punch list items are verified, retention is released, and final billing is complete. |

Note: When a bid is converted to a project, the project starts in either **ACTIVE** (default) or **PLANNING** — not BID. The BID status is primarily used for projects created independently that are still in the bidding stage.

### Side Effects

- Status changes emit `project.status_changed` domain events.
- Audit logs record every status change.
- Notifications are sent to assigned team members on key transitions.

---

## 3. Estimate Lifecycle

Estimates are detailed cost breakdowns attached to bids. They can go through an optional approval process.

### Statuses

| Status | Description |
|---|---|
| **DRAFT** | Estimate is being built. Line items, assemblies, and takeoff data are being added. |
| **SUBMITTED** | Estimate has been finalized and submitted for review. |
| **PENDING_APPROVAL** | Estimate is awaiting internal approval. |
| **APPROVED** | Estimate has been approved internally. |
| **REJECTED** | Estimate was rejected and needs revision. |
| **WON** | The bid containing this estimate was awarded. |
| **LOST** | The bid containing this estimate was not awarded. |

### Relationship to Bids and Projects

- Each estimate belongs to a bid (via `bidId`).
- A bid can have multiple estimates (e.g., different scope options).
- When a bid is converted to a project, the selected estimate's line items seed the project's budget and SOV.
- The estimate's total becomes the project's contract amount.

---

## 4. Change Order Lifecycle

Change orders track scope changes, price adjustments, and additional work on active projects.

### Statuses

| Status | Description |
|---|---|
| **DRAFT** | Change order is being prepared (legacy entry point). |
| **PCO** | Potential Change Order — initial identification of a scope change. |
| **PRICING_REVIEW** | PCO has been priced and is under internal review. |
| **PENDING_APPROVAL** | Legacy status (migrated to SUBMITTED in simplified workflow). |
| **SUBMITTED** | Change order has been submitted to the client for approval. |
| **APPROVED** | Client has approved the change order. Amount is added to project budget. |
| **REJECTED** | Client or internal reviewer rejected the change order. |
| **VOIDED** | Change order has been voided (cancelled after approval). |

### Transition Map (PCO Workflow)

| From | Allowed Transitions |
|---|---|
| PCO | PRICING_REVIEW, SUBMITTED |
| PRICING_REVIEW | SUBMITTED, PCO |
| SUBMITTED | APPROVED, REJECTED, PCO |
| APPROVED | VOIDED |
| REJECTED | PCO |
| VOIDED | _(terminal)_ |

### Transition Map (Legacy / Simplified Workflow)

| From | Allowed Transitions |
|---|---|
| DRAFT | SUBMITTED |
| PENDING_APPROVAL | SUBMITTED, DRAFT |

### Additional Action Endpoints

| Endpoint | From Status | To Status | Required Role |
|---|---|---|---|
| `/submit` | DRAFT, PCO, PRICING_REVIEW | SUBMITTED | ADMIN, MANAGER |
| `/approve` | SUBMITTED | APPROVED | ADMIN, MANAGER |
| `/reject` | SUBMITTED | REJECTED | ADMIN, MANAGER |
| `/promote-to-review` | PCO | PRICING_REVIEW | ADMIN, MANAGER, PROJECT_ENGINEER |
| `/approve-pricing` | PRICING_REVIEW | SUBMITTED | ADMIN, MANAGER |
| `/return-to-pco` | PRICING_REVIEW, SUBMITTED | PCO | ADMIN, MANAGER |
| `/void` | APPROVED | VOIDED | ADMIN |
| `/return-to-draft` | various | DRAFT | ADMIN, MANAGER |

### Approval Chain

Change orders support a multi-step approval chain:

1. When a change order is submitted, a default approval chain is auto-bootstrapped (one MANAGER step) if none exists.
2. Each approval step has an `approverRole` and optional specific `approverId`.
3. Steps are processed in order (`stepOrder`).
4. The `/approve-step` endpoint approves the current pending step.
5. When all steps are approved, the change order moves to **APPROVED**.
6. The `/reject-step` endpoint rejects at any step, reverting the CO to PCO or DRAFT.

### Side Effects on Approval

- Budget line items are updated — the approved CO amount is added to the relevant cost code.
- Revision history is recorded.
- Audit log entries are created.
- Notifications are sent to the requester and office managers.
- The approved CO is auto-synced to the SOV (Schedule of Values).
- If the flexible workflow engine is active for CHANGE_ORDER, it is started/delegated on submit and transition.

### Workflow Engine Integration

When a change order is submitted:
1. `workflowEngine.startWorkflow()` is called to create a workflow instance.
2. On approval, `workflowEngine.delegateEntityTransition()` checks for custom approval gates.
3. If the workflow requires more approvals, a 202 response is returned with `needsMoreApprovals: true`.
4. Only after all workflow approvals are satisfied does the CO status actually change.

---

## 5. Pay Run (Payroll) Lifecycle

Pay runs represent payroll processing cycles for a pay period.

### Statuses

| Status | Description |
|---|---|
| **DRAFT** | Pay run created, time entries are being reviewed and line items calculated. |
| **PENDING_APPROVAL** | Pay run submitted for management review. |
| **APPROVED** | Pay run approved by authorized personnel. Cost ledger entries are posted. |
| **PROCESSING** | Payment is being processed (e.g., ACH batch submitted). |
| **PAID** | All employees have been paid. Cost ledger entries are posted again (final). |
| **VOIDED** | Pay run was cancelled before or after processing. |
| **ARCHIVED** | Pay run moved to long-term storage. |

### Transition Map

| From | Allowed Transitions |
|---|---|
| DRAFT | PENDING_APPROVAL, VOIDED, ARCHIVED |
| PENDING_APPROVAL | APPROVED, DRAFT, VOIDED, ARCHIVED |
| APPROVED | PROCESSING, VOIDED, ARCHIVED |
| PROCESSING | PAID, VOIDED, ARCHIVED |
| PAID | ARCHIVED |
| VOIDED | ARCHIVED |
| ARCHIVED | _(terminal)_ |

### Role Restrictions for Privileged Transitions

The following transitions require elevated roles (**ADMIN**, **OFFICE_MANAGER**, or **SUPER_ADMIN**):

- → APPROVED
- → PROCESSING
- → PAID
- → VOIDED

Other transitions (e.g., DRAFT → PENDING_APPROVAL) can be performed by any user with payroll access.

### Side Effects

| Transition | Side Effect |
|---|---|
| → APPROVED | `approvedById` and `approvedAt` are set. Cost ledger postings are created in a database transaction. `payroll.run.completed` domain event is emitted. |
| → PAID | `paidAt` timestamp is set. Cost ledger postings are created. Payroll notifications are sent to employees. |
| Any | Audit log entry is created with old and new status. |

### Payroll Feature Gate

All payroll routes require the `canManagePayroll` feature permission, enforced via middleware.

---

## 6. T&M Ticket and Billing Lifecycle

Time & Material (T&M) tickets track extra work performed outside the original scope. They have their own approval flow and a separate billing overlay.

### Ticket Statuses

| Status | Description |
|---|---|
| **DRAFT** | Ticket is being filled out with labor hours, materials, and equipment used. |
| **SUBMITTED** | Ticket submitted for approval by supervisor or project manager. |
| **APPROVED** | Work has been verified and approved. |
| **REJECTED** | Ticket was rejected — needs correction or is invalid. |

### Billing Overlay Statuses

After a T&M ticket is approved, it enters the billing pipeline:

| Status | Description |
|---|---|
| **PENDING** | Approved ticket awaiting billing review. |
| **APPROVED_FOR_BILLING** | Ticket has been reviewed and marked ready to be invoiced. |
| **INVOICED** | An invoice has been generated from this ticket. |
| **BILLED** | Invoice has been sent to the client. |

### Invoice Statuses

T&M invoices generated from approved tickets:

| Status | Description |
|---|---|
| **DRAFT** | Invoice created but not yet sent. |
| **SENT** | Invoice has been sent to the client. |
| **PAID** | Payment received. |
| **CANCELLED** | Invoice was cancelled. |

### Flow Summary

```
Ticket: DRAFT → SUBMITTED → APPROVED
                           → REJECTED
                                ↓
Billing:               PENDING → APPROVED_FOR_BILLING → INVOICED → BILLED
                                                            ↓
Invoice:                                              DRAFT → SENT → PAID
                                                                    → CANCELLED
```

### Side Effects

- Notifications are sent when tickets are submitted (`TM_TICKET_SUBMITTED`), approved (`TM_TICKET_APPROVED`), and rejected (`TM_TICKET_REJECTED`).
- Auto-created invoice notifications (`TM_INVOICE_AUTO_CREATED`) are sent when invoices are generated.
- The workflow engine can be activated for `TM_TICKET` entity type.

---

## 7. Procurement Lifecycle

Procurement covers the full purchasing pipeline from internal requests through purchase orders to vendor invoice reconciliation.

### Procurement Item Statuses (Legacy)

Individual procurement items on a project have a simpler lifecycle:

| Status | Description |
|---|---|
| **PLANNED** | Item identified during planning/estimating. |
| **QUOTED** | Vendor quotes have been received. |
| **APPROVED** | Item procurement approved. |
| **ORDERED** | Item has been ordered from a vendor. |
| **DELIVERED** | Item received on site. |

### Purchase Request Statuses

| Status | Description |
|---|---|
| **DRAFT** | Request is being prepared by the requester. |
| **PENDING_APPROVAL** | Submitted for manager/procurement approval. |
| **APPROVED** | Request approved — ready to be converted to a purchase order. |
| **REJECTED** | Request denied. |
| **CONVERTED_TO_PO** | Request has been converted into a purchase order. |

### Purchase Order Statuses

| Status | Description |
|---|---|
| **DRAFT** | PO is being prepared with line items and vendor details. |
| **PENDING_APPROVAL** | PO submitted for approval. |
| **APPROVED** | PO approved internally. |
| **SENT** | PO has been transmitted to the vendor. |
| **ACKNOWLEDGED** | Vendor has confirmed receipt of the PO. |
| **PARTIAL** | Some items have been received. |
| **FULFILLED** | All items received and verified. |
| **CANCELLED** | PO was cancelled. |

### Vendor Invoice Statuses

| Status | Description |
|---|---|
| **PENDING** | Invoice received from vendor, awaiting processing. |
| **MATCHED** | Invoice has been matched against PO and receipt via 3-way match. |
| **APPROVED** | Invoice approved for payment. |
| **PAID** | Payment has been made to the vendor. |
| **DISPUTED** | Discrepancy found — under investigation. |

### 3-Way Match Flow

The 3-way match reconciles three documents to ensure accuracy before payment:

1. **Purchase Order** — What was ordered (items, quantities, unit costs).
2. **Receipt** — What was physically received (quantities, condition).
3. **Vendor Invoice** — What the vendor is billing.

The match process:
1. System compares invoice line items against PO line items and received quantities.
2. If all amounts and quantities align → the **invoice match** status becomes **MATCHED** and the vendor invoice status becomes **MATCHED**.
3. If discrepancies exist (price differences, quantity mismatches, unordered items) → the invoice match status becomes **DISCREPANCY**. The vendor invoice may be marked **DISPUTED** if the discrepancy requires investigation.
4. Discrepancies can be resolved by an authorized user (ADMIN, MANAGER, PROCUREMENT_MANAGER) via the `/match/resolve` endpoint, which forces the match status to **MATCHED**.
5. Only **MATCHED** or **APPROVED** vendor invoices can have payments recorded.

Note: "Invoice Match Status" (PENDING / MATCHED / DISCREPANCY) is a separate field from "Vendor Invoice Status" (PENDING / MATCHED / APPROVED / PAID / DISPUTED). The match status tracks the 3-way reconciliation result, while the vendor invoice status tracks the overall payment pipeline.

### Side Effects

- Notifications are sent for PR submissions, approvals, and rejections (`PROCUREMENT_PR_*`, `PROCUREMENT_PO_*`).
- The workflow engine can be activated for `PURCHASE_ORDER` and `PURCHASE_REQUEST` entity types.

---

## 8. Contract Lifecycle

Contracts formalize agreements between parties on a project.

### Statuses

| Status | Description |
|---|---|
| **DRAFT** | Contract is being drafted with terms, scope, and financial details. |
| **IN_REVIEW** | Contract sent for internal review. |
| **REDLINED** | Reviewers have marked up changes (redlines) that need resolution. |
| **PENDING_APPROVAL** | All redlines resolved; contract is awaiting final approval from designated reviewers. |
| **APPROVED** | Contract has been approved by all required reviewers. Ready for execution. |
| **EXECUTED** | Contract has been signed by all parties. It is now legally binding. |
| **AMENDED** | An amendment has been made to an executed contract, starting a new review cycle. |

### Transition Map

| From | Allowed Transitions |
|---|---|
| DRAFT | IN_REVIEW |
| IN_REVIEW | REDLINED, PENDING_APPROVAL, DRAFT |
| REDLINED | IN_REVIEW |
| PENDING_APPROVAL | APPROVED, REDLINED, IN_REVIEW |
| APPROVED | EXECUTED, PENDING_APPROVAL |
| EXECUTED | AMENDED |
| AMENDED | IN_REVIEW |

### Redline Resolution

1. Reviewers create redline entries with a description and optional section reference.
2. Each redline has a status: **OPEN**, **RESOLVED**, or **REJECTED**.
3. Redlines are resolved by providing a resolution note and marking them as RESOLVED.
4. A contract cannot move to PENDING_APPROVAL until all redlines are resolved.
5. Each redline action creates a version snapshot of the contract.

### Requesting Approval

Transitioning to PENDING_APPROVAL requires the `/request-approval` endpoint:

1. Caller provides an array of `reviewerIds` (at least one required).
2. Self-assignment is not allowed.
3. Reviewers must have eligible roles (SUPER_ADMIN, ADMIN, or MANAGER).
4. Each reviewer gets a contract approval record with decision **PENDING**.
5. Notifications are sent to each assigned reviewer.
6. The contract cannot be moved to APPROVED until all reviewers have approved.

### Approval Decisions

Each reviewer can:
- **APPROVE** — Records approval with timestamp. When all reviewers approve, contract status becomes APPROVED.
- **REJECT** — Records rejection with notes. Contract reverts to IN_REVIEW.

### Signature Request Flow

Once a contract is **APPROVED**, signatures can be requested:

| Signature Request Status | Description |
|---|---|
| **PENDING** | Request created but not yet sent. |
| **SENT** | Signature request sent to signers. |
| **PARTIALLY_SIGNED** | Some signers have signed, others are still pending. |
| **COMPLETED** | All signers have signed. Contract auto-transitions to EXECUTED. |
| **DECLINED** | One or more signers declined to sign. |
| **EXPIRED** | The signature request expired before completion. |

Individual signer statuses: **PENDING** → **SIGNED** or **DECLINED**.

When all signers have signed:
- The signature request status becomes **COMPLETED**.
- The contract automatically transitions to **EXECUTED**.
- `signatureDate` and `signatoryNames` are recorded on the contract.
- The contract value is synced to the project's `contractAmount`.

### Side Effects

- Every status change creates a new contract version snapshot.
- Domain events are emitted: `contract.created`, `contract.status_changed`, `contract.approved`, `contract.executed`, `contract.amended`, `contract.signature_requested`.
- When a contract is executed, its value updates the linked project's contract amount.

### Who Can Do What

| Action | Required Roles |
|---|---|
| View contracts | SUPER_ADMIN, ADMIN, MANAGER, SUPERINTENDENT, PROJECT_ENGINEER |
| Create / edit / transition contracts | SUPER_ADMIN, ADMIN, MANAGER |
| Approve/reject as reviewer | SUPER_ADMIN, ADMIN, MANAGER |
| Sign as signer | Any authenticated user (must match signer email) |

---

## 9. Delay Tracking Lifecycle

Delay tracking documents project delays, their causes, responsible parties, and associated claims.

### Delay Statuses

| Status | Description |
|---|---|
| **DRAFT** | Delay record created, being documented with evidence. |
| **SUBMITTED** | Delay report submitted for review by management. |
| **ACKNOWLEDGED** | Management has acknowledged the delay. |
| **RESOLVED** | Delay has been resolved (work resumed or schedule adjusted). |

### Delay Transition Map

| From | Allowed Transitions |
|---|---|
| DRAFT | SUBMITTED |
| SUBMITTED | DRAFT, ACKNOWLEDGED |
| ACKNOWLEDGED | RESOLVED |
| RESOLVED | _(terminal)_ |

### Delay Reason Categories

WEATHER, GC_SCHEDULING, OTHER_CONTRACTORS, MATERIAL_DELIVERY, PERMIT_ISSUES, INSPECTION_DELAY, OWNER_DIRECTIVE, DESIGN_CHANGES, SITE_CONDITIONS, LABOR_SHORTAGE, OTHER

### Financial Responsibility

Each delay assigns responsibility: **OWNER**, **GC** (General Contractor), **SUBCONTRACTOR**, **TFR** (Contractor Self), or **FORCE_MAJEURE**.

### Delay Claims

Delay claims formalize the financial and schedule impact of delays:

| Status | Description |
|---|---|
| **DRAFT** | Claim is being prepared with supporting documentation. |
| **SUBMITTED** | Claim submitted for review. |
| **UNDER_REVIEW** | Claim is being reviewed by the responsible party. |
| **APPROVED** | Claim approved — time extension or cost impact granted. |
| **REJECTED** | Claim denied. Can be returned to DRAFT for revision. |
| **CLOSED** | Claim fully resolved and closed. |

### Delay Claim Transition Map

| From | Allowed Transitions |
|---|---|
| DRAFT | SUBMITTED |
| SUBMITTED | DRAFT, UNDER_REVIEW |
| UNDER_REVIEW | APPROVED, REJECTED |
| APPROVED | CLOSED |
| REJECTED | DRAFT, CLOSED |
| CLOSED | _(terminal)_ |

### Claim Types

- **TIME_EXTENSION** — Request for additional days on the schedule.
- **COST_IMPACT** — Request for additional compensation.
- **BOTH** — Combined time and cost claim.

### Delay Notification Finalization

Delay notifications can be generated as formal PDF documents:

| Status | Description |
|---|---|
| **DRAFT** | Notification is being composed. |
| **FINALIZED** | Notification has been finalized and a PDF generated. |

### Side Effects

- **SUBMITTED**: Notifications sent to all ADMIN and MANAGER users, plus the project superintendent.
- **ACKNOWLEDGED**: Notification sent to the delay creator.
- If `changeOrderRequired` is flagged, additional notifications alert managers that a change order is needed.
- Weather evidence is automatically fetched from the Open-Meteo API when the delay reason is WEATHER.
- Audit logs record all status changes.

### Who Can Create Delays

Required roles: ADMIN, MANAGER, or SUPERINTENDENT.

### Supporting Features

- **Daily Report Locks**: Reports can be locked (UNLOCKED → LOCKED → SUPERVISOR_LOCKED) to prevent edits after submission. Only ADMIN/MANAGER can apply supervisor-level locks.
- **Photo Custody Records**: Chain-of-custody tracking for photographic evidence (actions: CAPTURED, UPLOADED, VIEWED, DOWNLOADED, ATTACHED_TO_CLAIM, EXPORTED).

---

## 10. Inspection Lifecycle

Inspections track formal reviews by city officials, GC representatives, or owner representatives.

### Inspection Statuses

| Status | Description |
|---|---|
| **REQUESTED** | Inspection has been requested (includes contact info, method, and notes). |
| **SCHEDULED** | Inspection date and time confirmed. |
| **PASSED** | Inspection passed — work approved to proceed. |
| **FAILED** | Inspection failed — deficiencies identified. May require reinspection. |
| **CANCELLED** | Inspection was cancelled. |

### Inspection Types

- CITY_OFFICIAL — Municipal code inspection
- GC_REPRESENTATIVE — General contractor quality review
- OWNER_REPRESENTATIVE — Owner's quality assurance check

### Request Methods

CALL, EMAIL, PORTAL, OTHER

### Punch List Items

Failed inspections generate punch list items that track remediation work:

| Status | Description |
|---|---|
| **OPEN** | Deficiency identified, assigned to a trade. |
| **IN_PROGRESS** | Remediation work is underway. |
| **RESOLVED** | Work completed by the responsible party. |
| **VERIFIED** | Resolution has been verified by the inspector/reviewer. |
| **REJECTED** | Resolution was inadequate — item returns to IN_PROGRESS. |

### Punch List Properties

- **Trade**: The responsible trade (GENERAL, ELECTRICAL, PLUMBING, HVAC, etc.)
- **Priority**: LOW, MEDIUM, HIGH, or CRITICAL
- **Location**: Where the deficiency is located on the project

---

## 11. Equipment Lifecycle

Equipment tracking covers owned and rented assets from availability through assignment to retirement.

### Equipment Statuses

| Status | Description |
|---|---|
| **AVAILABLE** | Equipment is ready for assignment to a project. |
| **ASSIGNED** | Equipment is currently deployed on a job site. |
| **IN_REPAIR** | Equipment is undergoing repair or maintenance. |
| **OUT_OF_SERVICE** | Equipment is temporarily unavailable (not retired). |
| **RETIRED** | Equipment permanently removed from the fleet. |

### Repair Statuses

When equipment enters IN_REPAIR, a repair record tracks the work:

| Status | Description |
|---|---|
| **PENDING** | Repair request submitted, waiting to be started. |
| **IN_PROGRESS** | Repair is actively being performed. |
| **COMPLETED** | Repair is finished — equipment can return to AVAILABLE. |
| **CANCELLED** | Repair was cancelled. |

### Maintenance Types

- PREVENTATIVE — Scheduled preventive maintenance (oil changes, filters)
- SCHEDULED_SERVICE — Major service intervals
- WEAR_ITEM — Consumable parts (tracks, tires, blades)
- INSPECTION — Safety inspections
- CALIBRATION — Precision equipment calibration

### Project Equipment Plan Statuses

Equipment assigned to projects (often carried over from bid equipment selections):

| Status | Description |
|---|---|
| **PLANNED** | Equipment identified during bidding, not yet assigned. |
| **ASSIGNED** | Owned equipment assigned to the project. |
| **RENTAL_BOOKED** | Rental equipment confirmed with a vendor. |
| **RENTAL_ACTIVE** | Rental period has started. |
| **COMPLETED** | Equipment work on the project is finished. |
| **CANCELLED** | Equipment plan cancelled — no longer needed. |

### Equipment Source

Each equipment plan item has a source: **OWNED** (company fleet) or **RENTAL** (from a vendor).

---

## 12. Flexible Workflow Engine

The workflow engine provides a configurable, template-based approval and routing system that overlays the standard entity lifecycles.

### Supported Entity Types

| Entity Type | Description |
|---|---|
| CHANGE_ORDER | Change order approval workflows |
| SOV_PAY_APP | Schedule of Values / pay application workflows |
| TIME_APPROVAL | Timesheet approval workflows |
| PURCHASE_ORDER | Purchase order approval workflows |
| PURCHASE_REQUEST | Purchase request approval workflows |
| VENDOR_BILL | Vendor bill approval workflows |
| TM_TICKET | T&M ticket approval workflows |

### How Templates Work

1. **An organization creates a workflow template** for an entity type (e.g., "Change Order Approval").
2. The template defines an ordered list of **stages**, each with:
   - A name and description
   - A stage order (determines sequence)
   - Whether it is the **initial** or **final** stage
   - A color for visual display
   - Allowed transitions to other stages
3. Only one template per entity type can be **ACTIVE** at a time per organization.
4. Template statuses: **DRAFT** (being designed), **ACTIVE** (in use), **INACTIVE** (disabled).

### Stages and Transitions

Each stage defines:
- **allowedTransitions**: An array of stage IDs that this stage can transition to.
- **isInitial**: If true, this is the starting stage when a workflow begins.
- **isFinal**: If true, reaching this stage completes the workflow.

Example stage sequence:
```
[Draft] → [Manager Review] → [Director Approval] → [Approved ✓]
                ↘ [Rejected ✗]
```

### Approval Gates

Stages can have **approval steps** that act as gates before a transition is allowed:

- Each step specifies either a **requiredRole** (e.g., "MANAGER") or a **requiredUserId** (a specific person).
- Each step has a **requiredApprovalCount** (default: 1).
- The total required approvals across all steps must be met before the transition proceeds.
- If a user approves but more approvals are still needed, their approval is recorded and a message indicates how many more are required (e.g., "Approval recorded (2/3). 1 more needed.").
- A user cannot approve the same stage twice.

### Notification Rules

Each stage can have notification rules that fire on **enter** or **exit**:

- **recipientRole**: Notify all users with a specific role.
- **recipientUserId**: Notify a specific user.
- **notifySubmitter**: Notify the person who initiated the workflow.
- **channel**: EMAIL, PUSH, SMS, SLACK, or TEAMS.
- **messageTemplate**: Custom notification message text.

### How `delegateEntityTransition` Works

When application code wants to change an entity's status (e.g., approving a change order), it calls `delegateEntityTransition`:

1. **Check for template**: Look up the active workflow template for this entity type and organization.
2. **If no template exists**: Return `{ delegated: false }` — the standard status change proceeds without workflow involvement.
3. **If template exists**:
   a. Find or create a workflow instance for this entity.
   b. Look up the current stage.
   c. Find the target stage by matching the requested status name to stage names.
   d. If only one allowed transition exists and no name match is found, use that single transition.
   e. Call `transitionStage` to attempt the move.
4. **If approval gates are not satisfied**: Return `{ needsMoreApprovals: true }` — the entity status is NOT changed yet.
5. **If transition succeeds**: Return `{ delegated: true, success: true }` — the entity status change proceeds.

### Workflow Instance Lifecycle

| Status | Description |
|---|---|
| **IN_PROGRESS** | Workflow is active, moving through stages. |
| **COMPLETED** | Workflow reached a final stage. |
| **CANCELLED** | Workflow was manually cancelled. |

Each instance maintains:
- **history**: An array of all stage transitions with timestamps, user IDs, and notes.
- **pendingApprovals**: Approval records for the current stage.

### Who Can Manage Templates

| Action | Required Roles |
|---|---|
| View templates | ADMIN, SUPER_ADMIN, MANAGER |
| Create / edit / delete templates | ADMIN, SUPER_ADMIN |
| Activate / deactivate templates | ADMIN, SUPER_ADMIN |
| Clone templates | ADMIN, SUPER_ADMIN |

---

## 13. Supporting Lifecycles

### CRM Pipeline Stages

Opportunities in the CRM system progress through:

| Stage | Description |
|---|---|
| **LEAD** | Initial contact or inbound inquiry. |
| **QUALIFIED** | Lead has been vetted and meets criteria. |
| **ESTIMATING** | Preparing a cost estimate for the opportunity. |
| **BID_SUBMITTED** | Formal bid has been submitted. |
| **NEGOTIATION** | Active negotiations with the client. |
| **WON** | Deal closed, contract expected. |
| **LOST** | Opportunity was not won. |

Side effects: `CRM_STAGE_CHANGE` notifications are sent. `CRM_IDLE_OPPORTUNITY` notifications alert salespeople when opportunities go stale.

### AI Task Statuses

AI-generated tasks from note analysis, email parsing, or project health insights:

| Status | Description |
|---|---|
| **PENDING** | Task identified by AI, awaiting human review. |
| **IN_PROGRESS** | User has accepted and is working on the task. |
| **COMPLETED** | Task finished. |
| **DISMISSED** | User dismissed the AI suggestion. |

### Leave Requests

| Status | Description |
|---|---|
| **PENDING** | Employee submitted a time-off request. |
| **APPROVED** | Manager approved the request. Calendar event created. |
| **DENIED** | Manager denied the request. |

Notifications: `LEAVE_APPROVED`, `LEAVE_DENIED`.

### Overtime Requests

| Status | Description |
|---|---|
| **PENDING** | Overtime request submitted. |
| **APPROVED** | Overtime approved by supervisor. |
| **REJECTED** | Overtime denied. |

Notifications: `OVERTIME_REQUESTED`, `OVERTIME_APPROVED`, `OVERTIME_REJECTED`.

### Shift Approvals

| Status | Description |
|---|---|
| **PENDING** | Time clock shift awaiting supervisor review. |
| **APPROVED** | Shift hours confirmed. |
| **REJECTED** | Shift rejected — needs correction. |

### Vendor Enrollment

| Status | Description |
|---|---|
| **PENDING** | Vendor has applied to join the platform. |
| **ACTIVE** | Vendor is approved and can receive POs and bid invitations. |
| **SUSPENDED** | Vendor temporarily suspended (compliance or performance issues). |
| **REJECTED** | Vendor application denied. |

### Pricebook Import Jobs

| Status | Description |
|---|---|
| **PENDING** | Import job queued. |
| **PROCESSING** | File is being parsed and validated. |
| **COMPLETED** | All items imported successfully. |
| **FAILED** | Import failed due to errors. |

### Subscription & Billing

| Status | Description |
|---|---|
| **trialing** | Organization is on a free trial period. |
| **active** | Subscription is active and current. |
| **past_due** | Payment is overdue. |
| **canceled** | Subscription has been cancelled. |
| **paused** | Subscription is temporarily paused. |

Plan tiers: **free** → **starter** → **professional** → **enterprise**.

### Bid Network (Sub Bidding)

**Bid Request Statuses**: DRAFT → OPEN → CLOSED → AWARDED → CANCELLED

**Bid Invitation Statuses**: PENDING → VIEWED → DECLINED or RESPONDED → WITHDRAWN

**Bid Response Statuses**: DRAFT → SUBMITTED → UNDER_REVIEW → SHORTLISTED → AWARDED or NOT_SELECTED → WITHDRAWN

### RFI Statuses

DRAFT → SUBMITTED → UNDER_REVIEW → FORWARDED → ANSWERED → CLOSED

### Submittal Statuses

DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED / APPROVED_AS_NOTED / REJECTED / REVISE_AND_RESUBMIT

### Warranty Cases

OPEN → ACKNOWLEDGED → IN_REPAIR → REPAIRED → CLOSED or REJECTED

### Hiring Pipeline

**Job Statuses**: DRAFT → PUBLISHED → PAUSED → ARCHIVED

**Candidate Stages**: APPLIED → SCREENED → REVIEW → PHONE_SCREEN → INTERVIEW → FINAL_REVIEW → OFFER → HIRED or REJECTED → ARCHIVED

---

## 14. Project Health Scoring

Project health scores provide an at-a-glance assessment of project performance across three weighted dimensions.

### Scoring Weights

| Factor | Weight | Description |
|---|---|---|
| **Cost** | 40% | Financial performance against budget |
| **Schedule** | 35% | Timeline adherence and completion progress |
| **Safety** | 25% | Safety incident rate and compliance |

### Overall Score

The overall score (0–100) is calculated as:

```
Overall = (Cost Score × 0.40) + (Schedule Score × 0.35) + (Safety Score × 0.25)
```

### Cost Score Calculation

The cost score starts at 100 and is reduced based on:

| Factor | Penalty |
|---|---|
| Budget variance < -20% | -50 points |
| Budget variance -20% to -10% | -35 points |
| Budget variance -10% to 0% | -20 points |
| Budget variance 0% to 5% | -10 points |
| Burn rate > 100% | -15 points |
| Burn rate 90–100% | -5 points |
| Committed ratio > 110% | -10 points |
| Committed ratio 100–110% | -5 points |

**Data sources**: Time entries (labor cost), procurement items (material cost), subcontractor payments, approved change orders, purchase orders, and cost ledger postings.

The adjusted budget = base budget + approved change order value.

### Schedule Score Calculation

The schedule score starts at 100 and is reduced based on:

| Factor | Penalty |
|---|---|
| Schedule variance < -30% | -50 points |
| Schedule variance -20% to -30% | -35 points |
| Schedule variance -10% to -20% | -20 points |
| Schedule variance -5% to -10% | -10 points |
| Failed inspections > 5 | -15 points |
| Failed inspections 3–5 | -8 points |
| Failed inspections 1–2 | -3 points |
| Reinspections > 3 | -10 points |
| Reinspections 1–3 | -5 points |
| Open punch items > 20 | -10 points |
| Open punch items 11–20 | -5 points |
| > 30 days overdue | -25 points |
| 15–30 days overdue | -15 points |
| 1–14 days overdue | -8 points |

**Data sources**: Project start/end dates, failed inspections, reinspection flags, and open punch list items.

### Safety Score Calculation

The safety score starts at 100 and is reduced based on:

| Factor | Penalty |
|---|---|
| Safety incidents > 5 (per project avg) | -30 points |
| Safety incidents 3–5 | -15 points |
| Safety incidents 1–2 | -5 points |
| Failed inspections > 5 | -20 points |
| Failed inspections 3–5 | -10 points |
| Failed inspections 1–2 | -5 points |
| AI-detected jobsite safety issues > 3 | -15 points |
| AI-detected jobsite safety issues 1–3 | -5 points |
| High-priority punch items > 5 | -10 points |
| High-priority punch items 1–5 | -5 points |

**Data sources**: Safety incidents (organization-wide, divided by active project count), failed inspections, jobsite analysis batches with safety findings, and high-priority punch list items.

### Trend Direction

The trend is determined by comparing the current score to the most recent historical snapshot:

| Score Change | Trend |
|---|---|
| +5 or more | **Improving** |
| -5 or more | **Declining** |
| Within ±5 | **Stable** |

### AI Insights

After calculating the score, an AI explanation is generated using GPT-4o. The prompt includes:
- Current and previous overall scores
- Sub-scores for cost, schedule, and safety
- Key factors driving each sub-score

The AI produces a 1–2 sentence natural-language explanation of what's driving the score up or down.

### Snapshots

Health scores are saved as **snapshots** with a date, enabling historical trend analysis. The system supports:
- Latest snapshot retrieval per project
- Historical snapshot retrieval (up to 30 records)
- Organization-wide health overview (latest score per active project)
- Portfolio health summary (averages, healthy/at-risk/critical counts, worst and declining projects)
