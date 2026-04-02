import { Fragment, useState } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  ZoomIn, ZoomOut, Eraser, Upload, Sparkles, Undo2, Redo2, Magnet, CornerDownRight, Layers, Pen, Download, HelpCircle,
  RotateCw, RotateCcw, FlipVertical2, Grid3X3, Maximize2, ChevronRight
} from "lucide-react";
import { TOOL_CONFIG, MARKUP_TOOL_IDS, type Tool } from "./types";
import type { TakeoffMeasurement } from "@shared/schema";
import type { useTakeoffHistory } from "@/hooks/use-takeoff-history";
import { cn } from "@/lib/utils";

const MARKUP_COLORS = ["#ff0000", "#ff6600", "#ffcc00", "#00cc00", "#0066ff", "#9900ff", "#ff00ff", "#00cccc"];

interface TakeoffToolbarProps {
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
  onShowShortcuts?: () => void;
  sheetRotation: number;
  onRotateCW: () => void;
  onRotateCCW: () => void;
  onRotate180: () => void;
  gridEnabled: boolean;
  onToggleGrid: (v: boolean) => void;
  isCalibrated: boolean;
  onFitToPage?: () => void;
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
  onShowShortcuts,
  sheetRotation, onRotateCW, onRotateCCW, onRotate180,
  gridEnabled, onToggleGrid, isCalibrated,
  onFitToPage,
}: TakeoffToolbarProps) {
  const isMarkupTool = MARKUP_TOOL_IDS.includes(activeTool as any);
  const zoomPercent = Math.round(stageScale * 100);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  const navTools = TOOL_CONFIG.filter(t => t.group === "nav");
  const measureTools = TOOL_CONFIG.filter(t => t.group === "measure");
  const markupTools = TOOL_CONFIG.filter(t => t.group === "markup");
  const issueTools = TOOL_CONFIG.filter(t => t.group === "issues");

  const primaryMeasureIds = ["linear", "area", "count", "volume"];
  const secondaryMeasureTools = measureTools.filter(t => !primaryMeasureIds.includes(t.id));
  const primaryMeasureTools = measureTools.filter(t => primaryMeasureIds.includes(t.id));

  const primaryMarkupIds = ["markup_arrow", "markup_freehand", "markup_text"];
  const secondaryMarkupTools = markupTools.filter(t => !primaryMarkupIds.includes(t.id));
  const primaryMarkupTools = markupTools.filter(t => primaryMarkupIds.includes(t.id));

  const ToolButton = ({ tool, isMarkup = false, compact = false }: { tool: typeof TOOL_CONFIG[number]; isMarkup?: boolean; compact?: boolean }) => {
    const Icon = tool.icon;
    const isActive = activeTool === tool.id;
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={isActive ? (isMarkup ? "secondary" : tool.color as any) : "ghost"}
            size="icon"
            onClick={() => {
              onToolSelect(tool.id as Tool);
              setExpandedGroup(null);
            }}
            data-testid={`button-tool-${tool.id}`}
            className={cn(
              "toggle-elevate relative",
              compact ? "h-8 w-8" : "h-9 w-9",
              isActive && !isMarkup && "ring-2 ring-primary/30 shadow-sm",
              isActive && isMarkup && "ring-2 shadow-sm",
            )}
            style={isActive && isMarkup ? { borderColor: markupColor, ringColor: markupColor, outline: `2px solid ${markupColor}` } : undefined}
          >
            <Icon className={compact ? "w-4 h-4" : "w-[18px] h-[18px]"} />
            {isMarkup && isActive && (
              <span className="absolute bottom-0.5 right-0.5 w-2 h-2 rounded-full border border-card" style={{ backgroundColor: markupColor }} />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">
          <div className="flex items-center gap-2">
            <span>{tool.label}</span>
            {tool.shortcut && (
              <kbd className="px-1.5 py-0.5 text-xs font-mono bg-muted rounded border">{tool.shortcut}</kbd>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    );
  };

  const GroupLabel = ({ label }: { label: string }) => (
    <span className="text-[9px] text-muted-foreground/70 font-semibold uppercase tracking-wider select-none mt-1 mb-0.5">{label}</span>
  );

  const ExpandableGroup = ({ label, primaryTools, secondaryTools, groupKey, isMarkup = false }: {
    label: string;
    primaryTools: typeof TOOL_CONFIG;
    secondaryTools: typeof TOOL_CONFIG;
    groupKey: string;
    isMarkup?: boolean;
  }) => {
    const isExpanded = expandedGroup === groupKey;
    const hasActiveSecondary = secondaryTools.some(t => activeTool === t.id);

    return (
      <>
        <GroupLabel label={label} />
        {primaryTools.map(tool => (
          <ToolButton key={tool.id} tool={tool} isMarkup={isMarkup} />
        ))}
        {secondaryTools.length > 0 && (
          <div className="relative">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={hasActiveSecondary ? "secondary" : "ghost"}
                  size="icon"
                  className={cn("toggle-elevate h-7 w-9 relative", hasActiveSecondary && "ring-1 ring-primary/20")}
                  onClick={() => setExpandedGroup(isExpanded ? null : groupKey)}
                  data-testid={`button-expand-${groupKey}`}
                >
                  <ChevronRight className={cn("w-3.5 h-3.5 transition-transform", isExpanded && "rotate-90")} />
                  {hasActiveSecondary && (
                    <span className="absolute top-0 right-0.5 w-1.5 h-1.5 rounded-full bg-primary" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">
                <span>{isExpanded ? "Collapse" : `More ${label} tools (${secondaryTools.length})`}</span>
              </TooltipContent>
            </Tooltip>
            {isExpanded && (
              <div className="absolute left-full top-0 ml-1 bg-card border rounded-lg shadow-lg p-1.5 z-50 flex flex-col gap-1 min-w-[180px]" data-testid={`flyout-${groupKey}`}>
                <span className="text-[10px] font-semibold text-muted-foreground px-2 py-1 uppercase tracking-wider">More {label}</span>
                {secondaryTools.map(tool => {
                  const Icon = tool.icon;
                  const isActive = activeTool === tool.id;
                  return (
                    <button
                      key={tool.id}
                      className={cn(
                        "flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-colors w-full text-left",
                        isActive
                          ? "bg-primary/10 text-primary font-medium"
                          : "hover:bg-accent text-foreground"
                      )}
                      onClick={() => {
                        onToolSelect(tool.id as Tool);
                        setExpandedGroup(null);
                      }}
                      data-testid={`button-tool-${tool.id}`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="flex-1">{tool.label}</span>
                      {tool.shortcut && (
                        <kbd className="px-1 py-0.5 text-[10px] font-mono bg-muted rounded border ml-auto">{tool.shortcut}</kbd>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </>
    );
  };

  return (
    <div className="relative z-30">
      {expandedGroup && (
        <div className="fixed inset-0 z-20" onClick={() => setExpandedGroup(null)} />
      )}
      <div className="hidden sm:flex w-[72px] bg-card/95 backdrop-blur-sm border-r flex-col items-center py-2 gap-0.5 overflow-y-auto scrollbar-hide shrink-0">
        <GroupLabel label="Navigate" />
        {navTools.map(tool => (
          <ToolButton key={tool.id} tool={tool} />
        ))}

        <div className="flex flex-col items-center gap-0.5 mt-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={() => setStageScale((prev: number) => Math.min(prev * 1.2, 10))} data-testid="button-zoom-in" className="toggle-elevate h-8 w-8">
                <ZoomIn className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <div className="flex items-center gap-2"><span>Zoom In</span><kbd className="px-1.5 py-0.5 text-xs font-mono bg-muted rounded border">+</kbd></div>
            </TooltipContent>
          </Tooltip>
          <button
            onClick={() => setStageScale(1)}
            className="text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors cursor-pointer tabular-nums w-full text-center py-0.5"
            data-testid="button-zoom-reset"
          >
            {zoomPercent}%
          </button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={() => setStageScale((prev: number) => Math.max(prev / 1.2, 0.1))} data-testid="button-zoom-out" className="toggle-elevate h-8 w-8">
                <ZoomOut className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <div className="flex items-center gap-2"><span>Zoom Out</span><kbd className="px-1.5 py-0.5 text-xs font-mono bg-muted rounded border">-</kbd></div>
            </TooltipContent>
          </Tooltip>
          {onFitToPage && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={onFitToPage} data-testid="button-fit-to-page" className="toggle-elevate h-8 w-8">
                  <Maximize2 className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right"><p>Fit to Page</p></TooltipContent>
            </Tooltip>
          )}
        </div>

        <Separator className="my-1 w-10" />
        <ExpandableGroup
          label="Measure"
          primaryTools={primaryMeasureTools as unknown as typeof TOOL_CONFIG}
          secondaryTools={secondaryMeasureTools as unknown as typeof TOOL_CONFIG}
          groupKey="measure"
        />

        <Separator className="my-1 w-10" />
        <ExpandableGroup
          label="Markup"
          primaryTools={primaryMarkupTools as unknown as typeof TOOL_CONFIG}
          secondaryTools={secondaryMarkupTools as unknown as typeof TOOL_CONFIG}
          groupKey="markup"
          isMarkup
        />
        {isMarkupTool && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="toggle-elevate relative h-8 w-8" data-testid="button-markup-color">
                <Pen className="w-3.5 h-3.5" />
                <span className="absolute bottom-0.5 right-0.5 w-2.5 h-2.5 rounded-full border border-card" style={{ backgroundColor: markupColor }} />
              </Button>
            </PopoverTrigger>
            <PopoverContent side="right" className="w-52 p-3">
              <div className="space-y-3">
                <Label className="text-xs font-medium">Color</Label>
                <div className="grid grid-cols-4 gap-1.5">
                  {MARKUP_COLORS.map(c => (
                    <button
                      key={c}
                      className={cn("w-8 h-8 rounded-md border-2 transition-all", markupColor === c ? "border-foreground scale-110" : "border-transparent hover:border-muted-foreground")}
                      style={{ backgroundColor: c }}
                      onClick={() => setMarkupColor(c)}
                      data-testid={`button-markup-color-${c.replace('#','')}`}
                    />
                  ))}
                </div>
                <div>
                  <Label className="text-xs">Custom Color</Label>
                  <input type="color" value={markupColor} onChange={e => setMarkupColor(e.target.value)} className="mt-1 w-full h-8 cursor-pointer rounded border" data-testid="input-markup-color-custom" />
                </div>
                <div>
                  <Label className="text-xs">Thickness: {markupThickness}px</Label>
                  <input type="range" min={1} max={10} value={markupThickness} onChange={e => setMarkupThickness(Number(e.target.value))} className="mt-1 w-full" data-testid="input-markup-thickness" />
                </div>
              </div>
            </PopoverContent>
          </Popover>
        )}

        {issueTools.length > 0 && (
          <>
            <Separator className="my-1 w-10" />
            <GroupLabel label="Issues" />
            {issueTools.map(tool => (
              <ToolButton key={tool.id} tool={tool} />
            ))}
          </>
        )}

        <Separator className="my-1 w-10" />
        <GroupLabel label="Edit" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={selectedMeasurementId ? "destructive" : "ghost"}
              size="icon"
              onClick={() => { const m = measurements.find(m => m.id === selectedMeasurementId); if (m) onDeleteMeasurement(m); }}
              disabled={!selectedMeasurementId || deletePending}
              data-testid="button-clear-selected"
              className="toggle-elevate h-9 w-9"
            >
              <Eraser className="w-[18px] h-[18px]" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right"><p>{selectedMeasurementId ? "Delete Selected" : "Select to delete"}</p></TooltipContent>
        </Tooltip>
        <div className="flex gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={() => takeoffHistory.undo()} disabled={!takeoffHistory.canUndo || takeoffHistory.isPending} data-testid="button-undo" className="toggle-elevate h-8 w-8">
                <Undo2 className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right"><div className="flex items-center gap-2"><span>Undo</span><kbd className="px-1.5 py-0.5 text-xs font-mono bg-muted rounded border">Ctrl+Z</kbd></div></TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={() => takeoffHistory.redo()} disabled={!takeoffHistory.canRedo || takeoffHistory.isPending} data-testid="button-redo" className="toggle-elevate h-8 w-8">
                <Redo2 className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right"><div className="flex items-center gap-2"><span>Redo</span><kbd className="px-1.5 py-0.5 text-xs font-mono bg-muted rounded border">Ctrl+Y</kbd></div></TooltipContent>
          </Tooltip>
        </div>

        <Separator className="my-1 w-10" />
        <GroupLabel label="Assist" />
        <div className="flex gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant={snapEnabled ? "secondary" : "ghost"} size="icon" onClick={() => setSnapEnabled(!snapEnabled)} data-testid="button-toggle-snap" className="toggle-elevate h-8 w-8">
                <Magnet className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right"><p>{snapEnabled ? "Snap: ON" : "Snap: OFF"}</p></TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant={orthoLock ? "secondary" : "ghost"} size="icon" onClick={() => setOrthoLock(!orthoLock)} data-testid="button-toggle-ortho" className="toggle-elevate h-8 w-8">
                <CornerDownRight className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right"><p>{orthoLock ? "Ortho: ON (90°)" : "Ortho: OFF"}</p></TooltipContent>
          </Tooltip>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant={aiPanelOpen ? "secondary" : "ghost"} size="icon" onClick={() => setAiPanelOpen(!aiPanelOpen)} data-testid="button-ai-takeoff" className={cn("toggle-elevate h-9 w-9", aiPanelOpen && "bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300")}>
              <Sparkles className="w-[18px] h-[18px]" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right"><p>AI Auto-Takeoff</p></TooltipContent>
        </Tooltip>

        <Separator className="my-1 w-10" />
        <GroupLabel label="View" />
        <div className="flex gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={onRotateCW} data-testid="button-rotate-cw" className="toggle-elevate h-8 w-8">
                <RotateCw className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right"><div className="flex items-center gap-2"><span>Rotate CW</span><kbd className="px-1.5 py-0.5 text-xs font-mono bg-muted rounded border">Ctrl+R</kbd></div></TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={onRotateCCW} data-testid="button-rotate-ccw" className="toggle-elevate h-8 w-8">
                <RotateCcw className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right"><div className="flex items-center gap-2"><span>Rotate CCW</span><kbd className="px-1.5 py-0.5 text-xs font-mono bg-muted rounded border">Ctrl+Shift+R</kbd></div></TooltipContent>
          </Tooltip>
        </div>
        <div className="flex gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={onRotate180} data-testid="button-rotate-180" className="toggle-elevate h-7 w-7">
                <FlipVertical2 className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right"><p>Rotate 180°</p></TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant={gridEnabled ? "secondary" : "ghost"} size="icon" onClick={() => onToggleGrid(!gridEnabled)} disabled={!isCalibrated} data-testid="button-toggle-grid" className="toggle-elevate h-7 w-7">
                <Grid3X3 className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right"><p>{!isCalibrated ? "Calibrate to enable grid" : gridEnabled ? "Grid: ON" : "Grid: OFF"}</p></TooltipContent>
          </Tooltip>
        </div>
        <div className="flex gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={onUpload} data-testid="button-upload-plan" className="toggle-elevate h-7 w-7">
                <Upload className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right"><p>Import Plan Sheet</p></TooltipContent>
          </Tooltip>
          {(onExportCurrentSheet || onExportAllSheets) && (
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" data-testid="button-export-excel" className="toggle-elevate h-7 w-7">
                      <Download className="w-3.5 h-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="right"><p>Export to Excel</p></TooltipContent>
              </Tooltip>
              <DropdownMenuContent side="right">
                {onExportCurrentSheet && (
                  <DropdownMenuItem onClick={onExportCurrentSheet} disabled={measurements.length === 0} data-testid="button-export-current-sheet">Current Sheet Only</DropdownMenuItem>
                )}
                {onExportAllSheets && (
                  <DropdownMenuItem onClick={onExportAllSheets} data-testid="button-export-all-sheets">All Sheets</DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <div className="mt-auto pt-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={() => onShowShortcuts?.()} data-testid="button-shortcuts" className="toggle-elevate h-8 w-8">
                <HelpCircle className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right"><div className="flex items-center gap-2"><span>Shortcuts</span><kbd className="px-1.5 py-0.5 text-xs font-mono bg-muted rounded border">?</kbd></div></TooltipContent>
          </Tooltip>
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

      <div className="sm:hidden bg-card border-t flex items-center gap-1 px-2 py-1.5 overflow-x-auto shrink-0">
        {TOOL_CONFIG.map((tool) => {
          const Icon = tool.icon;
          return (
            <Fragment key={tool.id}>
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
            </Fragment>
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
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>
    </div>
  );
}
