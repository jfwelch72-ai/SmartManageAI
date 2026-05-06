/**
 * Task #2427 — autoscale safety: cross-replica enforcement of the 5
 * `express-rate-limit` limiters defined in `server/rateLimiter.ts`.
 *
 * The motivating bug: `express-rate-limit`'s default `MemoryStore` is
 * per-process, so a client whose requests round-robin across N pods
 * effectively gets N times the configured per-window quota. Task #2427
 * routes every limiter through `PgExpressRateLimitStore`, which keeps
 * counters in the shared `rate_limit_state` table.
 *
 * This test simulates two replicas WITHOUT spinning up real Postgres:
 *   - We swap in a hand-rolled in-memory `db` mock that mimics the
 *     atomic `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` semantics
 *     used by `PgExpressRateLimitStore.increment`. Both replicas point
 *     at the same `Map` instance, modelling the production "every pod
 *     points at the same Postgres row" topology.
 *   - We construct two independent `PgExpressRateLimitStore` instances
 *     bound to two distinct Express apps, then drive requests against
 *     each app and assert that hits on app B are counted toward the
 *     same bucket primed by app A.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import rateLimit from "express-rate-limit";

type Row = {
  key: string;
  hit_count: number | null;
  window_expires_at: Date | null;
  last_invoked_at: Date | null;
};

const sharedTable = new Map<string, Row>();

vi.mock("../../db", () => ({
  db: {
    // Minimal sql-tag aware execute — interprets the small set of
    // statements PgExpressRateLimitStore issues. We don't need a full
    // SQL engine, just the four shapes used by increment/decrement/
    // resetKey/get.
    execute: async (q: any) => {
      // drizzle's `sql` template alternates `StringChunk` objects
      // (with a `.value: string[]`) with raw primitive parameters.
      const chunks: any[] = q?.queryChunks ?? [];
      const text = chunks
        .map((c: any) =>
          c && typeof c === "object" && Array.isArray(c.value)
            ? c.value.join("")
            : "?",
        )
        .join("");
      const flatParams: unknown[] = chunks.filter(
        (c: any) => !(c && typeof c === "object" && Array.isArray(c.value)),
      );

      const now = new Date();
      const lower = text.toLowerCase();

      if (lower.includes("insert into rate_limit_state")) {
        const key = String(flatParams[0]);
        const windowSeconds = Number(flatParams[1]);
        const existing = sharedTable.get(key);
        if (
          !existing ||
          existing.window_expires_at == null ||
          existing.window_expires_at <= now
        ) {
          const row: Row = {
            key,
            hit_count: 1,
            window_expires_at: new Date(now.getTime() + windowSeconds * 1000),
            last_invoked_at: now,
          };
          sharedTable.set(key, row);
          return { rows: [row] };
        }
        existing.hit_count = (existing.hit_count ?? 0) + 1;
        existing.last_invoked_at = now;
        sharedTable.set(key, existing);
        return { rows: [existing] };
      }

      if (lower.startsWith(" update rate_limit_state") || lower.includes("update rate_limit_state")) {
        const key = String(flatParams[0]);
        const existing = sharedTable.get(key);
        if (existing && existing.hit_count != null) {
          existing.hit_count = Math.max(existing.hit_count - 1, 0);
        }
        return { rows: [] };
      }

      if (lower.includes("delete from rate_limit_state") && lower.includes("where key =")) {
        const key = String(flatParams[0]);
        sharedTable.delete(key);
        return { rows: [], rowCount: 1 };
      }

      if (lower.includes("delete from rate_limit_state") && lower.includes("like")) {
        const prefix = String(flatParams[0]).replace("%", "");
        let n = 0;
        for (const k of Array.from(sharedTable.keys())) {
          if (k.startsWith(prefix)) {
            sharedTable.delete(k);
            n++;
          }
        }
        return { rows: [], rowCount: n };
      }

      if (lower.includes("select hit_count")) {
        const key = String(flatParams[0]);
        const row = sharedTable.get(key);
        return { rows: row ? [row] : [] };
      }

      return { rows: [] };
    },
  },
  pool: {},
}));

vi.mock("../../utils/logger", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

let PgExpressRateLimitStore: typeof import("../../utils/expressRateLimitPgStore").PgExpressRateLimitStore;

function buildReplica(prefix: string, max: number, windowMs: number): Express {
  const store = new PgExpressRateLimitStore(prefix);
  const limiter = rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => (req.headers["x-test-key"] as string) ?? "anon",
    store,
  });
  const app = express();
  app.use(limiter);
  app.get("/ping", (_req, res) => res.json({ ok: true }));
  return app;
}

beforeEach(async () => {
  sharedTable.clear();
  ({ PgExpressRateLimitStore } = await import(
    "../../utils/expressRateLimitPgStore"
  ));
});

describe("PgExpressRateLimitStore — cross-replica enforcement (Task #2427)", () => {
  it("counts hits issued against replica B toward the same bucket primed by replica A", async () => {
    // Limit: 3 requests per window. Hit replica A twice, then hit
    // replica B three times. With per-process state replica B would
    // see only its own counter (2 of 3 still allowed). With the shared
    // store, replica B's third hit must be the one that 429s.
    const replicaA = buildReplica("test", 3, 60_000);
    const replicaB = buildReplica("test", 3, 60_000);

    const a1 = await request(replicaA).get("/ping").set("x-test-key", "alice");
    const a2 = await request(replicaA).get("/ping").set("x-test-key", "alice");
    expect(a1.status).toBe(200);
    expect(a2.status).toBe(200);

    const b1 = await request(replicaB).get("/ping").set("x-test-key", "alice");
    const b2 = await request(replicaB).get("/ping").set("x-test-key", "alice");
    expect(b1.status).toBe(200); // 3rd hit overall — still allowed
    expect(b2.status).toBe(429); // 4th overall — over the limit
  });

  it("isolates buckets per prefix so different limiters don't bleed into each other", async () => {
    // The 5 limiters in `server/rateLimiter.ts` all share the same
    // table. They must not collide because each one passes a unique
    // prefix to PgExpressRateLimitStore.
    const auth = buildReplica("auth", 1, 60_000);
    const api = buildReplica("api", 1, 60_000);

    const r1 = await request(auth).get("/ping").set("x-test-key", "ip-1");
    expect(r1.status).toBe(200);

    // Same identity hitting a different limiter must be unaffected.
    const r2 = await request(api).get("/ping").set("x-test-key", "ip-1");
    expect(r2.status).toBe(200);

    // But hitting the same limiter again is over the limit.
    const r3 = await request(auth).get("/ping").set("x-test-key", "ip-1");
    expect(r3.status).toBe(429);
  });

  it("isolates buckets per key within the same limiter", async () => {
    const replicaA = buildReplica("test2", 1, 60_000);
    const replicaB = buildReplica("test2", 1, 60_000);

    const a = await request(replicaA).get("/ping").set("x-test-key", "alice");
    expect(a.status).toBe(200);

    const b = await request(replicaB).get("/ping").set("x-test-key", "bob");
    expect(b.status).toBe(200);
  });
});
