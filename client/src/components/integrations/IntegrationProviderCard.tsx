import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CheckCircle, XCircle, Loader2, Link2, Unlink,
  ChevronDown, ChevronUp, Shield, ShieldCheck, ShieldAlert,
  Lock, KeyRound, Info,
} from "lucide-react";
import type { Connection, Provider, SecurityAuditEntry, PROVIDER_DESCRIPTIONS as _PD } from "./types";
import { PROVIDER_DESCRIPTIONS } from "./types";

export function SecurityBanner() {
  const [expanded, setExpanded] = useState(false);
  return (
    <Card className="border-green-200 dark:border-green-900 bg-green-50/50 dark:bg-green-950/20" data-testid="card-security-banner">
      <CardContent className="py-3 px-4">
        <button
          className="w-full flex items-center justify-between text-left"
          onClick={() => setExpanded(!expanded)}
          data-testid="button-toggle-security-banner"
        >
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-green-600 dark:text-green-400 shrink-0" />
            <span className="font-medium text-sm text-green-800 dark:text-green-300">Integration Security Active</span>
          </div>
          {expanded ? <ChevronUp className="h-4 w-4 text-green-600" /> : <ChevronDown className="h-4 w-4 text-green-600" />}
        </button>
        {expanded && (
          <div className="mt-3 space-y-2 text-sm text-green-700 dark:text-green-400">
            <div className="flex items-center gap-2">
              <Lock className="h-4 w-4 shrink-0" />
              <span>All integration credentials are encrypted at rest using AES-256-GCM</span>
            </div>
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 shrink-0" />
              <span>Tokens are never exposed to your browser — only metadata is transmitted</span>
            </div>
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 shrink-0" />
              <span>Access is restricted to administrators only</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function TokenStatusBadge({ status, encrypted }: { status?: string; encrypted?: boolean }) {
  if (status === "valid") {
    return (
      <div className="flex items-center gap-1.5" data-testid="badge-token-valid">
        <ShieldCheck className="h-3.5 w-3.5 text-green-500" />
        <span className="text-xs text-green-600 dark:text-green-400 font-medium">
          {encrypted ? "Encrypted" : "Valid"}
        </span>
      </div>
    );
  }
  if (status === "expired") {
    return (
      <div className="flex items-center gap-1.5" data-testid="badge-token-expired">
        <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
        <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">Expired</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5" data-testid="badge-token-missing">
      <Shield className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-xs text-muted-foreground">No Token</span>
    </div>
  );
}

export function SecurityDetailsPanel({ connection }: { connection: Connection }) {
  const [expanded, setExpanded] = useState(false);
  const meta = connection.metadata || {};

  return (
    <div className="mt-2" data-testid={`panel-security-details-${connection.id}`}>
      <button
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setExpanded(!expanded)}
        data-testid={`button-toggle-security-details-${connection.id}`}
      >
        <Info className="h-3 w-3" />
        <span>Security Details</span>
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {expanded && (
        <div className="mt-2 p-3 bg-muted/50 rounded-lg text-xs space-y-1.5" data-testid={`security-details-content-${connection.id}`}>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Encryption</span>
            <span className="font-medium">{connection.tokensEncrypted ? "AES-256-GCM" : "N/A"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Token Status</span>
            <span className="font-medium capitalize">{connection.tokenStatus || "unknown"}</span>
          </div>
          {meta.expiresAt && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Token Expiry</span>
              <span className="font-medium">{new Date(meta.expiresAt).toLocaleString()}</span>
            </div>
          )}
          {meta.scope && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Scopes</span>
              <span className="font-medium truncate max-w-[200px]">{meta.scope}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">Created</span>
            <span className="font-medium">{new Date(connection.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function SecurityAuditPanel() {
  const [expanded, setExpanded] = useState(false);

  const { data: auditEntries, isLoading } = useQuery<SecurityAuditEntry[]>({
    queryKey: ["/api/integrations/security-log"],
    enabled: expanded,
  });

  const ACTION_LABELS: Record<string, string> = {
    "security.tokens_encrypted": "Tokens Encrypted",
    "security.tokens_cleared": "Tokens Cleared",
    "security.token_refresh_success": "Token Refreshed",
    "security.token_refresh_failed": "Token Refresh Failed",
    "security.auth_attempt_failed": "Auth Attempt Failed",
    "security.credentials_changed": "Credentials Changed",
    "connection.authorized": "Connection Authorized",
    "connection.disconnected": "Connection Disconnected",
  };

  return (
    <Card data-testid="card-security-audit">
      <CardHeader className="pb-3">
        <button
          className="flex items-center justify-between w-full text-left"
          onClick={() => setExpanded(!expanded)}
          data-testid="button-toggle-security-audit"
        >
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Security Log</CardTitle>
          </div>
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        <CardDescription>Security events for integration credentials</CardDescription>
      </CardHeader>
      {expanded && (
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !auditEntries?.length ? (
            <div className="py-6 text-center">
              <Shield className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm text-muted-foreground" data-testid="text-no-security-events">No security events recorded yet.</p>
            </div>
          ) : (
            <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
              {auditEntries.map((entry, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-muted/50 text-sm"
                  data-testid={`security-log-entry-${idx}`}
                >
                  <div className="flex items-center gap-2">
                    {entry.success ? (
                      <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
                    )}
                    <span className="font-medium">{ACTION_LABELS[entry.action] || entry.action}</span>
                    {entry.provider && (
                      <Badge variant="outline" className="text-xs">{entry.provider}</Badge>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(entry.timestamp).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

export function ProviderCardGrid({
  providers,
  connections,
  onConnect,
  onDisconnect,
  connectPending,
  disconnectPending,
}: {
  providers: Provider[];
  connections: Connection[];
  onConnect: (providerKey: string) => void;
  onDisconnect: (connectionId: string) => void;
  connectPending: boolean;
  disconnectPending: boolean;
}) {
  const getConnectionForProvider = (providerKey: string) =>
    connections.find(c => c.provider === providerKey && c.status !== "disconnected");

  return (
    <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
      {providers.map((provider) => {
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
              {isConnected && conn && (
                <TokenStatusBadge status={conn.tokenStatus} encrypted={conn.tokensEncrypted} />
              )}
              {conn ? (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => onDisconnect(conn.id)}
                  disabled={disconnectPending}
                  data-testid={`button-disconnect-${provider.key}`}
                >
                  {disconnectPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Unlink className="h-4 w-4 mr-2" />
                  )}
                  Disconnect
                </Button>
              ) : (
                <Button
                  className="w-full"
                  onClick={() => onConnect(provider.key)}
                  disabled={connectPending}
                  data-testid={`button-connect-${provider.key}`}
                >
                  {connectPending ? (
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
  );
}
