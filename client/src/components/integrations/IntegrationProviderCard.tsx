import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CheckCircle, XCircle, Loader2, Link2, Unlink,
  ChevronDown, ChevronUp, Shield, ShieldCheck, ShieldAlert,
  Lock, KeyRound, Info, BellOff, BellRing, RotateCcw,
} from "lucide-react";
import type { Connection, Provider, SecurityAuditEntry, SuppressedFailuresResponse, SuppressionResetsResponse, SuppressionResetItem, PROVIDER_DESCRIPTIONS as _PD } from "./types";
import { PROVIDER_DESCRIPTIONS } from "./types";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type NotificationPreferencesResponse = {
  typeOverrides?: Array<{
    notificationType: string;
    emailEnabled?: boolean | null;
    inAppEnabled?: boolean | null;
  }>;
};

/**
 * Task #1379 — Mapping of provider key → notification type whose email
 * mute should surface as a badge on that provider's card. The anchor
 * id is the DOM id of the matching toggle row in
 * /settings/notifications, so the badge can deep-link straight to it.
 *
 * Davis-Bacon (Task #1361) is the original case. The generic
 * `INTEGRATION_SYNC_RETRIES_EXHAUSTED` notification fans out for every
 * other auto-sync provider (QuickBooks, STACK CT, Zapier, …), so they
 * all share the same anchor and notification type.
 */
const INTEGRATION_SYNC_EXHAUSTED_ANCHOR =
  "section-integration-sync-retries-exhausted-prefs";

export const PROVIDER_ALERTS_MUTED_CONFIG: Record<
  string,
  { notificationType: string; anchorId: string }
> = {
  dol_davis_bacon: {
    notificationType: "DAVIS_BACON_AUTO_SYNC_FAILED",
    anchorId: "section-davis-bacon-auto-sync-failed-prefs",
  },
  qbo: {
    notificationType: "INTEGRATION_SYNC_RETRIES_EXHAUSTED",
    anchorId: INTEGRATION_SYNC_EXHAUSTED_ANCHOR,
  },
  stackct: {
    notificationType: "INTEGRATION_SYNC_RETRIES_EXHAUSTED",
    anchorId: INTEGRATION_SYNC_EXHAUSTED_ANCHOR,
  },
  zapier: {
    notificationType: "INTEGRATION_SYNC_RETRIES_EXHAUSTED",
    anchorId: INTEGRATION_SYNC_EXHAUSTED_ANCHOR,
  },
};

export function IntegrationAlertsMutedBadge({
  providerKey,
}: {
  providerKey: string;
}) {
  const config = PROVIDER_ALERTS_MUTED_CONFIG[providerKey];
  const { data } = useQuery<NotificationPreferencesResponse>({
    queryKey: ["/api/notifications/preferences"],
    enabled: !!config,
  });
  if (!config) return null;
  const override = data?.typeOverrides?.find(
    (o) => o.notificationType === config.notificationType,
  );
  const muted = !!override && override.emailEnabled === false;
  if (!muted) return null;
  return (
    <a
      href={`/settings/notifications#${config.anchorId}`}
      className="inline-flex"
      data-testid={`link-${providerKey}-alerts-muted`}
    >
      <Badge
        variant="outline"
        className="gap-1 cursor-pointer hover-elevate"
        data-testid={`badge-${providerKey}-alerts-muted`}
      >
        <BellOff className="h-3 w-3" />
        Failure alerts muted
      </Badge>
    </a>
  );
}

/**
 * Task #1361 — Thin wrapper kept for any external callers that still
 * import the Davis-Bacon-specific badge by name.
 */
export function DavisBaconAlertsMutedBadge() {
  return <IntegrationAlertsMutedBadge providerKey="dol_davis_bacon" />;
}

/**
 * Task #1384 — Real-time visibility for admins managing an active
 * SAM.gov outage. Renders a small panel listing each (decision,
 * suppressed-count, suppressed-since) so they can see how noisy the
 * upstream is *without* having to wait for the next coalesced email.
 *
 * The list is filtered to the given connection so a multi-connection
 * org (rare today, but possible) doesn't see another connection's
 * decisions on this card. Hides itself when there's nothing to show.
 */
export function DavisBaconSuppressedFailuresPanel({
  connectionId,
}: {
  connectionId: string;
}) {
  const { data } = useQuery<SuppressedFailuresResponse>({
    queryKey: ["/api/integrations/davis-bacon/suppressed-failures"],
    refetchInterval: 30_000,
  });
  // Task #1442 — recent suppression-reset audit history for the org so
  // we can show "Last reset by Jane 4 minutes ago" on each row, which
  // stops two admins from racing each other on the same decision
  // during an active outage.
  const { data: resetsData } = useQuery<SuppressionResetsResponse>({
    queryKey: ["/api/integrations/davis-bacon/suppression-resets"],
    refetchInterval: 30_000,
  });
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const resetMutation = useMutation({
    mutationFn: async (decisionNumber: string) => {
      const res = await apiRequest(
        "POST",
        "/api/integrations/davis-bacon/suppressed-failures/reset",
        { connectionId, decisionNumber },
      );
      return res.json() as Promise<{ success: boolean; cleared: boolean }>;
    },
    onSuccess: (data, decisionNumber) => {
      // Distinguish a real reset from a no-op (e.g. the row's persisted
      // suppression already expired between the panel render and the click)
      // so admins know whether their click actually changed state.
      toast({
        title: data?.cleared
          ? "Suppression window reset"
          : "No active suppression to reset",
        description: data?.cleared
          ? `Next failure for ${decisionNumber} will be delivered immediately.`
          : `${decisionNumber} no longer had a persisted suppression window.`,
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/integrations/davis-bacon/suppressed-failures"],
      });
      // Task #1442 — also refresh the reset history so the just-clicked
      // row immediately shows "Last reset by you a few seconds ago".
      queryClient.invalidateQueries({
        queryKey: ["/api/integrations/davis-bacon/suppression-resets"],
      });
    },
    onError: (err: unknown) => {
      toast({
        title: "Reset failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    },
  });
  const resetAllMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        "/api/integrations/davis-bacon/suppressed-failures/reset-all",
        { connectionId },
      );
      return res.json() as Promise<{
        success: boolean;
        cleared: number;
        decisionNumbers: string[];
      }>;
    },
    onSuccess: (data) => {
      const cleared = data?.cleared ?? 0;
      toast({
        title:
          cleared > 0
            ? `Reset ${cleared} suppression ${cleared === 1 ? "row" : "rows"}`
            : "No active suppressions to reset",
        description:
          cleared > 0
            ? "The next failure on each decision will be delivered immediately."
            : "Every shown row had already cleared its suppression window.",
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/integrations/davis-bacon/suppressed-failures"],
      });
      setConfirmOpen(false);
    },
    onError: (err: unknown) => {
      toast({
        title: "Reset all failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    },
  });
  const items = (data?.items ?? []).filter((i) => i.connectionId === connectionId);
  if (items.length === 0) return null;

  // Pre-index the most recent reset per (connection, decision) so each
  // row lookup is O(1). The server returns entries newest-first, so the
  // first match wins.
  const latestResetByDecision: Record<string, SuppressionResetItem> = {};
  for (const r of resetsData?.items ?? []) {
    if (r.connectionId !== connectionId) continue;
    if (latestResetByDecision[r.decisionNumber]) continue;
    latestResetByDecision[r.decisionNumber] = r;
  }

  const totalSuppressed = items.reduce((acc, i) => acc + i.suppressedCount, 0);
  const earliestSince = items.reduce<number | null>((acc, i) => {
    const ts = i.suppressedSince ?? i.lastNotifiedAt;
    if (!ts) return acc;
    if (acc === null || ts < acc) return ts;
    return acc;
  }, null);

  return (
    <div
      className="rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/30 px-3 py-2 text-xs space-y-1.5"
      data-testid={`panel-davis-bacon-suppressed-failures-${connectionId}`}
    >
      <div className="flex items-center justify-between gap-2 text-amber-800 dark:text-amber-300 font-medium">
        <div className="flex items-center gap-1.5 min-w-0">
          <BellRing className="h-3.5 w-3.5 shrink-0" />
          <span
            className="truncate"
            data-testid={`text-davis-bacon-suppressed-summary-${connectionId}`}
          >
            {totalSuppressed === 1
              ? "1 failure alert suppressed"
              : `${totalSuppressed} failure alerts suppressed`}
            {earliestSince ? ` since ${new Date(earliestSince).toLocaleString()}` : ""}
          </span>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-2 text-xs gap-1 shrink-0"
          disabled={resetAllMutation.isPending}
          onClick={() => setConfirmOpen(true)}
          data-testid={`button-davis-bacon-reset-all-suppressions-${connectionId}`}
          title="Force-deliver the next failure on every shown decision"
        >
          {resetAllMutation.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RotateCcw className="h-3 w-3" />
          )}
          Reset all
        </Button>
      </div>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent
          data-testid={`dialog-davis-bacon-reset-all-confirm-${connectionId}`}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Reset every suppression row?</AlertDialogTitle>
            <AlertDialogDescription>
              This clears the 1-hour coalescing window on all{" "}
              {items.length === 1 ? "1 decision" : `${items.length} decisions`} listed
              above. The next failure on each decision will be delivered immediately
              instead of being absorbed for the rest of the window — expect a burst
              of email/in-app alerts if SAM.gov is still failing.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              data-testid={`button-davis-bacon-reset-all-cancel-${connectionId}`}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={resetAllMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                resetAllMutation.mutate();
              }}
              data-testid={`button-davis-bacon-reset-all-confirm-${connectionId}`}
            >
              {resetAllMutation.isPending ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : null}
              Reset all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* Task #1442 — bumped from space-y-0.5 to space-y-1 to give each
          row room for its "Last reset by X at Y" sub-line. */}
      <ul className="space-y-1 text-amber-700 dark:text-amber-400">
        {items.map((i) => {
          const since = i.suppressedSince ?? i.lastNotifiedAt;
          const lastReset = latestResetByDecision[i.decisionNumber];
          return (
            <li
              key={i.decisionNumber}
              className="space-y-0.5"
              data-testid={`row-davis-bacon-suppressed-${i.decisionNumber}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono truncate">{i.decisionNumber}</span>
                <span className="shrink-0 flex items-center gap-2">
                  <span>
                    <span data-testid={`text-davis-bacon-suppressed-count-${i.decisionNumber}`}>
                      {i.suppressedCount}
                    </span>
                    {since ? (
                      <>
                        {" since "}
                        <span data-testid={`text-davis-bacon-suppressed-since-${i.decisionNumber}`}>
                          {new Date(since).toLocaleString()}
                        </span>
                      </>
                    ) : null}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-xs gap-1"
                    disabled={
                      resetMutation.isPending &&
                      resetMutation.variables === i.decisionNumber
                    }
                    onClick={() => resetMutation.mutate(i.decisionNumber)}
                    data-testid={`button-davis-bacon-reset-suppression-${i.decisionNumber}`}
                    title="Force-deliver the next failure now instead of waiting for the 1h window to expire"
                  >
                    {resetMutation.isPending &&
                    resetMutation.variables === i.decisionNumber ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RotateCcw className="h-3 w-3" />
                    )}
                    Reset
                  </Button>
                </span>
              </div>
              {lastReset ? (
                <div
                  className="pl-1 text-[11px] text-amber-600/80 dark:text-amber-500/80"
                  data-testid={`text-davis-bacon-last-reset-${i.decisionNumber}`}
                >
                  Last reset by{" "}
                  <span className="font-medium">
                    {lastReset.userName ?? "another admin"}
                  </span>
                  {" at "}
                  {new Date(lastReset.timestamp).toLocaleString()}
                  {lastReset.cleared ? "" : " (no active suppression)"}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

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
  onAuthorize,
  connectPending,
  disconnectPending,
}: {
  providers: Provider[];
  connections: Connection[];
  onConnect: (providerKey: string) => void;
  onDisconnect: (connectionId: string) => void;
  onAuthorize?: (connectionId: string) => void;
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
        const isPending = conn?.status === "pending";
        const isOAuth = provider.authType === "oauth";
        return (
          <Card key={provider.key} data-testid={`card-provider-${provider.key}`}>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {isConnected ? (
                    <CheckCircle className="h-5 w-5 text-green-500" />
                  ) : isPending ? (
                    <Info className="h-5 w-5 text-yellow-500" />
                  ) : (
                    <XCircle className="h-5 w-5 text-muted-foreground" />
                  )}
                  <CardTitle className="text-base">{provider.displayName}</CardTitle>
                </div>
                <Badge
                  variant={isConnected ? "default" : isPending ? "outline" : "secondary"}
                  data-testid={`badge-provider-status-${provider.key}`}
                >
                  {isConnected ? "Connected" : conn ? conn.status : "Disconnected"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">{PROVIDER_DESCRIPTIONS[provider.key] || provider.displayName}</p>
              {isConnected && conn && (
                <TokenStatusBadge status={conn.tokenStatus} encrypted={conn.tokensEncrypted} />
              )}
              {PROVIDER_ALERTS_MUTED_CONFIG[provider.key] && (
                <IntegrationAlertsMutedBadge providerKey={provider.key} />
              )}
              {provider.key === "dol_davis_bacon" && conn && (
                <DavisBaconSuppressedFailuresPanel connectionId={conn.id} />
              )}
              {isPending && isOAuth && (
                <p className="text-xs text-yellow-600 dark:text-yellow-400">
                  {provider.key === "sage_intacct"
                    ? "Credentials required — click below to enter Web Services details."
                    : "Authorization required — click below to complete setup."}
                </p>
              )}
              {conn ? (
                <div className="flex flex-col gap-2">
                  {isPending && isOAuth && onAuthorize && (
                    <Button
                      className="w-full"
                      onClick={() => onAuthorize(conn.id)}
                      data-testid={`button-authorize-${provider.key}`}
                    >
                      <Link2 className="h-4 w-4 mr-2" />
                      {provider.key === "sage_intacct" ? "Configure credentials" : "Authorize"}
                    </Button>
                  )}
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
                </div>
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
