# SmartManageAI Architecture Map

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER                                │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │  React + TypeScript + Vite                                           │ │
│  │  ├── TanStack Query (data fetching)                                  │ │
│  │  ├── Wouter (routing)                                                │ │
│  │  ├── Tailwind CSS + shadcn/ui (styling)                             │ │
│  │  └── React Hook Form + Zod (forms & validation)                     │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼ HTTP/REST
┌─────────────────────────────────────────────────────────────────────────┐
│                              SERVER LAYER                                │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │  Express.js + TypeScript                                             │ │
│  │  ├── Authentication (JWT + httpOnly cookies)                         │ │
│  │  ├── Rate Limiting (express-rate-limit)                             │ │
│  │  ├── RBAC Middleware (requireRole)                                  │ │
│  │  ├── Organization Filtering (orgFilter)                             │ │
│  │  └── Audit Logging                                                  │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
┌──────────────────────┐ ┌──────────────────┐ ┌──────────────────────┐
│      DATABASE        │ │   FILE STORAGE   │ │      AI SERVICE      │
│  PostgreSQL (Neon)   │ │  Google Cloud    │ │  OpenAI GPT-4/4o     │
│  Drizzle ORM         │ │  Storage         │ │  Vision API          │
└──────────────────────┘ └──────────────────┘ └──────────────────────┘
```

## Technology Stack

### Frontend
| Technology | Purpose | Location |
|------------|---------|----------|
| React 18 | UI framework | `client/src/` |
| TypeScript | Type safety | `*.tsx`, `*.ts` |
| Vite | Build tool | `vite.config.ts` |
| TanStack Query | Server state | `client/src/lib/queryClient.ts` |
| Wouter | Client routing | `client/src/App.tsx` |
| Tailwind CSS | Styling | `client/src/index.css` |
| shadcn/ui | Components | `client/src/components/ui/` |
| React Hook Form | Forms | Throughout pages |
| Zod | Validation | `shared/schema.ts` |

### Backend
| Technology | Purpose | Location |
|------------|---------|----------|
| Express.js | HTTP server | `server/index.ts` |
| TypeScript | Type safety | `server/*.ts` |
| Drizzle ORM | Database queries | `server/db.ts` |
| bcrypt | Password hashing | `server/auth.ts` |
| jsonwebtoken | JWT auth | `server/auth.ts` |
| node-cron | Scheduled tasks | `server/ai/scheduler.ts` |

### Database
| Technology | Purpose | Location |
|------------|---------|----------|
| PostgreSQL | Primary database | Neon hosted |
| Drizzle Kit | Migrations | `drizzle.config.ts` |

### External Services
| Service | Purpose | Integration |
|---------|---------|-------------|
| OpenAI GPT-4 | AI analysis | `server/ai/openaiClient.ts` |
| OpenAI Vision | Image analysis | Auto-takeoff, jobsite photos |
| Google Cloud Storage | File storage | `server/objectStorage.ts` |
| Resend | Email delivery | `server/email.ts` |

## Module Map

### Server Modules

```
server/
├── index.ts              # Express app entry point
├── routes.ts             # Core route registration
├── auth.ts               # Authentication logic
├── db.ts                 # Database connection
├── storage.ts            # In-memory storage fallback
│
├── Route Files:
│   ├── estimateRoutes.ts       # Estimating endpoints
│   ├── timeClockRoutes.ts      # Time tracking
│   ├── payrollSettingsRoutes.ts # Payroll config
│   ├── changeOrderRoutes.ts    # Change orders
│   ├── delayRoutes.ts          # Delay tracking
│   ├── delayClaimsRoutes.ts    # Delay claims
│   ├── inspectionRoutes.ts     # Inspections
│   ├── tmTicketRoutes.ts       # T&M tickets
│   ├── sovRoutes.ts            # Schedule of values
│   ├── bidNetworkRoutes.ts     # Bid network
│   ├── websiteBuilderRoutes.ts # Website builder
│   ├── marketplaceRoutes.ts    # Marketplace features
│   ├── vendorPricebookRoutes.ts # Vendor pricing
│   ├── laborRateRoutes.ts      # Labor rates
│   ├── subcontractRoutes.ts    # Subcontracts
│   ├── subcontractorPayablesRoutes.ts # Payables
│   ├── emailAccountRoutes.ts   # Email integration
│   ├── emailAiRoutes.ts        # Email AI
│   ├── fieldProductivityRoutes.ts # Field tools
│   ├── organizationDocumentRoutes.ts # Org docs
│   ├── dashboardCustomizationRoutes.ts # Dashboard
│   ├── hustlerRoutes.ts        # Multi-org
│   ├── platformAdminRoutes.ts  # Platform admin
│   ├── billingRoutes.ts        # Subscription billing
│   ├── weatherRoutes.ts        # Weather data
│   ├── opsRoutes.ts            # Health/readiness
│   └── notesRoutes.ts          # Notes
│
├── AI Modules:
│   ├── aiRoutes.ts             # AI endpoints
│   ├── aiAssistantRoutes.ts    # AI assistant
│   ├── aiBidDocumentRoutes.ts  # Bid doc analysis
│   ├── aiContractDocumentRoutes.ts # Contract analysis
│   ├── aiNotesRoutes.ts        # Note insights
│   ├── aiFeatureRoutes.ts      # AI features
│   └── ai/
│       ├── orchestrator.ts     # AI run coordination
│       ├── snapshotBuilder.ts  # Data snapshot
│       ├── moduleAnalyzers.ts  # Analysis modules
│       ├── systemPrompt.ts     # AI prompts
│       ├── assistantPrompt.ts  # Assistant prompts
│       ├── openaiClient.ts     # OpenAI integration
│       ├── emailAi.ts          # Email classification
│       ├── scheduler.ts        # AI scheduling
│       ├── profitabilityEngine.ts # Profitability analysis
│       ├── scopePredictionEngine.ts # Scope prediction
│       ├── dataQualityScorer.ts # Data quality
│       ├── tradeDiscoveryService.ts # Trade discovery
│       ├── vendorPriceListExtractor.ts # Price extraction
│       └── walkthroughContent.ts # Onboarding content
│
├── Services:
│   ├── pdf-service.ts          # PDF generation
│   ├── sov-pdf-service.ts      # SoV PDFs
│   ├── subcontract-pdf-service.ts # Subcontract PDFs
│   ├── productionRateService.ts # Production rates
│   ├── dataPipelineService.ts  # Data pipelines
│   ├── aiNotesService.ts       # Note analysis
│   ├── organizationBranding.ts # Branding
│   └── bidNetworkNotifications.ts # Bid notifications
│
├── Middleware:
│   ├── rateLimiter.ts          # Rate limiting
│   ├── orgFilter.ts            # Org-based filtering
│   ├── fileValidation.ts       # File upload validation
│   ├── sanitization.ts         # Input sanitization
│   └── middleware/
│       └── requireFeature.ts   # Feature gating
│
├── Utilities:
│   ├── auditLogger.ts          # Audit logging
│   ├── email.ts                # Email sending
│   ├── objectStorage.ts        # File storage
│   ├── objectAcl.ts            # File ACL
│   ├── fileAccessHelpers.ts    # File helpers
│   ├── materialCalculator.ts   # Material calcs
│   ├── tradeCalculators.ts     # Trade-specific calcs
│   ├── calculatorRoutes.ts     # Calculator API
│   ├── calculatorVerification.ts # Calc verification
│   └── utils/
│       ├── logger.ts           # Logging
│       └── monitoring.ts       # Monitoring
│
└── Seed Files:
    ├── seed.ts                 # Database seeding
    ├── seedCalculators.ts      # Calculator seeds
    └── seedTradeExpansion.ts   # Trade template seeds
```

### Client Modules

```
client/src/
├── App.tsx                     # Main app with routing
├── main.tsx                    # Entry point
├── index.css                   # Global styles
│
├── pages/                      # Page components (70+)
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
│   │   └── PlatformSupportTools.tsx
│   │
│   └── Settings:
│       ├── company-settings.tsx
│       ├── company-health.tsx
│       ├── scope-settings.tsx
│       ├── onboarding.tsx
│       └── users.tsx
│
├── components/                 # Reusable components
│   ├── ui/                     # shadcn components
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── dialog.tsx
│   │   ├── form.tsx
│   │   ├── table.tsx
│   │   └── ... (40+ components)
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
    └── protected-route.tsx     # Auth route wrapper
```

### Shared Modules

```
shared/
└── schema.ts                   # Database schema + types
                                # - 100+ table definitions
                                # - Zod insert schemas
                                # - TypeScript types
```

## Data Flow Diagrams

### Authentication Flow
```
User Login → POST /api/auth/login → Validate Credentials
                                         │
                                         ▼
                                   Generate JWT
                                         │
                                         ▼
                              Set httpOnly Cookie
                                         │
                                         ▼
                              Return User Data → Frontend Stores User
```

### API Request Flow
```
Frontend Request → requireAuth Middleware → Validate JWT
                                                 │
                                                 ▼
                                          requireRole Check
                                                 │
                                                 ▼
                                          orgFilter Applied
                                                 │
                                                 ▼
                                         Route Handler Executes
                                                 │
                                                 ▼
                                         Database Query (with org filter)
                                                 │
                                                 ▼
                                         Audit Log Created
                                                 │
                                                 ▼
                                         Response to Client
```

### AI Analysis Flow
```
User Triggers "Run Analysis" → POST /api/ai-pm/run
                                       │
                                       ▼
                               Build Data Snapshot
                                       │
                                       ▼
                              Run Module Analyzers
                              (Labor, Materials, Budget, etc.)
                                       │
                                       ▼
                              Call OpenAI API
                                       │
                                       ▼
                              Parse AI Response
                                       │
                                       ▼
                              Create Tasks/Insights
                                       │
                                       ▼
                              Store AI Run Results
                                       │
                                       ▼
                              Return to Frontend
```

## Key Architectural Patterns

### 1. Multi-Tenant Data Isolation
Every database query includes organization ID filtering:
```typescript
.where(eq(table.organizationId, user.organizationId))
```

### 2. Role-Based Access Control
Middleware chain enforces permissions:
```typescript
app.get("/api/protected", 
  requireAuth,           // Must be logged in
  requireRole("ADMIN"),  // Must have role
  handler
);
```

### 3. Feature Gating
Subscription-based feature access:
```typescript
app.get("/api/ai/analyze",
  requireAuth,
  requireFeature("ai_pm"),  // Must have AI PM add-on
  handler
);
```

### 4. Audit Trail
All mutations logged:
```typescript
await logCreate("projects", projectId, userId, orgId, projectData);
```

### 5. Type Safety
Shared types between frontend and backend via `shared/schema.ts`.
