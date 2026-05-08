// Task #2625 — Auto-takeoff revision diff dialog.
//
// Lets estimators pick two past auto-takeoff revisions for a bid and
// see a side-by-side diff (added / removed / changed quantities) by
// trade and sheet, with a per-row promote control (accept new / keep
// old / merge). The dialog is opened from `MapReduceDraftButton`'s
// neighborhood in the AI takeoff panel — see `AiTakeoffPanel.tsx`.

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, GitCompare, AlertTriangle, Check } from "lucide-react";
import { apiRequest, queryClient as appQueryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface RevisionListItem {
  id: string;
  createdAt: string;
  createdById: string | null;
  mode: string;
  modelId: string | null;
  promptVersion: string | null;
  provider: string | null;
  confidence: number | null;
  partial: boolean;
  measurementCount: number;
  planSetHash: string | null;
  disciplines: string[] | null;
  notes: string | null;
  llmCallCount: number | null;
}

type DiffStatus = "ADDED" | "REMOVED" | "CHANGED" | "UNCHANGED";

interface DiffEntry {
  key: string;
  status: DiffStatus;
  label: string;
  type: string;
  unit: string;
  costCode: string | null;
  fromValue: number | null;
  toValue: number | null;
  delta: number | null;
  deltaPct: number | null;
  fromCitations: string[];
  toCitations: string[];
  contributingDisciplines: string[];
  affectedBySheetChange: boolean;
  fuzzy?: boolean;
}

interface DiffResponse {
  bidId: string;
  from: { id: string; createdAt: string; modelId: string | null; promptVersion: string | null };
  to: { id: string; createdAt: string; modelId: string | null; promptVersion: string | null };
  diff: {
    entries: DiffEntry[];
    byDiscipline: Record<string, DiffEntry[]>;
    bySheet: Record<string, DiffEntry[]>;
    summary: { added: number; removed: number; changed: number; unchanged: number };
    sheetVersion: {
      addedSheetIds: string[];
      removedSheetIds: string[];
      addedSheetCitations: string[];
      removedSheetCitations: string[];
      addedPlanDocumentIds: string[];
      removedPlanDocumentIds: string[];
    };
  };
}

interface PromoteResponse {
  accepted: string[];
  kept: string[];
  merged: string[];
  skipped: Array<{ key: string; reason: string }>;
  insertedMeasurementIds: string[];
}

type PromoteAction = "accept" | "keep" | "merge";

interface Props {
  bidId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function statusBadge(s: DiffStatus): { variant: "default" | "secondary" | "outline" | "destructive"; label: string } {
  switch (s) {
    case "ADDED":
      return { variant: "default", label: "Added" };
    case "REMOVED":
      return { variant: "destructive", label: "Removed" };
    case "CHANGED":
      return { variant: "secondary", label: "Changed" };
    default:
      return { variant: "outline", label: "Unchanged" };
  }
}

export function TakeoffRevisionDiffDialog({ bidId, open, onOpenChange }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(null);
  const [actions, setActions] = useState<Record<string, PromoteAction>>({});

  const { data: revisionsData, isLoading: loadingRevisions } = useQuery<{ revisions: RevisionListItem[] }>({
    queryKey: ["/api/ai-estimator/bids", bidId, "revisions"],
    queryFn: async () => {
      const r = await apiRequest("GET", `/api/ai-estimator/bids/${bidId}/revisions`);
      return (await r.json()) as { revisions: RevisionListItem[] };
    },
    enabled: open && !!bidId,
  });
  const revisions = revisionsData?.revisions ?? [];

  // Default selection: most-recent two revisions.
  useEffect(() => {
    if (!open) return;
    if (!fromId && !toId && revisions.length >= 2) {
      setToId(revisions[0]!.id);
      setFromId(revisions[1]!.id);
    } else if (!fromId && revisions.length >= 1) {
      setToId(revisions[0]!.id);
    }
  }, [open, revisions, fromId, toId]);

  useEffect(() => {
    if (!open) {
      setFromId(null);
      setToId(null);
      setActions({});
    }
  }, [open]);

  const diffQuery = useQuery<DiffResponse>({
    queryKey: ["/api/ai-estimator/revisions/diff/compare", fromId, toId],
    queryFn: async () => {
      const r = await apiRequest(
        "GET",
        `/api/ai-estimator/revisions/diff/compare?from=${encodeURIComponent(fromId!)}&to=${encodeURIComponent(toId!)}`,
      );
      return (await r.json()) as DiffResponse;
    },
    enabled: !!(fromId && toId && fromId !== toId),
  });
  const diff = diffQuery.data?.diff;

  const promote = useMutation({
    mutationFn: async (): Promise<PromoteResponse> => {
      if (!fromId || !toId) throw new Error("Pick both revisions");
      const decisions = Object.entries(actions).map(([key, action]) => ({ key, action }));
      if (decisions.length === 0) throw new Error("No decisions selected");
      const r = await apiRequest("POST", "/api/ai-estimator/revisions/diff/promote", {
        fromRevisionId: fromId,
        toRevisionId: toId,
        decisions,
      });
      return (await r.json()) as PromoteResponse;
    },
    onSuccess: (data) => {
      const total = data.accepted.length + data.merged.length + data.kept.length;
      toast({
        title: "Promoted to takeoff",
        description: `${data.insertedMeasurementIds.length} measurement${data.insertedMeasurementIds.length === 1 ? "" : "s"} added • ${data.kept.length} kept • ${data.skipped.length} skipped (of ${total} decisions).`,
      });
      // Bust caches the takeoff workspace listens to.
      queryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets"] });
      queryClient.invalidateQueries({ queryKey: [`/api/bids/${bidId}/takeoff/all-measurements`] });
      appQueryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets"] });
      setActions({});
    },
    onError: (err: Error) =>
      toast({ title: "Promote failed", description: err.message, variant: "destructive" }),
  });

  const grouped = useMemo(() => {
    if (!diff) return [] as Array<{ discipline: string; entries: DiffEntry[] }>;
    return Object.entries(diff.byDiscipline)
      .map(([discipline, entries]) => ({ discipline, entries }))
      .sort((a, b) => a.discipline.localeCompare(b.discipline));
  }, [diff]);

  const setAction = (key: string, action: PromoteAction | null) => {
    setActions((prev) => {
      const next = { ...prev };
      if (action === null) delete next[key];
      else next[key] = action;
      return next;
    });
  };

  const sheetVersionChanged =
    !!diff &&
    (diff.sheetVersion.addedSheetIds.length > 0 ||
      diff.sheetVersion.removedSheetIds.length > 0 ||
      diff.sheetVersion.addedPlanDocumentIds.length > 0 ||
      diff.sheetVersion.removedPlanDocumentIds.length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] flex flex-col" data-testid="dialog-revision-diff">
        <DialogHeader>
          <DialogTitle>Compare auto-takeoff revisions</DialogTitle>
          <DialogDescription>
            Pick two past auto-takeoff runs for this bid to see what changed line-by-line. Decide
            per row whether to accept the new quantity, keep the old, or merge both before pushing
            them into the live takeoff.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 pt-2">
          <div>
            <div className="text-xs text-muted-foreground mb-1">From (older)</div>
            <Select value={fromId ?? undefined} onValueChange={(v) => setFromId(v)}>
              <SelectTrigger data-testid="select-revision-from">
                <SelectValue placeholder={loadingRevisions ? "Loading…" : "Select a revision"} />
              </SelectTrigger>
              <SelectContent>
                {revisions.map((r) => (
                  <SelectItem key={r.id} value={r.id} data-testid={`option-revision-from-${r.id}`}>
                    {fmtDate(r.createdAt)} • {r.measurementCount} items
                    {r.confidence != null ? ` • ${r.confidence}%` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">To (newer)</div>
            <Select value={toId ?? undefined} onValueChange={(v) => setToId(v)}>
              <SelectTrigger data-testid="select-revision-to">
                <SelectValue placeholder={loadingRevisions ? "Loading…" : "Select a revision"} />
              </SelectTrigger>
              <SelectContent>
                {revisions.map((r) => (
                  <SelectItem key={r.id} value={r.id} data-testid={`option-revision-to-${r.id}`}>
                    {fmtDate(r.createdAt)} • {r.measurementCount} items
                    {r.confidence != null ? ` • ${r.confidence}%` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {revisions.length < 2 && !loadingRevisions && (
          <div className="text-sm text-muted-foreground py-2" data-testid="text-revision-empty">
            At least two auto-takeoff runs are required to compare. Run "Draft from full plan set"
            to capture another revision.
          </div>
        )}

        {fromId === toId && fromId && (
          <div className="text-sm text-muted-foreground py-2" data-testid="text-revision-same">
            Pick two different revisions to see a diff.
          </div>
        )}

        {diffQuery.isLoading && fromId && toId && fromId !== toId && (
          <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground" data-testid="text-revision-loading">
            <Loader2 className="h-4 w-4 animate-spin" /> Computing diff…
          </div>
        )}

        {diff && (
          <>
            <div className="flex flex-wrap gap-2 items-center pt-2">
              <Badge variant="default" data-testid="badge-diff-added">+{diff.summary.added} added</Badge>
              <Badge variant="destructive" data-testid="badge-diff-removed">-{diff.summary.removed} removed</Badge>
              <Badge variant="secondary" data-testid="badge-diff-changed">~{diff.summary.changed} changed</Badge>
              <Badge variant="outline" data-testid="badge-diff-unchanged">{diff.summary.unchanged} unchanged</Badge>
              {sheetVersionChanged && (
                <Badge variant="outline" className="border-amber-500 text-amber-700" data-testid="badge-sheet-version-changed">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Plan-set changed: +{diff.sheetVersion.addedSheetIds.length} / -{diff.sheetVersion.removedSheetIds.length} sheets
                </Badge>
              )}
            </div>

            <ScrollArea className="flex-1 pr-2 mt-2">
              <div className="space-y-4">
                {grouped.map((g) => (
                  <div key={g.discipline} className="border rounded-md overflow-hidden" data-testid={`group-discipline-${g.discipline}`}>
                    <div className="bg-muted px-2 py-1 text-xs font-medium">
                      Discipline: {g.discipline} ({g.entries.length})
                    </div>
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left p-2">Status</th>
                          <th className="text-left p-2">Label</th>
                          <th className="text-left p-2">Type/Unit</th>
                          <th className="text-right p-2">From</th>
                          <th className="text-right p-2">To</th>
                          <th className="text-right p-2">Δ</th>
                          <th className="text-left p-2">Sheets</th>
                          <th className="text-left p-2">Decision</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.entries.map((e) => {
                          const sb = statusBadge(e.status);
                          const cites = Array.from(new Set([...e.fromCitations, ...e.toCitations]));
                          const action = actions[e.key] ?? null;
                          return (
                            <tr key={e.key} className="border-t align-top" data-testid={`row-diff-${e.key}`}>
                              <td className="p-2">
                                <Badge variant={sb.variant} className="text-[10px]" data-testid={`badge-row-status-${e.key}`}>
                                  {sb.label}
                                </Badge>
                                {e.fuzzy && (
                                  <Badge variant="outline" className="ml-1 text-[10px]" title="Matched by label similarity, not exact key">
                                    fuzzy
                                  </Badge>
                                )}
                                {e.affectedBySheetChange && (
                                  <Badge variant="outline" className="ml-1 text-[10px] border-amber-500 text-amber-700" title="Citations overlap a sheet that was added or removed">
                                    sheet Δ
                                  </Badge>
                                )}
                              </td>
                              <td className="p-2">{e.label}</td>
                              <td className="p-2 font-mono text-[10px]">{e.type} / {e.unit}</td>
                              <td className="p-2 text-right tabular-nums">{e.fromValue ?? "—"}</td>
                              <td className="p-2 text-right tabular-nums">{e.toValue ?? "—"}</td>
                              <td className="p-2 text-right tabular-nums">
                                {e.delta != null ? e.delta.toFixed(2) : "—"}
                                {e.deltaPct != null ? (
                                  <span className="ml-1 text-muted-foreground">({e.deltaPct.toFixed(1)}%)</span>
                                ) : null}
                              </td>
                              <td className="p-2">
                                <div className="flex flex-wrap gap-1">
                                  {cites.length === 0 ? (
                                    <span className="text-muted-foreground">—</span>
                                  ) : (
                                    cites.map((c) => (
                                      <Badge key={c} variant="outline" className="font-mono text-[10px]">{c}</Badge>
                                    ))
                                  )}
                                </div>
                              </td>
                              <td className="p-2">
                                <div className="flex gap-1">
                                  <Button
                                    size="sm"
                                    variant={action === "accept" ? "default" : "outline"}
                                    className="h-6 px-2 text-[10px]"
                                    onClick={() => setAction(e.key, action === "accept" ? null : "accept")}
                                    disabled={e.toValue == null}
                                    data-testid={`button-action-accept-${e.key}`}
                                  >
                                    Accept new
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant={action === "keep" ? "default" : "outline"}
                                    className="h-6 px-2 text-[10px]"
                                    onClick={() => setAction(e.key, action === "keep" ? null : "keep")}
                                    data-testid={`button-action-keep-${e.key}`}
                                  >
                                    Keep old
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant={action === "merge" ? "default" : "outline"}
                                    className="h-6 px-2 text-[10px]"
                                    onClick={() => setAction(e.key, action === "merge" ? null : "merge")}
                                    disabled={e.fromValue == null && e.toValue == null}
                                    data-testid={`button-action-merge-${e.key}`}
                                  >
                                    Merge
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} data-testid="button-close-revision-diff">
            <Check className="h-4 w-4 mr-2" />
            Close
          </Button>
          <Button
            onClick={() => promote.mutate()}
            disabled={promote.isPending || Object.keys(actions).length === 0}
            data-testid="button-promote-revision-diff"
          >
            {promote.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <GitCompare className="h-4 w-4 mr-2" />}
            Promote {Object.keys(actions).length} decision{Object.keys(actions).length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface TriggerProps {
  bidId?: string;
}

/** Convenience trigger button that opens the diff dialog. Hides when no bidId. */
export function TakeoffRevisionDiffButton({ bidId }: TriggerProps) {
  const [open, setOpen] = useState(false);
  if (!bidId) return null;
  return (
    <>
      <Button
        variant="outline"
        className="w-full"
        size="sm"
        onClick={() => setOpen(true)}
        data-testid="button-open-revision-diff"
      >
        <GitCompare className="h-4 w-4 mr-2" />
        Compare auto-takeoff revisions
      </Button>
      <TakeoffRevisionDiffDialog bidId={bidId} open={open} onOpenChange={setOpen} />
    </>
  );
}
