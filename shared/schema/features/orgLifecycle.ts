import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, jsonb, index, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { organizations, users } from "../core";
import { subcontractors } from "./subcontractor";

export const orgCsvImports = pgTable("org_csv_imports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  entityType: varchar("entity_type", { length: 40 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("DRY_RUN"),
  totalRows: integer("total_rows").notNull().default(0),
  validRows: integer("valid_rows").notNull().default(0),
  errorRows: integer("error_rows").notNull().default(0),
  insertedRows: integer("inserted_rows").notNull().default(0),
  errors: jsonb("errors").$type<Array<{ row: number; field?: string; message: string }>>().default(sql`'[]'::jsonb`),
  fileName: text("file_name"),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
}, (table) => [
  index("org_csv_imports_org_idx").on(table.organizationId),
]);
export const insertOrgCsvImportSchema = createInsertSchema(orgCsvImports).omit({ id: true, createdAt: true });
export type OrgCsvImport = typeof orgCsvImports.$inferSelect;
export type InsertOrgCsvImport = z.infer<typeof insertOrgCsvImportSchema>;

export const orgExports = pgTable("org_exports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  status: varchar("status", { length: 20 }).notNull().default("PENDING"),
  objectKey: text("object_key"),
  bytes: integer("bytes"),
  errorMessage: text("error_message"),
  requestedById: varchar("requested_by_id").notNull().references(() => users.id),
  emailedTo: text("emailed_to"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
  expiresAt: timestamp("expires_at"),
}, (table) => [
  index("org_exports_org_idx").on(table.organizationId),
]);
export const insertOrgExportSchema = createInsertSchema(orgExports).omit({ id: true, createdAt: true });
export type OrgExport = typeof orgExports.$inferSelect;
export type InsertOrgExport = z.infer<typeof insertOrgExportSchema>;

export const orgDeletionRequests = pgTable("org_deletion_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // organization_id is nullable + ON DELETE SET NULL so the deletion-request
  // audit row survives the org delete itself (retention promise documented
  // in the hard-delete sweep). Migration 0099 enforces this on existing DBs.
  organizationId: varchar("organization_id").references(() => organizations.id, { onDelete: "set null" }),
  status: varchar("status", { length: 20 }).notNull().default("AWAITING_CONFIRMATION"),
  reason: text("reason"),
  confirmationToken: varchar("confirmation_token", { length: 80 }).notNull().unique(),
  confirmationSentTo: text("confirmation_sent_to").notNull(),
  // Nullable so the hard-delete sweep can NULL it before deleting the
  // owning user without violating the FK. The audit trail of the
  // deletion is preserved on the row itself + audit_log.
  requestedById: varchar("requested_by_id").references(() => users.id),
  confirmedAt: timestamp("confirmed_at"),
  hardDeleteScheduledAt: timestamp("hard_delete_scheduled_at"),
  hardDeletedAt: timestamp("hard_deleted_at"),
  cancelledAt: timestamp("cancelled_at"),
  cancelledById: varchar("cancelled_by_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("org_deletion_requests_org_idx").on(table.organizationId),
  index("org_deletion_requests_status_idx").on(table.status),
]);
export const insertOrgDeletionRequestSchema = createInsertSchema(orgDeletionRequests).omit({ id: true, createdAt: true });
export type OrgDeletionRequest = typeof orgDeletionRequests.$inferSelect;
export type InsertOrgDeletionRequest = z.infer<typeof insertOrgDeletionRequestSchema>;

// Per-org link to entries in the global `subcontractors` directory. Required
// because the `subcontractors` table itself has no `organization_id` column
// (the directory is platform-shared); without this junction, importing
// vendor/sub master data would mix tenant rows in the global table and the
// "Export my org" ZIP could not round-trip them. Every CSV import insert
// (vendors + subs) writes a row here, and the org export joins through it
// to emit a `subcontractors.csv` containing only the rows the org owns.
export const orgSubcontractorOwnership = pgTable("org_subcontractor_ownership", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  subcontractorId: varchar("subcontractor_id").notNull().references(() => subcontractors.id, { onDelete: "cascade" }),
  source: varchar("source", { length: 20 }).notNull().default("CSV_IMPORT"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("org_sub_ownership_org_idx").on(table.organizationId),
  index("org_sub_ownership_sub_idx").on(table.subcontractorId),
  unique("org_sub_ownership_unique").on(table.organizationId, table.subcontractorId),
]);
export const insertOrgSubcontractorOwnershipSchema = createInsertSchema(orgSubcontractorOwnership).omit({ id: true, createdAt: true });
export type OrgSubcontractorOwnership = typeof orgSubcontractorOwnership.$inferSelect;
export type InsertOrgSubcontractorOwnership = z.infer<typeof insertOrgSubcontractorOwnershipSchema>;
