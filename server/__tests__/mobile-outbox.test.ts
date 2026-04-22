import { describe, it, expect, beforeEach, vi } from "vitest";

type Row = {
  local_id: string;
  entity_type: string;
  operation: string;
  server_id: string | null;
  payload: string;
  attachments: string | null;
  client_timestamp: string;
  status: string;
  retry_count: number;
  last_error: string | null;
  conflict_server_updated_at: string | null;
};

const store: { rows: Row[] } = { rows: [] };

function findRow(localId: string): Row | undefined {
  return store.rows.find((r) => r.local_id === localId);
}

type Param = string | number | null | undefined;

const fakeDb = {
  async runAsync(sqlText: string, params: Param[] = []): Promise<void> {
    const s = sqlText.trim();
    if (s.startsWith("INSERT INTO outbox")) {
      const [
        local_id,
        entity_type,
        operation,
        server_id,
        payload,
        attachments,
        client_timestamp,
        status,
      ] = params as [string, string, string, string | null, string, string | null, string, string];
      store.rows.push({
        local_id,
        entity_type,
        operation,
        server_id: server_id ?? null,
        payload,
        attachments: attachments ?? null,
        client_timestamp,
        status,
        retry_count: 0,
        last_error: null,
        conflict_server_updated_at: null,
      });
      return;
    }
    if (s.startsWith("UPDATE outbox SET status='SYNCED'")) {
      const [serverId, localId] = params as [string | null, string];
      const row = findRow(localId);
      if (row) {
        row.status = "SYNCED";
        row.server_id = serverId ?? row.server_id;
        row.last_error = null;
      }
      return;
    }
    if (s.startsWith("UPDATE outbox SET status='FAILED'")) {
      const [err, localId] = params as [string, string];
      const row = findRow(localId);
      if (row) {
        row.status = "FAILED";
        row.retry_count += 1;
        row.last_error = err;
      }
      return;
    }
    if (s.startsWith("UPDATE outbox SET status='CONFLICT'")) {
      const [serverUpdatedAt, localId] = params as [string, string];
      const row = findRow(localId);
      if (row) {
        row.status = "CONFLICT";
        row.conflict_server_updated_at = serverUpdatedAt;
      }
      return;
    }
    if (s.startsWith("UPDATE outbox SET status='PENDING'")) {
      const [clientTimestamp, payload, localId] = params as [string, string, string];
      const row = findRow(localId);
      if (row) {
        row.status = "PENDING";
        row.retry_count = 0;
        row.last_error = null;
        row.conflict_server_updated_at = null;
        row.client_timestamp = clientTimestamp;
        row.payload = payload;
      }
      return;
    }
    if (s.startsWith("DELETE FROM outbox WHERE local_id=?")) {
      const [localId] = params as [string];
      store.rows = store.rows.filter((r) => r.local_id !== localId);
      return;
    }
    if (s.startsWith("DELETE FROM outbox WHERE status='SYNCED'")) {
      store.rows = store.rows.filter((r) => r.status !== "SYNCED");
      return;
    }
    throw new Error(`fakeDb.runAsync: unhandled SQL: ${s}`);
  },
  async getAllAsync<T>(sqlText: string, params: Param[] = []): Promise<T[]> {
    const s = sqlText.trim();
    if (s.startsWith("SELECT * FROM outbox WHERE status = ?")) {
      const [status] = params as [string];
      return store.rows
        .filter((r) => r.status === status)
        .sort((a, b) => a.client_timestamp.localeCompare(b.client_timestamp)) as unknown as T[];
    }
    if (s.startsWith("SELECT * FROM outbox ORDER BY")) {
      return [...store.rows].sort((a, b) =>
        a.client_timestamp.localeCompare(b.client_timestamp)
      ) as unknown as T[];
    }
    if (s.startsWith("SELECT * FROM outbox WHERE status='PENDING'")) {
      const [maxRetries] = params as [number];
      return store.rows
        .filter(
          (r) =>
            r.status === "PENDING" ||
            (r.status === "FAILED" && r.retry_count < maxRetries)
        )
        .sort((a, b) => a.client_timestamp.localeCompare(b.client_timestamp)) as unknown as T[];
    }
    throw new Error(`fakeDb.getAllAsync: unhandled SQL: ${s}`);
  },
  async getFirstAsync<T>(sqlText: string, params: Param[] = []): Promise<T | undefined> {
    const s = sqlText.trim();
    if (s.startsWith("SELECT COUNT(*) AS c FROM outbox")) {
      const c = store.rows.filter(
        (r) => r.status === "PENDING" || r.status === "FAILED"
      ).length;
      return { c } as unknown as T;
    }
    if (s.startsWith("SELECT payload FROM outbox WHERE local_id=?")) {
      const [localId] = params as [string];
      const row = findRow(localId);
      return row ? ({ payload: row.payload } as unknown as T) : undefined;
    }
    throw new Error(`fakeDb.getFirstAsync: unhandled SQL: ${s}`);
  },
};

vi.mock("../../mobile/src/sync/db", () => ({
  getDb: async () => fakeDb,
}));

import {
  enqueue,
  markSynced,
  markFailed,
  markConflict,
  resolveConflict,
  listOutbox,
  listRetryable,
  pendingCount,
  clearSynced,
} from "../../mobile/src/sync/outbox";

beforeEach(() => {
  store.rows = [];
});

describe("mobile outbox", () => {
  it("enqueue then markSynced flips PENDING to SYNCED with server id", async () => {
    const rec = await enqueue({
      entityType: "HAUL_TICKET",
      operation: "CREATE",
      payload: { ticketNumber: "T-1", quantity: 5 },
    });

    expect(rec.status).toBe("PENDING");
    expect(await pendingCount()).toBe(1);

    await markSynced(rec.localId, "server-uuid-1");

    const all = await listOutbox();
    expect(all[0].status).toBe("SYNCED");
    expect(all[0].serverId).toBe("server-uuid-1");
    expect(all[0].lastError).toBeNull();
    expect(await pendingCount()).toBe(0);

    await clearSynced();
    expect(await listOutbox()).toHaveLength(0);
  });

  it("enqueue then markConflict then resolveConflict LOCAL_WINS re-queues with fresh timestamp and resolution marker", async () => {
    const rec = await enqueue({
      entityType: "HAUL_TICKET",
      operation: "UPDATE",
      serverId: "server-uuid-2",
      payload: { id: "server-uuid-2", ticketNumber: "T-EDIT" },
    });
    const originalTimestamp = rec.clientTimestamp;

    const serverUpdatedAt = new Date(Date.now() + 60_000).toISOString();
    await markConflict(rec.localId, serverUpdatedAt);

    let all = await listOutbox();
    expect(all[0].status).toBe("CONFLICT");
    expect(all[0].conflictServerUpdatedAt).toBe(serverUpdatedAt);
    expect(await listRetryable()).toHaveLength(0);

    await new Promise((r) => setTimeout(r, 2));
    await resolveConflict(rec.localId, "LOCAL_WINS");

    all = await listOutbox();
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe("PENDING");
    expect(all[0].retryCount).toBe(0);
    expect(all[0].lastError).toBeNull();
    expect(all[0].conflictServerUpdatedAt).toBeNull();
    expect(all[0].clientTimestamp).not.toBe(originalTimestamp);

    const payload = all[0].payload as { _resolution?: string };
    expect(payload._resolution).toBe("LOCAL_WINS");

    const retryable = await listRetryable();
    expect(retryable).toHaveLength(1);
    expect(retryable[0].localId).toBe(rec.localId);
  });

  it("resolveConflict SERVER_WINS drops the local row", async () => {
    const rec = await enqueue({
      entityType: "RFI",
      operation: "UPDATE",
      serverId: "rfi-1",
      payload: { id: "rfi-1", subject: "x" },
    });
    await markConflict(rec.localId, new Date().toISOString());
    await resolveConflict(rec.localId, "SERVER_WINS");
    expect(await listOutbox()).toHaveLength(0);
  });

  it("markFailed increments retry_count and listRetryable respects the cap", async () => {
    const rec = await enqueue({
      entityType: "PHOTO",
      operation: "CREATE",
      payload: { name: "p.jpg" },
    });
    await markFailed(rec.localId, "network down");
    await markFailed(rec.localId, "network down");

    const all = await listOutbox();
    expect(all[0].status).toBe("FAILED");
    expect(all[0].retryCount).toBe(2);
    expect(all[0].lastError).toBe("network down");

    expect(await listRetryable(5)).toHaveLength(1);
    expect(await listRetryable(2)).toHaveLength(0);
  });
});
