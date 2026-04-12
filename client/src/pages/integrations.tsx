import { useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Link2, FileText, Loader2, Settings, Zap, HardHat, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Provider, Connection } from "@/components/integrations/types";
import { SecurityBanner, ProviderCardGrid, TokenStatusBadge, SecurityDetailsPanel, SecurityAuditPanel } from "@/components/integrations/IntegrationProviderCard";
import { IntegrationSyncPanel } from "@/components/integrations/IntegrationSyncPanel";
import { AccountMappingPanel, SyncSchedulePanel } from "@/components/integrations/QboMappingPanel";
import { WebhookConfigPanel } from "@/components/integrations/WebhookConfigPanel";
import { StackCTSyncPanel } from "@/components/integrations/StackCTSyncPanel";
import { Badge } from "@/components/ui/badge";

function StackCTConnectButton() {
  const { toast } = useToast();
  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/integrations/connections", {
        provider: "stackct",
        displayName: "STACK CT",
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "STACK CT Connection Created", description: "Enter your credentials to complete setup." });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/connections"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  return (
    <Button
      onClick={() => createMutation.mutate()}
      disabled={createMutation.isPending}
      data-testid="button-connect-stackct"
    >
      {createMutation.isPending ? (
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
      ) : (
        <Plus className="h-4 w-4 mr-2" />
      )}
      Connect STACK CT
    </Button>
  );
}

export default function IntegrationsPage({ embedded }: { embedded?: boolean } = {}) {
  const { toast } = useToast();

  const { data: providers, isLoading: providersLoading } = useQuery<Provider[]>({
    queryKey: ["/api/integrations/providers"],
  });

  const { data: connections, isLoading: connectionsLoading } = useQuery<Connection[]>({
    queryKey: ["/api/integrations/connections"],
  });

  const connectMutation = useMutation({
    mutationFn: async (providerKey: string) => {
      const provider = (providers || []).find(p => p.key === providerKey);
      const isOAuth = provider?.authType === "oauth";

      const res = await apiRequest("POST", `/api/integrations/connections`, {
        provider: providerKey,
        ...(isOAuth ? {} : { devMode: true }),
      });
      const connection = await res.json();

      if (isOAuth && connection.id) {
        const authRes = await apiRequest("POST", `/api/integrations/connections/${connection.id}/authorize`);
        const { authUrl } = await authRes.json();
        if (authUrl) {
          window.location.href = authUrl;
          return null;
        }
      }

      return connection;
    },
    onSuccess: (data) => {
      if (data === null) return;
      toast({ title: "Connected", description: "Integration connected successfully." });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/providers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/connections"] });
    },
    onError: (error: Error) => {
      toast({ title: "Connection Error", description: error.message, variant: "destructive" });
    },
  });

  const authorizeMutation = useMutation({
    mutationFn: async (connectionId: string) => {
      const authRes = await apiRequest("POST", `/api/integrations/connections/${connectionId}/authorize`);
      const { authUrl } = await authRes.json();
      if (authUrl) {
        window.location.href = authUrl;
      }
      return null;
    },
    onError: (error: Error) => {
      toast({ title: "Authorization Error", description: error.message, variant: "destructive" });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async (connectionId: string) => {
      const res = await apiRequest("POST", `/api/integrations/connections/${connectionId}/disconnect`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Disconnected", description: "Integration disconnected." });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/providers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/connections"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected") === "true") {
      toast({ title: "Integration Connected", description: "OAuth authorization completed successfully." });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/providers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/connections"] });
      window.history.replaceState({}, "", window.location.pathname);
    } else if (params.get("error")) {
      toast({ title: "Connection Failed", description: "OAuth authorization failed. Please try again.", variant: "destructive" });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [toast]);

  const isLoading = providersLoading || connectionsLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const activeConnections = (connections || []).filter(c => c.status === "active");
  const qboConnection = activeConnections.find(c => c.provider === "qbo");
  const zapierConnection = activeConnections.find(c => c.provider === "zapier");
  const stackctConnection = (connections || []).find(c => c.provider === "stackct" && c.status !== "disconnected");

  return (
    <div className={embedded ? "space-y-6" : "px-3 sm:px-6 py-4 sm:py-6 space-y-6"}>
      {!embedded && (
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-integrations-title">Integrations Hub</h1>
          <p className="text-muted-foreground" data-testid="text-integrations-description">
            Connect your favorite tools and services to streamline your workflow
          </p>
        </div>
      )}

      <SecurityBanner />

      <ProviderCardGrid
        providers={providers || []}
        connections={connections || []}
        onConnect={(key) => connectMutation.mutate(key)}
        onDisconnect={(id) => disconnectMutation.mutate(id)}
        onAuthorize={(id) => authorizeMutation.mutate(id)}
        connectPending={connectMutation.isPending}
        disconnectPending={disconnectMutation.isPending}
      />

      <Separator />

      {qboConnection ? (
        <div className="space-y-4">
          <IntegrationSyncPanel connection={qboConnection} />
          <AccountMappingPanel connection={qboConnection} />
          <SyncSchedulePanel connection={qboConnection} />
        </div>
      ) : (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Accounting Sync</h2>
          <Card>
            <CardContent className="py-8 text-center">
              <FileText className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground" data-testid="text-no-qbo">
                Connect QuickBooks Online above to enable accounting sync operations.
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <Separator />

      {stackctConnection ? (
        <StackCTSyncPanel connection={stackctConnection} />
      ) : (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <HardHat className="h-5 w-5 text-blue-500" />
            STACK CT
          </h2>
          <Card>
            <CardContent className="py-8 text-center">
              <HardHat className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground mb-4" data-testid="text-no-stackct">
                Connect STACK CT to sync projects, plans, and takeoff/estimate data.
              </p>
              <StackCTConnectButton />
            </CardContent>
          </Card>
        </div>
      )}

      <Separator />

      {zapierConnection ? (
        <WebhookConfigPanel connection={zapierConnection} />
      ) : (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Zap className="h-5 w-5 text-orange-500" />
            Zapier Webhooks
          </h2>
          <Card>
            <CardContent className="py-8 text-center">
              <Zap className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground" data-testid="text-no-zapier">
                Connect Zapier above to configure webhook automations.
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <Separator />

      <div className="space-y-4">
        <h2 className="text-xl font-semibold" data-testid="text-connections-heading">Active Connections</h2>
        {activeConnections.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center">
              <Link2 className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground" data-testid="text-no-connections">No active connections yet. Connect a provider above to get started.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {activeConnections.map((connection) => (
              <Card key={connection.id} data-testid={`card-connection-${connection.id}`}>
                <CardContent className="py-4">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-primary/10">
                        <Settings className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium" data-testid={`text-connection-name-${connection.id}`}>{connection.displayName || connection.provider}</p>
                        <p className="text-sm text-muted-foreground" data-testid={`text-connection-sync-${connection.id}`}>
                          {connection.lastSyncAt
                            ? `Last synced: ${new Date(connection.lastSyncAt).toLocaleString()}`
                            : "Never synced"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <TokenStatusBadge status={connection.tokenStatus} encrypted={connection.tokensEncrypted} />
                      <Badge
                        variant={connection.status === "active" ? "default" : connection.status === "error" ? "destructive" : "secondary"}
                        data-testid={`badge-connection-status-${connection.id}`}
                      >
                        {connection.status}
                      </Badge>
                    </div>
                  </div>
                  <SecurityDetailsPanel connection={connection} />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <SecurityAuditPanel />
    </div>
  );
}
