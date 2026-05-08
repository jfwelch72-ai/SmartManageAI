// Task #2668 — Source-introspection tests that pin down the AI Auto-
// Takeoff stall-recovery wiring so a future refactor can't silently
// regress the "stuck loading forever" bug.
//
// We intentionally avoid spinning up the DB / job queue here — every
// behavioural assertion in the task brief reduces to a small set of
// invariants that are easy to verify by reading the relevant module
// source (the same approach used by ai-takeoff-quick-wins.test.ts).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROUTES_PATH = path.resolve(__dirname, "../aiTakeoffFeatureRoutes.ts");
const JOB_RUNNER_PATH = path.resolve(__dirname, "../jobs/jobRunner.ts");
const SCHEMA_PATH = path.resolve(__dirname, "../../shared/schema/features/ai.ts");
const PANEL_PATH = path.resolve(
  __dirname,
  "../../client/src/components/AiTakeoffPanel.tsx",
);

describe("Task #2668 — AI takeoff progress + stall watchdog wiring", () => {
  it("ai_takeoff_analyses persists the active job id and the latest progress snapshot", () => {
    const src = readFileSync(SCHEMA_PATH, "utf8");
    expect(src).toContain('current_job_id');
    expect(src).toContain('progress_pct');
    expect(src).toContain('progress_message');
    expect(src).toContain('progress_updated_at');
  });

  it("the analyze route writes current_job_id onto the row immediately after enqueue", () => {
    const src = readFileSync(ROUTES_PATH, "utf8");
    // Ensure the post-enqueue UPDATE that stores currentJobId actually
    // exists. Without this the polled-fallback hydration on hard
    // reload has no jobId to re-attach the SSE stream to.
    expect(src).toMatch(/currentJobId:\s*enqueued\.jobId/);
    expect(src).toMatch(/progressMessage:\s*"Queued for analysis"/);
  });

  it("processAiTakeoff persists every progress tick + guarantees a terminal status via try/finally", () => {
    const src = readFileSync(ROUTES_PATH, "utf8");
    expect(src).toMatch(/progressPct:\s*clamped/);
    expect(src).toMatch(/progressUpdatedAt:\s*new Date\(\)/);
    expect(src).toMatch(/terminalStatusWritten\s*=\s*true/);
    expect(src).toMatch(/throw error;\s*}\s*finally/);
    expect(src).toMatch(/Analysis worker exited without a terminal status/);
    // The COMPLETE write must be guarded by a status filter so a
    // worker finishing AFTER cancel/watchdog-fail can't overwrite a
    // terminal FAILED row back to COMPLETE.
    expect(src).toMatch(/status:\s*"COMPLETE"[\s\S]{0,800}inArray\(aiTakeoffAnalyses\.status,\s*\["PENDING",\s*"PROCESSING"\]\)/);
    // The initial PENDING→PROCESSING transition must be guarded too,
    // so a row pre-flipped to FAILED before the worker started can't
    // be resurrected.
    expect(src).toMatch(/status:\s*"PROCESSING"[\s\S]{0,600}inArray\(aiTakeoffAnalyses\.status,\s*\["PENDING",\s*"PROCESSING"\]\)/);
    expect(src).toContain("worker start suppressed");
  });

  it("the results endpoint returns the fields the panel needs for hydration + polled fallback", () => {
    const src = readFileSync(ROUTES_PATH, "utf8");
    const resStart = src.indexOf("router.get(\"/ai-features/takeoff/results");
    expect(resStart).toBeGreaterThan(-1);
    const slice = src.slice(resStart, resStart + 4000);
    expect(slice).toMatch(/currentJobId:\s*analysis\.currentJobId/);
    expect(slice).toMatch(/progressPct:\s*analysis\.progressPct/);
    expect(slice).toMatch(/progressMessage:\s*analysis\.progressMessage/);
    expect(slice).toMatch(/errorMessage:\s*analysis\.errorMessage/);
  });

  it("a cancel endpoint exists, flips the row to FAILED, and best-effort publishes a terminal SSE", () => {
    const src = readFileSync(ROUTES_PATH, "utf8");
    expect(src).toContain('"/ai-features/takeoff/analyze/:analysisId/cancel"');
    expect(src).toMatch(/alreadyTerminal:\s*true/);
    expect(src).toMatch(/publishJobProgress\(\{[\s\S]{0,300}status:\s*"failed"/);
    expect(src).toMatch(/"Analysis cancelled by user"/);
    // pg-boss cancel takes (queueName, jobId) — the bug we're guarding
    // against is calling cancel(jobId) with one arg.
    expect(src).toMatch(/boss\.cancel\("ai_takeoff_analyze",\s*jobId\)/);
    // The cancel UPDATE must be atomic — guarded by the WHERE-status
    // filter so a worker that finishes between the SELECT and UPDATE
    // can't have its COMPLETE row flipped to FAILED.
    const cancelStart = src.indexOf('"/ai-features/takeoff/analyze/:analysisId/cancel"');
    const cancelSlice = src.slice(cancelStart, cancelStart + 4000);
    expect(cancelSlice).toMatch(
      /inArray\(aiTakeoffAnalyses\.status,\s*\["PENDING",\s*"PROCESSING"\]\)/,
    );
    // And when the guarded UPDATE affects 0 rows the handler must
    // re-read instead of forcing a "cancelled" response.
    expect(cancelSlice).toMatch(/cancelled\.length\s*===\s*0/);
  });

  it("the job runner registers a stall-watchdog cron and exposes processAiTakeoffStallWatchdog", () => {
    const src = readFileSync(JOB_RUNNER_PATH, "utf8");
    expect(src).toContain("aiTakeoffStallWatchdogTask");
    // Once per minute
    expect(src).toMatch(/cron\.schedule\("\* \* \* \* \*"/);
    // Sweep helper is exported and uses the configured timeout env var.
    expect(src).toContain("export async function processAiTakeoffStallWatchdog");
    expect(src).toContain("AI_TAKEOFF_STALL_TIMEOUT_MS");
    expect(src).toMatch(/Analysis stalled — no progress reported/);
    expect(src).toMatch(/aiTakeoffStallWatchdogTask\.stop\(\)/);
    // The watchdog must consult pg-boss before flipping a row, so a
    // genuinely active job (long model call) is not force-failed.
    expect(src).toMatch(/getJobById\("ai_takeoff_analyze"/);
    expect(src).toMatch(/skippedJobActive/);
    // Owner lookup uses the schema's actual creator field.
    expect(src).toMatch(/row\.createdByUserId/);
    expect(src).not.toMatch(/row\.userId/);
  });

  it("the AiTakeoffPanel hydrates jobId from results, falls back to polled progress, and renders a failure card with retry", () => {
    const src = readFileSync(PANEL_PATH, "utf8");
    // Hydration effect on reload
    expect(src).toMatch(/setAnalysisJobId\(analysisResults\.currentJobId\)/);
    // Polled fallback wiring on the pending bar
    expect(src).toMatch(/polledProgress=\{analysisResults\?\.progressPct/);
    expect(src).toMatch(/polledMessage=\{analysisResults\?\.progressMessage/);
    // Failure card is mounted and exposes a retry button + cancel UI
    expect(src).toContain('AiTakeoffFailureCard');
    expect(src).toContain('data-testid="button-ai-takeoff-retry"');
    expect(src).toContain('data-testid="button-ai-takeoff-cancel"');
    expect(src).toMatch(/\/api\/ai-features\/takeoff\/analyze\/\$\{analysisId\}\/cancel/);
    // Stale-SSE fallback: the panel must time out a silent SSE stream
    // and prefer the polled snapshot so the bar can't get stuck on a
    // single live value forever.
    expect(src).toContain("SSE_STALE_AFTER_MS");
    expect(src).toMatch(/job\.lastEventAt/);
  });
});
