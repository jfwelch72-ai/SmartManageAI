import { useRef, useEffect, useCallback } from "react";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Loader2, ImageOff, UserCircle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePdfThumbnails } from "@/hooks/use-pdf-thumbnails";
import type { TakeoffSheet } from "@shared/schema";

interface PageThumbnailStripProps {
  sheets: TakeoffSheet[];
  selectedSheet: string | null;
  onSelectSheet: (id: string) => void;
  layout?: "horizontal" | "grid";
  measurementCounts?: Map<string, number>;
}

export function PageThumbnailStrip({
  sheets,
  selectedSheet,
  onSelectSheet,
  layout = "grid",
  measurementCounts,
}: PageThumbnailStripProps) {
  const { thumbnails, failedSheets, isLoading, progress, observeRef } = usePdfThumbnails(sheets);
  const activeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    }
  }, [selectedSheet]);

  const thumbRef = useCallback(
    (sheetId: string) => (el: HTMLButtonElement | null) => {
      observeRef(sheetId, el);
    },
    [observeRef]
  );

  if (sheets.length === 0) {
    return (
      <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">
        No sheets imported yet
      </div>
    );
  }

  const content = (
    <div
      className={cn(
        layout === "grid"
          ? "grid grid-cols-2 gap-2 p-2"
          : "flex gap-2 p-2"
      )}
    >
      {sheets.map((sheet) => {
        const thumb = thumbnails.get(sheet.id);
        const isActive = sheet.id === selectedSheet;
        const isSuperseded = sheet.isActive === false;

        return (
          <button
            key={sheet.id}
            ref={(el) => {
              if (isActive) {
                activeRef.current = el;
              }
              thumbRef(sheet.id)(el);
            }}
            onClick={() => onSelectSheet(sheet.id)}
            className={cn(
              "group relative flex flex-col items-center rounded-md border-2 transition-all cursor-pointer",
              "hover:border-primary/50 hover:shadow-sm",
              layout === "horizontal" ? "shrink-0 w-[100px]" : "w-full",
              isActive
                ? "border-primary bg-primary/5 shadow-sm"
                : "border-border bg-background",
              isSuperseded && "opacity-60",
              "data-[pin-drop-active=true]:ring-2 data-[pin-drop-active=true]:ring-primary data-[pin-drop-active=true]:bg-primary/10 data-[pin-drop-active=true]:border-primary"
            )}
            data-pin-drop-target=""
            data-pin-drop-sheet={sheet.id}
            data-testid={`thumbnail-sheet-${sheet.id}`}
          >
            <div className="relative w-full aspect-[4/3] overflow-hidden rounded-t flex items-center justify-center bg-muted">
              {thumb ? (
                <img
                  src={thumb}
                  alt={sheet.sheetName || "Sheet"}
                  className="w-full h-full object-contain"
                  draggable={false}
                />
              ) : failedSheets.has(sheet.id) ? (
                <div className="flex flex-col items-center justify-center w-full h-full gap-1">
                  <ImageOff className="w-4 h-4 text-muted-foreground/50" />
                  <span className="text-[8px] text-muted-foreground/50">No preview</span>
                </div>
              ) : (
                <div className="flex items-center justify-center w-full h-full">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              )}
              {isActive && (
                <div className="absolute inset-0 border-2 border-primary rounded-t pointer-events-none" />
              )}
            </div>
            <div className="w-full px-1.5 py-1 text-center min-w-0">
              <p
                className={cn(
                  "text-[10px] leading-tight truncate",
                  isActive ? "font-semibold text-primary" : "text-muted-foreground"
                )}
                title={sheet.sheetName || "Untitled"}
              >
                {sheet.sheetName || "Untitled"}
              </p>
              <div className="flex items-center justify-center gap-1 mt-0.5">
                {sheet.revisionLabel && (
                  <Badge
                    variant="outline"
                    className="text-[8px] px-1 py-0 h-3 leading-none"
                  >
                    {sheet.revisionLabel}
                  </Badge>
                )}
                {isSuperseded && (
                  <Badge
                    variant="secondary"
                    className="text-[8px] px-1 py-0 h-3 leading-none opacity-60"
                  >
                    Old
                  </Badge>
                )}
                {(sheet as any).completionStatus === "complete" && (
                  <CheckCircle2 className="w-3 h-3 text-green-500" />
                )}
                {(sheet as any).assignedTo && (
                  <UserCircle className="w-3 h-3 text-blue-400" />
                )}
              </div>
              {measurementCounts && (() => {
                const count = measurementCounts.get(sheet.id) || 0;
                const target = (sheet as any).targetMeasurements;
                if (target && target > 0) {
                  const pct = Math.min(100, Math.round((count / target) * 100));
                  return (
                    <div className="w-full px-1 pb-0.5">
                      <div className="h-0.5 w-full bg-muted rounded-full overflow-hidden">
                        <div
                          className={cn("h-full rounded-full transition-all", pct >= 100 ? "bg-green-500" : pct >= 50 ? "bg-yellow-500" : "bg-blue-500")}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                }
                if (count > 0) {
                  return (
                    <div className="w-full px-1 pb-0.5">
                      <span className="text-[8px] text-muted-foreground">{count} meas.</span>
                    </div>
                  );
                }
                return null;
              })()}
            </div>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="flex flex-col">
      {isLoading && progress < 100 && (
        <div className="px-2 pt-1">
          <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300 rounded-full"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}
      {layout === "horizontal" ? (
        <ScrollArea className="w-full">
          {content}
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      ) : (
        <ScrollArea className="max-h-[300px]">
          {content}
        </ScrollArea>
      )}
    </div>
  );
}
