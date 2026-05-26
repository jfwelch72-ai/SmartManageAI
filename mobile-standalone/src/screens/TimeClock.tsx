import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Location from "expo-location";
import { useNavigation, type NavigationProp } from "@react-navigation/native";

import { SyncStatusBar } from "@/components/SyncStatusBar";
import { useSync } from "@/sync/SyncContext";
import { enqueue, listOutbox } from "@/sync/outbox";
import { colors, spacing } from "@/theme";
import type { OutboxRecord } from "@/sync/types";

type TimeClockNavParamList = { LeaveRequests: undefined };

interface PunchPayload {
  kind: "IN" | "OUT";
  at: string;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
}

export function TimeClockScreen() {
  const { syncNow } = useSync();
  const nav = useNavigation<NavigationProp<TimeClockNavParamList>>();
  const [punches, setPunches] = useState<OutboxRecord[]>([]);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const all = await listOutbox();
    setPunches(all.filter((o) => o.entityType === "TIME_CLOCK_EVENT").reverse());
  }
  useEffect(() => { void refresh(); }, []);

  async function punch(kind: "IN" | "OUT") {
    setBusy(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      const loc = status === "granted" ? await Location.getCurrentPositionAsync({}) : null;
      await enqueue({
        entityType: "TIME_CLOCK_EVENT",
        operation: "CREATE",
        payload: {
          kind,
          at: new Date().toISOString(),
          latitude: loc?.coords.latitude,
          longitude: loc?.coords.longitude,
          accuracy: loc?.coords.accuracy,
        },
      });
      await refresh();
      void syncNow();
    } finally { setBusy(false); }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SyncStatusBar />
      <View style={{ flexDirection: "row", padding: spacing(2), gap: spacing(2) }}>
        <Pressable onPress={() => punch("IN")} disabled={busy} style={[styles.btn, { backgroundColor: colors.success }]}>
          <Text style={styles.btnText}>Clock In</Text>
        </Pressable>
        <Pressable onPress={() => punch("OUT")} disabled={busy} style={[styles.btn, { backgroundColor: colors.danger }]}>
          <Text style={styles.btnText}>Clock Out</Text>
        </Pressable>
      </View>
      <View style={{ paddingHorizontal: spacing(2), paddingBottom: spacing(1) }}>
        <Pressable
          onPress={() => nav.navigate("LeaveRequests")}
          style={[styles.btn, { backgroundColor: colors.surface }]}
          testID="button-request-leave"
        >
          <Text style={[styles.btnText, { color: colors.text }]}>Request time off (PTO / Sick)</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(1) }}>
        {punches.map((p) => {
          const pl = p.payload as Partial<PunchPayload>;
          const hasGps = typeof pl.latitude === "number" && typeof pl.longitude === "number";
          return (
            <View key={p.localId} style={styles.row}>
              <Text style={styles.rowTitle}>{pl.kind} — {pl.at ? new Date(pl.at).toLocaleString() : ""}</Text>
              <Text style={styles.rowSub}>
                {hasGps ? `${pl.latitude!.toFixed(4)}, ${pl.longitude!.toFixed(4)}` : "no GPS"} · {p.status}
              </Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  btn: { flex: 1, padding: spacing(2), borderRadius: 8, alignItems: "center" },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  row: { backgroundColor: colors.surface, padding: spacing(2), borderRadius: 8 },
  rowTitle: { color: colors.text, fontWeight: "600" },
  rowSub: { color: colors.textMuted, fontSize: 12 },
});
