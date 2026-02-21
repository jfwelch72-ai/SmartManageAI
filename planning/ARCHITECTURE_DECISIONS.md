# Architecture Decision Records (ADRs)

## ADR-001: Integration Hub as Central Provider Framework

**Status**: Accepted  
**Date**: February 21, 2026

**Context**: The platform needs to integrate with multiple external services (QBO, Google, Microsoft, E-sign providers). Each has different auth mechanisms, API patterns, and sync requirements.

**Decision**: Build a provider-agnostic Integration Hub at `/server/integrations/` with:
- A provider registry pattern where each provider implements a standard interface
- Centralized connection management with encrypted secrets
- A shared outbox pattern for async event dispatch
- Cursor-based sync state tracking per provider per entity

**Consequences**:
- New providers can be added by implementing the provider interface
- Connection lifecycle (connect, sync, disconnect) is standardized
- Secrets are stored using the existing Replit secrets pattern, not in the database directly

---

## ADR-002: Feature Flags via Extended FeatureKey System

**Status**: Accepted  
**Date**: February 21, 2026

**Context**: Need to gate 11 new modules independently per org. The existing system uses `FeatureKey` type + `PLAN_DEFAULT_FEATURES` + `addonKeyEnum`.

**Decision**: Extend `FeatureKey` type with new keys. Add new addon keys to the database enum. Feature flags check via the existing `hasFeatureAccess()` path. SUPER_ADMIN can toggle any flag for any org.

**Consequences**:
- No new gating infrastructure needed
- Consistent with existing patterns
- Billing tier defaults can be configured later

---

## ADR-003: Event Outbox Pattern for Integration Events

**Status**: Accepted  
**Date**: February 21, 2026

**Context**: Integration actions (sync, webhook delivery) must be reliable and not block request handling.

**Decision**: Use a transactional outbox pattern:
1. Write events to `integration_events_outbox` in the same transaction as the business operation
2. A background dispatcher polls the outbox and delivers events
3. Failed events are retried with exponential backoff
4. Dead-letter visibility via admin endpoint

**Consequences**:
- Guaranteed at-least-once delivery
- No message broker dependency
- Admin visibility into event pipeline

---

## ADR-004: AI Governance as Execution Wrapper

**Status**: Accepted  
**Date**: February 21, 2026

**Context**: AI calls are currently scattered across services. Need centralized cost tracking, rate limiting, and audit trail.

**Decision**: Create a single `executeAiAction()` wrapper that:
- Checks per-org limits before execution
- Records inputs/outputs/costs in `ai_action_audit`
- Enforces safe modes (draft-only, approval-required)
- All new AI calls must use this wrapper; existing calls can be migrated incrementally

**Consequences**:
- Single point for cost control and audit
- Existing AI features continue working without changes
- New AI features automatically get governance

---

## ADR-005: Approval Workflows as Generic Framework

**Status**: Accepted  
**Date**: February 21, 2026

**Context**: Multiple entities need approval workflows (COs, SOV, timecards, vendor bills). Each has slightly different rules.

**Decision**: Build a generic `approval_requests` table + service with:
- Entity type + entity ID reference pattern
- Configurable approval rules per entity type
- Role-based approver constraints
- When APPROVALS_FRAMEWORK flag is OFF, existing flows work unchanged
- When ON, entity state transitions check for pending approvals

**Consequences**:
- One framework serves all entity types
- Backward compatible — no breaking changes when flag is OFF
- New entity types can be added to the framework easily

---

## ADR-006: Document Revisioning with Superseded Chain

**Status**: Accepted  
**Date**: February 21, 2026

**Context**: Documents need version tracking with clear superseded/active status.

**Decision**: Create `document_revisions` table with:
- Sequential revision numbers per document
- `supersedesRevisionId` for chain linkage
- Status: active/superseded
- Default views show latest active revision
- "View old revision" available with visual warning

**Consequences**:
- Clear audit trail for document changes
- Superseded documents are not hidden but clearly marked
- Integrates with e-sign (signed docs create new revisions)

---

## ADR-007: Deterministic Project Health Score

**Status**: Accepted  
**Date**: February 21, 2026

**Context**: Need an explainable, reproducible project health metric.

**Decision**: Compute score (0-100) from deterministic, weighted inputs:
- Schedule variance: 25% weight
- Budget burn vs progress: 25% weight
- Open RFIs/submittals aging: 20% weight
- Open change orders aging: 15% weight
- Safety issues/incidents: 15% weight

Store snapshots in `project_health_snapshots` for trending.

**Consequences**:
- Score is reproducible and explainable
- Components are visible in UI breakdown
- Historical trends available via snapshots

---

## ADR-008: Mobile Offline Conflict Resolution Strategy

**Status**: Accepted  
**Date**: February 21, 2026

**Context**: Current offline sync uses a simple queue. Need conflict resolution beyond last-write-wins.

**Decision**: Implement server-authoritative merge with conflict logging:
- Server compares timestamps and field-level changes
- Conflicts are logged to a conflicts table
- Users see a "Resolve Conflicts" UI for manual resolution
- Entity-specific merge rules (e.g., time entries: server wins on approval status)

**Consequences**:
- No silent data loss
- Conflicts are visible and resolvable
- Adds complexity but ensures data integrity
