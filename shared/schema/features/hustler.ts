// AUTO-GENERATED SPLIT FROM shared/schema/features.ts (Task #2426).
// Domain bucketing rule lives in shared/schema/features/index.ts.
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, date, decimal, integer, pgEnum, doublePrecision, index, unique, uniqueIndex, json, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { addendumRecipientTypeEnum, addendumStatusEnum, aiBidDocumentAnalysisStatusEnum, aiCoDraftStatusEnum, aiContractDocumentAnalysisStatusEnum, contractStatusEnum, contractTypeEnum, contractRedlineStatusEnum, contractApprovalDecisionEnum, clauseCategoryEnum, signatureRequestStatusEnum, signerStatusEnum, aiInsightModuleEnum, aiInsightSeverityEnum, aiTakeoffModeEnum, aiTakeoffStatusEnum, aiTakeoffSuggestionStatusEnum, aiTakeoffRejectReasonEnum, aiTaskPriorityEnum, aiTaskStatusEnum, approvalEntityTypeEnum, approvalStatusEnum, atsProviderEnum, bidEquipmentSourceEnum, bidInvitationStatusEnum, bidRequestStatusEnum, bidResponseStatusEnum, blogCommentStatusEnum, blogPostStatusEnum, conversationTypeEnum, crewAvailabilityStatusEnum, crmActivityTypeEnum, crmCallDirectionEnum, crmCallOutcomeEnum, crmCallStatusEnum, crmCustomFieldEntityEnum, crmCustomFieldTypeEnum, crmContactRoleEnum, crmNoteTypeEnum, crmOrgStatusEnum, crmOrganisationTypeEnum, crmPipelineStageEnum, crmPreferredContactEnum, crmLostCategoryEnum, crmQuoteAcceptanceStatusEnum, crmLeadScoringOperatorEnum, crmSequenceStatusEnum, crmSequenceStepTypeEnum, crmSequenceEnrollmentStatusEnum, crmSequenceExecutionStatusEnum, crmSequenceEmailEventTypeEnum, crmSequenceExitReasonEnum, crmQuoteApprovalStatusEnum, dataSubjectRequestStatusEnum, dataSubjectRequestTypeEnum, documentRevisionSourceEnum, documentRevisionStatusEnum, emailClassificationEnum, emailProviderEnum, emailTaskSourceEnum, emailThreadStatusEnum, hiringActivityTypeEnum, hiringCandidateStageEnum, hiringCompensationTypeEnum, hiringEmploymentTypeEnum, hiringInterviewStatusEnum, hiringJobStatusEnum, hiringSyncStatusEnum, hustlerDelegateRoleEnum, hustlerLinkRequestStatusEnum, installationStatusEnum, lidarScanStatusEnum, lidarAnnotationTypeEnum, lidarComparisonTypeEnum, unifiedPaymentMethodEnum, unifiedPaymentStatusEnum, invoiceTypeEnum, integrationConnectionStatusEnum, integrationEventStatusEnum, integrationProviderEnum, issueSeverityEnum, issueStatusEnum, jobsiteAnalysisStatusEnum, lienWaiverStatusEnum, lienWaiverTypeEnum, locationLevelEnum, maintenanceTypeEnum, measurementReviewStatusEnum, measurementSourceEnum, measurementStatusEnum, measurementTypeEnum, takeoffVersionStatusEnum, messageEntityTypeEnum, mobilePlatformEnum, offlineEntityTypeEnum, offlineOperationTypeEnum, offlineSyncStatusEnum, organizationDocumentTypeEnum, organizationDocumentVisibilityEnum, overheadCostActionEnum, overheadCostCategoryEnum, overheadCostFrequencyEnum, portalChatPriorityEnum, portalChatThreadCategoryEnum, portalChatThreadStatusEnum, pricebookImportJobStatusEnum, pricebookStatusEnum, pricingApprovalStatusEnum, pricingSourceTypeEnum, projectEquipmentPlanStatusEnum, repairStatusEnum, retentionActionEnum, retentionEntityTypeEnum, rewardTypeEnum, rfiCategoryEnum, rfiPriorityEnum, rfiStatusEnum, scheduleDependencyTypeEnum, scheduleGeneratedByEnum, scheduleTaskStatusEnum, socialAccountStatusEnum, socialPlatformEnum, socialPostStatusEnum, sovPaymentMethodEnum, sovStatusEnum, storedMaterialStatusEnum, retentionReleaseTypeEnum, retentionReleaseStatusEnum, sowAuditActionEnum, ssoProviderEnum, submittalCategoryEnum, submittalItemStatusEnum, submittalPhaseEnum, submittalReviewRoleEnum, submittalReviewStatusEnum, submittalStatusEnum, submittalTypeEnum, syncStatusEnum, tradeTypeEnum, transmittalStatusEnum, userRoleEnum, vendorEnrollmentStatusEnum, voiceLogStatusEnum, websiteDeploymentActionEnum, websitePageTypeEnum, websiteProjectStatusEnum, websiteStatusEnum, takeoffIssueCategoryEnum, takeoffIssueStatusEnum, talentAvailabilityEnum, talentProfileVisibilityEnum, workflowEntityTypeEnum, riskCategoryEnum, riskStatusEnum, workflowTemplateStatusEnum, workflowInstanceStatusEnum, videoCallStatusEnum, workflowNotificationChannelEnum, dotAgencyKindEnum, dotPayItemTypeEnum, dbeCertificationTypeEnum, suretyBondTypeEnum, suretyBondStatusEnum, haulTicketStatusEnum, swpppInspectionTypeEnum, idrStatusEnum, buyAmericaStatusEnum } from "../enums";
import { bids, organizations, projects, users } from "../core";
import { changeOrders, estimateLineItems, estimates, planDocuments, projectInspections, tasks, tmTickets } from "../operations";



// Hustler Multi-Organization System
// Allows HUSTLER role users to own/manage multiple organizations
export const hustlerOrganizations = pgTable("hustler_organizations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  roleOverride: userRoleEnum("role_override"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  userIdx: index("hustler_org_user_idx").on(table.userId),
  orgIdx: index("hustler_org_org_idx").on(table.organizationId),
  userOrgUnique: unique("hustler_org_user_org_unique").on(table.userId, table.organizationId),
}));

export const insertHustlerOrganizationSchema = createInsertSchema(hustlerOrganizations).omit({ id: true, createdAt: true });
export type InsertHustlerOrganization = z.infer<typeof insertHustlerOrganizationSchema>;
export type HustlerOrganization = typeof hustlerOrganizations.$inferSelect;

// Hustler Link Requests - Invitation/Request workflow for linking HUSTLERs to organizations
export const hustlerLinkRequests = pgTable("hustler_link_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // The HUSTLER user requesting or being invited
  hustlerUserId: varchar("hustler_user_id").references(() => users.id, { onDelete: "cascade" }),
  hustlerEmail: text("hustler_email"), // Email for pending invites where user may not exist yet
  // The organization to be linked
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  // Who initiated the request
  initiatedByUserId: varchar("initiated_by_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  // Type: INVITE (admin invites hustler) or REQUEST (hustler requests access)
  requestType: text("request_type").notNull().default("INVITE"), // "INVITE" or "REQUEST"
  // Status workflow
  status: hustlerLinkRequestStatusEnum("status").notNull().default("PENDING"),
  // Secure token for email invites
  inviteToken: text("invite_token"),
  inviteTokenHash: text("invite_token_hash"),
  // Optional role override granted upon approval
  roleOverride: userRoleEnum("role_override"),
  // Message from requester/inviter
  message: text("message"),
  // Timestamps
  expiresAt: timestamp("expires_at"),
  respondedAt: timestamp("responded_at"),
  respondedByUserId: varchar("responded_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  hustlerIdx: index("hustler_link_req_hustler_idx").on(table.hustlerUserId),
  orgIdx: index("hustler_link_req_org_idx").on(table.organizationId),
  statusIdx: index("hustler_link_req_status_idx").on(table.status),
  tokenIdx: index("hustler_link_req_token_idx").on(table.inviteTokenHash),
}));

export const insertHustlerLinkRequestSchema = createInsertSchema(hustlerLinkRequests).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertHustlerLinkRequest = z.infer<typeof insertHustlerLinkRequestSchema>;
export type HustlerLinkRequest = typeof hustlerLinkRequests.$inferSelect;

// HUSTLER Delegates - COO and other executives who can manage organizations on behalf of the HUSTLER
export const hustlerDelegates = pgTable("hustler_delegates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // The HUSTLER who owns this delegate relationship
  hustlerUserId: varchar("hustler_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  // The delegate user (COO, etc.)
  delegateUserId: varchar("delegate_user_id").references(() => users.id, { onDelete: "cascade" }),
  // Email for pending invites where delegate user may not exist yet
  delegateEmail: text("delegate_email"),
  // The delegate's role in the HUSTLER's portfolio
  delegateRole: hustlerDelegateRoleEnum("delegate_role").notNull().default("COO"),
  // Invite token for pending invites
  inviteToken: text("invite_token"),
  inviteTokenHash: text("invite_token_hash"),
  // Status
  status: hustlerLinkRequestStatusEnum("status").notNull().default("PENDING"),
  // Permissions - what the delegate can do
  canCreateOrganizations: boolean("can_create_organizations").notNull().default(true),
  canManageAllOrganizations: boolean("can_manage_all_organizations").notNull().default(true),
  financialsAccess: text("financials_access").notNull().default("view"),
  canInviteOtherDelegates: boolean("can_invite_other_delegates").notNull().default(false),
  // Timestamps
  expiresAt: timestamp("expires_at"),
  acceptedAt: timestamp("accepted_at"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  hustlerIdx: index("hustler_delegate_hustler_idx").on(table.hustlerUserId),
  delegateIdx: index("hustler_delegate_delegate_idx").on(table.delegateUserId),
  tokenIdx: index("hustler_delegate_token_idx").on(table.inviteTokenHash),
  uniqueDelegate: unique("hustler_delegate_unique").on(table.hustlerUserId, table.delegateUserId),
}));

export const insertHustlerDelegateSchema = createInsertSchema(hustlerDelegates).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertHustlerDelegate = z.infer<typeof insertHustlerDelegateSchema>;
export type HustlerDelegate = typeof hustlerDelegates.$inferSelect;

// ============================================
// SUBCONTRACTOR BID REQUEST NETWORK SYSTEM
// Platform-wide bid solicitation like PlanHub/BuildingConnected
// ============================================

// Enums for bid request network
export const organizationNetworkSettings = pgTable("organization_network_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }).unique(),
  
  // Master toggles
  isNetworkEnabled: boolean("is_network_enabled").notNull().default(true),           // Overall participation in network
  canReceiveBidInvites: boolean("can_receive_bid_invites").notNull().default(true),  // Receive invites from other orgs
  canSendBidRequests: boolean("can_send_bid_requests").notNull().default(true),      // Send invites to other orgs
  
  // Trade specialties (for matching) - array of trade types this org performs
  tradeSpecialties: text("trade_specialties").array(),  // Store as array of trade type strings
  
  // Preferences
  autoAcceptFromTrustedGCs: boolean("auto_accept_from_trusted_gcs").notNull().default(false),
  trustedGCOrganizationIds: text("trusted_gc_organization_ids").array(),
  maxActiveInvites: integer("max_active_invites").default(50),
  notifyByEmail: boolean("notify_by_email").notNull().default(true),
  notifyInApp: boolean("notify_in_app").notNull().default(true),
  
  // Profile info visible to network
  companyDescription: text("company_description"),
  serviceAreas: text("service_areas").array(),  // Geographic regions served
  certifications: text("certifications").array(),
  yearsInBusiness: integer("years_in_business"),

  // Marketplace directory fields
  bio: text("bio"),
  foundedYear: integer("founded_year"),
  licenseNumbers: text("license_numbers").array(),
  portfolioPhotos: text("portfolio_photos").array(),
  isDirectoryListed: boolean("is_directory_listed").notNull().default(false),
  avgRating: decimal("avg_rating", { precision: 3, scale: 2 }),
  reviewCount: integer("review_count").notNull().default(0),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("org_network_settings_org_idx").on(table.organizationId),
}));

export const insertOrganizationNetworkSettingsSchema = createInsertSchema(organizationNetworkSettings).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOrganizationNetworkSettings = z.infer<typeof insertOrganizationNetworkSettingsSchema>;
export type OrganizationNetworkSettings = typeof organizationNetworkSettings.$inferSelect;

// Marketplace Reviews
export const marketplaceReviews = pgTable("marketplace_reviews", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  reviewerOrgId: varchar("reviewer_org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  revieweeOrgId: varchar("reviewee_org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  rating: integer("rating").notNull(),  // 1-5
  comment: text("comment"),
  projectRef: text("project_ref"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  reviewerIdx: index("marketplace_reviews_reviewer_idx").on(table.reviewerOrgId),
  revieweeIdx: index("marketplace_reviews_reviewee_idx").on(table.revieweeOrgId),
  uniquePairIdx: unique("marketplace_reviews_unique_pair").on(table.reviewerOrgId, table.revieweeOrgId),
}));

export const insertMarketplaceReviewSchema = createInsertSchema(marketplaceReviews).omit({ id: true, createdAt: true });
export type InsertMarketplaceReview = z.infer<typeof insertMarketplaceReviewSchema>;
export type MarketplaceReview = typeof marketplaceReviews.$inferSelect;