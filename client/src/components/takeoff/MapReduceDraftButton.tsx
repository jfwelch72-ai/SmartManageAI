import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Layers, Check, PlusCircle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
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

interface MapReduceMeasurement {
  label: string;
  type: string;
  value: number;
  unit: string;
  costCode: string | null;
  rationale: string;
  sheetCitations: string[];
  contributingDisciplines: string[];
}

interface MapReduceDraftResult {
  measurements: MapReduceMeasurement[];
  notes: string;
  confidence: number;
  disciplineCoverage: Record<string, number>;
  llmCallCount: number;
  partial: boolean;
}

interface ApplyResponse {
  inserted: number;
  skipped: number;
  insertedIds: string[];
}

interface Props {
  bidId?: string;
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
export function MapReduceDraftButton({ bidId }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<MapReduceDraftResult | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [fetchingResult, setFetchingResult] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

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
    mutationFn: async (): Promise<ApplyResponse> => {
      if (!draft || !bidId) throw new Error("No draft to apply");
      const picks = Array.from(selected)
        .sort((a, b) => a - b)
        .map((i) => draft.measurements[i])
        .filter((m): m is MapReduceMeasurement => !!m);
      if (picks.length === 0) throw new Error("Select at least one measurement");
      const r = await apiRequest("POST", "/api/ai-estimator/draft/map-reduce/apply", {
        bidId,
        measurements: picks,
      });
      return (await r.json()) as ApplyResponse;
    },
    onSuccess: (data) => {
      toast({
        title: "Added to takeoff",
        description:
          `${data.inserted} measurement${data.inserted === 1 ? "" : "s"} added as DRAFT.` +
          (data.skipped > 0 ? ` ${data.skipped} skipped.` : ""),
      });
      // Refresh the workspace measurements lists. We don't know the
      // selected sheet from inside this dialog, so invalidate every
      // cache key that starts with the takeoff sheets prefix — the
      // bid-wide and standalone "all-measurements" hooks key on the
      // same prefix and TanStack v5 partial-match handles both.
      queryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets"] });
      queryClient.invalidateQueries({ queryKey: [`/api/bids/${bidId}/takeoff/all-measurements`] });
      // Drop the rows that were just applied so the user can't double-add them.
      if (draft) {
        const remaining = draft.measurements.filter((_, i) => !selected.has(i));
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
                      {draft.measurements.map((m, i) => (
                        <tr key={i} className="border-t align-top" data-testid={`row-mapreduce-measurement-${i}`}>
                          <td className="p-2">
                            <Checkbox
                              checked={selected.has(i)}
                              onCheckedChange={(c) => toggleOne(i, c === true)}
                              disabled={isApplying}
                              aria-label={`Select measurement ${m.label}`}
                              data-testid={`checkbox-mapreduce-measurement-${i}`}
                            />
                          </td>
                          <td className="p-2">{m.label}</td>
                          <td className="p-2">{m.type}</td>
                          <td className="p-2 text-right tabular-nums">{m.value}</td>
                          <td className="p-2">{m.unit}</td>
                          <td className="p-2 font-mono">{m.costCode ?? "—"}</td>
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
                      ))}
                    </tbody>
                  </table>
                </div>
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
