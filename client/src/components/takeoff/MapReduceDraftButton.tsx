import { Fragment, useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Layers, Check, PlusCircle, ChevronDown, ChevronRight, Unlink, ListChecks } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { ScrollArea as SkippedScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/hooks/use-auth";
import { useDashboardCustomization } from "@/hooks/use-dashboard-customization";
import { isOrganizationAdmin } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { JobProgressBar } from "@/components/JobProgressBar";

// Task #2624 — assembly explosion shape (mirrors DraftFullTakeoffButton).
interface AssemblyComponent {
  componentId: string;
  description: string;
  componentType: "MATERIAL" | "LABOR" | "EQUIPMENT" | "SUB";
  unit: string;
  baseQuantity: number;
  quantity: number;
  componentWasteFactor: number;
  unitCost: number;
  totalCost: number;
}
interface AssemblyExpansion {
  assemblyId: string;
  assemblyName: string;
  drivingQty: number;
  drivingUnit: string;
  drivingMeasurementType: string;
  assemblyWasteFactor: number;
  components: AssemblyComponent[];
}
interface MapReduceMeasurement {
  label: string;
  type: string;
  value: number;
  unit: string;
  costCode: string | null;
  rationale: string;
  sheetCitations: string[];
  contributingDisciplines: string[];
  assembly?: AssemblyExpansion | null;
}

interface SkippedSheetInfo {
  sheetId: string | null;
  sheetIndex: number;
  sheetNumber: string | null;
  sheetName: string | null;
  discipline: string;
}

interface CostSummary {
  callCount: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  byModel: Record<string, { calls: number; tokensIn: number; tokensOut: number; costUsd: number }>;
}

interface MapReduceDraftResult {
  measurements: MapReduceMeasurement[];
  notes: string;
  confidence: number;
  disciplineCoverage: Record<string, number>;
  llmCallCount: number;
  partial: boolean;
  // Task #2626 — surfaced from the server so the dialog can render
  // a transparent cost header + actionable "increase cap and re-run"
  // banner instead of a silent partial badge.
  skippedSheets?: SkippedSheetInfo[];
  recommendedMaxDisciplineBatches?: number;
  appliedMaxDisciplineBatches?: number;
  cost?: CostSummary;
}

interface ApplyFailure {
  index: number;
  label: string;
  reason: string;
}

interface ApplyResponse {
  inserted: number;
  skipped: number;
  insertedIds: string[];
  failed: ApplyFailure[];
  // Task #2617 — review-batch identity returned by the apply endpoint.
  groupName?: string;
  groupIds?: string[];
  // Task #2630 — Per-sheet group pairing so the "Review batch" toast
  // action can jump to the right sheet AND set the measurements
  // panel group filter to the freshly-created group.
  groupBySheet?: Array<{ sheetId: string; groupId: string }>;
}

export interface ReviewBatchTarget {
  groupName: string;
  groupBySheet: Array<{ sheetId: string; groupId: string }>;
  groupIds: string[];
}

interface Props {
  bidId?: string;
  /**
   * Task #2630 — When wired, the "Added to takeoff" toast surfaces a
   * "Review batch" action that hands the freshly-created group(s)
   * back to the workspace so it can jump to the relevant sheet and
   * scope the measurements panel to the new group id. Optional so
   * standalone embedders (storybook, tests) keep working without a
   * workspace context.
   */
  onReviewBatch?: (target: ReviewBatchTarget) => void;
}

/**
 * Task #2590 — surfaces the map-reduce drafter that scales across the
 * full plan set (200+ sheets). Distinct from `DraftFullTakeoffButton`
 * which uses the single-shot drafter; this one calls
 * `POST /api/ai-estimator/draft/map-reduce` directly and renders the
 * per-sheet citations on every measurement.
 *
 * Task #2606 — routes the call through the `ai_estimator_draft` job
 * queue (`async: true`) so the dialog can render `<JobProgressBar />`
 * with live per-discipline progress instead of a static spinner. The
 * final draft is fetched from `/api/jobs/:id` once the SSE channel
 * reports the job completed.
 *
 * Task #2605 — the dialog is no longer review-only: each row has a
 * checkbox and "Add selected to takeoff" pushes the chosen rows into
 * `takeoff_measurements` (DRAFT/AI source) so estimators can promote
 * the AI draft into their workspace with one click. Sheet citations
 * are preserved on the `note` + `metadata` of each inserted row.
 */
export function MapReduceDraftButton({ bidId, onReviewBatch }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // Task #2626 (rev 2) — only admins with the AI Estimator manage
  // permission can persist a new cap. Non-admins see the recommendation
  // and skipped sheets but the action button is disabled with a hint.
  const { user, permissionRole } = useAuth();
  const { permissions } = useDashboardCustomization();
  const canRaiseCap = permissions
    ? !!permissions.canManageAiEstimator
    : isOrganizationAdmin(permissionRole ?? user?.role);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<MapReduceDraftResult | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [fetchingResult, setFetchingResult] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [lastFailed, setLastFailed] = useState<ApplyFailure[]>([]);
  // Task #2624 — Per-row UI state for assembly review (see DraftFullTakeoffButton).
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [detached, setDetached] = useState<Set<string>>(new Set());
  const [flatten, setFlatten] = useState<Set<number>>(new Set());
  const toggleExpanded = (i: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  // Default to all selected — the most common workflow is "accept
  // everything the AI found" with the option to uncheck a few.
  const acceptDraft = (result: MapReduceDraftResult) => {
    setDraft(result);
    setSelected(new Set(result.measurements.map((_, i) => i)));
    if (result.partial) {
      toast({
        title: "Partial draft",
        description:
          "Some disciplines were skipped. Re-run with a narrower discipline filter to cover the rest.",
      });
    }
  };

  const draftIt = useMutation({
    mutationFn: async (): Promise<{ jobId?: string }> => {
      const r = await apiRequest("POST", "/api/ai-estimator/draft/map-reduce", {
        bidId,
        async: true,
      });
      return (await r.json()) as { jobId?: string };
    },
    onSuccess: (data) => {
      if (data.jobId) {
        setJobId(data.jobId);
      } else {
        toast({
          title: "Map-reduce draft failed",
          description: "No job id returned",
          variant: "destructive",
        });
      }
    },
    onError: (err: Error) =>
      toast({ title: "Map-reduce draft failed", description: err.message, variant: "destructive" }),
  });

  // Task #2626 — actionable "increase cap and re-run" path. Persists the
  // recommended cap on `aiEstimatorOrgFactors` then immediately enqueues
  // a fresh map-reduce job so the user sees the larger plan-set covered
  // without leaving the dialog.
  const raiseCapAndRerun = useMutation({
    mutationFn: async (newCap: number): Promise<{ jobId?: string }> => {
      await apiRequest("PUT", "/api/ai-estimator/org-factors", {
        maxDisciplineBatches: newCap,
      });
      const r = await apiRequest("POST", "/api/ai-estimator/draft/map-reduce", {
        bidId,
        async: true,
      });
      return (await r.json()) as { jobId?: string };
    },
    onSuccess: (data) => {
      if (data.jobId) {
        setDraft(null);
        setSelected(new Set());
        setJobId(data.jobId);
      } else {
        toast({
          title: "Map-reduce draft failed",
          description: "No job id returned",
          variant: "destructive",
        });
      }
    },
    onError: (err: Error) =>
      toast({ title: "Failed to raise cap", description: err.message, variant: "destructive" }),
  });

  const handleJobComplete = async (id: string) => {
    if (fetchingResult || draft) return;
    setFetchingResult(true);
    try {
      const r = await apiRequest("GET", `/api/jobs/${id}`);
      const status = await r.json();
      const output = (status?.output ?? null) as
        | (MapReduceDraftResult & { fallback?: undefined })
        | { fallback: true; blocked?: boolean; message?: string }
        | null;
      if (output && "fallback" in output && output.fallback) {
        toast({
          title: "Map-reduce draft failed",
          description: output.message ?? "AI returned no usable draft",
          variant: "destructive",
        });
        setJobId(null);
      } else if (output && Array.isArray((output as MapReduceDraftResult).measurements)) {
        acceptDraft(output as MapReduceDraftResult);
      } else {
        toast({
          title: "Map-reduce draft failed",
          description: "No draft payload returned",
          variant: "destructive",
        });
        setJobId(null);
      }
    } catch (err) {
      toast({
        title: "Failed to load draft",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
      setJobId(null);
    } finally {
      setFetchingResult(false);
    }
  };

  const handleJobFail = (_id: string, message?: string) => {
    toast({
      title: "Map-reduce draft failed",
      description: message ?? "Background draft failed",
      variant: "destructive",
    });
    setJobId(null);
  };

  const applySelected = useMutation({
    mutationFn: async (): Promise<{ response: ApplyResponse; pickIndexes: number[] }> => {
      if (!draft || !bidId) throw new Error("No draft to apply");
      // Build the request in a stable order and remember the
      // draft-index each picks-index corresponds to so we can map
      // server-reported failure indexes back to the right draft row
      // even when two rows share the same label.
      const pickIndexes = Array.from(selected).sort((a, b) => a - b);
      const picks = pickIndexes
        .map((i) => draft.measurements[i])
        .filter((m): m is MapReduceMeasurement => !!m);
      if (picks.length === 0) throw new Error("Select at least one measurement");
      const r = await apiRequest("POST", "/api/ai-estimator/draft/map-reduce/apply", {
        bidId,
        measurements: picks,
      });
      const response = (await r.json()) as ApplyResponse;
      return { response, pickIndexes };
    },
    onSuccess: ({ response: data, pickIndexes }) => {
      const failed = data.failed ?? [];
      setLastFailed(failed);
      // Task #2630 — Build the "Review batch" toast action when the
      // workspace wired the callback AND the apply call actually
      // produced one or more groups. We close our own dialog before
      // handing off so the user lands directly on the scoped table.
      const groupBySheet = data.groupBySheet ?? [];
      const reviewTarget: ReviewBatchTarget | null =
        onReviewBatch && data.inserted > 0 && data.groupName && groupBySheet.length > 0
          ? {
              groupName: data.groupName,
              groupBySheet,
              groupIds: data.groupIds ?? groupBySheet.map((g) => g.groupId),
            }
          : null;
      const description =
        `${data.inserted} measurement${data.inserted === 1 ? "" : "s"} added as DRAFT` +
        (reviewTarget ? ` to "${reviewTarget.groupName}".` : ".") +
        (failed.length > 0 ? ` ${failed.length} failed — see details below.` : "");
      toast({
        title: failed.length > 0 ? "Added with errors" : "Added to takeoff",
        description,
        variant: failed.length > 0 ? "destructive" : undefined,
        action: reviewTarget
          ? (
              <ToastAction
                altText={`Review batch ${reviewTarget.groupName}`}
                onClick={() => {
                  setOpen(false);
                  onReviewBatch?.(reviewTarget);
                }}
                data-testid="button-review-mapreduce-batch"
              >
                <ListChecks className="h-3.5 w-3.5 mr-1" />
                Review batch
              </ToastAction>
            )
          : undefined,
      });
      // Refresh the workspace measurements lists. We don't know the
      // selected sheet from inside this dialog, so invalidate every
      // cache key that starts with the takeoff sheets prefix — the
      // bid-wide and standalone "all-measurements" hooks key on the
      // same prefix and TanStack v5 partial-match handles both.
      queryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets"] });
      queryClient.invalidateQueries({ queryKey: [`/api/bids/${bidId}/takeoff/all-measurements`] });
      // Drop the rows that were inserted successfully so the user can't
      // double-add them, but keep failed rows in the table so they can
      // edit/retry. The server's `failed[].index` is the position in
      // the picks array we sent, so map that back through `pickIndexes`
      // to the original draft row — this stays correct even when two
      // selected rows share the same label.
      if (draft) {
        const failedDraftIndexes = new Set(
          failed
            .map((f) => pickIndexes[f.index])
            .filter((i): i is number => typeof i === "number"),
        );
        const remaining = draft.measurements.filter((_, i) => {
          if (!selected.has(i)) return true;
          // Keep rows that failed so the estimator can retry them.
          return failedDraftIndexes.has(i);
        });
        setDraft({ ...draft, measurements: remaining });
        setSelected(new Set());
      }
    },
    onError: (err: Error) =>
      toast({ title: "Failed to add to takeoff", description: err.message, variant: "destructive" }),
  });

  useEffect(() => {
    if (!open) {
      setDraft(null);
      setJobId(null);
      setFetchingResult(false);
      setSelected(new Set());
      setLastFailed([]);
      setExpanded(new Set());
      setDetached(new Set());
      setFlatten(new Set());
    }
  }, [open]);

  const allSelected = useMemo(() => {
    if (!draft || draft.measurements.length === 0) return false;
    return selected.size === draft.measurements.length;
  }, [draft, selected]);

  const toggleAll = (checked: boolean) => {
    if (!draft) return;
    setSelected(checked ? new Set(draft.measurements.map((_, i) => i)) : new Set());
  };
  const toggleOne = (i: number, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(i);
      else next.delete(i);
      return next;
    });
  };

  if (!bidId) return null;

  const isWorking = draftIt.isPending || (!!jobId && !draft);
  const isApplying = applySelected.isPending;
  const coverageEntries = draft ? Object.entries(draft.disciplineCoverage) : [];

  return (
    <>
      <Button
        variant="outline"
        className="w-full"
        size="sm"
        onClick={() => setOpen(true)}
        data-testid="button-draft-from-full-plan-set"
      >
        <Layers className="h-4 w-4 mr-2" />
        Draft from full plan set
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Draft from full plan set (map-reduce)</DialogTitle>
            <DialogDescription>
              Walks every indexed plan sheet on this bid, batches them by discipline, and produces
              measurements with per-sheet citations. Designed for 200+ sheet plan sets. Pick the
              rows you want and click "Add selected to takeoff" — they land as DRAFT measurements
              you can review in the workspace.
            </DialogDescription>
          </DialogHeader>

          {!draft && !jobId && (
            <div className="py-3 text-sm text-muted-foreground" data-testid="text-mapreduce-explainer">
              This may take a few minutes for large plan sets. The drafter scopes work to the
              disciplines it detects on the indexed sheets and caps the work per discipline so a
              single noisy section can't bankrupt the AI budget.
            </div>
          )}

          {jobId && !draft && (
            <div className="py-3" data-testid="text-mapreduce-working">
              <JobProgressBar
                jobId={jobId}
                fallbackMessage="Reading indexed plan sheets..."
                onComplete={handleJobComplete}
                onFail={handleJobFail}
                testIdPrefix="job-progress-mapreduce-draft"
              />
            </div>
          )}

          {draft && (
            <ScrollArea className="flex-1 pr-2">
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2 items-center">
                  <Badge variant="outline" data-testid="badge-mapreduce-confidence">
                    Confidence: {draft.confidence}%
                  </Badge>
                  <Badge variant="secondary" data-testid="badge-mapreduce-llm-calls">
                    LLM calls: {draft.llmCallCount}
                  </Badge>
                  {draft.cost && draft.cost.callCount > 0 && (
                    <Badge variant="secondary" data-testid="badge-mapreduce-cost">
                      AI spend: ${draft.cost.costUsd.toFixed(4)} · {draft.cost.tokensIn.toLocaleString()} in / {draft.cost.tokensOut.toLocaleString()} out
                    </Badge>
                  )}
                  {draft.partial && (
                    <Badge variant="destructive" data-testid="badge-mapreduce-partial">
                      Partial
                    </Badge>
                  )}
                  <Badge variant="outline" data-testid="badge-mapreduce-selected-count">
                    {selected.size}/{draft.measurements.length} selected
                  </Badge>
                  {coverageEntries.map(([disc, n]) => (
                    <Badge key={disc} variant="outline" className="font-mono text-[10px]" data-testid={`badge-mapreduce-coverage-${disc}`}>
                      {disc}: {n} pages
                    </Badge>
                  ))}
                </div>
                {draft.skippedSheets && draft.skippedSheets.length > 0 && draft.recommendedMaxDisciplineBatches && draft.appliedMaxDisciplineBatches && (
                  <div
                    className="rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 p-3 text-sm"
                    data-testid="banner-mapreduce-skipped-sheets"
                  >
                    <div className="font-medium text-amber-900 dark:text-amber-200">
                      {draft.skippedSheets.length} sheet{draft.skippedSheets.length === 1 ? "" : "s"} skipped because the per-discipline batch cap was reached.
                    </div>
                    <div className="mt-1 text-amber-800 dark:text-amber-300">
                      Current cap: <span className="font-mono">{draft.appliedMaxDisciplineBatches}</span>.
                      Increase to <span className="font-mono">{draft.recommendedMaxDisciplineBatches}</span> to cover every sheet on this bid.
                    </div>
                    {/* Task #2626 (rev 2) — explicit list of skipped sheets so the
                        estimator can verify which drawings were left out instead
                        of trusting an opaque count. */}
                    <SkippedScrollArea className="mt-2 max-h-40 rounded border border-amber-200 dark:border-amber-800 bg-white dark:bg-amber-950/20">
                      <table className="w-full text-xs" data-testid="table-mapreduce-skipped-sheets">
                        <thead className="bg-amber-100 dark:bg-amber-900/40 sticky top-0">
                          <tr>
                            <th className="text-left px-2 py-1 font-medium text-amber-900 dark:text-amber-200">Sheet #</th>
                            <th className="text-left px-2 py-1 font-medium text-amber-900 dark:text-amber-200">Name</th>
                            <th className="text-left px-2 py-1 font-medium text-amber-900 dark:text-amber-200">Discipline</th>
                          </tr>
                        </thead>
                        <tbody>
                          {draft.skippedSheets.map((s, i) => (
                            <tr
                              key={`${s.sheetId ?? "noid"}-${s.sheetIndex}-${i}`}
                              className="border-t border-amber-100 dark:border-amber-900/60"
                              data-testid={`row-mapreduce-skipped-${s.sheetId ?? `idx-${s.sheetIndex}`}`}
                            >
                              <td className="px-2 py-1 font-mono text-amber-900 dark:text-amber-200">
                                {s.sheetNumber ?? `#${s.sheetIndex + 1}`}
                              </td>
                              <td className="px-2 py-1 text-amber-900 dark:text-amber-200">
                                {s.sheetName ?? <span className="text-amber-700 dark:text-amber-400 italic">(unnamed)</span>}
                              </td>
                              <td className="px-2 py-1 font-mono text-amber-800 dark:text-amber-300">
                                {s.discipline}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </SkippedScrollArea>
                    <div className="mt-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={raiseCapAndRerun.isPending || isWorking || !canRaiseCap}
                        onClick={() => raiseCapAndRerun.mutate(draft.recommendedMaxDisciplineBatches!)}
                        data-testid="button-mapreduce-raise-cap-and-rerun"
                        title={canRaiseCap ? undefined : "Only admins with the AI Estimator management permission can change the per-discipline batch cap."}
                      >
                        {raiseCapAndRerun.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        Increase cap to {draft.recommendedMaxDisciplineBatches} and re-run
                      </Button>
                      {!canRaiseCap && (
                        <p className="mt-1 text-xs text-amber-800 dark:text-amber-300" data-testid="text-mapreduce-raise-cap-blocked">
                          Ask an admin with the AI Estimator management permission to raise the cap.
                        </p>
                      )}
                    </div>
                  </div>
                )}
                {draft.notes && (
                  <p className="text-sm text-muted-foreground" data-testid="text-mapreduce-notes">
                    {draft.notes}
                  </p>
                )}
                <div className="border rounded-md overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted">
                      <tr>
                        <th className="text-left p-2 w-8">
                          <Checkbox
                            checked={allSelected}
                            onCheckedChange={(c) => toggleAll(c === true)}
                            disabled={draft.measurements.length === 0 || isApplying}
                            aria-label="Select all measurements"
                            data-testid="checkbox-mapreduce-select-all"
                          />
                        </th>
                        <th className="text-left p-2">Label</th>
                        <th className="text-left p-2">Type</th>
                        <th className="text-right p-2">Value</th>
                        <th className="text-left p-2">Unit</th>
                        <th className="text-left p-2">Cost code</th>
                        <th className="text-left p-2">Sheet citations</th>
                      </tr>
                    </thead>
                    <tbody>
                      {draft.measurements.length === 0 && (
                        <tr>
                          <td colSpan={7} className="p-3 text-center text-muted-foreground" data-testid="text-mapreduce-empty">
                            No measurements produced.
                          </td>
                        </tr>
                      )}
                      {draft.measurements.map((m, i) => {
                        const hasAssembly = !!m.assembly && !flatten.has(i);
                        const isOpen = expanded.has(i);
                        return (
                          <Fragment key={i}>
                            <tr className="border-t align-top" data-testid={`row-mapreduce-measurement-${i}`}>
                              <td className="p-2">
                                <Checkbox
                                  checked={selected.has(i)}
                                  onCheckedChange={(c) => toggleOne(i, c === true)}
                                  disabled={isApplying}
                                  aria-label={`Select measurement ${m.label}`}
                                  data-testid={`checkbox-mapreduce-measurement-${i}`}
                                />
                              </td>
                              <td className="p-2">
                                <div className="flex items-center gap-1">
                                  {hasAssembly ? (
                                    <button
                                      type="button"
                                      onClick={() => toggleExpanded(i)}
                                      className="hover:bg-muted rounded p-0.5"
                                      aria-label={isOpen ? "Collapse assembly" : "Expand assembly"}
                                      data-testid={`button-expand-mapreduce-assembly-${i}`}
                                    >
                                      {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                    </button>
                                  ) : (
                                    <span className="w-4 inline-block" />
                                  )}
                                  <span>{m.label}</span>
                                  {hasAssembly && (
                                    <Badge
                                      variant="secondary"
                                      className="ml-1 gap-1 text-[10px]"
                                      data-testid={`badge-mapreduce-assembly-${i}`}
                                    >
                                      <Layers className="h-3 w-3" />
                                      {m.assembly!.assemblyName}
                                    </Badge>
                                  )}
                                </div>
                              </td>
                              <td className="p-2">{m.type}</td>
                              <td className="p-2 text-right tabular-nums">{m.value}</td>
                              <td className="p-2">{m.unit}</td>
                              <td className="p-2 font-mono">
                                <div className="flex items-center justify-between gap-2">
                                  <span>{m.costCode ?? "—"}</span>
                                  {hasAssembly && (
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-5 w-5"
                                      onClick={() => setFlatten((prev) => new Set(prev).add(i))}
                                      title="Reject assembly — keep flat line"
                                      data-testid={`button-detach-mapreduce-assembly-${i}`}
                                    >
                                      <Unlink className="h-3 w-3" />
                                    </Button>
                                  )}
                                </div>
                              </td>
                              <td className="p-2">
                                <div className="flex flex-wrap gap-1" data-testid={`citations-mapreduce-measurement-${i}`}>
                                  {m.sheetCitations.length === 0 ? (
                                    <span className="text-muted-foreground">—</span>
                                  ) : (
                                    m.sheetCitations.map((c) => (
                                      <Badge key={c} variant="outline" className="font-mono text-[10px]">
                                        {c}
                                      </Badge>
                                    ))
                                  )}
                                </div>
                              </td>
                            </tr>
                            {hasAssembly && isOpen &&
                              m.assembly!.components.map((c) => {
                                const key = `${i}:${c.componentId}`;
                                const isDetached = detached.has(key);
                                const wastePct = Math.round(
                                  (m.assembly!.assemblyWasteFactor + c.componentWasteFactor) * 100,
                                );
                                return (
                                  <tr
                                    key={`comp-${c.componentId}`}
                                    className="border-t bg-muted/40"
                                    data-testid={`row-mapreduce-assembly-component-${i}-${c.componentId}`}
                                  >
                                    <td className="p-2"></td>
                                    <td className="p-2 pl-8">
                                      <span className={isDetached ? "line-through text-muted-foreground" : ""}>
                                        {c.description}
                                      </span>
                                      <span className="ml-2 text-[10px] text-muted-foreground uppercase">
                                        {c.componentType}
                                      </span>
                                    </td>
                                    <td className="p-2 text-muted-foreground">—</td>
                                    <td className={`p-2 text-right tabular-nums ${isDetached ? "line-through text-muted-foreground" : ""}`}>
                                      {c.quantity}
                                      {wastePct > 0 && (
                                        <span className="ml-1 text-[10px] text-muted-foreground">
                                          ({wastePct}% waste)
                                        </span>
                                      )}
                                    </td>
                                    <td className="p-2">{c.unit}</td>
                                    <td className="p-2 font-mono">
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="text-muted-foreground">
                                          ${c.totalCost.toFixed(2)}
                                        </span>
                                        <Button
                                          size="icon"
                                          variant="ghost"
                                          className="h-5 w-5"
                                          onClick={() =>
                                            setDetached((prev) => {
                                              const next = new Set(prev);
                                              if (next.has(key)) next.delete(key);
                                              else next.add(key);
                                              return next;
                                            })
                                          }
                                          title={isDetached ? "Restore component" : "Detach component"}
                                          data-testid={`button-detach-mapreduce-component-${i}-${c.componentId}`}
                                        >
                                          <Unlink className="h-3 w-3" />
                                        </Button>
                                      </div>
                                    </td>
                                    <td className="p-2"></td>
                                  </tr>
                                );
                              })}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {lastFailed.length > 0 && (
                  <div
                    className="border border-destructive/50 rounded-md p-3 bg-destructive/5"
                    data-testid="section-mapreduce-failed"
                  >
                    <div className="text-sm font-medium text-destructive mb-2">
                      {lastFailed.length} measurement{lastFailed.length === 1 ? "" : "s"} failed to insert
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">
                      These rows are kept in the table above so you can edit them and try again.
                    </p>
                    <ul className="space-y-1 text-xs">
                      {lastFailed.map((f, i) => (
                        <li
                          key={`${f.label}-${i}`}
                          className="flex flex-col"
                          data-testid={`row-mapreduce-failed-${i}`}
                        >
                          <span className="font-medium" data-testid={`text-mapreduce-failed-label-${i}`}>
                            {f.label}
                          </span>
                          <span
                            className="text-muted-foreground font-mono"
                            data-testid={`text-mapreduce-failed-reason-${i}`}
                          >
                            {f.reason}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </ScrollArea>
          )}

          <DialogFooter>
            {!draft ? (
              <Button
                onClick={() => draftIt.mutate()}
                disabled={isWorking}
                data-testid="button-run-mapreduce-draft"
              >
                {isWorking ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Layers className="h-4 w-4 mr-2" />
                )}
                Run map-reduce draft
              </Button>
            ) : (
              <div className="flex gap-2 w-full justify-end">
                <Button
                  variant="ghost"
                  onClick={() => setOpen(false)}
                  disabled={isApplying}
                  data-testid="button-close-mapreduce-draft"
                >
                  <Check className="h-4 w-4 mr-2" />
                  Done
                </Button>
                <Button
                  onClick={() => applySelected.mutate()}
                  disabled={isApplying || selected.size === 0 || draft.measurements.length === 0}
                  data-testid="button-apply-mapreduce-draft"
                >
                  {isApplying ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <PlusCircle className="h-4 w-4 mr-2" />
                  )}
                  Add selected to takeoff ({selected.size})
                </Button>
              </div>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
