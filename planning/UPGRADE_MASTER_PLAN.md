# SmartManageAI — Upgrade Master Plan

**Version**: 1.0  
**Created**: February 21, 2026  
**Status**: Implementation In Progress

---

## Overview

This document is the single source of truth for the SmartManageAI platform upgrade wave. It covers all modules from Integration Hub foundations through Mobile/Offline V2, organized into 5 implementation phases.

## Phasing

### Phase 0: Foundation (Current)
- Planning documentation (this file + specs)
- Feature flags (11 new, all default OFF)
- Database schema additions (8 new tables)
- Integration Hub scaffolding
- Background jobs framework
- Test harness skeletons

### Phase 1: QuickBooks Online
- QBO OAuth 2.0 connection flow
- Chart of Accounts import
- Customer export from CRM
- Invoice export from SOV/Pay Apps
- Payment status import
- Admin UI for connection management

### Phase 2: Email & Calendar
- Google OAuth + email ingestion (cursor-based incremental sync)
- Microsoft OAuth + email ingestion (Graph API)
- AI classification pipeline (draft-only, governed)
- Calendar two-way sync baseline
- Inbox Review UI

### Phase 3: E-Sign + Approvals + Document Control
- E-sign provider interface + DocuSign implementation
- Generic approval workflows framework
- Approvals wired into COs, SOV/Pay Apps, Time, Vendor bills
- Document control & revisioning with superseded enforcement
- Approvals Inbox UI

### Phase 4: AI Governance + Analytics + Mobile
- AI execution wrapper with cost/usage tracking
- Per-org AI limits and safe modes
- Executive Daily Digest (dashboard widget + email)
- Deterministic Project Health Score (0-100)
- Mobile/Offline V2 (conflict resolution, resilient uploads)
- Hardened test harness

## Feature Flags

| Flag Key | Default | Scope | Description |
|----------|---------|-------|-------------|
| INTEGRATIONS_HUB | OFF | org | Integration Hub access |
| INTEGRATION_QBO | OFF | org | QuickBooks Online sync |
| INTEGRATION_GOOGLE | OFF | org | Google email/calendar |
| INTEGRATION_MICROSOFT | OFF | org | Microsoft email/calendar |
| INTEGRATION_ESIGN | OFF | org | E-signature integration |
| AI_GOVERNANCE | OFF | org | AI cost/usage governance |
| APPROVALS_FRAMEWORK | OFF | org | Approval workflows |
| DOCUMENT_CONTROL | OFF | org | Document revisioning |
| EXECUTIVE_DIGEST | OFF | org | Executive daily digest |
| PROJECT_HEALTH_SCORE | OFF | org | Project health scoring |
| MOBILE_OFFLINE_V2 | OFF | org | Enhanced mobile/offline |

## New Database Tables

| Table | Purpose |
|-------|---------|
| integration_connections | OAuth/API connections per org |
| integration_events_outbox | Event outbox for async dispatch |
| integration_webhook_subscriptions | Webhook endpoint registrations |
| integration_sync_state | Sync cursor/state per provider |
| ai_action_audit | AI action audit trail with costs |
| approval_requests | Generic approval workflow records |
| document_revisions | Document version/revision tracking |
| project_health_snapshots | Project health score history |

## Pricing Recommendations

### Tier Packaging
- **Starter ($89)**: Limited projects/users, basic PM, no QBO, limited AI (5 AI actions/day)
- **Growth ($229)**: Includes AI Notes→Tasks, email ingestion (limited 100 emails/day), approvals inbox
- **Scale ($579)**: QBO + Google/Microsoft + E-sign + webhooks + higher AI limits (500/day) + priority support
- **Hustler ($1,199)**: Multi-company + cross-org analytics + COO mode + unlimited AI

### Add-Ons
- QBO Integration: $49/mo
- E-Sign Integration: $29/mo
- Advanced AI Package: $79/mo (higher limits + AI governance dashboard)
- Multi-Org Hustler Dashboard: included with Hustler tier

## Architecture Principles
1. All changes are additive — no existing features removed
2. Feature flags gate all new modules — OFF by default
3. Multi-tenant isolation enforced on every new query
4. RBAC checks on every new endpoint
5. AI actions produce drafts requiring approval
6. External provider calls include timeout, retry, idempotency
7. Structured logging on all new operations

---

*This document is updated as implementation proceeds.*
