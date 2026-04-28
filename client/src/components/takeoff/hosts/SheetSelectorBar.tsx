import { memo, type ReactNode, type RefObject } from "react";
import {
  AlertCircle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowUpCircle,
  CheckCircle2, Copy, GalleryHorizontal, GitCompare, History, Keyboard,
  Layers, Link2, List, Maximize, Maximize2, Minimize, MoreVertical, PanelRight, Pencil,
  Pin, PinOff, Plus, Search, Sparkles, Trash2, Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { TakeoffSheet } from "@shared/schema";

export interface SheetSelectorBarPinControls {
  isPinned: boolean;
  setLabel: string;
  hasPinnedItem: boolean;
  hasLatestRevision: boolean;
  onPin: () => void;
  onUnpin: () => void;
  onUseLatestRevision: () => void;
  pinPending: boolean;
  unpinPending: boolean;
  swapPending: boolean;
}

export interface SheetSelectorBarProps {
  workspaceRef: RefObject<HTMLDivElement>;
  sheets: TakeoffSheet[];
  selectedSheet: string | null;
  onSelectSheet: (sheetId: string) => void;
  currentSheet: TakeoffSheet | null | undefined;
  linkCountsBySheet: Record<string, number>;
  sheetLinksCount: number;

  onOpenRename: () => void;
  onDuplicateSheet: () => void;
  duplicatePending: boolean;
  hasRevisionHistory: boolean;
  onOpenCompareDialog: () => void;
  onMoveSheetUp: () => void;
  onMoveSheetDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  pinControls: SheetSelectorBarPinControls | null;
  onDetectLinks: () => void;
  detectLinksPending: boolean;
  onCreateLink: () => void;
  onDeleteSheet: () => void;

  thumbnailStripOpen: boolean;
  onToggleThumbnailStrip: () => void;
  showThumbnailToggle: boolean;
  hasLinkBack: boolean;
  onLinkBack: () => void;

  autoImportEnabled: boolean;
  onToggleAutoImport: () => void;
  onOpenVersionHistory: () => void;
  showPropertiesPanelToggle: boolean;
  propertiesPanelOpen: boolean;
  onTogglePropertiesPanel: () => void;
  collabSlot: ReactNode;
  showHideResolvedToggle: boolean;
  hideResolvedIssues: boolean;
  onToggleHideResolvedIssues: (v: boolean) => void;
  showAddScale: boolean;
  onOpenScaleModal: () => void;
  onShowShortcuts: () => void;
  showCrossModuleToggle: boolean;
  crossModulePanelOpen: boolean;
  onToggleCrossModule: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  /** Task #2310 — Fit-to-page button surfaced in the sheet header so
   *  estimators always have a one-click recovery from a panned-off /
   *  zoomed-out canvas. Wired to the same `zoomToFitRef.current()`
   *  the keyboard shortcut and vertical toolbar use. Disabled until
   *  the PDF dims have resolved (`canFitToPage`). */
  onFitToPage?: () => void;
  canFitToPage?: boolean;
  /** Task #2311 — Labelled "AI Takeoff" button surfaced in the sheet
   *  header (Sparkles + text) so AI is discoverable without scanning
   *  the vertical toolbar. Toggles the same `aiPanelOpen` state the
   *  vertical-toolbar Sparkles button uses, so the two entry points
   *  stay in lockstep. Icon-only (label hidden) below sm where the
   *  bar already wraps. */
  aiPanelOpen?: boolean;
  onToggleAiPanel?: () => void;
  /** Task #2141 — Sheet Sets panel toggle + active-set badge. The
   *  badge is shown next to the calibration-status badge so the user
   *  can see at a glance which set is steering navigation. */
  showSheetSetsToggle?: boolean;
  sheetSetsPanelOpen?: boolean;
  onToggleSheetSetsPanel?: () => void;
  activeSheetSetName?: string | null;
  /** Number of sheets in the active set membership the current sheet
   *  belongs to. Surfaced inline in the badge so the user knows the
   *  scope of "next/prev sheet" without opening the panel. */
  activeSheetSetMemberCount?: number;
  /** Whether the current sheet is part of the active set. Drives the
   *  small "1/N" position chip rendered alongside the badge. */
  currentSheetIndexInSet?: number | null;
}

/** Sheet header toolbar — sheet selector, sheet-actions menu, thumbnail toggle,
 *  link-back, calibration badge, sheet-lock (via collab slot), auto-import,
 *  version history, properties panel, hide-resolved, scale, shortcuts,
 *  cross-module toggle, fullscreen. The CollabHost mounts inside this bar
 *  via the `collabSlot` prop so presence avatars / lock badges keep their
 *  original layout position. */
function SheetSelectorBarInner(props: SheetSelectorBarProps) {
  const {
    workspaceRef,
    sheets,
    selectedSheet,
    onSelectSheet,
    currentSheet,
    linkCountsBySheet,
    sheetLinksCount,
    onOpenRename,
    onDuplicateSheet,
    duplicatePending,
    hasRevisionHistory,
    onOpenCompareDialog,
    onMoveSheetUp,
    onMoveSheetDown,
    canMoveUp,
    canMoveDown,
    pinControls,
    onDetectLinks,
    detectLinksPending,
    onCreateLink,
    onDeleteSheet,
    thumbnailStripOpen,
    onToggleThumbnailStrip,
    showThumbnailToggle,
    hasLinkBack,
    onLinkBack,
    autoImportEnabled,
    onToggleAutoImport,
    onOpenVersionHistory,
    showPropertiesPanelToggle,
    propertiesPanelOpen,
    onTogglePropertiesPanel,
    collabSlot,
    showHideResolvedToggle,
    hideResolvedIssues,
    onToggleHideResolvedIssues,
    showAddScale,
    onOpenScaleModal,
    onShowShortcuts,
    showCrossModuleToggle,
    crossModulePanelOpen,
    onToggleCrossModule,
    isFullscreen,
    onToggleFullscreen,
    onFitToPage,
    canFitToPage = false,
    aiPanelOpen = false,
    onToggleAiPanel,
    showSheetSetsToggle = false,
    sheetSetsPanelOpen = false,
    onToggleSheetSetsPanel,
    activeSheetSetName = null,
    activeSheetSetMemberCount = 0,
    currentSheetIndexInSet = null,
  } = props;
  return (
    /* Task #2298 — on narrow viewports the sheet header packs ~10
     *  controls (selector, actions, thumbnails, calibration badge,
     *  active-set badge, auto-import, version-history, properties,
     *  collab avatar, hide-resolved, scale, shortcuts, sheet-sets,
     *  cross-module, fullscreen). At < sm we let the row wrap onto a
     *  second line and grow vertically so neighboring controls stop
     *  overlapping the calibration badge. The fixed h-12 cap is only
     *  applied at sm+ where the row genuinely fits on one line. */
    <div className="min-h-12 sm:h-14 bg-card border-b px-2 sm:px-4 flex items-center justify-between gap-x-2 sm:gap-x-4 gap-y-1 flex-wrap py-1 sm:py-0">
      <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-1 flex-wrap gap-y-1">
        {/* Task #2206 — hide the redundant "Sheet:" label below sm so the
         *  selector itself has room to breathe on iPad portrait / Surface
         *  split-screen. The dropdown UI is obvious without the label. */}
        <Label className="text-xs sm:text-sm font-medium shrink-0 hidden sm:inline-flex">Sheet:</Label>
        <Select value={selectedSheet || ""} onValueChange={onSelectSheet}>
          {/* Task #2206 — widen the narrow-viewport trigger from 128px to
           *  176px so realistic sheet names like "TFR Construction 2025"
           *  fit on one line instead of wrapping mid-word.
           *  Task #2298 follow-up — the bar now wraps below sm (so the
           *  calibration badge stops overlapping its neighbors), which
           *  in turn let `min-w-0 + flex-shrink: 1` collapse this
           *  trigger to the width of one or two characters (the field
           *  visibly read just "Co"). On narrow viewports the trigger
           *  now uses `flex-1` (with a 10rem floor) so it fills its
           *  row, and falls back to a fixed 16rem at sm+ where the
           *  bar fits on a single line. */}
          <SelectTrigger
            className="flex-1 min-w-[10rem] sm:flex-none sm:w-64"
            data-testid="select-sheet"
          >
            {/* Task #2298 follow-up — when we let the trigger grow
             *  via flex-1, the default Radix SelectValue rendered the
             *  selected SelectItem's children verbatim — including the
             *  inner `<span className="flex items-center gap-2">` whose
             *  RAW TEXT child wraps as soon as the natural width
             *  exceeds the trigger (because text inside a flex item
             *  shrinks to min-content). On a phone that turned the
             *  trigger into a 3-line block ("The Reserve @" / "Chatford"
             *  / "4_8_25") with the chevron mid-content, blowing up the
             *  bar's vertical footprint and pushing the PDF canvas
             *  off-screen.
             *
             *  Override SelectValue's children so the trigger renders a
             *  single-line, truncating label (icon + name only) — the
             *  dropdown items below still get the full set of badges
             *  for picking. */}
            <SelectValue placeholder="Select a sheet...">
              {currentSheet && (
                <span className="flex items-center gap-2 min-w-0 w-full">
                  {currentSheet.scalePxPerFoot ? (
                    <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" />
                  ) : (
                    <AlertCircle className="w-3 h-3 text-amber-500 shrink-0" />
                  )}
                  <span className="truncate min-w-0 flex-1 text-left">
                    {currentSheet.sheetName}
                  </span>
                </span>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent container={workspaceRef.current}>
            {sheets.map((sheet: TakeoffSheet) => (
              <SelectItem key={sheet.id} value={sheet.id}>
                <span className="flex items-center gap-2">
                  {sheet.scalePxPerFoot ? (
                    <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" />
                  ) : (
                    <AlertCircle className="w-3 h-3 text-amber-500 shrink-0" />
                  )}
                  {sheet.sheetName}
                  {sheet.revisionLabel && (
                    <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 shrink-0">{sheet.revisionLabel}</Badge>
                  )}
                  {sheet.isActive === false && (
                    <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4 shrink-0 opacity-60">Superseded</Badge>
                  )}
                  {linkCountsBySheet[sheet.id] > 0 && (
                    <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 shrink-0 text-blue-600 border-blue-300" data-testid={`badge-links-count-${sheet.id}`}>
                      <Link2 className="w-2.5 h-2.5 mr-0.5" />{linkCountsBySheet[sheet.id]}
                    </Badge>
                  )}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedSheet && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="button-sheet-actions">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={onOpenRename} data-testid="menu-rename-sheet">
                <Pencil className="h-4 w-4 mr-2" /> Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={onDuplicateSheet}
                disabled={duplicatePending}
                data-testid="menu-duplicate-sheet"
              >
                <Copy className="h-4 w-4 mr-2" /> Duplicate
              </DropdownMenuItem>
              {hasRevisionHistory && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onOpenCompareDialog} data-testid="menu-compare-revisions">
                    <GitCompare className="h-4 w-4 mr-2" /> Compare Revisions
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={onMoveSheetUp}
                disabled={!canMoveUp}
                data-testid="menu-move-sheet-up"
              >
                <ArrowUp className="h-4 w-4 mr-2" /> Move Up
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={onMoveSheetDown}
                disabled={!canMoveDown}
                data-testid="menu-move-sheet-down"
              >
                <ArrowDown className="h-4 w-4 mr-2" /> Move Down
              </DropdownMenuItem>
              {/* Task #1682 — admin-gated Pin / Unpin / Use-latest revision controls */}
              {pinControls && (
                <>
                  <DropdownMenuSeparator />
                  {pinControls.isPinned ? (
                    <DropdownMenuItem
                      onClick={pinControls.onUnpin}
                      disabled={pinControls.unpinPending || !pinControls.hasPinnedItem}
                      data-testid="menu-unpin-sheet-from-set"
                    >
                      <PinOff className="h-4 w-4 mr-2" /> Unpin from {pinControls.setLabel}
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      onClick={pinControls.onPin}
                      disabled={pinControls.pinPending}
                      data-testid="menu-pin-sheet-to-set"
                    >
                      <Pin className="h-4 w-4 mr-2" /> Pin to {pinControls.setLabel}
                    </DropdownMenuItem>
                  )}
                  {pinControls.isPinned && pinControls.hasLatestRevision && pinControls.hasPinnedItem && (
                    <DropdownMenuItem
                      onClick={pinControls.onUseLatestRevision}
                      disabled={pinControls.swapPending}
                      data-testid="menu-use-latest-revision"
                    >
                      <ArrowUpCircle className="h-4 w-4 mr-2" /> Use latest revision
                    </DropdownMenuItem>
                  )}
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={onDetectLinks}
                disabled={detectLinksPending}
                data-testid="menu-detect-links"
              >
                <Search className="h-4 w-4 mr-2" /> {detectLinksPending ? "Detecting..." : "Detect Links"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onCreateLink} data-testid="menu-create-link">
                <Link2 className="h-4 w-4 mr-2" /> Create Link to Sheet
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={onDeleteSheet}
                data-testid="menu-delete-sheet"
              >
                <Trash2 className="h-4 w-4 mr-2" /> Delete Sheet
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {showThumbnailToggle && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={thumbnailStripOpen ? "secondary" : "ghost"}
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={onToggleThumbnailStrip}
                data-testid="button-toggle-thumbnails"
              >
                {thumbnailStripOpen ? <List className="h-4 w-4" /> : <GalleryHorizontal className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{thumbnailStripOpen ? "Hide Thumbnails" : "Show Page Thumbnails"}</p>
            </TooltipContent>
          </Tooltip>
        )}
        {hasLinkBack && (
          <Button
            variant="outline"
            size="sm"
            onClick={onLinkBack}
            className="gap-1 h-7 px-2 text-xs"
            data-testid="button-link-back"
          >
            <ArrowLeft className="h-3 w-3" />
            <span className="hidden sm:inline">Back</span>
          </Button>
        )}
        {currentSheet && (
          /* Task #2298 — compact calibration badge on narrow viewports
           *  so the long "Calibrated (ft)" text stops overlapping the
           *  collab avatars and right-side buttons. Full text returns
           *  at sm+ where there's room. The full label is set as
           *  `aria-label` on the badge so screen readers always read
           *  "Calibrated (ft)" / "Not Calibrated" regardless of which
           *  visual variant is active (the per-variant spans are hidden
           *  from a11y via aria-hidden so they don't double-read). */
          <Badge
            variant="outline"
            className="shrink-0 whitespace-nowrap"
            data-testid="badge-calibration-status"
            aria-label={
              currentSheet.scalePxPerFoot
                ? `Calibrated (${currentSheet.units})`
                : "Not Calibrated"
            }
          >
            {currentSheet.scalePxPerFoot ? (
              <>
                <CheckCircle2 className="w-3 h-3 mr-1 text-green-500 sm:hidden" aria-hidden="true" />
                <span className="hidden sm:inline" aria-hidden="true">Calibrated </span>
                <span aria-hidden="true">({currentSheet.units})</span>
              </>
            ) : (
              <>
                <AlertCircle className="w-3 h-3 mr-1 text-amber-500 sm:hidden" aria-hidden="true" />
                <span className="hidden sm:inline" aria-hidden="true">Not Calibrated</span>
                <span className="sm:hidden" aria-hidden="true">No scale</span>
              </>
            )}
          </Badge>
        )}
        {/* Task #2310 — Fit-to-page button. Sits right after the
         *  calibration badge so it's always within thumb-reach on the
         *  same row as the sheet selector. Visible on every viewport
         *  (no `hidden sm:` cap) because the "PDF appears missing
         *  because the user is panned off-canvas" failure mode hits
         *  phones and tablets harder than desktop. Disabled until the
         *  PDF dims have actually resolved so the button never
         *  produces a no-op click. */}
        {currentSheet && onFitToPage && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={onFitToPage}
                disabled={!canFitToPage}
                className="h-7 gap-1 px-2 text-xs shrink-0"
                data-testid="button-fit-to-page"
                aria-label="Fit to page"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                <span>Fit to page</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <div className="flex items-center gap-2">
                <span>Fit page to view</span>
                <kbd className="px-1.5 py-0.5 text-xs font-mono bg-muted rounded border">F</kbd>
              </div>
            </TooltipContent>
          </Tooltip>
        )}
        {/* Task #2311 — Labelled "AI Takeoff" entry point on the sheet
         *  header bar. Sits next to Fit-to-page so it's visible in the
         *  same row that estimators already scan when picking a sheet.
         *  Toggles `aiPanelOpen` (the same state the existing vertical-
         *  toolbar Sparkles button drives), so opening from either
         *  surface shows the same panel and a second click closes it.
         *  Requires a current sheet because the AI panel needs a
         *  takeoff sheet to act on. The label collapses to icon-only
         *  below sm to keep the wrapped header row compact on phones,
         *  while the `aria-label` stays full so screen readers always
         *  announce "AI Takeoff". */}
        {currentSheet && onToggleAiPanel && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={aiPanelOpen ? "default" : "outline"}
                size="sm"
                onClick={onToggleAiPanel}
                // Mobile: 44x44 minimum tap target (Apple HIG / WCAG
                // 2.5.5). Desktop/tablet (sm+) collapses back to the
                // dense 28px rhythm used by the rest of this header
                // bar so we don't blow up its layout for pointer
                // users. `min-w` matches the icon-only size on phones.
                className="h-11 min-w-11 px-3 sm:h-7 sm:min-w-0 sm:px-2 gap-1 text-xs shrink-0"
                data-testid="button-ai-takeoff-bar"
                aria-label="AI Takeoff"
                aria-pressed={aiPanelOpen}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">AI Takeoff</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{aiPanelOpen ? "Close AI Takeoff panel" : "Open AI Takeoff panel"}</p>
            </TooltipContent>
          </Tooltip>
        )}
        {activeSheetSetName && (
          <Badge
            variant="default"
            className="gap-1 text-[10px] px-1.5 py-0.5 h-5"
            data-testid="badge-active-sheet-set"
          >
            <Layers className="w-2.5 h-2.5" />
            <span className="truncate max-w-[120px]">{activeSheetSetName}</span>
            {currentSheetIndexInSet !== null && activeSheetSetMemberCount > 0 && (
              <span className="opacity-80 font-mono">
                {currentSheetIndexInSet + 1}/{activeSheetSetMemberCount}
              </span>
            )}
          </Badge>
        )}
        {sheetLinksCount > 0 && (
          <Badge variant="outline" className="text-blue-600 border-blue-300" data-testid="badge-sheet-links">
            <Link2 className="w-3 h-3 mr-1" />{sheetLinksCount} Links
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={autoImportEnabled ? "default" : "outline"}
              size="sm"
              className={`h-7 gap-1 px-2 text-xs ${autoImportEnabled ? "bg-green-600 hover:bg-green-700 text-white" : ""}`}
              onClick={onToggleAutoImport}
              data-testid="button-auto-import-toggle"
            >
              <Zap className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{autoImportEnabled ? "Auto-Import ON" : "Auto-Import"}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{autoImportEnabled ? "New measurements are automatically added to the estimate" : "Enable to auto-add new measurements to estimate"}</p>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={onOpenVersionHistory}
              data-testid="button-version-history"
            >
              <History className="w-3.5 h-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Version History</TooltipContent>
        </Tooltip>
        {showPropertiesPanelToggle && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={propertiesPanelOpen ? "default" : "outline"}
                size="sm"
                className="h-7 w-7 p-0 hidden md:inline-flex"
                onClick={onTogglePropertiesPanel}
                data-testid="button-properties-panel"
              >
                <PanelRight className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Properties Panel</TooltipContent>
          </Tooltip>
        )}
        {collabSlot}
        {showHideResolvedToggle && (
          <div className="hidden md:flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="hide-resolved-toggle">
            <Switch
              id="hide-resolved"
              checked={hideResolvedIssues}
              onCheckedChange={onToggleHideResolvedIssues}
              className="h-4 w-7 data-[state=checked]:bg-green-500"
            />
            <label htmlFor="hide-resolved" className="cursor-pointer select-none hidden sm:block">Hide Resolved</label>
          </div>
        )}
        {showAddScale && (
          <Button
            variant="outline"
            size="sm"
            onClick={onOpenScaleModal}
            className="gap-1.5"
            data-testid="button-add-scale"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{currentSheet?.scalePxPerFoot ? "Set Scale" : "Add Scale"}</span>
          </Button>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={onShowShortcuts}
              data-testid="button-keyboard-shortcuts"
            >
              <Keyboard className="w-5 h-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <div className="flex items-center gap-2">
              <span>Keyboard Shortcuts</span>
              <kbd className="px-1.5 py-0.5 text-xs font-mono bg-muted rounded border">?</kbd>
            </div>
          </TooltipContent>
        </Tooltip>
        {showSheetSetsToggle && onToggleSheetSetsPanel && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={sheetSetsPanelOpen ? "secondary" : "ghost"}
                size="icon"
                onClick={onToggleSheetSetsPanel}
                data-testid="button-toggle-sheet-sets"
              >
                <Layers className="w-5 h-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{sheetSetsPanelOpen ? "Hide Sheet Sets" : "Sheet Sets"}</p>
            </TooltipContent>
          </Tooltip>
        )}
        {showCrossModuleToggle && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={crossModulePanelOpen ? "secondary" : "ghost"}
                size="icon"
                className="hidden md:inline-flex"
                onClick={onToggleCrossModule}
                data-testid="button-toggle-cross-module"
              >
                <ArrowRight className="w-5 h-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{crossModulePanelOpen ? "Hide Cross-Module Panel" : "Cross-Module Actions"}</p>
            </TooltipContent>
          </Tooltip>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleFullscreen}
          data-testid="button-toggle-fullscreen"
          title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
        >
          {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
        </Button>
      </div>
    </div>
  );
}

export const SheetSelectorBar = memo(SheetSelectorBarInner);
SheetSelectorBar.displayName = "SheetSelectorBar";
