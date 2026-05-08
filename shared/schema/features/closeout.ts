import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, integer, pgEnum, index, unique, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { organizations, projects, users } from "../core";

export const closeoutItemStatusEnum = pgEnum("closeout_item_status", [
  "PENDING",
  "IN_PROGRESS",
  "READY",
  "COMPLETE",
  "WAIVED",
]);

export const closeoutItemCategoryEnum = pgEnum("closeout_item_category", [
  "OM_MANUAL",
  "WARRANTY",
  "AS_BUILT",
  "ATTIC_STOCK",
  "TRAINING",
  "LIEN_RELEASE",
  "FINAL_COI",
  "PUNCH_LIST",
  "INSPECTION",
  "PERMIT",
  "OTHER",
]);

export const closeoutPackageStatusEnum = pgEnum("closeout_package_status", [
  "BUILDING",
  "READY",
  "FAILED",
]);

// Templates — org-level reusable closeout checklists scoped to a project type.
export const closeoutTemplates = pgTable("closeout_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  projectType: text("project_type"),
  description: text("description"),
  isDefault: boolean("is_default").notNull().default(false),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  orgIdx: index("closeout_templates_org_idx").on(t.organizationId),
  orgNameUnique: unique("closeout_templates_org_name_unique").on(t.organizationId, t.name),
}));

export const closeoutTemplateItems = pgTable("closeout_template_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  templateId: varchar("template_id").notNull().references(() => closeoutTemplates.id, { onDelete: "cascade" }),
  category: closeoutItemCategoryEnum("category").notNull().default("OTHER"),
  title: text("title").notNull(),
  description: text("description"),
  required: boolean("required").notNull().default(true),
  // Hint for the auto-pull engine: "warranty" | "lien_waiver" | "permit" | "inspection" | "punch_list" | null
  autoSource: text("auto_source"),
  sortOrder: integer("sort_order").notNull().default(0),
}, (t) => ({
  templateIdx: index("closeout_template_items_template_idx").on(t.templateId),
}));

// Per-project checklist instance.
export const closeoutChecklists = pgTable("closeout_checklists", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  templateId: varchar("template_id").references(() => closeoutTemplates.id, { onDelete: "set null" }),
  name: text("name").notNull().default("Project Closeout"),
  status: text("status").notNull().default("ACTIVE"),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  projectIdx: index("closeout_checklists_project_idx").on(t.projectId),
  orgIdx: index("closeout_checklists_org_idx").on(t.organizationId),
  projectUnique: unique("closeout_checklists_project_unique").on(t.projectId),
}));

export const closeoutItems = pgTable("closeout_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  checklistId: varchar("checklist_id").notNull().references(() => closeoutChecklists.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  category: closeoutItemCategoryEnum("category").notNull().default("OTHER"),
  title: text("title").notNull(),
  description: text("description"),
  required: boolean("required").notNull().default(true),
  status: closeoutItemStatusEnum("status").notNull().default("PENDING"),
  assignedToUserId: varchar("assigned_to_user_id").references(() => users.id, { onDelete: "set null" }),
  dueDate: timestamp("due_date"),
  // Sources auto-pulled from existing project artifacts. Each entry: { type, refId, label, url? }
  sources: jsonb("sources").$type<Array<{
    type: string;
    refId?: string;
    label: string;
    url?: string;
  }>>().default([]),
  // Manually attached files: { url, filename, mimeType, uploadedAt, uploadedById }
  attachments: jsonb("attachments").$type<Array<{
    url: string;
    filename: string;
    mimeType?: string;
    uploadedAt: string;
    uploadedById?: string;
  }>>().default([]),
  notes: text("notes"),
  autoSource: text("auto_source"),
  completedAt: timestamp("completed_at"),
  completedById: varchar("completed_by_id").references(() => users.id, { onDelete: "set null" }),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  checklistIdx: index("closeout_items_checklist_idx").on(t.checklistId),
  projectIdx: index("closeout_items_project_idx").on(t.projectId),
  statusIdx: index("closeout_items_status_idx").on(t.status),
  categoryIdx: index("closeout_items_category_idx").on(t.category),
}));

// Generated package archives (ZIPs uploaded to object storage).
export const closeoutPackages = pgTable("closeout_packages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  checklistId: varchar("checklist_id").notNull().references(() => closeoutChecklists.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  status: closeoutPackageStatusEnum("status").notNull().default("BUILDING"),
  filename: text("filename").notNull(),
  storageKey: text("storage_key"),
  fileSize: integer("file_size"),
  itemCount: integer("item_count").notNull().default(0),
  fileCount: integer("file_count").notNull().default(0),
  // Task #2689 — sha256 hex of the verified ZIP bytes. Populated only on
  // successful promotion to the final GCS key. Treat as the integrity oracle.
  checksum: text("checksum"),
  errorMessage: text("error_message"),
  generatedById: varchar("generated_by_id").notNull().references(() => users.id),
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
  // Task #2689 — wall-clock time the package transitioned to READY (i.e. the
  // final-key copy returned success and the verified row was committed).
  // NULL for BUILDING/FAILED rows. The "valid package exists" predicate
  // everywhere is `status = READY AND storageKey/fileSize/checksum/completedAt
  // are all non-null`.
  completedAt: timestamp("completed_at"),
}, (t) => ({
  checklistIdx: index("closeout_packages_checklist_idx").on(t.checklistId),
  projectIdx: index("closeout_packages_project_idx").on(t.projectId),
}));

export const insertCloseoutTemplateSchema = createInsertSchema(closeoutTemplates).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCloseoutTemplate = z.infer<typeof insertCloseoutTemplateSchema>;
export type CloseoutTemplate = typeof closeoutTemplates.$inferSelect;

export const insertCloseoutTemplateItemSchema = createInsertSchema(closeoutTemplateItems).omit({ id: true });
export type InsertCloseoutTemplateItem = z.infer<typeof insertCloseoutTemplateItemSchema>;
export type CloseoutTemplateItem = typeof closeoutTemplateItems.$inferSelect;

export const insertCloseoutChecklistSchema = createInsertSchema(closeoutChecklists).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCloseoutChecklist = z.infer<typeof insertCloseoutChecklistSchema>;
export type CloseoutChecklist = typeof closeoutChecklists.$inferSelect;

export const insertCloseoutItemSchema = createInsertSchema(closeoutItems).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCloseoutItem = z.infer<typeof insertCloseoutItemSchema>;
export type CloseoutItem = typeof closeoutItems.$inferSelect;

export const insertCloseoutPackageSchema = createInsertSchema(closeoutPackages).omit({ id: true, generatedAt: true });
export type InsertCloseoutPackage = z.infer<typeof insertCloseoutPackageSchema>;
export type CloseoutPackage = typeof closeoutPackages.$inferSelect;
