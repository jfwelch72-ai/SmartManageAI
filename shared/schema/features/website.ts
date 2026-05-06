// AUTO-GENERATED SPLIT FROM shared/schema/features.ts (Task #2426).
// Domain bucketing rule lives in shared/schema/features/index.ts.
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, date, decimal, integer, pgEnum, doublePrecision, index, unique, uniqueIndex, json, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { addendumRecipientTypeEnum, addendumStatusEnum, aiBidDocumentAnalysisStatusEnum, aiCoDraftStatusEnum, aiContractDocumentAnalysisStatusEnum, contractStatusEnum, contractTypeEnum, contractRedlineStatusEnum, contractApprovalDecisionEnum, clauseCategoryEnum, signatureRequestStatusEnum, signerStatusEnum, aiInsightModuleEnum, aiInsightSeverityEnum, aiTakeoffModeEnum, aiTakeoffStatusEnum, aiTakeoffSuggestionStatusEnum, aiTakeoffRejectReasonEnum, aiTaskPriorityEnum, aiTaskStatusEnum, approvalEntityTypeEnum, approvalStatusEnum, atsProviderEnum, bidEquipmentSourceEnum, bidInvitationStatusEnum, bidRequestStatusEnum, bidResponseStatusEnum, blogCommentStatusEnum, blogPostStatusEnum, conversationTypeEnum, crewAvailabilityStatusEnum, crmActivityTypeEnum, crmCallDirectionEnum, crmCallOutcomeEnum, crmCallStatusEnum, crmCustomFieldEntityEnum, crmCustomFieldTypeEnum, crmContactRoleEnum, crmNoteTypeEnum, crmOrgStatusEnum, crmOrganisationTypeEnum, crmPipelineStageEnum, crmPreferredContactEnum, crmLostCategoryEnum, crmQuoteAcceptanceStatusEnum, crmLeadScoringOperatorEnum, crmSequenceStatusEnum, crmSequenceStepTypeEnum, crmSequenceEnrollmentStatusEnum, crmSequenceExecutionStatusEnum, crmSequenceEmailEventTypeEnum, crmSequenceExitReasonEnum, crmQuoteApprovalStatusEnum, dataSubjectRequestStatusEnum, dataSubjectRequestTypeEnum, documentRevisionSourceEnum, documentRevisionStatusEnum, emailClassificationEnum, emailProviderEnum, emailTaskSourceEnum, emailThreadStatusEnum, hiringActivityTypeEnum, hiringCandidateStageEnum, hiringCompensationTypeEnum, hiringEmploymentTypeEnum, hiringInterviewStatusEnum, hiringJobStatusEnum, hiringSyncStatusEnum, hustlerDelegateRoleEnum, hustlerLinkRequestStatusEnum, installationStatusEnum, lidarScanStatusEnum, lidarAnnotationTypeEnum, lidarComparisonTypeEnum, unifiedPaymentMethodEnum, unifiedPaymentStatusEnum, invoiceTypeEnum, integrationConnectionStatusEnum, integrationEventStatusEnum, integrationProviderEnum, issueSeverityEnum, issueStatusEnum, jobsiteAnalysisStatusEnum, lienWaiverStatusEnum, lienWaiverTypeEnum, locationLevelEnum, maintenanceTypeEnum, measurementReviewStatusEnum, measurementSourceEnum, measurementStatusEnum, measurementTypeEnum, takeoffVersionStatusEnum, messageEntityTypeEnum, mobilePlatformEnum, offlineEntityTypeEnum, offlineOperationTypeEnum, offlineSyncStatusEnum, organizationDocumentTypeEnum, organizationDocumentVisibilityEnum, overheadCostActionEnum, overheadCostCategoryEnum, overheadCostFrequencyEnum, portalChatPriorityEnum, portalChatThreadCategoryEnum, portalChatThreadStatusEnum, pricebookImportJobStatusEnum, pricebookStatusEnum, pricingApprovalStatusEnum, pricingSourceTypeEnum, projectEquipmentPlanStatusEnum, repairStatusEnum, retentionActionEnum, retentionEntityTypeEnum, rewardTypeEnum, rfiCategoryEnum, rfiPriorityEnum, rfiStatusEnum, scheduleDependencyTypeEnum, scheduleGeneratedByEnum, scheduleTaskStatusEnum, socialAccountStatusEnum, socialPlatformEnum, socialPostStatusEnum, sovPaymentMethodEnum, sovStatusEnum, storedMaterialStatusEnum, retentionReleaseTypeEnum, retentionReleaseStatusEnum, sowAuditActionEnum, ssoProviderEnum, submittalCategoryEnum, submittalItemStatusEnum, submittalPhaseEnum, submittalReviewRoleEnum, submittalReviewStatusEnum, submittalStatusEnum, submittalTypeEnum, syncStatusEnum, tradeTypeEnum, transmittalStatusEnum, userRoleEnum, vendorEnrollmentStatusEnum, voiceLogStatusEnum, websiteDeploymentActionEnum, websitePageTypeEnum, websiteProjectStatusEnum, websiteStatusEnum, takeoffIssueCategoryEnum, takeoffIssueStatusEnum, talentAvailabilityEnum, talentProfileVisibilityEnum, workflowEntityTypeEnum, riskCategoryEnum, riskStatusEnum, workflowTemplateStatusEnum, workflowInstanceStatusEnum, videoCallStatusEnum, workflowNotificationChannelEnum, dotAgencyKindEnum, dotPayItemTypeEnum, dbeCertificationTypeEnum, suretyBondTypeEnum, suretyBondStatusEnum, haulTicketStatusEnum, swpppInspectionTypeEnum, idrStatusEnum, buyAmericaStatusEnum } from "../enums";
import { bids, organizations, projects, users } from "../core";
import { changeOrders, estimateLineItems, estimates, planDocuments, projectInspections, tasks, tmTickets } from "../operations";
import { crmContacts, crmOrganisations } from "./crm";



// ============================================
// WEBSITE BUILDER SYSTEM
// Complete website builder with AI design, blog, gallery, analytics
// ============================================

// Website Builder Enums
export const organizationWebsites = pgTable("organization_websites", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  
  // Site Configuration
  status: websiteStatusEnum("status").notNull().default("DRAFT"),
  siteTitle: text("site_title"),
  siteTagline: text("site_tagline"),
  missionStatement: text("mission_statement"),
  
  // Domain Settings
  subdomain: text("subdomain").unique(), // company.smartmanageai-sites.com
  customDomain: text("custom_domain"),
  customDomainVerified: boolean("custom_domain_verified").default(false),
  sslEnabled: boolean("ssl_enabled").default(true),
  stagingToken: text("staging_token"),
  
  // Theme & Branding
  primaryColor: text("primary_color"),
  secondaryColor: text("secondary_color"),
  accentColor: text("accent_color"),
  backgroundColor: text("background_color"),
  textColor: text("text_color"),
  fontFamily: text("font_family"),
  templateId: text("template_id"),
  logoUrl: text("logo_url"),
  faviconUrl: text("favicon_url"),
  logoHeight: integer("logo_height").default(55),
  
  // SEO Global Settings
  defaultMetaTitle: text("default_meta_title"),
  defaultMetaDescription: text("default_meta_description"),
  defaultKeywords: text("default_keywords").array(),
  ogImageUrl: text("og_image_url"),
  googleAnalyticsId: text("google_analytics_id"),
  
  // Contact Info (can override organization)
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  contactAddress: text("contact_address"),
  
  // Global Layout Settings
  contentWidth: text("content_width").default("full-width"),
  maxWidth: integer("max_width").default(1200),
  sectionPadding: integer("section_padding").default(24),
  breakpointDesktop: integer("breakpoint_desktop").default(1280),
  breakpointTablet: integer("breakpoint_tablet").default(768),
  breakpointMobile: integer("breakpoint_mobile").default(480),
  
  // Header Layout Settings
  headerType: text("header_type").default("static"),
  headerHeight: integer("header_height").default(80),
  logoPosition: text("logo_position").default("left"),
  navigationLayout: text("navigation_layout").default("horizontal"),
  mobileNavStyle: text("mobile_nav_style").default("dropdown"),
  showOnScroll: boolean("show_on_scroll").default(true),
  
  // Inner Page Layout Settings
  pageLayout: text("page_layout").default("boxed"),
  sidebarWidth: integer("sidebar_width").default(300),
  pagePadding: integer("page_padding").default(32),
  showBreadcrumb: boolean("show_breadcrumb").default(true),

  // Footer Layout Settings
  footerVisibility: boolean("footer_visibility").default(true),
  footerColumns: integer("footer_columns").default(3),
  footerWidth: text("footer_width").default("boxed"),
  footerPadding: integer("footer_padding").default(40),
  footerSectionSettings: json("footer_section_settings"),
  headerSectionSettings: json("header_section_settings"),

  // Component Configurations (JSON)
  headerComponentsConfig: json("header_components_config"),
  footerComponentsConfig: json("footer_components_config"),
  bodyComponentsConfig: json("body_components_config"),
  globalComponentsConfig: json("global_components_config"),
  
  // Features Toggle
  blogEnabled: boolean("blog_enabled").default(true),
  galleryEnabled: boolean("gallery_enabled").default(true),
  contactFormEnabled: boolean("contact_form_enabled").default(true),
  analyticsEnabled: boolean("analytics_enabled").default(true),
  careersEnabled: boolean("careers_enabled").default(false),
  careersIntroText: text("careers_intro_text"),
  
  // Publishing
  lastPublishedAt: timestamp("last_published_at"),
  lastPublishedByUserId: varchar("last_published_by_user_id").references(() => users.id),
  publishedBundleUrl: text("published_bundle_url"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("website_org_idx").on(table.organizationId),
  subdomainIdx: index("website_subdomain_idx").on(table.subdomain),
}));

export const insertOrganizationWebsiteSchema = createInsertSchema(organizationWebsites).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOrganizationWebsite = z.infer<typeof insertOrganizationWebsiteSchema>;
export type OrganizationWebsite = typeof organizationWebsites.$inferSelect;

export const websiteDeployments = pgTable("website_deployments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  websiteId: varchar("website_id").notNull().references(() => organizationWebsites.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  action: websiteDeploymentActionEnum("action").notNull(),
  performedByUserId: varchar("performed_by_user_id").notNull().references(() => users.id),
  performedByName: text("performed_by_name"),
  note: text("note"),
  snapshotUrl: text("snapshot_url"),
  metadata: json("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  websiteIdx: index("deployment_website_idx").on(table.websiteId),
  orgIdx: index("deployment_org_idx").on(table.organizationId),
  createdAtIdx: index("deployment_created_at_idx").on(table.createdAt),
}));

export const insertWebsiteDeploymentSchema = createInsertSchema(websiteDeployments).omit({ id: true, createdAt: true });
export type InsertWebsiteDeployment = z.infer<typeof insertWebsiteDeploymentSchema>;
export type WebsiteDeployment = typeof websiteDeployments.$inferSelect;

// Website Pages
export const organizationWebsitePages = pgTable("organization_website_pages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  websiteId: varchar("website_id").notNull().references(() => organizationWebsites.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  
  // Page Identity
  pageType: websitePageTypeEnum("page_type").notNull().default("CUSTOM"),
  pageSlug: text("page_slug").notNull(), // e.g., "about", "services/concrete"
  pageTitle: text("page_title").notNull(),
  
  // Content
  contentJson: text("content_json"), // Block-based content structure
  heroImageUrl: text("hero_image_url"),
  aiGenerated: boolean("ai_generated").default(false),
  
  // SEO
  metaTitle: text("meta_title"),
  metaDescription: text("meta_description"),
  keywords: text("keywords").array(),
  richSchemaJson: text("rich_schema_json"), // JSON-LD structured data
  canonicalUrl: text("canonical_url"),
  noIndex: boolean("no_index").default(false),
  ogImageUrl: text("og_image_url"),
  
  // Display Settings
  isPublished: boolean("is_published").default(false),
  showInNavigation: boolean("show_in_navigation").default(true),
  navigationOrder: integer("navigation_order").default(0),
  navigationLabel: text("navigation_label"),
  parentPageId: varchar("parent_page_id"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  websiteIdx: index("website_pages_website_idx").on(table.websiteId),
  orgIdx: index("website_pages_org_idx").on(table.organizationId),
  slugIdx: index("website_pages_slug_idx").on(table.websiteId, table.pageSlug),
}));

export const insertOrganizationWebsitePageSchema = createInsertSchema(organizationWebsitePages).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOrganizationWebsitePage = z.infer<typeof insertOrganizationWebsitePageSchema>;
export type OrganizationWebsitePage = typeof organizationWebsitePages.$inferSelect;

// Page Preview Links (shareable read-only preview)
export const pagePreviewLinks = pgTable("page_preview_links", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  pageId: varchar("page_id").notNull().references(() => organizationWebsitePages.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  token: varchar("token").notNull().unique(),
  createdById: varchar("created_by_id").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  tokenIdx: index("preview_links_token_idx").on(table.token),
  pageIdx: index("preview_links_page_idx").on(table.pageId),
}));

export const insertPagePreviewLinkSchema = createInsertSchema(pagePreviewLinks).omit({ id: true, createdAt: true });
export type InsertPagePreviewLink = z.infer<typeof insertPagePreviewLinkSchema>;
export type PagePreviewLink = typeof pagePreviewLinks.$inferSelect;

// Page Versions (version history / snapshots)
export const pageVersions = pgTable("page_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  pageId: varchar("page_id").notNull().references(() => organizationWebsitePages.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  contentJson: text("content_json"),
  pageSettingsJson: text("page_settings_json"),
  editorId: varchar("editor_id").notNull(),
  editorName: text("editor_name").notNull(),
  changeSummary: text("change_summary"),
  trigger: text("trigger").notNull().default("manual"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  pageIdx: index("page_versions_page_idx").on(table.pageId),
  versionIdx: index("page_versions_version_idx").on(table.pageId, table.versionNumber),
}));

export const insertPageVersionSchema = createInsertSchema(pageVersions).omit({ id: true, createdAt: true });
export type InsertPageVersion = z.infer<typeof insertPageVersionSchema>;
export type PageVersion = typeof pageVersions.$inferSelect;

// Blog Posts
export const websiteBlogPosts = pgTable("website_blog_posts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  websiteId: varchar("website_id").notNull().references(() => organizationWebsites.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  
  // Post Content
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  excerpt: text("excerpt"),
  contentJson: text("content_json"), // Block-based editor content
  contentHtml: text("content_html"), // Rendered HTML for public display
  coverImageUrl: text("cover_image_url"),
  
  // Categorization
  category: text("category"),
  tags: text("tags").array(),
  
  // Author
  authorId: varchar("author_id").references(() => users.id),
  authorName: text("author_name"),
  
  // AI Generation
  aiGenerated: boolean("ai_generated").default(false),
  aiPrompt: text("ai_prompt"),
  
  // SEO
  metaTitle: text("meta_title"),
  metaDescription: text("meta_description"),
  keywords: text("keywords").array(),
  richSchemaJson: text("rich_schema_json"),
  
  // Status & Publishing
  status: blogPostStatusEnum("status").notNull().default("DRAFT"),
  publishedAt: timestamp("published_at"),
  featuredPost: boolean("featured_post").default(false),
  
  // Engagement
  viewCount: integer("view_count").default(0),
  shareCount: integer("share_count").default(0),
  commentsEnabled: boolean("comments_enabled").default(true),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  websiteIdx: index("blog_posts_website_idx").on(table.websiteId),
  orgIdx: index("blog_posts_org_idx").on(table.organizationId),
  slugIdx: index("blog_posts_slug_idx").on(table.websiteId, table.slug),
  statusIdx: index("blog_posts_status_idx").on(table.status),
}));

export const insertWebsiteBlogPostSchema = createInsertSchema(websiteBlogPosts).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWebsiteBlogPost = z.infer<typeof insertWebsiteBlogPostSchema>;
export type WebsiteBlogPost = typeof websiteBlogPosts.$inferSelect;

// Blog Comments
export const websiteBlogComments = pgTable("website_blog_comments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  postId: varchar("post_id").notNull().references(() => websiteBlogPosts.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  
  // Comment Content
  authorName: text("author_name").notNull(),
  authorEmail: text("author_email").notNull(),
  authorWebsite: text("author_website"),
  content: text("content").notNull(),
  
  // Moderation
  status: blogCommentStatusEnum("status").notNull().default("PENDING"),
  moderatedById: varchar("moderated_by_id").references(() => users.id),
  moderatedAt: timestamp("moderated_at"),
  
  // Replies
  parentCommentId: varchar("parent_comment_id"),
  
  // Metadata
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  postIdx: index("blog_comments_post_idx").on(table.postId),
  statusIdx: index("blog_comments_status_idx").on(table.status),
}));

export const insertWebsiteBlogCommentSchema = createInsertSchema(websiteBlogComments).omit({ id: true, createdAt: true });
export type InsertWebsiteBlogComment = z.infer<typeof insertWebsiteBlogCommentSchema>;
export type WebsiteBlogComment = typeof websiteBlogComments.$inferSelect;

// Project Gallery / Portfolio
export const websiteProjects = pgTable("website_projects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  websiteId: varchar("website_id").notNull().references(() => organizationWebsites.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  
  // Link to actual project (optional)
  linkedProjectId: varchar("linked_project_id").references(() => projects.id, { onDelete: "set null" }),
  
  // Project Details
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  shortDescription: text("short_description"),
  fullDescription: text("full_description"),
  
  // Categorization
  serviceType: text("service_type"), // Matches trade/service type
  projectType: text("project_type"), // Commercial, Residential, Industrial
  location: text("location"),
  completionDate: date("completion_date"),
  
  // Media
  coverImageUrl: text("cover_image_url"),
  beforeImageUrl: text("before_image_url"),
  afterImageUrl: text("after_image_url"),
  
  // AI Content
  aiGenerated: boolean("ai_generated").default(false),
  aiPrompt: text("ai_prompt"),
  
  // SEO
  metaTitle: text("meta_title"),
  metaDescription: text("meta_description"),
  keywords: text("keywords").array(),
  richSchemaJson: text("rich_schema_json"),
  
  // Display Settings
  status: websiteProjectStatusEnum("status").notNull().default("DRAFT"),
  featured: boolean("featured").default(false),
  displayOrder: integer("display_order").default(0),
  
  // Engagement
  viewCount: integer("view_count").default(0),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  websiteIdx: index("website_projects_website_idx").on(table.websiteId),
  orgIdx: index("website_projects_org_idx").on(table.organizationId),
  slugIdx: index("website_projects_slug_idx").on(table.websiteId, table.slug),
  statusIdx: index("website_projects_status_idx").on(table.status),
}));

export const insertWebsiteProjectSchema = createInsertSchema(websiteProjects).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWebsiteProject = z.infer<typeof insertWebsiteProjectSchema>;
export type WebsiteProject = typeof websiteProjects.$inferSelect;

// Project Gallery Images
export const websiteProjectImages = pgTable("website_project_images", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => websiteProjects.id, { onDelete: "cascade" }),
  
  imageUrl: text("image_url").notNull(),
  thumbnailUrl: text("thumbnail_url"),
  altText: text("alt_text"),
  caption: text("caption"),
  displayOrder: integer("display_order").default(0),
  
  // AI-generated caption
  aiCaption: text("ai_caption"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  projectIdx: index("project_images_project_idx").on(table.projectId),
}));

export const insertWebsiteProjectImageSchema = createInsertSchema(websiteProjectImages).omit({ id: true, createdAt: true });
export type InsertWebsiteProjectImage = z.infer<typeof insertWebsiteProjectImageSchema>;
export type WebsiteProjectImage = typeof websiteProjectImages.$inferSelect;

// Website Analytics - Daily Aggregates
export const websiteAnalyticsDaily = pgTable("website_analytics_daily", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  websiteId: varchar("website_id").notNull().references(() => organizationWebsites.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  
  // Date dimension
  date: date("date").notNull(),
  
  // Traffic Metrics
  pageViews: integer("page_views").default(0),
  uniqueVisitors: integer("unique_visitors").default(0),
  sessions: integer("sessions").default(0),
  avgSessionDuration: integer("avg_session_duration").default(0), // in seconds
  bounceRate: decimal("bounce_rate", { precision: 5, scale: 2 }),
  
  // Top Pages (JSON array)
  topPagesJson: text("top_pages_json"),
  
  // Traffic Sources (JSON)
  trafficSourcesJson: text("traffic_sources_json"),
  
  // Lead Metrics
  contactFormSubmissions: integer("contact_form_submissions").default(0),
  phoneClicks: integer("phone_clicks").default(0),
  emailClicks: integer("email_clicks").default(0),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  websiteDateIdx: index("analytics_daily_website_date_idx").on(table.websiteId, table.date),
  orgIdx: index("analytics_daily_org_idx").on(table.organizationId),
}));

export const insertWebsiteAnalyticsDailySchema = createInsertSchema(websiteAnalyticsDaily).omit({ id: true, createdAt: true });
export type InsertWebsiteAnalyticsDaily = z.infer<typeof insertWebsiteAnalyticsDailySchema>;
export type WebsiteAnalyticsDaily = typeof websiteAnalyticsDaily.$inferSelect;

// Website Analytics - Individual Events
export const websiteAnalyticsEvents = pgTable("website_analytics_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  websiteId: varchar("website_id").notNull().references(() => organizationWebsites.id, { onDelete: "cascade" }),
  
  // Session Info
  sessionId: text("session_id").notNull(),
  visitorId: text("visitor_id"), // Persistent visitor identifier
  
  // Event Details
  eventType: text("event_type").notNull(), // PAGE_VIEW, CLICK, FORM_SUBMIT, etc.
  pagePath: text("page_path"),
  pageTitle: text("page_title"),
  referrer: text("referrer"),
  
  // Event Data
  eventDataJson: text("event_data_json"), // Custom event properties
  
  // Visitor Info
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  deviceType: text("device_type"), // desktop, mobile, tablet
  browser: text("browser"),
  os: text("os"),
  country: text("country"),
  city: text("city"),
  
  // UTM Parameters
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  websiteIdx: index("analytics_events_website_idx").on(table.websiteId),
  sessionIdx: index("analytics_events_session_idx").on(table.sessionId),
  eventTypeIdx: index("analytics_events_type_idx").on(table.eventType),
  createdAtIdx: index("analytics_events_created_idx").on(table.createdAt),
}));

export const insertWebsiteAnalyticsEventSchema = createInsertSchema(websiteAnalyticsEvents).omit({ id: true, createdAt: true });
export type InsertWebsiteAnalyticsEvent = z.infer<typeof insertWebsiteAnalyticsEventSchema>;
export type WebsiteAnalyticsEvent = typeof websiteAnalyticsEvents.$inferSelect;

// Social Media Links
export const organizationSocialLinks = pgTable("organization_social_links", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }).unique(),
  
  facebookUrl: text("facebook_url"),
  instagramUrl: text("instagram_url"),
  linkedinUrl: text("linkedin_url"),
  twitterUrl: text("twitter_url"),
  tiktokUrl: text("tiktok_url"),
  youtubeUrl: text("youtube_url"),
  
  // Display Settings
  showOnWebsite: boolean("show_on_website").default(true),
  showInFooter: boolean("show_in_footer").default(true),
  showOnContact: boolean("show_on_contact").default(true),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("social_links_org_idx").on(table.organizationId),
}));

export const insertOrganizationSocialLinksSchema = createInsertSchema(organizationSocialLinks).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOrganizationSocialLinks = z.infer<typeof insertOrganizationSocialLinksSchema>;
export type OrganizationSocialLinks = typeof organizationSocialLinks.$inferSelect;

// AI Social Post History
export const socialPostHistory = pgTable("social_post_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  
  // Platform & Content
  platform: socialPlatformEnum("platform").notNull(),
  postContent: text("post_content").notNull(),
  hashtags: text("hashtags").array(),
  
  // Content Source
  sourceType: text("source_type"), // BLOG_POST, PROJECT, EVENT, SAFETY, CUSTOM
  sourceId: varchar("source_id"), // ID of linked blog post or project
  
  // AI Generation
  aiPrompt: text("ai_prompt"),
  tone: text("tone"), // professional, casual, marketing, humorous
  
  // Suggested Image
  suggestedImageUrl: text("suggested_image_url"),
  suggestedImagePrompt: text("suggested_image_prompt"),
  
  // Publishing Status
  exported: boolean("exported").default(false),
  exportedAt: timestamp("exported_at"),
  
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("social_post_history_org_idx").on(table.organizationId),
  platformIdx: index("social_post_history_platform_idx").on(table.platform),
}));

export const insertSocialPostHistorySchema = createInsertSchema(socialPostHistory).omit({ id: true, createdAt: true });
export type InsertSocialPostHistory = z.infer<typeof insertSocialPostHistorySchema>;
export type SocialPostHistory = typeof socialPostHistory.$inferSelect;

// Website Contact Form Submissions (CRM Integration)
export const websiteContactSubmissions = pgTable("website_contact_submissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  websiteId: varchar("website_id").notNull().references(() => organizationWebsites.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  
  // Contact Info
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  company: text("company"),
  
  // Message
  subject: text("subject"),
  message: text("message").notNull(),
  
  // Service Interest
  serviceInterest: text("service_interest"),
  projectType: text("project_type"),
  estimatedBudget: text("estimated_budget"),
  preferredContactMethod: text("preferred_contact_method"),
  
  // Source Tracking
  sourcePage: text("source_page"),
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  
  // CRM Integration
  crmOrganisationId: varchar("crm_organisation_id").references(() => crmOrganisations.id),
  crmContactId: varchar("crm_contact_id").references(() => crmContacts.id),
  convertedToCrm: boolean("converted_to_crm").default(false),
  convertedAt: timestamp("converted_at"),
  
  // Status
  read: boolean("read").default(false),
  readAt: timestamp("read_at"),
  responded: boolean("responded").default(false),
  respondedAt: timestamp("responded_at"),
  
  // Metadata
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  websiteIdx: index("contact_submissions_website_idx").on(table.websiteId),
  orgIdx: index("contact_submissions_org_idx").on(table.organizationId),
  emailIdx: index("contact_submissions_email_idx").on(table.email),
}));

export const insertWebsiteContactSubmissionSchema = createInsertSchema(websiteContactSubmissions).omit({ id: true, createdAt: true });
export type InsertWebsiteContactSubmission = z.infer<typeof insertWebsiteContactSubmissionSchema>;
export type WebsiteContactSubmission = typeof websiteContactSubmissions.$inferSelect;

export const socialAccounts = pgTable("social_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  platform: socialPlatformEnum("platform").notNull(),
  accountName: text("account_name"),
  accountId: text("account_id"),
  profileImageUrl: text("profile_image_url"),
  status: socialAccountStatusEnum("status").notNull().default("DISCONNECTED"),
  accessTokenEncrypted: text("access_token_encrypted"),
  refreshTokenEncrypted: text("refresh_token_encrypted"),
  tokenExpiresAt: timestamp("token_expires_at"),
  permissionScopes: text("permission_scopes").array(),
  lastSyncAt: timestamp("last_sync_at"),
  lastSyncError: text("last_sync_error"),
  metadata: json("metadata"),
  connectedById: varchar("connected_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("social_accounts_org_idx").on(table.organizationId),
  platformIdx: index("social_accounts_platform_idx").on(table.platform),
}));

export const insertSocialAccountSchema = createInsertSchema(socialAccounts).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSocialAccount = z.infer<typeof insertSocialAccountSchema>;
export type SocialAccount = typeof socialAccounts.$inferSelect;

export const socialMediaPosts = pgTable("social_media_posts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  title: text("title"),
  content: text("content").notNull(),
  platform: socialPlatformEnum("platform"),
  platforms: json("platforms"),
  status: socialPostStatusEnum("status").notNull().default("DRAFT"),
  mediaUrls: text("media_urls").array(),
  hashtags: text("hashtags").array(),
  scheduledAt: timestamp("scheduled_at"),
  publishedAt: timestamp("published_at"),
  campaignTag: text("campaign_tag"),
  tone: text("tone"),
  notes: text("notes"),
  isRecurring: boolean("is_recurring").default(false),
  recurringPattern: json("recurring_pattern"),
  socialAccountId: varchar("social_account_id").references(() => socialAccounts.id),
  aiGenerated: boolean("ai_generated").default(false),
  aiPrompt: text("ai_prompt"),
  suggestedImagePrompt: text("suggested_image_prompt"),
  externalPostId: text("external_post_id"),
  externalPostUrl: text("external_post_url"),
  retryCount: integer("retry_count").default(0),
  lastError: text("last_error"),
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  approvalStatus: text("approval_status"),
  rejectionReason: text("rejection_reason"),
  approvedById: varchar("approved_by_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("social_media_posts_org_idx").on(table.organizationId),
  statusIdx: index("social_media_posts_status_idx").on(table.status),
  scheduledIdx: index("social_media_posts_scheduled_idx").on(table.scheduledAt),
  campaignIdx: index("social_media_posts_campaign_idx").on(table.campaignTag),
}));

export const insertSocialMediaPostSchema = createInsertSchema(socialMediaPosts).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSocialMediaPost = z.infer<typeof insertSocialMediaPostSchema>;
export type SocialMediaPost = typeof socialMediaPosts.$inferSelect;

export const socialPostAnalytics = pgTable("social_post_analytics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  postId: varchar("post_id").notNull().references(() => socialMediaPosts.id, { onDelete: "cascade" }),
  impressions: integer("impressions").default(0),
  reach: integer("reach").default(0),
  engagement: integer("engagement").default(0),
  clicks: integer("clicks").default(0),
  likes: integer("likes").default(0),
  shares: integer("shares").default(0),
  comments: integer("comments").default(0),
  saves: integer("saves").default(0),
  fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  postIdx: index("social_post_analytics_post_idx").on(table.postId),
}));

export const insertSocialPostAnalyticsSchema = createInsertSchema(socialPostAnalytics).omit({ id: true, createdAt: true });
export type InsertSocialPostAnalytics = z.infer<typeof insertSocialPostAnalyticsSchema>;
export type SocialPostAnalytics = typeof socialPostAnalytics.$inferSelect;