import { memo, useCallback, useMemo, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { bulkPinErrorDescription } from "@/lib/drawingSetErrors";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Layers,
  Plus,
  Star,
  Trash2,
  Pencil,
  AlertTriangle,
  Loader2,
  Check,
  X,
  GitCompare,
  Pin,
  Info,
  ArrowRight,
} from "lucide-react";
import type { TakeoffSheet } from "@shared/schema";

// Task #1918 — `/repin-stale` response now carries per-sheet change
// details so the UI can tell users exactly which sheets were re-pinned
// and what revision they jumped to.
export interface RepinChange {
  itemId: string;
  sheetId: string;
  sheetName: string;
  fromRevision: string | null;
  toRevision: string | null;
  action: "updated" | "removed";
}

interface RepinStaleResult {
  updated: number;
  replaced: number;
  removed: number;
  changes: RepinChange[];
}

interface DrawingSet {
  id: string;
  projectId: string;
  organizationId: string;
  name: string;
  description: string | null;
  isPrimary: boolean;
  createdByUserId: string | null;
  createdAt: string;
}

interface DrawingSetItem {
  id: string;
  drawingSetId: string;
  sheetId: string;
  revisionId: string | null;
  pinnedAt: string;
}

interface ComparisonResult {
  items: DrawingSetItem[];
  comparison: Array<{
    itemId: string;
    sheetId: string;
    pinnedRevisionId: string | null;
    sheetName: string | null;
    currentRevisionLabel: string | null;
    latestRevisionLabel: string | null;
    latestSheetId: string | null;
    hasNewerRevision: boolean;
  }>;
}

interface DrawingSetsPanelProps {
  projectId: string;
  sheets: TakeoffSheet[];
  userRole: string;
  onSetActive?: (setId: string | null) => void;
  activeSetId?: string | null;
  // Task #1918 — invoked after a successful "Re-pin to latest" so the
  // host (PlansTab) can briefly highlight the affected sheets in its
  // sheet list. Receives the *post-re-pin* sheet ids (latest active
  // revisions) so the highlight lands on the rows the user should
  // re-review.
  onRepinHighlight?: (sheetIds: string[]) => void;
}

// Task #1813 — The pinned-row sub-component is memoized so React Query
// refetches/parent re-renders don't reconcile the entire pinned list. This
// keeps the bulk-manage modal's layout stable, which in turn keeps the
// modal's footer buttons clickable under Playwright's actionability heuristic
// (and avoids the equivalent "click did nothing" feel for human users on
// slow networks).
interface PinnedRowProps {
  itemId: string;
  sheetName: string;
  revisionLabel: string | null;
}

const PinnedRow = memo(function PinnedRow({ itemId, sheetName, revisionLabel }: PinnedRowProps) {
  return (
    <div
      className="flex items-center justify-between p-2 rounded border text-sm"
      data-testid={`pinned-sheet-${itemId}`}
    >
      <div className="min-w-0 flex-1 flex items-center gap-2">
        <Pin className="w-3 h-3 text-green-600 shrink-0" />
        <span className="truncate">{sheetName}</span>
        {revisionLabel && (
          <Badge variant="outline" className="text-xs shrink-0">Rev: {revisionLabel}</Badge>
        )}
      </div>
    </div>
  );
});

// Task #1813 — Bulk-manage dialog extracted into its own component so that:
//   1. its queries (items) and mutation (bulk-replace) only mount when the
//      dialog is actually open, eliminating background work while it's closed;
//   2. updates to the parent panel (drawingSets refetch, sheets array prop
//      identity changing on every PlansTab render, etc.) no longer cascade a
//      re-render through the entire dialog tree, which was making the close
//      button feel laggy/unclickable on slow networks.
// Sheets are looked up by id via a memoized Map so an unstable `sheets`
// array reference doesn't bust memoization of the row list.
interface ManageSetDialogProps {
  setId: string;
  setName: string | null;
  projectId: string;
  sheets: TakeoffSheet[];
  onClose: () => void;
}

const ManageSetDialog = memo(function ManageSetDialog({
  setId,
  setName,
  projectId,
  sheets,
  onClose,
}: ManageSetDialogProps) {
  const { toast } = useToast();

  const { data: manageItems = [] } = useQuery<DrawingSetItem[]>({
    queryKey: ["/api/projects", "drawing-sets", setId, "items"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/drawing-sets/${setId}/items`);
      if (!res.ok) throw new Error("Failed to load items");
      return res.json();
    },
  });

  // Stable lookup so the row list doesn't recompute on every parent render
  // (sheets is a fresh array reference each PlansTab render).
  const sheetsById = useMemo(() => {
    const m = new Map<string, TakeoffSheet>();
    for (const s of sheets) m.set(s.id, s);
    return m;
  }, [sheets]);

  const activeProjectSheets = useMemo(
    () => sheets.filter((s) => s.isActive),
    [sheets],
  );

  // Task #1661 — bulk-replace mutation: rewrites the entire pinned-sheet
  // list in one call. Used by the "Pin all active sheets" and "Clear all
  // pinned sheets" bulk actions in the slimmed-down Manage modal. Routine
  // per-sheet pin/unpin happens inline on the sheet row, not in this modal.
  const bulkReplaceMutation = useMutation({
    mutationFn: async ({ items }: { items: Array<{ sheetId: string }> }) => {
      if (items.length === 0) {
        // Backend rejects empty arrays; clear by deleting each existing item.
        await Promise.all(
          manageItems.map((i) =>
            apiRequest("DELETE", `/api/projects/drawing-sets/${setId}/items/${i.id}`),
          ),
        );
        return [];
      }
      const res = await apiRequest(
        "POST",
        `/api/projects/drawing-sets/${setId}/items/bulk`,
        { items },
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", "drawing-sets", setId, "items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", "drawing-sets", setId, "sheet-status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", "drawing-sets", setId, "compare"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "drawing-sets"] });
      // Task #1893 — keep the projects-list staleness roll-up in sync.
      queryClient.invalidateQueries({ queryKey: ["/api/projects/drawing-sets/stale-summary"] });
      toast({ title: "Pinned sheets updated" });
    },
    // Task #1812 — surface duplicate-pin (409) responses with a friendly,
    // set-named toast so users understand why a bulk pin attempt didn't
    // appear to do anything. Other failures keep the generic message.
    onError: (err: unknown) => {
      toast({
        title: "Error",
        description: bulkPinErrorDescription(err, { setName }),
        variant: "destructive",
      });
    },
  });

  const handlePinAllActive = useCallback(() => {
    bulkReplaceMutation.mutate({
      items: activeProjectSheets.map((s) => ({ sheetId: s.id })),
    });
  }, [bulkReplaceMutation, activeProjectSheets]);

  const handleClearAll = useCallback(() => {
    bulkReplaceMutation.mutate({ items: [] });
  }, [bulkReplaceMutation]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) onClose();
    },
    [onClose],
  );

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-lg max-h-[80vh] overflow-y-auto"
        data-testid="dialog-manage-set-items"
      >
        <DialogHeader>
          <DialogTitle>Bulk Manage Drawing Set</DialogTitle>
        </DialogHeader>
        {/* Task #1661 — slimmed-down modal: routine per-sheet pin/unpin
            now happens inline on each sheet row when this set is active.
            This dialog is kept for bulk operations (replace all, clear all)
            and a read-only summary of what is currently pinned. */}
        <div className="space-y-4">
          <div
            className="flex items-start gap-2 p-2 rounded border bg-muted/30 text-xs text-muted-foreground"
            data-testid="manage-set-inline-hint"
          >
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>
              Tip: pin and unpin individual sheets directly from the sheet
              list while this set is active. Use the actions below for bulk
              changes.
            </span>
          </div>

          <div>
            <h4 className="text-sm font-medium mb-2">Bulk Actions</h4>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handlePinAllActive}
                disabled={bulkReplaceMutation.isPending || activeProjectSheets.length === 0}
                data-testid="button-pin-all-active"
              >
                {bulkReplaceMutation.isPending && (
                  <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                )}
                <Pin className="w-3.5 h-3.5 mr-1" />
                Pin all active sheets ({activeProjectSheets.length})
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleClearAll}
                disabled={bulkReplaceMutation.isPending || manageItems.length === 0}
                data-testid="button-clear-all-pinned"
              >
                <X className="w-3.5 h-3.5 mr-1" />
                Clear all pinned
              </Button>
            </div>
          </div>

          <div>
            <h4 className="text-sm font-medium mb-2" data-testid="text-pinned-count">
              Currently Pinned ({manageItems.length})
            </h4>
            {manageItems.length === 0 ? (
              <p className="text-xs text-muted-foreground italic" data-testid="text-no-pinned-sheets">
                No sheets pinned yet. Pin from the sheet list or use a bulk action above.
              </p>
            ) : (
              <div className="space-y-1 max-h-60 overflow-y-auto">
                {manageItems.map((item) => {
                  const sheet = sheetsById.get(item.sheetId);
                  const revisionLabel = sheet?.revisionLabel || item.revisionId;
                  return (
                    <PinnedRow
                      key={item.id}
                      itemId={item.id}
                      sheetName={sheet?.sheetName || item.sheetId}
                      revisionLabel={revisionLabel ?? null}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            data-testid="button-close-manage-set"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

// Task #1857 — Compare dialog extracted into its own memoized component so:
//   1. its compare query only mounts when the dialog is actually open,
//      eliminating background work while it's closed and avoiding stale
//      data flashing in when the user reopens it later;
//   2. updates to the parent panel (drawingSets refetch, sheets prop
//      identity changing on every PlansTab render) no longer cascade a
//      re-render through every compare row, which was making future
//      close/accept actions feel laggy on slow networks.
interface CompareRowData {
  itemId: string;
  sheetName: string | null;
  sheetId: string;
  currentRevisionLabel: string | null;
  latestRevisionLabel: string | null;
  latestSheetId: string | null;
  hasNewerRevision: boolean;
}

interface CompareRowProps {
  item: CompareRowData;
  onAcceptLatest: (item: CompareRowData) => void;
  isAccepting: boolean;
  canAccept: boolean;
}

const CompareRow = memo(function CompareRow({
  item,
  onAcceptLatest,
  isAccepting,
  canAccept,
}: CompareRowProps) {
  // Task #1880 — keep the badge and the per-row accept action driven by
  // the same condition. The backend marks `hasNewerRevision=true` for two
  // distinct cases:
  //   1. an active sheet with the same name has replaced the pinned one
  //      (`latestSheetId` is set) — actionable, show "Newer Available" +
  //      "Accept latest";
  //   2. the pinned sheet itself is inactive and no active replacement
  //      exists (`latestSheetId === null`) — there is nothing to accept,
  //      so show a distinct "Pinned sheet inactive" status without the
  //      accept button rather than misleadingly offering an accept action.
  const isActionableUpdate = item.hasNewerRevision && !!item.latestSheetId;
  const isOrphanedPin = item.hasNewerRevision && !item.latestSheetId;
  return (
    <div
      className={`flex items-center justify-between gap-2 p-2 rounded border text-sm ${item.hasNewerRevision ? "border-amber-400 bg-amber-50/50 dark:bg-amber-900/10" : ""}`}
      data-testid={`compare-item-${item.itemId}`}
    >
      <div className="min-w-0 flex-1">
        <span className="truncate font-medium">{item.sheetName || item.sheetId}</span>
        <div className="flex gap-2 mt-0.5">
          <span className="text-xs text-muted-foreground">
            Pinned: {item.currentRevisionLabel || "—"}
          </span>
          <span className="text-xs text-muted-foreground">
            Latest: {item.latestRevisionLabel || "—"}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {isActionableUpdate ? (
          <>
            <Badge variant="outline" className="text-xs border-amber-400 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="w-3 h-3 mr-0.5" />
              Newer Available
            </Badge>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => onAcceptLatest(item)}
              disabled={!canAccept}
              data-testid={`button-accept-latest-${item.itemId}`}
            >
              {isAccepting ? (
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              ) : (
                <Check className="w-3 h-3 mr-1" />
              )}
              Accept latest
            </Button>
          </>
        ) : isOrphanedPin ? (
          <Badge
            variant="outline"
            className="text-xs border-amber-400 text-amber-700 dark:text-amber-400"
            data-testid={`badge-pinned-inactive-${item.itemId}`}
          >
            <AlertTriangle className="w-3 h-3 mr-0.5" />
            Pinned sheet inactive
          </Badge>
        ) : (
          <Badge variant="outline" className="text-xs text-green-600 dark:text-green-400">
            <Check className="w-3 h-3 mr-0.5" />
            Up to Date
          </Badge>
        )}
      </div>
    </div>
  );
});

// Task #1918 — Follow-up dialog shown after a successful "Re-pin to
// latest". Lists the affected sheets with their old → new revision
// labels (e.g. "A-100: v1 → v3") so field users know which drawings
// to re-review. Driven entirely by the `changes` array returned by
// `/repin-stale` (no extra round-trip).
interface RepinChangesDialogProps {
  open: boolean;
  changes: RepinChange[];
  onClose: () => void;
}

const RepinChangesDialog = memo(function RepinChangesDialog({
  open,
  changes,
  onClose,
}: RepinChangesDialogProps) {
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) onClose();
    },
    [onClose],
  );
  const count = changes.length;
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-lg max-h-[80vh] overflow-y-auto"
        data-testid="dialog-repin-changes"
      >
        <DialogHeader>
          <DialogTitle data-testid="text-repin-changes-title">
            {count === 1
              ? "Re-pinned 1 sheet to latest"
              : `Re-pinned ${count} sheets to latest`}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <p
            className="text-xs text-muted-foreground"
            data-testid="text-repin-changes-subtitle"
          >
            Review the updated drawings below — they now point at their
            latest active revision.
          </p>
          <div className="space-y-1.5">
            {changes.map((change) => (
              <div
                key={change.itemId}
                className="flex items-center justify-between gap-2 p-2 rounded border text-sm bg-amber-50/50 border-amber-200 dark:bg-amber-900/10 dark:border-amber-900/40"
                data-testid={`repin-change-${change.itemId}`}
              >
                <span
                  className="truncate font-medium"
                  data-testid={`text-repin-change-name-${change.itemId}`}
                >
                  {change.sheetName}
                </span>
                <div className="flex items-center gap-1.5 shrink-0 text-xs">
                  <Badge
                    variant="outline"
                    className="text-[10px]"
                    data-testid={`badge-repin-from-${change.itemId}`}
                  >
                    {change.fromRevision || "—"}
                  </Badge>
                  <ArrowRight className="w-3 h-3 text-muted-foreground" />
                  <Badge
                    variant="outline"
                    className="text-[10px] border-green-400 text-green-700 dark:text-green-400"
                    data-testid={`badge-repin-to-${change.itemId}`}
                  >
                    {change.toRevision || "—"}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            data-testid="button-close-repin-changes"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

interface CompareSetDialogProps {
  setId: string;
  onClose: () => void;
  onRepinChanges: (changes: RepinChange[]) => void;
}

const CompareSetDialog = memo(function CompareSetDialog({
  setId,
  onClose,
  onRepinChanges,
}: CompareSetDialogProps) {
  const { toast } = useToast();
  const [acceptingItemId, setAcceptingItemId] = useState<string | null>(null);
  const [acceptingAll, setAcceptingAll] = useState(false);

  const { data: compareData } = useQuery<ComparisonResult>({
    queryKey: ["/api/projects", "drawing-sets", setId, "compare"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/drawing-sets/${setId}/compare`);
      if (!res.ok) throw new Error("Failed to compare");
      return res.json();
    },
  });

  // Task #1880 — accept-latest (single row) mutation re-pins one stale
  // sheet to its newer active revision. We rebuild the full pinned-items
  // list with that one swap applied and send it through the existing bulk
  // endpoint. After success we invalidate the compare, items, and
  // sheet-status queries so the dialog and underlying sheet list
  // immediately reflect the new pinned state.
  const acceptLatestMutation = useMutation({
    mutationFn: async ({ swaps }: { swaps: Map<string, string> }) => {
      if (!compareData) throw new Error("No compare data loaded");
      const items = compareData.comparison.map((row) => ({
        sheetId: swaps.get(row.itemId) ?? row.sheetId,
      }));
      const res = await apiRequest(
        "POST",
        `/api/projects/drawing-sets/${setId}/items/bulk`,
        { items },
      );
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", "drawing-sets", setId, "compare"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", "drawing-sets", setId, "items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", "drawing-sets", setId, "sheet-status"] });
      const count = variables.swaps.size;
      toast({
        title: count === 1 ? "Accepted latest revision" : `Accepted ${count} latest revisions`,
      });
    },
    onError: (err: unknown) => {
      toast({
        title: "Error",
        description: bulkPinErrorDescription(err, {}),
        variant: "destructive",
      });
    },
    onSettled: () => {
      setAcceptingItemId(null);
    },
  });

  // Task #1894 — "Re-pin all stale to latest" mutation hits a dedicated
  // server endpoint (`/repin-stale`) that recomputes stale rows
  // server-side and updates them atomically inside a transaction. This
  // avoids the unique-constraint (HTTP 409) hazard the previous
  // client-side bulk-replace approach had whenever the latest revision
  // of one stale row was already pinned as another item in the set.
  const repinStaleMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        `/api/projects/drawing-sets/${setId}/repin-stale`,
      );
      return res.json() as Promise<RepinStaleResult>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", "drawing-sets", setId, "compare"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", "drawing-sets", setId, "items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", "drawing-sets", setId, "sheet-status"] });
      // Task #1893 — keep portfolio-level stale roll-up in sync.
      queryClient.invalidateQueries({ queryKey: ["/api/projects/drawing-sets/stale-summary"] });
      const count = data?.updated ?? 0;
      const changes = data?.changes ?? [];
      // Task #1918 — when at least one sheet was re-pinned, surface a
      // follow-up dialog (via the parent) listing the affected sheets
      // with from→to revision labels instead of the stand-alone toast.
      // The "no stale sheets" case keeps the lightweight toast since
      // there's nothing to enumerate.
      if (count > 0 && changes.length > 0) {
        onRepinChanges(changes);
      } else {
        toast({ title: "No stale sheets to update" });
      }
    },
    onError: (err: unknown) => {
      toast({
        title: "Error",
        description: bulkPinErrorDescription(err, {}),
        variant: "destructive",
      });
    },
    onSettled: () => {
      setAcceptingAll(false);
    },
  });

  const handleAcceptLatest = useCallback(
    (item: CompareRowData) => {
      if (!item.latestSheetId) return;
      setAcceptingItemId(item.itemId);
      const swaps = new Map<string, string>();
      swaps.set(item.itemId, item.latestSheetId);
      acceptLatestMutation.mutate({ swaps });
    },
    [acceptLatestMutation],
  );

  const handleAcceptAllNewer = useCallback(() => {
    if (!compareData) return;
    const hasAny = compareData.comparison.some(
      (row) => row.hasNewerRevision && row.latestSheetId,
    );
    if (!hasAny) return;
    setAcceptingAll(true);
    repinStaleMutation.mutate();
  }, [compareData, repinStaleMutation]);

  const newerCount = useMemo(
    () =>
      compareData?.comparison.filter(
        (r) => r.hasNewerRevision && r.latestSheetId,
      ).length ?? 0,
    [compareData],
  );

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) onClose();
    },
    [onClose],
  );

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto" data-testid="dialog-compare-set">
        <DialogHeader>
          <DialogTitle>Compare Set vs Latest Revisions</DialogTitle>
        </DialogHeader>
        {compareData ? (
          <div className="space-y-3">
            {compareData.comparison.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-3">
                No sheets pinned in this set yet.
              </p>
            ) : (
              <>
                {newerCount > 0 && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground" data-testid="text-newer-count">
                      {newerCount === 1
                        ? "1 sheet has a newer revision available."
                        : `${newerCount} sheets have newer revisions available.`}
                    </span>
                    {/* Task #1894 — one-click "Re-pin to latest" focuses on
                        only the stale rows (driven by the new server
                        endpoint) so non-stale pinned items are preserved. */}
                    <Button
                      size="sm"
                      variant="default"
                      onClick={handleAcceptAllNewer}
                      disabled={
                        acceptLatestMutation.isPending ||
                        repinStaleMutation.isPending
                      }
                      data-testid="button-accept-all-newer"
                    >
                      {acceptingAll ? (
                        <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                      ) : (
                        <Check className="w-3.5 h-3.5 mr-1" />
                      )}
                      Re-pin {newerCount} stale to latest
                    </Button>
                  </div>
                )}
                <div className="space-y-2">
                  {compareData.comparison.map((item) => (
                    <CompareRow
                      key={item.itemId}
                      item={item}
                      onAcceptLatest={handleAcceptLatest}
                      isAccepting={acceptingItemId === item.itemId}
                      canAccept={
                        !acceptLatestMutation.isPending &&
                        !repinStaleMutation.isPending
                      }
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="flex justify-center py-4">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
});

// Task #1879 / #1894 — Per-card "out of date" indicator. Reuses the
// existing `/compare` query (and its query key) so opening the compare
// dialog after viewing the badge serves cached data and avoids a second
// round trip. Shows nothing while loading or when the set has no pinned
// sheets, an amber "N newer available" badge (paired with an admin-only
// one-click "Re-pin to latest" button per Task #1894) when one or more
// pinned sheets have a newer revision available, and a green "Up to
// date" badge otherwise.
interface SetStaleBadgeProps {
  setId: string;
  onOpenCompare: (setId: string) => void;
  canRepin: boolean;
  // Task #1918 — propagated up so the parent can show the follow-up
  // "what changed" dialog and trigger the sheet-list highlight.
  onRepinChanges: (changes: RepinChange[]) => void;
}

const SetStaleBadge = memo(function SetStaleBadge({
  setId,
  onOpenCompare,
  canRepin,
  onRepinChanges,
}: SetStaleBadgeProps) {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<ComparisonResult>({
    queryKey: ["/api/projects", "drawing-sets", setId, "compare"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/drawing-sets/${setId}/compare`);
      if (!res.ok) throw new Error("Failed to compare");
      return res.json();
    },
  });

  // Task #1894 — one-click "Re-pin to latest" action surfaced directly
  // from the per-card stale badge so users can resolve staleness without
  // first opening the Compare dialog. Posts to the dedicated server
  // endpoint which dedupes/scopes atomically (no HTTP 409 hazard).
  const repinStaleMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        `/api/projects/drawing-sets/${setId}/repin-stale`,
      );
      return res.json() as Promise<RepinStaleResult>;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", "drawing-sets", setId, "compare"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", "drawing-sets", setId, "items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", "drawing-sets", setId, "sheet-status"] });
      // Task #1893 — keep portfolio-level stale roll-up in sync.
      queryClient.invalidateQueries({ queryKey: ["/api/projects/drawing-sets/stale-summary"] });
      const count = result?.updated ?? 0;
      const changes = result?.changes ?? [];
      // Task #1918 — surface a follow-up dialog enumerating the
      // affected sheets and their from→to revisions instead of the
      // unspecific count toast. Fall back to the toast only when
      // nothing was actually re-pinned.
      if (count > 0 && changes.length > 0) {
        onRepinChanges(changes);
      } else {
        toast({ title: "No stale sheets to update" });
      }
    },
    onError: (err: unknown) => {
      toast({
        title: "Error",
        description: bulkPinErrorDescription(err, {}),
        variant: "destructive",
      });
    },
  });

  // Hooks must be declared unconditionally (above any early return) so the
  // hook order stays stable across renders — see Task #1879 fix.
  const handleClick = useCallback(
    (e: ReactMouseEvent) => {
      e.stopPropagation();
      onOpenCompare(setId);
    },
    [onOpenCompare, setId],
  );

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        onOpenCompare(setId);
      }
    },
    [onOpenCompare, setId],
  );

  const handleRepinClick = useCallback(
    (e: ReactMouseEvent) => {
      e.stopPropagation();
      if (repinStaleMutation.isPending) return;
      repinStaleMutation.mutate();
    },
    [repinStaleMutation],
  );

  if (isLoading || !data || data.comparison.length === 0) return null;

  const newerCount = data.comparison.filter((c) => c.hasNewerRevision).length;
  // Only rows with an actual `latestSheetId` are actionable for re-pin.
  const actionableNewerCount = data.comparison.filter(
    (c) => c.hasNewerRevision && c.latestSheetId,
  ).length;
  const totalPinned = data.comparison.length;

  if (newerCount > 0) {
    return (
      <TooltipProvider delayDuration={200}>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                role="button"
                tabIndex={0}
                onClick={handleClick}
                onKeyDown={handleKeyDown}
                className="text-xs border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400 cursor-pointer hover-elevate active-elevate-2"
                data-testid={`badge-set-stale-${setId}`}
              >
                <AlertTriangle className="w-3 h-3 mr-0.5" />
                {newerCount} newer available
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              {newerCount} of {totalPinned} pinned{" "}
              {totalPinned === 1 ? "sheet has" : "sheets have"} a newer revision
              available. Click to compare.
            </TooltipContent>
          </Tooltip>
          {canRepin && actionableNewerCount > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-5 px-1.5 text-xs gap-0.5 border-amber-400 text-amber-700 dark:text-amber-400"
                  onClick={handleRepinClick}
                  disabled={repinStaleMutation.isPending}
                  data-testid={`button-repin-stale-${setId}`}
                >
                  {repinStaleMutation.isPending ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Check className="w-3 h-3" />
                  )}
                  Re-pin to latest
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                Replace only the {actionableNewerCount} stale{" "}
                {actionableNewerCount === 1 ? "sheet" : "sheets"} with the
                latest active revision. Other pinned sheets are left untouched.
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            role="button"
            tabIndex={0}
            onClick={handleClick}
            onKeyDown={handleKeyDown}
            className="text-xs border-green-400 text-green-700 dark:text-green-400 cursor-pointer hover-elevate active-elevate-2"
            data-testid={`badge-set-uptodate-${setId}`}
          >
            <Check className="w-3 h-3 mr-0.5" />
            Up to date
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          All {totalPinned} pinned{" "}
          {totalPinned === 1 ? "sheet matches" : "sheets match"} the latest
          active revision. Click to compare.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});

export default function DrawingSetsPanel({
  projectId,
  sheets,
  userRole,
  onSetActive,
  activeSetId,
  onRepinHighlight,
}: DrawingSetsPanelProps) {
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingSet, setEditingSet] = useState<DrawingSet | null>(null);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [compareSetId, setCompareSetId] = useState<string | null>(null);
  const [manageSetId, setManageSetId] = useState<string | null>(null);
  // Task #1918 — track the most recent re-pin's per-sheet changes so we
  // can pop the "what changed" follow-up dialog and (optionally) light
  // up the affected rows in the host sheet list. `repinChanges` doubles
  // as the dialog's open flag — non-empty array → open.
  const [repinChanges, setRepinChanges] = useState<RepinChange[]>([]);

  const isAdmin = ["ADMIN", "MANAGER"].includes(userRole);

  const { data: drawingSets = [], isLoading } = useQuery<DrawingSet[]>({
    queryKey: ["/api/projects", projectId, "drawing-sets"],
    enabled: !!projectId,
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; description?: string }) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/drawing-sets`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "drawing-sets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects/drawing-sets/stale-summary"] });
      setCreateOpen(false);
      setNewName("");
      setNewDescription("");
      toast({ title: "Drawing set created" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create drawing set.", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: string; name?: string; description?: string }) => {
      const res = await apiRequest("PATCH", `/api/projects/drawing-sets/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "drawing-sets"] });
      setEditingSet(null);
      toast({ title: "Drawing set updated" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update drawing set.", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/projects/drawing-sets/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "drawing-sets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects/drawing-sets/stale-summary"] });
      toast({ title: "Drawing set deleted" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete drawing set.", variant: "destructive" });
    },
  });

  const setPrimaryMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/projects/drawing-sets/${id}/primary`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "drawing-sets"] });
      toast({ title: "Primary set updated" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to set primary.", variant: "destructive" });
    },
  });

  const handleCloseManage = useCallback(() => setManageSetId(null), []);
  const handleCloseCompare = useCallback(() => setCompareSetId(null), []);
  // Task #1879 — stable handler so the per-card stale badge stays
  // memoized across parent re-renders.
  const handleOpenCompare = useCallback(
    (id: string) => setCompareSetId(id),
    [],
  );
  // Task #1918 — handler invoked by both the per-card stale badge and
  // the in-dialog "Re-pin to latest" action when the server returns at
  // least one change. We:
  //   1. open the follow-up "what changed" dialog enumerating the
  //      affected sheets with from→to revision labels;
  //   2. notify the host (PlansTab) so it can briefly highlight those
  //      rows in its sheet list — only the *post-re-pin* (latest)
  //      sheet ids are forwarded so the highlight lands on the rows
  //      the user should actually re-review.
  const handleRepinChanges = useCallback(
    (changes: RepinChange[]) => {
      setRepinChanges(changes);
      if (onRepinHighlight && changes.length > 0) {
        onRepinHighlight(changes.map((c) => c.sheetId));
      }
    },
    [onRepinHighlight],
  );
  const handleCloseRepinChanges = useCallback(() => setRepinChanges([]), []);
  // Task #1812 — pass the set name to the dialog so its bulk-replace error
  // toast can name the offending set (via bulkPinErrorDescription) when the
  // backend rejects a duplicate pin with HTTP 409.
  const manageSetName = useMemo(
    () => (manageSetId ? drawingSets.find(s => s.id === manageSetId)?.name ?? null : null),
    [manageSetId, drawingSets],
  );

  return (
    <div className="space-y-3" data-testid="drawing-sets-panel">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <Layers className="w-4 h-4" />
          Drawing Sets
        </h3>
        {isAdmin && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCreateOpen(true)}
            data-testid="button-create-drawing-set"
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            New Set
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : drawingSets.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-3" data-testid="text-no-drawing-sets">
          No drawing sets created yet.
        </p>
      ) : (
        <div className="space-y-2">
          {drawingSets.map((set) => (
            <Card
              key={set.id}
              className={`cursor-pointer transition-colors ${activeSetId === set.id ? "border-primary bg-primary/5" : ""} ${set.isPrimary ? "border-amber-400/50" : ""}`}
              data-testid={`card-drawing-set-${set.id}`}
              onClick={() => onSetActive?.(activeSetId === set.id ? null : set.id)}
            >
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-medium truncate" data-testid={`text-set-name-${set.id}`}>
                        {set.name}
                      </span>
                      {set.isPrimary && (
                        <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-900/20 dark:text-amber-400">
                          <Star className="w-3 h-3 mr-0.5" />
                          Current
                        </Badge>
                      )}
                      {activeSetId === set.id && (
                        <Badge className="text-xs">Active View</Badge>
                      )}
                      <SetStaleBadge
                        setId={set.id}
                        onOpenCompare={handleOpenCompare}
                        canRepin={isAdmin}
                        onRepinChanges={handleRepinChanges}
                      />
                    </div>
                    {set.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{set.description}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {new Date(set.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setCompareSetId(set.id)}
                      title="Compare with latest"
                      data-testid={`button-compare-set-${set.id}`}
                    >
                      <GitCompare className="w-3.5 h-3.5" />
                    </Button>
                    {isAdmin && (
                      <>
                        {!set.isPrimary && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => setPrimaryMutation.mutate(set.id)}
                            disabled={setPrimaryMutation.isPending}
                            title="Set as primary"
                            data-testid={`button-set-primary-${set.id}`}
                          >
                            <Star className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setManageSetId(set.id)}
                          title="Manage sheets"
                          data-testid={`button-manage-set-${set.id}`}
                        >
                          <Layers className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => {
                            setEditingSet(set);
                            setNewName(set.name);
                            setNewDescription(set.description || "");
                          }}
                          title="Edit"
                          data-testid={`button-edit-set-${set.id}`}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => deleteMutation.mutate(set.id)}
                          disabled={deleteMutation.isPending}
                          title="Delete"
                          data-testid={`button-delete-set-${set.id}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent data-testid="dialog-create-drawing-set">
          <DialogHeader>
            <DialogTitle>Create Drawing Set</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="set-name">Name</Label>
              <Input
                id="set-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder='e.g. "IFC Set 03/15"'
                data-testid="input-set-name"
              />
            </div>
            <div>
              <Label htmlFor="set-description">Description (optional)</Label>
              <Input
                id="set-description"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Brief description..."
                data-testid="input-set-description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate({ name: newName, description: newDescription || undefined })}
              disabled={!newName.trim() || createMutation.isPending}
              data-testid="button-submit-drawing-set"
            >
              {createMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingSet} onOpenChange={(open) => { if (!open) setEditingSet(null); }}>
        <DialogContent data-testid="dialog-edit-drawing-set">
          <DialogHeader>
            <DialogTitle>Edit Drawing Set</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="edit-set-name">Name</Label>
              <Input
                id="edit-set-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                data-testid="input-edit-set-name"
              />
            </div>
            <div>
              <Label htmlFor="edit-set-description">Description</Label>
              <Input
                id="edit-set-description"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                data-testid="input-edit-set-description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingSet(null)}>Cancel</Button>
            <Button
              onClick={() => editingSet && updateMutation.mutate({ id: editingSet.id, name: newName, description: newDescription })}
              disabled={!newName.trim() || updateMutation.isPending}
              data-testid="button-save-drawing-set"
            >
              {updateMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {manageSetId && (
        <ManageSetDialog
          setId={manageSetId}
          setName={manageSetName}
          projectId={projectId}
          sheets={sheets}
          onClose={handleCloseManage}
        />
      )}

      {compareSetId && (
        <CompareSetDialog
          setId={compareSetId}
          onClose={handleCloseCompare}
          onRepinChanges={handleRepinChanges}
        />
      )}

      {/* Task #1918 — follow-up dialog listing what changed after a
          successful re-pin. Mounted unconditionally so the dialog can
          animate its enter/exit transitions; its `open` flag is driven
          by the presence of any tracked changes. */}
      <RepinChangesDialog
        open={repinChanges.length > 0}
        changes={repinChanges}
        onClose={handleCloseRepinChanges}
      />
    </div>
  );
}
