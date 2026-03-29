import { logError } from "../../utils/logger";
import { db } from "../../db";
import {
  users, organizations, projects, bids, crmOrganisations, estimates,
  crews, equipment, changeOrders, tasks, scopeItems,
} from "@shared/schema";
import { generateToken } from "../../auth";
import { sql } from "drizzle-orm";
import crypto from "crypto";
import bcrypt from "bcrypt";
import type { OrgResources } from "./endpoint-catalog";

export interface TestOrg {
  org: typeof organizations.$inferSelect;
  adminUser: typeof users.$inferSelect;
  token: string;
  resources: OrgResources;
}

const TEST_PREFIX = "__isolation_test__";

export async function seedTestOrg(label: string): Promise<TestOrg> {
  const slug = `${TEST_PREFIX}${label}-${Date.now()}`;
  const passwordHash = await bcrypt.hash("TestPass123!", 10);

  const [org] = await db
    .insert(organizations)
    .values({
      name: `Test Org ${label}`,
      slug,
      tradeType: "GENERAL_CONTRACTOR",
      onboardingStatus: "COMPLETED",
      isActive: true,
    })
    .returning();

  const [adminUser] = await db
    .insert(users)
    .values({
      email: `${slug}-admin@test.local`,
      passwordHash,
      firstName: "Test",
      lastName: `Admin-${label}`,
      role: "ADMIN",
      organizationId: org.id,
      isActive: true,
    })
    .returning();

  const projectCode = `${TEST_PREFIX}P-${label}-${Date.now()}`;
  const [project] = await db
    .insert(projects)
    .values({
      name: `Test Project ${label}`,
      code: projectCode,
      clientName: `Test Client ${label}`,
      gcOrganizationId: org.id,
      status: "ACTIVE",
    })
    .returning();

  const [bid] = await db
    .insert(bids)
    .values({
      code: `${TEST_PREFIX}B-${label}-${Date.now()}`,
      name: `Test Bid ${label}`,
      clientName: `Test Client ${label}`,
      gcOrganizationId: org.id,
    })
    .returning();

  const [crmOrg] = await db
    .insert(crmOrganisations)
    .values({
      name: `Test CRM Org ${label}`,
      organizationId: org.id,
      type: "VENDOR",
    })
    .returning();

  const [estimate] = await db
    .insert(estimates)
    .values({
      projectId: project.id,
      createdById: adminUser.id,
    })
    .returning();

  const [crew] = await db
    .insert(crews)
    .values({
      name: `Test Crew ${label}`,
      organizationId: org.id,
      leadId: adminUser.id,
    })
    .returning();

  const eqCode = `${TEST_PREFIX}EQ-${label}-${Date.now()}`;
  const [equip] = await db
    .insert(equipment)
    .values({
      name: `Test Equipment ${label}`,
      equipmentCode: eqCode,
      type: "HEAVY_EQUIPMENT",
      organizationId: org.id,
    })
    .returning();

  const [co] = await db
    .insert(changeOrders)
    .values({
      projectId: project.id,
      changeOrderNumber: `CO-${label}-${Date.now()}`,
      description: `Test Change Order ${label}`,
      amount: "5000.00",
      requestedById: adminUser.id,
    })
    .returning();

  const [task] = await db
    .insert(tasks)
    .values({
      organizationId: org.id,
      projectId: project.id,
      title: `Test Task ${label}`,
      createdById: adminUser.id,
    })
    .returning();

  const [scopeItem] = await db
    .insert(scopeItems)
    .values({
      projectId: project.id,
      description: `Test Scope Item ${label}`,
      unit: "SF",
      totalQuantity: "100.00",
    })
    .returning();

  const token = generateToken(adminUser.id, adminUser.tokenVersion ?? 0);

  return {
    org,
    adminUser,
    token,
    resources: {
      orgId: org.id,
      projectCode: project.code,
      projectId: project.id,
      bidId: bid.id,
      userId: adminUser.id,
      crmOrgId: crmOrg.id,
      estimateId: estimate.id,
      crewId: crew.id,
      equipmentId: equip.id,
      changeOrderId: co.id,
      taskId: task.id,
      scopeItemId: scopeItem.id,
    },
  };
}

export async function cleanupTestData(): Promise<void> {
  try {
    const orgIdsResult = await db.execute(
      sql`SELECT id FROM organizations WHERE slug LIKE ${TEST_PREFIX + '%'}`
    );
    const orgIds = (orgIdsResult as any)?.rows?.map((r: any) => r.id) || [];
    if (orgIds.length === 0) return;

    for (const orgId of orgIds) {
      await db.execute(sql`DELETE FROM scope_items WHERE project_id IN (SELECT id FROM projects WHERE gc_organization_id = ${orgId})`).catch(() => {});
      await db.execute(sql`DELETE FROM change_orders WHERE project_id IN (SELECT id FROM projects WHERE gc_organization_id = ${orgId})`).catch(() => {});
      await db.execute(sql`DELETE FROM estimates WHERE project_id IN (SELECT id FROM projects WHERE gc_organization_id = ${orgId})`).catch(() => {});
      await db.execute(sql`DELETE FROM tasks WHERE organization_id = ${orgId}`).catch(() => {});
      await db.execute(sql`DELETE FROM equipment WHERE organization_id = ${orgId}`).catch(() => {});
      await db.execute(sql`DELETE FROM crews WHERE organization_id = ${orgId}`).catch(() => {});
      await db.execute(sql`DELETE FROM crm_organisations WHERE organization_id = ${orgId}`).catch(() => {});
      await db.execute(sql`DELETE FROM bids WHERE gc_organization_id = ${orgId}`).catch(() => {});
      await db.execute(sql`DELETE FROM projects WHERE gc_organization_id = ${orgId}`).catch(() => {});
      await db.execute(sql`DELETE FROM users WHERE organization_id = ${orgId}`).catch(() => {});
      await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}`).catch(() => {});
    }
  } catch (err) {
    logError("Cleanup error (non-fatal):", {}, err instanceof Error ? err : new Error(String(err)));
  }
}

export const FUZZ_ORG_IDS = [
  "00000000-0000-0000-0000-000000000000",
  "ffffffff-ffff-ffff-ffff-ffffffffffff",
  "null",
  "../../../etc/passwd",
  "1; DROP TABLE organizations;--",
  "' OR '1'='1",
  "<script>alert(1)</script>",
  "a".repeat(500),
  crypto.randomUUID(),
];
