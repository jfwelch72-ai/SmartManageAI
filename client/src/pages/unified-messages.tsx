import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { MessageCircle, MessageSquare } from "lucide-react";
import { useUnreadMessageCount } from "@/hooks/use-data";
import { TeamMessagesContent } from "./messages";
import { PortalChatContent } from "./portal-chat";

export default function UnifiedMessagesPage() {
  const [location] = useLocation();
  const [activeTab, setActiveTab] = useState(location === "/portal-chat" ? "portal" : "team");

  useEffect(() => {
    if (location === "/portal-chat") {
      setActiveTab("portal");
    } else if (location === "/messages") {
      setActiveTab("team");
    }
  }, [location]);

  const { data: messageCountData = { unreadCount: 0 } } = useUnreadMessageCount();
  const teamUnreadCount = messageCountData.unreadCount || 0;

  const { data: portalUnreadData } = useQuery<{ unreadCount: number }>({
    queryKey: ["/api/team/chat/unread"],
    refetchInterval: 10000,
  });
  const portalUnreadCount = portalUnreadData?.unreadCount || 0;

  return (
    <div className="min-h-screen bg-background" data-testid="unified-messages-page">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-4 sm:py-8">
        <div className="mb-4 sm:mb-6">
          <h1 className="text-xl sm:text-2xl font-bold text-foreground" data-testid="text-page-title">Messages</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Team communication and portal conversations
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="mb-4" data-testid="tabs-messages">
            <TabsTrigger value="team" className="gap-2" data-testid="tab-team-messages">
              <MessageCircle className="h-4 w-4" />
              <span>Team Messages</span>
              {teamUnreadCount > 0 && (
                <Badge variant="default" className="h-5 min-w-5 flex items-center justify-center p-0 text-xs" data-testid="badge-team-unread">
                  {teamUnreadCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="portal" className="gap-2" data-testid="tab-portal-chat">
              <MessageSquare className="h-4 w-4" />
              <span>Portal Chat</span>
              {portalUnreadCount > 0 && (
                <Badge variant="destructive" className="h-5 min-w-5 flex items-center justify-center p-0 text-xs" data-testid="badge-portal-unread">
                  {portalUnreadCount}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="team" className="mt-0">
            <TeamMessagesContent />
          </TabsContent>

          <TabsContent value="portal" className="mt-0">
            <PortalChatContent />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
