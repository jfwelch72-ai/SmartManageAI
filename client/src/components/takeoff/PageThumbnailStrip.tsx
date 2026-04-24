import { useRef, useEffect, useCallback } from "react";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Loader2, ImageOff, UserCircle, CheckCircle2, Pin, PinOff, ArrowUpCircle, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePdfThumbnails } from "@/hooks/use-pdf-thumbnails";
import type { TakeoffSheet } from "@shared/schema";

interface PageThumbnailStripProps {
  sheets: TakeoffSheet[];
  selectedSheet: string | null;
  onSelectSheet: (id: string) => void;
  layout?: "horizontal" | "grid";
  measurementCounts?: Map<string, number>;
  // Task #1661 — optional active-set context. When provided, each
  // thumbnail surfaces whether it is pinned to the active drawing set
  // and whether a newer revision exists, mirroring the inline badges
  // shown in the sheet list.
  pinnedSheetIds?: Set<string>;
  newerSheetIds?: Set<string>;
  // Task #1682 — when supplied alongside the maps above, each
  // thumbnail renders small hover-only Pin / Unpin / Use-latest-
  // revision buttons so users can manage active-set membership
  // without leaving the takeoff canvas. Callbacks are wired to the
  // same mutations as the Plans-tab inline controls.
  canManagePins?: boolean;
  onPinSheet?: (sheetId: string) => void;
  onUnpinSheet?: (sheetId: string) => void;
  onSwapToLatestRevision?: (sheetId: string) => void;
  pinActionsDisabled?: boolean;
  activeSetName?: string | null;
}

export function PageThumbnailStrip({
  sheets,
  selectedSheet,
  onSelectSheet,
  layout = "grid",
  measurementCounts,
  pinnedSheetIds,
  newerSheetIds,
  canManagePins = false,
  onPinSheet,
  onUnpinSheet,
  onSwapToLatestRevision,
  pinActionsDisabled = false,
  activeSetName,
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
        const isPinnedToActiveSet = pinnedSheetIds?.has(sheet.id) ?? false;
        const hasNewerInActiveSet = newerSheetIds?.has(sheet.id) ?? false;

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
              {isPinnedToActiveSet && (
                <div
                  className="absolute top-0.5 left-0.5 flex items-center justify-center w-4 h-4 rounded-full bg-green-600 text-white shadow"
                  title="Pinned to active drawing set"
                  data-testid={`thumb-pinned-${sheet.id}`}
                >
                  <Pin className="w-2.5 h-2.5" />
                </div>
              )}
              {hasNewerInActiveSet && isPinnedToActiveSet && (
                <div
                  className="absolute top-0.5 right-0.5 flex items-center justify-center w-4 h-4 rounded-full bg-amber-500 text-white shadow"
                  title="A newer revision is available"
                  data-testid={`thumb-newer-${sheet.id}`}
                >
                  <AlertTriangle className="w-2.5 h-2.5" />
                </div>
              )}
              {/* Task #1682 — hover-only Pin / Unpin / Use-latest controls
                  mirror the Plans-tab inline buttons so users can manage
                  active-set membership directly from the takeoff canvas.
                  Wrapped in <span>s (parent is a <button>) and stop
                  propagation so clicking them never selects the sheet. */}
              {canManagePins && (onPinSheet || onUnpinSheet || onSwapToLatestRevision) && (
                <span
                  className="absolute bottom-0.5 right-0.5 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => e.stopPropagation()}
                >
                  {isPinnedToActiveSet && hasNewerInActiveSet && onSwapToLatestRevision && (
                    <span
                      role="button"
                      tabIndex={0}
                      aria-disabled={pinActionsDisabled}
                      title="Use latest revision"
                      data-testid={`thumb-swap-revision-${sheet.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (pinActionsDisabled) return;
                        onSwapToLatestRevision(sheet.id);
                      }}
                      onKeyDown={(e) => {
                        if (pinActionsDisabled) return;
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          onSwapToLatestRevision(sheet.id);
                        }
                      }}
                      className={cn(
                        "flex items-center justify-center w-5 h-5 rounded-full bg-amber-500 text-white shadow hover:bg-amber-600",
                        pinActionsDisabled && "opacity-50 cursor-not-allowed",
                      )}
                    >
                      <ArrowUpCircle className="w-3 h-3" />
                    </span>
                  )}
                  {isPinnedToActiveSet ? (
                    onUnpinSheet && (
                      <span
                        role="button"
                        tabIndex={0}
                        aria-disabled={pinActionsDisabled}
                        title={activeSetName ? `Remove from ${activeSetName}` : "Unpin from active set"}
                        data-testid={`thumb-unpin-${sheet.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (pinActionsDisabled) return;
                          onUnpinSheet(sheet.id);
                        }}
                        onKeyDown={(e) => {
                          if (pinActionsDisabled) return;
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            onUnpinSheet(sheet.id);
                          }
                        }}
                        className={cn(
                          "flex items-center justify-center w-5 h-5 rounded-full bg-card text-foreground border shadow hover:bg-accent",
                          pinActionsDisabled && "opacity-50 cursor-not-allowed",
                        )}
                      >
                        <PinOff className="w-3 h-3" />
                      </span>
                    )
                  ) : (
                    onPinSheet && (
                      <span
                        role="button"
                        tabIndex={0}
                        aria-disabled={pinActionsDisabled}
                        title={activeSetName ? `Pin to ${activeSetName}` : "Pin to active set"}
                        data-testid={`thumb-pin-${sheet.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (pinActionsDisabled) return;
                          onPinSheet(sheet.id);
                        }}
                        onKeyDown={(e) => {
                          if (pinActionsDisabled) return;
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            onPinSheet(sheet.id);
                          }
                        }}
                        className={cn(
                          "flex items-center justify-center w-5 h-5 rounded-full bg-card text-foreground border shadow hover:bg-accent",
                          pinActionsDisabled && "opacity-50 cursor-not-allowed",
                        )}
                      >
                        <Pin className="w-3 h-3" />
                      </span>
                    )
                  )}
                </span>
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
