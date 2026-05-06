import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Loader2, RefreshCcw, Database, Sparkles, AlertTriangle,
  ChevronDown, ChevronRight, Download, X, Ban, RotateCcw,
  Info, AlertCircle, CheckCircle2, TrendingUp
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

interface AccessRow {
  userId: string;
  name: string;
  email: string;
  role: string;
  enabled: boolean;
  canTrain: boolean;
  enabledAt: string | null;
}

interface IngestRun {
  id: string;
  startedAt: string;
  completedAt: string | null;
  status: string;
  bidsIngested: number;
  estimatesIngested: number;
  lineItemsIngested: number;
  takeoffsIngested: number;
  costPostingsIngested: number;
  ratesUpdated: number;
  triggerType: string;
  errorMessage: string | null;
}

interface LearnedRate {
  id: string;
  costCode: string;
  metric: string;
  unit: string;
  sampleSize: number;
  mean: string | null;
  median: string | null;
  p25: string | null;
  p75: string | null;
  confidence: "Strong" | "Mixed" | "Sparse";
  excludedSampleCount: number;
  sampleCount: number;
  lastUpdatedAt: string;
}

interface RateSample {
  id: string;
  value: string;
  sourceType: string;
  sourceRowId: string | null;
  projectId: string | null;
  bidId: string | null;
  recordedAt: string;
  project: { id: string; name: string; code: string } | null;
  bid: { id: string; name: string; code: string } | null;
}

interface ExcludedSource {
  id: string;
  projectId: string | null;
  bidId: string | null;
  reason: string | null;
  excludedAt: string;
  project: { id: string; name: string; code: string } | null;
  bid: { id: string; name: string; code: string } | null;
  excludedBy: { id: string; firstName: string; lastName: string; email: string } | null;
}

interface FeedbackRow {
  id: string;
  createdAt: string;
  surface: string;
  outcome: string;
  costCode: string | null;
  comment: string | null;
}

interface FeedbackStats {
  totalEvents: number;
  acceptanceRate: number | null;
  bySurface: Record<string, { ACCEPTED: number; EDITED: number; REJECTED: number; THUMBS_UP: number; THUMBS_DOWN: number }>;
}

function ConfidenceChip({ confidence, sampleSize }: { confidence: string; sampleSize: number }) {
  if (confidence === "Strong") {
    return (
      <Badge variant="default" className="gap-1" data-testid="chip-confidence-strong">
        <CheckCircle2 className="h-3 w-3" /> Strong
      </Badge>
    );
  }
  if (confidence === "Mixed") {
    return (
      <Badge variant="secondary" className="gap-1" data-testid="chip-confidence-mixed">
        <TrendingUp className="h-3 w-3" /> Mixed
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 text-amber-600 border-amber-300" data-testid="chip-confidence-sparse">
      <AlertCircle className="h-3 w-3" /> Sparse
    </Badge>
  );
}

function ExcludeProjectDialog({
  projectId,
  projectName,
  open,
  onClose,
  onExclude,
}: {
  projectId: string;
  projectName: string;
  open: boolean;
  onClose: () => void;
  onExclude: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Exclude project from learning</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          This will remove all samples from <strong>{projectName}</strong> from the rate pool and recompute affected rates immediately. Future samples from this project will also be skipped.
        </p>
        <div className="space-y-2">
          <Label>Reason (optional)</Label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Money-losing job with atypical scope"
            rows={3}
            data-testid="input-exclude-reason"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-exclude-cancel">Cancel</Button>
          <Button variant="destructive" onClick={() => onExclude(reason)} data-testid="button-exclude-confirm">
            <Ban className="h-4 w-4 mr-2" /> Exclude project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SamplesDrawer({
  rate,
  open,
  onClose,
  excludedProjectIds,
  onExcludeProject,
}: {
  rate: LearnedRate | null;
  open: boolean;
  onClose: () => void;
  excludedProjectIds: Set<string>;
  onExcludeProject: (projectId: string, projectName: string) => void;
}) {
  const [page, setPage] = useState(0);
  const limit = 50;
  const offset = page * limit;

  useEffect(() => { setPage(0); }, [rate?.id]);

  const samplesUrl = rate ? `/api/ai-estimator/admin/learned-rates/${rate.id}/samples?offset=${offset}&limit=${limit}` : null;

  const samplesQuery = useQuery<{ samples: RateSample[]; total: number; limit: number; offset: number }>({
    queryKey: [samplesUrl],
    enabled: !!rate && open && !!samplesUrl,
  });

  if (!rate) return null;

  const samples = samplesQuery.data?.samples ?? [];
  const total = samplesQuery.data?.total ?? 0;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:w-[640px] max-w-full overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-mono text-base">{rate.costCode}</SheetTitle>
          <SheetDescription>
            {rate.metric} / {rate.unit} &middot; {total} sample{total !== 1 ? "s" : ""}
            {rate.excludedSampleCount > 0 && (
              <span className="text-amber-600 ml-2">({rate.excludedSampleCount} excluded)</span>
            )}
          </SheetDescription>
        </SheetHeader>

        {rate.excludedSampleCount > 0 && (
          <div className="mt-4 flex items-start gap-2 p-3 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-sm">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>This rate excludes {rate.excludedSampleCount} sample{rate.excludedSampleCount !== 1 ? "s" : ""} from {rate.excludedSampleCount === 1 ? "1 excluded project" : "excluded projects"}.</span>
          </div>
        )}

        <div className="mt-4 mb-2 flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            Showing {Math.min(page * limit + 1, total)}–{Math.min((page + 1) * limit, total)} of {total}
          </div>
          <a
            href={`/api/ai-estimator/admin/learned-rates/${rate.id}/samples/export.csv`}
            className="flex items-center gap-1 text-xs text-primary hover:underline"
            data-testid="link-export-samples-csv"
          >
            <Download className="h-3 w-3" /> Export CSV
          </a>
        </div>

        {samplesQuery.isLoading ? (
          <Loader2 className="animate-spin h-5 w-5 mt-4" />
        ) : (
          <div className="space-y-2">
            {samples.map((s) => {
              const isExcluded = s.projectId ? excludedProjectIds.has(s.projectId) : false;
              return (
                <div
                  key={s.id}
                  className={`rounded-md border p-3 text-sm ${isExcluded ? "opacity-50 bg-muted" : ""}`}
                  data-testid={`sample-row-${s.id}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-0.5">
                      <div className="font-medium">{Number(s.value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</div>
                      <div className="text-xs text-muted-foreground">
                        <Badge variant="outline" className="text-[10px] mr-1">{s.sourceType.replace(/_/g, " ")}</Badge>
                        {s.project ? (
                          <span>Project: <strong>{s.project.name}</strong> ({s.project.code})</span>
                        ) : s.bid ? (
                          <span>Bid: <strong>{s.bid.name}</strong> ({s.bid.code})</span>
                        ) : (
                          <span className="italic">No source link (legacy)</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">{new Date(s.recordedAt).toLocaleDateString()}</div>
                    </div>
                    {s.projectId && !isExcluded && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0 text-destructive border-destructive hover:bg-destructive hover:text-destructive-foreground"
                        onClick={() => onExcludeProject(s.projectId!, s.project?.name ?? s.projectId!)}
                        data-testid={`button-exclude-project-${s.projectId}`}
                      >
                        <Ban className="h-3 w-3 mr-1" /> Exclude
                      </Button>
                    )}
                    {s.projectId && isExcluded && (
                      <Badge variant="destructive" className="text-[10px] shrink-0">Excluded</Badge>
                    )}
                  </div>
                </div>
              );
            })}
            {samples.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">No samples recorded yet. Run training to populate provenance.</p>
            )}
          </div>
        )}

        {total > limit && (
          <div className="flex gap-2 mt-4 justify-center">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)} data-testid="button-samples-prev">Previous</Button>
            <Button variant="outline" size="sm" disabled={(page + 1) * limit >= total} onClick={() => setPage((p) => p + 1)} data-testid="button-samples-next">Next</Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default function AiEstimatorAdminPage() {
  const { toast } = useToast();
  const [tab, setTab] = useState("access");

  const accessQuery = useQuery<{ users: AccessRow[] }>({ queryKey: ["/api/ai-estimator/admin/access"] });
  const runsQuery = useQuery<{ runs: IngestRun[] }>({ queryKey: ["/api/ai-estimator/admin/ingest-runs"] });
  const ratesQuery = useQuery<{ rates: LearnedRate[] }>({ queryKey: ["/api/ai-estimator/admin/learned-rates"] });
  const feedbackQuery = useQuery<{ stats: FeedbackStats; recent: FeedbackRow[] }>({ queryKey: ["/api/ai-estimator/admin/feedback"] });
  const excludedQuery = useQuery<{ excludedSources: ExcludedSource[] }>({ queryKey: ["/api/ai-estimator/admin/excluded-sources"] });

  const [rateFilter, setRateFilter] = useState("");
  const [metricFilter, setMetricFilter] = useState("all");
  const [minSamples, setMinSamples] = useState(0);
  const [selectedRate, setSelectedRate] = useState<LearnedRate | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [excludedOpen, setExcludedOpen] = useState(false);

  const [excludeDialogOpen, setExcludeDialogOpen] = useState(false);
  const [pendingExclude, setPendingExclude] = useState<{ projectId: string; projectName: string } | null>(null);
  const [expandedRunIds, setExpandedRunIds] = useState<Set<string>>(new Set());
  const toggleRunExpanded = (id: string) => {
    setExpandedRunIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const updateAccess = useMutation({
    mutationFn: async (vars: { userId: string; enabled: boolean; canTrain?: boolean }) =>
      apiRequest("PUT", "/api/ai-estimator/admin/access", vars),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-estimator/admin/access"] });
      toast({ title: "Access updated" });
    },
    onError: (err: Error) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const triggerIngest = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/ai-estimator/admin/ingest", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-estimator/admin/ingest-runs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai-estimator/admin/learned-rates"] });
      toast({ title: "Ingestion started", description: "Re-trained from your historical data." });
    },
    onError: (err: Error) => toast({ title: "Ingestion failed", description: err.message, variant: "destructive" }),
  });

  const addExclusion = useMutation({
    mutationFn: async (vars: { projectId?: string; bidId?: string; reason?: string }) =>
      apiRequest("POST", "/api/ai-estimator/admin/excluded-sources", vars),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-estimator/admin/excluded-sources"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai-estimator/admin/learned-rates"] });
      toast({ title: "Project excluded", description: "Rates recomputed excluding this project." });
    },
    onError: (err: Error) => toast({ title: "Exclusion failed", description: err.message, variant: "destructive" }),
  });

  const removeExclusion = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/ai-estimator/admin/excluded-sources/${id}`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-estimator/admin/excluded-sources"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai-estimator/admin/learned-rates"] });
      toast({ title: "Project re-included", description: "Rates recomputed with this project restored." });
    },
    onError: (err: Error) => toast({ title: "Re-include failed", description: err.message, variant: "destructive" }),
  });

  const excludedSources = excludedQuery.data?.excludedSources ?? [];
  const excludedProjectIds = new Set(excludedSources.map((e) => e.projectId).filter(Boolean) as string[]);

  const allRuns = runsQuery.data?.runs ?? [];
  const lastScheduledRun = allRuns.find((r) => r.triggerType === "SCHEDULED") ?? null;
  const lastSuccessfulScheduledRun = allRuns.find(
    (r) => r.triggerType === "SCHEDULED" && (r.status === "SUCCESS" || r.status === "SUCCEEDED"),
  ) ?? null;
  const lastRun = allRuns[0] ?? null;

  const allRates = ratesQuery.data?.rates ?? [];
  const filteredRates = allRates.filter((r) => {
    if (rateFilter && !r.costCode.toLowerCase().includes(rateFilter.toLowerCase())) return false;
    if (metricFilter !== "all" && r.metric !== metricFilter) return false;
    if (minSamples > 0 && r.sampleSize < minSamples) return false;
    return true;
  });

  function openDrawer(rate: LearnedRate) {
    setSelectedRate(rate);
    setDrawerOpen(true);
  }

  function handleExcludeProject(projectId: string, projectName: string) {
    setPendingExclude({ projectId, projectName });
    setExcludeDialogOpen(true);
  }

  function confirmExclude(reason: string) {
    if (!pendingExclude) return;
    addExclusion.mutate({ projectId: pendingExclude.projectId, reason });
    setExcludeDialogOpen(false);
    setPendingExclude(null);
  }

  return (
    <div className="container mx-auto p-6 space-y-6" data-testid="page-ai-estimator-admin">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" /> AI Estimator Admin
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Control which estimators can use the workspace, monitor learned cost-rate health, and review feedback.
          </p>
        </div>
        <Button
          onClick={() => triggerIngest.mutate()}
          disabled={triggerIngest.isPending}
          data-testid="button-trigger-ingest"
        >
          {triggerIngest.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCcw className="h-4 w-4 mr-2" />}
          Re-train from history
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="access" data-testid="tab-access">User access</TabsTrigger>
          <TabsTrigger value="ingest" data-testid="tab-ingest">Training runs</TabsTrigger>
          <TabsTrigger value="rates" data-testid="tab-rates">Learned rates</TabsTrigger>
          <TabsTrigger value="feedback" data-testid="tab-feedback">Feedback</TabsTrigger>
        </TabsList>

        <TabsContent value="access" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Per-user enablement</CardTitle>
              <CardDescription>
                The AI Estimator is opt-in. Enable individual users below — only enabled users will see drafts, the chat panel, and inline suggestions.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {accessQuery.isLoading ? (
                <Loader2 className="animate-spin h-5 w-5" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Enabled</TableHead>
                      <TableHead>Can contribute to training</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {accessQuery.data?.users.map((u) => (
                      <TableRow key={u.userId} data-testid={`row-access-${u.userId}`}>
                        <TableCell>
                          <div className="font-medium">{u.name || u.email}</div>
                          <div className="text-xs text-muted-foreground">{u.email}</div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{u.role}</Badge>
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={u.enabled}
                            onCheckedChange={(v) => updateAccess.mutate({ userId: u.userId, enabled: v, canTrain: u.canTrain })}
                            data-testid={`switch-enabled-${u.userId}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={u.canTrain}
                            disabled={!u.enabled}
                            onCheckedChange={(v) => updateAccess.mutate({ userId: u.userId, enabled: u.enabled, canTrain: v })}
                            data-testid={`switch-train-${u.userId}`}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ingest" className="space-y-4">
          <Card data-testid="card-schedule-status">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Info className="h-5 w-5" /> Nightly schedule status
              </CardTitle>
              <CardDescription>
                The ingestion job runs automatically once per day per organization. This panel shows whether the latest scheduled run completed successfully.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {runsQuery.isLoading ? (
                <Loader2 className="animate-spin h-5 w-5" />
              ) : !lastScheduledRun ? (
                <div className="flex items-start gap-2 text-sm text-muted-foreground" data-testid="text-no-scheduled-runs">
                  <Info className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>No scheduled runs recorded yet. The nightly job will record its first run here automatically.</span>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-3" data-testid="summary-last-scheduled-run">
                    <Badge
                      variant={
                        lastScheduledRun.status === "SUCCESS" || lastScheduledRun.status === "SUCCEEDED"
                          ? "default"
                          : lastScheduledRun.status === "FAILED"
                            ? "destructive"
                            : "secondary"
                      }
                      className="gap-1"
                      data-testid="badge-last-scheduled-status"
                    >
                      {lastScheduledRun.status === "SUCCESS" || lastScheduledRun.status === "SUCCEEDED" ? (
                        <CheckCircle2 className="h-3 w-3" />
                      ) : lastScheduledRun.status === "FAILED" ? (
                        <AlertCircle className="h-3 w-3" />
                      ) : (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      )}
                      {lastScheduledRun.status}
                    </Badge>
                    <span className="text-sm">
                      Last scheduled run:{" "}
                      <strong data-testid="text-last-scheduled-started">
                        {new Date(lastScheduledRun.startedAt).toLocaleString()}
                      </strong>
                      {lastScheduledRun.completedAt && (
                        <span className="text-muted-foreground">
                          {" "}
                          (finished {new Date(lastScheduledRun.completedAt).toLocaleString()})
                        </span>
                      )}
                    </span>
                  </div>

                  {lastScheduledRun.status === "FAILED" && lastSuccessfulScheduledRun && (
                    <div className="text-sm text-muted-foreground" data-testid="text-last-successful-scheduled">
                      Last successful scheduled run:{" "}
                      <strong>{new Date(lastSuccessfulScheduledRun.startedAt).toLocaleString()}</strong>
                    </div>
                  )}

                  {lastScheduledRun.status === "FAILED" && !lastSuccessfulScheduledRun && (
                    <div className="text-sm text-amber-700" data-testid="text-no-successful-scheduled">
                      No successful scheduled run on record yet.
                    </div>
                  )}

                  {lastScheduledRun.status === "FAILED" && lastScheduledRun.errorMessage && (
                    <div
                      className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"
                      data-testid="text-last-scheduled-error"
                    >
                      <AlertTriangle className="h-4 w-4 mt-0.5 text-destructive shrink-0" />
                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="font-medium text-destructive">Error from last scheduled run</div>
                        <pre className="whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground bg-background/60 rounded border border-destructive/20 p-2 max-h-40 overflow-auto">
                          {lastScheduledRun.errorMessage}
                        </pre>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" data-testid="grid-last-scheduled-counters">
                    {[
                      { label: "Bids", value: lastScheduledRun.bidsIngested, testId: "counter-bids" },
                      { label: "Estimates", value: lastScheduledRun.estimatesIngested, testId: "counter-estimates" },
                      { label: "Line items", value: lastScheduledRun.lineItemsIngested, testId: "counter-line-items" },
                      { label: "Takeoffs", value: lastScheduledRun.takeoffsIngested, testId: "counter-takeoffs" },
                      { label: "Cost postings", value: lastScheduledRun.costPostingsIngested, testId: "counter-cost-postings" },
                      { label: "Rates updated", value: lastScheduledRun.ratesUpdated, testId: "counter-rates" },
                    ].map((c) => (
                      <div
                        key={c.label}
                        className="rounded-md border bg-muted/30 px-3 py-2"
                        data-testid={c.testId}
                      >
                        <div className="text-xs text-muted-foreground">{c.label}</div>
                        <div className="text-lg font-semibold tabular-nums">{(c.value ?? 0).toLocaleString()}</div>
                      </div>
                    ))}
                  </div>

                  {lastRun && lastRun.id !== lastScheduledRun.id && (
                    <div className="text-xs text-muted-foreground" data-testid="text-most-recent-run-note">
                      Most recent run overall was a {lastRun.triggerType.toLowerCase()} run on{" "}
                      {new Date(lastRun.startedAt).toLocaleString()} ({lastRun.status}).
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" /> Historical training runs
              </CardTitle>
              <CardDescription>
                Each run scans your bids, estimates, takeoffs, and historical-cost data to refresh the learned rates store.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {runsQuery.isLoading ? (
                <Loader2 className="animate-spin h-5 w-5" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Started</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Trigger</TableHead>
                      <TableHead>Bids</TableHead>
                      <TableHead>Estimates</TableHead>
                      <TableHead>Takeoffs</TableHead>
                      <TableHead>Rates updated</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runsQuery.data?.runs.flatMap((r) => {
                      const isFailed = r.status === "FAILED";
                      const hasError = isFailed && !!r.errorMessage;
                      const isExpanded = expandedRunIds.has(r.id);
                      const rows = [
                        <TableRow key={r.id} data-testid={`row-run-${r.id}`}>
                          <TableCell className="whitespace-nowrap">{new Date(r.startedAt).toLocaleString()}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Badge variant={r.status === "SUCCESS" || r.status === "SUCCEEDED" ? "default" : isFailed ? "destructive" : "secondary"}>
                                {r.status}
                              </Badge>
                              {hasError && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-1.5 text-destructive hover:text-destructive"
                                  onClick={() => toggleRunExpanded(r.id)}
                                  aria-label={isExpanded ? "Hide error details" : "Show error details"}
                                  data-testid={`button-toggle-error-${r.id}`}
                                >
                                  {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                  <AlertCircle className="h-3.5 w-3.5 ml-0.5" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-[10px]">{r.triggerType}</Badge>
                          </TableCell>
                          <TableCell>{r.bidsIngested}</TableCell>
                          <TableCell>{r.estimatesIngested}</TableCell>
                          <TableCell>{r.takeoffsIngested}</TableCell>
                          <TableCell>{r.ratesUpdated}</TableCell>
                        </TableRow>,
                      ];
                      if (hasError && isExpanded) {
                        rows.push(
                          <TableRow key={`${r.id}-error`} className="bg-destructive/5 hover:bg-destructive/5">
                            <TableCell colSpan={7} className="py-3">
                              <div className="flex items-start gap-2 text-sm" data-testid={`text-run-error-${r.id}`}>
                                <AlertCircle className="h-4 w-4 mt-0.5 text-destructive shrink-0" />
                                <div className="space-y-1 min-w-0 flex-1">
                                  <div className="font-medium text-destructive">Run failed</div>
                                  <pre className="whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground bg-background/60 rounded border border-destructive/20 p-2 max-h-48 overflow-auto">
                                    {r.errorMessage}
                                  </pre>
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>,
                        );
                      }
                      return rows;
                    })}
                    {runsQuery.data?.runs.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                          No training runs yet. Click <strong>Re-train from history</strong> above to seed the rates store.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rates" className="space-y-4">
          {excludedSources.length > 0 && (
            <Collapsible open={excludedOpen} onOpenChange={setExcludedOpen}>
              <Card>
                <CollapsibleTrigger asChild>
                  <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors rounded-t-lg">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Ban className="h-4 w-4 text-destructive" />
                      Excluded sources
                      <Badge variant="destructive" className="ml-1">{excludedSources.length}</Badge>
                      <span className="ml-auto text-muted-foreground">
                        {excludedOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </span>
                    </CardTitle>
                    <CardDescription>Projects excluded from the rate learning pool</CardDescription>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="pt-0">
                    <div className="space-y-2">
                      {excludedSources.map((e) => (
                        <div key={e.id} className="flex items-center justify-between gap-4 rounded-md border p-3" data-testid={`row-excluded-${e.id}`}>
                          <div className="space-y-0.5 min-w-0">
                            <div className="font-medium truncate">
                              {e.project ? `${e.project.name} (${e.project.code})` : e.bid ? `Bid: ${e.bid.name}` : "Unknown source"}
                            </div>
                            {e.reason && <div className="text-xs text-muted-foreground">{e.reason}</div>}
                            <div className="text-xs text-muted-foreground">
                              Excluded by {e.excludedBy ? `${e.excludedBy.firstName} ${e.excludedBy.lastName}`.trim() || e.excludedBy.email : "unknown"} on {new Date(e.excludedAt).toLocaleDateString()}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => removeExclusion.mutate(e.id)}
                            disabled={removeExclusion.isPending}
                            data-testid={`button-reinclude-${e.id}`}
                          >
                            <RotateCcw className="h-3 w-3 mr-1" /> Re-include
                          </Button>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          )}

          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle>Learned cost rates</CardTitle>
                  <CardDescription>Per cost code / metric / unit, derived only from this organization's data. Click a row to see contributing samples.</CardDescription>
                </div>
                <a
                  href="/api/ai-estimator/admin/learned-rates/export.csv"
                  className="flex items-center gap-1 text-sm text-primary hover:underline whitespace-nowrap"
                  data-testid="link-export-rates-csv"
                >
                  <Download className="h-3.5 w-3.5" /> Export CSV
                </a>
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                <Input
                  placeholder="Filter by cost code…"
                  value={rateFilter}
                  onChange={(e) => setRateFilter(e.target.value)}
                  className="w-44"
                  data-testid="input-rate-filter"
                />
                <Select value={metricFilter} onValueChange={setMetricFilter}>
                  <SelectTrigger className="w-44" data-testid="select-metric-filter">
                    <SelectValue placeholder="All metrics" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All metrics</SelectItem>
                    <SelectItem value="unit_cost">Unit cost</SelectItem>
                    <SelectItem value="labor_hours_per_unit">Labor hours / unit</SelectItem>
                    <SelectItem value="production_rate">Production rate</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={String(minSamples)}
                  onValueChange={(v) => setMinSamples(Number(v))}
                >
                  <SelectTrigger className="w-44" data-testid="select-min-samples">
                    <SelectValue placeholder="Min samples" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Any sample count</SelectItem>
                    <SelectItem value="3">At least 3 samples</SelectItem>
                    <SelectItem value="5">At least 5 samples</SelectItem>
                    <SelectItem value="10">At least 10 samples</SelectItem>
                  </SelectContent>
                </Select>
                {(rateFilter || metricFilter !== "all" || minSamples > 0) && (
                  <Button variant="ghost" size="sm" onClick={() => { setRateFilter(""); setMetricFilter("all"); setMinSamples(0); }} data-testid="button-clear-filters">
                    <X className="h-3.5 w-3.5 mr-1" /> Clear
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {ratesQuery.isLoading ? (
                <Loader2 className="animate-spin h-5 w-5" />
              ) : filteredRates.length === 0 && allRates.length === 0 ? (
                <div className="flex flex-col items-center gap-4 py-12 text-center">
                  <Database className="h-12 w-12 text-muted-foreground/40" />
                  <div>
                    <p className="font-medium text-muted-foreground">No rates learned yet</p>
                    <p className="text-sm text-muted-foreground mt-1">Run training to populate this table from your historical bids and estimates.</p>
                  </div>
                  <Button
                    onClick={() => triggerIngest.mutate()}
                    disabled={triggerIngest.isPending}
                    data-testid="button-run-training-empty"
                  >
                    {triggerIngest.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCcw className="h-4 w-4 mr-2" />}
                    Run training
                  </Button>
                </div>
              ) : (
                <ScrollArea className="h-[60vh]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Cost code</TableHead>
                        <TableHead>Metric</TableHead>
                        <TableHead>Unit</TableHead>
                        <TableHead>n</TableHead>
                        <TableHead>Median</TableHead>
                        <TableHead>P25 – P75</TableHead>
                        <TableHead>Confidence</TableHead>
                        <TableHead>Updated</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredRates.map((r) => (
                        <TableRow
                          key={r.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => openDrawer(r)}
                          data-testid={`row-rate-${r.id}`}
                        >
                          <TableCell className="font-mono text-xs">
                            {r.costCode}
                            {r.excludedSampleCount > 0 && (
                              <Badge variant="outline" className="ml-1 text-[9px] border-amber-300 text-amber-700">
                                -{r.excludedSampleCount} excl.
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-xs">{r.metric.replace(/_/g, " ")}</TableCell>
                          <TableCell>{r.unit}</TableCell>
                          <TableCell>{r.sampleSize}</TableCell>
                          <TableCell>{r.median ?? r.mean ?? "—"}</TableCell>
                          <TableCell>{r.p25 && r.p75 ? `${r.p25} – ${r.p75}` : "—"}</TableCell>
                          <TableCell>
                            <ConfidenceChip confidence={r.confidence} sampleSize={r.sampleSize} />
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs">{new Date(r.lastUpdatedAt).toLocaleDateString()}</TableCell>
                        </TableRow>
                      ))}
                      {filteredRates.length === 0 && allRates.length > 0 && (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">
                            No rates match the current filters.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="feedback">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5" /> Feedback signals</CardTitle>
              <CardDescription>How estimators are reacting to AI suggestions in the last 30 days.</CardDescription>
            </CardHeader>
            <CardContent>
              {feedbackQuery.isLoading ? (
                <Loader2 className="animate-spin h-5 w-5" />
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div className="rounded-md border p-4">
                      <div className="text-xs text-muted-foreground">Total events</div>
                      <div className="text-2xl font-bold" data-testid="text-feedback-total">{feedbackQuery.data?.stats.totalEvents ?? 0}</div>
                    </div>
                    <div className="rounded-md border p-4">
                      <div className="text-xs text-muted-foreground">Acceptance rate</div>
                      <div className="text-2xl font-bold" data-testid="text-acceptance-rate">
                        {feedbackQuery.data?.stats.acceptanceRate != null
                          ? `${(feedbackQuery.data.stats.acceptanceRate * 100).toFixed(0)}%`
                          : "—"}
                      </div>
                    </div>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>When</TableHead>
                        <TableHead>Surface</TableHead>
                        <TableHead>Outcome</TableHead>
                        <TableHead>Cost code</TableHead>
                        <TableHead>Comment</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {feedbackQuery.data?.recent.map((f) => (
                        <TableRow key={f.id} data-testid={`row-feedback-${f.id}`}>
                          <TableCell className="whitespace-nowrap text-xs">{new Date(f.createdAt).toLocaleString()}</TableCell>
                          <TableCell>{f.surface}</TableCell>
                          <TableCell>
                            <Badge variant={f.outcome === "ACCEPTED" || f.outcome === "THUMBS_UP" ? "default" : f.outcome === "REJECTED" || f.outcome === "THUMBS_DOWN" ? "destructive" : "secondary"}>
                              {f.outcome}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs">{f.costCode ?? "—"}</TableCell>
                          <TableCell className="text-xs">{f.comment ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <SamplesDrawer
        rate={selectedRate}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        excludedProjectIds={excludedProjectIds}
        onExcludeProject={handleExcludeProject}
      />

      {pendingExclude && (
        <ExcludeProjectDialog
          projectId={pendingExclude.projectId}
          projectName={pendingExclude.projectName}
          open={excludeDialogOpen}
          onClose={() => { setExcludeDialogOpen(false); setPendingExclude(null); }}
          onExclude={confirmExclude}
        />
      )}
    </div>
  );
}
