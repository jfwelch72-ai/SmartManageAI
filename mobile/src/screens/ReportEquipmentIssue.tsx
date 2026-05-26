import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";

import { SyncStatusBar } from "@/components/SyncStatusBar";
import { useSync } from "@/sync/SyncContext";
import { enqueue } from "@/sync/outbox";
import { cacheList } from "@/sync/db";
import { api } from "@/api/client";
import { isOnline } from "@/sync/coordinator";
import { colors, spacing } from "@/theme";

type EquipmentRow = {
  id: string;
  name?: string;
  equipmentCode?: string;
  type?: string;
  status?: string;
};

type ProjectRow = { id: string; name?: string; title?: string };

type Severity = "DOWN" | "LIMITED" | "COSMETIC";

type RecentRequest = {
  id?: string;
  localId?: string;
  repairNumber?: string;
  description?: string;
  status: string;
  equipmentName?: string;
  equipmentCode?: string;
  problemReportedAt?: string;
};

type PendingAttachment = {
  localId: string;
  uri: string;
  mime: string;
  name: string;
};

const SEVERITY_OPTIONS: Array<{ value: Severity; label: string; hint: string }> = [
  { value: "DOWN", label: "Down", hint: "Cannot operate" },
  { value: "LIMITED", label: "Limited", hint: "Usable, reduced" },
  { value: "COSMETIC", label: "Cosmetic", hint: "Damage only" },
];

const ISSUE_TYPES = [
  "Hydraulic leak",
  "Engine / starting",
  "Electrical",
  "Tires / tracks",
  "Brakes",
  "Attachment / hitch",
  "Operator station",
  "Other",
];

export function ReportEquipmentIssueScreen() {
  const { syncNow, lastResult } = useSync();
  const [equipment, setEquipment] = useState<EquipmentRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [equipmentId, setEquipmentId] = useState<string>("");
  const [projectId, setProjectId] = useState<string>("");
  const [severity, setSeverity] = useState<Severity>("DOWN");
  const [issueType, setIssueType] = useState<string>(ISSUE_TYPES[0]);
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<PendingAttachment[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentRequest[]>([]);

  // Equipment list: fresh online, fall back to cached PROJECT-like list if
  // a previous pull cached EQUIPMENT rows. The unified mobile sync envelope
  // does not yet ship equipment, so the online path is primary; offline we
  // present an empty picker with a hint rather than blocking the user.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (await isOnline()) {
        try {
          const list = await api<EquipmentRow[] | { data: EquipmentRow[] }>("/api/equipment/mobile-list");
          const rows = Array.isArray(list) ? list : list.data ?? [];
          if (!cancelled) setEquipment(rows);
          return;
        } catch {
          /* ignore - leave list empty */
        }
      }
      if (!cancelled) {
        const cached = await cacheList<EquipmentRow>("EQUIPMENT" as any);
        if (!cancelled) setEquipment(cached);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    void cacheList<ProjectRow>("PROJECT").then(setProjects);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (await isOnline()) {
          const list = await api<RecentRequest[]>("/api/equipment/my-maintenance-requests?limit=10");
          if (!cancelled) setRecent(list);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => { cancelled = true; };
  }, [lastResult]);

  const selectedEquipment = useMemo(
    () => equipment.find((e) => e.id === equipmentId) ?? null,
    [equipment, equipmentId]
  );

  async function addPhoto() {
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (result.canceled) return;
    const a = result.assets[0];
    setPhotos((prev) => [
      ...prev,
      {
        localId: `photo-${Date.now()}-${prev.length}`,
        uri: a.uri,
        mime: a.mimeType ?? "image/jpeg",
        name: a.fileName ?? `equipment-issue-${Date.now()}.jpg`,
      },
    ]);
  }

  function reset() {
    setDescription("");
    setPhotos([]);
    setIssueType(ISSUE_TYPES[0]);
    setSeverity("DOWN");
  }

  async function submit() {
    setFeedback(null);
    if (!equipmentId) {
      setFeedback("Pick the broken equipment first.");
      return;
    }
    const trimmed = description.trim();
    if (trimmed.length === 0) {
      setFeedback("Add a short description of the problem.");
      return;
    }
    setSubmitting(true);
    try {
      const rec = await enqueue({
        entityType: "MAINT_REQUEST",
        operation: "CREATE",
        payload: {
          equipmentId,
          severity,
          issueType,
          description: trimmed,
          projectId: projectId || undefined,
        },
        attachments: photos.length > 0 ? photos : undefined,
      });
      // Optimistic recent-list entry so the operator immediately sees their
      // submission with a PENDING status pill, even offline.
      setRecent((prev) => [
        {
          localId: rec.localId,
          status: "PENDING",
          description: `[${severity}] ${issueType}`,
          equipmentName: selectedEquipment?.name,
          equipmentCode: selectedEquipment?.equipmentCode,
          problemReportedAt: rec.clientTimestamp,
        },
        ...prev,
      ].slice(0, 10));
      const online = await isOnline();
      setFeedback(online ? "Submitted — syncing now…" : "Saved offline — will sync when online.");
      reset();
      void syncNow();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing(2), gap: spacing(2) }}>
      <SyncStatusBar />

      <Text style={styles.label}>Project (optional)</Text>
      <View style={styles.chipRow}>
        {projects.length === 0 ? (
          <Text style={styles.muted}>No projects cached.</Text>
        ) : (
          projects.slice(0, 20).map((p) => (
            <Pressable
              key={p.id}
              onPress={() => setProjectId(projectId === p.id ? "" : p.id)}
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

      <Text style={styles.label}>Equipment</Text>
      {equipment.length === 0 ? (
        <Text style={styles.muted}>No equipment available. Connect to load the list.</Text>
      ) : (
        <View style={styles.chipRow}>
          {equipment.slice(0, 100).map((e) => (
            <Pressable
              key={e.id}
              onPress={() => setEquipmentId(e.id)}
              style={[styles.chip, equipmentId === e.id && styles.chipActive]}
              testID={`chip-equipment-${e.id}`}
            >
              <Text style={[styles.chipText, equipmentId === e.id && styles.chipTextActive]}>
                {e.equipmentCode ? `${e.equipmentCode} · ${e.name ?? ""}` : (e.name ?? e.id.slice(0, 8))}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      <Text style={styles.label}>Severity</Text>
      <View style={styles.severityRow}>
        {SEVERITY_OPTIONS.map((opt) => (
          <Pressable
            key={opt.value}
            onPress={() => setSeverity(opt.value)}
            style={[styles.severityBtn, severity === opt.value && styles.severityBtnActive]}
            testID={`button-severity-${opt.value}`}
          >
            <Text style={[styles.severityLabel, severity === opt.value && styles.severityLabelActive]}>{opt.label}</Text>
            <Text style={[styles.severityHint, severity === opt.value && styles.severityHintActive]}>{opt.hint}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Issue type</Text>
      <View style={styles.chipRow}>
        {ISSUE_TYPES.map((t) => (
          <Pressable
            key={t}
            onPress={() => setIssueType(t)}
            style={[styles.chip, issueType === t && styles.chipActive]}
            testID={`chip-issue-${t.replace(/[^A-Za-z0-9]/g, "-")}`}
          >
            <Text style={[styles.chipText, issueType === t && styles.chipTextActive]}>{t}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Description</Text>
      <TextInput
        value={description}
        onChangeText={setDescription}
        multiline
        placeholder="What happened? Any noises, error codes, or hours when it failed?"
        placeholderTextColor={colors.textMuted}
        style={[styles.input, { minHeight: 96 }]}
        testID="input-description"
      />

      <View style={{ flexDirection: "row", gap: spacing(1), alignItems: "center" }}>
        <Pressable onPress={addPhoto} style={[styles.btn, styles.btnSecondary, { flex: 1 }]} testID="button-add-photo">
          <Text style={styles.btnTextDark}>Add photo</Text>
        </Pressable>
        <Text style={styles.muted} testID="text-photo-count">
          {photos.length} photo{photos.length === 1 ? "" : "s"}
        </Text>
      </View>

      {feedback ? <Text style={styles.feedback} testID="text-feedback">{feedback}</Text> : null}

      <Pressable
        onPress={() => void submit()}
        disabled={submitting}
        style={[styles.btn, submitting && { opacity: 0.6 }]}
        testID="button-submit-issue"
      >
        <Text style={styles.btnText}>{submitting ? "Submitting…" : "Submit request"}</Text>
      </Pressable>

      <Text style={[styles.label, { marginTop: spacing(2) }]}>My recent requests</Text>
      {recent.length === 0 ? (
        <Text style={styles.muted}>No requests submitted yet.</Text>
      ) : (
        recent.map((r) => {
          const key = r.id ?? r.localId ?? `${r.repairNumber}-${r.problemReportedAt}`;
          return (
            <View key={key} style={styles.row} testID={`row-recent-${key}`}>
              <Text style={styles.rowTitle}>
                {(r.repairNumber ? `${r.repairNumber} · ` : "")}
                {r.equipmentCode ? `${r.equipmentCode} ` : ""}
                {r.equipmentName ?? ""}
              </Text>
              <Text style={styles.rowSub} numberOfLines={2}>{r.description ?? ""}</Text>
              <Text style={[styles.rowSub, statusStyle(r.status)]} testID={`text-status-${key}`}>{r.status}</Text>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

function statusStyle(status: string) {
  if (status === "PENDING") return { color: "#f59e0b" };
  if (status === "COMPLETED") return { color: "#16a34a" };
  if (status === "IN_PROGRESS") return { color: colors.primary };
  return {};
}

const styles = StyleSheet.create({
  label: { color: colors.text, fontWeight: "600" },
  muted: { color: colors.textMuted },
  input: { backgroundColor: colors.surface, color: colors.text, padding: spacing(2), borderRadius: 8, textAlignVertical: "top" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing(1) },
  chip: { backgroundColor: colors.surface, paddingHorizontal: spacing(2), paddingVertical: spacing(1), borderRadius: 16 },
  chipActive: { backgroundColor: colors.primary },
  chipText: { color: colors.text },
  chipTextActive: { color: "#fff", fontWeight: "600" },
  severityRow: { flexDirection: "row", gap: spacing(1) },
  severityBtn: { flex: 1, backgroundColor: colors.surface, padding: spacing(2), borderRadius: 8, alignItems: "center" },
  severityBtnActive: { backgroundColor: colors.primary },
  severityLabel: { color: colors.text, fontWeight: "700" },
  severityLabelActive: { color: "#fff" },
  severityHint: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  severityHintActive: { color: "#e5e7eb" },
  btn: { backgroundColor: colors.primary, padding: spacing(2), borderRadius: 8, alignItems: "center" },
  btnSecondary: { backgroundColor: colors.surface },
  btnText: { color: "#fff", fontWeight: "600" },
  btnTextDark: { color: colors.text, fontWeight: "600" },
  feedback: { color: colors.text, backgroundColor: colors.surface, padding: spacing(2), borderRadius: 8 },
  row: { backgroundColor: colors.surface, padding: spacing(2), borderRadius: 8 },
  rowTitle: { color: colors.text, fontWeight: "600" },
  rowSub: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
});
