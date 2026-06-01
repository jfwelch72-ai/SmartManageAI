# SmartManageAI Construction Management Platform

SmartManageAI is a white-label SaaS platform that centralizes and streamlines the construction project lifecycle for enhanced efficiency and compliance.

## Run & Operate

*   **Dev**: `npm run dev` (also the `Start application` workflow)
*   **Build**: `npm run build`
*   **Run (built)**: `npm start`
*   **Typecheck**: `npm run check` (runs `tsc --build` via project references)
*   **DB Push**: `npm run db:push`
*   **Smoke test**: `scripts/smoke-test.sh` (probes a booted server)
*   **CI baseline**: `scripts/ci.sh` (typecheck + build + smoke). See `CONTRIBUTING.md` for the green-baseline rules.

**Required Environment Variables**:
*   `DATABASE_URL`
*   `SESSION_SECRET` (JWT signing key; server fails fast on boot if missing)
*   `ANTHROPIC_API_KEY` (for Takeoff family AI routing)
*   `STRICT_TENANT_RLS=true` (production only — server fails fast on boot if missing or `false`; dev/test may opt out). See `docs/architecture/tenant-isolation.md`.

**Optional Environment Variables**:
*   `ADDITIONAL_ALLOWED_ORIGINS` (comma-separated CORS allowlist for non-Replit origins, e.g. the mobile app's Expo/EAS/Replit preview domains; supports suffix-wildcard entries like `https://*.replit.app`). Non-production also auto-allows `http://localhost:19006`, `http://localhost:8081`, and `http://localhost:5000` for Expo web / Metro. See `docs/ops/runbook.md` §8.

## Green Baseline

The following workflows must boot cleanly and stay green:

*   `Start application` — Express + Vite dev server on port 5000
*   `artifacts/mockup-sandbox: Component Preview Server` — preview at `/__mockup/`
*   `typecheck` — `tsc --build` (project references). Zero errors enforced — do not mask with `// @ts-ignore` / `// @ts-expect-error` / `as any`.

## Stack

*   **Frontend**: React, TypeScript, Wouter, TanStack Query, Tailwind CSS, shadcn/ui
*   **Backend**: Express.js (TypeScript)
*   **Database**: PostgreSQL
*   **ORM**: Drizzle ORM
*   **Validation**: Zod
*   **Build Tool**: Vite

## Where Things Live

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

## User Preferences

I prefer clear, concise explanations and direct answers. I value an iterative development approach, focusing on delivering functional components incrementally. Please ask for my confirmation before implementing any major architectural changes or refactoring large portions of the codebase. I also prefer detailed explanations for complex solutions or significant design decisions.

## See Also

### Architecture & Design Decisions
*   **Full ADR notes**: `docs/architecture/decisions.md` — all significant design decisions (multi-tenancy, AI routing, billing, closeout, sidebar, tab deep-linking, etc.)
*   **Tenant Isolation (RLS)**: `docs/architecture/tenant-isolation.md`
*   **AI Provider Routing**: `docs/architecture/ai-provider-routing.md`
*   **Prompt-Injection Defense**: `docs/architecture/prompt-injection.md`
*   **Storage Seam Pattern**: `docs/architecture/storage-pattern.md`
*   **Job Queue**: `docs/architecture/job-queue.md`

### Gotchas & Rules
*   **All gotchas**: `docs/ops/gotchas.md` — migration collisions, legacy storage, AI routing rules, SLA doc regeneration, typecheck baseline, TypeScript project references, JSX generic args.

### Security
*   **Security quick reference**: `docs/ops/security-quickref.md` — prompt-injection guard, tenant isolation, upload safety, secret hygiene.
*   **Full threat model**: `threat_model.md`

### Operations
*   **On-Call Runbook**: `docs/ops/runbook.md` (incident scenarios)
*   **Backups & Restore Drill**: `docs/ops/backups.md`
*   **Status Page**: `docs/ops/status-page.md`
*   **Metrics Catalog (`/metrics`)**: `docs/ops/metrics.md`
*   **Capacity Plan**: `docs/ops/capacity.md`
*   **Migration Collisions Playbook**: `docs/ops/migration-collisions.md`
*   **Observability Triage**: `docs/runbooks/observability.md`

### Other Docs
*   **Module Directory**: `docs/module-directory.md` — every product module: purpose, pages, components, routes, schema files, and access roles.
*   **Pagination Contract**: `docs/api/pagination.md`
*   **Billing Migration Playbook**: `docs/billing/manual-to-stripe-playbook.md`
*   **Product Features**: `docs/product/features.md`
*   **Module Directory**: `docs/product/modules.md` — full list of product modules and their descriptions
*   **SLA**: `docs/sla.md` (generated from `shared/sla/policy.ts` — do not edit directly)
