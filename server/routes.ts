import type { Express } from "express";
import { createServer, type Server } from "http";
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
import payrollNotificationRoutes from "./payrollNotificationRoutes";
import payrollSettingsRoutes from "./payrollSettingsRoutes";
import payrollManagementRoutes from "./payrollManagementRoutes";
import changeOrderRoutes from "./changeOrderRoutes";
import delayRoutes from "./delayRoutes";
import inspectionRoutes from "./inspectionRoutes";
import aiRoutes from "./aiRoutes";
import aiOnboardingRoutes from "./aiOnboardingRoutes";
import aiScopeRoutes from "./aiScopeRoutes";
import aiInsightsRoutes from "./aiInsightsRoutes";
import notesRoutes from "./notesRoutes";
import aiNotesRoutes from "./aiNotesRoutes";
import taskRoutes from "./taskRoutes";
import estimateRoutes from "./estimateRoutes";
import { registerTMTicketRoutes } from "./tmTicketRoutes";
import platformAdminRoutes from "./platformAdminRoutes";
import calculatorRoutes from "./calculatorRoutes";
import aiAssistantRoutes from "./aiAssistantRoutes";
import aiFeatureRoutes from "./aiFeatureRoutes";
import organizationDocumentRoutes from "./organizationDocumentRoutes";
import aiBidDocumentRoutes from "./aiBidDocumentRoutes";
import aiContractDocumentRoutes from "./aiContractDocumentRoutes";
import sovRoutes from "./sovRoutes";
import sovLineItemRoutes from "./sovLineItemRoutes";
import sovPaymentRoutes from "./sovPaymentRoutes";
import sovBillingRoutes from "./sovBillingRoutes";
import subcontractRoutes from "./subcontractRoutes";
import subcontractorPayablesRoutes from "./subcontractorPayablesRoutes";
import websiteBuilderRoutes from "./websiteBuilderRoutes";
import socialAccountRoutes from "./socialAccountRoutes";
import socialPostRoutes from "./socialPostRoutes";
import socialAnalyticsRoutes from "./socialAnalyticsRoutes";
import laborRateRoutes from "./laborRateRoutes";
import emailAccountRoutes from "./emailAccountRoutes";
import kpiRoutes from "./kpiRoutes";
import billingRoutes from "./billingRoutes";
import emailAiRoutes from "./emailAiRoutes";
import emailAnalysisRoutes from "./emailAnalysisRoutes";
import emailTaskRoutes from "./emailTaskRoutes";
import dashboardCustomizationRoutes from "./dashboardCustomizationRoutes";
import libraryRoutes from "./libraryRoutes";
import opsRoutes from "./opsRoutes";
import hustlerRoutes from "./hustlerRoutes";
import bidNetworkRoutes from "./bidNetworkRoutes";
import weatherRoutes from "./weatherRoutes";
import vendorPricebookRoutes from "./vendorPricebookRoutes";
import delayClaimsRoutes from "./delayClaimsRoutes";
import fieldProductivityRoutes from "./fieldProductivityRoutes";
import marketplaceRoutes from "./marketplaceRoutes";
import aiScheduleRoutes from "./aiScheduleRoutes";
import rfiRoutes from "./rfiRoutes";
import transmittalRoutes from "./transmittalRoutes";
import submittalRoutes from "./submittalRoutes";
import submittalWorkflowRoutes from "./submittalWorkflowRoutes";
import portalRoutes from "./portalRoutes";
import portalChatRoutes from "./portalChatRoutes";
import subChatRoutes from "./subChatRoutes";
import clientChatRoutes from "./clientChatRoutes";
import integrationRoutes from "./integrationRoutes";
import { registerAllProviders } from "./integrations/providers";
import approvalRoutes from "./approvalRoutes";
import aiGovernanceRoutes from "./aiGovernanceRoutes";
import documentRevisionRoutes from "./documentRevisionRoutes";
import addendaRoutes from "./addendaRoutes";
import projectHealthRoutes from "./projectHealthRoutes";
import devSeedEnterpriseRoutes from "./devSeedEnterprise";
import featureFlagRoutes from "./featureFlagRoutes";
import ssoRoutes from "./ssoRoutes";
import auditExportRoutes from "./auditExportRoutes";
import retentionRoutes from "./retentionRoutes";
import privacyRoutes from "./privacyRoutes";
import authProfileRoutes from "./authProfileRoutes";
import oauthRoutes from "./oauthRoutes";
import workforceRoutes from "./workforceRoutes";
import { createArcSegment } from "@shared/utils/geometry";
import { seedCoreTradeModifierCategories } from "./seedTradeExpansion";
import { generateInternalBidSummaryPDF, generateCustomerQuotePDF } from "./pdf-service";
import { getOrgIdForFilter, verifyOrgAccess, verifyUserOrgAccess, isSuperAdmin } from "./orgFilter";
import bidRoutes2 from "./bidRoutes2";
import bidTakeoffRoutes from "./bidTakeoffRoutes";
import dashboardUserRoutes from "./dashboardUserRoutes";
import projectCoreRoutes from "./projectCoreRoutes";
import scopeItemRoutes from "./scopeItemRoutes";
import materialTrackingRoutes from "./materialTrackingRoutes";
import productionRateRoutes from "./productionRateRoutes";
import crmVendorRoutes from "./crmVendorRoutes";
import crmContactRoutes from "./crmContactRoutes";
import vendorEnrollmentRoutes from "./vendorEnrollmentRoutes";
import vendorPricingRoutes from "./vendorPricingRoutes";
import scopeConfigRoutes from "./scopeConfigRoutes";
import projectContentRoutes from "./projectContentRoutes";
import projectOpsRoutes from "./projectOpsRoutes";
import notificationRoutes2 from "./notificationRoutes2";
import auditBillingStorageRoutes from "./auditBillingStorageRoutes";
import crewRoutes2 from "./crewRoutes2";
import skillRoutes from "./skillRoutes";
import takeoffSubRoutes from "./takeoffSubRoutes";
import assemblyRoutes from "./assemblyRoutes";
import messagingRoutes, { messagingSetup } from "./messagingRoutes";
import equipmentMgmtRoutes from "./equipmentMgmtRoutes";
import rentalEquipmentRoutes from "./rentalEquipmentRoutes";
import equipmentPlanRoutes from "./equipmentPlanRoutes";
import mobileSyncRoutes from "./mobileSyncRoutes";
import clientPortalRoutes from "./clientPortalRoutes";
import onboardingLibraryRoutes from "./onboardingLibraryRoutes";
import reportRoutes from "./reportRoutes";
import safetyTrainingRoutes from "./safetyTrainingRoutes";

export async function registerRoutes(app: Express): Promise<Server> {
  // Register operational routes BEFORE auth middleware (health checks should be public)
  app.use(opsRoutes);

  // Apply auth middleware to all routes
  app.use(authMiddleware);

  // Apply general API rate limiter to all API routes BEFORE registering any routes
  app.use("/api", apiLimiter);

  // Register time-clock routes (now protected by rate limiter)
  app.use(timeClockRoutes);

  // Register overtime request routes
  app.use(overtimeRoutes);

  // Register time entry approval routes
  app.use(timeEntryRoutes);

  // Register payroll notification routes
  app.use(payrollNotificationRoutes);
  
  // Register payroll settings routes (work week config, weekly reports)
  app.use(payrollSettingsRoutes);

  // Register payroll management routes (pay runs, workers, time entries)
  app.use(payrollManagementRoutes);

  // Register change order state machine routes
  app.use("/api/change-orders", changeOrderRoutes);

  // Register delay tracking routes
  app.use("/api", delayRoutes);

  // Register delay claims routes
  app.use("/api/delay-claims", delayClaimsRoutes);
  app.use("/api/field-productivity", fieldProductivityRoutes);

  // Register marketplace routes (vendor scores, material prices, crew marketplace)
  app.use("/api/marketplace", marketplaceRoutes);
  app.use(aiScheduleRoutes);

  // Register inspection scheduling routes
  app.use("/api", inspectionRoutes);

  // Register AI PM + CFO routes
  app.use("/api", aiRoutes);

  // Register AI Onboarding & Walkthrough routes
  app.use("/api", aiOnboardingRoutes);

  // Register AI Trade Discovery & Scope Prediction routes
  app.use("/api", aiScopeRoutes);

  // Register AI Insights routes
  app.use("/api", aiInsightsRoutes);

  // Register onboarding library routes (read-only reference data)
  app.use(onboardingLibraryRoutes);

  // Register daily notes routes
  app.use("/api", notesRoutes);

  // Register AI notes analysis routes
  app.use("/api/ai-notes", aiNotesRoutes);

  // Register task management routes
  app.use(taskRoutes);

  // Register estimate routes
  app.use(estimateRoutes);

  // Register T&M ticket routes
  registerTMTicketRoutes(app);

  // Register platform admin routes (SUPER_ADMIN only)
  app.use("/api", platformAdminRoutes);

  // Register material calculator routes
  app.use("/api/calculators", calculatorRoutes);

  // Register AI Assistant routes (SOW and UOM management)
  app.use("/api/ai-assistant", aiAssistantRoutes);

  // Register AI Feature routes (7 major AI-enhanced features)
  app.use("/api/ai-features", aiFeatureRoutes);

  // Register organization document routes
  app.use("/api", organizationDocumentRoutes);

  // Register AI bid document analysis routes
  app.use("/api", aiBidDocumentRoutes);

  // Register AI contract/award document analysis routes
  app.use("/api", aiContractDocumentRoutes);

  // Register Schedule of Values (SOV) routes
  // Payment/lien-waiver/billing routes must be registered BEFORE core SOV routes
  // because they have paths like /sov/payments that would conflict with /sov/:id
  app.use("/api", sovPaymentRoutes);
  app.use("/api", sovBillingRoutes);
  app.use("/api", sovRoutes);
  app.use("/api", sovLineItemRoutes);

  // Register Subcontract Agreement routes
  app.use("/api", subcontractRoutes);

  // Register Subcontractor Payables routes
  app.use("/api", subcontractorPayablesRoutes);

  // Register Website Builder routes
  app.use("/api/website", websiteBuilderRoutes);
  app.use("/api/social", socialAccountRoutes);
  app.use("/api/social", socialPostRoutes);
  app.use("/api/social", socialAnalyticsRoutes);

  // Register Labor Rate routes
  app.use("/api/labor-rates", laborRateRoutes);

  // Register Email Account routes
  app.use("/api/email", emailAccountRoutes);
  app.use("/api/kpis", kpiRoutes);

  // Register Email AI routes (threads, messages, sync)
  app.use("/api/email", emailAiRoutes);
  // Register Email Analysis routes (AI analysis, summarization, digests)
  app.use("/api/email", emailAnalysisRoutes);
  // Register Email Task routes (task CRUD from email)
  app.use("/api/email", emailTaskRoutes);

  // Register Dashboard Customization routes
  app.use("/api/dashboard", dashboardCustomizationRoutes);

  app.use(libraryRoutes);

  // Register Hustler Multi-Organization routes
  app.use("/api", hustlerRoutes);

  // Register Subcontractor Bid Network routes
  app.use("/api/bid-network", bidNetworkRoutes);

  app.use("/api", rfiRoutes);
  app.use("/api", transmittalRoutes);
  app.use("/api", submittalRoutes);
  app.use("/api", submittalWorkflowRoutes);

  app.use("/api", portalRoutes);
  app.use("/api", portalChatRoutes);
  app.use("/api", subChatRoutes);
  app.use("/api", clientChatRoutes);

  app.use("/api/billing", billingRoutes);

  registerAllProviders();
  app.use("/api/integrations", integrationRoutes);

  app.use("/api/weather", weatherRoutes);

  // Register Vendor Pricebook routes (PDF upload and AI extraction)
  app.use("/api/vendor", vendorPricebookRoutes);

  app.use("/api/approvals", approvalRoutes);
  app.use("/api/ai-governance", aiGovernanceRoutes);
  app.use("/api/documents", documentRevisionRoutes);
  app.use("/api", addendaRoutes);
  app.use("/api/project-health", projectHealthRoutes);

  app.use("/api/feature-flags", featureFlagRoutes);

  app.use("/api/sso", ssoRoutes);
  app.use("/api/audit", auditExportRoutes);
  app.use("/api/retention", retentionRoutes);
  app.use("/api/privacy", privacyRoutes);

  // Register Safety Training routes
  app.use(safetyTrainingRoutes);

  if (process.env.NODE_ENV !== "production") {
    app.use("/api/dev", devSeedEnterpriseRoutes);
  }

  // Auth & Profile routes (extracted to authProfileRoutes.ts)
  app.use(authProfileRoutes);

  // OAuth social login routes (Google, Apple)
  app.use(oauthRoutes);

  // Workforce/Workers routes (extracted to workforceRoutes.ts)
  app.use(workforceRoutes);

  // Dashboard + User Management routes (extracted to dashboardUserRoutes.ts)
  app.use(dashboardUserRoutes);

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

  // Bid Routes (extracted to bidRoutes2.ts)
  app.use(bidRoutes2);
  app.use(bidTakeoffRoutes);


  // Project Routes (extracted to projectCoreRoutes.ts, scopeItemRoutes.ts, materialTrackingRoutes.ts, productionRateRoutes.ts)
  app.use(projectCoreRoutes);
  app.use(scopeItemRoutes);
  app.use(materialTrackingRoutes);
  app.use(productionRateRoutes);


  // CRM + Vendor Routes (extracted to crmVendorRoutes.ts, crmContactRoutes.ts, vendorEnrollmentRoutes.ts, vendorPricingRoutes.ts)
  app.use(crmVendorRoutes);
  app.use(crmContactRoutes);
  app.use(vendorEnrollmentRoutes);
  app.use(vendorPricingRoutes);

  // Scope Config, Material Calculator, Trade Config, Org Work Categories (extracted to scopeConfigRoutes.ts)
  app.use(scopeConfigRoutes);

  // Project Content Routes (Notes, Media, Cost Codes, Time Entries, T&M Sheets, Estimates, Procurement, Pending Quotes)
  app.use(projectContentRoutes);

  // Project Operations Routes (Receipts, Plan Documents, File Permissions, Change Orders, Change Order Line Items, Calendar Events)
  app.use(projectOpsRoutes);

  // Notifications Routes
  app.use(notificationRoutes2);
  // Audit Log, Billing Events, Object Storage Routes
  app.use(auditBillingStorageRoutes);
  // Crews & Crew Assignments Routes
  app.use(crewRoutes2);
  // Skills & User Skills Routes
  app.use(skillRoutes);

  // Subcontractor, Data Quality, Takeoff/Estimating, Quantity Category routes
  app.use(takeoffSubRoutes);
  app.use(assemblyRoutes);

  // Internal Messaging System Routes (extracted to messagingRoutes.ts)
  await messagingSetup;
  app.use(messagingRoutes);

  // Equipment & Tool Management Routes (extracted to equipmentMgmtRoutes.ts)
  app.use(equipmentMgmtRoutes);

  // Rental Equipment & Vendor Routes (extracted from equipmentMgmtRoutes.ts)
  app.use(rentalEquipmentRoutes);

  // Equipment Plan & Bid Equipment Routes (extracted from equipmentMgmtRoutes.ts)
  app.use(equipmentPlanRoutes);

  // Mobile & Offline Sync Routes
  app.use(mobileSyncRoutes);

  // Client Portal Routes (extracted from aiFeatureRoutes)
  app.use("/api/ai-features", clientPortalRoutes);

  // Reports Routes (Takeoff & Estimate Reports)
  app.use(reportRoutes);

  // Marketing Document PDF
  const marketingPdfRoute = (await import("./marketingPdfRoute")).default;
  app.use("/api", marketingPdfRoute);

  const { registerPerformanceRoutes } = await import("./performanceRoutes");
  registerPerformanceRoutes(app);

  seedCoreTradeModifierCategories().catch(err => {
    console.error("Failed to seed core modifier categories:", err);
  });

  const cron = await import("node-cron");
  cron.schedule("0 8 * * *", async () => {
    try {
      await checkCertificationExpiry();
    } catch (err) {
      console.error("[Cert Expiry] Scheduled check failed:", err);
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}

async function checkCertificationExpiry() {
  const now = new Date();
  const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const fiveDaysFromNow = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);

  const allCerts = await db.select().from(userCertifications);

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

      await db.insert(notifications).values({
        userId: cert.userId,
        type: "GENERAL",
        title: "Certification Expiring Soon",
        message: `Your certification "${cert.certificationName}" will expire on ${new Date(cert.expiryDate).toLocaleDateString()}. Please renew it.`,
      });
    }

    if (expiryTime <= fiveDaysFromNow.getTime() && expiryTime > now.getTime() && !cert.expiryNotified5Days) {
      await db.update(userCertifications)
        .set({ expiryNotified5Days: true, updatedAt: now })
        .where(eq(userCertifications.id, cert.id));

      await db.insert(notifications).values({
        userId: cert.userId,
        type: "GENERAL",
        title: "Certification Expiring Very Soon",
        message: `Your certification "${cert.certificationName}" will expire in less than 5 days on ${new Date(cert.expiryDate).toLocaleDateString()}. Immediate action is required.`,
      });
    }
  }

  console.log(`[Cert Expiry] Checked ${allCerts.length} certifications`);
}
