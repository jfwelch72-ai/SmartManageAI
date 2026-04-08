# JSON Text Fields Migration Plan

## Overview
Several tables store structured data as JSON text strings instead of proper relational columns. This document audits those fields, assesses their impact, and provides a prioritized migration plan.

## Audit of JSON Text Fields

### HIGH PRIORITY (Queries filter/join on these fields)

| Table | Column | Content | Impact | Recommendation |
|-------|--------|---------|--------|----------------|
| `tm_tickets` | `scope_modifier_ids` | JSON array of modifier IDs | Used for production rate tracking and AI analysis | Normalize into junction table `tm_ticket_scope_modifiers(ticket_id, modifier_id)` |
| `tm_tickets` | `scope_modifier_names` | JSON array of modifier display names | Redundant with IDs; used in UI display | Can be derived via join after normalizing IDs; remove field |
| `ai_insights` | `affected_entities` | JSON string of related entity IDs | Needed for cross-entity queries (e.g., "find all insights for entity X") | Normalize into `ai_insight_entities(insight_id, entity_type, entity_id)` |
| `ai_insights` | `action_items` | JSON array of specific actions | Queried for pending action items | Normalize into `ai_insight_action_items(insight_id, description, status)` |

### MEDIUM PRIORITY (Parsed in application code but not queried/filtered in DB)

| Table | Column | Content | Impact | Recommendation |
|-------|--------|---------|--------|----------------|
| `ai_bid_document_analysis` | `line_items` | JSON array of extracted bid line items | Parsed for display, could benefit from normalization for bid comparison | Consider junction table if cross-bid line item queries are needed |
| `ai_bid_document_analysis` | `requirements` | JSON array of requirements | Parsed for display | Keep as JSON; low query impact |
| `ai_bid_document_analysis` | `risk_factors` | JSON array of risks | Parsed for display | Keep as JSON |
| `ai_contract_document_analysis` | `scope_items` | JSON array of scope items | Parsed for display | Keep as JSON |
| `ai_contract_document_analysis` | `milestones` | JSON array of milestones | Parsed for display/timeline | Keep as JSON unless milestone tracking is added |
| `ai_contract_document_analysis` | `key_terms` | JSON array of terms | Parsed for display | Keep as JSON |
| `ai_contract_document_analysis` | `risk_factors` | JSON array of risks | Parsed for display | Keep as JSON |
| `ai_contract_document_analysis` | `obligations` | JSON array of obligations | Parsed for display | Keep as JSON |
| `ai_gantt_recommendations` | `suggested_tasks` | JSON array of task suggestions | Parsed when applying recommendations | Keep as JSON |
| `ai_gantt_recommendations` | `suggested_dependencies` | JSON array of dependencies | Parsed when applying recommendations | Keep as JSON |
| `ai_vendor_comparisons` | `analysis_data` | JSON with vendor comparisons | Parsed for display | Keep as JSON |
| `estimates` | `alt_prices_json` | JSON alternate pricing | Display only | Keep as JSON |
| `estimates` | `cost_breakdown_json` | JSON cost breakdown | Display only | Keep as JSON |
| `tm_daily_sheets` | `labor_summary_json` | JSON labor summary | Legacy table; display only | Keep as JSON (legacy) |
| `tm_daily_sheets` | `equipment_used_json` | JSON equipment list | Legacy table; display only | Keep as JSON (legacy) |
| `tm_daily_sheets` | `materials_used_json` | JSON material list | Legacy table; display only | Keep as JSON (legacy) |
| `tm_daily_sheets` | `attachments_json` | JSON attachment list | Legacy table; display only | Keep as JSON (legacy) |
| `ai_runs` | `snapshot_data` | JSON snapshot of org data | AI analysis input; never queried | Keep as JSON |
| `ai_runs` | `profitability_data` | JSON profitability snapshot | AI analysis input; never queried | Keep as JSON |
| `ai_runs` | `ai_response` | JSON AI response | Parsed once after run | Keep as JSON |
| `ai_tasks` | `metadata` | JSON task metadata | Contains action hints; loosely structured | Keep as JSON |
| `takeoff_measurements` | `points` | JSON array of coordinate points | Display/rendering only | Keep as JSON |
| `takeoff_measurements` | `deductions` | JSON deduction data | Calculation only | Keep as JSON |
| `takeoff_measurements` | `metadata` | JSON misc metadata | Various uses | Keep as JSON |
| `organizations` | `feature_flags` | JSON feature flag map | Queried frequently but as whole object | Keep as JSON (read/write entire object) |

### LOW PRIORITY (Opaque blobs, not parsed for queries)

| Table | Column | Content | Recommendation |
|-------|--------|---------|----------------|
| `bid_subcontractor_quotes` | `rfq_response_attachments_json` | JSON attachment list | Keep as JSON |
| `ai_bid_document_analysis` | `raw_ai_response` | Raw AI output | Keep as JSON |
| `ai_contract_document_analysis` | `raw_ai_response` | Raw AI output | Keep as JSON |
| `ai_bid_document_analysis` | `suggested_pricing_factors` | JSON pricing factors | Keep as JSON |

## Migration Steps (for HIGH PRIORITY items)

### Phase 1: `tm_tickets.scope_modifier_ids` — COMPLETED
1. ~~Create `tm_ticket_scope_modifiers` junction table~~ — Done (schema + DDL in `ensureScopeModifierTables.ts`)
2. ~~Also created `change_order_scope_modifiers` junction table for the parallel `change_orders` field~~
3. ~~Write migration script to parse existing JSON and populate junction table~~ — Done (backfill runs on startup)
4. ~~Update `tmRoutes.ts` to dual-write to junction table on create/update~~ — Done
5. ~~Update `projectOpsRoutes.ts` to dual-write to junction table on change order create~~ — Done
6. Old JSON columns retained for backward compatibility during transition period
7. Drop `scope_modifier_ids` and `scope_modifier_names` columns after verification period

### Phase 2: `ai_insights.affected_entities`
1. Create `ai_insight_entities` junction table with columns: `insight_id`, `entity_type`, `entity_id`
2. Migrate existing JSON data
3. Update AI insight queries to use the junction table for cross-entity lookups
4. Drop `affected_entities` column after verification

### Phase 3: `ai_insights.action_items`
1. Create `ai_insight_action_items` table with columns: `id`, `insight_id`, `description`, `status`, `created_at`
2. Migrate existing JSON data
3. Update insight detail views and action item tracking
4. Drop `action_items` column after verification

## Notes
- All migrations should be backward-compatible (add new tables first, then migrate data, then update code, then drop old columns)
- Each phase should be tested independently
- JSON columns marked "Keep as JSON" are appropriate because they store opaque structured data that is only read/written as complete objects, not queried or filtered at the field level
