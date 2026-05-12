import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, decimal, integer, index, unique, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { organizations, projects, users } from "../core";
import { purchaseOrders, purchaseOrderItems } from "../operations";

export const inventoryTxnTypeEnum = pgEnum("inventory_txn_type", [
  "RECEIPT", "ISSUE", "TRANSFER_OUT", "TRANSFER_IN", "ADJUSTMENT", "CYCLE_COUNT",
]);

export const inventoryAdjustReasonEnum = pgEnum("inventory_adjust_reason", [
  "DAMAGE", "LOSS", "FOUND", "RETURN", "CORRECTION", "EXPIRED", "OTHER",
]);

export const cycleCountStatusEnum = pgEnum("inventory_cycle_count_status", [
  "OPEN", "IN_PROGRESS", "PENDING_APPROVAL", "APPROVED", "CANCELLED",
]);

// Warehouse / Yard Locations
export const inventoryLocations = pgTable("inventory_locations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull().default("WAREHOUSE"), // WAREHOUSE, YARD, JOBSITE, TRUCK
  address: text("address"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("inventory_locations_org_idx").on(table.organizationId),
  codeUniq: unique("inventory_locations_org_code_uniq").on(table.organizationId, table.code),
}));

// Material catalog (SKUs)
export const inventoryMaterials = pgTable("inventory_materials", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  sku: text("sku").notNull(),
  barcode: text("barcode"), // UPC/QR payload for scanner lookup
  name: text("name").notNull(),
  description: text("description"),
  category: text("category"),
  uom: text("uom").notNull().default("EA"), // unit of measure
  defaultCostCode: text("default_cost_code"),
  unitCost: decimal("unit_cost", { precision: 12, scale: 4 }),
  reorderPoint: decimal("reorder_point", { precision: 12, scale: 2 }),
  reorderQty: decimal("reorder_qty", { precision: 12, scale: 2 }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("inventory_materials_org_idx").on(table.organizationId),
  skuUniq: unique("inventory_materials_org_sku_uniq").on(table.organizationId, table.sku),
  barcodeIdx: index("inventory_materials_barcode_idx").on(table.barcode),
}));

// Per-location on-hand snapshot (kept in sync by transactions)
export const inventoryStockLevels = pgTable("inventory_stock_levels", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  materialId: varchar("material_id").notNull().references(() => inventoryMaterials.id, { onDelete: "cascade" }),
  locationId: varchar("location_id").notNull().references(() => inventoryLocations.id, { onDelete: "cascade" }),
  onHand: decimal("on_hand", { precision: 14, scale: 4 }).notNull().default("0"),
  averageCost: decimal("average_cost", { precision: 12, scale: 4 }),
  lastCountedAt: timestamp("last_counted_at"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  uniq: unique("inventory_stock_levels_mat_loc_uniq").on(table.materialId, table.locationId),
  orgIdx: index("inventory_stock_levels_org_idx").on(table.organizationId),
  locIdx: index("inventory_stock_levels_location_idx").on(table.locationId),
}));

// Immutable ledger of every stock movement
export const inventoryTransactions = pgTable("inventory_transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  type: inventoryTxnTypeEnum("type").notNull(),
  materialId: varchar("material_id").notNull().references(() => inventoryMaterials.id, { onDelete: "restrict" }),
  locationId: varchar("location_id").notNull().references(() => inventoryLocations.id, { onDelete: "restrict" }),
  // For TRANSFER_OUT, this points at the destination location for traceability
  counterpartyLocationId: varchar("counterparty_location_id").references(() => inventoryLocations.id, { onDelete: "set null" }),
  // For ISSUE: target project + cost code
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "set null" }),
  costCode: text("cost_code"),
  // For RECEIPT against a PO
  poId: varchar("po_id").references(() => purchaseOrders.id, { onDelete: "set null" }),
  poItemId: varchar("po_item_id").references(() => purchaseOrderItems.id, { onDelete: "set null" }),
  // For ADJUSTMENT
  adjustReason: inventoryAdjustReasonEnum("adjust_reason"),
  // Quantity is signed: positive = stock increase, negative = decrease
  quantity: decimal("quantity", { precision: 14, scale: 4 }).notNull(),
  unitCost: decimal("unit_cost", { precision: 12, scale: 4 }),
  totalCost: decimal("total_cost", { precision: 14, scale: 4 }),
  referenceNumber: text("reference_number"), // packing slip, MR-#, etc.
  notes: text("notes"),
  performedById: varchar("performed_by_id").notNull().references(() => users.id),
  performedAt: timestamp("performed_at").notNull().defaultNow(),
  // Pairs RECEIPT+ISSUE legs of a transfer for reversal/audit
  pairId: varchar("pair_id"),
  cycleCountId: varchar("cycle_count_id"),
  approvalStatus: text("approval_status").$type<"PENDING_APPROVAL" | "APPROVED" | "REJECTED">(),
  approvalRequestId: varchar("approval_request_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("inventory_transactions_org_idx").on(table.organizationId),
  matIdx: index("inventory_transactions_material_idx").on(table.materialId),
  locIdx: index("inventory_transactions_location_idx").on(table.locationId),
  typeIdx: index("inventory_transactions_type_idx").on(table.type),
  perfIdx: index("inventory_transactions_performed_at_idx").on(table.performedAt),
  projectIdx: index("inventory_transactions_project_idx").on(table.projectId),
  poIdx: index("inventory_transactions_po_idx").on(table.poId),
}));

// Cycle count headers
export const inventoryCycleCounts = pgTable("inventory_cycle_counts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  locationId: varchar("location_id").notNull().references(() => inventoryLocations.id, { onDelete: "restrict" }),
  countNumber: text("count_number").notNull(),
  status: cycleCountStatusEnum("status").notNull().default("OPEN"),
  scheduledDate: timestamp("scheduled_date"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  approvedAt: timestamp("approved_at"),
  approvedById: varchar("approved_by_id").references(() => users.id),
  notes: text("notes"),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("inventory_cycle_counts_org_idx").on(table.organizationId),
  locIdx: index("inventory_cycle_counts_location_idx").on(table.locationId),
  statusIdx: index("inventory_cycle_counts_status_idx").on(table.status),
  numberUniq: unique("inventory_cycle_counts_org_number_uniq").on(table.organizationId, table.countNumber),
}));

// Cycle count detail lines
export const inventoryCycleCountLines = pgTable("inventory_cycle_count_lines", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  cycleCountId: varchar("cycle_count_id").notNull().references(() => inventoryCycleCounts.id, { onDelete: "cascade" }),
  materialId: varchar("material_id").notNull().references(() => inventoryMaterials.id, { onDelete: "restrict" }),
  expectedQty: decimal("expected_qty", { precision: 14, scale: 4 }).notNull(),
  countedQty: decimal("counted_qty", { precision: 14, scale: 4 }),
  varianceQty: decimal("variance_qty", { precision: 14, scale: 4 }),
  reason: inventoryAdjustReasonEnum("reason"),
  notes: text("notes"),
  countedById: varchar("counted_by_id").references(() => users.id),
  countedAt: timestamp("counted_at"),
  // Set when count is approved + adjustment txn posted
  adjustmentTxnId: varchar("adjustment_txn_id"),
}, (table) => ({
  countIdx: index("inventory_cycle_count_lines_count_idx").on(table.cycleCountId),
  matIdx: index("inventory_cycle_count_lines_material_idx").on(table.materialId),
}));

export const insertInventoryLocationSchema = createInsertSchema(inventoryLocations).omit({ id: true, createdAt: true, updatedAt: true, organizationId: true });
export type InsertInventoryLocation = z.infer<typeof insertInventoryLocationSchema>;
export type InventoryLocation = typeof inventoryLocations.$inferSelect;

export const insertInventoryMaterialSchema = createInsertSchema(inventoryMaterials).omit({ id: true, createdAt: true, updatedAt: true, organizationId: true });
export type InsertInventoryMaterial = z.infer<typeof insertInventoryMaterialSchema>;
export type InventoryMaterial = typeof inventoryMaterials.$inferSelect;

export type InventoryStockLevel = typeof inventoryStockLevels.$inferSelect;

export const insertInventoryTransactionSchema = createInsertSchema(inventoryTransactions).omit({ id: true, createdAt: true, performedAt: true, organizationId: true });
export type InsertInventoryTransaction = z.infer<typeof insertInventoryTransactionSchema>;
export type InventoryTransaction = typeof inventoryTransactions.$inferSelect;

export const insertInventoryCycleCountSchema = createInsertSchema(inventoryCycleCounts).omit({ id: true, createdAt: true, updatedAt: true, organizationId: true });
export type InsertInventoryCycleCount = z.infer<typeof insertInventoryCycleCountSchema>;
export type InventoryCycleCount = typeof inventoryCycleCounts.$inferSelect;

export const insertInventoryCycleCountLineSchema = createInsertSchema(inventoryCycleCountLines).omit({ id: true });
export type InsertInventoryCycleCountLine = z.infer<typeof insertInventoryCycleCountLineSchema>;
export type InventoryCycleCountLine = typeof inventoryCycleCountLines.$inferSelect;
