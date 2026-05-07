// Task #2530 — Shared builder for the platform organization JSON export.
//
// Extracted from `server/platformRoutes.ts` so it can be consumed both by
// the inline `GET /platform/organizations/:orgId/export` route and by the
// queued `bulk_export` handler running in the dedicated job worker
// process (`server/worker.ts`). Keeping this in its own module avoids
// circular imports between the route module and the job handler.

import { db } from "../db";
import { eq, inArray, or, sql } from "drizzle-orm";
import { organizations, users, projects, bids, tasks, equipment, contracts } from "@shared/schema";

export interface OrgExportBuildContext {
  progress?: (pct: number, msg?: string) => Promise<void>;
}

export async function buildOrganizationExport(orgId: string, ctx?: OrgExportBuildContext) {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
  if (!org) throw new Error("Organization not found");
  await ctx?.progress?.(15, "Loading users");
  const orgUsers = await db.select({
    id: users.id,
    firstName: users.firstName,
    lastName: users.lastName,
    email: users.email,
    role: users.role,
    isActive: users.isActive,
    createdAt: users.createdAt,
  }).from(users).where(eq(users.organizationId, orgId));
  const userIds = orgUsers.map((u) => u.id);

  await ctx?.progress?.(35, "Loading projects and bids");
  let orgProjects: any[] = [];
  let orgBids: any[] = [];
  if (userIds.length > 0) {
    orgProjects = await db.select().from(projects).where(
      or(
        inArray(projects.estimatorId, userIds),
        inArray(projects.superintendentId, userIds),
        inArray(projects.projectManagerId, userIds),
      ),
    );
    orgBids = await db.select().from(bids).where(inArray(bids.estimatorId, userIds));
  }

  await ctx?.progress?.(60, "Loading tasks, equipment and contracts");
  const orgTasks = await db.select().from(tasks).where(eq(tasks.organizationId, orgId));
  const orgEquipment = await db.select().from(equipment).where(eq(equipment.organizationId, orgId));
  const orgContracts = await db.select().from(contracts).where(eq(contracts.organizationId, orgId));

  await ctx?.progress?.(85, "Computing financial summary");
  const financialSummary = await db.execute(sql`
    SELECT
      COALESCE((SELECT SUM(contract_amount) FROM projects WHERE estimator_id = ANY(${userIds}) OR superintendent_id = ANY(${userIds}) OR project_manager_id = ANY(${userIds})), 0)::text AS total_contract_value,
      COALESCE((SELECT SUM(bid_amount) FROM bids WHERE estimator_id = ANY(${userIds})), 0)::text AS total_bid_value,
      (SELECT COUNT(*) FROM pay_runs WHERE organization_id = ${orgId})::int AS payroll_runs
  `);

  return {
    org,
    exportData: {
      exportedAt: new Date().toISOString(),
      organization: org,
      users: orgUsers,
      projects: orgProjects,
      bids: orgBids,
      tasks: orgTasks,
      equipment: orgEquipment,
      contracts: orgContracts,
      financialSummary: financialSummary.rows[0] || {},
    },
  };
}
