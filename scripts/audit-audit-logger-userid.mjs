#!/usr/bin/env node
// Audit: catch passing the Express Request as the userId to the audit
// helpers in server/auditLogger.ts.
//
// Background (Task #1454 / #1492): two call sites in
// server/projectOpsRoutes.ts called
//   logCreate(req, "plan_document", id, value, req)
// instead of
//   logCreate(req.user!.id, "plan_document", id, value, req)
//
// The Neon driver then tried to JSON.stringify the whole Request — including
// its underlying Socket — and failed with
//   "Converting circular structure to JSON"
// which auditLogger.ts swallows in its try/catch, silently dropping the audit
// row for every cloud document import.
//
// This lint scans server/ for the same shape of bug and exits non-zero so CI
// blocks the merge.
//
// Patterns flagged:
//   logCreate(req, ...)
//   logUpdate(req, ...)
//   logDelete(req, ...)
//   logApprove(req, ...)
//   logReject(req, ...)
//   logAudit({ userId: req, ... }, ...)
//   logAudit({ userId: req.foo, ... }, ...)        (anything other than .user.id / .user?.id)
//   log{Create,Update,...}(req.foo, ...)           (anything other than req.user.id / req.user?.id)
//
// Where the first identifier matches /^_?(req|request|ctx|httpReq)$/i.

import fs from "node:fs";
import { spawnSync } from "node:child_process";

const POSITIONAL_HELPERS = [
  "logCreate",
  "logUpdate",
  "logDelete",
  "logApprove",
  "logReject",
];

const REQUEST_NAME = /^_?(req|request|ctx|httpReq)$/i;

// Use spawnSync so ripgrep's "no matches" exit code (1) is handled as an
// empty result rather than a thrown exception — important if a future tree
// happens to have zero audit-helper call sites.
const rg = spawnSync(
  "rg",
  [
    "-l",
    "--type",
    "ts",
    "log(Audit|Create|Update|Delete|Approve|Reject)\\s*\\(",
    "server/",
  ],
  { encoding: "utf8" },
);
if (rg.status !== 0 && rg.status !== 1) {
  console.error(`ripgrep failed (exit ${rg.status}): ${rg.stderr}`);
  process.exit(2);
}
const files = (rg.stdout || "")
  .trim()
  .split("\n")
  .filter(Boolean)
  // The audit helpers themselves are exempt because they define the
  // signatures, and the dedicated regression tests under server/__tests__/
  // are exempt because they exist precisely to exercise these call shapes
  // (including, intentionally, the bad ones via casts).
  .filter(
    (f) => f !== "server/auditLogger.ts" && !f.includes("/__tests__/"),
  );

// Replace comments and string/template-literal contents with spaces of the
// same length so byte offsets — and therefore line numbers — are preserved
// while regex scans cannot match against text inside comments or strings.
function stripCommentsAndStrings(src) {
  const out = src.split("");
  let i = 0;
  let inLine = false;
  let inBlock = false;
  let strQuote = null;
  let tplDepth = 0; // depth of `...` template literals (no ${} tracking — close enough)
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (inLine) {
      if (c === "\n") inLine = false;
      else out[i] = " ";
      i++;
      continue;
    }
    if (inBlock) {
      if (c === "*" && n === "/") { out[i] = " "; out[i + 1] = " "; i += 2; inBlock = false; continue; }
      if (c !== "\n") out[i] = " ";
      i++;
      continue;
    }
    if (strQuote) {
      if (c === "\\") { out[i] = " "; if (i + 1 < src.length && src[i + 1] !== "\n") out[i + 1] = " "; i += 2; continue; }
      if (c === strQuote) { strQuote = null; i++; continue; }
      if (c !== "\n") out[i] = " ";
      i++;
      continue;
    }
    if (tplDepth > 0) {
      if (c === "\\") { out[i] = " "; if (i + 1 < src.length && src[i + 1] !== "\n") out[i + 1] = " "; i += 2; continue; }
      if (c === "`") { tplDepth--; i++; continue; }
      if (c !== "\n") out[i] = " ";
      i++;
      continue;
    }
    if (c === "/" && n === "/") { out[i] = " "; out[i + 1] = " "; inLine = true; i += 2; continue; }
    if (c === "/" && n === "*") { out[i] = " "; out[i + 1] = " "; inBlock = true; i += 2; continue; }
    if (c === '"' || c === "'") { strQuote = c; i++; continue; }
    if (c === "`") { tplDepth++; i++; continue; }
    i++;
  }
  return out.join("");
}

function lineOf(src, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < src.length; i++) if (src[i] === "\n") line++;
  return line;
}

// Walk forward from `start` (which should be just after the `(`) and return
// the substring containing the first top-level argument, plus the offset of
// the comma or closing paren that terminated it.
function readFirstArg(src, start) {
  let depth = 0;
  let i = start;
  let inStr = null;
  let inTpl = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (inStr) {
      if (c === "\\") { i += 2; continue; }
      if (c === inStr) inStr = null;
      i++;
      continue;
    }
    if (inTpl) {
      if (c === "\\") { i += 2; continue; }
      if (c === "`") { inTpl--; i++; continue; }
      if (c === "$" && n === "{") { depth++; i += 2; continue; }
      i++;
      continue;
    }
    if (c === "/" && n === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && n === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") { inStr = c; i++; continue; }
    if (c === "`") { inTpl++; i++; continue; }
    if (c === "(" || c === "[" || c === "{") { depth++; i++; continue; }
    if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) return { arg: src.slice(start, i).trim(), end: i };
      depth--;
      i++;
      continue;
    }
    if (c === "," && depth === 0) {
      return { arg: src.slice(start, i).trim(), end: i };
    }
    i++;
  }
  return null;
}

function isAllowedRequestIdRef(arg) {
  // Allow `req.user.id`, `req.user?.id`, `req.user!.id`, `req?.user?.id`,
  // and the same with any /^_?(req|request|ctx|httpReq)$/i prefix.
  // Also allow common alias chains like `req.session.user.id`.
  return /^_?(?:req|request|ctx|httpReq)[?!]?\.(?:user|session\.user)[?!]?\.id$/i.test(
    arg
  );
}

function classifyFirstArg(arg) {
  // Returns { offending: boolean, reason?: string }
  // Strip a trailing TS non-null assertion to compare bare identifiers.
  const bare = arg.replace(/!$/, "");
  if (REQUEST_NAME.test(bare)) {
    return { offending: true, reason: `passes the request object \`${bare}\` as userId` };
  }
  // Member access on a request-shaped root — only allowed when it ends in
  // `.user.id` (or session.user.id), per isAllowedRequestIdRef.
  const rootMatch = bare.match(/^([A-Za-z_$][\w$]*)[?!]?\./);
  if (rootMatch && REQUEST_NAME.test(rootMatch[1])) {
    if (!isAllowedRequestIdRef(bare)) {
      return {
        offending: true,
        reason: `passes \`${bare}\` as userId (expected \`${rootMatch[1]}.user.id\`)`,
      };
    }
  }
  return { offending: false };
}

const offenders = [];

for (const file of files) {
  const rawSrc = fs.readFileSync(file, "utf8");
  const src = stripCommentsAndStrings(rawSrc);

  // Positional helpers: first argument must be the userId string.
  for (const helper of POSITIONAL_HELPERS) {
    const re = new RegExp(`\\b${helper}\\s*\\(`, "g");
    let m;
    while ((m = re.exec(src)) !== null) {
      const argStart = m.index + m[0].length;
      const parsed = readFirstArg(src, argStart);
      if (!parsed) continue;
      const { offending, reason } = classifyFirstArg(parsed.arg);
      if (offending) {
        offenders.push({
          file,
          line: lineOf(src, m.index),
          helper,
          reason,
        });
      }
    }
  }

  // logAudit({ userId: ..., ... }, req)
  const auditRe = /\blogAudit\s*\(\s*\{/g;
  let am;
  while ((am = auditRe.exec(src)) !== null) {
    const objStart = am.index + am[0].length;
    // Find matching closing brace for this object literal at depth 0.
    let depth = 1;
    let i = objStart;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      if (depth === 0) break;
      i++;
    }
    if (depth !== 0) continue;
    const objBody = src.slice(objStart, i);
    // Find a top-level `userId:` field. We do a simple scan that ignores
    // nested braces.
    let d = 0;
    let userIdValueStart = -1;
    for (let j = 0; j < objBody.length; j++) {
      const c = objBody[j];
      if (c === "{" || c === "[" || c === "(") d++;
      else if (c === "}" || c === "]" || c === ")") d--;
      if (d === 0 && objBody.slice(j, j + 7).match(/^userId\s*:/)) {
        userIdValueStart = j + objBody.slice(j).match(/^userId\s*:/)[0].length;
        break;
      }
    }
    if (userIdValueStart === -1) continue;
    // Read the value up to the next top-level comma or end of object.
    let dd = 0;
    let k = userIdValueStart;
    while (k < objBody.length) {
      const c = objBody[k];
      if (c === "{" || c === "[" || c === "(") dd++;
      else if (c === "}" || c === "]" || c === ")") {
        if (dd === 0) break;
        dd--;
      } else if (c === "," && dd === 0) break;
      k++;
    }
    const value = objBody.slice(userIdValueStart, k).trim();
    const { offending, reason } = classifyFirstArg(value);
    if (offending) {
      offenders.push({
        file,
        line: lineOf(src, am.index),
        helper: "logAudit",
        reason: reason.replace("as userId", "as { userId }"),
      });
    }
  }
}

if (offenders.length > 0) {
  console.error(
    `Found ${offenders.length} audit-logger call(s) passing a request object where a user id string is expected:`
  );
  for (const o of offenders) {
    console.error(`  ${o.file}:${o.line}  ${o.helper}(...)  ${o.reason}`);
  }
  console.error(
    "\nFix: pass `req.user!.id` (or the equivalent string) as the userId, and the Request as the trailing optional argument."
  );
  console.error(
    "See server/auditLogger.ts and the regression test in server/__tests__/audit-logger-circular-request.test.ts."
  );
  process.exit(1);
}

console.log(
  `OK: scanned ${files.length} server file(s); no audit-logger call passes a request object as the userId.`
);
