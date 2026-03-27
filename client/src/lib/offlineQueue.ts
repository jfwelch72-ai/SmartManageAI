const DB_NAME = 'smartmanageai-offline';
const DB_VERSION = 2;
const QUEUE_STORE = 'offline-queue';
const SYNC_HISTORY_STORE = 'sync-history';
const MAX_RETRIES = 5;
const RETRY_BACKOFF_BASE = 2000;

export interface OfflineQueueItem {
  id?: number;
  url: string;
  method: string;
  body: Record<string, unknown> | null;
  entityType: string;
  operationType: string;
  status: 'pending' | 'synced' | 'failed';
  retryable: boolean;
  createdAt: number;
  syncedAt?: number;
  errorMessage?: string;
  retryCount: number;
  nextRetryAt?: number;
}

export interface SyncHistoryEntry {
  id?: number;
  timestamp: number;
  itemsSynced: number;
  itemsFailed: number;
  duration: number;
  errors: string[];
}

let isSyncing = false;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        const store = db.createObjectStore(QUEUE_STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(SYNC_HISTORY_STORE)) {
        const historyStore = db.createObjectStore(SYNC_HISTORY_STORE, { keyPath: 'id', autoIncrement: true });
        historyStore.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function addToQueue(item: Omit<OfflineQueueItem, 'id' | 'status' | 'createdAt' | 'retryCount' | 'retryable'>): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, 'readwrite');
    const store = tx.objectStore(QUEUE_STORE);
    const request = store.add({
      ...item,
      status: 'pending',
      retryable: true,
      createdAt: Date.now(),
      retryCount: 0,
    });
    request.onsuccess = () => resolve(request.result as number);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

export async function getQueueItems(statusFilter?: string): Promise<OfflineQueueItem[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, 'readonly');
    const store = tx.objectStore(QUEUE_STORE);
    let request: IDBRequest;
    if (statusFilter) {
      const index = store.index('status');
      request = index.getAll(statusFilter);
    } else {
      request = store.getAll();
    }
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

export async function getPendingCount(): Promise<number> {
  const pending = await getQueueItems('pending');
  const retryable = await getRetryableFailedItems();
  return pending.length + retryable.length;
}

async function getRetryableFailedItems(): Promise<OfflineQueueItem[]> {
  const failed = await getQueueItems('failed');
  const now = Date.now();
  return failed.filter(item =>
    item.retryable === true &&
    item.retryCount < MAX_RETRIES &&
    (!item.nextRetryAt || item.nextRetryAt <= now)
  );
}

export async function clearSyncedItems(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, 'readwrite');
    const store = tx.objectStore(QUEUE_STORE);
    const index = store.index('status');
    const request = index.openCursor('synced');
    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest).result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}

export async function processQueue(): Promise<{ synced: number; failed: number }> {
  if (isSyncing) return { synced: 0, failed: 0 };
  isSyncing = true;

  try {
    const startTime = Date.now();
    const pendingItems = await getQueueItems('pending');
    const retryableItems = await getRetryableFailedItems();
    const items = [...pendingItems, ...retryableItems];
    const results = { synced: 0, failed: 0 };
    const errors: string[] = [];

    for (const item of items) {
      try {
        const response = await fetch(item.url, {
          method: item.method,
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: item.body ? JSON.stringify(item.body) : undefined,
        });

        if (response.ok) {
          await updateItemStatus(item.id!, 'synced');
          results.synced++;
        } else if (response.status === 409) {
          let conflictMessage = 'Conflict: server version is newer (HTTP 409)';
          try {
            const conflictData = await response.json();
            conflictMessage = `Conflict: ${conflictData.error || 'server version is newer'}`;
          } catch (_e) { /* ignore parse error */ }
          await markAsNonRetryable(item.id!, conflictMessage);
          results.failed++;
          errors.push(`Conflict on ${item.entityType}: server has newer data`);
        } else if (response.status >= 400 && response.status < 500) {
          await markAsNonRetryable(item.id!, `HTTP ${response.status} - not retryable`);
          results.failed++;
          errors.push(`HTTP ${response.status}`);
        } else {
          await markForRetry(item);
          results.failed++;
          errors.push(`HTTP ${response.status} - will retry`);
        }
      } catch (err: unknown) {
        await markForRetry(item);
        results.failed++;
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }

    if (items.length > 0) {
      await addSyncHistoryEntry({
        timestamp: Date.now(),
        itemsSynced: results.synced,
        itemsFailed: results.failed,
        duration: Date.now() - startTime,
        errors,
      });
    }

    return results;
  } finally {
    isSyncing = false;
  }
}

async function markAsNonRetryable(id: number, errorMessage: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, 'readwrite');
    const store = tx.objectStore(QUEUE_STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const existing = getReq.result;
      if (existing) {
        existing.status = 'failed';
        existing.retryable = false;
        existing.errorMessage = errorMessage;
        store.put(existing);
      }
      resolve();
    };
    getReq.onerror = () => reject(getReq.error);
    tx.oncomplete = () => db.close();
  });
}

async function markForRetry(item: OfflineQueueItem): Promise<void> {
  const newRetryCount = (item.retryCount || 0) + 1;
  if (newRetryCount >= MAX_RETRIES) {
    await markAsNonRetryable(item.id!, `Max retries (${MAX_RETRIES}) exceeded`);
    return;
  }
  const backoff = RETRY_BACKOFF_BASE * Math.pow(2, newRetryCount - 1);
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, 'readwrite');
    const store = tx.objectStore(QUEUE_STORE);
    const getReq = store.get(item.id!);
    getReq.onsuccess = () => {
      const existing = getReq.result;
      if (existing) {
        existing.retryCount = newRetryCount;
        existing.nextRetryAt = Date.now() + backoff;
        existing.status = 'failed';
        existing.errorMessage = `Retry ${newRetryCount}/${MAX_RETRIES} scheduled`;
        store.put(existing);
      }
      resolve();
    };
    getReq.onerror = () => reject(getReq.error);
    tx.oncomplete = () => db.close();
  });
}

async function updateItemStatus(id: number, status: string, errorMessage?: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, 'readwrite');
    const store = tx.objectStore(QUEUE_STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const item = getReq.result;
      if (item) {
        item.status = status;
        if (errorMessage) item.errorMessage = errorMessage;
        if (status === 'synced') item.syncedAt = Date.now();
        if (status === 'failed') item.retryCount = (item.retryCount || 0) + 1;
        store.put(item);
      }
      resolve();
    };
    getReq.onerror = () => reject(getReq.error);
    tx.oncomplete = () => db.close();
  });
}

async function addSyncHistoryEntry(entry: Omit<SyncHistoryEntry, 'id'>): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SYNC_HISTORY_STORE, 'readwrite');
    const store = tx.objectStore(SYNC_HISTORY_STORE);
    store.add(entry);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}

export async function getSyncHistory(limit = 20): Promise<SyncHistoryEntry[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SYNC_HISTORY_STORE, 'readonly');
    const store = tx.objectStore(SYNC_HISTORY_STORE);
    const request = store.getAll();
    request.onsuccess = () => {
      const items = request.result as SyncHistoryEntry[];
      items.sort((a, b) => b.timestamp - a.timestamp);
      resolve(items.slice(0, limit));
    };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

export async function deleteQueueItem(id: number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, 'readwrite');
    const store = tx.objectStore(QUEUE_STORE);
    store.delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}

export async function retryFailedItem(id: number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, 'readwrite');
    const store = tx.objectStore(QUEUE_STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const item = getReq.result;
      if (item) {
        item.status = 'pending';
        item.retryCount = 0;
        item.nextRetryAt = undefined;
        item.errorMessage = undefined;
        store.put(item);
      }
      resolve();
    };
    getReq.onerror = () => reject(getReq.error);
    tx.oncomplete = () => db.close();
  });
}

export async function queueOfflineRequest(
  url: string,
  method: string,
  body: any,
  entityType: string,
): Promise<number> {
  const operationType = method === 'POST' ? 'CREATE' : method === 'PATCH' ? 'UPDATE' : 'DELETE';
  const id = await addToQueue({ url, method, body, entityType, operationType });

  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    try {
      const registration = await navigator.serviceWorker.ready;
      const reg = registration as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } };
      if (reg.sync) {
        await reg.sync.register('sync-offline-queue');
      }
    } catch (e) {
      console.warn('Background sync registration failed:', e);
    }
  }

  return id;
}
