/**
 * Task #3045 — Division Filter Panel for AI overlay visibility control.
 * Task #3050 — Confidence threshold filter added.
 *
 * Right-side drawer listing all CSI divisions present in the current sheet's
 * AI-geometry measurements.  Each row shows a color swatch, the CSI code +
 * full name, item count, and a toggle checkbox.  A "Show all / Hide all"
 * master row is included at the top.
 *
 * A confidence threshold segmented control (ALL / LOW / MEDIUM / HIGH) is
 * rendered below the panel header so estimators can hide low-confidence items.
 *
 * Toggle state is kept in caller-managed `hiddenDivisions` (a Set of division
 * codes that should NOT be rendered).  Resets per session — no backend needed.
 *
 * Task #3048 — When `editingMeasurementId` is set, a save/cancel banner
 * appears at the top of the panel so estimators can commit or discard
 * vertex-drag geometry corrections.
 */

import { useMemo } from "react";
import { X, Layers, Check, RotateCcw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  CSI_DIVISION_NAMES,
  CSI_DIVISIONS_ORDERED,
  getCsiDivisionColor,
} from "@shared/csiDivisionColors";
import type { TakeoffMeasurement } from "@shared/schema";

export type ConfidenceThreshold = "ALL" | "LOW" | "MEDIUM" | "HIGH";

const CONFIDENCE_OPTIONS: { value: ConfidenceThreshold; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Med" },
  { value: "HIGH", label: "High" },
];

export interface DivisionFilterPanelProps {
  open: boolean;
  onClose: () => void;
  measurements: TakeoffMeasurement[];
  hiddenDivisions: Set<string>;
  onToggleDivision: (code: string) => void;
  onShowAll: () => void;
  onHideAll: (codes: string[]) => void;

  /** Task #3048 — id of the measurement currently being reshaped (or null). */
  editingMeasurementId?: string | null;
  /** Task #3048 — whether the save PATCH is in flight. */
  isSavingEdit?: boolean;
  /** Task #3048 — commit the current vertex-drag draft to the server. */
  onSaveEdit?: () => void;
  /** Task #3048 — discard the current vertex-drag draft. */
  onCancelEdit?: () => void;

  /** Task #3050 — active confidence threshold for filtering overlays. */
  confidenceThreshold: ConfidenceThreshold;
  onConfidenceThresholdChange: (threshold: ConfidenceThreshold) => void;
}

interface DivisionRow {
  code: string;
  name: string;
  color: string;
  count: number;
}

export function DivisionFilterPanel({
  open,
  onClose,
  measurements,
  hiddenDivisions,
  onToggleDivision,
  onShowAll,
  onHideAll,
  editingMeasurementId,
  isSavingEdit,
  onSaveEdit,
  onCancelEdit,
  confidenceThreshold,
  onConfidenceThresholdChange,
}: DivisionFilterPanelProps) {
  const rows: DivisionRow[] = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of measurements) {
      if (!m.aiGeometry) continue;
      const code = m.csiDivision ?? "UNKNOWN";
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
    const result: DivisionRow[] = [];
    for (const code of CSI_DIVISIONS_ORDERED) {
      const count = counts.get(code);
      if (count === undefined) continue;
      result.push({
        code,
        name: CSI_DIVISION_NAMES[code] ?? code,
        color: getCsiDivisionColor(code),
        count,
      });
    }
    for (const [code, count] of counts) {
      if (!CSI_DIVISION_NAMES[code]) {
        result.push({
          code,
          name: code,
          color: getCsiDivisionColor(code),
          count,
        });
      }
    }
    return result;
  }, [measurements]);

  const isEditing = !!editingMeasurementId;

  if (!open && !isEditing) return null;

  const allCodes = rows.map((r) => r.code);
  const allVisible = allCodes.every((c) => !hiddenDivisions.has(c));
  const someVisible = allCodes.some((c) => !hiddenDivisions.has(c));

  return (
    <div
      className={cn(
        "absolute top-0 right-0 h-full z-40 flex flex-col",
        "w-72 bg-card border-l shadow-xl"
      )}
      data-testid="division-filter-panel"
    >
      {/* Task #3048 — Save / Cancel banner shown while vertex-drag reshape is active. */}
      {isEditing && (
        <div
          className="flex items-center gap-2 px-3 py-2.5 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800 shrink-0"
          data-testid="ai-geometry-edit-banner"
        >
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 leading-tight">
              Reshaping AI polygon
            </p>
            <p className="text-[10px] text-amber-700 dark:text-amber-400 leading-tight mt-0.5">
              Drag vertices to correct the geometry, then save.
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-amber-700 hover:text-amber-900 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900/60"
              onClick={onCancelEdit}
              disabled={isSavingEdit}
              data-testid="button-cancel-ai-geometry-edit"
              title="Discard changes"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
            <Button
              size="icon"
              className="h-7 w-7 bg-amber-600 hover:bg-amber-700 text-white"
              onClick={onSaveEdit}
              disabled={isSavingEdit}
              data-testid="button-save-ai-geometry-edit"
              title="Save geometry"
            >
              {isSavingEdit ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Check className="w-3.5 h-3.5" />
              )}
            </Button>
          </div>
        </div>
      )}

      {open && (
        <>
          <div className="flex items-center justify-between px-3 py-2.5 border-b shrink-0">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Division Overlays</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onClose}
              data-testid="button-close-division-filter"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>

          {/* Task #3050 — Confidence threshold segmented control. */}
          <div className="px-3 py-2 border-b shrink-0">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
              Min confidence
            </p>
            <div
              className="flex rounded-md border overflow-hidden text-xs"
              role="group"
              aria-label="Confidence threshold"
              data-testid="confidence-threshold-group"
            >
              {CONFIDENCE_OPTIONS.map((opt) => {
                const active = confidenceThreshold === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => onConfidenceThresholdChange(opt.value)}
                    className={cn(
                      "flex-1 py-1 font-medium transition-colors select-none",
                      "border-r last:border-r-0",
                      active
                        ? "bg-primary text-primary-foreground"
                        : "bg-background text-muted-foreground hover:bg-muted"
                    )}
                    aria-pressed={active}
                    data-testid={`confidence-threshold-${opt.value.toLowerCase()}`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="flex-1 flex items-center justify-center px-4 text-center">
              <p className="text-sm text-muted-foreground">
                No AI geometry on this sheet.
              </p>
            </div>
          ) : (
            <>
              <div className="px-3 py-2 border-b shrink-0">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="division-filter-all"
                    checked={allVisible}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        onShowAll();
                      } else {
                        onHideAll(allCodes);
                      }
                    }}
                    data-testid="checkbox-division-filter-all"
                    className="rounded-sm"
                  />
                  <label
                    htmlFor="division-filter-all"
                    className="text-xs font-medium text-muted-foreground cursor-pointer select-none"
                  >
                    {allVisible ? "Hide all" : someVisible ? "Show all" : "Show all"}
                  </label>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {rows.reduce((s, r) => s + r.count, 0)} items
                  </span>
                </div>
              </div>

              <ScrollArea className="flex-1 min-h-0">
                <div className="flex flex-col py-1">
                  {rows.map((row) => {
                    const isVisible = !hiddenDivisions.has(row.code);
                    return (
                      <label
                        key={row.code}
                        className={cn(
                          "flex items-center gap-2.5 px-3 py-2 cursor-pointer select-none",
                          "hover:bg-muted/50 transition-colors",
                          !isVisible && "opacity-40"
                        )}
                        data-testid={`division-row-${row.code.replace(" ", "-")}`}
                      >
                        <Checkbox
                          checked={isVisible}
                          onCheckedChange={() => onToggleDivision(row.code)}
                          className="rounded-sm shrink-0"
                          data-testid={`checkbox-division-${row.code.replace(" ", "-")}`}
                        />
                        <span
                          className="w-3 h-3 rounded-sm shrink-0 border border-white/20"
                          style={{ backgroundColor: row.color }}
                          aria-hidden
                        />
                        <div className="flex flex-col min-w-0 flex-1">
                          <span className="text-xs font-medium truncate leading-tight">
                            {row.code}
                          </span>
                          <span className="text-[10px] text-muted-foreground truncate leading-tight">
                            {row.name}
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                          {row.count}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </ScrollArea>
            </>
          )}
        </>
      )}

      {/* When the panel is closed but editing is active, show a minimal close button */}
      {!open && isEditing && (
        <div className="flex-1" />
      )}
    </div>
  );
}
