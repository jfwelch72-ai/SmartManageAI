// AUTO-GENERATED — Task #2426: shared/schema/features.ts was 11,535 lines and 375 tables.
// It was split into per-domain files by walking each top-level export and bucketing
// it according to its name (see scripts/split-features.cjs). Re-exports preserve every
// symbol the old features.ts exported so all "@shared/schema" imports keep working.
//
// Bucketing rule:
//   ai            → AI runs/tasks/insights/recommendations + bid/contract doc analysis
//   ai_estimator  → AI Estimator workspace tables
//   campaigns     → Email marketing campaigns
//   compliance    → Approvals, retention, GDPR, SSO, sessions, addenda, audit, risks
//   contracts     → Contract management + e-signature
//   crew          → Crews, skills, user certifications/photos
//   crm           → CRM org/contact/quote/sequence/call/transcript/lead-scoring
//   dot           → Heavy Civil & DOT (DBE, surety, haul tickets, IDR, SWPPP, mat certs)
//   drawings      → Drawing sets
//   email         → External email (org email accounts, threads, tasks, attachments)
//   equipment     → Equipment catalog/assignments/repairs/maintenance + rentals
//   estimate      → Estimating engine (settings, crews, versions, history)
//   financial     → SOV, pay apps, lien waivers, retention releases, unified payments,
//                   revenue recognition, overhead costs
//   flags         → FEATURE_FLAG_* constants + feature flag preset/manual change tables
//   hiring        → Hiring module + talent profiles
//   hustler       → Hustler organizations / delegates / network
//   integrations  → Integration connections, sync state, webhooks, QBO, Sage, Zapier,
//                   Davis-Bacon rate change tables
//   kpi           → KPI templates/assignments/entries
//   library       → Custom library + assemblies
//   lidar         → LiDAR scans / annotations / comparisons
//   messaging     → Conversations, messages, video calls
//   mobile        → Mobile devices + offline sync
//   org_catalog   → Trade templates/features, org calculators/work types/SOW items,
//                   units of measure, master catalogs, object ACL
//   performance   → Employee ratings/reviews/peer ratings, attendance, supervisor notes
//   portal        → Subcontractor & client portal access + portal chat
//   reports       → Project health/profitability/KPI snapshots, executive digests
//   rfi           → RFIs, submittals, transmittals, project log email schedules
//   safety        → Safety trainings, observations, OSHA incidents, toolbox talks
//   schedule      → Project schedules (Gantt/CPM) + PDF alert tables
//   subcontractor → Subcontractor management & sub bid invitations
//   takeoff       → Takeoff workspace (sheets, measurements, BIM, scope, modifiers)
//   user_settings → User dashboard, saved views, color palettes, settings, activity
//   vendor_pricing→ Vendor pricing catalogs, enrollments, pricebooks, scoring
//   website       → White-label website builder, blog, social posts, analytics
//   workflows     → No-code workflow builder
//   misc          → Anything else (kept small)

export * from "./ai";
export * from "./ai_estimator";
export * from "./enrichment";
export * from "./closeout";
export * from "./cost_book";
export * from "./estimating_crew";
export * from "./estimate_pricing";
export * from "./orgLifecycle";
export * from "./compliance";
export * from "./contracts";
export * from "./crew";
export * from "./crm";
export * from "./dot";
export * from "./drawings";
export * from "./email";
export * from "./equipment";
export * from "./estimate";
export * from "./financial";
export * from "./flags";
export * from "./hiring";
export * from "./hustler";
export * from "./inventory";
export * from "./integrations";
export * from "./kpi";
export * from "./library";
export * from "./lidar";
export * from "./messaging";
export * from "./misc";
export * from "./support";
export * from "./mobile";
export * from "./mobileSync";
export * from "./org_catalog";
export * from "./performance";
export * from "./portal";
export * from "./reports";
export * from "./rfi";
export * from "./safety";
export * from "./schedule";
export * from "./subcontractor";
export * from "./takeoff";
export * from "./user_settings";
export * from "./vendor_pricing";
export * from "./website";
export * from "./workflows";
