import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import {
  ArrowDown,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  FileText,
  Image as ImageIcon,
  Info,
  Loader2,
  Mic,
  Paperclip,
  Pencil,
  Plus,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { apiRequest, queryClient, bidEstimateKey } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";

type AttachmentKind = "image" | "document" | "audio";

interface ChatAttachment {
  kind: AttachmentKind;
  objectPath: string;
  contentType: string;
  fileName: string;
  sizeBytes: number;
  transcript?: string;
  extractedText?: string;
}

interface ChatSession {
  id: string;
  title: string | null;
  bidId: string | null;
  estimateId: string | null;
  updatedAt: string;
}

// Task #2729 — Proposed line-item action from Claude tool-use.
export interface ProposedAction {
  toolCallId: string;
  action: "add" | "edit" | "delete";
  payload: Record<string, unknown>;
  validationError?: string;
}

type ActionState = "idle" | "applying" | "rejecting" | "applied" | "rejected" | "error" | "applied-undoable" | "undoing";

interface ChatMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  citations: Array<{ id: string; sourceType: string; sourceId: string; title: string; snippet: string }> | null;
  attachments: ChatAttachment[] | null;
  feedbackOutcome: "THUMBS_UP" | "THUMBS_DOWN" | null;
  proposedActions: ProposedAction[] | null;
  createdAt: string;
}

interface PendingAttachment {
  id: string;
  kind: AttachmentKind;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  status: "uploading" | "ready" | "error";
  objectPath?: string;
  errorMessage?: string;
  /** Local preview URL for images so the user can see what they attached. */
  previewUrl?: string;
}

interface Props {
  bidId?: string;
  estimateId?: string;
  projectId?: string;
  enabled: boolean;
  /** Increments whenever a line item is added/edited/deleted so the panel
   *  can notify the user that the AI context will be refreshed on the next turn. */
  lineItemsRevision?: number;
  /** Increments whenever a takeoff measurement is added/edited/deleted so the
   *  panel can notify the user that the AI context will be refreshed on the next turn. */
  measurementsRevision?: number;
}

const PROACTIVE_OPENER =
  "Please review the existing estimate lines and takeoff measurements for this bid, then suggest what might be missing, under-estimated, or needs attention based on our historical rates.";

const MAX_ATTACHMENTS = 8;
const MAX_FILE_BYTES = 32 * 1024 * 1024; // 32 MB hard ceiling per file

function classifyKind(contentType: string, fileName: string): AttachmentKind | null {
  const ct = contentType.toLowerCase();
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ct.startsWith("image/")) return "image";
  if (ct.startsWith("audio/")) return "audio";
  if (ct === "application/pdf" || ext === "pdf") return "document";
  if (
    ct.startsWith("text/") ||
    ct.includes("officedocument") ||
    ct === "application/msword" ||
    ct === "application/vnd.ms-excel" ||
    ["doc", "docx", "xls", "xlsx", "csv", "txt", "md"].includes(ext)
  ) {
    return "document";
  }
  return null;
}

function uploadFileTypeFor(kind: AttachmentKind): "MEDIA" | "DOCUMENT" {
  // Audio + image route through MEDIA (image/* + audio/* + video/* allowed).
  // Documents (PDF, DOC, etc.) route through DOCUMENT.
  return kind === "document" ? "DOCUMENT" : "MEDIA";
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatCurrency(n: unknown): string {
  const num = Number(n ?? 0);
  return `$${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── ProposedActionCard ─────────────────────────────────────────────────────

const UNDO_WINDOW_SECONDS = 30;

interface ProposedActionCardProps {
  action: ProposedAction;
  messageId: string;
  sessionId: string;
  bidId?: string;
  state: ActionState;
  errorMessage?: string;
  undoTimeLeft?: number;
  onApply: (toolCallId: string, messageId: string) => void;
  onReject: (toolCallId: string, messageId: string) => void;
  onUndo: (toolCallId: string, messageId: string) => void;
}

export function ProposedActionCard({
  action,
  messageId,
  sessionId,
  bidId,
  state,
  errorMessage,
  undoTimeLeft,
  onApply,
  onReject,
  onUndo,
}: ProposedActionCardProps) {
  const p = action.payload as Record<string, unknown>;
  const isAdd = action.action === "add";
  const isEdit = action.action === "edit";
  const isDelete = action.action === "delete";

  const totalCost =
    Number(p.materialCost ?? 0) +
    Number(p.laborCost ?? 0) +
    Number(p.equipmentCost ?? 0) +
    Number(p.subcontractCost ?? 0);

  // ── Cost-delta preview (Task #2732 / Task #2733) ───────────────────────────
  // Subscribe to the bid estimate cache reactively so that when a sibling card
  // is accepted and the cache is invalidated/refetched, this card re-renders
  // with the updated baseline.  We never trigger additional network requests
  // from within the card itself — staleTime:Infinity + refetchOnMount:false
  // mean we only update when the parent (handleApplyAction) calls invalidate.
  type CachedLineItem = {
    id: string;
    materialCost: string | number | null;
    laborCost: string | number | null;
    equipmentCost: string | number | null;
    subcontractCost: string | number | null;
  };
  type CachedEstimate = {
    estimate: {
      lineItems: CachedLineItem[];
      totals: { totalCost: string | number };
    } | null;
  };

  const { data: liveEstimate } = useQuery<CachedEstimate>({
    queryKey: bidEstimateKey(bidId ?? ""),
    enabled: !!bidId,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  // Derived live values — recalculated on every cache update.
  const liveTotalCost = Number(liveEstimate?.estimate?.totals?.totalCost ?? 0);
  const liveExistingItem = liveEstimate?.estimate?.lineItems?.find(
    (li) => li.id === String(p.id ?? ""),
  );
  const liveExistingItemCost = liveExistingItem
    ? Number(liveExistingItem.materialCost ?? 0) +
      Number(liveExistingItem.laborCost ?? 0) +
      Number(liveExistingItem.equipmentCost ?? 0) +
      Number(liveExistingItem.subcontractCost ?? 0)
    : 0;
  const liveProposedEditTotal = liveExistingItem
    ? (p.materialCost !== undefined ? Number(p.materialCost) : Number(liveExistingItem.materialCost ?? 0)) +
      (p.laborCost !== undefined ? Number(p.laborCost) : Number(liveExistingItem.laborCost ?? 0)) +
      (p.equipmentCost !== undefined ? Number(p.equipmentCost) : Number(liveExistingItem.equipmentCost ?? 0)) +
      (p.subcontractCost !== undefined ? Number(p.subcontractCost) : Number(liveExistingItem.subcontractCost ?? 0))
    : totalCost;
  const liveCostDelta = isAdd
    ? totalCost
    : isEdit
      ? liveProposedEditTotal - liveExistingItemCost
      : isDelete
        ? -liveExistingItemCost
        : 0;
  const liveShowDeltaPreview =
    !!liveEstimate?.estimate &&
    (isAdd ? totalCost > 0 : isEdit ? liveExistingItem !== undefined : isDelete ? liveExistingItemCost > 0 : false);
  const liveNewEstimateTotal = liveTotalCost + liveCostDelta;

  // isSettled and related booleans must be declared before the freeze effect
  // that depends on isSettled (Task #2733). The full undo-aware state set is
  // from Task #2734; showDeltaPreview/newEstimateTotal are computed reactively
  // via live/frozen values below, so the stale non-reactive versions are dropped.
  const isAppliedPermanently = state === "applied";
  const isAppliedUndoable = state === "applied-undoable";
  const isRejected = state === "rejected";
  const isSettled = isAppliedPermanently || isRejected;
  const isBusy = state === "applying" || state === "rejecting" || state === "undoing";
  const showAcceptReject = !isSettled && !isAppliedUndoable && state !== "undoing";

  // Freeze: once a card is settled (applied / rejected) we capture the
  // last-seen live values so the card becomes a historical record and no
  // longer shifts as other cards are accepted.
  type FrozenPreview = {
    currentEstimateTotal: number;
    newEstimateTotal: number;
    costDelta: number;
    existingItemCost: number;
    showDeltaPreview: boolean;
  };
  const [frozenPreview, setFrozenPreview] = useState<FrozenPreview | null>(null);
  const wasSettledRef = useRef(false);
  useEffect(() => {
    if (!wasSettledRef.current && isSettled) {
      wasSettledRef.current = true;
      setFrozenPreview({
        currentEstimateTotal: liveTotalCost,
        newEstimateTotal: liveNewEstimateTotal,
        costDelta: liveCostDelta,
        existingItemCost: liveExistingItemCost,
        showDeltaPreview: liveShowDeltaPreview,
      });
    }
  }, [isSettled, liveTotalCost, liveNewEstimateTotal, liveCostDelta, liveExistingItemCost, liveShowDeltaPreview]);

  // Use frozen values for settled cards, live values for pending ones.
  const currentEstimateTotal = frozenPreview?.currentEstimateTotal ?? liveTotalCost;
  const newEstimateTotal = frozenPreview?.newEstimateTotal ?? liveNewEstimateTotal;
  const costDelta = frozenPreview?.costDelta ?? liveCostDelta;
  const existingItemCost = frozenPreview?.existingItemCost ?? liveExistingItemCost;
  const showDeltaPreview = frozenPreview?.showDeltaPreview ?? liveShowDeltaPreview;
  // ── end cost-delta preview ─────────────────────────────────────────────────

  return (
    <div
      className={`mt-2 rounded-md border text-xs ${
        isDelete
          ? "border-destructive/30 bg-destructive/5"
          : isEdit
            ? "border-amber-400/40 bg-amber-50 dark:bg-amber-950/20"
            : "border-primary/30 bg-primary/5"
      } ${isAppliedPermanently ? "opacity-70" : ""} ${isRejected ? "opacity-50 line-through" : ""}`}
      data-testid={`proposed-action-card-${action.toolCallId}`}
    >
      <div className="flex items-start gap-2 px-3 py-2">
        <div className="mt-0.5 shrink-0">
          {isDelete ? (
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          ) : isEdit ? (
            <Pencil className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
          ) : (
            <Plus className="h-3.5 w-3.5 text-primary" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-foreground truncate">
            {isDelete
              ? `Remove: ${String(p.description ?? "(line item)")}`
              : isEdit
                ? `Edit line item`
                : `Add: ${String(p.description ?? "(new item)")}`}
          </div>
          {!isDelete && (
            <div className="mt-0.5 text-muted-foreground space-y-0.5">
              {isAdd && (
                <>
                  <div>
                    <span className="font-medium">Category:</span> {String(p.category ?? "—")}
                    {" · "}
                    <span className="font-medium">Qty:</span> {String(p.quantity ?? "—")} {String(p.unit ?? "")}
                  </div>
                </>
              )}
              {isEdit && p.description != null && (
                <div><span className="font-medium">Description:</span> {String(p.description)}</div>
              )}
              {isEdit && p.quantity !== undefined && (
                <div>
                  <span className="font-medium">Qty:</span> {String(p.quantity)} {String(p.unit ?? "")}
                </div>
              )}
              {(isAdd || p.materialCost !== undefined || p.laborCost !== undefined || p.equipmentCost !== undefined || p.subcontractCost !== undefined) && (
                <div>
                  {Number(p.materialCost ?? 0) > 0 && <span>Mat {formatCurrency(p.materialCost)} </span>}
                  {Number(p.laborCost ?? 0) > 0 && <span>Lab {formatCurrency(p.laborCost)} </span>}
                  {Number(p.equipmentCost ?? 0) > 0 && <span>Equip {formatCurrency(p.equipmentCost)} </span>}
                  {Number(p.subcontractCost ?? 0) > 0 && <span>Sub {formatCurrency(p.subcontractCost)} </span>}
                  {(isAdd || totalCost > 0) && (
                    <span className="font-semibold">= {formatCurrency(totalCost)}</span>
                  )}
                </div>
              )}
              {p.notes != null && <div className="italic text-[11px]">{String(p.notes)}</div>}
            </div>
          )}
          {isDelete && p.reason != null && (
            <div className="mt-0.5 text-muted-foreground italic">{String(p.reason)}</div>
          )}

          {/* ── Cost-delta preview (Task #2732) ── */}
          {showDeltaPreview && !isDelete && (
            <div
              className="mt-1.5 rounded bg-muted/60 px-2 py-1 text-[11px] font-medium tabular-nums"
              data-testid={`cost-delta-preview-${action.toolCallId}`}
            >
              <span className="text-muted-foreground">Estimate total: </span>
              <span>{formatCurrency(currentEstimateTotal)}</span>
              <span className="text-muted-foreground"> → </span>
              <span className="text-foreground">{formatCurrency(newEstimateTotal)}</span>
              <span
                className={`ml-1 ${costDelta >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}
              >
                ({costDelta >= 0 ? "+" : ""}{formatCurrency(costDelta)})
              </span>
            </div>
          )}
          {showDeltaPreview && isDelete && (
            <div
              className="mt-1.5 rounded bg-destructive/10 px-2 py-1 text-[11px] font-medium tabular-nums text-destructive"
              data-testid={`cost-delta-preview-${action.toolCallId}`}
            >
              Removes {formatCurrency(existingItemCost)} from estimate
            </div>
          )}
          {/* ── end cost-delta preview ── */}

          {action.validationError && (
            <div className="mt-1 text-destructive text-[11px]">
              ⚠ Cannot apply: {action.validationError}
            </div>
          )}
          {errorMessage && !action.validationError && (
            <div className="mt-1 text-destructive text-[11px]" data-testid={`action-error-${action.toolCallId}`}>
              ⚠ {errorMessage}
            </div>
          )}
        </div>
      </div>

      {/* Accept / Reject buttons — hidden once settled or undo window is open */}
      {showAcceptReject && (
        <div className="flex gap-1.5 px-3 pb-2">
          <Button
            size="sm"
            variant="default"
            className="h-6 px-2 text-[11px] gap-1"
            disabled={isBusy || !!action.validationError}
            onClick={() => onApply(action.toolCallId, messageId)}
            data-testid={`button-accept-action-${action.toolCallId}`}
          >
            {state === "applying" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <CheckCircle className="h-3 w-3" />
            )}
            Accept
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[11px] gap-1 text-muted-foreground hover:text-destructive"
            disabled={isBusy}
            onClick={() => onReject(action.toolCallId, messageId)}
            data-testid={`button-reject-action-${action.toolCallId}`}
          >
            {state === "rejecting" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <XCircle className="h-3 w-3" />
            )}
            Reject
          </Button>
        </div>
      )}

      {/* Applied with undo window — show applied badge + undo button + countdown */}
      {(isAppliedUndoable || state === "undoing") && (
        <div className="flex items-center gap-2 px-3 pb-2" data-testid={`action-undoable-${action.toolCallId}`}>
          <span className="text-[11px] font-medium text-primary">✓ Applied</span>
          <Button
            size="sm"
            variant="ghost"
            className="h-5 px-1.5 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
            disabled={state === "undoing"}
            onClick={() => onUndo(action.toolCallId, messageId)}
            data-testid={`button-undo-action-${action.toolCallId}`}
          >
            {state === "undoing" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RotateCcw className="h-3 w-3" />
            )}
            {state === "undoing" ? "Undoing…" : `Undo${undoTimeLeft != null && undoTimeLeft > 0 ? ` (${undoTimeLeft}s)` : ""}`}
          </Button>
        </div>
      )}

      {/* Permanently settled badge */}
      {isSettled && (
        <div
          className={`px-3 pb-2 text-[11px] font-medium ${isAppliedPermanently ? "text-primary" : "text-muted-foreground"}`}
          data-testid={`action-settled-${action.toolCallId}`}
        >
          {isAppliedPermanently ? "✓ Applied" : "✗ Rejected"}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function AiEstimatorChatPanel({ bidId, estimateId, projectId, enabled, lineItemsRevision, measurementsRevision }: Props) {
  const { toast } = useToast();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderChunksRef = useRef<BlobPart[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Guard so the proactive opener is only fired once per panel mount.
  const hasAutoSentRef = useRef(false);
  // Track whether we should show the "estimate updated" notice.
  const [showUpdateNotice, setShowUpdateNotice] = useState(false);
  // Remember the last revisions we've seen so we can detect changes.
  const prevRevisionRef = useRef<number | undefined>(undefined);
  const prevMeasurementsRevisionRef = useRef<number | undefined>(undefined);

  // Task #2729 — per-toolCallId state for proposed action cards.
  const [actionStates, setActionStates] = useState<Record<string, ActionState>>({});
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});

  // Task #2736 — change history panel toggle.
  const [showHistory, setShowHistory] = useState(false);

  // Task #2730 — undo countdown tracking (seconds remaining per toolCallId).
  const [undoCountdowns, setUndoCountdowns] = useState<Record<string, number>>({});
  const undoTimerRefs = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  function setActionState(toolCallId: string, state: ActionState) {
    setActionStates((prev) => ({ ...prev, [toolCallId]: state }));
  }
  function setActionError(toolCallId: string, msg: string) {
    setActionErrors((prev) => ({ ...prev, [toolCallId]: msg }));
  }
  function clearActionError(toolCallId: string) {
    setActionErrors((prev) => { const next = { ...prev }; delete next[toolCallId]; return next; });
  }

  // Starts a UNDO_WINDOW_SECONDS countdown for the given toolCallId.
  // Transitions from "applied-undoable" → "applied" when the window expires.
  function startUndoCountdown(toolCallId: string) {
    // Clear any existing timer for this id (shouldn't happen, but be safe).
    if (undoTimerRefs.current[toolCallId]) {
      clearInterval(undoTimerRefs.current[toolCallId]);
    }
    setUndoCountdowns((prev) => ({ ...prev, [toolCallId]: UNDO_WINDOW_SECONDS }));
    const interval = setInterval(() => {
      setUndoCountdowns((prev) => {
        const next = (prev[toolCallId] ?? 0) - 1;
        if (next <= 0) {
          clearInterval(undoTimerRefs.current[toolCallId]);
          delete undoTimerRefs.current[toolCallId];
          // Transition to permanent "applied" — the undo window is closed.
          setActionStates((s) => {
            if (s[toolCallId] === "applied-undoable") {
              return { ...s, [toolCallId]: "applied" };
            }
            return s;
          });
          return { ...prev, [toolCallId]: 0 };
        }
        return { ...prev, [toolCallId]: next };
      });
    }, 1000);
    undoTimerRefs.current[toolCallId] = interval;
  }

  // Cleanup all undo timers on unmount.
  useEffect(() => {
    return () => {
      for (const interval of Object.values(undoTimerRefs.current)) {
        clearInterval(interval);
      }
    };
  }, []);

  const sessionsQuery = useQuery<{ sessions: ChatSession[] }>({
    queryKey: ["/api/ai-estimator/chat/sessions"],
    enabled,
  });

  const messagesQuery = useQuery<{ session: ChatSession; messages: ChatMessage[] }>({
    queryKey: ["/api/ai-estimator/chat/sessions", sessionId, "messages"],
    enabled: enabled && !!sessionId,
    queryFn: async () => {
      const r = await apiRequest("GET", `/api/ai-estimator/chat/sessions/${sessionId}/messages`);
      return r.json();
    },
  });

  // Seed actionStates from server-persisted decision fields whenever messages load.
  // This ensures that after a page refresh, cards that were previously accepted or
  // rejected stay in that state without triggering a re-apply.
  const loadedMessages = messagesQuery.data?.messages;
  useEffect(() => {
    if (!loadedMessages) return;
    setActionStates((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const msg of loadedMessages) {
        if (!msg.proposedActions) continue;
        for (const action of msg.proposedActions as Array<{ toolCallId: string; decision?: string }>) {
          if (action.decision === "applied" || action.decision === "rejected") {
            if (next[action.toolCallId] !== action.decision) {
              next[action.toolCallId] = action.decision as ActionState;
              changed = true;
            }
          }
        }
      }
      return changed ? next : prev;
    });
  }, [loadedMessages]);

  const [panelError, setPanelError] = useState<string | null>(null);
  // "Scroll to bottom" button — shows when the user has scrolled up.
  const [atBottom, setAtBottom] = useState(true);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      setAtBottom(true);
    }
  }, []);

  const createSession = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/ai-estimator/chat/sessions", {
        bidId,
        estimateId,
        projectId,
        title: bidId ? `Bid chat ${bidId.slice(0, 6)}` : "Estimator chat",
      });
      return r.json();
    },
    onSuccess: (s: ChatSession) => {
      setPanelError(null);
      queryClient.invalidateQueries({ queryKey: ["/api/ai-estimator/chat/sessions"] });
      setSessionId(s.id);
    },
    onError: () => {
      setPanelError("Could not load estimate data — please refresh or contact support.");
    },
  });

  const sendTurn = useMutation({
    mutationFn: async (args: { prompt: string; attachments: ChatAttachment[] }) => {
      const r = await apiRequest("POST", `/api/ai-estimator/chat/sessions/${sessionId}/messages`, {
        prompt: args.prompt,
        attachments: args.attachments,
      });
      return r.json();
    },
    onSuccess: () => {
      setPanelError(null);
      setShowUpdateNotice(false);
      queryClient.invalidateQueries({ queryKey: ["/api/ai-estimator/chat/sessions", sessionId, "messages"] });
      setDraft("");
      setPending([]);
    },
    onError: () => {
      setPanelError("Failed to get a response — please try again or refresh the page.");
    },
  });

  const sendFeedback = useMutation({
    mutationFn: async ({ messageId, outcome }: { messageId: string; outcome: "THUMBS_UP" | "THUMBS_DOWN" }) => {
      await apiRequest("PUT", `/api/ai-estimator/chat/sessions/${sessionId}/messages/${messageId}/feedback`, { outcome });
      await apiRequest("POST", "/api/ai-estimator/feedback", {
        surface: "chat_answer",
        outcome,
        targetType: "chat_message",
        targetId: messageId,
        bidId,
        estimateId,
        projectId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-estimator/chat/sessions", sessionId, "messages"] });
    },
  });

  // Task #2729 — apply a proposed action from a Claude tool-use block.
  // Task #2730 — after apply, opens the 30-second undo window.
  async function handleApplyAction(toolCallId: string, messageId: string) {
    if (!sessionId) return;
    clearActionError(toolCallId);
    setActionState(toolCallId, "applying");
    try {
      await apiRequest(
        "POST",
        `/api/ai-estimator/chat/sessions/${sessionId}/messages/${messageId}/proposed-actions/apply`,
        { toolCallId },
      );
      // Enter the undoable state and start the countdown.
      setActionState(toolCallId, "applied-undoable");
      startUndoCountdown(toolCallId);
      // Refresh the estimate workspace so the new/changed line item appears.
      if (bidId) {
        queryClient.invalidateQueries({ queryKey: bidEstimateKey(bidId) });
      }
      toast({ title: "Change applied", description: "The estimate has been updated. You have 30 s to undo." });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not apply the change — please try again.";
      setActionState(toolCallId, "idle");
      setActionError(toolCallId, msg);
    }
  }

  // Task #2730 — undo a previously applied action.
  async function handleUndoAction(toolCallId: string, messageId: string) {
    if (!sessionId) return;
    // Stop the countdown timer.
    if (undoTimerRefs.current[toolCallId]) {
      clearInterval(undoTimerRefs.current[toolCallId]);
      delete undoTimerRefs.current[toolCallId];
    }
    setActionState(toolCallId, "undoing");
    try {
      await apiRequest(
        "POST",
        `/api/ai-estimator/chat/sessions/${sessionId}/messages/${messageId}/proposed-actions/undo`,
        { toolCallId },
      );
      // Reset to idle so the user can re-accept or re-reject.
      setActionState(toolCallId, "idle");
      clearActionError(toolCallId);
      // Refresh the estimate workspace to reflect the reversal.
      if (bidId) {
        queryClient.invalidateQueries({ queryKey: bidEstimateKey(bidId) });
      }
      toast({ title: "Change undone", description: "The estimate has been restored." });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not undo the change.";
      // On failure, transition back to the permanent applied state.
      setActionState(toolCallId, "applied");
      setActionError(toolCallId, msg);
      toast({ title: "Could not undo change", description: msg, variant: "destructive" });
    }
  }

  async function handleRejectAction(toolCallId: string, messageId: string) {
    if (!sessionId) return;
    clearActionError(toolCallId);
    setActionState(toolCallId, "rejecting");
    try {
      await apiRequest(
        "POST",
        `/api/ai-estimator/chat/sessions/${sessionId}/messages/${messageId}/proposed-actions/reject`,
        { toolCallId },
      );
      setActionState(toolCallId, "rejected");
    } catch {
      // Even if recording fails, mark as rejected so the card goes away.
      setActionState(toolCallId, "rejected");
    }
  }

  // Task #2729 — bulk Accept/Reject helpers.
  async function handleAcceptAll(messageId: string, actions: ProposedAction[]) {
    const pending = actions.filter((a) => !a.validationError && (actionStates[a.toolCallId] ?? "idle") === "idle");
    await Promise.allSettled(pending.map((a) => handleApplyAction(a.toolCallId, messageId)));
  }

  async function handleRejectAll(messageId: string, actions: ProposedAction[]) {
    const pending = actions.filter((a) => (actionStates[a.toolCallId] ?? "idle") === "idle");
    await Promise.allSettled(pending.map((a) => handleRejectAction(a.toolCallId, messageId)));
  }

  const clearChat = useMutation({
    mutationFn: async () => {
      if (!sessionId) return;
      await apiRequest("DELETE", `/api/ai-estimator/chat/sessions/${sessionId}`);
    },
    onSuccess: () => {
      // Reset all local state so a fresh session is created automatically.
      setSessionId(null);
      setDraft("");
      setPending([]);
      setShowUpdateNotice(false);
      setShowHistory(false);
      setActionStates({});
      setUndoCountdowns({});
      // Cancel all active undo timers.
      for (const interval of Object.values(undoTimerRefs.current)) {
        clearInterval(interval);
      }
      undoTimerRefs.current = {};
      hasAutoSentRef.current = false;
      prevRevisionRef.current = lineItemsRevision;
      prevMeasurementsRevisionRef.current = measurementsRevision;
      queryClient.invalidateQueries({ queryKey: ["/api/ai-estimator/chat/sessions"] });
      toast({ title: "Chat cleared", description: "Starting a fresh conversation." });
    },
    onError: () => {
      toast({ title: "Could not clear chat", description: "Please try again.", variant: "destructive" });
    },
  });

  // ── Upload helpers ──────────────────────────────────────────────────────────
  // The 3-step flow used everywhere else in the app:
  //   1. POST /api/objects/upload  -> { uploadURL, intentId, objectKey }
  //   2. PUT  uploadURL            (raw bytes, content-type set)
  //   3. POST /api/objects/confirm -> { objectPath }
  async function uploadOne(file: File, kind: AttachmentKind, tempId: string): Promise<void> {
    try {
      const initRes = await apiRequest("POST", "/api/objects/upload", {
        contentType: file.type || "application/octet-stream",
        fileSize: file.size,
        fileType: uploadFileTypeFor(kind),
      });
      const { uploadURL, intentId } = await initRes.json();

      const putRes = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!putRes.ok) throw new Error(`Upload failed (${putRes.status})`);

      const confirmRes = await apiRequest("POST", "/api/objects/confirm", { intentId });
      const { objectPath } = await confirmRes.json();

      setPending((prev) =>
        prev.map((p) => (p.id === tempId ? { ...p, status: "ready", objectPath } : p)),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      setPending((prev) =>
        prev.map((p) => (p.id === tempId ? { ...p, status: "error", errorMessage: msg } : p)),
      );
      toast({ title: "Attachment upload failed", description: msg, variant: "destructive" });
    }
  }

  function addFiles(files: FileList | File[]) {
    const list = Array.from(files);
    const room = MAX_ATTACHMENTS - pending.length;
    if (list.length > room) {
      toast({
        title: "Too many attachments",
        description: `Up to ${MAX_ATTACHMENTS} files per message.`,
        variant: "destructive",
      });
      list.length = room;
    }
    for (const file of list) {
      if (file.size > MAX_FILE_BYTES) {
        toast({
          title: "File too large",
          description: `${file.name} is ${formatBytes(file.size)} — max ${formatBytes(MAX_FILE_BYTES)}.`,
          variant: "destructive",
        });
        continue;
      }
      const kind = classifyKind(file.type, file.name);
      if (!kind) {
        toast({
          title: "Unsupported file type",
          description: `${file.name} (${file.type || "unknown"}) is not an image, audio file, or document.`,
          variant: "destructive",
        });
        continue;
      }
      const tempId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const previewUrl = kind === "image" ? URL.createObjectURL(file) : undefined;
      setPending((prev) => [
        ...prev,
        {
          id: tempId,
          kind,
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          status: "uploading",
          previewUrl,
        },
      ]);
      void uploadOne(file, kind, tempId);
    }
  }

  function removePending(id: string) {
    setPending((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  }

  // ── Voice recording (MediaRecorder → audio blob → upload as MEDIA) ──────────
  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast({
        title: "Microphone not available",
        description: "Your browser does not support voice recording.",
        variant: "destructive",
      });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recorderChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const type = recorder.mimeType || "audio/webm";
        const blob = new Blob(recorderChunksRef.current, { type });
        recorderChunksRef.current = [];
        for (const track of stream.getTracks()) track.stop();
        const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
        const file = new File([blob], `voice-note-${Date.now()}.${ext}`, { type });
        addFiles([file]);
      };
      recorder.start();
      recorderRef.current = recorder;
      setIsRecording(true);
    } catch (err) {
      toast({
        title: "Microphone permission denied",
        description: err instanceof Error ? err.message : "Could not start recording.",
        variant: "destructive",
      });
    }
  }

  function stopRecording() {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    setIsRecording(false);
  }

  // Auto-find an existing session for this bid/estimate, or create one.
  useEffect(() => {
    if (!enabled) return;
    if (sessionId) return;
    if (sessionsQuery.isLoading) return;
    const sessions = sessionsQuery.data?.sessions ?? [];
    const match = sessions.find(
      (s) => (bidId ? s.bidId === bidId : true) && (estimateId ? s.estimateId === estimateId : true),
    );
    if (match) {
      setSessionId(match.id);
    } else if (!createSession.isPending) {
      // Auto-create so the user doesn't need to click "Start a conversation".
      createSession.mutate();
    }
  }, [enabled, sessionsQuery.data, sessionsQuery.isLoading, bidId, estimateId, sessionId]);

  // After the session loads with no prior messages, fire a proactive opener
  // so the AI analyses what's already in the estimate and suggests improvements.
  useEffect(() => {
    if (!sessionId) return;
    if (hasAutoSentRef.current) return;
    if (messagesQuery.isLoading || !messagesQuery.data) return;
    const msgs = messagesQuery.data.messages ?? [];
    // Mark handled immediately to prevent double-fire on re-renders.
    hasAutoSentRef.current = true;
    if (msgs.length > 0) return;
    // Small delay so the chat UI is visible before the spinner appears.
    const timer = setTimeout(() => {
      sendTurn.mutate({ prompt: PROACTIVE_OPENER, attachments: [] });
    }, 400);
    return () => clearTimeout(timer);
  }, [sessionId, messagesQuery.data, messagesQuery.isLoading]);

  // Show a notice whenever line items change after the panel has mounted.
  // prevRevisionRef starts as undefined so the very first value doesn't trigger a banner.
  useEffect(() => {
    if (lineItemsRevision === undefined) return;
    if (prevRevisionRef.current === undefined) {
      prevRevisionRef.current = lineItemsRevision;
      return;
    }
    if (lineItemsRevision !== prevRevisionRef.current) {
      prevRevisionRef.current = lineItemsRevision;
      setShowUpdateNotice(true);
    }
  }, [lineItemsRevision]);

  // Show a notice whenever takeoff measurements change after the panel has mounted.
  // prevMeasurementsRevisionRef starts as undefined so the very first value doesn't trigger a banner.
  useEffect(() => {
    if (measurementsRevision === undefined) return;
    if (prevMeasurementsRevisionRef.current === undefined) {
      prevMeasurementsRevisionRef.current = measurementsRevision;
      return;
    }
    if (measurementsRevision !== prevMeasurementsRevisionRef.current) {
      prevMeasurementsRevisionRef.current = measurementsRevision;
      setShowUpdateNotice(true);
    }
  }, [measurementsRevision]);

  // Auto-scroll to bottom when new messages arrive — but only if already near the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (isNearBottom) {
      el.scrollTop = el.scrollHeight;
      setAtBottom(true);
    }
  }, [messagesQuery.data?.messages.length, sendTurn.isPending]);

  // Track scroll position to show/hide the jump-to-bottom button.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function onScroll() {
      if (!el) return;
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      setAtBottom(distFromBottom < 60);
    }
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [sessionId]);

  // Cleanup any object URLs on unmount.
  useEffect(() => {
    return () => {
      for (const p of pending) if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
    };
    // We intentionally don't depend on `pending` so this only runs on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!enabled) return null;

  const messages = messagesQuery.data?.messages ?? [];
  const isStarting = sessionsQuery.isLoading || createSession.isPending;

  // Task #2736 — derive the persistent change history from loaded messages.
  // An action counts as "in history" when the server-persisted decision is
  // "applied" AND the current in-memory state is not "idle" (i.e. it hasn't
  // been undone in this session) and not "rejected".
  interface HistoryItem {
    toolCallId: string;
    messageId: string;
    action: "add" | "edit" | "delete";
    payload: Record<string, unknown>;
    decisionAt?: string;
  }
  const appliedHistoryItems: HistoryItem[] = [];
  for (const msg of messages) {
    if (!msg.proposedActions) continue;
    for (const a of msg.proposedActions as Array<ProposedAction & { decision?: string; decisionAt?: string }>) {
      const liveState = actionStates[a.toolCallId];
      // Include when server says "applied" and local state is either applied,
      // applied-undoable, or not yet seeded (undefined — trust server).
      const serverApplied = a.decision === "applied";
      const locallyReverted = liveState === "idle" || liveState === "rejected";
      if (serverApplied && !locallyReverted) {
        appliedHistoryItems.push({
          toolCallId: a.toolCallId,
          messageId: msg.id,
          action: a.action,
          payload: a.payload,
          decisionAt: a.decisionAt,
        });
      }
    }
  }

  const readyAttachments = pending
    .filter((p) => p.status === "ready" && p.objectPath)
    .map<ChatAttachment>((p) => ({
      kind: p.kind,
      objectPath: p.objectPath!,
      contentType: p.contentType,
      fileName: p.fileName,
      sizeBytes: p.sizeBytes,
    }));
  const hasUploadingAttachments = pending.some((p) => p.status === "uploading");
  const canSend =
    (draft.trim().length > 0 || readyAttachments.length > 0) &&
    !sendTurn.isPending &&
    !hasUploadingAttachments;

  function handleSend() {
    if (!canSend) return;
    sendTurn.mutate({ prompt: draft.trim(), attachments: readyAttachments });
  }

  // Clipboard paste handler — drops any image File items into the attachment row.
  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = Array.from(e.clipboardData.items ?? []);
    const files: File[] = [];
    for (const item of items) {
      if (item.kind === "file") {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      addFiles(files);
    }
  }

  return (
    <Card
      className="flex flex-col h-full"
      data-testid="ai-estimator-chat-panel"
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes("Files")) {
          e.preventDefault();
        }
      }}
      onDrop={(e) => {
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          e.preventDefault();
          addFiles(e.dataTransfer.files);
        }
      }}
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span>Ask the Estimator</span>
          <div className="ml-auto flex items-center gap-1">
            {appliedHistoryItems.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant={showHistory ? "secondary" : "ghost"}
                className="h-6 px-2 text-[11px] gap-1 text-muted-foreground"
                onClick={() => setShowHistory((v) => !v)}
                title="View change history"
                data-testid="button-toggle-history"
              >
                <Clock className="h-3 w-3" />
                History
                <Badge variant="secondary" className="h-4 px-1 text-[10px] ml-0.5">
                  {appliedHistoryItems.length}
                </Badge>
                {showHistory ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </Button>
            )}
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-6 w-6 text-muted-foreground hover:text-destructive"
              onClick={() => clearChat.mutate()}
              disabled={!sessionId || clearChat.isPending}
              title="Clear chat and start fresh"
              data-testid="button-clear-chat"
            >
              {clearChat.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-2 min-h-0">
        {panelError && (
          <div
            className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
            data-testid="chat-panel-error"
          >
            <span className="font-medium">Error:</span>
            <span>{panelError}</span>
          </div>
        )}

        {/* Task #2736 — Change history panel */}
        {showHistory && appliedHistoryItems.length > 0 && (
          <div
            className="rounded-md border bg-muted/30 text-xs"
            data-testid="change-history-panel"
          >
            <div className="flex items-center gap-2 px-3 py-2 border-b">
              <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="font-medium text-foreground">Accepted changes this session</span>
              <span className="text-muted-foreground ml-auto">{appliedHistoryItems.length} item{appliedHistoryItems.length !== 1 ? "s" : ""}</span>
            </div>
            <div className="divide-y max-h-56 overflow-y-auto">
              {appliedHistoryItems.map((item) => {
                const p = item.payload;
                const isAdd = item.action === "add";
                const isEdit = item.action === "edit";
                const isDelete = item.action === "delete";
                const liveState = actionStates[item.toolCallId] ?? "applied";
                const isUndoing = liveState === "undoing";

                const label = isDelete
                  ? `Removed: ${String(p.description ?? "(line item)")}`
                  : isEdit
                    ? `Edited: ${String(p.description ?? "line item")}`
                    : `Added: ${String(p.description ?? "(new item)")}`;

                const acceptedAt = item.decisionAt
                  ? new Date(item.decisionAt).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })
                  : null;

                return (
                  <div
                    key={item.toolCallId}
                    className="flex items-center gap-2 px-3 py-2"
                    data-testid={`history-item-${item.toolCallId}`}
                  >
                    <div className="shrink-0">
                      {isDelete ? (
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      ) : isEdit ? (
                        <Pencil className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                      ) : (
                        <Plus className="h-3.5 w-3.5 text-primary" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="truncate font-medium text-foreground">{label}</div>
                      {acceptedAt && (
                        <div className="text-[10px] text-muted-foreground">{acceptedAt}</div>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[11px] gap-1 shrink-0 text-muted-foreground hover:text-foreground"
                      disabled={isUndoing}
                      onClick={() => handleUndoAction(item.toolCallId, item.messageId)}
                      data-testid={`button-history-undo-${item.toolCallId}`}
                    >
                      {isUndoing ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3 w-3" />
                      )}
                      {isUndoing ? "Undoing…" : "Undo"}
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {isStarting ? (
          <div className="flex flex-col items-center justify-center py-6 gap-2">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Analyzing your estimate…</p>
          </div>
        ) : (
          <>
            {showUpdateNotice && (
              <div
                className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-primary"
                data-testid="chat-estimate-updated-notice"
              >
                <Info className="h-4 w-4 shrink-0" />
                <span>Estimate updated — AI has the latest data for your next message.</span>
                <button
                  className="ml-auto text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setShowUpdateNotice(false)}
                  data-testid="button-dismiss-update-notice"
                  aria-label="Dismiss notice"
                >
                  ✕
                </button>
              </div>
            )}
            <div className="relative flex-1 min-h-0 flex flex-col">
              <ScrollArea className="flex-1">
                <div ref={scrollRef} className="space-y-3 pr-2">
                {messagesQuery.isLoading || sendTurn.isPending ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {sendTurn.isPending && messages.length === 0 ? "Analyzing estimate…" : "Thinking…"}
                  </div>
                ) : null}
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`rounded-md p-3 text-sm ${m.role === "user" ? "bg-muted ml-6" : "bg-primary/5 mr-6"}`}
                    data-testid={`chat-message-${m.id}`}
                  >
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{m.role}</div>
                    <div className="whitespace-pre-wrap">{m.content}</div>
                    {m.attachments && m.attachments.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5" data-testid={`message-attachments-${m.id}`}>
                        {m.attachments.map((a, idx) => (
                          <a
                            key={`${m.id}-att-${idx}`}
                            href={a.objectPath}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded border bg-background px-2 py-0.5 text-[11px] hover:bg-muted"
                            data-testid={`message-attachment-${m.id}-${idx}`}
                          >
                            {a.kind === "image" ? (
                              <ImageIcon className="h-3 w-3" />
                            ) : a.kind === "audio" ? (
                              <Mic className="h-3 w-3" />
                            ) : (
                              <FileText className="h-3 w-3" />
                            )}
                            <span className="truncate max-w-[180px]">{a.fileName}</span>
                            {a.transcript && (
                              <span className="text-[10px] text-muted-foreground">(transcribed)</span>
                            )}
                          </a>
                        ))}
                      </div>
                    )}
                    {m.citations && m.citations.length > 0 && (
                      <div className="mt-2 space-y-1">
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Sources</div>
                        {m.citations.map((c) => {
                          // Task #2453 — friendly label + click-through for
                          // standalone-takeoff sources. The retrieval layer
                          // already prefixes the title with
                          // "Standalone takeoff: …", so we strip the raw
                          // sourceType to avoid double-labelling.
                          if (c.sourceType === "standalone_takeoff") {
                            return (
                              <a
                                key={c.id}
                                href={`/takeoff/standalone/${c.sourceId}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-block mr-1"
                                data-testid={`citation-standalone-takeoff-${c.sourceId}`}
                              >
                                <Badge variant="outline" className="text-[10px] hover:bg-muted">
                                  {c.title.startsWith("Standalone takeoff:") ? c.title : `Standalone takeoff: ${c.title}`}
                                </Badge>
                              </a>
                            );
                          }
                          return (
                            <Badge key={c.id} variant="outline" className="text-[10px] mr-1">
                              {c.sourceType}: {c.title}
                            </Badge>
                          );
                        })}
                      </div>
                    )}

                    {/* Task #2729 — proposed action cards for Claude tool-use */}
                    {m.role === "assistant" && m.proposedActions && m.proposedActions.length > 0 && (() => {
                      const pendingIds = m.proposedActions.filter(
                        (a) => !a.validationError && (actionStates[a.toolCallId] ?? "idle") === "idle",
                      );
                      const pendingAnyIds = m.proposedActions.filter(
                        (a) => (actionStates[a.toolCallId] ?? "idle") === "idle",
                      );
                      const hasBulk = pendingIds.length > 1 || pendingAnyIds.length > 1;
                      return (
                        <div className="mt-3 space-y-2" data-testid={`proposed-actions-${m.id}`}>
                          <div className="flex items-center gap-2">
                            <div className="text-[10px] text-muted-foreground uppercase tracking-wider flex-1">
                              Proposed changes — review and accept or reject each
                            </div>
                            {hasBulk && (
                              <div className="flex gap-1 shrink-0">
                                {pendingIds.length > 0 && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-5 px-2 text-[10px] gap-1"
                                    onClick={() => handleAcceptAll(m.id, m.proposedActions!)}
                                    data-testid={`button-accept-all-${m.id}`}
                                  >
                                    <CheckCircle className="h-2.5 w-2.5" />
                                    Accept all
                                  </Button>
                                )}
                                {pendingAnyIds.length > 0 && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-5 px-2 text-[10px] gap-1 text-muted-foreground hover:text-destructive"
                                    onClick={() => handleRejectAll(m.id, m.proposedActions!)}
                                    data-testid={`button-reject-all-${m.id}`}
                                  >
                                    <XCircle className="h-2.5 w-2.5" />
                                    Reject all
                                  </Button>
                                )}
                              </div>
                            )}
                          </div>
                          {m.proposedActions.map((action) => (
                            <ProposedActionCard
                              key={action.toolCallId}
                              action={action}
                              messageId={m.id}
                              sessionId={sessionId ?? ""}
                              bidId={bidId}
                              state={actionStates[action.toolCallId] ?? "idle"}
                              errorMessage={actionErrors[action.toolCallId]}
                              undoTimeLeft={undoCountdowns[action.toolCallId]}
                              onApply={handleApplyAction}
                              onReject={handleRejectAction}
                              onUndo={handleUndoAction}
                            />
                          ))}
                        </div>
                      );
                    })()}

                    {m.role === "assistant" && (
                      <div className="mt-2 flex gap-1">
                        <Button
                          size="icon"
                          variant={m.feedbackOutcome === "THUMBS_UP" ? "default" : "ghost"}
                          className="h-6 w-6"
                          onClick={() => sendFeedback.mutate({ messageId: m.id, outcome: "THUMBS_UP" })}
                          data-testid={`button-thumbs-up-${m.id}`}
                        >
                          <ThumbsUp className="h-3 w-3" />
                        </Button>
                        <Button
                          size="icon"
                          variant={m.feedbackOutcome === "THUMBS_DOWN" ? "destructive" : "ghost"}
                          className="h-6 w-6"
                          onClick={() => sendFeedback.mutate({ messageId: m.id, outcome: "THUMBS_DOWN" })}
                          data-testid={`button-thumbs-down-${m.id}`}
                        >
                          <ThumbsDown className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
            {!atBottom && (
              <button
                type="button"
                onClick={scrollToBottom}
                className="absolute bottom-2 right-4 z-10 flex h-7 w-7 items-center justify-center rounded-full border bg-background shadow-md hover:bg-muted transition-opacity"
                aria-label="Scroll to latest message"
                data-testid="button-scroll-to-bottom"
              >
                <ArrowDown className="h-4 w-4 text-muted-foreground" />
              </button>
            )}
            </div>

            {pending.length > 0 && (
              <div
                className="flex flex-wrap gap-2 border rounded-md p-2 bg-muted/40"
                data-testid="pending-attachments"
              >
                {pending.map((p) => (
                  <div
                    key={p.id}
                    className={`flex items-center gap-2 rounded border bg-background px-2 py-1 text-xs ${p.status === "error" ? "border-destructive/60" : ""}`}
                    data-testid={`pending-attachment-${p.id}`}
                  >
                    {p.kind === "image" && p.previewUrl ? (
                      <img src={p.previewUrl} alt={p.fileName} className="h-8 w-8 rounded object-cover" />
                    ) : p.kind === "audio" ? (
                      <Mic className="h-4 w-4" />
                    ) : (
                      <FileText className="h-4 w-4" />
                    )}
                    <div className="flex flex-col leading-tight">
                      <span className="truncate max-w-[160px]">{p.fileName}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {formatBytes(p.sizeBytes)}
                        {p.status === "uploading" && " · uploading…"}
                        {p.status === "error" && ` · ${p.errorMessage ?? "error"}`}
                      </span>
                    </div>
                    {p.status === "uploading" && <Loader2 className="h-3 w-3 animate-spin" />}
                    <button
                      type="button"
                      onClick={() => removePending(p.id)}
                      className="ml-1 text-muted-foreground hover:text-foreground"
                      data-testid={`remove-attachment-${p.id}`}
                      aria-label={`Remove ${p.fileName}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-col gap-2 pt-2 border-t">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,text/csv,text/markdown"
                hidden
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = "";
                }}
                data-testid="input-attach-file"
              />
              <input
                ref={imageInputRef}
                type="file"
                multiple
                accept="image/*"
                capture="environment"
                hidden
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = "";
                }}
                data-testid="input-attach-image"
              />
              <div className="flex gap-2">
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onPaste={handlePaste}
                  placeholder="Ask, attach a doc, paste a screenshot, or hit the mic to record a voice note…"
                  className="min-h-[60px] resize-none text-sm"
                  data-testid="input-chat-prompt"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSend) {
                      handleSend();
                    }
                  }}
                />
                <Button onClick={handleSend} disabled={!canSend} data-testid="button-send-chat">
                  {sendTurn.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={pending.length >= MAX_ATTACHMENTS}
                  data-testid="button-attach-file"
                  title="Attach a document (PDF, DOC, XLS, CSV, TXT)"
                >
                  <Paperclip className="h-3.5 w-3.5 mr-1" /> File
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={pending.length >= MAX_ATTACHMENTS}
                  data-testid="button-attach-image"
                  title="Attach a photo or screenshot"
                >
                  <ImageIcon className="h-3.5 w-3.5 mr-1" /> Image
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={isRecording ? "destructive" : "ghost"}
                  className="h-7 px-2 text-xs"
                  onClick={isRecording ? stopRecording : startRecording}
                  disabled={!isRecording && pending.length >= MAX_ATTACHMENTS}
                  data-testid="button-record-voice"
                  title={isRecording ? "Stop recording" : "Record a voice note"}
                >
                  {isRecording ? (
                    <>
                      <Square className="h-3.5 w-3.5 mr-1" /> Stop
                    </>
                  ) : (
                    <>
                      <Mic className="h-3.5 w-3.5 mr-1" /> Voice
                    </>
                  )}
                </Button>
                <span className="ml-auto text-[10px] text-muted-foreground">
                  Tip: paste screenshots, drop files, or ⌘/Ctrl+Enter to send
                </span>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
