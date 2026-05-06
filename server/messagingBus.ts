import { randomUUID } from "crypto";
import { Client } from "pg";
import { pool } from "./db";
import { logError, logInfo, logWarn } from "./utils/logger";

/**
 * Cross-replica fan-out for unified messaging WebSocket/SSE rooms.
 *
 * Under autoscale (N>1 pods) the per-process maps in `messagingEvents.ts`
 * only know about clients connected to the local pod. Two users in the
 * same conversation, balanced to two different pods, would never see
 * each other's events without a shared bus.
 *
 * We use Postgres LISTEN/NOTIFY because it is already available to every
 * pod (same DATABASE_URL), needs no new infra, and matches the lightweight
 * pub/sub idiom referenced in `docs/runbooks/autoscale-verification.md`.
 *
 * Design:
 *   - Each pod gets a unique `podId` at boot so it can ignore its own
 *     echoes (it already delivered locally before publishing).
 *   - Outgoing events are published with `pg_notify($1, $2)` from the
 *     shared pool. The payload is JSON of an `MessagingBusEnvelope`.
 *   - A long-lived dedicated `pg.Client` LISTENs on `MESSAGING_CHANNEL`
 *     and dispatches notifications to a single registered handler
 *     (wired by `messagingEvents.ts`). The dedicated client must NOT be
 *     a pool client because pooled clients are released back to the
 *     pool and would lose the LISTEN subscription.
 *   - On connection error we exponentially back off and reconnect; tests
 *     and dev environments without DATABASE_URL skip wiring entirely.
 *
 * Payload size: Postgres limits NOTIFY payloads to ~7800 bytes. Chat
 * messages comfortably fit, but we guard with a serialize+length check
 * and log+drop oversized envelopes (the originating pod still delivered
 * locally, so only cross-pod recipients miss the event — at worst they
 * reconnect via the existing SSE flow and re-fetch).
 */

export const MESSAGING_CHANNEL = "messaging_events";

const MAX_NOTIFY_PAYLOAD_BYTES = 7800;
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 30_000;

export const PEER_POD_ID: string = randomUUID();

export type MessagingBusEvent =
  | "message_new"
  | "message_edited"
  | "message_deleted"
  | "message_reaction"
  | "user_typing"
  | "call_started"
  | "call_joined"
  | "call_left"
  | "call_ended";

export interface MessagingBusEnvelope {
  v: 1;
  podId: string;
  event: MessagingBusEvent;
  orgId: string;
  conversationId: string;
  participantUserIds: string[];
  /**
   * Per-event payload. Shape mirrors the second arg the SSE client
   * receives (e.g. `{ message }`, `{ messageId, reactions }`,
   * `{ userId, firstName, lastName }`, `{ call }`, …). Kept opaque
   * here so the bus stays event-agnostic.
   */
  payload: Record<string, unknown>;
}

type Handler = (env: MessagingBusEnvelope) => void;

let handler: Handler | null = null;
let listenClient: Client | null = null;
let stopped = false;
let reconnectAttempt = 0;
let reconnectTimer: NodeJS.Timeout | null = null;

export function setMessagingBusHandler(fn: Handler): void {
  handler = fn;
}

/**
 * Publish an envelope to every subscribing pod. The originating pod
 * receives its own NOTIFY back and ignores it via the `podId` check.
 *
 * Best-effort: failures are logged and swallowed so a transient DB
 * blip never breaks local delivery (which has already happened by the
 * time we publish).
 */
export async function publishMessagingEvent(
  event: MessagingBusEvent,
  orgId: string,
  conversationId: string,
  participantUserIds: Iterable<string>,
  payload: Record<string, unknown>,
): Promise<void> {
  if (stopped) return;
  const envelope: MessagingBusEnvelope = {
    v: 1,
    podId: PEER_POD_ID,
    event,
    orgId,
    conversationId,
    participantUserIds: Array.from(participantUserIds),
    payload,
  };
  let serialized: string;
  try {
    serialized = JSON.stringify(envelope);
  } catch (err) {
    logWarn("messagingBus: failed to serialize envelope", {
      event,
      conversationId,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_NOTIFY_PAYLOAD_BYTES) {
    logWarn("messagingBus: dropping oversized envelope (cross-pod only)", {
      event,
      conversationId,
      bytes: Buffer.byteLength(serialized, "utf8"),
    });
    return;
  }
  try {
    await pool.query("SELECT pg_notify($1, $2)", [MESSAGING_CHANNEL, serialized]);
  } catch (err) {
    logWarn("messagingBus: pg_notify failed", {
      event,
      conversationId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function scheduleReconnect(): void {
  if (stopped || reconnectTimer) return;
  const delay = Math.min(
    RECONNECT_MAX_MS,
    RECONNECT_BASE_MS * 2 ** Math.min(reconnectAttempt, 6),
  );
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startMessagingBus().catch((err) => {
      logError(
        "messagingBus: reconnect attempt failed",
        {},
        err instanceof Error ? err : new Error(String(err)),
      );
      scheduleReconnect();
    });
  }, delay);
  reconnectTimer.unref?.();
}

/**
 * Open the dedicated LISTEN connection. Idempotent: callers (boot,
 * reconnect) can invoke repeatedly; only the first wins until the
 * client errors.
 *
 * In test environments (NODE_ENV=test) we skip wiring so unit tests
 * don't hold an open DB connection or produce reconnect log noise.
 */
export async function startMessagingBus(): Promise<void> {
  if (stopped) return;
  if (listenClient) return;
  if (process.env.NODE_ENV === "test" && process.env.MESSAGING_BUS_FORCE !== "1") {
    return;
  }
  if (!process.env.DATABASE_URL) return;

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  client.on("error", (err) => {
    logWarn("messagingBus: LISTEN client error, will reconnect", {
      error: err instanceof Error ? err.message : String(err),
    });
    listenClient = null;
    try {
      void client.end();
    } catch {
      // ignore
    }
    scheduleReconnect();
  });
  client.on("notification", (msg) => {
    if (msg.channel !== MESSAGING_CHANNEL || !msg.payload) return;
    let env: MessagingBusEnvelope;
    try {
      env = JSON.parse(msg.payload) as MessagingBusEnvelope;
    } catch (err) {
      logWarn("messagingBus: failed to parse notification payload", {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    if (env.v !== 1 || env.podId === PEER_POD_ID) return;
    if (!handler) return;
    try {
      handler(env);
    } catch (err) {
      logError(
        "messagingBus: handler threw",
        { event: env.event },
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  });

  try {
    await client.connect();
    await client.query(`LISTEN ${MESSAGING_CHANNEL}`);
  } catch (err) {
    // Mirror the runtime error path: log, ensure the half-open client
    // is torn down, and schedule a backoff retry so a transient DB
    // hiccup at boot doesn't leave the bus permanently disabled.
    logWarn("messagingBus: initial LISTEN connect failed, will reconnect", {
      error: err instanceof Error ? err.message : String(err),
    });
    try {
      void client.end();
    } catch {
      // ignore
    }
    scheduleReconnect();
    return;
  }
  listenClient = client;
  reconnectAttempt = 0;
  logInfo("messagingBus: LISTEN active", { podId: PEER_POD_ID });
}

/**
 * Stop the bus (test cleanup / graceful shutdown). Idempotent.
 */
export async function stopMessagingBus(): Promise<void> {
  stopped = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  const client = listenClient;
  listenClient = null;
  if (client) {
    try {
      await client.query(`UNLISTEN ${MESSAGING_CHANNEL}`);
    } catch {
      // ignore
    }
    try {
      await client.end();
    } catch {
      // ignore
    }
  }
}

/** Test-only reset: clears stopped flag and handler so tests can re-init. */
export function __resetMessagingBusForTests(): void {
  stopped = false;
  handler = null;
  reconnectAttempt = 0;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}
