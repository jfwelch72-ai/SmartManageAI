import * as SQLite from "expo-sqlite";

let _db: SQLite.SQLiteDatabase | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  _db = await SQLite.openDatabaseAsync("smartmanageai.db");
  await _db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS cache_entities (
      entity_type TEXT NOT NULL,
      id TEXT NOT NULL,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (entity_type, id)
    );

    CREATE TABLE IF NOT EXISTS outbox (
      local_id TEXT PRIMARY KEY NOT NULL,
      entity_type TEXT NOT NULL,
      operation TEXT NOT NULL,
      server_id TEXT,
      payload TEXT NOT NULL,
      attachments TEXT,
      client_timestamp TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      conflict_server_updated_at TEXT
    );

    CREATE INDEX IF NOT EXISTS outbox_status_idx ON outbox(status);

    CREATE TABLE IF NOT EXISTS sync_meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
  `);
  return _db;
}

export async function getMeta(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM sync_meta WHERE key = ?",
    [key]
  );
  return row?.value ?? null;
}

export async function setMeta(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "INSERT INTO sync_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    [key, value]
  );
}

export async function cachePut(
  entityType: string,
  id: string,
  payload: unknown,
  updatedAt: string
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO cache_entities(entity_type,id,payload,updated_at) VALUES(?,?,?,?)
     ON CONFLICT(entity_type,id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at`,
    [entityType, id, JSON.stringify(payload), updatedAt]
  );
}

export async function cacheList<T = unknown>(entityType: string): Promise<T[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ payload: string }>(
    "SELECT payload FROM cache_entities WHERE entity_type = ? ORDER BY updated_at DESC",
    [entityType]
  );
  return rows.map((r) => JSON.parse(r.payload) as T);
}
