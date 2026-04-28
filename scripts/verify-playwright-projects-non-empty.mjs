#!/usr/bin/env node
// Task #2235 — Catch silent gaps in CI by alerting when a Playwright project
// has zero tests.
//
// Background: Task #2233 wired a single-purpose `Verify chromium-touch project
// is registered` step into the `e2e` job that fails fast if the touch project
// ever stops matching `e2e/takeoff-touch-gestures.spec.ts`. The same
// silent-skip risk applies to every other Playwright project — if a future
// edit to `playwright.config.ts` left `chromium`, `firefox`, `webkit`, or any
// future project with an empty `testMatch`/`testIgnore` overlap, Playwright
// would treat "0 tests" as a successful run and CI would stay green.
//
// This script is the generic guard that runs once at the start of the `e2e`
// job:
//
//   1. Invokes `npx playwright test --list --reporter=json` to enumerate
//      every test Playwright would run, grouped by project.
//   2. Reads the declared project list from the same JSON payload's
//      `config.projects[].name` (so the source of truth is
//      `playwright.config.ts`, not a copy in this script that could drift).
//   3. Counts how many tests each declared project owns by walking the
//      `suites`/`specs`/`tests` tree and bucketing by `tests[].projectName`.
//   4. Writes a per-project markdown table to `$GITHUB_STEP_SUMMARY` (when
//      running under GitHub Actions) so reviewers can see at a glance how
//      the load is split between desktop Chromium / Firefox / WebKit and the
//      `chromium-touch` project added in Task #2222.
//   5. Exits non-zero with a clear, actionable error if any declared project
//      discovered zero tests, naming the offending project(s) and pointing
//      at `playwright.config.ts` as the file to inspect.
//
// Why a separate script instead of inline shell + jq?
//   - The Playwright JSON shape is a recursive `suites[].suites[].specs[]`
//     tree; walking it in jq is awkward and easy to get wrong silently.
//   - Surfaces a clear, single failure message (vs. a stack of `set -e`
//     pipefails) that names every empty project at once.
//   - Reusable from local checkouts (`node scripts/verify-playwright-projects-non-empty.mjs`)
//     for anyone editing `playwright.config.ts`.
//
// Exit codes:
//   0 — every declared project has >= 1 test discovered.
//   1 — at least one declared project has 0 tests, or `playwright test
//       --list` failed to produce parseable JSON.

import { spawnSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";

// Default location for the Slack-friendly per-project counts snippet (see
// `writeSlackContext` below). Task #2261 wires this file into the e2e job's
// `Notify Slack on E2E failure (main only)` step so the alert body shows
// reviewers which Playwright projects discovered which test counts —
// including the names of any project(s) with 0 tests — without making them
// open the run page first. Override via the `PLAYWRIGHT_PROJECT_COUNTS_FILE`
// env var (handy for local runs that don't want to litter the repo root).
const DEFAULT_SLACK_CONTEXT_FILE = "playwright-project-counts.txt";

function runPlaywrightList() {
  // `--list --reporter=json` makes Playwright enumerate tests without
  // launching browsers or the dev server (`webServer` is skipped in list
  // mode), so this step is cheap to run before the main test invocation.
  // `stdio: "pipe"` captures stdout for parsing while still letting us
  // forward stderr to the CI log on failure.
  const result = spawnSync(
    "npx",
    ["playwright", "test", "--list", "--reporter=json"],
    {
      encoding: "utf8",
      // 200MB is well above the largest realistic test list payload — a
      // safety net against Node's default 1MB stdout cap clipping the JSON
      // and producing a confusing parse error downstream.
      maxBuffer: 200 * 1024 * 1024,
    },
  );
  if (result.error) {
    throw new Error(
      `Failed to spawn 'npx playwright test --list --reporter=json': ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    process.stderr.write(result.stderr || "");
    throw new Error(
      `'npx playwright test --list --reporter=json' exited with status ${result.status}`,
    );
  }
  return result.stdout;
}

function parseListing(stdout) {
  // Playwright's JSON reporter writes a single JSON document to stdout. In
  // some configurations a stray non-JSON line can sneak in ahead of it
  // (e.g. an esbuild warning); slice from the first '{' to the last '}' to
  // be defensive without masking real malformed output.
  const first = stdout.indexOf("{");
  const last = stdout.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) {
    throw new Error(
      "Could not find a JSON object in 'playwright test --list' output. " +
        "Raw output was:\n" +
        stdout,
    );
  }
  const payload = stdout.slice(first, last + 1);
  try {
    return JSON.parse(payload);
  } catch (err) {
    throw new Error(
      `Failed to parse 'playwright test --list' JSON output: ${err.message}`,
    );
  }
}

function collectProjectCounts(report) {
  // Declared projects come from `config.projects[]` so this script's view
  // of "what must be non-empty" matches whatever `playwright.config.ts`
  // declares — no hardcoded engine list to drift.
  const declared = (report.config?.projects ?? []).map((p) => p.name);
  if (declared.length === 0) {
    throw new Error(
      "No projects found in playwright.config.ts. Expected at least one " +
        "entry in `projects[]` (currently chromium, firefox, webkit, " +
        "chromium-touch).",
    );
  }

  // Initialise every declared project to 0 so an empty project still shows
  // up in the summary table (and trips the assertion below).
  const counts = new Map(declared.map((name) => [name, 0]));

  // Playwright's JSON tree is `suites[].suites[]...specs[].tests[]` where
  // each `test` carries a `projectName`. Walk the tree iteratively to
  // avoid stack issues on deeply nested directories.
  const stack = [...(report.suites ?? [])];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (Array.isArray(node.suites)) stack.push(...node.suites);
    if (Array.isArray(node.specs)) {
      for (const spec of node.specs) {
        for (const test of spec.tests ?? []) {
          const name = test.projectName;
          if (!name) continue;
          // A test attributed to a project that isn't in `config.projects`
          // would mean Playwright's JSON shape changed (or someone is
          // injecting a project at runtime). We still count it so the
          // step summary surfaces the unexpected project name to a
          // reviewer instead of silently dropping it — but we don't
          // throw, because the contract this script enforces is
          // "every declared project has >= 1 test", and an extra
          // undeclared project is a softer signal than a missing one.
          if (!counts.has(name)) {
            counts.set(name, 0);
          }
          counts.set(name, (counts.get(name) ?? 0) + 1);
        }
      }
    }
  }

  return { declared, counts };
}

function writeStepSummary(declared, counts) {
  // `$GITHUB_STEP_SUMMARY` is the file GitHub Actions concatenates into the
  // run page's summary view. Append (don't overwrite) so we coexist with
  // any other step that might write to it. No-op outside Actions.
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  const lines = [
    "### Playwright project test discovery",
    "",
    "| Project | Tests discovered |",
    "| --- | ---: |",
    ...declared.map((name) => `| \`${name}\` | ${counts.get(name) ?? 0} |`),
    "",
  ];
  appendFileSync(summaryPath, lines.join("\n") + "\n", "utf8");
}

// Task #2261 — Render a Slack-mrkdwn snippet with the per-project counts and
// (when applicable) the names of any project(s) that discovered 0 tests, then
// write it to a file the `Notify Slack on E2E failure (main only)` step can
// pass to `.github/actions/notify-slack-on-failure` via its
// `extra-context-file` input. Always writing the file (whether the assertion
// passes or fails) means the Slack alert keeps the per-project breakdown
// even when the actual failure is downstream — e.g. the real Playwright run
// (not this gate) is what tripped, in which case knowing how many tests each
// project owned is still useful triage context for on-call.
//
// Slack's section text limit is 3000 characters; the realistic payload here
// is well under 200, but we cap conservatively to avoid surprising the
// alerting pipeline if the project list grows unexpectedly.
const SLACK_TEXT_HARD_CAP = 2800;
function renderSlackContext(declared, counts, empty) {
  // Right-pad project names so the code block aligns visually in Slack.
  const widest = declared.reduce((max, n) => Math.max(max, n.length), 0);
  const rows = declared.map((name) => {
    const padded = name.padEnd(widest, " ");
    const n = counts.get(name) ?? 0;
    return `${padded} : ${n} test(s)`;
  });

  const headline =
    empty.length > 0
      ? `*Playwright project test discovery* — :warning: ${empty.length} project(s) with 0 tests: ${empty
          .map((n) => `\`${n}\``)
          .join(", ")}`
      : "*Playwright project test discovery*";

  // Triple backticks render as a fixed-width code block in Slack mrkdwn.
  const body = ["```", ...rows, "```"].join("\n");
  let snippet = `${headline}\n${body}`;
  if (snippet.length > SLACK_TEXT_HARD_CAP) {
    snippet = `${snippet.slice(0, SLACK_TEXT_HARD_CAP)}\n…(truncated)`;
  }
  return snippet;
}

function writeSlackContext(declared, counts, empty) {
  const path =
    process.env.PLAYWRIGHT_PROJECT_COUNTS_FILE || DEFAULT_SLACK_CONTEXT_FILE;
  try {
    writeFileSync(path, renderSlackContext(declared, counts, empty), "utf8");
  } catch (err) {
    // Don't let a sidecar-file write failure mask the real assertion result.
    // The Slack notifier treats a missing/empty file as "no extra context"
    // so the alert still fires; we just lose the per-project breakdown.
    console.error(
      `::warning::Failed to write Slack context file '${path}': ${err.message}`,
    );
  }
}

function main() {
  const stdout = runPlaywrightList();
  const report = parseListing(stdout);
  const { declared, counts } = collectProjectCounts(report);

  // Always log the per-project breakdown to the step log so it shows up
  // even when the GitHub summary file isn't available (local runs,
  // self-hosted runners without the env var, etc.).
  console.log("Playwright project test discovery:");
  for (const name of declared) {
    console.log(`  ${name}: ${counts.get(name) ?? 0} test(s)`);
  }

  writeStepSummary(declared, counts);

  const empty = declared.filter((name) => (counts.get(name) ?? 0) === 0);

  // Always write the Slack-context sidecar file (Task #2261), regardless of
  // whether the assertion below passes — the e2e job's Slack notifier reads
  // it on any failure() in the job, and the per-project breakdown is useful
  // triage context even when the failure is downstream of this gate.
  writeSlackContext(declared, counts, empty);

  if (empty.length > 0) {
    // GitHub Actions surfaces `::error::` lines as annotations on the run
    // page, which is what the existing chromium-touch gate uses. Mirror
    // that pattern so a zero-test project shows up in the same place a
    // reviewer is already trained to look.
    for (const name of empty) {
      console.error(
        `::error::Playwright project '${name}' discovered 0 tests — ` +
          "check playwright.config.ts (testMatch / testIgnore for this project " +
          "may have drifted out of sync with e2e/).",
      );
    }
    console.error(
      `\n${empty.length} Playwright project(s) discovered 0 tests: ${empty
        .map((n) => `'${n}'`)
        .join(", ")}. Failing the job so the silent-skip is caught here ` +
        "instead of slipping past CI.",
    );
    process.exit(1);
  }
}

try {
  main();
} catch (err) {
  console.error(`::error::${err.message}`);
  process.exit(1);
}
