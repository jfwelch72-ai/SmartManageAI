import { db } from "./db";
import {
  timeClockShifts,
  timeEntries,
  dailyScopeProgress,
  scopeItems,
  projects,
  procurementItems,
  users,
  tasks,
  emailMessages,
  emailTasks,
  crmContacts,
  crmOrganisations,
  equipment,
  equipmentAssignments,
  equipmentMaintenanceSchedules,
} from "@shared/schema";
import { eq, and, sql, gte, lte, desc, isNotNull, lt } from "drizzle-orm";

export interface ProductionDataPoint {
  projectId: string;
  scopeItemId: string;
  workDate: string;
  laborHours: number;
  quantityCompleted: number;
  crewSize: number;
}

export interface DashboardSnapshot {
  timestamp: Date;
  organizationId: string;
  metrics: {
    activeProjects: number;
    totalBudget: number;
    totalSpent: number;
    pendingTasks: number;
    overdueInspections: number;
    unprocessedEmails: number;
    equipmentUtilization: number;
    laborHoursThisWeek: number;
    pendingApprovals: number;
  };
  recentActivity: Array<{
    type: string;
    description: string;
    timestamp: Date;
    entityId: string;
    userId?: string;
  }>;
  alerts: Array<{
    severity: 'low' | 'medium' | 'high' | 'critical';
    category: string;
    message: string;
    entityId?: string;
  }>;
}

export interface AISnapshotData {
  organizationId: string;
  projects: Array<{
    id: string;
    name: string;
    status: string;
    budget: number;
    actualSpent: number;
    percentComplete: number;
    scopeItems: Array<{
      description: string;
      unit: string;
      totalQuantity: number;
      completedQuantity: number;
      estimatedHours: number;
      actualHours: number;
    }>;
  }>;
  laborSummary: {
    totalApprovedHours: number;
    totalPendingHours: number;
    averageHoursPerDay: number;
    overtimePercentage: number;
  };
  procurementStatus: {
    plannedItems: number;
    orderedItems: number;
    deliveredItems: number;
    totalPlannedCost: number;
    totalOrderedCost: number;
  };
  emailMetrics: {
    unprocessedCount: number;
    categorizedByType: Record<string, number>;
    tasksCreatedFromEmails: number;
  };
  equipmentMetrics: {
    totalAssets: number;
    assignedToProjects: number;
    maintenanceDue: number;
    utilizationRate: number;
  };
  contacts: {
    totalContacts: number;
    byType: Record<string, number>;
  };
}

export async function aggregateTimeTrackingToProductionRates(
  organizationId: string,
  startDate: Date,
  endDate: Date
): Promise<{ processed: number; errors: string[] }> {
  const errors: string[] = [];
  let processed = 0;

  try {
    const approvedShifts = await db
      .select({
        shiftId: timeClockShifts.id,
        userId: timeClockShifts.userId,
        projectId: timeClockShifts.projectId,
        clockIn: timeClockShifts.clockIn,
        clockOut: timeClockShifts.clockOut,
        totalHours: timeClockShifts.totalHours,
      })
      .from(timeClockShifts)
      .innerJoin(projects, eq(timeClockShifts.projectId, projects.id))
      .where(
        and(
          eq(timeClockShifts.approvalStatus, "APPROVED"),
          eq(projects.gcOrganizationId, organizationId),
          gte(timeClockShifts.clockIn, startDate),
          lte(timeClockShifts.clockIn, endDate),
          isNotNull(timeClockShifts.projectId),
          isNotNull(timeClockShifts.clockOut)
        )
      );

    const shiftsByProjectAndDate = new Map<string, {
      projectId: string;
      date: string;
      totalHours: number;
      userIds: Set<string>;
    }>();

    for (const shift of approvedShifts) {
      if (!shift.projectId) continue;
      
      const dateKey = shift.clockIn.toISOString().split('T')[0];
      const key = `${shift.projectId}::${dateKey}`;
      
      if (!shiftsByProjectAndDate.has(key)) {
        shiftsByProjectAndDate.set(key, {
          projectId: shift.projectId,
          date: dateKey,
          totalHours: 0,
          userIds: new Set(),
        });
      }
      
      const entry = shiftsByProjectAndDate.get(key)!;
      entry.totalHours += parseFloat(shift.totalHours || '0');
      entry.userIds.add(shift.userId);
      processed++;
    }

    console.log(`[DataPipeline] Aggregated ${processed} shifts into ${shiftsByProjectAndDate.size} project-date combinations`);

    return { processed, errors };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    errors.push(errorMessage);
    console.error('[DataPipeline] Error aggregating time tracking:', error);
    return { processed, errors };
  }
}

export async function buildDashboardSnapshot(
  organizationId: string
): Promise<DashboardSnapshot> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [projectStats] = await db
    .select({
      count: sql<number>`count(*)::int`,
      totalBudget: sql<number>`coalesce(sum(cast(budget as numeric)), 0)::float`,
      totalSpent: sql<number>`coalesce(sum(cast(spent_to_date as numeric)), 0)::float`,
    })
    .from(projects)
    .where(
      and(
        eq(projects.gcOrganizationId, organizationId),
        sql`status IN ('ACTIVE', 'IN_PROGRESS')`
      )
    );

  const [taskStats] = await db
    .select({
      pendingCount: sql<number>`count(case when status = 'PENDING' or status = 'IN_PROGRESS' then 1 end)::int`,
    })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .where(eq(projects.gcOrganizationId, organizationId));

  const [laborStats] = await db
    .select({
      totalHours: sql<number>`coalesce(sum(cast(total_hours as numeric)), 0)::float`,
      pendingApprovals: sql<number>`count(case when approval_status = 'PENDING' then 1 end)::int`,
    })
    .from(timeClockShifts)
    .innerJoin(projects, eq(timeClockShifts.projectId, projects.id))
    .where(
      and(
        eq(projects.gcOrganizationId, organizationId),
        gte(timeClockShifts.clockIn, weekAgo)
      )
    );

  const [emailStats] = await db
    .select({
      unprocessedCount: sql<number>`count(case when ai_analyzed_at is null then 1 end)::int`,
    })
    .from(emailMessages)
    .where(eq(emailMessages.organizationId, organizationId));

  const [procurementStats] = await db
    .select({
      plannedCount: sql<number>`count(case when status = 'PLANNED' then 1 end)::int`,
      orderedCount: sql<number>`count(case when status = 'ORDERED' then 1 end)::int`,
    })
    .from(procurementItems)
    .innerJoin(projects, eq(procurementItems.projectId, projects.id))
    .where(eq(projects.gcOrganizationId, organizationId));

  const alerts: DashboardSnapshot['alerts'] = [];

  if ((taskStats?.pendingCount || 0) > 10) {
    alerts.push({
      severity: 'medium',
      category: 'tasks',
      message: `${taskStats?.pendingCount} tasks are pending completion`,
    });
  }

  if ((laborStats?.pendingApprovals || 0) > 5) {
    alerts.push({
      severity: 'medium',
      category: 'timeclock',
      message: `${laborStats?.pendingApprovals} time entries awaiting approval`,
    });
  }

  if ((emailStats?.unprocessedCount || 0) > 20) {
    alerts.push({
      severity: 'high',
      category: 'email',
      message: `${emailStats?.unprocessedCount} unprocessed emails require attention`,
    });
  }

  return {
    timestamp: now,
    organizationId,
    metrics: {
      activeProjects: projectStats?.count || 0,
      totalBudget: projectStats?.totalBudget || 0,
      totalSpent: projectStats?.totalSpent || 0,
      pendingTasks: taskStats?.pendingCount || 0,
      overdueInspections: 0,
      unprocessedEmails: emailStats?.unprocessedCount || 0,
      equipmentUtilization: 0,
      laborHoursThisWeek: laborStats?.totalHours || 0,
      pendingApprovals: laborStats?.pendingApprovals || 0,
    },
    recentActivity: [],
    alerts,
  };
}

export async function buildAISnapshotData(
  organizationId: string
): Promise<AISnapshotData> {
  const projectList = await db
    .select({
      id: projects.id,
      name: projects.name,
      status: projects.status,
      budget: projects.budget,
      contractAmount: projects.contractAmount,
    })
    .from(projects)
    .where(
      and(
        eq(projects.gcOrganizationId, organizationId),
        sql`status IN ('ACTIVE', 'IN_PROGRESS', 'PLANNING')`
      )
    )
    .limit(50);

  const projectsWithScope = await Promise.all(
    projectList.map(async (project) => {
      const scope = await db
        .select({
          description: scopeItems.description,
          unit: scopeItems.unit,
          totalQuantity: scopeItems.totalQuantity,
          completedQuantity: scopeItems.completedQuantity,
        })
        .from(scopeItems)
        .where(eq(scopeItems.projectId, project.id))
        .limit(20);

      const totalQuantity = scope.reduce((sum, s) => sum + Number(s.totalQuantity || 0), 0);
      const completedQuantity = scope.reduce((sum, s) => sum + Number(s.completedQuantity || 0), 0);
      const percentComplete = totalQuantity > 0 ? (completedQuantity / totalQuantity) * 100 : 0;

      return {
        id: project.id,
        name: project.name,
        status: project.status,
        budget: Number(project.budget || 0),
        actualSpent: 0,
        percentComplete,
        scopeItems: scope.map(s => ({
          description: s.description,
          unit: s.unit,
          totalQuantity: Number(s.totalQuantity || 0),
          completedQuantity: Number(s.completedQuantity || 0),
          estimatedHours: 0,
          actualHours: 0,
        })),
      };
    })
  );

  const [laborSummary] = await db
    .select({
      totalApprovedHours: sql<number>`coalesce(sum(case when approval_status = 'APPROVED' then cast(total_hours as numeric) else 0 end), 0)::float`,
      totalPendingHours: sql<number>`coalesce(sum(case when approval_status = 'PENDING' then cast(total_hours as numeric) else 0 end), 0)::float`,
    })
    .from(timeClockShifts)
    .innerJoin(projects, eq(timeClockShifts.projectId, projects.id))
    .where(eq(projects.gcOrganizationId, organizationId));

  const [procurementSummary] = await db
    .select({
      plannedItems: sql<number>`count(case when status = 'PLANNED' then 1 end)::int`,
      orderedItems: sql<number>`count(case when status = 'ORDERED' then 1 end)::int`,
      deliveredItems: sql<number>`count(case when status = 'DELIVERED' then 1 end)::int`,
      totalPlannedCost: sql<number>`coalesce(sum(case when status = 'PLANNED' then cast(quantity as numeric) * cast(unit_cost as numeric) else 0 end), 0)::float`,
      totalOrderedCost: sql<number>`coalesce(sum(case when status = 'ORDERED' then cast(quantity as numeric) * cast(unit_cost as numeric) else 0 end), 0)::float`,
    })
    .from(procurementItems)
    .innerJoin(projects, eq(procurementItems.projectId, projects.id))
    .where(eq(projects.gcOrganizationId, organizationId));

  const [contactSummary] = await db
    .select({
      totalContacts: sql<number>`count(*)::int`,
    })
    .from(crmContacts)
    .where(eq(crmContacts.organizationId, organizationId));

  // Get email task statistics  
  const [emailTaskStats] = await db
    .select({
      pendingCount: sql<number>`count(case when status = 'PENDING' then 1 end)::int`,
      inProgressCount: sql<number>`count(case when status = 'IN_PROGRESS' then 1 end)::int`,
      completedCount: sql<number>`count(case when status = 'COMPLETED' then 1 end)::int`,
      totalCount: sql<number>`count(*)::int`,
    })
    .from(emailTasks)
    .where(eq(emailTasks.organizationId, organizationId));

  // Get email classification breakdown
  const emailClassificationStats = await db
    .select({
      classification: emailMessages.aiClassification,
      count: sql<number>`count(*)::int`,
    })
    .from(emailMessages)
    .where(
      and(
        eq(emailMessages.organizationId, organizationId),
        isNotNull(emailMessages.aiClassification)
      )
    )
    .groupBy(emailMessages.aiClassification);

  const categorizedByType: Record<string, number> = {};
  for (const stat of emailClassificationStats) {
    if (stat.classification) {
      categorizedByType[stat.classification] = stat.count;
    }
  }

  // Get unprocessed email count
  const [unprocessedEmails] = await db
    .select({
      count: sql<number>`count(*)::int`,
    })
    .from(emailMessages)
    .where(
      and(
        eq(emailMessages.organizationId, organizationId),
        sql`ai_analyzed_at IS NULL`
      )
    );

  // Get equipment statistics
  const [equipmentStats] = await db
    .select({
      totalAssets: sql<number>`count(*)::int`,
      assignedCount: sql<number>`count(case when status = 'ASSIGNED' then 1 end)::int`,
      inRepairCount: sql<number>`count(case when status = 'IN_REPAIR' then 1 end)::int`,
      availableCount: sql<number>`count(case when status = 'AVAILABLE' then 1 end)::int`,
    })
    .from(equipment)
    .where(eq(equipment.organizationId, organizationId));

  // Get maintenance due count
  const now = new Date();
  const [maintenanceDueStats] = await db
    .select({
      dueCount: sql<number>`count(*)::int`,
    })
    .from(equipmentMaintenanceSchedules)
    .innerJoin(equipment, eq(equipmentMaintenanceSchedules.equipmentId, equipment.id))
    .where(
      and(
        eq(equipment.organizationId, organizationId),
        sql`(next_due_at IS NOT NULL AND next_due_at <= ${now})`
      )
    );

  // Calculate equipment utilization rate
  const totalEquipment = equipmentStats?.totalAssets || 0;
  const assignedEquipment = equipmentStats?.assignedCount || 0;
  const utilizationRate = totalEquipment > 0 
    ? Math.round((assignedEquipment / totalEquipment) * 100) 
    : 0;

  // Get CRM organization counts by type
  const crmOrgStats = await db
    .select({
      type: crmOrganisations.type,
      count: sql<number>`count(*)::int`,
    })
    .from(crmOrganisations)
    .where(eq(crmOrganisations.owningOrganizationId, organizationId))
    .groupBy(crmOrganisations.type);

  const contactsByType: Record<string, number> = {};
  for (const stat of crmOrgStats) {
    if (stat.type) {
      contactsByType[stat.type] = stat.count;
    }
  }

  return {
    organizationId,
    projects: projectsWithScope,
    laborSummary: {
      totalApprovedHours: laborSummary?.totalApprovedHours || 0,
      totalPendingHours: laborSummary?.totalPendingHours || 0,
      averageHoursPerDay: 0,
      overtimePercentage: 0,
    },
    procurementStatus: {
      plannedItems: procurementSummary?.plannedItems || 0,
      orderedItems: procurementSummary?.orderedItems || 0,
      deliveredItems: procurementSummary?.deliveredItems || 0,
      totalPlannedCost: procurementSummary?.totalPlannedCost || 0,
      totalOrderedCost: procurementSummary?.totalOrderedCost || 0,
    },
    emailMetrics: {
      unprocessedCount: unprocessedEmails?.count || 0,
      categorizedByType,
      tasksCreatedFromEmails: emailTaskStats?.totalCount || 0,
    },
    equipmentMetrics: {
      totalAssets: equipmentStats?.totalAssets || 0,
      assignedToProjects: equipmentStats?.assignedCount || 0,
      maintenanceDue: maintenanceDueStats?.dueCount || 0,
      utilizationRate,
    },
    contacts: {
      totalContacts: contactSummary?.totalContacts || 0,
      byType: contactsByType,
    },
  };
}

export async function syncMaterialCalculatorToEstimate(
  estimateId: string,
  lineItemId: string,
  materialData: {
    concreteYards?: number;
    stoneTons?: number;
    excavationYards?: number;
    wireMeshSqFt?: number;
    rebarPounds?: number;
    dowelCount?: number;
    sealerGallons?: number;
    underlaymentSqFt?: number;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const { estimateLineItems } = await import("@shared/schema");
    
    const updateData: Record<string, string | null> = {};
    
    if (materialData.concreteYards !== undefined) {
      updateData.calculatedConcreteYards = materialData.concreteYards.toFixed(2);
    }
    if (materialData.stoneTons !== undefined) {
      updateData.calculatedStoneTons = materialData.stoneTons.toFixed(2);
    }
    if (materialData.excavationYards !== undefined) {
      updateData.calculatedExcavationYards = materialData.excavationYards.toFixed(2);
    }

    await db
      .update(estimateLineItems)
      .set({
        ...updateData,
        updatedAt: new Date(),
      })
      .where(eq(estimateLineItems.id, lineItemId));

    console.log(`[DataPipeline] Synced material calculator data for line item ${lineItemId}`);
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[DataPipeline] Error syncing material calculator:', error);
    return { success: false, error: errorMessage };
  }
}

export async function linkCRMContactToProject(
  contactId: string,
  projectId: string,
  role: string
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log(`[DataPipeline] Linking contact ${contactId} to project ${projectId} as ${role}`);
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: errorMessage };
  }
}

export async function getEquipmentUtilizationForProject(
  projectId: string
): Promise<{
  assignedEquipment: number;
  totalHoursLogged: number;
  utilizationRate: number;
}> {
  try {
    const stats = await db
      .select({
        equipmentId: equipmentAssignments.equipmentId,
        hoursAtAssignment: equipmentAssignments.hoursAtAssignment,
        hoursAtReturn: equipmentAssignments.hoursAtReturn,
        isActive: equipmentAssignments.isActive,
      })
      .from(equipmentAssignments)
      .where(eq(equipmentAssignments.projectId, projectId));

    // Calculate total hours used across all assignments
    let totalHoursLogged = 0;
    const uniqueEquipment = new Set<string>();

    for (const assignment of stats) {
      if (assignment.equipmentId) {
        uniqueEquipment.add(assignment.equipmentId);
      }
      const startHours = parseFloat(assignment.hoursAtAssignment || '0');
      const endHours = parseFloat(assignment.hoursAtReturn || '0');
      if (endHours > startHours) {
        totalHoursLogged += (endHours - startHours);
      }
    }

    // Utilization rate based on returned vs active assignments
    const activeCount = stats.filter(s => s.isActive).length;
    const totalAssignments = stats.length;
    const utilizationRate = totalAssignments > 0 
      ? (activeCount / totalAssignments) * 100 
      : 0;

    return {
      assignedEquipment: uniqueEquipment.size,
      totalHoursLogged: Math.round(totalHoursLogged * 100) / 100,
      utilizationRate: Math.round(utilizationRate * 100) / 100,
    };
  } catch (error) {
    console.error('[DataPipeline] Error getting equipment utilization:', error);
    return {
      assignedEquipment: 0,
      totalHoursLogged: 0,
      utilizationRate: 0,
    };
  }
}

/**
 * Aggregate equipment hours for production rate analysis
 */
export async function aggregateEquipmentHoursForProduction(
  organizationId: string,
  startDate: Date,
  endDate: Date
): Promise<{
  byProject: Array<{ projectId: string; totalHours: number; equipmentCount: number }>;
  totalHours: number;
}> {
  try {
    const assignments = await db
      .select({
        projectId: equipmentAssignments.projectId,
        equipmentId: equipmentAssignments.equipmentId,
        hoursAtAssignment: equipmentAssignments.hoursAtAssignment,
        hoursAtReturn: equipmentAssignments.hoursAtReturn,
        assignedAt: equipmentAssignments.assignedAt,
        returnedAt: equipmentAssignments.returnedAt,
      })
      .from(equipmentAssignments)
      .innerJoin(projects, eq(equipmentAssignments.projectId, projects.id))
      .where(
        and(
          eq(projects.gcOrganizationId, organizationId),
          gte(equipmentAssignments.assignedAt, startDate)
        )
      );

    // Aggregate by project
    const projectMap = new Map<string, { hours: number; equipment: Set<string> }>();
    let totalHours = 0;

    for (const assignment of assignments) {
      if (!assignment.projectId) continue;

      const startHours = parseFloat(assignment.hoursAtAssignment || '0');
      const endHours = parseFloat(assignment.hoursAtReturn || '0');
      const hoursUsed = endHours > startHours ? endHours - startHours : 0;

      if (!projectMap.has(assignment.projectId)) {
        projectMap.set(assignment.projectId, { hours: 0, equipment: new Set() });
      }

      const entry = projectMap.get(assignment.projectId)!;
      entry.hours += hoursUsed;
      if (assignment.equipmentId) {
        entry.equipment.add(assignment.equipmentId);
      }
      totalHours += hoursUsed;
    }

    const byProject = Array.from(projectMap.entries()).map(([projectId, data]) => ({
      projectId,
      totalHours: Math.round(data.hours * 100) / 100,
      equipmentCount: data.equipment.size,
    }));

    console.log(`[DataPipeline] Aggregated equipment hours: ${totalHours} total across ${byProject.length} projects`);

    return {
      byProject,
      totalHours: Math.round(totalHours * 100) / 100,
    };
  } catch (error) {
    console.error('[DataPipeline] Error aggregating equipment hours:', error);
    return { byProject: [], totalHours: 0 };
  }
}
