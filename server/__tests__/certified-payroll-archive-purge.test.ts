/**
 * Task #1178: tests for the nightly auto-purge of archived certified payroll
 * PDFs (`processArchivedCertifiedPayrollPurge` exported from
 * `server/payrollRoutes.ts`).
 *
 * The function under test:
 *   - Resolves each org's effective retention window from
 *     `organization_payroll_settings.archived_report_retention_days`
 *     (default 1095 days; 0 disables purging for the org).
 *   - Hard-deletes archived rows whose `archived_at` is older than the
 *     cutoff and best-effort removes the underlying object-storage PDF.
 *   - Writes a single bulk audit_log row per (org, run) attributed to an
 *     active SUPER_ADMIN/ADMIN user; orgs with no admin still purge but
 *     skip the audit row.
 *
 * The db, object storage, and audit logger are mocked in-process so the
 * tests stay hermetic.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

type Row = Record<string, unknown>;

const selectByTable: Record<string, Row[][]> = {};
const selectDistinctQueue: Row[][] = [];
const deleteCalls: Array<{ table: string }> = [];
const auditCalls: Array<Record<string, unknown>> = [];
const objectDeleteCalls: string[] = [];
let nextObjectDeleteFails = false;

function tableName(t: unknown): string {
  if (!t || typeof t !== "object") return "<unknown>";
  for (const sym of Object.getOwnPropertySymbols(t)) {
    if (String(sym).includes("Name")) {
      const v = (t as Record<symbol, unknown>)[sym];
      if (typeof v === "string") return v;
    }
  }
  return "<unknown>";
}

function makeSelectChain(distinct: boolean) {
  let resolvedTable = "<unknown>";
  const chain: Record<string, unknown> = {};
  chain.from = (t: unknown) => {
    resolvedTable = tableName(t);
    return chain;
  };
  chain.where = () => chain;
  chain.innerJoin = () => chain;
  chain.leftJoin = () => chain;
  chain.limit = () => chain;
  chain.orderBy = () => chain;
  chain.groupBy = () => chain;
  const settle = (resolve: (v: Row[]) => unknown, reject?: (e: unknown) => unknown) => {
    try {
      const queue = distinct ? selectDistinctQueue : (selectByTable[resolvedTable] ?? []);
      const next = queue.length ? queue.shift()! : [];
      return Promise.resolve(next).then(resolve, reject);
    } catch (err) {
      return reject ? reject(err) : Promise.reject(err);
    }
  };
  chain.then = settle;
  chain.catch = (reject: (e: unknown) => unknown) => settle((v) => v, reject);
  return chain;
}

const dbMock = {
  execute: async () => ({ rows: [] }),
  select: () => makeSelectChain(false),
  selectDistinct: () => makeSelectChain(true),
  insert: () => ({ values: async () => undefined, returning: async () => [] }),
  update: () => ({ set: () => ({ where: async () => undefined, returning: async () => [] }) }),
  delete: (t: unknown) => {
    deleteCalls.push({ table: tableName(t) });
    return { where: async () => undefined };
  },
};

vi.mock("../db", () => ({ db: dbMock, pool: {} }));

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
}));

vi.mock("../auditLogger", () => ({
  logAudit: vi.fn(async (data: Record<string, unknown>) => {
    auditCalls.push(data);
  }),
  logCreate: vi.fn(),
  logUpdate: vi.fn(),
  logDelete: vi.fn(),
}));

vi.mock("../../objectStorage", () => ({
  ObjectStorageService: class {
    async deleteObjectByKey(key: string): Promise<void> {
      objectDeleteCalls.push(key);
      if (nextObjectDeleteFails) {
        nextObjectDeleteFails = false;
        throw new Error("simulated object storage failure");
      }
    }
  },
  objectStorageClient: {},
}));

vi.mock("../objectStorage", () => ({
  ObjectStorageService: class {
    async deleteObjectByKey(key: string): Promise<void> {
      objectDeleteCalls.push(key);
      if (nextObjectDeleteFails) {
        nextObjectDeleteFails = false;
        throw new Error("simulated object storage failure");
      }
    }
  },
  objectStorageClient: {},
}));

let processArchivedCertifiedPayrollPurge: typeof import("../jobs/certifiedPayrollPurge")["processArchivedCertifiedPayrollPurge"];

beforeEach(async () => {
  for (const k of Object.keys(selectByTable)) delete selectByTable[k];
  selectDistinctQueue.length = 0;
  deleteCalls.length = 0;
  auditCalls.length = 0;
  objectDeleteCalls.length = 0;
  nextObjectDeleteFails = false;
  ({ processArchivedCertifiedPayrollPurge } = await import("../jobs/certifiedPayrollPurge"));
});

function queueOrgsWithArchived(orgIds: string[]) {
  selectDistinctQueue.push(orgIds.map((id) => ({ organizationId: id })));
}
function queueOrgSettings(rows: Row[]) {
  (selectByTable["organization_payroll_settings"] ??= []).push(rows);
}
function queueExpiredReports(rows: Row[]) {
  (selectByTable["certified_payroll_reports"] ??= []).push(rows);
}
function queueAdminLookup(rows: Row[]) {
  (selectByTable["users"] ??= []).push(rows);
}

describe("processArchivedCertifiedPayrollPurge", () => {
  it("does nothing when no org has archived rows", async () => {
    queueOrgsWithArchived([]);
    const result = await processArchivedCertifiedPayrollPurge({ now: new Date("2026-04-23T00:00:00Z") });
    expect(result).toEqual({ orgsProcessed: 0, rowsPurged: 0, storageDeleted: 0, storageFailures: 0 });
    expect(deleteCalls).toHaveLength(0);
    expect(auditCalls).toHaveLength(0);
  });

  it("hard-deletes expired rows, removes object-storage files, and writes one audit row per org", async () => {
    const now = new Date("2026-04-23T03:30:00Z");
    queueOrgsWithArchived(["org-1"]);
    queueOrgSettings([{ retentionDays: 1095 }]);
    const oldArchivedAt = new Date(now.getTime() - 1100 * 24 * 60 * 60 * 1000); // older than 1095 days
    queueExpiredReports([
      { id: "rep-old-1", objectKey: "/payroll/old-1.pdf", archivedAt: oldArchivedAt },
      { id: "rep-old-2", objectKey: "/payroll/old-2.pdf", archivedAt: oldArchivedAt },
    ]);
    queueAdminLookup([{ id: "admin-1" }]);

    const result = await processArchivedCertifiedPayrollPurge({ now });

    expect(result.orgsProcessed).toBe(1);
    expect(result.rowsPurged).toBe(2);
    expect(result.storageDeleted).toBe(2);
    expect(result.storageFailures).toBe(0);
    expect(objectDeleteCalls).toEqual(["/payroll/old-1.pdf", "/payroll/old-2.pdf"]);
    expect(deleteCalls.some((c) => c.table === "certified_payroll_reports")).toBe(true);

    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0].userId).toBe("admin-1");
    expect(auditCalls[0].action).toBe("DELETE");
    expect(auditCalls[0].entityType).toBe("certified_payroll_reports");
    expect(auditCalls[0].entityId).toBe("org-1");
    const newValue = JSON.parse(String(auditCalls[0].newValue));
    expect(newValue.reason).toBe("AUTO_PURGE_ARCHIVED_RETENTION");
    expect(newValue.retentionDays).toBe(1095);
    const oldValue = JSON.parse(String(auditCalls[0].oldValue));
    expect(oldValue.purgedCount).toBe(2);
    expect(oldValue.purgedIds).toEqual(["rep-old-1", "rep-old-2"]);
    expect(oldValue.storageFailures).toBe(0);
  });

  it("skips orgs whose retention window is 0 (disabled)", async () => {
    queueOrgsWithArchived(["org-disabled"]);
    queueOrgSettings([{ retentionDays: 0 }]);

    const result = await processArchivedCertifiedPayrollPurge({ now: new Date() });

    expect(result.orgsProcessed).toBe(0);
    expect(result.rowsPurged).toBe(0);
    expect(deleteCalls).toHaveLength(0);
    expect(auditCalls).toHaveLength(0);
  });

  it("falls back to the 1095-day default when no settings row exists", async () => {
    const now = new Date("2026-04-23T03:30:00Z");
    queueOrgsWithArchived(["org-defaults"]);
    queueOrgSettings([]); // no settings row
    queueExpiredReports([
      { id: "rep-A", objectKey: "/payroll/a.pdf", archivedAt: new Date(now.getTime() - 1200 * 24 * 60 * 60 * 1000) },
    ]);
    queueAdminLookup([{ id: "admin-1" }]);

    const result = await processArchivedCertifiedPayrollPurge({ now });

    expect(result.rowsPurged).toBe(1);
    expect(auditCalls).toHaveLength(1);
    const newValue = JSON.parse(String(auditCalls[0].newValue));
    expect(newValue.retentionDays).toBe(1095);
  });

  it("leaves the DB row in place when object-storage delete fails so the next run can retry", async () => {
    const now = new Date("2026-04-23T03:30:00Z");
    queueOrgsWithArchived(["org-bad-blob"]);
    queueOrgSettings([{ retentionDays: 1095 }]);
    queueExpiredReports([
      { id: "rep-missing-blob", objectKey: "/payroll/missing.pdf", archivedAt: new Date(now.getTime() - 2000 * 24 * 60 * 60 * 1000) },
    ]);
    queueAdminLookup([{ id: "admin-1" }]);
    nextObjectDeleteFails = true;

    const result = await processArchivedCertifiedPayrollPurge({ now });

    expect(result.rowsPurged).toBe(0);
    expect(result.storageDeleted).toBe(0);
    expect(result.storageFailures).toBe(1);
    // No DB delete issued and no audit row written when nothing was purged.
    expect(deleteCalls.filter((c) => c.table === "certified_payroll_reports")).toHaveLength(0);
    expect(auditCalls).toHaveLength(0);
  });

  it("partially succeeds: rows whose blob deleted are purged; failed-blob rows are left for retry", async () => {
    const now = new Date("2026-04-23T03:30:00Z");
    queueOrgsWithArchived(["org-mixed"]);
    queueOrgSettings([{ retentionDays: 1095 }]);
    queueExpiredReports([
      { id: "rep-fails", objectKey: "/payroll/fails.pdf", archivedAt: new Date(now.getTime() - 2000 * 24 * 60 * 60 * 1000) },
      { id: "rep-ok", objectKey: "/payroll/ok.pdf", archivedAt: new Date(now.getTime() - 2000 * 24 * 60 * 60 * 1000) },
    ]);
    queueAdminLookup([{ id: "admin-1" }]);
    nextObjectDeleteFails = true; // only the first storage delete fails

    const result = await processArchivedCertifiedPayrollPurge({ now });

    expect(result.rowsPurged).toBe(1);
    expect(result.storageDeleted).toBe(1);
    expect(result.storageFailures).toBe(1);
    expect(deleteCalls.filter((c) => c.table === "certified_payroll_reports")).toHaveLength(1);
    expect(auditCalls).toHaveLength(1);
    const oldValue = JSON.parse(String(auditCalls[0].oldValue));
    expect(oldValue.purgedIds).toEqual(["rep-ok"]);
    expect(oldValue.failedRowIds).toEqual(["rep-fails"]);
    expect(oldValue.storageFailures).toBe(1);
    expect(oldValue.storageDeleted).toBe(1);
  });

  it("records a per-run sample (deleted, hardDeleted, durationMs) via recordJobMetrics (Task #1523)", async () => {
    const now = new Date("2026-04-23T03:30:00Z");
    queueOrgsWithArchived(["org-1"]);
    queueOrgSettings([{ retentionDays: 1095 }]);
    const oldArchivedAt = new Date(now.getTime() - 1100 * 24 * 60 * 60 * 1000);
    queueExpiredReports([
      { id: "rep-1", objectKey: "/payroll/1.pdf", archivedAt: oldArchivedAt },
      { id: "rep-2", objectKey: "/payroll/2.pdf", archivedAt: oldArchivedAt },
    ]);
    queueAdminLookup([{ id: "admin-1" }]);

    const { resetJobMetrics, getJobMetrics } = await import("../utils/jobMetrics");
    resetJobMetrics();

    await processArchivedCertifiedPayrollPurge({ now });

    const metrics = getJobMetrics("certified_payroll_purge");
    expect(metrics.samples).toHaveLength(1);
    expect(metrics.samples[0].counters.deleted).toBe(2);
    expect(metrics.samples[0].counters.hardDeleted).toBe(2);
    expect(metrics.samples[0].counters.storageDeleted).toBe(2);
    expect(metrics.samples[0].counters.storageFailures).toBe(0);
    expect(metrics.samples[0].counters.orgsProcessed).toBe(1);
    expect(typeof metrics.samples[0].counters.durationMs).toBe("number");
  });

  it("records an empty-run sample when no orgs have archived rows (Task #1523)", async () => {
    queueOrgsWithArchived([]);

    const { resetJobMetrics, getJobMetrics } = await import("../utils/jobMetrics");
    resetJobMetrics();

    await processArchivedCertifiedPayrollPurge({ now: new Date("2026-04-23T03:30:00Z") });

    const metrics = getJobMetrics("certified_payroll_purge");
    expect(metrics.samples).toHaveLength(1);
    expect(metrics.samples[0].counters.deleted).toBe(0);
    expect(metrics.samples[0].counters.hardDeleted).toBe(0);
    expect(metrics.samples[0].counters.storageDeleted).toBe(0);
    expect(metrics.samples[0].counters.storageFailures).toBe(0);
    expect(metrics.samples[0].counters.orgsProcessed).toBe(0);
  });

  it("records storage failures separately from successful deletes (Task #1523)", async () => {
    const now = new Date("2026-04-23T03:30:00Z");
    queueOrgsWithArchived(["org-mixed"]);
    queueOrgSettings([{ retentionDays: 1095 }]);
    queueExpiredReports([
      { id: "rep-fails", objectKey: "/payroll/fails.pdf", archivedAt: new Date(now.getTime() - 2000 * 24 * 60 * 60 * 1000) },
      { id: "rep-ok", objectKey: "/payroll/ok.pdf", archivedAt: new Date(now.getTime() - 2000 * 24 * 60 * 60 * 1000) },
    ]);
    queueAdminLookup([{ id: "admin-1" }]);
    nextObjectDeleteFails = true;

    const { resetJobMetrics, getJobMetrics } = await import("../utils/jobMetrics");
    resetJobMetrics();

    await processArchivedCertifiedPayrollPurge({ now });

    const metrics = getJobMetrics("certified_payroll_purge");
    expect(metrics.samples).toHaveLength(1);
    expect(metrics.samples[0].counters.deleted).toBe(1);
    expect(metrics.samples[0].counters.hardDeleted).toBe(1);
    expect(metrics.samples[0].counters.storageDeleted).toBe(1);
    expect(metrics.samples[0].counters.storageFailures).toBe(1);
  });

  it("still purges when no admin user is available (skips audit instead of aborting)", async () => {
    const now = new Date("2026-04-23T03:30:00Z");
    queueOrgsWithArchived(["org-no-admin"]);
    queueOrgSettings([{ retentionDays: 1095 }]);
    queueExpiredReports([
      { id: "rep-orphan", objectKey: "/payroll/orphan.pdf", archivedAt: new Date(now.getTime() - 1500 * 24 * 60 * 60 * 1000) },
    ]);
    queueAdminLookup([]); // no admin returned

    const result = await processArchivedCertifiedPayrollPurge({ now });

    expect(result.rowsPurged).toBe(1);
    expect(deleteCalls.some((c) => c.table === "certified_payroll_reports")).toBe(true);
    expect(auditCalls).toHaveLength(0);
  });
});
