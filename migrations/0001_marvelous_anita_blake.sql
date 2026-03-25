CREATE TYPE "public"."addendum_recipient_type" AS ENUM('SUBCONTRACTOR', 'TEAM_MEMBER', 'CLIENT');--> statement-breakpoint
CREATE TYPE "public"."addendum_status" AS ENUM('DRAFT', 'ISSUED', 'ACKNOWLEDGED');--> statement-breakpoint
CREATE TYPE "public"."addon_key" AS ENUM('ai_pm', 'ai_cfo', 'ai_email', 'website_seo', 'bid_network', 'ai_vision', 'integration_qbo', 'integration_esign', 'ai_governance_pack');--> statement-breakpoint
CREATE TYPE "public"."addon_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."ai_bid_document_analysis_status" AS ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."ai_co_draft_status" AS ENUM('DRAFT', 'CONVERTED', 'DISCARDED');--> statement-breakpoint
CREATE TYPE "public"."ai_contract_document_analysis_status" AS ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."ai_insight_module" AS ENUM('SCHEDULING', 'DELAYS', 'COSTS', 'EQUIPMENT', 'VENDOR_PRICING', 'PROJECT_HEALTH', 'GANTT_CHART', 'LABOR', 'BIDS', 'CHANGE_ORDERS');--> statement-breakpoint
CREATE TYPE "public"."ai_insight_severity" AS ENUM('INFO', 'SUGGESTION', 'WARNING', 'CRITICAL');--> statement-breakpoint
CREATE TYPE "public"."ai_note_insight_category" AS ENUM('SUPPLY_NEED', 'EQUIPMENT_REPAIR', 'WEATHER_DELAY', 'CHANGE_ORDER', 'SAFETY', 'CLIENT_COMMUNICATION', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."ai_note_insight_severity" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');--> statement-breakpoint
CREATE TYPE "public"."ai_note_insight_source_type" AS ENUM('PROJECT', 'COMPANY');--> statement-breakpoint
CREATE TYPE "public"."ai_takeoff_mode" AS ENUM('QUICK', 'DETAILED');--> statement-breakpoint
CREATE TYPE "public"."ai_takeoff_status" AS ENUM('PENDING', 'PROCESSING', 'COMPLETE', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."ai_task_priority" AS ENUM('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');--> statement-breakpoint
CREATE TYPE "public"."ai_task_status" AS ENUM('PENDING', 'IN_PROGRESS', 'COMPLETED', 'DISMISSED');--> statement-breakpoint
CREATE TYPE "public"."approval_entity_type" AS ENUM('CHANGE_ORDER', 'SOV_PAY_APP', 'TIME_APPROVAL', 'VENDOR_BILL', 'ESIGN_SEND', 'QBO_EXPORT');--> statement-breakpoint
CREATE TYPE "public"."approval_status_v2" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."ats_provider" AS ENUM('WORKABLE', 'GREENHOUSE', 'LEVER');--> statement-breakpoint
CREATE TYPE "public"."audit_action" AS ENUM('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'SUBMIT', 'CLOCK_IN', 'CLOCK_OUT', 'ADJUST', 'REVOKE_TOKENS', 'CREATE_BID_QUOTE', 'UPDATE_BID_QUOTE', 'DELETE_BID_QUOTE', 'CREATE_BID_MATERIAL_QUOTE', 'UPDATE_BID_MATERIAL_QUOTE', 'DELETE_BID_MATERIAL_QUOTE', 'project.created', 'project.status_changed', 'bid.submitted', 'bid.converted_to_project', 'change_order.approved', 'change_order.rejected', 'timeclock.checked_in', 'timeclock.checked_out', 'payroll.run.completed', 'hiring.job_published', 'hiring.candidate_applied', 'hiring.candidate_stage_changed', 'hiring.candidate_hired', 'hiring.interview_scheduled', 'hiring.integration_connected');--> statement-breakpoint
CREATE TYPE "public"."bid_equipment_source" AS ENUM('OWNED', 'RENTAL');--> statement-breakpoint
CREATE TYPE "public"."bid_invitation_status" AS ENUM('PENDING', 'VIEWED', 'DECLINED', 'RESPONDED', 'WITHDRAWN');--> statement-breakpoint
CREATE TYPE "public"."bid_request_status" AS ENUM('DRAFT', 'OPEN', 'CLOSED', 'AWARDED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."bid_response_status" AS ENUM('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'SHORTLISTED', 'AWARDED', 'NOT_SELECTED', 'WITHDRAWN');--> statement-breakpoint
CREATE TYPE "public"."bid_status" AS ENUM('DRAFT', 'ACTIVE', 'SUBMITTED', 'AWARDED', 'LOST', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."billing_provider" AS ENUM('stripe', 'manual');--> statement-breakpoint
CREATE TYPE "public"."billing_status" AS ENUM('NOT_READY', 'READY_TO_BILL', 'BILLED');--> statement-breakpoint
CREATE TYPE "public"."blog_comment_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'SPAM');--> statement-breakpoint
CREATE TYPE "public"."blog_post_status" AS ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."calendar_event_type" AS ENUM('TIME_OFF_REQUEST', 'TIME_OFF_APPROVED', 'NETWORKING_EVENT', 'PROJECT_START', 'PROJECT_PHASE', 'PROJECT_MILESTONE');--> statement-breakpoint
CREATE TYPE "public"."change_order_status" AS ENUM('DRAFT', 'PENDING_APPROVAL', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PCO', 'PRICING_REVIEW', 'VOIDED');--> statement-breakpoint
CREATE TYPE "public"."clock_event_type" AS ENUM('CLOCK_IN', 'CLOCK_OUT', 'ADJUSTMENT', 'ADMIN_OVERRIDE', 'AUTO_CLOCK_OUT');--> statement-breakpoint
CREATE TYPE "public"."conversation_type" AS ENUM('DIRECT', 'GROUP', 'COMPANY');--> statement-breakpoint
CREATE TYPE "public"."crew_availability_status" AS ENUM('AVAILABLE', 'PARTIALLY_AVAILABLE', 'BOOKED', 'UNAVAILABLE');--> statement-breakpoint
CREATE TYPE "public"."crm_activity_type" AS ENUM('CALL', 'EMAIL', 'MEETING', 'NOTE', 'FOLLOW_UP', 'SITE_VISIT');--> statement-breakpoint
CREATE TYPE "public"."crm_contact_role" AS ENUM('PM', 'ESTIMATOR', 'SUPERINTENDENT', 'SALES', 'ACCOUNTS_PAYABLE', 'ACCOUNTS_RECEIVABLE', 'OWNER', 'GENERAL_MANAGER', 'FOREMAN', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."crm_note_type" AS ENUM('CALL', 'EMAIL', 'MEETING', 'HOT_LEAD', 'COLD_LEAD', 'FOLLOW_UP', 'ISSUE', 'GENERAL');--> statement-breakpoint
CREATE TYPE "public"."crm_org_status" AS ENUM('ACTIVE', 'PREQUALIFIED', 'COMPLIANCE_ISSUE', 'INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."crm_organisation_type" AS ENUM('CONTRACTOR', 'SUBCONTRACTOR', 'SUPPLIER', 'VENDOR', 'OWNER_REP', 'RENTAL_VENDOR');--> statement-breakpoint
CREATE TYPE "public"."crm_pipeline_stage" AS ENUM('LEAD', 'QUALIFIED', 'ESTIMATING', 'BID_SUBMITTED', 'NEGOTIATION', 'WON', 'LOST');--> statement-breakpoint
CREATE TYPE "public"."crm_preferred_contact" AS ENUM('EMAIL', 'PHONE', 'TEXT', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."daily_report_lock_status" AS ENUM('UNLOCKED', 'LOCKED', 'SUPERVISOR_LOCKED');--> statement-breakpoint
CREATE TYPE "public"."dashboard_widget_type" AS ENUM('QUICK_STATS', 'AI_INSIGHTS', 'MESSAGES', 'NOTIFICATIONS', 'CALENDAR_EVENTS', 'ACTIVE_PROJECTS', 'ACTIVE_BIDS', 'AI_TASKS', 'CREW_ASSIGNMENTS', 'RECENT_ACTIVITY', 'PROJECT_HEALTH', 'BUDGET_OVERVIEW');--> statement-breakpoint
CREATE TYPE "public"."data_subject_request_status" AS ENUM('PENDING', 'IN_PROGRESS', 'COMPLETED', 'DENIED');--> statement-breakpoint
CREATE TYPE "public"."data_subject_request_type" AS ENUM('ACCESS', 'DELETION', 'PORTABILITY', 'RECTIFICATION', 'OBJECTION');--> statement-breakpoint
CREATE TYPE "public"."deduction_calculation_method" AS ENUM('PERCENTAGE', 'FIXED_AMOUNT', 'TIERED');--> statement-breakpoint
CREATE TYPE "public"."deduction_category" AS ENUM('FEDERAL_TAX', 'STATE_TAX', 'LOCAL_TAX', 'FICA', 'MEDICARE', 'UNION_DUES', 'HEALTH_INSURANCE', 'DENTAL_INSURANCE', 'VISION_INSURANCE', 'RETIREMENT_401K', 'GARNISHMENT', 'CHILD_SUPPORT', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."delay_claim_status" AS ENUM('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."delay_claim_type" AS ENUM('TIME_EXTENSION', 'COST_IMPACT', 'BOTH');--> statement-breakpoint
CREATE TYPE "public"."delay_notification_recipient_type" AS ENUM('OWNER_REP', 'GC_REP', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."delay_notification_status" AS ENUM('DRAFT', 'FINALIZED');--> statement-breakpoint
CREATE TYPE "public"."delay_reason" AS ENUM('WEATHER', 'GC_SCHEDULING', 'OTHER_CONTRACTORS', 'MATERIAL_DELIVERY', 'PERMIT_ISSUES', 'INSPECTION_DELAY', 'OWNER_DIRECTIVE', 'DESIGN_CHANGES', 'SITE_CONDITIONS', 'LABOR_SHORTAGE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."delay_responsibility" AS ENUM('OWNER', 'GC', 'SUBCONTRACTOR', 'TFR', 'FORCE_MAJEURE');--> statement-breakpoint
CREATE TYPE "public"."delay_status" AS ENUM('DRAFT', 'SUBMITTED', 'ACKNOWLEDGED', 'RESOLVED');--> statement-breakpoint
CREATE TYPE "public"."document_revision_source" AS ENUM('upload', 'email', 'import', 'esign');--> statement-breakpoint
CREATE TYPE "public"."document_revision_status" AS ENUM('active', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('PLANS', 'SPECS', 'TAKEOFF', 'OTHER', 'BIM');--> statement-breakpoint
CREATE TYPE "public"."domain_event_status" AS ENUM('PENDING', 'PROCESSED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."dowel_size" AS ENUM('3/4_INCH', '1_INCH', '1_1/4_INCH');--> statement-breakpoint
CREATE TYPE "public"."email_classification" AS ENUM('PROJECT_UPDATE', 'BID_INVITE', 'BID_RFI', 'CHANGE_ORDER_REQUEST', 'SUBMITTAL_REQUEST', 'PAY_APP', 'INVOICE', 'DELAY_NOTICE', 'SAFETY_ISSUE', 'DELIVERY_NOTICE', 'TIME_CLOCK_ISSUE', 'VENDOR_PRICING', 'GENERAL_COMMUNICATION', 'SPAM_OR_IRRELEVANT', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."email_provider" AS ENUM('GMAIL', 'OUTLOOK', 'IMAP');--> statement-breakpoint
CREATE TYPE "public"."email_task_source" AS ENUM('EMAIL', 'MANUAL', 'AI_GENERATED');--> statement-breakpoint
CREATE TYPE "public"."email_thread_status" AS ENUM('OPEN', 'ARCHIVED', 'IGNORED');--> statement-breakpoint
CREATE TYPE "public"."equipment_status" AS ENUM('AVAILABLE', 'ASSIGNED', 'IN_REPAIR', 'OUT_OF_SERVICE', 'RETIRED');--> statement-breakpoint
CREATE TYPE "public"."equipment_type" AS ENUM('HEAVY_EQUIPMENT', 'POWER_TOOL', 'HAND_TOOL', 'VEHICLE', 'TRAILER', 'CONCRETE', 'COMPACTION', 'SURVEYING', 'SAFETY', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."estimate_item_category" AS ENUM('CONCRETE', 'EXCAVATION', 'PAVERS', 'BOLLARDS', 'GC', 'OVERHEAD', 'PROFIT', 'GENERAL');--> statement-breakpoint
CREATE TYPE "public"."estimate_line_item_source" AS ENUM('MANUAL', 'TAKEOFF', 'GENERATED');--> statement-breakpoint
CREATE TYPE "public"."estimate_status" AS ENUM('DRAFT', 'SUBMITTED', 'WON', 'LOST', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."file_type" AS ENUM('MEDIA', 'DOCUMENT', 'RECEIPT');--> statement-breakpoint
CREATE TYPE "public"."hiring_activity_type" AS ENUM('JOB_CREATED', 'JOB_PUBLISHED', 'JOB_ARCHIVED', 'CANDIDATE_APPLIED', 'CANDIDATE_STAGE_CHANGED', 'CANDIDATE_HIRED', 'CANDIDATE_REJECTED', 'NOTE_ADDED', 'INTERVIEW_SCHEDULED', 'INTEGRATION_CONNECTED', 'AI_REVIEW_GENERATED');--> statement-breakpoint
CREATE TYPE "public"."hiring_candidate_stage" AS ENUM('APPLIED', 'SCREENED', 'REVIEW', 'PHONE_SCREEN', 'INTERVIEW', 'FINAL_REVIEW', 'OFFER', 'HIRED', 'REJECTED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."hiring_compensation_type" AS ENUM('SALARY', 'HOURLY', 'PREVAILING_WAGE', 'BONUS_ELIGIBLE');--> statement-breakpoint
CREATE TYPE "public"."hiring_employment_type" AS ENUM('FULL_TIME', 'PART_TIME', 'SEASONAL', 'SUBCONTRACTOR', 'INTERN', 'TEMPORARY');--> statement-breakpoint
CREATE TYPE "public"."hiring_interview_status" AS ENUM('SCHEDULED', 'COMPLETED', 'CANCELLED', 'RESCHEDULED', 'NO_SHOW');--> statement-breakpoint
CREATE TYPE "public"."hiring_job_status" AS ENUM('DRAFT', 'PUBLISHED', 'PAUSED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."hiring_sync_status" AS ENUM('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."hustler_delegate_role" AS ENUM('COO', 'CFO', 'OPERATIONS_MANAGER');--> statement-breakpoint
CREATE TYPE "public"."hustler_link_request_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'REVOKED');--> statement-breakpoint
CREATE TYPE "public"."inspection_request_method" AS ENUM('CALL', 'EMAIL', 'PORTAL', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."inspection_status" AS ENUM('REQUESTED', 'SCHEDULED', 'PASSED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."inspection_type" AS ENUM('CITY_OFFICIAL', 'GC_REPRESENTATIVE', 'OWNER_REPRESENTATIVE');--> statement-breakpoint
CREATE TYPE "public"."integration_connection_status" AS ENUM('pending', 'active', 'error', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."integration_event_status" AS ENUM('queued', 'processing', 'sent', 'failed', 'dead_letter');--> statement-breakpoint
CREATE TYPE "public"."integration_provider" AS ENUM('qbo', 'google', 'microsoft', 'docusign', 'dropbox_sign', 'zapier', 'dropbox', 'gdrive', 'onedrive', 'box');--> statement-breakpoint
CREATE TYPE "public"."invoice_match_status" AS ENUM('PENDING', 'MATCHED', 'DISCREPANCY');--> statement-breakpoint
CREATE TYPE "public"."issue_severity" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');--> statement-breakpoint
CREATE TYPE "public"."issue_status" AS ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."jobsite_analysis_status" AS ENUM('PENDING', 'PROCESSING', 'COMPLETE', 'PARTIAL', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."leave_request_status" AS ENUM('PENDING', 'APPROVED', 'DENIED');--> statement-breakpoint
CREATE TYPE "public"."lien_waiver_status" AS ENUM('PENDING', 'SENT', 'RECEIVED', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."lien_waiver_type" AS ENUM('CONDITIONAL_PARTIAL', 'UNCONDITIONAL_PARTIAL', 'CONDITIONAL_FINAL', 'UNCONDITIONAL_FINAL');--> statement-breakpoint
CREATE TYPE "public"."maintenance_type" AS ENUM('PREVENTATIVE', 'SCHEDULED_SERVICE', 'WEAR_ITEM', 'INSPECTION', 'CALIBRATION');--> statement-breakpoint
CREATE TYPE "public"."material_responsibility" AS ENUM('TFR', 'SUBCONTRACTOR', 'CUSTOMER', 'PENDING');--> statement-breakpoint
CREATE TYPE "public"."measurement_source" AS ENUM('USER', 'AI', 'BIM');--> statement-breakpoint
CREATE TYPE "public"."measurement_status" AS ENUM('DRAFT', 'CONFIRMED');--> statement-breakpoint
CREATE TYPE "public"."measurement_type" AS ENUM('LINEAR', 'AREA', 'VOLUME', 'COUNT', 'NOTE', 'LINEAR_WITH_DROP', 'PITCHED_AREA', 'PITCHED_LINEAR', 'SURFACE_AREA', 'SEGMENT');--> statement-breakpoint
CREATE TYPE "public"."media_type" AS ENUM('IMAGE', 'VIDEO');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('SENT', 'DELIVERED', 'READ');--> statement-breakpoint
CREATE TYPE "public"."mobile_platform" AS ENUM('IOS', 'ANDROID', 'WEB');--> statement-breakpoint
CREATE TYPE "public"."note_type" AS ENUM('GENERAL', 'FIELD_NOTE', 'SAFETY', 'CLIENT_MEETING');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('BILLING_READY', 'CHANGE_ORDER_PENDING', 'TIME_OFF_REQUEST', 'GENERAL', 'MATERIAL_OVERAGE', 'PROJECT_ASSIGNMENT', 'MAINTENANCE_REQUEST', 'REPAIR_REQUEST', 'DELAY_SUBMITTED', 'DELAY_ACKNOWLEDGED', 'DELAY_CHANGE_ORDER_NEEDED', 'PORTAL_ACTIVITY', 'BID_AWARDED', 'PROGRESS_MILESTONE', 'DAILY_PROGRESS_LOGGED', 'CHANGE_ORDER_APPROVED', 'SOV_ITEM_COMPLETED', 'PORTAL_CHAT_MESSAGE', 'CHANGE_ORDER_REJECTED', 'BID_INVITATION_RECEIVED', 'BID_RESPONSE_RECEIVED', 'BID_CLARIFICATION_NEW', 'SUBMITTAL_SUBMITTED', 'SUBMITTAL_APPROVED', 'SUBMITTAL_REJECTED', 'SUBMITTAL_REVISION_REQUESTED', 'TM_TICKET_SUBMITTED', 'TM_TICKET_APPROVED', 'TM_TICKET_REJECTED', 'OVERTIME_REQUESTED', 'OVERTIME_APPROVED', 'OVERTIME_REJECTED', 'PAYABLE_SUBMITTED', 'PAYABLE_CREATED', 'PAYABLE_APPROVED', 'PAYABLE_REJECTED', 'APPROVAL_REQUEST_NEW', 'APPROVAL_REQUEST_APPROVED', 'APPROVAL_REQUEST_REJECTED', 'PROCUREMENT_PR_SUBMITTED', 'PROCUREMENT_PR_APPROVED', 'PROCUREMENT_PR_REJECTED', 'PROCUREMENT_PO_SUBMITTED', 'PROCUREMENT_PO_APPROVED', 'PROCUREMENT_PO_REJECTED', 'CRM_STAGE_CHANGE', 'CRM_IDLE_OPPORTUNITY', 'TASK_MENTIONED', 'DEADLINE_WARNING', 'REMINDER', 'TAKEOFF_ISSUE_ASSIGNED', 'TAKEOFF_ISSUE_STATUS_CHANGED', 'EQUIPMENT_RENTAL_REQUEST_RECEIVED', 'EQUIPMENT_RENTAL_REQUEST_RESPONDED', 'BID_SUBMITTED', 'BID_STATUS_CHANGED', 'BID_ASSIGNED', 'BID_DUE_DATE_APPROACHING', 'LEAVE_APPROVED', 'LEAVE_DENIED');--> statement-breakpoint
CREATE TYPE "public"."offline_entity_type" AS ENUM('TIME_ENTRY', 'NOTE', 'ISSUE', 'VOICE_LOG', 'PHOTO');--> statement-breakpoint
CREATE TYPE "public"."offline_operation_type" AS ENUM('CREATE', 'UPDATE', 'DELETE');--> statement-breakpoint
CREATE TYPE "public"."offline_sync_status" AS ENUM('PENDING', 'SYNCED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."onboarding_status" AS ENUM('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."organization_document_type" AS ENUM('LOGO_PRIMARY', 'LOGO_SECONDARY', 'LETTERHEAD', 'INSURANCE_CERT_GENERAL_LIABILITY', 'INSURANCE_CERT_WORKERS_COMP', 'INSURANCE_CERT_AUTO', 'INSURANCE_CERT_UMBRELLA', 'W9', 'LICENSE', 'BONDING_LETTER', 'BANKING_INFO', 'SAFETY_PROGRAM', 'COMPANY_PROFILE', 'TEMPLATE_OTHER');--> statement-breakpoint
CREATE TYPE "public"."organization_document_visibility" AS ENUM('PUBLIC', 'INTERNAL', 'CONFIDENTIAL');--> statement-breakpoint
CREATE TYPE "public"."overage_action_status" AS ENUM('NONE', 'PENDING', 'BILLED', 'DEDUCTED', 'ABSORBED', 'RESOLVED');--> statement-breakpoint
CREATE TYPE "public"."overhead_cost_action" AS ENUM('CREATE', 'UPDATE', 'DELETE');--> statement-breakpoint
CREATE TYPE "public"."overhead_cost_category" AS ENUM('SALARIES', 'INSURANCE', 'RENT_LEASE', 'LOANS_FINANCING', 'SUBSCRIPTIONS', 'UTILITIES', 'VEHICLES', 'MARKETING', 'PROFESSIONAL_FEES', 'EQUIPMENT', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."overhead_cost_frequency" AS ENUM('MONTHLY', 'QUARTERLY', 'ANNUAL', 'ONE_TIME');--> statement-breakpoint
CREATE TYPE "public"."overtime_request_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."pay_run_status" AS ENUM('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PROCESSING', 'PAID', 'VOIDED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."photo_custody_action" AS ENUM('CAPTURED', 'UPLOADED', 'VIEWED', 'DOWNLOADED', 'ATTACHED_TO_CLAIM', 'EXPORTED');--> statement-breakpoint
CREATE TYPE "public"."plan_tier" AS ENUM('free', 'starter', 'professional', 'enterprise');--> statement-breakpoint
CREATE TYPE "public"."po_receipt_item_condition" AS ENUM('GOOD', 'DAMAGED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."po_receipt_status" AS ENUM('PARTIAL', 'COMPLETE');--> statement-breakpoint
CREATE TYPE "public"."portal_chat_priority" AS ENUM('NORMAL', 'URGENT');--> statement-breakpoint
CREATE TYPE "public"."portal_chat_thread_category" AS ENUM('PROJECT', 'RFI', 'SUBMITTAL', 'TASK', 'GENERAL');--> statement-breakpoint
CREATE TYPE "public"."portal_chat_thread_status" AS ENUM('OPEN', 'CLOSED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."pricebook_import_job_status" AS ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."pricebook_status" AS ENUM('PENDING', 'PROCESSING', 'ACTIVE', 'EXPIRED', 'SUPERSEDED');--> statement-breakpoint
CREATE TYPE "public"."pricing_approval_status" AS ENUM('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'AUTO_APPROVED');--> statement-breakpoint
CREATE TYPE "public"."pricing_source_type" AS ENUM('MANUAL', 'PRICEBOOK_IMPORT', 'VENDOR_PORTAL');--> statement-breakpoint
CREATE TYPE "public"."procurement_status" AS ENUM('PLANNED', 'QUOTED', 'APPROVED', 'ORDERED', 'DELIVERED');--> statement-breakpoint
CREATE TYPE "public"."project_equipment_plan_status" AS ENUM('PLANNED', 'ASSIGNED', 'RENTAL_BOOKED', 'RENTAL_ACTIVE', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('BID', 'PLANNING', 'ACTIVE', 'COMPLETE', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."punch_list_priority" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');--> statement-breakpoint
CREATE TYPE "public"."punch_list_status" AS ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED', 'VERIFIED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."punch_list_trade" AS ENUM('GENERAL', 'ELECTRICAL', 'PLUMBING', 'HVAC', 'FRAMING', 'DRYWALL', 'PAINTING', 'ROOFING', 'FLOORING', 'CONCRETE', 'MASONRY', 'TILE', 'CARPENTRY', 'INSULATION', 'GLAZING', 'LANDSCAPING', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."purchase_order_status" AS ENUM('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'ACKNOWLEDGED', 'PARTIAL', 'FULFILLED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."purchase_request_status" AS ENUM('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CONVERTED_TO_PO');--> statement-breakpoint
CREATE TYPE "public"."rebar_size" AS ENUM('#3', '#4', '#5', '#6');--> statement-breakpoint
CREATE TYPE "public"."repair_status" AS ENUM('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."retention_action" AS ENUM('DELETE', 'ARCHIVE', 'ANONYMIZE');--> statement-breakpoint
CREATE TYPE "public"."retention_entity_type" AS ENUM('AUDIT_LOGS', 'AI_ACTIONS', 'DOCUMENTS', 'TIME_ENTRIES', 'MESSAGES', 'FILE_UPLOADS');--> statement-breakpoint
CREATE TYPE "public"."reward_type_enum" AS ENUM('BONUS', 'INCENTIVE', 'RECOGNITION', 'POINTS', 'CUSTOM');--> statement-breakpoint
CREATE TYPE "public"."rfi_category" AS ENUM('DESIGN_CLARIFICATION', 'FIELD_CONDITION', 'SUBSTITUTION_REQUEST', 'SPECIFICATION_INTERPRETATION', 'SCHEDULE', 'ADMINISTRATIVE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."rfi_priority" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT');--> statement-breakpoint
CREATE TYPE "public"."rfi_status" AS ENUM('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'FORWARDED', 'ANSWERED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."safety_severity" AS ENUM('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');--> statement-breakpoint
CREATE TYPE "public"."salary_type" AS ENUM('FIXED', 'CONTRACT', 'HOURLY_EQUIVALENT', 'SEASONAL');--> statement-breakpoint
CREATE TYPE "public"."schedule_generated_by" AS ENUM('AI', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."schedule_task_status" AS ENUM('NOT_STARTED', 'IN_PROGRESS', 'COMPLETE', 'DELAYED', 'ON_HOLD');--> statement-breakpoint
CREATE TYPE "public"."scope_type" AS ENUM('CONCRETE', 'EXCAVATION', 'PAVERS', 'BOLLARDS', 'UNDERDRAIN', 'BASE', 'BEDDING', 'GENERAL');--> statement-breakpoint
CREATE TYPE "public"."sealer_type" AS ENUM('CURE_AND_SEAL', 'PENETRATING', 'ACRYLIC', 'EPOXY');--> statement-breakpoint
CREATE TYPE "public"."shift_approval_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."social_account_status" AS ENUM('CONNECTED', 'DISCONNECTED', 'EXPIRED', 'ERROR');--> statement-breakpoint
CREATE TYPE "public"."social_platform" AS ENUM('FACEBOOK', 'INSTAGRAM', 'LINKEDIN', 'TWITTER', 'TIKTOK', 'YOUTUBE', 'PINTEREST');--> statement-breakpoint
CREATE TYPE "public"."social_post_status" AS ENUM('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SCHEDULED', 'QUEUED', 'POSTED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."sov_payment_method" AS ENUM('CHECK', 'ACH', 'WIRE', 'CREDIT_CARD', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."sov_status" AS ENUM('DRAFT', 'PENDING', 'APPROVED', 'SUBMITTED', 'PAID', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."sow_audit_action" AS ENUM('CREATE', 'UPDATE', 'DEACTIVATE', 'REGENERATE');--> statement-breakpoint
CREATE TYPE "public"."sso_provider" AS ENUM('OKTA', 'AZURE_AD', 'ONELOGIN', 'CUSTOM');--> statement-breakpoint
CREATE TYPE "public"."stone_type" AS ENUM('CRUSHED_STONE', 'LIMESTONE', 'COMPACTED_BASE', 'PEA_GRAVEL', 'RECYCLED_CONCRETE');--> statement-breakpoint
CREATE TYPE "public"."submittal_category" AS ENUM('SHOP_DRAWING', 'PRODUCT_DATA', 'MATERIAL_APPROVAL', 'ENGINEERING_APPROVAL', 'SAMPLE', 'OPERATION_AND_MAINTENANCE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."submittal_item_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'REVISE');--> statement-breakpoint
CREATE TYPE "public"."submittal_phase" AS ENUM('ESTIMATE', 'AWARDED', 'CONSTRUCTION');--> statement-breakpoint
CREATE TYPE "public"."submittal_review_role" AS ENUM('ARCHITECT', 'ENGINEER', 'OWNER', 'GC_MANAGER');--> statement-breakpoint
CREATE TYPE "public"."submittal_review_status" AS ENUM('PENDING', 'IN_REVIEW', 'APPROVED', 'APPROVED_AS_NOTED', 'REJECTED', 'REVISE_AND_RESUBMIT');--> statement-breakpoint
CREATE TYPE "public"."submittal_status" AS ENUM('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'APPROVED_AS_NOTED', 'REJECTED', 'REVISE_AND_RESUBMIT');--> statement-breakpoint
CREATE TYPE "public"."submittal_type" AS ENUM('CONTRACTOR', 'SUBCONTRACTOR');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trialing', 'active', 'past_due', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('IN_PROGRESS', 'COMPLETE', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."takeoff_issue_category" AS ENUM('QUESTION', 'CONFLICT', 'RFI', 'OBSERVATION');--> statement-breakpoint
CREATE TYPE "public"."takeoff_issue_status" AS ENUM('OPEN', 'IN_REVIEW', 'RESOLVED');--> statement-breakpoint
CREATE TYPE "public"."talent_availability" AS ENUM('AVAILABLE', 'OPEN_TO_OFFERS', 'NOT_AVAILABLE');--> statement-breakpoint
CREATE TYPE "public"."talent_profile_visibility" AS ENUM('PUBLIC', 'PRIVATE', 'CONNECTIONS_ONLY');--> statement-breakpoint
CREATE TYPE "public"."task_source_type" AS ENUM('MANUAL', 'EMAIL', 'AI_GENERATED', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."tm_billing_status" AS ENUM('PENDING', 'APPROVED_FOR_BILLING', 'INVOICED', 'BILLED');--> statement-breakpoint
CREATE TYPE "public"."tm_invoice_status" AS ENUM('DRAFT', 'SENT', 'PAID', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."tm_ticket_status" AS ENUM('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."trade_type" AS ENUM('GENERAL_CONTRACTOR', 'CONCRETE', 'EARTHWORK', 'ASPHALT_PAVING', 'ROOFING', 'ELECTRICAL', 'PLUMBING', 'HVAC', 'CARPENTRY', 'MASONRY', 'DRYWALL', 'PAINTING', 'FLOORING', 'LANDSCAPING', 'DEMOLITION', 'STEEL_ERECTION', 'GLAZING', 'INSULATION', 'FIRE_PROTECTION', 'LOW_VOLTAGE', 'SOLAR', 'WATERPROOFING', 'OTHER', 'SITE_DEMOLITION', 'MASS_EXCAVATION', 'TRENCHING', 'SHORING', 'DEWATERING', 'SOIL_STABILIZATION', 'ENVIRONMENTAL_REMEDIATION', 'WELL_PLUGGING', 'STORMWATER_SYSTEMS', 'SANITARY_SEWER', 'WATERLINE', 'FORCE_MAIN', 'ROADWAY_CONSTRUCTION', 'CURB_AND_GUTTER', 'SIDEWALK', 'CONCRETE_PAVING', 'TRAFFIC_CONTROL', 'STRIPING_AND_SIGNAGE', 'EROSION_CONTROL', 'FENCING_AND_GATES', 'CAST_IN_PLACE_CONCRETE', 'PRECAST_CONCRETE', 'REBAR_AND_POST_TENSION', 'STRUCTURAL_STEEL', 'METAL_BUILDINGS', 'CARPENTRY_FRAMING', 'DRYWALL_SYSTEMS', 'ACOUSTICAL_CEILINGS', 'PAINTING_AND_COATINGS', 'FLOORING_SYSTEMS', 'ROOFING_SYSTEMS', 'MASONRY_SYSTEMS', 'GLAZING_SYSTEMS', 'ELECTRICAL_UNDERGROUND', 'ELECTRICAL_OVERHEAD', 'MECHANICAL_PIPING', 'HVAC_SYSTEMS', 'PLUMBING_SYSTEMS', 'FIRE_PROTECTION_SYSTEMS', 'LOW_VOLTAGE_SYSTEMS', 'SECURITY_AND_ACCESS', 'COMMUNICATIONS_IT', 'SOLAR_INSTALLATION', 'TEMPORARY_POWER', 'SURVEY_AND_LAYOUT', 'TESTING_AND_INSPECTIONS', 'COMMISSIONING', 'TEMPORARY_FACILITIES', 'GENERAL_CONDITIONS');--> statement-breakpoint
CREATE TYPE "public"."transmittal_status" AS ENUM('DRAFT', 'SENT', 'ACKNOWLEDGED', 'SUPERSEDED');--> statement-breakpoint
CREATE TYPE "public"."underlayment_type" AS ENUM('POLY_6MIL', 'POLY_10MIL', 'VAPOR_BARRIER');--> statement-breakpoint
CREATE TYPE "public"."usage_key" AS ENUM('ai_vision_docs');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'SUPERINTENDENT', 'ESTIMATOR', 'OFFICE_MANAGER', 'HOURLY_EMPLOYEE', 'MAINTENANCE_MANAGER', 'VENDOR', 'HUSTLER', 'SALES', 'MARKETING', 'SAFETY_MANAGER', 'HR_MANAGER', 'EQUIPMENT_MANAGER', 'PROJECT_ENGINEER', 'PROCUREMENT_MANAGER', 'DISPATCHER');--> statement-breakpoint
CREATE TYPE "public"."vendor_enrollment_status" AS ENUM('PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."vendor_invoice_status" AS ENUM('PENDING', 'MATCHED', 'APPROVED', 'PAID', 'DISPUTED');--> statement-breakpoint
CREATE TYPE "public"."vendor_score_category" AS ENUM('QUALITY', 'TIMELINESS', 'COMMUNICATION', 'PRICING', 'RELIABILITY');--> statement-breakpoint
CREATE TYPE "public"."voice_log_status" AS ENUM('PENDING', 'TRANSCRIBED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."warranty_case_status" AS ENUM('OPEN', 'ACKNOWLEDGED', 'IN_REPAIR', 'REPAIRED', 'CLOSED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."warranty_case_type" AS ENUM('DEFECT', 'WARRANTY_CLAIM', 'CALLBACK', 'RECALL');--> statement-breakpoint
CREATE TYPE "public"."warranty_document_type" AS ENUM('PHOTO', 'INVOICE', 'INSPECTION_REPORT', 'COMMUNICATION', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."warranty_priority" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');--> statement-breakpoint
CREATE TYPE "public"."warranty_task_status" AS ENUM('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."website_deployment_action" AS ENUM('PUBLISHED', 'UNPUBLISHED', 'MAINTENANCE_ON', 'MAINTENANCE_OFF', 'DOMAIN_UPDATED', 'DOMAIN_VERIFIED', 'SETTINGS_UPDATED', 'REPUBLISHED');--> statement-breakpoint
CREATE TYPE "public"."website_page_type" AS ENUM('HOME', 'ABOUT', 'SERVICES', 'SAFETY', 'GALLERY', 'BLOG', 'CONTACT', 'CUSTOM');--> statement-breakpoint
CREATE TYPE "public"."website_project_status" AS ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."website_status" AS ENUM('DRAFT', 'PUBLISHED', 'MAINTENANCE');--> statement-breakpoint
CREATE TYPE "public"."wire_mesh_type" AS ENUM('6X6_W1.4_W1.4', '6X6_W2.9_W2.9', '4X4_W1.4_W1.4', '4X4_W2.9_W2.9');--> statement-breakpoint
CREATE TYPE "public"."work_week_start_day" AS ENUM('SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY');--> statement-breakpoint
CREATE TYPE "public"."equipment_category" AS ENUM('Excavation', 'Lifting', 'Concrete', 'Compaction', 'Aerial', 'Power', 'Scaffolding', 'Other');--> statement-breakpoint
CREATE TYPE "public"."equipment_condition" AS ENUM('Excellent', 'Good', 'Fair');--> statement-breakpoint
CREATE TYPE "public"."rental_request_status" AS ENUM('PENDING', 'ACCEPTED', 'DECLINED');--> statement-breakpoint
CREATE TYPE "public"."takeoff_markup_tool" AS ENUM('ARROW', 'TEXT', 'RECTANGLE', 'CLOUD', 'HIGHLIGHT', 'FREEHAND');--> statement-breakpoint
CREATE TABLE "bids" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"client_name" text NOT NULL,
	"client_contact_name" text,
	"client_contact_email" text,
	"client_contact_phone" text,
	"bid_amount" numeric(12, 2),
	"due_date" timestamp,
	"location_address" text,
	"city" text,
	"state" text,
	"description" text,
	"estimator_id" varchar,
	"gc_organization_id" varchar,
	"owner_rep_organization_id" varchar,
	"status" "bid_status" DEFAULT 'DRAFT' NOT NULL,
	"converted_to_project_id" varchar,
	"awarded_at" timestamp,
	"submitted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bids_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "employee_deductions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"deduction_type_id" varchar NOT NULL,
	"override_amount" numeric(12, 2),
	"effective_date" date NOT NULL,
	"end_date" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_addons" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"addon_key" "addon_key" NOT NULL,
	"status" "addon_status" DEFAULT 'inactive' NOT NULL,
	"stripe_price_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "org_addon_unique" UNIQUE("organization_id","addon_key")
);
--> statement-breakpoint
CREATE TABLE "organization_payroll_settings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"work_week_start_day" "work_week_start_day" DEFAULT 'MONDAY' NOT NULL,
	"work_week_end_notification_enabled" boolean DEFAULT true NOT NULL,
	"notification_recipient_emails" text,
	"overtime_threshold_hours" numeric(5, 2) DEFAULT '40' NOT NULL,
	"auto_generate_weekly_reports" boolean DEFAULT true NOT NULL,
	"require_superintendent_approval" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organization_payroll_settings_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "organization_subscriptions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"plan_tier" "plan_tier" DEFAULT 'free' NOT NULL,
	"status" "subscription_status" DEFAULT 'active' NOT NULL,
	"billing_provider" "billing_provider" DEFAULT 'manual' NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"current_period_end" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organization_subscriptions_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "organization_usage" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"usage_key" "usage_key" NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"trade_type" "trade_type" DEFAULT 'GENERAL_CONTRACTOR' NOT NULL,
	"trade_name" text,
	"logo_url" text,
	"primary_color" text,
	"secondary_color" text,
	"accent_color" text,
	"font_family" text,
	"website_url" text,
	"region" text,
	"typical_crew_size" integer,
	"address" text,
	"city" text,
	"state" text,
	"zip_code" text,
	"phone" text,
	"email" text,
	"onboarding_status" "onboarding_status" DEFAULT 'NOT_STARTED' NOT NULL,
	"onboarding_data" text,
	"terminology_json" text,
	"theme_extracted_at" timestamp,
	"feature_flags" text,
	"match_tolerance_pct" numeric(5, 2) DEFAULT '5',
	"is_active" boolean DEFAULT true NOT NULL,
	"hiring_auto_tasks_enabled" boolean DEFAULT false NOT NULL,
	"annual_revenue_target" numeric(15, 2),
	"default_overhead_percent" numeric(8, 4) DEFAULT '15',
	"overhead_warning_threshold" numeric(8, 4),
	"overhead_critical_threshold" numeric(8, 4),
	"overhead_category_weights" text,
	"monthly_revenue_targets" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "pay_run_line_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pay_run_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"project_id" varchar NOT NULL,
	"cost_code" text,
	"regular_hours" numeric(8, 2) DEFAULT '0' NOT NULL,
	"overtime_hours" numeric(8, 2) DEFAULT '0' NOT NULL,
	"regular_rate" numeric(10, 2) DEFAULT '0' NOT NULL,
	"overtime_rate" numeric(10, 2) DEFAULT '0' NOT NULL,
	"total_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"gross_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_deductions" numeric(12, 2) DEFAULT '0' NOT NULL,
	"net_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"time_entry_ids" text[],
	"wage_type" text DEFAULT 'STANDARD',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pay_runs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"pay_period_start" date NOT NULL,
	"pay_period_end" date NOT NULL,
	"run_number" text,
	"status" "pay_run_status" DEFAULT 'DRAFT' NOT NULL,
	"total_regular_hours" numeric(10, 2) DEFAULT '0' NOT NULL,
	"total_overtime_hours" numeric(10, 2) DEFAULT '0' NOT NULL,
	"total_labor_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_gross_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_deductions" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_net_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_workers" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_by_id" varchar NOT NULL,
	"approved_by_id" varchar,
	"approved_at" timestamp,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pay_stub_deductions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pay_run_line_item_id" varchar NOT NULL,
	"deduction_type_id" varchar NOT NULL,
	"amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"ytd_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_deduction_types" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"name" text NOT NULL,
	"category" "deduction_category" NOT NULL,
	"calculation_method" "deduction_calculation_method" DEFAULT 'FIXED_AMOUNT' NOT NULL,
	"rate" numeric(8, 4),
	"amount" numeric(12, 2),
	"max_annual_amount" numeric(12, 2),
	"is_pre_tax" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"client_name" text NOT NULL,
	"client_contact_name" text,
	"client_contact_email" text,
	"client_contact_phone" text,
	"status" "project_status" DEFAULT 'PLANNING' NOT NULL,
	"location_address" text,
	"city" text,
	"state" text,
	"start_date" timestamp,
	"end_date" timestamp,
	"estimated_completion_date" timestamp,
	"description" text,
	"budget" numeric(12, 2),
	"contract_amount" numeric(12, 2),
	"textura_draw_date" date,
	"draw_day_of_month" integer,
	"estimator_id" varchar,
	"superintendent_id" varchar,
	"project_manager_id" varchar,
	"gc_organization_id" varchar,
	"owner_rep_organization_id" varchar,
	"site_latitude" double precision,
	"site_longitude" double precision,
	"geofence_radius" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "projects_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "subscription_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"event_type" text NOT NULL,
	"previous_value" text,
	"new_value" text,
	"description" text NOT NULL,
	"performed_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"role" "user_role" DEFAULT 'HOURLY_EMPLOYEE' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"password_hash" text,
	"token_version" integer DEFAULT 0 NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"failed_login_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp,
	"oauth_provider" text,
	"oauth_provider_id" text,
	"cost_rate_regular" numeric(10, 2),
	"cost_rate_overtime" numeric(10, 2),
	"birthdate" text,
	"timezone" text,
	"profile_description" text,
	"avatar_url" text,
	"trade_specialization" text,
	"employment_type" text,
	"emergency_contact_name" text,
	"emergency_contact_phone" text,
	"emergency_contact_address" text,
	"emergency_contact_email" text,
	"walkthrough_completed" boolean DEFAULT false NOT NULL,
	"walkthrough_step" integer DEFAULT 0 NOT NULL,
	"walkthrough_started_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "weekly_payroll_reports" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"week_start_date" date NOT NULL,
	"week_end_date" date NOT NULL,
	"total_regular_hours" numeric(10, 2) DEFAULT '0' NOT NULL,
	"total_overtime_hours" numeric(10, 2) DEFAULT '0' NOT NULL,
	"total_employees" integer DEFAULT 0 NOT NULL,
	"report_data" text,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	"generated_by_approval_of" varchar,
	"notification_sent_at" timestamp,
	"notification_recipients" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_payroll_reports_org_week_unique" UNIQUE("organization_id","week_start_date")
);
--> statement-breakpoint
CREATE TABLE "ai_note_insights" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" varchar NOT NULL,
	"source_type" "ai_note_insight_source_type" NOT NULL,
	"source_id" varchar NOT NULL,
	"project_id" varchar,
	"category" "ai_note_insight_category" NOT NULL,
	"summary" text NOT NULL,
	"recommended_actions_json" text,
	"severity" "ai_note_insight_severity" DEFAULT 'MEDIUM' NOT NULL,
	"recipients_json" text,
	"status" "ai_task_status" DEFAULT 'PENDING' NOT NULL,
	"acknowledged_by_id" varchar,
	"acknowledged_at" timestamp,
	"completed_by_id" varchar,
	"completed_at" timestamp,
	"dismissed_by_id" varchar,
	"dismissed_at" timestamp,
	"dismiss_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "annual_salary_categories" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"name" text NOT NULL,
	"base_annual_salary" numeric(12, 2) NOT NULL,
	"salary_type" "salary_type" DEFAULT 'FIXED',
	"effective_date" date DEFAULT now() NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "annual_salary_categories_organization_id_name_unique" UNIQUE("organization_id","name")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" varchar NOT NULL,
	"action" "audit_action" NOT NULL,
	"old_value" text,
	"new_value" text,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bid_documents" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bid_id" varchar NOT NULL,
	"type" "document_type" DEFAULT 'OTHER' NOT NULL,
	"title" text NOT NULL,
	"file_name" text NOT NULL,
	"file_url" text NOT NULL,
	"object_key" text,
	"file_size" integer,
	"mime_type" text,
	"uploaded_by_id" varchar NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bid_material_quotes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bid_id" varchar,
	"project_id" varchar,
	"material_name" text NOT NULL,
	"description" text NOT NULL,
	"specs" text,
	"cost" numeric(12, 2) NOT NULL,
	"lead_time" text,
	"supplier_name" text,
	"supplier_contact" text,
	"supplier_email" text,
	"is_selected" boolean DEFAULT false NOT NULL,
	"file_url" text,
	"file_name" text,
	"file_size" integer,
	"mime_type" text,
	"rfq_sent_at" timestamp,
	"rfq_status" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bid_subcontractor_quotes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bid_id" varchar,
	"project_id" varchar,
	"subcontractor_name" text NOT NULL,
	"scope_of_work" text NOT NULL,
	"quote_amount" numeric(12, 2) NOT NULL,
	"lead_time" text,
	"estimated_completion_time" text,
	"contact_name" text,
	"contact_email" text,
	"contact_phone" text,
	"notes" text,
	"is_selected" boolean DEFAULT false NOT NULL,
	"file_url" text,
	"file_name" text,
	"file_size" integer,
	"mime_type" text,
	"rfq_sent_at" timestamp,
	"rfq_status" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope_item_id" varchar NOT NULL,
	"quantity" numeric(12, 2) NOT NULL,
	"unit_price" numeric(10, 2) NOT NULL,
	"total_amount" numeric(12, 2) NOT NULL,
	"description" text,
	"created_by_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_line_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"cost_code" varchar(20) NOT NULL,
	"description" varchar(255) NOT NULL,
	"division" varchar(100) NOT NULL,
	"labor_budget" numeric(12, 2) DEFAULT '0' NOT NULL,
	"material_budget" numeric(12, 2) DEFAULT '0' NOT NULL,
	"subcontractor_budget" numeric(12, 2) DEFAULT '0' NOT NULL,
	"equipment_budget" numeric(12, 2) DEFAULT '0' NOT NULL,
	"other_budget" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_budget" numeric(12, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "budget_line_items_project_code_uniq" UNIQUE("project_id","cost_code")
);
--> statement-breakpoint
CREATE TABLE "burden_rates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"name" text NOT NULL,
	"burden_percentage" numeric(8, 4) DEFAULT '0' NOT NULL,
	"fixed_burden_amount" numeric(12, 2) DEFAULT '0',
	"taxes_percent" numeric(8, 4) DEFAULT '0',
	"benefits_percent" numeric(8, 4) DEFAULT '0',
	"insurance_percent" numeric(8, 4) DEFAULT '0',
	"overhead_percent" numeric(8, 4) DEFAULT '0',
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "burden_rates_organization_id_name_unique" UNIQUE("organization_id","name")
);
--> statement-breakpoint
CREATE TABLE "calendar_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" "calendar_event_type" NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp,
	"all_day" boolean DEFAULT false NOT NULL,
	"user_id" varchar,
	"project_id" varchar,
	"crm_organisation_id" varchar,
	"approved_by_id" varchar,
	"approved_at" timestamp,
	"created_by_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_order_approvals" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"change_order_id" varchar NOT NULL,
	"approver_role" text NOT NULL,
	"approver_id" varchar,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"step_order" integer NOT NULL,
	"comments" text,
	"decided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_order_attachments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"change_order_id" varchar NOT NULL,
	"organization_id" varchar NOT NULL,
	"file_name" text NOT NULL,
	"file_size" integer,
	"mime_type" text,
	"storage_key" text NOT NULL,
	"uploaded_by_id" varchar NOT NULL,
	"uploaded_by_name" text,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_order_equipment_entries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"change_order_id" varchar NOT NULL,
	"equipment_type" text NOT NULL,
	"description" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"hours_used" numeric(8, 2) NOT NULL,
	"hourly_rate" numeric(10, 2) NOT NULL,
	"total_cost" numeric(12, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_order_labor_entries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"change_order_id" varchar NOT NULL,
	"employee_name" text NOT NULL,
	"position" text,
	"hours_worked" numeric(8, 2) NOT NULL,
	"hourly_rate" numeric(10, 2) NOT NULL,
	"total_cost" numeric(12, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_order_material_entries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"change_order_id" varchar NOT NULL,
	"material_description" text NOT NULL,
	"category" text,
	"quantity" numeric(12, 2) NOT NULL,
	"unit" text,
	"unit_cost" numeric(10, 2) NOT NULL,
	"total_cost" numeric(12, 2) NOT NULL,
	"vendor_pricing_id" varchar
);
--> statement-breakpoint
CREATE TABLE "change_order_revisions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"change_order_id" varchar NOT NULL,
	"revision_number" integer NOT NULL,
	"previous_status" text NOT NULL,
	"new_status" text NOT NULL,
	"amount" numeric(12, 2),
	"description" text,
	"changed_fields" text,
	"revised_by_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_orders" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"change_order_number" text NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"status" "change_order_status" DEFAULT 'DRAFT' NOT NULL,
	"requested_by_id" varchar NOT NULL,
	"submitted_at" timestamp,
	"approved_by_id" varchar,
	"approved_at" timestamp,
	"rejection_reason" text,
	"approval_chain_json" text,
	"attachments_json" text,
	"client_response_due_date" timestamp,
	"linked_tm_ticket_id" varchar,
	"linked_rfi_id" varchar,
	"voided_at" timestamp,
	"voided_by_id" varchar,
	"void_reason" text,
	"work_type_id" varchar,
	"work_type_code" text,
	"work_type_name" text,
	"category_name" text,
	"scope_modifier_ids" text,
	"scope_modifier_names" text,
	"canonical_name" text,
	"scope_unit" text,
	"scope_quantity" text,
	"cost_breakdown_json" text,
	"overhead_percent" numeric(5, 2) DEFAULT '10',
	"profit_percent" numeric(5, 2) DEFAULT '5',
	"subcontractor_markup_percent" numeric(5, 2) DEFAULT '5',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_daily_notes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" varchar NOT NULL,
	"project_id" varchar,
	"text" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_report_locks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"project_id" varchar NOT NULL,
	"report_date" date NOT NULL,
	"status" "daily_report_lock_status" DEFAULT 'UNLOCKED' NOT NULL,
	"locked_at" timestamp,
	"locked_by_id" varchar,
	"lock_reason" text,
	"supervisor_locked_at" timestamp,
	"supervisor_locked_by_id" varchar,
	"supervisor_lock_notes" text,
	"content_hash" text,
	"linked_claim_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "daily_report_locks_project_date_unique" UNIQUE("project_id","report_date")
);
--> statement-breakpoint
CREATE TABLE "daily_scope_progress" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope_item_id" varchar NOT NULL,
	"project_id" varchar NOT NULL,
	"organization_sow_item_id" varchar,
	"work_date" date NOT NULL,
	"quantity_completed" numeric(12, 2) NOT NULL,
	"billed_quantity" numeric(12, 2) DEFAULT '0' NOT NULL,
	"billing_status" "billing_status" DEFAULT 'NOT_READY' NOT NULL,
	"billed_date" timestamp,
	"billed_by_id" varchar,
	"notes" text,
	"labor_hours" numeric(10, 2),
	"labor_cost" numeric(12, 2),
	"crew_size" integer,
	"material_cost" numeric(12, 2),
	"equipment_hours" numeric(10, 2),
	"equipment_cost" numeric(12, 2),
	"labor_hours_per_unit" numeric(10, 4),
	"labor_cost_per_unit" numeric(10, 4),
	"material_cost_per_unit" numeric(10, 4),
	"total_cost_per_unit" numeric(10, 4),
	"created_by_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delay_claims" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"project_id" varchar NOT NULL,
	"claim_number" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"claim_type" "delay_claim_type" NOT NULL,
	"status" "delay_claim_status" DEFAULT 'DRAFT' NOT NULL,
	"linked_delay_ids" text[],
	"days_requested" integer,
	"days_approved" integer,
	"original_completion_date" timestamp,
	"requested_completion_date" timestamp,
	"cost_requested" numeric(12, 2),
	"cost_approved" numeric(12, 2),
	"cost_breakdown_json" json,
	"supporting_doc_urls" text[],
	"weather_evidence_summary" text,
	"submitted_at" timestamp,
	"submitted_by_id" varchar,
	"reviewed_at" timestamp,
	"reviewed_by_id" varchar,
	"review_notes" text,
	"approved_at" timestamp,
	"approved_by_id" varchar,
	"rejected_at" timestamp,
	"rejected_by_id" varchar,
	"rejection_reason" text,
	"linked_change_order_id" varchar,
	"created_by_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delay_notifications" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delay_id" varchar NOT NULL,
	"recipient_type" "delay_notification_recipient_type" NOT NULL,
	"recipient_name" text NOT NULL,
	"recipient_company" text,
	"recipient_email" text,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"status" "delay_notification_status" DEFAULT 'DRAFT' NOT NULL,
	"created_by_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"org_id" varchar NOT NULL,
	"actor_id" varchar NOT NULL,
	"payload" json NOT NULL,
	"status" "domain_event_status" DEFAULT 'PENDING' NOT NULL,
	"processed_at" timestamp,
	"failure_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_verification_tokens" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_classifications" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"classification_id" varchar NOT NULL,
	"regular_rate" numeric(10, 2) NOT NULL,
	"overtime_rate" numeric(10, 2) NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"effective_date" date DEFAULT now() NOT NULL,
	"end_date" date,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "employee_classifications_user_id_classification_id_unique" UNIQUE("user_id","classification_id")
);
--> statement-breakpoint
CREATE TABLE "employee_cost_assignments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"salary_category_id" varchar NOT NULL,
	"burden_rate_id" varchar,
	"working_hours_per_year" integer DEFAULT 2080 NOT NULL,
	"fully_burdened_cost" numeric(14, 2),
	"derived_hourly_rate" numeric(10, 4),
	"effective_date" date DEFAULT now() NOT NULL,
	"end_date" date,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "employee_cost_assignments_user_id_salary_category_id_unique" UNIQUE("user_id","salary_category_id")
);
--> statement-breakpoint
CREATE TABLE "estimate_line_item_subcontractors" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"line_item_id" varchar NOT NULL,
	"subcontractor_quote_id" varchar NOT NULL,
	"allocated_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"is_selected" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "eli_sub_unique_assignment" UNIQUE("line_item_id","subcontractor_quote_id")
);
--> statement-breakpoint
CREATE TABLE "estimate_line_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"estimate_id" varchar NOT NULL,
	"category" "estimate_item_category" NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(12, 2) NOT NULL,
	"unit" text NOT NULL,
	"source" "estimate_line_item_source" DEFAULT 'MANUAL' NOT NULL,
	"source_takeoff_category_id" varchar,
	"scope_work_type_id" varchar,
	"work_type_code" text,
	"computed_quantity" numeric(12, 2),
	"material_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"labor_hours" numeric(10, 2) DEFAULT '0' NOT NULL,
	"labor_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"equipment_hours" numeric(10, 2) DEFAULT '0' NOT NULL,
	"equipment_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"consumables_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"subcontract_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"subcontractor_quote_id" varchar,
	"overhead_allocation" numeric(12, 2) DEFAULT '0' NOT NULL,
	"profit_allocation" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_cost" numeric(12, 2) NOT NULL,
	"user_adjusted" boolean DEFAULT false NOT NULL,
	"metadata" text,
	"concrete_depth_inches" numeric(6, 2),
	"dimension_width_inches" numeric(8, 2),
	"dimension_height_inches" numeric(8, 2),
	"concrete_waste_factor" numeric(5, 2) DEFAULT '10',
	"calculated_concrete_yards" numeric(10, 2),
	"requires_stone_base" boolean DEFAULT false,
	"stone_type" "stone_type",
	"stone_depth_inches" numeric(6, 2),
	"stone_waste_factor" numeric(5, 2) DEFAULT '10',
	"calculated_stone_tons" numeric(10, 2),
	"requires_excavation" boolean DEFAULT false,
	"excavation_depth_inches" numeric(6, 2),
	"excavation_width_inches" numeric(8, 2),
	"excavation_swell_factor" numeric(5, 2) DEFAULT '25',
	"calculated_excavation_yards" numeric(10, 2),
	"requires_wire_mesh" boolean DEFAULT false,
	"wire_mesh_type" "wire_mesh_type",
	"wire_mesh_coverage_sf" numeric(8, 2) DEFAULT '150',
	"wire_mesh_waste_factor" numeric(5, 2) DEFAULT '10',
	"calculated_wire_mesh_rolls" numeric(10, 2),
	"requires_rebar" boolean DEFAULT false,
	"rebar_size" "rebar_size",
	"rebar_spacing_inches" numeric(6, 2) DEFAULT '12',
	"rebar_length_feet" numeric(6, 2) DEFAULT '20',
	"rebar_waste_factor" numeric(5, 2) DEFAULT '10',
	"calculated_rebar_count" numeric(10, 0),
	"calculated_rebar_linear_feet" numeric(12, 2),
	"requires_dowels" boolean DEFAULT false,
	"dowel_size" "dowel_size",
	"dowel_spacing_inches" numeric(6, 2) DEFAULT '12',
	"dowel_length_inches" numeric(6, 2) DEFAULT '18',
	"joint_length_feet" numeric(10, 2),
	"calculated_dowel_count" numeric(10, 0),
	"requires_sealer" boolean DEFAULT false,
	"sealer_type" "sealer_type",
	"sealer_coverage_sf_per_gallon" numeric(8, 2) DEFAULT '200',
	"sealer_coats" integer DEFAULT 1,
	"sealer_waste_factor" numeric(5, 2) DEFAULT '10',
	"calculated_sealer_gallons" numeric(10, 2),
	"requires_underlayment" boolean DEFAULT false,
	"underlayment_type" "underlayment_type",
	"underlayment_overlap_inches" numeric(6, 2) DEFAULT '6',
	"underlayment_waste_factor" numeric(5, 2) DEFAULT '10',
	"calculated_underlayment_sf" numeric(12, 2),
	"material_requirements_json" text,
	"equipment_requirements_json" text,
	"job_classification_id" varchar,
	"labor_rate_used" numeric(10, 2),
	"organization_sow_item_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "estimates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bid_id" varchar,
	"project_id" varchar,
	"version_number" integer DEFAULT 1 NOT NULL,
	"status" "estimate_status" DEFAULT 'DRAFT' NOT NULL,
	"base_bid_amount" numeric(12, 2),
	"alt_prices_json" text,
	"cost_breakdown_json" text,
	"notes" text,
	"created_by_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_permissions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" varchar NOT NULL,
	"file_type" "file_type" NOT NULL,
	"user_id" varchar NOT NULL,
	"granted_by_id" varchar NOT NULL,
	"granted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_matches" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" varchar NOT NULL,
	"po_id" varchar NOT NULL,
	"receipt_id" varchar,
	"match_status" "invoice_match_status" DEFAULT 'PENDING' NOT NULL,
	"po_amount" numeric(12, 2),
	"invoice_amount" numeric(12, 2),
	"received_qty_match_pct" numeric(5, 2),
	"discrepancy_notes" text,
	"resolved_by_id" varchar,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_payments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"invoice_id" varchar NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"payment_date" timestamp NOT NULL,
	"method" text,
	"reference_number" text,
	"notes" text,
	"recorded_by_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_classifications" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"description" text,
	"default_regular_rate" numeric(10, 2),
	"default_overtime_rate" numeric(10, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "job_classifications_organization_id_name_unique" UNIQUE("organization_id","name")
);
--> statement-breakpoint
CREATE TABLE "leave_requests" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" varchar NOT NULL,
	"organization_id" varchar NOT NULL,
	"leave_type_id" varchar NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"reason" text,
	"status" "leave_request_status" DEFAULT 'PENDING' NOT NULL,
	"reviewer_id" varchar,
	"reviewer_note" text,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_types" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"name" text NOT NULL,
	"annual_allowance" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"type" "media_type" NOT NULL,
	"file_name" text NOT NULL,
	"file_url" text NOT NULL,
	"object_key" text,
	"file_size" integer,
	"mime_type" text,
	"caption" text,
	"uploaded_by_id" varchar NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_channel_prefs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"email_enabled" boolean DEFAULT false NOT NULL,
	"sms_enabled" boolean DEFAULT false NOT NULL,
	"push_enabled" boolean DEFAULT false NOT NULL,
	"teams_enabled" boolean DEFAULT false NOT NULL,
	"slack_enabled" boolean DEFAULT false NOT NULL,
	"sms_phone_number" text,
	"teams_webhook_url" text,
	"slack_webhook_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notification_channel_prefs_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "notification_type_prefs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"notification_type" "notification_type" NOT NULL,
	"email_enabled" boolean DEFAULT false NOT NULL,
	"sms_enabled" boolean DEFAULT false NOT NULL,
	"push_enabled" boolean DEFAULT false NOT NULL,
	"teams_enabled" boolean DEFAULT false NOT NULL,
	"slack_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notification_type_prefs_user_id_notification_type_unique" UNIQUE("user_id","notification_type")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"type" "notification_type" NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"related_entity_id" varchar,
	"related_entity_type" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_cost_codes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "org_cost_codes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"organization_id" varchar NOT NULL,
	"code" varchar(20) NOT NULL,
	"description" varchar(255) NOT NULL,
	"division" varchar(100) NOT NULL,
	"is_custom" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deactivated_by_id" varchar,
	"deactivated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "org_cost_codes_org_code_uniq" UNIQUE("organization_id","code")
);
--> statement-breakpoint
CREATE TABLE "overtime_requests" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shift_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"organization_id" varchar NOT NULL,
	"requested_hours" numeric(6, 2) NOT NULL,
	"approved_hours" numeric(6, 2),
	"superintendent_id" varchar NOT NULL,
	"status" "overtime_request_status" DEFAULT 'PENDING' NOT NULL,
	"notes" text,
	"rejection_reason" text,
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_notifications" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"project_id" varchar,
	"approving_manager_id" varchar NOT NULL,
	"office_manager_id" varchar,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"total_shifts_approved" integer DEFAULT 0 NOT NULL,
	"total_time_entries_approved" integer DEFAULT 0 NOT NULL,
	"total_hours" numeric(10, 2),
	"sent_to_office_manager_at" timestamp,
	"processed_at" timestamp,
	"processed_by_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "photo_custody_records" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"project_id" varchar NOT NULL,
	"photo_url" text NOT NULL,
	"photo_file_name" text NOT NULL,
	"photo_object_key" text,
	"original_metadata_json" json,
	"action" "photo_custody_action" NOT NULL,
	"action_by_id" varchar NOT NULL,
	"action_at" timestamp DEFAULT now() NOT NULL,
	"action_notes" text,
	"ip_address" text,
	"user_agent" text,
	"linked_claim_id" varchar,
	"linked_delay_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_documents" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"type" "document_type" DEFAULT 'OTHER' NOT NULL,
	"title" text NOT NULL,
	"file_name" text NOT NULL,
	"file_url" text NOT NULL,
	"object_key" text,
	"file_size" integer,
	"mime_type" text,
	"uploaded_by_id" varchar NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "po_receipt_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" varchar NOT NULL,
	"po_item_id" varchar NOT NULL,
	"quantity_received" numeric(10, 2) NOT NULL,
	"condition" "po_receipt_item_condition" DEFAULT 'GOOD' NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "po_receipts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"po_id" varchar NOT NULL,
	"received_by_id" varchar NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"delivery_note" text,
	"status" "po_receipt_status" DEFAULT 'PARTIAL' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prevailing_wage_rates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"project_id" varchar NOT NULL,
	"classification_id" varchar NOT NULL,
	"wage_rate" numeric(10, 2) NOT NULL,
	"fringe_rate" numeric(10, 2) DEFAULT '0' NOT NULL,
	"total_rate" numeric(10, 2) NOT NULL,
	"overtime_multiplier" numeric(4, 2) DEFAULT '1.5' NOT NULL,
	"effective_date" date NOT NULL,
	"expiration_date" date,
	"wage_decision" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "prevailing_wage_rates_project_id_classification_id_unique" UNIQUE("project_id","classification_id")
);
--> statement-breakpoint
CREATE TABLE "procurement_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"description" text NOT NULL,
	"vendor" text,
	"quantity" numeric(10, 2),
	"unit" text,
	"unit_cost" numeric(10, 2),
	"status" "procurement_status" DEFAULT 'PLANNED' NOT NULL,
	"po_number" text,
	"needed_by_date" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_delays" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"delay_number" text NOT NULL,
	"reason" "delay_reason" NOT NULL,
	"reason_notes" text,
	"start_date_time" timestamp NOT NULL,
	"end_date_time" timestamp,
	"estimated_duration" integer,
	"owner_rep_contact_id" varchar,
	"gc_rep_contact_id" varchar,
	"owner_rep_name" text,
	"gc_rep_name" text,
	"proof_file_id" varchar,
	"proof_file_name" text,
	"proof_file_url" text,
	"financially_responsible" "delay_responsibility" NOT NULL,
	"change_order_required" boolean DEFAULT false NOT NULL,
	"linked_change_order_id" varchar,
	"proceed_to_work_date" timestamp,
	"proceed_to_work_notes" text,
	"proceed_to_work_file_url" text,
	"status" "delay_status" DEFAULT 'DRAFT' NOT NULL,
	"created_by_id" varchar NOT NULL,
	"submitted_at" timestamp,
	"acknowledged_by_id" varchar,
	"acknowledged_at" timestamp,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"weather_evidence_json" json,
	"location_lat" numeric(10, 6),
	"location_lng" numeric(10, 6)
);
--> statement-breakpoint
CREATE TABLE "project_employee_rates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"regular_rate" numeric(10, 2) NOT NULL,
	"overtime_rate" numeric(10, 2) NOT NULL,
	"classification_id" varchar,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_employee_rates_project_id_user_id_unique" UNIQUE("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "project_inspections" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"inspection_number" text NOT NULL,
	"inspection_type" "inspection_type" NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"request_method" "inspection_request_method",
	"requested_date" timestamp NOT NULL,
	"scheduled_date" timestamp,
	"completed_date" timestamp,
	"status" "inspection_status" DEFAULT 'REQUESTED' NOT NULL,
	"inspector_contact_id" varchar,
	"inspector_name" text,
	"inspector_company" text,
	"inspector_phone" text,
	"inspector_email" text,
	"gc_rep_contact_id" varchar,
	"gc_rep_name" text,
	"gc_rep_company" text,
	"gc_rep_phone" text,
	"gc_rep_email" text,
	"owner_rep_contact_id" varchar,
	"owner_rep_name" text,
	"owner_rep_company" text,
	"owner_rep_phone" text,
	"owner_rep_email" text,
	"result_notes" text,
	"punch_list_items" text,
	"reinspection_required" boolean DEFAULT false NOT NULL,
	"reinspection_date" timestamp,
	"request_pdf_url" text,
	"email_sent_at" timestamp,
	"email_recipients" text,
	"created_by_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_labor_rates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"default_regular_rate" numeric(10, 2) NOT NULL,
	"default_overtime_rate" numeric(10, 2) NOT NULL,
	"burden_multiplier" numeric(5, 4) DEFAULT '1.0000' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_labor_rates_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE "project_material_budgets" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"scope_item_id" varchar NOT NULL,
	"estimate_line_item_id" varchar,
	"description" text NOT NULL,
	"unit" text NOT NULL,
	"budgeted_quantity" numeric(12, 2) NOT NULL,
	"budgeted_unit_cost" numeric(10, 2) DEFAULT '0' NOT NULL,
	"budgeted_total_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"actual_quantity_used" numeric(12, 2) DEFAULT '0' NOT NULL,
	"actual_total_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"variance_quantity" numeric(12, 2) DEFAULT '0' NOT NULL,
	"variance_percent" numeric(6, 2) DEFAULT '0' NOT NULL,
	"alert_threshold_percent" numeric(5, 2) DEFAULT '90' NOT NULL,
	"alert_triggered" boolean DEFAULT false NOT NULL,
	"alert_triggered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_material_usage" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"scope_item_id" varchar NOT NULL,
	"material_budget_id" varchar,
	"daily_scope_progress_id" varchar,
	"usage_date" date NOT NULL,
	"description" text NOT NULL,
	"quantity_used" numeric(12, 2) NOT NULL,
	"unit" text NOT NULL,
	"unit_cost" numeric(10, 2) DEFAULT '0' NOT NULL,
	"total_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"vendor_name" text,
	"receipt_reference" text,
	"notes" text,
	"created_by_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_notes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"author_id" varchar NOT NULL,
	"note_type" "note_type" DEFAULT 'GENERAL' NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "punch_list_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"item_number" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"location" text,
	"trade" "punch_list_trade" DEFAULT 'GENERAL' NOT NULL,
	"priority" "punch_list_priority" DEFAULT 'MEDIUM' NOT NULL,
	"status" "punch_list_status" DEFAULT 'OPEN' NOT NULL,
	"assigned_to_user_id" varchar,
	"assigned_to_name" text,
	"assigned_to_email" text,
	"due_date" timestamp,
	"attachments" json DEFAULT '[]'::json,
	"status_history" json DEFAULT '[]'::json,
	"inspection_id" varchar,
	"resolved_at" timestamp,
	"verified_at" timestamp,
	"verified_by_id" varchar,
	"created_by_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_order_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"po_id" varchar NOT NULL,
	"pr_item_id" varchar,
	"description" text NOT NULL,
	"quantity" numeric(10, 2),
	"unit" text,
	"unit_cost" numeric(10, 2),
	"quantity_received" numeric(10, 2) DEFAULT '0',
	"cost_code" text
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"project_id" varchar NOT NULL,
	"pr_id" varchar,
	"vendor_id" varchar,
	"po_number" text NOT NULL,
	"status" "purchase_order_status" DEFAULT 'DRAFT' NOT NULL,
	"terms" text,
	"delivery_address" text,
	"needed_by_date" timestamp,
	"notes" text,
	"total_cost" numeric(12, 2),
	"rejection_notes" text,
	"approved_by_id" varchar,
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_po_number_unique" UNIQUE("po_number")
);
--> statement-breakpoint
CREATE TABLE "purchase_request_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pr_id" varchar NOT NULL,
	"description" text NOT NULL,
	"category" text,
	"quantity" numeric(10, 2),
	"unit" text,
	"estimated_unit_cost" numeric(10, 2),
	"cost_code" text
);
--> statement-breakpoint
CREATE TABLE "purchase_requests" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"project_id" varchar NOT NULL,
	"requested_by_id" varchar NOT NULL,
	"pr_number" text NOT NULL,
	"title" text NOT NULL,
	"status" "purchase_request_status" DEFAULT 'DRAFT' NOT NULL,
	"needed_by_date" timestamp,
	"notes" text,
	"total_estimated_cost" numeric(12, 2),
	"rejection_notes" text,
	"approved_by_id" varchar,
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_requests_pr_number_unique" UNIQUE("pr_number")
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_user_id_endpoint_unique" UNIQUE("user_id","endpoint")
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"date" timestamp NOT NULL,
	"vendor" text NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"category" text,
	"file_name" text NOT NULL,
	"file_url" text NOT NULL,
	"object_key" text,
	"file_size" integer,
	"mime_type" text,
	"notes" text,
	"cost_code" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scope_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"estimate_line_item_id" varchar,
	"organization_sow_item_id" varchar,
	"subcontractor_quote_id" varchar,
	"description" text NOT NULL,
	"unit" text NOT NULL,
	"total_quantity" numeric(12, 2) NOT NULL,
	"completed_quantity" numeric(12, 2) DEFAULT '0' NOT NULL,
	"billed_quantity" numeric(12, 2) DEFAULT '0' NOT NULL,
	"unit_price" numeric(10, 2),
	"billing_status" "billing_status" DEFAULT 'NOT_READY' NOT NULL,
	"last_billed_date" timestamp,
	"estimated_concrete_yards" numeric(10, 2),
	"estimated_stone_tons" numeric(10, 2),
	"estimated_excavation_yards" numeric(10, 2),
	"actual_concrete_yards" numeric(10, 2),
	"actual_stone_tons" numeric(10, 2),
	"actual_excavation_yards" numeric(10, 2),
	"material_responsibility" "material_responsibility" DEFAULT 'PENDING',
	"overage_action_status" "overage_action_status" DEFAULT 'NONE',
	"overage_notes" text,
	"overage_resolved_by_id" varchar,
	"overage_resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scope_items_estimate_line_item_unique" UNIQUE("estimate_line_item_id")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"project_id" varchar,
	"bid_id" varchar,
	"vendor_id" varchar,
	"email_thread_id" varchar,
	"email_message_id" varchar,
	"context" varchar,
	"hiring_candidate_id" varchar,
	"hiring_job_id" varchar,
	"title" text NOT NULL,
	"description" text,
	"category" "ai_note_insight_category" DEFAULT 'OTHER' NOT NULL,
	"priority" "ai_task_priority" DEFAULT 'MEDIUM' NOT NULL,
	"status" "ai_task_status" DEFAULT 'PENDING' NOT NULL,
	"source_type" "task_source_type" DEFAULT 'MANUAL' NOT NULL,
	"ai_metadata" text,
	"created_by_id" varchar NOT NULL,
	"assigned_to_id" varchar,
	"due_date" timestamp,
	"acknowledged_by_id" varchar,
	"acknowledged_at" timestamp,
	"completed_by_id" varchar,
	"completed_at" timestamp,
	"dismissed_by_id" varchar,
	"dismissed_at" timestamp,
	"dismiss_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_clock_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shift_id" varchar NOT NULL,
	"event_type" "clock_event_type" NOT NULL,
	"timestamp" timestamp NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"notes" text,
	"performed_by_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_clock_shifts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"project_id" varchar,
	"clock_in" timestamp NOT NULL,
	"clock_out" timestamp,
	"clock_in_latitude" double precision,
	"clock_in_longitude" double precision,
	"clock_out_latitude" double precision,
	"clock_out_longitude" double precision,
	"notes" text,
	"auto_clock_out" boolean DEFAULT false NOT NULL,
	"geofence_status" varchar(20),
	"approval_status" "shift_approval_status" DEFAULT 'PENDING' NOT NULL,
	"approved_by_id" varchar,
	"approved_at" timestamp,
	"total_hours" numeric(6, 2),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"project_id" varchar NOT NULL,
	"date" timestamp NOT NULL,
	"hours_regular" numeric(8, 2) DEFAULT '0' NOT NULL,
	"hours_overtime" numeric(8, 2) DEFAULT '0' NOT NULL,
	"cost_code" text,
	"notes" text,
	"approval_status" "shift_approval_status" DEFAULT 'PENDING' NOT NULL,
	"approved_by_id" varchar,
	"approved_at" timestamp,
	"rejected_by_id" varchar,
	"rejected_at" timestamp,
	"rejection_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tm_daily_sheets" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"date" timestamp NOT NULL,
	"tfr_rep_name" text NOT NULL,
	"client_rep_name" text,
	"weather" text,
	"description_of_work" text NOT NULL,
	"crew_size" integer,
	"labor_summary_json" text,
	"equipment_used_json" text,
	"materials_used_json" text,
	"attachments_json" text,
	"client_signature_name" text,
	"client_signature_date" timestamp,
	"created_by_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tm_invoices" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"project_id" varchar NOT NULL,
	"invoice_number" text NOT NULL,
	"invoice_date" date NOT NULL,
	"due_date" date,
	"client_name" text NOT NULL,
	"client_address" text,
	"client_email" text,
	"subtotal" numeric(12, 2) DEFAULT '0' NOT NULL,
	"tax_rate" numeric(5, 2) DEFAULT '0',
	"tax_amount" numeric(12, 2) DEFAULT '0',
	"total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"status" "tm_invoice_status" DEFAULT 'DRAFT' NOT NULL,
	"sent_at" timestamp,
	"paid_at" timestamp,
	"notes" text,
	"pdf_url" text,
	"pdf_object_key" text,
	"created_by_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tm_ticket_equipment_entries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" varchar NOT NULL,
	"equipment_type" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"hours_used" numeric(6, 2) NOT NULL,
	"hourly_rate" numeric(10, 2),
	"total_cost" numeric(12, 2),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tm_ticket_labor_entries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" varchar NOT NULL,
	"employee_name" text NOT NULL,
	"position" text NOT NULL,
	"crew_member_count" integer DEFAULT 1 NOT NULL,
	"hours_worked" numeric(6, 2) NOT NULL,
	"total_hours" numeric(8, 2) NOT NULL,
	"hourly_rate" numeric(10, 2),
	"total_cost" numeric(12, 2),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tm_ticket_material_entries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" varchar NOT NULL,
	"material_description" text NOT NULL,
	"quantity" numeric(12, 2) NOT NULL,
	"unit" text NOT NULL,
	"unit_cost" numeric(10, 2),
	"total_cost" numeric(12, 2),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tm_tickets" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"ticket_number" text NOT NULL,
	"work_date" date NOT NULL,
	"tfr_representative_id" varchar NOT NULL,
	"work_order_reference" text,
	"organization_sow_item_id" varchar,
	"work_type_id" varchar,
	"work_type_code" text,
	"work_type_name" text,
	"category_name" text,
	"scope_modifier_ids" text,
	"scope_modifier_names" text,
	"canonical_name" text,
	"scope_unit" text,
	"scope_quantity" numeric(12, 2),
	"scope_description" text NOT NULL,
	"notes" text,
	"status" "tm_ticket_status" DEFAULT 'DRAFT' NOT NULL,
	"total_labor_hours" numeric(10, 2) DEFAULT '0',
	"total_labor_cost" numeric(12, 2) DEFAULT '0',
	"total_equipment_cost" numeric(12, 2) DEFAULT '0',
	"total_material_cost" numeric(12, 2) DEFAULT '0',
	"grand_total" numeric(12, 2) DEFAULT '0',
	"submitted_at" timestamp,
	"submitted_by_id" varchar,
	"approved_at" timestamp,
	"approved_by_id" varchar,
	"rejected_at" timestamp,
	"rejected_by_id" varchar,
	"rejection_reason" text,
	"signed_document_url" text,
	"signed_document_file_name" text,
	"signed_document_object_key" text,
	"signed_document_uploaded_at" timestamp,
	"billing_status" "tm_billing_status" DEFAULT 'PENDING' NOT NULL,
	"billing_approved_at" timestamp,
	"billing_approved_by_id" varchar,
	"invoice_id" varchar,
	"billed_at" timestamp,
	"billing_notes" text,
	"cost_code" text,
	"created_by_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upload_intents" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"uploaded_by_id" varchar NOT NULL,
	"object_key" text NOT NULL,
	"content_type" text NOT NULL,
	"file_size" integer NOT NULL,
	"resumable_uri" text,
	"chunk_size" integer,
	"confirmed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_invoice_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" varchar NOT NULL,
	"po_item_id" varchar,
	"description" text NOT NULL,
	"quantity" numeric(12, 2),
	"unit_cost" numeric(12, 2),
	"amount" numeric(12, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_invoices" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"po_id" varchar NOT NULL,
	"vendor_id" varchar,
	"invoice_number" text NOT NULL,
	"invoice_date" timestamp NOT NULL,
	"due_date" timestamp,
	"total_amount" numeric(12, 2) NOT NULL,
	"status" "vendor_invoice_status" DEFAULT 'PENDING' NOT NULL,
	"notes" text,
	"file_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "warranty_cases" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"case_number" text NOT NULL,
	"type" "warranty_case_type" DEFAULT 'DEFECT' NOT NULL,
	"status" "warranty_case_status" DEFAULT 'OPEN' NOT NULL,
	"priority" "warranty_priority" DEFAULT 'MEDIUM' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"location" text,
	"reported_by_name" text,
	"reported_by_email" text,
	"reported_by_phone" text,
	"assigned_to_user_id" varchar,
	"assigned_to_name" text,
	"reported_date" timestamp,
	"target_resolution_date" timestamp,
	"resolved_at" timestamp,
	"closed_at" timestamp,
	"estimated_cost" numeric(12, 2),
	"actual_cost" numeric(12, 2),
	"root_cause" text,
	"resolution" text,
	"status_history" json DEFAULT '[]'::json,
	"created_by_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "warranty_documents" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" varchar NOT NULL,
	"project_id" varchar NOT NULL,
	"document_type" "warranty_document_type" DEFAULT 'OTHER' NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text,
	"file_size" integer,
	"uploaded_by_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "warranty_tasks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" varchar NOT NULL,
	"project_id" varchar NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "warranty_task_status" DEFAULT 'PENDING' NOT NULL,
	"assigned_to_user_id" varchar,
	"assigned_to_name" text,
	"due_date" timestamp,
	"completed_at" timestamp,
	"estimated_hours" numeric(5, 2),
	"actual_hours" numeric(5, 2),
	"notes" text,
	"created_by_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "active_sessions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"token_hash" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"device_info" text,
	"last_activity_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "addenda" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"project_id" varchar NOT NULL,
	"addendum_number" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"issued_date" timestamp,
	"issued_by_id" varchar,
	"related_document_id" varchar,
	"storage_key" text,
	"file_url" text,
	"file_name" text,
	"status" "addendum_status" DEFAULT 'DRAFT' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "addenda_project_num_unique" UNIQUE("project_id","addendum_number")
);
--> statement-breakpoint
CREATE TABLE "addendum_acknowledgments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"addendum_id" varchar NOT NULL,
	"recipient_type" "addendum_recipient_type" NOT NULL,
	"recipient_id" varchar,
	"recipient_name" text NOT NULL,
	"recipient_email" text,
	"sent_at" timestamp DEFAULT now(),
	"acknowledged_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_action_audit" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"actor_user_id" varchar,
	"action_type" text NOT NULL,
	"model" text,
	"tokens_in" integer,
	"tokens_out" integer,
	"cost_estimate" numeric(10, 6),
	"input_refs" json,
	"output_refs" json,
	"rationale" text,
	"approval_required" boolean DEFAULT false NOT NULL,
	"approval_status" text,
	"approved_by_user_id" varchar,
	"approved_at" timestamp,
	"duration_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_bid_document_analysis" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bid_id" varchar,
	"organization_id" varchar NOT NULL,
	"document_url" text NOT NULL,
	"document_name" text NOT NULL,
	"document_type" text,
	"status" "ai_bid_document_analysis_status" DEFAULT 'PENDING' NOT NULL,
	"project_name" text,
	"client_name" text,
	"bid_due_date" timestamp,
	"project_location" text,
	"project_scope" text,
	"scope_summary" text,
	"line_items" text,
	"requirements" text,
	"qualifications" text,
	"insurance_requirements" text,
	"bonding_requirements" text,
	"suggested_pricing_factors" text,
	"risk_factors" text,
	"raw_ai_response" text,
	"confidence_score" integer,
	"analyzed_by_id" varchar,
	"analyzed_at" timestamp,
	"error_message" text,
	"is_archived" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_co_drafts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"project_id" varchar NOT NULL,
	"trade_type" "trade_type",
	"linked_items_json" text,
	"draft_content_json" text NOT NULL,
	"pricing_json" text,
	"ai_confidence" integer,
	"ai_notes" text,
	"status" "ai_co_draft_status" DEFAULT 'DRAFT' NOT NULL,
	"converted_to_co_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" varchar
);
--> statement-breakpoint
CREATE TABLE "ai_contract_document_analysis" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar,
	"organization_id" varchar NOT NULL,
	"document_url" text NOT NULL,
	"document_name" text NOT NULL,
	"document_type" text,
	"status" "ai_contract_document_analysis_status" DEFAULT 'PENDING' NOT NULL,
	"contract_type" text,
	"contract_number" text,
	"contract_date" timestamp,
	"effective_date" timestamp,
	"completion_date" timestamp,
	"owner_name" text,
	"general_contractor_name" text,
	"subcontractor_name" text,
	"owner_address" text,
	"gc_address" text,
	"project_name" text,
	"project_location" text,
	"contract_value" numeric(14, 2),
	"retainage" numeric(5, 2),
	"payment_terms" text,
	"billing_schedule" text,
	"scope_of_work" text,
	"scope_summary" text,
	"scope_items" text,
	"exclusions" text,
	"start_date" timestamp,
	"duration" text,
	"milestones" text,
	"liquidated_damages" text,
	"insurance_requirements" text,
	"bonding_requirements" text,
	"warranty_terms" text,
	"change_order_process" text,
	"dispute_resolution" text,
	"termination_clauses" text,
	"indemnification_clauses" text,
	"key_terms" text,
	"risk_factors" text,
	"obligations" text,
	"raw_ai_response" text,
	"confidence_score" integer,
	"analyzed_by_id" varchar,
	"analyzed_at" timestamp,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_data_quality" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"overall_score" integer NOT NULL,
	"financial_data_score" integer NOT NULL,
	"labor_data_score" integer NOT NULL,
	"material_data_score" integer NOT NULL,
	"timeline_data_score" integer NOT NULL,
	"scope_data_score" integer NOT NULL,
	"missing_fields" text[],
	"recommendations" text[],
	"calculated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_gantt_recommendations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"insight_id" varchar,
	"recommendation_type" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"suggested_tasks" text,
	"suggested_dependencies" text,
	"estimated_days_improvement" integer,
	"estimated_cost_savings" numeric(12, 2),
	"is_applied" boolean DEFAULT false NOT NULL,
	"applied_by_id" varchar,
	"applied_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_insights" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar,
	"project_id" varchar,
	"module" "ai_insight_module" NOT NULL,
	"severity" "ai_insight_severity" DEFAULT 'INFO' NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"details" text,
	"recommendations" text[],
	"metrics" text,
	"affected_entities" text,
	"estimated_impact" text,
	"action_items" text,
	"is_acknowledged" boolean DEFAULT false NOT NULL,
	"acknowledged_by_id" varchar,
	"acknowledged_at" timestamp,
	"triggered_by_id" varchar,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_runs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_type" text DEFAULT 'daily' NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"triggered_by_id" varchar,
	"snapshot_data" text,
	"profitability_data" text,
	"ai_response" text,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "ai_settings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"daily_runs_enabled" boolean DEFAULT true NOT NULL,
	"daily_run_time" text DEFAULT '06:00' NOT NULL,
	"role_tasks_enabled" boolean DEFAULT true NOT NULL,
	"billing_alerts_enabled" boolean DEFAULT true NOT NULL,
	"profitability_warnings_enabled" boolean DEFAULT true NOT NULL,
	"crew_scheduling_enabled" boolean DEFAULT true NOT NULL,
	"bid_reminders_enabled" boolean DEFAULT true NOT NULL,
	"material_ordering_enabled" boolean DEFAULT true NOT NULL,
	"model_name" text DEFAULT 'gpt-4o' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_takeoff_analyses" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"project_id" varchar,
	"bid_id" varchar,
	"takeoff_sheet_id" varchar,
	"trade_type" "trade_type" NOT NULL,
	"status" "ai_takeoff_status" DEFAULT 'PENDING' NOT NULL,
	"analysis_mode" "ai_takeoff_mode" DEFAULT 'QUICK' NOT NULL,
	"file_key" text,
	"file_name" text,
	"detected_items_json" text,
	"metadata_json" text,
	"ai_notes" text,
	"error_message" text,
	"processing_time_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" varchar
);
--> statement-breakpoint
CREATE TABLE "ai_tasks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" varchar NOT NULL,
	"task_type" text NOT NULL,
	"role" "user_role" NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"priority" "ai_task_priority" DEFAULT 'MEDIUM' NOT NULL,
	"status" "ai_task_status" DEFAULT 'PENDING' NOT NULL,
	"due_date" timestamp,
	"project_id" varchar,
	"project_code" text,
	"metadata" text,
	"assigned_to_id" varchar,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_vendor_comparisons" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"insight_id" varchar,
	"material_category" text NOT NULL,
	"analysis_data" text NOT NULL,
	"recommended_vendor_id" varchar,
	"recommended_vendor_name" text,
	"potential_savings" numeric(12, 2),
	"price_confidence" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"entity_type" "approval_entity_type" NOT NULL,
	"entity_id" varchar NOT NULL,
	"requested_by_user_id" varchar NOT NULL,
	"status" "approval_status_v2" DEFAULT 'pending' NOT NULL,
	"approver_user_id" varchar,
	"approver_role" text,
	"notes" text,
	"decided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"organization_id" varchar,
	"date" text NOT NULL,
	"status" text NOT NULL,
	"notes" text,
	"recorded_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bid_document_distributions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"bid_id" varchar,
	"project_id" varchar,
	"crm_organisation_id" varchar NOT NULL,
	"contact_email" text NOT NULL,
	"contact_name" text NOT NULL,
	"document_type" text NOT NULL,
	"document_id" varchar,
	"document_title" text NOT NULL,
	"portal_token_id" varchar,
	"status" text DEFAULT 'sent' NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	"viewed_at" timestamp,
	"responded_at" timestamp,
	"response_notes" text,
	"attachments_json" text,
	"message_body" text,
	"sent_by_id" varchar,
	"sent_by_name" text
);
--> statement-breakpoint
CREATE TABLE "bid_equipment_selections" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bid_id" varchar NOT NULL,
	"source" "bid_equipment_source" NOT NULL,
	"equipment_id" varchar,
	"rental_catalog_id" varchar,
	"rental_vendor_id" varchar,
	"equipment_name" text NOT NULL,
	"equipment_type" text NOT NULL,
	"planned_hours" numeric(10, 1),
	"planned_days" integer,
	"start_date" timestamp,
	"end_date" timestamp,
	"hourly_rate" numeric(10, 2),
	"daily_rate" numeric(10, 2),
	"weekly_rate" numeric(10, 2),
	"estimated_cost" numeric(12, 2),
	"delivery_fee" numeric(10, 2),
	"notes" text,
	"created_by_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bid_modifier_selections" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bid_id" varchar NOT NULL,
	"estimate_line_item_id" varchar NOT NULL,
	"modifier_id" varchar NOT NULL,
	"selected_factor" double precision NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bid_request_clarifications" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bid_request_id" varchar NOT NULL,
	"asked_by_organization_id" varchar,
	"asked_by_user_id" varchar,
	"question" text NOT NULL,
	"question_asked_at" timestamp DEFAULT now() NOT NULL,
	"answer" text,
	"answered_by_user_id" varchar,
	"answered_at" timestamp,
	"is_public_to_all_invitees" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bim_extractions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bid_id" varchar,
	"project_id" varchar,
	"document_id" varchar,
	"document_name" text,
	"extracted_data" text NOT NULL,
	"mappings" text,
	"imported_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bim_storey_associations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bid_id" varchar,
	"project_id" varchar,
	"sheet_id" varchar NOT NULL,
	"bim_document_id" varchar NOT NULL,
	"storey_express_id" integer NOT NULL,
	"storey_name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_portal_access" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"project_id" varchar NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"access_type" text DEFAULT 'STAKEHOLDER' NOT NULL,
	"permissions_json" text,
	"access_token_hash" text,
	"token_expires_at" timestamp,
	"last_accessed_at" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" varchar
);
--> statement-breakpoint
CREATE TABLE "client_portal_activity" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"access_id" varchar NOT NULL,
	"project_id" varchar NOT NULL,
	"action" text NOT NULL,
	"details_json" text,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_participants" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	"last_read_at" timestamp,
	"is_admin" boolean DEFAULT false NOT NULL,
	CONSTRAINT "conversation_participants_unique" UNIQUE("conversation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar,
	"type" "conversation_type" NOT NULL,
	"name" text,
	"description" text,
	"is_company_channel" boolean DEFAULT false NOT NULL,
	"channel_slug" text,
	"topic" text,
	"project_id" varchar,
	"crew_id" varchar,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_by_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crew_marketplace" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"crew_id" varchar,
	"crew_name" text NOT NULL,
	"trade_type" "trade_type" NOT NULL,
	"crew_size" integer,
	"availability_status" "crew_availability_status" DEFAULT 'AVAILABLE' NOT NULL,
	"available_from" date,
	"available_to" date,
	"hourly_rate" numeric(10, 2),
	"daily_rate" numeric(10, 2),
	"base_location" text,
	"travel_radius" integer,
	"skills" text[],
	"certifications" text[],
	"equipment_owned" text[],
	"rating" numeric(3, 2),
	"completed_projects" integer DEFAULT 0,
	"contact_name" text,
	"contact_phone" text,
	"contact_email" text,
	"description" text,
	"is_public" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crew_members" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crew_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"role" text,
	"added_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crew_project_assignments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crew_id" varchar NOT NULL,
	"project_id" varchar NOT NULL,
	"start_date" timestamp,
	"end_date" timestamp,
	"assigned_by_id" varchar NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crews" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar,
	"name" text NOT NULL,
	"description" text,
	"lead_id" varchar,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_contacts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar,
	"organisation_id" varchar NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"title" text,
	"role" "crm_contact_role" DEFAULT 'OTHER' NOT NULL,
	"email" text,
	"phone" text,
	"mobile" text,
	"preferred_contact" "crm_preferred_contact" DEFAULT 'EMAIL',
	"preferred_contact_other" text,
	"notes" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_opportunities" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"name" text NOT NULL,
	"stage" "crm_pipeline_stage" DEFAULT 'LEAD' NOT NULL,
	"deal_value" numeric(14, 2),
	"probability" integer DEFAULT 10,
	"crm_organisation_id" varchar,
	"contact_id" varchar,
	"assigned_to_id" varchar,
	"project_type" text,
	"project_location" text,
	"expected_close_date" date,
	"source" text,
	"notes" text,
	"lost_reason" text,
	"created_by_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_opportunity_activities" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" varchar NOT NULL,
	"activity_type" "crm_activity_type" DEFAULT 'NOTE' NOT NULL,
	"description" text NOT NULL,
	"scheduled_at" timestamp,
	"completed_at" timestamp,
	"created_by_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_organisation_notes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar,
	"organisation_id" varchar NOT NULL,
	"contact_id" varchar,
	"note_type" "crm_note_type" DEFAULT 'GENERAL' NOT NULL,
	"content" text NOT NULL,
	"created_by_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_organisations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar,
	"type" "crm_organisation_type" NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"city" text,
	"state" text,
	"zip_code" text,
	"website" text,
	"specialties" text[],
	"insurance_carrier" text,
	"insurance_policy_number" text,
	"insurance_expiration" timestamp,
	"insurance_coverage_amount" numeric(12, 2),
	"wc_insurance_carrier" text,
	"wc_insurance_expiration" timestamp,
	"license_number" text,
	"license_expiration" timestamp,
	"tax_id" text,
	"payment_terms" text,
	"bonding_capacity" text,
	"trade_specialty" text,
	"material_categories" text[],
	"service_category" text,
	"contract_expiration" timestamp,
	"equipment_category" text,
	"rental_terms" text,
	"company_represented" text,
	"active_project_ids" text[],
	"notes" text,
	"crm_status" "crm_org_status" DEFAULT 'ACTIVE' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp,
	"legacy_subcontractor_id" varchar,
	"created_by_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_libraries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_processing_records" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"purpose" text NOT NULL,
	"legal_basis" text NOT NULL,
	"data_categories" json,
	"recipients" json,
	"retention_period" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_subject_requests" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"request_type" "data_subject_request_type" NOT NULL,
	"subject_email" text NOT NULL,
	"subject_name" text,
	"status" "data_subject_request_status" DEFAULT 'PENDING' NOT NULL,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"completed_by" varchar,
	"notes" text,
	"export_file_key" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_revisions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"document_id" varchar NOT NULL,
	"revision_number" integer NOT NULL,
	"source_type" "document_revision_source" DEFAULT 'upload' NOT NULL,
	"supersedes_revision_id" varchar,
	"status" "document_revision_status" DEFAULT 'active' NOT NULL,
	"storage_key" text,
	"checksum" text,
	"metadata" json,
	"created_by_user_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "document_revisions_doc_rev" UNIQUE("document_id","revision_number")
);
--> statement-breakpoint
CREATE TABLE "document_transmittals" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"project_id" varchar NOT NULL,
	"transmittal_number" text NOT NULL,
	"subject" text NOT NULL,
	"description" text,
	"status" "transmittal_status" DEFAULT 'DRAFT' NOT NULL,
	"sent_by_id" varchar NOT NULL,
	"sent_by_name" text,
	"date_sent" timestamp,
	"document_type" text,
	"revision_number" text,
	"previous_transmittal_id" varchar,
	"attachments_json" text,
	"recipient_subcontractor_ids" text[],
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_accounts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"provider" "email_provider" NOT NULL,
	"email_address" text NOT NULL,
	"display_name" text,
	"oauth_provider_id" text,
	"access_token" text,
	"refresh_token" text,
	"expires_at" timestamp,
	"imap_host" text,
	"imap_port" integer,
	"imap_secure" boolean,
	"smtp_host" text,
	"smtp_port" integer,
	"smtp_secure" boolean,
	"imap_username" text,
	"imap_password" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp,
	"last_sync_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_attachments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"email_message_id" varchar NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_messages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"email_account_id" varchar NOT NULL,
	"thread_id" varchar NOT NULL,
	"external_id" text NOT NULL,
	"from_address" text NOT NULL,
	"from_name" text,
	"to_addresses" text,
	"cc_addresses" text,
	"bcc_addresses" text,
	"subject" text NOT NULL,
	"body_text" text,
	"body_html" text,
	"snippet" text,
	"received_at" timestamp NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"is_incoming" boolean DEFAULT true NOT NULL,
	"has_attachments" boolean DEFAULT false NOT NULL,
	"classification" "email_classification",
	"ai_metadata" text,
	"ai_analyzed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_summaries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"summary_type" text NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"summary_content" text NOT NULL,
	"highlights_json" text,
	"email_count" integer DEFAULT 0 NOT NULL,
	"tasks_created" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_tasks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"created_by_user_id" varchar NOT NULL,
	"assigned_to_user_id" varchar,
	"project_id" varchar,
	"bid_id" varchar,
	"vendor_id" varchar,
	"email_thread_id" varchar,
	"email_message_id" varchar,
	"title" text NOT NULL,
	"description" text,
	"status" "ai_task_status" DEFAULT 'PENDING' NOT NULL,
	"priority" "ai_task_priority" DEFAULT 'MEDIUM' NOT NULL,
	"due_date" timestamp,
	"source_type" "email_task_source" DEFAULT 'EMAIL' NOT NULL,
	"ai_metadata" text,
	"completed_at" timestamp,
	"completed_by_user_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_threads" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"email_account_id" varchar NOT NULL,
	"subject" text NOT NULL,
	"external_thread_id" text,
	"project_id" varchar,
	"bid_id" varchar,
	"vendor_id" varchar,
	"status" "email_thread_status" DEFAULT 'OPEN' NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"last_message_at" timestamp DEFAULT now() NOT NULL,
	"ai_summary" text,
	"primary_classification" "email_classification",
	"ai_metadata" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_performance_profiles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"organization_id" varchar,
	"experience_level" text,
	"productivity_tendencies" text,
	"past_projects" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_ratings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"employee_id" varchar NOT NULL,
	"evaluator_id" varchar NOT NULL,
	"project_id" varchar,
	"period" text,
	"overall_score" numeric(5, 2),
	"weighted_score" numeric(5, 2),
	"comments" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar,
	"name" text NOT NULL,
	"equipment_code" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'AVAILABLE' NOT NULL,
	"make" text,
	"model" text,
	"year" integer,
	"serial_number" text,
	"vin_number" text,
	"license_plate" text,
	"current_hours" numeric(10, 1) DEFAULT '0',
	"purchase_date" timestamp,
	"purchase_price" numeric(12, 2),
	"warranty_expiration_date" date,
	"assigned_to_crew_id" varchar,
	"assigned_to_project_id" varchar,
	"last_maintenance_date" timestamp,
	"next_maintenance_date" timestamp,
	"description" text,
	"specifications" text,
	"notes" text,
	"home_location" text,
	"current_location" text,
	"image_url" text,
	"manual_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "equipment_equipment_code_unique" UNIQUE("equipment_code")
);
--> statement-breakpoint
CREATE TABLE "equipment_assignments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"equipment_id" varchar NOT NULL,
	"project_id" varchar NOT NULL,
	"assigned_by_id" varchar NOT NULL,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	"expected_return_date" date,
	"returned_at" timestamp,
	"returned_by_id" varchar,
	"return_condition" text,
	"hours_at_assignment" numeric(10, 1),
	"hours_at_return" numeric(10, 1),
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment_hour_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"equipment_id" varchar NOT NULL,
	"assignment_id" varchar,
	"project_id" varchar NOT NULL,
	"week_start_date" date NOT NULL,
	"week_end_date" date NOT NULL,
	"starting_hours" numeric(10, 1) NOT NULL,
	"ending_hours" numeric(10, 1) NOT NULL,
	"hours_used" numeric(10, 1) NOT NULL,
	"submitted_by_id" varchar NOT NULL,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"notes" text,
	"fuel_used" numeric(10, 2),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "equipment_hour_logs_unique_week" UNIQUE("equipment_id","week_start_date")
);
--> statement-breakpoint
CREATE TABLE "equipment_hour_reminders" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"equipment_id" varchar NOT NULL,
	"assignment_id" varchar NOT NULL,
	"project_id" varchar NOT NULL,
	"manager_id" varchar NOT NULL,
	"week_start_date" date NOT NULL,
	"reminder_sent_at" timestamp,
	"is_completed" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment_listings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"name" text NOT NULL,
	"category" "equipment_category" NOT NULL,
	"make_model" text,
	"year" integer,
	"daily_rate" numeric(10, 2),
	"weekly_rate" numeric(10, 2),
	"monthly_rate" numeric(10, 2),
	"deposit_amount" numeric(10, 2),
	"location" text,
	"delivery_radius" integer,
	"photos" text[],
	"condition" "equipment_condition",
	"available_from" date,
	"available_to" date,
	"is_ongoing" boolean DEFAULT false NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment_maintenance_history" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"equipment_id" varchar NOT NULL,
	"schedule_id" varchar,
	"maintenance_type" "maintenance_type" NOT NULL,
	"description" text NOT NULL,
	"performed_at" timestamp NOT NULL,
	"hours_at_maintenance" numeric(10, 1),
	"performed_by_id" varchar,
	"performed_by_vendor" text,
	"labor_cost" numeric(12, 2),
	"parts_cost" numeric(12, 2),
	"total_cost" numeric(12, 2),
	"notes" text,
	"parts_used" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment_maintenance_schedules" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"equipment_id" varchar NOT NULL,
	"maintenance_type" "maintenance_type" NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"interval_hours" integer,
	"interval_days" integer,
	"last_performed_at" timestamp,
	"last_performed_hours" numeric(10, 1),
	"next_due_at" timestamp,
	"next_due_hours" numeric(10, 1),
	"alert_days_before" integer DEFAULT 7,
	"alert_hours_before" integer DEFAULT 25,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment_rate_profiles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"equipment_id" varchar NOT NULL,
	"hourly_rate" numeric(10, 2) NOT NULL,
	"daily_rate" numeric(10, 2),
	"weekly_rate" numeric(10, 2),
	"monthly_rate" numeric(10, 2),
	"fuel_cost_per_hour" numeric(10, 2),
	"maintenance_cost_per_hour" numeric(10, 2),
	"operator_cost_per_hour" numeric(10, 2),
	"includes_operator" boolean DEFAULT false NOT NULL,
	"effective_date" timestamp DEFAULT now() NOT NULL,
	"expiration_date" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_by_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment_rental_requests" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" varchar NOT NULL,
	"requester_org_id" varchar NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"delivery_requested" boolean DEFAULT false NOT NULL,
	"message" text,
	"status" "rental_request_status" DEFAULT 'PENDING' NOT NULL,
	"owner_response" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment_repairs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"equipment_id" varchar NOT NULL,
	"repair_number" text NOT NULL,
	"description" text NOT NULL,
	"status" "repair_status" DEFAULT 'PENDING' NOT NULL,
	"problem_reported_at" timestamp DEFAULT now() NOT NULL,
	"problem_reported_by_id" varchar NOT NULL,
	"problem_description" text,
	"hours_at_report" numeric(10, 1),
	"repair_location" text,
	"repair_vendor_id" varchar,
	"estimated_cost" numeric(12, 2),
	"actual_cost" numeric(12, 2),
	"labor_cost" numeric(12, 2),
	"parts_cost" numeric(12, 2),
	"estimated_completion_date" date,
	"started_at" timestamp,
	"completed_at" timestamp,
	"completed_by_id" varchar,
	"repair_notes" text,
	"parts_used" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "estimate_crews" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"members" text DEFAULT '[]' NOT NULL,
	"blended_rate_per_hour" numeric(10, 2) NOT NULL,
	"production_rate_mapping" text DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "estimate_history" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"estimate_id" varchar,
	"data" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "estimate_settings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"default_material_prices" text DEFAULT '{}' NOT NULL,
	"default_labor_rates" text DEFAULT '{}' NOT NULL,
	"default_equipment_rates" text DEFAULT '{}' NOT NULL,
	"default_production_rates" text DEFAULT '{}' NOT NULL,
	"default_overhead_percent" double precision DEFAULT 15 NOT NULL,
	"default_profit_margin_percent" double precision DEFAULT 20 NOT NULL,
	"default_markups" text DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "estimate_vendor_quotes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"estimate_id" varchar NOT NULL,
	"vendor_name" text NOT NULL,
	"contact_info" text,
	"scope_description" text NOT NULL,
	"quote_amount" numeric(12, 2) NOT NULL,
	"file_url" text,
	"file_name" text,
	"file_size" integer,
	"mime_type" text,
	"linked_line_item_ids" text DEFAULT '[]' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "estimate_versions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"estimate_id" varchar NOT NULL,
	"version_number" integer NOT NULL,
	"snapshot" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "handoff_packets" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bid_id" varchar,
	"project_id" varchar,
	"gc_name" text,
	"gc_contact_name" text,
	"gc_phone" text,
	"gc_email" text,
	"access_details" text,
	"scope_of_work_summary" text,
	"contract_value" numeric(12, 2),
	"bid_date" date,
	"award_date" date,
	"markup_percent" numeric(5, 2),
	"duration" text,
	"project_start_date" date,
	"project_completion_date" date,
	"manpower" text,
	"alternates" text,
	"subcontract_executed" boolean,
	"insurance_certs" text,
	"bond_required" boolean,
	"permits" text,
	"retention_percent" numeric(5, 2),
	"payment_terms" text,
	"schedule_of_values_ready" boolean,
	"draw_schedule" text,
	"prevailing_wage" boolean,
	"concrete_supplier" text,
	"mix_info" text,
	"rebar_vendor" text,
	"forming_material_plan" text,
	"curing_specs" text,
	"special_items" text,
	"lead_time_risks" text,
	"submittal_status" text,
	"layout_survey_by" text,
	"benchmark_info" text,
	"access_zones" text,
	"work_hours" text,
	"safety_orientation" text,
	"inspection_needs" text,
	"coordination_issues" text,
	"weather_risks" text,
	"soil_conditions" text,
	"estimator_notes" text,
	"gc_contact_method" text,
	"project_manager" text,
	"superintendent" text,
	"office_admin" text,
	"safety_contact" text,
	"created_by_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hiring_activity_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"actor_user_id" varchar,
	"actor_name" text,
	"activity_type" "hiring_activity_type" NOT NULL,
	"entity_type" text,
	"entity_id" varchar,
	"entity_label" text,
	"metadata_json" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hiring_ai_reviews" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"candidate_id" varchar NOT NULL,
	"model_name" text NOT NULL,
	"score" integer,
	"summary" text,
	"strengths_json" text,
	"concerns_json" text,
	"extracted_skills_json" text,
	"extracted_certs_json" text,
	"extracted_equipment_json" text,
	"trade_fit_score" integer,
	"role_fit_score" integer,
	"red_flags_json" text,
	"recommendation" text,
	"interview_recommendation" text,
	"confidence_score" integer,
	"prompt_version" text,
	"generated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hiring_candidate_documents" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"candidate_id" varchar NOT NULL,
	"file_name" text NOT NULL,
	"file_size" integer,
	"mime_type" text,
	"storage_key" text NOT NULL,
	"uploaded_by_user_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hiring_candidate_notes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"candidate_id" varchar NOT NULL,
	"author_user_id" varchar,
	"author_name" text NOT NULL,
	"body" text NOT NULL,
	"is_internal" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hiring_candidate_stage_history" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"candidate_id" varchar NOT NULL,
	"from_stage" text,
	"to_stage" text NOT NULL,
	"changed_by_user_id" varchar,
	"changed_by_name" text,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hiring_candidates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"job_id" varchar,
	"external_provider" "ats_provider",
	"external_candidate_id" text,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"full_name" text NOT NULL,
	"email" text,
	"phone" text,
	"city" text,
	"state" text,
	"source" text,
	"current_stage" text DEFAULT 'APPLIED' NOT NULL,
	"applied_at" timestamp DEFAULT now() NOT NULL,
	"reviewer_user_id" varchar,
	"ai_score" integer,
	"ai_recommendation" text,
	"status" text DEFAULT 'active' NOT NULL,
	"raw_payload_json" text,
	"resume_storage_key" text,
	"application_answers_json" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hiring_integrations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"provider_name" "ats_provider" NOT NULL,
	"encrypted_credentials_json" text,
	"status" text DEFAULT 'disconnected' NOT NULL,
	"last_sync_at" timestamp,
	"last_test_at" timestamp,
	"default_config_json" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hiring_interviews" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"candidate_id" varchar NOT NULL,
	"job_id" varchar,
	"interview_type" text DEFAULT 'PHONE_SCREEN' NOT NULL,
	"start_at" timestamp,
	"end_at" timestamp,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"location" text,
	"video_link" text,
	"interviewer_user_ids_json" text,
	"status" "hiring_interview_status" DEFAULT 'SCHEDULED' NOT NULL,
	"notes" text,
	"reminder_sent_at" timestamp,
	"created_by_user_id" varchar,
	"updated_by_user_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hiring_job_templates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"title" text NOT NULL,
	"trade" text,
	"employment_type" "hiring_employment_type",
	"description" text,
	"requirements" text,
	"certifications_required" text,
	"screening_questions_json" text,
	"is_global" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hiring_jobs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"external_provider" "ats_provider",
	"external_job_id" text,
	"title" text NOT NULL,
	"department" text,
	"trade" text,
	"employment_type" "hiring_employment_type",
	"location" text,
	"compensation_type" "hiring_compensation_type",
	"compensation_min" numeric(12, 2),
	"compensation_max" numeric(12, 2),
	"description" text,
	"requirements" text,
	"preferred_qualifications" text,
	"certifications_required" text,
	"screening_questions_json" text,
	"posting_destinations_json" text,
	"internal_notes" text,
	"status" "hiring_job_status" DEFAULT 'DRAFT' NOT NULL,
	"assigned_owner_user_id" varchar,
	"created_by_user_id" varchar,
	"updated_by_user_id" varchar,
	"published_at" timestamp,
	"archived_at" timestamp,
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hiring_pipeline_configs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"stages_json" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hiring_pipeline_stages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"name" text NOT NULL,
	"key" text NOT NULL,
	"color" text DEFAULT '#6b7280' NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_terminal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hiring_sync_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"integration_id" varchar,
	"provider" "ats_provider",
	"status" "hiring_sync_status" DEFAULT 'PENDING' NOT NULL,
	"entity_type" text,
	"records_processed" integer DEFAULT 0 NOT NULL,
	"records_failed" integer DEFAULT 0 NOT NULL,
	"error_summary" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "hiring_tasks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"candidate_id" varchar,
	"job_id" varchar,
	"title" text NOT NULL,
	"description" text,
	"assigned_user_id" varchar,
	"due_date" timestamp,
	"completed_at" timestamp,
	"status" text DEFAULT 'open' NOT NULL,
	"created_by_user_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hustler_delegates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hustler_user_id" varchar NOT NULL,
	"delegate_user_id" varchar,
	"delegate_email" text,
	"delegate_role" "hustler_delegate_role" DEFAULT 'COO' NOT NULL,
	"invite_token" text,
	"invite_token_hash" text,
	"status" "hustler_link_request_status" DEFAULT 'PENDING' NOT NULL,
	"can_create_organizations" boolean DEFAULT true NOT NULL,
	"can_manage_all_organizations" boolean DEFAULT true NOT NULL,
	"can_view_financials" boolean DEFAULT true NOT NULL,
	"can_invite_other_delegates" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp,
	"accepted_at" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "hustler_delegate_unique" UNIQUE("hustler_user_id","delegate_user_id")
);
--> statement-breakpoint
CREATE TABLE "hustler_link_requests" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hustler_user_id" varchar,
	"hustler_email" text,
	"organization_id" varchar NOT NULL,
	"initiated_by_user_id" varchar NOT NULL,
	"request_type" text DEFAULT 'INVITE' NOT NULL,
	"status" "hustler_link_request_status" DEFAULT 'PENDING' NOT NULL,
	"invite_token" text,
	"invite_token_hash" text,
	"role_override" "user_role",
	"message" text,
	"expires_at" timestamp,
	"responded_at" timestamp,
	"responded_by_user_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hustler_organizations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"organization_id" varchar NOT NULL,
	"role_override" "user_role",
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "hustler_org_user_org_unique" UNIQUE("user_id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "integration_connections" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"provider" "integration_provider" NOT NULL,
	"status" "integration_connection_status" DEFAULT 'pending' NOT NULL,
	"display_name" text,
	"metadata" json,
	"last_sync_at" timestamp,
	"last_sync_error" text,
	"created_by_user_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_events_outbox" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"connection_id" varchar NOT NULL,
	"event_type" text NOT NULL,
	"payload" json NOT NULL,
	"status" "integration_event_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp,
	"last_error" text,
	"idempotency_key" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "integration_events_idempotency" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "integration_sync_state" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"connection_id" varchar NOT NULL,
	"entity_type" text NOT NULL,
	"cursor" text,
	"last_sync_at" timestamp,
	"metadata" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "integration_sync_connection_entity" UNIQUE("connection_id","entity_type")
);
--> statement-breakpoint
CREATE TABLE "integration_webhook_subscriptions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"connection_id" varchar NOT NULL,
	"event_type" text NOT NULL,
	"target_url" text NOT NULL,
	"secret" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_captures" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"project_id" varchar,
	"created_by_id" varchar NOT NULL,
	"assigned_to_id" varchar,
	"title" text NOT NULL,
	"description" text,
	"severity" "issue_severity" DEFAULT 'MEDIUM' NOT NULL,
	"status" "issue_status" DEFAULT 'OPEN' NOT NULL,
	"photo_urls" text[],
	"photo_object_keys" text[],
	"location" text,
	"latitude" double precision,
	"longitude" double precision,
	"trade_affected" text,
	"category" text,
	"resolution_notes" text,
	"resolved_by_id" varchar,
	"resolved_at" timestamp,
	"ai_analysis" text,
	"ai_recommendations" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobsite_analysis_batches" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"project_id" varchar NOT NULL,
	"analysis_date" date NOT NULL,
	"trade_type" "trade_type",
	"status" "jobsite_analysis_status" DEFAULT 'PENDING' NOT NULL,
	"analysis_types" text[] DEFAULT '{SAFETY,PROGRESS}',
	"summary_json" text,
	"safety_findings_json" text,
	"progress_findings_json" text,
	"material_findings_json" text,
	"crew_findings_json" text,
	"ai_notes" text,
	"error_message" text,
	"processing_time_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" varchar
);
--> statement-breakpoint
CREATE TABLE "jobsite_analysis_photos" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" varchar NOT NULL,
	"file_key" text NOT NULL,
	"file_url" text NOT NULL,
	"thumbnail_url" text,
	"original_filename" text,
	"captured_at" timestamp,
	"gps_latitude" numeric(10, 8),
	"gps_longitude" numeric(11, 8),
	"ai_annotations_json" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kpi_assignments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"kpi_template_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"target_value" numeric(12, 2) NOT NULL,
	"period_type" text DEFAULT 'monthly' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"assigned_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kpi_entries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"kpi_assignment_id" varchar NOT NULL,
	"actual_value" numeric(12, 2) NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"notes" text,
	"source" varchar(10) DEFAULT 'manual' NOT NULL,
	"recorded_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kpi_templates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text DEFAULT 'Custom' NOT NULL,
	"unit" text DEFAULT 'count' NOT NULL,
	"direction" text DEFAULT 'higher_is_better' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "library_assemblies" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"name" varchar(120) NOT NULL,
	"assembly_number" varchar(50),
	"unit_of_measure" varchar(20) NOT NULL,
	"description" varchar(255),
	"library_id" varchar,
	"source_id" varchar,
	"is_prebuilt" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "library_assembly_item_group_members" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" varchar NOT NULL,
	"item_id" varchar,
	"name" text NOT NULL,
	"formula" text DEFAULT '1' NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "library_assembly_item_groups" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assembly_id" varchar NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text,
	"display_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "library_assembly_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assembly_id" varchar NOT NULL,
	"item_id" varchar,
	"name" text NOT NULL,
	"formula" text DEFAULT '1' NOT NULL,
	"waste_factor" double precision DEFAULT 0 NOT NULL,
	"unit_cost" numeric(10, 2),
	"unit" varchar(20),
	"display_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "library_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"name" varchar(120) NOT NULL,
	"item_number" varchar(50),
	"measured_coverage" double precision DEFAULT 1 NOT NULL,
	"unit_of_measure" varchar(20) NOT NULL,
	"purchase_coverage" double precision DEFAULT 1 NOT NULL,
	"purchase_unit" varchar(50) NOT NULL,
	"description" varchar(255),
	"cost_types" text[] DEFAULT ARRAY['material']::text[] NOT NULL,
	"accounting_codes" json,
	"unit_costs" json,
	"notes" text,
	"library_id" varchar,
	"source_id" varchar,
	"is_prebuilt" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lien_waivers" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"project_id" varchar NOT NULL,
	"sov_id" varchar,
	"waiver_type" "lien_waiver_type" NOT NULL,
	"status" "lien_waiver_status" DEFAULT 'PENDING' NOT NULL,
	"recipient_name" text NOT NULL,
	"recipient_company" text,
	"through_date" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"notes" text,
	"document_url" text,
	"sent_at" timestamp,
	"received_at" timestamp,
	"approved_by_id" varchar,
	"approved_at" timestamp,
	"created_by_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketplace_reviews" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reviewer_org_id" varchar NOT NULL,
	"reviewee_org_id" varchar NOT NULL,
	"rating" integer NOT NULL,
	"comment" text,
	"project_ref" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "marketplace_reviews_unique_pair" UNIQUE("reviewer_org_id","reviewee_org_id")
);
--> statement-breakpoint
CREATE TABLE "master_calculators" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_type" "trade_type" NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"description" text,
	"output_uom_code" text NOT NULL,
	"formula_json" text NOT NULL,
	"input_fields_json" text NOT NULL,
	"default_values_json" text,
	"help_text" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "master_inspection_forms" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_type" "trade_type" NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"description" text,
	"form_fields_json" text NOT NULL,
	"requires_photos" boolean DEFAULT false NOT NULL,
	"requires_signature" boolean DEFAULT false NOT NULL,
	"regulatory_reference" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "master_modifier_categories" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_type" "trade_type" NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "master_mod_cat_name_trade_unique" UNIQUE("trade_type","name")
);
--> statement-breakpoint
CREATE TABLE "master_modifiers" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_type" "trade_type" NOT NULL,
	"category_id" varchar NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "master_mod_code_trade_unique" UNIQUE("trade_type","code")
);
--> statement-breakpoint
CREATE TABLE "master_sow_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_type" "trade_type" NOT NULL,
	"csi_code" text,
	"category_name" text NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"default_uom_code" text,
	"requires_dimensions" boolean DEFAULT false NOT NULL,
	"dimension_label" text,
	"labor_rate_multiplier" numeric(6, 2),
	"material_waste_factor" numeric(5, 2),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "master_sow_code_trade_unique" UNIQUE("trade_type","code")
);
--> statement-breakpoint
CREATE TABLE "material_calculator_presets" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"name" text NOT NULL,
	"work_type_code" text,
	"unit" text NOT NULL,
	"concrete_depth_inches" numeric(6, 2),
	"dimension_width_inches" numeric(6, 2),
	"dimension_height_inches" numeric(6, 2),
	"concrete_waste_factor" numeric(5, 2) DEFAULT '10',
	"requires_stone_base" boolean DEFAULT false,
	"stone_type" text,
	"stone_size" text,
	"stone_depth_inches" numeric(6, 2),
	"stone_waste_factor" numeric(5, 2) DEFAULT '10',
	"requires_excavation" boolean DEFAULT false,
	"excavation_depth_inches" numeric(6, 2),
	"excavation_width_inches" numeric(6, 2),
	"excavation_swell_factor" numeric(5, 2) DEFAULT '25',
	"requires_wire_mesh" boolean DEFAULT false,
	"wire_mesh_type" text,
	"wire_mesh_waste_factor" numeric(5, 2) DEFAULT '10',
	"requires_rebar" boolean DEFAULT false,
	"rebar_size" text,
	"rebar_fab_type" text,
	"rebar_spacing_inches" numeric(6, 2),
	"rebar_waste_factor" numeric(5, 2) DEFAULT '10',
	"requires_sealer" boolean DEFAULT false,
	"sealer_type" text,
	"sealer_coats" integer DEFAULT 1,
	"sealer_waste_factor" numeric(5, 2) DEFAULT '10',
	"requires_underlayment" boolean DEFAULT false,
	"underlayment_type" text,
	"underlayment_overlap_inches" numeric(6, 2),
	"underlayment_waste_factor" numeric(5, 2) DEFAULT '10',
	"is_default" boolean DEFAULT false,
	"created_by_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_price_index" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"material_name" text NOT NULL,
	"material_category" text,
	"material_sku" text,
	"unit_of_measure" text NOT NULL,
	"price_per_unit" numeric(12, 4) NOT NULL,
	"effective_date" date NOT NULL,
	"expiration_date" date,
	"source_vendor_id" varchar,
	"region" text,
	"notes" text,
	"created_by_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_reactions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"emoji" varchar(20) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "message_reactions_unique" UNIQUE("message_id","user_id","emoji")
);
--> statement-breakpoint
CREATE TABLE "message_read_receipts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"read_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "message_read_receipts_unique" UNIQUE("message_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" varchar NOT NULL,
	"sender_id" varchar NOT NULL,
	"content" text NOT NULL,
	"attachment_url" text,
	"attachment_name" text,
	"attachment_type" text,
	"attachment_size" integer,
	"voice_url" text,
	"voice_duration_seconds" integer,
	"mentioned_task_ids" text[],
	"is_edited" boolean DEFAULT false NOT NULL,
	"edited_at" timestamp,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mobile_devices" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"device_id" text NOT NULL,
	"platform" "mobile_platform" NOT NULL,
	"app_version" text,
	"device_model" text,
	"push_token" text,
	"last_sync_at" timestamp,
	"sync_token" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mobile_devices_device_id_unique" UNIQUE("device_id")
);
--> statement-breakpoint
CREATE TABLE "mobile_pending_uploads" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" varchar NOT NULL,
	"local_id" text NOT NULL,
	"record_type" text NOT NULL,
	"record_data_json" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "mobile_sync_log" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" varchar NOT NULL,
	"sync_type" text NOT NULL,
	"sync_started_at" timestamp NOT NULL,
	"sync_completed_at" timestamp,
	"records_downloaded" integer DEFAULT 0 NOT NULL,
	"records_uploaded" integer DEFAULT 0 NOT NULL,
	"conflicts" integer DEFAULT 0 NOT NULL,
	"status" "sync_status" DEFAULT 'IN_PROGRESS' NOT NULL,
	"error_message" text,
	"metadata_json" text
);
--> statement-breakpoint
CREATE TABLE "modifiers" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"layer" text NOT NULL,
	"trade_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"scope_patterns" text[] DEFAULT '{}'::text[] NOT NULL,
	"uoms" text[] DEFAULT '{}'::text[] NOT NULL,
	"material_families" text[] DEFAULT '{}'::text[] NOT NULL,
	"labor_factor_min" double precision DEFAULT 1 NOT NULL,
	"labor_factor_max" double precision DEFAULT 1 NOT NULL,
	"material_factor_min" double precision DEFAULT 1 NOT NULL,
	"material_factor_max" double precision DEFAULT 1 NOT NULL,
	"duration_factor_min" double precision DEFAULT 1 NOT NULL,
	"duration_factor_max" double precision DEFAULT 1 NOT NULL,
	"waste_factor_min" double precision DEFAULT 0 NOT NULL,
	"waste_factor_max" double precision DEFAULT 0 NOT NULL,
	"effect_type" text DEFAULT 'mixed' NOT NULL,
	"ai_tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"default_behavior" text DEFAULT 'optional' NOT NULL,
	"organization_id" varchar,
	"is_active" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "object_acl_policies" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"object_key" text NOT NULL,
	"owner" text NOT NULL,
	"organization_id" text NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "object_acl_policies_object_key_unique" UNIQUE("object_key")
);
--> statement-breakpoint
CREATE TABLE "offline_sync_queue" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"operation_type" "offline_operation_type" NOT NULL,
	"entity_type" "offline_entity_type" NOT NULL,
	"entity_id" varchar,
	"payload" json NOT NULL,
	"status" "offline_sync_status" DEFAULT 'PENDING' NOT NULL,
	"synced_at" timestamp,
	"synced_entity_id" varchar,
	"error_message" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"last_retry_at" timestamp,
	"device_id" text,
	"client_timestamp" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_color_palettes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"palette_name" text DEFAULT 'Organization Default' NOT NULL,
	"is_preset" boolean DEFAULT false NOT NULL,
	"light_primary" text,
	"light_primary_foreground" text,
	"light_secondary" text,
	"light_secondary_foreground" text,
	"light_accent" text,
	"light_accent_foreground" text,
	"light_background" text,
	"light_foreground" text,
	"light_muted" text,
	"light_muted_foreground" text,
	"light_card" text,
	"light_card_foreground" text,
	"light_border" text,
	"dark_primary" text,
	"dark_primary_foreground" text,
	"dark_secondary" text,
	"dark_secondary_foreground" text,
	"dark_accent" text,
	"dark_accent_foreground" text,
	"dark_background" text,
	"dark_foreground" text,
	"dark_muted" text,
	"dark_muted_foreground" text,
	"dark_card" text,
	"dark_card_foreground" text,
	"dark_border" text,
	"contrast_validated" boolean DEFAULT false NOT NULL,
	"last_validated_at" timestamp,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_calculators" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"unit" text NOT NULL,
	"formula_json" text NOT NULL,
	"input_fields_json" text NOT NULL,
	"default_values" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_documents" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"type" "organization_document_type" NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"file_url" text NOT NULL,
	"object_key" text,
	"mime_type" text,
	"file_size" integer,
	"visibility" "organization_document_visibility" DEFAULT 'INTERNAL' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"uploaded_by_id" varchar,
	"effective_date" date,
	"expires_at" date,
	"notes" text,
	"replaces_document_id" varchar,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "org_docs_active_type_org_unique" UNIQUE("organization_id","type","is_active")
);
--> statement-breakpoint
CREATE TABLE "organization_network_settings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"is_network_enabled" boolean DEFAULT true NOT NULL,
	"can_receive_bid_invites" boolean DEFAULT true NOT NULL,
	"can_send_bid_requests" boolean DEFAULT true NOT NULL,
	"trade_specialties" text[],
	"auto_accept_from_trusted_gcs" boolean DEFAULT false NOT NULL,
	"trusted_gc_organization_ids" text[],
	"max_active_invites" integer DEFAULT 50,
	"notify_by_email" boolean DEFAULT true NOT NULL,
	"notify_in_app" boolean DEFAULT true NOT NULL,
	"company_description" text,
	"service_areas" text[],
	"certifications" text[],
	"years_in_business" integer,
	"bio" text,
	"founded_year" integer,
	"license_numbers" text[],
	"portfolio_photos" text[],
	"is_directory_listed" boolean DEFAULT false NOT NULL,
	"avg_rating" numeric(3, 2),
	"review_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organization_network_settings_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "organization_social_links" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"facebook_url" text,
	"instagram_url" text,
	"linkedin_url" text,
	"twitter_url" text,
	"tiktok_url" text,
	"youtube_url" text,
	"show_on_website" boolean DEFAULT true,
	"show_in_footer" boolean DEFAULT true,
	"show_on_contact" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organization_social_links_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "organization_sow_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"category_name" text NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"unit" text,
	"requires_dimensions" boolean DEFAULT false NOT NULL,
	"dimension_label" text,
	"default_cost_code" varchar(20),
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_from_template" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "org_sow_items_code_org_unique" UNIQUE("organization_id","code")
);
--> statement-breakpoint
CREATE TABLE "organization_website_pages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"website_id" varchar NOT NULL,
	"organization_id" varchar NOT NULL,
	"page_type" "website_page_type" DEFAULT 'CUSTOM' NOT NULL,
	"page_slug" text NOT NULL,
	"page_title" text NOT NULL,
	"content_json" text,
	"hero_image_url" text,
	"ai_generated" boolean DEFAULT false,
	"meta_title" text,
	"meta_description" text,
	"keywords" text[],
	"rich_schema_json" text,
	"canonical_url" text,
	"no_index" boolean DEFAULT false,
	"og_image_url" text,
	"is_published" boolean DEFAULT false,
	"show_in_navigation" boolean DEFAULT true,
	"navigation_order" integer DEFAULT 0,
	"navigation_label" text,
	"parent_page_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_websites" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"status" "website_status" DEFAULT 'DRAFT' NOT NULL,
	"site_title" text,
	"site_tagline" text,
	"mission_statement" text,
	"subdomain" text,
	"custom_domain" text,
	"custom_domain_verified" boolean DEFAULT false,
	"ssl_enabled" boolean DEFAULT true,
	"staging_token" text,
	"primary_color" text,
	"secondary_color" text,
	"accent_color" text,
	"background_color" text,
	"text_color" text,
	"font_family" text,
	"template_id" text,
	"logo_url" text,
	"favicon_url" text,
	"logo_height" integer DEFAULT 55,
	"default_meta_title" text,
	"default_meta_description" text,
	"default_keywords" text[],
	"og_image_url" text,
	"google_analytics_id" text,
	"contact_email" text,
	"contact_phone" text,
	"contact_address" text,
	"content_width" text DEFAULT 'full-width',
	"max_width" integer DEFAULT 1200,
	"section_padding" integer DEFAULT 24,
	"breakpoint_desktop" integer DEFAULT 1280,
	"breakpoint_tablet" integer DEFAULT 768,
	"breakpoint_mobile" integer DEFAULT 480,
	"header_type" text DEFAULT 'static',
	"header_height" integer DEFAULT 80,
	"logo_position" text DEFAULT 'left',
	"navigation_layout" text DEFAULT 'horizontal',
	"mobile_nav_style" text DEFAULT 'dropdown',
	"show_on_scroll" boolean DEFAULT true,
	"page_layout" text DEFAULT 'boxed',
	"sidebar_width" integer DEFAULT 300,
	"page_padding" integer DEFAULT 32,
	"show_breadcrumb" boolean DEFAULT true,
	"footer_visibility" boolean DEFAULT true,
	"footer_columns" integer DEFAULT 3,
	"footer_width" text DEFAULT 'boxed',
	"footer_padding" integer DEFAULT 40,
	"footer_section_settings" json,
	"header_section_settings" json,
	"header_components_config" json,
	"footer_components_config" json,
	"body_components_config" json,
	"global_components_config" json,
	"blog_enabled" boolean DEFAULT true,
	"gallery_enabled" boolean DEFAULT true,
	"contact_form_enabled" boolean DEFAULT true,
	"analytics_enabled" boolean DEFAULT true,
	"last_published_at" timestamp,
	"last_published_by_user_id" varchar,
	"published_bundle_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organization_websites_subdomain_unique" UNIQUE("subdomain")
);
--> statement-breakpoint
CREATE TABLE "organization_work_types" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"unit" text NOT NULL,
	"default_production_rate" numeric(10, 2),
	"labor_cost_per_unit" numeric(10, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "overhead_cost_history" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"cost_item_id" varchar,
	"action" "overhead_cost_action" NOT NULL,
	"performed_by_id" varchar,
	"item_name" text NOT NULL,
	"previous_data" text,
	"new_data" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "overhead_cost_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"name" text NOT NULL,
	"category" "overhead_cost_category" DEFAULT 'OTHER' NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"frequency" "overhead_cost_frequency" DEFAULT 'MONTHLY' NOT NULL,
	"amortization_months" integer,
	"effective_date" date,
	"end_date" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_preview_links" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" varchar NOT NULL,
	"organization_id" varchar NOT NULL,
	"token" varchar NOT NULL,
	"created_by_id" varchar NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "page_preview_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "page_versions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" varchar NOT NULL,
	"organization_id" varchar NOT NULL,
	"version_number" integer NOT NULL,
	"content_json" text,
	"page_settings_json" text,
	"editor_id" varchar NOT NULL,
	"editor_name" text NOT NULL,
	"change_summary" text,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passkey_credentials" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL,
	"transports" text[],
	"device_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "passkey_credentials_credential_id_unique" UNIQUE("credential_id")
);
--> statement-breakpoint
CREATE TABLE "performance_reviews" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"organization_id" varchar,
	"review_date" text NOT NULL,
	"reviewer_name" text NOT NULL,
	"overall_rating" integer NOT NULL,
	"productivity_rating" integer,
	"quality_rating" integer,
	"safety_rating" integer,
	"communication_rating" integer,
	"leadership_rating" integer,
	"notes" text,
	"schedule_adherence" text,
	"cost_control" text,
	"subcontractor_coordination" text,
	"client_inspection_outcomes" text,
	"recorded_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_activity_log" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portal_token_id" varchar NOT NULL,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" varchar,
	"details" text,
	"ip_address" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_chat_messages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" varchar NOT NULL,
	"sender_type" text NOT NULL,
	"sender_portal_token_id" varchar,
	"sender_client_access_id" varchar,
	"sender_user_id" varchar,
	"sender_name" text NOT NULL,
	"content" text NOT NULL,
	"is_internal" boolean DEFAULT false NOT NULL,
	"attachment_url" text,
	"attachment_name" text,
	"attachment_type" text,
	"read_by_portal" boolean DEFAULT false NOT NULL,
	"read_by_team" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_chat_threads" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"project_id" varchar NOT NULL,
	"portal_token_id" varchar,
	"client_portal_access_id" varchar,
	"subject" text NOT NULL,
	"category" "portal_chat_thread_category" DEFAULT 'GENERAL' NOT NULL,
	"linked_entity_type" text,
	"linked_entity_id" varchar,
	"status" "portal_chat_thread_status" DEFAULT 'OPEN' NOT NULL,
	"priority" "portal_chat_priority" DEFAULT 'NORMAL' NOT NULL,
	"last_message_at" timestamp DEFAULT now() NOT NULL,
	"portal_unread_count" integer DEFAULT 0 NOT NULL,
	"team_unread_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pricebook_import_jobs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"crm_organisation_id" varchar NOT NULL,
	"file_ref" text NOT NULL,
	"file_name" text NOT NULL,
	"status" "pricebook_import_job_status" DEFAULT 'PENDING' NOT NULL,
	"items_extracted" integer DEFAULT 0,
	"items_approved" integer DEFAULT 0,
	"error_message" text,
	"effective_quarter" text,
	"effective_date" timestamp,
	"processed_at" timestamp,
	"created_by_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_equipment_plans" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"bid_equipment_selection_id" varchar,
	"source" "bid_equipment_source" NOT NULL,
	"status" "project_equipment_plan_status" DEFAULT 'PLANNED' NOT NULL,
	"equipment_id" varchar,
	"assignment_id" varchar,
	"rental_catalog_id" varchar,
	"rental_vendor_id" varchar,
	"rental_confirmation_number" text,
	"equipment_name" text NOT NULL,
	"equipment_type" text NOT NULL,
	"planned_hours" numeric(10, 1),
	"planned_days" integer,
	"planned_start_date" timestamp,
	"planned_end_date" timestamp,
	"planned_cost" numeric(12, 2),
	"actual_hours" numeric(10, 1),
	"actual_days" integer,
	"actual_start_date" timestamp,
	"actual_end_date" timestamp,
	"actual_cost" numeric(12, 2),
	"hourly_rate" numeric(10, 2),
	"daily_rate" numeric(10, 2),
	"notes" text,
	"cost_code" text,
	"created_by_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_health_snapshots" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"project_id" varchar NOT NULL,
	"overall_score" integer NOT NULL,
	"schedule_score" integer NOT NULL,
	"budget_score" integer NOT NULL,
	"rfi_submittal_score" integer NOT NULL,
	"change_order_score" integer NOT NULL,
	"safety_score" integer NOT NULL,
	"breakdown" json,
	"snapshot_date" date NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_plans" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"document_id" varchar,
	"original_pdf_url" text NOT NULL,
	"file_name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_profitability_snapshots" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"project_id" varchar NOT NULL,
	"project_code" varchar NOT NULL,
	"budget" numeric(12, 2) DEFAULT '0' NOT NULL,
	"adjusted_budget" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_labor_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_material_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_subcontractor_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_equipment_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_tm_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_other_expenses" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_actual_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"variance" numeric(12, 2) DEFAULT '0' NOT NULL,
	"variance_percent" numeric(8, 2) DEFAULT '0' NOT NULL,
	"estimated_margin" numeric(12, 2) DEFAULT '0' NOT NULL,
	"projected_completion_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'ON_BUDGET' NOT NULL,
	"alert_threshold_fired" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_schedule_tasks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" varchar NOT NULL,
	"parent_task_id" varchar,
	"name" text NOT NULL,
	"description" text,
	"trade_type" "trade_type",
	"planned_start_date" date,
	"planned_end_date" date,
	"actual_start_date" date,
	"actual_end_date" date,
	"duration_days" integer,
	"dependencies" varchar[],
	"percent_complete" integer DEFAULT 0 NOT NULL,
	"is_critical_path" boolean DEFAULT false NOT NULL,
	"is_milestone" boolean DEFAULT false NOT NULL,
	"crew_id" varchar,
	"sow_item_ids" varchar[],
	"inspection_id" varchar,
	"delay_ids" varchar[],
	"status" "schedule_task_status" DEFAULT 'NOT_STARTED' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_schedules" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"project_id" varchar NOT NULL,
	"name" text DEFAULT 'Master Schedule' NOT NULL,
	"generated_by" "schedule_generated_by" DEFAULT 'MANUAL' NOT NULL,
	"baseline_start_date" date,
	"baseline_end_date" date,
	"actual_start_date" date,
	"actual_end_date" date,
	"working_days" integer[] DEFAULT '{1,2,3,4,5}',
	"options_json" text,
	"ai_notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" varchar
);
--> statement-breakpoint
CREATE TABLE "project_spec_index" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"data" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_specs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"file_url" text NOT NULL,
	"original_file_name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qbo_account_mappings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"connection_id" varchar NOT NULL,
	"cost_code" text NOT NULL,
	"qbo_account_id" text NOT NULL,
	"qbo_account_name" text NOT NULL,
	"mapping_type" text DEFAULT 'cost_code' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "qbo_account_mappings_unique" UNIQUE("organization_id","connection_id","cost_code","mapping_type")
);
--> statement-breakpoint
CREATE TABLE "qbo_sync_schedules" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"connection_id" varchar NOT NULL,
	"operation" text NOT NULL,
	"frequency" text DEFAULT 'daily' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp,
	"next_run_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quality_issues" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"organization_id" varchar,
	"date" text NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"resolution" text,
	"recorded_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quantity_categories" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar,
	"bid_id" varchar,
	"name" text NOT NULL,
	"color" text DEFAULT '#3b82f6' NOT NULL,
	"line_style" text DEFAULT 'solid' NOT NULL,
	"line_width" integer DEFAULT 3 NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rating_criteria" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"weight" numeric(5, 2) DEFAULT '1.0',
	"max_score" integer DEFAULT 10 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"kpi_template_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rating_criteria_org_name_unique" UNIQUE("organization_id","name")
);
--> statement-breakpoint
CREATE TABLE "rating_scores" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rating_id" varchar NOT NULL,
	"criteria_id" varchar NOT NULL,
	"score" numeric(5, 2) NOT NULL,
	"comment" text,
	CONSTRAINT "rating_scores_rating_criteria_unique" UNIQUE("rating_id","criteria_id")
);
--> statement-breakpoint
CREATE TABLE "rental_equipment_catalog" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_id" varchar,
	"crm_organisation_id" varchar,
	"name" text NOT NULL,
	"equipment_type" text NOT NULL,
	"make" text,
	"model" text,
	"description" text,
	"hourly_rate" numeric(10, 2),
	"daily_rate" numeric(10, 2),
	"weekly_rate" numeric(10, 2),
	"monthly_rate" numeric(10, 2),
	"delivery_fee" numeric(10, 2),
	"pickup_fee" numeric(10, 2),
	"fuel_surcharge" numeric(5, 2),
	"insurance_per_day" numeric(10, 2),
	"minimum_rental_days" integer DEFAULT 1,
	"lead_time_days" integer DEFAULT 1,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rental_equipment_usages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_equipment_plan_id" varchar NOT NULL,
	"project_id" varchar NOT NULL,
	"vendor_id" varchar NOT NULL,
	"rental_catalog_id" varchar,
	"equipment_name" text NOT NULL,
	"equipment_type" text NOT NULL,
	"start_date" timestamp NOT NULL,
	"expected_end_date" timestamp NOT NULL,
	"actual_end_date" timestamp,
	"status" text DEFAULT 'BOOKED' NOT NULL,
	"vendor_confirmation" text,
	"po_number" text,
	"daily_rate" numeric(10, 2) NOT NULL,
	"delivery_fee" numeric(10, 2),
	"pickup_fee" numeric(10, 2),
	"insurance_cost" numeric(10, 2),
	"fuel_charges" numeric(10, 2),
	"damage_charges" numeric(10, 2),
	"other_charges" numeric(10, 2),
	"total_cost" numeric(12, 2),
	"invoice_number" text,
	"invoice_date" timestamp,
	"is_paid" boolean DEFAULT false NOT NULL,
	"paid_date" timestamp,
	"notes" text,
	"created_by_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rental_vendors" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"organization_id" varchar DEFAULT 'tfr-default-org' NOT NULL,
	"contact_name" text,
	"contact_email" text,
	"contact_phone" text,
	"address" text,
	"city" text,
	"state" text,
	"account_number" text,
	"payment_terms" text,
	"notes" text,
	"crm_organisation_id" varchar,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retention_policies" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"entity_type" "retention_entity_type" NOT NULL,
	"retention_days" integer NOT NULL,
	"action" "retention_action" DEFAULT 'ARCHIVE' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "retention_policies_org_entity" UNIQUE("organization_id","entity_type")
);
--> statement-breakpoint
CREATE TABLE "reward_assignments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"employee_id" varchar NOT NULL,
	"reward_type_id" varchar NOT NULL,
	"assigned_by_id" varchar NOT NULL,
	"rating_id" varchar,
	"amount" numeric(10, 2),
	"justification" text,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reward_types" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" "reward_type_enum" DEFAULT 'CUSTOM' NOT NULL,
	"value" numeric(10, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reward_types_org_name_unique" UNIQUE("organization_id","name")
);
--> statement-breakpoint
CREATE TABLE "rfi_activity" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rfi_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"user_name" text,
	"action" text NOT NULL,
	"comment" text,
	"attachments_json" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rfi_attachments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rfi_id" varchar NOT NULL,
	"organization_id" varchar NOT NULL,
	"file_name" text NOT NULL,
	"file_size" integer,
	"mime_type" text,
	"storage_key" text NOT NULL,
	"uploaded_by_id" varchar NOT NULL,
	"uploaded_by_name" text,
	"description" text,
	"is_answer_attachment" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rfis" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"project_id" varchar NOT NULL,
	"contract_id" varchar,
	"rfi_number" text NOT NULL,
	"subject" text NOT NULL,
	"question" text NOT NULL,
	"status" "rfi_status" DEFAULT 'DRAFT' NOT NULL,
	"priority" "rfi_priority" DEFAULT 'MEDIUM' NOT NULL,
	"category" "rfi_category",
	"submitted_by_id" varchar NOT NULL,
	"submitted_by_name" text,
	"subcontractor_id" varchar,
	"assigned_to_id" varchar,
	"date_submitted" timestamp,
	"date_required" timestamp,
	"date_answered" timestamp,
	"answered_by_id" varchar,
	"answered_by_name" text,
	"answer" text,
	"answer_attachments_json" text,
	"drawing_reference" text,
	"spec_reference" text,
	"impact_description" text,
	"cost_impact" boolean DEFAULT false,
	"schedule_impact" boolean DEFAULT false,
	"attachments_json" text,
	"linked_change_order_id" varchar,
	"linked_tm_ticket_id" varchar,
	"linked_submittal_id" varchar,
	"forwarded_to_id" varchar,
	"forwarded_at" timestamp,
	"closed_at" timestamp,
	"closed_by_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "safety_incidents" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"organization_id" varchar,
	"date" text NOT NULL,
	"severity" text NOT NULL,
	"description" text NOT NULL,
	"action_taken" text,
	"recorded_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "safety_training_assignments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"training_id" varchar NOT NULL,
	"organization_id" varchar NOT NULL,
	"employee_id" varchar NOT NULL,
	"assigned_by" varchar,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	"due_date" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"completed_at" timestamp,
	"completed_by_name" text,
	"notes" text,
	"acknowledgment_signature" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "safety_trainings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"category" text NOT NULL,
	"frequency" text DEFAULT 'ONCE' NOT NULL,
	"duration_minutes" integer,
	"materials" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_takeoffs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"name" varchar(120) NOT NULL,
	"project_id" integer,
	"sheet_id" varchar,
	"measurement_data" json,
	"library_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_of_values" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"project_id" varchar NOT NULL,
	"sov_number" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"contract_value" numeric(14, 2) NOT NULL,
	"retainage_percent" numeric(5, 2) DEFAULT '10',
	"period_number" integer DEFAULT 1 NOT NULL,
	"period_start" date,
	"period_end" date,
	"status" "sov_status" DEFAULT 'DRAFT' NOT NULL,
	"approved_by_id" varchar,
	"approved_at" timestamp,
	"submitted_at" timestamp,
	"paid_at" timestamp,
	"total_scheduled_value" numeric(14, 2),
	"total_previously_completed" numeric(14, 2),
	"total_this_period" numeric(14, 2),
	"total_completed_to_date" numeric(14, 2),
	"total_materials_stored" numeric(14, 2),
	"total_retainage" numeric(14, 2),
	"total_earned_less_retainage" numeric(14, 2),
	"pdf_url" text,
	"pdf_generated_at" timestamp,
	"created_by_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scope_modifier_categories" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scope_modifier_categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "scope_modifier_rules" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pattern" text NOT NULL,
	"match_type" text NOT NULL,
	"modifier_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"trade_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scope_modifiers" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" varchar NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_custom" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scope_modifiers_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "scope_work_type_categories" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scope_work_type_categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "scope_work_types" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" varchar NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"requires_dimensions" boolean DEFAULT false NOT NULL,
	"dimension_label" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_custom" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scope_work_types_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "skill_verification_requests" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_skill_id" varchar NOT NULL,
	"requested_by_user_id" varchar NOT NULL,
	"requested_to_user_id" varchar NOT NULL,
	"organization_id" varchar NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "skills_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "social_accounts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"platform" "social_platform" NOT NULL,
	"account_name" text,
	"account_id" text,
	"profile_image_url" text,
	"status" "social_account_status" DEFAULT 'DISCONNECTED' NOT NULL,
	"access_token_encrypted" text,
	"refresh_token_encrypted" text,
	"token_expires_at" timestamp,
	"permission_scopes" text[],
	"last_sync_at" timestamp,
	"last_sync_error" text,
	"metadata" json,
	"connected_by_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_media_posts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"title" text,
	"content" text NOT NULL,
	"platform" "social_platform",
	"platforms" json,
	"status" "social_post_status" DEFAULT 'DRAFT' NOT NULL,
	"media_urls" text[],
	"hashtags" text[],
	"scheduled_at" timestamp,
	"published_at" timestamp,
	"campaign_tag" text,
	"tone" text,
	"notes" text,
	"is_recurring" boolean DEFAULT false,
	"recurring_pattern" json,
	"social_account_id" varchar,
	"ai_generated" boolean DEFAULT false,
	"ai_prompt" text,
	"suggested_image_prompt" text,
	"external_post_id" text,
	"external_post_url" text,
	"retry_count" integer DEFAULT 0,
	"last_error" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"approval_status" text,
	"rejection_reason" text,
	"approved_by_id" varchar,
	"approved_at" timestamp,
	"created_by_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_post_analytics" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" varchar NOT NULL,
	"impressions" integer DEFAULT 0,
	"reach" integer DEFAULT 0,
	"engagement" integer DEFAULT 0,
	"clicks" integer DEFAULT 0,
	"likes" integer DEFAULT 0,
	"shares" integer DEFAULT 0,
	"comments" integer DEFAULT 0,
	"saves" integer DEFAULT 0,
	"fetched_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_post_history" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"platform" "social_platform" NOT NULL,
	"post_content" text NOT NULL,
	"hashtags" text[],
	"source_type" text,
	"source_id" varchar,
	"ai_prompt" text,
	"tone" text,
	"suggested_image_url" text,
	"suggested_image_prompt" text,
	"exported" boolean DEFAULT false,
	"exported_at" timestamp,
	"created_by_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sov_line_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sov_id" varchar NOT NULL,
	"line_number" integer NOT NULL,
	"item_code" text,
	"description" text NOT NULL,
	"category" text,
	"scheduled_value" numeric(12, 2) NOT NULL,
	"previously_completed" numeric(12, 2) DEFAULT '0',
	"this_period_completed" numeric(12, 2) DEFAULT '0',
	"materials_stored" numeric(12, 2) DEFAULT '0',
	"total_completed_and_stored" numeric(12, 2),
	"percent_complete" numeric(5, 2),
	"balance_to_finish" numeric(12, 2),
	"retainage_amount" numeric(12, 2),
	"estimate_line_item_id" varchar,
	"linked_change_order_id" varchar,
	"organization_sow_item_id" varchar,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sov_payments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"sov_id" varchar NOT NULL,
	"payment_number" integer DEFAULT 1 NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"payment_date" date NOT NULL,
	"payment_method" "sov_payment_method" DEFAULT 'CHECK',
	"reference_number" text,
	"notes" text,
	"recorded_by_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sow_audit_log" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"action" "sow_audit_action" NOT NULL,
	"sow_code" text,
	"sow_name" text,
	"details" text,
	"previous_trade_type" "trade_type",
	"new_trade_type" "trade_type",
	"item_count" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sso_configurations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"provider" "sso_provider" NOT NULL,
	"entity_id" text NOT NULL,
	"sso_login_url" text NOT NULL,
	"certificate" text NOT NULL,
	"metadata_url" text,
	"enforce_sso" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subcontractor_bid_invitations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bid_request_id" varchar NOT NULL,
	"invited_organization_id" varchar,
	"external_company_name" text,
	"external_contact_name" text,
	"external_contact_email" text,
	"external_contact_phone" text,
	"invited_trade_type" "trade_type",
	"personal_message" text,
	"status" "bid_invitation_status" DEFAULT 'PENDING' NOT NULL,
	"viewed_at" timestamp,
	"responded_at" timestamp,
	"declined_reason" text,
	"email_sent_at" timestamp,
	"reminder_sent_at" timestamp,
	"reminder_count" integer DEFAULT 0 NOT NULL,
	"invited_by_user_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sub_bid_inv_unique" UNIQUE("bid_request_id","invited_organization_id")
);
--> statement-breakpoint
CREATE TABLE "subcontractor_bid_requests" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"project_id" varchar,
	"bid_id" varchar,
	"title" text NOT NULL,
	"description" text,
	"scope_of_work" text NOT NULL,
	"required_trades" text[] NOT NULL,
	"bid_due_date" timestamp NOT NULL,
	"project_start_date" date,
	"project_end_date" date,
	"project_address" text,
	"project_city" text,
	"project_state" text,
	"project_zip" text,
	"budget_range_min" numeric(14, 2),
	"budget_range_max" numeric(14, 2),
	"show_budget_to_subs" boolean DEFAULT false NOT NULL,
	"requires_bonding" boolean DEFAULT false NOT NULL,
	"requires_insurance" boolean DEFAULT true NOT NULL,
	"insurance_minimum" numeric(14, 2),
	"special_requirements" text,
	"attached_file_urls" text[],
	"attached_file_names" text[],
	"status" "bid_request_status" DEFAULT 'DRAFT' NOT NULL,
	"published_at" timestamp,
	"closed_at" timestamp,
	"awarded_at" timestamp,
	"awarded_to_organization_id" varchar,
	"internal_notes" text,
	"view_count" integer DEFAULT 0 NOT NULL,
	"invite_count" integer DEFAULT 0 NOT NULL,
	"response_count" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subcontractor_bid_responses" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invitation_id" varchar NOT NULL,
	"bid_request_id" varchar NOT NULL,
	"responding_organization_id" varchar NOT NULL,
	"total_bid_amount" numeric(14, 2) NOT NULL,
	"labor_cost" numeric(14, 2),
	"material_cost" numeric(14, 2),
	"equipment_cost" numeric(14, 2),
	"other_cost" numeric(14, 2),
	"line_items_json" text,
	"proposal_notes" text,
	"scope_inclusions" text,
	"scope_exclusions" text,
	"assumptions" text,
	"proposed_start_date" date,
	"proposed_duration" integer,
	"proposed_duration_unit" text DEFAULT 'DAYS',
	"attached_file_urls" text[],
	"attached_file_names" text[],
	"quote_valid_until" date,
	"status" "bid_response_status" DEFAULT 'DRAFT' NOT NULL,
	"submitted_at" timestamp,
	"reviewed_at" timestamp,
	"reviewed_by_user_id" varchar,
	"gc_internal_rating" integer,
	"gc_internal_notes" text,
	"sub_internal_notes" text,
	"created_by_user_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subcontractor_billing_schedule" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" varchar NOT NULL,
	"milestone_number" integer NOT NULL,
	"description" text NOT NULL,
	"scheduled_amount" numeric(12, 2) NOT NULL,
	"scheduled_date" timestamp,
	"completion_percent" integer,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"completed_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subcontractor_contracts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subcontractor_id" varchar NOT NULL,
	"project_id" varchar NOT NULL,
	"contract_number" text NOT NULL,
	"scope_of_work" text NOT NULL,
	"contract_amount" numeric(12, 2) NOT NULL,
	"start_date" timestamp,
	"completion_date" timestamp,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"payment_terms" text,
	"retention_percent" numeric(5, 2),
	"notes" text,
	"cost_code" text,
	"created_by_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subcontractor_payments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"contract_id" varchar NOT NULL,
	"payment_number" integer NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"retention_held" numeric(12, 2),
	"payment_date" timestamp,
	"description" text,
	"invoice_number" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"approved_by_id" varchar,
	"approved_at" timestamp,
	"rejected_by_id" varchar,
	"rejected_at" timestamp,
	"rejection_reason" text,
	"paid_by_id" varchar,
	"paid_at" timestamp,
	"check_number" text,
	"payment_method" text,
	"auto_created" boolean DEFAULT false NOT NULL,
	"created_by_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subcontractor_portal_tokens" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"project_id" varchar NOT NULL,
	"crm_organisation_id" varchar NOT NULL,
	"contact_email" text NOT NULL,
	"contact_name" text NOT NULL,
	"token_hash" text NOT NULL,
	"permissions" text[] DEFAULT ARRAY['view','comment','upload','acknowledge'] NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"last_accessed_at" timestamp,
	"invited_by_id" varchar,
	"invited_by_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp,
	CONSTRAINT "subcontractor_portal_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "subcontractors" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_name" text NOT NULL,
	"contact_name" text,
	"email" text,
	"phone" text,
	"address" text,
	"specialties" text[],
	"insurance_expiration" timestamp,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submittal_activity" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submittal_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"user_name" text,
	"action" text NOT NULL,
	"comment" text,
	"attachments_json" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submittal_attachments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submittal_id" varchar NOT NULL,
	"organization_id" varchar NOT NULL,
	"submittal_item_id" varchar,
	"submittal_review_id" varchar,
	"file_name" text NOT NULL,
	"file_size" integer,
	"mime_type" text,
	"storage_key" text NOT NULL,
	"uploaded_by_id" varchar NOT NULL,
	"uploaded_by_name" text,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submittal_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submittal_id" varchar NOT NULL,
	"organization_id" varchar NOT NULL,
	"item_number" integer NOT NULL,
	"description" text NOT NULL,
	"spec_section" text,
	"submittal_category" "submittal_category",
	"quantity" numeric(10, 3),
	"unit" text,
	"manufacturer" text,
	"model_number" text,
	"notes" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "submittal_items_submittal_item_number_unique" UNIQUE("submittal_id","item_number")
);
--> statement-breakpoint
CREATE TABLE "submittal_reviews" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submittal_id" varchar NOT NULL,
	"organization_id" varchar NOT NULL,
	"reviewer_role" "submittal_review_role" NOT NULL,
	"reviewer_id" varchar,
	"reviewer_name" text NOT NULL,
	"sequence_order" integer NOT NULL,
	"status" "submittal_review_status" DEFAULT 'PENDING' NOT NULL,
	"comments" text,
	"stamp_action" text,
	"date_assigned" timestamp,
	"date_reviewed" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submittals" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"project_id" varchar NOT NULL,
	"contract_id" varchar,
	"submittal_number" text NOT NULL,
	"subject" text NOT NULL,
	"description" text,
	"submittal_type" "submittal_type" DEFAULT 'CONTRACTOR' NOT NULL,
	"phase" "submittal_phase" DEFAULT 'CONSTRUCTION' NOT NULL,
	"status" "submittal_status" DEFAULT 'DRAFT' NOT NULL,
	"spec_section" text,
	"category" text,
	"submittal_category" "submittal_category",
	"subcontractor_id" varchar,
	"submitted_by_id" varchar NOT NULL,
	"submitted_by_name" text,
	"date_submitted" timestamp,
	"date_required" timestamp,
	"reviewer_id" varchar,
	"reviewer_name" text,
	"date_reviewed" timestamp,
	"review_comments" text,
	"revision_number" integer DEFAULT 1 NOT NULL,
	"previous_submittal_id" varchar,
	"attachments_json" text,
	"stamp_action" text,
	"linked_rfi_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supervisor_notes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"organization_id" varchar,
	"note" text NOT NULL,
	"created_by" varchar,
	"created_by_name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "takeoff_assemblies" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"trade_type" text,
	"measurement_type" text DEFAULT 'LINEAR' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "takeoff_assembly_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assembly_id" varchar NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"unit" text NOT NULL,
	"formula" text NOT NULL,
	"waste_factor" double precision DEFAULT 0 NOT NULL,
	"unit_cost" numeric(10, 2),
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "takeoff_conditions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"name" text NOT NULL,
	"measurement_type" text NOT NULL,
	"color" text DEFAULT '#3b82f6' NOT NULL,
	"category_name" text,
	"unit_cost" double precision,
	"cost_code_id" varchar,
	"assembly_id" varchar,
	"line_style" text,
	"label_template" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "takeoff_issue_comments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" varchar NOT NULL,
	"author_id" varchar NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "takeoff_issues" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sheet_id" varchar NOT NULL,
	"organization_id" varchar NOT NULL,
	"issue_number" integer NOT NULL,
	"category" "takeoff_issue_category" DEFAULT 'QUESTION' NOT NULL,
	"severity" "issue_severity" DEFAULT 'MEDIUM' NOT NULL,
	"status" "takeoff_issue_status" DEFAULT 'OPEN' NOT NULL,
	"assignee_id" varchar,
	"description" text DEFAULT '' NOT NULL,
	"position" text NOT NULL,
	"category_id" varchar,
	"created_by_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "takeoff_markups" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sheet_id" varchar NOT NULL,
	"organization_id" varchar,
	"created_by" varchar NOT NULL,
	"tool" "takeoff_markup_tool" NOT NULL,
	"points" text NOT NULL,
	"color" text DEFAULT '#ff0000' NOT NULL,
	"thickness" integer DEFAULT 2 NOT NULL,
	"text" text,
	"category_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "takeoff_measurement_assemblies" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"measurement_id" varchar NOT NULL,
	"assembly_id" varchar NOT NULL,
	"overrides" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "takeoff_measurement_groups" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"project_id" varchar,
	"bid_id" varchar,
	"sheet_id" varchar,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"color" text DEFAULT '#6b7280' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "takeoff_measurements" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sheet_id" varchar NOT NULL,
	"category_id" varchar,
	"group_id" varchar,
	"type" "measurement_type" NOT NULL,
	"label" text NOT NULL,
	"points" text NOT NULL,
	"arc_data" text,
	"depth_feet" double precision,
	"count" integer,
	"note" text,
	"color" text DEFAULT '#3b82f6',
	"visible" boolean DEFAULT true NOT NULL,
	"source" "measurement_source" DEFAULT 'USER' NOT NULL,
	"status" "measurement_status" DEFAULT 'DRAFT' NOT NULL,
	"pitch_ratio" text,
	"cost_code_id" varchar,
	"unit_cost" double precision,
	"line_style" text DEFAULT 'solid' NOT NULL,
	"line_width" integer DEFAULT 3 NOT NULL,
	"computed_length_ft" double precision,
	"computed_area_ft2" double precision,
	"computed_volume_cy" double precision,
	"computed_surface_area_ft2" double precision,
	"metadata" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "takeoff_sheet_links" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_sheet_id" varchar NOT NULL,
	"target_sheet_id" varchar NOT NULL,
	"x" double precision NOT NULL,
	"y" double precision NOT NULL,
	"width" double precision NOT NULL,
	"height" double precision NOT NULL,
	"label" text,
	"auto_detected" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "takeoff_sheets" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar,
	"bid_id" varchar,
	"plan_id" varchar,
	"image_url" text NOT NULL,
	"sheet_index" integer DEFAULT 0 NOT NULL,
	"sheet_name" text,
	"scale_px_per_foot" double precision,
	"units" text DEFAULT 'ft' NOT NULL,
	"folder_group" text DEFAULT 'Plans' NOT NULL,
	"revision_label" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"superseded_by_id" varchar,
	"rotation" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "talent_profiles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"organization_id" varchar,
	"bio" text,
	"trade_specialization" text,
	"years_of_experience" integer,
	"availability" "talent_availability" DEFAULT 'AVAILABLE' NOT NULL,
	"visibility" "talent_profile_visibility" DEFAULT 'PUBLIC' NOT NULL,
	"desired_pay_min" numeric(10, 2),
	"desired_pay_max" numeric(10, 2),
	"pay_type" text,
	"preferred_location" text,
	"work_radius_miles" integer,
	"portfolio_photos" text[] DEFAULT '{}'::text[],
	"resume_url" text,
	"headline" text,
	"rating" numeric(3, 2),
	"is_published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trade_features" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_type" "trade_type" NOT NULL,
	"feature_key" text NOT NULL,
	"feature_name" text NOT NULL,
	"description" text,
	"nav_section" text,
	"nav_icon" text,
	"nav_path" text,
	"dashboard_widget" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "trade_features_key_unique" UNIQUE("trade_type","feature_key")
);
--> statement-breakpoint
CREATE TABLE "trade_templates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_type" "trade_type" NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"csi_division" text,
	"icon_name" text,
	"color_hex" text,
	"material_categories" text NOT NULL,
	"work_types_json" text NOT NULL,
	"calculator_config_json" text NOT NULL,
	"terminology_json" text,
	"default_units_json" text,
	"enabled_features_json" text,
	"is_gc_trade" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "trade_templates_trade_type_unique" UNIQUE("trade_type")
);
--> statement-breakpoint
CREATE TABLE "transmittal_recipients" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transmittal_id" varchar NOT NULL,
	"subcontractor_id" varchar NOT NULL,
	"subcontractor_name" text,
	"acknowledged" boolean DEFAULT false NOT NULL,
	"acknowledged_at" timestamp,
	"acknowledged_by_id" varchar,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "units_of_measure" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"abbreviation" text NOT NULL,
	"category" text NOT NULL,
	"description" text,
	"conversion_factor" numeric(12, 6),
	"base_unit" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "units_of_measure_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "user_certifications" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"organization_id" varchar NOT NULL,
	"certification_name" text NOT NULL,
	"issued_date" timestamp,
	"expiry_date" timestamp,
	"file_url" text,
	"file_object_key" text,
	"file_name" text,
	"status" text DEFAULT 'active' NOT NULL,
	"expiry_notified_30_days" boolean DEFAULT false,
	"expiry_notified_5_days" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_color_palettes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"palette_name" text DEFAULT 'Default' NOT NULL,
	"is_preset" boolean DEFAULT false NOT NULL,
	"light_primary" text,
	"light_primary_foreground" text,
	"light_secondary" text,
	"light_secondary_foreground" text,
	"light_accent" text,
	"light_accent_foreground" text,
	"light_background" text,
	"light_foreground" text,
	"light_muted" text,
	"light_muted_foreground" text,
	"light_card" text,
	"light_card_foreground" text,
	"light_border" text,
	"dark_primary" text,
	"dark_primary_foreground" text,
	"dark_secondary" text,
	"dark_secondary_foreground" text,
	"dark_accent" text,
	"dark_accent_foreground" text,
	"dark_background" text,
	"dark_foreground" text,
	"dark_muted" text,
	"dark_muted_foreground" text,
	"dark_card" text,
	"dark_card_foreground" text,
	"dark_border" text,
	"contrast_validated" boolean DEFAULT false NOT NULL,
	"last_validated_at" timestamp,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_dashboard_layouts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"layout_config" text NOT NULL,
	"is_custom" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_dashboard_layouts_org_user_unique" UNIQUE("organization_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "user_dashboard_permissions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"can_access_financials" boolean DEFAULT false NOT NULL,
	"can_manage_payroll" boolean DEFAULT false NOT NULL,
	"can_access_reports" boolean DEFAULT false NOT NULL,
	"can_use_ai_features" boolean DEFAULT false NOT NULL,
	"can_post_social_media" boolean DEFAULT false NOT NULL,
	"can_manage_website" boolean DEFAULT false NOT NULL,
	"can_manage_equipment" boolean DEFAULT false NOT NULL,
	"can_manage_procurement" boolean DEFAULT false NOT NULL,
	"granted_by_user_id" varchar,
	"granted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_dashboard_permissions_org_user_unique" UNIQUE("organization_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "user_equipment_competencies" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"organization_id" varchar NOT NULL,
	"equipment_name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_photos" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"file_name" text NOT NULL,
	"file_url" text NOT NULL,
	"object_key" text,
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_skills" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"skill_id" varchar NOT NULL,
	"proficiency_level" text,
	"star_rating" integer DEFAULT 0,
	"years_experience" integer,
	"certified_at" timestamp,
	"verification_status" text DEFAULT 'unverified',
	"verified_by_user_id" varchar,
	"verified_at" timestamp,
	"added_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_enrollments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_crm_org_id" varchar NOT NULL,
	"contractor_org_id" varchar NOT NULL,
	"status" "vendor_enrollment_status" DEFAULT 'PENDING' NOT NULL,
	"auto_approve_new_pricing" boolean DEFAULT false NOT NULL,
	"notify_on_price_update" boolean DEFAULT true NOT NULL,
	"invited_by_user_id" varchar,
	"invited_at" timestamp DEFAULT now() NOT NULL,
	"enrolled_at" timestamp,
	"enrollment_code" varchar,
	"enrolled_categories" text[],
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_enrollments_enrollment_code_unique" UNIQUE("enrollment_code"),
	CONSTRAINT "vendor_enrollments_unique" UNIQUE("vendor_crm_org_id","contractor_org_id")
);
--> statement-breakpoint
CREATE TABLE "vendor_price_history" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pricebook_item_id" varchar NOT NULL,
	"old_price" numeric(12, 4),
	"new_price" numeric(12, 4) NOT NULL,
	"change_percent" numeric(6, 2),
	"effective_date" date NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_pricebook_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pricebook_id" varchar NOT NULL,
	"organization_id" varchar NOT NULL,
	"vendor_id" varchar NOT NULL,
	"vendor_code" text NOT NULL,
	"vendor_description" text NOT NULL,
	"vendor_unit" text,
	"category" text NOT NULL,
	"unit" text NOT NULL,
	"unit_price" numeric(12, 4) NOT NULL,
	"markup_percent" numeric(5, 2) DEFAULT '0',
	"sow_item_id" varchar,
	"calculator_key" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"effective_date" date,
	"expiration_date" date,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_pricebooks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"vendor_id" varchar NOT NULL,
	"file_key" text NOT NULL,
	"file_name" text,
	"file_type" text NOT NULL,
	"effective_date" date,
	"expiration_date" date,
	"trade_type" "trade_type",
	"mapping_preset_json" text,
	"status" "pricebook_status" DEFAULT 'PENDING' NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"imported_at" timestamp,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"uploaded_by_user_id" varchar
);
--> statement-breakpoint
CREATE TABLE "vendor_pricing_catalogs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crm_organisation_id" varchar NOT NULL,
	"organization_id" varchar,
	"item_name" text NOT NULL,
	"item_code" text,
	"category" text NOT NULL,
	"description" text,
	"unit" text NOT NULL,
	"unit_price" numeric(12, 4) NOT NULL,
	"minimum_order" numeric(10, 2),
	"delivery_fee" numeric(10, 2),
	"effective_quarter" text NOT NULL,
	"effective_date" timestamp NOT NULL,
	"expiration_date" timestamp,
	"source_doc_url" text,
	"source_doc_name" text,
	"lead_time_days" integer,
	"source_type" "pricing_source_type" DEFAULT 'MANUAL' NOT NULL,
	"approval_status" "pricing_approval_status" DEFAULT 'AUTO_APPROVED',
	"submitted_by_vendor_user_id" varchar,
	"approved_by_user_id" varchar,
	"approved_at" timestamp,
	"pricebook_import_id" varchar,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_scores" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"crm_entity_id" varchar NOT NULL,
	"project_id" varchar,
	"score_date" date NOT NULL,
	"on_time_delivery_score" numeric(3, 2),
	"quality_score" numeric(3, 2),
	"communication_score" numeric(3, 2),
	"price_competitiveness_score" numeric(3, 2),
	"reliability_score" numeric(3, 2),
	"overall_score" numeric(3, 2),
	"notes" text,
	"scored_by_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"crm_organisation_id" varchar NOT NULL,
	"can_submit_pricing" boolean DEFAULT true NOT NULL,
	"can_view_enrollments" boolean DEFAULT true NOT NULL,
	"can_manage_users" boolean DEFAULT false NOT NULL,
	"is_primary_contact" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_users_unique" UNIQUE("user_id","crm_organisation_id")
);
--> statement-breakpoint
CREATE TABLE "voice_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"project_id" varchar,
	"user_id" varchar NOT NULL,
	"audio_url" text NOT NULL,
	"audio_object_key" text,
	"duration" integer,
	"transcription" text,
	"status" "voice_log_status" DEFAULT 'PENDING' NOT NULL,
	"transcribed_at" timestamp,
	"error_message" text,
	"ai_summary" text,
	"ai_tags" text[],
	"ai_sentiment" text,
	"latitude" double precision,
	"longitude" double precision,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "website_analytics_daily" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"website_id" varchar NOT NULL,
	"organization_id" varchar NOT NULL,
	"date" date NOT NULL,
	"page_views" integer DEFAULT 0,
	"unique_visitors" integer DEFAULT 0,
	"sessions" integer DEFAULT 0,
	"avg_session_duration" integer DEFAULT 0,
	"bounce_rate" numeric(5, 2),
	"top_pages_json" text,
	"traffic_sources_json" text,
	"contact_form_submissions" integer DEFAULT 0,
	"phone_clicks" integer DEFAULT 0,
	"email_clicks" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "website_analytics_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"website_id" varchar NOT NULL,
	"session_id" text NOT NULL,
	"visitor_id" text,
	"event_type" text NOT NULL,
	"page_path" text,
	"page_title" text,
	"referrer" text,
	"event_data_json" text,
	"ip_address" text,
	"user_agent" text,
	"device_type" text,
	"browser" text,
	"os" text,
	"country" text,
	"city" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "website_blog_comments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" varchar NOT NULL,
	"organization_id" varchar NOT NULL,
	"author_name" text NOT NULL,
	"author_email" text NOT NULL,
	"author_website" text,
	"content" text NOT NULL,
	"status" "blog_comment_status" DEFAULT 'PENDING' NOT NULL,
	"moderated_by_id" varchar,
	"moderated_at" timestamp,
	"parent_comment_id" varchar,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "website_blog_posts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"website_id" varchar NOT NULL,
	"organization_id" varchar NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"excerpt" text,
	"content_json" text,
	"content_html" text,
	"cover_image_url" text,
	"category" text,
	"tags" text[],
	"author_id" varchar,
	"author_name" text,
	"ai_generated" boolean DEFAULT false,
	"ai_prompt" text,
	"meta_title" text,
	"meta_description" text,
	"keywords" text[],
	"rich_schema_json" text,
	"status" "blog_post_status" DEFAULT 'DRAFT' NOT NULL,
	"published_at" timestamp,
	"featured_post" boolean DEFAULT false,
	"view_count" integer DEFAULT 0,
	"share_count" integer DEFAULT 0,
	"comments_enabled" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "website_contact_submissions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"website_id" varchar NOT NULL,
	"organization_id" varchar NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"company" text,
	"subject" text,
	"message" text NOT NULL,
	"service_interest" text,
	"project_type" text,
	"estimated_budget" text,
	"preferred_contact_method" text,
	"source_page" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"crm_organisation_id" varchar,
	"crm_contact_id" varchar,
	"converted_to_crm" boolean DEFAULT false,
	"converted_at" timestamp,
	"read" boolean DEFAULT false,
	"read_at" timestamp,
	"responded" boolean DEFAULT false,
	"responded_at" timestamp,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "website_deployments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"website_id" varchar NOT NULL,
	"organization_id" varchar NOT NULL,
	"action" "website_deployment_action" NOT NULL,
	"performed_by_user_id" varchar NOT NULL,
	"performed_by_name" text,
	"note" text,
	"snapshot_url" text,
	"metadata" json,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "website_project_images" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"image_url" text NOT NULL,
	"thumbnail_url" text,
	"alt_text" text,
	"caption" text,
	"display_order" integer DEFAULT 0,
	"ai_caption" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "website_projects" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"website_id" varchar NOT NULL,
	"organization_id" varchar NOT NULL,
	"linked_project_id" varchar,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"short_description" text,
	"full_description" text,
	"service_type" text,
	"project_type" text,
	"location" text,
	"completion_date" date,
	"cover_image_url" text,
	"before_image_url" text,
	"after_image_url" text,
	"ai_generated" boolean DEFAULT false,
	"ai_prompt" text,
	"meta_title" text,
	"meta_description" text,
	"keywords" text[],
	"rich_schema_json" text,
	"status" "website_project_status" DEFAULT 'DRAFT' NOT NULL,
	"featured" boolean DEFAULT false,
	"display_order" integer DEFAULT 0,
	"view_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"organization_id" varchar,
	"date" text NOT NULL,
	"note" text NOT NULL,
	"category" text DEFAULT 'GENERAL' NOT NULL,
	"created_by" varchar,
	"created_by_name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "zapier_webhooks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"connection_id" varchar NOT NULL,
	"name" text NOT NULL,
	"webhook_url" text NOT NULL,
	"event_types" text[] NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"secret_key" text NOT NULL,
	"last_triggered_at" timestamp,
	"last_status" text,
	"trigger_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_estimator_id_users_id_fk" FOREIGN KEY ("estimator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_deductions" ADD CONSTRAINT "employee_deductions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_deductions" ADD CONSTRAINT "employee_deductions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_deductions" ADD CONSTRAINT "employee_deductions_deduction_type_id_payroll_deduction_types_id_fk" FOREIGN KEY ("deduction_type_id") REFERENCES "public"."payroll_deduction_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_addons" ADD CONSTRAINT "organization_addons_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_payroll_settings" ADD CONSTRAINT "organization_payroll_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_subscriptions" ADD CONSTRAINT "organization_subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_usage" ADD CONSTRAINT "organization_usage_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_run_line_items" ADD CONSTRAINT "pay_run_line_items_pay_run_id_pay_runs_id_fk" FOREIGN KEY ("pay_run_id") REFERENCES "public"."pay_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_run_line_items" ADD CONSTRAINT "pay_run_line_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_run_line_items" ADD CONSTRAINT "pay_run_line_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_runs" ADD CONSTRAINT "pay_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_runs" ADD CONSTRAINT "pay_runs_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_runs" ADD CONSTRAINT "pay_runs_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_stub_deductions" ADD CONSTRAINT "pay_stub_deductions_pay_run_line_item_id_pay_run_line_items_id_fk" FOREIGN KEY ("pay_run_line_item_id") REFERENCES "public"."pay_run_line_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_stub_deductions" ADD CONSTRAINT "pay_stub_deductions_deduction_type_id_payroll_deduction_types_id_fk" FOREIGN KEY ("deduction_type_id") REFERENCES "public"."payroll_deduction_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_deduction_types" ADD CONSTRAINT "payroll_deduction_types_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_estimator_id_users_id_fk" FOREIGN KEY ("estimator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_superintendent_id_users_id_fk" FOREIGN KEY ("superintendent_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_project_manager_id_users_id_fk" FOREIGN KEY ("project_manager_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_performed_by_users_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_payroll_reports" ADD CONSTRAINT "weekly_payroll_reports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_payroll_reports" ADD CONSTRAINT "weekly_payroll_reports_generated_by_approval_of_users_id_fk" FOREIGN KEY ("generated_by_approval_of") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_note_insights" ADD CONSTRAINT "ai_note_insights_run_id_ai_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ai_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_note_insights" ADD CONSTRAINT "ai_note_insights_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_note_insights" ADD CONSTRAINT "ai_note_insights_acknowledged_by_id_users_id_fk" FOREIGN KEY ("acknowledged_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_note_insights" ADD CONSTRAINT "ai_note_insights_completed_by_id_users_id_fk" FOREIGN KEY ("completed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_note_insights" ADD CONSTRAINT "ai_note_insights_dismissed_by_id_users_id_fk" FOREIGN KEY ("dismissed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annual_salary_categories" ADD CONSTRAINT "annual_salary_categories_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_documents" ADD CONSTRAINT "bid_documents_bid_id_bids_id_fk" FOREIGN KEY ("bid_id") REFERENCES "public"."bids"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_documents" ADD CONSTRAINT "bid_documents_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_material_quotes" ADD CONSTRAINT "bid_material_quotes_bid_id_bids_id_fk" FOREIGN KEY ("bid_id") REFERENCES "public"."bids"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_material_quotes" ADD CONSTRAINT "bid_material_quotes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_subcontractor_quotes" ADD CONSTRAINT "bid_subcontractor_quotes_bid_id_bids_id_fk" FOREIGN KEY ("bid_id") REFERENCES "public"."bids"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_subcontractor_quotes" ADD CONSTRAINT "bid_subcontractor_quotes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_scope_item_id_scope_items_id_fk" FOREIGN KEY ("scope_item_id") REFERENCES "public"."scope_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_line_items" ADD CONSTRAINT "budget_line_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "burden_rates" ADD CONSTRAINT "burden_rates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_crm_organisation_id_crm_organisations_id_fk" FOREIGN KEY ("crm_organisation_id") REFERENCES "public"."crm_organisations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_order_approvals" ADD CONSTRAINT "change_order_approvals_change_order_id_change_orders_id_fk" FOREIGN KEY ("change_order_id") REFERENCES "public"."change_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_order_approvals" ADD CONSTRAINT "change_order_approvals_approver_id_users_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_order_attachments" ADD CONSTRAINT "change_order_attachments_change_order_id_change_orders_id_fk" FOREIGN KEY ("change_order_id") REFERENCES "public"."change_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_order_attachments" ADD CONSTRAINT "change_order_attachments_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_order_equipment_entries" ADD CONSTRAINT "change_order_equipment_entries_change_order_id_change_orders_id_fk" FOREIGN KEY ("change_order_id") REFERENCES "public"."change_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_order_labor_entries" ADD CONSTRAINT "change_order_labor_entries_change_order_id_change_orders_id_fk" FOREIGN KEY ("change_order_id") REFERENCES "public"."change_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_order_material_entries" ADD CONSTRAINT "change_order_material_entries_change_order_id_change_orders_id_fk" FOREIGN KEY ("change_order_id") REFERENCES "public"."change_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_order_revisions" ADD CONSTRAINT "change_order_revisions_change_order_id_change_orders_id_fk" FOREIGN KEY ("change_order_id") REFERENCES "public"."change_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_order_revisions" ADD CONSTRAINT "change_order_revisions_revised_by_id_users_id_fk" FOREIGN KEY ("revised_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_linked_tm_ticket_id_tm_tickets_id_fk" FOREIGN KEY ("linked_tm_ticket_id") REFERENCES "public"."tm_tickets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_linked_rfi_id_rfis_id_fk" FOREIGN KEY ("linked_rfi_id") REFERENCES "public"."rfis"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_voided_by_id_users_id_fk" FOREIGN KEY ("voided_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_daily_notes" ADD CONSTRAINT "company_daily_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_daily_notes" ADD CONSTRAINT "company_daily_notes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_report_locks" ADD CONSTRAINT "daily_report_locks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_report_locks" ADD CONSTRAINT "daily_report_locks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_report_locks" ADD CONSTRAINT "daily_report_locks_locked_by_id_users_id_fk" FOREIGN KEY ("locked_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_report_locks" ADD CONSTRAINT "daily_report_locks_supervisor_locked_by_id_users_id_fk" FOREIGN KEY ("supervisor_locked_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_report_locks" ADD CONSTRAINT "daily_report_locks_linked_claim_id_delay_claims_id_fk" FOREIGN KEY ("linked_claim_id") REFERENCES "public"."delay_claims"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_scope_progress" ADD CONSTRAINT "daily_scope_progress_scope_item_id_scope_items_id_fk" FOREIGN KEY ("scope_item_id") REFERENCES "public"."scope_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_scope_progress" ADD CONSTRAINT "daily_scope_progress_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_scope_progress" ADD CONSTRAINT "daily_scope_progress_organization_sow_item_id_organization_sow_items_id_fk" FOREIGN KEY ("organization_sow_item_id") REFERENCES "public"."organization_sow_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_scope_progress" ADD CONSTRAINT "daily_scope_progress_billed_by_id_users_id_fk" FOREIGN KEY ("billed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_scope_progress" ADD CONSTRAINT "daily_scope_progress_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delay_claims" ADD CONSTRAINT "delay_claims_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delay_claims" ADD CONSTRAINT "delay_claims_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delay_claims" ADD CONSTRAINT "delay_claims_submitted_by_id_users_id_fk" FOREIGN KEY ("submitted_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delay_claims" ADD CONSTRAINT "delay_claims_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delay_claims" ADD CONSTRAINT "delay_claims_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delay_claims" ADD CONSTRAINT "delay_claims_rejected_by_id_users_id_fk" FOREIGN KEY ("rejected_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delay_claims" ADD CONSTRAINT "delay_claims_linked_change_order_id_change_orders_id_fk" FOREIGN KEY ("linked_change_order_id") REFERENCES "public"."change_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delay_claims" ADD CONSTRAINT "delay_claims_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delay_notifications" ADD CONSTRAINT "delay_notifications_delay_id_project_delays_id_fk" FOREIGN KEY ("delay_id") REFERENCES "public"."project_delays"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delay_notifications" ADD CONSTRAINT "delay_notifications_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_classifications" ADD CONSTRAINT "employee_classifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_classifications" ADD CONSTRAINT "employee_classifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_classifications" ADD CONSTRAINT "employee_classifications_classification_id_job_classifications_id_fk" FOREIGN KEY ("classification_id") REFERENCES "public"."job_classifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_cost_assignments" ADD CONSTRAINT "employee_cost_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_cost_assignments" ADD CONSTRAINT "employee_cost_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_cost_assignments" ADD CONSTRAINT "employee_cost_assignments_salary_category_id_annual_salary_categories_id_fk" FOREIGN KEY ("salary_category_id") REFERENCES "public"."annual_salary_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_cost_assignments" ADD CONSTRAINT "employee_cost_assignments_burden_rate_id_burden_rates_id_fk" FOREIGN KEY ("burden_rate_id") REFERENCES "public"."burden_rates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimate_line_item_subcontractors" ADD CONSTRAINT "estimate_line_item_subcontractors_line_item_id_estimate_line_items_id_fk" FOREIGN KEY ("line_item_id") REFERENCES "public"."estimate_line_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimate_line_item_subcontractors" ADD CONSTRAINT "estimate_line_item_subcontractors_subcontractor_quote_id_bid_subcontractor_quotes_id_fk" FOREIGN KEY ("subcontractor_quote_id") REFERENCES "public"."bid_subcontractor_quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimate_line_items" ADD CONSTRAINT "estimate_line_items_estimate_id_estimates_id_fk" FOREIGN KEY ("estimate_id") REFERENCES "public"."estimates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimate_line_items" ADD CONSTRAINT "estimate_line_items_source_takeoff_category_id_quantity_categories_id_fk" FOREIGN KEY ("source_takeoff_category_id") REFERENCES "public"."quantity_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimate_line_items" ADD CONSTRAINT "estimate_line_items_scope_work_type_id_scope_work_types_id_fk" FOREIGN KEY ("scope_work_type_id") REFERENCES "public"."scope_work_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimate_line_items" ADD CONSTRAINT "estimate_line_items_subcontractor_quote_id_bid_subcontractor_quotes_id_fk" FOREIGN KEY ("subcontractor_quote_id") REFERENCES "public"."bid_subcontractor_quotes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimate_line_items" ADD CONSTRAINT "estimate_line_items_job_classification_id_job_classifications_id_fk" FOREIGN KEY ("job_classification_id") REFERENCES "public"."job_classifications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimate_line_items" ADD CONSTRAINT "estimate_line_items_organization_sow_item_id_organization_sow_items_id_fk" FOREIGN KEY ("organization_sow_item_id") REFERENCES "public"."organization_sow_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_bid_id_bids_id_fk" FOREIGN KEY ("bid_id") REFERENCES "public"."bids"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_permissions" ADD CONSTRAINT "file_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_permissions" ADD CONSTRAINT "file_permissions_granted_by_id_users_id_fk" FOREIGN KEY ("granted_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_matches" ADD CONSTRAINT "invoice_matches_invoice_id_vendor_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."vendor_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_matches" ADD CONSTRAINT "invoice_matches_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_matches" ADD CONSTRAINT "invoice_matches_receipt_id_po_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."po_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_matches" ADD CONSTRAINT "invoice_matches_resolved_by_id_users_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_invoice_id_vendor_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."vendor_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_classifications" ADD CONSTRAINT "job_classifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employee_id_users_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_channel_prefs" ADD CONSTRAINT "notification_channel_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_type_prefs" ADD CONSTRAINT "notification_type_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_cost_codes" ADD CONSTRAINT "org_cost_codes_deactivated_by_id_users_id_fk" FOREIGN KEY ("deactivated_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_requests" ADD CONSTRAINT "overtime_requests_shift_id_time_clock_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."time_clock_shifts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_requests" ADD CONSTRAINT "overtime_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_requests" ADD CONSTRAINT "overtime_requests_superintendent_id_users_id_fk" FOREIGN KEY ("superintendent_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_notifications" ADD CONSTRAINT "payroll_notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_notifications" ADD CONSTRAINT "payroll_notifications_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_notifications" ADD CONSTRAINT "payroll_notifications_approving_manager_id_users_id_fk" FOREIGN KEY ("approving_manager_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_notifications" ADD CONSTRAINT "payroll_notifications_office_manager_id_users_id_fk" FOREIGN KEY ("office_manager_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_notifications" ADD CONSTRAINT "payroll_notifications_processed_by_id_users_id_fk" FOREIGN KEY ("processed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_custody_records" ADD CONSTRAINT "photo_custody_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_custody_records" ADD CONSTRAINT "photo_custody_records_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_custody_records" ADD CONSTRAINT "photo_custody_records_action_by_id_users_id_fk" FOREIGN KEY ("action_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_custody_records" ADD CONSTRAINT "photo_custody_records_linked_claim_id_delay_claims_id_fk" FOREIGN KEY ("linked_claim_id") REFERENCES "public"."delay_claims"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_custody_records" ADD CONSTRAINT "photo_custody_records_linked_delay_id_project_delays_id_fk" FOREIGN KEY ("linked_delay_id") REFERENCES "public"."project_delays"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_documents" ADD CONSTRAINT "plan_documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_documents" ADD CONSTRAINT "plan_documents_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_receipt_items" ADD CONSTRAINT "po_receipt_items_receipt_id_po_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."po_receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_receipt_items" ADD CONSTRAINT "po_receipt_items_po_item_id_purchase_order_items_id_fk" FOREIGN KEY ("po_item_id") REFERENCES "public"."purchase_order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_receipts" ADD CONSTRAINT "po_receipts_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_receipts" ADD CONSTRAINT "po_receipts_received_by_id_users_id_fk" FOREIGN KEY ("received_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevailing_wage_rates" ADD CONSTRAINT "prevailing_wage_rates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevailing_wage_rates" ADD CONSTRAINT "prevailing_wage_rates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevailing_wage_rates" ADD CONSTRAINT "prevailing_wage_rates_classification_id_job_classifications_id_fk" FOREIGN KEY ("classification_id") REFERENCES "public"."job_classifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_items" ADD CONSTRAINT "procurement_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_delays" ADD CONSTRAINT "project_delays_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_delays" ADD CONSTRAINT "project_delays_linked_change_order_id_change_orders_id_fk" FOREIGN KEY ("linked_change_order_id") REFERENCES "public"."change_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_delays" ADD CONSTRAINT "project_delays_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_delays" ADD CONSTRAINT "project_delays_acknowledged_by_id_users_id_fk" FOREIGN KEY ("acknowledged_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_employee_rates" ADD CONSTRAINT "project_employee_rates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_employee_rates" ADD CONSTRAINT "project_employee_rates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_inspections" ADD CONSTRAINT "project_inspections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_inspections" ADD CONSTRAINT "project_inspections_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_labor_rates" ADD CONSTRAINT "project_labor_rates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_material_budgets" ADD CONSTRAINT "project_material_budgets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_material_budgets" ADD CONSTRAINT "project_material_budgets_scope_item_id_scope_items_id_fk" FOREIGN KEY ("scope_item_id") REFERENCES "public"."scope_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_material_budgets" ADD CONSTRAINT "project_material_budgets_estimate_line_item_id_estimate_line_items_id_fk" FOREIGN KEY ("estimate_line_item_id") REFERENCES "public"."estimate_line_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_material_usage" ADD CONSTRAINT "project_material_usage_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_material_usage" ADD CONSTRAINT "project_material_usage_scope_item_id_scope_items_id_fk" FOREIGN KEY ("scope_item_id") REFERENCES "public"."scope_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_material_usage" ADD CONSTRAINT "project_material_usage_material_budget_id_project_material_budgets_id_fk" FOREIGN KEY ("material_budget_id") REFERENCES "public"."project_material_budgets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_material_usage" ADD CONSTRAINT "project_material_usage_daily_scope_progress_id_daily_scope_progress_id_fk" FOREIGN KEY ("daily_scope_progress_id") REFERENCES "public"."daily_scope_progress"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_material_usage" ADD CONSTRAINT "project_material_usage_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_notes" ADD CONSTRAINT "project_notes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_notes" ADD CONSTRAINT "project_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punch_list_items" ADD CONSTRAINT "punch_list_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punch_list_items" ADD CONSTRAINT "punch_list_items_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punch_list_items" ADD CONSTRAINT "punch_list_items_inspection_id_project_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."project_inspections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punch_list_items" ADD CONSTRAINT "punch_list_items_verified_by_id_users_id_fk" FOREIGN KEY ("verified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punch_list_items" ADD CONSTRAINT "punch_list_items_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_pr_item_id_purchase_request_items_id_fk" FOREIGN KEY ("pr_item_id") REFERENCES "public"."purchase_request_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_pr_id_purchase_requests_id_fk" FOREIGN KEY ("pr_id") REFERENCES "public"."purchase_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_vendor_id_crm_organisations_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."crm_organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_pr_id_purchase_requests_id_fk" FOREIGN KEY ("pr_id") REFERENCES "public"."purchase_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_items" ADD CONSTRAINT "scope_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_items" ADD CONSTRAINT "scope_items_estimate_line_item_id_estimate_line_items_id_fk" FOREIGN KEY ("estimate_line_item_id") REFERENCES "public"."estimate_line_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_items" ADD CONSTRAINT "scope_items_organization_sow_item_id_organization_sow_items_id_fk" FOREIGN KEY ("organization_sow_item_id") REFERENCES "public"."organization_sow_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_items" ADD CONSTRAINT "scope_items_overage_resolved_by_id_users_id_fk" FOREIGN KEY ("overage_resolved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_bid_id_bids_id_fk" FOREIGN KEY ("bid_id") REFERENCES "public"."bids"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_vendor_id_crm_organisations_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."crm_organisations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_to_id_users_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_acknowledged_by_id_users_id_fk" FOREIGN KEY ("acknowledged_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_completed_by_id_users_id_fk" FOREIGN KEY ("completed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_dismissed_by_id_users_id_fk" FOREIGN KEY ("dismissed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_clock_events" ADD CONSTRAINT "time_clock_events_shift_id_time_clock_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."time_clock_shifts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_clock_events" ADD CONSTRAINT "time_clock_events_performed_by_id_users_id_fk" FOREIGN KEY ("performed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_clock_shifts" ADD CONSTRAINT "time_clock_shifts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_clock_shifts" ADD CONSTRAINT "time_clock_shifts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_clock_shifts" ADD CONSTRAINT "time_clock_shifts_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_rejected_by_id_users_id_fk" FOREIGN KEY ("rejected_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tm_daily_sheets" ADD CONSTRAINT "tm_daily_sheets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tm_daily_sheets" ADD CONSTRAINT "tm_daily_sheets_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tm_invoices" ADD CONSTRAINT "tm_invoices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tm_invoices" ADD CONSTRAINT "tm_invoices_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tm_invoices" ADD CONSTRAINT "tm_invoices_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tm_ticket_equipment_entries" ADD CONSTRAINT "tm_ticket_equipment_entries_ticket_id_tm_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tm_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tm_ticket_labor_entries" ADD CONSTRAINT "tm_ticket_labor_entries_ticket_id_tm_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tm_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tm_ticket_material_entries" ADD CONSTRAINT "tm_ticket_material_entries_ticket_id_tm_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tm_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tm_tickets" ADD CONSTRAINT "tm_tickets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tm_tickets" ADD CONSTRAINT "tm_tickets_tfr_representative_id_users_id_fk" FOREIGN KEY ("tfr_representative_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tm_tickets" ADD CONSTRAINT "tm_tickets_organization_sow_item_id_organization_sow_items_id_fk" FOREIGN KEY ("organization_sow_item_id") REFERENCES "public"."organization_sow_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tm_tickets" ADD CONSTRAINT "tm_tickets_work_type_id_scope_work_types_id_fk" FOREIGN KEY ("work_type_id") REFERENCES "public"."scope_work_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tm_tickets" ADD CONSTRAINT "tm_tickets_submitted_by_id_users_id_fk" FOREIGN KEY ("submitted_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tm_tickets" ADD CONSTRAINT "tm_tickets_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tm_tickets" ADD CONSTRAINT "tm_tickets_rejected_by_id_users_id_fk" FOREIGN KEY ("rejected_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tm_tickets" ADD CONSTRAINT "tm_tickets_billing_approved_by_id_users_id_fk" FOREIGN KEY ("billing_approved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tm_tickets" ADD CONSTRAINT "tm_tickets_invoice_id_tm_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."tm_invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tm_tickets" ADD CONSTRAINT "tm_tickets_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_invoice_items" ADD CONSTRAINT "vendor_invoice_items_invoice_id_vendor_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."vendor_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_invoice_items" ADD CONSTRAINT "vendor_invoice_items_po_item_id_purchase_order_items_id_fk" FOREIGN KEY ("po_item_id") REFERENCES "public"."purchase_order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_invoices" ADD CONSTRAINT "vendor_invoices_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_invoices" ADD CONSTRAINT "vendor_invoices_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_invoices" ADD CONSTRAINT "vendor_invoices_vendor_id_crm_organisations_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."crm_organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_cases" ADD CONSTRAINT "warranty_cases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_cases" ADD CONSTRAINT "warranty_cases_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_cases" ADD CONSTRAINT "warranty_cases_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_documents" ADD CONSTRAINT "warranty_documents_case_id_warranty_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."warranty_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_documents" ADD CONSTRAINT "warranty_documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_documents" ADD CONSTRAINT "warranty_documents_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_tasks" ADD CONSTRAINT "warranty_tasks_case_id_warranty_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."warranty_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_tasks" ADD CONSTRAINT "warranty_tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_tasks" ADD CONSTRAINT "warranty_tasks_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_tasks" ADD CONSTRAINT "warranty_tasks_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "active_sessions" ADD CONSTRAINT "active_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addenda" ADD CONSTRAINT "addenda_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addenda" ADD CONSTRAINT "addenda_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addenda" ADD CONSTRAINT "addenda_issued_by_id_users_id_fk" FOREIGN KEY ("issued_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addenda" ADD CONSTRAINT "addenda_related_document_id_plan_documents_id_fk" FOREIGN KEY ("related_document_id") REFERENCES "public"."plan_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addendum_acknowledgments" ADD CONSTRAINT "addendum_acknowledgments_addendum_id_addenda_id_fk" FOREIGN KEY ("addendum_id") REFERENCES "public"."addenda"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_action_audit" ADD CONSTRAINT "ai_action_audit_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_action_audit" ADD CONSTRAINT "ai_action_audit_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_action_audit" ADD CONSTRAINT "ai_action_audit_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_bid_document_analysis" ADD CONSTRAINT "ai_bid_document_analysis_bid_id_bids_id_fk" FOREIGN KEY ("bid_id") REFERENCES "public"."bids"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_bid_document_analysis" ADD CONSTRAINT "ai_bid_document_analysis_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_bid_document_analysis" ADD CONSTRAINT "ai_bid_document_analysis_analyzed_by_id_users_id_fk" FOREIGN KEY ("analyzed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_co_drafts" ADD CONSTRAINT "ai_co_drafts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_co_drafts" ADD CONSTRAINT "ai_co_drafts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_co_drafts" ADD CONSTRAINT "ai_co_drafts_converted_to_co_id_change_orders_id_fk" FOREIGN KEY ("converted_to_co_id") REFERENCES "public"."change_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_co_drafts" ADD CONSTRAINT "ai_co_drafts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_contract_document_analysis" ADD CONSTRAINT "ai_contract_document_analysis_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_contract_document_analysis" ADD CONSTRAINT "ai_contract_document_analysis_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_contract_document_analysis" ADD CONSTRAINT "ai_contract_document_analysis_analyzed_by_id_users_id_fk" FOREIGN KEY ("analyzed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_data_quality" ADD CONSTRAINT "ai_data_quality_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_gantt_recommendations" ADD CONSTRAINT "ai_gantt_recommendations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_gantt_recommendations" ADD CONSTRAINT "ai_gantt_recommendations_insight_id_ai_insights_id_fk" FOREIGN KEY ("insight_id") REFERENCES "public"."ai_insights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_gantt_recommendations" ADD CONSTRAINT "ai_gantt_recommendations_applied_by_id_users_id_fk" FOREIGN KEY ("applied_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_insights" ADD CONSTRAINT "ai_insights_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_insights" ADD CONSTRAINT "ai_insights_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_insights" ADD CONSTRAINT "ai_insights_acknowledged_by_id_users_id_fk" FOREIGN KEY ("acknowledged_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_insights" ADD CONSTRAINT "ai_insights_triggered_by_id_users_id_fk" FOREIGN KEY ("triggered_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_triggered_by_id_users_id_fk" FOREIGN KEY ("triggered_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_takeoff_analyses" ADD CONSTRAINT "ai_takeoff_analyses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_takeoff_analyses" ADD CONSTRAINT "ai_takeoff_analyses_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_takeoff_analyses" ADD CONSTRAINT "ai_takeoff_analyses_takeoff_sheet_id_takeoff_sheets_id_fk" FOREIGN KEY ("takeoff_sheet_id") REFERENCES "public"."takeoff_sheets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_takeoff_analyses" ADD CONSTRAINT "ai_takeoff_analyses_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_tasks" ADD CONSTRAINT "ai_tasks_run_id_ai_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ai_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_tasks" ADD CONSTRAINT "ai_tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_tasks" ADD CONSTRAINT "ai_tasks_assigned_to_id_users_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_vendor_comparisons" ADD CONSTRAINT "ai_vendor_comparisons_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_vendor_comparisons" ADD CONSTRAINT "ai_vendor_comparisons_insight_id_ai_insights_id_fk" FOREIGN KEY ("insight_id") REFERENCES "public"."ai_insights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_approver_user_id_users_id_fk" FOREIGN KEY ("approver_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_logs" ADD CONSTRAINT "attendance_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_logs" ADD CONSTRAINT "attendance_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_logs" ADD CONSTRAINT "attendance_logs_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_document_distributions" ADD CONSTRAINT "bid_document_distributions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_document_distributions" ADD CONSTRAINT "bid_document_distributions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_document_distributions" ADD CONSTRAINT "bid_document_distributions_crm_organisation_id_crm_organisations_id_fk" FOREIGN KEY ("crm_organisation_id") REFERENCES "public"."crm_organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_document_distributions" ADD CONSTRAINT "bid_document_distributions_portal_token_id_subcontractor_portal_tokens_id_fk" FOREIGN KEY ("portal_token_id") REFERENCES "public"."subcontractor_portal_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_document_distributions" ADD CONSTRAINT "bid_document_distributions_sent_by_id_users_id_fk" FOREIGN KEY ("sent_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_equipment_selections" ADD CONSTRAINT "bid_equipment_selections_bid_id_bids_id_fk" FOREIGN KEY ("bid_id") REFERENCES "public"."bids"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_equipment_selections" ADD CONSTRAINT "bid_equipment_selections_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_equipment_selections" ADD CONSTRAINT "bid_equipment_selections_rental_catalog_id_rental_equipment_catalog_id_fk" FOREIGN KEY ("rental_catalog_id") REFERENCES "public"."rental_equipment_catalog"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_equipment_selections" ADD CONSTRAINT "bid_equipment_selections_rental_vendor_id_rental_vendors_id_fk" FOREIGN KEY ("rental_vendor_id") REFERENCES "public"."rental_vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_equipment_selections" ADD CONSTRAINT "bid_equipment_selections_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_modifier_selections" ADD CONSTRAINT "bid_modifier_selections_bid_id_bids_id_fk" FOREIGN KEY ("bid_id") REFERENCES "public"."bids"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_modifier_selections" ADD CONSTRAINT "bid_modifier_selections_estimate_line_item_id_estimate_line_items_id_fk" FOREIGN KEY ("estimate_line_item_id") REFERENCES "public"."estimate_line_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_modifier_selections" ADD CONSTRAINT "bid_modifier_selections_modifier_id_modifiers_id_fk" FOREIGN KEY ("modifier_id") REFERENCES "public"."modifiers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_request_clarifications" ADD CONSTRAINT "bid_request_clarifications_bid_request_id_subcontractor_bid_requests_id_fk" FOREIGN KEY ("bid_request_id") REFERENCES "public"."subcontractor_bid_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_request_clarifications" ADD CONSTRAINT "bid_request_clarifications_asked_by_organization_id_organizations_id_fk" FOREIGN KEY ("asked_by_organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_request_clarifications" ADD CONSTRAINT "bid_request_clarifications_asked_by_user_id_users_id_fk" FOREIGN KEY ("asked_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_request_clarifications" ADD CONSTRAINT "bid_request_clarifications_answered_by_user_id_users_id_fk" FOREIGN KEY ("answered_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bim_extractions" ADD CONSTRAINT "bim_extractions_bid_id_bids_id_fk" FOREIGN KEY ("bid_id") REFERENCES "public"."bids"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bim_extractions" ADD CONSTRAINT "bim_extractions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bim_storey_associations" ADD CONSTRAINT "bim_storey_associations_bid_id_bids_id_fk" FOREIGN KEY ("bid_id") REFERENCES "public"."bids"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bim_storey_associations" ADD CONSTRAINT "bim_storey_associations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bim_storey_associations" ADD CONSTRAINT "bim_storey_associations_sheet_id_takeoff_sheets_id_fk" FOREIGN KEY ("sheet_id") REFERENCES "public"."takeoff_sheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_portal_access" ADD CONSTRAINT "client_portal_access_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_portal_access" ADD CONSTRAINT "client_portal_access_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_portal_access" ADD CONSTRAINT "client_portal_access_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_portal_activity" ADD CONSTRAINT "client_portal_activity_access_id_client_portal_access_id_fk" FOREIGN KEY ("access_id") REFERENCES "public"."client_portal_access"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_portal_activity" ADD CONSTRAINT "client_portal_activity_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_crew_id_crews_id_fk" FOREIGN KEY ("crew_id") REFERENCES "public"."crews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crew_marketplace" ADD CONSTRAINT "crew_marketplace_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crew_marketplace" ADD CONSTRAINT "crew_marketplace_crew_id_crews_id_fk" FOREIGN KEY ("crew_id") REFERENCES "public"."crews"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crew_members" ADD CONSTRAINT "crew_members_crew_id_crews_id_fk" FOREIGN KEY ("crew_id") REFERENCES "public"."crews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crew_members" ADD CONSTRAINT "crew_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crew_project_assignments" ADD CONSTRAINT "crew_project_assignments_crew_id_crews_id_fk" FOREIGN KEY ("crew_id") REFERENCES "public"."crews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crew_project_assignments" ADD CONSTRAINT "crew_project_assignments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crew_project_assignments" ADD CONSTRAINT "crew_project_assignments_assigned_by_id_users_id_fk" FOREIGN KEY ("assigned_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crews" ADD CONSTRAINT "crews_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crews" ADD CONSTRAINT "crews_lead_id_users_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_organisation_id_crm_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."crm_organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_crm_organisation_id_crm_organisations_id_fk" FOREIGN KEY ("crm_organisation_id") REFERENCES "public"."crm_organisations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_contact_id_crm_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."crm_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_assigned_to_id_users_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunity_activities" ADD CONSTRAINT "crm_opportunity_activities_opportunity_id_crm_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."crm_opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunity_activities" ADD CONSTRAINT "crm_opportunity_activities_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_organisation_notes" ADD CONSTRAINT "crm_organisation_notes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_organisation_notes" ADD CONSTRAINT "crm_organisation_notes_organisation_id_crm_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."crm_organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_organisation_notes" ADD CONSTRAINT "crm_organisation_notes_contact_id_crm_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."crm_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_organisation_notes" ADD CONSTRAINT "crm_organisation_notes_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_organisations" ADD CONSTRAINT "crm_organisations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_organisations" ADD CONSTRAINT "crm_organisations_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_libraries" ADD CONSTRAINT "custom_libraries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_processing_records" ADD CONSTRAINT "data_processing_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_revisions" ADD CONSTRAINT "document_revisions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_revisions" ADD CONSTRAINT "document_revisions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_transmittals" ADD CONSTRAINT "document_transmittals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_transmittals" ADD CONSTRAINT "document_transmittals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_transmittals" ADD CONSTRAINT "document_transmittals_sent_by_id_users_id_fk" FOREIGN KEY ("sent_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_accounts" ADD CONSTRAINT "email_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_accounts" ADD CONSTRAINT "email_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_attachments" ADD CONSTRAINT "email_attachments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_attachments" ADD CONSTRAINT "email_attachments_email_message_id_email_messages_id_fk" FOREIGN KEY ("email_message_id") REFERENCES "public"."email_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_email_account_id_email_accounts_id_fk" FOREIGN KEY ("email_account_id") REFERENCES "public"."email_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_thread_id_email_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."email_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_summaries" ADD CONSTRAINT "email_summaries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_summaries" ADD CONSTRAINT "email_summaries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_tasks" ADD CONSTRAINT "email_tasks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_tasks" ADD CONSTRAINT "email_tasks_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_tasks" ADD CONSTRAINT "email_tasks_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_tasks" ADD CONSTRAINT "email_tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_tasks" ADD CONSTRAINT "email_tasks_bid_id_bids_id_fk" FOREIGN KEY ("bid_id") REFERENCES "public"."bids"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_tasks" ADD CONSTRAINT "email_tasks_vendor_id_crm_organisations_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."crm_organisations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_tasks" ADD CONSTRAINT "email_tasks_email_thread_id_email_threads_id_fk" FOREIGN KEY ("email_thread_id") REFERENCES "public"."email_threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_tasks" ADD CONSTRAINT "email_tasks_email_message_id_email_messages_id_fk" FOREIGN KEY ("email_message_id") REFERENCES "public"."email_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_tasks" ADD CONSTRAINT "email_tasks_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_threads" ADD CONSTRAINT "email_threads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_threads" ADD CONSTRAINT "email_threads_email_account_id_email_accounts_id_fk" FOREIGN KEY ("email_account_id") REFERENCES "public"."email_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_threads" ADD CONSTRAINT "email_threads_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_threads" ADD CONSTRAINT "email_threads_bid_id_bids_id_fk" FOREIGN KEY ("bid_id") REFERENCES "public"."bids"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_threads" ADD CONSTRAINT "email_threads_vendor_id_crm_organisations_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."crm_organisations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_performance_profiles" ADD CONSTRAINT "employee_performance_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_performance_profiles" ADD CONSTRAINT "employee_performance_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_ratings" ADD CONSTRAINT "employee_ratings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_ratings" ADD CONSTRAINT "employee_ratings_employee_id_users_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_ratings" ADD CONSTRAINT "employee_ratings_evaluator_id_users_id_fk" FOREIGN KEY ("evaluator_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_ratings" ADD CONSTRAINT "employee_ratings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_assigned_to_crew_id_crews_id_fk" FOREIGN KEY ("assigned_to_crew_id") REFERENCES "public"."crews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_assigned_to_project_id_projects_id_fk" FOREIGN KEY ("assigned_to_project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_assignments" ADD CONSTRAINT "equipment_assignments_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_assignments" ADD CONSTRAINT "equipment_assignments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_assignments" ADD CONSTRAINT "equipment_assignments_assigned_by_id_users_id_fk" FOREIGN KEY ("assigned_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_assignments" ADD CONSTRAINT "equipment_assignments_returned_by_id_users_id_fk" FOREIGN KEY ("returned_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_hour_logs" ADD CONSTRAINT "equipment_hour_logs_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_hour_logs" ADD CONSTRAINT "equipment_hour_logs_assignment_id_equipment_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."equipment_assignments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_hour_logs" ADD CONSTRAINT "equipment_hour_logs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_hour_logs" ADD CONSTRAINT "equipment_hour_logs_submitted_by_id_users_id_fk" FOREIGN KEY ("submitted_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_hour_reminders" ADD CONSTRAINT "equipment_hour_reminders_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_hour_reminders" ADD CONSTRAINT "equipment_hour_reminders_assignment_id_equipment_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."equipment_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_hour_reminders" ADD CONSTRAINT "equipment_hour_reminders_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_hour_reminders" ADD CONSTRAINT "equipment_hour_reminders_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_listings" ADD CONSTRAINT "equipment_listings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_maintenance_history" ADD CONSTRAINT "equipment_maintenance_history_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_maintenance_history" ADD CONSTRAINT "equipment_maintenance_history_schedule_id_equipment_maintenance_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."equipment_maintenance_schedules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_maintenance_history" ADD CONSTRAINT "equipment_maintenance_history_performed_by_id_users_id_fk" FOREIGN KEY ("performed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_maintenance_schedules" ADD CONSTRAINT "equipment_maintenance_schedules_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_rate_profiles" ADD CONSTRAINT "equipment_rate_profiles_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_rate_profiles" ADD CONSTRAINT "equipment_rate_profiles_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_rental_requests" ADD CONSTRAINT "equipment_rental_requests_listing_id_equipment_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."equipment_listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_rental_requests" ADD CONSTRAINT "equipment_rental_requests_requester_org_id_organizations_id_fk" FOREIGN KEY ("requester_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_repairs" ADD CONSTRAINT "equipment_repairs_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_repairs" ADD CONSTRAINT "equipment_repairs_problem_reported_by_id_users_id_fk" FOREIGN KEY ("problem_reported_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_repairs" ADD CONSTRAINT "equipment_repairs_completed_by_id_users_id_fk" FOREIGN KEY ("completed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimate_history" ADD CONSTRAINT "estimate_history_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimate_history" ADD CONSTRAINT "estimate_history_estimate_id_estimates_id_fk" FOREIGN KEY ("estimate_id") REFERENCES "public"."estimates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimate_vendor_quotes" ADD CONSTRAINT "estimate_vendor_quotes_estimate_id_estimates_id_fk" FOREIGN KEY ("estimate_id") REFERENCES "public"."estimates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimate_versions" ADD CONSTRAINT "estimate_versions_estimate_id_estimates_id_fk" FOREIGN KEY ("estimate_id") REFERENCES "public"."estimates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_packets" ADD CONSTRAINT "handoff_packets_bid_id_bids_id_fk" FOREIGN KEY ("bid_id") REFERENCES "public"."bids"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_packets" ADD CONSTRAINT "handoff_packets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_packets" ADD CONSTRAINT "handoff_packets_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_activity_logs" ADD CONSTRAINT "hiring_activity_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_activity_logs" ADD CONSTRAINT "hiring_activity_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_ai_reviews" ADD CONSTRAINT "hiring_ai_reviews_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_ai_reviews" ADD CONSTRAINT "hiring_ai_reviews_candidate_id_hiring_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."hiring_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_candidate_documents" ADD CONSTRAINT "hiring_candidate_documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_candidate_documents" ADD CONSTRAINT "hiring_candidate_documents_candidate_id_hiring_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."hiring_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_candidate_documents" ADD CONSTRAINT "hiring_candidate_documents_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_candidate_notes" ADD CONSTRAINT "hiring_candidate_notes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_candidate_notes" ADD CONSTRAINT "hiring_candidate_notes_candidate_id_hiring_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."hiring_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_candidate_notes" ADD CONSTRAINT "hiring_candidate_notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_candidate_stage_history" ADD CONSTRAINT "hiring_candidate_stage_history_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_candidate_stage_history" ADD CONSTRAINT "hiring_candidate_stage_history_candidate_id_hiring_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."hiring_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_candidate_stage_history" ADD CONSTRAINT "hiring_candidate_stage_history_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_candidates" ADD CONSTRAINT "hiring_candidates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_candidates" ADD CONSTRAINT "hiring_candidates_job_id_hiring_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."hiring_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_candidates" ADD CONSTRAINT "hiring_candidates_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_integrations" ADD CONSTRAINT "hiring_integrations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_interviews" ADD CONSTRAINT "hiring_interviews_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_interviews" ADD CONSTRAINT "hiring_interviews_candidate_id_hiring_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."hiring_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_interviews" ADD CONSTRAINT "hiring_interviews_job_id_hiring_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."hiring_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_interviews" ADD CONSTRAINT "hiring_interviews_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_interviews" ADD CONSTRAINT "hiring_interviews_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_job_templates" ADD CONSTRAINT "hiring_job_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_jobs" ADD CONSTRAINT "hiring_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_jobs" ADD CONSTRAINT "hiring_jobs_assigned_owner_user_id_users_id_fk" FOREIGN KEY ("assigned_owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_jobs" ADD CONSTRAINT "hiring_jobs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_jobs" ADD CONSTRAINT "hiring_jobs_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_pipeline_configs" ADD CONSTRAINT "hiring_pipeline_configs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_pipeline_stages" ADD CONSTRAINT "hiring_pipeline_stages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_sync_logs" ADD CONSTRAINT "hiring_sync_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_sync_logs" ADD CONSTRAINT "hiring_sync_logs_integration_id_hiring_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."hiring_integrations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_tasks" ADD CONSTRAINT "hiring_tasks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_tasks" ADD CONSTRAINT "hiring_tasks_candidate_id_hiring_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."hiring_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_tasks" ADD CONSTRAINT "hiring_tasks_job_id_hiring_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."hiring_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_tasks" ADD CONSTRAINT "hiring_tasks_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_tasks" ADD CONSTRAINT "hiring_tasks_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hustler_delegates" ADD CONSTRAINT "hustler_delegates_hustler_user_id_users_id_fk" FOREIGN KEY ("hustler_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hustler_delegates" ADD CONSTRAINT "hustler_delegates_delegate_user_id_users_id_fk" FOREIGN KEY ("delegate_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hustler_link_requests" ADD CONSTRAINT "hustler_link_requests_hustler_user_id_users_id_fk" FOREIGN KEY ("hustler_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hustler_link_requests" ADD CONSTRAINT "hustler_link_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hustler_link_requests" ADD CONSTRAINT "hustler_link_requests_initiated_by_user_id_users_id_fk" FOREIGN KEY ("initiated_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hustler_link_requests" ADD CONSTRAINT "hustler_link_requests_responded_by_user_id_users_id_fk" FOREIGN KEY ("responded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hustler_organizations" ADD CONSTRAINT "hustler_organizations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hustler_organizations" ADD CONSTRAINT "hustler_organizations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_events_outbox" ADD CONSTRAINT "integration_events_outbox_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_events_outbox" ADD CONSTRAINT "integration_events_outbox_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_state" ADD CONSTRAINT "integration_sync_state_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_state" ADD CONSTRAINT "integration_sync_state_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_webhook_subscriptions" ADD CONSTRAINT "integration_webhook_subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_webhook_subscriptions" ADD CONSTRAINT "integration_webhook_subscriptions_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_captures" ADD CONSTRAINT "issue_captures_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_captures" ADD CONSTRAINT "issue_captures_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_captures" ADD CONSTRAINT "issue_captures_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_captures" ADD CONSTRAINT "issue_captures_assigned_to_id_users_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_captures" ADD CONSTRAINT "issue_captures_resolved_by_id_users_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobsite_analysis_batches" ADD CONSTRAINT "jobsite_analysis_batches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobsite_analysis_batches" ADD CONSTRAINT "jobsite_analysis_batches_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobsite_analysis_batches" ADD CONSTRAINT "jobsite_analysis_batches_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobsite_analysis_photos" ADD CONSTRAINT "jobsite_analysis_photos_batch_id_jobsite_analysis_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."jobsite_analysis_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_assignments" ADD CONSTRAINT "kpi_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_assignments" ADD CONSTRAINT "kpi_assignments_kpi_template_id_kpi_templates_id_fk" FOREIGN KEY ("kpi_template_id") REFERENCES "public"."kpi_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_assignments" ADD CONSTRAINT "kpi_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_assignments" ADD CONSTRAINT "kpi_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_entries" ADD CONSTRAINT "kpi_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_entries" ADD CONSTRAINT "kpi_entries_kpi_assignment_id_kpi_assignments_id_fk" FOREIGN KEY ("kpi_assignment_id") REFERENCES "public"."kpi_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_entries" ADD CONSTRAINT "kpi_entries_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_templates" ADD CONSTRAINT "kpi_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_templates" ADD CONSTRAINT "kpi_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_assemblies" ADD CONSTRAINT "library_assemblies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_assemblies" ADD CONSTRAINT "library_assemblies_library_id_custom_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."custom_libraries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_assembly_item_group_members" ADD CONSTRAINT "library_assembly_item_group_members_group_id_library_assembly_item_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."library_assembly_item_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_assembly_item_group_members" ADD CONSTRAINT "library_assembly_item_group_members_item_id_library_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."library_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_assembly_item_groups" ADD CONSTRAINT "library_assembly_item_groups_assembly_id_library_assemblies_id_fk" FOREIGN KEY ("assembly_id") REFERENCES "public"."library_assemblies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_assembly_items" ADD CONSTRAINT "library_assembly_items_assembly_id_library_assemblies_id_fk" FOREIGN KEY ("assembly_id") REFERENCES "public"."library_assemblies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_assembly_items" ADD CONSTRAINT "library_assembly_items_item_id_library_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."library_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_items" ADD CONSTRAINT "library_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_items" ADD CONSTRAINT "library_items_library_id_custom_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."custom_libraries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lien_waivers" ADD CONSTRAINT "lien_waivers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lien_waivers" ADD CONSTRAINT "lien_waivers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lien_waivers" ADD CONSTRAINT "lien_waivers_sov_id_schedule_of_values_id_fk" FOREIGN KEY ("sov_id") REFERENCES "public"."schedule_of_values"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lien_waivers" ADD CONSTRAINT "lien_waivers_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lien_waivers" ADD CONSTRAINT "lien_waivers_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_reviews" ADD CONSTRAINT "marketplace_reviews_reviewer_org_id_organizations_id_fk" FOREIGN KEY ("reviewer_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_reviews" ADD CONSTRAINT "marketplace_reviews_reviewee_org_id_organizations_id_fk" FOREIGN KEY ("reviewee_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "master_modifiers" ADD CONSTRAINT "master_modifiers_category_id_master_modifier_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."master_modifier_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_calculator_presets" ADD CONSTRAINT "material_calculator_presets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_calculator_presets" ADD CONSTRAINT "material_calculator_presets_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_price_index" ADD CONSTRAINT "material_price_index_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_price_index" ADD CONSTRAINT "material_price_index_source_vendor_id_crm_organisations_id_fk" FOREIGN KEY ("source_vendor_id") REFERENCES "public"."crm_organisations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_price_index" ADD CONSTRAINT "material_price_index_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_read_receipts" ADD CONSTRAINT "message_read_receipts_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_read_receipts" ADD CONSTRAINT "message_read_receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobile_devices" ADD CONSTRAINT "mobile_devices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobile_devices" ADD CONSTRAINT "mobile_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobile_pending_uploads" ADD CONSTRAINT "mobile_pending_uploads_device_id_mobile_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."mobile_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobile_sync_log" ADD CONSTRAINT "mobile_sync_log_device_id_mobile_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."mobile_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modifiers" ADD CONSTRAINT "modifiers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_sync_queue" ADD CONSTRAINT "offline_sync_queue_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_sync_queue" ADD CONSTRAINT "offline_sync_queue_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_color_palettes" ADD CONSTRAINT "org_color_palettes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_calculators" ADD CONSTRAINT "organization_calculators_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_documents" ADD CONSTRAINT "organization_documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_documents" ADD CONSTRAINT "organization_documents_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_network_settings" ADD CONSTRAINT "organization_network_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_social_links" ADD CONSTRAINT "organization_social_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_sow_items" ADD CONSTRAINT "organization_sow_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_website_pages" ADD CONSTRAINT "organization_website_pages_website_id_organization_websites_id_fk" FOREIGN KEY ("website_id") REFERENCES "public"."organization_websites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_website_pages" ADD CONSTRAINT "organization_website_pages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_websites" ADD CONSTRAINT "organization_websites_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_websites" ADD CONSTRAINT "organization_websites_last_published_by_user_id_users_id_fk" FOREIGN KEY ("last_published_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_work_types" ADD CONSTRAINT "organization_work_types_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overhead_cost_history" ADD CONSTRAINT "overhead_cost_history_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overhead_cost_history" ADD CONSTRAINT "overhead_cost_history_performed_by_id_users_id_fk" FOREIGN KEY ("performed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overhead_cost_items" ADD CONSTRAINT "overhead_cost_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_preview_links" ADD CONSTRAINT "page_preview_links_page_id_organization_website_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."organization_website_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_preview_links" ADD CONSTRAINT "page_preview_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_versions" ADD CONSTRAINT "page_versions_page_id_organization_website_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."organization_website_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_versions" ADD CONSTRAINT "page_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey_credentials" ADD CONSTRAINT "passkey_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_activity_log" ADD CONSTRAINT "portal_activity_log_portal_token_id_subcontractor_portal_tokens_id_fk" FOREIGN KEY ("portal_token_id") REFERENCES "public"."subcontractor_portal_tokens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_chat_messages" ADD CONSTRAINT "portal_chat_messages_thread_id_portal_chat_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."portal_chat_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_chat_messages" ADD CONSTRAINT "portal_chat_messages_sender_portal_token_id_subcontractor_portal_tokens_id_fk" FOREIGN KEY ("sender_portal_token_id") REFERENCES "public"."subcontractor_portal_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_chat_messages" ADD CONSTRAINT "portal_chat_messages_sender_client_access_id_client_portal_access_id_fk" FOREIGN KEY ("sender_client_access_id") REFERENCES "public"."client_portal_access"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_chat_messages" ADD CONSTRAINT "portal_chat_messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_chat_threads" ADD CONSTRAINT "portal_chat_threads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_chat_threads" ADD CONSTRAINT "portal_chat_threads_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_chat_threads" ADD CONSTRAINT "portal_chat_threads_portal_token_id_subcontractor_portal_tokens_id_fk" FOREIGN KEY ("portal_token_id") REFERENCES "public"."subcontractor_portal_tokens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_chat_threads" ADD CONSTRAINT "portal_chat_threads_client_portal_access_id_client_portal_access_id_fk" FOREIGN KEY ("client_portal_access_id") REFERENCES "public"."client_portal_access"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricebook_import_jobs" ADD CONSTRAINT "pricebook_import_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricebook_import_jobs" ADD CONSTRAINT "pricebook_import_jobs_crm_organisation_id_crm_organisations_id_fk" FOREIGN KEY ("crm_organisation_id") REFERENCES "public"."crm_organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricebook_import_jobs" ADD CONSTRAINT "pricebook_import_jobs_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_equipment_plans" ADD CONSTRAINT "project_equipment_plans_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_equipment_plans" ADD CONSTRAINT "project_equipment_plans_bid_equipment_selection_id_bid_equipment_selections_id_fk" FOREIGN KEY ("bid_equipment_selection_id") REFERENCES "public"."bid_equipment_selections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_equipment_plans" ADD CONSTRAINT "project_equipment_plans_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_equipment_plans" ADD CONSTRAINT "project_equipment_plans_assignment_id_equipment_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."equipment_assignments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_equipment_plans" ADD CONSTRAINT "project_equipment_plans_rental_catalog_id_rental_equipment_catalog_id_fk" FOREIGN KEY ("rental_catalog_id") REFERENCES "public"."rental_equipment_catalog"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_equipment_plans" ADD CONSTRAINT "project_equipment_plans_rental_vendor_id_rental_vendors_id_fk" FOREIGN KEY ("rental_vendor_id") REFERENCES "public"."rental_vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_equipment_plans" ADD CONSTRAINT "project_equipment_plans_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_health_snapshots" ADD CONSTRAINT "project_health_snapshots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_health_snapshots" ADD CONSTRAINT "project_health_snapshots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_plans" ADD CONSTRAINT "project_plans_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_plans" ADD CONSTRAINT "project_plans_document_id_plan_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."plan_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_profitability_snapshots" ADD CONSTRAINT "project_profitability_snapshots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_profitability_snapshots" ADD CONSTRAINT "project_profitability_snapshots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_schedule_tasks" ADD CONSTRAINT "project_schedule_tasks_schedule_id_project_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."project_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_schedule_tasks" ADD CONSTRAINT "project_schedule_tasks_parent_task_id_project_schedule_tasks_id_fk" FOREIGN KEY ("parent_task_id") REFERENCES "public"."project_schedule_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_schedule_tasks" ADD CONSTRAINT "project_schedule_tasks_crew_id_crews_id_fk" FOREIGN KEY ("crew_id") REFERENCES "public"."crews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_schedule_tasks" ADD CONSTRAINT "project_schedule_tasks_inspection_id_project_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."project_inspections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_schedules" ADD CONSTRAINT "project_schedules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_schedules" ADD CONSTRAINT "project_schedules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_schedules" ADD CONSTRAINT "project_schedules_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_spec_index" ADD CONSTRAINT "project_spec_index_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_specs" ADD CONSTRAINT "project_specs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qbo_account_mappings" ADD CONSTRAINT "qbo_account_mappings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qbo_account_mappings" ADD CONSTRAINT "qbo_account_mappings_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qbo_sync_schedules" ADD CONSTRAINT "qbo_sync_schedules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qbo_sync_schedules" ADD CONSTRAINT "qbo_sync_schedules_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_issues" ADD CONSTRAINT "quality_issues_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_issues" ADD CONSTRAINT "quality_issues_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_issues" ADD CONSTRAINT "quality_issues_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quantity_categories" ADD CONSTRAINT "quantity_categories_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quantity_categories" ADD CONSTRAINT "quantity_categories_bid_id_bids_id_fk" FOREIGN KEY ("bid_id") REFERENCES "public"."bids"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_criteria" ADD CONSTRAINT "rating_criteria_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_criteria" ADD CONSTRAINT "rating_criteria_kpi_template_id_kpi_templates_id_fk" FOREIGN KEY ("kpi_template_id") REFERENCES "public"."kpi_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_scores" ADD CONSTRAINT "rating_scores_rating_id_employee_ratings_id_fk" FOREIGN KEY ("rating_id") REFERENCES "public"."employee_ratings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_scores" ADD CONSTRAINT "rating_scores_criteria_id_rating_criteria_id_fk" FOREIGN KEY ("criteria_id") REFERENCES "public"."rating_criteria"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_equipment_catalog" ADD CONSTRAINT "rental_equipment_catalog_vendor_id_rental_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."rental_vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_equipment_catalog" ADD CONSTRAINT "rental_equipment_catalog_crm_organisation_id_crm_organisations_id_fk" FOREIGN KEY ("crm_organisation_id") REFERENCES "public"."crm_organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_equipment_usages" ADD CONSTRAINT "rental_equipment_usages_project_equipment_plan_id_project_equipment_plans_id_fk" FOREIGN KEY ("project_equipment_plan_id") REFERENCES "public"."project_equipment_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_equipment_usages" ADD CONSTRAINT "rental_equipment_usages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_equipment_usages" ADD CONSTRAINT "rental_equipment_usages_vendor_id_rental_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."rental_vendors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_equipment_usages" ADD CONSTRAINT "rental_equipment_usages_rental_catalog_id_rental_equipment_catalog_id_fk" FOREIGN KEY ("rental_catalog_id") REFERENCES "public"."rental_equipment_catalog"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_equipment_usages" ADD CONSTRAINT "rental_equipment_usages_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_vendors" ADD CONSTRAINT "rental_vendors_crm_organisation_id_crm_organisations_id_fk" FOREIGN KEY ("crm_organisation_id") REFERENCES "public"."crm_organisations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_policies" ADD CONSTRAINT "retention_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_assignments" ADD CONSTRAINT "reward_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_assignments" ADD CONSTRAINT "reward_assignments_employee_id_users_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_assignments" ADD CONSTRAINT "reward_assignments_reward_type_id_reward_types_id_fk" FOREIGN KEY ("reward_type_id") REFERENCES "public"."reward_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_assignments" ADD CONSTRAINT "reward_assignments_assigned_by_id_users_id_fk" FOREIGN KEY ("assigned_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_assignments" ADD CONSTRAINT "reward_assignments_rating_id_employee_ratings_id_fk" FOREIGN KEY ("rating_id") REFERENCES "public"."employee_ratings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_types" ADD CONSTRAINT "reward_types_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfi_activity" ADD CONSTRAINT "rfi_activity_rfi_id_rfis_id_fk" FOREIGN KEY ("rfi_id") REFERENCES "public"."rfis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfi_activity" ADD CONSTRAINT "rfi_activity_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfi_attachments" ADD CONSTRAINT "rfi_attachments_rfi_id_rfis_id_fk" FOREIGN KEY ("rfi_id") REFERENCES "public"."rfis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfi_attachments" ADD CONSTRAINT "rfi_attachments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfi_attachments" ADD CONSTRAINT "rfi_attachments_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfis" ADD CONSTRAINT "rfis_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfis" ADD CONSTRAINT "rfis_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfis" ADD CONSTRAINT "rfis_contract_id_subcontractor_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."subcontractor_contracts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfis" ADD CONSTRAINT "rfis_submitted_by_id_users_id_fk" FOREIGN KEY ("submitted_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfis" ADD CONSTRAINT "rfis_subcontractor_id_crm_organisations_id_fk" FOREIGN KEY ("subcontractor_id") REFERENCES "public"."crm_organisations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfis" ADD CONSTRAINT "rfis_assigned_to_id_users_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfis" ADD CONSTRAINT "rfis_answered_by_id_users_id_fk" FOREIGN KEY ("answered_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfis" ADD CONSTRAINT "rfis_linked_change_order_id_change_orders_id_fk" FOREIGN KEY ("linked_change_order_id") REFERENCES "public"."change_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfis" ADD CONSTRAINT "rfis_linked_tm_ticket_id_tm_tickets_id_fk" FOREIGN KEY ("linked_tm_ticket_id") REFERENCES "public"."tm_tickets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfis" ADD CONSTRAINT "rfis_linked_submittal_id_submittals_id_fk" FOREIGN KEY ("linked_submittal_id") REFERENCES "public"."submittals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfis" ADD CONSTRAINT "rfis_forwarded_to_id_users_id_fk" FOREIGN KEY ("forwarded_to_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfis" ADD CONSTRAINT "rfis_closed_by_id_users_id_fk" FOREIGN KEY ("closed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_incidents" ADD CONSTRAINT "safety_incidents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_incidents" ADD CONSTRAINT "safety_incidents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_incidents" ADD CONSTRAINT "safety_incidents_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_training_assignments" ADD CONSTRAINT "safety_training_assignments_training_id_safety_trainings_id_fk" FOREIGN KEY ("training_id") REFERENCES "public"."safety_trainings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_training_assignments" ADD CONSTRAINT "safety_training_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_training_assignments" ADD CONSTRAINT "safety_training_assignments_employee_id_users_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_training_assignments" ADD CONSTRAINT "safety_training_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_trainings" ADD CONSTRAINT "safety_trainings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_trainings" ADD CONSTRAINT "safety_trainings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_takeoffs" ADD CONSTRAINT "saved_takeoffs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_takeoffs" ADD CONSTRAINT "saved_takeoffs_library_id_custom_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."custom_libraries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_of_values" ADD CONSTRAINT "schedule_of_values_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_of_values" ADD CONSTRAINT "schedule_of_values_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_of_values" ADD CONSTRAINT "schedule_of_values_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_of_values" ADD CONSTRAINT "schedule_of_values_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_modifiers" ADD CONSTRAINT "scope_modifiers_category_id_scope_modifier_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."scope_modifier_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_work_types" ADD CONSTRAINT "scope_work_types_category_id_scope_work_type_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."scope_work_type_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_verification_requests" ADD CONSTRAINT "skill_verification_requests_user_skill_id_user_skills_id_fk" FOREIGN KEY ("user_skill_id") REFERENCES "public"."user_skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_verification_requests" ADD CONSTRAINT "skill_verification_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_verification_requests" ADD CONSTRAINT "skill_verification_requests_requested_to_user_id_users_id_fk" FOREIGN KEY ("requested_to_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_connected_by_id_users_id_fk" FOREIGN KEY ("connected_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_media_posts" ADD CONSTRAINT "social_media_posts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_media_posts" ADD CONSTRAINT "social_media_posts_social_account_id_social_accounts_id_fk" FOREIGN KEY ("social_account_id") REFERENCES "public"."social_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_media_posts" ADD CONSTRAINT "social_media_posts_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_media_posts" ADD CONSTRAINT "social_media_posts_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_post_analytics" ADD CONSTRAINT "social_post_analytics_post_id_social_media_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."social_media_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_post_history" ADD CONSTRAINT "social_post_history_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_post_history" ADD CONSTRAINT "social_post_history_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sov_line_items" ADD CONSTRAINT "sov_line_items_sov_id_schedule_of_values_id_fk" FOREIGN KEY ("sov_id") REFERENCES "public"."schedule_of_values"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sov_line_items" ADD CONSTRAINT "sov_line_items_estimate_line_item_id_estimate_line_items_id_fk" FOREIGN KEY ("estimate_line_item_id") REFERENCES "public"."estimate_line_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sov_line_items" ADD CONSTRAINT "sov_line_items_linked_change_order_id_change_orders_id_fk" FOREIGN KEY ("linked_change_order_id") REFERENCES "public"."change_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sov_line_items" ADD CONSTRAINT "sov_line_items_organization_sow_item_id_organization_sow_items_id_fk" FOREIGN KEY ("organization_sow_item_id") REFERENCES "public"."organization_sow_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sov_payments" ADD CONSTRAINT "sov_payments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sov_payments" ADD CONSTRAINT "sov_payments_sov_id_schedule_of_values_id_fk" FOREIGN KEY ("sov_id") REFERENCES "public"."schedule_of_values"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sov_payments" ADD CONSTRAINT "sov_payments_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sow_audit_log" ADD CONSTRAINT "sow_audit_log_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sow_audit_log" ADD CONSTRAINT "sow_audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sso_configurations" ADD CONSTRAINT "sso_configurations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontractor_bid_invitations" ADD CONSTRAINT "subcontractor_bid_invitations_bid_request_id_subcontractor_bid_requests_id_fk" FOREIGN KEY ("bid_request_id") REFERENCES "public"."subcontractor_bid_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontractor_bid_invitations" ADD CONSTRAINT "subcontractor_bid_invitations_invited_organization_id_organizations_id_fk" FOREIGN KEY ("invited_organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontractor_bid_invitations" ADD CONSTRAINT "subcontractor_bid_invitations_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontractor_bid_requests" ADD CONSTRAINT "subcontractor_bid_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontractor_bid_requests" ADD CONSTRAINT "subcontractor_bid_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontractor_bid_requests" ADD CONSTRAINT "subcontractor_bid_requests_bid_id_bids_id_fk" FOREIGN KEY ("bid_id") REFERENCES "public"."bids"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontractor_bid_requests" ADD CONSTRAINT "subcontractor_bid_requests_awarded_to_organization_id_organizations_id_fk" FOREIGN KEY ("awarded_to_organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontractor_bid_requests" ADD CONSTRAINT "subcontractor_bid_requests_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontractor_bid_responses" ADD CONSTRAINT "subcontractor_bid_responses_invitation_id_subcontractor_bid_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."subcontractor_bid_invitations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontractor_bid_responses" ADD CONSTRAINT "subcontractor_bid_responses_bid_request_id_subcontractor_bid_requests_id_fk" FOREIGN KEY ("bid_request_id") REFERENCES "public"."subcontractor_bid_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontractor_bid_responses" ADD CONSTRAINT "subcontractor_bid_responses_responding_organization_id_organizations_id_fk" FOREIGN KEY ("responding_organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontractor_bid_responses" ADD CONSTRAINT "subcontractor_bid_responses_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontractor_bid_responses" ADD CONSTRAINT "subcontractor_bid_responses_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontractor_billing_schedule" ADD CONSTRAINT "subcontractor_billing_schedule_contract_id_subcontractor_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."subcontractor_contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontractor_contracts" ADD CONSTRAINT "subcontractor_contracts_subcontractor_id_crm_organisations_id_fk" FOREIGN KEY ("subcontractor_id") REFERENCES "public"."crm_organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontractor_contracts" ADD CONSTRAINT "subcontractor_contracts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontractor_contracts" ADD CONSTRAINT "subcontractor_contracts_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontractor_payments" ADD CONSTRAINT "subcontractor_payments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontractor_payments" ADD CONSTRAINT "subcontractor_payments_contract_id_subcontractor_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."subcontractor_contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontractor_payments" ADD CONSTRAINT "subcontractor_payments_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontractor_payments" ADD CONSTRAINT "subcontractor_payments_rejected_by_id_users_id_fk" FOREIGN KEY ("rejected_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontractor_payments" ADD CONSTRAINT "subcontractor_payments_paid_by_id_users_id_fk" FOREIGN KEY ("paid_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontractor_payments" ADD CONSTRAINT "subcontractor_payments_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontractor_portal_tokens" ADD CONSTRAINT "subcontractor_portal_tokens_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontractor_portal_tokens" ADD CONSTRAINT "subcontractor_portal_tokens_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontractor_portal_tokens" ADD CONSTRAINT "subcontractor_portal_tokens_crm_organisation_id_crm_organisations_id_fk" FOREIGN KEY ("crm_organisation_id") REFERENCES "public"."crm_organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcontractor_portal_tokens" ADD CONSTRAINT "subcontractor_portal_tokens_invited_by_id_users_id_fk" FOREIGN KEY ("invited_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submittal_activity" ADD CONSTRAINT "submittal_activity_submittal_id_submittals_id_fk" FOREIGN KEY ("submittal_id") REFERENCES "public"."submittals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submittal_activity" ADD CONSTRAINT "submittal_activity_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submittal_attachments" ADD CONSTRAINT "submittal_attachments_submittal_id_submittals_id_fk" FOREIGN KEY ("submittal_id") REFERENCES "public"."submittals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submittal_attachments" ADD CONSTRAINT "submittal_attachments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submittal_attachments" ADD CONSTRAINT "submittal_attachments_submittal_item_id_submittal_items_id_fk" FOREIGN KEY ("submittal_item_id") REFERENCES "public"."submittal_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submittal_attachments" ADD CONSTRAINT "submittal_attachments_submittal_review_id_submittal_reviews_id_fk" FOREIGN KEY ("submittal_review_id") REFERENCES "public"."submittal_reviews"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submittal_attachments" ADD CONSTRAINT "submittal_attachments_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submittal_items" ADD CONSTRAINT "submittal_items_submittal_id_submittals_id_fk" FOREIGN KEY ("submittal_id") REFERENCES "public"."submittals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submittal_items" ADD CONSTRAINT "submittal_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submittal_reviews" ADD CONSTRAINT "submittal_reviews_submittal_id_submittals_id_fk" FOREIGN KEY ("submittal_id") REFERENCES "public"."submittals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submittal_reviews" ADD CONSTRAINT "submittal_reviews_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submittal_reviews" ADD CONSTRAINT "submittal_reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submittals" ADD CONSTRAINT "submittals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submittals" ADD CONSTRAINT "submittals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submittals" ADD CONSTRAINT "submittals_contract_id_subcontractor_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."subcontractor_contracts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submittals" ADD CONSTRAINT "submittals_subcontractor_id_crm_organisations_id_fk" FOREIGN KEY ("subcontractor_id") REFERENCES "public"."crm_organisations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submittals" ADD CONSTRAINT "submittals_submitted_by_id_users_id_fk" FOREIGN KEY ("submitted_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submittals" ADD CONSTRAINT "submittals_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submittals" ADD CONSTRAINT "submittals_linked_rfi_id_rfis_id_fk" FOREIGN KEY ("linked_rfi_id") REFERENCES "public"."rfis"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supervisor_notes" ADD CONSTRAINT "supervisor_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supervisor_notes" ADD CONSTRAINT "supervisor_notes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supervisor_notes" ADD CONSTRAINT "supervisor_notes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takeoff_assemblies" ADD CONSTRAINT "takeoff_assemblies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takeoff_assembly_items" ADD CONSTRAINT "takeoff_assembly_items_assembly_id_takeoff_assemblies_id_fk" FOREIGN KEY ("assembly_id") REFERENCES "public"."takeoff_assemblies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takeoff_conditions" ADD CONSTRAINT "takeoff_conditions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takeoff_issue_comments" ADD CONSTRAINT "takeoff_issue_comments_issue_id_takeoff_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."takeoff_issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takeoff_issue_comments" ADD CONSTRAINT "takeoff_issue_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takeoff_issues" ADD CONSTRAINT "takeoff_issues_sheet_id_takeoff_sheets_id_fk" FOREIGN KEY ("sheet_id") REFERENCES "public"."takeoff_sheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takeoff_issues" ADD CONSTRAINT "takeoff_issues_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takeoff_issues" ADD CONSTRAINT "takeoff_issues_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takeoff_issues" ADD CONSTRAINT "takeoff_issues_category_id_quantity_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."quantity_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takeoff_issues" ADD CONSTRAINT "takeoff_issues_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takeoff_markups" ADD CONSTRAINT "takeoff_markups_sheet_id_takeoff_sheets_id_fk" FOREIGN KEY ("sheet_id") REFERENCES "public"."takeoff_sheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takeoff_markups" ADD CONSTRAINT "takeoff_markups_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takeoff_markups" ADD CONSTRAINT "takeoff_markups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takeoff_markups" ADD CONSTRAINT "takeoff_markups_category_id_quantity_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."quantity_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takeoff_measurement_assemblies" ADD CONSTRAINT "takeoff_measurement_assemblies_measurement_id_takeoff_measurements_id_fk" FOREIGN KEY ("measurement_id") REFERENCES "public"."takeoff_measurements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takeoff_measurement_assemblies" ADD CONSTRAINT "takeoff_measurement_assemblies_assembly_id_takeoff_assemblies_id_fk" FOREIGN KEY ("assembly_id") REFERENCES "public"."takeoff_assemblies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takeoff_measurement_groups" ADD CONSTRAINT "takeoff_measurement_groups_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takeoff_measurement_groups" ADD CONSTRAINT "takeoff_measurement_groups_bid_id_bids_id_fk" FOREIGN KEY ("bid_id") REFERENCES "public"."bids"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takeoff_measurement_groups" ADD CONSTRAINT "takeoff_measurement_groups_sheet_id_takeoff_sheets_id_fk" FOREIGN KEY ("sheet_id") REFERENCES "public"."takeoff_sheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takeoff_measurements" ADD CONSTRAINT "takeoff_measurements_sheet_id_takeoff_sheets_id_fk" FOREIGN KEY ("sheet_id") REFERENCES "public"."takeoff_sheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takeoff_measurements" ADD CONSTRAINT "takeoff_measurements_category_id_quantity_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."quantity_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takeoff_measurements" ADD CONSTRAINT "takeoff_measurements_group_id_takeoff_measurement_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."takeoff_measurement_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takeoff_sheet_links" ADD CONSTRAINT "takeoff_sheet_links_source_sheet_id_takeoff_sheets_id_fk" FOREIGN KEY ("source_sheet_id") REFERENCES "public"."takeoff_sheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takeoff_sheet_links" ADD CONSTRAINT "takeoff_sheet_links_target_sheet_id_takeoff_sheets_id_fk" FOREIGN KEY ("target_sheet_id") REFERENCES "public"."takeoff_sheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takeoff_sheets" ADD CONSTRAINT "takeoff_sheets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takeoff_sheets" ADD CONSTRAINT "takeoff_sheets_bid_id_bids_id_fk" FOREIGN KEY ("bid_id") REFERENCES "public"."bids"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takeoff_sheets" ADD CONSTRAINT "takeoff_sheets_plan_id_project_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."project_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_profiles" ADD CONSTRAINT "talent_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_profiles" ADD CONSTRAINT "talent_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmittal_recipients" ADD CONSTRAINT "transmittal_recipients_transmittal_id_document_transmittals_id_fk" FOREIGN KEY ("transmittal_id") REFERENCES "public"."document_transmittals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmittal_recipients" ADD CONSTRAINT "transmittal_recipients_subcontractor_id_crm_organisations_id_fk" FOREIGN KEY ("subcontractor_id") REFERENCES "public"."crm_organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmittal_recipients" ADD CONSTRAINT "transmittal_recipients_acknowledged_by_id_users_id_fk" FOREIGN KEY ("acknowledged_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_certifications" ADD CONSTRAINT "user_certifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_color_palettes" ADD CONSTRAINT "user_color_palettes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_color_palettes" ADD CONSTRAINT "user_color_palettes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_dashboard_layouts" ADD CONSTRAINT "user_dashboard_layouts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_dashboard_layouts" ADD CONSTRAINT "user_dashboard_layouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_dashboard_permissions" ADD CONSTRAINT "user_dashboard_permissions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_dashboard_permissions" ADD CONSTRAINT "user_dashboard_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_dashboard_permissions" ADD CONSTRAINT "user_dashboard_permissions_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_equipment_competencies" ADD CONSTRAINT "user_equipment_competencies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_photos" ADD CONSTRAINT "user_photos_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_skills" ADD CONSTRAINT "user_skills_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_skills" ADD CONSTRAINT "user_skills_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_enrollments" ADD CONSTRAINT "vendor_enrollments_vendor_crm_org_id_crm_organisations_id_fk" FOREIGN KEY ("vendor_crm_org_id") REFERENCES "public"."crm_organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_enrollments" ADD CONSTRAINT "vendor_enrollments_contractor_org_id_organizations_id_fk" FOREIGN KEY ("contractor_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_enrollments" ADD CONSTRAINT "vendor_enrollments_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_price_history" ADD CONSTRAINT "vendor_price_history_pricebook_item_id_vendor_pricebook_items_id_fk" FOREIGN KEY ("pricebook_item_id") REFERENCES "public"."vendor_pricebook_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_pricebook_items" ADD CONSTRAINT "vendor_pricebook_items_pricebook_id_vendor_pricebooks_id_fk" FOREIGN KEY ("pricebook_id") REFERENCES "public"."vendor_pricebooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_pricebook_items" ADD CONSTRAINT "vendor_pricebook_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_pricebook_items" ADD CONSTRAINT "vendor_pricebook_items_vendor_id_crm_organisations_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."crm_organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_pricebook_items" ADD CONSTRAINT "vendor_pricebook_items_sow_item_id_organization_sow_items_id_fk" FOREIGN KEY ("sow_item_id") REFERENCES "public"."organization_sow_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_pricebooks" ADD CONSTRAINT "vendor_pricebooks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_pricebooks" ADD CONSTRAINT "vendor_pricebooks_vendor_id_crm_organisations_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."crm_organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_pricebooks" ADD CONSTRAINT "vendor_pricebooks_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_pricing_catalogs" ADD CONSTRAINT "vendor_pricing_catalogs_crm_organisation_id_crm_organisations_id_fk" FOREIGN KEY ("crm_organisation_id") REFERENCES "public"."crm_organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_pricing_catalogs" ADD CONSTRAINT "vendor_pricing_catalogs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_pricing_catalogs" ADD CONSTRAINT "vendor_pricing_catalogs_submitted_by_vendor_user_id_users_id_fk" FOREIGN KEY ("submitted_by_vendor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_pricing_catalogs" ADD CONSTRAINT "vendor_pricing_catalogs_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_pricing_catalogs" ADD CONSTRAINT "vendor_pricing_catalogs_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_scores" ADD CONSTRAINT "vendor_scores_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_scores" ADD CONSTRAINT "vendor_scores_crm_entity_id_crm_organisations_id_fk" FOREIGN KEY ("crm_entity_id") REFERENCES "public"."crm_organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_scores" ADD CONSTRAINT "vendor_scores_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_scores" ADD CONSTRAINT "vendor_scores_scored_by_id_users_id_fk" FOREIGN KEY ("scored_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_users" ADD CONSTRAINT "vendor_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_users" ADD CONSTRAINT "vendor_users_crm_organisation_id_crm_organisations_id_fk" FOREIGN KEY ("crm_organisation_id") REFERENCES "public"."crm_organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_logs" ADD CONSTRAINT "voice_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_logs" ADD CONSTRAINT "voice_logs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_logs" ADD CONSTRAINT "voice_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_analytics_daily" ADD CONSTRAINT "website_analytics_daily_website_id_organization_websites_id_fk" FOREIGN KEY ("website_id") REFERENCES "public"."organization_websites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_analytics_daily" ADD CONSTRAINT "website_analytics_daily_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_analytics_events" ADD CONSTRAINT "website_analytics_events_website_id_organization_websites_id_fk" FOREIGN KEY ("website_id") REFERENCES "public"."organization_websites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_blog_comments" ADD CONSTRAINT "website_blog_comments_post_id_website_blog_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."website_blog_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_blog_comments" ADD CONSTRAINT "website_blog_comments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_blog_comments" ADD CONSTRAINT "website_blog_comments_moderated_by_id_users_id_fk" FOREIGN KEY ("moderated_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_blog_posts" ADD CONSTRAINT "website_blog_posts_website_id_organization_websites_id_fk" FOREIGN KEY ("website_id") REFERENCES "public"."organization_websites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_blog_posts" ADD CONSTRAINT "website_blog_posts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_blog_posts" ADD CONSTRAINT "website_blog_posts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_contact_submissions" ADD CONSTRAINT "website_contact_submissions_website_id_organization_websites_id_fk" FOREIGN KEY ("website_id") REFERENCES "public"."organization_websites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_contact_submissions" ADD CONSTRAINT "website_contact_submissions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_contact_submissions" ADD CONSTRAINT "website_contact_submissions_crm_organisation_id_crm_organisations_id_fk" FOREIGN KEY ("crm_organisation_id") REFERENCES "public"."crm_organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_contact_submissions" ADD CONSTRAINT "website_contact_submissions_crm_contact_id_crm_contacts_id_fk" FOREIGN KEY ("crm_contact_id") REFERENCES "public"."crm_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_deployments" ADD CONSTRAINT "website_deployments_website_id_organization_websites_id_fk" FOREIGN KEY ("website_id") REFERENCES "public"."organization_websites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_deployments" ADD CONSTRAINT "website_deployments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_deployments" ADD CONSTRAINT "website_deployments_performed_by_user_id_users_id_fk" FOREIGN KEY ("performed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_project_images" ADD CONSTRAINT "website_project_images_project_id_website_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."website_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_projects" ADD CONSTRAINT "website_projects_website_id_organization_websites_id_fk" FOREIGN KEY ("website_id") REFERENCES "public"."organization_websites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_projects" ADD CONSTRAINT "website_projects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_projects" ADD CONSTRAINT "website_projects_linked_project_id_projects_id_fk" FOREIGN KEY ("linked_project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_logs" ADD CONSTRAINT "worker_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_logs" ADD CONSTRAINT "worker_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_logs" ADD CONSTRAINT "worker_logs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zapier_webhooks" ADD CONSTRAINT "zapier_webhooks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zapier_webhooks" ADD CONSTRAINT "zapier_webhooks_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bids_status_idx" ON "bids" USING btree ("status");--> statement-breakpoint
CREATE INDEX "bids_gc_org_id_idx" ON "bids" USING btree ("gc_organization_id");--> statement-breakpoint
CREATE INDEX "employee_deductions_org_idx" ON "employee_deductions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "employee_deductions_user_idx" ON "employee_deductions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "employee_deductions_type_idx" ON "employee_deductions" USING btree ("deduction_type_id");--> statement-breakpoint
CREATE INDEX "org_addons_org_id_idx" ON "organization_addons" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "org_payroll_settings_org_id_idx" ON "organization_payroll_settings" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "org_subscriptions_org_id_idx" ON "organization_subscriptions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "org_usage_org_id_idx" ON "organization_usage" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "org_usage_period_idx" ON "organization_usage" USING btree ("period_start","period_end");--> statement-breakpoint
CREATE INDEX "pay_run_line_items_pay_run_idx" ON "pay_run_line_items" USING btree ("pay_run_id");--> statement-breakpoint
CREATE INDEX "pay_run_line_items_user_idx" ON "pay_run_line_items" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "pay_run_line_items_project_idx" ON "pay_run_line_items" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "pay_runs_org_idx" ON "pay_runs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "pay_runs_status_idx" ON "pay_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "pay_runs_period_idx" ON "pay_runs" USING btree ("pay_period_start","pay_period_end");--> statement-breakpoint
CREATE INDEX "pay_stub_deductions_line_item_idx" ON "pay_stub_deductions" USING btree ("pay_run_line_item_id");--> statement-breakpoint
CREATE INDEX "pay_stub_deductions_type_idx" ON "pay_stub_deductions" USING btree ("deduction_type_id");--> statement-breakpoint
CREATE INDEX "payroll_deduction_types_org_idx" ON "payroll_deduction_types" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "projects_status_idx" ON "projects" USING btree ("status");--> statement-breakpoint
CREATE INDEX "projects_gc_org_id_idx" ON "projects" USING btree ("gc_organization_id");--> statement-breakpoint
CREATE INDEX "subscription_events_org_id_idx" ON "subscription_events" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "subscription_events_event_type_idx" ON "subscription_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "subscription_events_created_at_idx" ON "subscription_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "users_organization_id_idx" ON "users" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "users_active_role_idx" ON "users" USING btree ("is_active","role");--> statement-breakpoint
CREATE INDEX "weekly_payroll_reports_org_id_idx" ON "weekly_payroll_reports" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "weekly_payroll_reports_week_idx" ON "weekly_payroll_reports" USING btree ("week_start_date","week_end_date");--> statement-breakpoint
CREATE INDEX "ai_note_insights_run_id_idx" ON "ai_note_insights" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "ai_note_insights_project_id_idx" ON "ai_note_insights" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ai_note_insights_category_idx" ON "ai_note_insights" USING btree ("category");--> statement-breakpoint
CREATE INDEX "ai_note_insights_severity_idx" ON "ai_note_insights" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "ai_note_insights_status_idx" ON "ai_note_insights" USING btree ("status");--> statement-breakpoint
CREATE INDEX "audit_log_entity_type_idx" ON "audit_log" USING btree ("entity_type");--> statement-breakpoint
CREATE INDEX "audit_log_entity_id_idx" ON "audit_log" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_user_id_idx" ON "audit_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_log_created_at_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "budget_line_items_project_idx" ON "budget_line_items" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "calendar_events_event_type_idx" ON "calendar_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "calendar_events_user_id_idx" ON "calendar_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "calendar_events_crm_org_idx" ON "calendar_events" USING btree ("crm_organisation_id");--> statement-breakpoint
CREATE INDEX "change_order_approvals_co_id_idx" ON "change_order_approvals" USING btree ("change_order_id");--> statement-breakpoint
CREATE INDEX "change_order_approvals_status_idx" ON "change_order_approvals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "co_attachments_co_id_idx" ON "change_order_attachments" USING btree ("change_order_id");--> statement-breakpoint
CREATE INDEX "co_attachments_org_id_idx" ON "change_order_attachments" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "change_order_revisions_co_id_idx" ON "change_order_revisions" USING btree ("change_order_id");--> statement-breakpoint
CREATE INDEX "change_orders_status_idx" ON "change_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "change_orders_project_id_idx" ON "change_orders" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "change_orders_work_type_code_idx" ON "change_orders" USING btree ("work_type_code");--> statement-breakpoint
CREATE INDEX "company_daily_notes_author_id_idx" ON "company_daily_notes" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "company_daily_notes_project_id_idx" ON "company_daily_notes" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "company_daily_notes_created_at_idx" ON "company_daily_notes" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "daily_report_locks_org_idx" ON "daily_report_locks" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "daily_report_locks_project_idx" ON "daily_report_locks" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "daily_report_locks_date_idx" ON "daily_report_locks" USING btree ("report_date");--> statement-breakpoint
CREATE INDEX "daily_report_locks_status_idx" ON "daily_report_locks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "daily_scope_progress_scope_item_id_idx" ON "daily_scope_progress" USING btree ("scope_item_id");--> statement-breakpoint
CREATE INDEX "daily_scope_progress_project_id_idx" ON "daily_scope_progress" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "daily_scope_progress_work_date_idx" ON "daily_scope_progress" USING btree ("work_date");--> statement-breakpoint
CREATE INDEX "daily_scope_progress_billing_status_idx" ON "daily_scope_progress" USING btree ("billing_status");--> statement-breakpoint
CREATE INDEX "daily_scope_progress_org_sow_item_idx" ON "daily_scope_progress" USING btree ("organization_sow_item_id");--> statement-breakpoint
CREATE INDEX "delay_claims_org_idx" ON "delay_claims" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "delay_claims_project_idx" ON "delay_claims" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "delay_claims_status_idx" ON "delay_claims" USING btree ("status");--> statement-breakpoint
CREATE INDEX "delay_claims_number_idx" ON "delay_claims" USING btree ("claim_number");--> statement-breakpoint
CREATE INDEX "delay_notifications_delay_id_idx" ON "delay_notifications" USING btree ("delay_id");--> statement-breakpoint
CREATE INDEX "domain_events_status_idx" ON "domain_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "domain_events_type_idx" ON "domain_events" USING btree ("type");--> statement-breakpoint
CREATE INDEX "domain_events_created_at_idx" ON "domain_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "email_verification_tokens_user_idx" ON "email_verification_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "email_verification_tokens_expires_idx" ON "email_verification_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "employee_classifications_user_id_idx" ON "employee_classifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "employee_classifications_class_id_idx" ON "employee_classifications" USING btree ("classification_id");--> statement-breakpoint
CREATE INDEX "employee_cost_assignments_user_id_idx" ON "employee_cost_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "eli_sub_line_item_idx" ON "estimate_line_item_subcontractors" USING btree ("line_item_id");--> statement-breakpoint
CREATE INDEX "eli_sub_quote_idx" ON "estimate_line_item_subcontractors" USING btree ("subcontractor_quote_id");--> statement-breakpoint
CREATE INDEX "estimate_line_items_estimate_idx" ON "estimate_line_items" USING btree ("estimate_id");--> statement-breakpoint
CREATE INDEX "estimate_line_items_category_idx" ON "estimate_line_items" USING btree ("category");--> statement-breakpoint
CREATE INDEX "estimate_line_items_source_idx" ON "estimate_line_items" USING btree ("source");--> statement-breakpoint
CREATE INDEX "estimate_line_items_scope_work_type_idx" ON "estimate_line_items" USING btree ("scope_work_type_id");--> statement-breakpoint
CREATE INDEX "estimate_line_items_work_type_code_idx" ON "estimate_line_items" USING btree ("work_type_code");--> statement-breakpoint
CREATE INDEX "estimate_line_items_subcontractor_quote_idx" ON "estimate_line_items" USING btree ("subcontractor_quote_id");--> statement-breakpoint
CREATE INDEX "estimate_line_items_job_classification_idx" ON "estimate_line_items" USING btree ("job_classification_id");--> statement-breakpoint
CREATE INDEX "estimate_line_items_org_sow_item_idx" ON "estimate_line_items" USING btree ("organization_sow_item_id");--> statement-breakpoint
CREATE INDEX "invoice_payments_org_id_idx" ON "invoice_payments" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "invoice_payments_invoice_id_idx" ON "invoice_payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "leave_requests_employee_idx" ON "leave_requests" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "leave_requests_org_idx" ON "leave_requests" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "leave_requests_status_idx" ON "leave_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "leave_requests_leave_type_idx" ON "leave_requests" USING btree ("leave_type_id");--> statement-breakpoint
CREATE INDEX "leave_types_org_idx" ON "leave_types" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "notifications_user_id_idx" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_user_read_idx" ON "notifications" USING btree ("user_id","is_read");--> statement-breakpoint
CREATE INDEX "notifications_created_at_idx" ON "notifications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "org_cost_codes_org_idx" ON "org_cost_codes" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "overtime_requests_user_idx" ON "overtime_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "overtime_requests_shift_idx" ON "overtime_requests" USING btree ("shift_id");--> statement-breakpoint
CREATE INDEX "overtime_requests_status_idx" ON "overtime_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "overtime_requests_org_idx" ON "overtime_requests" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_user_idx" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_expires_idx" ON "password_reset_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "payroll_notifications_org_idx" ON "payroll_notifications" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "payroll_notifications_period_idx" ON "payroll_notifications" USING btree ("period_start","period_end");--> statement-breakpoint
CREATE INDEX "payroll_notifications_status_idx" ON "payroll_notifications" USING btree ("status");--> statement-breakpoint
CREATE INDEX "photo_custody_org_idx" ON "photo_custody_records" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "photo_custody_project_idx" ON "photo_custody_records" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "photo_custody_photo_url_idx" ON "photo_custody_records" USING btree ("photo_url");--> statement-breakpoint
CREATE INDEX "photo_custody_action_idx" ON "photo_custody_records" USING btree ("action");--> statement-breakpoint
CREATE INDEX "photo_custody_claim_idx" ON "photo_custody_records" USING btree ("linked_claim_id");--> statement-breakpoint
CREATE INDEX "prevailing_wage_rates_project_id_idx" ON "prevailing_wage_rates" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_delays_project_id_idx" ON "project_delays" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_delays_status_idx" ON "project_delays" USING btree ("status");--> statement-breakpoint
CREATE INDEX "project_delays_reason_idx" ON "project_delays" USING btree ("reason");--> statement-breakpoint
CREATE INDEX "project_delays_start_date_idx" ON "project_delays" USING btree ("start_date_time");--> statement-breakpoint
CREATE INDEX "project_inspections_project_id_idx" ON "project_inspections" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_inspections_status_idx" ON "project_inspections" USING btree ("status");--> statement-breakpoint
CREATE INDEX "project_inspections_type_idx" ON "project_inspections" USING btree ("inspection_type");--> statement-breakpoint
CREATE INDEX "project_inspections_scheduled_date_idx" ON "project_inspections" USING btree ("scheduled_date");--> statement-breakpoint
CREATE INDEX "project_material_budgets_project_id_idx" ON "project_material_budgets" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_material_budgets_scope_item_id_idx" ON "project_material_budgets" USING btree ("scope_item_id");--> statement-breakpoint
CREATE INDEX "project_material_budgets_alert_triggered_idx" ON "project_material_budgets" USING btree ("alert_triggered");--> statement-breakpoint
CREATE INDEX "project_material_usage_project_id_idx" ON "project_material_usage" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_material_usage_scope_item_id_idx" ON "project_material_usage" USING btree ("scope_item_id");--> statement-breakpoint
CREATE INDEX "project_material_usage_usage_date_idx" ON "project_material_usage" USING btree ("usage_date");--> statement-breakpoint
CREATE INDEX "project_material_usage_material_budget_id_idx" ON "project_material_usage" USING btree ("material_budget_id");--> statement-breakpoint
CREATE INDEX "project_notes_project_id_idx" ON "project_notes" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_notes_author_id_idx" ON "project_notes" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "project_notes_created_at_idx" ON "project_notes" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "punch_list_items_project_id_idx" ON "punch_list_items" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "punch_list_items_status_idx" ON "punch_list_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "punch_list_items_priority_idx" ON "punch_list_items" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "punch_list_items_trade_idx" ON "punch_list_items" USING btree ("trade");--> statement-breakpoint
CREATE INDEX "punch_list_items_assigned_to_idx" ON "punch_list_items" USING btree ("assigned_to_user_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_org_id_idx" ON "purchase_orders" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "purchase_requests_org_id_idx" ON "purchase_requests" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "scope_items_org_sow_item_idx" ON "scope_items" USING btree ("organization_sow_item_id");--> statement-breakpoint
CREATE INDEX "tasks_organization_id_idx" ON "tasks" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "tasks_project_id_idx" ON "tasks" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "tasks_assigned_to_id_idx" ON "tasks" USING btree ("assigned_to_id");--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tasks_priority_idx" ON "tasks" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "tasks_due_date_idx" ON "tasks" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "tasks_source_type_idx" ON "tasks" USING btree ("source_type");--> statement-breakpoint
CREATE INDEX "tasks_email_thread_id_idx" ON "tasks" USING btree ("email_thread_id");--> statement-breakpoint
CREATE INDEX "time_clock_shifts_user_id_idx" ON "time_clock_shifts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "time_clock_shifts_clock_in_idx" ON "time_clock_shifts" USING btree ("clock_in");--> statement-breakpoint
CREATE INDEX "time_clock_shifts_approval_status_idx" ON "time_clock_shifts" USING btree ("approval_status");--> statement-breakpoint
CREATE INDEX "time_entries_user_id_idx" ON "time_entries" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "time_entries_project_id_idx" ON "time_entries" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "time_entries_date_idx" ON "time_entries" USING btree ("date");--> statement-breakpoint
CREATE INDEX "time_entries_approval_status_idx" ON "time_entries" USING btree ("approval_status");--> statement-breakpoint
CREATE INDEX "tm_invoices_organization_id_idx" ON "tm_invoices" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "tm_invoices_project_id_idx" ON "tm_invoices" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "tm_invoices_status_idx" ON "tm_invoices" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tm_invoices_invoice_date_idx" ON "tm_invoices" USING btree ("invoice_date");--> statement-breakpoint
CREATE INDEX "tm_ticket_equipment_entries_ticket_id_idx" ON "tm_ticket_equipment_entries" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "tm_ticket_labor_entries_ticket_id_idx" ON "tm_ticket_labor_entries" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "tm_ticket_material_entries_ticket_id_idx" ON "tm_ticket_material_entries" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "tm_tickets_project_id_idx" ON "tm_tickets" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "tm_tickets_status_idx" ON "tm_tickets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tm_tickets_work_date_idx" ON "tm_tickets" USING btree ("work_date");--> statement-breakpoint
CREATE INDEX "tm_tickets_work_type_code_idx" ON "tm_tickets" USING btree ("work_type_code");--> statement-breakpoint
CREATE INDEX "tm_tickets_billing_status_idx" ON "tm_tickets" USING btree ("billing_status");--> statement-breakpoint
CREATE INDEX "upload_intents_organization_id_idx" ON "upload_intents" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "upload_intents_created_at_idx" ON "upload_intents" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "vendor_invoices_org_id_idx" ON "vendor_invoices" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "warranty_cases_project_id_idx" ON "warranty_cases" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "warranty_cases_status_idx" ON "warranty_cases" USING btree ("status");--> statement-breakpoint
CREATE INDEX "warranty_cases_type_idx" ON "warranty_cases" USING btree ("type");--> statement-breakpoint
CREATE INDEX "warranty_cases_priority_idx" ON "warranty_cases" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "warranty_documents_case_id_idx" ON "warranty_documents" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "warranty_documents_project_id_idx" ON "warranty_documents" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "warranty_tasks_case_id_idx" ON "warranty_tasks" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "warranty_tasks_project_id_idx" ON "warranty_tasks" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "warranty_tasks_status_idx" ON "warranty_tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "active_sessions_user_idx" ON "active_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "active_sessions_expires_idx" ON "active_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "addenda_org_idx" ON "addenda" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "addenda_project_idx" ON "addenda" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ack_addendum_idx" ON "addendum_acknowledgments" USING btree ("addendum_id");--> statement-breakpoint
CREATE INDEX "ai_action_audit_org_idx" ON "ai_action_audit" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "ai_action_audit_actor_idx" ON "ai_action_audit" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "ai_action_audit_action_type_idx" ON "ai_action_audit" USING btree ("action_type");--> statement-breakpoint
CREATE INDEX "ai_action_audit_created_at_idx" ON "ai_action_audit" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_bid_document_analysis_bid_idx" ON "ai_bid_document_analysis" USING btree ("bid_id");--> statement-breakpoint
CREATE INDEX "ai_bid_document_analysis_org_idx" ON "ai_bid_document_analysis" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "ai_bid_document_analysis_status_idx" ON "ai_bid_document_analysis" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ai_bid_document_analysis_archived_idx" ON "ai_bid_document_analysis" USING btree ("is_archived");--> statement-breakpoint
CREATE INDEX "ai_co_drafts_project_idx" ON "ai_co_drafts" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ai_co_drafts_org_idx" ON "ai_co_drafts" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "ai_contract_document_analysis_project_idx" ON "ai_contract_document_analysis" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ai_contract_document_analysis_org_idx" ON "ai_contract_document_analysis" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "ai_contract_document_analysis_status_idx" ON "ai_contract_document_analysis" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ai_gantt_recommendations_project_idx" ON "ai_gantt_recommendations" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ai_insights_module_idx" ON "ai_insights" USING btree ("module");--> statement-breakpoint
CREATE INDEX "ai_insights_org_idx" ON "ai_insights" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "ai_insights_project_idx" ON "ai_insights" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ai_insights_severity_idx" ON "ai_insights" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "ai_insights_created_at_idx" ON "ai_insights" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_runs_created_at_idx" ON "ai_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_takeoff_project_idx" ON "ai_takeoff_analyses" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ai_takeoff_org_idx" ON "ai_takeoff_analyses" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "ai_tasks_role_idx" ON "ai_tasks" USING btree ("role");--> statement-breakpoint
CREATE INDEX "ai_tasks_status_idx" ON "ai_tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ai_tasks_priority_idx" ON "ai_tasks" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "ai_vendor_comparisons_org_idx" ON "ai_vendor_comparisons" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "ai_vendor_comparisons_category_idx" ON "ai_vendor_comparisons" USING btree ("material_category");--> statement-breakpoint
CREATE INDEX "approval_requests_org_idx" ON "approval_requests" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "approval_requests_entity_idx" ON "approval_requests" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "approval_requests_status_idx" ON "approval_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "approval_requests_requested_by_idx" ON "approval_requests" USING btree ("requested_by_user_id");--> statement-breakpoint
CREATE INDEX "bid_doc_dist_org_idx" ON "bid_document_distributions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "bid_doc_dist_bid_idx" ON "bid_document_distributions" USING btree ("bid_id");--> statement-breakpoint
CREATE INDEX "bid_doc_dist_crm_org_idx" ON "bid_document_distributions" USING btree ("crm_organisation_id");--> statement-breakpoint
CREATE INDEX "bid_doc_dist_status_idx" ON "bid_document_distributions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "bid_doc_dist_sent_at_idx" ON "bid_document_distributions" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "bid_equipment_selections_bid_idx" ON "bid_equipment_selections" USING btree ("bid_id");--> statement-breakpoint
CREATE INDEX "bid_equipment_selections_equipment_idx" ON "bid_equipment_selections" USING btree ("equipment_id");--> statement-breakpoint
CREATE INDEX "bid_equipment_selections_source_idx" ON "bid_equipment_selections" USING btree ("source");--> statement-breakpoint
CREATE INDEX "bid_modifier_selections_bid_idx" ON "bid_modifier_selections" USING btree ("bid_id");--> statement-breakpoint
CREATE INDEX "bid_modifier_selections_line_item_idx" ON "bid_modifier_selections" USING btree ("estimate_line_item_id");--> statement-breakpoint
CREATE INDEX "bid_modifier_selections_modifier_idx" ON "bid_modifier_selections" USING btree ("modifier_id");--> statement-breakpoint
CREATE INDEX "bid_clarification_request_idx" ON "bid_request_clarifications" USING btree ("bid_request_id");--> statement-breakpoint
CREATE INDEX "bid_clarification_asked_by_idx" ON "bid_request_clarifications" USING btree ("asked_by_organization_id");--> statement-breakpoint
CREATE INDEX "bim_extractions_bid_idx" ON "bim_extractions" USING btree ("bid_id");--> statement-breakpoint
CREATE INDEX "bim_extractions_project_idx" ON "bim_extractions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "bim_extractions_document_idx" ON "bim_extractions" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "bim_storey_assoc_sheet_idx" ON "bim_storey_associations" USING btree ("sheet_id");--> statement-breakpoint
CREATE INDEX "bim_storey_assoc_bid_idx" ON "bim_storey_associations" USING btree ("bid_id");--> statement-breakpoint
CREATE INDEX "portal_access_project_idx" ON "client_portal_access" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "portal_access_email_idx" ON "client_portal_access" USING btree ("email");--> statement-breakpoint
CREATE INDEX "portal_activity_access_idx" ON "client_portal_activity" USING btree ("access_id");--> statement-breakpoint
CREATE INDEX "portal_activity_project_idx" ON "client_portal_activity" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "conversation_participants_conv_user_idx" ON "conversation_participants" USING btree ("conversation_id","user_id");--> statement-breakpoint
CREATE INDEX "conversation_participants_user_idx" ON "conversation_participants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "conversations_type_idx" ON "conversations" USING btree ("type");--> statement-breakpoint
CREATE INDEX "conversations_org_idx" ON "conversations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "conversations_channel_slug_idx" ON "conversations" USING btree ("channel_slug");--> statement-breakpoint
CREATE INDEX "conversations_project_id_idx" ON "conversations" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "conversations_crew_id_idx" ON "conversations" USING btree ("crew_id");--> statement-breakpoint
CREATE INDEX "crew_marketplace_org_idx" ON "crew_marketplace" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "crew_marketplace_crew_idx" ON "crew_marketplace" USING btree ("crew_id");--> statement-breakpoint
CREATE INDEX "crew_marketplace_trade_idx" ON "crew_marketplace" USING btree ("trade_type");--> statement-breakpoint
CREATE INDEX "crew_marketplace_availability_idx" ON "crew_marketplace" USING btree ("availability_status");--> statement-breakpoint
CREATE INDEX "crew_marketplace_location_idx" ON "crew_marketplace" USING btree ("base_location");--> statement-breakpoint
CREATE INDEX "crm_contacts_org_idx" ON "crm_contacts" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "crm_contacts_organisation_idx" ON "crm_contacts" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "crm_opportunities_org_idx" ON "crm_opportunities" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "crm_opportunities_stage_idx" ON "crm_opportunities" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "crm_opportunities_assigned_idx" ON "crm_opportunities" USING btree ("assigned_to_id");--> statement-breakpoint
CREATE INDEX "crm_opp_activities_opp_idx" ON "crm_opportunity_activities" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "crm_opp_activities_created_at_idx" ON "crm_opportunity_activities" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "crm_org_notes_org_idx" ON "crm_organisation_notes" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "crm_org_notes_organisation_idx" ON "crm_organisation_notes" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "crm_org_notes_created_at_idx" ON "crm_organisation_notes" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "crm_organisations_org_idx" ON "crm_organisations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "crm_organisations_type_idx" ON "crm_organisations" USING btree ("type");--> statement-breakpoint
CREATE INDEX "crm_organisations_name_idx" ON "crm_organisations" USING btree ("name");--> statement-breakpoint
CREATE INDEX "crm_organisations_is_deleted_idx" ON "crm_organisations" USING btree ("is_deleted");--> statement-breakpoint
CREATE INDEX "custom_libraries_org_idx" ON "custom_libraries" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "data_processing_records_org_idx" ON "data_processing_records" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "data_subject_requests_org_idx" ON "data_subject_requests" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "data_subject_requests_status_idx" ON "data_subject_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "document_revisions_org_idx" ON "document_revisions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "document_revisions_doc_idx" ON "document_revisions" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "transmittals_org_idx" ON "document_transmittals" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "transmittals_project_idx" ON "document_transmittals" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "transmittals_status_idx" ON "document_transmittals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "email_accounts_org_idx" ON "email_accounts" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "email_accounts_user_idx" ON "email_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "email_accounts_email_idx" ON "email_accounts" USING btree ("email_address");--> statement-breakpoint
CREATE INDEX "email_attachments_org_idx" ON "email_attachments" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "email_attachments_message_idx" ON "email_attachments" USING btree ("email_message_id");--> statement-breakpoint
CREATE INDEX "email_messages_org_idx" ON "email_messages" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "email_messages_account_idx" ON "email_messages" USING btree ("email_account_id");--> statement-breakpoint
CREATE INDEX "email_messages_thread_idx" ON "email_messages" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "email_messages_external_id_idx" ON "email_messages" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "email_messages_received_at_idx" ON "email_messages" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "email_messages_classification_idx" ON "email_messages" USING btree ("classification");--> statement-breakpoint
CREATE INDEX "email_summaries_org_idx" ON "email_summaries" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "email_summaries_user_idx" ON "email_summaries" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "email_summaries_period_idx" ON "email_summaries" USING btree ("period_start","period_end");--> statement-breakpoint
CREATE INDEX "email_tasks_org_idx" ON "email_tasks" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "email_tasks_project_idx" ON "email_tasks" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "email_tasks_assigned_idx" ON "email_tasks" USING btree ("assigned_to_user_id");--> statement-breakpoint
CREATE INDEX "email_tasks_status_idx" ON "email_tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "email_tasks_thread_idx" ON "email_tasks" USING btree ("email_thread_id");--> statement-breakpoint
CREATE INDEX "email_tasks_due_date_idx" ON "email_tasks" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "email_threads_org_idx" ON "email_threads" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "email_threads_account_idx" ON "email_threads" USING btree ("email_account_id");--> statement-breakpoint
CREATE INDEX "email_threads_project_idx" ON "email_threads" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "email_threads_bid_idx" ON "email_threads" USING btree ("bid_id");--> statement-breakpoint
CREATE INDEX "email_threads_status_idx" ON "email_threads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "email_threads_last_message_idx" ON "email_threads" USING btree ("last_message_at");--> statement-breakpoint
CREATE INDEX "employee_ratings_org_idx" ON "employee_ratings" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "employee_ratings_employee_idx" ON "employee_ratings" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "employee_ratings_evaluator_idx" ON "employee_ratings" USING btree ("evaluator_id");--> statement-breakpoint
CREATE INDEX "equipment_status_idx" ON "equipment" USING btree ("status");--> statement-breakpoint
CREATE INDEX "equipment_type_idx" ON "equipment" USING btree ("type");--> statement-breakpoint
CREATE INDEX "equipment_code_idx" ON "equipment" USING btree ("equipment_code");--> statement-breakpoint
CREATE INDEX "equipment_organization_idx" ON "equipment" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "equipment_assignments_equipment_idx" ON "equipment_assignments" USING btree ("equipment_id");--> statement-breakpoint
CREATE INDEX "equipment_assignments_project_idx" ON "equipment_assignments" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "equipment_assignments_active_idx" ON "equipment_assignments" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "equipment_hour_logs_equipment_idx" ON "equipment_hour_logs" USING btree ("equipment_id");--> statement-breakpoint
CREATE INDEX "equipment_hour_logs_project_idx" ON "equipment_hour_logs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "equipment_hour_logs_week_idx" ON "equipment_hour_logs" USING btree ("week_start_date");--> statement-breakpoint
CREATE INDEX "equipment_hour_reminders_manager_idx" ON "equipment_hour_reminders" USING btree ("manager_id");--> statement-breakpoint
CREATE INDEX "equipment_hour_reminders_week_idx" ON "equipment_hour_reminders" USING btree ("week_start_date");--> statement-breakpoint
CREATE INDEX "equipment_listings_org_idx" ON "equipment_listings" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "equipment_listings_category_idx" ON "equipment_listings" USING btree ("category");--> statement-breakpoint
CREATE INDEX "equipment_listings_is_active_idx" ON "equipment_listings" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "equipment_maintenance_history_equipment_idx" ON "equipment_maintenance_history" USING btree ("equipment_id");--> statement-breakpoint
CREATE INDEX "equipment_maintenance_history_performed_idx" ON "equipment_maintenance_history" USING btree ("performed_at");--> statement-breakpoint
CREATE INDEX "equipment_maintenance_equipment_idx" ON "equipment_maintenance_schedules" USING btree ("equipment_id");--> statement-breakpoint
CREATE INDEX "equipment_maintenance_next_due_idx" ON "equipment_maintenance_schedules" USING btree ("next_due_at");--> statement-breakpoint
CREATE INDEX "equipment_rate_profiles_equipment_idx" ON "equipment_rate_profiles" USING btree ("equipment_id");--> statement-breakpoint
CREATE INDEX "equipment_rate_profiles_active_idx" ON "equipment_rate_profiles" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "equipment_rental_requests_listing_idx" ON "equipment_rental_requests" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "equipment_rental_requests_requester_idx" ON "equipment_rental_requests" USING btree ("requester_org_id");--> statement-breakpoint
CREATE INDEX "equipment_rental_requests_status_idx" ON "equipment_rental_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "equipment_repairs_equipment_idx" ON "equipment_repairs" USING btree ("equipment_id");--> statement-breakpoint
CREATE INDEX "equipment_repairs_status_idx" ON "equipment_repairs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "estimate_vendor_quotes_estimate_idx" ON "estimate_vendor_quotes" USING btree ("estimate_id");--> statement-breakpoint
CREATE INDEX "estimate_versions_estimate_idx" ON "estimate_versions" USING btree ("estimate_id");--> statement-breakpoint
CREATE INDEX "hiring_activity_logs_org_idx" ON "hiring_activity_logs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "hiring_activity_logs_activity_type_idx" ON "hiring_activity_logs" USING btree ("activity_type");--> statement-breakpoint
CREATE INDEX "hiring_activity_logs_created_at_idx" ON "hiring_activity_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "hiring_ai_reviews_candidate_idx" ON "hiring_ai_reviews" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "hiring_ai_reviews_org_idx" ON "hiring_ai_reviews" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "hiring_candidate_documents_candidate_idx" ON "hiring_candidate_documents" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "hiring_candidate_documents_org_idx" ON "hiring_candidate_documents" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "hiring_candidate_notes_candidate_idx" ON "hiring_candidate_notes" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "hiring_candidate_notes_org_idx" ON "hiring_candidate_notes" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "hiring_candidate_stage_history_candidate_idx" ON "hiring_candidate_stage_history" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "hiring_candidate_stage_history_org_idx" ON "hiring_candidate_stage_history" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "hiring_candidates_org_idx" ON "hiring_candidates" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "hiring_candidates_job_idx" ON "hiring_candidates" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "hiring_candidates_stage_idx" ON "hiring_candidates" USING btree ("current_stage");--> statement-breakpoint
CREATE INDEX "hiring_candidates_applied_at_idx" ON "hiring_candidates" USING btree ("applied_at");--> statement-breakpoint
CREATE INDEX "hiring_candidates_reviewer_idx" ON "hiring_candidates" USING btree ("reviewer_user_id");--> statement-breakpoint
CREATE INDEX "hiring_candidates_external_idx" ON "hiring_candidates" USING btree ("external_candidate_id");--> statement-breakpoint
CREATE INDEX "hiring_integrations_org_idx" ON "hiring_integrations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "hiring_integrations_provider_idx" ON "hiring_integrations" USING btree ("provider_name");--> statement-breakpoint
CREATE INDEX "hiring_interviews_candidate_idx" ON "hiring_interviews" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "hiring_interviews_org_idx" ON "hiring_interviews" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "hiring_interviews_status_idx" ON "hiring_interviews" USING btree ("status");--> statement-breakpoint
CREATE INDEX "hiring_interviews_start_at_idx" ON "hiring_interviews" USING btree ("start_at");--> statement-breakpoint
CREATE INDEX "hiring_job_templates_org_idx" ON "hiring_job_templates" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "hiring_jobs_org_idx" ON "hiring_jobs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "hiring_jobs_status_idx" ON "hiring_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "hiring_jobs_external_idx" ON "hiring_jobs" USING btree ("external_job_id");--> statement-breakpoint
CREATE INDEX "hiring_pipeline_configs_org_idx" ON "hiring_pipeline_configs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "hiring_pipeline_stages_org_idx" ON "hiring_pipeline_stages" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "hiring_pipeline_stages_order_idx" ON "hiring_pipeline_stages" USING btree ("organization_id","display_order");--> statement-breakpoint
CREATE INDEX "hiring_sync_logs_org_idx" ON "hiring_sync_logs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "hiring_sync_logs_status_idx" ON "hiring_sync_logs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "hiring_sync_logs_started_at_idx" ON "hiring_sync_logs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "hiring_tasks_org_idx" ON "hiring_tasks" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "hiring_tasks_candidate_idx" ON "hiring_tasks" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "hiring_tasks_status_idx" ON "hiring_tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "hustler_delegate_hustler_idx" ON "hustler_delegates" USING btree ("hustler_user_id");--> statement-breakpoint
CREATE INDEX "hustler_delegate_delegate_idx" ON "hustler_delegates" USING btree ("delegate_user_id");--> statement-breakpoint
CREATE INDEX "hustler_delegate_token_idx" ON "hustler_delegates" USING btree ("invite_token_hash");--> statement-breakpoint
CREATE INDEX "hustler_link_req_hustler_idx" ON "hustler_link_requests" USING btree ("hustler_user_id");--> statement-breakpoint
CREATE INDEX "hustler_link_req_org_idx" ON "hustler_link_requests" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "hustler_link_req_status_idx" ON "hustler_link_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "hustler_link_req_token_idx" ON "hustler_link_requests" USING btree ("invite_token_hash");--> statement-breakpoint
CREATE INDEX "hustler_org_user_idx" ON "hustler_organizations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "hustler_org_org_idx" ON "hustler_organizations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "integration_connections_org_idx" ON "integration_connections" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "integration_connections_provider_idx" ON "integration_connections" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "integration_events_org_idx" ON "integration_events_outbox" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "integration_events_status_idx" ON "integration_events_outbox" USING btree ("status");--> statement-breakpoint
CREATE INDEX "integration_sync_state_org_idx" ON "integration_sync_state" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "integration_webhooks_org_idx" ON "integration_webhook_subscriptions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "integration_webhooks_connection_idx" ON "integration_webhook_subscriptions" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "issue_captures_org_idx" ON "issue_captures" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "issue_captures_project_idx" ON "issue_captures" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "issue_captures_created_by_idx" ON "issue_captures" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "issue_captures_severity_idx" ON "issue_captures" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "issue_captures_status_idx" ON "issue_captures" USING btree ("status");--> statement-breakpoint
CREATE INDEX "jobsite_analysis_project_idx" ON "jobsite_analysis_batches" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "jobsite_analysis_date_idx" ON "jobsite_analysis_batches" USING btree ("analysis_date");--> statement-breakpoint
CREATE INDEX "jobsite_photos_batch_idx" ON "jobsite_analysis_photos" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "kpi_assignments_org_idx" ON "kpi_assignments" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "kpi_assignments_user_idx" ON "kpi_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "kpi_assignments_template_idx" ON "kpi_assignments" USING btree ("kpi_template_id");--> statement-breakpoint
CREATE INDEX "kpi_entries_org_idx" ON "kpi_entries" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "kpi_entries_assignment_idx" ON "kpi_entries" USING btree ("kpi_assignment_id");--> statement-breakpoint
CREATE INDEX "kpi_entries_period_idx" ON "kpi_entries" USING btree ("period_start","period_end");--> statement-breakpoint
CREATE INDEX "kpi_templates_org_idx" ON "kpi_templates" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "library_assemblies_org_idx" ON "library_assemblies" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "library_assemblies_library_idx" ON "library_assemblies" USING btree ("library_id");--> statement-breakpoint
CREATE INDEX "library_assembly_group_members_group_idx" ON "library_assembly_item_group_members" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "library_assembly_item_groups_assembly_idx" ON "library_assembly_item_groups" USING btree ("assembly_id");--> statement-breakpoint
CREATE INDEX "library_assembly_items_assembly_idx" ON "library_assembly_items" USING btree ("assembly_id");--> statement-breakpoint
CREATE INDEX "library_items_org_idx" ON "library_items" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "library_items_library_idx" ON "library_items" USING btree ("library_id");--> statement-breakpoint
CREATE INDEX "lien_waivers_project_idx" ON "lien_waivers" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "lien_waivers_org_idx" ON "lien_waivers" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "lien_waivers_sov_idx" ON "lien_waivers" USING btree ("sov_id");--> statement-breakpoint
CREATE INDEX "marketplace_reviews_reviewer_idx" ON "marketplace_reviews" USING btree ("reviewer_org_id");--> statement-breakpoint
CREATE INDEX "marketplace_reviews_reviewee_idx" ON "marketplace_reviews" USING btree ("reviewee_org_id");--> statement-breakpoint
CREATE INDEX "master_calc_trade_idx" ON "master_calculators" USING btree ("trade_type");--> statement-breakpoint
CREATE INDEX "master_forms_trade_idx" ON "master_inspection_forms" USING btree ("trade_type");--> statement-breakpoint
CREATE INDEX "master_mod_cat_trade_idx" ON "master_modifier_categories" USING btree ("trade_type");--> statement-breakpoint
CREATE INDEX "master_mod_trade_idx" ON "master_modifiers" USING btree ("trade_type");--> statement-breakpoint
CREATE INDEX "master_mod_category_idx" ON "master_modifiers" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "master_sow_trade_idx" ON "master_sow_items" USING btree ("trade_type");--> statement-breakpoint
CREATE INDEX "master_sow_csi_idx" ON "master_sow_items" USING btree ("csi_code");--> statement-breakpoint
CREATE INDEX "material_calc_presets_org_idx" ON "material_calculator_presets" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "material_calc_presets_work_type_idx" ON "material_calculator_presets" USING btree ("work_type_code");--> statement-breakpoint
CREATE INDEX "material_price_org_idx" ON "material_price_index" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "material_price_material_idx" ON "material_price_index" USING btree ("material_name");--> statement-breakpoint
CREATE INDEX "material_price_category_idx" ON "material_price_index" USING btree ("material_category");--> statement-breakpoint
CREATE INDEX "material_price_effective_idx" ON "material_price_index" USING btree ("effective_date");--> statement-breakpoint
CREATE INDEX "material_price_vendor_idx" ON "material_price_index" USING btree ("source_vendor_id");--> statement-breakpoint
CREATE INDEX "message_reactions_message_idx" ON "message_reactions" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "messages_sender_idx" ON "messages" USING btree ("sender_id");--> statement-breakpoint
CREATE INDEX "messages_created_at_idx" ON "messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "mobile_devices_user_idx" ON "mobile_devices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "mobile_devices_org_idx" ON "mobile_devices" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "pending_uploads_device_idx" ON "mobile_pending_uploads" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "sync_log_device_idx" ON "mobile_sync_log" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "modifiers_layer_idx" ON "modifiers" USING btree ("layer");--> statement-breakpoint
CREATE INDEX "modifiers_category_idx" ON "modifiers" USING btree ("category");--> statement-breakpoint
CREATE INDEX "modifiers_org_idx" ON "modifiers" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "modifiers_active_idx" ON "modifiers" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "object_acl_policies_object_key_idx" ON "object_acl_policies" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "object_acl_policies_org_idx" ON "object_acl_policies" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "offline_sync_org_idx" ON "offline_sync_queue" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "offline_sync_user_idx" ON "offline_sync_queue" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "offline_sync_status_idx" ON "offline_sync_queue" USING btree ("status");--> statement-breakpoint
CREATE INDEX "offline_sync_entity_idx" ON "offline_sync_queue" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "org_color_palettes_org_idx" ON "org_color_palettes" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "org_calculators_org_idx" ON "organization_calculators" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "org_docs_org_idx" ON "organization_documents" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "org_docs_type_idx" ON "organization_documents" USING btree ("type");--> statement-breakpoint
CREATE INDEX "org_network_settings_org_idx" ON "organization_network_settings" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "social_links_org_idx" ON "organization_social_links" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "org_sow_items_org_idx" ON "organization_sow_items" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "org_sow_items_category_idx" ON "organization_sow_items" USING btree ("category_name");--> statement-breakpoint
CREATE INDEX "website_pages_website_idx" ON "organization_website_pages" USING btree ("website_id");--> statement-breakpoint
CREATE INDEX "website_pages_org_idx" ON "organization_website_pages" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "website_pages_slug_idx" ON "organization_website_pages" USING btree ("website_id","page_slug");--> statement-breakpoint
CREATE INDEX "website_org_idx" ON "organization_websites" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "website_subdomain_idx" ON "organization_websites" USING btree ("subdomain");--> statement-breakpoint
CREATE INDEX "org_work_types_org_idx" ON "organization_work_types" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "overhead_cost_history_org_idx" ON "overhead_cost_history" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "overhead_cost_history_created_at_idx" ON "overhead_cost_history" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "overhead_cost_items_org_idx" ON "overhead_cost_items" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "overhead_cost_items_active_idx" ON "overhead_cost_items" USING btree ("organization_id","is_active");--> statement-breakpoint
CREATE INDEX "preview_links_token_idx" ON "page_preview_links" USING btree ("token");--> statement-breakpoint
CREATE INDEX "preview_links_page_idx" ON "page_preview_links" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX "page_versions_page_idx" ON "page_versions" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX "page_versions_version_idx" ON "page_versions" USING btree ("page_id","version_number");--> statement-breakpoint
CREATE INDEX "passkey_credentials_user_idx" ON "passkey_credentials" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "passkey_credentials_credential_idx" ON "passkey_credentials" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "portal_activity_log_token_idx" ON "portal_activity_log" USING btree ("portal_token_id");--> statement-breakpoint
CREATE INDEX "portal_activity_log_action_idx" ON "portal_activity_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "portal_activity_log_created_at_idx" ON "portal_activity_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "portal_chat_messages_thread_idx" ON "portal_chat_messages" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "portal_chat_messages_sender_type_idx" ON "portal_chat_messages" USING btree ("sender_type");--> statement-breakpoint
CREATE INDEX "portal_chat_messages_created_at_idx" ON "portal_chat_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "portal_chat_threads_org_idx" ON "portal_chat_threads" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "portal_chat_threads_project_idx" ON "portal_chat_threads" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "portal_chat_threads_token_idx" ON "portal_chat_threads" USING btree ("portal_token_id");--> statement-breakpoint
CREATE INDEX "portal_chat_threads_status_idx" ON "portal_chat_threads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "portal_chat_threads_last_msg_idx" ON "portal_chat_threads" USING btree ("last_message_at");--> statement-breakpoint
CREATE INDEX "pricebook_import_jobs_org_idx" ON "pricebook_import_jobs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "pricebook_import_jobs_vendor_idx" ON "pricebook_import_jobs" USING btree ("crm_organisation_id");--> statement-breakpoint
CREATE INDEX "pricebook_import_jobs_status_idx" ON "pricebook_import_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "project_equipment_plans_project_idx" ON "project_equipment_plans" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_equipment_plans_status_idx" ON "project_equipment_plans" USING btree ("status");--> statement-breakpoint
CREATE INDEX "project_equipment_plans_source_idx" ON "project_equipment_plans" USING btree ("source");--> statement-breakpoint
CREATE INDEX "project_health_org_idx" ON "project_health_snapshots" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "project_health_project_idx" ON "project_health_snapshots" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_health_date_idx" ON "project_health_snapshots" USING btree ("snapshot_date");--> statement-breakpoint
CREATE INDEX "prof_snapshot_org_idx" ON "project_profitability_snapshots" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "prof_snapshot_project_idx" ON "project_profitability_snapshots" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "prof_snapshot_created_idx" ON "project_profitability_snapshots" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "schedule_tasks_schedule_idx" ON "project_schedule_tasks" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "schedule_tasks_parent_idx" ON "project_schedule_tasks" USING btree ("parent_task_id");--> statement-breakpoint
CREATE INDEX "project_schedules_project_idx" ON "project_schedules" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_schedules_org_idx" ON "project_schedules" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "qbo_account_mappings_org_idx" ON "qbo_account_mappings" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "qbo_account_mappings_connection_idx" ON "qbo_account_mappings" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "qbo_sync_schedules_org_idx" ON "qbo_sync_schedules" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "qbo_sync_schedules_connection_idx" ON "qbo_sync_schedules" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "qbo_sync_schedules_active_idx" ON "qbo_sync_schedules" USING btree ("is_active","next_run_at");--> statement-breakpoint
CREATE INDEX "quantity_categories_project_idx" ON "quantity_categories" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "quantity_categories_bid_idx" ON "quantity_categories" USING btree ("bid_id");--> statement-breakpoint
CREATE INDEX "rating_criteria_org_idx" ON "rating_criteria" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "rating_scores_rating_idx" ON "rating_scores" USING btree ("rating_id");--> statement-breakpoint
CREATE INDEX "rental_equipment_catalog_vendor_idx" ON "rental_equipment_catalog" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "rental_equipment_catalog_crm_org_idx" ON "rental_equipment_catalog" USING btree ("crm_organisation_id");--> statement-breakpoint
CREATE INDEX "rental_equipment_catalog_type_idx" ON "rental_equipment_catalog" USING btree ("equipment_type");--> statement-breakpoint
CREATE INDEX "rental_equipment_usages_project_idx" ON "rental_equipment_usages" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "rental_equipment_usages_vendor_idx" ON "rental_equipment_usages" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "rental_equipment_usages_status_idx" ON "rental_equipment_usages" USING btree ("status");--> statement-breakpoint
CREATE INDEX "rental_equipment_usages_plan_idx" ON "rental_equipment_usages" USING btree ("project_equipment_plan_id");--> statement-breakpoint
CREATE INDEX "rental_vendors_org_idx" ON "rental_vendors" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "retention_policies_org_idx" ON "retention_policies" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "reward_assignments_org_idx" ON "reward_assignments" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "reward_assignments_employee_idx" ON "reward_assignments" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "reward_types_org_idx" ON "reward_types" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "rfi_activity_rfi_idx" ON "rfi_activity" USING btree ("rfi_id");--> statement-breakpoint
CREATE INDEX "rfi_attachments_rfi_idx" ON "rfi_attachments" USING btree ("rfi_id");--> statement-breakpoint
CREATE INDEX "rfi_attachments_org_idx" ON "rfi_attachments" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "rfis_org_idx" ON "rfis" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "rfis_project_idx" ON "rfis" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "rfis_status_idx" ON "rfis" USING btree ("status");--> statement-breakpoint
CREATE INDEX "rfis_contract_idx" ON "rfis" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "rfis_sub_idx" ON "rfis" USING btree ("subcontractor_id");--> statement-breakpoint
CREATE INDEX "saved_takeoffs_org_idx" ON "saved_takeoffs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "sov_project_idx" ON "schedule_of_values" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "sov_org_idx" ON "schedule_of_values" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "sov_status_idx" ON "schedule_of_values" USING btree ("status");--> statement-breakpoint
CREATE INDEX "scope_modifier_rules_active_idx" ON "scope_modifier_rules" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "scope_modifier_rules_priority_idx" ON "scope_modifier_rules" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "scope_modifiers_category_idx" ON "scope_modifiers" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "scope_work_types_category_idx" ON "scope_work_types" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "social_accounts_org_idx" ON "social_accounts" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "social_accounts_platform_idx" ON "social_accounts" USING btree ("platform");--> statement-breakpoint
CREATE INDEX "social_media_posts_org_idx" ON "social_media_posts" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "social_media_posts_status_idx" ON "social_media_posts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "social_media_posts_scheduled_idx" ON "social_media_posts" USING btree ("scheduled_at");--> statement-breakpoint
CREATE INDEX "social_media_posts_campaign_idx" ON "social_media_posts" USING btree ("campaign_tag");--> statement-breakpoint
CREATE INDEX "social_post_analytics_post_idx" ON "social_post_analytics" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "social_post_history_org_idx" ON "social_post_history" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "social_post_history_platform_idx" ON "social_post_history" USING btree ("platform");--> statement-breakpoint
CREATE INDEX "sov_line_items_sov_idx" ON "sov_line_items" USING btree ("sov_id");--> statement-breakpoint
CREATE INDEX "sov_line_items_org_sow_item_idx" ON "sov_line_items" USING btree ("organization_sow_item_id");--> statement-breakpoint
CREATE INDEX "sov_payments_sov_idx" ON "sov_payments" USING btree ("sov_id");--> statement-breakpoint
CREATE INDEX "sov_payments_org_idx" ON "sov_payments" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "sow_audit_log_org_idx" ON "sow_audit_log" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "sow_audit_log_user_idx" ON "sow_audit_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sow_audit_log_action_idx" ON "sow_audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "sso_config_org_idx" ON "sso_configurations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "sub_bid_inv_request_idx" ON "subcontractor_bid_invitations" USING btree ("bid_request_id");--> statement-breakpoint
CREATE INDEX "sub_bid_inv_org_idx" ON "subcontractor_bid_invitations" USING btree ("invited_organization_id");--> statement-breakpoint
CREATE INDEX "sub_bid_inv_status_idx" ON "subcontractor_bid_invitations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sub_bid_req_org_idx" ON "subcontractor_bid_requests" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "sub_bid_req_project_idx" ON "subcontractor_bid_requests" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "sub_bid_req_status_idx" ON "subcontractor_bid_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sub_bid_req_due_date_idx" ON "subcontractor_bid_requests" USING btree ("bid_due_date");--> statement-breakpoint
CREATE INDEX "sub_bid_resp_invitation_idx" ON "subcontractor_bid_responses" USING btree ("invitation_id");--> statement-breakpoint
CREATE INDEX "sub_bid_resp_request_idx" ON "subcontractor_bid_responses" USING btree ("bid_request_id");--> statement-breakpoint
CREATE INDEX "sub_bid_resp_org_idx" ON "subcontractor_bid_responses" USING btree ("responding_organization_id");--> statement-breakpoint
CREATE INDEX "sub_bid_resp_status_idx" ON "subcontractor_bid_responses" USING btree ("status");--> statement-breakpoint
CREATE INDEX "subcontractor_payments_org_idx" ON "subcontractor_payments" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "subcontractor_payments_contract_idx" ON "subcontractor_payments" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "subcontractor_payments_status_idx" ON "subcontractor_payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sub_portal_tokens_org_idx" ON "subcontractor_portal_tokens" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "sub_portal_tokens_project_idx" ON "subcontractor_portal_tokens" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "sub_portal_tokens_crm_org_idx" ON "subcontractor_portal_tokens" USING btree ("crm_organisation_id");--> statement-breakpoint
CREATE INDEX "sub_portal_tokens_token_idx" ON "subcontractor_portal_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sub_portal_tokens_status_idx" ON "subcontractor_portal_tokens" USING btree ("status");--> statement-breakpoint
CREATE INDEX "submittal_activity_submittal_idx" ON "submittal_activity" USING btree ("submittal_id");--> statement-breakpoint
CREATE INDEX "submittal_attachments_submittal_idx" ON "submittal_attachments" USING btree ("submittal_id");--> statement-breakpoint
CREATE INDEX "submittal_attachments_org_idx" ON "submittal_attachments" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "submittal_attachments_item_idx" ON "submittal_attachments" USING btree ("submittal_item_id");--> statement-breakpoint
CREATE INDEX "submittal_attachments_review_idx" ON "submittal_attachments" USING btree ("submittal_review_id");--> statement-breakpoint
CREATE INDEX "submittal_items_submittal_idx" ON "submittal_items" USING btree ("submittal_id");--> statement-breakpoint
CREATE INDEX "submittal_items_org_idx" ON "submittal_items" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "submittal_items_status_idx" ON "submittal_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "submittal_reviews_submittal_idx" ON "submittal_reviews" USING btree ("submittal_id");--> statement-breakpoint
CREATE INDEX "submittal_reviews_org_idx" ON "submittal_reviews" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "submittal_reviews_status_idx" ON "submittal_reviews" USING btree ("status");--> statement-breakpoint
CREATE INDEX "submittal_reviews_seq_idx" ON "submittal_reviews" USING btree ("sequence_order");--> statement-breakpoint
CREATE INDEX "submittals_org_idx" ON "submittals" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "submittals_project_idx" ON "submittals" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "submittals_status_idx" ON "submittals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "submittals_type_idx" ON "submittals" USING btree ("submittal_type");--> statement-breakpoint
CREATE INDEX "submittals_phase_idx" ON "submittals" USING btree ("phase");--> statement-breakpoint
CREATE INDEX "submittals_contract_idx" ON "submittals" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "submittals_sub_idx" ON "submittals" USING btree ("subcontractor_id");--> statement-breakpoint
CREATE INDEX "takeoff_assemblies_org_idx" ON "takeoff_assemblies" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "takeoff_assembly_items_assembly_idx" ON "takeoff_assembly_items" USING btree ("assembly_id");--> statement-breakpoint
CREATE INDEX "takeoff_conditions_org_idx" ON "takeoff_conditions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "takeoff_conditions_last_used_idx" ON "takeoff_conditions" USING btree ("last_used_at");--> statement-breakpoint
CREATE INDEX "takeoff_issue_comments_issue_idx" ON "takeoff_issue_comments" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "takeoff_issues_sheet_idx" ON "takeoff_issues" USING btree ("sheet_id");--> statement-breakpoint
CREATE INDEX "takeoff_issues_org_idx" ON "takeoff_issues" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "takeoff_issues_status_idx" ON "takeoff_issues" USING btree ("status");--> statement-breakpoint
CREATE INDEX "takeoff_markups_sheet_idx" ON "takeoff_markups" USING btree ("sheet_id");--> statement-breakpoint
CREATE INDEX "takeoff_markups_created_by_idx" ON "takeoff_markups" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "takeoff_meas_assembly_meas_idx" ON "takeoff_measurement_assemblies" USING btree ("measurement_id");--> statement-breakpoint
CREATE INDEX "takeoff_meas_assembly_asm_idx" ON "takeoff_measurement_assemblies" USING btree ("assembly_id");--> statement-breakpoint
CREATE INDEX "takeoff_measurement_groups_project_idx" ON "takeoff_measurement_groups" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "takeoff_measurement_groups_bid_idx" ON "takeoff_measurement_groups" USING btree ("bid_id");--> statement-breakpoint
CREATE INDEX "takeoff_measurement_groups_sheet_idx" ON "takeoff_measurement_groups" USING btree ("sheet_id");--> statement-breakpoint
CREATE INDEX "takeoff_measurements_sheet_idx" ON "takeoff_measurements" USING btree ("sheet_id");--> statement-breakpoint
CREATE INDEX "takeoff_measurements_category_idx" ON "takeoff_measurements" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "takeoff_measurements_group_idx" ON "takeoff_measurements" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "takeoff_measurements_type_idx" ON "takeoff_measurements" USING btree ("type");--> statement-breakpoint
CREATE INDEX "takeoff_measurements_status_idx" ON "takeoff_measurements" USING btree ("status");--> statement-breakpoint
CREATE INDEX "takeoff_sheet_links_source_idx" ON "takeoff_sheet_links" USING btree ("source_sheet_id");--> statement-breakpoint
CREATE INDEX "takeoff_sheet_links_target_idx" ON "takeoff_sheet_links" USING btree ("target_sheet_id");--> statement-breakpoint
CREATE INDEX "takeoff_sheets_project_idx" ON "takeoff_sheets" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "takeoff_sheets_bid_idx" ON "takeoff_sheets" USING btree ("bid_id");--> statement-breakpoint
CREATE INDEX "takeoff_sheets_plan_idx" ON "takeoff_sheets" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "talent_profiles_user_idx" ON "talent_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "talent_profiles_org_idx" ON "talent_profiles" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "talent_profiles_trade_idx" ON "talent_profiles" USING btree ("trade_specialization");--> statement-breakpoint
CREATE INDEX "talent_profiles_availability_idx" ON "talent_profiles" USING btree ("availability");--> statement-breakpoint
CREATE INDEX "talent_profiles_published_idx" ON "talent_profiles" USING btree ("is_published");--> statement-breakpoint
CREATE INDEX "trade_features_trade_idx" ON "trade_features" USING btree ("trade_type");--> statement-breakpoint
CREATE INDEX "transmittal_recipients_transmittal_idx" ON "transmittal_recipients" USING btree ("transmittal_id");--> statement-breakpoint
CREATE INDEX "transmittal_recipients_sub_idx" ON "transmittal_recipients" USING btree ("subcontractor_id");--> statement-breakpoint
CREATE INDEX "user_color_palettes_org_idx" ON "user_color_palettes" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "user_color_palettes_user_idx" ON "user_color_palettes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_dashboard_layouts_org_idx" ON "user_dashboard_layouts" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "user_dashboard_layouts_user_idx" ON "user_dashboard_layouts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_dashboard_permissions_org_idx" ON "user_dashboard_permissions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "user_dashboard_permissions_user_idx" ON "user_dashboard_permissions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "vendor_enrollments_vendor_idx" ON "vendor_enrollments" USING btree ("vendor_crm_org_id");--> statement-breakpoint
CREATE INDEX "vendor_enrollments_contractor_idx" ON "vendor_enrollments" USING btree ("contractor_org_id");--> statement-breakpoint
CREATE INDEX "vendor_enrollments_status_idx" ON "vendor_enrollments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "price_history_item_idx" ON "vendor_price_history" USING btree ("pricebook_item_id");--> statement-breakpoint
CREATE INDEX "pricebook_items_pricebook_idx" ON "vendor_pricebook_items" USING btree ("pricebook_id");--> statement-breakpoint
CREATE INDEX "pricebook_items_vendor_idx" ON "vendor_pricebook_items" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "pricebook_items_category_idx" ON "vendor_pricebook_items" USING btree ("category");--> statement-breakpoint
CREATE INDEX "pricebooks_vendor_idx" ON "vendor_pricebooks" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "pricebooks_org_idx" ON "vendor_pricebooks" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "vendor_pricing_catalogs_crm_org_idx" ON "vendor_pricing_catalogs" USING btree ("crm_organisation_id");--> statement-breakpoint
CREATE INDEX "vendor_pricing_catalogs_org_idx" ON "vendor_pricing_catalogs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "vendor_pricing_catalogs_category_idx" ON "vendor_pricing_catalogs" USING btree ("category");--> statement-breakpoint
CREATE INDEX "vendor_pricing_catalogs_quarter_idx" ON "vendor_pricing_catalogs" USING btree ("effective_quarter");--> statement-breakpoint
CREATE INDEX "vendor_pricing_catalogs_active_idx" ON "vendor_pricing_catalogs" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "vendor_pricing_catalogs_source_idx" ON "vendor_pricing_catalogs" USING btree ("source_type");--> statement-breakpoint
CREATE INDEX "vendor_scores_org_idx" ON "vendor_scores" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "vendor_scores_vendor_idx" ON "vendor_scores" USING btree ("crm_entity_id");--> statement-breakpoint
CREATE INDEX "vendor_scores_project_idx" ON "vendor_scores" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "vendor_scores_date_idx" ON "vendor_scores" USING btree ("score_date");--> statement-breakpoint
CREATE INDEX "vendor_users_user_idx" ON "vendor_users" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "vendor_users_crm_org_idx" ON "vendor_users" USING btree ("crm_organisation_id");--> statement-breakpoint
CREATE INDEX "voice_logs_org_idx" ON "voice_logs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "voice_logs_project_idx" ON "voice_logs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "voice_logs_user_idx" ON "voice_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "voice_logs_status_idx" ON "voice_logs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "analytics_daily_website_date_idx" ON "website_analytics_daily" USING btree ("website_id","date");--> statement-breakpoint
CREATE INDEX "analytics_daily_org_idx" ON "website_analytics_daily" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "analytics_events_website_idx" ON "website_analytics_events" USING btree ("website_id");--> statement-breakpoint
CREATE INDEX "analytics_events_session_idx" ON "website_analytics_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "analytics_events_type_idx" ON "website_analytics_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "analytics_events_created_idx" ON "website_analytics_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "blog_comments_post_idx" ON "website_blog_comments" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "blog_comments_status_idx" ON "website_blog_comments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "blog_posts_website_idx" ON "website_blog_posts" USING btree ("website_id");--> statement-breakpoint
CREATE INDEX "blog_posts_org_idx" ON "website_blog_posts" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "blog_posts_slug_idx" ON "website_blog_posts" USING btree ("website_id","slug");--> statement-breakpoint
CREATE INDEX "blog_posts_status_idx" ON "website_blog_posts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "contact_submissions_website_idx" ON "website_contact_submissions" USING btree ("website_id");--> statement-breakpoint
CREATE INDEX "contact_submissions_org_idx" ON "website_contact_submissions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "contact_submissions_email_idx" ON "website_contact_submissions" USING btree ("email");--> statement-breakpoint
CREATE INDEX "deployment_website_idx" ON "website_deployments" USING btree ("website_id");--> statement-breakpoint
CREATE INDEX "deployment_org_idx" ON "website_deployments" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "deployment_created_at_idx" ON "website_deployments" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "project_images_project_idx" ON "website_project_images" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "website_projects_website_idx" ON "website_projects" USING btree ("website_id");--> statement-breakpoint
CREATE INDEX "website_projects_org_idx" ON "website_projects" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "website_projects_slug_idx" ON "website_projects" USING btree ("website_id","slug");--> statement-breakpoint
CREATE INDEX "website_projects_status_idx" ON "website_projects" USING btree ("status");--> statement-breakpoint
CREATE INDEX "zapier_webhooks_org_idx" ON "zapier_webhooks" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "zapier_webhooks_connection_idx" ON "zapier_webhooks" USING btree ("connection_id");