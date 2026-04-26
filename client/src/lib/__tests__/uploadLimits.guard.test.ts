import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Task #2045 — Stop a 50-file rule change from sneaking back in via
 * per-call-site numbers.
 *
 * Task #2043 unified the per-batch upload cap at
 * `MAX_BATCH_UPLOAD_FILES = 50` (see `client/src/lib/uploadLimits.ts` and
 * the "Upload limits" note in `replit.md`). Every multi-file
 * `<ObjectUploader>` call site must import that constant rather than
 * hard-coding a per-site literal like `5`, `10`, or `20`. There is
 * nothing else in the build that mechanically prevents a future change
 * from quietly re-introducing such a literal — this scanner is that
 * guard.
 *
 * What the guard rejects:
 *   - Any `maxNumberOfFiles={<number literal greater than 1>}` in non-test
 *     client source. That is the prop spelling the production
 *     ObjectUploader call sites use, and `maxNumberOfFiles` is not used
 *     by anything else in the client bundle, so a literal here means
 *     somebody bypassed the shared constant.
 *
 * What the guard explicitly allows:
 *   - `maxNumberOfFiles={1}` — single-file pickers (avatar, company logo,
 *     single LiDAR scan, single receipt, single project media item,
 *     equipment maintenance photo, asset handover doc, individual
 *     heavy-civil DOT cert slot) are deliberately exempt and must stay
 *     at 1; they fill one form field and must not silently turn into
 *     multi-uploaders.
 *   - `maxNumberOfFiles={MAX_BATCH_UPLOAD_FILES}` (or any other
 *     identifier/expression) — we only flag *numeric literals*. A non-
 *     literal expression cannot drift away from the shared constant
 *     without a code review, which is the whole point of this rule.
 *   - Test files (`*.test.ts`, `*.test.tsx`, anything under a
 *     `__tests__/` directory). The ObjectUploader unit tests need to
 *     mount the component with concrete numeric limits to exercise its
 *     internal bookkeeping (e.g. the multi-file aggregate label test).
 *     They do not represent product behavior.
 */

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const CLIENT_SRC = join(REPO_ROOT, "client", "src");

const UPLOAD_LIMITS_PATH = "client/src/lib/uploadLimits.ts";
const SHARED_CONSTANT = "MAX_BATCH_UPLOAD_FILES";

// Strip line and block comments so a commented-out example like
// `// maxNumberOfFiles={5}` in a doc block does not trip the guard.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function isTestPath(absPath: string): boolean {
  const rel = relative(CLIENT_SRC, absPath).replace(/\\/g, "/");
  if (rel.endsWith(".test.ts") || rel.endsWith(".test.tsx")) return true;
  if (rel.split("/").includes("__tests__")) return true;
  return false;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      walk(full, out);
    } else if (
      st.isFile() &&
      (entry.endsWith(".ts") || entry.endsWith(".tsx")) &&
      !entry.endsWith(".d.ts")
    ) {
      out.push(full);
    }
  }
  return out;
}

interface Violation {
  file: string;
  line: number;
  literal: number;
  snippet: string;
}

// Match `maxNumberOfFiles = { <integer> }` with arbitrary whitespace.
// The prop name is unique to ObjectUploader in this codebase, so a
// numeric-literal binding here is unambiguously a multi-file uploader
// hard-coding its own cap.
const PROP_LITERAL_RE = /maxNumberOfFiles\s*=\s*\{\s*(\d+)\s*\}/g;

function findViolationsInFile(absPath: string): Violation[] {
  const raw = readFileSync(absPath, "utf8");
  const stripped = stripComments(raw);
  const violations: Violation[] = [];
  for (const match of stripped.matchAll(PROP_LITERAL_RE)) {
    const literal = Number(match[1]);
    if (!Number.isFinite(literal) || literal <= 1) continue;
    // Compute the 1-based line number from the original file (not the
    // stripped copy) by locating the same prop literal text. Falls back
    // to the stripped offset if the original was rewritten by comment
    // removal in a way that shifted the column.
    const needle = match[0];
    const idx = raw.indexOf(needle);
    const offset = idx >= 0 ? idx : (match.index ?? 0);
    const line = raw.slice(0, offset).split("\n").length;
    const snippetLine = raw.split("\n")[line - 1] ?? "";
    violations.push({
      file: relative(REPO_ROOT, absPath).replace(/\\/g, "/"),
      line,
      literal,
      snippet: snippetLine.trim(),
    });
  }
  return violations;
}

describe("Upload limits guard — ObjectUploader call sites", () => {
  it("never hard-codes maxNumberOfFiles to a numeric literal greater than 1", () => {
    const files = walk(CLIENT_SRC).filter((p) => !isTestPath(p));
    const violations = files.flatMap(findViolationsInFile);

    if (violations.length > 0) {
      const lines = violations.map(
        (v) =>
          `  - ${v.file}:${v.line} → maxNumberOfFiles={${v.literal}}\n      ${v.snippet}`,
      );
      const message = [
        "",
        `Found ${violations.length} ObjectUploader call site(s) hard-coding`,
        `\`maxNumberOfFiles={<number>}\` instead of importing the shared`,
        `\`${SHARED_CONSTANT}\` constant from \`${UPLOAD_LIMITS_PATH}\`:`,
        "",
        ...lines,
        "",
        `Fix: import \`${SHARED_CONSTANT}\` from \`@/lib/uploadLimits\` and`,
        `pass it as \`maxNumberOfFiles={${SHARED_CONSTANT}}\`. Single-file`,
        `pickers should keep \`maxNumberOfFiles={1}\` — that is explicitly`,
        `allowed. See the "Upload limits" note in \`replit.md\` for the`,
        `full rule and rationale.`,
        "",
      ].join("\n");
      throw new Error(message);
    }

    // Sanity check: the scanner must actually be looking at the right
    // tree. If the walker returns zero source files (e.g. someone moves
    // the client directory), the test would otherwise pass vacuously.
    expect(files.length).toBeGreaterThan(0);
  });

  it("self-test: detects hard-coded maxNumberOfFiles literals greater than 1 and ignores 1", () => {
    // Inline fixtures so the guard's regex/intent is locked in alongside
    // the production scan. If someone weakens the regex (e.g. starts
    // ignoring all literals, or starts flagging `={1}`) this self-test
    // fails before the production scan goes silent.
    const fixtures: Array<{ src: string; expected: number[] }> = [
      {
        src: `<ObjectUploader maxNumberOfFiles={5}>x</ObjectUploader>`,
        expected: [5],
      },
      {
        src: `<ObjectUploader maxNumberOfFiles={1}>x</ObjectUploader>`,
        expected: [],
      },
      {
        src: `<ObjectUploader maxNumberOfFiles={MAX_BATCH_UPLOAD_FILES}>x</ObjectUploader>`,
        expected: [],
      },
      {
        // Multiple call sites in one file
        src: [
          `<ObjectUploader maxNumberOfFiles={1} />`,
          `<ObjectUploader maxNumberOfFiles={ 20 } />`,
          `<ObjectUploader maxNumberOfFiles={MAX_BATCH_UPLOAD_FILES} />`,
        ].join("\n"),
        expected: [20],
      },
      {
        // Comments must not be flagged
        src: `// maxNumberOfFiles={7} — old default, see PR #X\n<ObjectUploader maxNumberOfFiles={MAX_BATCH_UPLOAD_FILES} />`,
        expected: [],
      },
    ];

    for (const { src, expected } of fixtures) {
      const stripped = stripComments(src);
      const found: number[] = [];
      for (const match of stripped.matchAll(PROP_LITERAL_RE)) {
        const literal = Number(match[1]);
        if (Number.isFinite(literal) && literal > 1) found.push(literal);
      }
      expect(found).toEqual(expected);
    }
  });
});
