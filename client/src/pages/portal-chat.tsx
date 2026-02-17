import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MessageSquare,
  Send,
  Search,
  Filter,
  Loader2,
  Clock,
  Eye,
  EyeOff,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ArrowLeft,
} from "lucide-react";

function formatDate(d: string | null | undefined) {
  if (!d) return "N/A";
  try {
    return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return d;
  }
}

function PriorityBadge({ priority }: { priority: string }) {
  if (priority === "URGENT") return <Badge variant="destructive" className="text-xs" data-testid={`badge-priority-${priority}`}><AlertTriangle className="h-3 w-3 mr-0.5" />Urgent</Badge>;
  return null;
}

function StatusIcon({ status }: { status: string }) {
  if (status === "CLOSED") return <XCircle className="h-3.5 w-3.5 text-muted-foreground" />;
  if (status === "ARCHIVED") return <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />;
  return <Clock className="h-3.5 w-3.5 text-blue-600" />;
}

export default function PortalChatPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [selectedThread, setSelectedThread] = useState<any>(null);
  const [chatMessage, setChatMessage] = useState("");
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");

  const queryParams = new URLSearchParams();
  if (searchQuery) queryParams.set("search", searchQuery);
  if (statusFilter !== "all") queryParams.set("status", statusFilter);
  if (priorityFilter !== "all") queryParams.set("priority", priorityFilter);
  const qs = queryParams.toString();

  const threadsUrl = qs ? `/api/team/chat/threads?${qs}` : "/api/team/chat/threads";
  const { data: threads = [], isLoading: threadsLoading } = useQuery<any[]>({
    queryKey: ["/api/team/chat/threads", qs],
    queryFn: async () => {
      const res = await fetch(threadsUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load threads");
      return res.json();
    },
  });

  const { data: threadMessages = [], isLoading: messagesLoading } = useQuery({
    queryKey: ["/api/team/chat/threads", selectedThread?.id, "messages"],
    queryFn: async () => {
      const res = await fetch(`/api/team/chat/threads/${selectedThread.id}/messages`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load messages");
      return res.json();
    },
    enabled: !!selectedThread,
  });

  const { data: unreadCount } = useQuery<{ unreadCount: number }>({
    queryKey: ["/api/team/chat/unread"],
  });

  const sendMessageMutation = useMutation({
    mutationFn: async (data: { threadId: string; content: string; isInternal: boolean }) => {
      const res = await apiRequest("POST", `/api/team/chat/threads/${data.threadId}/messages`, {
        content: data.content,
        isInternal: data.isInternal,
      });
      return res.json();
    },
    onSuccess: (_: any, vars: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/team/chat/threads", vars.threadId, "messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/team/chat/threads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/team/chat/unread"] });
      setChatMessage("");
      toast({ title: vars.isInternal ? "Internal note added" : "Reply sent" });
    },
    onError: () => {
      toast({ title: "Failed to send message", variant: "destructive" });
    },
  });

  const markReadMutation = useMutation({
    mutationFn: async (threadId: string) => {
      const res = await apiRequest("POST", `/api/team/chat/threads/${threadId}/read`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/team/chat/threads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/team/chat/unread"] });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async (data: { threadId: string; status: string }) => {
      const res = await apiRequest("PATCH", `/api/team/chat/threads/${data.threadId}`, { status: data.status });
      return res.json();
    },
    onSuccess: (updated: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/team/chat/threads"] });
      setSelectedThread(updated);
      toast({ title: "Thread status updated" });
    },
    onError: () => {
      toast({ title: "Failed to update status", variant: "destructive" });
    },
  });

  const updatePriorityMutation = useMutation({
    mutationFn: async (data: { threadId: string; priority: string }) => {
      const res = await apiRequest("PATCH", `/api/team/chat/threads/${data.threadId}`, { priority: data.priority });
      return res.json();
    },
    onSuccess: (updated: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/team/chat/threads"] });
      setSelectedThread(updated);
      toast({ title: "Priority updated" });
    },
    onError: () => {
      toast({ title: "Failed to update priority", variant: "destructive" });
    },
  });

  if (selectedThread) {
    return (
      <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4" data-testid="portal-chat-detail">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => setSelectedThread(null)} data-testid="button-back-threads">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-lg font-semibold flex-1 min-w-0 truncate" data-testid="text-thread-title">{selectedThread.subject}</h2>
        </div>

        <Card data-testid="card-thread-info">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="outline" className="text-xs" data-testid="badge-thread-portal-type">
                {selectedThread.portalType === "CLIENT" ? "Client" : "Subcontractor"}
              </Badge>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">From:</span>
                <span className="text-sm font-medium" data-testid="text-contact-name">{selectedThread.contactName}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Email:</span>
                <span className="text-sm" data-testid="text-contact-email">{selectedThread.contactEmail}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Status:</span>
                <Select value={selectedThread.status} onValueChange={(v) => updateStatusMutation.mutate({ threadId: selectedThread.id, status: v })}>
                  <SelectTrigger className="h-7 w-28 text-xs" data-testid="select-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="OPEN">Open</SelectItem>
                    <SelectItem value="CLOSED">Closed</SelectItem>
                    <SelectItem value="ARCHIVED">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Priority:</span>
                <Select value={selectedThread.priority || "NORMAL"} onValueChange={(v) => updatePriorityMutation.mutate({ threadId: selectedThread.id, priority: v })}>
                  <SelectTrigger className="h-7 w-28 text-xs" data-testid="select-priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NORMAL">Normal</SelectItem>
                    <SelectItem value="URGENT">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-messages">
          <CardContent className="p-4">
            <div className="space-y-3 max-h-[500px] overflow-y-auto mb-4 pr-1" data-testid="messages-list">
              {messagesLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : threadMessages.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No messages yet.</p>
              ) : (
                threadMessages.map((msg: any) => (
                  <div
                    key={msg.id}
                    className={`rounded-md p-3 text-sm ${msg.isInternal ? "bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 mr-8" : (msg.senderType === "portal" || msg.senderType === "client_portal") ? "bg-muted mr-8" : "bg-primary/10 ml-8"}`}
                    data-testid={`message-${msg.id}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-1 mb-1">
                      <span className="font-medium text-xs flex items-center gap-1" data-testid={`text-msg-sender-${msg.id}`}>
                        {msg.isInternal && <EyeOff className="h-3 w-3" />}
                        {msg.senderName || ((msg.senderType === "portal" || msg.senderType === "client_portal") ? selectedThread.contactName : "Team")}
                        {msg.isInternal && <span className="text-yellow-600 dark:text-yellow-400">(Internal Note)</span>}
                      </span>
                      <span className="text-xs text-muted-foreground">{formatDate(msg.createdAt)}</span>
                    </div>
                    <p className="whitespace-pre-wrap" data-testid={`text-msg-content-${msg.id}`}>{msg.content}</p>
                  </div>
                ))
              )}
            </div>
            {selectedThread.status !== "CLOSED" && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Button
                    variant={isInternalNote ? "default" : "outline"}
                    size="sm"
                    onClick={() => setIsInternalNote(!isInternalNote)}
                    data-testid="button-toggle-internal"
                  >
                    {isInternalNote ? <EyeOff className="h-3.5 w-3.5 mr-1" /> : <Eye className="h-3.5 w-3.5 mr-1" />}
                    {isInternalNote ? "Internal Note" : "Reply to Client"}
                  </Button>
                  {isInternalNote && (
                    <span className="text-xs text-yellow-600 dark:text-yellow-400">This note is only visible to your team</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Textarea
                    placeholder={isInternalNote ? "Add an internal note..." : "Type your reply..."}
                    value={chatMessage}
                    onChange={(e) => setChatMessage(e.target.value)}
                    className="flex-1"
                    data-testid="input-team-reply"
                  />
                  <Button
                    size="icon"
                    onClick={() => sendMessageMutation.mutate({ threadId: selectedThread.id, content: chatMessage, isInternal: isInternalNote })}
                    disabled={!chatMessage.trim() || sendMessageMutation.isPending}
                    data-testid="button-send-team-reply"
                  >
                    {sendMessageMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4" data-testid="portal-chat-inbox">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold" data-testid="text-page-title">Portal Chat Inbox</h1>
          {(unreadCount?.unreadCount ?? 0) > 0 && (
            <Badge variant="destructive" data-testid="badge-total-unread">{unreadCount?.unreadCount} unread</Badge>
          )}
        </div>
      </div>

      <Card data-testid="card-filters">
        <CardContent className="p-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search conversations..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8"
                  data-testid="input-search"
                />
              </div>
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-32" data-testid="select-filter-status">
                <Filter className="h-3.5 w-3.5 mr-1" />
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="OPEN">Open</SelectItem>
                <SelectItem value="CLOSED">Closed</SelectItem>
                <SelectItem value="ARCHIVED">Archived</SelectItem>
              </SelectContent>
            </Select>
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="w-32" data-testid="select-filter-priority">
                <SelectValue placeholder="Priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priority</SelectItem>
                <SelectItem value="NORMAL">Normal</SelectItem>
                <SelectItem value="URGENT">Urgent</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {threadsLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : threads.length === 0 ? (
        <Card data-testid="empty-inbox">
          <CardContent className="py-12 text-center">
            <MessageSquare className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground text-sm">No chat threads found.</p>
            <p className="text-muted-foreground text-xs mt-1">Portal users can start conversations from their portal view.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2" data-testid="threads-list">
          {(threads as any[]).map((thread: any) => (
            <Card
              key={thread.id}
              className={`cursor-pointer hover-elevate ${thread.teamUnreadCount > 0 ? "border-primary/40" : ""}`}
              onClick={() => {
                setSelectedThread(thread);
                if (thread.teamUnreadCount > 0) markReadMutation.mutate(thread.id);
              }}
              data-testid={`card-inbox-thread-${thread.id}`}
            >
              <CardContent className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <StatusIcon status={thread.status} />
                      <span className="font-medium text-sm" data-testid={`text-inbox-subject-${thread.id}`}>{thread.subject}</span>
                      <PriorityBadge priority={thread.priority} />
                      {thread.teamUnreadCount > 0 && (
                        <Badge variant="destructive" className="text-xs" data-testid={`badge-inbox-unread-${thread.id}`}>
                          {thread.teamUnreadCount} new
                        </Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline" className="text-xs" data-testid={`badge-portal-type-${thread.id}`}>
                        {thread.portalType === "CLIENT" ? "Client" : "Subcontractor"}
                      </Badge>
                      <span data-testid={`text-inbox-contact-${thread.id}`}>{thread.contactName} ({thread.contactEmail})</span>
                    </div>
                    {thread.lastMessagePreview && (
                      <p className="text-xs text-muted-foreground mt-1 truncate" data-testid={`text-inbox-preview-${thread.id}`}>
                        {thread.lastMessagePreview}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-xs text-muted-foreground" data-testid={`text-inbox-date-${thread.id}`}>
                      {formatDate(thread.lastMessageAt)}
                    </span>
                    <Badge variant="outline" className="text-xs">{thread.status}</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
