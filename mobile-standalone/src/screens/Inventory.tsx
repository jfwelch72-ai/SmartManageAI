import React, { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useNavigation, type NavigationProp } from "@react-navigation/native";

import { SyncStatusBar } from "@/components/SyncStatusBar";
import { listOutbox } from "@/sync/outbox";
import { useSync } from "@/sync/SyncContext";
import { colors, spacing } from "@/theme";
import type { OutboxRecord, SyncEntityType } from "@/sync/types";

type InventoryStack = {
  Inventory: undefined;
  InventoryScan: undefined;
};

const INVENTORY_TYPES: ReadonlySet<SyncEntityType> = new Set([
  "INVENTORY_RECEIPT",
  "INVENTORY_ISSUE",
  "INVENTORY_TRANSFER",
]);

const LABEL: Record<string, string> = {
  INVENTORY_RECEIPT: "Receipt",
  INVENTORY_ISSUE: "Issue",
  INVENTORY_TRANSFER: "Transfer",
};

export function InventoryScreen() {
  const nav = useNavigation<NavigationProp<InventoryStack>>();
  const { syncNow } = useSync();
  const [items, setItems] = useState<OutboxRecord[]>([]);

  const refresh = useCallback(async () => {
    const all = await listOutbox();
    setItems(all.filter((o) => INVENTORY_TYPES.has(o.entityType)).reverse().slice(0, 30));
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SyncStatusBar />
      <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(2) }}>
        <Pressable
          onPress={() => nav.navigate("InventoryScan")}
          style={styles.scanBtn}
          testID="button-scan"
        >
          <Text style={styles.scanBtnText}>Scan barcode / QR</Text>
          <Text style={styles.scanBtnSub}>Look up SKU, then receive, issue, or transfer</Text>
        </Pressable>

        <Pressable
          onPress={() => void syncNow()}
          style={[styles.scanBtn, { backgroundColor: colors.surface }]}
        >
          <Text style={[styles.scanBtnText, { color: colors.text }]}>Sync now</Text>
        </Pressable>

        <Text style={styles.h2}>Recent inventory activity</Text>
        {items.length === 0 ? (
          <Text style={styles.muted}>Scanned receipts, issues, and transfers will show up here.</Text>
        ) : (
          items.map((i) => {
            const p = i.payload as Record<string, unknown>;
            const qty = p.quantity ?? "—";
            return (
              <View key={i.localId} style={styles.row} testID={`row-txn-${i.localId}`}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{LABEL[i.entityType] ?? i.entityType} · {String(qty)}</Text>
                  <Text style={styles.rowSub}>
                    {new Date(i.clientTimestamp).toLocaleString()} · {i.status}
                    {i.lastError ? ` · ${i.lastError}` : ""}
                  </Text>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  scanBtn: { backgroundColor: colors.primary, padding: spacing(3), borderRadius: 12, alignItems: "center", gap: spacing(1) },
  scanBtnText: { color: "#fff", fontWeight: "700", fontSize: 18 },
  scanBtnSub: { color: "#dbeafe", fontSize: 12 },
  h2: { color: colors.text, fontSize: 16, fontWeight: "600", marginTop: spacing(1) },
  muted: { color: colors.textMuted },
  row: { backgroundColor: colors.surface, padding: spacing(2), borderRadius: 8, flexDirection: "row" },
  rowTitle: { color: colors.text, fontWeight: "600" },
  rowSub: { color: colors.textMuted, fontSize: 12 },
});
