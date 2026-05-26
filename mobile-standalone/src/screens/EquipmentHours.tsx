import React, { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";

import { api, ApiError } from "@/api/client";
import { SyncStatusBar } from "@/components/SyncStatusBar";
import { useSync } from "@/sync/SyncContext";
import { enqueue, listOutbox } from "@/sync/outbox";
import { cacheList, cachePut } from "@/sync/db";
import { isOnline } from "@/sync/coordinator";
import { colors, spacing } from "@/theme";

type ProjectRow = { id: string; name?: string; title?: string };

type EquipmentRow = {
  id: string;
  name?: string;
  equipmentCode?: string | null;
  type?: string | null;
  currentHours?: string | null;
  status?: string | null;
  updatedAt?: string;
};

type DraftRow = {
  localId: string;
  equipmentLabel: string;
  endingHours: string;
  status: string;
  lastError?: string | null;
};

// Returns YYYY-MM-DD for the Monday-anchored week containing `d`. The
// server endpoint stores hour logs per (equipment, weekStartDate) with a
// unique constraint, so two same-week submissions for the same machine
// collide. Mobile entries are daily — we collapse to per-day weeks by
// using today for both start and end. That keeps the constraint working
// (one row per machine per day) without breaking the office's weekly
// rollups, which still group by weekStartDate.
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function EquipmentHoursScreen() {
  const { syncNow, lastResult } = useSync();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [equipment, setEquipment] = useState<EquipmentRow[]>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [equipmentId, setEquipmentId] = useState<string>("");
  const [reading, setReading] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [photo, setPhoto] = useState<{ uri: string; mime: string; name: string } | null>(null);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Equipment list — refresh from the server when online (uses the
  // existing /api/equipment list endpoint), otherwise read the last
  // known list from the SQLite cache so the screen still works at the
  // jobsite with no signal.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cached = await cacheList<EquipmentRow>("EQUIPMENT");
      if (!cancelled && cached.length > 0) setEquipment(cached);
      if (await isOnline()) {
        try {
          const fresh = await api<EquipmentRow[]>("/api/equipment");
          if (!cancelled) {
            setEquipment(fresh);
            const now = new Date().toISOString();
            for (const item of fresh) {
              await cachePut("EQUIPMENT", item.id, item, item.updatedAt ?? now);
            }
          }
        } catch {
          /* offline / forbidden — fall back to cache */
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    void cacheList<ProjectRow>("PROJECT").then(setProjects);
  }, [lastResult]);

  async function refreshDrafts() {
    const all = await listOutbox();
    setDrafts(
      all
        .filter((o) => o.entityType === "EQUIPMENT_HOUR_LOG")
        .map((o) => {
          const p = (o.payload ?? {}) as { equipmentId?: string; endingHours?: string };
          const label =
            equipment.find((e) => e.id === p.equipmentId)?.name ?? p.equipmentId ?? "Equipment";
          return {
            localId: o.localId,
            equipmentLabel: label,
            endingHours: String(p.endingHours ?? ""),
            status: o.status,
            lastError: o.lastError ?? null,
          };
        })
        .reverse()
    );
  }
  useEffect(() => { void refreshDrafts(); }, [lastResult, equipment]);

  const selectedEquipment = useMemo(
    () => equipment.find((e) => e.id === equipmentId) ?? null,
    [equipment, equipmentId]
  );
  const previousHours = useMemo(() => {
    const raw = selectedEquipment?.currentHours;
    if (raw == null) return null;
    const n = parseFloat(String(raw));
    return Number.isFinite(n) ? n : null;
  }, [selectedEquipment]);

  async function capturePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return;
    const photoRes = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (photoRes.canceled) return;
    const a = photoRes.assets[0];
    setPhoto({
      uri: a.uri,
      mime: a.mimeType ?? "image/jpeg",
      name: a.fileName ?? `meter-${Date.now()}.jpg`,
    });
  }

  async function actuallySubmit() {
    const reading_n = parseFloat(reading);
    const startingHours = previousHours != null ? previousHours.toFixed(1) : reading_n.toFixed(1);
    const endingHours = reading_n.toFixed(1);
    const date = todayIso();
    const attachments = photo
      ? [{ localId: `meter-${Date.now()}`, uri: photo.uri, mime: photo.mime, name: photo.name }]
      : undefined;
    const rec = await enqueue({
      entityType: "EQUIPMENT_HOUR_LOG",
      operation: "CREATE",
      payload: {
        equipmentId,
        projectId,
        weekStartDate: date,
        weekEndDate: date,
        startingHours,
        endingHours,
        notes: notes.trim() || null,
      },
      attachments,
    });
    setReading("");
    setNotes("");
    setPhoto(null);
    setFeedback(`Queued reading ${endingHours}h — syncing…`);
    await refreshDrafts();
    void syncNow();
    return rec;
  }

  async function submit() {
    if (submitting) return;
    if (!projectId) {
      setFeedback("Choose a project first.");
      return;
    }
    if (!equipmentId) {
      setFeedback("Choose a piece of equipment.");
      return;
    }
    const reading_n = parseFloat(reading);
    if (!Number.isFinite(reading_n) || reading_n < 0) {
      setFeedback("Enter a valid meter reading.");
      return;
    }
    // Validation-only: warn (don't block) when the new reading is lower
    // than the last known reading. Operators sometimes reset meters or
    // swap engines, so we let them confirm and still save.
    if (previousHours != null && reading_n < previousHours) {
      Alert.alert(
        "Reading below previous",
        `Previous: ${previousHours.toFixed(1)}h\nNew: ${reading_n.toFixed(1)}h\n\nSave anyway?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Save anyway",
            style: "destructive",
            onPress: () => {
              setSubmitting(true);
              void actuallySubmit().finally(() => setSubmitting(false));
            },
          },
        ]
      );
      return;
    }
    setSubmitting(true);
    try {
      await actuallySubmit();
    } catch (err) {
      const msg = err instanceof ApiError ? `HTTP ${err.status}` : err instanceof Error ? err.message : "Failed";
      setFeedback(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SyncStatusBar />
      <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(2) }}>
        <Text style={styles.section}>Project</Text>
        <View style={styles.chipRow}>
          {projects.length === 0 ? (
            <Text style={{ color: colors.textMuted }}>No projects cached yet. Sync first.</Text>
          ) : (
            projects.map((p) => {
              const active = p.id === projectId;
              return (
                <Pressable
                  key={p.id}
                  onPress={() => setProjectId(p.id)}
                  style={[styles.chip, active && styles.chipActive]}
                  testID={`chip-project-${p.id}`}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {p.name ?? p.title ?? p.id}
                  </Text>
                </Pressable>
              );
            })
          )}
        </View>

        <Text style={styles.section}>Equipment</Text>
        <View style={styles.chipRow}>
          {equipment.length === 0 ? (
            <Text style={{ color: colors.textMuted }}>No equipment cached yet. Connect once to load the list.</Text>
          ) : (
            equipment.map((e) => {
              const active = e.id === equipmentId;
              const label = e.equipmentCode ? `${e.equipmentCode} — ${e.name ?? ""}` : e.name ?? e.id;
              return (
                <Pressable
                  key={e.id}
                  onPress={() => setEquipmentId(e.id)}
                  style={[styles.chip, active && styles.chipActive]}
                  testID={`chip-equipment-${e.id}`}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
                </Pressable>
              );
            })
          )}
        </View>

        {selectedEquipment ? (
          <Text style={{ color: colors.textMuted }} testID="text-previous-hours">
            Previous reading: {previousHours != null ? `${previousHours.toFixed(1)} h` : "—"}
          </Text>
        ) : null}

        <Text style={styles.section}>Today's meter reading</Text>
        <TextInput
          value={reading}
          onChangeText={setReading}
          keyboardType="decimal-pad"
          placeholder="e.g. 1284.5"
          placeholderTextColor={colors.textMuted}
          style={styles.bigInput}
          testID="input-meter-reading"
        />

        <Text style={styles.section}>Notes (optional)</Text>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          multiline
          placeholder="Idle hours, issues observed, etc."
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          testID="input-meter-notes"
        />

        <Pressable onPress={capturePhoto} style={styles.btn} testID="button-meter-photo">
          <Text style={styles.btnText}>{photo ? "Replace meter photo" : "Photo of meter"}</Text>
        </Pressable>
        {photo ? (
          <Text style={{ color: colors.textMuted, fontSize: 12 }} testID="text-photo-attached">
            Photo attached: {photo.name}
          </Text>
        ) : null}

        <Pressable
          onPress={submit}
          disabled={submitting}
          style={[styles.btn, { backgroundColor: colors.success ?? "#16a34a" }]}
          testID="button-submit-hours"
        >
          <Text style={styles.btnText}>{submitting ? "Saving…" : "Log hours"}</Text>
        </Pressable>

        {feedback ? (
          <Text style={{ color: colors.textMuted }} testID="text-meter-feedback">{feedback}</Text>
        ) : null}

        {drafts.length > 0 ? <Text style={styles.section}>Pending sync</Text> : null}
        {drafts.map((d) => (
          <View key={d.localId} style={styles.row} testID={`row-hours-draft-${d.localId}`}>
            <Text style={styles.rowTitle}>{d.equipmentLabel} — {d.endingHours} h</Text>
            <Text style={styles.rowSub}>{d.status}{d.lastError ? ` · ${d.lastError}` : ""}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { color: colors.textMuted, fontSize: 12, fontWeight: "600", textTransform: "uppercase" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing(1) },
  chip: { backgroundColor: colors.surface, paddingVertical: spacing(1), paddingHorizontal: spacing(2), borderRadius: 999, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.text, fontWeight: "500" },
  chipTextActive: { color: "#fff" },
  input: { backgroundColor: colors.surface, color: colors.text, padding: spacing(2), borderRadius: 8, minHeight: 60, textAlignVertical: "top" },
  bigInput: { backgroundColor: colors.surface, color: colors.text, padding: spacing(2), borderRadius: 8, fontSize: 32, fontWeight: "700", textAlign: "center" },
  btn: { backgroundColor: colors.primary, padding: spacing(2), borderRadius: 8, alignItems: "center" },
  btnText: { color: "#fff", fontWeight: "600" },
  row: { backgroundColor: colors.surface, padding: spacing(2), borderRadius: 8 },
  rowTitle: { color: colors.text, fontWeight: "600" },
  rowSub: { color: colors.textMuted, fontSize: 12 },
});
