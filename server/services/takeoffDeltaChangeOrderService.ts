import { db } from "../db";
import { changeOrders, projects, takeoffSheets, takeoffVersions, takeoffMeasurements } from "@shared/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { logError, logInfo } from "../utils/logger";

interface DeltaItem {
  label: string;
  type: string;
  costDelta: number;
  lengthDelta?: number;
  areaDelta?: number;
  volumeDelta?: number;
  oldQuantity?: number;
  newQuantity?: number;
  costCodeId?: string | null;
  measurementType?: string;
  unitCost?: number | null;
}

interface TakeoffDeltaResult {
  addedCount: number;
  removedCount: number;
  changedCount: number;
  totalCostDelta: number;
  added: DeltaItem[];
  removed: DeltaItem[];
  changed: DeltaItem[];
  oldSheetId: string;
  newSheetId: string;
}

function getQty(m: { computedAreaFt2: number | null; computedLengthFt: number | null; computedVolumeCy: number | null; count: number | null }) {
  return m.computedAreaFt2 || m.computedLengthFt || m.computedVolumeCy || m.count || 0;
}

function getCost(m: { unitCost: number | null; computedAreaFt2: number | null; computedLengthFt: number | null; computedVolumeCy: number | null; count: number | null }) {
  return (m.unitCost || 0) * getQty(m);
}

export async function computeTakeoffDelta(oldSheetId: string, newSheetId: string): Promise<TakeoffDeltaResult | null> {
  const oldVersions = await db.select().from(takeoffVersions)
    .where(eq(takeoffVersions.sheetId, oldSheetId))
    .orderBy(desc(takeoffVersions.versionNumber))
    .limit(1);

  const newVersions = await db.select().from(takeoffVersions)
    .where(eq(takeoffVersions.sheetId, newSheetId))
    .orderBy(desc(takeoffVersions.versionNumber))
    .limit(1);

  if (!oldVersions.length || !newVersions.length) return null;

  const oldVersion = oldVersions[0];
  const newVersion = newVersions[0];

  const measurementsA = await db.select().from(takeoffMeasurements)
    .where(eq(takeoffMeasurements.takeoffVersionId, oldVersion.id));
  const measurementsB = await db.select().from(takeoffMeasurements)
    .where(eq(takeoffMeasurements.takeoffVersionId, newVersion.id));

  if (measurementsA.length === 0 && measurementsB.length === 0) return null;

  type MRow = typeof measurementsA[number];
  const getLineageKey = (m: MRow) => m.originMeasurementId || m.id;

  const mapA = new Map(measurementsA.map(m => [getLineageKey(m), m]));
  const mapB = new Map(measurementsB.map(m => [getLineageKey(m), m]));

  const added: DeltaItem[] = [];
  const removed: DeltaItem[] = [];
  const changed: DeltaItem[] = [];

  for (const [key, mB] of mapB) {
    const mA = mapA.get(key);
    if (!mA) {
      added.push({
        label: mB.label,
        type: "added",
        costDelta: getCost(mB),
        newQuantity: getQty(mB),
        costCodeId: mB.costCodeId,
        measurementType: mB.type,
        unitCost: mB.unitCost,
      });
    } else {
      const lengthDelta = (mB.computedLengthFt || 0) - (mA.computedLengthFt || 0);
      const areaDelta = (mB.computedAreaFt2 || 0) - (mA.computedAreaFt2 || 0);
      const volumeDelta = (mB.computedVolumeCy || 0) - (mA.computedVolumeCy || 0);
      const countDelta = (mB.count || 0) - (mA.count || 0);
      const costDelta = getCost(mB) - getCost(mA);
      const qtyDelta = getQty(mB) - getQty(mA);

      if (Math.abs(lengthDelta) > 0.01 || Math.abs(areaDelta) > 0.01 || Math.abs(volumeDelta) > 0.01 || Math.abs(countDelta) > 0.5 || Math.abs(costDelta) > 0.01 || Math.abs(qtyDelta) > 0.01) {
        changed.push({
          label: mB.label,
          type: "changed",
          costDelta,
          lengthDelta,
          areaDelta,
          volumeDelta,
          oldQuantity: getQty(mA),
          newQuantity: getQty(mB),
          costCodeId: mB.costCodeId,
          measurementType: mB.type,
          unitCost: mB.unitCost,
        });
      }
    }
  }

  for (const [key, mA] of mapA) {
    if (!mapB.has(key)) {
      removed.push({
        label: mA.label,
        type: "removed",
        costDelta: -getCost(mA),
        oldQuantity: getQty(mA),
        costCodeId: mA.costCodeId,
        measurementType: mA.type,
        unitCost: mA.unitCost,
      });
    }
  }

  if (added.length === 0 && removed.length === 0 && changed.length === 0) {
    return null;
  }

  const totalCostDelta = [...added, ...removed, ...changed].reduce((sum, d) => sum + d.costDelta, 0);

  return {
    addedCount: added.length,
    removedCount: removed.length,
    changedCount: changed.length,
    totalCostDelta,
    added,
    removed,
    changed,
    oldSheetId,
    newSheetId,
  };
}

interface CreateCOResult {
  changeOrderId: string;
  created: boolean;
}

export async function createChangeOrderFromDelta(
  projectId: string,
  orgId: string,
  actorId: string,
  delta: TakeoffDeltaResult,
  oldSheetName: string | null,
  newSheetName: string | null,
  revisionLabel: string | null,
): Promise<CreateCOResult | null> {
  const [project] = await db.select().from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) {
    logError("takeoffDeltaCO: project not found", { projectId });
    return null;
  }

  if (!project.autoChangeOrderEnabled) {
    logInfo("takeoffDeltaCO: auto-CO disabled for project", { projectId });
    return null;
  }

  const threshold = Math.max(0, Number(project.autoChangeOrderThreshold || 0));
  if (Math.abs(delta.totalCostDelta) < threshold) {
    logInfo("takeoffDeltaCO: delta below threshold, skipping CO creation", {
      projectId,
      totalCostDelta: delta.totalCostDelta,
      threshold,
    });
    return null;
  }

  const existingCO = await db.select({ id: changeOrders.id }).from(changeOrders)
    .where(and(
      eq(changeOrders.projectId, projectId),
      eq(changeOrders.source, "TAKEOFF_DELTA"),
      sql`${changeOrders.takeoffDeltaJson} IS NOT NULL AND ${changeOrders.takeoffDeltaJson}::jsonb->>'oldSheetId' = ${delta.oldSheetId} AND ${changeOrders.takeoffDeltaJson}::jsonb->>'newSheetId' = ${delta.newSheetId}`,
    ))
    .limit(1);

  if (existingCO.length > 0) {
    logInfo("takeoffDeltaCO: CO already exists for this sheet pair, skipping", {
      projectId,
      oldSheetId: delta.oldSheetId,
      newSheetId: delta.newSheetId,
      existingCOId: existingCO[0].id,
    });
    return { changeOrderId: existingCO[0].id, created: false };
  }

  const oldLabel = oldSheetName || "Previous Revision";
  const newLabel = newSheetName || "New Revision";
  const revLabel = revisionLabel ? ` (${revisionLabel})` : "";
  const title = `Plan Revision: ${oldLabel} → ${newLabel}${revLabel}`;
  const sheetLabel = newSheetName || oldSheetName || "Sheet";

  const maxCoNum = await db
    .select({
      max: sql<number>`COALESCE(MAX(CAST(REGEXP_REPLACE(${changeOrders.changeOrderNumber}, '^CO-', '') AS INTEGER)), 0)`,
    })
    .from(changeOrders)
    .where(and(eq(changeOrders.projectId, projectId), sql`${changeOrders.changeOrderNumber} ~ '^CO-\\d+$'`));

  const nextNum = (maxCoNum[0]?.max || 0) + 1;
  const changeOrderNumber = `CO-${String(nextNum).padStart(3, "0")}`;

  const deltaJson = JSON.stringify({
    oldSheetId: delta.oldSheetId,
    newSheetId: delta.newSheetId,
    addedCount: delta.addedCount,
    removedCount: delta.removedCount,
    changedCount: delta.changedCount,
    totalCostDelta: delta.totalCostDelta,
    items: [...delta.added, ...delta.removed, ...delta.changed].slice(0, 50),
  });

  const descriptionParts = [`Auto-generated from takeoff revision comparison.`];
  if (delta.addedCount > 0) descriptionParts.push(`${delta.addedCount} measurement(s) added.`);
  if (delta.removedCount > 0) descriptionParts.push(`${delta.removedCount} measurement(s) removed.`);
  if (delta.changedCount > 0) descriptionParts.push(`${delta.changedCount} measurement(s) changed.`);
  descriptionParts.push(`Total cost impact: $${delta.totalCostDelta.toFixed(2)}`);

  const allItems = [...delta.added, ...delta.removed, ...delta.changed];
  const totalQtyDelta = allItems.reduce((sum, d) => sum + ((d.newQuantity || 0) - (d.oldQuantity || 0)), 0);

  const unitMap: Record<string, string> = {
    AREA: "SF",
    LINEAR: "LF",
    VOLUME: "CY",
    COUNT: "EA",
  };
  const primaryType = allItems[0]?.measurementType || "AREA";
  const scopeUnit = unitMap[primaryType] || "EA";

  const costBreakdown = allItems.slice(0, 50).map(item => ({
    description: item.label,
    changeType: item.type,
    costDelta: item.costDelta,
    oldQuantity: item.oldQuantity || 0,
    newQuantity: item.newQuantity || 0,
    unitCost: item.unitCost || 0,
    costCodeId: item.costCodeId || null,
  }));

  try {
    const [newCO] = await db.insert(changeOrders).values({
      projectId,
      changeOrderNumber,
      description: `${title}\n\n${descriptionParts.join(" ")}`,
      amount: String(delta.totalCostDelta.toFixed(2)),
      status: "PCO",
      requestedById: actorId,
      source: "TAKEOFF_DELTA",
      takeoffDeltaJson: deltaJson,
      scopeUnit,
      scopeQuantity: String(Math.abs(totalQtyDelta).toFixed(2)),
      costBreakdownJson: JSON.stringify(costBreakdown),
      workTypeName: `Takeoff Revision: ${sheetLabel}`,
      workTypeCode: `TAKEOFF-REV-${sheetLabel.replace(/[^a-zA-Z0-9]/g, "-").toUpperCase()}`,
    }).returning();

    if (newCO) {
      logInfo("takeoffDeltaCO: auto-created change order from takeoff delta", {
        changeOrderId: newCO.id,
        projectId,
        totalCostDelta: delta.totalCostDelta,
      });
      return { changeOrderId: newCO.id, created: true };
    }
  } catch (err) {
    logError("takeoffDeltaCO: failed to create change order", {
      error: String(err),
      projectId,
    });
  }

  return null;
}
