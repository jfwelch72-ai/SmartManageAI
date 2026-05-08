/**
 * Task #1492 — runtime guard tests for server/auditLogger.ts.
 *
 * Companion to the lint at scripts/audit-audit-logger-userid.mjs. These tests
 * exercise the defense-in-depth guard that refuses to insert an audit row
 * when the userId is anything other than a non-empty string. Without the
 * guard, passing the entire Express Request as the userId (the original
 * Task #1454 bug) makes the Neon driver throw "Converting circular structure
 * to JSON", which is swallowed by the helper's try/catch and silently drops
 * the audit row.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const insertValuesMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../db", () => ({
  db: {
    insert: () => ({ values: insertValuesMock }),
  },
}));

const logErrorMock = vi.fn();
vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: logErrorMock,
}));

beforeEach(() => {
  insertValuesMock.mockClear();
  logErrorMock.mockReset();
});

describe("auditLogger userId guard", () => {
  it("logCreate refuses to insert when an Express-Request-shaped object is passed as userId", async () => {
    const { logCreate } = await import("../auditLogger");
    const fakeReq: any = { ip: "10.0.0.1", socket: {}, user: { id: "u-1" } };

    await expect(
      logCreate(
        fakeReq as unknown as string,
        "plan_document",
        "doc-1",
        { source: "url" },
      ),
    ).resolves.toBeUndefined();

    expect(insertValuesMock).not.toHaveBeenCalled();
    expect(logErrorMock).toHaveBeenCalledTimes(1);
    const [message] = logErrorMock.mock.calls[0];
    expect(String(message)).toMatch(/non-string userId/);
    expect(String(message)).toMatch(/Express Request/);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["empty string", ""],
    ["number", 42],
  ])("logAudit refuses to insert when userId is %s", async (_name, value) => {
    const { logAudit } = await import("../auditLogger");
    await expect(
      logAudit({
        userId: value as unknown as string,
        entityType: "plan_document",
        entityId: "doc-1",
        action: "CREATE",
        oldValue: null,
        newValue: "{}",
      }),
    ).resolves.toBeUndefined();

    expect(insertValuesMock).not.toHaveBeenCalled();
    expect(logErrorMock).toHaveBeenCalledTimes(1);
  });

  it("logCreate still inserts when userId is a valid string", async () => {
    const { logCreate } = await import("../auditLogger");
    await expect(
      logCreate("user-123", "plan_document", "doc-2", { ok: true }),
    ).resolves.toBeUndefined();

    expect(insertValuesMock).toHaveBeenCalledTimes(1);
    expect(insertValuesMock.mock.calls[0][0].userId).toBe("user-123");
    expect(logErrorMock).not.toHaveBeenCalled();
  });
});
