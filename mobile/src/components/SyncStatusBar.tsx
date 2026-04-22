import React from "react";
import { Pressable, StyleSheet, Text, View, ActivityIndicator } from "react-native";
import { useSync } from "@/sync/SyncContext";
import { colors, spacing } from "@/theme";

export function SyncStatusBar() {
  const { online, pending, syncing, syncNow } = useSync();
  const label = !online
    ? "Offline"
    : syncing
    ? "Syncing…"
    : pending > 0
    ? `${pending} pending`
    : "Up to date";
  const dotColor = !online ? colors.danger : pending > 0 ? colors.warn : colors.success;
  return (
    <Pressable onPress={syncNow} style={styles.row}>
      <View style={[styles.dot, { backgroundColor: dotColor }]} />
      <Text style={styles.text}>{label}</Text>
      {syncing ? <ActivityIndicator size="small" color={colors.text} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(1),
    paddingVertical: spacing(1),
    paddingHorizontal: spacing(2),
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: spacing(1) },
  text: { color: colors.text, fontSize: 13, flex: 1 },
});
