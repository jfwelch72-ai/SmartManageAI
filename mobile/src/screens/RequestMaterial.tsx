import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import * as ImagePicker from "expo-image-picker";

import { SyncStatusBar } from "@/components/SyncStatusBar";
import { api, ApiError } from "@/api/client";
import { enqueue, listOutbox } from "@/sync/outbox";
import { cacheList } from "@/sync/db";
import { isOnline } from "@/sync/coordinator";
import { useSync } from "@/sync/SyncContext";
import { colors, spacing } from "@/theme";
import type { OutboxRecord } from "@/sync/types";

type ProjectRow = { id: string; name?: string; title?: string };

type ServerRequest = {
  id: string;
  prNumber: string;
  title: string;
  status: string;
  createdAt?: string;
  project?: { name?: string } | null;
  items?: Array<{ description?: string; quantity?: string | null; unit?: string | null }>;
};

const STATUS_PILL: Record<string, { label: string; color: string }> = {
  DRAFT: { label: "Pending", color: colors.warn },
  PENDING_APPROVAL: { label: "Submitted", color: colors.primary },
  APPROVED: { label: "Approved", color: colors.success },
  REJECTED: { label: "Denied", color: colors.danger },
  CONVERTED_TO_PO: { label: "On PO", color: colors.success },
};

function pillFor(status: string) {
  return STATUS_PILL[status] ?? { label: status, color: colors.textMuted };
}

export function RequestMaterialScreen() {
  const { syncNow } = useSync();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [itemName, setItemName] = useState("");
  const [costCode, setCostCode] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState("ea");
  const [neededBy, setNeededBy] = useState("");
  const [justification, setJustification] = useState("");
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoMime, setPhotoMime] = useState<string>("image/jpeg");
  const [photoName, setPhotoName] = useState<string>("photo.jpg");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pendingRows, setPendingRows] = useState<OutboxRecord[]>([]);
  const [serverRows, setServerRows] = useState<ServerRequest[]>([]);

  const refreshPending = useCallback(async () => {
    const all = await listOutbox();
    setPendingRows(
      all.filter((o) => o.entityType === "MATERIAL_REQUEST").reverse().slice(0, 30)
    );
  }, []);

  const refreshServer = useCallback(async () => {
    if (!(await isOnline())) return;
    try {
      const rows = await api<ServerRequest[]>("/api/procurement-module/requests?mine=true");
      setServerRows(rows.slice(0, 20));
    } catch {
      // offline / forbidden — leave previous list
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshPending();
      void refreshServer();
    }, [refreshPending, refreshServer])
  );

  useEffect(() => {
    void cacheList<ProjectRow>("PROJECT").then((p) => {
      setProjects(p);
      setProjectId((cur) => cur || p[0]?.id || "");
    });
  }, []);

  async function capturePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setFeedback("Camera permission denied.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.6 });
    if (result.canceled) return;
    const a = result.assets[0];
    setPhotoUri(a.uri);
    setPhotoMime(a.mimeType ?? "image/jpeg");
    setPhotoName(a.fileName ?? `req-${Date.now()}.jpg`);
  }

  function reset() {
    setItemName("");
    setCostCode("");
    setQuantity("1");
    setUnit("ea");
    setNeededBy("");
    setJustification("");
    setPhotoUri(null);
  }

  async function submit() {
    setFeedback(null);
    if (!projectId) {
      setFeedback("Pick a project.");
      return;
    }
    if (!itemName.trim()) {
      setFeedback("Describe what you need.");
      return;
    }
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      setFeedback("Enter a positive quantity.");
      return;
    }
    if (neededBy && !/^\d{4}-\d{2}-\d{2}$/.test(neededBy.trim())) {
      setFeedback("Needed-by must be YYYY-MM-DD.");
      return;
    }

    setSubmitting(true);
    try {
      const rec = await enqueue({
        entityType: "MATERIAL_REQUEST",
        operation: "CREATE",
        payload: {
          projectId,
          title: itemName.trim(),
          neededByDate: neededBy.trim() || null,
          notes: justification.trim() || null,
          item: {
            description: itemName.trim(),
            quantity: String(qty),
            unit: unit.trim() || null,
            costCode: costCode.trim() || null,
          },
        },
        attachments: photoUri
          ? [{ localId: `${Date.now()}`, uri: photoUri, mime: photoMime, name: photoName }]
          : undefined,
      });
      const online = await isOnline();
      setFeedback(
        online
          ? `Queued ref ${rec.localId.slice(0, 8)} — syncing now…`
          : `Queued offline (ref ${rec.localId.slice(0, 8)}) — will sync when online.`
      );
      reset();
      await refreshPending();
      void syncNow().then(() => void refreshServer());
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `Could not queue (HTTP ${err.status}).`
          : err instanceof Error
          ? err.message
          : "Could not queue.";
      setFeedback(msg);
    } finally {
      setSubmitting(false);
    }
  }

  // Combine outbox-pending rows (not yet acknowledged) with server rows.
  // Server rows superseded by their outbox local id are filtered out via
  // the serverId on the outbox record so we don't show two entries for
  // the same request once it is acknowledged.
  const combined = useMemo(() => {
    const syncedServerIds = new Set(
      pendingRows.filter((r) => r.status === "SYNCED" && r.serverId).map((r) => r.serverId!)
    );
    const pendingDisplay = pendingRows
      .filter((r) => r.status !== "SYNCED")
      .map((r) => {
        const p = r.payload as { title?: string; item?: { quantity?: string; unit?: string } };
        return {
          key: `local-${r.localId}`,
          ref: r.localId.slice(0, 8),
          title: p.title ?? "(untitled)",
          qty: p.item?.quantity ? `${p.item.quantity} ${p.item.unit ?? ""}`.trim() : "",
          when: r.clientTimestamp,
          status: r.status === "FAILED" ? "FAILED" : "DRAFT",
          error: r.lastError ?? null,
        };
      });
    const serverDisplay = serverRows
      .filter((s) => !syncedServerIds.has(s.id))
      .map((s) => ({
        key: `srv-${s.id}`,
        ref: s.prNumber,
        title: s.title,
        qty: s.items?.[0]
          ? `${s.items[0].quantity ?? ""} ${s.items[0].unit ?? ""}`.trim()
          : "",
        when: s.createdAt ?? "",
        status: s.status,
        error: null as string | null,
      }));
    const syncedAcknowledged = pendingRows
      .filter((r) => r.status === "SYNCED" && r.serverId)
      .map((r) => {
        const srv = serverRows.find((s) => s.id === r.serverId);
        const p = r.payload as { title?: string; item?: { quantity?: string; unit?: string } };
        return {
          key: `ack-${r.localId}`,
          ref: srv?.prNumber ?? r.serverId!.slice(0, 8),
          title: srv?.title ?? p.title ?? "(untitled)",
          qty:
            srv?.items?.[0]
              ? `${srv.items[0].quantity ?? ""} ${srv.items[0].unit ?? ""}`.trim()
              : p.item?.quantity
              ? `${p.item.quantity} ${p.item.unit ?? ""}`.trim()
              : "",
          when: r.clientTimestamp,
          status: srv?.status ?? "PENDING_APPROVAL",
          error: null as string | null,
        };
      });
    return [...pendingDisplay, ...syncedAcknowledged, ...serverDisplay];
  }, [pendingRows, serverRows]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SyncStatusBar />
      <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(2) }}>
        <Text style={styles.h1}>Request material / PO</Text>
        <Text style={styles.muted}>
          Short on something? Send the office a request — works offline and syncs when you're back online.
        </Text>

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
                testID={`chip-project-${p.id}`}
              >
                <Text style={[styles.chipText, projectId === p.id && styles.chipTextActive]}>
                  {p.name ?? p.title ?? p.id.slice(0, 8)}
                </Text>
              </Pressable>
            ))
          )}
        </View>

        <Text style={styles.label}>What do you need?</Text>
        <TextInput
          value={itemName}
          onChangeText={setItemName}
          placeholder="e.g. #4 rebar, 20 ft"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          testID="input-item"
        />

        <View style={styles.row2}>
          <View style={{ flex: 2 }}>
            <Text style={styles.label}>Quantity</Text>
            <TextInput
              value={quantity}
              onChangeText={setQuantity}
              keyboardType="decimal-pad"
              style={styles.input}
              testID="input-quantity"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Unit</Text>
            <TextInput
              value={unit}
              onChangeText={setUnit}
              placeholder="ea"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              testID="input-unit"
            />
          </View>
        </View>

        <Text style={styles.label}>Cost code (optional)</Text>
        <TextInput
          value={costCode}
          onChangeText={setCostCode}
          placeholder="e.g. 03-21-00"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          testID="input-cost-code"
        />

        <Text style={styles.label}>Needed by (YYYY-MM-DD, optional)</Text>
        <TextInput
          value={neededBy}
          onChangeText={setNeededBy}
          placeholder="2026-06-01"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          style={styles.input}
          testID="input-needed-by"
        />

        <Text style={styles.label}>Why is it needed?</Text>
        <TextInput
          value={justification}
          onChangeText={setJustification}
          multiline
          placeholder="Short justification — helps the office prioritize."
          placeholderTextColor={colors.textMuted}
          style={[styles.input, { minHeight: 72 }]}
          testID="input-justification"
        />

        <Text style={styles.label}>Photo (optional)</Text>
        <View style={{ flexDirection: "row", gap: spacing(2), alignItems: "center" }}>
          <Pressable
            onPress={() => void capturePhoto()}
            style={[styles.btn, styles.btnSecondary]}
            testID="button-photo"
          >
            <Text style={styles.btnText}>{photoUri ? "Retake" : "Take photo"}</Text>
          </Pressable>
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={styles.thumb} testID="img-photo" />
          ) : null}
        </View>

        {feedback ? (
          <Text style={styles.feedback} testID="text-feedback">
            {feedback}
          </Text>
        ) : null}

        <Pressable
          onPress={() => void submit()}
          disabled={submitting}
          style={[styles.btn, submitting && { opacity: 0.6 }]}
          testID="button-submit"
        >
          <Text style={styles.btnText}>{submitting ? "Saving…" : "Send request"}</Text>
        </Pressable>

        <Text style={[styles.h2, { marginTop: spacing(2) }]}>Recent requests</Text>
        {combined.length === 0 ? (
          <Text style={styles.muted}>Your past material requests will show here once you submit one.</Text>
        ) : (
          combined.map((row) => {
            const pill = pillFor(row.status);
            return (
              <View key={row.key} style={styles.reqRow} testID={`row-request-${row.key}`}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{row.title}</Text>
                  <Text style={styles.rowSub}>
                    {row.ref}
                    {row.qty ? ` · ${row.qty}` : ""}
                    {row.when ? ` · ${new Date(row.when).toLocaleString()}` : ""}
                  </Text>
                  {row.error ? <Text style={styles.errText}>{row.error}</Text> : null}
                </View>
                <View style={[styles.pill, { backgroundColor: pill.color }]}>
                  <Text style={styles.pillText}>{pill.label}</Text>
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
  h1: { color: colors.text, fontSize: 22, fontWeight: "700" },
  h2: { color: colors.text, fontSize: 16, fontWeight: "600" },
  muted: { color: colors.textMuted },
  label: { color: colors.text, fontWeight: "600", marginTop: spacing(1) },
  input: { backgroundColor: colors.surface, color: colors.text, padding: spacing(2), borderRadius: 8 },
  row2: { flexDirection: "row", gap: spacing(2) },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing(1) },
  chip: { backgroundColor: colors.surface, paddingHorizontal: spacing(2), paddingVertical: spacing(1), borderRadius: 16 },
  chipActive: { backgroundColor: colors.primary },
  chipText: { color: colors.text },
  chipTextActive: { color: "#fff", fontWeight: "600" },
  btn: { backgroundColor: colors.primary, padding: spacing(2), borderRadius: 8, alignItems: "center", marginTop: spacing(1) },
  btnSecondary: { backgroundColor: colors.surface, marginTop: 0 },
  btnText: { color: "#fff", fontWeight: "600" },
  thumb: { width: 56, height: 56, borderRadius: 6, backgroundColor: colors.surface },
  feedback: { color: colors.text, backgroundColor: colors.surface, padding: spacing(2), borderRadius: 8 },
  reqRow: {
    backgroundColor: colors.surface,
    padding: spacing(2),
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(2),
  },
  rowTitle: { color: colors.text, fontWeight: "600" },
  rowSub: { color: colors.textMuted, fontSize: 12 },
  errText: { color: colors.danger, fontSize: 12, marginTop: 2 },
  pill: { paddingHorizontal: spacing(1), paddingVertical: 4, borderRadius: 999 },
  pillText: { color: "#fff", fontSize: 11, fontWeight: "700" },
});
