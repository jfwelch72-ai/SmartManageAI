import React, { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useNavigation, type NavigationProp } from "@react-navigation/native";

import { SyncStatusBar } from "@/components/SyncStatusBar";
import { api } from "@/api/client";
import { cacheList, cachePut } from "@/sync/db";
import { useSync } from "@/sync/SyncContext";
import { isOnline } from "@/sync/coordinator";
import { listOutbox } from "@/sync/outbox";
import { colors, spacing } from "@/theme";

export type DeliveryListItem = {
  id: string;
  poNumber?: string;
  status: string;
  projectId?: string;
  project?: { name?: string; code?: string } | null;
  vendor?: { id?: string; name?: string } | null;
  neededByDate?: string | null;
  items?: Array<{
    id: string;
    description?: string;
    quantity?: string | number | null;
    quantityReceived?: string | number | null;
    unit?: string | null;
    expectedDeliveryDate?: string | null;
  }>;
};

type DeliveriesStackParamList = {
  Deliveries: undefined;
  DeliveryDetail: { poId: string };
};

const OPEN_STATUSES = ["APPROVED", "SENT", "ACKNOWLEDGED", "PARTIAL"];

export function DeliveriesScreen() {
  const nav = useNavigation<NavigationProp<DeliveriesStackParamList>>();
  const { syncNow, lastResult } = useSync();
  const [orders, setOrders] = useState<DeliveryListItem[]>([]);
  const [pendingByPo, setPendingByPo] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      if (await isOnline()) {
        const fetched: DeliveryListItem[] = [];
        for (const status of OPEN_STATUSES) {
          try {
            const list = await api<DeliveryListItem[]>(
              `/api/procurement-module/orders?status=${encodeURIComponent(status)}`
            );
            fetched.push(...list);
          } catch {
            /* try next status */
          }
        }
        const dedup = new Map<string, DeliveryListItem>();
        for (const po of fetched) dedup.set(po.id, po);
        const open = Array.from(dedup.values()).filter((o) => isOpenForReceipt(o));
        setOrders(open);
        for (const o of open) {
          await cachePut("OPEN_DELIVERY" as any, o.id, o, new Date().toISOString());
        }
      } else {
        const cached = await cacheList<DeliveryListItem>("OPEN_DELIVERY" as any);
        setOrders(cached.filter(isOpenForReceipt));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load deliveries.");
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshPending = useCallback(async () => {
    const all = await listOutbox();
    const counts: Record<string, number> = {};
    for (const o of all) {
      if (o.entityType !== "DELIVERY_RECEIPT") continue;
      if (o.status === "SYNCED") continue;
      const poId = (o.payload as any)?.poId as string | undefined;
      if (!poId) continue;
      counts[poId] = (counts[poId] ?? 0) + 1;
    }
    setPendingByPo(counts);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      void refreshPending();
    }, [refresh, refreshPending])
  );

  useEffect(() => {
    void refreshPending();
  }, [lastResult, refreshPending]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SyncStatusBar />
      <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(2) }}>
        <View style={{ flexDirection: "row", gap: spacing(1) }}>
          <Pressable
            onPress={() => void refresh()}
            style={[styles.btn, styles.btnSecondary, { flex: 1 }]}
            testID="button-refresh-deliveries"
          >
            <Text style={styles.btnTextDark}>{loading ? "Refreshing…" : "Refresh"}</Text>
          </Pressable>
          <Pressable onPress={() => void syncNow()} style={[styles.btn, { flex: 1 }]}>
            <Text style={styles.btnText}>Sync now</Text>
          </Pressable>
        </View>

        {error ? <Text style={styles.errorText} testID="text-deliveries-error">{error}</Text> : null}

        {orders.length === 0 ? (
          <Text style={styles.muted} testID="text-deliveries-empty">
            No open deliveries. POs in APPROVED, SENT, ACKNOWLEDGED, or PARTIAL status will show here.
          </Text>
        ) : (
          orders.map((po) => {
            const items = po.items ?? [];
            const totalLines = items.length;
            const fulfilled = items.filter((it) => {
              const ordered = Number(it.quantity ?? 0);
              const received = Number(it.quantityReceived ?? 0);
              return ordered > 0 && received >= ordered;
            }).length;
            const pending = pendingByPo[po.id] ?? 0;
            return (
              <Pressable
                key={po.id}
                onPress={() => nav.navigate("DeliveryDetail", { poId: po.id })}
                style={styles.card}
                testID={`row-delivery-${po.id}`}
              >
                <Text style={styles.cardTitle}>
                  {po.poNumber ?? po.id.slice(0, 8)} · {po.status}
                </Text>
                <Text style={styles.cardSub}>
                  {po.vendor?.name ?? "(no vendor)"} — {po.project?.name ?? "(no project)"}
                </Text>
                {po.neededByDate ? (
                  <Text style={styles.cardSub}>Needed by {formatDate(po.neededByDate)}</Text>
                ) : null}
                <Text style={styles.cardSub}>
                  {fulfilled}/{totalLines} lines fulfilled
                  {pending > 0 ? ` · ${pending} pending sync` : ""}
                </Text>
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

function isOpenForReceipt(po: DeliveryListItem): boolean {
  if (!OPEN_STATUSES.includes(po.status)) return false;
  const items = po.items ?? [];
  if (items.length === 0) return true;
  return items.some((it) => {
    const ordered = Number(it.quantity ?? 0);
    const received = Number(it.quantityReceived ?? 0);
    return ordered <= 0 || received < ordered;
  });
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

const styles = StyleSheet.create({
  btn: { backgroundColor: colors.primary, padding: spacing(2), borderRadius: 8, alignItems: "center" },
  btnSecondary: { backgroundColor: colors.surface },
  btnText: { color: "#fff", fontWeight: "600" },
  btnTextDark: { color: colors.text, fontWeight: "600" },
  muted: { color: colors.textMuted },
  errorText: { color: "#ef4444" },
  card: { backgroundColor: colors.surface, padding: spacing(2), borderRadius: 10, gap: 4 },
  cardTitle: { color: colors.text, fontWeight: "700", fontSize: 16 },
  cardSub: { color: colors.textMuted, fontSize: 12 },
});
