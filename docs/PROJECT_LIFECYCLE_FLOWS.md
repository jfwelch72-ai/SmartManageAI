# Project Lifecycle Flows

## Overview

This document details the end-to-end workflows in SmartManageAI, from lead capture through project closeout. Each flow includes the actors involved, system actions, and data flow.

---

## Flow 1: Lead → Estimate → Proposal → Award

### Overview
The bidding process starts with a lead (opportunity) and ends with either winning or losing the work.

### Actors
- **Estimator** - Primary bid owner
- **Manager** - Approval authority
- **GC/Client** - Bid recipient

### Step-by-Step Flow

```
Step 1: Create Bid
├── Actor: Estimator
├── Screen: /bids/new (Bid Wizard) or /bids → New Bid
├── Actions:
│   ├── Enter project name, GC info, bid date
│   ├── Upload bid documents (optional)
│   └── AI analyzes documents (if uploaded)
├── Endpoint: POST /api/bids
├── Table: bids (status: DRAFT)
└── Output: New bid record with unique code

Step 2: Develop Estimate
├── Actor: Estimator
├── Screen: /bids/:code/estimate
├── Actions:
│   ├── Add line items (manual or from scope library)
│   ├── Enter quantities, labor hours, rates
│   ├── Apply material costs
│   ├── Set markup percentages
│   └── Use AI suggestions for production rates
├── Endpoints:
│   ├── POST /api/estimates/:id/line-items
│   ├── PUT /api/estimates/:id/line-items/:lineItemId
│   ├── GET /api/estimates/production-rates/suggestions
│   └── GET /api/estimates/production-rates/by-sow-item/:sowItemId (historical rates)
├── Tables: estimates, estimateLineItems
├── SOW Tracking: When adding line items via "Guided Selection" mode in the
│   HierarchicalLineItemBuilder, the organizationSowItemId is captured and
│   stored with the line item. This enables cross-project production rate
│   aggregation for future bids using the same scope of work items.
└── Output: Complete estimate with pricing and SOW item links

Step 3: Perform Takeoff (if plans available)
├── Actor: Estimator
├── Screen: /bids/:code (Takeoff Workspace component)
├── Actions:
│   ├── Upload plan PDFs
│   ├── Set scale
│   ├── Draw measurements (linear, area, count)
│   ├── Use AI Auto-Takeoff for automation
│   └── Import quantities to estimate
├── Endpoints:
│   ├── POST /api/projects/:id/plans
│   ├── POST /api/ai/takeoff/analyze
│   └── POST /api/estimates/:id/import-takeoff
├── Tables: projectPlans, takeoffMeasurements
└── Output: Quantities linked to estimate line items

Step 4: Collect Subcontractor Quotes
├── Actor: Estimator
├── Screen: /bids/:code (Quotes section)
├── Actions:
│   ├── Add sub quotes for work packages
│   ├── Enter vendor, scope, amount
│   └── Compare multiple quotes
├── Endpoints:
│   ├── POST /api/bids/:code/quotes
│   └── GET /api/bids/:code/quotes
├── Table: bidSubcontractorQuotes
└── Output: Sub quotes attached to bid

Step 5: Collect Material Quotes
├── Actor: Estimator
├── Screen: /bids/:code (Material Quotes section)
├── Actions:
│   ├── Add material quotes from vendors
│   ├── Link to estimate line items
│   └── Track vendor pricing
├── Endpoints:
│   ├── POST /api/bids/:code/material-quotes
│   └── GET /api/bids/:code/material-quotes
├── Table: bidMaterialQuotes
└── Output: Material pricing attached to bid

Step 6: Review & Submit Bid
├── Actor: Estimator, Manager
├── Screen: /bids/:code
├── Actions:
│   ├── Review final pricing
│   ├── Generate proposal PDF (if needed)
│   ├── Update bid status to SUBMITTED
│   └── Record submission details
├── Endpoints: PATCH /api/bids/:code
├── Table: bids (status: SUBMITTED)
└── Output: Bid marked as submitted

Step 7: Track Result
├── Actor: Estimator
├── Screen: /bids/:code
├── Actions:
│   ├── Update status when result known
│   ├── WON: Proceed to project conversion
│   └── LOST: Archive and record reason
├── Endpoints: PATCH /api/bids/:code
├── Table: bids (status: WON or LOST)
└── Output: Bid result recorded

Step 8: Convert to Project (if won)
├── Actor: Manager, Estimator
├── Screen: /bids/:code → Convert button
├── Actions:
│   ├── Confirm project details
│   ├── Set project dates
│   ├── Assign superintendent
│   └── System creates project from bid data
├── Endpoint: POST /api/bids/:code/convert
├── Tables: projects (new), bids (linked), scopeItems (created from estimate)
├── SOW Tracking: During conversion, estimateLineItems with organizationSowItemId
│   are copied to scopeItems, preserving the organizationSowItemId link. This
│   maintains the chain: estimateLineItems → scopeItems for production tracking.
└── Output: New project created, estimate copied, scope items with SOW links
```

---

## Flow 2: Award → Project Setup → Assign Team → Schedule Baseline

### Overview
After winning a bid, the project is set up for execution with team assignments and scheduling.

### Actors
- **Manager** - Project setup
- **Superintendent** - Field leadership
- **Office Manager** - Administrative setup

### Step-by-Step Flow

```
Step 1: Create/Review Project
├── Actor: Manager
├── Screen: /projects/:code
├── Actions:
│   ├── Verify project converted from bid correctly
│   ├── Update any missing details
│   ├── Set budget and contract amount
│   └── Update status to PLANNING
├── Endpoints: PATCH /api/projects/:code
├── Table: projects
└── Output: Project in PLANNING status

Step 2: Assign Team
├── Actor: Manager
├── Screen: /projects/:code (Job Information form)
├── Actions:
│   ├── Assign Superintendent
│   ├── Assign project team members
│   └── Set roles and responsibilities
├── Endpoints: PATCH /api/projects/:code
├── Table: projects (superintendentId)
└── Output: Team assigned

Step 3: Setup Scope Items
├── Actor: Manager, Superintendent
├── Screen: /projects/:code (Scope section)
├── Actions:
│   ├── Review scope from estimate
│   ├── Add additional scope items
│   ├── Set quantities and units
│   └── Establish baseline for tracking
├── Endpoints:
│   ├── GET /api/projects/:code/scope-items
│   └── POST /api/projects/:code/scope-items
├── Table: scopeItems
└── Output: Trackable scope items

Step 4: Setup Material Budgets
├── Actor: Manager
├── Screen: /projects/:code (Material Budget component)
├── Actions:
│   ├── Import budgets from estimate
│   ├── Set quantity thresholds
│   ├── Configure alerts
├── Endpoints: POST /api/projects/:code/material-budgets
├── Table: projectMaterialBudgets
└── Output: Material budgets with alert thresholds

Step 5: Configure Labor Rates
├── Actor: Office Manager
├── Screen: /cost-rates
├── Actions:
│   ├── Set project-specific labor rates
│   ├── Assign prevailing wage rates if applicable
│   └── Configure overtime rules
├── Endpoints: POST /api/projects/:code/labor-rates
├── Table: projectLaborRates, projectEmployeeRates
└── Output: Labor cost tracking configured

Step 6: Activate Project
├── Actor: Manager
├── Screen: /projects/:code
├── Actions:
│   ├── Final review of setup
│   ├── Update status to ACTIVE
│   └── Notify team of project start
├── Endpoints: PATCH /api/projects/:code
├── Table: projects (status: ACTIVE)
├── Notification: PROJECT_ASSIGNMENT sent to team
└── Output: Project ready for execution
```

---

## Flow 3: Daily Execution → Timeclock → Daily Report → Quantities → Budget Updates

### Overview
Day-to-day project execution workflow including time tracking, progress reporting, and cost updates.

### Actors
- **Field Workers** - Time entry, basic work
- **Superintendent** - Approvals, daily notes
- **Office Manager** - Payroll processing

### Step-by-Step Flow

```
Step 1: Clock In
├── Actor: Field Worker
├── Screen: /time-clock
├── Actions:
│   ├── Select project
│   ├── Clock in (GPS captured)
│   └── Start work
├── Endpoint: POST /api/time-clock/clock-in
├── Tables: timeClockShifts, timeClockEvents
└── Output: Active shift record

Step 2: Perform Work
├── Actor: Field Worker, Superintendent
├── Actions:
│   ├── Execute scope items
│   ├── Track materials used
│   └── Document issues/observations
└── Output: Physical work completed

Step 3: Daily Notes Entry
├── Actor: Superintendent
├── Screen: /projects/:code (Daily Note Feed)
├── Actions:
│   ├── Enter daily observations
│   ├── Note weather conditions
│   ├── Document crew activities
│   ├── Record any issues
│   └── AI analyzes for insights
├── Endpoints: POST /api/projects/:code/notes
├── Tables: projectNotes, aiNoteInsights
└── Output: Daily notes with AI insights

Step 4: Quantity Progress Entry
├── Actor: Superintendent
├── Screen: /projects/:code (Scope Progress section)
├── Actions:
│   ├── Enter quantities installed today
│   ├── Select scope items worked
│   ├── Assign to crew
│   └── Add progress notes
├── Endpoints: POST /api/projects/:code/daily-progress
├── Table: dailyScopeProgress
├── SOW Tracking: When creating a daily progress entry, the organizationSowItemId
│   is automatically inherited from the parent scopeItem. This completes the
│   tracking chain: estimateLineItems → scopeItems → dailyScopeProgress, enabling
│   accurate production rate aggregation across all projects using the same SOW item.
└── Output: Progress recorded, production rates captured with SOW item link

Step 5: Clock Out
├── Actor: Field Worker
├── Screen: /time-clock
├── Actions:
│   ├── Clock out (GPS captured)
│   ├── System calculates hours
│   └── Check for overtime
├── Endpoint: POST /api/time-clock/clock-out
├── Table: timeClockShifts (updated)
└── Output: Completed shift with hours

Step 6: Shift Approval
├── Actor: Superintendent
├── Screen: /time-clock-manager
├── Actions:
│   ├── Review pending shifts
│   ├── Verify hours and projects
│   ├── Approve or reject with notes
│   └── Make adjustments if needed
├── Endpoints: PATCH /api/time-clock/shifts/:id/approve
├── Table: timeClockShifts (approvalStatus: APPROVED)
├── Automation: Check if week complete → generate payroll report
└── Output: Approved time for payroll

Step 7: Budget Updates
├── Actor: System (automatic)
├── Actions:
│   ├── Labor costs calculated from approved time
│   ├── Material usage updated
│   ├── Budget variance recalculated
│   └── Alerts triggered if thresholds exceeded
├── Tables: projectMaterialUsage, project labor tracking
├── Notifications: MATERIAL_OVERAGE if threshold exceeded
└── Output: Real-time budget status
```

---

## Flow 4: Materials Needed → Alerts → PO/Order → Delivery → Tracking

### Overview
Material procurement and consumption tracking workflow.

### Actors
- **Superintendent** - Identifies needs
- **Office Manager** - Processes orders
- **PM** - Approves purchases

### Step-by-Step Flow

```
Step 1: Material Need Identified
├── Actor: Superintendent, System
├── Trigger:
│   ├── Manual identification during work
│   ├── Budget threshold alert (90%+ consumed)
│   └── AI analysis recommendation
├── Tables: projectMaterialBudgets (alertTriggered)
└── Output: Material need logged

Step 2: Alert Generated
├── Actor: System
├── Condition: Material budget ≥ 90% consumed
├── Actions:
│   ├── Set alertTriggered flag
│   ├── Create notification for PM
│   └── Include in AI PM analysis
├── Notification: MATERIAL_OVERAGE
└── Output: Stakeholders notified

Step 3: Procurement Request
├── Actor: Superintendent, Office Manager
├── Screen: /projects/:code
├── Actions:
│   ├── Identify needed materials
│   ├── Check vendor pricing
│   ├── Create procurement item
├── Endpoints: POST /api/projects/:code/procurement
├── Table: procurementItems (status: PLANNED)
└── Output: Procurement request created

Step 4: Vendor Quote & Order
├── Actor: Office Manager
├── Actions:
│   ├── Request vendor quotes
│   ├── Select best option
│   ├── Create purchase order
│   ├── Update status to ORDERED
├── Endpoints: PATCH /api/procurement/:id
├── Table: procurementItems (status: ORDERED)
└── Output: Order placed

Step 5: Delivery & Receipt
├── Actor: Superintendent
├── Screen: /projects/:code
├── Actions:
│   ├── Receive delivery
│   ├── Verify quantities
│   ├── Update status to DELIVERED
│   └── Document with photos
├── Endpoints: PATCH /api/procurement/:id
├── Table: procurementItems (status: DELIVERED)
└── Output: Materials received

Step 6: Consumption Tracking
├── Actor: Superintendent
├── Screen: /projects/:code (Material Budget)
├── Actions:
│   ├── Log materials used daily
│   ├── Update actual quantities
│   └── System recalculates budgets
├── Endpoints: POST /api/projects/:code/material-usage
├── Table: projectMaterialUsage
└── Output: Real-time material tracking
```

---

## Flow 5: Delay Occurs → Log → Notice → Response → Impact

### Overview
Delay documentation and notification workflow critical for claims and schedule management.

### Actors
- **Superintendent** - Documents delays
- **PM** - Manages notifications
- **GC/Owner Rep** - Acknowledges delays

### Step-by-Step Flow

```
Step 1: Delay Occurs
├── Actor: Field observation
├── Common Causes:
│   ├── Weather conditions
│   ├── GC scheduling issues
│   ├── Other contractor interference
│   ├── Material delivery problems
│   ├── Inspection delays
│   └── Owner/design changes

Step 2: Document Delay
├── Actor: Superintendent
├── Screen: /projects/:code (Delays section)
├── Actions:
│   ├── Select delay reason
│   ├── Enter date and duration
│   ├── Describe impact
│   ├── Identify responsible party
│   ├── Attach photos/evidence
│   └── Save delay record
├── Endpoint: POST /api/delays
├── Table: projectDelays (status: DRAFT)
└── Output: Delay record created

Step 3: Submit Delay Notice
├── Actor: PM, Superintendent
├── Screen: /projects/:code (Delays section)
├── Actions:
│   ├── Review delay details
│   ├── Generate formal notice
│   ├── Select recipients (GC, Owner Rep)
│   ├── Send notification
│   └── Update status to SUBMITTED
├── Endpoints:
│   ├── POST /api/delays/:id/notifications
│   └── PATCH /api/delays/:id
├── Tables: projectDelays (SUBMITTED), delayNotifications
└── Output: Formal notice sent

Step 4: Track Response
├── Actor: System, PM
├── Screen: /projects/:code (Delays section)
├── Actions:
│   ├── Monitor for GC response
│   ├── System sends reminders if no response (48hrs)
│   ├── Log acknowledgment when received
│   └── Update status to ACKNOWLEDGED
├── Automation: Reminder if unacknowledged after 48 hours
├── Table: projectDelays (status: ACKNOWLEDGED)
└── Output: Response tracked

Step 5: Assess Impact
├── Actor: PM
├── Actions:
│   ├── Calculate schedule impact
│   ├── Calculate cost impact
│   ├── Determine if change order needed
│   └── Create delay claim if warranted
├── Endpoint: POST /api/delay-claims
├── Tables: delayClaims
├── Notification: DELAY_CHANGE_ORDER_NEEDED
└── Output: Impact documented

Step 6: Delay Claim (if applicable)
├── Actor: PM
├── Screen: /delay-claims
├── Actions:
│   ├── Create claim linking delays
│   ├── Request time extension
│   ├── Request cost recovery
│   ├── Attach supporting evidence
│   └── Submit claim
├── Endpoints:
│   ├── POST /api/delay-claims
│   └── PATCH /api/delay-claims/:id
├── Table: delayClaims
└── Output: Formal claim submitted
```

---

## Flow 6: T&M Work → Ticket → Approval → Invoice

### Overview
Time & Material work outside the original contract scope.

### Actors
- **Superintendent** - Creates tickets
- **GC/Client Rep** - Signs tickets
- **Office Manager** - Invoices

### Step-by-Step Flow

```
Step 1: Extra Work Requested
├── Actor: GC Rep, Client
├── Trigger: Work requested outside contract scope
└── Output: Verbal or written request

Step 2: Create T&M Ticket
├── Actor: Superintendent
├── Screen: /projects/:code (T&M Tickets section)
├── Actions:
│   ├── Create ticket with description
│   ├── Enter work date
│   ├── Add labor entries (hours, rates)
│   ├── Add equipment entries
│   ├── Add material entries
│   └── Calculate totals
├── Endpoint: POST /api/tm-tickets
├── Tables: tmTickets, tmTicketLaborEntries, tmTicketEquipmentEntries, tmTicketMaterialEntries
└── Output: Draft T&M ticket

Step 3: Field Signature
├── Actor: Superintendent, GC/Client Rep
├── Screen: /projects/:code (T&M Ticket detail)
├── Actions:
│   ├── Review ticket details
│   ├── GC rep signs on device
│   ├── Capture signature data
│   └── Update status to SUBMITTED
├── Endpoint: PATCH /api/tm-tickets/:id
├── Table: tmTickets (signatureData, status: SUBMITTED)
└── Output: Signed T&M ticket

Step 4: Approval
├── Actor: PM, Office Manager
├── Screen: /projects/:code or admin view
├── Actions:
│   ├── Review submitted ticket
│   ├── Verify rates and quantities
│   ├── Approve for billing
│   └── Update status to APPROVED
├── Endpoint: PATCH /api/tm-tickets/:id
├── Table: tmTickets (status: APPROVED)
└── Output: Approved for invoicing

Step 5: Invoice Generation
├── Actor: Office Manager
├── Screen: /schedule-of-values or billing
├── Actions:
│   ├── Generate invoice from T&M ticket
│   ├── Include supporting documentation
│   └── Submit to GC/Client
├── Tables: Related billing records
└── Output: T&M invoice submitted
```

---

## Flow 7: Closeout → Punchlist → Final Billing → Archive

### Overview
Project completion and closeout workflow.

### Actors
- **Superintendent** - Field closeout
- **PM** - Administrative closeout
- **Office Manager** - Final billing

### Step-by-Step Flow

```
Step 1: Substantial Completion
├── Actor: Superintendent
├── Screen: /projects/:code
├── Actions:
│   ├── Verify all scope items complete
│   ├── Request substantial completion inspection
│   ├── Document remaining punchlist items
├── Table: projects, projectInspections
└── Output: Substantial completion reached

Step 2: Punchlist Management
├── Actor: Superintendent
├── Screen: /projects/:code (Tasks or dedicated punchlist)
├── Actions:
│   ├── Create punchlist items
│   ├── Assign to crew/team
│   ├── Track completion
│   ├── Document with photos
│   └── Close items when done
├── Tables: tasks or scope tracking
└── Output: Punchlist completed

Step 3: Final Inspection
├── Actor: Superintendent
├── Screen: /projects/:code (Inspections)
├── Actions:
│   ├── Schedule final inspection
│   ├── Prepare documentation
│   ├── Complete inspection
│   └── Record results
├── Endpoint: POST /api/projects/:code/inspections
├── Table: projectInspections
└── Output: Final inspection passed

Step 4: Final Billing
├── Actor: Office Manager
├── Screen: /schedule-of-values
├── Actions:
│   ├── Complete final SoV billing
│   ├── Release retainage (if applicable)
│   ├── Generate final invoice
│   └── Submit to GC/Client
├── Tables: SoV records, billing events
└── Output: Final payment requested

Step 5: Collect Final Payment
├── Actor: Office Manager
├── Actions:
│   ├── Track payment receipt
│   ├── Record in system
│   └── Update project status
├── Table: Projects, billing records
└── Output: Payment received

Step 6: Project Closure
├── Actor: PM
├── Screen: /projects/:code
├── Actions:
│   ├── Review all records
│   ├── Generate closeout reports
│   ├── Capture lessons learned
│   ├── Update status to COMPLETE
│   └── Archive project
├── Endpoint: PATCH /api/projects/:code
├── Table: projects (status: COMPLETE → CLOSED)
└── Output: Project archived

Step 7: Post-Project Analysis
├── Actor: System, PM
├── Actions:
│   ├── Calculate final profitability
│   ├── Capture production rates
│   ├── Update vendor scores
│   └── Feed data to AI for learning
├── Tables: Production rates, vendor scores
└── Output: Historical data captured
```

---

## Flow 8: AIA Pay Application (SoV → Draft → Status → Record Payment)

### Overview
The AIA progress billing workflow drives monthly (or milestone-based) payment cycles on general building and vertical construction projects. It produces the industry-standard AIA G702 Application and Certificate for Payment together with the G703 Continuation Sheet, and records each payment against an append-only audit trail.

### Actors
- **Office Manager / PM** — Creates and submits pay applications
- **GC / Owner Rep** — Reviews and approves
- **System** — Calculates totals, generates PDFs, emits audit events

### Step-by-Step Flow

```
Step 1: Set Up Schedule of Values (SoV)
├── Actor: Office Manager / PM
├── Screen: /schedule-of-values
├── Actions:
│   ├── Create SoV header for the project (contract value, retainage %)
│   ├── Add G703 line items with scheduled values
│   ├── Link approved Change Orders to SoV
│   └── Save baseline (SoV is the source of truth for all billing)
├── Endpoints:
│   ├── POST /api/sov
│   └── POST /api/sov/:id/items
├── Tables: schedule_of_values, sov_line_items, change_orders
└── Output: SoV approved and ready for first billing period

Step 2: Update SoV Progress for the Billing Period
├── Actor: Office Manager / PM
├── Screen: /schedule-of-values
├── Actions:
│   ├── Enter "Work Completed This Period" quantities per line
│   ├── Enter "Materials Presently Stored" if applicable
│   └── System recalculates cumulative % complete per line
├── Endpoints:
│   ├── PATCH /api/sov/:sovId/line-items/:lineItemId
│   └── POST /api/aia-billing/stored-materials
├── Tables: sov_line_items, stored_materials
└── Output: Current-period progress reflected in G703

Step 3: Create Draft Pay Application (G702)
├── Actor: Office Manager / PM
├── Screen: /schedule-of-values → "New Pay Application"
├── Actions:
│   ├── System auto-assigns next sequential application number
│   ├── System rolls forward balances from previous approved application
│   ├── System pulls in all approved Change Orders into contract sum
│   ├── System calculates: contract sum to date, total earned,
│   │   retainage withheld, previous certificates, current payment due
│   └── Draft record created
├── Endpoint: POST /api/aia-billing/pay-applications
├── Tables: pay_applications (status: DRAFT), sov_line_items (snapshot)
├── Audit: logCreate (entity: pay_application)
└── Output: Draft G702 with calculated current payment due

Step 4: Sync Totals (Optional Recalculation)
├── Actor: Office Manager / PM (after any last-minute SoV edits)
├── Actions:
│   └── Trigger recalculation to pull latest sov_line_items into the draft
├── Endpoint: POST /api/aia-billing/pay-applications/:id/sync-totals
├── Table: pay_applications (totals refreshed)
└── Output: Draft totals match current SoV state

Step 5: Submit Application
├── Actor: Office Manager / PM
├── Screen: Pay Application detail
├── Actions:
│   ├── Review G702 / G703 PDFs
│   ├── Update status to SUBMITTED
│   └── System emits event to notify GC / Owner Rep
├── Endpoint: PATCH /api/aia-billing/pay-applications/:id/status
├── Table: pay_applications (status: SUBMITTED)
├── Audit: logUpdate (status change captured in newValue)
├── Event: aia_pay_application.submitted (triggers notifications)
└── Output: Application formally submitted for review

Step 6: GC / Owner Review
├── Actor: GC / Owner Rep (may use client-portal link)
├── Actions:
│   ├── Review G702 and G703 PDFs
│   │   ├── GET /api/aia-billing/pay-applications/:id/g702-pdf
│   │   └── GET /api/aia-billing/pay-applications/:id/g703-pdf
│   ├── Approve → status: APPROVED
│   └── Reject → status: REJECTED (rejectionReason captured); a subsequent
│       PATCH moves the record from REJECTED → DRAFT to allow revision
├── Endpoint: PATCH /api/aia-billing/pay-applications/:id/status
├── Table: pay_applications (status: APPROVED or REJECTED)
├── Audit:
│   ├── APPROVED path: logApprove (entity: pay_application)
│   └── REJECTED path: logUpdate (rejectionReason in newValue)
└── Output: Certificate of Payment issued (approved) or application returned
    to REJECTED for correction then DRAFT for revision and resubmit

Step 7: Record Payment Receipt
├── Actor: Office Manager / PM
├── Screen: Pay Application detail → "Record Payment"
├── Actions:
│   ├── Enter amount received, payment date, reference number
│   └── System updates paid_amount, sets status to PAID
├── Endpoint: POST /api/aia-billing/pay-applications/:id/record-payment
├── Tables: pay_applications (status: PAID, paid_amount), sov_payments,
│          unified_payments
├── Audit: logUpdate (PAID status + payment metadata in newValue)
├── Event: payment.received
└── Output: Payment recorded; retainage balance updated for next period
```

### Key Audit Events
| Action | Trigger | audit_log entity |
|--------|---------|-----------------|
| `CREATE` | Draft pay application created | `pay_application` |
| `UPDATE` | Status transitions (any) | `pay_application` |
| `APPROVE` | Status set to `APPROVED` | `pay_application` |
| `UPDATE` | Payment recorded (status → `PAID`) | `pay_application` |

### Status State Machine
```
DRAFT ──────────────────────────────────────────────┐
  ↑                                                  ↓
REJECTED ← SUBMITTED ⇄ UNDER_REVIEW → APPROVED → PAID → ARCHIVED
               ↑                ↑
               └────────────────┘  (back to SUBMITTED from UNDER_REVIEW)
```
Valid transitions (enforced by validPayAppStatusTransitions):
- DRAFT        → SUBMITTED
- SUBMITTED    → APPROVED | REJECTED | UNDER_REVIEW
- UNDER_REVIEW → APPROVED | REJECTED | SUBMITTED
- REJECTED     → DRAFT  (revise and resubmit)
- APPROVED     → (terminal; payment recorded separately)
- PAID         → ARCHIVED

---

## Flow 9: DOT Heavy Civil Billing (Scope → Pay Item Matching → Haul Tickets → Progress Estimate)

### Overview
DOT/Heavy Civil projects are billed against a state or federal agency pay item schedule rather than a traditional SoV. Field data (haul tickets, daily inspector reports) is captured, reconciled to DOT pay items, rolled up into `sov_line_items`, and packaged into a formal Progress Estimate PDF for agency submittal.

### Actors
- **Operator / Driver** — Creates haul tickets in the field
- **Inspector** — Authors Daily Inspector Reports (IDR); verifies quantities
- **PM / Office Manager** — Matches items, reviews progress billing
- **Agency (DOT)** — Reviews and certifies the Progress Estimate
- **System** — Aggregates haul quantities, generates PDFs, emits audit events

### Step-by-Step Flow

```
Step 1: Define Project Scope with DOT Pay Items
├── Actor: PM / Estimator
├── Screen: /projects/:code (Heavy Civil scope setup)
├── Actions:
│   ├── Search DOT pay item library (FHWA codes or state-specific)
│   ├── Match bid line items to official DOT pay item numbers
│   ├── Set contract quantities and unit prices per item
│   └── Create SoV line items tied to DOT pay item codes
├── Endpoints:
│   ├── GET /api/dot/pay-items (search global library)
│   └── POST /api/sov/:id/items (create project-specific items)
├── Tables: dot_pay_items (reference), sov_line_items
└── Output: Project pay item schedule aligned to agency contract

Step 2: Capture Field Work — Haul Tickets
├── Actor: Operator / Driver (mobile or tablet)
├── Screen: /haul-tickets → New Ticket
├── Actions:
│   ├── Select project and pay item (links to dot_pay_items)
│   ├── Enter quantity, unit, load source, destination stations
│   ├── Select hauler vendor (crm_organisations)
│   ├── Record unit cost
│   └── Submit ticket
├── Endpoints:
│   ├── POST /api/haul-tickets
│   └── GET /api/haul-tickets (filter by project / pay item)
├── Tables: haul_tickets (links: dot_pay_items, crm_organisations)
├── Event: haul_ticket.submitted
└── Output: Field quantity record linked to DOT pay item

Step 3: Inspector Verification — Daily Inspector Report (IDR)
├── Actor: Inspector
├── Screen: /daily-inspector-reports → New IDR
├── Actions:
│   ├── Record work performed per station
│   ├── Log crew count and equipment deployed
│   ├── Verify and reconcile haul ticket quantities
│   ├── Add remarks for agency record
│   └── Submit IDR
├── Endpoint: POST /api/daily-inspector-reports
├── Tables: daily_inspector_reports
├── Event: daily_inspector_report.submitted
└── Output: Verified daily record ready for supervisor approval

Step 4: Approve IDR and Confirm Quantities
├── Actor: Inspector supervisor / PM
├── Actions:
│   ├── Review submitted IDR
│   ├── Approve verified quantities (or request revision if corrections needed)
│   └── Approved status locks the quantities for billing aggregation
├── Endpoints (workflow-aware lifecycle actions):
│   ├── POST /api/daily-inspector-reports/:id/approve   (approve)
│   ├── POST /api/daily-inspector-reports/:id/reject    (returns to REVISED)
│   └── POST /api/daily-inspector-reports/:id/request-revision (back to inspector)
│   Inspector re-submits via: POST /api/daily-inspector-reports/:id/submit
├── Tables: daily_inspector_reports (status: APPROVED)
├── Event: daily_inspector_report.approved
└── Output: Approved daily quantities available for billing aggregation

Step 5: Mass-Haul Analysis (Heavy Earthwork Projects)
├── Actor: PM / Engineer (as needed)
├── Screen: /projects/:code (Mass Haul section)
├── Actions:
│   ├── System aggregates approved haul tickets into cut/fill series
│   └── Review mass-haul curve for overhaul/underhaul analysis
├── Endpoint: GET /api/dot/mass-haul/:projectId/series
├── Tables: haul_tickets (aggregated by station range)
└── Output: Mass-haul balance data for quantity verification

Step 6: Roll Up Quantities to SoV Line Items
├── Actor: System / PM
├── Actions:
│   ├── Aggregate approved IDR quantities per DOT pay item
│   ├── Update sov_line_items.thisPeriodCompleted for open billing period
│   ├── Carry forward sov_line_items.previouslyCompleted from last approved
│   │   pay application
│   └── Calculate totalCompletedAndStored per line
├── Tables: sov_line_items (thisPeriodCompleted, previouslyCompleted,
│          totalCompletedAndStored updated)
└── Output: G703-equivalent quantities ready for billing

Step 7: Create Progress Estimate (Pay Application)
├── Actor: PM / Office Manager
├── Screen: /schedule-of-values → "New Pay Application"
├── Actions:
│   ├── System snapshots sov_line_items state for the period
│   ├── System calculates contract amount earned, retainage, balance
│   └── Draft pay application created (same engine as AIA Flow 8)
├── Endpoint: POST /api/aia-billing/pay-applications
├── Tables: pay_applications (status: DRAFT), sov_line_items
├── Audit: logCreate (entity: pay_application)
└── Output: Draft Progress Estimate with DOT pay item breakdown

Step 8: Submit for Agency Review
├── Actor: PM
├── Actions:
│   ├── Update status to SUBMITTED
│   ├── Generate DOT Progress Estimate PDF (grouped by spec section)
│   └── Transmit PDF to agency for certification
├── Endpoints:
│   ├── PATCH /api/aia-billing/pay-applications/:id/status
│   └── GET /api/dot/progress-estimates/:payApplicationId/pdf
├── Tables: pay_applications (status: SUBMITTED → APPROVED)
├── Audit: logUpdate (status transitions)
├── Event: aia_pay_application.submitted
└── Output: Progress Estimate PDF delivered to DOT for certification

Step 9: Agency Certifies and Payment Received
├── Actor: Agency (external); Office Manager records receipt
├── Actions:
│   ├── Agency certifies quantities and payment amount
│   ├── Office Manager records payment in system
│   └── Status updated to PAID; retainage balance carried forward
├── Endpoint: POST /api/aia-billing/pay-applications/:id/record-payment
├── Tables: pay_applications (status: PAID), unified_payments
├── Audit: logUpdate (PAID status + payment metadata)
├── Event: payment.received
└── Output: Payment posted; cumulative quantities locked for next period
```

### Key Audit Events
| Action | Trigger | audit_log entity |
|--------|---------|-----------------|
| `CREATE` | Draft pay application created | `pay_application` |
| `UPDATE` | IDR / haul ticket status changes | `daily_inspector_report` |
| `UPDATE` | Pay application status transitions | `pay_application` |
| `APPROVE` | Pay application approved by agency | `pay_application` |
| `UPDATE` | Payment recorded (status → `PAID`) | `pay_application` |

### DOT-Specific PDF Outputs
- **Progress Estimate PDF** (`GET /api/dot/progress-estimates/:payApplicationId/pdf`) — quantities grouped by spec section for agency submittal.
- **G702 / G703 PDFs** — same endpoints as AIA flow; used when the agency accepts AIA format.

---

## Key Tables by Flow

| Flow | Primary Tables |
|------|----------------|
| Bidding | bids, estimates, estimateLineItems, bidSubcontractorQuotes, bidMaterialQuotes |
| Project Setup | projects, scopeItems, projectMaterialBudgets, projectLaborRates |
| Daily Execution | timeClockShifts, projectNotes, dailyScopeProgress, projectMaterialUsage |
| Procurement | procurementItems, vendors |
| Delays | projectDelays, delayNotifications, delayClaims |
| T&M | tmTickets, tmTicketLaborEntries, tmTicketEquipmentEntries, tmTicketMaterialEntries |
| Closeout | projectInspections, SoV records, tasks |
| AIA Pay Application | schedule_of_values, sov_line_items, pay_applications, stored_materials, sov_payments, unified_payments, change_orders |
| DOT Heavy Civil Billing | haul_tickets, daily_inspector_reports, dot_pay_items, sov_line_items, pay_applications, unified_payments |

---

## Unified SOW Tracking System

### Purpose
The Unified SOW (Scope of Work) Tracking System ensures that scope items remain consistently linked across the entire project lifecycle, enabling accurate cross-project production rate aggregation for future bids.

### The Tracking Chain

```
organizationSowItems (Master Scope Library)
         │
         ▼ organizationSowItemId
┌─────────────────────────────────────────────────────────┐
│ estimateLineItems                                       │
│ - Created during bid estimation                         │
│ - organizationSowItemId captured via HierarchicalLine   │
│   ItemBuilder "Guided Selection" mode                   │
└─────────────────────────────────────────────────────────┘
         │
         ▼ Bid-to-Project Conversion (propagates link)
┌─────────────────────────────────────────────────────────┐
│ scopeItems                                              │
│ - Created during project conversion                     │
│ - organizationSowItemId inherited from estimate         │
└─────────────────────────────────────────────────────────┘
         │
         ▼ Daily Progress Entry (inherits link)
┌─────────────────────────────────────────────────────────┐
│ dailyScopeProgress                                      │
│ - Created during daily quantity tracking                │
│ - organizationSowItemId inherited from scopeItem        │
└─────────────────────────────────────────────────────────┘
         │
         ▼ Production Rate Aggregation
┌─────────────────────────────────────────────────────────┐
│ Production Rate Analysis                                │
│ - Aggregates all dailyScopeProgress entries             │
│   with same organizationSowItemId across ALL projects   │
│ - Provides historical productivity data for future bids │
└─────────────────────────────────────────────────────────┘
```

### API Endpoint

**GET /api/estimates/production-rates/by-sow-item/:sowItemId**

Returns aggregated production rate data for a specific scope of work item across all projects.

**Query Parameters:**
- `organizationId` (required for super-admin, otherwise uses user's org)

**Response:**
```json
{
  "sowItemId": "uuid",
  "dataPoints": 15,
  "avgLaborHoursPerUnit": 2.5,
  "avgLaborCostPerUnit": 75.00,
  "avgMaterialCostPerUnit": 45.00,
  "avgTotalCostPerUnit": 120.00,
  "confidence": "HIGH"
}
```

### Backward Compatibility
All `organizationSowItemId` fields are nullable to maintain compatibility with existing data created before this feature was implemented. New estimates using "Guided Selection" will automatically capture the SOW item link.
