/**
 * Regression test for Task #1454.
 *
 * The cloud-document import routes were calling logCreate(req, ...)
 * (passing the whole Express Request as the userId), which made the
 * Neon driver try to JSON.stringify the request — including its
 * underlying Socket — and fail with
 *   "Converting circular structure to JSON".
 *
 * After the fix the call sites pass req.user!.id as the userId and
 * the Request as the optional `req` argument. This test asserts that
 * logCreate / logAudit can be invoked with a real-shaped Express
 * AuthRequest (with a circular socket reference) without throwing
 * and without surfacing an "Audit logging failed" error.
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
  logError: (...args: unknown[]) => logErrorMock(...args),
}));

function buildFakeRequestWithCircularSocket(): any {
  const socket: any = { remoteAddress: "10.0.0.1" };
  // Mirror Node's HTTPParser <-> Socket cycle that triggers the
  // "Converting circular structure to JSON" failure.
  socket.parser = { socket };
  const req: any = {
    ip: "10.0.0.1",
    socket,
    headers: { "user-agent": "vitest-agent/1.0" },
    get(name: string) {
      return this.headers[name.toLowerCase()];
    },
    user: { id: "user-123", organizationId: "org-1" },
  };
  return req;
}

beforeEach(() => {
  insertValuesMock.mockClear();
  logErrorMock.mockReset();
});

describe("auditLogger with an Express AuthRequest", () => {
  it("logAudit does not throw on a request whose socket has a circular reference", async () => {
    const { logAudit } = await import("../auditLogger");
    const req = buildFakeRequestWithCircularSocket();

    await expect(
      logAudit(
        {
          userId: req.user.id,
          entityType: "plan_document",
          entityId: "doc-1",
          action: "CREATE",
          oldValue: null,
          newValue: JSON.stringify({ source: "url" }),
        },
        req,
      ),
    ).resolves.toBeUndefined();

    expect(insertValuesMock).toHaveBeenCalledTimes(1);
    const inserted = insertValuesMock.mock.calls[0][0];
    expect(inserted.userId).toBe("user-123");
    expect(inserted.ipAddress).toBe("10.0.0.1");
    expect(inserted.userAgent).toBe("vitest-agent/1.0");
    expect(logErrorMock).not.toHaveBeenCalled();
  });

  it("logCreate persists an audit row instead of crashing on the request socket", async () => {
    const { logCreate } = await import("../auditLogger");
    const req = buildFakeRequestWithCircularSocket();

    await expect(
      logCreate(
        req.user.id,
        "plan_document",
        "doc-2",
        { source: "gdrive", title: "Plans.pdf" },
        req,
      ),
    ).resolves.toBeUndefined();

    expect(insertValuesMock).toHaveBeenCalledTimes(1);
    const inserted = insertValuesMock.mock.calls[0][0];
    expect(inserted.action).toBe("CREATE");
    expect(inserted.entityType).toBe("plan_document");
    expect(inserted.entityId).toBe("doc-2");
    expect(inserted.userId).toBe("user-123");
    expect(typeof inserted.newValue).toBe("string");
    expect(JSON.parse(inserted.newValue)).toEqual({
      source: "gdrive",
      title: "Plans.pdf",
    });
    expect(logErrorMock).not.toHaveBeenCalled();
  });
});
