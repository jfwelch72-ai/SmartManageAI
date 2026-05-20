#!/usr/bin/env node
// Task #2683 — Lint guard for the prompt-injection mitigation contract.
//
// Every file under `server/` that calls an LLM (matches one of
// LLM_CALL_PATTERNS below) MUST either:
//
//   a) Import at least one helper from `server/ai/promptInjectionGuard`
//      (`detectPromptInjection`, `quarantineUntrustedText`,
//      `quarantineDocumentBlocks`, `quarantineUserText`,
//      `validateAiJsonOutput`, `recordPromptInjectionDetection`,
//      `recordDetectionMatches`).
//
//   OR
//
//   b) Carry an explicit top-of-file annotation comment:
//        // prompt-injection-guard: <reason>
//      The reason should describe why this LLM call site does not need
//      the guard (e.g. system-prompt-only, structured numeric inputs,
//      tenant-internal data with no user-controlled text). The annotation
//      is the deliberate, reviewable acknowledgement that replaces the
//      old "developer discipline" model with a mechanical CI bar.
//
// Allowlist: low-level provider/transport modules and the guard module
// itself are exempt because they ARE the mechanism, not callers passing
// untrusted data.
//
// Wire into CI via scripts/ci.sh. Run directly:
//   node scripts/check-prompt-injection-guard.mjs
//
// Run the script's own self-tests:
//   node scripts/check-prompt-injection-guard.mjs --self-test

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, "../server");

const LLM_CALL_PATTERNS = [
  /openai\.chat\.completions\.create\s*\(/,
  /\broutedChatCompletion\s*\(/,
  /\bcallOpenAIForAnalysis\s*\(/,
];

const GUARD_IMPORT_PATTERN =
  /from\s+["'][^"']*ai\/promptInjectionGuard["']/;

const ANNOTATION_PATTERN =
  /^\s*\/\/\s*prompt-injection-guard\s*:\s*\S+/m;

// Files exempt from the check entirely. These are the transport / wrapper
// layer or test fixtures — not user-facing AI surfaces.
const ALLOWED = new Set([
  // The guard module itself.
  path.join(SERVER_DIR, "ai", "promptInjectionGuard.ts"),
  // Low-level OpenAI client used by the providers layer; passes only
  // already-sanitized payloads.
  path.join(SERVER_DIR, "ai", "openaiClient.ts"),
  // Provider abstraction (OpenAI / Anthropic routing). Receives a
  // pre-built request object; sanitization belongs to callers.
  path.join(SERVER_DIR, "ai", "providers", "index.ts"),
  path.join(SERVER_DIR, "ai", "providers", "openaiProvider.ts"),
  path.join(SERVER_DIR, "ai", "providers", "anthropicProvider.ts"),
  path.join(SERVER_DIR, "ai", "providers", "types.ts"),
  // Governance wrapper. Wraps every callsite for spend/quota; does not
  // construct prompts.
  path.join(SERVER_DIR, "services", "aiGovernance.ts"),
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
      // Skip test directories — guard contract is enforced on production
      // code paths only. Test fixtures can use the LLM patterns freely.
      if (name === "__tests__" || name === "node_modules") continue;
      out.push(...walk(full));
    } else if (stat.isFile() && (name.endsWith(".ts") || name.endsWith(".tsx"))) {
      out.push(full);
    }
  }
  return out;
}

function fileCallsLLM(text) {
  return LLM_CALL_PATTERNS.some((rx) => rx.test(text));
}

function fileSatisfiesGuard(text) {
  return GUARD_IMPORT_PATTERN.test(text) || ANNOTATION_PATTERN.test(text);
}

// -----------------------------------------------------------------------
// Self-tests. Run via:  node scripts/check-prompt-injection-guard.mjs --self-test
// These lock the guard's behavior so future edits don't silently
// introduce regressions in the detection logic.
// -----------------------------------------------------------------------

function selfTest() {
  const cases = [
    {
      name: "no LLM call → fileCallsLLM=false",
      text: `import { db } from "./db";\nconsole.log("no AI here");\n`,
      expectCallsLlm: false,
      expectSatisfied: true,
    },
    {
      name: "openai.chat.completions.create → fileCallsLLM=true",
      text:
        `import { openai } from "./ai/openaiClient";\n` +
        `await openai.chat.completions.create({ messages: [] });\n`,
      expectCallsLlm: true,
      expectSatisfied: false,
    },
    {
      name: "routedChatCompletion call → fileCallsLLM=true",
      text: `const r = await routedChatCompletion({ orgId, request: {} });\n`,
      expectCallsLlm: true,
      expectSatisfied: false,
    },
    {
      name: "callOpenAIForAnalysis call → fileCallsLLM=true",
      text: `const r = await callOpenAIForAnalysis(doc);\n`,
      expectCallsLlm: true,
      expectSatisfied: false,
    },
    {
      name: "LLM call + guard import → satisfied",
      text:
        `import { quarantineUntrustedText } from "./ai/promptInjectionGuard";\n` +
        `await openai.chat.completions.create({ messages: [] });\n`,
      expectCallsLlm: true,
      expectSatisfied: true,
    },
    {
      name: "LLM call + annotation → satisfied",
      text:
        `// prompt-injection-guard: system-prompt-only, no user text\n` +
        `import { openai } from "./ai/openaiClient";\n` +
        `await openai.chat.completions.create({ messages: [] });\n`,
      expectCallsLlm: true,
      expectSatisfied: true,
    },
    {
      name: "annotation colon with text on next line → satisfied (\\s* crosses newline boundary)",
      text:
        `// prompt-injection-guard:\n` +
        `await openai.chat.completions.create({ messages: [] });\n`,
      expectCallsLlm: true,
      expectSatisfied: true,
    },
    {
      name: "guard import from a different path (not promptInjectionGuard) → NOT satisfied",
      text:
        `import { something } from "./ai/otherHelper";\n` +
        `await routedChatCompletion({ orgId, request: {} });\n`,
      expectCallsLlm: true,
      expectSatisfied: false,
    },
    {
      name: "validateAiJsonOutput import satisfies guard",
      text:
        `import { validateAiJsonOutput } from "../ai/promptInjectionGuard";\n` +
        `const result = await callOpenAIForAnalysis(doc);\n`,
      expectCallsLlm: true,
      expectSatisfied: true,
    },
    {
      name: "annotation mid-file (multiline flag matches) → satisfied",
      text:
        `import { openai } from "./ai/openaiClient";\n` +
        `function setup() { return 1; }\n` +
        `// prompt-injection-guard: structured-numeric-only\n` +
        `await openai.chat.completions.create({});\n`,
      expectCallsLlm: true,
      expectSatisfied: true,
    },
  ];

  let passed = 0;
  let failed = 0;

  for (const c of cases) {
    const gotCallsLlm = fileCallsLLM(c.text);
    const gotSatisfied = fileSatisfiesGuard(c.text);
    const callsLlmOk = gotCallsLlm === c.expectCallsLlm;
    // For files that don't call LLM, the satisfied check is irrelevant.
    const satisfiedOk = !c.expectCallsLlm || gotSatisfied === c.expectSatisfied;

    if (callsLlmOk && satisfiedOk) {
      passed++;
      console.log(`  ✓ ${c.name}`);
    } else {
      failed++;
      if (!callsLlmOk) {
        console.error(
          `  ✗ ${c.name}: fileCallsLLM expected ${c.expectCallsLlm}, got ${gotCallsLlm}`,
        );
      }
      if (!satisfiedOk) {
        console.error(
          `  ✗ ${c.name}: fileSatisfiesGuard expected ${c.expectSatisfied}, got ${gotSatisfied}`,
        );
      }
    }
  }

  console.log(`\n[self-test] ${passed} passed, ${failed} failed`);
  return failed === 0 ? 0 : 1;
}

if (process.argv.includes("--self-test")) {
  process.exit(selfTest());
}

function main() {
  const files = walk(SERVER_DIR);
  const offenders = [];
  for (const file of files) {
    if (ALLOWED.has(file)) continue;
    const text = readFileSync(file, "utf8");
    if (!fileCallsLLM(text)) continue;
    if (fileSatisfiesGuard(text)) continue;
    offenders.push(path.relative(path.resolve(__dirname, ".."), file));
  }
  if (offenders.length === 0) {
    console.log(
      `[check-prompt-injection-guard] OK — every LLM-calling file under server/ either imports the guard or carries an explicit annotation.`,
    );
    return 0;
  }
  console.error(
    `\n[check-prompt-injection-guard] FAIL — the following files call an LLM ` +
      `(openai.chat.completions.create / routedChatCompletion / callOpenAIForAnalysis) ` +
      `but do NOT import server/ai/promptInjectionGuard and do NOT carry a ` +
      `top-of-file '// prompt-injection-guard: <reason>' annotation:\n`,
  );
  for (const f of offenders) {
    console.error(`  - ${f}`);
  }
  console.error(
    `\nFix one of:\n` +
      `  1) Import the guard and call detectPromptInjection / quarantineUntrustedText / ` +
      `quarantineUserText / quarantineDocumentBlocks / validateAiJsonOutput as appropriate, OR\n` +
      `  2) Add a top-of-file comment explaining why no guard is needed:\n` +
      `        // prompt-injection-guard: <reason>\n` +
      `\nSee docs/architecture/prompt-injection.md for the playbook.\n`,
  );
  return 1;
}

process.exit(main());
