import { db } from "../db";
import { 
  projects, 
  timeEntries, 
  procurementItems, 
  changeOrders, 
  scopeItems, 
  receipts, 
  billingEvents,
  timeClockShifts,
  bids,
  users,
  crews,
  crewMembers,
  userSkills,
  subcontractorContracts,
  aiDataQuality
} from "@shared/schema";
import { sql, desc, eq } from "drizzle-orm";
import { calculateProjectDataQuality } from "./dataQualityScorer";

export interface DataSnapshot {
  generated_at: string;
  projects: {
    total_active: number;
    total_completed: number;
    active_projects: {
      code: string;
      name: string;
      status: string;
      budget: number;
      contract_amount: number;
      start_date: string | null;
      estimated_completion: string | null;
      client_name: string;
      superintendent_id: string | null;
      missing_financials: boolean;
    }[];
    missing_financials_count: number;
  };
  labor: {
    total_hours_this_week: number;
    total_cost_this_week: number;
    unapproved_entries_count: number;
    unapproved_entries_value: number;
    active_shifts_count: number;
  };
  procurement: {
    pending_orders_count: number;
    pending_orders_value: number;
    urgent_items: {
      project_code: string | null;
      description: string;
      needed_by: string | null;
      estimated_cost: number;
    }[];
  };
  change_orders: {
    total_count: number;
    total_value: number;
    by_status: {
      draft_count: number;
      draft_value: number;
      pending_approval_count: number;
      pending_approval_value: number;
      submitted_count: number;
      submitted_value: number;
      approved_count: number;
      approved_value: number;
      rejected_count: number;
      rejected_value: number;
    };
    by_project: {
      project_code: string;
      project_name: string;
      total_count: number;
      total_value: number;
      approved_value: number;
      status_breakdown: string;
    }[];
    recent_approvals: {
      project_code: string | null;
      description: string;
      amount: number;
      status: string;
    }[];
    needs_attention: {
      project_code: string | null;
      description: string;
      amount: number;
      status: string;
      days_pending: number;
    }[];
  };
  billing: {
    total_invoiced_ytd: number;
    total_received_ytd: number;
    overdue_invoices: {
      project_code: string | null;
      reference: string | null;
      amount: number;
      days_overdue: number;
    }[];
  };
  bids: {
    active_count: number;
    total_value: number;
    upcoming_deadlines: {
      client_name: string;
      bid_amount: number;
      bid_deadline: string | null;
      status: string;
    }[];
  };
  crew: {
    total_employees: number;
    superintendents: number;
    hourly_workers: number;
    overtime_hours_this_week: number;
    total_crews: number;
    active_crews: number;
    total_crew_members: number;
    users_with_skills: number;
    users_without_cost_rates: number;
  };
  subcontractors: {
    total_active_contracts: number;
    total_contract_value: number;
    active_contracts_by_project: {
      project_code: string;
      contract_count: number;
      total_value: number;
    }[];
  };
  data_quality: {
    avg_overall_score: number;
    projects_below_threshold: number;
    common_issues: string[];
  };
  missing_financials: {
    count: number;
    project_codes: string[];
  };
}

export async function buildDataSnapshot(): Promise<DataSnapshot> {
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const startOfYear = new Date(now.getFullYear(), 0, 1);

  // Fetch all active projects
  const activeProjects = await db
    .select({
      code: projects.code,
      name: projects.name,
      status: projects.status,
      budget: projects.budget,
      contractAmount: projects.contractAmount,
      startDate: projects.startDate,
      estimatedCompletionDate: projects.estimatedCompletionDate,
      clientName: projects.clientName,
      superintendentId: projects.superintendentId,
    })
    .from(projects)
    .where(sql`${projects.status} IN ('ACTIVE', 'PLANNING')`)
    .limit(100);

  const completedProjectsCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projects)
    .where(eq(projects.status, 'COMPLETE'));

  // Time entries in the last week
  const weeklyTimeEntries = await db
    .select({
      hoursRegular: timeEntries.hoursRegular,
      hoursOvertime: timeEntries.hoursOvertime,
      approvedAt: timeEntries.approvedAt,
    })
    .from(timeEntries)
    .where(sql`${timeEntries.date} >= ${oneWeekAgo.toISOString().split('T')[0]}`)
    .limit(1000);

  const totalHoursThisWeek = weeklyTimeEntries.reduce(
    (sum, entry) => sum + Number(entry.hoursRegular || 0) + Number(entry.hoursOvertime || 0), 
    0
  );
  const totalCostThisWeek = weeklyTimeEntries.reduce(
    (sum, entry) => {
      const regularHours = Number(entry.hoursRegular || 0);
      const overtimeHours = Number(entry.hoursOvertime || 0);
      const assumedRate = 50;
      return sum + (regularHours * assumedRate) + (overtimeHours * assumedRate * 1.5);
    },
    0
  );
  const unapprovedEntries = weeklyTimeEntries.filter(e => !e.approvedAt);
  const unapprovedValue = unapprovedEntries.reduce(
    (sum, entry) => {
      const regularHours = Number(entry.hoursRegular || 0);
      const overtimeHours = Number(entry.hoursOvertime || 0);
      const assumedRate = 50;
      return sum + (regularHours * assumedRate) + (overtimeHours * assumedRate * 1.5);
    },
    0
  );

  // Active time-clock shifts
  const activeShiftsCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(timeClockShifts)
    .where(sql`${timeClockShifts.clockOut} IS NULL`);

  // Pending procurement
  const pendingProcurement = await db
    .select()
    .from(procurementItems)
    .where(eq(procurementItems.status, 'PLANNED'))
    .limit(50);

  const urgentItems = pendingProcurement
    .filter(item => {
      if (!item.neededByDate) return false;
      const daysUntilNeeded = Math.ceil((new Date(item.neededByDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      return daysUntilNeeded <= 3 && daysUntilNeeded >= 0;
    })
    .map(item => ({
      project_code: item.projectId,
      description: item.description,
      needed_by: item.neededByDate?.toISOString().split('T')[0] || null,
      estimated_cost: Number(item.unitCost || 0) * Number(item.quantity || 0),
    }));

  // Change orders - comprehensive analysis
  const allChangeOrders = await db
    .select()
    .from(changeOrders)
    .limit(200);

  // Build project ID to code mapping
  const projectIdToCode = new Map<string, string>();
  const projectIdToName = new Map<string, string>();
  activeProjects.forEach(p => {
    projectIdToCode.set(p.code, p.code); // code to code (for completed projects fetched separately)
  });
  
  // Also fetch all projects (not just active) to get complete mapping
  const allProjectsForMapping = await db
    .select({ id: projects.id, code: projects.code, name: projects.name })
    .from(projects)
    .limit(200);
  
  allProjectsForMapping.forEach(p => {
    projectIdToCode.set(p.id, p.code);
    projectIdToName.set(p.id, p.name);
  });

  const recentApprovedCOs = await db
    .select()
    .from(changeOrders)
    .where(eq(changeOrders.status, 'APPROVED'))
    .orderBy(desc(changeOrders.approvedAt))
    .limit(10);

  // Change orders needing attention (pending >7 days)
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const changeOrdersNeedingAttention = allChangeOrders
    .filter(co => 
      (co.status === 'PENDING_APPROVAL' || co.status === 'SUBMITTED') &&
      new Date(co.createdAt) < sevenDaysAgo
    )
    .map(co => ({
      project_code: projectIdToCode.get(co.projectId) || co.projectId,
      description: co.description,
      amount: Number(co.amount || 0),
      status: co.status,
      days_pending: Math.floor((now.getTime() - new Date(co.createdAt).getTime()) / (1000 * 60 * 60 * 24))
    }));

  // Calculate change order totals by status
  const coByStatus = {
    draft_count: allChangeOrders.filter(co => co.status === 'DRAFT').length,
    draft_value: allChangeOrders.filter(co => co.status === 'DRAFT').reduce((sum, co) => sum + Number(co.amount || 0), 0),
    pending_approval_count: allChangeOrders.filter(co => co.status === 'PENDING_APPROVAL').length,
    pending_approval_value: allChangeOrders.filter(co => co.status === 'PENDING_APPROVAL').reduce((sum, co) => sum + Number(co.amount || 0), 0),
    submitted_count: allChangeOrders.filter(co => co.status === 'SUBMITTED').length,
    submitted_value: allChangeOrders.filter(co => co.status === 'SUBMITTED').reduce((sum, co) => sum + Number(co.amount || 0), 0),
    approved_count: allChangeOrders.filter(co => co.status === 'APPROVED').length,
    approved_value: allChangeOrders.filter(co => co.status === 'APPROVED').reduce((sum, co) => sum + Number(co.amount || 0), 0),
    rejected_count: allChangeOrders.filter(co => co.status === 'REJECTED').length,
    rejected_value: allChangeOrders.filter(co => co.status === 'REJECTED').reduce((sum, co) => sum + Number(co.amount || 0), 0),
  };

  // Group change orders by project
  const coByProject = new Map<string, any>();
  for (const co of allChangeOrders) {
    const projectCode = projectIdToCode.get(co.projectId) || co.projectId;
    const projectName = projectIdToName.get(co.projectId) || 'Unknown';
    
    if (!coByProject.has(projectCode)) {
      coByProject.set(projectCode, {
        project_code: projectCode,
        project_name: projectName,
        total_count: 0,
        total_value: 0,
        approved_value: 0,
        statuses: { DRAFT: 0, PENDING_APPROVAL: 0, SUBMITTED: 0, APPROVED: 0, REJECTED: 0 }
      });
    }
    const projectData = coByProject.get(projectCode);
    projectData.total_count++;
    projectData.total_value += Number(co.amount || 0);
    if (co.status === 'APPROVED') {
      projectData.approved_value += Number(co.amount || 0);
    }
    projectData.statuses[co.status]++;
  }

  const coByProjectArray = Array.from(coByProject.values()).map(p => ({
    ...p,
    status_breakdown: Object.entries(p.statuses)
      .filter(([_, count]) => (count as number) > 0)
      .map(([status, count]) => `${status}: ${count as number}`)
      .join(', ')
  }));

  // Billing events (using current schema: scopeItemId, quantity, unitPrice, totalAmount)
  const recentBillingEvents = await db
    .select()
    .from(billingEvents)
    .where(sql`${billingEvents.createdAt} >= ${startOfYear.toISOString().split('T')[0]}`)
    .limit(200);

  const totalBilled = recentBillingEvents.reduce((sum, e) => sum + Number(e.totalAmount || 0), 0);
  const totalReceived = 0; // Will be calculated from payment tracking when implemented

  // Overdue invoices - to be implemented with payment tracking
  const overdueInvoices: any[] = [];

  // Active bids (using current schema: no status field, using dueDate instead of bidDeadline)
  const activeBids = await db
    .select()
    .from(bids)
    .limit(50);

  const upcomingBidDeadlines = activeBids
    .filter(bid => bid.dueDate && new Date(bid.dueDate) > now)
    .sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime())
    .slice(0, 10)
    .map(bid => ({
      client_name: bid.clientName,
      bid_amount: Number(bid.bidAmount || 0),
      bid_deadline: bid.dueDate?.toISOString().split('T')[0] || null,
      status: 'ACTIVE',
    }));

  // Crew statistics
  const allUsers = await db.select().from(users).limit(500);
  const superintendents = allUsers.filter(u => u.role === 'SUPERINTENDENT').length;
  const hourlyWorkers = allUsers.filter(u => u.role === 'HOURLY_EMPLOYEE').length;

  // Calculate overtime hours (>40 hours per week per employee) - to be properly implemented with user tracking
  const overtimeHours = weeklyTimeEntries.reduce(
    (sum, entry) => sum + Number(entry.hoursOvertime || 0),
    0
  );

  // Crew data - query actual crew tables
  const allCrews = await db.select().from(crews).limit(100);
  const activeCrews = allCrews.filter(c => c.isActive).length;
  
  // Count crew members across all crews
  const crewMembersData = await db
    .select({ count: sql<number>`count(*)` })
    .from(crewMembers)
    .limit(1);
  const totalCrewMembers = Number(crewMembersData[0]?.count || 0);
  
  // Count users with assigned skills
  const usersWithSkillsData = await db
    .select({ count: sql<number>`count(DISTINCT ${userSkills.userId})` })
    .from(userSkills)
    .limit(1);
  const usersWithSkills = Number(usersWithSkillsData[0]?.count || 0);
  
  const usersWithoutCostRates = allUsers.filter(u => !u.costRateRegular || !u.costRateOvertime).length;

  // Subcontractor data
  const allSubcontractorContracts = await db
    .select()
    .from(subcontractorContracts)
    .where(sql`${subcontractorContracts.status} IN ('ACTIVE', 'PENDING')`)
    .limit(200);

  const contractsByProject: { [key: string]: { count: number; value: number } } = {};
  allSubcontractorContracts.forEach(contract => {
    const projectId = contract.projectId;
    if (!contractsByProject[projectId]) {
      contractsByProject[projectId] = { count: 0, value: 0 };
    }
    contractsByProject[projectId].count++;
    contractsByProject[projectId].value += Number(contract.contractAmount || 0);
  });

  const activeContractsByProject = Object.entries(contractsByProject).map(([projectId, data]) => ({
    project_code: projectId,
    contract_count: data.count,
    total_value: Math.round(data.value * 100) / 100,
  }));

  // Data quality scores
  const qualityScores = await db
    .select()
    .from(aiDataQuality)
    .limit(1000);

  const avgQualityScore = qualityScores.length > 0
    ? Math.round(qualityScores.reduce((sum, q) => sum + q.overallScore, 0) / qualityScores.length)
    : 0;

  const projectsBelowThreshold = qualityScores.filter(q => q.overallScore < 60).length;

  const commonIssues: string[] = [];
  qualityScores.forEach(q => {
    if (q.missingFields && q.missingFields.length > 0) {
      q.missingFields.forEach(field => {
        if (!commonIssues.includes(field)) {
          commonIssues.push(field);
        }
      });
    }
  });

  // Missing financials
  const projectsMissingFinancials = activeProjects.filter(
    p => !p.budget || Number(p.budget) === 0 || !p.contractAmount || Number(p.contractAmount) === 0
  );

  return {
    generated_at: now.toISOString(),
    projects: {
      total_active: activeProjects.length,
      total_completed: completedProjectsCount[0]?.count || 0,
      active_projects: activeProjects.map(p => ({
        code: p.code,
        name: p.name,
        status: p.status,
        budget: Number(p.budget || 0),
        contract_amount: Number(p.contractAmount || 0),
        start_date: p.startDate?.toISOString().split('T')[0] || null,
        estimated_completion: p.estimatedCompletionDate?.toISOString().split('T')[0] || null,
        client_name: p.clientName,
        superintendent_id: p.superintendentId,
        missing_financials: !p.budget || Number(p.budget) === 0 || !p.contractAmount || Number(p.contractAmount) === 0,
      })),
      missing_financials_count: activeProjects.filter(p => !p.budget || Number(p.budget) === 0 || !p.contractAmount || Number(p.contractAmount) === 0).length,
    },
    labor: {
      total_hours_this_week: Math.round(totalHoursThisWeek * 100) / 100,
      total_cost_this_week: Math.round(totalCostThisWeek * 100) / 100,
      unapproved_entries_count: unapprovedEntries.length,
      unapproved_entries_value: Math.round(unapprovedValue * 100) / 100,
      active_shifts_count: activeShiftsCount[0]?.count || 0,
    },
    procurement: {
      pending_orders_count: pendingProcurement.length,
      pending_orders_value: pendingProcurement.reduce((sum, item) => sum + (Number(item.unitCost || 0) * Number(item.quantity || 0)), 0),
      urgent_items: urgentItems,
    },
    change_orders: {
      total_count: allChangeOrders.length,
      total_value: allChangeOrders.reduce((sum, co) => sum + Number(co.amount || 0), 0),
      by_status: coByStatus,
      by_project: coByProjectArray,
      recent_approvals: recentApprovedCOs.map(co => ({
        project_code: projectIdToCode.get(co.projectId) || co.projectId,
        description: co.description,
        amount: Number(co.amount || 0),
        status: co.status,
      })),
      needs_attention: changeOrdersNeedingAttention,
    },
    billing: {
      total_invoiced_ytd: Math.round(totalBilled * 100) / 100,
      total_received_ytd: Math.round(totalReceived * 100) / 100,
      overdue_invoices: overdueInvoices,
    },
    bids: {
      active_count: activeBids.length,
      total_value: activeBids.reduce((sum, bid) => sum + Number(bid.bidAmount || 0), 0),
      upcoming_deadlines: upcomingBidDeadlines,
    },
    crew: {
      total_employees: allUsers.length,
      superintendents: superintendents,
      hourly_workers: hourlyWorkers,
      overtime_hours_this_week: Math.round(overtimeHours * 100) / 100,
      total_crews: allCrews.length,
      active_crews: activeCrews,
      total_crew_members: totalCrewMembers,
      users_with_skills: usersWithSkills,
      users_without_cost_rates: usersWithoutCostRates,
    },
    subcontractors: {
      total_active_contracts: allSubcontractorContracts.length,
      total_contract_value: Math.round(allSubcontractorContracts.reduce((sum, c) => sum + Number(c.contractAmount || 0), 0) * 100) / 100,
      active_contracts_by_project: activeContractsByProject,
    },
    data_quality: {
      avg_overall_score: avgQualityScore,
      projects_below_threshold: projectsBelowThreshold,
      common_issues: commonIssues.slice(0, 10),
    },
    missing_financials: {
      count: projectsMissingFinancials.length,
      project_codes: projectsMissingFinancials.map(p => p.code),
    },
  };
}
