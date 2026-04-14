import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Send,
  MessageSquare,
  Loader2,
} from "lucide-react";
import { formatDate } from "./sub-portal-utils";

interface SubPortalChatTabProps {
  token: string;
  chatThreads: any[];
  chatLoading: boolean;
}

const FALLBACK_POLL_INTERVAL = 30000;

function useSubPortalChatSSE(
  token: string,
  queryClient: ReturnType<typeof useQueryClient>
) {
  const [sseConnected, setSseConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isCleanedUpRef = useRef(false);

  useEffect(() => {
    if (!token) return;
    isCleanedUpRef.current = false;

    const url = `/api/portal/chat/events?token=${encodeURIComponent(token)}`;

    function createConnection() {
      if (isCleanedUpRef.current) return;

      const es = new EventSource(url);
      esRef.current = es;

      es.addEventListener("connected", () => {
        setSseConnected(true);
      });

      es.addEventListener("portal_chat_message", (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          if (data.threadId) {
            queryClient.invalidateQueries({ queryKey: ["/api/portal/chat/threads", data.threadId, "messages"] });
          }
        } catch {}
      });

      es.addEventListener("portal_chat_thread_update", () => {
        queryClient.invalidateQueries({ queryKey: ["/api/portal/chat/threads", { token }] });
      });

      es.onerror = () => {
        setSseConnected(false);
        es.close();
        esRef.current = null;

        if (!isCleanedUpRef.current) {
          reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null;
            if (!isCleanedUpRef.current && !esRef.current) {
              createConnection();
            }
          }, 5000);
        }
      };
    }

    createConnection();

    return () => {
      isCleanedUpRef.current = true;
      setSseConnected(false);
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (esRef.current) {
        esRef.current.onerror = null;
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, [token, queryClient]);

  return sseConnected;
}

export function SubPortalChatTab({ token, chatThreads, chatLoading }: SubPortalChatTabProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedThread, setSelectedThread] = useState<any>(null);
  const [chatMessage, setChatMessage] = useState("");
  const [newThreadSubject, setNewThreadSubject] = useState("");
  const [newThreadMessage, setNewThreadMessage] = useState("");
  const [showNewThread, setShowNewThread] = useState(false);

  const sseConnected = useSubPortalChatSSE(token, queryClient);

  const { data: threadMessages = [], isLoading: messagesLoading } = useQuery({
    queryKey: ["/api/portal/chat/threads", selectedThread?.id, "messages"],
    queryFn: async () => {
      const res = await fetch(`/api/portal/chat/threads/${selectedThread.id}/messages`, {
        headers: { "x-portal-token": token },
      });
      if (!res.ok) throw new Error("Failed to load messages");
      return res.json();
    },
    enabled: !!token && !!selectedThread,
    refetchInterval: sseConnected ? false : FALLBACK_POLL_INTERVAL,
  });

  const createThreadMutation = useMutation({
    mutationFn: async (data: { subject: string; message: string }) => {
      const res = await fetch(`/api/portal/chat/threads`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-portal-token": token },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create thread");
      return res.json();
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/portal/chat/threads", { token }] });
      setSelectedThread(result);
      setShowNewThread(false);
      setNewThreadSubject("");
      setNewThreadMessage("");
      toast({ title: "Conversation started" });
    },
    onError: () => {
      toast({ title: "Failed to start conversation", variant: "destructive" });
    },
  });

  const sendMessageMutation = useMutation({
    mutationFn: async (data: { threadId: string; content: string }) => {
      const res = await fetch(`/api/portal/chat/threads/${data.threadId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-portal-token": token },
        body: JSON.stringify({ content: data.content }),
      });
      if (!res.ok) throw new Error("Failed to send message");
      return res.json();
    },
    onSuccess: (_: any, vars: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/portal/chat/threads", vars.threadId, "messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portal/chat/threads", { token }] });
      setChatMessage("");
    },
    onError: () => {
      toast({ title: "Failed to send message", variant: "destructive" });
    },
  });

  const markReadMutation = useMutation({
    mutationFn: async (threadId: string) => {
      const res = await fetch(`/api/portal/chat/threads/${threadId}/read`, {
        method: "POST",
        headers: { "x-portal-token": token },
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portal/chat/threads", { token }] });
    },
  });

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="md:col-span-1 space-y-2">
        <Button
          className="w-full"
          onClick={() => { setShowNewThread(true); setSelectedThread(null); }}
          data-testid="button-new-thread"
        >
          <MessageSquare className="h-4 w-4 mr-1.5" />
          New Conversation
        </Button>
        {chatLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : chatThreads.length === 0 && !showNewThread ? (
          <Card data-testid="empty-chat">
            <CardContent className="py-8 text-center">
              <MessageSquare className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-muted-foreground text-sm">No conversations yet.</p>
              <p className="text-muted-foreground text-xs mt-1">Start one to communicate with the project team.</p>
            </CardContent>
          </Card>
        ) : (
          chatThreads.map((thread: any) => (
            <Card
              key={thread.id}
              className={`cursor-pointer hover-elevate ${selectedThread?.id === thread.id ? "ring-2 ring-primary" : ""}`}
              onClick={() => {
                setSelectedThread(thread);
                setShowNewThread(false);
                if (thread.portalUnreadCount > 0) markReadMutation.mutate(thread.id);
              }}
              data-testid={`card-thread-${thread.id}`}
            >
              <CardContent className="p-3">
                <div className="flex flex-wrap items-start justify-between gap-1">
                  <span className="font-medium text-sm truncate flex-1 min-w-0" data-testid={`text-thread-subject-${thread.id}`}>
                    {thread.subject}
                  </span>
                  {thread.portalUnreadCount > 0 && (
                    <Badge variant="destructive" className="text-xs" data-testid={`badge-unread-${thread.id}`}>
                      {thread.portalUnreadCount}
                    </Badge>
                  )}
                </div>
                {thread.lastMessagePreview && (
                  <p className="text-xs text-muted-foreground mt-1 truncate" data-testid={`text-thread-preview-${thread.id}`}>
                    {thread.lastMessagePreview}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  <Badge variant="outline" className="text-xs">{thread.status}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(thread.lastMessageAt)}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <div className="md:col-span-2">
        {showNewThread ? (
          <Card data-testid="card-new-thread">
            <CardHeader>
              <CardTitle className="text-base">Start a Conversation</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label>Subject</Label>
                <input
                  className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="What is this about?"
                  value={newThreadSubject}
                  onChange={(e) => setNewThreadSubject(e.target.value)}
                  data-testid="input-thread-subject"
                />
              </div>
              <div>
                <Label>Message</Label>
                <Textarea
                  placeholder="Type your message..."
                  value={newThreadMessage}
                  onChange={(e) => setNewThreadMessage(e.target.value)}
                  className="mt-1"
                  data-testid="input-thread-message"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  onClick={() => createThreadMutation.mutate({ subject: newThreadSubject, message: newThreadMessage })}
                  disabled={!newThreadSubject.trim() || !newThreadMessage.trim() || createThreadMutation.isPending}
                  data-testid="button-create-thread"
                >
                  {createThreadMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Send
                </Button>
                <Button variant="outline" onClick={() => setShowNewThread(false)} data-testid="button-cancel-thread">
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : selectedThread ? (
          <Card data-testid="card-thread-detail">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-base" data-testid="text-selected-thread-subject">{selectedThread.subject}</CardTitle>
              <Badge variant="outline">{selectedThread.status}</Badge>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 max-h-[400px] overflow-y-auto mb-4 pr-1" data-testid="messages-container">
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
                      className={`rounded-md p-3 text-sm ${msg.senderType === "portal" ? "bg-primary/10 ml-8" : "bg-muted mr-8"}`}
                      data-testid={`message-${msg.id}`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-1 mb-1">
                        <span className="font-medium text-xs" data-testid={`text-msg-sender-${msg.id}`}>
                          {msg.senderName || (msg.senderType === "portal" ? "You" : "Project Team")}
                        </span>
                        <span className="text-xs text-muted-foreground">{formatDate(msg.createdAt)}</span>
                      </div>
                      <p className="whitespace-pre-wrap" data-testid={`text-msg-content-${msg.id}`}>{msg.content}</p>
                    </div>
                  ))
                )}
              </div>
              {selectedThread.status !== "CLOSED" && (
                <div className="flex gap-2">
                  <Textarea
                    placeholder="Type a reply..."
                    value={chatMessage}
                    onChange={(e) => setChatMessage(e.target.value)}
                    className="flex-1"
                    data-testid="input-chat-reply"
                  />
                  <Button
                    size="icon"
                    onClick={() => sendMessageMutation.mutate({ threadId: selectedThread.id, content: chatMessage })}
                    disabled={!chatMessage.trim() || sendMessageMutation.isPending}
                    data-testid="button-send-reply"
                  >
                    {sendMessageMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <MessageSquare className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-muted-foreground text-sm">Select a conversation or start a new one.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
