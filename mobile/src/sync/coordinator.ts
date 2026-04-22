import * as Network from "expo-network";
import * as FileSystem from "expo-file-system";
import * as Application from "expo-application";
import * as Device from "expo-device";
import { Platform } from "react-native";

import { api, ApiError } from "@/api/client";
import { cachePut, getMeta, setMeta } from "./db";
import {
  listRetryable,
  markConflict,
  markFailed,
  markSynced,
} from "./outbox";
import type { OutboxRecord, SyncEntityType } from "./types";

const DEVICE_ID_KEY = "deviceId";
const REGISTRATION_ID_KEY = "registrationId";
const LAST_PULL_KEY = "lastPullAt";

export type SyncStats = {
  pulled: number;
  pushed: number;
  conflicts: number;
};

async function getOrCreateDeviceId(): Promise<string> {
  const cached = await getMeta(DEVICE_ID_KEY);
  if (cached) return cached;
  const id =
    (Platform.OS === "android"
      ? Application.getAndroidId()
      : await Application.getIosIdForVendorAsync()) ||
    `${Platform.OS}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await setMeta(DEVICE_ID_KEY, id);
  return id;
}

export async function registerDevice(pushToken?: string): Promise<string> {
  const deviceId = await getOrCreateDeviceId();
  const body = {
    deviceId,
    platform: Platform.OS === "ios" ? "IOS" : "ANDROID",
    appVersion: Application.nativeApplicationVersion ?? "0.0.0",
    deviceModel: Device.modelName ?? Device.deviceName ?? "unknown",
    pushToken,
  };
  const result = await api<{ success: boolean; registrationId: string; syncToken: string }>(
    "/api/ai-features/mobile/register",
    { method: "POST", body: JSON.stringify(body) }
  );
  await setMeta(REGISTRATION_ID_KEY, result.registrationId);
  return result.registrationId;
}

export async function isOnline(): Promise<boolean> {
  try {
    const s = await Network.getNetworkStateAsync();
    return Boolean(s.isConnected && s.isInternetReachable !== false);
  } catch {
    return false;
  }
}

// Maps each mobile entity type to the field name expected by
// POST /api/ai-features/mobile/sync. Server response includes a `processed`
// object keyed by these same fields. Keep this in lockstep with the schema
// declared in server/mobileSyncRoutes.ts.
const SERVER_FIELD_BY_ENTITY: Record<SyncEntityType, string> = {
  HAUL_TICKET: "haulTickets",
  INSPECTOR_REPORT: "dailyInspectorReports",
  SWPPP_INSPECTION: "swpppInspections",
  TIME_CLOCK_EVENT: "timeClockEvents",
  DAILY_REPORT: "dailyReports",
  PHOTO: "photos",
  PUNCH_ITEM: "punchItems",
  RFI: "rfis",
  INSPECTION: "inspections",
  DRAWING_MARKUP: "drawingMarkups",
};

export async function pull(): Promise<number> {
  if (!(await isOnline())) return 0;
  const lastSync = (await getMeta(LAST_PULL_KEY)) ?? new Date(0).toISOString();
  const deviceId = await getOrCreateDeviceId();
  type CacheableRow = { id: string; updatedAt?: string };
  type PullResponse = {
    syncedAt?: string;
    changes?: {
      haulTickets?: CacheableRow[];
      dailyInspectorReports?: CacheableRow[];
      swpppInspections?: CacheableRow[];
      rfis?: CacheableRow[];
      // Task #807: server now ships these as part of the pull-down delta.
      dailyReports?: CacheableRow[];
      photos?: CacheableRow[];
      punchItems?: CacheableRow[];
      inspections?: CacheableRow[];
      projects?: { created?: CacheableRow[]; updated?: CacheableRow[] };
    };
  };
  const res = await api<PullResponse>(
    `/api/ai-features/mobile/sync?lastSyncAt=${encodeURIComponent(lastSync)}&deviceId=${deviceId}`
  );
  let pulled = 0;
  const map: Array<[keyof NonNullable<PullResponse["changes"]>, string]> = [
    ["haulTickets", "HAUL_TICKET"],
    ["dailyInspectorReports", "INSPECTOR_REPORT"],
    ["swpppInspections", "SWPPP_INSPECTION"],
    ["rfis", "RFI"],
    ["dailyReports", "DAILY_REPORT"],
    ["photos", "PHOTO"],
    ["punchItems", "PUNCH_ITEM"],
    ["inspections", "INSPECTION"],
  ];
  for (const [k, entityType] of map) {
    const items = (res.changes?.[k] as CacheableRow[] | undefined) ?? [];
    for (const item of items) {
      await cachePut(entityType, item.id, item, item.updatedAt ?? new Date().toISOString());
      pulled++;
    }
  }
  for (const item of res.changes?.projects?.created ?? []) {
    await cachePut("PROJECT", item.id, item, item.updatedAt ?? new Date().toISOString());
    pulled++;
  }
  for (const item of res.changes?.projects?.updated ?? []) {
    await cachePut("PROJECT", item.id, item, item.updatedAt ?? new Date().toISOString());
    pulled++;
  }
  await setMeta(LAST_PULL_KEY, res.syncedAt ?? new Date().toISOString());
  return pulled;
}

async function uploadAttachment(att: NonNullable<OutboxRecord["attachments"]>[number]): Promise<string | null> {
  try {
    const info = await FileSystem.getInfoAsync(att.uri);
    if (!info.exists) return null;
    // Signed-upload pattern: ask server for an upload URL, then PUT directly
    // to object storage. We use FileSystem.uploadAsync (BINARY_CONTENT) which
    // streams the file from disk via the native HTTP stack — robust on iOS &
    // Android, no base64 round-trip, and supported in Expo background tasks.
    const { uploadUrl, objectKey } = await api<{ uploadUrl: string; objectKey: string }>(
      "/api/objects/upload",
      { method: "POST", body: JSON.stringify({ filename: att.name, contentType: att.mime }) }
    );
    const result = await FileSystem.uploadAsync(uploadUrl, att.uri, {
      httpMethod: "PUT",
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: { "Content-Type": att.mime },
    });
    if (result.status >= 200 && result.status < 300) return objectKey;
    console.warn("[sync] attachment upload non-2xx", result.status, result.body);
    return null;
  } catch (err) {
    console.warn("[sync] attachment upload failed", err);
    return null;
  }
}

export async function push(): Promise<{ pushed: number; conflicts: number }> {
  if (!(await isOnline())) return { pushed: 0, conflicts: 0 };
  // Include FAILED rows under the retry cap. Without this, transient errors
  // would strand records permanently in FAILED status.
  const pending = await listRetryable();
  if (pending.length === 0) return { pushed: 0, conflicts: 0 };

  const deviceId = await getOrCreateDeviceId();

  // Resolve attachment URIs to object keys before sending the record.
  type SyncPayload = OutboxRecord["payload"] & {
    localId: string;
    attachments?: Array<{ localId: string; name: string; mime: string; size: number; objectKey?: string }>;
  };
  const grouped: Record<string, SyncPayload[]> = {};
  const localIdMap = new Map<string, OutboxRecord>();
  for (const rec of pending) {
    const attachments = rec.attachments
      ? await Promise.all(
          rec.attachments.map(async (a) => ({
            localId: a.localId,
            name: a.name,
            mime: a.mime,
            size: a.size,
            objectKey: await uploadAttachment(a),
          }))
        )
      : undefined;
    const serverField = SERVER_FIELD_BY_ENTITY[rec.entityType];
    if (!serverField) continue;
    grouped[serverField] = grouped[serverField] || [];
    grouped[serverField].push({
      localId: rec.localId,
      id: rec.serverId ?? undefined,
      clientTimestamp: rec.clientTimestamp,
      attachments,
      ...rec.payload,
    });
    localIdMap.set(rec.localId, rec);
  }

  // Inner helper so we can transparently re-register and retry once if the
  // server reports DEVICE_NOT_REGISTERED (412). This handles the case where
  // SyncContext bootstrap registration was skipped (offline at boot, perms
  // denied, etc.) so the user's first online sync still succeeds.
  const callSync = async (): Promise<any> =>
    api<any>("/api/ai-features/mobile/sync", {
      method: "POST",
      body: JSON.stringify({ deviceId, changes: grouped }),
    });
  try {
    let res: any;
    try {
      res = await callSync();
    } catch (err) {
      if (err instanceof ApiError && err.status === 412) {
        await registerDevice();
        res = await callSync();
      } else {
        throw err;
      }
    }
    let pushed = 0;
    let conflicts = 0;
    const sections = Object.values(SERVER_FIELD_BY_ENTITY);
    for (const section of sections) {
      const items = (res.processed?.[section] ?? []) as Array<{
        localId: string;
        status: string;
        serverUpdatedAt?: string;
      }>;
      for (const item of items) {
        if (item.status === "CONFLICT" && item.serverUpdatedAt) {
          await markConflict(item.localId, item.serverUpdatedAt);
          conflicts++;
        } else if (
          item.status === "QUEUED" ||
          item.status === "SYNCED" ||
          // Task #807: server now persists DAILY_REPORT/PHOTO/PUNCH_ITEM/
          // INSPECTION/RFI directly into first-class tables and reports
          // SAVED on success or DUPLICATE when an idempotency marker for the
          // same (deviceId, localId, recordType) was already recorded. Both
          // mean the server has fully accepted the record — clear the
          // outbox entry, otherwise the row would stay retryable forever.
          item.status === "SAVED" ||
          item.status === "DUPLICATE"
        ) {
          await markSynced(item.localId);
          pushed++;
        }
      }
    }
    return { pushed, conflicts };
  } catch (err: any) {
    for (const rec of pending) {
      await markFailed(rec.localId, String(err?.message ?? err));
    }
    return { pushed: 0, conflicts: 0 };
  }
}

export async function syncNow(): Promise<SyncStats> {
  const pulled = await pull();
  const { pushed, conflicts } = await push();
  return { pulled, pushed, conflicts };
}
