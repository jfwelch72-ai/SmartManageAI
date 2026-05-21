# SmartManageAI Architecture Map

> **Last updated:** May 2026. Source of truth for server structure, AI routing, storage pattern, job queue, and tenant isolation. If this document conflicts with the code, the code is authoritative.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER                                │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │  React + TypeScript + Vite                                           │ │
│  │  ├── TanStack Query v5 (data fetching)                              │ │
│  │  ├── Wouter (routing)                                                │ │
│  │  ├── Tailwind CSS + shadcn/ui (styling)                             │ │
│  │  └── React Hook Form + Zod (forms & validation)                     │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼ HTTP/REST + SSE
┌─────────────────────────────────────────────────────────────────────────┐
│                              SERVER LAYER                                │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │  Express.js + TypeScript                                             │ │
│  │  ├── Authentication (JWT + httpOnly cookies, tokenVersion)           │ │
│  │  ├── CSRF protection (server/csrf.ts)                               │ │
│  │  ├── Rate Limiting (Postgres-backed, multi-limiter)                 │ │
│  │  ├── RBAC Middleware (requireRole)                                  │ │
│  │  ├── Org Context Middleware (RLS session vars)                      │ │
│  │  └── Audit Logging (append-only audit_log table)                   │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │  Background Worker Process (server/worker.ts)                        │ │
│  │  ├── pg-boss job queue (Postgres-backed)                            │ │
│  │  ├── AI takeoff / document analysis handlers                        │ │
│  │  └── Per-tenant RLS context (withJobOrgContext)                     │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
┌──────────────────────┐ ┌──────────────────┐ ┌──────────────────────┐
│      DATABASE        │ │   FILE STORAGE   │ │      AI SERVICE      │
│  PostgreSQL (Neon)   │ │  Replit Object   │ │  Anthropic Claude    │
│  Drizzle ORM         │ │  Storage (GCS)   │ │  (primary, Task#2851)│
│  Row-Level Security  │ │  Signed URLs     │ │  OpenAI GPT (fallback│
│  (STRICT_TENANT_RLS) │ │                  │ │  or vision-only)     │
└──────────────────────┘ └──────────────────┘ └──────────────────────┘
```

## Technology Stack

### Frontend
| Technology | Purpose | Location |
|------------|---------|----------|
| React 18 | UI framework | `client/src/` |
| TypeScript | Type safety | `*.tsx`, `*.ts` |
| Vite | Build tool | `vite.config.ts` |
| TanStack Query v5 | Server state | `client/src/lib/queryClient.ts` |
| Wouter | Client routing | `client/src/App.tsx` |
| Tailwind CSS | Styling | `client/src/index.css` |
| shadcn/ui | Components | `client/src/components/ui/` |
| React Hook Form | Forms | Throughout pages |
| Zod | Validation | `shared/schema/` |

### Backend
| Technology | Purpose | Location |
|------------|---------|----------|
| Express.js | HTTP server | `server/index.ts` |
| TypeScript | Type safety | `server/*.ts` |
| Drizzle ORM | Database queries | `server/db.ts` (ALS proxy) |
| bcrypt | Password hashing | `server/auth.ts` |
| jsonwebtoken | JWT auth | `server/auth.ts` |
| pg-boss | Background job queue | `server/jobQueue/index.ts` |
| node-cron / schedulerLock | In-process scheduled tasks | `server/utils/schedulerLock.ts` |

### Database
| Technology | Purpose | Location |
|------------|---------|----------|
| PostgreSQL | Primary database | Neon hosted |
| Drizzle Kit | Migrations | `drizzle.config.ts` |
| Postgres RLS | Tenant isolation | `migrations/0096_enable_tenant_rls.sql` |

### External Services
| Service | Purpose | Integration |
|---------|---------|-------------|
| Anthropic Claude | AI primary (Takeoff + General families) | `server/ai/providers/anthropicProvider.ts` |
| OpenAI GPT-4o | AI fallback; Vision (image_url) pipelines | `server/ai/providers/openaiProvider.ts` |
| Replit Object Storage | File storage | `server/objectStorage.ts` |
| SendGrid | Email delivery | `server/email.ts` |
| Stripe | Subscription billing | `server/billingRoutes.ts` |

## Module Map

### Server Modules

```
server/
├── index.ts              # Express app entry point; STRICT_TENANT_RLS fail-fast
├── routes.ts             # Core route registration
├── auth.ts               # Authentication logic, requireRole, tokenVersion
├── db.ts                 # Database connection + ALS proxy (RLS-scoped client)
├── dbContext.ts          # withOrgContext, runAsSuperadmin, withJobOrgContext
├── worker.ts             # Dedicated background worker entrypoint (pg-boss)
│
├── Route Files:
│   ├── bidRoutes2.ts               # Bid endpoints (uses BidStorageDrizzle seam)
│   ├── estimateRoutes.ts           # Estimating endpoints
│   ├── timeClockRoutes.ts          # Time tracking
│   ├── payrollRoutes.ts            # Pay runs and payroll
│   ├── payrollSettingsRoutes.ts    # Payroll config
│   ├── changeOrderRoutes.ts        # Change orders (PCO workflow)
│   ├── changeOrderHelpers.ts       # CO approval chain helpers
│   ├── contractRoutes.ts           # Contract lifecycle
│   ├── delayRoutes.ts              # Delay tracking
│   ├── delayClaimsRoutes.ts        # Delay claims
│   ├── inspectionRoutes.ts         # Inspections
│   ├── tmTicketRoutes.ts           # T&M tickets
│   ├── sovRoutes.ts                # Schedule of values + AIA pay apps
│   ├── bidNetworkRoutes.ts         # Bid network
│   ├── websiteBuilderRoutes.ts     # Website builder
│   ├── marketplaceRoutes.ts        # Marketplace features
│   ├── vendorPricebookRoutes.ts    # Vendor pricing
│   ├── laborRateRoutes.ts          # Labor rates
│   ├── subcontractRoutes.ts        # Subcontracts
│   ├── subcontractorPayablesRoutes.ts # Payables
│   ├── emailAccountRoutes.ts       # Email integration
│   ├── emailAiRoutes.ts            # Email AI
│   ├── fieldProductivityRoutes.ts  # Field tools
│   ├── organizationDocumentRoutes.ts  # Org docs (compliance)
│   ├── dashboardCustomizationRoutes.ts # Dashboard widgets
│   ├── hustlerRoutes.ts            # Multi-org HUSTLER role
│   ├── platformAdminRoutes.ts      # Platform admin (SUPER_ADMIN)
│   ├── billingRoutes.ts            # Stripe subscription billing
│   ├── weatherRoutes.ts            # Weather data
│   ├── opsRoutes.ts                # /health, /ready, /metrics
│   ├── auditBillingStorageRoutes.ts # Object upload + AV scan + billing
│   ├── jobQueueAdminRoutes.ts      # pg-boss admin UI endpoints
│   └── notesRoutes.ts              # Notes
│
├── Bids Domain Storage Seam (canonical pattern):
│   └── bids/
│       ├── storage.ts              # IBidStorage interface + CrossOrgAccessError
│       ├── storage.drizzle.ts      # BidStorageDrizzle (Drizzle implementation)
│       └── __tests__/storage.test.ts  # Tenancy contract tests
│
├── Other Domain Seams (Task #2672):
│   ├── crm/transcriptBackfillStorage.ts  # CRM-related helpers
│   ├── executiveDigest/storage.ts         # Executive digest snapshot helpers
│   └── dot/payItemPickerFacetsStorage.ts  # DOT pay-item picker facets
│
├── AI Modules:
│   ├── aiRoutes.ts                 # AI PM + takeoff endpoints
│   ├── aiAssistantRoutes.ts        # AI assistant (chat)
│   ├── aiBidDocumentRoutes.ts      # Bid doc analysis
│   ├── aiContractDocumentRoutes.ts # Contract analysis
│   ├── aiNotesRoutes.ts            # Note insights
│   ├── aiDocumentRoutes.ts         # Document analysis (SSRF-guarded)
│   ├── aiOnboardingRoutes.ts       # AI onboarding wizard
│   └── ai/
│       ├── providers/              # AI provider abstraction (Task #2684)
│       │   ├── index.ts            # routedChatCompletion, routedGeneralChatCompletion, routedEmbedding
│       │   ├── types.ts            # AiChatRequest, TakeoffFeatureKey, GeneralFeatureKey
│       │   ├── openaiProvider.ts   # OpenAI implementation
│       │   ├── anthropicProvider.ts # Anthropic/Claude implementation
│       │   └── embeddingProvider.ts # Embedding seam (OpenAI text-embedding-3-large)
│       ├── orchestrator.ts         # AI run coordination
│       ├── snapshotBuilder.ts      # Data snapshot for AI PM
│       ├── moduleAnalyzers.ts      # Analysis modules
│       ├── systemPrompt.ts         # AI prompts
│       ├── assistantPrompt.ts      # Assistant prompts
│       ├── openaiClient.ts         # Raw OpenAI client (vision bypass only)
│       ├── promptInjectionGuard.ts # quarantineUntrustedText, detectPromptInjection, validateAiJsonOutput
│       ├── emailAi.ts              # Email classification
│       ├── scheduler.ts            # AI scheduling (cron)
│       ├── profitabilityEngine.ts  # Profitability analysis
│       ├── scopePredictionEngine.ts # Scope prediction
│       ├── dataQualityScorer.ts    # Data quality
│       ├── tradeDiscoveryService.ts # Trade discovery
│       ├── vendorPriceListExtractor.ts # Price extraction
│       └── walkthroughContent.ts   # Onboarding content
│
├── Job Queue (pg-boss):
│   └── jobQueue/
│       ├── index.ts                # Boss singleton, enqueueJob, getJobStatus, DLQ helpers
│       └── handlers/               # Job handlers (ai_takeoff_analyze, ai_document_analyze, …)
│
├── Background Jobs (in-process schedulers):
│   └── jobs/jobRunner.ts           # Cron scheduler: compliance-expiration, equipment PM, payroll digest, CRM digests
│
├── Services:
│   ├── pdf-service.ts              # PDF generation
│   ├── sov-pdf-service.ts          # SoV PDFs
│   ├── subcontract-pdf-service.ts  # Subcontract PDFs
│   ├── productionRateService.ts    # Production rates
│   ├── dataPipelineService.ts      # Data pipelines
│   ├── aiNotesService.ts           # Note analysis
│   ├── organizationBranding.ts     # Branding
│   ├── uploadAvScanner.ts          # AV scan on upload (EICAR + Cloudmersive)
│   ├── fileValidation.ts           # MIME allowlist, size caps
│   └── bidNetworkNotifications.ts  # Bid notifications
│
├── Middleware:
│   ├── rateLimiter.ts              # Postgres-backed rate limiters (authLimiter, uploadLimiter, etc.)
│   ├── orgFilter.ts                # getOrgIdForFilter (legacy; prefer orgContextMiddleware)
│   ├── sanitization.ts             # Input sanitization
│   ├── csrf.ts                     # CSRF cookie+header pair
│   └── middleware/
│       ├── orgContext.ts           # orgContextMiddleware (wraps every authenticated request in withOrgContext)
│       └── requireFeature.ts       # Feature gating
│
├── Utilities:
│   ├── auditLogger.ts              # logCreate, logAuthEvent, logRoleChange — all money/auth paths covered
│   ├── email.ts                    # Email sending (SendGrid)
│   ├── objectStorage.ts            # Replit Object Storage (GCS)
│   ├── objectAcl.ts                # Object ACL (per-tenant prefix)
│   ├── fileAccessHelpers.ts        # Signed URL helpers
│   ├── materialCalculator.ts       # Material calcs
│   ├── tradeCalculators.ts         # Trade-specific calcs
│   ├── calculatorRoutes.ts         # Calculator API
│   ├── utils/
│   │   ├── logger.ts               # Structured logging + redactForLog
│   │   ├── monitoring.ts           # /metrics endpoint, recordJobMetrics
│   │   ├── pagination.ts           # Cursor pagination contract
│   │   ├── ensureRlsPolicies.ts    # Boot-time RLS policy applier
│   │   └── schedulerLock.ts        # withSchedulerLock (wraps withSystemJobContext)
│   └── correlationIdMiddleware.ts  # x-request-id stamping
│
└── Seed Files:
    ├── seed.ts                     # Database seeding
    ├── seedCalculators.ts          # Calculator seeds
    └── seedTradeExpansion.ts       # Trade template seeds
```

### Client Modules

```
client/src/
├── App.tsx                     # Main app with routing + RoutePermissions
├── main.tsx                    # Entry point
├── index.css                   # Global styles
│
├── pages/                      # Page components (80+)
│   ├── Auth:
│   │   ├── login.tsx
│   │   ├── register.tsx
│   │   ├── forgot-password.tsx
│   │   └── reset-password.tsx
│   │
│   ├── Core:
│   │   ├── dashboard.tsx
│   │   ├── projects.tsx
│   │   ├── project-detail.tsx
│   │   ├── calendar.tsx
│   │   ├── tasks.tsx
│   │   └── messages.tsx
│   │
│   ├── Bidding:
│   │   ├── bids.tsx
│   │   ├── bid-detail.tsx
│   │   ├── bid-estimate.tsx
│   │   ├── bid-wizard.tsx
│   │   ├── bid-network.tsx
│   │   ├── bid-network-detail.tsx
│   │   └── bid-inbox.tsx
│   │
│   ├── Time & Labor:
│   │   ├── time-clock.tsx
│   │   ├── time-entry.tsx
│   │   ├── time-clock-manager.tsx
│   │   └── crews.tsx
│   │
│   ├── Financial:
│   │   ├── cfo-dashboard.tsx
│   │   ├── schedule-of-values.tsx
│   │   ├── billing.tsx
│   │   ├── cost-rates.tsx
│   │   ├── production-rates.tsx
│   │   ├── subcontractor-payables.tsx
│   │   └── what-if-simulator.tsx
│   │
│   ├── Equipment:
│   │   ├── equipment.tsx
│   │   ├── equipment-detail.tsx
│   │   └── rental-vendors.tsx
│   │
│   ├── Delays:
│   │   ├── delay-claims.tsx
│   │   ├── daily-report-locks.tsx
│   │   └── photo-custody.tsx
│   │
│   ├── CRM:
│   │   ├── crm.tsx
│   │   ├── vendor-pricing.tsx
│   │   ├── vendor-scores.tsx
│   │   ├── material-price-index.tsx
│   │   ├── crew-marketplace.tsx
│   │   └── pricebook-import.tsx
│   │
│   ├── AI:
│   │   ├── ai-pm-dashboard.tsx
│   │   ├── ai-settings.tsx
│   │   ├── ai-bid-analysis.tsx
│   │   ├── ai-contract-analysis.tsx
│   │   └── email-assistant.tsx
│   │
│   ├── Field:
│   │   ├── voice-logs.tsx
│   │   ├── issue-captures.tsx
│   │   ├── offline-sync.tsx
│   │   └── mobile-sync.tsx
│   │
│   ├── Heavy Civil / DOT:
│   │   ├── dot-pay-items.tsx       # DOT pay item management
│   │   ├── mass-haul.tsx           # Mass-haul curve
│   │   └── haul-tickets.tsx        # Haul ticket tracking
│   │
│   ├── Compliance:
│   │   └── compliance-dashboard.tsx  # DBE/bond/certification expiration tracking
│   │
│   ├── Global Search:
│   │   └── global-search.tsx       # Command palette + full-text search
│   │
│   ├── Website:
│   │   └── website-builder.tsx
│   │
│   ├── Hustler (Multi-Org):
│   │   ├── hustler-dashboard.tsx
│   │   ├── hustler-org-detail.tsx
│   │   ├── hustler-unified-inbox.tsx
│   │   └── hustler-benchmarking.tsx
│   │
│   ├── Platform Admin:
│   │   ├── PlatformAdminDashboard.tsx
│   │   ├── PlatformAnalytics.tsx
│   │   ├── PlatformAuditDashboard.tsx
│   │   ├── PlatformOrganizations.tsx
│   │   ├── PlatformOrganizationDetail.tsx
│   │   ├── PlatformSupportTools.tsx
│   │   └── admin/job-queue.tsx     # pg-boss job queue admin UI
│   │
│   └── Settings:
│       ├── company-settings.tsx
│       ├── company-health.tsx
│       ├── scope-settings.tsx
│       ├── onboarding.tsx
│       └── users.tsx
│
├── components/                 # Reusable components
│   ├── ui/                     # shadcn components (40+)
│   │
│   ├── Feature Components:
│   │   ├── TakeoffWorkspace.tsx
│   │   ├── MaterialCalculator.tsx
│   │   ├── ProjectEstimate.tsx
│   │   ├── DelaysSection.tsx
│   │   ├── TMTicketsSection.tsx
│   │   ├── InspectionsSection.tsx
│   │   ├── ChangeOrderDialog.tsx
│   │   ├── AIAssistantWidget.tsx
│   │   ├── VendorPricingSync.tsx
│   │   ├── ClientPortal.tsx
│   │   └── ... (50+ components)
│   │
│   ├── AppSidebar.tsx          # Main navigation
│   └── AppHeader.tsx           # Header component
│
├── hooks/                      # Custom hooks
│   ├── use-auth.ts
│   ├── use-toast.ts
│   └── use-*.ts
│
└── lib/                        # Utilities
    ├── queryClient.ts          # TanStack Query setup
    ├── utils.ts                # Helper functions
    ├── rbac.ts                 # RoutePermissions + FeaturePermissions
    └── protected-route.tsx     # Auth route wrapper
```

### Shared Modules

```
shared/
└── schema/
    ├── index.ts                # Re-exports all features
    └── features/               # Domain-specific schema files (split from legacy schema.ts)
        ├── auth.ts             # users, sessions, password reset
        ├── projects.ts         # projects, scope items, daily progress
        ├── bids.ts             # bids, estimates, line items, takeoff
        ├── payroll.ts          # pay runs, time clock, labor rates
        ├── financial.ts        # change orders, SOV, AIA pay apps
        ├── crm.ts              # CRM organisations, contacts, vendors
        ├── equipment.ts        # equipment, maintenance
        ├── compliance.ts       # DBE certs, surety bonds, expiration tracking
        ├── heavyCivil.ts       # DOT pay items, mass-haul, haul tickets
        ├── flags.ts            # FEATURE_FLAG_KEYS, AI_PROVIDER_* flags
        └── ... (20+ domain files)
```

## Data Flow Diagrams

### Authentication Flow
```
User Login → POST /api/auth/login → Validate Credentials (bcrypt)
                                         │
                                         ▼
                                   Verify tokenVersion
                                         │
                                         ▼
                                   Generate JWT (SESSION_SECRET)
                                         │
                                         ▼
                              Set httpOnly, SameSite=Lax Cookie
                                         │
                                         ▼
                              Return User Data → logAuthEvent(LOGIN)
```

### API Request Flow (with RLS)
```
Frontend Request
        │
        ▼
correlationIdMiddleware (x-request-id)
        │
        ▼
requireAuth (validate JWT, check tokenVersion)
        │
        ▼
orgContextMiddleware → withOrgContext({ organizationId, isSuperadmin })
        │                    └── SET app.current_org_id = ?
        │                    └── SET app.is_superadmin = false
        ▼
requireRole Check
        │
        ▼
Route Handler
        │
        ▼
DB Query via ALS proxy → Postgres applies tenant_isolation RLS policy
        │
        ▼
Audit Log (if money/auth path)
        │
        ▼
Response to Client
```

### AI Analysis Flow (with Provider Router)
```
User Triggers "Run Analysis" → POST /api/ai-pm/run
                                       │
                                       ▼
                               Build Data Snapshot
                                       │
                                       ▼
                           governedAiCall (quota check)
                                       │
                                       ▼
                         routedGeneralChatCompletion(...)
                                       │
                           ┌───────────┴───────────┐
                           ▼                       ▼
                  Anthropic Claude (primary) → OpenAI GPT (fallback on error)
                           │
                           ▼
                  validateAiJsonOutput (Zod schema check)
                           │
                           ▼
                  Create Tasks/Insights → Store AI Run Results
                           │
                           ▼
                  Return to Frontend
```

### Background Job Flow (pg-boss)
```
HTTP Route → enqueueJob(name, payload, { idempotencyKey })
                  │
                  ▼
         pg-boss queue (Postgres)
                  │
                  ▼
       server/worker.ts (dedicated process)
                  │
                  ▼
       withOrgContext({ organizationId }) → handler(payload)
                  │
                  ├─ Progress events → SSE clients (via messagingBus)
                  └─ Result row in pgboss.job
```

## Key Architectural Patterns

### 1. Multi-Tenant Data Isolation (Defense in Depth)

**Application layer** — `orgContextMiddleware` sets RLS session vars:
```typescript
withOrgContext({ organizationId: req.user.organizationId, isSuperadmin: false }, async () => {
  // db calls here are scoped by Postgres RLS automatically
});
```

**Database layer** — RLS policy on every tenant table:
```sql
CREATE POLICY tenant_isolation ON <table>
  USING (
    current_setting('app.is_superadmin', true) = 'true'
    OR organization_id = current_setting('app.current_org_id', true)
  );
```

`STRICT_TENANT_RLS=true` is required in production; server fails fast on boot if missing.

### 2. Role-Based Access Control (18 roles)

Middleware chain enforces permissions:
```typescript
app.get("/api/protected",
  requireAuth,           // Must be logged in
  requireRole("ADMIN"),  // Must have role
  handler
);
```

HUSTLER role uses `effectiveRole` from `hustler_organizations` for org-scoped privilege. SUPER_ADMIN cross-tenant access must go through `runAsSuperadmin(reason, fn)` which writes an audit row before elevating.

### 3. AI Provider Router (Two Families)

All LLM calls must go through the router — direct `openai.chat.completions.create` calls fail the CI guard unless annotated:

```typescript
// Takeoff/Estimator family
import { routedChatCompletion } from "./ai/providers";
// General family
import { routedGeneralChatCompletion } from "./ai/providers";
```

Anthropic Claude is the default primary for both families (Task #2851). OpenAI is the automatic fallback.

### 4. Per-Domain Storage Seam

The legacy `server/storage.ts` monolith has been deleted (Task #2672). New DB work uses per-domain seams:

```typescript
// server/bids/storage.drizzle.ts (canonical pattern)
export class BidStorageDrizzle implements IBidStorage {
  constructor(private readonly orgId: string | null) {}
  // Every read filtered, every write ownership-checked
}
```

Routes obtain storage via `getBidStorage(req, res)` which uses `getOrgIdForFilter`. CI guard at `scripts/check-legacy-storage.mjs` fails if `server/storage.ts` is recreated.

### 5. Feature Gating

Subscription-based feature access via `requireFeature` middleware:
```typescript
app.get("/api/ai/analyze",
  requireAuth,
  requireFeature("ai_pm"),
  handler
);
```

### 6. Audit Trail (Append-Only)

All money-path mutations, auth events, role changes, and MFA changes are logged:
```typescript
await logAuthEvent({ userId, action: "LOGIN", organizationId, ... });
await logRoleChange({ userId, action: "ROLE_CHANGED", ... });
```

### 7. Unified SOW Tracking

Cross-project scope of work item linking for production rate aggregation:

```
organizationSowItems → estimateLineItems → scopeItems → dailyScopeProgress
                                                              │
                                                              ▼
                                            Production Rate Aggregation
                                            (by organizationSowItemId)
```

**Key Service:** `server/productionRateService.ts` — `getProductionRateBySowItemId()`
**API:** `GET /api/estimates/production-rates/by-sow-item/:sowItemId`

## Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | Yes | PostgreSQL connection |
| `SESSION_SECRET` | Yes | JWT signing key; server fails fast if missing |
| `ANTHROPIC_API_KEY` | Yes | Primary AI provider (Takeoff + General families) |
| `OPENAI_API_KEY` | Yes | AI fallback + Vision pipelines |
| `STRICT_TENANT_RLS` | Prod only | Must be `true`; server fails fast if missing/false in production |
| `CLOUDMERSIVE_AV_API_KEY` | Optional | Enable Cloudmersive ClamAV-backed upload scanning |
| `UPLOAD_AV_SCAN_MODE` | Optional | `enforce` (default prod), `permissive` (dev), `disabled` |

## CI Guards

All run in `scripts/ci.sh`:

| Script | Purpose |
|--------|---------|
| `check-legacy-storage.mjs` | Fails if `server/storage.ts` is recreated or bare `./storage` imported |
| `check-db-imports.mjs` | Fails if a new server file builds its own db client (bypasses RLS proxy) |
| `check-job-context.mjs` | Fails if job files touch db without a tenant context wrapper |
| `check-ai-router-bypass.mjs` | Fails if a server file calls openai directly without router or annotation |
| `check-prompt-injection-guard.mjs` | Fails if an AI call site lacks the prompt-injection guard import or annotation |
| `check-sse-org-context.mjs` | Fails if an SSE handler lacks `withOrgContext` or `// sse-org-context:` annotation |
