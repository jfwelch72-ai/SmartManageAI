#!/usr/bin/env node
/**
 * Codemod: replace `console.log/info/warn/error/debug(...)` calls in
 * server TypeScript files with the structured logger. The logger functions accept
 * variadic args and reduce to a single message + optional Error, so the
 * substitution is purely a rename plus an import top-up.
 *
 * Allow-list:
 *   - `server/utils/logger.ts` is the only sanctioned `console.*` site.
 *
 * Run:
 *   node scripts/codemod-console-to-logger.mjs            # rewrites in place
 *   node scripts/codemod-console-to-logger.mjs --check    # exit 1 if work to do
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = "server";
const ALLOW_LIST = new Set([
  path.normalize("server/utils/logger.ts"),
]);
// Tests are excluded — they can spy on console for assertions.
const SKIP_DIR_RE = /[\\/]__tests__[\\/]/;

const NAME_MAP = {
  log: "logInfo",
  info: "logInfo",
  warn: "logWarn",
  error: "logError",
  debug: "logDebug",
};

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && full.endsWith(".ts")) out.push(full);
  }
  return out;
}

function relImportPath(file) {
  // From `file` to `server/utils/logger`
  const from = path.dirname(file);
  let rel = path.relative(from, "server/utils/logger").replace(/\\/g, "/");
  if (!rel.startsWith(".")) rel = "./" + rel;
  return rel;
}

function rewrite(source) {
  // Replace `console.X(` with the logger fn name, but only when the `.X` token
  // is followed by `(` (i.e. a call expression). Skip `console.X` in strings
  // or comments by walking with a tiny tokenizer.
  const out = [];
  const used = new Set();
  let i = 0;
  let inLine = false;
  let inBlock = false;
  let strQuote = null; // "'" | '"' | '`' | null
  let templateDepth = 0;

  while (i < source.length) {
    const c = source[i];
    const n = source[i + 1];

    if (inLine) {
      out.push(c);
      if (c === "\n") inLine = false;
      i++;
      continue;
    }
    if (inBlock) {
      out.push(c);
      if (c === "*" && n === "/") {
        out.push(n);
        i += 2;
        inBlock = false;
        continue;
      }
      i++;
      continue;
    }
    if (strQuote) {
      out.push(c);
      if (c === "\\") {
        if (n !== undefined) out.push(n);
        i += 2;
        continue;
      }
      if (c === strQuote) {
        strQuote = null;
      }
      i++;
      continue;
    }

    if (c === "/" && n === "/") {
      inLine = true;
      out.push(c);
      i++;
      continue;
    }
    if (c === "/" && n === "*") {
      inBlock = true;
      out.push(c);
      i++;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      strQuote = c;
      out.push(c);
      i++;
      continue;
    }

    // Look for `console.X(`
    if (
      c === "c" &&
      source.startsWith("console.", i) &&
      // Make sure prior char isn't part of an identifier (so we don't match
      // e.g. `myConsole.log`).
      !/[A-Za-z0-9_$.]/.test(source[i - 1] || "")
    ) {
      const after = i + "console.".length;
      const m = source.slice(after).match(/^([A-Za-z]+)\s*\(/);
      if (m && Object.prototype.hasOwnProperty.call(NAME_MAP, m[1])) {
        const target = NAME_MAP[m[1]];
        used.add(target);
        out.push(target);
        // Skip past `console.X` (NOT the `(`)
        i = after + m[1].length;
        continue;
      }
    }

    out.push(c);
    i++;
  }

  return { source: out.join(""), used };
}

function ensureImport(source, file, used) {
  if (used.size === 0) return source;
  const importPath = relImportPath(file);
  // Find an existing import from the logger, append missing names if needed.
  const importRe = new RegExp(
    `import\\s*\\{([^}]*)\\}\\s*from\\s*["'][^"']*utils/logger["'];?`,
  );
  const match = source.match(importRe);
  if (match) {
    const existing = new Set(
      match[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => s.split(/\s+as\s+/)[0].trim()),
    );
    const missing = [...used].filter((n) => !existing.has(n));
    if (missing.length === 0) return source;
    const next = `import { ${[...existing, ...missing].join(", ")} } from "${importPath}";`;
    return source.replace(importRe, next);
  }
  // No existing logger import — add one at the top, after any leading
  // shebang/license comment block.
  const insertAt = (() => {
    // Skip leading comments / whitespace.
    let i = 0;
    while (i < source.length) {
      // Skip whitespace
      while (i < source.length && /\s/.test(source[i])) i++;
      if (source.startsWith("//", i)) {
        const eol = source.indexOf("\n", i);
        i = eol === -1 ? source.length : eol + 1;
        continue;
      }
      if (source.startsWith("/*", i)) {
        const end = source.indexOf("*/", i + 2);
        i = end === -1 ? source.length : end + 2;
        continue;
      }
      break;
    }
    return i;
  })();
  const importLine = `import { ${[...used].join(", ")} } from "${importPath}";\n`;
  return source.slice(0, insertAt) + importLine + source.slice(insertAt);
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const files = walk(ROOT);
  let modified = 0;
  const violations = [];
  for (const file of files) {
    const norm = path.normalize(file);
    if (SKIP_DIR_RE.test(norm)) continue;
    const original = fs.readFileSync(file, "utf8");
    const { source, used } = rewrite(original);
    if (used.size === 0) continue;
    if (ALLOW_LIST.has(norm)) {
      // Allowed — do not rewrite.
      continue;
    }
    const next = ensureImport(source, file, used);
    if (next !== original) {
      modified++;
      if (checkOnly) {
        violations.push(file);
      } else {
        fs.writeFileSync(file, next);
      }
    }
  }
  if (checkOnly && violations.length) {
    console.error(
      `[check-no-console] ${violations.length} file(s) still use console.* under server/:`,
    );
    for (const v of violations) console.error("  - " + v);
    process.exit(1);
  }
  console.log(
    `[codemod] ${checkOnly ? "would rewrite" : "rewrote"} ${modified} file(s).`,
  );
}

main();
