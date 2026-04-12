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
  projectMaterialBudgets,
  delayClaims,
  dailyReportLocks,
  photoCustodyRecords,
  voiceLogs,
  issueCaptures,
  offlineSyncQueue,
  vendorScores,
  materialPriceIndex,
  crewMarketplace,
  vendorPricebooks,
  pricebookImportJobs,
  unifiedPayments,
  payApplications,
  tmInvoices,
} from "@shared/schema";
import { sql, desc, eq, gt } from "drizzle-orm";
import { calculateProjectDataQuality } from "./dataQualityScorer";

interface CappedResult<T> { rows: T[]; totalCount: number; isTruncated: boolean }

async function cappedQuery<T>(
  queryFn: (limit: number) => Promise<T[]>,
  cap: number,
  countQuery: () => Promise<{ count: number }[]>
): Promise<CappedResult<T>> {
  const [countResult] = await countQuery();
  const totalCount = countResult?.count || 0;
  const rows = await queryFn(cap + 1);
  const isTruncated = rows.length > cap;
  return { rows: isTruncated ? rows.slice(0, cap) : rows, totalCount, isTruncated };
}

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
  material_budgets: {
    total_projects_with_budgets: number;
    total_budgeted_cost: number;
    total_actual_cost: number;
    overall_variance: number;
    overall_variance_percent: number;
    alerts_triggered: number;
    projects_at_risk: {
      project_code: string;
      project_name: string;
      items_at_risk: number;
      budgeted_cost: number;
      actual_cost: number;
      variance_percent: number;
    }[];
    material_alerts: {
      project_code: string;
      project_name: string;
      material_description: string;
      budgeted_quantity: number;
      used_quantity: number;
      remaining_quantity: number;
      usage_percent: number;
      recommendation: string;
    }[];
  };
  delay_claims: {
    total_claims: number;
    claims_by_status: {
      draft: number;
      under_review: number;
      approved: number;
      rejected: number;
      submitted: number;
    };
    total_claimed_days: number;
    total_claimed_amount: number;
    recent_claims: {
      project_id: string;
      claim_type: string;
      claimed_days: number;
      claimed_amount: number;
      status: string;
    }[];
  };
  daily_report_locks: {
    total_locked_reports: number;
    locked_by_project: {
      project_id: string;
      locked_count: number;
    }[];
  };
  field_productivity: {
    voice_logs_count: number;
    issue_captures_count: number;
    pending_sync_items: number;
    recent_issues: {
      project_id: string;
      category: string;
      severity: string;
      status: string;
    }[];
  };
  marketplace: {
    vendor_scores_count: number;
    avg_vendor_score: number;
    material_price_entries: number;
    crew_marketplace_listings: number;
    active_listings: number;
  };
  pricebook_status: {
    total_pricebooks: number;
    active_pricebooks: number;
    pending_import_jobs: number;
    processing_import_jobs: number;
  };
  _metadata: {
    query_caps: {
      [key: string]: { cap: number; totalCount: number; isTruncated: boolean };
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

  // Time entries in the last week — use SQL aggregation to avoid loading all rows
  const assumedRate = 50;
  const [weeklyAgg] = await db
    .select({
      totalRegularHours: sql<number>`coalesce(sum(${timeEntries.hoursRegular}::numeric), 0)::float`,
      totalOvertimeHours: sql<number>`coalesce(sum(${timeEntries.hoursOvertime}::numeric), 0)::float`,
      unapprovedRegular: sql<number>`coalesce(sum(case when ${timeEntries.approvedAt} is null then ${timeEntries.hoursRegular}::numeric else 0 end), 0)::float`,
      unapprovedOvertime: sql<number>`coalesce(sum(case when ${timeEntries.approvedAt} is null then ${timeEntries.hoursOvertime}::numeric else 0 end), 0)::float`,
      unapprovedCount: sql<number>`count(*) filter (where ${timeEntries.approvedAt} is null)::int`,
    })
    .from(timeEntries)
    .where(sql`${timeEntries.date} >= ${oneWeekAgo.toISOString().split('T')[0]}`);

  const totalHoursThisWeek = (weeklyAgg?.totalRegularHours || 0) + (weeklyAgg?.totalOvertimeHours || 0);
  const totalCostThisWeek = (weeklyAgg?.totalRegularHours || 0) * assumedRate + (weeklyAgg?.totalOvertimeHours || 0) * assumedRate * 1.5;
  const unapprovedEntriesCount = weeklyAgg?.unapprovedCount || 0;
  const unapprovedValue = (weeklyAgg?.unapprovedRegular || 0) * assumedRate + (weeklyAgg?.unapprovedOvertime || 0) * assumedRate * 1.5;

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
    .from(projects);
  
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

  const activePaymentsYTD = await db
    .select({ total: sql<number>`COALESCE(SUM(amount::numeric), 0)` })
    .from(unifiedPayments)
    .where(sql`${unifiedPayments.status} = 'ACTIVE' AND ${unifiedPayments.paymentDate} >= ${startOfYear.toISOString().split('T')[0]}`);
  const totalReceived = Number(activePaymentsYTD[0]?.total || 0);

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  const overdueAia = await db.execute(sql`
    SELECT pa.id, CONCAT('Pay App #', pa.application_number) as invoice_number,
      pa.project_id, p.name as project_name,
      COALESCE(pa.current_payment_due, '0')::numeric as total_amount,
      COALESCE((SELECT SUM(up.amount::numeric) FROM unified_payments up WHERE up.invoice_id = pa.id AND up.invoice_type = 'AIA_PAY_APP' AND up.status = 'ACTIVE'), 0) as paid_amount,
      pa.period_to as due_date
    FROM pay_applications pa
    LEFT JOIN projects p ON pa.project_id = p.id
    WHERE pa.status = 'APPROVED' AND pa.period_to < ${todayStr}
    LIMIT 50
  `);

  const overdueTm = await db.execute(sql`
    SELECT ti.id, ti.invoice_number,
      ti.project_id, p.name as project_name,
      COALESCE(ti.total, '0')::numeric as total_amount,
      COALESCE((SELECT SUM(up.amount::numeric) FROM unified_payments up WHERE up.invoice_id = ti.id AND up.invoice_type = 'TM_INVOICE' AND up.status = 'ACTIVE'), 0) as paid_amount,
      COALESCE(ti.due_date, ti.invoice_date) as due_date
    FROM tm_invoices ti
    LEFT JOIN projects p ON ti.project_id = p.id
    WHERE ti.status = 'SENT' AND COALESCE(ti.due_date, ti.invoice_date) < ${todayStr}
    LIMIT 50
  `);

  interface OverdueRow {
    id: string;
    invoice_number: string;
    project_id: string;
    project_name: string;
    total_amount: string | number;
    paid_amount: string | number;
    due_date: string;
  }

  function mapOverdueRow(r: OverdueRow, type: string) {
    const totalAmt = Number(r.total_amount || 0);
    const paidAmt = Number(r.paid_amount || 0);
    return {
      type,
      invoice_number: r.invoice_number,
      project_name: r.project_name,
      amount: totalAmt - paidAmt,
      due_date: r.due_date,
      days_overdue: Math.floor((today.getTime() - new Date(r.due_date).getTime()) / (1000 * 60 * 60 * 24)),
    };
  }

  function hasOutstanding(r: OverdueRow) {
    return Number(r.total_amount || 0) - Number(r.paid_amount || 0) > 0.01;
  }

  const overdueInvoices = [
    ...(overdueAia.rows as unknown as OverdueRow[])
      .filter(hasOutstanding)
      .map((r) => mapOverdueRow(r, "AIA_PAY_APP")),
    ...(overdueTm.rows as unknown as OverdueRow[])
      .filter(hasOutstanding)
      .map((r) => mapOverdueRow(r, "TM_INVOICE")),
  ];

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

  // Crew statistics — use SQL aggregation instead of fetching all rows
  const [userCounts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      superintendents: sql<number>`count(*) filter (where ${users.role} = 'SUPERINTENDENT')::int`,
      hourlyWorkers: sql<number>`count(*) filter (where ${users.role} = 'FIELD_WORKER')::int`,
      withoutCostRates: sql<number>`count(*) filter (where ${users.costRateRegular} is null or ${users.costRateOvertime} is null)::int`,
    })
    .from(users);
  const superintendents = userCounts?.superintendents || 0;
  const hourlyWorkers = userCounts?.hourlyWorkers || 0;
  const usersWithoutCostRates = userCounts?.withoutCostRates || 0;

  const overtimeHours = weeklyAgg?.totalOvertimeHours || 0;

  // Crew data — use SQL aggregation
  const [crewCounts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${crews.isActive} = true)::int`,
    })
    .from(crews);
  const activeCrews = crewCounts?.active || 0;

  const [crewMembersData] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(crewMembers);
  const totalCrewMembers = crewMembersData?.count || 0;

  const [usersWithSkillsData] = await db
    .select({ count: sql<number>`count(DISTINCT ${userSkills.userId})::int` })
    .from(userSkills);
  const usersWithSkills = usersWithSkillsData?.count || 0;

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

  // Data quality scores — use SQL aggregation instead of fetching all rows
  const [qualityAgg] = await db
    .select({
      count: sql<number>`count(*)::int`,
      avgScore: sql<number>`coalesce(round(avg(${aiDataQuality.overallScore})::numeric), 0)::int`,
      belowThreshold: sql<number>`count(*) filter (where ${aiDataQuality.overallScore} < 60)::int`,
    })
    .from(aiDataQuality);

  const avgQualityScore = qualityAgg?.avgScore || 0;
  const projectsBelowThreshold = qualityAgg?.belowThreshold || 0;

  const qualityScoresForIssues = await db
    .select({ missingFields: aiDataQuality.missingFields })
    .from(aiDataQuality)
    .where(sql`${aiDataQuality.missingFields} is not null and array_length(${aiDataQuality.missingFields}, 1) > 0`)
    .limit(200);

  const commonIssuesSet = new Set<string>();
  for (const q of qualityScoresForIssues) {
    if (q.missingFields) {
      for (const field of q.missingFields) {
        commonIssuesSet.add(field);
      }
    }
  }
  const commonIssues = Array.from(commonIssuesSet);

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

  const equipmentPlansResult = await cappedQuery(
    (cap) => db.select().from(projectEquipmentPlans).limit(cap),
    2000,
    () => db.select({ count: sql<number>`count(*)::int` }).from(projectEquipmentPlans)
  );
  const allEquipmentPlans = equipmentPlansResult.rows;

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
  const rentalUsageResult = await cappedQuery(
    (cap) => db.select({
      equipmentType: rentalEquipmentUsages.equipmentType,
      dailyRate: rentalEquipmentUsages.dailyRate,
      startDate: rentalEquipmentUsages.startDate,
      actualEndDate: rentalEquipmentUsages.actualEndDate,
      expectedEndDate: rentalEquipmentUsages.expectedEndDate,
      totalCost: rentalEquipmentUsages.totalCost,
      status: rentalEquipmentUsages.status,
    }).from(rentalEquipmentUsages).limit(cap),
    2000,
    () => db.select({ count: sql<number>`count(*)::int` }).from(rentalEquipmentUsages)
  );
  const rentalUsageHistory = rentalUsageResult.rows;

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
  const assignmentsResult = await cappedQuery(
    (cap) => db.select({
      equipmentId: equipmentAssignments.equipmentId,
      assignedAt: equipmentAssignments.assignedAt,
      returnedAt: equipmentAssignments.returnedAt,
    }).from(equipmentAssignments).limit(cap),
    2000,
    () => db.select({ count: sql<number>`count(*)::int` }).from(equipmentAssignments)
  );
  const allAssignmentsForAnalysis = assignmentsResult.rows;

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

  // Material budget variance analysis
  const materialBudgetsResult = await cappedQuery(
    (cap) => db.select({
      id: projectMaterialBudgets.id,
      projectId: projectMaterialBudgets.projectId,
      description: projectMaterialBudgets.description,
      unit: projectMaterialBudgets.unit,
      budgetedQuantity: projectMaterialBudgets.budgetedQuantity,
      budgetedTotalCost: projectMaterialBudgets.budgetedTotalCost,
      actualQuantityUsed: projectMaterialBudgets.actualQuantityUsed,
      actualTotalCost: projectMaterialBudgets.actualTotalCost,
      variancePercent: projectMaterialBudgets.variancePercent,
      alertTriggered: projectMaterialBudgets.alertTriggered,
    }).from(projectMaterialBudgets).limit(cap),
    2000,
    () => db.select({ count: sql<number>`count(*)::int` }).from(projectMaterialBudgets)
  );
  const allMaterialBudgets = materialBudgetsResult.rows;

  // Calculate overall material budget metrics
  const totalMaterialBudgeted = allMaterialBudgets.reduce((sum, b) => sum + Number(b.budgetedTotalCost || 0), 0);
  const totalMaterialActual = allMaterialBudgets.reduce((sum, b) => sum + Number(b.actualTotalCost || 0), 0);
  const materialAlertCount = allMaterialBudgets.filter(b => b.alertTriggered).length;

  // Group by project for at-risk analysis
  const materialByProject = new Map<string, { budgets: typeof allMaterialBudgets; totalBudgeted: number; totalActual: number; atRisk: number }>();
  for (const budget of allMaterialBudgets) {
    if (!materialByProject.has(budget.projectId)) {
      materialByProject.set(budget.projectId, { budgets: [], totalBudgeted: 0, totalActual: 0, atRisk: 0 });
    }
    const projectData = materialByProject.get(budget.projectId)!;
    projectData.budgets.push(budget);
    projectData.totalBudgeted += Number(budget.budgetedTotalCost || 0);
    projectData.totalActual += Number(budget.actualTotalCost || 0);
    if (Number(budget.variancePercent || 0) >= 90) {
      projectData.atRisk++;
    }
  }

  // Get projects at risk (any materials over 90%)
  const projectsAtRisk: { project_code: string; project_name: string; items_at_risk: number; budgeted_cost: number; actual_cost: number; variance_percent: number }[] = [];
  for (const [projectId, data] of Array.from(materialByProject.entries())) {
    if (data.atRisk > 0) {
      const project = activeProjects.find(p => p.code === projectIdToCode.get(projectId)) || 
                      { code: projectIdToCode.get(projectId) || projectId, name: "Unknown Project" };
      const variancePercent = data.totalBudgeted > 0 ? (data.totalActual / data.totalBudgeted) * 100 : 0;
      projectsAtRisk.push({
        project_code: project.code,
        project_name: project.name,
        items_at_risk: data.atRisk,
        budgeted_cost: Math.round(data.totalBudgeted * 100) / 100,
        actual_cost: Math.round(data.totalActual * 100) / 100,
        variance_percent: Math.round(variancePercent * 10) / 10,
      });
    }
  }

  // Get specific material alerts (items at 90%+)
  const materialAlerts = allMaterialBudgets
    .filter(b => Number(b.variancePercent || 0) >= 90)
    .slice(0, 20)
    .map(b => {
      const budgetedQty = Number(b.budgetedQuantity || 0);
      const usedQty = Number(b.actualQuantityUsed || 0);
      const remainingQty = budgetedQty - usedQty;
      const usagePercent = Number(b.variancePercent || 0);
      const projectCode = projectIdToCode.get(b.projectId) || b.projectId;
      const project = activeProjects.find(p => p.code === projectCode);
      
      let recommendation = "Consider creating a change order for additional materials.";
      if (usagePercent >= 100) {
        recommendation = "CRITICAL: Material budget exceeded. Create change order immediately.";
      } else if (usagePercent >= 95) {
        recommendation = "URGENT: Nearly exhausted. Prepare change order now.";
      }

      return {
        project_code: projectCode,
        project_name: project?.name || "Unknown Project",
        material_description: b.description,
        budgeted_quantity: budgetedQty,
        used_quantity: usedQty,
        remaining_quantity: remainingQty,
        usage_percent: Math.round(usagePercent * 10) / 10,
        recommendation,
      };
    });

  // Delay Claims data — use SQL aggregation
  const [delayClaimsAgg] = await db
    .select({
      draft: sql<number>`count(*) filter (where ${delayClaims.status} = 'DRAFT')::int`,
      under_review: sql<number>`count(*) filter (where ${delayClaims.status} = 'UNDER_REVIEW')::int`,
      approved: sql<number>`count(*) filter (where ${delayClaims.status} = 'APPROVED')::int`,
      rejected: sql<number>`count(*) filter (where ${delayClaims.status} = 'REJECTED')::int`,
      submitted: sql<number>`count(*) filter (where ${delayClaims.status} = 'SUBMITTED')::int`,
      totalClaimedDays: sql<number>`coalesce(sum(${delayClaims.daysRequested}::numeric), 0)::float`,
      totalClaimedAmount: sql<number>`coalesce(sum(${delayClaims.costRequested}::numeric), 0)::float`,
    })
    .from(delayClaims);

  const delayClaimsByStatus = {
    draft: delayClaimsAgg?.draft || 0,
    under_review: delayClaimsAgg?.under_review || 0,
    approved: delayClaimsAgg?.approved || 0,
    rejected: delayClaimsAgg?.rejected || 0,
    submitted: delayClaimsAgg?.submitted || 0,
  };

  const totalClaimedDays = delayClaimsAgg?.totalClaimedDays || 0;
  const totalClaimedAmount = delayClaimsAgg?.totalClaimedAmount || 0;

  const allDelayClaims = await db
    .select()
    .from(delayClaims)
    .orderBy(desc(delayClaims.createdAt))
    .limit(10);

  const recentDelayClaims = allDelayClaims
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 10)
    .map(c => ({
      id: c.id,
      project_id: c.projectId,
      claim_type: c.claimType,
      claimed_days: Number(c.daysRequested || 0),
      claimed_amount: Number(c.costRequested || 0),
      status: c.status,
    }));

  // Daily Report Locks data — use SQL aggregation
  const [totalLockedCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(dailyReportLocks);

  const lockedByProjectRows = await db
    .select({
      projectId: dailyReportLocks.projectId,
      lockedCount: sql<number>`count(*)::int`,
    })
    .from(dailyReportLocks)
    .groupBy(dailyReportLocks.projectId)
    .limit(500);

  const lockedByProjectArray = lockedByProjectRows.map(r => ({
    project_id: r.projectId,
    locked_count: r.lockedCount,
  }));

  // Field Productivity data
  const [voiceLogsCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(voiceLogs);

  const [issueCapturesCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(issueCaptures);

  const [pendingSyncCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(offlineSyncQueue)
    .where(eq(offlineSyncQueue.status, 'PENDING'));

  const recentIssues = await db
    .select({
      projectId: issueCaptures.projectId,
      category: issueCaptures.category,
      severity: issueCaptures.severity,
      status: issueCaptures.status,
    })
    .from(issueCaptures)
    .orderBy(desc(issueCaptures.createdAt))
    .limit(10);

  // Marketplace data
  const [vendorScoresCount] = await db
    .select({ 
      count: sql<number>`count(*)::int`,
      avgScore: sql<number>`coalesce(avg(overall_score)::int, 0)`,
    })
    .from(vendorScores);

  const [materialPriceCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(materialPriceIndex);

  const [crewListingsAgg] = await db
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${crewMarketplace.availabilityStatus} = 'AVAILABLE')::int`,
    })
    .from(crewMarketplace);

  const activeListings = crewListingsAgg?.active || 0;

  // Pricebook status
  const [pricebooksCount] = await db
    .select({ 
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where status = 'ACTIVE')::int`,
    })
    .from(vendorPricebooks);

  const [importJobsCount] = await db
    .select({
      pending: sql<number>`count(*) filter (where status = 'PENDING')::int`,
      processing: sql<number>`count(*) filter (where status = 'PROCESSING')::int`,
    })
    .from(pricebookImportJobs);

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
      unapproved_entries_count: unapprovedEntriesCount,
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
      total_employees: userCounts?.total || 0,
      superintendents: superintendents,
      hourly_workers: hourlyWorkers,
      overtime_hours_this_week: Math.round(overtimeHours * 100) / 100,
      total_crews: (crewCounts?.total || 0),
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
    material_budgets: {
      total_projects_with_budgets: materialByProject.size,
      total_budgeted_cost: Math.round(totalMaterialBudgeted * 100) / 100,
      total_actual_cost: Math.round(totalMaterialActual * 100) / 100,
      overall_variance: Math.round((totalMaterialActual - totalMaterialBudgeted) * 100) / 100,
      overall_variance_percent: totalMaterialBudgeted > 0 
        ? Math.round((totalMaterialActual / totalMaterialBudgeted) * 1000) / 10 
        : 0,
      alerts_triggered: materialAlertCount,
      projects_at_risk: projectsAtRisk,
      material_alerts: materialAlerts,
    },
    delay_claims: {
      total_claims: allDelayClaims.length,
      claims_by_status: delayClaimsByStatus,
      total_claimed_days: totalClaimedDays,
      total_claimed_amount: Math.round(totalClaimedAmount * 100) / 100,
      recent_claims: recentDelayClaims,
    },
    daily_report_locks: {
      total_locked_reports: totalLockedCount?.count || 0,
      locked_by_project: lockedByProjectArray,
    },
    field_productivity: {
      voice_logs_count: voiceLogsCount?.count || 0,
      issue_captures_count: issueCapturesCount?.count || 0,
      pending_sync_items: pendingSyncCount?.count || 0,
      recent_issues: recentIssues.map(i => ({
        project_id: i.projectId || 'unknown',
        category: i.category || 'uncategorized',
        severity: i.severity,
        status: i.status,
      })),
    },
    marketplace: {
      vendor_scores_count: vendorScoresCount?.count || 0,
      avg_vendor_score: vendorScoresCount?.avgScore || 0,
      material_price_entries: materialPriceCount?.count || 0,
      crew_marketplace_listings: crewListingsAgg?.total || 0,
      active_listings: activeListings,
    },
    pricebook_status: {
      total_pricebooks: pricebooksCount?.total || 0,
      active_pricebooks: pricebooksCount?.active || 0,
      pending_import_jobs: importJobsCount?.pending || 0,
      processing_import_jobs: importJobsCount?.processing || 0,
    },
    _metadata: {
      query_caps: {
        equipment_assignments: {
          cap: 2000,
          totalCount: assignmentsResult.totalCount,
          isTruncated: assignmentsResult.isTruncated,
        },
        equipment_plans: {
          cap: 2000,
          totalCount: equipmentPlansResult.totalCount,
          isTruncated: equipmentPlansResult.isTruncated,
        },
        rental_usage_history: {
          cap: 2000,
          totalCount: rentalUsageResult.totalCount,
          isTruncated: rentalUsageResult.isTruncated,
        },
        material_budgets: {
          cap: 2000,
          totalCount: materialBudgetsResult.totalCount,
          isTruncated: materialBudgetsResult.isTruncated,
        },
      },
    },
  };
}
