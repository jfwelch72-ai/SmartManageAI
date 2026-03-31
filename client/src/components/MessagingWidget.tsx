import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { MessageCircle, MessageSquare, X, Minimize2, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/use-auth";
import { useUnreadMessageCount } from "@/hooks/use-data";
import { TeamMessagesContent } from "@/pages/messages";
import { PortalChatContent } from "@/pages/portal-chat";

const MINIMIZED_KEY = "smartmanage-messaging-widget-minimized";

export function MessagingWidget() {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(() => {
    const stored = localStorage.getItem(MINIMIZED_KEY);
    return stored === "true";
  });
  const [activeTab, setActiveTab] = useState("team");

  useEffect(() => {
    const handleOpenMessages = (e: Event) => {
      setIsOpen(true);
      setIsMinimized(false);
      const detail = (e as CustomEvent)?.detail;
      if (detail?.tab === "portal") {
        setActiveTab("portal");
      } else if (detail?.tab === "team") {
        setActiveTab("team");
      }
      if (detail?.conversationId) {
        window.dispatchEvent(
          new CustomEvent("select-conversation", {
            detail: { conversationId: detail.conversationId, callId: detail.callId },
          })
        );
      }
    };
    window.addEventListener("open-messaging-widget", handleOpenMessages);
    return () => window.removeEventListener("open-messaging-widget", handleOpenMessages);
  }, []);

  const { data: messageCountData = { unreadCount: 0 } } = useUnreadMessageCount();
  const teamUnreadCount = messageCountData.unreadCount || 0;

  const { data: portalUnreadData } = useQuery<{ unreadCount: number }>({
    queryKey: ["/api/team/chat/unread"],
    refetchInterval: 30000,
    enabled: !!user,
  });
  const portalUnreadCount = portalUnreadData?.unreadCount || 0;

  const totalUnread = teamUnreadCount + portalUnreadCount;

  useEffect(() => {
    localStorage.setItem(MINIMIZED_KEY, String(isMinimized));
  }, [isMinimized]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("messaging-widget-state", { detail: { isOpen } }));
    return () => {
      window.dispatchEvent(new CustomEvent("messaging-widget-state", { detail: { isOpen: false } }));
    };
  }, [isOpen]);

  if (!user) return null;

  return (
    <>
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="relative flex items-center justify-center w-12 h-12 rounded-full shadow-lg hover-elevate active-elevate-2 transition-all bg-primary text-primary-foreground"
          data-testid="button-messaging-widget-open"
        >
          <MessageCircle className="h-5 w-5" />
          {totalUnread > 0 && (
            <span
              className="absolute -top-1 -right-1 h-5 min-w-5 flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-xs font-medium px-1"
              data-testid="badge-messaging-unread"
            >
              {totalUnread > 99 ? "99+" : totalUnread}
            </span>
          )}
          <span className="sr-only">Open Messages</span>
        </button>
      )}

      {isOpen && (
        <div
          className={`bg-card border rounded-lg shadow-2xl transition-all flex flex-col ${
            isMinimized ? "w-72" : "w-[480px] sm:w-[560px]"
          }`}
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            zIndex: 9999,
            maxWidth: 'calc(100vw - 48px)',
            height: isMinimized ? 'auto' : 'min(680px, calc(100vh - 100px))',
          }}
          data-testid="messaging-widget-panel"
        >
          <div className="flex items-center justify-between p-3 border-b bg-muted/50 rounded-t-lg shrink-0">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-md bg-primary/10">
                <MessageCircle className="h-4 w-4 text-primary" />
              </div>
              <span className="font-medium text-sm">Messages</span>
              {totalUnread > 0 && (
                <Badge variant="default" className="text-xs" data-testid="badge-widget-total-unread">
                  {totalUnread}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => setIsMinimized(!isMinimized)}
                title={isMinimized ? "Expand" : "Minimize"}
                data-testid="button-messaging-minimize"
              >
                {isMinimized ? <Maximize2 className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" />}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => setIsOpen(false)}
                title="Close"
                data-testid="button-messaging-close"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {!isMinimized && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
                <TabsList className="mx-3 mt-2 shrink-0" data-testid="tabs-messaging-widget">
                  <TabsTrigger value="team" className="gap-1.5" data-testid="tab-widget-team">
                    <MessageCircle className="h-3.5 w-3.5" />
                    <span>Team</span>
                    {teamUnreadCount > 0 && (
                      <Badge variant="default" className="h-4 min-w-4 flex items-center justify-center p-0 text-[10px]">
                        {teamUnreadCount}
                      </Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="portal" className="gap-1.5" data-testid="tab-widget-portal">
                    <MessageSquare className="h-3.5 w-3.5" />
                    <span>Portal</span>
                    {portalUnreadCount > 0 && (
                      <Badge variant="destructive" className="h-4 min-w-4 flex items-center justify-center p-0 text-[10px]">
                        {portalUnreadCount}
                      </Badge>
                    )}
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="team" className="flex-1 overflow-hidden mt-0 px-1 pb-1" data-testid="tab-content-team">
                  <div className="h-full overflow-auto messaging-widget-container">
                    <TeamMessagesContent compact />
                  </div>
                </TabsContent>

                <TabsContent value="portal" className="flex-1 overflow-hidden mt-0 px-2 pb-2" data-testid="tab-content-portal">
                  <div className="h-full overflow-auto">
                    <PortalChatContent />
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          )}
        </div>
      )}
    </>
  );
}

export default MessagingWidget;
