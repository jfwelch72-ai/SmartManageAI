# Security & Test Plan

## Security Requirements

### All New Endpoints
1. Authentication required (JWT via authMiddleware)
2. Org isolation enforced (getOrgFilter/verifyOrgAccess)
3. RBAC check (requireRole or permission check)
4. Input validation (Zod schemas)
5. Structured logging (no secrets in logs)
6. Error handling (no stack traces to client)
7. Rate limiting (apiLimiter applied)

### External Provider Calls
1. Timeout: 30 seconds default
2. Retry: 3 attempts with exponential backoff
3. Secrets: never logged, never in API responses
4. Idempotency: keys for all write operations
5. Token refresh: automatic before expiry

### AI Actions
1. Draft-only by default
2. Approval required for actions creating real entities
3. Per-org limits enforced
4. Full audit trail in ai_action_audit
5. Input/output logged (sanitized)

## Test Harness

### Organization Isolation Tests (orgIsolation.spec.ts)
- Attempt cross-org access for every new route
- Verify org filter applied to all queries
- Test SUPER_ADMIN bypass works correctly
- Test that org-scoped data never leaks

### RBAC Matrix Tests (rbacMatrix.spec.ts)
- Test every new endpoint with every role
- Verify expected access/deny patterns
- Test integration endpoints: ADMIN required
- Test approval endpoints: MANAGER+ required
- Test AI log endpoints: ADMIN required
- Test digest/health endpoints: per-route permissions

### Outbox Dispatcher Tests (outboxDispatcher.spec.ts)
- Events are org-scoped
- HMAC signatures are correct
- Failed events retry with backoff
- Dead-letter events are visible
- Events for disabled connections are skipped

### QBO Sync Tests (qboSync.spec.ts)
- Mock QBO API responses
- Verify entity mapping correctness
- Test idempotency (re-sync same data)
- Test error handling (API failures)
- Test dry-run mode

### Email Ingestion Tests (emailIngestion.spec.ts)
- Mock email provider API
- Verify cursor-based sync
- Verify AI classification produces drafts only
- Test duplicate message handling
- Test incremental sync after initial

### Document Revisions Tests (documentRevisions.spec.ts)
- Create revision increments number
- Superseded behavior enforced
- Latest-by-default query works
- Old revision accessible with warning flag
- E-sign creates revision correctly

### Approvals Tests (approvals.spec.ts)
- Flag OFF: no approval required, flows work as before
- Flag ON: approval request created
- Approve: entity transitions
- Reject: entity stays, notifications sent
- Only eligible roles can approve
- Cross-org approval attempts fail
