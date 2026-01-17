# Role-Based Test Scenarios

**End-to-end testing scenarios simulating real user workflows.**

---

## How to Use These Scenarios

Each scenario includes:
- **Context** - Business situation being simulated
- **Who Logs In** - User role(s) involved
- **What They Click** - Navigation steps
- **What Data They Enter** - Specific inputs
- **What Happens Automatically** - System automation
- **What to Verify** - Expected outcomes to check

---

## Scenario 1: Estimator → PM → Superintendent Flow

### Context
A subcontractor wins a concrete job and sets it up for field execution.

### Phase 1: Estimator Creates and Wins Bid

**Who Logs In:** ESTIMATOR (e.g., "jane.estimator@acmeconcrete.com")

**Steps:**
1. Navigate to `/bids`
2. Click "New Bid" or "Create Bid"
3. Enter bid details:
   - Name: "Walmart Distribution Center - Loading Dock"
   - GC: "Turner Construction"
   - Bid Date: [2 weeks from now]
   - Trade: CONCRETE
4. Save bid (status: DRAFT)
5. Go to Estimate tab `/bids/:code/estimate`
6. Add line items:
   ```
   Item 1: 8" Reinforced Slab
   - Quantity: 5,000 SF
   - Labor Hours: 160
   - Labor Rate: $68.00
   - Material Cost: $18,750
   - Markup: 18%
   
   Item 2: Grade Beams
   - Quantity: 400 LF
   - Labor Hours: 80
   - Labor Rate: $72.00
   - Material Cost: $8,200
   - Markup: 18%
   ```
7. Save estimate
8. Update bid status to SUBMITTED
9. [Simulate winning] Update bid status to WON

**Verify:**
- Estimate total calculated correctly
- Bid status shows WON
- "Convert to Project" button appears

### Phase 2: PM Converts and Sets Up Project

**Who Logs In:** MANAGER (e.g., "mike.pm@acmeconcrete.com")

**Steps:**
1. Navigate to `/bids`
2. Click on the WON bid
3. Click "Convert to Project"
4. Confirm conversion dialog
5. Verify redirect to new project
6. On project detail, update:
   - Superintendent: Select "Steve Super"
   - Start Date: [next Monday]
   - Contract Amount: [from estimate total]
7. Review Scope Items section:
   - Verify items from estimate appear
8. Set up Material Budgets:
   - Ready-Mix Concrete: 200 CY @ $145/CY
   - Rebar #4: 8,000 LF @ $0.85/LF

**Verify:**
- Project created with status PLANNING
- Estimate linked to project
- Scope items populated
- Steve Super can now see this project

### Phase 3: Superintendent Executes Work

**Who Logs In:** SUPERINTENDENT (e.g., "steve.super@acmeconcrete.com")

**Steps:**
1. Navigate to `/time-clock`
2. Verify "Walmart Distribution Center" project visible
3. Clock in to project
4. [Do some work]
5. Navigate to `/projects/:code`
6. Add daily note:
   ```
   Weather: Clear, 75°F
   Crew: 6 workers
   Work: Formed and poured grade beams GB-1 through GB-4 (100 LF)
   Materials used: 15 CY concrete
   Issues: None
   ```
7. Log scope progress:
   - Grade Beams: 100 LF installed today
8. Clock out

**Verify:**
- Shift appears in pending queue
- Daily note visible in feed
- Scope progress updated (100/400 LF = 25%)
- Material usage logged

### Phase 4: Superintendent Approves Time

**Who Logs In:** SUPERINTENDENT (same)

**Steps:**
1. Navigate to `/time-clock-manager`
2. Find pending shifts for the day
3. Approve each shift

**Verify:**
- Shifts status → APPROVED
- If all week shifts approved, payroll notification created

**What Happens Automatically:**
- Labor costs calculated
- Production rate captured (100 LF / 8 hours = 12.5 LF/hour)
- Weekly payroll report generated (if week complete)

---

## Scenario 2: Hourly Worker Timeclock

### Context
A field worker clocks in and out each day.

**Who Logs In:** HOURLY_EMPLOYEE (e.g., "carlos.worker@acmeconcrete.com")

**Steps:**
1. Navigate to `/time-clock` (or mobile-friendly version)
2. Select project: "Walmart Distribution Center"
3. Click "Clock In"
4. [Browser prompts for location - allow]
5. Confirm clock-in recorded (green status indicator)
6. [Work the day - 8 hours pass]
7. Return to `/time-clock`
8. Click "Clock Out"
9. Verify shift summary displays:
   - Project name
   - Clock in time
   - Clock out time
   - Total hours

**Verify:**
- timeClockShifts record created with:
  - status: PENDING
  - clockInTime: correct timestamp
  - clockOutTime: correct timestamp
  - clockInLat/Lng: GPS coordinates (if allowed)
  - regularHours: calculated value (e.g., 8.0)
  - overtimeHours: 0 (if under threshold)

**What Happens Automatically:**
- Shift appears in superintendent's approval queue
- Hours calculated based on org's overtime threshold

**Edge Cases to Test:**
- Clock in without selecting project (should error)
- Clock out without clocking in (should error)
- Clock in twice (should show already clocked in)
- GPS denied (should still work, coordinates null)

---

## Scenario 3: Delay Occurs + GC Response Missing

### Context
Rain stops work, delay documented, GC doesn't respond.

**Who Logs In:** SUPERINTENDENT (e.g., "steve.super@acmeconcrete.com")

**Steps:**
1. Navigate to `/projects/:code` (active project)
2. Find Delays section
3. Click "Add Delay"
4. Enter delay details:
   - Date: [today]
   - Reason: WEATHER
   - Hours Lost: 8.0
   - Responsible Party: FORCE_MAJEURE
   - Description: "Heavy rain starting 5:30 AM, job flooded. Unable to work all day. Forecast shows clearing tomorrow."
5. Click "Save" (status: DRAFT)
6. Click "Submit" to send formal notice
7. Verify notification dialog shows recipients

**Verify:**
- Delay record created with status: SUBMITTED
- delayNotification record created
- Notification queued for GC contact

**Simulating 48-Hour No Response:**
1. [In testing, manually advance time or trigger reminder]
2. Check system sends reminder notification
3. Delay still shows SUBMITTED (not ACKNOWLEDGED)

**Who Logs In:** MANAGER

**Steps:**
1. Navigate to `/delay-claims`
2. Click "New Claim"
3. Link to the unacknowledged delay
4. Enter claim details:
   - Claim Type: TIME_EXTENSION
   - Days Requested: 1
   - Cost Requested: $0 (or add standby costs)
   - Description: "Requesting 1 day extension due to weather delay on [date]. No response from GC within 48 hours."
5. Submit claim

**Verify:**
- delayClaims record created
- Delay linked via delayId or relationship
- Claim status: SUBMITTED

---

## Scenario 4: Equipment Overused → Replacement Trigger

### Context
Skid steer approaching maintenance threshold and high utilization suggests need for additional unit.

**Who Logs In:** MAINTENANCE_MANAGER

**Steps:**
1. Navigate to `/equipment`
2. Click on "Bobcat S650 (EQ-001)"
3. Review current status:
   - Hours Used: 2,480 hours
   - Maintenance Due: Oil change at 2,500 hours
4. Add usage from today's work:
   - Project: Walmart Distribution Center
   - Hours: 6
   - Date: [today]
5. Save usage

**Verify:**
- Total hours now: 2,486
- System shows maintenance due in 14 hours
- Alert/notification triggered

**Who Logs In:** MANAGER (CFO view)

**Steps:**
1. Navigate to `/equipment/EQ-001`
2. Check utilization analysis:
   - Current utilization: [calculated %]
   - Cost per hour (owned)
   - Comparison to rental rate

**Analysis Logic:**
- If utilization > 80% and multiple projects need skid steer:
  - System may suggest: "Consider purchasing additional unit"
- If utilization < 40%:
  - System may suggest: "Consider renting instead of owning"

**What Happens Automatically:**
- MAINTENANCE_REQUEST notification when threshold approaching
- Maintenance record created when service performed

---

## Scenario 5: T&M Ticket → Invoice

### Context
GC requests extra sidewalk not in original scope. Work performed, documented, and billed.

**Who Logs In:** SUPERINTENDENT

**Steps:**
1. Navigate to `/projects/:code`
2. Find T&M Tickets section
3. Click "New T&M Ticket"
4. Enter ticket details:
   - Ticket Number: TM-2024-0089
   - Date: [today]
   - Description: "Additional 200 SF sidewalk requested by GC per verbal direction on-site. Work not in original scope."
5. Add labor entries:
   ```
   - Foreman: 4 hours @ $85/hr = $340
   - Finisher: 6 hours @ $68/hr = $408
   - Laborer: 6 hours @ $52/hr = $312
   ```
6. Add material entries:
   ```
   - Concrete 4 CY @ $155/CY = $620
   - Form lumber: $85
   - Wire mesh: $45
   ```
7. Add equipment entries:
   ```
   - Mixer 3 hours @ $25/hr = $75
   ```
8. Calculate total: $1,885
9. Get signature:
   - Call over GC rep
   - Use signature pad on screen
   - Capture name: "John Smith, Turner Construction"
10. Save and submit ticket

**Verify:**
- tmTickets record with signatureData populated
- Status: SUBMITTED
- All entry records created (labor, equipment, materials)
- Total calculated correctly

**Who Logs In:** OFFICE_MANAGER

**Steps:**
1. Navigate to T&M management or billing area
2. Find submitted ticket TM-2024-0089
3. Approve ticket for billing
4. Generate invoice or include in next billing cycle
5. Mark as billed

**Verify:**
- Ticket status: APPROVED then BILLED
- Invoice generated with correct amount
- Revenue tracked for project

---

## Scenario 6: AI Auto-Assigns Tasks

### Context
AI PM runs analysis and generates tasks for team.

**Who Logs In:** MANAGER

**Steps:**
1. Navigate to `/ai-pm`
2. Ensure projects have recent data:
   - Time entries
   - Daily notes
   - Material usage
   - Delays (if any)
3. Click "Run Analysis Now"
4. Wait for completion (30-60 seconds)
5. Review generated tasks:
   ```
   Example tasks:
   - HIGH: Review budget variance on Project A (-15%)
   - MEDIUM: Schedule concrete delivery for Project B
   - LOW: Update SoV billing for June
   ```
6. Click on a task
7. Assign to team member (if feature available)
8. Or mark as completed/dismissed

**Verify:**
- aiRuns record created with timestamp
- aiTasks records created with:
  - Priority levels
  - Role assignments
  - Source project
- aiInsights records with:
  - Severity levels
  - Recommendations

**What Happens Automatically:**
- Tasks appear on relevant user dashboards
- High-priority tasks may trigger notifications
- Scheduled analysis (production) runs automatically

---

## Scenario 7: Project Goes Over Budget

### Context
Labor hours exceed estimate, triggering alerts and management review.

### Setup Phase

**Who Logs In:** MANAGER

**Steps:**
1. Create or use project with estimate:
   - Estimated Labor: 160 hours @ $68/hr = $10,880
   - Status: ACTIVE
2. Verify baseline established

### Execution Phase (Over Time)

**Who Logs In:** SUPERINTENDENT

**Steps:**
1. Over several days, log time entries:
   - Day 1: 48 hours (6 workers × 8 hours)
   - Day 2: 48 hours
   - Day 3: 48 hours
   - Day 4: 32 hours
   - Total: 176 hours (16 hours over estimate)
2. Approve all shifts
3. Log corresponding scope progress (but slower than estimated)

### Detection Phase

**Who Logs In:** MANAGER

**Steps:**
1. Navigate to project detail
2. Check budget section:
   - Labor Budget: $10,880
   - Labor Actual: 176 × $68 = $11,968
   - Variance: -$1,088 (10% over)
3. Navigate to `/cfo` (CFO Dashboard)
4. View project in "At Risk" or "Over Budget" list

**Verify:**
- Variance calculation correct
- Project flagged appropriately
- AI PM includes in analysis with recommendation

**What Happens Automatically:**
- AI analysis highlights labor overrun
- CFO dashboard shows project at risk
- Recommendations generated:
  - "Investigate productivity on Project X"
  - "Labor costs 10% over budget"

### Response Phase

**Who Logs In:** MANAGER

**Steps:**
1. Review daily notes for productivity issues
2. Check production rates vs. estimate
3. Determine cause:
   - Incorrect estimate?
   - Inexperienced crew?
   - Scope changes?
4. If scope change: Create change order
5. If estimate error: Document for future reference
6. Update project forecast

---

## Additional Edge Case Scenarios

### Scenario 8: Multi-Org Access (Hustler)

**Who Logs In:** HUSTLER

**Steps:**
1. Navigate to `/hustler-dashboard`
2. View consolidated metrics across organizations
3. Switch organization using org switcher
4. Verify data changes to new org context
5. Return to portfolio view

**Verify:**
- Data from all owned orgs visible in portfolio
- Individual org access shows only that org's data
- Cannot access orgs not owned/delegated

---

### Scenario 9: Password Reset Flow

**Who Logs In:** Any user (forgotten password)

**Steps:**
1. Navigate to `/login`
2. Click "Forgot Password"
3. Enter email address
4. Submit request
5. Check email for reset link
6. Click reset link → `/reset-password?token=xxx`
7. Enter new password (twice)
8. Submit
9. Login with new password

**Verify:**
- Email sent with valid token
- Token expires after use
- Old password no longer works
- New password works
- tokenVersion incremented

---

### Scenario 10: Cross-Tenant Isolation Test

**Critical Security Test**

**Who Logs In:** User from Organization A

**Steps:**
1. Note your organizationId
2. Attempt to access projects:
   - Your projects → should work
   - Direct URL with Org B project ID → should fail/404
3. Check API responses don't leak data from other orgs

**Verify:**
- All queries filter by organizationId
- No data from other organizations visible
- API returns 404 or 403 for other org's data

---

## Summary Checklist

Use this checklist to verify complete scenario coverage:

- [ ] Scenario 1: Bid → Estimate → Project → Execution
- [ ] Scenario 2: Timeclock clock-in/out flow
- [ ] Scenario 3: Delay documentation and escalation
- [ ] Scenario 4: Equipment tracking and maintenance
- [ ] Scenario 5: T&M ticket to invoice
- [ ] Scenario 6: AI task generation
- [ ] Scenario 7: Budget overrun detection
- [ ] Scenario 8: Multi-org access (if applicable)
- [ ] Scenario 9: Password reset
- [ ] Scenario 10: Multi-tenant isolation security

---

## Cross-References

- [FEATURE_TESTING_PLAYBOOK.md](./FEATURE_TESTING_PLAYBOOK.md) - Individual feature tests
- [ACCOUNT_ROLES_RBAC.md](./ACCOUNT_ROLES_RBAC.md) - Role permissions
- [PROGRAMMER_USER_GUIDE.md](./PROGRAMMER_USER_GUIDE.md) - Development concepts
- [CONSTRUCTION_TERMS_FOR_DEVS.md](./CONSTRUCTION_TERMS_FOR_DEVS.md) - Terminology
