// Task #2972 — Unit tests for the SLA risk-alert + escalation engine.
//
// Covers runSlaRiskAlerts from server/support/slaMonitor.ts:
//   1. Returns alerted:0 when no candidates exist.
//   2. Tickets below the threshold are not escalated.
//   3. Tickets past the threshold have their priority bumped one level.
//   4. An ESCALATE audit log row is written for every priority bump.
//   5. "urgent" tickets are not bumped further; no ESCALATE row written.
//   6. Already-escalated tickets (slaRiskAlertAt in metadata) are skipped.
//   7. Org-specific escalationThresholdPct is respected.
//   8. Default threshold (75%) is used when no settings row exists.
//   9. escalationEmails are merged into alert recipients.
//  10. alerted count reflects only tickets actually escalated.
//  11. slaRiskAlertAt and escalatedFromPriority are written to metadata.
//
// All mocks are declared via vi.hoisted() so state can be shared between
// the mock factories (which Vitest hoists to the top) and the beforeEach
// reset logic.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Shared state (must be hoisted so mock factories can close over it) ───────

const state = vi.hoisted(() => ({
  candidateRows: [] as Record<string, unknown>[],
  settingRows: [] as Record<string, unknown>[],
  capturedUpdates: [] as Array<{ patch: Record<string, unknown> }>,
  auditRows: [] as Array<Record<string, unknown>>,
  emailCalls: [] as Array<Record<string, unknown>>,
}));

// ─── Drizzle DB mock ──────────────────────────────────────────────────────────
//
// `db.select().from(table)` detects the table by its Drizzle `_.name` string so
// query results are matched by table name, not call order.

vi.mock("../../db", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          then: (resolve: (v: Record<string, unknown>[]) => void) => {
            const name = (table as Record<symbol, unknown>)[Symbol.for("drizzle:Name")] as string | undefined;
            if (name === "support_tickets") return resolve(state.candidateRows);
            // support_settings or any other table
            return resolve(state.settingRows);
          },
        }),
      }),
    }),
    update: (_table: unknown) => {
      let pending: Record<string, unknown> = {};
      const builder = {
        set: (patch: Record<string, unknown>) => {
          pending = patch;
          return builder;
        },
        where: (_cond: unknown) => {
          state.capturedUpdates.push({ patch: pending });
          return Promise.resolve([]);
        },
      };
      return builder;
    },
  },
}));

// ─── Email mock ───────────────────────────────────────────────────────────────

vi.mock("../../email", () => ({
  sendEmail: async (opts: Record<string, unknown>) => {
    state.emailCalls.push(opts);
  },
}));

// ─── Audit logger mock ────────────────────────────────────────────────────────

vi.mock("../../auditLogger", () => ({
  logSystemAudit: async (row: Record<string, unknown>) => {
    state.auditRows.push(row);
  },
}));

// ─── Logger mock ──────────────────────────────────────────────────────────────

vi.mock("../../utils/logger", () => ({
  logInfo: () => undefined,
  logError: () => undefined,
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal support ticket that is 90% through its SLA window. */
function makeTicket(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  const now = Date.now();
  // 90% consumed: created 90 min ago, due in 10 min → 100 min window.
  const createdAt = new Date(now - 90 * 60_000);
  const dueAt = new Date(now + 10 * 60_000);
  return {
    id: "ticket-001",
    organizationId: "org-A",
    subject: "Test ticket",
    submitterEmail: "user@example.com",
    priority: "normal",
    tier: "pro",
    status: "open",
    slaFirstResponseDueAt: dueAt,
    slaFirstResponseBreached: 0,
    firstResponseAt: null,
    createdAt,
    updatedAt: createdAt,
    metadata: {},
    ...overrides,
  };
}

/** Build a minimal support settings row. */
function makeSettings(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    organizationId: "org-A",
    escalationThresholdPct: 75,
    escalationEmails: [],
    autoAssignGraceMinutes: 60,
    enterpriseAgentIds: [],
    ...overrides,
  };
}

// ─── Reset captured state before each test ────────────────────────────────────

beforeEach(() => {
  state.candidateRows = [];
  state.settingRows = [];
  state.capturedUpdates = [];
  state.auditRows = [];
  state.emailCalls = [];
});

// ─── Import the module under test after all vi.mock() declarations ────────────

const { runSlaRiskAlerts } = await import("../slaMonitor");

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("runSlaRiskAlerts", () => {
  it("returns alerted: 0 when there are no candidate tickets", async () => {
    state.candidateRows = [];

    const result = await runSlaRiskAlerts();

    expect(result.alerted).toBe(0);
    expect(state.capturedUpdates).toHaveLength(0);
    expect(state.auditRows).toHaveLength(0);
  });

  it("returns alerted: 0 when the ticket is below the threshold", async () => {
    const now = Date.now();
    // 30% consumed (created 30 min ago, due in 70 min).
    state.candidateRows = [
      makeTicket({
        createdAt: new Date(now - 30 * 60_000),
        slaFirstResponseDueAt: new Date(now + 70 * 60_000),
      }),
    ];
    state.settingRows = [makeSettings({ escalationThresholdPct: 75 })];

    const result = await runSlaRiskAlerts();

    expect(result.alerted).toBe(0);
    expect(state.capturedUpdates).toHaveLength(0);
    expect(state.auditRows).toHaveLength(0);
  });

  it("bumps priority one level when ticket is past the threshold", async () => {
    state.candidateRows = [makeTicket({ priority: "normal" })]; // 90% > 75%
    state.settingRows = [makeSettings()];

    const result = await runSlaRiskAlerts();

    expect(result.alerted).toBe(1);
    expect(state.capturedUpdates).toHaveLength(1);
    expect(state.capturedUpdates[0].patch.priority).toBe("high");
  });

  it("bumps each priority one level: low → normal → high → urgent", async () => {
    const cases: Array<[string, string]> = [
      ["low", "normal"],
      ["normal", "high"],
      ["high", "urgent"],
    ];

    for (const [fromPriority, expectedPriority] of cases) {
      // Reset between sub-cases.
      state.candidateRows = [makeTicket({ priority: fromPriority, id: `t-${fromPriority}` })];
      state.settingRows = [makeSettings()];
      state.capturedUpdates = [];

      await runSlaRiskAlerts();

      expect(
        state.capturedUpdates[0]?.patch.priority,
        `${fromPriority} should bump to ${expectedPriority}`,
      ).toBe(expectedPriority);
    }
  });

  it("does not bump priority beyond 'urgent' — no priority field in update", async () => {
    state.candidateRows = [makeTicket({ priority: "urgent" })]; // 90% consumed
    state.settingRows = [makeSettings()];

    const result = await runSlaRiskAlerts();

    // Still alerted (email sent, metadata marked).
    expect(result.alerted).toBe(1);
    // The DB update must NOT set a priority field.
    expect(state.capturedUpdates).toHaveLength(1);
    expect(state.capturedUpdates[0].patch.priority).toBeUndefined();
  });

  it("writes an ESCALATE audit log row when priority is bumped", async () => {
    state.candidateRows = [makeTicket({ priority: "low", id: "esc-ticket" })];
    state.settingRows = [makeSettings()];

    await runSlaRiskAlerts();

    // Flush the void promise from logSystemAudit.
    await Promise.resolve();

    expect(state.auditRows.length).toBeGreaterThanOrEqual(1);

    const escalateRow = state.auditRows.find(
      (r) => r.action === "ESCALATE" && r.entityId === "esc-ticket",
    );
    expect(escalateRow, "ESCALATE audit row should exist").toBeDefined();

    const newValue = JSON.parse(escalateRow!.newValue as string) as Record<string, unknown>;
    expect(newValue.priority).toBe("normal"); // low → normal
    expect(String(newValue.reason)).toContain("SLA window");
    expect(newValue.thresholdPct).toBe(75);
    expect(escalateRow!.entityType).toBe("support_ticket");
  });

  it("does NOT write an ESCALATE audit row for urgent tickets (no bump)", async () => {
    state.candidateRows = [makeTicket({ priority: "urgent" })];
    state.settingRows = [makeSettings()];

    await runSlaRiskAlerts();
    await Promise.resolve();

    const escalateRows = state.auditRows.filter((r) => r.action === "ESCALATE");
    expect(escalateRows).toHaveLength(0);
  });

  it("skips tickets that already have slaRiskAlertAt in metadata (idempotent)", async () => {
    state.candidateRows = [
      makeTicket({ metadata: { slaRiskAlertAt: new Date().toISOString() } }),
    ];
    state.settingRows = [makeSettings()];

    const result = await runSlaRiskAlerts();

    expect(result.alerted).toBe(0);
    expect(state.capturedUpdates).toHaveLength(0);
    expect(state.auditRows).toHaveLength(0);
  });

  it("sends an alert email for each escalated ticket", async () => {
    state.candidateRows = [makeTicket({ priority: "normal" })];
    state.settingRows = [makeSettings()];

    await runSlaRiskAlerts();
    // Allow the void sendEmail promise to settle.
    await Promise.resolve();

    expect(state.emailCalls.length).toBeGreaterThanOrEqual(1);
    const email = state.emailCalls[0];
    expect(String(email.subject)).toMatch(/SLA at risk/);
  });

  it("includes org escalationEmails in the alert recipients", async () => {
    state.candidateRows = [makeTicket({ priority: "normal" })];
    state.settingRows = [
      makeSettings({ escalationEmails: ["oncall@example.com", "mgr@example.com"] }),
    ];

    await runSlaRiskAlerts();
    await Promise.resolve();

    expect(state.emailCalls.length).toBeGreaterThanOrEqual(1);
    const to = state.emailCalls[0].to as string[];
    expect(to).toContain("oncall@example.com");
    expect(to).toContain("mgr@example.com");
  });

  it("uses default threshold of 75% when no settings row exists for the org", async () => {
    const now = Date.now();
    // 80% consumed — above 75% default.
    state.candidateRows = [
      makeTicket({
        organizationId: "org-no-settings",
        createdAt: new Date(now - 80 * 60_000),
        slaFirstResponseDueAt: new Date(now + 20 * 60_000),
      }),
    ];
    state.settingRows = []; // No settings row for this org.

    const result = await runSlaRiskAlerts();

    expect(result.alerted).toBe(1);
  });

  it("respects a 90% custom threshold — ticket at 80% is NOT escalated", async () => {
    const now = Date.now();
    // 80% consumed — below 90% custom threshold.
    state.candidateRows = [
      makeTicket({
        createdAt: new Date(now - 80 * 60_000),
        slaFirstResponseDueAt: new Date(now + 20 * 60_000),
      }),
    ];
    state.settingRows = [makeSettings({ escalationThresholdPct: 90 })];

    const result = await runSlaRiskAlerts();

    expect(result.alerted).toBe(0);
  });

  it("counts each qualifying ticket in the alerted return value", async () => {
    const now = Date.now();
    state.candidateRows = [
      makeTicket({ id: "t1", priority: "low", organizationId: "org-A" }),
      makeTicket({ id: "t2", priority: "normal", organizationId: "org-A" }),
      // Third ticket is only 10% consumed — below threshold, should not count.
      {
        ...makeTicket({ id: "t3", priority: "low", organizationId: "org-A" }),
        createdAt: new Date(now - 10 * 60_000),
        slaFirstResponseDueAt: new Date(now + 90 * 60_000),
      },
    ];
    state.settingRows = [makeSettings({ organizationId: "org-A", escalationThresholdPct: 75 })];

    const result = await runSlaRiskAlerts();

    expect(result.alerted).toBe(2); // only t1 and t2 qualify
  });

  it("sets slaRiskAlertAt in the metadata update", async () => {
    state.candidateRows = [makeTicket({ priority: "normal" })];
    state.settingRows = [makeSettings()];

    await runSlaRiskAlerts();

    expect(state.capturedUpdates).toHaveLength(1);
    const meta = state.capturedUpdates[0].patch.metadata as Record<string, unknown>;
    expect(meta).toBeDefined();
    expect(typeof meta.slaRiskAlertAt).toBe("string");
  });

  it("stores escalatedFromPriority in metadata when priority is bumped", async () => {
    state.candidateRows = [makeTicket({ priority: "low" })];
    state.settingRows = [makeSettings()];

    await runSlaRiskAlerts();

    const meta = state.capturedUpdates[0]?.patch.metadata as Record<string, unknown>;
    expect(meta).toBeDefined();
    expect(meta.escalatedFromPriority).toBe("low");
    expect(meta.escalatedAt).toBeDefined();
  });

  it("does NOT store escalatedFromPriority for urgent tickets (no bump)", async () => {
    state.candidateRows = [makeTicket({ priority: "urgent" })];
    state.settingRows = [makeSettings()];

    await runSlaRiskAlerts();

    const meta = state.capturedUpdates[0]?.patch.metadata as Record<string, unknown>;
    expect(meta).toBeDefined();
    expect(meta.escalatedFromPriority).toBeUndefined();
  });
});
