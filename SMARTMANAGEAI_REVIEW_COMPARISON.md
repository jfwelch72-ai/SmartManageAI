# SmartManageAI Platform - Full System Audit Report
**Audit Date:** December 15, 2025  
**Auditor:** Principal Engineer  
**Platform Version:** Production Multi-Tenant SaaS

---

## EXECUTIVE SUMMARY

**Overall Platform Status: READY WITH FIXES**

The SmartManageAI platform is a comprehensive, production-grade construction management SaaS with extensive functionality. Recent upgrades have expanded the trade taxonomy to 73 trades, added AI-powered discovery services, and enhanced marketplace features. The platform demonstrates solid architecture but has several areas requiring attention before full production deployment.

---

## SECTION 1 — PLATFORM INVENTORY & ARCHITECTURE

### Frontend Pages & Routes (73 pages)

| Category | Pages |
|----------|-------|
| **Core Operations** | dashboard, projects, project-detail, bids, bid-detail, bid-estimate, bid-wizard, estimates |
| **Financial** | billing, cfo-dashboard, cost-rates, subcontractor-payables, schedule-of-values |
| **Field Operations** | time-clock, time-clock-manager, time-entry, tm-daily, daily-report-locks, crews |
| **Equipment & Materials** | equipment, equipment-detail, production-rates, material-price-index, pricebook-import |
| **Risk & Evidence** | delay-claims, photo-custody, issue-captures, voice-logs, offline-sync, mobile-sync |
| **CRM & Vendors** | crm, vendor-pricing, vendor-scores, rental-vendors, crew-marketplace |
| **AI Features** | ai-pm-dashboard, ai-settings, ai-bid-analysis, ai-contract-analysis, email-assistant |
| **Marketplace** | bid-network, bid-network-detail, what-if-simulator |
| **Admin/Executive** | users, company-settings, company-health, executive-digest, hustler-dashboard, hustler-benchmarking, hustler-unified-inbox, hustler-org-detail |
| **Platform Admin** | PlatformAdminDashboard, PlatformAnalytics, PlatformOrganizations, PlatformOrganizationDetail, PlatformSupportTools |
| **Onboarding/Auth** | login, register, forgot-password, reset-password, onboarding |
| **Other** | calendar, messages, tasks, company-communications, website-builder, scope-settings, subcontracts, not-found |

### Backend Route Groups (31 route files, 400+ endpoints)

| Route File | Endpoints | Purpose |
|------------|-----------|---------|
| aiRoutes.ts | 39 | AI orchestrator, onboarding, trade discovery |
| calculatorRoutes.ts | 31 | Material calculators, trade-specific calculations |
| websiteBuilderRoutes.ts | 37 | White-label website management |
| hustlerRoutes.ts | 23 | Multi-organization management |
| aiFeatureRoutes.ts | 23 | AI module analyzers, what-if simulations |
| marketplaceRoutes.ts | 20 | Vendor marketplace, pricing |
| bidNetworkRoutes.ts | 19 | Subcontractor bid network |
| fieldProductivityRoutes.ts | 18 | Voice logs, issue capture, photo custody |
| delayClaimsRoutes.ts | 17 | Delay claim management |
| delayRoutes.ts | 17 | Project delay tracking |
| emailAiRoutes.ts | 15 | Email AI classification |
| dashboardCustomizationRoutes.ts | 15 | Dashboard widgets, customization |
| laborRateRoutes.ts | 13 | Labor cost rate management |
| platformAdminRoutes.ts | 12 | Platform-wide administration |
| emailAccountRoutes.ts | 11 | Email account integration |
| inspectionRoutes.ts | 9 | Inspection scheduling |
| changeOrderRoutes.ts | 8 | Change order management |
| organizationDocumentRoutes.ts | 8 | Document versioning |
| sovRoutes.ts | 8 | Schedule of values |
| subcontractorPayablesRoutes.ts | 8 | Payables workflow |
| billingRoutes.ts | 7 | Stripe billing integration |
| vendorPricebookRoutes.ts | 7 | PDF pricebook ingestion |
| aiBidDocumentRoutes.ts | 7 | Bid document AI analysis |
| taskRoutes.ts | 7 | Task management |
| aiContractDocumentRoutes.ts | 6 | Contract AI analysis |
| aiAssistantRoutes.ts | 6 | AI assistant chat |
| subcontractRoutes.ts | 6 | Subcontract management |
| notesRoutes.ts | 6 | Project/company notes |
| aiNotesRoutes.ts | 4 | AI note insights |
| weatherRoutes.ts | 3 | Weather integration |
| opsRoutes.ts | 3 | Operational endpoints |

### Database Schema (120+ tables, 50+ enums)

**Core Entities:**
- organizations, users, projects, bids, estimates
- estimateLineItems, scopeItems, dailyScopeProgress

**Financial:**
- billingEvents, changeOrders, subcontractorContracts, subcontractorPayments
- procurementItems, receipts, projectMaterialBudgets

**Labor & Time:**
- timeEntries, timeClockShifts, timeClockEvents, tmTickets, tmDailySheets
- crews, crewMembers, crewProjectAssignments

**Equipment:**
- equipment, equipmentAssignments, equipmentRepairs

**AI & Analytics:**
- aiSettings, aiRuns, aiTasks, aiInsights, aiNoteInsights
- aiDataQuality, aiBidDocumentAnalysis, aiContractDocumentAnalysis

**Risk & Evidence:**
- projectDelays, delayClaims, delayNotifications
- dailyReportLocks, photoCustodyRecords

**CRM & Marketplace:**
- crmOrganisations, crmContacts, vendorPricebooks, vendorScores
- materialPriceIndex, crewMarketplace

**Master Data:**
- masterSowItems (637+ items), masterModifierCategories (109+), masterModifiers (376+)
- tradeTemplates, unitsOfMeasure, organizationCalculators

**Key Enums:**
- userRoleEnum: SUPER_ADMIN, ADMIN, MANAGER, SUPERINTENDENT, ESTIMATOR, OFFICE_MANAGER, HOURLY_EMPLOYEE, MAINTENANCE_MANAGER, VENDOR, HUSTLER
- tradeTypeEnum: 73 trades across Civil/Site, Structural, MEP, Support categories
- planTierEnum: free, starter, professional, enterprise

### AI Engines & Services (14 files)

| Service | Purpose | Status |
|---------|---------|--------|
| orchestrator.ts | Daily AI PM + CFO analysis | ✅ Active |
| snapshotBuilder.ts | Data aggregation for AI | ⚠️ Has LSP errors |
| profitabilityEngine.ts | Project profitability calculations | ✅ Active |
| tradeDiscoveryService.ts | AI trade identification | ✅ New |
| scopePredictionEngine.ts | AI scope item suggestions | ✅ New |
| emailAi.ts | Email classification (15 categories) | ✅ Active |
| vendorPriceListExtractor.ts | PDF pricebook parsing | ✅ Active |
| moduleAnalyzers.ts | Feature-specific AI analysis | ✅ Active |
| dataQualityScorer.ts | Data completeness scoring | ✅ Active |
| walkthroughContent.ts | Role-based onboarding | ✅ Active |
| assistantPrompt.ts | AI assistant context | ✅ Updated |
| systemPrompt.ts | AI PM/CFO prompts | ✅ Updated |
| openaiClient.ts | OpenAI API wrapper | ✅ Active |
| scheduler.ts | Background job scheduling | ✅ Active |

### Background Jobs / Schedulers

- **aiNotesScheduler.ts**: Daily AI note analysis
- **scheduler.ts**: Orchestrated AI runs (configurable timing)
- **node-cron**: Used for scheduled tasks

### Third-Party Integrations

| Integration | Purpose | Status |
|-------------|---------|--------|
| OpenAI GPT-4/GPT-4o | AI features, vision, analysis | ✅ Configured |
| Stripe | Subscription billing | ✅ Configured |
| Replit Object Storage (GCS) | File storage | ✅ Configured |
| Nodemailer/Resend | Email sending | ✅ Configured |
| Weather API | Weather data for delays | ✅ Configured |
| PDF.js | Document rendering | ✅ Active |
| Konva | Interactive takeoff tools | ✅ Active |

### Flagged Issues

**Pre-existing LSP Errors (snapshotBuilder.ts):**
- Line 1093: Status enum mismatch (PENDING_REVIEW vs actual values)
- Lines 1099-1109: Missing fields (claimedDays, claimedAmount, delayType)
- Line 1142: Missing syncStatus field
- Line 1172: Missing status field on crewMarketplace
- Line 1326: Nullable type incompatibility

**Potential Orphaned Files:** None identified

**Dead Routes:** None identified

**Duplicate Logic:** None significant

---

## SECTION 2 — AUTHENTICATION, RBAC & MULTI-TENANCY

### Authentication Lifecycle

| Feature | Implementation | Status |
|---------|----------------|--------|
| Login | JWT-based with bcrypt hashing | ✅ |
| Logout | Token invalidation via versioning | ✅ |
| Token Refresh | Automatic via httpOnly cookies | ✅ |
| Password Reset | Email-based with secure tokens | ✅ |
| Session Management | Express sessions with PostgreSQL store | ✅ |

### Role Hierarchy (10 roles)

1. **SUPER_ADMIN** - Platform-wide access
2. **HUSTLER** - Multi-organization owner
3. **ADMIN** - Organization administrator
4. **MANAGER** - Project/team management
5. **SUPERINTENDENT** - Field operations
6. **ESTIMATOR** - Bid/estimate creation
7. **OFFICE_MANAGER** - Administrative tasks
8. **MAINTENANCE_MANAGER** - Equipment management
9. **HOURLY_EMPLOYEE** - Basic access
10. **VENDOR** - External vendor portal

### Multi-Tenancy Enforcement

| Area | Enforcement Method | Status |
|------|-------------------|--------|
| Queries | organizationId filter via orgFilter.ts | ✅ |
| Mutations | organizationId injection from session | ✅ |
| AI Context | Organization-scoped data snapshots | ✅ |
| File Access | objectAcl.ts, fileAccessHelpers.ts | ✅ |

### Security Review

- **Rate Limiting**: Implemented via rateLimiter.ts
- **Input Sanitization**: sanitization.ts for all text inputs
- **Audit Logging**: Comprehensive via auditLogger.ts
- **Token Versioning**: Supports instant logout across devices

**Flagged Issues:** None critical identified

---

## SECTION 3 — BILLING, ENTITLEMENTS & FEATURE GATING

### Stripe Integration

- **File**: server/billingRoutes.ts (7 endpoints)
- **Tables**: organizationSubscriptions, organizationAddOns, organizationUsage

### Subscription Tiers

| Tier | Features |
|------|----------|
| FREE | Basic project management, limited users |
| STARTER | Enhanced features, more users |
| PROFESSIONAL | Full features, AI modules |
| ENTERPRISE | Custom limits, dedicated support |

### Add-Ons (6 available)

1. AI PM Module
2. AI CFO Module
3. AI Email Classification
4. Website Builder
5. Bid Network Access
6. AI Vision (Takeoff)

### Feature Gating

| Layer | Implementation | Location |
|-------|----------------|----------|
| Backend | requireFeature middleware | server/middleware/ |
| Frontend | FeatureGate component | client/src/components/ |
| Hooks | useEntitlements hook | client/src/hooks/ |

### Plan Matrix

- Defined in: shared/billing/plans.ts
- Supports manual billing mode for development

**Flagged Issues:** None critical

---

## SECTION 4 — CORE OPERATIONS MODULES

### Projects

- **CRUD**: Full create, read, update, delete
- **Statuses**: BID, PLANNING, ACTIVE, COMPLETE, CLOSED
- **Relations**: Links to bids, estimates, crews, equipment, delays
- **Status**: ✅ Fully operational

### Estimates

- **5-Step Bid Cost Builder**: Guided workflow
- **Line Items**: MANUAL, TAKEOFF, GENERATED sources
- **Versioning**: estimateVersions table
- **Status**: ✅ Fully operational

### Bids

- **Pipeline**: DRAFT → SUBMITTED → WON/LOST
- **AI Analysis**: aiBidDocumentAnalysis
- **Conversion**: Bid to Project workflow
- **Status**: ✅ Fully operational

### Trades, SOW, Modifiers

- **Trade Taxonomy**: 73 trades (recently expanded)
- **Master SOW Items**: 637+ items
- **Modifier Categories**: 109+
- **Modifiers**: 376+
- **Status**: ✅ Fully operational

### Material Calculators

- **Trade-Specific**: 31 calculator endpoints
- **Presets**: materialCalculatorPresets table
- **Verification**: calculatorVerification.ts
- **Status**: ✅ Fully operational

### Time Tracking

- **Time Clock**: GPS-enabled clock in/out
- **Shift Approval**: PENDING → APPROVED → REJECTED
- **T&M Tickets**: Daily sheets with labor/equipment/materials
- **Status**: ✅ Fully operational

### Daily Reports

- **Notes**: projectNotes, companyDailyNotes
- **AI Insights**: aiNoteInsights extraction
- **Locking**: dailyReportLocks with supervisor override
- **Status**: ✅ Fully operational

**Flagged Issues:** None

---

## SECTION 5 — FIELD, RISK & EVIDENCE SYSTEMS

### Delay Tracking

- **Table**: projectDelays
- **Reasons**: 10+ categories (Weather, GC Scheduling, Material Delivery, etc.)
- **Status Flow**: DRAFT → SUBMITTED → ACKNOWLEDGED → RESOLVED
- **Responsibility**: OWNER, GC, SUBCONTRACTOR, TFR, FORCE_MAJEURE
- **PDF Generation**: Delay notification letters
- **Status**: ✅ Operational

### Delay Claims

- **Table**: delayClaims
- **Types**: TIME_EXTENSION, COST_IMPACT, BOTH
- **Status Flow**: DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED/REJECTED → CLOSED
- **⚠️ Issue**: snapshotBuilder.ts has field mismatches (claimedDays, claimedAmount, delayType missing)

### Weather Integration

- **Routes**: weatherRoutes.ts (3 endpoints)
- **Linkage**: Weather data can be linked to delays
- **Status**: ✅ Operational

### Daily Report Locking

- **Table**: dailyReportLocks
- **Statuses**: UNLOCKED, LOCKED, SUPERVISOR_LOCKED
- **Status**: ✅ Operational

### Photo Custody

- **Table**: photoCustodyRecords
- **Actions**: CAPTURED, UPLOADED, VIEWED, DOWNLOADED, ATTACHED_TO_CLAIM, EXPORTED
- **Chain of Custody**: Full audit trail
- **Status**: ✅ Operational

### Issue Capture

- **Routes**: fieldProductivityRoutes.ts
- **Status**: ✅ Operational

### Voice Logs

- **Table**: voiceLogs
- **Routes**: fieldProductivityRoutes.ts
- **Status**: ✅ Operational

### Offline Sync

- **Table**: offlineSyncQueue
- **⚠️ Issue**: snapshotBuilder.ts references missing syncStatus field

**Flagged Issues:**
- snapshotBuilder.ts field mismatches for delayClaims and offlineSyncQueue

---

## SECTION 6 — MARKETPLACE & VENDOR SYSTEMS

### Vendor Records

- **Tables**: crmOrganisations (types: CONTRACTOR, SUBCONTRACTOR, SUPPLIER, VENDOR, RENTAL_VENDOR, OWNER_REP)
- **Contacts**: crmContacts with roles
- **Notes**: crmOrganisationNotes
- **Status**: ✅ Operational

### Vendor Pricing Catalogs

- **Tables**: vendorPricebooks, pricebookImportJobs
- **Routes**: vendorPricebookRoutes.ts (7 endpoints)
- **Status**: ✅ Operational

### PDF → AI Pricebook Ingestion

- **Service**: vendorPriceListExtractor.ts
- **AI-Powered**: Uses OpenAI for extraction
- **Status**: ✅ Operational

### Vendor Scoring

- **Table**: vendorScores
- **Routes**: marketplaceRoutes.ts
- **Status**: ✅ Operational

### Material Price Index

- **Table**: materialPriceIndex
- **Routes**: marketplaceRoutes.ts
- **Status**: ✅ Operational

### Crew Marketplace

- **Table**: crewMarketplace
- **⚠️ Issue**: snapshotBuilder.ts references missing status field

**Flagged Issues:**
- crewMarketplace status field mismatch in snapshotBuilder.ts

---

## SECTION 7 — AI SYSTEMS (CRITICAL)

### AI Orchestrator

- **File**: server/ai/orchestrator.ts
- **Function**: runAIAnalysis() - Daily PM + CFO analysis
- **Data Source**: snapshotBuilder.ts, profitabilityEngine.ts
- **Output**: aiRuns, aiTasks
- **Status**: ✅ Operational

### SnapshotBuilder

- **File**: server/ai/snapshotBuilder.ts
- **Function**: buildDataSnapshot() - Aggregates all org data
- **⚠️ Status**: Has 10 LSP errors (type mismatches)

### AI PM + CFO

- **Prompt**: server/ai/systemPrompt.ts
- **Features**: Role-based tasks, profitability analysis, scheduling, billing alerts
- **Output Format**: Structured JSON with tasks, insights, alerts
- **Status**: ✅ Updated with 73-trade taxonomy

### AI Estimator

- **Routes**: aiBidDocumentRoutes.ts, aiContractDocumentRoutes.ts
- **Tables**: aiBidDocumentAnalysis, aiContractDocumentAnalysis
- **Status**: ✅ Operational

### AI Onboarding Wizard

- **Routes**: aiRoutes.ts (onboarding endpoints)
- **Features**: Trade discovery, SOW suggestions, calculator setup
- **Status**: ✅ Operational

### Trade Discovery (NEW)

- **File**: server/ai/tradeDiscoveryService.ts
- **Functions**: 
  - discoverTradesFromDescription()
  - suggestTradesForBidDocument()
  - getTradesWithSowCounts()
  - getTradeModifierCategories()
- **Status**: ✅ Newly implemented

### Scope Prediction (NEW)

- **File**: server/ai/scopePredictionEngine.ts
- **Functions**:
  - predictRelevantScopeItems()
  - searchScopeItems()
  - getScopeItemsForTrade()
  - suggestScopeFromBidDocument()
- **Status**: ✅ Newly implemented

### What-If Simulations

- **Routes**: aiFeatureRoutes.ts
- **Page**: what-if-simulator.tsx
- **Status**: ✅ Operational

### AI Data Quality

- **File**: server/ai/dataQualityScorer.ts
- **Table**: aiDataQuality
- **Status**: ✅ Operational

**Critical AI Issues:**
- snapshotBuilder.ts has 10 LSP errors that could cause runtime issues if delayClaims, offlineSyncQueue, or crewMarketplace data is processed

---

## SECTION 8 — ONBOARDING & USER EXPERIENCE

### New Company Onboarding

- **Page**: onboarding.tsx
- **Routes**: aiRoutes.ts (onboarding endpoints)
- **Flow**: Welcome → Trade Selection → AI Discovery → Feature Setup → Billing
- **Status**: ✅ Operational

### Trade Discovery

- **AI-Powered**: Uses tradeDiscoveryService.ts
- **73 Trades**: Full taxonomy available
- **Custom Trades**: "OTHER" type with AI research
- **Status**: ✅ Operational

### Feature Selection

- **Plan Tiers**: 4 tiers available
- **Add-Ons**: 6 add-ons configurable
- **Status**: ✅ Operational

### Billing Activation

- **Stripe Integration**: Configured
- **Manual Mode**: Available for testing
- **Status**: ✅ Operational

### Role Assignment

- **10 Roles**: Full RBAC system
- **Permissions**: Role-based access throughout
- **Status**: ✅ Operational

### Role-Based Walkthroughs

- **File**: server/ai/walkthroughContent.ts
- **Feature**: Personalized onboarding by role
- **Status**: ✅ Operational

**Flagged Issues:** None

---

## SECTION 9 — EXECUTIVE & ADMIN TOOLS

### Executive Dashboards

- **Pages**: executive-digest.tsx, hustler-dashboard.tsx, cfo-dashboard.tsx
- **Data**: AI-generated insights, profitability analysis
- **Status**: ✅ Operational

### Health Scores

- **Page**: company-health.tsx
- **Service**: dataQualityScorer.ts
- **Status**: ✅ Operational

### Benchmarking

- **Page**: hustler-benchmarking.tsx
- **Cross-Org Analysis**: For HUSTLER role
- **Status**: ✅ Operational

### Unified Inbox

- **Page**: hustler-unified-inbox.tsx
- **Multi-Org**: Aggregated view for HUSTLER
- **Status**: ✅ Operational

### Platform Admin Tools

- **Pages**: PlatformAdminDashboard, PlatformAnalytics, PlatformOrganizations, PlatformSupportTools
- **Routes**: platformAdminRoutes.ts (12 endpoints)
- **Access**: SUPER_ADMIN only
- **Status**: ✅ Operational

**Flagged Issues:** None

---

## SECTION 10 — PERFORMANCE, STABILITY & OBSERVABILITY

### Query Performance

- **Pagination**: Implemented with limits
- **Indexes**: Defined in schema
- **Status**: ✅ Acceptable

### API Response Times

- **Rate Limiting**: Configured via rateLimiter.ts
- **Status**: ✅ Acceptable

### Frontend Rendering

- **React Query**: Caching implemented
- **Loading States**: Throughout application
- **Status**: ✅ Acceptable

### Logging & Monitoring

- **Logger**: server/utils/logger.ts (logInfo, logError, logWarn)
- **Audit Log**: Comprehensive via auditLogger.ts
- **Status**: ✅ Operational

### Error Handling

- **API Errors**: Consistent error responses
- **Validation**: Zod schemas throughout
- **Status**: ✅ Acceptable

**Flagged Issues:** None critical

---

## DELIVERABLES

### 1. Overall Platform Status

# READY WITH FIXES

The platform is functionally complete with comprehensive features. Minor fixes required in snapshotBuilder.ts before production deployment.

---

### 2. Critical Issues (Must Fix Before Prod)

| ID | Issue | Location | Impact |
|----|-------|----------|--------|
| C1 | snapshotBuilder.ts has 10 LSP/type errors | server/ai/snapshotBuilder.ts | AI orchestrator may fail when processing delayClaims, offlineSyncQueue, or crewMarketplace data |

---

### 3. Major Issues (Functional Gaps)

| ID | Issue | Location | Impact |
|----|-------|----------|--------|
| M1 | delayClaims missing claimedDays, claimedAmount, delayType fields in snapshot | snapshotBuilder.ts:1099-1109 | Delay claims won't be properly included in AI analysis |
| M2 | offlineSyncQueue missing syncStatus field reference | snapshotBuilder.ts:1142 | Offline sync status won't be tracked in snapshots |
| M3 | crewMarketplace missing status field reference | snapshotBuilder.ts:1172 | Crew marketplace listings won't be filtered properly |

---

### 4. Minor Issues (Polish)

| ID | Issue | Location | Impact |
|----|-------|----------|--------|
| P1 | Type coercion for nullable project_id in field_productivity | snapshotBuilder.ts:1326 | TypeScript strict mode warning |

---

### 5. Security Risks

**None identified.** The platform has:
- Rate limiting
- Input sanitization
- RBAC enforcement
- Multi-tenant isolation
- Audit logging
- Token versioning for logout

---

### 6. Orphaned / Unused Components

**None identified.** All route files have active endpoints. All pages are registered in routing.

---

### 7. Recommended Next Steps (Audit-Driven)

| Priority | Action | Effort |
|----------|--------|--------|
| 1 | Fix snapshotBuilder.ts type errors - align field names with actual schema | 2-4 hours |
| 2 | Verify delayClaims table has claimedDays, claimedAmount, delayType columns or update snapshot logic | 1-2 hours |
| 3 | Verify offlineSyncQueue has syncStatus column or update snapshot logic | 30 min |
| 4 | Verify crewMarketplace has status column or update snapshot logic | 30 min |
| 5 | Run full integration test suite after fixes | 2-4 hours |
| 6 | Seed production database with 73-trade taxonomy data | 1 hour |

---

## APPENDIX A — TRADE TAXONOMY (73 Trades)

### Original Trades (23)
GENERAL_CONTRACTOR, CONCRETE, EARTHWORK, ASPHALT_PAVING, ROOFING, ELECTRICAL, PLUMBING, HVAC, CARPENTRY, MASONRY, DRYWALL, PAINTING, FLOORING, LANDSCAPING, DEMOLITION, STEEL_ERECTION, GLAZING, INSULATION, FIRE_PROTECTION, LOW_VOLTAGE, SOLAR, WATERPROOFING, OTHER

### Civil/Site/Environmental (20)
SITE_DEMOLITION, MASS_EXCAVATION, TRENCHING, SHORING, DEWATERING, SOIL_STABILIZATION, ENVIRONMENTAL_REMEDIATION, WELL_PLUGGING, STORMWATER_SYSTEMS, SANITARY_SEWER, WATERLINE, FORCE_MAIN, ROADWAY_CONSTRUCTION, CURB_AND_GUTTER, SIDEWALK, CONCRETE_PAVING, TRAFFIC_CONTROL, STRIPING_AND_SIGNAGE, EROSION_CONTROL, FENCING_AND_GATES

### Structural/Building (13)
CAST_IN_PLACE_CONCRETE, PRECAST_CONCRETE, REBAR_AND_POST_TENSION, STRUCTURAL_STEEL, METAL_BUILDINGS, CARPENTRY_FRAMING, DRYWALL_SYSTEMS, ACOUSTICAL_CEILINGS, PAINTING_AND_COATINGS, FLOORING_SYSTEMS, ROOFING_SYSTEMS, MASONRY_SYSTEMS, GLAZING_SYSTEMS

### MEP/Specialty (11)
ELECTRICAL_UNDERGROUND, ELECTRICAL_OVERHEAD, MECHANICAL_PIPING, HVAC_SYSTEMS, PLUMBING_SYSTEMS, FIRE_PROTECTION_SYSTEMS, LOW_VOLTAGE_SYSTEMS, SECURITY_AND_ACCESS, COMMUNICATIONS_IT, SOLAR_INSTALLATION, TEMPORARY_POWER

### Support Services (5)
SURVEY_AND_LAYOUT, TESTING_AND_INSPECTIONS, COMMISSIONING, TEMPORARY_FACILITIES, GENERAL_CONDITIONS

---

## APPENDIX B — DATABASE TABLE COUNT

**Total Tables:** 120+
**Total Enums:** 50+
**Master SOW Items:** 637+
**Master Modifiers:** 376+
**Modifier Categories:** 109+

---

*End of Audit Report*
