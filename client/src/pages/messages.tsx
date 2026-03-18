import { useState, useEffect, useRef, useCallback } from "react";
import { Fragment } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useMessagingEvents } from "@/hooks/use-messaging-events";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  MessageSquare,
  Plus,
  Users,
  Building2,
  Search,
  ChevronLeft,
  Hash,
  FolderOpen,
  HardHat,
  Loader2,
} from "lucide-react";

import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

import { SidebarSection } from "@/components/messaging/SidebarSection";
import { MessageBubble } from "@/components/messaging/MessageBubble";
import { MessageComposer } from "@/components/messaging/MessageComposer";
import {
  getInitials,
  type User,
  type Channel,
  type Conversation,
  type ChannelRow,
  type Message,
  type MessageReaction,
  type TaskMention,
} from "@/components/messaging/types";

export function TeamMessagesContent() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [messageInput, setMessageInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isMobileView, setIsMobileView] = useState(false);

  // Channel creation dialog
  const [newChannelOpen, setNewChannelOpen] = useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelDescription, setNewChannelDescription] = useState("");
  const [newChannelTopic, setNewChannelTopic] = useState("");
  const [newChannelSlug, setNewChannelSlug] = useState("");

  // DM dialog
  const [newDmOpen, setNewDmOpen] = useState(false);

  // File upload
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Voice recording
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);
  const [uploadingVoice, setUploadingVoice] = useState(false);

  // Task mention
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionAnchor, setMentionAnchor] = useState<number>(0);
  const [pendingTaskIds, setPendingTaskIds] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Edit & delete state
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  // Emoji picker popover
  const [popoverMsgId, setPopoverMsgId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // ── Stable updater passed to the SSE hook so it can update olderMessages ──
  const updateOlderMessage = useCallback(
    (messageId: string, updater: (m: Message) => Message) => {
      setOlderMessages(prev => prev.map(m => m.id === messageId ? updater(m) : m));
    },
    []
  );

  // ── SSE real-time — handled by dedicated hook ──
  const { sseLive, typingNames } = useMessagingEvents(selectedConversationId, updateOlderMessage);
  const lastTypingSignalRef = useRef<number>(0);

  // ── Pagination state ──
  const [olderMessages, setOlderMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const hasLoadedAllRef = useRef(false);
  const scrollTopRef = useRef<number>(Infinity);

  useEffect(() => {
    const checkMobile = () => setIsMobileView(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // ── Data queries ──
  const { data: conversations = [], isLoading: conversationsLoading } = useQuery<Conversation[]>({
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

  // Reset pagination whenever the active conversation changes
  useEffect(() => {
    setOlderMessages([]);
    setHasMore(false);
    setIsLoadingMore(false);
    hasLoadedAllRef.current = false;
    scrollTopRef.current = Infinity;
  }, [selectedConversationId]);

  // Sync scrollTopRef from native scroll events
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const onScroll = () => { scrollTopRef.current = container.scrollTop; };
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
      if (!hasLoadedAllRef.current) {
        setHasMore(data.hasMore);
      }
      return data.messages;
    },
  });

  // Combined view: older (paginated) prepended before the latest page
  const messages = [...olderMessages, ...latestMessages];

  // Task mention search — scoped to conversation
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

  const [mentionSelectedIdx, setMentionSelectedIdx] = useState(0);
  useEffect(() => setMentionSelectedIdx(0), [mentionResults]);

  // ── Mutations ──
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
    },
  });

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

  const createConversationMutation = useMutation({
    mutationFn: async ({ type, participantIds, name }: { type: string; participantIds: string[]; name?: string }) => {
      const response = await apiRequest("POST", "/api/conversations", { type, participantIds, name });
      return response.json();
    },
    onSuccess: (newConversation) => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      setSelectedConversationId(newConversation.id);
      setNewDmOpen(false);
    },
  });

  const createChannelMutation = useMutation({
    mutationFn: async (data: { name: string; description?: string; topic?: string }) => {
      const response = await apiRequest("POST", "/api/channels", data);
      return response.json();
    },
    onSuccess: (channel) => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/channels"] });
      setSelectedConversationId(channel.id);
      setNewChannelOpen(false);
      setNewChannelName("");
      setNewChannelDescription("");
      setNewChannelTopic("");
    },
  });

  const joinChannelMutation = useMutation({
    mutationFn: async (channelId: string) => {
      const response = await apiRequest("POST", `/api/channels/${channelId}/join`);
      return response.json();
    },
    onSuccess: (_data, channelId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      setSelectedConversationId(channelId);
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

  // ── Load earlier messages (cursor-based) ──
  const loadMoreMessages = async () => {
    if (!selectedConversationId || isLoadingMore || !hasMore) return;
    if (scrollTopRef.current > 50) return;

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

  // ── Intersection observer: trigger load-more when sentinel enters view ──
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

  // Scroll to bottom only when latest messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [latestMessages]);

  // Auto-select company channel on load
  useEffect(() => {
    if (!selectedConversationId && companyChannel) {
      setSelectedConversationId(companyChannel.id);
    }
  }, [companyChannel, selectedConversationId]);

  // Mark as read
  useEffect(() => {
    if (selectedConversationId) {
      const conversation = conversations.find(c => c.id === selectedConversationId);
      if (conversation && conversation.unreadCount > 0) {
        markAsReadMutation.mutate(selectedConversationId);
      }
    }
  }, [selectedConversationId, conversations]);

  // ── Helpers ──
  const getConversationName = (c: Conversation): string => {
    if (c.isCompanyChannel) return "Company Chat";
    if (c.name) return c.name;
    if (c.type === "DIRECT") {
      const other = c.participants.find(p => p.userId !== user?.id);
      if (other) return `${other.user.firstName} ${other.user.lastName}`;
    }
    return "Conversation";
  };

  // ── Message input with @ mention ──
  const MAX_VOICE_SECONDS = 120;

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setMessageInput(val);

    if (selectedConversationId) {
      const now = Date.now();
      if (now - lastTypingSignalRef.current > 2_000) {
        lastTypingSignalRef.current = now;
        fetch(`/api/conversations/${selectedConversationId}/typing`, {
          method: "POST",
          credentials: "include",
        }).catch(() => {});
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
    const mention = `@[${task.title}](${task.id})`;
    setMessageInput(before + mention + after);
    setPendingTaskIds(prev => [...prev, task.id]);
    setMentionQuery(null);
    textareaRef.current?.focus();
  };

  // ── Send message ──
  const handleSendMessage = (e?: React.FormEvent) => {
    e?.preventDefault();
    if ((!messageInput.trim()) || !selectedConversationId || sendMessageMutation.isPending) return;
    sendMessageMutation.mutate({
      conversationId: selectedConversationId,
      content: messageInput,
      mentionedTaskIds: pendingTaskIds.length > 0 ? pendingTaskIds : undefined,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery !== null && mentionResults.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionSelectedIdx(i => Math.min(i + 1, mentionResults.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionSelectedIdx(i => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertTaskMention();
        return;
      }
      if (e.key === "Escape") {
        setMentionQuery(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // ── File upload ──
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
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try { resolve(JSON.parse(xhr.responseText)); } catch { reject(new Error("Invalid response")); }
          } else {
            reject(new Error("Upload failed"));
          }
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
      });
    } catch (err) {
      console.error("File upload failed:", err);
    } finally {
      setUploadingFile(false);
      setUploadProgress(0);
    }
  };

  // ── Voice recording ──
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
          if (s + 1 >= MAX_VOICE_SECONDS) {
            stopRecording();
            return MAX_VOICE_SECONDS;
          }
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
          const res = await fetch(`/api/conversations/${selectedConversationId}/voice`, {
            method: "POST",
            body: formData,
            credentials: "include",
          });
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

  // ── Sidebar categorization ──
  const selectedConversation = conversations.find(c => c.id === selectedConversationId);

  const companyConversation = conversations.find(c => c.isCompanyChannel);
  const namedChannels = conversations
    .filter(c => c.channelSlug && !c.projectId && !c.crewId && !c.isCompanyChannel)
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  const joinedProjectIds = new Set(conversations.filter(c => !!c.projectId).map(c => c.id));
  const joinedCrewIds = new Set(conversations.filter(c => !!c.crewId).map(c => c.id));
  const projectChannelsJoined = conversations.filter(c => !!c.projectId);
  const crewChannelsJoined = conversations.filter(c => !!c.crewId);
  const projectChannelsUnjoinedRaw = allChannels.filter(ch => !!ch.projectId && !joinedProjectIds.has(ch.id));
  const crewChannelsUnjoinedRaw = allChannels.filter(ch => !!ch.crewId && !joinedCrewIds.has(ch.id));
  const projectChannels: ChannelRow[] = [
    ...projectChannelsJoined,
    ...projectChannelsUnjoinedRaw.map(ch => ({ ...ch, _unjoined: true as const })),
  ].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  const crewChannels: ChannelRow[] = [
    ...crewChannelsJoined,
    ...crewChannelsUnjoinedRaw.map(ch => ({ ...ch, _unjoined: true as const })),
  ].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  const directMessages = conversations.filter(c => c.type === "DIRECT");

  const joinableChannels = allChannels.filter(ch => !ch.projectId && !ch.crewId && !conversations.find(c => c.id === ch.id));

  const filterName = (name: string) => name.toLowerCase().includes(searchQuery.toLowerCase());

  const showConversationList = !isMobileView || !selectedConversationId;
  const showMessages = !isMobileView || !!selectedConversationId;

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

  const renderConvIcon = (c: Conversation | Channel) => {
    if ((c as Conversation).isCompanyChannel) return <Building2 className="w-4 h-4" />;
    if ((c as Conversation).projectId || (c as Channel).projectId) return <FolderOpen className="w-4 h-4" />;
    if ((c as Conversation).crewId || (c as Channel).crewId) return <HardHat className="w-4 h-4" />;
    if ((c as Conversation).channelSlug || (c as Channel).channelSlug) return <Hash className="w-4 h-4" />;
    return <MessageSquare className="w-4 h-4" />;
  };

  // Render mention-highlighted message content
  const renderContent = (content: string) => {
    const parts = content.split(/(@\[[^\]]*\]\([^)]+\))/g);
    return parts.map((part, i) => {
      const mentionMatch = part.match(/^@\[([^\]]*)\]\(([^)]+)\)$/);
      if (mentionMatch) {
        const [, title, taskId] = mentionMatch;
        return (
          <a
            key={i}
            href={`/projects?taskId=${taskId}`}
            className="text-primary font-medium hover:underline cursor-pointer"
            onClick={e => { e.preventDefault(); setLocation(`/projects?taskId=${taskId}`); }}
          >
            @{title}
          </a>
        );
      }
      return <Fragment key={i}>{part}</Fragment>;
    });
  };

  return (
    <TooltipProvider>
      <div data-testid="team-messages-content">
        <Card className="h-[calc(100vh-280px)] min-h-[500px]">
          <div className="flex h-full">
            {/* ── SIDEBAR ── */}
            {showConversationList && (
              <div className={cn("border-r flex flex-col bg-muted/20", isMobileView ? "w-full" : "w-72")}>
                {/* Search + actions */}
                <div className="p-2 border-b space-y-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Search..."
                      className="pl-8 h-8 text-sm"
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      data-testid="input-search-conversations"
                    />
                  </div>
                </div>

                <ScrollArea className="flex-1">
                  <div className="p-2 space-y-1">
                    {/* Company channel */}
                    {companyConversation && (
                      <button
                        onClick={() => setSelectedConversationId(companyConversation.id)}
                        className={cn(
                          "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left hover:bg-accent transition-colors",
                          selectedConversationId === companyConversation.id && "bg-accent font-medium"
                        )}
                        data-testid="button-company-channel"
                      >
                        <Building2 className="w-4 h-4 text-primary shrink-0" />
                        <span className="flex-1 truncate">Company Chat</span>
                        {companyConversation.unreadCount > 0 && (
                          <Badge className="h-4 min-w-[16px] px-1 text-[10px]">{companyConversation.unreadCount}</Badge>
                        )}
                      </button>
                    )}

                    <Separator className="my-1" />

                    {/* Named Channels */}
                    <SidebarSection
                      label="Channels"
                      action={
                        <Dialog open={newChannelOpen} onOpenChange={setNewChannelOpen}>
                          <DialogTrigger asChild>
                            <button className="p-0.5 rounded hover:bg-accent" data-testid="button-new-channel">
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>Create a Channel</DialogTitle>
                              <DialogDescription>Channels are where your team communicates around topics.</DialogDescription>
                            </DialogHeader>
                            <div className="space-y-3 mt-2">
                              <div>
                                <Label>Channel name</Label>
                                <div className="flex items-center mt-1">
                                  <span className="text-muted-foreground px-2 border rounded-l-md h-9 flex items-center bg-muted text-sm">#</span>
                                  <Input
                                    placeholder="e.g. general, design, ops"
                                    value={newChannelName}
                                    onChange={e => setNewChannelName(e.target.value)}
                                    className="rounded-l-none"
                                    data-testid="input-channel-name"
                                  />
                                </div>
                              </div>
                              <div>
                                <Label>Slug <span className="text-muted-foreground font-normal">(optional — auto-derived from name)</span></Label>
                                <div className="flex items-center mt-1">
                                  <span className="text-muted-foreground px-2 border rounded-l-md h-9 flex items-center bg-muted text-sm">#</span>
                                  <Input
                                    placeholder={newChannelName ? newChannelName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") : "channel-slug"}
                                    value={newChannelSlug}
                                    onChange={e => setNewChannelSlug(e.target.value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""))}
                                    className="rounded-l-none"
                                    data-testid="input-channel-slug"
                                  />
                                </div>
                              </div>
                              <div>
                                <Label>Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
                                <Input
                                  placeholder="What's this channel about?"
                                  value={newChannelDescription}
                                  onChange={e => setNewChannelDescription(e.target.value)}
                                  className="mt-1"
                                  data-testid="input-channel-description"
                                />
                              </div>
                              <div>
                                <Label>Topic <span className="text-muted-foreground font-normal">(optional)</span></Label>
                                <Input
                                  placeholder="Channel topic or purpose"
                                  value={newChannelTopic}
                                  onChange={e => setNewChannelTopic(e.target.value)}
                                  className="mt-1"
                                  data-testid="input-channel-topic"
                                />
                              </div>
                              <Button
                                className="w-full"
                                onClick={() => createChannelMutation.mutate({ name: newChannelName, description: newChannelDescription, topic: newChannelTopic, slug: newChannelSlug || undefined } as { name: string; description?: string; topic?: string })}
                                disabled={!newChannelName.trim() || createChannelMutation.isPending}
                                data-testid="button-create-channel"
                              >
                                {createChannelMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                                Create Channel
                              </Button>
                            </div>
                          </DialogContent>
                        </Dialog>
                      }
                    >
                      {namedChannels.filter(c => filterName(getConversationName(c))).map(c => (
                        <button
                          key={c.id}
                          onClick={() => setSelectedConversationId(c.id)}
                          className={cn(
                            "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left hover:bg-accent transition-colors",
                            selectedConversationId === c.id && "bg-accent font-medium"
                          )}
                          data-testid={`button-channel-${c.id}`}
                        >
                          <Hash className="w-4 h-4 text-muted-foreground shrink-0" />
                          <span className="flex-1 truncate">{c.name}</span>
                          {c.unreadCount > 0 && (
                            <Badge className="h-4 min-w-[16px] px-1 text-[10px]">{c.unreadCount}</Badge>
                          )}
                        </button>
                      ))}
                      {/* Joinable channels */}
                      {joinableChannels.filter(ch => !ch.projectId && !ch.crewId).map(ch => (
                        <button
                          key={ch.id}
                          onClick={() => joinChannelMutation.mutate(ch.id)}
                          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left text-muted-foreground hover:bg-accent transition-colors"
                          data-testid={`button-join-channel-${ch.id}`}
                        >
                          <Hash className="w-4 h-4 shrink-0" />
                          <span className="flex-1 truncate">{ch.name}</span>
                          <span className="text-xs opacity-60">Join</span>
                        </button>
                      ))}
                    </SidebarSection>

                    {/* Project Channels — joined + discoverable unjoined */}
                    {projectChannels.length > 0 && (
                      <SidebarSection label="Project Channels">
                        {projectChannels.filter(c => filterName(getConversationName(c))).map(c => {
                          const unjoined = c._unjoined === true;
                          return (
                            <button
                              key={c.id}
                              onClick={() => unjoined ? joinChannelMutation.mutate(c.id) : setSelectedConversationId(c.id)}
                              className={cn(
                                "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left hover:bg-accent transition-colors",
                                !unjoined && selectedConversationId === c.id && "bg-accent font-medium",
                                unjoined && "opacity-60"
                              )}
                              data-testid={`button-project-channel-${c.id}`}
                            >
                              <Hash className="w-4 h-4 text-muted-foreground shrink-0" />
                              <span className="flex-1 truncate">
                                {c.channelSlug ?? c.name}
                              </span>
                              {unjoined && <span className="text-[10px] text-muted-foreground">Join</span>}
                              {!unjoined && c.unreadCount > 0 && (
                                <Badge className="h-4 min-w-[16px] px-1 text-[10px]">{c.unreadCount}</Badge>
                              )}
                            </button>
                          );
                        })}
                      </SidebarSection>
                    )}

                    {/* Crew Channels — joined + discoverable unjoined */}
                    {crewChannels.length > 0 && (
                      <SidebarSection label="Crew Channels">
                        {crewChannels.filter(c => filterName(getConversationName(c))).map(c => {
                          const unjoined = c._unjoined === true;
                          return (
                            <button
                              key={c.id}
                              onClick={() => unjoined ? joinChannelMutation.mutate(c.id) : setSelectedConversationId(c.id)}
                              className={cn(
                                "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left hover:bg-accent transition-colors",
                                !unjoined && selectedConversationId === c.id && "bg-accent font-medium",
                                unjoined && "opacity-60"
                              )}
                              data-testid={`button-crew-channel-${c.id}`}
                            >
                              <Hash className="w-4 h-4 text-muted-foreground shrink-0" />
                              <span className="flex-1 truncate">
                                {c.channelSlug ?? c.name}
                              </span>
                              {unjoined && <span className="text-[10px] text-muted-foreground">Join</span>}
                              {!unjoined && c.unreadCount > 0 && (
                                <Badge className="h-4 min-w-[16px] px-1 text-[10px]">{c.unreadCount}</Badge>
                              )}
                            </button>
                          );
                        })}
                      </SidebarSection>
                    )}

                    <Separator className="my-1" />

                    {/* Direct Messages */}
                    <SidebarSection
                      label="Direct Messages"
                      action={
                        <Dialog open={newDmOpen} onOpenChange={setNewDmOpen}>
                          <DialogTrigger asChild>
                            <button className="p-0.5 rounded hover:bg-accent" data-testid="button-new-dm">
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>Start a Direct Message</DialogTitle>
                              <DialogDescription>Select a team member to start a private conversation</DialogDescription>
                            </DialogHeader>
                            <ScrollArea className="h-[300px] mt-4">
                              {availableUsers.length === 0 ? (
                                <p className="text-sm text-muted-foreground text-center py-4">No team members available</p>
                              ) : (
                                <div className="space-y-1">
                                  {availableUsers.map(u => (
                                    <button
                                      key={u.id}
                                      onClick={() => createConversationMutation.mutate({ type: "DIRECT", participantIds: [u.id] })}
                                      className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-accent transition-colors text-left"
                                      data-testid={`button-dm-user-${u.id}`}
                                    >
                                      <Avatar className="h-8 w-8">
                                        <AvatarFallback className="text-xs">{getInitials(u.firstName, u.lastName)}</AvatarFallback>
                                      </Avatar>
                                      <div>
                                        <p className="text-sm font-medium">{u.firstName} {u.lastName}</p>
                                        <p className="text-xs text-muted-foreground">{u.role}</p>
                                      </div>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </ScrollArea>
                          </DialogContent>
                        </Dialog>
                      }
                    >
                      {directMessages.filter(c => filterName(getConversationName(c))).map(c => {
                        const other = c.participants.find(p => p.userId !== user?.id);
                        return (
                          <button
                            key={c.id}
                            onClick={() => setSelectedConversationId(c.id)}
                            className={cn(
                              "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left hover:bg-accent transition-colors",
                              selectedConversationId === c.id && "bg-accent font-medium"
                            )}
                            data-testid={`button-dm-${c.id}`}
                          >
                            <Avatar className="h-5 w-5 shrink-0">
                              <AvatarFallback className="text-[9px]">
                                {other ? getInitials(other.user.firstName, other.user.lastName) : "?"}
                              </AvatarFallback>
                            </Avatar>
                            <span className="flex-1 truncate">
                              {other ? `${other.user.firstName} ${other.user.lastName}` : "Unknown"}
                            </span>
                            {c.unreadCount > 0 && (
                              <Badge className="h-4 min-w-[16px] px-1 text-[10px]">{c.unreadCount}</Badge>
                            )}
                          </button>
                        );
                      })}
                    </SidebarSection>
                  </div>
                </ScrollArea>
              </div>
            )}

            {/* ── MESSAGES PANEL ── */}
            {showMessages && (
              <div className={cn("flex flex-col flex-1 min-w-0", isMobileView && selectedConversationId ? "w-full" : "")}>
                {selectedConversation ? (
                  <>
                    {/* Header */}
                    <div className="flex items-center gap-3 px-4 py-3 border-b shrink-0">
                      {isMobileView && (
                        <Button variant="ghost" size="icon" onClick={() => setSelectedConversationId(null)} data-testid="button-back-to-list">
                          <ChevronLeft className="w-5 h-5" />
                        </Button>
                      )}
                      <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                        {renderConvIcon(selectedConversation)}
                      </div>
                      <div className="min-w-0">
                        <h2 className="font-semibold text-sm leading-tight truncate" data-testid="text-conversation-name">
                          {getConversationName(selectedConversation)}
                        </h2>
                        <p className="text-xs text-muted-foreground truncate">
                          {getConvSubtitle(selectedConversation)}
                        </p>
                      </div>
                      {selectedConversation.topic && (
                        <div className="ml-auto hidden sm:flex items-center gap-1 text-xs text-muted-foreground max-w-[40%] truncate">
                          <span className="font-medium">Topic:</span>
                          <span className="truncate">{selectedConversation.topic}</span>
                        </div>
                      )}
                    </div>

                    {/* Messages Area */}
                    <div
                      ref={scrollContainerRef}
                      className="flex-1 overflow-y-auto px-4 py-3"
                    >
                      {messagesLoading ? (
                        <div className="flex items-center justify-center h-full">
                          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                        </div>
                      ) : messages.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-center">
                          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                            {renderConvIcon(selectedConversation)}
                          </div>
                          <p className="text-sm font-medium">{getConversationName(selectedConversation)}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {selectedConversation.description || "No messages yet. Say hello!"}
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {/* ── Load-earlier sentinel & spinner (top of list) ── */}
                          {hasMore && (
                            <div
                              ref={sentinelRef}
                              className="flex justify-center py-2"
                              data-testid="load-more-sentinel"
                            >
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                {isLoadingMore ? (
                                  <>
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    <span>Loading earlier messages…</span>
                                  </>
                                ) : (
                                  <span className="opacity-50">Scroll up for earlier messages</span>
                                )}
                              </div>
                            </div>
                          )}

                          {messages.map((message) => {
                            const isOwn = message.senderId === user?.id;
                            const currentParticipant = selectedConversation?.participants.find(p => p.userId === user?.id);
                            const isAdmin = currentParticipant?.isAdmin === true;

                            return (
                              <MessageBubble
                                key={message.id}
                                message={message}
                                isOwn={isOwn}
                                isAdmin={isAdmin}
                                currentUserId={user?.id ?? ""}
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
                                renderContent={renderContent}
                              />
                            );
                          })}
                          <div ref={messagesEndRef} />
                        </div>
                      )}
                    </div>

                    {/* Message Composer */}
                    <MessageComposer
                      messageInput={messageInput}
                      isRecording={isRecording}
                      recordingSeconds={recordingSeconds}
                      uploadingFile={uploadingFile}
                      uploadingVoice={uploadingVoice}
                      uploadProgress={uploadProgress}
                      pendingTaskIds={pendingTaskIds}
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
                      textareaRef={textareaRef}
                    />
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-center p-8">
                    <MessageSquare className="w-12 h-12 text-muted-foreground/50 mb-4" />
                    <h2 className="text-lg font-semibold mb-2">Select a Channel or Conversation</h2>
                    <p className="text-sm text-muted-foreground max-w-md">
                      Choose a channel from the sidebar to view messages, or create a new channel to start collaborating.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>
      </div>
    </TooltipProvider>
  );
}
