// Replay provider: takes a fixture's `replay.batches` (pre-recorded
// per-discipline LLM outputs) and runs them through the SAME
// reconciliation logic as the real map-reduce drafter. Keeps the bench
// usable in CI without API keys or a database.
//
// Imported lazily by the runner so a missing tsx setup doesn't break
// `--mode=replay` runs that don't need the server-side helper.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Run reconciliation in a child `tsx` process so the replay provider
 * doesn't have to bundle the full server toolchain into the bench
 * runner. The child reads JSON from stdin and writes JSON to stdout.
 */
export function reconcileViaTsx(batches) {
  const helperPath = path.resolve(__dirname, "reconcileChild.ts");
  const proc = spawnSync("npx", ["tsx", helperPath], {
    input: JSON.stringify({ batches }),
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (proc.status !== 0) {
    throw new Error(
      `[replayProvider] reconcile child failed (status ${proc.status}): ${proc.stderr || proc.stdout}`,
    );
  }
  const out = JSON.parse(proc.stdout);
  return out.measurements;
}

/**
 * Run a live takeoff against the configured AI provider. Reads
 * `pagesByDiscipline` from the fixture, calls the SAME per-discipline
 * prompt as production `reduceDisciplineBatch`, and reconciles the
 * outputs through the production `reconcileMeasurements`. Inherits
 * the parent env so AI provider keys are available.
 */
export function runLiveTakeoffViaTsx(pagesByDiscipline, { timeoutMs = 5 * 60 * 1000 } = {}) {
  const helperPath = path.resolve(__dirname, "liveChild.ts");
  const proc = spawnSync("npx", ["tsx", helperPath], {
    input: JSON.stringify({ pagesByDiscipline }),
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: timeoutMs,
    env: process.env,
  });
  if (proc.status !== 0) {
    throw new Error(
      `[replayProvider] live child failed (status ${proc.status}): ${proc.stderr || proc.stdout}`,
    );
  }
  if (proc.stderr) process.stderr.write(proc.stderr);
  const out = JSON.parse(proc.stdout);
  return out.measurements;
}
