import { db } from "./db";
import { 
  scheduleOfValues, 
  projects, 
} from "@shared/schema";
import { eq } from "drizzle-orm";
import Decimal from "decimal.js";

export async function verifyProjectAccess(projectId: string, orgId: string | null, shouldFilter: boolean): Promise<{ project: any | null; hasAccess: boolean }> {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) {
    return { project: null, hasAccess: false };
  }

  if (!project.gcOrganizationId) {
    return { project, hasAccess: false };
  }

  if (shouldFilter && orgId && project.gcOrganizationId !== orgId) {
    return { project, hasAccess: false };
  }

  return { project, hasAccess: true };
}

export async function verifySOVAccess(sovId: string, orgId: string | null, shouldFilter: boolean): Promise<{ sov: any | null; hasAccess: boolean }> {
  const [sov] = await db
    .select()
    .from(scheduleOfValues)
    .where(eq(scheduleOfValues.id, sovId))
    .limit(1);

  if (!sov) {
    return { sov: null, hasAccess: false };
  }

  if (shouldFilter && orgId && sov.organizationId !== orgId) {
    return { sov, hasAccess: false };
  }

  return { sov, hasAccess: true };
}

export function calculateSOVTotals(lineItems: any[], retainagePct: number) {
  let totalScheduledValue = new Decimal(0);
  let totalPreviouslyCompleted = new Decimal(0);
  let totalThisPeriod = new Decimal(0);
  let totalMaterialsStored = new Decimal(0);

  lineItems.forEach((item) => {
    const scheduled = new Decimal(item.scheduledValue || 0);
    const previous = new Decimal(item.previouslyCompleted || 0);
    const current = new Decimal(item.thisPeriodCompleted || 0);
    const stored = new Decimal(item.materialsStored || 0);
    
    totalScheduledValue = totalScheduledValue.plus(Decimal.max(0, scheduled));
    totalPreviouslyCompleted = totalPreviouslyCompleted.plus(Decimal.max(0, previous));
    totalThisPeriod = totalThisPeriod.plus(Decimal.max(0, current));
    totalMaterialsStored = totalMaterialsStored.plus(Decimal.max(0, stored));
  });

  const totalCompletedToDate = totalPreviouslyCompleted.plus(totalThisPeriod).plus(totalMaterialsStored);
  const retainageFactor = new Decimal(retainagePct);
  const totalRetainage = totalCompletedToDate.times(retainageFactor);
  const totalEarnedLessRetainage = totalCompletedToDate.minus(totalRetainage);

  return {
    totalScheduledValue: totalScheduledValue.toFixed(2),
    totalPreviouslyCompleted: totalPreviouslyCompleted.toFixed(2),
    totalThisPeriod: totalThisPeriod.toFixed(2),
    totalCompletedToDate: totalCompletedToDate.toFixed(2),
    totalMaterialsStored: totalMaterialsStored.toFixed(2),
    totalRetainage: totalRetainage.toFixed(2),
    totalEarnedLessRetainage: totalEarnedLessRetainage.toFixed(2),
  };
}
