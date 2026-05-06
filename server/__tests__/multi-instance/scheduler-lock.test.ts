/**
 * Task #2427 — autoscale safety: only one replica may run a scheduler
 * tick at a time.
 *
 * `withSchedulerLock(name, fn)` opens a dedicated pool client, opens a
 * transaction, attempts `pg_try_advisory_xact_lock(NAMESPACE,
 * hashtext(name))`, runs `fn` if and only if the lock is acquired, and
 * releases the lock on COMMIT/ROLLBACK (or on connection drop).
 *
 * This test does not need a real Postgres — it stubs the pool's
 * `connect()` to return a fake client that implements the in-memory
 * advisory-lock semantics we care about. Two parallel callers race to
 * acquire the same lock; exactly one runs.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const heldLocks = new Set<string>();

vi.mock("../../db", () => {
  const makeClient = () => {
    let inTx = false;
    let myLock: string | null = null;
    return {
      query: async (text: string, params?: unknown[]) => {
        const t = String(text).trim().toUpperCase();
        if (t === "BEGIN") {
          inTx = true;
          return { rows: [] };
        }
        if (t.startsWith("COMMIT") || t.startsWith("ROLLBACK")) {
          if (myLock) {
            heldLocks.delete(myLock);
            myLock = null;
          }
          inTx = false;
          return { rows: [] };
        }
        if (t.includes("PG_TRY_ADVISORY_XACT_LOCK")) {
          // Build the lock identity from the params we passed in
          // schedulerLock.ts: ($1::int, hashtext($2)::int).
          const namespace = String((params ?? [])[0]);
          const name = String((params ?? [])[1]);
          const id = `${namespace}::${name}`;
          if (heldLocks.has(id)) {
            return { rows: [{ got: false }] };
          }
          heldLocks.add(id);
          myLock = id;
          return { rows: [{ got: true }] };
        }
        return { rows: [] };
      },
      release: () => {
        if (myLock) {
          heldLocks.delete(myLock);
          myLock = null;
        }
        inTx = false;
      },
    };
  };

  return {
    pool: {
      connect: async () => makeClient(),
    },
    db: {},
  };
});

vi.mock("../../utils/logger", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

let withSchedulerLock: typeof import("../../utils/schedulerLock").withSchedulerLock;

beforeEach(async () => {
  heldLocks.clear();
  ({ withSchedulerLock } = await import("../../utils/schedulerLock"));
});

describe("withSchedulerLock — leader election (Task #2427)", () => {
  it("only one of two parallel callers runs the protected fn", async () => {
    let runCount = 0;
    const slow = async () => {
      runCount++;
      // Hold the lock long enough for the second caller to attempt
      // and fail to acquire it.
      await new Promise((r) => setTimeout(r, 25));
      return "ok";
    };

    const [a, b] = await Promise.all([
      withSchedulerLock("test-job", slow),
      withSchedulerLock("test-job", slow),
    ]);

    expect(runCount).toBe(1);
    const ranResults = [a, b].filter((r) => r.ran);
    const skippedResults = [a, b].filter((r) => !r.ran);
    expect(ranResults).toHaveLength(1);
    expect(skippedResults).toHaveLength(1);
    expect(ranResults[0].value).toBe("ok");
  });

  it("releases the lock after the fn finishes so a follow-up tick can re-acquire", async () => {
    const r1 = await withSchedulerLock("test-job-2", async () => "first");
    const r2 = await withSchedulerLock("test-job-2", async () => "second");
    expect(r1).toEqual({ ran: true, value: "first" });
    expect(r2).toEqual({ ran: true, value: "second" });
  });

  it("releases the lock when the fn throws so the next tick can run", async () => {
    await expect(
      withSchedulerLock("test-job-3", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const r = await withSchedulerLock("test-job-3", async () => "recovered");
    expect(r).toEqual({ ran: true, value: "recovered" });
  });

  it("different lock names do not block each other", async () => {
    let aRan = false;
    let bRan = false;
    const slow = (flag: "a" | "b") => async () => {
      if (flag === "a") aRan = true;
      else bRan = true;
      await new Promise((r) => setTimeout(r, 15));
      return flag;
    };

    const [a, b] = await Promise.all([
      withSchedulerLock("job-A", slow("a")),
      withSchedulerLock("job-B", slow("b")),
    ]);

    expect(aRan).toBe(true);
    expect(bRan).toBe(true);
    expect(a.ran).toBe(true);
    expect(b.ran).toBe(true);
  });
});
