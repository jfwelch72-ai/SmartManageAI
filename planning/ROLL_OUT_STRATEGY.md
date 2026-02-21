# Roll-Out Strategy

## Principles

1. All feature flags default OFF
2. Enable per org for internal testing first
3. Safe Pilot Mode for external-facing features
4. Gradual automation increase

## Safe Pilot Mode

### Stage 1: Read-Only Sync
- QBO: Import Chart of Accounts only (read)
- Email: Ingest and classify only (no task creation)
- Calendar: Import events as read-only view
- Duration: 1 week minimum

### Stage 2: Exports with Approval
- QBO: Export invoices requires approval
- Email: Task creation requires review + confirm
- Calendar: Export milestones (one-way)
- E-sign: Send requires admin approval
- Duration: 2 weeks minimum

### Stage 3: Automation Options
- QBO: Scheduled sync (4hr interval)
- Email: Auto-classify + suggest tasks
- Calendar: Two-way sync with conflict resolution
- E-sign: Direct send (still draft first)
- Duration: Ongoing

## Per-Org Enablement

### SUPER_ADMIN Actions
1. Navigate to Platform Admin → Organization Detail
2. Enable feature flags one at a time
3. Monitor integration audit log for issues
4. Adjust AI governance limits as needed

### Org Admin Actions
1. Navigate to Company Settings → Integrations
2. Connect providers (OAuth flow)
3. Configure sync preferences
4. Review AI activity log

## Monitoring

- Integration event outbox: watch for failed events
- AI action audit: watch for limit violations
- Approval requests: watch for stuck approvals
- Sync state: watch for stale cursors
- Error rates: background job failure dashboard

## Rollback Plan

If issues discovered:
1. Disable feature flag for affected org (immediate)
2. Disconnect problematic provider connection
3. Review audit logs for root cause
4. Fix and re-enable after verification

No data loss on disable — all records preserved, sync paused.
