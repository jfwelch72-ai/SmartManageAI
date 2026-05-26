import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { SyncStatusBar } from "@/components/SyncStatusBar";
import { useSync } from "@/sync/SyncContext";
import { enqueue, listOutbox } from "@/sync/outbox";
import { cacheList } from "@/sync/db";
import { colors, spacing } from "@/theme";

type ServerRfi = {
  id: string;
  rfiNumber?: string;
  subject?: string;
  question?: string;
  status?: string;
  updatedAt?: string;
};

type DraftRfi = {
  localId: string;
  subject: string;
  question: string;
  status: string;
};

export function RFIScreen() {
  const { syncNow, lastResult } = useSync();
  const [drafts, setDrafts] = useState<DraftRfi[]>([]);
  const [server, setServer] = useState<ServerRfi[]>([]);
  const [subject, setSubject] = useState("");
  const [question, setQuestion] = useState("");

  // Drafts: pull from outbox so the user always sees what they queued.
  // Server-backed list: pulled by the sync coordinator into the SQLite cache
  // (entityType=RFI), surfaced here so the screen behaves like a real RFI
  // inbox even before the queued create round-trips.
  async function refresh() {
    const all = await listOutbox();
    setDrafts(
      all
        .filter((o) => o.entityType === "RFI")
        .map((o) => {
          const p = (o.payload ?? {}) as { subject?: string; question?: string };
          return {
            localId: o.localId,
            subject: p.subject ?? "(no subject)",
            question: p.question ?? "",
            status: o.status,
          };
        })
        .reverse()
    );
    setServer(await cacheList<ServerRfi>("RFI"));
  }
  useEffect(() => { void refresh(); }, [lastResult]);

  async function send() {
    if (!subject.trim()) return;
    await enqueue({
      entityType: "RFI",
      operation: "CREATE",
      payload: { subject, question, createdAt: new Date().toISOString() },
    });
    setSubject(""); setQuestion("");
    await refresh();
    void syncNow();
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SyncStatusBar />
      <View style={{ padding: spacing(2), gap: spacing(1) }}>
        <TextInput placeholder="Subject" placeholderTextColor={colors.textMuted}
          value={subject} onChangeText={setSubject} style={styles.input} testID="input-rfi-subject" />
        <TextInput placeholder="Question" placeholderTextColor={colors.textMuted}
          multiline value={question} onChangeText={setQuestion} style={[styles.input, { minHeight: 80 }]} testID="input-rfi-question" />
        <Pressable onPress={send} style={styles.btn} testID="button-submit-rfi"><Text style={styles.btnText}>Submit RFI</Text></Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(1) }}>
        {drafts.length > 0 ? (
          <Text style={styles.section}>Pending sync</Text>
        ) : null}
        {drafts.map((d) => (
          <View key={d.localId} style={styles.row} testID={`row-rfi-draft-${d.localId}`}>
            <Text style={styles.rowTitle}>{d.subject}</Text>
            <Text style={styles.rowSub}>{d.status}</Text>
          </View>
        ))}
        <Text style={styles.section}>Project RFIs</Text>
        {server.length === 0 ? (
          <Text style={{ color: colors.textMuted }}>No RFIs synced yet</Text>
        ) : (
          server.map((r) => (
            <View key={r.id} style={styles.row} testID={`row-rfi-${r.id}`}>
              <Text style={styles.rowTitle}>
                {r.rfiNumber ? `${r.rfiNumber} — ` : ""}{r.subject ?? "(untitled)"}
              </Text>
              <Text style={styles.rowSub} numberOfLines={2}>{r.question ?? ""}</Text>
              {r.status ? <Text style={styles.rowSub}>{r.status}</Text> : null}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  input: { backgroundColor: colors.surface, color: colors.text, padding: spacing(2), borderRadius: 8 },
  btn: { backgroundColor: colors.primary, padding: spacing(2), borderRadius: 8, alignItems: "center" },
  btnText: { color: "#fff", fontWeight: "600" },
  row: { backgroundColor: colors.surface, padding: spacing(2), borderRadius: 8 },
  rowTitle: { color: colors.text, fontWeight: "600" },
  rowSub: { color: colors.textMuted, fontSize: 12 },
  section: { color: colors.textMuted, fontSize: 12, fontWeight: "600", marginTop: spacing(1), textTransform: "uppercase" },
});
