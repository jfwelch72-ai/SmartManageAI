const CACHE_VERSION = 'smartmanageai-v4';
const API_CACHE = 'smartmanageai-api-v3';
const OFFLINE_URL = '/';

const PRECACHE_ASSETS = [
  '/',
];

const API_CACHE_PATTERNS = [
  /\/api\/projects\?/,
  /\/api\/projects\/[^/]+$/,
  /\/api\/projects\/[^/]+\/tasks/,
  /\/api\/projects\/[^/]+\/punch-list/,
  /\/api\/projects\/[^/]+\/change-orders/,
  /\/api\/projects\/[^/]+\/rfis/,
  /\/api\/projects\/[^/]+\/submittals/,
  /\/api\/projects\/[^/]+\/progress-reports/,
  /\/api\/projects\/[^/]+\/time-entries/,
  /\/api\/projects\/[^/]+\/notes/,
  /\/api\/safety-checklists/,
  /\/api\/user$/,
  /\/api\/time-clock\/my-current-shift/,
  /\/api\/time-clock\/my-shifts/,
  /\/api\/field-productivity\/offline-sync\/stats/,
];

const MAX_SYNC_HISTORY_ENTRIES = 100;

const OFFLINE_QUEUE_STORE = 'offline-queue';
const SYNC_HISTORY_STORE = 'sync-history';
const CSRF_TOKEN_STORE = 'csrf-token';
const OFFLINE_DB_NAME = 'smartmanageai-offline';
const OFFLINE_DB_VERSION = 3;
const MAX_RETRIES = 5;
const RETRY_BACKOFF_BASE = 2000;

function openOfflineDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(OFFLINE_QUEUE_STORE)) {
        const store = db.createObjectStore(OFFLINE_QUEUE_STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(SYNC_HISTORY_STORE)) {
        const historyStore = db.createObjectStore(SYNC_HISTORY_STORE, { keyPath: 'id', autoIncrement: true });
        historyStore.createIndex('timestamp', 'timestamp', { unique: false });
      }
      if (!db.objectStoreNames.contains(CSRF_TOKEN_STORE)) {
        db.createObjectStore(CSRF_TOKEN_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storeCsrfToken(token) {
  try {
    const db = await openOfflineDB();
    return new Promise((resolve) => {
      const tx = db.transaction(CSRF_TOKEN_STORE, 'readwrite');
      const store = tx.objectStore(CSRF_TOKEN_STORE);
      store.put({ key: 'csrf', token, updatedAt: Date.now() });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); resolve(); };
    });
  } catch (_e) { /* non-critical */ }
}

async function getStoredCsrfToken() {
  try {
    const db = await openOfflineDB();
    return new Promise((resolve) => {
      const tx = db.transaction(CSRF_TOKEN_STORE, 'readonly');
      const store = tx.objectStore(CSRF_TOKEN_STORE);
      const request = store.get('csrf');
      request.onsuccess = () => resolve(request.result?.token || null);
      request.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
    });
  } catch (_e) { return null; }
}

async function addToOfflineQueue(item) {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_QUEUE_STORE, 'readwrite');
    const store = tx.objectStore(OFFLINE_QUEUE_STORE);
    const request = store.add({
      ...item,
      status: 'pending',
      retryable: true,
      createdAt: Date.now(),
      retryCount: 0,
    });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

async function getPendingAndRetryableItems() {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_QUEUE_STORE, 'readonly');
    const store = tx.objectStore(OFFLINE_QUEUE_STORE);
    const request = store.getAll();
    request.onsuccess = () => {
      const all = request.result;
      const now = Date.now();
      const items = all.filter(item =>
        item.status === 'pending' ||
        (item.status === 'failed' && item.retryable !== false && (item.retryCount || 0) < MAX_RETRIES && (!item.nextRetryAt || item.nextRetryAt <= now))
      );
      resolve(items);
    };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

function isPermanentError(status) {
  return status >= 400 && status < 500 && status !== 403 && status !== 408 && status !== 429;
}

async function updateQueueItem(id, updates) {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_QUEUE_STORE, 'readwrite');
    const store = tx.objectStore(OFFLINE_QUEUE_STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const item = getReq.result;
      if (item) {
        Object.assign(item, updates);
        store.put(item);
      }
      resolve();
    };
    getReq.onerror = () => reject(getReq.error);
    tx.oncomplete = () => db.close();
  });
}

async function addSyncHistoryEntry(entry) {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SYNC_HISTORY_STORE, 'readwrite');
    const store = tx.objectStore(SYNC_HISTORY_STORE);
    store.add(entry);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}

async function fetchWithCsrf(url, options) {
  let csrfToken = null;

  const windowClients = await self.clients.matchAll({ type: 'window' });
  if (windowClients.length > 0) {
    try {
      const response = await new Promise((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = (e) => resolve(e.data);
        setTimeout(() => resolve(null), 2000);
        windowClients[0].postMessage({ type: 'GET_CSRF_TOKEN' }, [channel.port2]);
      });
      if (response && response.csrfToken) {
        csrfToken = response.csrfToken;
        await storeCsrfToken(csrfToken);
      }
    } catch (_e) { /* fallback to stored token */ }
  }

  if (!csrfToken) {
    csrfToken = await getStoredCsrfToken();
  }

  const headers = { ...options.headers };
  if (csrfToken) {
    headers['x-csrf-token'] = csrfToken;
  }
  return fetch(url, { ...options, headers });
}

async function processOfflineQueue() {
  const items = await getPendingAndRetryableItems();
  const results = { synced: 0, failed: 0 };
  const errors = [];
  const startTime = Date.now();

  for (const item of items) {
    try {
      const response = await fetchWithCsrf(item.url, {
        method: item.method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: item.body ? JSON.stringify(item.body) : undefined,
      });

      if (response.ok) {
        await updateQueueItem(item.id, {
          status: 'synced',
          syncedAt: Date.now(),
          errorMessage: undefined,
        });
        results.synced++;
      } else if (response.status === 409) {
        let conflictMessage = 'Conflict: server version is newer (HTTP 409)';
        try {
          const conflictData = await response.json();
          conflictMessage = 'Conflict: ' + (conflictData.error || 'server version is newer');
        } catch (_e) { console.error('Failed to parse conflict response:', _e); }
        await updateQueueItem(item.id, {
          status: 'failed',
          retryable: false,
          errorMessage: conflictMessage,
        });
        results.failed++;
        errors.push('Conflict on ' + item.entityType + ': server has newer data');
      } else if (isPermanentError(response.status)) {
        let errorDetail = 'HTTP ' + response.status;
        try {
          const errorData = await response.json();
          errorDetail = errorData.error || errorDetail;
        } catch (_e) { console.error('Failed to parse error response:', _e); }
        await updateQueueItem(item.id, {
          status: 'failed',
          retryable: false,
          errorMessage: errorDetail + ' — not retryable',
        });
        results.failed++;
        errors.push(errorDetail);
      } else {
        const newRetryCount = (item.retryCount || 0) + 1;
        if (newRetryCount >= MAX_RETRIES) {
          await updateQueueItem(item.id, {
            status: 'failed',
            retryable: false,
            retryCount: newRetryCount,
            errorMessage: 'Max retries (' + MAX_RETRIES + ') exceeded — HTTP ' + response.status,
          });
        } else {
          const backoff = RETRY_BACKOFF_BASE * Math.pow(2, newRetryCount - 1);
          await updateQueueItem(item.id, {
            status: 'failed',
            retryCount: newRetryCount,
            nextRetryAt: Date.now() + backoff,
            errorMessage: 'Retry ' + newRetryCount + '/' + MAX_RETRIES + ' scheduled (HTTP ' + response.status + ')',
          });
        }
        results.failed++;
        errors.push('HTTP ' + response.status + ' — will retry');
      }
    } catch (err) {
      const newRetryCount = (item.retryCount || 0) + 1;
      const errMsg = err.message || String(err);
      if (newRetryCount >= MAX_RETRIES) {
        await updateQueueItem(item.id, {
          status: 'failed',
          retryable: false,
          retryCount: newRetryCount,
          errorMessage: 'Max retries (' + MAX_RETRIES + ') exceeded — ' + errMsg,
        });
      } else {
        const backoff = RETRY_BACKOFF_BASE * Math.pow(2, newRetryCount - 1);
        await updateQueueItem(item.id, {
          status: 'failed',
          retryCount: newRetryCount,
          nextRetryAt: Date.now() + backoff,
          errorMessage: 'Retry ' + newRetryCount + '/' + MAX_RETRIES + ' scheduled — ' + errMsg,
        });
      }
      results.failed++;
      errors.push(errMsg);
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
    await pruneSyncHistory();
  }

  const allClients = await self.clients.matchAll();
  allClients.forEach(client => {
    client.postMessage({ type: 'SYNC_COMPLETE', results });
  });

  return results;
}

async function pruneSyncHistory() {
  try {
    const db = await openOfflineDB();
    return new Promise((resolve) => {
      const tx = db.transaction(SYNC_HISTORY_STORE, 'readwrite');
      const store = tx.objectStore(SYNC_HISTORY_STORE);
      const request = store.getAll();
      request.onsuccess = () => {
        const all = request.result;
        if (all.length > MAX_SYNC_HISTORY_ENTRIES) {
          all.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
          const toDelete = all.slice(MAX_SYNC_HISTORY_ENTRIES);
          for (const entry of toDelete) {
            if (entry.id != null) store.delete(entry.id);
          }
        }
        resolve();
      };
      request.onerror = () => resolve();
      tx.oncomplete = () => db.close();
    });
  } catch (_e) { /* non-critical */ }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    }).then(() => {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_VERSION && name !== API_CACHE)
          .map((name) => caches.delete(name))
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.pathname.startsWith('/ws') || url.pathname.startsWith('/socket')) return;

  const OFFLINE_QUEUE_ALLOWED = [
    /^\/api\/projects\/[^/]+\/notes/,
    /^\/api\/field-productivity\/voice-logs/,
    /^\/api\/field-productivity\/issue-captures/,
    /^\/api\/field-productivity\/offline-sync/,
    /^\/api\/projects\/[^/]+\/time-entries/,
    /^\/api\/projects\/[^/]+\/media/,
    /^\/api\/rfi$/,
    /^\/api\/projects\/[^/]+\/punch-list/,
    /^\/api\/time-clock\/clock-in/,
    /^\/api\/time-clock\/clock-out/,
    /^\/api\/time-clock\/my-shift\/cost-code/,
    /^\/api\/projects\/[^/]+\/progress-reports/,
    /^\/api\/safety-checklists/,
  ];

  const shouldQueueOffline = request.method !== 'GET' &&
    url.pathname.startsWith('/api/') &&
    OFFLINE_QUEUE_ALLOWED.some(pattern => pattern.test(url.pathname));

  if (shouldQueueOffline) {
    event.respondWith(
      fetch(request.clone()).catch(async () => {
        let body;
        try {
          body = await request.clone().json();
        } catch (e) {
          body = null;
        }

        await addToOfflineQueue({
          url: url.pathname + url.search,
          method: request.method,
          body,
          entityType: guessEntityType(url.pathname),
          operationType: request.method === 'POST' ? 'CREATE' : request.method === 'PATCH' ? 'UPDATE' : 'DELETE',
        });

        if ('sync' in self.registration) {
          try {
            await self.registration.sync.register('sync-offline-queue');
          } catch (e) { console.error('Failed to register background sync:', e); }
        }

        return new Response(JSON.stringify({
          offline: true,
          message: 'Request queued for sync when back online',
        }), {
          status: 202,
          headers: { 'Content-Type': 'application/json' },
        });
      })
    );
    return;
  }

  if (request.method !== 'GET') return;

  if (url.pathname.startsWith('/api/')) {
    const shouldCache = API_CACHE_PATTERNS.some(pattern => pattern.test(url.pathname + url.search));
    if (shouldCache) {
      event.respondWith(
        fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(API_CACHE).then((cache) => {
              cache.put(request, clone);
            });
          }
          return response;
        }).catch(() => {
          return caches.match(request).then((cached) => {
            if (cached) return cached;
            return new Response(JSON.stringify({ offline: true, error: 'No cached data available' }), {
              status: 503,
              headers: { 'Content-Type': 'application/json' },
            });
          });
        })
      );
      return;
    }
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then((cache) => {
            cache.put(request, clone);
          });
          return response;
        })
        .catch(() => {
          return caches.match(OFFLINE_URL) || caches.match(request);
        })
    );
    return;
  }

  if (
    url.pathname.match(/\.(js|css|png|jpg|jpeg|svg|gif|ico|woff|woff2|ttf|eot)$/) ||
    url.pathname.startsWith('/assets/')
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) {
          fetch(request).then((response) => {
            if (response.ok) {
              caches.open(CACHE_VERSION).then((cache) => {
                cache.put(request, response);
              });
            }
          }).catch(() => {});
          return cached;
        }

        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then((cache) => {
              cache.put(request, clone);
            });
          }
          return response;
        }).catch(() => {
          return new Response('', { status: 408, statusText: 'Offline' });
        });
      })
    );
    return;
  }
});

function guessEntityType(pathname) {
  if (pathname.includes('voice-log')) return 'VOICE_LOG';
  if (pathname.includes('time-entr')) return 'TIME_ENTRY';
  if (pathname.includes('time-clock') || pathname.includes('clock-in') || pathname.includes('clock-out')) return 'TIME_CLOCK';
  if (pathname.includes('issue')) return 'ISSUE';
  if (pathname.includes('media') || pathname.includes('photo')) return 'PHOTO';
  if (pathname.includes('progress-report')) return 'PROGRESS_REPORT';
  if (pathname.includes('safety-checklist')) return 'SAFETY_CHECKLIST';
  if (pathname.includes('punch-list')) return 'PUNCH_LIST';
  if (pathname.includes('note') || pathname.includes('daily')) return 'NOTE';
  return 'NOTE';
}

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-offline-queue') {
    event.waitUntil(processOfflineQueue());
  }
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'QUEUE_OFFLINE') {
    event.waitUntil(
      addToOfflineQueue(event.data.payload).then((id) => {
        event.ports?.[0]?.postMessage({ success: true, id });
      })
    );
  }

  if (event.data && event.data.type === 'PROCESS_QUEUE') {
    event.waitUntil(processOfflineQueue());
  }

  if (event.data && event.data.type === 'GET_QUEUE') {
    event.waitUntil(
      (async () => {
        const db = await openOfflineDB();
        const tx = db.transaction(OFFLINE_QUEUE_STORE, 'readonly');
        const store = tx.objectStore(OFFLINE_QUEUE_STORE);
        const request = store.getAll();
        return new Promise((resolve) => {
          request.onsuccess = () => {
            event.ports?.[0]?.postMessage({ items: request.result });
            db.close();
            resolve();
          };
        });
      })()
    );
  }

  if (event.data && event.data.type === 'GET_PENDING_COUNT') {
    event.waitUntil(
      (async () => {
        const items = await getPendingAndRetryableItems();
        event.ports?.[0]?.postMessage({ count: items.length });
      })()
    );
  }
});

self.addEventListener('push', (event) => {
  let data = { title: 'SmartManageAI', message: 'You have a new notification.', url: '/' };

  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data.message = event.data.text();
    }
  }

  const options = {
    body: data.message,
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-192x192.png',
    data: { url: data.url || '/' },
    requireInteraction: false,
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === targetUrl && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
