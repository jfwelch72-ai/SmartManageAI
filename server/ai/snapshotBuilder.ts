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
  aiDataQuality,
  projectEquipmentPlans,
  equipment,
  equipmentAssignments,
  equipmentRateProfiles,
  rentalEquipmentCatalog,
  rentalEquipmentUsages,
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
      vendor: string | null;
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
    all_bids_for_followup: {
      code: string;
      name: string;
      client_name: string;
      bid_amount: number;
      date_submitted: string;
      days_since_submission: number;
      due_date: string | null;
      estimator_id: string | null;
      needs_weekly_followup: boolean;
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
    contracts_with_lead_times: {
      project_code: string | null;
      scope_of_work: string;
      payment_terms: string | null;
      status: string;
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
  equipment: {
    total_fleet_count: number;
    assigned_to_projects: number;
    available_count: number;
    equipment_plans_summary: {
      total_planned_items: number;
      owned_count: number;
      rental_count: number;
      total_planned_cost: number;
      total_actual_cost: number;
      cost_variance: number;
    };
    projects_with_equipment: {
      project_code: string;
      project_name: string;
      equipment_count: number;
      planned_cost: number;
      actual_cost: number;
      cost_variance: number;
    }[];
    rentals_pending_booking: {
      project_code: string;
      equipment_name: string;
      planned_cost: number;
      planned_start: string | null;
    }[];
    equipment_cost_alerts: {
      project_code: string;
      equipment_name: string;
      planned_cost: number;
      actual_cost: number;
      variance_percent: number;
    }[];
    roi_analysis: {
      rental_vs_owned_comparison: {
        equipment_type: string;
        avg_rental_daily_rate: number;
        avg_owned_daily_rate: number;
        break_even_days: number;
        recommendation: string;
      }[];
      frequently_rented_equipment: {
        equipment_type: string;
        rental_count: number;
        total_rental_cost: number;
        avg_rental_duration_days: number;
        purchase_recommendation: string;
      }[];
      underutilized_owned: {
        equipment_code: string;
        equipment_name: string;
        days_since_last_assignment: number;
        purchase_price: number;
        monthly_carrying_cost: number;
      }[];
    };
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
      vendor: item.vendor,
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
  // Using higher limit to ensure all equipment plan project IDs can be resolved
  const allProjectsForMapping = await db
    .select({ id: projects.id, code: projects.code, name: projects.name })
    .from(projects)
    .limit(1000);
  
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

  // Change orders needing attention (submitted >7 days without response)
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const changeOrdersNeedingAttention = allChangeOrders
    .filter(co => {
      if (co.status !== 'SUBMITTED') return false;
      // Use submittedAt if available, otherwise fall back to createdAt
      const checkDate = co.submittedAt ? new Date(co.submittedAt) : new Date(co.createdAt);
      return checkDate < sevenDaysAgo;
    })
    .map(co => {
      const checkDate = co.submittedAt ? new Date(co.submittedAt) : new Date(co.createdAt);
      return {
        project_code: projectIdToCode.get(co.projectId) || co.projectId,
        description: co.description,
        amount: Number(co.amount || 0),
        status: co.status,
        days_pending: Math.floor((now.getTime() - checkDate.getTime()) / (1000 * 60 * 60 * 24))
      };
    });

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

  // Build bid follow-up tracking data for estimator reminders
  const allBidsForFollowup = activeBids.map(bid => {
    const submissionDate = new Date(bid.createdAt);
    const daysSinceSubmission = Math.floor((now.getTime() - submissionDate.getTime()) / (1000 * 60 * 60 * 24));
    // Needs weekly follow-up if submitted more than 7 days ago
    const needsWeeklyFollowup = daysSinceSubmission >= 7;
    
    return {
      code: bid.code,
      name: bid.name,
      client_name: bid.clientName,
      bid_amount: Number(bid.bidAmount || 0),
      date_submitted: submissionDate.toISOString().split('T')[0],
      days_since_submission: daysSinceSubmission,
      due_date: bid.dueDate?.toISOString().split('T')[0] || null,
      estimator_id: bid.estimatorId,
      needs_weekly_followup: needsWeeklyFollowup,
    };
  });

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

  // Equipment data
  const allEquipment = await db
    .select()
    .from(equipment)
    .limit(500);

  const activeAssignments = await db
    .select()
    .from(equipmentAssignments)
    .where(sql`${equipmentAssignments.returnedAt} IS NULL`)
    .limit(500);

  const allEquipmentPlans = await db
    .select()
    .from(projectEquipmentPlans)
    .limit(1000);

  const ownedPlans = allEquipmentPlans.filter(p => p.source === 'OWNED');
  const rentalPlans = allEquipmentPlans.filter(p => p.source === 'RENTAL');

  const totalPlannedCost = allEquipmentPlans.reduce((sum, p) => sum + Number(p.plannedCost || 0), 0);
  const totalActualEquipmentCost = allEquipmentPlans.reduce((sum, p) => sum + Number(p.actualCost || 0), 0);

  // Group equipment by project
  const equipmentByProject = new Map<string, typeof allEquipmentPlans>();
  for (const plan of allEquipmentPlans) {
    const projectId = plan.projectId;
    if (!equipmentByProject.has(projectId)) {
      equipmentByProject.set(projectId, []);
    }
    equipmentByProject.get(projectId)!.push(plan);
  }

  const projectsWithEquipment = Array.from(equipmentByProject.entries())
    .map(([projectId, plans]) => {
      const projectCode = projectIdToCode.get(projectId) || projectId;
      const projectName = projectIdToName.get(projectId) || 'Unknown';
      const plannedCost = plans.reduce((sum, p) => sum + Number(p.plannedCost || 0), 0);
      const actualCost = plans.reduce((sum, p) => sum + Number(p.actualCost || 0), 0);
      return {
        project_code: projectCode,
        project_name: projectName,
        equipment_count: plans.length,
        planned_cost: Math.round(plannedCost * 100) / 100,
        actual_cost: Math.round(actualCost * 100) / 100,
        cost_variance: Math.round((plannedCost - actualCost) * 100) / 100,
      };
    })
    .filter(p => p.equipment_count > 0);

  // Rentals pending booking (RENTAL source with PLANNED status)
  const rentalsPendingBooking = allEquipmentPlans
    .filter(p => p.source === 'RENTAL' && p.status === 'PLANNED')
    .map(p => ({
      project_code: projectIdToCode.get(p.projectId) || p.projectId,
      equipment_name: p.equipmentName,
      planned_cost: Number(p.plannedCost || 0),
      planned_start: p.plannedStartDate?.toISOString().split('T')[0] || null,
    }));

  // Equipment cost alerts (>20% over budget)
  const equipmentCostAlerts = allEquipmentPlans
    .filter(p => {
      const planned = Number(p.plannedCost || 0);
      const actual = Number(p.actualCost || 0);
      return planned > 0 && actual > 0 && actual > planned * 1.2;
    })
    .map(p => {
      const planned = Number(p.plannedCost || 0);
      const actual = Number(p.actualCost || 0);
      return {
        project_code: projectIdToCode.get(p.projectId) || p.projectId,
        equipment_name: p.equipmentName,
        planned_cost: Math.round(planned * 100) / 100,
        actual_cost: Math.round(actual * 100) / 100,
        variance_percent: Math.round(((actual - planned) / planned) * 100),
      };
    });

  // ROI Analysis: Rental vs Purchase Comparison
  
  // Get owned equipment rate profiles for daily rate comparison
  const ownedRateProfiles = await db
    .select({
      equipmentId: equipmentRateProfiles.equipmentId,
      dailyRate: equipmentRateProfiles.dailyRate,
      hourlyRate: equipmentRateProfiles.hourlyRate,
      fuelCostPerHour: equipmentRateProfiles.fuelCostPerHour,
      maintenanceCostPerHour: equipmentRateProfiles.maintenanceCostPerHour,
    })
    .from(equipmentRateProfiles)
    .where(eq(equipmentRateProfiles.isActive, true))
    .limit(500);

  // Get rental catalog for rate comparison
  const rentalCatalogItems = await db
    .select({
      equipmentType: rentalEquipmentCatalog.equipmentType,
      dailyRate: rentalEquipmentCatalog.dailyRate,
      weeklyRate: rentalEquipmentCatalog.weeklyRate,
      monthlyRate: rentalEquipmentCatalog.monthlyRate,
    })
    .from(rentalEquipmentCatalog)
    .where(eq(rentalEquipmentCatalog.isActive, true))
    .limit(500);

  // Get rental usage history for frequency analysis
  const rentalUsageHistory = await db
    .select({
      equipmentType: rentalEquipmentUsages.equipmentType,
      dailyRate: rentalEquipmentUsages.dailyRate,
      startDate: rentalEquipmentUsages.startDate,
      actualEndDate: rentalEquipmentUsages.actualEndDate,
      expectedEndDate: rentalEquipmentUsages.expectedEndDate,
      totalCost: rentalEquipmentUsages.totalCost,
      status: rentalEquipmentUsages.status,
    })
    .from(rentalEquipmentUsages)
    .limit(1000);

  // Group rental catalog by equipment type for avg rates
  const rentalRatesByType = new Map<string, { dailyRates: number[], weeklyRates: number[], monthlyRates: number[] }>();
  for (const item of rentalCatalogItems) {
    const type = item.equipmentType;
    if (!rentalRatesByType.has(type)) {
      rentalRatesByType.set(type, { dailyRates: [], weeklyRates: [], monthlyRates: [] });
    }
    const rates = rentalRatesByType.get(type)!;
    if (item.dailyRate) rates.dailyRates.push(Number(item.dailyRate));
    if (item.weeklyRate) rates.weeklyRates.push(Number(item.weeklyRate));
    if (item.monthlyRate) rates.monthlyRates.push(Number(item.monthlyRate));
  }

  // Group owned equipment by type and get average daily rates
  const ownedEquipmentByType = new Map<string, number[]>();
  for (const equip of allEquipment) {
    const type = equip.type;
    // Find rate profile for this equipment
    const rateProfile = ownedRateProfiles.find(r => r.equipmentId === equip.id);
    if (rateProfile && rateProfile.dailyRate) {
      if (!ownedEquipmentByType.has(type)) {
        ownedEquipmentByType.set(type, []);
      }
      // Daily rate + estimated operating costs (fuel + maintenance for 8 hours)
      const operatingCost = (Number(rateProfile.fuelCostPerHour || 0) + Number(rateProfile.maintenanceCostPerHour || 0)) * 8;
      ownedEquipmentByType.get(type)!.push(Number(rateProfile.dailyRate) + operatingCost);
    }
  }

  // Create rental vs owned comparison
  const rentalVsOwnedComparison: {
    equipment_type: string;
    avg_rental_daily_rate: number;
    avg_owned_daily_rate: number;
    break_even_days: number;
    recommendation: string;
  }[] = [];

  for (const [type, rentalRates] of Array.from(rentalRatesByType.entries())) {
    const ownedRates = ownedEquipmentByType.get(type);
    if (!ownedRates || ownedRates.length === 0) continue;
    if (rentalRates.dailyRates.length === 0) continue;

    const avgRentalDaily = rentalRates.dailyRates.reduce((a: number, b: number) => a + b, 0) / rentalRates.dailyRates.length;
    const avgOwnedDaily = ownedRates.reduce((a: number, b: number) => a + b, 0) / ownedRates.length;

    // Find an example owned equipment of this type for purchase price
    const exampleEquip = allEquipment.find(e => e.type === type && e.purchasePrice);
    const avgPurchasePrice = exampleEquip ? Number(exampleEquip.purchasePrice) : 0;
    
    // Skip if no valid purchase price available
    if (avgPurchasePrice <= 0) continue;

    // Break-even: days where rental cost savings would equal purchase price
    // Only calculate if renting costs more than owning (positive savings)
    const dailySavings = avgRentalDaily - avgOwnedDaily;
    
    let breakEvenDays: number;
    let recommendation: string;
    
    if (dailySavings <= 0) {
      // Owning costs more or equal to renting - no break-even benefit
      breakEvenDays = -1; // Indicates renting is more economical
      recommendation = "Continue renting - owned daily rate (incl. operating costs) equals or exceeds rental rate";
    } else {
      // Break-even assumes daily usage; actual ROI depends on utilization
      breakEvenDays = Math.round(avgPurchasePrice / dailySavings);
      
      if (breakEvenDays < 365) {
        recommendation = `EVALUATE: ~${breakEvenDays} days to break-even (assumes daily use, verify utilization)`;
      } else if (breakEvenDays < 730) {
        recommendation = `MONITOR: ~${Math.round(breakEvenDays / 30)} months to break-even at daily use`;
      } else {
        recommendation = `RENT: ${Math.round(breakEvenDays / 365)}+ year break-even makes ownership less attractive`;
      }
    }

    rentalVsOwnedComparison.push({
      equipment_type: type,
      avg_rental_daily_rate: Math.round(avgRentalDaily * 100) / 100,
      avg_owned_daily_rate: Math.round(avgOwnedDaily * 100) / 100,
      break_even_days: breakEvenDays,
      recommendation,
    });
  }

  // Analyze frequently rented equipment types - only count completed rentals with valid data
  const rentalFrequencyByType = new Map<string, { count: number, totalCost: number, totalDays: number, validDurationCount: number }>();
  for (const usage of rentalUsageHistory) {
    // Only count completed or active rentals (skip cancelled/invalid)
    if (!usage.status || usage.status === 'CANCELLED') continue;
    
    const type = usage.equipmentType;
    if (!type) continue;
    
    if (!rentalFrequencyByType.has(type)) {
      rentalFrequencyByType.set(type, { count: 0, totalCost: 0, totalDays: 0, validDurationCount: 0 });
    }
    const data = rentalFrequencyByType.get(type)!;
    data.count++;
    data.totalCost += Number(usage.totalCost || 0);
    
    // Calculate rental duration only when we have valid dates
    const endDate = usage.actualEndDate || (usage.status === 'COMPLETED' ? usage.expectedEndDate : null);
    if (endDate && usage.startDate) {
      const startTime = new Date(usage.startDate).getTime();
      const endTime = new Date(endDate).getTime();
      if (!isNaN(startTime) && !isNaN(endTime) && endTime >= startTime) {
        const days = Math.ceil((endTime - startTime) / (1000 * 60 * 60 * 24));
        data.totalDays += Math.max(1, days);
        data.validDurationCount++;
      }
    }
  }

  const frequentlyRentedEquipment: {
    equipment_type: string;
    rental_count: number;
    total_rental_cost: number;
    avg_rental_duration_days: number;
    purchase_recommendation: string;
  }[] = Array.from(rentalFrequencyByType.entries())
    .filter(([, data]) => data.count >= 2) // At least 2 rentals
    .map(([type, data]) => {
      // Only calculate average if we have valid duration data
      const avgDuration = data.validDurationCount > 0 
        ? Math.round(data.totalDays / data.validDurationCount) 
        : 0;
      
      // Get typical purchase price for this equipment type
      const exampleEquip = allEquipment.find(e => e.type === type && e.purchasePrice);
      const typicalPrice = exampleEquip ? Number(exampleEquip.purchasePrice) : 0;
      
      let recommendation: string;
      
      if (typicalPrice <= 0) {
        recommendation = "INSUFFICIENT DATA: No purchase price available for comparison";
      } else if (data.totalDays > 0 && data.totalCost > 0) {
        // Calculate annualized rental cost based on historical usage pattern
        // Note: This extrapolates current spending; seasonal patterns may affect accuracy
        const annualProjected = data.totalCost * (365 / data.totalDays);
        const yearsToPayoff = annualProjected > 0 ? typicalPrice / annualProjected : 999;
        const totalSpent = Math.round(data.totalCost);
        
        if (yearsToPayoff < 1.5) {
          recommendation = `REVIEW: $${totalSpent} spent, ~${Math.round(yearsToPayoff * 12)}mo payoff at current rate`;
        } else if (yearsToPayoff < 3) {
          recommendation = `MONITOR: $${totalSpent} spent, ~${Math.round(yearsToPayoff * 10) / 10}yr payoff`;
        } else {
          recommendation = `CONTINUE RENTING: $${totalSpent} spent, ${Math.round(yearsToPayoff)}+yr payoff`;
        }
      } else {
        recommendation = "REVIEW NEEDED: Rental cost/duration data incomplete";
      }
      
      return {
        equipment_type: type,
        rental_count: data.count,
        total_rental_cost: Math.round(data.totalCost * 100) / 100,
        avg_rental_duration_days: avgDuration,
        purchase_recommendation: recommendation,
      };
    })
    .filter(item => item.total_rental_cost > 0) // Only include items with actual costs
    .sort((a, b) => b.total_rental_cost - a.total_rental_cost)
    .slice(0, 10);

  // Find underutilized owned equipment
  // First, get all assignments (not just active) to find last assignment date
  const allAssignmentsForAnalysis = await db
    .select({
      equipmentId: equipmentAssignments.equipmentId,
      assignedAt: equipmentAssignments.assignedAt,
      returnedAt: equipmentAssignments.returnedAt,
    })
    .from(equipmentAssignments)
    .limit(2000);

  // Group assignments by equipment to find most recent
  const lastAssignmentByEquipment = new Map<string, Date>();
  for (const assignment of allAssignmentsForAnalysis) {
    const existing = lastAssignmentByEquipment.get(assignment.equipmentId);
    const assignedDate = assignment.assignedAt ? new Date(assignment.assignedAt) : null;
    
    if (assignedDate && !isNaN(assignedDate.getTime())) {
      if (!existing || assignedDate > existing) {
        lastAssignmentByEquipment.set(assignment.equipmentId, assignedDate);
      }
    }
  }

  const underutilizedOwned: {
    equipment_code: string;
    equipment_name: string;
    days_since_last_assignment: number;
    purchase_price: number;
    monthly_carrying_cost: number;
  }[] = allEquipment
    .filter(e => e.status === 'AVAILABLE' && e.purchasePrice && Number(e.purchasePrice) > 0)
    .map(e => {
      // Find last assignment for this equipment
      const lastAssignmentDate = lastAssignmentByEquipment.get(e.id);
      
      let daysSinceLast: number;
      if (lastAssignmentDate) {
        daysSinceLast = Math.ceil((now.getTime() - lastAssignmentDate.getTime()) / (1000 * 60 * 60 * 24));
        // Guard against invalid dates producing negative or NaN values
        if (isNaN(daysSinceLast) || daysSinceLast < 0) {
          daysSinceLast = 0;
        }
      } else {
        // Never assigned - check how long since purchase
        const purchaseDate = e.purchaseDate ? new Date(e.purchaseDate) : null;
        if (purchaseDate && !isNaN(purchaseDate.getTime())) {
          daysSinceLast = Math.ceil((now.getTime() - purchaseDate.getTime()) / (1000 * 60 * 60 * 24));
          if (isNaN(daysSinceLast) || daysSinceLast < 0) daysSinceLast = 0;
        } else {
          // No purchase date or assignment history - exclude from underutilized list
          // by setting to 0 (will be filtered out below)
          daysSinceLast = 0;
        }
      }

      // Estimate monthly carrying cost using standard construction equipment assumptions:
      // - Depreciation: 5-year straight-line (typical for heavy equipment)
      // - Insurance/storage: ~1% of value per month
      // Note: Actual costs may vary based on equipment type and company policies
      const purchasePrice = Number(e.purchasePrice || 0);
      const monthlyDepreciation = purchasePrice / (5 * 12); // 5-year depreciation
      const monthlyInsuranceStorage = purchasePrice * 0.01; // ~1% for insurance/storage
      const monthlyCarryingCost = monthlyDepreciation + monthlyInsuranceStorage;

      return {
        equipment_code: e.equipmentCode,
        equipment_name: e.name,
        days_since_last_assignment: daysSinceLast,
        purchase_price: purchasePrice,
        monthly_carrying_cost: Math.round(monthlyCarryingCost * 100) / 100,
      };
    })
    .filter(e => e.days_since_last_assignment > 60 && e.purchase_price > 0) // Idle for over 60 days with valid price
    .sort((a, b) => b.monthly_carrying_cost - a.monthly_carrying_cost)
    .slice(0, 10);

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
      all_bids_for_followup: allBidsForFollowup,
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
      contracts_with_lead_times: allSubcontractorContracts
        .filter(c => c.paymentTerms && c.paymentTerms.includes('Lead Time'))
        .slice(0, 20)
        .map(c => ({
          project_code: projectIdToCode.get(c.projectId) || c.projectId,
          scope_of_work: c.scopeOfWork,
          payment_terms: c.paymentTerms,
          status: c.status,
        })),
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
    equipment: {
      total_fleet_count: allEquipment.length,
      assigned_to_projects: activeAssignments.length,
      available_count: allEquipment.filter(e => e.status === 'AVAILABLE').length,
      equipment_plans_summary: {
        total_planned_items: allEquipmentPlans.length,
        owned_count: ownedPlans.length,
        rental_count: rentalPlans.length,
        total_planned_cost: Math.round(totalPlannedCost * 100) / 100,
        total_actual_cost: Math.round(totalActualEquipmentCost * 100) / 100,
        cost_variance: Math.round((totalPlannedCost - totalActualEquipmentCost) * 100) / 100,
      },
      projects_with_equipment: projectsWithEquipment,
      rentals_pending_booking: rentalsPendingBooking,
      equipment_cost_alerts: equipmentCostAlerts,
      roi_analysis: {
        rental_vs_owned_comparison: rentalVsOwnedComparison,
        frequently_rented_equipment: frequentlyRentedEquipment,
        underutilized_owned: underutilizedOwned,
      },
    },
  };
}
