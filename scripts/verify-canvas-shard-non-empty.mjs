#!/usr/bin/env node
// Task #2262 — Same silent-skip guard as Task #2235's
// `scripts/verify-playwright-projects-non-empty.mjs`, but scoped to the
// `e2e-canvas-firefox-webkit` matrix in `.github/workflows/ci.yml`.
//
// Background: that job runs an explicit list of six canvas-heavy spec
// files (`takeoff-markup-drawing.spec.ts`, `plan-markup-group-drag.spec.ts`,
// `plan-markup-marquee-select.spec.ts`, `plan-pins.spec.ts`,
// `takeoff-markup-history-wiring.spec.ts`, `takeoff-markup-undo.spec.ts`)
// per shard with `--shard=N/2`. Two failure modes would silently shrink
// CI coverage today:
//
//   1. A future rename or move of one of those specs leaves the YAML
//      pointing at a path that no longer exists (or, worse, at a path
//      that exists but is now empty). Playwright's behaviour when a
//      file argument matches no specs has shifted across versions and
//      cannot be relied on as a hard failure — and even when it does
//      error, the message ("no tests found") is buried in the run log.
//   2. `--shard=N/2` distribution emptying a shard for a given engine.
//      Playwright shards at the file level by default, so dropping
//      enough specs from the enumerated list (e.g. down to one) can
//      hand shard 2 zero specs while shard 1 still passes — the job
//      reports green with half the coverage gone.
//
// This script runs as a fail-fast pre-step inside the matrix job:
//
//   1. Asserts the enumerated spec list passed in matches the
//      `--expected-enumerated-specs=N` invariant (catches the case the
//      task description calls "dropped one off the list" — e.g. a
//      well-meaning refactor that quietly trims `CANVAS_SPECS` from
//      six to five would otherwise still pass every other check
//      because the surviving five files all exist on disk and split
//      across two shards with >= 1 test each).
//   2. Verifies every spec path passed in actually exists on disk
//      (catches the rename/move case where a spec was renamed but the
//      YAML still names the old path).
//   3. Invokes `npx playwright test --list --reporter=json
//      --project=<engine> --shard=N/M <specs>` so Playwright itself
//      reports exactly which tests this shard would execute on this
//      engine.
//   4. Counts the discovered tests (and the distinct spec files they
//      came from) and asserts both are >= 1, naming the empty shard
//      in the error message and pointing at `.github/workflows/ci.yml`
//      and `playwright.config.ts` as the files to inspect.
//   5. Writes a per-shard markdown summary to `$GITHUB_STEP_SUMMARY`
//      with expected vs. actual counts so reviewers can see at a
//      glance whether coverage drifted on this PR — mirroring the
//      per-project summary the Task #2235 script writes for the
//      `e2e` job.
//
// Exit codes:
//   0 — the enumerated list matches the expected size, every spec
//       exists, and the shard discovered >= 1 test for the requested
//       project.
//   1 — the enumerated list shrank/grew vs. the expected size, a spec
//       is missing on disk, the shard discovered 0 tests, or
//       `playwright test --list` failed to produce parseable JSON.

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
import { basename } from "node:path";

function parseArgs(argv) {
  const args = {
    project: null,
    shard: null,
    expectedEnumeratedSpecs: null,
    specs: [],
  };
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a.startsWith("--project=")) {
      args.project = a.slice("--project=".length);
    } else if (a === "--project") {
      args.project = argv[++i];
    } else if (a.startsWith("--shard=")) {
      args.shard = a.slice("--shard=".length);
    } else if (a === "--shard") {
      args.shard = argv[++i];
    } else if (a.startsWith("--expected-enumerated-specs=")) {
      args.expectedEnumeratedSpecs = Number(
        a.slice("--expected-enumerated-specs=".length),
      );
    } else if (a === "--expected-enumerated-specs") {
      args.expectedEnumeratedSpecs = Number(argv[++i]);
    } else if (a === "--") {
      // Allow `node verify-canvas-shard-non-empty.mjs --project=firefox
      // --shard=1/2 -- e2e/foo.spec.ts e2e/bar.spec.ts` to disambiguate
      // spec paths from flag-shaped arguments. Everything after `--` is
      // a positional spec.
      for (let j = i + 1; j < argv.length; j++) args.specs.push(argv[j]);
      break;
    } else {
      args.specs.push(a);
    }
    i++;
  }
  if (!args.project) {
    throw new Error(
      "Missing required --project=<engine> (e.g. --project=firefox).",
    );
  }
  if (!args.shard) {
    throw new Error(
      "Missing required --shard=N/M (e.g. --shard=1/2). This must match " +
        "the value passed to `playwright test` so the discovery view agrees " +
        "with the run.",
    );
  }
  if (!/^\d+\/\d+$/.test(args.shard)) {
    throw new Error(
      `--shard must be in N/M form, got '${args.shard}'.`,
    );
  }
  if (args.expectedEnumeratedSpecs === null) {
    throw new Error(
      "Missing required --expected-enumerated-specs=N. Set this to the " +
        "exact number of spec files the canvas-shard list is supposed to " +
        "cover (currently 6) so a future commit that quietly removes one " +
        "spec from CANVAS_SPECS fails this gate instead of silently " +
        "shrinking coverage.",
    );
  }
  if (
    !Number.isInteger(args.expectedEnumeratedSpecs) ||
    args.expectedEnumeratedSpecs <= 0
  ) {
    throw new Error(
      `--expected-enumerated-specs must be a positive integer, got '${args.expectedEnumeratedSpecs}'.`,
    );
  }
  if (args.specs.length === 0) {
    throw new Error(
      "No spec files passed. Provide the same enumerated spec list as the " +
        "`playwright test` invocation in .github/workflows/ci.yml " +
        "(e.g. e2e/takeoff-markup-drawing.spec.ts e2e/plan-markup-group-drag.spec.ts ...).",
    );
  }
  return args;
}

function verifyEnumeratedListSize(specs, expected) {
  // Catches the "dropped one off the list" case the task description
  // calls out: a future PR that intentionally or accidentally removes
  // a spec from CANVAS_SPECS (rather than leaving a stale path) would
  // pass every other guard in this script — the surviving paths all
  // exist on disk and split across two shards with >= 1 test each. By
  // pinning the expected count at the call site (in the YAML), any
  // change to CANVAS_SPECS now requires an accompanying edit to
  // --expected-enumerated-specs, which is exactly the human review
  // signal we want.
  if (specs.length !== expected) {
    const dedup = new Set(specs);
    const dupNote =
      dedup.size !== specs.length
        ? ` (note: ${specs.length - dedup.size} duplicate path(s) detected — ` +
          `${dedup.size} unique)`
        : "";
    throw new Error(
      `Canvas-shard enumerated list is ${specs.length} spec(s), expected ${expected}${dupNote}. ` +
        "Either CANVAS_SPECS in .github/workflows/ci.yml drifted, or the " +
        "--expected-enumerated-specs argument is stale. Update both together " +
        "so the gate keeps catching coverage drift. Listed specs:\n  - " +
        specs.join("\n  - "),
    );
  }
}

function verifySpecsExist(specs) {
  // Catches the "rename or move dropped one off the list" case the task
  // description calls out: if the YAML still names a spec that has been
  // moved or renamed, fail here with a clear actionable message instead
  // of relying on Playwright's behaviour for missing-file arguments
  // (which has changed across versions).
  const missing = specs.filter((s) => !existsSync(s));
  if (missing.length > 0) {
    for (const m of missing) {
      console.error(
        `::error::Canvas-shard spec '${m}' does not exist on disk — was the ` +
          "file renamed or moved without updating the enumerated list in " +
          ".github/workflows/ci.yml (e2e-canvas-firefox-webkit job)?",
      );
    }
    throw new Error(
      `${missing.length} canvas-shard spec file(s) missing: ${missing
        .map((m) => `'${m}'`)
        .join(", ")}. Restore the file(s) or update the enumerated list ` +
        "in .github/workflows/ci.yml.",
    );
  }
}

function runPlaywrightList({ project, shard, specs }) {
  // `--list --reporter=json` makes Playwright enumerate tests without
  // launching browsers or the dev server (`webServer` is skipped in
  // list mode), so this gate is cheap to run before the real test
  // invocation. `stdio: "pipe"` captures stdout for parsing while
  // still letting us forward stderr to the CI log on failure.
  const result = spawnSync(
    "npx",
    [
      "playwright",
      "test",
      "--list",
      "--reporter=json",
      `--project=${project}`,
      `--shard=${shard}`,
      ...specs,
    ],
    {
      encoding: "utf8",
      // 200MB is well above the largest realistic test list payload;
      // a safety net against Node's default 1MB stdout cap clipping
      // the JSON and producing a confusing parse error downstream.
      maxBuffer: 200 * 1024 * 1024,
    },
  );
  if (result.error) {
    throw new Error(
      `Failed to spawn 'npx playwright test --list --project=${project} --shard=${shard}': ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    process.stderr.write(result.stderr || "");
    throw new Error(
      `'npx playwright test --list --project=${project} --shard=${shard}' exited with status ${result.status}`,
    );
  }
  return result.stdout;
}

function parseListing(stdout) {
  // Playwright's JSON reporter writes a single JSON document to stdout.
  // Slice from the first '{' to the last '}' to be defensive against a
  // stray non-JSON line (e.g. an esbuild warning) sneaking in ahead of
  // it without masking real malformed output.
  const first = stdout.indexOf("{");
  const last = stdout.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) {
    throw new Error(
      "Could not find a JSON object in 'playwright test --list' output. " +
        "Raw output was:\n" +
        stdout,
    );
  }
  try {
    return JSON.parse(stdout.slice(first, last + 1));
  } catch (err) {
    throw new Error(
      `Failed to parse 'playwright test --list' JSON output: ${err.message}`,
    );
  }
}

function collectShardCounts(report, project) {
  // The JSON tree is `suites[].suites[]...specs[].tests[]` where each
  // `test` carries a `projectName`. Walk iteratively to avoid stack
  // issues on deeply nested directories. We bucket by `projectName`
  // because `--project=X --shard=N/M` does not strip other projects'
  // tests from the report — Playwright applies the project filter to
  // the run, but the JSON listing still echoes the configured projects.
  let testCount = 0;
  const specFiles = new Set();
  const stack = [...(report.suites ?? [])];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (Array.isArray(node.suites)) stack.push(...node.suites);
    if (Array.isArray(node.specs)) {
      for (const spec of node.specs) {
        let countedSpec = false;
        for (const test of spec.tests ?? []) {
          if (test.projectName !== project) continue;
          testCount++;
          countedSpec = true;
        }
        if (countedSpec && spec.file) specFiles.add(spec.file);
      }
    }
  }
  return { testCount, specFiles };
}

function writeStepSummary({
  project,
  shard,
  enumeratedSpecs,
  expectedEnumeratedSpecs,
  discoveredSpecs,
  testCount,
}) {
  // `$GITHUB_STEP_SUMMARY` is the file GitHub Actions concatenates into
  // the run page's summary view. Append (don't overwrite) so we coexist
  // with any other step that might write to it. No-op outside Actions.
  // Surfacing expected vs. actual (rather than just actual) makes
  // coverage drift jump out at a reviewer scanning the PR run page —
  // a green "6 / 6" reads very differently from a green "5 / 6" if
  // the gate's expected count ever drops.
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  const enumeratedCell =
    enumeratedSpecs.length === expectedEnumeratedSpecs
      ? `${enumeratedSpecs.length} / ${expectedEnumeratedSpecs} ✅`
      : `${enumeratedSpecs.length} / ${expectedEnumeratedSpecs} ❌`;
  const shardCell =
    discoveredSpecs.size > 0
      ? `${discoveredSpecs.size} ✅`
      : `${discoveredSpecs.size} ❌`;
  const testsCell = testCount > 0 ? `${testCount} ✅` : `${testCount} ❌`;
  const lines = [
    `### Canvas shard discovery — \`${project}\` shard \`${shard}\``,
    "",
    "| Metric | Actual / Expected |",
    "| --- | ---: |",
    `| Enumerated spec files | ${enumeratedCell} |`,
    `| Spec files this shard owns | ${shardCell} |`,
    `| Tests this shard will run | ${testsCell} |`,
    "",
    "Specs this shard owns:",
    "",
    discoveredSpecs.size === 0
      ? "_(none — this shard would run zero tests, which fails the gate.)_"
      : [...discoveredSpecs]
          .sort()
          .map((f) => `- \`${f}\``)
          .join("\n"),
    "",
  ];
  appendFileSync(summaryPath, lines.join("\n") + "\n", "utf8");
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  // Run the size invariant first so a CANVAS_SPECS shrink fails before
  // we even spawn Playwright — both speeds the gate up on the failing
  // case and keeps the error message focused on the actual drift
  // rather than a downstream symptom.
  verifyEnumeratedListSize(args.specs, args.expectedEnumeratedSpecs);
  verifySpecsExist(args.specs);

  const stdout = runPlaywrightList(args);
  const report = parseListing(stdout);
  const { testCount, specFiles } = collectShardCounts(report, args.project);

  // Always log the per-shard breakdown to the step log so it shows up
  // even when the GitHub summary file isn't available (local runs,
  // self-hosted runners without the env var, etc.).
  console.log(
    `Canvas shard discovery (${args.project} shard ${args.shard}):`,
  );
  console.log(
    `  enumerated specs: ${args.specs.length} (expected ${args.expectedEnumeratedSpecs})`,
  );
  for (const s of args.specs) {
    console.log(`    - ${s}`);
  }
  console.log(`  shard owns specs: ${specFiles.size}`);
  for (const f of [...specFiles].sort()) {
    console.log(`    - ${f}`);
  }
  console.log(`  tests this shard will run: ${testCount}`);

  writeStepSummary({
    project: args.project,
    shard: args.shard,
    enumeratedSpecs: args.specs,
    expectedEnumeratedSpecs: args.expectedEnumeratedSpecs,
    discoveredSpecs: specFiles,
    testCount,
  });

  if (testCount === 0) {
    console.error(
      `::error::Canvas-shard '${args.project}' shard '${args.shard}' ` +
        `discovered 0 tests across ${args.specs.length} enumerated spec ` +
        "file(s). Either --shard distribution emptied this shard (the " +
        "enumerated list may be too small to split N ways) or the " +
        `'${args.project}' project's testMatch / testIgnore stopped ` +
        "overlapping with the listed specs. Check the " +
        "e2e-canvas-firefox-webkit job in .github/workflows/ci.yml and " +
        "playwright.config.ts.",
    );
    process.exit(1);
  }

  // Belt-and-braces: if the shard discovered tests but somehow zero
  // distinct spec files (would imply the JSON shape changed), surface
  // that too rather than silently passing.
  if (specFiles.size === 0) {
    console.error(
      `::error::Canvas-shard '${args.project}' shard '${args.shard}' ` +
        `discovered ${testCount} test(s) but 0 distinct spec files. The ` +
        "Playwright JSON reporter shape may have changed — update " +
        `${basename(import.meta.url)} to match.`,
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
