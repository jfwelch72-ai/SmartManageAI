import { useState, useRef, useCallback, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Columns, Layers, ArrowLeft, ArrowRight, Table2, TrendingUp, TrendingDown, Minus, SplitSquareHorizontal, Diff } from "lucide-react";
import { cn } from "@/lib/utils";

interface SheetInfo {
  id: string;
  sheetName: string;
  revisionLabel?: string | null;
  isActive?: boolean;
  imageUrl?: string | null;
}

export interface QuantityCompareRow {
  category: string;
  unit: string;
  oldQty: number;
  newQty: number;
  diff: number;
  pctChange: number;
}

interface TakeoffSheetCompareDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  oldSheet: SheetInfo;
  newSheet: SheetInfo;
  allSheets: SheetInfo[];
  quantityComparison?: QuantityCompareRow[];
}

type CompareMode = "side-by-side" | "overlay" | "swipe" | "diff" | "quantity-table";

function SheetImage({ sheet, className }: { sheet: SheetInfo; className?: string }) {
  const src = sheet.imageUrl
    ? sheet.imageUrl
    : `/api/takeoff/sheets/${sheet.id}/pdf`;

  return (
    <div className={cn("flex flex-col h-full", className)}>
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 bg-muted/50 border-b">
        <span className="text-sm font-medium truncate">{sheet.sheetName}</span>
        {sheet.revisionLabel && (
          <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 shrink-0">{sheet.revisionLabel}</Badge>
        )}
        {sheet.isActive === false && (
          <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4 shrink-0 opacity-70">Superseded</Badge>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-auto bg-muted/20 flex items-center justify-center p-2">
        <img
          src={src}
          alt={sheet.sheetName}
          className="max-w-full max-h-full object-contain border rounded shadow-sm bg-white"
          data-testid={`compare-sheet-img-${sheet.id}`}
        />
      </div>
    </div>
  );
}

export function TakeoffSheetCompareDialog({
  open,
  onOpenChange,
  oldSheet,
  newSheet,
  quantityComparison,
}: TakeoffSheetCompareDialogProps) {
  const [mode, setMode] = useState<CompareMode>("side-by-side");
  const [overlayOpacity, setOverlayOpacity] = useState(50);
  const [swipePosition, setSwipePosition] = useState(50);
  const swipeContainerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  const handleSwipeMove = useCallback((clientX: number) => {
    if (!swipeContainerRef.current) return;
    const rect = swipeContainerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const pct = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setSwipePosition(pct);
  }, []);

  const handleSwipeMouseDown = useCallback(() => { isDraggingRef.current = true; }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => { if (isDraggingRef.current) handleSwipeMove(e.clientX); };
    const handleMouseUp = () => { isDraggingRef.current = false; };
    const handleTouchMove = (e: TouchEvent) => { if (isDraggingRef.current && e.touches[0]) handleSwipeMove(e.touches[0].clientX); };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("touchmove", handleTouchMove);
    window.addEventListener("touchend", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleMouseUp);
    };
  }, [handleSwipeMove]);

  const oldSrc = oldSheet.imageUrl || `/api/takeoff/sheets/${oldSheet.id}/pdf`;
  const newSrc = newSheet.imageUrl || `/api/takeoff/sheets/${newSheet.id}/pdf`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[95vw] w-[95vw] h-[90vh] flex flex-col p-0 gap-0" data-testid="dialog-compare-revisions">
        <DialogHeader className="shrink-0 px-4 py-3 border-b flex-row items-center justify-between">
          <DialogTitle className="flex items-center gap-2">
            Compare Revisions
            <span className="text-muted-foreground text-sm font-normal flex items-center gap-1">
              <span className="truncate max-w-[140px]">{oldSheet.sheetName}</span>
              {oldSheet.revisionLabel && <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">{oldSheet.revisionLabel}</Badge>}
              <ArrowRight className="w-3.5 h-3.5" />
              <span className="truncate max-w-[140px]">{newSheet.sheetName}</span>
              {newSheet.revisionLabel && <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">{newSheet.revisionLabel}</Badge>}
            </span>
          </DialogTitle>
          <div className="flex items-center gap-2 ml-auto mr-8">
            <Button
              variant={mode === "side-by-side" ? "default" : "outline"}
              size="sm"
              className="gap-1.5 h-8"
              onClick={() => setMode("side-by-side")}
              data-testid="button-compare-side-by-side"
            >
              <Columns className="w-3.5 h-3.5" /> Side by Side
            </Button>
            <Button
              variant={mode === "overlay" ? "default" : "outline"}
              size="sm"
              className="gap-1.5 h-8"
              onClick={() => setMode("overlay")}
              data-testid="button-compare-overlay"
            >
              <Layers className="w-3.5 h-3.5" /> Overlay
            </Button>
            <Button
              variant={mode === "swipe" ? "default" : "outline"}
              size="sm"
              className="gap-1.5 h-8"
              onClick={() => setMode("swipe")}
              data-testid="button-compare-swipe"
            >
              <SplitSquareHorizontal className="w-3.5 h-3.5" /> Swipe
            </Button>
            <Button
              variant={mode === "diff" ? "default" : "outline"}
              size="sm"
              className="gap-1.5 h-8"
              onClick={() => setMode("diff")}
              data-testid="button-compare-diff"
            >
              <Diff className="w-3.5 h-3.5" /> Diff
            </Button>
            {quantityComparison && quantityComparison.length > 0 && (
              <Button
                variant={mode === "quantity-table" ? "default" : "outline"}
                size="sm"
                className="gap-1.5 h-8"
                onClick={() => setMode("quantity-table")}
                data-testid="button-compare-quantity-table"
              >
                <Table2 className="w-3.5 h-3.5" /> Quantities
              </Button>
            )}
          </div>
        </DialogHeader>

        {mode === "overlay" && (
          <div className="shrink-0 px-4 py-2 border-b flex items-center gap-4 bg-muted/30">
            <Label className="text-xs text-muted-foreground shrink-0">Old opacity</Label>
            <ArrowLeft className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <Slider
              value={[overlayOpacity]}
              min={0}
              max={100}
              step={1}
              onValueChange={([v]) => setOverlayOpacity(v)}
              className="flex-1"
              data-testid="slider-overlay-opacity"
            />
            <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <Label className="text-xs text-muted-foreground shrink-0">New opacity</Label>
            <Badge variant="secondary" className="text-xs shrink-0">{overlayOpacity}%</Badge>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-hidden">
          {mode === "swipe" ? (
            <div className="h-full flex flex-col">
              <div className="shrink-0 flex items-center gap-4 px-3 py-2 bg-muted/50 border-b text-xs">
                <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-200">Old: {oldSheet.sheetName}</Badge>
                <span className="text-muted-foreground">Drag the divider to compare</span>
                <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-200">New: {newSheet.sheetName}</Badge>
              </div>
              <div
                ref={swipeContainerRef}
                className="flex-1 min-h-0 relative overflow-hidden bg-white cursor-col-resize select-none"
                onMouseDown={handleSwipeMouseDown}
                onTouchStart={handleSwipeMouseDown}
                data-testid="swipe-compare-container"
              >
                <img
                  src={newSrc}
                  alt={newSheet.sheetName}
                  className="absolute inset-0 w-full h-full object-contain"
                  draggable={false}
                />
                <div
                  className="absolute inset-0 overflow-hidden"
                  style={{ clipPath: `inset(0 ${100 - swipePosition}% 0 0)` }}
                >
                  <img
                    src={oldSrc}
                    alt={oldSheet.sheetName}
                    className="absolute inset-0 w-full h-full object-contain"
                    draggable={false}
                  />
                </div>
                <div
                  className="absolute top-0 bottom-0 z-10 flex flex-col items-center"
                  style={{ left: `${swipePosition}%`, transform: "translateX(-50%)" }}
                >
                  <div className="w-1 flex-1 bg-primary shadow-lg" />
                  <div className="w-8 h-8 rounded-full bg-primary shadow-lg flex items-center justify-center cursor-grab active:cursor-grabbing">
                    <SplitSquareHorizontal className="w-4 h-4 text-primary-foreground" />
                  </div>
                  <div className="w-1 flex-1 bg-primary shadow-lg" />
                </div>
              </div>
            </div>
          ) : mode === "diff" ? (
            <div className="h-full flex flex-col">
              <div className="shrink-0 flex items-center gap-4 px-3 py-2 bg-muted/50 border-b text-xs">
                <span className="font-medium">Difference Highlight</span>
                <span className="text-muted-foreground">Areas that changed between revisions are highlighted</span>
                <div className="flex items-center gap-2 ml-auto">
                  <div className="w-3 h-3 rounded bg-red-500/40" /> <span>Removed</span>
                  <div className="w-3 h-3 rounded bg-green-500/40" /> <span>Added</span>
                </div>
              </div>
              <div className="flex-1 min-h-0 overflow-auto bg-muted/20 flex items-center justify-center p-2">
                <div className="relative inline-block border rounded shadow-sm bg-white">
                  <img
                    src={newSrc}
                    alt={newSheet.sheetName}
                    className="block max-w-full max-h-[calc(80vh-120px)] object-contain"
                    data-testid="compare-diff-base"
                  />
                  <img
                    src={oldSrc}
                    alt={oldSheet.sheetName}
                    className="absolute inset-0 w-full h-full object-contain"
                    style={{ opacity: 0.4, mixBlendMode: "difference" }}
                    data-testid="compare-diff-overlay"
                  />
                </div>
              </div>
            </div>
          ) : mode === "quantity-table" && quantityComparison ? (
            <div className="h-full overflow-auto p-4">
              <table className="w-full text-sm border-collapse" data-testid="quantity-compare-table">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left px-3 py-2 font-semibold">Category</th>
                    <th className="text-left px-3 py-2 font-semibold">Unit</th>
                    <th className="text-right px-3 py-2 font-semibold">{oldSheet.revisionLabel || "Old"}</th>
                    <th className="text-right px-3 py-2 font-semibold">{newSheet.revisionLabel || "New"}</th>
                    <th className="text-right px-3 py-2 font-semibold">Diff</th>
                    <th className="text-right px-3 py-2 font-semibold">% Change</th>
                    <th className="text-center px-3 py-2 font-semibold">Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {quantityComparison.map((row, i) => (
                    <tr key={i} className={cn("border-b hover:bg-muted/30", row.diff > 0 && "bg-red-50 dark:bg-red-950/20", row.diff < 0 && "bg-green-50 dark:bg-green-950/20")} data-testid={`quantity-row-${i}`}>
                      <td className="px-3 py-2 font-medium">{row.category}</td>
                      <td className="px-3 py-2 text-muted-foreground">{row.unit}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.oldQty.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.newQty.toFixed(2)}</td>
                      <td className={cn("px-3 py-2 text-right tabular-nums font-medium", row.diff > 0 ? "text-red-600" : row.diff < 0 ? "text-green-600" : "text-muted-foreground")}>
                        {row.diff > 0 ? "+" : ""}{row.diff.toFixed(2)}
                      </td>
                      <td className={cn("px-3 py-2 text-right tabular-nums", row.diff !== 0 ? (row.diff > 0 ? "text-red-600" : "text-green-600") : "text-muted-foreground")}>
                        {row.pctChange > 0 ? "+" : ""}{row.pctChange.toFixed(1)}%
                      </td>
                      <td className="px-3 py-2 text-center">
                        {row.diff > 0 ? <TrendingUp className="w-4 h-4 text-red-500 inline" /> : row.diff < 0 ? <TrendingDown className="w-4 h-4 text-green-500 inline" /> : <Minus className="w-4 h-4 text-muted-foreground inline" />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : mode === "side-by-side" ? (
            <div className="h-full flex divide-x">
              <div className="flex-1 min-w-0 flex flex-col">
                <SheetImage sheet={oldSheet} className="h-full" />
              </div>
              <div className="flex-1 min-w-0 flex flex-col">
                <SheetImage sheet={newSheet} className="h-full" />
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col">
              <div className="shrink-0 flex items-center gap-4 px-3 py-2 bg-muted/50 border-b text-sm">
                <span className="font-medium">{oldSheet.sheetName}</span>
                {oldSheet.revisionLabel && <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">{oldSheet.revisionLabel}</Badge>}
                <span className="text-muted-foreground text-xs">blended with</span>
                <span className="font-medium">{newSheet.sheetName}</span>
                {newSheet.revisionLabel && <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">{newSheet.revisionLabel}</Badge>}
              </div>
              <div className="flex-1 min-h-0 overflow-auto bg-muted/20 flex items-center justify-center p-2">
                <div className="relative inline-block border rounded shadow-sm bg-white">
                  <img
                    src={newSrc}
                    alt={newSheet.sheetName}
                    className="block max-w-full max-h-[calc(80vh-120px)] object-contain"
                    data-testid="compare-overlay-new"
                  />
                  <img
                    src={oldSrc}
                    alt={oldSheet.sheetName}
                    className="absolute inset-0 w-full h-full object-contain"
                    style={{ opacity: overlayOpacity / 100 }}
                    data-testid="compare-overlay-old"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
