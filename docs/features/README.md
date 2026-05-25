# SmartManageAI — Feature Module Documentation

This directory contains deep technical documentation for every major feature domain in the platform. Each file covers data models, backend routes, frontend pages, role/permission gating, and integration points.

## Modules

| Module | File | Description |
|---|---|---|
| [auth](./auth.md) | `auth.md` | Authentication, sessions, MFA, SSO, password reset, token versioning |
| [onboarding](./onboarding.md) | `onboarding.md` | AI-assisted onboarding wizard, org setup flow |
| [dashboard](./dashboard.md) | `dashboard.md` | Dashboard widgets, portfolio view, CFO dashboard, executive digest, KPI snapshots |
| [estimating](./estimating.md) | `estimating.md` | Bid lifecycle, estimate versions, vendor quotes, bid wizard, hit-rate analytics, cost book, price book |
| [takeoff](./takeoff.md) | `takeoff.md` | Takeoff workspace, sheet management, measurements, assemblies, AI takeoff, calibration, review queue |
| [projects](./projects.md) | `projects.md` | Project CRUD, project detail tabs, tasks, schedule (Gantt/CPM), project templates, project health snapshots |
| [field-ops](./field-ops.md) | `field-ops.md` | Daily reports, time clock, time entry, dispatch board, field productivity, issue captures |
| [financials](./financials.md) | `financials.md` | Schedule of Values, AIA progress billing (G702/G703), payroll (certified, WH-347), cost ledger, WIP report, revenue recognition, unified payments, lien waivers |
| [procurement](./procurement.md) | `procurement.md` | Purchase requisitions, purchase orders, receipts, invoices, 3-way match |
| [document-control](./document-control.md) | `document-control.md` | RFIs, submittals, transmittals, drawing sets, contracts, closeout packages |
| [heavy-civil-dot](./heavy-civil-dot.md) | `heavy-civil-dot.md` | DOT library, pay items, haul tickets, daily inspector reports, SWPPP, DBE goals, surety bonds, material certifications |
| [crm](./crm.md) | `crm.md` | Contacts, organisations, deal pipeline, calls, quotes, email threads, sequences, automations, lead forms, quote acceptance portal |
| [equipment](./equipment.md) | `equipment.md` | Fleet management, assignments, repairs, maintenance history, rental catalog, CSV import/export |
| [inventory](./inventory.md) | `inventory.md` | Locations, materials, stock levels, transactions, cycle counts |
| [safety](./safety.md) | `safety.md` | Safety incidents, OSHA tracking, quality issues, safety training, toolbox talks, checklist instances, PPE |
| [workforce](./workforce.md) | `workforce.md` | Crews, skills, certifications, talent pool, hiring (ATS), performance reviews, attendance, leave management |
| [messaging](./messaging.md) | `messaging.md` | Conversations, participants, messages, reactions, video calls, real-time delivery, typing indicators, pagination |
| [notifications](./notifications.md) | `notifications.md` | Notification delivery framework, email, web push, SMS, Slack/Teams channel integration, approval workflow notifications |
| [portals](./portals.md) | `portals.md` | Unified portal, client portal, sub/vendor portal, portal chat, portal activity log, public booking/form pages |
| [website-builder](./website-builder.md) | `website-builder.md` | Org websites, pages, blog posts, social media posts, deployments, SEO |
| [integrations](./integrations.md) | `integrations.md` | QuickBooks Online, Sage, Autodesk, Zapier webhooks, OAuth connections, sync state, account mappings |
| [ai-orchestration](./ai-orchestration.md) | `ai-orchestration.md` | AI provider routing, prompt injection guard, document analysis, AI estimator skills, AI governance, voice logs, takeoff AI, onboarding AI |
| [platform-admin](./platform-admin.md) | `platform-admin.md` | Super admin dashboard, org management, impersonation, feature flags, billing, audit logs, support tickets, job queue, one-shot jobs, analytics monitoring |
| [vendor-marketplace](./vendor-marketplace.md) | `vendor-marketplace.md` | Bid network, marketplace, vendor workspace, vendor scores, vendor pricing catalog, Hustler (multi-org oversight) module |

## Conventions

- **Roles** are one of: `SUPER_ADMIN`, `ADMIN`, `HUSTLER`, `MANAGER`, `SUPERINTENDENT`, `ESTIMATOR`, `FIELD_WORKER`, `VENDOR`
- **Feature permissions** (`canXxx`) are per-user flags layered on top of role defaults; managed via `user_dashboard_permissions`
- **Tenant isolation** is enforced by `getOrgIdForFilter()` in every route handler + Postgres RLS (`app.current_org_id`)
- **Audit trail** — money-path mutations write to `audit_log` via `logCreate / logUpdate / logApprove`
- **Object storage** — files are stored in GCS under `${organizationId}/` prefixes; signed URLs only (5-min GET, 15-min PUT)

## See Also

- Architecture decisions: `docs/architecture/decisions.md`
- Tenant isolation (RLS): `docs/architecture/tenant-isolation.md`
- AI provider routing: `docs/architecture/ai-provider-routing.md`
- Storage seam pattern: `docs/architecture/storage-pattern.md`
- Security quick reference: `docs/ops/security-quickref.md`
