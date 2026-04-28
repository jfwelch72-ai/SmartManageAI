import { memo, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from "react";
import {
  Layers, Link2, Pencil, Search, Sparkles, Tag, Trash2, Upload, Ruler, Users, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { QuantityCategory, TakeoffCondition, TakeoffMeasurement, TakeoffSheet } from "@shared/schema";
import { TOOL_CONFIG, type Tool } from "../types";
import { MarkupTextInput } from "../../markups/MarkupTextInput";
import { LiveCostPanel } from "../LiveCostPanel";

export interface CanvasViewportCreateLinkMode {
  step: "select-area" | "select-target";
  startPoint?: { x: number; y: number };
  endPoint?: { x: number; y: number };
}

export interface CanvasViewportContextMenuPos {
  x: number;
  y: number;
  canvasX: number;
  canvasY: number;
}

export interface CanvasViewportMeasurementContextMenu {
  x: number;
  y: number;
  measurementId: string;
}

export interface CanvasViewportProps {
  containerRef: RefObject<HTMLDivElement>;
  cursor: string;
  onContextMenu: (e: ReactMouseEvent<HTMLDivElement>) => void;
  onClick: () => void;

  selectedSheet: string | null;

  // calibration banner
  calibrationMode: "idle" | "first-point" | "second-point";

  // mobile drawing bar
  isDrawing: boolean;
  isMobile: boolean;
  drawingPoints: Array<{ x: number; y: number }>;
  activeTool: Tool;
  activeCondition: TakeoffCondition | null | undefined;

  // mobile gesture guide
  showMobileGestureGuide: boolean;
  onDismissGestureGuide: () => void;

  // mobile FAB tools
  showMobileToolPicker: boolean;
  onToggleMobileToolPicker: () => void;
  onSelectMobileTool: (tool: Tool) => void;

  // sheet tabs bar
  openSheetIds: string[];
  sheets: TakeoffSheet[];
  onSelectSheet: (id: string) => void;
  onCloseSheetTab: (sheetId: string, e: ReactMouseEvent) => void;

  // status bar (inner)
  stageScale: number;
  currentSheet: TakeoffSheet | null | undefined;
  snapEnabled: boolean;
  orthoLock: boolean;
  gridEnabled: boolean;

  // condition quick bar
  conditions: TakeoffCondition[];
  onActivateCondition: (c: TakeoffCondition) => void;

  // Tool Chest drag-drop (Task #2139). Fires when a chest item is
  // dropped onto the canvas surface — workspace handler activates the
  // referenced tool/condition/assembly. `null` for orchestrators that
  // don't wire chest support.
  onChestItemDrop?: ((e: ReactDragEvent<HTMLDivElement>) => void) | null;

  // empty state
  onOpenUploadDialog: () => void;

  // markup text input
  markupTextInput: { x: number; y: number; value: string } | null;
  pdfImageWidth: number;
  pdfImageHeight: number;
  sheetRotation: number;
  stagePosition: { x: number; y: number };
  workspaceRef: RefObject<HTMLDivElement>;
  onMarkupTextSubmit: (text: string) => void;
  onMarkupTextCancel: () => void;

  // create link panel
  createLinkMode: CanvasViewportCreateLinkMode | null;
  createLinkTargetSheet: string | null;
  onCreateLinkTargetChange: (val: string) => void;
  onCancelCreateLink: () => void;
  onCancelCreateLinkTarget: () => void;

  // canvas context menu
  contextMenuPos: CanvasViewportContextMenuPos | null;
  onContextMenuCreateLink: () => void;
  onContextMenuDetectLinks: () => void;

  // measurement context menu
  measurementContextMenu: CanvasViewportMeasurementContextMenu | null;
  measurements: TakeoffMeasurement[];
  onMeasurementContextEdit: (measurement: TakeoffMeasurement) => void;
  onMeasurementContextProperties: (measurement: TakeoffMeasurement) => void;
  onMeasurementContextDelete: (measurement: TakeoffMeasurement) => void;

  // live cost panel
  categories: QuantityCategory[];
  showCostPanel: boolean;
  onCloseCostPanel: () => void;

  // overlay opacity slider
  showOverlaySlider: boolean;
  overlayOpacity: number;
  onOverlayOpacityChange: (v: number) => void;
  onCloseOverlaySlider: () => void;

  // stage slot
  stageSlot: ReactNode;
}

function CanvasViewportInner(props: CanvasViewportProps) {
  const {
    containerRef, cursor, onContextMenu, onClick, selectedSheet,
    calibrationMode, isDrawing, isMobile, drawingPoints, activeTool, activeCondition,
    showMobileGestureGuide, onDismissGestureGuide,
    showMobileToolPicker, onToggleMobileToolPicker, onSelectMobileTool,
    openSheetIds, sheets, onSelectSheet, onCloseSheetTab,
    stageScale, currentSheet, snapEnabled, orthoLock, gridEnabled,
    conditions, onActivateCondition, onChestItemDrop, onOpenUploadDialog,
    markupTextInput, pdfImageWidth, pdfImageHeight, sheetRotation, stagePosition,
    workspaceRef, onMarkupTextSubmit, onMarkupTextCancel,
    createLinkMode, createLinkTargetSheet, onCreateLinkTargetChange,
    onCancelCreateLink, onCancelCreateLinkTarget,
    contextMenuPos, onContextMenuCreateLink, onContextMenuDetectLinks,
    measurementContextMenu, measurements,
    onMeasurementContextEdit, onMeasurementContextProperties, onMeasurementContextDelete,
    categories, showCostPanel, onCloseCostPanel,
    showOverlaySlider, overlayOpacity, onOverlayOpacityChange, onCloseOverlaySlider,
    stageSlot,
  } = props;

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-hidden relative"
      style={{ cursor }}
      data-testid="takeoff-canvas-viewport"
      onContextMenu={onContextMenu}
      onClick={onClick}
      onDragOver={onChestItemDrop ? (e) => {
        // Accept the chest MIME so the cursor flips to "copy" and the
        // drop fires. Only mounting when the workspace wired a handler
        // so other DnD use-cases stay untouched.
        if (e.dataTransfer.types.includes("application/x-takeoff-chest-item+json")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }
      } : undefined}
      onDrop={onChestItemDrop ? (e) => {
        if (e.dataTransfer.types.includes("application/x-takeoff-chest-item+json")) {
          e.preventDefault();
          onChestItemDrop(e);
        }
      } : undefined}
    >
      {calibrationMode !== "idle" && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 bg-primary text-primary-foreground px-4 py-2 rounded-full shadow-lg text-sm font-medium flex items-center gap-2 pointer-events-none" data-testid="calibration-mode-banner">
          <span className="inline-block w-2 h-2 rounded-full bg-primary-foreground animate-pulse" />
          {calibrationMode === "first-point" ? "Click first point on a known distance" : "Click second point to complete"}
        </div>
      )}
      {isDrawing && isMobile && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 bg-card/95 backdrop-blur-sm rounded-xl shadow-lg border px-3 py-2" data-testid="mobile-drawing-bar">
          <div className="flex items-center gap-1.5 pr-2 border-r">
            <div className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs font-medium">{drawingPoints.length} pts</span>
          </div>
          {drawingPoints.length > 0 && (
            <button
              onClick={() => {
                const event = new KeyboardEvent("keydown", { key: "Backspace" });
                window.dispatchEvent(event);
              }}
              className="px-3 py-1.5 bg-amber-500/20 text-amber-700 dark:text-amber-300 rounded-lg text-xs font-medium active:scale-95 transition-transform"
              data-testid="mobile-undo-point"
            >
              Undo
            </button>
          )}
          {(activeTool === "area" || activeTool === "volume" || activeTool === "pitched_area" || activeTool === "surface_area" || activeTool === "segment") && drawingPoints.length >= (activeTool === "segment" ? 2 : 3) && (
            <button
              onClick={() => {
                const event = new KeyboardEvent("keydown", { key: "Enter" });
                window.dispatchEvent(event);
              }}
              className="px-3 py-1.5 bg-green-500/20 text-green-700 dark:text-green-300 rounded-lg text-xs font-medium active:scale-95 transition-transform"
              data-testid="mobile-close-polygon"
            >
              Close
            </button>
          )}
          <button
            onClick={() => {
              const event = new KeyboardEvent("keydown", { key: "Escape" });
              window.dispatchEvent(event);
            }}
            className="px-3 py-1.5 bg-red-500/20 text-red-700 dark:text-red-300 rounded-lg text-xs font-medium active:scale-95 transition-transform"
            data-testid="mobile-cancel-draw"
          >
            Cancel
          </button>
          {activeCondition && (
            <div className="flex items-center gap-1 pl-2 border-l">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: activeCondition.color || "#2563eb" }} />
              <span className="text-[10px] text-muted-foreground truncate max-w-[60px]">{activeCondition.name}</span>
            </div>
          )}
        </div>
      )}
      {isMobile && showMobileGestureGuide && selectedSheet && !isDrawing && (
        <div className="absolute inset-0 z-50 bg-black/60 flex items-center justify-center" data-testid="mobile-gesture-guide">
          <div className="bg-card rounded-xl shadow-2xl p-5 mx-4 max-w-sm space-y-4">
            <h3 className="text-sm font-bold text-center">Touch Gestures</h3>
            <div className="space-y-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center shrink-0">
                  <span className="text-lg">👆</span>
                </div>
                <div><span className="font-medium text-foreground">Tap</span> — Place measurement points or select items</div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center shrink-0">
                  <span className="text-lg">🤏</span>
                </div>
                <div><span className="font-medium text-foreground">Pinch</span> — Zoom in/out on the plan</div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center shrink-0">
                  <span className="text-lg">👆👆</span>
                </div>
                <div><span className="font-medium text-foreground">Double-tap</span> — Complete polygon or close shape</div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center shrink-0">
                  <span className="text-lg">☝️</span>
                </div>
                <div><span className="font-medium text-foreground">One-finger drag</span> — Pan the drawing</div>
              </div>
            </div>
            <button
              onClick={onDismissGestureGuide}
              className="w-full py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium active:scale-95 transition-transform"
              data-testid="dismiss-gesture-guide"
            >
              Got it
            </button>
          </div>
        </div>
      )}
      {isMobile && !isDrawing && selectedSheet && (
        <div className="absolute bottom-4 right-4 z-40" data-testid="mobile-fab-tools">
          {showMobileToolPicker && (
            <div className="absolute bottom-14 right-0 bg-card/95 backdrop-blur-sm rounded-xl shadow-lg border p-2 grid grid-cols-3 gap-1.5 min-w-[180px] animate-in fade-in slide-in-from-bottom-2 duration-200">
              {[
                { id: "linear" as const, label: "Line", icon: "📏" },
                { id: "area" as const, label: "Area", icon: "⬜" },
                { id: "volume" as const, label: "Vol", icon: "📦" },
                { id: "count" as const, label: "Count", icon: "🔢" },
                { id: "segment" as const, label: "Seg", icon: "📐" },
                { id: "arc" as const, label: "Arc", icon: "⌒" },
              ].map(tool => (
                <button
                  key={tool.id}
                  onClick={() => onSelectMobileTool(tool.id)}
                  className={cn(
                    "flex flex-col items-center gap-0.5 p-2 rounded-lg text-[10px] active:scale-95 transition-all",
                    activeTool === tool.id ? "bg-primary/20 text-primary font-bold" : "hover:bg-accent"
                  )}
                  data-testid={`mobile-tool-${tool.id}`}
                >
                  <span className="text-base">{tool.icon}</span>
                  <span>{tool.label}</span>
                </button>
              ))}
            </div>
          )}
          <button
            onClick={onToggleMobileToolPicker}
            className="w-12 h-12 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center active:scale-90 transition-transform"
            data-testid="mobile-fab-button"
          >
            <span className="text-xl">{activeTool === "linear" ? "📏" : activeTool === "area" ? "⬜" : activeTool === "count" ? "🔢" : "✏️"}</span>
          </button>
        </div>
      )}
      {openSheetIds.length > 0 && (
        <div className="absolute top-2 left-2 right-2 z-20 flex items-center gap-0.5 bg-card/95 backdrop-blur-sm rounded-md shadow-sm border px-1 py-0.5 overflow-x-auto no-scrollbar" data-testid="sheet-tabs-bar">
          {openSheetIds
            .map((id) => sheets.find((s: TakeoffSheet) => s.id === id))
            .filter((s): s is TakeoffSheet => Boolean(s))
            .map((s, idx) => {
              const isActive = selectedSheet === s.id;
              return (
                <div
                  key={s.id}
                  onClick={() => onSelectSheet(s.id)}
                  className={cn(
                    "group flex items-center gap-1 pl-2 pr-1 py-1 rounded text-[11px] font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors border",
                    isActive
                      ? "bg-background text-foreground border-border shadow-sm"
                      : "bg-transparent text-muted-foreground border-transparent hover:text-foreground hover:bg-accent/50"
                  )}
                  title={s.sheetName || `Sheet ${idx + 1}`}
                  data-testid={`tab-sheet-${s.id}`}
                >
                  <span className="truncate inline-block max-w-[140px] align-middle">{s.sheetName || `Sheet ${idx + 1}`}</span>
                  <button
                    type="button"
                    onClick={(e) => onCloseSheetTab(s.id, e)}
                    className={cn(
                      "flex items-center justify-center w-4 h-4 rounded-sm shrink-0 transition-opacity hover:bg-muted-foreground/20",
                      isActive ? "opacity-60 hover:opacity-100" : "opacity-0 group-hover:opacity-60 hover:!opacity-100"
                    )}
                    data-testid={`button-close-tab-${s.id}`}
                    title="Close tab"
                    aria-label={`Close ${s.sheetName || `Sheet ${idx + 1}`}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
        </div>
      )}

      {selectedSheet && (
        <div className="absolute bottom-2 left-2 z-10 flex items-center gap-2 bg-card/90 backdrop-blur-sm rounded-md shadow-sm border px-2 py-1 text-[10px] text-muted-foreground" data-testid="takeoff-status-bar">
          <span className="font-mono tabular-nums" data-testid="status-zoom">{Math.round(stageScale * 100)}%</span>
          <span className="opacity-40">·</span>
          <span data-testid="status-tool">{TOOL_CONFIG.find(t => t.id === activeTool)?.label || "Select"}</span>
          {currentSheet?.scalePxPerFoot ? (
            <>
              <span className="opacity-40">·</span>
              <span className="text-emerald-600 dark:text-emerald-400 font-medium" data-testid="status-scale-ok">Calibrated</span>
            </>
          ) : (
            <>
              <span className="opacity-40">·</span>
              <span className="text-amber-600 dark:text-amber-400 font-medium" data-testid="status-scale-missing">No scale</span>
            </>
          )}
          {snapEnabled && (<><span className="opacity-40">·</span><span data-testid="status-snap">Snap</span></>)}
          {orthoLock && (<><span className="opacity-40">·</span><span data-testid="status-ortho">Ortho</span></>)}
          {gridEnabled && (<><span className="opacity-40">·</span><span data-testid="status-grid">Grid</span></>)}
        </div>
      )}

      {isDrawing && !isMobile && (
        <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 bg-card/95 backdrop-blur-sm rounded-lg shadow-lg border px-3 py-1.5" data-testid="drawing-guide-bar">
          <div className="flex items-center gap-1.5">
            <div className={cn("w-2 h-2 rounded-full animate-pulse", isDrawing ? "bg-green-500" : "bg-muted-foreground")} />
            <span className="text-[11px] font-medium">
              {activeTool === "linear" || activeTool === "linear_with_drop" || activeTool === "pitched_linear"
                ? drawingPoints.length === 0 ? "Click start point" : "Click end point · Esc cancel"
                : activeTool === "area" || activeTool === "volume" || activeTool === "pitched_area" || activeTool === "surface_area"
                ? drawingPoints.length < 3 ? `Click point ${drawingPoints.length + 1}` : `${drawingPoints.length} pts · Enter to close · Backspace undo`
                : activeTool === "segment"
                ? `${drawingPoints.length} pts · Enter to finish · Backspace undo`
                : activeTool === "count"
                ? "Click to place count"
                : "Drawing..."}
            </span>
          </div>
          {drawingPoints.length > 0 && (
            <span className="text-[10px] text-muted-foreground border-l pl-2">
              {drawingPoints.length} point{drawingPoints.length !== 1 ? "s" : ""}
            </span>
          )}
          {activeCondition && (
            <span className="text-[10px] text-muted-foreground border-l pl-2 flex items-center gap-1">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: activeCondition.color || "#2563eb" }} />
              {activeCondition.name}
            </span>
          )}
        </div>
      )}
      {isDrawing && conditions.length > 0 && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1 bg-card/95 backdrop-blur-sm rounded-lg shadow-lg border px-2 py-1.5 max-w-[80%] overflow-x-auto" data-testid="condition-quick-bar">
          {activeCondition && (
            <div className="flex items-center gap-1.5 pr-2 border-r mr-1 shrink-0">
              <div className="w-3 h-3 rounded-full border border-white/30 shrink-0" style={{ backgroundColor: activeCondition.color || "#2563eb" }} />
              <span className="text-[11px] font-semibold truncate max-w-[120px]">{activeCondition.name}</span>
            </div>
          )}
          {conditions
            .filter(c => c.id !== activeCondition?.id)
            .sort((a, b) => {
              const bKey = b.lastUsedAt ? new Date(b.lastUsedAt).toISOString() : "";
              const aKey = a.lastUsedAt ? new Date(a.lastUsedAt).toISOString() : "";
              return bKey.localeCompare(aKey);
            })
            .slice(0, 8)
            .map(c => (
              <button
                key={c.id}
                onClick={() => onActivateCondition(c)}
                className="flex items-center gap-1 px-1.5 py-1 rounded text-[10px] hover:bg-accent/80 transition-colors shrink-0"
                data-testid={`quick-condition-${c.id}`}
                title={`${c.name} (${c.measurementType})`}
              >
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: c.color || "#2563eb" }} />
                <span className="truncate max-w-[80px] text-muted-foreground">{c.name}</span>
              </button>
            ))}
        </div>
      )}
      {selectedSheet ? (
        stageSlot
      ) : (
        <div className="flex items-center justify-center h-full" data-testid="takeoff-empty-state">
          <div className="max-w-lg w-full mx-auto text-center px-8">
            <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20 flex items-center justify-center">
              <Upload className="w-10 h-10 text-primary/60" />
            </div>
            <h3 className="text-xl font-semibold text-foreground mb-2">Start Your Takeoff</h3>
            <p className="text-muted-foreground mb-6">Upload construction plans to begin measuring quantities. Supports multi-page PDFs with auto-scale detection.</p>
            <Button
              size="lg"
              onClick={onOpenUploadDialog}
              className="gap-2 mb-8"
              data-testid="button-empty-upload-area"
            >
              <Upload className="w-4 h-4" />
              Import Plan Sheets
            </Button>
            <div className="grid grid-cols-3 gap-4 text-left">
              <div className="p-3 rounded-lg bg-card border" data-testid="info-feature-measure">
                <div className="w-8 h-8 rounded-md bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mb-2">
                  <Ruler className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                </div>
                <p className="text-sm font-medium">Precise Measurement</p>
                <p className="text-xs text-muted-foreground mt-1">Linear, area, volume, count, and pitched measurements</p>
              </div>
              <div className="p-3 rounded-lg bg-card border" data-testid="info-feature-ai">
                <div className="w-8 h-8 rounded-md bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center mb-2">
                  <Sparkles className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                </div>
                <p className="text-sm font-medium">AI Auto-Takeoff</p>
                <p className="text-xs text-muted-foreground mt-1">Auto-detect symbols and quantities from blueprints</p>
              </div>
              <div className="p-3 rounded-lg bg-card border" data-testid="info-feature-collab">
                <div className="w-8 h-8 rounded-md bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-2">
                  <Users className="w-4 h-4 text-green-600 dark:text-green-400" />
                </div>
                <p className="text-sm font-medium">Live Collaboration</p>
                <p className="text-xs text-muted-foreground mt-1">Work together in real-time with your team</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {markupTextInput && (() => {
        const w = pdfImageWidth;
        const h = pdfImageHeight;
        let rx = markupTextInput.x;
        let ry = markupTextInput.y;
        switch (sheetRotation) {
          case 90: rx = markupTextInput.y; ry = w - markupTextInput.x; break;
          case 180: rx = w - markupTextInput.x; ry = h - markupTextInput.y; break;
          case 270: rx = h - markupTextInput.y; ry = markupTextInput.x; break;
        }
        const left = Math.max(4, Math.min((rx * stageScale + stagePosition.x), (workspaceRef.current?.clientWidth || 9999) - 260));
        const top = Math.max(48, Math.min((ry * stageScale + stagePosition.y), (workspaceRef.current?.clientHeight || 9999) - 80));
        return (
          <MarkupTextInput
            key={`${markupTextInput.x},${markupTextInput.y}`}
            left={left}
            top={top}
            initialValue={markupTextInput.value}
            onSubmit={onMarkupTextSubmit}
            onCancel={onMarkupTextCancel}
          />
        );
      })()}

      {createLinkMode && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-50 bg-card border rounded-lg shadow-lg px-4 py-3 flex items-center gap-3" data-testid="create-link-panel">
          {createLinkMode.step === "select-area" && (
            <>
              <Link2 className="w-4 h-4 text-blue-600" />
              <span className="text-sm font-medium">Draw rectangle on the area to create a link hotspot</span>
              <Button variant="ghost" size="sm" onClick={onCancelCreateLink} data-testid="button-cancel-create-link">
                <X className="w-4 h-4" />
              </Button>
            </>
          )}
          {createLinkMode.step === "select-target" && (
            <div className="flex items-center gap-2">
              <Link2 className="w-4 h-4 text-blue-600" />
              <span className="text-sm font-medium">Select target sheet:</span>
              <Select
                value={createLinkTargetSheet || ""}
                onValueChange={onCreateLinkTargetChange}
              >
                <SelectTrigger className="w-48" data-testid="select-link-target">
                  <SelectValue placeholder="Choose sheet..." />
                </SelectTrigger>
                <SelectContent>
                  {sheets.filter((s: TakeoffSheet) => s.id !== selectedSheet).map((s: TakeoffSheet) => (
                    <SelectItem key={s.id} value={s.id}>{s.sheetName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="ghost" size="sm" onClick={onCancelCreateLinkTarget} data-testid="button-cancel-link-target">
                <X className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>
      )}

      {contextMenuPos && (
        <div
          className="absolute z-50 bg-card border rounded-md shadow-lg py-1 min-w-44"
          style={{ left: contextMenuPos.x, top: contextMenuPos.y }}
          data-testid="canvas-context-menu"
        >
          <button
            className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent flex items-center gap-2"
            onClick={onContextMenuCreateLink}
            data-testid="context-menu-create-link"
          >
            <Link2 className="w-3.5 h-3.5" /> Create Link to Sheet
          </button>
          <button
            className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent flex items-center gap-2"
            onClick={onContextMenuDetectLinks}
            data-testid="context-menu-detect-links"
          >
            <Search className="w-3.5 h-3.5" /> Detect Links
          </button>
        </div>
      )}

      {measurementContextMenu && (() => {
        const ctxMeasurement = measurements.find(m => m.id === measurementContextMenu.measurementId);
        if (!ctxMeasurement) return null;
        return (
          <div
            className="absolute z-50 bg-card border rounded-md shadow-lg py-1 min-w-48"
            style={{ left: measurementContextMenu.x, top: measurementContextMenu.y }}
            data-testid="measurement-context-menu"
          >
            <div className="px-3 py-1.5 text-xs text-muted-foreground border-b mb-1 truncate max-w-56">
              {ctxMeasurement.label || "Measurement"}
            </div>
            <button
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent flex items-center gap-2"
              onClick={() => onMeasurementContextEdit(ctxMeasurement)}
              data-testid="context-menu-select-measurement"
            >
              <Pencil className="w-3.5 h-3.5" /> Edit Details
            </button>
            <button
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent flex items-center gap-2"
              onClick={() => onMeasurementContextProperties(ctxMeasurement)}
              data-testid="context-menu-properties"
            >
              <Tag className="w-3.5 h-3.5" /> Properties
            </button>
            <button
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent text-destructive flex items-center gap-2"
              onClick={() => onMeasurementContextDelete(ctxMeasurement)}
              data-testid="context-menu-delete-measurement"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
          </div>
        );
      })()}

      <LiveCostPanel
        measurements={measurements}
        categories={categories}
        visible={showCostPanel}
        onClose={onCloseCostPanel}
      />

      {showOverlaySlider && (
        <div className="absolute top-3 right-3 z-30 bg-card/95 backdrop-blur-sm border rounded-lg shadow-lg px-3 py-2 flex items-center gap-3 w-[220px]" data-testid="overlay-opacity-slider">
          <Layers className="w-4 h-4 text-muted-foreground shrink-0" />
          <input
            type="range"
            min="0"
            max="100"
            value={overlayOpacity}
            onChange={(e) => onOverlayOpacityChange(Number(e.target.value))}
            className="flex-1 accent-primary h-1.5"
            data-testid="input-overlay-opacity"
          />
          <span className="text-[10px] tabular-nums text-muted-foreground w-8 text-right">{overlayOpacity}%</span>
          <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={onCloseOverlaySlider} data-testid="button-close-overlay-slider">
            <X className="w-3 h-3" />
          </Button>
        </div>
      )}
    </div>
  );
}

export const CanvasViewport = memo(CanvasViewportInner);
CanvasViewport.displayName = "CanvasViewport";
