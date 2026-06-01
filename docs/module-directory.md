# SmartManageAI — Module Directory

This document is the single authoritative reference for every top-level product module in SmartManageAI. It covers the module's purpose, the frontend pages and components it owns, its backend route files, shared schema files, and which roles can access it.

Roles referenced below come from `client/src/lib/rbac.ts`. The platform-level `SUPER_ADMIN` role has unrestricted access to every module; it is omitted from per-module role lists for brevity.

---

## Table of Contents

1. [Home](#1-home)
2. [Sales / Win Work](#2-sales--win-work)
3. [Projects](#3-projects)
4. [Workforce](#4-workforce)
5. [Finance](#5-finance)
6. [Field Ops](#6-field-ops)
7. [Safety & Compliance](#7-safety--compliance)
8. [Administration](#8-administration)
9. [Reports](#9-reports)

---

## 1. Home

**Purpose:** The landing hub for every logged-in user — surfaces a personalised activity feed, cross-org portfolio view for HUSTLER users, company-wide bulletins, an executive digest, and the "My Day" / "My Work" personal task surfaces.

### Frontend Pages (`client/src/pages/`)
| Page file | Route | Description |
|---|---|---|
| `dashboard.tsx` | `/dashboard` | Main dashboard with configurable widgets |
| `my-day.tsx` | `/my-day` | Personal daily agenda (tasks, time entries, weather) |
| `my-work.tsx` | `/my-work` | Unified inbox of assigned tasks and approvals |
| `notifications.tsx` | `/notifications` | Notification history |
| `executive-digest.tsx` | `/executive-digest` | AI-generated weekly executive summary |
| `portfolio.tsx` | `/portfolio` | HUSTLER multi-org portfolio overview |
| `hustler-dashboard.tsx` | `/hustler` | HUSTLER-specific cross-org dashboard |
| `hustler-benchmarking.tsx` | `/hustler/benchmarking` | Cross-org KPI benchmarking |
| `hustler-unified-inbox.tsx` | `/hustler/inbox` | Unified inbox across all linked orgs |

### Key Component Directories (`client/src/components/`)
- `dashboard-widgets/` — individual dashboard widget implementations
- `DashboardGrid.tsx`, `DashboardSection.tsx`, `DashboardEditMode.tsx` — dashboard layout and edit-mode shell
- `WidgetLibrary.tsx`, `WidgetSettingsDialog.tsx`, `WidgetErrorBoundary.tsx` — widget registry and settings
- `AppHeader.tsx`, `TopHeader.tsx` — global page header
- `AnnouncementBanner.tsx` — org-wide announcement display

### Backend Route Files (`server/`)
- `server/dashboardRoutes.ts` — widget data endpoints, dashboard config
- `server/myDayRoutes.ts` — My Day aggregation
- `server/myWorkRoutes.ts` — My Work / unified inbox
- `server/executiveDigestRoutes.ts` — digest generation and retrieval
- `server/portfolioRoutes.ts` — HUSTLER portfolio data
- `server/hustlerRoutes.ts` — HUSTLER org management and switching
- `server/notificationRoutes2.ts` — notification history and mark-read
- `server/notificationPreferencesRoutes.ts` — per-user notification settings
- `server/pushSubscriptionRoutes.ts` — web push subscriptions

### Shared Schema Files (`shared/schema/features/`)
- `reports.ts` — executive digest / project health snapshots
- `hustler.ts` — hustler_organizations, delegates, network linkage
- `kpi.ts` — KPI templates, assignments, entries (also used by Finance)

### Access Roles
| Role | Access |
|---|---|
| ADMIN, HUSTLER, MANAGER, SUPERINTENDENT, ESTIMATOR, FIELD_WORKER | Full dashboard and My Day/My Work |
| HUSTLER | Additionally: Portfolio, cross-org benchmarking |
| ADMIN, HUSTLER | Executive Digest |
| VENDOR | Dashboard only |

---

## 2. Sales / Win Work

**Purpose:** Covers the full pre-award cycle — CRM pipeline, bid creation and cost-building, bid network (GC invite / sub inbox), AI bid and contract analysis, and the public marketplace for equipment rentals and subcontractor discovery.

### Frontend Pages (`client/src/pages/`)
| Page file | Route | Description |
|---|---|---|
| `crm.tsx` | `/crm` | CRM contacts, organizations, pipeline |
| `crm-deal-detail.tsx` | `/crm/deals/:id` | Individual deal/opportunity detail |
| `crm-settings.tsx` | `/crm/settings` | CRM pipeline and field configuration |
| `crm-upgrades.tsx` | `/crm/upgrades` | CRM plan upgrade prompts |
| `bids.tsx` | `/bids` | Bid list and kanban |
| `bid-detail.tsx` | `/bids/:id` | Bid detail with cost builder |
| `bid-wizard.tsx` | `/bids/new` | Guided new-bid wizard |
| `bid-estimate.tsx` | `/bids/:id/estimate` | Full estimating workspace |
| `bid-hit-rate.tsx` | `/bids/analytics` | Bid win-rate analytics |
| `bid-inbox.tsx` | `/bid-inbox` | Sub/vendor bid invitation inbox |
| `bid-network.tsx` | `/bid-network` | GC bid invitation management |
| `bid-network-detail.tsx` | `/bid-network/:id` | Invitation detail and leveling |
| `ai-bid-analysis.tsx` | `/ai-bid-analysis` | AI-powered bid document analysis |
| `ai-contract-analysis.tsx` | `/ai-contract-analysis` | AI-powered contract risk analysis |
| `marketplace.tsx` | `/marketplace` | Equipment rental and sub discovery |
| `rfq-response.tsx` | `/rfq/:token` | Public RFQ response form for vendors |
| `historical-costs.tsx` | `/historical-costs` | Historical cost database |
| `sequences.tsx` | `/sequences` | CRM outreach sequence builder |
| `sequence-detail.tsx` | `/sequences/:id` | Individual sequence editor |
| `field-sales.tsx` | `/field-sales` | Mobile-optimised field sales view |

### Key Component Directories (`client/src/components/`)
- `crm/` — pipeline views, contact dialogs, activity timeline, calls, quotes
- `bid/` — bid detail dialogs, plan ingestion, cost-builder sidebar, BIM viewer
- `estimate/` — assembly dialogs, enrichment drawer, revision history, factor overrides
- `takeoff/` — takeoff workspace, AI panel, measurement tools, calibration zones
- `plans/` — plan set viewer, markup layers, drawing set panel
- `markups/` — annotation canvas, layer panel, markup toolbar
- `calculators/` — trade calculators (roofing, lumber, masonry, geometry, etc.)
- `AIBidAnalysisPanel.tsx`, `AIContractAnalysisPanel.tsx` — AI analysis panels
- `BidsTable.tsx`, `BidsKanbanView.tsx` — bid list view variants
- `LibraryPanel.tsx`, `LibraryAssemblyDialog.tsx` — cost library / assemblies
- `library/` — bulk actions and category management for the library
- `VendorPricebookUpload.tsx`, `VendorPricingSync.tsx` — vendor pricebook import

### Backend Route Files (`server/`)
- `server/crmRoutes.ts` — core CRM CRUD
- `server/crmAnalyticsRoutes.ts` — pipeline metrics
- `server/crmCallsRoutes.ts` — call logs and transcripts
- `server/crmTasksRoutes.ts` — CRM-linked tasks
- `server/crmQuotesRoutes.ts` — quote management
- `server/crmCustomFieldsRoutes.ts` — custom field definitions
- `server/crmLeadFormsRoutes.ts` — public lead capture forms
- `server/crmLeadScoringRoutes.ts` — lead scoring rules
- `server/crmAutomationsRoutes.ts` — workflow automations
- `server/crmAssignmentRulesRoutes.ts` — auto-assignment rules
- `server/crmCsvImportRoutes.ts` — CSV contact import
- `server/crmCatalogRoutes.ts` — org catalog sync
- `server/crmMeetingRoutes.ts` — meeting/calendar integration
- `server/crmSlaRoutes.ts` — CRM SLA policy
- `server/crmDuplicatesRoutes.ts` — duplicate detection
- `server/crmEmailLoggingRoutes.ts` — inbound email logging
- `server/crmCustomReportsRoutes.ts` — custom CRM reports
- `server/sequenceRoutes.ts` — outreach sequences
- `server/bidRoutes.ts` — bid CRUD and status management
- `server/bidAnalyticsRoutes.ts` — bid hit-rate analytics
- `server/bidNetworkRoutes.ts` — bid network invitations
- `server/estimateRoutes.ts` — estimating engine (line items, versions)
- `server/estimatePricingRoutes.ts` — pricing lookups
- `server/assemblyRoutes.ts` — assembly library
- `server/libraryRoutes.ts` — custom item library
- `server/costBookRoutes.ts` — cost book reference data
- `server/costEngineRoutes.ts` — cost computation engine
- `server/lineItemEnrichmentRoutes.ts` — AI line-item enrichment
- `server/aiDocumentRoutes.ts` — AI bid/contract document analysis
- `server/aiEstimatorRoutes.ts` — AI estimator workspace
- `server/aiEstimatorAssemblyRoutes.ts` — AI-suggested assemblies
- `server/aiEstimatorSkillsRoutes.ts` — estimator skill library
- `server/aiTakeoffFeatureRoutes.ts` — AI takeoff
- `server/takeoffSheetRoutes.ts`, `server/takeoffMeasurementRoutes.ts` — takeoff data
- `server/takeoffCategoryRoutes.ts`, `server/takeoffScopeRoutes.ts` — takeoff categorisation
- `server/takeoffSheetSetRoutes.ts`, `server/takeoffToolChestRoutes.ts` — sheet management
- `server/planSetIngestRoutes.ts` — plan PDF ingestion
- `server/planDocumentMarkupRoutes.ts`, `server/planPinsRoutes.ts` — plan markup
- `server/drawingSetRoutes.ts` — drawing sets
- `server/standaloneTakeoffRoutes.ts` — standalone takeoff workspace
- `server/marketplaceRoutes.ts` — marketplace listings
- `server/clauseLibraryRoutes.ts` — legal clause library
- `server/modifierRoutes.ts` — takeoff modifier rules
- `server/calculatorRoutes.ts` — trade calculators
- `server/vendorRoutes.ts` — vendor pricebook and scoring

### Shared Schema Files (`shared/schema/features/`)
- `crm.ts` — orgs, contacts, quotes, sequences, calls, transcripts, lead scoring
- `estimate.ts` — estimating engine (settings, crew, versions, history)
- `ai_estimator.ts` — AI estimator workspace tables
- `takeoff.ts` — takeoff sheets, measurements, BIM, scope, modifiers
- `drawings.ts` — drawing sets
- `library.ts` — custom library items and assemblies
- `cost_book.ts` — cost book reference tables
- `org_catalog.ts` — trade templates, UoM, master catalogs, SOW items
- `vendor_pricing.ts` — vendor pricebook and pricing sync

### Access Roles
| Role | Access |
|---|---|
| ADMIN, MANAGER, ESTIMATOR, HUSTLER | Full access (view, create, edit bids; CRM; takeoff; marketplace) |
| SUPERINTENDENT | View bids and CRM; read-only takeoff |
| VENDOR | Bid inbox and RFQ response only (no marketplace — gated by `hasManagementAccess`) |
| FIELD_WORKER | No access |

---

## 3. Projects

**Purpose:** Manages the full active-project lifecycle — scope, schedule, change orders, documents (RFIs, submittals, transmittals), daily notes, media gallery, task tracking, and the client/subcontractor portal.

### Frontend Pages (`client/src/pages/`)
| Page file | Route | Description |
|---|---|---|
| `projects.tsx` | `/projects` | Project list (table, kanban, map, calendar views) |
| `project-detail.tsx` | `/projects/:id` | Project detail with tabbed sub-views |
| `project-templates.tsx` | `/project-templates` | Project template library |
| `project-closeout.tsx` | `/projects/:id/closeout` | Closeout checklist and readiness tracker |
| `calendar.tsx` | `/calendar` | Cross-project calendar |
| `tasks.tsx` | `/tasks` | Task list / kanban |
| `approvals.tsx` | `/approvals` | Approval queue (change orders, pay apps, etc.) |
| `messages.tsx` | `/messages` | Internal messaging threads |
| `email-assistant.tsx` | `/email-assistant` | AI email drafting assistant |
| `daily-reports.tsx` | `/daily-reports` | Daily field reports list |
| `daily-report-locks.tsx` | `/daily-report-locks` | Daily report lock management |
| `contracts.tsx` | `/contracts` | Contract list |
| `subcontracts.tsx` | `/subcontracts` | Subcontract list and management |
| `progress-billing.tsx` | `/progress-billing` | AIA Schedule of Values / pay application billing |
| `client-portal-public.tsx` | `/client-portal` | Public-facing client portal |
| `sub-portal.tsx` | `/sub-portal` | Subcontractor portal shell |
| `portal-chat.tsx` | `/portal/chat` | Portal real-time chat |
| `unified-portal.tsx` | `/portal/unified` | Unified portal landing |
| `issue-captures.tsx` | `/issue-captures` | Field issue captures |
| `PlanDocumentPrintPage.tsx` | `/plans/:id/print` | Printable plan document |
| `SchedulePrintPage.tsx` | `/schedule/print` | Printable Gantt |
| `shared-preview.tsx` | `/shared/:token` | Publicly shareable document preview |

### Key Component Directories (`client/src/components/`)
- `project-tabs/` — all per-project tabs (Overview, Budget, Scope, Change Orders, Plans, Time, Subcontractors, Procurement, Safety, etc.)
- `document-control/` — RFI, submittal, and transmittal dialogs
- `client-portal/` — client portal shell and views
- `sub-portal/` — subcontractor portal shell
- `portal/` — shared portal utilities
- `subcontracts/` — subcontract management panels
- `delay-claims/` — delay claim dialogs and table
- `sov/` — Schedule of Values components
- `ProjectCard.tsx`, `ProjectsTable.tsx`, `ProjectsKanbanView.tsx`, `ProjectsMapView.tsx`, `ProjectsCalendarView.tsx` — project list view variants
- `ChangeOrderDialog.tsx`, `AiChangeOrderGenerator.tsx` — change order creation
- `CloseoutReadinessCard.tsx` — closeout readiness widget
- `DailyNoteFeed.tsx` — daily notes feed
- `MediaGallery.tsx` — project photo / media gallery
- `TaskDetailModal.tsx`, `TasksKanbanView.tsx` — task management
- `ProjectRFIs.tsx`, `ProjectSubmittals.tsx`, `ProjectTransmittals.tsx` — document register widgets
- `ProjectAddenda.tsx` — bid addenda management
- `workflow-tracker.tsx` — approval workflow visualisation

### Backend Route Files (`server/`)
- `server/projectCrudRoutes.ts` — project CRUD and status
- `server/projectContentRoutes.ts` — notes, photos, media
- `server/projectFinancialRoutes.ts` — project financials
- `server/projectOpsRoutes.ts` — ops/field data for a project
- `server/projectReportRoutes.ts` — per-project reports
- `server/projectTemplateRoutes.ts` — project template management
- `server/projectDistributionListRoutes.ts` — distribution lists
- `server/projectLogEmailScheduleRoutes.ts` — scheduled log emails
- `server/projectNotePagesRoutes.ts` — structured note pages
- `server/changeOrderCrudRoutes.ts` — change order CRUD
- `server/changeOrderApprovalRoutes.ts` — change order approvals
- `server/changeOrderExportRoutes.ts` — CO PDF export
- `server/rfiRoutes.ts` — RFIs
- `server/submittalRoutes.ts` — submittals
- `server/transmittalRoutes.ts` — transmittals
- `server/documentRevisionRoutes.ts` — document revision control
- `server/closeoutRoutes.ts` — project closeout
- `server/scheduleRoutes.ts` — Gantt / CPM schedule
- `server/contractRoutes.ts` — contracts
- `server/subcontractRoutes.ts` — subcontract base data
- `server/subcontractManagementRoutes.ts` — sub management workflow
- `server/subcontractorPayablesRoutes.ts` — payables to subs
- `server/sovRoutes.ts` — Schedule of Values
- `server/aiaBillingRoutes.ts` — AIA pay applications
- `server/approvalRoutes.ts` — approval queue
- `server/taskRoutes.ts` — tasks
- `server/messagingRoutes.ts` — messaging threads
- `server/clientPortalRoutes.ts` — client portal
- `server/portalRoutes.ts` — sub/client portal auth and data
- `server/delayRoutes.ts` — delay claims
- `server/scopeRoutes.ts` — scope of work line items
- `server/addendaRoutes.ts` — bid addenda
- `server/punchListRoutes.ts` — punch lists
- `server/warrantyRoutes.ts` — warranty items
- `server/assetManagementRoutes.ts` — asset handover
- `server/riskRoutes.ts` — project risk register
- `server/locationRoutes.ts` — location management
- `server/mobilizationRoutes.ts` — mobilization tracking
- `server/notesRoutes.ts` — general notes

### Shared Schema Files (`shared/schema/features/`)
- `rfi.ts` — RFIs, submittals, transmittals, project log email schedules
- `financial.ts` — SOV, pay applications, lien waivers, retention, unified payments, revenue recognition
- `subcontractor.ts` — subcontract management and sub bid invitations
- `contracts.ts` — contract management and e-signature
- `schedule.ts` — Gantt / CPM schedules and PDF alerts
- `compliance.ts` — approvals, retention, risks, addenda, audit
- `closeout.ts` — project closeout checklists and readiness tracking
- `portal.ts` — subcontractor and client portal access, portal chat
- `messaging.ts` — conversations, messages, video calls

### Access Roles
| Role | Access |
|---|---|
| ADMIN, MANAGER, HUSTLER | Full access including create, edit, approve, export |
| SUPERINTENDENT | Full project execution; create/approve change orders; field data |
| ESTIMATOR | Read most project data; create new projects; no payroll/billing edit |
| FIELD_WORKER | Active projects only; daily notes, media, time entry |
| VENDOR | Portal access only (submit quotes, view portal documents) |

---

## 4. Workforce

**Purpose:** Manages the full employee lifecycle — roster, crews, time clock, T&M time tracking, payroll (including certified/prevailing-wage), hiring (ATS), leave management, and performance.

### Frontend Pages (`client/src/pages/`)
| Page file | Route | Description |
|---|---|---|
| `users.tsx` | `/users` | Org user roster |
| `manage-workers.tsx` | `/manage-workers` | Worker detail and crew assignment |
| `worker-detail.tsx` | `/workers/:id` | Individual worker profile |
| `crews.tsx` | `/crews` | Crew list and management |
| `crew-templates.tsx` | `/crew-templates` | Saved crew templates |
| `time-clock.tsx` | `/time-clock` | Employee self-service time clock |
| `time-clock-manager.tsx` | `/time-clock-manager` | Manager time clock approval view |
| `time-entry.tsx` | `/time-entry` | Manual time entry form |
| `time-log-tab.tsx` | `/time-log` | Time log view |
| `tm-daily.tsx` | `/tm-daily` | T&M daily ticket creation |
| `tm-billing.tsx` | `/tm-billing` | T&M billing review and invoicing |
| `payroll-management.tsx` | `/payroll-management` | Payroll runs and pay stubs |
| `certified-payroll-history.tsx` | `/payroll/certified-history` | Certified payroll report history |
| `overtime-rules.tsx` | `/overtime-rules` | Overtime rule configuration |
| `leave-management.tsx` | `/leave-management` | Leave requests and balances |
| `hiring/index.tsx` | `/hiring` | ATS job board |
| `hiring/jobs.tsx` | `/hiring/jobs` | Job listings management |
| `hiring/candidates.tsx` | `/hiring/candidates` | Candidate list |
| `hiring/pipeline.tsx` | `/hiring/pipeline` | Hiring pipeline kanban |
| `hiring/interviews.tsx` | `/hiring/interviews` | Interview scheduling |
| `talent-pool.tsx` | `/talent-pool` | Talent pool and resume bank |
| `crew-marketplace.tsx` | `/crew-marketplace` | External crew/labor marketplace |
| `voice-logs.tsx` | `/voice-logs` | Voice-dictated field logs |

### Key Component Directories (`client/src/components/`)
- `payroll/` — certified payroll report, deductions, pay stubs, wage decision banners
- `time-entry/` — time entry add form, dialogs, weekly summary, stats
- `tm/` — T&M daily form, tickets section
- `worker/` — worker profile tabs and components
- `TimeEntryForm.tsx`, `TimeEntryContent.tsx` — time entry UI
- `TMDailyForm.tsx`, `TMTicketsSection.tsx` — T&M daily forms
- `PerformanceHistoryTab.tsx`, `SkillsCertificationsTab.tsx` — worker profile tabs

### Backend Route Files (`server/`)
- `server/workforceRoutes.ts` — user/worker CRUD, roles, password changes
- `server/crewRoutes2.ts` — crew management
- `server/crewTemplateRoutes.ts` — crew templates
- `server/timeClockRoutes.ts` — clock in/out, time clock events
- `server/timeEntryRoutes.ts` — manual time entries
- `server/tmRoutes.ts` — T&M daily tickets and billing
- `server/payrollRoutes.ts` — payroll runs, pay stubs, certified payroll
- `server/overtimeRoutes.ts` — overtime rule configuration
- `server/hiringRoutes.ts` — ATS jobs, applications, interviews
- `server/talentPoolRoutes.ts` — talent pool profiles
- `server/leaveRoutes.ts` — leave requests and balances
- `server/performanceRoutes.ts` — performance reviews and ratings
- `server/peerRatingRoutes.ts` — peer ratings
- `server/skillRoutes.ts` — skills and certifications
- `server/laborRateRoutes.ts` — labor rate configuration
- `server/authProfileRoutes.ts` — user profile and password management
- `server/userSettingsRoutes.ts` — per-user settings (MFA, notifications)

### Shared Schema Files (`shared/schema/features/`)
- `crew.ts` — crews, skills, user certifications, worker photos
- `hiring.ts` — ATS jobs, applications, interview stages, talent profiles
- `performance.ts` — employee ratings, reviews, peer ratings, attendance, supervisor notes
- `estimate_pricing.ts` *(also Finance)* — labor rate tables and wage decisions
- `integrations.ts` — Davis-Bacon rate change tables (prevailing wage)

### Access Roles
| Role | Access |
|---|---|
| ADMIN, MANAGER, HUSTLER | Full access including payroll, hiring, all crew management |
| SUPERINTENDENT | Time clock management, crew oversight, leave approval, no payroll |
| ESTIMATOR | Read-only labor rates; no payroll or hiring |
| FIELD_WORKER | Self-service time clock and leave requests only |
| VENDOR | No access |

---

## 5. Finance

**Purpose:** Financial control centre — CFO dashboard, progress billing (AIA pay apps), T&M billing, overhead cost tracking, subcontractor payables, cost rates, historical cost benchmarks, and the WIP / revenue-recognition report.

### Frontend Pages (`client/src/pages/`)
| Page file | Route | Description |
|---|---|---|
| `cfo-dashboard.tsx` | `/cfo-dashboard` | CFO financial KPIs and profitability |
| `progress-billing.tsx` | `/progress-billing` | AIA G702/G703 pay application management |
| `tm-billing.tsx` | `/tm-billing` | T&M billing review and invoicing |
| `subcontractor-payables.tsx` | `/subcontractor-payables` | Subcontractor payables and lien waiver tracking |
| `overhead-costs.tsx` | `/overhead-costs` | Overhead cost allocation |
| `cost-rates.tsx` | `/cost-rates` | Crew and equipment cost rate configuration |
| `historical-costs.tsx` | `/historical-costs` | Historical cost benchmarks by trade/region |
| `billing.tsx` | `/billing` | Platform subscription billing |
| `wip-report.tsx` | `/wip-report` | WIP and revenue recognition report |
| `production-rates.tsx` | `/production-rates` | Production rate tracking and benchmarks |
| `what-if-simulator.tsx` | `/what-if-simulator` | Financial what-if scenario modelling |
| `JobMetricsDashboard.tsx` | `/job-metrics` | Job-level financial metrics dashboard |

### Key Component Directories (`client/src/components/`)
- `cfo/` — CFO KPI cards, AR summary, cost forecasting, project profitability table, equipment metrics
- `payables/` — payables table, approval dialogs, KPI cards
- `sov/` — Schedule of Values builder
- `production-rates/` — production rate detail, benchmarks, cost analytics
- `markups/` — markup rules (also used in estimating)
- `cost-rates/` — cost rate selector and configuration
- `ActualMaterialsInput.tsx`, `MaterialBudgetTracker.tsx` — materials cost tracking
- `ProjectEstimate.tsx` — project estimate summary widget
- `ChangeOrderDialog.tsx` — financial impact of change orders

### Backend Route Files (`server/`)
- `server/aiaBillingRoutes.ts` — AIA pay applications (create, status, record payment)
- `server/sovRoutes.ts` — Schedule of Values
- `server/tmRoutes.ts` — T&M billing (shared with Workforce)
- `server/subcontractorPayablesRoutes.ts` — sub payables and lien waivers
- `server/payrollRoutes.ts` — payroll financials (shared with Workforce)
- `server/overheadRoutes.ts` — overhead cost allocation
- `server/costEngineRoutes.ts` — job cost computation
- `server/costLedgerRoutes.ts` — cost ledger entries
- `server/revenueRecognitionRoutes.ts` — revenue recognition schedules
- `server/retentionRoutes.ts` — retention tracking and releases
- `server/productionRateRoutes.ts` — production rate CRUD
- `server/fieldProductivityRoutes.ts` — field productivity data
- `server/laborRateRoutes.ts` — labor rate tables
- `server/billingRoutes.ts` — platform subscription billing
- `server/aiCfoAnalyticsRoutes.ts` — AI-powered CFO analytics
- `server/profitabilityAlertRoutes.ts` — profitability alert rules
- `server/jobMetricAlertRulesRoutes.ts`, `server/jobMetricAlertEventsRoutes.ts` — job metric alerts
- `server/orgEstimatingFactorsRoutes.ts` — org-level estimating factors

### Shared Schema Files (`shared/schema/features/`)
- `financial.ts` — SOV, pay applications, lien waivers, retention, unified payments, overhead costs, revenue recognition
- `estimate_pricing.ts` — pricing tables, labor rates, wage decisions, cost rates
- `reports.ts` — project profitability/health snapshots, executive digests, WIP

### Access Roles
| Role | Access |
|---|---|
| ADMIN, MANAGER, HUSTLER | Full access — billing, payroll, CFO dashboard, T&M billing, progress billing, payables |
| SUPERINTENDENT | CFO dashboard, historical costs, production rates (read only; no T&M billing, progress billing, or payroll) |
| ESTIMATOR | Cost rates, historical costs, production rates |
| FIELD_WORKER, VENDOR | No access |

---

## 6. Field Ops

**Purpose:** Field execution tooling — equipment tracking and PM, dispatch board, inventory, procurement/purchase orders, permits, LiDAR/point-cloud scans, and BIM (building information model) integration.

### Frontend Pages (`client/src/pages/`)
| Page file | Route | Description |
|---|---|---|
| `dispatch-board.tsx` | `/dispatch-board` | Daily crew and equipment dispatch |
| `equipment.tsx` | `/equipment` | Equipment catalog and tracking |
| `equipment-detail.tsx` | `/equipment/:id` | Individual equipment detail |
| `equipment-rental-marketplace.tsx` | `/equipment-rental` | Equipment rental marketplace |
| `rental-vendors.tsx` | `/rental-vendors` | Rental vendor directory |
| `inventory.tsx` | `/inventory` | Inventory management |
| `procurement-module.tsx` | `/procurement-module` | Purchase orders and procurement |
| `permits.tsx` | `/permits` | Permit tracking |
| `lidar-scans.tsx` | `/lidar-scans` | LiDAR point-cloud scan library |
| `material-price-index.tsx` | `/material-price-index` | Material price index reference |
| `calculator.tsx` | `/calculator` | Trade material calculators |
| `haul-tickets.tsx` | `/haul-tickets` | Haul ticket recording (heavy civil) |

### Key Component Directories (`client/src/components/`)
- `equipment/` — equipment dialogs and tabs
- `lidar/` — point cloud viewer (`PointCloudViewer.tsx`)
- `bim/` — BIM diff and quantity dialogs
- `dot/` — DOT/heavy-civil field helpers, pay item picker, mass-haul diagram
- `calculators/` — trade calculators (also surfaced in estimating)
- `EquipmentRateSelector.tsx` — inline equipment rate picker
- `PermitsTab.tsx` — project-level permits tab
- `PlanPinLayer.tsx` — plan pin/issue overlay
- `WeatherForecastWidget.tsx`, `WeatherEvidenceCard.tsx` — weather integration

### Backend Route Files (`server/`)
- `server/equipmentRoutes.ts` — equipment CRUD, assignments, maintenance
- `server/inventoryRoutes.ts` — inventory tracking
- `server/procurementModuleRoutes.ts` — purchase orders and procurement workflow
- `server/permitRoutes.ts` — permit tracking
- `server/lidarRoutes.ts` — LiDAR scan upload and annotation
- `server/bimRoutes.ts` — BIM model management
- `server/scheduleRoutes.ts` — dispatch scheduling (shared with Projects)
- `server/scheduleImportExport.ts` — schedule import/export
- `server/materialTrackingRoutes.ts` — material tracking on projects
- `server/materialCalculator.ts` — material quantity calculations
- `server/materialTestRoutes.ts` — material certifications
- `server/weatherRoutes.ts` — weather data integration
- `server/locationRoutes.ts` — jobsite location management

### Shared Schema Files (`shared/schema/features/`)
- `equipment.ts` — equipment catalog, assignments, repairs, maintenance, rentals
- `lidar.ts` — LiDAR scans, annotations, comparisons
- `schedule.ts` — project schedules (shared with Projects)
- `dot.ts` — haul tickets, heavy civil field data (shared with Safety & Compliance)

### Access Roles
| Role | Access |
|---|---|
| ADMIN, MANAGER, SUPERINTENDENT, HUSTLER | Full access |
| ESTIMATOR | Equipment catalog, LiDAR, procurement (read); calculators |
| FIELD_WORKER | LiDAR scans and calculators only (equipment and inventory require `hasEquipmentAccess` which excludes FIELD_WORKER) |
| VENDOR | No access |

---

## 7. Safety & Compliance

**Purpose:** Covers regulatory and safety compliance — OSHA incident tracking, safety training, COI/insurance management, compliance dashboard (license and certification expiry), DOT/heavy-civil compliance (DBE goals, surety bonds, SWPPP inspections, daily inspector reports, material certifications), and subcontractor compliance.

### Frontend Pages (`client/src/pages/`)
| Page file | Route | Description |
|---|---|---|
| `SafetyHubPage.tsx` | `/safety` | Safety hub (incidents, training, observations) |
| `safety-training.tsx` | `/safety-training` | Safety training records |
| `CompliancePage.tsx` | `/compliance` | Compliance dashboard (licenses, certifications, insurance expiry) |
| `coi-compliance.tsx` | `/coi-compliance` | Certificate of Insurance tracking |
| `surety-bonds.tsx` | `/surety-bonds` | Surety bond management |
| `dbe-goals.tsx` | `/dbe-goals` | DBE participation goals (federal/state) |
| `DotLibraryPage.tsx` | `/dot-library` | DOT pay item library |
| `haul-tickets.tsx` | `/haul-tickets` | Haul ticket recording (shared with Field Ops) |
| `daily-inspector-reports.tsx` | `/daily-inspector-reports` | DOT daily inspector reports |
| `swppp-inspections.tsx` | `/swppp-inspections` | SWPPP stormwater inspection records |
| `material-certifications.tsx` | `/material-certifications` | Material certification tracking |
| `permits.tsx` | `/permits` | Permit tracking (shared with Field Ops) |

### Key Component Directories (`client/src/components/`)
- `dot/` — DOT field helpers, mass-haul diagram, pay item picker, match explain
- `ComplianceBadge.tsx` — compliance status badge
- `SafetyOfficerAssignment.tsx` — safety officer assignment
- `PpeComplianceSection.tsx` — PPE compliance section
- `InspectionsSection.tsx` — project inspections
- `MaterialTestingSection.tsx` — material test records
- `project-tabs/SafetyTrainingTab.tsx` — per-project safety training

### Backend Route Files (`server/`)
- `server/safetyTrainingRoutes.ts` — safety training records
- `server/safetyObservationsRoutes.ts` — field safety observations
- `server/safetyKpiRoutes.ts` — safety KPI metrics
- `server/safetyWorkflowRoutes.ts` — safety workflow automation
- `server/incidentReviewRoutes.ts` — OSHA incident review
- `server/inspectionRoutes.ts` — SWPPP and field inspections
- `server/coiRoutes.ts` — COI tracking
- `server/complianceRoutes.ts` — compliance dashboard aggregator
- `server/dotRoutes.ts` — DOT pay items and heavy-civil data
- `server/dotPayItemPickerFacetsRoutes.ts` — DOT pay item search facets
- `server/ppeComplianceRoutes.ts` — PPE compliance
- `server/aiHeavyCivilFeatureRoutes.ts` — AI-assisted heavy civil features

### Shared Schema Files (`shared/schema/features/`)
- `safety.ts` — safety trainings, observations, OSHA incidents, toolbox talks
- `dot.ts` — heavy civil: DBE goals, surety bonds, haul tickets, daily inspector reports, SWPPP, material certifications
- `compliance.ts` — approval workflows, risk flags, addenda, audit entries, data retention

### Access Roles
| Role | Access |
|---|---|
| ADMIN, MANAGER, SUPERINTENDENT, HUSTLER | Full access |
| ESTIMATOR | DOT library and compliance read; surety bonds |
| FIELD_WORKER | Safety training view only (daily inspector reports, SWPPP, haul tickets all require ADMIN/MANAGER/SUPERINTENDENT/ESTIMATOR/HUSTLER) |
| VENDOR | Vendor compliance portal (COI submission) |

---

## 8. Administration

**Purpose:** Org-level configuration and platform governance — company settings, branding, feature flags, AI settings, audit logs, scope/cost-book settings, website builder, social media management, integrations, and (for SUPER_ADMIN) platform-wide administration.

### Frontend Pages (`client/src/pages/`)
| Page file | Route | Description |
|---|---|---|
| `company-settings.tsx` | `/company-settings` | Organization settings and branding |
| `settings.tsx` | `/settings` | General app settings |
| `ai-settings.tsx` | `/ai-settings` | AI model and feature configuration |
| `ai-estimator-admin.tsx` | `/ai-estimator/admin` | AI estimator administration |
| `ai-governance.tsx` | `/ai-governance` | AI usage governance and spend caps |
| `audit-logs.tsx` | `/audit-logs` | Audit log viewer |
| `scope-settings.tsx` | `/scope-settings` | Scope and SOW template settings |
| `cost-codes.tsx` | `/cost-codes` | Cost code configuration |
| `cost-book.tsx` | `/cost-book` | Cost book management |
| `website-builder.tsx` | `/website-builder` | Company website builder |
| `social-media.tsx` | `/social-media` | Social media post scheduler |
| `integrations.tsx` | `/integrations` | Third-party integrations (QBO, Sage, Zapier, etc.) |
| `email-campaigns.tsx` | `/email-campaigns` | Email marketing campaigns |
| `profile.tsx` | `/profile` | User profile |
| `onboarding.tsx` | `/onboarding` | Guided org onboarding |
| `data-management.tsx` | `/data-management` | Data import/export management |
| `PlatformAdminDashboard.tsx` | `/admin` | Super Admin: platform dashboard |
| `PlatformOrganizations.tsx` | `/admin/organizations` | Super Admin: all organizations |
| `PlatformOrganizationDetail.tsx` | `/admin/organizations/:id` | Super Admin: org detail |
| `PlatformAnalyticsMonitoring.tsx` | `/admin/analytics` | Super Admin: platform analytics |
| `PlatformTools.tsx` | `/admin/tools` | Super Admin: platform tools and job queue |
| `admin-status.tsx` | `/admin/status` | Super Admin: system status |
| `admin-email-outbox.tsx` | `/admin/email-outbox` | Super Admin: email outbox |

### Key Component Directories (`client/src/components/`)
- `settings/` — settings panel components
- `platform/` — Super Admin subscription panels, support tools, system checks
- `social-media/` — social media calendar, post editor, AI content generator, stats
- `website-builder/` — website pages, gallery, blog, publishing tabs
- `website-blocks/` — drag-and-drop website block components
- `integrations/` — integration connection cards
- `email/` — email campaign components
- `log-email/` — log email schedule management
- `ThemePicker.tsx`, `branding-color-picker.tsx` — branding and theming
- `FeatureGate.tsx` — feature flag gate component
- `CommandPalette.tsx` — global command palette

### Backend Route Files (`server/`)
- `server/platformRoutes.ts` — platform-level admin and SUPER_ADMIN operations
- `server/platformBillingRoutes.ts` — platform subscription billing
- `server/orgLifecycleRoutes.ts` — org provisioning and lifecycle
- `server/featureFlagRoutes.ts` — feature flag management
- `server/aiOnboardingRoutes.ts` — AI-assisted org onboarding
- `server/aiOrchestrationRoutes.ts` — AI orchestration and governance
- `server/websiteRoutes.ts` — website builder CRUD
- `server/websiteAiRoutes.ts` — AI website content generation
- `server/socialRoutes.ts` — social media post scheduling
- `server/emailRoutes.ts` — org email account management
- `server/emailCampaignRoutes.ts` — email campaign management
- `server/integrationRoutes.ts` — integration connections
- `server/byokRoutes.ts` — bring-your-own-key AI configuration
- `server/auditBillingStorageRoutes.ts` — audit log writes and billing events
- `server/auditExportRoutes.ts` — audit log export
- `server/organizationDocumentRoutes.ts` — org-level document vault
- `server/organizationBranding.ts` — branding and theming
- `server/scopeRoutes.ts` — scope template settings
- `server/jobQueueAdminRoutes.ts` — background job queue admin
- `server/opsRoutes.ts` — ops / health endpoints
- `server/statusPageRoutes.ts` — system status page
- `server/supportRoutes.ts` — in-app support tickets
- `server/ssoRoutes.ts` — SSO configuration
- `server/passkeyRoutes.ts` — passkey / WebAuthn configuration
- `server/dataPipelineService.ts` — data import pipeline
- `server/mobileSyncRoutes.ts` — mobile offline sync configuration

### Shared Schema Files (`shared/schema/features/`)
- `flags.ts` — FEATURE_FLAG_* constants, feature flag preset and manual change tables
- `integrations.ts` — integration connections, sync state, webhooks, QBO, Sage, Zapier, Davis-Bacon
- `compliance.ts` — SSO sessions, GDPR / data retention, audit log
- `orgLifecycle.ts` — org provisioning states
- `website.ts` — website pages, blocks, blog posts, publishing state
- `email.ts` — org email accounts, threads, tasks, attachments
- `misc.ts` — misc org settings, object ACL policy

### Access Roles
| Role | Access |
|---|---|
| SUPER_ADMIN | Full platform administration (all orgs, feature flags, platform billing) |
| ADMIN, HUSTLER | Company settings, branding, AI settings, integrations, audit logs, website builder |
| MANAGER | Company settings (read), website builder read |
| SUPERINTENDENT, ESTIMATOR, FIELD_WORKER | User profile and notification settings only |
| VENDOR | No access |

---

## 9. Reports

**Purpose:** Cross-project reporting and analytics — pre-built project, financial, and estimating reports; custom CRM reports; KPI management; and data export (CSV/PDF).

### Frontend Pages (`client/src/pages/`)
| Page file | Route | Description |
|---|---|---|
| `reports.tsx` | `/reports` | Report library and generator |
| `kpi-management.tsx` | `/kpi-management` | KPI template and assignment management |
| `my-kpis.tsx` | `/my-kpis` | Personal KPI dashboard |
| `company-health.tsx` | `/company-health` | Company health scorecard |
| `company-communications.tsx` | `/company-communications` | Company-wide communications log |
| `audit-logs.tsx` | `/audit-logs` | Audit log viewer (shared with Administration) |
| `bid-hit-rate.tsx` | `/bids/analytics` | Bid analytics (shared with Sales) |
| `hustler-benchmarking.tsx` | `/hustler/benchmarking` | Cross-org benchmarking (HUSTLER only) |

### Key Component Directories (`client/src/components/`)
- `reports/` — cost reports, estimate reports, report export bar, utilities
- `KPICard.tsx` — KPI display card
- `JobProgressBar.tsx` — job progress visualisation
- `HealthScoreBadge.tsx` — project health score badge
- `dashboard-widgets/` — report widget implementations (shared with Home)

### Backend Route Files (`server/`)
- `server/reportRoutes.ts` — report generation and export (CSV, PDF)
- `server/kpiRoutes.ts` — KPI templates, assignments, and snapshots
- `server/projectReportRoutes.ts` — per-project report data
- `server/auditExportRoutes.ts` — audit log CSV export
- `server/crmCustomReportsRoutes.ts` — custom CRM reports
- `server/bidAnalyticsRoutes.ts` — bid analytics (shared with Sales)
- `server/safetyKpiRoutes.ts` — safety KPI reporting
- `server/jobMetricAlertRulesRoutes.ts`, `server/jobMetricAlertEventsRoutes.ts` — metric-based alerts
- `server/executiveDigestRoutes.ts` — executive digest (shared with Home)

### Shared Schema Files (`shared/schema/features/`)
- `reports.ts` — project health/profitability/KPI snapshots, executive digests
- `kpi.ts` — KPI templates, assignments, and entries
- `financial.ts` — revenue recognition, WIP data (shared with Finance)

### Access Roles
| Role | Access |
|---|---|
| ADMIN, MANAGER, ESTIMATOR, SUPERINTENDENT, HUSTLER | Full reports access |
| FIELD_WORKER | No access |
| VENDOR | No access |

---

*Last updated: June 2026. When adding a new page, component directory, route file, or schema table, update the relevant module section here.*
