import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface Estimate {
  id: string;
  name?: string | null;
  title?: string | null;
}

interface Props {
  sourceTakeoffId: string;
  measurementIds: string[];
  bidId?: string;
  projectId?: string;
  triggerLabel?: string;
}

/**
 * Task #2404 — Send-to-Estimate dialog.
 * Idempotent — keyed on (estimateId, sourceMeasurementId) so re-sending
 * is safe.
 */
export function SendToEstimateDialog({
  sourceTakeoffId,
  measurementIds,
  bidId,
  projectId,
  triggerLabel,
}: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [estimateId, setEstimateId] = useState<string>("");
  const [mode, setMode] = useState<"merge" | "replace">("merge");

  const estimatesUrl = bidId
    ? `/api/bids/${bidId}/estimates`
    : projectId
    ? `/api/projects/${projectId}/estimates`
    : "/api/estimates";

  const { data: estimates = [] } = useQuery<Estimate[]>({
    queryKey: [estimatesUrl],
    enabled: open,
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/takeoff/send-to-estimate", {
        estimateId,
        sourceTakeoffId,
        measurementIds,
        mode,
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [`/api/estimates/${estimateId}/line-items`] });
      toast({
        title: "Sent to estimate",
        description: `${data.inserted ?? 0} new, ${data.updated ?? 0} updated, ${data.removed ?? 0} removed.`,
      });
      setOpen(false);
    },
    onError: (err: unknown) =>
      toast({
        title: "Send failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          disabled={measurementIds.length === 0}
          data-testid="button-send-to-estimate"
        >
          <Send className="w-3.5 h-3.5 mr-1.5" />
          {triggerLabel ?? "Send to estimate"}
        </Button>
      </DialogTrigger>
      <DialogContent data-testid="dialog-send-to-estimate">
        <DialogHeader>
          <DialogTitle>Send {measurementIds.length} measurements to estimate</DialogTitle>
          <DialogDescription>
            Re-sending the same measurements is safe — quantities and unit costs are
            updated in place; user-edited markup, labor, and notes are preserved.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Estimate</Label>
            <Select value={estimateId} onValueChange={setEstimateId}>
              <SelectTrigger data-testid="select-estimate"><SelectValue placeholder="Select estimate..." /></SelectTrigger>
              <SelectContent>
                {estimates.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name || e.title || e.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Mode</Label>
            <RadioGroup value={mode} onValueChange={(v) => setMode(v as "merge" | "replace")}>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="merge" id="mode-merge" data-testid="radio-mode-merge" />
                <Label htmlFor="mode-merge" className="font-normal">
                  Merge — update existing rows, add new ones
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="replace" id="mode-replace" data-testid="radio-mode-replace" />
                <Label htmlFor="mode-replace" className="font-normal">
                  Replace — also remove any line items no longer in the selection
                </Label>
              </div>
            </RadioGroup>
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => sendMutation.mutate()}
            disabled={!estimateId || sendMutation.isPending}
            data-testid="button-confirm-send"
          >
            {sendMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
