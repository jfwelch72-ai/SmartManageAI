# Feature Testing Playbook

**Step-by-step testing procedures for each major feature.**

---

## How to Use This Playbook

Each feature section includes:
- **Purpose** - What the feature does
- **Who Uses It** - Primary user roles
- **Preconditions** - What must exist before testing
- **Step-by-Step Testing** - Exact steps to execute
- **Expected Results** - What should happen
- **Automations Triggered** - Background processes
- **Common Failure Modes** - What goes wrong
- **How to Tell If Broken** - Symptoms of problems

---

## 1. Timeclock

### Purpose
Allow field workers to log their work hours with GPS verification.

### Who Uses It
- **Clock In/Out:** HOURLY_EMPLOYEE, SUPERINTENDENT, MANAGER
- **Approval:** SUPERINTENDENT, MANAGER, OFFICE_MANAGER

### Preconditions
- User account exists with appropriate role
- At least one ACTIVE project exists
- Browser has location access (for GPS)

### Step-by-Step Testing

**Test 1: Clock In**
1. Login as HOURLY_EMPLOYEE
2. Navigate to /time-clock
3. Select a project from dropdown
4. Click "Clock In" button
5. Allow location access if prompted

**Test 2: Clock Out**
1. While clocked in, navigate to /time-clock
2. Click "Clock Out" button
3. Verify shift summary displays

**Test 3: Shift Approval**
1. Login as SUPERINTENDENT
2. Navigate to /time-clock-manager
3. Find pending shift from Test 1-2
4. Click Approve button
5. Verify status changes to APPROVED

### Expected Results
| Action | Result |
|--------|--------|
| Clock In | Shift record created, status PENDING, clock-in time set, GPS captured |
| Clock Out | Clock-out time set, hours calculated (clockOut - clockIn) |
| Approve | Status = APPROVED, approverUserId set |

### Automations Triggered
- On approve of last shift of week: Weekly payroll report generated
- Notification to OFFICE_MANAGER when payroll ready

### Common Failure Modes
| Symptom | Cause |
|---------|-------|
| "No projects available" | User not in organization with active projects |
| GPS shows null | Location permission denied |
| Hours calculated wrong | Timezone mismatch |
| Can't approve | User lacks SUPERINTENDENT/MANAGER role |

### How to Tell If Broken
- Shifts don't appear in manager queue
- Hours show as 0 or negative
- Approval button does nothing
- Payroll report never generates

---

## 2. Estimating

### Purpose
Build cost estimates for bids, calculating labor, materials, and markup.

### Who Uses It
ESTIMATOR, MANAGER, ADMIN

### Preconditions
- Bid exists in DRAFT status
- Trade-specific scope items available

### Step-by-Step Testing

**Test 1: Create Estimate**
1. Login as ESTIMATOR
2. Navigate to /bids
3. Click on existing bid or create new
4. Go to Estimate tab or /bids/:code/estimate
5. Verify estimate interface loads

**Test 2: Add Line Item**
1. On estimate page, click "Add Line Item"
2. Enter:
   - Description: "4-inch concrete flatwork"
   - Quantity: 500
   - Unit: SF
   - Labor Hours: 20
   - Labor Rate: 65.00
   - Material Cost: 750.00
   - Markup: 15%
3. Save line item

**Test 3: Verify Calculations**
1. Check line item totals:
   - Labor: 20 × $65 = $1,300
   - Materials: $750
   - Subtotal: $2,050
   - Markup (15%): $307.50
   - Total: $2,357.50
2. Verify estimate total updates

### Expected Results
| Action | Result |
|--------|--------|
| Add line item | Item appears in list, totals calculated |
| Edit line item | Changes saved, totals recalculated |
| Delete line item | Item removed, totals recalculated |

### Common Failure Modes
| Symptom | Cause |
|---------|-------|
| Totals don't update | Frontend not refreshing query |
| "Estimate not found" | Estimate not linked to bid |
| Save button disabled | Form validation failing (check required fields) |

### How to Tell If Broken
- Line items don't save
- Math is wrong in totals
- Estimate doesn't copy to project on conversion

---

## 3. Project Creation

### Purpose
Create a project from a won bid or manually.

### Who Uses It
MANAGER, ADMIN

### Preconditions
- For conversion: Bid with status WON
- For manual: Required project data

### Step-by-Step Testing

**Test 1: Convert Bid to Project**
1. Login as MANAGER
2. Navigate to /bids
3. Find bid with status WON (or update one)
4. Click on bid to open detail
5. Click "Convert to Project" button
6. Confirm conversion dialog
7. Verify redirect to new project

**Test 2: Verify Project Data**
1. On project detail page, verify:
   - Project name matches bid name
   - Status is PLANNING
   - Estimate data copied
   - Scope items created

**Test 3: Manual Project Creation**
1. Navigate to /projects
2. Click "New Project" button
3. Fill required fields:
   - Name: "Test Project Manual"
   - Code: "PRJ-TEST-001"
   - Status: PLANNING
4. Save project

### Expected Results
| Action | Result |
|--------|--------|
| Convert bid | Project created, estimate linked, bid.projectId set |
| Manual create | Project record created with status PLANNING |
| Open project | All sections load (scope, notes, delays, etc.) |

### Automations Triggered
- PROJECT_ASSIGNMENT notification if team assigned
- Scope items auto-generated from trade template (if applicable)

### How to Tell If Broken
- Convert button doesn't appear on WON bids
- Project has no estimate after conversion
- Scope items missing

---

## 4. Daily Reports

### Purpose
Document what happened on a jobsite each day.

### Who Uses It
SUPERINTENDENT, MANAGER

### Preconditions
- Active project exists
- User has access to project

### Step-by-Step Testing

**Test 1: Create Daily Note**
1. Login as SUPERINTENDENT
2. Navigate to /projects/:code
3. Find "Daily Notes" section
4. Click "Add Note" or use text input
5. Enter:
   - Date: Today
   - Type: FIELD_NOTE
   - Content: "Poured 50 CY concrete in section A. Weather clear, 72°F. Crew of 6 worked 8 hours. No issues."
6. Save note

**Test 2: Verify Note Display**
1. Note appears in daily note feed
2. Note shows correct date and author
3. AI insight may appear (if AI enabled)

**Test 3: Progress Entry**
1. Find Scope Progress section
2. Select scope item (e.g., "Concrete Placement")
3. Enter quantity installed: 50 CY
4. Select crew (if applicable)
5. Save progress

### Expected Results
| Action | Result |
|--------|--------|
| Save note | Note record created, appears in feed |
| AI analysis | aiNoteInsights record may be created with category/severity |
| Progress entry | dailyScopeProgress record, scope % updated |

### Automations Triggered
- AI note analysis (async, if enabled)
- Production rate capture (on shift approval)

### How to Tell If Broken
- Notes don't save
- Notes appear for wrong project
- Progress doesn't update scope completion %

---

## 5. Materials Auto-Alerts

### Purpose
Alert when material usage exceeds budget threshold.

### Who Uses It
System automation, viewed by MANAGER, SUPERINTENDENT

### Preconditions
- Project with material budgets set up
- Threshold configured (default 90%)

### Step-by-Step Testing

**Test 1: Setup Material Budget**
1. Navigate to project detail
2. Find Material Budget section
3. Add budget item:
   - Material: "Ready-Mix Concrete"
   - Budgeted Qty: 100 CY
   - Unit Cost: $150
4. Save

**Test 2: Log Usage Below Threshold**
1. Log material usage: 50 CY
2. Verify no alert triggered
3. Check: 50/100 = 50% < 90%

**Test 3: Trigger Alert**
1. Log additional usage: 45 CY
2. Total now: 95 CY
3. Check: 95/100 = 95% > 90%
4. Verify alertTriggered = true
5. Check notifications for MATERIAL_OVERAGE

### Expected Results
| Condition | Result |
|-----------|--------|
| Usage < 90% | No alert |
| Usage ≥ 90% | alertTriggered = true, notification created |

### How to Tell If Broken
- Alert never triggers at 90%+
- Multiple alerts for same threshold crossing
- Notification not created

---

## 6. Delay Creation & Escalation

### Purpose
Document project delays and notify responsible parties.

### Who Uses It
SUPERINTENDENT (create), MANAGER (escalate)

### Preconditions
- Active project
- CRM contact for GC/Owner (for notifications)

### Step-by-Step Testing

**Test 1: Create Delay**
1. Navigate to project detail
2. Find Delays section
3. Click "Add Delay"
4. Enter:
   - Date: Today
   - Reason: WEATHER
   - Hours Lost: 8
   - Responsible Party: FORCE_MAJEURE
   - Description: "Heavy rain all day, unable to pour concrete"
5. Save delay (status: DRAFT)

**Test 2: Submit Delay**
1. On saved delay, click "Submit"
2. Status changes to SUBMITTED
3. Notification sent to GC contact

**Test 3: Escalation (No Response)**
1. Wait 48 hours (or mock in testing)
2. System should send reminder
3. If still no response, option to create delay claim

**Test 4: Create Delay Claim**
1. Navigate to /delay-claims
2. Click "New Claim"
3. Link to submitted delay(s)
4. Enter:
   - Days Requested: 2
   - Cost Requested: $5,000
   - Claim Type: BOTH
5. Submit claim

### Expected Results
| Action | Result |
|--------|--------|
| Create delay | projectDelays record, status DRAFT |
| Submit delay | Status SUBMITTED, notification sent |
| No response 48hr | Reminder notification |
| Create claim | delayClaims record with linked delays |

### Automations Triggered
- DELAY_SUBMITTED notification
- 48-hour reminder (if unacknowledged)
- DELAY_CHANGE_ORDER_NEEDED (if claim created)

### How to Tell If Broken
- Submit doesn't change status
- Notifications not created
- Can't link delays to claims

---

## 7. Equipment Maintenance

### Purpose
Track equipment and schedule preventative maintenance.

### Who Uses It
MAINTENANCE_MANAGER, MANAGER

### Preconditions
- Equipment records exist

### Step-by-Step Testing

**Test 1: Create Equipment**
1. Login as MAINTENANCE_MANAGER
2. Navigate to /equipment
3. Click "Add Equipment"
4. Enter:
   - Name: "Bobcat S650 Skid Steer"
   - Code: "EQ-001"
   - Category: SKID_STEER
   - Purchase Date: 2022-01-15
   - Purchase Price: $45,000
5. Save

**Test 2: Schedule Maintenance**
1. Open equipment detail /equipment/EQ-001
2. Find maintenance section
3. Add maintenance item:
   - Type: "Oil Change"
   - Interval: 250 hours
   - Next Due: 2024-07-15
4. Save

**Test 3: Assign to Project**
1. On equipment detail, find assignment section
2. Assign to active project
3. Verify utilization tracking starts

### Expected Results
| Action | Result |
|--------|--------|
| Create equipment | Record in equipment table |
| Schedule maintenance | Maintenance record with due date |
| Assign to project | Assignment tracked, hours can be logged |

### How to Tell If Broken
- Equipment doesn't appear in lists
- Maintenance reminders don't trigger
- Utilization hours don't accumulate

---

## 8. Rent vs Buy Logic

### Purpose
Analyze whether to own or rent equipment based on utilization.

### Who Uses It
MANAGER, CFO role

### Preconditions
- Equipment with usage history
- Rental rate data

### Step-by-Step Testing

**Test 1: View Utilization**
1. Navigate to equipment detail
2. Check utilization metrics:
   - Total hours used
   - Cost per hour (ownership cost / hours)

**Test 2: Compare to Rental**
1. If rental rate available, compare:
   - Ownership cost/hour vs rental rate/hour
   - Break-even utilization calculation

### Expected Results
- High utilization: ownership cost/hour < rental rate = buy
- Low utilization: ownership cost/hour > rental rate = rent

### How to Tell If Broken
- Utilization hours not tracked
- Cost calculations wrong

---

## 9. AI PM / AI Scheduler / AI CFO

### Purpose
Automated project analysis and task generation.

### Who Uses It
MANAGER, SUPERINTENDENT (with AI add-on)

### Preconditions
- AI add-on enabled for organization
- `ANTHROPIC_API_KEY` set in environment (primary provider — Claude handles both Takeoff and General families)
- `OPENAI_API_KEY` set in environment (fallback + Vision pipelines)
- Projects with data (more data = better analysis)
- Organization has `ai_pm` add-on enabled (check `organizationAddOns` table)

### Step-by-Step Testing

**Test 1: Run AI PM Analysis**
1. Login as MANAGER
2. Navigate to /ai-pm
3. Click "Run Analysis Now"
4. Wait for completion (may take 30-60 seconds)

**Test 2: Review Results**
1. Check AI Tasks tab for generated tasks
2. Check Insights for recommendations
3. Verify severity levels (LOW, MEDIUM, HIGH, CRITICAL)

**Test 3: Interact with Tasks**
1. Click on a generated task
2. Mark as complete or dismiss
3. Verify status updates

### Expected Results
| Action | Result |
|--------|--------|
| Run analysis | aiRuns record created, aiTasks and aiInsights generated |
| Task interaction | Task status updated |

### Automations Triggered
- Scheduled analysis runs (production only)
- Task notifications

### Common Failure Modes
| Symptom | Cause |
|---------|-------|
| "Analysis failed" | Missing `ANTHROPIC_API_KEY`, API error, timeout, or billing quota exhausted |
| Falls back to OpenAI | Anthropic returned 5xx; check `AI_PROVIDER_GENERAL` / `AI_PROVIDER_TAKEOFF` flags |
| No tasks generated | Not enough project data |
| Insights empty | AI returned malformed response (check `validateAiJsonOutput` Zod errors in logs) |
| 402 response | Org billing quota exhausted (`checkBillingQuota` blocked the call) |

### How to Tell If Broken
- Run button does nothing
- Analysis times out (>2 minutes)
- Results from wrong organization

---

## 10. Production Rate Generation

### Purpose
Capture historical productivity data for future estimates.

### Who Uses It
System (automatic), reviewed by ESTIMATOR

### Preconditions
- Approved time entries
- Daily scope progress logged
- Crew assignments

### Step-by-Step Testing

**Test 1: Create Data**
1. Log time entry: 8 hours on project
2. Log scope progress: 200 SF concrete installed
3. Approve time entry

**Test 2: Verify Rate Capture**
1. Navigate to /production-rates
2. Find scope item "Concrete"
3. Verify production rate: 200 SF / 8 hours = 25 SF/hour

**Test 3: Use in Estimate**
1. Create new estimate
2. Add concrete line item
3. Enter quantity: 500 SF
4. Check labor hour suggestion: 500 / 25 = 20 hours

### Expected Results
| Condition | Result |
|-----------|--------|
| Shift approved with progress | Production rate calculated and stored |
| New estimate | Historical rates available as suggestions |

### How to Tell If Broken
- No rates showing in production rates page
- Suggestions not appearing in estimate
- Rates showing wrong unit conversions

---

## 11. SoV Creation

### Purpose
Set up billing line items from contract for progress billing.

### Who Uses It
OFFICE_MANAGER, MANAGER

### Preconditions
- Project with contract amount
- Estimate line items (for reference)

### Step-by-Step Testing

**Test 1: Create SoV**
1. Navigate to /schedule-of-values
2. Select project
3. Click "Create SoV" or auto-generate from estimate
4. Add line items:
   - Item 1: Mobilization - $10,000
   - Item 2: Concrete Work - $50,000
   - Item 3: Final Cleanup - $5,000
5. Verify total matches contract

**Test 2: Log Progress**
1. Select billing period (e.g., June 2024)
2. Enter % complete per line:
   - Mobilization: 100%
   - Concrete Work: 40%
   - Cleanup: 0%
3. Calculate billing amount
4. Save progress

**Test 3: Generate Invoice**
1. Review billing summary
2. Export or generate invoice
3. Verify amounts match

### Expected Results
| Action | Result |
|--------|--------|
| Create SoV | Line items totaling contract amount |
| Log progress | Billing amount calculated per line |
| Complete billing | BILLING_READY notification |

### How to Tell If Broken
- SoV total doesn't match contract
- % complete doesn't calculate billing correctly
- Can't close billing period

---

## 12. Photo Upload + AI Analysis

### Purpose
Upload jobsite photos for documentation and optional AI analysis.

### Who Uses It
SUPERINTENDENT, any field role

### Preconditions
- Active project
- Storage configured (GCS)
- AI Vision add-on (for analysis)

### Step-by-Step Testing

**Test 1: Upload Photo**
1. Navigate to project detail
2. Find media/photos section
3. Click upload or drag-drop image
4. Verify upload progress
5. Confirm photo appears in gallery

**Test 2: View Metadata**
1. Click on uploaded photo
2. Verify metadata:
   - Upload date/time
   - Uploader name
   - GPS (if captured)

**Test 3: AI Analysis (if enabled)**
1. Select photo for analysis
2. Trigger AI analysis
3. Review results:
   - Progress observations
   - Safety issues identified
   - Quality notes

### Expected Results
| Action | Result |
|--------|--------|
| Upload | File stored in GCS, media record created |
| View | Photo displays with metadata |
| AI analysis | Analysis results returned with observations |

### Common Failure Modes
| Symptom | Cause |
|---------|-------|
| Upload fails | GCS credentials missing |
| Photo not displaying | CORS issues or URL generation |
| AI returns nothing | Image not processable or API error |

---

## 13. Messaging

### Purpose
Internal team communication.

### Who Uses It
All roles

### Preconditions
- Users exist in same organization

### Step-by-Step Testing

**Test 1: Start Conversation**
1. Navigate to /messages
2. Click "New Message" or "New Conversation"
3. Select recipient(s)
4. Enter message: "Concrete delivery confirmed for tomorrow 7am"
5. Send

**Test 2: Receive Message**
1. Login as recipient
2. Navigate to /messages
3. Verify message appears
4. Reply to message

**Test 3: Group Conversation**
1. Create conversation with 3+ users
2. Send message
3. Verify all participants can see

### Expected Results
| Action | Result |
|--------|--------|
| Send message | Message record created, appears for sender |
| Receive | Message appears for recipient(s) |
| Read status | Message marked as read when viewed |

### How to Tell If Broken
- Messages don't send
- Messages visible to wrong users
- Read status not updating

---

## 14. Notifications

### Purpose
Alert users to important events.

### Who Uses It
All roles (receiving), System (generating)

### Preconditions
- Various triggering events

### Step-by-Step Testing

**Test 1: Trigger Notification**
1. Perform an action that generates notification:
   - Submit change order
   - Exceed material budget
   - Submit delay
2. Login as notification recipient
3. Check notification indicator (bell icon)

**Test 2: View Notification**
1. Click notification
2. Verify content and link
3. Mark as read

**Test 3: List All**
1. View all notifications page
2. Filter by type or read status
3. Mark all as read

### Expected Results
| Trigger | Notification Created For |
|---------|-------------------------|
| Change order pending | Approvers |
| Material overage | PM |
| Shift approval complete (week) | Office Manager |
| Delay submitted | PM |

### How to Tell If Broken
- No notifications appear
- Notifications go to wrong users
- Links don't navigate correctly

---

## Cross-References

- [PROGRAMMER_USER_GUIDE.md](./PROGRAMMER_USER_GUIDE.md) - Development concepts
- [CONSTRUCTION_TERMS_FOR_DEVS.md](./CONSTRUCTION_TERMS_FOR_DEVS.md) - Terminology
- [ROLE_BASED_TEST_SCENARIOS.md](./ROLE_BASED_TEST_SCENARIOS.md) - Role-based scenarios
- [ACCOUNT_ROLES_RBAC.md](./ACCOUNT_ROLES_RBAC.md) - Permission details
