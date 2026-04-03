import { logError } from "./utils/logger";
import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupSwagger } from "./swagger";
import crypto from "crypto";
import multer from "multer";
import { db } from "./db";

// Configure multer for memory storage (for file uploads)
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});
import { users, insertUserSchema, type InsertUser, type SelectUser, auditLog, billingEvents, timeClockShifts, passwordResetTokens, tradeTypeEnum } from "@shared/schema";
import { sendEmail, getPasswordResetEmailHtml, getPasswordResetEmailText } from "./email";
import { 
  projects, bids, estimates, estimateLineItems, procurementItems, planDocuments,
  timeEntries, tmDailySheets, receipts, projectNotes, scopeItems, media,
  changeOrders, changeOrderLaborEntries, changeOrderEquipmentEntries, changeOrderMaterialEntries,
  calendarEvents, notifications, filePermissions, projectDelays,
  insertProjectSchema, insertBidSchema, insertEstimateSchema,
  insertProcurementItemSchema, insertPlanDocumentSchema, insertTimeEntrySchema,
  insertTMDailySheetSchema, insertReceiptSchema, insertProjectNoteSchema,
  insertScopeItemSchema, insertMediaSchema, insertChangeOrderSchema,
  insertCalendarEventSchema, insertNotificationSchema, insertFilePermissionSchema,
  crews, crewMembers, skills, userSkills, userPhotos, equipment,
  skillVerificationRequests, userCertifications, userEquipmentCompetencies,
  insertCrewSchema, insertCrewMemberSchema, insertSkillSchema, insertUserSkillSchema,
  subcontractors, subcontractorContracts, subcontractorPayments,
  projectLaborRates, projectEmployeeRates,
  insertProjectLaborRateSchema, insertProjectEmployeeRateSchema,
  aiNoteInsights, aiTasks, projectPlans, takeoffMeasurements, takeoffSheets, 
  quantityCategories, tasks, dailyScopeProgress, tmTickets,
  scopeWorkTypeCategories, scopeWorkTypes, scopeModifierCategories, scopeModifiers,
  insertScopeWorkTypeCategorySchema, insertScopeWorkTypeSchema,
  insertScopeModifierCategorySchema, insertScopeModifierSchema,
  equipmentAssignments, equipmentRepairs, equipmentMaintenanceSchedules,
  equipmentMaintenanceHistory, equipmentHourLogs, equipmentHourReminders,
  equipmentRateProfiles, insertEquipmentRateProfileSchema, validatedEquipmentSchema,
  rentalVendors, insertRentalVendorSchema,
  rentalEquipmentCatalog, insertRentalEquipmentCatalogSchema,
  bidEquipmentSelections, insertBidEquipmentSelectionSchema,
  projectEquipmentPlans, insertProjectEquipmentPlanSchema,
  rentalEquipmentUsages, insertRentalEquipmentUsageSchema,
  tradeFeatures, organizations, organizationSowItems, masterSowItems,
  masterModifierCategories, masterModifiers,
  scheduleOfValues, sovLineItems,
  employeePerformanceProfiles, attendanceLogs, safetyIncidents, qualityIssues, performanceReviews,
  supervisorNotes, workerLogs
} from "@shared/schema";
import { 
  authMiddleware, 
  requireAuth, 
  requireRole, 
  requireActiveOrganization,
  hashPassword, 
  verifyPassword, 
  generateToken, 
  setAuthCookie, 
  clearAuthCookie,
  revokeUserTokens,
  type AuthRequest 
} from "./auth";
import { eq, ne, desc, asc, sql, and, or, isNull, inArray, type SQL } from "drizzle-orm";
import { z } from "zod";
import { authLimiter, sensitiveLimiter, apiLimiter } from "./rateLimiter";
import { logCreate, logUpdate, logDelete, logApprove, logReject, logAudit } from "./auditLogger";
import { validateFileExists, validateMimeType, validateFileSize } from "./fileValidation";
import { sanitizeShortText, sanitizeText, sanitizeEmail, sanitizePhone } from "./sanitization";
import timeClockRoutes from "./timeClockRoutes";
import overtimeRoutes from "./overtimeRoutes";
import timeEntryRoutes from "./timeEntryRoutes";
import payrollRoutes from "./payrollRoutes";
import changeOrderCrudRoutes from "./changeOrderCrudRoutes";
import changeOrderApprovalRoutes from "./changeOrderApprovalRoutes";
import changeOrderExportRoutes from "./changeOrderExportRoutes";
import delayRoutes from "./delayRoutes";
import inspectionRoutes from "./inspectionRoutes";
import punchListRoutes from "./punchListRoutes";
import warrantyRoutes from "./warrantyRoutes";
import aiOrchestrationRoutes from "./aiOrchestrationRoutes";
import aiOnboardingRoutes from "./aiOnboardingRoutes";
import scheduleRoutes from "./scheduleRoutes";
import notesRoutes from "./notesRoutes";
import taskRoutes from "./taskRoutes";
import estimateRoutes from "./estimateRoutes";
import { registerTMTicketRoutes } from "./tmRoutes";
import platformRoutes, { trackApiRequest } from "./platformRoutes";
import platformBillingRoutes from "./platformBillingRoutes";
import calculatorRoutes from "./calculatorRoutes";
import organizationDocumentRoutes from "./organizationDocumentRoutes";
import sovRoutes from "./sovRoutes";
import aiaBillingRoutes from "./aiaBillingRoutes";
import subcontractRoutes from "./subcontractRoutes";
import subcontractorPayablesRoutes from "./subcontractorPayablesRoutes";
import subcontractManagementRoutes from "./subcontractManagementRoutes";
import websiteRoutes from "./websiteRoutes";
import websiteAiRoutes from "./websiteAiRoutes";
import socialRoutes from "./socialRoutes";
import laborRateRoutes from "./laborRateRoutes";
import procurementModuleRoutes from "./procurementModuleRoutes";
import emailRoutes from "./emailRoutes";
import kpiRoutes from "./kpiRoutes";
import billingRoutes from "./billingRoutes";
import dashboardRoutes from "./dashboardRoutes";
import libraryRoutes from "./libraryRoutes";
import opsRoutes from "./opsRoutes";
import hustlerRoutes from "./hustlerRoutes";
import bidNetworkRoutes from "./bidNetworkRoutes";
import marketplaceRoutes from "./marketplaceRoutes";
import weatherRoutes from "./weatherRoutes";
import vendorRoutes from "./vendorRoutes";
import fieldProductivityRoutes from "./fieldProductivityRoutes";
import rfiRoutes from "./rfiRoutes";
import transmittalRoutes from "./transmittalRoutes";
import submittalRoutes from "./submittalRoutes";
import portalRoutes from "./portalRoutes";
import unifiedPortalRoutes from "./unifiedPortalRoutes";
import subChatRoutes from "./subChatRoutes";
import clientChatRoutes from "./clientChatRoutes";
import integrationRoutes from "./integrationRoutes";
import { registerAllProviders } from "./integrations/providers";
import approvalRoutes from "./approvalRoutes";
import workflowRoutes from "./workflowRoutes";
import documentRevisionRoutes from "./documentRevisionRoutes";
import drawingSetRoutes from "./drawingSetRoutes";
import addendaRoutes from "./addendaRoutes";
import devSeedEnterpriseRoutes from "./devSeedEnterprise";
import featureFlagRoutes from "./featureFlagRoutes";
import ssoRoutes from "./ssoRoutes";
import auditExportRoutes from "./auditExportRoutes";
import retentionRoutes from "./retentionRoutes";
import privacyRoutes from "./privacyRoutes";
import authProfileRoutes from "./authProfileRoutes";
import oauthRoutes from "./oauthRoutes";
import passkeyRoutes from "./passkeyRoutes";
import workforceRoutes from "./workforceRoutes";
import { createArcSegment } from "@shared/utils/geometry";
import { seedCoreTradeModifierCategories } from "./seedTradeExpansion";
import { generateInternalBidSummaryPDF, generateCustomerQuotePDF } from "./pdf-service";
import { getOrgIdForFilter, verifyOrgAccess, verifyUserOrgAccess, isSuperAdmin } from "./orgFilter";
import bidRoutes2 from "./bidRoutes2";
import takeoffSheetRoutes from "./takeoffSheetRoutes";
import takeoffIssueRoutes from "./takeoffIssueRoutes";
import takeoffMeasurementRoutes from "./takeoffMeasurementRoutes";
import takeoffCategoryRoutes from "./takeoffCategoryRoutes";
import takeoffCrossModuleRoutes from "./takeoffCrossModuleRoutes";
import bimRoutes from "./bimRoutes";
import projectCrudRoutes from "./projectCrudRoutes";
import projectContentRoutes from "./projectContentRoutes";
import projectFinancialRoutes from "./projectFinancialRoutes";
import scopeRoutes from "./scopeRoutes";
import locationRoutes from "./locationRoutes";
import materialTrackingRoutes from "./materialTrackingRoutes";
import productionRateRoutes from "./productionRateRoutes";
import crmRoutes from "./crmRoutes";
import projectOpsRoutes from "./projectOpsRoutes";
import notificationRoutes2 from "./notificationRoutes2";
import notificationPreferencesRoutes from "./notificationPreferencesRoutes";
import pushSubscriptionRoutes from "./pushSubscriptionRoutes";
import { insertNotification } from "./services/notificationService";
import auditBillingStorageRoutes from "./auditBillingStorageRoutes";
import crewRoutes2 from "./crewRoutes2";
import skillRoutes from "./skillRoutes";
import assemblyRoutes from "./assemblyRoutes";
import messagingRoutes, { messagingSetup } from "./messagingRoutes";
import equipmentRoutes from "./equipmentRoutes";
import mobileSyncRoutes from "./mobileSyncRoutes";
import clientPortalRoutes from "./clientPortalRoutes";
import onboardingLibraryRoutes from "./onboardingLibraryRoutes";
import reportRoutes from "./reportRoutes";
import safetyTrainingRoutes from "./safetyTrainingRoutes";
import safetyWorkflowRoutes from "./safetyWorkflowRoutes";
import profitabilityAlertRoutes from "./profitabilityAlertRoutes";
import costLedgerRoutes from "./costLedgerRoutes";
import costEngineRoutes from "./costEngineRoutes";
import hiringRoutes from "./hiringRoutes";
import talentPoolRoutes from "./talentPoolRoutes";
import overheadRoutes from "./overheadRoutes";
import modifierRoutes from "./modifierRoutes";
import leaveRoutes from "./leaveRoutes";
import contractRoutes from "./contractRoutes";
import clauseLibraryRoutes from "./clauseLibraryRoutes";
import assetManagementRoutes from "./assetManagementRoutes";
import revenueRecognitionRoutes from "./revenueRecognitionRoutes";
import riskRoutes from "./riskRoutes";
import userSettingsRoutes from "./userSettingsRoutes";
import executiveDigestRoutes from "./executiveDigestRoutes";

export async function registerRoutes(app: Express): Promise<Server> {
  // Register operational routes BEFORE auth middleware (health checks should be public)
  app.use(opsRoutes);

  // Serve Swagger UI at /api-docs — publicly accessible without authentication
  setupSwagger(app);

  // Apply auth middleware to all routes
  app.use(authMiddleware);

  // Check org suspension for all authenticated requests (SUPER_ADMIN bypasses)
  app.use(requireActiveOrganization);

  // Apply general API rate limiter to all API routes BEFORE registering any routes
  app.use("/api", apiLimiter);

  app.use("/api", (req: any, res, next) => {
    const orgId = req.user?.organizationId || null;
    res.on("finish", () => {
      trackApiRequest(orgId, res.statusCode >= 400);
    });
    next();
  });

  // Register time-clock routes (now protected by rate limiter)
  app.use(timeClockRoutes);

  // Register overtime request routes
  app.use(overtimeRoutes);

  // Register time entry approval routes
  app.use(timeEntryRoutes);

  // Register payroll routes
  app.use(payrollRoutes);

  // Register change order state machine routes
  app.use("/api/change-orders", changeOrderCrudRoutes);
  app.use("/api/change-orders", changeOrderApprovalRoutes);
  app.use("/api/change-orders", changeOrderExportRoutes);

  // Register delay tracking routes
  app.use("/api", delayRoutes);

  app.use("/api/field-productivity", fieldProductivityRoutes);

  // Register marketplace routes (consolidated)
  app.use("/api/marketplace", marketplaceRoutes);

  // Register inspection scheduling routes
  app.use("/api", inspectionRoutes);

  // Register punch list routes
  app.use("/api", punchListRoutes);
  app.use("/api", warrantyRoutes);

  // Register AI routes through single orchestration layer (consolidates document, scheduling, takeoff, CFO analytics routes)
  app.use("/api", aiOrchestrationRoutes);
  app.use("/api", aiOnboardingRoutes);

  // Register schedule management routes (CPM engine, baseline, resource loading, forecasting)
  app.use("/api", scheduleRoutes);

  // Register onboarding library routes (read-only reference data)
  app.use(onboardingLibraryRoutes);

  // Register daily notes routes
  app.use("/api", notesRoutes);

  // Register task management routes
  app.use(taskRoutes);

  // Register estimate routes
  app.use(estimateRoutes);

  // Register T&M ticket routes
  registerTMTicketRoutes(app);

  // Register platform routes (admin, org, user)
  app.use("/api", platformRoutes);
  app.use("/api", platformBillingRoutes);

  // Register material calculator routes
  app.use("/api/calculators", calculatorRoutes);

  // Register organization document routes
  app.use("/api", organizationDocumentRoutes);

  // Register Schedule of Values (SOV) routes (consolidated)
  app.use("/api", sovRoutes);

  // Register AIA Progress Billing routes
  app.use("/api/aia-billing", aiaBillingRoutes);

  // Register Subcontract Agreement routes
  app.use("/api", subcontractRoutes);

  // Register Subcontractor Payables routes
  app.use("/api", subcontractorPayablesRoutes);

  // Register Subcontract Management routes (SOV, Pay Apps, Retention, Performance)
  app.use("/api", subcontractManagementRoutes);

  // Register Procurement Module routes
  app.use(procurementModuleRoutes);

  // Register Website routes (consolidated)
  app.use("/api/website", websiteRoutes);
  app.use("/api/website", websiteAiRoutes);
  app.use("/api/social", socialRoutes);

  // Register Labor Rate routes
  app.use("/api/labor-rates", laborRateRoutes);

  // Register Email routes (consolidated)
  app.use("/api/email", emailRoutes);
  app.use("/api/kpis", kpiRoutes);

  app.use(libraryRoutes);

  // Register Hustler Multi-Organization routes
  app.use("/api", hustlerRoutes);

  // Register Subcontractor Bid Network routes
  app.use("/api/bid-network", bidNetworkRoutes);

  app.use("/api", rfiRoutes);
  app.use("/api", transmittalRoutes);
  app.use("/api", submittalRoutes);

  app.use("/api", portalRoutes);
  app.use("/api", unifiedPortalRoutes);
  app.use("/api", subChatRoutes);
  app.use("/api", clientChatRoutes);

  app.use("/api/billing", billingRoutes);

  registerAllProviders();
  app.use("/api/integrations", integrationRoutes);

  app.use("/api/weather", weatherRoutes);

  // Register Vendor routes (consolidated)
  app.use(vendorRoutes);

  app.use("/api/approvals", approvalRoutes);
  app.use("/api/workflows", workflowRoutes);
  app.use("/api/documents", documentRevisionRoutes);
  app.use("/api/projects", drawingSetRoutes);
  app.use("/api", addendaRoutes);

  app.use("/api/feature-flags", featureFlagRoutes);

  app.use("/api/sso", ssoRoutes);
  app.use("/api/audit", auditExportRoutes);
  app.use("/api/retention", retentionRoutes);
  app.use("/api/privacy", privacyRoutes);

  // Register Safety Training routes
  app.use(safetyTrainingRoutes);
  app.use(safetyWorkflowRoutes);
  app.use(profitabilityAlertRoutes);
  app.use(costLedgerRoutes);
  app.use(revenueRecognitionRoutes);
  app.use(costEngineRoutes);

  // Register Hiring Module routes
  app.use("/api/hiring", hiringRoutes);

  // Register Talent Pool routes
  app.use("/api/talent-pool", talentPoolRoutes);

  // Register Leave Management routes
  app.use(leaveRoutes);

  // Register Contract Management routes
  app.use(contractRoutes);
  app.use(clauseLibraryRoutes);

  app.use("/api", assetManagementRoutes);

  app.use("/api", riskRoutes);

  app.use(userSettingsRoutes);

  app.use(executiveDigestRoutes);

  if (process.env.NODE_ENV !== "production") {
    app.use("/api/dev", devSeedEnterpriseRoutes);
  }

  // Auth & Profile routes (extracted to authProfileRoutes.ts)
  app.use(authProfileRoutes);

  // OAuth social login routes (Google, Apple)
  app.use(oauthRoutes);

  // Passkey (WebAuthn) routes
  app.use(passkeyRoutes);

  // Workforce/Workers routes (extracted to workforceRoutes.ts)
  app.use(workforceRoutes);

  // Dashboard + User Management routes (consolidated into dashboardRoutes)
  app.use(dashboardRoutes);

  // ====================
  // Validation Helpers
  // ====================
  
  // Validate monetary amount is positive and within reasonable limits
  function validateMonetaryAmount(amount: string | number | null | undefined, fieldName: string): { valid: boolean; error?: string } {
    if (amount === null || amount === undefined) {
      return { valid: true }; // Optional fields are allowed to be null/undefined
    }
    
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
    
    if (isNaN(numAmount)) {
      return { valid: false, error: `${fieldName} must be a valid number` };
    }
    
    if (numAmount <= 0) {
      return { valid: false, error: `${fieldName} must be a positive value (greater than zero)` };
    }
    
    // Reasonable upper limit: $100 million per field
    if (numAmount > 100000000) {
      return { valid: false, error: `${fieldName} exceeds maximum allowed value ($100,000,000)` };
    }
    
    return { valid: true };
  }

  // Validate change order amount (can be positive or negative for additions/deductions)
  function validateChangeOrderAmount(amount: string | number | null | undefined, fieldName: string): { valid: boolean; error?: string } {
    if (amount === null || amount === undefined) {
      return { valid: false, error: `${fieldName} is required` };
    }
    
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
    
    if (isNaN(numAmount)) {
      return { valid: false, error: `${fieldName} must be a valid number` };
    }
    
    if (numAmount === 0) {
      return { valid: false, error: `${fieldName} cannot be zero (use positive for additions, negative for deductions)` };
    }
    
    // Reasonable limits: -$100 million to +$100 million
    if (Math.abs(numAmount) > 100000000) {
      return { valid: false, error: `${fieldName} exceeds maximum allowed value (±$100,000,000)` };
    }
    
    return { valid: true };
  }

  // Validate JSON string is parseable
  function validateJSONField(jsonString: string | null | undefined, fieldName: string): { valid: boolean; error?: string; parsed?: any } {
    if (jsonString === null || jsonString === undefined) {
      return { valid: true }; // Optional fields are allowed to be null/undefined
    }

    // Empty strings should default to null
    if (jsonString === "") {
      return { valid: true, parsed: null };
    }

    try {
      const parsed = JSON.parse(jsonString);
      return { valid: true, parsed };
    } catch (error) {
      return { 
        valid: false, 
        error: `${fieldName} contains invalid JSON: ${error instanceof Error ? error.message : 'Parse error'}` 
      };
    }
  }

  // Validate project status transitions (state machine)
  type ProjectStatus = "BID" | "PLANNING" | "ACTIVE" | "COMPLETE" | "CLOSED";
  function validateProjectStatusTransition(currentStatus: ProjectStatus, newStatus: ProjectStatus): { valid: boolean; error?: string } {
    // Valid transitions map
    const validTransitions: Record<ProjectStatus, ProjectStatus[]> = {
      "BID": ["PLANNING"],
      "PLANNING": ["ACTIVE", "BID"],  // Can revert to BID if not started
      "ACTIVE": ["COMPLETE", "PLANNING"],  // Can revert to PLANNING if needed
      "COMPLETE": ["CLOSED", "ACTIVE"],  // Can revert to ACTIVE if more work needed
      "CLOSED": [],  // Terminal state - no transitions allowed
    };

    if (currentStatus === newStatus) {
      return { valid: true }; // Same status is always allowed
    }

    const allowedTransitions = validTransitions[currentStatus];
    if (!allowedTransitions.includes(newStatus)) {
      return { 
        valid: false, 
        error: `Invalid status transition from ${currentStatus} to ${newStatus}. Allowed transitions: ${allowedTransitions.join(", ") || "none (terminal state)"}` 
      };
    }

    return { valid: true };
  }

  // Bid Routes
  app.use(bidRoutes2);
  app.use(takeoffSheetRoutes);
  app.use(takeoffIssueRoutes);
  app.use(takeoffMeasurementRoutes);
  app.use(takeoffCategoryRoutes);
  app.use(takeoffCrossModuleRoutes);
  app.use(bimRoutes);

  // Project Routes (split: core CRUD, content, financial)
  app.use(projectCrudRoutes);
  app.use(projectContentRoutes);
  app.use(projectFinancialRoutes);
  app.use(materialTrackingRoutes);
  app.use(productionRateRoutes);

  // CRM Routes (consolidated: vendor, contact, pipeline, enrollment, pricing)
  app.use(crmRoutes);

  // Location Routes (project locations + field takeoff)
  app.use(locationRoutes);

  // Scope Routes (consolidated: scope items + scope config)
  app.use(scopeRoutes);

  // Project Operations Routes (consolidated: receipts, plan docs, file perms, change orders, calendar)
  app.use(projectOpsRoutes);

  // Notifications Routes
  app.use(notificationRoutes2);
  app.use(notificationPreferencesRoutes);
  app.use(pushSubscriptionRoutes);
  // Audit Log, Billing Events, Object Storage Routes
  app.use(auditBillingStorageRoutes);
  // Crews & Crew Assignments Routes
  app.use(crewRoutes2);
  // Skills & User Skills Routes
  app.use(skillRoutes);

  // Assembly routes
  app.use(assemblyRoutes);

  // Internal Messaging System Routes (extracted to messagingRoutes.ts)
  await messagingSetup;
  app.use(messagingRoutes);

  // Equipment Routes (consolidated: management, rental, plan)
  app.use(equipmentRoutes);

  // Mobile & Offline Sync Routes
  app.use(mobileSyncRoutes);

  // Client Portal Routes (extracted from aiFeatureRoutes)
  app.use("/api/ai-features", clientPortalRoutes);

  // Overhead Cost Items Routes
  app.use(overheadRoutes);

  // Scope Modifier System (3-Layer)
  app.use(modifierRoutes);

  // Reports Routes (Takeoff & Estimate Reports)
  app.use(reportRoutes);

  // Marketing Document PDF
  const marketingPdfRoute = (await import("./marketingPdfRoute")).default;
  app.use("/api", marketingPdfRoute);

  const { registerPerformanceRoutes } = await import("./performanceRoutes");
  registerPerformanceRoutes(app);

  seedCoreTradeModifierCategories().catch(err => {
    logError("Failed to seed core modifier categories:", {}, err instanceof Error ? err : new Error(String(err)));
  });

  const cron = await import("node-cron");
  cron.schedule("0 8 * * *", async () => {
    try {
      await checkCertificationExpiry();
    } catch (err) {
      logError("[Cert Expiry] Scheduled check failed:", {}, err instanceof Error ? err : new Error(String(err)));
    }
  });

  // Admin endpoint: manually trigger orphan scan
  app.post("/api/admin/storage/orphan-scan", requireAuth, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res: Response) => {
    try {
      const { runOrphanScan } = await import("./storageOrphanScanJob");
      const result = await runOrphanScan();
      res.json(result);
    } catch (err: any) {
      logError("Orphan scan error:", {}, err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ error: "Orphan scan failed", detail: err?.message });
    }
  });

  const httpServer = createServer(app);

  const { setupTakeoffCollaboration } = await import("./takeoffCollaboration");
  setupTakeoffCollaboration(httpServer);

  return httpServer;
}

async function checkCertificationExpiry() {
  const now = new Date();
  const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const fiveDaysFromNow = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);

  const allCerts = await db.select({
    id: userCertifications.id,
    userId: userCertifications.userId,
    certificationName: userCertifications.certificationName,
    expiryDate: userCertifications.expiryDate,
    status: userCertifications.status,
    expiryNotified30Days: userCertifications.expiryNotified30Days,
    expiryNotified5Days: userCertifications.expiryNotified5Days,
    organizationId: users.organizationId,
  }).from(userCertifications).innerJoin(users, eq(users.id, userCertifications.userId));

  for (const cert of allCerts) {
    if (!cert.expiryDate) continue;

    const expiryTime = new Date(cert.expiryDate).getTime();

    if (expiryTime < now.getTime() && cert.status !== "expired") {
      await db.update(userCertifications)
        .set({ status: "expired", updatedAt: now })
        .where(eq(userCertifications.id, cert.id));
    }

    if (expiryTime <= thirtyDaysFromNow.getTime() && expiryTime > now.getTime() && !cert.expiryNotified30Days) {
      await db.update(userCertifications)
        .set({ expiryNotified30Days: true, updatedAt: now })
        .where(eq(userCertifications.id, cert.id));

      await insertNotification({
        userId: cert.userId,
        organizationId: cert.organizationId || null,
        type: "GENERAL",
        title: "Certification Expiring Soon",
        message: `Your certification "${cert.certificationName}" will expire on ${new Date(cert.expiryDate).toLocaleDateString()}. Please renew it.`,
      });
    }

    if (expiryTime <= fiveDaysFromNow.getTime() && expiryTime > now.getTime() && !cert.expiryNotified5Days) {
      await db.update(userCertifications)
        .set({ expiryNotified5Days: true, updatedAt: now })
        .where(eq(userCertifications.id, cert.id));

      await insertNotification({
        userId: cert.userId,
        organizationId: cert.organizationId || null,
        type: "GENERAL",
        title: "Certification Expiring Very Soon",
        message: `Your certification "${cert.certificationName}" will expire in less than 5 days on ${new Date(cert.expiryDate).toLocaleDateString()}. Immediate action is required.`,
      });
    }
  }

  console.log(`[Cert Expiry] Checked ${allCerts.length} certifications`);
}
