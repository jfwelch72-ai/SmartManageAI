import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";

import { SyncStatusBar } from "@/components/SyncStatusBar";
import { SignaturePad, type SignaturePadHandle } from "@/components/SignaturePad";
import { useAuth } from "@/auth/AuthContext";
import { useSync } from "@/sync/SyncContext";
import { enqueue, listOutbox } from "@/sync/outbox";
import { cacheList } from "@/sync/db";
import { isOnline } from "@/sync/coordinator";
import { colors, spacing } from "@/theme";
import type { OutboxRecord } from "@/sync/types";

type ProjectRow = { id: string; name?: string; title?: string };

type BmpStatus = "PASS" | "FAIL" | "NA";
type BmpAnswer = { status?: BmpStatus; note?: string };

type PendingAttachment = {
  localId: string;
  uri: string;
  mime: string;
  name: string;
};

// Default BMP checklist used when the office has not yet published a
// project-specific template. Matches the common items required on a
// CGP/NPDES routine SWPPP walk and is rendered as the form skeleton.
const DEFAULT_BMP_CHECKLIST = [
  "Perimeter silt fence intact",
  "Inlet protection in place",
  "Stabilized construction entrance",
  "Concrete washout contained",
  "Stockpiles covered / stabilized",
  "Sediment basins / traps maintained",
  "Disturbed slopes stabilized",
  "Spill kit on site and stocked",
  "Material storage covered",
  "Discharge points free of sediment",
];

const INSPECTION_TYPES: Array<{ value: string; label: string }> = [
  { value: "ROUTINE", label: "Routine (weekly)" },
  { value: "RAIN_EVENT", label: "Rain event" },
  { value: "PRE_STORM", label: "Pre-storm" },
];

export function SwpppInspectionScreen() {
  const { user } = useAuth();
  const { syncNow, lastResult } = useSync();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [projectId, setProjectId] = useState("");
  const [inspectionType, setInspectionType] = useState<string>("ROUTINE");
  const [inspectionDate] = useState(() => new Date().toISOString());
  const inspectorName = useMemo(() => {
    if (!user) return "";
    const parts = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
    return parts || user.email;
  }, [user]);
  const [rainEvent, setRainEvent] = useState(false);
  const [rainfallInches, setRainfallInches] = useState("");
  const [answers, setAnswers] = useState<Record<string, BmpAnswer>>({});
  const [photos, setPhotos] = useState<PendingAttachment[]>([]);
  const signatureRef = useRef<SignaturePadHandle>(null);
  const [deficiencies, setDeficiencies] = useState("");
  const [notes, setNotes] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [recent, setRecent] = useState<OutboxRecord[]>([]);

  useEffect(() => {
    void cacheList<ProjectRow>("PROJECT").then(setProjects);
  }, []);

  async function refresh() {
    const all = await listOutbox();
    setRecent(all.filter((o) => o.entityType === "SWPPP_INSPECTION").reverse().slice(0, 10));
  }
  useEffect(() => { void refresh(); }, [lastResult]);

  function setStatus(item: string, status: BmpStatus) {
    setAnswers((a) => ({ ...a, [item]: { ...a[item], status } }));
  }
  function setNote(item: string, note: string) {
    setAnswers((a) => ({ ...a, [item]: { ...a[item], note } }));
  }

  async function addPhoto(forItem?: string) {
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.6,
    });
    if (result.canceled) return;
    const a = result.assets[0];
    const tag = forItem ? `bmp-${forItem.replace(/[^A-Za-z0-9]/g, "-").slice(0, 32)}` : "swppp";
    setPhotos((prev) => [
      ...prev,
      {
        localId: `${tag}-${Date.now()}-${prev.length}`,
        uri: a.uri,
        mime: a.mimeType ?? "image/jpeg",
        name: a.fileName ?? `swppp-${Date.now()}-${prev.length}.jpg`,
      },
    ]);
  }

  function reset() {
    setAnswers({});
    setPhotos([]);
    signatureRef.current?.clear();
    setDeficiencies("");
    setNotes("");
    setRainEvent(false);
    setRainfallInches("");
  }

  async function submit() {
    setFeedback(null);
    if (!projectId) {
      setFeedback("Pick the project for this inspection.");
      return;
    }
    const answered = DEFAULT_BMP_CHECKLIST.filter((q) => answers[q]?.status);
    if (answered.length < DEFAULT_BMP_CHECKLIST.length) {
      setFeedback("Mark Pass / Fail / N-A for every BMP item.");
      return;
    }
    if (signatureRef.current?.isEmpty() !== false) {
      setFeedback("Inspector signature required.");
      return;
    }
    const signatureDataUrl = signatureRef.current?.export();
    if (!signatureDataUrl) {
      setFeedback("Inspector signature required.");
      return;
    }
    setSubmitting(true);
    try {
      const bmpChecklist = DEFAULT_BMP_CHECKLIST.map((item) => ({
        item,
        status: answers[item]?.status,
        correctiveAction: answers[item]?.note ?? "",
      }));
      const failedItems = bmpChecklist.filter((b) => b.status === "FAIL");
      const summarizedDeficiencies = deficiencies.trim() || failedItems
        .map((f) => `${f.item}${f.correctiveAction ? `: ${f.correctiveAction}` : ""}`)
        .join("; ");
      const summarizedCorrective = failedItems
        .map((f) => f.correctiveAction)
        .filter(Boolean)
        .join("; ");
      await enqueue({
        entityType: "SWPPP_INSPECTION",
        operation: "CREATE",
        payload: {
          projectId,
          inspectionDate: inspectionDate.slice(0, 10),
          inspectionType,
          inspectorName,
          rainfall24hrInches: rainEvent && rainfallInches ? rainfallInches : null,
          bmpChecklist,
          deficienciesFound: summarizedDeficiencies || null,
          correctiveActions: summarizedCorrective || null,
          notes: notes.trim() || null,
          signature: {
            mime: "image/png",
            dataUrl: signatureDataUrl,
            capturedAt: new Date().toISOString(),
            signerName: inspectorName,
          },
        },
        attachments: photos.length > 0 ? photos : undefined,
      });
      const online = await isOnline();
      setFeedback(online ? "Submitted — syncing now…" : "Saved offline — will sync when online.");
      reset();
      await refresh();
      void syncNow();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SyncStatusBar />
      <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(2) }}>
        <Text style={styles.label}>Project</Text>
        {projects.length === 0 ? (
          <Text style={styles.muted}>No projects cached. Pull-to-sync from Home first.</Text>
        ) : (
          <View style={styles.chipRow}>
            {projects.slice(0, 30).map((p) => (
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
            ))}
          </View>
        )}

        <Text style={styles.label}>Inspector</Text>
        <Text style={styles.value} testID="text-inspector">{inspectorName || "—"}</Text>

        <Text style={styles.label}>Date / time</Text>
        <Text style={styles.value}>{new Date(inspectionDate).toLocaleString()}</Text>

        <Text style={styles.label}>Inspection type</Text>
        <View style={styles.chipRow}>
          {INSPECTION_TYPES.map((t) => (
            <Pressable
              key={t.value}
              onPress={() => setInspectionType(t.value)}
              style={[styles.chip, inspectionType === t.value && styles.chipActive]}
              testID={`chip-type-${t.value}`}
            >
              <Text style={[styles.chipText, inspectionType === t.value && styles.chipTextActive]}>{t.label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.rainHeader}>
          <Text style={styles.label}>Rain event?</Text>
          <View style={{ flexDirection: "row", gap: spacing(1) }}>
            {([
              { v: true, l: "Yes" },
              { v: false, l: "No" },
            ] as const).map((o) => (
              <Pressable
                key={o.l}
                onPress={() => setRainEvent(o.v)}
                style={[styles.chip, rainEvent === o.v && styles.chipActive]}
                testID={`chip-rain-${o.l.toLowerCase()}`}
              >
                <Text style={[styles.chipText, rainEvent === o.v && styles.chipTextActive]}>{o.l}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        {rainEvent ? (
          <TextInput
            value={rainfallInches}
            onChangeText={setRainfallInches}
            placeholder="Rainfall in last 24h (inches)"
            placeholderTextColor={colors.textMuted}
            keyboardType="decimal-pad"
            style={styles.input}
            testID="input-rainfall"
          />
        ) : null}

        <Text style={[styles.label, { marginTop: spacing(2) }]}>BMP checklist</Text>
        {DEFAULT_BMP_CHECKLIST.map((q) => {
          const answer = answers[q] ?? {};
          return (
            <View key={q} style={styles.bmpRow}>
              <Text style={styles.bmpTitle}>{q}</Text>
              <View style={styles.statusRow}>
                {(["PASS", "FAIL", "NA"] as const).map((v) => {
                  const active = answer.status === v;
                  const tint = v === "PASS" ? colors.success : v === "FAIL" ? colors.danger : colors.surfaceMuted;
                  return (
                    <Pressable
                      key={v}
                      onPress={() => setStatus(q, v)}
                      style={[styles.statusChip, active && { backgroundColor: tint }]}
                      testID={`chip-${v.toLowerCase()}-${q.slice(0, 20).replace(/[^A-Za-z0-9]/g, "-")}`}
                    >
                      <Text style={styles.statusChipText}>{v === "NA" ? "N/A" : v}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {answer.status === "FAIL" ? (
                <>
                  <TextInput
                    value={answer.note ?? ""}
                    onChangeText={(t: string) => setNote(q, t)}
                    placeholder="Corrective action"
                    placeholderTextColor={colors.textMuted}
                    style={[styles.input, { marginTop: spacing(1) }]}
                    testID={`input-corrective-${q.slice(0, 20).replace(/[^A-Za-z0-9]/g, "-")}`}
                  />
                  <Pressable
                    onPress={() => void addPhoto(q)}
                    style={[styles.btn, styles.btnSecondary, { marginTop: spacing(1) }]}
                    testID={`button-photo-${q.slice(0, 20).replace(/[^A-Za-z0-9]/g, "-")}`}
                  >
                    <Text style={styles.btnTextDark}>Add photo for this BMP</Text>
                  </Pressable>
                </>
              ) : null}
            </View>
          );
        })}

        <Text style={[styles.label, { marginTop: spacing(2) }]}>Site photos ({photos.length})</Text>
        <Pressable onPress={() => void addPhoto()} style={[styles.btn, styles.btnSecondary]} testID="button-add-photo">
          <Text style={styles.btnTextDark}>Add site photo</Text>
        </Pressable>

        <Text style={[styles.label, { marginTop: spacing(2) }]}>Additional deficiencies (optional)</Text>
        <TextInput
          value={deficiencies}
          onChangeText={setDeficiencies}
          multiline
          style={[styles.input, { minHeight: 64 }]}
          placeholder="Anything not covered by the checklist above"
          placeholderTextColor={colors.textMuted}
          testID="input-deficiencies"
        />

        <Text style={styles.label}>Notes (optional)</Text>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          multiline
          style={[styles.input, { minHeight: 64 }]}
          placeholder="Weather, crew, observations"
          placeholderTextColor={colors.textMuted}
          testID="input-notes"
        />

        <Text style={[styles.label, { marginTop: spacing(2) }]}>Inspector signature</Text>
        <SignaturePad ref={signatureRef} />

        {feedback ? <Text style={styles.feedback} testID="text-feedback">{feedback}</Text> : null}

        <Pressable
          onPress={() => void submit()}
          disabled={submitting}
          style={[styles.btn, submitting && { opacity: 0.6 }]}
          testID="button-submit-swppp"
        >
          <Text style={styles.btnText}>{submitting ? "Submitting…" : "Submit SWPPP inspection"}</Text>
        </Pressable>

        <Text style={[styles.label, { marginTop: spacing(2) }]}>Recent SWPPP inspections</Text>
        {recent.length === 0 ? (
          <Text style={styles.muted}>None submitted from this device yet.</Text>
        ) : (
          recent.map((r) => {
            const date = typeof r.payload.inspectionDate === "string" ? r.payload.inspectionDate : r.clientTimestamp;
            const type = typeof r.payload.inspectionType === "string" ? r.payload.inspectionType : "ROUTINE";
            return (
              <View key={r.localId} style={styles.row} testID={`row-recent-${r.localId}`}>
                <Text style={styles.rowTitle}>{date} · {type}</Text>
                <Text style={[styles.rowSub, statusTint(r.status)]}>{r.status}</Text>
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

function statusTint(status: string) {
  if (status === "SYNCED") return { color: colors.success };
  if (status === "CONFLICT") return { color: colors.danger };
  if (status === "FAILED") return { color: colors.warn };
  return { color: colors.textMuted };
}

const styles = StyleSheet.create({
  label: { color: colors.text, fontWeight: "600" },
  value: { color: colors.text },
  muted: { color: colors.textMuted },
  input: { backgroundColor: colors.surface, color: colors.text, padding: spacing(2), borderRadius: 8, textAlignVertical: "top" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing(1) },
  chip: { backgroundColor: colors.surface, paddingHorizontal: spacing(2), paddingVertical: spacing(1), borderRadius: 16 },
  chipActive: { backgroundColor: colors.primary },
  chipText: { color: colors.text },
  chipTextActive: { color: "#fff", fontWeight: "600" },
  rainHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  bmpRow: { backgroundColor: colors.surface, padding: spacing(2), borderRadius: 8, gap: spacing(1) },
  bmpTitle: { color: colors.text, fontWeight: "600" },
  statusRow: { flexDirection: "row", gap: spacing(1) },
  statusChip: { flex: 1, backgroundColor: colors.surfaceMuted, paddingVertical: spacing(1), borderRadius: 6, alignItems: "center" },
  statusChipText: { color: colors.text, fontWeight: "600" },
  btn: { backgroundColor: colors.primary, padding: spacing(2), borderRadius: 8, alignItems: "center" },
  btnSecondary: { backgroundColor: colors.surface },
  btnText: { color: "#fff", fontWeight: "600" },
  btnTextDark: { color: colors.text, fontWeight: "600" },
  feedback: { color: colors.text, backgroundColor: colors.surface, padding: spacing(2), borderRadius: 8 },
  row: { backgroundColor: colors.surface, padding: spacing(2), borderRadius: 8 },
  rowTitle: { color: colors.text, fontWeight: "600" },
  rowSub: { fontSize: 12, marginTop: 2 },
});
