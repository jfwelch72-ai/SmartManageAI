# dashboard — Dashboard Widgets, Portfolio View, CFO Dashboard, Executive Digest, KPI Snapshots

## Overview

The dashboard module provides role-specific landing pages with configurable widget grids. Users can rearrange, resize, and toggle widgets. The portfolio view aggregates across all projects for ADMIN/MANAGER users. The CFO dashboard adds financial-focus widgets (cash position, SOV progress, billing hub). The executive digest is an AI-generated daily briefing. KPI snapshots persist point-in-time metrics for trend charting.

## Data Models

**Key tables (`shared/schema/features/user_settings.ts`, `shared/schema/features/reports.ts`, `shared/schema/features/kpi.ts`)**

| Table | Description |
|---|---|
| `user_dashboard_layouts` | JSON widget grid config per user per org; `layoutConfig: DashboardLayoutConfig` |
| `user_dashboard_permissions` | Per-user granular feature permission overrides (75+ boolean fields + `projectScope`) |
| `user_color_palettes` | Per-user chart color palette selection |
| `org_color_palettes` | Org-level default color palettes |
| `permission_presets` | Reusable permission bundles that ADMIN can apply to multiple users |
| `project_health_snapshots` | Nightly/weekly snapshots of project budget, schedule, and safety metrics |
| `kpi_templates` | Library of KPI definitions (formula, target, unit) |
| `kpi_assignments` | Links a `kpi_template` to an org/user/project |
| `kpi_entries` | Periodic KPI values (actual vs. target) |
| `executive_digests` | AI-generated HTML digest records with `generatedAt`, `orgId`, `content` |

## Backend Routes

**File: `server/dashboardRoutes.ts`** (≈ 5,175 lines — consolidated from many sub-files):
| Method | Path | Description | Auth |
|---|---|---|---|
| GET | `/api/dashboard/stats` | Org-level KPI summary (active projects, open bids, labor this week) | `requireAuth` |
| GET | `/api/dashboard/kpi` | KPI dashboard metrics | `requireAuth` |
| GET | `/api/dashboard/snapshot` | Executive project health snapshot | `requireRole('ADMIN','MANAGER','SUPERINTENDENT')` |
| POST | `/api/dashboard/aggregate-time-tracking` | Aggregated time-tracking data for date range | `requireRole('ADMIN','MANAGER','SUPERINTENDENT')` |
| GET | `/api/dashboard/trend` | Month-over-month trend data | `requireAuth` |
| GET | `/api/dashboard/list` | List-view dashboard data | `requireAuth` |
| GET | `/api/dashboard/alerts` | Active budget / schedule / compliance alerts | `requireAuth` |
| GET | `/api/dashboard/workforce-snapshot` | Headcount, attendance, labor cost metrics | `requireFeaturePermission('canManagePayroll')` |
| GET | `/api/dashboard/cash-position` | Open invoices, retention, projected cash flow | `requireFeaturePermission('canViewFinancials')` |
| GET | `/api/dashboard/sov-progress` | SOV billing percent complete across projects | `requireFeaturePermission('canViewFinancials')` |
| GET | `/api/dashboard/bid-pipeline` | Bids by status, weighted pipeline value | `requireAuth` |
| GET | `/api/dashboard/cost-code-breakdown` | Cost breakdown by cost code / category | `requireFeaturePermission('canViewFinancials')` |
| GET | `/api/dashboard/schedule-impact` | Critical path delays and float consumption | `requireAuth` |
| GET | `/api/dashboard/labor-utilization` | Hours by worker/crew vs. budget | `requireFeaturePermission('canManagePayroll')` |
| GET | `/api/dashboard/safety-summary` | OSHA recordable rate, open incidents, training compliance | `requireAuth` |
| GET | `/api/dashboard/change-orders-pending` | Pending CO dollar exposure | `requireFeaturePermission('canViewFinancials')` |
| GET | `/api/dashboard/permissions` | Returns all user permission sets for org | `requireRole('ADMIN','SUPER_ADMIN','HUSTLER')` |
| POST | `/api/dashboard/permissions/:userId` | Sets per-user permission overrides | `requireRole('ADMIN','SUPER_ADMIN','HUSTLER')` |
| GET | `/api/dashboard/layouts` | Returns current user's widget layout | `requireAuth` |
| PUT | `/api/dashboard/layouts` | Saves widget layout | `requireAuth` |

**File: `server/executiveDigestRoutes.ts`**
| Method | Path | Description |
|---|---|---|
| GET | `/api/executive-digest/latest` | Returns latest AI digest for org |
| POST | `/api/executive-digest/generate` | Triggers AI digest generation (ADMIN only) |

**File: `server/kpiRoutes.ts`**
| Method | Path | Description |
|---|---|---|
| GET | `/api/kpis/templates` | Lists KPI templates |
| POST | `/api/kpis/assignments` | Assigns KPI to org/user |
| POST | `/api/kpis/entries` | Records a KPI value |
| GET | `/api/kpis/dashboard` | Returns current KPI values for org |

**File: `server/portfolioRoutes.ts`**
| Method | Path | Description |
|---|---|---|
| GET | `/api/portfolio/summary` | Multi-project portfolio summary |
| GET | `/api/portfolio/map` | GeoJSON project locations for map view |

## Frontend Pages & Components

| Route | Page File | Description |
|---|---|---|
| `/dashboard` | `client/src/pages/dashboard.tsx` | Widget grid dashboard; all roles |
| `/portfolio` | `client/src/pages/portfolio.tsx` | Portfolio overview map + list; ADMIN / MANAGER |

Key components: `DashboardWidget`, `DraggableGrid`, `WidgetPicker`, `CfoWidget`, `BidPipelineWidget`, `SafetyWidget`, `LaborWidget`, `CashPositionWidget`.

## Roles & Permissions

| Feature | Gate |
|---|---|
| Dashboard access | `canAccessDashboard` (all roles except VENDOR) |
| Portfolio view | `canViewPortfolio` — ADMIN, MANAGER, HUSTLER |
| CFO dashboard | `canAccessCFODashboard` — ADMIN, MANAGER, SUPERINTENDENT |
| Executive digest | `canAccessExecutiveDigest` — ADMIN, MANAGER |
| Financials widgets | `canViewFinancials` |
| Workforce widgets | `canManagePayroll` |
| Manage permissions | `requireRole('ADMIN', 'SUPER_ADMIN', 'HUSTLER')` |

## Integration Points

- **`server/dashboardDefaults.ts`** — `KNOWN_WIDGET_TYPES`, `getDefaultLayoutForRole()`, `migrateV2ToV3()` layout migration helper
- **`orgScopedCache`** — short-lived in-process cache for org-level dashboard stats to reduce DB load
- **Executive digest** — calls Anthropic Claude via `governedAiCall()`; digest stored in `executive_digests` table
- **KPI module** — `kpiRoutes.ts` is mounted at `/api/kpis` and cross-links to project schedules, payroll, and safety
- **`isFeatureEnabled()`** — `server/services/featureFlagService.ts` gates CFO dashboard and portfolio widgets by feature flag
