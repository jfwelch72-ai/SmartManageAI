import { Fragment } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ZoomIn, ZoomOut, Eraser, Upload, Sparkles, Undo2, Redo2, Magnet, CornerDownRight, Layers
} from "lucide-react";
import { TOOL_CONFIG, type Tool } from "./types";
import type { TakeoffMeasurement } from "@shared/schema";
import type { useTakeoffHistory } from "@/hooks/use-takeoff-history";

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
}

export function TakeoffToolbar({
  activeTool, onToolSelect, stageScale, setStageScale,
  selectedMeasurementId, measurements, onDeleteMeasurement, deletePending,
  takeoffHistory, snapEnabled, setSnapEnabled, orthoLock, setOrthoLock,
  onUpload, aiPanelOpen, setAiPanelOpen,
  mobileMeasurementsOpen, setMobileMeasurementsOpen,
  isDrawing, drawingPoints, isMobile,
}: TakeoffToolbarProps) {
  return (
    <>
      <div className="hidden sm:flex w-20 bg-card border-r flex-col items-center py-2 gap-1 overflow-y-auto scrollbar-hide shrink-0">
        {TOOL_CONFIG.map((tool) => {
          const Icon = tool.icon;
          const showSeparator = tool.id === "linear_with_drop";
          const showZoomAfter = tool.id === "pan";
          return (
            <div key={tool.id} className="flex flex-col items-center">
              {showSeparator && <Separator className="my-1 w-12" />}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={activeTool === tool.id ? tool.color as any : "ghost"}
                    size="icon"
                    onClick={() => onToolSelect(tool.id as Tool)}
                    data-testid={`button-tool-${tool.id}`}
                    className="toggle-elevate"
                  >
                    <Icon className="w-5 h-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <div className="flex items-center gap-2">
                    <span>{tool.label}</span>
                    {tool.shortcut && (
                      <kbd className="px-1.5 py-0.5 text-xs font-mono bg-muted rounded border">
                        {tool.shortcut}
                      </kbd>
                    )}
                  </div>
                </TooltipContent>
              </Tooltip>
              {showZoomAfter && (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setStageScale((prev: number) => Math.min(prev * 1.2, 10))}
                        data-testid="button-zoom-in"
                        className="toggle-elevate mt-2"
                      >
                        <ZoomIn className="w-5 h-5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      <div className="flex items-center gap-2">
                        <span>Zoom In</span>
                        <kbd className="px-1.5 py-0.5 text-xs font-mono bg-muted rounded border">+</kbd>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setStageScale((prev: number) => Math.max(prev / 1.2, 0.1))}
                        data-testid="button-zoom-out"
                        className="toggle-elevate mt-1"
                      >
                        <ZoomOut className="w-5 h-5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      <div className="flex items-center gap-2">
                        <span>Zoom Out</span>
                        <kbd className="px-1.5 py-0.5 text-xs font-mono bg-muted rounded border">-</kbd>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </>
              )}
            </div>
          );
        })}
        <Separator className="my-2 w-12" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={selectedMeasurementId ? "destructive" : "ghost"}
              size="icon"
              onClick={() => {
                const m = measurements.find(m => m.id === selectedMeasurementId);
                if (m) onDeleteMeasurement(m);
              }}
              disabled={!selectedMeasurementId || deletePending}
              data-testid="button-clear-selected"
              className="toggle-elevate"
            >
              <Eraser className="w-5 h-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>{selectedMeasurementId ? "Delete Selected" : "Select a measurement to delete"}</p>
          </TooltipContent>
        </Tooltip>
        <Separator className="my-2 w-12" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={() => takeoffHistory.undo()} disabled={!takeoffHistory.canUndo || takeoffHistory.isPending} data-testid="button-undo" className="toggle-elevate">
              <Undo2 className="w-5 h-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <div className="flex items-center gap-2"><span>Undo</span><kbd className="px-1.5 py-0.5 text-xs font-mono bg-muted rounded border">Ctrl+Z</kbd></div>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={() => takeoffHistory.redo()} disabled={!takeoffHistory.canRedo || takeoffHistory.isPending} data-testid="button-redo" className="toggle-elevate">
              <Redo2 className="w-5 h-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <div className="flex items-center gap-2"><span>Redo</span><kbd className="px-1.5 py-0.5 text-xs font-mono bg-muted rounded border">Ctrl+Y</kbd></div>
          </TooltipContent>
        </Tooltip>
        <Separator className="my-2 w-12" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant={snapEnabled ? "secondary" : "ghost"} size="icon" onClick={() => setSnapEnabled(!snapEnabled)} data-testid="button-toggle-snap" className="toggle-elevate">
              <Magnet className="w-5 h-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right"><p>{snapEnabled ? "Snap: ON" : "Snap: OFF"}</p></TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant={orthoLock ? "secondary" : "ghost"} size="icon" onClick={() => setOrthoLock(!orthoLock)} data-testid="button-toggle-ortho" className="toggle-elevate">
              <CornerDownRight className="w-5 h-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right"><p>{orthoLock ? "Ortho: ON (90°)" : "Ortho: OFF"}</p></TooltipContent>
        </Tooltip>
        <Separator className="my-2 w-12" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={onUpload} data-testid="button-upload-plan">
              <Upload className="w-5 h-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right"><p>Import Plan Sheet</p></TooltipContent>
        </Tooltip>
        <Separator className="my-2 w-12" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant={aiPanelOpen ? "secondary" : "ghost"} size="icon" onClick={() => setAiPanelOpen(!aiPanelOpen)} data-testid="button-ai-takeoff" className="toggle-elevate">
              <Sparkles className="w-5 h-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right"><p>AI Auto-Takeoff</p></TooltipContent>
        </Tooltip>
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
      </div>
    </>
  );
}
