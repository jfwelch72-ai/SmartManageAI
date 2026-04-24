import { logError, logInfo } from "./utils/logger";
import type { Express, NextFunction } from "express";
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
import { users, insertUserSchema, type InsertUser, type SelectUser, auditLog, billingEvents, timeClockShifts, passwordResetTokens, tradeTypeEnum, oneShotJobRuns } from "@shared/schema";
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
import jobMetricAlertRulesRoutes from "./jobMetricAlertRulesRoutes";
import timeEntryRoutes from "./timeEntryRoutes";
import payrollRoutes from "./payrollRoutes";
import searchRoutes from "./searchRoutes";
import changeOrderCrudRoutes from "./changeOrderCrudRoutes";
import changeOrderApprovalRoutes from "./changeOrderApprovalRoutes";
import changeOrderExportRoutes from "./changeOrderExportRoutes";
import delayRoutes from "./delayRoutes";
import inspectionRoutes from "./inspectionRoutes";
import permitRoutes from "./permitRoutes";
import complianceRoutes from "./complianceRoutes";
import punchListRoutes from "./punchListRoutes";
import warrantyRoutes from "./warrantyRoutes";
import aiOrchestrationRoutes from "./aiOrchestrationRoutes";
import projectDistributionListRoutes from "./projectDistributionListRoutes";
import aiOnboardingRoutes from "./aiOnboardingRoutes";
import scheduleRoutes from "./scheduleRoutes";
import notesRoutes from "./notesRoutes";
import projectNotePagesRoutes from "./projectNotePagesRoutes";
import taskRoutes from "./taskRoutes";
import estimateRoutes from "./estimateRoutes";
import { registerTMTicketRoutes } from "./tmRoutes";
import paymentRoutes from "./paymentRoutes";
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
import emailWebhookRoutes from "./emailWebhookRoutes";
import { auditWebhookSecretsAtBoot } from "./webhookSecretsAudit";
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
import publicApiRoutes from "./publicApi/routes";
import devPortalRoutes from "./publicApi/devPortalRoutes";
import { registerAllProviders } from "./integrations/providers";
import approvalRoutes from "./approvalRoutes";
import workflowRoutes from "./workflowRoutes";
import documentRevisionRoutes from "./documentRevisionRoutes";
import drawingSetRoutes from "./drawingSetRoutes";
import planPinsRoutes from "./planPinsRoutes";
import addendaRoutes from "./addendaRoutes";
import devSeedEnterpriseRoutes from "./devSeedEnterprise";
import featureFlagRoutes from "./featureFlagRoutes";
import { getIntegrationStatus } from "./services/integrationStatusService";
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
import lidarRoutes from "./lidarRoutes";
import mobilizationRoutes from "./mobilizationRoutes";
import projectCrudRoutes from "./projectCrudRoutes";
import projectContentRoutes from "./projectContentRoutes";
import projectFinancialRoutes from "./projectFinancialRoutes";
import portfolioRoutes from "./portfolioRoutes";
import scopeRoutes from "./scopeRoutes";
import locationRoutes from "./locationRoutes";
import materialTrackingRoutes from "./materialTrackingRoutes";
import productionRateRoutes from "./productionRateRoutes";
import crmRoutes from "./crmRoutes";
import crmEmailLoggingRoutes from "./crmEmailLoggingRoutes";
import crmCallsRoutes from "./crmCallsRoutes";
import crmTasksRoutes from "./crmTasksRoutes";
import sequenceRoutes from "./sequenceRoutes";
import crmQuotesRoutes from "./crmQuotesRoutes";
import crmAssignmentRulesRoutes from "./crmAssignmentRulesRoutes";
import publicLeadsRoutes from "./publicLeadsRoutes";
import crmCatalogRoutes from "./crmCatalogRoutes";
import crmCustomFieldsRoutes from "./crmCustomFieldsRoutes";
import crmAnalyticsRoutes from "./crmAnalyticsRoutes";
import crmDuplicatesRoutes from "./crmDuplicatesRoutes";
import crmLeadScoringRoutes from "./crmLeadScoringRoutes";
import publicQuoteAcceptRoutes from "./publicQuoteAcceptRoutes";
import crmLeadFormsRoutes from "./crmLeadFormsRoutes";
import crmMeetingRoutes from "./crmMeetingRoutes";
import crmSlaRoutes from "./crmSlaRoutes";
import crmAutomationsRoutes from "./crmAutomationsRoutes";
import crmCsvImportRoutes from "./crmCsvImportRoutes";
import crmCustomReportsRoutes from "./crmCustomReportsRoutes";
import projectOpsRoutes from "./projectOpsRoutes";
import projectTemplateRoutes from "./projectTemplateRoutes";
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
import safetyObservationsRoutes from "./safetyObservationsRoutes";
import safetyKpiRoutes from "./safetyKpiRoutes";
import materialTestRoutes from "./materialTestRoutes";
import projectReportRoutes from "./projectReportRoutes";
import ppeComplianceRoutes from "./ppeComplianceRoutes";
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
import emailCampaignRoutes from "./emailCampaignRoutes";
import savedViewsRoutes from "./savedViewsRoutes";
import myDayRoutes from "./myDayRoutes";
import myWorkRoutes from "./myWorkRoutes";
import devEmailRoutes from "./devEmailRoutes";
import statusPageRoutes from "./statusPageRoutes";

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

  // Global Cmd-K search
  app.use(searchRoutes);

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

  // Register permits & licenses routes
  app.use("/api", permitRoutes);

  // Register unified compliance / expirations routes
  app.use("/api/compliance", complianceRoutes);

  // Register punch list routes
  app.use("/api", punchListRoutes);
  app.use("/api", materialTestRoutes);
  app.use("/api", ppeComplianceRoutes);
  app.use("/api", warrantyRoutes);

  // Register AI routes through single orchestration layer (consolidates document, scheduling, takeoff, CFO analytics routes)
  app.use("/api", aiOrchestrationRoutes);
  app.use("/api", aiOnboardingRoutes);

  // Project-scoped reusable email distribution lists
  app.use("/api", projectDistributionListRoutes);

  // Register schedule management routes (CPM engine, baseline, resource loading, forecasting)
  app.use("/api", scheduleRoutes);

  // Register onboarding library routes (read-only reference data)
  app.use(onboardingLibraryRoutes);

  // Register daily notes routes
  app.use("/api", notesRoutes);

  // Register project note pages routes (Notion-style notes)
  app.use("/api", projectNotePagesRoutes);

  // Register task management routes
  app.use(taskRoutes);

  // Register estimate routes
  app.use(estimateRoutes);

  // Register T&M ticket routes
  registerTMTicketRoutes(app);

  // Register unified payment routes
  app.use("/api/payments", paymentRoutes);

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
  app.use("/api/webhooks/email", emailWebhookRoutes);
  // Boot-time audit (Task #883): inventory every webhook signing/shared
  // secret the app relies on (Resend Svix, generic EMAIL_WEBHOOK_SECRET,
  // Gmail Pub/Sub OIDC audience, ...) and emit one summary WARN/ERROR
  // line per missing secret so silent webhook misconfigs surface in
  // startup logs instead of the next "bounces stopped flowing" incident.
  auditWebhookSecretsAtBoot();
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
  app.use("/api/v1/public", publicApiRoutes);
  app.use("/api/integrations/dev-portal", devPortalRoutes);

  app.use("/api/weather", weatherRoutes);

  // Register Vendor routes (consolidated)
  app.use(vendorRoutes);

  app.use("/api/approvals", approvalRoutes);
  app.use("/api/workflows", workflowRoutes);
  app.use("/api/documents", documentRevisionRoutes);
  app.use("/api/projects", drawingSetRoutes);
  app.use("/api", planPinsRoutes);
  app.use("/api", addendaRoutes);

  app.use("/api/feature-flags", featureFlagRoutes);

  app.get("/api/integration-status", requireAuth, (_req, res) => {
    res.json(getIntegrationStatus());
  });

  app.use("/api/sso", ssoRoutes);
  app.use("/api/audit", auditExportRoutes);
  app.use("/api/retention", retentionRoutes);
  app.use("/api/privacy", privacyRoutes);

  // Register Safety Training routes
  app.use(safetyTrainingRoutes);
  app.use(safetyWorkflowRoutes);
  app.use(safetyObservationsRoutes);
  app.use(safetyKpiRoutes);
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

  app.use(emailCampaignRoutes);

  // Saved views (Task #575)
  app.use(savedViewsRoutes);

  // My Day — personal work inbox aggregator
  app.use(myDayRoutes);
  app.use(myWorkRoutes);

  // Dev/QA test email outbox — only active when EMAIL_TRANSPORT=noop
  app.use(devEmailRoutes);

  if (process.env.NODE_ENV === "development") {
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
  app.use(lidarRoutes);
  app.use(mobilizationRoutes);
  app.use(projectReportRoutes);

  // Project Routes (split: core CRUD, content, financial)
  app.use(projectCrudRoutes);
  app.use(projectContentRoutes);
  app.use(projectFinancialRoutes);
  app.use(portfolioRoutes);
  app.use(materialTrackingRoutes);
  app.use(productionRateRoutes);

  // CRM Routes (consolidated: vendor, contact, pipeline, enrollment, pricing)
  app.use(crmSlaRoutes);
  app.use(crmRoutes);
  app.use(crmEmailLoggingRoutes);
  app.use(crmCallsRoutes);
  app.use(crmTasksRoutes);
  app.use(sequenceRoutes);
  app.use(crmQuotesRoutes);
  app.use(crmAssignmentRulesRoutes);
  app.use(publicLeadsRoutes);
  app.use(statusPageRoutes);
  app.use(crmCatalogRoutes);
  app.use(crmCustomFieldsRoutes);
  app.use(crmAnalyticsRoutes);
  app.use(crmDuplicatesRoutes);
  app.use(crmLeadScoringRoutes);
  app.use(publicQuoteAcceptRoutes);
  app.use(crmLeadFormsRoutes);
  app.use(crmMeetingRoutes);
  app.use(crmAutomationsRoutes);
  app.use(crmCsvImportRoutes);
  app.use(crmCustomReportsRoutes);

  // Location Routes (project locations + field takeoff)
  app.use(locationRoutes);

  // Scope Routes (consolidated: scope items + scope config)
  app.use(scopeRoutes);

  // Project Operations Routes (consolidated: receipts, plan docs, file perms, change orders, calendar)
  app.use(projectOpsRoutes);
  app.use(projectTemplateRoutes);

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

  const { registerPeerRatingRoutes } = await import("./peerRatingRoutes");
  registerPeerRatingRoutes(app);

  seedCoreTradeModifierCategories().catch(err => {
    logError("Failed to seed core modifier categories:", {}, err instanceof Error ? err : new Error(String(err)));
  });

  const { default: dotRoutes } = await import("./dotRoutes");
  app.use(dotRoutes);

  // DOT seed runs from server/index.ts AFTER runStartupMigrations has created
  // the dot_* tables. Avoid invoking it here to prevent a race on cold start.

  const cron = await import("node-cron");
  cron.schedule("0 8 * * *", async () => {
    try {
      await checkCertificationExpiry();
    } catch (err) {
      logError("[Cert Expiry] Scheduled check failed:", {}, err instanceof Error ? err : new Error(String(err)));
    }
  });

  // Admin endpoint: manually trigger orphan scan
  app.post("/api/admin/storage/orphan-scan", requireAuth, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { runOrphanScan } = await import("./storageOrphanScanJob");
      const result = await runOrphanScan();
      res.json(result);
    } catch (err: any) {
      next(err);
    }
  });

  app.get("/api/admin/jobs", requireAuth, requireRole("SUPER_ADMIN"), async (_req: AuthRequest, res: Response) => {
    const { jobRegistry } = await import("./jobs");
    const jobs = Object.entries(jobRegistry).map(([name, entry]) => ({
      name,
      description: entry.description,
      schedule: entry.schedule,
    }));
    const schedulersRunning = process.env.NODE_ENV === "production" || process.env.ENABLE_SCHEDULERS === "true";
    res.json({ schedulersRunning, jobs });
  });

  app.post("/api/admin/jobs/ai-scheduler/run", requireAuth, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { runAIAnalysis } = await import("./ai/orchestrator");
      const start = Date.now();
      const runId = await runAIAnalysis(req.user!.id);
      const { logAudit } = await import("./auditLogger");
      await logAudit({ userId: req.user!.id, action: "EXECUTE", entityType: "background_job", entityId: "ai_scheduler", newValue: `Manual AI analysis trigger` }, req);
      res.json({ job: "ai_scheduler", status: "completed", runId, durationMs: Date.now() - start });
    } catch (err: any) {
      next(err);
    }
  });

  app.post("/api/admin/jobs/ai-notes/run", requireAuth, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { aiNotesScheduler } = await import("./aiNotesScheduler");
      const start = Date.now();
      await aiNotesScheduler.runNow();
      const { logAudit } = await import("./auditLogger");
      await logAudit({ userId: req.user!.id, action: "EXECUTE", entityType: "background_job", entityId: "ai_notes", newValue: `Manual AI notes trigger` }, req);
      res.json({ job: "ai_notes", status: "completed", durationMs: Date.now() - start });
    } catch (err: any) {
      next(err);
    }
  });

  // Task #700: expose the in-process job metrics surface so admins can
  // spot delivery regressions in the birthday digest (and any other job
  // that publishes counters via recordJobMetrics) without grepping logs.
  app.get("/api/admin/metrics/jobs", requireAuth, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res: Response) => {
    const { getAllJobMetricsForRange, parseMetricsRange } = await import("./utils/jobMetrics");
    const range = parseMetricsRange(req.query.range);
    res.json({ jobs: await getAllJobMetricsForRange(range), range });
  });

  app.get("/api/admin/metrics/jobs/:jobName", requireAuth, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res: Response, next: NextFunction) => {
    // Task #1495 — `/api/admin/metrics/jobs/alerts*` is a sibling
    // namespace (registered further down) for the alert engine, not a
    // job named "alerts". Skip so the more-specific handlers below
    // can match instead of returning an empty metrics envelope and
    // shadowing the wage-refresh threshold editor's GET.
    if (req.params.jobName === "alerts") {
      next();
      return;
    }
    const { getJobMetricsForRange, parseMetricsRange } = await import("./utils/jobMetrics");
    const range = parseMetricsRange(req.query.range);
    const metrics = await getJobMetricsForRange(req.params.jobName, range);
    res.json({ ...metrics, range });
  });

  // Task #713: let a Super Admin clear stored job metric history so a
  // bad deploy or noisy backfill can be flushed without manual SQL.
  // Task #717: gate both DELETE handlers behind an explicit confirmation
  // token so a misclick (or a stale curl in someone's terminal history)
  // can't silently wipe persisted trend data with no recovery.
  const { requireJobMetricsClearConfirmation, CLEAR_ALL_JOB_METRICS_CONFIRM_TOKEN } = await import("./utils/jobMetricsConfirmation");

  app.delete(
    "/api/admin/metrics/jobs",
    requireAuth,
    requireRole("SUPER_ADMIN"),
    requireJobMetricsClearConfirmation(CLEAR_ALL_JOB_METRICS_CONFIRM_TOKEN),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        const { clearJobMetrics } = await import("./utils/jobMetrics");
        const deleted = await clearJobMetrics();
        const { logAudit } = await import("./auditLogger");
        await logAudit({ userId: req.user!.id, action: "DELETE", entityType: "job_metrics", entityId: "*", oldValue: `Cleared all job metric history (${deleted} rows)` }, req);
        res.json({ cleared: "*", deleted });
      } catch (err: any) {
        next(err);
      }
    },
  );

  app.delete(
    "/api/admin/metrics/jobs/:jobName",
    requireAuth,
    requireRole("SUPER_ADMIN"),
    requireJobMetricsClearConfirmation((req) => req.params.jobName),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        const { jobName } = req.params;
        const { clearJobMetrics } = await import("./utils/jobMetrics");
        const deleted = await clearJobMetrics(jobName);
        const { logAudit } = await import("./auditLogger");
        await logAudit({ userId: req.user!.id, action: "DELETE", entityType: "job_metrics", entityId: jobName, oldValue: `Cleared job metric history for '${jobName}' (${deleted} rows)` }, req);
        res.json({ cleared: jobName, deleted });
      } catch (err: any) {
        next(err);
      }
    },
  );

  // Task #718 — Job metric alert configuration & state.
  app.get("/api/admin/metrics/jobs/alerts", requireAuth, requireRole("SUPER_ADMIN"), async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const mod = await import("./utils/jobMetricAlerts");
      const [rules, recent] = await Promise.all([
        mod.listJobMetricAlertRules(),
        mod.listRecentJobMetricAlertEvents(50),
      ]);
      res.json({
        rules,
        events: recent.events,
        activeByJob: recent.activeByJob,
        defaults: mod.ALERT_DEFAULTS,
        // Task #1452 — surface the per-job built-in overrides so the
        // admin Job Metrics dashboard can show the *effective* default
        // (e.g. 36h stall for `wage_decision_stale_refresh`) before the
        // operator has authored any custom rule.
        perJobDefaults: mod.PER_JOB_DEFAULTS,
        lastEvaluatedAt: mod.getLastEvaluationAt(),
      });
    } catch (err: any) {
      next(err);
    }
  });

  // Task #1540 — POST/DELETE for job metric alert rules now live in
  // `jobMetricAlertRulesRoutes.ts` so the route's Zod schema can be
  // imported directly by tests instead of being copy/pasted.
  app.use("/api", jobMetricAlertRulesRoutes);

  // Task #729 — acknowledge / snooze noisy alert events
  app.post("/api/admin/metrics/jobs/alerts/events/:id/acknowledge", requireAuth, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const mod = await import("./utils/jobMetricAlerts");
      const updated = await mod.acknowledgeJobMetricAlertEvent(req.params.id, req.user!.id);
      if (!updated) {
        res.status(404).json({ error: "Alert event not found" });
        return;
      }
      const { logAudit } = await import("./auditLogger");
      await logAudit({
        userId: req.user!.id,
        action: "UPDATE",
        entityType: "job_metric_alert_event",
        entityId: updated.id,
        newValue: `Acknowledged alert ${updated.job}/${updated.counter ?? "_"}/${updated.kind}`,
      }, req);
      res.json(updated);
    } catch (err: any) {
      next(err);
    }
  });

  app.post("/api/admin/metrics/jobs/alerts/events/:id/snooze", requireAuth, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const schema = z.object({ hours: z.number().positive().max(7 * 24) });
      const { hours } = schema.parse(req.body);
      const mod = await import("./utils/jobMetricAlerts");
      const updated = await mod.snoozeJobMetricAlertEvent(req.params.id, req.user!.id, hours);
      if (!updated) {
        res.status(404).json({ error: "Alert event not found" });
        return;
      }
      const { logAudit } = await import("./auditLogger");
      await logAudit({
        userId: req.user!.id,
        action: "UPDATE",
        entityType: "job_metric_alert_event",
        entityId: updated.id,
        newValue: `Snoozed ${updated.job}/${updated.counter ?? "_"}/${updated.kind} for ${hours}h until ${updated.snoozedUntil ? new Date(updated.snoozedUntil).toISOString() : "n/a"}`,
      }, req);
      res.json(updated);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid snooze request", details: err.errors });
        return;
      }
      next(err);
    }
  });

  // Task #734 — clear an active snooze early
  app.post("/api/admin/metrics/jobs/alerts/events/:id/unsnooze", requireAuth, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const mod = await import("./utils/jobMetricAlerts");
      const updated = await mod.unsnoozeJobMetricAlertEvent(req.params.id);
      if (!updated) {
        res.status(404).json({ error: "Alert event not found" });
        return;
      }
      const { logAudit } = await import("./auditLogger");
      await logAudit({
        userId: req.user!.id,
        action: "UPDATE",
        entityType: "job_metric_alert_event",
        entityId: updated.id,
        newValue: `Cleared snooze on ${updated.job}/${updated.counter ?? "_"}/${updated.kind}`,
      }, req);
      res.json(updated);
    } catch (err: any) {
      next(err);
    }
  });

  // Task #760 — Quiet-hours digest visibility
  app.get("/api/admin/metrics/jobs/alerts/digests", requireAuth, requireRole("SUPER_ADMIN"), async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const mod = await import("./utils/jobMetricAlerts");
      const sends = await mod.listRecentQuietHoursDigestSends(50);
      res.json({ sends });
    } catch (err: any) {
      next(err);
    }
  });

  app.get("/api/admin/metrics/jobs/alerts/digests/:id/events", requireAuth, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const mod = await import("./utils/jobMetricAlerts");
      const result = await mod.listEventsForQuietHoursDigestSend(req.params.id);
      if (!result) {
        res.status(404).json({ error: "Digest send not found" });
        return;
      }
      res.json(result);
    } catch (err: any) {
      next(err);
    }
  });

  // Task #770 — Download a CSV of alert events for an arbitrary range so
  // recipients can re-pull a past quiet-hours digest export without
  // hunting through their inbox. Columns mirror `buildDigestCsv` exactly.
  app.get("/api/admin/metrics/jobs/alerts/events.csv", requireAuth, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const mod = await import("./utils/jobMetricAlerts");
      const result = await mod.buildAlertEventsCsvResponse({
        query: {
          from: typeof req.query.from === "string" ? req.query.from : undefined,
          to: typeof req.query.to === "string" ? req.query.to : undefined,
          range: typeof req.query.range === "string" ? req.query.range : undefined,
          job: typeof req.query.job === "string" ? req.query.job : undefined,
          counter: typeof req.query.counter === "string" ? req.query.counter : undefined,
        },
      });
      if (!result.ok) {
        const body: Record<string, unknown> = { error: result.error };
        if (result.details !== undefined) body.details = result.details;
        res.status(result.status).json(body);
        return;
      }
      res.setHeader("Content-Type", result.contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
      res.send(result.csv);
    } catch (err: any) {
      next(err);
    }
  });

  app.post("/api/admin/metrics/jobs/alerts/digests/test", requireAuth, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const mod = await import("./utils/jobMetricAlerts");
      const summary = await mod.sendTestQuietHoursDigestToUser(req.user!.id);
      const { logAudit } = await import("./auditLogger");
      await logAudit({
        userId: req.user!.id,
        action: "EXECUTE",
        entityType: "job_metric_alert_quiet_hours_digest",
        entityId: req.user!.id,
        newValue: `Test digest: sent=${summary.digestsSent}, noEvents=${summary.digestsSkippedNoEvents}, disabled=${summary.digestsSkippedDisabled}`,
      }, req);
      res.json(summary);
    } catch (err: any) {
      next(err);
    }
  });

  app.post("/api/admin/metrics/jobs/alerts/run", requireAuth, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const mod = await import("./utils/jobMetricAlerts");
      const result = await mod.evaluateJobMetricAlerts();
      const { logAudit } = await import("./auditLogger");
      await logAudit({ userId: req.user!.id, action: "EXECUTE", entityType: "background_job", entityId: "job_metric_alerts", newValue: `Manual evaluation: ${result.alertsFired.length} fired, ${result.alertsSuppressed} suppressed` }, req);
      res.json(result);
    } catch (err: any) {
      next(err);
    }
  });

  // Task #1176's bespoke `POST /api/admin/jobs/certified-payroll-backfill/run`
  // endpoint was retired in Task #1531 once the generic one-shot jobs
  // panel learned how to collect per-job parameters (orgFilter / dryRun).
  // Use `POST /api/admin/jobs/one-shot/backfill_certified_payroll_reports_v1/rerun`
  // with a JSON body of `{ "params": { "orgFilter": "org_…", "dryRun": true } }`
  // for ops scripts.

  // Task #1413's bespoke `POST /api/admin/jobs/exhausted-sync-retry-alerts-
  // backfill/run` endpoint was retired in Task #1490 once the generic
  // one-shot jobs admin API below covered the same re-fan flow. Use
  // `POST /api/admin/jobs/one-shot/backfill_exhausted_sync_retry_alerts_v1/rerun`
  // instead.

  // Task #1448 — Generic "one-shot jobs" admin API. Lists every job
  // registered via `registerOneShotJob` joined with its `one_shot_jobs`
  // ledger row so Super Admins can see what has run and re-fan any of
  // them from a single panel without per-job endpoints. Importing the
  // runner modules here is what triggers their top-level
  // `registerOneShotJob` calls in case startup migrations haven't been
  // executed yet (defense-in-depth — they normally have by request time).
  app.get(
    "/api/admin/jobs/one-shot",
    requireAuth,
    requireRole("SUPER_ADMIN"),
    async (_req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        await import("./utils/runCertifiedPayrollBackfillOnce");
        await import("./utils/runExhaustedSyncRetryAlertsBackfillOnce");
        const {
          getRegisteredOneShotJobs,
          readOneShotJobLedger,
        } = await import("./utils/oneShotJobRegistry");

        const [descriptors, ledger] = await Promise.all([
          Promise.resolve(getRegisteredOneShotJobs()),
          readOneShotJobLedger(),
        ]);
        const ledgerByName = new Map(ledger.map((row) => [row.name, row]));
        const seen = new Set<string>();

        const jobs = descriptors.map((d) => {
          seen.add(d.name);
          const row = ledgerByName.get(d.name) ?? null;
          return {
            name: d.name,
            title: d.title,
            description: d.description,
            registered: true,
            // Task #1531 — surface declared parameters so the admin UI
            // can render an inline form before invoking the runner.
            parameters: d.parameters ?? [],
            completedAt: row?.completedAt ?? null,
            details: row?.details ?? null,
            recentRuns: [] as Array<{
              id: string;
              at: string;
              actorId: string;
              actorEmail: string | null;
              status: string | null;
              ledgerCleared: boolean | null;
              durationMs: number | null;
              error: string | null;
              raw: string | null;
            }>,
          };
        });

        // Surface ledger rows that no longer have a registered runner so ops
        // can see (and clean up) stale flags from removed jobs.
        for (const row of ledger) {
          if (seen.has(row.name)) continue;
          jobs.push({
            name: row.name,
            title: row.name,
            description:
              "Ledger row for a job that is no longer registered in this build. " +
              "Re-running is unavailable; the row can be cleared from psql if obsolete.",
            registered: false,
            parameters: [],
            completedAt: row.completedAt,
            details: row.details,
            recentRuns: [],
          });
        }

        // Task #1488 / Task #1528 — surface recent manual re-run history
        // inline so admins can see who re-ran what and when without
        // spelunking through the audit log. We read directly from the
        // dedicated `one_shot_job_runs` structured table (Task #1528),
        // which replaced the previous fragile regex-parse of
        // `audit_log.new_value`. We pull the last ~5 entries per job.
        const RECENT_PER_JOB = 5;
        const jobNames = jobs.map((j) => j.name);
        if (jobNames.length > 0) {
          const runRows = await db
            .select({
              id: oneShotJobRuns.id,
              jobName: oneShotJobRuns.jobName,
              userId: oneShotJobRuns.runByUserId,
              userEmail: users.email,
              status: oneShotJobRuns.status,
              ledgerCleared: oneShotJobRuns.ledgerCleared,
              durationMs: oneShotJobRuns.durationMs,
              errorText: oneShotJobRuns.errorText,
              startedAt: oneShotJobRuns.startedAt,
              finishedAt: oneShotJobRuns.finishedAt,
            })
            .from(oneShotJobRuns)
            .leftJoin(users, eq(oneShotJobRuns.runByUserId, users.id))
            .where(inArray(oneShotJobRuns.jobName, jobNames))
            .orderBy(desc(oneShotJobRuns.startedAt))
            .limit(jobNames.length * RECENT_PER_JOB * 4);

          const runsByJob = new Map<string, (typeof jobs)[number]["recentRuns"]>();
          for (const row of runRows) {
            const list = runsByJob.get(row.jobName) ?? [];
            if (list.length >= RECENT_PER_JOB) continue;
            list.push({
              id: row.id,
              at: row.startedAt.toISOString(),
              actorId: row.userId,
              actorEmail: row.userEmail ?? null,
              status: row.status,
              ledgerCleared: row.ledgerCleared,
              durationMs: row.durationMs,
              error: row.errorText,
              raw: null,
            });
            runsByJob.set(row.jobName, list);
          }
          for (const job of jobs) {
            job.recentRuns = runsByJob.get(job.name) ?? [];
          }
        }

        res.json({ jobs });
      } catch (err: any) {
        next(err);
      }
    },
  );

  app.post(
    "/api/admin/jobs/one-shot/:name/rerun",
    requireAuth,
    requireRole("SUPER_ADMIN"),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        await import("./utils/runCertifiedPayrollBackfillOnce");
        await import("./utils/runExhaustedSyncRetryAlertsBackfillOnce");
        const { getOneShotJob, runOneShotJob } = await import(
          "./utils/oneShotJobRegistry"
        );

        const name = String(req.params.name ?? "");
        if (!getOneShotJob(name)) {
          return res
            .status(404)
            .json({ error: `Unknown one-shot job: ${name}` });
        }

        // Task #1531 — accept an optional `params` object so the panel
        // (and ops scripts) can pass per-job options like the certified-
        // payroll runner's orgFilter / dryRun. Validation lives in
        // `coerceOneShotJobParams` inside `runOneShotJob`.
        const body = (req.body ?? {}) as { params?: Record<string, unknown> | null };
        const rawParams =
          body.params && typeof body.params === "object" ? body.params : null;

        const startedAt = new Date();
        let outcome;
        try {
          outcome = await runOneShotJob(name, rawParams);
        } catch (err) {
          return res
            .status(400)
            .json({ error: err instanceof Error ? err.message : String(err) });
        }
        // Capture a real wall-clock finish timestamp rather than
        // deriving startedAt + outcome.durationMs, since registry
        // implementations measure durationMs themselves and the two
        // can drift if a runner adjusts its own timing.
        const finishedAt = new Date();

        const paramSummary = Object.keys(outcome.params).length
          ? ` params=${JSON.stringify(outcome.params)}`
          : "";

        // Task #1528 — persist the structured outcome so the admin
        // panel can read fields directly instead of regex-parsing the
        // audit_log message. Wrapped in try/catch so a logging failure
        // never masks the actual job outcome from the caller.
        try {
          await db.insert(oneShotJobRuns).values({
            jobName: name,
            runByUserId: req.user!.id,
            status: outcome.status,
            ledgerCleared: outcome.ledgerCleared,
            durationMs: outcome.durationMs,
            errorText: outcome.error,
            startedAt,
            finishedAt,
          });
        } catch (logErr) {
          logError(
            `[admin] Failed to record one_shot_job_runs row for ${name}`,
            {},
            logErr instanceof Error ? logErr : new Error(String(logErr)),
          );
        }

        // Keep the generic audit_log entry (compliance trail) but the
        // admin UI no longer parses `newValue` — that's served from
        // `one_shot_job_runs` above (Task #1528).
        const { logAudit } = await import("./auditLogger");
        await logAudit(
          {
            userId: req.user!.id,
            action: "EXECUTE",
            entityType: "background_job",
            entityId: name,
            newValue:
              `Manual one-shot re-run via admin panel ` +
              `(status=${outcome.status}, ledgerCleared=${outcome.ledgerCleared}, ` +
              `durationMs=${outcome.durationMs}${paramSummary}` +
              `${outcome.error ? `, error=${outcome.error}` : ""})`,
          },
          req,
        );

        logInfo(
          `[admin] one-shot job ${name} re-run by ${req.user!.id} — ` +
            `status=${outcome.status}, ledgerCleared=${outcome.ledgerCleared}, ` +
            `${outcome.durationMs}ms${paramSummary}`,
        );

        res.json(outcome);
      } catch (err: any) {
        next(err);
      }
    },
  );

  // Task #1401: surface the most recent `wage_decision_stale_refresh`
  // sweep summary on the admin Jobs dashboard so operators can confirm
  // at a glance that prevailing wage rates are being kept fresh and
  // quickly spot cred/quota issues without grepping logs.
  app.get(
    "/api/admin/jobs/wage_decision_stale_refresh/last-run",
    requireAuth,
    requireRole("SUPER_ADMIN"),
    async (_req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        const {
          getLastStaleWageDecisionSweep,
          getRecentStaleWageDecisionSweeps,
          getWageDecisionStaleAfterDays,
        } = await import("./integrations/providers/dol_davis_bacon/sync");
        // Task #1410 — sweep history is now persisted to
        // `job_metric_samples`, so the dashboard stays accurate across
        // restarts/deploys instead of showing "No sweep recorded yet"
        // until the next 06:00 UTC tick. We also surface the last 10
        // sweeps so operators can spot trends.
        const [lastRun, recent] = await Promise.all([
          getLastStaleWageDecisionSweep(),
          getRecentStaleWageDecisionSweeps(10),
        ]);
        res.json({
          lastRun,
          recent,
          staleAfterDays: getWageDecisionStaleAfterDays(),
        });
      } catch (err: any) {
        next(err);
      }
    },
  );

  // Task #1429: surface the most recent `wage_decision_orphan_sweep`
  // counts on the admin Jobs dashboard so a misconfigured retention
  // window or a sudden spike in deletions doesn't go unnoticed. The
  // orphan cleanup runs as part of the wage-decision retry sweep but
  // its counters are tracked under a dedicated job alias.
  app.get(
    "/api/admin/jobs/wage_decision_orphan_sweep/last-run",
    requireAuth,
    requireRole("SUPER_ADMIN"),
    async (_req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        const {
          getLastOrphanedWageDecisionSweep,
          getRecentOrphanedWageDecisionSweeps,
        } = await import("./integrations/providers/dol_davis_bacon/sync");
        const [lastRun, recent] = await Promise.all([
          getLastOrphanedWageDecisionSweep(),
          getRecentOrphanedWageDecisionSweeps(10),
        ]);
        res.json({ lastRun, recent });
      } catch (err: any) {
        next(err);
      }
    },
  );

  app.post("/api/admin/jobs/:jobName/run", requireAuth, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { jobName } = req.params;
      const { jobRegistry } = await import("./jobs");
      const entry = jobRegistry[jobName];
      if (!entry) {
        res.status(404).json({ error: `Job '${jobName}' not found`, available: Object.keys(jobRegistry) });
        return;
      }
      const start = Date.now();
      await entry.fn();
      const durationMs = Date.now() - start;
      const { logAudit } = await import("./auditLogger");
      await logAudit({ userId: req.user!.id, action: "EXECUTE", entityType: "background_job", entityId: jobName, newValue: `Manual trigger completed in ${durationMs}ms` }, req);
      res.json({ job: jobName, status: "completed", durationMs });
    } catch (err: any) {
      next(err);
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

  logInfo(`[Cert Expiry] Checked ${allCerts.length} certifications`);
}
