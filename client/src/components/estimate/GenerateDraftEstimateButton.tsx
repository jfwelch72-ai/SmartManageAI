import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Sparkles, Check } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { pollJobUntilDone } from "@/lib/jobs";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";

interface DraftLine {
  description: string;
  costCode: string | null;
  quantity: number;
  unit: string;
  unitCost: number;
  laborHours: number | null;
  totalCost: number;
  rationale: string;
  citationIds: string[];
}

interface SkillApplied {
  id: string;
  name: string;
  scope: string;
  scopeValue: string | null;
}

interface DraftResult {
  lines: DraftLine[];
  notes: string;
  confidence: number;
  citations?: Array<{ id: string; sourceType: string; title: string }>;
  skillsApplied?: SkillApplied[];
}

interface Props {
  bidId: string;
  estimateId?: string;
}

export function GenerateDraftEstimateButton({ bidId, estimateId }: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [scopeNotes, setScopeNotes] = useState("");
  const [draft, setDraft] = useState<DraftResult | null>(null);

  // Task #2517 — POST enqueues an `ai_estimator_draft` job and returns
  // `{ jobId }`. Poll `/api/jobs/:id` until terminal then unwrap the
  // draft from `output`.
  const generate = useMutation({
    mutationFn: async (): Promise<DraftResult & { fallback?: boolean; message?: string }> => {
      const r = await apiRequest("POST", "/api/ai-estimator/draft-estimate", {
        bidId,
        scopeNotes: scopeNotes.trim() || undefined,
      });
      const enq = (await r.json()) as { jobId?: string };
      if (!enq.jobId) throw new Error("Server did not return a job id");
      const status = await pollJobUntilDone<DraftResult & { fallback?: boolean; message?: string }>(
        enq.jobId,
        { intervalMs: 2000, timeoutMs: 10 * 60_000 },
      );
      if (status.state !== "completed") {
        throw new Error(status.error || `Draft job ${status.state}`);
      }
      if (!status.output) throw new Error("Draft job returned no output");
      return status.output;
    },
    onSuccess: (data: DraftResult & { fallback?: boolean; message?: string }) => {
      if (data.fallback) {
        toast({ title: "No draft generated", description: data.message ?? "AI returned no usable draft", variant: "destructive" });
        return;
      }
      setDraft(data);
    },
    onError: (err: Error) => toast({ title: "Draft failed", description: err.message, variant: "destructive" }),
  });

  const sendFeedback = useMutation({
    mutationFn: async (outcome: "ACCEPTED" | "REJECTED") =>
      apiRequest("POST", "/api/ai-estimator/feedback", {
        surface: "estimate_draft",
        outcome,
        targetType: "draft_estimate",
        bidId,
        estimateId,
        comment: scopeNotes || undefined,
      }),
  });

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        data-testid="button-generate-draft-estimate"
      >
        <Sparkles className="h-4 w-4 mr-2" />
        Generate draft
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" /> Generate draft estimate
            </DialogTitle>
            <DialogDescription>
              Pulls quantities from the linked takeoff and unit costs from your org's learned rates. You stay in
              control: nothing is added to the estimate until you copy it in.
            </DialogDescription>
          </DialogHeader>

          {!draft && (
            <div className="space-y-3 py-2">
              <label className="text-sm font-medium">Scope notes (optional)</label>
              <Textarea
                value={scopeNotes}
                onChange={(e) => setScopeNotes(e.target.value)}
                placeholder="e.g. Concrete sidewalk replacement, Phase 2 only — no curb work."
                className="min-h-[100px]"
                data-testid="input-scope-notes"
              />
            </div>
          )}

          {draft && (
            <ScrollArea className="flex-1 pr-2">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">Confidence: {draft.confidence}%</Badge>
                  <Badge variant="outline">{draft.lines.length} line items</Badge>
                </div>
                {draft.notes && <p className="text-sm text-muted-foreground">{draft.notes}</p>}
                <div className="border rounded-md overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted">
                      <tr>
                        <th className="text-left p-2">Description</th>
                        <th className="text-left p-2">Cost code</th>
                        <th className="text-right p-2">Qty</th>
                        <th className="text-left p-2">Unit</th>
                        <th className="text-right p-2">Unit cost</th>
                        <th className="text-right p-2">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {draft.lines.map((l, i) => (
                        <tr key={i} className="border-t" data-testid={`row-draft-line-${i}`}>
                          <td className="p-2">{l.description}</td>
                          <td className="p-2 font-mono">{l.costCode ?? "—"}</td>
                          <td className="p-2 text-right">{l.quantity}</td>
                          <td className="p-2">{l.unit}</td>
                          <td className="p-2 text-right">${l.unitCost.toFixed(2)}</td>
                          <td className="p-2 text-right">${l.totalCost.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {draft.skillsApplied && draft.skillsApplied.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                      <Check className="h-3 w-3" />
                      Skills applied ({draft.skillsApplied.length})
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {draft.skillsApplied.map((s) => (
                        <Badge key={s.id} variant="secondary" className="text-[10px]" title={s.name}>
                          {s.scope === "global" ? "🌐" : s.scope === "trade" ? "🔧" : "📋"} {s.name}
                          {s.scopeValue ? ` (${s.scopeValue})` : ""}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {draft.citations && draft.citations.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">Sources</div>
                    {draft.citations.map((c) => (
                      <Badge key={c.id} variant="secondary" className="text-[10px] mr-1">
                        {c.sourceType}: {c.title}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </ScrollArea>
          )}

          <DialogFooter>
            {!draft ? (
              <Button onClick={() => generate.mutate()} disabled={generate.isPending} data-testid="button-run-draft">
                {generate.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
                Generate
              </Button>
            ) : (
              <div className="flex gap-2 w-full justify-end">
                <Button
                  variant="ghost"
                  onClick={() => {
                    sendFeedback.mutate("REJECTED");
                    setDraft(null);
                    setOpen(false);
                  }}
                  data-testid="button-discard-draft"
                >
                  Discard
                </Button>
                <Button
                  onClick={() => {
                    sendFeedback.mutate("ACCEPTED");
                    toast({
                      title: "Draft kept open",
                      description:
                        "Copy line items into your estimate from this dialog. Your acceptance is being recorded for future learning.",
                    });
                  }}
                  data-testid="button-accept-draft"
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
