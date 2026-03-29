import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { isVendor } from "@/lib/rbac";
import { useAuth } from "@/hooks/use-auth";
import { Redirect } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  MessageSquare,
  Send,
  ArrowLeft,
  Building2,
  Clock,
  Loader2,
} from "lucide-react";
import { getInitials } from "@/components/messaging/types";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

interface VendorConversation {
  id: string;
  contractorOrgId: string;
  contractorOrgName: string;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
}

interface VendorMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  senderRole: string;
  content: string;
  createdAt: string;
}

export default function VendorMessagesPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedConversation, setSelectedConversation] = useState<VendorConversation | null>(null);
  const [messageText, setMessageText] = useState("");

  if (!isVendor(user?.role)) {
    return <Redirect to="/dashboard" />;
  }

  const { data: conversations = [], isLoading: conversationsLoading } = useQuery<VendorConversation[]>({
    queryKey: ["/api/vendor/messages/conversations"],
  });

  const { data: messages = [], isLoading: messagesLoading } = useQuery<VendorMessage[]>({
    queryKey: ["/api/vendor/messages/conversations", selectedConversation?.id, "messages"],
    queryFn: async () => {
      const res = await fetch(`/api/vendor/messages/conversations/${selectedConversation!.id}/messages`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load messages");
      return res.json();
    },
    enabled: !!selectedConversation,
    refetchInterval: 5000,
  });

  const sendMutation = useMutation({
    mutationFn: async (data: { conversationId: string; content: string }) => {
      const res = await apiRequest("POST", `/api/vendor/messages/conversations/${data.conversationId}/messages`, { content: data.content });
      return res.json();
    },
    onSuccess: (newMessage: { id: string; conversationId: string; content: string }) => {
      setMessageText("");
      if (selectedConversation && selectedConversation.id.startsWith("pending-") && newMessage.conversationId) {
        setSelectedConversation({ ...selectedConversation, id: newMessage.conversationId });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/vendor/messages/conversations"] });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to send message", description: err.message, variant: "destructive" });
    },
  });

  const handleSend = () => {
    if (!messageText.trim() || !selectedConversation) return;
    sendMutation.mutate({ conversationId: selectedConversation.id, content: messageText.trim() });
  };

  return (
    <div className="min-h-screen bg-background" data-testid="vendor-messages-page">
      <main className="container mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground" data-testid="text-vendor-messages-title">
            Messages
          </h1>
          <p className="text-muted-foreground">
            Communicate with your enrolled contractor clients
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          <div className="md:col-span-1">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Conversations</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {conversationsLoading ? (
                  <div className="p-4 space-y-2">
                    {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
                  </div>
                ) : conversations.length === 0 ? (
                  <div className="text-center py-8 px-4 text-muted-foreground">
                    <MessageSquare className="h-10 w-10 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No conversations yet</p>
                    <p className="text-xs mt-1">Messages will appear when contractors contact you</p>
                  </div>
                ) : (
                  <div className="divide-y">
                    {conversations.map(conv => (
                      <button
                        key={conv.id}
                        onClick={() => setSelectedConversation(conv)}
                        className={`w-full text-left p-4 hover:bg-muted/50 transition-colors ${
                          selectedConversation?.id === conv.id ? "bg-muted" : ""
                        }`}
                        data-testid={`button-conversation-${conv.id}`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Building2 className="h-4 w-4 text-primary" />
                            <span className="font-medium text-sm">{conv.contractorOrgName}</span>
                          </div>
                          {conv.unreadCount > 0 && (
                            <Badge variant="default" className="text-xs" data-testid={`badge-unread-${conv.id}`}>
                              {conv.unreadCount}
                            </Badge>
                          )}
                        </div>
                        {conv.lastMessagePreview && (
                          <p className="text-xs text-muted-foreground mt-1 truncate">
                            {conv.lastMessagePreview}
                          </p>
                        )}
                        {conv.lastMessageAt && (
                          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {new Date(conv.lastMessageAt).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                          </p>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="md:col-span-2">
            <Card className="h-[600px] flex flex-col">
              {selectedConversation ? (
                <>
                  <CardHeader className="border-b flex-shrink-0">
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="md:hidden"
                        onClick={() => setSelectedConversation(null)}
                        data-testid="button-back-conversations"
                      >
                        <ArrowLeft className="h-4 w-4" />
                      </Button>
                      <Building2 className="h-5 w-5 text-primary" />
                      <CardTitle className="text-base" data-testid="text-conversation-title">
                        {selectedConversation.contractorOrgName}
                      </CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent className="flex-1 overflow-y-auto p-4 space-y-3">
                    {messagesLoading ? (
                      <div className="space-y-2">
                        {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-3/4" />)}
                      </div>
                    ) : messages.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <p className="text-sm">No messages yet. Start the conversation!</p>
                      </div>
                    ) : (
                      messages.map(msg => (
                        <div
                          key={msg.id}
                          className={`flex ${msg.senderId === user?.id ? "justify-end" : "justify-start"}`}
                          data-testid={`message-${msg.id}`}
                        >
                          <div className={`flex items-start gap-2 max-w-[75%] ${msg.senderId === user?.id ? "flex-row-reverse" : ""}`}>
                            {msg.senderId !== user?.id && (
                              <Avatar className="h-7 w-7 shrink-0">
                                <AvatarFallback className="text-xs">
                                  {getInitials(msg.senderName.split(" ")[0] || "", msg.senderName.split(" ")[1] || "")}
                                </AvatarFallback>
                              </Avatar>
                            )}
                            <div
                              className={`rounded-lg p-3 ${
                                msg.senderId === user?.id
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-muted"
                              }`}
                            >
                              <p className="text-xs font-medium mb-1 opacity-75">{msg.senderName}</p>
                              <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                              <p className="text-xs opacity-50 mt-1">
                                {new Date(msg.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </CardContent>
                  <div className="border-t p-4 flex gap-2 flex-shrink-0">
                    <Textarea
                      value={messageText}
                      onChange={(e) => setMessageText(e.target.value)}
                      placeholder="Type a message..."
                      className="resize-none"
                      rows={2}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleSend();
                        }
                      }}
                      data-testid="input-message"
                    />
                    <Button
                      onClick={handleSend}
                      disabled={!messageText.trim() || sendMutation.isPending}
                      className="self-end"
                      data-testid="button-send-message"
                    >
                      {sendMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center text-muted-foreground">
                  <div className="text-center">
                    <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p className="text-sm">Select a conversation to view messages</p>
                  </div>
                </div>
              )}
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
