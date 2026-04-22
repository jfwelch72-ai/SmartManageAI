import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql, eq, and } from "drizzle-orm";
import bcrypt from "bcrypt";
import { db } from "../db";
import {
  users,
  organizations,
  projects,
  projectSchedules,
  projectScheduleTasks,
  scheduleTaskDependencies,
  projectEmailDistributionLists,
  scheduleOfValues,
  sovLineItems,
  projectTemplates,
  projectTemplateVersions,
  orgCostCodes,
} from "@shared/schema";
import { captureProjectTemplate } from "../projectTemplateCapture";
import { instantiateProjectFromTemplate } from "../projectTemplateInstantiate";
import { seedSystemProjectTemplates } from "../seedProjectTemplates";

const TEST_PREFIX = "__tmpl_test__";

interface SeedContext {
  orgId: string;
  userId: string;
  projectId: string;
  scheduleId: string;
  parentTaskId: string;
  childTaskId: string;
  followupTaskId: string;
}

async function seedSourceProject(label: string): Promise<SeedContext> {
  const slug = `${TEST_PREFIX}${label}-${Date.now()}`;
  const passwordHash = await bcrypt.hash("TestPass123!", 10);

  const [org] = await db
    .insert(organizations)
    .values({
      name: `Tmpl Org ${label}`,
      slug,
      tradeType: "GENERAL_CONTRACTOR",
      onboardingStatus: "COMPLETED",
      isActive: true,
    })
    .returning();

  const [user] = await db
    .insert(users)
    .values({
      email: `${slug}-admin@test.local`,
      passwordHash,
      firstName: "Tmpl",
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
      name: `Tmpl Project ${label}`,
      code: projectCode,
      clientName: `Tmpl Client ${label}`,
      gcOrganizationId: org.id,
      status: "ACTIVE",
      autoChangeOrderEnabled: true,
      payrollFormVariant: "WH_347",
      geofenceEnforcement: "OFF",
    })
    .returning();

  const [schedule] = await db
    .insert(projectSchedules)
    .values({
      organizationId: org.id,
      projectId: project.id,
      name: "Master Schedule",
      generatedBy: "MANUAL" as const,
      baselineStartDate: "2026-01-01",
      isActive: true,
      createdByUserId: user.id,
    })
    .returning();

  // WBS: parent → child, plus a sibling that depends on the parent.
  const [parentTask] = await db
    .insert(projectScheduleTasks)
    .values({
      scheduleId: schedule.id,
      name: "Sitework",
      wbsCode: "1",
      outlineLevel: 0,
      durationDays: 10,
      sortOrder: 0,
      plannedStartDate: "2026-01-01",
      plannedEndDate: "2026-01-11",
    })
    .returning();

  const [childTask] = await db
    .insert(projectScheduleTasks)
    .values({
      scheduleId: schedule.id,
      parentTaskId: parentTask.id,
      name: "Excavation",
      wbsCode: "1.1",
      outlineLevel: 1,
      durationDays: 5,
      sortOrder: 1,
      tradeType: "EARTHWORK",
      plannedStartDate: "2026-01-01",
      plannedEndDate: "2026-01-06",
    })
    .returning();

  const [followupTask] = await db
    .insert(projectScheduleTasks)
    .values({
      scheduleId: schedule.id,
      name: "Foundations",
      wbsCode: "2",
      outlineLevel: 0,
      durationDays: 7,
      sortOrder: 2,
      isMilestone: false,
      plannedStartDate: "2026-01-12",
      plannedEndDate: "2026-01-19",
    })
    .returning();

  await db.insert(scheduleTaskDependencies).values({
    scheduleId: schedule.id,
    predecessorTaskId: parentTask.id,
    successorTaskId: followupTask.id,
    dependencyType: "FS" as const,
    lagDays: 1,
  });

  // Org cost codes — captured on the snapshot for the new wizard.
  await db.insert(orgCostCodes).values([
    {
      organizationId: org.id,
      code: "01-100",
      description: "General Conditions",
      division: "01 - General Requirements",
      isCustom: true,
      isActive: true,
    },
    {
      organizationId: org.id,
      code: "03-300",
      description: "Cast-in-Place Concrete",
      division: "03 - Concrete",
      isCustom: true,
      isActive: true,
    },
    {
      organizationId: org.id,
      code: "99-999",
      description: "Inactive code (must be filtered out)",
      division: "99 - Misc",
      isCustom: true,
      isActive: false,
    },
  ]);

  await db.insert(projectEmailDistributionLists).values({
    organizationId: org.id,
    projectId: project.id,
    name: "Owners",
    contactEmails: ["owner@example.com"],
    extraEmails: ["pm@example.com"],
    createdById: user.id,
  });

  const [sov] = await db
    .insert(scheduleOfValues)
    .values({
      organizationId: org.id,
      projectId: project.id,
      sovNumber: "SOV-001",
      title: "Source SoV",
      contractValue: "100000.00",
      createdById: user.id,
    })
    .returning();

  await db.insert(sovLineItems).values([
    {
      sovId: sov.id,
      lineNumber: 1,
      itemCode: "01.A",
      description: "Mobilization",
      category: "Labor",
      scheduledValue: "5000.00",
    },
    {
      sovId: sov.id,
      lineNumber: 2,
      itemCode: "02.A",
      description: "Sitework",
      category: "Material",
      scheduledValue: "20000.00",
    },
  ]);

  return {
    orgId: org.id,
    userId: user.id,
    projectId: project.id,
    scheduleId: schedule.id,
    parentTaskId: parentTask.id,
    childTaskId: childTask.id,
    followupTaskId: followupTask.id,
  };
}

async function cleanupTestData(): Promise<void> {
  // Clean up any test orgs (cascades through projects/schedules/etc.).
  await db.execute(
    sql`DELETE FROM project_template_versions WHERE template_id IN (
          SELECT id FROM project_templates WHERE name LIKE ${TEST_PREFIX + "%"}
        )`,
  );
  await db.execute(
    sql`DELETE FROM project_templates WHERE name LIKE ${TEST_PREFIX + "%"}`,
  );

  const orgRes = await db.execute(
    sql`SELECT id FROM organizations WHERE slug LIKE ${TEST_PREFIX + "%"}`,
  );
  const orgIds = ((orgRes as unknown as { rows: Array<{ id: string }> }).rows || []).map(
    (r) => r.id,
  );
  for (const orgId of orgIds) {
    // org_cost_codes does not have an FK to organizations, so the cascade
    // doesn't reach it — clean it up explicitly first.
    await db
      .execute(sql`DELETE FROM org_cost_codes WHERE organization_id = ${orgId}`)
      .catch(() => {});
    // projects also created by instantiation under the same org get removed
    // by the cascade on organizations → projects.
    await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}`).catch(() => {});
  }

  // Instantiated projects that were created via the wizard share the source
  // org but use a numeric `code`. Catch any leftover rows by name prefix too.
  await db.execute(sql`DELETE FROM projects WHERE name LIKE ${TEST_PREFIX + "%"}`).catch(() => {});
}

describe("project template capture & instantiate", () => {
  beforeAll(async () => {
    await cleanupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  it("captures a project's WBS, dependencies, distribution list and SoV, then instantiates a new project that mirrors the structure with rebased dates", async () => {
    const ctx = await seedSourceProject("capture");

    const snapshot = await captureProjectTemplate(ctx.projectId);

    // Snapshot reflects the seeded WBS.
    expect(snapshot.tasks).toHaveLength(3);
    const parentSnap = snapshot.tasks.find((t) => t.name === "Sitework");
    const childSnap = snapshot.tasks.find((t) => t.name === "Excavation");
    const followupSnap = snapshot.tasks.find((t) => t.name === "Foundations");
    expect(parentSnap).toBeTruthy();
    expect(childSnap).toBeTruthy();
    expect(followupSnap).toBeTruthy();
    expect(childSnap!.parentRefId).toBe(parentSnap!.refId);
    expect(childSnap!.outlineLevel).toBe(1);
    expect(childSnap!.tradeType).toBe("EARTHWORK");

    // Offsets are anchored to the earliest planned start (Jan 1 2026).
    expect(parentSnap!.startOffsetDays).toBe(0);
    expect(parentSnap!.endOffsetDays).toBe(10);
    expect(followupSnap!.startOffsetDays).toBe(11);
    expect(followupSnap!.endOffsetDays).toBe(18);

    expect(snapshot.dependencies).toHaveLength(1);
    expect(snapshot.dependencies[0]).toMatchObject({
      predecessorRefId: parentSnap!.refId,
      successorRefId: followupSnap!.refId,
      dependencyType: "FS",
      lagDays: 1,
    });

    expect(snapshot.distributionLists).toHaveLength(1);
    expect(snapshot.distributionLists[0]).toMatchObject({
      name: "Owners",
      contactEmails: ["owner@example.com"],
      extraEmails: ["pm@example.com"],
    });

    expect(snapshot.scheduleOfValues).not.toBeNull();
    expect(snapshot.scheduleOfValues!.lineItems).toHaveLength(2);
    expect(snapshot.scheduleOfValues!.lineItems[0]).toMatchObject({
      itemNumber: "01.A",
      description: "Mobilization",
      scheduledValue: "5000.00",
    });

    expect(snapshot.defaults.payrollFormVariant).toBe("WH_347");

    // Cost codes captured: only the two active rows, inactive one filtered out.
    const capturedCodes = snapshot.costCodes.map((c) => c.code).sort();
    expect(capturedCodes).toEqual(["01-100", "03-300"]);
    expect(snapshot.costCodes.find((c) => c.code === "01-100")).toMatchObject({
      description: "General Conditions",
      division: "01 - General Requirements",
    });

    // Persist the snapshot the way the route would.
    const [tpl] = await db
      .insert(projectTemplates)
      .values({
        organizationId: ctx.orgId,
        name: `${TEST_PREFIX}captured-template`,
        description: "captured for tests",
        category: "Test",
        sourceProjectId: ctx.projectId,
        sourceProjectCode: snapshot.source.projectCode,
        isSystemSeed: false,
        isActive: true,
      })
      .returning();
    await db.insert(projectTemplateVersions).values({
      templateId: tpl.id,
      version: 1,
      snapshot: snapshot as unknown as Record<string, unknown>,
      notes: "test",
    });

    // Now instantiate a new project from the snapshot, rebased to a new start.
    const newStart = new Date("2027-03-15T00:00:00.000Z");
    const result = await instantiateProjectFromTemplate({
      template: { id: tpl.id, sourceProjectCode: snapshot.source.projectCode },
      snapshot,
      organizationId: ctx.orgId,
      createdByUserId: ctx.userId,
      projectStartDate: newStart,
      projectInput: {
        name: `${TEST_PREFIX}instantiated-project`,
        clientName: "New Client",
        gcOrganizationId: ctx.orgId,
        contractAmount: "250000.00",
      },
    });

    expect(result.taskCount).toBe(3);
    expect(result.dependencyCount).toBe(1);
    expect(result.distributionListCount).toBe(1);
    expect(result.sovCreated).toBe(true);

    // Verify the new schedule and tasks.
    const [newSchedule] = await db
      .select()
      .from(projectSchedules)
      .where(eq(projectSchedules.projectId, result.projectId))
      .limit(1);
    expect(newSchedule).toBeTruthy();

    const newTasks = await db
      .select()
      .from(projectScheduleTasks)
      .where(eq(projectScheduleTasks.scheduleId, newSchedule.id));
    expect(newTasks).toHaveLength(3);

    const newParent = newTasks.find((t) => t.name === "Sitework")!;
    const newChild = newTasks.find((t) => t.name === "Excavation")!;
    const newFollowup = newTasks.find((t) => t.name === "Foundations")!;

    // Parent link is preserved.
    expect(newChild.parentTaskId).toBe(newParent.id);
    expect(newFollowup.parentTaskId).toBeNull();

    // Dates are rebased: parent starts at the new project start, follow-up
    // starts 11 days later (matching the captured offset).
    expect(newParent.plannedStartDate).toBe("2027-03-15");
    expect(newParent.plannedEndDate).toBe("2027-03-25");
    expect(newFollowup.plannedStartDate).toBe("2027-03-26");
    expect(newFollowup.plannedEndDate).toBe("2027-04-02");

    // Dependency is recreated against the new task ids.
    const newDeps = await db
      .select()
      .from(scheduleTaskDependencies)
      .where(eq(scheduleTaskDependencies.scheduleId, newSchedule.id));
    expect(newDeps).toHaveLength(1);
    expect(newDeps[0].predecessorTaskId).toBe(newParent.id);
    expect(newDeps[0].successorTaskId).toBe(newFollowup.id);
    expect(newDeps[0].dependencyType).toBe("FS");
    expect(newDeps[0].lagDays).toBe(1);

    // Distribution list is rebuilt under the new project.
    const newLists = await db
      .select()
      .from(projectEmailDistributionLists)
      .where(eq(projectEmailDistributionLists.projectId, result.projectId));
    expect(newLists).toHaveLength(1);
    expect(newLists[0]).toMatchObject({
      name: "Owners",
      contactEmails: ["owner@example.com"],
      extraEmails: ["pm@example.com"],
    });

    // SoV with line items is recreated.
    const [newSov] = await db
      .select()
      .from(scheduleOfValues)
      .where(eq(scheduleOfValues.projectId, result.projectId))
      .limit(1);
    expect(newSov).toBeTruthy();
    expect(newSov.title).toBe("Source SoV");
    const newLines = await db
      .select()
      .from(sovLineItems)
      .where(eq(sovLineItems.sovId, newSov.id));
    expect(newLines).toHaveLength(2);
    const lineDescs = newLines.map((l) => l.description).sort();
    expect(lineDescs).toEqual(["Mobilization", "Sitework"]);
  });
});

describe("seedSystemProjectTemplates idempotency", () => {
  it("inserts the 6 system seed templates exactly once across repeated invocations", async () => {
    // Capture baseline counts so the assertion works whether or not the
    // seeds were already present from a prior server boot.
    const before = await db
      .select({ name: projectTemplates.name })
      .from(projectTemplates)
      .where(eq(projectTemplates.isSystemSeed, true));
    const beforeNames = new Set(before.map((r) => r.name));

    await seedSystemProjectTemplates();
    await seedSystemProjectTemplates();
    await seedSystemProjectTemplates();

    const after = await db
      .select({ id: projectTemplates.id, name: projectTemplates.name })
      .from(projectTemplates)
      .where(eq(projectTemplates.isSystemSeed, true));

    const expectedNames = [
      "Residential Remodel",
      "Commercial New Build",
      "Tenant Improvement",
      "DOT Road Rehab",
      "DOT Bridge Rehab",
      "Generic Project",
    ];
    for (const name of expectedNames) {
      const matches = after.filter((r) => r.name === name);
      expect(matches, `expected exactly one system seed named "${name}"`).toHaveLength(1);
    }

    // No new duplicates were introduced for templates that already existed.
    for (const name of beforeNames) {
      const matches = after.filter((r) => r.name === name);
      expect(matches.length).toBeGreaterThanOrEqual(1);
      if (expectedNames.includes(name)) {
        expect(matches).toHaveLength(1);
      }
    }

    // Each system seed template has exactly one version row from the seeder.
    for (const tpl of after.filter((t) => expectedNames.includes(t.name))) {
      const versions = await db
        .select()
        .from(projectTemplateVersions)
        .where(
          and(
            eq(projectTemplateVersions.templateId, tpl.id),
            eq(projectTemplateVersions.version, 1),
          ),
        );
      expect(versions).toHaveLength(1);
    }
  });
});
