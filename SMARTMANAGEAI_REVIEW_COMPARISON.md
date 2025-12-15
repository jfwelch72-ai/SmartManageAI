You are a Principal Engineer performing a FULL, SYSTEM-WIDE AUDIT of the SmartManageAI platform.

CONTEXT:
- This is a production-grade, multi-tenant construction management SaaS.
- Multiple major upgrades were recently implemented (trades, SOW, modifiers, AI, weather, marketplace, onboarding, etc.).
- Your task is NOT to build or modify features.
- Your task is to VERIFY that the ENTIRE PLATFORM works as an integrated system.

ABSOLUTE RULES:
- DO NOT add new features.
- DO NOT refactor.
- DO NOT change schema.
- DO NOT "improve" code.
- READ, TRACE, TEST, and REPORT ONLY.
- If something is missing, broken, unused, or partially wired, FLAG IT CLEARLY.

============================================================
SECTION 1 — PLATFORM INVENTORY & ARCHITECTURE
============================================================

Produce a concise but complete inventory of:
- Frontend pages & routes
- Backend route groups & services
- Database schema (tables, enums, relationships)
- AI engines & orchestrators
- Background jobs / schedulers
- Third-party integrations (Stripe, Weather, OpenAI, storage, email)

Flag:
- Orphaned files
- Dead routes
- Unused services
- Duplicate logic

============================================================
SECTION 2 — AUTHENTICATION, RBAC & MULTI-TENANCY
============================================================

Verify:
- Authentication lifecycle (login, logout, token refresh)
- Role hierarchy (SUPER_ADMIN, ADMIN, MANAGER, EMPLOYEE, VENDOR, HUSTLER)
- Org isolation enforced on:
  - Queries
  - Mutations
  - AI context
  - File access

Attempt to identify:
- Any route missing org scoping
- Any role bypass
- Any SUPER_ADMIN leakage paths

============================================================
SECTION 3 — BILLING, ENTITLEMENTS & FEATURE GATING
============================================================

Audit:
- Stripe integration
- Subscription tiers
- Add-ons
- FeatureGate / requireFeature usage

Verify:
- Paid features are gated correctly
- Free tiers cannot access premium tools
- Feature overrides work as intended
- Billing state is respected across frontend, backend, and AI

============================================================
SECTION 4 — CORE OPERATIONS MODULES
============================================================

Audit end-to-end flow for:
- Projects
- Estimates
- Bids
- Trades, SOW, modifiers
- Material calculators
- Schedules
- Time tracking
- Daily reports

Verify:
- Data flows correctly between modules
- No silent failures
- No inconsistent representations of the same entity

============================================================
SECTION 5 — FIELD, RISK & EVIDENCE SYSTEMS
============================================================

Audit:
- Delay tracking
- Delay claims
- Weather integration
- Daily report locking
- Photo custody
- Issue capture
- Voice logs
- Offline sync

Verify:
- Evidence immutability
- Weather → delay linkage
- Org-scoped access
- Audit trails

============================================================
SECTION 6 — MARKETPLACE & VENDOR SYSTEMS
============================================================

Audit:
- Vendor records
- Vendor pricing catalogs
- PDF → AI pricebook ingestion
- Vendor scoring
- Material price index
- Crew marketplace

Verify:
- Data consistency
- Approval workflows
- No cross-org leakage
- Pricing accuracy paths

============================================================
SECTION 7 — AI SYSTEMS (CRITICAL)
============================================================

Audit ALL AI functionality:
- Orchestrator
- SnapshotBuilder
- AI PM
- AI CFO
- AI Estimator
- AI Onboarding Wizard
- Trade discovery
- Scope prediction
- What-if simulations

Verify:
- AI has access to all required data
- Prompts are consistent
- No stale or missing context
- AI suggestions are explainable
- No AI auto-mutation of master data

============================================================
SECTION 8 — ONBOARDING & USER EXPERIENCE
============================================================

Audit onboarding flows for:
- New companies
- Trade discovery
- Feature selection
- Billing activation
- Role assignment

Verify:
- AI guidance is accurate
- Users are not trapped
- Overrides are respected
- UX matches backend behavior

============================================================
SECTION 9 — EXECUTIVE & ADMIN TOOLS
============================================================

Audit:
- Executive dashboards
- Health scores
- Benchmarks
- Unified inbox
- Platform admin tools

Verify:
- Data accuracy
- Permission boundaries
- Performance

============================================================
SECTION 10 — PERFORMANCE, STABILITY & OBSERVABILITY
============================================================

Check:
- Query performance on large datasets
- API response times
- Frontend rendering issues
- Logging & monitoring coverage
- Error handling

============================================================
DELIVERABLES (PRINT CLEARLY)
============================================================

1. Overall Platform Status:
   - READY
   - READY WITH FIXES
   - NOT READY

2. Critical Issues (must fix before prod)
3. Major Issues (functional gaps)
4. Minor Issues (polish)
5. Security Risks (if any)
6. Orphaned / unused components
7. Recommended NEXT STEPS (audit-driven, not speculative)

DO NOT FIX ANYTHING.
ONLY REPORT.
