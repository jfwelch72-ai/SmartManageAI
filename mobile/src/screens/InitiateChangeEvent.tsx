import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import * as ImagePicker from "expo-image-picker";

import { SyncStatusBar } from "@/components/SyncStatusBar";
import { ApiError } from "@/api/client";
import { enqueue, listOutbox } from "@/sync/outbox";
import { cacheList } from "@/sync/db";
import { isOnline } from "@/sync/coordinator";
import { useSync } from "@/sync/SyncContext";
import { colors, spacing } from "@/theme";
import type { OutboxRecord } from "@/sync/types";

type ProjectRow = { id: string; name?: string; title?: string };

const CATEGORIES = [
  "Owner-directed",
  "Field condition",
  "Design clarification",
  "Other",
] as const;
type Category = (typeof CATEGORIES)[number];

type Attachment = NonNullable<OutboxRecord["attachments"]>[number];

export function InitiateChangeEventScreen() {
  const { syncNow } = useSync();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Category>("Field condition");
  const [description, setDescription] = useState("");
  const [costImpact, setCostImpact] = useState("");
  const [scheduleImpactDays, setScheduleImpactDays] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [sourceRole, setSourceRole] = useState("");
  const [photos, setPhotos] = useState<Attachment[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [recent, setRecent] = useState<OutboxRecord[]>([]);

  const refreshRecent = useCallback(async () => {
    const all = await listOutbox();
    setRecent(
      all.filter((o) => o.entityType === "CHANGE_ORDER_INIT").reverse().slice(0, 30)
    );
  }, []);

  useFocusEffect(useCallback(() => { void refreshRecent(); }, [refreshRecent]));

  useEffect(() => {
    void cacheList<ProjectRow>("PROJECT").then((p) => {
      setProjects(p);
      setProjectId((cur) => cur || p[0]?.id || "");
    });
  }, []);

  async function capturePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { setFeedback("Camera permission denied."); return; }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.6 });
    if (result.canceled) return;
    const a = result.assets[0];
    setPhotos((prev) => [
      ...prev,
      {
        localId: `${Date.now()}-${prev.length}`,
        uri: a.uri,
        mime: a.mimeType ?? "image/jpeg",
        name: a.fileName ?? `co-${Date.now()}.jpg`,
      },
    ]);
  }

  function removePhoto(localId: string) {
    setPhotos((prev) => prev.filter((p) => p.localId !== localId));
  }

  function reset() {
    setTitle("");
    setCategory("Field condition");
    setDescription("");
    setCostImpact("");
    setScheduleImpactDays("");
    setSourceName("");
    setSourceRole("");
    setPhotos([]);
  }

  async function submit() {
    setFeedback(null);
    if (!projectId) { setFeedback("Pick a project."); return; }
    if (!title.trim()) { setFeedback("Add a short title."); return; }
    if (!description.trim()) { setFeedback("Describe what changed and why."); return; }
    if (costImpact.trim() && !Number.isFinite(Number(costImpact))) {
      setFeedback("Cost impact must be a number."); return;
    }
    if (scheduleImpactDays.trim() && !Number.isFinite(Number(scheduleImpactDays))) {
      setFeedback("Schedule impact must be a number of days."); return;
    }

    setSubmitting(true);
    try {
      const rec = await enqueue({
        entityType: "CHANGE_ORDER_INIT",
        operation: "CREATE",
        payload: {
          projectId,
          title: title.trim(),
          category,
          description: description.trim(),
          amount: costImpact.trim() || null,
          scheduleImpactDays: scheduleImpactDays.trim() || null,
          sourceOfDirectionName: sourceName.trim() || null,
          sourceOfDirectionRole: sourceRole.trim() || null,
        },
        attachments: photos.length > 0 ? photos : undefined,
      });
      const online = await isOnline();
      setFeedback(
        online
          ? `Queued ref ${rec.localId.slice(0, 8)} — syncing now…`
          : `Queued offline (ref ${rec.localId.slice(0, 8)}) — will sync when online.`
      );
      reset();
      await refreshRecent();
      void syncNow().then(() => void refreshRecent());
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `Could not queue (HTTP ${err.status}).`
          : err instanceof Error
          ? err.message
          : "Could not queue.";
      setFeedback(msg);
    } finally {
      setSubmitting(false);
    }
  }

  const recentRows = useMemo(
    () =>
      recent.map((r) => {
        const p = r.payload as { title?: string; category?: string };
        return {
          key: r.localId,
          title: p.title ?? "(untitled)",
          category: p.category ?? "",
          status: r.status,
          ref: r.serverId ? r.serverId.slice(0, 8) : r.localId.slice(0, 8),
          when: r.clientTimestamp,
          error: r.lastError ?? null,
        };
      }),
    [recent]
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SyncStatusBar />
      <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(2) }}>
        <Text style={styles.h1}>Initiate change event</Text>
        <Text style={styles.muted}>
          Kick off a change order from the field. The office gets a draft they can price — pricing and approvals are handled on the web.
        </Text>

        <Text style={styles.label}>Project</Text>
        <View style={styles.chipRow}>
          {projects.length === 0 ? (
            <Text style={styles.muted}>No projects cached. Sync to load projects.</Text>
          ) : (
            projects.map((p) => (
              <Pressable
                key={p.id}
                onPress={() => setProjectId(p.id)}
                style={[styles.chip, projectId === p.id && styles.chipActive]}
                testID={`chip-project-${p.id}`}
              >
                <Text style={[styles.chipText, projectId === p.id && styles.chipTextActive]}>
                  {p.name ?? p.title ?? p.id.slice(0, 8)}
                </Text>
              </Pressable>
            ))
          )}
        </View>

        <Text style={styles.label}>Title</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="e.g. Unforeseen rock at footing G-5"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          testID="input-title"
        />

        <Text style={styles.label}>Category</Text>
        <View style={styles.chipRow}>
          {CATEGORIES.map((c) => (
            <Pressable
              key={c}
              onPress={() => setCategory(c)}
              style={[styles.chip, category === c && styles.chipActive]}
              testID={`chip-category-${c.replace(/\s+/g, "-").toLowerCase()}`}
            >
              <Text style={[styles.chipText, category === c && styles.chipTextActive]}>{c}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Description</Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          multiline
          placeholder="What changed? Who said what? What did you have to do?"
          placeholderTextColor={colors.textMuted}
          style={[styles.input, { minHeight: 96 }]}
          testID="input-description"
        />

        <View style={styles.row2}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Cost impact ($, optional)</Text>
            <TextInput
              value={costImpact}
              onChangeText={setCostImpact}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              testID="input-cost-impact"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Schedule impact (days, optional)</Text>
            <TextInput
              value={scheduleImpactDays}
              onChangeText={setScheduleImpactDays}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              testID="input-schedule-impact"
            />
          </View>
        </View>

        <Text style={styles.label}>Source of direction</Text>
        <View style={styles.row2}>
          <TextInput
            value={sourceName}
            onChangeText={setSourceName}
            placeholder="Name"
            placeholderTextColor={colors.textMuted}
            style={[styles.input, { flex: 1 }]}
            testID="input-source-name"
          />
          <TextInput
            value={sourceRole}
            onChangeText={setSourceRole}
            placeholder="Role (e.g. Owner rep, Architect)"
            placeholderTextColor={colors.textMuted}
            style={[styles.input, { flex: 1 }]}
            testID="input-source-role"
          />
        </View>

        <Text style={styles.label}>Photos (optional)</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing(1), alignItems: "center" }}>
          <Pressable
            onPress={() => void capturePhoto()}
            style={[styles.btn, styles.btnSecondary]}
            testID="button-photo"
          >
            <Text style={styles.btnText}>Take photo</Text>
          </Pressable>
          {photos.map((p) => (
            <Pressable
              key={p.localId}
              onPress={() => removePhoto(p.localId)}
              testID={`thumb-${p.localId}`}
            >
              <Image source={{ uri: p.uri }} style={styles.thumb} />
            </Pressable>
          ))}
        </View>
        {photos.length > 0 ? (
          <Text style={styles.muted}>Tap a photo to remove it.</Text>
        ) : null}

        {feedback ? (
          <Text style={styles.feedback} testID="text-feedback">{feedback}</Text>
        ) : null}

        <Pressable
          onPress={() => void submit()}
          disabled={submitting}
          style={[styles.btn, submitting && { opacity: 0.6 }]}
          testID="button-submit"
        >
          <Text style={styles.btnText}>{submitting ? "Saving…" : "Send change event"}</Text>
        </Pressable>

        <Text style={[styles.h2, { marginTop: spacing(2) }]}>Recent drafts</Text>
        {recentRows.length === 0 ? (
          <Text style={styles.muted}>Change events you initiate will show here.</Text>
        ) : (
          recentRows.map((row) => (
            <View key={row.key} style={styles.row} testID={`row-co-${row.key}`}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{row.title}</Text>
                <Text style={styles.rowSub}>
                  {row.ref}
                  {row.category ? ` · ${row.category}` : ""}
                  {row.when ? ` · ${new Date(row.when).toLocaleString()}` : ""}
                </Text>
                {row.error ? <Text style={styles.errText}>{row.error}</Text> : null}
              </View>
              <View style={[styles.pill, { backgroundColor: pillColor(row.status) }]}>
                <Text style={styles.pillText}>{pillLabel(row.status)}</Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function pillColor(status: string): string {
  if (status === "SYNCED") return colors.success;
  if (status === "FAILED" || status === "CONFLICT") return colors.danger;
  if (status === "SYNCING") return colors.primary;
  return colors.warn;
}

function pillLabel(status: string): string {
  if (status === "SYNCED") return "Draft created";
  if (status === "FAILED") return "Failed";
  if (status === "CONFLICT") return "Conflict";
  if (status === "SYNCING") return "Syncing";
  return "Pending";
}

const styles = StyleSheet.create({
  h1: { color: colors.text, fontSize: 22, fontWeight: "700" },
  h2: { color: colors.text, fontSize: 16, fontWeight: "600" },
  muted: { color: colors.textMuted },
  label: { color: colors.text, fontWeight: "600", marginTop: spacing(1) },
  input: { backgroundColor: colors.surface, color: colors.text, padding: spacing(2), borderRadius: 8 },
  row2: { flexDirection: "row", gap: spacing(2) },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing(1) },
  chip: { backgroundColor: colors.surface, paddingHorizontal: spacing(2), paddingVertical: spacing(1), borderRadius: 16 },
  chipActive: { backgroundColor: colors.primary },
  chipText: { color: colors.text },
  chipTextActive: { color: "#fff", fontWeight: "600" },
  btn: { backgroundColor: colors.primary, padding: spacing(2), borderRadius: 8, alignItems: "center", marginTop: spacing(1) },
  btnSecondary: { backgroundColor: colors.surface, marginTop: 0 },
  btnText: { color: "#fff", fontWeight: "600" },
  thumb: { width: 56, height: 56, borderRadius: 6, backgroundColor: colors.surface },
  feedback: { color: colors.text, backgroundColor: colors.surface, padding: spacing(2), borderRadius: 8 },
  row: {
    backgroundColor: colors.surface,
    padding: spacing(2),
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(2),
  },
  rowTitle: { color: colors.text, fontWeight: "600" },
  rowSub: { color: colors.textMuted, fontSize: 12 },
  errText: { color: colors.danger, fontSize: 12, marginTop: 2 },
  pill: { paddingHorizontal: spacing(1), paddingVertical: 4, borderRadius: 999 },
  pillText: { color: "#fff", fontSize: 11, fontWeight: "700" },
});
