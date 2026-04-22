import React, { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";

import { SyncStatusBar } from "@/components/SyncStatusBar";
import { useSync } from "@/sync/SyncContext";
import { enqueue, listOutbox } from "@/sync/outbox";
import { cacheList } from "@/sync/db";
import { colors, spacing } from "@/theme";
import type { OutboxRecord } from "@/sync/types";
import type { CachedProject } from "./types";

export function PhotosScreen() {
  const { syncNow } = useSync();
  const [pending, setPending] = useState<OutboxRecord[]>([]);
  const [projects, setProjects] = useState<CachedProject[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);

  async function refresh() {
    const all = await listOutbox();
    setPending(all.filter((o) => o.entityType === "PHOTO").reverse());
  }

  useEffect(() => {
    void refresh();
    void cacheList<CachedProject>("PROJECT").then((p) => {
      setProjects(p);
      setProjectId((cur) => cur ?? p[0]?.id ?? null);
    });
  }, []);

  async function capture() {
    const photo = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (photo.canceled) return;
    const a = photo.assets[0];
    await enqueue({
      entityType: "PHOTO",
      operation: "CREATE",
      payload: { projectId, takenAt: new Date().toISOString() },
      attachments: [{
        localId: `${Date.now()}`,
        uri: a.uri,
        mime: a.mimeType ?? "image/jpeg",
        name: a.fileName ?? "photo.jpg",
      }],
    });
    await refresh();
    void syncNow();
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SyncStatusBar />
      <View style={{ padding: spacing(2), gap: spacing(1) }}>
        <ScrollView horizontal style={{ maxHeight: 44 }} contentContainerStyle={{ gap: spacing(1) }}>
          {projects.map((p) => (
            <Pressable
              key={p.id}
              onPress={() => setProjectId(p.id)}
              style={[styles.chip, projectId === p.id && { backgroundColor: colors.primary }]}
            >
              <Text style={styles.chipText}>{p.name ?? p.id}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <Pressable onPress={capture} style={styles.btn}>
          <Text style={styles.btnText}>Capture photo</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing(2), flexDirection: "row", flexWrap: "wrap", gap: spacing(1) }}>
        {pending.map((p) => {
          const a = p.attachments?.[0];
          return (
            <View key={p.localId} style={styles.thumbWrap}>
              {a ? <Image source={{ uri: a.uri }} style={styles.thumb} /> : null}
              <Text style={styles.thumbText}>{p.status}</Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { backgroundColor: colors.surface, paddingHorizontal: spacing(2), paddingVertical: spacing(1), borderRadius: 999 },
  chipText: { color: colors.text, fontSize: 12 },
  btn: { backgroundColor: colors.primary, padding: spacing(2), borderRadius: 8, alignItems: "center" },
  btnText: { color: "#fff", fontWeight: "600" },
  thumbWrap: { width: 100 },
  thumb: { width: 100, height: 100, borderRadius: 6, backgroundColor: colors.surface },
  thumbText: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
});
