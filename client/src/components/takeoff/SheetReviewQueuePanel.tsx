import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, AlertTriangle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface SheetReviewEntry {
  sheetId: string;
  sheetIndex: number;
  sheetName: string | null;
  sheetNumber: string | null;
  discipline: string | null;
  disciplineConfidence: "HIGH" | "MEDIUM" | "LOW" | null;
  disciplineSource: string | null;
  disciplineConfidenceScore: number | null;
  disciplineRationale: string | null;
}

interface ReviewQueueResponse {
  sheets: SheetReviewEntry[];
  threshold: number;
  disciplines: string[];
}

interface Props {
  bidId: string;
}

/**
 * Task #2623 — "Needs review" sheet queue. Lists every plan sheet whose
 * AI / heuristic discipline confidence is below the org-configured
 * threshold and lets the estimator confirm or override the discipline
 * inline. A confirm/override stamps `discipline_source = 'USER'` on the
 * server, which the re-index pass and the map-reduce drafter both
 * honor as ground truth.
 */
export function SheetReviewQueuePanel({ bidId }: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const queueKey = ["/api/ai-estimator/bids", bidId, "sheet-index", "review-queue"];
  const indexKey = ["/api/ai-estimator/bids", bidId, "sheet-index"];
  const queueQuery = useQuery<ReviewQueueResponse>({
    queryKey: queueKey,
    enabled: !!bidId && open,
  });
  const sheets = queueQuery.data?.sheets ?? [];
  const threshold = queueQuery.data?.threshold ?? 0.6;
  const disciplines = queueQuery.data?.disciplines ?? [];

  const overrideMutation = useMutation({
    mutationFn: async (vars: { sheetId: string; discipline: string }) => {
      const res = await apiRequest(
        "POST",
        `/api/ai-estimator/bids/${bidId}/sheets/${vars.sheetId}/discipline`,
        { discipline: vars.discipline },
      );
      return (await res.json()) as SheetReviewEntry;
    },
    onSuccess: (_data, vars) => {
      setDraft((prev) => {
        const next = { ...prev };
        delete next[vars.sheetId];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: queueKey });
      queryClient.invalidateQueries({ queryKey: indexKey });
      toast({ title: "Discipline confirmed" });
    },
    onError: (e: Error) =>
      toast({ title: "Confirm failed", description: e.message, variant: "destructive" }),
  });

  const headerCount = useMemo(() => sheets.length, [sheets]);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-between"
          data-testid="button-toggle-sheet-review-queue"
        >
          <span className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            Sheet review queue
            {headerCount > 0 && (
              <Badge variant="secondary" data-testid="badge-sheet-review-count">
                {headerCount}
              </Badge>
            )}
          </span>
          <span className="text-[11px] text-muted-foreground">
            &lt; {Math.round(threshold * 100)}%
          </span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2">
        {queueQuery.isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading queue...
          </div>
        )}
        {!queueQuery.isLoading && sheets.length === 0 && (
          <div
            className="text-xs text-muted-foreground py-3"
            data-testid="text-sheet-review-empty"
          >
            No sheets need review. Every classification is above {Math.round(threshold * 100)}%
            confidence or already confirmed.
          </div>
        )}
        {sheets.length > 0 && (
          <ScrollArea className="max-h-72 pr-2">
            <div className="space-y-2">
              {sheets.map((s) => {
                const score =
                  typeof s.disciplineConfidenceScore === "number"
                    ? `${Math.round(s.disciplineConfidenceScore * 100)}%`
                    : "—";
                const selected = draft[s.sheetId] ?? s.discipline ?? "";
                return (
                  <div
                    key={s.sheetId}
                    className="rounded border p-2 space-y-1.5"
                    data-testid={`row-sheet-review-${s.sheetId}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-medium truncate">
                        {s.sheetNumber || s.sheetName || `Sheet ${s.sheetIndex + 1}`}
                      </div>
                      <Badge variant="outline" className="text-[10px]">
                        AI: {s.discipline ?? "?"} · {score}
                      </Badge>
                    </div>
                    {s.disciplineRationale && (
                      <div className="text-[11px] text-muted-foreground italic">
                        {s.disciplineRationale}
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <Select
                        value={selected}
                        onValueChange={(v) =>
                          setDraft((prev) => ({ ...prev, [s.sheetId]: v }))
                        }
                      >
                        <SelectTrigger
                          className="h-8 flex-1"
                          data-testid={`select-discipline-${s.sheetId}`}
                        >
                          <SelectValue placeholder="Choose discipline" />
                        </SelectTrigger>
                        <SelectContent>
                          {disciplines.map((d) => (
                            <SelectItem key={d} value={d}>
                              {d}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        disabled={!selected || overrideMutation.isPending}
                        onClick={() =>
                          overrideMutation.mutate({
                            sheetId: s.sheetId,
                            discipline: selected,
                          })
                        }
                        data-testid={`button-confirm-${s.sheetId}`}
                      >
                        <Check className="w-3.5 h-3.5 mr-1" /> Confirm
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
