import * as Network from "expo-network";
import * as FileSystem from "expo-file-system";
import * as Application from "expo-application";
import * as Device from "expo-device";
import { Platform } from "react-native";

import { api, ApiError } from "@/api/client";
import { cachePut, getMeta, setMeta } from "./db";
import {
  attachServerId,
  listRetryable,
  markConflict,
  markFailed,
  markSynced,
  setOutboxServerId,
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

export async function registerDevice(pushToken?: string | null): Promise<string> {
  const deviceId = await getOrCreateDeviceId();
  const body: Record<string, unknown> = {
    deviceId,
    platform: Platform.OS === "ios" ? "IOS" : "ANDROID",
    appVersion: Application.nativeApplicationVersion ?? "0.0.0",
    deviceModel: Device.modelName ?? Device.deviceName ?? "unknown",
  };
  if (pushToken !== undefined) {
    body.pushToken = pushToken;
  }
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
  SUBMITTAL: "submittals",
  SUBMITTAL_REVIEW: "submittalReviews",
  SUBMITTAL_STAMP: "submittalStamps",
  INVENTORY_RECEIPT: "",
  INVENTORY_ISSUE: "",
  INVENTORY_TRANSFER: "",
  MAINT_REQUEST: "",
  TASK_UPDATE: "",
  VOICE_LOG: "",
  SAFETY_INCIDENT: "safetyIncidents",
  TM_TICKET: "",
  MATERIAL_REQUEST: "",
  EQUIPMENT_HOUR_LOG: "",
  MESSAGE: "",
  DELIVERY_RECEIPT: "",
  ISSUE_CAPTURE: "",
  LEAVE_REQUEST: "",
  CHANGE_ORDER_INIT: "",
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
      dailyReports?: CacheableRow[];
      photos?: CacheableRow[];
      punchItems?: CacheableRow[];
      inspections?: CacheableRow[];
      submittals?: CacheableRow[];
      submittalReviews?: CacheableRow[];
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
    ["submittals", "SUBMITTAL"],
    ["submittalReviews", "SUBMITTAL_REVIEW"],
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
    return null;
  } catch (err) {
    return null;
  }
}

export async function push(): Promise<{ pushed: number; conflicts: number }> {
  if (!(await isOnline())) return { pushed: 0, conflicts: 0 };
  const pending = await listRetryable();
  if (pending.length === 0) return { pushed: 0, conflicts: 0 };
  const deviceId = await getOrCreateDeviceId();
  type SyncPayload = OutboxRecord["payload"] & {
    localId: string;
    attachments?: Array<{ localId: string; name: string; mime: string; size: number; objectKey?: string }>;
  };
  const grouped: Record<string, SyncPayload[]> = {};
  for (const rec of pending) {
    const serverField = SERVER_FIELD_BY_ENTITY[rec.entityType];
    if (!serverField) continue;
    const attachments = rec.attachments
      ? await Promise.all(
          rec.attachments.map(async (a) => ({
            localId: a.localId,
            name: a.name,
            mime: a.mime,
            size: a.size ?? 0,
            objectKey: await uploadAttachment(a) ?? undefined,
          }))
        )
      : undefined;
    grouped[serverField] = grouped[serverField] || [];
    grouped[serverField].push({
      localId: rec.localId,
      id: rec.serverId ?? undefined,
      clientTimestamp: rec.clientTimestamp,
      logicalClock: rec.logicalClock,
      attachments,
      ...rec.payload,
    });
  }
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
        reason?: string;
        serverStatus?: string;
      }>;
      for (const item of items) {
        if (item.status === "CONFLICT") {
          const serverIso = item.serverUpdatedAt ?? new Date().toISOString();
          const reason = item.reason ?? (item.serverStatus ? `Office staff already resolved this review (${item.serverStatus})` : undefined);
          await markConflict(item.localId, serverIso, reason);
          conflicts++;
        } else if (
          item.status === "QUEUED" ||
          item.status === "SYNCED" ||
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

const INVENTORY_PATHS: Partial<Record<SyncEntityType, string>> = {
  INVENTORY_RECEIPT: "/api/inventory/receive",
  INVENTORY_ISSUE: "/api/inventory/issue",
  INVENTORY_TRANSFER: "/api/inventory/transfer",
};

export async function pushMessages(): Promise<{ pushed: number; failed: number }> {
  if (!(await isOnline())) return { pushed: 0, failed: 0 };
  const pending = (await listRetryable()).filter((r) => r.entityType === "MESSAGE");
  if (pending.length === 0) return { pushed: 0, failed: 0 };
  let pushed = 0;
  let failed = 0;
  for (const rec of pending) {
    const payload = rec.payload as { conversationId?: string; content?: string };
    const conversationId = payload.conversationId;
    if (!conversationId) {
      for (let i = 0; i < 5; i++) await markFailed(rec.localId, "Missing conversationId");
      failed++;
      continue;
    }
    try {
      let attachmentUrl: string | undefined;
      let attachmentName: string | undefined;
      let attachmentType: string | undefined;
      let attachmentSize: number | undefined;
      const att = rec.attachments?.[0];
      if (att) {
        const info = await FileSystem.getInfoAsync(att.uri);
        if (info.exists) {
          const uploadResult = await FileSystem.uploadAsync(
            `${(await import("@/api/client")).baseUrl}/api/conversations/${conversationId}/upload`,
            att.uri,
            {
              httpMethod: "POST",
              uploadType: FileSystem.FileSystemUploadType.MULTIPART,
              fieldName: "file",
              mimeType: att.mime,
              parameters: {},
              headers: await (async () => {
                const { getAuthToken } = await import("@/api/client");
                const tok = await getAuthToken();
                return tok ? { Cookie: `auth_token=${tok}` } : {};
              })(),
            }
          );
          if (uploadResult.status >= 200 && uploadResult.status < 300) {
            try {
              const parsed = JSON.parse(uploadResult.body);
              attachmentUrl = parsed.url;
              attachmentName = parsed.name ?? att.name;
              attachmentType = parsed.type ?? att.mime;
              attachmentSize = parsed.size ?? att.size;
            } catch {}
          }
        }
      }
      await api(`/api/conversations/${conversationId}/messages`, {
        method: "POST",
        body: JSON.stringify({
          content: payload.content ?? "",
          ...(attachmentUrl ? { attachmentUrl, attachmentName, attachmentType, attachmentSize } : {}),
        }),
      });
      await markSynced(rec.localId);
      pushed++;
    } catch (err) {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 403 && err.status !== 408 && err.status !== 429) {
        for (let i = 0; i < 5; i++) await markFailed(rec.localId, `HTTP ${err.status}`);
        failed++;
      } else {
        await markFailed(rec.localId, String(err));
        failed++;
      }
    }
  }
  return { pushed, failed };
}

export async function pushInventory(): Promise<{ pushed: number; failed: number }> {
  if (!(await isOnline())) return { pushed: 0, failed: 0 };
  const pending = (await listRetryable()).filter((r) => r.entityType in INVENTORY_PATHS);
  if (pending.length === 0) return { pushed: 0, failed: 0 };
  let pushed = 0;
  let failed = 0;
  for (const rec of pending) {
    const path = INVENTORY_PATHS[rec.entityType]!;
    try {
      await api(path, { method: "POST", body: JSON.stringify(rec.payload) });
      await markSynced(rec.localId);
      pushed++;
    } catch (err) {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 403 && err.status !== 408 && err.status !== 429) {
        for (let i = 0; i < 5; i++) await markFailed(rec.localId, `HTTP ${err.status}`);
        failed++;
      } else {
        await markFailed(rec.localId, String(err));
        failed++;
      }
    }
  }
  return { pushed, failed };
}

export async function pushMaintenance(): Promise<{ pushed: number; failed: number }> {
  if (!(await isOnline())) return { pushed: 0, failed: 0 };
  const pending = (await listRetryable()).filter((r) => r.entityType === "MAINT_REQUEST");
  if (pending.length === 0) return { pushed: 0, failed: 0 };
  let pushed = 0;
  let failed = 0;
  for (const rec of pending) {
    const equipmentId = (rec.payload as any)?.equipmentId;
    if (!equipmentId) {
      for (let i = 0; i < 5; i++) await markFailed(rec.localId, "Missing equipmentId");
      failed++;
      continue;
    }
    try {
      const photoObjectKeys: string[] = [];
      for (const a of rec.attachments ?? []) {
        const key = await uploadAttachment(a);
        if (key) photoObjectKeys.push(key);
      }
      const { equipmentId: _e, ...rest } = rec.payload as any;
      await api(`/api/equipment/${encodeURIComponent(equipmentId)}/maintenance-requests`, {
        method: "POST",
        body: JSON.stringify({ ...rest, photoObjectKeys }),
      });
      await markSynced(rec.localId);
      pushed++;
    } catch (err) {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 403 && err.status !== 408 && err.status !== 429) {
        for (let i = 0; i < 5; i++) await markFailed(rec.localId, `HTTP ${err.status}`);
        failed++;
      } else {
        await markFailed(rec.localId, String(err));
        failed++;
      }
    }
  }
  return { pushed, failed };
}

export async function pushTaskUpdates(): Promise<{ pushed: number; failed: number }> {
  if (!(await isOnline())) return { pushed: 0, failed: 0 };
  const pending = (await listRetryable()).filter((r) => r.entityType === "TASK_UPDATE");
  if (pending.length === 0) return { pushed: 0, failed: 0 };
  let pushed = 0;
  let failed = 0;
  for (const rec of pending) {
    const p = rec.payload as any;
    try {
      if (p.kind === "STATUS") {
        await api(`/api/tasks/${p.taskId}`, { method: "PATCH", body: JSON.stringify({ status: p.status, dismissReason: p.dismissReason }) });
      } else if (p.kind === "COMMENT") {
        await api(`/api/tasks/${p.taskId}/comments`, { method: "POST", body: JSON.stringify({ content: p.content }) });
      }
      await markSynced(rec.localId);
      pushed++;
    } catch (err) {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 403 && err.status !== 408 && err.status !== 429) {
        for (let i = 0; i < 5; i++) await markFailed(rec.localId, `HTTP ${err.status}`);
        failed++;
      } else {
        await markFailed(rec.localId, String(err));
        failed++;
      }
    }
  }
  return { pushed, failed };
}

export async function pushEquipmentHours(): Promise<{ pushed: number; failed: number }> {
  if (!(await isOnline())) return { pushed: 0, failed: 0 };
  const pending = (await listRetryable()).filter((r) => r.entityType === "EQUIPMENT_HOUR_LOG");
  if (pending.length === 0) return { pushed: 0, failed: 0 };
  let pushed = 0;
  let failed = 0;
  for (const rec of pending) {
    const p = rec.payload as any;
    try {
      let notes = p.notes ?? "";
      if (rec.attachments?.[0]) {
        const key = await uploadAttachment(rec.attachments[0]);
        if (key) notes = `${notes} [Meter photo: ${key}]`.trim();
      }
      const { equipmentId, ...body } = p;
      await api(`/api/equipment/${encodeURIComponent(equipmentId)}/hour-logs`, {
        method: "POST",
        body: JSON.stringify({ ...body, notes }),
      });
      await markSynced(rec.localId);
      pushed++;
    } catch (err) {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 403 && err.status !== 408 && err.status !== 429) {
        for (let i = 0; i < 5; i++) await markFailed(rec.localId, `HTTP ${err.status}`);
        failed++;
      } else {
        await markFailed(rec.localId, String(err));
        failed++;
      }
    }
  }
  return { pushed, failed };
}

export async function pushTmTickets(): Promise<{ pushed: number; failed: number; conflicts: number }> {
  if (!(await isOnline())) return { pushed: 0, failed: 0, conflicts: 0 };
  const pending = (await listRetryable()).filter((r) => r.entityType === "TM_TICKET");
  if (pending.length === 0) return { pushed: 0, failed: 0, conflicts: 0 };
  let pushed = 0;
  let failed = 0;
  for (const rec of pending) {
    const p = rec.payload as any;
    try {
      const created = await api<{ id: string }>("/api/tm-tickets", { method: "POST", body: JSON.stringify(p.ticket) });
      await api(`/api/tm-tickets/${created.id}/submit`, { method: "POST" });
      if (p.signoff) {
        const key = await uploadAttachment(p.signoff.attachment);
        if (key) await api(`/api/tm-tickets/${created.id}/signoff`, { method: "POST", body: JSON.stringify({ ...p.signoff, objectKey: key }) });
      }
      await markSynced(rec.localId, created.id);
      pushed++;
    } catch (err) {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 403 && err.status !== 408 && err.status !== 429) {
        for (let i = 0; i < 5; i++) await markFailed(rec.localId, `HTTP ${err.status}`);
        failed++;
      } else {
        await markFailed(rec.localId, String(err));
        failed++;
      }
    }
  }
  return { pushed, failed, conflicts: 0 };
}

export async function pushMaterialRequests(): Promise<{ pushed: number; failed: number }> {
  if (!(await isOnline())) return { pushed: 0, failed: 0 };
  const pending = (await listRetryable()).filter((r) => r.entityType === "MATERIAL_REQUEST");
  if (pending.length === 0) return { pushed: 0, failed: 0 };
  let pushed = 0;
  let failed = 0;
  for (const rec of pending) {
    try {
      const created = await api<{ id: string }>("/api/procurement-module/requests", { method: "POST", body: JSON.stringify(rec.payload) });
      await api(`/api/procurement-module/requests/${created.id}/submit`, { method: "POST" });
      await markSynced(rec.localId, created.id);
      pushed++;
    } catch (err) {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 403 && err.status !== 408 && err.status !== 429) {
        for (let i = 0; i < 5; i++) await markFailed(rec.localId, `HTTP ${err.status}`);
        failed++;
      } else {
        await markFailed(rec.localId, String(err));
        failed++;
      }
    }
  }
  return { pushed, failed };
}

export async function pushDeliveryReceipts(): Promise<{ pushed: number; failed: number }> {
  if (!(await isOnline())) return { pushed: 0, failed: 0 };
  const pending = (await listRetryable()).filter((r) => r.entityType === "DELIVERY_RECEIPT");
  if (pending.length === 0) return { pushed: 0, failed: 0 };
  let pushed = 0;
  let failed = 0;
  for (const rec of pending) {
    const p = rec.payload as any;
    try {
      const objectKeys: string[] = [];
      for (const a of rec.attachments ?? []) {
        const key = await uploadAttachment(a);
        if (key) objectKeys.push(key);
      }
      await api(`/api/procurement-module/orders/${p.poId}/receipts`, {
        method: "POST",
        body: JSON.stringify({ ...p, photoObjectKeys: objectKeys }),
      });
      await markSynced(rec.localId);
      pushed++;
    } catch (err) {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 403 && err.status !== 408 && err.status !== 429) {
        for (let i = 0; i < 5; i++) await markFailed(rec.localId, `HTTP ${err.status}`);
        failed++;
      } else {
        await markFailed(rec.localId, String(err));
        failed++;
      }
    }
  }
  return { pushed, failed };
}

export async function pushIssueCaptures(): Promise<{ pushed: number; failed: number }> {
  if (!(await isOnline())) return { pushed: 0, failed: 0 };
  const pending = (await listRetryable()).filter((r) => r.entityType === "ISSUE_CAPTURE");
  if (pending.length === 0) return { pushed: 0, failed: 0 };
  let pushed = 0;
  let failed = 0;
  for (const rec of pending) {
    try {
      const objectKeys: string[] = [];
      for (const a of rec.attachments ?? []) {
        const key = await uploadAttachment(a);
        if (key) objectKeys.push(key);
      }
      const created = await api<{ id: string }>("/api/field-productivity/issue-captures", {
        method: "POST",
        body: JSON.stringify({ ...rec.payload, photoObjectKeys: objectKeys }),
      });
      await markSynced(rec.localId, created?.id);
      pushed++;
    } catch (err) {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 403 && err.status !== 408 && err.status !== 429) {
        for (let i = 0; i < 5; i++) await markFailed(rec.localId, `HTTP ${err.status}`);
        failed++;
      } else {
        await markFailed(rec.localId, String(err));
        failed++;
      }
    }
  }
  return { pushed, failed };
}

export async function pushLeave(): Promise<{ pushed: number; failed: number }> {
  if (!(await isOnline())) return { pushed: 0, failed: 0 };
  const pending = (await listRetryable()).filter((r) => r.entityType === "LEAVE_REQUEST");
  if (pending.length === 0) return { pushed: 0, failed: 0 };
  let pushed = 0;
  let failed = 0;
  let cachedTypes: Array<{ id: string; name: string }> | null = null;
  async function resolveTypeId(payload: Record<string, unknown>): Promise<string | null> {
    const direct = typeof payload.leaveTypeId === "string" ? (payload.leaveTypeId as string) : null;
    if (direct) return direct;
    const coarse = String(payload.leaveType ?? "").toUpperCase();
    if (!cachedTypes) {
      try {
        cachedTypes = await api<Array<{ id: string; name: string }>>("/api/leave/types");
      } catch {
        cachedTypes = [];
      }
    }
    const want = coarse === "PTO" ? "vacation" : coarse === "SICK" ? "sick" : coarse === "UNPAID" ? "unpaid" : coarse === "OTHER" ? "other" : "";
    const match = cachedTypes.find((t) => t.name.toLowerCase().includes(want)) ?? cachedTypes.find((t) => t.name.toLowerCase() === "other") ?? cachedTypes[0];
    return match?.id ?? null;
  }
  for (const rec of pending) {
    const p = rec.payload as Record<string, unknown>;
    try {
      const leaveTypeId = await resolveTypeId(p);
      if (!leaveTypeId) {
        for (let i = 0; i < 5; i++) await markFailed(rec.localId, "Could not resolve leave type");
        failed++;
        continue;
      }
      const reasonParts: string[] = [];
      if (typeof p.partialDayHours === "number" && p.partialDayHours > 0) reasonParts.push(`Partial day: ${p.partialDayHours}h`);
      if (typeof p.reason === "string" && p.reason.trim().length > 0) reasonParts.push(p.reason.trim());
      await api(`/api/leave/requests`, {
        method: "POST",
        body: JSON.stringify({ leaveTypeId, startDate: p.startDate, endDate: p.endDate, reason: reasonParts.join(" — ") || undefined }),
      });
      await markSynced(rec.localId);
      pushed++;
    } catch (err) {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 403 && err.status !== 408 && err.status !== 429) {
        for (let i = 0; i < 5; i++) await markFailed(rec.localId, `HTTP ${err.status}`);
        failed++;
      } else {
        await markFailed(rec.localId, String(err));
        failed++;
      }
    }
  }
  return { pushed, failed };
}

export async function pushVoiceLogs(): Promise<{ pushed: number; failed: number }> {
  if (!(await isOnline())) return { pushed: 0, failed: 0 };
  const pending = (await listRetryable()).filter((r) => r.entityType === "VOICE_LOG");
  if (pending.length === 0) return { pushed: 0, failed: 0 };
  let pushed = 0;
  let failed = 0;
  for (const rec of pending) {
    try {
      let audioObjectKey: string | null = null;
      const audio = rec.attachments?.[0];
      if (audio) audioObjectKey = await uploadAttachment(audio);
      if (!audioObjectKey) {
        await markFailed(rec.localId, "Audio upload failed");
        failed++;
        continue;
      }
      const p = rec.payload as any;
      const created = await api<{ id: string; createdAt?: string; updatedAt?: string }>(
        "/api/field-productivity/voice-logs",
        {
          method: "POST",
          body: JSON.stringify({
            projectId: p.projectId ?? undefined,
            audioUrl: audioObjectKey,
            audioObjectKey,
            duration: p.duration ?? undefined,
            transcription: p.title ? (p.category ? `[${p.category}] ${p.title}` : p.title) : undefined,
            status: "PENDING",
          }),
        }
      );
      await cachePut("VOICE_LOG", created.id, { ...created, projectId: p.projectId ?? null, duration: p.duration ?? null, status: "PENDING", transcription: p.title ?? null, category: p.category ?? null }, created.updatedAt ?? new Date().toISOString());
      await markSynced(rec.localId, created.id);
      pushed++;
    } catch (err) {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 403 && err.status !== 408 && err.status !== 429) {
        for (let i = 0; i < 5; i++) await markFailed(rec.localId, `HTTP ${err.status}`);
        failed++;
      } else {
        await markFailed(rec.localId, String(err));
        failed++;
      }
    }
  }
  return { pushed, failed };
}

export async function pushChangeOrders(): Promise<{ pushed: number; failed: number }> {
  if (!(await isOnline())) return { pushed: 0, failed: 0 };
  const pending = (await listRetryable()).filter((r) => r.entityType === "CHANGE_ORDER_INIT");
  if (pending.length === 0) return { pushed: 0, failed: 0 };
  let pushed = 0;
  let failed = 0;
  for (const rec of pending) {
    const p = rec.payload as any;
    if (!p?.projectId || !p?.title || !p?.description) {
      for (let i = 0; i < 5; i++) await markFailed(rec.localId, "Invalid CHANGE_ORDER_INIT payload");
      failed++;
      continue;
    }
    try {
      const photoObjectKeys: string[] = [];
      for (const a of rec.attachments ?? []) {
        const key = await uploadAttachment(a);
        if (key) photoObjectKeys.push(key);
      }
      const lines: string[] = [];
      if (p.category) lines.push(`Category: ${p.category}`);
      if (p.scheduleImpactDays) lines.push(`Schedule impact: ${p.scheduleImpactDays} day(s)`);
      if (p.sourceOfDirectionName || p.sourceOfDirectionRole) {
        const who = [p.sourceOfDirectionName, p.sourceOfDirectionRole].filter(Boolean).join(" — ");
        if (who) lines.push(`Direction from: ${who}`);
      }
      lines.push("");
      lines.push(p.description);
      const amountStr = p.amount === null || p.amount === undefined || p.amount === "" ? "0" : String(p.amount);
      const body: Record<string, unknown> = { projectId: p.projectId, description: lines.join("\n"), amount: amountStr };
      if (photoObjectKeys.length > 0) {
        body.attachmentsJson = JSON.stringify(photoObjectKeys.map((key) => ({ objectKey: key, source: "mobile-co-init" })));
      }
      const created = await api<{ id: string }>("/api/change-orders", { method: "POST", body: JSON.stringify(body) });
      await markSynced(rec.localId, created.id);
      pushed++;
    } catch (err) {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 403 && err.status !== 408 && err.status !== 429) {
        for (let i = 0; i < 5; i++) await markFailed(rec.localId, `HTTP ${err.status}`);
        failed++;
      } else {
        await markFailed(rec.localId, String(err));
        failed++;
      }
    }
  }
  return { pushed, failed };
}

export async function syncNow(): Promise<SyncStats> {
  const pulled = await pull();
  const pushRes = await push();
  const inv = await pushInventory();
  const maint = await pushMaintenance();
  const tasks = await pushTaskUpdates();
  const eq = await pushEquipmentHours();
  const tm = await pushTmTickets();
  const mr = await pushMaterialRequests();
  const msgs = await pushMessages();
  const deliveries = await pushDeliveryReceipts();
  const iss = await pushIssueCaptures();
  const leave = await pushLeave();
  const voice = await pushVoiceLogs();
  const co = await pushChangeOrders();

  return {
    pulled,
    pushed:
      pushRes.pushed +
      inv.pushed +
      maint.pushed +
      tasks.pushed +
      eq.pushed +
      tm.pushed +
      mr.pushed +
      msgs.pushed +
      deliveries.pushed +
      iss.pushed +
      leave.pushed +
      voice.pushed +
      co.pushed,
    conflicts: pushRes.conflicts + tm.conflicts,
  };
}
