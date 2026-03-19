import { useState } from "react";
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
import { Columns, Layers, ArrowLeft, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface SheetInfo {
  id: string;
  sheetName: string;
  revisionLabel?: string | null;
  isActive?: boolean;
  imageUrl?: string | null;
}

interface TakeoffSheetCompareDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  oldSheet: SheetInfo;
  newSheet: SheetInfo;
  allSheets: SheetInfo[];
}

type CompareMode = "side-by-side" | "overlay";

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
}: TakeoffSheetCompareDialogProps) {
  const [mode, setMode] = useState<CompareMode>("side-by-side");
  const [overlayOpacity, setOverlayOpacity] = useState(50);

  const oldSrc = oldSheet.imageUrl || `/api/takeoff/sheets/${oldSheet.id}/pdf`;
  const newSrc = newSheet.imageUrl || `/api/takeoff/sheets/${newSheet.id}/pdf`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[95vw] h-[90vh] flex flex-col p-0 gap-0" data-testid="dialog-compare-revisions">
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
          {mode === "side-by-side" ? (
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
