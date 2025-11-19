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
  users
} from "@shared/schema";
import { sql, desc, eq } from "drizzle-orm";

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
      start_date: string | null;
      estimated_completion: string | null;
      client_name: string;
      superintendent_id: string | null;
    }[];
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
    pending_approval_count: number;
    pending_approval_value: number;
    recent_approvals: {
      project_code: string | null;
      description: string;
      amount: number;
      status: string;
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
      startDate: projects.startDate,
      estimatedCompletion: projects.estimatedCompletion,
      clientName: projects.clientName,
      superintendentId: projects.superintendentId,
    })
    .from(projects)
    .where(sql`${projects.status} IN ('ACTIVE', 'PLANNING')`)
    .limit(100);

  const completedProjectsCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projects)
    .where(eq(projects.status, 'COMPLETED'));

  // Time entries in the last week
  const weeklyTimeEntries = await db
    .select({
      hours: timeEntries.hours,
      hourlyRate: timeEntries.hourlyRate,
      approved: timeEntries.approved,
    })
    .from(timeEntries)
    .where(sql`${timeEntries.date} >= ${oneWeekAgo.toISOString().split('T')[0]}`)
    .limit(1000);

  const totalHoursThisWeek = weeklyTimeEntries.reduce((sum, entry) => sum + Number(entry.hours || 0), 0);
  const totalCostThisWeek = weeklyTimeEntries.reduce(
    (sum, entry) => sum + Number(entry.hours || 0) * Number(entry.hourlyRate || 0),
    0
  );
  const unapprovedEntries = weeklyTimeEntries.filter(e => !e.approved);
  const unapprovedValue = unapprovedEntries.reduce(
    (sum, entry) => sum + Number(entry.hours || 0) * Number(entry.hourlyRate || 0),
    0
  );

  // Active time-clock shifts
  const activeShiftsCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(timeClockShifts)
    .where(sql`${timeClockShifts.clockOutTime} IS NULL`);

  // Pending procurement
  const pendingProcurement = await db
    .select()
    .from(procurementItems)
    .where(eq(procurementItems.status, 'PENDING'))
    .limit(50);

  const urgentItems = pendingProcurement
    .filter(item => {
      if (!item.neededBy) return false;
      const daysUntilNeeded = Math.ceil((new Date(item.neededBy).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      return daysUntilNeeded <= 3 && daysUntilNeeded >= 0;
    })
    .map(item => ({
      project_code: item.projectCode,
      description: item.description,
      needed_by: item.neededBy,
      estimated_cost: Number(item.estimatedCost || 0),
    }));

  // Change orders pending approval
  const pendingChangeOrders = await db
    .select()
    .from(changeOrders)
    .where(sql`${changeOrders.status} IN ('PENDING_APPROVAL', 'SUBMITTED')`)
    .limit(50);

  const recentApprovedCOs = await db
    .select()
    .from(changeOrders)
    .where(eq(changeOrders.status, 'APPROVED'))
    .orderBy(desc(changeOrders.approvedAt))
    .limit(10);

  // Billing events
  const invoicedEvents = await db
    .select()
    .from(billingEvents)
    .where(sql`${billingEvents.eventType} = 'INVOICE_SENT' AND ${billingEvents.eventDate} >= ${startOfYear.toISOString().split('T')[0]}`)
    .limit(200);

  const paymentEvents = await db
    .select()
    .from(billingEvents)
    .where(sql`${billingEvents.eventType} = 'PAYMENT_RECEIVED' AND ${billingEvents.eventDate} >= ${startOfYear.toISOString().split('T')[0]}`)
    .limit(200);

  const totalInvoiced = invoicedEvents.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const totalReceived = paymentEvents.reduce((sum, e) => sum + Number(e.amount || 0), 0);

  // Find overdue invoices (invoices sent >30 days ago without matching payment)
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const overdueInvoices = invoicedEvents
    .filter(inv => new Date(inv.eventDate) < thirtyDaysAgo)
    .map(inv => ({
      project_code: inv.projectCode,
      reference: inv.reference,
      amount: Number(inv.amount || 0),
      days_overdue: Math.floor((now.getTime() - new Date(inv.eventDate).getTime()) / (1000 * 60 * 60 * 24)),
    }))
    .slice(0, 20);

  // Active bids
  const activeBids = await db
    .select()
    .from(bids)
    .where(sql`${bids.status} IN ('PENDING', 'SUBMITTED')`)
    .limit(50);

  const upcomingBidDeadlines = activeBids
    .filter(bid => bid.bidDeadline && new Date(bid.bidDeadline) > now)
    .sort((a, b) => new Date(a.bidDeadline!).getTime() - new Date(b.bidDeadline!).getTime())
    .slice(0, 10)
    .map(bid => ({
      client_name: bid.clientName,
      bid_amount: Number(bid.bidAmount || 0),
      bid_deadline: bid.bidDeadline,
      status: bid.status,
    }));

  // Crew statistics
  const allUsers = await db.select().from(users).limit(500);
  const superintendents = allUsers.filter(u => u.role === 'SUPERINTENDENT').length;
  const hourlyWorkers = allUsers.filter(u => u.role === 'HOURLY_EMPLOYEE').length;

  // Calculate overtime hours (>40 hours per week per employee)
  const employeeHours = new Map<string, number>();
  weeklyTimeEntries.forEach(entry => {
    const current = employeeHours.get(entry.hours?.toString() || '') || 0;
    employeeHours.set(entry.hours?.toString() || '', current + Number(entry.hours || 0));
  });
  const overtimeHours = Array.from(employeeHours.values()).reduce(
    (sum, hours) => sum + Math.max(0, hours - 40),
    0
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
        start_date: p.startDate,
        estimated_completion: p.estimatedCompletion,
        client_name: p.clientName,
        superintendent_id: p.superintendentId,
      })),
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
      pending_orders_value: pendingProcurement.reduce((sum, item) => sum + Number(item.estimatedCost || 0), 0),
      urgent_items: urgentItems,
    },
    change_orders: {
      pending_approval_count: pendingChangeOrders.length,
      pending_approval_value: pendingChangeOrders.reduce((sum, co) => sum + Number(co.amount || 0), 0),
      recent_approvals: recentApprovedCOs.map(co => ({
        project_code: co.projectCode,
        description: co.description,
        amount: Number(co.amount || 0),
        status: co.status,
      })),
    },
    billing: {
      total_invoiced_ytd: Math.round(totalInvoiced * 100) / 100,
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
    },
  };
}
