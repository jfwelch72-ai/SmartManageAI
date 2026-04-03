import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useSearch, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useMessagingEvents, type CallEventHandler } from "@/hooks/use-messaging-events";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronLeft, Building2, FolderOpen, HardHat, Hash, MessageSquare, Loader2, FileQuestion, ArrowRightLeft, CheckSquare, Video, Users } from "lucide-react";
import { getInitials } from "@/components/messaging/types";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useGlobalVideoCall } from "@/contexts/GlobalVideoCallContext";

import { Sidebar } from "@/components/messaging/Sidebar";
import { MessageList } from "@/components/messaging/MessageList";
import { OngoingCallBanner } from "@/components/messaging/OngoingCallBanner";
import { CallHistory } from "@/components/messaging/CallHistory";
import { AllCallNotes } from "@/components/messaging/AllCallNotes";
import {
  type User,
  type Channel,
  type Conversation,
  type Message,
  type MessageReaction,
  type TaskMention,
  type EntitySearchResult,
  type VideoCallData,
} from "@/components/messaging/types";

export function TeamMessagesContent({ compact = false }: { compact?: boolean }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const searchString = useSearch();
  const [, navigate] = useLocation();
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [isMobileView, setIsMobileView] = useState(false);
  const { startGlobalCall, activeCall: globalActiveCall } = useGlobalVideoCall();

  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const convId = params.get("conversation");
    if (convId) {
      setSelectedConversationId(convId);
    }
  }, [searchString]);

  useEffect(() => {
    const handleSelectConversation = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      if (detail?.conversationId) {
        setSelectedConversationId(detail.conversationId);
      }
    };
    window.addEventListener("select-conversation", handleSelectConversation);
    return () => window.removeEventListener("select-conversation", handleSelectConversation);
  }, []);

  // ── Message composer state ──
  const [messageInput, setMessageInput] = useState("");
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [uploadingVoice, setUploadingVoice] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);

  // ── Task mention state ──
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionAnchor, setMentionAnchor] = useState<number>(0);
  const [pendingTaskIds, setPendingTaskIds] = useState<string[]>([]);
  const [pendingEntityLinks, setPendingEntityLinks] = useState<EntitySearchResult[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mentionSelectedIdx, setMentionSelectedIdx] = useState(0);

  // ── Edit / delete / react state ──
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [popoverMsgId, setPopoverMsgId] = useState<string | null>(null);

  // ── Scroll refs ──
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const scrollTopRef = useRef<number>(0);
  const isAtBottomRef = useRef<boolean>(true);
  const prevMessageCountRef = useRef<number>(0);
  const lastTypingSignalRef = useRef<number>(0);

  // ── Video call state ──
  const [activeCallConversationIds, setActiveCallConversationIds] = useState<Set<string>>(new Set());
  const [startingCall, setStartingCall] = useState(false);
  const [showCallNotes, setShowCallNotes] = useState(false);

  const [conversationActiveCalls, setConversationActiveCalls] = useState<Record<string, VideoCallData>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/conversations/active-calls", { credentials: "include" });
        const calls: VideoCallData[] = res.ok ? await res.json() : [];
        if (cancelled) return;
        if (!calls.length) {
          setActiveCallConversationIds(new Set());
          setConversationActiveCalls({});
          return;
        }
        const ids = new Set<string>();
        const callMap: Record<string, VideoCallData> = {};
        let callToRestore: VideoCallData | null = null;
        for (const callData of calls) {
          ids.add(callData.conversationId);
          callMap[callData.conversationId] = callData;
          if (!callToRestore && (callData.initiatorId === user?.id || callData.participants.some(p => p.userId === user?.id))) {
            callToRestore = callData;
          }
        }
        setActiveCallConversationIds(ids);
        setConversationActiveCalls(callMap);
        if (callToRestore && !cancelled) {
          const convsRes = await fetch("/api/conversations", { credentials: "include" });
          const convs: Conversation[] = convsRes.ok ? await convsRes.json() : [];
          if (cancelled) return;
          const conv = convs.find(c => c.id === callToRestore!.conversationId);
          if (conv) startGlobalCall(callToRestore, conv);
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  useEffect(() => {
    if (!selectedConversationId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/conversations/${selectedConversationId}/active-call`, { credentials: "include" });
        const callData: VideoCallData | null = res.ok ? await res.json() : null;
        if (cancelled) return;
        if (!callData) {
          setConversationActiveCalls(prev => {
            const next = { ...prev };
            delete next[selectedConversationId];
            return next;
          });
          return;
        }
        if (globalActiveCall?.id === callData.id) return;
        setConversationActiveCalls(prev => ({ ...prev, [callData.conversationId]: callData }));
        if (!globalActiveCall && (callData.initiatorId === user?.id || callData.participants.some(p => p.userId === user?.id))) {
          const convsRes = await fetch("/api/conversations", { credentials: "include" });
          const convs: Conversation[] = convsRes.ok ? await convsRes.json() : [];
          if (cancelled) return;
          const conv = convs.find(c => c.id === callData.conversationId);
          if (conv) startGlobalCall(callData, conv);
        }
        setActiveCallConversationIds(prev => {
          const next = new Set(prev);
          next.add(callData.conversationId);
          return next;
        });
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [selectedConversationId]);

  // ── Stable updater for SSE hook ──
  const updateOlderMessage = useCallback(
    (messageId: string, updater: (m: Message) => Message) => {
      setOlderMessages(prev => prev.map(m => m.id === messageId ? updater(m) : m));
    },
    []
  );

  const callEventHandler = useMemo<CallEventHandler>(() => ({
    onCallStarted: (data) => {
      setActiveCallConversationIds(prev => {
        const next = new Set(prev);
        next.add(data.call.conversationId);
        return next;
      });
      setConversationActiveCalls(prev => ({ ...prev, [data.call.conversationId]: data.call }));
    },
    onCallJoined: (data) => {
      const newParticipant = {
        id: "",
        callId: data.callId,
        userId: data.userId,
        joinedAt: new Date().toISOString(),
        leftAt: null,
        user: { id: data.userId, firstName: data.userName.split(" ")[0] || "", lastName: data.userName.split(" ").slice(1).join(" ") || "", role: "" },
      };
      setConversationActiveCalls(prev => {
        const convId = data.conversationId;
        const existing = prev[convId];
        if (!existing || existing.id !== data.callId) return prev;
        const alreadyIn = existing.participants.some(p => p.userId === data.userId);
        if (alreadyIn) return prev;
        return { ...prev, [convId]: { ...existing, status: "ACTIVE", participants: [...existing.participants, newParticipant] } };
      });
    },
    onCallLeft: (data) => {
      setConversationActiveCalls(prev => {
        const convId = data.conversationId;
        const existing = prev[convId];
        if (!existing || existing.id !== data.callId) return prev;
        return { ...prev, [convId]: { ...existing, participants: existing.participants.filter(p => p.userId !== data.userId) } };
      });
    },
    onCallEnded: (data) => {
      setActiveCallConversationIds(prev => {
        const next = new Set(prev);
        next.delete(data.conversationId);
        return next;
      });
      setConversationActiveCalls(prev => {
        const next = { ...prev };
        delete next[data.conversationId];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["/api/conversations", data.conversationId, "messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/conversations", data.conversationId, "calls"] });
    },
  }), []);

  const { sseLive, typingNames } = useMessagingEvents(selectedConversationId, updateOlderMessage, callEventHandler);

  // ── Pagination state ──
  const [olderMessages, setOlderMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const hasLoadedAllRef = useRef(false);

  const MAX_VOICE_SECONDS = 120;

  useEffect(() => {
    const checkMobile = () => setIsMobileView(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // ── Data queries ──
  const { data: conversations = [] } = useQuery<Conversation[]>({
    queryKey: ["/api/conversations"],
    refetchInterval: 10000,
  });

  const { data: allChannels = [] } = useQuery<Channel[]>({
    queryKey: ["/api/channels"],
    refetchInterval: 30000,
  });

  const { data: companyChannel } = useQuery<Conversation>({
    queryKey: ["/api/conversations/company-channel"],
  });

  const { data: availableUsers = [] } = useQuery<User[]>({
    queryKey: ["/api/messaging/users"],
  });

  // Reset pagination when conversation changes
  useEffect(() => {
    setOlderMessages([]);
    setHasMore(false);
    setIsLoadingMore(false);
    hasLoadedAllRef.current = false;
    scrollTopRef.current = 0;
    isAtBottomRef.current = true;
    prevMessageCountRef.current = 0;
  }, [selectedConversationId]);

  // Track native scroll and whether user is near bottom
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const onScroll = () => {
      scrollTopRef.current = container.scrollTop;
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      isAtBottomRef.current = distanceFromBottom < 100;
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [selectedConversationId]);

  const { data: latestMessages = [], isLoading: messagesLoading } = useQuery<Message[]>({
    queryKey: ["/api/conversations", selectedConversationId, "messages"],
    enabled: !!selectedConversationId,
    refetchInterval: sseLive ? false : 10_000,
    queryFn: async () => {
      if (!selectedConversationId) return [];
      const res = await fetch(`/api/conversations/${selectedConversationId}/messages`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch messages");
      const data = await res.json() as { messages: Message[]; hasMore: boolean };
      if (!hasLoadedAllRef.current) setHasMore(data.hasMore);
      return data.messages;
    },
  });

  const messages = [...olderMessages, ...latestMessages];

  const { data: mentionResults = [] } = useQuery<TaskMention[]>({
    queryKey: ["/api/conversations", selectedConversationId, "mention-search", mentionQuery],
    enabled: mentionQuery !== null && !!selectedConversationId,
    queryFn: async () => {
      if (!selectedConversationId) return [];
      const res = await fetch(
        `/api/conversations/${selectedConversationId}/mention-search?q=${encodeURIComponent(mentionQuery || "")}`,
        { credentials: "include" }
      );
      if (!res.ok) return [];
      return res.json();
    },
  });

  useEffect(() => setMentionSelectedIdx(0), [mentionResults]);

  // Auto-select company channel
  useEffect(() => {
    if (!selectedConversationId && companyChannel) {
      setSelectedConversationId(companyChannel.id);
    }
  }, [companyChannel, selectedConversationId]);

  // ── Mark as read ──
  const markAsReadMutation = useMutation({
    mutationFn: async (conversationId: string) => {
      const response = await apiRequest("POST", `/api/conversations/${conversationId}/read`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/messages/unread-count"] });
    },
  });

  useEffect(() => {
    if (selectedConversationId) {
      const c = conversations.find(c => c.id === selectedConversationId);
      if (c && c.unreadCount > 0) markAsReadMutation.mutate(selectedConversationId);
    }
  }, [selectedConversationId, conversations]);

  // ── Send message ──
  const sendMessageMutation = useMutation({
    mutationFn: async (payload: {
      conversationId: string;
      content: string;
      attachmentUrl?: string;
      attachmentName?: string;
      attachmentType?: string;
      attachmentSize?: number;
      voiceUrl?: string;
      voiceDurationSeconds?: number;
      mentionedTaskIds?: string[];
      entityLinks?: { entityType: string; entityId: string }[];
    }) => {
      const { conversationId, ...body } = payload;
      const response = await apiRequest("POST", `/api/conversations/${conversationId}/messages`, body);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations", selectedConversationId, "messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      setMessageInput("");
      setPendingTaskIds([]);
      setPendingEntityLinks([]);
    },
  });

  const editMessageMutation = useMutation({
    mutationFn: async ({ messageId, content }: { messageId: string; content: string }) => {
      const response = await apiRequest("PATCH", `/api/messages/${messageId}`, { content });
      return response.json() as Promise<Message>;
    },
    onSuccess: (updatedMsg: Message) => {
      const applyEdit = (m: Message) => m.id === updatedMsg.id ? { ...m, ...updatedMsg } : m;
      queryClient.setQueryData<Message[]>(
        ["/api/conversations", selectedConversationId, "messages"],
        (prev = []) => prev.map(applyEdit)
      );
      updateOlderMessage(updatedMsg.id, applyEdit);
      setEditingMessageId(null);
      setEditContent("");
    },
  });

  const deleteMessageMutation = useMutation({
    mutationFn: async (messageId: string) => {
      const response = await apiRequest("DELETE", `/api/messages/${messageId}`);
      return response.json() as Promise<Message>;
    },
    onSuccess: (deletedMsg: Message) => {
      const applyDelete = (m: Message) =>
        m.id === deletedMsg.id ? { ...m, ...deletedMsg, reactions: [] } : m;
      queryClient.setQueryData<Message[]>(
        ["/api/conversations", selectedConversationId, "messages"],
        (prev = []) => prev.map(applyDelete)
      );
      updateOlderMessage(deletedMsg.id, applyDelete);
    },
  });

  const reactMutation = useMutation({
    mutationFn: async ({ messageId, emoji }: { messageId: string; emoji: string }) => {
      const response = await apiRequest("POST", `/api/messages/${messageId}/reactions`, { emoji });
      return response.json() as Promise<{ reactions: MessageReaction[] }>;
    },
    onSuccess: (data, { messageId }) => {
      const applyReaction = (m: Message) =>
        m.id === messageId ? { ...m, reactions: data.reactions } : m;
      queryClient.setQueryData<Message[]>(
        ["/api/conversations", selectedConversationId, "messages"],
        (prev = []) => prev.map(applyReaction)
      );
      updateOlderMessage(messageId, applyReaction);
      setPopoverMsgId(null);
    },
  });

  // ── Load earlier messages ──
  const loadMoreMessages = async () => {
    if (!selectedConversationId || isLoadingMore || !hasMore) return;

    const oldest = olderMessages.length > 0 ? olderMessages[0] : latestMessages[0];
    if (!oldest) return;

    const container = scrollContainerRef.current;
    const prevScrollHeight = container?.scrollHeight ?? 0;
    const prevScrollTop = container?.scrollTop ?? 0;

    setIsLoadingMore(true);
    try {
      const res = await fetch(
        `/api/conversations/${selectedConversationId}/messages?before=${oldest.id}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to load earlier messages");
      const data = await res.json() as { messages: Message[]; hasMore: boolean };
      setOlderMessages(prev => [...data.messages, ...prev]);
      setHasMore(data.hasMore);
      if (!data.hasMore) hasLoadedAllRef.current = true;
      if (container) {
        requestAnimationFrame(() => {
          container.scrollTop = prevScrollTop + (container.scrollHeight - prevScrollHeight);
        });
      }
    } catch (err) {
      console.error("Load more messages error:", err);
    } finally {
      setIsLoadingMore(false);
    }
  };

  const loadMoreRef = useRef(loadMoreMessages);
  useEffect(() => { loadMoreRef.current = loadMoreMessages; });

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const container = scrollContainerRef.current;
    if (!sentinel || !hasMore) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) loadMoreRef.current(); },
      { root: container, threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, selectedConversationId]);

  useEffect(() => {
    const messageCount = latestMessages.length;
    const hasNewMessages = messageCount > prevMessageCountRef.current;
    prevMessageCountRef.current = messageCount;
    if (hasNewMessages && isAtBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [latestMessages]);

  // ── Composer handlers ──
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setMessageInput(val);

    if (selectedConversationId) {
      const now = Date.now();
      if (now - lastTypingSignalRef.current > 2_000) {
        lastTypingSignalRef.current = now;
        fetch(`/api/conversations/${selectedConversationId}/typing`, { method: "POST", credentials: "include" }).catch(() => {});
      }
    }

    const cursor = e.target.selectionStart || val.length;
    const textBefore = val.slice(0, cursor);
    const atIdx = textBefore.lastIndexOf("@");
    if (atIdx !== -1) {
      const fragment = textBefore.slice(atIdx + 1);
      if (!fragment.includes(" ")) {
        setMentionQuery(fragment);
        setMentionAnchor(atIdx);
        return;
      }
    }
    setMentionQuery(null);
  };

  const insertTaskMention = (task: TaskMention | null = mentionResults[mentionSelectedIdx]) => {
    if (!task) return;
    const before = messageInput.slice(0, mentionAnchor);
    const after = messageInput.slice(mentionAnchor + 1 + (mentionQuery?.length || 0));
    setMessageInput(before + `@[${task.title}](${task.id})` + after);
    setPendingTaskIds(prev => [...prev, task.id]);
    setMentionQuery(null);
    textareaRef.current?.focus();
  };

  const handleSendMessage = () => {
    if (!messageInput.trim() || !selectedConversationId || sendMessageMutation.isPending) return;
    sendMessageMutation.mutate({
      conversationId: selectedConversationId,
      content: messageInput,
      mentionedTaskIds: pendingTaskIds.length > 0 ? pendingTaskIds : undefined,
      entityLinks: pendingEntityLinks.length > 0
        ? pendingEntityLinks.map(e => ({ entityType: e.entityType, entityId: e.entityId }))
        : undefined,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery !== null && mentionResults.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMentionSelectedIdx(i => Math.min(i + 1, mentionResults.length - 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setMentionSelectedIdx(i => Math.max(i - 1, 0)); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insertTaskMention(); return; }
      if (e.key === "Escape") { setMentionQuery(null); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage(); }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedConversationId) return;
    setUploadingFile(true);
    const fileSize = file.size;
    try {
      const formData = new FormData();
      formData.append("file", file);
      const data = await new Promise<{ url: string; name: string; type: string; size?: number }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `/api/conversations/${selectedConversationId}/upload`);
        xhr.withCredentials = true;
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100)); };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try { resolve(JSON.parse(xhr.responseText)); } catch { reject(new Error("Invalid response")); }
          } else { reject(new Error("Upload failed")); }
        };
        xhr.onerror = () => reject(new Error("Network error"));
        xhr.send(formData);
      });
      sendMessageMutation.mutate({
        conversationId: selectedConversationId,
        content: data.name || "File attachment",
        attachmentUrl: data.url,
        attachmentName: data.name,
        attachmentType: data.type,
        attachmentSize: data.size ?? fileSize,
        entityLinks: pendingEntityLinks.length > 0
          ? pendingEntityLinks.map(e => ({ entityType: e.entityType, entityId: e.entityId }))
          : undefined,
      });
    } catch (err) {
      console.error("File upload failed:", err);
    } finally {
      setUploadingFile(false);
      setUploadProgress(0);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      audioChunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.start(250);
      mediaRecorderRef.current = mr;
      setIsRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = window.setInterval(() => {
        setRecordingSeconds(s => {
          if (s + 1 >= MAX_VOICE_SECONDS) { stopRecording(); return MAX_VOICE_SECONDS; }
          return s + 1;
        });
      }, 1000);
    } catch (err) {
      console.error("Microphone access denied:", err);
    }
  };

  const stopRecording = async () => {
    if (!mediaRecorderRef.current || !selectedConversationId) return;
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    if (mediaRecorderRef.current.state === "inactive") return;
    const durationSnap = recordingSeconds;
    return new Promise<void>((resolve) => {
      mediaRecorderRef.current!.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        mediaRecorderRef.current!.stream.getTracks().forEach(t => t.stop());
        setUploadingVoice(true);
        try {
          const formData = new FormData();
          formData.append("audio", blob, "voice.webm");
          formData.append("duration", String(Math.min(durationSnap, MAX_VOICE_SECONDS)));
          const res = await fetch(`/api/conversations/${selectedConversationId}/voice`, { method: "POST", body: formData, credentials: "include" });
          if (!res.ok) throw new Error("Voice upload failed");
          const savedMsg = await res.json();
          queryClient.setQueryData<Message[]>(
            ["/api/conversations", selectedConversationId, "messages"],
            (prev = []) => [...prev, savedMsg]
          );
        } catch (err) {
          console.error("Voice upload failed:", err);
        } finally {
          setUploadingVoice(false);
        }
        resolve();
      };
      mediaRecorderRef.current!.stop();
      setIsRecording(false);
    });
  };

  const handleStartCall = async () => {
    const conv = conversations.find(c => c.id === selectedConversationId);
    if (!selectedConversationId || !conv || globalActiveCall || startingCall) return;
    setStartingCall(true);
    try {
      const res = await apiRequest("POST", `/api/conversations/${selectedConversationId}/calls`);
      const callData = await res.json();
      startGlobalCall(callData, conv);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const statusMatch = errMsg.match(/^(\d+):/);
      const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;
      const message = status === 409
        ? "A call is already active in this conversation"
        : "Failed to start video call. Please try again.";
      toast({ title: "Call Error", description: message, variant: "destructive" });
    } finally {
      setStartingCall(false);
    }
  };

  const handleJoinOngoingCall = async (callData: VideoCallData) => {
    if (callData.conversationId !== selectedConversationId) {
      setSelectedConversationId(callData.conversationId);
    }
    try {
      const res = await apiRequest("POST", `/api/calls/${callData.id}/join`);
      const fullCallData = await res.json();
      const conv = conversations.find(c => c.id === callData.conversationId);
      if (conv) startGlobalCall(fullCallData, conv);
    } catch (err) {
      console.error("Failed to join call:", err);
    }
  };

  const selectedConversation = conversations.find(c => c.id === selectedConversationId);
  const companyConversation = conversations.find(c => c.isCompanyChannel);

  const getConversationName = (c: Conversation): string => {
    if (c.isCompanyChannel) return "Company Chat";
    if (c.name) return c.name;
    if (c.type === "DIRECT") {
      const other = c.participants.find(p => p.userId !== user?.id);
      if (other) return `${other.user.firstName} ${other.user.lastName}`;
    }
    return "Conversation";
  };

  const renderConvIcon = (c: Conversation | Channel) => {
    if ((c as Conversation).isCompanyChannel) return <Building2 className="w-4 h-4" />;
    if (c.projectId) return <FolderOpen className="w-4 h-4" />;
    if (c.crewId) return <HardHat className="w-4 h-4" />;
    if (c.channelSlug) return <Hash className="w-4 h-4" />;
    return <MessageSquare className="w-4 h-4" />;
  };

  const getConvSubtitle = (c: Conversation) => {
    if (c.isCompanyChannel) return "Company-wide channel";
    if (c.channelSlug) return c.topic || `#${c.channelSlug}`;
    if (c.projectId) return "Project channel";
    if (c.crewId) return "Crew channel";
    if (c.type === "DIRECT") {
      const other = c.participants.find(p => p.userId !== user?.id);
      return other ? other.user.role : "Direct message";
    }
    return "";
  };

  const showConversationList = !isMobileView || !selectedConversationId;
  const showMessages = !isMobileView || !!selectedConversationId;

  return (
    <TooltipProvider>
      <div data-testid="team-messages-content" className={compact ? "h-full flex flex-col" : ""}>
        {}
        <Card className={compact ? "flex-1 min-h-0 border-0 shadow-none overflow-hidden" : "h-[calc(100vh-280px)] min-h-[500px] overflow-hidden"}>
          <div className="flex h-full">
            {/* ── SIDEBAR ── */}
            {showConversationList && !isMobileView && (
              <Sidebar
                currentUserId={user?.id}
                conversations={conversations}
                allChannels={allChannels}
                companyConversation={companyConversation}
                selectedConversationId={showCallNotes ? null : selectedConversationId}
                onSelectConversation={(id) => { setShowCallNotes(false); setSelectedConversationId(id); }}
                availableUsers={availableUsers}
                activeCallConversationIds={activeCallConversationIds}
                onJoinCall={(conversationId) => {
                  const callData = conversationActiveCalls[conversationId];
                  if (callData) handleJoinOngoingCall(callData);
                }}
                compact={compact}
                showCallNotes={showCallNotes}
                onToggleCallNotes={() => { setShowCallNotes(!showCallNotes); if (!showCallNotes) setSelectedConversationId(null); }}
              />
            )}

            {/* Mobile sidebar (full-width when no conversation selected) */}
            {showConversationList && isMobileView && !selectedConversationId && !showCallNotes && (
              <Sidebar
                currentUserId={user?.id}
                conversations={conversations}
                allChannels={allChannels}
                companyConversation={companyConversation}
                selectedConversationId={selectedConversationId}
                onSelectConversation={(id) => { setShowCallNotes(false); setSelectedConversationId(id); }}
                availableUsers={availableUsers}
                activeCallConversationIds={activeCallConversationIds}
                onJoinCall={(conversationId) => {
                  const callData = conversationActiveCalls[conversationId];
                  if (callData) handleJoinOngoingCall(callData);
                }}
                compact={compact}
                showCallNotes={showCallNotes}
                onToggleCallNotes={() => setShowCallNotes(true)}
              />
            )}

            {/* ── CALL NOTES VIEW ── */}
            {showCallNotes && (
              <AllCallNotes
                onBack={() => setShowCallNotes(false)}
                onNavigateToConversation={(convId) => {
                  setShowCallNotes(false);
                  setSelectedConversationId(convId);
                }}
              />
            )}

            {/* ── MESSAGES PANEL ── */}
            {showMessages && selectedConversation && !showCallNotes && (
              <div className={cn("flex flex-col flex-1 min-w-0 min-h-0", isMobileView ? "w-full" : "")}>
                {/* Header */}
                <div className="flex items-center gap-3 px-4 py-3 border-b shrink-0">
                  {isMobileView && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setSelectedConversationId(null)}
                      data-testid="button-back-to-list"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </Button>
                  )}
                  <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    {renderConvIcon(selectedConversation)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <h2 className="font-semibold text-sm leading-tight truncate" data-testid="text-conversation-name">
                        {getConversationName(selectedConversation)}
                      </h2>
                      {selectedConversation.rfiId && (
                        <button
                          onClick={async () => {
                            try {
                              const res = await fetch(`/api/entity-project/RFI/${selectedConversation.rfiId}`, { credentials: "include" });
                              if (res.ok) {
                                const { projectCode } = await res.json();
                                if (projectCode) navigate(`/projects/${projectCode}?tab=rfis&rfiId=${selectedConversation.rfiId}`);
                              }
                            } catch (err) { console.error("Entity project lookup failed:", err); }
                          }}
                          className="inline-flex items-center gap-0.5 text-[10px] font-medium rounded-full px-1.5 py-0.5 bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 border border-blue-200 dark:border-blue-800 cursor-pointer hover:opacity-80 transition-opacity"
                          data-testid="badge-entity-rfi"
                        >
                          <FileQuestion className="w-3 h-3" /> RFI
                        </button>
                      )}
                      {selectedConversation.changeOrderId && (
                        <button
                          onClick={async () => {
                            try {
                              const res = await fetch(`/api/entity-project/CHANGE_ORDER/${selectedConversation.changeOrderId}`, { credentials: "include" });
                              if (res.ok) {
                                const { projectCode } = await res.json();
                                if (projectCode) navigate(`/projects/${projectCode}?tab=change-orders&coId=${selectedConversation.changeOrderId}`);
                              }
                            } catch (err) { console.error("Entity project lookup failed:", err); }
                          }}
                          className="inline-flex items-center gap-0.5 text-[10px] font-medium rounded-full px-1.5 py-0.5 bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800 cursor-pointer hover:opacity-80 transition-opacity"
                          data-testid="badge-entity-co"
                        >
                          <ArrowRightLeft className="w-3 h-3" /> CO
                        </button>
                      )}
                      {selectedConversation.taskId && (
                        <button
                          onClick={() => { navigate(`/tasks?taskId=${selectedConversation.taskId}`); }}
                          className="inline-flex items-center gap-0.5 text-[10px] font-medium rounded-full px-1.5 py-0.5 bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 border border-green-200 dark:border-green-800 cursor-pointer hover:opacity-80 transition-opacity"
                          data-testid="badge-entity-task"
                        >
                          <CheckSquare className="w-3 h-3" /> Task
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {getConvSubtitle(selectedConversation)}
                    </p>
                  </div>
                  {selectedConversation.participants && selectedConversation.participants.length > 0 && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          aria-label="View conversation members"
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded-full px-2 py-1 transition-colors shrink-0"
                          data-testid="button-member-count"
                        >
                          <Users className="w-3.5 h-3.5" />
                          <span>{selectedConversation.participants.length} {selectedConversation.participants.length === 1 ? "member" : "members"}</span>
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-64 p-0" style={{ zIndex: 10001 }} data-testid="popover-member-list">
                        <div className="px-3 py-2 border-b">
                          <h4 className="text-sm font-medium">Members ({selectedConversation.participants.length})</h4>
                        </div>
                        <ScrollArea className={cn("max-h-[280px]", selectedConversation.participants.length > 5 && "h-[280px]")}>
                          <div className="p-1">
                            {selectedConversation.participants.map((p) => (
                              <div
                                key={p.id}
                                className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm"
                                data-testid={`member-item-${p.userId}`}
                              >
                                <Avatar className="h-6 w-6 shrink-0">
                                  <AvatarFallback className="text-[10px]">
                                    {getInitials(p.user.firstName, p.user.lastName)}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-medium truncate leading-tight">{p.user.firstName} {p.user.lastName}</p>
                                  <p className="text-[11px] text-muted-foreground truncate leading-tight">{p.user.role}</p>
                                </div>
                                {p.isAdmin && (
                                  <span className="text-[10px] text-primary font-medium shrink-0">Admin</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                      </PopoverContent>
                    </Popover>
                  )}
                  {selectedConversation.topic && (
                    <div className="ml-auto hidden sm:flex items-center gap-1 text-xs text-muted-foreground max-w-[40%] truncate">
                      <span className="font-medium">Topic:</span>
                      <span className="truncate">{selectedConversation.topic}</span>
                    </div>
                  )}
                  <div className={cn("flex items-center gap-1", !selectedConversation.topic && "ml-auto")}>
                    <CallHistory conversationId={selectedConversationId!} />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={handleStartCall}
                          disabled={!!globalActiveCall || startingCall}
                          data-testid="button-start-call"
                        >
                          {startingCall ? <Loader2 className="w-4 h-4 animate-spin" /> : <Video className="w-4 h-4" />}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent style={{ zIndex: 10001 }}>Start video call</TooltipContent>
                    </Tooltip>
                  </div>
                </div>

                {selectedConversationId && !globalActiveCall && selectedConversation?.type !== "DIRECT" &&
                  conversationActiveCalls[selectedConversationId] &&
                  !conversationActiveCalls[selectedConversationId].participants.some(p => p.userId === user?.id) &&
                  conversationActiveCalls[selectedConversationId].status === "ACTIVE" && (
                  <OngoingCallBanner
                    call={conversationActiveCalls[selectedConversationId]}
                    onJoin={() => handleJoinOngoingCall(conversationActiveCalls[selectedConversationId])}
                  />
                )}

                <MessageList
                  conversation={selectedConversation}
                  messages={messages}
                  olderMessages={olderMessages}
                  hasMore={hasMore}
                  isLoadingMore={isLoadingMore}
                  messagesLoading={messagesLoading}
                  currentUserId={user?.id ?? ""}
                  selectedConversationId={selectedConversationId!}
                  editingMessageId={editingMessageId}
                  editContent={editContent}
                  popoverMsgId={popoverMsgId}
                  editPending={editMessageMutation.isPending}
                  onEditStart={(id, content) => { setEditingMessageId(id); setEditContent(content); setPopoverMsgId(null); }}
                  onEditCancel={() => { setEditingMessageId(null); setEditContent(""); }}
                  onEditSave={(id, content) => editMessageMutation.mutate({ messageId: id, content })}
                  onEditContentChange={setEditContent}
                  onDelete={(id) => deleteMessageMutation.mutate(id)}
                  onPickerToggle={(id) => setPopoverMsgId(prev => prev === id ? null : id)}
                  onReact={(messageId, emoji) => reactMutation.mutate({ messageId, emoji })}
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
                  typingNames={typingNames}
                  sendPending={sendMessageMutation.isPending}
                  onInputChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  onSend={handleSendMessage}
                  onFileSelect={handleFileSelect}
                  onStartRecording={startRecording}
                  onStopRecording={stopRecording}
                  onMentionSelect={insertTaskMention}
                  onRemovePendingTask={(id) => setPendingTaskIds(prev => prev.filter(tid => tid !== id))}
                  onAddEntityLink={(entity) => setPendingEntityLinks(prev => {
                    if (prev.some(e => e.entityType === entity.entityType && e.entityId === entity.entityId)) return prev;
                    return [...prev, entity];
                  })}
                  onRemoveEntityLink={(entityType, entityId) => setPendingEntityLinks(prev => prev.filter(e => !(e.entityType === entityType && e.entityId === entityId)))}
                  textareaRef={textareaRef}
                  messagesEndRef={messagesEndRef}
                  scrollContainerRef={scrollContainerRef}
                  sentinelRef={sentinelRef}
                />
              </div>
            )}

            {/* ── Empty state when nothing selected on desktop ── */}
            {!selectedConversation && !isMobileView && !showCallNotes && (
              <div className="flex flex-col items-center justify-center flex-1 text-center p-8">
                <MessageSquare className="w-12 h-12 text-muted-foreground/50 mb-4" />
                <h2 className="text-lg font-semibold mb-2">Select a Channel or Conversation</h2>
                <p className="text-sm text-muted-foreground max-w-md">
                  Choose a channel from the sidebar to view messages, or create a new channel to start collaborating.
                </p>
              </div>
            )}
          </div>
        </Card>

      </div>
    </TooltipProvider>
  );
}
