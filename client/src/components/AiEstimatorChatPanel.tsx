import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  FileText,
  Image as ImageIcon,
  Info,
  Loader2,
  Mic,
  Paperclip,
  Send,
  Sparkles,
  Square,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
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

interface ChatMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  citations: Array<{ id: string; sourceType: string; sourceId: string; title: string; snippet: string }> | null;
  attachments: ChatAttachment[] | null;
  feedbackOutcome: "THUMBS_UP" | "THUMBS_DOWN" | null;
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

  const [panelError, setPanelError] = useState<string | null>(null);

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

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messagesQuery.data?.messages.length]);

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
          <Sparkles className="h-4 w-4 text-primary" /> Ask the Estimator
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
