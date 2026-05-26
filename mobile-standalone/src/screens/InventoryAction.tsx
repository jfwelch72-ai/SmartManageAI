import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useNavigation, useRoute, type NavigationProp, type RouteProp } from "@react-navigation/native";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";

import { api, baseUrl, getAuthToken, ApiError } from "@/api/client";
import { enqueue } from "@/sync/outbox";
import { cacheList } from "@/sync/db";
import { useSync } from "@/sync/SyncContext";
import { isOnline } from "@/sync/coordinator";
import { colors, spacing } from "@/theme";

type Mode = "RECEIVE" | "ISSUE" | "TRANSFER";

type InventoryStockRow = {
  locationId: string;
  locationCode?: string;
  locationName?: string;
  onHand: string;
  averageCost?: string | null;
};

type InventoryMaterial = {
  id: string;
  sku: string;
  name: string;
  uom: string;
  barcode?: string | null;
  defaultCostCode?: string | null;
  unitCost?: string | null;
};

type InventoryLocation = { id: string; code: string; name: string; type?: string; isActive?: boolean };
type ProjectRow = { id: string; name?: string; title?: string };

type InventoryStack = {
  Inventory: undefined;
  InventoryScan: undefined;
  InventoryAction: { material: InventoryMaterial; stock: InventoryStockRow[] };
};

export function InventoryActionScreen() {
  const nav = useNavigation<NavigationProp<InventoryStack>>();
  const route = useRoute<RouteProp<InventoryStack, "InventoryAction">>();
  const { material, stock } = route.params;
  const { syncNow } = useSync();

  const [mode, setMode] = useState<Mode>("RECEIVE");
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [locationId, setLocationId] = useState<string>("");
  const [toLocationId, setToLocationId] = useState<string>("");
  const [projectId, setProjectId] = useState<string>("");
  const [quantity, setQuantity] = useState("1");
  const [unitCost, setUnitCost] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [printingLabel, setPrintingLabel] = useState(false);

  // Locations: try a fresh fetch when online, fall back to last known list
  // from the per-material stock rows so the screen still works offline.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (await isOnline()) {
        try {
          const list = await api<InventoryLocation[]>("/api/inventory/locations");
          if (!cancelled) {
            setLocations(list.filter((l) => l.isActive !== false));
            return;
          }
        } catch {
          /* fall through to offline list */
        }
      }
      if (!cancelled) {
        const fromStock = stock
          .filter((s) => s.locationId)
          .map((s) => ({ id: s.locationId, code: s.locationCode ?? "", name: s.locationName ?? s.locationCode ?? s.locationId }));
        setLocations(fromStock);
      }
    })();
    return () => { cancelled = true; };
  }, [stock]);

  useEffect(() => {
    void cacheList<ProjectRow>("PROJECT").then(setProjects);
  }, []);

  useEffect(() => {
    if (!locationId && locations[0]) setLocationId(locations[0].id);
  }, [locations, locationId]);

  const stockByLocation = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of stock) map.set(s.locationId, Number(s.onHand) || 0);
    return map;
  }, [stock]);

  const onHandHere = locationId ? stockByLocation.get(locationId) ?? 0 : 0;

  async function reprintLabel() {
    setFeedback(null);
    if (!(await isOnline())) {
      setFeedback("Connect to the network to reprint a label.");
      return;
    }
    setPrintingLabel(true);
    try {
      const token = await getAuthToken();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/pdf",
      };
      if (token) headers["Cookie"] = `auth_token=${token}`;
      const res = await fetch(`${baseUrl}/api/inventory/labels`, {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({
          materialIds: [material.id],
          symbology: "code128",
          copies: 1,
          startOffset: 0,
        }),
      });
      if (!res.ok) {
        let body: unknown = null;
        try { body = await res.json(); } catch { /* ignore */ }
        throw new ApiError(res.status, body);
      }
      // Convert PDF body to base64 for FileSystem.writeAsStringAsync.
      const blob = await res.blob();
      const base64: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          // result is "data:application/pdf;base64,xxxx"
          const idx = result.indexOf(",");
          resolve(idx >= 0 ? result.slice(idx + 1) : result);
        };
        reader.onerror = () => reject(reader.error ?? new Error("Failed to read PDF"));
        reader.readAsDataURL(blob);
      });
      const safeSku = (material.sku || "label").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 32);
      // Use cacheDirectory so the OS can clean up old labels automatically.
      // expo-sharing wraps the file in a FileProvider content:// URI on
      // Android and a UIActivityViewController on iOS, so cache-scoped
      // files share/print correctly on both platforms.
      const dir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? "";
      const fileUri = `${dir}label-${safeSku}-${Date.now()}.pdf`;
      await FileSystem.writeAsStringAsync(fileUri, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      // Hand off to the OS sheet so the user can AirPrint, send to a paired
      // Bluetooth/network label printer, or save to Files. expo-sharing is
      // the cross-platform path: iOS uses the share sheet, Android opens
      // the standard intent chooser via FileProvider.
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(fileUri, {
          mimeType: "application/pdf",
          UTI: "com.adobe.pdf",
          dialogTitle: `Print label for ${material.sku}`,
        });
        setFeedback("Label sent to print/share sheet.");
      } else {
        setFeedback(`Label saved to ${fileUri}.`);
      }
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `Print failed (HTTP ${err.status}).`
          : err instanceof Error
          ? `Print failed: ${err.message}`
          : "Print failed.";
      setFeedback(msg);
    } finally {
      setPrintingLabel(false);
    }
  }

  function reset() {
    setQuantity("1");
    setUnitCost("");
    setReferenceNumber("");
    setNotes("");
  }

  async function submit() {
    setFeedback(null);
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      setFeedback("Enter a positive quantity.");
      return;
    }
    if (!locationId) {
      setFeedback("Pick a location.");
      return;
    }
    if (mode === "ISSUE" && !projectId) {
      setFeedback("Pick a project to issue against.");
      return;
    }
    if (mode === "TRANSFER" && (!toLocationId || toLocationId === locationId)) {
      setFeedback("Pick a different destination location.");
      return;
    }

    setSubmitting(true);
    try {
      let entityType: "INVENTORY_RECEIPT" | "INVENTORY_ISSUE" | "INVENTORY_TRANSFER";
      let payload: Record<string, unknown>;
      if (mode === "RECEIVE") {
        entityType = "INVENTORY_RECEIPT";
        payload = {
          materialId: material.id,
          locationId,
          quantity: qty,
          unitCost: unitCost ? Number(unitCost) : undefined,
          referenceNumber: referenceNumber || undefined,
          notes: notes || undefined,
        };
      } else if (mode === "ISSUE") {
        entityType = "INVENTORY_ISSUE";
        payload = {
          materialId: material.id,
          locationId,
          quantity: qty,
          projectId,
          costCode: material.defaultCostCode || undefined,
          referenceNumber: referenceNumber || undefined,
          notes: notes || undefined,
        };
      } else {
        entityType = "INVENTORY_TRANSFER";
        payload = {
          materialId: material.id,
          fromLocationId: locationId,
          toLocationId,
          quantity: qty,
          referenceNumber: referenceNumber || undefined,
          notes: notes || undefined,
        };
      }

      await enqueue({ entityType, operation: "CREATE", payload });
      const online = await isOnline();
      setFeedback(online ? "Queued — syncing now…" : "Queued offline — will sync when online.");
      reset();
      void syncNow();
      // Pop back to the scanner so the warehouse user can scan the next SKU
      // immediately. Slight delay so they can read the confirmation toast.
      setTimeout(() => nav.navigate("InventoryScan"), 700);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing(2), gap: spacing(2) }}>
      <View style={styles.card}>
        <Text style={styles.h1} testID="text-material-name">{material.name}</Text>
        <Text style={styles.muted}>SKU {material.sku} · {material.uom}</Text>
        {material.barcode ? <Text style={styles.muted}>Barcode {material.barcode}</Text> : null}
        <Text style={[styles.muted, { marginTop: spacing(1) }]}>
          On hand at selected location: <Text style={styles.bold}>{onHandHere}</Text>
        </Text>
        <Pressable
          onPress={() => void reprintLabel()}
          disabled={printingLabel}
          style={[styles.btn, styles.btnSecondary, { marginTop: spacing(2) }, printingLabel && { opacity: 0.6 }]}
          testID="button-reprint-label"
        >
          <Text style={styles.btnText}>
            {printingLabel ? "Preparing label…" : "Reprint label"}
          </Text>
        </Pressable>
      </View>

      <View style={styles.tabs}>
        {(["RECEIVE", "ISSUE", "TRANSFER"] as Mode[]).map((m) => (
          <Pressable
            key={m}
            onPress={() => setMode(m)}
            style={[styles.tab, mode === m && styles.tabActive]}
            testID={`tab-${m.toLowerCase()}`}
          >
            <Text style={[styles.tabText, mode === m && styles.tabTextActive]}>{m}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>{mode === "TRANSFER" ? "From location" : "Location"}</Text>
      <LocationPicker locations={locations} value={locationId} onChange={setLocationId} testIdPrefix="from" />

      {mode === "TRANSFER" ? (
        <>
          <Text style={styles.label}>To location</Text>
          <LocationPicker
            locations={locations.filter((l) => l.id !== locationId)}
            value={toLocationId}
            onChange={setToLocationId}
            testIdPrefix="to"
          />
        </>
      ) : null}

      {mode === "ISSUE" ? (
        <>
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
        </>
      ) : null}

      <Text style={styles.label}>Quantity ({material.uom})</Text>
      <TextInput
        value={quantity}
        onChangeText={setQuantity}
        keyboardType="decimal-pad"
        style={styles.input}
        testID="input-quantity"
      />

      {mode === "RECEIVE" ? (
        <>
          <Text style={styles.label}>Unit cost (optional)</Text>
          <TextInput
            value={unitCost}
            onChangeText={setUnitCost}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            testID="input-unit-cost"
          />
        </>
      ) : null}

      <Text style={styles.label}>Reference # (PO, ticket, etc.)</Text>
      <TextInput
        value={referenceNumber}
        onChangeText={setReferenceNumber}
        style={styles.input}
        testID="input-reference"
      />

      <Text style={styles.label}>Notes</Text>
      <TextInput
        value={notes}
        onChangeText={setNotes}
        multiline
        style={[styles.input, { minHeight: 64 }]}
        testID="input-notes"
      />

      {feedback ? <Text style={styles.feedback}>{feedback}</Text> : null}

      <Pressable
        onPress={() => void submit()}
        disabled={submitting}
        style={[styles.btn, submitting && { opacity: 0.6 }]}
        testID="button-submit"
      >
        <Text style={styles.btnText}>
          {submitting ? "Saving…" : mode === "RECEIVE" ? "Receive stock" : mode === "ISSUE" ? "Issue to project" : "Transfer stock"}
        </Text>
      </Pressable>

      <Pressable onPress={() => nav.navigate("InventoryScan")} style={[styles.btn, styles.btnSecondary]}>
        <Text style={styles.btnText}>Scan another</Text>
      </Pressable>
    </ScrollView>
  );
}

function LocationPicker({
  locations,
  value,
  onChange,
  testIdPrefix,
}: {
  locations: InventoryLocation[];
  value: string;
  onChange: (id: string) => void;
  testIdPrefix: string;
}) {
  if (locations.length === 0) {
    return <Text style={styles.muted}>No locations available.</Text>;
  }
  return (
    <View style={styles.chipRow}>
      {locations.map((l) => (
        <Pressable
          key={l.id}
          onPress={() => onChange(l.id)}
          style={[styles.chip, value === l.id && styles.chipActive]}
          testID={`chip-${testIdPrefix}-loc-${l.id}`}
        >
          <Text style={[styles.chipText, value === l.id && styles.chipTextActive]}>
            {l.code ? `${l.code} — ${l.name}` : l.name}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  h1: { color: colors.text, fontSize: 20, fontWeight: "700" },
  bold: { color: colors.text, fontWeight: "700" },
  muted: { color: colors.textMuted },
  card: { backgroundColor: colors.surface, padding: spacing(2), borderRadius: 10 },
  tabs: { flexDirection: "row", gap: spacing(1) },
  tab: { flex: 1, padding: spacing(2), borderRadius: 8, backgroundColor: colors.surface, alignItems: "center" },
  tabActive: { backgroundColor: colors.primary },
  tabText: { color: colors.text, fontWeight: "600" },
  tabTextActive: { color: "#fff" },
  label: { color: colors.text, fontWeight: "600", marginTop: spacing(1) },
  input: { backgroundColor: colors.surface, color: colors.text, padding: spacing(2), borderRadius: 8 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing(1) },
  chip: { backgroundColor: colors.surface, paddingHorizontal: spacing(2), paddingVertical: spacing(1), borderRadius: 16 },
  chipActive: { backgroundColor: colors.primary },
  chipText: { color: colors.text },
  chipTextActive: { color: "#fff", fontWeight: "600" },
  btn: { backgroundColor: colors.primary, padding: spacing(2), borderRadius: 8, alignItems: "center", marginTop: spacing(1) },
  btnSecondary: { backgroundColor: colors.surface },
  btnText: { color: "#fff", fontWeight: "600" },
  feedback: { color: colors.text, backgroundColor: colors.surface, padding: spacing(2), borderRadius: 8 },
});
