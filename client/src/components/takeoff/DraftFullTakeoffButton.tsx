import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Sparkles, Check } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";

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
}

/**
 * "Draft full takeoff" — sends the project's plan documents to the AI Estimator
 * service which scopes by org and caps the work. The user reviews the draft
 * and accepts/discards; nothing is added to the takeoff automatically.
 */
export function DraftFullTakeoffButton({ projectId }: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [scopeNotes, setScopeNotes] = useState("");
  const [draft, setDraft] = useState<{ measurements: DraftMeasurement[]; notes: string; confidence: number } | null>(null);

  const draftIt = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/ai-estimator/draft-takeoff", {
        projectId,
        scopeNotes: scopeNotes.trim() || undefined,
      });
      return r.json();
    },
    onSuccess: (data: any) => {
      if (data.fallback) {
        toast({
          title: "No takeoff drafted",
          description: data.message ?? "AI returned no usable draft",
          variant: "destructive",
        });
        return;
      }
      setDraft(data);
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

  if (!projectId) return null;

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
      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) setDraft(null);
        }}
      >
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Draft full takeoff from plans</DialogTitle>
            <DialogDescription>
              Reads the plan documents on this project (capped at 4 for performance) and produces an initial measurement
              list. You review and accept manually — nothing is added to your takeoff automatically.
            </DialogDescription>
          </DialogHeader>

          {!draft && (
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
              <Button onClick={() => draftIt.mutate()} disabled={draftIt.isPending} data-testid="button-run-draft-takeoff">
                {draftIt.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
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
