import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertCircle, AlertTriangle, Clock, Loader2, RefreshCw,
  Users, FileText, Banknote, Settings as SettingsIcon, ExternalLink,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Connection } from "./types";

// Task #1942 — When the "QuickBooks sync gave up" admin email's CTA
// deep-links to /integrations#qbo-sync-retry-<syncStateId>, read the
// hash on mount (and on hash changes) so the targeted row both scrolls
// into view and renders a brief ring highlight, mirroring the generic
// SyncRetryPanel anchor behaviour from Task #1414.
function useQboSyncRetryHashAnchor(): { focusedId: string | null } {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  useEffect(() => {
    function syncFromHash() {
      const hash = typeof window !== "undefined" ? window.location.hash : "";
      const match = /^#qbo-sync-retry-(.+)$/.exec(hash);
      setFocusedId(match ? decodeURIComponent(match[1]) : null);
    }
    syncFromHash();
    if (typeof window === "undefined") return;
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, []);
  return { focusedId };
}

type Kind = "customer" | "invoice" | "pay_run" | "scheduled_op";

interface QboSyncRetry {
  id: string;
  entityType: string;
  kind: Kind;
  label: string;
  itemId: string | null;
  displayName: string | null;
  link: string | null;
  lastError: string | null;
  lastAttemptAt: string | null;
  retryCount: number;
  nextRetryAt: string | null;
  exhausted: boolean;
}

interface QboSyncRetryResponse {
  connectionId: string;
  provider: string;
  maxRetries: number;
  retries: QboSyncRetry[];
}

const KIND_META: Record<Kind, { title: string; icon: typeof Users }> = {
  customer: { title: "Customer syncs", icon: Users },
  invoice: { title: "Invoice syncs", icon: FileText },
  pay_run: { title: "Pay-run syncs", icon: Banknote },
  scheduled_op: { title: "Scheduled operations", icon: SettingsIcon },
};

const KIND_ORDER: Kind[] = ["customer", "invoice", "pay_run", "scheduled_op"];

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  const now = Date.now();
  const diffMs = date.getTime() - now;
  const absMin = Math.round(Math.abs(diffMs) / 60_000);
  const absHr = Math.round(Math.abs(diffMs) / 3_600_000);
  if (diffMs < 0) {
    if (absMin < 1) return "just now";
    if (absMin < 60) return `${absMin}m ago`;
    if (absHr < 24) return `${absHr}h ago`;
    return date.toLocaleString();
  }
  if (absMin < 1) return "any moment";
  if (absMin < 60) return `in ${absMin}m`;
  if (absHr < 24) return `in ${absHr}h`;
  return date.toLocaleString();
}

export function QboSyncRetryPanel({ connection }: { connection: Connection }) {
  const { toast } = useToast();
  const { focusedId } = useQboSyncRetryHashAnchor();
  const focusedRowRef = useRef<HTMLDivElement | null>(null);
  const lastScrolledIdRef = useRef<string | null>(null);

  const { data, isLoading } = useQuery<QboSyncRetryResponse>({
    queryKey: ["/api/integrations/connections", connection.id, "qbo-sync-retries"],
    enabled: connection.status === "active" && connection.provider === "qbo",
    refetchInterval: 30_000,
  });

  // Scroll the email-deep-linked row into view once it's rendered.
  // Depending on `data` (in addition to `focusedId`) ensures the scroll
  // re-fires when the rows finish loading after mount, so the hash
  // anchor isn't lost to a render-vs-effect race.
  useEffect(() => {
    if (!focusedId) return;
    if (lastScrolledIdRef.current === focusedId) return;
    if (focusedRowRef.current) {
      focusedRowRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
      lastScrolledIdRef.current = focusedId;
    }
  }, [focusedId, data]);

  const retryMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/integrations/sync-retries/${id}/retry-now`);
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Retry queued",
        description: "Will run on the next sweep (within ~5 minutes).",
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/integrations/connections", connection.id, "qbo-sync-retries"],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/sync-retries"] });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to queue retry", description: err.message, variant: "destructive" });
    },
  });

  if (connection.provider !== "qbo") return null;

  if (isLoading) {
    return (
      <Card data-testid="card-qbo-sync-retries-loading">
        <CardContent className="py-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading QuickBooks retry status...
        </CardContent>
      </Card>
    );
  }

  const retries = data?.retries ?? [];
  if (retries.length === 0) return null;

  const exhaustedCount = retries.filter(r => r.exhausted).length;
  const groups = new Map<Kind, QboSyncRetry[]>();
  for (const r of retries) {
    const list = groups.get(r.kind) ?? [];
    list.push(r);
    groups.set(r.kind, list);
  }

  return (
    <Card data-testid="card-qbo-sync-retries">
      <CardHeader>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2" data-testid="text-qbo-sync-retries-title">
              <AlertCircle className="h-5 w-5 text-amber-500" />
              Failing QuickBooks syncs
              <Badge variant="secondary" data-testid="badge-qbo-sync-retries-count">
                {retries.length}
              </Badge>
            </CardTitle>
            <CardDescription>
              These syncs are mid-retry or have exhausted their auto-retry budget. Retries run automatically every few minutes; use "Retry now" to re-arm an exhausted row.
            </CardDescription>
          </div>
          {exhaustedCount > 0 && (
            <Badge variant="destructive" data-testid="badge-qbo-sync-retries-exhausted">
              {exhaustedCount} need manual attention
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {KIND_ORDER.filter(kind => groups.has(kind)).map(kind => {
          const list = groups.get(kind)!;
          const meta = KIND_META[kind];
          const Icon = meta.icon;
          const groupExhausted = list.filter(r => r.exhausted).length;
          return (
            <div key={kind} className="space-y-2" data-testid={`group-qbo-sync-retries-${kind}`}>
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-muted-foreground" />
                <h4 className="font-medium text-sm" data-testid={`text-qbo-sync-group-title-${kind}`}>
                  {meta.title}
                </h4>
                <Badge variant="outline" data-testid={`badge-qbo-sync-group-count-${kind}`}>
                  {list.length}
                </Badge>
                {groupExhausted > 0 && (
                  <Badge
                    variant="destructive"
                    className="text-xs"
                    data-testid={`badge-qbo-sync-group-exhausted-${kind}`}
                  >
                    {groupExhausted} exhausted
                  </Badge>
                )}
              </div>
              <div className="space-y-2">
                {list.map(retry => {
                  const isPending =
                    retryMutation.isPending && retryMutation.variables === retry.id;
                  const isFocused = focusedId === retry.id;
                  return (
                    <div
                      key={retry.id}
                      id={`qbo-sync-retry-${retry.id}`}
                      ref={isFocused ? focusedRowRef : undefined}
                      className={
                        "border rounded-lg p-3 space-y-2 scroll-mt-24 transition-shadow" +
                        (retry.exhausted
                          ? " border-destructive/50 bg-destructive/5"
                          : "") +
                        (isFocused
                          ? " ring-2 ring-amber-500 ring-offset-2 dark:ring-offset-background"
                          : "")
                      }
                      data-testid={`row-qbo-sync-retry-${retry.id}`}
                    >
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="space-y-1 min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            {retry.displayName && retry.link && retry.exhausted ? (
                              <Link
                                href={retry.link}
                                className="font-medium text-sm truncate inline-flex items-center gap-1 underline-offset-2 hover:underline"
                                data-testid={`link-qbo-retry-${retry.id}`}
                              >
                                <span data-testid={`text-qbo-retry-label-${retry.id}`}>
                                  {retry.displayName}
                                </span>
                                <ExternalLink className="h-3 w-3 opacity-70" />
                              </Link>
                            ) : retry.displayName ? (
                              <span
                                className="font-medium text-sm truncate"
                                data-testid={`text-qbo-retry-label-${retry.id}`}
                              >
                                {retry.displayName}
                              </span>
                            ) : (
                              <span
                                className="font-medium text-sm truncate"
                                data-testid={`text-qbo-retry-label-${retry.id}`}
                              >
                                {retry.label}
                              </span>
                            )}
                            {retry.displayName && retry.itemId && (
                              <span
                                className="text-xs font-mono text-muted-foreground truncate"
                                data-testid={`text-qbo-retry-id-${retry.id}`}
                              >
                                {retry.itemId}
                              </span>
                            )}
                            {retry.exhausted ? (
                              <Badge
                                variant="destructive"
                                className="gap-1"
                                data-testid={`badge-qbo-retry-exhausted-${retry.id}`}
                              >
                                <AlertTriangle className="h-3 w-3" />
                                Manual attention needed
                              </Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                data-testid={`badge-qbo-retry-attempts-${retry.id}`}
                              >
                                Attempt {retry.retryCount} of {data?.maxRetries ?? retry.retryCount}
                              </Badge>
                            )}
                          </div>
                          {retry.lastError && (
                            <p
                              className="text-xs text-muted-foreground line-clamp-2"
                              data-testid={`text-qbo-retry-error-${retry.id}`}
                            >
                              {retry.lastError}
                            </p>
                          )}
                          <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                            <span data-testid={`text-qbo-retry-last-${retry.id}`}>
                              Last attempt: {formatRelative(retry.lastAttemptAt)}
                            </span>
                            {!retry.exhausted && retry.nextRetryAt && (
                              <span
                                className="flex items-center gap-1"
                                data-testid={`text-qbo-retry-next-${retry.id}`}
                              >
                                <Clock className="h-3 w-3" />
                                Next: {formatRelative(retry.nextRetryAt)}
                              </span>
                            )}
                            {retry.exhausted && (
                              <span data-testid={`text-qbo-retry-no-next-${retry.id}`}>
                                Auto-retry paused
                              </span>
                            )}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant={retry.exhausted ? "default" : "outline"}
                          onClick={() => retryMutation.mutate(retry.id)}
                          disabled={isPending}
                          data-testid={`button-qbo-retry-now-${retry.id}`}
                        >
                          {isPending ? (
                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                          ) : (
                            <RefreshCw className="h-3 w-3 mr-1" />
                          )}
                          Retry now
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
