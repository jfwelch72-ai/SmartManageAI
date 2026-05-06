# TAKEOFF + ESTIMATING ENGINE - COMPLETE CODE EXTRACTION

**Date:** November 22, 2025  
**Project:** TFR Construction Management Platform  
**Purpose:** Complete code extraction for Takeoff + Scope + Estimating Engine

---

## TABLE OF CONTENTS

1. [System Overview](#system-overview)
2. [Frontend Components](#frontend-components)
   - [TakeoffWorkspace.tsx](#takeoffworkspacetsx)
   - [ScopeProgressTracker.tsx](#scopeprogresstrackertsx)
   - [ScopeItemProgressRow.tsx](#scopeitemprogressrowtsx)
3. [Database Schema](#database-schema)
   - [Takeoff Tables](#takeoff-tables)
   - [Estimating Tables](#estimating-tables)
   - [Scope Tracking Tables](#scope-tracking-tables)
   - [Enums](#enums)
4. [Backend API Routes](#backend-api-routes)
   - [Takeoff Routes](#takeoff-routes)
   - [Quantity Category Routes](#quantity-category-routes)
5. [Technical Stack](#technical-stack)
6. [Key Features](#key-features)

---

## SYSTEM OVERVIEW

The Takeoff + Estimating Engine is a comprehensive construction quantity takeoff and estimation system featuring:

- **Interactive PDF Drawing**: Konva-based canvas for measurements on construction plans
- **Multi-page PDF Support**: pdfjs-dist integration for rendering and per-page sheet management
- **Measurement Tools**: Linear, Area, Volume, Count, and Note annotations
- **Calibration System**: Both manual calibration and preset architectural/civil/structural scales
- **Quantity Categories**: Color-coded organization of measurements by scope type
- **Scope Progress Tracking**: Daily quantity completion and billing status workflow
- **RBAC**: Project-level access control via crew assignments

---

## FRONTEND COMPONENTS

### TakeoffWorkspace.tsx

**Location:** `client/src/components/TakeoffWorkspace.tsx`  
**Lines:** 1760  
**Purpose:** Main interactive takeoff workspace with PDF rendering, measurement tools, and calibration

**Key Features:**
- PDF rendering using pdfjs-dist
- Interactive Konva canvas for drawing measurements
- 6 measurement tools: Select, Pan, Zoom, Calibrate, Linear, Area, Volume, Count, Note
- Manual calibration with known distances
- Preset scale selection (Architectural, Civil, Structural)
- Quantity categories with color coding
- Real-time measurement calculations
- Fullscreen mode support
- Measurement persistence to database

**Dependencies:**
```typescript
import { Stage, Layer, Image as KonvaImage, Line, Circle, Text } from "react-konva";
import * as pdfjsLib from 'pdfjs-dist';
import { useQuery, useMutation } from "@tanstack/react-query";
import type { TakeoffSheet, TakeoffMeasurement, QuantityCategory } from "@shared/schema";
```

**Tool Configuration:**
```typescript
const TOOL_CONFIG = [
  { id: "select", icon: MousePointer2, label: "Select", color: "default" },
  { id: "pan", icon: Hand, label: "Pan", color: "default" },
  { id: "zoom", icon: ZoomIn, label: "Zoom", color: "default" },
  { id: "calibrate", icon: Ruler, label: "Calibrate", color: "secondary" },
  { id: "linear", icon: Ruler, label: "Linear", color: "primary" },
  { id: "area", icon: Square, label: "Area", color: "primary" },
  { id: "volume", icon: Box, label: "Volume", color: "primary" },
  { id: "count", icon: MapPin, label: "Count", color: "primary" },
  { id: "note", icon: StickyNote, label: "Note", color: "default" },
];
```

**Preset Scales:**
```typescript
const COMMON_SCALES = {
  architectural: [
    { label: '1/16" = 1\'-0"', pxPerFoot: 6, description: "Very small scale" },
    { label: '1/8" = 1\'-0"', pxPerFoot: 12, description: "Small scale" },
    { label: '1/4" = 1\'-0"', pxPerFoot: 24, description: "Common floor plans" },
    { label: '3/8" = 1\'-0"', pxPerFoot: 36, description: "Medium detail" },
    { label: '1/2" = 1\'-0"', pxPerFoot: 48, description: "Detailed plans" },
    { label: '3/4" = 1\'-0"', pxPerFoot: 72, description: "Large detail" },
    { label: '1" = 1\'-0"', pxPerFoot: 96, description: "Full size details" },
    { label: '1-1/2" = 1\'-0"', pxPerFoot: 144, description: "Enlarged details" },
    { label: '3" = 1\'-0"', pxPerFoot: 288, description: "Large details" },
  ],
  civil: [
    { label: '1" = 10\'', pxPerFoot: 9.6, description: "Small site plans" },
    { label: '1" = 20\'', pxPerFoot: 4.8, description: "Medium site plans" },
    { label: '1" = 30\'', pxPerFoot: 3.2, description: "Large site plans" },
    { label: '1" = 40\'', pxPerFoot: 2.4, description: "Very large sites" },
    { label: '1" = 50\'', pxPerFoot: 1.92, description: "Regional plans" },
    { label: '1" = 60\'', pxPerFoot: 1.6, description: "Large regional" },
    { label: '1" = 100\'', pxPerFoot: 0.96, description: "Master plans" },
  ],
  structural: [
    { label: '1/8" = 1\'-0"', pxPerFoot: 12, description: "Overall framing" },
    { label: '1/4" = 1\'-0"', pxPerFoot: 24, description: "Framing plans" },
    { label: '3/8" = 1\'-0"', pxPerFoot: 36, description: "Connection details" },
    { label: '1/2" = 1\'-0"', pxPerFoot: 48, description: "Detailed connections" },
    { label: '3/4" = 1\'-0"', pxPerFoot: 72, description: "Large details" },
    { label: '1" = 1\'-0"', pxPerFoot: 96, description: "Full size details" },
    { label: '1-1/2" = 1\'-0"', pxPerFoot: 144, description: "Connection details" },
    { label: '3" = 1\'-0"', pxPerFoot: 288, description: "Bolt details" },
  ],
};
```

**Component Structure:**
- Left Sidebar: Sheet selection, plan import
- Center Canvas: Interactive Konva stage with PDF background and measurements
- Top Toolbar: Measurement tool selection with visual feedback
- Right Sidebar: Calibration panel, quantity categories, measurements list, quantity summary

**Measurement Rendering:**
```typescript
// LINEAR measurements
<Line
  points={flatPoints}
  stroke={baseColor}
  strokeWidth={isSelected ? 5 : 3}
  opacity={isSelected ? 1 : 0.8}
/>

// AREA measurements
<Line
  points={flatPoints}
  stroke={baseColor}
  strokeWidth={isSelected ? 5 : 3}
  fill={hexToRgba(baseColor, 0.15)}
  closed={true}
/>

// VOLUME measurements (same as area, different calculation)
<Line
  points={flatPoints}
  stroke={baseColor}
  fill={hexToRgba(baseColor, 0.15)}
  closed={true}
/>

// COUNT measurements
<Circle
  x={points[0].x}
  y={points[0].y}
  radius={12}
  fill={baseColor}
  stroke="white"
  strokeWidth={2}
/>

// NOTE measurements
<Circle x={point.x} y={point.y} radius={8} fill={baseColor} />
<Text x={point.x + 15} y={point.y - 5} text={label} fontSize={12} />
```

**Calculation Logic:**
```typescript
// Linear measurement (feet)
const lengthPx = Math.sqrt(
  Math.pow(points[1].x - points[0].x, 2) + 
  Math.pow(points[1].y - points[0].y, 2)
);
const lengthFt = lengthPx / scalePxPerFoot;

// Area measurement (square feet)
const areaPx2 = calculatePolygonArea(points);
const areaFt2 = areaPx2 / (scalePxPerFoot * scalePxPerFoot);

// Volume measurement (cubic yards)
const volumeFt3 = areaFt2 * depthFeet;
const volumeCy = volumeFt3 / 27;
```

**API Queries:**
```typescript
// Fetch sheets
const { data: sheets } = useQuery<TakeoffSheet[]>({
  queryKey: [`/api/projects/${projectId}/takeoff/sheets`],
});

// Fetch measurements
const { data: measurements } = useQuery<TakeoffMeasurement[]>({
  queryKey: [`/api/takeoff/sheets/${selectedSheet}/measurements`],
  enabled: !!selectedSheet,
});

// Fetch quantity categories
const { data: categories } = useQuery<QuantityCategory[]>({
  queryKey: [`/api/projects/${projectCode}/quantity-categories`],
});
```

**Key Mutations:**
```typescript
// Create measurement
const createMeasurementMutation = useMutation({
  mutationFn: async (data) => apiRequest("POST", "/api/takeoff/measurements", data),
  onSuccess: () => queryClient.invalidateQueries({ 
    queryKey: [`/api/takeoff/sheets/${selectedSheet}/measurements`] 
  }),
});

// Update calibration
const updateCalibrationMutation = useMutation({
  mutationFn: async ({ sheetId, scalePxPerFoot, units }) => 
    apiRequest("PATCH", `/api/takeoff/sheets/${sheetId}/calibration`, { scalePxPerFoot, units }),
});

// Create quantity category
const createCategoryMutation = useMutation({
  mutationFn: async (data) => 
    apiRequest("POST", `/api/projects/${projectCode}/quantity-categories`, data),
});
```

---

### ScopeProgressTracker.tsx

**Location:** `client/src/components/ScopeProgressTracker.tsx`  
**Purpose:** Daily scope of work progress tracking with billing status workflow

**Key Features:**
- Filter by search term, unit, and billing status
- Summary cards grouped by unit
- Expandable progress history per scope item
- Daily quantity completion tracking
- Billing status workflow (NOT_READY → READY_TO_BILL → BILLED)
- URL-synced filter state
- Create new scope items

**Filter State Management:**
```typescript
// Sync FROM URL
useEffect(() => {
  const searchParams = new URLSearchParams(location.split('?')[1] || '');
  const urlSearch = searchParams.get('search') || '';
  const urlUnit = searchParams.get('unit') || 'all';
  const urlStatus = searchParams.get('status') || 'all';
  
  if (urlSearch !== searchTerm) setSearchTerm(urlSearch);
  if (urlUnit !== unitFilter) setUnitFilter(urlUnit);
  if (urlStatus !== statusFilter) setStatusFilter(urlStatus);
}, [location]);

// Sync TO URL
useEffect(() => {
  const params = new URLSearchParams(location.split('?')[1] || '');
  if (searchTerm) params.set('search', searchTerm);
  else params.delete('search');
  
  const queryString = params.toString();
  const newPath = location.split('?')[0] + (queryString ? `?${queryString}` : '');
  if (newPath !== location) setLocation(newPath, { replace: true });
}, [searchTerm, unitFilter, statusFilter]);
```

**Summary Calculation:**
```typescript
const summaryByUnit = filteredScopeItems.reduce((acc, item) => {
  const unit = item.unit;
  if (!acc[unit]) {
    acc[unit] = { total: 0, completed: 0, billed: 0, remaining: 0 };
  }
  const total = parseFloat(item.totalQuantity);
  const completed = parseFloat(item.completedQuantity || "0");
  const billed = parseFloat(item.billedQuantity || "0");
  const remaining = total - completed;
  
  acc[unit].total += total;
  acc[unit].completed += completed;
  acc[unit].billed += billed;
  acc[unit].remaining += remaining;
  return acc;
}, {});
```

**Mutations:**
```typescript
// Create daily progress
const createProgressMutation = useMutation({
  mutationFn: async (data) => 
    apiRequest("POST", `/api/scope-items/${data.scopeItemId}/progress`, data),
  onSuccess: async (_data, variables) => {
    await Promise.all([
      queryClient.invalidateQueries({ 
        queryKey: ["/api/scope-items", variables.scopeItemId, "progress"] 
      }),
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "scope"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] }),
    ]);
  },
});

// Create new scope item
const createScopeItemMutation = useMutation({
  mutationFn: async (data) => 
    apiRequest("POST", `/api/projects/${projectCode}/scope`, data),
});
```

---

### ScopeItemProgressRow.tsx

**Location:** `client/src/components/ScopeItemProgressRow.tsx`  
**Purpose:** Expandable row showing daily progress history with inline billing status editing

**Key Features:**
- Displays all daily progress entries for a scope item
- Inline billing status dropdown (RBAC: SUPERINTENDENT, OFFICE_MANAGER, ADMIN, MANAGER)
- Shows billed date when status = BILLED
- Shows who recorded each entry
- Delete progress entries

**RBAC Check:**
```typescript
const canEditBillingStatus = user && 
  ["SUPERINTENDENT", "OFFICE_MANAGER", "ADMIN", "MANAGER"].includes(user.role);
```

**Billing Status Update:**
```typescript
const updateBillingStatusMutation = useMutation({
  mutationFn: async ({ progressId, billingStatus }) => 
    apiRequest("PATCH", `/api/scope-items/${scopeItemId}/progress/${progressId}`, 
      { billingStatus }),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["/api/scope-items", scopeItemId, "progress"] });
    queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
  },
});
```

**Table Columns:**
- Date (with calendar icon)
- Qty Completed (right-aligned, monospace font)
- Qty Billed (right-aligned, monospace font)
- Billing Status (dropdown if canEditBillingStatus, else badge)
- Billed Date (shows checkmark + date when billed)
- Notes
- Recorded By (creator's full name)
- Actions (delete button)

---

## DATABASE SCHEMA

### Takeoff Tables

#### projectPlans
```typescript
export const projectPlans = pgTable("project_plans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  documentId: varchar("document_id").references(() => planDocuments.id, { onDelete: "set null" }),
  originalPdfUrl: text("original_pdf_url").notNull(),
  fileName: text("file_name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
```

#### quantityCategories
```typescript
export const quantityCategories = pgTable("quantity_categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color").notNull().default("#3b82f6"),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdx: index("quantity_categories_project_idx").on(table.projectId),
}));
```

#### takeoffSheets
```typescript
export const takeoffSheets = pgTable("takeoff_sheets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  planId: varchar("plan_id").references(() => projectPlans.id, { onDelete: "cascade" }),
  imageUrl: text("image_url").notNull(),
  sheetIndex: integer("sheet_index").notNull().default(0),
  sheetName: text("sheet_name"),
  scalePxPerFoot: doublePrecision("scale_px_per_foot"),
  units: text("units").notNull().default("ft"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdx: index("takeoff_sheets_project_idx").on(table.projectId),
  planIdx: index("takeoff_sheets_plan_idx").on(table.planId),
}));
```

#### takeoffMeasurements
```typescript
export const takeoffMeasurements = pgTable("takeoff_measurements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sheetId: varchar("sheet_id").notNull().references(() => takeoffSheets.id, { onDelete: "cascade" }),
  categoryId: varchar("category_id").references(() => quantityCategories.id, { onDelete: "set null" }),
  type: measurementTypeEnum("type").notNull(),
  label: text("label").notNull(),
  points: text("points").notNull(), // JSON string
  arcData: text("arc_data"),
  depthFeet: doublePrecision("depth_feet"),
  count: integer("count"),
  note: text("note"),
  color: text("color").default("#3b82f6"),
  visible: boolean("visible").notNull().default(true),
  source: measurementSourceEnum("source").notNull().default("USER"),
  status: measurementStatusEnum("status").notNull().default("DRAFT"),
  computedLengthFt: doublePrecision("computed_length_ft"),
  computedAreaFt2: doublePrecision("computed_area_ft2"),
  computedVolumeCy: doublePrecision("computed_volume_cy"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  sheetIdx: index("takeoff_measurements_sheet_idx").on(table.sheetId),
  categoryIdx: index("takeoff_measurements_category_idx").on(table.categoryId),
  typeIdx: index("takeoff_measurements_type_idx").on(table.type),
  statusIdx: index("takeoff_measurements_status_idx").on(table.status),
}));
```

#### planDocuments
```typescript
export const planDocuments = pgTable("plan_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  type: documentTypeEnum("type").notNull().default("OTHER"),
  title: text("title").notNull(),
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url").notNull(),
  objectKey: text("object_key"),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  uploadedById: varchar("uploaded_by_id").notNull().references(() => users.id),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
});
```

---

### Estimating Tables

#### estimates
```typescript
export const estimates = pgTable("estimates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull().default(1),
  status: estimateStatusEnum("status").notNull().default("DRAFT"),
  baseBidAmount: decimal("base_bid_amount", { precision: 12, scale: 2 }),
  altPricesJson: text("alt_prices_json"),
  costBreakdownJson: text("cost_breakdown_json"),
  notes: text("notes"),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
```

#### estimateSettings
```typescript
export const estimateSettings = pgTable("estimate_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  defaultMaterialPrices: text("default_material_prices").notNull().default('{}'),
  defaultLaborRates: text("default_labor_rates").notNull().default('{}'),
  defaultEquipmentRates: text("default_equipment_rates").notNull().default('{}'),
  defaultProductionRates: text("default_production_rates").notNull().default('{}'),
  defaultOverheadPercent: doublePrecision("default_overhead_percent").notNull().default(15),
  defaultProfitMarginPercent: doublePrecision("default_profit_margin_percent").notNull().default(20),
  defaultMarkups: text("default_markups").notNull().default('{}'),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
```

#### estimateCrews
```typescript
export const estimateCrews = pgTable("estimate_crews", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  members: text("members").notNull().default('[]'),
  blendedRatePerHour: decimal("blended_rate_per_hour", { precision: 10, scale: 2 }).notNull(),
  productionRateMapping: text("production_rate_mapping").notNull().default('{}'),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
```

#### estimateLineItems
```typescript
export const estimateLineItems = pgTable("estimate_line_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  estimateId: varchar("estimate_id").notNull().references(() => estimates.id, { onDelete: "cascade" }),
  category: estimateItemCategoryEnum("category").notNull(),
  description: text("description").notNull(),
  quantity: decimal("quantity", { precision: 12, scale: 2 }).notNull(),
  unit: text("unit").notNull(),
  materialCost: decimal("material_cost", { precision: 12, scale: 2 }).notNull().default('0'),
  laborHours: decimal("labor_hours", { precision: 10, scale: 2 }).notNull().default('0'),
  laborCost: decimal("labor_cost", { precision: 12, scale: 2 }).notNull().default('0'),
  equipmentHours: decimal("equipment_hours", { precision: 10, scale: 2 }).notNull().default('0'),
  equipmentCost: decimal("equipment_cost", { precision: 12, scale: 2 }).notNull().default('0'),
  consumablesCost: decimal("consumables_cost", { precision: 12, scale: 2 }).notNull().default('0'),
  subcontractCost: decimal("subcontract_cost", { precision: 12, scale: 2 }).notNull().default('0'),
  overheadAllocation: decimal("overhead_allocation", { precision: 12, scale: 2 }).notNull().default('0'),
  profitAllocation: decimal("profit_allocation", { precision: 12, scale: 2 }).notNull().default('0'),
  totalCost: decimal("total_cost", { precision: 12, scale: 2 }).notNull(),
  userAdjusted: boolean("user_adjusted").notNull().default(false),
  metadata: text("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  estimateIdx: index("estimate_line_items_estimate_idx").on(table.estimateId),
  categoryIdx: index("estimate_line_items_category_idx").on(table.category),
}));
```

#### estimateVersions
```typescript
export const estimateVersions = pgTable("estimate_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  estimateId: varchar("estimate_id").notNull().references(() => estimates.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  snapshot: text("snapshot").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  estimateIdx: index("estimate_versions_estimate_idx").on(table.estimateId),
}));
```

#### estimateVendorQuotes
```typescript
export const estimateVendorQuotes = pgTable("estimate_vendor_quotes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  estimateId: varchar("estimate_id").notNull().references(() => estimates.id, { onDelete: "cascade" }),
  vendorName: text("vendor_name").notNull(),
  contactInfo: text("contact_info"),
  scopeDescription: text("scope_description").notNull(),
  quoteAmount: decimal("quote_amount", { precision: 12, scale: 2 }).notNull(),
  fileUrl: text("file_url"),
  fileName: text("file_name"),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  linkedLineItemIds: text("linked_line_item_ids").notNull().default('[]'),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  estimateIdx: index("estimate_vendor_quotes_estimate_idx").on(table.estimateId),
}));
```

#### estimateHistory
```typescript
export const estimateHistory = pgTable("estimate_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  estimateId: varchar("estimate_id").references(() => estimates.id, { onDelete: "cascade" }),
  data: text("data").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

---

### Scope Tracking Tables

#### scopeItems
```typescript
export const scopeItems = pgTable("scope_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  unit: text("unit").notNull(),
  totalQuantity: decimal("total_quantity", { precision: 12, scale: 2 }).notNull(),
  completedQuantity: decimal("completed_quantity", { precision: 12, scale: 2 }).notNull().default("0"),
  billedQuantity: decimal("billed_quantity", { precision: 12, scale: 2 }).notNull().default("0"),
  unitPrice: decimal("unit_price", { precision: 10, scale: 2 }),
  billingStatus: billingStatusEnum("billing_status").notNull().default("NOT_READY"),
  lastBilledDate: timestamp("last_billed_date"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
```

#### dailyScopeProgress
```typescript
export const dailyScopeProgress = pgTable("daily_scope_progress", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  scopeItemId: varchar("scope_item_id").notNull().references(() => scopeItems.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  workDate: date("work_date").notNull(),
  quantityCompleted: decimal("quantity_completed", { precision: 12, scale: 2 }).notNull(),
  billedQuantity: decimal("billed_quantity", { precision: 12, scale: 2 }).notNull().default("0"),
  billingStatus: billingStatusEnum("billing_status").notNull().default("NOT_READY"),
  billedDate: timestamp("billed_date"),
  billedById: varchar("billed_by_id").references(() => users.id),
  notes: text("notes"),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  scopeItemIdx: index("daily_scope_progress_scope_item_idx").on(table.scopeItemId),
  projectIdx: index("daily_scope_progress_project_idx").on(table.projectId),
  workDateIdx: index("daily_scope_progress_work_date_idx").on(table.workDate),
}));
```

---

### Enums

```typescript
// Measurement types for takeoff
export const measurementTypeEnum = pgEnum("measurement_type", 
  ["LINEAR", "AREA", "VOLUME", "COUNT", "NOTE"]
);

// Measurement source (user-drawn or AI-generated)
export const measurementSourceEnum = pgEnum("measurement_source", 
  ["USER", "AI"]
);

// Measurement status
export const measurementStatusEnum = pgEnum("measurement_status", 
  ["DRAFT", "CONFIRMED"]
);

// Billing status for scope items and daily progress
export const billingStatusEnum = pgEnum("billing_status", 
  ["NOT_READY", "READY_TO_BILL", "BILLED"]
);

// Estimate status
export const estimateStatusEnum = pgEnum("estimate_status", 
  ["DRAFT", "SUBMITTED", "WON", "LOST"]
);

// Estimate item categories
export const estimateItemCategoryEnum = pgEnum("estimate_item_category", 
  ["CONCRETE", "EXCAVATION", "PAVERS", "BOLLARDS", "GC", "OVERHEAD", "PROFIT", "GENERAL"]
);

// Scope types for categorization
export const scopeTypeEnum = pgEnum("scope_type", 
  ["CONCRETE", "EXCAVATION", "PAVERS", "BOLLARDS", "UNDERDRAIN", "BASE", "BEDDING", "GENERAL"]
);

// Document types
export const documentTypeEnum = pgEnum("document_type", 
  ["PLANS", "SPECS", "TAKEOFF", "OTHER"]
);
```

---

### Insert/Select Schemas

```typescript
// Takeoff schemas
export const insertProjectPlanSchema = createInsertSchema(projectPlans)
  .omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProjectPlan = z.infer<typeof insertProjectPlanSchema>;
export type ProjectPlan = typeof projectPlans.$inferSelect;

export const insertQuantityCategorySchema = createInsertSchema(quantityCategories)
  .omit({ id: true, createdAt: true, updatedAt: true });
export type InsertQuantityCategory = z.infer<typeof insertQuantityCategorySchema>;
export type QuantityCategory = typeof quantityCategories.$inferSelect;

export const insertTakeoffSheetSchema = createInsertSchema(takeoffSheets)
  .omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTakeoffSheet = z.infer<typeof insertTakeoffSheetSchema>;
export type TakeoffSheet = typeof takeoffSheets.$inferSelect;

export const insertTakeoffMeasurementSchema = createInsertSchema(takeoffMeasurements)
  .omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTakeoffMeasurement = z.infer<typeof insertTakeoffMeasurementSchema>;
export type TakeoffMeasurement = typeof takeoffMeasurements.$inferSelect;

// Estimating schemas
export const insertEstimateSchema = createInsertSchema(estimates)
  .omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEstimate = z.infer<typeof insertEstimateSchema>;
export type Estimate = typeof estimates.$inferSelect;

// Scope schemas
export const insertScopeItemSchema = createInsertSchema(scopeItems)
  .omit({ id: true, createdAt: true, updatedAt: true });
export type InsertScopeItem = z.infer<typeof insertScopeItemSchema>;
export type ScopeItem = typeof scopeItems.$inferSelect;

export const insertDailyScopeProgressSchema = createInsertSchema(dailyScopeProgress)
  .omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDailyScopeProgress = z.infer<typeof insertDailyScopeProgressSchema>;
export type DailyScopeProgress = typeof dailyScopeProgress.$inferSelect;
```

---

## BACKEND API ROUTES

### Takeoff Routes

#### GET /api/projects/:projectId/takeoff/sheets
**Purpose:** Fetch all takeoff sheets for a project  
**Auth:** Required  
**Returns:** Array of takeoff sheets with plan document info

```typescript
app.get("/api/projects/:projectId/takeoff/sheets", requireAuth, async (req: AuthRequest, res) => {
  const { projectId } = req.params;
  const { takeoffSheets, projectPlans } = await import("@shared/schema");

  const sheets = await db
    .select({
      id: takeoffSheets.id,
      projectId: takeoffSheets.projectId,
      planId: takeoffSheets.planId,
      imageUrl: takeoffSheets.imageUrl,
      sheetIndex: takeoffSheets.sheetIndex,
      sheetName: takeoffSheets.sheetName,
      scalePxPerFoot: takeoffSheets.scalePxPerFoot,
      units: takeoffSheets.units,
      createdAt: takeoffSheets.createdAt,
      updatedAt: takeoffSheets.updatedAt,
      documentId: projectPlans.documentId,
    })
    .from(takeoffSheets)
    .leftJoin(projectPlans, eq(takeoffSheets.planId, projectPlans.id))
    .where(eq(takeoffSheets.projectId, projectId))
    .orderBy(takeoffSheets.sheetIndex);

  res.json(sheets);
});
```

#### GET /api/takeoff/sheets/:sheetId/pdf
**Purpose:** Stream PDF directly for a takeoff sheet (with authorization)  
**Auth:** Required  
**Authorization:** User must have project access or document permission  
**Returns:** PDF file stream with caching headers

```typescript
app.get("/api/takeoff/sheets/:sheetId/pdf", requireAuth, async (req: AuthRequest, res) => {
  const { sheetId } = req.params;
  const { takeoffSheets, projectPlans, planDocuments } = await import("@shared/schema");

  // Get sheet with plan and document info
  const [sheetData] = await db
    .select({
      sheet: takeoffSheets,
      plan: projectPlans,
      document: planDocuments,
    })
    .from(takeoffSheets)
    .leftJoin(projectPlans, eq(takeoffSheets.planId, projectPlans.id))
    .leftJoin(planDocuments, eq(projectPlans.documentId, planDocuments.id))
    .where(eq(takeoffSheets.id, sheetId))
    .limit(1);

  if (!sheetData) {
    res.status(404).json({ error: "Sheet not found" });
    return;
  }

  const { sheet, document } = sheetData;

  // Verify project access
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, sheet.projectId))
    .limit(1);

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  // Check RBAC
  const userRole = req.user!.role;
  const userId = req.user!.id;
  const hasRoleAccess = userRole === "ADMIN" || userRole === "MANAGER";

  let hasDocumentAccess = hasRoleAccess;
  if (!hasDocumentAccess && document) {
    const isUploader = document.uploadedById === userId;
    
    const [permission] = await db
      .select()
      .from(filePermissions)
      .where(
        and(
          eq(filePermissions.fileId, document.id),
          eq(filePermissions.fileType, "DOCUMENT"),
          eq(filePermissions.userId, userId)
        )
      )
      .limit(1);

    hasDocumentAccess = isUploader || !!permission;
  }

  if (!hasDocumentAccess) {
    res.status(403).json({ error: "You do not have permission to access this document" });
    return;
  }

  // Stream from object storage if available
  if (document?.objectKey) {
    const { ObjectStorageService } = await import("./objectStorage");
    const objectStorageService = new ObjectStorageService();
    const objectFile = await objectStorageService.getObjectEntityFile(document.objectKey);
    await objectStorageService.downloadObject(objectFile, res, 3600); // 1 hour cache
    return;
  }

  res.status(404).json({ error: "No PDF file available for this sheet" });
});
```

#### POST /api/projects/:projectId/takeoff/import-plan
**Purpose:** Import a plan document to takeoff workspace  
**Auth:** Required  
**Body:** `{ documentId: string }`  
**Process:**
1. Validates document exists and belongs to project
2. Downloads PDF from object storage
3. Uses pdfjs-dist to determine page count
4. Creates projectPlan record
5. Batch inserts takeoffSheet records (one per page)
6. Logs audit trail

```typescript
app.post("/api/projects/:projectId/takeoff/import-plan", requireAuth, async (req: AuthRequest, res) => {
  const { projectId } = req.params;
  const { documentId } = req.body;

  const { planDocuments, projectPlans, takeoffSheets } = await import("@shared/schema");

  // Get document
  const [document] = await db
    .select()
    .from(planDocuments)
    .where(eq(planDocuments.id, documentId))
    .limit(1);

  if (!document || document.projectId !== projectId) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  // Check if already imported
  const [existingPlan] = await db
    .select()
    .from(projectPlans)
    .where(and(
      eq(projectPlans.projectId, projectId),
      eq(projectPlans.documentId, documentId)
    ))
    .limit(1);

  if (existingPlan) {
    res.status(400).json({ error: "This document is already imported" });
    return;
  }

  // Validate PDF and get page count
  let pageCount = 1;
  if (!document.objectKey) {
    res.status(400).json({ error: "Document has no file attached" });
    return;
  }

  try {
    const { ObjectStorageService } = await import("./objectStorage");
    const objectStorageService = new ObjectStorageService();
    const objectFile = await objectStorageService.getObjectEntityFile(document.objectKey);
    const [pdfBuffer] = await objectFile.download();
    
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(pdfBuffer),
      useSystemFonts: true,
    });
    const pdfDoc = await loadingTask.promise;
    pageCount = pdfDoc.numPages;
  } catch (error) {
    res.status(400).json({ 
      error: "Failed to process PDF file. The file may be corrupted." 
    });
    return;
  }

  // Create plan
  const [plan] = await db.insert(projectPlans).values({
    projectId,
    documentId: documentId,
    originalPdfUrl: document.fileUrl,
    fileName: document.fileName,
  }).returning();

  // Prepare sheets for batch insert
  const baseSheetName = document.title || document.fileName.replace(/\.[^/.]+$/, '');
  const sheetValues = [];
  
  for (let i = 0; i < pageCount; i++) {
    const sheetName = pageCount > 1 
      ? `${baseSheetName} - Page ${i + 1}`
      : baseSheetName;
    
    sheetValues.push({
      projectId,
      planId: plan.id,
      imageUrl: document.fileUrl,
      sheetIndex: i,
      sheetName,
    });
  }

  // Batch insert sheets with compensating cleanup on failure
  let sheets;
  try {
    sheets = await db.insert(takeoffSheets).values(sheetValues).returning();
  } catch (sheetError) {
    await db.delete(projectPlans).where(eq(projectPlans.id, plan.id));
    throw sheetError;
  }

  // Audit log
  await logCreate(req.user!.id, "project_plans", plan.id, {
    projectId,
    fileName: document.fileName,
    documentId,
    pageCount,
  }, req);

  res.status(201).json({ plan, sheets });
});
```

#### GET /api/takeoff/sheets/:sheetId/measurements
**Purpose:** Get all measurements for a sheet  
**Auth:** Required  
**Returns:** Array of measurements with parsed points

```typescript
app.get("/api/takeoff/sheets/:sheetId/measurements", requireAuth, async (req: AuthRequest, res) => {
  const { sheetId } = req.params;
  const { takeoffMeasurements } = await import("@shared/schema");

  const measurements = await db
    .select()
    .from(takeoffMeasurements)
    .where(eq(takeoffMeasurements.sheetId, sheetId))
    .orderBy(takeoffMeasurements.createdAt);

  // Parse points JSON string to array
  const parsedMeasurements = measurements.map(m => ({
    ...m,
    points: JSON.parse(m.points),
  }));

  res.json(parsedMeasurements);
});
```

#### POST /api/takeoff/measurements
**Purpose:** Create a new measurement  
**Auth:** Required  
**Authorization:** Only ADMIN/MANAGER or users assigned to the project via crew  
**Body:** InsertTakeoffMeasurement with points as array  
**Process:**
1. Sanitizes label input
2. Converts points array to JSON string
3. Validates sheet exists and belongs to valid project
4. Checks user authorization via crew assignments
5. Inserts measurement

```typescript
app.post("/api/takeoff/measurements", requireAuth, async (req: AuthRequest, res) => {
  const { takeoffMeasurements, takeoffSheets, projects, crewProjectAssignments, crewMembers, insertTakeoffMeasurementSchema } = await import("@shared/schema");

  // Sanitize inputs
  const sanitizedBody = {
    ...req.body,
    label: req.body.label ? sanitizeShortText(req.body.label) : undefined,
  };

  // Convert points array to JSON string
  const bodyWithStringifiedPoints = {
    ...sanitizedBody,
    points: Array.isArray(sanitizedBody.points) 
      ? JSON.stringify(sanitizedBody.points) 
      : sanitizedBody.points,
  };

  const validated = insertTakeoffMeasurementSchema.parse(bodyWithStringifiedPoints);

  // Validate sheet exists
  const sheetWithProject = await db
    .select({
      sheetId: takeoffSheets.id,
      projectId: takeoffSheets.projectId,
      projectCode: projects.code,
    })
    .from(takeoffSheets)
    .innerJoin(projects, eq(takeoffSheets.projectId, projects.id))
    .where(eq(takeoffSheets.id, validated.sheetId))
    .limit(1);

  if (!sheetWithProject || sheetWithProject.length === 0) {
    res.status(404).json({ error: "Sheet not found" });
    return;
  }

  // Authorization: ADMIN/MANAGER or assigned to project
  const userRole = req.user!.role;
  if (userRole !== "ADMIN" && userRole !== "MANAGER") {
    const userAssignment = await db
      .select({ id: crewProjectAssignments.id })
      .from(crewProjectAssignments)
      .innerJoin(crewMembers, eq(crewProjectAssignments.crewId, crewMembers.crewId))
      .where(
        and(
          eq(crewProjectAssignments.projectId, sheetWithProject[0].projectId),
          eq(crewMembers.userId, req.user!.id)
        )
      )
      .limit(1);

    if (!userAssignment || userAssignment.length === 0) {
      res.status(403).json({ error: "You do not have access to this project" });
      return;
    }
  }

  const [measurement] = await db.insert(takeoffMeasurements).values(validated).returning();
  res.status(201).json(measurement);
});
```

#### PATCH /api/takeoff/measurements/:id
**Purpose:** Update a measurement  
**Auth:** Required  
**Body:** Partial InsertTakeoffMeasurement

```typescript
app.patch("/api/takeoff/measurements/:id", requireAuth, async (req: AuthRequest, res) => {
  const { id } = req.params;
  const { takeoffMeasurements, insertTakeoffMeasurementSchema } = await import("@shared/schema");

  const sanitizedBody = {
    ...req.body,
    label: req.body.label ? sanitizeShortText(req.body.label) : undefined,
  };

  const validated = insertTakeoffMeasurementSchema.partial().parse(sanitizedBody);

  const [updated] = await db
    .update(takeoffMeasurements)
    .set({ ...validated, updatedAt: new Date() })
    .where(eq(takeoffMeasurements.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Measurement not found" });
    return;
  }

  res.json(updated);
});
```

#### DELETE /api/takeoff/measurements/:id
**Purpose:** Delete a measurement  
**Auth:** Required

```typescript
app.delete("/api/takeoff/measurements/:id", requireAuth, async (req: AuthRequest, res) => {
  const { id } = req.params;
  const { takeoffMeasurements } = await import("@shared/schema");

  const [deleted] = await db
    .delete(takeoffMeasurements)
    .where(eq(takeoffMeasurements.id, id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Measurement not found" });
    return;
  }

  res.json({ success: true });
});
```

#### PATCH /api/takeoff/sheets/:id/calibration
**Purpose:** Update sheet calibration (scale and units)  
**Auth:** Required  
**Authorization:** Only ADMIN/MANAGER or users assigned to the project  
**Body:** `{ scalePxPerFoot: number, units: "ft" | "m" }`  
**Validation:** scalePxPerFoot must be finite and > 0

```typescript
app.patch("/api/takeoff/sheets/:id/calibration", requireAuth, async (req: AuthRequest, res) => {
  const { id } = req.params;
  const { scalePxPerFoot, units } = req.body;
  const { takeoffSheets, projects, crewProjectAssignments, crewMembers } = await import("@shared/schema");

  if (!scalePxPerFoot || !Number.isFinite(scalePxPerFoot) || scalePxPerFoot <= 0) {
    res.status(400).json({ error: "Valid scale is required" });
    return;
  }

  // Validate sheet exists
  const sheetWithProject = await db
    .select({
      sheetId: takeoffSheets.id,
      projectId: takeoffSheets.projectId,
    })
    .from(takeoffSheets)
    .innerJoin(projects, eq(takeoffSheets.projectId, projects.id))
    .where(eq(takeoffSheets.id, id))
    .limit(1);

  if (!sheetWithProject || sheetWithProject.length === 0) {
    res.status(404).json({ error: "Sheet not found" });
    return;
  }

  // Authorization
  const userRole = req.user!.role;
  if (userRole !== "ADMIN" && userRole !== "MANAGER") {
    const userAssignment = await db
      .select({ id: crewProjectAssignments.id })
      .from(crewProjectAssignments)
      .innerJoin(crewMembers, eq(crewProjectAssignments.crewId, crewMembers.crewId))
      .where(
        and(
          eq(crewProjectAssignments.projectId, sheetWithProject[0].projectId),
          eq(crewMembers.userId, req.user!.id)
        )
      )
      .limit(1);

    if (!userAssignment || userAssignment.length === 0) {
      res.status(403).json({ error: "You do not have access to this project" });
      return;
    }
  }

  const [updated] = await db
    .update(takeoffSheets)
    .set({ 
      scalePxPerFoot, 
      units: units || "ft",
      updatedAt: new Date() 
    })
    .where(eq(takeoffSheets.id, id))
    .returning();

  res.json(updated);
});
```

---

### Quantity Category Routes

#### GET /api/projects/:code/quantity-categories
**Purpose:** Get all quantity categories for a project  
**Auth:** Required

```typescript
app.get("/api/projects/:code/quantity-categories", requireAuth, async (req: AuthRequest, res) => {
  const { code } = req.params;
  const { quantityCategories } = await import("@shared/schema");

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.code, code))
    .limit(1);

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const categories = await db
    .select()
    .from(quantityCategories)
    .where(eq(quantityCategories.projectId, project.id))
    .orderBy(quantityCategories.displayOrder);

  res.json(categories);
});
```

#### POST /api/projects/:code/quantity-categories
**Purpose:** Create a new quantity category  
**Auth:** Required  
**Body:** `{ name: string, color?: string, displayOrder?: number, description?: string }`

```typescript
app.post("/api/projects/:code/quantity-categories", requireAuth, async (req: AuthRequest, res) => {
  const { code } = req.params;
  const { quantityCategories, insertQuantityCategorySchema } = await import("@shared/schema");

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.code, code))
    .limit(1);

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const sanitizedBody = {
    ...req.body,
    name: sanitizeShortText(req.body.name),
    description: req.body.description ? sanitizeText(req.body.description) : undefined,
  };

  const validated = insertQuantityCategorySchema.parse({
    projectId: project.id,
    ...sanitizedBody,
  });

  const [category] = await db
    .insert(quantityCategories)
    .values(validated)
    .returning();

  res.status(201).json(category);
});
```

#### PATCH /api/quantity-categories/:id
**Purpose:** Update a quantity category  
**Auth:** Required

```typescript
app.patch("/api/quantity-categories/:id", requireAuth, async (req: AuthRequest, res) => {
  const { id } = req.params;
  const { quantityCategories, insertQuantityCategorySchema } = await import("@shared/schema");

  const sanitizedBody = {
    ...req.body,
    name: req.body.name ? sanitizeShortText(req.body.name) : undefined,
    description: req.body.description ? sanitizeText(req.body.description) : undefined,
  };

  const validated = insertQuantityCategorySchema.partial().parse(sanitizedBody);

  const [updated] = await db
    .update(quantityCategories)
    .set({ ...validated, updatedAt: new Date() })
    .where(eq(quantityCategories.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Category not found" });
    return;
  }

  res.json(updated);
});
```

#### DELETE /api/quantity-categories/:id
**Purpose:** Delete a quantity category  
**Auth:** Required

```typescript
app.delete("/api/quantity-categories/:id", requireAuth, async (req: AuthRequest, res) => {
  const { id } = req.params;
  const { quantityCategories } = await import("@shared/schema");

  const [deleted] = await db
    .delete(quantityCategories)
    .where(eq(quantityCategories.id, id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Category not found" });
    return;
  }

  res.json({ success: true });
});
```

---

## TECHNICAL STACK

### Frontend
- **React + TypeScript**
- **Konva**: Canvas rendering for interactive measurements
- **react-konva**: React bindings for Konva
- **pdfjs-dist**: PDF rendering and page extraction
- **TanStack Query**: Data fetching and caching
- **Wouter**: Routing
- **shadcn/ui**: UI components
- **Tailwind CSS**: Styling

### Backend
- **Express.js**: Web server
- **Drizzle ORM**: Database ORM with Neon HTTP adapter
- **PostgreSQL (Neon)**: Database
- **Replit Object Storage**: File storage for PDFs
- **pdfjs-dist (server-side)**: PDF processing for page counting

### Key Libraries
- **pdfjs-dist**: Used both client-side (rendering) and server-side (validation)
- **konva**: Interactive canvas manipulation
- **@google-cloud/storage**: Object storage backend (via Replit abstraction)

---

## KEY FEATURES

### 1. Interactive PDF Drawing
- Konva-based canvas system
- Multi-tool support (6 tools total)
- Real-time visual feedback during drawing
- Click-to-place points for polygons
- Double-click or click first point to close polygons
- Layer-based rendering (fill → outline → points → highlights)

### 2. Measurement Tools

**LINEAR (Blue)**
- Two-point line measurement
- Computed in linear feet (LF)
- Pythagorean distance calculation
- Supports diagonal measurements

**AREA (Green)**
- Multi-point polygon
- Computed in square feet (SF)
- Shoelace formula for area calculation
- Supports irregular shapes

**VOLUME (Orange)**
- Multi-point polygon with depth
- Computed in cubic yards (CY)
- Area × depth ÷ 27 conversion
- Requires depth input for volume calculation

**COUNT (Purple)**
- Single-point marker
- No quantity computation (count = 1 per marker)
- Used for counting discrete items (manholes, fixtures, etc.)

**NOTE (Yellow)**
- Single-point pin with label
- Text annotation on plans
- No quantity computation

### 3. Calibration System

**Manual Calibration:**
- Click two points on known distance
- Enter real-world distance + units (ft or m)
- Calculates pixels per foot scale factor
- Applied to all measurements on sheet

**Preset Scales:**
- Architectural: 1/16" to 3" scales
- Civil/Site: 1"=10' to 1"=100' scales
- Structural: 1/8" to 3" scales
- Pre-calculated pixels per foot at 96 DPI
- One-click application

### 4. Quantity Categories
- Color-coded organization
- Per-project categories
- Drag-to-reorder display order
- Filter measurements by category
- Automatic color assignment to measurements
- Summary totals by category

### 5. Scope Progress Tracking
- Daily quantity completion recording
- Billing status workflow (NOT_READY → READY_TO_BILL → BILLED)
- Automatic quantity aggregation
- Summary cards grouped by unit
- URL-synced filters (search, unit, status)
- Expandable progress history
- Inline billing status editing (RBAC-protected)

### 6. RBAC Implementation

**Project-Level Access:**
- ADMIN/MANAGER: Full access to all projects
- Other roles: Access via crew project assignments
- Authorization checks on all mutating operations

**Billing Status Editing:**
- SUPERINTENDENT: Can mark as READY_TO_BILL
- OFFICE_MANAGER: Can mark as BILLED (auto-fills billedDate + billedById)
- ADMIN/MANAGER: Full control

**Document Access:**
- Document uploader has access
- Users with explicit file permissions
- ADMIN/MANAGER have full access

### 7. Database Optimizations
- Indexed foreign keys for fast joins
- Drizzle `.as()` method for table aliasing (Neon HTTP compatibility)
- Batch inserts for multi-page PDF imports
- Compensating cleanup transactions (plan + sheets)
- JSON storage for flexible metadata (points, snapshots)

### 8. PDF Processing
- Server-side validation with pdfjs-dist
- Page count extraction before database insertion
- Object storage integration for secure file access
- Presigned URL streaming with caching headers
- Multi-page sheet generation (one sheet per page)

### 9. Data Persistence
- Measurements stored with computed quantities
- Points stored as JSON strings
- Category associations via foreign keys
- Audit logging for plan imports
- Historical tracking via estimateHistory and estimateVersions

### 10. User Experience
- Fullscreen mode for large plans
- Zoom and pan controls
- Visual tool selection feedback
- Color-coded measurement types
- Hover highlights for measurements
- Selection state management
- In-progress drawing preview
- Undo-friendly delete operations

---

## FILE LOCATIONS

```
client/src/components/
  ├── TakeoffWorkspace.tsx       # 1760 lines - Main takeoff workspace
  ├── ScopeProgressTracker.tsx   # Scope progress tracking UI
  └── ScopeItemProgressRow.tsx   # Expandable progress history row

shared/
  └── schema.ts                   # Database schema (10+ takeoff/estimating tables)

server/
  └── routes.ts                   # API routes (lines 4201-4917 for takeoff)
```

---

## USAGE EXAMPLE

```typescript
// Import plan to takeoff workspace
POST /api/projects/proj-123/takeoff/import-plan
{
  "documentId": "doc-456"
}
// Response: Creates plan + sheets (one per PDF page)

// Create measurement
POST /api/takeoff/measurements
{
  "sheetId": "sheet-789",
  "type": "AREA",
  "label": "Building Footprint",
  "points": "[{\"x\":100,\"y\":200},{\"x\":300,\"y\":200},{\"x\":300,\"y\":400}]",
  "categoryId": "cat-111",
  "computedAreaFt2": 1250.50
}

// Update calibration
PATCH /api/takeoff/sheets/sheet-789/calibration
{
  "scalePxPerFoot": 24,
  "units": "ft"
}
// All measurements recalculated automatically

// Record daily progress
POST /api/scope-items/scope-222/progress
{
  "workDate": "2025-11-22",
  "quantityCompleted": "150.00",
  "billedQuantity": "0.00",
  "billingStatus": "NOT_READY",
  "notes": "Excavation complete for north section"
}

// Update billing status (Office Manager)
PATCH /api/scope-items/scope-222/progress/prog-333
{
  "billingStatus": "BILLED"
}
// Auto-fills billedDate and billedById
```

---

## NOTES

- **Measurement Persistence**: All measurements are immediately persisted to database
- **Real-time Calculations**: Quantities computed client-side and stored in database
- **Multi-page PDFs**: Each page becomes a separate takeoff sheet
- **Category Color Coding**: Measurements inherit category color when assigned
- **Authorization Pattern**: Project-level via crew assignments for non-admin users
- **Drizzle Compatibility**: Uses `.as()` method for table aliasing with Neon HTTP
- **Object Storage**: PDFs stored in Replit Object Storage, streamed with presigned URLs
- **Audit Trail**: Plan imports logged via audit system
- **Transaction Safety**: Compensating cleanup on failed batch inserts

---

**END OF EXTRACTION**
