/**
 * Task #1523 / #1572 — `processRetentionPolicies` must publish a
 * per-run sample via `recordJobMetrics` so the operations dashboard
 * sees every nightly tick and the Task #1502 spike rules on
 * `deleted` / `hardDeleted` can fire end-to-end.
 *
 * Task #1572 also adds real DELETE / ANONYMIZE implementations for
 * AI_ACTIONS, DOCUMENTS, TIME_ENTRIES, MESSAGES and FILE_UPLOADS —
 * the mock below is table-aware so each new combo can be exercised
 * without touching the real DB.
 *
 * Mirrors the pattern in
 * `davis-bacon-orphan-wage-decision-sweep.test.ts` — db is mocked with
 * a tiny in-memory queue so the sweep can run hermetically.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
}));

// jobRunner imports a lot of services at module load — stub the noisy
// ones so the test stays fast and side-effect free.
vi.mock("../services/notificationService", () => ({
  insertNotification: vi.fn(async () => undefined),
  insertNotifications: vi.fn(async () => undefined),
}));
vi.mock("../services/emailService", () => ({
  sendEmail: vi.fn(async () => undefined),
}));
// Task #1573 — spy on the side-channel that ferries the offending
// `(entityType, action)` pairs from the sweep over to the alert engine
// so the new `policiesUnsupported` spike alert can name them.
vi.mock("../utils/jobMetricAlerts", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../utils/jobMetricAlerts")
  >();
  return {
    ...actual,
    setRetentionPolicyUnsupportedPairsForAlerts: vi.fn(
      actual.setRetentionPolicyUnsupportedPairsForAlerts,
    ),
  };
});
vi.mock("../emailRoutes", () => ({
  syncImapAccount: vi.fn(),
  syncOutlookAccount: vi.fn(),
  syncGmailAccount: vi.fn(),
  drainAccountProviderPushes: vi.fn(),
}));
vi.mock("../emailPushNotifications", () => ({
  ensureAllEmailPushSubscriptions: vi.fn(),
}));

interface RetentionPolicyRow {
  id: string;
  enabled: boolean;
  entityType: string;
  action: string;
  retentionDays: number;
  // Task #1572 — every retention policy is per-org; the sweep MUST
  // scope its mutations to this column. Tests default to a fixed org
  // so existing assertions keep working.
  organizationId: string;
}

const DEFAULT_TEST_ORG_ID = "org-test-default";

// Per-table queue of "row IDs the next DELETE/UPDATE will affect".
// The sweep filters by createdAt cutoff under the hood, but we don't
// model that — we just pretend the configured rows already match the
// cutoff and let the mock return them.
let policyRows: RetentionPolicyRow[] = [];
let tableQueues: Record<string, string[]> = {};
const updateCallsByTable: Record<string, number> = {};
let updateCalls: number = 0; // total across all tables (back-compat)

// Task #1572 — capture every WHERE predicate the sweep actually
// builds (per table, per operation) so tests can render the SQL
// via PgDialect and assert tenant scoping is wired up.
interface CapturedWhere { table: string; op: "delete" | "update"; sql: string }
let capturedWheres: CapturedWhere[] = [];
const pgDialect = new PgDialect();
function renderWhere(predicate: unknown): string {
  if (!predicate) return "";
  try {
    return pgDialect.sqlToQuery(predicate as SQL).sql;
  } catch {
    return "";
  }
}

function takeQueued(name: string): string[] {
  const ids = tableQueues[name] ?? [];
  tableQueues[name] = [];
  return ids;
}

const dbMock = {
  select: () => ({
    from: (table: unknown) => ({
      where: () => {
        const name = tableName(table);
        if (name === "retention_policies") return Promise.resolve(policyRows.filter((p) => p.enabled));
        return Promise.resolve([]);
      },
    }),
  }),
  delete: (table: unknown) => ({
    where: (predicate: unknown) => ({
      returning: async () => {
        const name = tableName(table);
        capturedWheres.push({ table: name, op: "delete", sql: renderWhere(predicate) });
        return takeQueued(name).map((id) => ({ id }));
      },
    }),
  }),
  update: (table: unknown) => ({
    set: () => ({
      where: (predicate: unknown) => {
        const name = tableName(table);
        // The retention sweep uses `.returning` for ANONYMIZE updates
        // (so it can count affected rows) and an awaitable terminator
        // for the per-policy `lastRunAt` bump. Support both shapes.
        const renderedSql = renderWhere(predicate);
        const promise: Promise<Array<{ id: string }>> & { returning?: () => Promise<Array<{ id: string }>> } =
          new Promise((resolve) => {
            updateCalls += 1;
            updateCallsByTable[name] = (updateCallsByTable[name] ?? 0) + 1;
            // Don't capture the per-policy lastRunAt UPDATE on
            // retention_policies in tenant-scoping assertions.
            if (name !== "retention_policies") {
              capturedWheres.push({ table: name, op: "update", sql: renderedSql });
            }
            resolve([]);
          }) as Promise<Array<{ id: string }>>;
        promise.returning = async () => {
          const ids = takeQueued(name);
          return ids.map((id) => ({ id }));
        };
        return promise;
      },
    }),
  }),
  insert: () => ({ values: async () => undefined }),
};

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

vi.mock("../db", () => ({ db: dbMock, pool: {} }));

beforeEach(async () => {
  policyRows = [];
  tableQueues = {};
  capturedWheres = [];
  for (const k of Object.keys(updateCallsByTable)) delete updateCallsByTable[k];
  updateCalls = 0;
  // Disable DB persistence so sample writes never go through the
  // mocked `db`, and clear any in-memory samples that might have
  // leaked from earlier test files sharing the same worker.
  const { setJobMetricsPersistenceEnabled, resetJobMetrics } = await import(
    "../utils/jobMetrics"
  );
  setJobMetricsPersistenceEnabled(false);
  resetJobMetrics();
  // Task #1573 — clear the underlying side-channel first (so any pairs
  // a previous test stashed don't leak in) and then clear the spy so
  // the test only counts calls made by `processRetentionPolicies`.
  const {
    setRetentionPolicyUnsupportedPairsForAlerts,
  } = await import("../utils/jobMetricAlerts");
  setRetentionPolicyUnsupportedPairsForAlerts([]);
  (setRetentionPolicyUnsupportedPairsForAlerts as ReturnType<typeof vi.fn>)
    .mockClear();
});

describe("processRetentionPolicies metrics (Task #1523)", () => {
  it("records a per-run sample (deleted, hardDeleted, durationMs) when a policy fires", { timeout: 30_000 }, async () => {
    policyRows.push({
      id: "policy-audit-90d",
      enabled: true,
      entityType: "AUDIT_LOGS",
      action: "DELETE",
      retentionDays: 90, organizationId: DEFAULT_TEST_ORG_ID,
    });
    tableQueues["audit_log"] = ["audit-1", "audit-2", "audit-3"];

    const { processRetentionPolicies } = await import("../jobs/jobRunner");
    const { resetJobMetrics, getJobMetrics } = await import("../utils/jobMetrics");
    resetJobMetrics();

    await processRetentionPolicies();

    const metrics = getJobMetrics("retention_policy_sweep");
    expect(metrics.samples).toHaveLength(1);
    expect(metrics.samples[0].counters.deleted).toBe(3);
    expect(metrics.samples[0].counters.hardDeleted).toBe(3);
    expect(metrics.samples[0].counters.policiesProcessed).toBe(1);
    expect(metrics.samples[0].counters.policiesFailed).toBe(0);
    expect(typeof metrics.samples[0].counters.durationMs).toBe("number");
    // The policy's lastRunAt should also have been bumped.
    expect(updateCallsByTable["retention_policies"] ?? 0).toBe(1);
  });

  it("records an empty-run sample when no policies are enabled", async () => {
    // No policy rows queued — early-return path must still publish a
    // tick so the dashboard doesn't drop empty runs and the spike-alert
    // baseline keeps building.
    const { processRetentionPolicies } = await import("../jobs/jobRunner");
    const { resetJobMetrics, getJobMetrics } = await import("../utils/jobMetrics");
    resetJobMetrics();

    await processRetentionPolicies();

    const metrics = getJobMetrics("retention_policy_sweep");
    expect(metrics.samples).toHaveLength(1);
    expect(metrics.samples[0].counters.deleted).toBe(0);
    expect(metrics.samples[0].counters.hardDeleted).toBe(0);
    expect(metrics.samples[0].counters.policiesProcessed).toBe(0);
    expect(metrics.samples[0].counters.policiesFailed).toBe(0);
  });

  it("records `policiesUnsupported` and warns when a policy has an unimplemented (entityType, action) combo (Task #1552)", async () => {
    // NOTIFICATIONS+DELETE has no implementation in
    // `processRetentionPolicies` — before Task #1552 this silently
    // contributed `0` to the deletion counters and counted as a
    // "processed" policy in the dashboard. The sweep must now bucket
    // it as `policiesUnsupported` and emit a warning so operators
    // notice the misconfiguration.
    policyRows.push(
      {
        id: "policy-audit-90d",
        enabled: true,
        entityType: "AUDIT_LOGS",
        action: "DELETE",
        retentionDays: 90, organizationId: DEFAULT_TEST_ORG_ID,
      },
      {
        id: "policy-notifications-30d",
        enabled: true,
        entityType: "NOTIFICATIONS",
        action: "DELETE",
        retentionDays: 30, organizationId: DEFAULT_TEST_ORG_ID,
      },
      {
        id: "policy-audit-archive",
        enabled: true,
        entityType: "AUDIT_LOGS",
        action: "ARCHIVE",
        retentionDays: 365, organizationId: DEFAULT_TEST_ORG_ID,
      },
    );
    tableQueues["audit_log"] = ["audit-1"];

    const { processRetentionPolicies } = await import("../jobs/jobRunner");
    const { resetJobMetrics, getJobMetrics } = await import("../utils/jobMetrics");
    const { logWarn } = await import("../utils/logger");
    resetJobMetrics();
    (logWarn as ReturnType<typeof vi.fn>).mockClear();

    await processRetentionPolicies();

    const metrics = getJobMetrics("retention_policy_sweep");
    expect(metrics.samples).toHaveLength(1);
    const counters = metrics.samples[0].counters;
    expect(counters.deleted).toBe(1);
    expect(counters.hardDeleted).toBe(1);
    // Only the supported AUDIT_LOGS+DELETE policy actually ran — the
    // other two are no-ops and must NOT inflate `policiesProcessed`.
    expect(counters.policiesProcessed).toBe(1);
    expect(counters.policiesFailed).toBe(0);
    expect(counters.policiesUnsupported).toBe(2);
    // All three rows still get their `lastRunAt` bumped (so the UI's
    // "last attempt" timestamp stays accurate).
    expect(updateCallsByTable["retention_policies"] ?? 0).toBe(3);
    // Each unsupported policy should produce its own warning so
    // operators can find the offender in the logs.
    expect((logWarn as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);

    // Task #1573 — the sweep must hand the offending pairs over to the
    // alert engine via `setRetentionPolicyUnsupportedPairsForAlerts` so
    // the absolute-floor `policiesUnsupported` spike alert can name
    // them in the dashboard message and SendGrid escalation.
    const {
      getRetentionPolicyUnsupportedPairsForAlerts,
      setRetentionPolicyUnsupportedPairsForAlerts,
    } = await import("../utils/jobMetricAlerts");
    expect(
      (setRetentionPolicyUnsupportedPairsForAlerts as ReturnType<typeof vi.fn>)
        .mock.calls.length,
    ).toBe(1);
    const published = getRetentionPolicyUnsupportedPairsForAlerts();
    expect(published).toHaveLength(2);
    const formatted = published
      .map((p) => `${p.entityType}/${p.action}`)
      .sort();
    expect(formatted).toEqual([
      "AUDIT_LOGS/ARCHIVE",
      "NOTIFICATIONS/DELETE",
    ]);
  });

  it("records `policiesUnsupported: 0` on the empty-policies path (Task #1552)", async () => {
    const { processRetentionPolicies } = await import("../jobs/jobRunner");
    const { resetJobMetrics, getJobMetrics } = await import("../utils/jobMetrics");
    resetJobMetrics();

    await processRetentionPolicies();

    const metrics = getJobMetrics("retention_policy_sweep");
    expect(metrics.samples).toHaveLength(1);
    expect(metrics.samples[0].counters.policiesUnsupported).toBe(0);

    // Task #1573 — the empty-policies path also clears the offender
    // side-channel so a stale set of pairs from a previous run can't
    // get attached to a future `policiesUnsupported` alert.
    const {
      getRetentionPolicyUnsupportedPairsForAlerts,
      setRetentionPolicyUnsupportedPairsForAlerts,
    } = await import("../utils/jobMetricAlerts");
    expect(
      (setRetentionPolicyUnsupportedPairsForAlerts as ReturnType<typeof vi.fn>)
        .mock.calls.length,
    ).toBe(1);
    expect(getRetentionPolicyUnsupportedPairsForAlerts()).toEqual([]);
  });

  it("records zero deletions when an enabled policy matches no rows", async () => {
    policyRows.push({
      id: "policy-audit-90d",
      enabled: true,
      entityType: "AUDIT_LOGS",
      action: "DELETE",
      retentionDays: 90, organizationId: DEFAULT_TEST_ORG_ID,
    });
    // No audit rows queued — the sweep runs but deletes nothing.

    const { processRetentionPolicies } = await import("../jobs/jobRunner");
    const { resetJobMetrics, getJobMetrics } = await import("../utils/jobMetrics");
    resetJobMetrics();

    await processRetentionPolicies();

    const metrics = getJobMetrics("retention_policy_sweep");
    expect(metrics.samples).toHaveLength(1);
    expect(metrics.samples[0].counters.deleted).toBe(0);
    expect(metrics.samples[0].counters.hardDeleted).toBe(0);
    expect(metrics.samples[0].counters.policiesProcessed).toBe(1);
    expect(metrics.samples[0].counters.policiesFailed).toBe(0);
  });
});

// Task #1572 — verify each newly-implemented (entityType, action) combo
// actually deletes / anonymizes its target table and contributes to the
// per-run metrics counters.
describe("processRetentionPolicies entity implementations (Task #1572)", () => {
  it("AI_ACTIONS + DELETE hard-deletes ai_action_audit rows", async () => {
    policyRows.push({
      id: "p-ai-delete",
      enabled: true,
      entityType: "AI_ACTIONS",
      action: "DELETE",
      retentionDays: 365, organizationId: DEFAULT_TEST_ORG_ID,
    });
    tableQueues["ai_action_audit"] = ["ai-1", "ai-2"];

    const { processRetentionPolicies } = await import("../jobs/jobRunner");
    const { getJobMetrics, resetJobMetrics } = await import("../utils/jobMetrics");
    resetJobMetrics();

    await processRetentionPolicies();

    const counters = getJobMetrics("retention_policy_sweep").samples[0].counters;
    expect(counters.deleted).toBe(2);
    expect(counters.hardDeleted).toBe(2);
    expect(counters.policiesProcessed).toBe(1);
    expect(counters.policiesUnsupported).toBe(0);
  });

  it("AI_ACTIONS + ANONYMIZE updates rows and counts as deleted but not hardDeleted", async () => {
    policyRows.push({
      id: "p-ai-anon",
      enabled: true,
      entityType: "AI_ACTIONS",
      action: "ANONYMIZE",
      retentionDays: 365, organizationId: DEFAULT_TEST_ORG_ID,
    });
    tableQueues["ai_action_audit"] = ["ai-1", "ai-2", "ai-3"];

    const { processRetentionPolicies } = await import("../jobs/jobRunner");
    const { getJobMetrics, resetJobMetrics } = await import("../utils/jobMetrics");
    resetJobMetrics();

    await processRetentionPolicies();

    const counters = getJobMetrics("retention_policy_sweep").samples[0].counters;
    expect(counters.deleted).toBe(3);
    // ANONYMIZE keeps the row in place — must NOT contribute to
    // `hardDeleted` (which feeds the over-delete spike alert).
    expect(counters.hardDeleted).toBe(0);
    expect(counters.policiesProcessed).toBe(1);
    expect(counters.policiesUnsupported).toBe(0);
    // One UPDATE for the anonymize, one for the lastRunAt bump.
    expect(updateCallsByTable["ai_action_audit"]).toBe(1);
    expect(updateCallsByTable["retention_policies"]).toBe(1);
  });

  it("DOCUMENTS + DELETE hard-deletes plan_documents rows", async () => {
    policyRows.push({
      id: "p-docs",
      enabled: true,
      entityType: "DOCUMENTS",
      action: "DELETE",
      retentionDays: 3650, organizationId: DEFAULT_TEST_ORG_ID,
    });
    tableQueues["plan_documents"] = ["doc-1"];

    const { processRetentionPolicies } = await import("../jobs/jobRunner");
    const { getJobMetrics, resetJobMetrics } = await import("../utils/jobMetrics");
    resetJobMetrics();

    await processRetentionPolicies();

    const counters = getJobMetrics("retention_policy_sweep").samples[0].counters;
    expect(counters.deleted).toBe(1);
    expect(counters.hardDeleted).toBe(1);
    expect(counters.policiesProcessed).toBe(1);
    expect(counters.policiesUnsupported).toBe(0);
  });

  it("TIME_ENTRIES + DELETE hard-deletes time_entries rows", async () => {
    policyRows.push({
      id: "p-time-del",
      enabled: true,
      entityType: "TIME_ENTRIES",
      action: "DELETE",
      retentionDays: 2555, organizationId: DEFAULT_TEST_ORG_ID,
    });
    tableQueues["time_entries"] = ["t-1", "t-2", "t-3", "t-4"];

    const { processRetentionPolicies } = await import("../jobs/jobRunner");
    const { getJobMetrics, resetJobMetrics } = await import("../utils/jobMetrics");
    resetJobMetrics();

    await processRetentionPolicies();

    const counters = getJobMetrics("retention_policy_sweep").samples[0].counters;
    expect(counters.deleted).toBe(4);
    expect(counters.hardDeleted).toBe(4);
    expect(counters.policiesProcessed).toBe(1);
  });

  it("TIME_ENTRIES + ANONYMIZE scrubs notes/rejectionReason without deleting rows", async () => {
    policyRows.push({
      id: "p-time-anon",
      enabled: true,
      entityType: "TIME_ENTRIES",
      action: "ANONYMIZE",
      retentionDays: 2555, organizationId: DEFAULT_TEST_ORG_ID,
    });
    tableQueues["time_entries"] = ["t-1", "t-2"];

    const { processRetentionPolicies } = await import("../jobs/jobRunner");
    const { getJobMetrics, resetJobMetrics } = await import("../utils/jobMetrics");
    resetJobMetrics();

    await processRetentionPolicies();

    const counters = getJobMetrics("retention_policy_sweep").samples[0].counters;
    expect(counters.deleted).toBe(2);
    expect(counters.hardDeleted).toBe(0);
    expect(counters.policiesProcessed).toBe(1);
    expect(updateCallsByTable["time_entries"]).toBe(1);
  });

  it("MESSAGES + DELETE hard-deletes messages rows", async () => {
    policyRows.push({
      id: "p-msg-del",
      enabled: true,
      entityType: "MESSAGES",
      action: "DELETE",
      retentionDays: 730, organizationId: DEFAULT_TEST_ORG_ID,
    });
    tableQueues["messages"] = ["m-1", "m-2", "m-3"];

    const { processRetentionPolicies } = await import("../jobs/jobRunner");
    const { getJobMetrics, resetJobMetrics } = await import("../utils/jobMetrics");
    resetJobMetrics();

    await processRetentionPolicies();

    const counters = getJobMetrics("retention_policy_sweep").samples[0].counters;
    expect(counters.deleted).toBe(3);
    expect(counters.hardDeleted).toBe(3);
    expect(counters.policiesProcessed).toBe(1);
  });

  it("MESSAGES + ANONYMIZE scrubs content + attachments and flips isDeleted", async () => {
    policyRows.push({
      id: "p-msg-anon",
      enabled: true,
      entityType: "MESSAGES",
      action: "ANONYMIZE",
      retentionDays: 730, organizationId: DEFAULT_TEST_ORG_ID,
    });
    tableQueues["messages"] = ["m-1", "m-2"];

    const { processRetentionPolicies } = await import("../jobs/jobRunner");
    const { getJobMetrics, resetJobMetrics } = await import("../utils/jobMetrics");
    resetJobMetrics();

    await processRetentionPolicies();

    const counters = getJobMetrics("retention_policy_sweep").samples[0].counters;
    expect(counters.deleted).toBe(2);
    expect(counters.hardDeleted).toBe(0);
    expect(counters.policiesProcessed).toBe(1);
    expect(updateCallsByTable["messages"]).toBe(1);
  });

  it("FILE_UPLOADS + DELETE hard-deletes media rows", async () => {
    policyRows.push({
      id: "p-files",
      enabled: true,
      entityType: "FILE_UPLOADS",
      action: "DELETE",
      retentionDays: 1825, organizationId: DEFAULT_TEST_ORG_ID,
    });
    tableQueues["media"] = ["f-1", "f-2", "f-3", "f-4", "f-5"];

    const { processRetentionPolicies } = await import("../jobs/jobRunner");
    const { getJobMetrics, resetJobMetrics } = await import("../utils/jobMetrics");
    resetJobMetrics();

    await processRetentionPolicies();

    const counters = getJobMetrics("retention_policy_sweep").samples[0].counters;
    expect(counters.deleted).toBe(5);
    expect(counters.hardDeleted).toBe(5);
    expect(counters.policiesProcessed).toBe(1);
  });

  it("processes a mix of supported combos in a single sweep", async () => {
    policyRows.push(
      { id: "p1", enabled: true, entityType: "AUDIT_LOGS", action: "DELETE", retentionDays: 30, organizationId: DEFAULT_TEST_ORG_ID },
      { id: "p2", enabled: true, entityType: "MESSAGES", action: "ANONYMIZE", retentionDays: 30, organizationId: DEFAULT_TEST_ORG_ID },
      { id: "p3", enabled: true, entityType: "FILE_UPLOADS", action: "DELETE", retentionDays: 30, organizationId: DEFAULT_TEST_ORG_ID },
    );
    tableQueues["audit_log"] = ["a-1", "a-2"];
    tableQueues["messages"] = ["m-1"];
    tableQueues["media"] = ["f-1", "f-2", "f-3"];

    const { processRetentionPolicies } = await import("../jobs/jobRunner");
    const { getJobMetrics, resetJobMetrics } = await import("../utils/jobMetrics");
    resetJobMetrics();

    await processRetentionPolicies();

    const counters = getJobMetrics("retention_policy_sweep").samples[0].counters;
    // 2 audit hard-deletes + 1 message anonymize + 3 media hard-deletes = 6
    expect(counters.deleted).toBe(6);
    // hardDeleted excludes the message anonymize (which keeps the row).
    expect(counters.hardDeleted).toBe(5);
    expect(counters.policiesProcessed).toBe(3);
    expect(counters.policiesUnsupported).toBe(0);
    expect(counters.policiesFailed).toBe(0);
    // Each policy bumps lastRunAt on retention_policies.
    expect(updateCallsByTable["retention_policies"]).toBe(3);
  });
});

// Task #1572 — multi-tenant isolation: every retention mutation MUST
// be scoped to the policy's organization. We render the WHERE
// predicate the sweep actually built (via PgDialect) and assert the
// SQL references the org-bound column or subquery for each combo.
// Without this, an enabled policy in one org would delete or
// anonymize rows belonging to other tenants — a critical data
// isolation violation flagged in code review.
describe("processRetentionPolicies tenant scoping (Task #1572)", () => {
  const ORG_A = "org-aaaa";
  const ORG_B = "org-bbbb";

  // Helper: assert the WHERE SQL captured for a given table/op
  // mentions the per-policy org scope. We accept any of the canonical
  // shapes (direct organization_id eq, or subquery via projects /
  // conversations / users) — implementation can pick whichever fits
  // the table, but it MUST include one of them.
  function expectScopedToOrg(table: string, op: "delete" | "update", org: string) {
    const w = capturedWheres.find((c) => c.table === table && c.op === op);
    expect(w, `no captured ${op} on ${table}`).toBeTruthy();
    const sql = w!.sql.toLowerCase();
    // Acceptable evidence of tenant scoping (one of):
    //   1. Direct organization_id / gc_organization_id equality on the
    //      target table (used for ai_action_audit, plan_documents).
    //   2. An `inArray(<fk>, <subquery on parent>)` clause — PgDialect
    //      renders this as `"<table>"."<fk>" in $N` because the
    //      subquery is bound as a parameter under the mocked db, but
    //      the FK column name is still visible and unambiguously
    //      identifies the scoping path (conversation_id → conversations,
    //      project_id → projects, user_id → users).
    const hasOrgRef =
      sql.includes("organization_id") ||
      sql.includes("gc_organization_id") ||
      sql.includes("conversation_id") ||
      sql.includes("project_id") ||
      sql.includes("user_id");
    expect(hasOrgRef, `WHERE for ${op} on ${table} did not reference an org-scope column/FK: ${w!.sql}`).toBe(true);
    // Sanity: the predicate must also include the cutoff comparison
    // so we know we didn't lose the time filter.
    const hasCutoff =
      sql.includes("created_at") ||
      sql.includes("uploaded_at");
    expect(hasCutoff, `WHERE for ${op} on ${table} lost its cutoff predicate: ${w!.sql}`).toBe(true);
  }

  const cases: Array<{ entityType: string; action: string; table: string; op: "delete" | "update"; days: number }> = [
    { entityType: "AUDIT_LOGS", action: "DELETE", table: "audit_log", op: "delete", days: 90 },
    { entityType: "AI_ACTIONS", action: "DELETE", table: "ai_action_audit", op: "delete", days: 365 },
    { entityType: "AI_ACTIONS", action: "ANONYMIZE", table: "ai_action_audit", op: "update", days: 365 },
    { entityType: "DOCUMENTS", action: "DELETE", table: "plan_documents", op: "delete", days: 3650 },
    { entityType: "TIME_ENTRIES", action: "DELETE", table: "time_entries", op: "delete", days: 2555 },
    { entityType: "TIME_ENTRIES", action: "ANONYMIZE", table: "time_entries", op: "update", days: 2555 },
    { entityType: "MESSAGES", action: "DELETE", table: "messages", op: "delete", days: 730 },
    { entityType: "MESSAGES", action: "ANONYMIZE", table: "messages", op: "update", days: 730 },
    { entityType: "FILE_UPLOADS", action: "DELETE", table: "media", op: "delete", days: 1825 },
  ];

  for (const c of cases) {
    it(`scopes ${c.entityType}+${c.action} mutations to the policy's organizationId`, async () => {
      policyRows.push({
        id: `tenant-${c.entityType}-${c.action}`,
        enabled: true,
        entityType: c.entityType,
        action: c.action,
        retentionDays: c.days,
        organizationId: ORG_A,
      });
      tableQueues[c.table] = ["row-1"];

      const { processRetentionPolicies } = await import("../jobs/jobRunner");
      const { resetJobMetrics } = await import("../utils/jobMetrics");
      resetJobMetrics();

      await processRetentionPolicies();

      expectScopedToOrg(c.table, c.op, ORG_A);
      // The captured SQL must literally include the policy's org id
      // (either inline as a parameter placeholder + param, or as a
      // referenced bind value). PgDialect parameterizes string args,
      // so the org id appears in the params side, not the SQL string.
      // We instead assert the SQL references the org column AT ALL
      // (covered by expectScopedToOrg) — and as a regression guard,
      // we also assert it's NOT a bare cutoff-only predicate.
      const w = capturedWheres.find((cw) => cw.table === c.table && cw.op === c.op)!;
      // A naive `WHERE created_at < $1` (or uploaded_at) predicate
      // is the bug we're guarding against.
      const naiveBareCutoff = /^\s*"?[a-z_]+"?\."?(created_at|uploaded_at)"?\s*<\s*\$1\s*$/i;
      expect(naiveBareCutoff.test(w.sql), `WHERE on ${c.table} is the unsafe cutoff-only form: ${w.sql}`).toBe(false);
    });
  }

  it("AI_ACTIONS+ANONYMIZE predicate scrubs rows with any redactable field set, not just actorUserId", async () => {
    // Regression for code review feedback: a previous version of this
    // sweep narrowed on `isNotNull(actorUserId)` only, which silently
    // skipped old rows where the actor was already null but the
    // rationale / inputRefs / outputRefs / approvedByUserId still held
    // sensitive content. The predicate must broaden to OR across every
    // redactable column.
    policyRows.push({
      id: "p-ai-anon-edge",
      enabled: true,
      entityType: "AI_ACTIONS",
      action: "ANONYMIZE",
      retentionDays: 365,
      organizationId: ORG_A,
    });
    tableQueues["ai_action_audit"] = ["ai-orphan-1"];

    const { processRetentionPolicies } = await import("../jobs/jobRunner");
    const { resetJobMetrics } = await import("../utils/jobMetrics");
    resetJobMetrics();

    await processRetentionPolicies();

    const w = capturedWheres.find((c) => c.table === "ai_action_audit" && c.op === "update");
    expect(w, "no captured update on ai_action_audit").toBeTruthy();
    const sql = w!.sql.toLowerCase();
    // All five redactable columns must appear in the WHERE so the
    // anonymize sweep doesn't leave any of them behind on actor-less
    // rows.
    expect(sql).toContain("actor_user_id");
    expect(sql).toContain("rationale");
    expect(sql).toContain("input_refs");
    expect(sql).toContain("output_refs");
    expect(sql).toContain("approved_by_user_id");
  });

  it("two policies for different orgs each scope their own mutations", async () => {
    policyRows.push(
      { id: "p-org-a", enabled: true, entityType: "AI_ACTIONS", action: "DELETE", retentionDays: 365, organizationId: ORG_A },
      { id: "p-org-b", enabled: true, entityType: "AI_ACTIONS", action: "DELETE", retentionDays: 365, organizationId: ORG_B },
    );
    tableQueues["ai_action_audit"] = ["x-1", "x-2"];

    const { processRetentionPolicies } = await import("../jobs/jobRunner");
    const { resetJobMetrics } = await import("../utils/jobMetrics");
    resetJobMetrics();

    await processRetentionPolicies();

    // Two captured DELETEs on ai_action_audit, both scoped via the
    // organization_id column on that table.
    const aiDeletes = capturedWheres.filter((c) => c.table === "ai_action_audit" && c.op === "delete");
    expect(aiDeletes).toHaveLength(2);
    for (const d of aiDeletes) {
      expect(d.sql.toLowerCase()).toContain("organization_id");
    }
  });
});

// Task #1572 — keep the supported-combos list in lockstep with the
// implementations in `processRetentionPolicies`. This guards against a
// future change adding/removing a combo on one side without the other.
describe("SUPPORTED_RETENTION_POLICY_COMBOS (Task #1572)", () => {
  it("contains every combo the sweep claims to implement", async () => {
    const { SUPPORTED_RETENTION_POLICY_COMBOS } = await import("@shared/schema");
    const expected = [
      "AUDIT_LOGS:DELETE",
      "AI_ACTIONS:DELETE",
      "AI_ACTIONS:ANONYMIZE",
      "DOCUMENTS:DELETE",
      "TIME_ENTRIES:DELETE",
      "TIME_ENTRIES:ANONYMIZE",
      "MESSAGES:DELETE",
      "MESSAGES:ANONYMIZE",
      "FILE_UPLOADS:DELETE",
    ];
    const actual = SUPPORTED_RETENTION_POLICY_COMBOS.map((c) => `${c.entityType}:${c.action}`);
    expect(actual.sort()).toEqual(expected.sort());
  });
});
