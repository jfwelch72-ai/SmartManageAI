import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";

import { SyncStatusBar } from "@/components/SyncStatusBar";
import { useAuth } from "@/auth/AuthContext";
import { useSync } from "@/sync/SyncContext";
import { cacheList } from "@/sync/db";
import { getOverdueTaskCount } from "@/screens/Tasks";
import { colors, spacing } from "@/theme";
import type { NavigationProp } from "@react-navigation/native";

interface HomeProject {
  id: string;
  name?: string;
  title?: string;
  status?: string;
}

type HomeNavParamList = {
  Daily: undefined; Time: undefined; Photos: undefined; Punch: undefined; Tasks: undefined; Inventory: undefined;
  RFI: undefined; Submittals: undefined; Inspections: undefined; Drawings: undefined; Conflicts: undefined;
  ReportEquipmentIssue: undefined;
  HaulTickets: undefined;
  ReportIncident: undefined;
  NotificationSettings: undefined;
  TMTickets: undefined;
  RequestMaterial: undefined;
  EquipmentHours: undefined;
};

export function HomeScreen() {
  const { user, logout } = useAuth();
  const { lastResult } = useSync();
  const nav = useNavigation<NavigationProp<HomeNavParamList>>();
  const [projects, setProjects] = useState<HomeProject[]>([]);
  const [taskBadge, setTaskBadge] = useState(0);

  useEffect(() => {
    void cacheList<HomeProject>("PROJECT").then(setProjects);
    void getOverdueTaskCount(user?.id).then(setTaskBadge);
  }, [lastResult, user?.id]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SyncStatusBar />
      <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(2) }}>
        <Text style={styles.h1}>Hello, {user?.firstName ?? user?.email}</Text>

        <Pressable
          onPress={() => nav.navigate("ReportIncident")}
          style={[styles.tile, { backgroundColor: colors.danger, flexBasis: "100%" }]}
          testID="tile-report-incident"
        >
          <Text style={[styles.tileText, { color: "#fff", fontSize: 18 }]}>
            ⚠ Report Safety Incident
          </Text>
        </Pressable>

        <View style={styles.grid}>
          {([
            { label: "Daily Reports", to: "Daily" },
            { label: "Time Clock", to: "Time" },
            { label: "Photos", to: "Photos" },
            { label: "Punch List", to: "Punch" },
            { label: taskBadge > 0 ? `Tasks (${taskBadge})` : "Tasks", to: "Tasks" },
            { label: "Inventory", to: "Inventory" },
            { label: "Report Equipment Issue", to: "ReportEquipmentIssue" },
            { label: "T&M Tickets", to: "TMTickets" },
            { label: "Request Material", to: "RequestMaterial" },
            { label: "Equipment Hours", to: "EquipmentHours" },
            { label: "RFIs", to: "RFI" },
            { label: "Submittals", to: "Submittals" },
            { label: "Inspections", to: "Inspections" },
            { label: "Drawings", to: "Drawings" },
            { label: "Haul Tickets", to: "HaulTickets" },
            { label: "Conflicts", to: "Conflicts" },
            { label: "Notifications", to: "NotificationSettings" },
          ] as Array<{ label: string; to: keyof HomeNavParamList }>).map((tile) => (
            <Pressable key={tile.to} style={styles.tile} onPress={() => nav.navigate(tile.to)}>
              <Text style={styles.tileText}>{tile.label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.h2}>Recent Projects ({projects.length})</Text>
        {projects.slice(0, 10).map((p) => (
          <View key={p.id} style={styles.row}>
            <Text style={styles.rowTitle}>{p.name ?? p.title ?? p.id}</Text>
            <Text style={styles.rowSub}>{p.status ?? ""}</Text>
          </View>
        ))}

        <Pressable onPress={logout} style={[styles.tile, { backgroundColor: colors.surfaceMuted }]}>
          <Text style={styles.tileText}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  h1: { color: colors.text, fontSize: 22, fontWeight: "700" },
  h2: { color: colors.text, fontSize: 16, fontWeight: "600", marginTop: spacing(2) },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing(1) },
  tile: { backgroundColor: colors.surface, padding: spacing(2), borderRadius: 10, flexBasis: "48%", minHeight: 64, justifyContent: "center" },
  tileText: { color: colors.text, fontWeight: "600" },
  row: { backgroundColor: colors.surface, padding: spacing(2), borderRadius: 8 },
  rowTitle: { color: colors.text, fontWeight: "600" },
  rowSub: { color: colors.textMuted, fontSize: 12 },
});
