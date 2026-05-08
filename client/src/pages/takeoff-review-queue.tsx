import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ArrowLeft, ShieldCheck, ShieldX, Loader2, AlertCircle, ExternalLink,
  ArrowUp, ArrowDown, AlertTriangle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format } from "date-fns";

interface QueueRow {
  id: string;
  label: string;
  type: string;
  source: string | null;
  reviewStatus: "PENDING" | "APPROVED" | "REJECTED" | null;
  reviewRequestedAt: string | null;
  reviewRequestedById: string | null;
  reviewerId: string | null;
  reviewedAt: string | null;
  reviewedById: string | null;
  reviewNote: string | null;
  unitCost: number | null;
  count: number | null;
  computedLengthFt: number | null;
  computedAreaFt2: number | null;
  computedVolumeCy: number | null;
  metadata: string | null;
  sheetId: string;
  sheetName: string | null;
  sheetScalePxPerFoot: number | null;
  sheetScaleLabel: string | null;
  bidId: string;
  bidCode: string | null;
  bidName: string | null;
  projectId: string | null;
  requestedByName: string | null;
  reviewerName: string | null;
  dollarValue: number;
}

type SortKey = "dollarValue" | "label" | "bidCode" | "type" | "requestedByName" | "reviewRequestedAt";
type SortDir = "asc" | "desc";

function quantityFor(row: QueueRow): { value: number; unit: string } {
  // Pick the natural quantity for the measurement type so estimators
  // can sanity-check the dollar figure at a glance.
  switch (row.type) {
    case "AREA":
    case "PITCHED_AREA":
    case "SURFACE_AREA":
      return { value: row.computedAreaFt2 ?? 0, unit: "sf" };
    case "LINEAR":
    case "LINEAR_WITH_DROP":
    case "PITCHED_LINEAR":
      return { value: row.computedLengthFt ?? 0, unit: "lf" };
    case "VOLUME":
      return { value: row.computedVolumeCy ?? 0, unit: "cy" };
    case "COUNT":
      return { value: row.count ?? 0, unit: "ea" };
    default:
      return { value: 0, unit: "" };
  }
}

function sheetAttachment(metadataStr: string | null): "matched" | "fallback" | null {
  // Task #2620 — AI map-reduce apply stamps `sheetAttachment` on the
  // measurement metadata so we can flag rows that landed on the
  // lowest-index sheet because no citation matched a real plan sheet.
  if (!metadataStr) return null;
  try {
    const md = JSON.parse(metadataStr);
    const v = md?.sheetAttachment;
    if (v === "matched" || v === "fallback") return v;
  } catch {
    // Malformed JSON — treat as unknown rather than crashing the row.
  }
  return null;
}

function snapHitRatio(metadataStr: string | null): number | null {
  // Snap-hit ratio is stored on the measurement's metadata blob (when
  // the AI-takeoff or interactive snap engine produces a row). Older
  // rows may not have it — show "—" rather than guessing.
  if (!metadataStr) return null;
  try {
    const md = JSON.parse(metadataStr);
    const v = md?.snapHitRatio ?? md?.snap_hit_ratio ?? md?.snapRatio;
    if (typeof v === "number" && Number.isFinite(v)) return v;
  } catch {
    // Malformed JSON — treat as missing rather than crashing the row.
  }
  return null;
}

/**
 * Task #2321 — review queue page. Renders a sortable table of every
 * measurement still flagged as `needs_review = true`. The default
 * sort is dollar value descending so the riskiest items rise to the
 * top; estimators can re-sort by clicking a column header.
 *
 * Filters are pushed to the server (the route accepts ?bidCode= /
 * ?bidId= / ?projectId= / ?reviewerId=) so the queue stays cheap on
 * orgs with thousands of pending rows.
 */
export default function TakeoffReviewQueuePage() {
  const [location] = useLocation();
  const { toast } = useToast();

  // Parse `?bid=<code>` from the wouter location string. The bid
  // header chip passes that param so deep-links from a bid context
  // arrive pre-filtered.
  const bidCodeFilter = useMemo(() => {
    const queryStart = location.indexOf("?");
    if (queryStart < 0) return null;
    const params = new URLSearchParams(location.slice(queryStart + 1));
    return params.get("bid");
  }, [location]);

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("dollarValue");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  // Task #2620 — toggle to scope the queue down to AI-drafted rows that
  // landed on the fallback sheet (no citation matched). Estimators use
  // this during the needs-review pass to triage blind attachments first.
  const [fallbackOnly, setFallbackOnly] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<QueueRow | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  // Server-side bid filter via query param. Build the queryKey so
  // tanstack-query treats filtered + unfiltered as separate caches.
  const queueQueryKey = useMemo(
    () => bidCodeFilter
      ? ["/api/takeoff/review-queue", { bidCode: bidCodeFilter }]
      : ["/api/takeoff/review-queue"],
    [bidCodeFilter],
  );

  const { data, isLoading, error } = useQuery<QueueRow[]>({
    queryKey: queueQueryKey,
    queryFn: async () => {
      const url = bidCodeFilter
        ? `/api/takeoff/review-queue?bidCode=${encodeURIComponent(bidCodeFilter)}`
        : "/api/takeoff/review-queue";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load queue: ${res.status}`);
      return res.json();
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/takeoff/measurements/${id}/approve-review`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/takeoff/review-queue"] });
      toast({ title: "Approved" });
    },
    onError: (e: Error) => toast({ title: "Approve failed", description: e.message, variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, note }: { id: string; note: string }) => {
      const res = await apiRequest("POST", `/api/takeoff/measurements/${id}/reject-review`, { note });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/takeoff/review-queue"] });
      setRejectTarget(null);
      setRejectNote("");
      toast({ title: "Rejected — requester notified" });
    },
    onError: (e: Error) => toast({ title: "Reject failed", description: e.message, variant: "destructive" }),
  });

  const fallbackTotal = useMemo(
    () => (data ?? []).filter(r => sheetAttachment(r.metadata) === "fallback").length,
    [data],
  );

  const filtered = useMemo(() => {
    let rows = data ?? [];
    if (fallbackOnly) {
      rows = rows.filter(r => sheetAttachment(r.metadata) === "fallback");
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(r =>
        (r.label || "").toLowerCase().includes(q)
        || (r.bidCode || "").toLowerCase().includes(q)
        || (r.bidName || "").toLowerCase().includes(q)
        || (r.requestedByName || "").toLowerCase().includes(q)
      );
    }
    // Apply client-side sort. Server already orders by dollar DESC so
    // the default render is in the right shape without any extra
    // pass; non-default sorts re-sort the slice in JS.
    const sorted = [...rows].sort((a, b) => {
      let av: string | number = 0;
      let bv: string | number = 0;
      switch (sortKey) {
        case "dollarValue": av = a.dollarValue ?? 0; bv = b.dollarValue ?? 0; break;
        case "label": av = a.label ?? ""; bv = b.label ?? ""; break;
        case "bidCode": av = a.bidCode ?? ""; bv = b.bidCode ?? ""; break;
        case "type": av = a.type ?? ""; bv = b.type ?? ""; break;
        case "requestedByName": av = a.requestedByName ?? ""; bv = b.requestedByName ?? ""; break;
        case "reviewRequestedAt":
          av = a.reviewRequestedAt ? new Date(a.reviewRequestedAt).getTime() : 0;
          bv = b.reviewRequestedAt ? new Date(b.reviewRequestedAt).getTime() : 0;
          break;
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [data, search, sortKey, sortDir, fallbackOnly]);

  // Reset sort to dollar DESC whenever the bid filter changes — that
  // matches the spec ("riskiest first") for the most-common deep-link
  // entry point from the bid header chip.
  useEffect(() => {
    setSortKey("dollarValue");
    setSortDir("desc");
  }, [bidCodeFilter]);

  const onHeaderClick = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "dollarValue" || key === "reviewRequestedAt" ? "desc" : "asc");
    }
  };

  const SortIcon = ({ k }: { k: SortKey }) => {
    if (sortKey !== k) return null;
    return sortDir === "asc"
      ? <ArrowUp className="inline w-3 h-3 ml-1" />
      : <ArrowDown className="inline w-3 h-3 ml-1" />;
  };

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-4">
          <Link href="/takeoff">
            <Button variant="ghost" size="sm" data-testid="button-back-to-takeoff">
              <ArrowLeft className="w-4 h-4 mr-1" /> Back to Takeoff
            </Button>
          </Link>
        </div>

        <div className="mb-6">
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-primary" />
            Takeoff Review Queue
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Senior estimators approve or reject high-value measurements before bids ship.
            {bidCodeFilter && (
              <>
                {" "}Filtered to bid <Badge variant="outline" className="font-mono ml-1">{bidCodeFilter}</Badge>{" "}
                <Link href="/takeoff/review-queue">
                  <Button variant="ghost" size="sm" className="px-1 h-auto underline" data-testid="button-clear-bid-filter">
                    Show all
                  </Button>
                </Link>
              </>
            )}
          </p>
        </div>

        <div className="mb-4 flex flex-col sm:flex-row gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by measurement label, bid code, requester…"
            data-testid="input-review-queue-search"
          />
          <Button
            variant={fallbackOnly ? "default" : "outline"}
            onClick={() => setFallbackOnly(v => !v)}
            disabled={fallbackTotal === 0 && !fallbackOnly}
            data-testid="button-toggle-fallback-only"
            className="whitespace-nowrap"
          >
            <AlertTriangle className="w-4 h-4 mr-1.5" />
            Fallback sheet only
            <Badge variant="secondary" className="ml-2 tabular-nums" data-testid="badge-fallback-total">
              {fallbackTotal}
            </Badge>
          </Button>
        </div>

        {isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center" data-testid="text-review-queue-loading">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading queue…
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-destructive py-12 justify-center">
            <AlertCircle className="w-4 h-4" /> Failed to load review queue.
          </div>
        )}

        {!isLoading && !error && filtered.length === 0 && (
          <Card data-testid="card-review-queue-empty">
            <CardContent className="py-12 text-center text-muted-foreground">
              <ShieldCheck className="w-10 h-10 mx-auto mb-2 opacity-50" />
              No measurements awaiting review.
            </CardContent>
          </Card>
        )}

        {!isLoading && !error && filtered.length > 0 && (
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <Table data-testid="table-review-queue">
                <TableHeader>
                  <TableRow>
                    <TableHead
                      className="cursor-pointer select-none"
                      onClick={() => onHeaderClick("label")}
                      data-testid="th-sort-label"
                    >
                      Measurement<SortIcon k="label" />
                    </TableHead>
                    <TableHead
                      className="cursor-pointer select-none"
                      onClick={() => onHeaderClick("bidCode")}
                      data-testid="th-sort-bid"
                    >
                      Bid / Sheet<SortIcon k="bidCode" />
                    </TableHead>
                    <TableHead
                      className="cursor-pointer select-none"
                      onClick={() => onHeaderClick("type")}
                      data-testid="th-sort-type"
                    >
                      Type<SortIcon k="type" />
                    </TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead>Captured by</TableHead>
                    <TableHead>Scale</TableHead>
                    <TableHead className="text-right">Snap hit</TableHead>
                    <TableHead
                      className="cursor-pointer select-none"
                      onClick={() => onHeaderClick("requestedByName")}
                      data-testid="th-sort-requester"
                    >
                      Requested by<SortIcon k="requestedByName" />
                    </TableHead>
                    <TableHead
                      className="cursor-pointer select-none"
                      onClick={() => onHeaderClick("reviewRequestedAt")}
                      data-testid="th-sort-requested-at"
                    >
                      Requested<SortIcon k="reviewRequestedAt" />
                    </TableHead>
                    <TableHead
                      className="text-right cursor-pointer select-none"
                      onClick={() => onHeaderClick("dollarValue")}
                      data-testid="th-sort-dollar"
                    >
                      Dollar<SortIcon k="dollarValue" />
                    </TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((row) => {
                    const qty = quantityFor(row);
                    const snap = snapHitRatio(row.metadata);
                    const attachment = sheetAttachment(row.metadata);
                    return (
                      <TableRow key={row.id} data-testid={`row-review-${row.id}`}>
                        <TableCell className="max-w-[260px]">
                          <div className="font-medium truncate" data-testid={`text-review-label-${row.id}`}>
                            {row.label || "Unlabelled measurement"}
                          </div>
                          {row.reviewNote && (
                            <div className="text-xs text-muted-foreground italic truncate">
                              “{row.reviewNote}”
                            </div>
                          )}
                          <Badge
                            variant={row.reviewStatus === "REJECTED" ? "destructive" : "secondary"}
                            className="text-[10px] mt-1"
                            data-testid={`badge-review-status-${row.id}`}
                          >
                            {row.reviewStatus ?? "PENDING"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {row.bidCode && (
                            <Link href={`/bids/${row.bidCode}`}>
                              <Badge variant="outline" className="font-mono cursor-pointer">
                                <ExternalLink className="w-3 h-3 mr-1" />
                                {row.bidCode}
                              </Badge>
                            </Link>
                          )}
                          {row.sheetName && (
                            <div className="text-muted-foreground truncate max-w-[180px] mt-1">
                              {row.sheetName}
                            </div>
                          )}
                          {attachment === "fallback" && (
                            <Badge
                              variant="destructive"
                              className="text-[10px] mt-1 inline-flex items-center gap-1"
                              title="AI map-reduce could not match a sheet citation; this measurement was attached to the lowest-index sheet. Verify before approving."
                              data-testid={`badge-fallback-sheet-${row.id}`}
                            >
                              <AlertTriangle className="w-3 h-3" />
                              Fallback sheet
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-xs">{row.type}</Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {qty.value.toLocaleString("en-US", { maximumFractionDigits: 1 })}
                          <span className="text-muted-foreground text-xs ml-1">{qty.unit}</span>
                        </TableCell>
                        <TableCell className="text-xs">
                          <Badge variant="outline" className="text-[10px]">
                            {row.source ?? "USER"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {row.sheetScaleLabel || (row.sheetScalePxPerFoot ? `${row.sheetScalePxPerFoot.toFixed(2)} px/ft` : "—")}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {snap !== null ? `${Math.round(snap * 100)}%` : "—"}
                        </TableCell>
                        <TableCell className="text-xs truncate max-w-[140px]">
                          {row.requestedByName ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {row.reviewRequestedAt
                            ? format(new Date(row.reviewRequestedAt), "MMM d, h:mm a")
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums" data-testid={`text-review-dollar-${row.id}`}>
                          ${(row.dollarValue ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex gap-1 justify-end flex-wrap">
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => approveMutation.mutate(row.id)}
                              disabled={approveMutation.isPending || row.reviewStatus !== "PENDING"}
                              data-testid={`button-approve-${row.id}`}
                            >
                              <ShieldCheck className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => { setRejectTarget(row); setRejectNote(""); }}
                              disabled={row.reviewStatus !== "PENDING"}
                              data-testid={`button-reject-${row.id}`}
                            >
                              <ShieldX className="w-3.5 h-3.5" />
                            </Button>
                            {row.bidCode && (
                              <Link href={`/takeoff/${row.bidCode}`}>
                                <Button size="sm" variant="outline" data-testid={`button-open-takeoff-${row.id}`}>
                                  Open
                                </Button>
                              </Link>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </main>

      <Dialog open={!!rejectTarget} onOpenChange={(o) => !o && setRejectTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject measurement</DialogTitle>
            <DialogDescription>
              {rejectTarget?.label || "This measurement"} will stay in the queue with status REJECTED so the requester can fix it. The note below is included in their notification.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
            placeholder="Reason for rejection…"
            rows={4}
            maxLength={2000}
            data-testid="textarea-reject-note"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejectTarget(null)} data-testid="button-cancel-reject">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => rejectTarget && rejectMutation.mutate({ id: rejectTarget.id, note: rejectNote })}
              disabled={rejectMutation.isPending}
              data-testid="button-confirm-reject"
            >
              Reject & notify
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
