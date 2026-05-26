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
  // IMPORTANT: keep `pushToken` in the payload even when it's null so the
  // server actually clears the stored token on logout. JSON.stringify drops
  // `undefined` fields, which the server then treats as "leave alone".
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
  // Task #1599 — submittal cache rows are pulled, never pushed; reviews
  // are also pull-only (the user's open assignments); stamps are pushed
  // under their own server field. All three entries are required so the
  // SyncEntityType ↔ field map is total (TS exhaustiveness).
  SUBMITTAL: "submittals",
  SUBMITTAL_REVIEW: "submittalReviews",
  SUBMITTAL_STAMP: "submittalStamps",
  // Task #2497: routed by pushInventory() to dedicated REST endpoints,
  // not through the unified mobile sync envelope. Empty string keeps the
  // record/field map total for TS exhaustiveness while signalling that
  // push() should skip it (the existing `if (!serverField) continue;`
  // guard treats an empty string as falsy).
  INVENTORY_RECEIPT: "",
  INVENTORY_ISSUE: "",
  INVENTORY_TRANSFER: "",
  // Task #3098: pushed by pushMaintenance() to the dedicated REST endpoint
  // /api/equipment/:equipmentId/maintenance-requests, not via the unified
  // mobile sync envelope. Empty string keeps the entity↔field map total
  // for TS exhaustiveness while the `if (!serverField) continue;` guard in
  // push() skips it.
  MAINT_REQUEST: "",
  // Task #3095: routed by pushTaskUpdates() to /api/tasks/:id and
  // /api/tasks/:id/comments. Same rationale as inventory above — empty
  // string keeps the map total for TS exhaustiveness while signalling
  // push() should skip it.
  TASK_UPDATE: "",
  // Field-reported safety incidents — pushed via the unified mobile sync
  // envelope. Server-side handler maps the lightweight field payload onto
  // the osha_incidents table with sensible defaults.
  SAFETY_INCIDENT: "safetyIncidents",
  // Task #3090: Pushed by pushTmTickets() via dedicated REST endpoints.
  // Empty string keeps the map total for TS exhaustiveness while signalling
  // that push() should skip it.
  TM_TICKET: "",
  // Task #3099: pushed by pushMaterialRequests() to
  // /api/procurement-module/requests. Empty string here keeps the map
  // total for TS exhaustiveness while signalling that push() should skip
  // it.
  MATERIAL_REQUEST: "",
  // Task #3097: drained by pushEquipmentHours() to a per-equipment REST
  // endpoint; not part of the unified mobile sync envelope. Empty
  // string keeps SyncEntityType ↔ field map total for TS exhaustiveness.
  EQUIPMENT_HOUR_LOG: "",
  // Task #3094: routed by pushMessages() to POST /api/conversations/:id/messages,
  // not the unified mobile sync envelope. Empty string keeps the field map
  // total and signals push() to skip these rows.
  MESSAGE: "",
  // Task #3100: drained by pushDeliveryReceipts() to the procurement
  // receipts endpoint. Same rationale as the inventory entries above.
  DELIVERY_RECEIPT: "",
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
      // Task #1599: submittals + the user's open review assignments
      // join the pull-down so the mobile reviewer can stamp offline
      // without typing UUIDs. Both keys are optional (server omits
      // them when the tenant has no submittals / the user is not a
      // reviewer on any open chain).
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
    // Task #1599: pulled submittals + reviews are cached so the mobile
    // stamp screen can resolve `reviewId` from the user's open
    // assignments without manual entry.
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
            size: a.size ?? 0,
            objectKey: await uploadAttachment(a) ?? undefined,
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
      logicalClock: rec.logicalClock,
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
        // Task #1607: SUBMITTAL_STAMP conflict path — when the target
        // review was already resolved by office staff, the server emits
        // CONFLICT with a human-readable `reason` and `serverStatus`
        // (e.g. "APPROVED"). Fall back to current time if the server
        // omitted serverUpdatedAt so the row is still flipped to
        // CONFLICT instead of being silently retried into FAILED.
        reason?: string;
        serverStatus?: string;
      }>;
      for (const item of items) {
        if (item.status === "CONFLICT") {
          const serverIso = item.serverUpdatedAt ?? new Date().toISOString();
          const reason =
            item.reason ??
            (item.serverStatus
              ? `Office staff already resolved this review (${item.serverStatus})`
              : undefined);
          await markConflict(item.localId, serverIso, reason);
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

// Task #2497: drain inventory outbox rows by calling the dedicated REST
// endpoints. Each entity type maps to a single POST. Treat 4xx (other than
// auth/timeouts) as terminal — the server has already validated the
// payload (cross-tenant, insufficient stock, etc.) and a retry will keep
// failing. Mark those SYNCED-with-error to clear them from the queue and
// surface the message via lastError. Network/5xx errors stay PENDING via
// markFailed() so the next syncNow() retries.
const INVENTORY_PATHS: Partial<Record<SyncEntityType, string>> = {
  INVENTORY_RECEIPT: "/api/inventory/receive",
  INVENTORY_ISSUE: "/api/inventory/issue",
  INVENTORY_TRANSFER: "/api/inventory/transfer",
};

// Task #3094: drain queued chat MESSAGE outbox rows.
// Payload shape: { conversationId, content, attachmentUri?, attachmentMime?, attachmentName? }
// If an attachment URI is present we first upload it via the messaging
// multipart endpoint (which returns a conversation-scoped proxy URL the
// /messages handler accepts), then post the message. Like inventory, 4xx
// (except auth/transient) are terminal — bump retry past the cap to drop
// the row instead of retrying forever.
export async function pushMessages(): Promise<{ pushed: number; failed: number }> {
  if (!(await isOnline())) return { pushed: 0, failed: 0 };
  const pending = (await listRetryable()).filter((r) => r.entityType === "MESSAGE");
  if (pending.length === 0) return { pushed: 0, failed: 0 };
  let pushed = 0;
  let failed = 0;
  for (const rec of pending) {
    const payload = rec.payload as {
      conversationId?: string;
      content?: string;
    };
    const conversationId = payload.conversationId;
    if (!conversationId) {
      await markFailed(rec.localId, "Missing conversationId");
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
              const parsed = JSON.parse(uploadResult.body) as {
                url: string; name?: string; type?: string; size?: number;
              };
              attachmentUrl = parsed.url;
              attachmentName = parsed.name ?? att.name;
              attachmentType = parsed.type ?? att.mime;
              attachmentSize = parsed.size ?? att.size;
            } catch {
              // fall through — send text-only
            }
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
      const msg = err instanceof Error ? err.message : String(err);
      if (err instanceof ApiError && err.status >= 400 && err.status < 500
          && err.status !== 401 && err.status !== 403
          && err.status !== 408 && err.status !== 429) {
        await markFailed(rec.localId, `HTTP ${err.status}`.slice(0, 500));
        for (let i = 0; i < 5; i++) await markFailed(rec.localId, `HTTP ${err.status}`);
        failed++;
      } else {
        await markFailed(rec.localId, msg.slice(0, 500));
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
      const msg = err instanceof Error ? err.message : String(err);
      // 4xx validation errors (except 401/403/408/429) are terminal — drop.
      if (err instanceof ApiError && err.status >= 400 && err.status < 500
          && err.status !== 401 && err.status !== 403
          && err.status !== 408 && err.status !== 429) {
        const detail = (() => {
          try { return JSON.stringify(err.body); } catch { return String(err.body); }
        })();
        await markFailed(rec.localId, `HTTP ${err.status}: ${detail}`.slice(0, 500));
        // Bump retry count enough times to exit the retryable window so we
        // don't loop forever on a permanently-bad payload.
        for (let i = 0; i < 5; i++) await markFailed(rec.localId, `HTTP ${err.status}`);
        failed++;
      } else {
        await markFailed(rec.localId, msg.slice(0, 500));
        failed++;
      }
    }
  }
  return { pushed, failed };
}

// Task #3098: drain MAINT_REQUEST outbox rows by uploading any photos and
// POSTing to /api/equipment/:equipmentId/maintenance-requests. Follows the
// same terminal-4xx semantics as pushInventory(): permanent validation
// errors (other than auth / 408 / 429) are recorded with markFailed and
// retried out of the queue, while network/5xx errors stay retryable.
export async function pushMaintenance(): Promise<{ pushed: number; failed: number }> {
  if (!(await isOnline())) return { pushed: 0, failed: 0 };
  const pending = (await listRetryable()).filter((r) => r.entityType === "MAINT_REQUEST");
  if (pending.length === 0) return { pushed: 0, failed: 0 };
  let pushed = 0;
  let failed = 0;
  for (const rec of pending) {
    const equipmentId = (rec.payload as any)?.equipmentId as string | undefined;
    if (!equipmentId) {
      for (let i = 0; i < 5; i++) await markFailed(rec.localId, "Missing equipmentId");
      failed++;
      continue;
    }
    try {
      const photoObjectKeys: string[] = [];
      if (rec.attachments) {
        for (const a of rec.attachments) {
          const key = await uploadAttachment(a);
          if (key) photoObjectKeys.push(key);
        }
      }
      const { equipmentId: _e, ...rest } = rec.payload as Record<string, unknown>;
      await api(`/api/equipment/${encodeURIComponent(equipmentId)}/maintenance-requests`, {
        method: "POST",
        body: JSON.stringify({ ...rest, photoObjectKeys }),
      });
      await markSynced(rec.localId);
      pushed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (err instanceof ApiError && err.status >= 400 && err.status < 500
          && err.status !== 401 && err.status !== 403
          && err.status !== 408 && err.status !== 429) {
        const detail = (() => { try { return JSON.stringify(err.body); } catch { return String(err.body); } })();
        await markFailed(rec.localId, `HTTP ${err.status}: ${detail}`.slice(0, 500));
        for (let i = 0; i < 5; i++) await markFailed(rec.localId, `HTTP ${err.status}`);
        failed++;
      } else {
        await markFailed(rec.localId, msg.slice(0, 500));
        failed++;
      }
    }
  }
  return { pushed, failed };
}

// Task #3095: drain TASK_UPDATE outbox rows. Status updates → PATCH
// /api/tasks/:id; comment creates → POST /api/tasks/:id/comments. Same
// terminal-4xx semantics as pushInventory(): validation failures (bad
// status, missing task, permission denied) are dropped from the queue
// after exhausting retries so a malformed payload doesn't stall sync.
export async function pushTaskUpdates(): Promise<{ pushed: number; failed: number }> {
  if (!(await isOnline())) return { pushed: 0, failed: 0 };
  const pending = (await listRetryable()).filter((r) => r.entityType === "TASK_UPDATE");
  if (pending.length === 0) return { pushed: 0, failed: 0 };
  let pushed = 0;
  let failed = 0;
  for (const rec of pending) {
    const p = rec.payload as {
      kind?: "STATUS" | "COMMENT";
      taskId?: string;
      status?: string;
      dismissReason?: string;
      content?: string;
    };
    if (!p?.taskId || !p?.kind) {
      for (let i = 0; i < 5; i++) await markFailed(rec.localId, "Invalid TASK_UPDATE payload");
      failed++;
      continue;
    }
    try {
      if (p.kind === "STATUS") {
        await api(`/api/tasks/${encodeURIComponent(p.taskId)}`, {
          method: "PATCH",
          body: JSON.stringify({ status: p.status, dismissReason: p.dismissReason }),
        });
      } else {
        await api(`/api/tasks/${encodeURIComponent(p.taskId)}/comments`, {
          method: "POST",
          body: JSON.stringify({ content: p.content }),
        });
      }
      await markSynced(rec.localId);
      pushed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (err instanceof ApiError && err.status >= 400 && err.status < 500
          && err.status !== 401 && err.status !== 403
          && err.status !== 408 && err.status !== 429) {
        const detail = (() => { try { return JSON.stringify(err.body); } catch { return String(err.body); } })();
        await markFailed(rec.localId, `HTTP ${err.status}: ${detail}`.slice(0, 500));
        for (let i = 0; i < 5; i++) await markFailed(rec.localId, `HTTP ${err.status}`);
        failed++;
      } else {
        await markFailed(rec.localId, msg.slice(0, 500));
        failed++;
      }
    }
  }
  return { pushed, failed };
}

// Task #3100: drain DELIVERY_RECEIPT outbox rows. Per-record flow:
//   1. Upload any attached photos (top-level + per-line) via signed PUT.
//   2. POST the resolved payload to
//      /api/procurement-module/orders/:poId/receipts.
// Same terminal-4xx semantics as pushInventory() / pushMaintenance():
// permanent validation errors are recorded and dropped from the retry
// window, network/5xx stays retryable.
export async function pushDeliveryReceipts(): Promise<{ pushed: number; failed: number }> {
  if (!(await isOnline())) return { pushed: 0, failed: 0 };
  const pending = (await listRetryable()).filter((r) => r.entityType === "DELIVERY_RECEIPT");
  if (pending.length === 0) return { pushed: 0, failed: 0 };
  let pushed = 0;
  let failed = 0;
  for (const rec of pending) {
    const poId = (rec.payload as any)?.poId as string | undefined;
    if (!poId) {
      for (let i = 0; i < 5; i++) await markFailed(rec.localId, "Missing poId");
      failed++;
      continue;
    }
    try {
      // Photos live on rec.attachments with a `line:<poItemId>` or
      // `receipt` discriminator stored in attachment.name's prefix so we
      // can route uploaded object keys back to the right line.
      const keyByLocalId = new Map<string, string>();
      if (rec.attachments) {
        for (const a of rec.attachments) {
          const key = await uploadAttachment(a);
          if (key) keyByLocalId.set(a.localId, key);
        }
      }
      const payload = rec.payload as {
        poId: string;
        deliveryNote?: string;
        notes?: string;
        items: Array<{
          poItemId: string;
          quantityReceived: string;
          condition?: "GOOD" | "DAMAGED" | "REJECTED";
          notes?: string;
          photoLocalIds?: string[];
        }>;
        photoLocalIds?: string[];
      };
      const resolveKeys = (ids?: string[]) =>
        (ids ?? []).map((id) => keyByLocalId.get(id)).filter((k): k is string => !!k);
      const body = {
        deliveryNote: payload.deliveryNote ?? null,
        notes: payload.notes ?? null,
        photoObjectKeys: resolveKeys(payload.photoLocalIds),
        items: payload.items.map((it) => ({
          poItemId: it.poItemId,
          quantityReceived: it.quantityReceived,
          condition: it.condition ?? "GOOD",
          notes: it.notes ?? null,
          photoObjectKeys: resolveKeys(it.photoLocalIds),
        })),
      };
      await api(`/api/procurement-module/orders/${encodeURIComponent(poId)}/receipts`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      await markSynced(rec.localId);
      pushed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (err instanceof ApiError && err.status >= 400 && err.status < 500
          && err.status !== 401 && err.status !== 403
          && err.status !== 408 && err.status !== 429) {
        const detail = (() => { try { return JSON.stringify(err.body); } catch { return String(err.body); } })();
        await markFailed(rec.localId, `HTTP ${err.status}: ${detail}`.slice(0, 500));
        for (let i = 0; i < 5; i++) await markFailed(rec.localId, `HTTP ${err.status}`);
        failed++;
      } else {
        await markFailed(rec.localId, msg.slice(0, 500));
        failed++;
      }
    }
  }
  return { pushed, failed };
}

// Task #3090: Drain TM_TICKET outbox rows. Each row maps to a 3-step server
// flow that mirrors what the web app does:
//   1. POST /api/projects/:projectId/tm-tickets   — create the ticket
//   2. POST /api/tm-tickets/:id/submit             — DRAFT → SUBMITTED
//   3. POST /api/tm-tickets/:id/client-signoff     — write the captured PNG
// The signature image is sent inline as a base64 data URL on step 3 (the
// server stores it in clientSignoffSignature, max 500 KB). We persist the
// returned ticket id on the outbox row after step 1 so a retry after a
// partial failure resumes at step 2/3 instead of creating a duplicate.
//
// Payload shape (carried in OutboxRecord.payload):
//   {
//     projectId: string;          // required; URL :projectId
//     workDate?: string;          // YYYY-MM-DD; server defaults to today
//     scopeDescription?: string;  // server defaults to "Work performed"
//     notes?: string;
//     costCode?: string;
//     laborEntries:    Array<{ employeeName, regularHours, rate, ... }>
//     equipmentEntries:Array<{ equipmentType, hours, rate, ... }>
//     materialEntries: Array<{ description, quantity, unit, unitCost, ... }>
//     clientRepresentativeName?: string;
//     signatureDataUrl?: string;  // "data:image/...;base64,..."
//   }
export async function pushTmTickets(): Promise<{ pushed: number; failed: number; conflicts: number }> {
  if (!(await isOnline())) return { pushed: 0, failed: 0, conflicts: 0 };
  const pending = (await listRetryable()).filter((r) => r.entityType === "TM_TICKET");
  if (pending.length === 0) return { pushed: 0, failed: 0, conflicts: 0 };
  let pushed = 0;
  let failed = 0;
  let conflicts = 0;
  for (const rec of pending) {
    const payload = rec.payload as {
      projectId?: string;
      clientRepresentativeName?: string;
      signatureDataUrl?: string;
      [k: string]: unknown;
    };
    const projectId = payload.projectId;
    if (!projectId) {
      await markFailed(rec.localId, "TM_TICKET payload missing projectId");
      for (let i = 0; i < 5; i++) await markFailed(rec.localId, "missing projectId");
      failed++;
      continue;
    }
    // Classify a server response as a "real" conflict (someone else
    // already advanced/locked/signed the ticket) vs. a benign "already in
    // that state" idempotent retry. Conflict messages from server/tmRoutes.ts:
    //   - "Ticket is locked — it has been billed"
    //   - "Client sign-off has already been recorded"
    //   - "Ticket must be in SUBMITTED or APPROVED status"
    // All of these mean the local outbox row can never succeed and the
    // user has to decide what to do — surface in the Conflicts screen.
    const conflictMessage = (err: ApiError): string | null => {
      // Explicit HTTP 409 always wins.
      if (err.status === 409) return readErrorMessage(err) ?? "Server reports a conflict";
      if (err.status === 404) return "Ticket was removed on the server";
      if (err.status === 400) {
        const msg = readErrorMessage(err) ?? "";
        const lower = msg.toLowerCase();
        if (lower.includes("locked")) return msg;
        if (lower.includes("already been recorded")) return msg;
        if (lower.includes("must be in submitted")) return msg;
      }
      return null;
    };

    try {
      // Step 1: create the ticket if we don't already have a server id.
      let ticketId = rec.serverId ?? null;
      if (!ticketId) {
        const { signatureDataUrl: _sig, clientRepresentativeName: _name, projectId: _pid, ...body } =
          payload;
        const created = await api<{ id: string }>(
          `/api/projects/${encodeURIComponent(projectId)}/tm-tickets`,
          { method: "POST", body: JSON.stringify(body) }
        );
        ticketId = created.id;
        await setOutboxServerId(rec.localId, ticketId);
      }
      // Step 2: submit so the ticket leaves DRAFT (client-signoff requires
      // SUBMITTED or APPROVED). Two sub-cases on 400:
      //   - "already submitted or approved" — benign idempotent retry; the
      //     ticket is already past DRAFT (likely from a previous push that
      //     succeeded server-side then died before markSynced). Swallow
      //     and continue to signoff.
      //   - "Ticket is locked — billed" — REAL conflict; office closed it.
      try {
        await api(`/api/tm-tickets/${encodeURIComponent(ticketId)}/submit`, { method: "POST" });
      } catch (err) {
        if (err instanceof ApiError) {
          const reason = conflictMessage(err);
          if (reason) {
            await markConflict(rec.localId, new Date().toISOString(), reason);
            conflicts++;
            continue;
          }
          if (err.status === 400) {
            // benign — already submitted/approved by a previous attempt.
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      }
      // Step 3: write the signature if one was captured. Same conflict-
      // vs-benign classification: "already been recorded" by us-on-retry
      // is benign; "must be in SUBMITTED/APPROVED" means status moved
      // under us → conflict.
      if (payload.signatureDataUrl && payload.clientRepresentativeName) {
        try {
          await api(`/api/tm-tickets/${encodeURIComponent(ticketId)}/client-signoff`, {
            method: "POST",
            body: JSON.stringify({
              clientName: payload.clientRepresentativeName,
              signature: payload.signatureDataUrl,
            }),
          });
        } catch (err) {
          if (err instanceof ApiError) {
            const reason = conflictMessage(err);
            if (reason && !reason.toLowerCase().includes("already been recorded")) {
              await markConflict(rec.localId, new Date().toISOString(), reason);
              conflicts++;
              continue;
            }
            if (err.status === 400) {
              // benign — already recorded by us on a previous attempt.
            } else {
              throw err;
            }
          } else {
            throw err;
          }
        }
      }
      await markSynced(rec.localId, ticketId);
      pushed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (err instanceof ApiError) {
        const reason = conflictMessage(err);
        if (reason) {
          await markConflict(rec.localId, new Date().toISOString(), reason);
          conflicts++;
          continue;
        }
        if (
          err.status >= 400 && err.status < 500 &&
          err.status !== 401 && err.status !== 403 &&
          err.status !== 408 && err.status !== 429
        ) {
          const detail = (() => {
            try { return JSON.stringify(err.body); } catch { return String(err.body); }
          })();
          await markFailed(rec.localId, `HTTP ${err.status}: ${detail}`.slice(0, 500));
          for (let i = 0; i < 5; i++) await markFailed(rec.localId, `HTTP ${err.status}`);
          failed++;
          continue;
        }
      }
      await markFailed(rec.localId, msg.slice(0, 500));
      failed++;
    }
  }
  return { pushed, failed, conflicts };
}

function readErrorMessage(err: ApiError): string | null {
  const body = err.body as unknown;
  if (body && typeof body === "object" && "error" in (body as Record<string, unknown>)) {
    const e = (body as Record<string, unknown>).error;
    if (typeof e === "string") return e;
  }
  return null;
}
// are terminal because the server has already validated the payload
// (cross-tenant, duplicate week per equipment_hour_logs_unique_week,
// etc.) and a retry will keep failing. Network/5xx errors stay
// retryable via markFailed.
export async function pushEquipmentHours(): Promise<{ pushed: number; failed: number }> {
  if (!(await isOnline())) return { pushed: 0, failed: 0 };
  const pending = (await listRetryable()).filter((r) => r.entityType === "EQUIPMENT_HOUR_LOG");
  if (pending.length === 0) return { pushed: 0, failed: 0 };
  let pushed = 0;
  let failed = 0;
  for (const rec of pending) {
    const payload = rec.payload as { equipmentId?: string; notes?: string | null } & Record<string, unknown>;
    const equipmentId = typeof payload.equipmentId === "string" ? payload.equipmentId : null;
    if (!equipmentId) {
      // Malformed record (no equipmentId) — drop it out of the retry
      // window so it stops blocking the queue.
      for (let i = 0; i < 5; i++) await markFailed(rec.localId, "Missing equipmentId");
      failed++;
      continue;
    }
    // Upload the meter photo (if any) first so we can stash the
    // resulting object key in `notes` for the office to find.
    let photoNote = "";
    if (rec.attachments && rec.attachments.length > 0) {
      const att = rec.attachments[0];
      const objectKey = await uploadAttachment(att);
      if (objectKey) photoNote = `\n[Meter photo: ${objectKey}]`;
    }
    const { equipmentId: _ignored, ...body } = payload;
    const mergedNotes = `${typeof body.notes === "string" ? body.notes : ""}${photoNote}`.trim();
    const finalBody = { ...body, notes: mergedNotes.length > 0 ? mergedNotes : null };
    try {
      await api(`/api/equipment/${encodeURIComponent(equipmentId)}/hour-logs`, {
        method: "POST",
        body: JSON.stringify(finalBody),
      });
      await markSynced(rec.localId);
      pushed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (err instanceof ApiError && err.status >= 400 && err.status < 500
          && err.status !== 401 && err.status !== 403
          && err.status !== 408 && err.status !== 429) {
        const detail = (() => { try { return JSON.stringify(err.body); } catch { return String(err.body); } })();
        await markFailed(rec.localId, `HTTP ${err.status}: ${detail}`.slice(0, 500));
        for (let i = 0; i < 5; i++) await markFailed(rec.localId, `HTTP ${err.status}`);
        failed++;
      } else {
        await markFailed(rec.localId, msg.slice(0, 500));
        failed++;
      }
    }
  }
  return { pushed, failed };
}

// Task #3099: drain MATERIAL_REQUEST outbox rows by calling the procurement
// REST endpoints directly: first POST /api/procurement-module/requests with
// the DRAFT payload, then POST /requests/:id/submit so the row lands in
// PENDING_APPROVAL on the office side instead of staying as a DRAFT only
// the submitter can see. Optional photos are uploaded to object storage
// first and the returned objectKey is appended to the notes field as a
// human-readable "Photo: /objects/<key>" reference (the procurement
// schema has no first-class attachment column).
export async function pushMaterialRequests(): Promise<{ pushed: number; failed: number }> {
  if (!(await isOnline())) return { pushed: 0, failed: 0 };
  const pending = (await listRetryable()).filter((r) => r.entityType === "MATERIAL_REQUEST");
  if (pending.length === 0) return { pushed: 0, failed: 0 };
  let pushed = 0;
  let failed = 0;
  for (const rec of pending) {
    try {
      const p = rec.payload as {
        projectId: string;
        title: string;
        neededByDate?: string | null;
        notes?: string | null;
        item: { description: string; quantity?: string | null; unit?: string | null; costCode?: string | null };
      };
      // Two-step create+submit must both succeed before we can mark the
      // record SYNCED. If create already succeeded on a previous attempt
      // we have rec.serverId and skip straight to the submit retry —
      // otherwise a transient submit failure would either strand the
      // request in DRAFT forever (if we marked SYNCED) or create a
      // duplicate on every retry (if we re-POSTed).
      let serverId = rec.serverId ?? null;
      if (!serverId) {
        let notes = p.notes ?? "";
        if (rec.attachments && rec.attachments.length > 0) {
          for (const att of rec.attachments) {
            const key = await uploadAttachment(att);
            if (key) {
              notes = `${notes}${notes ? "\n" : ""}Photo: /objects/${key}`;
            }
          }
        }
        const created = await api<{ id: string; prNumber: string; status: string }>(
          "/api/procurement-module/requests",
          {
            method: "POST",
            body: JSON.stringify({
              projectId: p.projectId,
              title: p.title,
              neededByDate: p.neededByDate ?? null,
              notes: notes || null,
              items: [
                {
                  description: p.item.description,
                  quantity: p.item.quantity ?? null,
                  unit: p.item.unit ?? null,
                  costCode: p.item.costCode ?? null,
                },
              ],
            }),
          }
        );
        serverId = created.id;
        // Persist the server id BEFORE attempting submit so a crash or
        // submit failure does not lose the link to the created DRAFT.
        await attachServerId(rec.localId, serverId);
      }
      // Move from DRAFT → PENDING_APPROVAL so approvers see it. This must
      // succeed before we can call the record done; otherwise it stays
      // FAILED-but-retryable with serverId stored, and the next sync run
      // skips create and re-attempts submit.
      //
      // /submit is non-idempotent: once the row is past DRAFT the server
      // returns 400. If a previous attempt succeeded server-side but the
      // client never got the response, the retry would otherwise be
      // permanently FAILED. Treat 400-not-DRAFT as success by reading
      // back the current status.
      try {
        await api(`/api/procurement-module/requests/${serverId}/submit`, { method: "POST" });
      } catch (submitErr) {
        if (submitErr instanceof ApiError && submitErr.status === 400) {
          const current = await api<{ status?: string }>(
            `/api/procurement-module/requests/${serverId}`
          ).catch(() => null);
          if (current && current.status && current.status !== "DRAFT") {
            // Already submitted (or further along) on a previous attempt.
          } else {
            throw submitErr;
          }
        } else {
          throw submitErr;
        }
      }
      await markSynced(rec.localId, serverId);
      pushed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        err instanceof ApiError &&
        err.status >= 400 &&
        err.status < 500 &&
        err.status !== 401 &&
        err.status !== 403 &&
        err.status !== 408 &&
        err.status !== 429
      ) {
        const detail = (() => {
          try { return JSON.stringify(err.body); } catch { return String(err.body); }
        })();
        await markFailed(rec.localId, `HTTP ${err.status}: ${detail}`.slice(0, 500));
        for (let i = 0; i < 5; i++) await markFailed(rec.localId, `HTTP ${err.status}`);
        failed++;
      } else {
        await markFailed(rec.localId, msg.slice(0, 500));
        failed++;
      }
    }
  }
  return { pushed, failed };
}

export async function syncNow(): Promise<SyncStats> {
  const pulled = await pull();
  const { pushed, conflicts } = await push();
  const inv = await pushInventory();
  const maint = await pushMaintenance();
  const tasks = await pushTaskUpdates();
  const eq = await pushEquipmentHours();
  const tm = await pushTmTickets();
  const mr = await pushMaterialRequests();
  const msgs = await pushMessages();
  const deliveries = await pushDeliveryReceipts();
  return {
    pulled,
    pushed: pushed + inv.pushed + maint.pushed + tasks.pushed + eq.pushed + tm.pushed + mr.pushed + msgs.pushed + deliveries.pushed,
    conflicts: conflicts + tm.conflicts,
  };
}
