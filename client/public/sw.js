const CACHE_VERSION = 'smartmanageai-v2';
const API_CACHE = 'smartmanageai-api-v1';
const OFFLINE_URL = '/';

const PRECACHE_ASSETS = [
  '/',
];

const API_CACHE_PATTERNS = [
  /\/api\/projects\?/,
  /\/api\/projects\/[^/]+$/,
  /\/api\/user$/,
  /\/api\/field-productivity\/offline-sync\/stats/,
];

const OFFLINE_QUEUE_STORE = 'offline-queue';
const SYNC_HISTORY_STORE = 'sync-history';
const OFFLINE_DB_NAME = 'smartmanageai-offline';
const OFFLINE_DB_VERSION = 2;

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
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function addToOfflineQueue(item) {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_QUEUE_STORE, 'readwrite');
    const store = tx.objectStore(OFFLINE_QUEUE_STORE);
    const request = store.add({
      ...item,
      status: 'pending',
      createdAt: Date.now(),
      retryCount: 0,
    });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

async function getOfflineQueue() {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_QUEUE_STORE, 'readonly');
    const store = tx.objectStore(OFFLINE_QUEUE_STORE);
    const index = store.index('status');
    const request = index.getAll('pending');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

async function updateQueueItemStatus(id, status, error) {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_QUEUE_STORE, 'readwrite');
    const store = tx.objectStore(OFFLINE_QUEUE_STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const item = getReq.result;
      if (item) {
        item.status = status;
        if (error) item.errorMessage = error;
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

async function processOfflineQueue() {
  const items = await getOfflineQueue();
  const results = { synced: 0, failed: 0 };

  for (const item of items) {
    try {
      const response = await fetch(item.url, {
        method: item.method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: item.body ? JSON.stringify(item.body) : undefined,
      });

      if (response.ok) {
        await updateQueueItemStatus(item.id, 'synced');
        results.synced++;
      } else {
        await updateQueueItemStatus(item.id, 'failed', `HTTP ${response.status}`);
        results.failed++;
      }
    } catch (err) {
      await updateQueueItemStatus(item.id, 'failed', err.message);
      results.failed++;
    }
  }

  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({ type: 'SYNC_COMPLETE', results });
  });

  return results;
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
          } catch (e) {}
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
  if (pathname.includes('issue')) return 'ISSUE';
  if (pathname.includes('media') || pathname.includes('photo')) return 'PHOTO';
  if (pathname.includes('note') || pathname.includes('daily')) return 'NOTE';
  return 'NOTE';
}

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-offline-queue') {
    event.waitUntil(
      self.clients.matchAll().then(async (clients) => {
        if (clients.length > 0) {
          clients.forEach(client => {
            client.postMessage({ type: 'TRIGGER_SYNC' });
          });
        } else {
          await processOfflineQueue();
        }
      })
    );
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
});

// Web Push: handle incoming push notifications
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

// Web Push: handle notification click — open or focus the app
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
