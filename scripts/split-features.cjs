const ts = require('typescript');
const fs = require('fs');
const path = require('path');

const SRC = 'shared/schema/features.ts';
const OUT_DIR = 'shared/schema/features';

const src = fs.readFileSync(SRC, 'utf8');
const sf = ts.createSourceFile(SRC, src, ts.ScriptTarget.ESNext, true);

// ---- Step 1: collect top-level statements with metadata ----

function collectDefines(stmt) {
  const names = [];
  if (ts.isVariableStatement(stmt)) {
    for (const d of stmt.declarationList.declarations) {
      if (ts.isIdentifier(d.name)) names.push(d.name.text);
    }
  } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
    names.push(stmt.name.text);
  } else if (ts.isTypeAliasDeclaration(stmt)) {
    names.push(stmt.name.text);
  } else if (ts.isInterfaceDeclaration(stmt)) {
    names.push(stmt.name.text);
  } else if (ts.isEnumDeclaration(stmt)) {
    names.push(stmt.name.text);
  }
  return names;
}

function collectIdentifiers(stmt, allow) {
  const refs = new Set();
  function visit(node) {
    if (ts.isIdentifier(node)) {
      if (allow.has(node.text)) refs.add(node.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(stmt);
  return refs;
}

// First pass: collect all defined names
const allDefines = new Set();
const stmts = [];
for (const stmt of sf.statements) {
  if (ts.isImportDeclaration(stmt)) continue;
  const defines = collectDefines(stmt);
  for (const n of defines) allDefines.add(n);
  stmts.push({ stmt, defines });
}

// Second pass: collect refs
for (const item of stmts) {
  item.refs = collectIdentifiers(item.stmt, allDefines);
  // Don't count self-references
  for (const d of item.defines) item.refs.delete(d);
}

// ---- Step 2: bucketing rules ----
// Each define -> domain. We use ordered prefix matching with explicit overrides.

const DOMAIN_RULES = [
  // Top-of-file metadata stays in misc
  { match: (n) => n.startsWith('FEATURE_FLAG') || n === 'FeatureFlagKey' || n === 'FeatureFlagCategory' || n === 'HEAVY_CIVIL_TRADE_TYPES' || n === 'isHeavyCivilTrade' || n === 'DISABLED_BY_DEFAULT_FLAGS', domain: 'flags' },

  // Heavy Civil / DOT
  { match: (n) => /^dot[A-Z_]/i.test(n) || n.startsWith('Dot') || n.startsWith('InsertDot'), domain: 'dot' },
  { match: (n) => /^haulTicket/i.test(n) || /^HaulTicket/.test(n) || n === 'InsertHaulTicket' || n === 'HaulTicket', domain: 'dot' },
  { match: (n) => /^suretyBond/i.test(n) || n.startsWith('SuretyBond') || n.startsWith('InsertSuretyBond'), domain: 'dot' },
  { match: (n) => /^dailyInspectorReport/i.test(n) || /^DailyInspectorReport/.test(n) || n === 'InsertDailyInspectorReport', domain: 'dot' },
  { match: (n) => /^swppp/i.test(n) || n.startsWith('Swppp') || n.startsWith('InsertSwppp'), domain: 'dot' },
  { match: (n) => /^materialCertification/i.test(n) || n.startsWith('MaterialCertification') || n.startsWith('InsertMaterialCertification'), domain: 'dot' },
  { match: (n) => n === 'projectDbeGoals' || n === 'ProjectDbeGoal' || n === 'InsertProjectDbeGoal', domain: 'dot' },
  { match: (n) => n === 'crmOrganisationCertifications' || n === 'CrmOrganisationCertification' || n === 'InsertCrmOrganisationCertification', domain: 'dot' },

  // Hiring
  { match: (n) => /^hiring/i.test(n) || n.startsWith('Hiring') || n.startsWith('InsertHiring'), domain: 'hiring' },
  { match: (n) => /^talent/i.test(n) || n.startsWith('Talent') || n.startsWith('InsertTalent'), domain: 'hiring' },

  // CRM (incl. sequences, quotes, calls, transcripts)
  { match: (n) => /^crm/i.test(n) || n.startsWith('Crm') || n.startsWith('InsertCrm') || n === 'CRM_TRANSCRIPT_BACKFILL_DEFAULT_CHANNEL' || n === 'CRM_TRANSCRIPT_BACKFILL_VALID_CHANNELS' || n === 'CRM_LEAD_SCORING_RULE_VALID_OPERATORS', domain: 'crm' },

  // Email (org email, threads, sync)
  { match: (n) => n.startsWith('email') || n.startsWith('Email') || n.startsWith('InsertEmail') || n === 'EMAIL_PROVIDERS' || n === 'EMAIL_TASK_SOURCES', domain: 'email' },

  // Website / blog / social
  { match: (n) => /^(organizationWebsite|website|page|blogPost|websiteBlog|websiteAnalytics|websiteContact|websiteProject|organizationSocialLinks|socialPostHistory|pagePreview|pageVersion)/.test(n) || n.startsWith('Website') || n.startsWith('InsertWebsite') || n.startsWith('PagePreview') || n.startsWith('PageVersion') || n.startsWith('OrganizationWebsite') || n.startsWith('OrganizationSocialLink') || n.startsWith('SocialPostHistory'), domain: 'website' },
  { match: (n) => n.startsWith('socialAccount') || n.startsWith('socialMediaPost') || n.startsWith('socialPostAnalytic') || n.startsWith('SocialAccount') || n.startsWith('SocialMediaPost') || n.startsWith('SocialPostAnalytic') || n.startsWith('InsertSocialAccount') || n.startsWith('InsertSocialMediaPost') || n.startsWith('InsertSocialPostAnalytic'), domain: 'website' },

  // Mobile / offline
  { match: (n) => n.startsWith('mobile') || n.startsWith('Mobile') || n.startsWith('InsertMobile') || n.startsWith('offline') || n.startsWith('Offline') || n.startsWith('InsertOffline'), domain: 'mobile' },

  // Integrations
  { match: (n) => n.startsWith('integration') || n.startsWith('Integration') || n.startsWith('InsertIntegration'), domain: 'integrations' },
  { match: (n) => n.startsWith('qbo') || n.startsWith('Qbo') || n.startsWith('InsertQbo'), domain: 'integrations' },
  { match: (n) => n.startsWith('sage') || n.startsWith('Sage') || n.startsWith('InsertSage'), domain: 'integrations' },
  { match: (n) => n.startsWith('zapier') || n.startsWith('Zapier') || n.startsWith('InsertZapier'), domain: 'integrations' },

  // Wage decision rate change (Davis-Bacon)
  { match: (n) => n.startsWith('wageDecisionRateChange') || n.startsWith('WageDecisionRateChange') || n.startsWith('InsertWageDecision'), domain: 'integrations' },

  // Subcontractor / sub
  { match: (n) => n.startsWith('subcontractor') || n.startsWith('Subcontractor') || n.startsWith('InsertSubcontractor') || n.startsWith('subcontract') || n.startsWith('Subcontract') || n.startsWith('InsertSubcontract') || n.startsWith('subPay') || n.startsWith('SubPay') || n.startsWith('InsertSubPay') || n.startsWith('subRetention') || n.startsWith('SubRetention') || n.startsWith('InsertSubRetention') || n.startsWith('subPerformance') || n.startsWith('SubPerformance') || n.startsWith('InsertSubPerformance') || n.startsWith('sovRevisionHistory') || n.startsWith('SovRevisionHistory') || n.startsWith('InsertSovRevisionHistory'), domain: 'subcontractor' },

  // Subcontractor portal / bid invitations
  { match: (n) => n.startsWith('bidRequestClarification') || n.startsWith('BidRequestClarification') || n.startsWith('InsertBidRequestClarification'), domain: 'subcontractor' },
  { match: (n) => n.startsWith('subcontractorPortalToken') || n.startsWith('SubcontractorPortalToken') || n.startsWith('InsertSubcontractorPortalToken') || n.startsWith('portalActivity') || n.startsWith('PortalActivity') || n.startsWith('InsertPortalActivity') || n.startsWith('bidDocumentDistribution') || n.startsWith('BidDocumentDistribution') || n.startsWith('InsertBidDocumentDistribution') || n.startsWith('portalChat') || n.startsWith('PortalChat') || n.startsWith('InsertPortalChat'), domain: 'portal' },
  { match: (n) => n.startsWith('clientPortal') || n.startsWith('ClientPortal') || n.startsWith('InsertClientPortal'), domain: 'portal' },

  // Equipment & rentals
  { match: (n) => n.startsWith('equipment') || n.startsWith('Equipment') || n.startsWith('InsertEquipment') || n.startsWith('rental') || n.startsWith('Rental') || n.startsWith('InsertRental'), domain: 'equipment' },
  { match: (n) => n === 'vendorServiceCatalog' || n === 'VendorServiceCatalog' || n === 'InsertVendorServiceCatalog' || n === 'bidEquipmentSelections' || n === 'BidEquipmentSelection' || n === 'InsertBidEquipmentSelection' || n === 'projectEquipmentPlans' || n === 'ProjectEquipmentPlan' || n === 'InsertProjectEquipmentPlan', domain: 'equipment' },

  // Vendor pricing
  { match: (n) => n.startsWith('vendorPric') || n.startsWith('VendorPric') || n.startsWith('InsertVendorPric') || n === 'vendorEnrollments' || n === 'VendorEnrollment' || n === 'InsertVendorEnrollment' || n === 'vendorUsers' || n === 'VendorUser' || n === 'InsertVendorUser' || n.startsWith('pricebook') || n.startsWith('Pricebook') || n.startsWith('InsertPricebook') || n === 'vendorScores' || n === 'VendorScore' || n === 'InsertVendorScore' || n === 'materialPriceIndex' || n === 'MaterialPriceIndex' || n === 'InsertMaterialPriceIndex' || n === 'pricebookImportJobs' || n === 'PricebookImportJob' || n === 'InsertPricebookImportJob', domain: 'vendor_pricing' },

  // RFI / Submittals / Transmittals
  { match: (n) => n.startsWith('rfi') || n.startsWith('Rfi') || n.startsWith('InsertRfi') || n.startsWith('RFI'), domain: 'rfi' },
  { match: (n) => n.startsWith('submittal') || n.startsWith('Submittal') || n.startsWith('InsertSubmittal'), domain: 'rfi' },
  { match: (n) => n.startsWith('documentTransmittal') || n.startsWith('DocumentTransmittal') || n.startsWith('InsertDocumentTransmittal') || n.startsWith('transmittalRecipient') || n.startsWith('TransmittalRecipient') || n.startsWith('InsertTransmittalRecipient'), domain: 'rfi' },

  // Project log email schedule (related to RFI/submittal)
  { match: (n) => n.startsWith('projectEmailDistribution') || n.startsWith('ProjectEmailDistribution') || n.startsWith('InsertProjectEmailDistribution') || n.startsWith('projectLogEmail') || n.startsWith('ProjectLogEmail') || n.startsWith('InsertProjectLogEmail'), domain: 'rfi' },

  // Contracts / signature requests
  { match: (n) => n.startsWith('contract') || n.startsWith('Contract') || n.startsWith('InsertContract') || n.startsWith('signatureRequest') || n.startsWith('SignatureRequest') || n.startsWith('InsertSignatureRequest'), domain: 'contracts' },

  // SOV / pay applications / lien waivers / stored materials / retention
  { match: (n) => n.startsWith('schedulesOfValues') || n.startsWith('scheduleOfValues') || n.startsWith('ScheduleOfValues') || n.startsWith('InsertScheduleOfValues') || n.startsWith('sovLineItem') || n.startsWith('SovLineItem') || n.startsWith('InsertSovLineItem') || n.startsWith('sovPayment') || n.startsWith('SovPayment') || n.startsWith('InsertSovPayment') || n.startsWith('lienWaiver') || n.startsWith('LienWaiver') || n.startsWith('InsertLienWaiver') || n.startsWith('payApplication') || n.startsWith('PayApplication') || n.startsWith('InsertPayApplication') || n.startsWith('storedMaterial') || n.startsWith('StoredMaterial') || n.startsWith('InsertStoredMaterial') || n.startsWith('retentionRelease') || n.startsWith('RetentionRelease') || n.startsWith('InsertRetentionRelease'), domain: 'financial' },
  { match: (n) => n.startsWith('unifiedPayment') || n.startsWith('UnifiedPayment') || n.startsWith('InsertUnifiedPayment') || n.startsWith('revenueRecognition') || n.startsWith('RevenueRecognition') || n.startsWith('InsertRevenueRecognition'), domain: 'financial' },
  { match: (n) => n.startsWith('overheadCost') || n.startsWith('OverheadCost') || n.startsWith('InsertOverheadCost'), domain: 'financial' },

  // Compliance / approvals / docs / addenda / audit / risks / data subject / sso / sessions
  { match: (n) => n.startsWith('approvalRequest') || n.startsWith('ApprovalRequest') || n.startsWith('InsertApprovalRequest'), domain: 'compliance' },
  { match: (n) => n.startsWith('documentRevision') || n.startsWith('DocumentRevision') || n.startsWith('InsertDocumentRevision') || n.startsWith('addenda') || n.startsWith('addendum') || n.startsWith('Addendum') || n.startsWith('InsertAddendum'), domain: 'compliance' },
  { match: (n) => n.startsWith('aiActionAudit') || n.startsWith('AiActionAudit') || n.startsWith('InsertAiActionAudit') || n.startsWith('errorLog') || n.startsWith('ErrorLog') || n.startsWith('InsertErrorLog'), domain: 'compliance' },
  { match: (n) => n.startsWith('ssoConfiguration') || n.startsWith('SsoConfiguration') || n.startsWith('InsertSsoConfiguration') || n.startsWith('activeSession') || n.startsWith('ActiveSession') || n.startsWith('InsertActiveSession') || n.startsWith('passkeyCredential') || n.startsWith('PasskeyCredential') || n.startsWith('InsertPasskeyCredential') || n.startsWith('userTotp') || n.startsWith('UserTotp') || n.startsWith('InsertUserTotp') || n.startsWith('userSession') || n.startsWith('UserSession') || n.startsWith('InsertUserSession') || n.startsWith('userApiKey') || n.startsWith('UserApiKey') || n.startsWith('InsertUserApiKey'), domain: 'compliance' },
  { match: (n) => n === 'SUPPORTED_RETENTION_POLICY_COMBOS' || n === 'isSupportedRetentionPolicyCombo' || n === 'ObjectAclPolicyRecord', domain: 'compliance' },
  { match: (n) => n === 'TABLE_DENSITY_VALUES' || n === 'TableDensity' || n === 'BIRTHDAY_DIGEST_DEFAULT_WEEKDAY' || n === 'BIRTHDAY_DIGEST_DEFAULT_HOUR', domain: 'user_settings' },
  { match: (n) => /^(DEFAULT_ALLOW_TWO_FINGER_ROTATE|DEFAULT_PALM_REJECTION_BAND_PX|PALM_REJECTION_BAND_(MIN|MAX)_PX|DEFAULT_STYLUS_LONG_PRESS_MS|STYLUS_LONG_PRESS_(MIN|MAX)_MS|BULK_SCALE_PROPAGATION_CONFIRM_MIN_MEMBERS|DEFAULT_SKIP_BULK_SCALE_PROPAGATION_CONFIRM)$/.test(n), domain: 'user_settings' },
  { match: (n) => n === 'PROJECT_LOG_EMAIL_LOG_TYPES' || n === 'PROJECT_LOG_EMAIL_CADENCES' || n === 'PROJECT_LOG_EMAIL_ATTEMPT_STATUSES' || n === 'PROJECT_LOG_EMAIL_TRIGGER_TYPES', domain: 'rfi' },
  { match: (n) => n === 'UnitOfMeasure' || n === 'InsertUnitOfMeasure' || n === 'insertUnitOfMeasureSchema', domain: 'org_catalog' },
  { match: (n) => n === 'DashboardWidgetConfig' || n === 'DashboardSectionConfig' || n === 'DashboardLayoutConfig' || n === 'ColorContrastResult' || n === 'PaletteValidationResult', domain: 'user_settings' },
  { match: (n) => n === 'ZAPIER_EVENT_TYPES' || n === 'PUBLIC_API_SCOPES' || n === 'PublicApiScope' || n === 'PUBLIC_API_EVENT_TYPES' || n === 'PublicApiEventType', domain: 'integrations' },
  { match: (n) => /^(AI|insertAI)(BidDocumentAnalysis|ContractDocumentAnalysis|DataQuality)/.test(n) || /^Insert(AI)(BidDocumentAnalysis|ContractDocumentAnalysis|DataQuality)/.test(n), domain: 'ai' },
  { match: (n) => n === 'validatedEquipmentSchema' || n === 'ValidatedInsertEquipment', domain: 'equipment' },
  { match: (n) => n === 'normalizeSnapModesUsed' || n === 'updateTakeoffMeasurementSchema' || n === 'AssemblyComponent', domain: 'takeoff' },
  { match: (n) => n.startsWith('retentionPolic') || n.startsWith('RetentionPolic') || n.startsWith('InsertRetentionPolic') || n.startsWith('dataProcessingRecord') || n.startsWith('DataProcessingRecord') || n.startsWith('InsertDataProcessingRecord') || n.startsWith('dataSubjectRequest') || n.startsWith('DataSubjectRequest') || n.startsWith('InsertDataSubjectRequest'), domain: 'compliance' },
  { match: (n) => n.startsWith('projectRisk') || n.startsWith('ProjectRisk') || n.startsWith('InsertProjectRisk'), domain: 'compliance' },
  { match: (n) => n.startsWith('platformAnnouncement') || n.startsWith('PlatformAnnouncement') || n.startsWith('InsertPlatformAnnouncement') || n.startsWith('announcementDismissal') || n.startsWith('AnnouncementDismissal') || n.startsWith('InsertAnnouncementDismissal'), domain: 'compliance' },

  // Workflows (no-code workflow builder)
  { match: (n) => n.startsWith('workflow') || n.startsWith('Workflow') || n.startsWith('InsertWorkflow') || n.startsWith('globalWorkflow') || n.startsWith('GlobalWorkflow') || n.startsWith('InsertGlobalWorkflow'), domain: 'workflows' },

  // Safety / quality / OSHA / toolbox talks / incidents
  { match: (n) => n.startsWith('safety') || n.startsWith('Safety') || n.startsWith('InsertSafety') || n.startsWith('toolboxTalk') || n.startsWith('ToolboxTalk') || n.startsWith('InsertToolboxTalk') || n.startsWith('oshaIncident') || n.startsWith('OshaIncident') || n.startsWith('InsertOshaIncident') || n.startsWith('qualityIssue') || n.startsWith('QualityIssue') || n.startsWith('InsertQualityIssue'), domain: 'safety' },

  // Performance / ratings / rewards / employee
  { match: (n) => n.startsWith('rating') || n.startsWith('Rating') || n.startsWith('InsertRating') || n.startsWith('reward') || n.startsWith('Reward') || n.startsWith('InsertReward') || n.startsWith('employeeRating') || n.startsWith('EmployeeRating') || n.startsWith('InsertEmployeeRating') || n.startsWith('employeePerformance') || n.startsWith('EmployeePerformance') || n.startsWith('InsertEmployeePerformance') || n.startsWith('peerRating') || n.startsWith('PeerRating') || n.startsWith('InsertPeerRating') || n.startsWith('performanceReview') || n.startsWith('PerformanceReview') || n.startsWith('InsertPerformanceReview') || n.startsWith('attendanceLog') || n.startsWith('AttendanceLog') || n.startsWith('InsertAttendanceLog') || n.startsWith('safetyIncident') || n.startsWith('SafetyIncident') || n.startsWith('InsertSafetyIncident') || n.startsWith('supervisorNote') || n.startsWith('SupervisorNote') || n.startsWith('InsertSupervisorNote') || n.startsWith('workerLog') || n.startsWith('WorkerLog') || n.startsWith('InsertWorkerLog'), domain: 'performance' },

  // KPIs
  { match: (n) => n.startsWith('kpi') || n.startsWith('Kpi') || n.startsWith('InsertKpi'), domain: 'kpi' },

  // Project schedule (Gantt / CPM)
  { match: (n) => n.startsWith('projectSchedule') || n.startsWith('ProjectSchedule') || n.startsWith('InsertProjectSchedule') || n.startsWith('scheduleBaseline') || n.startsWith('ScheduleBaseline') || n.startsWith('InsertScheduleBaseline') || n.startsWith('scheduleTask') || n.startsWith('ScheduleTask') || n.startsWith('InsertScheduleTask') || n.startsWith('scheduleForecast') || n.startsWith('ScheduleForecast') || n.startsWith('InsertScheduleForecast'), domain: 'schedule' },
  { match: (n) => n.startsWith('ganttPdf') || n.startsWith('GanttPdf') || n.startsWith('InsertGanttPdf') || n.startsWith('portfolioPdf') || n.startsWith('PortfolioPdf') || n.startsWith('InsertPortfolioPdf') || n.startsWith('pdfAlert') || n.startsWith('PdfAlert') || n.startsWith('InsertPdfAlert'), domain: 'schedule' },

  // Drawings (drawing sets)
  { match: (n) => n.startsWith('drawingSet') || n.startsWith('DrawingSet') || n.startsWith('InsertDrawingSet'), domain: 'drawings' },

  // Messaging / video calls
  { match: (n) => n.startsWith('conversation') || n.startsWith('Conversation') || n.startsWith('InsertConversation') || n.startsWith('message') || n.startsWith('Message') || n.startsWith('InsertMessage') || n.startsWith('videoCall') || n.startsWith('VideoCall') || n.startsWith('InsertVideoCall'), domain: 'messaging' },

  // Crews / skills / users
  { match: (n) => n === 'crews' || n === 'Crew' || n === 'InsertCrew' || n.startsWith('crewMember') || n.startsWith('CrewMember') || n.startsWith('InsertCrewMember') || n.startsWith('crewProjectAssignment') || n.startsWith('CrewProjectAssignment') || n.startsWith('InsertCrewProjectAssignment') || n.startsWith('crewMarketplace') || n.startsWith('CrewMarketplace') || n.startsWith('InsertCrewMarketplace'), domain: 'crew' },
  { match: (n) => n === 'skills' || n === 'Skill' || n === 'InsertSkill' || n.startsWith('userSkill') || n.startsWith('UserSkill') || n.startsWith('InsertUserSkill') || n.startsWith('skillVerification') || n.startsWith('SkillVerification') || n.startsWith('InsertSkillVerification') || n.startsWith('userCertification') || n.startsWith('UserCertification') || n.startsWith('InsertUserCertification') || n.startsWith('userEquipmentCompet') || n.startsWith('UserEquipmentCompet') || n.startsWith('InsertUserEquipmentCompet') || n.startsWith('userPhoto') || n.startsWith('UserPhoto') || n.startsWith('InsertUserPhoto'), domain: 'crew' },

  // Hustler module
  { match: (n) => n.startsWith('hustler') || n.startsWith('Hustler') || n.startsWith('InsertHustler') || n === 'organizationNetworkSettings' || n === 'OrganizationNetworkSettings' || n === 'InsertOrganizationNetworkSettings' || n === 'marketplaceReviews' || n === 'MarketplaceReview' || n === 'InsertMarketplaceReview', domain: 'hustler' },

  // Subcontractor bid requests (separate from sub portal)
  { match: (n) => n.startsWith('subcontractorBidRequest') || n.startsWith('SubcontractorBidRequest') || n.startsWith('InsertSubcontractorBidRequest') || n.startsWith('subcontractorBidInvitation') || n.startsWith('SubcontractorBidInvitation') || n.startsWith('InsertSubcontractorBidInvitation') || n.startsWith('subcontractorBidResponse') || n.startsWith('SubcontractorBidResponse') || n.startsWith('InsertSubcontractorBidResponse'), domain: 'subcontractor' },

  // Estimator (AI estimator)
  { match: (n) => n.startsWith('aiEstimator') || n.startsWith('AiEstimator') || n.startsWith('InsertAiEstimator') || n.startsWith('AIEstimator') || n.startsWith('InsertAIEstimator') || n === 'AI_ESTIMATOR_FEEDBACK_ACTIONS' || n === 'AI_ESTIMATOR_KNOWLEDGE_KINDS' || n === 'AI_ESTIMATOR_INGEST_KINDS' || n === 'AI_ESTIMATOR_INGEST_STATUSES' || n === 'AI_ESTIMATOR_RATE_SAMPLE_SOURCES', domain: 'ai_estimator' },

  // Estimate (estimating engine settings/versions/etc.)
  { match: (n) => n.startsWith('estimate') || n.startsWith('Estimate') || n.startsWith('InsertEstimate'), domain: 'estimate' },

  // Takeoff (incl. BIM, scope, modifiers, library, saved scale)
  { match: (n) => n.startsWith('takeoff') || n.startsWith('Takeoff') || n.startsWith('InsertTakeoff') || n.startsWith('TAKEOFF_') || n.startsWith('MEASUREMENT_'), domain: 'takeoff' },
  { match: (n) => n.startsWith('bim') || n.startsWith('Bim') || n.startsWith('InsertBim'), domain: 'takeoff' },
  { match: (n) => n.startsWith('scope') || n.startsWith('Scope') || n.startsWith('InsertScope') || n.startsWith('modifier') || n.startsWith('Modifier') || n.startsWith('InsertModifier') || n.startsWith('masterModifier') || n.startsWith('MasterModifier') || n.startsWith('InsertMasterModifier') || n.startsWith('materialCalculator') || n.startsWith('MaterialCalculator') || n.startsWith('InsertMaterialCalculator') || n.startsWith('bidModifierSelection') || n.startsWith('BidModifierSelection') || n.startsWith('InsertBidModifierSelection'), domain: 'takeoff' },
  { match: (n) => n.startsWith('savedScale') || n.startsWith('SavedScale') || n.startsWith('InsertSavedScale') || n.startsWith('savedTakeoff') || n.startsWith('SavedTakeoff') || n.startsWith('InsertSavedTakeoff') || n.startsWith('handoffPacket') || n.startsWith('HandoffPacket') || n.startsWith('InsertHandoffPacket') || n.startsWith('projectPlan') || n.startsWith('ProjectPlan') || n.startsWith('InsertProjectPlan') || n === 'projectLocations' || n === 'ProjectLocation' || n === 'InsertProjectLocation' || n.startsWith('insertProjectLocation') || n.startsWith('quantityCategor') || n.startsWith('QuantityCategor') || n.startsWith('InsertQuantityCategor') || n.startsWith('projectSpec') || n.startsWith('ProjectSpec') || n.startsWith('InsertProjectSpec'), domain: 'takeoff' },

  // Library
  { match: (n) => n.startsWith('library') || n.startsWith('Library') || n.startsWith('InsertLibrary') || n.startsWith('customLibrar') || n.startsWith('CustomLibrar') || n.startsWith('InsertCustomLibrar'), domain: 'library' },

  // Org-level catalogs / trade templates / org documents / units / master*
  { match: (n) => n.startsWith('tradeTemplate') || n.startsWith('TradeTemplate') || n.startsWith('InsertTradeTemplate') || n.startsWith('tradeFeature') || n.startsWith('TradeFeature') || n.startsWith('InsertTradeFeature') || n.startsWith('organizationCalculator') || n.startsWith('OrganizationCalculator') || n.startsWith('InsertOrganizationCalculator') || n.startsWith('organizationWorkType') || n.startsWith('OrganizationWorkType') || n.startsWith('InsertOrganizationWorkType') || n.startsWith('organizationSowItem') || n.startsWith('OrganizationSowItem') || n.startsWith('InsertOrganizationSowItem') || n.startsWith('sowAuditLog') || n.startsWith('SowAuditLog') || n.startsWith('InsertSowAuditLog') || n.startsWith('organizationDocument') || n.startsWith('OrganizationDocument') || n.startsWith('InsertOrganizationDocument') || n.startsWith('unitsOfMeasure') || n.startsWith('UnitsOfMeasure') || n.startsWith('InsertUnitsOfMeasure') || n.startsWith('masterSowItem') || n.startsWith('MasterSowItem') || n.startsWith('InsertMasterSowItem') || n.startsWith('masterCalculator') || n.startsWith('MasterCalculator') || n.startsWith('InsertMasterCalculator') || n.startsWith('masterInspectionForm') || n.startsWith('MasterInspectionForm') || n.startsWith('InsertMasterInspectionForm') || n.startsWith('organizationDotPreference') || n.startsWith('OrganizationDotPreference') || n.startsWith('InsertOrganizationDotPreference') || n === 'objectAclPolicies' || n === 'ObjectAclPolicy' || n === 'InsertObjectAclPolicy', domain: 'org_catalog' },

  // AI features (insights, gantt recs, vendor cmp, bid/contract doc analysis, runs, tasks, settings, data quality, takeoff analyses/suggestions/calibration, jobsite analysis, voice logs, issue captures, AI co drafts)
  { match: (n) => n === 'aiSettings' || n === 'AiSettings' || n === 'AISettings' || n === 'InsertAiSettings' || n === 'InsertAISettings' || n === 'aiRuns' || n === 'AiRun' || n === 'AIRun' || n === 'InsertAiRun' || n === 'InsertAIRun' || n === 'aiTasks' || n === 'AiTask' || n === 'AITask' || n === 'InsertAiTask' || n === 'InsertAITask' || n === 'aiInsights' || n === 'AiInsight' || n === 'AIInsight' || n === 'InsertAiInsight' || n === 'InsertAIInsight' || n === 'aiGanttRecommendations' || n === 'AiGanttRecommendation' || n === 'AIGanttRecommendation' || n === 'InsertAiGanttRecommendation' || n === 'InsertAIGanttRecommendation' || n === 'aiVendorComparisons' || n === 'AiVendorComparison' || n === 'AIVendorComparison' || n === 'InsertAiVendorComparison' || n === 'InsertAIVendorComparison' || n === 'aiBidDocumentAnalysis' || n === 'AiBidDocumentAnalysis' || n === 'InsertAiBidDocumentAnalysis' || n === 'aiContractDocumentAnalysis' || n === 'AiContractDocumentAnalysis' || n === 'InsertAiContractDocumentAnalysis' || n === 'aiDataQuality' || n === 'AiDataQuality' || n === 'InsertAiDataQuality' || n.startsWith('aiTakeoff') || n.startsWith('AiTakeoff') || n.startsWith('AITakeoff') || n.startsWith('InsertAiTakeoff') || n.startsWith('InsertAITakeoff') || n === 'aiCoDrafts' || n === 'AiCoDraft' || n === 'InsertAiCoDraft' || n.startsWith('jobsiteAnalysis') || n.startsWith('JobsiteAnalysis') || n.startsWith('InsertJobsiteAnalysis') || n.startsWith('voiceLog') || n.startsWith('VoiceLog') || n.startsWith('InsertVoiceLog') || n.startsWith('issueCapture') || n.startsWith('IssueCapture') || n.startsWith('InsertIssueCapture'), domain: 'ai' },

  // LiDAR
  { match: (n) => n.startsWith('lidar') || n.startsWith('Lidar') || n.startsWith('InsertLidar'), domain: 'lidar' },

  // Reports / digests / project health snapshots / health score / executive digests / portfolio snapshots / profit
  { match: (n) => n.startsWith('projectHealth') || n.startsWith('ProjectHealth') || n.startsWith('InsertProjectHealth') || n.startsWith('projectProfitability') || n.startsWith('ProjectProfitability') || n.startsWith('InsertProjectProfitability') || n.startsWith('projectKpi') || n.startsWith('ProjectKpi') || n.startsWith('InsertProjectKpi') || n.startsWith('executiveDigest') || n.startsWith('ExecutiveDigest') || n.startsWith('InsertExecutiveDigest'), domain: 'reports' },

  // User dashboard / settings / saved views / activity log / color palettes / permission presets
  { match: (n) => n.startsWith('userDashboard') || n.startsWith('UserDashboard') || n.startsWith('InsertUserDashboard') || n.startsWith('permissionPreset') || n.startsWith('PermissionPreset') || n.startsWith('InsertPermissionPreset') || n.startsWith('userColorPalette') || n.startsWith('UserColorPalette') || n.startsWith('InsertUserColorPalette') || n.startsWith('orgColorPalette') || n.startsWith('OrgColorPalette') || n.startsWith('InsertOrgColorPalette') || n === 'userSettings' || n === 'UserSettings' || n === 'InsertUserSettings' || n === 'takeoffRecents' || n === 'TakeoffRecent' || n === 'InsertTakeoffRecent' || n.startsWith('userSavedView') || n.startsWith('UserSavedView') || n.startsWith('InsertUserSavedView') || n.startsWith('myWorkSavedView') || n.startsWith('MyWorkSavedView') || n.startsWith('InsertMyWorkSavedView') || n === 'activityLog' || n === 'ActivityLog' || n === 'InsertActivityLog', domain: 'user_settings' },

  // Daily reports
  { match: (n) => n === 'dailyReports' || n === 'DailyReport' || n === 'InsertDailyReport', domain: 'dot' },

  // Email campaigns
  { match: (n) => n.startsWith('emailCampaign') || n.startsWith('EmailCampaign') || n.startsWith('InsertEmailCampaign'), domain: 'campaigns' },

  // Feature flag preset / changes
  { match: (n) => n.startsWith('featureFlag') || n.startsWith('FeatureFlag') || n.startsWith('InsertFeatureFlag'), domain: 'flags' },

  // Rate limit state
  { match: (n) => n === 'rateLimitState' || n === 'RateLimitState' || n === 'InsertRateLimitState', domain: 'compliance' },

  // SelectUser leftover
  { match: (n) => n === 'SelectUser', domain: 'misc' },
];

function bucketFor(name) {
  // First try the literal name
  for (const r of DOMAIN_RULES) {
    if (r.match(name)) return r.domain;
  }
  // Then try stripping insert/Insert prefix and Schema suffix, normalized to first-cap.
  let stripped = name.replace(/^insert/i, '').replace(/Schema$/, '');
  if (stripped.length > 0) {
    // Try as PascalCase
    const pascal = stripped[0].toUpperCase() + stripped.slice(1);
    // and as camelCase
    const camel = stripped[0].toLowerCase() + stripped.slice(1);
    for (const r of DOMAIN_RULES) {
      if (r.match(pascal) || r.match(camel)) return r.domain;
    }
  }
  return null;
}

// Assign bucket per statement (use first define; if statement has no defines, group with prev)
let prevDomain = 'misc';
for (const item of stmts) {
  if (item.defines.length === 0) {
    item.domain = prevDomain;
    continue;
  }
  let domain = null;
  for (const d of item.defines) {
    domain = bucketFor(d);
    if (domain) break;
  }
  if (!domain) {
    console.warn('UNBUCKETED:', item.defines.join(','));
    domain = 'misc';
  }
  item.domain = domain;
  prevDomain = domain;
}

// Print bucket summary
const summary = {};
for (const it of stmts) {
  summary[it.domain] = (summary[it.domain] || 0) + 1;
}
console.log('Bucket summary:');
for (const [k, v] of Object.entries(summary).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k}: ${v}`);
}

// Build define->domain map
const defineToDomain = new Map();
for (const it of stmts) {
  for (const d of it.defines) defineToDomain.set(d, it.domain);
}

// Report unbucketed defines (none should remain)
const unbucketed = [...allDefines].filter(d => !defineToDomain.has(d));
if (unbucketed.length) {
  console.log('UNBUCKETED defines:', unbucketed);
}

// ---- Step 3: emit files ----

const HEADER_PREFIX = `// AUTO-GENERATED SPLIT FROM shared/schema/features.ts (Task #2426).
// Domain bucketing rule lives in shared/schema/features/index.ts.
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, date, decimal, integer, pgEnum, doublePrecision, index, unique, uniqueIndex, json, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
`;

// Imports from ./enums (ALL of them — keeps things simple). Read original line 5.
const enumImportLine = src.split('\n')[4]; // 0-indexed line 5
const coreImportLine = src.split('\n')[5];
const opsImportLine = src.split('\n')[6];

// Adjust to ../enums, ../core, ../operations
const adjustedEnumImport = enumImportLine.replace('./enums', '../enums');
const adjustedCoreImport = coreImportLine.replace('./core', '../core');
const adjustedOpsImport = opsImportLine.replace('./operations', '../operations');

// Group statements by domain
const byDomain = {};
for (const it of stmts) {
  (byDomain[it.domain] ||= []).push(it);
}

// Get original text for each statement INCLUDING preceding comments/blank lines.
// Walk in source order; slice from prev statement end to current end.
let cursor = stmts.length > 0 ? stmts[0].stmt.getStart(sf, true) : 0;
// Find start of first non-import statement: include leading trivia
const firstStmt = stmts[0].stmt;
cursor = firstStmt.getFullStart();

for (let i = 0; i < stmts.length; i++) {
  const it = stmts[i];
  const start = (i === 0) ? cursor : stmts[i - 1].stmt.getEnd();
  const end = it.stmt.getEnd();
  it.text = src.substring(start, end);
}

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// Emit each domain file
const domainOrder = Object.keys(byDomain).sort();

for (const domain of domainOrder) {
  const items = byDomain[domain];
  // Compute sibling-domain imports
  const siblingImports = {}; // otherDomain -> Set<name>
  for (const it of items) {
    for (const ref of it.refs) {
      const refDomain = defineToDomain.get(ref);
      if (!refDomain || refDomain === domain) continue;
      (siblingImports[refDomain] ||= new Set()).add(ref);
    }
  }
  let header = HEADER_PREFIX + adjustedEnumImport + '\n' + adjustedCoreImport + '\n' + adjustedOpsImport + '\n';
  for (const otherDomain of Object.keys(siblingImports).sort()) {
    const names = [...siblingImports[otherDomain]].sort();
    header += `import { ${names.join(', ')} } from "./${otherDomain}";\n`;
  }
  header += '\n';
  const body = items.map(it => it.text).join('');
  fs.writeFileSync(path.join(OUT_DIR, `${domain}.ts`), header + body);
}

// Emit barrel index.ts
let barrel = `// AUTO-GENERATED — Task #2426: shared/schema/features.ts was 11,535 lines and 375 tables.
// It was split into per-domain files by walking each top-level export and bucketing
// it according to its name (see scripts/split-features.cjs). Re-exports preserve every
// symbol the old features.ts exported so all "@shared/schema" imports keep working.
//
// Bucketing rule:
//   ai            → AI runs/tasks/insights/recommendations + bid/contract doc analysis
//   ai_estimator  → AI Estimator workspace tables
//   campaigns     → Email marketing campaigns
//   compliance    → Approvals, retention, GDPR, SSO, sessions, addenda, audit, risks
//   contracts     → Contract management + e-signature
//   crew          → Crews, skills, user certifications/photos
//   crm           → CRM org/contact/quote/sequence/call/transcript/lead-scoring
//   dot           → Heavy Civil & DOT (DBE, surety, haul tickets, IDR, SWPPP, mat certs)
//   drawings      → Drawing sets
//   email         → External email (org email accounts, threads, tasks, attachments)
//   equipment     → Equipment catalog/assignments/repairs/maintenance + rentals
//   estimate      → Estimating engine (settings, crews, versions, history)
//   financial     → SOV, pay apps, lien waivers, retention releases, unified payments,
//                   revenue recognition, overhead costs
//   flags         → FEATURE_FLAG_* constants + feature flag preset/manual change tables
//   hiring        → Hiring module + talent profiles
//   hustler       → Hustler organizations / delegates / network
//   integrations  → Integration connections, sync state, webhooks, QBO, Sage, Zapier,
//                   Davis-Bacon rate change tables
//   kpi           → KPI templates/assignments/entries
//   library       → Custom library + assemblies
//   lidar         → LiDAR scans / annotations / comparisons
//   messaging     → Conversations, messages, video calls
//   mobile        → Mobile devices + offline sync
//   org_catalog   → Trade templates/features, org calculators/work types/SOW items,
//                   units of measure, master catalogs, object ACL
//   performance   → Employee ratings/reviews/peer ratings, attendance, supervisor notes
//   portal        → Subcontractor & client portal access + portal chat
//   reports       → Project health/profitability/KPI snapshots, executive digests
//   rfi           → RFIs, submittals, transmittals, project log email schedules
//   safety        → Safety trainings, observations, OSHA incidents, toolbox talks
//   schedule      → Project schedules (Gantt/CPM) + PDF alert tables
//   subcontractor → Subcontractor management & sub bid invitations
//   takeoff       → Takeoff workspace (sheets, measurements, BIM, scope, modifiers)
//   user_settings → User dashboard, saved views, color palettes, settings, activity
//   vendor_pricing→ Vendor pricing catalogs, enrollments, pricebooks, scoring
//   website       → White-label website builder, blog, social posts, analytics
//   workflows     → No-code workflow builder
//   misc          → Anything else (kept small)

`;
for (const domain of domainOrder) {
  barrel += `export * from "./${domain}";\n`;
}
fs.writeFileSync(path.join(OUT_DIR, 'index.ts'), barrel);

console.log('Done. Domains written:', domainOrder.length);
