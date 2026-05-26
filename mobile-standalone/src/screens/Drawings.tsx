import React, { useEffect, useRef, useState } from "react";
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { GestureDetector, Gesture, GestureHandlerRootView } from "react-native-gesture-handler";
import Svg, { Path } from "react-native-svg";

import { SyncStatusBar } from "@/components/SyncStatusBar";
import { cacheList, cachePut } from "@/sync/db";
import { enqueue, listOutbox } from "@/sync/outbox";
import { useSync } from "@/sync/SyncContext";
import { colors, spacing } from "@/theme";
import type { OutboxRecord } from "@/sync/types";

type Drawing = {
  id: string;
  name?: string;
  sheetNumber?: string;
  // Cached rendition for offline viewing. The web app populates one of
  // these when sheets are made available offline; the mobile viewer
  // renders the first one it finds. PDFs that have been pre-rasterised
  // server-side land in `imageUrl`; raw image sheets land in `uri`.
  imageUrl?: string;
  uri?: string;
  width?: number;
  height?: number;
};

type CachedMarkup = {
  id: string;
  drawingId: string;
  drawingName?: string;
  createdAt: string;
  status?: string;
};

// Each markup stroke is a list of {x,y} coordinates in screen-relative
// space. Persisting screen-space is fine for now: when drawings get a
// real PDF/raster viewer, this stroke list maps trivially onto image
// coordinates by storing the viewer's transform alongside the stroke.
type Stroke = Array<{ x: number; y: number }>;

export function DrawingsScreen() {
  const { syncNow, lastResult } = useSync();
  const [docs, setDocs] = useState<Drawing[]>([]);
  const [markups, setMarkups] = useState<Array<CachedMarkup & { pendingStatus?: string }>>([]);
  const [active, setActive] = useState<Drawing | null>(null);

  async function refresh(): Promise<void> {
    const [d, cached, outbox] = await Promise.all([
      cacheList<Drawing>("DRAWING"),
      cacheList<CachedMarkup>("DRAWING_MARKUP"),
      listOutbox(),
    ]);
    setDocs(d);
    // Merge cached markups with their current outbox status so the user sees
    // PENDING / SYNCED / FAILED next to each markup they've drawn.
    const statusByLocalId = new Map<string, OutboxRecord["status"]>();
    for (const o of outbox) {
      if (o.entityType === "DRAWING_MARKUP") statusByLocalId.set(o.localId, o.status);
    }
    setMarkups(
      cached
        .map((m) => ({ ...m, pendingStatus: statusByLocalId.get(m.id) ?? m.status }))
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    );
  }

  useEffect(() => { void refresh(); }, [lastResult]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SyncStatusBar />
      <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(1) }}>
        <Text style={{ color: colors.textMuted, marginBottom: spacing(1) }}>
          Drawing sheets cached for offline viewing. Tap a sheet to open the markup viewer.
        </Text>
        {docs.length === 0 ? (
          <Text style={{ color: colors.textMuted }}>
            No drawings cached yet. Open the project on the web to make sheets available offline.
          </Text>
        ) : (
          docs.map((d) => (
            <Pressable key={d.id} style={styles.row} onPress={() => setActive(d)} testID={`button-drawing-${d.id}`}>
              <Text style={styles.rowTitle}>{d.name ?? d.id}</Text>
              <Text style={styles.rowSub}>{d.sheetNumber ?? ""}</Text>
            </Pressable>
          ))
        )}
        {markups.length > 0 ? (
          <>
            <Text style={{ color: colors.text, fontWeight: "600", marginTop: spacing(2) }}>
              Recent markups
            </Text>
            {markups.map((m) => (
              <View key={m.id} style={styles.row} testID={`row-markup-${m.id}`}>
                <Text style={styles.rowTitle}>{m.drawingName ?? m.drawingId}</Text>
                <Text style={styles.rowSub}>
                  {new Date(m.createdAt).toLocaleString()} · {m.pendingStatus ?? "SYNCED"}
                </Text>
              </View>
            ))}
          </>
        ) : null}
      </ScrollView>
      <Modal visible={!!active} animationType="slide" onRequestClose={() => setActive(null)}>
        {active ? (
          <DrawingMarkup
            drawing={active}
            onClose={() => setActive(null)}
            onSave={async (strokes) => {
              const createdAt = new Date().toISOString();
              const rec = await enqueue({
                entityType: "DRAWING_MARKUP",
                operation: "CREATE",
                payload: {
                  drawingId: active.id,
                  drawingName: active.name,
                  strokes,
                  createdAt,
                },
              });
              await cachePut(
                "DRAWING_MARKUP",
                rec.localId,
                {
                  id: rec.localId,
                  drawingId: active.id,
                  drawingName: active.name,
                  createdAt,
                  status: "PENDING",
                },
                createdAt
              );
              await refresh();
              setActive(null);
              void syncNow();
            }}
          />
        ) : null}
      </Modal>
    </View>
  );
}

function DrawingMarkup({
  drawing, onSave, onClose,
}: {
  drawing: Drawing;
  onSave: (strokes: Stroke[]) => Promise<void> | void;
  onClose: () => void;
}) {
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const currentRef = useRef<Stroke>([]);
  const [, force] = useState(0);

  // Pan gesture captures freehand markup. Each new touch starts a new
  // stroke; subsequent updates append points; touch-end commits the stroke.
  const pan = Gesture.Pan()
    .onBegin((e) => {
      currentRef.current = [{ x: e.x, y: e.y }];
      force((n) => n + 1);
    })
    .onUpdate((e) => {
      currentRef.current.push({ x: e.x, y: e.y });
      force((n) => n + 1);
    })
    .onEnd(() => {
      if (currentRef.current.length > 1) {
        setStrokes((prev) => [...prev, currentRef.current]);
      }
      currentRef.current = [];
    })
    .runOnJS(true);

  const toPath = (s: Stroke): string =>
    s.length === 0
      ? ""
      : s.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: "#111" }}>
      <View style={styles.toolbar}>
        <Pressable onPress={onClose} testID="button-drawing-close"><Text style={styles.toolText}>Close</Text></Pressable>
        <Text style={styles.toolTitle} numberOfLines={1}>{drawing.name ?? drawing.id}</Text>
        <Pressable onPress={() => setStrokes([])} testID="button-drawing-clear"><Text style={styles.toolText}>Clear</Text></Pressable>
        <Pressable onPress={() => void onSave(strokes)} testID="button-drawing-save"><Text style={styles.toolText}>Save</Text></Pressable>
      </View>
      <GestureDetector gesture={pan}>
        <View style={{ flex: 1 }}>
          {drawing.imageUrl || drawing.uri ? (
            <Image
              source={{ uri: drawing.imageUrl ?? drawing.uri! }}
              style={StyleSheet.absoluteFill}
              resizeMode="contain"
              testID={`img-drawing-${drawing.id}`}
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.placeholder]}>
              <Text style={styles.placeholderText}>
                Sheet not cached for offline viewing.
              </Text>
              <Text style={styles.placeholderSub}>
                Open this sheet on the web to make it available offline.
              </Text>
            </View>
          )}
          <Svg style={StyleSheet.absoluteFill}>
            {strokes.map((s, i) => (
              <Path key={i} d={toPath(s)} stroke="#22c55e" strokeWidth={3} fill="none" />
            ))}
            {currentRef.current.length > 1 ? (
              <Path d={toPath(currentRef.current)} stroke="#22c55e" strokeWidth={3} fill="none" />
            ) : null}
          </Svg>
        </View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  row: { backgroundColor: colors.surface, padding: spacing(2), borderRadius: 8 },
  rowTitle: { color: colors.text, fontWeight: "600" },
  rowSub: { color: colors.textMuted, fontSize: 12 },
  toolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing(2), backgroundColor: "#000", gap: spacing(2) },
  toolText: { color: "#fff", fontWeight: "600" },
  toolTitle: { color: "#fff", flex: 1, textAlign: "center" },
  placeholder: { alignItems: "center", justifyContent: "center", padding: spacing(3) },
  placeholderText: { color: "#fff", fontWeight: "600", textAlign: "center" },
  placeholderSub: { color: "#9ca3af", marginTop: spacing(1), textAlign: "center" },
});
