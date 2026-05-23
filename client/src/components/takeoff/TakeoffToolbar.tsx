import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  ZoomIn, ZoomOut, Eraser, Upload, Sparkles, Undo2, Redo2, Magnet, CornerDownRight, Layers, Pen, Download, HelpCircle,
  RotateCw, RotateCcw, FlipVertical2, Grid3X3, Maximize2, ChevronDown, MousePointer2, Hand, Ruler, Tag, LayoutGrid,
  Printer, WifiOff, BarChart3, FileSpreadsheet, PanelRight
} from "lucide-react";
import { DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { TOOL_CONFIG, MARKUP_TOOL_IDS, type Tool } from "./types";
import type { TakeoffMeasurement } from "@shared/schema";
import type { useTakeoffHistory } from "@/hooks/use-takeoff-history";
import { cn } from "@/lib/utils";
import PlanMarkupToolbar from "@/components/markups/PlanMarkupToolbar";
import type { MarkupTool } from "@/components/markups/MarkupRenderer";

// Task #1631 — bid-side and project-side markup toolbars now share
// `<PlanMarkupToolbar>`. The takeoff sidebar uses Tool ids like
// `markup_arrow`; the shared toolbar uses MarkupTool tags like `ARROW`.
// These maps translate between the two.
const TOOL_TO_MARKUP: Partial<Record<Tool, MarkupTool>> = {
  markup_arrow: "ARROW",
  markup_text: "TEXT",
  markup_rectangle: "RECTANGLE",
  markup_cloud: "CLOUD",
  markup_highlight: "HIGHLIGHT",
  markup_freehand: "FREEHAND",
};
const MARKUP_TO_TOOL: Record<MarkupTool, Tool> = {
  SELECT: "select",
  ARROW: "markup_arrow",
  TEXT: "markup_text",
  RECTANGLE: "markup_rectangle",
  CLOUD: "markup_cloud",
  HIGHLIGHT: "markup_highlight",
  FREEHAND: "markup_freehand",
};

export interface TakeoffToolbarProps {
  activeTool: Tool;
  onToolSelect: (tool: Tool) => void;
  stageScale: number;
  setStageScale: (v: number | ((prev: number) => number)) => void;
  selectedMeasurementId: string | null;
  measurements: TakeoffMeasurement[];
  onDeleteMeasurement: (m: TakeoffMeasurement) => void;
  deletePending: boolean;
  takeoffHistory: ReturnType<typeof useTakeoffHistory>;
  snapEnabled: boolean;
  setSnapEnabled: (v: boolean) => void;
  orthoLock: boolean;
  setOrthoLock: (v: boolean) => void;
  onUpload: () => void;
  aiPanelOpen: boolean;
  setAiPanelOpen: (v: boolean) => void;
  mobileMeasurementsOpen: boolean;
  setMobileMeasurementsOpen: (v: boolean) => void;
  isDrawing: boolean;
  drawingPoints: { x: number; y: number }[];
  isMobile: boolean;
  markupColor: string;
  setMarkupColor: (v: string) => void;
  markupThickness: number;
  setMarkupThickness: (v: number) => void;
  onExportCurrentSheet?: () => void;
  onExportAllSheets?: () => void;
  onExportQuantityDelta?: () => void;
  onExportBidPackage?: () => void;
  onPrintSheet?: () => void;
  isOffline?: boolean;
  onShowShortcuts?: () => void;
  sheetRotation: number;
  onRotateCW: () => void;
  onRotateCCW: () => void;
  onRotate180: () => void;
  gridEnabled: boolean;
  onToggleGrid: (v: boolean) => void;
  isCalibrated: boolean;
  onFitToPage?: () => void;
  showMeasurementLabels?: boolean;
  onToggleMeasurementLabels?: (v: boolean) => void;
  showStructuralGridlines?: boolean;
  onToggleStructuralGridlines?: (v: boolean) => void;
  /** Task #1696 — When true, the embedded markup popover renders
   *  icon+label rows instead of icon-only chips, matching the
   *  bid Plans tab "Labeled toolbar" preference. */
  labeled?: boolean;
  /** Task #3045 — Division Overlays filter panel.
   *  `hasDivisionOverlays` gates the button visibility (hidden for
   *  takeoffs with no aiGeometry data). `divisionFilterOpen` controls
   *  the active/inactive button state. */
  hasDivisionOverlays?: boolean;
  divisionFilterOpen?: boolean;
  onToggleDivisionFilter?: () => void;
  /** Task #3050 — active confidence threshold; drives the badge label. */
  confidenceThreshold?: import("./DivisionFilterPanel").ConfidenceThreshold;
}

export function TakeoffToolbar({
  activeTool, onToolSelect, stageScale, setStageScale,
  selectedMeasurementId, measurements, onDeleteMeasurement, deletePending,
  takeoffHistory, snapEnabled, setSnapEnabled, orthoLock, setOrthoLock,
  onUpload, aiPanelOpen, setAiPanelOpen,
  mobileMeasurementsOpen, setMobileMeasurementsOpen,
  isDrawing, drawingPoints, isMobile,
  markupColor, setMarkupColor, markupThickness, setMarkupThickness,
  onExportCurrentSheet, onExportAllSheets,
  onExportQuantityDelta, onExportBidPackage,
  onPrintSheet,
  isOffline,
  onShowShortcuts,
  sheetRotation, onRotateCW, onRotateCCW, onRotate180,
  gridEnabled, onToggleGrid, isCalibrated,
  onFitToPage,
  showMeasurementLabels, onToggleMeasurementLabels,
  showStructuralGridlines, onToggleStructuralGridlines,
  labeled = false,
  hasDivisionOverlays,
  divisionFilterOpen,
  onToggleDivisionFilter,
  confidenceThreshold,
}: TakeoffToolbarProps) {
  const isMarkupTool = MARKUP_TOOL_IDS.includes(activeTool as any);
  const zoomPercent = Math.round(stageScale * 100);
  const [measureOpen, setMeasureOpen] = useState(false);
  const [markupOpen, setMarkupOpen] = useState(false);

  const navTools = TOOL_CONFIG.filter(t => t.group === "nav");
  const measureTools = TOOL_CONFIG.filter(t => t.group === "measure");
  const markupTools = TOOL_CONFIG.filter(t => t.group === "markup");
  const issueTools = TOOL_CONFIG.filter(t => t.group === "issues");

  const activeMeasureTool = measureTools.find(t => t.id === activeTool);
  const activeMarkupTool = markupTools.find(t => t.id === activeTool);

  const SmallToolBtn = ({ tool, isMarkup = false, onClick }: { tool: typeof TOOL_CONFIG[number]; isMarkup?: boolean; onClick?: () => void }) => {
    const Icon = tool.icon;
    const isActive = activeTool === tool.id;
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => {
              onToolSelect(tool.id as Tool);
              onClick?.();
            }}
            data-testid={`button-tool-${tool.id}`}
            className={cn(
              "flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-all w-full text-left",
              isActive
                ? isMarkup
                  ? "bg-accent font-medium ring-1"
                  : "bg-primary/10 text-primary font-medium"
                : "hover:bg-accent/60 text-foreground/80 hover:text-foreground"
            )}
            style={isActive && isMarkup ? { borderColor: markupColor, outlineColor: markupColor } : undefined}
          >
            <Icon className="w-3.5 h-3.5 shrink-0" />
            <span className="flex-1 truncate">{tool.label}</span>
            {tool.shortcut && (
              <kbd className="px-1 py-0.5 text-[9px] font-mono bg-muted/60 rounded border ml-auto opacity-60">{tool.shortcut}</kbd>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right"><span>{tool.label}</span></TooltipContent>
      </Tooltip>
    );
  };

  const TinyBtn = ({ icon: Icon, label, active, onClick, disabled, testId, className: extraClass }: {
    icon: any; label: string; active?: boolean; onClick: () => void; disabled?: boolean; testId: string; className?: string;
  }) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={active ? "secondary" : "ghost"}
          size="icon"
          onClick={onClick}
          disabled={disabled}
          data-testid={testId}
          className={cn("h-7 w-7", extraClass)}
        >
          <Icon className="w-3.5 h-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right"><span>{label}</span></TooltipContent>
    </Tooltip>
  );

  return (
    <div className="relative z-30 h-full">
      <div className="hidden sm:flex w-[65px] h-full bg-card/95 backdrop-blur-sm border-r flex-col items-center py-1 gap-px shrink-0 overflow-y-auto overflow-x-hidden">

        {navTools.map(tool => {
          const Icon = tool.icon;
          const isActive = activeTool === tool.id;
          return (
            <Tooltip key={tool.id}>
              <TooltipTrigger asChild>
                <Button
                  variant={isActive ? (tool.color as any) : "ghost"}
                  size="icon"
                  onClick={() => onToolSelect(tool.id as Tool)}
                  data-testid={`button-tool-${tool.id}`}
                  className={cn("h-7 w-7", isActive && "ring-1 ring-primary/30")}
                >
                  <Icon className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">
                <div className="flex items-center gap-2">
                  <span>{tool.label}</span>
                  {tool.shortcut && <kbd className="px-1 py-0.5 text-[10px] font-mono bg-muted rounded border">{tool.shortcut}</kbd>}
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}

        <div className="flex items-center gap-px">
          <TinyBtn icon={ZoomIn} label="Zoom In" onClick={() => setStageScale((p: number) => Math.min(p * 1.2, 10))} testId="button-zoom-in" />
          <TinyBtn icon={ZoomOut} label="Zoom Out" onClick={() => setStageScale((p: number) => Math.max(p / 1.2, 0.1))} testId="button-zoom-out" />
        </div>
        <button
          onClick={() => setStageScale(1)}
          className="text-[9px] font-mono text-muted-foreground hover:text-foreground transition-colors cursor-pointer tabular-nums py-px"
          data-testid="button-zoom-reset"
        >
          {zoomPercent}%
        </button>
        {onFitToPage && (
          <TinyBtn icon={Maximize2} label="Fit to Page" onClick={onFitToPage} testId="button-fit-to-page-toolbar" />
        )}

        <Separator className="my-px w-8" />

        <Popover open={measureOpen} onOpenChange={setMeasureOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button
                  variant={activeMeasureTool ? "default" : "ghost"}
                  size="icon"
                  data-testid="button-measure-group"
                  className={cn("h-8 w-8 relative", activeMeasureTool && "ring-1 ring-primary/30")}
                >
                  {activeMeasureTool ? (() => { const AI = activeMeasureTool.icon; return <AI className="w-4 h-4" />; })() : <Ruler className="w-4 h-4" />}
                  <ChevronDown className="w-2 h-2 absolute bottom-0 right-0 opacity-50" />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="right"><span>{activeMeasureTool ? activeMeasureTool.label : "Measure Tools"}</span></TooltipContent>
          </Tooltip>
          <PopoverContent side="right" align="start" className="w-[200px] p-1.5 z-[100]" sideOffset={4}>
            <div className="flex flex-col gap-px">
              <span className="text-[9px] font-semibold text-muted-foreground px-2 py-1 uppercase tracking-wider">Measure</span>
              {measureTools.map(tool => (
                <SmallToolBtn key={tool.id} tool={tool} onClick={() => setMeasureOpen(false)} />
              ))}
            </div>
          </PopoverContent>
        </Popover>

        <Popover open={markupOpen} onOpenChange={setMarkupOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button
                  variant={activeMarkupTool ? "secondary" : "ghost"}
                  size="icon"
                  data-testid="button-markup-group"
                  className={cn("h-8 w-8 relative", activeMarkupTool && "ring-1")}
                  style={activeMarkupTool ? { outlineColor: markupColor } : undefined}
                >
                  {activeMarkupTool ? (() => { const AI = activeMarkupTool.icon; return <AI className="w-4 h-4" />; })() : <Pen className="w-4 h-4" />}
                  <ChevronDown className="w-2 h-2 absolute bottom-0 right-0 opacity-50" />
                  {isMarkupTool && (
                    <span className="absolute top-0 right-0 w-2 h-2 rounded-full border border-card" style={{ backgroundColor: markupColor }} />
                  )}
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="right"><span>{activeMarkupTool ? activeMarkupTool.label : "Markup Tools"}</span></TooltipContent>
          </Tooltip>
          <PopoverContent side="right" align="start" className="w-[280px] p-1.5 z-[100]" sideOffset={4}>
            <div className="flex flex-col gap-1">
              <span className="text-[9px] font-semibold text-muted-foreground px-2 py-1 uppercase tracking-wider">Markup</span>
              {/* Task #1631 — shared toolbar so bid-side and project-side
                  markup controls have identical icons, defaults, color
                  swatches, thickness presets, and selected-state styling. */}
              <PlanMarkupToolbar
                activeTool={TOOL_TO_MARKUP[activeTool] ?? null}
                onChangeTool={(t) => {
                  // Null = toggle off / cancel. Takeoff has no "no tool"
                  // state, so fall back to its existing select tool.
                  const next: Tool = t == null ? "select" : MARKUP_TO_TOOL[t];
                  onToolSelect(next);
                  setMarkupOpen(false);
                }}
                color={markupColor}
                onChangeColor={setMarkupColor}
                thickness={markupThickness}
                onChangeThickness={setMarkupThickness}
                showLabel={false}
                showSelect={false}
                labeled={labeled}
                className="border-0 bg-transparent px-1 py-1"
                // Task #1742 — markup body moves now flow through the
                // unified `useTakeoffHistory` stack via the sidebar
                // Undo/Redo buttons and the bubble-phase Cmd/Ctrl+Z
                // handler in `useTakeoffInteractions`, so the popover
                // no longer wires its own `onUndoLastMove`. The shared
                // `<PlanMarkupToolbar>` hides the button entirely when
                // the prop is omitted.
              />
            </div>
          </PopoverContent>
        </Popover>

        {issueTools.map(tool => {
          const Icon = tool.icon;
          const isActive = activeTool === tool.id;
          return (
            <Tooltip key={tool.id}>
              <TooltipTrigger asChild>
                <Button variant={isActive ? (tool.color as any) : "ghost"} size="icon" onClick={() => onToolSelect(tool.id as Tool)} data-testid={`button-tool-${tool.id}`} className={cn("h-7 w-7", isActive && "ring-1")}>
                  <Icon className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right"><span>{tool.label}</span></TooltipContent>
            </Tooltip>
          );
        })}

        <Separator className="my-px w-8" />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={selectedMeasurementId ? "destructive" : "ghost"}
              size="icon"
              onClick={() => { const m = measurements.find(m => m.id === selectedMeasurementId); if (m) onDeleteMeasurement(m); }}
              disabled={!selectedMeasurementId || deletePending}
              data-testid="button-clear-selected"
              className="h-7 w-7"
            >
              <Eraser className="w-3.5 h-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right"><span>{selectedMeasurementId ? "Delete Selected" : "Select to delete"}</span></TooltipContent>
        </Tooltip>
        <div className="flex items-center gap-px">
          <TinyBtn icon={Undo2} label="Undo (Ctrl+Z)" onClick={() => takeoffHistory.undo()} disabled={!takeoffHistory.canUndo || takeoffHistory.isPending} testId="button-undo" />
          <TinyBtn icon={Redo2} label="Redo (Ctrl+Y)" onClick={() => takeoffHistory.redo()} disabled={!takeoffHistory.canRedo || takeoffHistory.isPending} testId="button-redo" />
        </div>

        <Separator className="my-px w-8" />

        <div className="flex items-center gap-px">
          <TinyBtn icon={Magnet} label={snapEnabled ? "Snap: ON" : "Snap: OFF"} active={snapEnabled} onClick={() => setSnapEnabled(!snapEnabled)} testId="button-toggle-snap" />
          <TinyBtn icon={CornerDownRight} label={orthoLock ? "Ortho: ON" : "Ortho: OFF"} active={orthoLock} onClick={() => setOrthoLock(!orthoLock)} testId="button-toggle-ortho" />
        </div>

        <TinyBtn
          icon={Sparkles}
          label="AI Auto-Takeoff"
          active={aiPanelOpen}
          onClick={() => setAiPanelOpen(!aiPanelOpen)}
          testId="button-ai-takeoff"
          className={cn(aiPanelOpen && "bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300")}
        />
        {hasDivisionOverlays && (() => {
          const thresholdBadge =
            confidenceThreshold === "HIGH" ? "HIGH only"
            : confidenceThreshold === "MEDIUM" ? "MED+"
            : confidenceThreshold === "LOW" ? "LOW+"
            : null;
          return (
            <div className="relative" data-testid="division-overlays-wrapper">
              <TinyBtn
                icon={PanelRight}
                label={
                  thresholdBadge
                    ? `Division Overlays — ${thresholdBadge}`
                    : divisionFilterOpen ? "Division Overlays (open)" : "Division Overlays"
                }
                active={!!divisionFilterOpen}
                onClick={() => onToggleDivisionFilter?.()}
                testId="button-division-overlays"
                className={cn(divisionFilterOpen && "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300")}
              />
              {thresholdBadge && (
                <span
                  className="pointer-events-none absolute -bottom-0.5 left-1/2 -translate-x-1/2 rounded-sm bg-blue-600 px-0.5 text-[7px] font-bold leading-tight text-white"
                  data-testid="confidence-threshold-badge"
                >
                  {thresholdBadge}
                </span>
              )}
            </div>
          );
        })()}

        <Separator className="my-px w-8" />

        <div className="flex items-center gap-px">
          <TinyBtn icon={RotateCw} label="Rotate CW" onClick={onRotateCW} testId="button-rotate-cw" />
          <TinyBtn icon={RotateCcw} label="Rotate CCW" onClick={onRotateCCW} testId="button-rotate-ccw" />
        </div>
        <div className="flex items-center gap-px">
          <TinyBtn icon={FlipVertical2} label="Rotate 180°" onClick={onRotate180} testId="button-rotate-180" />
          <TinyBtn icon={Grid3X3} label={!isCalibrated ? "Calibrate first" : gridEnabled ? "Grid: ON" : "Grid: OFF"} active={gridEnabled} onClick={() => onToggleGrid(!gridEnabled)} disabled={!isCalibrated} testId="button-toggle-grid" />
          <TinyBtn icon={Tag} label={showMeasurementLabels ? "Labels: ON" : "Labels: OFF"} active={!!showMeasurementLabels} onClick={() => onToggleMeasurementLabels?.(!showMeasurementLabels)} testId="button-toggle-labels" />
          <TinyBtn icon={LayoutGrid} label={showStructuralGridlines ? "Gridlines: ON" : "Gridlines: OFF"} active={!!showStructuralGridlines} onClick={() => onToggleStructuralGridlines?.(!showStructuralGridlines)} testId="button-toggle-structural-gridlines" />
        </div>
        <div className="flex items-center gap-px">
          <TinyBtn icon={Upload} label="Import Plan" onClick={onUpload} testId="button-upload-plan" />
          {(onExportCurrentSheet || onExportAllSheets) && (
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" data-testid="button-export-excel" className="h-7 w-7">
                      <Download className="w-3.5 h-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="right"><span>Export</span></TooltipContent>
              </Tooltip>
              <DropdownMenuContent side="right" className="z-[100]">
                {onExportCurrentSheet && (
                  <DropdownMenuItem onClick={onExportCurrentSheet} disabled={measurements.length === 0} data-testid="button-export-current-sheet">
                    <FileSpreadsheet className="w-3.5 h-3.5 mr-2" />Current Sheet
                  </DropdownMenuItem>
                )}
                {onExportAllSheets && (
                  <DropdownMenuItem onClick={onExportAllSheets} data-testid="button-export-all-sheets">
                    <FileSpreadsheet className="w-3.5 h-3.5 mr-2" />All Sheets
                  </DropdownMenuItem>
                )}
                {onExportQuantityDelta && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={onExportQuantityDelta} data-testid="button-export-qty-delta">
                      <BarChart3 className="w-3.5 h-3.5 mr-2" />Quantity Delta Report
                    </DropdownMenuItem>
                  </>
                )}
                {onExportBidPackage && (
                  <DropdownMenuItem onClick={onExportBidPackage} data-testid="button-export-bid-package">
                    <Download className="w-3.5 h-3.5 mr-2" />Bid Package Export
                  </DropdownMenuItem>
                )}
                {onPrintSheet && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={onPrintSheet} disabled={measurements.length === 0} data-testid="button-print-sheet">
                      <Printer className="w-3.5 h-3.5 mr-2" />Print Sheet
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <div className="mt-auto pt-1">
          {isOffline && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center justify-center h-7 w-7 rounded text-yellow-600 dark:text-yellow-400" data-testid="indicator-offline-desktop">
                  <WifiOff className="w-3.5 h-3.5" />
                </div>
              </TooltipTrigger>
              <TooltipContent side="right">Offline — changes queued</TooltipContent>
            </Tooltip>
          )}
          <TinyBtn icon={HelpCircle} label="Shortcuts (?)" onClick={() => onShowShortcuts?.()} testId="button-shortcuts" />
        </div>
      </div>

      <div className="sm:hidden bg-card/90 backdrop-blur-sm border-t px-3 py-1 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          <span className="text-xs font-medium text-foreground">
            {TOOL_CONFIG.find(t => t.id === activeTool)?.label || "Select"}
          </span>
        </div>
        <span className="text-xs text-muted-foreground">
          {isDrawing && (activeTool === "area" || activeTool === "volume" || activeTool === "pitched_area" || activeTool === "surface_area")
            ? `${drawingPoints.length} pts — Double-tap to close`
            : isDrawing && (activeTool === "linear" || activeTool === "pitched_linear" || activeTool === "linear_with_drop")
            ? `${drawingPoints.length}/2 pts — Tap to place`
            : isDrawing && activeTool === "segment"
            ? `${drawingPoints.length} pts — Double-tap to finish`
            : isDrawing && activeTool === "arc"
            ? `${drawingPoints.length}/3 pts — Tap to place`
            : activeTool === "calibrate"
            ? "Tap 2 known-distance points"
            : activeTool === "pan"
            ? "Drag to pan • Pinch to zoom"
            : activeTool === "select"
            ? "Tap measurement to select"
            : "Tap to place points"}
        </span>
      </div>

      <div
        className="sm:hidden bg-card border-t flex items-center gap-1 px-2 py-1.5 overflow-x-auto shrink-0"
        data-testid="takeoff-toolbar-mobile"
      >
        {TOOL_CONFIG.map((tool) => {
          const Icon = tool.icon;
          return (
            <div key={tool.id} className="contents">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant={activeTool === tool.id ? tool.color as any : "ghost"} size="icon" onClick={() => onToolSelect(tool.id as Tool)} data-testid={`button-tool-mobile-${tool.id}`} className="h-8 w-8 shrink-0">
                    <Icon className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">{tool.label}</TooltipContent>
              </Tooltip>
              {tool.id === "pan" && (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" onClick={() => setStageScale((prev: number) => Math.min(prev * 1.2, 10))} data-testid="button-zoom-in-mobile" className="h-8 w-8 shrink-0">
                        <ZoomIn className="w-4 h-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">Zoom In</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" onClick={() => setStageScale((prev: number) => Math.max(prev / 1.2, 0.1))} data-testid="button-zoom-out-mobile" className="h-8 w-8 shrink-0">
                        <ZoomOut className="w-4 h-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">Zoom Out</TooltipContent>
                  </Tooltip>
                </>
              )}
            </div>
          );
        })}
        <Separator orientation="vertical" className="h-6 mx-0.5" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant={selectedMeasurementId ? "destructive" : "ghost"} size="icon" onClick={() => { const m = measurements.find(m => m.id === selectedMeasurementId); if (m) onDeleteMeasurement(m); }} disabled={!selectedMeasurementId || deletePending} data-testid="button-clear-selected-mobile" className="h-8 w-8 shrink-0">
              <Eraser className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Delete Selected</TooltipContent>
        </Tooltip>
        <Separator orientation="vertical" className="h-6 mx-0.5" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={() => takeoffHistory.undo()} disabled={!takeoffHistory.canUndo || takeoffHistory.isPending} data-testid="button-undo-mobile" className="h-8 w-8 shrink-0">
              <Undo2 className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Undo</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={() => takeoffHistory.redo()} disabled={!takeoffHistory.canRedo || takeoffHistory.isPending} data-testid="button-redo-mobile" className="h-8 w-8 shrink-0">
              <Redo2 className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Redo</TooltipContent>
        </Tooltip>
        <Separator orientation="vertical" className="h-6 mx-0.5" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant={snapEnabled ? "secondary" : "ghost"} size="icon" onClick={() => setSnapEnabled(!snapEnabled)} data-testid="button-toggle-snap-mobile" className="h-8 w-8 shrink-0">
              <Magnet className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Toggle Snap</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant={orthoLock ? "secondary" : "ghost"} size="icon" onClick={() => setOrthoLock(!orthoLock)} data-testid="button-toggle-ortho-mobile" className="h-8 w-8 shrink-0">
              <CornerDownRight className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Toggle Ortho Lock</TooltipContent>
        </Tooltip>
        <Separator orientation="vertical" className="h-6 mx-0.5" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant={mobileMeasurementsOpen ? "secondary" : "ghost"} size="icon" onClick={() => setMobileMeasurementsOpen(true)} data-testid="button-measurements-mobile" className="h-8 w-8 shrink-0 relative">
              <Layers className="w-4 h-4" />
              {measurements.length > 0 && (
                <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                  {measurements.length}
                </span>
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Measurements ({measurements.length})</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={onUpload} data-testid="button-upload-plan-mobile" className="h-8 w-8 shrink-0">
              <Upload className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Upload Plan</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant={aiPanelOpen ? "secondary" : "ghost"} size="icon" onClick={() => setAiPanelOpen(!aiPanelOpen)} data-testid="button-ai-takeoff-mobile" className="h-8 w-8 shrink-0">
              <Sparkles className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">AI Auto-Takeoff</TooltipContent>
        </Tooltip>
        <Separator orientation="vertical" className="h-6 mx-0.5" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={onRotateCW} data-testid="button-rotate-cw-mobile" className="h-8 w-8 shrink-0">
              <RotateCw className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Rotate 90° CW</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={onRotateCCW} data-testid="button-rotate-ccw-mobile" className="h-8 w-8 shrink-0">
              <RotateCcw className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Rotate 90° CCW</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={gridEnabled ? "secondary" : "ghost"}
              size="icon"
              onClick={() => onToggleGrid(!gridEnabled)}
              disabled={!isCalibrated}
              data-testid="button-toggle-grid-mobile"
              className="h-8 w-8 shrink-0"
            >
              <Grid3X3 className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">{!isCalibrated ? "Calibrate to enable grid" : gridEnabled ? "Grid: ON" : "Grid: OFF"}</TooltipContent>
        </Tooltip>
        {(onExportCurrentSheet || onExportAllSheets) && (
          <>
            <Separator orientation="vertical" className="h-6 mx-0.5" />
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" data-testid="button-export-excel-mobile" className="h-8 w-8 shrink-0">
                      <Download className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="top">Export to Excel</TooltipContent>
              </Tooltip>
              <DropdownMenuContent>
                {onExportCurrentSheet && (
                  <DropdownMenuItem onClick={onExportCurrentSheet} disabled={measurements.length === 0} data-testid="button-export-current-sheet-mobile">
                    Current Sheet Only
                  </DropdownMenuItem>
                )}
                {onExportAllSheets && (
                  <DropdownMenuItem onClick={onExportAllSheets} data-testid="button-export-all-sheets-mobile">
                    All Sheets
                  </DropdownMenuItem>
                )}
                {onExportQuantityDelta && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={onExportQuantityDelta} data-testid="button-export-qty-delta-mobile">
                      Quantity Delta Report
                    </DropdownMenuItem>
                  </>
                )}
                {onExportBidPackage && (
                  <DropdownMenuItem onClick={onExportBidPackage} data-testid="button-export-bid-package-mobile">
                    Bid Package Export
                  </DropdownMenuItem>
                )}
                {onPrintSheet && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={onPrintSheet} disabled={measurements.length === 0} data-testid="button-print-sheet-mobile">
                      Print Sheet
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
        {isOffline && (
          <>
            <Separator orientation="vertical" className="h-6 mx-0.5" />
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1 px-2 py-1 rounded bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 text-xs font-medium" data-testid="indicator-offline">
                  <WifiOff className="w-3.5 h-3.5" />
                  <span>Offline</span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="top">Changes are queued and will sync when back online</TooltipContent>
            </Tooltip>
          </>
        )}
      </div>
    </div>
  );
}
