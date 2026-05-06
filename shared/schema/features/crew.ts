// AUTO-GENERATED SPLIT FROM shared/schema/features.ts (Task #2426).
// Domain bucketing rule lives in shared/schema/features/index.ts.
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, date, decimal, integer, pgEnum, doublePrecision, index, unique, uniqueIndex, json, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { addendumRecipientTypeEnum, addendumStatusEnum, aiBidDocumentAnalysisStatusEnum, aiCoDraftStatusEnum, aiContractDocumentAnalysisStatusEnum, contractStatusEnum, contractTypeEnum, contractRedlineStatusEnum, contractApprovalDecisionEnum, clauseCategoryEnum, signatureRequestStatusEnum, signerStatusEnum, aiInsightModuleEnum, aiInsightSeverityEnum, aiTakeoffModeEnum, aiTakeoffStatusEnum, aiTakeoffSuggestionStatusEnum, aiTakeoffRejectReasonEnum, aiTaskPriorityEnum, aiTaskStatusEnum, approvalEntityTypeEnum, approvalStatusEnum, atsProviderEnum, bidEquipmentSourceEnum, bidInvitationStatusEnum, bidRequestStatusEnum, bidResponseStatusEnum, blogCommentStatusEnum, blogPostStatusEnum, conversationTypeEnum, crewAvailabilityStatusEnum, crmActivityTypeEnum, crmCallDirectionEnum, crmCallOutcomeEnum, crmCallStatusEnum, crmCustomFieldEntityEnum, crmCustomFieldTypeEnum, crmContactRoleEnum, crmNoteTypeEnum, crmOrgStatusEnum, crmOrganisationTypeEnum, crmPipelineStageEnum, crmPreferredContactEnum, crmLostCategoryEnum, crmQuoteAcceptanceStatusEnum, crmLeadScoringOperatorEnum, crmSequenceStatusEnum, crmSequenceStepTypeEnum, crmSequenceEnrollmentStatusEnum, crmSequenceExecutionStatusEnum, crmSequenceEmailEventTypeEnum, crmSequenceExitReasonEnum, crmQuoteApprovalStatusEnum, dataSubjectRequestStatusEnum, dataSubjectRequestTypeEnum, documentRevisionSourceEnum, documentRevisionStatusEnum, emailClassificationEnum, emailProviderEnum, emailTaskSourceEnum, emailThreadStatusEnum, hiringActivityTypeEnum, hiringCandidateStageEnum, hiringCompensationTypeEnum, hiringEmploymentTypeEnum, hiringInterviewStatusEnum, hiringJobStatusEnum, hiringSyncStatusEnum, hustlerDelegateRoleEnum, hustlerLinkRequestStatusEnum, installationStatusEnum, lidarScanStatusEnum, lidarAnnotationTypeEnum, lidarComparisonTypeEnum, unifiedPaymentMethodEnum, unifiedPaymentStatusEnum, invoiceTypeEnum, integrationConnectionStatusEnum, integrationEventStatusEnum, integrationProviderEnum, issueSeverityEnum, issueStatusEnum, jobsiteAnalysisStatusEnum, lienWaiverStatusEnum, lienWaiverTypeEnum, locationLevelEnum, maintenanceTypeEnum, measurementReviewStatusEnum, measurementSourceEnum, measurementStatusEnum, measurementTypeEnum, takeoffVersionStatusEnum, messageEntityTypeEnum, mobilePlatformEnum, offlineEntityTypeEnum, offlineOperationTypeEnum, offlineSyncStatusEnum, organizationDocumentTypeEnum, organizationDocumentVisibilityEnum, overheadCostActionEnum, overheadCostCategoryEnum, overheadCostFrequencyEnum, portalChatPriorityEnum, portalChatThreadCategoryEnum, portalChatThreadStatusEnum, pricebookImportJobStatusEnum, pricebookStatusEnum, pricingApprovalStatusEnum, pricingSourceTypeEnum, projectEquipmentPlanStatusEnum, repairStatusEnum, retentionActionEnum, retentionEntityTypeEnum, rewardTypeEnum, rfiCategoryEnum, rfiPriorityEnum, rfiStatusEnum, scheduleDependencyTypeEnum, scheduleGeneratedByEnum, scheduleTaskStatusEnum, socialAccountStatusEnum, socialPlatformEnum, socialPostStatusEnum, sovPaymentMethodEnum, sovStatusEnum, storedMaterialStatusEnum, retentionReleaseTypeEnum, retentionReleaseStatusEnum, sowAuditActionEnum, ssoProviderEnum, submittalCategoryEnum, submittalItemStatusEnum, submittalPhaseEnum, submittalReviewRoleEnum, submittalReviewStatusEnum, submittalStatusEnum, submittalTypeEnum, syncStatusEnum, tradeTypeEnum, transmittalStatusEnum, userRoleEnum, vendorEnrollmentStatusEnum, voiceLogStatusEnum, websiteDeploymentActionEnum, websitePageTypeEnum, websiteProjectStatusEnum, websiteStatusEnum, takeoffIssueCategoryEnum, takeoffIssueStatusEnum, talentAvailabilityEnum, talentProfileVisibilityEnum, workflowEntityTypeEnum, riskCategoryEnum, riskStatusEnum, workflowTemplateStatusEnum, workflowInstanceStatusEnum, videoCallStatusEnum, workflowNotificationChannelEnum, dotAgencyKindEnum, dotPayItemTypeEnum, dbeCertificationTypeEnum, suretyBondTypeEnum, suretyBondStatusEnum, haulTicketStatusEnum, swpppInspectionTypeEnum, idrStatusEnum, buyAmericaStatusEnum } from "../enums";
import { bids, organizations, projects, users } from "../core";
import { changeOrders, estimateLineItems, estimates, planDocuments, projectInspections, tasks, tmTickets } from "../operations";



// Crews table
export const crews = pgTable("crews", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  description: text("description"),
  leadId: varchar("lead_id").references(() => users.id),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertCrewSchema = createInsertSchema(crews).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCrew = z.infer<typeof insertCrewSchema>;
export type Crew = typeof crews.$inferSelect;

// Crew Members table
export const crewMembers = pgTable("crew_members", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  crewId: varchar("crew_id").notNull().references(() => crews.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role"),
  addedAt: timestamp("added_at").notNull().defaultNow(),
});

export const insertCrewMemberSchema = createInsertSchema(crewMembers).omit({ id: true, addedAt: true });
export type InsertCrewMember = z.infer<typeof insertCrewMemberSchema>;
export type CrewMember = typeof crewMembers.$inferSelect;

// Skills table
export const skills = pgTable("skills", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  category: text("category"),
  description: text("description"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertSkillSchema = createInsertSchema(skills).omit({ id: true, createdAt: true });
export type InsertSkill = z.infer<typeof insertSkillSchema>;
export type Skill = typeof skills.$inferSelect;

// User Skills table (junction table)
export const userSkills = pgTable("user_skills", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  skillId: varchar("skill_id").notNull().references(() => skills.id, { onDelete: "cascade" }),
  proficiencyLevel: text("proficiency_level"),
  starRating: integer("star_rating").default(0),
  yearsExperience: integer("years_experience"),
  certifiedAt: timestamp("certified_at"),
  verificationStatus: text("verification_status").default("unverified"),
  verifiedByUserId: varchar("verified_by_user_id"),
  verifiedAt: timestamp("verified_at"),
  addedAt: timestamp("added_at").notNull().defaultNow(),
});

export const insertUserSkillSchema = createInsertSchema(userSkills).omit({ id: true, addedAt: true });
export type InsertUserSkill = z.infer<typeof insertUserSkillSchema>;
export type UserSkill = typeof userSkills.$inferSelect;

// Skill Verification Requests
export const skillVerificationRequests = pgTable("skill_verification_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userSkillId: varchar("user_skill_id").notNull().references(() => userSkills.id, { onDelete: "cascade" }),
  requestedByUserId: varchar("requested_by_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  requestedToUserId: varchar("requested_to_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
});

export const insertSkillVerificationRequestSchema = createInsertSchema(skillVerificationRequests).omit({ id: true, createdAt: true, resolvedAt: true });
export type InsertSkillVerificationRequest = z.infer<typeof insertSkillVerificationRequestSchema>;
export type SkillVerificationRequest = typeof skillVerificationRequests.$inferSelect;

// User Certifications
export const userCertifications = pgTable("user_certifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull(),
  certificationName: text("certification_name").notNull(),
  issuedDate: timestamp("issued_date"),
  expiryDate: timestamp("expiry_date"),
  fileUrl: text("file_url"),
  fileObjectKey: text("file_object_key"),
  fileName: text("file_name"),
  status: text("status").notNull().default("active"),
  expiryNotified30Days: boolean("expiry_notified_30_days").default(false),
  expiryNotified5Days: boolean("expiry_notified_5_days").default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertUserCertificationSchema = createInsertSchema(userCertifications).omit({ id: true, createdAt: true, updatedAt: true, expiryNotified30Days: true, expiryNotified5Days: true });
export type InsertUserCertification = z.infer<typeof insertUserCertificationSchema>;
export type UserCertification = typeof userCertifications.$inferSelect;

// User Equipment Competencies
export const userEquipmentCompetencies = pgTable("user_equipment_competencies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull(),
  equipmentName: text("equipment_name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertUserEquipmentCompetencySchema = createInsertSchema(userEquipmentCompetencies).omit({ id: true, createdAt: true });
export type InsertUserEquipmentCompetency = z.infer<typeof insertUserEquipmentCompetencySchema>;
export type UserEquipmentCompetency = typeof userEquipmentCompetencies.$inferSelect;

// User Photos table - profile photo gallery
export const userPhotos = pgTable("user_photos", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url").notNull(),
  objectKey: text("object_key"),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
});

export const insertUserPhotoSchema = createInsertSchema(userPhotos).omit({ id: true, uploadedAt: true });
export type InsertUserPhoto = z.infer<typeof insertUserPhotoSchema>;
export type UserPhoto = typeof userPhotos.$inferSelect;

// Crew Project Assignments table
export const crewProjectAssignments = pgTable("crew_project_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  crewId: varchar("crew_id").notNull().references(() => crews.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  assignedById: varchar("assigned_by_id").notNull().references(() => users.id),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertCrewProjectAssignmentSchema = createInsertSchema(crewProjectAssignments).omit({ id: true, createdAt: true });
export type InsertCrewProjectAssignment = z.infer<typeof insertCrewProjectAssignmentSchema>;
export type CrewProjectAssignment = typeof crewProjectAssignments.$inferSelect;

// Crew Marketplace table - Labor/crew availability listings
export const crewMarketplace = pgTable("crew_marketplace", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  crewId: varchar("crew_id").references(() => crews.id, { onDelete: "set null" }),
  
  // Crew identification
  crewName: text("crew_name").notNull(),
  tradeType: tradeTypeEnum("trade_type").notNull(),
  crewSize: integer("crew_size"),
  
  // Availability
  availabilityStatus: crewAvailabilityStatusEnum("availability_status").notNull().default("AVAILABLE"),
  availableFrom: date("available_from"),
  availableTo: date("available_to"),
  
  // Rates
  hourlyRate: decimal("hourly_rate", { precision: 10, scale: 2 }),
  dailyRate: decimal("daily_rate", { precision: 10, scale: 2 }),
  
  // Location and coverage
  baseLocation: text("base_location"),  // City, State
  travelRadius: integer("travel_radius"),  // Miles willing to travel
  
  // Skills and certifications
  skills: text("skills").array(),
  certifications: text("certifications").array(),
  equipmentOwned: text("equipment_owned").array(),
  
  // Performance
  rating: decimal("rating", { precision: 3, scale: 2 }),  // 1-5 average rating
  completedProjects: integer("completed_projects").default(0),
  
  // Contact preference
  contactName: text("contact_name"),
  contactPhone: text("contact_phone"),
  contactEmail: text("contact_email"),
  
  // Description
  description: text("description"),
  
  // Visibility
  isPublic: boolean("is_public").notNull().default(true),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("crew_marketplace_org_idx").on(table.organizationId),
  crewIdx: index("crew_marketplace_crew_idx").on(table.crewId),
  tradeIdx: index("crew_marketplace_trade_idx").on(table.tradeType),
  availabilityIdx: index("crew_marketplace_availability_idx").on(table.availabilityStatus),
  locationIdx: index("crew_marketplace_location_idx").on(table.baseLocation),
}));

export const insertCrewMarketplaceSchema = createInsertSchema(crewMarketplace).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCrewMarketplace = z.infer<typeof insertCrewMarketplaceSchema>;
export type CrewMarketplace = typeof crewMarketplace.$inferSelect;