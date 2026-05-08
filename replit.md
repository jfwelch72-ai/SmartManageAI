# SmartManageAI Construction Management Platform

SmartManageAI is a white-label SaaS platform that centralizes and streamlines the construction project lifecycle for enhanced efficiency and compliance.

## Run & Operate

*   **Dev**: `npm run dev` (also the `Start application` workflow)
*   **Build**: `npm run build`
*   **Run (built)**: `npm start`
*   **Typecheck**: `npm run check` (the `typecheck` Replit workflow runs `npx tsc -p tsconfig.json` directly)
*   **DB Push**: `npm run db:push`
*   **Smoke test**: `scripts/smoke-test.sh` (probes a booted server)
*   **CI baseline**: `scripts/ci.sh` (typecheck + build + smoke). See `CONTRIBUTING.md` for the green-baseline rules.

**Required Environment Variables**:
*   `DATABASE_URL`
*   `SESSION_SECRET` (used as the JWT signing key; the server fails fast on boot if missing)
*   `ANTHROPIC_API_KEY` (for Takeoff family AI routing)
*   `STRICT_TENANT_RLS=true` (production only — the server fails fast on boot in production when this is missing or `false`; dev/test may opt out and gets a loud warn). See `docs/architecture/tenant-isolation.md`.

## Green baseline

The following workflows must boot cleanly and stay green:

*   `Start application` — Express + Vite dev server on port 5000
*   `artifacts/mockup-sandbox: Component Preview Server` — preview at `/__mockup/`
*   `typecheck` — `npx tsc -p tsconfig.json`. Restored to zero errors in Task #2647. New code MUST keep it at zero — do not introduce regressions and do not mask with `// @ts-ignore` / `// @ts-expect-error` / `as any`.

## Stack

*   **Frontend**: React, TypeScript, Wouter, TanStack Query, Tailwind CSS, shadcn/ui
*   **Backend**: Express.js (TypeScript)
*   **Database**: PostgreSQL
*   **ORM**: Drizzle ORM
*   **Validation**: Zod
*   **Build Tool**: Vite

## Where things live

*   **Database Schema**: `shared/schema/features/` (split into domain-specific files)
*   **API Contracts**: Defined implicitly by backend routes; pagination contract at `server/utils/pagination.ts` and `docs/api/pagination.md`
*   **UI Components**: `client/src/components/`
*   **Frontend Pages**: `client/src/pages/`
*   **Backend Routes**: `server/routes.ts`, `server/bidRoutes.ts`, `server/aiOnboardingRoutes.ts`, etc.
*   **Object Storage Integration**: `server/objectStorage.ts`
*   **AI Providers Abstraction**: `server/ai/providers/`
*   **Domain-specific Storage Pilots**: `server/bids/storage.ts`, `server/bids/storage.drizzle.ts` (see `docs/architecture/storage-pattern.md`)
*   **Feature Flags**: Defined in `FEATURE_FLAG_KEYS` and managed via Super Admin UI.
*   **Archived Documentation**: `docs/archive/`

## Architecture decisions

*   **Multi-Tenancy with AI-driven Customization**: Platform supports multiple tenants with dynamic features and onboarding tailored by AI for specific trade types.
*   **Unified External Portal (`/portal`)**: Provides a single entry point for Client, Subcontractor, and Vendor access with automatic role-based detection.
*   **Provider-Agnostic Integration Hub**: A framework for centralized management of third-party service connections, gated by feature flags.
*   **AI Provider Routing for Takeoff Features**: Uses a configurable abstraction (`server/ai/providers/`) for OpenAI and Anthropic Claude, with per-org routing via feature flags and automatic fallback.
*   **Domain-Specific Storage Seams**: Gradually breaking up monolithic storage logic into domain-specific modules to improve maintainability and enforce access control (e.g., `server/bids/storage.ts`).
*   **Scalable PDF Handling for Takeoffs**: Implemented range-based GCS downloads and device-aware tile caching to efficiently manage large (up to 32 GB) PDF plans.
*   **Express Async Error Shim**: `server/utils/expressAsyncShim.ts` patches `Layer.prototype.handle_request` at boot so async route handlers that throw without try/catch are forwarded to the central error middleware (Express 4 does not do this natively). `asyncHandler` is still exported for explicit, self-documenting wrapping.
*   **AI Estimator Sheet Indexing & Assemblies (Phase 1)**: `server/services/aiEstimator/sheetIndex.ts` classifies each plan sheet by discipline (G/A/S/M/E/P/C/L/FP/T/Q/I/O) using AI + filename heuristics; persisted on `takeoff_sheets`. `draftTakeoffFromPlans` accepts `disciplines`/`tradeFilter` to scope plan docs per trade and supports up to 8 docs (was 4). Org-level factors, assemblies catalog, and legend symbols live in `ai_estimator_org_factors`, `ai_estimator_assemblies(_components)`, `ai_estimator_legend_symbols`.
*   **Materials Inventory & PM Engine**: `shared/schema/features/inventory.ts` defines `inventory_locations` (WAREHOUSE/YARD/JOBSITE/TRUCK), `inventory_materials` (with optional barcode/QR), `inventory_stock_levels` (on-hand by material × location), `inventory_transactions` (RECEIPT / ISSUE / TRANSFER_OUT / TRANSFER_IN / ADJUSTMENT / CYCLE_COUNT with reason codes), and `inventory_cycle_counts` + `_lines`. All endpoints in `server/inventoryRoutes.ts`: receive (auto-bumps `purchaseOrderItems.quantityReceived`), issue-to-project (cost burden via avg unit cost), transfer (paired txns), adjust (ADMIN/MANAGER + reason), cycle counts (start/record/approve posts variance), reports (low-stock, slow-moving), and barcode lookup `GET /api/inventory/materials/by-barcode/:code`. Equipment PM engine `server/equipmentPmEngine.ts` walks active `equipment_maintenance_schedules` and idempotently inserts PENDING `equipment_repairs` tagged `[PM:<scheduleId>]`; triggered via `POST /api/equipment/maintenance/generate-work-orders`. Frontend at `/inventory` (`client/src/pages/inventory.tsx`).
*   **Cross-Replica Messaging Bus**: Unified messaging SSE/WS events fan out across pods via Postgres LISTEN/NOTIFY (`server/messagingBus.ts`); originating pod ignores its own echo via per-pod `PEER_POD_ID`.
*   **Project Closeout Package**: `shared/schema/features/closeout.ts` defines configurable `closeoutTemplates` + `closeoutTemplateItems`, per-project `closeoutChecklists` (unique per project), `closeoutItems`, and `closeoutPackages`. `server/closeoutRoutes.ts` provides template CRUD, checklist init (with `DEFAULT_TEMPLATE_ITEMS` covering OM/Warranty/As-Built/Lien/Permit/Punch/Inspection), `/auto-pull` (scans warrantyDocuments, lienWaivers, projectPermits, punchListItems, projectInspections, planDocuments, assetHandoverItems and attaches sources by category), and `/export` which streams a ZIP via `archiver` with TOC PDF (`pdfkit`) to the client and uploads to GCS under `${PRIVATE_OBJECT_DIR}/${orgId}/closeout/`. Punch list adds `GET /projects/:code/punch-list/walkthrough` grouping items by location for site walks. UI at `client/src/pages/project-closeout.tsx`, surfaced as a "Closeout" tab on Project Detail.
*   **Tenant Isolation via Postgres RLS (Tasks #2478 + #2673 ratchet closed)**: Defense-in-depth on top of `getOrgFilter`. Fail-closed `tenant_isolation` policy with `FORCE ROW LEVEL SECURITY` on every multi-tenant table (`migrations/0096_enable_tenant_rls.sql` + `server/utils/ensureRlsPolicies.ts`). `server/middleware/orgContext.ts` wraps EVERY authenticated request in a non-elevated `withOrgContext()` — SUPER_ADMIN sessions are NOT auto-elevated; cross-tenant access requires explicit `runAsSuperadmin(reason, fn, { actorId? })` which writes to the dedicated `superadmin_access_log` table BEFORE elevating and refuses on audit failure. The `db` export is a Proxy that routes through the ALS-bound client when a context is active. **`STRICT_TENANT_RLS=true` is the production default** — `server/index.ts` fails fast on boot in production when it's missing or `false`. With it on, the connect-default `app.is_superadmin` flips to `'false'` so any DB query that escaped a context wrapper returns zero rows instead of silently spanning tenants. All per-org loops in `server/jobs/jobRunner.ts` are wrapped via `withJobOrgContext("<job-name>", org.organizationId, …)` — including `processComplianceExpirations` (Task #2674 moved per-org dedupe + insert inside the wrapper so RLS pins them to the current tenant). Cross-tenant cron sweeps (outbox drain, retention, integration sync, periodic reports, …) inherit a system-wide context for free because `withSchedulerLock` now wraps every locked tick in `withSystemJobContext("<job-name>")` (`server/utils/schedulerLock.ts`); `withSystemJobContext` is AUDITED — it delegates to `runAsSuperadmin("system-job:<name>", …)` so every cross-tenant elevation lands in `superadmin_access_log`. Lint guards: `scripts/check-db-imports.mjs` (proxy bypass) and `scripts/check-job-context.mjs` (background-job DB access without a context wrapper) — both wired into `scripts/ci.sh`. Full design: `docs/architecture/tenant-isolation.md`.
*   **Billing & Subscription Productization (Task #2482)**: Plans/add-ons/quotas in `shared/billing/plans.ts` are the single source of truth (`PLAN_LIMITS` includes seats, AI tokens, AI jobs, AI vision docs, storage GB; price IDs resolved from env vars listed in `STRIPE_PRICE_ENV_VARS`). Stripe SDK lazy-init in `server/services/billing/stripeService.ts`; the suite is in `server/services/billing/{seatEnforcement,usageMetering,dunning,webhookHandler}.ts`. Self-serve endpoints `POST /api/billing/{checkout,portal,migrate-to-stripe,dunning/run}` plus `GET /api/billing/{seats,usage/all}`. Stripe webhook at `POST /api/stripe/webhook` (`server/stripeWebhookRoutes.ts`) — CSRF-exempt and signature-verified using `req.rawBody` from the JSON parser. Idempotency via the `stripe_webhook_events` table (unique `stripe_event_id`). Failed payments stamp `payment_failed_at`/`grace_period_ends_at`; `runDunningCycle` sends day 0/3/7 reminders and suspends on day `DUNNING_GRACE_PERIOD_DAYS`. Seat enforcement hooked into `POST /api/platform/users` via `assertSeatAvailable`; per-org overrides on `organization_subscriptions.{seat,ai_token,storage_gb}_quota_override`.
*   **Load Testing, Performance Budgets & Capacity Plan (Task #2488)**: k6 suite under `loadtests/` exercises the top-20 endpoints (`loadtests/lib/endpoints.js`) at four profiles (`smoke`/`baseline`/`nightly`/`spike`, configured via `LOAD_PROFILE` in `loadtests/lib/config.js`). Per-endpoint p95 + error-rate budgets live in `loadtests/budgets.json` and are enforced by `loadtests/check-budgets.mjs` (regressionTolerance 15%). PRs run the smoke profile via the `load-test-smoke` job in `.github/workflows/ci.yml`; nightly + noisy-neighbor runs via `.github/workflows/load-test-nightly.yml`. The noisy-neighbor scenario (`loadtests/scenarios/noisy-neighbor.js`) splits VUs into heavy/quiet cohorts and asserts the quiet cohort stays within budget. Frontend Web Vitals captured by `client/src/lib/webVitals.ts` (no third-party dep — native PerformanceObserver) ship to `POST /api/observability/web-vitals` (CSRF-exempt, anonymous), feed an in-memory rolling aggregator (`server/webVitalsRoutes.ts`), and surface as `app_web_vitals_*` gauges on the `/metrics` Prometheus scrape. Capacity plan + tested ceilings + next bottleneck per tier: `docs/ops/capacity.md`.
*   **Prompt-Injection Guard Enforcement (Task #2683)**: The `quarantineUntrustedText` / `quarantineDocumentBlocks` / `validateAiJsonOutput` contract from `server/ai/promptInjectionGuard.ts` is now mechanically enforced. New helpers `quarantineUserText(label, text)` (closes the stored-injection vector for tenant-DB strings spliced inline into prompts — sheet filenames, RFI bodies, assembly names) and `recordPromptInjectionDetection` / `recordDetectionMatches` (in-process counter) ship alongside an expanded pattern set (`delimiter_escape`, `encoded_payload_hint`, `im_start/end`, broader `tool_override` / `exfiltration` / `jailbreak`). Detection runs on a normalized form (zero-width chars stripped, whitespace collapsed) so `i\u200bgnore previous` no longer slips by. Counter is exposed on `/metrics` as `ai_prompt_injection_detections_total{route,pattern_id,action}` (action ∈ flagged | refused | quarantined). CI guard `scripts/check-prompt-injection-guard.mjs` (wired into `scripts/ci.sh`) fails the build if any new file under `server/` calls `openai.chat.completions.create` / `routedChatCompletion` / `callOpenAIForAnalysis` without either importing the guard or carrying a top-of-file `// prompt-injection-guard: <reason>` annotation. Reference site for stored injection: `server/services/aiEstimator/mapReduceDraft.ts` (sheet filenames now wrapped via `quarantineUserText` before being spliced into the discipline-batch envelope). Full playbook: `docs/architecture/prompt-injection.md`. Triage flow: `docs/runbooks/observability.md`.
*   **Support, Help Center & SLA**: In-app `HelpWidget` + public `/help` and `/sla` pages back an internal-first ticket pipeline (`server/supportRoutes.ts`, `support_tickets` table). SLA tier targets (uptime %, channels, status cadence, priority-keyed first-response & resolution) live in **one canonical, framework-free module: `shared/sla/policy.ts`**. `server/support/slaPolicy.ts` re-exports `SLA_TIERS` from there (keeping only the business-hours/holiday computation helpers); `client/src/pages/sla.tsx` renders the public table via `buildTierTableRows()` from `shared/sla/format.ts`; and `docs/sla.md` is mechanically generated from the canonical module by `scripts/generate-sla-doc.ts`. CI guard `scripts/check-sla-doc.mjs` (wired into `scripts/ci.sh`) fails the build if the committed `docs/sla.md` drifts. A weekly KPI digest (`server/supportWeeklyReport.ts`, cron `0 13 * * 1`) emails recipients listed in `SUPPORT_REPORT_RECIPIENTS`. Help articles are Markdown files in `docs/help/` indexed by `manifest.json`. **Pattern note:** the same "canonical module + generated doc + CI parity check" recipe is the recommended fix for any other doc-vs-code duplication discovered later.

## Product

*   **Comprehensive Project Lifecycle Management**: Bids, Projects, Estimates, Procurement, Change Orders, Time & Material Tracking, Contract Management, CPM Scheduling.
*   **Advanced Estimating Engine**: Takeoff workspace with drawing tools, material calculation, 6-step bid workflow, real-time collaboration, and versioning.
*   **Integrated CRM**: Manages entities, vendor pricing, rental equipment, compliance, and a 7-stage Sales Pipeline.
*   **Robust Workforce Management**: Native time-clock (GPS/geofence), shift management, cost code tracking, manager approval, configurable overtime, and certified payroll.
*   **Financial Management Suite**: Budget vs Actual Cost, CFO Forecasting, Live Project Profitability, Revenue Recognition, AIA Progress Billing, 3-Way Match Procurement, Payment & Invoice Tracking.
*   **AI Governance System**: Oversees all AI integrations for generation, analysis, scheduling, and automation.
*   **Mobile Field App**: Native Expo/React Native app with offline sync for daily reports, time clock, photos, punch list, RFIs, and inspections.
*   **BIM & LiDAR Integration**: Client-side IFC parsing, 3D BIM Viewer, and LiDAR Scanner Module for point cloud analysis.
*   **No-Code Workflow Builder**: Visual editor for custom approval chains, status pipelines, and notification triggers.

## User preferences

I prefer clear, concise explanations and direct answers. I value an iterative development approach, focusing on delivering functional components incrementally. Please ask for my confirmation before implementing any major architectural changes or refactoring large portions of the codebase. I also prefer detailed explanations for complex solutions or significant design decisions.

## Gotchas

*   **Migration Filename Collisions**: Drizzle + `server/utils/runStartupMigrations.ts` apply migrations in filename order, and `server/utils/migrationStartupCoverage.ts` keys on the full filename — so duplicate 4-digit prefixes are a latent bug. Historical collisions were renumbered (0085-0093) and 20 remaining historical duplicates are tracked for renumber in Task #2435. **Prevention (Task #2685)**: `scripts/check-migration-collisions.mjs` (wired into `scripts/ci.sh`) fails the build on any *new* duplicate prefix and on stale allowlist entries; `scripts/new-migration.mjs <slug>` hands out the next free prefix and refuses to run while duplicates are unresolved. Full playbook + journal/`migrationStartupCoverage.ts` reconciliation steps: `docs/ops/migration-collisions.md`.
*   **Legacy `drizzle/` directory**: Removed; its content superseded and auto-applied by `reconcileSchemaDrift`.
*   **AI Provider Routing (Takeoff)**: Ensure `AI_PROVIDER_TAKEOFF` feature flag is correctly configured for Anthropic Claude usage and fallbacks. Embeddings and other AI features still use OpenAI directly.
*   **`server/storage.ts`** *(retired Task #2672)*: The legacy monolith has been deleted. Its remaining exports were split into per-domain seams: `server/crm/transcriptBackfillStorage.ts` (CRM transcript backfill jobs, alert-failure pipeline, org-admin alert helpers), `server/executiveDigest/storage.ts` (executive digest snapshots), and `server/dot/payItemPickerFacetsStorage.ts` (DOT pay-item picker facets). A CI freeze guard (`scripts/check-legacy-storage.mjs`, wired into `scripts/ci.sh`) fails the build if `server/storage.ts` is recreated or any `server/*.ts` file imports `./storage` / `../storage` (the `server/bids/` seam is allowlisted because it is its own domain).
*   **SLA tier values (Task #2680)**: Edit `shared/sla/policy.ts` only. After any change, run `npx tsx scripts/generate-sla-doc.ts` to rewrite `docs/sla.md` and commit the regenerated file — `scripts/check-sla-doc.mjs` (in `scripts/ci.sh`) fails the build on drift, and the public `/sla` page + the server enforcement both import directly from the canonical module.
*   **Typecheck baseline (Task #2647)**: `npm run check` is now at **zero errors** and the `typecheck` workflow is part of the green baseline. The remaining backlog from Task #2490 was actually a single broken file (`client/src/pages/ai-estimator-admin.tsx`) where the `AssemblyEditorDialog` JSX body had been spliced into the middle of the `SettingsTab` region-factors form — restoring the original ordering closed all 222 reported errors. `tsconfig.json` runs with `incremental: true` and a `tsBuildInfoFile` under `node_modules/.cache/typecheck/` so subsequent runs reuse build info and don't OOM. **Rule for all new work**: keep the count at zero and do not mask with `// @ts-ignore` / `// @ts-expect-error` / `as any`. Run `npm run check 2>&1 | grep -c "error TS"` before/after your change to confirm.

## Security

*   **Threat model**: `threat_model.md` (HTTP hardening, rate limits, upload safety, audit log coverage, prompt-injection defenses, secret rotation).
*   **Env template**: `.env.example` — copy to `.env` and fill in. Never commit a real `.env`.
*   **Prompt-injection guard**: `server/ai/promptInjectionGuard.ts` — wrap any new untrusted-document → LLM path through `quarantineDocumentBlocks` + `detectPromptInjection`.

## Pointers

*   **On-Call Runbook**: `docs/ops/runbook.md` (top 6 incident scenarios)
*   **Backups & Restore Drill**: `docs/ops/backups.md`
*   **Status Page**: `docs/ops/status-page.md`
*   **Metrics Catalog (`/metrics`)**: `docs/ops/metrics.md`
*   **Observability Triage**: `docs/runbooks/observability.md`
*   **Pagination Contract**: `docs/api/pagination.md`
*   **Storage Seam Architecture Pattern**: `docs/architecture/storage-pattern.md`
*   **Tenant Isolation (RLS)**: `docs/architecture/tenant-isolation.md`
*   **Manual → Stripe Billing Migration Playbook**: `docs/billing/manual-to-stripe-playbook.md`
*   **Replit AI Integrations**: [Link to Replit AI Docs]
*   **Drizzle ORM Documentation**: [Link to Drizzle ORM Docs]
*   **TanStack Query Documentation**: [Link to TanStack Query Docs]
*   **Tailwind CSS Documentation**: [Link to Tailwind CSS Docs]
*   **shadcn/ui Documentation**: [Link to shadcn/ui Docs]