import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";

import { SyncStatusBar } from "@/components/SyncStatusBar";
import { useSync } from "@/sync/SyncContext";
import { enqueue, listOutbox } from "@/sync/outbox";
import { cacheList } from "@/sync/db";
import { colors, spacing } from "@/theme";
import type { OutboxRecord } from "@/sync/types";
import type { CachedProject } from "./types";

type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
type Category = "SAFETY" | "QUALITY" | "DELAY" | "DESIGN" | "OTHER";

const SEVERITIES: Severity[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const CATEGORIES: Category[] = ["SAFETY", "QUALITY", "DELAY", "DESIGN", "OTHER"];

type PendingPhoto = { localId: string; uri: string; mime: string; name: string };

type IssuePayload = {
  projectId?: string | null;
  title?: string;
  description?: string;
  severity?: Severity;
  category?: Category;
  location?: string;
  latitude?: number;
  longitude?: number;
};

export function IssueCapturesScreen() {
  const { syncNow, lastResult } = useSync();
  const [items, setItems] = useState<OutboxRecord[]>([]);
  const [projects, setProjects] = useState<CachedProject[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<Severity>("MEDIUM");
  const [category, setCategory] = useState<Category>("QUALITY");
  const [location, setLocation] = useState("");
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  const [selected, setSelected] = useState<OutboxRecord | null>(null);

  async function refresh() {
    const all = await listOutbox();
    setItems(all.filter((o) => o.entityType === "ISSUE_CAPTURE").reverse());
  }

  useEffect(() => { void refresh(); }, [lastResult]);
  useEffect(() => {
    void cacheList<CachedProject>("PROJECT").then((p) => {
      setProjects(p);
      setProjectId((cur) => cur ?? p[0]?.id ?? null);
    });
  }, []);

  async function addPhoto() {
    const photo = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (photo.canceled) return;
    const a = photo.assets[0];
    setPhotos((prev) => [
      ...prev,
      {
        localId: `issue-photo-${Date.now()}`,
        uri: a.uri,
        mime: a.mimeType ?? "image/jpeg",
        name: a.fileName ?? `issue-${Date.now()}.jpg`,
      },
    ]);
  }

  async function readGps(): Promise<{ latitude?: number; longitude?: number }> {
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") return {};
      const loc = await Location.getCurrentPositionAsync({});
      return { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
    } catch {
      return {};
    }
  }

  async function submit() {
    if (!title.trim()) return;
    const gps = await readGps();
    const payload: IssuePayload = {
      projectId: projectId ?? null,
      title: title.trim(),
      description: description.trim() || undefined,
      severity,
      category,
      location: location.trim() || undefined,
      ...gps,
    };
    await enqueue({
      entityType: "ISSUE_CAPTURE",
      operation: "CREATE",
      payload: payload as Record<string, unknown>,
      attachments: photos.length > 0 ? photos : undefined,
    });
    setTitle("");
    setDescription("");
    setLocation("");
    setSeverity("MEDIUM");
    setCategory("QUALITY");
    setPhotos([]);
    await refresh();
    void syncNow();
  }

  if (selected) {
    const p = selected.payload as IssuePayload;
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <SyncStatusBar />
        <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(1) }}>
          <Pressable onPress={() => setSelected(null)} style={styles.smallBtn} testID="button-back-to-list">
            <Text style={styles.btnText}>Back</Text>
          </Pressable>
          <Text style={styles.title}>{p.title}</Text>
          <Text style={styles.sub}>
            {p.severity} · {p.category} · {selected.status}
            {selected.lastError ? ` · ${selected.lastError}` : ""}
          </Text>
          {p.location ? <Text style={styles.sub}>Location: {p.location}</Text> : null}
          {typeof p.latitude === "number" && typeof p.longitude === "number" ? (
            <Text style={styles.sub}>GPS: {p.latitude.toFixed(5)}, {p.longitude.toFixed(5)}</Text>
          ) : null}
          {p.description ? <Text style={styles.body}>{p.description}</Text> : null}
          {selected.attachments && selected.attachments.length > 0 ? (
            <Text style={styles.sub}>{selected.attachments.length} photo(s) attached</Text>
          ) : null}
          <Text style={styles.sub}>Queued at {new Date(selected.clientTimestamp).toLocaleString()}</Text>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SyncStatusBar />
      <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(1) }}>
        <ScrollView horizontal style={{ maxHeight: 44 }} contentContainerStyle={{ gap: spacing(1) }}>
          {projects.map((p) => (
            <Pressable
              key={p.id}
              onPress={() => setProjectId(p.id)}
              style={[styles.chip, projectId === p.id && { backgroundColor: colors.primary }]}
              testID={`chip-project-${p.id}`}
            >
              <Text style={styles.chipText}>{p.name ?? p.id}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <TextInput
          placeholder="Title (required)"
          placeholderTextColor={colors.textMuted}
          value={title}
          onChangeText={setTitle}
          style={styles.input}
          testID="input-issue-title"
        />

        <Text style={styles.label}>Severity</Text>
        <View style={styles.rowChips}>
          {SEVERITIES.map((s) => (
            <Pressable
              key={s}
              onPress={() => setSeverity(s)}
              style={[styles.chip, severity === s && { backgroundColor: colors.primary }]}
              testID={`chip-severity-${s}`}
            >
              <Text style={styles.chipText}>{s}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Category</Text>
        <View style={styles.rowChips}>
          {CATEGORIES.map((c) => (
            <Pressable
              key={c}
              onPress={() => setCategory(c)}
              style={[styles.chip, category === c && { backgroundColor: colors.primary }]}
              testID={`chip-category-${c}`}
            >
              <Text style={styles.chipText}>{c}</Text>
            </Pressable>
          ))}
        </View>

        <TextInput
          placeholder="Location / area (e.g. Level 3, grid C-4)"
          placeholderTextColor={colors.textMuted}
          value={location}
          onChangeText={setLocation}
          style={styles.input}
          testID="input-issue-location"
        />

        <TextInput
          placeholder="Describe what's wrong"
          placeholderTextColor={colors.textMuted}
          multiline
          value={description}
          onChangeText={setDescription}
          style={[styles.input, { minHeight: 80, textAlignVertical: "top" }]}
          testID="input-issue-description"
        />

        <View style={{ flexDirection: "row", gap: spacing(1) }}>
          <Pressable onPress={addPhoto} style={[styles.btn, { flex: 1 }]} testID="button-add-issue-photo">
            <Text style={styles.btnText}>Add photo</Text>
          </Pressable>
          <Pressable onPress={submit} style={[styles.btn, { flex: 1, backgroundColor: colors.success ?? "#16a34a" }]} testID="button-submit-issue">
            <Text style={styles.btnText}>Submit issue</Text>
          </Pressable>
        </View>
        {photos.length > 0 ? (
          <Text style={{ color: colors.textMuted, fontSize: 12 }} testID="text-issue-photos">
            {photos.length} photo{photos.length === 1 ? "" : "s"} ready
          </Text>
        ) : null}

        <Text style={styles.h2}>Recent issues on this device</Text>
        {items.length === 0 ? (
          <Text style={{ color: colors.textMuted }}>None yet</Text>
        ) : null}
        {items.map((i) => {
          const p = i.payload as IssuePayload;
          return (
            <Pressable
              key={i.localId}
              onPress={() => setSelected(i)}
              style={styles.row}
              testID={`row-issue-${i.localId}`}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{p.title}</Text>
                <Text style={styles.rowSub}>
                  {p.severity ?? "MEDIUM"} · {p.category ?? "OTHER"} · {i.status}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  input: { backgroundColor: colors.surface, color: colors.text, padding: spacing(2), borderRadius: 8 },
  btn: { backgroundColor: colors.primary, padding: spacing(2), borderRadius: 8, alignItems: "center" },
  smallBtn: { backgroundColor: colors.surface, paddingHorizontal: spacing(2), paddingVertical: spacing(1), borderRadius: 6, alignSelf: "flex-start" },
  btnText: { color: "#fff", fontWeight: "600" },
  row: { backgroundColor: colors.surface, padding: spacing(2), borderRadius: 8, flexDirection: "row", alignItems: "center", gap: spacing(1) },
  rowTitle: { color: colors.text, fontWeight: "600" },
  rowSub: { color: colors.textMuted, fontSize: 12 },
  rowChips: { flexDirection: "row", flexWrap: "wrap", gap: spacing(1) },
  chip: { backgroundColor: colors.surface, paddingHorizontal: spacing(2), paddingVertical: spacing(1), borderRadius: 999 },
  chipText: { color: colors.text, fontSize: 12 },
  label: { color: colors.textMuted, fontSize: 12, marginTop: spacing(1) },
  h2: { color: colors.text, fontSize: 16, fontWeight: "600", marginTop: spacing(2) },
  title: { color: colors.text, fontSize: 18, fontWeight: "700" },
  sub: { color: colors.textMuted, fontSize: 12 },
  body: { color: colors.text, fontSize: 14 },
});
