import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, FileText, RefreshCw, Plus, Loader2 } from "lucide-react";

interface OrgJobClassification {
  id: string;
  name: string;
}

interface ProjectPayrollSummary {
  laborCostToDate: number;
  budget: number;
  laborVsBudget: number;
  totalRegularHours: number;
  totalOvertimeHours: number;
  overtimePercent: number;
  totalEntries: number;
  workers: { userId: string; name: string; role: string; regularHours: number; overtimeHours: number }[];
}

type PrevailingRateSource = "PROJECT_OVERRIDE" | "DOL_FEED";

interface PrevailingWageClassification {
  classificationId: string;
  classificationName: string;
  wageRate: number;
  fringeRate: number | null;
  totalRate: number | null;
  overtimeMultiplier: string | null;
  effectiveDate: string | null;
  expirationDate: string | null;
  wageDecision: string | null;
  source: PrevailingRateSource;
}

interface PrevailingWageSummary {
  projectId: string;
  wageDecision: string | null;
  wageDecisionCached: boolean | null;
  // Task #1332: persisted "last sync attempt" tracking so the banner can
  // distinguish "never tried" from "tried and failed" and show an error.
  wageDecisionLastSyncAt?: string | null;
  wageDecisionLastAttemptAt?: string | null;
  wageDecisionLastError?: string | null;
  // Task #1367: auto-retry progress (from integration_sync_state). Used to
  // tell users when the next background retry will fire (so they don't have
  // to babysit it) and to switch to a "manual action required" banner once
  // the chain is exhausted.
  wageDecisionRetryCount?: number | null;
  wageDecisionNextRetryAt?: string | null;
  wageDecisionRetryExhausted?: boolean | null;
  wageDecisionMaxRetries?: number | null;
  // Task #1339: surface cache size + a configurable staleness threshold so
  // PMs know how fresh the cached DOL decision is and can re-sync when in
  // doubt without leaving the project page.
  wageDecisionRatesCached?: number | null;
  wageDecisionStaleAfterDays?: number | null;
  classifications: PrevailingWageClassification[];
}

function formatRelativeTimestamp(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString();
}

const formatCurrency = (val: number | null | undefined) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val || 0);

function SourceBadge({ source }: { source: PrevailingRateSource }) {
  if (source === "PROJECT_OVERRIDE") {
    return (
      <Badge variant="default" className="text-xs" data-testid={`badge-source-project-override`}>
        Project override
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="text-xs" data-testid={`badge-source-dol-feed`}>
      DOL feed
    </Badge>
  );
}

function PrevailingWagePanel({ projectId }: { projectId: string }) {
  const { toast } = useToast();
  const summaryKey = ["/api/projects", projectId, "prevailing-wage-summary"];
  const { data, isLoading } = useQuery<PrevailingWageSummary>({
    queryKey: summaryKey,
  });

  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideRow, setOverrideRow] = useState<PrevailingWageClassification | null>(null);
  const [ovWageRate, setOvWageRate] = useState("");
  const [ovFringeRate, setOvFringeRate] = useState("");
  const [ovOtMultiplier, setOvOtMultiplier] = useState("1.5");
  const [ovEffectiveDate, setOvEffectiveDate] = useState("");
  const [ovExpirationDate, setOvExpirationDate] = useState("");
  const [ovNotes, setOvNotes] = useState("");

  // Task #1382: confirmation step before auto-creating a brand-new job
  // classification from a DOL feed override. The dialog lets the user pick
  // an existing org classification (preventing typo-driven duplicates like
  // "Carpenter" vs "Carpenter (Form Carpenter)") or explicitly opt in to
  // creating a new one.
  const [confirmCreateOpen, setConfirmCreateOpen] = useState(false);
  const [pickedExistingId, setPickedExistingId] = useState<string>("");

  const { data: orgClassifications = [] } = useQuery<OrgJobClassification[]>({
    queryKey: ["/api/labor-rates/classifications"],
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/prevailing-wage-summary/sync`, {});
      return (await res.json()) as { success: boolean; ratesImported?: number; decisionNumber?: string };
    },
    onSuccess: (res) => {
      toast({
        title: "Wage decision synced",
        description: `Imported ${res.ratesImported ?? 0} rate${res.ratesImported === 1 ? "" : "s"} for ${res.decisionNumber}.`,
      });
      queryClient.invalidateQueries({ queryKey: summaryKey });
    },
    onError: (err: Error) => {
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
    },
  });

  const overrideMutation = useMutation({
    mutationFn: async (opts: { classificationIdOverride?: string; confirmCreate?: boolean } = {}) => {
      if (!overrideRow) throw new Error("No row selected");
      // Task #1350 / #1382: synthetic `dol-feed:<name>` ids have no matching
      // job_classifications row yet. The user has either picked an existing
      // org classification (we send that real id) or explicitly opted in to
      // creating a new one (we forward the synthetic id + name + the
      // `confirmCreateClassification` flag so the server is allowed to
      // insert a new row). Real-id rows fall straight through.
      const classificationId = opts.classificationIdOverride ?? overrideRow.classificationId;
      const isSynthetic = classificationId.startsWith("dol-feed:");
      return await apiRequest("POST", "/api/labor-rates/prevailing-wage-rates", {
        projectId,
        classificationId,
        ...(isSynthetic ? { classificationName: overrideRow.classificationName } : {}),
        ...(isSynthetic && opts.confirmCreate ? { confirmCreateClassification: true } : {}),
        wageRate: ovWageRate,
        fringeRate: ovFringeRate || "0",
        fringeHealthRate: "0",
        fringePensionRate: "0",
        fringeVacationRate: "0",
        fringeTrainingRate: "0",
        overtimeMultiplier: ovOtMultiplier || "1.5",
        effectiveDate: ovEffectiveDate,
        expirationDate: ovExpirationDate || null,
        wageDecision: overrideRow.wageDecision || null,
        notes: ovNotes.trim() || null,
      });
    },
    onSuccess: () => {
      toast({ title: "Project override saved", description: "DOL feed rate promoted to a project-specific override." });
      queryClient.invalidateQueries({ queryKey: summaryKey });
      queryClient.invalidateQueries({ queryKey: ["/api/labor-rates/prevailing-wage-rates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/labor-rates/classifications"] });
      setOverrideOpen(false);
      setOverrideRow(null);
      setConfirmCreateOpen(false);
      setPickedExistingId("");
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save override", description: err.message, variant: "destructive" });
    },
  });

  const openOverrideDialog = (c: PrevailingWageClassification) => {
    setOverrideRow(c);
    setOvWageRate(c.wageRate.toFixed(2));
    setOvFringeRate(c.fringeRate != null ? c.fringeRate.toFixed(2) : "0");
    setOvOtMultiplier(c.overtimeMultiplier || "1.5");
    setOvEffectiveDate(c.effectiveDate || new Date().toISOString().split("T")[0]);
    setOvExpirationDate(c.expirationDate || "");
    setOvNotes("");
    setOverrideOpen(true);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <FileText className="w-5 h-5" /> Prevailing Wage Rates
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const showMissingWarning =
    !!data.wageDecision && data.wageDecisionCached === false;
  // Task #1332: show a dedicated failure banner when the most recent
  // attempt errored. Distinct from the generic "not yet imported" warning
  // so users see *why* their automatic sync didn't take and can retry.
  const showFailureBanner =
    !!data.wageDecision && !!data.wageDecisionLastError;
  const lastSyncDisplay = formatRelativeTimestamp(data.wageDecisionLastSyncAt);
  const lastAttemptDisplay = formatRelativeTimestamp(data.wageDecisionLastAttemptAt);
  // Task #1367: derive retry state for the failure banner.
  // - retryPending: a future auto-retry is scheduled, so the banner should
  //   reassure the user that the system will keep trying.
  // - retryExhausted: the chain is done, so the banner should escalate to
  //   "manual action required" (different visual treatment).
  const nextRetryDisplay = formatRelativeTimestamp(data.wageDecisionNextRetryAt);
  const retryPending =
    showFailureBanner &&
    !data.wageDecisionRetryExhausted &&
    !!data.wageDecisionNextRetryAt &&
    new Date(data.wageDecisionNextRetryAt).getTime() > Date.now();
  const retryExhausted = showFailureBanner && data.wageDecisionRetryExhausted === true;
  // Attempt N of M — retryCount is "failures so far"; the *next* attempt
  // number is retryCount + 1, capped at maxRetries.
  const maxRetries = data.wageDecisionMaxRetries ?? 0;
  const nextAttemptNumber = Math.min((data.wageDecisionRetryCount ?? 0) + 1, maxRetries || 1);

  // Task #1339: compute "stale" from the server-provided threshold so PMs
  // can tell at a glance whether the cached rates are fresh enough to trust.
  const staleAfterDays =
    typeof data.wageDecisionStaleAfterDays === "number" && data.wageDecisionStaleAfterDays > 0
      ? data.wageDecisionStaleAfterDays
      : 30;
  const lastSyncMs = data.wageDecisionLastSyncAt ? new Date(data.wageDecisionLastSyncAt).getTime() : NaN;
  const isStale =
    data.wageDecisionCached === true &&
    Number.isFinite(lastSyncMs) &&
    Date.now() - lastSyncMs > staleAfterDays * 24 * 60 * 60 * 1000;
  const ratesCached =
    typeof data.wageDecisionRatesCached === "number" ? data.wageDecisionRatesCached : null;

  const overrideCount = data.classifications.filter(c => c.source === "PROJECT_OVERRIDE").length;
  const dolCount = data.classifications.filter(c => c.source === "DOL_FEED").length;

  const totalForOverride =
    (parseFloat(ovWageRate || "0") + parseFloat(ovFringeRate || "0")).toFixed(2);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <FileText className="w-5 h-5" /> Prevailing Wage Rates
        </CardTitle>
        <CardDescription>
          Source for each classification's rate. Project overrides take precedence over the cached DOL Davis-Bacon feed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {data.wageDecision && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Project wage decision:</span>
            <span className="font-mono font-medium" data-testid="text-project-wage-decision">
              {data.wageDecision}
            </span>
            {data.wageDecisionCached === true && (
              <Badge variant="outline" className="text-xs" data-testid="badge-decision-cached">
                Cached from DOL
              </Badge>
            )}
            {data.wageDecisionCached === true && ratesCached != null && (
              <span className="text-xs text-muted-foreground" data-testid="text-wage-decision-rates-cached">
                {ratesCached} rate{ratesCached === 1 ? "" : "s"} cached
              </span>
            )}
            {lastSyncDisplay && (
              <span className="text-xs text-muted-foreground" data-testid="text-wage-decision-last-sync">
                Last synced {lastSyncDisplay}
              </span>
            )}
            {isStale && (
              <Badge
                variant="outline"
                className="text-xs border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-300"
                data-testid="badge-decision-stale"
                title={`Last synced more than ${staleAfterDays} day${staleAfterDays === 1 ? "" : "s"} ago`}
              >
                Stale
              </Badge>
            )}
            {data.wageDecisionCached === true && !showFailureBanner && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending}
                data-testid="button-resync-wage-decision"
              >
                {syncMutation.isPending ? (
                  <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> Re-syncing...</>
                ) : (
                  <><RefreshCw className="w-3.5 h-3.5 mr-1" /> Re-sync</>
                )}
              </Button>
            )}
          </div>
        )}

        {showFailureBanner && (
          <div
            className={
              retryPending
                ? "flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg"
                : "flex items-start gap-2 p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg"
            }
            data-testid={
              retryExhausted
                ? "banner-wage-decision-retry-exhausted"
                : retryPending
                  ? "banner-wage-decision-retry-pending"
                  : "banner-wage-decision-sync-failed"
            }
          >
            <AlertTriangle
              className={
                retryPending
                  ? "w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5"
                  : "w-5 h-5 text-red-600 flex-shrink-0 mt-0.5"
              }
            />
            <div
              className={
                retryPending
                  ? "flex-1 text-sm text-amber-800 dark:text-amber-200"
                  : "flex-1 text-sm text-red-700 dark:text-red-300"
              }
            >
              <p className="font-medium">
                {retryExhausted
                  ? "Davis-Bacon auto-retry exhausted - manual action required"
                  : retryPending
                    ? "Davis-Bacon auto-sync retrying in background"
                    : "Davis-Bacon auto-sync failed"}
              </p>
              <p className="mt-1">
                The last attempt to sync <span className="font-mono">{data.wageDecision}</span>
                {lastAttemptDisplay ? <> at <span className="font-medium">{lastAttemptDisplay}</span></> : null} returned an error:
              </p>
              <p
                className="mt-1 font-mono text-xs whitespace-pre-wrap break-words"
                data-testid="text-wage-decision-sync-error"
              >
                {data.wageDecisionLastError}
              </p>
              {retryPending && nextRetryDisplay && (
                <p
                  className="mt-2"
                  data-testid="text-wage-decision-next-retry"
                >
                  Next auto-retry at <span className="font-medium">{nextRetryDisplay}</span>
                  {maxRetries > 0 && (
                    <> (attempt {nextAttemptNumber} of {maxRetries})</>
                  )}
                  . You don't need to do anything &mdash; we'll keep trying automatically.
                </p>
              )}
              {retryExhausted && (
                <p
                  className="mt-2 font-medium"
                  data-testid="text-wage-decision-retry-exhausted"
                >
                  We've exhausted all {maxRetries || data.wageDecisionRetryCount} automatic retry attempts. Please run a manual sync below.
                </p>
              )}
              <div className="mt-2">
                <Button
                  size="sm"
                  variant={retryExhausted ? "default" : "outline"}
                  onClick={() => syncMutation.mutate()}
                  disabled={syncMutation.isPending}
                  data-testid="button-retry-wage-decision-sync"
                >
                  {syncMutation.isPending ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Retrying...</>
                  ) : (
                    <><RefreshCw className="w-4 h-4 mr-2" /> {retryExhausted ? "Retry sync now" : "Retry sync"}</>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        {showMissingWarning && !showFailureBanner && (
          <div
            className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg"
            data-testid="banner-missing-wage-decision"
          >
            <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1 text-sm text-red-700 dark:text-red-300">
              <p className="font-medium">
                Wage decision not yet imported from DOL
              </p>
              <p className="mt-1">
                <span className="font-mono">{data.wageDecision}</span> is referenced by this project but has not been
                synced. Run a Davis-Bacon sync so prevailing wage rates are applied automatically.
              </p>
              <div className="mt-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => syncMutation.mutate()}
                  disabled={syncMutation.isPending}
                  data-testid="button-sync-wage-decision"
                >
                  {syncMutation.isPending ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Syncing...</>
                  ) : (
                    <><RefreshCw className="w-4 h-4 mr-2" /> Sync from DOL</>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        {data.classifications.length === 0 ? (
          <div className="text-sm text-muted-foreground" data-testid="text-no-pw-rates">
            No prevailing wage classifications resolved for this project.
            {data.wageDecision
              ? " Add project overrides or sync the wage decision from DOL."
              : " Set a wage decision on the project or add project-specific overrides."}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span data-testid="text-count-project-override">{overrideCount} project override{overrideCount === 1 ? "" : "s"}</span>
              <span>·</span>
              <span data-testid="text-count-dol-feed">{dolCount} from DOL feed</span>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Classification</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead className="text-right">Wage Rate</TableHead>
                    <TableHead className="text-right">Fringe</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Effective</TableHead>
                    <TableHead className="text-right w-[140px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.classifications.map((c) => (
                    <TableRow key={c.classificationId} data-testid={`row-pw-classification-${c.classificationId}`}>
                      <TableCell className="font-medium">
                        <div>{c.classificationName}</div>
                        {c.wageDecision && c.source === "DOL_FEED" && (
                          <div className="text-[10px] text-muted-foreground font-mono mt-0.5" data-testid={`text-pw-decision-${c.classificationId}`}>
                            {c.wageDecision}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <SourceBadge source={c.source} />
                      </TableCell>
                      <TableCell className="text-right font-mono" data-testid={`text-pw-wage-rate-${c.classificationId}`}>
                        {formatCurrency(c.wageRate)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">
                        {c.fringeRate != null ? formatCurrency(c.fringeRate) : "\u2014"}
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold">
                        {c.totalRate != null ? formatCurrency(c.totalRate) : "\u2014"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {c.effectiveDate || "\u2014"}
                      </TableCell>
                      <TableCell className="text-right">
                        {c.source === "DOL_FEED" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openOverrideDialog(c)}
                            data-testid={`button-promote-override-${c.classificationId}`}
                          >
                            <Plus className="w-3.5 h-3.5 mr-1" /> Override
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>

      <Dialog open={overrideOpen} onOpenChange={(o) => { setOverrideOpen(o); if (!o) setOverrideRow(null); }}>
        <DialogContent data-testid="dialog-promote-override">
          <DialogHeader>
            <DialogTitle>Promote DOL rate to project override</DialogTitle>
            <DialogDescription>
              Pre-filled from the cached DOL feed for{" "}
              <span className="font-medium">{overrideRow?.classificationName}</span>
              {overrideRow?.wageDecision ? (
                <> (<span className="font-mono">{overrideRow.wageDecision}</span>)</>
              ) : null}
              . Changes here only affect this project.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="ov-wage">Wage rate *</Label>
              <Input
                id="ov-wage"
                type="number"
                step="0.01"
                value={ovWageRate}
                onChange={(e) => setOvWageRate(e.target.value)}
                data-testid="input-override-wage-rate"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ov-fringe">Fringe rate</Label>
              <Input
                id="ov-fringe"
                type="number"
                step="0.01"
                value={ovFringeRate}
                onChange={(e) => setOvFringeRate(e.target.value)}
                data-testid="input-override-fringe-rate"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ov-ot">OT multiplier</Label>
              <Input
                id="ov-ot"
                type="number"
                step="0.1"
                value={ovOtMultiplier}
                onChange={(e) => setOvOtMultiplier(e.target.value)}
                data-testid="input-override-ot-multiplier"
              />
            </div>
            <div className="space-y-1">
              <Label>Total rate</Label>
              <div className="h-9 flex items-center px-2 rounded-md border bg-muted text-sm font-mono" data-testid="text-override-total-rate">
                ${totalForOverride}
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ov-effective">Effective date *</Label>
              <Input
                id="ov-effective"
                type="date"
                value={ovEffectiveDate}
                onChange={(e) => setOvEffectiveDate(e.target.value)}
                data-testid="input-override-effective-date"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ov-expiration">Expiration date</Label>
              <Input
                id="ov-expiration"
                type="date"
                value={ovExpirationDate}
                onChange={(e) => setOvExpirationDate(e.target.value)}
                data-testid="input-override-expiration-date"
              />
            </div>
            <div className="space-y-1 col-span-2">
              <Label htmlFor="ov-notes">Notes</Label>
              <Input
                id="ov-notes"
                value={ovNotes}
                onChange={(e) => setOvNotes(e.target.value)}
                placeholder="Optional"
                data-testid="input-override-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverrideOpen(false)} data-testid="button-cancel-override">Cancel</Button>
            <Button
              onClick={() => {
                if (!ovWageRate || !ovEffectiveDate) {
                  toast({ title: "Missing fields", description: "Wage rate and effective date are required.", variant: "destructive" });
                  return;
                }
                if (!overrideRow) return;
                // Task #1382: if this DOL feed row's classification has no
                // matching org row yet, prompt the user to confirm whether
                // they really want to create a brand-new classification or
                // map onto an existing one. Real-id rows skip the dialog.
                const isSynthetic = overrideRow.classificationId.startsWith("dol-feed:");
                const proposedName = overrideRow.classificationName.trim().toLowerCase();
                const matchedExisting = isSynthetic
                  ? orgClassifications.find((c) => c.name.trim().toLowerCase() === proposedName)
                  : null;
                if (isSynthetic && !matchedExisting) {
                  setPickedExistingId("");
                  setConfirmCreateOpen(true);
                  return;
                }
                if (matchedExisting) {
                  // Name already exists in this org -- skip the dialog and
                  // map onto the real id so we don't even risk a duplicate.
                  overrideMutation.mutate({ classificationIdOverride: matchedExisting.id });
                  return;
                }
                overrideMutation.mutate();
              }}
              disabled={overrideMutation.isPending}
              data-testid="button-save-override"
            >
              {overrideMutation.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</>
              ) : (
                "Save override"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmCreateOpen}
        onOpenChange={(o) => {
          setConfirmCreateOpen(o);
          if (!o) setPickedExistingId("");
        }}
      >
        <DialogContent data-testid="dialog-confirm-create-classification">
          <DialogHeader>
            <DialogTitle>Create new job classification?</DialogTitle>
            <DialogDescription>
              The DOL feed lists{" "}
              <span className="font-medium" data-testid="text-proposed-classification-name">
                {overrideRow?.classificationName}
              </span>
              , but no matching classification exists in your organization yet. Saving will create a brand-new
              classification under this name. If this is just a different spelling of one you already have, pick the
              existing one below instead to avoid duplicates in employee assignments and reports.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="confirm-existing-classification">Map to an existing classification</Label>
              <Select value={pickedExistingId} onValueChange={setPickedExistingId}>
                <SelectTrigger id="confirm-existing-classification" data-testid="select-existing-classification">
                  <SelectValue placeholder={
                    orgClassifications.length === 0
                      ? "No existing classifications"
                      : "Select an existing classification..."
                  } />
                </SelectTrigger>
                <SelectContent>
                  {orgClassifications.map((c) => (
                    <SelectItem
                      key={c.id}
                      value={c.id}
                      data-testid={`option-existing-classification-${c.id}`}
                    >
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {orgClassifications.length === 0
                  ? "Your organization has no job classifications yet."
                  : `${orgClassifications.length} existing classification${orgClassifications.length === 1 ? "" : "s"} available.`}
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setConfirmCreateOpen(false)}
              data-testid="button-cancel-confirm-create"
            >
              Cancel
            </Button>
            <Button
              variant="secondary"
              disabled={!pickedExistingId || overrideMutation.isPending}
              onClick={() => {
                if (!pickedExistingId) return;
                overrideMutation.mutate({ classificationIdOverride: pickedExistingId });
              }}
              data-testid="button-use-existing-classification"
            >
              {overrideMutation.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</>
              ) : (
                "Use selected"
              )}
            </Button>
            <Button
              onClick={() => overrideMutation.mutate({ confirmCreate: true })}
              disabled={overrideMutation.isPending}
              data-testid="button-confirm-create-classification"
            >
              {overrideMutation.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating...</>
              ) : (
                <>
                  <Plus className="w-4 h-4 mr-2" /> Create new
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default function ProjectPayrollTab({ projectId }: { projectId: string }) {
  const { data: summary, isLoading } = useQuery<ProjectPayrollSummary>({
    queryKey: ["/api/projects", projectId, "payroll-summary"],
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24 w-full" />)}
      </div>
    );
  }

  if (!summary) {
    return <div className="text-center py-8 text-muted-foreground">No payroll data available</div>;
  }

  const budgetUsedPercent = summary.laborVsBudget;
  const budgetBarColor = budgetUsedPercent > 90 ? "bg-red-500" : budgetUsedPercent > 70 ? "bg-yellow-500" : "bg-green-500";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Labor Cost to Date</p>
            <p className="text-2xl font-bold" data-testid="text-project-labor-cost">{formatCurrency(summary.laborCostToDate)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Labor vs Budget</p>
            <p className="text-2xl font-bold" data-testid="text-project-labor-budget">
              {summary.budget > 0 ? `${budgetUsedPercent.toFixed(1)}%` : "N/A"}
            </p>
            {summary.budget > 0 && (
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 mt-2">
                <div className={`${budgetBarColor} h-2 rounded-full transition-all`} style={{ width: `${Math.min(budgetUsedPercent, 100)}%` }} />
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Overtime %</p>
            <p className="text-2xl font-bold" data-testid="text-project-overtime-pct">{summary.overtimePercent}%</p>
            <p className="text-xs text-muted-foreground mt-1">
              {summary.totalOvertimeHours.toFixed(1)} OT / {(summary.totalRegularHours + summary.totalOvertimeHours).toFixed(1)} total hrs
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Workers Assigned</p>
            <p className="text-2xl font-bold" data-testid="text-project-workers">{summary.workers.length}</p>
            <p className="text-xs text-muted-foreground mt-1">{summary.totalEntries} time entries</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Workers on This Project</CardTitle>
        </CardHeader>
        <CardContent>
          {summary.workers.length === 0 ? (
            <p className="text-center py-6 text-muted-foreground">No workers have logged time on this project</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Regular Hours</TableHead>
                  <TableHead>OT Hours</TableHead>
                  <TableHead>Total Hours</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.workers.map(w => (
                  <TableRow key={w.userId} data-testid={`row-project-worker-${w.userId}`}>
                    <TableCell className="font-medium">{w.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{w.role}</Badge>
                    </TableCell>
                    <TableCell>{w.regularHours.toFixed(1)}</TableCell>
                    <TableCell>{w.overtimeHours > 0 ? w.overtimeHours.toFixed(1) : "\u2014"}</TableCell>
                    <TableCell className="font-medium">{(w.regularHours + w.overtimeHours).toFixed(1)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <PrevailingWagePanel projectId={projectId} />
    </div>
  );
}
