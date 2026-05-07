import { useState, useMemo } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArrowUpDown, ArrowUp, ArrowDown, Search, X, Trash2, Edit2, Check, Eye, Flag, Lock, LockOpen, AlertTriangle, RefreshCw, ChevronDown, FileText, GitBranch } from "lucide-react";
import { measurementHasDrift, selectDriftingMeasurementIds } from "./sheetCalibrationConfidence";

// Task #2319 — Source column visual language. Each calibration source
// gets a stable dot colour so estimators can scan a long list and
// triage at a glance: green = trusted user calibration, blue =
// standard scale (e.g. ARCH 1/4"=1'-0"), amber = AI-detected (review
// before billing), red = uncalibrated (geometry is in pixels, not
// feet — never bill from these). The same labels feed the tooltip
// so colour-blind users get the text affordance.
const CALIBRATION_SOURCE_PRESENTATION: Record<string, { color: string; label: string }> = {
  USER_TWO_POINT: { color: "bg-green-500", label: "User two-point calibration" },
  STANDARD_SCALE: { color: "bg-blue-500", label: "Standard architectural scale" },
  AI_DETECTED: { color: "bg-amber-500", label: "AI-detected scale (review recommended)" },
  UNCALIBRATED: { color: "bg-red-500", label: "Uncalibrated — quantities are in pixels" },
};

interface MeasurementTableProps {
  measurements: any[];
  categories: any[];
  selectedMeasurementId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, data: Record<string, any>) => void;
  /**
   * Task #2334 — Per-row "Unlock & rescale" callback. Released from
   * the locked-scale snapshot the user opted into during a previous
   * sheet re-calibration; the workspace re-derives length/area
   * against the sheet's current scale on the server and invalidates
   * the cache. Optional so legacy callers (the few unit tests that
   * render this table without the workspace plumbing) can omit it.
   * When omitted, the Locked badge stays read-only — there's no
   * affordance to release the lock.
   */
  onUnlockAndRescale?: (id: string) => void;
  /**
   * Task #2357 — Bulk "Unlock & rescale" callback. When provided AND
   * the user has selected one or more locked rows (via the per-row
   * checkbox or the "Select all locked" helper), a toolbar button
   * surfaces an "Unlock N selected" action that releases every
   * selected locked row in one round-trip via the
   * `/api/takeoff/measurements/bulk-unlock-rescale` endpoint instead
   * of forcing the user to click each per-row badge individually.
   * The callback receives only the *selected* locked ids — never the
   * full sheet — so the user has explicit control over which rows
   * the bulk action touches. Optional so legacy callers stay
   * non-actionable.
   */
  onBulkUnlockAndRescale?: (ids: string[]) => void | Promise<void>;
  isBulkUnlocking?: boolean;
  scalePxPerFoot?: number | null;
  // Task #2345 — Drift remediation. The sheet's *current* scale label
  // is what the per-row drift selector and the bulk action compare
  // each measurement's `scaleAtCaptureLabel` against. When omitted
  // (older callers, or sheets with no calibration label), no drift
  // affordance renders. The two callbacks fan out to the workspace
  // mutation layer; both are optional so legacy embedders keep
  // working until they wire them up.
  scaleLabel?: string | null;
  onRemediateDrift?: (measurementId: string, action: "recapture" | "mark_stale") => void;
  onBulkRemediateDrift?: (action: "recapture" | "mark_stale") => void;
  isRemediatingDrift?: boolean;
  /**
   * Task #2581 — Base-bid vs change-order scope tagging. When provided,
   * each row shows a BASE/CO chip in the label cell, the toolbar
   * exposes a BASE/CO/ALL filter, and the row right-click menu adds
   * "Move to base bid" / "Move to change order…" entries that fan out
   * via `onMoveScope`. `changeOrders` populates the picker dialog;
   * when omitted (older callers) the affordances stay hidden so the
   * table remains backwards-compatible.
   */
  changeOrders?: Array<{ id: string; changeOrderNumber: string; description?: string | null; status?: string | null }>;
  onMoveScope?: (
    measurementId: string,
    payload: { scopeTag: "BASE" | "CO"; changeOrderId: string | null },
  ) => void;
  isMovingScope?: boolean;
}

type SortField = "label" | "type" | "category" | "length" | "area" | "volume" | "count" | "cost";
type SortDir = "asc" | "desc";

export function MeasurementTable({
  measurements,
  categories,
  selectedMeasurementId,
  onSelect,
  onDelete,
  onUpdate,
  onUnlockAndRescale,
  onBulkUnlockAndRescale,
  isBulkUnlocking,
  scalePxPerFoot,
  scaleLabel,
  onRemediateDrift,
  onBulkRemediateDrift,
  isRemediatingDrift,
  changeOrders,
  onMoveScope,
  isMovingScope,
}: MeasurementTableProps) {
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("label");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [filterType, setFilterType] = useState<string>("all");
  // Task #2581 — Scope filter (BASE / CO / ALL).
  const [scopeFilter, setScopeFilter] = useState<"ALL" | "BASE" | "CO">("ALL");
  // Task #2581 — Holds the measurement the user is moving to a CO.
  const [moveCandidate, setMoveCandidate] = useState<any | null>(null);
  const [pickedChangeOrderId, setPickedChangeOrderId] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  // Task #2334 — `unlockCandidate` carries the measurement row the
  // user clicked the unlock button on. Holding the candidate (rather
  // than just an id) lets the AlertDialog show the row's label and
  // captured px/ft so the user can see exactly what they're about to
  // release. Cleared after the action is dispatched OR the dialog is
  // dismissed; the actual recompute runs server-side via
  // `onUnlockAndRescale` and the cache invalidation refreshes the
  // visible Qty value.
  const [unlockCandidate, setUnlockCandidate] = useState<any | null>(null);
  // Task #2357 — Open-state for the bulk unlock confirmation dialog.
  // The bulk action mutates length/area for every selected locked
  // row at once (the dollar value of those rows is computed from the
  // recomputed quantity), so a casual misclick on the toolbar button
  // could shift estimate totals across many rows — important enough
  // to confirm rather than fire on click. Mirrors the per-row unlock
  // dialog's two-step interaction so both affordances behave the same.
  const [bulkUnlockConfirmOpen, setBulkUnlockConfirmOpen] = useState(false);
  // Task #2357 — Multi-row selection for bulk actions. Held as a
  // Set<string> of measurement ids. Driven by:
  //   - the per-row Checkbox in the leftmost column (toggle one row),
  //   - the header Checkbox (toggle every currently visible row,
  //     respecting the active search/filter),
  //   - the "Select all locked" helper button (one-click path to the
  //     bulk-unlock workflow when the user just wants to undo a
  //     mistaken "Lock existing measurements" calibration choice).
  // The bulk-unlock toolbar button keys off the *intersection* of
  // this set with the locked-row set, so the user never accidentally
  // bulk-unlocks more than they explicitly opted into.
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(() => new Set());

  function toggleRowSelected(id: string) {
    setSelectedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function clearSelection() {
    setSelectedRowIds(new Set());
  }

  const typeColors: Record<string, string> = {
    LINEAR: "bg-blue-500/20 text-blue-700 dark:text-blue-300",
    AREA: "bg-green-500/20 text-green-700 dark:text-green-300",
    VOLUME: "bg-orange-500/20 text-orange-700 dark:text-orange-300",
    COUNT: "bg-red-500/20 text-red-700 dark:text-red-300",
    SEGMENT: "bg-yellow-500/20 text-yellow-700 dark:text-yellow-300",
    LINEAR_WITH_DROP: "bg-blue-500/20 text-blue-600 dark:text-blue-400",
    PITCHED_LINEAR: "bg-blue-500/20 text-blue-600 dark:text-blue-400",
    PITCHED_AREA: "bg-green-500/20 text-green-600 dark:text-green-400",
    SURFACE_AREA: "bg-green-500/20 text-green-600 dark:text-green-400",
    ARC: "bg-purple-500/20 text-purple-700 dark:text-purple-300",
  };

  const sortedFiltered = useMemo(() => {
    let list = [...measurements];

    if (filterType !== "all") {
      list = list.filter(m => m.type === filterType);
    }

    if (scopeFilter !== "ALL") {
      list = list.filter(m => (m.scopeTag ?? "BASE") === scopeFilter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(m =>
        (m.label || "").toLowerCase().includes(q) ||
        (m.type || "").toLowerCase().includes(q) ||
        (m.categoryName || "").toLowerCase().includes(q)
      );
    }

    list.sort((a, b) => {
      let va: any, vb: any;
      switch (sortField) {
        case "label": va = a.label || ""; vb = b.label || ""; break;
        case "type": va = a.type || ""; vb = b.type || ""; break;
        case "category": va = a.categoryName || ""; vb = b.categoryName || ""; break;
        case "length": va = Number(a.computedLengthFt || 0); vb = Number(b.computedLengthFt || 0); break;
        case "area": va = Number(a.computedAreaFt2 || 0); vb = Number(b.computedAreaFt2 || 0); break;
        case "volume": va = Number(a.computedVolumeCy || 0); vb = Number(b.computedVolumeCy || 0); break;
        case "count": va = Number(a.count || 0); vb = Number(b.count || 0); break;
        case "cost": va = Number(a.unitCost || 0) * getQty(a); vb = Number(b.unitCost || 0) * getQty(b); break;
        default: va = ""; vb = "";
      }
      if (typeof va === "string") {
        const cmp = va.localeCompare(vb);
        return sortDir === "asc" ? cmp : -cmp;
      }
      return sortDir === "asc" ? va - vb : vb - va;
    });

    return list;
  }, [measurements, search, filterType, scopeFilter, sortField, sortDir]);

  // Task #2581 — Counts for the scope filter pills so the user can see
  // the BASE/CO split without flipping the filter to find out.
  const scopeCounts = useMemo(() => {
    let base = 0;
    let co = 0;
    for (const m of measurements) {
      if ((m.scopeTag ?? "BASE") === "CO") co += 1;
      else base += 1;
    }
    return { base, co, all: measurements.length };
  }, [measurements]);

  const changeOrderById = useMemo(() => {
    const map = new Map<string, { id: string; changeOrderNumber: string; description?: string | null }>();
    for (const co of changeOrders ?? []) map.set(co.id, co);
    return map;
  }, [changeOrders]);

  function openMoveToChangeOrder(m: any) {
    setMoveCandidate(m);
    setPickedChangeOrderId(m.changeOrderId ?? "");
  }
  function confirmMoveToChangeOrder() {
    if (!moveCandidate || !onMoveScope || !pickedChangeOrderId) return;
    onMoveScope(moveCandidate.id, { scopeTag: "CO", changeOrderId: pickedChangeOrderId });
    setMoveCandidate(null);
    setPickedChangeOrderId("");
  }
  function moveToBaseBid(m: any) {
    if (!onMoveScope) return;
    onMoveScope(m.id, { scopeTag: "BASE", changeOrderId: null });
  }

  function getQty(m: any): number {
    if (m.type === "COUNT") return Number(m.count || 1);
    if (m.computedLengthFt) return Number(m.computedLengthFt);
    if (m.computedAreaFt2) return Number(m.computedAreaFt2);
    if (m.computedVolumeCy) return Number(m.computedVolumeCy);
    return 0;
  }

  function getUnit(m: any): string {
    if (m.type === "COUNT") return "EA";
    if (m.computedLengthFt) return "LF";
    if (m.computedAreaFt2) return "SF";
    if (m.computedVolumeCy) return "CY";
    return "";
  }

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 opacity-40" />;
    return sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />;
  }

  const uniqueTypes = [...new Set(measurements.map(m => m.type))].sort();

  // Task #2345 — Drift bookkeeping. Compute a Set<id> of drifting
  // rows once per render so the row-level lookup is O(1) and the
  // bulk-action button has the same count the user sees in the
  // affordance column. The selector is a no-op when `scaleLabel` is
  // null/undefined (older callers, or sheets with no calibration
  // label) so existing embedders stay quiet.
  const driftSheet = useMemo(
    () => ({ scaleLabel: scaleLabel ?? null }),
    [scaleLabel],
  );
  const driftIds = useMemo(
    () => new Set(selectDriftingMeasurementIds(driftSheet, measurements)),
    [driftSheet, measurements],
  );
  const driftCount = driftIds.size;
  const driftEnabled =
    !!scaleLabel && (!!onRemediateDrift || !!onBulkRemediateDrift);

  // Task #2357 — Locked-rows bookkeeping for the bulk unlock toolbar
  // action. Computed off the full `measurements` list (not the
  // post-search/filter `sortedFiltered`) so the count stays stable
  // when the user types in the search box.
  const lockedIds = useMemo(
    () =>
      measurements
        .filter((m) => m.lockedScalePxPerFoot != null)
        .map((m) => m.id),
    [measurements],
  );
  const lockedCount = lockedIds.length;
  // Intersection of the user's selection with the locked-row set.
  // The bulk-unlock toolbar button (and its confirmation dialog) act
  // on this list — never on the full `lockedIds` set — so the user
  // has explicit control over which rows the bulk action touches.
  const selectedLockedIds = useMemo(
    () => lockedIds.filter((id) => selectedRowIds.has(id)),
    [lockedIds, selectedRowIds],
  );
  const selectedLockedCount = selectedLockedIds.length;
  // True when there's at least one locked row in the sheet that the
  // user hasn't already selected — i.e., the "Select all locked"
  // helper has work to do. Hidden when every locked row is already
  // selected (clicking it would be a no-op) or when the sheet has no
  // locked rows at all (nothing to select).
  const hasUnselectedLocked = lockedCount > selectedLockedCount;

  const totals = useMemo(() => {
    const t = { lf: 0, sf: 0, cy: 0, ea: 0, cost: 0 };
    sortedFiltered.forEach(m => {
      t.lf += Number(m.computedLengthFt || 0);
      t.sf += Number(m.computedAreaFt2 || 0);
      t.cy += Number(m.computedVolumeCy || 0);
      t.ea += m.type === "COUNT" ? Number(m.count || 1) : 0;
      t.cost += Number(m.unitCost || 0) * getQty(m);
    });
    return t;
  }, [sortedFiltered]);

  function startEdit(m: any) {
    setEditingId(m.id);
    setEditLabel(m.label || "");
  }

  function saveEdit(id: string) {
    onUpdate(id, { label: editLabel });
    setEditingId(null);
  }

  return (
    <div className="flex flex-col h-full" data-testid="measurement-table">
      <div className="flex items-center gap-2 p-2 border-b shrink-0">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search measurements..."
            className="pl-7 h-7 text-xs"
            data-testid="measurement-table-search"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2">
              <X className="w-3 h-3 text-muted-foreground" />
            </button>
          )}
        </div>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-[100px] h-7 text-xs" data-testid="measurement-table-filter">
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {uniqueTypes.map(t => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/*
          Task #2581 — BASE / CO / ALL scope filter. Shown whenever the
          embedder wires `onMoveScope` (i.e., a workspace that knows
          how to persist scope changes); the BASE/CO counts give the
          estimator at-a-glance context before flipping the filter.
        */}
        {onMoveScope && (
          <Select value={scopeFilter} onValueChange={(v) => setScopeFilter(v as "ALL" | "BASE" | "CO")}>
            <SelectTrigger className="w-[120px] h-7 text-xs" data-testid="measurement-table-scope-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL" data-testid="scope-filter-option-all">All scopes ({scopeCounts.all})</SelectItem>
              <SelectItem value="BASE" data-testid="scope-filter-option-base">Base bid ({scopeCounts.base})</SelectItem>
              <SelectItem value="CO" data-testid="scope-filter-option-co">Change order ({scopeCounts.co})</SelectItem>
            </SelectContent>
          </Select>
        )}
        <Badge variant="secondary" className="text-[10px] shrink-0">
          {sortedFiltered.length}/{measurements.length}
        </Badge>
        {/*
          Task #2345 — Bulk drift remediation. Renders only when the
          sheet has a current scaleLabel AND there is at least one
          drifting row, so the toolbar stays quiet on healthy sheets.
          The DropdownMenu lets the estimator choose which remediation
          to apply across all drifting rows in one shot; the per-row
          dropdown (added below in the label cell) exposes the same
          two actions for surgical fixes.
        */}
        {/*
          Task #2357 — Bulk "Unlock & rescale" toolbar affordances.
          Two buttons collaborate to satisfy the "Select all locked →
          Unlock all" flow without forcing a checkbox-clicking slog:

            1. "Select all locked" — appears whenever there's at least
               one locked row the user hasn't already selected. Adds
               every locked row to the selection in one click; the
               per-row checkboxes also drive the same selection set
               so power users can opt-in surgically.
            2. "Unlock N selected" — appears only when one or more
               selected rows are locked. Opens a confirmation
               AlertDialog (recomputes length/area on the server for
               every selected locked row, which directly shifts the
               dollar value of those rows) instead of firing on
               click. Gated on selection — never operates on rows
               the user didn't explicitly opt into.
        */}
        {onBulkUnlockAndRescale && hasUnselectedLocked && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-[10px] gap-1 border-amber-500/60 bg-amber-500/5 hover:bg-amber-500/15 text-amber-700 dark:text-amber-300"
            onClick={() => setSelectedRowIds((prev) => {
              const next = new Set(prev);
              for (const id of lockedIds) next.add(id);
              return next;
            })}
            data-testid="button-select-all-locked"
          >
            <Lock className="w-3 h-3" />
            Select all {lockedCount} locked
          </Button>
        )}
        {onBulkUnlockAndRescale && selectedLockedCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-[10px] gap-1 border-amber-500/60 bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300"
            disabled={isBulkUnlocking}
            onClick={() => setBulkUnlockConfirmOpen(true)}
            data-testid="button-bulk-unlock-rescale"
          >
            <LockOpen className="w-3 h-3" />
            Unlock {selectedLockedCount} selected
          </Button>
        )}
        {driftEnabled && driftCount > 0 && onBulkRemediateDrift && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-[10px] gap-1 border-amber-500/60 bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300"
                disabled={isRemediatingDrift}
                data-testid="button-bulk-remediate-drift"
              >
                <AlertTriangle className="w-3 h-3" />
                {driftCount} drift{driftCount === 1 ? "" : "ed"}
                <ChevronDown className="w-3 h-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel className="text-xs">
                Remediate {driftCount} drifting row{driftCount === 1 ? "" : "s"}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => onBulkRemediateDrift("recapture")}
                disabled={isRemediatingDrift}
                data-testid="button-bulk-recapture-drift"
              >
                <RefreshCw className="w-3 h-3 mr-2" />
                <div className="flex flex-col">
                  <span className="text-xs">Recapture at current scale</span>
                  <span className="text-[10px] text-muted-foreground">
                    Re-stamp snapshot to "{scaleLabel}" and recompute quantities
                  </span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onBulkRemediateDrift("mark_stale")}
                disabled={isRemediatingDrift}
                data-testid="button-bulk-mark-stale-drift"
              >
                <Flag className="w-3 h-3 mr-2" />
                <div className="flex flex-col">
                  <span className="text-xs">Mark as stale (review later)</span>
                  <span className="text-[10px] text-muted-foreground">
                    Send to review queue without changing quantities
                  </span>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow className="text-[11px]">
              {/* Task #2357 — Per-row selection checkbox column. The
                  header checkbox toggles every currently visible row
                  (post-search/filter), letting power users opt-in to
                  the bulk unlock without scrolling. Indeterminate
                  state when the visible rows are partially selected
                  so the affordance reads as a tri-state at a glance. */}
              <TableHead className="w-[28px] px-1">
                {(() => {
                  const visibleIds = sortedFiltered.map((m) => m.id);
                  const visibleSelected = visibleIds.filter((id) => selectedRowIds.has(id)).length;
                  const allChecked = visibleIds.length > 0 && visibleSelected === visibleIds.length;
                  const someChecked = visibleSelected > 0 && !allChecked;
                  return (
                    <Checkbox
                      checked={allChecked ? true : someChecked ? "indeterminate" : false}
                      onCheckedChange={(checked) => {
                        setSelectedRowIds((prev) => {
                          const next = new Set(prev);
                          if (checked) {
                            for (const id of visibleIds) next.add(id);
                          } else {
                            for (const id of visibleIds) next.delete(id);
                          }
                          return next;
                        });
                      }}
                      aria-label="Select all visible measurements"
                      data-testid="checkbox-measurement-select-all"
                      disabled={visibleIds.length === 0}
                    />
                  );
                })()}
              </TableHead>
              <TableHead className="w-[30px] px-1">#</TableHead>
              <TableHead className="cursor-pointer select-none px-2" onClick={() => handleSort("label")}>
                <div className="flex items-center gap-1">Label <SortIcon field="label" /></div>
              </TableHead>
              <TableHead className="cursor-pointer select-none px-2 w-[80px]" onClick={() => handleSort("type")}>
                <div className="flex items-center gap-1">Type <SortIcon field="type" /></div>
              </TableHead>
              {/* Task #2319 — Provenance "Source" column. Narrow on
                  purpose: it's a dot + flag glyph, never text. The dot
                  shows calibration source colour; the flag appears
                  only when needsReview is true. Tooltip carries the
                  exact label for accessibility / colour-blind users. */}
              <TableHead className="w-[44px] px-1 text-center">Source</TableHead>
              <TableHead className="cursor-pointer select-none px-2 w-[70px] text-right" onClick={() => handleSort("length")}>
                <div className="flex items-center gap-1 justify-end">Qty <SortIcon field="length" /></div>
              </TableHead>
              <TableHead className="w-[40px] text-center px-1">Unit</TableHead>
              <TableHead className="cursor-pointer select-none px-2 w-[80px] text-right" onClick={() => handleSort("cost")}>
                <div className="flex items-center gap-1 justify-end">Cost <SortIcon field="cost" /></div>
              </TableHead>
              <TableHead className="w-[60px] px-1"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedFiltered.map((m, idx) => (
              <ContextMenu key={m.id}>
              <ContextMenuTrigger asChild>
              <TableRow
                className={`text-[11px] cursor-pointer hover:bg-accent/50 ${selectedMeasurementId === m.id ? "bg-primary/10" : ""}`}
                onClick={() => onSelect(m.id)}
                data-testid={`measurement-row-${m.id}`}
              >
                {/* Task #2357 — Per-row select checkbox. stopPropagation
                    on the wrapper so toggling the checkbox doesn't
                    also fire the row's `onSelect` (single-row
                    highlight). The locked-row data attribute lets E2E
                    tests assert on the gating behavior. */}
                <TableCell className="px-1" onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={selectedRowIds.has(m.id)}
                    onCheckedChange={() => toggleRowSelected(m.id)}
                    aria-label={`Select measurement ${m.label || m.type || m.id}`}
                    data-testid={`checkbox-measurement-select-${m.id}`}
                    data-locked={m.lockedScalePxPerFoot != null ? "true" : "false"}
                  />
                </TableCell>
                <TableCell className="px-1 text-muted-foreground">{idx + 1}</TableCell>
                <TableCell className="px-2 font-medium">
                  {editingId === m.id ? (
                    <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                      <Input
                        value={editLabel}
                        onChange={e => setEditLabel(e.target.value)}
                        className="h-5 text-[11px] px-1"
                        onKeyDown={e => { if (e.key === "Enter") saveEdit(m.id); if (e.key === "Escape") setEditingId(null); }}
                        autoFocus
                      />
                      <button onClick={() => saveEdit(m.id)}><Check className="w-3 h-3 text-green-600" /></button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: m.color || "#2563eb" }} />
                      <span className="truncate max-w-[120px]">{m.label || `${m.type}-${idx + 1}`}</span>
                      {/*
                        Task #2581 — Scope chip. Shown for every row so
                        the BASE / CO split is visible at a glance.
                        BASE is the default for legacy rows
                        (`scopeTag` defaults to "BASE" server-side).
                        CO chips include the linked change order
                        number when known so the estimator doesn't
                        have to cross-reference a separate panel.
                      */}
                      {(() => {
                        const tag = (m.scopeTag ?? "BASE") as "BASE" | "CO";
                        if (tag === "CO") {
                          const co = m.changeOrderId ? changeOrderById.get(m.changeOrderId) : null;
                          const label = co ? `CO ${co.changeOrderNumber}` : "CO";
                          return (
                            <span
                              className="inline-flex items-center gap-0.5 rounded bg-purple-500/15 text-purple-700 dark:text-purple-300 text-[9px] font-medium shrink-0 px-1 py-0.5"
                              data-testid={`badge-measurement-scope-${m.id}`}
                              data-scope="CO"
                              title={co?.description ? `${label} — ${co.description}` : label}
                            >
                              <GitBranch className="w-2.5 h-2.5" />
                              {label}
                            </span>
                          );
                        }
                        return (
                          <span
                            className="inline-flex items-center gap-0.5 rounded bg-slate-500/15 text-slate-700 dark:text-slate-300 text-[9px] font-medium shrink-0 px-1 py-0.5"
                            data-testid={`badge-measurement-scope-${m.id}`}
                            data-scope="BASE"
                            title="Base bid scope"
                          >
                            <FileText className="w-2.5 h-2.5" />
                            Base
                          </span>
                        );
                      })()}
                      {/*
                        Task #2326 — "Locked" badge. When the
                        measurement carries a `lockedScalePxPerFoot`
                        snapshot it survived a re-calibration with
                        the user's "Lock existing measurements"
                        choice; subsequent calibrations skip it on
                        the server. Surfaces here so the estimator
                        can see at a glance which rows are immune
                        to scale changes (and won't silently shift
                        when they re-calibrate the sheet).
                      */}
                      {/*
                        Task #2345 — Per-row drift affordance. Renders
                        only when this specific measurement's
                        capture-label disagrees with the sheet's
                        current label AND the workspace wired up the
                        per-row callback. Sits next to the Locked
                        badge so a row that's both locked and drifted
                        shows both signals — that combination is rare
                        but legitimate (a user locked a row, then
                        recalibrated the sheet to a different label
                        without choosing "preserve quantities").
                      */}
                      {driftEnabled && driftIds.has(m.id) && onRemediateDrift && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                            <button
                              className="inline-flex items-center gap-0.5 rounded bg-amber-500/15 hover:bg-amber-500/25 text-amber-700 dark:text-amber-300 px-1 py-0.5 text-[9px] font-medium shrink-0 disabled:opacity-50"
                              disabled={isRemediatingDrift}
                              data-testid={`badge-measurement-drift-${m.id}`}
                              title={`Captured at "${m.scaleAtCaptureLabel}" — sheet now reads "${scaleLabel}"`}
                            >
                              <AlertTriangle className="w-2.5 h-2.5" />
                              Drift
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" className="w-56" onClick={(e) => e.stopPropagation()}>
                            <DropdownMenuLabel className="text-[11px]">
                              Captured: <span className="font-mono">{m.scaleAtCaptureLabel}</span>
                              <br />
                              Sheet now: <span className="font-mono">{scaleLabel}</span>
                            </DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => onRemediateDrift(m.id, "recapture")}
                              disabled={isRemediatingDrift}
                              data-testid={`button-recapture-drift-${m.id}`}
                            >
                              <RefreshCw className="w-3 h-3 mr-2" />
                              <span className="text-xs">Recapture at current scale</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => onRemediateDrift(m.id, "mark_stale")}
                              disabled={isRemediatingDrift}
                              data-testid={`button-mark-stale-drift-${m.id}`}
                            >
                              <Flag className="w-3 h-3 mr-2" />
                              <span className="text-xs">Mark as stale</span>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                      {m.lockedScalePxPerFoot != null && (
                        <span
                          className="inline-flex items-center rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 text-[9px] font-medium shrink-0"
                          data-testid={`badge-measurement-locked-${m.id}`}
                          onClick={e => e.stopPropagation()}
                        >
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex items-center gap-0.5 px-1 py-0.5">
                                  <Lock className="w-2.5 h-2.5" />
                                  Locked
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-[220px] text-xs">
                                Length and area are frozen at{" "}
                                <span className="font-mono">
                                  {Number(m.lockedScalePxPerFoot).toFixed(2)} px/ft
                                </span>
                                . Future re-calibrations of this sheet
                                will skip this row.
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                          {/*
                            Task #2334 — "Unlock & rescale" affordance
                            on the Locked badge. Only renders when the
                            workspace passed `onUnlockAndRescale` so a
                            read-only/embed render of the table stays
                            non-actionable. Click opens an AlertDialog
                            confirmation (the action recomputes
                            length/area against the current sheet
                            scale on the server, which is
                            user-visible state) instead of firing
                            immediately on click.
                          */}
                          {onUnlockAndRescale && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    aria-label="Unlock and rescale measurement"
                                    onClick={e => { e.stopPropagation(); setUnlockCandidate(m); }}
                                    className="inline-flex items-center justify-center pl-0.5 pr-1 py-0.5 rounded-r hover:bg-amber-500/25 focus:outline-none focus:ring-1 focus:ring-amber-500"
                                    data-testid={`button-measurement-unlock-${m.id}`}
                                  >
                                    <LockOpen className="w-2.5 h-2.5" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="text-[11px]">
                                  Unlock &amp; rescale to current sheet scale
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </span>
                      )}
                    </div>
                  )}
                </TableCell>
                <TableCell className="px-2">
                  <Badge variant="secondary" className={`text-[9px] px-1 py-0 ${typeColors[m.type] || ""}`}>
                    {m.type?.replace(/_/g, " ")}
                  </Badge>
                </TableCell>
                {/* Task #2319 — Provenance dot + needs-review flag.
                    Falls back to UNCALIBRATED presentation when an
                    older row has no `calibrationSource` so the column
                    never renders an empty cell during the rollout
                    window. Tooltip composes both signals so a user
                    can hover once instead of decoding two glyphs. */}
                <TableCell className="px-1 text-center">
                  {(() => {
                    const sourceKey = (m.calibrationSource as string) || "UNCALIBRATED";
                    const presentation = CALIBRATION_SOURCE_PRESENTATION[sourceKey] ?? CALIBRATION_SOURCE_PRESENTATION.UNCALIBRATED;
                    const tooltipText = m.needsReview
                      ? `${presentation.label} • Flagged for review`
                      : presentation.label;
                    return (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div
                              className="inline-flex items-center gap-0.5"
                              data-testid={`source-indicator-${m.id}`}
                              data-source={sourceKey}
                              data-needs-review={m.needsReview ? "true" : "false"}
                            >
                              <span className={`inline-block w-2 h-2 rounded-full ${presentation.color}`} aria-label={presentation.label} />
                              {m.needsReview ? <Flag className="w-2.5 h-2.5 text-amber-600 dark:text-amber-400" aria-label="Needs review" /> : null}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-[11px]">{tooltipText}</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    );
                  })()}
                </TableCell>
                <TableCell className="px-2 text-right font-mono text-[10px]">
                  {getQty(m) > 0 ? getQty(m).toFixed(1) : "—"}
                </TableCell>
                <TableCell className="px-1 text-center text-[10px] text-muted-foreground">
                  {getUnit(m)}
                </TableCell>
                <TableCell className="px-2 text-right font-mono text-[10px]">
                  {m.unitCost ? `$${(Number(m.unitCost) * getQty(m)).toFixed(0)}` : "—"}
                </TableCell>
                <TableCell className="px-1">
                  <div className="flex items-center gap-0.5" onClick={e => e.stopPropagation()}>
                    <button onClick={() => startEdit(m)} className="p-0.5 rounded hover:bg-accent" data-testid={`edit-measurement-${m.id}`}>
                      <Edit2 className="w-3 h-3 text-muted-foreground" />
                    </button>
                    <button onClick={() => onDelete(m.id)} className="p-0.5 rounded hover:bg-destructive/20" data-testid={`delete-measurement-${m.id}`}>
                      <Trash2 className="w-3 h-3 text-destructive" />
                    </button>
                  </div>
                </TableCell>
              </TableRow>
              </ContextMenuTrigger>
              {/*
                Task #2581 — Per-row right-click menu. Hidden when the
                embedder hasn't wired `onMoveScope` (i.e., a read-only
                view of the table) so the affordance can't fire a
                no-op. The "Move to change order…" entry is gated on
                a non-empty `changeOrders` list — without one, the
                picker would render an empty Select.
              */}
              {onMoveScope && (
                <ContextMenuContent className="w-56" data-testid={`measurement-row-context-menu-${m.id}`}>
                  <ContextMenuLabel className="text-[11px] truncate">
                    {m.label || `${m.type}-${idx + 1}`}
                  </ContextMenuLabel>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    disabled={isMovingScope || (m.scopeTag ?? "BASE") === "BASE"}
                    onSelect={() => moveToBaseBid(m)}
                    data-testid={`context-menu-move-to-base-${m.id}`}
                  >
                    <FileText className="w-3 h-3 mr-2" />
                    Move to base bid
                  </ContextMenuItem>
                  <ContextMenuItem
                    disabled={isMovingScope || !changeOrders || changeOrders.length === 0}
                    onSelect={() => openMoveToChangeOrder(m)}
                    data-testid={`context-menu-move-to-co-${m.id}`}
                  >
                    <GitBranch className="w-3 h-3 mr-2" />
                    Move to change order…
                  </ContextMenuItem>
                </ContextMenuContent>
              )}
              </ContextMenu>
            ))}
            {sortedFiltered.length === 0 && (
              <TableRow>
                {/* Task #2319 — colSpan bumped 7→8 to cover the
                    Source column inserted between Type and Qty.
                    Task #2357 — bumped 8→9 to cover the new
                    selection checkbox column inserted at index 0. */}
                <TableCell colSpan={9} className="text-center text-xs text-muted-foreground py-8">
                  {measurements.length === 0 ? "No measurements yet" : "No matches found"}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {sortedFiltered.length > 0 && (
        <div className="border-t px-2 py-1.5 flex items-center gap-4 text-[10px] text-muted-foreground shrink-0 bg-muted/30" data-testid="measurement-table-totals">
          <span className="font-semibold text-foreground">Totals:</span>
          {totals.lf > 0 && <span>{totals.lf.toFixed(1)} LF</span>}
          {totals.sf > 0 && <span>{totals.sf.toFixed(1)} SF</span>}
          {totals.cy > 0 && <span>{totals.cy.toFixed(2)} CY</span>}
          {totals.ea > 0 && <span>{totals.ea} EA</span>}
          {totals.cost > 0 && <span className="font-semibold text-foreground">${totals.cost.toFixed(0)}</span>}
        </div>
      )}

      {/*
        Task #2334 — Unlock-and-rescale confirmation. The dialog
        spells out exactly what's about to change: the captured
        px/ft snapshot is dropped, the row's length/area re-derive
        against the current sheet scale, and the row will once
        again track future re-calibrations. Important enough to
        confirm because the dollar value of the row is computed off
        the recomputed quantity, so a casual click could
        meaningfully shift estimate totals.
      */}
      <AlertDialog
        open={unlockCandidate !== null}
        onOpenChange={(open) => { if (!open) setUnlockCandidate(null); }}
      >
        <AlertDialogContent data-testid="dialog-measurement-unlock-rescale">
          <AlertDialogHeader>
            <AlertDialogTitle>Unlock &amp; rescale this measurement?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium">
                {unlockCandidate?.label || `${unlockCandidate?.type ?? "Measurement"}`}
              </span>{" "}
              is currently locked at{" "}
              <span className="font-mono">
                {unlockCandidate?.lockedScalePxPerFoot != null
                  ? `${Number(unlockCandidate.lockedScalePxPerFoot).toFixed(2)} px/ft`
                  : "its captured scale"}
              </span>
              . Unlocking will re-derive its length and area against the sheet's current scale
              {scalePxPerFoot != null
                ? ` (${Number(scalePxPerFoot).toFixed(2)} px/ft)`
                : ""}
              , and future re-calibrations of the sheet will once again update this row.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-measurement-unlock">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-measurement-unlock"
              onClick={() => {
                if (unlockCandidate && onUnlockAndRescale) {
                  onUnlockAndRescale(unlockCandidate.id);
                }
                setUnlockCandidate(null);
              }}
            >
              Unlock &amp; rescale
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/*
        Task #2357 — Bulk unlock confirmation. Same two-step contract
        as the per-row dialog: spell out exactly how many rows are
        about to be re-derived against the sheet's current scale, so
        the user can see the cost-impact surface area before
        committing. The action fires `onBulkUnlockAndRescale` with the
        full set of locked ids; the workspace's mutation handles cache
        invalidation and toast on the way back.
      */}
      <AlertDialog
        open={bulkUnlockConfirmOpen}
        onOpenChange={(open) => { if (!open) setBulkUnlockConfirmOpen(false); }}
      >
        <AlertDialogContent data-testid="dialog-bulk-unlock-rescale">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Unlock &amp; rescale {selectedLockedCount} selected measurement{selectedLockedCount === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will release {selectedLockedCount === 1 ? "the selected locked row" : `the ${selectedLockedCount} selected locked rows`} and re-derive
              their length and area against the sheet's current scale
              {scalePxPerFoot != null
                ? ` (${Number(scalePxPerFoot).toFixed(2)} px/ft)`
                : ""}
              . Future re-calibrations of the sheet will once again update {selectedLockedCount === 1 ? "this row" : "these rows"}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-bulk-unlock">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-bulk-unlock"
              onClick={() => {
                // Snapshot the selected ids so a downstream selection
                // change doesn't shrink the list while the request is
                // in flight.
                const idsToUnlock = [...selectedLockedIds];
                if (!onBulkUnlockAndRescale || idsToUnlock.length === 0) {
                  setBulkUnlockConfirmOpen(false);
                  return;
                }
                setBulkUnlockConfirmOpen(false);
                // Only clear the selected-locked entries AFTER the
                // mutation resolves successfully so a network failure
                // or 4xx leaves the user's selection intact and the
                // button is ready for retry. Other selected
                // (non-locked) rows are preserved either way — the
                // user might still want them for a future bulk
                // action.
                Promise.resolve(onBulkUnlockAndRescale(idsToUnlock))
                  .then(() => {
                    setSelectedRowIds((prev) => {
                      const next = new Set(prev);
                      for (const id of idsToUnlock) next.delete(id);
                      return next;
                    });
                  })
                  .catch(() => {
                    // Mutation surfaces its own toast; selection
                    // stays put so the user can retry.
                  });
              }}
            >
              Unlock {selectedLockedCount} selected
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/*
        Task #2581 — Move-to-change-order picker. Opened from the
        per-row right-click menu (and from the properties panel via
        the same `onMoveScope` callback in the workspace). Uses a
        Dialog rather than an inline dropdown so the change-order
        list can scroll for projects with many COs without consuming
        canvas space.
      */}
      <Dialog
        open={moveCandidate !== null}
        onOpenChange={(open) => {
          if (!open) {
            setMoveCandidate(null);
            setPickedChangeOrderId("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md" data-testid="dialog-move-to-change-order">
          <DialogHeader>
            <DialogTitle>Move to change order</DialogTitle>
            <DialogDescription>
              Tag{" "}
              <span className="font-medium">
                {moveCandidate?.label || `${moveCandidate?.type ?? "this measurement"}`}
              </span>{" "}
              with a change order so it rolls up under that CO instead of the base bid.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <Label className="text-xs">Change order</Label>
            <Select value={pickedChangeOrderId} onValueChange={setPickedChangeOrderId}>
              <SelectTrigger className="h-9 text-sm" data-testid="select-move-to-change-order">
                <SelectValue placeholder="Select a change order…" />
              </SelectTrigger>
              <SelectContent>
                {(changeOrders ?? []).length === 0 && (
                  <SelectItem value="__none__" disabled>
                    No change orders on this project yet
                  </SelectItem>
                )}
                {(changeOrders ?? []).map((co) => (
                  <SelectItem
                    key={co.id}
                    value={co.id}
                    data-testid={`option-change-order-${co.id}`}
                  >
                    CO {co.changeOrderNumber}
                    {co.description ? ` — ${co.description.slice(0, 50)}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setMoveCandidate(null);
                setPickedChangeOrderId("");
              }}
              data-testid="button-cancel-move-to-co"
            >
              Cancel
            </Button>
            <Button
              onClick={confirmMoveToChangeOrder}
              disabled={!pickedChangeOrderId || isMovingScope}
              data-testid="button-confirm-move-to-co"
            >
              {isMovingScope ? "Moving…" : "Move"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
