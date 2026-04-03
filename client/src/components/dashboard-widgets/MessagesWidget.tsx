import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { MessageSquare, ChevronRight, AlertCircle, RefreshCw } from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

interface ConversationWithDetails {
  id: string;
  name: string | null;
  isCompanyChannel: boolean;
  updatedAt: string;
  participants: Array<{
    user: { id: string; firstName: string; lastName: string; role: string };
  }>;
  lastMessage?: {
    content: string;
    createdAt: string;
    sender: { firstName: string; lastName: string };
  } | null;
  unreadCount: number;
}

export function MessagesWidget({ config }: { config?: Record<string, unknown> }) {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { data: conversations = [], isLoading, isError, refetch } = useQuery<ConversationWithDetails[]>({
    queryKey: ["/api/conversations"],
  });
  const [showAll, setShowAll] = useState(false);
  const displayLimit = (config?.displayLimit as number) || 4;

  if (isLoading) {
    return (
      <Card className="h-full" data-testid="card-messages">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4" />
              <Skeleton className="h-4 w-20" />
            </div>
            <Skeleton className="h-7 w-16" />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 p-2">
              <Skeleton className="h-8 w-8 rounded-full shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-3/4" />
                <Skeleton className="h-3 w-full" />
              </div>
              <Skeleton className="h-5 w-6 rounded-full shrink-0" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card className="h-full" data-testid="card-messages-error">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <MessageSquare className="w-4 h-4" />
            Messages
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center py-6 text-center gap-2">
          <AlertCircle className="w-6 h-6 text-destructive" />
          <p className="text-sm text-muted-foreground">Failed to load messages.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-retry-messages">
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const conversationsWithUnread = conversations.filter((c) => c.unreadCount > 0);
  const totalUnreadMessages = conversationsWithUnread.reduce(
    (sum, c) => sum + c.unreadCount,
    0
  );
  const displayedConversations = showAll ? conversationsWithUnread : conversationsWithUnread.slice(0, displayLimit);
  const hasMore = conversationsWithUnread.length > displayLimit;

  return (
    <Card className="h-full" data-testid="card-messages">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <MessageSquare className="w-4 h-4" />
            Messages
            {totalUnreadMessages > 0 && (
              <Badge variant="default" className="ml-1">
                {totalUnreadMessages}
              </Badge>
            )}
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => window.dispatchEvent(new CustomEvent("open-messaging-widget"))}
            data-testid="button-view-all-messages"
          >
            View All
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {conversationsWithUnread.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-center" data-testid="messages-empty">
            <MessageSquare className="w-6 h-6 text-muted-foreground/50 mb-2" />
            <p className="text-sm text-muted-foreground">No unread messages</p>
          </div>
        ) : (
          <div className="space-y-3">
            {displayedConversations.map((conv) => {
              const otherParticipants =
                conv.participants?.filter((p) => p.user.id !== user?.id) || [];
              const displayName = conv.isCompanyChannel
                ? "Company Channel"
                : conv.name ||
                  otherParticipants
                    .map((p) => `${p.user.firstName} ${p.user.lastName}`)
                    .join(", ");

              return (
                <div
                  key={conv.id}
                  className="flex items-start gap-3 p-2 rounded-md hover-elevate cursor-pointer"
                  onClick={() =>
                    window.dispatchEvent(new CustomEvent("open-messaging-widget", { detail: { tab: "team" } }))
                  }
                  data-testid={`message-preview-${conv.id}`}
                >
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="text-xs">
                      {conv.isCompanyChannel
                        ? "Co"
                        : otherParticipants[0]?.user.firstName?.[0]}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium truncate">
                        {displayName}
                      </p>
                      <Badge variant="default" className="shrink-0">
                        {conv.unreadCount}
                      </Badge>
                    </div>
                    {conv.lastMessage && (
                      <p className="text-xs text-muted-foreground truncate">
                        {conv.lastMessage.sender.firstName}:{" "}
                        {conv.lastMessage.content}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
            {hasMore && !showAll && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-xs text-muted-foreground"
                onClick={() => setShowAll(true)}
                data-testid="button-show-more-messages"
              >
                Show {conversationsWithUnread.length - displayLimit} more
              </Button>
            )}
            {showAll && hasMore && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-xs text-muted-foreground"
                onClick={() => setShowAll(false)}
                data-testid="button-show-less-messages"
              >
                Show less
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
