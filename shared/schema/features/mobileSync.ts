import { sql } from "drizzle-orm";
import { pgTable, varchar, text, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { organizations } from "../core";

// ============================================
// MOBILE SYNC EVENTS — Task #2693
// Structured event log for every push sync operation
// ============================================

export const mobileSyncEvents = pgTable("mobile_sync_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),

  deviceId: text("device_id").notNull(),
  entityType: text("entity_type").notNull(),

  localId: text("local_id"),
  serverId: text("server_id"),

  operation: text("operation").notNull(),

  strategy: text("strategy").notNull(),

  outcome: text("outcome").notNull(),

  clientTimestamp: timestamp("client_timestamp"),
  serverTimestamp: timestamp("server_timestamp").notNull().defaultNow(),

  logicalClock: integer("logical_clock"),

  resolvedBy: text("resolved_by"),
  resolvedAt: timestamp("resolved_at"),

  conflictPayload: jsonb("conflict_payload"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("mobile_sync_events_org_idx").on(table.organizationId),
  deviceIdx: index("mobile_sync_events_device_idx").on(table.deviceId),
  entityTypeIdx: index("mobile_sync_events_entity_type_idx").on(table.entityType),
  outcomeIdx: index("mobile_sync_events_outcome_idx").on(table.outcome),
  createdAtIdx: index("mobile_sync_events_created_at_idx").on(table.createdAt),
}));

export const insertMobileSyncEventSchema = createInsertSchema(mobileSyncEvents).omit({ id: true, createdAt: true });
export type InsertMobileSyncEvent = z.infer<typeof insertMobileSyncEventSchema>;
export type MobileSyncEvent = typeof mobileSyncEvents.$inferSelect;

export type SyncStrategy =
  | "DEDUPLICATE_WINDOW"
  | "MERGE_FIELDS"
  | "APPEND_ONLY"
  | "SERVER_WINS_STATUS_CLIENT_WINS_DRAFT"
  | "FLAG_BOTH"
  | "LAST_WRITE_WINS"
  | "IDEMPOTENT_INSERT";

export type SyncOutcome =
  | "SAVED"
  | "CONFLICT"
  | "DEDUPLICATED"
  | "MERGED"
  | "FLAGGED"
  | "DUPLICATE"
  | "FAILED";

export const ENTITY_STRATEGY_MAP: Record<string, SyncStrategy> = {
  TIME_CLOCK_EVENT: "DEDUPLICATE_WINDOW",
  DAILY_REPORT: "MERGE_FIELDS",
  PHOTO: "APPEND_ONLY",
  RFI: "SERVER_WINS_STATUS_CLIENT_WINS_DRAFT",
  PUNCH_ITEM: "FLAG_BOTH",
  INSPECTION: "FLAG_BOTH",
  DRAWING_MARKUP: "MERGE_FIELDS",
  HAUL_TICKET: "LAST_WRITE_WINS",
  INSPECTOR_REPORT: "LAST_WRITE_WINS",
  SWPPP_INSPECTION: "LAST_WRITE_WINS",
  SUBMITTAL_STAMP: "LAST_WRITE_WINS",
  TIME_CLOCK_GAP: "FLAG_BOTH",
  SAFETY_INCIDENT: "APPEND_ONLY",
};
