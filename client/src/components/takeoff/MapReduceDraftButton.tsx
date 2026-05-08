import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Layers, Check } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
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
 */
export function MapReduceDraftButton({ bidId }: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<MapReduceDraftResult | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [fetchingResult, setFetchingResult] = useState(false);

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
        const result = output as MapReduceDraftResult;
        setDraft(result);
        if (result.partial) {
          toast({
            title: "Partial draft",
            description:
              "Some disciplines were skipped. Re-run with a narrower discipline filter to cover the rest.",
          });
        }
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

  useEffect(() => {
    if (!open) {
      setDraft(null);
      setJobId(null);
      setFetchingResult(false);
    }
  }, [open]);

  if (!bidId) return null;

  const isWorking = draftIt.isPending || (!!jobId && !draft);
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
              measurements with per-sheet citations. Designed for 200+ sheet plan sets. Review
              everything below — nothing is added to your takeoff automatically.
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
                          <td colSpan={6} className="p-3 text-center text-muted-foreground" data-testid="text-mapreduce-empty">
                            No measurements produced.
                          </td>
                        </tr>
                      )}
                      {draft.measurements.map((m, i) => (
                        <tr key={i} className="border-t align-top" data-testid={`row-mapreduce-measurement-${i}`}>
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
                <Layers className="h-4 w-4 mr-2" />
                Run map-reduce draft
              </Button>
            ) : (
              <Button
                onClick={() => setOpen(false)}
                data-testid="button-close-mapreduce-draft"
              >
                <Check className="h-4 w-4 mr-2" />
                Done
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
