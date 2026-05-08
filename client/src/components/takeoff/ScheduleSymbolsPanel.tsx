import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, RefreshCcw, CheckCircle2, X, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface ScheduleSymbol {
  id: string;
  symbolCode: string;
  definition: string;
  count: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  reviewStatus: "PENDING_REVIEW" | "ACCEPTED" | "REJECTED" | "EDITED";
  occurrences: {
    kind?: string;
    code?: string;
    sheetCitation?: string;
    description?: string | null;
  } | null;
  legendSheetId: string | null;
}

interface Props {
  bidId: string;
}

/**
 * Task #2590 — In-workspace surface for the schedule symbol auto-counter.
 * Lists rows from `GET /api/ai-estimator/bids/:bidId/schedule-symbols`
 * with per-row Accept and Accept All buttons that POST to the accept
 * endpoint. After accept, the workspace's takeoff measurement queries
 * are invalidated so the new COUNT measurements appear immediately.
 */
export function ScheduleSymbolsPanel({ bidId }: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const symbolsKey = ["/api/ai-estimator/bids", bidId, "schedule-symbols"];
  const symbolsQuery = useQuery<{ symbols: ScheduleSymbol[] }>({
    queryKey: symbolsKey,
    enabled: !!bidId && open,
  });
  const symbols = symbolsQuery.data?.symbols ?? [];

  // Refresh every COUNT measurement list in the workspace after an accept
  // so the new draft measurements show up without a manual reload. We
  // invalidate the broad `/api/takeoff/sheets` prefix because acceptance
  // writes to whichever sheet hosted the schedule legend, which may not
  // be the currently selected sheet.
  const refreshMeasurements = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets"] });
    queryClient.invalidateQueries({ queryKey: ["/api/bids", bidId, "takeoff", "sheets"] });
  };

  const extractMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        `/api/ai-estimator/bids/${bidId}/schedule-symbols/extract`,
      );
      return (await res.json()) as { extracted: unknown[]; candidateSheets: number };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: symbolsKey });
      toast({ title: "Schedule extraction complete" });
    },
    onError: (e: Error) =>
      toast({ title: "Extract failed", description: e.message, variant: "destructive" }),
  });

  const acceptMutation = useMutation({
    mutationFn: async (symbolIds: string[]) => {
      const res = await apiRequest(
        "POST",
        `/api/ai-estimator/bids/${bidId}/schedule-symbols/accept`,
        { symbolIds },
      );
      return (await res.json()) as { accepted: number; skipped: number };
    },
    onSuccess: (data) => {
      setSelected({});
      queryClient.invalidateQueries({ queryKey: symbolsKey });
      refreshMeasurements();
      toast({
        title: `Accepted ${data.accepted} schedule rows`,
        description: data.skipped ? `${data.skipped} skipped` : "COUNT measurements updated",
      });
    },
    onError: (e: Error) =>
      toast({ title: "Accept failed", description: e.message, variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: async (symbolIds: string[]) => {
      const res = await apiRequest(
        "POST",
        `/api/ai-estimator/bids/${bidId}/schedule-symbols/reject`,
        { symbolIds },
      );
      return (await res.json()) as { rejected: number };
    },
    onSuccess: (data) => {
      setSelected({});
      queryClient.invalidateQueries({ queryKey: symbolsKey });
      toast({ title: `Rejected ${data.rejected} schedule rows` });
    },
    onError: (e: Error) =>
      toast({ title: "Reject failed", description: e.message, variant: "destructive" }),
  });

  const selectedIds = useMemo(
    () => Object.keys(selected).filter((k) => selected[k]),
    [selected],
  );
  const pendingIds = useMemo(
    () => symbols.filter((s) => s.reviewStatus !== "ACCEPTED").map((s) => s.id),
    [symbols],
  );
  const pendingCount = pendingIds.length;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border rounded-md">
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-between font-medium"
          data-testid="button-toggle-schedule-symbols-panel"
        >
          <span className="flex items-center gap-2">
            <ListChecks className="h-4 w-4" />
            Schedule symbols
            {pendingCount > 0 && (
              <Badge variant="secondary" data-testid="badge-schedule-pending-count">
                {pendingCount} pending
              </Badge>
            )}
          </span>
          <span className="text-xs text-muted-foreground">{open ? "Hide" : "Show"}</span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3 space-y-2">
        <p className="text-xs text-muted-foreground">
          Rows pulled from door / window / fixture / panel schedules. Accept to write a DRAFT
          COUNT measurement onto the source schedule sheet — re-accepting updates the existing
          measurement instead of duplicating it.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => extractMutation.mutate()}
            disabled={extractMutation.isPending}
            data-testid="button-extract-schedule-symbols"
          >
            {extractMutation.isPending ? (
              <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
            ) : (
              <RefreshCcw className="w-3.5 h-3.5 mr-1" />
            )}
            Re-extract
          </Button>
          <Button
            size="sm"
            onClick={() => acceptMutation.mutate(pendingIds)}
            disabled={pendingCount === 0 || acceptMutation.isPending}
            data-testid="button-accept-all-schedule-symbols"
          >
            <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
            Accept all ({pendingCount})
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => acceptMutation.mutate(selectedIds)}
            disabled={selectedIds.length === 0 || acceptMutation.isPending}
            data-testid="button-accept-selected-schedule-symbols"
          >
            Accept selected ({selectedIds.length})
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => rejectMutation.mutate(selectedIds)}
            disabled={selectedIds.length === 0 || rejectMutation.isPending}
            data-testid="button-reject-selected-schedule-symbols"
          >
            <X className="w-3.5 h-3.5 mr-1" />
            Reject selected
          </Button>
        </div>

        {symbolsQuery.isLoading ? (
          <div className="text-xs text-muted-foreground py-2" data-testid="text-schedule-loading">
            Loading…
          </div>
        ) : symbols.length === 0 ? (
          <div className="text-xs text-muted-foreground py-2" data-testid="text-schedule-empty">
            No schedule symbols extracted yet. Click Re-extract to scan the indexed plan sheets.
          </div>
        ) : (
          <ScrollArea className="max-h-[280px] pr-2">
            <div className="space-y-1.5">
              {symbols.map((s) => {
                const occ = s.occurrences ?? {};
                const isAccepted = s.reviewStatus === "ACCEPTED";
                return (
                  <div
                    key={s.id}
                    className="flex items-start gap-2 border rounded-sm px-2 py-1.5 text-xs"
                    data-testid={`row-schedule-symbol-${s.id}`}
                  >
                    <Checkbox
                      checked={!!selected[s.id]}
                      onCheckedChange={(v) =>
                        setSelected((prev) => ({ ...prev, [s.id]: !!v }))
                      }
                      className="mt-0.5"
                      data-testid={`checkbox-schedule-symbol-${s.id}`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="text-[10px]">
                          {occ.kind ?? "—"}
                        </Badge>
                        <span
                          className="font-mono"
                          data-testid={`text-schedule-symbol-code-${s.id}`}
                        >
                          {occ.code ?? s.symbolCode}
                        </span>
                        <span className="tabular-nums text-muted-foreground">
                          ×{" "}
                          <span data-testid={`text-schedule-symbol-count-${s.id}`}>
                            {s.count}
                          </span>
                        </span>
                        <Badge
                          variant={
                            s.confidence === "HIGH"
                              ? "default"
                              : s.confidence === "MEDIUM"
                                ? "secondary"
                                : "outline"
                          }
                          className="text-[10px]"
                        >
                          {s.confidence}
                        </Badge>
                        <Badge
                          variant={
                            isAccepted
                              ? "default"
                              : s.reviewStatus === "REJECTED"
                                ? "destructive"
                                : s.reviewStatus === "EDITED"
                                  ? "secondary"
                                  : "outline"
                          }
                          className="text-[10px]"
                          data-testid={`badge-schedule-symbol-status-${s.id}`}
                        >
                          {s.reviewStatus}
                        </Badge>
                        {occ.sheetCitation && (
                          <Badge variant="outline" className="text-[10px] font-mono">
                            {occ.sheetCitation}
                          </Badge>
                        )}
                      </div>
                      {occ.description && (
                        <div className="text-muted-foreground truncate">{occ.description}</div>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2"
                        onClick={() => rejectMutation.mutate([s.id])}
                        disabled={rejectMutation.isPending || isAccepted}
                        data-testid={`button-reject-schedule-symbol-${s.id}`}
                      >
                        <X className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant={isAccepted ? "ghost" : "default"}
                        className="h-7 px-2"
                        onClick={() => acceptMutation.mutate([s.id])}
                        disabled={acceptMutation.isPending}
                        data-testid={`button-accept-schedule-symbol-${s.id}`}
                      >
                        {isAccepted ? "Re-accept" : "Accept"}
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
