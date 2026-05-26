// prompt-injection-guard: system-prompt-anchored over tenant-internal equipment telemetry (utilization rates, cost rollups); no user-authored text reaches the model
// ai-router-bypass: equipment AI recommendation lazy-loads the OpenAI client via dynamic import to avoid a startup-time dep on the AI SDK; migration to the General router deferred to a coordinated dynamic-import cleanup. Tracked as a dedicated follow-up under Task #2684.
/**
 * @openapi
 * /api/equipment:
 *   get:
 *     tags: [Equipment]
 *     summary: List all equipment
 *     description: Returns equipment for the authenticated user's organization with optional filters.
 *     parameters:
 *       - name: status
 *         in: query
 *         schema: { type: string }
 *       - name: type
 *         in: query
 *         schema: { type: string }
 *       - name: search
 *         in: query
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: List of equipment
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Equipment'
 *   post:
 *     tags: [Equipment]
 *     summary: Create equipment
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string }
 *               type: { type: string }
 *               make: { type: string }
 *               model: { type: string }
 *               year: { type: integer }
 *               serialNumber: { type: string }
 *               status: { type: string }
 *     responses:
 *       201: { description: Equipment created }
 * /api/equipment/import:
 *   post:
 *     tags: [Equipment]
 *     summary: Import equipment from CSV/JSON
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200: { description: Equipment imported }
 * /api/equipment/available-projects:
 *   get:
 *     tags: [Equipment]
 *     summary: Get projects available for equipment assignment
 *     responses:
 *       200: { description: List of available projects }
 * /api/equipment/{idOrCode}:
 *   get:
 *     tags: [Equipment]
 *     summary: Get equipment by ID or code
 *     parameters:
 *       - name: idOrCode
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Equipment details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Equipment'
 *       404: { description: Equipment not found }
 * /api/equipment/{id}:
 *   patch:
 *     tags: [Equipment]
 *     summary: Update equipment
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200: { description: Equipment updated }
 *   delete:
 *     tags: [Equipment]
 *     summary: Delete equipment
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Equipment deleted }
 * /api/equipment/maintenance/upcoming:
 *   get:
 *     tags: [Equipment]
 *     summary: Get upcoming maintenance across all equipment
 *     responses:
 *       200: { description: Upcoming maintenance items }
 * /api/equipment/{equipmentId}/assignments:
 *   get:
 *     tags: [Equipment]
 *     summary: Get equipment assignments
 *     parameters:
 *       - name: equipmentId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: List of assignments }
 * /api/equipment/{equipmentId}/assign:
 *   post:
 *     tags: [Equipment]
 *     summary: Assign equipment to a project
 *     parameters:
 *       - name: equipmentId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               projectId: { type: string, format: uuid }
 *               startDate: { type: string, format: date }
 *               endDate: { type: string, format: date }
 *     responses:
 *       201: { description: Equipment assigned }
 * /api/equipment/{equipmentId}/return:
 *   post:
 *     tags: [Equipment]
 *     summary: Return equipment from assignment
 *     parameters:
 *       - name: equipmentId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Equipment returned }
 * /api/equipment/{equipmentId}/maintenance-schedules:
 *   get:
 *     tags: [Equipment]
 *     summary: Get maintenance schedules for equipment
 *     parameters:
 *       - name: equipmentId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Maintenance schedules }
 *   post:
 *     tags: [Equipment]
 *     summary: Create maintenance schedule
 *     parameters:
 *       - name: equipmentId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       201: { description: Maintenance schedule created }
 * /api/equipment/{equipmentId}/maintenance-history:
 *   get:
 *     tags: [Equipment]
 *     summary: Get maintenance history for equipment
 *     parameters:
 *       - name: equipmentId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Maintenance history }
 *   post:
 *     tags: [Equipment]
 *     summary: Log maintenance work
 *     parameters:
 *       - name: equipmentId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       201: { description: Maintenance logged }
 * /api/equipment/{equipmentId}/rate-profiles:
 *   get:
 *     tags: [Equipment]
 *     summary: Get rate profiles for equipment
 *     parameters:
 *       - name: equipmentId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Rate profiles }
 *   post:
 *     tags: [Equipment]
 *     summary: Create rate profile
 *     parameters:
 *       - name: equipmentId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       201: { description: Rate profile created }
 * /api/equipment/{equipmentId}/active-rate:
 *   get:
 *     tags: [Equipment]
 *     summary: Get active rate for equipment
 *     parameters:
 *       - name: equipmentId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Active rate profile }
 * /api/equipment/{equipmentId}/rate-profiles/{profileId}:
 *   patch:
 *     tags: [Equipment]
 *     summary: Update rate profile
 *     parameters:
 *       - name: equipmentId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - name: profileId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200: { description: Rate profile updated }
 * /api/equipment/{equipmentId}/rate-profiles/{profileId}/activate:
 *   post:
 *     tags: [Equipment]
 *     summary: Activate a rate profile
 *     parameters:
 *       - name: equipmentId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - name: profileId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Rate profile activated }
 * /api/equipment/rate-profiles/{profileId}:
 *   delete:
 *     tags: [Equipment]
 *     summary: Delete a rate profile
 *     parameters:
 *       - name: profileId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Rate profile deleted }
 * /api/rental-vendors:
 *   get:
 *     tags: [Equipment]
 *     summary: List rental vendors
 *     responses:
 *       200: { description: List of rental vendors }
 *   post:
 *     tags: [Equipment]
 *     summary: Create rental vendor
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       201: { description: Vendor created }
 * /api/rental-vendors/{id}:
 *   get:
 *     tags: [Equipment]
 *     summary: Get rental vendor details
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Vendor details }
 *   patch:
 *     tags: [Equipment]
 *     summary: Update rental vendor
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Vendor updated }
 *   delete:
 *     tags: [Equipment]
 *     summary: Delete rental vendor
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Vendor deleted }
 * /api/rental-vendors/{vendorId}/catalog:
 *   get:
 *     tags: [Equipment]
 *     summary: Get vendor rental catalog
 *     parameters:
 *       - name: vendorId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Rental catalog items }
 *   post:
 *     tags: [Equipment]
 *     summary: Add item to vendor catalog
 *     parameters:
 *       - name: vendorId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       201: { description: Catalog item added }
 * /api/rental-equipment:
 *   get:
 *     tags: [Equipment]
 *     summary: List all rental equipment
 *     responses:
 *       200: { description: List of rental equipment }
 * /api/rental-equipment/{id}:
 *   patch:
 *     tags: [Equipment]
 *     summary: Update rental equipment
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Rental equipment updated }
 *   delete:
 *     tags: [Equipment]
 *     summary: Delete rental equipment
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Rental equipment deleted }
 * /api/projects/{projectId}/equipment:
 *   get:
 *     tags: [Equipment]
 *     summary: Get equipment assigned to project
 *     parameters:
 *       - name: projectId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Project equipment list }
 * /api/projects/{projectId}/equipment-plans:
 *   get:
 *     tags: [Equipment]
 *     summary: Get equipment plans for project
 *     parameters:
 *       - name: projectId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Equipment plans }
 *   post:
 *     tags: [Equipment]
 *     summary: Create equipment plan for project
 *     parameters:
 *       - name: projectId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       201: { description: Equipment plan created }
 * /api/projects/{projectId}/equipment-plans/{planId}:
 *   patch:
 *     tags: [Equipment]
 *     summary: Update equipment plan
 *     parameters:
 *       - name: projectId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - name: planId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Plan updated }
 *   delete:
 *     tags: [Equipment]
 *     summary: Delete equipment plan
 *     parameters:
 *       - name: projectId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - name: planId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Plan deleted }
 * /api/projects/{projectId}/assigned-equipment:
 *   get:
 *     tags: [Equipment]
 *     summary: Get assigned equipment for project
 *     parameters:
 *       - name: projectId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Assigned equipment }
 * /api/bids/{bidId}/equipment:
 *   get:
 *     tags: [Equipment]
 *     summary: Get equipment selections for a bid
 *     parameters:
 *       - name: bidId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Bid equipment selections }
 *   post:
 *     tags: [Equipment]
 *     summary: Add equipment selection to bid
 *     parameters:
 *       - name: bidId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       201: { description: Equipment added to bid }
 * /api/bids/{bidId}/equipment/{selectionId}:
 *   patch:
 *     tags: [Equipment]
 *     summary: Update bid equipment selection
 *     parameters:
 *       - name: bidId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - name: selectionId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Selection updated }
 *   delete:
 *     tags: [Equipment]
 *     summary: Remove equipment from bid
 *     parameters:
 *       - name: bidId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - name: selectionId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Selection removed }
 * /api/equipment-for-selection:
 *   get:
 *     tags: [Equipment]
 *     summary: Get equipment available for selection
 *     responses:
 *       200: { description: Available equipment list }
 * /api/equipment/{equipmentId}/repairs:
 *   get:
 *     tags: [Equipment]
 *     summary: Get repair history for equipment
 *     parameters:
 *       - name: equipmentId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Repair history }
 *   post:
 *     tags: [Equipment]
 *     summary: Log equipment repair
 *     parameters:
 *       - name: equipmentId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       201: { description: Repair logged }
 * /api/equipment/repairs/{repairId}:
 *   patch:
 *     tags: [Equipment]
 *     summary: Update repair record
 *     parameters:
 *       - name: repairId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Repair updated }
 * /api/equipment/{equipmentId}/hour-logs:
 *   get:
 *     tags: [Equipment]
 *     summary: Get hour logs for equipment
 *     parameters:
 *       - name: equipmentId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Hour logs }
 *   post:
 *     tags: [Equipment]
 *     summary: Log equipment hours
 *     parameters:
 *       - name: equipmentId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       201: { description: Hours logged }
 * /api/equipment/{equipmentId}/ai-recommendations:
 *   post:
 *     tags: [Equipment]
 *     summary: Get AI maintenance recommendations
 *     parameters:
 *       - name: equipmentId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: AI recommendations }
 * /api/equipment/notify-maintenance:
 *   post:
 *     tags: [Equipment]
 *     summary: Send maintenance notification
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200: { description: Notification sent }
 * /api/equipment/{equipmentId}/depreciation:
 *   get:
 *     tags: [Equipment]
 *     summary: Get depreciation schedule for equipment
 *     parameters:
 *       - name: equipmentId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Depreciation schedule with yearly breakdown }
 */
import { logError } from "./utils/logger";
import { Router } from "express";
import { db } from "./db";
import { equipment, equipmentAssignments, equipmentMaintenanceSchedules, equipmentMaintenanceHistory, equipmentRateProfiles, insertEquipmentRateProfileSchema, validatedEquipmentSchema, projects, users, auditLog, rentalVendors, insertRentalVendorSchema, rentalEquipmentCatalog, insertRentalEquipmentCatalogSchema, equipmentHourLogs, equipmentRepairs, bidEquipmentSelections, projectEquipmentPlans, bids, notifications, equipmentFuelLogs } from "@shared/schema";
import { requireAuth, requireRole, requireFeaturePermission, type AuthRequest } from "./auth";
import { eq, desc, sql, and, or, ne, inArray } from "drizzle-orm";
import { z } from "zod";
import { logCreate, logUpdate, logDelete } from "./auditLogger";
import { getOrgIdForFilter, verifyOrgAccess } from "./orgFilter";
import { insertNotification } from "./services/notificationService";
import { governedAiCall } from "./services/aiGovernance";
import { eventBus } from "./events";
import { parseOrRespond } from "./utils/validation";

const router = Router();

interface DepreciationScheduleEntry {
  year: number;
  beginningValue: number;
  depreciation: number;
  endingValue: number;
  accumulatedDepreciation: number;
}

interface DepreciationResult {
  purchasePrice: number;
  currentBookValue: number;
  totalDepreciation: number;
  depreciationMethod: string;
  remainingUsefulLife: number;
  salvageValue: number;
  usefulLifeYears: number;
  inServiceDate: string;
  schedule: DepreciationScheduleEntry[];
}

function calculateDepreciation(params: {
  purchasePrice: number;
  salvageValue: number;
  usefulLifeYears: number;
  depreciationMethod: string;
  inServiceDate: string;
}): DepreciationResult {
  const { purchasePrice, salvageValue, usefulLifeYears, depreciationMethod, inServiceDate } = params;

  if (!purchasePrice || !usefulLifeYears || !inServiceDate) {
    return {
      purchasePrice,
      currentBookValue: purchasePrice,
      totalDepreciation: 0,
      depreciationMethod,
      remainingUsefulLife: usefulLifeYears,
      salvageValue,
      usefulLifeYears,
      inServiceDate: inServiceDate || "",
      schedule: [],
    };
  }

  const startDate = new Date(inServiceDate);
  const now = new Date();
  const yearsElapsed = (now.getTime() - startDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  const depreciableAmount = purchasePrice - salvageValue;

  const schedule: DepreciationScheduleEntry[] = [];
  let currentValue = purchasePrice;
  let accumulatedDep = 0;

  const startYear = startDate.getFullYear();

  if (depreciationMethod === "DECLINING_BALANCE") {
    const rate = 2 / usefulLifeYears;
    for (let i = 0; i < usefulLifeYears; i++) {
      const yearStart = currentValue;
      let dep = currentValue * rate;
      if (currentValue - dep < salvageValue) {
        dep = currentValue - salvageValue;
      }
      currentValue -= dep;
      accumulatedDep += dep;
      schedule.push({
        year: startYear + i,
        beginningValue: Math.round(yearStart * 100) / 100,
        depreciation: Math.round(dep * 100) / 100,
        endingValue: Math.round(currentValue * 100) / 100,
        accumulatedDepreciation: Math.round(accumulatedDep * 100) / 100,
      });
    }
  } else {
    const annualDep = depreciableAmount / usefulLifeYears;
    for (let i = 0; i < usefulLifeYears; i++) {
      const yearStart = currentValue;
      const dep = Math.min(annualDep, currentValue - salvageValue);
      currentValue -= dep;
      accumulatedDep += dep;
      schedule.push({
        year: startYear + i,
        beginningValue: Math.round(yearStart * 100) / 100,
        depreciation: Math.round(dep * 100) / 100,
        endingValue: Math.round(currentValue * 100) / 100,
        accumulatedDepreciation: Math.round(accumulatedDep * 100) / 100,
      });
    }
  }

  const completedYears = Math.min(Math.floor(yearsElapsed), usefulLifeYears);
  const bookValue = completedYears < schedule.length
    ? schedule[completedYears]?.beginningValue ?? salvageValue
    : salvageValue;
  const totalDep = purchasePrice - bookValue;
  const remainingLife = Math.max(0, usefulLifeYears - Math.floor(yearsElapsed));

  return {
    purchasePrice,
    currentBookValue: Math.round(bookValue * 100) / 100,
    totalDepreciation: Math.round(totalDep * 100) / 100,
    depreciationMethod,
    remainingUsefulLife: remainingLife,
    salvageValue,
    usefulLifeYears,
    inServiceDate,
    schedule,
  };
}

// ========================================
// Routes from equipmentMgmtRoutes.ts
// ========================================

// Mobile maintenance request submission — open to any authenticated user
// in the org (operators report broken equipment from the field without the
// canManageEquipment feature flag the desktop equipment module gates on).
// Registered BEFORE the router.use() below so the feature-permission
// middleware does not apply. Cross-tenant safety is enforced by checking
// equipment.organizationId via the org filter.
router.post(
  "/api/equipment/:equipmentId/maintenance-requests",
  requireAuth,
  async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      const { equipmentId } = req.params;
      const bodySchema = z.object({
        severity: z.enum(["DOWN", "LIMITED", "COSMETIC"]),
        issueType: z.string().trim().min(1).max(120),
        description: z.string().trim().min(1).max(4000),
        projectId: z.string().uuid().optional().nullable(),
        photoObjectKeys: z.array(z.string().min(1).max(1024)).max(20).optional(),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
      }
      const { severity, issueType, description, projectId, photoObjectKeys } = parsed.data;

      const conditions = [eq(equipment.id, equipmentId)];
      if (shouldFilter && orgId) {
        conditions.push(eq(equipment.organizationId, orgId));
      }
      const [equipmentItem] = await db.select().from(equipment).where(and(...conditions)).limit(1);
      if (!equipmentItem) {
        return res.status(404).json({ error: "Equipment not found" });
      }

      // Validate optional projectId is in same org
      if (projectId && shouldFilter && orgId) {
        const [projectRow] = await db
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, projectId), eq(projects.gcOrganizationId, orgId)))
          .limit(1);
        if (!projectRow) {
          return res.status(404).json({ error: "Project not found" });
        }
      }

      // Generate next REP-#### number
      const lastRepair = await db
        .select({ repairNumber: equipmentRepairs.repairNumber })
        .from(equipmentRepairs)
        .orderBy(desc(equipmentRepairs.createdAt))
        .limit(1);
      let nextNumber = 1;
      if (lastRepair.length > 0) {
        const match = lastRepair[0].repairNumber?.match(/REP-(\d+)/);
        if (match) nextNumber = parseInt(match[1], 10) + 1;
      }
      const repairNumber = `REP-${String(nextNumber).padStart(4, "0")}`;

      // Compose a description that surfaces severity + issue type in the
      // existing desktop repair list (which only renders `description`).
      // Detailed narrative + photo object keys land in problemDescription
      // and repairNotes so the desktop reviewer sees everything.
      const composedDescription = `[${severity}] ${issueType}`;
      const photoNote = photoObjectKeys && photoObjectKeys.length > 0
        ? `\n\nPhotos attached: ${photoObjectKeys.length}`
        : "";

      const [repair] = await db.insert(equipmentRepairs).values({
        equipmentId,
        repairNumber,
        description: composedDescription,
        status: "PENDING",
        problemReportedById: req.user!.id,
        problemDescription: `${description}${photoNote}`,
        hoursAtReport: equipmentItem.currentHours ?? null,
        repairNotes: photoObjectKeys && photoObjectKeys.length > 0
          ? JSON.stringify({ source: "mobile", projectId: projectId ?? null, photos: photoObjectKeys })
          : JSON.stringify({ source: "mobile", projectId: projectId ?? null }),
      }).returning();

      // Mirror the desktop repair route: DOWN severity flips the equipment
      // to IN_REPAIR so dispatch can see at a glance the unit is offline.
      if (severity === "DOWN") {
        await db.update(equipment).set({
          status: "IN_REPAIR",
          updatedAt: new Date(),
        }).where(eq(equipment.id, equipmentId));
      }

      res.status(201).json(repair);
    } catch (error) {
      next(error);
    }
  }
);

// List recent maintenance requests submitted by the current user (mobile
// "My recent requests" panel). Also open to any authenticated user, scoped
// by reporter id + tenant org via the equipment join.
router.get(
  "/api/equipment/my-maintenance-requests",
  requireAuth,
  async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      if (mustDenyAccess) return res.json([]);

      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
      const conditions = [eq(equipmentRepairs.problemReportedById, req.user!.id)];
      if (shouldFilter && orgId) {
        conditions.push(eq(equipment.organizationId, orgId));
      }
      const rows = await db
        .select({
          id: equipmentRepairs.id,
          repairNumber: equipmentRepairs.repairNumber,
          description: equipmentRepairs.description,
          status: equipmentRepairs.status,
          problemReportedAt: equipmentRepairs.problemReportedAt,
          equipmentId: equipmentRepairs.equipmentId,
          equipmentName: equipment.name,
          equipmentCode: equipment.equipmentCode,
        })
        .from(equipmentRepairs)
        .innerJoin(equipment, eq(equipmentRepairs.equipmentId, equipment.id))
        .where(and(...conditions))
        .orderBy(desc(equipmentRepairs.problemReportedAt))
        .limit(limit);
      res.json(rows);
    } catch (error) {
      next(error);
    }
  }
);

// Mobile-safe equipment lookup for the Report Equipment Issue picker.
// Open to any authenticated user in the org so operators (who do not have
// the canManageEquipment feature flag) can still find the unit they need
// to report. Returns only the minimal fields the picker renders.
router.get(
  "/api/equipment/mobile-list",
  requireAuth,
  async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      if (mustDenyAccess) return res.json([]);
      const conditions: any[] = [];
      if (shouldFilter && orgId) {
        conditions.push(eq(equipment.organizationId, orgId));
      }
      const rows = await db
        .select({
          id: equipment.id,
          equipmentCode: equipment.equipmentCode,
          name: equipment.name,
          status: equipment.status,
        })
        .from(equipment)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(equipment.name)
        .limit(500);
      res.json(rows);
    } catch (error) {
      next(error);
    }
  }
);

router.use("/api/equipment", requireAuth, requireFeaturePermission('canManageEquipment'));

  // ============================================================
  // EQUIPMENT & TOOL MANAGEMENT ROUTES
  // ============================================================

  // Get all equipment with optional filters
  router.get("/api/equipment", async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      // SECURITY: Users without organization can't see any equipment
      if (mustDenyAccess) {
        return res.json([]);
      }
      
      const { status, type, search } = req.query;
      
      const conditions: any[] = [];
      
      // SECURITY: Filter by organization
      if (shouldFilter && orgId) {
        conditions.push(eq(equipment.organizationId, orgId));
      }
      
      if (status && status !== "ALL") {
        conditions.push(eq(equipment.status, status as string));
      }
      
      if (type && type !== "ALL") {
        conditions.push(eq(equipment.type, type as string));
      }
      
      if (search) {
        const searchTerm = `%${String(search).toLowerCase()}%`;
        conditions.push(
          or(
            sql`LOWER(${equipment.name}) LIKE ${searchTerm}`,
            sql`LOWER(${equipment.equipmentCode}) LIKE ${searchTerm}`,
            sql`LOWER(${equipment.make}) LIKE ${searchTerm}`,
            sql`LOWER(${equipment.model}) LIKE ${searchTerm}`,
            sql`LOWER(${equipment.serialNumber}) LIKE ${searchTerm}`
          )
        );
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
      const hasPagination = req.query.page || req.query.limit;
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 100));
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const offset = (page - 1) * limit;

      const query = db.select().from(equipment).where(whereClause).orderBy(equipment.name).limit(limit).offset(offset);
      const result = await query;

      if (hasPagination) {
        const countResult = await db.select({ count: sql<number>`count(*)` }).from(equipment).where(whereClause);
        const total = Number(countResult[0]?.count ?? 0);
        res.json({ data: result, total, page, limit, totalPages: Math.ceil(total / limit) });
      } else {
        res.json(result);
      }
    } catch (error) {
      next(error);
    }
  });

  // Import equipment from CSV (batch create)
  router.post("/api/equipment/import", async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      if (mustDenyAccess || !req.user?.organizationId) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }

      const { rows } = req.body;
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ error: "No rows provided" });
      }
      if (rows.length > 500) {
        return res.status(400).json({ error: "Maximum 500 rows per import" });
      }

      const existingCodes = await db
        .select({ equipmentCode: equipment.equipmentCode })
        .from(equipment)
        .where(eq(equipment.organizationId, req.user!.organizationId));
      const existingCodeSet = new Set(existingCodes.map(e => e.equipmentCode));

      let created = 0;
      let skipped = 0;
      const errors: { row: number; reason: string }[] = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        try {
          if (!row.name || !row.type) {
            errors.push({ row: i + 1, reason: "Name and Type are required" });
            continue;
          }

          let code = row.equipmentCode;
          if (!code) {
            const lastEquipment = await db
              .select({ equipmentCode: equipment.equipmentCode })
              .from(equipment)
              .orderBy(desc(equipment.equipmentCode))
              .limit(1);
            let nextNumber = 1;
            if (lastEquipment.length > 0) {
              const match = lastEquipment[0].equipmentCode.match(/EQ-(\d+)/);
              if (match) nextNumber = parseInt(match[1], 10) + 1;
            }
            code = `EQ-${String(nextNumber + created).padStart(4, '0')}`;
          }

          if (existingCodeSet.has(code)) {
            skipped++;
            continue;
          }

          const preprocessed: any = {
            ...row,
            equipmentCode: code,
            status: row.status || "AVAILABLE",
          };
          if (preprocessed.purchaseDate && typeof preprocessed.purchaseDate === 'string') {
            const d = new Date(preprocessed.purchaseDate);
            preprocessed.purchaseDate = isNaN(d.getTime()) ? null : d;
          }
          if (preprocessed.warrantyExpirationDate && typeof preprocessed.warrantyExpirationDate === 'string') {
            const d = new Date(preprocessed.warrantyExpirationDate);
            preprocessed.warrantyExpirationDate = isNaN(d.getTime()) ? null : d;
          }
          if (preprocessed.year && typeof preprocessed.year === 'string') {
            const y = parseInt(preprocessed.year, 10);
            preprocessed.year = isNaN(y) ? null : y;
          }
          if (preprocessed.currentHours === '') preprocessed.currentHours = null;
          if (preprocessed.purchasePrice === '') preprocessed.purchasePrice = null;

          const validationResult = validatedEquipmentSchema.safeParse(preprocessed);

          if (!validationResult.success) {
            const msg = validationResult.error.errors.map(e => e.message).join(", ");
            errors.push({ row: i + 1, reason: msg });
            continue;
          }

          await db.insert(equipment).values({
            ...validationResult.data,
            organizationId: req.user!.organizationId,
          });

          existingCodeSet.add(code);
          created++;
        } catch (err: any) {
          if (err.constraint === "equipment_equipment_code_unique") {
            skipped++;
          } else {
            errors.push({ row: i + 1, reason: err.message || "Unknown error" });
          }
        }
      }

      if (created > 0) {
        await db.insert(auditLog).values({
          userId: req.user!.id,
          action: "CREATE",
          entityType: "equipment",
          entityId: "bulk-import",
          newValue: `Bulk imported ${created} equipment records (${skipped} skipped, ${errors.length} errors)`,
        });
      }

      res.json({ created, skipped, errors });
    } catch (error) {
      next(error);
    }
  });

  // Get available projects for equipment assignment (must be before :idOrCode route)
  router.get("/api/equipment/available-projects", async (req: AuthRequest, res, next) => {
    try {
      // Organization filtering: Only show projects from user's organization
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      // SECURITY: Users without org can't see any projects
      if (mustDenyAccess) {
        return res.json([]);
      }
      
      const conditions = [eq(projects.status, "ACTIVE")];
      if (shouldFilter && orgId) {
        conditions.push(eq(projects.gcOrganizationId, orgId));
      }
      
      const activeProjects = await db
        .select({
          id: projects.id,
          name: projects.name,
          code: projects.code,
        })
        .from(projects)
        .where(and(...conditions))
        .orderBy(projects.name);
      
      res.json(activeProjects);
    } catch (error) {
      next(error);
    }
  });

  // Get single equipment by ID or code
  router.get("/api/equipment/:idOrCode", async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      // SECURITY: Users without organization can't access equipment
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { idOrCode } = req.params;
      
      const conditions = [
        or(
          eq(equipment.id, idOrCode),
          eq(equipment.equipmentCode, idOrCode)
        )
      ];
      
      // SECURITY: Filter by organization
      if (shouldFilter && orgId) {
        conditions.push(eq(equipment.organizationId, orgId));
      }
      
      const result = await db
        .select()
        .from(equipment)
        .where(and(...conditions))
        .limit(1);
      
      if (result.length === 0) {
        res.status(404).json({ error: "Equipment not found" });
        return;
      }
      
      res.json(result[0]);
    } catch (error) {
      next(error);
    }
  });

  // Create new equipment
  router.post("/api/equipment", async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      // SECURITY: Users without organization can't create equipment
      if (mustDenyAccess || !req.user?.organizationId) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const body = req.body;
      
      // Generate equipment code if not provided
      if (!body.equipmentCode) {
        const lastEquipment = await db
          .select({ equipmentCode: equipment.equipmentCode })
          .from(equipment)
          .orderBy(desc(equipment.equipmentCode))
          .limit(1);
        
        let nextNumber = 1;
        if (lastEquipment.length > 0) {
          const match = lastEquipment[0].equipmentCode.match(/EQ-(\d+)/);
          if (match) {
            nextNumber = parseInt(match[1], 10) + 1;
          }
        }
        body.equipmentCode = `EQ-${String(nextNumber).padStart(4, '0')}`;
      }
      
      // Validate and coerce input using the validated schema
      // This handles empty strings for numeric fields by converting them to null
      const validationResult = validatedEquipmentSchema.safeParse(body);
      if (!validationResult.success) {
        const errors = validationResult.error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message
        }));
        res.status(400).json({ 
          error: "Validation failed",
          details: errors 
        });
        return;
      }
      
      const validatedData = validationResult.data;
      
      // SECURITY: Set organizationId from authenticated user
      const [newEquipment] = await db.insert(equipment).values({
        ...validatedData,
        organizationId: req.user!.organizationId
      }).returning();
      
      // Audit log
      await db.insert(auditLog).values({
        userId: req.user!.id,
        action: "CREATE",
        entityType: "equipment",
        entityId: newEquipment.id,
        newValue: `Created equipment: ${newEquipment.name} (${newEquipment.equipmentCode})`,
      });
      
      res.status(201).json(newEquipment);
    } catch (error: any) {
      logError("Create equipment error:", {}, error instanceof Error ? error : new Error(String(error)));
      if (error.constraint === "equipment_equipment_code_unique") {
        res.status(400).json({ error: "Equipment code already exists" });
        return;
      }
      next(error);
    }
  });

  // Update equipment
  router.patch("/api/equipment/:id", async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      // SECURITY: Users without organization can't update equipment
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { id } = req.params;
      const updates = req.body;
      
      // SECURITY: Verify ownership before update
      const conditions = [eq(equipment.id, id)];
      if (shouldFilter && orgId) {
        conditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [existing] = await db
        .select()
        .from(equipment)
        .where(and(...conditions))
        .limit(1);
      
      if (!existing) {
        return res.status(404).json({ error: "Equipment not found" });
      }
      
      // Validate and coerce numeric fields for partial updates
      // Create a partial schema that only validates provided fields
      const partialValidation = validatedEquipmentSchema.partial().safeParse(updates);
      if (!partialValidation.success) {
        const errors = partialValidation.error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message
        }));
        res.status(400).json({ 
          error: "Validation failed",
          details: errors 
        });
        return;
      }
      
      const validatedUpdates = partialValidation.data;
      
      // SECURITY: Prevent changing organizationId
      delete (validatedUpdates as any).organizationId;
      
      const [updated] = await db
        .update(equipment)
        .set({ ...validatedUpdates, updatedAt: new Date() })
        .where(and(...conditions))
        .returning();
      
      if (!updated) {
        res.status(404).json({ error: "Equipment not found" });
        return;
      }
      
      // Audit log
      await db.insert(auditLog).values({
        userId: req.user!.id,
        action: "UPDATE",
        entityType: "equipment",
        entityId: id,
        newValue: `Updated equipment: ${updated.name}`,
      });
      
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  // Delete equipment
  router.delete("/api/equipment/:id", async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      // SECURITY: Users without organization can't delete equipment
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { id } = req.params;
      
      // SECURITY: Build conditions with org filter
      const conditions = [eq(equipment.id, id)];
      if (shouldFilter && orgId) {
        conditions.push(eq(equipment.organizationId, orgId));
      }
      
      // SECURITY: Delete with organization filter applied
      const [deleted] = await db
        .delete(equipment)
        .where(and(...conditions))
        .returning();
      
      if (!deleted) {
        res.status(404).json({ error: "Equipment not found" });
        return;
      }
      
      // Audit log
      await db.insert(auditLog).values({
        userId: req.user!.id,
        action: "DELETE",
        entityType: "equipment",
        entityId: id,
        newValue: `Deleted equipment: ${deleted.name} (${deleted.equipmentCode})`,
      });
      
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  // PM auto-WO generation: create equipmentRepairs (PENDING) for any maintenance schedule that
  // is currently due by date or hour-meter. Idempotent — re-runs safely.
  router.post("/api/equipment/maintenance/generate-work-orders", requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res, next) => {
    try {
      const { getOrgIdForFilter } = await import("./orgFilter");
      const { generateDuePmWorkOrders } = await import("./equipmentPmEngine");
      const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
      if (mustDenyAccess) return res.status(403).json({ error: "No organization access" });
      const result = await generateDuePmWorkOrders({
        organizationId: orgId ?? undefined,
        systemUserId: req.user!.id,
      });
      // Task #2690 — surface the richer summary so an unexpectedly
      // empty run is observable. Existing fields (`generated`,
      // `skipped`, `scheduleIds`) keep their original shape.
      res.json({
        checked: result.checked,
        generated: result.generated,
        skipped: result.skipped,
        skippedReasons: result.skippedReasons,
        scheduleIds: result.scheduleIds,
      });
    } catch (err) { next(err); }
  });

  // Get upcoming maintenance due (for alerts) — must be before /:equipmentId routes to avoid route shadowing
  router.get("/api/equipment/maintenance/upcoming", async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.json([]);
      }
      
      const now = new Date();
      const alertWindow = new Date();
      alertWindow.setDate(alertWindow.getDate() + 14); // 2 weeks ahead
      
      // SECURITY: Build conditions with org filter
      const conditions = [
        eq(equipmentMaintenanceSchedules.isActive, true),
        or(
          // Date-based maintenance due within window
          and(
            sql`${equipmentMaintenanceSchedules.nextDueAt} IS NOT NULL`,
            sql`${equipmentMaintenanceSchedules.nextDueAt} <= ${alertWindow}`
          ),
          // Hours-based maintenance due (within 50 hours)
          sql`(${equipmentMaintenanceSchedules.nextDueHours}::numeric - COALESCE(${equipment.currentHours}::numeric, 0)) <= 50`
        )
      ];
      
      if (shouldFilter && orgId) {
        conditions.push(eq(equipment.organizationId, orgId));
      }
      
      const upcomingMaintenance = await db
        .select({
          scheduleId: equipmentMaintenanceSchedules.id,
          equipmentId: equipmentMaintenanceSchedules.equipmentId,
          equipmentName: equipment.name,
          equipmentCode: equipment.equipmentCode,
          maintenanceName: equipmentMaintenanceSchedules.name,
          maintenanceType: equipmentMaintenanceSchedules.maintenanceType,
          nextDueAt: equipmentMaintenanceSchedules.nextDueAt,
          nextDueHours: equipmentMaintenanceSchedules.nextDueHours,
          currentHours: equipment.currentHours,
        })
        .from(equipmentMaintenanceSchedules)
        .innerJoin(equipment, eq(equipmentMaintenanceSchedules.equipmentId, equipment.id))
        .where(and(...conditions))
        .orderBy(equipmentMaintenanceSchedules.nextDueAt);
      
      res.json(upcomingMaintenance);
    } catch (error) {
      next(error);
    }
  });

  // Get equipment assignments for a piece of equipment
  router.get("/api/equipment/:equipmentId/assignments", async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.json([]);
      }
      
      const { equipmentId } = req.params;
      
      // SECURITY: Verify parent equipment belongs to user's org
      const equipConditions = [eq(equipment.id, equipmentId)];
      if (shouldFilter && orgId) {
        equipConditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [equipmentItem] = await db
        .select()
        .from(equipment)
        .where(and(...equipConditions))
        .limit(1);
      
      if (!equipmentItem) {
        return res.status(404).json({ error: "Equipment not found" });
      }
      
      const assignments = await db
        .select({
          id: equipmentAssignments.id,
          equipmentId: equipmentAssignments.equipmentId,
          projectId: equipmentAssignments.projectId,
          projectName: projects.name,
          projectCode: projects.code,
          assignedById: equipmentAssignments.assignedById,
          assignedByName: sql<string>`${users.firstName} || ' ' || ${users.lastName}`,
          assignedAt: equipmentAssignments.assignedAt,
          expectedReturnDate: equipmentAssignments.expectedReturnDate,
          returnedAt: equipmentAssignments.returnedAt,
          hoursAtAssignment: equipmentAssignments.hoursAtAssignment,
          hoursAtReturn: equipmentAssignments.hoursAtReturn,
          notes: equipmentAssignments.notes,
          isActive: equipmentAssignments.isActive,
        })
        .from(equipmentAssignments)
        .innerJoin(projects, eq(equipmentAssignments.projectId, projects.id))
        .innerJoin(users, eq(equipmentAssignments.assignedById, users.id))
        .where(eq(equipmentAssignments.equipmentId, equipmentId))
        .orderBy(desc(equipmentAssignments.assignedAt));
      
      res.json(assignments);
    } catch (error) {
      next(error);
    }
  });

  // Assign equipment to project
  router.post("/api/equipment/:equipmentId/assign", async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { equipmentId } = req.params;
      const { projectId, expectedReturnDate, notes } = req.body;
      
      // SECURITY: Check if equipment exists AND belongs to user's org
      const conditions = [eq(equipment.id, equipmentId)];
      if (shouldFilter && orgId) {
        conditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [equipmentItem] = await db.select().from(equipment).where(and(...conditions));
      if (!equipmentItem) {
        res.status(404).json({ error: "Equipment not found" });
        return;
      }
      
      // Check if equipment is available
      if (equipmentItem.status !== "AVAILABLE") {
        res.status(400).json({ error: `Equipment is not available (current status: ${equipmentItem.status})` });
        return;
      }
      
      // Create assignment
      const [assignment] = await db.insert(equipmentAssignments).values({
        equipmentId,
        projectId,
        assignedById: req.user!.id,
        expectedReturnDate: expectedReturnDate || null,
        hoursAtAssignment: equipmentItem.currentHours,
        notes,
        isActive: true,
      }).returning();
      
      // Update equipment status
      await db.update(equipment).set({
        status: "ASSIGNED",
        assignedToProjectId: projectId,
        currentLocation: null, // Will be at project site
        updatedAt: new Date(),
      }).where(eq(equipment.id, equipmentId));
      
      // Audit log
      const [project] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, projectId));
      await db.insert(auditLog).values({
        userId: req.user!.id,
        action: "CREATE",
        entityType: "equipment_assignment",
        entityId: assignment.id,
        newValue: `Assigned ${equipmentItem.name} to ${project?.name || projectId}`,
      });
      
      res.status(201).json(assignment);
    } catch (error) {
      next(error);
    }
  });

  // Return equipment from assignment
  router.post("/api/equipment/:equipmentId/return", async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { equipmentId } = req.params;
      const { returnCondition, endingHours, notes } = req.body;
      
      // SECURITY: Verify equipment belongs to user's org
      const equipConditions = [eq(equipment.id, equipmentId)];
      if (shouldFilter && orgId) {
        equipConditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [equipmentItem] = await db.select().from(equipment).where(and(...equipConditions)).limit(1);
      if (!equipmentItem) {
        return res.status(404).json({ error: "Equipment not found" });
      }
      
      // Find active assignment
      const [activeAssignment] = await db
        .select()
        .from(equipmentAssignments)
        .where(and(
          eq(equipmentAssignments.equipmentId, equipmentId),
          eq(equipmentAssignments.isActive, true)
        ))
        .limit(1);
      
      if (!activeAssignment) {
        res.status(400).json({ error: "No active assignment found for this equipment" });
        return;
      }
      
      // Update assignment
      const [updated] = await db.update(equipmentAssignments).set({
        returnedAt: new Date(),
        returnedById: req.user!.id,
        returnCondition,
        hoursAtReturn: endingHours,
        notes: notes || activeAssignment.notes,
        isActive: false,
        updatedAt: new Date(),
      }).where(eq(equipmentAssignments.id, activeAssignment.id)).returning();
      
      // Update equipment status and hours
      await db.update(equipment).set({
        status: "AVAILABLE",
        assignedToProjectId: null,
        currentHours: endingHours || undefined,
        currentLocation: null,
        updatedAt: new Date(),
      }).where(eq(equipment.id, equipmentId));
      
      // Audit log
      await db.insert(auditLog).values({
        userId: req.user!.id,
        action: "UPDATE",
        entityType: "equipment_assignment",
        entityId: activeAssignment.id,
        newValue: `Returned equipment from assignment`,
      });
      
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  // Get maintenance schedules for equipment
  router.get("/api/equipment/:equipmentId/maintenance-schedules", async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.json([]);
      }
      
      const { equipmentId } = req.params;
      
      // SECURITY: Verify equipment belongs to user's org
      const equipConditions = [eq(equipment.id, equipmentId)];
      if (shouldFilter && orgId) {
        equipConditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [equipmentItem] = await db.select().from(equipment).where(and(...equipConditions)).limit(1);
      if (!equipmentItem) {
        return res.status(404).json({ error: "Equipment not found" });
      }
      
      const schedules = await db
        .select()
        .from(equipmentMaintenanceSchedules)
        .where(eq(equipmentMaintenanceSchedules.equipmentId, equipmentId))
        .orderBy(equipmentMaintenanceSchedules.name);
      
      res.json(schedules);
    } catch (error) {
      next(error);
    }
  });

  // Create maintenance schedule
  router.post("/api/equipment/:equipmentId/maintenance-schedules", async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { equipmentId } = req.params;
      const body = req.body;
      
      // SECURITY: Verify equipment belongs to user's org
      const equipConditions = [eq(equipment.id, equipmentId)];
      if (shouldFilter && orgId) {
        equipConditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [equipmentItem] = await db.select().from(equipment).where(and(...equipConditions)).limit(1);
      if (!equipmentItem) {
        return res.status(404).json({ error: "Equipment not found" });
      }
      
      // Calculate next due date based on interval
      let nextDueAt = null;
      let nextDueHours = null;
      
      if (body.intervalDays) {
        nextDueAt = new Date();
        nextDueAt.setDate(nextDueAt.getDate() + body.intervalDays);
      }
      
      if (body.intervalHours) {
        nextDueHours = (parseFloat(equipmentItem.currentHours || "0") + body.intervalHours).toString();
      }
      
      const [schedule] = await db.insert(equipmentMaintenanceSchedules).values({
        equipmentId,
        ...body,
        nextDueAt,
        nextDueHours,
      }).returning();
      
      res.status(201).json(schedule);
    } catch (error) {
      next(error);
    }
  });

  // Record maintenance completion
  router.post("/api/equipment/:equipmentId/maintenance-history", async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { equipmentId } = req.params;
      const { scheduleId, maintenanceType, description, performedByVendor, laborCost, partsCost, notes, partsUsed } = req.body;
      
      // SECURITY: Verify equipment belongs to user's org
      const equipConditions = [eq(equipment.id, equipmentId)];
      if (shouldFilter && orgId) {
        equipConditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [equipmentItem] = await db.select().from(equipment).where(and(...equipConditions)).limit(1);
      if (!equipmentItem) {
        res.status(404).json({ error: "Equipment not found" });
        return;
      }
      
      const totalCost = (parseFloat(laborCost || "0") + parseFloat(partsCost || "0")).toString();
      
      // Create maintenance history record
      const [history] = await db.insert(equipmentMaintenanceHistory).values({
        equipmentId,
        scheduleId,
        maintenanceType,
        description,
        performedAt: new Date(),
        hoursAtMaintenance: equipmentItem.currentHours,
        performedById: req.user!.id,
        performedByVendor,
        laborCost,
        partsCost,
        totalCost,
        notes,
        partsUsed,
      }).returning();
      
      // Update schedule if provided
      if (scheduleId) {
        const [schedule] = await db.select().from(equipmentMaintenanceSchedules).where(eq(equipmentMaintenanceSchedules.id, scheduleId));
        if (schedule) {
          let nextDueAt = null;
          let nextDueHours = null;
          
          if (schedule.intervalDays) {
            nextDueAt = new Date();
            nextDueAt.setDate(nextDueAt.getDate() + schedule.intervalDays);
          }
          
          if (schedule.intervalHours) {
            nextDueHours = (parseFloat(equipmentItem.currentHours || "0") + schedule.intervalHours).toString();
          }
          
          await db.update(equipmentMaintenanceSchedules).set({
            lastPerformedAt: new Date(),
            lastPerformedHours: equipmentItem.currentHours,
            nextDueAt,
            nextDueHours,
            updatedAt: new Date(),
          }).where(eq(equipmentMaintenanceSchedules.id, scheduleId));
        }
      }
      
      // Update equipment maintenance dates
      await db.update(equipment).set({
        lastMaintenanceDate: new Date(),
        updatedAt: new Date(),
      }).where(eq(equipment.id, equipmentId));
      
      res.status(201).json(history);
    } catch (error) {
      next(error);
    }
  });

  // Get maintenance history for equipment
  router.get("/api/equipment/:equipmentId/maintenance-history", async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.json([]);
      }
      
      const { equipmentId } = req.params;
      
      // SECURITY: Verify equipment belongs to user's org
      const equipConditions = [eq(equipment.id, equipmentId)];
      if (shouldFilter && orgId) {
        equipConditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [equipmentItem] = await db.select().from(equipment).where(and(...equipConditions)).limit(1);
      if (!equipmentItem) {
        return res.status(404).json({ error: "Equipment not found" });
      }
      
      const history = await db
        .select()
        .from(equipmentMaintenanceHistory)
        .where(eq(equipmentMaintenanceHistory.equipmentId, equipmentId))
        .orderBy(desc(equipmentMaintenanceHistory.performedAt));
      
      res.json(history);
    } catch (error) {
      next(error);
    }
  });

  // ============================================
  // EQUIPMENT RATE PROFILES
  // ============================================

  // Get rate profiles for equipment
  router.get("/api/equipment/:equipmentId/rate-profiles", async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.json([]);
      }
      
      const { equipmentId } = req.params;
      
      // SECURITY: Verify equipment belongs to user's org
      const equipConditions = [eq(equipment.id, equipmentId)];
      if (shouldFilter && orgId) {
        equipConditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [equipmentItem] = await db.select().from(equipment).where(and(...equipConditions)).limit(1);
      if (!equipmentItem) {
        return res.status(404).json({ error: "Equipment not found" });
      }
      
      const profiles = await db
        .select({
          id: equipmentRateProfiles.id,
          equipmentId: equipmentRateProfiles.equipmentId,
          hourlyRate: equipmentRateProfiles.hourlyRate,
          dailyRate: equipmentRateProfiles.dailyRate,
          weeklyRate: equipmentRateProfiles.weeklyRate,
          monthlyRate: equipmentRateProfiles.monthlyRate,
          fuelCostPerHour: equipmentRateProfiles.fuelCostPerHour,
          maintenanceCostPerHour: equipmentRateProfiles.maintenanceCostPerHour,
          operatorCostPerHour: equipmentRateProfiles.operatorCostPerHour,
          includesOperator: equipmentRateProfiles.includesOperator,
          effectiveDate: equipmentRateProfiles.effectiveDate,
          expirationDate: equipmentRateProfiles.expirationDate,
          isActive: equipmentRateProfiles.isActive,
          notes: equipmentRateProfiles.notes,
          createdAt: equipmentRateProfiles.createdAt,
          createdByName: sql<string>`COALESCE(${users.firstName} || ' ' || ${users.lastName}, 'System')`,
        })
        .from(equipmentRateProfiles)
        .leftJoin(users, eq(equipmentRateProfiles.createdById, users.id))
        .where(eq(equipmentRateProfiles.equipmentId, equipmentId))
        .orderBy(desc(equipmentRateProfiles.effectiveDate));
      
      res.json(profiles);
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/equipment/:equipmentId/active-rate", async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { equipmentId } = req.params;
      
      const equipConditions = [eq(equipment.id, equipmentId)];
      if (shouldFilter && orgId) {
        equipConditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [equipmentItem] = await db.select().from(equipment).where(and(...equipConditions)).limit(1);
      if (!equipmentItem) {
        return res.status(404).json({ error: "Equipment not found" });
      }
      
      const [activeProfile] = await db
        .select()
        .from(equipmentRateProfiles)
        .where(and(
          eq(equipmentRateProfiles.equipmentId, equipmentId),
          eq(equipmentRateProfiles.isActive, true)
        ))
        .orderBy(desc(equipmentRateProfiles.effectiveDate))
        .limit(1);
      
      if (!activeProfile) {
        return res.json(null);
      }
      
      res.json(activeProfile);
    } catch (error) {
      next(error);
    }
  });

  // Create rate profile for equipment
  router.post("/api/equipment/:equipmentId/rate-profiles", async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { equipmentId } = req.params;
      const userId = req.user?.id;
      
      // SECURITY: Verify equipment exists AND belongs to user's org
      const conditions = [eq(equipment.id, equipmentId)];
      if (shouldFilter && orgId) {
        conditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [equipmentItem] = await db.select().from(equipment).where(and(...conditions));
      if (!equipmentItem) {
        return res.status(404).json({ error: "Equipment not found" });
      }
      
      // Parse date strings to Date objects
      const bodyWithDates = {
        ...req.body,
        effectiveDate: req.body.effectiveDate ? new Date(req.body.effectiveDate) : undefined,
        endDate: req.body.endDate ? new Date(req.body.endDate) : undefined,
      };
      
      const validatedData = parseOrRespond(insertEquipmentRateProfileSchema, {
        ...bodyWithDates,
        equipmentId,
        createdById: userId,
      }, res);
      if (!validatedData) return;
      
      // If this is marked as active, deactivate other profiles
      if (validatedData.isActive) {
        await db.update(equipmentRateProfiles)
          .set({ isActive: false, updatedAt: new Date() })
          .where(and(
            eq(equipmentRateProfiles.equipmentId, equipmentId),
            eq(equipmentRateProfiles.isActive, true)
          ));
      }
      
      const [newProfile] = await db.insert(equipmentRateProfiles).values(validatedData).returning();
      
      await logCreate(userId!, "equipment_rate_profiles", newProfile.id, {
        equipmentId,
        hourlyRate: String(validatedData.hourlyRate),
      });
      
      res.status(201).json(newProfile);
    } catch (error) {
      logError("Create equipment rate profile error:", {}, error instanceof Error ? error : new Error(String(error)));
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid input", details: error.errors });
      }
      next(error);
    }
  });

  // Update rate profile
  router.patch("/api/equipment/:equipmentId/rate-profiles/:profileId", async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { equipmentId, profileId } = req.params;
      const userId = req.user?.id;
      
      // SECURITY: Verify equipment belongs to user's org
      const equipConditions = [eq(equipment.id, equipmentId)];
      if (shouldFilter && orgId) {
        equipConditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [equipmentItem] = await db.select().from(equipment).where(and(...equipConditions)).limit(1);
      if (!equipmentItem) {
        return res.status(404).json({ error: "Equipment not found" });
      }
      
      const [existingProfile] = await db.select().from(equipmentRateProfiles).where(
        and(
          eq(equipmentRateProfiles.id, profileId),
          eq(equipmentRateProfiles.equipmentId, equipmentId)
        )
      );
      if (!existingProfile) {
        return res.status(404).json({ error: "Rate profile not found" });
      }
      
      const updateSchema = insertEquipmentRateProfileSchema.omit({ equipmentId: true }).partial();
      const parseResult = updateSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: "Validation failed", details: parseResult.error.flatten().fieldErrors });
      }

      const updateData = {
        ...parseResult.data,
        updatedAt: new Date(),
      };
      
      if (updateData.isActive === true && !existingProfile.isActive) {
        await db.update(equipmentRateProfiles)
          .set({ isActive: false, updatedAt: new Date() })
          .where(and(
            eq(equipmentRateProfiles.equipmentId, equipmentId),
            eq(equipmentRateProfiles.isActive, true)
          ));
      }
      
      const [updatedProfile] = await db.update(equipmentRateProfiles)
        .set(updateData)
        .where(eq(equipmentRateProfiles.id, profileId))
        .returning();
      
      await logUpdate(userId!, "equipment_rate_profiles", profileId, existingProfile, updateData);
      
      res.json(updatedProfile);
    } catch (error) {
      next(error);
    }
  });

  // Activate rate profile (deactivates others for same equipment)
  router.post("/api/equipment/:equipmentId/rate-profiles/:profileId/activate", async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { equipmentId, profileId } = req.params;
      const userId = req.user?.id;
      
      // SECURITY: Verify equipment belongs to user's org
      const equipConditions = [eq(equipment.id, equipmentId)];
      if (shouldFilter && orgId) {
        equipConditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [equipmentItem] = await db.select().from(equipment).where(and(...equipConditions)).limit(1);
      if (!equipmentItem) {
        return res.status(404).json({ error: "Equipment not found" });
      }
      
      const [existingProfile] = await db.select().from(equipmentRateProfiles).where(
        and(
          eq(equipmentRateProfiles.id, profileId),
          eq(equipmentRateProfiles.equipmentId, equipmentId)
        )
      );
      if (!existingProfile) {
        return res.status(404).json({ error: "Rate profile not found" });
      }
      
      // Deactivate all other profiles for this equipment
      await db.update(equipmentRateProfiles)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(
          eq(equipmentRateProfiles.equipmentId, equipmentId),
          eq(equipmentRateProfiles.isActive, true)
        ));
      
      // Activate the selected profile
      const [updatedProfile] = await db.update(equipmentRateProfiles)
        .set({ isActive: true, updatedAt: new Date() })
        .where(eq(equipmentRateProfiles.id, profileId))
        .returning();
      
      await logUpdate(userId!, "equipment_rate_profiles", profileId, existingProfile, { isActive: true });
      
      res.json(updatedProfile);
    } catch (error) {
      next(error);
    }
  });

  // Delete rate profile
  router.delete("/api/equipment/rate-profiles/:profileId", async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { profileId } = req.params;
      const userId = req.user?.id;
      
      // SECURITY: Join to equipment to verify rate profile belongs to user's org
      const profileWithEquip = await db
        .select({
          profileId: equipmentRateProfiles.id,
          equipmentId: equipmentRateProfiles.equipmentId,
          organizationId: equipment.organizationId,
        })
        .from(equipmentRateProfiles)
        .innerJoin(equipment, eq(equipmentRateProfiles.equipmentId, equipment.id))
        .where(eq(equipmentRateProfiles.id, profileId))
        .limit(1);
      
      if (profileWithEquip.length === 0) {
        return res.status(404).json({ error: "Rate profile not found" });
      }
      
      // SECURITY: Verify equipment belongs to user's org
      if (shouldFilter && orgId && profileWithEquip[0].organizationId !== orgId) {
        return res.status(404).json({ error: "Rate profile not found" });
      }
      
      await db.delete(equipmentRateProfiles).where(eq(equipmentRateProfiles.id, profileId));
      
      await logDelete(userId!, "equipment_rate_profiles", profileId, { deleted: true });
      
      res.json({ message: "Rate profile deleted successfully" });
    } catch (error) {
      next(error);
    }
  });

// ========================================
// Routes from rentalEquipmentRoutes.ts
// ========================================

// ============================================
  // RENTAL VENDORS
  // ============================================

  router.get("/api/rental-vendors", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.json([]);
      }
      
      const conditions = [];
      if (shouldFilter && orgId) {
        conditions.push(eq(rentalVendors.organizationId, orgId));
      }
      
      const vendors = await db
        .select()
        .from(rentalVendors)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(rentalVendors.name);
      
      res.json(vendors);
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/rental-vendors/:id", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(404).json({ error: "Rental vendor not found" });
      }
      
      const { id } = req.params;
      
      const conditions = [eq(rentalVendors.id, id)];
      if (shouldFilter && orgId) {
        conditions.push(eq(rentalVendors.organizationId, orgId));
      }
      
      const [vendor] = await db.select().from(rentalVendors).where(and(...conditions));
      
      if (!vendor) {
        return res.status(404).json({ error: "Rental vendor not found" });
      }
      
      res.json(vendor);
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/rental-vendors", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const userId = req.user?.id;
      
      const validatedData = parseOrRespond(insertRentalVendorSchema, req.body, res);
      if (!validatedData) return;
      
      const dataWithOrg = {
        ...validatedData,
        organizationId: shouldFilter && orgId ? orgId : (validatedData.organizationId || "tfr-default-org"),
      };
      
      const [newVendor] = await db.insert(rentalVendors).values(dataWithOrg).returning();
      
      await logCreate(userId!, "rental_vendors", newVendor.id, { name: validatedData.name });
      
      res.status(201).json(newVendor);
    } catch (error) {
      logError("Create rental vendor error:", {}, error instanceof Error ? error : new Error(String(error)));
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid input", details: error.errors });
      }
      next(error);
    }
  });

  router.patch("/api/rental-vendors/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { id } = req.params;
      const userId = req.user?.id;
      
      const conditions = [eq(rentalVendors.id, id)];
      if (shouldFilter && orgId) {
        conditions.push(eq(rentalVendors.organizationId, orgId));
      }
      
      const [existing] = await db.select().from(rentalVendors).where(and(...conditions));
      if (!existing) {
        return res.status(404).json({ error: "Rental vendor not found" });
      }
      
      const updateSchema = insertRentalVendorSchema.omit({ organizationId: true }).partial();
      const parseResult = updateSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: "Validation failed", details: parseResult.error.flatten().fieldErrors });
      }

      const [updated] = await db.update(rentalVendors)
        .set({ ...parseResult.data, updatedAt: new Date() })
        .where(and(...conditions))
        .returning();
      
      await logUpdate(userId!, "rental_vendors", id, existing, parseResult.data);
      
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  router.delete("/api/rental-vendors/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { id } = req.params;
      const userId = req.user?.id;
      
      const conditions = [eq(rentalVendors.id, id)];
      if (shouldFilter && orgId) {
        conditions.push(eq(rentalVendors.organizationId, orgId));
      }
      
      const [existing] = await db.select().from(rentalVendors).where(and(...conditions));
      if (!existing) {
        return res.status(404).json({ error: "Rental vendor not found" });
      }
      
      await db.delete(rentalVendors).where(and(...conditions));
      
      await logDelete(userId!, "rental_vendors", id, { name: existing.name });
      
      res.json({ message: "Rental vendor deleted successfully" });
    } catch (error) {
      next(error);
    }
  });

  // ============================================
  // RENTAL EQUIPMENT CATALOG
  // ============================================

  router.get("/api/rental-vendors/:vendorId/catalog", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.json([]);
      }
      
      const { vendorId } = req.params;
      
      const vendorConditions = [eq(rentalVendors.id, vendorId)];
      if (shouldFilter && orgId) {
        vendorConditions.push(eq(rentalVendors.organizationId, orgId));
      }
      
      const [vendor] = await db.select().from(rentalVendors).where(and(...vendorConditions));
      if (!vendor) {
        return res.status(404).json({ error: "Rental vendor not found" });
      }
      
      const catalog = await db
        .select()
        .from(rentalEquipmentCatalog)
        .where(eq(rentalEquipmentCatalog.vendorId, vendorId))
        .orderBy(rentalEquipmentCatalog.equipmentType, rentalEquipmentCatalog.name);
      
      res.json(catalog);
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/rental-equipment", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.json([]);
      }
      
      const { type, vendorId } = req.query;
      
      const conditions = [eq(rentalEquipmentCatalog.isActive, true)];
      if (shouldFilter && orgId) {
        conditions.push(eq(rentalVendors.organizationId, orgId));
      }
      
      const results = await db
        .select({
          id: rentalEquipmentCatalog.id,
          name: rentalEquipmentCatalog.name,
          equipmentType: rentalEquipmentCatalog.equipmentType,
          make: rentalEquipmentCatalog.make,
          model: rentalEquipmentCatalog.model,
          hourlyRate: rentalEquipmentCatalog.hourlyRate,
          dailyRate: rentalEquipmentCatalog.dailyRate,
          weeklyRate: rentalEquipmentCatalog.weeklyRate,
          monthlyRate: rentalEquipmentCatalog.monthlyRate,
          deliveryFee: rentalEquipmentCatalog.deliveryFee,
          vendorId: rentalEquipmentCatalog.vendorId,
          vendorName: rentalVendors.name,
          vendorCode: rentalVendors.code,
          isActive: rentalEquipmentCatalog.isActive,
        })
        .from(rentalEquipmentCatalog)
        .innerJoin(rentalVendors, eq(rentalEquipmentCatalog.vendorId, rentalVendors.id))
        .where(and(...conditions))
        .orderBy(rentalEquipmentCatalog.equipmentType, rentalEquipmentCatalog.name);
      
      let filtered = results;
      if (type) {
        filtered = filtered.filter(r => r.equipmentType === type);
      }
      if (vendorId) {
        filtered = filtered.filter(r => r.vendorId === vendorId);
      }
      
      res.json(filtered);
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/rental-vendors/:vendorId/catalog", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { vendorId } = req.params;
      const userId = req.user?.id;
      
      const vendorConditions = [eq(rentalVendors.id, vendorId)];
      if (shouldFilter && orgId) {
        vendorConditions.push(eq(rentalVendors.organizationId, orgId));
      }
      
      const [vendor] = await db.select().from(rentalVendors).where(and(...vendorConditions));
      if (!vendor) {
        return res.status(404).json({ error: "Rental vendor not found" });
      }
      
      const validatedData = parseOrRespond(insertRentalEquipmentCatalogSchema, {
        ...req.body,
        vendorId,
      }, res);
      if (!validatedData) return;
      
      const [newItem] = await db.insert(rentalEquipmentCatalog).values(validatedData).returning();
      
      await logCreate(userId!, "rental_equipment_catalog", newItem.id, { name: validatedData.name, vendorId });
      
      res.status(201).json(newItem);
    } catch (error) {
      logError("Create rental equipment catalog item error:", {}, error instanceof Error ? error : new Error(String(error)));
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid input", details: error.errors });
      }
      next(error);
    }
  });

  router.patch("/api/rental-equipment/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { id } = req.params;
      const userId = req.user?.id;
      
      const catalogWithVendor = await db
        .select({
          catalogId: rentalEquipmentCatalog.id,
          vendorId: rentalEquipmentCatalog.vendorId,
          organizationId: rentalVendors.organizationId,
        })
        .from(rentalEquipmentCatalog)
        .innerJoin(rentalVendors, eq(rentalEquipmentCatalog.vendorId, rentalVendors.id))
        .where(eq(rentalEquipmentCatalog.id, id))
        .limit(1);
      
      if (catalogWithVendor.length === 0) {
        return res.status(404).json({ error: "Catalog item not found" });
      }
      
      if (shouldFilter && orgId && catalogWithVendor[0].organizationId !== orgId) {
        return res.status(404).json({ error: "Catalog item not found" });
      }
      
      const updateSchema = insertRentalEquipmentCatalogSchema.omit({ organizationId: true, vendorId: true }).partial();
      const parseResult = updateSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: "Validation failed", details: parseResult.error.flatten().fieldErrors });
      }

      const [updated] = await db.update(rentalEquipmentCatalog)
        .set({ ...parseResult.data, updatedAt: new Date() })
        .where(eq(rentalEquipmentCatalog.id, id))
        .returning();
      
      await logUpdate(userId!, "rental_equipment_catalog", id, catalogWithVendor[0], parseResult.data);
      
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  router.delete("/api/rental-equipment/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { id } = req.params;
      const userId = req.user?.id;
      
      const catalogWithVendor = await db
        .select({
          catalogId: rentalEquipmentCatalog.id,
          vendorId: rentalEquipmentCatalog.vendorId,
          organizationId: rentalVendors.organizationId,
        })
        .from(rentalEquipmentCatalog)
        .innerJoin(rentalVendors, eq(rentalEquipmentCatalog.vendorId, rentalVendors.id))
        .where(eq(rentalEquipmentCatalog.id, id))
        .limit(1);
      
      if (catalogWithVendor.length === 0) {
        return res.status(404).json({ error: "Catalog item not found" });
      }
      
      if (shouldFilter && orgId && catalogWithVendor[0].organizationId !== orgId) {
        return res.status(404).json({ error: "Catalog item not found" });
      }
      
      await db.delete(rentalEquipmentCatalog).where(eq(rentalEquipmentCatalog.id, id));
      
      await logDelete(userId!, "rental_equipment_catalog", id, { deleted: true });
      
      res.json({ message: "Catalog item deleted successfully" });
    } catch (error) {
      next(error);
    }
  });

// ========================================
// Routes from equipmentPlanRoutes.ts
// ========================================

// ============================================
  // PROJECT EQUIPMENT (assigned to project)
  // ============================================

  router.get("/api/projects/:projectId/equipment", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.json([]);
      }
      
      const { projectId } = req.params;
      
      const projectConditions = [eq(projects.id, projectId)];
      if (shouldFilter && orgId) {
        projectConditions.push(eq(projects.gcOrganizationId, orgId));
      }
      
      const [project] = await db.select().from(projects).where(and(...projectConditions));
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
      
      const equipmentConditions = [eq(equipmentAssignments.projectId, projectId)];
      if (shouldFilter && orgId) {
        equipmentConditions.push(eq(equipment.organizationId, orgId));
      }
      
      const projectEquipment = await db
        .select({
          assignmentId: equipmentAssignments.id,
          equipmentId: equipment.id,
          equipmentCode: equipment.equipmentCode,
          name: equipment.name,
          type: equipment.type,
          make: equipment.make,
          model: equipment.model,
          currentHours: equipment.currentHours,
          status: equipment.status,
          assignedAt: equipmentAssignments.assignedAt,
          expectedReturnDate: equipmentAssignments.expectedReturnDate,
          hoursAtAssignment: equipmentAssignments.hoursAtAssignment,
          isActive: equipmentAssignments.isActive,
        })
        .from(equipmentAssignments)
        .innerJoin(equipment, eq(equipmentAssignments.equipmentId, equipment.id))
        .where(and(...equipmentConditions))
        .orderBy(desc(equipmentAssignments.assignedAt));
      
      res.json(projectEquipment);
    } catch (error) {
      next(error);
    }
  });

  // ============================================
  // PROJECT EQUIPMENT PLANS
  // ============================================

  router.get("/api/projects/:projectId/equipment-plans", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.json([]);
      }
      
      const { projectId } = req.params;
      
      const projectConditions = [eq(projects.id, projectId)];
      if (shouldFilter && orgId) {
        projectConditions.push(eq(projects.gcOrganizationId, orgId));
      }
      
      const [project] = await db.select().from(projects).where(and(...projectConditions));
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
      
      const plans = await db
        .select()
        .from(projectEquipmentPlans)
        .where(eq(projectEquipmentPlans.projectId, projectId))
        .orderBy(projectEquipmentPlans.createdAt);
      
      res.json(plans);
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/projects/:projectId/equipment-plans", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { projectId } = req.params;
      const userId = req.user?.id;
      
      const projectConditions = [eq(projects.id, projectId)];
      if (shouldFilter && orgId) {
        projectConditions.push(eq(projects.gcOrganizationId, orgId));
      }
      
      const [project] = await db.select().from(projects).where(and(...projectConditions));
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
      
      const equipPlanCreateSchema = z.object({
        source: z.string().min(1, "Source is required"),
        equipmentName: z.string().min(1, "Equipment name is required"),
        equipmentType: z.string().min(1, "Equipment type is required"),
        equipmentId: z.string().nullish(),
        rentalCatalogId: z.string().nullish(),
        rentalVendorId: z.string().nullish(),
        plannedHours: z.coerce.number().nullish(),
        plannedDays: z.coerce.number().nullish(),
        plannedStartDate: z.string().nullish(),
        plannedEndDate: z.string().nullish(),
        plannedCost: z.coerce.number().nullish(),
        hourlyRate: z.coerce.number().nullish(),
        dailyRate: z.coerce.number().nullish(),
        notes: z.string().nullish(),
        costCode: z.string().nullish(),
      });
      const parsed = equipPlanCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }
      const body = parsed.data;
      
      const [newPlan] = await db.insert(projectEquipmentPlans).values({
        projectId,
        source: body.source as "OWNED" | "RENTAL",
        status: "PLANNED" as const,
        equipmentId: body.equipmentId || null,
        rentalCatalogId: body.rentalCatalogId || null,
        rentalVendorId: body.rentalVendorId || null,
        equipmentName: body.equipmentName,
        equipmentType: body.equipmentType,
        plannedHours: body.plannedHours != null ? String(body.plannedHours) : null,
        plannedDays: body.plannedDays != null ? Number(body.plannedDays) : null,
        plannedStartDate: body.plannedStartDate ? new Date(body.plannedStartDate) : null,
        plannedEndDate: body.plannedEndDate ? new Date(body.plannedEndDate) : null,
        plannedCost: body.plannedCost != null ? String(body.plannedCost) : null,
        hourlyRate: body.hourlyRate != null ? String(body.hourlyRate) : null,
        dailyRate: body.dailyRate != null ? String(body.dailyRate) : null,
        notes: body.notes || null,
        costCode: body.costCode || null,
        createdById: userId!,
      }).returning();
      
      await logCreate(userId!, "project_equipment_plans", newPlan.id, { projectId, equipmentName: req.body.equipmentName });
      
      res.status(201).json(newPlan);
    } catch (error) {
      next(error);
    }
  });

  router.patch("/api/projects/:projectId/equipment-plans/:planId", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { projectId, planId } = req.params;
      const userId = req.user?.id;
      
      const projectConditions = [eq(projects.id, projectId)];
      if (shouldFilter && orgId) {
        projectConditions.push(eq(projects.gcOrganizationId, orgId));
      }
      
      const [project] = await db.select().from(projects).where(and(...projectConditions));
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
      
      const planConditions = and(
        eq(projectEquipmentPlans.id, planId),
        eq(projectEquipmentPlans.projectId, projectId)
      );
      
      const [existing] = await db.select()
        .from(projectEquipmentPlans)
        .where(planConditions);
      
      if (!existing) {
        return res.status(404).json({ error: "Equipment plan not found" });
      }
      
      const equipPlanUpdateSchema = z.object({
        source: z.string().min(1).optional(),
        status: z.string().optional(),
        equipmentId: z.string().nullish(),
        assignmentId: z.string().nullish(),
        rentalCatalogId: z.string().nullish(),
        rentalVendorId: z.string().nullish(),
        equipmentName: z.string().min(1).optional(),
        equipmentType: z.string().min(1).optional(),
        plannedHours: z.coerce.number().nullish(),
        plannedDays: z.coerce.number().nullish(),
        plannedStartDate: z.string().nullish(),
        plannedEndDate: z.string().nullish(),
        plannedCost: z.coerce.number().nullish(),
        actualHours: z.coerce.number().nullish(),
        actualDays: z.coerce.number().nullish(),
        actualStartDate: z.string().nullish(),
        actualEndDate: z.string().nullish(),
        actualCost: z.coerce.number().nullish(),
        hourlyRate: z.coerce.number().nullish(),
        dailyRate: z.coerce.number().nullish(),
        rentalConfirmationNumber: z.string().nullish(),
        notes: z.string().nullish(),
        costCode: z.string().nullish(),
      });
      const parsed = equipPlanUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }
      const body = parsed.data;

      const updateData: Record<string, any> = { updatedAt: new Date() };
      if (body.source !== undefined) updateData.source = body.source;
      if (body.status !== undefined) updateData.status = body.status;
      if (body.equipmentId !== undefined) updateData.equipmentId = body.equipmentId || null;
      if (body.assignmentId !== undefined) updateData.assignmentId = body.assignmentId || null;
      if (body.rentalCatalogId !== undefined) updateData.rentalCatalogId = body.rentalCatalogId || null;
      if (body.rentalVendorId !== undefined) updateData.rentalVendorId = body.rentalVendorId || null;
      if (body.equipmentName !== undefined) updateData.equipmentName = body.equipmentName;
      if (body.equipmentType !== undefined) updateData.equipmentType = body.equipmentType;
      if (body.plannedHours !== undefined) updateData.plannedHours = body.plannedHours != null ? String(body.plannedHours) : null;
      if (body.plannedDays !== undefined) updateData.plannedDays = body.plannedDays != null ? Number(body.plannedDays) : null;
      if (body.plannedStartDate !== undefined) updateData.plannedStartDate = body.plannedStartDate ? new Date(body.plannedStartDate) : null;
      if (body.plannedEndDate !== undefined) updateData.plannedEndDate = body.plannedEndDate ? new Date(body.plannedEndDate) : null;
      if (body.plannedCost !== undefined) updateData.plannedCost = body.plannedCost != null ? String(body.plannedCost) : null;
      if (body.actualHours !== undefined) updateData.actualHours = body.actualHours != null ? String(body.actualHours) : null;
      if (body.actualDays !== undefined) updateData.actualDays = body.actualDays != null ? Number(body.actualDays) : null;
      if (body.actualStartDate !== undefined) updateData.actualStartDate = body.actualStartDate ? new Date(body.actualStartDate) : null;
      if (body.actualEndDate !== undefined) updateData.actualEndDate = body.actualEndDate ? new Date(body.actualEndDate) : null;
      if (body.actualCost !== undefined) updateData.actualCost = body.actualCost != null ? String(body.actualCost) : null;
      if (body.hourlyRate !== undefined) updateData.hourlyRate = body.hourlyRate != null ? String(body.hourlyRate) : null;
      if (body.dailyRate !== undefined) updateData.dailyRate = body.dailyRate != null ? String(body.dailyRate) : null;
      if (body.rentalConfirmationNumber !== undefined) updateData.rentalConfirmationNumber = body.rentalConfirmationNumber || null;
      if (body.notes !== undefined) updateData.notes = body.notes || null;
      if (body.costCode !== undefined) updateData.costCode = body.costCode || null;
      
      const [updated] = await db
        .update(projectEquipmentPlans)
        .set(updateData)
        .where(planConditions)
        .returning();
      
      await logUpdate(userId!, "project_equipment_plans", planId, existing, updated);

      if (req.body.actualCost !== undefined) {
        try {
          const { voidByReference, postTransaction } = await import("./costEngineService");
          const referenceId = `equipment_plan:${updated.id}`;
          await voidByReference(referenceId, userId || "system", "Equipment actual cost updated");

          const newCost = parseFloat(updated.actualCost || "0");
          if (newCost > 0) {
            await postTransaction({
              projectId,
              costCode: updated.costCode || "UNASSIGNED",
              sourceCategory: "EQUIPMENT",
              originModule: "EQUIPMENT",
              amount: updated.actualCost!,
              transactionDate: new Date().toISOString().split("T")[0],
              referenceId,
              description: "Equipment actual cost",
              createdBy: userId || undefined,
            });
          }
        } catch (emitErr) {
          logError("Failed to post equipment cost transaction:", {}, emitErr instanceof Error ? emitErr : new Error(String(emitErr)));
        }
      }

      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  router.delete("/api/projects/:projectId/equipment-plans/:planId", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { projectId, planId } = req.params;
      const userId = req.user?.id;
      
      const projectConditions = [eq(projects.id, projectId)];
      if (shouldFilter && orgId) {
        projectConditions.push(eq(projects.gcOrganizationId, orgId));
      }
      
      const [project] = await db.select().from(projects).where(and(...projectConditions));
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
      
      const planConditions = and(
        eq(projectEquipmentPlans.id, planId),
        eq(projectEquipmentPlans.projectId, projectId)
      );
      
      const [existing] = await db.select()
        .from(projectEquipmentPlans)
        .where(planConditions);
      
      if (!existing) {
        return res.status(404).json({ error: "Equipment plan not found" });
      }
      
      await db.delete(projectEquipmentPlans).where(planConditions);
      
      await logDelete(userId!, "project_equipment_plans", planId, { equipmentName: existing.equipmentName });
      
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  // ============================================
  // GET EQUIPMENT ASSIGNED TO PROJECT (for project detail page)
  // ============================================

  router.get("/api/projects/:projectId/assigned-equipment", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res, next) => {
    try {
      const { projectId } = req.params;
      
      const assignedEquipment = await db
        .select({
          id: equipment.id,
          equipmentCode: equipment.equipmentCode,
          name: equipment.name,
          type: equipment.type,
          make: equipment.make,
          model: equipment.model,
          year: equipment.year,
          status: equipment.status,
          currentHours: equipment.currentHours,
          assignedAt: equipmentAssignments.assignedAt,
          expectedReturnDate: equipmentAssignments.expectedReturnDate,
          assignmentId: equipmentAssignments.id,
          assignmentNotes: equipmentAssignments.notes,
        })
        .from(equipmentAssignments)
        .innerJoin(equipment, eq(equipmentAssignments.equipmentId, equipment.id))
        .where(and(
          eq(equipmentAssignments.projectId, projectId),
          eq(equipmentAssignments.isActive, true)
        ))
        .orderBy(equipment.name);
      
      res.json(assignedEquipment);
    } catch (error) {
      next(error);
    }
  });

  // ============================================
  // BID EQUIPMENT SELECTIONS
  // ============================================

  router.get("/api/bids/:bidId/equipment", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT"), async (req: AuthRequest, res, next) => {
    try {
      const { bidId } = req.params;
      
      const [bid] = await db.select().from(bids).where(eq(bids.id, bidId)).limit(1);
      if (!bid) {
        return res.status(404).json({ error: "Bid not found" });
      }

      if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;
      
      const selections = await db
        .select()
        .from(bidEquipmentSelections)
        .where(eq(bidEquipmentSelections.bidId, bidId))
        .orderBy(bidEquipmentSelections.createdAt);
      
      res.json(selections);
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/bids/:bidId/equipment", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
    try {
      const { bidId } = req.params;
      const userId = req.user?.id;
      
      const [bid] = await db.select().from(bids).where(eq(bids.id, bidId)).limit(1);
      if (!bid) {
        return res.status(404).json({ error: "Bid not found" });
      }

      if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;
      
      const bidEquipCreateSchema = z.object({
        source: z.string().min(1, "Source is required"),
        equipmentName: z.string().min(1, "Equipment name is required"),
        equipmentType: z.string().min(1, "Equipment type is required"),
        equipmentId: z.string().nullish(),
        rentalCatalogId: z.string().nullish(),
        rentalVendorId: z.string().nullish(),
        plannedHours: z.coerce.number().nullish(),
        plannedDays: z.coerce.number().nullish(),
        hourlyRate: z.coerce.number().nullish(),
        dailyRate: z.coerce.number().nullish(),
        weeklyRate: z.coerce.number().nullish(),
        estimatedCost: z.coerce.number().nullish(),
        deliveryFee: z.coerce.number().nullish(),
        notes: z.string().nullish(),
      });
      const parsed = bidEquipCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }
      const body = parsed.data;
      
      const insertData = {
        bidId,
        source: body.source as "OWNED" | "RENTAL",
        equipmentId: body.equipmentId || null,
        rentalCatalogId: body.rentalCatalogId || null,
        rentalVendorId: body.rentalVendorId || null,
        equipmentName: body.equipmentName,
        equipmentType: body.equipmentType,
        plannedHours: body.plannedHours != null ? String(body.plannedHours) : null,
        plannedDays: body.plannedDays != null ? Number(body.plannedDays) : null,
        hourlyRate: body.hourlyRate != null ? String(body.hourlyRate) : null,
        dailyRate: body.dailyRate != null ? String(body.dailyRate) : null,
        weeklyRate: body.weeklyRate != null ? String(body.weeklyRate) : null,
        estimatedCost: body.estimatedCost != null ? String(body.estimatedCost) : null,
        deliveryFee: body.deliveryFee != null ? String(body.deliveryFee) : null,
        notes: body.notes || null,
        createdById: userId,
      };
      
      const [newSelection] = await db.insert(bidEquipmentSelections).values(insertData).returning();
      
      await logCreate(userId!, "bid_equipment_selections", newSelection.id, { bidId, equipmentName: insertData.equipmentName });
      
      res.status(201).json(newSelection);
    } catch (error) {
      next(error);
    }
  });

  router.patch("/api/bids/:bidId/equipment/:selectionId", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
    try {
      const { bidId, selectionId } = req.params;
      const userId = req.user?.id;
      
      const [bid] = await db.select().from(bids).where(eq(bids.id, bidId)).limit(1);
      if (!bid) {
        return res.status(404).json({ error: "Bid not found" });
      }

      if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;
      
      const selectionConditions = and(
        eq(bidEquipmentSelections.id, selectionId),
        eq(bidEquipmentSelections.bidId, bidId)
      );
      
      const [existing] = await db.select()
        .from(bidEquipmentSelections)
        .where(selectionConditions);
      
      if (!existing) {
        return res.status(404).json({ error: "Equipment selection not found" });
      }
      
      const bidEquipUpdateSchema = z.object({
        source: z.string().min(1).optional(),
        equipmentId: z.string().nullish(),
        rentalCatalogId: z.string().nullish(),
        rentalVendorId: z.string().nullish(),
        equipmentName: z.string().min(1).optional(),
        equipmentType: z.string().min(1).optional(),
        plannedHours: z.coerce.number().nullish(),
        plannedDays: z.coerce.number().nullish(),
        hourlyRate: z.coerce.number().nullish(),
        dailyRate: z.coerce.number().nullish(),
        weeklyRate: z.coerce.number().nullish(),
        estimatedCost: z.coerce.number().nullish(),
        deliveryFee: z.coerce.number().nullish(),
        notes: z.string().nullish(),
      });
      const parsed = bidEquipUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }
      const body = parsed.data;

      const updateData: Record<string, any> = { updatedAt: new Date() };
      if (body.source !== undefined) updateData.source = body.source;
      if (body.equipmentId !== undefined) updateData.equipmentId = body.equipmentId || null;
      if (body.rentalCatalogId !== undefined) updateData.rentalCatalogId = body.rentalCatalogId || null;
      if (body.rentalVendorId !== undefined) updateData.rentalVendorId = body.rentalVendorId || null;
      if (body.equipmentName !== undefined) updateData.equipmentName = body.equipmentName;
      if (body.equipmentType !== undefined) updateData.equipmentType = body.equipmentType;
      if (body.plannedHours !== undefined) updateData.plannedHours = body.plannedHours != null ? String(body.plannedHours) : null;
      if (body.plannedDays !== undefined) updateData.plannedDays = body.plannedDays != null ? Number(body.plannedDays) : null;
      if (body.hourlyRate !== undefined) updateData.hourlyRate = body.hourlyRate != null ? String(body.hourlyRate) : null;
      if (body.dailyRate !== undefined) updateData.dailyRate = body.dailyRate != null ? String(body.dailyRate) : null;
      if (body.weeklyRate !== undefined) updateData.weeklyRate = body.weeklyRate != null ? String(body.weeklyRate) : null;
      if (body.estimatedCost !== undefined) updateData.estimatedCost = body.estimatedCost != null ? String(body.estimatedCost) : null;
      if (body.deliveryFee !== undefined) updateData.deliveryFee = body.deliveryFee != null ? String(body.deliveryFee) : null;
      if (body.notes !== undefined) updateData.notes = body.notes || null;
      
      const [updated] = await db.update(bidEquipmentSelections)
        .set(updateData)
        .where(selectionConditions)
        .returning();
      
      await logUpdate(userId!, "bid_equipment_selections", selectionId, existing, req.body);
      
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  router.delete("/api/bids/:bidId/equipment/:selectionId", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
    try {
      const { bidId, selectionId } = req.params;
      const userId = req.user?.id;
      
      const [bid] = await db.select().from(bids).where(eq(bids.id, bidId)).limit(1);
      if (!bid) {
        return res.status(404).json({ error: "Bid not found" });
      }

      if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;
      
      const selectionConditions = and(
        eq(bidEquipmentSelections.id, selectionId),
        eq(bidEquipmentSelections.bidId, bidId)
      );
      
      const [existing] = await db.select()
        .from(bidEquipmentSelections)
        .where(selectionConditions);
      
      if (!existing) {
        return res.status(404).json({ error: "Equipment selection not found" });
      }
      
      await db.delete(bidEquipmentSelections).where(selectionConditions);
      
      await logDelete(userId!, "bid_equipment_selections", selectionId, { equipmentName: existing.equipmentName });
      
      res.json({ message: "Equipment selection deleted successfully" });
    } catch (error) {
      next(error);
    }
  });

  // ============================================
  // EQUIPMENT FOR SELECTION (owned + rental)
  // ============================================

  router.get("/api/equipment-for-selection", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT"), async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.json({ owned: [], rental: [] });
      }
      
      const equipConditions = [ne(equipment.status, "RETIRED")];
      if (shouldFilter && orgId) {
        equipConditions.push(eq(equipment.organizationId, orgId));
      }
      
      const ownedEquipment = await db
        .select({
          id: equipment.id,
          equipmentCode: equipment.equipmentCode,
          name: equipment.name,
          type: equipment.type,
          make: equipment.make,
          model: equipment.model,
          status: equipment.status,
          hourlyRate: equipmentRateProfiles.hourlyRate,
          dailyRate: equipmentRateProfiles.dailyRate,
          weeklyRate: equipmentRateProfiles.weeklyRate,
          monthlyRate: equipmentRateProfiles.monthlyRate,
        })
        .from(equipment)
        .leftJoin(equipmentRateProfiles, and(
          eq(equipmentRateProfiles.equipmentId, equipment.id),
          eq(equipmentRateProfiles.isActive, true)
        ))
        .where(and(...equipConditions))
        .orderBy(equipment.type, equipment.name);
      
      const rentalConditions = [
        eq(rentalEquipmentCatalog.isActive, true),
        eq(rentalVendors.isActive, true)
      ];
      if (shouldFilter && orgId) {
        rentalConditions.push(eq(rentalVendors.organizationId, orgId));
      }
      
      const rentalCatalog = await db
        .select({
          id: rentalEquipmentCatalog.id,
          vendorId: rentalEquipmentCatalog.vendorId,
          name: rentalEquipmentCatalog.name,
          equipmentType: rentalEquipmentCatalog.equipmentType,
          make: rentalEquipmentCatalog.make,
          model: rentalEquipmentCatalog.model,
          hourlyRate: rentalEquipmentCatalog.hourlyRate,
          dailyRate: rentalEquipmentCatalog.dailyRate,
          weeklyRate: rentalEquipmentCatalog.weeklyRate,
          monthlyRate: rentalEquipmentCatalog.monthlyRate,
          deliveryFee: rentalEquipmentCatalog.deliveryFee,
          vendorName: rentalVendors.name,
          vendorCode: rentalVendors.code,
        })
        .from(rentalEquipmentCatalog)
        .innerJoin(rentalVendors, eq(rentalEquipmentCatalog.vendorId, rentalVendors.id))
        .where(and(...rentalConditions))
        .orderBy(rentalEquipmentCatalog.equipmentType, rentalEquipmentCatalog.name);
      
      res.json({
        owned: ownedEquipment,
        rental: rentalCatalog,
      });
    } catch (error) {
      next(error);
    }
  });

  // ============================================
  // EQUIPMENT REPAIRS
  // ============================================

  // Get equipment repairs
  router.get("/api/equipment/:equipmentId/repairs", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.json([]);
      }
      
      const { equipmentId } = req.params;
      
      const equipConditions = [eq(equipment.id, equipmentId)];
      if (shouldFilter && orgId) {
        equipConditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [equipmentItem] = await db.select().from(equipment).where(and(...equipConditions)).limit(1);
      if (!equipmentItem) {
        return res.status(404).json({ error: "Equipment not found" });
      }
      
      const repairs = await db
        .select({
          id: equipmentRepairs.id,
          repairNumber: equipmentRepairs.repairNumber,
          description: equipmentRepairs.description,
          status: equipmentRepairs.status,
          problemReportedAt: equipmentRepairs.problemReportedAt,
          problemDescription: equipmentRepairs.problemDescription,
          repairLocation: equipmentRepairs.repairLocation,
          estimatedCost: equipmentRepairs.estimatedCost,
          actualCost: equipmentRepairs.actualCost,
          estimatedCompletionDate: equipmentRepairs.estimatedCompletionDate,
          completedAt: equipmentRepairs.completedAt,
          repairNotes: equipmentRepairs.repairNotes,
          createdAt: equipmentRepairs.createdAt,
          reportedByName: sql<string>`reporter.first_name || ' ' || reporter.last_name`,
        })
        .from(equipmentRepairs)
        .innerJoin(sql`users as reporter`, sql`${equipmentRepairs.problemReportedById} = reporter.id`)
        .where(eq(equipmentRepairs.equipmentId, equipmentId))
        .orderBy(desc(equipmentRepairs.problemReportedAt));
      
      res.json(repairs);
    } catch (error) {
      next(error);
    }
  });

  // Report equipment repair
  router.post("/api/equipment/:equipmentId/repairs", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { equipmentId } = req.params;
      const { description, problemDescription, repairLocation, estimatedCost, estimatedCompletionDate } = req.body;
      
      const conditions = [eq(equipment.id, equipmentId)];
      if (shouldFilter && orgId) {
        conditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [equipmentItem] = await db.select().from(equipment).where(and(...conditions));
      if (!equipmentItem) {
        res.status(404).json({ error: "Equipment not found" });
        return;
      }
      
      const lastRepair = await db
        .select({ repairNumber: equipmentRepairs.repairNumber })
        .from(equipmentRepairs)
        .orderBy(desc(equipmentRepairs.createdAt))
        .limit(1);
      
      let nextNumber = 1;
      if (lastRepair.length > 0) {
        const match = lastRepair[0].repairNumber.match(/REP-(\d+)/);
        if (match) {
          nextNumber = parseInt(match[1], 10) + 1;
        }
      }
      const repairNumber = `REP-${String(nextNumber).padStart(4, '0')}`;
      
      const [repair] = await db.insert(equipmentRepairs).values({
        equipmentId,
        repairNumber,
        description,
        status: "PENDING",
        problemReportedById: req.user!.id,
        problemDescription,
        hoursAtReport: equipmentItem.currentHours,
        repairLocation,
        estimatedCost,
        estimatedCompletionDate: estimatedCompletionDate || null,
      }).returning();
      
      await db.update(equipment).set({
        status: "IN_REPAIR",
        updatedAt: new Date(),
      }).where(eq(equipment.id, equipmentId));
      
      res.status(201).json(repair);
    } catch (error) {
      next(error);
    }
  });

  // Update repair status
  router.patch("/api/equipment/repairs/:repairId", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { repairId } = req.params;
      const updates = req.body;
      
      const [repair] = await db.select().from(equipmentRepairs).where(eq(equipmentRepairs.id, repairId));
      if (!repair) {
        res.status(404).json({ error: "Repair not found" });
        return;
      }
      
      const equipConditions = [eq(equipment.id, repair.equipmentId)];
      if (shouldFilter && orgId) {
        equipConditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [equipmentItem] = await db.select().from(equipment).where(and(...equipConditions)).limit(1);
      if (!equipmentItem) {
        return res.status(404).json({ error: "Equipment not found" });
      }
      
      if (updates.status === "COMPLETED" && repair.status !== "COMPLETED") {
        updates.completedAt = new Date();
        updates.completedById = req.user!.id;
        
        await db.update(equipment).set({
          status: "AVAILABLE",
          updatedAt: new Date(),
        }).where(eq(equipment.id, repair.equipmentId));
      }
      
      const [updated] = await db
        .update(equipmentRepairs)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(equipmentRepairs.id, repairId))
        .returning();
      
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  // ============================================
  // EQUIPMENT USAGE TRACKING (Hour Logs, AI, Notifications)
  // ============================================

  // Submit weekly hour log for equipment
  router.post("/api/equipment/:equipmentId/hour-logs", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { equipmentId } = req.params;
      const { projectId, weekStartDate, weekEndDate, startingHours, endingHours, notes, fuelUsed } = req.body;
      
      const equipConditions = [eq(equipment.id, equipmentId)];
      if (shouldFilter && orgId) {
        equipConditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [equipmentItem] = await db.select().from(equipment).where(and(...equipConditions)).limit(1);
      if (!equipmentItem) {
        return res.status(404).json({ error: "Equipment not found" });
      }
      
      const hoursUsed = (parseFloat(endingHours) - parseFloat(startingHours)).toString();
      
      const [assignment] = await db
        .select()
        .from(equipmentAssignments)
        .where(and(
          eq(equipmentAssignments.equipmentId, equipmentId),
          eq(equipmentAssignments.projectId, projectId),
          eq(equipmentAssignments.isActive, true)
        ));
      
      const [log] = await db.insert(equipmentHourLogs).values({
        equipmentId,
        assignmentId: assignment?.id,
        projectId,
        weekStartDate,
        weekEndDate,
        startingHours,
        endingHours,
        hoursUsed,
        submittedById: req.user!.id,
        notes: notes || null,
        fuelUsed: fuelUsed && fuelUsed !== "" ? fuelUsed : null,
      }).returning();
      
      await db.update(equipment).set({
        currentHours: endingHours,
        updatedAt: new Date(),
      }).where(eq(equipment.id, equipmentId));
      
      res.status(201).json(log);
    } catch (error: any) {
      logError("Submit hour log error:", {}, error instanceof Error ? error : new Error(String(error)));
      if (error.constraint === "equipment_hour_logs_unique_week") {
        res.status(400).json({ error: "Hour log already exists for this week" });
        return;
      }
      next(error);
    }
  });

  // Get hour logs for equipment
  router.get("/api/equipment/:equipmentId/hour-logs", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res, next) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.json([]);
      }
      
      const { equipmentId } = req.params;
      
      const equipConditions = [eq(equipment.id, equipmentId)];
      if (shouldFilter && orgId) {
        equipConditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [equipmentItem] = await db.select().from(equipment).where(and(...equipConditions)).limit(1);
      if (!equipmentItem) {
        return res.status(404).json({ error: "Equipment not found" });
      }
      
      const logs = await db
        .select({
          id: equipmentHourLogs.id,
          weekStartDate: equipmentHourLogs.weekStartDate,
          weekEndDate: equipmentHourLogs.weekEndDate,
          startingHours: equipmentHourLogs.startingHours,
          endingHours: equipmentHourLogs.endingHours,
          hoursUsed: equipmentHourLogs.hoursUsed,
          notes: equipmentHourLogs.notes,
          fuelUsed: equipmentHourLogs.fuelUsed,
          submittedAt: equipmentHourLogs.submittedAt,
          projectName: projects.name,
          projectCode: projects.code,
        })
        .from(equipmentHourLogs)
        .innerJoin(projects, eq(equipmentHourLogs.projectId, projects.id))
        .where(eq(equipmentHourLogs.equipmentId, equipmentId))
        .orderBy(desc(equipmentHourLogs.weekStartDate));
      
      res.json(logs);
    } catch (error) {
      next(error);
    }
  });

  // AI-powered equipment maintenance recommendations
  router.post("/api/equipment/:equipmentId/ai-recommendations", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res, next) => {
    try {
      const { equipmentId } = req.params;
      const { problemDescription } = req.body;
      
      const [equipmentItem] = await db.select().from(equipment).where(eq(equipment.id, equipmentId));
      if (!equipmentItem) {
        res.status(404).json({ error: "Equipment not found" });
        return;
      }
      
      const repairHistory = await db
        .select()
        .from(equipmentRepairs)
        .where(eq(equipmentRepairs.equipmentId, equipmentId))
        .orderBy(desc(equipmentRepairs.problemReportedAt))
        .limit(10);
      
      const maintenanceHistory = await db
        .select()
        .from(equipmentMaintenanceHistory)
        .where(eq(equipmentMaintenanceHistory.equipmentId, equipmentId))
        .orderBy(desc(equipmentMaintenanceHistory.performedAt))
        .limit(10);
      
      const { openai, AI_MODEL_GPT5 } = await import('./ai/openaiClient');
      
      const equipOrgId = equipmentItem.organizationId || req.user?.organizationId || "system";

      const systemPrompt = `You are an expert equipment maintenance advisor for construction equipment. 
You provide practical, actionable recommendations for repairs and preventative maintenance.
Always respond in valid JSON format with the following structure:
{
  "recommendedTasks": [
    { "task": "Task description", "priority": "HIGH|MEDIUM|LOW", "estimatedCost": number, "estimatedHours": number }
  ],
  "recommendedParts": [
    { "part": "Part name", "quantity": number, "estimatedCost": number, "supplier": "Suggested supplier or 'OEM Dealer'" }
  ],
  "preventativeSchedule": [
    { "interval": "Hours or calendar interval", "task": "Maintenance task", "description": "Brief description" }
  ],
  "urgency": "CRITICAL|HIGH|MEDIUM|LOW",
  "estimatedTotalCost": number,
  "summary": "Brief summary of recommendations",
  "warningsOrNotes": ["Any important warnings or notes"]
}`;

      const userPrompt = `Equipment Details:
- Name: ${equipmentItem.name}
- Type: ${equipmentItem.type}
- Make: ${equipmentItem.make || 'Unknown'}
- Model: ${equipmentItem.model || 'Unknown'}
- Year: ${equipmentItem.year || 'Unknown'}
- Current Hours: ${equipmentItem.currentHours || 0}
- Last Maintenance: ${equipmentItem.lastMaintenanceDate ? new Date(equipmentItem.lastMaintenanceDate).toLocaleDateString() : 'Unknown'}

Problem Reported: ${problemDescription || 'General maintenance check requested'}

Recent Repair History (last 10):
${repairHistory.length > 0 
  ? repairHistory.map(r => `- ${r.description}: ${r.status} (Cost: ${r.actualCost || r.estimatedCost || 'Unknown'})`).join('\n')
  : 'No recent repairs'}

Recent Maintenance History (last 10):
${maintenanceHistory.length > 0
  ? maintenanceHistory.map(m => `- ${m.maintenanceType}: ${m.description || 'Completed'} at ${m.hoursAtMaintenance || 'Unknown'} hours`).join('\n')
  : 'No recent maintenance records'}

Please provide:
1. Recommended repair tasks based on the problem description
2. Parts that may be needed
3. Recommended preventative maintenance schedule for this equipment type
4. Urgency assessment
5. Cost estimates`;

      const { result: recommendations, blocked, reason } = await governedAiCall({
        orgId: equipOrgId,
        userId: req.user?.id || null,
        actionType: "equipment_ai_recommendations",
        inputRefs: { equipmentId, problemDescription: problemDescription?.substring(0, 200) },
        fn: async () => {
          const completion = await openai.chat.completions.create({
            model: AI_MODEL_GPT5,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            response_format: { type: 'json_object' },
            max_completion_tokens: 2048,
          });
          const content = completion.choices[0]?.message?.content;
          if (!content) {
            throw new Error('No response from OpenAI');
          }
          return {
            result: JSON.parse(content),
            completion,
          };
        },
      });

      if (blocked) {
        return res.status(429).json({ error: reason || "AI usage limit reached" });
      }

      res.json(recommendations);
    } catch (error) {
      next(error);
    }
  });

  // Notify maintenance managers about new repair/maintenance requests
  router.post("/api/equipment/notify-maintenance", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res, next) => {
    try {
      const { equipmentId, repairId, message, type } = req.body;
      const orgId = req.user!.organizationId;
      
      const maintenanceManagers = await db
        .select({ id: users.id })
        .from(users)
        .where(and(
          inArray(users.role, ["ADMIN", "MANAGER"]),
          eq(users.isActive, true)
        ));
      
      const adminsAndManagers = await db
        .select({ id: users.id })
        .from(users)
        .where(and(
          or(eq(users.role, "ADMIN"), eq(users.role, "MANAGER")),
          eq(users.isActive, true)
        ));
      
      const allRecipients = [...maintenanceManagers, ...adminsAndManagers];
      const uniqueRecipientIds = Array.from(new Set(allRecipients.map(r => r.id)));
      
      for (const recipientId of uniqueRecipientIds) {
        await insertNotification({
          userId: recipientId,
          organizationId: orgId,
          type: type === 'REPAIR' ? 'REPAIR_REQUEST' : 'MAINTENANCE_REQUEST',
          title: type === 'REPAIR' ? 'New Repair Request' : 'Maintenance Required',
          message,
          relatedEntityId: equipmentId,
          relatedEntityType: 'equipment',
        });
      }
      
      res.json({ success: true, notifiedCount: uniqueRecipientIds.length });
    } catch (error) {
      next(error);
    }
  });

  // ============================================================
  // DEPRECIATION ENDPOINTS
  // ============================================================

  router.get("/api/equipment/:equipmentId/depreciation", async (req: AuthRequest, res, next) => {
    try {
      const { equipmentId } = req.params;
      const orgId = req.user?.organizationId;
      if (!orgId) return res.status(403).json({ error: "Access denied - no organization" });
      const eq_item = await db.query.equipment.findFirst({
        where: and(eq(equipment.id, equipmentId), eq(equipment.organizationId, orgId)),
      });
      if (!eq_item) return res.status(404).json({ error: "Equipment not found" });

      const purchasePrice = parseFloat(eq_item.purchasePrice || "0");
      const salvageVal = parseFloat(eq_item.salvageValue || "0");
      const usefulLife = eq_item.usefulLifeYears || 0;
      const depMethod = eq_item.depreciationMethod || "STRAIGHT_LINE";
      const serviceDate = eq_item.inServiceDate || (eq_item.purchaseDate ? new Date(eq_item.purchaseDate).toISOString().slice(0, 10) : "");

      const result = calculateDepreciation({
        purchasePrice,
        salvageValue: salvageVal,
        usefulLifeYears: usefulLife,
        depreciationMethod: depMethod,
        inServiceDate: serviceDate,
      });

      res.json({
        configured: result.schedule.length > 0,
        ...result,
        accumulatedDepreciation: result.totalDepreciation,
      });
    } catch (error) {
      next(error);
    }
  });

  // ============================================================
  // FUEL LOG ENDPOINTS
  // ============================================================

  router.get("/api/equipment/:equipmentId/fuel-logs", async (req: AuthRequest, res, next) => {
    try {
      const { equipmentId } = req.params;
      const orgId = req.user?.organizationId;
      if (!orgId) return res.status(403).json({ error: "Access denied - no organization" });
      const eqCheck = await db.query.equipment.findFirst({
        where: and(eq(equipment.id, equipmentId), eq(equipment.organizationId, orgId)),
      });
      if (!eqCheck) return res.status(404).json({ error: "Equipment not found" });

      const logs = await db
        .select({
          id: equipmentFuelLogs.id,
          equipmentId: equipmentFuelLogs.equipmentId,
          projectId: equipmentFuelLogs.projectId,
          date: equipmentFuelLogs.date,
          gallons: equipmentFuelLogs.gallons,
          pricePerGallon: equipmentFuelLogs.pricePerGallon,
          totalCost: equipmentFuelLogs.totalCost,
          fuelType: equipmentFuelLogs.fuelType,
          meterReading: equipmentFuelLogs.meterReading,
          submittedById: equipmentFuelLogs.submittedById,
          notes: equipmentFuelLogs.notes,
          createdAt: equipmentFuelLogs.createdAt,
          projectName: projects.name,
          submittedByName: sql<string>`${users.firstName} || ' ' || ${users.lastName}`,
        })
        .from(equipmentFuelLogs)
        .leftJoin(projects, eq(equipmentFuelLogs.projectId, projects.id))
        .leftJoin(users, eq(equipmentFuelLogs.submittedById, users.id))
        .where(eq(equipmentFuelLogs.equipmentId, equipmentId))
        .orderBy(desc(equipmentFuelLogs.date));

      res.json(logs);
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/equipment/:equipmentId/fuel-logs", async (req: AuthRequest, res, next) => {
    try {
      const { equipmentId } = req.params;
      const userId = req.user!.id;
      const orgId = req.user?.organizationId;
      if (!orgId) return res.status(403).json({ error: "Access denied - no organization" });

      const eq_item = await db.query.equipment.findFirst({
        where: and(eq(equipment.id, equipmentId), eq(equipment.organizationId, orgId)),
      });
      if (!eq_item) return res.status(404).json({ error: "Equipment not found" });

      const fuelLogCreateSchema = z.object({
        date: z.string().min(1, "Date is required"),
        gallons: z.preprocess((v) => Number(v), z.number().positive("Gallons must be positive")),
        pricePerGallon: z.preprocess((v) => Number(v), z.number().positive("Price per gallon must be positive")),
        totalCost: z.preprocess((v) => v != null ? Number(v) : undefined, z.number().optional()),
        fuelType: z.enum(["DIESEL", "GASOLINE", "PROPANE", "ELECTRIC", "OTHER"]).default("DIESEL"),
        meterReading: z.preprocess((v) => v != null ? Number(v) : null, z.number().nullable().optional()),
        projectId: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
      });

      const parsed = fuelLogCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors });
      }
      const { date, gallons, pricePerGallon, totalCost, fuelType, meterReading, projectId, notes } = parsed.data;

      if (projectId) {
        const projectCheck = await db.query.projects.findFirst({
          where: and(eq(projects.id, projectId), eq(projects.gcOrganizationId, orgId)),
        });
        if (!projectCheck) return res.status(400).json({ error: "Invalid project" });
      }

      const computedTotal = totalCost || gallons * pricePerGallon;

      const [newLog] = await db.insert(equipmentFuelLogs).values({
        equipmentId,
        projectId: projectId || null,
        date,
        gallons: String(gallons),
        pricePerGallon: String(pricePerGallon),
        totalCost: String(computedTotal),
        fuelType,
        meterReading: meterReading ? String(meterReading) : null,
        submittedById: userId,
        notes: notes || null,
      }).returning();

      res.status(201).json(newLog);
    } catch (error) {
      next(error);
    }
  });

  router.patch("/api/equipment/fuel-logs/:logId", async (req: AuthRequest, res, next) => {
    try {
      const { logId } = req.params;
      const orgId = req.user?.organizationId;
      if (!orgId) return res.status(403).json({ error: "Access denied - no organization" });

      const log = await db.query.equipmentFuelLogs.findFirst({
        where: eq(equipmentFuelLogs.id, logId),
      });
      if (!log) return res.status(404).json({ error: "Fuel log not found" });

      const eqCheck = await db.query.equipment.findFirst({
        where: and(eq(equipment.id, log.equipmentId), eq(equipment.organizationId, orgId)),
      });
      if (!eqCheck) return res.status(403).json({ error: "Access denied" });

      const fuelLogUpdateSchema = z.object({
        date: z.string().min(1).optional(),
        gallons: z.preprocess((v) => v != null ? Number(v) : undefined, z.number().positive("Gallons must be positive").optional()),
        pricePerGallon: z.preprocess((v) => v != null ? Number(v) : undefined, z.number().positive("Price must be positive").optional()),
        fuelType: z.enum(["DIESEL", "GASOLINE", "PROPANE", "ELECTRIC", "OTHER"]).optional(),
        meterReading: z.preprocess((v) => v != null ? Number(v) : null, z.number().nullable().optional()),
        projectId: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
      });

      const parsed = fuelLogUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors });
      }
      const { date, gallons, pricePerGallon, fuelType, meterReading, projectId, notes } = parsed.data;

      if (projectId) {
        const projectCheck = await db.query.projects.findFirst({
          where: and(eq(projects.id, projectId), eq(projects.gcOrganizationId, orgId)),
        });
        if (!projectCheck) return res.status(400).json({ error: "Invalid project" });
      }

      const updates: Partial<{
        date: string;
        gallons: string;
        pricePerGallon: string;
        totalCost: string;
        fuelType: string;
        meterReading: string | null;
        projectId: string | null;
        notes: string | null;
      }> = {};
      if (date !== undefined) updates.date = date;
      if (gallons !== undefined) updates.gallons = String(gallons);
      if (pricePerGallon !== undefined) updates.pricePerGallon = String(pricePerGallon);
      if (fuelType !== undefined) updates.fuelType = fuelType;
      if (meterReading !== undefined) updates.meterReading = meterReading ? String(meterReading) : null;
      if (projectId !== undefined) updates.projectId = projectId || null;
      if (notes !== undefined) updates.notes = notes || null;

      if (updates.gallons || updates.pricePerGallon) {
        const g = parseFloat(updates.gallons || log.gallons || "0");
        const p = parseFloat(updates.pricePerGallon || log.pricePerGallon || "0");
        updates.totalCost = String(g * p);
      }

      const [updated] = await db.update(equipmentFuelLogs)
        .set(updates)
        .where(eq(equipmentFuelLogs.id, logId))
        .returning();

      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  router.delete("/api/equipment/fuel-logs/:logId", async (req: AuthRequest, res, next) => {
    try {
      const { logId } = req.params;
      const orgId = req.user?.organizationId;
      if (!orgId) return res.status(403).json({ error: "Access denied - no organization" });

      const log = await db.query.equipmentFuelLogs.findFirst({
        where: eq(equipmentFuelLogs.id, logId),
      });
      if (!log) return res.status(404).json({ error: "Fuel log not found" });

      const eqCheck = await db.query.equipment.findFirst({
        where: and(eq(equipment.id, log.equipmentId), eq(equipment.organizationId, orgId)),
      });
      if (!eqCheck) return res.status(403).json({ error: "Access denied" });

      await db.delete(equipmentFuelLogs).where(eq(equipmentFuelLogs.id, logId));
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/equipment/:equipmentId/fuel-summary", async (req: AuthRequest, res, next) => {
    try {
      const { equipmentId } = req.params;
      const orgId = req.user?.organizationId;
      if (!orgId) return res.status(403).json({ error: "Access denied - no organization" });
      const eqCheck = await db.query.equipment.findFirst({
        where: and(eq(equipment.id, equipmentId), eq(equipment.organizationId, orgId)),
      });
      if (!eqCheck) return res.status(404).json({ error: "Equipment not found" });

      const summaryResult = await db
        .select({
          totalGallons: sql<string>`COALESCE(SUM(${equipmentFuelLogs.gallons}::numeric), 0)`,
          totalCost: sql<string>`COALESCE(SUM(${equipmentFuelLogs.totalCost}::numeric), 0)`,
          avgPricePerGallon: sql<string>`CASE WHEN SUM(${equipmentFuelLogs.gallons}::numeric) > 0 THEN SUM(${equipmentFuelLogs.totalCost}::numeric) / SUM(${equipmentFuelLogs.gallons}::numeric) ELSE 0 END`,
          logCount: sql<string>`COUNT(*)`,
        })
        .from(equipmentFuelLogs)
        .where(eq(equipmentFuelLogs.equipmentId, equipmentId));

      const currentHoursResult = await db
        .select({ currentHours: equipment.currentHours })
        .from(equipment)
        .where(eq(equipment.id, equipmentId));

      const currentHours = parseFloat(currentHoursResult[0]?.currentHours || "0");
      const totalGallons = parseFloat(summaryResult[0]?.totalGallons || "0");
      const totalCost = parseFloat(summaryResult[0]?.totalCost || "0");
      const costPerHour = currentHours > 0 ? totalCost / currentHours : 0;

      const projectSummary = await db
        .select({
          projectId: equipmentFuelLogs.projectId,
          projectName: projects.name,
          totalGallons: sql<string>`SUM(${equipmentFuelLogs.gallons}::numeric)`,
          totalCost: sql<string>`SUM(${equipmentFuelLogs.totalCost}::numeric)`,
          logCount: sql<string>`COUNT(*)`,
        })
        .from(equipmentFuelLogs)
        .leftJoin(projects, eq(equipmentFuelLogs.projectId, projects.id))
        .where(and(
          eq(equipmentFuelLogs.equipmentId, equipmentId),
          sql`${equipmentFuelLogs.projectId} IS NOT NULL`
        ))
        .groupBy(equipmentFuelLogs.projectId, projects.name);

      res.json({
        totalGallons: Math.round(totalGallons * 100) / 100,
        totalCost: Math.round(totalCost * 100) / 100,
        avgPricePerGallon: Math.round(parseFloat(summaryResult[0]?.avgPricePerGallon || "0") * 10000) / 10000,
        costPerHour: Math.round(costPerHour * 100) / 100,
        logCount: parseInt(summaryResult[0]?.logCount || "0"),
        projectBreakdown: projectSummary.map(p => ({
          projectId: p.projectId,
          projectName: p.projectName,
          totalGallons: Math.round(parseFloat(p.totalGallons || "0") * 100) / 100,
          totalCost: Math.round(parseFloat(p.totalCost || "0") * 100) / 100,
          logCount: parseInt(p.logCount || "0"),
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/projects/:projectId/fuel-summary", requireAuth, requireFeaturePermission('canManageEquipment'), async (req: AuthRequest, res, next) => {
    try {
      const { projectId } = req.params;
      const orgId = req.user?.organizationId;
      if (!orgId) return res.status(403).json({ error: "Access denied - no organization" });

      const projectCheck = await db.query.projects.findFirst({
        where: and(eq(projects.id, projectId), eq(projects.gcOrganizationId, orgId)),
      });
      if (!projectCheck) return res.status(404).json({ error: "Project not found" });

      const summaryResult = await db
        .select({
          totalGallons: sql<string>`COALESCE(SUM(${equipmentFuelLogs.gallons}::numeric), 0)`,
          totalCost: sql<string>`COALESCE(SUM(${equipmentFuelLogs.totalCost}::numeric), 0)`,
          avgPricePerGallon: sql<string>`CASE WHEN SUM(${equipmentFuelLogs.gallons}::numeric) > 0 THEN SUM(${equipmentFuelLogs.totalCost}::numeric) / SUM(${equipmentFuelLogs.gallons}::numeric) ELSE 0 END`,
          logCount: sql<string>`COUNT(*)`,
        })
        .from(equipmentFuelLogs)
        .where(eq(equipmentFuelLogs.projectId, projectId));

      const equipmentBreakdown = await db
        .select({
          equipmentId: equipmentFuelLogs.equipmentId,
          equipmentName: equipment.name,
          equipmentCode: equipment.equipmentCode,
          totalGallons: sql<string>`SUM(${equipmentFuelLogs.gallons}::numeric)`,
          totalCost: sql<string>`SUM(${equipmentFuelLogs.totalCost}::numeric)`,
          logCount: sql<string>`COUNT(*)`,
        })
        .from(equipmentFuelLogs)
        .innerJoin(equipment, eq(equipmentFuelLogs.equipmentId, equipment.id))
        .where(eq(equipmentFuelLogs.projectId, projectId))
        .groupBy(equipmentFuelLogs.equipmentId, equipment.name, equipment.equipmentCode);

      const totalGallons = parseFloat(summaryResult[0]?.totalGallons || "0");
      const totalCost = parseFloat(summaryResult[0]?.totalCost || "0");

      res.json({
        projectId,
        projectName: projectCheck.name,
        totalGallons: Math.round(totalGallons * 100) / 100,
        totalCost: Math.round(totalCost * 100) / 100,
        avgPricePerGallon: Math.round(parseFloat(summaryResult[0]?.avgPricePerGallon || "0") * 10000) / 10000,
        logCount: parseInt(summaryResult[0]?.logCount || "0"),
        equipmentBreakdown: equipmentBreakdown.map(e => ({
          equipmentId: e.equipmentId,
          equipmentName: e.equipmentName,
          equipmentCode: e.equipmentCode,
          totalGallons: Math.round(parseFloat(e.totalGallons || "0") * 100) / 100,
          totalCost: Math.round(parseFloat(e.totalCost || "0") * 100) / 100,
          logCount: parseInt(e.logCount || "0"),
        })),
      });
    } catch (error) {
      next(error);
    }
  });

export default router;
