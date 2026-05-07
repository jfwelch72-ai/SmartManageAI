import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Sparkles, Check } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { JobProgressBar } from "@/components/JobProgressBar";

interface DraftMeasurement {
  label: string;
  type: string;
  value: number;
  unit: string;
  costCode: string | null;
  rationale: string;
}

interface Props {
  bidId?: string;
  projectId?: string;
  // Task #2551 — Standalone takeoff source.
  standaloneTakeoffId?: string;
}

interface DraftResult {
  measurements: DraftMeasurement[];
  notes: string;
  confidence: number;
}

/**
 * "Draft full takeoff" — sends the project's plan documents to the AI Estimator
 * service which scopes by org and caps the work. Task #2530 — runs the work via
 * the `ai_estimator_draft` queue so the dialog can show a real progress bar
 * driven by `useJobProgress` instead of a static spinner.
 */
export function DraftFullTakeoffButton({ projectId, standaloneTakeoffId }: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [scopeNotes, setScopeNotes] = useState("");
  const [draft, setDraft] = useState<DraftResult | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [fetchingResult, setFetchingResult] = useState(false);

  // Task #2517 / #2530 — POST enqueues an `ai_estimator_draft` job and
  // returns `{ jobId }`. The dialog then drives a live progress bar via
  // `useJobProgress` (SSE) and pulls the final draft via
  // `handleJobComplete` once the job reports `completed`.
  const draftIt = useMutation({
    mutationFn: async (): Promise<{ jobId?: string }> => {
      const r = await apiRequest("POST", "/api/ai-estimator/draft-takeoff", {
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
    }
  }, [open]);

  const isWorking = draftIt.isPending || (!!jobId && !draft);

  if (!projectId && !standaloneTakeoffId) return null;

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
                <Badge variant="outline">Confidence: {draft.confidence}%</Badge>
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
                      {draft.measurements.map((m, i) => (
                        <tr key={i} className="border-t" data-testid={`row-draft-measurement-${i}`}>
                          <td className="p-2">{m.label}</td>
                          <td className="p-2">{m.type}</td>
                          <td className="p-2 text-right">{m.value}</td>
                          <td className="p-2">{m.unit}</td>
                          <td className="p-2 font-mono">{m.costCode ?? "—"}</td>
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
