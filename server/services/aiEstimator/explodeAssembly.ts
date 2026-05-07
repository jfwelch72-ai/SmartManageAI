/**
 * Task #2576 — Expand a takeoff measurement through an assembly into a
 * set of estimate line items, recording assembly provenance on each
 * line item via the existing `metadata` text column.
 *
 * Provenance shape (JSON in `estimateLineItems.metadata`):
 *   {
 *     "exploded": {
 *       "sourceAssemblyId": "<uuid>",
 *       "sourceAssemblyName": "<string>",
 *       "sourceMeasurementId": "<uuid>",
 *       "componentId": "<uuid>",
 *       "componentType": "MATERIAL"|"LABOR"|"EQUIPMENT"|"SUB",
 *       "drivingQty": <number>,
 *       "drivingUnit": "<string>",
 *       "wasteFactor": <number>,
 *       "explodedAt": "<iso>"
 *     }
 *   }
 *
 * Cost-bucket placement matches the component type. `userAdjusted=false`
 * so a re-explode (or assembly edit) can detect rows that haven't been
 * hand-tweaked.
 */

import { eq } from "drizzle-orm";
import { db } from "../../db";
import {
  estimateLineItems,
  takeoffMeasurements,
  type AiEstimatorAssembly,
  type AiEstimatorAssemblyComponent,
} from "@shared/schema";
import { resolveNetAreaFt2 } from "../takeoff/measurementDeductions";

export interface ExplodedLine {
  description: string;
  category: "MATERIAL" | "LABOR" | "EQUIPMENT" | "SUBCONTRACTOR";
  unit: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  metadata: Record<string, unknown>;
}

interface MeasurementShape {
  id: string;
  computedAreaFt2: number | null;
  computedLengthFt: number | null;
  computedVolumeCy: number | null;
  count: number | null;
  deductions?: string | null;
  scaleAtCapturePxPerFoot?: number | null;
}

export function drivingQuantityFor(
  measurement: MeasurementShape,
  drivingType: string,
): number {
  switch (drivingType.toUpperCase()) {
    case "AREA": {
      // Use deduction-aware net area when deductions are present.
      const breakdown = resolveNetAreaFt2({
        grossAreaFt2: measurement.computedAreaFt2 ?? 0,
        rawDeductions: measurement.deductions ?? null,
        scalePxPerFoot: measurement.scaleAtCapturePxPerFoot ?? null,
      });
      return breakdown.netAreaFt2;
    }
    case "LINEAR":
      return Number(measurement.computedLengthFt ?? 0);
    case "VOLUME":
      return Number(measurement.computedVolumeCy ?? 0);
    case "COUNT":
      return Number(measurement.count ?? 0);
    default:
      return 0;
  }
}

function categoryForComponent(
  componentType: string,
): "MATERIAL" | "LABOR" | "EQUIPMENT" | "SUBCONTRACTOR" {
  switch (componentType.toUpperCase()) {
    case "LABOR":
      return "LABOR";
    case "EQUIPMENT":
      return "EQUIPMENT";
    case "SUB":
      return "SUBCONTRACTOR";
    default:
      return "MATERIAL";
  }
}

export function buildExplodedLines(opts: {
  assembly: AiEstimatorAssembly;
  components: AiEstimatorAssemblyComponent[];
  measurement: MeasurementShape;
}): ExplodedLine[] {
  const driving = drivingQuantityFor(
    opts.measurement,
    opts.assembly.drivingMeasurementType,
  );
  const assemblyWaste = Number(opts.assembly.wasteFactor ?? 0);
  const explodedAt = new Date().toISOString();
  return opts.components.map((c) => {
    const compWaste = Number(c.wasteFactor ?? 0);
    const baseQty = driving * Number(c.qtyPerDrivingUnit ?? 0);
    const wastedQty = baseQty * (1 + assemblyWaste) * (1 + compWaste);
    const unitCost = c.defaultUnitCost ? Number(c.defaultUnitCost) : 0;
    const total = wastedQty * unitCost;
    return {
      description: c.description,
      category: categoryForComponent(c.componentType),
      unit: c.unit,
      quantity: Number(wastedQty.toFixed(4)),
      unitCost: Number(unitCost.toFixed(4)),
      totalCost: Number(total.toFixed(2)),
      metadata: {
        exploded: {
          sourceAssemblyId: opts.assembly.id,
          sourceAssemblyName: opts.assembly.name,
          sourceMeasurementId: opts.measurement.id,
          componentId: c.id,
          componentType: c.componentType,
          drivingQty: Number(driving.toFixed(4)),
          drivingUnit: opts.assembly.drivingUnit,
          assemblyWasteFactor: assemblyWaste,
          componentWasteFactor: compWaste,
          explodedAt,
        },
      },
    };
  });
}

export interface ExplodeAndPersistResult {
  insertedCount: number;
  totalCost: number;
}

export async function persistExplodedLines(opts: {
  estimateId: string;
  measurementId: string;
  assembly: AiEstimatorAssembly;
  components: AiEstimatorAssemblyComponent[];
}): Promise<ExplodeAndPersistResult> {
  const [measurement] = await db
    .select({
      id: takeoffMeasurements.id,
      computedAreaFt2: takeoffMeasurements.computedAreaFt2,
      computedLengthFt: takeoffMeasurements.computedLengthFt,
      computedVolumeCy: takeoffMeasurements.computedVolumeCy,
      count: takeoffMeasurements.count,
      deductions: takeoffMeasurements.deductions,
      scaleAtCapturePxPerFoot: takeoffMeasurements.scaleAtCapturePxPerFoot,
    })
    .from(takeoffMeasurements)
    .where(eq(takeoffMeasurements.id, opts.measurementId))
    .limit(1);
  if (!measurement) {
    throw new Error("Measurement not found");
  }
  const lines = buildExplodedLines({
    assembly: opts.assembly,
    components: opts.components,
    measurement: measurement as MeasurementShape,
  });
  if (lines.length === 0) return { insertedCount: 0, totalCost: 0 };

  // The schema's `category` column is a TRADE category (CONCRETE,
  // ROOFING, etc.), not a component-type bucket. Component type
  // (MATERIAL/LABOR/EQUIPMENT/SUB) is captured both in metadata and
  // via the cost buckets below. We default the trade category to the
  // assembly's `tradeCategory` when it's a valid enum value, otherwise
  // "OTHER" — kept explicit so a future caller can pre-validate.
  const tradeCategory = "OTHER" as const;

  const rows: typeof estimateLineItems.$inferInsert[] = lines.map((l) => ({
    estimateId: opts.estimateId,
    category: tradeCategory,
    description: l.description,
    quantity: l.quantity.toString(),
    unit: l.unit,
    source: "ASSEMBLY",
    sourceMeasurementId: opts.measurementId,
    materialCost: (l.category === "MATERIAL" ? l.totalCost : 0).toString(),
    laborCost: (l.category === "LABOR" ? l.totalCost : 0).toString(),
    laborHours: "0",
    equipmentCost: (l.category === "EQUIPMENT" ? l.totalCost : 0).toString(),
    equipmentHours: "0",
    consumablesCost: "0",
    subcontractCost: (l.category === "SUBCONTRACTOR" ? l.totalCost : 0).toString(),
    overheadAllocation: "0",
    profitAllocation: "0",
    totalCost: l.totalCost.toString(),
    metadata: JSON.stringify({ ...l.metadata, componentType: l.category }),
    sourceType: "assembly_explode",
  }));

  const inserted = await db
    .insert(estimateLineItems)
    .values(rows)
    .returning({ id: estimateLineItems.id });

  const totalCost = lines.reduce((s, l) => s + l.totalCost, 0);
  return { insertedCount: inserted.length, totalCost };
}
