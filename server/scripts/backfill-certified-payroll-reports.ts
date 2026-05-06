/**
 * One-shot backfill: scan object storage for certified payroll PDFs that were
 * generated *before* the `certified_payroll_reports` audit table existed and
 * insert matching rows so the project history tab shows them.
 *
 * Object key layout (both legacy and current writers are handled):
 *   <PRIVATE_OBJECT_DIR>/<orgId>/payroll/certified/<payRunId>/<projectId|all>/<filename>.pdf
 *
 * Where <filename> is one of:
 *   - "<variant>.pdf"              (legacy writer, no per-export reportId)
 *   - "<reportId>_<variant>.pdf"   (current writer)
 *
 * For each matching object we insert a `certified_payroll_reports` row with:
 *   - fileSize taken from the GCS object metadata (`size`)
 *   - generatedAt taken from the GCS object `timeCreated`
 *   - generatedById left NULL (the original generator is not recoverable)
 *
 * Idempotent: existing object_keys are skipped. Re-run safely.
 *
 * Usage:
 *   npx tsx server/scripts/backfill-certified-payroll-reports.ts            # all orgs, real run
 *   npx tsx server/scripts/backfill-certified-payroll-reports.ts --dry-run  # report only
 *   npx tsx server/scripts/backfill-certified-payroll-reports.ts --org=<id> # single org
 *
 * Programmatic use: see `runCertifiedPayrollBackfill` below — the post-deploy
 * one-shot runner in `server/utils/runCertifiedPayrollBackfillOnce.ts` calls
 * it directly so every tenant gets backfilled without an admin running tsx.
 */

import { logInfo, logError } from "../utils/logger";
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db, pool } from "../db";
import { certifiedPayrollReports, organizations, payRuns } from "@shared/schema";
import { payrollFormVariantValues, type PayrollFormVariant } from "@shared/schema/enums";
import { objectStorageClient } from "../objectStorage";

export interface BackfillOptions {
  dryRun?: boolean;
  orgFilter?: string | null;
}

export interface BackfillStats {
  inserted: number;
  alreadyPresent: number;
  missingPayRun: number;
  skippedNonMatching: number;
  totalListed: number;
  orgsScanned: number;
  dryRun: boolean;
  skippedReason?: "no_private_dir";
}

interface CliOptions {
  dryRun: boolean;
  orgFilter: string | null;
}

function parseArgs(argv: string[]): CliOptions {
  const dryRun = argv.includes("--dry-run");
  const orgArg = argv.find((a) => a.startsWith("--org="));
  const orgFilter = orgArg ? orgArg.slice("--org=".length).trim() || null : null;
  return { dryRun, orgFilter };
}

interface ParsedKey {
  orgId: string;
  payRunId: string;
  projectId: string | null; // null when the directory segment is "all"
  variant: PayrollFormVariant;
}

const VARIANT_SET = new Set<string>(payrollFormVariantValues);

/**
 * Parse a relative key (path *under* the private dir prefix) of the form:
 *   <orgId>/payroll/certified/<payRunId>/<projectIdOrAll>/<filename>.pdf
 * Returns null if the key does not match.
 */
function parseRelativeKey(relativeKey: string): ParsedKey | null {
  const parts = relativeKey.split("/");
  if (parts.length !== 6) return null;
  const [orgId, payroll, certified, payRunId, projectSegment, filename] = parts;
  if (payroll !== "payroll" || certified !== "certified") return null;
  if (!filename.toLowerCase().endsWith(".pdf")) return null;

  const base = filename.slice(0, -".pdf".length);
  // Filename is either "<variant>" (legacy writer) or "<reportId>_<variant>"
  // (current writer). Variants themselves can contain underscores
  // (e.g. "WH_347", "ODOT_CA_D_9C", "CALTRANS_CEM_2502") so we can't simply
  // split on the last underscore — match by checking known variants as
  // either a full match or a "_<variant>" suffix.
  let variantStr: string | null = null;
  if (VARIANT_SET.has(base)) {
    variantStr = base;
  } else {
    for (const v of payrollFormVariantValues) {
      if (base.endsWith(`_${v}`)) {
        variantStr = v;
        break;
      }
    }
  }
  if (!variantStr) return null;

  return {
    orgId,
    payRunId,
    projectId: projectSegment === "all" ? null : projectSegment,
    variant: variantStr as PayrollFormVariant,
  };
}

/**
 * Run the certified-payroll backfill. Returns a stats object describing what
 * was inserted/skipped. Safe to call repeatedly — existing object_keys are
 * always skipped. When PRIVATE_OBJECT_DIR is unset, returns immediately with
 * `skippedReason="no_private_dir"` instead of throwing, so the post-deploy
 * runner can no-op cleanly in environments that don't use object storage.
 */
export async function runCertifiedPayrollBackfill(
  options: BackfillOptions = {},
): Promise<BackfillStats> {
  const dryRun = !!options.dryRun;
  const orgFilter = options.orgFilter ?? null;

  const stats: BackfillStats = {
    inserted: 0,
    alreadyPresent: 0,
    missingPayRun: 0,
    skippedNonMatching: 0,
    totalListed: 0,
    orgsScanned: 0,
    dryRun,
  };

  const privateDir = process.env.PRIVATE_OBJECT_DIR || "";
  if (!privateDir) {
    stats.skippedReason = "no_private_dir";
    return stats;
  }

  const rawParts = privateDir.replace(/^\//, "").split("/");
  const bucketName = rawParts[0];
  const prefixPath = rawParts.slice(1).join("/");
  const basePrefix = prefixPath ? `${prefixPath}/` : "";

  // Determine the set of org IDs to scan. Listing one tenant subtree at a time
  // (instead of the whole private bucket) keeps each call bounded for large
  // production buckets.
  let orgIds: string[];
  if (orgFilter) {
    orgIds = [orgFilter];
  } else {
    const orgRows = await db.select({ id: organizations.id }).from(organizations);
    orgIds = orgRows.map((r) => r.id);
  }
  logInfo(`[backfill-cpr] bucket=${bucketName} basePrefix=${basePrefix} orgs=${orgIds.length} dryRun=${dryRun}`);

  const bucket = objectStorageClient.bucket(bucketName);

  // Bucket the discovered keys by orgId so we can validate pay runs in batches.
  type Candidate = { fullKey: string; relative: string; parsed: ParsedKey; size: number; createdAt: Date };
  const candidatesByOrg = new Map<string, Candidate[]>();

  for (const orgId of orgIds) {
    const listPrefix = `${basePrefix}${orgId}/payroll/certified/`;
    const [files] = await bucket.getFiles({ prefix: listPrefix });
    if (files.length === 0) continue;
    stats.totalListed += files.length;

    for (const file of files) {
      const gcsName = file.name;
      if (!gcsName.toLowerCase().endsWith(".pdf")) {
        stats.skippedNonMatching++;
        continue;
      }
      const relative = basePrefix && gcsName.startsWith(basePrefix)
        ? gcsName.slice(basePrefix.length)
        : gcsName;
      const parsed = parseRelativeKey(relative);
      if (!parsed) {
        stats.skippedNonMatching++;
        continue;
      }
      // Defensive: GCS only returned objects under this org's prefix, but skip
      // anything whose parsed orgId disagrees (e.g. surprising bucket layout).
      if (parsed.orgId !== orgId) {
        stats.skippedNonMatching++;
        continue;
      }

      // Object key as recorded by the writer (leading slash + bucket).
      const fullKey = `/${bucketName}/${gcsName}`;

      const meta: { size?: string | number; timeCreated?: string; updated?: string } = file.metadata ?? {};
      const sizeRaw = meta.size;
      const size = typeof sizeRaw === "string" ? parseInt(sizeRaw, 10) : Number(sizeRaw ?? 0);
      const createdRaw = meta.timeCreated ?? meta.updated;
      const createdAt = createdRaw ? new Date(createdRaw) : new Date();

      const list = candidatesByOrg.get(parsed.orgId) || [];
      list.push({ fullKey, relative, parsed, size: Number.isFinite(size) ? size : 0, createdAt });
      candidatesByOrg.set(parsed.orgId, list);
    }
  }
  stats.orgsScanned = candidatesByOrg.size;
  logInfo(`[backfill-cpr] listed ${stats.totalListed} object(s) across ${stats.orgsScanned} org(s) with PDFs`);

  for (const [orgId, candidates] of candidatesByOrg) {
    if (candidates.length === 0) continue;

    // Existing rows for this org keyed by objectKey — for idempotency.
    const existingKeysRows = await db
      .select({ objectKey: certifiedPayrollReports.objectKey })
      .from(certifiedPayrollReports)
      .where(eq(certifiedPayrollReports.organizationId, orgId));
    const existingKeys = new Set(existingKeysRows.map((r) => r.objectKey));

    // Verify pay runs really belong to this org so we don't insert orphan rows
    // pointing at pay runs from a deleted/wrong tenant.
    const uniquePayRunIds = Array.from(new Set(candidates.map((c) => c.parsed.payRunId)));
    const validPayRunRows = uniquePayRunIds.length
      ? await db
          .select({ id: payRuns.id })
          .from(payRuns)
          .where(and(inArray(payRuns.id, uniquePayRunIds), eq(payRuns.organizationId, orgId)))
      : [];
    const validPayRunIds = new Set(validPayRunRows.map((r) => r.id));

    const toInsert: typeof certifiedPayrollReports.$inferInsert[] = [];
    for (const c of candidates) {
      if (existingKeys.has(c.fullKey)) {
        stats.alreadyPresent++;
        continue;
      }
      if (!validPayRunIds.has(c.parsed.payRunId)) {
        stats.missingPayRun++;
        continue;
      }
      toInsert.push({
        id: randomUUID(),
        organizationId: orgId,
        payRunId: c.parsed.payRunId,
        projectId: c.parsed.projectId,
        variant: c.parsed.variant,
        objectKey: c.fullKey,
        fileSize: c.size,
        generatedById: null,
        generatedAt: c.createdAt,
      });
    }

    if (toInsert.length === 0) continue;

    if (dryRun) {
      logInfo(`[backfill-cpr] org=${orgId} would insert ${toInsert.length} row(s)`);
      stats.inserted += toInsert.length;
      continue;
    }

    // Chunk inserts to keep parameter counts sane.
    const CHUNK = 500;
    for (let i = 0; i < toInsert.length; i += CHUNK) {
      const slice = toInsert.slice(i, i + CHUNK);
      await db.insert(certifiedPayrollReports).values(slice);
      stats.inserted += slice.length;
    }
    logInfo(`[backfill-cpr] org=${orgId} inserted ${toInsert.length} row(s)`);
  }

  logInfo(
    `[backfill-cpr] done. inserted=${stats.inserted} alreadyPresent=${stats.alreadyPresent} ` +
      `missingPayRun=${stats.missingPayRun} skippedNonMatching=${stats.skippedNonMatching} dryRun=${dryRun}`,
  );

  return stats;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const stats = await runCertifiedPayrollBackfill(opts);
  if (stats.skippedReason === "no_private_dir") {
    logError("PRIVATE_OBJECT_DIR is not set; nothing to scan.");
    process.exit(1);
  }
}

// Only run as a CLI when invoked directly (e.g. `npx tsx`). Importing this
// file from the startup runner must NOT close the shared pg pool.
const isDirectInvocation = (() => {
  try {
    const entry = process.argv[1] || "";
    return entry.endsWith("backfill-certified-payroll-reports.ts")
      || entry.endsWith("backfill-certified-payroll-reports.js");
  } catch {
    return false;
  }
})();

if (isDirectInvocation) {
  main()
    .catch((err) => {
      logError("[backfill-cpr] failed", err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end().catch(() => {});
    });
}
