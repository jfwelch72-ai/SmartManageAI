/**
 * Task #1492 — fixture test for scripts/audit-audit-logger-userid.mjs.
 *
 * Verifies that the lint:
 *   - exits non-zero and names the offending call when a route passes a
 *     request-shaped argument as the userId, and
 *   - exits zero on the well-formed call sites already in server/.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const SCRIPT = path.resolve(process.cwd(), "scripts/audit-audit-logger-userid.mjs");

function runIn(dir: string) {
  return spawnSync("node", [SCRIPT], { cwd: dir, encoding: "utf8" });
}

describe("audit-audit-logger-userid lint", () => {
  it("flags logCreate(req, ...) and logAudit({ userId: req }, ...) call shapes", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "audit-lint-"));
    try {
      mkdirSync(path.join(dir, "server"), { recursive: true });
      const offender = `
import { logCreate, logAudit, logUpdate } from "./auditLogger";
export async function bad(req: any) {
  await logCreate(req, "plan_document", "doc-1", { source: "url" }, req);
  await logAudit({
    userId: req,
    entityType: "plan_document",
    entityId: "doc-2",
    action: "CREATE",
    oldValue: null,
    newValue: "{}",
  }, req);
  await logUpdate(req.body, "plan_document", "doc-3", null, { ok: true }, req);
}
`;
      writeFileSync(path.join(dir, "server", "badRoutes.ts"), offender);
      // Stub auditLogger.ts so the lint's exclusion doesn't matter here.
      writeFileSync(
        path.join(dir, "server", "auditLogger.ts"),
        "export const logCreate=()=>{};export const logAudit=()=>{};export const logUpdate=()=>{};",
      );
      const res = runIn(dir);
      expect(res.status).toBe(1);
      expect(res.stderr).toMatch(/logCreate/);
      expect(res.stderr).toMatch(/logAudit/);
      expect(res.stderr).toMatch(/logUpdate/);
      expect(res.stderr).toMatch(/badRoutes\.ts/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("passes on well-formed call sites", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "audit-lint-ok-"));
    try {
      mkdirSync(path.join(dir, "server"), { recursive: true });
      const good = `
import { logCreate, logAudit } from "./auditLogger";
export async function ok(req: any) {
  await logCreate(req.user!.id, "plan_document", "doc-1", { source: "url" }, req);
  await logAudit({
    userId: req.user!.id,
    entityType: "plan_document",
    entityId: "doc-2",
    action: "CREATE",
    oldValue: null,
    newValue: "{}",
  }, req);
}
`;
      writeFileSync(path.join(dir, "server", "okRoutes.ts"), good);
      writeFileSync(
        path.join(dir, "server", "auditLogger.ts"),
        "export const logCreate=()=>{};export const logAudit=()=>{};",
      );
      const res = runIn(dir);
      expect(res.status).toBe(0);
      expect(res.stdout).toMatch(/OK:/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
