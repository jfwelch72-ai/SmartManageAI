import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Link2, Unlink, RefreshCw, Settings, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface Provider {
  key: string;
  displayName: string;
  authType: string;
  featureFlag: string;
}

interface Connection {
  id: string;
  provider: string;
  displayName: string | null;
  status: "pending" | "active" | "disconnected" | "error";
  lastSyncAt: string | null;
  lastSyncError: string | null;
  createdAt: string;
}

const PROVIDER_DESCRIPTIONS: Record<string, string> = {
  qbo: "Sync invoices, customers, and chart of accounts with QuickBooks Online.",
  google: "Connect Gmail and Google Calendar for email ingestion and scheduling.",
  microsoft: "Integrate Outlook mail and Microsoft 365 Calendar.",
  docusign: "Send contracts and change orders for electronic signature.",
};

export default function IntegrationsPage() {
  const { toast } = useToast();

  const { data: providers, isLoading: providersLoading } = useQuery<Provider[]>({
    queryKey: ["/api/integrations/providers"],
  });

  const { data: connections, isLoading: connectionsLoading } = useQuery<Connection[]>({
    queryKey: ["/api/integrations/connections"],
  });

  const connectMutation = useMutation({
    mutationFn: async (providerKey: string) => {
      const res = await apiRequest("POST", `/api/integrations/connections`, { provider: providerKey });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Connected", description: "Integration connection created. Authorize to complete setup." });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/providers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/connections"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
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

  const isLoading = providersLoading || connectionsLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const getConnectionForProvider = (providerKey: string) =>
    (connections || []).find(c => c.provider === providerKey && c.status !== "disconnected");

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-integrations-title">Integrations Hub</h1>
        <p className="text-muted-foreground" data-testid="text-integrations-description">
          Connect your favorite tools and services to streamline your workflow
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {(providers || []).map((provider) => {
          const conn = getConnectionForProvider(provider.key);
          const isConnected = conn?.status === "active";
          return (
            <Card key={provider.key} data-testid={`card-provider-${provider.key}`}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {isConnected ? (
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    ) : (
                      <XCircle className="h-5 w-5 text-muted-foreground" />
                    )}
                    <CardTitle className="text-base">{provider.displayName}</CardTitle>
                  </div>
                  <Badge variant={isConnected ? "default" : "secondary"} data-testid={`badge-provider-status-${provider.key}`}>
                    {isConnected ? "Connected" : conn ? conn.status : "Disconnected"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">{PROVIDER_DESCRIPTIONS[provider.key] || provider.displayName}</p>
                {conn ? (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => disconnectMutation.mutate(conn.id)}
                    disabled={disconnectMutation.isPending}
                    data-testid={`button-disconnect-${provider.key}`}
                  >
                    {disconnectMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Unlink className="h-4 w-4 mr-2" />
                    )}
                    Disconnect
                  </Button>
                ) : (
                  <Button
                    className="w-full"
                    onClick={() => connectMutation.mutate(provider.key)}
                    disabled={connectMutation.isPending}
                    data-testid={`button-connect-${provider.key}`}
                  >
                    {connectMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Link2 className="h-4 w-4 mr-2" />
                    )}
                    Connect
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Separator />

      <div className="space-y-4">
        <h2 className="text-xl font-semibold" data-testid="text-connections-heading">Active Connections</h2>
        {(connections || []).filter(c => c.status !== "disconnected").length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center">
              <Link2 className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground" data-testid="text-no-connections">No active connections yet. Connect a provider above to get started.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {(connections || []).filter(c => c.status !== "disconnected").map((connection) => (
              <Card key={connection.id} data-testid={`card-connection-${connection.id}`}>
                <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
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
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={connection.status === "active" ? "default" : connection.status === "error" ? "destructive" : "secondary"}
                      data-testid={`badge-connection-status-${connection.id}`}
                    >
                      {connection.status}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
