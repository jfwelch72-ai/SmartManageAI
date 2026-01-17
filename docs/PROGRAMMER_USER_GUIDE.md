# Programmer User Guide

**For Developers, QA Testers, and Product Engineers with Zero Construction Background**

---

## Table of Contents
1. [What This App Does (Plain English)](#section-1--what-this-app-does-plain-english)
2. [Mental Model](#section-2--mental-model)
3. [Core Modules & Expectations](#section-3--core-modules--expectations)
4. ["Real Enough" Test Data Examples](#section-4--real-enough-test-data-examples)
5. [What Correct Behavior Looks Like](#section-5--what-correct-behavior-looks-like)
6. [Common Programmer Mistakes](#section-6--common-programmer-mistakes)

---

## Section 1 — What This App Does (Plain English)

### What Contractors Actually Do Day-to-Day

Construction companies are project-based businesses. Unlike a store that sells products, contractors:

1. **Bid on work** - A general contractor (GC) or building owner asks "How much to pour this concrete parking lot?" The contractor estimates costs and submits a price.

2. **Win or lose the bid** - If their price is competitive, they get the job. This is called "being awarded the project."

3. **Execute the work** - Workers show up to the jobsite, use materials and equipment, and build what was promised.

4. **Track everything** - Hours worked, materials used, problems encountered, progress made.

5. **Bill for completed work** - Monthly (or more often), they submit invoices for work completed.

6. **Handle surprises** - Weather delays, design changes, unexpected conditions. All documented and often result in change orders (extra payment).

### Why estimates → jobs → time → costs → billing Must Connect

This is the **money trail**. If these don't connect:

| Break Point | What Goes Wrong |
|-------------|-----------------|
| Estimate disconnected from project | Can't compare "what we thought" vs "what happened" |
| Time not linked to project | Labor costs can't be calculated |
| Materials not tracked | Don't know if over/under budget until too late |
| Progress not logged | Can't bill for work done |
| Delays not documented | Can't get paid for extra time |

**The fundamental equation:**
```
Revenue (what we bill) - Costs (labor + materials + equipment) = Profit
```

If any piece is missing or wrong, the company can't know if they're making money.

### What Breaks When Data is Missing

| Missing Data | Downstream Failure |
|--------------|-------------------|
| No organization ID on record | Multi-tenant leak (data visible to wrong company) |
| No project assigned to time entry | Labor cost can't be calculated per job |
| No estimate on bid | Can't create project with baseline budget |
| No scope items on project | Can't track progress or production rates |
| No approval on time entry | Payroll reports incomplete |
| No quantities on materials | Can't calculate cost per unit |
| No organizationSowItemId on estimate line item | Can't aggregate production rates across projects |
| organizationSowItemId not propagated to scope item | Breaks the SOW tracking chain (estimate → project) |
| organizationSowItemId not inherited by daily progress | Historical production data disconnected from master SOW item |

---

## Section 2 — Mental Model

### The Hierarchy

```
ORGANIZATION (The Company)
    │
    ├── PROJECTS (Jobs they're working on)
    │       │
    │       ├── ESTIMATES (What they thought it would cost)
    │       │       └── Line Items (individual cost components)
    │       │
    │       ├── BUDGETS (Planned costs for tracking)
    │       │       ├── Labor Budget
    │       │       └── Material Budgets
    │       │
    │       ├── SCHEDULE (When things happen)
    │       │       ├── Start/End dates
    │       │       └── Inspections
    │       │
    │       ├── DAILY WORK (What actually happened)
    │       │       ├── Time Clock Shifts (labor hours)
    │       │       ├── Daily Notes (observations)
    │       │       ├── Scope Progress (quantities installed)
    │       │       └── Material Usage (what was consumed)
    │       │
    │       ├── COSTS (Money spent)
    │       │       ├── Labor Costs (hours × rates)
    │       │       ├── Material Costs (purchases)
    │       │       └── Equipment Costs (owned/rented)
    │       │
    │       └── BILLING (Money collected)
    │               ├── Schedule of Values (billing line items)
    │               ├── Progress Billing (% complete)
    │               └── Change Orders (extra work)
    │
    ├── BIDS (Jobs they want to win)
    │       ├── Estimates
    │       ├── Takeoffs (measurements from plans)
    │       └── Vendor Quotes
    │
    ├── USERS (Employees with roles)
    │
    ├── CRM (External contacts)
    │       ├── Clients/Owners
    │       ├── General Contractors
    │       ├── Subcontractors
    │       └── Vendors/Suppliers
    │
    └── EQUIPMENT (Owned machinery)
```

### Data Flow Summary

```
BID created
    ↓
ESTIMATE built (costs calculated)
    ↓
BID won → PROJECT created (estimate copied)
    ↓
SCOPE ITEMS set up → MATERIAL BUDGETS created
    ↓
Work begins...
    ↓
DAILY: Workers CLOCK IN → Work → Log QUANTITIES → CLOCK OUT
    ↓
SUPERINTENDENT approves time entries
    ↓
COSTS calculated (labor hours × rates + materials)
    ↓
BILLING submitted (based on % complete)
    ↓
Project completes → CLOSEOUT
```

---

## Section 3 — Core Modules & Expectations

### CRM (Customer Relationship Management)

**What the user THINKS they're doing:**
"I'm adding a new vendor we'll buy materials from."

**What must exist first:**
- Organization (auto-created at signup)

**What should update after saving:**
- CRM organization appears in vendor selection dropdowns
- Contact records can be added
- Vendor pricing can be linked

**Key Tables:** `crmOrganisations`, `crmContacts`

---

### Estimating

**What the user THINKS they're doing:**
"I'm figuring out how much this job will cost us so I can set a price."

**What must exist first:**
- A bid (or project) to attach the estimate to
- Trade-specific scope items (system provides defaults)

**What should update after saving:**
- Estimate total calculated (labor + materials + markup)
- Line items visible on bid/project
- Can be used for project baseline when bid converts

**Key Tables:** `estimates`, `estimateLineItems`

**Calculation Logic:**
```
Line Item Total = (Labor Hours × Labor Rate) + Material Cost + Equipment Cost
Markup Amount = Line Item Total × Markup Percent
Final Price = Line Item Total + Markup + Tax
```

---

### Project Setup

**What the user THINKS they're doing:**
"We won the job, now I'm setting it up so the field can start."

**What must exist first:**
- Bid with status "WON" (if converting), OR
- Manual project creation with required fields

**What should update after saving:**
- Project appears in project list
- Scope items created (from estimate or trade defaults)
- Material budgets initialized
- Team assignments enable access

**Key Tables:** `projects`, `scopeItems`, `projectMaterialBudgets`

---

### Timeclock

**What the user THINKS they're doing:**
"I'm logging when I started and stopped work today."

**What must exist first:**
- User account assigned to organization
- Active project to clock into
- GPS/location access (for coordinates)

**What should update after saving:**
- Shift record created with status PENDING
- Clock-in/out events logged with GPS
- Hours calculated on clock-out
- Shift appears in manager approval queue

**Key Tables:** `timeClockShifts`, `timeClockEvents`

**Critical:** Without project assignment, labor cost can't be attributed.

---

### Daily Reports (Notes & Progress)

**What the user THINKS they're doing:**
"I'm writing down what happened on the job today."

**What must exist first:**
- Active project
- Scope items (for progress tracking)

**What should update after saving:**
- Note visible in daily note feed
- AI analyzes note for insights (if enabled)
- Progress quantities update scope completion %
- Production rates captured (qty ÷ labor hours)

**Key Tables:** `projectNotes`, `dailyScopeProgress`, `aiNoteInsights`

---

### Materials

**What the user THINKS they're doing:**
"I'm tracking what materials we're using and if we're over budget."

**What must exist first:**
- Project with material budgets set up
- Budget thresholds configured

**What should update after saving:**
- Material usage recorded
- Budget remaining recalculated
- Alert triggered if > 90% consumed
- Notification sent to PM

**Key Tables:** `projectMaterialBudgets`, `projectMaterialUsage`

**Alert Logic:**
```
If (quantityUsed / quantityBudgeted) >= 0.90:
    Set alertTriggered = true
    Create MATERIAL_OVERAGE notification
```

---

### Equipment

**What the user THINKS they're doing:**
"I'm tracking our equipment, where it is, and when it needs maintenance."

**What must exist first:**
- Organization

**What should update after saving:**
- Equipment appears in fleet list
- Assignment to project tracked
- Utilization calculated
- Maintenance schedule visible

**Key Tables:** `equipment`, maintenance tables

---

### Budgeting

**What the user THINKS they're doing:**
"I'm comparing what we estimated vs. what we're actually spending."

**What must exist first:**
- Project with estimate (baseline)
- Time entries with approvals (labor costs)
- Material usage records (material costs)

**What should update after showing:**
- Variance calculations (budget - actual)
- Percent complete
- Projected final cost

**Key Concept:** Budget comes from estimate. Actual comes from tracked time/materials.

---

### Delays

**What the user THINKS they're doing:**
"I'm documenting that we couldn't work today because of rain."

**What must exist first:**
- Active project

**What should update after saving:**
- Delay record with reason, date, responsible party
- Hours lost tracked
- If submitted, notification sent to GC/owner
- 48-hour reminder if not acknowledged
- Can escalate to delay claim (time/cost request)

**Key Tables:** `projectDelays`, `delayNotifications`, `delayClaims`

**Critical:** Delays without documentation = no legal protection or payment.

---

### T&M (Time & Material Tickets)

**What the user THINKS they're doing:**
"Extra work was requested, I'm documenting exactly what we did for billing."

**What must exist first:**
- Active project
- Labor rates configured
- Equipment rates (if equipment used)

**What should update after saving:**
- T&M ticket with labor, equipment, material entries
- Total cost calculated
- Signature capture (from GC/client on-site)
- When approved, feeds into billing

**Key Tables:** `tmTickets`, `tmTicketLaborEntries`, `tmTicketEquipmentEntries`, `tmTicketMaterialEntries`

---

### Photos

**What the user THINKS they're doing:**
"I'm uploading a photo of the work we did."

**What must exist first:**
- Project

**What should update after saving:**
- Photo stored (Google Cloud Storage)
- Metadata captured (timestamp, GPS, uploader)
- If custody chain enabled, hash and events logged
- AI analysis can identify issues (if feature enabled)

**Key Tables:** `media`, `photoCustodyRecords`

---

### AI Modules

**What the user THINKS they're doing:**
"I want the AI to analyze my projects and tell me what needs attention."

**What must exist first:**
- Organization with AI add-on enabled
- Active projects with data (more data = better analysis)
- AI settings configured

**What should update after saving/running:**
- AI run record created
- Tasks generated based on analysis
- Insights created with severity levels
- Recommendations visible on dashboard

**Key Tables:** `aiRuns`, `aiTasks`, `aiInsights`

**Modules:** AI PM, AI CFO, AI Scheduler, AI Auto-Takeoff, AI Email Classifier, AI Contract Analysis

---

## Section 4 — "Real Enough" Test Data Examples

### Project Names
```
PRJ-2024-001  Walmart Supercenter Parking Lot Expansion
PRJ-2024-002  Riverside Medical Office Building Foundation
PRJ-2024-003  Highway 101 Bridge Deck Repair
PRJ-2024-004  Amazon Warehouse Loading Dock Concrete
PRJ-2024-005  Sunset Ridge HOA Sidewalk Replacement
```

### Quantities (Scope Items)
| Scope Item | Quantity | Unit |
|------------|----------|------|
| 4" Concrete Flatwork | 2,500 | SF |
| 6" Reinforced Slab | 1,200 | SF |
| Excavation | 450 | CY |
| #4 Rebar Grid | 8,500 | LF |
| Concrete Placement | 185 | CY |
| Wire Mesh 6x6 W1.4 | 2,500 | SF |
| Saw Cut Joints | 1,800 | LF |
| Form & Pour Curb | 350 | LF |

### Labor Hours (Time Entries)
| Employee | Project | Date | Clock In | Clock Out | Hours |
|----------|---------|------|----------|-----------|-------|
| Mike Johnson | PRJ-2024-001 | 2024-06-10 | 06:00 | 14:30 | 8.5 |
| Steve Torres | PRJ-2024-001 | 2024-06-10 | 06:00 | 16:00 | 10.0 |
| Dave Wilson | PRJ-2024-002 | 2024-06-10 | 07:00 | 15:30 | 8.5 |
| Carlos Ruiz | PRJ-2024-002 | 2024-06-10 | 07:00 | 17:00 | 10.0 |

### Equipment Usage
| Equipment | Project | Date | Hours Used | Notes |
|-----------|---------|------|------------|-------|
| Bobcat S650 Skid Steer | PRJ-2024-001 | 2024-06-10 | 6.0 | Grading for forms |
| Concrete Pump Trailer | PRJ-2024-002 | 2024-06-11 | 4.0 | Pour placement |
| Ford F-350 Flatbed | PRJ-2024-001 | 2024-06-10 | 8.0 | Material delivery |

### Delays
| Project | Date | Reason | Hours Lost | Description |
|---------|------|--------|------------|-------------|
| PRJ-2024-001 | 2024-06-12 | WEATHER | 8.0 | Rain from 6am, job too wet to pour concrete |
| PRJ-2024-002 | 2024-06-14 | GC_SCHEDULING | 4.0 | GC had electricians in our work area until noon |
| PRJ-2024-003 | 2024-06-15 | INSPECTION_DELAY | 2.0 | Inspector no-show, rescheduled to afternoon |

### Daily Reports
```
Date: June 10, 2024
Project: PRJ-2024-001 Walmart Parking Lot
Weather: Sunny, 78°F
Crew: 4 workers

Work performed:
- Set forms on gridlines A1 through A8 (200 LF)
- Placed and tied rebar in sections 1-3
- Received concrete delivery (45 CY) from ABC Concrete

Issues:
- Forms on A5 needed shim due to grade discrepancy
- Running low on wire mesh, ordered additional 1,000 SF

Tomorrow:
- Pour section 1-4 (planned 60 CY)
- Continue form work on gridlines B1-B8
```

### T&M Ticket
```
Ticket #: TM-2024-0042
Project: PRJ-2024-002
Date: June 11, 2024
Description: GC requested additional 50 SF of sidewalk not in original scope

Labor:
  - Foreman (2 hrs @ $85/hr) = $170.00
  - Finisher (3 hrs @ $65/hr) = $195.00
  
Materials:
  - Concrete 0.5 CY @ $150/CY = $75.00
  - Forms rental = $25.00
  
Equipment:
  - Vibrator 1 hr @ $15/hr = $15.00

Total: $480.00
Signed by: John Smith (GC Rep)
```

---

## Section 5 — What Correct Behavior Looks Like

### Downstream Updates

| User Action | Expected System Response |
|-------------|-------------------------|
| Bid status → WON | Convert button appears |
| Convert bid to project | Project created with estimate data, scope items generated |
| Clock in | Shift record created (PENDING), GPS captured |
| Clock out | Hours calculated, appears in approval queue |
| Approve shift | Shift status → APPROVED, check if week complete |
| All week's shifts approved | Weekly payroll report auto-generated, office notified |
| Log daily progress (50 SF) | Scope item progress updated, production rate calculated |
| Material usage > 90% budget | Alert flag set, notification created for PM |
| Submit delay | Status → SUBMITTED, notification to GC, 48hr reminder queued |
| GC acknowledges delay | Status → ACKNOWLEDGED, logged |
| Create T&M ticket with signature | Ticket SUBMITTED, visible for billing |
| Run AI analysis | AI run created, tasks/insights generated |
| Change order approved | Contract amount updated, notification to PM |

### Notifications Generated

| Trigger | Notification Type | Recipient |
|---------|------------------|-----------|
| Shift approved (week complete) | PAYROLL_READY | Office Manager |
| Material > 90% | MATERIAL_OVERAGE | PM |
| Change order submitted | CHANGE_ORDER_PENDING | Approvers |
| Delay submitted | DELAY_SUBMITTED | PM |
| Delay acknowledged | DELAY_ACKNOWLEDGED | PM |
| Time-off request | TIME_OFF_REQUEST | Manager |
| Project assigned | PROJECT_ASSIGNMENT | Assigned user |

---

## Section 6 — Common Programmer Mistakes

### 1. Forgetting Organization Isolation

**Mistake:** Query doesn't include `WHERE organizationId = ?`

**Result:** Data from other companies visible = security breach

**Fix:** Always include org filter. Check `server/orgFilter.ts` pattern.

---

### 2. Creating Records Without Required Parents

**Mistake:** Creating estimate line item without estimate ID

**Result:** Orphaned record, can't display or calculate totals

**Fix:** Always verify parent exists before creating child records.

---

### 3. Not Handling Status Transitions

**Mistake:** Allowing direct status change from DRAFT to APPROVED (skipping SUBMITTED)

**Result:** Business logic broken, no audit trail

**Fix:** Validate state machine transitions.

---

### 4. Ignoring GPS in Time Clock

**Mistake:** Clock-in succeeds without GPS coordinates

**Result:** Can't verify worker was on-site

**Fix:** GPS should be captured, but allow null for testing/indoor.

---

### 5. Using String Dates Instead of Timestamps

**Mistake:** Storing "06/10/2024" as text instead of proper timestamp

**Result:** Sorting broken, timezone issues, query problems

**Fix:** Use proper `timestamp` or `date` types from schema.

---

### 6. Not Recalculating Totals

**Mistake:** Add line item but don't recalculate estimate total

**Result:** UI shows wrong numbers, user loses trust

**Fix:** Trigger recalculation on any line item change.

---

### 7. Skipping Audit Logging

**Mistake:** Critical change made without calling `logCreate/logUpdate`

**Result:** No audit trail for compliance

**Fix:** Use auditLogger for all CREATE, UPDATE, DELETE on important entities.

---

### 8. Hardcoding Roles

**Mistake:** `if (role === 'ADMIN')` instead of using `requireRole()` middleware

**Result:** Inconsistent authorization, easy to bypass

**Fix:** Always use middleware pattern for role checks.

---

### 9. Not Testing Multi-Tenant Scenarios

**Mistake:** Testing only with one organization

**Result:** Cross-tenant data leaks not caught

**Fix:** Always test with 2+ organizations to verify isolation.

---

### 10. Ignoring Production Rate Capture

**Mistake:** Log progress quantity but don't capture production rate

**Result:** Historical data not available for future estimates

**Fix:** On shift approval, capture (quantity / labor hours) for scope items worked.

---

### 11. Breaking the SOW Tracking Chain

**Mistake:** Not propagating `organizationSowItemId` through the data flow

**Result:** Production rates can't be aggregated across projects for accurate bidding

**The SOW Tracking Chain:**
```
organizationSowItems (Master Library)
        │
        ▼ Must capture organizationSowItemId
estimateLineItems (Bid Phase)
        │
        ▼ Must propagate on bid-to-project conversion
scopeItems (Project Phase)
        │
        ▼ Must inherit when creating daily progress
dailyScopeProgress (Execution Phase)
        │
        ▼ Enables aggregation
Production Rate Analysis (All projects with same SOW item)
```

**Critical Code Paths:**
1. `HierarchicalLineItemBuilder.tsx` - Must include `organizationSowItemId` in selection callback
2. `bid-estimate.tsx` - Must pass `organizationSowItemId` to line item creation
3. `routes.ts` (bid-to-project conversion) - Must copy `organizationSowItemId` to scopeItems
4. `routes.ts` (daily progress) - Must inherit `organizationSowItemId` from parent scopeItem

**Test by:** Create estimate with scope library item → Convert to project → Log daily progress → Query `/api/estimates/production-rates/by-sow-item/:sowItemId` → Should return aggregated data

---

## Cross-References

- [SYSTEM_FEATURE_BIBLE.md](./SYSTEM_FEATURE_BIBLE.md) - Complete feature documentation
- [ARCHITECTURE_MAP.md](./ARCHITECTURE_MAP.md) - Technical architecture
- [ACCOUNT_ROLES_RBAC.md](./ACCOUNT_ROLES_RBAC.md) - Role permissions
- [FEATURE_MATRIX.csv](./FEATURE_MATRIX.csv) - Feature inventory
- [CONSTRUCTION_TERMS_FOR_DEVS.md](./CONSTRUCTION_TERMS_FOR_DEVS.md) - Glossary
- [FEATURE_TESTING_PLAYBOOK.md](./FEATURE_TESTING_PLAYBOOK.md) - Testing procedures
