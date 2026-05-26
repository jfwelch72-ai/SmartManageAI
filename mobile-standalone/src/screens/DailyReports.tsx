import React, { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Audio } from "expo-av";

import { SyncStatusBar } from "@/components/SyncStatusBar";
import { useSync } from "@/sync/SyncContext";
import { enqueue } from "@/sync/outbox";
import { cacheList, cachePut } from "@/sync/db";
import { colors, spacing } from "@/theme";

type DailyReport = {
  id: string;
  date: string;
  notes?: string;
  attachments?: Array<{ name: string }>;
  status?: string;
};

type PendingAttachment = {
  localId: string;
  uri: string;
  mime: string;
  name: string;
};

export function DailyReportsScreen() {
  const { syncNow, lastResult } = useSync();
  const [items, setItems] = useState<DailyReport[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<Audio.Recording | null>(null);

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
    const rec = await enqueue({
      entityType: "DAILY_REPORT",
      operation: "CREATE",
      payload: { notes: draft, date },
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
        {items.map((it) => (
          <View key={it.id} style={styles.row} testID={`row-report-${it.id}`}>
            <Text style={styles.rowTitle}>{it.date}</Text>
            <Text style={styles.rowSub} numberOfLines={2}>{it.notes ?? ""}</Text>
          </View>
        ))}
        {items.length === 0 ? <Text style={{ color: colors.textMuted }}>No reports yet</Text> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  input: { backgroundColor: colors.surface, color: colors.text, padding: spacing(2), borderRadius: 8, minHeight: 80, textAlignVertical: "top" },
  btn: { backgroundColor: colors.primary, padding: spacing(2), borderRadius: 8, alignItems: "center" },
  btnText: { color: "#fff", fontWeight: "600" },
  row: { backgroundColor: colors.surface, padding: spacing(2), borderRadius: 8 },
  rowTitle: { color: colors.text, fontWeight: "600" },
  rowSub: { color: colors.textMuted, fontSize: 12 },
});
