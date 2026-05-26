import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { SyncStatusBar } from "@/components/SyncStatusBar";
import { SignaturePad, type SignaturePadHandle } from "@/components/SignaturePad";
import { useSync } from "@/sync/SyncContext";
import { enqueue, listOutbox } from "@/sync/outbox";
import { cacheList } from "@/sync/db";
import { colors, spacing } from "@/theme";
import type { OutboxRecord } from "@/sync/types";
import type { CachedProject } from "./types";

interface LaborRow { id: string; worker: string; hours: string; rate: string; costCode: string; }
interface EquipmentRow { id: string; item: string; hours: string; rate: string; }
interface MaterialRow { id: string; item: string; qty: string; unit: string; unitCost: string; }

function newId(): string { return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

export function TMTicketsScreen() {
  const { syncNow, lastResult } = useSync();
  const sigRef = useRef<SignaturePadHandle | null>(null);
  const [projects, setProjects] = useState<CachedProject[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [labor, setLabor] = useState<LaborRow[]>([
    { id: newId(), worker: "", hours: "", rate: "", costCode: "" },
  ]);
  const [equipment, setEquipment] = useState<EquipmentRow[]>([]);
  const [material, setMaterial] = useState<MaterialRow[]>([]);
  const [notes, setNotes] = useState("");
  const [clientName, setClientName] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [tickets, setTickets] = useState<OutboxRecord[]>([]);

  async function refresh() {
    const all = await listOutbox();
    setTickets(all.filter((o) => o.entityType === "TM_TICKET").reverse());
  }

  useEffect(() => {
    void refresh();
    void cacheList<CachedProject>("PROJECT").then((p) => {
      setProjects(p);
      setProjectId((cur) => cur ?? p[0]?.id ?? null);
    });
  }, [lastResult]);

  function reset() {
    setLabor([{ id: newId(), worker: "", hours: "", rate: "", costCode: "" }]);
    setEquipment([]);
    setMaterial([]);
    setNotes("");
    setClientName("");
    sigRef.current?.clear();
  }

  async function submit() {
    setFeedback(null);
    if (!projectId) { setFeedback("Pick a project."); return; }
    const laborEntries = labor
      .filter((l) => l.worker.trim() && Number(l.hours) > 0)
      .map((l) => ({
        employeeName: l.worker.trim(),
        regularHours: Number(l.hours),
        rate: l.rate ? Number(l.rate) : 0,
        ...(l.costCode.trim() ? { position: l.costCode.trim() } : {}),
      }));
    const equipmentEntries = equipment
      .filter((e) => e.item.trim() && Number(e.hours) > 0)
      .map((e) => ({
        equipmentType: e.item.trim(),
        hours: Number(e.hours),
        rate: e.rate ? Number(e.rate) : 0,
        quantity: 1,
      }));
    const materialEntries = material
      .filter((m) => m.item.trim() && Number(m.qty) > 0)
      .map((m) => ({
        description: m.item.trim(),
        quantity: Number(m.qty),
        unit: m.unit.trim() || "EA",
        unitCost: m.unitCost ? Number(m.unitCost) : 0,
      }));
    if (laborEntries.length + equipmentEntries.length + materialEntries.length === 0) {
      setFeedback("Add at least one labor, equipment, or material line.");
      return;
    }
    const signatureDataUrl = sigRef.current?.export() ?? null;
    if (signatureDataUrl && !clientName.trim()) {
      setFeedback("Type the client's name next to the signature.");
      return;
    }

    setSubmitting(true);
    try {
      await enqueue({
        entityType: "TM_TICKET",
        operation: "CREATE",
        payload: {
          projectId,
          workDate: new Date().toISOString().slice(0, 10),
          scopeDescription: notes.trim() || "Field T&M ticket",
          notes: notes.trim() || undefined,
          laborEntries,
          equipmentEntries,
          materialEntries,
          ...(signatureDataUrl
            ? { signatureDataUrl, clientRepresentativeName: clientName.trim() }
            : {}),
        },
      });
      reset();
      await refresh();
      setFeedback("Queued — syncing now…");
      void syncNow();
    } finally {
      setSubmitting(false);
    }
  }

  const projectName = useMemo(() => {
    const p = projects.find((x) => x.id === projectId);
    return p?.name ?? projectId ?? "—";
  }, [projects, projectId]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SyncStatusBar />
      <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(2) }} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Project</Text>
        <View style={styles.chipRow}>
          {projects.length === 0 ? (
            <Text style={styles.muted}>No projects cached. Sync to load projects.</Text>
          ) : (
            projects.map((p) => (
              <Pressable
                key={p.id}
                onPress={() => setProjectId(p.id)}
                style={[styles.chip, projectId === p.id && styles.chipActive]}
                testID={`chip-tm-project-${p.id}`}
              >
                <Text style={[styles.chipText, projectId === p.id && styles.chipTextActive]}>
                  {p.name ?? p.id.slice(0, 8)}
                </Text>
              </Pressable>
            ))
          )}
        </View>

        <Section title="Labor">
          {labor.map((row, i) => (
            <View key={row.id} style={styles.rowCard} testID={`row-tm-labor-${row.id}`}>
              <TextInput
                placeholder="Worker name"
                placeholderTextColor={colors.textMuted}
                value={row.worker}
                onChangeText={(v: string) => setLabor((ls) => ls.map((l) => (l.id === row.id ? { ...l, worker: v } : l)))}
                style={styles.input}
                testID={`input-tm-labor-worker-${i}`}
              />
              <View style={styles.inline}>
                <TextInput placeholder="Hours" keyboardType="decimal-pad" placeholderTextColor={colors.textMuted}
                  value={row.hours}
                  onChangeText={(v: string) => setLabor((ls) => ls.map((l) => (l.id === row.id ? { ...l, hours: v } : l)))}
                  style={[styles.input, styles.flex1]}
                  testID={`input-tm-labor-hours-${i}`} />
                <TextInput placeholder="Rate $/hr" keyboardType="decimal-pad" placeholderTextColor={colors.textMuted}
                  value={row.rate}
                  onChangeText={(v: string) => setLabor((ls) => ls.map((l) => (l.id === row.id ? { ...l, rate: v } : l)))}
                  style={[styles.input, styles.flex1]}
                  testID={`input-tm-labor-rate-${i}`} />
              </View>
              <TextInput placeholder="Cost code (optional)" placeholderTextColor={colors.textMuted}
                value={row.costCode}
                onChangeText={(v: string) => setLabor((ls) => ls.map((l) => (l.id === row.id ? { ...l, costCode: v } : l)))}
                style={styles.input}
                testID={`input-tm-labor-cost-${i}`} />
              {labor.length > 1 ? (
                <Pressable onPress={() => setLabor((ls) => ls.filter((l) => l.id !== row.id))} style={styles.linkBtn}>
                  <Text style={styles.linkText}>Remove</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
          <Pressable
            onPress={() => setLabor((ls) => [...ls, { id: newId(), worker: "", hours: "", rate: "", costCode: "" }])}
            style={styles.addBtn}
            testID="button-tm-add-labor"
          ><Text style={styles.btnText}>+ Add labor row</Text></Pressable>
        </Section>

        <Section title="Equipment">
          {equipment.map((row, i) => (
            <View key={row.id} style={styles.rowCard} testID={`row-tm-equipment-${row.id}`}>
              <TextInput placeholder="Equipment" placeholderTextColor={colors.textMuted}
                value={row.item}
                onChangeText={(v: string) => setEquipment((es) => es.map((e) => (e.id === row.id ? { ...e, item: v } : e)))}
                style={styles.input}
                testID={`input-tm-equip-item-${i}`} />
              <View style={styles.inline}>
                <TextInput placeholder="Hours" keyboardType="decimal-pad" placeholderTextColor={colors.textMuted}
                  value={row.hours}
                  onChangeText={(v: string) => setEquipment((es) => es.map((e) => (e.id === row.id ? { ...e, hours: v } : e)))}
                  style={[styles.input, styles.flex1]}
                  testID={`input-tm-equip-hours-${i}`} />
                <TextInput placeholder="Rate $/hr" keyboardType="decimal-pad" placeholderTextColor={colors.textMuted}
                  value={row.rate}
                  onChangeText={(v: string) => setEquipment((es) => es.map((e) => (e.id === row.id ? { ...e, rate: v } : e)))}
                  style={[styles.input, styles.flex1]}
                  testID={`input-tm-equip-rate-${i}`} />
              </View>
              <Pressable onPress={() => setEquipment((es) => es.filter((e) => e.id !== row.id))} style={styles.linkBtn}>
                <Text style={styles.linkText}>Remove</Text>
              </Pressable>
            </View>
          ))}
          <Pressable
            onPress={() => setEquipment((es) => [...es, { id: newId(), item: "", hours: "", rate: "" }])}
            style={styles.addBtn}
            testID="button-tm-add-equipment"
          ><Text style={styles.btnText}>+ Add equipment row</Text></Pressable>
        </Section>

        <Section title="Material">
          {material.map((row, i) => (
            <View key={row.id} style={styles.rowCard} testID={`row-tm-material-${row.id}`}>
              <TextInput placeholder="Material" placeholderTextColor={colors.textMuted}
                value={row.item}
                onChangeText={(v: string) => setMaterial((ms) => ms.map((m) => (m.id === row.id ? { ...m, item: v } : m)))}
                style={styles.input}
                testID={`input-tm-mat-item-${i}`} />
              <View style={styles.inline}>
                <TextInput placeholder="Qty" keyboardType="decimal-pad" placeholderTextColor={colors.textMuted}
                  value={row.qty}
                  onChangeText={(v: string) => setMaterial((ms) => ms.map((m) => (m.id === row.id ? { ...m, qty: v } : m)))}
                  style={[styles.input, styles.flex1]}
                  testID={`input-tm-mat-qty-${i}`} />
                <TextInput placeholder="Unit (EA)" placeholderTextColor={colors.textMuted}
                  value={row.unit}
                  onChangeText={(v: string) => setMaterial((ms) => ms.map((m) => (m.id === row.id ? { ...m, unit: v } : m)))}
                  style={[styles.input, styles.flex1]}
                  testID={`input-tm-mat-unit-${i}`} />
                <TextInput placeholder="$ / unit" keyboardType="decimal-pad" placeholderTextColor={colors.textMuted}
                  value={row.unitCost}
                  onChangeText={(v: string) => setMaterial((ms) => ms.map((m) => (m.id === row.id ? { ...m, unitCost: v } : m)))}
                  style={[styles.input, styles.flex1]}
                  testID={`input-tm-mat-cost-${i}`} />
              </View>
              <Pressable onPress={() => setMaterial((ms) => ms.filter((m) => m.id !== row.id))} style={styles.linkBtn}>
                <Text style={styles.linkText}>Remove</Text>
              </Pressable>
            </View>
          ))}
          <Pressable
            onPress={() => setMaterial((ms) => [...ms, { id: newId(), item: "", qty: "", unit: "EA", unitCost: "" }])}
            style={styles.addBtn}
            testID="button-tm-add-material"
          ><Text style={styles.btnText}>+ Add material row</Text></Pressable>
        </Section>

        <Section title="Notes / scope">
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="Describe the work performed"
            placeholderTextColor={colors.textMuted}
            multiline
            style={[styles.input, { minHeight: 72 }]}
            testID="input-tm-notes"
          />
        </Section>

        <Section title="Client sign-off">
          <TextInput
            value={clientName}
            onChangeText={setClientName}
            placeholder="Client representative name"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            testID="input-tm-client-name"
          />
          <Text style={styles.muted}>Sign below with your finger:</Text>
          <SignaturePad ref={sigRef} />
          <Pressable onPress={() => sigRef.current?.clear()} style={styles.linkBtn} testID="button-tm-clear-signature">
            <Text style={styles.linkText}>Clear signature</Text>
          </Pressable>
        </Section>

        {feedback ? <Text style={styles.feedback} testID="text-tm-feedback">{feedback}</Text> : null}

        <Pressable
          onPress={() => void submit()}
          disabled={submitting}
          style={[styles.btn, submitting && { opacity: 0.6 }]}
          testID="button-tm-submit"
        >
          <Text style={styles.btnText}>{submitting ? "Saving…" : `Submit ticket for ${projectName}`}</Text>
        </Pressable>

        <Text style={styles.section}>This device</Text>
        {tickets.length === 0 ? (
          <Text style={styles.muted}>No tickets on this device yet.</Text>
        ) : (
          tickets.map((t) => {
            const p = t.payload as { projectId?: string; clientRepresentativeName?: string; workDate?: string };
            const proj = projects.find((x) => x.id === p.projectId);
            const status =
              t.status === "SYNCED" ? "Synced" :
              t.status === "CONFLICT" ? "Conflict" :
              t.status === "FAILED" ? `Failed (${t.retryCount})` :
              "Pending";
            return (
              <View key={t.localId} style={styles.row} testID={`row-tm-ticket-${t.localId}`}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{proj?.name ?? p.projectId ?? "(no project)"}</Text>
                  <Text style={styles.rowSub}>
                    {p.workDate ?? new Date(t.clientTimestamp).toISOString().slice(0, 10)}
                    {p.clientRepresentativeName ? ` · signed by ${p.clientRepresentativeName}` : ""}
                  </Text>
                  {t.lastError ? <Text style={styles.errText} numberOfLines={2}>{t.lastError}</Text> : null}
                </View>
                <Text style={styles.statusPill}>{status}</Text>
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: spacing(1) }}>
      <Text style={styles.section}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { color: colors.text, fontWeight: "600" },
  muted: { color: colors.textMuted },
  section: { color: colors.textMuted, fontSize: 12, fontWeight: "700", textTransform: "uppercase", marginTop: spacing(1) },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing(1) },
  chip: { backgroundColor: colors.surface, paddingHorizontal: spacing(2), paddingVertical: spacing(1), borderRadius: 16 },
  chipActive: { backgroundColor: colors.primary },
  chipText: { color: colors.text },
  chipTextActive: { color: "#fff", fontWeight: "600" },
  input: { backgroundColor: colors.surface, color: colors.text, padding: spacing(2), borderRadius: 8 },
  inline: { flexDirection: "row", gap: spacing(1) },
  flex1: { flex: 1 },
  rowCard: { backgroundColor: colors.surface, padding: spacing(2), borderRadius: 10, gap: spacing(1) },
  btn: { backgroundColor: colors.primary, padding: spacing(2), borderRadius: 8, alignItems: "center" },
  btnText: { color: "#fff", fontWeight: "600" },
  addBtn: { backgroundColor: colors.surface, padding: spacing(2), borderRadius: 8, alignItems: "center", borderWidth: 1, borderColor: colors.border, borderStyle: "dashed" },
  linkBtn: { alignSelf: "flex-start", paddingVertical: spacing(1) },
  linkText: { color: colors.primary, fontWeight: "600" },
  feedback: { color: colors.text, backgroundColor: colors.surface, padding: spacing(2), borderRadius: 8 },
  row: { backgroundColor: colors.surface, padding: spacing(2), borderRadius: 8, flexDirection: "row", alignItems: "center", gap: spacing(1) },
  rowTitle: { color: colors.text, fontWeight: "600" },
  rowSub: { color: colors.textMuted, fontSize: 12 },
  errText: { color: colors.danger, fontSize: 11, marginTop: 2 },
  statusPill: { color: colors.text, backgroundColor: colors.surfaceMuted, paddingHorizontal: spacing(1), paddingVertical: 2, borderRadius: 4, fontSize: 11, fontWeight: "600" },
});
