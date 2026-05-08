import { memo } from "react";
import { TableProperties, X } from "lucide-react";
import { MeasurementTable } from "../MeasurementTable";
import type { QuantityCategory, TakeoffMeasurement } from "@shared/schema";

export interface MeasurementTablePanelProps {
  visible: boolean;
  measurements: TakeoffMeasurement[];
  categories: QuantityCategory[];
  selectedMeasurementId: string | null;
  scalePxPerFoot: number | null | undefined;
  // Task #2345 — drift remediation pass-throughs. Optional so the
  // panel works for embedders that haven't wired the feature yet.
  scaleLabel?: string | null;
  onRemediateDrift?: (measurementId: string, action: "recapture" | "mark_stale") => void;
  onBulkRemediateDrift?: (action: "recapture" | "mark_stale") => void;
  isRemediatingDrift?: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, data: Partial<TakeoffMeasurement>) => void;
  /**
   * Task #2334 — Per-row unlock-and-rescale. Forwarded to the
   * MeasurementTable so the Locked badge can expose an "Unlock &
   * rescale" affordance that re-derives length/area against the
   * sheet's current scale. Optional so older callers (tests / panels
   * that never show locked rows) can omit it without a type break.
   */
  onUnlockAndRescale?: (id: string) => void;
  /**
   * Task #2357 — Bulk unlock-and-rescale. Forwarded to the
   * MeasurementTable so the toolbar can surface an "Unlock all
   * locked" action that releases every locked row in one round-trip
   * via `/api/takeoff/measurements/bulk-unlock-rescale`. Optional so
   * older callers stay non-actionable (the button only renders when
   * the callback is wired AND there is at least one locked row).
   */
  onBulkUnlockAndRescale?: (ids: string[]) => void | Promise<void>;
  isBulkUnlocking?: boolean;
  /**
   * Task #2581 — Base-bid vs change-order scope tagging pass-throughs.
   * When `onMoveScope` is wired the table renders the BASE/CO chip,
   * scope filter, and right-click "Move to…" entries. `changeOrders`
   * populates the picker dialog. Optional so the panel keeps working
   * for embedders (bid-context workspaces, tests) that haven't wired
   * the project-scoped change-order list yet.
   */
  changeOrders?: Array<{ id: string; changeOrderNumber: string; description?: string | null; status?: string | null }>;
  onMoveScope?: (
    measurementId: string,
    payload: { scopeTag: "BASE" | "CO"; changeOrderId: string | null },
  ) => void;
  /** Task #2588 — Bulk move many measurements in one round-trip. */
  onBulkMoveScope?: (
    ids: string[],
    payload: { scopeTag: "BASE" | "CO"; changeOrderId: string | null },
  ) => void | Promise<void>;
  isMovingScope?: boolean;
  /**
   * Task #2617 — Measurement-group filter + AI review-batch delete
   * pass-throughs. Forwarded to the MeasurementTable so the toolbar
   * can scope the panel to a single group and bulk-delete the AI
   * map-reduce review batch in one click.
   */
  groups?: Array<{ id: string; name: string; color?: string | null }>;
  onDeleteGroup?: (groupId: string) => void | Promise<void>;
  isDeletingGroup?: boolean;
  /**
   * Task #2630 — Programmatic group-filter request forwarded from the
   * workspace. Used by the AI map-reduce apply-toast "Review batch"
   * action to scope the panel to the freshly-created group.
   */
  groupFilterRequest?: { groupId: string; nonce: number } | null;
}

function MeasurementTablePanelInner(props: MeasurementTablePanelProps) {
  if (!props.visible) return null;
  return (
    <div className="fixed bottom-0 left-[65px] right-0 z-30 bg-card border-t shadow-lg" style={{ height: "35vh" }} data-testid="measurement-table-panel">
      <div className="flex items-center justify-between px-3 py-1 border-b bg-muted/30">
        <span className="text-xs font-semibold flex items-center gap-1.5">
          <TableProperties className="w-3.5 h-3.5" />
          Measurements ({props.measurements.length})
        </span>
        <button onClick={props.onClose} className="text-muted-foreground hover:text-foreground p-0.5" data-testid="close-measurement-table">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div style={{ height: "calc(35vh - 30px)" }}>
        <MeasurementTable
          measurements={props.measurements}
          categories={props.categories}
          selectedMeasurementId={props.selectedMeasurementId}
          onSelect={props.onSelect}
          onDelete={props.onDelete}
          onUpdate={props.onUpdate}
          onUnlockAndRescale={props.onUnlockAndRescale}
          onBulkUnlockAndRescale={props.onBulkUnlockAndRescale}
          isBulkUnlocking={props.isBulkUnlocking}
          scalePxPerFoot={props.scalePxPerFoot ?? undefined}
          scaleLabel={props.scaleLabel ?? undefined}
          onRemediateDrift={props.onRemediateDrift}
          onBulkRemediateDrift={props.onBulkRemediateDrift}
          isRemediatingDrift={props.isRemediatingDrift}
          changeOrders={props.changeOrders}
          onMoveScope={props.onMoveScope}
          onBulkMoveScope={props.onBulkMoveScope}
          isMovingScope={props.isMovingScope}
          groups={props.groups}
          onDeleteGroup={props.onDeleteGroup}
          isDeletingGroup={props.isDeletingGroup}
          groupFilterRequest={props.groupFilterRequest}
        />
      </div>
    </div>
  );
}

export const MeasurementTablePanel = memo(MeasurementTablePanelInner);
MeasurementTablePanel.displayName = "MeasurementTablePanel";
