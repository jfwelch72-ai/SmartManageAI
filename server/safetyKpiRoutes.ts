import { Router, type Response, type NextFunction } from "express";
import { db } from "./db";
import { requireAuth, type AuthRequest } from "./auth";
import {
  oshaIncidents,
  safetyObservations,
  toolboxTalkScheduled,
  toolboxTalkAttendance,
  safetyChecklistInstances,
  safetyTrainingAssignments,
  ppeComplianceLogs,
  crmOrganisationCertifications,
  projects,
} from "@shared/schema";
import { and, eq, gte, lte, sql } from "drizzle-orm";

const router = Router();

function canViewSafety(role?: string): boolean {
  return ["SUPER_ADMIN", "ADMIN", "HUSTLER", "MANAGER", "SUPERINTENDENT", "ESTIMATOR", "FIELD_WORKER"].includes(role || "");
}

/**
 * Safety KPI dashboard
 * - TRIR: (Total recordable cases × 200,000) / hours worked
 * - DART: (Days away/restricted/transferred cases × 200,000) / hours worked
 * - Leading indicators: observations, toolbox talks, inspections, training compliance, PPE compliance
 * - Lagging indicators: recordables, days away, deaths
 *
 * Hours worked may be passed as ?hoursWorked= or defaulted from query.
 */
router.get("/api/safety/kpi/dashboard", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!canViewSafety(req.user!.role)) return res.status(403).json({ error: "Insufficient permissions" });
    const orgId = req.user!.organizationId!;

    const year = (req.query.year as string) || String(new Date().getFullYear());
    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;
    const startTs = new Date(startDate);
    const endTs = new Date(`${year}-12-31T23:59:59`);
    const hoursWorked = Number(req.query.hoursWorked) || 200000; // default 100 FTE

    // ─── Lagging: OSHA recordables ──────────────────────────────
    const incidents = await db.select().from(oshaIncidents).where(and(
      eq(oshaIncidents.organizationId, orgId),
      gte(oshaIncidents.dateOfInjury, startDate),
      lte(oshaIncidents.dateOfInjury, endDate),
    ));
    const recordable = incidents.filter(i => i.isRecordable);
    const totalRecordable = recordable.length;
    const dartCases = recordable.filter(i => i.classification === "DAYS_AWAY" || i.classification === "RESTRICTED").length;
    const deaths = recordable.filter(i => i.resultedInDeath).length;
    const totalDaysAway = recordable.reduce((s, r) => s + (r.daysAwayFromWork ?? 0), 0);
    const totalDaysRestricted = recordable.reduce((s, r) => s + (r.daysOfRestrictedDuty ?? 0), 0);

    const trir = hoursWorked > 0 ? (totalRecordable * 200000) / hoursWorked : 0;
    const dart = hoursWorked > 0 ? (dartCases * 200000) / hoursWorked : 0;
    const ltir = hoursWorked > 0 ? (recordable.filter(i => i.classification === "DAYS_AWAY").length * 200000) / hoursWorked : 0;

    // ─── Leading: Observations ──────────────────────────────────
    const obsRows = await db.select().from(safetyObservations).where(and(
      eq(safetyObservations.organizationId, orgId),
      gte(safetyObservations.observedAt, startTs),
      lte(safetyObservations.observedAt, endTs),
    ));
    const observations = {
      total: obsRows.length,
      positive: obsRows.filter(o => o.observationType === "POSITIVE").length,
      atRisk: obsRows.filter(o => o.observationType === "AT_RISK").length,
      open: obsRows.filter(o => o.status === "OPEN").length,
      closed: obsRows.filter(o => o.status === "CLOSED").length,
    };

    // ─── Leading: Toolbox talks ─────────────────────────────────
    const talks = await db.select({ id: toolboxTalkScheduled.id, status: toolboxTalkScheduled.status })
      .from(toolboxTalkScheduled)
      .where(and(
        eq(toolboxTalkScheduled.organizationId, orgId),
        gte(toolboxTalkScheduled.scheduledDate, startDate),
        lte(toolboxTalkScheduled.scheduledDate, endDate),
      ));
    const completedTalkIds = talks.filter(t => t.status === "COMPLETED").map(t => t.id);
    let totalAttendees = 0;
    if (completedTalkIds.length > 0) {
      const attRows = await db.select({ c: sql<number>`count(*)::int` }).from(toolboxTalkAttendance)
        .where(sql`${toolboxTalkAttendance.scheduledTalkId} = ANY(${completedTalkIds})`);
      totalAttendees = attRows[0]?.c ?? 0;
    }
    const toolboxTalks = {
      scheduled: talks.length,
      completed: completedTalkIds.length,
      attendees: totalAttendees,
    };

    // ─── Leading: Inspections ───────────────────────────────────
    const inspections = await db.select({
      status: safetyChecklistInstances.status,
    }).from(safetyChecklistInstances).where(and(
      eq(safetyChecklistInstances.organizationId, orgId),
      gte(safetyChecklistInstances.createdAt, startTs),
      lte(safetyChecklistInstances.createdAt, endTs),
    ));
    const inspectionStats = {
      total: inspections.length,
      passed: inspections.filter(i => i.status === "PASSED").length,
      failed: inspections.filter(i => i.status === "FAILED").length,
      inProgress: inspections.filter(i => i.status === "IN_PROGRESS").length,
    };

    // ─── Leading: Training compliance ───────────────────────────
    const assigns = await db.select({ status: safetyTrainingAssignments.status })
      .from(safetyTrainingAssignments)
      .where(eq(safetyTrainingAssignments.organizationId, orgId));
    const training = {
      total: assigns.length,
      completed: assigns.filter(a => a.status === "COMPLETED").length,
      pending: assigns.filter(a => a.status === "PENDING").length,
      overdue: assigns.filter(a => a.status === "OVERDUE").length,
      complianceRate: assigns.length ? assigns.filter(a => a.status === "COMPLETED").length / assigns.length : 0,
    };

    // ─── Leading: PPE compliance ────────────────────────────────
    const ppe = await db.select({ status: ppeComplianceLogs.complianceStatus })
      .from(ppeComplianceLogs)
      .innerJoin(projects, eq(projects.id, ppeComplianceLogs.projectId))
      .where(and(
        eq(projects.gcOrganizationId, orgId),
        gte(ppeComplianceLogs.checkDate, startDate),
        lte(ppeComplianceLogs.checkDate, endDate),
      ));
    const ppeStats = {
      total: ppe.length,
      compliant: ppe.filter(p => p.status === "COMPLIANT").length,
      violations: ppe.filter(p => p.status === "VIOLATION").length,
      complianceRate: ppe.length ? ppe.filter(p => p.status === "COMPLIANT").length / ppe.length : 0,
    };

    // ─── COIs / certifications expiring within 30 days vs expired ───
    // Mutually exclusive buckets:
    //   expired      : expirationDate <  today
    //   expiringSoon : today <= expirationDate <= today + 30
    const today = new Date().toISOString().slice(0, 10);
    const in30Date = new Date();
    in30Date.setDate(in30Date.getDate() + 30);
    const in30 = in30Date.toISOString().slice(0, 10);
    const expiringRows = await db.select({ id: crmOrganisationCertifications.id })
      .from(crmOrganisationCertifications)
      .where(and(
        eq(crmOrganisationCertifications.organizationId, orgId),
        gte(crmOrganisationCertifications.expirationDate, today),
        lte(crmOrganisationCertifications.expirationDate, in30),
      ));
    const expiredRows = await db.select({ id: crmOrganisationCertifications.id })
      .from(crmOrganisationCertifications)
      .where(and(
        eq(crmOrganisationCertifications.organizationId, orgId),
        sql`${crmOrganisationCertifications.expirationDate} < ${today}`,
      ));

    res.json({
      year,
      hoursWorked,
      lagging: {
        trir: Number(trir.toFixed(2)),
        dart: Number(dart.toFixed(2)),
        ltir: Number(ltir.toFixed(2)),
        totalRecordable,
        dartCases,
        deaths,
        totalDaysAway,
        totalDaysRestricted,
      },
      leading: {
        observations,
        toolboxTalks,
        inspections: inspectionStats,
        training,
        ppe: ppeStats,
      },
      certifications: {
        expiringSoon: expiringRows.length,
        expired: expiredRows.length,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
