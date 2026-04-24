/**
 * Task #1523 — `processRetentionPolicies` must publish a per-run sample
 * via `recordJobMetrics` so the operations dashboard sees every nightly
 * tick and the Task #1502 spike rules on `deleted` / `hardDeleted` can
 * fire end-to-end.
 *
 * Mirrors the pattern in
 * `davis-bacon-orphan-wage-decision-sweep.test.ts` — db is mocked with a
 * tiny in-memory queue so the sweep can run hermetically.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

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
}

interface AuditLogRow {
  id: string;
  createdAt: Date;
}

let policyRows: RetentionPolicyRow[] = [];
let auditRows: AuditLogRow[] = [];
let updateCalls: number = 0;

const dbMock = {
  select: () => ({
    from: (table: unknown) => ({
      where: () => {
        // Two select-from-where calls happen per run:
        //   1. retention_policies WHERE enabled = true
        //   2. (none — the only DELETE uses .returning)
        // We disambiguate by looking at the table reference's symbol name.
        const name = tableName(table);
        if (name === "retention_policies") return Promise.resolve(policyRows.filter((p) => p.enabled));
        return Promise.resolve([]);
      },
    }),
  }),
  delete: (table: unknown) => ({
    where: () => ({
      returning: async () => {
        if (tableName(table) === "audit_log") {
          // The retention sweep deletes auditLog rows older than the
          // cutoff; for the metric assertion we just return the queued
          // rows so the sweep sees `deleted = auditRows.length`.
          const removed = auditRows.map((r) => ({ id: r.id }));
          auditRows = [];
          return removed;
        }
        return [];
      },
    }),
  }),
  update: () => ({
    set: () => ({
      where: async () => {
        updateCalls += 1;
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
  auditRows = [];
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
      retentionDays: 90,
    });
    auditRows.push(
      { id: "audit-1", createdAt: new Date("2024-01-01T00:00:00Z") },
      { id: "audit-2", createdAt: new Date("2024-01-02T00:00:00Z") },
      { id: "audit-3", createdAt: new Date("2024-01-03T00:00:00Z") },
    );

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
    expect(updateCalls).toBe(1);
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
        retentionDays: 90,
      },
      {
        id: "policy-notifications-30d",
        enabled: true,
        entityType: "NOTIFICATIONS",
        action: "DELETE",
        retentionDays: 30,
      },
      {
        id: "policy-audit-archive",
        enabled: true,
        entityType: "AUDIT_LOGS",
        action: "ARCHIVE",
        retentionDays: 365,
      },
    );
    auditRows.push({ id: "audit-1", createdAt: new Date("2024-01-01T00:00:00Z") });

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
    expect(updateCalls).toBe(3);
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
      retentionDays: 90,
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
