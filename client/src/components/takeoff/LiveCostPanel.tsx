import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DollarSign, ChevronDown, ChevronUp, X, Minimize2, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TakeoffMeasurement, QuantityCategory } from "@shared/schema";
import { evaluateFormula, computeAssemblyResults, type FormulaContext } from "@shared/utils/assemblyFormula";

interface LiveCostPanelProps {
  measurements: TakeoffMeasurement[];
  categories: QuantityCategory[];
  visible: boolean;
  onClose: () => void;
}

interface AssemblyLineItem {
  name: string;
  unit: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
}

interface CategorySummary {
  id: string;
  name: string;
  color: string;
  totalQty: number;
  unit: string;
  totalCost: number;
  count: number;
  wasteFactor: number;
  assemblyItems: AssemblyLineItem[];
  formulaAdjusted: boolean;
}

function parseMeta(metadata: string | null | undefined | Record<string, unknown>): Record<string, any> {
  if (!metadata) return {};
  try {
    return typeof metadata === "string" ? JSON.parse(metadata) : metadata;
  } catch {
    return {};
  }
}

function getMeasurementQty(m: TakeoffMeasurement): { qty: number; unit: string } {
  const meta = parseMeta(m.metadata);
  if (m.type === "COUNT") {
    return { qty: m.count ?? meta.quantity ?? 1, unit: meta.unit || "EA" };
  }
  if (m.type === "LINEAR" || m.type === "LINEAR_WITH_DROP" || m.type === "PITCHED_LINEAR" || m.type === "SEGMENT") {
    return { qty: m.computedLengthFt ?? 0, unit: "LF" };
  }
  if (m.type === "AREA" || m.type === "PITCHED_AREA" || m.type === "SURFACE_AREA") {
    return { qty: m.computedSurfaceAreaFt2 ?? m.computedAreaFt2 ?? 0, unit: "SF" };
  }
  if (m.type === "VOLUME") {
    return { qty: m.computedVolumeCy ?? 0, unit: "CY" };
  }
  return { qty: 0, unit: "" };
}

export function LiveCostPanel({ measurements, categories, visible, onClose }: LiveCostPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [minimized, setMinimized] = useState(false);

  if (!visible) return null;

  const summaries: CategorySummary[] = [];
  const uncategorized: CategorySummary = { id: "__none__", name: "Uncategorized", color: "#9ca3af", totalQty: 0, unit: "", totalCost: 0, count: 0, wasteFactor: 0, assemblyItems: [], formulaAdjusted: false };

  const catMap = new Map<string, CategorySummary>();
  for (const cat of categories) {
    catMap.set(cat.id, {
      id: cat.id,
      name: cat.name,
      color: cat.color,
      totalQty: 0,
      unit: "",
      totalCost: 0,
      count: 0,
      wasteFactor: cat.wasteFactor ?? 0,
      assemblyItems: [],
      formulaAdjusted: false,
    });
  }

  for (const m of measurements) {
    if (m.type === "NOTE") continue;
    const { qty, unit } = getMeasurementQty(m);
    const meta = parseMeta(m.metadata);
    const unitCost = m.unitCost ?? meta.unitCost ?? 0;
    const cat = m.categoryId ? catMap.get(m.categoryId) : null;
    const target = cat || uncategorized;
    const wasteMultiplier = 1 + (target.wasteFactor / 100);

    let effectiveQty = qty;
    const measCtx: FormulaContext = {
      length: m.computedLengthFt ?? 0,
      area: m.computedAreaFt2 ?? 0,
      volume: m.computedVolumeCy ?? 0,
      count: m.count ?? 1,
      depth: m.depthFeet ?? 0,
    };

    if (meta.conditionFormula) {
      effectiveQty = evaluateFormula(meta.conditionFormula, measCtx);
      target.formulaAdjusted = true;
    }

    let assemblyCost = 0;
    let assemblyResults: Array<{ name: string; unit: string; quantity: number; unitCost: number; totalCost: number }> = [];

    if (meta.assemblyComponents) {
      try {
        const components = typeof meta.assemblyComponents === "string" ? JSON.parse(meta.assemblyComponents) : meta.assemblyComponents;
        if (Array.isArray(components) && components.length > 0) {
          assemblyResults = computeAssemblyResults(components, measCtx);
        }
      } catch { /* ignore parse errors */ }
    }
    if (assemblyResults.length === 0 && meta.assemblyResults && Array.isArray(meta.assemblyResults)) {
      assemblyResults = meta.assemblyResults;
    }

    for (const result of assemblyResults) {
      assemblyCost += result.totalCost || 0;
      const existingItem = target.assemblyItems.find(a => a.name === result.name && a.unit === result.unit);
      if (existingItem) {
        existingItem.quantity += result.quantity;
        existingItem.totalCost += result.totalCost;
      } else {
        target.assemblyItems.push({
          name: result.name,
          unit: result.unit,
          quantity: result.quantity,
          unitCost: result.unitCost,
          totalCost: result.totalCost,
        });
      }
    }

    target.totalQty += effectiveQty * wasteMultiplier;
    target.totalCost += assemblyCost > 0 ? assemblyCost : effectiveQty * wasteMultiplier * unitCost;
    target.count++;
    if (!target.unit) target.unit = unit;
  }

  for (const cat of categories) {
    const summary = catMap.get(cat.id);
    if (summary && summary.count > 0) summaries.push(summary);
  }
  if (uncategorized.count > 0) summaries.push(uncategorized);

  const grandTotal = summaries.reduce((s, c) => s + c.totalCost, 0);
  const totalItems = summaries.reduce((s, c) => s + c.count, 0);

  if (minimized) {
    return (
      <div
        className="absolute bottom-4 right-4 z-30 bg-card/95 backdrop-blur-sm border rounded-lg shadow-lg px-3 py-2 flex items-center gap-2 cursor-pointer hover:bg-card"
        onClick={() => setMinimized(false)}
        data-testid="live-cost-panel-minimized"
      >
        <DollarSign className="w-4 h-4 text-green-600" />
        <span className="text-sm font-semibold">{grandTotal > 0 ? `$${grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `${totalItems} items`}</span>
        <Maximize2 className="w-3 h-3 text-muted-foreground" />
      </div>
    );
  }

  return (
    <div
      className="absolute bottom-4 right-4 z-30 bg-card/95 backdrop-blur-sm border rounded-lg shadow-lg w-[280px] max-h-[50vh] flex flex-col"
      data-testid="live-cost-panel"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b shrink-0">
        <div className="flex items-center gap-1.5">
          <DollarSign className="w-4 h-4 text-green-600" />
          <span className="text-sm font-semibold">Live Cost Summary</span>
        </div>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setCollapsed(!collapsed)} data-testid="button-toggle-cost-collapse">
            {collapsed ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setMinimized(true)} data-testid="button-minimize-cost">
            <Minimize2 className="w-3 h-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={onClose} data-testid="button-close-cost-panel">
            <X className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {!collapsed && (
        <div className="overflow-y-auto flex-1 p-2 space-y-1.5">
          {summaries.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-3">No measurements yet</p>
          ) : (
            summaries.map((s) => (
              <div key={s.id} className="p-1.5 rounded hover:bg-muted/50 text-xs" data-testid={`cost-category-${s.id}`}>
                <div className="flex items-start gap-2">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0 mt-0.5" style={{ backgroundColor: s.color }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="font-medium truncate">{s.name}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        {s.formulaAdjusted && <Badge variant="outline" className="text-[8px] px-0.5 h-3 text-violet-600">fx</Badge>}
                        <Badge variant="secondary" className="text-[9px] px-1 h-4">{s.count}</Badge>
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-0.5 text-muted-foreground">
                      <span>{s.totalQty.toLocaleString(undefined, { maximumFractionDigits: 1 })} {s.unit}</span>
                      <span className="font-mono">{s.totalCost > 0 ? `$${s.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}</span>
                    </div>
                  </div>
                </div>
                {s.assemblyItems.length > 0 && (
                  <div className="ml-5 mt-1 space-y-0.5 border-l-2 pl-2" style={{ borderColor: s.color }}>
                    {s.assemblyItems.map((item, idx) => (
                      <div key={idx} className="flex items-center justify-between text-[10px] text-muted-foreground" data-testid={`assembly-output-${s.id}-${idx}`}>
                        <span className="truncate">{item.name} — {item.quantity.toLocaleString(undefined, { maximumFractionDigits: 1 })} {item.unit}</span>
                        <span className="font-mono shrink-0 ml-1">{item.totalCost > 0 ? `$${item.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ""}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      <div className="border-t px-3 py-2 shrink-0 bg-primary/5">
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold">Total</span>
          <div className="text-right">
            <span className="font-mono font-bold" data-testid="text-grand-total">
              {grandTotal > 0 ? `$${grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
            </span>
            <span className="text-[10px] text-muted-foreground ml-1">({totalItems})</span>
          </div>
        </div>
      </div>
    </div>
  );
}
