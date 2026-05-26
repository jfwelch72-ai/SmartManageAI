import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { SyncStatusBar } from "@/components/SyncStatusBar";
import { useSync } from "@/sync/SyncContext";
import { enqueue, listOutbox } from "@/sync/outbox";
import { api } from "@/api/client";
import { isOnline } from "@/sync/coordinator";
import { colors, spacing } from "@/theme";
import type { OutboxRecord } from "@/sync/types";

type LeaveType = "PTO" | "SICK" | "UNPAID" | "OTHER";

interface ServerLeaveRequest {
  id: string;
  leaveTypeId: string;
  leaveTypeName?: string | null;
  startDate: string;
  endDate: string;
  reason?: string | null;
  status: "PENDING" | "APPROVED" | "DENIED";
  createdAt?: string;
}

interface BalanceRow {
  leaveTypeId: string;
  leaveTypeName: string;
  annualAllowance: number;
  used: number;
  remaining: number;
}

const LEAVE_OPTIONS: Array<{ value: LeaveType; label: string }> = [
  { value: "PTO", label: "PTO / Vacation" },
  { value: "SICK", label: "Sick" },
  { value: "UNPAID", label: "Unpaid" },
  { value: "OTHER", label: "Other" },
];

// Today (YYYY-MM-DD) in local time without pulling in a date library.
function todayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function LeaveRequestsScreen() {
  const { syncNow, lastResult } = useSync();
  const [leaveType, setLeaveType] = useState<LeaveType>("PTO");
  const [startDate, setStartDate] = useState<string>(todayISO());
  const [endDate, setEndDate] = useState<string>(todayISO());
  const [partialHours, setPartialHours] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [serverRecent, setServerRecent] = useState<ServerLeaveRequest[]>([]);
  const [pendingOutbox, setPendingOutbox] = useState<OutboxRecord[]>([]);
  const [balances, setBalances] = useState<BalanceRow[]>([]);

  async function refreshOutbox() {
    const all = await listOutbox();
    setPendingOutbox(
      all.filter((o) => o.entityType === "LEAVE_REQUEST" && o.status !== "SYNCED").reverse(),
    );
  }

  useEffect(() => {
    void refreshOutbox();
  }, [lastResult]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!(await isOnline())) return;
      try {
        const list = await api<ServerLeaveRequest[]>("/api/leave/requests?scope=mine");
        if (!cancelled) setServerRecent(list);
      } catch {
        /* ignore — list stays empty */
      }
      try {
        const bal = await api<BalanceRow[]>("/api/leave/balances");
        if (!cancelled) setBalances(bal);
      } catch {
        /* ignore — no balance shown */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lastResult]);

  const ptoBalance = useMemo(
    () => balances.find((b) => /vacation|pto/i.test(b.leaveTypeName)),
    [balances],
  );
  const sickBalance = useMemo(
    () => balances.find((b) => /sick/i.test(b.leaveTypeName)),
    [balances],
  );

  function reset() {
    setReason("");
    setPartialHours("");
    setStartDate(todayISO());
    setEndDate(todayISO());
  }

  async function submit() {
    setFeedback(null);
    if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
      setFeedback("Dates must be in YYYY-MM-DD format.");
      return;
    }
    if (endDate < startDate) {
      setFeedback("End date must be on or after start date.");
      return;
    }
    const partial = partialHours.trim() === "" ? undefined : Number(partialHours);
    if (partial !== undefined && (Number.isNaN(partial) || partial <= 0 || partial > 24)) {
      setFeedback("Partial-day hours must be between 0 and 24.");
      return;
    }
    setSubmitting(true);
    try {
      await enqueue({
        entityType: "LEAVE_REQUEST",
        operation: "CREATE",
        payload: {
          leaveType,
          startDate,
          endDate,
          partialDayHours: partial,
          reason: reason.trim() || undefined,
        },
      });
      const online = await isOnline();
      setFeedback(online ? "Submitted — syncing now…" : "Saved offline — will sync when online.");
      reset();
      await refreshOutbox();
      void syncNow();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing(2), gap: spacing(2) }}
    >
      <SyncStatusBar />

      {(ptoBalance || sickBalance) && (
        <View style={styles.balanceRow}>
          {ptoBalance && (
            <View style={styles.balanceTile} testID="tile-balance-pto">
              <Text style={styles.balanceLabel}>PTO remaining</Text>
              <Text style={styles.balanceValue}>{ptoBalance.remaining} d</Text>
              <Text style={styles.balanceSub}>
                {ptoBalance.used} used / {ptoBalance.annualAllowance}
              </Text>
            </View>
          )}
          {sickBalance && (
            <View style={styles.balanceTile} testID="tile-balance-sick">
              <Text style={styles.balanceLabel}>Sick remaining</Text>
              <Text style={styles.balanceValue}>{sickBalance.remaining} d</Text>
              <Text style={styles.balanceSub}>
                {sickBalance.used} used / {sickBalance.annualAllowance}
              </Text>
            </View>
          )}
        </View>
      )}

      <Text style={styles.label}>Leave type</Text>
      <View style={styles.chipRow}>
        {LEAVE_OPTIONS.map((opt) => (
          <Pressable
            key={opt.value}
            onPress={() => setLeaveType(opt.value)}
            style={[styles.chip, leaveType === opt.value && styles.chipActive]}
            testID={`chip-leave-${opt.value}`}
          >
            <Text style={[styles.chipText, leaveType === opt.value && styles.chipTextActive]}>
              {opt.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Start date (YYYY-MM-DD)</Text>
      <TextInput
        value={startDate}
        onChangeText={setStartDate}
        placeholder="2026-05-26"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        style={styles.input}
        testID="input-start-date"
      />

      <Text style={styles.label}>End date (YYYY-MM-DD)</Text>
      <TextInput
        value={endDate}
        onChangeText={setEndDate}
        placeholder="2026-05-26"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        style={styles.input}
        testID="input-end-date"
      />

      <Text style={styles.label}>Partial-day hours (optional)</Text>
      <TextInput
        value={partialHours}
        onChangeText={setPartialHours}
        placeholder="e.g. 4"
        placeholderTextColor={colors.textMuted}
        keyboardType="numeric"
        style={styles.input}
        testID="input-partial-hours"
      />

      <Text style={styles.label}>Reason / notes</Text>
      <TextInput
        value={reason}
        onChangeText={setReason}
        multiline
        placeholder="Optional — what's the leave for?"
        placeholderTextColor={colors.textMuted}
        style={[styles.input, { minHeight: 80 }]}
        testID="input-reason"
      />

      {feedback ? (
        <Text style={styles.feedback} testID="text-feedback">
          {feedback}
        </Text>
      ) : null}

      <Pressable
        onPress={() => void submit()}
        disabled={submitting}
        style={[styles.btn, submitting && { opacity: 0.6 }]}
        testID="button-submit-leave"
      >
        <Text style={styles.btnText}>{submitting ? "Submitting…" : "Submit request"}</Text>
      </Pressable>

      <Text style={[styles.label, { marginTop: spacing(2) }]}>My recent requests</Text>

      {pendingOutbox.length === 0 && serverRecent.length === 0 ? (
        <Text style={styles.muted}>No requests yet.</Text>
      ) : null}

      {pendingOutbox.map((rec) => {
        const p = rec.payload as Record<string, unknown>;
        const status = rec.status === "CONFLICT" ? "CONFLICT" : "PENDING";
        return (
          <View key={rec.localId} style={styles.row} testID={`row-pending-${rec.localId}`}>
            <Text style={styles.rowTitle}>
              {String(p.leaveType ?? "")} · {String(p.startDate ?? "")} → {String(p.endDate ?? "")}
            </Text>
            {typeof p.partialDayHours === "number" && p.partialDayHours > 0 ? (
              <Text style={styles.rowSub}>Partial: {p.partialDayHours}h</Text>
            ) : null}
            {typeof p.reason === "string" && p.reason ? (
              <Text style={styles.rowSub} numberOfLines={2}>
                {p.reason}
              </Text>
            ) : null}
            <Text style={[styles.rowSub, statusStyle(status)]}>{status}</Text>
          </View>
        );
      })}

      {serverRecent.map((r) => (
        <View key={r.id} style={styles.row} testID={`row-request-${r.id}`}>
          <Text style={styles.rowTitle}>
            {(r.leaveTypeName ?? "Leave")} · {r.startDate} → {r.endDate}
          </Text>
          {r.reason ? (
            <Text style={styles.rowSub} numberOfLines={2}>
              {r.reason}
            </Text>
          ) : null}
          <Text style={[styles.rowSub, statusStyle(r.status)]} testID={`text-status-${r.id}`}>
            {r.status}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

function statusStyle(status: string) {
  if (status === "PENDING") return { color: "#f59e0b" };
  if (status === "APPROVED") return { color: "#16a34a" };
  if (status === "DENIED") return { color: colors.danger };
  if (status === "CONFLICT") return { color: colors.danger };
  return {};
}

const styles = StyleSheet.create({
  label: { color: colors.text, fontWeight: "600" },
  muted: { color: colors.textMuted },
  input: {
    backgroundColor: colors.surface,
    color: colors.text,
    padding: spacing(2),
    borderRadius: 8,
    textAlignVertical: "top",
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing(1) },
  chip: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(1),
    borderRadius: 16,
  },
  chipActive: { backgroundColor: colors.primary },
  chipText: { color: colors.text },
  chipTextActive: { color: "#fff", fontWeight: "600" },
  btn: {
    backgroundColor: colors.primary,
    padding: spacing(2),
    borderRadius: 8,
    alignItems: "center",
  },
  btnText: { color: "#fff", fontWeight: "600" },
  feedback: {
    color: colors.text,
    backgroundColor: colors.surface,
    padding: spacing(2),
    borderRadius: 8,
  },
  row: { backgroundColor: colors.surface, padding: spacing(2), borderRadius: 8 },
  rowTitle: { color: colors.text, fontWeight: "600" },
  rowSub: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  balanceRow: { flexDirection: "row", gap: spacing(1) },
  balanceTile: {
    flex: 1,
    backgroundColor: colors.surface,
    padding: spacing(2),
    borderRadius: 8,
  },
  balanceLabel: { color: colors.textMuted, fontSize: 12 },
  balanceValue: { color: colors.text, fontSize: 20, fontWeight: "700", marginTop: 2 },
  balanceSub: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
});
