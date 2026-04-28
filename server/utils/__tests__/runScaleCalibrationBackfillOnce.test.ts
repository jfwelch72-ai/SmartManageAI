/**
 * Task #2350 — tests for `runScaleCalibrationBackfillOnce`, the post-deploy
 * one-shot wrapper that runs the scale-calibration audit_log backfill on
 * first startup (per environment) and then no-ops via the `one_shot_jobs`
 * ledger.
 *
 * The behaviors covered here mirror the contract documented on the wrapper:
 *   (a) First run: calls the underlying backfill, records a row in
 *       `one_shot_jobs`, returns `completed` with stats payload.
 *   (b) Second run: a single SELECT against the ledger short-circuits the
 *       call — the underlying backfill is NOT invoked again.
 *   (c) Backfill failure: the failure is logged but the ledger row is NOT
 *       written, so the next startup will retry.
 *
 * The DB and the underlying backfill are mocked in-process so the suite is
 * hermetic and does not depend on a real Postgres instance.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

interface ExecuteCall {
  sqlText: string;
  params: unknown[];
}

const executeCalls: ExecuteCall[] = [];
let selectResponseRows: unknown[] = [];

function recordExecute(query: unknown): { rows: unknown[] } {
  let sqlText = "";
  const params: unknown[] = [];
  const q = query as { queryChunks?: unknown[]; sql?: string };
  if (Array.isArray(q.queryChunks)) {
    for (const chunk of q.queryChunks) {
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

const insertChain = {
  values: vi.fn(async () => undefined),
};
const dbMock = {
  execute: vi.fn(async (query: unknown) => recordExecute(query)),
  insert: vi.fn(() => insertChain),
};

vi.mock("../../db", () => ({ db: dbMock, pool: {} }));

const runScaleCalibrationBackfillMock = vi.fn();
vi.mock("../../scripts/backfill-scale-calibrations", () => ({
  runScaleCalibrationBackfill: (...args: unknown[]) =>
    runScaleCalibrationBackfillMock(...args),
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

let runScaleCalibrationBackfillOnce: typeof import("../runScaleCalibrationBackfillOnce")["runScaleCalibrationBackfillOnce"];
let JOB_NAME: string;

beforeEach(async () => {
  executeCalls.length = 0;
  selectResponseRows = [];
  dbMock.execute.mockClear();
  dbMock.insert.mockClear();
  insertChain.values.mockClear();
  runScaleCalibrationBackfillMock.mockReset();
  logInfoMock.mockReset();
  logErrorMock.mockReset();
  logWarnMock.mockReset();
  ({ runScaleCalibrationBackfillOnce, JOB_NAME } = await import(
    "../runScaleCalibrationBackfillOnce"
  ));
});

function statementKinds(): string[] {
  return executeCalls.map((c) => {
    const m = c.sqlText.match(/\b(CREATE|SELECT|INSERT|UPDATE|DELETE)\b/i);
    return m ? m[1].toUpperCase() : "OTHER";
  });
}

describe("runScaleCalibrationBackfillOnce", () => {
  it("first run: invokes the backfill and inserts a ledger row with stats", async () => {
    selectResponseRows = []; // ledger empty → not yet completed
    runScaleCalibrationBackfillMock.mockResolvedValueOnce({
      inserted: 12,
      alreadyHadStructured: 4,
      missingCalibratedBy: 1,
      candidatesScanned: 17,
      dryRun: false,
    });

    const result = await runScaleCalibrationBackfillOnce();

    expect(result.status).toBe("completed");
    expect(runScaleCalibrationBackfillMock).toHaveBeenCalledTimes(1);
    // CREATE TABLE IF NOT EXISTS, SELECT for completion check, INSERT into ledger.
    expect(statementKinds()).toEqual(["CREATE", "SELECT", "INSERT"]);

    const insertCall = executeCalls[2];
    expect(insertCall.sqlText).toMatch(/INSERT\s+INTO\s+"one_shot_jobs"/i);
    expect(insertCall.params[0]).toBe(JOB_NAME);
    const detailsJson = insertCall.params[1] as string;
    const details = JSON.parse(detailsJson);
    expect(details).toMatchObject({
      inserted: 12,
      alreadyHadStructured: 4,
      missingCalibratedBy: 1,
      candidatesScanned: 17,
    });
    expect(typeof details.elapsedMs).toBe("number");

    // The completed-status coverage row also gets recorded for the admin
    // "One-shot jobs" history panel.
    expect(dbMock.insert).toHaveBeenCalledTimes(1);
    expect(insertChain.values).toHaveBeenCalledTimes(1);
    const coverageArgs = insertChain.values.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(coverageArgs.jobName).toBe(JOB_NAME);
    expect(coverageArgs.status).toBe("completed");
    expect(coverageArgs.errorText).toBeNull();

    expect(logErrorMock).not.toHaveBeenCalled();
  });

  it("second run: short-circuits via a single SELECT and does NOT call the backfill", async () => {
    selectResponseRows = [{ "?column?": 1 }];

    const result = await runScaleCalibrationBackfillOnce();

    expect(result.status).toBe("skipped_already_complete");
    expect(runScaleCalibrationBackfillMock).not.toHaveBeenCalled();
    // Exactly one SELECT (after the idempotent CREATE TABLE IF NOT EXISTS),
    // and crucially NO further INSERT/UPDATE statements against the ledger.
    expect(statementKinds()).toEqual(["CREATE", "SELECT"]);
    expect(insertChain.values).not.toHaveBeenCalled();
    expect(logInfoMock).toHaveBeenCalledWith(
      expect.stringContaining("already completed"),
    );
  });

  it("backfill failure: logs the error and does NOT write the ledger flag (so next startup retries)", async () => {
    selectResponseRows = [];
    const boom = new Error("simulated scale backfill explosion");
    runScaleCalibrationBackfillMock.mockRejectedValueOnce(boom);

    const result = await runScaleCalibrationBackfillOnce();
    expect(result.status).toBe("failed");

    expect(runScaleCalibrationBackfillMock).toHaveBeenCalledTimes(1);
    // Critically: NO INSERT into `one_shot_jobs` — only the CREATE + SELECT.
    expect(statementKinds()).toEqual(["CREATE", "SELECT"]);
    const ledgerInsertCalls = executeCalls.filter((c) =>
      /INSERT\s+INTO\s+"one_shot_jobs"/i.test(c.sqlText),
    );
    expect(ledgerInsertCalls).toEqual([]);

    // The failed coverage row IS recorded so the admin history panel can
    // surface what blew up — but the ledger flag is left empty above.
    expect(insertChain.values).toHaveBeenCalledTimes(1);
    const coverageArgs = insertChain.values.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(coverageArgs.status).toBe("failed");
    expect(coverageArgs.errorText).toBe(boom.message);

    expect(logErrorMock).toHaveBeenCalledTimes(1);
    const [msg, , err] = logErrorMock.mock.calls[0];
    expect(String(msg)).toContain("run failed");
    expect(err).toBe(boom);
  });
});
