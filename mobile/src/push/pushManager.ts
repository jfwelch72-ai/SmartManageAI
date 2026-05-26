import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import type { NavigationContainerRef } from "@react-navigation/native";

import { registerDevice } from "@/sync/coordinator";
import { registerForPushAsync } from "./registerForPush";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";

/**
 * Categories of incoming push payload `route` strings the app knows how to
 * deep-link into. The backend sets `data.url` (a relative web path such as
 * `/change-orders/abc-123`) and optionally `data.route` (a logical name like
 * `RFI` or `Submittals`) — we accept either and map to a native screen.
 */
const ROUTE_TO_SCREEN: Record<string, { screen: string; params?: Record<string, unknown> }> = {
  "/rfi": { screen: "RFI" },
  "/rfis": { screen: "RFI" },
  "/submittals": { screen: "Submittals" },
  "/inspections": { screen: "Inspections" },
  "/drawings": { screen: "Drawings" },
  "/punch": { screen: "Punch" },
  "/punch-list": { screen: "Punch" },
  "/daily": { screen: "Daily" },
  "/time": { screen: "Time" },
  "/photos": { screen: "Photos" },
  "/inventory": { screen: "Inventory" },
  "/conflicts": { screen: "Conflicts" },
};

/**
 * Query keys that should be invalidated when a notification with the given
 * payload arrives so list screens refresh transparently.
 */
const ROUTE_TO_QUERY_KEYS: Record<string, string[][]> = {
  "/rfi": [["/api/rfis"]],
  "/submittals": [["/api/submittals"]],
  "/inspections": [["/api/inspections"]],
  "/punch": [["/api/punch-list-items"]],
  "/change-orders": [["/api/change-orders"]],
  "/approvals": [["/api/approvals"], ["/api/notifications"]],
};

interface PushPayload {
  url?: string;
  route?: string;
  entityType?: string;
  entityId?: string;
  [k: string]: unknown;
}

function payloadFor(notification: Notifications.Notification | Notifications.NotificationResponse): PushPayload {
  const raw =
    "request" in notification
      ? notification.request.content.data
      : (notification as Notifications.NotificationResponse).notification.request.content.data;
  return (raw ?? {}) as PushPayload;
}

function findRouteMatch(url?: string): { screen: string; params?: Record<string, unknown> } | null {
  if (!url) return null;
  const path = url.split("?")[0]?.toLowerCase() ?? "";
  // Direct prefix matches: /rfi/123 → /rfi entry.
  for (const key of Object.keys(ROUTE_TO_SCREEN)) {
    if (path === key || path.startsWith(`${key}/`)) return ROUTE_TO_SCREEN[key];
  }
  return null;
}

function invalidateForPayload(qc: QueryClient | null, payload: PushPayload): void {
  if (!qc) return;
  // Always nudge the in-app feed so the bell badge updates immediately.
  qc.invalidateQueries({ queryKey: ["/api/notifications"] }).catch(() => undefined);
  qc.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] }).catch(() => undefined);
  const url = payload.url ?? payload.route ?? "";
  if (!url) return;
  const path = url.split("?")[0]?.toLowerCase() ?? "";
  for (const key of Object.keys(ROUTE_TO_QUERY_KEYS)) {
    if (path === key || path.startsWith(`${key}/`)) {
      for (const qk of ROUTE_TO_QUERY_KEYS[key]) {
        qc.invalidateQueries({ queryKey: qk }).catch(() => undefined);
      }
    }
  }
}

function navigateForPayload(
  navRef: NavigationContainerRef<Record<string, object | undefined>> | null,
  payload: PushPayload
): void {
  if (!navRef?.isReady()) return;
  // Explicit screen name wins (e.g. data.route = "Submittals").
  if (typeof payload.route === "string" && payload.route in ROUTE_TO_SCREEN === false) {
    try {
      navRef.navigate(payload.route as never, undefined as never);
      return;
    } catch {
      /* fall through */
    }
  }
  const match = findRouteMatch(payload.url ?? payload.route);
  if (!match) return;
  try {
    navRef.navigate(match.screen as never, (match.params ?? undefined) as never);
  } catch {
    /* navigation may not be mounted yet — ignore */
  }
}

let listenersInstalled = false;
let foregroundSub: Notifications.Subscription | null = null;
let responseSub: Notifications.Subscription | null = null;

/**
 * Install foreground + tap-response handlers exactly once. Safe to call from
 * any component that has a navigation ref and a query client in scope.
 */
export function installNotificationHandlers(
  navRef: NavigationContainerRef<Record<string, object | undefined>>,
  qc: QueryClient
): () => void {
  if (listenersInstalled) {
    // Refresh closures so the latest navRef/qc win after fast-refresh.
    foregroundSub?.remove();
    responseSub?.remove();
  }
  foregroundSub = Notifications.addNotificationReceivedListener((n) => {
    invalidateForPayload(qc, payloadFor(n));
  });
  responseSub = Notifications.addNotificationResponseReceivedListener((r) => {
    const payload = payloadFor(r);
    invalidateForPayload(qc, payload);
    navigateForPayload(navRef, payload);
  });
  // Cold-start: a notification tap that launched the app shows up here.
  Notifications.getLastNotificationResponseAsync()
    .then((resp) => {
      if (resp) {
        const payload = payloadFor(resp);
        invalidateForPayload(qc, payload);
        navigateForPayload(navRef, payload);
      }
    })
    .catch(() => undefined);
  listenersInstalled = true;
  return () => {
    foregroundSub?.remove();
    responseSub?.remove();
    foregroundSub = null;
    responseSub = null;
    listenersInstalled = false;
  };
}

let tokenRefreshSub: Notifications.Subscription | null = null;

/**
 * Acquire an Expo push token (prompts for permission on first call) and
 * register it with the backend for the current user + this device. Idempotent
 * — safe to call on every login and on app foreground.
 *
 * Also wires the `expoPushToken` refresh listener so a rotated token is
 * re-registered without restarting the app.
 */
export async function registerPushForCurrentUser(): Promise<string | null> {
  try {
    const token = await registerForPushAsync();
    // Register the device row even when no token (e.g. simulator, denied
    // permission) so sync still works. The pushToken column just stays
    // null.
    await registerDevice(token ?? undefined);
    if (tokenRefreshSub) {
      tokenRefreshSub.remove();
      tokenRefreshSub = null;
    }
    tokenRefreshSub = Notifications.addPushTokenListener(async (ev) => {
      try {
        await registerDevice(ev.data);
      } catch {
        /* best-effort — retried on next login */
      }
    });
    return token;
  } catch {
    return null;
  }
}

/**
 * Clear the stored push token on the backend so a logged-out device stops
 * receiving notifications addressed to the previous user. Tear down the
 * token-refresh listener so the next login's registration starts clean.
 */
export async function unregisterPushForCurrentUser(): Promise<void> {
  try {
    // Send explicit null so the server clears `mobileDevices.pushToken`.
    // Passing undefined would be omitted from the JSON payload and the
    // server would treat that as "leave existing token in place".
    await registerDevice(null);
  } catch {
    /* network unavailable on logout is fine */
  }
  if (tokenRefreshSub) {
    tokenRefreshSub.remove();
    tokenRefreshSub = null;
  }
}

// Re-export for any caller that wants to compose a query-client-aware
// invalidation from outside the navigation tree.
export function useInvalidatePushQueries() {
  const qc = useQueryClient();
  return (payload: PushPayload) => invalidateForPayload(qc, payload);
}

// Keep Platform reference so dead-code elimination doesn't strip the import
// in environments where the conditional channel setup is hoisted elsewhere.
void Platform;
