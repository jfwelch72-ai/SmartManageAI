# AI Governance Specification

## Overview

Centralized AI execution wrapper providing cost tracking, usage limits, audit trail, and safe modes for all AI operations.

## AI Execution Wrapper

All new AI calls must go through `executeAiAction()`:

```typescript
async function executeAiAction(params: {
  orgId: string;
  userId: string | null;
  actionType: string;
  inputRefs: Record<string, any>;
  model?: string;
  execute: () => Promise<AiActionResult>;
  approvalRequired?: boolean;
}): Promise<AiActionResult>
```

### Execution Flow
1. Check per-org limits (tokens/day, $/day, actions/day)
2. If over limit → reject with clear error
3. Execute AI call
4. Record in ai_action_audit (tokens, cost, rationale, refs)
5. If approvalRequired → create draft, flag for approval
6. Return result

## Per-Org Limits

| Limit | Starter | Growth | Scale | Hustler |
|-------|---------|--------|-------|---------|
| Actions/day | 10 | 100 | 500 | Unlimited |
| Tokens/day | 50K | 500K | 2M | Unlimited |
| $/day | $1 | $10 | $50 | $200 |

Limits configurable per org by SUPER_ADMIN.

## Safe Modes

| Mode | Behavior |
|------|----------|
| draft_only | AI outputs create drafts only, never real entities |
| no_external_send | AI cannot trigger emails, API calls, or webhooks |
| approval_required | All AI actions require human approval before effect |

Default: `draft_only` + `approval_required` for new orgs.

## Audit Trail

Every AI action recorded:
- orgId, actorUserId
- actionType (classify_email, generate_co, analyze_project, etc.)
- inputRefs (what data was sent to AI)
- outputRefs (what was produced)
- rationale (AI's reasoning/explanation)
- model, tokensIn, tokensOut, costEstimate
- approvalRequired, approvalStatus, approvedBy, approvedAt

## UI

### AI Activity Log
- Filter by: project, user, action type, date range, approval status
- Show: action type, input summary, output summary, cost, status
- Drill into detail: full rationale, input/output refs, approval chain

### AI Settings (Per Org)
- Toggle safe modes
- Set daily limits
- View usage dashboard (today, this week, this month)
- Cost breakdown by action type
