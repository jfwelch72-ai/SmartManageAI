import { memo } from "react";
import { DollarSign, Flag, Layers, TableProperties, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TakeoffMeasurement, TakeoffSheet } from "@shared/schema";

export interface WorkspaceBottomBarProps {
  // batch action bar
  selectedMeasurementCount: number;
  bulkDeletePending: boolean;
  onBulkDelete: () => void;
  onClearSelection: () => void;

  // bottom status bar
  selectedSheet: string | null;
  measurements: TakeoffMeasurement[];
  showCostPanel: boolean;
  onToggleCostPanel: () => void;
  showOverlaySlider: boolean;
  onToggleOverlaySlider: () => void;
  showMeasurementTable: boolean;
  onToggleMeasurementTable: () => void;
  // Task #2330 — Review-queue toggle. The count is workspace-wide
  // (every flagged measurement across every sheet for the current
  // bid/project), so we can show it on the status bar even when no
  // sheet is selected. `null` means the count is still loading.
  showReviewQueue: boolean;
  onToggleReviewQueue: () => void;
  reviewQueueCount: number | null;
  stageScale: number;
  currentSheet: TakeoffSheet | null | undefined;
}

// Task #2320 — central confidence-dot helper. The bottom-bar chip is
// the only on-canvas surface that always shows the calibration's
// provenance, so we keep the colour mapping here rather than letting
// each call site reinvent it. UNVERIFIED is intentionally red so a
// freshly-superseded revision (which copies the parent scale but is
// not yet trusted) jumps out before the user starts measuring.
function confidenceDotClass(confidence: string | null | undefined): string {
  switch (confidence) {
    case "HIGH":
      return "bg-green-500 dark:bg-green-400";
    case "MEDIUM":
    case "LOW":
      return "bg-amber-500 dark:bg-amber-400";
    case "UNVERIFIED":
    default:
      return "bg-red-500 dark:bg-red-400";
  }
}

function confidenceTooltip(
  source: string | null | undefined,
  confidence: string | null | undefined,
): string {
  const sourceText = (() => {
    switch (source) {
      case "USER_TWO_POINT": return "Calibrated by you (two-point ruler)";
      case "STANDARD_SCALE": return "Standard scale applied";
      case "AI_DETECTED": return "Auto-detected from sheet";
      case "BULK_PROPAGATED": return "Applied to entire Sheet Set";
      case "INHERITED_FROM_PARENT": return "Inherited from previous revision";
      case "UNVERIFIED":
      default:
        return "Scale not yet verified";
    }
  })();
  const confText = confidence ? ` · ${confidence.toLowerCase()} confidence` : "";
  return `${sourceText}${confText}`;
}

function WorkspaceBottomBarInner(props: WorkspaceBottomBarProps) {
  const {
    selectedMeasurementCount, bulkDeletePending, onBulkDelete, onClearSelection,
    selectedSheet, measurements, showCostPanel, onToggleCostPanel,
    showOverlaySlider, onToggleOverlaySlider, showMeasurementTable, onToggleMeasurementTable,
    showReviewQueue, onToggleReviewQueue, reviewQueueCount,
    stageScale, currentSheet,
  } = props;

  // Read the scale-provenance fields the server now writes on every
  // calibration. They're typed as optional on `TakeoffSheet` so the
  // existing /api/takeoff/sheets/{id} response (which currently does
  // not project these columns) still type-checks; when missing we
  // fall back to UNVERIFIED so the chip renders red.
  const sheetWithProvenance = currentSheet as
    | (TakeoffSheet & {
        scaleSource?: string | null;
        scaleConfidence?: string | null;
      })
    | null
    | undefined;
  const scaleSource = sheetWithProvenance?.scaleSource ?? "UNVERIFIED";
  const scaleConfidence = sheetWithProvenance?.scaleConfidence ?? "UNVERIFIED";
  const dotClass = confidenceDotClass(scaleConfidence);
  const chipTitle = confidenceTooltip(scaleSource, scaleConfidence);
  const scaleLabelText = currentSheet?.scaleLabel
    ? currentSheet.scaleLabel
    : currentSheet?.scalePxPerFoot
      ? `${Number(currentSheet.scalePxPerFoot).toFixed(2)} px/ft`
      : "Not calibrated";

  return (
    <>
      {selectedMeasurementCount > 1 && (
        <div className="flex h-9 bg-primary/10 border-t border-primary/20 px-3 items-center justify-between text-xs shrink-0" data-testid="batch-action-bar">
          <span className="font-medium text-primary">{selectedMeasurementCount} measurements selected</span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs px-2"
              disabled={bulkDeletePending}
              data-testid="button-batch-delete"
              onClick={onBulkDelete}
            >
              <Trash2 className="w-3 h-3 mr-1" />
              Delete All
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs px-2"
              data-testid="button-batch-clear"
              onClick={onClearSelection}
            >
              Clear
            </Button>
          </div>
        </div>
      )}
      {selectedSheet && (
        // Task #2312 — Phone-only compact status row. The full status
        // bar below (`hidden sm:flex`) hides on `<sm` (640 px) because
        // the row of toggle chips + LF/SF/CY totals overflows on a
        // phone, so phone users were left with no read-out for zoom,
        // calibration state, or measurement count. This compact row
        // surfaces just those three signals — the toggles still live
        // in the ribbon's "View" menu and the totals in the table —
        // so phone users always know where they stand on the canvas.
        <div className="flex sm:hidden h-7 bg-card/95 backdrop-blur-sm border-t px-3 items-center justify-between text-[11px] text-muted-foreground shrink-0 tabular-nums" data-testid="takeoff-status-bar-mobile">
          <div className="flex items-center gap-3 min-w-0">
            <span className="font-medium text-foreground/80 shrink-0">{measurements.length} m</span>
            <span
              className="flex items-center gap-1 shrink-0"
              title={chipTitle}
              data-testid="status-calibration-mobile"
            >
              <span className={cn("inline-block w-1.5 h-1.5 rounded-full", dotClass)} aria-hidden="true" />
              <span className="truncate max-w-[8rem] text-foreground/80">{scaleLabelText}</span>
            </span>
          </div>
          <span className="shrink-0" data-testid="status-zoom-mobile">{Math.round(stageScale * 100)}%</span>
        </div>
      )}
      {selectedSheet && (
        <div className="hidden sm:flex h-7 bg-card/95 backdrop-blur-sm border-t px-3 items-center justify-between text-[11px] text-muted-foreground shrink-0 tabular-nums" data-testid="takeoff-status-bar">
          <div className="flex items-center gap-4">
            {measurements.length > 0 && (
              <>
                <span className="font-medium text-foreground/80">{measurements.length} measurement{measurements.length !== 1 ? "s" : ""}</span>
                {(() => {
                  const totals = { lf: 0, sf: 0, cy: 0, count: 0 };
                  measurements.forEach(m => {
                    if (m.computedLengthFt) totals.lf += Number(m.computedLengthFt);
                    if (m.computedAreaFt2) totals.sf += Number(m.computedAreaFt2);
                    if (m.computedVolumeCy) totals.cy += Number(m.computedVolumeCy);
                    if (m.type === "COUNT" && m.count) totals.count += Number(m.count);
                  });
                  return (
                    <>
                      {totals.lf > 0 && <span>LF: <strong className="text-foreground/80">{totals.lf.toLocaleString(undefined, { maximumFractionDigits: 1 })}</strong></span>}
                      {totals.sf > 0 && <span>SF: <strong className="text-foreground/80">{totals.sf.toLocaleString(undefined, { maximumFractionDigits: 1 })}</strong></span>}
                      {totals.cy > 0 && <span>CY: <strong className="text-foreground/80">{totals.cy.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></span>}
                      {totals.count > 0 && <span>Count: <strong className="text-foreground/80">{totals.count.toLocaleString()}</strong></span>}
                    </>
                  );
                })()}
              </>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-muted/70 transition-colors", showCostPanel && "bg-primary/10 text-primary")}
              onClick={onToggleCostPanel}
              data-testid="button-toggle-cost-panel"
            >
              <DollarSign className="w-3 h-3" />
              <span>Costs</span>
            </button>
            <button
              className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-muted/70 transition-colors", showOverlaySlider && "bg-primary/10 text-primary")}
              onClick={onToggleOverlaySlider}
              data-testid="button-toggle-overlay-slider"
            >
              <Layers className="w-3 h-3" />
              <span>Overlay</span>
            </button>
            <button
              className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-muted/70 transition-colors", showMeasurementTable && "bg-primary/10 text-primary")}
              onClick={onToggleMeasurementTable}
              data-testid="button-toggle-measurement-table"
            >
              <TableProperties className="w-3 h-3" />
              <span>Table</span>
            </button>
            <button
              className={cn(
                "flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-muted/70 transition-colors",
                showReviewQueue && "bg-primary/10 text-primary",
                !showReviewQueue && reviewQueueCount && reviewQueueCount > 0 && "text-amber-700 dark:text-amber-400",
              )}
              onClick={onToggleReviewQueue}
              data-testid="button-toggle-review-queue"
              title={
                reviewQueueCount === null
                  ? "Review queue"
                  : reviewQueueCount === 0
                    ? "No measurements need review"
                    : `${reviewQueueCount} measurement${reviewQueueCount === 1 ? "" : "s"} need${reviewQueueCount === 1 ? "s" : ""} review`
              }
            >
              <Flag className="w-3 h-3" />
              <span>Review</span>
              {reviewQueueCount !== null && reviewQueueCount > 0 && (
                <span
                  className="ml-0.5 inline-flex items-center justify-center rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 px-1 text-[10px] font-semibold tabular-nums"
                  data-testid="badge-review-queue-count"
                >
                  {reviewQueueCount > 99 ? "99+" : reviewQueueCount}
                </span>
              )}
            </button>
            <span>Zoom: {Math.round(stageScale * 100)}%</span>
            <span
              className="flex items-center gap-1.5"
              title={chipTitle}
              data-testid="status-calibration-chip"
            >
              <span className={cn("inline-block w-2 h-2 rounded-full", dotClass)} aria-hidden="true" />
              <span className="text-foreground/80" data-testid="text-scale-label">{scaleLabelText}</span>
            </span>
          </div>
        </div>
      )}
    </>
  );
}

export const WorkspaceBottomBar = memo(WorkspaceBottomBarInner);
WorkspaceBottomBar.displayName = "WorkspaceBottomBar";
