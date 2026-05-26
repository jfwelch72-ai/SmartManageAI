import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { SyncStatusBar } from "@/components/SyncStatusBar";
import { useSync } from "@/sync/SyncContext";
import { listOutbox, resolveConflict } from "@/sync/outbox";
import { colors, spacing } from "@/theme";
import type { OutboxRecord } from "@/sync/types";

export function ConflictsScreen() {
  const { syncNow } = useSync();
  const [items, setItems] = useState<OutboxRecord[]>([]);

  async function refresh() {
    const all = await listOutbox();
    setItems(all.filter((o) => o.status === "CONFLICT"));
  }
  useEffect(() => { void refresh(); }, []);

  async function resolve(localId: string, kind: "LOCAL_WINS" | "SERVER_WINS") {
    await resolveConflict(localId, kind);
    await refresh();
    void syncNow();
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SyncStatusBar />
      <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(2) }}>
        {items.length === 0 ? (
          <Text style={{ color: colors.textMuted }}>No conflicts. Everything synced cleanly.</Text>
        ) : (
          items.map((c) => (
            <View key={c.localId} style={styles.card}>
              <Text style={styles.title}>{c.entityType}</Text>
              <Text style={styles.sub}>
                {c.conflictServerUpdatedAt
                  ? `Server updated at ${new Date(c.conflictServerUpdatedAt).toLocaleString()} (newer than your local copy from ${new Date(c.clientTimestamp).toLocaleString()}).`
                  : `Local copy from ${new Date(c.clientTimestamp).toLocaleString()} conflicts with the server.`}
              </Text>
              <Text style={styles.json} numberOfLines={6}>
                {JSON.stringify(c.payload, null, 2)}
              </Text>
              <View style={{ flexDirection: "row", gap: spacing(1) }}>
                <Pressable onPress={() => resolve(c.localId, "LOCAL_WINS")} style={[styles.btn, { backgroundColor: colors.warn }]}>
                  <Text style={styles.btnText}>Keep my changes</Text>
                </Pressable>
                <Pressable onPress={() => resolve(c.localId, "SERVER_WINS")} style={styles.btn}>
                  <Text style={styles.btnText}>Use server version</Text>
                </Pressable>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, padding: spacing(2), borderRadius: 10, gap: spacing(1) },
  title: { color: colors.text, fontWeight: "700" },
  sub: { color: colors.textMuted, fontSize: 12 },
  json: { color: colors.textMuted, fontFamily: "Courier", fontSize: 11 },
  btn: { flex: 1, backgroundColor: colors.primary, padding: spacing(2), borderRadius: 8, alignItems: "center" },
  btnText: { color: "#fff", fontWeight: "600" },
});
