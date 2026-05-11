import { memo } from "react";
import { AlertCircle, DollarSign, Flag, Layers, MapPin, TableProperties, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TakeoffMeasurement, TakeoffSheet } from "@shared/schema";
import type { SheetCalibrationConfidence } from "../sheetCalibrationConfidence";

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
  // Task #2344 — Pre-computed four-level (HIGH / MEDIUM / LOW /
  // UNVERIFIED) calibration confidence for the active sheet.
  // Replaces the bottom-bar's old binary derive-from-`scaleSource`/
  // `scaleConfidence` helper so the chip factors in measurement
  // count and captured-label drift the same way the sheet-header
  // chip already does. Optional so older callers / tests that
  // don't compute it still render an UNVERIFIED chip.
  calibrationConfidence?: SheetCalibrationConfidence | null;
  // Task #2344 — Click target for the bottom-bar calibration chip.
  // Mirrors the sheet-header chip's `onOpenCalibration` so an
  // estimator who notices a LOW / UNVERIFIED bottom-bar chip can
  // jump straight to the calibration drawer without hunting for the
  // header chip. When omitted the chip stays read-only (legacy
  // callers / tests that only need the visual indicator).
  onOpenCalibration?: () => void;
  /**
   * Task #2785 — When the cursor is inside a calibration zone polygon, the
   * workspace computes which zone is active and passes it here. The bottom bar
   * shows a live badge so the estimator always knows which zone-specific scale
   * is being applied to the current measurement. Null / undefined = cursor is
   * on the global sheet scale.
   */
  activeZone?: { id: string; name: string; pxPerFoot: number } | null;
  /**
   * Task #2785 — Whether a measurement is currently being drawn. The active-zone
   * badge is only shown during an in-progress draw so idle cursor movement over
   * zones doesn't add noise when the user is just inspecting the canvas.
   */
  isDrawing?: boolean;
}

// Task #2344 — Default UNVERIFIED chip used when a caller hasn't
// supplied a pre-computed confidence (e.g. the first paint before the
// workspace's all-measurements query has resolved). Mirrors the
// fallback `SheetSelectorBar` renders so both chips agree on the
// "scale not yet verified" framing.
const UNVERIFIED_FALLBACK: SheetCalibrationConfidence = {
  confidence: "UNVERIFIED",
  label: "Unverified",
  dotClass: "bg-red-500 dark:bg-red-400",
  chipClass: "border-red-500/50 text-red-700 dark:text-red-300 hover:bg-red-500/10",
  sourceText: "Scale not yet verified",
  tooltip:
    "This sheet isn't calibrated yet — measurements taken against it will be unreliable.",
  measurementCount: 0,
  hasDrift: false,
  driftLabels: [],
};

function WorkspaceBottomBarInner(props: WorkspaceBottomBarProps) {
  const {
    selectedMeasurementCount, bulkDeletePending, onBulkDelete, onClearSelection,
    selectedSheet, measurements, showCostPanel, onToggleCostPanel,
    showOverlaySlider, onToggleOverlaySlider, showMeasurementTable, onToggleMeasurementTable,
    showReviewQueue, onToggleReviewQueue, reviewQueueCount,
    stageScale, currentSheet, calibrationConfidence, onOpenCalibration,
    activeZone, isDrawing,
  } = props;

  // Task #2785 — Only show the zone badge when a measurement is being actively
  // drawn. When idle, moving the cursor over zones doesn't add noise.
  const showActiveZone = !!(isDrawing && activeZone);

  // Task #2344 — Use the same four-level confidence helper output as
  // the sheet-header chip. The bottom-bar previously derived a
  // 2-state colour from `scaleSource` / `scaleConfidence` only,
  // which left UNVERIFIED sheets with hundreds of drifted
  // measurements visually indistinguishable from a freshly-
  // calibrated sheet that hadn't yet captured a single measurement.
  const confidence = calibrationConfidence ?? UNVERIFIED_FALLBACK;
  const dotClass = confidence.dotClass;
  // The status-bar chip was a plain `title=` tooltip before, so we
  // keep it as one (no Tooltip wrapper) but feed it the helper's
  // verbose multi-sentence rationale (source + measurement count +
  // drift) so estimators get the full story on hover.
  const chipTitle = confidence.tooltip;
  const ariaConfidenceLabel = `Scale confidence: ${confidence.label}. ${confidence.sourceText}.${
    confidence.hasDrift
      ? " Captured scale labels disagree with the sheet's current label."
      : ""
  }`;
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
            {/* Task #2785 — Active calibration zone badge (mobile). Only shown
                while a measurement is being drawn so idle cursor movement over
                zones doesn't add noise. Shows name + px/ft for full parity. */}
            {showActiveZone && (
              <span
                className="flex items-center gap-1 shrink-0 rounded px-1.5 py-0.5 bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-400/40"
                data-testid="status-active-zone-mobile"
                title={`Zone "${activeZone!.name}" — ${activeZone!.pxPerFoot.toFixed(2)} px/ft`}
              >
                <MapPin className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
                <span className="truncate max-w-[6rem] text-[10px] font-medium">{activeZone!.name}</span>
                <span className="text-[9px] text-cyan-600/80 dark:text-cyan-400/80 shrink-0">{activeZone!.pxPerFoot.toFixed(2)} px/ft</span>
              </span>
            )}
            {/* Task #2344 — When `onOpenCalibration` is wired, the
              *  mobile chip behaves as a tap target that opens the
              *  same calibration drawer the sheet-header chip and the
              *  `T` shortcut use. Falls back to a static `<span>` so
              *  legacy callers / tests that only rendered the visual
              *  indicator keep working. */}
            {onOpenCalibration ? (
              <button
                type="button"
                onClick={onOpenCalibration}
                className="flex items-center gap-1 shrink-0 rounded px-1 -mx-1 hover:bg-muted/70 active:bg-muted transition-colors"
                title={chipTitle}
                data-testid="status-calibration-mobile"
                data-confidence={confidence.confidence}
                aria-label={ariaConfidenceLabel}
              >
                <span className={cn("inline-block w-1.5 h-1.5 rounded-full", dotClass)} aria-hidden="true" />
                <span className="truncate max-w-[8rem] text-foreground/80">{scaleLabelText}</span>
                {confidence.hasDrift && (
                  <AlertCircle
                    className="w-2.5 h-2.5 text-amber-500 shrink-0"
                    data-testid="status-calibration-mobile-drift"
                    aria-hidden="true"
                  />
                )}
              </button>
            ) : (
              <span
                className="flex items-center gap-1 shrink-0"
                title={chipTitle}
                data-testid="status-calibration-mobile"
                data-confidence={confidence.confidence}
                aria-label={ariaConfidenceLabel}
              >
                <span className={cn("inline-block w-1.5 h-1.5 rounded-full", dotClass)} aria-hidden="true" />
                <span className="truncate max-w-[8rem] text-foreground/80">{scaleLabelText}</span>
                {confidence.hasDrift && (
                  <AlertCircle
                    className="w-2.5 h-2.5 text-amber-500 shrink-0"
                    data-testid="status-calibration-mobile-drift"
                    aria-hidden="true"
                  />
                )}
              </span>
            )}
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
            {/* Task #2785 — Active calibration zone badge (desktop). Only shown
                while a measurement is being drawn so idle cursor movement over
                zones doesn't add noise. Placed before toggle buttons so it's
                always visible when active without displacing the calibration chip. */}
            {showActiveZone && (
              <span
                className="flex items-center gap-1 rounded px-1.5 py-0.5 bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-400/40 shrink-0"
                data-testid="status-active-zone"
                title={`Zone-specific scale active: "${activeZone!.name}" — ${activeZone!.pxPerFoot.toFixed(2)} px/ft`}
              >
                <MapPin className="w-3 h-3 shrink-0" aria-hidden="true" />
                <span className="font-medium truncate max-w-[10rem]" data-testid="text-active-zone-name">{activeZone!.name}</span>
                <span className="text-cyan-600/80 dark:text-cyan-400/80 hidden md:inline" data-testid="text-active-zone-scale">
                  · {activeZone!.pxPerFoot.toFixed(2)} px/ft
                </span>
              </span>
            )}
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
            {/* Task #2344 — When `onOpenCalibration` is wired the
              *  desktop chip becomes a button so a click opens the
              *  same calibration drawer the sheet-header chip uses.
              *  The original `data-testid="status-calibration-chip"`
              *  is preserved on the outer element either way so
              *  existing e2e tests keep working. */}
            {onOpenCalibration ? (
              <button
                type="button"
                onClick={onOpenCalibration}
                className="flex items-center gap-1.5 rounded px-1 -mx-1 hover:bg-muted/70 active:bg-muted transition-colors"
                title={chipTitle}
                data-testid="status-calibration-chip"
                data-confidence={confidence.confidence}
                aria-label={ariaConfidenceLabel}
              >
                <span className={cn("inline-block w-2 h-2 rounded-full", dotClass)} aria-hidden="true" />
                <span className="text-foreground/80" data-testid="text-scale-label">{scaleLabelText}</span>
                <span
                  className="text-foreground/70 hidden md:inline"
                  data-testid="text-scale-confidence"
                >
                  · {confidence.label}
                </span>
                {confidence.hasDrift && (
                  <AlertCircle
                    className="w-3 h-3 text-amber-500 shrink-0"
                    data-testid="status-calibration-chip-drift"
                    aria-hidden="true"
                  />
                )}
              </button>
            ) : (
              <span
                className="flex items-center gap-1.5"
                title={chipTitle}
                data-testid="status-calibration-chip"
                data-confidence={confidence.confidence}
                aria-label={ariaConfidenceLabel}
              >
                <span className={cn("inline-block w-2 h-2 rounded-full", dotClass)} aria-hidden="true" />
                <span className="text-foreground/80" data-testid="text-scale-label">{scaleLabelText}</span>
                <span
                  className="text-foreground/70 hidden md:inline"
                  data-testid="text-scale-confidence"
                >
                  · {confidence.label}
                </span>
                {confidence.hasDrift && (
                  <AlertCircle
                    className="w-3 h-3 text-amber-500 shrink-0"
                    data-testid="status-calibration-chip-drift"
                    aria-hidden="true"
                  />
                )}
              </span>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export const WorkspaceBottomBar = memo(WorkspaceBottomBarInner);
WorkspaceBottomBar.displayName = "WorkspaceBottomBar";
