/**
 * Task #1609 — Prompt the user after uploading a new revision PDF to copy
 * pins and/or markups forward from a previous plan_document.
 * Idempotent on the server (ON CONFLICT DO NOTHING by source_*_id pair).
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

export interface CarryoverAnnotationsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** plan_documents.id of the new (target) revision. */
  toDocumentId: string | null;
  /** plan_documents.id of the prior (source) revision. Optional when `candidates` is provided. */
  fromDocumentId?: string | null;
  fromDocumentLabel?: string;
  toDocumentLabel?: string;
  projectCode?: string;
  /** When supplied the user picks the source from this list. */
  candidates?: Array<{ id: string; label: string }>;
}

export default function CarryoverAnnotationsDialog({
  open,
  onOpenChange,
  toDocumentId,
  fromDocumentId,
  fromDocumentLabel,
  toDocumentLabel,
  projectCode,
  candidates,
}: CarryoverAnnotationsDialogProps) {
  const { toast } = useToast();
  const [includePins, setIncludePins] = useState(true);
  const [includeMarkups, setIncludeMarkups] = useState(true);
  const [pickedSourceId, setPickedSourceId] = useState<string | null>(null);
  const effectiveFromId = fromDocumentId ?? pickedSourceId;

  const mutation = useMutation({
    mutationFn: async () => {
      if (!toDocumentId || !effectiveFromId) throw new Error("Missing document context");
      return apiRequest(
        "POST",
        `/api/plan-documents/${encodeURIComponent(toDocumentId)}/carryover-annotations`,
        { fromDocumentId: effectiveFromId, includePins, includeMarkups },
      );
    },
    onSuccess: async (res: any) => {
      const data = await res.json().catch(() => ({}));
      toast({
        title: "Annotations carried over",
        description: `${data.pinsCopied ?? 0} pin(s), ${data.markupsCopied ?? 0} markup(s) copied`,
      });
      if (projectCode) {
        queryClient.invalidateQueries({
          queryKey: ["/api/projects", projectCode, "plan-pins"],
        });
      }
      queryClient.invalidateQueries({
        queryKey: ["/api/plan-documents", toDocumentId, "markups"],
      });
      onOpenChange(false);
    },
    onError: (e: Error) =>
      toast({ title: "Carryover failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-carryover-annotations" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Carry over annotations?</DialogTitle>
          <DialogDescription>
            {fromDocumentLabel && toDocumentLabel
              ? `Copy pins and markups from "${fromDocumentLabel}" to "${toDocumentLabel}".`
              : "Copy pins and markups from the previous revision to this one."}
            {" "}
            Already-copied items are skipped automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {candidates && candidates.length > 0 && !fromDocumentId && (
            <div>
              <Label className="text-sm">Source document</Label>
              <select
                className="mt-1 w-full text-sm border rounded-md bg-background px-2 py-1.5"
                value={pickedSourceId ?? ""}
                onChange={(e) => setPickedSourceId(e.target.value || null)}
                data-testid="select-carryover-source"
              >
                <option value="">Select a source…</option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Checkbox
              id="carryover-pins"
              checked={includePins}
              onCheckedChange={(v) => setIncludePins(v === true)}
              data-testid="checkbox-carryover-pins"
            />
            <Label htmlFor="carryover-pins" className="text-sm cursor-pointer">
              Include pins (RFI, Punch, Submittal)
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="carryover-markups"
              checked={includeMarkups}
              onCheckedChange={(v) => setIncludeMarkups(v === true)}
              data-testid="checkbox-carryover-markups"
            />
            <Label htmlFor="carryover-markups" className="text-sm cursor-pointer">
              Include markups (arrows, clouds, text, etc.)
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            data-testid="button-carryover-skip"
          >
            Skip
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={
              mutation.isPending ||
              !toDocumentId ||
              !effectiveFromId ||
              (!includePins && !includeMarkups)
            }
            data-testid="button-carryover-confirm"
          >
            {mutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Carry Over
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
