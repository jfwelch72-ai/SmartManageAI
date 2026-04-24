import { getDb } from "./db";
import type { OutboxRecord, SyncEntityType, SyncOperation } from "./types";

function uuid(): string {
  // Lightweight RFC4122 v4 (sufficient for client-only local IDs).
  const r = (n: number) =>
    [...Array(n)].map(() => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${r(8)}-${r(4)}-4${r(3)}-${"89ab"[Math.floor(Math.random() * 4)]}${r(3)}-${r(12)}`;
}

export async function enqueue(input: {
  entityType: SyncEntityType;
  operation: SyncOperation;
  serverId?: string | null;
  payload: Record<string, unknown>;
  attachments?: OutboxRecord["attachments"];
}): Promise<OutboxRecord> {
  const db = await getDb();
  const rec: OutboxRecord = {
    localId: uuid(),
    entityType: input.entityType,
    operation: input.operation,
    serverId: input.serverId ?? null,
    payload: input.payload,
    attachments: input.attachments,
    clientTimestamp: new Date().toISOString(),
    status: "PENDING",
    retryCount: 0,
  };
  await db.runAsync(
    `INSERT INTO outbox(local_id, entity_type, operation, server_id, payload, attachments, client_timestamp, status, retry_count)
     VALUES(?,?,?,?,?,?,?,?,0)`,
    [
      rec.localId,
      rec.entityType,
      rec.operation,
      rec.serverId ?? null,
      JSON.stringify(rec.payload),
      rec.attachments ? JSON.stringify(rec.attachments) : null,
      rec.clientTimestamp,
      rec.status,
    ]
  );
  return rec;
}

export async function listOutbox(status?: OutboxRecord["status"]): Promise<OutboxRecord[]> {
  const db = await getDb();
  const rows = status
    ? await db.getAllAsync<any>("SELECT * FROM outbox WHERE status = ? ORDER BY client_timestamp ASC", [status])
    : await db.getAllAsync<any>("SELECT * FROM outbox ORDER BY client_timestamp ASC");
  return rows.map(rowToRecord);
}

// Returns rows the sync coordinator should attempt: anything PENDING plus
// FAILED rows under the retry cap. Without this, transient network/server
// failures would leave records permanently stuck in FAILED until manual
// re-enqueue. CONFLICT rows are intentionally excluded — they require user
// resolution via resolveConflict().
export async function listRetryable(maxRetries = 5): Promise<OutboxRecord[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    "SELECT * FROM outbox WHERE status='PENDING' OR (status='FAILED' AND retry_count < ?) ORDER BY client_timestamp ASC",
    [maxRetries]
  );
  return rows.map(rowToRecord);
}

export async function pendingCount(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ c: number }>(
    "SELECT COUNT(*) AS c FROM outbox WHERE status IN ('PENDING','FAILED')"
  );
  return row?.c ?? 0;
}

export async function markSynced(localId: string, serverId?: string | null): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "UPDATE outbox SET status='SYNCED', server_id=COALESCE(?, server_id), last_error=NULL WHERE local_id=?",
    [serverId ?? null, localId]
  );
}

export async function markFailed(localId: string, error: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "UPDATE outbox SET status='FAILED', retry_count=retry_count+1, last_error=? WHERE local_id=?",
    [error, localId]
  );
}

export async function markConflict(
  localId: string,
  serverUpdatedAt: string,
  reason?: string
): Promise<void> {
  const db = await getDb();
  // Task #1607: persist the human-readable conflict reason in
  // last_error so the SUBMITTAL_STAMP screen (and any other surface
  // listing the outbox) can render "office already approved this
  // review" instead of a generic "CONFLICT" pill.
  await db.runAsync(
    "UPDATE outbox SET status='CONFLICT', conflict_server_updated_at=?, last_error=? WHERE local_id=?",
    [serverUpdatedAt, reason ?? null, localId]
  );
}

export async function resolveConflict(
  localId: string,
  resolution: "LOCAL_WINS" | "SERVER_WINS"
): Promise<void> {
  const db = await getDb();
  if (resolution === "SERVER_WINS") {
    await db.runAsync("DELETE FROM outbox WHERE local_id=?", [localId]);
    return;
  }
  // LOCAL_WINS: re-queue with a fresh client timestamp AND mark the
  // payload with `_resolution: "LOCAL_WINS"` so the server bypasses the
  // timestamp-based conflict check on the next push. Without bumping
  // clientTimestamp the server would just detect the same conflict
  // again (server.updatedAt > stale client_timestamp), trapping the
  // record in a CONFLICT loop.
  const now = new Date().toISOString();
  const row = await db.getFirstAsync<{ payload: string }>(
    "SELECT payload FROM outbox WHERE local_id=?",
    [localId]
  );
  let payload: Record<string, unknown> = {};
  try {
    payload = row?.payload ? JSON.parse(row.payload) : {};
  } catch {
    payload = {};
  }
  payload._resolution = "LOCAL_WINS";
  await db.runAsync(
    "UPDATE outbox SET status='PENDING', retry_count=0, last_error=NULL, conflict_server_updated_at=NULL, client_timestamp=?, payload=? WHERE local_id=?",
    [now, JSON.stringify(payload), localId]
  );
}

export async function clearSynced(): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM outbox WHERE status='SYNCED'");
}

function rowToRecord(r: any): OutboxRecord {
  return {
    localId: r.local_id,
    entityType: r.entity_type,
    operation: r.operation,
    serverId: r.server_id,
    payload: JSON.parse(r.payload),
    attachments: r.attachments ? JSON.parse(r.attachments) : undefined,
    clientTimestamp: r.client_timestamp,
    status: r.status,
    retryCount: r.retry_count,
    lastError: r.last_error,
    conflictServerUpdatedAt: r.conflict_server_updated_at,
  };
}
