import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ArrowLeft, RefreshCw, RotateCcw, Activity, Clock, FileText, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface GanttPdfStats {
  cachedBrowser: {
    present: boolean;
    connected: boolean;
    recycling: boolean;
    ageMs: number | null;
    pdfCount: number;
    inFlight: number;
  };
  limits: {
    maxPdfsPerBrowser: number;
    maxBrowserAgeMs: number;
    maxConcurrentRenders: number;
    maxQueueLength: number;
    queueWaitTimeoutMs: number;
  };
  queue: {
    activeRenders: number;
    queuedRenders: number;
  };
}

function formatDuration(ms: number | null): string {
  if (ms === null || ms === undefined) return "—";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

const HEALTH_KEY = ["/api/admin/gantt-pdf/health"] as const;

export default function GanttPdfHealth() {
  const { toast } = useToast();
  const { data, isLoading, isError, refetch, isFetching } = useQuery<GanttPdfStats>({
    queryKey: HEALTH_KEY,
    refetchInterval: 5000,
  });

  const recycleMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/gantt-pdf/recycle");
      return res.json();
    },
    onSuccess: (result: { recycled: boolean }) => {
      toast({
        title: result.recycled ? "Recycle requested" : "No active browser",
        description: result.recycled
          ? "The cached Chromium will retire after in-flight renders finish."
          : "There is no cached browser to recycle right now.",
      });
      queryClient.invalidateQueries({ queryKey: HEALTH_KEY });
    },
    onError: (err: Error) => {
      toast({
        title: "Recycle failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const queueDepth = data?.queue.queuedRenders ?? 0;
  const queueMax = data?.limits.maxQueueLength ?? 0;
  const queueBackedUp = queueMax > 0 && queueDepth >= Math.max(1, Math.floor(queueMax * 0.75));

  const cb = data?.cachedBrowser;
  const browserStatusBadge = (() => {
    if (!cb) return null;
    if (!cb.present) return <Badge variant="outline" data-testid="badge-browser-status">No cached browser</Badge>;
    if (cb.recycling) return <Badge variant="secondary" data-testid="badge-browser-status">Recycling</Badge>;
    if (!cb.connected) return <Badge variant="destructive" data-testid="badge-browser-status">Disconnected</Badge>;
    return <Badge data-testid="badge-browser-status">Connected</Badge>;
  })();

  return (
    <div className="container mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-3">
          <Link href="/admin">
            <Button variant="ghost" size="sm" data-testid="link-back-admin">
              <ArrowLeft className="h-4 w-4 mr-1" /> Back to admin
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-semibold" data-testid="text-page-title">Gantt PDF renderer health</h1>
            <p className="text-sm text-muted-foreground">
              Status of the cached Chromium instance used to export project Gantt PDFs.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-refresh"
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => recycleMutation.mutate()}
            disabled={recycleMutation.isPending || !cb?.present}
            data-testid="button-recycle"
          >
            <RotateCcw className={`h-4 w-4 mr-1 ${recycleMutation.isPending ? "animate-spin" : ""}`} />
            Recycle now
          </Button>
        </div>
      </div>

      {isError && (
        <Alert variant="destructive" data-testid="alert-error">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Failed to load renderer health</AlertTitle>
          <AlertDescription>Try refreshing or check server logs.</AlertDescription>
        </Alert>
      )}

      {queueBackedUp && (
        <Alert data-testid="alert-queue-backed-up">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Render queue is backing up</AlertTitle>
          <AlertDescription>
            {queueDepth} of {queueMax} queue slots are in use. New PDF requests may start failing if the queue fills up.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" /> Browser
            </CardDescription>
            <CardTitle className="text-lg flex items-center gap-2" data-testid="text-browser-status">
              {isLoading ? <Skeleton className="h-6 w-24" /> : browserStatusBadge}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            In-flight renders:{" "}
            <span className="font-medium text-foreground" data-testid="text-browser-inflight">
              {isLoading ? "…" : cb?.inFlight ?? 0}
            </span>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" /> Browser age
            </CardDescription>
            <CardTitle className="text-lg" data-testid="text-browser-age">
              {isLoading ? <Skeleton className="h-6 w-24" /> : formatDuration(cb?.ageMs ?? null)}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Max age: {data ? formatDuration(data.limits.maxBrowserAgeMs) : "—"}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <FileText className="h-3.5 w-3.5" /> PDFs rendered
            </CardDescription>
            <CardTitle className="text-lg" data-testid="text-pdf-count">
              {isLoading ? (
                <Skeleton className="h-6 w-20" />
              ) : (
                `${cb?.pdfCount ?? 0} / ${data?.limits.maxPdfsPerBrowser ?? 0}`
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            On the current cached browser
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <Activity className="h-3.5 w-3.5" /> Queue
            </CardDescription>
            <CardTitle className="text-lg" data-testid="text-queue-depth">
              {isLoading ? (
                <Skeleton className="h-6 w-24" />
              ) : (
                <>
                  <span data-testid="text-queue-active">{data?.queue.activeRenders ?? 0}</span>
                  {" active · "}
                  <span data-testid="text-queue-waiting">{queueDepth}</span>
                  {" waiting"}
                </>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Max concurrent: {data?.limits.maxConcurrentRenders ?? "—"} · Max queue: {queueMax || "—"}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Limits</CardTitle>
          <CardDescription>Configured thresholds that drive recycling and back-pressure.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading || !data ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div className="flex justify-between border-b pb-1">
                <dt className="text-muted-foreground">Max PDFs per browser</dt>
                <dd className="font-medium" data-testid="text-limit-max-pdfs">{data.limits.maxPdfsPerBrowser}</dd>
              </div>
              <div className="flex justify-between border-b pb-1">
                <dt className="text-muted-foreground">Max browser age</dt>
                <dd className="font-medium" data-testid="text-limit-max-age">{formatDuration(data.limits.maxBrowserAgeMs)}</dd>
              </div>
              <div className="flex justify-between border-b pb-1">
                <dt className="text-muted-foreground">Max concurrent renders</dt>
                <dd className="font-medium" data-testid="text-limit-max-concurrent">{data.limits.maxConcurrentRenders}</dd>
              </div>
              <div className="flex justify-between border-b pb-1">
                <dt className="text-muted-foreground">Max queue length</dt>
                <dd className="font-medium" data-testid="text-limit-max-queue">{data.limits.maxQueueLength}</dd>
              </div>
              <div className="flex justify-between border-b pb-1">
                <dt className="text-muted-foreground">Queue wait timeout</dt>
                <dd className="font-medium" data-testid="text-limit-queue-timeout">{formatDuration(data.limits.queueWaitTimeoutMs)}</dd>
              </div>
            </dl>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
