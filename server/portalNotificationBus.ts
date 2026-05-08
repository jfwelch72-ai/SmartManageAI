/**
 * Cross-replica portal notification fan-out via Postgres LISTEN/NOTIFY.
 *
 * When a portal notification is created on pod A, pod A delivers it locally
 * via emitPortalNotification(). It also pg_notify's the PORTAL_NOTIFICATION_CHANNEL
 * so pods B, C, … (which may have the recipient's SSE connection) can deliver
 * the same event without a database re-query.
 *
 * Design mirrors messagingBus.ts: one dedicated pg.Client per pod for LISTEN;
 * originating pod ignores its own echo via PEER_POD_ID comparison.
 */

import { Client } from "pg";
import { pool } from "./db";
import { logError, logInfo, logWarn } from "./utils/logger";
import { emitPortalNotification } from "./portalChatEvents";
import { PEER_POD_ID } from "./messagingBus";

export const PORTAL_NOTIFICATION_CHANNEL = "portal_notification_events";
const MAX_NOTIFY_BYTES = 7800;
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 30_000;

interface PortalNotificationEnvelope {
  v: 1;
  podId: string;
  type: "client" | "sub" | "vendor";
  identifier: string;
  payload: Record<string, unknown>;
}

let listenClient: Client | null = null;
let stopped = false;
let reconnectAttempt = 0;
let reconnectTimer: NodeJS.Timeout | null = null;

function scheduleReconnect(): void {
  if (stopped || reconnectTimer) return;
  const delay = Math.min(
    RECONNECT_BASE_MS * Math.pow(2, reconnectAttempt),
    RECONNECT_MAX_MS,
  );
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void startListening();
  }, delay);
}

async function startListening(): Promise<void> {
  if (stopped || !process.env.DATABASE_URL) return;
  try {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query(`LISTEN "${PORTAL_NOTIFICATION_CHANNEL}"`);
    listenClient = client;
    reconnectAttempt = 0;

    client.on("notification", (msg) => {
      if (!msg.payload) return;
      let env: PortalNotificationEnvelope;
      try {
        env = JSON.parse(msg.payload) as PortalNotificationEnvelope;
      } catch {
        return;
      }
      if (env.podId === PEER_POD_ID) return;
      emitPortalNotification(env.type, env.identifier, env.payload);
    });

    client.on("error", (err) => {
      logWarn("portalNotificationBus: listener client error", { error: String(err) });
      void client.end().catch(() => {});
      listenClient = null;
      scheduleReconnect();
    });

    client.on("end", () => {
      if (!stopped) {
        listenClient = null;
        scheduleReconnect();
      }
    });

    logInfo("portalNotificationBus: LISTEN started");
  } catch (err) {
    logError("portalNotificationBus: failed to start LISTEN", { error: String(err) });
    scheduleReconnect();
  }
}

export function initPortalNotificationBus(): void {
  if (stopped) stopped = false;
  void startListening();
}

export function stopPortalNotificationBus(): void {
  stopped = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (listenClient) {
    void listenClient.end().catch(() => {});
    listenClient = null;
  }
}

export async function publishPortalNotificationEvent(
  type: "client" | "sub" | "vendor",
  identifier: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const envelope: PortalNotificationEnvelope = {
    v: 1,
    podId: PEER_POD_ID,
    type,
    identifier,
    payload,
  };
  let serialized: string;
  try {
    serialized = JSON.stringify(envelope);
  } catch {
    return;
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_NOTIFY_BYTES) {
    logWarn("portalNotificationBus: dropping oversized envelope");
    return;
  }
  try {
    await pool.query(`SELECT pg_notify($1, $2)`, [PORTAL_NOTIFICATION_CHANNEL, serialized]);
  } catch (err) {
    logWarn("portalNotificationBus: pg_notify failed", { error: String(err) });
  }
}
