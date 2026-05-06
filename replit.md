# SmartManageAI Construction Management Platform

SmartManageAI is a white-label SaaS platform that centralizes and streamlines the construction project lifecycle for enhanced efficiency and compliance.

## Run & Operate

*   **Run**: `npm start`
*   **Build**: `npm run build`
*   **Typecheck**: `npm run typecheck`
*   **Codegen**: `npm run codegen`
*   **DB Push**: `npm run db:push`

**Required Environment Variables**:
*   `DATABASE_URL`
*   `JWT_SECRET`
*   `ANTHROPIC_API_KEY` (for Takeoff family AI routing)

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

*   **Migration Filename Collisions**: Historical collisions were renumbered (0085-0093).
*   **Legacy `drizzle/` directory**: Removed; its content superseded and auto-applied by `reconcileSchemaDrift`.
*   **AI Provider Routing (Takeoff)**: Ensure `AI_PROVIDER_TAKEOFF` feature flag is correctly configured for Anthropic Claude usage and fallbacks. Embeddings and other AI features still use OpenAI directly.
*   **`server/storage.ts`**: This file is intentionally *not* deleted yet; other domains will incrementally adopt the new storage seam pattern.

## Pointers

*   **Pagination Contract**: `docs/api/pagination.md`
*   **Storage Seam Architecture Pattern**: `docs/architecture/storage-pattern.md`
*   **Replit AI Integrations**: [Link to Replit AI Docs]
*   **Drizzle ORM Documentation**: [Link to Drizzle ORM Docs]
*   **TanStack Query Documentation**: [Link to TanStack Query Docs]
*   **Tailwind CSS Documentation**: [Link to Tailwind CSS Docs]
*   **shadcn/ui Documentation**: [Link to shadcn/ui Docs]