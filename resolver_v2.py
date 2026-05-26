import sys

def resolve(filepath):
    # This is the "HEAD" (current version after Task #3102) content that we want to merge into "theirs"
    # Actually, Task #3102 already happened, we are Task #3107.
    # HEAD added: AI Insight viewing
    # Incoming (Task #3107) added: weather snapshot
    
    # Since we checked out --theirs, we have Task #3107 content.
    # We need to add Task #3102 (AI Insight) content.
    
    with open(filepath, "r") as f:
        content = f.read()

    # 1. Imports
    import_old = 'import React, { useEffect, useRef, useState } from "react";'
    import_new = 'import React, { useCallback, useEffect, useRef, useState } from "react";'
    content = content.replace(import_old, import_new)

    import_db = 'import { cacheList, cachePut, getMeta } from "@/sync/db";'
    import_api = import_db + '\nimport { api, ApiError } from "@/api/client";'
    content = content.replace(import_db, import_api)

    import_theme = 'import { colors, spacing } from "@/theme";'
    import_nav = import_theme + '\nimport type { CreateTaskPrefill } from "@/screens/CreateTask";'
    content = content.replace(import_theme, import_nav)

    # 2. DailyReportsNavParamList
    param_list = """
type DailyReportsNavParamList = {
  CreateTask: { prefill: CreateTaskPrefill };
};
"""
    content = content.replace('type DailyReport = {', param_list + '\ntype DailyReport = {')

    # 3. AIInsight type and isServerId helper
    ai_insight = """
// Mirror of the server-side AIInsight shape returned by
// GET /api/insights/daily-report/:reportId. Not persisted, so the mobile
// client treats this as a transient per-report payload.
type AIInsight = {
  category:
    | "SUPPLY_NEED"
    | "EQUIPMENT_REPAIR"
    | "WEATHER_DELAY"
    | "CHANGE_ORDER"
    | "SAFETY"
    | "CLIENT_COMMUNICATION"
    | "OTHER";
  summary: string;
  recommendedActions: string[];
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  recipients: string[];
  sourceNoteId: string;
  projectId: string | null;
  sourceType: "PROJECT" | "COMPANY";
};

// Server `id`s are UUIDs. Optimistic local rows use a `photo-…`/timestamp
// prefix and are not addressable on the server, so insights aren't
// requestable for them yet.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isServerId(id: string): boolean {
  return UUID_RE.test(id);
}
"""
    content = content.replace('type PendingAttachment = {', ai_insight + '\ntype PendingAttachment = {')

    # 4. expandedId state
    content = content.replace('const recorderRef = useRef<Audio.Recording | null>(null);', 
                              'const recorderRef = useRef<Audio.Recording | null>(null);\n  const [expandedId, setExpandedId] = useState<string | null>(null);')

    # 5. Rendering in ScrollView
    render_old = """      <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(1) }}>
        {items.map((it) => (
          <View key={it.id} style={styles.row} testID={`row-report-${it.id}`}>
            <Text style={styles.rowTitle}>{it.date}</Text>
            <Text style={styles.rowSub} numberOfLines={2}>{it.notes ?? ""}</Text>
          </View>
        ))}
        {items.length === 0 ? <Text style={{ color: colors.textMuted }}>No reports yet</Text> : null}
      </ScrollView>"""
    
    render_new = """      <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(1) }}>
        {items.map((it) => {
          const expanded = expandedId === it.id;
          const synced = isServerId(it.id);
          return (
            <View key={it.id} style={styles.row} testID={`row-report-${it.id}`}>
              <Pressable
                onPress={() => setExpandedId(expanded ? null : it.id)}
                testID={`button-toggle-report-${it.id}`}
              >
                <Text style={styles.rowTitle}>{it.date}</Text>
                <Text style={styles.rowSub} numberOfLines={expanded ? undefined : 2}>
                  {it.notes ?? ""}
                </Text>
                <Text style={styles.rowHint}>
                  {synced
                    ? expanded ? "Tap to collapse" : "Tap to view AI insights"
                    : "Syncing — insights available after upload"}
                </Text>
              </Pressable>
              {expanded && synced ? (
                <DailyReportInsights reportId={it.id} />
              ) : null}
            </View>
          );
        })}
        {items.length === 0 ? <Text style={{ color: colors.textMuted }}>No reports yet</Text> : null}
      </ScrollView>"""
    content = content.replace(render_old, render_new)

    # 6. DailyReportInsights component and sub-functions
    insights_comp = """
// Module-level cache so re-opening a report doesn't re-bill the LLM for
// insights we've already fetched in this session. The server endpoint is
// not idempotent (each call runs a fresh analysis) so we have to cache
// client-side.
const insightsCache = new Map<string, AIInsight[]>();

function DailyReportInsights({ reportId }: { reportId: string }) {
  const nav = useNavigation<NavigationProp<DailyReportsNavParamList>>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [insights, setInsights] = useState<AIInsight[] | null>(
    insightsCache.get(reportId) ?? null,
  );

  const fetchInsights = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ reportId: string; insights: AIInsight[] }>(
        `/api/insights/daily-report/${encodeURIComponent(reportId)}`
      );
      insightsCache.set(reportId, data.insights);
      setInsights(data.insights);
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? `Couldn't load insights (HTTP ${e.status})`
          : "Couldn't load insights. Check your connection.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [reportId]);

  useEffect(() => {
    if (insights === null && !loading && !error) {
      void fetchInsights();
    }
  }, [insights, loading, error, fetchInsights]);

  function convertToTask(insight: AIInsight) {
    const description = insight.recommendedActions.length
      ? insight.recommendedActions.map((a) => `• ${a}`).join("\\n")
      : undefined;
    const priority: NonNullable<CreateTaskPrefill["priority"]> =
      insight.severity === "CRITICAL"
        ? "CRITICAL"
        : insight.severity === "HIGH"
        ? "HIGH"
        : insight.severity === "LOW"
        ? "LOW"
        : "MEDIUM";
    // Hand off to the dedicated Create Task screen so the field user can
    // review / edit prefilled fields before saving. This is the required
    // "Convert to task" affordance — direct POSTs from this view would
    // silently create tasks without confirmation.
    nav.navigate("CreateTask", {
      prefill: {
        title: insight.summary.slice(0, 200),
        description,
        category: insight.category,
        priority,
        projectId: insight.projectId ?? null,
        sourceType: "AI_GENERATED",
        context: `daily_report:${reportId}`,
      },
    });
  }

  return (
    <View style={styles.insightsBox} testID={`insights-${reportId}`}>
      <Text style={styles.insightsHeader}>AI Insights</Text>
      {loading ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing(1) }}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.rowSub}>Analyzing report…</Text>
        </View>
      ) : null}
      {!loading && error ? (
        <View style={{ gap: spacing(1) }}>
          <Text style={[styles.rowSub, { color: colors.danger }]} testID={`insights-error-${reportId}`}>
            {error}
          </Text>
          <Pressable
            onPress={() => void fetchInsights()}
            style={[styles.btn, { backgroundColor: colors.primary }]}
            testID={`button-retry-insights-${reportId}`}
          >
            <Text style={styles.btnText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}
      {!loading && !error && insights && insights.length === 0 ? (
        <Text style={styles.rowSub} testID={`insights-empty-${reportId}`}>
          No action items detected.
        </Text>
      ) : null}
      {!loading && !error && insights && insights.length > 0
        ? insights.map((ins, idx) => (
            <View key={idx} style={styles.insightCard} testID={`insight-${reportId}-${idx}`}>
              <View style={{ flexDirection: "row", gap: spacing(1), flexWrap: "wrap" }}>
                <Badge text={ins.category.replace(/_/g, " ")} color={colors.primary} />
                <Badge text={ins.severity} color={severityColor(ins.severity)} />
              </View>
              <Text style={styles.insightSummary}>{ins.summary}</Text>
              {ins.recommendedActions.length > 0 ? (
                <View style={{ gap: 2 }}>
                  {ins.recommendedActions.map((a, i) => (
                    <Text key={i} style={styles.rowSub}>• {a}</Text>
                  ))}
                </View>
              ) : null}
              <Pressable
                onPress={() => convertToTask(ins)}
                style={[styles.btn, { backgroundColor: colors.success ?? "#16a34a" }]}
                testID={`button-convert-task-${reportId}-${idx}`}
              >
                <Text style={styles.btnText}>Convert to task</Text>
              </Pressable>
            </View>
          ))
        : null}
    </View>
  );
}

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <View style={{ backgroundColor: color, paddingHorizontal: spacing(1), paddingVertical: 2, borderRadius: 4 }}>
      <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>{text}</Text>
    </View>
  );
}

function severityColor(s: AIInsight["severity"]): string {
  switch (s) {
    case "CRITICAL": return "#b91c1c";
    case "HIGH": return "#dc2626";
    case "MEDIUM": return "#ca8a04";
    case "LOW": return colors.textMuted;
  }
}
"""
    content = content.replace('\nexport function DailyReportsScreen() {', insights_comp + '\nexport function DailyReportsScreen() {')

    # 7. Styles
    styles_old = """  row: { backgroundColor: colors.surface, padding: spacing(2), borderRadius: 8 },"""
    styles_new = """  row: { backgroundColor: colors.surface, padding: spacing(2), borderRadius: 8, gap: spacing(1) },
  rowTitle: { color: colors.text, fontWeight: "600" },
  rowSub: { color: colors.textMuted, fontSize: 12 },
  rowHint: { color: colors.textMuted, fontSize: 11, marginTop: 4, fontStyle: "italic" },
  insightsBox: { gap: spacing(1), borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing(1), marginTop: spacing(1) },
  insightsHeader: { color: colors.text, fontWeight: "700", fontSize: 14 },
  insightCard: { backgroundColor: colors.background, padding: spacing(1), borderRadius: 6, gap: spacing(1) },
  insightSummary: { color: colors.text, fontSize: 13, fontWeight: "500" },"""
    content = content.replace(styles_old, styles_new)
    
    # Remove duplicates of rowTitle/rowSub if they exist
    content = content.replace('  rowTitle: { color: colors.text, fontWeight: "600" },\n  rowSub: { color: colors.textMuted, fontSize: 12 },\n}', '}')

    with open(filepath, "w") as f:
        f.write(content)

resolve("mobile/src/screens/DailyReports.tsx")
resolve("mobile-standalone/src/screens/DailyReports.tsx")
