import { useState, useMemo, useCallback, useRef, useEffect, lazy, Suspense, memo } from "react";
import PdfPreview from "@/components/PdfPreview";
import { PlanPinLayer, PinPicker, PinCreateDialog, type PinFilter, type PinType, type PlanPin, type ClusterDensity, DEFAULT_CLUSTER_DENSITY } from "@/components/PlanPinLayer";
import PlanMarkupLayer, { type MarkupHistoryState } from "@/components/markups/PlanMarkupLayer";
import UnifiedPlanToolbar from "@/components/plans/UnifiedPlanToolbar";
import MarkupLayersPanel from "@/components/markups/MarkupLayersPanel";
import MarkupTrashPanel from "@/components/markups/MarkupTrashPanel";
import type { MarkupTool } from "@/components/markups/MarkupRenderer";
import CarryoverAnnotationsDialog from "@/components/markups/CarryoverAnnotationsDialog";
import LayerPickerExportDialog from "@/components/markups/LayerPickerExportDialog";
import { findSupersededPdfDoc, uploadOutcomeToast } from "@/components/project-tabs/planRevisionMatch";
import SheetJumpPalette, { useSheetJumpPaletteHotkey, type SheetJumpResult } from "@/components/SheetJumpPalette";
import { useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import TakeoffWorkspace from "@/components/TakeoffWorkspace";
import { WidgetErrorBoundary } from "@/components/WidgetErrorBoundary";
import DocumentRevisionPanel from "@/components/DocumentRevisionPanel";
import ProjectAddenda from "@/components/ProjectAddenda";
import { ObjectUploader } from "@/components/ObjectUploader";
import { useTableKeyboardNav } from "@/hooks/use-table-keyboard-nav";
import { useRegisterShortcuts, TABLE_NAV_SHORTCUTS } from "@/components/KeyboardShortcutsHelp";
import BidLibrarySection from "@/components/bid/BidLibrarySection";
import {
  Upload, Download, Eye, FileText, Trash2, FolderOpen, Folder, ChevronRight, ChevronDown,
  Search, MoreVertical, File, Pencil, GripVertical, ArrowRight, Copy, Loader2,
  ExternalLink, X, FolderPlus, Printer, RotateCw, EyeOff, RefreshCw, Box, BookOpen, Columns2, Link2,
  Building2, Layers, Pin, PinOff, ArrowUpCircle
} from "lucide-react";
const BimViewer = lazy(() => import("@/components/bid/BimViewer"));
import BimQuantityDialog from "@/components/bim/BimQuantityDialog";
import type { BimExtractionResult } from "@/utils/ifc-quantity-parser";
import type { QuantityCategory } from "@shared/schema";
import type { BimElementSummary, BimSelectedElement } from "@/components/bid/BimViewer";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { useProjectDocuments } from "@/hooks/use-data";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { pinSheetErrorDescription } from "@/lib/drawingSetErrors";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useTour } from "@/components/TourProvider";
import type { TakeoffSheet } from "@shared/schema";
import { cn } from "@/lib/utils";
import { useFeatureFlags } from "@/hooks/use-feature-flags";
import LibraryPanel from "@/components/LibraryPanel";
import DrawingSetsPanel from "@/components/DrawingSetsPanel";
import ReportsPage from "@/pages/reports";

interface PlansTabProps {
  projectCode: string;
  project: any;
}

type SubTab = "plans" | "addenda" | "libraries" | "reports" | "drawing-sets";

interface DocGroup {
  name: string;
  expanded: boolean;
  types: string[];
  children?: DocGroup[];
  parentName?: string;
}

const DEFAULT_GROUPS: DocGroup[] = [
  { name: "Plans", expanded: true, types: ["PLANS"] },
  { name: "Specifications", expanded: true, types: ["SPECS"] },
  { name: "Takeoff", expanded: false, types: ["TAKEOFF"] },
  { name: "BIM Models", expanded: true, types: ["BIM"] },
  { name: "Supporting Documents", expanded: true, types: ["OTHER"] },
];

interface DrawingSetInfo {
  id: string;
  projectId: string;
  organizationId: string;
  name: string;
  description: string | null;
  isPrimary: boolean;
  createdByUserId: string | null;
  createdAt: string;
}

interface DrawingSetItemInfo {
  id: string;
  drawingSetId: string;
  sheetId: string;
  revisionId: string | null;
  pinnedAt: string;
}

interface SheetStatusData {
  pinnedSheetIds: string[];
  newerSheetIds: string[];
  pinnedToLatestMap: Record<string, string | null>;
}

// Task #1858 — Folder names hoisted to module scope so the memoized
// SheetRow can reference them without taking an extra (unstable) prop.
const SHEET_FOLDER_NAMES = ["Plans", "Supporting Documents", "BIM"] as const;

// Task #1858 — Extracted, memoized sheet row. PlansTab is a very large
// component whose tree re-renders on every background query refetch
// (sheets, sheet-status, drawing-sets, items, etc.). Without this memo,
// the inline pin/unpin buttons get reconciled on every refetch and
// Playwright's actionability heuristic flakes — which is the same lag
// human users feel on slow networks/laptops when they click pin and the
// row is mid-reconciliation. Props are primitives and the callbacks are
// stable identities, so a parent re-render with unchanged row state
// short-circuits via React.memo's default shallow compare and the row's
// DOM (and therefore the pin/unpin button) stays put.
interface SheetRowProps {
  sheetId: string;
  sheetName: string | null;
  isBim: boolean;
  hasScale: boolean;
  isSelected: boolean;
  isDragging: boolean;
  isRenaming: boolean;
  renameValue: string;
  effectiveSetId: string | null;
  pinnedItemId: string | null;
  pinnedRevLabel: string | null;
  isPinned: boolean;
  hasNewer: boolean;
  isNotInSet: boolean;
  latestRevisionSheetId: string | null;
  setName: string;
  canManageDrawingSets: boolean;
  pinPending: boolean;
  unpinPending: boolean;
  swapPending: boolean;
  currentFolderName: string;
  onSelect: (sheetId: string) => void;
  onDragStart: (e: any, sheetId: string) => void;
  onDragEnd: () => void;
  onRenameValueChange: (value: string) => void;
  onRenameCommit: (sheetId: string, value: string) => void;
  onRenameCancel: () => void;
  onRenameStart: (sheetId: string, currentName: string) => void;
  onPin: (setId: string, sheetId: string) => void;
  onUnpin: (setId: string, itemId: string) => void;
  onSwapRevision: (setId: string, oldItemId: string, newSheetId: string) => void;
  onDuplicate: (sheetId: string) => void;
  onMove: (sheetId: string, folderGroup: string) => void;
  onDeleteRequest: (sheetId: string) => void;
}

const SheetRow = memo(function SheetRow({
  sheetId,
  sheetName,
  isBim,
  hasScale,
  isSelected,
  isDragging,
  isRenaming,
  renameValue,
  effectiveSetId,
  pinnedItemId,
  pinnedRevLabel,
  isPinned,
  hasNewer,
  isNotInSet,
  latestRevisionSheetId,
  setName,
  canManageDrawingSets,
  pinPending,
  unpinPending,
  swapPending,
  currentFolderName,
  onSelect,
  onDragStart,
  onDragEnd,
  onRenameValueChange,
  onRenameCommit,
  onRenameCancel,
  onRenameStart,
  onPin,
  onUnpin,
  onSwapRevision,
  onDuplicate,
  onMove,
  onDeleteRequest,
}: SheetRowProps) {
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, sheetId)}
      onDragEnd={onDragEnd}
      onClick={() => {
        if (isRenaming) return;
        onSelect(sheetId);
      }}
      className={cn(
        "flex items-start gap-1.5 px-3 py-1.5 text-sm cursor-pointer hover:bg-accent/50 transition-colors group",
        isDragging && "opacity-50",
        isSelected && "bg-accent text-accent-foreground"
      )}
      data-testid={`sheet-${sheetId}`}
    >
      <GripVertical
        className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-50 shrink-0 cursor-grab mt-0.5"
        onClick={(e) => e.stopPropagation()}
      />
      <FileText className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
      {isRenaming ? (
        <Input
          value={renameValue}
          onChange={(e) => onRenameValueChange(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Enter" && renameValue.trim()) {
              onRenameCommit(sheetId, renameValue.trim());
            } else if (e.key === "Escape") {
              onRenameCancel();
            }
          }}
          onBlur={() => {
            if (renameValue.trim()) {
              onRenameCommit(sheetId, renameValue.trim());
            } else {
              onRenameCancel();
            }
          }}
          autoFocus
          className="h-6 text-sm flex-1 px-1"
          data-testid={`input-rename-sheet-${sheetId}`}
        />
      ) : (
        <span className="break-words flex-1 min-w-0 leading-snug">{sheetName}</span>
      )}
      {effectiveSetId && (
        <>
          {hasNewer && isPinned && (
            <Badge
              variant="outline"
              className="text-[9px] h-4 px-1 shrink-0 bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-900/20 dark:text-amber-400"
              data-testid={`badge-newer-revision-${sheetId}`}
              title="A newer revision is available"
            >
              Newer
            </Badge>
          )}
          {isPinned && (
            <Badge
              variant="outline"
              className="text-[9px] h-4 px-1 shrink-0 bg-green-50 text-green-600 border-green-300 dark:bg-green-900/20 dark:text-green-400"
              data-testid={`badge-pinned-${sheetId}`}
              title={`Pinned to ${setName}${pinnedRevLabel ? ` (${pinnedRevLabel})` : ""}`}
            >
              <Pin className="w-2.5 h-2.5 mr-0.5" />
              {pinnedRevLabel ? `Pinned: ${pinnedRevLabel}` : "Pinned"}
            </Badge>
          )}
          {isNotInSet && !isPinned && (
            <Badge
              variant="outline"
              className="text-[9px] h-4 px-1 shrink-0 bg-gray-50 text-gray-500 border-gray-300 dark:bg-gray-800 dark:text-gray-400"
              data-testid={`badge-not-in-set-${sheetId}`}
            >
              Not in set
            </Badge>
          )}
          {canManageDrawingSets && !isRenaming && (
            <>
              {isPinned && hasNewer && latestRevisionSheetId && pinnedItemId && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-5 w-5 shrink-0 text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                  title="Swap pinned revision to latest"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSwapRevision(effectiveSetId, pinnedItemId, latestRevisionSheetId);
                  }}
                  disabled={swapPending}
                  data-testid={`button-swap-revision-${sheetId}`}
                >
                  <ArrowUpCircle className="w-3.5 h-3.5" />
                </Button>
              )}
              {isPinned ? (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100"
                  title={`Remove from ${setName}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!pinnedItemId) return;
                    onUnpin(effectiveSetId, pinnedItemId);
                  }}
                  disabled={unpinPending}
                  data-testid={`button-unpin-sheet-${sheetId}`}
                >
                  <PinOff className="w-3.5 h-3.5" />
                </Button>
              ) : (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100"
                  title={`Pin to ${setName}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPin(effectiveSetId, sheetId);
                  }}
                  disabled={pinPending}
                  data-testid={`button-pin-sheet-${sheetId}`}
                >
                  <Pin className="w-3.5 h-3.5" />
                </Button>
              )}
            </>
          )}
        </>
      )}
      {isBim && (
        <Badge
          variant="secondary"
          className="text-[9px] h-4 px-1 shrink-0 bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300"
          data-testid={`badge-bim-sheet-${sheetId}`}
        >
          BIM
        </Badge>
      )}
      {hasScale && !isRenaming && (
        <Badge variant="outline" className="text-[10px] h-4 px-1 shrink-0">
          Cal
        </Badge>
      )}
      {!isRenaming && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="h-5 w-5 opacity-0 group-hover:opacity-100 shrink-0"
              onClick={(e) => e.stopPropagation()}
              data-testid={`menu-sheet-${sheetId}`}
            >
              <MoreVertical className="w-3 h-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => onRenameStart(sheetId, sheetName || "")}
              data-testid={`button-rename-sheet-${sheetId}`}
            >
              <Pencil className="w-4 h-4 mr-2" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onDuplicate(sheetId)}
              data-testid={`button-duplicate-sheet-${sheetId}`}
            >
              <Copy className="w-4 h-4 mr-2" />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <ArrowRight className="w-4 h-4 mr-2" />
                Move to
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {SHEET_FOLDER_NAMES.filter((f) => f !== currentFolderName).map((targetFolder) => (
                  <DropdownMenuItem
                    key={targetFolder}
                    onClick={() => onMove(sheetId, targetFolder)}
                    data-testid={`button-move-sheet-${sheetId}-${targetFolder.toLowerCase().replace(/\s+/g, "-")}`}
                  >
                    <Folder className="w-4 h-4 mr-2" />
                    {targetFolder}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {effectiveSetId && canManageDrawingSets && (
              <>
                <DropdownMenuSeparator />
                {isPinned ? (
                  <DropdownMenuItem
                    onClick={() => {
                      if (!pinnedItemId) return;
                      onUnpin(effectiveSetId, pinnedItemId);
                    }}
                    data-testid={`menu-unpin-sheet-${sheetId}`}
                  >
                    <PinOff className="w-4 h-4 mr-2" />
                    Unpin from active set
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    onClick={() => onPin(effectiveSetId, sheetId)}
                    data-testid={`menu-pin-sheet-${sheetId}`}
                  >
                    <Pin className="w-4 h-4 mr-2" />
                    Pin to active set
                  </DropdownMenuItem>
                )}
                {isPinned && latestRevisionSheetId && pinnedItemId && (
                  <DropdownMenuItem
                    onClick={() => {
                      onSwapRevision(effectiveSetId, pinnedItemId, latestRevisionSheetId);
                    }}
                    data-testid={`menu-swap-revision-${sheetId}`}
                  >
                    <ArrowUpCircle className="w-4 h-4 mr-2" />
                    Use latest revision
                  </DropdownMenuItem>
                )}
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onDeleteRequest(sheetId)}
              className="text-destructive"
              data-testid={`button-delete-sheet-${sheetId}`}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
});

export default function PlansTab({ projectCode, project }: PlansTabProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { isEnabled: isFeatureFlagEnabled } = useFeatureFlags();
  const bimEnabled = isFeatureFlagEnabled("BIM_VIEWER");

  // Task #1695 — Per-user "Labeled toolbar" preference. Promoted from
  // the legacy `plan-toolbar-labeled-<userId>` localStorage key to a
  // server-side column on the user profile so the toggle syncs across
  // every device the user signs in on.
  //
  // Hydration: initialize from `user.plansToolbarLabeled`, refresh
  // whenever the active user changes (initial resolve or switch), and
  // re-sync if /api/auth/me reports a different value (e.g. another
  // device toggled it).
  //
  // Toggle: optimistically flip local state for instant feedback, then
  // PATCH /api/auth/profile and invalidate /api/auth/me. On failure,
  // revert and surface a toast so the user knows the change didn't
  // persist.
  //
  // One-shot migration: the first time we see this user with the new
  // server flag still false but the legacy localStorage flag set, push
  // the local value up to the server and clear the localStorage entry.
  const { startPlansTour, isPlansTourCompleted } = useTour();
  const LEGACY_LABELED_KEY_PREFIX = "plan-toolbar-labeled-";
  const readLegacyLabeledPref = (uid: string | undefined | null): boolean => {
    if (!uid || typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(`${LEGACY_LABELED_KEY_PREFIX}${uid}`) === "1";
    } catch {
      return false;
    }
  };
  const clearLegacyLabeledPref = (uid: string | undefined | null) => {
    if (!uid || typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(`${LEGACY_LABELED_KEY_PREFIX}${uid}`);
    } catch {}
  };
  const [labeledToolbar, setLabeledToolbar] = useState<boolean>(
    () => user?.plansToolbarLabeled ?? false,
  );
  // Re-sync from the server whenever the active user changes or the
  // server-side preference value updates (e.g. another device toggled
  // it and the next /api/auth/me poll returned the new value).
  useEffect(() => {
    setLabeledToolbar(user?.plansToolbarLabeled ?? false);
  }, [user?.id, user?.plansToolbarLabeled]);
  // Persist toggles to the server. We optimistically flip local state
  // first so the toolbar updates instantly; on failure we restore the
  // captured prior value (deterministic across rapid toggles / races)
  // and surface a toast. A monotonically increasing request id lets us
  // ignore stale failures: only the most recent toggle's failure may
  // roll back, so rapid back-to-back toggles converge on the latest
  // user intent rather than thrashing local state.
  const labeledToolbarRequestSeq = useRef(0);
  const persistLabeledToolbar = useCallback(
    async (next: boolean, previous: boolean) => {
      const requestId = ++labeledToolbarRequestSeq.current;
      try {
        await apiRequest("PATCH", "/api/auth/profile", {
          plansToolbarLabeled: next,
        });
        await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      } catch (error) {
        console.error("Failed to save labeled toolbar preference:", error);
        if (requestId !== labeledToolbarRequestSeq.current) {
          // A newer toggle superseded this one; let its outcome decide
          // the final local state instead of stomping it with a stale
          // rollback.
          return;
        }
        setLabeledToolbar(previous);
        toast({
          title: "Couldn't save toolbar preference",
          description:
            "We couldn't sync your labeled toolbar preference to your account. Please try again.",
          variant: "destructive",
        });
      }
    },
    [toast],
  );
  const toggleLabeledToolbar = useCallback(() => {
    setLabeledToolbar((prev) => {
      const next = !prev;
      void persistLabeledToolbar(next, prev);
      return next;
    });
  }, [persistLabeledToolbar]);
  // One-shot migration: if the server still reports `false` but the
  // legacy per-user-id localStorage key is "1", carry the preference
  // up once and clear the legacy key. Runs at most once per user (the
  // server flag flips to `true` and the legacy key is removed).
  const legacyMigrationAttemptedRef = useRef<string | null>(null);
  useEffect(() => {
    const uid = user?.id;
    if (!uid) return;
    if (user?.plansToolbarLabeled) return;
    if (legacyMigrationAttemptedRef.current === uid) return;
    if (!readLegacyLabeledPref(uid)) return;
    legacyMigrationAttemptedRef.current = uid;
    void (async () => {
      try {
        await apiRequest("PATCH", "/api/auth/profile", {
          plansToolbarLabeled: true,
        });
        clearLegacyLabeledPref(uid);
        // Server is now the source of truth; the invalidation triggers
        // a /api/auth/me refetch which propagates the new value into
        // local state via the hydrate effect above. We avoid eagerly
        // flipping local state so a failed migration cannot leave the
        // UI temporarily diverged from the server.
        await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      } catch (error) {
        console.error("Failed to migrate legacy labeled toolbar preference:", error);
        // Allow another attempt on the next render so a transient
        // failure does not strand the user on the icon-only toolbar.
        legacyMigrationAttemptedRef.current = null;
      }
    })();
  }, [user?.id, user?.plansToolbarLabeled]);

  const { data: documents = [], isLoading: documentsLoading } = useProjectDocuments(projectCode);
  type PinSummaryEntry = {
    total: number;
    rfi: number;
    punch: number;
    submittal: number;
    pages: Record<number, number>;
    closedTotal: number;
    closedRfi: number;
    closedPunch: number;
    closedSubmittal: number;
    closedPages: Record<number, number>;
  };
  const { data: planPinSummary = {} } = useQuery<Record<string, PinSummaryEntry>>({
    queryKey: ["/api/projects", projectCode, "plan-pins", "summary"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectCode}/plan-pins/summary`, { credentials: "include" });
      if (!res.ok) return {};
      return res.json();
    },
    enabled: !!projectCode,
  });
  const [pinCountMode, setPinCountMode] = useState<"open" | "all">(() => {
    if (typeof window === "undefined") return "open";
    try {
      return (sessionStorage.getItem("plan-pin-count-mode") as "open" | "all") || "open";
    } catch {
      return "open";
    }
  });
  useEffect(() => {
    try { sessionStorage.setItem("plan-pin-count-mode", pinCountMode); } catch {}
  }, [pinCountMode]);
  const [pinClusteringEnabled, setPinClusteringEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      const v = sessionStorage.getItem("plan-pin-clustering");
      if (v === "off") return false;
      return true;
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem("plan-pin-clustering", pinClusteringEnabled ? "on" : "off");
    } catch {}
  }, [pinClusteringEnabled]);
  // Task #1671 — User-tunable cluster density. Persisted alongside the
  // existing "Cluster pins" toggle so a user's preference for very
  // dense punch-walks survives navigation.
  const [pinClusterDensity, setPinClusterDensity] = useState<ClusterDensity>(() => {
    if (typeof window === "undefined") return DEFAULT_CLUSTER_DENSITY;
    try {
      const v = sessionStorage.getItem("plan-pin-cluster-density");
      if (v === "low" || v === "medium" || v === "high") return v;
      return DEFAULT_CLUSTER_DENSITY;
    } catch {
      return DEFAULT_CLUSTER_DENSITY;
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem("plan-pin-cluster-density", pinClusterDensity);
    } catch {}
  }, [pinClusterDensity]);
  const { data: sheets = [] } = useQuery<TakeoffSheet[]>({
    queryKey: ["/api/projects", project?.id, "takeoff", "sheets"],
    enabled: !!project?.id,
  });

  const [subTab, setSubTab] = useState<SubTab>("plans");

  // Task #1663 — Auto-trigger the plans tour the first time a user
  // opens the plans sub-tab. Wait briefly so the takeoff workspace
  // toolbar (the tour's first targets) has time to mount in the DOM
  // before Joyride tries to anchor onto it.
  const tourTriggeredRef = useRef(false);
  // Reset the per-mount auto-trigger guard whenever the active user
  // changes. Without this, an account switch while this tab is still
  // mounted would carry user A's "already triggered this session" flag
  // into user B's session and silently suppress B's first-run tour.
  useEffect(() => {
    tourTriggeredRef.current = false;
  }, [user?.id]);
  useEffect(() => {
    if (tourTriggeredRef.current) return;
    if (!user?.id) return;
    if (isPlansTourCompleted) return;
    if (subTab !== "plans") return;
    // Set the "triggered" flag inside the timer (not before it). If the
    // user navigates away from the plans subtab before 800ms elapses,
    // the cleanup clears the timer and the flag stays false, so the
    // auto-tour will fire on a later visit within the same session.
    const timer = window.setTimeout(() => {
      tourTriggeredRef.current = true;
      startPlansTour();
    }, 800);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, isPlansTourCompleted, subTab]);

  const [documentTitle, setDocumentTitle] = useState("");
  const [documentType, setDocumentType] = useState<string>("OTHER");
  const [searchQuery, setSearchQuery] = useState("");
  const [groups, setGroups] = useState(DEFAULT_GROUPS);
  const urlDocIdRef = useRef<string | null>(null);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const docId = params.get("documentId");
      if (docId) {
        urlDocIdRef.current = docId;
        return docId;
      }
    }
    return null;
  });
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(() => typeof window !== 'undefined' ? window.innerWidth < 768 : false);
  const [deleteDocId, setDeleteDocId] = useState<string | null>(null);
  const [sheetFolderGroups, setSheetFolderGroups] = useState<Record<string, boolean>>({ Plans: true, "Supporting Documents": true });
  const [draggedSheetId, setDraggedSheetId] = useState<string | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);
  const [renameSheetId, setRenameSheetId] = useState<string | null>(null);
  const [renameSheetValue, setRenameSheetValue] = useState("");
  const [deleteSheetId, setDeleteSheetId] = useState<string | null>(null);
  const [previewDocId, setPreviewDocId] = useState<string | null>(urlDocIdRef.current);
  const [, navigate] = useLocation();
  const [pinModeActive, setPinModeActive] = useState(false);
  const [pinFilter, setPinFilter] = useState<PinFilter>({ type: "ALL", openOnly: false });
  const [previewPageNumber, setPreviewPageNumber] = useState(1);
  const [pendingPin, setPendingPin] = useState<{ x: number; y: number; pageNumber: number } | null>(null);
  const [pickerPosition, setPickerPosition] = useState<{ left: number; top: number } | null>(null);
  const [pinDialogOpen, setPinDialogOpen] = useState(false);
  const [pinDialogType, setPinDialogType] = useState<PinType | null>(null);
  const [markupTool, setMarkupTool] = useState<MarkupTool | null>(null);
  const [markupColor, setMarkupColor] = useState<string>("#ef4444");
  const [markupThickness, setMarkupThickness] = useState<number>(2);
  // Task #1705 / Task #1723 — Holds the latest undo / redo state that
  // <PlanMarkupLayer /> reports up via `onHistoryChange`. We forward
  // it to <UnifiedPlanToolbar /> so the Undo + Redo buttons next to
  // the markup tools fire the same handlers the Cmd/Ctrl+Z and
  // Cmd/Ctrl+Shift+Z shortcuts run, and the tooltips can spell out
  // exactly which action will be reversed (e.g. "Undo Move 5 markups").
  // Default value keeps both handlers null so the buttons render
  // disabled before the layer has reported any history.
  const [markupHistory, setMarkupHistory] = useState<MarkupHistoryState>({
    undo: null,
    redo: null,
    undoLabel: null,
    redoLabel: null,
  });
  const handleMarkupHistoryChange = useCallback(
    (state: MarkupHistoryState) => {
      setMarkupHistory(state);
    },
    [],
  );
  // Task #1723 — Stable wrapper callbacks so the Undo / Redo buttons
  // stay mounted at all times (driven by `canUndoLastMove` /
  // `canRedoLastMove` for enabled state). If we passed the raw
  // `markupHistory.undo` reference straight through, it would be
  // `undefined` whenever the stack is empty and the toolbar (which
  // conditionally mounts the button on the handler being defined)
  // would *unmount* the button — making it disappear and re-appear
  // mid-edit instead of merely toggling the disabled state. Reading
  // through a ref also keeps the callback identity stable across
  // re-renders so `<PlanMarkupToolbar />` doesn't see needless prop
  // churn while the user is dragging.
  const markupHistoryRef = useRef<MarkupHistoryState>(markupHistory);
  markupHistoryRef.current = markupHistory;
  const handleMarkupUndo = useCallback(() => {
    markupHistoryRef.current.undo?.();
  }, []);
  const handleMarkupRedo = useCallback(() => {
    markupHistoryRef.current.redo?.();
  }, []);
  // Task #1659 — hold-spacebar-to-pan from any tool (Figma / Bluebeam style).
  const [spacePanActive, setSpacePanActive] = useState(false);
  // Task #1662 — active layer + visibility set are owned here so the
  // panel and the canvas overlay stay in sync. Both are scoped to the
  // currently-open document; we reset them whenever that changes via
  // useEffect below.
  const [activeMarkupLayerId, setActiveMarkupLayerId] = useState<string | null>(null);
  const [hiddenMarkupLayerIds, setHiddenMarkupLayerIds] = useState<Set<string>>(new Set());
  // Task #1845 — Trash dialog open state. Anchored to the layer panel
  // so users can browse + bulk-restore older deletions when the
  // toolbar's one-click "Undo delete" banner is no longer available
  // (it auto-dismisses after a few seconds and only knows about the
  // most recent delete batch on the current sheet).
  const [trashOpenForDocId, setTrashOpenForDocId] = useState<string | null>(null);
  const [sheetJumpOpen, setSheetJumpOpen] = useState(false);
  const [carryoverOpen, setCarryoverOpen] = useState(false);
  const [carryoverContext, setCarryoverContext] = useState<{
    fromDocumentId: string;
    toDocumentId: string;
    fromLabel?: string;
    toLabel?: string;
  } | null>(null);
  // Task #1703 — layer-pick dialog launched from the per-document
  // "Download PDF (with markups) → By layer..." menu entry.
  const [layerPickerDoc, setLayerPickerDoc] = useState<{
    id: string;
    label: string;
  } | null>(null);
  useSheetJumpPaletteHotkey(setSheetJumpOpen);
  const isMobilePin = typeof window !== "undefined" && window.innerWidth < 640;

  const handlePinDrop = useCallback((info: { x: number; y: number; pageNumber: number }) => {
    setPendingPin(info);
    setPickerPosition({ left: info.x * 100, top: info.y * 100 });
  }, []);

  const handlePickerChoice = useCallback((type: PinType) => {
    setPinDialogType(type);
    setPickerPosition(null);
    setPinDialogOpen(true);
  }, []);

  const handleOpenPinSource = useCallback((pin: PlanPin) => {
    if (pin.refTable === "rfis") {
      navigate(`/projects/${projectCode}?tab=rfis&rfiId=${pin.refId}`);
    } else if (pin.refTable === "punch_list_items") {
      navigate(`/projects/${projectCode}?tab=punch-list&itemId=${pin.refId}`);
    } else if (pin.refTable === "submittals") {
      navigate(`/projects/${projectCode}?tab=submittals&submittalId=${pin.refId}`);
    }
  }, [navigate, projectCode]);
  const sheetStorageKey = project?.id ? `takeoff-sheet-${project.id}` : null;
  const [selectedSheetId, setSelectedSheetId] = useState<string | null>(() => {
    if (!sheetStorageKey) return null;
    try { return sessionStorage.getItem(sheetStorageKey); } catch { return null; }
  });
  const prevSheetStorageKeyRef = useRef<string | null>(sheetStorageKey);
  useEffect(() => {
    if (prevSheetStorageKeyRef.current !== sheetStorageKey) {
      prevSheetStorageKeyRef.current = sheetStorageKey;
      if (!sheetStorageKey) {
        setSelectedSheetId(null);
      } else {
        try { setSelectedSheetId(sessionStorage.getItem(sheetStorageKey)); }
        catch { setSelectedSheetId(null); }
      }
    }
  }, [sheetStorageKey]);
  useEffect(() => {
    if (!sheetStorageKey) return;
    try {
      if (selectedSheetId) sessionStorage.setItem(sheetStorageKey, selectedSheetId);
      else sessionStorage.removeItem(sheetStorageKey);
    } catch {}
  }, [selectedSheetId, sheetStorageKey]);
  // Task #1858 — Sidebar sheet-row clicks now go through the memoized
  // SheetRow's `onSelect` callback (`handleSelectSheet`, defined below
  // alongside the other stable row callbacks).
  const docIdIndex = useMemo(() => {
    const m = new Map<string, number>();
    documents.forEach((d: any, i: number) => m.set(d.id, i));
    return m;
  }, [documents]);
  const { getRowProps: getDocRowPropsRaw } = useTableKeyboardNav({
    rowCount: documents.length,
    onActivate: (idx) => {
      const d = documents[idx];
      if (d) {
        setSelectedDocId(d.id);
        setPreviewDocId(d.id);
      }
    },
  });
  const getDocRowProps = (docId: string) => {
    const idx = docIdIndex.get(docId);
    return idx === undefined ? {} : getDocRowPropsRaw(idx);
  };
  useRegisterShortcuts(
    "project-plans",
    TABLE_NAV_SHORTCUTS.filter((s) => s.keys !== "/"),
  );

  // Task #1659 — Hold-Space-to-pan from any tool (markup or pin) on the
  // PDF preview surface. Mirrors `useTakeoffInteractions` behavior:
  // skipped while typing, while a dialog/menu is open, and on key repeat.
  useEffect(() => {
    if (!previewDocId) return;
    const isEditableTarget = (t: EventTarget | null) => {
      if (!(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (t.isContentEditable) return true;
      return false;
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      if (e.repeat) return;
      if (isEditableTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Don't hijack space when a Radix dialog/sheet is currently open.
      // Radix keeps closed dialogs in the DOM with data-state="closed", so
      // we must scope the selector to data-state="open" rather than just
      // role="dialog" — otherwise stale portals would block panning.
      if (typeof document !== "undefined" &&
          document.querySelector(
            '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
          )) {
        return;
      }
      e.preventDefault();
      setSpacePanActive(true);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      setSpacePanActive(false);
    };
    const handleBlur = () => setSpacePanActive(false);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, [previewDocId]);

  const [panelWidth, setPanelWidth] = useState(256);
  const isResizingRef = useRef(false);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(256);

  const [renamingGroupName, setRenamingGroupName] = useState<string | null>(null);
  const [renameGroupValue, setRenameGroupValue] = useState("");
  const [deletingGroupName, setDeletingGroupName] = useState<string | null>(null);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [createFolderParent, setCreateFolderParent] = useState<string | null>(null);
  const [hiddenSheetIds, setHiddenSheetIds] = useState<Set<string>>(new Set());
  const uploadButtonRef = useRef<HTMLButtonElement>(null);
  const [draggedDocId, setDraggedDocId] = useState<string | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);
  const [subFolderDocs, setSubFolderDocs] = useState<Record<string, string[]>>({});
  const [bimDialogOpen, setBimDialogOpen] = useState(false);
  const [bimExtractionResult, setBimExtractionResult] = useState<BimExtractionResult | null>(null);
  const [bimIsExtracting, setBimIsExtracting] = useState(false);
  const [bimExtractionProgress, setBimExtractionProgress] = useState(0);
  const [libraryExpanded, setLibraryExpanded] = useState(false);
  const [splitViewMode, setSplitViewMode] = useState(false);
  const [splitBimDocId, setSplitBimDocId] = useState<string | null>(null);
  const [bimSelectedElements, setBimSelectedElements] = useState<BimSelectedElement[]>([]);
  const [highlightStoreyId, setHighlightStoreyId] = useState<number | null>(null);
  const [storeyAssocDialogOpen, setStoreyAssocDialogOpen] = useState(false);
  const [storeyAssocSheetId, setStoreyAssocSheetId] = useState<string | null>(null);
  const [storeyAssocStoreyId, setStoreyAssocStoreyId] = useState<string>("");
  const [storeyAssocStoreyName, setStoreyAssocStoreyName] = useState<string>("");
  const [activeDrawingSetId, setActiveDrawingSetId] = useState<string | null>(null);
  const [showAllSheets, setShowAllSheets] = useState(true);

  const { data: categories = [] } = useQuery<QuantityCategory[]>({
    queryKey: ["/api/projects", project?.id, "takeoff", "categories"],
    enabled: !!project?.id,
  });

  const { data: drawingSetsData = [] } = useQuery<DrawingSetInfo[]>({
    queryKey: ["/api/projects", project?.id, "drawing-sets"],
    enabled: !!project?.id,
  });

  // Task #1895 — Sheet uploads, renames, duplicates, and deletions can
  // change which active revisions exist for a project, which in turn
  // affects every drawing set's "out of date" badge (SetStaleBadge).
  // Invalidate the `/compare` query for every set in this project so the
  // badge stays in sync without requiring a window refocus or refresh.
  // Existing pin/unpin/swap flows already invalidate the active set's
  // compare via `invalidateDrawingSetCaches`; this helper covers the
  // sheet-side mutations that affect every set.
  const invalidateProjectSetCompares = useCallback(() => {
    if (!project?.id || drawingSetsData.length === 0) return;
    for (const set of drawingSetsData) {
      queryClient.invalidateQueries({
        queryKey: ["/api/projects", "drawing-sets", set.id, "compare"],
      });
    }
  }, [project?.id, drawingSetsData]);

  const primarySet = useMemo(() => drawingSetsData.find(s => s.isPrimary) || null, [drawingSetsData]);

  const effectiveSetId = activeDrawingSetId || primarySet?.id || null;

  const { data: activeSetItems = [] } = useQuery<DrawingSetItemInfo[]>({
    queryKey: ["/api/projects", "drawing-sets", effectiveSetId, "items"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/drawing-sets/${effectiveSetId}/items`);
      if (!res.ok) throw new Error("Failed to load items");
      return res.json();
    },
    enabled: !!effectiveSetId,
  });

  const { data: sheetStatus } = useQuery<SheetStatusData>({
    queryKey: ["/api/projects", "drawing-sets", effectiveSetId, "sheet-status"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/drawing-sets/${effectiveSetId}/sheet-status`);
      if (!res.ok) throw new Error("Failed to load sheet status");
      return res.json();
    },
    enabled: !!effectiveSetId,
  });

  const pinnedSheetIdSet = useMemo(() => new Set(sheetStatus?.pinnedSheetIds || []), [sheetStatus]);
  const newerSheetIdSet = useMemo(() => new Set(sheetStatus?.newerSheetIds || []), [sheetStatus]);

  const activeSetItemMap = useMemo(() => {
    const map = new Map<string, DrawingSetItemInfo>();
    for (const item of activeSetItems) {
      map.set(item.sheetId, item);
    }
    return map;
  }, [activeSetItems]);

  // Task #1858 — The previous `isSheetPinned`, `sheetHasNewerRevision`,
  // and `isSheetNotInCurrentSet` callbacks were inlined into the
  // SheetRow render loop below as direct Set lookups (with the pinned
  // names precomputed once via `pinnedSheetNames`), so the row receives
  // primitive booleans and React.memo can short-circuit re-renders.

  // Task #1661 — find the latest sheet ID we'd swap a pinned sheet to.
  // Returns null when the pinned revision is already the latest, or when
  // sheet-status hasn't loaded yet.
  const getLatestRevisionSheetId = useCallback((sheet: TakeoffSheet): string | null => {
    if (!effectiveSetId || !sheetStatus) return null;
    const latest = sheetStatus.pinnedToLatestMap?.[sheet.id];
    if (!latest || latest === sheet.id) return null;
    return latest;
  }, [effectiveSetId, sheetStatus]);

  const canManageDrawingSets = ["ADMIN", "MANAGER", "SUPER_ADMIN"].includes(user?.role || "");

  const displaySheets = useMemo(() => {
    if (!effectiveSetId || activeSetItemMap.size === 0) return sheets;
    if (!showAllSheets) {
      return sheets.filter(s => activeSetItemMap.has(s.id) || pinnedSheetIdSet.has(s.id));
    }
    const pinned: TakeoffSheet[] = [];
    const rest: TakeoffSheet[] = [];
    for (const s of sheets) {
      if (activeSetItemMap.has(s.id) || pinnedSheetIdSet.has(s.id)) {
        pinned.push(s);
      } else {
        rest.push(s);
      }
    }
    return [...pinned, ...rest];
  }, [sheets, effectiveSetId, activeSetItemMap, pinnedSheetIdSet, showAllSheets]);

  const isIfcFile = (fileName: string) => {
    return fileName?.toLowerCase().endsWith(".ifc");
  };

  const handleExtractBimQuantities = async (doc: any) => {
    setBimDialogOpen(true);
    setBimIsExtracting(true);
    setBimExtractionProgress(0);
    setBimExtractionResult(null);

    try {
      const fileUrl = `/api/projects/${projectCode}/documents/${doc.id}/stream`;

      const response = await fetch(fileUrl, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch IFC file");
      const arrayBuffer = await response.arrayBuffer();

      const { parseIfcFile } = await import("@/utils/ifc-quantity-parser");
      const result = await parseIfcFile(arrayBuffer, doc.fileName, (pct: number) => {
        setBimExtractionProgress(pct);
      });

      setBimExtractionResult(result);
    } catch (error: any) {
      console.error("BIM extraction error:", error);
      toast({
        title: "Extraction failed",
        description: error?.message || "Failed to parse IFC file",
        variant: "destructive",
      });
      setBimDialogOpen(false);
    } finally {
      setBimIsExtracting(false);
    }
  };

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    resizeStartXRef.current = e.clientX;
    resizeStartWidthRef.current = panelWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [panelWidth]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;
      const delta = e.clientX - resizeStartXRef.current;
      const newWidth = Math.min(480, Math.max(180, resizeStartWidthRef.current + delta));
      setPanelWidth(newWidth);
    };
    const onMouseUp = () => {
      if (!isResizingRef.current) return;
      isResizingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  const previewUrlData = previewDocId ? { url: `/api/projects/${projectCode}/documents/${previewDocId}/stream` } : undefined;
  const previewUrlLoading = false;

  const moveSheetMutation = useMutation({
    mutationFn: async ({ sheetId, folderGroup }: { sheetId: string; folderGroup: string }) => {
      const res = await apiRequest("PATCH", `/api/takeoff/sheets/${sheetId}/folder-group`, { folderGroup });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", project?.id, "takeoff", "sheets"] });
    },
  });

  const renameSheetMutation = useMutation({
    mutationFn: async ({ sheetId, sheetName }: { sheetId: string; sheetName: string }) => {
      const res = await apiRequest("PATCH", `/api/takeoff/sheets/${sheetId}/rename`, { sheetName });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", project?.id, "takeoff", "sheets"] });
      // Task #1895 — sheet_name change shifts which sheet a set's pinned
      // revision matches as the latest active, so refresh every set's badge.
      invalidateProjectSetCompares();
      setRenameSheetId(null);
      setRenameSheetValue("");
      toast({ title: "Sheet renamed" });
    },
  });

  const duplicateSheetMutation = useMutation({
    mutationFn: async (sheetId: string) => {
      const res = await apiRequest("POST", `/api/takeoff/sheets/${sheetId}/duplicate`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", project?.id, "takeoff", "sheets"] });
      // Task #1895 — duplicate creates a new active sheet that may match a
      // pinned sheet name, flipping a set from "Up to date" to "newer".
      invalidateProjectSetCompares();
      toast({ title: "Sheet duplicated" });
    },
  });

  const deleteSheetMutation = useMutation({
    mutationFn: async (sheetId: string) => {
      await apiRequest("DELETE", `/api/takeoff/sheets/${sheetId}?confirm=true`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", project?.id, "takeoff", "sheets"] });
      // Task #1895 — deleting a sheet drops it from the project's active set,
      // potentially clearing or revealing a newer revision for any set.
      invalidateProjectSetCompares();
      setDeleteSheetId(null);
      toast({ title: "Sheet deleted" });
    },
  });

  // Task #1661 — invalidate every active-set-derived query after an inline
  // pin/unpin/swap so the Drawing Sets panel, sheet list badges, and
  // compare view all reflect the change without a full refresh.
  const invalidateDrawingSetCaches = useCallback((setId: string | null | undefined) => {
    if (!setId) return;
    queryClient.invalidateQueries({ queryKey: ["/api/projects", "drawing-sets", setId, "items"] });
    queryClient.invalidateQueries({ queryKey: ["/api/projects", "drawing-sets", setId, "sheet-status"] });
    queryClient.invalidateQueries({ queryKey: ["/api/projects", "drawing-sets", setId, "compare"] });
    if (project?.id) {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", project.id, "drawing-sets"] });
    }
  }, [project?.id]);

  // Task #1661 — pin a sheet to the active drawing set from the sheet list row.
  // We intentionally omit revisionId because the sheet row itself already
  // identifies the specific revision (each upload creates a new takeoff sheet).
  const pinSheetToActiveSetMutation = useMutation({
    mutationFn: async ({ setId, sheetId }: { setId: string; sheetId: string }) => {
      const res = await apiRequest("POST", `/api/projects/drawing-sets/${setId}/items`, { sheetId });
      return res.json();
    },
    onSuccess: (_data, vars) => {
      invalidateDrawingSetCaches(vars.setId);
      toast({ title: "Pinned to set" });
    },
    // Task #1812 — surface the backend's 409 (duplicate pin) as a friendly,
    // sheet- and set-named toast so users understand why the click didn't
    // appear to do anything. Other 4xx/5xx errors keep the generic message.
    onError: (err: unknown, vars) => {
      const sheetName = sheets.find(s => s.id === vars.sheetId)?.sheetName || null;
      const setName = drawingSetsData.find(s => s.id === vars.setId)?.name || null;
      toast({
        title: "Error",
        description: pinSheetErrorDescription(err, { sheetName, setName }),
        variant: "destructive",
      });
    },
  });

  const unpinSheetFromActiveSetMutation = useMutation({
    mutationFn: async ({ setId, itemId }: { setId: string; itemId: string }) => {
      await apiRequest("DELETE", `/api/projects/drawing-sets/${setId}/items/${itemId}`);
    },
    onSuccess: (_data, vars) => {
      invalidateDrawingSetCaches(vars.setId);
      toast({ title: "Removed from set" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to unpin sheet.", variant: "destructive" });
    },
  });

  // Task #1661 — swap the pinned revision in place: remove the old item
  // first then add the latest sheet so the unique (set, sheet) constraint
  // never trips. Both calls must succeed for the toast to fire.
  const swapPinnedRevisionMutation = useMutation({
    mutationFn: async ({ setId, oldItemId, newSheetId }: { setId: string; oldItemId: string; newSheetId: string }) => {
      await apiRequest("DELETE", `/api/projects/drawing-sets/${setId}/items/${oldItemId}`);
      const res = await apiRequest("POST", `/api/projects/drawing-sets/${setId}/items`, { sheetId: newSheetId });
      return res.json();
    },
    onSuccess: (_data, vars) => {
      invalidateDrawingSetCaches(vars.setId);
      toast({ title: "Pinned to latest revision" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to swap pinned revision.", variant: "destructive" });
    },
  });

  // Task #1858 — Stable callback identities for the memoized SheetRow.
  // Pulling `.mutate` out of the mutation objects (whose top-level
  // identity churns each render) gives us a stable handler reference;
  // the row's React.memo shallow compare can then short-circuit when
  // its primitive props haven't changed.
  const moveSheetMutate = moveSheetMutation.mutate;
  const renameSheetMutate = renameSheetMutation.mutate;
  const duplicateSheetMutate = duplicateSheetMutation.mutate;
  const pinSheetMutate = pinSheetToActiveSetMutation.mutate;
  const unpinSheetMutate = unpinSheetFromActiveSetMutation.mutate;
  const swapPinnedRevisionMutate = swapPinnedRevisionMutation.mutate;

  const handleSelectSheet = useCallback((sheetId: string) => {
    setPreviewDocId(null);
    setSelectedSheetId(sheetId);
  }, []);

  const handleSheetDragEnd = useCallback(() => {
    setDraggedSheetId(null);
  }, []);

  const handleRenameValueChange = useCallback((value: string) => {
    setRenameSheetValue(value);
  }, []);

  const handleRenameCommit = useCallback(
    (sheetId: string, value: string) => {
      renameSheetMutate({ sheetId, sheetName: value });
    },
    [renameSheetMutate],
  );

  const handleRenameCancel = useCallback(() => {
    setRenameSheetId(null);
  }, []);

  const handleRenameStart = useCallback((sheetId: string, currentName: string) => {
    setRenameSheetId(sheetId);
    setRenameSheetValue(currentName);
  }, []);

  const handlePinSheet = useCallback(
    (setId: string, sheetId: string) => {
      pinSheetMutate({ setId, sheetId });
    },
    [pinSheetMutate],
  );

  const handleUnpinSheet = useCallback(
    (setId: string, itemId: string) => {
      unpinSheetMutate({ setId, itemId });
    },
    [unpinSheetMutate],
  );

  const handleSwapRevision = useCallback(
    (setId: string, oldItemId: string, newSheetId: string) => {
      swapPinnedRevisionMutate({ setId, oldItemId, newSheetId });
    },
    [swapPinnedRevisionMutate],
  );

  const handleDuplicateSheet = useCallback(
    (sheetId: string) => {
      duplicateSheetMutate(sheetId);
    },
    [duplicateSheetMutate],
  );

  const handleMoveSheet = useCallback(
    (sheetId: string, folderGroup: string) => {
      moveSheetMutate({ sheetId, folderGroup });
    },
    [moveSheetMutate],
  );

  const handleDeleteSheetRequest = useCallback((sheetId: string) => {
    setDeleteSheetId(sheetId);
  }, []);

  const pinPending = pinSheetToActiveSetMutation.isPending;
  const unpinPending = unpinSheetFromActiveSetMutation.isPending;
  const swapPending = swapPinnedRevisionMutation.isPending;

  // Task #1858 — Build a stable per-sheet name lookup so isSheetNotInCurrentSet
  // (used by the SheetRow `isNotInSet` prop) doesn't trigger a different
  // computation on each render.
  const sheetNamesById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of sheets) {
      m.set(s.id, s.sheetName || "");
    }
    return m;
  }, [sheets]);

  const pinnedSheetNames = useMemo(() => {
    const names = new Set<string>();
    if (!effectiveSetId || pinnedSheetIdSet.size === 0) return names;
    pinnedSheetIdSet.forEach((sid) => {
      const name = sheetNamesById.get(sid);
      if (name) names.add(name);
    });
    return names;
  }, [effectiveSetId, pinnedSheetIdSet, sheetNamesById]);

  const activeSetName = useMemo(
    () => drawingSetsData.find((s) => s.id === effectiveSetId)?.name || "set",
    [drawingSetsData, effectiveSetId],
  );

  const groupedSheets = useMemo(() => {
    const result: Record<string, TakeoffSheet[]> = {};
    for (const name of SHEET_FOLDER_NAMES) {
      result[name] = [];
    }
    for (const sheet of displaySheets) {
      const group = (sheet as any).folderGroup || "Plans";
      if (!result[group]) result[group] = [];
      result[group].push(sheet);
    }
    return result;
  }, [displaySheets]);

  const handleSheetDragStart = useCallback((e: any, sheetId: string) => {
    setDraggedSheetId(sheetId);
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const handleSheetDragOver = useCallback((e: any, groupName: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverGroup(groupName);
  }, []);

  const handleSheetDrop = useCallback((e: any, groupName: string) => {
    e.preventDefault();
    setDragOverGroup(null);
    if (draggedSheetId) {
      moveSheetMutation.mutate({ sheetId: draggedSheetId, folderGroup: groupName });
      setDraggedSheetId(null);
    }
  }, [draggedSheetId, moveSheetMutation]);

  const toggleSheetGroup = useCallback((name: string) => {
    setSheetFolderGroups(prev => ({ ...prev, [name]: !prev[name] }));
  }, []);

  const groupedDocuments = useMemo(() => {
    const filtered = searchQuery
      ? documents.filter((d: any) =>
          (d.title || d.fileName || "").toLowerCase().includes(searchQuery.toLowerCase())
        )
      : documents;

    const allSubFolderDocIds = new Set(Object.values(subFolderDocs).flat());

    return groups
      .filter((group) => bimEnabled || group.name !== "BIM Models")
      .map((group) => ({
        ...group,
        docs: filtered.filter((d: any) => group.types.includes(d.type) && !allSubFolderDocIds.has(d.id)),
      }));
  }, [documents, searchQuery, groups, subFolderDocs, bimEnabled]);

  const toggleGroup = (name: string) => {
    setGroups((prev) =>
      prev.map((g) => (g.name === name ? { ...g, expanded: !g.expanded } : g))
    );
  };

  const subFolderKey = (parentName: string, childName: string) => `${parentName}/${childName}`;

  const handleDocDragStart = useCallback((e: React.DragEvent, docId: string) => {
    setDraggedDocId(docId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", docId);
  }, []);

  const handleDocDragEnd = useCallback(() => {
    setDraggedDocId(null);
    setDragOverTarget(null);
  }, []);

  const handleSubfolderDrop = useCallback((e: React.DragEvent, parentName: string, childName: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverTarget(null);
    if (!draggedDocId) return;

    const key = `${parentName}/${childName}`;
    setSubFolderDocs((prev) => {
      const existing = prev[key] || [];
      if (existing.includes(draggedDocId)) return prev;
      const cleaned = Object.fromEntries(
        Object.entries(prev).map(([k, ids]) => [k, ids.filter((id) => id !== draggedDocId)])
      );
      return { ...cleaned, [key]: [...existing, draggedDocId] };
    });
    setDraggedDocId(null);
  }, [draggedDocId]);

  const handleParentFolderDrop = useCallback((e: React.DragEvent, groupName: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverTarget(null);
    if (!draggedDocId) return;

    setSubFolderDocs((prev) => {
      return Object.fromEntries(
        Object.entries(prev).map(([k, ids]) => [k, ids.filter((id) => id !== draggedDocId)])
      );
    });
    setDraggedDocId(null);
  }, [draggedDocId]);

  const handleRenameGroupStart = (name: string) => {
    setRenameGroupValue(name);
    setRenamingGroupName(name);
  };

  const handleRenameGroupSubmit = (oldName: string) => {
    const trimmed = renameGroupValue.trim();
    if (trimmed && trimmed !== oldName) {
      setGroups((prev) => prev.map((g) => g.name === oldName ? { ...g, name: trimmed } : g));
    }
    setRenamingGroupName(null);
  };

  const handleDeleteGroupConfirm = () => {
    if (!deletingGroupName) return;
    setGroups((prev) => prev.filter((g) => g.name !== deletingGroupName));
    setDeletingGroupName(null);
    toast({ description: `Folder "${deletingGroupName}" removed.` });
  };

  const handleCreateFolderSubmit = () => {
    const trimmed = newFolderName.trim();
    if (!trimmed) return;
    const newChild: DocGroup = { name: trimmed, expanded: true, types: [], parentName: createFolderParent || undefined };
    if (createFolderParent) {
      setGroups((prev) =>
        prev.map((g) =>
          g.name === createFolderParent
            ? { ...g, expanded: true, children: [...(g.children || []), newChild] }
            : g
        )
      );
    } else {
      setGroups((prev) => [...prev, { name: trimmed, expanded: true, types: ["OTHER"] }]);
    }
    setCreateFolderOpen(false);
    setNewFolderName("");
    setCreateFolderParent(null);
    toast({ description: `Folder "${trimmed}" created.` });
  };

  const handlePrintAllSheets = async (docs: any[]) => {
    const pdfs = docs.filter((d: any) => (d.fileName || "").toLowerCase().endsWith(".pdf"));
    if (pdfs.length === 0) {
      toast({ description: "No PDF documents found in this folder." });
      return;
    }
    toast({ description: `Opening ${pdfs.length} PDF(s) for printing…` });
    for (const doc of pdfs) {
      await handleOpenFile(doc.id, doc.fileUrl);
    }
  };

  const handleAutonameSheets = (folderName: string) => {
    const folderSheets = groupedSheets[folderName] || [];
    if (folderSheets.length === 0) {
      toast({ description: "No takeoff sheets in this folder to rename." });
      return;
    }
    folderSheets.forEach((sheet, i) => {
      renameSheetMutation.mutate({ sheetId: sheet.id, sheetName: `Sheet ${i + 1}` });
    });
    toast({ description: `Auto-named ${folderSheets.length} sheet(s).` });
  };

  const handleHideAllSheets = (folderName: string) => {
    const folderSheets = groupedSheets[folderName] || [];
    if (folderSheets.length === 0) {
      toast({ description: "No takeoff sheets to hide in this folder." });
      return;
    }
    setHiddenSheetIds((prev) => {
      const next = new Set(prev);
      folderSheets.forEach((s) => next.add(s.id));
      return next;
    });
    toast({ description: `${folderSheets.length} sheet(s) hidden.` });
  };

  const handleUnhideAllSheets = (folderName: string) => {
    const folderSheets = groupedSheets[folderName] || [];
    setHiddenSheetIds((prev) => {
      const next = new Set(prev);
      folderSheets.forEach((s) => next.delete(s.id));
      return next;
    });
    toast({ description: "All sheets in this folder are now visible." });
  };

  const handleUploadForType = (type: string) => {
    setDocumentType(type);
    setTimeout(() => uploadButtonRef.current?.click(), 80);
  };

  const selectedDoc = documents.find((d: any) => d.id === selectedDocId);

  const handleOpenFile = async (docId: string, _fallbackUrl: string) => {
    window.open(`/api/projects/${projectCode}/documents/${docId}/stream`, "_blank");
  };

  const handleObjectUploadComplete = async (result: any) => {
    if (!result.successful?.length) {
      toast({ title: "Error", description: "No file uploaded", variant: "destructive" });
      return;
    }
    const isSingle = result.successful.length === 1;

    // Task #1610 — snapshot the current PDF documents *before* the new uploads
    // are persisted so we can detect a revision-supersedes-prior-document
    // relationship and auto-prompt the user to carry pins/markups forward.
    const existingPdfDocs = documents.filter((d: any) =>
      d.mimeType?.includes("pdf") || d.fileName?.toLowerCase?.().endsWith(".pdf"),
    );

    let firstSupersedeContext: {
      fromDocumentId: string;
      toDocumentId: string;
      fromLabel?: string;
      toLabel?: string;
    } | null = null;
    let savedCount = 0;
    let failedCount = 0;

    await Promise.all(result.successful.map(async (uploaded: any) => {
      const file = uploaded.data as File;
      const fileUrl = uploaded.uploadURL?.split("?")[0] || "";
      const baseName = file.name.replace(/\.[^/.]+$/, "");
      const title = isSingle && documentTitle.trim() ? documentTitle.trim() : baseName;
      try {
        const res = await apiRequest("POST", "/api/documents", {
          projectId: project?.id,
          title,
          type: documentType,
          fileUrl,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type,
          objectKey: fileUrl,
        });
        const newDoc = await res.json().catch(() => null);
        if (!newDoc || typeof newDoc.id !== "string") {
          // The save succeeded HTTP-wise but the response was malformed —
          // treat as a failure for outcome reporting so the user sees an
          // accurate toast rather than a silent "uploaded" message.
          failedCount++;
          return;
        }
        savedCount++;

        // Task #1610 — if the new upload looks like a revision of an existing
        // PDF (same normalized title or filename), capture the best candidate
        // so we can prompt the user to carry annotations forward. The prompt
        // itself is opened *after* all uploads finish, and only for the first
        // detected supersede so a multi-file upload doesn't bury the user
        // under back-to-back dialogs. Restricted to PLANS uploads because
        // pins/markups are a plan-sheet concept; specs and supporting PDFs
        // can still use the manual "Carry over annotations…" menu.
        const isPdf =
          file.type?.includes("pdf") || file.name.toLowerCase().endsWith(".pdf");
        const isPlansUpload = documentType === "PLANS";
        if (isPdf && isPlansUpload && !firstSupersedeContext) {
          const supersededDoc = findSupersededPdfDoc(
            { title, fileName: file.name },
            existingPdfDocs,
          );
          if (supersededDoc) {
            firstSupersedeContext = {
              fromDocumentId: supersededDoc.id,
              toDocumentId: newDoc.id,
              fromLabel: supersededDoc.title || supersededDoc.fileName,
              toLabel: title || file.name,
            };
          }
        }
      } catch {
        failedCount++;
      }
    }));

    // Always invalidate the documents list — even on partial failure some
    // rows may have been created and the list needs to reflect that.
    queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "documents"] });

    // Task #1895 — uploads can introduce new sheet revisions for the project
    // (either directly via background processing or imminently via the
    // import-plan flow / supersede prompt). Invalidate the takeoff sheets
    // list and every drawing set's compare query so the SetStaleBadge stays
    // accurate without waiting for window refocus or a manual refresh.
    if (savedCount > 0) {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", project?.id, "takeoff", "sheets"] });
      invalidateProjectSetCompares();
    }

    // Surface the actual outcome. Only clear the in-progress title when at
    // least one document was saved, so a single-file failure leaves the
    // user's typed title intact for retry.
    if (savedCount > 0) {
      setDocumentTitle("");
    }
    const outcome = uploadOutcomeToast(savedCount, failedCount);
    if (outcome) {
      toast(outcome);
    }

    // Task #1610 — auto-prompt happens last so the success toast appears first
    // and the dialog is the user's next action. Skipping never blocks the
    // upload (the document is already saved at this point) and choosing
    // "Carry over" calls the same idempotent endpoint as the manual menu.
    if (firstSupersedeContext && !carryoverOpen) {
      setCarryoverContext(firstSupersedeContext);
      setCarryoverOpen(true);
    }
  };

  const handleDeleteDocument = async (docId: string) => {
    try {
      await apiRequest("DELETE", `/api/documents/${docId}`);
      toast({ title: "Success", description: "Document deleted" });
      await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "documents"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/projects", project?.id, "takeoff", "sheets"] });
      // Task #1895 — document deletion cascades to its takeoff sheets,
      // changing the project's active-revision set and every drawing set's
      // staleness signal. Refresh all set compares so SetStaleBadge updates.
      invalidateProjectSetCompares();
      if (selectedDocId === docId) setSelectedDocId(null);
      if (previewDocId === docId) setPreviewDocId(null);
    } catch (error: any) {
      toast({ title: "Error", description: error?.message || "Failed to delete document", variant: "destructive" });
    }
    setDeleteDocId(null);
  };

  const handleImportToTakeoff = async (docId: string) => {
    try {
      await apiRequest("POST", `/api/projects/${project!.id}/takeoff/import-plan`, { documentId: docId });
      toast({ title: "Success", description: "Plan imported to takeoff workspace" });
      await queryClient.invalidateQueries({ queryKey: ["/api/projects", project!.id, "takeoff", "sheets"] });
      // Task #1895 — importing a plan creates new active takeoff_sheets that
      // may match pinned sheet names in any drawing set, so refresh every
      // set's compare query to keep the badge accurate.
      invalidateProjectSetCompares();
    } catch (error: any) {
      toast({ title: "Error", description: error?.message || "Failed to import plan", variant: "destructive" });
    }
  };

  const importToEstimateMutation = useMutation({
    mutationFn: async () => {
      const estRes = await apiRequest("GET", `/api/projects/${project!.id}/estimate`);
      if (!estRes.ok) throw new Error("No estimate found. Create an estimate first.");
      const estData = await estRes.json();
      const estimateId = estData?.estimate?.id;
      if (!estimateId) throw new Error("No estimate found. Create an estimate first.");

      const catRes = await fetch(`/api/projects/${project!.id}/takeoff/categories`, { credentials: "include" });
      const cats: { id: string; name: string }[] = catRes.ok ? await catRes.json() : [];
      const categoryIds = cats.map((c) => c.id);

      const res = await apiRequest("POST", `/api/projects/${project!.id}/estimate/import-takeoff`, { estimateId, categoryIds });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Import failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", project!.id, "estimate"] });
      toast({ title: "Import complete", description: `${data.count} line item(s) added to your estimate` });
    },
    onError: (error: any) => {
      toast({ title: "Import failed", description: error.message, variant: "destructive" });
    },
  });

  const { data: storeyAssociations = [] } = useQuery<any[]>({
    queryKey: ["/api/projects", project?.id, "bim", "storey-associations"],
    enabled: !!project?.id,
  });

  const saveStoreyAssocMutation = useMutation({
    mutationFn: async (data: { sheetId: string; bimDocumentId: string; storeyExpressId: number; storeyName: string }) => {
      const res = await apiRequest("POST", `/api/projects/${project!.id}/bim/storey-associations`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", project!.id, "bim", "storey-associations"] });
      setStoreyAssocDialogOpen(false);
      toast({ title: "Sheet linked to storey" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to link sheet to storey", variant: "destructive" });
    },
  });

  const bimDocuments = useMemo(() =>
    documents.filter((d: any) => d.type === "BIM" || d.fileName?.toLowerCase().endsWith(".ifc")),
    [documents]
  );

  const splitBimDoc = splitBimDocId ? documents.find((d: any) => d.id === splitBimDocId) : bimDocuments[0] || null;

  const splitBimUrl = splitBimDoc ? { url: `/api/projects/${projectCode}/documents/${splitBimDoc.id}/stream` } : undefined;

  const handleBimElementSelect = useCallback((elements: BimSelectedElement[]) => {
    setBimSelectedElements(elements);
    if (elements.length > 0 && elements[0].storeyExpressId) {
      const assoc = storeyAssociations.find(
        (a: any) => a.storeyExpressId === elements[0].storeyExpressId
      );
      if (assoc) {
        setHighlightStoreyId(elements[0].storeyExpressId);
      }
    }
  }, [storeyAssociations]);

  const handleBimAddToTakeoff = useCallback(async (elements: BimElementSummary[]) => {
    if (!project?.id || elements.length === 0) return;
    const targetSheet = sheets[0];
    if (!targetSheet) {
      toast({ title: "No takeoff sheet", description: "Create a takeoff sheet before adding BIM elements.", variant: "destructive" });
      return;
    }
    let added = 0;
    for (const el of elements) {
      const label = `${el.type}: ${el.name}`;
      const dims = el.dimensions || {};
      try {
        const body: any = {
          type: "COUNT",
          label,
          points: [{ x: 0, y: 0 }],
          sheetId: targetSheet.id,
          metadata: JSON.stringify({
            bimExpressId: el.expressID,
            bimType: el.type,
            bimMaterial: el.material,
            bimDimensions: dims,
          }),
        };
        await apiRequest("POST", "/api/takeoff/measurements", body);
        added++;
      } catch {
        toast({ title: "Error", description: `Failed to add ${el.name} to takeoff`, variant: "destructive" });
      }
    }
    queryClient.invalidateQueries({ queryKey: ["/api/projects", project?.id, "takeoff", "sheets"] });
    if (added > 0) {
      toast({ title: "Added to takeoff", description: `${added} element(s) added as measurements` });
    }
  }, [project?.id, sheets, toast]);

  return (
      <div className="flex flex-col h-[calc(100vh-200px)] mb-[50px]">
      <div className="border-b flex items-center gap-1 px-2 py-1 bg-card shrink-0">
        <Button
          variant={subTab === "plans" ? "default" : "ghost"}
          size="sm"
          onClick={() => setSubTab("plans")}
          data-testid="tab-plans"
        >
          Plans
        </Button>
        <Button
          variant={subTab === "addenda" ? "default" : "ghost"}
          size="sm"
          onClick={() => setSubTab("addenda")}
          data-testid="tab-addenda"
        >
          Addenda
        </Button>
        <Button
          variant={subTab === "libraries" ? "default" : "ghost"}
          size="sm"
          onClick={() => setSubTab("libraries")}
          data-testid="tab-libraries"
        >
          Libraries
        </Button>
        <Button
          variant={subTab === "drawing-sets" ? "default" : "ghost"}
          size="sm"
          onClick={() => setSubTab("drawing-sets")}
          data-testid="tab-drawing-sets"
        >
          Drawing Sets
        </Button>
        <Button
          variant={subTab === "reports" ? "default" : "ghost"}
          size="sm"
          onClick={() => setSubTab("reports")}
          data-testid="tab-reports"
        >
          Reports
        </Button>
      </div>

      {subTab === "drawing-sets" && project && (
        <div className="flex-1 overflow-auto p-4">
          <DrawingSetsPanel
            projectId={project.id}
            sheets={sheets}
            userRole={user?.role || ""}
            onSetActive={setActiveDrawingSetId}
            activeSetId={activeDrawingSetId}
          />
        </div>
      )}

      {subTab === "addenda" && project && (
        <div className="flex-1 overflow-auto p-4">
          <ProjectAddenda
            projectId={project.id}
            projectCode={project.code}
            userRole={user?.role || ""}
          />
        </div>
      )}

      {subTab === "libraries" && project && (
        <div className="flex-1 min-h-0">
          <LibraryPanel projectId={project.id} />
        </div>
      )}

      {subTab === "reports" && project && (
        <div className="flex-1 min-h-0 overflow-auto">
          <ReportsPage embeddedProjectId={String(project.id)} />
        </div>
      )}

      {subTab === "plans" && project && (
        <div className="flex flex-1 min-h-0 relative">
          {!leftPanelCollapsed && (
            <div
              className="absolute inset-0 z-20 md:relative md:inset-auto md:h-full w-full bg-card border-r flex flex-col shrink-0"
              style={{ width: panelWidth }}
            >
              <div className="p-2 border-b space-y-2">
                <div className="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 shrink-0 md:hidden"
                    onClick={() => setLeftPanelCollapsed(true)}
                    data-testid="button-close-panel-mobile"
                  >
                    <ChevronDown className="w-4 h-4 rotate-90" />
                  </Button>
                  <div className="relative flex-1">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Search..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="h-8 pl-7 text-sm"
                      data-testid="input-search-documents"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex gap-1">
                    <Input
                      value={documentTitle}
                      onChange={(e) => setDocumentTitle(e.target.value)}
                      placeholder="Title (optional)"
                      className="h-7 text-xs flex-1"
                      data-testid="input-doc-title"
                    />
                    <Select value={documentType} onValueChange={setDocumentType}>
                      <SelectTrigger className="h-7 w-24 text-xs" data-testid="select-doc-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PLANS">Plans</SelectItem>
                        <SelectItem value="SPECS">Specs</SelectItem>
                        <SelectItem value="TAKEOFF">Takeoff</SelectItem>
                        {bimEnabled && <SelectItem value="BIM">BIM</SelectItem>}
                        <SelectItem value="OTHER">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <ObjectUploader
                    key={documentType}
                    maxNumberOfFiles={20}
                    maxFileSize={documentType === "BIM" ? 209715200 : 104857600}
                    allowedFileTypes={documentType === "PLANS" ? [".pdf"] : documentType === "BIM" ? [".ifc"] : [".pdf", ".dwg", ".dxf", ".png", ".jpg", ".jpeg", ".xlsx", ".xls", ".csv", ".doc", ".docx"]}
                    fileType={documentType === "BIM" ? "BIM" : "DOCUMENT"}
                    onComplete={handleObjectUploadComplete}
                    testId="button-upload-document"
                  >
                    <Button ref={uploadButtonRef} variant="default" size="sm" className="w-full h-7 text-xs" data-testid="button-upload-document">
                      <Upload className="w-3 h-3 mr-1" />
                      Upload
                    </Button>
                  </ObjectUploader>
                  {documentType === "PLANS" && (
                    <>
                      <p className="text-[10px] text-muted-foreground" data-testid="hint-pdf-only">PDF files only for Plans</p>
                      <p className="text-[10px] text-amber-600 dark:text-amber-400" data-testid="hint-pdf-single-sheet">Note: Multi-page PDF splitting is coming soon. Each upload currently creates one sheet.</p>
                    </>
                  )}
                  {documentType === "BIM" && (
                    <p className="text-[10px] text-muted-foreground" data-testid="hint-ifc-only">IFC files only for BIM models</p>
                  )}
                </div>
              </div>

              <ScrollArea className="flex-1">
                <div className="py-1">
                  <div className="px-2 py-1.5">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Documents ({documents.length})
                    </span>
                  </div>

                  {documentsLoading ? (
                    <div className="px-3 py-4 text-sm text-muted-foreground text-center">Loading...</div>
                  ) : (
                    <TooltipProvider delayDuration={200}>{groupedDocuments.map((group) => (
                      <div key={group.name}>
                        <div
                          className={cn(
                            "flex items-center gap-1.5 w-full px-2 py-1.5 text-sm hover:bg-accent/50 transition-colors cursor-pointer group/folder",
                            dragOverTarget === `parent:${group.name}` && draggedDocId !== null && "bg-blue-500/20 ring-1 ring-blue-500/50 rounded"
                          )}
                          onClick={() => { if (renamingGroupName !== group.name) toggleGroup(group.name); }}
                          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverTarget(`parent:${group.name}`); }}
                          onDragLeave={() => setDragOverTarget(null)}
                          onDrop={(e) => { setDragOverTarget(null); handleParentFolderDrop(e, group.name); }}
                          data-testid={`folder-${group.name.toLowerCase().replace(/\s+/g, '-')}`}
                        >
                          {group.expanded ? (
                            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          )}
                          {group.expanded ? (
                            <FolderOpen className="w-4 h-4 text-yellow-500 shrink-0" />
                          ) : (
                            <Folder className="w-4 h-4 text-yellow-500 shrink-0" />
                          )}
                          {renamingGroupName === group.name ? (
                            <Input
                              autoFocus
                              value={renameGroupValue}
                              className="h-5 text-xs px-1 py-0 flex-1"
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => setRenameGroupValue(e.target.value)}
                              onBlur={() => handleRenameGroupSubmit(group.name)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleRenameGroupSubmit(group.name);
                                if (e.key === "Escape") setRenamingGroupName(null);
                              }}
                              data-testid={`input-rename-folder-${group.name}`}
                            />
                          ) : (
                            <span className="truncate font-medium flex-1">{group.name}</span>
                          )}
                          <Badge variant="secondary" className="text-[10px] h-4 px-1 shrink-0">
                            {group.docs.length}
                          </Badge>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-5 w-5 opacity-0 group-hover/folder:opacity-100 shrink-0 ml-0.5"
                                onClick={(e) => e.stopPropagation()}
                                data-testid={`menu-folder-${group.name.toLowerCase().replace(/\s+/g, '-')}`}
                              >
                                <MoreVertical className="w-3 h-3" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="w-56">
                              <DropdownMenuItem
                                onClick={(e) => { e.stopPropagation(); setNewFolderName(""); setCreateFolderParent(group.name); setCreateFolderOpen(true); }}
                                data-testid="menu-item-create-folder"
                              >
                                <FolderPlus className="w-4 h-4 mr-2" />
                                Create Folder
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={(e) => { e.stopPropagation(); handleRenameGroupStart(group.name); }}
                                data-testid="menu-item-rename-folder"
                              >
                                <Pencil className="w-4 h-4 mr-2" />
                                Rename Folder
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={(e) => { e.stopPropagation(); setDeletingGroupName(group.name); }}
                                className="text-destructive focus:text-destructive"
                                data-testid="menu-item-delete-folder"
                              >
                                <Trash2 className="w-4 h-4 mr-2" />
                                Delete Folder
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={(e) => { e.stopPropagation(); handleAutonameSheets(group.name); }}
                                data-testid="menu-item-autoname-sheets"
                              >
                                <RefreshCw className="w-4 h-4 mr-2" />
                                Autoname Sheets
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={(e) => { e.stopPropagation(); handlePrintAllSheets(group.docs); }}
                                data-testid="menu-item-print-all-sheets"
                              >
                                <Printer className="w-4 h-4 mr-2" />
                                Print All Sheets
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={(e) => { e.stopPropagation(); toast({ description: "Rotating blank sheets right — feature coming soon." }); }}
                                data-testid="menu-item-rotate-sheets"
                              >
                                <RotateCw className="w-4 h-4 mr-2" />
                                Rotate All Blank Sheets Right
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={(e) => { e.stopPropagation(); handleHideAllSheets(group.name); }}
                                data-testid="menu-item-hide-sheets"
                              >
                                <EyeOff className="w-4 h-4 mr-2" />
                                Hide All Sheets
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={(e) => { e.stopPropagation(); handleUnhideAllSheets(group.name); }}
                                data-testid="menu-item-unhide-sheets"
                              >
                                <Eye className="w-4 h-4 mr-2" />
                                Unhide All Sheets
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={(e) => { e.stopPropagation(); handleUploadForType("PLANS"); }}
                                data-testid="menu-item-upload-plans"
                              >
                                <Upload className="w-4 h-4 mr-2" />
                                Upload Plans
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={(e) => { e.stopPropagation(); handleUploadForType("OTHER"); }}
                                data-testid="menu-item-upload-supporting"
                              >
                                <Upload className="w-4 h-4 mr-2" />
                                Upload Supporting Documents
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                        {group.expanded && (
                          <div className="ml-2">
                            {group.docs.length === 0 ? (
                              <div className="px-6 py-1 text-xs text-muted-foreground italic">No files</div>
                            ) : (
                              group.docs.map((doc: any) => {
                                const isPdfDoc = (doc.mimeType || "").toLowerCase().includes("pdf") || (doc.fileName || "").toLowerCase().endsWith(".pdf");
                                return (
                                <div
                                  key={doc.id}
                                  draggable
                                  onDragStart={(e) => handleDocDragStart(e, doc.id)}
                                  onDragEnd={handleDocDragEnd}
                                  className={cn(
                                    "flex items-start gap-1.5 px-3 py-1.5 text-sm cursor-pointer hover:bg-accent/50 transition-colors group data-[focused=true]:ring-2 data-[focused=true]:ring-primary data-[focused=true]:ring-inset",
                                    selectedDocId === doc.id && "bg-accent",
                                    draggedDocId === doc.id && "opacity-50",
                                    isPdfDoc && "data-[pin-drop-active=true]:ring-2 data-[pin-drop-active=true]:ring-primary data-[pin-drop-active=true]:bg-primary/10"
                                  )}
                                  onClick={() => { setSelectedDocId(doc.id); setPreviewDocId(doc.id); }}
                                  data-testid={`document-${doc.id}`}
                                  {...(isPdfDoc ? { "data-pin-drop-target": "", "data-pin-drop-doc": doc.id } : {})}
                                  {...getDocRowProps(doc.id)}
                                >
                                  <GripVertical className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-50 shrink-0 cursor-grab mt-0.5" />
                                  {doc.type === "BIM" || doc.fileName?.toLowerCase().endsWith(".ifc") ? (
                                    <Box className="w-3.5 h-3.5 text-blue-500 shrink-0 mt-0.5" />
                                  ) : (
                                    <File className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                                  )}
                                  <span className="break-words flex-1 min-w-0 text-sm leading-snug">{doc.title || doc.fileName}</span>
                                  {(() => {
                                    const counts = planPinSummary[doc.id];
                                    if (!counts || counts.total + counts.closedTotal === 0) return null;
                                    const displayCount = pinCountMode === "all" ? counts.total + counts.closedTotal : counts.total;
                                    const noOpen = counts.total === 0;
                                    return (
                                    <HoverCard openDelay={150} closeDelay={100}>
                                      <HoverCardTrigger asChild>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setSelectedDocId(doc.id);
                                            setPreviewDocId(doc.id);
                                            setPinModeActive(true);
                                            setPinFilter({ type: "ALL", openOnly: pinCountMode === "open" });
                                          }}
                                          className="shrink-0 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                          title={pinCountMode === "all" ? "Open plan with pin layer (showing total)" : "Open plan with pin layer (open pins)"}
                                          data-testid={`badge-plan-pins-${doc.id}`}
                                        >
                                          <Badge
                                            variant="secondary"
                                            className={
                                              "text-[10px] h-4 px-1 cursor-pointer " +
                                              (pinCountMode === "all" && noOpen
                                                ? "bg-slate-200 text-slate-700 dark:bg-slate-700/60 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-700"
                                                : "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200 hover:bg-blue-200 dark:hover:bg-blue-900/60")
                                            }
                                          >
                                            {displayCount}
                                          </Badge>
                                        </button>
                                      </HoverCardTrigger>
                                      <HoverCardContent side="left" className="w-56 p-2 text-xs" data-testid={`hovercard-plan-pins-${doc.id}`}>
                                        <div className="flex items-center justify-between mb-1.5">
                                          <div className="font-medium">Pin counts</div>
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setPinCountMode((m) => (m === "open" ? "all" : "open"));
                                            }}
                                            className="text-[10px] px-1.5 py-0.5 rounded border hover:bg-accent"
                                            data-testid="button-toggle-pin-count-mode"
                                          >
                                            {pinCountMode === "open" ? "Show total" : "Open only"}
                                          </button>
                                        </div>
                                        <div className="grid grid-cols-[1fr_auto_auto] gap-x-2 gap-y-0.5 items-center">
                                          <span className="text-muted-foreground"></span>
                                          <span className="text-[10px] text-muted-foreground text-right">Open</span>
                                          <span className="text-[10px] text-muted-foreground text-right">Closed</span>
                                          {(["RFI", "PUNCH", "SUBMITTAL"] as const).map((t) => {
                                            const open = t === "RFI" ? counts.rfi : t === "PUNCH" ? counts.punch : counts.submittal;
                                            const closed = t === "RFI" ? counts.closedRfi : t === "PUNCH" ? counts.closedPunch : counts.closedSubmittal;
                                            const label = t === "RFI" ? "RFI" : t === "PUNCH" ? "Punch" : "Submittal";
                                            return (
                                              <div key={t} className="contents">
                                                <button
                                                  type="button"
                                                  disabled={open + closed === 0}
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    setSelectedDocId(doc.id);
                                                    setPreviewDocId(doc.id);
                                                    setPinModeActive(true);
                                                    setPinFilter({ type: t, openOnly: pinCountMode === "open" });
                                                  }}
                                                  className="text-left px-1 py-0.5 rounded hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
                                                  data-testid={`button-plan-pins-filter-${t.toLowerCase()}-${doc.id}`}
                                                >
                                                  {label}
                                                </button>
                                                <span className="font-medium tabular-nums text-right">{open}</span>
                                                <span className="tabular-nums text-right text-muted-foreground">{closed}</span>
                                              </div>
                                            );
                                          })}
                                          <div className="col-span-3 border-t my-0.5" />
                                          <span className="font-medium">Total</span>
                                          <span className="font-medium tabular-nums text-right">{counts.total}</span>
                                          <span className="tabular-nums text-right text-muted-foreground">{counts.closedTotal}</span>
                                        </div>
                                      </HoverCardContent>
                                    </HoverCard>
                                    );
                                  })()}
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-5 w-5 opacity-0 group-hover:opacity-100 shrink-0"
                                        onClick={(e) => e.stopPropagation()}
                                        data-testid={`menu-document-${doc.id}`}
                                      >
                                        <MoreVertical className="w-3 h-3" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuItem
                                        onClick={() => handleOpenFile(doc.id, doc.fileUrl)}
                                        data-testid={`button-view-document-${doc.id}`}
                                      >
                                        <Eye className="w-4 h-4 mr-2" />
                                        View
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        onClick={() => {
                                          const link = document.createElement('a');
                                          link.href = doc.fileUrl;
                                          link.download = doc.fileName;
                                          document.body.appendChild(link);
                                          link.click();
                                          document.body.removeChild(link);
                                        }}
                                        data-testid={`button-download-document-${doc.id}`}
                                      >
                                        <Download className="w-4 h-4 mr-2" />
                                        Download
                                      </DropdownMenuItem>
                                      {(doc.mimeType?.includes("pdf") || doc.fileName?.toLowerCase().endsWith(".pdf")) && (
                                        <DropdownMenuSub>
                                          <DropdownMenuSubTrigger data-testid={`button-download-with-markups-${doc.id}`}>
                                            <Download className="w-4 h-4 mr-2" />
                                            Download PDF (with markups)
                                          </DropdownMenuSubTrigger>
                                          <DropdownMenuSubContent>
                                            {[
                                              { label: "Markups + Pins", q: "includeMarkups=true&includePins=true" },
                                              { label: "Markups only", q: "includeMarkups=true&includePins=false" },
                                              { label: "Pins only", q: "includeMarkups=false&includePins=true" },
                                              { label: "Plain (no annotations)", q: "includeMarkups=false&includePins=false" },
                                            ].map(opt => (
                                              <DropdownMenuItem
                                                key={opt.label}
                                                onClick={() => {
                                                  window.open(`/api/plan-documents/${doc.id}/export.pdf?${opt.q}`, "_blank");
                                                }}
                                                data-testid={`button-export-pdf-${doc.id}-${opt.label.replace(/\s+/g, "-").toLowerCase()}`}
                                              >
                                                {opt.label}
                                              </DropdownMenuItem>
                                            ))}
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem
                                              onClick={() => {
                                                setLayerPickerDoc({
                                                  id: doc.id,
                                                  label: doc.title || doc.fileName,
                                                });
                                              }}
                                              data-testid={`button-export-pdf-${doc.id}-by-layer`}
                                            >
                                              By layer…
                                            </DropdownMenuItem>
                                          </DropdownMenuSubContent>
                                        </DropdownMenuSub>
                                      )}
                                      {(doc.mimeType?.includes("pdf") || doc.fileName?.toLowerCase().endsWith(".pdf")) && (
                                        <DropdownMenuItem
                                          onClick={() => {
                                            setCarryoverContext({
                                              fromDocumentId: "",
                                              toDocumentId: doc.id,
                                              toLabel: doc.title || doc.fileName,
                                            });
                                            setCarryoverOpen(true);
                                          }}
                                          data-testid={`button-carryover-annotations-${doc.id}`}
                                        >
                                          <RefreshCw className="w-4 h-4 mr-2" />
                                          Carry over annotations…
                                        </DropdownMenuItem>
                                      )}
                                      {(doc.mimeType?.includes("pdf") || doc.fileName?.toLowerCase().endsWith(".pdf")) && (
                                        <DropdownMenuItem
                                          onClick={() => handleImportToTakeoff(doc.id)}
                                          data-testid={`button-import-takeoff-${doc.id}`}
                                        >
                                          <FileText className="w-4 h-4 mr-2" />
                                          Import to Takeoff
                                        </DropdownMenuItem>
                                      )}
                                      {bimEnabled && isIfcFile(doc.fileName) && (
                                        <DropdownMenuItem
                                          onClick={() => handleExtractBimQuantities(doc)}
                                          data-testid={`button-extract-bim-${doc.id}`}
                                        >
                                          <Box className="w-4 h-4 mr-2" />
                                          Extract Quantities
                                        </DropdownMenuItem>
                                      )}
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem
                                        onClick={() => setDeleteDocId(doc.id)}
                                        className="text-destructive"
                                        data-testid={`button-delete-document-${doc.id}`}
                                      >
                                        <Trash2 className="w-4 h-4 mr-2" />
                                        Delete
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                                );
                              })
                            )}
                            {(group.children || []).map((child) => {
                              const sfKey = subFolderKey(group.name, child.name);
                              const sfDocIds = subFolderDocs[sfKey] || [];
                              const sfDocs = documents.filter((d: any) => sfDocIds.includes(d.id));
                              const isDropTarget = dragOverTarget === sfKey && draggedDocId !== null;
                              return (
                                <div key={child.name} className="mt-0.5">
                                  <div
                                    className={cn(
                                      "flex items-center gap-1.5 px-2 py-1 text-sm hover:bg-accent/50 transition-colors cursor-pointer group/subfolder",
                                      isDropTarget && "bg-blue-500/20 ring-1 ring-blue-500/50 rounded"
                                    )}
                                    onClick={() => {
                                      setGroups((prev) =>
                                        prev.map((g) =>
                                          g.name === group.name
                                            ? { ...g, children: (g.children || []).map((c) => c.name === child.name ? { ...c, expanded: !c.expanded } : c) }
                                            : g
                                        )
                                      );
                                    }}
                                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move"; setDragOverTarget(sfKey); }}
                                    onDragLeave={() => setDragOverTarget(null)}
                                    onDrop={(e) => handleSubfolderDrop(e, group.name, child.name)}
                                    data-testid={`subfolder-${child.name.toLowerCase().replace(/\s+/g, '-')}`}
                                  >
                                    {child.expanded ? (
                                      <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
                                    ) : (
                                      <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
                                    )}
                                    {child.expanded ? (
                                      <FolderOpen className="w-3.5 h-3.5 text-yellow-500 shrink-0" />
                                    ) : (
                                      <Folder className="w-3.5 h-3.5 text-yellow-500 shrink-0" />
                                    )}
                                    <span className="truncate font-medium text-xs flex-1">{child.name}</span>
                                    <Badge variant="secondary" className="text-[10px] h-3.5 px-1 shrink-0">
                                      {sfDocs.length}
                                    </Badge>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-4 w-4 opacity-0 group-hover/subfolder:opacity-100 shrink-0"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSubFolderDocs((prev) => {
                                          const next = { ...prev };
                                          delete next[sfKey];
                                          return next;
                                        });
                                        setGroups((prev) =>
                                          prev.map((g) =>
                                            g.name === group.name
                                              ? { ...g, children: (g.children || []).filter((c) => c.name !== child.name) }
                                              : g
                                          )
                                        );
                                        toast({ description: `Subfolder "${child.name}" removed. Files moved back to parent.` });
                                      }}
                                      data-testid={`delete-subfolder-${child.name}`}
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </Button>
                                  </div>
                                  {child.expanded && (
                                    <div className="ml-4">
                                      {sfDocs.length === 0 ? (
                                        <div className="px-2 py-1 text-xs text-muted-foreground italic">No files — drag documents here</div>
                                      ) : (
                                        sfDocs.map((doc: any) => {
                                          const isPdfDoc = (doc.mimeType || "").toLowerCase().includes("pdf") || (doc.fileName || "").toLowerCase().endsWith(".pdf");
                                          return (
                                          <div
                                            key={doc.id}
                                            draggable
                                            onDragStart={(e) => handleDocDragStart(e, doc.id)}
                                            onDragEnd={handleDocDragEnd}
                                            className={cn(
                                              "flex items-start gap-1.5 px-2 py-1 text-xs cursor-pointer hover:bg-accent/50 transition-colors group data-[focused=true]:ring-2 data-[focused=true]:ring-primary data-[focused=true]:ring-inset",
                                              selectedDocId === doc.id && "bg-accent",
                                              draggedDocId === doc.id && "opacity-50",
                                              isPdfDoc && "data-[pin-drop-active=true]:ring-2 data-[pin-drop-active=true]:ring-primary data-[pin-drop-active=true]:bg-primary/10"
                                            )}
                                            onClick={() => { setSelectedDocId(doc.id); setPreviewDocId(doc.id); }}
                                            data-testid={`subfolder-doc-${doc.id}`}
                                            {...(isPdfDoc ? { "data-pin-drop-target": "", "data-pin-drop-doc": doc.id } : {})}
                                            {...getDocRowProps(doc.id)}
                                          >
                                            <GripVertical className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-50 shrink-0 cursor-grab mt-0.5" />
                                            <File className="w-3 h-3 text-muted-foreground shrink-0 mt-0.5" />
                                            <span className="break-words flex-1 min-w-0 leading-snug">{doc.title || doc.fileName}</span>
                                            {(() => {
                                              const counts = planPinSummary[doc.id];
                                              if (!counts || counts.total + counts.closedTotal === 0) return null;
                                              const displayCount = pinCountMode === "all" ? counts.total + counts.closedTotal : counts.total;
                                              const noOpen = counts.total === 0;
                                              return (
                                              <Tooltip>
                                                <TooltipTrigger asChild>
                                                  <Badge
                                                    variant="secondary"
                                                    className={
                                                      "text-[10px] h-4 px-1 shrink-0 " +
                                                      (pinCountMode === "all" && noOpen
                                                        ? "bg-slate-200 text-slate-700 dark:bg-slate-700/60 dark:text-slate-200"
                                                        : "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200")
                                                    }
                                                    data-testid={`badge-plan-pins-${doc.id}`}
                                                  >
                                                    {displayCount}
                                                  </Badge>
                                                </TooltipTrigger>
                                                <TooltipContent side="left" className="text-xs">
                                                  <div className="font-medium mb-0.5">Pins (open / closed)</div>
                                                  <div>RFI: {counts.rfi} / {counts.closedRfi}</div>
                                                  <div>Punch: {counts.punch} / {counts.closedPunch}</div>
                                                  <div>Submittal: {counts.submittal} / {counts.closedSubmittal}</div>
                                                  <div className="mt-0.5 pt-0.5 border-t border-border/50">Total: {counts.total} / {counts.closedTotal}</div>
                                                </TooltipContent>
                                              </Tooltip>
                                              );
                                            })()}
                                          </div>
                                          );
                                        })
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ))}</TooltipProvider>
                  )}

                  {effectiveSetId && (
                    <div className="mx-2 my-1 p-1.5 rounded border border-amber-300 bg-amber-50/50 dark:bg-amber-900/10" data-testid="banner-active-drawing-set">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-medium text-amber-700 dark:text-amber-400 flex items-center gap-1">
                          <Layers className="w-3 h-3" />
                          {drawingSetsData.find(s => s.id === effectiveSetId)?.name || "Drawing Set"}
                        </span>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 text-[10px] px-1.5"
                            onClick={() => setShowAllSheets(!showAllSheets)}
                            data-testid="button-toggle-all-sheets"
                          >
                            {showAllSheets ? "Pinned Only" : "Show All"}
                          </Button>
                          {activeDrawingSetId && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-4 w-4"
                              onClick={() => { setActiveDrawingSetId(null); setShowAllSheets(false); }}
                              data-testid="button-clear-active-set"
                            >
                              <X className="w-3 h-3" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {sheets.length > 0 && (
                    <>
                      <Separator className="my-2" />
                      <div className="px-2 py-1.5">
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Takeoff Sheets ({sheets.length})
                        </span>
                      </div>
                      {SHEET_FOLDER_NAMES.map((folderName) => {
                        const folderSheets = groupedSheets[folderName] || [];
                        const isExpanded = sheetFolderGroups[folderName] !== false;
                        return (
                          <div
                            key={folderName}
                            onDragOver={(e) => handleSheetDragOver(e, folderName)}
                            onDrop={(e) => handleSheetDrop(e, folderName)}
                            onDragLeave={() => setDragOverGroup(null)}
                            className={cn(dragOverGroup === folderName && "bg-accent/30 rounded")}
                          >
                            <button
                              className="flex items-center gap-1.5 w-full px-2 py-1.5 text-sm hover:bg-accent/50 transition-colors"
                              onClick={() => toggleSheetGroup(folderName)}
                              data-testid={`sheet-folder-${folderName.toLowerCase().replace(/\s+/g, '-')}`}
                            >
                              {isExpanded ? (
                                <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                              ) : (
                                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                              )}
                              {isExpanded ? (
                                <FolderOpen className="w-4 h-4 text-blue-400 shrink-0" />
                              ) : (
                                <Folder className="w-4 h-4 text-blue-400 shrink-0" />
                              )}
                              <span className="truncate font-medium">{folderName}</span>
                              <Badge variant="secondary" className="ml-auto text-[10px] h-4 px-1">
                                {folderSheets.length}
                              </Badge>
                            </button>
                            {isExpanded && (
                              <div className="ml-2">
                                {folderSheets.length === 0 ? (
                                  <div className="px-6 py-1 text-xs text-muted-foreground italic">No sheets</div>
                                ) : (
                                  folderSheets.filter((s) => !hiddenSheetIds.has(s.id)).map((sheet) => {
                                    // Task #1858 — Per-sheet derivations are computed
                                    // here (not inside the memoized SheetRow) so the
                                    // row only takes primitive props. Anything that
                                    // depends on the activeSetItemMap, sheet-status,
                                    // or other parent collections is reduced to
                                    // booleans / ids before crossing the memo
                                    // boundary, allowing React.memo to short-circuit
                                    // re-renders during background refetches.
                                    const pinnedItem = activeSetItemMap.get(sheet.id);
                                    const isPinned = !!effectiveSetId && pinnedSheetIdSet.has(sheet.id);
                                    const hasNewer = !!effectiveSetId && newerSheetIdSet.has(sheet.id);
                                    const latestId = getLatestRevisionSheetId(sheet);
                                    const isNotInSet =
                                      !!effectiveSetId &&
                                      pinnedSheetIdSet.size > 0 &&
                                      !isPinned &&
                                      !pinnedSheetNames.has(sheet.sheetName || "");
                                    return (
                                      <SheetRow
                                        key={sheet.id}
                                        sheetId={sheet.id}
                                        sheetName={sheet.sheetName}
                                        isBim={(sheet as any).folderGroup === "BIM"}
                                        hasScale={!!sheet.scalePxPerFoot}
                                        isSelected={selectedSheetId === sheet.id && !previewDocId}
                                        isDragging={draggedSheetId === sheet.id}
                                        isRenaming={renameSheetId === sheet.id}
                                        renameValue={renameSheetId === sheet.id ? renameSheetValue : ""}
                                        effectiveSetId={effectiveSetId}
                                        pinnedItemId={pinnedItem?.id ?? null}
                                        pinnedRevLabel={sheet.revisionLabel || pinnedItem?.revisionId || null}
                                        isPinned={isPinned}
                                        hasNewer={hasNewer}
                                        isNotInSet={isNotInSet}
                                        latestRevisionSheetId={latestId}
                                        setName={activeSetName}
                                        canManageDrawingSets={canManageDrawingSets}
                                        pinPending={pinPending}
                                        unpinPending={unpinPending}
                                        swapPending={swapPending}
                                        currentFolderName={folderName}
                                        onSelect={handleSelectSheet}
                                        onDragStart={handleSheetDragStart}
                                        onDragEnd={handleSheetDragEnd}
                                        onRenameValueChange={handleRenameValueChange}
                                        onRenameCommit={handleRenameCommit}
                                        onRenameCancel={handleRenameCancel}
                                        onRenameStart={handleRenameStart}
                                        onPin={handlePinSheet}
                                        onUnpin={handleUnpinSheet}
                                        onSwapRevision={handleSwapRevision}
                                        onDuplicate={handleDuplicateSheet}
                                        onMove={handleMoveSheet}
                                        onDeleteRequest={handleDeleteSheetRequest}
                                      />
                                    );
                                  })
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </>
                  )}

                  <Separator className="my-2" />
                  <div className="px-2 py-1.5">
                    <button
                      className="flex items-center gap-1.5 w-full text-sm hover:bg-accent/50 transition-colors rounded px-1 py-0.5"
                      onClick={() => setLibraryExpanded(!libraryExpanded)}
                      data-testid="section-libraries-toggle"
                    >
                      {libraryExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      )}
                      <BookOpen className="w-4 h-4 text-purple-500 shrink-0" />
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Libraries
                      </span>
                    </button>
                  </div>
                  {libraryExpanded && (
                    <BidLibrarySection bidId={project.id} />
                  )}
                </div>
              </ScrollArea>

              {selectedDoc && (
                <div className="border-t p-3 bg-muted/30 space-y-2 shrink-0">
                  <p className="text-xs font-medium break-words">{selectedDoc.title || selectedDoc.fileName}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline" className="text-[10px]">{selectedDoc.type}</Badge>
                    <span>{format(new Date(selectedDoc.uploadedAt), "MMM d, yyyy")}</span>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" className="h-7 text-xs flex-1" onClick={() => handleOpenFile(selectedDoc.id, selectedDoc.fileUrl)} data-testid="button-view-selected-doc">
                      <Eye className="w-3 h-3 mr-1" /> View
                    </Button>
                    <DocumentRevisionPanel
                      documentId={selectedDoc.id}
                      documentTitle={selectedDoc.title || selectedDoc.fileName}
                      userRole={user?.role || ""}
                    />
                  </div>
                </div>
              )}

              <div className="border-t p-2 shrink-0 space-y-1.5">
                {sheets.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() => importToEstimateMutation.mutate()}
                    disabled={importToEstimateMutation.isPending}
                    data-testid="button-import-to-estimate"
                  >
                    {importToEstimateMutation.isPending ? (
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    ) : (
                      <ArrowRight className="w-3 h-3 mr-1" />
                    )}
                    Import Measurements to Estimate
                  </Button>
                )}
              </div>

              <div
                className="absolute top-0 right-0 h-full w-1 cursor-col-resize hidden md:flex items-center justify-center group z-30 hover:bg-primary/20 active:bg-primary/30 transition-colors"
                onMouseDown={handleResizeMouseDown}
                data-testid="panel-resize-handle"
              >
                <div className="w-0.5 h-8 rounded-full bg-border group-hover:bg-primary/50 transition-colors" />
              </div>
            </div>
          )}

          <div className={cn("flex-1 min-w-0 relative flex", splitViewMode ? "flex-row" : "flex-col")}>
            {!splitViewMode && leftPanelCollapsed && !previewDocId && (
              <Button
                size="icon"
                variant="ghost"
                className="absolute top-2 left-2 z-10 h-7 w-7"
                onClick={() => setLeftPanelCollapsed(false)}
                data-testid="button-expand-panel"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            )}
            {!splitViewMode && !leftPanelCollapsed && !previewDocId && (
              <Button
                size="icon"
                variant="ghost"
                className="absolute top-2 left-2 z-10 h-7 w-7 hidden md:flex mt-[11px] mb-[11px]"
                onClick={() => setLeftPanelCollapsed(true)}
                data-testid="button-collapse-panel"
              >
                <ChevronDown className="w-4 h-4 rotate-90" />
              </Button>
            )}

            {bimEnabled && splitViewMode ? (
              <>
                <div className="w-1/2 flex flex-col border-r min-w-0" data-testid="split-view-takeoff">
                  <div className="flex items-center gap-2 px-2 py-1 border-b bg-muted/30 shrink-0">
                    <span className="text-xs font-semibold uppercase text-muted-foreground">2D Takeoff</span>
                    <div className="flex-1" />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-[10px] gap-1"
                      onClick={() => setSplitViewMode(false)}
                      data-testid="button-exit-split-view"
                    >
                      <X className="w-3 h-3" />
                      Exit Split
                    </Button>
                  </div>
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <WidgetErrorBoundary fallbackTitle="Takeoff Workspace">
                      <TakeoffWorkspace projectId={project.id} projectCode={project.code} selectedSheetId={selectedSheetId} onSelectSheet={setSelectedSheetId} />
                    </WidgetErrorBoundary>
                  </div>
                </div>
                <div className="w-1/2 flex flex-col min-w-0" data-testid="split-view-bim">
                  <div className="flex items-center gap-2 px-2 py-1 border-b bg-muted/30 shrink-0">
                    <span className="text-xs font-semibold uppercase text-muted-foreground">3D BIM</span>
                    {bimDocuments.length > 1 && (
                      <Select value={splitBimDocId || bimDocuments[0]?.id || ""} onValueChange={setSplitBimDocId}>
                        <SelectTrigger className="h-6 w-40 text-[10px]" data-testid="select-split-bim-doc">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {bimDocuments.map((d: any) => (
                            <SelectItem key={d.id} value={d.id}>{d.title || d.fileName}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {bimSelectedElements.length > 0 && bimSelectedElements[0].storeyName && (
                      <Badge variant="outline" className="text-[9px] px-1">
                        <Building2 className="w-2.5 h-2.5 mr-0.5" />
                        {bimSelectedElements[0].storeyName}
                      </Badge>
                    )}
                    <div className="flex-1" />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-[10px] gap-1"
                      onClick={() => {
                        setStoreyAssocDialogOpen(true);
                      }}
                      data-testid="button-link-storey"
                    >
                      <Link2 className="w-3 h-3" />
                      Link Sheet
                    </Button>
                  </div>
                  <div className="flex-1 min-h-0 overflow-hidden">
                    {splitBimDoc && splitBimUrl?.url ? (
                      <Suspense fallback={
                        <div className="flex items-center justify-center h-full">
                          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                        </div>
                      }>
                        <WidgetErrorBoundary fallbackTitle="BIM Viewer">
                          <BimViewer
                            fileUrl={splitBimUrl.url}
                            fileName={splitBimDoc.title || splitBimDoc.fileName}
                            fileSize={splitBimDoc.fileSize}
                            uploadDate={splitBimDoc.uploadedAt}
                            onAddToTakeoff={handleBimAddToTakeoff}
                            onElementSelect={handleBimElementSelect}
                            highlightStoreyId={highlightStoreyId}
                          />
                        </WidgetErrorBoundary>
                      </Suspense>
                    ) : splitBimDoc ? (
                      <div className="flex items-center justify-center h-full">
                        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full text-center p-4">
                        <Box className="w-12 h-12 text-muted-foreground/30 mb-3" />
                        <p className="text-sm text-muted-foreground">No BIM model available. Upload an IFC file to use split view.</p>
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : previewDocId ? (
              (() => {
                const doc = documents.find((d: any) => d.id === previewDocId);
                if (!doc) return <WidgetErrorBoundary fallbackTitle="Takeoff Workspace"><TakeoffWorkspace projectId={project.id} projectCode={project.code} selectedSheetId={selectedSheetId} onSelectSheet={setSelectedSheetId} /></WidgetErrorBoundary>;
                const isPdf = doc.mimeType?.includes("pdf") || doc.fileName?.toLowerCase().endsWith(".pdf");
                const isImage = doc.mimeType?.startsWith("image/") || /\.(png|jpg|jpeg|gif|webp)$/i.test(doc.fileName || "");
                const isBim = bimEnabled && (doc.type === "BIM" || doc.fileName?.toLowerCase().endsWith(".ifc"));

                if (isBim && previewUrlData?.url) {
                  return (
                    <div className="flex flex-col h-full" data-testid="bim-preview-panel">
                      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30 shrink-0">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs gap-1"
                          onClick={() => setPreviewDocId(null)}
                          data-testid="button-back-to-takeoff"
                        >
                          <X className="w-3.5 h-3.5" />
                          Back to Takeoff
                        </Button>
                        <span className="text-sm font-medium truncate flex-1" data-testid="preview-doc-title">{doc.title || doc.fileName}</span>
                        <Badge variant="outline" className="text-[10px] shrink-0">
                          <Box className="w-3 h-3 mr-1" />
                          BIM
                        </Badge>
                      </div>
                      <div className="flex-1 min-h-0 overflow-hidden">
                        <Suspense fallback={
                          <div className="flex items-center justify-center h-full">
                            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                          </div>
                        }>
                          <WidgetErrorBoundary fallbackTitle="BIM Viewer">
                            <BimViewer fileUrl={previewUrlData.url} fileName={doc.title || doc.fileName} fileSize={doc.fileSize} uploadDate={doc.uploadedAt} />
                          </WidgetErrorBoundary>
                        </Suspense>
                      </div>
                    </div>
                  );
                }

                if (isBim && previewUrlLoading) {
                  return (
                    <div className="flex flex-col h-full" data-testid="bim-preview-panel">
                      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30 shrink-0">
                        <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => setPreviewDocId(null)} data-testid="button-back-to-takeoff">
                          <X className="w-3.5 h-3.5" /> Back to Takeoff
                        </Button>
                        <span className="text-sm font-medium truncate flex-1">{doc.title || doc.fileName}</span>
                      </div>
                      <div className="flex items-center justify-center h-full">
                        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                      </div>
                    </div>
                  );
                }

                return (
                  <div className="flex flex-col h-full" data-testid="doc-preview-panel">
                    <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30 shrink-0">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs gap-1"
                        onClick={() => setPreviewDocId(null)}
                        data-testid="button-back-to-takeoff"
                      >
                        <X className="w-3.5 h-3.5" />
                        Back to Takeoff
                      </Button>
                      <span className="text-sm font-medium truncate flex-1" data-testid="preview-doc-title">{doc.title || doc.fileName}</span>
                      <Badge variant="outline" className="text-[10px] shrink-0">{doc.type}</Badge>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 shrink-0"
                        onClick={() => handleOpenFile(doc.id, doc.fileUrl)}
                        data-testid="button-open-doc-external"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                    {isPdf && (
                      <UnifiedPlanToolbar
                        markupTool={markupTool}
                        onChangeMarkupTool={setMarkupTool}
                        markupColor={markupColor}
                        onChangeMarkupColor={setMarkupColor}
                        markupThickness={markupThickness}
                        onChangeMarkupThickness={setMarkupThickness}
                        pinFilter={pinFilter}
                        onChangePinFilter={setPinFilter}
                        pinModeActive={pinModeActive}
                        onTogglePinMode={() => setPinModeActive((v) => !v)}
                        pinCountMode={pinCountMode}
                        onChangePinCountMode={setPinCountMode}
                        clusteringEnabled={pinClusteringEnabled}
                        onToggleClustering={() => setPinClusteringEnabled((v) => !v)}
                        clusterDensity={pinClusterDensity}
                        onClusterDensityChange={setPinClusterDensity}
                        spacePanActive={spacePanActive}
                        labeled={labeledToolbar}
                        onToggleLabeled={toggleLabeledToolbar}
                        onReplayTour={() => {
                          // Tour anchors to the takeoff toolbar; close the
                          // preview first so its targets exist in the DOM.
                          setPreviewDocId(null);
                          window.setTimeout(() => startPlansTour(), 250);
                        }}
                        onUndoLastMove={handleMarkupUndo}
                        canUndoLastMove={!!markupHistory.undo}
                        onRedoLastMove={handleMarkupRedo}
                        canRedoLastMove={!!markupHistory.redo}
                        undoLabel={markupHistory.undoLabel}
                        redoLabel={markupHistory.redoLabel}
                      />
                    )}
                    <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                      {isPdf ? (
                        <>
                          {/* Task #1662 — Layers panel sits above the
                              PDF preview so users can manage layers
                              without leaving the plan view. The unified
                              toolbar (above) already owns the markup
                              tool/color/thickness controls. The panel
                              handles its own data fetching, RBAC errors,
                              and empty state. */}
                          <div className="hidden lg:flex justify-end px-3 pt-1">
                            <div className="w-56 shrink-0">
                              <MarkupLayersPanel
                                documentId={doc.id}
                                activeLayerId={activeMarkupLayerId}
                                onChangeActiveLayer={setActiveMarkupLayerId}
                                hiddenLayerIds={hiddenMarkupLayerIds}
                                onChangeHiddenLayerIds={setHiddenMarkupLayerIds}
                                /* Task #1701 — sibling PDFs in this
                                   project the user can copy a layer
                                   onto. Filter to PDFs (the only doc
                                   type that supports markups) and
                                   exclude the current sheet so the
                                   menu never offers a self-copy. */
                                copyDestinations={documents
                                  .filter(
                                    (d) =>
                                      d.id !== doc.id &&
                                      ((d.mimeType || "")
                                        .toLowerCase()
                                        .includes("pdf") ||
                                        (d.fileName || "")
                                          .toLowerCase()
                                          .endsWith(".pdf")),
                                  )
                                  .map((d) => ({
                                    id: d.id,
                                    label: d.title || d.fileName || "Untitled sheet",
                                  }))}
                              />
                              {/* Task #1845 — "Trash" entry point
                                  alongside the layer panel. Opens a
                                  dialog that lists every soft-deleted
                                  markup for this sheet so the user
                                  can browse + bulk-restore older
                                  deletions, not just the most recent
                                  delete batch the toolbar's "Undo
                                  delete" banner remembers. */}
                              <button
                                type="button"
                                onClick={() => setTrashOpenForDocId(doc.id)}
                                className="mt-1 w-full flex items-center justify-center gap-1.5 text-xs px-2 py-1 rounded border bg-card hover:bg-accent text-muted-foreground hover:text-foreground"
                                data-testid={`button-open-markup-trash-${doc.id}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>Trash</span>
                              </button>
                            </div>
                          </div>
                          <PdfPreview
                            url={`/api/projects/${projectCode}/documents/${doc.id}/stream`}
                            onOpenFile={() => handleOpenFile(doc.id, doc.fileUrl)}
                            pinMode={pinModeActive}
                            onPinDrop={handlePinDrop}
                            onPageChange={setPreviewPageNumber}
                            pageBadges={planPinSummary[doc.id]?.pages}
                            pageBadgesClosed={planPinSummary[doc.id]?.closedPages}
                            pageBadgeMode={pinCountMode}
                            spacePanActive={spacePanActive}
                            overlay={({ pageNumber, canvasWidth, canvasHeight, zoomInAtPoint, canZoomIn }) => (
                              <>
                                <PlanPinLayer
                                  projectCode={projectCode}
                                  projectId={project.id}
                                  documentId={doc.id}
                                  pageNumber={pageNumber}
                                  filter={pinFilter}
                                  onOpenSource={handleOpenPinSource}
                                  clusteringEnabled={pinClusteringEnabled}
                                  /* Task #1670 — Click-cluster-to-zoom.
                                     Pass the zoom callback only while
                                     more zoom is available so the
                                     cluster can fall back to its
                                     popover list at max zoom. */
                                  onZoomToCluster={canZoomIn ? zoomInAtPoint : undefined}
                                  clusterDensity={pinClusterDensity}
                                />
                                <PlanMarkupLayer
                                  documentId={doc.id}
                                  pageNumber={pageNumber}
                                  canvasWidth={canvasWidth}
                                  canvasHeight={canvasHeight}
                                  activeTool={markupTool}
                                  color={markupColor}
                                  thickness={markupThickness}
                                  onChangeTool={setMarkupTool}
                                  spacePanActive={spacePanActive}
                                  activeLayerId={activeMarkupLayerId}
                                  hiddenLayerIds={hiddenMarkupLayerIds}
                                  onHistoryChange={handleMarkupHistoryChange}
                                />
                                {pickerPosition && pendingPin && pendingPin.pageNumber === pageNumber && !isMobilePin && (
                                  <PinPicker
                                    position={pickerPosition}
                                    onPick={handlePickerChoice}
                                    onCancel={() => { setPickerPosition(null); setPendingPin(null); }}
                                  />
                                )}
                              </>
                            )}
                          />
                          {/* Mobile bottom-sheet picker */}
                          {pickerPosition && pendingPin && isMobilePin && (
                            <div className="fixed inset-0 z-50 flex items-end" data-testid="pin-picker-mobile">
                              <div
                                className="absolute inset-0 bg-black/40"
                                onClick={() => { setPickerPosition(null); setPendingPin(null); }}
                              />
                              <div className="relative w-full bg-background rounded-t-lg p-4 shadow-xl space-y-2">
                                <div className="text-sm font-medium mb-2">Drop pin as…</div>
                                <Button className="w-full justify-start min-h-[44px]" variant="outline" onClick={() => handlePickerChoice("RFI")} data-testid="pin-picker-mobile-rfi">RFI</Button>
                                <Button className="w-full justify-start min-h-[44px]" variant="outline" onClick={() => handlePickerChoice("PUNCH")} data-testid="pin-picker-mobile-punch">Punch Item</Button>
                                <Button className="w-full justify-start min-h-[44px]" variant="outline" onClick={() => handlePickerChoice("SUBMITTAL")} data-testid="pin-picker-mobile-submittal">Submittal</Button>
                                <Button className="w-full min-h-[44px]" variant="ghost" onClick={() => { setPickerPosition(null); setPendingPin(null); }} data-testid="pin-picker-mobile-cancel">Cancel</Button>
                              </div>
                            </div>
                          )}
                          <PinCreateDialog
                            open={pinDialogOpen}
                            onOpenChange={(o) => {
                              setPinDialogOpen(o);
                              if (!o) { setPendingPin(null); setPinDialogType(null); }
                            }}
                            pinType={pinDialogType}
                            projectCode={projectCode}
                            projectId={project.id}
                            documentId={doc.id}
                            pageNumber={pendingPin?.pageNumber || previewPageNumber}
                            position={pendingPin ? { x: pendingPin.x, y: pendingPin.y } : null}
                          />
                        </>
                      ) : previewUrlLoading ? (
                        <div className="flex items-center justify-center h-full" data-testid="preview-loading">
                          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                        </div>
                      ) : isImage ? (
                        <div className="flex items-center justify-center h-full bg-muted/20 p-4">
                          <img
                            src={previewUrlData?.url || doc.fileUrl}
                            alt={doc.title || doc.fileName}
                            className="max-w-full max-h-full object-contain"
                            data-testid="preview-image"
                          />
                        </div>
                      ) : (
                        <div className="flex items-center justify-center h-full">
                          <div className="text-center space-y-4 p-8 max-w-sm">
                            <div className="flex justify-center">
                              <File className="w-16 h-16 text-muted-foreground/40" />
                            </div>
                            <div>
                              <p className="font-medium text-sm" data-testid="preview-filename">{doc.title || doc.fileName}</p>
                              <Badge variant="secondary" className="mt-1 text-xs">{doc.fileName.split(".").pop()?.toUpperCase() || doc.type}</Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">This file type cannot be previewed in the browser.</p>
                            <Button
                              variant="outline"
                              onClick={() => handleOpenFile(doc.id, doc.fileUrl)}
                              data-testid="button-open-file-external"
                            >
                              <ExternalLink className="w-4 h-4 mr-2" />
                              Open File
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()
            ) : (
              <div className="flex flex-col h-full">
                {bimEnabled && bimDocuments.length > 0 && (
                  <div className="flex items-center justify-end px-2 py-1 border-b bg-muted/20 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[10px] gap-1"
                      onClick={() => setSplitViewMode(true)}
                      data-testid="button-split-view"
                    >
                      <Columns2 className="w-3 h-3" />
                      Split View (3D + 2D)
                    </Button>
                  </div>
                )}
                <div className="flex-1 min-h-0">
                  <WidgetErrorBoundary fallbackTitle="Takeoff Workspace">
                    <TakeoffWorkspace projectId={project.id} projectCode={project.code} selectedSheetId={selectedSheetId} onSelectSheet={setSelectedSheetId} />
                  </WidgetErrorBoundary>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <Dialog open={createFolderOpen} onOpenChange={(open) => { setCreateFolderOpen(open); if (!open) { setNewFolderName(""); setCreateFolderParent(null); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Create Folder{createFolderParent ? ` inside ${createFolderParent}` : ""}</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Label htmlFor="new-folder-name" className="text-sm mb-1 block">Folder name</Label>
            <Input
              id="new-folder-name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="e.g. Structural Plans"
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") handleCreateFolderSubmit(); if (e.key === "Escape") setCreateFolderOpen(false); }}
              data-testid="input-new-folder-name"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateFolderOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateFolderSubmit} disabled={!newFolderName.trim()} data-testid="button-create-folder-confirm">
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletingGroupName} onOpenChange={(open) => !open && setDeletingGroupName(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Folder</AlertDialogTitle>
            <AlertDialogDescription>
              Remove the <strong>{deletingGroupName}</strong> folder from view? Documents already uploaded will not be deleted — they will reappear if you reload the page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteGroupConfirm} className="bg-destructive hover:bg-destructive/90" data-testid="button-confirm-delete-folder">
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteDocId} onOpenChange={(open) => !open && setDeleteDocId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Document</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this document? This action cannot be undone and will also remove any takeoff sheets associated with it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteDocId && handleDeleteDocument(deleteDocId)}
              className="bg-destructive hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteSheetId} onOpenChange={(open) => !open && setDeleteSheetId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Sheet</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this takeoff sheet? All measurements on this sheet will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteSheetId && deleteSheetMutation.mutate(deleteSheetId)}
              className="bg-destructive hover:bg-destructive/90"
              data-testid="button-confirm-delete-sheet"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {project?.id && (
        <BimQuantityDialog
          open={bimDialogOpen}
          onOpenChange={setBimDialogOpen}
          projectId={project.id}
          extractionResult={bimExtractionResult}
          isExtracting={bimIsExtracting}
          extractionProgress={bimExtractionProgress}
          categories={categories}
        />
      )}

      <Dialog open={storeyAssocDialogOpen} onOpenChange={(open) => { setStoreyAssocDialogOpen(open); if (!open) { setStoreyAssocSheetId(null); setStoreyAssocStoreyId(""); setStoreyAssocStoreyName(""); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Link Sheet to BIM Storey</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-sm mb-1 block">Takeoff Sheet</Label>
              <Select value={storeyAssocSheetId || ""} onValueChange={setStoreyAssocSheetId}>
                <SelectTrigger className="h-8 text-xs" data-testid="select-storey-sheet">
                  <SelectValue placeholder="Select a sheet" />
                </SelectTrigger>
                <SelectContent>
                  {sheets.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.sheetName || `Sheet ${s.sheetIndex + 1}`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-sm mb-1 block">BIM Storey Name</Label>
              <Input
                value={storeyAssocStoreyName}
                onChange={(e) => setStoreyAssocStoreyName(e.target.value)}
                placeholder="e.g. Level 1, Ground Floor"
                className="h-8 text-xs"
                data-testid="input-storey-name"
              />
            </div>
            <div>
              <Label className="text-sm mb-1 block">Storey Express ID</Label>
              <Input
                value={storeyAssocStoreyId}
                onChange={(e) => setStoreyAssocStoreyId(e.target.value)}
                placeholder="Express ID from BIM model"
                className="h-8 text-xs"
                data-testid="input-storey-express-id"
              />
            </div>
            {storeyAssociations.length > 0 && (
              <div>
                <Label className="text-[10px] text-muted-foreground mb-1 block">Existing Associations</Label>
                <div className="space-y-1 max-h-24 overflow-auto">
                  {storeyAssociations.map((a: any) => (
                    <div key={a.id} className="flex items-center justify-between text-[10px] bg-muted/50 rounded px-2 py-1">
                      <span className="truncate">{sheets.find(s => s.id === a.sheetId)?.sheetName || "Sheet"} → {a.storeyName}</span>
                      <Badge variant="outline" className="text-[8px] px-1 shrink-0 ml-1">#{a.storeyExpressId}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStoreyAssocDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!storeyAssocSheetId || !storeyAssocStoreyName || !storeyAssocStoreyId) return;
                const bimDoc = splitBimDoc || bimDocuments[0];
                if (!bimDoc) return;
                saveStoreyAssocMutation.mutate({
                  sheetId: storeyAssocSheetId,
                  bimDocumentId: (bimDoc as any).id,
                  storeyExpressId: parseInt(storeyAssocStoreyId, 10),
                  storeyName: storeyAssocStoreyName,
                });
              }}
              disabled={!storeyAssocSheetId || !storeyAssocStoreyName || !storeyAssocStoreyId || saveStoreyAssocMutation.isPending}
              data-testid="button-save-storey-association"
            >
              {saveStoreyAssocMutation.isPending ? "Saving..." : "Link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <SheetJumpPalette
        open={sheetJumpOpen}
        onOpenChange={setSheetJumpOpen}
        projectCode={projectCode}
        projectId={project?.id}
        onPick={(r: SheetJumpResult) => {
          if (r.documentId) {
            setPreviewDocId(r.documentId);
            if (r.pageNumber) setPreviewPageNumber(r.pageNumber);
          } else if (r.pageNumber) {
            setPreviewPageNumber(r.pageNumber);
          }
        }}
      />
      <CarryoverAnnotationsDialog
        open={carryoverOpen}
        onOpenChange={(o) => { setCarryoverOpen(o); if (!o) setCarryoverContext(null); }}
        toDocumentId={carryoverContext?.toDocumentId ?? null}
        fromDocumentId={carryoverContext?.fromDocumentId || null}
        fromDocumentLabel={carryoverContext?.fromLabel}
        toDocumentLabel={carryoverContext?.toLabel}
        projectCode={projectCode}
        candidates={
          carryoverContext
            ? documents
                .filter((d: any) => d.id !== carryoverContext.toDocumentId &&
                  (d.mimeType?.includes("pdf") || d.fileName?.toLowerCase?.().endsWith(".pdf")))
                .map((d: any) => ({ id: d.id, label: d.title || d.fileName }))
            : undefined
        }
      />
      <LayerPickerExportDialog
        open={!!layerPickerDoc}
        onOpenChange={(o) => { if (!o) setLayerPickerDoc(null); }}
        documentId={layerPickerDoc?.id ?? null}
        documentLabel={layerPickerDoc?.label}
      />
      {/* Task #1845 — Trash dialog renders at the root so it stays
          mounted across PdfPreview re-renders and isn't clipped by the
          plan view's overflow container. */}
      {trashOpenForDocId && (
        <MarkupTrashPanel
          documentId={trashOpenForDocId}
          open={!!trashOpenForDocId}
          onOpenChange={(o) => { if (!o) setTrashOpenForDocId(null); }}
        />
      )}
    </div>
  );
}
