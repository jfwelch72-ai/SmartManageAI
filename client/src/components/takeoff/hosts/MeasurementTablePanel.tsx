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
  onClose: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, data: Partial<TakeoffMeasurement>) => void;
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
          scalePxPerFoot={props.scalePxPerFoot ?? undefined}
        />
      </div>
    </div>
  );
}

export const MeasurementTablePanel = memo(MeasurementTablePanelInner);
MeasurementTablePanel.displayName = "MeasurementTablePanel";
