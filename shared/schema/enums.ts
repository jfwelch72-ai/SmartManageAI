import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, date, decimal, integer, pgEnum, doublePrecision, index, unique, json } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

export const userRoleEnum = pgEnum("user_role", ["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR", "OFFICE_MANAGER", "HOURLY_EMPLOYEE", "MAINTENANCE_MANAGER", "VENDOR", "HUSTLER", "SALES", "MARKETING", "SAFETY_MANAGER", "HR_MANAGER", "EQUIPMENT_MANAGER", "PROJECT_ENGINEER", "PROCUREMENT_MANAGER", "DISPATCHER"]);
export const projectStatusEnum = pgEnum("project_status", ["BID", "PLANNING", "ACTIVE", "COMPLETE", "CLOSED"]);
export const bidStatusEnum = pgEnum("bid_status", ["DRAFT", "ACTIVE", "SUBMITTED", "AWARDED", "LOST", "CANCELLED"]);
export const estimateStatusEnum = pgEnum("estimate_status", ["DRAFT", "SUBMITTED", "WON", "LOST", "PENDING_APPROVAL", "APPROVED", "REJECTED"]);
export const estimateLineItemSourceEnum = pgEnum("estimate_line_item_source", ["MANUAL", "TAKEOFF", "GENERATED"]);
export const procurementStatusEnum = pgEnum("procurement_status", ["PLANNED", "QUOTED", "APPROVED", "ORDERED", "DELIVERED"]);
export const documentTypeEnum = pgEnum("document_type", ["PLANS", "SPECS", "TAKEOFF", "OTHER", "BIM"]);
export const noteTypeEnum = pgEnum("note_type", ["GENERAL", "FIELD_NOTE", "SAFETY", "CLIENT_MEETING"]);
export const mediaTypeEnum = pgEnum("media_type", ["IMAGE", "VIDEO"]);
export const billingStatusEnum = pgEnum("billing_status", ["NOT_READY", "READY_TO_BILL", "BILLED"]);
export const changeOrderStatusEnum = pgEnum("change_order_status", ["DRAFT", "PENDING_APPROVAL", "SUBMITTED", "APPROVED", "REJECTED", "PCO", "PRICING_REVIEW", "VOIDED"]);
export const calendarEventTypeEnum = pgEnum("calendar_event_type", ["TIME_OFF_REQUEST", "TIME_OFF_APPROVED", "NETWORKING_EVENT", "PROJECT_START", "PROJECT_PHASE", "PROJECT_MILESTONE"]);
export const notificationTypeEnum = pgEnum("notification_type", [
  "BILLING_READY", "CHANGE_ORDER_PENDING", "TIME_OFF_REQUEST", "GENERAL", "MATERIAL_OVERAGE",
  "PROJECT_ASSIGNMENT", "MAINTENANCE_REQUEST", "REPAIR_REQUEST", "DELAY_SUBMITTED",
  "DELAY_ACKNOWLEDGED", "DELAY_CHANGE_ORDER_NEEDED", "PORTAL_ACTIVITY", "BID_AWARDED",
  "PROGRESS_MILESTONE", "DAILY_PROGRESS_LOGGED", "CHANGE_ORDER_APPROVED", "SOV_ITEM_COMPLETED",
  "PORTAL_CHAT_MESSAGE",
  "CHANGE_ORDER_REJECTED",
  "BID_INVITATION_RECEIVED", "BID_RESPONSE_RECEIVED", "BID_CLARIFICATION_NEW",
  "SUBMITTAL_SUBMITTED", "SUBMITTAL_APPROVED", "SUBMITTAL_REJECTED", "SUBMITTAL_REVISION_REQUESTED",
  "TM_TICKET_SUBMITTED", "TM_TICKET_APPROVED", "TM_TICKET_REJECTED",
  "OVERTIME_REQUESTED", "OVERTIME_APPROVED", "OVERTIME_REJECTED",
  "PAYABLE_SUBMITTED", "PAYABLE_CREATED", "PAYABLE_APPROVED", "PAYABLE_REJECTED",
  "APPROVAL_REQUEST_NEW", "APPROVAL_REQUEST_APPROVED", "APPROVAL_REQUEST_REJECTED",
  "PROCUREMENT_PR_SUBMITTED", "PROCUREMENT_PR_APPROVED", "PROCUREMENT_PR_REJECTED",
  "PROCUREMENT_PO_SUBMITTED", "PROCUREMENT_PO_APPROVED", "PROCUREMENT_PO_REJECTED",
  "CRM_STAGE_CHANGE", "CRM_IDLE_OPPORTUNITY",
  "TASK_MENTIONED",
  "DEADLINE_WARNING", "REMINDER",
  "TAKEOFF_ISSUE_ASSIGNED", "TAKEOFF_ISSUE_STATUS_CHANGED",
  "EQUIPMENT_RENTAL_REQUEST_RECEIVED", "EQUIPMENT_RENTAL_REQUEST_RESPONDED",
  "BID_SUBMITTED", "BID_STATUS_CHANGED", "BID_ASSIGNED", "BID_DUE_DATE_APPROACHING",
  "LEAVE_APPROVED", "LEAVE_DENIED",
]);

export const leaveRequestStatusEnum = pgEnum("leave_request_status", ["PENDING", "APPROVED", "DENIED"]);

// Messaging enums
export const conversationTypeEnum = pgEnum("conversation_type", ["DIRECT", "GROUP", "COMPANY"]);
export const messageStatusEnum = pgEnum("message_status", ["SENT", "DELIVERED", "READ"]);
export const fileTypeEnum = pgEnum("file_type", ["MEDIA", "DOCUMENT", "RECEIPT"]);
export const domainEventStatusEnum = pgEnum("domain_event_status", ["PENDING", "PROCESSED", "FAILED"]);

export const auditActionEnum = pgEnum("audit_action", [
  "CREATE", "UPDATE", "DELETE", "APPROVE", "REJECT", "SUBMIT", 
  "CLOCK_IN", "CLOCK_OUT", "ADJUST",
  "REVOKE_TOKENS", "CREATE_BID_QUOTE", "UPDATE_BID_QUOTE", "DELETE_BID_QUOTE",
  "CREATE_BID_MATERIAL_QUOTE", "UPDATE_BID_MATERIAL_QUOTE", "DELETE_BID_MATERIAL_QUOTE",
  "project.created", "project.status_changed",
  "bid.submitted", "bid.converted_to_project",
  "change_order.approved", "change_order.rejected",
  "timeclock.checked_in", "timeclock.checked_out",
  "payroll.run.completed",
  "hiring.job_published", "hiring.candidate_applied",
  "hiring.candidate_stage_changed", "hiring.candidate_hired",
  "hiring.interview_scheduled", "hiring.integration_connected"
]);
export const clockEventTypeEnum = pgEnum("clock_event_type", ["CLOCK_IN", "CLOCK_OUT", "ADJUSTMENT", "ADMIN_OVERRIDE", "AUTO_CLOCK_OUT"]);
export const shiftApprovalStatusEnum = pgEnum("shift_approval_status", ["PENDING", "APPROVED", "REJECTED"]);
export const aiNoteInsightCategoryEnum = pgEnum("ai_note_insight_category", ["SUPPLY_NEED", "EQUIPMENT_REPAIR", "WEATHER_DELAY", "CHANGE_ORDER", "SAFETY", "CLIENT_COMMUNICATION", "OTHER"]);
export const aiNoteInsightSeverityEnum = pgEnum("ai_note_insight_severity", ["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export const aiNoteInsightSourceTypeEnum = pgEnum("ai_note_insight_source_type", ["PROJECT", "COMPANY"]);
export const aiTaskStatusEnum = pgEnum("ai_task_status", ["PENDING", "IN_PROGRESS", "COMPLETED", "DISMISSED"]);
export const aiTaskPriorityEnum = pgEnum("ai_task_priority", ["CRITICAL", "HIGH", "MEDIUM", "LOW"]);
export const taskSourceTypeEnum = pgEnum("task_source_type", ["MANUAL", "EMAIL", "AI_GENERATED", "SYSTEM"]);

// CRM Enums
export const crmOrganisationTypeEnum = pgEnum("crm_organisation_type", ["CONTRACTOR", "SUBCONTRACTOR", "SUPPLIER", "VENDOR", "OWNER_REP", "RENTAL_VENDOR"]);
export const crmOrgStatusEnum = pgEnum("crm_org_status", ["ACTIVE", "PREQUALIFIED", "COMPLIANCE_ISSUE", "INACTIVE"]);
export const crmContactRoleEnum = pgEnum("crm_contact_role", ["PM", "ESTIMATOR", "SUPERINTENDENT", "SALES", "ACCOUNTS_PAYABLE", "ACCOUNTS_RECEIVABLE", "OWNER", "GENERAL_MANAGER", "FOREMAN", "OTHER"]);
export const crmPreferredContactEnum = pgEnum("crm_preferred_contact", ["EMAIL", "PHONE", "TEXT", "OTHER"]);
export const crmNoteTypeEnum = pgEnum("crm_note_type", ["CALL", "EMAIL", "MEETING", "HOT_LEAD", "COLD_LEAD", "FOLLOW_UP", "ISSUE", "GENERAL"]);
export const crmPipelineStageEnum = pgEnum("crm_pipeline_stage", ["LEAD", "QUALIFIED", "ESTIMATING", "BID_SUBMITTED", "NEGOTIATION", "WON", "LOST"]);
export const crmActivityTypeEnum = pgEnum("crm_activity_type", ["CALL", "EMAIL", "MEETING", "NOTE", "FOLLOW_UP", "SITE_VISIT"]);

// Vendor Pricing Integration Enums
export const pricingSourceTypeEnum = pgEnum("pricing_source_type", ["MANUAL", "PRICEBOOK_IMPORT", "VENDOR_PORTAL"]);
export const vendorEnrollmentStatusEnum = pgEnum("vendor_enrollment_status", ["PENDING", "ACTIVE", "SUSPENDED", "REJECTED"]);
export const pricingApprovalStatusEnum = pgEnum("pricing_approval_status", ["PENDING_REVIEW", "APPROVED", "REJECTED", "AUTO_APPROVED"]);

// Delay Tracking Enums
export const delayReasonEnum = pgEnum("delay_reason", [
  "WEATHER", "GC_SCHEDULING", "OTHER_CONTRACTORS", "MATERIAL_DELIVERY", 
  "PERMIT_ISSUES", "INSPECTION_DELAY", "OWNER_DIRECTIVE", "DESIGN_CHANGES",
  "SITE_CONDITIONS", "LABOR_SHORTAGE", "OTHER"
]);
export const delayStatusEnum = pgEnum("delay_status", ["DRAFT", "SUBMITTED", "ACKNOWLEDGED", "RESOLVED"]);
export const delayResponsibilityEnum = pgEnum("delay_responsibility", ["OWNER", "GC", "SUBCONTRACTOR", "TFR", "FORCE_MAJEURE"]);
export const delayNotificationStatusEnum = pgEnum("delay_notification_status", ["DRAFT", "FINALIZED"]);
export const delayNotificationRecipientTypeEnum = pgEnum("delay_notification_recipient_type", ["OWNER_REP", "GC_REP", "OTHER"]);

// Contract Management Enums
export const contractStatusEnum = pgEnum("contract_status", ["DRAFT", "IN_REVIEW", "REDLINED", "PENDING_APPROVAL", "APPROVED", "EXECUTED", "AMENDED"]);
export const contractTypeEnum = pgEnum("contract_type", ["PRIME", "SUBCONTRACT", "JV", "T_AND_M"]);
export const contractRedlineStatusEnum = pgEnum("contract_redline_status", ["OPEN", "RESOLVED", "REJECTED"]);
export const contractApprovalDecisionEnum = pgEnum("contract_approval_decision", ["PENDING", "APPROVED", "REJECTED"]);
export const clauseCategoryEnum = pgEnum("clause_category", ["PAYMENT", "INSURANCE", "INDEMNIFICATION", "SCOPE", "TERMINATION", "DISPUTE_RESOLUTION", "WARRANTY", "SAFETY", "COMPLIANCE", "RETENTION", "LIQUIDATED_DAMAGES", "FORCE_MAJEURE", "CHANGE_ORDER", "CONFIDENTIALITY", "OTHER"]);
export const signatureRequestStatusEnum = pgEnum("signature_request_status", ["PENDING", "SENT", "PARTIALLY_SIGNED", "COMPLETED", "DECLINED", "EXPIRED"]);
export const signerStatusEnum = pgEnum("signer_status", ["PENDING", "SIGNED", "DECLINED"]);

// Delay Claims Enums
export const delayClaimStatusEnum = pgEnum("delay_claim_status", ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED", "CLOSED"]);
export const delayClaimTypeEnum = pgEnum("delay_claim_type", ["TIME_EXTENSION", "COST_IMPACT", "BOTH"]);
export const dailyReportLockStatusEnum = pgEnum("daily_report_lock_status", ["UNLOCKED", "LOCKED", "SUPERVISOR_LOCKED"]);
export const photoCustodyActionEnum = pgEnum("photo_custody_action", ["CAPTURED", "UPLOADED", "VIEWED", "DOWNLOADED", "ATTACHED_TO_CLAIM", "EXPORTED"]);

// Inspection Scheduling Enums
export const inspectionTypeEnum = pgEnum("inspection_type", ["CITY_OFFICIAL", "GC_REPRESENTATIVE", "OWNER_REPRESENTATIVE"]);
export const inspectionStatusEnum = pgEnum("inspection_status", ["REQUESTED", "SCHEDULED", "PASSED", "FAILED", "CANCELLED"]);
export const inspectionRequestMethodEnum = pgEnum("inspection_request_method", ["CALL", "EMAIL", "PORTAL", "OTHER"]);

// Punch List Enums
export const punchListTradeEnum = pgEnum("punch_list_trade", [
  "GENERAL", "ELECTRICAL", "PLUMBING", "HVAC", "FRAMING", "DRYWALL",
  "PAINTING", "ROOFING", "FLOORING", "CONCRETE", "MASONRY", "TILE",
  "CARPENTRY", "INSULATION", "GLAZING", "LANDSCAPING", "OTHER"
]);
export const punchListPriorityEnum = pgEnum("punch_list_priority", ["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export const punchListStatusEnum = pgEnum("punch_list_status", ["OPEN", "IN_PROGRESS", "RESOLVED", "VERIFIED", "REJECTED"]);

// White-Label / Multi-Tenant Enums - Comprehensive CSI Trade Divisions
export const tradeTypeEnum = pgEnum("trade_type", [
  // === EXISTING TRADES (23) - DO NOT REMOVE ===
  "GENERAL_CONTRACTOR",    // CSI 00/01 - Full GC/CM
  "CONCRETE",              // CSI 03 - Concrete/Foundations  
  "EARTHWORK",             // CSI 31 - Excavation/Grading
  "ASPHALT_PAVING",        // CSI 32 - Asphalt & Striping
  "ROOFING",               // CSI 07 - Roofing & Waterproofing
  "ELECTRICAL",            // CSI 26 - Power & Lighting
  "PLUMBING",              // CSI 22 - Plumbing Systems
  "HVAC",                  // CSI 23 - Mechanical/HVAC
  "CARPENTRY",             // CSI 06 - Wood & Metal Framing
  "MASONRY",               // CSI 04 - Masonry/Stone
  "DRYWALL",               // CSI 09 - Drywall/Insulation/Acoustical
  "PAINTING",              // CSI 09 90 - Painting & Coatings
  "FLOORING",              // CSI 09 60 - All Flooring Types
  "LANDSCAPING",           // CSI 32 90 - Landscaping & Irrigation
  "DEMOLITION",            // CSI 02 - Demo & Hazmat
  "STEEL_ERECTION",        // CSI 05 - Structural Steel & Metals
  "GLAZING",               // CSI 08 - Doors/Frames/Windows/Glass
  "INSULATION",            // CSI 07 21 - Thermal & Acoustic Insulation
  "FIRE_PROTECTION",       // CSI 21 - Fire Sprinkler/Suppression
  "LOW_VOLTAGE",           // CSI 27/28 - Technology/Security/AV
  "SOLAR",                 // Renewable Energy/Solar Installation
  "WATERPROOFING",         // CSI 07 - Below Grade/Above Grade
  "OTHER",
  
  // === CIVIL / SITE / ENVIRONMENTAL (20 new) ===
  "SITE_DEMOLITION",           // CSI 02 41 - Site Clearing/Demo
  "MASS_EXCAVATION",           // CSI 31 23 - Bulk Earth Moving
  "TRENCHING",                 // CSI 31 23 - Utility Trenching
  "SHORING",                   // CSI 31 50 - Excavation Support
  "DEWATERING",                // CSI 31 23 - Groundwater Control
  "SOIL_STABILIZATION",        // CSI 31 32 - Ground Improvement
  "ENVIRONMENTAL_REMEDIATION", // CSI 02 80 - Hazmat/Contamination
  "WELL_PLUGGING",             // Well Abandonment/Plugging
  "STORMWATER_SYSTEMS",        // CSI 33 40 - Storm Drainage
  "SANITARY_SEWER",            // CSI 33 30 - Sanitary Systems
  "WATERLINE",                 // CSI 33 10 - Water Distribution
  "FORCE_MAIN",                // CSI 33 30 - Pressurized Sewer
  "ROADWAY_CONSTRUCTION",      // CSI 32 10 - Road Building
  "CURB_AND_GUTTER",           // CSI 32 16 - Curbs & Gutters
  "SIDEWALK",                  // CSI 32 13 - Pedestrian Paving
  "CONCRETE_PAVING",           // CSI 32 13 - Concrete Flatwork
  "TRAFFIC_CONTROL",           // CSI 32 17 - Traffic Systems
  "STRIPING_AND_SIGNAGE",      // CSI 32 17 - Pavement Markings
  "EROSION_CONTROL",           // CSI 31 25 - Erosion/Sediment
  "FENCING_AND_GATES",         // CSI 32 31 - Fencing/Gates
  
  // === STRUCTURAL / BUILDING (13 new) ===
  "CAST_IN_PLACE_CONCRETE",    // CSI 03 30 - CIP Concrete
  "PRECAST_CONCRETE",          // CSI 03 40 - Precast Elements
  "REBAR_AND_POST_TENSION",    // CSI 03 20 - Reinforcement
  "STRUCTURAL_STEEL",          // CSI 05 12 - Structural Framing
  "METAL_BUILDINGS",           // CSI 13 34 - Pre-Engineered Metal
  "CARPENTRY_FRAMING",         // CSI 06 10 - Rough Carpentry
  "DRYWALL_SYSTEMS",           // CSI 09 29 - Gypsum Board
  "ACOUSTICAL_CEILINGS",       // CSI 09 51 - Acoustical Ceilings
  "PAINTING_AND_COATINGS",     // CSI 09 90 - Industrial Coatings
  "FLOORING_SYSTEMS",          // CSI 09 60 - Flooring Assembly
  "ROOFING_SYSTEMS",           // CSI 07 50 - Roofing Systems
  "MASONRY_SYSTEMS",           // CSI 04 20 - Unit Masonry
  "GLAZING_SYSTEMS",           // CSI 08 80 - Curtain Wall/Storefronts
  
  // === MEP / SPECIALTY (11 new) ===
  "ELECTRICAL_UNDERGROUND",    // CSI 26 05 - Underground Electric
  "ELECTRICAL_OVERHEAD",       // CSI 26 05 - Overhead Power Lines
  "MECHANICAL_PIPING",         // CSI 23 20 - Process Piping
  "HVAC_SYSTEMS",              // CSI 23 - Complete HVAC
  "PLUMBING_SYSTEMS",          // CSI 22 - Complete Plumbing
  "FIRE_PROTECTION_SYSTEMS",   // CSI 21 - Complete Fire Systems
  "LOW_VOLTAGE_SYSTEMS",       // CSI 27/28 - Low Voltage
  "SECURITY_AND_ACCESS",       // CSI 28 - Security Systems
  "COMMUNICATIONS_IT",         // CSI 27 - Communications
  "SOLAR_INSTALLATION",        // Photovoltaic Systems
  "TEMPORARY_POWER",           // Temporary Electrical
  
  // === SUPPORT / SERVICES (5 new) ===
  "SURVEY_AND_LAYOUT",         // CSI 01 71 - Survey/Layout
  "TESTING_AND_INSPECTIONS",   // CSI 01 45 - QC/Testing
  "COMMISSIONING",             // CSI 01 91 - Cx Services
  "TEMPORARY_FACILITIES",      // CSI 01 50 - Temp Structures
  "GENERAL_CONDITIONS"         // CSI 01 - Gen Conditions/Overhead
]);
export const onboardingStatusEnum = pgEnum("onboarding_status", ["NOT_STARTED", "IN_PROGRESS", "COMPLETED"]);

// Organization Document Enums
export const organizationDocumentTypeEnum = pgEnum("organization_document_type", [
  "LOGO_PRIMARY",
  "LOGO_SECONDARY",
  "LETTERHEAD",
  "INSURANCE_CERT_GENERAL_LIABILITY",
  "INSURANCE_CERT_WORKERS_COMP",
  "INSURANCE_CERT_AUTO",
  "INSURANCE_CERT_UMBRELLA",
  "W9",
  "LICENSE",
  "BONDING_LETTER",
  "BANKING_INFO",
  "SAFETY_PROGRAM",
  "COMPANY_PROFILE",
  "TEMPLATE_OTHER"
]);
export const organizationDocumentVisibilityEnum = pgEnum("organization_document_visibility", ["PUBLIC", "INTERNAL", "CONFIDENTIAL"]);

// Subscription & Billing Enums
export const planTierEnum = pgEnum("plan_tier", ["free", "starter", "professional", "enterprise"]);
export const subscriptionStatusEnum = pgEnum("subscription_status", ["trialing", "active", "past_due", "canceled"]);
export const billingProviderEnum = pgEnum("billing_provider", ["stripe", "manual"]);
export const addonStatusEnum = pgEnum("addon_status", ["active", "inactive"]);
export const addonKeyEnum = pgEnum("addon_key", ["ai_pm", "ai_cfo", "ai_email", "website_seo", "bid_network", "ai_vision", "integration_qbo", "integration_esign", "ai_governance_pack"]);
export const usageKeyEnum = pgEnum("usage_key", ["ai_vision_docs"]);

// Pricebook Import Job Status Enum
export const pricebookImportJobStatusEnum = pgEnum("pricebook_import_job_status", ["PENDING", "PROCESSING", "COMPLETED", "FAILED"]);

// Organizations table (tenants/companies)
export const workWeekStartDayEnum = pgEnum("work_week_start_day", ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"]);

// Organization Payroll Settings table
export const payRunStatusEnum = pgEnum("pay_run_status", ["DRAFT", "PENDING_APPROVAL", "APPROVED", "PROCESSING", "PAID", "VOIDED", "ARCHIVED"]);

export const salaryTypeEnum = pgEnum("salary_type", ["FIXED", "CONTRACT", "HOURLY_EQUIVALENT", "SEASONAL"]);

export const tmTicketStatusEnum = pgEnum("tm_ticket_status", ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"]);

// T&M Billing Status Enum
export const tmBillingStatusEnum = pgEnum("tm_billing_status", ["PENDING", "APPROVED_FOR_BILLING", "INVOICED", "BILLED"]);

// T&M Invoice Status Enum
export const tmInvoiceStatusEnum = pgEnum("tm_invoice_status", ["DRAFT", "SENT", "PAID", "CANCELLED"]);

// T&M Invoices table - generated invoices for T&M tickets
export const materialResponsibilityEnum = pgEnum("material_responsibility", [
  "TFR",           // TFR is responsible (absorb cost)
  "SUBCONTRACTOR", // Subcontractor is responsible (deduct from payment)
  "CUSTOMER",      // Customer is responsible (bill as change order)
  "PENDING",       // Not yet determined
]);

// Overage action status enum
export const overageActionStatusEnum = pgEnum("overage_action_status", [
  "NONE",       // No overage or no action needed
  "PENDING",    // Overage detected, awaiting decision
  "BILLED",     // Billed to customer
  "DEDUCTED",   // Deducted from subcontractor
  "ABSORBED",   // Absorbed by TFR
  "RESOLVED",   // Resolved through other means
]);

// Scope of Work Items table
export const overtimeRequestStatusEnum = pgEnum("overtime_request_status", ["PENDING", "APPROVED", "REJECTED"]);

// Overtime Requests table
export const aiInsightModuleEnum = pgEnum("ai_insight_module", [
  "SCHEDULING",
  "DELAYS", 
  "COSTS",
  "EQUIPMENT",
  "VENDOR_PRICING",
  "PROJECT_HEALTH",
  "GANTT_CHART",
  "LABOR",
  "BIDS",
  "CHANGE_ORDERS"
]);

export const aiInsightSeverityEnum = pgEnum("ai_insight_severity", [
  "INFO",
  "SUGGESTION",
  "WARNING",
  "CRITICAL"
]);

// AI Insights table (module-specific AI analysis and recommendations)
export const aiBidDocumentAnalysisStatusEnum = pgEnum("ai_bid_document_analysis_status", ["PENDING", "PROCESSING", "COMPLETED", "FAILED"]);

export const aiContractDocumentAnalysisStatusEnum = pgEnum("ai_contract_document_analysis_status", ["PENDING", "PROCESSING", "COMPLETED", "FAILED"]);

export const measurementTypeEnum = pgEnum("measurement_type", ["LINEAR", "AREA", "VOLUME", "COUNT", "NOTE", "LINEAR_WITH_DROP", "PITCHED_AREA", "PITCHED_LINEAR", "SURFACE_AREA", "SEGMENT"]);
export const measurementSourceEnum = pgEnum("measurement_source", ["USER", "AI", "BIM"]);
export const measurementStatusEnum = pgEnum("measurement_status", ["DRAFT", "CONFIRMED"]);
export const scopeTypeEnum = pgEnum("scope_type", ["CONCRETE", "EXCAVATION", "PAVERS", "BOLLARDS", "UNDERDRAIN", "BASE", "BEDDING", "GENERAL"]);
export const estimateItemCategoryEnum = pgEnum("estimate_item_category", ["CONCRETE", "EXCAVATION", "PAVERS", "BOLLARDS", "GC", "OVERHEAD", "PROFIT", "GENERAL"]);

// Project Plans table (for uploaded PDFs)
export const stoneTypeEnum = pgEnum("stone_type", ["CRUSHED_STONE", "LIMESTONE", "COMPACTED_BASE", "PEA_GRAVEL", "RECYCLED_CONCRETE"]);

// Material calculator enums for reinforcement and additives
export const wireMeshTypeEnum = pgEnum("wire_mesh_type", ["6X6_W1.4_W1.4", "6X6_W2.9_W2.9", "4X4_W1.4_W1.4", "4X4_W2.9_W2.9"]);
export const rebarSizeEnum = pgEnum("rebar_size", ["#3", "#4", "#5", "#6"]);
export const sealerTypeEnum = pgEnum("sealer_type", ["CURE_AND_SEAL", "PENETRATING", "ACRYLIC", "EPOXY"]);
export const underlaymentTypeEnum = pgEnum("underlayment_type", ["POLY_6MIL", "POLY_10MIL", "VAPOR_BARRIER"]);
export const dowelSizeEnum = pgEnum("dowel_size", ["3/4_INCH", "1_INCH", "1_1/4_INCH"]);

// Estimate Line Items table (detailed cost breakdown per line)
export const equipmentStatusEnum = pgEnum("equipment_status", [
  "AVAILABLE",      // Ready for assignment
  "ASSIGNED",       // Currently on a job
  "IN_REPAIR",      // Being repaired
  "OUT_OF_SERVICE", // Temporarily unavailable
  "RETIRED"         // No longer in use
]);

// Equipment Type Enum
export const equipmentTypeEnum = pgEnum("equipment_type", [
  "HEAVY_EQUIPMENT",  // Excavators, loaders, dozers
  "POWER_TOOL",       // Drills, saws, grinders
  "HAND_TOOL",        // Hammers, wrenches, etc.
  "VEHICLE",          // Trucks, vans
  "TRAILER",          // Flatbeds, enclosed trailers
  "CONCRETE",         // Mixers, vibrators, screeds
  "COMPACTION",       // Rollers, plate compactors
  "SURVEYING",        // Levels, total stations
  "SAFETY",           // Safety equipment
  "OTHER"
]);

// Repair Status Enum
export const repairStatusEnum = pgEnum("repair_status", [
  "PENDING",      // Waiting to be started
  "IN_PROGRESS",  // Currently being repaired
  "COMPLETED",    // Repair finished
  "CANCELLED"     // Repair cancelled
]);

// Maintenance Type Enum
export const maintenanceTypeEnum = pgEnum("maintenance_type", [
  "PREVENTATIVE",      // Scheduled PM (oil changes, filters, etc.)
  "SCHEDULED_SERVICE", // Major service intervals
  "WEAR_ITEM",         // Tracks, tires, blades, etc.
  "INSPECTION",        // Safety inspections
  "CALIBRATION"        // For precision equipment
]);

// Equipment Assignments (link equipment to projects)
export const bidEquipmentSourceEnum = pgEnum("bid_equipment_source", [
  "OWNED",   // Company-owned equipment
  "RENTAL"  // Rental from vendor
]);

// Bid Equipment Selections - Equipment planned for bids
export const projectEquipmentPlanStatusEnum = pgEnum("project_equipment_plan_status", [
  "PLANNED",           // From bid, not yet assigned
  "ASSIGNED",          // Owned equipment assigned to project
  "RENTAL_BOOKED",     // Rental confirmed with vendor
  "RENTAL_ACTIVE",     // Rental in progress
  "COMPLETED",         // Equipment work finished
  "CANCELLED"          // No longer needed
]);

// Project Equipment Plans - Carryover from bid with planned vs actual tracking
export const sowAuditActionEnum = pgEnum("sow_audit_action", ["CREATE", "UPDATE", "DEACTIVATE", "REGENERATE"]);

export const aiTakeoffStatusEnum = pgEnum("ai_takeoff_status", ["PENDING", "PROCESSING", "COMPLETE", "FAILED"]);
export const aiTakeoffModeEnum = pgEnum("ai_takeoff_mode", ["QUICK", "DETAILED"]);

export const scheduleGeneratedByEnum = pgEnum("schedule_generated_by", ["AI", "MANUAL"]);
export const scheduleTaskStatusEnum = pgEnum("schedule_task_status", ["NOT_STARTED", "IN_PROGRESS", "COMPLETE", "DELAYED", "ON_HOLD"]);

export const jobsiteAnalysisStatusEnum = pgEnum("jobsite_analysis_status", ["PENDING", "PROCESSING", "COMPLETE", "PARTIAL", "FAILED"]);
export const safetySeverityEnum = pgEnum("safety_severity", ["CRITICAL", "HIGH", "MEDIUM", "LOW"]);

export const pricebookStatusEnum = pgEnum("pricebook_status", ["PENDING", "PROCESSING", "ACTIVE", "EXPIRED", "SUPERSEDED"]);

export const aiCoDraftStatusEnum = pgEnum("ai_co_draft_status", ["DRAFT", "CONVERTED", "DISCARDED"]);

export const purchaseRequestStatusEnum = pgEnum("purchase_request_status", ["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "CONVERTED_TO_PO"]);
export const purchaseOrderStatusEnum = pgEnum("purchase_order_status", ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT", "ACKNOWLEDGED", "PARTIAL", "FULFILLED", "CANCELLED"]);
export const poReceiptStatusEnum = pgEnum("po_receipt_status", ["PARTIAL", "COMPLETE"]);
export const poReceiptItemConditionEnum = pgEnum("po_receipt_item_condition", ["GOOD", "DAMAGED", "REJECTED"]);
export const vendorInvoiceStatusEnum = pgEnum("vendor_invoice_status", ["PENDING", "MATCHED", "APPROVED", "PAID", "DISPUTED"]);
export const invoiceMatchStatusEnum = pgEnum("invoice_match_status", ["PENDING", "MATCHED", "DISCREPANCY"]);

export const mobilePlatformEnum = pgEnum("mobile_platform", ["IOS", "ANDROID", "WEB"]);
export const syncStatusEnum = pgEnum("sync_status", ["IN_PROGRESS", "COMPLETE", "FAILED"]);

export const sovStatusEnum = pgEnum("sov_status", ["DRAFT", "PENDING", "APPROVED", "SUBMITTED", "PAID", "ARCHIVED", "UNDER_REVIEW", "REJECTED"]);

export const storedMaterialStatusEnum = pgEnum("stored_material_status", ["ON_SITE", "OFF_SITE", "INCORPORATED"]);
export const retentionReleaseTypeEnum = pgEnum("retention_release_type", ["PARTIAL", "FINAL"]);
export const retentionReleaseStatusEnum = pgEnum("retention_release_status", ["REQUESTED", "APPROVED", "REJECTED", "RELEASED"]);

export const lienWaiverTypeEnum = pgEnum("lien_waiver_type", ["CONDITIONAL_PARTIAL", "UNCONDITIONAL_PARTIAL", "CONDITIONAL_FINAL", "UNCONDITIONAL_FINAL"]);
export const lienWaiverStatusEnum = pgEnum("lien_waiver_status", ["PENDING", "SENT", "RECEIVED", "APPROVED", "REJECTED"]);

export const sovPaymentMethodEnum = pgEnum("sov_payment_method", ["CHECK", "ACH", "WIRE", "CREDIT_CARD", "OTHER"]);

export const websiteStatusEnum = pgEnum("website_status", ["DRAFT", "PUBLISHED", "MAINTENANCE"]);
export const websitePageTypeEnum = pgEnum("website_page_type", ["HOME", "ABOUT", "SERVICES", "SAFETY", "GALLERY", "BLOG", "CONTACT", "CUSTOM"]);
export const blogPostStatusEnum = pgEnum("blog_post_status", ["DRAFT", "PUBLISHED", "ARCHIVED"]);
export const blogCommentStatusEnum = pgEnum("blog_comment_status", ["PENDING", "APPROVED", "REJECTED", "SPAM"]);
export const websiteProjectStatusEnum = pgEnum("website_project_status", ["DRAFT", "PUBLISHED", "ARCHIVED"]);
export const socialPlatformEnum = pgEnum("social_platform", ["FACEBOOK", "INSTAGRAM", "LINKEDIN", "TWITTER", "TIKTOK", "YOUTUBE", "PINTEREST"]);
export const socialPostStatusEnum = pgEnum("social_post_status", ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SCHEDULED", "QUEUED", "POSTED", "FAILED"]);
export const socialAccountStatusEnum = pgEnum("social_account_status", ["CONNECTED", "DISCONNECTED", "EXPIRED", "ERROR"]);

// Main Website Configuration
export const websiteDeploymentActionEnum = pgEnum("website_deployment_action", [
  "PUBLISHED", "UNPUBLISHED", "MAINTENANCE_ON", "MAINTENANCE_OFF", 
  "DOMAIN_UPDATED", "DOMAIN_VERIFIED", "SETTINGS_UPDATED", "REPUBLISHED"
]);

export const emailProviderEnum = pgEnum("email_provider", ["GMAIL", "OUTLOOK", "IMAP"]);

// Email Thread Status Enum
export const emailThreadStatusEnum = pgEnum("email_thread_status", ["OPEN", "ARCHIVED", "IGNORED"]);

// Email Classification Enum
export const emailClassificationEnum = pgEnum("email_classification", [
  "PROJECT_UPDATE",
  "BID_INVITE",
  "BID_RFI",
  "CHANGE_ORDER_REQUEST",
  "SUBMITTAL_REQUEST",
  "PAY_APP",
  "INVOICE",
  "DELAY_NOTICE",
  "SAFETY_ISSUE",
  "DELIVERY_NOTICE",
  "TIME_CLOCK_ISSUE",
  "VENDOR_PRICING",
  "GENERAL_COMMUNICATION",
  "SPAM_OR_IRRELEVANT",
  "OTHER"
]);

// Email Task Source Enum  
export const emailTaskSourceEnum = pgEnum("email_task_source", ["EMAIL", "MANUAL", "AI_GENERATED"]);

// Email Accounts Table (linked email accounts per user)
export const dashboardWidgetTypeEnum = pgEnum("dashboard_widget_type", [
  "QUICK_STATS",
  "AI_INSIGHTS", 
  "MESSAGES",
  "NOTIFICATIONS",
  "CALENDAR_EVENTS",
  "ACTIVE_PROJECTS",
  "ACTIVE_BIDS",
  "AI_TASKS",
  "CREW_ASSIGNMENTS",
  "RECENT_ACTIVITY",
  "PROJECT_HEALTH",
  "BUDGET_OVERVIEW"
]);

// User Dashboard Permissions - Admin-controlled access to customization
export const hustlerLinkRequestStatusEnum = pgEnum("hustler_link_request_status", ["PENDING", "APPROVED", "REJECTED", "EXPIRED", "REVOKED"]);

export const hustlerDelegateRoleEnum = pgEnum("hustler_delegate_role", ["COO", "CFO", "OPERATIONS_MANAGER"]);

export const bidRequestStatusEnum = pgEnum("bid_request_status", [
  "DRAFT",           // GC is preparing the request
  "OPEN",            // Request is open for submissions
  "CLOSED",          // Deadline passed or manually closed
  "AWARDED",         // A sub has been selected
  "CANCELLED"        // Request cancelled
]);

export const bidInvitationStatusEnum = pgEnum("bid_invitation_status", [
  "PENDING",         // Invitation sent, awaiting response
  "VIEWED",          // Sub has viewed the invitation
  "DECLINED",        // Sub declined to bid
  "RESPONDED",       // Sub submitted a quote
  "WITHDRAWN"        // Sub withdrew their response
]);

export const bidResponseStatusEnum = pgEnum("bid_response_status", [
  "DRAFT",           // Sub is preparing response
  "SUBMITTED",       // Response submitted
  "UNDER_REVIEW",    // GC is reviewing
  "SHORTLISTED",     // GC marked as potential winner
  "AWARDED",         // Sub won the bid
  "NOT_SELECTED",    // Sub not selected
  "WITHDRAWN"        // Sub withdrew response
]);

// Organization Network Settings - Admin toggles for bid network participation
export const voiceLogStatusEnum = pgEnum("voice_log_status", ["PENDING", "TRANSCRIBED", "FAILED"]);
export const issueSeverityEnum = pgEnum("issue_severity", ["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export const issueStatusEnum = pgEnum("issue_status", ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]);
export const takeoffIssueCategoryEnum = pgEnum("takeoff_issue_category", ["QUESTION", "CONFLICT", "RFI", "OBSERVATION"]);
export const takeoffIssueStatusEnum = pgEnum("takeoff_issue_status", ["OPEN", "IN_REVIEW", "RESOLVED"]);
export const offlineSyncStatusEnum = pgEnum("offline_sync_status", ["PENDING", "SYNCED", "FAILED"]);
export const offlineOperationTypeEnum = pgEnum("offline_operation_type", ["CREATE", "UPDATE", "DELETE"]);
export const offlineEntityTypeEnum = pgEnum("offline_entity_type", ["TIME_ENTRY", "NOTE", "ISSUE", "VOICE_LOG", "PHOTO"]);

// Voice Logs table - Voice memo transcriptions from field workers
export const vendorScoreCategoryEnum = pgEnum("vendor_score_category", ["QUALITY", "TIMELINESS", "COMMUNICATION", "PRICING", "RELIABILITY"]);
export const crewAvailabilityStatusEnum = pgEnum("crew_availability_status", ["AVAILABLE", "PARTIALLY_AVAILABLE", "BOOKED", "UNAVAILABLE"]);

// Vendor Scores table - Vendor performance scoring by project
export const rfiStatusEnum = pgEnum("rfi_status", ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "FORWARDED", "ANSWERED", "CLOSED"]);
export const rfiPriorityEnum = pgEnum("rfi_priority", ["LOW", "MEDIUM", "HIGH", "URGENT"]);
export const rfiCategoryEnum = pgEnum("rfi_category", ["DESIGN_CLARIFICATION", "FIELD_CONDITION", "SUBSTITUTION_REQUEST", "SPECIFICATION_INTERPRETATION", "SCHEDULE", "ADMINISTRATIVE", "OTHER"]);

export const transmittalStatusEnum = pgEnum("transmittal_status", ["DRAFT", "SENT", "ACKNOWLEDGED", "SUPERSEDED"]);

export const submittalStatusEnum = pgEnum("submittal_status", ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "APPROVED", "APPROVED_AS_NOTED", "REJECTED", "REVISE_AND_RESUBMIT"]);
export const submittalPhaseEnum = pgEnum("submittal_phase", ["ESTIMATE", "AWARDED", "CONSTRUCTION"]);
export const submittalTypeEnum = pgEnum("submittal_type", ["CONTRACTOR", "SUBCONTRACTOR"]);
export const submittalCategoryEnum = pgEnum("submittal_category", ["SHOP_DRAWING", "PRODUCT_DATA", "MATERIAL_APPROVAL", "ENGINEERING_APPROVAL", "SAMPLE", "OPERATION_AND_MAINTENANCE", "OTHER"]);
export const submittalItemStatusEnum = pgEnum("submittal_item_status", ["PENDING", "APPROVED", "REJECTED", "REVISE"]);
export const submittalReviewRoleEnum = pgEnum("submittal_review_role", ["ARCHITECT", "ENGINEER", "OWNER", "GC_MANAGER"]);
export const submittalReviewStatusEnum = pgEnum("submittal_review_status", ["PENDING", "IN_REVIEW", "APPROVED", "APPROVED_AS_NOTED", "REJECTED", "REVISE_AND_RESUBMIT"]);

export const rewardTypeEnum = pgEnum("reward_type_enum", ["BONUS", "INCENTIVE", "RECOGNITION", "POINTS", "CUSTOM"]);

export const portalChatThreadStatusEnum = pgEnum("portal_chat_thread_status", ["OPEN", "CLOSED", "ARCHIVED"]);
export const portalChatThreadCategoryEnum = pgEnum("portal_chat_thread_category", ["PROJECT", "RFI", "SUBMITTAL", "TASK", "GENERAL"]);
export const portalChatPriorityEnum = pgEnum("portal_chat_priority", ["NORMAL", "URGENT"]);

export const integrationProviderEnum = pgEnum("integration_provider", ["qbo", "google", "microsoft", "docusign", "dropbox_sign", "zapier", "dropbox", "gdrive", "onedrive", "box"]);
export const integrationConnectionStatusEnum = pgEnum("integration_connection_status", ["pending", "active", "error", "disconnected"]);
export const integrationEventStatusEnum = pgEnum("integration_event_status", ["queued", "processing", "sent", "failed", "dead_letter"]);
export const approvalStatusEnum = pgEnum("approval_status_v2", ["pending", "approved", "rejected"]);
export const approvalEntityTypeEnum = pgEnum("approval_entity_type", ["CHANGE_ORDER", "SOV_PAY_APP", "TIME_APPROVAL", "VENDOR_BILL", "ESIGN_SEND", "QBO_EXPORT"]);
export const documentRevisionStatusEnum = pgEnum("document_revision_status", ["active", "superseded"]);
export const documentRevisionSourceEnum = pgEnum("document_revision_source", ["upload", "email", "import", "esign"]);

// Table 1: integration_connections
export const addendumStatusEnum = pgEnum("addendum_status", ["DRAFT", "ISSUED", "ACKNOWLEDGED"]);
export const addendumRecipientTypeEnum = pgEnum("addendum_recipient_type", ["SUBCONTRACTOR", "TEAM_MEMBER", "CLIENT"]);

export const ssoProviderEnum = pgEnum("sso_provider", ["OKTA", "AZURE_AD", "ONELOGIN", "CUSTOM"]);

// Table: sso_configurations
export const retentionEntityTypeEnum = pgEnum("retention_entity_type", ["AUDIT_LOGS", "AI_ACTIONS", "DOCUMENTS", "TIME_ENTRIES", "MESSAGES", "FILE_UPLOADS"]);
export const retentionActionEnum = pgEnum("retention_action", ["DELETE", "ARCHIVE", "ANONYMIZE"]);

// Table: retention_policies
export const dataSubjectRequestTypeEnum = pgEnum("data_subject_request_type", ["ACCESS", "DELETION", "PORTABILITY", "RECTIFICATION", "OBJECTION"]);
export const dataSubjectRequestStatusEnum = pgEnum("data_subject_request_status", ["PENDING", "IN_PROGRESS", "COMPLETED", "DENIED"]);

// Payroll deduction enums
export const deductionCategoryEnum = pgEnum("deduction_category", [
  "FEDERAL_TAX", "STATE_TAX", "LOCAL_TAX", "FICA", "MEDICARE",
  "UNION_DUES", "HEALTH_INSURANCE", "DENTAL_INSURANCE", "VISION_INSURANCE",
  "RETIREMENT_401K", "GARNISHMENT", "CHILD_SUPPORT", "OTHER"
]);

export const deductionCalculationMethodEnum = pgEnum("deduction_calculation_method", [
  "PERCENTAGE", "FIXED_AMOUNT", "TIERED"
]);

// Table: data_processing_records (ROPA - Record of Processing Activities)

// ============================================
// WARRANTY MODULE ENUMS
// ============================================
export const warrantyCaseTypeEnum = pgEnum("warranty_case_type", ["DEFECT", "WARRANTY_CLAIM", "CALLBACK", "RECALL"]);
export const warrantyCaseStatusEnum = pgEnum("warranty_case_status", ["OPEN", "ACKNOWLEDGED", "IN_REPAIR", "REPAIRED", "CLOSED", "REJECTED"]);
export const warrantyPriorityEnum = pgEnum("warranty_priority", ["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export const warrantyTaskStatusEnum = pgEnum("warranty_task_status", ["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"]);
export const warrantyDocumentTypeEnum = pgEnum("warranty_document_type", ["PHOTO", "INVOICE", "INSPECTION_REPORT", "COMMUNICATION", "OTHER"]);

// ============================================
// HIRING MODULE ENUMS
// ============================================
export const hiringJobStatusEnum = pgEnum("hiring_job_status", ["DRAFT", "PUBLISHED", "PAUSED", "ARCHIVED"]);
export const hiringCandidateStageEnum = pgEnum("hiring_candidate_stage", ["APPLIED", "SCREENED", "REVIEW", "PHONE_SCREEN", "INTERVIEW", "FINAL_REVIEW", "OFFER", "HIRED", "REJECTED", "ARCHIVED"]);
export const hiringEmploymentTypeEnum = pgEnum("hiring_employment_type", ["FULL_TIME", "PART_TIME", "SEASONAL", "SUBCONTRACTOR", "INTERN", "TEMPORARY"]);
export const hiringCompensationTypeEnum = pgEnum("hiring_compensation_type", ["SALARY", "HOURLY", "PREVAILING_WAGE", "BONUS_ELIGIBLE"]);
export const hiringInterviewStatusEnum = pgEnum("hiring_interview_status", ["SCHEDULED", "COMPLETED", "CANCELLED", "RESCHEDULED", "NO_SHOW"]);
export const hiringSyncStatusEnum = pgEnum("hiring_sync_status", ["PENDING", "RUNNING", "COMPLETED", "FAILED"]);
export const atsProviderEnum = pgEnum("ats_provider", ["WORKABLE", "GREENHOUSE", "LEVER"]);
export const hiringActivityTypeEnum = pgEnum("hiring_activity_type", ["JOB_CREATED", "JOB_PUBLISHED", "JOB_ARCHIVED", "CANDIDATE_APPLIED", "CANDIDATE_STAGE_CHANGED", "CANDIDATE_HIRED", "CANDIDATE_REJECTED", "NOTE_ADDED", "INTERVIEW_SCHEDULED", "INTEGRATION_CONNECTED", "AI_REVIEW_GENERATED"]);

// ============================================
// TALENT POOL ENUMS
// ============================================
export const talentAvailabilityEnum = pgEnum("talent_availability", ["AVAILABLE", "OPEN_TO_OFFERS", "NOT_AVAILABLE"]);
export const talentProfileVisibilityEnum = pgEnum("talent_profile_visibility", ["PUBLIC", "PRIVATE", "CONNECTIONS_ONLY"]);

// ============================================
// OVERHEAD COST ENUMS
// ============================================
export const overheadCostCategoryEnum = pgEnum("overhead_cost_category", [
  "SALARIES", "INSURANCE", "RENT_LEASE", "LOANS_FINANCING",
  "SUBSCRIPTIONS", "UTILITIES", "VEHICLES", "MARKETING",
  "PROFESSIONAL_FEES", "EQUIPMENT", "OTHER",
]);
export const overheadCostFrequencyEnum = pgEnum("overhead_cost_frequency", [
  "MONTHLY", "QUARTERLY", "ANNUAL", "ONE_TIME",
]);
export const overheadCostActionEnum = pgEnum("overhead_cost_action", [
  "CREATE", "UPDATE", "DELETE",
]);
