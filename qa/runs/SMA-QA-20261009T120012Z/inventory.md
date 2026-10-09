# SmartManageAI — QA Feature Inventory (coverage-matrix input)

Generated 2026-10-09 by static read of `/home/user/SmartManageAI` (read-only). Counts were extracted by script. **Endpoint counts are regex counts** of `router.|app.(get|post|put|patch|delete|all)(<path>` per file. They are approximate: they include multi-line declarations, and dynamic or helper-registered routes may be missed.

## Headline counts

| Item | Count |
|---|---|
| Frontend `<Route path>` entries (client/src/App.tsx, single wouter `<Switch>`; no nested routers) | 211 + 1 catch-all NotFound |
| … public (no auth) | 29 (4 of these are DEV-build-only harness/preview routes) |
| … pure redirects (legacy URLs → tabs/new pages) | 35 |
| … gated by RoutePermissions/role predicate | 144 (22 SUPER_ADMIN-only `/admin*`) |
| … additionally/alternatively gated by `featurePerm` | 33 |
| … gated by org feature flag (`FeatureFlagGate`) | 8 |
| … auth-only (any logged-in user) | 19 |
| Backend router mounts (server/routes.ts + aiOrchestration sub-routers + publicApi oauth) | 209 |
| Backend endpoints (regex count) | ~3,090 |
| node-cron jobs in `server/jobs/jobRunner.ts` | 64 |
| Other schedulers/workers started at boot | 13 (in 10 modules) |
| pg-boss queues | 7 |
| One-shot admin backfill jobs | 4 |
| Inbound webhooks | 7 |
| Import/export/PDF/CSV endpoints | 183 in 69 files |
| Feature flags (`FEATURE_FLAG_KEYS`) | 54 (27 default OFF, 27 default ON) |
| Plan FeatureKeys (`shared/billing/plans.ts`) | 47, across 4 tiers + 9 add-ons |
| Vitest test files | 500 (server 346 [331 in server/__tests__], shared 10, client 143, mobile 1; 2 `*.serial.test.ts` excluded by default) |
| Playwright e2e specs (e2e/) | 81 |
| Audit integration specs (audit/tests, vitest.integration.config.ts) | 8 |
| k6 load scenarios | 3 (smoke, top-endpoints, noisy-neighbor) + AI-takeoff bench (5 fixtures) |

## 1. Frontend routes (client/src/App.tsx)

How gating works: `ProtectedRoute` sends anonymous users to `/login?redirect=`. It sends users with no org, or whose onboarding is incomplete, to `/onboarding` unless the route sets `skipOnboardingCheck`. Access is allowed when `permission(role, perms)` passes **OR** any `featurePerm` key is true; otherwise the page shows "Access Denied". The `RoutePermissions.*` predicates in `client/src/lib/rbac.ts` use the server-loaded per-user feature perms when they exist and fall back to role lists only before those perms load. `FeatureFlagGate` shows "Feature Not Available". Client checks only control what the UI shows; the server is authoritative.

Roles: SUPER_ADMIN (platform), ADMIN, HUSTLER, MANAGER, SUPERINTENDENT, ESTIMATOR, FIELD_WORKER, VENDOR. Role → default permission flags live in `server/rolePermissions.ts` (`ROLE_DEFAULT_PERMISSIONS`).

| Path | Page component | Gate |
|---|---|---|
| `/` | LandingPage (anon) / Redirect→/portfolio (SUPER_ADMIN,ADMIN,MANAGER) or /dashboard | public |
| `/login` | LoginPage | public |
| `/forgot-password` | ForgotPasswordPage | public |
| `/reset-password` | ResetPasswordPage | public |
| `/register` | RegisterPage | public |
| `/impersonate` | ImpersonatePage | public |
| `/trust` | TrustPage | public |
| `/sub-processors` | SubProcessorsPage | public |
| `/status` | StatusPage | public |
| `/help` | HelpCenterPage | public |
| `/support/rate/:token` | SupportRatePage | public |
| `/sla` | SlaPage | public |
| `/privacy` | PrivacyPolicyPage | public |
| `/terms` | TermsOfServicePage | public |
| `/dpa` | DpaPage | public |
| `/data-management` | DataManagementPage | auth |
| `/site/:subdomain/staging` | PublicWebsite | public |
| `/site/:subdomain` | PublicWebsite | public |
| `/shared-preview/:token` | SharedPreviewPage | public |
| `/portal/:projectId` | Redirect→/portal${separator}projectId=${encodeURIComponent(projectId)} | redirect |
| `/sub-portal` | Redirect→/portal${search} | redirect |
| `/portal` | UnifiedPortal | public |
| `/rfq-response/:token` | RfqResponsePage | public |
| `/print/projects/:code/schedule` | SchedulePrintPage | auth; skipOnboarding |
| `/print/plan-documents/:id` | PlanDocumentPrintPage | auth; skipOnboarding |
| `/onboarding` | OnboardingPage | auth; skipOnboarding |
| `/dashboard` | DashboardPage | auth |
| `/profile` | ProfilePage | auth |
| `/settings/:section` | SettingsPage | auth |
| `/settings` | SettingsPage | auth |
| `/projects` | ProjectsPage | auth; perm:RoutePermissions.PROJECTS |
| `/templates/projects` | ProjectTemplatesPage | auth; perm:RoutePermissions.PROJECTS |
| `/projects/:code` | ProjectDetailPage | auth; perm:RoutePermissions.PROJECT_DETAIL |
| `/calendar` | CalendarPage | auth; perm:RoutePermissions.CALENDAR |
| `/leave-management` | LeaveManagementPage | auth; perm:RoutePermissions.LEAVE_MANAGEMENT |
| `/communications` | CompanyCommunicationsPage | auth; perm:RoutePermissions.BULLETINS |
| `/tasks` | TasksPage | auth; perm:RoutePermissions.TASKS |
| `/daily-reports` | DailyReportsPage | auth; perm:RoutePermissions.PROJECTS |
| `/my-day` | MyDayPage | auth |
| `/notifications` | NotificationsInboxPage | auth |
| `/my-work` | MyWorkPage | auth |
| `/time-clock` | TimeClockPage | auth; perm:RoutePermissions.TIME_CLOCK |
| `/messages` | UnifiedMessagesPage | auth; perm:RoutePermissions.MESSAGES |
| `/portal-chat` | UnifiedMessagesPage | auth; perm:RoutePermissions.MESSAGES |
| `/users` | Redirect→/company-settings?tab=users | auth; perm:RoutePermissions.USERS |
| `/ai-settings` | Redirect→/company-settings?tab=ai-settings | auth; perm:RoutePermissions.AI_SETTINGS |
| `/ai-estimator/admin` | AiEstimatorAdminPage | auth; perm:RoutePermissions.AI_ESTIMATOR_ADMIN; featurePerm:canManageAiEstimator |
| `/cost-rates` | CostRatesPage | auth; perm:RoutePermissions.COST_RATES; featurePerm:canViewFinancials |
| `/cost-book` | CostBookPage | auth; role∈{ADMIN,SUPER_ADMIN,MANAGER,ESTIMATOR,HUSTLER} |
| `/crew-templates` | CrewTemplatesPage | auth; role∈{ADMIN,SUPER_ADMIN,MANAGER,ESTIMATOR,HUSTLER} |
| `/crews` | CrewsPage | auth; perm:RoutePermissions.CREWS; featurePerm:canManageScheduling |
| `/dispatch-board` | DispatchBoardPage | auth; perm:RoutePermissions.DISPATCH_BOARD; featurePerm:canManageScheduling |
| `/subcontractor-payables` | Redirect→/subcontracts | auth; perm:RoutePermissions.SUBCONTRACTS; featurePerm:canViewFinancials |
| `/company-settings` | CompanySettingsPage | auth; perm:RoutePermissions.COMPANY_SETTINGS; featurePerm:["canAccessCompanySettings", "canAccessScopeSettings", "canAccessProductionRates", "canLockDailyReports", "canManageWebsite"] |
| `/integrations` | Redirect→/company-settings?tab=integrations | auth; perm:RoutePermissions.COMPANY_SETTINGS |
| `/developer-portal` | DeveloperPortalPage | auth; perm:RoutePermissions.COMPANY_SETTINGS |
| `/developer-docs` | DeveloperDocsPage | auth; role∈{SUPER_ADMIN,ADMIN}; skipOnboarding |
| `/approvals` | ApprovalsPage | auth |
| `/ai-governance` | Redirect→/company-settings?tab=ai-governance | auth; perm:RoutePermissions.AI_SETTINGS |
| `/audit-logs` | AuditLogsPage | auth; perm:RoutePermissions.COMPANY_SETTINGS |
| `/admin/email-outbox` | AdminEmailOutboxPage | auth; perm:RoutePermissions.PLATFORM_ADMIN; skipOnboarding |
| `/admin/status` | AdminStatusPage | auth; perm:RoutePermissions.PLATFORM_ADMIN; skipOnboarding |
| `/admin/transcript-backfill` | AdminTranscriptBackfillPage | auth; role∈{ADMIN,SUPER_ADMIN} |
| `/admin/log-email-failures` | AdminLogEmailFailuresPage | auth; role∈{ADMIN,SUPER_ADMIN,MANAGER,SUPERINTENDENT} |
| `/enterprise-settings` | EnterpriseSettingsPage | auth; perm:RoutePermissions.COMPANY_SETTINGS |
| `/cost-codes` | Redirect→/company-settings?tab=cost-codes | auth; perm:RoutePermissions.COMPANY_SETTINGS |
| `/bids/new` | BidWizardPage | auth; perm:RoutePermissions.BIDS |
| `/bids/hit-rate` | BidHitRatePage | auth; perm:RoutePermissions.BIDS |
| `/bids` | BidsPage | auth; perm:RoutePermissions.BIDS |
| `/historical-costs` | HistoricalCostsPage | auth; perm:RoutePermissions.HISTORICAL_COSTS |
| `/bids/:code/estimate` | BidEstimate | auth; perm:RoutePermissions.BID_DETAIL |
| `/bids/:code` | BidDetailPage | auth; perm:RoutePermissions.BID_DETAIL |
| `/takeoff/project/:projectCode` | TakeoffWorkspacePage | auth; perm:RoutePermissions.TAKEOFF |
| `/takeoff/review-queue` | TakeoffReviewQueuePage | auth; perm:RoutePermissions.TAKEOFF |
| `/takeoff/:bidCode/schedule-symbols` | TakeoffScheduleSymbolsPage | auth; perm:RoutePermissions.TAKEOFF |
| `/takeoff/standalone/:id/workspace` | TakeoffStandaloneWorkspacePage | auth; perm:RoutePermissions.TAKEOFF |
| `/takeoff/standalone/:id` | TakeoffStandalonePage | auth; perm:RoutePermissions.TAKEOFF |
| `/takeoff/ai-dashboard` | AiTakeoffDashboardPage | auth; perm:RoutePermissions.TAKEOFF |
| `/takeoff/:bidCode` | TakeoffWorkspacePage | auth; perm:RoutePermissions.TAKEOFF |
| `/takeoff` | TakeoffIndexPage | auth; perm:RoutePermissions.TAKEOFF |
| `/time-entry` | TimeEntryPage | auth; perm:RoutePermissions.TIME_ENTRY; featurePerm:canManageScheduling |
| `/tm-daily` | TMDailyPage | auth; perm:RoutePermissions.TM_DAILY |
| `/tm-billing` | TMBillingPage | auth; perm:RoutePermissions.TM_BILLING; featurePerm:canViewFinancials |
| `/progress-billing` | ProgressBillingPage | auth; perm:RoutePermissions.PROGRESS_BILLING; featurePerm:canViewFinancials |
| `/wip-report` | WipReportPage | auth; perm:RoutePermissions.CFO |
| `/time-clock-manager` | TimeClockManagerPage | auth; perm:RoutePermissions.TIME_CLOCK_MANAGER; featurePerm:canManagePayroll |
| `/ai-pm` | Redirect→/dashboard | auth; perm:RoutePermissions.AI_PM; featurePerm:canUseAiFeatures |
| `/cfo-dashboard` | CFODashboardPage | auth; perm:RoutePermissions.CFO |
| `/cfo` | Redirect→/cfo-dashboard | auth; perm:RoutePermissions.CFO |
| `/production-rates` | Redirect→/company-settings?tab=production-rates | auth; perm:RoutePermissions.PRODUCTION_RATES |
| `/crm` | CRMPage | auth; perm:RoutePermissions.CRM |
| `/crm/deals/:id` | CrmDealDetailPage | auth; perm:RoutePermissions.CRM |
| `/sequences` | SequencesPage | auth; perm:RoutePermissions.CRM |
| `/sequences/:id` | SequenceDetailPage | auth; perm:RoutePermissions.CRM |
| `/crm-settings` | CrmSettingsPage | auth; perm:RoutePermissions.CRM |
| `/leads/:orgSlug` | PublicLeadFormPage | public |
| `/forms/:slug` | PublicFormPage | public |
| `/book/:slug` | PublicBookingPage | public |
| `/crm-upgrades` | CrmUpgradesPage | auth; perm:RoutePermissions.CRM |
| `/field-sales` | FieldSalesPage | auth; perm:RoutePermissions.CRM |
| `/quotes/accept/:token` | PublicQuoteAcceptPage | public |
| `/scope-settings` | Redirect→/company-settings?tab=scope-settings | auth; perm:RoutePermissions.SCOPE_SETTINGS |
| `/equipment/:code` | EquipmentDetailPage | auth; perm:RoutePermissions.EQUIPMENT; featurePerm:canManageEquipment |
| `/equipment` | EquipmentPage | auth; perm:RoutePermissions.EQUIPMENT; featurePerm:canManageEquipment |
| `/inventory` | InventoryPage | auth; perm:RoutePermissions.EQUIPMENT; featurePerm:canManageEquipment |
| `/lidar-scans` | LidarScansPage | auth; perm:RoutePermissions.LIDAR_SCANS; flag:LIDAR_SCANNER |
| `/permits` | PermitsPage | auth; perm:RoutePermissions.PERMITS |
| `/compliance` | CompliancePage | auth; perm:RoutePermissions.COMPLIANCE |
| `/coi-compliance` | CoiCompliancePage | auth; perm:RoutePermissions.COMPLIANCE |
| `/rental-vendors` | Redirect→/crm | auth; perm:RoutePermissions.CRM |
| `/vendor-pricing` | VendorPricingPage | auth; perm:RoutePermissions.CRM; featurePerm:canManageProcurement |
| `/mobile-sync` | MobileSyncPage | auth |
| `/ai-document-analysis` | Redirect→/contracts or /bids (by ?mode) | auth; perm:AI_BID_ANALYSIS||AI_CONTRACT_ANALYSIS OR featurePerm:canUseAiFeatures |
| `/ai-bid-analysis` | Redirect→/bids | auth; perm:RoutePermissions.AI_BID_ANALYSIS; featurePerm:canUseAiFeatures |
| `/ai-contract-analysis` | Redirect→/contracts | auth; perm:RoutePermissions.AI_CONTRACT_ANALYSIS; featurePerm:canUseAiFeatures |
| `/daily-report-locks` | Redirect→/company-settings?tab=report-locks | auth; perm:RoutePermissions.DAILY_REPORT_LOCKS |
| `/voice-logs` | Redirect→/dashboard | auth |
| `/issue-captures` | IssueCapturesPage | auth |
| `/offline-sync` | OfflineSyncPage | auth |
| `/marketplace/contractors/:orgId` | ContractorProfilePage | auth |
| `/marketplace` | MarketplacePage | auth; perm:RoutePermissions.MARKETPLACE |
| `/vendor-scores` | VendorScoresPage | auth; perm:RoutePermissions.CRM |
| `/material-price-index` | MaterialPriceIndexPage | auth; perm:RoutePermissions.CRM |
| `/crew-marketplace` | Redirect→/marketplace?tab=crews | auth; perm:RoutePermissions.CRM |
| `/equipment-rental-marketplace` | Redirect→/marketplace?tab=equipment | auth |
| `/pricebook-import` | PricebookImportPage | auth; perm:RoutePermissions.CRM; featurePerm:canManageProcurement |
| `/company-health` | CompanyHealthPage | auth; perm:RoutePermissions.CFO |
| `/executive-digest` | ExecutiveDigestPage | auth; perm:RoutePermissions.EXECUTIVE_DIGEST |
| `/portfolio` | PortfolioPage | auth; perm:RoutePermissions.PORTFOLIO |
| `/what-if-simulator` | WhatIfSimulatorPage | auth; perm:RoutePermissions.CFO; flag:WHATIF_SIMULATOR |
| `/bid-network/:id` | BidNetworkDetailPage | auth; perm:RoutePermissions.BID_NETWORK_GC |
| `/bid-network` | BidNetworkPage | auth; perm:RoutePermissions.BID_NETWORK_GC |
| `/bid-inbox/:id` | BidInboxPage | auth; perm:RoutePermissions.BID_NETWORK_INBOX |
| `/bid-inbox` | BidInboxPage | auth; perm:RoutePermissions.BID_NETWORK_INBOX |
| `/calculator` | CalculatorPage | auth |
| `/reports` | ReportsPage | auth; perm:RoutePermissions.REPORTS; featurePerm:canAccessReports |
| `/manage-workers/:id` | WorkerDetailPage | auth; perm:RoutePermissions.MANAGE_WORKERS; featurePerm:canManagePayroll |
| `/manage-workers` | ManageWorkersPage | auth; perm:RoutePermissions.MANAGE_WORKERS; featurePerm:canManagePayroll |
| `/safety-training` | SafetyTrainingPage | auth; perm:RoutePermissions.SAFETY_TRAINING |
| `/safety` | SafetyHubPage | auth; perm:RoutePermissions.SAFETY_TRAINING |
| `/payroll-management` | PayrollManagementPage | auth; perm:RoutePermissions.PAYROLL_MANAGEMENT; featurePerm:canManagePayroll |
| `/payroll/certified-history` | CertifiedPayrollHistoryPage | auth; perm:RoutePermissions.PAYROLL_MANAGEMENT; featurePerm:canManagePayroll |
| `/overtime-rules` | OvertimeRulesPage | auth; perm:RoutePermissions.PAYROLL_MANAGEMENT; featurePerm:canManagePayroll |
| `/contracts` | ContractsPage | auth; role∈{ADMIN,MANAGER,SUPERINTENDENT} OR featurePerm:canManageContracts |
| `/clause-library` | ClauseLibraryPage | auth; role∈{ADMIN,MANAGER} OR featurePerm:canManageContracts |
| `/subcontracts` | SubcontractsPage | auth; perm:RoutePermissions.SUBCONTRACTS; featurePerm:canViewFinancials |
| `/website-builder` | Redirect→/company-settings?tab=website | auth; perm:RoutePermissions.WEBSITE_BUILDER |
| `/social-media` | SocialMediaPage | auth; perm:RoutePermissions.SOCIAL_MEDIA; featurePerm:canPostSocialMedia |
| `/email-assistant` | EmailAssistantPage | auth; perm:RoutePermissions.EMAIL_ASSISTANT |
| `/email-campaigns` | EmailCampaignsPage | auth; perm:RoutePermissions.EMAIL_ASSISTANT |
| `/procurement-module` | ProcurementModulePage | auth; perm:RoutePermissions.PROCUREMENT; featurePerm:canManageProcurement |
| `/billing` | BillingPage | auth; perm:RoutePermissions.COMPANY_SETTINGS |
| `/talent-pool/:id` | TalentPoolPage | auth |
| `/talent-pool` | Redirect→/marketplace?tab=talent | auth |
| `/hiring/jobs/:id` | HiringJobDetailPage | auth; perm:RoutePermissions.HIRING_REVIEW; featurePerm:canManageHiring |
| `/hiring/candidates/:id` | HiringCandidateDetailPage | auth; perm:RoutePermissions.HIRING_REVIEW; featurePerm:canManageHiring |
| `/hiring/jobs` | Redirect→/hiring?tab=jobs | redirect |
| `/hiring/candidates` | Redirect→/hiring?tab=candidates | redirect |
| `/hiring/pipeline` | Redirect→/hiring?tab=pipeline | redirect |
| `/hiring/interviews` | Redirect→/hiring?tab=interviews | redirect |
| `/hiring/tasks` | Redirect→/hiring?tab=tasks | redirect |
| `/hiring/analytics` | Redirect→/hiring?tab=analytics | redirect |
| `/hiring/settings` | Redirect→/hiring?tab=settings | redirect |
| `/hiring` | HiringPage | auth; perm:RoutePermissions.HIRING_REVIEW; featurePerm:canManageHiring |
| `/overhead-costs` | Redirect→/company-settings?tab=overhead-costs | auth; perm:RoutePermissions.OVERHEAD_COSTS |
| `/vendor/pricing` | VendorPortalPricing | auth; perm:VendorRoutePermissions.VENDOR_PRICING |
| `/vendor/clients` | VendorClients | auth; perm:VendorRoutePermissions.VENDOR_CLIENTS |
| `/vendor/messages` | VendorMessages | auth; perm:VendorRoutePermissions.VENDOR_MESSAGES |
| `/vendor/documents` | VendorDocuments | auth; perm:VendorRoutePermissions.VENDOR_DOCUMENTS |
| `/vendor/compliance` | VendorCompliance | auth; perm:VendorRoutePermissions.VENDOR_COMPLIANCE |
| `/vendor/purchase-orders` | VendorPurchaseOrders | auth; perm:VendorRoutePermissions.VENDOR_PURCHASE_ORDERS |
| `/vendor/schedule` | VendorSchedule | auth; perm:VendorRoutePermissions.VENDOR_SCHEDULE |
| `/vendor/analytics` | VendorAnalytics | auth; perm:VendorRoutePermissions.VENDOR_ANALYTICS |
| `/vendor` | Redirect→/vendor/analytics | redirect |
| `/admin` | PlatformAdminDashboard | auth; perm:RoutePermissions.PLATFORM_ADMIN; skipOnboarding |
| `/dot-library` | DotLibraryPage | auth |
| `/haul-tickets` | HaulTicketsPage | auth; flag:HAUL_TICKETS |
| `/daily-inspector-reports` | DailyInspectorReportsPage | auth; flag:DAILY_INSPECTOR_REPORTS |
| `/swppp-inspections` | SwpppInspectionsPage | auth; flag:SWPPP_INSPECTIONS |
| `/surety-bonds` | SuretyBondsPage | auth; flag:SURETY_BONDS |
| `/dbe-goals` | DbeGoalsPage | auth; flag:DBE_TRACKING |
| `/material-certifications` | MaterialCertificationsPage | auth; flag:BUY_AMERICA |
| `/admin/organizations/:id/view` | ViewAsOrganization | auth; perm:RoutePermissions.PLATFORM_ADMIN; skipOnboarding |
| `/admin/organizations/:id` | PlatformOrganizationDetail | auth; perm:RoutePermissions.PLATFORM_ADMIN; skipOnboarding |
| `/admin/organizations` | PlatformOrganizations | auth; perm:RoutePermissions.PLATFORM_ADMIN; skipOnboarding |
| `/admin/analytics` | PlatformAnalyticsMonitoring | auth; perm:RoutePermissions.PLATFORM_ADMIN; skipOnboarding |
| `/admin/tools` | PlatformTools | auth; perm:RoutePermissions.PLATFORM_ADMIN; skipOnboarding |
| `/admin/gantt-pdf` | GanttPdfHealth | auth; perm:RoutePermissions.PLATFORM_ADMIN; skipOnboarding |
| `/admin/portfolio-pdf` | PortfolioPdfHealth | auth; perm:RoutePermissions.PLATFORM_ADMIN; skipOnboarding |
| `/admin/job-metrics` | JobMetricsHealth | auth; perm:RoutePermissions.PLATFORM_ADMIN; skipOnboarding |
| `/admin/one-shot-jobs` | AdminOneShotJobs | auth; perm:RoutePermissions.PLATFORM_ADMIN; skipOnboarding |
| `/admin/job-queue` | JobQueueAdminPage | auth; perm:RoutePermissions.PLATFORM_ADMIN; skipOnboarding |
| `/admin/support-tickets` | AdminSupportTicketsPage | auth; perm:RoutePermissions.PLATFORM_ADMIN; skipOnboarding |
| `/admin/support-canned-responses` | AdminCannedResponsesPage | auth; perm:RoutePermissions.PLATFORM_ADMIN; skipOnboarding |
| `/admin/jobs/metrics` | JobMetricsDashboard | auth; perm:RoutePermissions.PLATFORM_ADMIN; skipOnboarding |
| `/admin/jobs/dot-pay-items-refresh` | DotPayItemsRefreshAdminPage | auth; perm:RoutePermissions.PLATFORM_ADMIN; skipOnboarding |
| `/admin/ai-takeoff-accuracy` | AiTakeoffAccuracyPage | auth; role∈{ADMIN,SUPER_ADMIN,MANAGER} |
| `/admin/subscriptions` | Redirect→/admin/tools | auth; perm:RoutePermissions.PLATFORM_ADMIN; skipOnboarding |
| `/admin/support` | Redirect→/admin/tools | auth; perm:RoutePermissions.PLATFORM_ADMIN; skipOnboarding |
| `/admin/audit` | Redirect→/admin/tools | auth; perm:RoutePermissions.PLATFORM_ADMIN; skipOnboarding |
| `/admin/monitoring` | Redirect→/admin/analytics | auth; perm:RoutePermissions.PLATFORM_ADMIN; skipOnboarding |
| `/admin/announcements` | Redirect→/admin/tools | auth; perm:RoutePermissions.PLATFORM_ADMIN; skipOnboarding |
| `/hustler/accept-invite/:token` | AcceptHustlerInvitePage | public |
| `/hustler/inbox` | HustlerUnifiedInbox | auth; role=HUSTLER; skipOnboarding |
| `/hustler/benchmarking` | HustlerBenchmarking | auth; role=HUSTLER; skipOnboarding |
| `/hustler/org/:orgId` | HustlerOrgDetail | auth; role=HUSTLER; skipOnboarding |
| `/hustler` | HustlerDashboard | auth; role=HUSTLER; skipOnboarding |
| `/test/plan-pins-harness` | PlanPinsHarnessPage | public; DEV build only (import.meta.env.DEV) |
| `/preview/dim-input-badge` | DimInputBadgePreviewPage | public; DEV build only (import.meta.env.DEV) |
| `/preview` | PreviewIndexPage | public; DEV build only (import.meta.env.DEV) |
| `/dev` | PreviewIndexPage | public; DEV build only (import.meta.env.DEV) |
| (no path) | NotFound | public (catch-all) |

Not routed through App.tsx: the client portal (`/portal`, token-based `UnifiedPortal`), the vendor portal pages under `/vendor/*`, and public website pages (`/site/:subdomain`). These pages are listed above, but most of their sub-navigation is driven by tabs and query strings rather than routes. Examples: `/company-settings?tab=…`, `/marketplace?tab=…`, `/hiring?tab=…`.

## 2. Backend route modules

All mounts are in `registerRoutes()` in `server/routes.ts`. Order: demo → web-vitals/api-docs → `authMiddleware` → ops → `requireActiveOrganization` → `orgContextMiddleware` (RLS) → `/api` rate limiter → modules. "(paths in file)" means the router declares absolute `/api/...` paths itself. Common in-file guards are `requireAuth`, `requireRole(...)`, `requireFeaturePermission('can…')`, `requireOrgFeatureFlag('FLAG')` (used only in dotRoutes and aiHeavyCivilFeatureRoutes), and `requireFeature('PLANKEY')` (plan gate, used only for SSO, AUDIT_EXPORT, DATA_RETENTION, PRIVACY_COMPLIANCE and MODIFIER_AI_SUGGEST).

Notes:
- `takeoffRecentsRoutes` is mounted twice (routes.ts lines 549 and 700).
- `devSeedEnterpriseRoutes` (`/api/dev`) is mounted only when dev seeding is enabled.
- `aiOrchestrationRoutes` mounts 6 AI sub-routers.
- Every `server/*Routes.ts` file is mounted. No orphan route files were found.

### Integrations / public API / webhooks — 4 mounts, 82 endpoints

| Mount prefix | Router | Source file | Endpoints |
|---|---|---|---|
| `/api/webhooks/email` | emailWebhookRoutes | `server/emailWebhookRoutes.ts` | 4 |
| `/api/integrations` | integrationRoutes | `server/integrationRoutes.ts` | 59 |
| `/api/v1/public` | publicApiRoutes | `server/publicApi/routes.ts` | 11 |
| `/api/integrations/dev-portal` | devPortalRoutes | `server/publicApi/devPortalRoutes.ts` | 8 |

### Admin / Super-admin / Platform ops — 39 mounts, 450 endpoints

| Mount prefix | Router | Source file | Endpoints |
|---|---|---|---|
| `(paths in file)` | demoRoutes | `server/demoRoutes.ts` | 1 |
| `(paths in file)` | opsRoutes | `server/opsRoutes.ts` | 6 |
| `(paths in file)` | searchRoutes | `server/searchRoutes.ts` | 1 |
| `/api` | aiOnboardingRoutes | `server/aiOnboardingRoutes.ts` | 12 |
| `(paths in file)` | onboardingLibraryRoutes | `server/onboardingLibraryRoutes.ts` | 10 |
| `/api` | platformRoutes | `server/platformRoutes.ts` | 57 |
| `/api` | hustlerRoutes | `server/hustlerRoutes.ts` | 24 |
| `(paths in file)` | devDocsRoutes | `server/devDocsRoutes.ts` | 3 |
| `/api/access-requests` | accessRequestRoutes | `server/accessRequestRoutes.ts` | 4 |
| `/api/feature-flags` | featureFlagRoutes | `server/featureFlagRoutes.ts` | 12 |
| `/api/sso` | ssoRoutes | `server/ssoRoutes.ts` | 5 |
| `/api/audit` | auditExportRoutes | `server/auditExportRoutes.ts` | 3 |
| `/api` | jobQueueAdminRoutes | `server/jobQueueAdminRoutes.ts` | 6 |
| `/api/retention` | retentionRoutes | `server/retentionRoutes.ts` | 5 |
| `/api/privacy` | privacyRoutes | `server/privacyRoutes.ts` | 6 |
| `(paths in file)` | orgLifecycleRoutes | `server/orgLifecycleRoutes.ts` | 12 |
| `(paths in file)` | userSettingsRoutes | `server/userSettingsRoutes.ts` | 16 |
| `(paths in file)` | savedViewsRoutes | `server/savedViewsRoutes.ts` | 4 |
| `(paths in file)` | myDayRoutes | `server/myDayRoutes.ts` | 1 |
| `(paths in file)` | myWorkRoutes | `server/myWorkRoutes.ts` | 5 |
| `(paths in file)` | devEmailRoutes | `server/devEmailRoutes.ts` | 3 |
| `/api/dev` | devSeedEnterpriseRoutes | `server/devSeedEnterprise.ts` | 9 |
| `(paths in file)` | authProfileRoutes | `server/authProfileRoutes.ts` | 49 |
| `(paths in file)` | oauthRoutes | `server/oauthRoutes.ts` | 7 |
| `(paths in file)` | passkeyRoutes | `server/passkeyRoutes.ts` | 6 |
| `(paths in file)` | dashboardRoutes | `server/dashboardRoutes.ts` | 47 |
| `(paths in file)` | incidentReviewRoutes | `server/incidentReviewRoutes.ts` | 5 |
| `(paths in file)` | statusPageRoutes | `server/statusPageRoutes.ts` | 21 |
| `(paths in file)` | supportRoutes | `server/supportRoutes.ts` | 31 |
| `(paths in file)` | supportAttachmentRoutes | `server/supportAttachmentRoutes.ts` | 3 |
| `(paths in file)` | locationRoutes | `server/locationRoutes.ts` | 10 |
| `(paths in file)` | auditBillingStorageRoutes | `server/auditBillingStorageRoutes.ts` | 13 |
| `/api` | jobMetricAlertRulesRoutes | `server/jobMetricAlertRulesRoutes.ts` | 2 |
| `/api` | jobMetricAlertEventsRoutes | `server/jobMetricAlertEventsRoutes.ts` | 10 |
| `(registers on app)` | registerWebVitalsRoutes | `server/webVitalsRoutes.ts` | 1 |
| `(registers on app)` | registerApiDocsRoutes | `server/apiDocsRoutes.ts` | 2 |
| `(registers on app)` | registerPerformanceRoutes | `server/performanceRoutes.ts` | 18 |
| `/api/v1/public/oauth (via publicApi/routes)` | oauthRoutes | `server/publicApi/oauthRoutes.ts` | 1 |
| `(inline in registerRoutes)` | routes.ts inline | `server/routes.ts` | 19 |

### Billing / subscription / payments — 4 mounts, 35 endpoints

| Mount prefix | Router | Source file | Endpoints |
|---|---|---|---|
| `/api/payments` | paymentRoutes | `server/paymentRoutes.ts` | 4 |
| `/api` | platformBillingRoutes | `server/platformBillingRoutes.ts` | 16 |
| `/api/billing` | billingRoutes | `server/billingRoutes.ts` | 14 |
| `/api/stripe` | stripeWebhookRoutes | `server/stripeWebhookRoutes.ts` | 1 |

### CRM / sales / marketing — 23 mounts, 255 endpoints

| Mount prefix | Router | Source file | Endpoints |
|---|---|---|---|
| `/api/social` | socialRoutes | `server/socialRoutes.ts` | 36 |
| `(paths in file)` | emailCampaignRoutes | `server/emailCampaignRoutes.ts` | 15 |
| `(paths in file)` | crmSlaRoutes | `server/crmSlaRoutes.ts` | 6 |
| `(paths in file)` | crmRoutes | `server/crmRoutes.ts` | 40 |
| `(paths in file)` | crmEmailLoggingRoutes | `server/crmEmailLoggingRoutes.ts` | 8 |
| `(paths in file)` | crmCallsRoutes | `server/crmCallsRoutes.ts` | 45 |
| `(paths in file)` | crmTasksRoutes | `server/crmTasksRoutes.ts` | 5 |
| `(paths in file)` | sequenceRoutes | `server/sequenceRoutes.ts` | 23 |
| `(paths in file)` | crmQuotesRoutes | `server/crmQuotesRoutes.ts` | 10 |
| `(paths in file)` | crmAssignmentRulesRoutes | `server/crmAssignmentRulesRoutes.ts` | 4 |
| `(paths in file)` | publicLeadsRoutes | `server/publicLeadsRoutes.ts` | 1 |
| `(paths in file)` | crmCatalogRoutes | `server/crmCatalogRoutes.ts` | 9 |
| `(paths in file)` | crmCustomFieldsRoutes | `server/crmCustomFieldsRoutes.ts` | 7 |
| `(paths in file)` | crmAnalyticsRoutes | `server/crmAnalyticsRoutes.ts` | 1 |
| `(paths in file)` | crmDuplicatesRoutes | `server/crmDuplicatesRoutes.ts` | 3 |
| `(paths in file)` | crmLeadScoringRoutes | `server/crmLeadScoringRoutes.ts` | 6 |
| `(paths in file)` | publicQuoteAcceptRoutes | `server/publicQuoteAcceptRoutes.ts` | 2 |
| `(paths in file)` | crmLeadFormsRoutes | `server/crmLeadFormsRoutes.ts` | 8 |
| `(paths in file)` | crmMeetingRoutes | `server/crmMeetingRoutes.ts` | 8 |
| `(paths in file)` | crmAutomationsRoutes | `server/crmAutomationsRoutes.ts` | 5 |
| `(paths in file)` | crmCsvImportRoutes | `server/crmCsvImportRoutes.ts` | 7 |
| `(paths in file)` | crmCustomReportsRoutes | `server/crmCustomReportsRoutes.ts` | 5 |
| `/api` | marketingPdfRoute | `server/marketingPdfRoute.ts` | 1 |

### Bids / estimating / bid network — 21 mounts, 320 endpoints

| Mount prefix | Router | Source file | Endpoints |
|---|---|---|---|
| `(paths in file)` | estimateRoutes | `server/estimateRoutes.ts` | 38 |
| `(paths in file)` | costBookRoutes | `server/costBookRoutes.ts` | 10 |
| `(paths in file)` | crewTemplateRoutes | `server/crewTemplateRoutes.ts` | 5 |
| `(paths in file)` | estimatePricingRoutes | `server/estimatePricingRoutes.ts` | 16 |
| `(paths in file)` | lineItemEnrichmentRoutes | `server/lineItemEnrichmentRoutes.ts` | 6 |
| `/api/calculators` | calculatorRoutes | `server/calculatorRoutes.ts` | 31 |
| `/api/labor-rates` | laborRateRoutes | `server/laborRateRoutes.ts` | 32 |
| `(paths in file)` | libraryRoutes | `server/libraryRoutes.ts` | 27 |
| `/api/bid-network` | bidNetworkRoutes | `server/bidNetworkRoutes.ts` | 19 |
| `/api` | addendaRoutes | `server/addendaRoutes.ts` | 9 |
| `(paths in file)` | bidRoutes2 | `server/bidRoutes.ts` | 34 |
| `(paths in file)` | bidAnalyticsRoutes | `server/bidAnalyticsRoutes.ts` | 1 |
| `(paths in file)` | productionRateRoutes | `server/productionRateRoutes.ts` | 5 |
| `(paths in file)` | scopeRoutes | `server/scopeRoutes.ts` | 36 |
| `(paths in file)` | skillRoutes | `server/skillRoutes.ts` | 7 |
| `(paths in file)` | assemblyRoutes | `server/assemblyRoutes.ts` | 8 |
| `(paths in file)` | orgEstimatingFactorsRoutes | `server/orgEstimatingFactorsRoutes.ts` | 6 |
| `(paths in file)` | aiEstimatorAssemblyRoutes | `server/aiEstimatorAssemblyRoutes.ts` | 4 |
| `(paths in file)` | aiEstimatorSkillsRoutes | `server/aiEstimatorSkillsRoutes.ts` | 7 |
| `(paths in file)` | overheadRoutes | `server/overheadRoutes.ts` | 9 |
| `(paths in file)` | modifierRoutes | `server/modifierRoutes.ts` | 10 |

### Takeoff / plans / BIM — 21 mounts, 230 endpoints

| Mount prefix | Router | Source file | Endpoints |
|---|---|---|---|
| `/api/projects` | drawingSetRoutes | `server/drawingSetRoutes.ts` | 13 |
| `/api` | planPinsRoutes | `server/planPinsRoutes.ts` | 5 |
| `(paths in file)` | planDocumentMarkupRoutes | `server/planDocumentMarkupRoutes.ts` | 24 |
| `(paths in file)` | takeoffRecentsRoutes | `server/takeoffRecentsRoutes.ts` | 7 |
| `(paths in file)` | takeoffStylusTelemetryRoutes | `server/takeoffStylusTelemetryRoutes.ts` | 2 |
| `(paths in file)` | takeoffSheetRoutes | `server/takeoffSheetRoutes.ts` | 32 |
| `(paths in file)` | standaloneTakeoffRoutes | `server/standaloneTakeoffRoutes.ts` | 25 |
| `(paths in file)` | takeoffSendToEstimateRoutes | `server/takeoffSendToEstimateRoutes.ts` | 1 |
| `(paths in file)` | takeoffIssueRoutes | `server/takeoffIssueRoutes.ts` | 6 |
| `(paths in file)` | takeoffMeasurementRoutes | `server/takeoffMeasurementRoutes.ts` | 31 |
| `(paths in file)` | takeoffPaginationRoutes | `server/takeoffPaginationRoutes.ts` | 2 |
| `(paths in file)` | takeoffFieldSyncRoutes | `server/takeoffFieldSyncRoutes.ts` | 1 |
| `(paths in file)` | takeoffCategoryRoutes | `server/takeoffCategoryRoutes.ts` | 30 |
| `(paths in file)` | takeoffCrossModuleRoutes | `server/takeoffCrossModuleRoutes.ts` | 6 |
| `(paths in file)` | takeoffToolChestRoutes | `server/takeoffToolChestRoutes.ts` | 5 |
| `(paths in file)` | takeoffSheetSetRoutes | `server/takeoffSheetSetRoutes.ts` | 11 |
| `(paths in file)` | takeoffCalibrationZoneRoutes | `server/takeoffCalibrationZoneRoutes.ts` | 4 |
| `(paths in file)` | bimRoutes | `server/bimRoutes.ts` | 8 |
| `(paths in file)` | lidarRoutes | `server/lidarRoutes.ts` | 12 |
| `(paths in file)` | takeoffScopeRoutes | `server/takeoffScopeRoutes.ts` | 4 |
| `(paths in file)` | planSetIngestRoutes | `server/planSetIngestRoutes.ts` | 1 |

### Projects / schedule / field ops — 30 mounts, 412 endpoints

| Mount prefix | Router | Source file | Endpoints |
|---|---|---|---|
| `/api` | delayRoutes | `server/delayRoutes.ts` | 34 |
| `/api/field-productivity` | fieldProductivityRoutes | `server/fieldProductivityRoutes.ts` | 20 |
| `/api` | inspectionRoutes | `server/inspectionRoutes.ts` | 11 |
| `/api` | permitRoutes | `server/permitRoutes.ts` | 7 |
| `/api` | punchListRoutes | `server/punchListRoutes.ts` | 10 |
| `/api` | materialTestRoutes | `server/materialTestRoutes.ts` | 6 |
| `/api` | projectDistributionListRoutes | `server/projectDistributionListRoutes.ts` | 3 |
| `/api` | projectLogEmailScheduleRoutes | `server/projectLogEmailScheduleRoutes.ts` | 11 |
| `/api` | scheduleRoutes | `server/scheduleRoutes.ts` | 39 |
| `/api` | notesRoutes | `server/notesRoutes.ts` | 6 |
| `/api` | projectNotePagesRoutes | `server/projectNotePagesRoutes.ts` | 9 |
| `(paths in file)` | taskRoutes | `server/taskRoutes.ts` | 18 |
| `/api` | organizationDocumentRoutes | `server/organizationDocumentRoutes.ts` | 9 |
| `/api` | rfiRoutes | `server/rfiRoutes.ts` | 23 |
| `/api` | transmittalRoutes | `server/transmittalRoutes.ts` | 13 |
| `/api` | submittalRoutes | `server/submittalRoutes.ts` | 33 |
| `/api/weather` | weatherRoutes | `server/weatherRoutes.ts` | 4 |
| `/api/approvals` | approvalRoutes | `server/approvalRoutes.ts` | 5 |
| `/api/workflows` | workflowRoutes | `server/workflowRoutes.ts` | 11 |
| `/api/documents` | documentRevisionRoutes | `server/documentRevisionRoutes.ts` | 6 |
| `/api` | riskRoutes | `server/riskRoutes.ts` | 8 |
| `(paths in file)` | mobilizationRoutes | `server/mobilizationRoutes.ts` | 12 |
| `(paths in file)` | projectReportRoutes | `server/projectReportRoutes.ts` | 7 |
| `(paths in file)` | projectCrudRoutes | `server/projectCrudRoutes.ts` | 17 |
| `(paths in file)` | projectContentRoutes | `server/projectContentRoutes.ts` | 11 |
| `(paths in file)` | portfolioRoutes | `server/portfolioRoutes.ts` | 18 |
| `(paths in file)` | materialTrackingRoutes | `server/materialTrackingRoutes.ts` | 6 |
| `(paths in file)` | projectOpsRoutes | `server/projectOpsRoutes.ts` | 33 |
| `(paths in file)` | projectTemplateRoutes | `server/projectTemplateRoutes.ts` | 8 |
| `(paths in file)` | mobileSyncRoutes | `server/mobileSyncRoutes.ts` | 14 |

### Field time / payroll / workforce / HR — 15 mounts, 257 endpoints

| Mount prefix | Router | Source file | Endpoints |
|---|---|---|---|
| `(paths in file)` | timeClockRoutes | `server/timeClockRoutes.ts` | 27 |
| `(paths in file)` | overtimeRoutes | `server/overtimeRoutes.ts` | 12 |
| `(paths in file)` | timeEntryRoutes | `server/timeEntryRoutes.ts` | 8 |
| `(paths in file)` | payrollRoutes | `server/payrollRoutes.ts` | 47 |
| `/api` | ppeComplianceRoutes | `server/ppeComplianceRoutes.ts` | 5 |
| `(paths in file)` | safetyTrainingRoutes | `server/safetyTrainingRoutes.ts` | 10 |
| `(paths in file)` | safetyWorkflowRoutes | `server/safetyWorkflowRoutes.ts` | 26 |
| `(paths in file)` | safetyObservationsRoutes | `server/safetyObservationsRoutes.ts` | 6 |
| `(paths in file)` | safetyKpiRoutes | `server/safetyKpiRoutes.ts` | 1 |
| `/api/hiring` | hiringRoutes | `server/hiringRoutes.ts` | 49 |
| `/api/talent-pool` | talentPoolRoutes | `server/talentPoolRoutes.ts` | 17 |
| `(paths in file)` | leaveRoutes | `server/leaveRoutes.ts` | 12 |
| `(paths in file)` | workforceRoutes | `server/workforceRoutes.ts` | 18 |
| `(paths in file)` | crewRoutes2 | `server/crewRoutes2.ts` | 13 |
| `(registers on app)` | registerPeerRatingRoutes | `server/peerRatingRoutes.ts` | 6 |

### Equipment / inventory / assets — 3 mounts, 101 endpoints

| Mount prefix | Router | Source file | Endpoints |
|---|---|---|---|
| `/api` | assetManagementRoutes | `server/assetManagementRoutes.ts` | 17 |
| `(paths in file)` | equipmentRoutes | `server/equipmentRoutes.ts` | 62 |
| `(paths in file)` | inventoryRoutes | `server/inventoryRoutes.ts` | 22 |

### Procurement / subcontracts / vendors / marketplace — 6 mounts, 181 endpoints

| Mount prefix | Router | Source file | Endpoints |
|---|---|---|---|
| `/api/marketplace` | marketplaceRoutes | `server/marketplaceRoutes.ts` | 42 |
| `/api` | subcontractRoutes | `server/subcontractRoutes.ts` | 9 |
| `/api` | subcontractorPayablesRoutes | `server/subcontractorPayablesRoutes.ts` | 9 |
| `/api` | subcontractManagementRoutes | `server/subcontractManagementRoutes.ts` | 22 |
| `(paths in file)` | procurementModuleRoutes | `server/procurementModuleRoutes.ts` | 32 |
| `(paths in file)` | vendorRoutes | `server/vendorRoutes.ts` | 67 |

### Finance / AIA / SOV / T&M / cost — 11 mounts, 133 endpoints

| Mount prefix | Router | Source file | Endpoints |
|---|---|---|---|
| `/api` | sovRoutes | `server/sovRoutes.ts` | 18 |
| `/api/aia-billing` | aiaBillingRoutes | `server/aiaBillingRoutes.ts` | 21 |
| `/api/kpis` | kpiRoutes | `server/kpiRoutes.ts` | 14 |
| `(paths in file)` | profitabilityAlertRoutes | `server/profitabilityAlertRoutes.ts` | 2 |
| `(paths in file)` | costLedgerRoutes | `server/costLedgerRoutes.ts` | 11 |
| `(paths in file)` | revenueRecognitionRoutes | `server/revenueRecognitionRoutes.ts` | 7 |
| `(paths in file)` | costEngineRoutes | `server/costEngineRoutes.ts` | 5 |
| `(paths in file)` | executiveDigestRoutes | `server/executiveDigestRoutes.ts` | 2 |
| `(paths in file)` | projectFinancialRoutes | `server/projectFinancialRoutes.ts` | 19 |
| `(paths in file)` | reportRoutes | `server/reportRoutes.ts` | 11 |
| `(registers on app)` | registerTMTicketRoutes | `server/tmRoutes.ts` | 23 |

### Change orders — 3 mounts, 26 endpoints

| Mount prefix | Router | Source file | Endpoints |
|---|---|---|---|
| `/api/change-orders` | changeOrderCrudRoutes | `server/changeOrderCrudRoutes.ts` | 10 |
| `/api/change-orders` | changeOrderApprovalRoutes | `server/changeOrderApprovalRoutes.ts` | 10 |
| `/api/change-orders` | changeOrderExportRoutes | `server/changeOrderExportRoutes.ts` | 6 |

### Closeout / warranty — 2 mounts, 27 endpoints

| Mount prefix | Router | Source file | Endpoints |
|---|---|---|---|
| `/api` | warrantyRoutes | `server/warrantyRoutes.ts` | 13 |
| `(paths in file)` | closeoutRoutes | `server/closeoutRoutes.ts` | 14 |

### Compliance / COI / contracts — 4 mounts, 50 endpoints

| Mount prefix | Router | Source file | Endpoints |
|---|---|---|---|
| `/api/compliance` | complianceRoutes | `server/complianceRoutes.ts` | 2 |
| `/api/coi` | coiRoutes | `server/coiRoutes.ts` | 13 |
| `(paths in file)` | contractRoutes | `server/contractRoutes.ts` | 25 |
| `(paths in file)` | clauseLibraryRoutes | `server/clauseLibraryRoutes.ts` | 10 |

### DOT / heavy civil — 2 mounts, 79 endpoints

| Mount prefix | Router | Source file | Endpoints |
|---|---|---|---|
| `(paths in file)` | dotRoutes | `server/dotRoutes.ts` | 77 |
| `(paths in file)` | dotPayItemPickerFacetsRoutes | `server/dotPayItemPickerFacetsRoutes.ts` | 2 |

### AI (orchestration, BYOK) — 8 mounts, 205 endpoints

| Mount prefix | Router | Source file | Endpoints |
|---|---|---|---|
| `(paths in file)` | byokRoutes | `server/byokRoutes.ts` | 3 |
| `/api` | aiOrchestrationRoutes | `server/aiOrchestrationRoutes.ts` | 12 |
| `(via aiOrchestrationRoutes, /api)` | aiDocumentRoutes | `server/aiDocumentRoutes.ts` | 58 |
| `(via aiOrchestrationRoutes, /api)` | aiSchedulingRoutes | `server/aiSchedulingRoutes.ts` | 15 |
| `(via aiOrchestrationRoutes, /api)` | aiTakeoffFeatureRoutes | `server/aiTakeoffFeatureRoutes.ts` | 14 |
| `(via aiOrchestrationRoutes, /api)` | aiCfoAnalyticsRoutes | `server/aiCfoAnalyticsRoutes.ts` | 17 |
| `(via aiOrchestrationRoutes, /api)` | aiHeavyCivilFeatureRoutes | `server/aiHeavyCivilFeatureRoutes.ts` | 8 |
| `(via aiOrchestrationRoutes, /api)` | aiEstimatorRoutes | `server/aiEstimatorRoutes.ts` | 78 |

### Portal (client/sub/vendor) — 6 mounts, 76 endpoints

| Mount prefix | Router | Source file | Endpoints |
|---|---|---|---|
| `/api` | portalRoutes | `server/portalRoutes.ts` | 27 |
| `/api` | unifiedPortalRoutes | `server/unifiedPortalRoutes.ts` | 3 |
| `/api` | subChatRoutes | `server/subChatRoutes.ts` | 6 |
| `/api` | clientChatRoutes | `server/clientChatRoutes.ts` | 6 |
| `/api` | portalNotificationRoutes | `server/portalNotificationRoutes.ts` | 19 |
| `/api/ai-features` | clientPortalRoutes | `server/clientPortalRoutes.ts` | 15 |

### Messaging / notifications / email — 5 mounts, 94 endpoints

| Mount prefix | Router | Source file | Endpoints |
|---|---|---|---|
| `/api/email` | emailRoutes | `server/emailRoutes.ts` | 31 |
| `(paths in file)` | notificationRoutes2 | `server/notificationRoutes2.ts` | 4 |
| `(paths in file)` | notificationPreferencesRoutes | `server/notificationPreferencesRoutes.ts` | 10 |
| `(paths in file)` | pushSubscriptionRoutes | `server/pushSubscriptionRoutes.ts` | 3 |
| `(paths in file)` | messagingRoutes | `server/messagingRoutes.ts` | 46 |

### Website builder — 2 mounts, 77 endpoints

| Mount prefix | Router | Source file | Endpoints |
|---|---|---|---|
| `/api/website` | websiteRoutes | `server/websiteRoutes.ts` | 69 |
| `/api/website` | websiteAiRoutes | `server/websiteAiRoutes.ts` | 8 |

## 3. Scheduled jobs, queue workers, webhooks, import/export

### 3a. Gating
Schedulers run only when `NODE_ENV=production` or `ENABLE_SCHEDULERS=true` (server/index.ts ~L703). In dev they are OFF by default. Only a one-off status-probe sweep runs in dev.

### 3b. node-cron jobs — `server/jobs/jobRunner.ts` `startJobRunner()` (6-field cron with seconds unless noted; all wrapped by `scheduleCron` with missed-tick metrics)

| Job | Cron |
|---|---|
| job_metrics_prune | `0 0 * * * *` |
| job_metric_alerts | `10 */15 * * * *` |
| job_metric_quiet_digest | `20 */15 * * * *` |
| rate_limit_counter_prune | `10 0 * * * *` |
| pool_health | `0 * * * * *` |
| outbox | `0 */2 * * * *` |
| retention_policy_sweep | `0 0 2 * * *` |
| sync_schedules | `0 */15 * * * *` |
| social_posts | `15 */2 * * * *` |
| social_token_expiry_check | `0 0 3 * * *` |
| compliance_expiration_check | `0 0 7 * * *` |
| portal_access_expiry_sweep | `0 30 2 * * *` |
| coi_reminder_cycle | `20 0 8 * * *` |
| profitability | `30 */15 * * * *` |
| portfolio_kpi_snapshot | `0 15 2 * * *` |
| idle_opportunity_check | `0 0 8 * * *` |
| idle_hiring_candidates | `0 0 8 * * *` |
| orphan_uploads | `0 */30 * * * *` |
| org_hard_delete_sweep | `0 17 * * * *` |
| bid_due_date | `20 0 * * * *` |
| imap_sync | `40 */15 * * * *` |
| provider_sync | `0 */5 * * * *` |
| provider_push_drain | `30 */2 * * * *` |
| email_push_renewal | `50 */15 * * * *` |
| periodic_report_weekly | `0 0 7 * * 1` |
| periodic_report_monthly | `0 0 7 1 * *` |
| db_health_check | `0 0 */6 * * *` |
| social_engagement | `0 0 */4 * * *` |
| scheduled_campaigns | `45 */2 * * * *` |
| sequence_cadences | `55 */2 * * * *` |
| project_geocode | `0 30 4 * * *` |
| crm_sla_breaches | `20 */5 * * * *` |
| crm_idle_automations | `0 */10 * * * *` |
| crm_birthday_digest | `30 0 * * * *` |
| certified_payroll_digest | `45 0 * * * *` |
| project_log_email_schedules | `0 1 * * * *` |
| project_log_email_failures_digest | `30 1 * * * *` |
| swppp_overdue_corrective_actions | `20 0 7 * * *` |
| rfi_overdue_notifications | `40 0 7 * * *` |
| submittal_overdue_notifications | `0 1 7 * * *` |
| certified_payroll_purge | `20 30 3 * * *` |
| crm_birthday_daily_digest | `20 1 7 * * *` |
| integration_sync_retry | `40 */5 * * * *` |
| wage_decision_stale_refresh | `0 0 6 * * *` |
| suppression_reset_prune | `0 45 3 * * *` |
| project_log_email_attempt_prune | `0 0 4 * * *` |
| plan_document_markup_trash_purge | `0 15 4 * * *` |
| takeoff_recents_orphan_prune | `0 45 4 * * *` |
| dot_pay_items_refresh | `40 0 4 1 1,4,7,10 *` |
| wage_decision_missing_reminder | `40 0 8 * * *` |
| ai_takeoff_calibration | `0 30 3 * * *` |
| ai_estimator_ingestion | `0 45 2 * * *` |
| ai_takeoff_calibration_aggregator | `20 0 4 * * *` |
| equipment_pm_generation | `40 30 3 * * *` |
| pm_duplicate_audit | `30 17 * * * *` |
| ai_takeoff_stall_watchdog | `30 * * * * *` |
| stuck_job_watchdog | `*/5 * * * *` |
| change_order_overdue_notifications | `0 30 7 * * *` |
| workflow_sla_breach_sweep | `0 0 7 * * *` |
| daily_executive_digest | `0 30 6 * * *` |
| retainage_collection_reminder | `0 0 8 * * 1` |
| unbilled_change_order_reminder | `0 0 8 * * 2` |
| lien_waiver_reminder | `0 0 8 * * 3` |
| admin_notification_prefs_backfill | `0 30 3 * * *` |

### 3c. Other schedulers and workers started at boot (server/index.ts)
| Scheduler | File | Schedule |
|---|---|---|
| AI scheduler (daily AI runs) | server/ai/scheduler.ts | daily at org-settings `dailyRunTime` |
| AI dunning | server/ai/scheduler.ts | `0 9 * * *` |
| DBE risk | server/ai/scheduler.ts | `0 6 * * *` (orgs with DBE_TRACKING) |
| Weekly AI alerts | server/ai/scheduler.ts | `0 8 * * 1` |
| AI Notes scheduler | server/aiNotesScheduler.ts | hourly `0 * * * *` + daily `0 18 * * *` |
| Storage orphan scan | server/storageOrphanScanJob.ts | `0 2 * * *` (also POST /api/admin/storage/orphan-scan) |
| CRM task reminders | server/crmTaskReminderScheduler.ts | `0 * * * *` |
| CRM backfill alert digest | server/crmBackfillAlertDigestScheduler.ts | `0 7 * * *` |
| CRM CSV import worker | server/crmCsvImportWorker.ts | setInterval poll (POLL_INTERVAL_MS) + stale recovery |
| Status probe | server/statusProbeScheduler.ts | every minute |
| Support weekly report | server/supportWeeklyReport.ts | `0 13 * * 1` UTC |
| Always on (not gated): portfolio PDF health monitor | server/portfolio-pdf-alerts.ts | setInterval |
| Always on (not gated): contact reassignment sweeper | server/services/notificationService.ts | setInterval |

One-shot admin jobs (`server/utils/oneShotJobRegistry.ts`; UI at `/admin/one-shot-jobs`): restore-audit backfill, certified-payroll PDF backfill, scale-calibration backfill, exhausted-sync-retry alerts backfill.

### 3d. pg-boss job queue (docs/architecture/job-queue.md; server/jobQueue/)
Queues: `ai_takeoff_analyze`, `ai_document_analyze`, `ai_estimator_draft`, `pdf_tile_prerender` (dispatched only when TILE_RENDERING_ENABLED), `accounting_sync`, `bulk_export` (generators: audit export, change-order bulk PDF, payroll acknowledgement, organization export), `plan_set_ingest`.

Contract to test:
- idempotencyKey/singletonKey de-dupe
- `retryLimit=5`, backoff, 10s delay
- failures → DLQ visible at `/admin/job-queue` with retry/archive
- per-tenant semaphore (teamSize/teamConcurrency 8)
- handler runs inside `withOrgContext` (RLS)
- `recordJobMetrics("queue:<name>")`

Worker topology: `server/worker.ts` is the dedicated worker. `JOB_WORKER_INPROCESS`: unset means in-process workers in dev and enqueue-only in prod; `1` forces in-process.

### 3e. Inbound webhooks
| Endpoint | Provider | Verification | Missing-config behavior |
|---|---|---|---|
| POST /api/stripe/webhook | Stripe | `stripe-signature` over raw body (`STRIPE_WEBHOOK_SECRET`); CSRF-exempt | 503 if `STRIPE_SECRET_KEY` unset; 400 if raw body missing or signature bad; 500 if handler fails |
| POST /api/webhooks/email/gmail | Gmail Pub/Sub | Pub/Sub JWT (`GMAIL_PUBSUB_AUDIENCE`/`GMAIL_PUBSUB_SERVICE_ACCOUNT`) or shared `EMAIL_WEBHOOK_SECRET` | 401; 204 on malformed body |
| POST /api/webhooks/email/outlook | MS Graph | subscription clientState / shared secret | 401 |
| POST /api/webhooks/email/sendgrid | SendGrid events | **NONE — stub (TODO: verify `SENDGRID_WEBHOOK_SIGNING_KEY`)** | always 202, events not processed |
| POST /api/webhooks/email/resend | Resend (legacy) | Svix `RESEND_WEBHOOK_SIGNING_SECRET`, else `?token=` `RESEND_WEBHOOK_SECRET`/`EMAIL_WEBHOOK_SECRET` | 401 |
| POST /api/crm/calls/twilio/webhook | Twilio call status | `X-Twilio-Signature` via `twilio.validateRequest` (mandatory) | 503 if `TWILIO_AUTH_TOKEN` unset; bypassed when `TWILIO_WEBHOOK_SKIP_VERIFY=1` |
| POST /api/sso/:orgSlug/callback | SAML IdP | SAML assertion | plan gate SSO |

The boot audit `server/webhookSecretsAudit.ts` logs WARN or ERROR for each missing secret.

**Suspected defect (needs runtime check):** `validateCsrf` (server/csrf.ts) requires a matching `x-csrf-token` header and cookie on every non-GET request. Its exemptions are `/api/stripe/webhook`, `/api/webhooks/*`, `/api/public/*`, `/api/v1/public/*` and a few auth prefixes. `/api/crm/calls/twilio/webhook` and `/api/sso/:orgSlug/callback` are **not** exempt. Twilio callbacks and IdP form POSTs would therefore get 403 "Invalid or missing CSRF token" before signature verification runs.

Outbound webhook features to test:
- public-API webhook subscriptions (`/api/v1/public/webhooks`, `/api/integrations/dev-portal/webhooks`)
- Zapier webhooks (`/api/integrations/zapier/webhooks[/:id/test]`)
- generic `/api/integrations/webhooks/{subscribe,test}`
- Slack/Teams notification webhooks (crmCallsRoutes, notificationPreferences)

### 3f. Import / export / PDF endpoints (path contains import|export|csv|xlsx|download|pdf|bulk|backup|xml|g702/g703|wh347)
- `server/aiDocumentRoutes.ts` (1): `GET /ai-contract-document/download/:id`
- `server/aiEstimatorRoutes.ts` (2): `GET ${estimatorBase}/admin/learned-rates/export.csv`; `GET ${estimatorBase}/admin/learned-rates/:id/samples/export.csv`
- `server/aiTakeoffFeatureRoutes.ts` (1): `POST /ai-features/takeoff/suggestions/bulk-accept`
- `server/aiaBillingRoutes.ts` (3): `GET /pay-applications/:id/g702-pdf`; `GET /pay-applications/:id/g703-pdf`; `POST /billing-integration/import-tm-tickets`
- `server/assetManagementRoutes.ts` (1): `GET /projects/:code/handover/export`
- `server/auditExportRoutes.ts` (1): `GET /export`
- `server/bidRoutes.ts` (3): `GET /api/bids/:code/pdf/internal-summary`; `GET /api/bids/:code/pdf/customer-quote`; `GET /api/bids/:code/pdf/warranty-contract`
- `server/bimRoutes.ts` (2): `POST /api/bids/:id/bim-extractions/import`; `POST /api/projects/:id/bim-extractions/import`
- `server/changeOrderExportRoutes.ts` (3): `POST /bulk-submit`; `GET /:id/pdf`; `GET /project/:projectId/bulk-pdf`
- `server/clientPortalRoutes.ts` (1): `GET /client-portal/public/change-orders/:coId/attachments/:attachmentId/download`
- `server/closeoutRoutes.ts` (3): `POST /api/projects/:code/closeout/export`; `GET /api/projects/:code/closeout/packages/:pkgId/download`; `GET /api/projects/:code/closeout/export/pdf`
- `server/coiRoutes.ts` (2): `GET /dashboard.csv`; `POST /reminders/bulk`
- `server/crmCallsRoutes.ts` (4): `PATCH /api/crm/calls/bulk`; `GET /api/crm/calls/transcripts/backfill/test-alert/history.csv`; `GET /api/crm/calls/transcripts/backfill/alert-failures-digest.csv`; `GET /api/crm/calls/transcripts/backfill/history.csv`
- `server/crmCsvImportRoutes.ts` (7): `GET /api/crm/csv-imports/fields`; `GET /api/crm/csv-imports`; `GET /api/crm/csv-imports/:id/errors.csv`; `POST /api/crm/csv-imports`; `POST /api/crm/csv-imports/:id/revert`; `GET /api/crm/csv-imports/:id/error-rows.csv`; `POST /api/crm/csv-imports/:id/retry`
- `server/crmQuotesRoutes.ts` (1): `GET /api/crm/quotes/:id/pdf`
- `server/crmRoutes.ts` (3): `POST /api/crm/organisations/bulk-reassign-owner`; `POST /api/crm/contacts/bulk-reassign-owner`; `POST /api/crm/opportunities/bulk-reassign`
- `server/delayRoutes.ts` (1): `GET /delays/:delayId/notifications/:notificationId/pdf`
- `server/devSeedEnterprise.ts` (2): `POST /seed-my-work-bulk`; `POST /clear-my-work-bulk`
- `server/dotRoutes.ts` (3): `POST /api/dot/pay-items/bulk-upload`; `GET /api/dot/progress-estimates/:payApplicationId/pdf`; `GET /api/projects/:projectId/heavy-civil-summary/pdf`
- `server/drawingSetRoutes.ts` (1): `POST /drawing-sets/:setId/items/bulk`
- `server/emailRoutes.ts` (1): `PATCH /threads/bulk`
- `server/equipmentRoutes.ts` (1): `POST /api/equipment/import`
- `server/estimatePricingRoutes.ts` (3): `GET /api/estimates/:estimateId/leveling-sheets/:sheetId/export.xlsx`; `GET /api/estimates/:estimateId/export/proposal-pdf`; `GET /api/estimates/:estimateId/export/sov-g703.xlsx`
- `server/estimateRoutes.ts` (5): `POST /api/projects/:projectId/estimate/import-takeoff`; `POST /api/bids/:bidId/estimate/import-takeoff`; `POST /api/estimates/:estimateId/line-items/bulk`; `GET /api/estimates/:estimateId/export/pdf`; `GET /api/estimates/:estimateId/export/excel`
- `server/featureFlagRoutes.ts` (1): `GET /:orgId/preset-history.csv`
- `server/hustlerRoutes.ts` (1): `GET /hustler/portfolio/export`
- `server/incidentReviewRoutes.ts` (1): `GET /api/platform-support/incident-reviews/:id/attachments/:aid/download`
- `server/inspectionRoutes.ts` (2): `POST /inspections/:id/generate-pdf`; `GET /inspections/:id/pdf`
- `server/integrationRoutes.ts` (5): `POST /import`; `GET /export`; `POST /sage/export-customers`; `POST /sage/export-invoice/:invoiceId`; `POST /sage/import-payments`
- `server/jobMetricAlertEventsRoutes.ts` (1): `GET /admin/metrics/jobs/alerts/events.csv`
- `server/laborRateRoutes.ts` (2): `POST /prevailing-wage-rates/import-preview`; `POST /prevailing-wage-rates/import`
- `server/libraryRoutes.ts` (6): `PATCH /api/library-items/bulk`; `DELETE /api/library-items/bulk`; `POST /api/library-items/bulk-duplicate`; `POST /api/library-items/import`; `DELETE /api/library-assemblies/bulk`; `POST /api/library-assemblies/bulk-duplicate`
- `server/notificationPreferencesRoutes.ts` (1): `GET /api/notifications/digest-csv-sample`
- `server/orgLifecycleRoutes.ts` (8): `GET /api/org/imports/templates`; `GET /api/org/imports/templates/:entityType.csv`; `GET /api/org/imports/:jobId/errors.csv`; `GET /api/org/imports`; `POST /api/org/imports`; `GET /api/org/exports`; `POST /api/org/exports`; `GET /api/org/exports/:id`
- `server/organizationDocumentRoutes.ts` (1): `GET /api/organization-documents/:id/download`
- `server/payrollRoutes.ts` (4): `GET /api/payroll/wage-decisions/:decisionNumber/acknowledgement-export`; `GET /api/payroll/acknowledgement-export`; `GET /api/payroll/pay-runs/:id/certified-payroll-pdf`; `GET /api/payroll/certified-reports/:id/download-url`
- `server/planDocumentMarkupRoutes.ts` (4): `PATCH /api/plan-documents/:docId/markups/bulk`; `DELETE /api/plan-documents/:docId/markups/bulk`; `POST /api/plan-documents/:docId/markups/restore-bulk`; `GET /api/plan-documents/:docId/export.pdf`
- `server/platformRoutes.ts` (2): `POST /platform/organizations/:orgId/export-async`; `GET /platform/organizations/:orgId/export`
- `server/portfolioRoutes.ts` (13): `GET /api/portfolio/summary-pdf`; `GET /api/admin/portfolio-pdf/health`; `GET /api/admin/portfolio-pdf/history`; `GET /api/admin/portfolio-pdf/alerts`; `PUT /api/admin/portfolio-pdf/alerts`; `POST /api/admin/portfolio-pdf/alerts/evaluate`; `GET /api/admin/portfolio-pdf/alert-recipients`; `POST /api/admin/portfolio-pdf/alert-recipients`; `PATCH /api/admin/portfolio-pdf/alert-recipients/:id`; `POST /api/admin/portfolio-pdf/alert-recipients/test`; `DELETE /api/admin/portfolio-pdf/alert-recipients/:id`; `GET /api/admin/portfolio-pdf/alert-deliveries`; `DELETE /api/admin/portfolio-pdf/alert-deliveries`
- `server/procurementModuleRoutes.ts` (1): `POST /api/procurement-module/orders/bulk-approve`
- `server/projectCrudRoutes.ts` (1): `POST /api/projects/bulk-reassign-owner`
- `server/projectOpsRoutes.ts` (2): `GET /api/documents/:documentId/download-url`; `POST /api/projects/:code/vault/export-pdf`
- `server/projectReportRoutes.ts` (1): `GET /api/projects/:id/progress-reports/:reportId/pdf`
- `server/punchListRoutes.ts` (1): `GET /projects/:code/punch-list/export/pdf`
- `server/reportRoutes.ts` (2): `GET /api/reports/export/csv`; `GET /api/reports/export/pdf`
- `server/revenueRecognitionRoutes.ts` (2): `GET /api/revenue-recognition/wip-report/csv`; `GET /api/revenue-recognition/wip-report/pdf`
- `server/rfiRoutes.ts` (1): `GET /projects/:projectId/rfis/log.pdf`
- `server/safetyTrainingRoutes.ts` (1): `GET /api/safety-training/export/pdf`
- `server/safetyWorkflowRoutes.ts` (1): `GET /api/osha-incidents/300a-pdf`
- `server/scheduleRoutes.ts` (16): `POST /projects/:code/schedule/export-pdf`; `GET /admin/gantt-pdf/health`; `POST /admin/gantt-pdf/recycle`; `GET /admin/gantt-pdf/history`; `GET /admin/gantt-pdf/alerts`; `PUT /admin/gantt-pdf/alerts`; `POST /admin/gantt-pdf/alerts/evaluate`; `GET /admin/gantt-pdf/alert-recipients`; `POST /admin/gantt-pdf/alert-recipients`; `PATCH /admin/gantt-pdf/alert-recipients/:id`; `POST /admin/gantt-pdf/alert-recipients/test`; `DELETE /admin/gantt-pdf/alert-recipients/:id`; `GET /admin/gantt-pdf/alert-deliveries`; `DELETE /admin/gantt-pdf/alert-deliveries`; `POST /projects/:code/schedule/import`; `GET /projects/:code/schedule/export`
- `server/socialRoutes.ts` (1): `POST /posts/bulk`
- `server/sovRoutes.ts` (1): `GET /sov/:id/pdf`
- `server/standaloneTakeoffRoutes.ts` (1): `POST /api/takeoff/standalone/:id/import-plan`
- `server/statusPageRoutes.ts` (1): `POST /api/admin/status/subscribers/bulk-delete`
- `server/subcontractManagementRoutes.ts` (1): `GET /subcontracts/:contractId/pay-applications/:payAppId/pdf`
- `server/subcontractRoutes.ts` (1): `GET /subcontracts/:id/pdf`
- `server/submittalRoutes.ts` (2): `GET /submittals/:id/attachments/:attachmentId/download`; `GET /projects/:projectId/submittals/log.pdf`
- `server/supportAttachmentRoutes.ts` (1): `GET /api/support/attachments/download`
- `server/supportRoutes.ts` (1): `GET /api/support/analytics/export`
- `server/takeoffCategoryRoutes.ts` (5): `PATCH /api/takeoff/markups/bulk`; `DELETE /api/takeoff/markups/bulk`; `POST /api/takeoff/markups/restore-bulk`; `GET /api/takeoff/conditions/export-csv`; `POST /api/takeoff/conditions/import-csv`
- `server/takeoffMeasurementRoutes.ts` (3): `PATCH /api/takeoff/measurements/bulk`; `POST /api/takeoff/measurements/bulk-unlock-rescale`; `POST /api/takeoff/measurements/:id/auto-import`
- `server/takeoffScopeRoutes.ts` (1): `POST /api/takeoff/measurements/bulk-scope`
- `server/takeoffSheetRoutes.ts` (4): `POST /api/bids/:bidId/takeoff/import-plan`; `GET /api/takeoff/sheets/:sheetId/pdf-url`; `GET /api/takeoff/sheets/:sheetId/pdf`; `POST /api/projects/:projectId/takeoff/import-plan`
- `server/timeEntryRoutes.ts` (2): `POST /api/time-entries/bulk-approve`; `GET /api/time-entries/export`
- `server/tmRoutes.ts` (1): `GET /api/tm-tickets/:ticketId/pdf`
- `server/userSettingsRoutes.ts` (1): `GET /api/account/export`
- `server/vendorRoutes.ts` (18): `GET /api/vendor/pricing/csv-template`; `POST /api/vendor/pricing/bulk`; `GET /api/vendor/pricing/export`; `GET /api/vendor/rental-pricing/csv-template`; `POST /api/vendor/rental-pricing/bulk`; `GET /api/vendor/rental-pricing/export`; `GET /api/vendor/service-pricing/csv-template`; `POST /api/vendor/service-pricing/bulk`; `GET /api/vendor/service-pricing/export`; `GET /pricebook-imports`; `GET /pricebook-imports/:jobId`; `POST /pricebook-imports`; `POST /pricebook-imports/:jobId/process`; `POST /pricebook-imports/:jobId/items/:itemId/approve`; `POST /pricebook-imports/:jobId/items/:itemId/reject`; `POST /pricebook-imports/:jobId/approve-all`; `POST /api/crm/organisations/:id/pricing/bulk-import`; `POST /api/vendor-pricing/bulk-import`
- `server/warrantyRoutes.ts` (1): `GET /projects/:code/warranty/export`
- `server/websiteRoutes.ts` (1): `GET /public/:subdomain/sitemap.xml`

Total: 183 endpoints in 69 files

## 4. Integrations: env vars and behavior when unset

| Integration | Enabling env vars | Behavior when unset (from code) |
|---|---|---|
| Stripe billing | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_{FREE,STARTER,GROWTH,SCALE}` | `isStripeConfigured()` returns false and `getStripe()` throws "Stripe is not configured". Webhook returns 503. Metered usage reporting is skipped. With `BILLING_MODE=manual` or non-prod, plan features are toggled from the Billing page instead. |
| SendGrid email | `SENDGRID_API_KEY`, `EMAIL_FROM_ADDRESS` | No API key is set, so SendGrid sends fail; failures are logged and retried twice on transient errors. `EMAIL_TRANSPORT=noop` captures mail to an in-memory outbox for tests and e2e (`/admin/email-outbox`). |
| Resend (legacy) | `RESEND_WEBHOOK_*` | Webhook only. |
| Twilio (calls/SMS) | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`. Flags: TWILIO_INTEGRATION, SMS_NOTIFICATIONS (default OFF) | Click-to-call and recording endpoints return 503 "Twilio is not configured." `smsService` logs WARN and skips the SMS. Webhook returns 503. Call transcription is skipped. |
| LiveKit video | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`. Flag: VIDEO_CALLS (OFF) | Returns 503 `LIVEKIT_NOT_CONFIGURED` (messagingRoutes ~L2748, ~L3098). |
| Anthropic Claude | `ANTHROPIC_API_KEY`. Flags: AI_PROVIDER_TAKEOFF, AI_PROVIDER_GENERAL (default **ON**). Per-org BYOK via BYOK_AI_KEYS | If the flag is on but the key is missing, routing source becomes `anthropic-not-configured` and the call goes to OpenAI with no fallback; a BYOK Anthropic key restores Anthropic routing. |
| OpenAI | `AI_INTEGRATIONS_OPENAI_API_KEY` (Replit proxy, with `AI_INTEGRATIONS_OPENAI_BASE_URL`) or `OPENAI_API_KEY` | `isConfigured()` returns false. Embeddings throw "Embedding provider not configured". AI routes map provider failures and timeouts to 503 `ai_unavailable` / `ai_timeout` (aiOrchestrationRoutes ~L2275). Vision pipelines (jobsite analysis, takeoff images) are OpenAI-only. |
| Object storage (GCS via Replit sidecar) | `DEFAULT_OBJECT_STORAGE_BUCKET_ID`, `PRIVATE_OBJECT_DIR`, `PUBLIC_OBJECT_SEARCH_PATHS` | No mock. The status probe reports storage as unconfigured, and org hard-delete records the failure "PRIVATE_OBJECT_DIR not set". Uploads and downloads error. |
| Upload AV scan | `CLOUDMERSIVE_AV_API_KEY`, `UPLOAD_AV_SCAN_MODE` (permissive default / enforce → 422 / disabled) | Falls back to the built-in EICAR signature scanner. |
| QuickBooks Online | `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_ENVIRONMENT`. Flag: INTEGRATION_QBO; plan add-on `integration_qbo` | No explicit guard: the OAuth URL is built with an empty client_id and fails at Intuit. In non-prod, `POST /api/integrations/connections {devMode:true}` stores simulated tokens (mock connection). Sync runs via the `accounting_sync` queue and the `provider_sync` / `provider_push_drain` / `integration_sync_retry` crons. |
| Sage Intacct | `SAGE_CLIENT_ID`/`SECRET` (OAuth), `SAGE_INTACCT_SENDER_ID`/`PASSWORD` (XML gateway). Flag: INTEGRATION_SAGE | The XML gateway throws "Sage Intacct sender credentials missing". Endpoints: `/api/integrations/sage/export-invoice/:id`, `/sage/payment-statuses/refresh`. |
| DocuSign e-sign | `DOCUSIGN_CLIENT_ID`/`SECRET`/`ACCOUNT_ID`/`BASE_URL`. Flags: INTEGRATION_ESIGN, BID_CONVERSION_AUTO_ESIGN | Same OAuth pattern as QBO (empty client id). |
| Autodesk ACC, Bluebeam, Box, Dropbox, Google Drive, OneDrive, Zapier, StackCT, AASHTOWare, DBE directory, DOL Davis-Bacon, surety verification | `<PROVIDER>_CLIENT_ID`/`SECRET` (server/integrations/providers/*) | Same pattern. A provider's `featureFlag` is returned by `/api/integrations/providers`, but no server-side enforcement was found in integrationRoutes; only an ADMIN/SUPER_ADMIN role check applies. |
| Google / Microsoft OAuth login and mail sync | `GOOGLE_CLIENT_ID`/`SECRET`/`REDIRECT_URI`, `MICROSOFT_CLIENT_ID`/`SECRET`/`TENANT_ID`/`REDIRECT_URI`, `GMAIL_PUBSUB_*` | `oauthRoutes` treats a missing or placeholder `REPLACE_WITH_...` value as disabled (provider hidden, or an error on the start route). |
| Social (LinkedIn/Twitter/…) | `LINKEDIN_CLIENT_*`, `TWITTER_CLIENT_*` | `getIntegrationStatus()` reports false. |
| Web push | `VAPID_PUBLIC_KEY`/`PRIVATE_KEY`/`SUBJECT` | `webpush` is not initialised, so push is skipped. |
| Sentry | `SENTRY_DSN` | No-op. |
| Ops metrics | `OPS_METRICS_TOKEN` | `/metrics` returns 503 "metrics disabled". |

`GET /api/integration-status` (integrationStatusService) reports livekit, twilio, openai, sendgrid and social flags. It is a good smoke assertion for configuration.

## 5. Feature flags and plan gates

Source: `shared/schema/features/flags.ts`. Flags are stored per org in the `organizations.featureFlags` JSON. Defaults come from `server/services/featureFlagService.ts`: every key **not** in `DISABLED_BY_DEFAULT_FLAGS` defaults to ON. Trade presets (`shared/tradeFeaturePresets.ts`) apply bundles, with drift and audit tracking (`feature_flag_preset_applications`). The API is at `/api/feature-flags`.

**Doc/code drift:** the inline comments in flags.ts still say AI_PROVIDER_TAKEOFF and AI_PROVIDER_GENERAL are "Default OFF", but both are absent from DISABLED_BY_DEFAULT_FLAGS (Task #2851), so they default **ON**.

Server-side enforcement:
- `requireOrgFeatureFlag` (dotRoutes, aiHeavyCivilFeatureRoutes): DOT_PAY_ITEMS ×7, DBE_TRACKING ×6, HAUL_TICKETS ×4, DAILY_INSPECTOR_REPORTS ×3, BUY_AMERICA ×2, MASS_HAUL_ANALYZER ×2, SWPPP_INSPECTIONS ×2, SURETY_BONDS ×1, DOT_PROGRESS_ESTIMATE ×1.
- `isFeatureEnabled` checks: DBE_TRACKING, APPROVALS_FRAMEWORK, AI_ESTIMATOR, VIDEO_CALLS, SURETY_BONDS, EXECUTIVE_DIGEST, COI_COMPLIANCE_HOLD, TWILIO_INTEGRATION, TILE_RENDERING_ENABLED, SMS_NOTIFICATIONS, LIDAR_SCANNER, INVENTORY_ADJUSTMENT_APPROVAL, HIRING_MODULE, HIRING_AI_SCORING, HEAVY_CIVIL_PRESET, HAUL_TICKETS, EXTERNAL_DOC_EMAIL, DAILY_INSPECTOR_REPORTS, BYOK_AI_KEYS, BUY_AMERICA, BIM_VIEWER, BID_CONVERSION_AUTO_ESIGN, AI_TAKEOFF_FEW_SHOT, AI_PROVIDER_TAKEOFF, AI_PROVIDER_EMBEDDINGS.
- Flags with **zero references anywhere in server/** (so they act only in the UI, or not at all): DOCUMENT_CONTROL, PROJECT_HEALTH_SCORE, MOBILE_OFFLINE_V2, HIRING_AUTO_TASKS, HIRING_ATS_SYNC, REVENUE_RECOGNITION, WHATIF_SIMULATOR (FE route gate only), SESSION_MANAGEMENT. Others are referenced only through other paths: PUBLIC_API (9 refs) and AI_PROVIDER_GENERAL (via the AI router); INTEGRATION_QBO, AI_GOVERNANCE and WH_347_PAYROLL have only 1–2 references, so their enforcement needs verification.

| Flag | Label | Default | FE route gate |
|---|---|---|---|
| INTEGRATIONS_HUB | Integrations Hub | ON |  |
| INTEGRATION_QBO | QuickBooks Online | ON |  |
| INTEGRATION_GOOGLE | Google Workspace | ON |  |
| INTEGRATION_MICROSOFT | Microsoft 365 | ON |  |
| INTEGRATION_ESIGN | E-Signature (DocuSign) | ON |  |
| SSO | Single Sign-On (SAML) | ON |  |
| AUDIT_EXPORT | Audit Log Export | ON |  |
| DATA_RETENTION | Data Retention Policies | ON |  |
| PRIVACY_COMPLIANCE | GDPR / Privacy Tools | ON |  |
| SESSION_MANAGEMENT | Advanced Session Security | ON |  |
| INTEGRATION_ZAPIER | Zapier | ON |  |
| INTEGRATION_SAGE | Sage Intacct Construction | ON |  |
| INTEGRATION_BLUEBEAM | Bluebeam Studio | ON |  |
| INTEGRATION_AUTODESK | Autodesk Construction Cloud | ON |  |
| PUBLIC_API | Public API & Developer Portal | ON |  |
| AI_GOVERNANCE | AI Governance | ON |  |
| APPROVALS_FRAMEWORK | Approvals Framework | ON |  |
| DOCUMENT_CONTROL | Document Control | ON |  |
| EXECUTIVE_DIGEST | Executive Digest | ON |  |
| PROJECT_HEALTH_SCORE | Project Health Score | ON |  |
| MOBILE_OFFLINE_V2 | Mobile & Offline Sync | ON |  |
| HIRING_MODULE | Hiring Module | ON |  |
| HIRING_AI_SCORING | Hiring – AI Candidate Scoring | ON |  |
| HIRING_AUTO_TASKS | Hiring – Automated Tasks | ON |  |
| HIRING_ATS_SYNC | Hiring – ATS Sync | ON |  |
| BIM_VIEWER | 3D BIM Viewer | OFF |  |
| REVENUE_RECOGNITION | Revenue Recognition / WIP | OFF |  |
| WHATIF_SIMULATOR | What-If Simulator | OFF | /what-if-simulator |
| LIDAR_SCANNER | LiDAR Scanner | OFF | /lidar-scans |
| VIDEO_CALLS | Video Calls | OFF |  |
| SMS_NOTIFICATIONS | SMS Notifications | OFF |  |
| TWILIO_INTEGRATION | Twilio Click-to-Call | OFF |  |
| DOT_PAY_ITEMS | DOT Pay Items Library | OFF |  |
| DBE_TRACKING | DBE / MBE / WBE Tracking | OFF | /dbe-goals |
| WH_347_PAYROLL | WH-347 Certified Payroll | OFF |  |
| HAUL_TICKETS | Haul Tickets | OFF | /haul-tickets |
| DAILY_INSPECTOR_REPORTS | Daily Inspector Reports (IDR) | OFF | /daily-inspector-reports |
| SWPPP_INSPECTIONS | SWPPP Inspections | OFF | /swppp-inspections |
| SURETY_BONDS | Surety Bonds | OFF | /surety-bonds |
| BUY_AMERICA | Buy America Compliance | OFF | /material-certifications |
| MASS_HAUL_ANALYZER | Mass Haul Analyzer | OFF |  |
| DOT_PROGRESS_ESTIMATE | DOT Progress Estimate | OFF |  |
| HEAVY_CIVIL_PRESET | Heavy Civil Preset | OFF |  |
| EXTERNAL_DOC_EMAIL | External Document Email Delivery | OFF |  |
| AI_TAKEOFF_FEW_SHOT | AI Takeoff – Few-shot Corrections | OFF |  |
| AI_ESTIMATOR | AI Estimator (takeoff, estimate, chat) | OFF |  |
| AI_PROVIDER_TAKEOFF | Takeoff AI: Claude (Anthropic) + GPT Fallback | ON |  |
| AI_PROVIDER_GENERAL | General AI: Claude (Anthropic) + GPT Fallback | ON |  |
| AI_PROVIDER_EMBEDDINGS | AI Provider — Embeddings (reserved) | OFF |  |
| COI_COMPLIANCE_HOLD | COI Compliance — Block release on non-compliance | OFF |  |
| TILE_RENDERING_ENABLED | Server-side PDF Tile Pre-rendering | OFF |  |
| INVENTORY_ADJUSTMENT_APPROVAL | Inventory – Approval Gate for Large Adjustments | OFF |  |
| BID_CONVERSION_AUTO_ESIGN | Bid Conversion – Auto E-Sign Draft Contract | OFF |  |
| BYOK_AI_KEYS | Bring-Your-Own-Key (BYOK) — Per-org AI Provider Keys | OFF |  |

54 flags; 27 default OFF.

### Plan / subscription gates (`shared/billing/plans.ts`, `server/middleware/requireFeature.ts`, `server/services/featureAccess.ts`)

Tiers (DB value → display name): free → Trial ($0, 14-day), starter → Starter ($89), professional → Growth ($229), enterprise → Scale ($579). Hustler ($1199) is stored as enterprise plus a flag.

- **Starter**: no FeatureKeys.
- **Growth** adds 18: PRODUCTION_RATES, MATERIAL_BUDGET, VENDOR_INVITES, ADVANCED_REPORTS, APPROVALS_FRAMEWORK, DOCUMENT_CONTROL, PROJECT_HEALTH_SCORE, MODIFIER_AI_SUGGEST, CONTRACTS, HIRING_ATS, SAFETY_TRAINING, SUBCONTRACT_MGMT, T_AND_M, LEAVE_MANAGEMENT, PUNCH_LIST, WARRANTY_MODULE, DASHBOARD_CUSTOMIZATION, BYOK_AI_KEYS.
- **Scale** adds: PORTFOLIO_DASHBOARDS, BID_NETWORK, WEBSITE_SEO, PRIORITY_SUPPORT, MULTI_ORG, INTEGRATIONS_HUB, EXECUTIVE_DIGEST, AI_GOVERNANCE, MOBILE_OFFLINE_V2, SSO, AUDIT_EXPORT, DATA_RETENTION, PRIVACY_COMPLIANCE, SESSION_MANAGEMENT, CPM_SCHEDULING, BIM_VIEWER, LIDAR_SCANNER, WORKFLOW_BUILDER, RISK_MANAGEMENT, ASSET_MANAGEMENT, ENTERPRISE_NOTIFICATIONS.
- **Add-ons**: ai_pm → AI_PM; ai_cfo → AI_CFO; ai_email → AI_EMAIL; website_seo; bid_network; ai_vision; integration_qbo; integration_esign; ai_governance_pack.

`PLAN_LIMITS`:

| Tier | Projects | Users | Storage (GB) | AI vision docs | AI tokens | AI jobs |
|---|---|---|---|---|---|---|
| free | 2 | 1 | 0.5 | 3 | 50k | 25 |
| starter | 10 | 5 | 10 | 10 | 500k | 500 |
| professional | 50 | 25 | 50 | 50 | 5M | 5k |
| enterprise | unlimited (-1) | unlimited (-1) | 500 | 200 | 50M | 50k |

Enforcement points:
- `requireFeature` / `requireAnyFeature` return 403 `{upgradeRequired:true}`. SUPER_ADMIN bypasses them. They are used on only 18 routes: SSO ×3, AUDIT_EXPORT ×3, DATA_RETENTION ×5, PRIVACY_COMPLIANCE ×6, MODIFIER_AI_SUGGEST ×1.
- Seat enforcement: `services/billing/seatEnforcement.ts`.
- Usage metering and quotas: `services/billing/usageMetering.ts` (with `aiTokenQuotaOverride` and `storageGbQuotaOverride`).
- Dunning and read-only mode: `services/billing/dunning.ts` and `requireSubscriptionWriteAccess`.
- `isDevMode()` (non-prod or `BILLING_MODE=manual`) changes the denial reason only.

Gap: most Growth and Scale FeatureKeys (CONTRACTS, HIRING_ATS, T_AND_M, PUNCH_LIST, BID_NETWORK, CPM_SCHEDULING, …) have **no `requireFeature` route gate**. Those modules are gated only by role/permission flags (`requireFeaturePermission('can…')`).

## 6. Existing test assets

- **Vitest** (`vitest.config.ts`) covers `shared|server|client|mobile/**/*.test.ts(x)`.
  - File counts: server 346 (331 under `server/__tests__`, including the subdirs org-isolation, multi-instance, email-sync and takeoff-workflow; the other 15 sit in `server/services/exports/__tests__`, `server/support/__tests__`, `server/utils/__tests__` and `server/scripts/__tests__`), shared 10, client 143 (jsdom via pragma), mobile 1. Total 500.
  - `*.serial.test.ts` (2 files) run only with `RUN_SERIAL_DB_TESTS=1`.
  - Tests need a real Postgres. `globalSetup` refuses to touch a DB that does not look like a test DB (see TESTING.md).
  - Scripts: `npm test`, `test:coverage`, `test:isolation` (org-isolation suite), `test:setup`.
- **Integration audit**: `vitest.integration.config.ts` runs `audit/tests/**/*.spec.ts` (8 specs: ai, api).
- **Playwright** (`playwright.config.ts`, testDir `e2e/`, global setup `playwright.global-setup.ts`) has 81 specs.
  - Takeoff-heavy: about 40 takeoff/markup specs, plus `money-*` flows (accounting-sync, bid-to-payapp, change-order, procurement 3-way match, time-clock→payroll), auth-flow, portal-flows, tenant-isolation-api, project-crud, messaging, heavy-civil, notifications and admin pages.
  - Mobile/touch projects exist (`takeoff-touch-gestures`).
  - Run with `npm run test:e2e`. Test accounts are in TEST_COMPANY_ACCOUNTS.md.
- **k6 load harness** (`loadtests/`, `scripts/run-load-test.sh <mode>`):
  - Modes and scenarios:

    | Mode | Scenario | Profile | Budget check |
    |---|---|---|---|
    | smoke | `smoke.js` | 5 VUs, 60s | `check-budgets.mjs` |
    | baseline | `top-endpoints.js` | 25 VUs, 2m | `--require-all` |
    | nightly | `top-endpoints.js` | ramp to 50 VUs, about 10m | `--require-all` |
    | noisy | `noisy-neighbor.js` | heavy plus quiet tenant cohorts | `--cohort=quiet --min-measured=5` |
    | spike | `top-endpoints.js` | 100 VUs | informational; never fails the build |
  - Env vars: `BASE_URL` (default :5000, waits for `/healthz`), `LOAD_TENANT_USERS`, `LOAD_PROFILE`, `LOAD_NOISY_RATIO`, `LOAD_USERS`, `LOAD_DURATION`.
  - Exit codes: 0 pass, 1 regression, 2 missing prerequisite.
  - CI: the smoke run on every PR (`.github/workflows/ci.yml` "Load Test Smoke") and `load-test-nightly.yml` (nightly + noisy + rolling re-baseline).
  - Top-20 read mix: `loadtests/lib/endpoints.js`. Login: `lib/auth.js`.
  - `loadtests/ai-takeoff-bench/`: 5 trade fixtures, its own `budgets.json`, nightly workflow `ai-takeoff-bench-nightly.yml`.
- **Budgets and SLAs**:
  - `loadtests/budgets.json` (schemaVersion 2):
    - global p95 2000 ms and error rate 1%, with a regression tolerance of 15%
    - 21 read endpoints, p95 80–1000 ms (e.g. `/healthz` 80, `/api/auth/me` 300, `/api/dashboard` 950, `/api/bids/:id` 950, `/api/crm/*` 950)
    - 10 mutation budgets (POST/PATCH bids, projects, change-orders, rfis, time-entries; 700–1200 ms)
  - **Gap:** the mutation budgets reference `loadtests/scenarios/mutations.js`, which **does not exist**. No scenario issues those writes, so `--require-all` (nightly/baseline) should report 10 MISSING mutation endpoints and fail. Either the nightly is red or the CI job differs; verify.
  - `docs/ops/capacity.md`:
    - tested ceiling: 50 VUs, about 940 RPS, global p95 about 1.6 s, error rate under 0.1%
    - DB: about 38 of 50 pool connections
    - pg-boss: about 125 jobs/min, p95 12 s
    - Web Vitals budgets: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.10, TTFB ≤ 800 ms, FCP ≤ 1.8 s; alert when the good ratio is below 0.75
    - noisy-neighbor isolation
    - re-baseline procedure
  - `docs/sla.md` (generated from `shared/sla/policy.ts`; CI fails on drift):

    | Target | Starter | Pro | Enterprise |
    |---|---|---|---|
    | Monthly uptime | 99.5% | 99.9% | 99.95% |
    | First response, urgent | 1 business day | 4 business hours | 30 min (24×7) |
    | Sev-1 resolution | 5 business days | 2 calendar days | 8 h |

    Service credits are 5% of the month's fees per 0.1% below the uptime target, capped at 25% (Starter/Pro). Support SLA monitoring code lives in `server/support/` (`slaPolicy`, `slaMonitor` tests).

## 7. Docs usable as expected-behavior authority

| Doc | Summary | Caveats |
|---|---|---|
| docs/WORKFLOWS.md (1024 lines) | Statuses, valid transitions, role permissions and side effects for 14 lifecycles: bid, project, estimate, change order, pay run, T&M, procurement, contract, delay, inspection, equipment, flexible workflow engine, supporting lifecycles, health scoring. Best source for state-machine tests. | Cites `server/bidRoutes2.ts`, which does not exist (the file is `server/bidRoutes.ts`, imported as bidRoutes2). The code's project transitions (`validateProjectStatusTransition` in routes.ts) are BID→PLANNING→ACTIVE→COMPLETE→CLOSED with limited reverts, and CLOSED is terminal; cross-check against the doc. |
| docs/PROJECT_LIFECYCLE_FLOWS.md (1022 lines) | 9 end-to-end flows: lead→award; award→setup/baseline; daily execution→timeclock→daily report→budget; materials→PO→delivery; delay→notice→impact; T&M→invoice; closeout→punch→final billing; AIA pay app (SoV→G702/703→payment); DOT heavy-civil billing. Also a key-tables map and SOW tracking. | |
| docs/ROLE_BASED_TEST_SCENARIOS.md (587 lines) | 7 scripted role scenarios (Estimator→PM→Super; hourly timeclock; delay with no GC response; equipment overuse→replacement; T&M→invoice; AI auto-assign tasks; over-budget project), plus edge cases and a summary checklist. | |
| docs/FEATURE_MATRIX.csv (104 rows) | Columns: feature area/name, roles, FE path, BE route, tables, automations, status, owner. All 104 rows are marked "✅ Working". | Good seed for the coverage matrix, but stale in places (e.g. says JWT). |
| docs/FEATURE_TESTING_PLAYBOOK.md (764 lines) | Step-by-step manual test procedures per major feature. | |
| docs/SYSTEM_FEATURE_BIBLE.md (1669 lines) | "Authoritative" module, feature, integration and role reference, validated May 2026. | |
| docs/module-directory.md (698 lines) | Per-module purpose, pages, route files, schema and roles. | |
| docs/user-role-business-flows.md (970 lines, newest: Aug 2026) | Role-default permissions and flows. | Source of truth is `server/rolePermissions.ts`. |
| docs/ACCOUNT_ROLES_RBAC.md | Role and RBAC reference. | Claims "18 user roles"; code has 8 (rbac.ts `ROLE_HIERARCHY`). |
| docs/rbac-audit.md | Sidebar and permission audit, 2026-04-07. | |
| docs/AUTOMATIONS_AND_EVENTS.md | Event types, pg-boss and cron automations. | |
| docs/architecture/tenant-isolation.md | RLS with FORCE on all multi-tenant tables, fail-closed. | Basis for the isolation tests. |
| docs/architecture/job-queue.md | Queue contract (see 3d). | |
| docs/feature-A…G-*.md | Original specs, now marked IMPLEMENTED (G is partial: mobile offline). | Several cite files that no longer exist: `server/aiRoutes.ts`, `server/changeOrderRoutes.ts`, `server/vendorPricebookRoutes.ts`, `server/jobQueue/handlers/ai_takeoff_analyze.ts`. Use them for intent only. |
| docs/sla.md, docs/ops/capacity.md, loadtests/budgets.json | Non-functional requirements (see section 6). | |
| TESTING.md, e2e/README.md, TEST_COMPANY_ACCOUNTS.md | How to run tests and seeded QA accounts. | |
