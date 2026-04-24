import React, { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { SyncStatusBar } from "@/components/SyncStatusBar";
import { useAuth } from "@/auth/AuthContext";
import { useSync } from "@/sync/SyncContext";
import { enqueue, listOutbox } from "@/sync/outbox";
import { cacheList } from "@/sync/db";
import { colors, spacing } from "@/theme";

/**
 * Task #1599 — Mobile Submittals screen.
 *
 * Field reviewers tap a pulled submittal that they own a review on,
 * pick a stamp action, and (optionally) add comments. The action is
 * queued through the offline outbox under entityType=SUBMITTAL_STAMP
 * so it survives airplane mode and replays automatically when the
 * device reconnects.
 *
 * Cache rows:
 *   SUBMITTAL         — the document (pulled by org)
 *   SUBMITTAL_REVIEW  — the FULL review chain on every submittal the
 *                       user participates in (submitter or any-time
 *                       reviewer). The pull surfaces all chain steps —
 *                       PENDING (future), IN_REVIEW (active), and
 *                       completed (APPROVED / REJECTED / etc) — so the
 *                       chain detail view can render the full history.
 *                       Stamp authorization on the server still
 *                       requires status === "IN_REVIEW".
 *
 * The reviewer ID is resolved from SUBMITTAL_REVIEW (never typed by
 * the field user). Two filters compose: a "MINE | ALL" assignment
 * filter + a submittal-status filter (DRAFT / SUBMITTED / UNDER_REVIEW
 * / APPROVED / REJECTED / REVISE_AND_RESUBMIT). Tapping a row opens a
 * chain detail modal; the stamp action button inside is enabled only
 * when the current user is on the active step.
 */

type ServerSubmittal = {
  id: string;
  submittalNumber?: string;
  subject?: string;
  status?: string;
  specSection?: string | null;
  dateRequired?: string | null;
  reviewerName?: string | null;
};

type ServerReview = {
  id: string;
  submittalId: string;
  reviewerId?: string | null;
  reviewerRole?: string | null;
  reviewerName?: string | null;
  sequenceOrder?: number;
  status?: string;
  comments?: string | null;
  stampAction?: string | null;
  dateAssigned?: string | null;
  dateReviewed?: string | null;
};

type StampAction = "APPROVED" | "APPROVED_AS_NOTED" | "REJECTED" | "REVISE_AND_RESUBMIT";

type PendingStamp = {
  localId: string;
  submittalId: string;
  reviewId: string;
  action: StampAction;
  comments?: string;
  status: string;
  // Task #1607: when the server flips this stamp to CONFLICT (because
  // office staff already resolved the review while the device was
  // offline), the coordinator persists the human-readable reason on
  // the outbox row so we can render "Office already approved this
  // review" instead of a generic CONFLICT pill.
  conflictReason?: string;
};

const STAMP_OPTIONS: Array<{ value: StampAction; label: string; needsComments: boolean }> = [
  { value: "APPROVED", label: "Approved", needsComments: false },
  { value: "APPROVED_AS_NOTED", label: "Approved as noted", needsComments: true },
  { value: "REJECTED", label: "Rejected", needsComments: true },
  { value: "REVISE_AND_RESUBMIT", label: "Revise & resubmit", needsComments: true },
];

type AssignmentFilter = "MINE" | "ALL";
type StatusFilter = "ALL" | "DRAFT" | "SUBMITTED" | "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "REVISE_AND_RESUBMIT";

const STATUS_FILTER_OPTIONS: StatusFilter[] = [
  "ALL",
  "SUBMITTED",
  "UNDER_REVIEW",
  "APPROVED",
  "REJECTED",
  "REVISE_AND_RESUBMIT",
];

function statusLabel(s: StatusFilter): string {
  if (s === "ALL") return "Any status";
  return s.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());
}

export function SubmittalsScreen() {
  const { syncNow, lastResult } = useSync();
  const { user } = useAuth();
  const currentUserId = user?.id ?? null;
  const [server, setServer] = useState<ServerSubmittal[]>([]);
  const [reviews, setReviews] = useState<ServerReview[]>([]);
  const [pendingStamps, setPendingStamps] = useState<PendingStamp[]>([]);
  const [chain, setChain] = useState<{ submittal: ServerSubmittal; activeReview: ServerReview | null } | null>(null);
  const [stamping, setStamping] = useState<{ submittal: ServerSubmittal; review: ServerReview } | null>(null);
  const [action, setAction] = useState<StampAction>("APPROVED");
  const [comments, setComments] = useState("");
  const [assignmentFilter, setAssignmentFilter] = useState<AssignmentFilter>("MINE");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");

  async function refresh() {
    setServer(await cacheList<ServerSubmittal>("SUBMITTAL"));
    setReviews(await cacheList<ServerReview>("SUBMITTAL_REVIEW"));
    const outbox = await listOutbox();
    setPendingStamps(
      outbox
        .filter((o) => o.entityType === "SUBMITTAL_STAMP")
        .map((o) => {
          const p = (o.payload ?? {}) as Partial<PendingStamp>;
          return {
            localId: o.localId,
            submittalId: p.submittalId ?? "",
            reviewId: p.reviewId ?? "",
            action: (p.action as StampAction) ?? "APPROVED",
            comments: p.comments,
            status: o.status,
            // Task #1607: lastError holds the human-readable conflict
            // explanation written by the coordinator's markConflict
            // call ("Review was already resolved (APPROVED) before
            // your stamp arrived").
            conflictReason: o.status === "CONFLICT" ? o.lastError ?? undefined : undefined,
          };
        })
        .reverse(),
    );
  }
  useEffect(() => { void refresh(); }, [lastResult]);

  // Full chain per submittal, sorted by sequenceOrder so the detail
  // view renders past → active → future top-to-bottom.
  const chainBySubmittal = useMemo(() => {
    const m = new Map<string, ServerReview[]>();
    for (const r of reviews) {
      const arr = m.get(r.submittalId) ?? [];
      arr.push(r);
      m.set(r.submittalId, arr);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => (a.sequenceOrder ?? 0) - (b.sequenceOrder ?? 0));
    }
    return m;
  }, [reviews]);

  // The active step (status IN_REVIEW) the current user owns on a
  // submittal. Null if it's not their turn (PENDING means a future
  // step the chain has not yet activated, OR an IN_REVIEW step
  // assigned to another reviewer in the chain — the server pull
  // surfaces sibling steps so submitter-only users see full chain
  // context, but those rows are NOT actionable for this user).
  // Excludes any review that already has an outbox-pending stamp so
  // the user can't double-tap. Mirrors the server-side stamp authz
  // (status=IN_REVIEW AND reviewerId=currentUserId) so we never
  // surface a "Stamp this step" CTA the server would 403 on.
  const activeReviewBySubmittal = useMemo(() => {
    if (!currentUserId) return new Map<string, ServerReview>();
    const stampedReviewIds = new Set(pendingStamps.map((s) => s.reviewId));
    const m = new Map<string, ServerReview>();
    for (const r of reviews) {
      if (stampedReviewIds.has(r.id)) continue;
      if (r.status !== "IN_REVIEW") continue;
      if (r.reviewerId !== currentUserId) continue;
      m.set(r.submittalId, r);
    }
    return m;
  }, [reviews, pendingStamps, currentUserId]);

  const stampsBySubmittal = useMemo(() => {
    const m = new Map<string, PendingStamp[]>();
    for (const s of pendingStamps) {
      const arr = m.get(s.submittalId) ?? [];
      arr.push(s);
      m.set(s.submittalId, arr);
    }
    return m;
  }, [pendingStamps]);

  const visibleSubmittals = useMemo(() => {
    let list = server;
    if (assignmentFilter === "MINE") list = list.filter((s) => activeReviewBySubmittal.has(s.id));
    if (statusFilter !== "ALL") list = list.filter((s) => s.status === statusFilter);
    return list;
  }, [server, activeReviewBySubmittal, assignmentFilter, statusFilter]);

  function openChain(s: ServerSubmittal) {
    setChain({ submittal: s, activeReview: activeReviewBySubmittal.get(s.id) ?? null });
  }

  function startStamp() {
    if (!chain || !chain.activeReview) return;
    setStamping({ submittal: chain.submittal, review: chain.activeReview });
    setAction("APPROVED");
    setComments("");
    setChain(null);
  }

  async function submitStamp() {
    if (!stamping) return;
    const opt = STAMP_OPTIONS.find((o) => o.value === action);
    if (opt?.needsComments && !comments.trim()) return;
    await enqueue({
      entityType: "SUBMITTAL_STAMP",
      operation: "UPDATE",
      serverId: stamping.submittal.id,
      payload: {
        submittalId: stamping.submittal.id,
        reviewId: stamping.review.id,
        action,
        comments: comments.trim() || undefined,
        stampedAt: new Date().toISOString(),
      },
    });
    setStamping(null);
    await refresh();
    void syncNow();
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SyncStatusBar />
      <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(1) }}>
        <View style={{ flexDirection: "row", gap: spacing(1) }}>
          {(["MINE", "ALL"] as AssignmentFilter[]).map((f) => (
            <Pressable
              key={f}
              onPress={() => setAssignmentFilter(f)}
              style={[styles.filterPill, assignmentFilter === f && styles.filterPillActive]}
              testID={`button-filter-${f.toLowerCase()}`}
            >
              <Text style={assignmentFilter === f ? styles.filterPillTextActive : styles.filterPillText}>
                {f === "MINE" ? `Awaiting me (${activeReviewBySubmittal.size})` : "All"}
              </Text>
            </Pressable>
          ))}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: spacing(1), paddingVertical: spacing(0.5) }}
        >
          {STATUS_FILTER_OPTIONS.map((s) => (
            <Pressable
              key={s}
              onPress={() => setStatusFilter(s)}
              style={[styles.statusChip, statusFilter === s && styles.statusChipActive]}
              testID={`button-status-filter-${s.toLowerCase()}`}
            >
              <Text style={statusFilter === s ? styles.statusChipTextActive : styles.statusChipText}>
                {statusLabel(s)}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {pendingStamps.length > 0 ? (
          <Text style={styles.section}>Pending stamps</Text>
        ) : null}
        {pendingStamps.map((p) => {
          const isConflict = p.status === "CONFLICT";
          return (
            <View
              key={p.localId}
              style={[styles.row, isConflict && styles.rowConflict]}
              testID={`row-stamp-pending-${p.localId}`}
            >
              <Text style={styles.rowTitle}>{p.action}</Text>
              <Text style={styles.rowSub}>Submittal {p.submittalId.slice(0, 8)} · review {p.reviewId.slice(0, 8)} · {p.status}</Text>
              {/*
                Task #1607: when the server flips this stamp to CONFLICT
                because office staff already resolved the review, render
                the explanation so the field reviewer immediately
                understands why their tap did not stick — instead of
                seeing a silent SAVED.
              */}
              {isConflict ? (
                <Text
                  style={[styles.rowSub, styles.rowConflictText]}
                  testID={`text-stamp-conflict-${p.localId}`}
                >
                  {p.conflictReason ?? "This review was already resolved by office staff. Your stamp was not applied."}
                </Text>
              ) : null}
              {p.comments ? <Text style={styles.rowSub} numberOfLines={2}>{p.comments}</Text> : null}
            </View>
          );
        })}

        <Text style={styles.section}>
          {assignmentFilter === "MINE" ? "Submittals awaiting your stamp" : "Project submittals"}
        </Text>
        {visibleSubmittals.length === 0 ? (
          <Text style={{ color: colors.textMuted }} testID="text-submittals-empty">
            {assignmentFilter === "MINE" ? "Nothing awaiting your review" : "No submittals match"}
          </Text>
        ) : (
          visibleSubmittals.map((s) => {
            const pending = stampsBySubmittal.get(s.id)?.length ?? 0;
            const activeReview = activeReviewBySubmittal.get(s.id);
            const chainLen = chainBySubmittal.get(s.id)?.length ?? 0;
            return (
              <Pressable
                key={s.id}
                onPress={() => openChain(s)}
                style={styles.row}
                testID={`row-submittal-${s.id}`}
              >
                <Text style={styles.rowTitle}>
                  {s.submittalNumber ? `${s.submittalNumber} — ` : ""}{s.subject ?? "(untitled)"}
                </Text>
                <Text style={styles.rowSub}>
                  {s.status ?? ""} {s.specSection ? `· Spec ${s.specSection}` : ""}
                </Text>
                {activeReview ? (
                  <Text style={[styles.rowSub, { color: colors.primary }]}>
                    Your review: {activeReview.reviewerRole ?? "REVIEWER"}
                    {activeReview.sequenceOrder != null ? ` · step ${activeReview.sequenceOrder}` : ""}
                  </Text>
                ) : chainLen > 0 ? (
                  <Text style={styles.rowSub}>{chainLen}-step chain · tap to view</Text>
                ) : (
                  <Text style={styles.rowSub}>No review chain</Text>
                )}
                {pending > 0 ? (
                  <Text style={[styles.rowSub, { color: colors.primary }]}>
                    {pending} pending stamp{pending === 1 ? "" : "s"}
                  </Text>
                ) : null}
              </Pressable>
            );
          })
        )}
      </ScrollView>

      {/* Chain detail modal — opens on row tap. Renders the full
          review chain (past + active + future) and exposes a Stamp
          button only when the current user is on the active step. */}
      <Modal
        visible={chain !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setChain(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle} testID="text-chain-modal-title">
              {chain?.submittal.submittalNumber ?? chain?.submittal.id?.slice(0, 8)} — Review chain
            </Text>
            <Text style={styles.rowSub}>{chain?.submittal.subject}</Text>
            <ScrollView style={{ maxHeight: 320, marginTop: spacing(1) }} contentContainerStyle={{ gap: spacing(1) }}>
              {(chain ? chainBySubmittal.get(chain.submittal.id) ?? [] : []).map((step) => {
                const isActive = step.status === "IN_REVIEW";
                const isPending = step.status === "PENDING";
                return (
                  <View
                    key={step.id}
                    style={[styles.chainStep, isActive && styles.chainStepActive]}
                    testID={`row-chain-step-${step.id}`}
                  >
                    <Text style={styles.chainStepHeader}>
                      Step {step.sequenceOrder ?? "?"} · {step.reviewerRole ?? "REVIEWER"}
                    </Text>
                    <Text style={styles.rowSub}>
                      {step.reviewerName ?? "(unassigned)"} · {step.status ?? "PENDING"}
                      {isActive ? "  (ball-in-court)" : ""}
                      {isPending ? "  (waiting)" : ""}
                    </Text>
                    {step.dateReviewed ? (
                      <Text style={styles.rowSub}>Stamped {step.dateReviewed.slice(0, 10)} · {step.stampAction ?? step.status}</Text>
                    ) : null}
                    {step.comments ? <Text style={styles.rowSub} numberOfLines={3}>{step.comments}</Text> : null}
                  </View>
                );
              })}
            </ScrollView>

            <View style={{ flexDirection: "row", gap: spacing(1), marginTop: spacing(2) }}>
              <Pressable
                onPress={() => setChain(null)}
                style={[styles.btn, { backgroundColor: colors.surfaceMuted, flex: 1 }]}
                testID="button-chain-close"
              >
                <Text style={[styles.btnText, { color: colors.text }]}>Close</Text>
              </Pressable>
              <Pressable
                onPress={startStamp}
                disabled={!chain?.activeReview}
                style={[styles.btn, { flex: 1 }, !chain?.activeReview && { opacity: 0.5 }]}
                testID="button-chain-open-stamp"
              >
                <Text style={styles.btnText}>
                  {chain?.activeReview ? "Stamp this step" : "Not your turn"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Stamp action modal — opens only when the user is the active
          reviewer (gated by chain modal's "Stamp this step" button). */}
      <Modal
        visible={stamping !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setStamping(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              Stamp {stamping?.submittal.submittalNumber ?? stamping?.submittal.id?.slice(0, 8)}
            </Text>
            <Text style={styles.rowSub}>{stamping?.submittal.subject}</Text>
            {stamping?.review ? (
              <Text style={styles.rowSub} testID="text-stamp-review-context">
                Review: {stamping.review.reviewerRole ?? "REVIEWER"}
                {stamping.review.sequenceOrder != null ? ` · step ${stamping.review.sequenceOrder}` : ""}
              </Text>
            ) : null}

            <Text style={styles.label}>Action</Text>
            <View style={{ gap: spacing(1) }}>
              {STAMP_OPTIONS.map((o) => (
                <Pressable
                  key={o.value}
                  onPress={() => setAction(o.value)}
                  style={[styles.actionPill, action === o.value && styles.actionPillActive]}
                  testID={`button-stamp-action-${o.value}`}
                >
                  <Text style={action === o.value ? styles.actionPillTextActive : styles.actionPillText}>
                    {o.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.label}>Comments</Text>
            <TextInput
              value={comments}
              onChangeText={setComments}
              placeholder={
                STAMP_OPTIONS.find((o) => o.value === action)?.needsComments
                  ? "Required for this action"
                  : "Optional"
              }
              placeholderTextColor={colors.textMuted}
              multiline
              style={[styles.input, { minHeight: 80 }]}
              testID="input-stamp-comments"
            />

            <View style={{ flexDirection: "row", gap: spacing(1), marginTop: spacing(1) }}>
              <Pressable
                onPress={() => setStamping(null)}
                style={[styles.btn, { backgroundColor: colors.surfaceMuted, flex: 1 }]}
                testID="button-stamp-cancel"
              >
                <Text style={[styles.btnText, { color: colors.text }]}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={submitStamp}
                style={[styles.btn, { flex: 1 }]}
                testID="button-stamp-submit"
              >
                <Text style={styles.btnText}>Queue stamp</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  input: { backgroundColor: colors.surface, color: colors.text, padding: spacing(2), borderRadius: 8 },
  btn: { backgroundColor: colors.primary, padding: spacing(2), borderRadius: 8, alignItems: "center" },
  btnText: { color: "#fff", fontWeight: "600" },
  row: { backgroundColor: colors.surface, padding: spacing(2), borderRadius: 8 },
  rowTitle: { color: colors.text, fontWeight: "600" },
  rowSub: { color: colors.textMuted, fontSize: 12 },
  // Task #1607: visual treatment for stale-review CONFLICT rows so
  // they stand out from pending/synced stamps in the list.
  rowConflict: { borderWidth: 1, borderColor: colors.danger },
  rowConflictText: { color: colors.danger, fontWeight: "600" },
  section: { color: colors.textMuted, fontSize: 12, fontWeight: "600", marginTop: spacing(1), textTransform: "uppercase" },
  label: { color: colors.textMuted, fontSize: 12, fontWeight: "600", marginTop: spacing(2), textTransform: "uppercase" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: colors.background, padding: spacing(3), borderTopLeftRadius: 16, borderTopRightRadius: 16, gap: spacing(1) },
  modalTitle: { color: colors.text, fontWeight: "700", fontSize: 18 },
  actionPill: { paddingVertical: spacing(1.5), paddingHorizontal: spacing(2), borderRadius: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  actionPillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  actionPillText: { color: colors.text, fontWeight: "600" },
  actionPillTextActive: { color: "#fff", fontWeight: "700" },
  filterPill: { paddingVertical: spacing(1), paddingHorizontal: spacing(2), borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  filterPillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterPillText: { color: colors.text, fontSize: 12, fontWeight: "600" },
  filterPillTextActive: { color: "#fff", fontSize: 12, fontWeight: "700" },
  statusChip: { paddingVertical: spacing(0.75), paddingHorizontal: spacing(1.5), borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  statusChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  statusChipText: { color: colors.text, fontSize: 11 },
  statusChipTextActive: { color: "#fff", fontSize: 11, fontWeight: "700" },
  chainStep: { backgroundColor: colors.surface, padding: spacing(1.5), borderRadius: 6, borderLeftWidth: 3, borderLeftColor: colors.border },
  chainStepActive: { borderLeftColor: colors.primary, backgroundColor: colors.surfaceMuted },
  chainStepHeader: { color: colors.text, fontWeight: "700", fontSize: 13 },
});
