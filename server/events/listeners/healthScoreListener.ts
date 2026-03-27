import { eventBus } from "../eventBus";
import { db } from "../../db";
import { projects } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { recalculateProjectHealthByProjectId } from "../../services/projectHealthService";
import { logInfo, logError } from "../../utils/logger";

async function recalcForProject(eventType: string, orgId: string, projectId: string) {
  if (!projectId || !orgId) return;
  logInfo(`Health score recalc triggered by ${eventType}`, { projectId });
  try {
    await recalculateProjectHealthByProjectId(orgId, projectId);
  } catch (err) {
    logError(`Health recalc failed for ${eventType}`, { error: String(err), projectId });
  }
}

async function recalcAllOrgProjects(eventType: string, orgId: string) {
  if (!orgId) return;
  try {
    const activeProjects = await db.select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.gcOrganizationId, orgId), eq(projects.status, "ACTIVE")));
    for (const project of activeProjects) {
      await recalcForProject(eventType, orgId, project.id);
    }
  } catch (err) {
    logError(`Health recalc for org projects failed for ${eventType}`, { error: String(err), orgId });
  }
}

export function registerHealthScoreListener(): void {
  eventBus.on("change_order.approved", async (event) => {
    await recalcForProject("change_order.approved", event.orgId, event.payload.projectId);
  });

  eventBus.on("change_order.rejected", async (event) => {
    await recalcForProject("change_order.rejected", event.orgId, event.payload.projectId);
  });

  eventBus.on("budget.alert_triggered", async (event) => {
    await recalcForProject("budget.alert_triggered", event.orgId, event.payload.projectId);
  });

  eventBus.on("project.status_changed", async (event) => {
    await recalcForProject("project.status_changed", event.orgId, event.payload.projectId);
  });

  eventBus.on("timeclock.checked_in", async (event) => {
    const projectId = event.payload?.projectId;
    if (projectId) {
      await recalcForProject("timeclock.checked_in", event.orgId, projectId);
    }
  });

  eventBus.on("timeclock.checked_out", async (event) => {
    const projectId = event.payload?.projectId;
    if (projectId) {
      await recalcForProject("timeclock.checked_out", event.orgId, projectId);
    }
  });

  eventBus.on("cost_ledger.posted", async (event) => {
    await recalcForProject("cost_ledger.posted", event.orgId, event.payload.projectId);
  });

  eventBus.on("inspection.completed", async (event) => {
    await recalcForProject("inspection.completed", event.orgId, event.payload.projectId);
  });

  eventBus.on("safety.incident_created", async (event) => {
    await recalcAllOrgProjects("safety.incident_created", event.orgId);
  });

  logInfo("Health score event listener registered");
}
