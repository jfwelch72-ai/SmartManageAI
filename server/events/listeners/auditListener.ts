// This listener has been removed.
// Domain events are now durably persisted to the `domain_events` table by eventBus.emit(),
// which provides an equivalent and more reliable audit record without a separate listener.
// Per-route logAudit() calls remain as the primary security audit trail.
