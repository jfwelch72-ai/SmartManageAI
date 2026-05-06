import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, Send, Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

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
  feedbackOutcome: "THUMBS_UP" | "THUMBS_DOWN" | null;
  createdAt: string;
}

interface Props {
  bidId?: string;
  estimateId?: string;
  projectId?: string;
  enabled: boolean;
}

export default function AiEstimatorChatPanel({ bidId, estimateId, projectId, enabled }: Props) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

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
      queryClient.invalidateQueries({ queryKey: ["/api/ai-estimator/chat/sessions"] });
      setSessionId(s.id);
    },
  });

  const sendTurn = useMutation({
    mutationFn: async (prompt: string) => {
      const r = await apiRequest("POST", `/api/ai-estimator/chat/sessions/${sessionId}/messages`, { prompt });
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-estimator/chat/sessions", sessionId, "messages"] });
      setDraft("");
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

  useEffect(() => {
    if (!enabled) return;
    if (sessionId) return;
    // Auto-pick newest session for this bid/estimate, otherwise create one.
    const sessions = sessionsQuery.data?.sessions ?? [];
    const match = sessions.find(
      (s) => (bidId ? s.bidId === bidId : true) && (estimateId ? s.estimateId === estimateId : true),
    );
    if (match) setSessionId(match.id);
  }, [enabled, sessionsQuery.data, bidId, estimateId, sessionId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messagesQuery.data?.messages.length]);

  if (!enabled) return null;

  const messages = messagesQuery.data?.messages ?? [];

  return (
    <Card className="flex flex-col h-full" data-testid="ai-estimator-chat-panel">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" /> Ask the Estimator
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-2 min-h-0">
        {!sessionId ? (
          <div className="flex flex-col items-center justify-center py-6 gap-3">
            <p className="text-sm text-muted-foreground text-center">
              Ask questions grounded in your bids, estimates, takeoffs and learned cost rates.
            </p>
            <Button onClick={() => createSession.mutate()} disabled={createSession.isPending} data-testid="button-start-chat">
              {createSession.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Start a conversation
            </Button>
          </div>
        ) : (
          <>
            <ScrollArea className="flex-1">
              <div ref={scrollRef} className="space-y-3 pr-2">
                {messagesQuery.isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  messages.map((m) => (
                    <div
                      key={m.id}
                      className={`rounded-md p-3 text-sm ${m.role === "user" ? "bg-muted ml-6" : "bg-primary/5 mr-6"}`}
                      data-testid={`chat-message-${m.id}`}
                    >
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{m.role}</div>
                      <div className="whitespace-pre-wrap">{m.content}</div>
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
                  ))
                )}
              </div>
            </ScrollArea>
            <div className="flex gap-2 pt-2 border-t">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Ask about prior bids, learned rates, or this estimate…"
                className="min-h-[60px] resize-none text-sm"
                data-testid="input-chat-prompt"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && draft.trim() && !sendTurn.isPending) {
                    sendTurn.mutate(draft.trim());
                  }
                }}
              />
              <Button
                onClick={() => draft.trim() && sendTurn.mutate(draft.trim())}
                disabled={!draft.trim() || sendTurn.isPending}
                data-testid="button-send-chat"
              >
                {sendTurn.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
