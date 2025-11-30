import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { 
  MessageSquare, 
  Plus, 
  Send, 
  Users, 
  Building2, 
  Search,
  ChevronLeft
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

interface User {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
}

interface Conversation {
  id: string;
  type: "DIRECT" | "GROUP" | "COMPANY";
  name: string | null;
  description: string | null;
  isCompanyChannel: boolean;
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

interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  attachmentUrl: string | null;
  attachmentName: string | null;
  attachmentType: string | null;
  createdAt: string;
  sender: User;
}

export default function MessagesPage() {
  const { user, logout, organizationName } = useAuth();
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [messageInput, setMessageInput] = useState("");
  const [newConversationOpen, setNewConversationOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isMobileView, setIsMobileView] = useState(false);

  // Check for mobile view
  useEffect(() => {
    const checkMobile = () => setIsMobileView(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Fetch conversations
  const { data: conversations = [], isLoading: conversationsLoading } = useQuery<Conversation[]>({
    queryKey: ["/api/conversations"],
    refetchInterval: 10000, // Poll every 10 seconds for new messages
  });

  // Ensure company channel exists and get it
  const { data: companyChannel } = useQuery<Conversation>({
    queryKey: ["/api/conversations/company-channel"],
  });

  // Fetch available users for new conversations
  const { data: availableUsers = [] } = useQuery<User[]>({
    queryKey: ["/api/messaging/users"],
  });

  // Fetch messages for selected conversation
  const { data: messages = [], isLoading: messagesLoading } = useQuery<Message[]>({
    queryKey: ["/api/conversations", selectedConversationId, "messages"],
    enabled: !!selectedConversationId,
    refetchInterval: 5000, // Poll every 5 seconds for new messages
  });

  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: async ({ conversationId, content }: { conversationId: string; content: string }) => {
      const response = await apiRequest("POST", `/api/conversations/${conversationId}/messages`, { content });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations", selectedConversationId, "messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      setMessageInput("");
    },
  });

  // Mark messages as read
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

  // Create new conversation mutation
  const createConversationMutation = useMutation({
    mutationFn: async ({ type, participantIds, name }: { type: string; participantIds: string[]; name?: string }) => {
      const response = await apiRequest("POST", "/api/conversations", { type, participantIds, name });
      return response.json();
    },
    onSuccess: (newConversation) => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      setSelectedConversationId(newConversation.id);
      setNewConversationOpen(false);
    },
  });

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Mark as read when conversation is selected
  useEffect(() => {
    if (selectedConversationId) {
      const conversation = conversations.find(c => c.id === selectedConversationId);
      if (conversation && conversation.unreadCount > 0) {
        markAsReadMutation.mutate(selectedConversationId);
      }
    }
  }, [selectedConversationId, conversations]);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageInput.trim() || !selectedConversationId) return;
    sendMessageMutation.mutate({ conversationId: selectedConversationId, content: messageInput });
  };

  const handleStartDirectMessage = (userId: string) => {
    createConversationMutation.mutate({ type: "DIRECT", participantIds: [userId] });
  };

  const getConversationName = (conversation: Conversation): string => {
    if (conversation.isCompanyChannel) return "TFR Company Chat";
    if (conversation.name) return conversation.name;
    if (conversation.type === "DIRECT") {
      const otherParticipant = conversation.participants.find(p => p.userId !== user?.id);
      if (otherParticipant) {
        return `${otherParticipant.user.firstName} ${otherParticipant.user.lastName}`;
      }
    }
    return "Conversation";
  };

  const getConversationIcon = (conversation: Conversation) => {
    if (conversation.isCompanyChannel) return <Building2 className="w-5 h-5" />;
    if (conversation.type === "GROUP") return <Users className="w-5 h-5" />;
    return <MessageSquare className="w-5 h-5" />;
  };

  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName?.charAt(0) || ""}${lastName?.charAt(0) || ""}`.toUpperCase();
  };

  const selectedConversation = conversations.find(c => c.id === selectedConversationId);

  // Filter conversations based on search
  const filteredConversations = conversations.filter(c => {
    const name = getConversationName(c).toLowerCase();
    return name.includes(searchQuery.toLowerCase());
  });

  // Sort conversations: company channel first, then by last message time
  const sortedConversations = [...filteredConversations].sort((a, b) => {
    if (a.isCompanyChannel && !b.isCompanyChannel) return -1;
    if (!a.isCompanyChannel && b.isCompanyChannel) return 1;
    const aTime = a.lastMessage ? new Date(a.lastMessage.createdAt).getTime() : new Date(a.createdAt).getTime();
    const bTime = b.lastMessage ? new Date(b.lastMessage.createdAt).getTime() : new Date(b.createdAt).getTime();
    return bTime - aTime;
  });

  // Filter users not already in direct conversation with current user
  const usersForNewConversation = availableUsers.filter(u => {
    const existingDM = conversations.find(
      c => c.type === "DIRECT" && c.participants.some(p => p.userId === u.id)
    );
    return !existingDM;
  });

  const showConversationList = !isMobileView || !selectedConversationId;
  const showMessages = !isMobileView || selectedConversationId;

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-4 sm:py-8">
        <div className="flex items-center justify-between mb-4 sm:mb-6">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-foreground" data-testid="text-page-title">Messages</h1>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Team communication and direct messages
            </p>
          </div>
        </div>

        <Card className="h-[calc(100vh-200px)] min-h-[500px]">
          <div className="flex h-full">
            {/* Conversation List */}
            {showConversationList && (
              <div className={cn(
                "border-r flex flex-col",
                isMobileView ? "w-full" : "w-80"
              )}>
                <div className="p-3 border-b space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        placeholder="Search conversations..."
                        className="pl-8 h-9"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        data-testid="input-search-conversations"
                      />
                    </div>
                    <Dialog open={newConversationOpen} onOpenChange={setNewConversationOpen}>
                      <DialogTrigger asChild>
                        <Button size="icon" variant="outline" data-testid="button-new-conversation">
                          <Plus className="w-4 h-4" />
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Start a Conversation</DialogTitle>
                          <DialogDescription>
                            Select a team member to start a direct message
                          </DialogDescription>
                        </DialogHeader>
                        <ScrollArea className="h-[300px] mt-4">
                          {usersForNewConversation.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-4">
                              You already have conversations with all team members
                            </p>
                          ) : (
                            <div className="space-y-2">
                              {usersForNewConversation.map(u => (
                                <button
                                  key={u.id}
                                  onClick={() => handleStartDirectMessage(u.id)}
                                  className="w-full flex items-center gap-3 p-3 rounded-lg hover-elevate"
                                  data-testid={`button-dm-user-${u.id}`}
                                >
                                  <Avatar className="h-10 w-10">
                                    <AvatarFallback>{getInitials(u.firstName, u.lastName)}</AvatarFallback>
                                  </Avatar>
                                  <div className="text-left">
                                    <p className="font-medium">{u.firstName} {u.lastName}</p>
                                    <p className="text-xs text-muted-foreground">{u.role}</p>
                                  </div>
                                </button>
                              ))}
                            </div>
                          )}
                        </ScrollArea>
                      </DialogContent>
                    </Dialog>
                  </div>
                </div>
                <ScrollArea className="flex-1">
                  {conversationsLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <p className="text-sm text-muted-foreground">Loading...</p>
                    </div>
                  ) : sortedConversations.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
                      <MessageSquare className="w-10 h-10 text-muted-foreground/50 mb-3" />
                      <p className="text-sm text-muted-foreground">No conversations yet</p>
                      <p className="text-xs text-muted-foreground mt-1">Start a new conversation to get started</p>
                    </div>
                  ) : (
                    <div className="py-1">
                      {sortedConversations.map(conversation => (
                        <button
                          key={conversation.id}
                          onClick={() => setSelectedConversationId(conversation.id)}
                          className={cn(
                            "w-full flex items-start gap-3 p-3 hover-elevate text-left",
                            selectedConversationId === conversation.id && "bg-accent"
                          )}
                          data-testid={`button-conversation-${conversation.id}`}
                        >
                          <div className={cn(
                            "w-10 h-10 rounded-full flex items-center justify-center shrink-0",
                            conversation.isCompanyChannel ? "bg-primary text-primary-foreground" : "bg-muted"
                          )}>
                            {getConversationIcon(conversation)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium truncate">
                                {getConversationName(conversation)}
                              </span>
                              {conversation.unreadCount > 0 && (
                                <Badge variant="default" className="h-5 min-w-[20px] px-1.5 text-xs">
                                  {conversation.unreadCount}
                                </Badge>
                              )}
                            </div>
                            {conversation.lastMessage && (
                              <p className="text-xs text-muted-foreground truncate mt-0.5">
                                <span className="font-medium">{conversation.lastMessage.sender.firstName}:</span>{" "}
                                {conversation.lastMessage.content}
                              </p>
                            )}
                            {conversation.lastMessage && (
                              <p className="text-xs text-muted-foreground/70 mt-0.5">
                                {formatDistanceToNow(new Date(conversation.lastMessage.createdAt), { addSuffix: true })}
                              </p>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </div>
            )}

            {/* Messages Panel */}
            {showMessages && (
              <div className={cn(
                "flex flex-col flex-1",
                isMobileView && selectedConversationId ? "w-full" : ""
              )}>
                {selectedConversation ? (
                  <>
                    {/* Conversation Header */}
                    <div className="flex items-center gap-3 p-3 border-b">
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
                      <div className={cn(
                        "w-10 h-10 rounded-full flex items-center justify-center shrink-0",
                        selectedConversation.isCompanyChannel ? "bg-primary text-primary-foreground" : "bg-muted"
                      )}>
                        {getConversationIcon(selectedConversation)}
                      </div>
                      <div>
                        <h2 className="font-semibold" data-testid="text-conversation-name">
                          {getConversationName(selectedConversation)}
                        </h2>
                        {selectedConversation.isCompanyChannel && (
                          <p className="text-xs text-muted-foreground">Company-wide channel</p>
                        )}
                        {selectedConversation.type === "DIRECT" && (
                          <p className="text-xs text-muted-foreground">Direct message</p>
                        )}
                      </div>
                    </div>

                    {/* Messages Area */}
                    <ScrollArea className="flex-1 p-4">
                      {messagesLoading ? (
                        <div className="flex items-center justify-center h-full">
                          <p className="text-sm text-muted-foreground">Loading messages...</p>
                        </div>
                      ) : messages.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-center">
                          <MessageSquare className="w-10 h-10 text-muted-foreground/50 mb-3" />
                          <p className="text-sm text-muted-foreground">No messages yet</p>
                          <p className="text-xs text-muted-foreground mt-1">Send a message to start the conversation</p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {messages.map((message) => {
                            const isOwnMessage = message.senderId === user?.id;
                            return (
                              <div
                                key={message.id}
                                className={cn(
                                  "flex gap-3",
                                  isOwnMessage && "flex-row-reverse"
                                )}
                                data-testid={`message-${message.id}`}
                              >
                                <Avatar className="h-8 w-8 shrink-0">
                                  <AvatarFallback className="text-xs">
                                    {getInitials(message.sender.firstName, message.sender.lastName)}
                                  </AvatarFallback>
                                </Avatar>
                                <div className={cn(
                                  "max-w-[70%]",
                                  isOwnMessage && "text-right"
                                )}>
                                  <div className="flex items-center gap-2 mb-1">
                                    {!isOwnMessage && (
                                      <span className="text-sm font-medium">
                                        {message.sender.firstName} {message.sender.lastName}
                                      </span>
                                    )}
                                    <span className="text-xs text-muted-foreground">
                                      {formatDistanceToNow(new Date(message.createdAt), { addSuffix: true })}
                                    </span>
                                  </div>
                                  <div className={cn(
                                    "rounded-lg px-3 py-2 text-sm inline-block text-left",
                                    isOwnMessage 
                                      ? "bg-primary text-primary-foreground" 
                                      : "bg-muted"
                                  )}>
                                    {message.content}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                          <div ref={messagesEndRef} />
                        </div>
                      )}
                    </ScrollArea>

                    {/* Message Input */}
                    <form onSubmit={handleSendMessage} className="p-3 border-t flex gap-2">
                      <Input
                        placeholder="Type a message..."
                        value={messageInput}
                        onChange={(e) => setMessageInput(e.target.value)}
                        className="flex-1"
                        data-testid="input-message"
                      />
                      <Button 
                        type="submit" 
                        size="icon"
                        disabled={!messageInput.trim() || sendMessageMutation.isPending}
                        data-testid="button-send-message"
                      >
                        <Send className="w-4 h-4" />
                      </Button>
                    </form>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-center p-8">
                    <MessageSquare className="w-12 h-12 text-muted-foreground/50 mb-4" />
                    <h2 className="text-lg font-semibold mb-2">Select a Conversation</h2>
                    <p className="text-sm text-muted-foreground max-w-md">
                      Choose a conversation from the list to view messages, or start a new conversation with a team member.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>
      </main>
    </div>
  );
}
