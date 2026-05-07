// Customer support, in-app help & SLA operationalization (Task #2489).
// Persists in-app support tickets along with the metadata required to drive
// SLA reporting (first-response time, resolution time, breach flags) and the
// weekly internal KPI digest. Help-center articles themselves live as Markdown
// in `docs/help/` and are served from the filesystem — only operational data
// (tickets, events) is stored in the database.

import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, pgEnum, index, jsonb } from "drizzle-orm/pg-core";
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
    createdAt: timestamp("created_at").notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
  },
  (t) => ({
    orgIdx: index("support_tickets_org_idx").on(t.organizationId),
    statusIdx: index("support_tickets_status_idx").on(t.status),
    createdIdx: index("support_tickets_created_idx").on(t.createdAt),
  }),
);

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
  createdAt: true,
  updatedAt: true,
});

export type InsertSupportTicket = z.infer<typeof insertSupportTicketSchema>;
export type SupportTicket = typeof supportTickets.$inferSelect;
