import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { SyncStatusBar } from "@/components/SyncStatusBar";
import { useSync } from "@/sync/SyncContext";
import { enqueue, listOutbox } from "@/sync/outbox";
import { colors, spacing } from "@/theme";
import type { OutboxRecord } from "@/sync/types";
import type { PunchListItem } from "./types";

export function PunchListScreen() {
  const { syncNow } = useSync();
  const [items, setItems] = useState<OutboxRecord[]>([]);
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState("");

  async function refresh() {
    const all = await listOutbox();
    setItems(all.filter((o) => o.entityType === "PUNCH_ITEM").reverse());
  }
  useEffect(() => { void refresh(); }, []);

  async function add() {
    if (!title.trim()) return;
    await enqueue({
      entityType: "PUNCH_ITEM",
      operation: "CREATE",
      payload: { title, assignee, status: "OPEN", createdAt: new Date().toISOString() },
    });
    setTitle(""); setAssignee("");
    await refresh();
    void syncNow();
  }

  async function complete(_localId: string, payload: PunchListItem) {
    await enqueue({
      entityType: "PUNCH_ITEM",
      operation: "UPDATE",
      serverId: typeof payload.id === "string" ? payload.id : undefined,
      payload: { ...payload, status: "DONE", completedAt: new Date().toISOString() },
    });
    await refresh();
    void syncNow();
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SyncStatusBar />
      <View style={{ padding: spacing(2), gap: spacing(1) }}>
        <TextInput placeholder="Item title" placeholderTextColor={colors.textMuted}
          value={title} onChangeText={setTitle} style={styles.input} />
        <TextInput placeholder="Assignee" placeholderTextColor={colors.textMuted}
          value={assignee} onChangeText={setAssignee} style={styles.input} />
        <Pressable onPress={add} style={styles.btn}><Text style={styles.btnText}>Add punch item</Text></Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(1) }}>
        {items.map((i) => {
          const p = i.payload as PunchListItem;
          return (
            <View key={i.localId} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{p.title}</Text>
                <Text style={styles.rowSub}>{String(p.assignee ?? "")} · {p.status} · {i.status}</Text>
              </View>
              {p.status !== "DONE" ? (
                <Pressable onPress={() => complete(i.localId, p)} style={styles.smallBtn}>
                  <Text style={styles.btnText}>Done</Text>
                </Pressable>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  input: { backgroundColor: colors.surface, color: colors.text, padding: spacing(2), borderRadius: 8 },
  btn: { backgroundColor: colors.primary, padding: spacing(2), borderRadius: 8, alignItems: "center" },
  smallBtn: { backgroundColor: colors.success, paddingHorizontal: spacing(2), paddingVertical: spacing(1), borderRadius: 6 },
  btnText: { color: "#fff", fontWeight: "600" },
  row: { backgroundColor: colors.surface, padding: spacing(2), borderRadius: 8, flexDirection: "row", alignItems: "center", gap: spacing(1) },
  rowTitle: { color: colors.text, fontWeight: "600" },
  rowSub: { color: colors.textMuted, fontSize: 12 },
});
