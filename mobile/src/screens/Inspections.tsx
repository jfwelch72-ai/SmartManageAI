import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { SyncStatusBar } from "@/components/SyncStatusBar";
import { useSync } from "@/sync/SyncContext";
import { enqueue, listOutbox } from "@/sync/outbox";
import { colors, spacing } from "@/theme";
import type { OutboxRecord } from "@/sync/types";

const CHECKLIST = [
  "PPE worn on site",
  "Excavation barricaded",
  "Fall protection in use",
  "Fire extinguisher present",
  "First aid kit stocked",
  "Erosion controls intact",
];

export function InspectionsScreen() {
  const { syncNow } = useSync();
  const [answers, setAnswers] = useState<Record<string, "PASS" | "FAIL" | undefined>>({});
  const [items, setItems] = useState<OutboxRecord[]>([]);

  async function refresh() {
    const all = await listOutbox();
    setItems(all.filter((o) => o.entityType === "INSPECTION").reverse());
  }
  useEffect(() => { void refresh(); }, []);

  async function submit() {
    await enqueue({
      entityType: "INSPECTION",
      operation: "CREATE",
      payload: { answers, completedAt: new Date().toISOString() },
    });
    setAnswers({});
    await refresh();
    void syncNow();
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SyncStatusBar />
      <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(1) }}>
        {CHECKLIST.map((q) => (
          <View key={q} style={styles.row}>
            <Text style={[styles.rowTitle, { flex: 1 }]}>{q}</Text>
            <View style={{ flexDirection: "row", gap: spacing(1) }}>
              {(["PASS", "FAIL"] as const).map((v) => (
                <Pressable
                  key={v}
                  onPress={() => setAnswers((a) => ({ ...a, [q]: v }))}
                  style={[styles.chip, answers[q] === v && { backgroundColor: v === "PASS" ? colors.success : colors.danger }]}
                >
                  <Text style={styles.chipText}>{v}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ))}
        <Pressable onPress={submit} style={styles.btn}><Text style={styles.btnText}>Submit inspection</Text></Pressable>
        <Text style={{ color: colors.textMuted, marginTop: spacing(2) }}>Recent</Text>
        {items.map((i) => {
          const completedAt = typeof i.payload.completedAt === "string" ? i.payload.completedAt : i.clientTimestamp;
          return (
            <View key={i.localId} style={styles.row}>
              <Text style={styles.rowTitle}>{new Date(completedAt).toLocaleString()}</Text>
              <Text style={styles.rowSub}>{i.status}</Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { backgroundColor: colors.surface, padding: spacing(2), borderRadius: 8, flexDirection: "row", alignItems: "center" },
  rowTitle: { color: colors.text, fontWeight: "600" },
  rowSub: { color: colors.textMuted, fontSize: 12 },
  chip: { backgroundColor: colors.surfaceMuted, paddingHorizontal: spacing(2), paddingVertical: spacing(1), borderRadius: 6 },
  chipText: { color: colors.text, fontWeight: "600" },
  btn: { backgroundColor: colors.primary, padding: spacing(2), borderRadius: 8, alignItems: "center", marginTop: spacing(2) },
  btnText: { color: "#fff", fontWeight: "600" },
});
