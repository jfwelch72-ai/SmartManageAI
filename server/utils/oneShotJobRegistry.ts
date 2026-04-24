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

/**
 * Task #1531 — A runtime-configurable parameter that the admin UI can
 * collect before invoking a one-shot job's `run` callback. Replaces the
 * bespoke per-job re-run endpoints (e.g. the certified-payroll
 * `orgFilter` / `dryRun` variants) that previously had to live outside
 * the generic registry because the runner had no way to receive
 * arbitrary inputs.
 */
export type OneShotJobParameter =
  | {
      name: string;
      label: string;
      description?: string;
      type: "string";
      default?: string;
      placeholder?: string;
    }
  | {
      name: string;
      label: string;
      description?: string;
      type: "boolean";
      default?: boolean;
    };

export interface OneShotJobDescriptor {
  /** The exact `one_shot_jobs.name` ledger key. */
  name: string;
  /** Human-readable title for the admin UI. */
  title: string;
  /** Short description shown beneath the title in the admin UI. */
  description: string;
  /**
   * Optional per-job parameters surfaced as a small form in the admin
   * "One-shot jobs" panel. Values entered by the operator are validated
   * by `coerceOneShotJobParams` and forwarded to `run` as the `params`
   * argument. Jobs that don't declare parameters always receive `{}`.
   */
  parameters?: OneShotJobParameter[];
  /**
   * Re-run the job. Implementations are expected to:
   *   1. Clear the existing ledger row (so the once-runner does work).
   *   2. Invoke the once-runner.
   *   3. Return a normalized result.
   * The registry's `runOneShotJob` helper handles step (1) generically and
   * inspects the post-run ledger row to populate `details`, so most runners
   * only need to call the existing once-runner inside `run`.
   */
  run: (params: Record<string, unknown>) => Promise<OneShotJobRunResult>;
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
  params: Record<string, unknown>;
}

/**
 * Coerce the raw param object posted by the admin UI into a typed map
 * matching the descriptor's `parameters` declaration. Unknown fields
 * are dropped, missing fields fall back to the declared default, and
 * values whose type can't be coerced trigger a thrown error so the
 * request fails loudly rather than silently dropping inputs. Jobs
 * without parameter declarations always get `{}`.
 */
export function coerceOneShotJobParams(
  descriptor: OneShotJobDescriptor,
  raw: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!descriptor.parameters || descriptor.parameters.length === 0) {
    return out;
  }
  const input = raw ?? {};
  for (const param of descriptor.parameters) {
    const provided = Object.prototype.hasOwnProperty.call(input, param.name)
      ? input[param.name]
      : undefined;
    if (param.type === "boolean") {
      if (provided === undefined || provided === null || provided === "") {
        out[param.name] = param.default ?? false;
      } else if (typeof provided === "boolean") {
        out[param.name] = provided;
      } else if (provided === "true") {
        out[param.name] = true;
      } else if (provided === "false") {
        out[param.name] = false;
      } else {
        throw new Error(
          `Invalid boolean value for parameter '${param.name}': ${String(provided)}`,
        );
      }
    } else {
      if (provided === undefined || provided === null) {
        out[param.name] = param.default ?? "";
      } else if (typeof provided === "string") {
        out[param.name] = provided.trim();
      } else {
        throw new Error(
          `Invalid string value for parameter '${param.name}': ${String(provided)}`,
        );
      }
    }
  }
  return out;
}

/**
 * Generic "clear ledger and re-run" entrypoint used by the admin endpoint.
 * Catches and reports failures so a buggy runner cannot crash the request.
 */
export async function runOneShotJob(
  name: string,
  rawParams: Record<string, unknown> | null = null,
): Promise<RunOneShotJobOutcome> {
  const descriptor = registry.get(name);
  if (!descriptor) {
    throw new Error(`Unknown one-shot job: ${name}`);
  }

  const params = coerceOneShotJobParams(descriptor, rawParams);
  const ledgerCleared = await clearOneShotJobLedgerRow(name);
  const start = Date.now();
  try {
    const result = await descriptor.run(params);
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
      params,
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
      params,
    };
  }
}
