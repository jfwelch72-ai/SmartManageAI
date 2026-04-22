import { db } from "../db";
import { mobileDevices } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { logError, logInfo } from "../utils/logger";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

interface NativePushPayload {
  title: string;
  message: string;
  url?: string;
  data?: Record<string, unknown>;
}

function isExpoToken(token: string): boolean {
  return token.startsWith("ExponentPushToken[") || token.startsWith("ExpoPushToken[");
}

/**
 * Send a push notification to all native (iOS/Android) devices registered for
 * a user via the SmartManageAI mobile app. Uses Expo's push gateway, which
 * routes to APNs/FCM transparently when device tokens are Expo push tokens.
 *
 * Web push (browser-based) is handled separately by `pushService.sendPushToUser`.
 * This service is additive — both run during `deliverPush` so users with the
 * web PWA and the native app both receive notifications.
 */
export async function sendNativePushToUser(
  userId: string,
  payload: NativePushPayload
): Promise<void> {
  const devices = await db
    .select({ id: mobileDevices.id, pushToken: mobileDevices.pushToken })
    .from(mobileDevices)
    .where(and(eq(mobileDevices.userId, userId), eq(mobileDevices.isActive, true)));

  const expoTokens = devices
    .map((d) => d.pushToken)
    .filter((t): t is string => !!t && isExpoToken(t));

  if (expoTokens.length === 0) return;

  const messages = expoTokens.map((to) => ({
    to,
    sound: "default",
    title: payload.title,
    body: payload.message,
    data: { url: payload.url, ...(payload.data ?? {}) },
    priority: "high" as const,
  }));

  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(messages),
    });
    if (!res.ok) {
      logError("nativePushService: Expo push HTTP failed", {
        userId,
        status: res.status,
        body: await res.text().catch(() => ""),
      });
      return;
    }
    const json = (await res.json().catch(() => null)) as
      | { data?: Array<{ status: string; message?: string; details?: { error?: string } }> }
      | null;
    if (!json?.data) return;

    const stale: string[] = [];
    json.data.forEach((tk, i) => {
      if (tk.status === "error") {
        const errCode = tk.details?.error;
        if (errCode === "DeviceNotRegistered") stale.push(expoTokens[i]);
      }
    });
    if (stale.length > 0) {
      logInfo("nativePushService: clearing stale push tokens", { userId, count: stale.length });
      for (const tok of stale) {
        await db
          .update(mobileDevices)
          .set({ pushToken: null, updatedAt: new Date() })
          .where(eq(mobileDevices.pushToken, tok))
          .catch(() => undefined);
      }
    }
  } catch (err) {
    logError("nativePushService: send failed", { userId, error: String(err) });
  }
}
