import { useState, useEffect, useRef } from "react";
import { Fragment } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useMessagingEvents } from "@/hooks/use-messaging-events";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  MessageSquare,
  Plus,
  Send,
  Users,
  Building2,
  Search,
  ChevronLeft,
  Hash,
  FolderOpen,
  HardHat,
  Paperclip,
  Mic,
  MicOff,
  FileText,
  Image as ImageIcon,
  Download,
  AtSign,
  X,
  ChevronDown,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

interface User {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
}

interface Channel {
  id: string;
  name: string | null;
  description: string | null;
  topic: string | null;
  channelSlug: string | null;
  projectId: string | null;
  crewId: string | null;
  type: string;
  isCompanyChannel: boolean;
}

interface Conversation {
  id: string;
  type: "DIRECT" | "GROUP" | "COMPANY";
  name: string | null;
  description: string | null;
  topic: string | null;
  channelSlug: string | null;
  projectId: string | null;
  crewId: string | null;
  isCompanyChannel: boolean;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  participants: {
    id: string;
    userId: string;
    isAdmin: boolean;
    user: User;
  }[];
  lastMessage: {
    id: string;
    content: string;
    createdAt: string;
    sender: User;
  } | null;
  unreadCount: number;
}

type ChannelRow = Conversation & { _unjoined?: boolean };

interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  attachmentUrl: string | null;
  attachmentName: string | null;
  attachmentType: string | null;
  attachmentSize: number | null;
  voiceUrl: string | null;
  voiceDurationSeconds: number | null;
  mentionedTaskIds: string[] | null;
  createdAt: string;
  sender: User;
}

interface TaskMention {
  id: string;
  title: string;
  projectName: string | null;
}

function getInitials(firstName: string, lastName: string) {
  return `${firstName?.charAt(0) || ""}${lastName?.charAt(0) || ""}`.toUpperCase();
}

// ── Voice Message Player ──
function VoicePlayer({ url, durationSeconds }: { url: string; durationSeconds: number | null }) {
  const label = durationSeconds
    ? `Voice message (${Math.floor(durationSeconds / 60)}:${String(durationSeconds % 60).padStart(2, "0")})`
    : "Voice message";
  return (
    <div className="mt-1">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <audio controls src={url} className="max-w-xs h-8" data-testid="audio-voice-message" />
    </div>
  );
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Attachment Renderer — lightbox for images, file size for documents ──
function AttachmentRenderer({
  url, name, type, size,
}: {
  url: string;
  name: string | null;
  type: string | null;
  size?: number | null;
}) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const isImage = type?.startsWith("image/");
  return (
    <div className="mt-1.5">
      {isImage ? (
        <>
          <button
            onClick={() => setLightboxOpen(true)}
            className="focus:outline-none rounded-lg overflow-hidden"
            data-testid="button-attachment-image-expand"
          >
            <img
              src={url}
              alt={name || "attachment"}
              className="max-w-[200px] max-h-[160px] rounded-lg object-cover border hover:opacity-90 transition-opacity cursor-zoom-in"
            />
          </button>
          <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
            <DialogContent className="max-w-3xl p-2 bg-black/90">
              <DialogHeader className="sr-only">
                <DialogTitle>{name || "Image preview"}</DialogTitle>
              </DialogHeader>
              <img
                src={url}
                alt={name || "attachment"}
                className="max-h-[80vh] w-full object-contain rounded"
              />
              <div className="flex justify-between items-center mt-2 px-2">
                <span className="text-sm text-white/70 truncate">{name}</span>
                <a
                  href={url}
                  download={name || "image"}
                  className="text-sm text-white/70 hover:text-white flex items-center gap-1"
                  data-testid="button-attachment-download"
                >
                  <Download className="w-4 h-4" /> Download
                </a>
              </div>
            </DialogContent>
          </Dialog>
        </>
      ) : (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 bg-background/50 border rounded-lg px-3 py-2 text-sm hover:bg-muted transition-colors"
          data-testid="button-attachment-download"
        >
          <FileText className="w-4 h-4 text-primary shrink-0" />
          <span className="truncate max-w-[140px]">{name || "File"}</span>
          {size != null && <span className="text-xs text-muted-foreground whitespace-nowrap">{fmtBytes(size)}</span>}
          <Download className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        </a>
      )}
    </div>
  );
}

// ── Sidebar section collapse ──
function SidebarSection({
  label,
  children,
  defaultOpen = true,
  action,
}: {
  label: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  action?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-1">
      <div className="flex items-center px-2 py-1">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors flex-1 text-left"
        >
          {open ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
          <span>{label}</span>
        </button>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {open && <div>{children}</div>}
    </div>
  );
}

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
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // ── SSE real-time — handled by dedicated hook ──
  const { sseLive, typingNames } = useMessagingEvents(selectedConversationId);
  const lastTypingSignalRef = useRef<number>(0);

  // ── Pagination state ──
  const [olderMessages, setOlderMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  // Once we've loaded all history, don't let refetches re-enable the sentinel
  const hasLoadedAllRef = useRef(false);

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
  }, [selectedConversationId]);

  const { data: latestMessages = [], isLoading: messagesLoading } = useQuery<Message[]>({
    queryKey: ["/api/conversations", selectedConversationId, "messages"],
    enabled: !!selectedConversationId,
    // When SSE is live, disable polling; fall back to 10s when SSE drops
    refetchInterval: sseLive ? false : 10_000,
    queryFn: async () => {
      if (!selectedConversationId) return [];
      const res = await fetch(`/api/conversations/${selectedConversationId}/messages`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch messages");
      const data = await res.json() as { messages: Message[]; hasMore: boolean };
      // Only update hasMore if the user hasn't already loaded all history
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

  // Selected index in mention dropdown
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

  // ── Load earlier messages (cursor-based) ──
  const loadMoreMessages = async () => {
    if (!selectedConversationId || isLoadingMore || !hasMore) return;

    // Cursor = the oldest message we currently have
    const oldest = olderMessages.length > 0 ? olderMessages[0] : latestMessages[0];
    if (!oldest) return;

    // Preserve scroll position: capture scrollHeight before prepend
    const container = scrollContainerRef.current;
    const prevScrollHeight = container?.scrollHeight ?? 0;

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

      // Restore scroll position so the user's reading position doesn't jump
      if (container) {
        requestAnimationFrame(() => {
          container.scrollTop = container.scrollHeight - prevScrollHeight;
        });
      }
    } catch (err) {
      console.error("Load more messages error:", err);
    } finally {
      setIsLoadingMore(false);
    }
  };

  // Stable ref so the intersection observer callback always calls the latest version
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

  // Scroll to bottom only when latest messages change (new messages or conversation switch)
  // NOT when older messages are prepended (handled by scroll preservation above)
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
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setMessageInput(val);

    // Fire typing signal (rate-limited to once per 2 s via server + local ref)
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

    // Detect @ trigger
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

      // Use XHR for upload progress
      const data = await new Promise<{ url: string; name: string; type: string }>((resolve, reject) => {
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
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const MAX_VOICE_SECONDS = 120;

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
            // Auto-stop at max duration
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
          // Server already saved the message — append it directly to cache
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
  // Joined project/crew channels from conversations list
  const projectChannelsJoined = conversations.filter(c => !!c.projectId);
  const crewChannelsJoined = conversations.filter(c => !!c.crewId);
  // Non-joined project/crew channels discoverable from allChannels
  const projectChannelsUnjoinedRaw = allChannels.filter(ch => !!ch.projectId && !joinedProjectIds.has(ch.id));
  const crewChannelsUnjoinedRaw = allChannels.filter(ch => !!ch.crewId && !joinedCrewIds.has(ch.id));
  // Combined for display
  const projectChannels: ChannelRow[] = [
    ...projectChannelsJoined,
    ...projectChannelsUnjoinedRaw.map(ch => ({ ...ch, _unjoined: true as const })),
  ].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  const crewChannels: ChannelRow[] = [
    ...crewChannelsJoined,
    ...crewChannelsUnjoinedRaw.map(ch => ({ ...ch, _unjoined: true as const })),
  ].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  const directMessages = conversations.filter(c => c.type === "DIRECT");

  // Named channels the user hasn't joined yet
  const joinableChannels = allChannels.filter(ch => !ch.projectId && !ch.crewId && !conversations.find(c => c.id === ch.id));

  const filterName = (name: string) => name.toLowerCase().includes(searchQuery.toLowerCase());

  const showConversationList = !isMobileView || !selectedConversationId;
  const showMessages = !isMobileView || !!selectedConversationId;

  const fmtSeconds = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  // Render content for selected conversation header
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

  // Render mention-highlighted message content; @[Title](taskId) is clickable
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
                                onClick={() => createChannelMutation.mutate({ name: newChannelName, description: newChannelDescription, topic: newChannelTopic, slug: newChannelSlug || undefined })}
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

                    {/* Messages Area — plain div so we can control scrollTop directly */}
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
                            return (
                              <div
                                key={message.id}
                                className={cn("flex gap-2.5", isOwn && "flex-row-reverse")}
                                data-testid={`message-${message.id}`}
                              >
                                <Avatar className="h-7 w-7 shrink-0 mt-0.5">
                                  <AvatarFallback className="text-[10px]">
                                    {getInitials(message.sender.firstName, message.sender.lastName)}
                                  </AvatarFallback>
                                </Avatar>
                                <div className={cn("max-w-[72%]", isOwn && "text-right")}>
                                  <div className={cn("flex items-center gap-1.5 mb-0.5", isOwn && "flex-row-reverse")}>
                                    <span className="text-xs font-semibold">
                                      {isOwn ? "You" : `${message.sender.firstName} ${message.sender.lastName}`}
                                    </span>
                                    <span className="text-[10px] text-muted-foreground">
                                      {formatDistanceToNow(new Date(message.createdAt), { addSuffix: true })}
                                    </span>
                                  </div>
                                  {/* Voice message */}
                                  {message.voiceUrl ? (
                                    <div className={cn(isOwn && "flex justify-end")}>
                                      <VoicePlayer url={message.voiceUrl} durationSeconds={message.voiceDurationSeconds} />
                                    </div>
                                  ) : (
                                    <div className={cn(
                                      "rounded-2xl px-3 py-2 text-sm inline-block text-left",
                                      isOwn ? "bg-primary text-primary-foreground" : "bg-muted"
                                    )}>
                                      {renderContent(message.content)}
                                      {message.attachmentUrl && (
                                        <AttachmentRenderer
                                          url={message.attachmentUrl}
                                          name={message.attachmentName}
                                          type={message.attachmentType}
                                          size={message.attachmentSize}
                                        />
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                          <div ref={messagesEndRef} />
                        </div>
                      )}
                    </div>

                    {/* Message Input */}
                    <div className="p-3 border-t shrink-0">
                      {/* File upload progress bar */}
                      {uploadingFile && uploadProgress > 0 && uploadProgress < 100 && (
                        <div className="mb-2">
                          <div className="flex justify-between text-xs text-muted-foreground mb-1">
                            <span>Uploading file...</span>
                            <span>{uploadProgress}%</span>
                          </div>
                          <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary rounded-full transition-all duration-150"
                              style={{ width: `${uploadProgress}%` }}
                            />
                          </div>
                        </div>
                      )}
                      {/* Task mention dropdown — keyboard-navigable */}
                      {mentionQuery !== null && mentionResults.length > 0 && (
                        <div className="mb-2 bg-popover border rounded-lg shadow-lg overflow-hidden" role="listbox" aria-label="Task mentions">
                          {mentionResults.map((t, idx) => (
                            <button
                              key={t.id}
                              onClick={() => insertTaskMention(t)}
                              className={cn(
                                "w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors",
                                idx === mentionSelectedIdx ? "bg-accent" : "hover:bg-accent/50"
                              )}
                              data-testid={`button-mention-task-${t.id}`}
                              role="option"
                              aria-selected={idx === mentionSelectedIdx}
                            >
                              <AtSign className="w-3.5 h-3.5 text-primary shrink-0" />
                              <span className="flex-1 truncate">{t.title}</span>
                              {t.projectName && <span className="text-xs text-muted-foreground truncate max-w-[80px]">{t.projectName}</span>}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Pending task mentions */}
                      {pendingTaskIds.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-2">
                          {pendingTaskIds.map(tid => (
                            <Badge key={tid} variant="secondary" className="gap-1 text-xs">
                              <AtSign className="w-2.5 h-2.5" />
                              Task
                              <button onClick={() => setPendingTaskIds(prev => prev.filter(id => id !== tid))}>
                                <X className="w-2.5 h-2.5" />
                              </button>
                            </Badge>
                          ))}
                        </div>
                      )}

                      {/* Typing indicator */}
                      {Object.keys(typingNames).length > 0 && (
                        <div className="flex items-center gap-1.5 mb-1.5 px-1 text-xs text-muted-foreground" data-testid="typing-indicator">
                          <span className="inline-flex items-end gap-0.5">
                            <span className="w-1 h-1 bg-muted-foreground rounded-full animate-bounce [animation-delay:0ms]" />
                            <span className="w-1 h-1 bg-muted-foreground rounded-full animate-bounce [animation-delay:150ms]" />
                            <span className="w-1 h-1 bg-muted-foreground rounded-full animate-bounce [animation-delay:300ms]" />
                          </span>
                          <span>
                            {Object.values(typingNames).join(", ")}{" "}
                            {Object.values(typingNames).length === 1 ? "is" : "are"} typing…
                          </span>
                        </div>
                      )}

                      {/* Recording indicator */}
                      {isRecording && (
                        <div className="flex items-center gap-2 mb-2 px-3 py-1.5 bg-destructive/10 rounded-lg text-destructive text-sm">
                          <span className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
                          Recording {fmtSeconds(recordingSeconds)}
                          <Button size="sm" variant="ghost" className="ml-auto h-6 text-xs" onClick={stopRecording}>
                            Stop & Send
                          </Button>
                        </div>
                      )}

                      <div className="flex items-end gap-2">
                        {/* File attachment */}
                        <input
                          ref={fileInputRef}
                          type="file"
                          className="hidden"
                          onChange={handleFileSelect}
                          data-testid="input-file-upload"
                        />
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-9 w-9 shrink-0"
                              onClick={() => fileInputRef.current?.click()}
                              disabled={uploadingFile || isRecording}
                              data-testid="button-attach-file"
                            >
                              {uploadingFile ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Attach file</TooltipContent>
                        </Tooltip>

                        {/* Voice message */}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              size="icon"
                              variant={isRecording ? "destructive" : "ghost"}
                              className="h-9 w-9 shrink-0"
                              onClick={isRecording ? stopRecording : startRecording}
                              disabled={uploadingVoice || uploadingFile}
                              data-testid="button-voice-record"
                            >
                              {uploadingVoice ? <Loader2 className="w-4 h-4 animate-spin" /> : isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{isRecording ? "Stop recording" : "Record voice message"}</TooltipContent>
                        </Tooltip>

                        {/* Text input */}
                        <div className="flex-1 relative">
                          <Textarea
                            ref={textareaRef}
                            placeholder="Type a message… (@ to mention a task)"
                            value={messageInput}
                            onChange={handleInputChange}
                            onKeyDown={handleKeyDown}
                            className="resize-none min-h-[36px] max-h-32 py-2 pr-10 text-sm"
                            rows={1}
                            disabled={isRecording}
                            data-testid="input-message"
                          />
                        </div>

                        {/* Send */}
                        <Button
                          type="submit"
                          size="icon"
                          className="h-9 w-9 shrink-0"
                          onClick={() => handleSendMessage()}
                          disabled={(!messageInput.trim()) || sendMessageMutation.isPending || isRecording}
                          data-testid="button-send-message"
                        >
                          {sendMessageMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                        </Button>
                      </div>
                    </div>
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
