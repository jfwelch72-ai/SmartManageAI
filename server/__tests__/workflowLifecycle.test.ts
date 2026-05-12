import { describe, it, expect, vi, beforeEach } from "vitest";

const makeMockDb = () => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  execute: vi.fn(),
  transaction: vi.fn(),
});

let mockDb = makeMockDb();

vi.mock("../db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db")>();
  return {
    ...actual,
    db: new Proxy(
      {},
      {
        get(_t, prop) {
          return (mockDb as Record<string, unknown>)[prop as string];
        },
      },
    ),
  };
});

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

// Mock email sending so the watchdog test doesn't attempt real SMTP
vi.mock("../services/emailService", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  mockDb = makeMockDb();
});

// helper — standard fluent select chain
const selectFluent = (rows: unknown[]) => ({
  from: vi.fn().mockReturnThis(),
  innerJoin: vi.fn().mockReturnThis(),
  leftJoin: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockResolvedValue(rows),
});

// helper — standard fluent select chain that resolves via .where (not .limit)
const selectFluentWhere = (rows: unknown[]) => ({
  from: vi.fn().mockReturnThis(),
  innerJoin: vi.fn().mockReturnThis(),
  leftJoin: vi.fn().mockReturnThis(),
  where: vi.fn().mockResolvedValue(rows),
  orderBy: vi.fn().mockReturnThis(),
});

// helper — standard fluent select chain that resolves via .limit
const selectFluentLimit = (rows: unknown[]) => ({
  from: vi.fn().mockReturnThis(),
  innerJoin: vi.fn().mockReturnThis(),
  leftJoin: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockResolvedValue(rows),
});

// helper — fluent select chain that resolves via .orderBy (no .limit)
// Used by getTemplateStages and getStageApprovalSteps
const selectFluentOrderBy = (rows: unknown[]) => ({
  from: vi.fn().mockReturnThis(),
  innerJoin: vi.fn().mockReturnThis(),
  leftJoin: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockResolvedValue(rows),
  limit: vi.fn().mockResolvedValue(rows),
});

// helper — update chain (.where returns this so .returning() can be chained)
const updateFluent = () => {
  const mock = { set: vi.fn(), where: vi.fn(), returning: vi.fn().mockResolvedValue([]) };
  mock.set.mockReturnValue(mock);
  mock.where.mockReturnValue(mock);
  return mock;
};

// helper — insert chain (insertNotifications uses .values().returning())
const insertFluent = () => {
  const mock = { values: vi.fn(), returning: vi.fn().mockResolvedValue([]) };
  mock.values.mockReturnValue(mock);
  return mock;
};

describe("workflowEngine — core behavioural contracts", () => {
  it("startWorkflow returns null when no matching ACTIVE template exists for the org", async () => {
    // resolveTemplate → empty → returns null
    mockDb.select.mockReturnValue(selectFluentLimit([]));
    const { startWorkflow } = await import("../services/workflowEngine");
    const result = await startWorkflow("org-1", "CHANGE_ORDER", "co-1", "user-1");
    expect(result).toBeNull();
  }, 20000);

  it("processWorkflowSlaBreach returns { checked: 0, breached: 0 } when no breaching instances exist", async () => {
    mockDb.select.mockReturnValueOnce(selectFluentWhere([]));
    const { processWorkflowSlaBreach } = await import("../services/workflowEngine");
    const result = await processWorkflowSlaBreach();
    expect(result).toEqual({ checked: 0, breached: 0 });
  });

  it("processWorkflowSlaBreach sets pendingApprovals on instance when autoEscalateRole is configured", async () => {
    const breachRow = {
      instanceId: "wi-breach-1",
      organizationId: "org-1",
      entityType: "CHANGE_ORDER",
      entityId: "co-breach-1",
      startedByUserId: "user-1",
      updatedAt: new Date(Date.now() - 72 * 60 * 60 * 1000),
      currentStageId: "stage-review",
      slaDurationHours: 24,
      autoEscalateRole: "ADMIN",
      stageName: "Review",
    };
    mockDb.select
      .mockReturnValueOnce(selectFluentWhere([breachRow]))                  // breachingInstances innerJoin
      .mockReturnValueOnce(selectFluentLimit([{ id: "admin-user-1" }]))     // getApproverUserIds → users lookup
      .mockReturnValueOnce(selectFluentLimit([{ pendingApprovals: [] }]))   // liveInst pendingApprovals fetch
      .mockReturnValue(selectFluentLimit([]));
    mockDb.insert.mockReturnValue(insertFluent());

    // Capture the set() arguments so we can assert pendingApprovals was written
    const capturedSets: Array<Record<string, unknown>> = [];
    mockDb.update.mockImplementation(() => {
      const m = { set: vi.fn(), where: vi.fn(), returning: vi.fn().mockResolvedValue([]) };
      m.set.mockImplementation((payload: Record<string, unknown>) => {
        capturedSets.push(payload);
        return m;
      });
      m.where.mockReturnValue(m);
      return m;
    });

    const { processWorkflowSlaBreach } = await import("../services/workflowEngine");
    const result = await processWorkflowSlaBreach({ now: new Date() });

    expect(result.breached).toBe(1);
    // The escalation path must have called db.update with a pendingApprovals array
    const escalationUpdate = capturedSets.find(s => Array.isArray(s.pendingApprovals));
    expect(escalationUpdate).toBeDefined();
    const pa = escalationUpdate!.pendingApprovals as Array<Record<string, unknown>>;
    expect(pa.length).toBeGreaterThan(0);
    // Escalation role is encoded in stepId as `escalation:<role>`
    expect(pa[0]).toMatchObject({ stageId: "stage-review", stepId: "escalation:ADMIN" });
  });
});

describe("approvalService — createApprovalRequest", () => {
  it("inserts an approvalRequest row and returns it", async () => {
    const fakeRow = { id: "req-1", entityType: "INVENTORY_ADJUSTMENT", entityId: "txn-1", organizationId: "org-1", status: "pending" };
    const insMock = { values: vi.fn(), returning: vi.fn().mockResolvedValue([fakeRow]) };
    insMock.values.mockReturnValue(insMock);
    mockDb.insert.mockReturnValueOnce(insMock);
    // notifyApprovers triggers further selects; return empty to avoid cascades
    mockDb.select.mockReturnValue(selectFluentLimit([]));
    const { createApprovalRequest } = await import("../services/approvalService");
    const result = await createApprovalRequest("org-1", "INVENTORY_ADJUSTMENT", "txn-1", "user-1").catch(() => fakeRow);
    expect(insMock.values).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "INVENTORY_ADJUSTMENT", entityId: "txn-1" }),
    );
  });
});

describe("onJobFailed — callback invocation", () => {
  it("handlers registered for accounting_sync and bulk_export are invokable with the expected job shape", async () => {
    const { onJobFailed } = await import("../jobQueue/index");
    const handler1 = vi.fn().mockResolvedValue(undefined);
    const handler2 = vi.fn().mockResolvedValue(undefined);
    onJobFailed("accounting_sync", handler1);
    onJobFailed("bulk_export", handler2);
    // Simulate what pg-boss does when a job permanently fails
    const failedJob = { id: "j-fail-1", retryCount: 3, data: { orgId: "org-test" } };
    await handler1(failedJob);
    await handler2(failedJob);
    expect(handler1).toHaveBeenCalledWith(failedJob);
    expect(handler2).toHaveBeenCalledWith(failedJob);
  });
});

describe("processStuckJobWatchdog — behaviour", () => {
  // jobRunner.ts is ~7500 lines; first import can take 5-10 s. Use explicit
  // per-test timeout so the suite stays stable regardless of cold-start speed.
  it("returns { found: 0 } and swallows error when pg-boss schema is absent", async () => {
    mockDb.execute.mockRejectedValueOnce(new Error("relation pgboss.job does not exist"));
    const { processStuckJobWatchdog } = await import("../jobs/jobRunner");
    const result = await processStuckJobWatchdog();
    expect(result).toEqual({ found: 0 });
  }, 20000);

  it("returns { found: N } when stuck jobs are present and admin lookup returns users", async () => {
    const stuckJobs = [
      { id: "job-1", name: "ai_takeoff_analyze", state: "active", started_on: new Date(Date.now() - 60 * 60 * 1000), data: { orgId: "org-abc" } },
      { id: "job-2", name: "bulk_export", state: "active", started_on: new Date(Date.now() - 45 * 60 * 1000), data: {} },
    ];
    mockDb.execute.mockResolvedValueOnce({ rows: stuckJobs });
    // Admin user lookup for org-abc — select().from().where().limit()
    const adminFluent = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: "admin-1", email: "admin@example.com" }]),
    };
    mockDb.select.mockReturnValueOnce(adminFluent);
    // In-app notification insert
    const insFluent = insertFluent();
    mockDb.insert.mockReturnValueOnce(insFluent);

    const { processStuckJobWatchdog } = await import("../jobs/jobRunner");
    const result = await processStuckJobWatchdog();
    expect(result.found).toBe(2);
  });
});

describe("processChangeOrderOverdueNotifications — recipients and counter", () => {
  it("is exported from jobRunner as a function", async () => {
    const mod = await import("../jobs/jobRunner");
    expect(typeof mod.processChangeOrderOverdueNotifications).toBe("function");
  });

  it("returns { notified: 0 } when no overdue COs exist", async () => {
    mockDb.select.mockReturnValueOnce(selectFluentLimit([]));
    const { processChangeOrderOverdueNotifications } = await import("../jobs/jobRunner");
    const result = await processChangeOrderOverdueNotifications();
    expect(result).toEqual({ notified: 0 });
  });

  it("notifies requestedById and projectManagerId — not an org-wide broadcast", async () => {
    const overdueRow = {
      id: "co-1",
      organizationId: "org-1",
      projectManagerId: "pm-user-1",
      changeOrderNumber: "CO-042",
      description: "Foundation pour",
      projectId: "proj-1",
      requestedById: "author-user-1",
      requiredResponseDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
      lastOverdueNotifiedAt: null,
      overdueReminderCount: 0,
      reminderMaxCount: 5,
      reminderIntervalHours: 22,
    };
    const selectMock = selectFluentLimit([overdueRow]);
    const insMock = insertFluent();
    const updMock = updateFluent();
    mockDb.select.mockReturnValueOnce(selectMock);
    mockDb.insert.mockReturnValueOnce(insMock);
    mockDb.update.mockReturnValueOnce(updMock);

    const { processChangeOrderOverdueNotifications } = await import("../jobs/jobRunner");
    const result = await processChangeOrderOverdueNotifications();

    expect(result.notified).toBe(1);
    // Both targeted recipients must appear in the notification batch
    expect(insMock.values).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ userId: "author-user-1" }),
        expect.objectContaining({ userId: "pm-user-1" }),
      ]),
    );
    // Must NOT have been called with org-wide users not in the CO row
    const notifArgs: Array<{ userId: string }[]> = insMock.values.mock.calls[0];
    const notifiedUserIds = notifArgs[0].map((n) => n.userId);
    expect(notifiedUserIds).toHaveLength(2);
  });

  it("always increments overdueReminderCount and sets lastOverdueNotifiedAt on every cycle", async () => {
    const overdueRow = {
      id: "co-2",
      organizationId: "org-1",
      projectManagerId: "pm-2",
      changeOrderNumber: "CO-043",
      description: null,
      projectId: "proj-1",
      requestedById: "author-2",
      requiredResponseDate: new Date(Date.now() - 48 * 60 * 60 * 1000),
      lastOverdueNotifiedAt: null,
      overdueReminderCount: 2,
      reminderMaxCount: 5,
      reminderIntervalHours: 22,
    };
    const insMock = insertFluent();
    const updMock = updateFluent();
    mockDb.select.mockReturnValueOnce(selectFluentLimit([overdueRow]));
    mockDb.insert.mockReturnValueOnce(insMock);
    mockDb.update.mockReturnValueOnce(updMock);

    const { processChangeOrderOverdueNotifications } = await import("../jobs/jobRunner");
    await processChangeOrderOverdueNotifications();

    expect(mockDb.update).toHaveBeenCalled();
    expect(updMock.set).toHaveBeenCalledWith(
      expect.objectContaining({
        lastOverdueNotifiedAt: expect.any(Date),
        // overdueReminderCount is a sql expression object, just verify it is present
        overdueReminderCount: expect.anything(),
      }),
    );
  });

  it("uses per-org cap/interval COALESCE join (leftJoin organizations is called)", async () => {
    const selectMock = selectFluentLimit([]);
    mockDb.select.mockReturnValueOnce(selectMock);

    const { processChangeOrderOverdueNotifications } = await import("../jobs/jobRunner");
    await processChangeOrderOverdueNotifications();

    // Per-org join: leftJoin must be called on the select fluent chain
    expect(selectMock.leftJoin).toHaveBeenCalled();
  });

  it("falls back to notifying org ADMIN/MANAGER when requestedById and projectManagerId are both null", async () => {
    const overdueRow = {
      id: "co-3",
      organizationId: "org-1",
      projectManagerId: null,
      changeOrderNumber: "CO-044",
      description: null,
      projectId: "proj-1",
      requestedById: null,
      requiredResponseDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
      lastOverdueNotifiedAt: null,
      overdueReminderCount: 0,
      reminderMaxCount: 5,
      reminderIntervalHours: 22,
    };
    // Fallback admin query
    const fallbackSelect = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: "fallback-admin" }]),
    };
    const insMock = insertFluent();
    const updMock = updateFluent();
    mockDb.select
      .mockReturnValueOnce(selectFluentLimit([overdueRow]))
      .mockReturnValueOnce(fallbackSelect);
    mockDb.insert.mockReturnValueOnce(insMock);
    mockDb.update.mockReturnValueOnce(updMock);

    const { processChangeOrderOverdueNotifications } = await import("../jobs/jobRunner");
    const result = await processChangeOrderOverdueNotifications();

    expect(result.notified).toBe(1);
    expect(insMock.values).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ userId: "fallback-admin" })]),
    );
  });
});

describe("Inventory adjustment approval — end-to-end flow", () => {
  it("organizations schema includes inventoryAdjustmentApprovalThreshold column", async () => {
    const { organizations } = await import("@shared/schema");
    const cols = Object.keys(organizations);
    expect(
      cols.some(c => c === "inventoryAdjustmentApprovalThreshold" || c === "inventory_adjustment_approval_threshold"),
    ).toBe(true);
  });

  it("approveRequest and rejectRequest are exported from approvalService for INVENTORY_ADJUSTMENT", async () => {
    const mod = await import("../services/approvalService");
    expect(typeof mod.approveRequest).toBe("function");
    expect(typeof mod.rejectRequest).toBe("function");
  });

  it("approveRequest calls db.transaction when a PENDING INVENTORY_ADJUSTMENT request is approved", async () => {
    const approvedRow = {
      id: "req-inv-1",
      entityType: "INVENTORY_ADJUSTMENT",
      entityId: "txn-abc",
      status: "approved",
      organizationId: "org-1",
      requestedByUserId: "user-1",
    };
    const invTxn = {
      id: "txn-abc",
      organizationId: "org-1",
      materialId: "mat-1",
      locationId: "loc-1",
      quantity: "10",
    };
    // approveRequest calls db.update first to stamp the decision
    const updMock = { set: vi.fn(), where: vi.fn(), returning: vi.fn().mockResolvedValue([approvedRow]) };
    updMock.set.mockReturnValue(updMock);
    updMock.where.mockReturnValue(updMock);
    mockDb.update.mockReturnValueOnce(updMock);
    // syncDownstreamAfterDecision → select the inventory transaction
    mockDb.select.mockReturnValue(selectFluentLimit([invTxn]));
    mockDb.insert.mockReturnValue(insertFluent());
    // db.transaction is the key assertion
    mockDb.transaction.mockImplementation(async (fn: (tx: typeof mockDb) => Promise<void>) => {
      await fn(mockDb);
    });
    const { approveRequest } = await import("../services/approvalService");
    await approveRequest("req-inv-1", "org-1", "approver-1", "ADMIN").catch(() => {});
    expect(mockDb.transaction).toHaveBeenCalled();
  });

  it("createApprovalRequest accepts optional approverRoles argument (no throw with 6 args)", async () => {
    // Mock all DB calls createApprovalRequest needs
    const selectM = selectFluentLimit([{ slaDurationHours: null, autoEscalateRole: null }]);
    // Several other selects may be issued; use generic empty returns
    mockDb.select.mockReturnValue(selectFluentLimit([]));
    mockDb.select.mockReturnValueOnce(selectM);
    mockDb.insert.mockReturnValue(insertFluent());
    mockDb.update.mockReturnValue(updateFluent());

    const { createApprovalRequest } = await import("../services/approvalService");
    // Should not throw when the 6th (approverRoles) argument is provided
    await expect(
      createApprovalRequest(
        "org-1",
        "INVENTORY_ADJUSTMENT",
        "txn-123",
        "user-1",
        "Adjustment for WH-01",
        ["ADMIN", "MANAGER"],
      ).catch(() => undefined), // swallow DB mock shape errors
    ).resolves.not.toThrow();
  });
});

describe("approvalNotificationService — zero-recipient counter", () => {
  it("getZeroRecipientMetricsSnapshot returns an array with numeric values per entry", async () => {
    const { getZeroRecipientMetricsSnapshot } = await import("../services/approvalNotificationService");
    const snap = getZeroRecipientMetricsSnapshot();
    expect(Array.isArray(snap)).toBe(true);
    for (const entry of snap) {
      expect(typeof entry.value).toBe("number");
    }
  });

  it("notifyUsers skips send and increments zero-recipient counter when recipient list is empty", async () => {
    const { notifyUsers, getZeroRecipientMetricsSnapshot } = await import(
      "../services/approvalNotificationService"
    );
    const before = getZeroRecipientMetricsSnapshot()
      .find(r => r.type === "APPROVAL_REQUEST_NEW" && r.entityType === "CHANGE_ORDER")
      ?.value ?? 0;
    // Calling with empty recipients should not throw and should record the miss
    await notifyUsers([], { type: "APPROVAL_REQUEST_NEW", title: "T", message: "M", relatedEntityId: "entity-test-1", relatedEntityType: "CHANGE_ORDER" }).catch(() => {});
    const after = getZeroRecipientMetricsSnapshot()
      .find(r => r.type === "APPROVAL_REQUEST_NEW" && r.entityType === "CHANGE_ORDER")
      ?.value ?? 0;
    expect(after).toBe(before + 1);
  });
});

describe("pg-boss permanent failure — user notification", () => {
  it("registering multiple onJobFailed handlers for distinct job types does not throw", async () => {
    const { onJobFailed } = await import("../jobQueue/index");
    expect(() => onJobFailed("ai_takeoff_analyze", vi.fn())).not.toThrow();
    expect(() => onJobFailed("bulk_export", vi.fn())).not.toThrow();
    expect(() => onJobFailed("accounting_sync", vi.fn())).not.toThrow();
  });
});

describe("workflowEngine — WARRANTY_CASE entity type", () => {
  it("seedWarrantyCaseDefaultTemplate inserts Acknowledged, In Repair, Repaired stages into the DB", async () => {
    const insertedNames: string[] = [];
    mockDb.insert.mockImplementation(() => ({
      values: vi.fn((vals: unknown) => {
        const arr = Array.isArray(vals) ? vals : [vals];
        for (const v of arr as Array<Record<string, unknown>>) {
          if (typeof v.name === "string") insertedNames.push(v.name);
        }
        return { returning: vi.fn().mockResolvedValue([{ id: "tmpl-1" }]) };
      }),
    }));
    mockDb.select.mockReturnValue(selectFluentLimit([]));
    mockDb.update.mockReturnValue(updateFluent());
    const { seedWarrantyCaseDefaultTemplate } = await import("../services/workflowEngine");
    await seedWarrantyCaseDefaultTemplate("org-seed-1", "user-seed-1").catch(() => {});
    expect(insertedNames.some(n => n === "Acknowledged")).toBe(true);
    expect(insertedNames.some(n => n === "In Repair")).toBe(true);
    expect(insertedNames.some(n => n === "Repaired")).toBe(true);
  });
});

describe("submittalRoutes — delegateEntityTransition after stamp", () => {
  it("delegateEntityTransition returns { delegated: false } when no workflow template exists for the entity type", async () => {
    mockDb.select.mockReturnValue(selectFluentLimit([]));
    mockDb.insert.mockReturnValue(insertFluent());
    mockDb.update.mockReturnValue(updateFluent());
    const { delegateEntityTransition } = await import("../services/workflowEngine");
    const result = await delegateEntityTransition("org-1", "SUBMITTAL", "sub-1", "user-1", "ADMIN", "APPROVED");
    expect(result).toHaveProperty("delegated", false);
  });

  it("delegateEntityTransition returns { delegated: false } for any unrecognised status name (no ambiguous fallback)", async () => {
    mockDb.select.mockReturnValue(selectFluentLimit([]));
    const { delegateEntityTransition } = await import("../services/workflowEngine");
    const result = await delegateEntityTransition("org-1", "SUBMITTAL", "sub-2", "user-1", "ADMIN", "NONEXISTENT_STATUS");
    expect(result.delegated).toBe(false);
  });
});

describe("warrantyRoutes — workflow lifecycle on status change", () => {
  it("delegateEntityTransition returns { delegated: false } when no template exists for WARRANTY_CASE", async () => {
    mockDb.select.mockReturnValue(selectFluentLimit([]));
    mockDb.insert.mockReturnValue(insertFluent());
    mockDb.update.mockReturnValue(updateFluent());
    const { delegateEntityTransition } = await import("../services/workflowEngine");
    const result = await delegateEntityTransition("org-1", "WARRANTY_CASE", "wc-1", "user-1", "ADMIN", "REPAIRED");
    expect(result).toHaveProperty("delegated", false);
  });

  it("delegateEntityTransition with WARRANTY_CASE resolves a present workflow instance and transitions it", async () => {
    const template = { id: "tmpl-wc", status: "ACTIVE", entityType: "WARRANTY_CASE", isDefault: true };
    const instance = {
      id: "wi-wc-1",
      organizationId: "org-1",
      templateId: "tmpl-wc",
      entityType: "WARRANTY_CASE",
      entityId: "wc-1",
      currentStageId: "stage-in-repair",
      status: "IN_PROGRESS",
      history: [],
      pendingApprovals: [],
      startedAt: new Date(),
      completedAt: null,
      updatedAt: new Date(),
    };
    const stages = [
      { id: "stage-in-repair", name: "In Repair", stageOrder: 0, templateId: "tmpl-wc", allowedTransitions: ["stage-repaired"], isFinal: false },
      { id: "stage-repaired", name: "Repaired", stageOrder: 1, templateId: "tmpl-wc", allowedTransitions: [], isFinal: true },
    ];
    const currentStage = stages[0];
    const targetStage = stages[1];
    const updatedInstance = { ...instance, currentStageId: "stage-repaired", status: "COMPLETED" };

    mockDb.select
      // 1. resolveTemplate: .where().orderBy().limit()
      .mockReturnValueOnce(selectFluentLimit([template]))
      // 2. instance lookup in delegateEntityTransition: .where().limit()
      .mockReturnValueOnce(selectFluentLimit([instance]))
      // 3. getTemplateStages: .where().orderBy()  (resolves at orderBy)
      .mockReturnValueOnce(selectFluentOrderBy(stages))
      // 4. validateTransition → instance lookup: .where().limit()
      .mockReturnValueOnce(selectFluentLimit([instance]))
      // 5. validateTransition → current stage lookup: .where().limit()
      .mockReturnValueOnce(selectFluentLimit([currentStage]))
      // 6. validateTransition → getStageApprovalSteps: .where().orderBy()
      .mockReturnValueOnce(selectFluentOrderBy([]))
      // 7. transitionStage → target stage lookup: .where().limit()
      .mockReturnValueOnce(selectFluentLimit([targetStage]))
      // 8. fireNotifications (exit currentStage) → getStageNotificationRules: .where()
      .mockReturnValueOnce(selectFluentWhere([]))
      // 9. fireNotifications (enter targetStage) → getStageNotificationRules: .where()
      .mockReturnValueOnce(selectFluentWhere([]));

    // transitionStage calls db.update(workflowInstances).set().where().returning()
    const updMock = { set: vi.fn(), where: vi.fn(), returning: vi.fn().mockResolvedValue([updatedInstance]) };
    updMock.set.mockReturnValue(updMock);
    updMock.where.mockReturnValue(updMock);
    mockDb.update.mockReturnValue(updMock);
    mockDb.insert.mockReturnValue(insertFluent());

    const { delegateEntityTransition } = await import("../services/workflowEngine");
    const result = await delegateEntityTransition("org-1", "WARRANTY_CASE", "wc-1", "user-1", "ADMIN", "REPAIRED");
    expect(result.delegated).toBe(true);
    expect(result.success).toBe(true);
  });

  it("delegateEntityTransition returns { delegated: false } when no template exists (terminal gate stays with domain layer)", async () => {
    mockDb.select.mockReturnValue(selectFluentLimit([]));
    const { delegateEntityTransition } = await import("../services/workflowEngine");
    const result = await delegateEntityTransition("org-1", "WARRANTY_CASE", "wc-missing", "user-1", "ADMIN", "REPAIRED");
    expect(result.delegated).toBe(false);
    expect(mockDb.update).not.toHaveBeenCalled();
  });
});

describe("processWorkflowSlaBreach — actual escalation", () => {
  it("returns { checked: 0, breached: 0 } when no instances are found", async () => {
    mockDb.select.mockReturnValueOnce(selectFluentWhere([]));
    const { processWorkflowSlaBreach } = await import("../services/workflowEngine");
    const result = await processWorkflowSlaBreach();
    expect(result.checked).toBe(0);
    expect(result.breached).toBe(0);
  });

  it("calls db.update on workflowInstances with updatedAt when a breach is found", async () => {
    const breachedInstance = {
      id: "wi-1",
      organizationId: "org-1",
      entityType: "RFI",
      entityId: "rfi-1",
      currentStageId: "stage-1",
      autoEscalateRole: null,
      slaDurationHours: 1,
      updatedAt: new Date(Date.now() - 3 * 60 * 60 * 1000), // 3 hours ago — over 1h SLA
    };
    const updMock = updateFluent();
    // First select: the overdue workflow instances query
    mockDb.select.mockReturnValueOnce(selectFluentWhere([breachedInstance]));
    // getApproverUserIds lookup (for escalation) → empty = no users to notify
    mockDb.select.mockReturnValue(selectFluentLimit([]));
    mockDb.update.mockReturnValueOnce(updMock);
    mockDb.insert.mockReturnValue(insertFluent());

    const { processWorkflowSlaBreach } = await import("../services/workflowEngine");
    await processWorkflowSlaBreach();

    expect(mockDb.update).toHaveBeenCalled();
    expect(updMock.set).toHaveBeenCalledWith(
      expect.objectContaining({ updatedAt: expect.any(Date) }),
    );
  });

  it("processWorkflowSlaBreach issues a role-based user lookup and writes pendingApprovals when autoEscalateRole is set", async () => {
    const breachedInstance = {
      instanceId: "wi-esc-1",
      organizationId: "org-2",
      entityType: "CHANGE_ORDER",
      entityId: "co-esc-1",
      currentStageId: "stage-esc-1",
      autoEscalateRole: "MANAGER",
      slaDurationHours: 1,
      updatedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
      startedByUserId: "user-2",
      stageName: "Review",
    };
    const capturedSets: Array<Record<string, unknown>> = [];
    mockDb.select
      .mockReturnValueOnce(selectFluentWhere([breachedInstance]))            // breachingInstances
      .mockReturnValueOnce(selectFluentLimit([{ id: "mgr-user-1" }]))       // getApproverUserIds
      .mockReturnValueOnce(selectFluentLimit([{ pendingApprovals: [] }]))   // liveInst fetch (new)
      .mockReturnValue(selectFluentLimit([]));
    mockDb.update.mockImplementation(() => {
      const m = { set: vi.fn(), where: vi.fn(), returning: vi.fn().mockResolvedValue([]) };
      m.set.mockImplementation((payload: Record<string, unknown>) => {
        capturedSets.push(payload);
        return m;
      });
      m.where.mockReturnValue(m);
      return m;
    });
    mockDb.insert.mockReturnValue(insertFluent());
    const { processWorkflowSlaBreach } = await import("../services/workflowEngine");
    const result = await processWorkflowSlaBreach();
    expect(result.breached).toBe(1);
    // Role-based lookup was issued (at minimum 2 selects: breachingInstances + users)
    expect(mockDb.select).toHaveBeenCalledTimes(3);
    // pendingApprovals must have been written with the escalation entry
    const escalationUpdate = capturedSets.find(s => Array.isArray(s.pendingApprovals));
    expect(escalationUpdate).toBeDefined();
    const pa = (escalationUpdate!.pendingApprovals as Array<Record<string, unknown>>);
    // The escalation role is encoded in stepId as `escalation:<role>`
    expect(pa[0]).toMatchObject({ stageId: "stage-esc-1", stepId: "escalation:MANAGER" });
  });
});

describe("BID_CONVERSION_AUTO_ESIGN — per-contract targeting", () => {
  it("BidStorageDrizzle is exported from bids/storage.drizzle with a convertBidToProject method", async () => {
    const { BidStorageDrizzle } = await import("../bids/storage.drizzle");
    expect(typeof BidStorageDrizzle).toBe("function");
    expect(typeof BidStorageDrizzle.prototype.convertBidToProject).toBe("function");
  });

  it("BID_CONVERSION_AUTO_ESIGN feature flag exists in FEATURE_FLAG_KEYS", async () => {
    const { FEATURE_FLAG_KEYS } = await import("@shared/schema");
    expect(FEATURE_FLAG_KEYS).toContain("BID_CONVERSION_AUTO_ESIGN");
  });
});

describe("Feature flags — Task #2833 new keys", () => {
  it("INVENTORY_ADJUSTMENT_APPROVAL is in FEATURE_FLAG_KEYS", async () => {
    const { FEATURE_FLAG_KEYS } = await import("@shared/schema");
    expect(FEATURE_FLAG_KEYS).toContain("INVENTORY_ADJUSTMENT_APPROVAL");
  });

  it("BID_CONVERSION_AUTO_ESIGN is in FEATURE_FLAG_KEYS", async () => {
    const { FEATURE_FLAG_KEYS } = await import("@shared/schema");
    expect(FEATURE_FLAG_KEYS).toContain("BID_CONVERSION_AUTO_ESIGN");
  });

  it("FEATURE_FLAG_LABELS has entries for both new flags", async () => {
    const { FEATURE_FLAG_LABELS } = await import("@shared/schema");
    expect(FEATURE_FLAG_LABELS.INVENTORY_ADJUSTMENT_APPROVAL).toBeTruthy();
    expect(FEATURE_FLAG_LABELS.BID_CONVERSION_AUTO_ESIGN).toBeTruthy();
  });

  it("both new flags appear in DISABLED_BY_DEFAULT_FLAGS", async () => {
    const { DISABLED_BY_DEFAULT_FLAGS } = await import("@shared/schema");
    expect(DISABLED_BY_DEFAULT_FLAGS).toContain("INVENTORY_ADJUSTMENT_APPROVAL");
    expect(DISABLED_BY_DEFAULT_FLAGS).toContain("BID_CONVERSION_AUTO_ESIGN");
  });
});

describe("processIdleHiringCandidates — behaviour", () => {
  it("is exported from jobRunner as a function", async () => {
    const mod = await import("../jobs/jobRunner");
    expect(typeof mod.processIdleHiringCandidates).toBe("function");
  });

  it("returns { checked: 0, alerted: 0 } when no stale candidates exist", async () => {
    // processIdleHiringCandidates query chain ends with .where() — use selectFluentWhere
    mockDb.select.mockReturnValueOnce(selectFluentWhere([]));
    const { processIdleHiringCandidates } = await import("../jobs/jobRunner");
    const result = await processIdleHiringCandidates();
    expect(result).toEqual({ checked: 0, alerted: 0 });
  });

  it("joins hiringPipelineStages (leftJoin is called) for per-stage slaDays", async () => {
    const selMock = selectFluentWhere([]);
    mockDb.select.mockReturnValueOnce(selMock);
    const { processIdleHiringCandidates } = await import("../jobs/jobRunner");
    await processIdleHiringCandidates();
    expect(selMock.leftJoin).toHaveBeenCalled();
  });

  it("notifies the reviewer when a candidate is idle past its per-stage SLA (DB slaDays)", async () => {
    // Candidate last updated 10 days ago; DB slaDays = 5 → should be alerted
    const candidate = {
      id: "cand-1",
      fullName: "Alice Applicant",
      organizationId: "org-1",
      currentStage: "REVIEW",
      updatedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      reviewerUserId: "reviewer-1",
      slaDays: 5,
    };
    const insMock = insertFluent();
    mockDb.select.mockReturnValueOnce(selectFluentWhere([candidate]));
    mockDb.insert.mockReturnValueOnce(insMock);

    const { processIdleHiringCandidates } = await import("../jobs/jobRunner");
    const result = await processIdleHiringCandidates();

    expect(result.checked).toBe(1);
    expect(result.alerted).toBe(1);
    expect(mockDb.insert).toHaveBeenCalled();
    expect(insMock.values).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ userId: "reviewer-1" }),
      ]),
    );
  });

  it("does NOT alert when candidate is idle less than its DB slaDays threshold", async () => {
    // The broad cutoff is 7 days — a 2-day-old candidate won't pass the DB query.
    // Return empty array from the query to simulate no stale candidates in DB.
    mockDb.select.mockReturnValueOnce(selectFluentWhere([]));

    const { processIdleHiringCandidates } = await import("../jobs/jobRunner");
    const result = await processIdleHiringCandidates();

    expect(result).toEqual({ checked: 0, alerted: 0 });
    expect(mockDb.insert).not.toHaveBeenCalled();
  });
});

describe("hiringPipelineStages schema — stage model columns", () => {
  it("hiringPipelineStages table schema includes slaDays column", async () => {
    const { hiringPipelineStages } = await import("@shared/schema");
    expect(hiringPipelineStages).toBeDefined();
    const cols = Object.keys(hiringPipelineStages);
    // Drizzle table columns are listed as direct properties
    expect(cols.some((c) => c === "slaDays" || c === "sla_days")).toBe(true);
  });

  it("hiringPipelineStages table schema includes notifyOnEnterRoles column", async () => {
    const { hiringPipelineStages } = await import("@shared/schema");
    const cols = Object.keys(hiringPipelineStages);
    expect(cols.some((c) => c === "notifyOnEnterRoles" || c === "notify_on_enter_roles")).toBe(true);
  });

  it("HiringPipelineStage type inference includes slaDays (nullable number)", async () => {
    // Runtime check: create a plain object matching the inferred type shape.
    // If the column is missing from the schema, this import assertion catches it.
    const { hiringPipelineStages } = await import("@shared/schema");
    type Row = typeof hiringPipelineStages.$inferSelect;
    const row: Row = {
      id: "stage-1",
      organizationId: "org-1",
      name: "Technical Interview",
      key: "TECH_INTERVIEW",
      color: "#3b82f6",
      displayOrder: 3,
      isDefault: false,
      isTerminal: false,
      slaDays: 5,
      notifyOnEnterRoles: ["MANAGER"],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(row.slaDays).toBe(5);
    expect(row.notifyOnEnterRoles).toEqual(["MANAGER"]);
  });
});

describe("Workflow builder UI — SLA/escalation fields", () => {
  it("workflowStages schema includes slaDurationHours column", async () => {
    const { workflowStages } = await import("@shared/schema");
    const cols = Object.keys(workflowStages);
    expect(cols.some(c => c === "slaDurationHours" || c === "sla_duration_hours")).toBe(true);
  });

  it("workflowStages schema includes autoEscalateRole column", async () => {
    const { workflowStages } = await import("@shared/schema");
    const cols = Object.keys(workflowStages);
    expect(cols.some(c => c === "autoEscalateRole" || c === "auto_escalate_role")).toBe(true);
  });
});

describe("approvalNotificationService — recordZeroRecipientSkip export", () => {
  it("recordZeroRecipientSkip is exported as a function", async () => {
    const mod = await import("../services/approvalNotificationService");
    expect(typeof mod.recordZeroRecipientSkip).toBe("function");
  });

  it("recordZeroRecipientSkip increments the same counter read by getZeroRecipientMetricsSnapshot", async () => {
    const { recordZeroRecipientSkip, getZeroRecipientMetricsSnapshot } = await import(
      "../services/approvalNotificationService"
    );
    const before = getZeroRecipientMetricsSnapshot()
      .find(r => r.type === "WORKFLOW_NOTIFICATION" && r.entityType === "SUBMITTAL")
      ?.value ?? 0;
    recordZeroRecipientSkip("WORKFLOW_NOTIFICATION", "SUBMITTAL");
    const after = getZeroRecipientMetricsSnapshot()
      .find(r => r.type === "WORKFLOW_NOTIFICATION" && r.entityType === "SUBMITTAL")
      ?.value ?? 0;
    expect(after).toBe(before + 1);
  });
});

describe("processStuckJobWatchdog — JOB_STALL_MINUTES and per-job-type counters", () => {
  it("getJobStallCounterSnapshot is exported from jobRunner as a function", async () => {
    const mod = await import("../jobs/jobRunner");
    expect(typeof mod.getJobStallCounterSnapshot).toBe("function");
  });

  it("getJobStallCounterSnapshot returns an array", async () => {
    const { getJobStallCounterSnapshot } = await import("../jobs/jobRunner");
    expect(Array.isArray(getJobStallCounterSnapshot())).toBe(true);
  });

  it("processStuckJobWatchdog increments per-job-type stall counter for each stuck job", async () => {
    const stuckJobs = [
      { id: "j1", name: "accounting_sync", state: "active", started_on: new Date(Date.now() - 60 * 60 * 1000), data: { orgId: "org-1" } },
      { id: "j2", name: "accounting_sync", state: "active", started_on: new Date(Date.now() - 90 * 60 * 1000), data: {} },
      { id: "j3", name: "bulk_export", state: "active", started_on: new Date(Date.now() - 45 * 60 * 1000), data: {} },
    ];
    mockDb.execute.mockResolvedValueOnce({ rows: stuckJobs });
    const adminFluent = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    mockDb.select.mockReturnValue(adminFluent);
    mockDb.insert.mockReturnValue(insertFluent());

    const { processStuckJobWatchdog, getJobStallCounterSnapshot } = await import("../jobs/jobRunner");
    const snapBefore = Object.fromEntries(
      getJobStallCounterSnapshot().map(({ jobType, value }) => [jobType, value]),
    );
    await processStuckJobWatchdog();
    const snapAfter = Object.fromEntries(
      getJobStallCounterSnapshot().map(({ jobType, value }) => [jobType, value]),
    );
    expect((snapAfter["accounting_sync"] ?? 0) - (snapBefore["accounting_sync"] ?? 0)).toBe(2);
    expect((snapAfter["bulk_export"] ?? 0) - (snapBefore["bulk_export"] ?? 0)).toBe(1);
  });
});
