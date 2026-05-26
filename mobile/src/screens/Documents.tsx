import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import Pdf from "react-native-pdf";

import { SyncStatusBar } from "@/components/SyncStatusBar";
import { api, baseUrl, getAuthToken } from "@/api/client";
import { cacheList, cachePut, getDb } from "@/sync/db";
import { colors, spacing } from "@/theme";

/**
 * Read-only mobile Documents browser.
 *
 * Field workers browse a project's specs / contracts / submittals on-site
 * and can pin individual files for offline access. Strictly read-only —
 * no upload / edit / delete (those flows live on the web app).
 *
 * Cache layout (cache_entities):
 *   PROJECT_DOCUMENT  — per-file metadata pulled from
 *                       GET /api/projects/:code/documents. Cached so the
 *                       folder list and search work offline once seen.
 *                       Payload carries `projectId` so we can filter the
 *                       global cache by current project.
 *   DOCUMENT_PIN      — files the user pinned for offline. Payload:
 *                       { id, doc, localPath, pinnedAt }. The file bytes
 *                       live at FileSystem.documentDirectory/documents/<id>.
 *
 * Online viewing downloads the file to FileSystem.cacheDirectory and
 * hands off to the OS opener via expo-sharing (PDFs / Office / generic).
 * Images are rendered inline in a modal.
 */

type CachedProject = {
  id: string;
  code?: string;
  name?: string;
  title?: string;
};

type ProjectDocument = {
  id: string;
  projectId?: string;
  projectCode?: string;
  title?: string;
  fileName?: string;
  mimeType?: string | null;
  fileSize?: number | null;
  type?: string | null;
  uploadedAt?: string;
};

type PinRecord = {
  id: string;
  doc: ProjectDocument;
  localPath: string;
  pinnedAt: string;
};

const PIN_DIR = `${FileSystem.documentDirectory ?? ""}documents/`;

async function ensurePinDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(PIN_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(PIN_DIR, { intermediates: true });
  }
}

function extFromDoc(doc: ProjectDocument): string {
  const name = doc.fileName ?? "";
  const dot = name.lastIndexOf(".");
  if (dot >= 0 && dot < name.length - 1) return name.slice(dot).toLowerCase();
  const mt = (doc.mimeType ?? "").toLowerCase();
  if (mt.includes("pdf")) return ".pdf";
  if (mt.includes("png")) return ".png";
  if (mt.includes("jpeg") || mt.includes("jpg")) return ".jpg";
  return "";
}

function isImage(doc: ProjectDocument): boolean {
  const mt = (doc.mimeType ?? "").toLowerCase();
  if (mt.startsWith("image/")) return true;
  return /\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(doc.fileName ?? "");
}

function isPdf(doc: ProjectDocument): boolean {
  const mt = (doc.mimeType ?? "").toLowerCase();
  if (mt.includes("pdf")) return true;
  return /\.pdf$/i.test(doc.fileName ?? "");
}

function formatBytes(size?: number | null): string {
  if (!size || size <= 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Downloads /api/projects/:code/documents/:docId/stream to `dest` using the
 * stored auth cookie. Server-side this endpoint enforces the same per-file
 * ACL the web viewer does; the response is the raw file bytes (signed URLs
 * are minted internally with a 5-min TTL and consumed server-side, so the
 * client never needs to refresh them).
 */
async function downloadDocument(
  projectCode: string,
  doc: ProjectDocument,
  dest: string,
): Promise<void> {
  const token = await getAuthToken();
  const headers: Record<string, string> = {};
  if (token) headers["Cookie"] = `auth_token=${token}`;
  const url = `${baseUrl}/api/projects/${encodeURIComponent(projectCode)}/documents/${encodeURIComponent(doc.id)}/stream`;
  const res = await FileSystem.downloadAsync(url, dest, { headers });
  if (res.status < 200 || res.status >= 300) {
    try {
      await FileSystem.deleteAsync(dest, { idempotent: true });
    } catch {
      // best-effort cleanup
    }
    throw new Error(`Download failed (HTTP ${res.status})`);
  }
}

export function DocumentsScreen() {
  const [projects, setProjects] = useState<CachedProject[]>([]);
  const [activeProject, setActiveProject] = useState<CachedProject | null>(null);

  useEffect(() => {
    void cacheList<CachedProject>("PROJECT").then(setProjects);
  }, []);

  if (activeProject) {
    return (
      <ProjectDocuments
        project={activeProject}
        onBack={() => setActiveProject(null)}
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SyncStatusBar />
      <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(1) }}>
        <Text style={{ color: colors.textMuted }}>
          Pick a project to browse its specs, contracts, and submittals.
        </Text>
        {projects.length === 0 ? (
          <Text style={{ color: colors.textMuted, marginTop: spacing(2) }} testID="text-documents-no-projects">
            No projects cached. Sign in online once to pull your projects.
          </Text>
        ) : (
          projects.map((p) => (
            <Pressable
              key={p.id}
              style={styles.row}
              onPress={() => setActiveProject(p)}
              testID={`button-documents-project-${p.id}`}
            >
              <Text style={styles.rowTitle}>{p.name ?? p.title ?? p.id}</Text>
              <Text style={styles.rowSub}>{p.code ?? ""}</Text>
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function ProjectDocuments({
  project,
  onBack,
}: {
  project: CachedProject;
  onBack: () => void;
}) {
  const [docs, setDocs] = useState<ProjectDocument[]>([]);
  const [pins, setPins] = useState<Record<string, PinRecord>>({});
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<Record<string, "download" | "pin" | "unpin">>({});
  const [imageView, setImageView] = useState<{ uri: string; doc: ProjectDocument } | null>(null);
  const [pdfView, setPdfView] = useState<{ uri: string; doc: ProjectDocument } | null>(null);

  async function loadCachedDocs(): Promise<void> {
    const all = await cacheList<ProjectDocument>("PROJECT_DOCUMENT");
    setDocs(all.filter((d) => d.projectId === project.id || d.projectCode === project.code));
    const pinList = await cacheList<PinRecord>("DOCUMENT_PIN");
    const map: Record<string, PinRecord> = {};
    for (const p of pinList) map[p.id] = p;
    setPins(map);
  }

  async function refreshFromServer(): Promise<void> {
    if (!project.code) {
      setError("Project has no code; cannot fetch documents.");
      return;
    }
    setRefreshing(true);
    setError(null);
    try {
      const remote = await api<ProjectDocument[]>(
        `/api/projects/${encodeURIComponent(project.code)}/documents`,
      );
      for (const d of remote) {
        const enriched: ProjectDocument = {
          ...d,
          projectId: d.projectId ?? project.id,
          projectCode: d.projectCode ?? project.code,
        };
        await cachePut(
          "PROJECT_DOCUMENT",
          d.id,
          enriched,
          enriched.uploadedAt ?? new Date().toISOString(),
        );
      }
      // Drop cached metadata for documents that no longer exist server-side.
      const remoteIds = new Set(remote.map((d) => d.id));
      const db = await getDb();
      const localRows = await cacheList<ProjectDocument>("PROJECT_DOCUMENT");
      for (const local of localRows) {
        if (
          (local.projectId === project.id || local.projectCode === project.code) &&
          !remoteIds.has(local.id)
        ) {
          await db.runAsync(
            "DELETE FROM cache_entities WHERE entity_type = ? AND id = ?",
            ["PROJECT_DOCUMENT", local.id],
          );
        }
      }
      await loadCachedDocs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load documents");
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function init() {
      setLoading(true);
      await ensurePinDir();
      await loadCachedDocs();
      if (cancelled) return;
      setLoading(false);
      void refreshFromServer();
    }
    void init();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? docs.filter(
          (d) =>
            (d.fileName ?? "").toLowerCase().includes(q) ||
            (d.title ?? "").toLowerCase().includes(q),
        )
      : docs;
    return [...list].sort((a, b) => (a.uploadedAt ?? "") < (b.uploadedAt ?? "") ? 1 : -1);
  }, [docs, query]);

  // Group by `type` (the doc category from the web library — SPEC,
  // CONTRACT, SUBMITTAL, etc). Falls back to UNCATEGORIZED so legacy
  // rows without a type still render.
  const grouped = useMemo(() => {
    const m = new Map<string, ProjectDocument[]>();
    for (const d of filtered) {
      const key = (d.type ?? "UNCATEGORIZED").toString();
      const arr = m.get(key) ?? [];
      arr.push(d);
      m.set(key, arr);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  function setDocBusy(id: string, kind: "download" | "pin" | "unpin" | null) {
    setBusy((b) => {
      const next = { ...b };
      if (kind === null) delete next[id];
      else next[id] = kind;
      return next;
    });
  }

  async function openDoc(doc: ProjectDocument): Promise<void> {
    const pinned = pins[doc.id];
    let localUri: string;
    if (pinned) {
      const info = await FileSystem.getInfoAsync(pinned.localPath);
      if (!info.exists) {
        Alert.alert("File missing", "The pinned copy is gone. Re-pinning…");
        await unpinDoc(doc);
        return;
      }
      localUri = pinned.localPath;
    } else {
      if (!project.code) return;
      setDocBusy(doc.id, "download");
      try {
        const dest = `${FileSystem.cacheDirectory}doc-${doc.id}${extFromDoc(doc)}`;
        await downloadDocument(project.code, doc, dest);
        localUri = dest;
      } catch (e) {
        Alert.alert("Could not open", e instanceof Error ? e.message : "Download failed");
        setDocBusy(doc.id, null);
        return;
      }
      setDocBusy(doc.id, null);
    }

    if (isImage(doc)) {
      setImageView({ uri: localUri, doc });
      return;
    }

    if (isPdf(doc)) {
      // PDFs render in-app via react-native-pdf so the user never
      // leaves SmartManageAI to look at a spec or contract. The
      // viewer reads the file directly from local storage (the
      // download dest above), so both online-streamed and pinned
      // copies render through the same path.
      setPdfView({ uri: localUri, doc });
      return;
    }

    const canShare = await Sharing.isAvailableAsync();
    if (!canShare) {
      Alert.alert("Cannot open", "Sharing is not available on this device.");
      return;
    }
    try {
      await Sharing.shareAsync(localUri, {
        mimeType: doc.mimeType ?? undefined,
        UTI: doc.mimeType?.includes("pdf") ? "com.adobe.pdf" : undefined,
        dialogTitle: doc.fileName ?? doc.title ?? "Open document",
      });
    } catch (e) {
      Alert.alert("Could not open", e instanceof Error ? e.message : "Open failed");
    }
  }

  async function pinDoc(doc: ProjectDocument): Promise<void> {
    if (!project.code) return;
    setDocBusy(doc.id, "pin");
    try {
      await ensurePinDir();
      const dest = `${PIN_DIR}${doc.id}${extFromDoc(doc)}`;
      await downloadDocument(project.code, doc, dest);
      const rec: PinRecord = {
        id: doc.id,
        doc,
        localPath: dest,
        pinnedAt: new Date().toISOString(),
      };
      await cachePut("DOCUMENT_PIN", doc.id, rec, rec.pinnedAt);
      setPins((p) => ({ ...p, [doc.id]: rec }));
    } catch (e) {
      Alert.alert("Pin failed", e instanceof Error ? e.message : "Could not download file");
    } finally {
      setDocBusy(doc.id, null);
    }
  }

  async function unpinDoc(doc: ProjectDocument): Promise<void> {
    setDocBusy(doc.id, "unpin");
    try {
      const pinned = pins[doc.id];
      if (pinned) {
        try {
          await FileSystem.deleteAsync(pinned.localPath, { idempotent: true });
        } catch {
          // file may already be gone — proceed with metadata cleanup
        }
      }
      const db = await getDb();
      await db.runAsync(
        "DELETE FROM cache_entities WHERE entity_type = ? AND id = ?",
        ["DOCUMENT_PIN", doc.id],
      );
      setPins((p) => {
        const next = { ...p };
        delete next[doc.id];
        return next;
      });
    } finally {
      setDocBusy(doc.id, null);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SyncStatusBar />
      <View style={styles.header}>
        <Pressable onPress={onBack} testID="button-documents-back">
          <Text style={styles.headerLink}>‹ Projects</Text>
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {project.name ?? project.title ?? project.code ?? project.id}
        </Text>
        <Pressable onPress={() => void refreshFromServer()} disabled={refreshing} testID="button-documents-refresh">
          <Text style={[styles.headerLink, refreshing && { opacity: 0.5 }]}>
            {refreshing ? "…" : "Refresh"}
          </Text>
        </Pressable>
      </View>
      <View style={{ padding: spacing(2), paddingBottom: 0 }}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search filename or title"
          placeholderTextColor={colors.textMuted}
          autoCorrect={false}
          autoCapitalize="none"
          style={styles.search}
          testID="input-documents-search"
        />
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(1) }}>
        {loading ? (
          <ActivityIndicator color={colors.text} />
        ) : error && docs.length === 0 ? (
          <Text style={{ color: colors.danger }} testID="text-documents-error">{error}</Text>
        ) : grouped.length === 0 ? (
          <Text style={{ color: colors.textMuted }} testID="text-documents-empty">
            {query
              ? "No documents match your search."
              : "No documents in this project yet."}
          </Text>
        ) : (
          grouped.map(([category, items]) => (
            <View key={category} style={{ gap: spacing(1) }}>
              <Text style={styles.section}>
                {category.replace(/_/g, " ")} · {items.length}
              </Text>
              {items.map((doc) => {
                const pinned = !!pins[doc.id];
                const state = busy[doc.id];
                return (
                  <View key={doc.id} style={styles.row} testID={`row-document-${doc.id}`}>
                    <Pressable onPress={() => void openDoc(doc)} style={{ flex: 1 }}>
                      <Text style={styles.rowTitle} numberOfLines={2}>
                        {doc.title ?? doc.fileName ?? doc.id}
                      </Text>
                      <Text style={styles.rowSub} numberOfLines={1}>
                        {doc.fileName ?? ""}
                        {doc.fileSize ? ` · ${formatBytes(doc.fileSize)}` : ""}
                        {pinned ? " · Pinned" : ""}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => (pinned ? void unpinDoc(doc) : void pinDoc(doc))}
                      disabled={state === "pin" || state === "unpin"}
                      style={[styles.pinBtn, pinned && styles.pinBtnActive]}
                      testID={`button-document-pin-${doc.id}`}
                    >
                      {state === "pin" || state === "unpin" ? (
                        <ActivityIndicator size="small" color={pinned ? "#fff" : colors.text} />
                      ) : (
                        <Text style={[styles.pinBtnText, pinned && { color: "#fff" }]}>
                          {pinned ? "Unpin" : "Pin"}
                        </Text>
                      )}
                    </Pressable>
                  </View>
                );
              })}
            </View>
          ))
        )}
        {error && docs.length > 0 ? (
          <Text style={{ color: colors.textMuted, marginTop: spacing(1) }}>
            Showing cached list ({error})
          </Text>
        ) : null}
      </ScrollView>

      <Modal
        visible={pdfView !== null}
        animationType="slide"
        onRequestClose={() => setPdfView(null)}
      >
        <View style={{ flex: 1, backgroundColor: "#111" }}>
          <View style={styles.imageHeader}>
            <Text style={styles.imageTitle} numberOfLines={1}>
              {pdfView?.doc.title ?? pdfView?.doc.fileName ?? ""}
            </Text>
            <Pressable onPress={() => setPdfView(null)} testID="button-document-pdf-close">
              <Text style={styles.headerLink}>Close</Text>
            </Pressable>
          </View>
          {pdfView ? (
            <Pdf
              source={{ uri: pdfView.uri, cache: true }}
              style={{ flex: 1, backgroundColor: "#111" }}
              enablePaging
              onError={(err) => {
                Alert.alert(
                  "Could not render PDF",
                  err instanceof Error ? err.message : String(err ?? "Unknown error"),
                );
                setPdfView(null);
              }}
              testID={`pdf-document-${pdfView.doc.id}`}
            />
          ) : null}
        </View>
      </Modal>

      <Modal
        visible={imageView !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setImageView(null)}
      >
        <View style={styles.imageBackdrop}>
          <View style={styles.imageHeader}>
            <Text style={styles.imageTitle} numberOfLines={1}>
              {imageView?.doc.title ?? imageView?.doc.fileName ?? ""}
            </Text>
            <Pressable onPress={() => setImageView(null)} testID="button-document-image-close">
              <Text style={styles.headerLink}>Close</Text>
            </Pressable>
          </View>
          {imageView ? (
            <Image
              source={{ uri: imageView.uri }}
              style={{ flex: 1, width: "100%" }}
              resizeMode="contain"
              testID={`img-document-${imageView.doc.id}`}
            />
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    backgroundColor: colors.surface,
    padding: spacing(2),
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(2),
  },
  rowTitle: { color: colors.text, fontWeight: "600" },
  rowSub: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  section: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    marginTop: spacing(1),
    textTransform: "uppercase",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(1.5),
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing(2),
  },
  headerLink: { color: colors.primary, fontWeight: "600" },
  headerTitle: { color: colors.text, fontWeight: "700", flex: 1, textAlign: "center" },
  search: {
    backgroundColor: colors.surface,
    color: colors.text,
    padding: spacing(1.5),
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pinBtn: {
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(1),
    borderRadius: 6,
    backgroundColor: colors.surfaceMuted,
    minWidth: 64,
    alignItems: "center",
  },
  pinBtnActive: { backgroundColor: colors.primary },
  pinBtnText: { color: colors.text, fontWeight: "600", fontSize: 13 },
  imageBackdrop: { flex: 1, backgroundColor: "#000" },
  imageHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: spacing(2),
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  imageTitle: { color: "#fff", fontWeight: "600", flex: 1, marginRight: spacing(2) },
});
