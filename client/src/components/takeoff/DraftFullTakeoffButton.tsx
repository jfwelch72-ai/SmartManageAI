import { Fragment, useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Sparkles, Check, ChevronDown, ChevronRight, Layers, Unlink } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { JobProgressBar } from "@/components/JobProgressBar";

// Task #2624 — assembly explosion shape returned by the auto-takeoff
// drafter when an AI line matched an org assembly. Optional — if absent
// the row renders as a flat line (legacy behavior).
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
interface DraftMeasurement {
  label: string;
  type: string;
  value: number;
  unit: string;
  costCode: string | null;
  rationale: string;
  assembly?: AssemblyExpansion | null;
}

interface Props {
  bidId?: string;
  projectId?: string;
  // Task #2551 — Standalone takeoff source.
  standaloneTakeoffId?: string;
}

interface CostSummary {
  callCount: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  byModel: Record<string, { calls: number; tokensIn: number; tokensOut: number; costUsd: number }>;
}

interface DraftResult {
  measurements: DraftMeasurement[];
  notes: string;
  confidence: number;
  // Task #2626 — aggregated AI spend rendered on the draft header.
  cost?: CostSummary;
}

/**
 * "Draft full takeoff" — sends the project's plan documents to the AI Estimator
 * service which scopes by org and caps the work. Task #2530 — runs the work via
 * the `ai_estimator_draft` queue so the dialog can show a real progress bar
 * driven by `useJobProgress` instead of a static spinner.
 */
export function DraftFullTakeoffButton({ bidId, projectId, standaloneTakeoffId }: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [scopeNotes, setScopeNotes] = useState("");
  const [draft, setDraft] = useState<DraftResult | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [fetchingResult, setFetchingResult] = useState(false);
  // Task #2624 — Per-row local UI state for the assembly review UX.
  // `expanded` tracks which assembly parents are open. `detached` is a
  // set of `${rowIdx}:${componentId}` keys that the estimator has
  // removed from the draft (rendered struck-through). `flatten` is the
  // set of row indexes where the estimator rejected the assembly back
  // to the original flat line.
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

  // Task #2517 / #2530 — POST enqueues an `ai_estimator_draft` job and
  // returns `{ jobId }`. The dialog then drives a live progress bar via
  // `useJobProgress` (SSE) and pulls the final draft via
  // `handleJobComplete` once the job reports `completed`.
  const draftIt = useMutation({
    mutationFn: async (): Promise<{ jobId?: string }> => {
      const r = await apiRequest("POST", "/api/ai-estimator/draft-takeoff", {
        // Task #2577 Phase B — pass `bidId` so the server routes the
        // draft through the map-reduce drafter (sheet-cited, scales to
        // 200+ sheets) instead of the legacy 8-doc path.
        bidId,
        projectId,
        standaloneTakeoffId,
        scopeNotes: scopeNotes.trim() || undefined,
        async: true,
      });
      return (await r.json()) as { jobId?: string };
    },
    onSuccess: (data: { jobId?: string }) => {
      if (data.jobId) {
        setJobId(data.jobId);
      } else {
        toast({ title: "Draft failed", description: "No job id returned", variant: "destructive" });
      }
    },
    onError: (err: Error) => toast({ title: "Draft failed", description: err.message, variant: "destructive" }),
  });

  const sendFeedback = useMutation({
    mutationFn: async (outcome: "ACCEPTED" | "REJECTED") =>
      apiRequest("POST", "/api/ai-estimator/feedback", {
        surface: "takeoff_draft",
        outcome,
        targetType: "draft_takeoff",
        projectId,
      }),
  });

  // Once the SSE channel reports the job completed, fetch the result
  // payload from the job-status endpoint and surface it in the dialog.
  const handleJobComplete = async (id: string) => {
    if (fetchingResult || draft) return;
    setFetchingResult(true);
    try {
      const r = await apiRequest("GET", `/api/jobs/${id}`);
      const status = await r.json();
      const output = (status?.output ?? null) as
        | { result?: DraftResult | null; reason?: string; blocked?: boolean }
        | DraftResult
        | null;
      // The handler returns the raw `draftTakeoffFromPlans` envelope.
      const envelope = (output ?? {}) as { result?: DraftResult | null; reason?: string };
      if (envelope.result) {
        setDraft(envelope.result);
      } else if ((output as DraftResult)?.measurements) {
        setDraft(output as DraftResult);
      } else {
        toast({
          title: "No takeoff drafted",
          description: envelope.reason ?? "AI returned no usable draft",
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
      // Clear the jobId so the progress bar / "completed" callback won't
      // re-fire on the same status, leaving the UI stuck. The user can
      // re-trigger the draft via the action button.
      setJobId(null);
    } finally {
      setFetchingResult(false);
    }
  };

  const handleJobFail = (_id: string, message?: string) => {
    toast({
      title: "Draft failed",
      description: message ?? "Background draft failed",
      variant: "destructive",
    });
    setJobId(null);
  };

  // Reset state when dialog closes.
  useEffect(() => {
    if (!open) {
      setDraft(null);
      setJobId(null);
      setFetchingResult(false);
      setExpanded(new Set());
      setDetached(new Set());
      setFlatten(new Set());
    }
  }, [open]);

  const isWorking = draftIt.isPending || (!!jobId && !draft);

  // Task #2577 Phase B — `bidId` is now a first-class entrypoint
  // (the bid-context AI panel passes only `bidId`, no `projectId`).
  // Guard must allow that path so estimators can trigger the
  // map-reduce drafter from the takeoff workspace.
  if (!projectId && !standaloneTakeoffId && !bidId) return null;

  return (
    <>
      <Button
        variant="outline"
        className="w-full"
        size="sm"
        onClick={() => setOpen(true)}
        data-testid="button-draft-full-takeoff"
      >
        <Sparkles className="h-4 w-4 mr-2" />
        Draft full takeoff (AI Estimator)
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Draft full takeoff from plans</DialogTitle>
            <DialogDescription>
              Reads the plan documents on this project (capped at 8 for performance) and produces an initial measurement
              list. You review and accept manually — nothing is added to your takeoff automatically.
            </DialogDescription>
          </DialogHeader>

          {!draft && !jobId && (
            <div className="space-y-3 py-2">
              <label className="text-sm font-medium">Scope notes (optional)</label>
              <Textarea
                value={scopeNotes}
                onChange={(e) => setScopeNotes(e.target.value)}
                placeholder="What scope should the takeoff focus on?"
                className="min-h-[100px]"
                data-testid="input-takeoff-scope-notes"
              />
            </div>
          )}

          {jobId && !draft && (
            <div className="py-3">
              <JobProgressBar
                jobId={jobId}
                fallbackMessage="Reading plan documents..."
                onComplete={handleJobComplete}
                onFail={handleJobFail}
                testIdPrefix="job-progress-draft-takeoff"
              />
            </div>
          )}

          {draft && (
            <ScrollArea className="flex-1 pr-2">
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2 items-center">
                  <Badge variant="outline" data-testid="badge-draft-confidence">Confidence: {draft.confidence}%</Badge>
                  {draft.cost && draft.cost.callCount > 0 && (
                    <Badge variant="secondary" data-testid="badge-draft-cost">
                      AI spend: ${draft.cost.costUsd.toFixed(4)} · {draft.cost.tokensIn.toLocaleString()} in / {draft.cost.tokensOut.toLocaleString()} out · {draft.cost.callCount} call{draft.cost.callCount === 1 ? "" : "s"}
                    </Badge>
                  )}
                </div>
                {draft.notes && <p className="text-sm text-muted-foreground">{draft.notes}</p>}
                <div className="border rounded-md overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted">
                      <tr>
                        <th className="text-left p-2">Label</th>
                        <th className="text-left p-2">Type</th>
                        <th className="text-right p-2">Value</th>
                        <th className="text-left p-2">Unit</th>
                        <th className="text-left p-2">Cost code</th>
                      </tr>
                    </thead>
                    <tbody>
                      {draft.measurements.map((m, i) => {
                        const hasAssembly = !!m.assembly && !flatten.has(i);
                        const isOpen = expanded.has(i);
                        return (
                          <Fragment key={i}>
                            <tr
                              className="border-t"
                              data-testid={`row-draft-measurement-${i}`}
                            >
                              <td className="p-2">
                                <div className="flex items-center gap-1">
                                  {hasAssembly ? (
                                    <button
                                      type="button"
                                      onClick={() => toggleExpanded(i)}
                                      className="hover:bg-muted rounded p-0.5"
                                      aria-label={isOpen ? "Collapse assembly" : "Expand assembly"}
                                      data-testid={`button-expand-assembly-${i}`}
                                    >
                                      {isOpen ? (
                                        <ChevronDown className="h-3 w-3" />
                                      ) : (
                                        <ChevronRight className="h-3 w-3" />
                                      )}
                                    </button>
                                  ) : (
                                    <span className="w-4 inline-block" />
                                  )}
                                  <span>{m.label}</span>
                                  {hasAssembly && (
                                    <Badge
                                      variant="secondary"
                                      className="ml-1 gap-1 text-[10px]"
                                      data-testid={`badge-assembly-${i}`}
                                    >
                                      <Layers className="h-3 w-3" />
                                      {m.assembly!.assemblyName}
                                    </Badge>
                                  )}
                                </div>
                              </td>
                              <td className="p-2">{m.type}</td>
                              <td className="p-2 text-right">{m.value}</td>
                              <td className="p-2">{m.unit}</td>
                              <td className="p-2 font-mono">
                                <div className="flex items-center justify-between gap-2">
                                  <span>{m.costCode ?? "—"}</span>
                                  {hasAssembly && (
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-5 w-5"
                                      onClick={() =>
                                        setFlatten((prev) => new Set(prev).add(i))
                                      }
                                      title="Reject assembly — keep flat line"
                                      data-testid={`button-detach-assembly-${i}`}
                                    >
                                      <Unlink className="h-3 w-3" />
                                    </Button>
                                  )}
                                </div>
                              </td>
                            </tr>
                            {hasAssembly && isOpen &&
                              m.assembly!.components.map((c) => {
                                const key = `${i}:${c.componentId}`;
                                const isDetached = detached.has(key);
                                const wastePct = Math.round(
                                  (m.assembly!.assemblyWasteFactor +
                                    c.componentWasteFactor) *
                                    100,
                                );
                                return (
                                  <tr
                                    key={`comp-${i}-${c.componentId}`}
                                    className="border-t bg-muted/40"
                                    data-testid={`row-assembly-component-${i}-${c.componentId}`}
                                  >
                                    <td className="p-2 pl-8">
                                      <span
                                        className={
                                          isDetached
                                            ? "line-through text-muted-foreground"
                                            : ""
                                        }
                                      >
                                        {c.description}
                                      </span>
                                      <span className="ml-2 text-[10px] text-muted-foreground uppercase">
                                        {c.componentType}
                                      </span>
                                    </td>
                                    <td className="p-2 text-muted-foreground">—</td>
                                    <td
                                      className={`p-2 text-right tabular-nums ${
                                        isDetached
                                          ? "line-through text-muted-foreground"
                                          : ""
                                      }`}
                                    >
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
                                          title={
                                            isDetached
                                              ? "Restore component"
                                              : "Detach component"
                                          }
                                          data-testid={`button-detach-component-${i}-${c.componentId}`}
                                        >
                                          <Unlink className="h-3 w-3" />
                                        </Button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                          </Fragment>
                        );
                      })}
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
                data-testid="button-run-draft-takeoff"
              >
                {isWorking ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
                Generate
              </Button>
            ) : (
              <div className="flex gap-2 w-full justify-end">
                <Button
                  variant="ghost"
                  onClick={() => {
                    sendFeedback.mutate("REJECTED");
                    setOpen(false);
                  }}
                  data-testid="button-discard-takeoff-draft"
                >
                  Discard
                </Button>
                <Button
                  onClick={() => {
                    sendFeedback.mutate("ACCEPTED");
                    toast({
                      title: "Draft kept open",
                      description: "Copy measurements into your takeoff manually.",
                    });
                  }}
                  data-testid="button-accept-takeoff-draft"
                >
                  <Check className="h-4 w-4 mr-2" />
                  Mark as accepted
                </Button>
              </div>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
