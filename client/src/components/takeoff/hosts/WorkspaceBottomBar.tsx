import { memo } from "react";
import { DollarSign, Layers, TableProperties, Trash2 } from "lucide-react";
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
  stageScale: number;
  currentSheet: TakeoffSheet | null | undefined;
}

function WorkspaceBottomBarInner(props: WorkspaceBottomBarProps) {
  const {
    selectedMeasurementCount, bulkDeletePending, onBulkDelete, onClearSelection,
    selectedSheet, measurements, showCostPanel, onToggleCostPanel,
    showOverlaySlider, onToggleOverlaySlider, showMeasurementTable, onToggleMeasurementTable,
    stageScale, currentSheet,
  } = props;

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
            <span>Zoom: {Math.round(stageScale * 100)}%</span>
            {currentSheet?.scalePxPerFoot ? (
              <span className="text-green-600 dark:text-green-400">Scale: {currentSheet.units || "ft"}</span>
            ) : (
              <span className="text-amber-600 dark:text-amber-400">Not Calibrated</span>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export const WorkspaceBottomBar = memo(WorkspaceBottomBarInner);
WorkspaceBottomBar.displayName = "WorkspaceBottomBar";
