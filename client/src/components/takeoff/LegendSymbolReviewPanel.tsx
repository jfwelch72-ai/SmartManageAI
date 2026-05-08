import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, Check, X, Pencil, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface LegendSymbol {
  id: string;
  symbolCode: string;
  definition: string;
  trade: string | null;
  count: number;
  reviewStatus: "PENDING_REVIEW" | "ACCEPTED" | "REJECTED" | "EDITED";
}

interface ListResponse {
  symbols: LegendSymbol[];
}

interface Props {
  bidId: string;
}

/**
 * Task #2623 — HITL controls for non-schedule legend symbols
 * (`ai_estimator_legend_symbols`). Shows the rows the parser has
 * extracted and lets an estimator accept, reject, or edit each one.
 * The list endpoint excludes REJECTED rows by default — that same
 * filter is the pipeline guard that keeps refused symbols out of any
 * downstream prompt or quantity-generation pass.
 */
export function LegendSymbolReviewPanel({ bidId }: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    definition: string;
    count: string;
  }>({ definition: "", count: "" });

  const listKey = [
    `/api/ai-estimator/bids/${bidId}/legend-symbols?includeRejected=true`,
  ];
  const listQuery = useQuery<ListResponse>({
    queryKey: listKey,
    enabled: !!bidId && open,
  });
  const symbols = listQuery.data?.symbols ?? [];
  const pending = useMemo(
    () => symbols.filter((s) => s.reviewStatus === "PENDING_REVIEW").length,
    [symbols],
  );

  const acceptMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest(
        "POST",
        `/api/ai-estimator/bids/${bidId}/legend-symbols/${id}/accept`,
      );
      return (await res.json()) as LegendSymbol;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: listKey });
      toast({ title: "Symbol accepted" });
    },
    onError: (e: Error) =>
      toast({ title: "Accept failed", description: e.message, variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest(
        "POST",
        `/api/ai-estimator/bids/${bidId}/legend-symbols/${id}/reject`,
      );
      return (await res.json()) as LegendSymbol;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: listKey });
      toast({ title: "Symbol rejected" });
    },
    onError: (e: Error) =>
      toast({ title: "Reject failed", description: e.message, variant: "destructive" }),
  });

  const editMutation = useMutation({
    mutationFn: async (vars: {
      id: string;
      definition: string;
      count: number;
    }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/ai-estimator/bids/${bidId}/legend-symbols/${vars.id}`,
        { definition: vars.definition, count: vars.count },
      );
      return (await res.json()) as LegendSymbol;
    },
    onSuccess: () => {
      setEditingId(null);
      queryClient.invalidateQueries({ queryKey: listKey });
      toast({ title: "Symbol updated" });
    },
    onError: (e: Error) =>
      toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  function startEdit(s: LegendSymbol) {
    setEditingId(s.id);
    setEditDraft({ definition: s.definition, count: String(s.count) });
  }

  function statusBadge(s: LegendSymbol) {
    const variant =
      s.reviewStatus === "ACCEPTED"
        ? "default"
        : s.reviewStatus === "EDITED"
          ? "secondary"
          : s.reviewStatus === "REJECTED"
            ? "destructive"
            : "outline";
    return (
      <Badge variant={variant} className="text-[10px]">
        {s.reviewStatus.replace("_", " ")}
      </Badge>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-between"
          data-testid="button-toggle-legend-symbol-review"
        >
          <span className="flex items-center gap-2">
            <BookOpen className="w-4 h-4" />
            Legend symbols
            {pending > 0 && (
              <Badge variant="secondary" data-testid="badge-legend-pending-count">
                {pending}
              </Badge>
            )}
          </span>
          <span className="text-[11px] text-muted-foreground">{symbols.length} total</span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2">
        {listQuery.isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading symbols...
          </div>
        )}
        {!listQuery.isLoading && symbols.length === 0 && (
          <div
            className="text-xs text-muted-foreground py-3"
            data-testid="text-legend-symbol-empty"
          >
            No legend symbols extracted yet. The parser will populate this list once
            legend pages are processed.
          </div>
        )}
        {symbols.length > 0 && (
          <ScrollArea className="max-h-80 pr-2">
            <div className="space-y-2">
              {symbols.map((s) => {
                const editing = editingId === s.id;
                const rejected = s.reviewStatus === "REJECTED";
                return (
                  <div
                    key={s.id}
                    className={
                      rejected
                        ? "rounded border p-2 space-y-1.5 opacity-50 bg-muted/40"
                        : "rounded border p-2 space-y-1.5"
                    }
                    data-testid={`row-legend-symbol-${s.id}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-mono font-semibold">{s.symbolCode}</div>
                      <div className="flex items-center gap-2">
                        {s.trade && (
                          <Badge variant="outline" className="text-[10px]">
                            {s.trade}
                          </Badge>
                        )}
                        {statusBadge(s)}
                      </div>
                    </div>
                    {!editing && (
                      <>
                        <div className="text-xs text-muted-foreground">
                          {s.definition}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          Count: <span className="font-medium">{s.count}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Button
                            size="sm"
                            variant="default"
                            disabled={acceptMutation.isPending}
                            onClick={() => acceptMutation.mutate(s.id)}
                            data-testid={`button-legend-accept-${s.id}`}
                          >
                            <Check className="w-3.5 h-3.5 mr-1" /> Accept
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => startEdit(s)}
                            data-testid={`button-legend-edit-${s.id}`}
                          >
                            <Pencil className="w-3.5 h-3.5 mr-1" /> Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={rejectMutation.isPending}
                            onClick={() => rejectMutation.mutate(s.id)}
                            data-testid={`button-legend-reject-${s.id}`}
                          >
                            <X className="w-3.5 h-3.5 mr-1" /> Reject
                          </Button>
                        </div>
                      </>
                    )}
                    {editing && (
                      <div className="space-y-1.5">
                        <Input
                          value={editDraft.definition}
                          onChange={(e) =>
                            setEditDraft((d) => ({ ...d, definition: e.target.value }))
                          }
                          placeholder="Definition"
                          className="h-8 text-xs"
                          data-testid={`input-legend-definition-${s.id}`}
                        />
                        <Input
                          type="number"
                          min={0}
                          value={editDraft.count}
                          onChange={(e) =>
                            setEditDraft((d) => ({ ...d, count: e.target.value }))
                          }
                          placeholder="Count"
                          className="h-8 text-xs"
                          data-testid={`input-legend-count-${s.id}`}
                        />
                        <div className="flex items-center gap-1.5">
                          <Button
                            size="sm"
                            disabled={editMutation.isPending}
                            onClick={() =>
                              editMutation.mutate({
                                id: s.id,
                                definition: editDraft.definition.trim(),
                                count: Math.max(
                                  0,
                                  Math.round(Number(editDraft.count) || 0),
                                ),
                              })
                            }
                            data-testid={`button-legend-save-${s.id}`}
                          >
                            <Check className="w-3.5 h-3.5 mr-1" /> Save
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditingId(null)}
                            data-testid={`button-legend-cancel-${s.id}`}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
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
