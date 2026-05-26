import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Audio } from "expo-av";

import { SyncStatusBar } from "@/components/SyncStatusBar";
import { useSync } from "@/sync/SyncContext";
import { enqueue } from "@/sync/outbox";
import { cacheList, cachePut } from "@/sync/db";
import { colors, spacing } from "@/theme";

type CachedProject = { id: string; name?: string; title?: string };

type CachedVoiceLog = {
  id: string;
  projectId?: string | null;
  duration?: number | null;
  transcription?: string | null;
  category?: string | null;
  status?: string | null;
  createdAt?: string | null;
};

const CATEGORIES = [
  { value: "DAILY_NOTE", label: "Daily Note" },
  { value: "ISSUE", label: "Issue" },
  { value: "SAFETY", label: "Safety" },
  { value: "OTHER", label: "Other" },
];

function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mm = Math.floor(s / 60).toString().padStart(2, "0");
  const ss = (s % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

export function VoiceLogsScreen() {
  const { syncNow, lastResult } = useSync();

  const [projects, setProjects] = useState<CachedProject[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [category, setCategory] = useState<string>("DAILY_NOTE");
  const [title, setTitle] = useState<string>("");

  const recorderRef = useRef<Audio.Recording | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [meter, setMeter] = useState<number>(0); // 0..1 normalized
  const [pending, setPending] = useState<{ uri: string; mime: string; name: string; duration: number } | null>(null);

  const [items, setItems] = useState<CachedVoiceLog[]>([]);

  useEffect(() => {
    void cacheList<CachedProject>("PROJECT").then(setProjects);
    void cacheList<CachedVoiceLog>("VOICE_LOG").then(setItems);
  }, [lastResult]);

  // Cleanup recorder on unmount — prevents a dangling expo-av Recording if
  // the user navigates away mid-take.
  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      const r = recorderRef.current;
      if (r) {
        void r.stopAndUnloadAsync().catch(() => {});
        recorderRef.current = null;
      }
    };
  }, []);

  function startTick(r: Audio.Recording) {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = setInterval(async () => {
      try {
        // expo-av 14's `Recording` type omits getStatusAsync from the
        // exposed surface but the runtime instance exposes it; cast to
        // any to read the live duration + dB meter.
        const s: any = await (r as any).getStatusAsync();
        if (!s?.isRecording) return;
        setElapsed(Math.floor((s.durationMillis ?? 0) / 1000));
        // metering is on a dB scale where 0 = peak, -160 = silence.
        const db = s.metering as number | undefined;
        if (typeof db === "number" && isFinite(db)) {
          const norm = Math.max(0, Math.min(1, (db + 60) / 60));
          setMeter(norm);
        }
      } catch {
        /* ignore polling errors */
      }
    }, 200);
  }

  function stopTick() {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
  }

  async function start() {
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) return;
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording: r } = await Audio.Recording.createAsync({
        ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
        isMeteringEnabled: true,
      });
      recorderRef.current = r;
      setRecording(true);
      setPaused(false);
      setElapsed(0);
      setMeter(0);
      setPending(null);
      startTick(r);
    } catch (e) {
      console.warn("[voice-log] start failed", e);
    }
  }

  async function pause() {
    const r = recorderRef.current;
    if (!r) return;
    try {
      await (r as any).pauseAsync();
      setPaused(true);
      stopTick();
    } catch (e) {
      console.warn("[voice-log] pause failed", e);
    }
  }

  async function resume() {
    const r = recorderRef.current;
    if (!r) return;
    try {
      await r.startAsync();
      setPaused(false);
      startTick(r);
    } catch (e) {
      console.warn("[voice-log] resume failed", e);
    }
  }

  async function stop() {
    const r = recorderRef.current;
    recorderRef.current = null;
    stopTick();
    setRecording(false);
    setPaused(false);
    if (!r) return;
    try {
      await r.stopAndUnloadAsync();
      const uri = r.getURI();
      if (!uri) return;
      const status: any = await (r as any).getStatusAsync().catch(() => null);
      const durationSec = status?.durationMillis ? Math.round(status.durationMillis / 1000) : elapsed;
      setPending({
        uri,
        mime: "audio/m4a",
        name: `voice-log-${Date.now()}.m4a`,
        duration: durationSec,
      });
    } catch (e) {
      console.warn("[voice-log] stop failed", e);
    }
  }

  async function discard() {
    setPending(null);
    setTitle("");
    setElapsed(0);
    setMeter(0);
  }

  const canSubmit = useMemo(() => !!pending && !recording, [pending, recording]);

  async function submit() {
    if (!pending) return;
    const rec = await enqueue({
      entityType: "VOICE_LOG",
      operation: "CREATE",
      payload: {
        projectId,
        category,
        title: title.trim() || null,
        duration: pending.duration,
      },
      attachments: [
        {
          localId: `voice-log-${Date.now()}`,
          uri: pending.uri,
          mime: pending.mime,
          name: pending.name,
        },
      ],
    });
    // Optimistic local-id placeholder so it appears immediately in the
    // recent list with "Transcript pending" — replaced by the server row
    // once pushVoiceLogs() succeeds.
    const placeholder: CachedVoiceLog = {
      id: rec.localId,
      projectId,
      duration: pending.duration,
      transcription: title.trim() || null,
      category,
      status: "PENDING",
      createdAt: new Date().toISOString(),
    };
    await cachePut("VOICE_LOG", rec.localId, placeholder, placeholder.createdAt!);
    setItems((prev) => [placeholder, ...prev.filter((p) => p.id !== rec.localId)]);
    setPending(null);
    setTitle("");
    setElapsed(0);
    setMeter(0);
    void syncNow();
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SyncStatusBar />
      <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(2) }}>
        {/* RECORDER */}
        <View style={styles.recorderCard}>
          <Text style={styles.timer} testID="text-recording-timer">{fmtTime(elapsed)}</Text>
          <View style={styles.meterTrack}>
            <View
              style={[
                styles.meterFill,
                {
                  width: `${Math.round(meter * 100)}%`,
                  backgroundColor: recording && !paused ? colors.danger : colors.primary,
                },
              ]}
              testID="meter-recording-level"
            />
          </View>

          {!recording && !pending ? (
            <Pressable
              onPress={start}
              style={[styles.bigBtn, { backgroundColor: colors.danger }]}
              testID="button-record-start"
            >
              <Text style={styles.bigBtnText}>● Record</Text>
            </Pressable>
          ) : null}

          {recording && !paused ? (
            <View style={styles.btnRow}>
              <Pressable onPress={pause} style={[styles.btn, { flex: 1, backgroundColor: colors.primary }]} testID="button-record-pause">
                <Text style={styles.btnText}>❚❚ Pause</Text>
              </Pressable>
              <Pressable onPress={stop} style={[styles.btn, { flex: 1, backgroundColor: colors.danger }]} testID="button-record-stop">
                <Text style={styles.btnText}>■ Stop</Text>
              </Pressable>
            </View>
          ) : null}

          {recording && paused ? (
            <View style={styles.btnRow}>
              <Pressable onPress={resume} style={[styles.btn, { flex: 1, backgroundColor: colors.danger }]} testID="button-record-resume">
                <Text style={styles.btnText}>● Resume</Text>
              </Pressable>
              <Pressable onPress={stop} style={[styles.btn, { flex: 1, backgroundColor: colors.primary }]} testID="button-record-stop">
                <Text style={styles.btnText}>■ Stop</Text>
              </Pressable>
            </View>
          ) : null}

          {pending ? (
            <Text style={styles.helper} testID="text-recording-ready">
              Recording ready ({fmtTime(pending.duration)}). Tag and submit below.
            </Text>
          ) : null}
        </View>

        {/* TAGGING */}
        {pending ? (
          <>
            <Text style={styles.label}>Project</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: "row", gap: spacing(1) }}>
                <Pressable
                  onPress={() => setProjectId(null)}
                  style={[styles.chip, projectId === null && styles.chipActive]}
                  testID="chip-voice-project-none"
                >
                  <Text style={[styles.chipText, projectId === null && styles.chipTextActive]}>No project</Text>
                </Pressable>
                {projects.map((p) => (
                  <Pressable
                    key={p.id}
                    onPress={() => setProjectId(p.id)}
                    style={[styles.chip, projectId === p.id && styles.chipActive]}
                    testID={`chip-voice-project-${p.id}`}
                  >
                    <Text style={[styles.chipText, projectId === p.id && styles.chipTextActive]}>
                      {p.name ?? p.title ?? p.id.slice(0, 6)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>

            <Text style={styles.label}>Category</Text>
            <View style={styles.gridButtons}>
              {CATEGORIES.map((c) => (
                <Pressable
                  key={c.value}
                  onPress={() => setCategory(c.value)}
                  style={[styles.gridBtn, category === c.value && styles.gridBtnActive]}
                  testID={`button-voice-category-${c.value}`}
                >
                  <Text style={[styles.gridBtnText, category === c.value && styles.gridBtnTextActive]}>{c.label}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.label}>Title (optional)</Text>
            <TextInput
              placeholder="Short label so office staff can scan the list"
              placeholderTextColor={colors.textMuted}
              value={title}
              onChangeText={setTitle}
              style={styles.input}
              testID="input-voice-title"
            />

            <View style={styles.btnRow}>
              <Pressable
                onPress={discard}
                style={[styles.btn, { flex: 1, backgroundColor: colors.surfaceMuted }]}
                testID="button-voice-discard"
              >
                <Text style={[styles.btnText, { color: colors.text }]}>Discard</Text>
              </Pressable>
              <Pressable
                onPress={submit}
                disabled={!canSubmit}
                style={[
                  styles.btn,
                  { flex: 2, backgroundColor: canSubmit ? (colors.success ?? "#16a34a") : colors.surfaceMuted },
                ]}
                testID="button-voice-submit"
              >
                <Text style={styles.btnText}>Save voice log</Text>
              </Pressable>
            </View>
          </>
        ) : null}

        {/* RECENT */}
        <Text style={styles.h2}>Recent voice logs</Text>
        {items.length === 0 ? (
          <Text style={{ color: colors.textMuted }}>No voice logs yet</Text>
        ) : null}
        {items.slice(0, 30).map((it) => {
          const project = projects.find((p) => p.id === it.projectId);
          const transcript = (it.transcription ?? "").trim();
          return (
            <View key={it.id} style={styles.row} testID={`row-voice-log-${it.id}`}>
              <Text style={styles.rowTitle}>
                {project?.name ?? project?.title ?? (it.projectId ? "Project" : "No project")}
                {it.category ? ` • ${it.category}` : ""}
                {typeof it.duration === "number" ? ` • ${fmtTime(it.duration)}` : ""}
              </Text>
              <Text
                style={[styles.rowSub, !transcript && { fontStyle: "italic" }]}
                numberOfLines={3}
                testID={`text-voice-transcript-${it.id}`}
              >
                {transcript || "Transcript pending"}
              </Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  recorderCard: {
    backgroundColor: colors.surface,
    padding: spacing(2),
    borderRadius: 12,
    gap: spacing(2),
    alignItems: "stretch",
  },
  timer: { color: colors.text, fontSize: 40, fontWeight: "700", textAlign: "center", fontVariant: ["tabular-nums"] },
  meterTrack: { height: 10, backgroundColor: colors.surfaceMuted, borderRadius: 5, overflow: "hidden" },
  meterFill: { height: "100%", borderRadius: 5 },
  bigBtn: { padding: spacing(3), borderRadius: 12, alignItems: "center" },
  bigBtnText: { color: "#fff", fontWeight: "700", fontSize: 20 },
  btnRow: { flexDirection: "row", gap: spacing(1) },
  btn: { backgroundColor: colors.primary, padding: spacing(2), borderRadius: 8, alignItems: "center" },
  btnText: { color: "#fff", fontWeight: "600" },
  label: { color: colors.text, fontWeight: "600", marginTop: spacing(1) },
  helper: { color: colors.textMuted, fontSize: 12, textAlign: "center" },
  input: { backgroundColor: colors.surface, color: colors.text, padding: spacing(2), borderRadius: 8 },
  chip: {
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(1),
    backgroundColor: colors.surface,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.text },
  chipTextActive: { color: "#fff", fontWeight: "600" },
  gridButtons: { flexDirection: "row", flexWrap: "wrap", gap: spacing(1) },
  gridBtn: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(1.5),
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    flexBasis: "48%",
    alignItems: "center",
  },
  gridBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  gridBtnText: { color: colors.text },
  gridBtnTextActive: { color: "#fff", fontWeight: "600" },
  h2: { color: colors.text, fontSize: 16, fontWeight: "600", marginTop: spacing(2) },
  row: { backgroundColor: colors.surface, padding: spacing(2), borderRadius: 8, gap: spacing(0.5) },
  rowTitle: { color: colors.text, fontWeight: "600" },
  rowSub: { color: colors.textMuted, fontSize: 13 },
});
