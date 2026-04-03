import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  Send,
  MessageSquare,
  FolderOpen,
  Loader2,
  Shield,
  AlertTriangle,
} from "lucide-react";
import { SubPortalHeader } from "@/components/sub-portal/SubPortalHeader";
import { SubPortalRfiTab } from "@/components/sub-portal/SubPortalRfiTab";
import { SubPortalSubmittalTab } from "@/components/sub-portal/SubPortalSubmittalTab";
import { SubPortalTransmittalTab } from "@/components/sub-portal/SubPortalTransmittalTab";
import { SubPortalChatTab } from "@/components/sub-portal/SubPortalChatTab";

export default function SubPortalPage() {
  const token = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("token") || "";
  }, []);

  const {
    data: portalInfo,
    isLoading: infoLoading,
    isError: infoError,
  } = useQuery({
    queryKey: ["/api/portal/info", { token }],
    queryFn: async () => {
      const res = await fetch(`/api/portal/info?token=${token}`);
      if (!res.ok) throw new Error("Invalid token");
      return res.json();
    },
    enabled: !!token,
  });

  const { data: rfis = [], isLoading: rfisLoading } = useQuery({
    queryKey: ["/api/portal/rfis", { token }],
    queryFn: async () => {
      const res = await fetch(`/api/portal/rfis?token=${token}`);
      if (!res.ok) throw new Error("Failed to load RFIs");
      return res.json();
    },
    enabled: !!token && !!portalInfo,
  });

  const { data: submittals = [], isLoading: submittalsLoading } = useQuery({
    queryKey: ["/api/portal/submittals", { token }],
    queryFn: async () => {
      const res = await fetch(`/api/portal/submittals?token=${token}`);
      if (!res.ok) throw new Error("Failed to load submittals");
      return res.json();
    },
    enabled: !!token && !!portalInfo,
  });

  const { data: transmittals = [], isLoading: transmittalsLoading } = useQuery({
    queryKey: ["/api/portal/transmittals", { token }],
    queryFn: async () => {
      const res = await fetch(`/api/portal/transmittals?token=${token}`);
      if (!res.ok) throw new Error("Failed to load transmittals");
      return res.json();
    },
    enabled: !!token && !!portalInfo,
  });

  const { data: chatThreads = [], isLoading: chatLoading } = useQuery({
    queryKey: ["/api/portal/chat/threads", { token }],
    queryFn: async () => {
      const res = await fetch(`/api/portal/chat/threads`, {
        headers: { "x-portal-token": token },
      });
      if (!res.ok) throw new Error("Failed to load chat threads");
      return res.json();
    },
    enabled: !!token && !!portalInfo,
    refetchInterval: 20000,
  });

  if (!token) {
    return (
      <div
        className="min-h-screen flex items-center justify-center bg-background p-4"
        data-testid="container-no-token"
      >
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4">
              <Shield className="h-12 w-12 text-muted-foreground" />
            </div>
            <CardTitle className="text-xl">Access Link Required</CardTitle>
          </CardHeader>
          <CardContent>
            <p
              className="text-muted-foreground text-center text-sm"
              data-testid="text-no-token-message"
            >
              This page requires a valid access link. Please check the
              invitation email you received.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (infoLoading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center bg-background"
        data-testid="container-loading"
      >
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground text-sm">
            Validating access...
          </p>
        </div>
      </div>
    );
  }

  if (infoError || !portalInfo) {
    return (
      <div
        className="min-h-screen flex items-center justify-center bg-background p-4"
        data-testid="container-invalid-token"
      >
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4">
              <AlertTriangle className="h-12 w-12 text-destructive" />
            </div>
            <CardTitle className="text-xl">Access Denied</CardTitle>
          </CardHeader>
          <CardContent>
            <p
              className="text-muted-foreground text-center text-sm"
              data-testid="text-invalid-token-message"
            >
              Your access link has expired or been revoked. Please contact your
              general contractor for a new invitation.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background" data-testid="container-portal">
      <SubPortalHeader portalInfo={portalInfo} />

      <main className="px-4 py-6">
        <Tabs defaultValue="rfis" data-testid="tabs-portal">
          <TabsList data-testid="tabs-list">
            <TabsTrigger value="rfis" data-testid="tab-rfis">
              <FileText className="h-4 w-4 mr-1.5" />
              RFIs
            </TabsTrigger>
            <TabsTrigger value="submittals" data-testid="tab-submittals">
              <FolderOpen className="h-4 w-4 mr-1.5" />
              Submittals
            </TabsTrigger>
            <TabsTrigger value="transmittals" data-testid="tab-transmittals">
              <Send className="h-4 w-4 mr-1.5" />
              Transmittals
            </TabsTrigger>
            <TabsTrigger value="chat" data-testid="tab-chat">
              <MessageSquare className="h-4 w-4 mr-1.5" />
              Chat
              {chatThreads.some((t: any) => t.portalUnreadCount > 0) && (
                <span className="ml-1 inline-flex items-center justify-center h-4 min-w-[1rem] rounded-full bg-destructive text-destructive-foreground text-xs px-1">
                  {chatThreads.reduce((sum: number, t: any) => sum + (t.portalUnreadCount || 0), 0)}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="rfis" data-testid="content-rfis">
            <SubPortalRfiTab rfis={rfis} rfisLoading={rfisLoading} token={token} />
          </TabsContent>

          <TabsContent value="submittals" data-testid="content-submittals">
            <SubPortalSubmittalTab submittals={submittals} submittalsLoading={submittalsLoading} token={token} />
          </TabsContent>

          <TabsContent value="transmittals" data-testid="content-transmittals">
            <SubPortalTransmittalTab transmittals={transmittals} transmittalsLoading={transmittalsLoading} token={token} />
          </TabsContent>

          <TabsContent value="chat" data-testid="content-chat">
            <SubPortalChatTab token={token} chatThreads={chatThreads} chatLoading={chatLoading} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
