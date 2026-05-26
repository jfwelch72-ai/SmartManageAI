import React, { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useNavigation, useRoute, type NavigationProp, type RouteProp } from "@react-navigation/native";
import * as ImagePicker from "expo-image-picker";

import { SyncStatusBar } from "@/components/SyncStatusBar";
import { api } from "@/api/client";
import { enqueue } from "@/sync/outbox";
import { useSync } from "@/sync/SyncContext";
import { isOnline } from "@/sync/coordinator";
import { colors, spacing } from "@/theme";

type DetailParams = { poId: string };
type Stack = {
  Deliveries: undefined;
  DeliveryDetail: DetailParams;
};

type LineMode = "FULL" | "PARTIAL" | "SHORT";
type Condition = "GOOD" | "DAMAGED" | "REJECTED";

type Attachment = { localId: string; uri: string; mime: string; name: string };

type LineState = {
  poItemId: string;
  description: string;
  unit?: string | null;
  ordered: number;
  alreadyReceived: number;
  mode: LineMode;
  quantity: string;
  condition: Condition;
  notes: string;
  photos: Attachment[];
};

type PoDetail = {
  id: string;
  poNumber?: string;
  status: string;
  vendor?: { name?: string } | null;
  project?: { name?: string } | null;
  items: Array<{
    id: string;
    description?: string;
    quantity?: string | number | null;
    quantityReceived?: string | number | null;
    unit?: string | null;
  }>;
};

export function DeliveryDetailScreen() {
  const route = useRoute<RouteProp<Stack, "DeliveryDetail">>();
  const nav = useNavigation<NavigationProp<Stack>>();
  const { syncNow } = useSync();
  const { poId } = route.params;

  const [po, setPo] = useState<PoDetail | null>(null);
  const [lines, setLines] = useState<LineState[]>([]);
  const [deliveryNote, setDeliveryNote] = useState("");
  const [receiptNotes, setReceiptNotes] = useState("");
  const [receiptPhotos, setReceiptPhotos] = useState<Attachment[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const detail = await api<PoDetail>(`/api/procurement-module/orders/${encodeURIComponent(poId)}`);
      setPo(detail);
      setLines(
        (detail.items ?? []).map((it) => {
          const ordered = Number(it.quantity ?? 0);
          const received = Number(it.quantityReceived ?? 0);
          const remaining = Math.max(ordered - received, 0);
          return {
            poItemId: it.id,
            description: it.description ?? "(no description)",
            unit: it.unit,
            ordered,
            alreadyReceived: received,
            mode: "FULL" as LineMode,
            quantity: String(remaining || 0),
            condition: "GOOD" as Condition,
            notes: "",
            photos: [],
          };
        })
      );
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load delivery details.");
    }
  }, [poId]);

  useEffect(() => { void load(); }, [load]);

  function patchLine(idx: number, patch: Partial<LineState>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function setLineMode(idx: number, mode: LineMode) {
    setLines((prev) =>
      prev.map((l, i) => {
        if (i !== idx) return l;
        const remaining = Math.max(l.ordered - l.alreadyReceived, 0);
        if (mode === "FULL") return { ...l, mode, quantity: String(remaining), condition: "GOOD" };
        if (mode === "SHORT") return { ...l, mode, quantity: "0", condition: l.condition === "GOOD" ? "DAMAGED" : l.condition };
        return { ...l, mode };
      })
    );
  }

  async function addPhoto(target: { kind: "receipt" } | { kind: "line"; idx: number }) {
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (result.canceled) return;
    const a = result.assets[0];
    const att: Attachment = {
      localId: `photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      uri: a.uri,
      mime: a.mimeType ?? "image/jpeg",
      name: a.fileName ?? `delivery-${Date.now()}.jpg`,
    };
    if (target.kind === "receipt") {
      setReceiptPhotos((prev) => [...prev, att]);
    } else {
      setLines((prev) => prev.map((l, i) => i === target.idx ? { ...l, photos: [...l.photos, att] } : l));
    }
  }

  async function submit() {
    setFeedback(null);
    if (!po) return;
    // Only include lines the user actually touched (non-zero quantity OR explicit SHORT mark with notes/photos).
    const toSend = lines
      .map((l) => ({ ...l, qty: Number(l.quantity) }))
      .filter((l) => {
        if (l.mode === "SHORT") return true;
        return Number.isFinite(l.qty) && l.qty > 0;
      });
    if (toSend.length === 0) {
      setFeedback("Mark at least one line received, partial, or short.");
      return;
    }
    for (const l of toSend) {
      if (l.mode !== "SHORT" && (!Number.isFinite(l.qty) || l.qty <= 0)) {
        setFeedback(`Enter a positive quantity for "${l.description}".`);
        return;
      }
      const remaining = Math.max(l.ordered - l.alreadyReceived, 0);
      if (l.qty > remaining && remaining > 0) {
        setFeedback(`"${l.description}" only has ${remaining} ${l.unit ?? "units"} remaining.`);
        return;
      }
    }

    setSubmitting(true);
    try {
      const attachments: Attachment[] = [
        ...receiptPhotos,
        ...lines.flatMap((l) => l.photos),
      ];
      const payload = {
        poId: po.id,
        deliveryNote: deliveryNote.trim() || undefined,
        notes: receiptNotes.trim() || undefined,
        photoLocalIds: receiptPhotos.map((p) => p.localId),
        items: toSend.map((l) => ({
          poItemId: l.poItemId,
          quantityReceived: l.mode === "SHORT" ? "0" : String(l.qty),
          condition: l.condition,
          notes: l.notes.trim() || undefined,
          photoLocalIds: l.photos.map((p) => p.localId),
        })),
      };
      await enqueue({
        entityType: "DELIVERY_RECEIPT",
        operation: "CREATE",
        payload: payload as unknown as Record<string, unknown>,
        attachments: attachments.length > 0 ? attachments : undefined,
      });
      const online = await isOnline();
      setFeedback(online ? "Receipt queued — syncing now…" : "Saved offline — will sync when online.");
      void syncNow();
      setTimeout(() => nav.goBack(), 800);
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, padding: spacing(2) }}>
        <SyncStatusBar />
        <Text style={styles.errorText} testID="text-detail-error">{loadError}</Text>
        <Pressable onPress={() => void load()} style={[styles.btn, styles.btnSecondary]}>
          <Text style={styles.btnTextDark}>Retry</Text>
        </Pressable>
      </View>
    );
  }
  if (!po) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, padding: spacing(2) }}>
        <SyncStatusBar />
        <Text style={styles.muted}>Loading delivery…</Text>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing(2), gap: spacing(2) }}>
      <SyncStatusBar />

      <View style={styles.headerCard}>
        <Text style={styles.h1}>{po.poNumber ?? po.id.slice(0, 8)}</Text>
        <Text style={styles.muted}>{po.vendor?.name ?? "(no vendor)"} — {po.project?.name ?? "(no project)"}</Text>
        <Text style={styles.muted}>Status: {po.status}</Text>
      </View>

      <Text style={styles.label}>Delivery note / packing slip #</Text>
      <TextInput
        value={deliveryNote}
        onChangeText={setDeliveryNote}
        placeholder="Carrier or packing slip reference"
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        testID="input-delivery-note"
      />

      <Text style={styles.label}>Receipt notes</Text>
      <TextInput
        value={receiptNotes}
        onChangeText={setReceiptNotes}
        multiline
        placeholder="Anything AP should know about this delivery"
        placeholderTextColor={colors.textMuted}
        style={[styles.input, { minHeight: 64 }]}
        testID="input-receipt-notes"
      />

      <View style={{ flexDirection: "row", gap: spacing(1), alignItems: "center" }}>
        <Pressable
          onPress={() => void addPhoto({ kind: "receipt" })}
          style={[styles.btn, styles.btnSecondary, { flex: 1 }]}
          testID="button-add-receipt-photo"
        >
          <Text style={styles.btnTextDark}>Add overall photo</Text>
        </Pressable>
        <Text style={styles.muted} testID="text-receipt-photo-count">
          {receiptPhotos.length} photo{receiptPhotos.length === 1 ? "" : "s"}
        </Text>
      </View>

      <Text style={[styles.label, { marginTop: spacing(2) }]}>Lines</Text>
      {lines.length === 0 ? (
        <Text style={styles.muted}>This PO has no line items.</Text>
      ) : (
        lines.map((l, idx) => {
          const remaining = Math.max(l.ordered - l.alreadyReceived, 0);
          return (
            <View key={l.poItemId} style={styles.lineCard} testID={`card-line-${l.poItemId}`}>
              <Text style={styles.lineTitle}>{l.description}</Text>
              <Text style={styles.muted}>
                Ordered {l.ordered} {l.unit ?? ""} · already received {l.alreadyReceived} · remaining {remaining}
              </Text>
              <View style={styles.tabs}>
                {(["FULL", "PARTIAL", "SHORT"] as LineMode[]).map((m) => (
                  <Pressable
                    key={m}
                    onPress={() => setLineMode(idx, m)}
                    style={[styles.tab, l.mode === m && styles.tabActive]}
                    testID={`tab-line-${l.poItemId}-${m.toLowerCase()}`}
                  >
                    <Text style={[styles.tabText, l.mode === m && styles.tabTextActive]}>
                      {m === "FULL" ? "Full" : m === "PARTIAL" ? "Partial" : "Short / damaged"}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {l.mode !== "SHORT" ? (
                <>
                  <Text style={styles.label}>Quantity received ({l.unit ?? "units"})</Text>
                  <TextInput
                    value={l.quantity}
                    onChangeText={(v: string) => patchLine(idx, { quantity: v })}
                    keyboardType="decimal-pad"
                    style={styles.input}
                    testID={`input-qty-${l.poItemId}`}
                  />
                </>
              ) : null}

              <Text style={styles.label}>Condition</Text>
              <View style={styles.chipRow}>
                {(["GOOD", "DAMAGED", "REJECTED"] as Condition[]).map((c) => (
                  <Pressable
                    key={c}
                    onPress={() => patchLine(idx, { condition: c })}
                    style={[styles.chip, l.condition === c && styles.chipActive]}
                    testID={`chip-cond-${l.poItemId}-${c}`}
                  >
                    <Text style={[styles.chipText, l.condition === c && styles.chipTextActive]}>{c}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.label}>Notes</Text>
              <TextInput
                value={l.notes}
                onChangeText={(v: string) => patchLine(idx, { notes: v })}
                multiline
                placeholder={l.mode === "SHORT" ? "What's short or damaged?" : "Optional"}
                placeholderTextColor={colors.textMuted}
                style={[styles.input, { minHeight: 56 }]}
                testID={`input-notes-${l.poItemId}`}
              />

              <View style={{ flexDirection: "row", gap: spacing(1), alignItems: "center" }}>
                <Pressable
                  onPress={() => void addPhoto({ kind: "line", idx })}
                  style={[styles.btn, styles.btnSecondary, { flex: 1 }]}
                  testID={`button-add-photo-${l.poItemId}`}
                >
                  <Text style={styles.btnTextDark}>Add photo for this line</Text>
                </Pressable>
                <Text style={styles.muted} testID={`text-photo-count-${l.poItemId}`}>
                  {l.photos.length} photo{l.photos.length === 1 ? "" : "s"}
                </Text>
              </View>
            </View>
          );
        })
      )}

      {feedback ? <Text style={styles.feedback} testID="text-feedback">{feedback}</Text> : null}

      <Pressable
        onPress={() => void submit()}
        disabled={submitting}
        style={[styles.btn, submitting && { opacity: 0.6 }]}
        testID="button-submit-receipt"
      >
        <Text style={styles.btnText}>{submitting ? "Submitting…" : "Submit receipt"}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  h1: { color: colors.text, fontSize: 20, fontWeight: "700" },
  muted: { color: colors.textMuted, fontSize: 12 },
  label: { color: colors.text, fontWeight: "600", marginTop: spacing(1) },
  input: { backgroundColor: colors.surface, color: colors.text, padding: spacing(2), borderRadius: 8, textAlignVertical: "top" },
  headerCard: { backgroundColor: colors.surface, padding: spacing(2), borderRadius: 10, gap: 4 },
  lineCard: { backgroundColor: colors.surface, padding: spacing(2), borderRadius: 10, gap: spacing(1) },
  lineTitle: { color: colors.text, fontWeight: "700" },
  tabs: { flexDirection: "row", gap: spacing(1) },
  tab: { flex: 1, padding: spacing(1), borderRadius: 8, backgroundColor: colors.background, alignItems: "center" },
  tabActive: { backgroundColor: colors.primary },
  tabText: { color: colors.text, fontWeight: "600", fontSize: 12 },
  tabTextActive: { color: "#fff" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing(1) },
  chip: { backgroundColor: colors.background, paddingHorizontal: spacing(2), paddingVertical: spacing(1), borderRadius: 16 },
  chipActive: { backgroundColor: colors.primary },
  chipText: { color: colors.text },
  chipTextActive: { color: "#fff", fontWeight: "600" },
  btn: { backgroundColor: colors.primary, padding: spacing(2), borderRadius: 8, alignItems: "center" },
  btnSecondary: { backgroundColor: colors.surface },
  btnText: { color: "#fff", fontWeight: "600" },
  btnTextDark: { color: colors.text, fontWeight: "600" },
  errorText: { color: "#ef4444", marginBottom: spacing(2) },
  feedback: { color: colors.text, backgroundColor: colors.surface, padding: spacing(2), borderRadius: 8 },
});
