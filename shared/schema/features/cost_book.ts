import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, date, decimal, integer, index, uniqueIndex, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { organizations } from "../core";

export const costBookProviders = pgTable("cost_book_providers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  providerKind: text("provider_kind").notNull().default("BUILTIN"),
  apiEndpoint: text("api_endpoint"),
  apiKeyEnvVar: text("api_key_env_var"),
  isActive: boolean("is_active").notNull().default(true),
  defaultRegion: text("default_region"),
  notes: text("notes"),
  lastSyncedAt: timestamp("last_synced_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("cost_book_providers_org_idx").on(table.organizationId),
}));

export const costBookEntries = pgTable("cost_book_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  providerId: varchar("provider_id").notNull().references(() => costBookProviders.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  sourceCode: text("source_code").notNull(),
  csiDivision: text("csi_division"),
  description: text("description").notNull(),
  unit: text("unit").notNull(),
  baseRegion: text("base_region"),
  materialCost: decimal("material_cost", { precision: 12, scale: 4 }).notNull().default("0"),
  laborCost: decimal("labor_cost", { precision: 12, scale: 4 }).notNull().default("0"),
  equipmentCost: decimal("equipment_cost", { precision: 12, scale: 4 }).notNull().default("0"),
  totalCost: decimal("total_cost", { precision: 12, scale: 4 }).notNull().default("0"),
  laborHours: decimal("labor_hours", { precision: 10, scale: 4 }),
  crewCode: text("crew_code"),
  asOfDate: date("as_of_date").notNull(),
  rawPayload: jsonb("raw_payload"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  providerIdx: index("cost_book_entries_provider_idx").on(table.providerId),
  orgIdx: index("cost_book_entries_org_idx").on(table.organizationId),
  sourceCodeIdx: index("cost_book_entries_source_code_idx").on(table.organizationId, table.sourceCode),
  csiIdx: index("cost_book_entries_csi_idx").on(table.csiDivision),
}));

export const costBookGeoFactors = pgTable("cost_book_geo_factors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  providerId: varchar("provider_id").notNull().references(() => costBookProviders.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  regionCode: text("region_code").notNull(),
  regionName: text("region_name").notNull(),
  city: text("city"),
  state: text("state"),
  postalCode: text("postal_code"),
  materialFactor: decimal("material_factor", { precision: 6, scale: 3 }).notNull().default("1.000"),
  laborFactor: decimal("labor_factor", { precision: 6, scale: 3 }).notNull().default("1.000"),
  equipmentFactor: decimal("equipment_factor", { precision: 6, scale: 3 }).notNull().default("1.000"),
  totalFactor: decimal("total_factor", { precision: 6, scale: 3 }).notNull().default("1.000"),
  asOfDate: date("as_of_date").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  providerIdx: index("cost_book_geo_factors_provider_idx").on(table.providerId),
  regionIdx: index("cost_book_geo_factors_region_idx").on(table.organizationId, table.regionCode),
}));

export const insertCostBookProviderSchema = createInsertSchema(costBookProviders).omit({ id: true, createdAt: true, updatedAt: true, lastSyncedAt: true });
export type InsertCostBookProvider = z.infer<typeof insertCostBookProviderSchema>;
export type CostBookProvider = typeof costBookProviders.$inferSelect;

export const insertCostBookEntrySchema = createInsertSchema(costBookEntries).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCostBookEntry = z.infer<typeof insertCostBookEntrySchema>;
export type CostBookEntry = typeof costBookEntries.$inferSelect;

export const insertCostBookGeoFactorSchema = createInsertSchema(costBookGeoFactors).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCostBookGeoFactor = z.infer<typeof insertCostBookGeoFactorSchema>;
export type CostBookGeoFactor = typeof costBookGeoFactors.$inferSelect;
