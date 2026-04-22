import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  ArrowLeft,
  RefreshCw,
  CheckCircle2,
  XCircle,
  HelpCircle,
  FileText,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface PortfolioRendererStatus {
  available: boolean | null;
  error: string | null;
  lastCheckedAt: number | null;
}

const HEALTH_KEY = ["/api/admin/portfolio-pdf/health"] as const;

function formatTimestamp(ts: number | null): string {
  if (!ts) return "Never";
  return new Date(ts).toLocaleString();
}

function formatRelative(ts: number | null): string {
  if (!ts) return "never";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function PortfolioPdfHealth() {
  const { toast } = useToast();
  const { data, isLoading, isError, refetch, isFetching } =
    useQuery<PortfolioRendererStatus>({
      queryKey: HEALTH_KEY,
      refetchInterval: 30_000,
    });

  const checkMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "GET",
        "/api/admin/portfolio-pdf/health?check=true",
      );
      return (await res.json()) as PortfolioRendererStatus;
    },
    onSuccess: (result) => {
      queryClient.setQueryData(HEALTH_KEY, result);
      queryClient.invalidateQueries({ queryKey: HEALTH_KEY });
      toast({
        title: result.available
          ? "Renderer is available"
          : "Renderer is unavailable",
        description: result.available
          ? "Chromium launched successfully."
          : result.error ?? "Unknown error",
        variant: result.available ? "default" : "destructive",
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Health check failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const status = data;
  const available = status?.available ?? null;

  let statusBadge;
  if (available === true) {
    statusBadge = (
      <Badge
        variant="default"
        className="bg-green-600 hover:bg-green-600"
        data-testid="badge-portfolio-pdf-status"
      >
        <CheckCircle2 className="h-3 w-3 mr-1" /> Available
      </Badge>
    );
  } else if (available === false) {
    statusBadge = (
      <Badge variant="destructive" data-testid="badge-portfolio-pdf-status">
        <XCircle className="h-3 w-3 mr-1" /> Unavailable
      </Badge>
    );
  } else {
    statusBadge = (
      <Badge variant="secondary" data-testid="badge-portfolio-pdf-status">
        <HelpCircle className="h-3 w-3 mr-1" /> Unknown
      </Badge>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <main className="container mx-auto p-6 max-w-4xl space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/admin">
              <Button variant="ghost" size="sm" data-testid="button-back-admin">
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </Button>
            </Link>
            <h1
              className="text-2xl font-semibold"
              data-testid="text-page-title"
            >
              Portfolio PDF renderer health
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              data-testid="button-refresh"
            >
              <RefreshCw
                className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
            <Button
              size="sm"
              onClick={() => checkMutation.mutate()}
              disabled={checkMutation.isPending}
              data-testid="button-run-check"
            >
              {checkMutation.isPending ? "Checking…" : "Run availability check"}
            </Button>
          </div>
        </div>

        {isError && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertTitle>Failed to load renderer status</AlertTitle>
            <AlertDescription>
              The admin status endpoint returned an error. You may not have
              SUPER_ADMIN permission.
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Renderer status
                </CardTitle>
                <CardDescription>
                  Cached availability of the headless Chromium pool used for
                  Portfolio summary PDFs.
                </CardDescription>
              </div>
              {isLoading ? (
                <Skeleton className="h-6 w-24" />
              ) : (
                statusBadge
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-muted-foreground">Last checked</div>
                {isLoading ? (
                  <Skeleton className="h-4 w-40 mt-1" />
                ) : (
                  <div data-testid="text-last-checked">
                    {formatTimestamp(status?.lastCheckedAt ?? null)}
                    {status?.lastCheckedAt && (
                      <span className="text-muted-foreground ml-2">
                        ({formatRelative(status.lastCheckedAt)})
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div>
                <div className="text-muted-foreground">Cached availability</div>
                {isLoading ? (
                  <Skeleton className="h-4 w-32 mt-1" />
                ) : (
                  <div data-testid="text-cached-availability">
                    {available === true
                      ? "Available"
                      : available === false
                        ? "Unavailable"
                        : "Unknown — no probe yet"}
                  </div>
                )}
              </div>
            </div>

            {available === false && status?.error && (
              <Alert variant="destructive" data-testid="alert-last-error">
                <XCircle className="h-4 w-4" />
                <AlertTitle>Last availability error</AlertTitle>
                <AlertDescription className="font-mono text-xs whitespace-pre-wrap break-all">
                  {status.error}
                </AlertDescription>
              </Alert>
            )}

            {available === null && !isLoading && (
              <Alert>
                <HelpCircle className="h-4 w-4" />
                <AlertTitle>No availability data yet</AlertTitle>
                <AlertDescription>
                  The renderer has not been probed since the server started.
                  Run an availability check to populate the status.
                </AlertDescription>
              </Alert>
            )}

            <div className="text-xs text-muted-foreground">
              Negative results are not cached: the next portfolio PDF request
              will retry the launch automatically. Use the availability check
              button above to probe Chromium on demand.
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
