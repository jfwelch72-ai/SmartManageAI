/**
 * Task #1539 — CI guard against the registration-order shadowing bug
 * first surfaced by Task #1495.
 *
 * Express matches routes in registration order. When a parametric
 * handler (e.g. `GET /api/admin/metrics/jobs/:jobName`) is registered
 * BEFORE a literal sibling (`GET /api/admin/metrics/jobs/alerts`), the
 * parametric one wins for `/api/admin/metrics/jobs/alerts` and the
 * literal handler is dead code — silently returning the wrong payload.
 *
 * This test statically scans every `server/**\/*.ts` source file for
 * route registrations on `app.<method>(...)` / `router.<method>(...)`
 * style calls and fails when a parametric route at depth N is
 * registered before a literal sibling at depth N within the same file
 * + same router instance + same HTTP method.
 *
 * Allowlist: a small set of intentional pairs that are protected by
 * an explicit `if (req.params.X === "literal") return next();` guard
 * inside the parametric handler. New shadows must either be guarded
 * AND added here with a comment, or the offending literal must be
 * registered before the parametric (preferred — see the docstring at
 * the top of `wage-refresh-alert-thresholds-route.test.ts`).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const SERVER_ROOT = "server";

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__" || entry === "node_modules" || entry === "migrations") {
      continue;
    }
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) {
      walk(p, files);
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      files.push(p);
    }
  }
  return files;
}

type RouteCall = {
  file: string;
  line: number;
  obj: string;
  method: string;
  path: string;
};

// Match `<obj>.<method>("path"...` where obj looks like an Express
// app/router. We intentionally match common router naming conventions
// (`app`, `router`, anything ending in `Router`) so we don't miss
// custom-named routers but also don't pick up e.g. `db.get(...)`.
const ROUTE_RE =
  /\b(app|router|publicRouter|opsRouter|portalRouter|webRouter|apiRouter|[A-Za-z_$][\w$]*Router)\s*\.\s*(get|post|put|patch|delete|all)\s*\(\s*(['"`])([^'"`]+)\3/g;

function extractRoutes(): RouteCall[] {
  const routes: RouteCall[] = [];
  for (const file of walk(SERVER_ROOT)) {
    const src = readFileSync(file, "utf8");
    let m: RegExpExecArray | null;
    ROUTE_RE.lastIndex = 0;
    while ((m = ROUTE_RE.exec(src)) !== null) {
      const before = src.slice(0, m.index);
      const line = before.split("\n").length;
      routes.push({
        file,
        line,
        obj: m[1],
        method: m[2].toLowerCase(),
        path: m[4],
      });
    }
  }
  return routes;
}

function segments(p: string): string[] {
  return p.split("/").filter(Boolean);
}

function isParam(seg: string): boolean {
  return seg.startsWith(":") || seg === "*";
}

type Shadow = { A: RouteCall; B: RouteCall };

function findShadows(routes: RouteCall[]): Shadow[] {
  const buckets = new Map<string, RouteCall[]>();
  for (const r of routes) {
    const key = `${r.file}|${r.obj}|${r.method}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(r);
  }
  const shadows: Shadow[] = [];
  for (const list of buckets.values()) {
    list.sort((a, b) => a.line - b.line);
    for (let i = 0; i < list.length; i++) {
      const A = list[i];
      const aSegs = segments(A.path);
      if (!aSegs.some(isParam)) continue;
      for (let j = i + 1; j < list.length; j++) {
        const B = list[j];
        const bSegs = segments(B.path);
        if (aSegs.length !== bSegs.length) continue;
        let conflicts = true;
        let coversLiteral = false;
        for (let s = 0; s < aSegs.length; s++) {
          const aS = aSegs[s];
          const bS = bSegs[s];
          if (aS === bS) continue;
          if (isParam(aS) && !isParam(bS)) {
            coversLiteral = true;
            continue;
          }
          // A literal vs B different => no shadow possible
          conflicts = false;
          break;
        }
        if (conflicts && coversLiteral) {
          shadows.push({ A, B });
        }
      }
    }
  }
  return shadows;
}

// Intentional shadows that are protected by an explicit
// `if (req.params.X === "literal") return next();` guard inside the
// parametric handler. Each entry MUST be accompanied by a real guard
// in the source — see Task #1539 sweep. Format: `<file>:<METHOD> <param-path> -> <literal-path>`.
const ALLOWED_SHADOWS = new Set<string>([
  // server/routes.ts — Task #1495 fix: `/api/admin/metrics/jobs/:jobName`
  // bails out with `next()` when the segment is "alerts".
  'server/routes.ts:GET /api/admin/metrics/jobs/:jobName -> /api/admin/metrics/jobs/alerts',
  // server/sovRoutes.ts — Task #1539 fix: `/sov/:id` bails out with
  // `next()` when the segment is one of the reserved literals.
  'server/sovRoutes.ts:GET /sov/:id -> /sov/co-tieout',
  'server/sovRoutes.ts:GET /sov/:id -> /sov/lien-waivers',
  'server/sovRoutes.ts:GET /sov/:id -> /sov/payments',
]);

function shadowKey(s: Shadow): string {
  return `${s.A.file}:${s.A.method.toUpperCase()} ${s.A.path} -> ${s.B.path}`;
}

describe("Route shadowing guard (Task #1539)", () => {
  const routes = extractRoutes();
  const shadows = findShadows(routes);

  it("does not introduce new parametric-before-literal shadows", () => {
    const offenders = shadows.filter((s) => !ALLOWED_SHADOWS.has(shadowKey(s)));
    if (offenders.length > 0) {
      const lines = offenders.map(
        (s) =>
          `  - ${s.A.file}:${s.A.line}  ${s.A.method.toUpperCase()} ${s.A.path}\n` +
          `      shadows  ${s.B.file}:${s.B.line}  ${s.B.method.toUpperCase()} ${s.B.path}`,
      );
      throw new Error(
        `Found ${offenders.length} parametric route(s) shadowing later literal sibling(s). ` +
          `Either reorder so the literal is registered first, or guard the parametric ` +
          `handler with an explicit \`if (req.params.X === "literal") return next();\` ` +
          `and add the pair to ALLOWED_SHADOWS in route-shadowing-guard.test.ts.\n` +
          lines.join("\n"),
      );
    }
    expect(offenders).toEqual([]);
  });

  it("verifies every entry in the allowlist still corresponds to a real shadow", () => {
    const found = new Set(shadows.map(shadowKey));
    const stale: string[] = [];
    for (const allowed of ALLOWED_SHADOWS) {
      if (!found.has(allowed)) stale.push(allowed);
    }
    expect(
      stale,
      `ALLOWED_SHADOWS contains entries that are no longer in the source. ` +
        `Remove them so the allowlist stays meaningful:\n${stale.join("\n")}`,
    ).toEqual([]);
  });

  it("verifies each allowlisted parametric handler still has an explicit `next()` guard", () => {
    // Cheap sanity check: read the file containing each allowlisted
    // parametric route and confirm the literal segment appears in a
    // guard somewhere (e.g. `=== "alerts"` or `.has(id)`). This won't
    // catch every bad refactor, but it catches the obvious "someone
    // deleted the guard" mistake.
    const missing: string[] = [];
    for (const allowed of ALLOWED_SHADOWS) {
      const colon = allowed.indexOf(":");
      const filePart = allowed.slice(0, colon);
      const rest = allowed.slice(colon + 1);
      const literal = rest.split(" -> ")[1].split("/").filter(Boolean).pop()!;
      const src = readFileSync(filePart, "utf8");
      const guardPattern = new RegExp(
        `(===\\s*['"\`]${literal}['"\`])|\\.has\\(`,
      );
      if (!guardPattern.test(src)) {
        missing.push(`${allowed}  (no guard mentioning "${literal}" found in ${filePart})`);
      }
    }
    expect(missing).toEqual([]);
  });
});
