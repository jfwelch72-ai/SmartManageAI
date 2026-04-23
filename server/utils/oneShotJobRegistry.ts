import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError, logInfo } from "./logger";

/**
 * Generic registry for "one-shot" post-deploy backfill jobs.
 *
 * Historically each new one-shot job (Task #1176 certified payroll backfill,
 * Task #1413 exhausted sync retry alerts backfill, ...) needed:
 *   - its own Super-Admin re-run endpoint, and
 *   - its own admin UI card.
 *
 * Task #1448 introduces this registry so new one-shot jobs only need to call
 * `registerOneShotJob` from their runner module. A single generic admin page
 * lists every job alongside its `one_shot_jobs` ledger row and offers a
 * "Clear ledger & re-run" button per job.
 */

export type OneShotJobRunStatus =
  | "completed"
  | "skipped_already_complete"
  | "failed"
  | "bookkeeping_error"
  | "unknown";

export interface OneShotJobRunResult {
  status: OneShotJobRunStatus;
  details?: Record<string, unknown> | null;
  error?: string | null;
}

export interface OneShotJobDescriptor {
  /** The exact `one_shot_jobs.name` ledger key. */
  name: string;
  /** Human-readable title for the admin UI. */
  title: string;
  /** Short description shown beneath the title in the admin UI. */
  description: string;
  /**
   * Re-run the job. Implementations are expected to:
   *   1. Clear the existing ledger row (so the once-runner does work).
   *   2. Invoke the once-runner.
   *   3. Return a normalized result.
   * The registry's `runOneShotJob` helper handles step (1) generically and
   * inspects the post-run ledger row to populate `details`, so most runners
   * only need to call the existing once-runner inside `run`.
   */
  run: () => Promise<OneShotJobRunResult>;
}

const registry = new Map<string, OneShotJobDescriptor>();

export function registerOneShotJob(descriptor: OneShotJobDescriptor): void {
  if (registry.has(descriptor.name)) {
    // Re-registration is harmless (e.g. hot reload in dev) but worth noting.
    logInfo(`[oneShotJobRegistry] re-registering ${descriptor.name}`);
  }
  registry.set(descriptor.name, descriptor);
}

export function getRegisteredOneShotJobs(): OneShotJobDescriptor[] {
  return Array.from(registry.values()).sort((a, b) =>
    a.title.localeCompare(b.title),
  );
}

export function getOneShotJob(name: string): OneShotJobDescriptor | undefined {
  return registry.get(name);
}

async function ensureOneShotJobsTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "one_shot_jobs" (
      "name" text PRIMARY KEY,
      "completed_at" timestamp NOT NULL DEFAULT now(),
      "details" jsonb
    )
  `);
}

export interface OneShotJobLedgerRow {
  name: string;
  completedAt: string | null;
  details: Record<string, unknown> | null;
}

export async function readOneShotJobLedger(): Promise<OneShotJobLedgerRow[]> {
  await ensureOneShotJobsTable();
  const res = await db.execute(sql`
    SELECT "name", "completed_at" AS "completedAt", "details"
    FROM "one_shot_jobs"
    ORDER BY "name"
  `);
  return (res.rows as Array<{ name: string; completedAt: unknown; details: unknown }>).map((r) => ({
    name: r.name,
    completedAt:
      r.completedAt instanceof Date
        ? r.completedAt.toISOString()
        : r.completedAt
          ? String(r.completedAt)
          : null,
    details: (r.details as Record<string, unknown> | null) ?? null,
  }));
}

export async function readOneShotJobLedgerRow(
  name: string,
): Promise<OneShotJobLedgerRow | null> {
  await ensureOneShotJobsTable();
  const res = await db.execute(sql`
    SELECT "name", "completed_at" AS "completedAt", "details"
    FROM "one_shot_jobs"
    WHERE "name" = ${name}
    LIMIT 1
  `);
  const row = res.rows[0] as
    | { name: string; completedAt: unknown; details: unknown }
    | undefined;
  if (!row) return null;
  return {
    name: row.name,
    completedAt:
      row.completedAt instanceof Date
        ? row.completedAt.toISOString()
        : row.completedAt
          ? String(row.completedAt)
          : null,
    details: (row.details as Record<string, unknown> | null) ?? null,
  };
}

export async function clearOneShotJobLedgerRow(name: string): Promise<boolean> {
  await ensureOneShotJobsTable();
  const res = await db.execute(
    sql`DELETE FROM "one_shot_jobs" WHERE "name" = ${name}`,
  );
  return (res.rowCount ?? 0) > 0;
}

export interface RunOneShotJobOutcome {
  job: string;
  status: OneShotJobRunStatus;
  ledgerCleared: boolean;
  durationMs: number;
  details: Record<string, unknown> | null;
  error: string | null;
}

/**
 * Generic "clear ledger and re-run" entrypoint used by the admin endpoint.
 * Catches and reports failures so a buggy runner cannot crash the request.
 */
export async function runOneShotJob(name: string): Promise<RunOneShotJobOutcome> {
  const descriptor = registry.get(name);
  if (!descriptor) {
    throw new Error(`Unknown one-shot job: ${name}`);
  }

  const ledgerCleared = await clearOneShotJobLedgerRow(name);
  const start = Date.now();
  try {
    const result = await descriptor.run();
    const durationMs = Date.now() - start;
    let details = result.details ?? null;
    if (!details) {
      const ledger = await readOneShotJobLedgerRow(name);
      details = ledger?.details ?? null;
    }
    return {
      job: name,
      status: result.status,
      ledgerCleared,
      durationMs,
      details,
      error: result.error ?? null,
    };
  } catch (err) {
    const durationMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    logError(
      `[oneShotJobRegistry] re-run failed for ${name}`,
      {},
      err instanceof Error ? err : new Error(message),
    );
    return {
      job: name,
      status: "failed",
      ledgerCleared,
      durationMs,
      details: null,
      error: message,
    };
  }
}
