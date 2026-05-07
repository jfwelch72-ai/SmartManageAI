import { useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ArrowLeft, Loader2, RefreshCcw, CheckCircle2, X, Pencil, Save } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface BidLite { id: string; code: string; name: string }
interface ScheduleSymbol {
  id: string;
  symbolCode: string;
  definition: string;
  count: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  reviewStatus: "PENDING_REVIEW" | "ACCEPTED" | "REJECTED" | "EDITED";
  occurrences: { kind?: string; code?: string; sheetCitation?: string; description?: string | null } | null;
  legendSheetId: string | null;
}

interface EditDraft { code: string; description: string; count: number }

export default function TakeoffScheduleSymbolsPage() {
  const params = useParams<{ bidCode: string }>();
  const bidCode = params.bidCode!;
  const { toast } = useToast();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft>({ code: "", description: "", count: 0 });

  const bidQuery = useQuery<BidLite>({ queryKey: ["/api/bids", bidCode] });
  const bidId = bidQuery.data?.id ?? null;

  const symbolsKey = ["/api/ai-estimator/bids", bidId, "schedule-symbols"];
  const symbolsQuery = useQuery<{ symbols: ScheduleSymbol[] }>({
    queryKey: symbolsKey,
    enabled: !!bidId,
  });
  const symbols = symbolsQuery.data?.symbols ?? [];

  const extractMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/ai-estimator/bids/${bidId}/schedule-symbols/extract`);
      return (await res.json()) as { extracted: unknown[]; candidateSheets: number };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: symbolsKey });
      toast({ title: "Schedule extraction complete" });
    },
    onError: (e: Error) => toast({ title: "Extract failed", description: e.message, variant: "destructive" }),
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
      toast({ title: `Accepted ${data.accepted} schedule rows`, description: data.skipped ? `${data.skipped} skipped` : undefined });
    },
    onError: (e: Error) => toast({ title: "Accept failed", description: e.message, variant: "destructive" }),
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
    onError: (e: Error) => toast({ title: "Reject failed", description: e.message, variant: "destructive" }),
  });

  const editMutation = useMutation({
    mutationFn: async (vars: { symbolId: string; updates: Partial<EditDraft> }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/ai-estimator/bids/${bidId}/schedule-symbols/${vars.symbolId}`,
        vars.updates,
      );
      return (await res.json()) as { symbol: ScheduleSymbol };
    },
    onSuccess: () => {
      setEditingId(null);
      queryClient.invalidateQueries({ queryKey: symbolsKey });
      toast({ title: "Saved" });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const selectedIds = useMemo(() => Object.keys(selected).filter((k) => selected[k]), [selected]);
  const allChecked = symbols.length > 0 && selectedIds.length === symbols.length;

  function startEdit(s: ScheduleSymbol) {
    const occ = s.occurrences ?? {};
    setEditingId(s.id);
    setEditDraft({
      code: occ.code ?? s.symbolCode,
      description: occ.description ?? "",
      count: s.count,
    });
  }

  return (
    <div className="container mx-auto p-6 space-y-4" data-testid="page-takeoff-schedule-symbols">
      <div className="flex items-center gap-2 flex-wrap">
        <Button asChild size="sm" variant="ghost" data-testid="link-back-to-bid">
          <Link href={`/takeoff/${bidCode}`}>
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back to Takeoff
          </Link>
        </Button>
        <h1 className="text-xl font-semibold flex-1" data-testid="text-page-title">
          Schedule Symbols — {bidQuery.data?.name ?? bidCode}
        </h1>
        <Button
          size="sm"
          variant="outline"
          onClick={() => extractMutation.mutate()}
          disabled={!bidId || extractMutation.isPending}
          data-testid="button-extract-schedule"
        >
          {extractMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RefreshCcw className="w-4 h-4 mr-1" />}
          Re-extract
        </Button>
        <Button
          size="sm"
          onClick={() => acceptMutation.mutate(symbols.filter((s) => s.reviewStatus !== "ACCEPTED").map((s) => s.id))}
          disabled={symbols.length === 0 || acceptMutation.isPending}
          data-testid="button-accept-all"
        >
          <CheckCircle2 className="w-4 h-4 mr-1" />
          Accept all
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => acceptMutation.mutate(selectedIds)}
          disabled={selectedIds.length === 0 || acceptMutation.isPending}
          data-testid="button-accept-selected"
        >
          Accept selected ({selectedIds.length})
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => rejectMutation.mutate(selectedIds)}
          disabled={selectedIds.length === 0 || rejectMutation.isPending}
          data-testid="button-reject-selected"
        >
          <X className="w-4 h-4 mr-1" />
          Reject selected
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>AI-extracted schedule rows</CardTitle>
          <CardDescription>
            Rows pulled from door / window / fixture / panel schedules. Edit a count or code,
            reject false positives, or accept to write a DRAFT COUNT measurement onto the source
            schedule sheet (review it in the takeoff workspace before promoting). Re-accepting
            the same row updates the existing measurement instead of duplicating it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {symbolsQuery.isLoading ? (
            <div className="text-sm text-muted-foreground" data-testid="text-loading">Loading…</div>
          ) : symbols.length === 0 ? (
            <div className="text-sm text-muted-foreground" data-testid="text-empty">
              No schedule symbols extracted yet. Click "Re-extract" to scan the indexed plan
              sheets for schedule tables.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <Checkbox
                      checked={allChecked}
                      onCheckedChange={(v) => {
                        const next: Record<string, boolean> = {};
                        if (v) for (const s of symbols) next[s.id] = true;
                        setSelected(next);
                      }}
                      data-testid="checkbox-select-all"
                    />
                  </TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Count</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sheet</TableHead>
                  <TableHead className="w-48 text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {symbols.map((s) => {
                  const occ = s.occurrences ?? {};
                  const isEditing = editingId === s.id;
                  return (
                    <TableRow key={s.id} data-testid={`row-symbol-${s.id}`}>
                      <TableCell>
                        <Checkbox
                          checked={!!selected[s.id]}
                          onCheckedChange={(v) =>
                            setSelected((prev) => ({ ...prev, [s.id]: !!v }))
                          }
                          data-testid={`checkbox-symbol-${s.id}`}
                        />
                      </TableCell>
                      <TableCell><Badge variant="outline">{occ.kind ?? "—"}</Badge></TableCell>
                      <TableCell className="font-mono text-xs">
                        {isEditing ? (
                          <Input
                            value={editDraft.code}
                            onChange={(e) => setEditDraft((d) => ({ ...d, code: e.target.value }))}
                            className="h-8 w-24 font-mono text-xs"
                            data-testid={`input-edit-code-${s.id}`}
                          />
                        ) : (
                          <span data-testid={`text-code-${s.id}`}>{occ.code ?? s.symbolCode}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {isEditing ? (
                          <Input
                            value={editDraft.description}
                            onChange={(e) => setEditDraft((d) => ({ ...d, description: e.target.value }))}
                            className="h-8 text-xs"
                            data-testid={`input-edit-description-${s.id}`}
                          />
                        ) : (
                          occ.description ?? "—"
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {isEditing ? (
                          <Input
                            type="number"
                            min={0}
                            value={editDraft.count}
                            onChange={(e) => setEditDraft((d) => ({ ...d, count: Number(e.target.value) }))}
                            className="h-8 w-20 text-right"
                            data-testid={`input-edit-count-${s.id}`}
                          />
                        ) : (
                          <span data-testid={`text-count-${s.id}`}>{s.count}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={s.confidence === "HIGH" ? "default" : s.confidence === "MEDIUM" ? "secondary" : "outline"}>
                          {s.confidence}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            s.reviewStatus === "ACCEPTED"
                              ? "default"
                              : s.reviewStatus === "REJECTED"
                                ? "destructive"
                                : s.reviewStatus === "EDITED"
                                  ? "secondary"
                                  : "outline"
                          }
                          data-testid={`badge-status-${s.id}`}
                        >
                          {s.reviewStatus}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{occ.sheetCitation ?? "—"}</TableCell>
                      <TableCell className="text-right space-x-1">
                        {isEditing ? (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                editMutation.mutate({
                                  symbolId: s.id,
                                  updates: editDraft,
                                })
                              }
                              disabled={editMutation.isPending}
                              data-testid={`button-save-${s.id}`}
                            >
                              <Save className="w-4 h-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditingId(null)}
                              data-testid={`button-cancel-${s.id}`}
                            >
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => startEdit(s)}
                              data-testid={`button-edit-${s.id}`}
                            >
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => rejectMutation.mutate([s.id])}
                              disabled={rejectMutation.isPending}
                              data-testid={`button-reject-${s.id}`}
                            >
                              <X className="w-4 h-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => acceptMutation.mutate([s.id])}
                              disabled={acceptMutation.isPending}
                              data-testid={`button-accept-${s.id}`}
                            >
                              Accept
                            </Button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
