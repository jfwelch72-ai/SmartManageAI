import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect, useNavigation, type NavigationProp } from "@react-navigation/native";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";

import { api, ApiError } from "@/api/client";
import { colors, spacing } from "@/theme";

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

type InventoryStack = {
  InventoryAction: { material: InventoryMaterial; stock: InventoryStockRow[] };
  InventoryScan: undefined;
  Inventory: undefined;
};

export function InventoryScanScreen() {
  const nav = useNavigation<NavigationProp<InventoryStack>>();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const lastScanned = useRef<string>("");

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [permission, requestPermission]);

  // Re-arm the scanner every time this screen regains focus. Without this,
  // navigating from InventoryAction back to InventoryScan would leave
  // `scanning=false` and `lastScanned` set, so the camera would silently
  // ignore every subsequent barcode — breaking the warehouse flow of
  // "scan, post, scan the next SKU".
  useFocusEffect(
    useCallback(() => {
      lastScanned.current = "";
      setScanning(true);
      setError(null);
      return () => {
        // On blur, suppress further scans until we focus again.
        setScanning(false);
      };
    }, [])
  );

  async function lookup(code: string) {
    if (!code) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ material: InventoryMaterial; stock: InventoryStockRow[] }>(
        `/api/inventory/materials/by-barcode/${encodeURIComponent(code)}`
      );
      nav.navigate("InventoryAction", { material: result.material, stock: result.stock });
    } catch (err) {
      const msg =
        err instanceof ApiError && err.status === 404
          ? `No SKU matched "${code}". Try a different code or enter it manually.`
          : err instanceof Error
          ? err.message
          : "Lookup failed";
      setError(msg);
      // Re-arm scanning so the user can try again without leaving the screen.
      lastScanned.current = "";
      setScanning(true);
    } finally {
      setBusy(false);
    }
  }

  function onBarcodeScanned(result: BarcodeScanningResult) {
    if (!scanning || busy) return;
    const code = (result.data || "").trim();
    if (!code || code === lastScanned.current) return;
    lastScanned.current = code;
    setScanning(false);
    void lookup(code);
  }

  if (!permission) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Loading camera…</Text>
      </View>
    );
  }
  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.h1}>Camera access needed</Text>
        <Text style={styles.muted}>Allow camera access to scan material barcodes.</Text>
        <Pressable onPress={requestPermission} style={styles.btn}>
          <Text style={styles.btnText}>Grant access</Text>
        </Pressable>
        <Text style={styles.muted}>Or enter a code manually below.</Text>
        <View style={{ flexDirection: "row", gap: spacing(1), marginTop: spacing(2) }}>
          <TextInput
            placeholder="SKU or barcode"
            placeholderTextColor={colors.textMuted}
            value={manualCode}
            onChangeText={setManualCode}
            autoCapitalize="characters"
            style={[styles.input, { flex: 1 }]}
          />
          <Pressable onPress={() => void lookup(manualCode.trim())} style={styles.btn} disabled={busy}>
            <Text style={styles.btnText}>{busy ? "…" : "Look up"}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        onBarcodeScanned={onBarcodeScanned}
        barcodeScannerSettings={{
          barcodeTypes: [
            "qr",
            "ean13",
            "ean8",
            "upc_a",
            "upc_e",
            "code39",
            "code93",
            "code128",
            "itf14",
            "pdf417",
            "datamatrix",
            "aztec",
          ],
        }}
      >
        <View style={styles.overlay}>
          <View style={styles.reticle} />
          <Text style={styles.overlayText}>
            {busy ? "Looking up…" : "Point camera at a barcode or QR"}
          </Text>
          {error ? <Text style={styles.errText}>{error}</Text> : null}
        </View>
        <View style={styles.bottomBar}>
          <TextInput
            placeholder="Manual SKU"
            placeholderTextColor="#94a3b8"
            value={manualCode}
            onChangeText={setManualCode}
            autoCapitalize="characters"
            style={[styles.input, { flex: 1, color: "#fff" }]}
          />
          <Pressable
            onPress={() => void lookup(manualCode.trim())}
            style={styles.btn}
            disabled={busy}
          >
            <Text style={styles.btnText}>{busy ? "…" : "Look up"}</Text>
          </Pressable>
        </View>
      </CameraView>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.background, padding: spacing(3), gap: spacing(2), alignItems: "center", justifyContent: "center" },
  h1: { color: colors.text, fontSize: 20, fontWeight: "700" },
  muted: { color: colors.textMuted, textAlign: "center" },
  btn: { backgroundColor: colors.primary, paddingHorizontal: spacing(2), paddingVertical: spacing(2), borderRadius: 8, alignItems: "center" },
  btnText: { color: "#fff", fontWeight: "600" },
  input: { backgroundColor: "rgba(15,23,42,0.7)", borderRadius: 8, paddingHorizontal: spacing(2), paddingVertical: spacing(1), color: colors.text },
  overlay: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing(3) },
  reticle: { width: 240, height: 240, borderWidth: 2, borderColor: "#22d3ee", borderRadius: 16, marginBottom: spacing(2) },
  overlayText: { color: "#fff", textAlign: "center", fontWeight: "600" },
  errText: { color: "#fca5a5", textAlign: "center", marginTop: spacing(1) },
  bottomBar: { position: "absolute", bottom: 0, left: 0, right: 0, padding: spacing(2), flexDirection: "row", gap: spacing(1), backgroundColor: "rgba(15,23,42,0.85)" },
});
