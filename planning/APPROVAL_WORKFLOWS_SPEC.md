# Approval Workflows Specification

## Overview

Generic approval framework that can be wired into any entity requiring approval before state transitions. Backward compatible — existing flows work unchanged when APPROVALS_FRAMEWORK flag is OFF.

## Data Model

```
approval_requests:
  id, orgId, entityType, entityId
  requestedByUserId
  status: pending | approved | rejected
  approverUserId (nullable), approverRole (nullable)
  notes, createdAt, updatedAt, decidedAt
```

## Entity Types Supported

| Entity Type | Trigger | Approver Role |
|-------------|---------|---------------|
| CHANGE_ORDER | Send/Finalize/Publish | ADMIN, MANAGER |
| SOV_PAY_APP | Submission/Export to QBO | ADMIN, OFFICE_MANAGER |
| TIME_APPROVAL | Weekly timecard submission | MANAGER, SUPERINTENDENT |
| VENDOR_BILL | Export/payment authorization | ADMIN, OFFICE_MANAGER |
| ESIGN_SEND | Send document for signature | ADMIN |
| QBO_EXPORT | Export invoice to QBO | ADMIN, OFFICE_MANAGER |

## API

### Core Functions
- `createApprovalRequest(orgId, entityType, entityId, requestedByUserId, rules?)`
- `approveRequest(requestId, approverUserId, notes?)`
- `rejectRequest(requestId, approverUserId, notes?)`
- `getApprovalStatus(orgId, entityType, entityId)`
- `getPendingApprovals(orgId, filters?)`
- `isApprovalRequired(orgId, entityType)` — checks feature flag + entity config

### Endpoints
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/approvals | MANAGER+ | List pending approvals |
| GET | /api/approvals/:id | MANAGER+ | Get approval detail |
| POST | /api/approvals | System | Create approval request |
| POST | /api/approvals/:id/approve | ADMIN/MANAGER | Approve request |
| POST | /api/approvals/:id/reject | ADMIN/MANAGER | Reject request |
| GET | /api/approvals/stats | ADMIN | Approval stats dashboard |

## Behavior with Flag OFF

When APPROVALS_FRAMEWORK flag is OFF:
- `isApprovalRequired()` returns false
- Entity state transitions proceed as they do today
- No approval records created
- No UI changes

## Behavior with Flag ON

When APPROVALS_FRAMEWORK flag is ON:
- Entity state transitions check `isApprovalRequired()`
- If required, creates approval_request in PENDING status
- Entity stays in current state until approved
- Notification sent to eligible approvers
- On approval: entity state transition proceeds
- On rejection: entity stays, requestor notified

## Audit Trail

Every approval action (create, approve, reject) logged to:
1. `approval_requests` table (full record)
2. `auditLog` table (standard audit entry)
3. Notification to relevant parties
