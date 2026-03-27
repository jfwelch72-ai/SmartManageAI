import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Loader2, MessageSquare, ExternalLink } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { AttachmentRenderer } from "./AttachmentRenderer";
import { MessageComposer } from "./MessageComposer";
import { getInitials, type Message, type TaskMention, type EntitySearchResult } from "./types";

interface EntityMessage extends Message {
  conversationName?: string | null;
  conversationId?: string;
}

interface EntityDiscussionProps {
  entityType: "RFI" | "CHANGE_ORDER" | "TASK";
  entityId: string;
}

export function EntityDiscussion({ entityType, entityId }: EntityDiscussionProps) {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [messageInput, setMessageInput] = useState("");
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [uploadingVoice, setUploadingVoice] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionAnchor, setMentionAnchor] = useState<number>(0);
  const [pendingTaskIds, setPendingTaskIds] = useState<string[]>([]);
  const [pendingEntityLinks, setPendingEntityLinks] = useState<EntitySearchResult[]>([]);
  const [mentionSelectedIdx, setMentionSelectedIdx] = useState(0);

  const [entityConversationId, setEntityConversationId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function checkExisting() {
      try {
        const res = await fetch(`/api/entity-conversation/${entityType}/${entityId}`, { credentials: "include" });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (data?.id && !cancelled) {
          setEntityConversationId(data.id);
        }
      } catch (err) {
        console.error("Entity conversation check failed:", err);
      }
    }
    checkExisting();
    return () => { cancelled = true; };
  }, [entityType, entityId]);

  const ensureConversation = async (): Promise<string> => {
    if (entityConversationId) return entityConversationId;
    const res = await apiRequest("POST", "/api/entity-conversation", { entityType, entityId });
    const conv = await res.json();
    setEntityConversationId(conv.id);
    return conv.id;
  };

  const { data: threadMessages = [], isLoading: threadLoading } = useQuery<Message[]>({
    queryKey: ["/api/conversations", entityConversationId, "messages"],
    enabled: !!entityConversationId,
    queryFn: async () => {
      if (!entityConversationId) return [];
      const res = await fetch(`/api/conversations/${entityConversationId}/messages`, { credentials: "include" });
      if (!res.ok) return [];
      const data = await res.json();
      return data.messages || [];
    },
    refetchInterval: 15000,
  });

  const { data: relatedMessages = [] } = useQuery<EntityMessage[]>({
    queryKey: ["/api/entity-messages", entityType, entityId],
    queryFn: async () => {
      const res = await fetch(`/api/entity-messages/${entityType}/${entityId}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 30000,
  });

  const crossConversationMessages = relatedMessages.filter(
    m => m.conversationId && m.conversationId !== entityConversationId
  );

  const { data: mentionResults = [] } = useQuery<TaskMention[]>({
    queryKey: ["/api/tasks/search", mentionQuery],
    enabled: !!mentionQuery && mentionQuery.length >= 2,
    queryFn: async () => {
      const res = await fetch(`/api/tasks?search=${encodeURIComponent(mentionQuery!)}`, { credentials: "include" });
      if (!res.ok) return [];
      const tasks = await res.json();
      return (tasks as { id: string; title: string }[]).slice(0, 5).map((t) => ({ id: t.id, title: t.title }));
    },
  });

  const sendMutation = useMutation({
    mutationFn: async (payload: { content: string; attachmentUrl?: string; attachmentName?: string; attachmentType?: string; attachmentSize?: number; mentionedTaskIds?: string[]; entityLinks?: { entityType: string; entityId: string }[] }) => {
      const conversationId = await ensureConversation();
      const msgRes = await apiRequest("POST", `/api/conversations/${conversationId}/messages`, payload);
      return msgRes.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations", entityConversationId, "messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/entity-messages", entityType, entityId] });
      setMessageInput("");
      setPendingTaskIds([]);
      setPendingEntityLinks([]);
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [threadMessages]);

  const handleSend = useCallback(() => {
    const trimmed = messageInput.trim();
    if (!trimmed || sendMutation.isPending) return;
    const allEntityLinks = [
      { entityType, entityId },
      ...pendingEntityLinks.map(e => ({ entityType: e.entityType, entityId: e.entityId })),
    ];
    sendMutation.mutate({
      content: trimmed,
      mentionedTaskIds: pendingTaskIds.length > 0 ? pendingTaskIds : undefined,
      entityLinks: allEntityLinks,
    });
  }, [messageInput, sendMutation, pendingTaskIds, pendingEntityLinks, entityType, entityId]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setMessageInput(val);
    const cursor = e.target.selectionStart;
    const beforeCursor = val.slice(0, cursor);
    const match = beforeCursor.match(/@(\w*)$/);
    if (match) {
      setMentionQuery(match[1]);
      setMentionAnchor(cursor - match[0].length);
      setMentionSelectedIdx(0);
    } else {
      setMentionQuery(null);
    }
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery !== null && mentionResults.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMentionSelectedIdx(i => Math.min(i + 1, mentionResults.length - 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setMentionSelectedIdx(i => Math.max(i - 1, 0)); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); handleMentionSelect(mentionResults[mentionSelectedIdx]); return; }
      if (e.key === "Escape") { setMentionQuery(null); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [mentionQuery, mentionResults, mentionSelectedIdx, handleSend]);

  const handleMentionSelect = useCallback((task: TaskMention) => {
    const before = messageInput.slice(0, mentionAnchor);
    const after = messageInput.slice(textareaRef.current?.selectionStart || mentionAnchor);
    setMessageInput(`${before}@[${task.title}](${task.id})${after}`);
    if (!pendingTaskIds.includes(task.id)) setPendingTaskIds(prev => [...prev, task.id]);
    setMentionQuery(null);
  }, [messageInput, mentionAnchor, pendingTaskIds]);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingFile(true);
    setUploadProgress(0);
    try {
      const convId = await ensureConversation();
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/conversations/${convId}/upload`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) throw new Error("Upload failed");
      setUploadProgress(100);
      const data = await res.json();
      const allEntityLinks = [
        { entityType, entityId },
        ...pendingEntityLinks.map(el => ({ entityType: el.entityType, entityId: el.entityId })),
      ];
      sendMutation.mutate({
        content: data.name || "File attachment",
        attachmentUrl: data.url,
        attachmentName: data.name,
        attachmentType: data.type,
        attachmentSize: data.size,
        entityLinks: allEntityLinks,
      });
    } catch (err) {
      console.error("File upload failed:", err);
    } finally {
      setUploadingFile(false);
      setUploadProgress(0);
    }
  }, [entityType, entityId, pendingEntityLinks, sendMutation]);

  const handleStartRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        setUploadingVoice(true);
        try {
          const convId = await ensureConversation();
          const formData = new FormData();
          formData.append("file", blob, `voice-${Date.now()}.webm`);
          const res = await fetch(`/api/conversations/${convId}/upload`, { method: "POST", body: formData, credentials: "include" });
          if (res.ok) {
            const data = await res.json();
            sendMutation.mutate({
              content: "Voice message",
              attachmentUrl: data.url,
              attachmentName: data.name,
              attachmentType: data.type,
              attachmentSize: data.size,
              entityLinks: [{ entityType, entityId }],
            });
          }
        } finally {
          setUploadingVoice(false);
        }
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = window.setInterval(() => setRecordingSeconds(s => s + 1), 1000);
    } catch (err) {
      console.error("Mic access denied:", err);
    }
  }, [entityType, entityId, sendMutation]);

  const handleStopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
  }, []);

  const handleAddEntityLink = useCallback((entity: EntitySearchResult) => {
    if (!pendingEntityLinks.some(e => e.entityType === entity.entityType && e.entityId === entity.entityId)) {
      setPendingEntityLinks(prev => [...prev, entity]);
    }
  }, [pendingEntityLinks]);

  const handleRemoveEntityLink = useCallback((eType: string, eId: string) => {
    setPendingEntityLinks(prev => prev.filter(e => !(e.entityType === eType && e.entityId === eId)));
  }, []);

  const navigateToConversation = (conversationId: string) => {
    setLocation(`/messages?conversation=${conversationId}`);
  };

  const openFullThread = () => {
    if (entityConversationId) {
      setLocation(`/messages?conversation=${entityConversationId}`);
    }
  };

  return (
    <div className="border-t pt-4 space-y-4" data-testid={`entity-discussion-${entityType}-${entityId}`}>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-medium flex items-center gap-2 text-sm">
            <MessageSquare className="h-4 w-4" />
            Discussion Thread
            {threadMessages.length > 0 && (
              <span className="text-xs text-muted-foreground">({threadMessages.length})</span>
            )}
          </h3>
          {entityConversationId && threadMessages.length > 0 && (
            <button
              onClick={openFullThread}
              className="text-xs text-primary hover:underline inline-flex items-center gap-1"
              data-testid="link-open-full-thread"
            >
              Open in Messages <ExternalLink className="w-3 h-3" />
            </button>
          )}
        </div>

        {threadLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        ) : threadMessages.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="text-no-discussion">
            No discussion messages yet. Start a conversation below.
          </p>
        ) : (
          <div className="space-y-3 max-h-[250px] overflow-y-auto pr-1">
            {threadMessages.map((msg) => {
              const isOwn = msg.senderId === user?.id;
              return (
                <div key={msg.id} className="flex gap-2" data-testid={`discussion-message-${msg.id}`}>
                  <Avatar className="h-6 w-6 shrink-0 mt-0.5">
                    <AvatarFallback className="text-[9px]">
                      {getInitials(msg.sender.firstName, msg.sender.lastName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold">
                        {isOwn ? "You" : `${msg.sender.firstName} ${msg.sender.lastName}`}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {formatDistanceToNow(new Date(msg.createdAt), { addSuffix: true })}
                      </span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>
                    {msg.attachmentUrl && (
                      <div className="mt-1">
                        <AttachmentRenderer
                          url={msg.attachmentUrl}
                          name={msg.attachmentName}
                          type={msg.attachmentType}
                          size={msg.attachmentSize}
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}

        <MessageComposer
          messageInput={messageInput}
          isRecording={isRecording}
          recordingSeconds={recordingSeconds}
          uploadingFile={uploadingFile}
          uploadingVoice={uploadingVoice}
          uploadProgress={uploadProgress}
          pendingTaskIds={pendingTaskIds}
          pendingEntityLinks={pendingEntityLinks}
          mentionQuery={mentionQuery}
          mentionResults={mentionResults}
          mentionSelectedIdx={mentionSelectedIdx}
          typingNames={{}}
          sendPending={sendMutation.isPending}
          onInputChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onSend={handleSend}
          onFileSelect={handleFileSelect}
          onStartRecording={handleStartRecording}
          onStopRecording={handleStopRecording}
          onMentionSelect={handleMentionSelect}
          onRemovePendingTask={(id) => setPendingTaskIds(prev => prev.filter(t => t !== id))}
          onAddEntityLink={handleAddEntityLink}
          onRemoveEntityLink={handleRemoveEntityLink}
          textareaRef={textareaRef}
        />
      </div>

      {crossConversationMessages.length > 0 && (
        <div className="space-y-2 border-t pt-3">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <ExternalLink className="h-3 w-3" />
            Related Messages ({crossConversationMessages.length})
          </h4>
          <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
            {crossConversationMessages.map((msg) => (
              <div
                key={msg.id}
                className="flex items-start gap-2 p-2 rounded-md border bg-muted/30 hover:bg-muted/50 transition-colors"
                data-testid={`related-message-${msg.id}`}
              >
                <Avatar className="h-5 w-5 shrink-0 mt-0.5">
                  <AvatarFallback className="text-[8px]">
                    {getInitials(msg.sender.firstName, msg.sender.lastName)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-semibold">
                      {msg.sender.firstName} {msg.sender.lastName}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {formatDistanceToNow(new Date(msg.createdAt), { addSuffix: true })}
                    </span>
                    {msg.conversationName && (
                      <button
                        onClick={() => msg.conversationId && navigateToConversation(msg.conversationId)}
                        className="text-[10px] text-primary hover:underline cursor-pointer inline-flex items-center gap-0.5"
                        data-testid={`link-conversation-${msg.id}`}
                      >
                        <ExternalLink className="h-2.5 w-2.5" />
                        {msg.conversationName}
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">{msg.content}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
