import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CheckCircle2, Flag, X, Loader2, AlertCircle } from "lucide-react";

// Task #2330 — Right-side panel that walks the queue of measurements
// flagged with `needs_review = true` for the active bid/project.
// Groups rows by sheet so a reviewer can scan them in plan order
// instead of cycling through every sheet's MeasurementTable. The
// "Mark reviewed" action stamps the audit columns and clears the
// flag in one click; the optional note is the place where reviewers
// can record _why_ they accepted a row that was flagged (e.g.
// "AI-detected scale verified against ARCH 1/4'=1'-0").

export interface ReviewQueueMeasurement {
  id: string;
  sheetId: string;
  label: string;
  type: string;
  computedLengthFt: number | null;
  computedAreaFt2: number | null;
  computedVolumeCy: number | null;
  computedSurfaceAreaFt2: number | null;
  count: number | null;
  unitCost: number | null;
  calibrationSource: string | null;
  snapHitRatio: number | null;
  scaleAtCaptureLabel: string | null;
  scaleAtCapturePxPerFoot: number | null;
  needsReview: boolean;
  reviewedById: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  sheetIndex: number;
  sheetName: string | null;
  sheetIsActive: boolean;
  sheetRevisionLabel: string | null;
}

export interface ReviewQueueResponse {
  measurements: ReviewQueueMeasurement[];
  count: number;
}

export interface ReviewQueuePanelProps {
  context: { type: "bid"; bidId: string } | { type: "project"; projectId: string };
  selectedSheet: string | null;
  onClose: () => void;
  onJumpToSheet?: (sheetId: string, measurementId: string) => void;
}

// Mirrors the colour map in `MeasurementTable` so the queue speaks
// the same visual language as the inline flag glyph.
const SOURCE_LABEL: Record<string, string> = {
  USER_TWO_POINT: "User two-point",
  STANDARD_SCALE: "Standard scale",
  AI_DETECTED: "AI-detected",
  INHERITED_FROM_PARENT: "Inherited",
  BULK_PROPAGATED: "Bulk propagated",
  UNCALIBRATED: "Uncalibrated",
};

function flagReasonsFor(m: ReviewQueueMeasurement): string[] {
  const reasons: string[] = [];
  const src = m.calibrationSource || "UNCALIBRATED";
  if (src === "UNCALIBRATED" || m.scaleAtCapturePxPerFoot == null) reasons.push("Uncalibrated capture");
  if (src === "AI_DETECTED") reasons.push("AI-detected scale");
  if (typeof m.snapHitRatio === "number" && m.snapHitRatio < 0.6) {
    reasons.push(`Low snap (${Math.round(m.snapHitRatio * 100)}%)`);
  }
  // High-$ rule fires upstream; we surface it whenever total cost is
  // above the default threshold. The exact org threshold isn't sent
  // to the client, so this is best-effort and labelled accordingly.
  const qty = m.computedAreaFt2 || m.computedLengthFt || m.computedVolumeCy || m.count || 0;
  const total = (m.unitCost || 0) * Number(qty);
  if (total >= 25_000) reasons.push(`High value ($${Math.round(total).toLocaleString()})`);
  return reasons;
}

function quantityLabel(m: ReviewQueueMeasurement): { qty: string; unit: string } {
  if (m.computedLengthFt) return { qty: m.computedLengthFt.toFixed(1), unit: "LF" };
  if (m.computedVolumeCy) return { qty: m.computedVolumeCy.toFixed(2), unit: "CY" };
  if (m.computedSurfaceAreaFt2) return { qty: m.computedSurfaceAreaFt2.toFixed(1), unit: "SF" };
  if (m.computedAreaFt2) return { qty: m.computedAreaFt2.toFixed(1), unit: "SF" };
  if (m.count) return { qty: String(m.count), unit: "EA" };
  return { qty: "—", unit: "" };
}

export function ReviewQueuePanel({ context, selectedSheet, onClose, onJumpToSheet }: ReviewQueuePanelProps) {
  const { toast } = useToast();
  const queueUrl = context.type === "bid"
    ? `/api/bids/${context.bidId}/takeoff/review-queue`
    : `/api/projects/${context.projectId}/takeoff/review-queue`;
  const queueKey = useMemo(
    () => context.type === "bid"
      ? ["/api/bids", context.bidId, "takeoff/review-queue"] as const
      : ["/api/projects", context.projectId, "takeoff/review-queue"] as const,
    [context],
  );

  const { data, isLoading, isError } = useQuery<ReviewQueueResponse>({
    queryKey: queueKey,
    queryFn: async () => {
      const res = await apiRequest("GET", queueUrl);
      return res.json();
    },
  });

  const [noteById, setNoteById] = useState<Record<string, string>>({});

  const reviewMutation = useMutation({
    mutationFn: async ({ id, reviewNote }: { id: string; reviewNote?: string }) => {
      const res = await apiRequest("POST", `/api/takeoff/measurements/${id}/review`, {
        reviewNote,
      });
      return res.json();
    },
    onSuccess: (_data, variables) => {
      // Drop any draft note for this row so the editor collapses.
      setNoteById(prev => {
        const next = { ...prev };
        delete next[variables.id];
        return next;
      });
      // Invalidate the queue itself.
      queryClient.invalidateQueries({ queryKey: queueKey });
      // Invalidate every cached sheet's measurements so the inline
      // flag glyph (MeasurementTable) hides for the row that just
      // cleared. We don't know which sheet the user is on, so we
      // invalidate the broad prefix.
      queryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets"] });
      // Cross-module surfaces (`/takeoff/all-measurements`) also
      // carry the flag — invalidate both bid + project shapes.
      queryClient.invalidateQueries({ queryKey: ["/api/bids"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: "Marked reviewed", description: "Measurement cleared from the review queue." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to mark measurement reviewed", variant: "destructive" });
    },
  });

  const groups = useMemo(() => {
    const list = data?.measurements ?? [];
    const grouped = new Map<string, { sheetId: string; sheetIndex: number; sheetName: string | null; sheetRevisionLabel: string | null; sheetIsActive: boolean; rows: ReviewQueueMeasurement[] }>();
    for (const m of list) {
      const existing = grouped.get(m.sheetId);
      if (existing) {
        existing.rows.push(m);
      } else {
        grouped.set(m.sheetId, {
          sheetId: m.sheetId,
          sheetIndex: m.sheetIndex,
          sheetName: m.sheetName,
          sheetRevisionLabel: m.sheetRevisionLabel,
          sheetIsActive: m.sheetIsActive,
          rows: [m],
        });
      }
    }
    return Array.from(grouped.values()).sort((a, b) => a.sheetIndex - b.sheetIndex);
  }, [data]);

  const total = data?.count ?? 0;

  return (
    <div className="flex flex-col h-full" data-testid="review-queue-panel">
      <div className="flex items-center justify-between px-4 py-3 border-b bg-card">
        <div className="flex items-center gap-2">
          <Flag className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          <div>
            <h2 className="text-sm font-semibold">Review queue</h2>
            <p className="text-[11px] text-muted-foreground" data-testid="review-queue-summary">
              {isLoading
                ? "Loading…"
                : total === 0
                  ? "Nothing flagged — nice work"
                  : `${total} measurement${total === 1 ? "" : "s"} need${total === 1 ? "s" : ""} review`}
            </p>
          </div>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-muted" data-testid="button-close-review-queue" aria-label="Close review queue">
          <X className="w-4 h-4" />
        </button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-4">
          {isLoading && (
            <div className="flex items-center justify-center py-12 text-muted-foreground gap-2 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading review queue…
            </div>
          )}
          {isError && !isLoading && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2 text-sm" data-testid="review-queue-error">
              <AlertCircle className="w-5 h-5 text-destructive" />
              <span>Couldn't load the review queue.</span>
            </div>
          )}
          {!isLoading && !isError && total === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2 text-sm" data-testid="review-queue-empty">
              <CheckCircle2 className="w-8 h-8 text-green-600 dark:text-green-400" />
              <span className="font-medium text-foreground">All clear</span>
              <span className="text-xs">No flagged measurements right now.</span>
            </div>
          )}

          {groups.map(group => (
            <div key={group.sheetId} className="border rounded-md overflow-hidden" data-testid={`review-queue-sheet-${group.sheetId}`}>
              <div className="flex items-center justify-between px-3 py-2 bg-muted/40 border-b">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-semibold truncate">
                    Sheet {group.sheetIndex + 1}
                    {group.sheetName ? ` — ${group.sheetName}` : ""}
                  </span>
                  {group.sheetRevisionLabel && (
                    <Badge variant="outline" className="text-[9px] px-1 py-0">{group.sheetRevisionLabel}</Badge>
                  )}
                  {!group.sheetIsActive && (
                    <Badge variant="secondary" className="text-[9px] px-1 py-0">Superseded</Badge>
                  )}
                </div>
                <Badge variant="secondary" className="text-[10px]">{group.rows.length}</Badge>
              </div>
              <ul className="divide-y">
                {group.rows.map(m => {
                  const reasons = flagReasonsFor(m);
                  const { qty, unit } = quantityLabel(m);
                  const noteDraft = noteById[m.id] ?? "";
                  const sourceLabel = SOURCE_LABEL[m.calibrationSource || "UNCALIBRATED"] || m.calibrationSource;
                  const isPending = reviewMutation.isPending && reviewMutation.variables?.id === m.id;
                  const isCurrentSheet = selectedSheet === m.sheetId;
                  return (
                    <li key={m.id} className="px-3 py-2 space-y-2" data-testid={`review-queue-row-${m.id}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium truncate" data-testid={`review-queue-label-${m.id}`}>
                              {m.label || `${m.type}-${m.id.slice(0, 6)}`}
                            </span>
                            <Badge variant="outline" className="text-[9px] px-1 py-0">{m.type.replace(/_/g, " ")}</Badge>
                          </div>
                          <div className="mt-0.5 text-[11px] text-muted-foreground tabular-nums flex items-center gap-2 flex-wrap">
                            <span>{qty} {unit}</span>
                            {m.unitCost ? <span>· ${(m.unitCost * Number(qty || 0)).toFixed(0)}</span> : null}
                            {sourceLabel ? <span>· {sourceLabel}</span> : null}
                          </div>
                        </div>
                        {onJumpToSheet && !isCurrentSheet && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  className="text-[10px] underline text-primary hover:text-primary/80"
                                  onClick={() => onJumpToSheet(m.sheetId, m.id)}
                                  data-testid={`review-queue-jump-${m.id}`}
                                >
                                  Open sheet
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="left" className="text-[11px]">
                                Switch to this sheet and select the measurement
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </div>

                      {reasons.length > 0 && (
                        <div className="flex items-center gap-1 flex-wrap">
                          {reasons.map(r => (
                            <Badge key={r} variant="secondary" className="text-[9px] bg-amber-500/10 text-amber-700 dark:text-amber-300 px-1 py-0">
                              {r}
                            </Badge>
                          ))}
                        </div>
                      )}

                      <Textarea
                        value={noteDraft}
                        onChange={e => setNoteById(prev => ({ ...prev, [m.id]: e.target.value }))}
                        placeholder="Optional note (e.g. verified against architect's scale)"
                        rows={2}
                        className="text-[11px] resize-none"
                        data-testid={`review-queue-note-${m.id}`}
                        maxLength={2000}
                      />

                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          className="h-7 text-[11px]"
                          disabled={isPending}
                          onClick={() => reviewMutation.mutate({ id: m.id, reviewNote: noteDraft.trim() || undefined })}
                          data-testid={`review-queue-mark-reviewed-${m.id}`}
                        >
                          {isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}
                          Mark reviewed
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

export default ReviewQueuePanel;
