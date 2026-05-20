// Customer support, in-app help & SLA operationalization (Task #2489).
// Persists in-app support tickets along with the metadata required to drive
// SLA reporting (first-response time, resolution time, breach flags) and the
// weekly internal KPI digest. Help-center articles themselves live as Markdown
// in `docs/help/` and are served from the filesystem — only operational data
// (tickets, events) is stored in the database.
//
// Task #2962 adds:
//   - support_settings: per-org timezone, escalation policy, auto-assign config
//   - support_holidays: replaceable holiday calendar (seeds via scripts/seed-support-holidays.ts)

import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, pgEnum, index, jsonb, boolean, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { organizations, users } from "../core";

export const supportTicketTierEnum = pgEnum("support_ticket_tier", ["starter", "pro", "enterprise"]);
export const supportTicketStatusEnum = pgEnum("support_ticket_status", [
  "open",
  "in_progress",
  "waiting_on_customer",
  "resolved",
  "closed",
]);
export const supportTicketPriorityEnum = pgEnum("support_ticket_priority", [
  "low",
  "normal",
  "high",
  "urgent",
]);
export const supportTicketCategoryEnum = pgEnum("support_ticket_category", [
  "bids",
  "payroll",
  "ai_estimator",
  "change_orders",
  "documents",
  "general",
]);

export interface SupportAttachment {
  objectKey: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
}

export const supportTickets = pgTable(
  "support_tickets",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: varchar("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
    submitterEmail: text("submitter_email").notNull(),
    submitterName: text("submitter_name"),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    category: supportTicketCategoryEnum("category"),
    attachments: jsonb("attachments").$type<SupportAttachment[]>().default([]),
    route: text("route"),
    userAgent: text("user_agent"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    tier: supportTicketTierEnum("tier").notNull().default("starter"),
    priority: supportTicketPriorityEnum("priority").notNull().default("normal"),
    status: supportTicketStatusEnum("status").notNull().default("open"),
    assignedTo: varchar("assigned_to").references(() => users.id, { onDelete: "set null" }),
    firstResponseAt: timestamp("first_response_at"),
    resolvedAt: timestamp("resolved_at"),
    slaFirstResponseDueAt: timestamp("sla_first_response_due_at"),
    slaResolutionDueAt: timestamp("sla_resolution_due_at"),
    slaFirstResponseBreached: integer("sla_first_response_breached").notNull().default(0),
    slaResolutionBreached: integer("sla_resolution_breached").notNull().default(0),
    csatScore: integer("csat_score"),
    csatComment: text("csat_comment"),
    csatSubmittedAt: timestamp("csat_submitted_at"),
    csatToken: varchar("csat_token"),
    csatTokenExpiresAt: timestamp("csat_token_expires_at"),
    /** Message-ID header of the original inbound email that opened this ticket, if any. */
    emailMessageId: text("email_message_id"),
    createdAt: timestamp("created_at").notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
  },
  (t) => ({
    orgIdx: index("support_tickets_org_idx").on(t.organizationId),
    statusIdx: index("support_tickets_status_idx").on(t.status),
    createdIdx: index("support_tickets_created_idx").on(t.createdAt),
    categoryIdx: index("support_tickets_category_idx").on(t.category),
    csatTokenIdx: index("support_tickets_csat_token_idx").on(t.csatToken),
  }),
);

export const supportTicketReplies = pgTable(
  "support_ticket_replies",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    ticketId: varchar("ticket_id")
      .notNull()
      .references(() => supportTickets.id, { onDelete: "cascade" }),
    authorId: varchar("author_id").references(() => users.id, { onDelete: "set null" }),
    authorName: text("author_name"),
    body: text("body").notNull(),
    attachments: jsonb("attachments").$type<SupportAttachment[]>().default([]),
    emailedAt: timestamp("emailed_at"),
    /** Message-ID header of the inbound email that produced this reply (null for outbound agent replies). */
    emailMessageId: text("email_message_id"),
    createdAt: timestamp("created_at").notNull().default(sql`now()`),
  },
  (t) => ({
    ticketIdx: index("support_ticket_replies_ticket_idx").on(t.ticketId),
    createdIdx: index("support_ticket_replies_created_idx").on(t.createdAt),
  }),
);

export const supportCannedResponses = pgTable(
  "support_canned_responses",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: varchar("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at").notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
  },
  (t) => ({
    orgIdx: index("support_canned_responses_org_idx").on(t.organizationId),
  }),
);

export const insertSupportTicketReplySchema = createInsertSchema(supportTicketReplies).omit({
  id: true,
  authorId: true,
  authorName: true,
  attachments: true,
  emailedAt: true,
  emailMessageId: true,
  createdAt: true,
});

export type InsertSupportTicketReply = z.infer<typeof insertSupportTicketReplySchema>;
export type SupportTicketReply = typeof supportTicketReplies.$inferSelect;

export const insertSupportTicketSchema = createInsertSchema(supportTickets).omit({
  id: true,
  organizationId: true,
  userId: true,
  status: true,
  assignedTo: true,
  firstResponseAt: true,
  resolvedAt: true,
  slaFirstResponseDueAt: true,
  slaResolutionDueAt: true,
  slaFirstResponseBreached: true,
  slaResolutionBreached: true,
  tier: true,
  attachments: true,
  csatScore: true,
  csatComment: true,
  csatSubmittedAt: true,
  csatToken: true,
  csatTokenExpiresAt: true,
  emailMessageId: true,
  createdAt: true,
  updatedAt: true,
});

export const insertSupportCannedResponseSchema = createInsertSchema(supportCannedResponses).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertSupportTicket = z.infer<typeof insertSupportTicketSchema>;
export type SupportTicket = typeof supportTickets.$inferSelect;
export type InsertSupportCannedResponse = z.infer<typeof insertSupportCannedResponseSchema>;
export type SupportCannedResponse = typeof supportCannedResponses.$inferSelect;

// ─── Per-org support settings (Task #2962) ───────────────────────────────────
//
// One row per organization. Created on first PATCH; GET returns defaults if no
// row exists so callers can treat the endpoint as always-available.

export const supportSettings = pgTable("support_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id")
    .notNull()
    .unique()
    .references(() => organizations.id, { onDelete: "cascade" }),
  /** IANA timezone string. Business-hour windows are calculated in this TZ. */
  supportTimezone: text("support_timezone").notNull().default("UTC"),
  /** Extra email addresses notified on escalation (in addition to the assignee). */
  escalationEmails: text("escalation_emails").array(),
  /**
   * When first-response SLA is this % consumed without a reply, priority is
   * bumped one level and escalation emails are notified. 0–100.
   */
  escalationThresholdPct: integer("escalation_threshold_pct").notNull().default(75),
  /**
   * Minutes after ticket creation that an unassigned open ticket becomes
   * eligible for auto-assignment. Default 60 min.
   */
  autoAssignGraceMinutes: integer("auto_assign_grace_minutes").notNull().default(60),
  /**
   * Explicit list of user IDs that should receive enterprise-tier tickets
   * before falling back to the general agent pool.
   */
  enterpriseAgentIds: varchar("enterprise_agent_ids").array(),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export const insertSupportSettingsSchema = createInsertSchema(supportSettings).omit({
  id: true,
  updatedAt: true,
});
export type InsertSupportSettings = z.infer<typeof insertSupportSettingsSchema>;
export type SupportSettings = typeof supportSettings.$inferSelect;

// ─── Holiday calendar (Task #2962) ───────────────────────────────────────────
//
// Replaces the hardcoded US_FEDERAL_HOLIDAYS constant in slaPolicy.ts.
// Seeded by `scripts/seed-support-holidays.ts`; the script is run on deploy
// and pads the calendar at least 3 years ahead. Extend by adding rows for
// additional countries or observed dates.

export const supportHolidays = pgTable(
  "support_holidays",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    /** ISO date string, e.g. "2026-07-04". */
    date: text("date").notNull(),
    name: text("name").notNull(),
    /** ISO 3166-1 alpha-2 country code, e.g. "US". */
    country: text("country").notNull().default("US"),
  },
  (t) => ({
    dateCountryUniq: unique("support_holidays_date_country_uniq").on(t.date, t.country),
    dateCountryIdx: index("support_holidays_date_country_idx").on(t.date, t.country),
  }),
);

export const insertSupportHolidaySchema = createInsertSchema(supportHolidays).omit({ id: true });
export type InsertSupportHoliday = z.infer<typeof insertSupportHolidaySchema>;
export type SupportHoliday = typeof supportHolidays.$inferSelect;
