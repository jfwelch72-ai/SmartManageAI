import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, decimal, integer, index, uniqueIndex, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "../core";
import { estimates, bidSubcontractorQuotes } from "../operations";

export const estimateAlternateGroups = pgTable("estimate_alternate_groups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  estimateId: varchar("estimate_id").notNull().references(() => estimates.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  defaultIncluded: boolean("default_included").notNull().default(false),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  estimateCodeUniq: uniqueIndex("estimate_alternate_groups_estimate_code_uniq").on(table.estimateId, table.code),
}));

export const estimateLevelingSheets = pgTable("estimate_leveling_sheets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  estimateId: varchar("estimate_id").notNull().references(() => estimates.id, { onDelete: "cascade" }),
  scopeLabel: text("scope_label").notNull(),
  inHouseCost: decimal("in_house_cost", { precision: 12, scale: 2 }),
  inclusionKeys: jsonb("inclusion_keys").notNull().default(sql`'[]'::jsonb`),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  estimateIdx: index("estimate_leveling_sheets_estimate_idx").on(table.estimateId),
}));

export const estimateLevelingSheetColumns = pgTable("estimate_leveling_sheet_columns", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  levelingSheetId: varchar("leveling_sheet_id").notNull().references(() => estimateLevelingSheets.id, { onDelete: "cascade" }),
  sourceKind: text("source_kind").notNull(),
  subcontractorQuoteId: varchar("subcontractor_quote_id").references(() => bidSubcontractorQuotes.id, { onDelete: "set null" }),
  label: text("label").notNull(),
  baseAmount: decimal("base_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  includedKeys: jsonb("included_keys").notNull().default(sql`'[]'::jsonb`),
  excludedKeys: jsonb("excluded_keys").notNull().default(sql`'[]'::jsonb`),
  addForExcluded: decimal("add_for_excluded", { precision: 12, scale: 2 }).notNull().default("0"),
  normalizedAmount: decimal("normalized_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  isRecommended: boolean("is_recommended").notNull().default(false),
  notes: text("notes"),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  sheetIdx: index("estimate_leveling_columns_sheet_idx").on(table.levelingSheetId),
}));

export const insertEstimateAlternateGroupSchema = createInsertSchema(estimateAlternateGroups).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEstimateAlternateGroup = z.infer<typeof insertEstimateAlternateGroupSchema>;
export type EstimateAlternateGroup = typeof estimateAlternateGroups.$inferSelect;

export const insertEstimateLevelingSheetSchema = createInsertSchema(estimateLevelingSheets).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEstimateLevelingSheet = z.infer<typeof insertEstimateLevelingSheetSchema>;
export type EstimateLevelingSheet = typeof estimateLevelingSheets.$inferSelect;

export const insertEstimateLevelingSheetColumnSchema = createInsertSchema(estimateLevelingSheetColumns).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEstimateLevelingSheetColumn = z.infer<typeof insertEstimateLevelingSheetColumnSchema>;
export type EstimateLevelingSheetColumn = typeof estimateLevelingSheetColumns.$inferSelect;

// Discriminator values for estimate_line_items.line_type — kept as a const
// (rather than a pgEnum) to avoid migration friction. Validated by Zod.
export const ESTIMATE_LINE_TYPES = ["BASE", "ALTERNATE", "ALLOWANCE", "CONTINGENCY"] as const;
export type EstimateLineType = (typeof ESTIMATE_LINE_TYPES)[number];
export const estimateLineTypeSchema = z.enum(ESTIMATE_LINE_TYPES);

export const ALLOWANCE_BASIS = ["FIXED", "PERCENT_OF_BASE"] as const;
export type AllowanceBasis = (typeof ALLOWANCE_BASIS)[number];
export const allowanceBasisSchema = z.enum(ALLOWANCE_BASIS);
