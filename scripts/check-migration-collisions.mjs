#!/usr/bin/env node
// Task #2685 — Migration collision prevention guard.
//
// Drizzle / `runStartupMigrations.ts` apply migrations in filename order, so
// two files sharing the same 4-digit prefix is a latent bug — they will be
// applied in lexicographic order on every fresh DB but in `__drizzle_
// migrations` insertion order on long-lived ones, and the runtime helper
// manifest in `server/utils/migrationStartupCoverage.ts` keys on the full
// filename. This guard fails the build if any new file lands in
// `migrations/` whose 4-digit prefix is shared with another file, minus an
// explicit allowlist of the 20 historical duplicates that exist today.
//
// As historical duplicates are renumbered (Task #2435), delete their entry
// from KNOWN_DUPLICATES below so the guard tightens automatically.
//
// Resolution playbook: docs/ops/migration-collisions.md
//
// Run directly:
//   node scripts/check-migration-collisions.mjs

import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const MIGRATIONS_DIR = path.join(ROOT, "migrations");

// Historical duplicates that pre-date this guard. They are tracked for
// renumbering in Task #2435; until that lands, the guard tolerates exactly
// these prefix → filename groupings and nothing else. Anything new collides
// → CI fails.
//
// TODO(#2435): remove entries below as the duplicates are renumbered.
export const KNOWN_DUPLICATES = {
  "0001": [
    "0001_add_estimate_line_item_subcontractors.sql",
    "0001_marvelous_anita_blake.sql",
  ],
  "0002": [
    "0002_add_change_order_cost_breakdown.sql",
    "0002_clumsy_jackpot.sql",
  ],
  "0003": [
    "0003_add_talent_pool_and_pipeline_stages.sql",
    "0003_tricky_captain_flint.sql",
  ],
  "0004": [
    "0004_add_overhead_enhancements.sql",
    "0004_sweet_vargas.sql",
  ],
  "0005": [
    "0005_add_leave_management.sql",
    "0005_dusty_kulan_gath.sql",
  ],
  "0012": [
    "0012_add_expected_delivery_date.sql",
    "0012_tm_workflow_enhancements.sql",
  ],
  "0013": [
    "0013_equipment_depreciation_fuel_logs.sql",
    "0013_messaging_entity_linking.sql",
  ],
  "0016": [
    "0016_add_cost_transactions.sql",
    "0016_calendar_cleanup.sql",
  ],
  "0030": [
    "0030_geocode_status_columns.sql",
    "0030_project_email_distribution_lists.sql",
  ],
  "0036": [
    "0036_crm_call_recording_storage_key.sql",
    "0036_crm_calls_owner_and_follow_up.sql",
  ],
  "0037": [
    "0037_backfill_summary_preferences.sql",
    "0037_crm_transcript_backfill_test_alerts.sql",
  ],
  "0038": [
    "0038_alert_failure_fallback_prefs.sql",
    "0038_crm_transcript_backfill_canceller.sql",
  ],
  "0055": [
    "0055_integration_suppression_resets.sql",
    "0055_wage_decision_rate_change_acknowledgements.sql",
  ],
  "0058": [
    "0058_portal_token_lookup_hash.sql",
    "0058_project_log_email_attempt_tracking.sql",
  ],
  "0072": [
    "0072_access_requests.sql",
    "0072_audit_action_bulk.sql",
  ],
  "0075": [
    "0075_ai_takeoff_suggestions.sql",
    "0075_takeoff_measurement_scale_lock.sql",
  ],
  "0096": [
    "0096_enable_tenant_rls.sql",
    "0096_support_tickets.sql",
  ],
  "0097": [
    "0097_coi_compliance_lifecycle.sql",
    "0097_org_lifecycle.sql",
  ],
  "0103": [
    "0103_ai_estimator_max_discipline_batches.sql",
    "0103_ai_takeoff_revisions.sql",
    "0103_sheet_review_queue.sql",
  ],
  "0104": [
    "0104_ai_takeoff_calibration_loop.sql",
    "0104_takeoff_measurements_versioning.sql",
  ],
};

const PREFIX_RE = /^(\d{4})_/;

function listSqlFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

function groupByPrefix(files) {
  const groups = new Map();
  for (const f of files) {
    const m = PREFIX_RE.exec(f);
    if (!m) continue;
    const prefix = m[1];
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix).push(f);
  }
  return groups;
}

const files = listSqlFiles();
const groups = groupByPrefix(files);

const newCollisions = [];
const staleAllowlist = [];

for (const [prefix, group] of groups) {
  if (group.length < 2) continue;
  const expected = KNOWN_DUPLICATES[prefix];
  const sortedGroup = [...group].sort();
  if (!expected) {
    newCollisions.push({ prefix, files: sortedGroup });
    continue;
  }
  const sortedExpected = [...expected].sort();
  if (
    sortedGroup.length !== sortedExpected.length ||
    sortedGroup.some((f, i) => f !== sortedExpected[i])
  ) {
    newCollisions.push({
      prefix,
      files: sortedGroup,
      expected: sortedExpected,
    });
  }
}

// Allowlist entries whose duplicate is gone (i.e. the renumbering happened
// but the allowlist wasn't trimmed) should be flagged so the guard tightens.
for (const [prefix, expected] of Object.entries(KNOWN_DUPLICATES)) {
  const group = groups.get(prefix) ?? [];
  if (group.length < 2) {
    staleAllowlist.push({ prefix, expected, actual: group });
  }
}

if (newCollisions.length === 0 && staleAllowlist.length === 0) {
  process.stdout.write(
    `[check-migration-collisions] OK — ${files.length} migration file(s), ${Object.keys(KNOWN_DUPLICATES).length} known historical duplicate prefix(es) tolerated.\n`,
  );
  process.exit(0);
}

if (newCollisions.length > 0) {
  process.stderr.write(
    `[check-migration-collisions] FAIL — ${newCollisions.length} new collision(s) detected:\n`,
  );
  for (const c of newCollisions) {
    process.stderr.write(`  - prefix ${c.prefix}:\n`);
    for (const f of c.files) process.stderr.write(`      • ${f}\n`);
    if (c.expected) {
      process.stderr.write(`    Allowlisted set was:\n`);
      for (const f of c.expected) process.stderr.write(`      • ${f}\n`);
    }
  }
}

if (staleAllowlist.length > 0) {
  process.stderr.write(
    `[check-migration-collisions] FAIL — ${staleAllowlist.length} stale allowlist entr(y/ies) (renumbering happened — trim KNOWN_DUPLICATES):\n`,
  );
  for (const s of staleAllowlist) {
    process.stderr.write(
      `  - prefix ${s.prefix}: allowlist expected ${s.expected.length} files, found ${s.actual.length}\n`,
    );
  }
}

process.stderr.write(
  "\nGenerate the next free prefix with:  node scripts/new-migration.mjs <slug>\n" +
    "Resolution playbook: docs/ops/migration-collisions.md\n",
);
process.exit(1);
