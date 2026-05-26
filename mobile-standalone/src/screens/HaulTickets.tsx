import React, { useEffect, useMemo, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";

import { SyncStatusBar } from "@/components/SyncStatusBar";
import { useSync } from "@/sync/SyncContext";
import { enqueue, listOutbox } from "@/sync/outbox";
import { cacheList } from "@/sync/db";
import { colors, spacing } from "@/theme";
import type { OutboxRecord } from "@/sync/types";
import type { CachedProject } from "./types";

const MATERIALS = ["Asphalt", "Base Rock", "Topsoil", "Fill", "Concrete", "Spoil", "Riprap"] as const;
const UNITS = ["TON", "CY", "LOADS"] as const;
type Unit = (typeof UNITS)[number];

interface PendingPhoto {
  localId: string;
  uri: string;
  mime: string;
  name: string;
}

interface HaulTicketPayload {
  projectId?: string | null;
  ticketNumber?: string;
  ticketDate?: string;
  recordedAt?: string;
  materialClass?: string;
  truckNumber?: string;
  source?: string;
  destination?: string;
  sourceStation?: string;
  destinationStation?: string;
  quantity?: number;
  unit?: Unit;
  notes?: string;
  status?: string;
  [k: string]: unknown;
}

export function HaulTicketsScreen() {
  const { syncNow } = useSync();
  const [projects, setProjects] = useState<CachedProject[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [items, setItems] = useState<OutboxRecord[]>([]);

  const [ticketNumber, setTicketNumber] = useState("");
  const [material, setMaterial] = useState<string>(MATERIALS[0]);
  const [truck, setTruck] = useState("");
  const [source, setSource] = useState("");
  const [sourceStation, setSourceStation] = useState("");
  const [destination, setDestination] = useState("");
  const [destinationStation, setDestinationStation] = useState("");
  const [quantity, setQuantity] = useState<number>(1);
  const [unit, setUnit] = useState<Unit>("TON");
  const [notes, setNotes] = useState("");
  const [photo, setPhoto] = useState<PendingPhoto | null>(null);

  async function refresh() {
    const all = await listOutbox();
    setItems(all.filter((o) => o.entityType === "HAUL_TICKET").reverse());
  }

  useEffect(() => {
    void refresh();
    void cacheList<CachedProject>("PROJECT").then((p) => {
      setProjects(p);
      setProjectId((cur) => cur ?? p[0]?.id ?? null);
    });
  }, []);

  async function capturePhoto() {
    const pic = await ImagePicker.launchCameraAsync({ quality: 0.6 });
    if (pic.canceled) return;
    const a = pic.assets[0];
    setPhoto({
      localId: `haul-photo-${Date.now()}`,
      uri: a.uri,
      mime: a.mimeType ?? "image/jpeg",
      name: a.fileName ?? `haul-${Date.now()}.jpg`,
    });
  }

  function adjustQty(delta: number) {
    setQuantity((q) => {
      const next = Math.max(0, Math.round((q + delta) * 100) / 100);
      return next;
    });
  }

  function reset() {
    setTicketNumber("");
    setTruck("");
    setSource("");
    setSourceStation("");
    setDestination("");
    setDestinationStation("");
    setQuantity(1);
    setNotes("");
    setPhoto(null);
  }

  async function save() {
    if (!projectId || !ticketNumber.trim() || quantity <= 0) return;
    const now = new Date();
    const payload: HaulTicketPayload = {
      projectId,
      ticketNumber: ticketNumber.trim(),
      ticketDate: now.toISOString().slice(0, 10),
      recordedAt: now.toISOString(),
      materialClass: material,
      truckNumber: truck.trim() || undefined,
      source: source.trim() || undefined,
      sourceStation: sourceStation.trim() || undefined,
      destination: destination.trim() || undefined,
      destinationStation: destinationStation.trim() || undefined,
      quantity,
      unit,
      notes: notes.trim() || undefined,
      status: "SUBMITTED",
    };
    await enqueue({
      entityType: "HAUL_TICKET",
      operation: "CREATE",
      payload: payload as Record<string, unknown>,
      attachments: photo ? [photo] : undefined,
    });
    reset();
    await refresh();
    void syncNow();
  }

  const todayTotals = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const totals: Partial<Record<Unit, number>> = {};
    let count = 0;
    for (const rec of items) {
      const p = rec.payload as HaulTicketPayload;
      if (p.ticketDate !== today) continue;
      const u = (p.unit as Unit) ?? "TON";
      totals[u] = (totals[u] ?? 0) + (Number(p.quantity) || 0);
      count++;
    }
    return { totals, count };
  }, [items]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SyncStatusBar />
      <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(1) }}>
        <Text style={styles.label}>Project</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing(1) }}>
          {projects.map((p) => (
            <Pressable
              key={p.id}
              onPress={() => setProjectId(p.id)}
              style={[styles.chip, projectId === p.id && styles.chipActive]}
              testID={`chip-project-${p.id}`}
            >
              <Text style={[styles.chipText, projectId === p.id && styles.chipTextActive]}>{p.name ?? p.id}</Text>
            </Pressable>
          ))}
          {projects.length === 0 ? (
            <Text style={{ color: colors.textMuted }}>No projects cached</Text>
          ) : null}
        </ScrollView>

        <Text style={styles.label}>Material</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing(1) }}>
          {MATERIALS.map((m) => (
            <Pressable
              key={m}
              onPress={() => setMaterial(m)}
              style={[styles.chip, material === m && styles.chipActive]}
              testID={`chip-material-${m}`}
            >
              <Text style={[styles.chipText, material === m && styles.chipTextActive]}>{m}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <TextInput
          placeholder="Ticket number"
          placeholderTextColor={colors.textMuted}
          value={ticketNumber}
          onChangeText={setTicketNumber}
          style={styles.input}
          testID="input-ticket-number"
        />

        <TextInput
          placeholder="Truck / unit #"
          placeholderTextColor={colors.textMuted}
          value={truck}
          onChangeText={setTruck}
          style={styles.input}
          testID="input-truck"
        />

        <View style={styles.row}>
          <TextInput
            placeholder="Source location"
            placeholderTextColor={colors.textMuted}
            value={source}
            onChangeText={setSource}
            style={[styles.input, { flex: 2 }]}
            testID="input-source"
          />
          <TextInput
            placeholder="STA (e.g. 12+50)"
            placeholderTextColor={colors.textMuted}
            value={sourceStation}
            onChangeText={setSourceStation}
            style={[styles.input, { flex: 1 }]}
            testID="input-source-station"
            autoCapitalize="characters"
          />
        </View>

        <View style={styles.row}>
          <TextInput
            placeholder="Destination location"
            placeholderTextColor={colors.textMuted}
            value={destination}
            onChangeText={setDestination}
            style={[styles.input, { flex: 2 }]}
            testID="input-destination"
          />
          <TextInput
            placeholder="STA (e.g. 18+25)"
            placeholderTextColor={colors.textMuted}
            value={destinationStation}
            onChangeText={setDestinationStation}
            style={[styles.input, { flex: 1 }]}
            testID="input-destination-station"
            autoCapitalize="characters"
          />
        </View>

        <Text style={styles.label}>Quantity</Text>
        <View style={styles.row}>
          <Pressable onPress={() => adjustQty(-1)} style={styles.stepBtn} testID="button-qty-minus">
            <Text style={styles.stepText}>−</Text>
          </Pressable>
          <TextInput
            value={String(quantity)}
            onChangeText={(t: string) => {
              const n = Number(t.replace(/[^0-9.]/g, ""));
              setQuantity(Number.isFinite(n) ? n : 0);
            }}
            keyboardType="decimal-pad"
            style={[styles.input, { flex: 1, textAlign: "center" }]}
            testID="input-quantity"
          />
          <Pressable onPress={() => adjustQty(1)} style={styles.stepBtn} testID="button-qty-plus">
            <Text style={styles.stepText}>＋</Text>
          </Pressable>
        </View>
        <View style={{ flexDirection: "row", gap: spacing(1) }}>
          {UNITS.map((u) => (
            <Pressable
              key={u}
              onPress={() => setUnit(u)}
              style={[styles.chip, { flex: 1, alignItems: "center" }, unit === u && styles.chipActive]}
              testID={`chip-unit-${u}`}
            >
              <Text style={[styles.chipText, unit === u && styles.chipTextActive]}>{u}</Text>
            </Pressable>
          ))}
        </View>

        <TextInput
          placeholder="Notes (optional)"
          placeholderTextColor={colors.textMuted}
          value={notes}
          onChangeText={setNotes}
          style={[styles.input, { minHeight: 60, textAlignVertical: "top" }]}
          multiline
          testID="input-notes"
        />

        <View style={{ flexDirection: "row", gap: spacing(1) }}>
          <Pressable onPress={capturePhoto} style={[styles.btn, { flex: 1 }]} testID="button-attach-photo">
            <Text style={styles.btnText}>{photo ? "Replace photo" : "Photo of ticket"}</Text>
          </Pressable>
          <Pressable
            onPress={save}
            style={[styles.btn, { flex: 1, backgroundColor: colors.success ?? "#16a34a" }]}
            testID="button-save-ticket"
          >
            <Text style={styles.btnText}>Save ticket</Text>
          </Pressable>
        </View>
        {photo ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing(1) }}>
            <Image source={{ uri: photo.uri }} style={styles.thumb} />
            <Text style={{ color: colors.textMuted, fontSize: 12 }} testID="text-photo-attached">
              Photo attached
            </Text>
          </View>
        ) : null}

        <View style={styles.totals} testID="card-day-total">
          <Text style={styles.totalsTitle}>Today · {todayTotals.count} tickets</Text>
          {UNITS.map((u) => (
            <Text key={u} style={styles.totalsRow} testID={`text-total-${u}`}>
              {u}: {(todayTotals.totals[u] ?? 0).toFixed(2)}
            </Text>
          ))}
        </View>

        <Text style={styles.label}>Recent tickets</Text>
        {items.length === 0 ? (
          <Text style={{ color: colors.textMuted }}>No tickets logged yet</Text>
        ) : null}
        {items.map((rec) => {
          const p = rec.payload as HaulTicketPayload;
          const src = [p.source, p.sourceStation ? `STA ${p.sourceStation}` : null].filter(Boolean).join(" · ");
          const dst = [p.destination, p.destinationStation ? `STA ${p.destinationStation}` : null].filter(Boolean).join(" · ");
          return (
            <View key={rec.localId} style={styles.ticketRow} testID={`row-ticket-${rec.localId}`}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>
                  #{p.ticketNumber} · {p.materialClass}
                </Text>
                <Text style={styles.rowSub}>
                  {(Number(p.quantity) || 0).toFixed(2)} {p.unit ?? "TON"}
                  {p.truckNumber ? ` · Truck ${p.truckNumber}` : ""}
                </Text>
                {src || dst ? (
                  <Text style={styles.rowSub} numberOfLines={2}>
                    {src || "—"} → {dst || "—"}
                  </Text>
                ) : null}
                <Text style={styles.rowStatus}>
                  {rec.status}
                  {rec.lastError ? ` · ${rec.lastError}` : ""}
                </Text>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { color: colors.textMuted, fontSize: 12, marginTop: spacing(1) },
  input: { backgroundColor: colors.surface, color: colors.text, padding: spacing(2), borderRadius: 8 },
  row: { flexDirection: "row", gap: spacing(1) },
  chip: { backgroundColor: colors.surface, paddingHorizontal: spacing(2), paddingVertical: spacing(1), borderRadius: 999 },
  chipActive: { backgroundColor: colors.primary },
  chipText: { color: colors.text, fontSize: 12 },
  chipTextActive: { color: "#fff", fontWeight: "600" },
  btn: { backgroundColor: colors.primary, padding: spacing(2), borderRadius: 8, alignItems: "center" },
  btnText: { color: "#fff", fontWeight: "600" },
  stepBtn: {
    backgroundColor: colors.surface,
    width: 48,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  stepText: { color: colors.text, fontSize: 22, fontWeight: "700" },
  thumb: { width: 56, height: 56, borderRadius: 6, backgroundColor: colors.surface },
  totals: {
    backgroundColor: colors.surface,
    padding: spacing(2),
    borderRadius: 8,
    marginTop: spacing(1),
  },
  totalsTitle: { color: colors.text, fontWeight: "700", marginBottom: spacing(1) },
  totalsRow: { color: colors.textMuted, fontSize: 13 },
  ticketRow: {
    backgroundColor: colors.surface,
    padding: spacing(2),
    borderRadius: 8,
    flexDirection: "row",
    gap: spacing(1),
  },
  rowTitle: { color: colors.text, fontWeight: "600" },
  rowSub: { color: colors.textMuted, fontSize: 12 },
  rowStatus: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
});
