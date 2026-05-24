import { pgTable, text, uuid, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const enrichmentLog = pgTable(
  "enrichment_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull(),
    userId: text("user_id"),
    estimateLineItemId: text("estimate_line_item_id"),
    measurementId: text("measurement_id"),
    costCode: text("cost_code"),
    mode: text("mode").notNull().default("ON_DEMAND"),
    request: jsonb("request").notNull(),
    response: jsonb("response"),
    durationMs: text("duration_ms"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("enrichment_log_org_id_idx").on(t.orgId),
    index("enrichment_log_cost_code_idx").on(t.orgId, t.costCode),
    index("enrichment_log_created_at_idx").on(t.createdAt),
  ],
);

export const enrichmentFeedback = pgTable(
  "enrichment_feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull(),
    userId: text("user_id").notNull(),
    enrichmentLogId: uuid("enrichment_log_id").references(() => enrichmentLog.id),
    costCode: text("cost_code"),
    projectType: text("project_type"),
    projectSize: text("project_size"),
    location: text("location"),
    laborType: text("labor_type"),
    fieldName: text("field_name").notNull(),
    outcome: text("outcome").notNull(),
    suggestedValue: jsonb("suggested_value"),
    acceptedValue: jsonb("accepted_value"),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("enrichment_feedback_org_cost_code_idx").on(t.orgId, t.costCode),
    index("enrichment_feedback_enrichment_log_idx").on(t.enrichmentLogId),
    index("enrichment_feedback_created_at_idx").on(t.createdAt),
  ],
);

export const bidOutcomes = pgTable(
  "bid_outcomes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull(),
    projectId: text("project_id"),
    bidId: text("bid_id"),
    costCode: text("cost_code").notNull(),
    projectType: text("project_type"),
    projectSize: text("project_size"),
    location: text("location"),
    laborType: text("labor_type"),
    finalBidUnitCostMaterial: text("final_bid_unit_cost_material"),
    finalBidUnitCostLabor: text("final_bid_unit_cost_labor"),
    bidOutcome: text("bid_outcome").notNull(),
    competitorLowBid: text("competitor_low_bid"),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("bid_outcomes_org_cost_code_idx").on(t.orgId, t.costCode),
    index("bid_outcomes_created_at_idx").on(t.createdAt),
  ],
);

export const insertEnrichmentFeedbackSchema = createInsertSchema(enrichmentFeedback).omit({
  id: true,
  createdAt: true,
});
export type InsertEnrichmentFeedback = z.infer<typeof insertEnrichmentFeedbackSchema>;
export type EnrichmentFeedback = typeof enrichmentFeedback.$inferSelect;

export const insertBidOutcomeSchema = createInsertSchema(bidOutcomes).omit({
  id: true,
  createdAt: true,
});
export type InsertBidOutcome = z.infer<typeof insertBidOutcomeSchema>;
export type BidOutcome = typeof bidOutcomes.$inferSelect;

export type EnrichmentLog = typeof enrichmentLog.$inferSelect;
