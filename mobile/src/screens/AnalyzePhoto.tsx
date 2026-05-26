import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";

import { SyncStatusBar } from "@/components/SyncStatusBar";
import { api, ApiError } from "@/api/client";
import { cacheList } from "@/sync/db";
import { colors, spacing } from "@/theme";

type CachedProject = { id: string; name?: string; title?: string };

type AnalyzePhotoParams = { initialUri?: string };

type Picked = {
  uri: string;
  mime: string;
  name: string;
  size: number;
};

type SafetyFinding = {
  id?: string;
  severity?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | string;
  category?: string;
  description?: string;
  recommendation?: string;
  location?: string;
};

type ProgressFinding = {
  id?: string;
  workArea?: string;
  tradeType?: string;
  estimatedComplete?: number;
  observations?: string;
};

type Summary = {
  overallSafetyScore?: number;
  estimatedCompletion?: number;
  crewCountEstimate?: number;
  weatherConditions?: string;
  primaryConcerns?: string[];
  analysisMethod?: string;
};

type AnalysisResult = {
  status: string;
  summary?: Summary | null;
  safetyFindings?: SafetyFinding[];
  progressFindings?: ProgressFinding[];
  aiNotes?: string | null;
};

type Stage = "idle" | "uploading" | "queued" | "analyzing" | "complete" | "failed";

const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: "#dc2626",
  HIGH: "#ea580c",
  MEDIUM: "#ca8a04",
  LOW: "#2563eb",
};

const POLL_INTERVAL_MS = 2500;
const MAX_POLLS = 40;

export function AnalyzePhotoScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<RouteProp<Record<string, AnalyzePhotoParams | undefined>, string>>();
  const initialUri = route.params?.initialUri;

  const [projects, setProjects] = useState<CachedProject[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [area, setArea] = useState<string>("");
  const [picked, setPicked] = useState<Picked | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);

  useEffect(() => {
    void cacheList<CachedProject>("PROJECT").then((p) => {
      setProjects(p);
      setProjectId((cur) => cur ?? p[0]?.id ?? null);
    });
  }, []);

  useEffect(() => {
    if (initialUri && !picked) {
      setPicked({
        uri: initialUri,
        mime: "image/jpeg",
        name: `photo-${Date.now()}.jpg`,
        size: 0,
      });
    }
  }, [initialUri, picked]);

  async function captureFromCamera() {
    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (res.canceled) return;
    const a = res.assets[0];
    setPicked({
      uri: a.uri,
      mime: a.mimeType ?? "image/jpeg",
      name: a.fileName ?? `jobsite-${Date.now()}.jpg`,
      size: a.fileSize ?? 0,
    });
    setResult(null);
    setError(null);
    setBatchId(null);
    setStage("idle");
  }

  async function pickFromLibrary() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (res.canceled) return;
    const a = res.assets[0];
    setPicked({
      uri: a.uri,
      mime: a.mimeType ?? "image/jpeg",
      name: a.fileName ?? `jobsite-${Date.now()}.jpg`,
      size: a.fileSize ?? 0,
    });
    setResult(null);
    setError(null);
    setBatchId(null);
    setStage("idle");
  }

  function fmtErr(e: unknown): string {
    if (e instanceof ApiError) {
      const body = e.body as { error?: string } | string | null;
      if (body && typeof body === "object" && body.error) return body.error;
      return `Request failed (${e.status})`;
    }
    if (e instanceof Error) return e.message;
    return "Something went wrong";
  }

  async function uploadPhoto(p: Picked): Promise<{ fileUrl: string; fileKey: string }> {
    let size = p.size;
    if (!size) {
      try {
        const info = await FileSystem.getInfoAsync(p.uri);
        if (info.exists && typeof (info as { size?: number }).size === "number") {
          size = (info as { size?: number }).size ?? 0;
        }
      } catch {
        /* size optional best-effort */
      }
    }
    if (!size) size = 1;

    const upload = await api<{ uploadURL?: string; uploadUrl?: string; intentId: string; objectKey: string }>(
      "/api/objects/upload",
      {
        method: "POST",
        body: JSON.stringify({
          contentType: p.mime,
          fileSize: size,
          fileType: "MEDIA",
        }),
      }
    );
    const uploadUrl = upload.uploadURL ?? upload.uploadUrl;
    if (!uploadUrl) throw new Error("Server did not return an upload URL");

    const putRes = await FileSystem.uploadAsync(uploadUrl, p.uri, {
      httpMethod: "PUT",
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: { "Content-Type": p.mime },
    });
    if (putRes.status < 200 || putRes.status >= 300) {
      throw new Error(`Photo upload failed (${putRes.status})`);
    }

    const confirmed = await api<{ objectPath?: string; objectKey?: string }>(
      "/api/objects/confirm",
      {
        method: "POST",
        body: JSON.stringify({
          intentId: upload.intentId,
          aclPolicy: { visibility: "private" },
        }),
      }
    );
    return {
      fileUrl: confirmed.objectPath ?? `/objects/${upload.objectKey}`,
      fileKey: confirmed.objectKey ?? upload.objectKey,
    };
  }

  async function pollResult(id: string): Promise<AnalysisResult> {
    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const r = await api<AnalysisResult>(`/api/ai-features/jobsite/results/${id}`);
      if (r.status === "COMPLETE" || r.status === "FAILED") {
        return r;
      }
    }
    throw new Error("Analysis timed out — results will appear in your project later");
  }

  async function analyze() {
    if (!picked) return;
    if (!projectId) {
      setError("Please choose a project before analyzing.");
      return;
    }
    setError(null);
    setResult(null);
    setBatchId(null);

    try {
      setStage("uploading");
      const uploaded = await uploadPhoto(picked);

      setStage("queued");
      const created = await api<{ batchId: string }>("/api/ai-features/jobsite/analyze", {
        method: "POST",
        body: JSON.stringify({
          projectId,
          date: new Date().toISOString().slice(0, 10),
          analysisTypes: ["SAFETY", "PROGRESS"],
          notes: area.trim() || undefined,
        }),
      });
      setBatchId(created.batchId);

      await api(`/api/ai-features/jobsite/${created.batchId}/attach-photos`, {
        method: "POST",
        body: JSON.stringify({
          photos: [
            {
              fileUrl: uploaded.fileUrl,
              fileKey: uploaded.fileKey,
              originalFilename: picked.name,
            },
          ],
        }),
      });

      setStage("analyzing");
      const r = await pollResult(created.batchId);
      setResult(r);
      setStage(r.status === "FAILED" ? "failed" : "complete");
      if (r.status === "FAILED") setError("The AI analysis didn't finish. Try again with a clearer photo.");
    } catch (e) {
      setError(fmtErr(e));
      setStage("failed");
    }
  }

  function reset() {
    setPicked(null);
    setResult(null);
    setError(null);
    setBatchId(null);
    setStage("idle");
  }

  function reportAsIncident() {
    if (!picked) return;
    const safety = result?.safetyFindings ?? [];
    const lines: string[] = ["AI jobsite analysis flagged:"];
    for (const f of safety.slice(0, 5)) {
      lines.push(`• [${(f.severity ?? "MEDIUM").toString().toUpperCase()}] ${f.description ?? ""}`);
      if (f.recommendation) lines.push(`  Suggested action: ${f.recommendation}`);
    }
    if (area.trim()) lines.push(`Area: ${area.trim()}`);
    const description = lines.join("\n");
    const worst = safety.reduce<string>((acc, f) => {
      const order = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
      const s = (f.severity ?? "MEDIUM").toString().toUpperCase();
      return order.indexOf(s) > order.indexOf(acc) ? s : acc;
    }, "MEDIUM");

    nav.navigate("ReportIncident", {
      prefill: {
        projectId,
        description,
        severity: worst,
        photo: {
          localId: `analysis-${Date.now()}`,
          uri: picked.uri,
          mime: picked.mime,
          name: picked.name,
        },
      },
    });
  }

  const isWorking = stage === "uploading" || stage === "queued" || stage === "analyzing";
  const safety = result?.safetyFindings ?? [];
  const progress = result?.progressFindings ?? [];
  const summary = result?.summary ?? null;

  const stageLabel = useMemo(() => {
    switch (stage) {
      case "uploading":
        return "Uploading photo…";
      case "queued":
        return "Sending to AI…";
      case "analyzing":
        return "Analyzing jobsite…";
      default:
        return "";
    }
  }, [stage]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SyncStatusBar />
      <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(2) }}>
        <Text style={styles.h1}>Analyze jobsite photo</Text>
        <Text style={styles.helper}>
          Snap or pick a photo and AI will flag PPE/fall hazards and progress notes.
        </Text>

        <Text style={styles.label}>Project</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ flexDirection: "row", gap: spacing(1) }}>
            {projects.map((p) => (
              <Pressable
                key={p.id}
                onPress={() => setProjectId(p.id)}
                style={[styles.chip, projectId === p.id && styles.chipActive]}
                testID={`chip-analyze-project-${p.id}`}
              >
                <Text style={[styles.chipText, projectId === p.id && styles.chipTextActive]}>
                  {p.name ?? p.title ?? p.id.slice(0, 6)}
                </Text>
              </Pressable>
            ))}
            {projects.length === 0 && (
              <Text style={styles.helper}>No projects synced yet.</Text>
            )}
          </View>
        </ScrollView>

        <Text style={styles.label}>Area / location (optional)</Text>
        <TextInput
          placeholder="e.g. Bay 3, near scaffold"
          placeholderTextColor={colors.textMuted}
          value={area}
          onChangeText={setArea}
          style={styles.input}
          testID="input-analyze-area"
        />

        <View style={{ flexDirection: "row", gap: spacing(1) }}>
          <Pressable
            onPress={captureFromCamera}
            disabled={isWorking}
            style={[styles.btn, { flex: 1 }]}
            testID="button-analyze-camera"
          >
            <Text style={styles.btnText}>Take photo</Text>
          </Pressable>
          <Pressable
            onPress={pickFromLibrary}
            disabled={isWorking}
            style={[styles.btn, { flex: 1, backgroundColor: colors.surface }]}
            testID="button-analyze-gallery"
          >
            <Text style={[styles.btnText, { color: colors.text }]}>From gallery</Text>
          </Pressable>
        </View>

        {picked && (
          <View style={styles.previewWrap} testID="view-analyze-preview">
            <Image source={{ uri: picked.uri }} style={styles.preview} />
          </View>
        )}

        <Pressable
          onPress={analyze}
          disabled={!picked || isWorking}
          style={[
            styles.btn,
            {
              backgroundColor: !picked || isWorking ? colors.surfaceMuted : colors.primary,
              padding: spacing(2.5),
            },
          ]}
          testID="button-analyze-run"
        >
          {isWorking ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing(1) }}>
              <ActivityIndicator color="#fff" />
              <Text style={[styles.btnText, { fontSize: 16 }]}>{stageLabel}</Text>
            </View>
          ) : (
            <Text style={[styles.btnText, { fontSize: 16 }]}>
              {result ? "Analyze again" : "Analyze"}
            </Text>
          )}
        </Pressable>

        {error && (
          <View style={styles.errorBox} testID="text-analyze-error">
            <Text style={styles.errorText}>{error}</Text>
            {stage === "failed" && (
              <Pressable
                onPress={analyze}
                style={[styles.btn, { backgroundColor: colors.surface, marginTop: spacing(1) }]}
                testID="button-analyze-retry"
              >
                <Text style={[styles.btnText, { color: colors.text }]}>Retry</Text>
              </Pressable>
            )}
          </View>
        )}

        {result && stage === "complete" && (
          <View style={styles.resultsCard} testID="card-analyze-results">
            <Text style={styles.cardTitle}>AI findings</Text>

            {summary && (
              <View style={styles.summaryRow}>
                {typeof summary.overallSafetyScore === "number" && (
                  <View style={styles.statTile}>
                    <Text style={styles.statValue}>{Math.round(summary.overallSafetyScore)}</Text>
                    <Text style={styles.statLabel}>Safety score</Text>
                  </View>
                )}
                {typeof summary.estimatedCompletion === "number" && (
                  <View style={styles.statTile}>
                    <Text style={styles.statValue}>{Math.round(summary.estimatedCompletion)}%</Text>
                    <Text style={styles.statLabel}>Progress</Text>
                  </View>
                )}
                {typeof summary.crewCountEstimate === "number" && (
                  <View style={styles.statTile}>
                    <Text style={styles.statValue}>{summary.crewCountEstimate}</Text>
                    <Text style={styles.statLabel}>Crew</Text>
                  </View>
                )}
              </View>
            )}

            {summary?.analysisMethod && (summary.analysisMethod.includes("Fallback") || summary.analysisMethod.includes("Demo")) && (
              <View style={styles.fallbackBanner} testID="banner-analyze-fallback">
                <Text style={styles.fallbackText}>
                  AI vision unavailable — showing sample findings. Try again later.
                </Text>
              </View>
            )}

            <Text style={styles.sectionLabel}>Safety findings ({safety.length})</Text>
            {safety.length === 0 ? (
              <Text style={styles.helper}>No safety issues detected.</Text>
            ) : (
              safety.map((f, i) => (
                <View key={f.id ?? i} style={styles.findingRow} testID={`row-safety-${i}`}>
                  <View
                    style={[
                      styles.sevPill,
                      { backgroundColor: SEVERITY_COLOR[String(f.severity ?? "").toUpperCase()] ?? colors.surfaceMuted },
                    ]}
                  >
                    <Text style={styles.sevPillText}>{(f.severity ?? "MED").toString().slice(0, 4)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.findingTitle}>{f.description ?? "Issue"}</Text>
                    {f.recommendation ? (
                      <Text style={styles.findingSub}>{f.recommendation}</Text>
                    ) : null}
                  </View>
                </View>
              ))
            )}

            <Text style={styles.sectionLabel}>Progress notes ({progress.length})</Text>
            {progress.length === 0 ? (
              <Text style={styles.helper}>No progress notes.</Text>
            ) : (
              progress.map((p, i) => (
                <View key={p.id ?? i} style={styles.findingRow} testID={`row-progress-${i}`}>
                  <View style={[styles.sevPill, { backgroundColor: colors.primary }]}>
                    <Text style={styles.sevPillText}>
                      {typeof p.estimatedComplete === "number" ? `${Math.round(p.estimatedComplete)}%` : "—"}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.findingTitle}>{p.workArea ?? "Work area"}</Text>
                    {p.observations ? <Text style={styles.findingSub}>{p.observations}</Text> : null}
                  </View>
                </View>
              ))
            )}

            {result.aiNotes ? (
              <View style={styles.notesBox}>
                <Text style={styles.findingSub}>{result.aiNotes}</Text>
              </View>
            ) : null}

            {safety.length > 0 && (
              <Pressable
                onPress={reportAsIncident}
                style={[styles.btn, { backgroundColor: colors.danger, marginTop: spacing(2) }]}
                testID="button-report-as-incident"
              >
                <Text style={styles.btnText}>Report as incident</Text>
              </Pressable>
            )}

            <Pressable
              onPress={reset}
              style={[styles.btn, { backgroundColor: colors.surface, marginTop: spacing(1) }]}
              testID="button-analyze-reset"
            >
              <Text style={[styles.btnText, { color: colors.text }]}>Analyze a different photo</Text>
            </Pressable>

            {batchId ? (
              <Text style={[styles.helper, { marginTop: spacing(1) }]} testID="text-analyze-batch">
                Saved to project as batch {batchId.slice(0, 8)}…
              </Text>
            ) : null}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  h1: { color: colors.text, fontSize: 22, fontWeight: "700" },
  label: { color: colors.text, fontWeight: "600", marginTop: spacing(1) },
  helper: { color: colors.textMuted, fontSize: 12 },
  input: {
    backgroundColor: colors.surface,
    color: colors.text,
    padding: spacing(2),
    borderRadius: 8,
  },
  btn: { backgroundColor: colors.primary, padding: spacing(2), borderRadius: 8, alignItems: "center" },
  btnText: { color: "#fff", fontWeight: "600" },
  chip: {
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(1),
    backgroundColor: colors.surface,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.text },
  chipTextActive: { color: "#fff", fontWeight: "600" },
  previewWrap: {
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: colors.surface,
  },
  preview: { width: "100%", height: 240 },
  errorBox: {
    backgroundColor: "#7f1d1d",
    padding: spacing(2),
    borderRadius: 8,
  },
  errorText: { color: "#fee2e2", fontWeight: "600" },
  resultsCard: {
    backgroundColor: colors.surface,
    padding: spacing(2),
    borderRadius: 10,
    gap: spacing(1),
  },
  cardTitle: { color: colors.text, fontSize: 18, fontWeight: "700" },
  summaryRow: { flexDirection: "row", gap: spacing(1) },
  statTile: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: 8,
    padding: spacing(1.5),
    alignItems: "center",
  },
  statValue: { color: colors.text, fontSize: 20, fontWeight: "700" },
  statLabel: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  fallbackBanner: {
    backgroundColor: "#78350f",
    borderRadius: 6,
    padding: spacing(1.5),
  },
  fallbackText: { color: "#fde68a", fontSize: 12, fontWeight: "600" },
  sectionLabel: { color: colors.text, fontWeight: "700", marginTop: spacing(1) },
  findingRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing(1),
    backgroundColor: colors.background,
    padding: spacing(1.5),
    borderRadius: 8,
  },
  sevPill: {
    paddingHorizontal: spacing(1),
    paddingVertical: 4,
    borderRadius: 6,
    minWidth: 50,
    alignItems: "center",
  },
  sevPillText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  findingTitle: { color: colors.text, fontWeight: "600" },
  findingSub: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  notesBox: {
    backgroundColor: colors.background,
    padding: spacing(1.5),
    borderRadius: 8,
    marginTop: spacing(1),
  },
});
