#!/usr/bin/env node
// Task #2684 — Lint guard for the AI provider router contract.
//
// Every direct `openai.chat.completions.create(` call site under `server/`
// MUST carry an explicit annotation comment:
//
//   // ai-router-bypass: <reason>
//
// The annotation may live in EITHER:
//
//   a) The file preamble (top-of-file, within the first 25 lines, before
//      any non-comment / non-import code). A preamble annotation covers
//      every direct call in the file — i.e. "this whole file is
//      acknowledged-bypass". Reviewers must approve that scope in PR.
//
//   b) Within the 5 lines immediately preceding the specific direct
//      call site. A near-call annotation covers ONLY that single call.
//
// IMPORTANT: importing a router entrypoint (`routedChatCompletion`,
// `routedGeneralChatCompletion`, `routedEmbedding`) does NOT exempt a
// file from the rule — a partially-migrated file can still have a
// stray direct call that must be either migrated or annotated. The
// rule operates per-call-site, not per-file.
//
// Allowlist: low-level provider/transport modules and the OpenAI SDK
// wrapper itself are exempt because they ARE the transport, not callers.
//
// Wire into CI via scripts/ci.sh. Run directly:
//   node scripts/check-ai-router-bypass.mjs
//
// Run the script's own self-tests:
//   node scripts/check-ai-router-bypass.mjs --self-test

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, "../server");

const DIRECT_CALL_PATTERN = /openai\.chat\.completions\.create\s*\(/;

const ANNOTATION_LINE_PATTERN =
  /^\s*\/\/\s*ai-router-bypass\s*:\s*\S+/;

// Maximum number of lines from the top of the file that count as the
// "preamble" — this is the only region where a file-wide annotation is
// honored. Beyond this, an annotation only covers the single call
// within 5 lines below it. 25 lines comfortably covers the file's
// initial comment block + import block in practice.
const PREAMBLE_MAX_LINES = 25;

// Per-call near-annotation lookback window.
const NEAR_CALL_LOOKBACK = 5;

// Files exempt from the check entirely. These are the transport / wrapper
// layer or the router itself.
const ALLOWED = new Set([
  path.join(SERVER_DIR, "ai", "openaiClient.ts"),
  path.join(SERVER_DIR, "ai", "providers", "index.ts"),
  path.join(SERVER_DIR, "ai", "providers", "openaiProvider.ts"),
  path.join(SERVER_DIR, "ai", "providers", "anthropicProvider.ts"),
  path.join(SERVER_DIR, "ai", "providers", "embeddingProvider.ts"),
  path.join(SERVER_DIR, "ai", "providers", "types.ts"),
]);

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = path.join(dir, name);
    let stat;
    try { stat = statSync(full); } catch { continue; }
    if (stat.isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      out.push(...walk(full));
    } else if (stat.isFile() && (name.endsWith(".ts") || name.endsWith(".tsx"))) {
      out.push(full);
    }
  }
  return out;
}

// A "preamble" line is one that, scanning from the top of the file,
// contains only:
//   - blank / whitespace
//   - line comment   (// ...)
//   - block comment  (/* ... */ or part of a /* ... */ run)
//   - import / export-from statement
// Once we hit a non-preamble line we stop. We also stop at
// PREAMBLE_MAX_LINES regardless. The annotation is honored as a
// file-wide bypass only if it sits inside this region.
function preambleEndIndex(lines) {
  let inBlockComment = false;
  const limit = Math.min(lines.length, PREAMBLE_MAX_LINES);
  let lastPreambleIdx = -1;
  for (let i = 0; i < limit; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (inBlockComment) {
      lastPreambleIdx = i;
      if (trimmed.includes("*/")) inBlockComment = false;
      continue;
    }
    if (trimmed === "") {
      lastPreambleIdx = i;
      continue;
    }
    if (trimmed.startsWith("//")) {
      lastPreambleIdx = i;
      continue;
    }
    if (trimmed.startsWith("/*")) {
      lastPreambleIdx = i;
      if (!trimmed.includes("*/")) inBlockComment = true;
      continue;
    }
    if (
      trimmed.startsWith("import ") ||
      trimmed.startsWith("import{") ||
      trimmed.startsWith("import(") ||
      trimmed.startsWith("export ") ||
      trimmed.startsWith('"use ') ||
      trimmed.startsWith("'use ")
    ) {
      lastPreambleIdx = i;
      continue;
    }
    break;
  }
  return lastPreambleIdx;
}

function hasPreambleAnnotation(lines) {
  const end = preambleEndIndex(lines);
  if (end < 0) return false;
  for (let i = 0; i <= end; i++) {
    if (ANNOTATION_LINE_PATTERN.test(lines[i])) return true;
  }
  return false;
}

function findOffendingCalls(text) {
  const lines = text.split("\n");
  const fileBypass = hasPreambleAnnotation(lines);
  const offenders = [];
  for (let i = 0; i < lines.length; i++) {
    if (!DIRECT_CALL_PATTERN.test(lines[i])) continue;
    if (fileBypass) continue;
    let nearAnnotated = false;
    const start = Math.max(0, i - NEAR_CALL_LOOKBACK);
    for (let j = start; j < i; j++) {
      if (ANNOTATION_LINE_PATTERN.test(lines[j])) {
        nearAnnotated = true;
        break;
      }
    }
    if (nearAnnotated) continue;
    offenders.push(i + 1);
  }
  return offenders;
}

function checkRepo() {
  const files = walk(SERVER_DIR);
  const offenders = [];
  for (const file of files) {
    if (ALLOWED.has(file)) continue;
    const text = readFileSync(file, "utf8");
    const lineNums = findOffendingCalls(text);
    if (lineNums.length === 0) continue;
    const rel = path.relative(path.resolve(__dirname, ".."), file);
    for (const ln of lineNums) offenders.push(`${rel}:${ln}`);
  }
  if (offenders.length === 0) {
    console.log(
      `[check-ai-router-bypass] OK — every direct openai.chat.completions.create call under server/ carries an explicit '// ai-router-bypass:' annotation (per-call or file-preamble).`,
    );
    return 0;
  }
  console.error(
    `\n[check-ai-router-bypass] FAIL — the following call sites bypass the AI provider router without an annotation:\n`,
  );
  for (const f of offenders) {
    console.error(`  - ${f}`);
  }
  console.error(
    `\nFix one of:\n` +
      `  1) Replace 'openai.chat.completions.create({...})' with 'await routedGeneralChatCompletion({orgId, featureKey, request: {...}})' (import from 'server/ai/providers'), OR\n` +
      `  2) Add a preamble (top-of-file, within first ${PREAMBLE_MAX_LINES} lines, before any non-comment / non-import code) annotation covering the whole file:\n` +
      `        // ai-router-bypass: <reason>\n` +
      `     OR a per-call annotation within ${NEAR_CALL_LOOKBACK} lines preceding the specific call site:\n` +
      `        // ai-router-bypass: <reason>\n` +
      `        const completion = await openai.chat.completions.create({...});\n` +
      `\nNote: importing a router entrypoint does NOT exempt a file from this check.\n` +
      `See docs/architecture/ai-provider-routing.md for the playbook.\n`,
  );
  return 1;
}

// -----------------------------------------------------------------------
// Self-tests. Run via:  node scripts/check-ai-router-bypass.mjs --self-test
// These lock the guard's behavior so future edits don't silently
// introduce regressions in the regression-prevention guard itself.
// -----------------------------------------------------------------------

function selfTest() {
  const cases = [
    {
      name: "no LLM call → clean",
      text: `import x from "y";\nconsole.log("hi");\n`,
      expectOffenders: 0,
    },
    {
      name: "direct call, no annotation → offender",
      text:
        `import { openai } from "./ai/openaiClient";\n` +
        `await openai.chat.completions.create({ messages: [] });\n`,
      expectOffenders: 1,
    },
    {
      name: "direct call with preamble annotation → clean",
      text:
        `// ai-router-bypass: vision-only\n` +
        `import { openai } from "./ai/openaiClient";\n` +
        `await openai.chat.completions.create({ messages: [] });\n`,
      expectOffenders: 0,
    },
    {
      name: "direct call with near-call annotation → clean",
      text:
        `import { openai } from "./ai/openaiClient";\n` +
        `function f() {\n` +
        `  // ai-router-bypass: tools\n` +
        `  return openai.chat.completions.create({});\n` +
        `}\n`,
      expectOffenders: 0,
    },
    {
      name: "router import alone does NOT exempt direct call",
      text:
        `import { routedGeneralChatCompletion } from "./ai/providers";\n` +
        `import { openai } from "./ai/openaiClient";\n` +
        `await openai.chat.completions.create({ messages: [] });\n`,
      expectOffenders: 1,
    },
    {
      name: "annotation deep in file (not preamble) does NOT cover unrelated call",
      text:
        `import { openai } from "./ai/openaiClient";\n` +
        `function a() {\n` +
        `  return openai.chat.completions.create({});\n` + // line 3, no near annotation
        `}\n` +
        // Lots of body so we're well past the preamble window.
        Array(40).fill(`  const x = 1;`).join("\n") + `\n` +
        `// ai-router-bypass: this is for the call below\n` +
        `function b() {\n` +
        `  return openai.chat.completions.create({});\n` +
        `}\n`,
      expectOffenders: 1, // only the first call (line 3) is unannotated
    },
    {
      name: "near-call annotation outside the 5-line window → offender",
      text:
        `import { openai } from "./ai/openaiClient";\n` +
        `function f() {\n` + // breaks preamble
        `  // ai-router-bypass: stale\n` +
        `  const a = 1;\n` +
        `  const b = 2;\n` +
        `  const c = 3;\n` +
        `  const d = 4;\n` +
        `  const e = 5;\n` +
        `  const f2 = 6;\n` +
        `  return openai.chat.completions.create({});\n` + // 7 lines below annotation
        `}\n`,
      expectOffenders: 1,
    },
    {
      name: "two direct calls, only one annotated → one offender",
      text:
        `import { openai } from "./ai/openaiClient";\n` +
        `function early() {\n` + // breaks preamble immediately
        `  // ai-router-bypass: legitimate vision\n` +
        `  return openai.chat.completions.create({});\n` +
        `}\n` +
        `function later() {\n` +
        Array(30).fill(`  const x = 1;`).join("\n") + `\n` +
        `  return openai.chat.completions.create({});\n` +
        `}\n`,
      expectOffenders: 1,
    },
    {
      name: "annotation in block comment in preamble → covers file",
      text:
        `/* ai-router-bypass: in block comment shouldn't count, but the next line should */\n` +
        `// ai-router-bypass: real annotation\n` +
        `import { openai } from "./ai/openaiClient";\n` +
        `await openai.chat.completions.create({});\n`,
      expectOffenders: 0,
    },
    {
      name: "preamble ends at first real code; later annotation only covers near calls",
      text:
        `import { openai } from "./ai/openaiClient";\n` +
        `const x = 1;\n` + // preamble ends here
        `function a() {\n` +
        `  return openai.chat.completions.create({});\n` + // unannotated
        `}\n` +
        Array(30).fill(`const y = 1;`).join("\n") + `\n` +
        `// ai-router-bypass: covers only the next call\n` +
        `function b() {\n` +
        `  return openai.chat.completions.create({});\n` + // covered
        `}\n`,
      expectOffenders: 1,
    },
  ];

  let passed = 0;
  let failed = 0;
  for (const c of cases) {
    const got = findOffendingCalls(c.text).length;
    if (got === c.expectOffenders) {
      passed++;
      console.log(`  ✓ ${c.name}`);
    } else {
      failed++;
      console.error(
        `  ✗ ${c.name}: expected ${c.expectOffenders} offender(s), got ${got}`,
      );
    }
  }
  console.log(`\n[self-test] ${passed} passed, ${failed} failed`);
  return failed === 0 ? 0 : 1;
}

if (process.argv.includes("--self-test")) {
  process.exit(selfTest());
}
process.exit(checkRepo());
