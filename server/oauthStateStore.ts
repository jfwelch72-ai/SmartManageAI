import crypto from "crypto";

// In-memory, process-local store for short-lived OAuth state values that
// must survive a cross-site form_post (specifically Apple Sign-In, where the
// browser drops SameSite cookies on the cross-site POST callback).
//
// Properties:
//   - 32-byte random hex state values (256 bits of entropy)
//   - One-time-use: a state value can only be consumed once
//   - TTL of 10 minutes by default (Apple consent screens rarely take longer)
//   - Provider-namespaced so an Apple state can't be used as a Google state
//
// Limitation: this is a single-process map. Across a multi-instance
// deployment the issuing instance must also serve the callback (sticky
// routing), or this needs to move to a shared backend (Postgres / Redis).
// Today the app runs as a single instance behind Replit's deployment, so
// this is acceptable; the follow-up "Keep Apple sign-in working across
// server restarts and multiple servers" tracks moving to shared storage.

interface StateEntry {
  expiresAt: number;
}

const STATE_TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 10_000;
const CLEANUP_INTERVAL_MS = 60 * 1000;

const store = new Map<string, StateEntry>();

function cleanupExpired(): void {
  const now = Date.now();
  store.forEach((entry, key) => {
    if (entry.expiresAt <= now) {
      store.delete(key);
    }
  });
}

setInterval(cleanupExpired, CLEANUP_INTERVAL_MS).unref();

function makeKey(provider: string, state: string): string {
  return `${provider}:${state}`;
}

export function createOAuthState(
  provider: string,
  ttlMs: number = STATE_TTL_MS,
): string {
  if (store.size >= MAX_ENTRIES) {
    cleanupExpired();
    if (store.size >= MAX_ENTRIES) {
      const oldest = store.keys().next().value;
      if (oldest) store.delete(oldest);
    }
  }
  const state = crypto.randomBytes(32).toString("hex");
  store.set(makeKey(provider, state), { expiresAt: Date.now() + ttlMs });
  return state;
}

export function consumeOAuthState(provider: string, state: string): boolean {
  if (!state || typeof state !== "string") return false;
  const key = makeKey(provider, state);
  const entry = store.get(key);
  if (!entry) return false;
  store.delete(key);
  if (entry.expiresAt <= Date.now()) return false;
  return true;
}

export function _testClearOAuthStateStore(): void {
  store.clear();
}

export function _testOAuthStateStoreSize(): number {
  return store.size;
}
