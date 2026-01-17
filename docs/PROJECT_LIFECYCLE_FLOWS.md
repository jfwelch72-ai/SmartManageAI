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
