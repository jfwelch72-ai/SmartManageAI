/**
 * Task #1177: tests for `runCertifiedPayrollBackfillOnce` — the post-deploy
 * one-shot wrapper that runs the certified-payroll backfill on first startup
 * (per environment) and then no-ops via the `one_shot_jobs` ledger.
 *
 * The behaviors covered here mirror the contract documented on the wrapper:
 *   (a) First run: calls the underlying backfill, records a row in
 *       `one_shot_jobs`, returns stats payload via the INSERT details.
 *   (b) Second run: a single SELECT against the ledger short-circuits the
 *       call — the underlying backfill is NOT invoked again.
 *   (c) Backfill failure: the failure is logged but the ledger row is NOT
 *       written, so the next startup will retry.
 *   (d) Missing PRIVATE_OBJECT_DIR (`skippedReason: "no_private_dir"`):
 *       the ledger row IS written so we don't re-list/scan on every
 *       startup, and an info log is emitted exactly once.
 *
 * The DB and the underlying backfill are mocked in-process so the suite is
 * hermetic and runs in CI without object storage configured.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

interface ExecuteCall {
  sqlText: string;
  params: unknown[];
}

const executeCalls: ExecuteCall[] = [];
let selectResponseRows: unknown[] = [];

function recordExecute(query: unknown): { rows: unknown[] } {
  // drizzle-orm `sql` template tags expose `.queryChunks` / `.toQuery()` but
  // we don't need a real serializer here — concatenating the chunks gives
  // us enough of the statement text to assert against (CREATE/SELECT/INSERT).
  let sqlText = "";
  const params: unknown[] = [];
  const q = query as {
    queryChunks?: unknown[];
    sql?: string;
  };
  if (Array.isArray(q.queryChunks)) {
    for (const chunk of q.queryChunks) {
      // String literals from the template are wrapped as
      // `StringChunk { value: ["text"] }`. Anything else is a parameter
      // value interpolated via `${...}` (drizzle stores it as the raw
      // value or a Param object — capture both shapes).
      if (
        chunk &&
        typeof chunk === "object" &&
        Array.isArray((chunk as { value?: unknown }).value)
      ) {
        sqlText += ((chunk as { value: unknown[] }).value as unknown[])
          .map((s) => String(s))
          .join("");
      } else if (
        chunk &&
        typeof chunk === "object" &&
        "value" in (chunk as Record<string, unknown>)
      ) {
        params.push((chunk as { value: unknown }).value);
      } else {
        params.push(chunk);
      }
    }
  } else if (typeof q.sql === "string") {
    sqlText = q.sql;
  } else {
    sqlText = String(query);
  }
  executeCalls.push({ sqlText, params });

  if (/^\s*SELECT/i.test(sqlText)) {
    return { rows: selectResponseRows };
  }
  return { rows: [] };
}

const dbMock = {
  execute: vi.fn(async (query: unknown) => recordExecute(query)),
};

vi.mock("../../db", () => ({ db: dbMock, pool: {} }));

const runCertifiedPayrollBackfillMock = vi.fn();
vi.mock("../../scripts/backfill-certified-payroll-reports", () => ({
  runCertifiedPayrollBackfill: (...args: unknown[]) =>
    runCertifiedPayrollBackfillMock(...args),
}));

const logInfoMock = vi.fn();
const logErrorMock = vi.fn();
const logWarnMock = vi.fn();
vi.mock("../logger", () => ({
  logInfo: (...args: unknown[]) => logInfoMock(...args),
  logError: (...args: unknown[]) => logErrorMock(...args),
  logWarn: (...args: unknown[]) => logWarnMock(...args),
  logDebug: vi.fn(),
}));

let runCertifiedPayrollBackfillOnce: typeof import("../runCertifiedPayrollBackfillOnce")["runCertifiedPayrollBackfillOnce"];

beforeEach(async () => {
  executeCalls.length = 0;
  selectResponseRows = [];
  dbMock.execute.mockClear();
  runCertifiedPayrollBackfillMock.mockReset();
  logInfoMock.mockReset();
  logErrorMock.mockReset();
  logWarnMock.mockReset();
  ({ runCertifiedPayrollBackfillOnce } = await import(
    "../runCertifiedPayrollBackfillOnce"
  ));
});

function statementKinds(): string[] {
  return executeCalls.map((c) => {
    const m = c.sqlText.match(/\b(CREATE|SELECT|INSERT|UPDATE|DELETE)\b/i);
    return m ? m[1].toUpperCase() : "OTHER";
  });
}

describe("runCertifiedPayrollBackfillOnce", () => {
  it("first run: invokes the backfill and inserts a ledger row with stats", async () => {
    selectResponseRows = []; // ledger empty → not yet completed
    runCertifiedPayrollBackfillMock.mockResolvedValueOnce({
      inserted: 7,
      alreadyPresent: 3,
      missingPayRun: 1,
      skippedNonMatching: 0,
      totalListed: 11,
      orgsScanned: 2,
      dryRun: false,
    });

    await runCertifiedPayrollBackfillOnce();

    expect(runCertifiedPayrollBackfillMock).toHaveBeenCalledTimes(1);
    expect(statementKinds()).toEqual(["CREATE", "SELECT", "INSERT"]);

    const insertCall = executeCalls[2];
    expect(insertCall.sqlText).toMatch(/INSERT\s+INTO\s+"one_shot_jobs"/i);
    // Job name is interpolated as the first parameter.
    expect(insertCall.params[0]).toBe(
      "backfill_certified_payroll_reports_v1",
    );
    // The details JSON payload carries the stats we want to preserve.
    const detailsJson = insertCall.params[1] as string;
    const details = JSON.parse(detailsJson);
    expect(details).toMatchObject({
      inserted: 7,
      alreadyPresent: 3,
      missingPayRun: 1,
      skippedNonMatching: 0,
      totalListed: 11,
      orgsScanned: 2,
    });
    expect(typeof details.elapsedMs).toBe("number");

    expect(logErrorMock).not.toHaveBeenCalled();
  });

  it("second run: short-circuits via a single SELECT and does NOT call the backfill", async () => {
    // Ledger already has the completion row — wrapper should bail out
    // immediately after the SELECT and never hit the underlying backfill.
    selectResponseRows = [{ "?column?": 1 }];

    await runCertifiedPayrollBackfillOnce();

    expect(runCertifiedPayrollBackfillMock).not.toHaveBeenCalled();
    // Exactly one SELECT (after the idempotent CREATE TABLE IF NOT EXISTS),
    // and crucially NO further INSERT/UPDATE/SELECT statements.
    expect(statementKinds()).toEqual(["CREATE", "SELECT"]);
    expect(logInfoMock).toHaveBeenCalledWith(
      expect.stringContaining("already completed"),
    );
  });

  it("backfill failure: logs the error and does NOT write the ledger flag (so next startup retries)", async () => {
    selectResponseRows = [];
    const boom = new Error("simulated backfill explosion");
    runCertifiedPayrollBackfillMock.mockRejectedValueOnce(boom);

    await expect(runCertifiedPayrollBackfillOnce()).resolves.toBeUndefined();

    expect(runCertifiedPayrollBackfillMock).toHaveBeenCalledTimes(1);
    // Critically: NO INSERT into `one_shot_jobs` — only the CREATE + SELECT.
    expect(statementKinds()).toEqual(["CREATE", "SELECT"]);
    const insertCalls = executeCalls.filter((c) =>
      /INSERT\s+INTO\s+"one_shot_jobs"/i.test(c.sqlText),
    );
    expect(insertCalls).toEqual([]);
    expect(logErrorMock).toHaveBeenCalledTimes(1);
    const [msg, , err] = logErrorMock.mock.calls[0];
    expect(String(msg)).toContain("run failed");
    expect(err).toBe(boom);
  });

  it("missing PRIVATE_OBJECT_DIR: records the flag and logs once so we stop probing on every startup", async () => {
    selectResponseRows = [];
    runCertifiedPayrollBackfillMock.mockResolvedValueOnce({
      inserted: 0,
      alreadyPresent: 0,
      missingPayRun: 0,
      skippedNonMatching: 0,
      totalListed: 0,
      orgsScanned: 0,
      dryRun: false,
      skippedReason: "no_private_dir",
    });

    await runCertifiedPayrollBackfillOnce();

    expect(runCertifiedPayrollBackfillMock).toHaveBeenCalledTimes(1);
    expect(statementKinds()).toEqual(["CREATE", "SELECT", "INSERT"]);

    const insertCall = executeCalls[2];
    expect(insertCall.sqlText).toMatch(/INSERT\s+INTO\s+"one_shot_jobs"/i);
    expect(insertCall.params[0]).toBe(
      "backfill_certified_payroll_reports_v1",
    );
    const details = JSON.parse(insertCall.params[1] as string);
    expect(details.skippedReason).toBe("no_private_dir");
    expect(typeof details.elapsedMs).toBe("number");

    // Exactly one info log for the no-private-dir path so noisy logs don't
    // accumulate on subsequent startups (the SELECT branch handles those).
    const noPrivateDirLogs = logInfoMock.mock.calls.filter(
      ([msg]) =>
        typeof msg === "string" && msg.includes("PRIVATE_OBJECT_DIR not set"),
    );
    expect(noPrivateDirLogs).toHaveLength(1);
    expect(logErrorMock).not.toHaveBeenCalled();
  });
});
