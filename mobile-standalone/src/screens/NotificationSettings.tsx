import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, View } from "react-native";

import { api } from "@/api/client";
import { colors, spacing } from "@/theme";

interface ChannelPrefs {
  emailEnabled: boolean;
  smsEnabled: boolean;
  pushEnabled: boolean;
  teamsEnabled: boolean;
  slackEnabled: boolean;
  smsPhoneNumber: string | null;
  teamsWebhookUrl: string | null;
  slackWebhookUrl: string | null;
  birthdayReminderCadence: string;
}

interface TypeOverride {
  notificationType: string;
  emailEnabled: boolean | null;
  pushEnabled: boolean | null;
  smsEnabled?: boolean | null;
  teamsEnabled?: boolean | null;
  slackEnabled?: boolean | null;
  inAppEnabled?: boolean | null;
}

interface PrefsResponse {
  channel: ChannelPrefs;
  typeOverrides: TypeOverride[];
}

/**
 * Curated, field-worker-friendly grouping of the server's notification_type
 * enum into a handful of categories. Each category lists the underlying
 * notification_type values it controls — toggling the category persists a
 * per-type override (pushEnabled) for every type in the group.
 */
const CATEGORIES: Array<{ key: string; label: string; description: string; types: string[] }> = [
  {
    key: "messages",
    label: "Messages",
    description: "Direct messages, mentions, and portal chat.",
    types: ["PORTAL_CHAT_MESSAGE", "TASK_MENTIONED"],
  },
  {
    key: "assignments",
    label: "Assignments",
    description: "New projects, bids, and tasks assigned to you.",
    types: [
      "PROJECT_ASSIGNMENT",
      "BID_ASSIGNED",
      "PROJECT_REASSIGNED",
      "CRM_OPPORTUNITY_REASSIGNED",
      "CRM_CONTACT_REASSIGNED",
      "CRM_ORGANIZATION_REASSIGNED",
      "TAKEOFF_ISSUE_ASSIGNED",
    ],
  },
  {
    key: "approvals",
    label: "Approvals",
    description: "Change orders, submittals, T&M tickets, and other approvals.",
    types: [
      "APPROVAL_REQUEST_NEW",
      "APPROVAL_REQUEST_APPROVED",
      "APPROVAL_REQUEST_REJECTED",
      "CHANGE_ORDER_APPROVED",
      "CHANGE_ORDER_REJECTED",
      "CHANGE_ORDER_PENDING",
      "SUBMITTAL_APPROVED",
      "SUBMITTAL_REJECTED",
      "SUBMITTAL_REVISION_REQUESTED",
      "SUBMITTAL_SUBMITTED",
      "TM_TICKET_SUBMITTED",
      "TM_TICKET_APPROVED",
      "TM_TICKET_REJECTED",
      "OVERTIME_REQUESTED",
      "OVERTIME_APPROVED",
      "OVERTIME_REJECTED",
      "PROCUREMENT_PR_SUBMITTED",
      "PROCUREMENT_PR_APPROVED",
      "PROCUREMENT_PR_REJECTED",
      "PROCUREMENT_PO_SUBMITTED",
      "PROCUREMENT_PO_APPROVED",
      "PROCUREMENT_PO_REJECTED",
    ],
  },
  {
    key: "safety",
    label: "Safety & Compliance",
    description: "Safety incidents, SWPPP overdue actions, and inspector reports.",
    types: [
      "SWPPP_OVERDUE_CORRECTIVE_ACTION",
      "INSPECTOR_REPORT_SUBMITTED",
      "INSPECTOR_REPORT_APPROVED",
      "INSPECTOR_REPORT_REVISION_REQUESTED",
      "MATERIAL_CERT_SUBMITTED",
      "MATERIAL_CERT_VERIFIED",
      "MATERIAL_CERT_REJECTED",
    ],
  },
  {
    key: "system",
    label: "System Alerts",
    description: "Budget alerts, deadlines, reminders, and general notifications.",
    types: [
      "GENERAL",
      "REMINDER",
      "DEADLINE_WARNING",
      "BUDGET_ALERT",
      "PROGRESS_MILESTONE",
      "DOCUMENT_REVISION_CREATED",
    ],
  },
];

function categoryEnabled(types: string[], overrides: Map<string, TypeOverride>, channelDefault: boolean): boolean {
  // The category counts as ON when at least one of its types is push-enabled.
  // Types without an override fall back to the channel default.
  for (const t of types) {
    const ov = overrides.get(t);
    const v = ov?.pushEnabled;
    if (v === null || v === undefined) {
      if (channelDefault) return true;
    } else if (v) {
      return true;
    }
  }
  return false;
}

export function NotificationSettingsScreen() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<PrefsResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api<PrefsResponse>("/api/notifications/preferences")
      .then((data) => {
        if (cancelled) return;
        setPrefs(data);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Could not load preferences");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const overridesMap = useMemo(() => {
    const m = new Map<string, TypeOverride>();
    if (prefs) for (const o of prefs.typeOverrides) m.set(o.notificationType, o);
    return m;
  }, [prefs]);

  async function setMasterPush(next: boolean) {
    if (!prefs) return;
    setSaving("master");
    setError(null);
    try {
      const nextChannel = { ...prefs.channel, pushEnabled: next };
      await api("/api/notifications/preferences", {
        method: "PUT",
        body: JSON.stringify({
          channel: {
            emailEnabled: nextChannel.emailEnabled,
            smsEnabled: nextChannel.smsEnabled,
            pushEnabled: next,
            teamsEnabled: nextChannel.teamsEnabled,
            slackEnabled: nextChannel.slackEnabled,
          },
        }),
      });
      setPrefs({ ...prefs, channel: nextChannel });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(null);
    }
  }

  async function setCategoryPush(category: (typeof CATEGORIES)[number], next: boolean) {
    if (!prefs) return;
    setSaving(category.key);
    setError(null);
    try {
      const typeOverrides: Record<string, { pushEnabled: boolean }> = {};
      for (const t of category.types) typeOverrides[t] = { pushEnabled: next };
      await api("/api/notifications/preferences", {
        method: "PUT",
        body: JSON.stringify({
          channel: {
            emailEnabled: prefs.channel.emailEnabled,
            smsEnabled: prefs.channel.smsEnabled,
            pushEnabled: prefs.channel.pushEnabled,
            teamsEnabled: prefs.channel.teamsEnabled,
            slackEnabled: prefs.channel.slackEnabled,
          },
          typeOverrides,
        }),
      });
      const nextOverrides = [...prefs.typeOverrides];
      for (const t of category.types) {
        const idx = nextOverrides.findIndex((o) => o.notificationType === t);
        const row: TypeOverride = { notificationType: t, emailEnabled: null, pushEnabled: next };
        if (idx >= 0) nextOverrides[idx] = { ...nextOverrides[idx], pushEnabled: next };
        else nextOverrides.push(row);
      }
      setPrefs({ ...prefs, typeOverrides: nextOverrides });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(null);
    }
  }

  if (loading) {
    return (
      <View style={[styles.root, { alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!prefs) {
    return (
      <View style={[styles.root, { padding: spacing(3) }]}>
        <Text style={styles.error} testID="text-notif-prefs-error">
          {error ?? "Notification preferences are unavailable."}
        </Text>
      </View>
    );
  }

  const masterOn = prefs.channel.pushEnabled;

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: spacing(2), gap: spacing(2) }}>
      <View style={styles.card}>
        <View style={styles.rowHead}>
          <Text style={styles.rowTitle}>Push notifications</Text>
          <Switch
            value={masterOn}
            onValueChange={setMasterPush}
            disabled={saving !== null}
            testID="switch-push-master"
          />
        </View>
        <Text style={styles.rowSub}>
          Master switch. When off, no push notifications are sent to this device.
        </Text>
      </View>

      {CATEGORIES.map((cat) => {
        const on = categoryEnabled(cat.types, overridesMap, masterOn);
        return (
          <View key={cat.key} style={styles.card}>
            <View style={styles.rowHead}>
              <Text style={styles.rowTitle}>{cat.label}</Text>
              <Switch
                value={on}
                onValueChange={(v) => setCategoryPush(cat, v)}
                disabled={!masterOn || saving !== null}
                testID={`switch-push-category-${cat.key}`}
              />
            </View>
            <Text style={styles.rowSub}>{cat.description}</Text>
          </View>
        );
      })}

      {error ? (
        <Text style={styles.error} testID="text-notif-prefs-save-error">
          {error}
        </Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  card: { backgroundColor: colors.surface, borderRadius: 10, padding: spacing(2), gap: spacing(1) },
  rowHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rowTitle: { color: colors.text, fontWeight: "600", fontSize: 15 },
  rowSub: { color: colors.textMuted, fontSize: 12 },
  error: { color: colors.danger, fontSize: 13, paddingHorizontal: spacing(1) },
});
