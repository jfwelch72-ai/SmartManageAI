# Automations & Events

## Overview

SmartManageAI includes various automated processes, scheduled tasks, and event-driven notifications. This document catalogs all automation systems.

---

## Scheduled Tasks

### AI Analysis Scheduler

**Purpose:** Automatically run AI PM analysis on schedule.

**Trigger:** Cron schedule (configurable, disabled in development)

**Implementation:**
- **File:** `server/ai/scheduler.ts`
- **Condition:** `NODE_ENV=production`
- **Default Schedule:** Daily at configured time

**Actions:**
1. Iterate through active organizations
2. Build data snapshot for each
3. Run AI analysis
4. Store results
5. Create notification if critical issues found

**Status:** ✅ Working (production only)

---

### AI Notes Analysis Scheduler

**Purpose:** Analyze daily notes for insights.

**Trigger:** Cron schedule

**Implementation:**
- **File:** `server/aiNotesScheduler.ts`
- **Default Schedule:** Every few hours

**Actions:**
1. Fetch recent unanalyzed notes
2. Send to AI for classification
3. Create insights with severity
4. Link to source notes
5. Create tasks if critical

**Status:** ✅ Working

---

### Payroll Report Generation

**Purpose:** Auto-generate weekly payroll reports when all shifts approved.

**Trigger:** When last shift of week is approved

**Implementation:**
- **File:** `server/payrollSettingsRoutes.ts`

**Condition Logic:**
```typescript
// Check if all shifts for week are approved
const pendingShifts = await getPendingShiftsForWeek(weekStart, weekEnd);
if (pendingShifts.length === 0) {
  await generateWeeklyReport(organizationId, weekStart);
  await notifyOfficeManager();
}
```

**Actions:**
1. Check all shifts approved
2. Calculate total hours per employee
3. Generate report record
4. Notify office administrators

**Failure Handling:** Manual report generation available

**Status:** ✅ Working

---

## Event-Driven Automations

### Time Clock Events

**Trigger:** Clock in/out actions

**Events:**
| Event | Actions |
|-------|---------|
| CLOCK_IN | Create shift record, log GPS, start timer |
| CLOCK_OUT | Close shift, calculate hours, check overtime |
| AUTO_CLOCK_OUT | System closes abandoned shifts at midnight |

**Implementation:**
- **File:** `server/timeClockRoutes.ts`

---

### Shift Approval Events

**Trigger:** Superintendent approves shift

**Actions:**
1. Update shift status to APPROVED
2. Update labor hours on project
3. Check week completion for payroll
4. Log approval in audit trail

---

### Bid Status Changes

**Trigger:** Bid status updated

**Events:**
| Status Change | Actions |
|---------------|---------|
| DRAFT → SUBMITTED | Log submission time, notify estimators |
| SUBMITTED → WON | Create conversion task, notify team |
| WON → (Convert) | Create project from bid data |
| SUBMITTED → LOST | Archive bid, update analytics |

---

### Project Status Changes

**Trigger:** Project status updated

**Events:**
| Status Change | Actions |
|---------------|---------|
| BID → PLANNING | Initialize project setup tasks |
| PLANNING → ACTIVE | Notify superintendent, enable time tracking |
| ACTIVE → COMPLETE | Trigger closeout checklist |
| COMPLETE → CLOSED | Archive, generate final reports |

---

### Change Order Events

**Trigger:** Change order status changes

**Events:**
| Status Change | Actions |
|---------------|---------|
| DRAFT → SUBMITTED | Notify approvers, log submission |
| SUBMITTED → APPROVED | Update contract amount, notify PM |
| SUBMITTED → REJECTED | Notify submitter, log reason |

**Implementation:**
- **File:** `server/changeOrderRoutes.ts`

---

### Delay Events

**Trigger:** Delay submitted or acknowledged

**Events:**
| Event | Actions |
|-------|---------|
| Delay Created | Log delay record |
| Delay Submitted | Generate notification email |
| Delay Acknowledged | Update status, log response |
| Delay Unresponded (48hrs) | Send reminder notification |

**Implementation:**
- **File:** `server/delayRoutes.ts`

---

## Notification System

### Notification Types

| Type | Trigger | Recipients |
|------|---------|------------|
| BILLING_READY | SoV line item ready to bill | Office Manager |
| CHANGE_ORDER_PENDING | CO awaiting approval | Approvers |
| TIME_OFF_REQUEST | PTO submitted | Manager |
| GENERAL | Various system events | Relevant users |
| MATERIAL_OVERAGE | Budget threshold exceeded | PM, Superintendent |
| PROJECT_ASSIGNMENT | User assigned to project | Assigned user |
| MAINTENANCE_REQUEST | Equipment maintenance due | Maintenance Manager |
| REPAIR_REQUEST | Equipment repair needed | Maintenance Manager |
| DELAY_SUBMITTED | Delay logged | PM, Superintendent |
| DELAY_ACKNOWLEDGED | GC responded to delay | PM |
| DELAY_CHANGE_ORDER_NEEDED | Delay requires CO | Estimator, PM |

### Implementation

**Table:** `notifications`

```typescript
await db.insert(notifications).values({
  userId: recipientId,
  type: "CHANGE_ORDER_PENDING",
  title: "Change Order Requires Approval",
  message: `CO #${changeOrder.number} submitted for ${project.name}`,
  projectId: project.id,
});
```

**File:** `server/routes.ts` (notifications endpoints)

### Delivery Channels

1. **In-App** - Notification bell in header
2. **Email** - Critical notifications (configurable)

---

## Bid Network Automations

### Bid Request Matching

**Trigger:** New bid request published

**Actions:**
1. Identify matching subcontractors by trade
2. Generate invitation list
3. Send notifications to matches
4. Track view counts

**Implementation:**
- **File:** `server/bidNetworkNotifications.ts`

---

### Bid Response Tracking

**Trigger:** Subcontractor submits response

**Actions:**
1. Update response count
2. Notify GC of new response
3. Log response details

---

## Material Budget Alerts

### Threshold Monitoring

**Trigger:** Material usage updated

**Condition:** Usage exceeds configured threshold (default 90%)

**Actions:**
1. Set `alertTriggered` flag
2. Create notification for PM
3. Include in AI analysis

**Implementation:**
- **File:** Embedded in material tracking routes

---

## Equipment Maintenance Alerts

### Scheduled Maintenance Due

**Trigger:** Date-based check

**Condition:** Next maintenance date approaching

**Actions:**
1. Create maintenance reminder
2. Notify Maintenance Manager
3. Log in equipment history

---

## Email Processing Automation

### Incoming Email Classification

**Trigger:** Email synced from connected account

**Actions:**
1. Classify email category (15 types)
2. Extract actionable tasks
3. Link to projects if identifiable
4. Create tasks in system
5. Flag priority emails

**Implementation:**
- **File:** `server/ai/emailAi.ts`

---

## Audit Trail Events

### Logged Actions

All significant actions are logged:

| Action | Logged Data |
|--------|-------------|
| CREATE | Entity type, ID, creator, org, full data |
| UPDATE | Entity type, ID, updater, before/after |
| DELETE | Entity type, ID, deleter, deleted data |
| APPROVE | Entity type, ID, approver, what approved |
| REJECT | Entity type, ID, rejecter, reason |
| CLOCK_IN | User, project, time, GPS |
| CLOCK_OUT | User, project, time, GPS, duration |

**Implementation:**
- **File:** `server/auditLogger.ts`

```typescript
export async function logCreate(
  entityType: string,
  entityId: string,
  userId: string,
  organizationId: string,
  data: any
) {
  await db.insert(auditLog).values({
    userId,
    action: "CREATE",
    entityType,
    entityId,
    organizationId,
    changes: JSON.stringify(data),
  });
}
```

---

## Background Processes

### Health Checks

**Endpoint:** `GET /health`, `GET /ready`

**Purpose:** Kubernetes/container health monitoring

**Implementation:**
- **File:** `server/opsRoutes.ts`

---

### Data Pipeline Processing

**Purpose:** Process data imports and exports

**Implementation:**
- **File:** `server/dataPipelineService.ts`

---

## Failure Handling

### Retry Logic

For external API calls (AI, email):
- Max 3 retries
- Exponential backoff
- Log failures

### Fallback Behavior

When automation fails:
1. Log error with context
2. Continue with remaining items
3. Alert admin if critical
4. Provide manual fallback

### Monitoring

**File:** `server/utils/monitoring.ts`

- Performance metrics
- Error tracking
- Usage statistics

---

## Configuration

### Environment Variables

| Variable | Purpose |
|----------|---------|
| NODE_ENV | Enable/disable schedulers |
| AI_SCAN_CRON | AI analysis schedule |
| NOTIFICATION_EMAIL_ENABLED | Email notifications |

### Feature Flags

Automations can be enabled/disabled via:
- Subscription tier
- Add-on status
- Organization settings
