import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, decimal, integer, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { organizations, users } from "../core";
import { jobClassifications } from "../operations";

export const estimatingCrewTemplates = pgTable("estimating_crew_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  tradeType: text("trade_type"),
  description: text("description"),
  defaultHoursPerDay: decimal("default_hours_per_day", { precision: 5, scale: 2 }).notNull().default("8.00"),
  defaultProductionUnit: text("default_production_unit"),
  defaultProductionPerDay: decimal("default_production_per_day", { precision: 12, scale: 2 }),
  isActive: boolean("is_active").notNull().default(true),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgCodeUniq: uniqueIndex("estimating_crew_templates_org_code_uniq").on(table.organizationId, table.code),
}));

export const estimatingCrewTemplateWorkers = pgTable("estimating_crew_template_workers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  crewTemplateId: varchar("crew_template_id").notNull().references(() => estimatingCrewTemplates.id, { onDelete: "cascade" }),
  jobClassificationId: varchar("job_classification_id").references(() => jobClassifications.id, { onDelete: "set null" }),
  classificationLabel: text("classification_label").notNull(),
  count: integer("count").notNull().default(1),
  hourlyRate: decimal("hourly_rate", { precision: 10, scale: 4 }).notNull().default("0"),
  burdenPercent: decimal("burden_percent", { precision: 5, scale: 2 }).notNull().default("0"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  templateIdx: index("estimating_crew_workers_template_idx").on(table.crewTemplateId),
}));

export const estimatingCrewTemplateEquipment = pgTable("estimating_crew_template_equipment", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  crewTemplateId: varchar("crew_template_id").notNull().references(() => estimatingCrewTemplates.id, { onDelete: "cascade" }),
  equipmentLabel: text("equipment_label").notNull(),
  count: integer("count").notNull().default(1),
  dailyRate: decimal("daily_rate", { precision: 12, scale: 4 }).notNull().default("0"),
  fuelCostPerDay: decimal("fuel_cost_per_day", { precision: 12, scale: 4 }).notNull().default("0"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  templateIdx: index("estimating_crew_equipment_template_idx").on(table.crewTemplateId),
}));

export const insertEstimatingCrewTemplateSchema = createInsertSchema(estimatingCrewTemplates).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEstimatingCrewTemplate = z.infer<typeof insertEstimatingCrewTemplateSchema>;
export type EstimatingCrewTemplate = typeof estimatingCrewTemplates.$inferSelect;

export const insertEstimatingCrewWorkerSchema = createInsertSchema(estimatingCrewTemplateWorkers).omit({ id: true, createdAt: true });
export type InsertEstimatingCrewWorker = z.infer<typeof insertEstimatingCrewWorkerSchema>;
export type EstimatingCrewWorker = typeof estimatingCrewTemplateWorkers.$inferSelect;

export const insertEstimatingCrewEquipmentSchema = createInsertSchema(estimatingCrewTemplateEquipment).omit({ id: true, createdAt: true });
export type InsertEstimatingCrewEquipment = z.infer<typeof insertEstimatingCrewEquipmentSchema>;
export type EstimatingCrewEquipment = typeof estimatingCrewTemplateEquipment.$inferSelect;
