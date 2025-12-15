# TEAM Repl Inventory - SmartManageAI

**Generated**: December 2025  
**Source**: TEAM Replit copy (source of truth)

---

## 1. Repository Tree (Top 4 Levels)

```
.
├── attached_assets/          (50 files - prompts, images, docs)
├── client/
│   ├── public/               (1 file: favicon.png)
│   └── src/
│       ├── components/       (70+ components)
│       │   ├── examples/     (14 example components)
│       │   └── ui/           (45 shadcn components)
│       ├── hooks/            (6 hooks)
│       ├── lib/              (3 lib files)
│       ├── pages/            (55 pages)
│       │   └── vendor/       (3 vendor portal pages)
│       └── utils/            (1 utility)
├── docs/
│   ├── merge/                (this directory)
│   └── feature-*.md          (7 feature docs)
├── FULL_CODE_AUDIT_EXPORT/   (legacy audit snapshot)
├── server/
│   ├── ai/                   (11 AI modules)
│   ├── middleware/           (1 middleware)
│   ├── migrations/           (2 SQL migrations)
│   ├── services/             (1 service)
│   ├── utils/                (2 utils)
│   └── *.ts                  (45+ route/service files)
├── shared/
│   ├── billing/              (plans.ts - subscription/billing config)
│   └── schema.ts             (5720 lines - Drizzle schema)
└── config files              (package.json, tsconfig, vite.config, etc.)
```

**File Counts**:
- `server/`: ~65 TypeScript files
- `client/src/components/`: ~85 components
- `client/src/pages/`: 55 pages
- `shared/schema.ts`: 5720 lines, ~100+ tables

---

## 2. package.json Scripts & Key Dependencies

### Scripts
```json
{
  "dev": "NODE_ENV=development tsx server/index.ts",
  "build": "vite build && esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist",
  "start": "NODE_ENV=production node dist/index.js",
  "check": "tsc",
  "db:push": "drizzle-kit push"
}
```

### Key Dependencies (versions)
| Package | Version | Purpose |
|---------|---------|---------|
| drizzle-orm | ^0.39.1 | ORM |
| express | ^4.21.2 | Backend |
| react | ^18.3.1 | Frontend |
| @tanstack/react-query | ^5.60.5 | Data fetching |
| openai | ^6.9.1 | AI integration |
| jsonwebtoken | ^9.0.2 | Auth |
| bcrypt | ^6.0.0 | Password hashing |
| @neondatabase/serverless | ^0.10.4 | Postgres |
| @google-cloud/storage | ^7.17.3 | Object storage |
| pdfkit | ^0.17.2 | PDF generation |
| pdfjs-dist | ^5.4.394 | PDF rendering |
| xlsx | ^0.18.5 | Excel processing |
| konva/react-konva | ^9.3.22/^18.2.10 | Takeoff canvas |
| wouter | ^3.3.5 | Frontend routing |
| zod | ^3.24.2 | Validation |
| nodemailer | ^7.0.11 | Email |
| resend | ^6.5.2 | Email API |

---

## 3. Environment Variables (by Feature)

### Core/Infrastructure
- `DATABASE_URL` - Neon Postgres connection
- `SESSION_SECRET` - JWT secret
- `NODE_ENV` - development/production
- `PORT` - Server port (default 5000)
- `FRONTEND_URL` - CORS origin

### AI Features
- `OPENAI_API_KEY` - OpenAI API

### Email
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (Gmail OAuth)
- `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_REDIRECT_URI` (Outlook OAuth)

### Object Storage
- `PUBLIC_OBJECT_SEARCH_PATHS` - Public asset paths
- `PRIVATE_OBJECT_DIR` - Private file directory

### Operations
- `OPS_STATUS_TOKEN` - Ops endpoint auth
- `SENTRY_DSN` - Error tracking (optional)
- `BILLING_MODE` - "manual" for dev mode

### Deployment
- `REPLIT_DEV_DOMAIN`, `REPLIT_DOMAINS` - URL construction
- `APP_URL`, `REPL_SLUG`, `REPL_OWNER` - Platform URLs

---

## 4. Database Schema Summary

### Key Enums (shared/schema.ts)
- `userRoleEnum`: SUPER_ADMIN, ADMIN, MANAGER, SUPERINTENDENT, ESTIMATOR, OFFICE_MANAGER, HOURLY_EMPLOYEE, MAINTENANCE_MANAGER, VENDOR, HUSTLER
- `planTierEnum`: free, starter, professional, enterprise
- `addonKeyEnum`: ai_pm, ai_cfo, ai_email, website_seo, bid_network, ai_vision
- `tradeTypeEnum`: 23 CSI trade divisions
- Plus 40+ other enums for statuses, types, categories

### Core Tables
| Table | Purpose |
|-------|---------|
| organizations | Multi-tenant orgs |
| users | User accounts |
| organization_subscriptions | Billing/plans |
| organization_addons | Add-on subscriptions |
| organization_usage | Usage metering |
| projects | Project management |
| bids | Bid tracking |
| estimates | Cost estimation |
| estimate_line_items | Line item details |
| time_clock_shifts | Time tracking |
| crm_organizations | CRM entities |
| tasks | Task management |
| organization_sow_items | Scope of work |
| production_rates | Production analytics |
| website_configs | Website builder |
| email_accounts | Email AI |
| bid_requests | Bid network |

### SQL Migrations (server/migrations/)
- `001_backfill_token_version.sql` - Token versioning
- `002_backfill_project_financials.sql` - Financial fields

---

## 5. Backend Route Modules & Prefixes

| Module | Prefix | Key Features |
|--------|--------|--------------|
| routes.ts | /api/* | Main routes (auth, users, orgs, projects, bids) |
| aiRoutes.ts | /api/ai/* | AI orchestrator, snapshots |
| aiAssistantRoutes.ts | /api/ai-assistant/* | Chat assistant |
| aiFeatureRoutes.ts | /api/ai-features/* | AI module triggers |
| aiNotesRoutes.ts | /api/ai-notes/* | Note analysis |
| aiBidDocumentRoutes.ts | /api/bid-documents/* | Bid doc analysis |
| aiContractDocumentRoutes.ts | /api/contract-documents/* | Contract analysis |
| estimateRoutes.ts | /api/bids/:bidId/estimate, /api/estimates/* | Estimating |
| changeOrderRoutes.ts | /api/change-orders/* | Change orders |
| timeClockRoutes.ts | /api/time-clock/*, /api/time-entries/* | Time tracking |
| tmTicketRoutes.ts | /api/tm-tickets/* | T&M tickets |
| billingRoutes.ts | /api/billing/* | Subscription management |
| hustlerRoutes.ts | /api/hustler/* | Multi-org management |
| bidNetworkRoutes.ts | /api/bid-network/* | Bid solicitation |
| websiteBuilderRoutes.ts | /api/website/* | Website builder |
| emailAccountRoutes.ts | /api/email/* | Email accounts |
| emailAiRoutes.ts | /api/email-ai/* | Email AI processing |
| laborRateRoutes.ts | /api/labor-rates/* | Labor cost rates |
| calculatorRoutes.ts | /api/calculators/* | Material calculators |
| sovRoutes.ts | /api/sov/* | Schedule of values |
| subcontractRoutes.ts | /api/subcontracts/* | Subcontract management |
| subcontractorPayablesRoutes.ts | /api/subcontractor-payables/* | Payables workflow |
| dashboardCustomizationRoutes.ts | /api/dashboard/* | Dashboard widgets |
| organizationDocumentRoutes.ts | /api/org-documents/* | Doc management |
| delayRoutes.ts | /api/delays/* | Delay tracking |
| inspectionRoutes.ts | /api/inspections/* | Inspection scheduling |
| platformAdminRoutes.ts | /api/platform/* | Platform admin |
| opsRoutes.ts | /api/ops/* | Health/readiness |
| taskRoutes.ts | /api/tasks/* | Task management |
| notesRoutes.ts | /api/notes/* | Project notes |

---

## 6. Frontend Pages/Routes

| Page | Route | Feature |
|------|-------|---------|
| dashboard.tsx | / | Main dashboard |
| login.tsx | /login | Auth |
| register.tsx | /register | Registration |
| onboarding.tsx | /onboarding | Org setup |
| projects.tsx | /projects | Project list |
| project-detail.tsx | /projects/:id | Project details |
| bids.tsx | /bids | Bid list |
| bid-detail.tsx | /bids/:id | Bid details |
| bid-estimate.tsx | /bids/:id/estimate | Estimate builder |
| bid-wizard.tsx | /bid-wizard | AI-powered bid creation |
| billing.tsx | /billing | Subscription management |
| crm.tsx | /crm | CRM |
| time-clock.tsx | /time-clock | Employee time clock |
| time-clock-manager.tsx | /time-clock-manager | Manager approvals |
| equipment.tsx | /equipment | Equipment management |
| users.tsx | /users | User management |
| tasks.tsx | /tasks | Task list |
| messages.tsx | /messages | Internal messaging |
| email-assistant.tsx | /email-assistant | Email AI |
| hustler-dashboard.tsx | /hustler | Multi-org dashboard |
| website-builder.tsx | /website-builder | Website builder |
| bid-network.tsx | /bid-network | Bid solicitation |
| production-rates.tsx | /production-rates | Production analytics |
| cfo-dashboard.tsx | /cfo-dashboard | AI CFO |
| ai-pm-dashboard.tsx | /ai-pm-dashboard | AI PM |
| Platform*.tsx | /platform/* | Platform admin |
| vendor/*.tsx | /vendor/* | Vendor portal |

---

## 7. Feature Gating / Entitlements / Billing Enforcement

### Backend Enforcement
| File | Purpose |
|------|---------|
| server/middleware/requireFeature.ts | Middleware to gate routes by feature |
| server/services/featureAccess.ts | Feature access checking logic, isDevMode() |
| server/billingRoutes.ts | Subscription CRUD, add-on toggling |

### Frontend Enforcement
| File | Purpose |
|------|---------|
| client/src/hooks/useEntitlements.ts | Hook for entitlement data |
| client/src/components/FeatureGate.tsx | Wrapper component for feature gating |
| client/src/components/AppSidebar.tsx | Upgrade CTA for free users |
| client/src/pages/billing.tsx | Subscription management UI |
| client/src/components/PlanSelectionStep.tsx | Onboarding plan selection |

### Shared Config
| File | Purpose |
|------|---------|
| shared/billing/plans.ts | Plan tiers, add-ons, pricing, features |

### Dev Mode Detection
```typescript
// server/services/featureAccess.ts line 226
return process.env.NODE_ENV !== "production" || process.env.BILLING_MODE === "manual";
```

---

## Summary Stats

- **Total Backend Route Files**: 45+
- **Total Frontend Pages**: 55
- **Total Components**: 85+
- **Schema Tables**: 100+
- **Enums**: 40+
- **AI Modules**: 11
- **Trade Types Supported**: 23
