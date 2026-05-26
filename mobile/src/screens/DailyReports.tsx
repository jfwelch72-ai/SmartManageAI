import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Audio } from "expo-av";
import { useNavigation, type NavigationProp } from "@react-navigation/native";

import { SyncStatusBar } from "@/components/SyncStatusBar";
import { useSync } from "@/sync/SyncContext";
import { enqueue } from "@/sync/outbox";
import { cacheList, cachePut, getMeta } from "@/sync/db";
import { api, ApiError } from "@/api/client";
import {
  fetchSiteWeather,
  snapshotFromCurrent,
  snapshotToString,
  type WeatherSiteResponse,
  type WeatherSnapshot,
} from "@/api/weather";
import { colors, spacing } from "@/theme";
import type { CreateTaskPrefill } from "@/screens/CreateTask";


type DailyReportsNavParamList = {
  CreateTask: { prefill: CreateTaskPrefill };
};

type DailyReport = {
  id: string;
  date: string;
  notes?: string;
  attachments?: Array<{ name: string }>;
  status?: string;
};


// Mirror of the server-side AIInsight shape returned by
// GET /api/insights/daily-report/:reportId. Not persisted, so the mobile
// client treats this as a transient per-report payload.
type AIInsight = {
  category:
    | "SUPPLY_NEED"
    | "EQUIPMENT_REPAIR"
    | "WEATHER_DELAY"
    | "CHANGE_ORDER"
    | "SAFETY"
    | "CLIENT_COMMUNICATION"
    | "OTHER";
  summary: string;
  recommendedActions: string[];
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  recipients: string[];
  sourceNoteId: string;
  projectId: string | null;
  sourceType: "PROJECT" | "COMPANY";
};

// Server `id`s are UUIDs. Optimistic local rows use a `photo-…`/timestamp
// prefix and are not addressable on the server, so insights aren't
// requestable for them yet.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isServerId(id: string): boolean {
  return UUID_RE.test(id);
}

type PendingAttachment = {
  localId: string;
  uri: string;
  mime: string;
  name: string;
};

// Task #3107 — pull the primary project's coordinates from the offline
// PROJECT cache. Used to capture a weather snapshot at save time so the
// synced daily report retains defensible field context.
interface ProjectRow {
  id: string;
  name?: string;
  title?: string;
  siteLatitude?: number | null;
  siteLongitude?: number | null;
}

async function captureWeatherSnapshot(): Promise<{
  snapshot: WeatherSnapshot | null;
  projectId: string | null;
}> {
  try {
    const projects = await cacheList<ProjectRow>("PROJECT");
    const primary = projects.find((p) => p.siteLatitude != null && p.siteLongitude != null);
    if (!primary || primary.siteLatitude == null || primary.siteLongitude == null) {
      return { snapshot: null, projectId: projects[0]?.id ?? null };
    }
    // Prefer a fresh fetch but fall back to last-known cached widget data
    // so the offline / airplane-mode case still records *something*.
    try {
      const fresh = await fetchSiteWeather(primary.siteLatitude, primary.siteLongitude);
      if (fresh.current) {
        return { snapshot: snapshotFromCurrent(fresh.current, fresh.source), projectId: primary.id };
      }
    } catch {
      /* fall through to cache */
    }
    const cached = await getMeta("weather.site." + primary.id);
    if (cached) {
      const data = JSON.parse(cached) as WeatherSiteResponse;
      if (data.current) {
        return {
          snapshot: snapshotFromCurrent(data.current, `${data.source} (cached)`),
          projectId: primary.id,
        };
      }
    }
    return { snapshot: null, projectId: primary.id };
  } catch {
    return { snapshot: null, projectId: null };
  }
}

// Module-level cache so re-opening a report doesn't re-bill the LLM for
// insights we've already fetched in this session. The server endpoint is
// not idempotent (each call runs a fresh analysis) so we have to cache
// client-side.
const insightsCache = new Map<string, AIInsight[]>();

function DailyReportInsights({ reportId }: { reportId: string }) {
  const nav = useNavigation<NavigationProp<DailyReportsNavParamList>>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [insights, setInsights] = useState<AIInsight[] | null>(
    insightsCache.get(reportId) ?? null,
  );

  const fetchInsights = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ reportId: string; insights: AIInsight[] }>(
        `/api/insights/daily-report/${encodeURIComponent(reportId)}`
      );
      insightsCache.set(reportId, data.insights);
      setInsights(data.insights);
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? `Couldn't load insights (HTTP ${e.status})`
          : "Couldn't load insights. Check your connection.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [reportId]);

  useEffect(() => {
    if (insights === null && !loading && !error) {
      void fetchInsights();
    }
  }, [insights, loading, error, fetchInsights]);

  function convertToTask(insight: AIInsight) {
    const description = insight.recommendedActions.length
      ? insight.recommendedActions.map((a) => `• ${a}`).join("\n")
      : undefined;
    const priority: NonNullable<CreateTaskPrefill["priority"]> =
      insight.severity === "CRITICAL"
        ? "CRITICAL"
        : insight.severity === "HIGH"
        ? "HIGH"
        : insight.severity === "LOW"
        ? "LOW"
        : "MEDIUM";
    // Hand off to the dedicated Create Task screen so the field user can
    // review / edit prefilled fields before saving. This is the required
    // "Convert to task" affordance — direct POSTs from this view would
    // silently create tasks without confirmation.
    nav.navigate("CreateTask", {
      prefill: {
        title: insight.summary.slice(0, 200),
        description,
        category: insight.category,
        priority,
        projectId: insight.projectId ?? null,
        sourceType: "AI_GENERATED",
        context: `daily_report:${reportId}`,
      },
    });
  }

  return (
    <View style={styles.insightsBox} testID={`insights-${reportId}`}>
      <Text style={styles.insightsHeader}>AI Insights</Text>
      {loading ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing(1) }}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.rowSub}>Analyzing report…</Text>
        </View>
      ) : null}
      {!loading && error ? (
        <View style={{ gap: spacing(1) }}>
          <Text style={[styles.rowSub, { color: colors.danger }]} testID={`insights-error-${reportId}`}>
            {error}
          </Text>
          <Pressable
            onPress={() => void fetchInsights()}
            style={[styles.btn, { backgroundColor: colors.primary }]}
            testID={`button-retry-insights-${reportId}`}
          >
            <Text style={styles.btnText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}
      {!loading && !error && insights && insights.length === 0 ? (
        <Text style={styles.rowSub} testID={`insights-empty-${reportId}`}>
          No action items detected.
        </Text>
      ) : null}
      {!loading && !error && insights && insights.length > 0
        ? insights.map((ins, idx) => (
            <View key={idx} style={styles.insightCard} testID={`insight-${reportId}-${idx}`}>
              <View style={{ flexDirection: "row", gap: spacing(1), flexWrap: "wrap" }}>
                <Badge text={ins.category.replace(/_/g, " ")} color={colors.primary} />
                <Badge text={ins.severity} color={severityColor(ins.severity)} />
              </View>
              <Text style={styles.insightSummary}>{ins.summary}</Text>
              {ins.recommendedActions.length > 0 ? (
                <View style={{ gap: 2 }}>
                  {ins.recommendedActions.map((a, i) => (
                    <Text key={i} style={styles.rowSub}>• {a}</Text>
                  ))}
                </View>
              ) : null}
              <Pressable
                onPress={() => convertToTask(ins)}
                style={[styles.btn, { backgroundColor: colors.success ?? "#16a34a" }]}
                testID={`button-convert-task-${reportId}-${idx}`}
              >
                <Text style={styles.btnText}>Convert to task</Text>
              </Pressable>
            </View>
          ))
        : null}
    </View>
  );
}

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <View style={{ backgroundColor: color, paddingHorizontal: spacing(1), paddingVertical: 2, borderRadius: 4 }}>
      <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>{text}</Text>
    </View>
  );
}

function severityColor(s: AIInsight["severity"]): string {
  switch (s) {
    case "CRITICAL": return "#b91c1c";
    case "HIGH": return "#dc2626";
    case "MEDIUM": return "#ca8a04";
    case "LOW": return colors.textMuted;
  }
}

export function DailyReportsScreen() {
  const { syncNow, lastResult } = useSync();
  const [items, setItems] = useState<DailyReport[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<Audio.Recording | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    void cacheList<DailyReport>("DAILY_REPORT").then(setItems);
  }, [lastResult]);

  async function capturePhoto() {
    const photo = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (photo.canceled) return;
    const a = photo.assets[0];
    setPending((prev) => [
      ...prev,
      {
        localId: `photo-${Date.now()}`,
        uri: a.uri,
        mime: a.mimeType ?? "image/jpeg",
        name: a.fileName ?? `photo-${Date.now()}.jpg`,
      },
    ]);
  }

  // Voice notes — required by the daily reports spec. Recording uses
  // expo-av and produces an .m4a file we attach to the outbox record. The
  // sync coordinator's attachment uploader treats it identically to a photo.
  async function startRecording() {
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) return;
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording: r } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recorderRef.current = r;
      setRecording(true);
    } catch (e) {
      console.warn("[voice] start failed", e);
    }
  }

  async function stopRecording() {
    const r = recorderRef.current;
    recorderRef.current = null;
    setRecording(false);
    if (!r) return;
    try {
      await r.stopAndUnloadAsync();
      const uri = r.getURI();
      if (!uri) return;
      setPending((prev) => [
        ...prev,
        {
          localId: `voice-${Date.now()}`,
          uri,
          mime: "audio/m4a",
          name: `voice-${Date.now()}.m4a`,
        },
      ]);
    } catch (e) {
      console.warn("[voice] stop failed", e);
    }
  }

  async function save() {
    const date = new Date().toISOString().slice(0, 10);
    // Task #3107 — Capture a current-conditions snapshot at save time so
    // the synced daily report retains defensible weather context. The
    // mobile sync envelope persists `weather` as a text column; we send
    // both the structured snapshot (weatherSnapshot) and a human-readable
    // string (weather) so the office web app sees the rendered summary.
    const { snapshot, projectId } = await captureWeatherSnapshot();
    const rec = await enqueue({
      entityType: "DAILY_REPORT",
      operation: "CREATE",
      payload: {
        notes: draft,
        date,
        projectId: projectId ?? undefined,
        weather: snapshot ? snapshotToString(snapshot) : undefined,
        weatherSnapshot: snapshot ?? undefined,
      },
      attachments: pending.length > 0 ? pending : undefined,
    });
    // Optimistic cache write so the new report appears in the list
    // immediately, before push() round-trips to the server. Keyed by the
    // outbox localId; on successful push the server-issued row will replace
    // it on the next pull (same id space won't collide because server ids
    // are UUIDs while localIds are timestamp-prefixed strings).
    await cachePut(
      "DAILY_REPORT",
      rec.localId,
      { id: rec.localId, date, notes: draft, status: "PENDING" },
      new Date().toISOString()
    );
    setItems((prev) => [
      { id: rec.localId, date, notes: draft, status: "PENDING" },
      ...prev.filter((p) => p.id !== rec.localId),
    ]);
    setDraft("");
    setPending([]);
    void syncNow();
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SyncStatusBar />
      <View style={{ padding: spacing(2), gap: spacing(1) }}>
        <TextInput
          placeholder="Today's notes — saves offline"
          placeholderTextColor={colors.textMuted}
          multiline value={draft} onChangeText={setDraft} style={styles.input}
          testID="input-daily-notes"
        />
        <View style={{ flexDirection: "row", gap: spacing(1) }}>
          <Pressable onPress={capturePhoto} style={[styles.btn, { flex: 1 }]} testID="button-add-photo">
            <Text style={styles.btnText}>Photo</Text>
          </Pressable>
          <Pressable
            onPress={recording ? stopRecording : startRecording}
            style={[styles.btn, { flex: 1, backgroundColor: recording ? colors.danger : colors.primary }]}
            testID="button-toggle-voice"
          >
            <Text style={styles.btnText}>{recording ? "Stop voice" : "Voice note"}</Text>
          </Pressable>
        </View>
        {pending.length > 0 ? (
          <Text style={{ color: colors.textMuted, fontSize: 12 }} testID="text-pending-attachments">
            {pending.length} attachment{pending.length === 1 ? "" : "s"} ready
          </Text>
        ) : null}
        <Pressable onPress={save} style={[styles.btn, { backgroundColor: colors.success ?? "#16a34a" }]} testID="button-save-report">
          <Text style={styles.btnText}>Save report</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(1) }}>
        {items.map((it) => {
          const expanded = expandedId === it.id;
          const synced = isServerId(it.id);
          return (
            <View key={it.id} style={styles.row} testID={`row-report-${it.id}`}>
              <Pressable
                onPress={() => setExpandedId(expanded ? null : it.id)}
                testID={`button-toggle-report-${it.id}`}
              >
                <Text style={styles.rowTitle}>{it.date}</Text>
                <Text style={styles.rowSub} numberOfLines={expanded ? undefined : 2}>
                  {it.notes ?? ""}
                </Text>
                <Text style={styles.rowHint}>
                  {synced
                    ? expanded ? "Tap to collapse" : "Tap to view AI insights"
                    : "Syncing — insights available after upload"}
                </Text>
              </Pressable>
              {expanded && synced ? (
                <DailyReportInsights reportId={it.id} />
              ) : null}
            </View>
          );
        })}
        {items.length === 0 ? <Text style={{ color: colors.textMuted }}>No reports yet</Text> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  input: { backgroundColor: colors.surface, color: colors.text, padding: spacing(2), borderRadius: 8, minHeight: 80, textAlignVertical: "top" },
  btn: { backgroundColor: colors.primary, padding: spacing(2), borderRadius: 8, alignItems: "center" },
  btnText: { color: "#fff", fontWeight: "600" },
  row: { backgroundColor: colors.surface, padding: spacing(2), borderRadius: 8, gap: spacing(1) },
  rowTitle: { color: colors.text, fontWeight: "600" },
  rowSub: { color: colors.textMuted, fontSize: 12 },
  rowHint: { color: colors.textMuted, fontSize: 11, marginTop: 4, fontStyle: "italic" },
  insightsBox: { gap: spacing(1), borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing(1), marginTop: spacing(1) },
  insightsHeader: { color: colors.text, fontWeight: "700", fontSize: 14 },
  insightCard: { backgroundColor: colors.background, padding: spacing(1), borderRadius: 6, gap: spacing(1) },
  insightSummary: { color: colors.text, fontSize: 13, fontWeight: "500" },
});
