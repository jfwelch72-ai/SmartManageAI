import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { SyncStatusBar } from "@/components/SyncStatusBar";
import { useAuth } from "@/auth/AuthContext";
import { useSync } from "@/sync/SyncContext";
import { api } from "@/api/client";
import { cacheList, cachePut } from "@/sync/db";
import { enqueue, listOutbox } from "@/sync/outbox";
import { colors, spacing } from "@/theme";
import type { OutboxRecord } from "@/sync/types";

export interface AssignedTask {
  id: string;
  title: string;
  description?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  projectCode?: string | null;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "DISMISSED" | string;
  priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | string;
  category?: string | null;
  dueDate?: string | null;
  assignedToId?: string | null;
  updatedAt?: string;
}

interface TaskComment {
  id: string;
  content: string;
  createdByFirstName?: string | null;
  createdByLastName?: string | null;
  createdAt: string;
}

interface TaskAttachment {
  id: string;
  fileName: string;
  fileUrl: string;
  mimeType?: string | null;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function bucketize(tasks: AssignedTask[]): {
  overdue: AssignedTask[];
  today: AssignedTask[];
  upcoming: AssignedTask[];
  noDue: AssignedTask[];
} {
  const now = new Date();
  const todayStart = startOfDay(now);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const overdue: AssignedTask[] = [];
  const today: AssignedTask[] = [];
  const upcoming: AssignedTask[] = [];
  const noDue: AssignedTask[] = [];
  for (const t of tasks) {
    if (t.status === "COMPLETED" || t.status === "DISMISSED") continue;
    if (!t.dueDate) { noDue.push(t); continue; }
    const due = new Date(t.dueDate);
    if (due < todayStart) overdue.push(t);
    else if (due < tomorrowStart) today.push(t);
    else upcoming.push(t);
  }
  return { overdue, today, upcoming, noDue };
}

function priorityColor(p: string): string {
  switch (p) {
    case "CRITICAL": return "#dc2626";
    case "HIGH": return "#ea580c";
    case "MEDIUM": return "#ca8a04";
    case "LOW": return "#16a34a";
    default: return colors.textMuted;
  }
}

// Compute the unread/overdue badge count from the cache. Exposed so the
// Home tile can show the same number without re-fetching from the server.
export async function getOverdueTaskCount(userId: string | undefined): Promise<number> {
  if (!userId) return 0;
  const cached = await cacheList<AssignedTask>("TASK");
  const mine = cached.filter((t) => t.assignedToId === userId);
  const { overdue, today } = bucketize(mine);
  return overdue.length + today.length;
}

export function TasksScreen() {
  const { user } = useAuth();
  const { syncNow, lastResult } = useSync();
  const [tasks, setTasks] = useState<AssignedTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<AssignedTask | null>(null);
  const [pendingByTask, setPendingByTask] = useState<Map<string, OutboxRecord[]>>(new Map());

  const loadCached = useCallback(async () => {
    const cached = await cacheList<AssignedTask>("TASK");
    const mine = user?.id
      ? cached.filter((t) => t.assignedToId === user.id)
      : cached;
    setTasks(mine);
  }, [user?.id]);

  const loadPending = useCallback(async () => {
    const all = await listOutbox();
    const map = new Map<string, OutboxRecord[]>();
    for (const o of all) {
      if (o.entityType !== "TASK_UPDATE") continue;
      const tid = (o.payload as { taskId?: string })?.taskId;
      if (!tid) continue;
      const list = map.get(tid) ?? [];
      list.push(o);
      map.set(tid, list);
    }
    setPendingByTask(map);
  }, []);

  const fetchFromServer = useCallback(async () => {
    if (!user?.id) return;
    try {
      const list = await api<AssignedTask[]>(
        `/api/tasks?assignedToId=${encodeURIComponent(user.id)}`
      );
      // Cache each row so the list works offline. We cache the full
      // server payload to preserve project name / due date / etc.
      for (const t of list) {
        await cachePut("TASK", t.id, t, t.updatedAt ?? new Date().toISOString());
      }
      const mine = list.filter((t) => t.assignedToId === user.id);
      setTasks(mine);
    } catch (err) {
      // Offline / 401 / network — fall back to whatever's cached.
      console.warn("[tasks] fetch failed, using cache", err);
    }
  }, [user?.id]);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      await loadCached();
      await loadPending();
      await fetchFromServer();
      setLoading(false);
    })();
  }, [loadCached, loadPending, fetchFromServer]);

  // Re-pull pending after each sync so the per-task badge clears as
  // outbox rows drain.
  useEffect(() => { void loadPending(); }, [lastResult, loadPending]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchFromServer();
    await loadPending();
    setRefreshing(false);
    void syncNow();
  }, [fetchFromServer, loadPending, syncNow]);

  const buckets = useMemo(() => bucketize(tasks), [tasks]);

  async function updateStatus(task: AssignedTask, status: AssignedTask["status"], dismissReason?: string) {
    await enqueue({
      entityType: "TASK_UPDATE",
      operation: "UPDATE",
      serverId: task.id,
      payload: { kind: "STATUS", taskId: task.id, status, dismissReason },
    });
    // Optimistic: bump local cache + visible list.
    const next: AssignedTask = { ...task, status };
    await cachePut("TASK", task.id, next, new Date().toISOString());
    setTasks((prev) => prev.map((t) => (t.id === task.id ? next : t)));
    if (selected?.id === task.id) setSelected(next);
    await loadPending();
    void syncNow();
  }

  async function addComment(task: AssignedTask, content: string) {
    if (!content.trim()) return;
    await enqueue({
      entityType: "TASK_UPDATE",
      operation: "CREATE",
      serverId: task.id,
      payload: { kind: "COMMENT", taskId: task.id, content: content.trim() },
    });
    await loadPending();
    void syncNow();
  }

  if (selected) {
    return (
      <TaskDetail
        task={selected}
        pending={pendingByTask.get(selected.id) ?? []}
        onBack={() => setSelected(null)}
        onStatus={(s, reason) => updateStatus(selected, s, reason)}
        onComment={(c) => addComment(selected, c)}
      />
    );
  }

  const total = buckets.overdue.length + buckets.today.length + buckets.upcoming.length + buckets.noDue.length;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SyncStatusBar />
      <ScrollView
        contentContainerStyle={{ padding: spacing(2), gap: spacing(1) }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {loading ? <ActivityIndicator color={colors.primary} /> : null}
        {!loading && total === 0 ? (
          <Text style={{ color: colors.textMuted }} testID="text-tasks-empty">
            No tasks assigned to you. Pull down to refresh.
          </Text>
        ) : null}
        <Group title="Overdue" tint="#dc2626" items={buckets.overdue} pendingByTask={pendingByTask} onOpen={setSelected} />
        <Group title="Today" tint="#ca8a04" items={buckets.today} pendingByTask={pendingByTask} onOpen={setSelected} />
        <Group title="Upcoming" tint={colors.primary} items={buckets.upcoming} pendingByTask={pendingByTask} onOpen={setSelected} />
        <Group title="No due date" tint={colors.textMuted} items={buckets.noDue} pendingByTask={pendingByTask} onOpen={setSelected} />
      </ScrollView>
    </View>
  );
}

function Group({
  title, tint, items, pendingByTask, onOpen,
}: {
  title: string;
  tint: string;
  items: AssignedTask[];
  pendingByTask: Map<string, OutboxRecord[]>;
  onOpen: (t: AssignedTask) => void;
}) {
  if (items.length === 0) return null;
  return (
    <View style={{ gap: spacing(1) }}>
      <Text style={[styles.section, { color: tint }]}>{title} ({items.length})</Text>
      {items.map((t) => {
        const pending = pendingByTask.get(t.id) ?? [];
        return (
          <Pressable key={t.id} onPress={() => onOpen(t)} style={styles.row} testID={`row-task-${t.id}`}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle} numberOfLines={1}>{t.title}</Text>
              <Text style={styles.rowSub} numberOfLines={1}>
                {(t.projectName ?? t.projectCode ?? "No project")}
                {t.dueDate ? ` · due ${new Date(t.dueDate).toLocaleDateString()}` : ""}
              </Text>
              {pending.length > 0 ? (
                <Text style={[styles.rowSub, { color: colors.warn }]}>
                  {pending.length} unsynced update{pending.length === 1 ? "" : "s"}
                </Text>
              ) : null}
            </View>
            <View style={[styles.badge, { backgroundColor: priorityColor(t.priority) }]}>
              <Text style={styles.badgeText}>{t.priority}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function TaskDetail({
  task, pending, onBack, onStatus, onComment,
}: {
  task: AssignedTask;
  pending: OutboxRecord[];
  onBack: () => void;
  onStatus: (s: AssignedTask["status"], reason?: string) => Promise<void> | void;
  onComment: (content: string) => Promise<void> | void;
}) {
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [dismissReason, setDismissReason] = useState("");
  const [showDismiss, setShowDismiss] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [c, a] = await Promise.all([
          api<TaskComment[]>(`/api/tasks/${task.id}/comments`).catch(() => [] as TaskComment[]),
          api<TaskAttachment[]>(`/api/tasks/${task.id}/attachments`).catch(() => [] as TaskAttachment[]),
        ]);
        setComments(c);
        setAttachments(a);
      } catch {
        // offline — leave empty
      }
    })();
  }, [task.id]);

  const pendingComments = pending
    .map((p) => p.payload as { kind?: string; content?: string })
    .filter((p) => p.kind === "COMMENT" && p.content)
    .map((p) => p.content as string);

  async function handleSubmitComment() {
    const c = newComment;
    setNewComment("");
    await onComment(c);
  }

  async function handleDismiss() {
    if (!dismissReason.trim()) return;
    await onStatus("DISMISSED", dismissReason.trim());
    setShowDismiss(false);
    setDismissReason("");
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SyncStatusBar />
      <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(2) }}>
        <Pressable onPress={onBack} testID="button-task-back">
          <Text style={{ color: colors.primary }}>{"← All tasks"}</Text>
        </Pressable>

        <View style={{ gap: spacing(1) }}>
          <Text style={styles.h1}>{task.title}</Text>
          <Text style={styles.rowSub}>
            {(task.projectName ?? task.projectCode ?? "No project")} ·{" "}
            <Text style={{ color: priorityColor(task.priority) }}>{task.priority}</Text> ·{" "}
            {task.status}
          </Text>
          {task.dueDate ? (
            <Text style={styles.rowSub}>Due {new Date(task.dueDate).toLocaleString()}</Text>
          ) : null}
          {task.category ? <Text style={styles.rowSub}>{task.category}</Text> : null}
          {task.description ? <Text style={styles.body}>{task.description}</Text> : null}
        </View>

        <View style={{ flexDirection: "row", gap: spacing(1), flexWrap: "wrap" }}>
          {task.status !== "COMPLETED" ? (
            <Pressable style={[styles.btn, { backgroundColor: colors.success }]} onPress={() => onStatus("COMPLETED")} testID="button-task-complete">
              <Text style={styles.btnText}>Mark complete</Text>
            </Pressable>
          ) : null}
          {task.status !== "IN_PROGRESS" && task.status !== "COMPLETED" ? (
            <Pressable style={styles.btn} onPress={() => onStatus("IN_PROGRESS")} testID="button-task-start">
              <Text style={styles.btnText}>Start</Text>
            </Pressable>
          ) : null}
          {task.status !== "PENDING" && task.status !== "COMPLETED" ? (
            <Pressable style={[styles.btn, { backgroundColor: colors.surfaceMuted }]} onPress={() => onStatus("PENDING")} testID="button-task-reopen">
              <Text style={styles.btnText}>Reopen</Text>
            </Pressable>
          ) : null}
          {task.status !== "DISMISSED" && task.status !== "COMPLETED" ? (
            <Pressable style={[styles.btn, { backgroundColor: colors.warn }]} onPress={() => setShowDismiss((s) => !s)} testID="button-task-dismiss">
              <Text style={styles.btnText}>Dismiss</Text>
            </Pressable>
          ) : null}
        </View>

        {showDismiss ? (
          <View style={{ gap: spacing(1) }}>
            <TextInput
              placeholder="Reason for dismissing"
              placeholderTextColor={colors.textMuted}
              value={dismissReason}
              onChangeText={setDismissReason}
              style={styles.input}
              testID="input-task-dismiss-reason"
            />
            <Pressable style={styles.btn} onPress={handleDismiss} testID="button-task-dismiss-confirm">
              <Text style={styles.btnText}>Confirm dismiss</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={{ gap: spacing(1) }}>
          <Text style={styles.h2}>Attachments ({attachments.length})</Text>
          {attachments.length === 0 ? (
            <Text style={styles.rowSub}>No attachments.</Text>
          ) : (
            attachments.map((a) => (
              <View key={a.id} style={styles.attachment}>
                <Text style={styles.rowTitle} numberOfLines={1}>{a.fileName}</Text>
                <Text style={styles.rowSub}>{a.mimeType ?? ""}</Text>
              </View>
            ))
          )}
        </View>

        <View style={{ gap: spacing(1) }}>
          <Text style={styles.h2}>Comments</Text>
          <TextInput
            placeholder="Add a comment"
            placeholderTextColor={colors.textMuted}
            value={newComment}
            onChangeText={setNewComment}
            multiline
            style={[styles.input, { minHeight: 60 }]}
            testID="input-task-comment"
          />
          <Pressable style={styles.btn} onPress={handleSubmitComment} testID="button-task-comment-submit">
            <Text style={styles.btnText}>Post comment</Text>
          </Pressable>
          {pendingComments.map((c, idx) => (
            <View key={`pending-${idx}`} style={[styles.commentRow, { borderColor: colors.warn }]}>
              <Text style={styles.rowSub}>Pending sync</Text>
              <Text style={styles.body}>{c}</Text>
            </View>
          ))}
          {comments.map((c) => (
            <View key={c.id} style={styles.commentRow}>
              <Text style={styles.rowSub}>
                {[c.createdByFirstName, c.createdByLastName].filter(Boolean).join(" ") || "User"}
                {" · "}
                {new Date(c.createdAt).toLocaleString()}
              </Text>
              <Text style={styles.body}>{c.content}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  h1: { color: colors.text, fontSize: 20, fontWeight: "700" },
  h2: { color: colors.text, fontSize: 16, fontWeight: "600" },
  body: { color: colors.text },
  section: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", marginTop: spacing(1) },
  row: { backgroundColor: colors.surface, padding: spacing(2), borderRadius: 8, flexDirection: "row", alignItems: "center", gap: spacing(1) },
  rowTitle: { color: colors.text, fontWeight: "600" },
  rowSub: { color: colors.textMuted, fontSize: 12 },
  badge: { paddingHorizontal: spacing(1), paddingVertical: 2, borderRadius: 6 },
  badgeText: { color: "#fff", fontSize: 10, fontWeight: "700" },
  input: { backgroundColor: colors.surface, color: colors.text, padding: spacing(2), borderRadius: 8 },
  btn: { backgroundColor: colors.primary, padding: spacing(2), borderRadius: 8, alignItems: "center", minWidth: 100 },
  btnText: { color: "#fff", fontWeight: "600" },
  commentRow: { backgroundColor: colors.surface, padding: spacing(2), borderRadius: 8, gap: 4, borderWidth: 1, borderColor: "transparent" },
  attachment: { backgroundColor: colors.surface, padding: spacing(2), borderRadius: 8 },
});
