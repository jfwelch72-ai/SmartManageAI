import { logError } from "./utils/logger";
import { Router, type Request, type Response } from "express";
import { db } from "./db";
import { projectDelays, projects, changeOrders, users, notifications, delayNotifications, insertProjectDelaySchema, insertDelayNotificationSchema, type ProjectDelay, delayClaims, dailyReportLocks, photoCustodyRecords, insertDelayClaimSchema, insertDailyReportLockSchema, insertPhotoCustodyRecordSchema, type DelayClaim, type DailyReportLock, type PhotoCustodyRecord } from "@shared/schema";
import { eq, desc, sql, and, inArray } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { logAudit, type DbTransaction } from "./auditLogger";
import { deliverNotifications, type NotificationRecord } from "./services/notificationDelivery";
import { sanitizeText, sanitizeShortText } from "./sanitization";
import { generateDelayNotificationPDF } from "./pdf-service";
import { getOrgIdForFilter } from "./orgFilter";
import crypto from "crypto";

const router = Router();

// ========================================
// Routes from delayRoutes.ts
// ========================================

interface WeatherEvidence {
  fetchedAt: string;
  location: { lat: number; lng: number };
  dailyData: Array<{
    date: string;
    tempHigh: number;
    tempLow: number;
    precipitation: number;
    windSpeed: number;
    conditions: string;
    alerts?: string[];
  }>;
}

async function fetchWeatherEvidence(lat: number, lng: number, startDate: Date, endDate?: Date | null): Promise<WeatherEvidence | null> {
  try {
    const formatDate = (d: Date) => d.toISOString().split("T")[0];
    const end = endDate || new Date();
    
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}&start_date=${formatDate(startDate)}&end_date=${formatDate(end)}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) {
      logError("Weather API error", { status: response.status });
      return null;
    }

    const data = await response.json();
    if (!data.daily || !data.daily.time) return null;

    const WEATHER_CODES: Record<number, string> = {
      0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
      45: "Foggy", 48: "Depositing rime fog", 51: "Light drizzle", 53: "Moderate drizzle",
      55: "Dense drizzle", 61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
      66: "Light freezing rain", 67: "Heavy freezing rain", 71: "Slight snow",
      73: "Moderate snow", 75: "Heavy snow", 80: "Slight rain showers",
      81: "Moderate rain showers", 82: "Violent rain showers", 95: "Thunderstorm",
      96: "Thunderstorm with hail", 99: "Thunderstorm with heavy hail",
    };

    const dailyData = data.daily.time.map((date: string, i: number) => ({
      date,
      tempHigh: data.daily.temperature_2m_max[i],
      tempLow: data.daily.temperature_2m_min[i],
      precipitation: data.daily.precipitation_sum[i] || 0,
      windSpeed: data.daily.wind_speed_10m_max[i] || 0,
      conditions: WEATHER_CODES[data.daily.weather_code[i]] || "Unknown",
    }));

    return {
      fetchedAt: new Date().toISOString(),
      location: { lat, lng },
      dailyData,
    };
  } catch (error) {
    logError("Failed to fetch weather evidence:", {}, error instanceof Error ? error : new Error(String(error)));
    return null;
  }
}

const DELAY_REASON_LABELS: Record<string, string> = {
  WEATHER: "Weather",
  GC_SCHEDULING: "GC Scheduling",
  OTHER_CONTRACTORS: "Other Contractors",
  MATERIAL_DELIVERY: "Material Delivery",
  PERMIT_ISSUES: "Permit Issues",
  INSPECTION_DELAY: "Inspection Delay",
  OWNER_DIRECTIVE: "Owner Directive",
  DESIGN_CHANGES: "Design Changes",
  SITE_CONDITIONS: "Site Conditions",
  LABOR_SHORTAGE: "Labor Shortage",
  OTHER: "Other"
};

const RESPONSIBILITY_LABELS: Record<string, string> = {
  OWNER: "Owner",
  GC: "General Contractor",
  SUBCONTRACTOR: "Subcontractor",
  TFR: "Contractor (Self)",
  FORCE_MAJEURE: "Force Majeure (Weather/Act of God)"
};

const VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["SUBMITTED"],
  SUBMITTED: ["DRAFT", "ACKNOWLEDGED"],
  ACKNOWLEDGED: ["RESOLVED"],
  RESOLVED: []
};

function isValidTransition(fromStatus: string, toStatus: string): boolean {
  return VALID_TRANSITIONS[fromStatus]?.includes(toStatus) || false;
}

async function getDelayById(id: string) {
  const [delay] = await db
    .select()
    .from(projectDelays)
    .where(eq(projectDelays.id, id))
    .limit(1);
  return delay;
}

async function generateDelayNumber(projectCode: string): Promise<string> {
  const [result] = await db
    .select({ count: sql<number>`count(*)` })
    .from(projectDelays)
    .innerJoin(projects, eq(projectDelays.projectId, projects.id))
    .where(eq(projects.code, projectCode));
  
  const count = result?.count || 0;
  return `DLY-${projectCode}-${String(count + 1).padStart(3, '0')}`;
}

async function notifyDelayStatusChange(
  delay: any,
  project: any,
  newStatus: string,
  message: string,
  tx?: DbTransaction
) {
  const dbClient = tx || db;
  const notificationsToCreate: any[] = [];

  if (newStatus === "SUBMITTED") {
    const managersAndAdmins = await dbClient
      .select()
      .from(users)
      .where(sql`${users.role} IN ('ADMIN', 'MANAGER')`);

    managersAndAdmins.forEach((user: any) => {
      notificationsToCreate.push({
        userId: user.id,
        type: "DELAY_SUBMITTED" as const,
        title: "Delay Report Submitted",
        message: `Delay ${delay.delayNumber} on project ${project.name}: ${message}`,
        relatedEntityId: delay.id,
        relatedEntityType: "projectDelay",
      });
    });

    if (project.superintendentId && !managersAndAdmins.some((u: any) => u.id === project.superintendentId)) {
      notificationsToCreate.push({
        userId: project.superintendentId,
        type: "DELAY_SUBMITTED" as const,
        title: "Delay Report Submitted",
        message: `Delay ${delay.delayNumber} on project ${project.name}: ${message}`,
        relatedEntityId: delay.id,
        relatedEntityType: "projectDelay",
      });
    }
  }

  if (newStatus === "ACKNOWLEDGED") {
    notificationsToCreate.push({
      userId: delay.createdById,
      type: "DELAY_ACKNOWLEDGED" as const,
      title: "Delay Acknowledged",
      message: `Delay ${delay.delayNumber} has been acknowledged`,
      relatedEntityId: delay.id,
      relatedEntityType: "projectDelay",
    });
  }

  if (delay.changeOrderRequired && !delay.linkedChangeOrderId) {
    const managersAndAdmins = await dbClient
      .select()
      .from(users)
      .where(sql`${users.role} IN ('ADMIN', 'MANAGER')`);

    managersAndAdmins.forEach((user: any) => {
      notificationsToCreate.push({
        userId: user.id,
        type: "DELAY_CHANGE_ORDER_NEEDED" as const,
        title: "Change Order Required for Delay",
        message: `Delay ${delay.delayNumber} on ${project.name} requires a change order`,
        relatedEntityId: delay.id,
        relatedEntityType: "projectDelay",
      });
    });
  }

  if (notificationsToCreate.length > 0) {
    const inserted = await dbClient.insert(notifications).values(notificationsToCreate).returning();
    const records: NotificationRecord[] = inserted.map(n => ({
      id: n.id,
      userId: n.userId,
      type: n.type as NotificationRecord["type"],
      title: n.title,
      message: n.message,
      relatedEntityId: n.relatedEntityId,
      relatedEntityType: n.relatedEntityType,
    }));
    setImmediate(() => {
      deliverNotifications(records).catch(() => undefined);
    });
  }
}

router.get("/projects/:projectId/delays", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.json([]);
    }

    const { projectId } = req.params;
    const { status, reason } = req.query;

    // Verify project exists and check org access
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }
    
    if (shouldFilter && orgId && project.gcOrganizationId !== orgId) {
      return res.json([]);
    }

    const conditions = [eq(projectDelays.projectId, projectId)];
    
    if (status && typeof status === 'string') {
      conditions.push(eq(projectDelays.status, status as any));
    }
    if (reason && typeof reason === 'string') {
      conditions.push(eq(projectDelays.reason, reason as any));
    }

    const delays = await db
      .select()
      .from(projectDelays)
      .where(and(...conditions))
      .orderBy(desc(projectDelays.createdAt));

    const enrichedDelays = delays.map(delay => ({
      ...delay,
      reasonLabel: DELAY_REASON_LABELS[delay.reason] || delay.reason,
      responsibilityLabel: RESPONSIBILITY_LABELS[delay.financiallyResponsible] || delay.financiallyResponsible
    }));

    res.json(enrichedDelays);
  } catch (error) {
    logError("Error fetching project delays:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch delays" });
  }
});

router.post("/projects/:projectId/delays", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
  try {
    const { projectId } = req.params;
    const userId = req.user!.id;

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const delayNumber = await generateDelayNumber(project.code);

    const sanitizedBody = {
      ...req.body,
      projectId,
      delayNumber,
      createdById: userId,
      reasonNotes: req.body.reasonNotes ? sanitizeText(req.body.reasonNotes) : null,
      proceedToWorkNotes: req.body.proceedToWorkNotes ? sanitizeText(req.body.proceedToWorkNotes) : null,
      ownerRepName: req.body.ownerRepName ? sanitizeShortText(req.body.ownerRepName) : null,
      gcRepName: req.body.gcRepName ? sanitizeShortText(req.body.gcRepName) : null,
      startDateTime: req.body.startDateTime ? new Date(req.body.startDateTime) : undefined,
      endDateTime: req.body.endDateTime ? new Date(req.body.endDateTime) : null,
      proceedToWorkDate: req.body.proceedToWorkDate ? new Date(req.body.proceedToWorkDate) : null,
    };

    const validationResult = insertProjectDelaySchema.safeParse(sanitizedBody);

    if (!validationResult.success) {
      res.status(400).json({ 
        error: "Validation failed", 
        details: validationResult.error.format() 
      });
      return;
    }

    // Prepare insert data with potential weather evidence
    let insertData = { ...validationResult.data };
    let weatherLat: number | null = null;
    let weatherLng: number | null = null;
    
    // Auto-fetch weather evidence for WEATHER delays if lat/lng provided
    if (validationResult.data.reason === "WEATHER") {
      const lat = req.body.locationLat ? parseFloat(req.body.locationLat) : null;
      const lng = req.body.locationLng ? parseFloat(req.body.locationLng) : null;
      
      if (lat && lng && !isNaN(lat) && !isNaN(lng)) {
        weatherLat = lat;
        weatherLng = lng;
        // Store location for later evidence fetching
        insertData = { 
          ...insertData, 
          locationLat: String(lat), 
          locationLng: String(lng) 
        };
      }
    }

    const [newDelay] = await db
      .insert(projectDelays)
      .values(insertData)
      .returning();
    
    // Fetch weather evidence async after creation for WEATHER delays
    if (validationResult.data.reason === "WEATHER" && weatherLat && weatherLng) {
      const startDate = new Date(validationResult.data.startDateTime);
      const endDate = validationResult.data.endDateTime ? new Date(validationResult.data.endDateTime) : new Date();
      const delayId = newDelay.id;
      const lat = weatherLat;
      const lng = weatherLng;
      
      fetchWeatherEvidence(lat, lng, startDate, endDate).then(async (evidence) => {
        if (evidence) {
          await db.update(projectDelays)
            .set({ weatherEvidenceJson: evidence })
            .where(eq(projectDelays.id, delayId));
        }
      }).catch(err => logError("Failed to fetch weather evidence:", {}, err instanceof Error ? err : new Error(String(err))));
    }

    await logAudit({
      userId,
      action: "CREATE",
      entityType: "projectDelay",
      entityId: newDelay.id,
      newValue: JSON.stringify({ delayNumber, reason: newDelay.reason, projectId }),
    }, req);

    let scheduleImpact = null;
    try {
      const { computeProjectDelayImpact } = await import("./cpmEngine");
      const delayStart = newDelay.startDateTime ? new Date(newDelay.startDateTime).toISOString().split("T")[0] : undefined;
      scheduleImpact = await computeProjectDelayImpact(projectId, newDelay.estimatedDuration || 0, delayStart);
    } catch (e) {
      logError("Schedule impact computation failed (non-blocking):", {}, e instanceof Error ? e : new Error(String(e)));
    }

    res.status(201).json({
      ...newDelay,
      reasonLabel: DELAY_REASON_LABELS[newDelay.reason] || newDelay.reason,
      responsibilityLabel: RESPONSIBILITY_LABELS[newDelay.financiallyResponsible] || newDelay.financiallyResponsible,
      scheduleImpact,
    });
  } catch (error) {
    logError("Error creating delay:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to create delay" });
  }
});

router.get("/delays/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const delay = await getDelayById(req.params.id);

    if (!delay) {
      res.status(404).json({ error: "Delay not found" });
      return;
    }

    let linkedChangeOrder = null;
    if (delay.linkedChangeOrderId) {
      [linkedChangeOrder] = await db
        .select()
        .from(changeOrders)
        .where(eq(changeOrders.id, delay.linkedChangeOrderId))
        .limit(1);
    }

    res.json({
      ...delay,
      reasonLabel: DELAY_REASON_LABELS[delay.reason] || delay.reason,
      responsibilityLabel: RESPONSIBILITY_LABELS[delay.financiallyResponsible] || delay.financiallyResponsible,
      linkedChangeOrder
    });
  } catch (error) {
    logError("Error fetching delay:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch delay" });
  }
});

router.patch("/delays/:id", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const delay = await getDelayById(req.params.id);

    if (!delay) {
      res.status(404).json({ error: "Delay not found" });
      return;
    }

    if (delay.status !== "DRAFT") {
      res.status(400).json({ error: "Can only edit delays in DRAFT status" });
      return;
    }

    const updateData: any = {
      updatedAt: new Date()
    };

    if (req.body.reason !== undefined) updateData.reason = req.body.reason;
    if (req.body.reasonNotes !== undefined) updateData.reasonNotes = sanitizeText(req.body.reasonNotes);
    if (req.body.startDateTime !== undefined) updateData.startDateTime = new Date(req.body.startDateTime);
    if (req.body.endDateTime !== undefined) updateData.endDateTime = req.body.endDateTime ? new Date(req.body.endDateTime) : null;
    if (req.body.estimatedDuration !== undefined) updateData.estimatedDuration = req.body.estimatedDuration;
    if (req.body.ownerRepContactId !== undefined) updateData.ownerRepContactId = req.body.ownerRepContactId;
    if (req.body.gcRepContactId !== undefined) updateData.gcRepContactId = req.body.gcRepContactId;
    if (req.body.ownerRepName !== undefined) updateData.ownerRepName = sanitizeShortText(req.body.ownerRepName);
    if (req.body.gcRepName !== undefined) updateData.gcRepName = sanitizeShortText(req.body.gcRepName);
    if (req.body.financiallyResponsible !== undefined) updateData.financiallyResponsible = req.body.financiallyResponsible;
    if (req.body.changeOrderRequired !== undefined) updateData.changeOrderRequired = req.body.changeOrderRequired;
    if (req.body.proceedToWorkDate !== undefined) updateData.proceedToWorkDate = req.body.proceedToWorkDate ? new Date(req.body.proceedToWorkDate) : null;
    if (req.body.proceedToWorkNotes !== undefined) updateData.proceedToWorkNotes = sanitizeText(req.body.proceedToWorkNotes);
    if (req.body.proofFileId !== undefined) updateData.proofFileId = req.body.proofFileId;
    if (req.body.proofFileName !== undefined) updateData.proofFileName = req.body.proofFileName;
    if (req.body.proofFileUrl !== undefined) updateData.proofFileUrl = req.body.proofFileUrl;
    if (req.body.proceedToWorkFileUrl !== undefined) updateData.proceedToWorkFileUrl = req.body.proceedToWorkFileUrl;

    const [updatedDelay] = await db
      .update(projectDelays)
      .set(updateData)
      .where(eq(projectDelays.id, req.params.id))
      .returning();

    await logAudit({
      userId,
      action: "UPDATE",
      entityType: "projectDelay",
      entityId: updatedDelay.id,
      newValue: JSON.stringify({ changes: Object.keys(updateData) }),
    }, req);

    let scheduleImpact = null;
    try {
      const { computeProjectDelayImpact } = await import("./cpmEngine");
      const delayStart = updatedDelay.startDateTime ? new Date(updatedDelay.startDateTime).toISOString().split("T")[0] : undefined;
      scheduleImpact = await computeProjectDelayImpact(updatedDelay.projectId, updatedDelay.estimatedDuration || 0, delayStart);
    } catch (e) {
      logError("Schedule impact computation failed (non-blocking):", {}, e instanceof Error ? e : new Error(String(e)));
    }

    res.json({
      ...updatedDelay,
      reasonLabel: DELAY_REASON_LABELS[updatedDelay.reason] || updatedDelay.reason,
      responsibilityLabel: RESPONSIBILITY_LABELS[updatedDelay.financiallyResponsible] || updatedDelay.financiallyResponsible,
      scheduleImpact,
    });
  } catch (error) {
    logError("Error updating delay:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to update delay" });
  }
});

router.post("/delays/:id/submit", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const delay = await getDelayById(req.params.id);

    if (!delay) {
      res.status(404).json({ error: "Delay not found" });
      return;
    }

    if (!isValidTransition(delay.status, "SUBMITTED")) {
      res.status(400).json({ 
        error: `Cannot submit delay from ${delay.status} status` 
      });
      return;
    }

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, delay.projectId))
      .limit(1);

    const now = new Date();
    const [updatedDelay] = await db
      .update(projectDelays)
      .set({
        status: "SUBMITTED",
        submittedAt: now,
        updatedAt: now
      })
      .where(eq(projectDelays.id, req.params.id))
      .returning();

    await notifyDelayStatusChange(
      updatedDelay,
      project,
      "SUBMITTED",
      `${DELAY_REASON_LABELS[updatedDelay.reason]} - ${updatedDelay.reasonNotes || 'No details'}`
    );

    await logAudit({
      userId,
      action: "SUBMIT",
      entityType: "projectDelay",
      entityId: updatedDelay.id,
      oldValue: JSON.stringify({ status: delay.status }),
      newValue: JSON.stringify({ status: "SUBMITTED" }),
    }, req);

    res.json({
      ...updatedDelay,
      reasonLabel: DELAY_REASON_LABELS[updatedDelay.reason] || updatedDelay.reason,
      responsibilityLabel: RESPONSIBILITY_LABELS[updatedDelay.financiallyResponsible] || updatedDelay.financiallyResponsible
    });
  } catch (error) {
    logError("Error submitting delay:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to submit delay" });
  }
});

router.post("/delays/:id/acknowledge", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const delay = await getDelayById(req.params.id);

    if (!delay) {
      res.status(404).json({ error: "Delay not found" });
      return;
    }

    if (!isValidTransition(delay.status, "ACKNOWLEDGED")) {
      res.status(400).json({ 
        error: `Cannot acknowledge delay from ${delay.status} status` 
      });
      return;
    }

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, delay.projectId))
      .limit(1);

    const now = new Date();
    const [updatedDelay] = await db
      .update(projectDelays)
      .set({
        status: "ACKNOWLEDGED",
        acknowledgedById: userId,
        acknowledgedAt: now,
        updatedAt: now
      })
      .where(eq(projectDelays.id, req.params.id))
      .returning();

    await notifyDelayStatusChange(
      updatedDelay,
      project,
      "ACKNOWLEDGED",
      "Delay has been acknowledged by management"
    );

    await logAudit({
      userId,
      action: "APPROVE",
      entityType: "projectDelay",
      entityId: updatedDelay.id,
      oldValue: JSON.stringify({ status: delay.status }),
      newValue: JSON.stringify({ status: "ACKNOWLEDGED" }),
    }, req);

    res.json({
      ...updatedDelay,
      reasonLabel: DELAY_REASON_LABELS[updatedDelay.reason] || updatedDelay.reason,
      responsibilityLabel: RESPONSIBILITY_LABELS[updatedDelay.financiallyResponsible] || updatedDelay.financiallyResponsible
    });
  } catch (error) {
    logError("Error acknowledging delay:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to acknowledge delay" });
  }
});

router.post("/delays/:id/resolve", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const delay = await getDelayById(req.params.id);

    if (!delay) {
      res.status(404).json({ error: "Delay not found" });
      return;
    }

    if (!isValidTransition(delay.status, "RESOLVED")) {
      res.status(400).json({ 
        error: `Cannot resolve delay from ${delay.status} status. Must be acknowledged first.` 
      });
      return;
    }

    const now = new Date();
    const updateData: any = {
      status: "RESOLVED",
      resolvedAt: now,
      updatedAt: now
    };

    if (!delay.endDateTime) {
      updateData.endDateTime = now;
    }

    if (req.body.proceedToWorkDate) {
      updateData.proceedToWorkDate = new Date(req.body.proceedToWorkDate);
    }
    if (req.body.proceedToWorkNotes) {
      updateData.proceedToWorkNotes = sanitizeText(req.body.proceedToWorkNotes);
    }
    if (req.body.proceedToWorkFileUrl) {
      updateData.proceedToWorkFileUrl = req.body.proceedToWorkFileUrl;
    }

    const [updatedDelay] = await db
      .update(projectDelays)
      .set(updateData)
      .where(eq(projectDelays.id, req.params.id))
      .returning();

    await logAudit({
      userId,
      action: "UPDATE",
      entityType: "projectDelay",
      entityId: updatedDelay.id,
      oldValue: JSON.stringify({ status: delay.status }),
      newValue: JSON.stringify({ status: "RESOLVED" }),
    }, req);

    res.json({
      ...updatedDelay,
      reasonLabel: DELAY_REASON_LABELS[updatedDelay.reason] || updatedDelay.reason,
      responsibilityLabel: RESPONSIBILITY_LABELS[updatedDelay.financiallyResponsible] || updatedDelay.financiallyResponsible
    });
  } catch (error) {
    logError("Error resolving delay:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to resolve delay" });
  }
});

router.post("/delays/:id/create-change-order", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const delay = await getDelayById(req.params.id);

    if (!delay) {
      res.status(404).json({ error: "Delay not found" });
      return;
    }

    if (delay.linkedChangeOrderId) {
      res.status(400).json({ error: "A change order is already linked to this delay" });
      return;
    }

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, delay.projectId))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(changeOrders)
      .where(eq(changeOrders.projectId, delay.projectId));
    
    const count = countResult?.count || 0;
    const changeOrderNumber = `CO-${project.code}-${String(count + 1).padStart(3, '0')}`;

    let impactAnalysis = null;
    try {
      const { computeProjectDelayImpact } = await import("./cpmEngine");
      const delayStart = delay.startDateTime ? new Date(delay.startDateTime).toISOString().split("T")[0] : undefined;
      impactAnalysis = await computeProjectDelayImpact(delay.projectId, delay.estimatedDuration || 0, delayStart);
    } catch (e) {
      logError("Schedule impact computation failed (non-blocking):", {}, e instanceof Error ? e : new Error(String(e)));
    }

    const startDate = new Date(delay.startDateTime).toLocaleDateString();
    const endDate = delay.endDateTime ? new Date(delay.endDateTime).toLocaleDateString() : 'Ongoing';
    const impactSuffix = impactAnalysis
      ? `\nSchedule Impact: ${impactAnalysis.impactDays} day(s), Critical Path Affected: ${impactAnalysis.criticalPathAffected ? 'Yes' : 'No'}`
      : '';
    const description = `Delay: ${DELAY_REASON_LABELS[delay.reason]}\n` +
      `Period: ${startDate} - ${endDate}\n` +
      `Financially Responsible: ${RESPONSIBILITY_LABELS[delay.financiallyResponsible]}\n` +
      `Details: ${delay.reasonNotes || 'N/A'}${impactSuffix}\n\n` +
      `Created from Delay Record: ${delay.delayNumber}`;

    const [newChangeOrder] = await db
      .insert(changeOrders)
      .values({
        projectId: delay.projectId,
        changeOrderNumber,
        description,
        amount: req.body.estimatedAmount || "0",
        status: "DRAFT",
        requestedById: userId
      })
      .returning();

    await db
      .update(projectDelays)
      .set({
        linkedChangeOrderId: newChangeOrder.id,
        updatedAt: new Date()
      })
      .where(eq(projectDelays.id, delay.id));

    await logAudit({
      userId,
      action: "CREATE",
      entityType: "changeOrder",
      entityId: newChangeOrder.id,
      newValue: JSON.stringify({ 
        fromDelay: delay.id, 
        delayNumber: delay.delayNumber,
        changeOrderNumber 
      }),
    }, req);

    res.status(201).json(newChangeOrder);
  } catch (error) {
    logError("Error creating change order from delay:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to create change order" });
  }
});

router.post("/delays/:id/revert-to-draft", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const delay = await getDelayById(req.params.id);

    if (!delay) {
      res.status(404).json({ error: "Delay not found" });
      return;
    }

    if (!isValidTransition(delay.status, "DRAFT")) {
      res.status(400).json({ 
        error: `Cannot revert delay from ${delay.status} status` 
      });
      return;
    }

    const [updatedDelay] = await db
      .update(projectDelays)
      .set({
        status: "DRAFT",
        submittedAt: null,
        updatedAt: new Date()
      })
      .where(eq(projectDelays.id, req.params.id))
      .returning();

    await logAudit({
      userId,
      action: "UPDATE",
      entityType: "projectDelay",
      entityId: updatedDelay.id,
      oldValue: JSON.stringify({ status: delay.status }),
      newValue: JSON.stringify({ status: "DRAFT", action: "revert" }),
    }, req);

    res.json({
      ...updatedDelay,
      reasonLabel: DELAY_REASON_LABELS[updatedDelay.reason] || updatedDelay.reason,
      responsibilityLabel: RESPONSIBILITY_LABELS[updatedDelay.financiallyResponsible] || updatedDelay.financiallyResponsible
    });
  } catch (error) {
    logError("Error reverting delay to draft:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to revert delay" });
  }
});

router.get("/delays/dashboard/summary", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const activeDelays = await db
      .select({
        id: projectDelays.id,
        delayNumber: projectDelays.delayNumber,
        reason: projectDelays.reason,
        status: projectDelays.status,
        startDateTime: projectDelays.startDateTime,
        changeOrderRequired: projectDelays.changeOrderRequired,
        linkedChangeOrderId: projectDelays.linkedChangeOrderId,
        projectId: projectDelays.projectId,
        projectName: projects.name,
        projectCode: projects.code
      })
      .from(projectDelays)
      .innerJoin(projects, eq(projectDelays.projectId, projects.id))
      .where(sql`${projectDelays.status} != 'RESOLVED'`)
      .orderBy(desc(projectDelays.createdAt))
      .limit(10);

    const pendingAcknowledgment = activeDelays.filter(d => d.status === "SUBMITTED");
    const needsChangeOrder = activeDelays.filter(d => d.changeOrderRequired && !d.linkedChangeOrderId);

    const [totalActiveResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(projectDelays)
      .where(sql`${projectDelays.status} != 'RESOLVED'`);

    res.json({
      totalActive: totalActiveResult?.count || 0,
      pendingAcknowledgment: pendingAcknowledgment.length,
      needsChangeOrder: needsChangeOrder.length,
      recentDelays: activeDelays.map(d => ({
        ...d,
        reasonLabel: DELAY_REASON_LABELS[d.reason] || d.reason
      }))
    });
  } catch (error) {
    logError("Error fetching delay dashboard summary:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch delay summary" });
  }
});

// ==================== DELAY NOTIFICATION ROUTES ====================

function generateNotificationEmailContent(
  delay: any,
  project: any,
  recipientType: "OWNER_REP" | "GC_REP" | "OTHER"
): { subject: string; body: string } {
  const reasonLabel = DELAY_REASON_LABELS[delay.reason] || delay.reason;
  const responsibilityLabel = RESPONSIBILITY_LABELS[delay.financiallyResponsible] || delay.financiallyResponsible;
  const startDate = new Date(delay.startDateTime).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  const endDate = delay.endDateTime 
    ? new Date(delay.endDateTime).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    : null;

  const subject = `Project Delay Notification - ${project.name} (${delay.delayNumber})`;

  const recipientRole = recipientType === "OWNER_REP" ? "Owner's Representative" 
    : recipientType === "GC_REP" ? "General Contractor" 
    : "Responsible Party";

  let body = `Dear ${recipientRole},

This letter serves as formal notification of a project delay affecting the ${project.name} project (Project Code: ${project.code}).

DELAY SUMMARY:
Reference Number: ${delay.delayNumber}
Reason for Delay: ${reasonLabel}
Start Date: ${startDate}${endDate ? `\nEnd Date: ${endDate}` : '\nStatus: Ongoing'}
Financially Responsible Party: ${responsibilityLabel}${delay.changeOrderRequired ? '\n\nIMPORTANT: This delay will require a Change Order for associated costs.' : ''}

${delay.reasonNotes ? `DETAILS:\n${delay.reasonNotes}\n` : ''}
PROJECT INFORMATION:
Project Name: ${project.name}
Project Code: ${project.code}
Location: ${[project.locationAddress, project.city, project.state].filter(Boolean).join(', ') || 'N/A'}
Client: ${project.clientName}

We are documenting this delay in accordance with contract requirements and industry best practices. This notification is intended to preserve all parties' rights and to maintain clear communication regarding project timeline impacts.

Please acknowledge receipt of this notification at your earliest convenience. Should you have any questions or require additional information regarding this delay, please do not hesitate to contact our office.

We appreciate your understanding and cooperation in addressing this matter. We remain committed to minimizing the impact of this delay and completing the project to the highest standards.`;

  return { subject, body };
}

router.post("/delays/:id/notifications/generate", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const { recipientType, recipientName, recipientCompany, recipientEmail } = req.body;

    if (!recipientType || !["OWNER_REP", "GC_REP", "OTHER"].includes(recipientType)) {
      res.status(400).json({ error: "Invalid recipient type" });
      return;
    }

    if (!recipientName || typeof recipientName !== "string" || recipientName.trim().length === 0) {
      res.status(400).json({ error: "Recipient name is required" });
      return;
    }

    const delay = await getDelayById(id);
    if (!delay) {
      res.status(404).json({ error: "Delay not found" });
      return;
    }

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, delay.projectId))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const { subject, body } = generateNotificationEmailContent(delay, project, recipientType);
    
    const sanitizedRecipientName = sanitizeShortText(recipientName);
    if (!sanitizedRecipientName) {
      res.status(400).json({ error: "Recipient name is required" });
      return;
    }

    const [notification] = await db
      .insert(delayNotifications)
      .values({
        delayId: id as string,
        recipientType: recipientType as "OWNER_REP" | "GC_REP" | "OTHER",
        recipientName: sanitizedRecipientName,
        recipientCompany: recipientCompany ? sanitizeShortText(recipientCompany) : null,
        recipientEmail: recipientEmail ? sanitizeShortText(recipientEmail) : null,
        subject,
        body,
        status: "DRAFT" as const,
        createdById: userId,
      })
      .returning();

    await logAudit({
      userId,
      action: "CREATE",
      entityType: "delayNotification",
      entityId: notification.id,
      newValue: JSON.stringify({ delayId: id, recipientType, recipientName }),
    }, req);

    res.status(201).json(notification);
  } catch (error) {
    logError("Error generating delay notification:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to generate notification" });
  }
});

router.get("/delays/:id/notifications", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const delay = await getDelayById(id);
    if (!delay) {
      res.status(404).json({ error: "Delay not found" });
      return;
    }

    const notificationsList = await db
      .select()
      .from(delayNotifications)
      .where(eq(delayNotifications.delayId, id))
      .orderBy(desc(delayNotifications.createdAt));

    res.json(notificationsList);
  } catch (error) {
    logError("Error fetching delay notifications:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

router.get("/delays/:delayId/notifications/:notificationId", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { delayId, notificationId } = req.params;

    const [notification] = await db
      .select()
      .from(delayNotifications)
      .where(and(
        eq(delayNotifications.id, notificationId),
        eq(delayNotifications.delayId, delayId)
      ))
      .limit(1);

    if (!notification) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }

    res.json(notification);
  } catch (error) {
    logError("Error fetching notification:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch notification" });
  }
});

router.patch("/delays/:delayId/notifications/:notificationId", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
  try {
    const { delayId, notificationId } = req.params;
    const userId = req.user!.id;

    const [notification] = await db
      .select()
      .from(delayNotifications)
      .where(and(
        eq(delayNotifications.id, notificationId),
        eq(delayNotifications.delayId, delayId)
      ))
      .limit(1);

    if (!notification) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }

    if (notification.status === "FINALIZED") {
      res.status(400).json({ error: "Cannot edit a finalized notification" });
      return;
    }

    const updateData: any = {
      updatedAt: new Date(),
    };

    if (req.body.recipientName) {
      updateData.recipientName = sanitizeShortText(req.body.recipientName);
    }
    if (req.body.recipientCompany !== undefined) {
      updateData.recipientCompany = req.body.recipientCompany ? sanitizeShortText(req.body.recipientCompany) : null;
    }
    if (req.body.recipientEmail !== undefined) {
      updateData.recipientEmail = req.body.recipientEmail ? sanitizeShortText(req.body.recipientEmail) : null;
    }
    if (req.body.subject) {
      updateData.subject = sanitizeShortText(req.body.subject);
    }
    if (req.body.body) {
      updateData.body = sanitizeText(req.body.body);
    }
    if (req.body.status === "FINALIZED") {
      updateData.status = "FINALIZED";
    }

    const [updated] = await db
      .update(delayNotifications)
      .set(updateData)
      .where(eq(delayNotifications.id, notificationId))
      .returning();

    await logAudit({
      userId,
      action: "UPDATE",
      entityType: "delayNotification",
      entityId: notificationId,
      oldValue: JSON.stringify({ subject: notification.subject }),
      newValue: JSON.stringify(updateData),
    }, req);

    res.json(updated);
  } catch (error) {
    logError("Error updating notification:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to update notification" });
  }
});

router.get("/delays/:delayId/notifications/:notificationId/pdf", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { delayId, notificationId } = req.params;

    const [notification] = await db
      .select()
      .from(delayNotifications)
      .where(and(
        eq(delayNotifications.id, notificationId),
        eq(delayNotifications.delayId, delayId)
      ))
      .limit(1);

    if (!notification) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }

    const delay = await getDelayById(delayId);
    if (!delay) {
      res.status(404).json({ error: "Delay not found" });
      return;
    }

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, delay.projectId))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const [createdByUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, notification.createdById))
      .limit(1);

    const pdfData = {
      notification: {
        subject: notification.subject,
        body: notification.body,
        recipientName: notification.recipientName,
        recipientCompany: notification.recipientCompany,
        recipientEmail: notification.recipientEmail,
        recipientType: notification.recipientType,
        createdAt: notification.createdAt,
      },
      delay: {
        delayNumber: delay.delayNumber,
        reason: delay.reason,
        reasonLabel: DELAY_REASON_LABELS[delay.reason] || delay.reason,
        reasonNotes: delay.reasonNotes,
        startDateTime: delay.startDateTime,
        endDateTime: delay.endDateTime,
        financiallyResponsible: delay.financiallyResponsible,
        responsibilityLabel: RESPONSIBILITY_LABELS[delay.financiallyResponsible] || delay.financiallyResponsible,
        changeOrderRequired: delay.changeOrderRequired,
        status: delay.status,
      },
      project: {
        name: project.name,
        code: project.code,
        clientName: project.clientName,
        locationAddress: project.locationAddress,
        city: project.city,
        state: project.state,
      },
      createdBy: {
        firstName: createdByUser?.firstName || "System",
        lastName: createdByUser?.lastName || "User",
        email: createdByUser?.email || null,
        phone: createdByUser?.phone || null,
      },
    };

    const pdfStream = generateDelayNotificationPDF(pdfData);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Delay-Notification-${delay.delayNumber}.pdf"`);

    pdfStream.pipe(res);
  } catch (error) {
    logError("Error generating notification PDF:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to generate PDF" });
  }
});

router.delete("/delays/:delayId/notifications/:notificationId", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { delayId, notificationId } = req.params;
    const userId = req.user!.id;

    const [notification] = await db
      .select()
      .from(delayNotifications)
      .where(and(
        eq(delayNotifications.id, notificationId),
        eq(delayNotifications.delayId, delayId)
      ))
      .limit(1);

    if (!notification) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }

    await db
      .delete(delayNotifications)
      .where(eq(delayNotifications.id, notificationId));

    await logAudit({
      userId,
      action: "DELETE",
      entityType: "delayNotification",
      entityId: notificationId,
      oldValue: JSON.stringify({ subject: notification.subject }),
    }, req);

    res.json({ success: true });
  } catch (error) {
    logError("Error deleting notification:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to delete notification" });
  }
});

router.post("/delays/:id/fetch-weather-evidence", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { lat, lng } = req.body;

    if (!lat || !lng) {
      res.status(400).json({ error: "Latitude and longitude are required" });
      return;
    }

    const delay = await getDelayById(id);
    if (!delay) {
      res.status(404).json({ error: "Delay not found" });
      return;
    }

    if (delay.reason !== "WEATHER") {
      res.status(400).json({ error: "Weather evidence can only be fetched for WEATHER type delays" });
      return;
    }

    const weatherEvidence = await fetchWeatherEvidence(
      parseFloat(lat),
      parseFloat(lng),
      new Date(delay.startDateTime),
      delay.endDateTime ? new Date(delay.endDateTime) : null
    );

    if (!weatherEvidence) {
      res.status(502).json({ error: "Failed to fetch weather data from external service" });
      return;
    }

    const [updatedDelay] = await db
      .update(projectDelays)
      .set({
        weatherEvidenceJson: weatherEvidence,
        locationLat: String(lat),
        locationLng: String(lng),
        updatedAt: new Date(),
      })
      .where(eq(projectDelays.id, id))
      .returning();

    await logAudit({
      userId: req.user!.id,
      action: "UPDATE",
      entityType: "projectDelay",
      entityId: id,
      newValue: JSON.stringify({ action: "fetch_weather_evidence", location: { lat, lng } }),
    }, req);

    res.json({
      ...updatedDelay,
      reasonLabel: DELAY_REASON_LABELS[updatedDelay.reason] || updatedDelay.reason,
      responsibilityLabel: RESPONSIBILITY_LABELS[updatedDelay.financiallyResponsible] || updatedDelay.financiallyResponsible,
    });
  } catch (error) {
    logError("Error fetching weather evidence:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch weather evidence" });
  }
});

// ========================================
// Routes from delayClaimsRoutes.ts
// ========================================

const CLAIM_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under Review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CLOSED: "Closed"
};

const CLAIM_TYPE_LABELS: Record<string, string> = {
  TIME_EXTENSION: "Time Extension",
  COST_IMPACT: "Cost Impact",
  BOTH: "Time Extension + Cost Impact"
};

const VALID_CLAIM_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["SUBMITTED"],
  SUBMITTED: ["DRAFT", "UNDER_REVIEW"],
  UNDER_REVIEW: ["APPROVED", "REJECTED"],
  APPROVED: ["CLOSED"],
  REJECTED: ["DRAFT", "CLOSED"],
  CLOSED: []
};

function isValidClaimTransition(fromStatus: string, toStatus: string): boolean {
  return VALID_CLAIM_TRANSITIONS[fromStatus]?.includes(toStatus) || false;
}

async function generateClaimNumber(projectCode: string): Promise<string> {
  const [result] = await db
    .select({ count: sql<number>`count(*)` })
    .from(delayClaims)
    .innerJoin(projects, eq(delayClaims.projectId, projects.id))
    .where(eq(projects.code, projectCode));
  
  const claimCount = Number(result?.count || 0) + 1;
  return `CLM-${projectCode}-${String(claimCount).padStart(3, "0")}`;
}

// ============================================================================
// DELAY CLAIMS ROUTES
// ============================================================================

// GET /api/delay-claims - List all delay claims for organization
router.get("/delay-claims", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }
    const projectId = req.query.projectId as string | undefined;
    const status = req.query.status as string | undefined;
    
    let query = db
      .select({
        claim: delayClaims,
        project: {
          id: projects.id,
          name: projects.name,
          code: projects.code,
        },
      })
      .from(delayClaims)
      .innerJoin(projects, eq(delayClaims.projectId, projects.id))
      .where(eq(delayClaims.organizationId, orgId!))
      .orderBy(desc(delayClaims.createdAt));
    
    const claims = await query;
    
    let filtered = claims;
    if (projectId) {
      filtered = filtered.filter(c => c.claim.projectId === projectId);
    }
    if (status) {
      filtered = filtered.filter(c => c.claim.status === status);
    }
    
    res.json(filtered.map(({ claim, project }) => ({
      ...claim,
      project,
      statusLabel: CLAIM_STATUS_LABELS[claim.status] || claim.status,
      claimTypeLabel: CLAIM_TYPE_LABELS[claim.claimType] || claim.claimType,
    })));
  } catch (error) {
    logError("Error fetching delay claims:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch delay claims" });
  }
});

// ============================================================================
// DAILY REPORT LOCKS ROUTES (defined before parameterized routes)
// ============================================================================

// GET /api/delay-claims/locks - List locks for a project
router.get("/delay-claims/locks", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }
    const projectId = req.query.projectId as string | undefined;
    
    let conditions = [eq(dailyReportLocks.organizationId, orgId!)];
    if (projectId) {
      conditions.push(eq(dailyReportLocks.projectId, projectId));
    }
    
    const locks = await db
      .select({
        lock: dailyReportLocks,
        project: {
          id: projects.id,
          name: projects.name,
          code: projects.code,
        },
      })
      .from(dailyReportLocks)
      .innerJoin(projects, eq(dailyReportLocks.projectId, projects.id))
      .where(and(...conditions))
      .orderBy(desc(dailyReportLocks.reportDate));
    
    res.json(locks.map(({ lock, project }) => ({
      ...lock,
      project,
    })));
  } catch (error) {
    logError("Error fetching daily report locks:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch daily report locks" });
  }
});

// POST /api/delay-claims/locks - Lock a daily report
router.post("/delay-claims/locks", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }
    const userId = req.user!.id;
    const { projectId, reportDate, lockReason, contentHash } = req.body;
    
    if (!projectId || !reportDate) {
      return res.status(400).json({ error: "Project ID and report date are required" });
    }
    
    // Check for existing lock
    const [existing] = await db
      .select()
      .from(dailyReportLocks)
      .where(and(
        eq(dailyReportLocks.projectId, projectId),
        eq(dailyReportLocks.reportDate, reportDate)
      ))
      .limit(1);
    
    if (existing && existing.status !== "UNLOCKED") {
      return res.status(400).json({ error: "Report is already locked" });
    }
    
    let lock;
    if (existing) {
      [lock] = await db
        .update(dailyReportLocks)
        .set({
          status: "LOCKED",
          lockedAt: new Date(),
          lockedById: userId,
          lockReason: sanitizeText(lockReason),
          contentHash,
          updatedAt: new Date(),
        })
        .where(eq(dailyReportLocks.id, existing.id))
        .returning();
    } else {
      [lock] = await db
        .insert(dailyReportLocks)
        .values({
          organizationId: orgId,
          projectId,
          reportDate,
          status: "LOCKED",
          lockedAt: new Date(),
          lockedById: userId,
          lockReason: sanitizeText(lockReason),
          contentHash,
        })
        .returning();
    }
    
    await logAudit({
      userId,
      action: "CREATE",
      entityType: "daily_report_lock",
      entityId: lock.id,
      newValue: JSON.stringify(lock),
    }, req);
    
    res.status(201).json(lock);
  } catch (error) {
    logError("Error locking daily report:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to lock daily report" });
  }
});

// GET /api/delay-claims/locks/:projectId/:date - Get lock status for specific date
router.get("/delay-claims/locks/:projectId/:date", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }
    const { projectId, date } = req.params;
    
    const [lock] = await db
      .select()
      .from(dailyReportLocks)
      .where(and(
        eq(dailyReportLocks.organizationId, orgId!),
        eq(dailyReportLocks.projectId, projectId),
        eq(dailyReportLocks.reportDate, date)
      ))
      .limit(1);
    
    res.json(lock || { status: "UNLOCKED", projectId, reportDate: date });
  } catch (error) {
    logError("Error fetching lock status:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch lock status" });
  }
});

// POST /api/delay-claims/locks/:id/supervisor-lock - Supervisor-level lock
router.post("/delay-claims/locks/:id/supervisor-lock", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }
    const userId = req.user!.id;
    const { id } = req.params;
    const { supervisorLockNotes } = req.body;
    
    const [existing] = await db
      .select()
      .from(dailyReportLocks)
      .where(and(eq(dailyReportLocks.id, id), eq(dailyReportLocks.organizationId, orgId!)))
      .limit(1);
    
    if (!existing) {
      return res.status(404).json({ error: "Lock record not found" });
    }
    
    const [updated] = await db
      .update(dailyReportLocks)
      .set({
        status: "SUPERVISOR_LOCKED",
        supervisorLockedAt: new Date(),
        supervisorLockedById: userId,
        supervisorLockNotes: sanitizeText(supervisorLockNotes),
        updatedAt: new Date(),
      })
      .where(eq(dailyReportLocks.id, id))
      .returning();
    
    res.json(updated);
  } catch (error) {
    logError("Error applying supervisor lock:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to apply supervisor lock" });
  }
});

// POST /api/delay-claims/locks/:id/unlock - Unlock a locked report
router.post("/delay-claims/locks/:id/unlock", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }
    const userId = req.user!.id;
    const { id } = req.params;
    const { unlockReason } = req.body;
    
    const [existing] = await db
      .select()
      .from(dailyReportLocks)
      .where(and(eq(dailyReportLocks.id, id), eq(dailyReportLocks.organizationId, orgId!)))
      .limit(1);
    
    if (!existing) {
      return res.status(404).json({ error: "Lock record not found" });
    }
    
    if (existing.status === "SUPERVISOR_LOCKED") {
      return res.status(400).json({ error: "Supervisor locked reports cannot be unlocked" });
    }
    
    if (existing.status === "UNLOCKED") {
      return res.status(400).json({ error: "Report is already unlocked" });
    }
    
    const [updated] = await db
      .update(dailyReportLocks)
      .set({
        status: "UNLOCKED",
        updatedAt: new Date(),
      })
      .where(eq(dailyReportLocks.id, id))
      .returning();
    
    await logAudit({
      userId,
      action: "UPDATE",
      entityType: "daily_report_lock",
      entityId: id,
      oldValue: JSON.stringify({ status: existing.status }),
      newValue: JSON.stringify({ status: "UNLOCKED", unlockReason }),
    }, req);
    
    res.json(updated);
  } catch (error) {
    logError("Error unlocking daily report:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to unlock daily report" });
  }
});

// ============================================================================
// END DAILY REPORT LOCKS ROUTES
// ============================================================================

// ============================================================================
// PHOTO CUSTODY ROUTES (defined before parameterized routes)
// ============================================================================

// GET /api/delay-claims/photo-custody - List photo custody records
router.get("/delay-claims/photo-custody", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }
    const projectId = req.query.projectId as string | undefined;
    const claimId = req.query.claimId as string | undefined;
    const photoUrl = req.query.photoUrl as string | undefined;
    
    let conditions = [eq(photoCustodyRecords.organizationId, orgId!)];
    if (projectId) {
      conditions.push(eq(photoCustodyRecords.projectId, projectId));
    }
    if (claimId) {
      conditions.push(eq(photoCustodyRecords.linkedClaimId, claimId));
    }
    if (photoUrl) {
      conditions.push(eq(photoCustodyRecords.photoUrl, photoUrl));
    }
    
    const records = await db
      .select({
        record: photoCustodyRecords,
        user: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
        },
      })
      .from(photoCustodyRecords)
      .innerJoin(users, eq(photoCustodyRecords.actionById, users.id))
      .where(and(...conditions))
      .orderBy(desc(photoCustodyRecords.actionAt));
    
    res.json(records.map(({ record, user }) => ({
      ...record,
      actionByUser: user,
    })));
  } catch (error) {
    logError("Error fetching photo custody records:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch photo custody records" });
  }
});

// POST /api/delay-claims/photo-custody - Record a custody action
router.post("/delay-claims/photo-custody", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }
    const userId = req.user!.id;
    
    const body = {
      ...req.body,
      organizationId: orgId,
      actionById: userId,
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers["user-agent"],
    };
    
    const validated = insertPhotoCustodyRecordSchema.parse(body);
    
    const [record] = await db
      .insert(photoCustodyRecords)
      .values(validated)
      .returning();
    
    res.status(201).json(record);
  } catch (error) {
    logError("Error creating photo custody record:", {}, error instanceof Error ? error : new Error(String(error)));
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.errors });
    }
    res.status(500).json({ error: "Failed to create photo custody record" });
  }
});

// GET /api/delay-claims/photo-custody/chain/:photoUrl - Get full chain of custody for a photo
router.get("/delay-claims/photo-custody/chain/:photoUrl", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }
    const photoUrl = decodeURIComponent(req.params.photoUrl);
    
    const records = await db
      .select({
        record: photoCustodyRecords,
        user: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
        },
      })
      .from(photoCustodyRecords)
      .innerJoin(users, eq(photoCustodyRecords.actionById, users.id))
      .where(and(
        eq(photoCustodyRecords.organizationId, orgId!),
        eq(photoCustodyRecords.photoUrl, photoUrl)
      ))
      .orderBy(photoCustodyRecords.actionAt);
    
    res.json({
      photoUrl,
      chainOfCustody: records.map(({ record, user }) => ({
        action: record.action,
        actionAt: record.actionAt,
        actionBy: `${user.firstName} ${user.lastName}`,
        actionNotes: record.actionNotes,
        ipAddress: record.ipAddress,
      })),
      totalActions: records.length,
    });
  } catch (error) {
    logError("Error fetching chain of custody:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch chain of custody" });
  }
});

// ============================================================================
// END PHOTO CUSTODY ROUTES
// ============================================================================

// GET /api/delay-claims/:id - Get single delay claim
router.get("/delay-claims/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }
    const { id } = req.params;
    
    const [result] = await db
      .select({
        claim: delayClaims,
        project: {
          id: projects.id,
          name: projects.name,
          code: projects.code,
        },
      })
      .from(delayClaims)
      .innerJoin(projects, eq(delayClaims.projectId, projects.id))
      .where(and(eq(delayClaims.id, id), eq(delayClaims.organizationId, orgId!)))
      .limit(1);
    
    if (!result) {
      return res.status(404).json({ error: "Delay claim not found" });
    }
    
    // Fetch linked delays if any
    let linkedDelays: any[] = [];
    if (result.claim.linkedDelayIds && result.claim.linkedDelayIds.length > 0) {
      linkedDelays = await db
        .select()
        .from(projectDelays)
        .where(inArray(projectDelays.id, result.claim.linkedDelayIds));
    }
    
    res.json({
      ...result.claim,
      project: result.project,
      linkedDelays,
      statusLabel: CLAIM_STATUS_LABELS[result.claim.status] || result.claim.status,
      claimTypeLabel: CLAIM_TYPE_LABELS[result.claim.claimType] || result.claim.claimType,
    });
  } catch (error) {
    logError("Error fetching delay claim:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch delay claim" });
  }
});

// POST /api/delay-claims - Create new delay claim
router.post("/delay-claims", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }
    const userId = req.user!.id;
    
    const body = {
      ...req.body,
      organizationId: orgId,
      createdById: userId,
      title: sanitizeShortText(req.body.title),
      description: sanitizeText(req.body.description),
    };
    
    const validated = insertDelayClaimSchema.parse(body);
    
    // Generate claim number
    const [project] = await db
      .select({ code: projects.code })
      .from(projects)
      .where(eq(projects.id, validated.projectId))
      .limit(1);
    
    if (!project) {
      return res.status(400).json({ error: "Invalid project ID" });
    }
    
    const claimNumber = await generateClaimNumber(project.code);
    
    const [claim] = await db
      .insert(delayClaims)
      .values({
        ...validated,
        claimNumber,
      })
      .returning();
    
    await logAudit({
      userId,
      action: "CREATE",
      entityType: "delay_claim",
      entityId: claim.id,
      newValue: JSON.stringify(claim),
    }, req);
    
    res.status(201).json({
      ...claim,
      statusLabel: CLAIM_STATUS_LABELS[claim.status] || claim.status,
      claimTypeLabel: CLAIM_TYPE_LABELS[claim.claimType] || claim.claimType,
    });
  } catch (error) {
    logError("Error creating delay claim:", {}, error instanceof Error ? error : new Error(String(error)));
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.errors });
    }
    res.status(500).json({ error: "Failed to create delay claim" });
  }
});

// PATCH /api/delay-claims/:id - Update delay claim
router.patch("/delay-claims/:id", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }
    const userId = req.user!.id;
    const { id } = req.params;
    
    const [existing] = await db
      .select()
      .from(delayClaims)
      .where(and(eq(delayClaims.id, id), eq(delayClaims.organizationId, orgId!)))
      .limit(1);
    
    if (!existing) {
      return res.status(404).json({ error: "Delay claim not found" });
    }
    
    const updates: Partial<DelayClaim> = {
      updatedAt: new Date(),
    };
    
    if (req.body.title) updates.title = sanitizeShortText(req.body.title);
    if (req.body.description !== undefined) updates.description = sanitizeText(req.body.description);
    if (req.body.claimType) updates.claimType = req.body.claimType;
    if (req.body.linkedDelayIds) updates.linkedDelayIds = req.body.linkedDelayIds;
    if (req.body.daysRequested !== undefined) updates.daysRequested = req.body.daysRequested;
    if (req.body.costRequested !== undefined) updates.costRequested = req.body.costRequested;
    if (req.body.costBreakdownJson !== undefined) updates.costBreakdownJson = req.body.costBreakdownJson;
    if (req.body.supportingDocUrls) updates.supportingDocUrls = req.body.supportingDocUrls;
    if (req.body.weatherEvidenceSummary !== undefined) updates.weatherEvidenceSummary = sanitizeText(req.body.weatherEvidenceSummary);
    if (req.body.originalCompletionDate) updates.originalCompletionDate = new Date(req.body.originalCompletionDate);
    if (req.body.requestedCompletionDate) updates.requestedCompletionDate = new Date(req.body.requestedCompletionDate);
    
    const [updated] = await db
      .update(delayClaims)
      .set(updates)
      .where(eq(delayClaims.id, id))
      .returning();
    
    await logAudit({
      userId,
      action: "UPDATE",
      entityType: "delay_claim",
      entityId: id,
      oldValue: JSON.stringify(existing),
      newValue: JSON.stringify(updated),
    }, req);
    
    res.json({
      ...updated,
      statusLabel: CLAIM_STATUS_LABELS[updated.status] || updated.status,
      claimTypeLabel: CLAIM_TYPE_LABELS[updated.claimType] || updated.claimType,
    });
  } catch (error) {
    logError("Error updating delay claim:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to update delay claim" });
  }
});

// POST /api/delay-claims/:id/submit - Submit claim for review
router.post("/delay-claims/:id/submit", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }
    const userId = req.user!.id;
    const { id } = req.params;
    
    const [existing] = await db
      .select()
      .from(delayClaims)
      .where(and(eq(delayClaims.id, id), eq(delayClaims.organizationId, orgId!)))
      .limit(1);
    
    if (!existing) {
      return res.status(404).json({ error: "Delay claim not found" });
    }
    
    if (!isValidClaimTransition(existing.status, "SUBMITTED")) {
      return res.status(400).json({ error: `Cannot submit claim from ${existing.status} status` });
    }
    
    const [updated] = await db
      .update(delayClaims)
      .set({
        status: "SUBMITTED",
        submittedAt: new Date(),
        submittedById: userId,
        updatedAt: new Date(),
      })
      .where(eq(delayClaims.id, id))
      .returning();
    
    await logAudit({
      userId,
      action: "SUBMIT",
      entityType: "delay_claim",
      entityId: id,
      oldValue: JSON.stringify(existing),
      newValue: JSON.stringify(updated),
    }, req);
    
    res.json(updated);
  } catch (error) {
    logError("Error submitting delay claim:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to submit delay claim" });
  }
});

// POST /api/delay-claims/:id/review - Start review of claim
router.post("/delay-claims/:id/review", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }
    const userId = req.user!.id;
    const { id } = req.params;
    const { reviewNotes } = req.body;
    
    const [existing] = await db
      .select()
      .from(delayClaims)
      .where(and(eq(delayClaims.id, id), eq(delayClaims.organizationId, orgId!)))
      .limit(1);
    
    if (!existing) {
      return res.status(404).json({ error: "Delay claim not found" });
    }
    
    if (!isValidClaimTransition(existing.status, "UNDER_REVIEW")) {
      return res.status(400).json({ error: `Cannot start review from ${existing.status} status` });
    }
    
    const [updated] = await db
      .update(delayClaims)
      .set({
        status: "UNDER_REVIEW",
        reviewedAt: new Date(),
        reviewedById: userId,
        reviewNotes: sanitizeText(reviewNotes),
        updatedAt: new Date(),
      })
      .where(eq(delayClaims.id, id))
      .returning();
    
    res.json(updated);
  } catch (error) {
    logError("Error starting review:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to start review" });
  }
});

// POST /api/delay-claims/:id/approve - Approve claim
router.post("/delay-claims/:id/approve", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }
    const userId = req.user!.id;
    const { id } = req.params;
    const { daysApproved, costApproved, reviewNotes } = req.body;
    
    const [existing] = await db
      .select()
      .from(delayClaims)
      .where(and(eq(delayClaims.id, id), eq(delayClaims.organizationId, orgId!)))
      .limit(1);
    
    if (!existing) {
      return res.status(404).json({ error: "Delay claim not found" });
    }
    
    if (!isValidClaimTransition(existing.status, "APPROVED")) {
      return res.status(400).json({ error: `Cannot approve claim from ${existing.status} status` });
    }
    
    const [updated] = await db
      .update(delayClaims)
      .set({
        status: "APPROVED",
        approvedAt: new Date(),
        approvedById: userId,
        daysApproved: daysApproved ?? existing.daysRequested,
        costApproved: costApproved ?? existing.costRequested,
        reviewNotes: reviewNotes ? sanitizeText(reviewNotes) : existing.reviewNotes,
        updatedAt: new Date(),
      })
      .where(eq(delayClaims.id, id))
      .returning();
    
    await logAudit({
      userId,
      action: "APPROVE",
      entityType: "delay_claim",
      entityId: id,
      oldValue: JSON.stringify(existing),
      newValue: JSON.stringify(updated),
    }, req);
    
    res.json(updated);
  } catch (error) {
    logError("Error approving delay claim:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to approve delay claim" });
  }
});

// POST /api/delay-claims/:id/reject - Reject claim
router.post("/delay-claims/:id/reject", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }
    const userId = req.user!.id;
    const { id } = req.params;
    const { rejectionReason } = req.body;
    
    if (!rejectionReason) {
      return res.status(400).json({ error: "Rejection reason is required" });
    }
    
    const [existing] = await db
      .select()
      .from(delayClaims)
      .where(and(eq(delayClaims.id, id), eq(delayClaims.organizationId, orgId!)))
      .limit(1);
    
    if (!existing) {
      return res.status(404).json({ error: "Delay claim not found" });
    }
    
    if (!isValidClaimTransition(existing.status, "REJECTED")) {
      return res.status(400).json({ error: `Cannot reject claim from ${existing.status} status` });
    }
    
    const [updated] = await db
      .update(delayClaims)
      .set({
        status: "REJECTED",
        rejectedAt: new Date(),
        rejectedById: userId,
        rejectionReason: sanitizeText(rejectionReason),
        updatedAt: new Date(),
      })
      .where(eq(delayClaims.id, id))
      .returning();
    
    await logAudit({
      userId,
      action: "REJECT",
      entityType: "delay_claim",
      entityId: id,
      oldValue: JSON.stringify(existing),
      newValue: JSON.stringify(updated),
    }, req);
    
    res.json(updated);
  } catch (error) {
    logError("Error rejecting delay claim:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to reject delay claim" });
  }
});

// DELETE /api/delay-claims/:id - Delete claim (draft only)
router.delete("/delay-claims/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }
    const userId = req.user!.id;
    const { id } = req.params;
    
    const [existing] = await db
      .select()
      .from(delayClaims)
      .where(and(eq(delayClaims.id, id), eq(delayClaims.organizationId, orgId!)))
      .limit(1);
    
    if (!existing) {
      return res.status(404).json({ error: "Delay claim not found" });
    }
    
    if (existing.status !== "DRAFT") {
      return res.status(400).json({ error: "Only draft claims can be deleted" });
    }
    
    await db.delete(delayClaims).where(eq(delayClaims.id, id));
    
    await logAudit({
      userId,
      action: "DELETE",
      entityType: "delay_claim",
      entityId: id,
      oldValue: JSON.stringify(existing),
    }, req);
    
    res.json({ success: true });
  } catch (error) {
    logError("Error deleting delay claim:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to delete delay claim" });
  }
});

// NOTE: DAILY REPORT LOCKS ROUTES are defined earlier in this file (before parameterized routes)

// ============================================================================
export default router;
