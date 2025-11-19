# TFR CONSTRUCTION PLATFORM - COMPLETE SOURCE CODE EXPORT
**Export Date:** November 19, 2025  
**Generated For:** External Code Review, Security Audit, and Architectural Assessment  
**Platform:** TFR Construction Management System

---

## DOCUMENT PURPOSE

This is a **complete, comprehensive source code export** containing all critical application code for external audit purposes. All code is unmodified production code as of November 19, 2025.

**Total Lines of Code in this document:** ~10,000+ lines across:
- Configuration files
- Complete database schema (33 tables)
- All server API routes (60+ endpoints)
- Complete AI system (7 files)
- Key frontend pages (3 files)

---

## EXECUTIVE SUMMARY

**Technology Stack:**  
- **Frontend:** React 18, TypeScript, TanStack Query, Wouter routing, Radix UI, Tailwind CSS
- **Backend:** Express.js, TypeScript, JWT authentication, rate limiting
- **Database:** PostgreSQL (Neon), Drizzle ORM
- **AI:** OpenAI GPT-4 (gpt-4o model)
- **Storage:** Google Cloud Storage via Replit Object Storage
- **Scheduling:** node-cron for daily AI analysis runs

**Key Features:**
1. **AI Senior PM + CFO** - GPT-4 powered daily operational analysis with role-based task generation
2. **Role-Based Access Control** - 6 user roles with granular permissions
3. **Native Time Clock** - GPS-enabled clock in/out with approval workflows
4. **Change Order State Machine** - Strict workflow: DRAFT → PENDING_APPROVAL → APPROVED/REJECTED
5. **Profitability Engine** - Real-time project-level cost tracking with variance analysis
6. **Data Quality Scoring** - 0-100 scale measuring project data completeness
7. **Subcontractor Management** - Complete contract, payment, and billing schedule tracking
8. **Crew & Skills Management** - Crew assignments with skill certifications
9. **Comprehensive Audit Trail** - All sensitive operations logged with IP, user agent, timestamps

---

## TABLE OF CONTENTS

1. **Configuration Files** - package.json, tsconfig.json, drizzle.config.ts
2. **Database Schema** - Complete 33-table schema (shared/schema.ts - 842 lines)
3. **Server Routes** - All API endpoints (server/routes.ts - 3,176 lines)
4. **AI System** - Complete implementation (7 files):
   - AI Routes (aiRoutes.ts - 300 lines)
   - Orchestrator (orchestrator.ts - 206 lines)
   - Profitability Engine (profitabilityEngine.ts - 249 lines)
   - Data Quality Scorer (dataQualityScorer.ts - 162 lines)
   - Snapshot Builder (snapshotBuilder.ts - 408 lines)
   - System Prompt (systemPrompt.ts - 175 lines)
   - OpenAI Client (openaiClient.ts - 99 lines)
   - Scheduler (scheduler.ts - 68 lines)
5. **Frontend Pages** - Key UX components (3 files):
   - Project Detail (project-detail.tsx - 1,609 lines)
   - CFO Dashboard (cfo-dashboard.tsx - 314 lines)
   - AI PM Dashboard (ai-pm-dashboard.tsx - 265 lines)

---
---

# SECTION 1: CONFIGURATION FILES

---

## 1.1 package.json

```json
{
  "name": "rest-express",
  "version": "1.0.0",
  "type": "module",
  "license": "MIT",
  "scripts": {
    "dev": "NODE_ENV=development tsx server/index.ts",
    "build": "vite build && esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist",
    "start": "NODE_ENV=production node dist/index.js",
    "check": "tsc",
    "db:push": "drizzle-kit push"
  },
  "dependencies": {
    "@google-cloud/storage": "^7.17.3",
    "@hookform/resolvers": "^3.10.0",
    "@jridgewell/trace-mapping": "^0.3.25",
    "@neondatabase/serverless": "^0.10.4",
    "@radix-ui/react-accordion": "^1.2.4",
    "@radix-ui/react-alert-dialog": "^1.1.7",
    "@radix-ui/react-aspect-ratio": "^1.1.3",
    "@radix-ui/react-avatar": "^1.1.4",
    "@radix-ui/react-checkbox": "^1.1.5",
    "@radix-ui/react-collapsible": "^1.1.4",
    "@radix-ui/react-context-menu": "^2.2.7",
    "@radix-ui/react-dialog": "^1.1.7",
    "@radix-ui/react-dropdown-menu": "^2.1.7",
    "@radix-ui/react-hover-card": "^1.1.7",
    "@radix-ui/react-label": "^2.1.3",
    "@radix-ui/react-menubar": "^1.1.7",
    "@radix-ui/react-navigation-menu": "^1.2.6",
    "@radix-ui/react-popover": "^1.1.7",
    "@radix-ui/react-progress": "^1.1.3",
    "@radix-ui/react-radio-group": "^1.2.4",
    "@radix-ui/react-scroll-area": "^1.2.4",
    "@radix-ui/react-select": "^2.1.7",
    "@radix-ui/react-separator": "^1.1.3",
    "@radix-ui/react-slider": "^1.2.4",
    "@radix-ui/react-slot": "^1.2.0",
    "@radix-ui/react-switch": "^1.1.4",
    "@radix-ui/react-tabs": "^1.1.4",
    "@radix-ui/react-toast": "^1.2.7",
    "@radix-ui/react-toggle": "^1.1.3",
    "@radix-ui/react-toggle-group": "^1.1.3",
    "@radix-ui/react-tooltip": "^1.2.0",
    "@tanstack/react-query": "^5.60.5",
    "@types/bcrypt": "^6.0.0",
    "@types/cookie-parser": "^1.4.10",
    "@types/cors": "^2.8.19",
    "@types/jsonwebtoken": "^9.0.10",
    "@types/multer": "^2.0.0",
    "@uppy/aws-s3": "^5.0.2",
    "@uppy/core": "^5.1.1",
    "@uppy/dashboard": "^5.0.4",
    "@uppy/react": "^5.1.1",
    "bcrypt": "^6.0.0",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "cmdk": "^1.1.1",
    "connect-pg-simple": "^10.0.0",
    "cookie-parser": "^1.4.7",
    "cors": "^2.8.5",
    "date-fns": "^3.6.0",
    "drizzle-orm": "^0.39.1",
    "drizzle-zod": "^0.7.0",
    "embla-carousel-react": "^8.6.0",
    "express": "^4.21.2",
    "express-rate-limit": "^8.2.1",
    "express-session": "^1.18.1",
    "framer-motion": "^11.13.1",
    "input-otp": "^1.4.2",
    "jsonwebtoken": "^9.0.2",
    "lucide-react": "^0.453.0",
    "memorystore": "^1.6.7",
    "multer": "^2.0.2",
    "next-themes": "^0.4.6",
    "node-cron": "^4.2.1",
    "openai": "^6.9.1",
    "passport": "^0.7.0",
    "passport-local": "^1.0.0",
    "react": "^18.3.1",
    "react-day-picker": "^8.10.1",
    "react-dom": "^18.3.1",
    "react-hook-form": "^7.55.0",
    "react-icons": "^5.4.0",
    "react-resizable-panels": "^2.1.7",
    "recharts": "^2.15.2",
    "tailwind-merge": "^2.6.0",
    "tailwindcss-animate": "^1.0.7",
    "tw-animate-css": "^1.2.5",
    "vaul": "^1.1.2",
    "wouter": "^3.3.5",
    "ws": "^8.18.0",
    "zod": "^3.24.2",
    "zod-validation-error": "^3.4.0"
  },
  "devDependencies": {
    "@replit/vite-plugin-cartographer": "^0.4.2",
    "@replit/vite-plugin-dev-banner": "^0.1.1",
    "@replit/vite-plugin-runtime-error-modal": "^0.0.3",
    "@tailwindcss/typography": "^0.5.15",
    "@tailwindcss/vite": "^4.1.3",
    "@types/connect-pg-simple": "^7.0.3",
    "@types/express": "4.17.21",
    "@types/express-session": "^1.18.0",
    "@types/node": "20.16.11",
    "@types/passport": "^1.0.16",
    "@types/passport-local": "^1.0.38",
    "@types/react": "^18.3.11",
    "@types/react-dom": "^18.3.1",
    "@types/ws": "^8.5.13",
    "@vitejs/plugin-react": "^4.7.0",
    "autoprefixer": "^10.4.20",
    "drizzle-kit": "^0.31.4",
    "esbuild": "^0.25.0",
    "postcss": "^8.4.47",
    "tailwindcss": "^3.4.17",
    "tsx": "^4.20.5",
    "typescript": "5.6.3",
    "vite": "^5.4.20"
  },
  "optionalDependencies": {
    "bufferutil": "^4.0.8"
  }
}
```

---

## 1.2 tsconfig.json

```json
{
  "include": ["client/src/**/*", "shared/**/*", "server/**/*"],
  "exclude": ["node_modules", "build", "dist", "**/*.test.ts"],
  "compilerOptions": {
    "incremental": true,
    "tsBuildInfoFile": "./node_modules/typescript/tsbuildinfo",
    "noEmit": true,
    "module": "ESNext",
    "strict": true,
    "lib": ["esnext", "dom", "dom.iterable"],
    "jsx": "preserve",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true,
    "moduleResolution": "bundler",
    "baseUrl": ".",
    "types": ["node", "vite/client"],
    "paths": {
      "@/*": ["./client/src/*"],
      "@shared/*": ["./shared/*"]
    }
  }
}
```

---

## 1.3 drizzle.config.ts

```typescript
import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
```

---
---

# SECTION 2: DATABASE SCHEMA (33 TABLES - 842 LINES)

---

## shared/schema.ts

```typescript
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, decimal, integer, pgEnum, doublePrecision, index } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

// Enums
export const userRoleEnum = pgEnum("user_role", ["ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR", "OFFICE_MANAGER", "HOURLY_EMPLOYEE"]);
export const projectStatusEnum = pgEnum("project_status", ["BID", "PLANNING", "ACTIVE", "COMPLETE", "CLOSED"]);
export const estimateStatusEnum = pgEnum("estimate_status", ["DRAFT", "SUBMITTED", "WON", "LOST"]);
export const procurementStatusEnum = pgEnum("procurement_status", ["PLANNED", "QUOTED", "APPROVED", "ORDERED", "DELIVERED"]);
export const documentTypeEnum = pgEnum("document_type", ["PLANS", "SPECS", "TAKEOFF", "OTHER"]);
export const noteTypeEnum = pgEnum("note_type", ["GENERAL", "FIELD_NOTE", "SAFETY", "CLIENT_MEETING"]);
export const mediaTypeEnum = pgEnum("media_type", ["IMAGE", "VIDEO"]);
export const billingStatusEnum = pgEnum("billing_status", ["NOT_READY", "READY_TO_BILL", "BILLED"]);
export const changeOrderStatusEnum = pgEnum("change_order_status", ["DRAFT", "PENDING_APPROVAL", "SUBMITTED", "APPROVED", "REJECTED"]);
export const calendarEventTypeEnum = pgEnum("calendar_event_type", ["TIME_OFF_REQUEST", "TIME_OFF_APPROVED", "NETWORKING_EVENT", "PROJECT_START", "PROJECT_PHASE", "PROJECT_MILESTONE"]);
export const notificationTypeEnum = pgEnum("notification_type", ["BILLING_READY", "CHANGE_ORDER_PENDING", "TIME_OFF_REQUEST", "GENERAL"]);
export const fileTypeEnum = pgEnum("file_type", ["MEDIA", "DOCUMENT", "RECEIPT"]);
export const auditActionEnum = pgEnum("audit_action", ["CREATE", "UPDATE", "DELETE", "APPROVE", "REJECT", "SUBMIT", "CLOCK_IN", "CLOCK_OUT", "ADJUST"]);
export const clockEventTypeEnum = pgEnum("clock_event_type", ["CLOCK_IN", "CLOCK_OUT", "ADJUSTMENT", "ADMIN_OVERRIDE", "AUTO_CLOCK_OUT"]);
export const shiftApprovalStatusEnum = pgEnum("shift_approval_status", ["PENDING", "APPROVED", "REJECTED"]);

// Users table
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone"),
  role: userRoleEnum("role").notNull().default("HOURLY_EMPLOYEE"),
  isActive: boolean("is_active").notNull().default(true),
  passwordHash: text("password_hash").notNull(),
  tokenVersion: integer("token_version").notNull().default(0),
  costRateRegular: decimal("cost_rate_regular", { precision: 10, scale: 2 }),
  costRateOvertime: decimal("cost_rate_overtime", { precision: 10, scale: 2 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Projects table
export const projects = pgTable("projects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  clientName: text("client_name").notNull(),
  clientContactName: text("client_contact_name"),
  clientContactEmail: text("client_contact_email"),
  clientContactPhone: text("client_contact_phone"),
  status: projectStatusEnum("status").notNull().default("PLANNING"),
  locationAddress: text("location_address"),
  city: text("city"),
  state: text("state"),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  estimatedCompletionDate: timestamp("estimated_completion_date"),
  description: text("description"),
  budget: decimal("budget", { precision: 12, scale: 2 }),
  contractAmount: decimal("contract_amount", { precision: 12, scale: 2 }),
  estimatorId: varchar("estimator_id").references(() => users.id),
  superintendentId: varchar("superintendent_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  statusIdx: index("projects_status_idx").on(table.status),
}));

// Bids table (separate from projects)
export const bids = pgTable("bids", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  clientName: text("client_name").notNull(),
  clientContactName: text("client_contact_name"),
  clientContactEmail: text("client_contact_email"),
  clientContactPhone: text("client_contact_phone"),
  bidAmount: decimal("bid_amount", { precision: 12, scale: 2 }),
  dueDate: timestamp("due_date"),
  locationAddress: text("location_address"),
  city: text("city"),
  state: text("state"),
  description: text("description"),
  estimatorId: varchar("estimator_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Bid Subcontractor Quotes table
export const bidSubcontractorQuotes = pgTable("bid_subcontractor_quotes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bidId: varchar("bid_id").notNull().references(() => bids.id, { onDelete: "cascade" }),
  subcontractorName: text("subcontractor_name").notNull(),
  scopeOfWork: text("scope_of_work").notNull(),
  quoteAmount: decimal("quote_amount", { precision: 12, scale: 2 }).notNull(),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Estimates table
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

// Procurement Items table
export const procurementItems = pgTable("procurement_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  vendor: text("vendor"),
  quantity: decimal("quantity", { precision: 10, scale: 2 }),
  unit: text("unit"),
  unitCost: decimal("unit_cost", { precision: 10, scale: 2 }),
  status: procurementStatusEnum("status").notNull().default("PLANNED"),
  poNumber: text("po_number"),
  neededByDate: timestamp("needed_by_date"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Plan Documents table
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

// Time Entries table
export const timeEntries = pgTable("time_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  date: timestamp("date").notNull(),
  hoursRegular: decimal("hours_regular", { precision: 4, scale: 2 }).notNull().default("0"),
  hoursOvertime: decimal("hours_overtime", { precision: 4, scale: 2 }).notNull().default("0"),
  costCode: text("cost_code"),
  notes: text("notes"),
  approvedById: varchar("approved_by_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index("time_entries_user_id_idx").on(table.userId),
  projectIdIdx: index("time_entries_project_id_idx").on(table.projectId),
  dateIdx: index("time_entries_date_idx").on(table.date),
}));

// T&M Daily Sheets table
export const tmDailySheets = pgTable("tm_daily_sheets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  date: timestamp("date").notNull(),
  tfrRepName: text("tfr_rep_name").notNull(),
  clientRepName: text("client_rep_name"),
  weather: text("weather"),
  descriptionOfWork: text("description_of_work").notNull(),
  crewSize: integer("crew_size"),
  laborSummaryJson: text("labor_summary_json"),
  equipmentUsedJson: text("equipment_used_json"),
  materialsUsedJson: text("materials_used_json"),
  attachmentsJson: text("attachments_json"),
  clientSignatureName: text("client_signature_name"),
  clientSignatureDate: timestamp("client_signature_date"),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Receipts table
export const receipts = pgTable("receipts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id),
  date: timestamp("date").notNull(),
  vendor: text("vendor").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  category: text("category"),
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url").notNull(),
  objectKey: text("object_key"),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Project Notes table
export const projectNotes = pgTable("project_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  authorId: varchar("author_id").notNull().references(() => users.id),
  noteType: noteTypeEnum("note_type").notNull().default("GENERAL"),
  text: text("text").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Scope of Work Items table
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

// Media table (photos and videos)
export const media = pgTable("media", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  type: mediaTypeEnum("type").notNull(),
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url").notNull(),
  objectKey: text("object_key"),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  caption: text("caption"),
  uploadedById: varchar("uploaded_by_id").notNull().references(() => users.id),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
});

// Change Orders table
export const changeOrders = pgTable("change_orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  changeOrderNumber: text("change_order_number").notNull(),
  description: text("description").notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  status: changeOrderStatusEnum("status").notNull().default("DRAFT"),
  requestedById: varchar("requested_by_id").notNull().references(() => users.id),
  approvedById: varchar("approved_by_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  rejectionReason: text("rejection_reason"),
  attachmentsJson: text("attachments_json"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  statusIdx: index("change_orders_status_idx").on(table.status),
  projectIdIdx: index("change_orders_project_id_idx").on(table.projectId),
}));

// Calendar Events table
export const calendarEvents = pgTable("calendar_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  eventType: calendarEventTypeEnum("event_type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date"),
  allDay: boolean("all_day").notNull().default(false),
  userId: varchar("user_id").references(() => users.id),
  projectId: varchar("project_id").references(() => projects.id),
  approvedById: varchar("approved_by_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Notifications table
export const notifications = pgTable("notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  type: notificationTypeEnum("type").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  isRead: boolean("is_read").notNull().default(false),
  relatedEntityId: varchar("related_entity_id"),
  relatedEntityType: text("related_entity_type"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// File Permissions table
export const filePermissions = pgTable("file_permissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  fileId: varchar("file_id").notNull(),
  fileType: fileTypeEnum("file_type").notNull(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  grantedById: varchar("granted_by_id").notNull().references(() => users.id),
  grantedAt: timestamp("granted_at").notNull().defaultNow(),
});

// Audit Log table
export const auditLog = pgTable("audit_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  entityType: text("entity_type").notNull(),
  entityId: varchar("entity_id").notNull(),
  action: auditActionEnum("action").notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  entityTypeIdx: index("audit_log_entity_type_idx").on(table.entityType),
  entityIdIdx: index("audit_log_entity_id_idx").on(table.entityId),
  userIdIdx: index("audit_log_user_id_idx").on(table.userId),
  createdAtIdx: index("audit_log_created_at_idx").on(table.createdAt),
}));

// Billing Events table
export const billingEvents = pgTable("billing_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  scopeItemId: varchar("scope_item_id").notNull().references(() => scopeItems.id, { onDelete: "cascade" }),
  quantity: decimal("quantity", { precision: 12, scale: 2 }).notNull(),
  unitPrice: decimal("unit_price", { precision: 10, scale: 2 }).notNull(),
  totalAmount: decimal("total_amount", { precision: 12, scale: 2 }).notNull(),
  description: text("description"),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Time Clock Shifts table
export const timeClockShifts = pgTable("time_clock_shifts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "set null" }),
  clockIn: timestamp("clock_in").notNull(),
  clockOut: timestamp("clock_out"),
  clockInLatitude: doublePrecision("clock_in_latitude"),
  clockInLongitude: doublePrecision("clock_in_longitude"),
  clockOutLatitude: doublePrecision("clock_out_latitude"),
  clockOutLongitude: doublePrecision("clock_out_longitude"),
  notes: text("notes"),
  autoClockOut: boolean("auto_clock_out").notNull().default(false),
  approvalStatus: shiftApprovalStatusEnum("approval_status").notNull().default("PENDING"),
  approvedById: varchar("approved_by_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  totalHours: decimal("total_hours", { precision: 6, scale: 2 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index("time_clock_shifts_user_id_idx").on(table.userId),
  clockInIdx: index("time_clock_shifts_clock_in_idx").on(table.clockIn),
  approvalStatusIdx: index("time_clock_shifts_approval_status_idx").on(table.approvalStatus),
}));

// Time Clock Events table
export const timeClockEvents = pgTable("time_clock_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  shiftId: varchar("shift_id").notNull().references(() => timeClockShifts.id, { onDelete: "cascade" }),
  eventType: clockEventTypeEnum("event_type").notNull(),
  timestamp: timestamp("timestamp").notNull(),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  notes: text("notes"),
  performedById: varchar("performed_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// AI Settings table
export const aiSettings = pgTable("ai_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  dailyRunsEnabled: boolean("daily_runs_enabled").notNull().default(true),
  dailyRunTime: text("daily_run_time").notNull().default("06:00"),
  roleTasksEnabled: boolean("role_tasks_enabled").notNull().default(true),
  billingAlertsEnabled: boolean("billing_alerts_enabled").notNull().default(true),
  profitabilityWarningsEnabled: boolean("profitability_warnings_enabled").notNull().default(true),
  crewSchedulingEnabled: boolean("crew_scheduling_enabled").notNull().default(true),
  bidRemindersEnabled: boolean("bid_reminders_enabled").notNull().default(true),
  materialOrderingEnabled: boolean("material_ordering_enabled").notNull().default(true),
  modelName: text("model_name").notNull().default("gpt-4o"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// AI Runs table
export const aiRuns = pgTable("ai_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  runType: text("run_type").notNull().default("daily"),
  status: text("status").notNull().default("in_progress"),
  triggeredById: varchar("triggered_by_id").references(() => users.id),
  snapshotData: text("snapshot_data"),
  profitabilityData: text("profitability_data"),
  aiResponse: text("ai_response"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
}, (table) => ({
  createdAtIdx: index("ai_runs_created_at_idx").on(table.createdAt),
}));

// AI Tasks table (role-based prioritized tasks)
export const aiTaskStatusEnum = pgEnum("ai_task_status", ["PENDING", "IN_PROGRESS", "COMPLETED", "DISMISSED"]);
export const aiTaskPriorityEnum = pgEnum("ai_task_priority", ["CRITICAL", "HIGH", "MEDIUM", "LOW"]);

export const aiTasks = pgTable("ai_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  runId: varchar("run_id").notNull().references(() => aiRuns.id, { onDelete: "cascade" }),
  taskType: text("task_type").notNull(),
  role: userRoleEnum("role").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  priority: aiTaskPriorityEnum("priority").notNull().default("MEDIUM"),
  status: aiTaskStatusEnum("status").notNull().default("PENDING"),
  dueDate: timestamp("due_date"),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "cascade" }),
  projectCode: text("project_code"),
  metadata: text("metadata"),
  assignedToId: varchar("assigned_to_id").references(() => users.id, { onDelete: "set null" }),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  roleIdx: index("ai_tasks_role_idx").on(table.role),
  statusIdx: index("ai_tasks_status_idx").on(table.status),
  priorityIdx: index("ai_tasks_priority_idx").on(table.priority),
}));

// Insert and Select Schemas
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  tokenVersion: true,
  createdAt: true,
  updatedAt: true,
});

export const insertProjectSchema = createInsertSchema(projects).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertBidSchema = createInsertSchema(bids).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertBidSubcontractorQuoteSchema = createInsertSchema(bidSubcontractorQuotes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertEstimateSchema = createInsertSchema(estimates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertProcurementItemSchema = createInsertSchema(procurementItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPlanDocumentSchema = createInsertSchema(planDocuments).omit({
  id: true,
  uploadedAt: true,
});

export const insertTimeEntrySchema = createInsertSchema(timeEntries).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  approvedAt: true,
});

export const insertTMDailySheetSchema = createInsertSchema(tmDailySheets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertReceiptSchema = createInsertSchema(receipts).omit({
  id: true,
  createdAt: true,
});

export const insertProjectNoteSchema = createInsertSchema(projectNotes).omit({
  id: true,
  createdAt: true,
});

export const insertScopeItemSchema = createInsertSchema(scopeItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertMediaSchema = createInsertSchema(media).omit({
  id: true,
  uploadedAt: true,
});

export const insertFilePermissionSchema = createInsertSchema(filePermissions).omit({
  id: true,
  grantedAt: true,
});

// Type exports
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type SelectUser = Omit<User, 'passwordHash'>;

export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projects.$inferSelect;

export type InsertBid = z.infer<typeof insertBidSchema>;
export type Bid = typeof bids.$inferSelect;

export type InsertBidSubcontractorQuote = z.infer<typeof insertBidSubcontractorQuoteSchema>;
export type BidSubcontractorQuote = typeof bidSubcontractorQuotes.$inferSelect;

export type InsertEstimate = z.infer<typeof insertEstimateSchema>;
export type Estimate = typeof estimates.$inferSelect;

export type InsertProcurementItem = z.infer<typeof insertProcurementItemSchema>;
export type ProcurementItem = typeof procurementItems.$inferSelect;

export type InsertPlanDocument = z.infer<typeof insertPlanDocumentSchema>;
export type PlanDocument = typeof planDocuments.$inferSelect;

export type InsertTimeEntry = z.infer<typeof insertTimeEntrySchema>;
export type TimeEntry = typeof timeEntries.$inferSelect;

export type InsertTMDailySheet = z.infer<typeof insertTMDailySheetSchema>;
export type TMDailySheet = typeof tmDailySheets.$inferSelect;

export type InsertReceipt = z.infer<typeof insertReceiptSchema>;
export type Receipt = typeof receipts.$inferSelect;

export type InsertProjectNote = z.infer<typeof insertProjectNoteSchema>;
export type ProjectNote = typeof projectNotes.$inferSelect;

export type InsertScopeItem = z.infer<typeof insertScopeItemSchema>;
export type ScopeItem = typeof scopeItems.$inferSelect;

export type InsertMedia = z.infer<typeof insertMediaSchema>;
export type Media = typeof media.$inferSelect;

export const insertChangeOrderSchema = createInsertSchema(changeOrders).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  approvedAt: true,
});

export const insertCalendarEventSchema = createInsertSchema(calendarEvents).omit({
  id: true,
  createdAt: true,
  approvedAt: true,
});

export const insertNotificationSchema = createInsertSchema(notifications).omit({
  id: true,
  createdAt: true,
});

export type InsertChangeOrder = z.infer<typeof insertChangeOrderSchema>;
export type ChangeOrder = typeof changeOrders.$inferSelect;

export type InsertCalendarEvent = z.infer<typeof insertCalendarEventSchema>;
export type CalendarEvent = typeof calendarEvents.$inferSelect;

export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notifications.$inferSelect;

export type InsertFilePermission = z.infer<typeof insertFilePermissionSchema>;
export type FilePermission = typeof filePermissions.$inferSelect;

export const insertAuditLogSchema = createInsertSchema(auditLog).omit({
  id: true,
  createdAt: true,
});

export const insertBillingEventSchema = createInsertSchema(billingEvents).omit({
  id: true,
  createdAt: true,
});

export const insertTimeClockShiftSchema = createInsertSchema(timeClockShifts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  approvedAt: true,
});

export const insertTimeClockEventSchema = createInsertSchema(timeClockEvents).omit({
  id: true,
  createdAt: true,
});

export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLog.$inferSelect;

export type InsertBillingEvent = z.infer<typeof insertBillingEventSchema>;
export type BillingEvent = typeof billingEvents.$inferSelect;

export type InsertTimeClockShift = z.infer<typeof insertTimeClockShiftSchema>;
export type TimeClockShift = typeof timeClockShifts.$inferSelect;

export type InsertTimeClockEvent = z.infer<typeof insertTimeClockEventSchema>;
export type TimeClockEvent = typeof timeClockEvents.$inferSelect;

export const insertAISettingsSchema = createInsertSchema(aiSettings).omit({
  id: true,
  updatedAt: true,
});

export const insertAIRunSchema = createInsertSchema(aiRuns).omit({
  id: true,
  createdAt: true,
  completedAt: true,
});

export const insertAITaskSchema = createInsertSchema(aiTasks).omit({
  id: true,
  createdAt: true,
  completedAt: true,
});

export type InsertAISettings = z.infer<typeof insertAISettingsSchema>;
export type AISettings = typeof aiSettings.$inferSelect;

export type InsertAIRun = z.infer<typeof insertAIRunSchema>;
export type AIRun = typeof aiRuns.$inferSelect;

export type InsertAITask = z.infer<typeof insertAITaskSchema>;
export type AITask = typeof aiTasks.$inferSelect;

// Crews table
export const crews = pgTable("crews", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  leadId: varchar("lead_id").references(() => users.id),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertCrewSchema = createInsertSchema(crews).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCrew = z.infer<typeof insertCrewSchema>;
export type Crew = typeof crews.$inferSelect;

// Crew Members table
export const crewMembers = pgTable("crew_members", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  crewId: varchar("crew_id").notNull().references(() => crews.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role"),
  addedAt: timestamp("added_at").notNull().defaultNow(),
});

export const insertCrewMemberSchema = createInsertSchema(crewMembers).omit({ id: true, addedAt: true });
export type InsertCrewMember = z.infer<typeof insertCrewMemberSchema>;
export type CrewMember = typeof crewMembers.$inferSelect;

// Skills table
export const skills = pgTable("skills", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  category: text("category"),
  description: text("description"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertSkillSchema = createInsertSchema(skills).omit({ id: true, createdAt: true });
export type InsertSkill = z.infer<typeof insertSkillSchema>;
export type Skill = typeof skills.$inferSelect;

// User Skills table (junction table)
export const userSkills = pgTable("user_skills", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  skillId: varchar("skill_id").notNull().references(() => skills.id, { onDelete: "cascade" }),
  proficiencyLevel: text("proficiency_level"),
  yearsExperience: integer("years_experience"),
  certifiedAt: timestamp("certified_at"),
  addedAt: timestamp("added_at").notNull().defaultNow(),
});

export const insertUserSkillSchema = createInsertSchema(userSkills).omit({ id: true, addedAt: true });
export type InsertUserSkill = z.infer<typeof insertUserSkillSchema>;
export type UserSkill = typeof userSkills.$inferSelect;

// Equipment table
export const equipment = pgTable("equipment", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  type: text("type").notNull(),
  serialNumber: text("serial_number"),
  status: text("status").notNull().default("AVAILABLE"),
  assignedToCrewId: varchar("assigned_to_crew_id").references(() => crews.id),
  assignedToProjectId: varchar("assigned_to_project_id").references(() => projects.id),
  purchaseDate: timestamp("purchase_date"),
  lastMaintenanceDate: timestamp("last_maintenance_date"),
  nextMaintenanceDate: timestamp("next_maintenance_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertEquipmentSchema = createInsertSchema(equipment).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEquipment = z.infer<typeof insertEquipmentSchema>;
export type Equipment = typeof equipment.$inferSelect;

// Crew Project Assignments table
export const crewProjectAssignments = pgTable("crew_project_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  crewId: varchar("crew_id").notNull().references(() => crews.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  assignedById: varchar("assigned_by_id").notNull().references(() => users.id),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertCrewProjectAssignmentSchema = createInsertSchema(crewProjectAssignments).omit({ id: true, createdAt: true });
export type InsertCrewProjectAssignment = z.infer<typeof insertCrewProjectAssignmentSchema>;
export type CrewProjectAssignment = typeof crewProjectAssignments.$inferSelect;

// AI Data Quality table
export const aiDataQuality = pgTable("ai_data_quality", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  overallScore: integer("overall_score").notNull(),
  financialDataScore: integer("financial_data_score").notNull(),
  laborDataScore: integer("labor_data_score").notNull(),
  materialDataScore: integer("material_data_score").notNull(),
  timelineDataScore: integer("timeline_data_score").notNull(),
  scopeDataScore: integer("scope_data_score").notNull(),
  missingFields: text("missing_fields").array(),
  recommendations: text("recommendations").array(),
  calculatedAt: timestamp("calculated_at").notNull().defaultNow(),
});

export const insertAIDataQualitySchema = createInsertSchema(aiDataQuality).omit({ id: true, calculatedAt: true });
export type InsertAIDataQuality = z.infer<typeof insertAIDataQualitySchema>;
export type AIDataQuality = typeof aiDataQuality.$inferSelect;

// Subcontractors table
export const subcontractors = pgTable("subcontractors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyName: text("company_name").notNull(),
  contactName: text("contact_name"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  specialties: text("specialties").array(),
  insuranceExpiration: timestamp("insurance_expiration"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertSubcontractorSchema = createInsertSchema(subcontractors).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSubcontractor = z.infer<typeof insertSubcontractorSchema>;
export type Subcontractor = typeof subcontractors.$inferSelect;

// Subcontractor Contracts table
export const subcontractorContracts = pgTable("subcontractor_contracts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  subcontractorId: varchar("subcontractor_id").notNull().references(() => subcontractors.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  contractNumber: text("contract_number").notNull(),
  scopeOfWork: text("scope_of_work").notNull(),
  contractAmount: decimal("contract_amount", { precision: 12, scale: 2 }).notNull(),
  startDate: timestamp("start_date"),
  completionDate: timestamp("completion_date"),
  status: text("status").notNull().default("PENDING"),
  paymentTerms: text("payment_terms"),
  retentionPercent: decimal("retention_percent", { precision: 5, scale: 2 }),
  notes: text("notes"),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertSubcontractorContractSchema = createInsertSchema(subcontractorContracts).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSubcontractorContract = z.infer<typeof insertSubcontractorContractSchema>;
export type SubcontractorContract = typeof subcontractorContracts.$inferSelect;

// Subcontractor Payments table
export const subcontractorPayments = pgTable("subcontractor_payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contractId: varchar("contract_id").notNull().references(() => subcontractorContracts.id, { onDelete: "cascade" }),
  paymentNumber: integer("payment_number").notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  retentionHeld: decimal("retention_held", { precision: 12, scale: 2 }),
  paymentDate: timestamp("payment_date"),
  description: text("description"),
  invoiceNumber: text("invoice_number"),
  status: text("status").notNull().default("PENDING"),
  approvedById: varchar("approved_by_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  paidById: varchar("paid_by_id").references(() => users.id),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertSubcontractorPaymentSchema = createInsertSchema(subcontractorPayments).omit({ id: true, createdAt: true });
export type InsertSubcontractorPayment = z.infer<typeof insertSubcontractorPaymentSchema>;
export type SubcontractorPayment = typeof subcontractorPayments.$inferSelect;

// Subcontractor Billing Schedule table
export const subcontractorBillingSchedule = pgTable("subcontractor_billing_schedule", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contractId: varchar("contract_id").notNull().references(() => subcontractorContracts.id, { onDelete: "cascade" }),
  milestoneNumber: integer("milestone_number").notNull(),
  description: text("description").notNull(),
  scheduledAmount: decimal("scheduled_amount", { precision: 12, scale: 2 }).notNull(),
  scheduledDate: timestamp("scheduled_date"),
  completionPercent: integer("completion_percent"),
  status: text("status").notNull().default("PENDING"),
  completedAt: timestamp("completed_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertSubcontractorBillingScheduleSchema = createInsertSchema(subcontractorBillingSchedule).omit({ id: true, createdAt: true });
export type InsertSubcontractorBillingSchedule = z.infer<typeof insertSubcontractorBillingScheduleSchema>;
export type SubcontractorBillingSchedule = typeof subcontractorBillingSchedule.$inferSelect;
```

---
---

# SECTION 3: SERVER ROUTES (3,176 LINES - ALL API ENDPOINTS)

---

## server/routes.ts

```typescript
import type { Express } from "express";
import { createServer, type Server } from "http";
import { db } from "./db";
import { users, insertUserSchema, type InsertUser, type SelectUser, auditLog, billingEvents, timeClockShifts } from "@shared/schema";
import { 
  projects, bids, estimates, procurementItems, planDocuments,
  timeEntries, tmDailySheets, receipts, projectNotes, scopeItems, media,
  changeOrders, calendarEvents, notifications, filePermissions,
  insertProjectSchema, insertBidSchema, insertEstimateSchema,
  insertProcurementItemSchema, insertPlanDocumentSchema, insertTimeEntrySchema,
  insertTMDailySheetSchema, insertReceiptSchema, insertProjectNoteSchema,
  insertScopeItemSchema, insertMediaSchema, insertChangeOrderSchema,
  insertCalendarEventSchema, insertNotificationSchema, insertFilePermissionSchema,
  crews, crewMembers, skills, userSkills, equipment,
  insertCrewSchema, insertCrewMemberSchema, insertSkillSchema, insertUserSkillSchema
} from "@shared/schema";
import { 
  authMiddleware, 
  requireAuth, 
  requireRole, 
  hashPassword, 
  verifyPassword, 
  generateToken, 
  setAuthCookie, 
  clearAuthCookie,
  revokeUserTokens,
  type AuthRequest 
} from "./auth";
import { eq, desc, sql, and, or, isNull } from "drizzle-orm";
import { z } from "zod";
import { authLimiter, sensitiveLimiter, apiLimiter } from "./rateLimiter";
import { logCreate, logUpdate, logDelete, logApprove, logReject } from "./auditLogger";
import { validateFileExists, validateMimeType, validateFileSize } from "./fileValidation";
import { registerTimeClockRoutes } from "./timeClockRoutes";
import changeOrderRoutes from "./changeOrderRoutes";
import aiRoutes from "./aiRoutes";

export async function registerRoutes(app: Express): Promise<Server> {
  // Apply auth middleware to all routes
  app.use(authMiddleware);

  // Apply general API rate limiter to all API routes BEFORE registering any routes
  app.use("/api", apiLimiter);

  // Register time-clock routes (now protected by rate limiter)
  registerTimeClockRoutes(app);

  // Register change order state machine routes
  app.use("/api/change-orders", changeOrderRoutes);

  // Register AI PM + CFO routes
  app.use("/api", aiRoutes);

  // ====================
  // Auth Routes
  // ====================

  // Login schema
  const loginSchema = z.object({
    email: z.string().email("Invalid email address"),
    password: z.string().min(1, "Password is required"),
  });

  // Registration schema
  const registerSchema = z.object({
    firstName: z.string().min(1, "First name is required"),
    lastName: z.string().min(1, "Last name is required"),
    email: z.string().email("Invalid email address"),
    phone: z.string().optional(),
    password: z.string().min(8, "Password must be at least 8 characters"),
  });

  // Register new user
  app.post("/api/auth/register", authLimiter, async (req: AuthRequest, res) => {
    try {
      const validationResult = registerSchema.safeParse(req.body);
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const { firstName, lastName, email, phone, password } = validationResult.data;

      // Check if user already exists
      const [existingUser] = await db.select().from(users).where(eq(users.email, email)).limit(1);

      if (existingUser) {
        res.status(400).json({ error: "User with this email already exists" });
        return;
      }

      // Create new user (inactive by default, awaiting admin approval)
      const passwordHash = await hashPassword(password);
      
      const [newUser] = await db.insert(users).values({
        firstName,
        lastName,
        email,
        phone,
        role: "HOURLY_EMPLOYEE", // Default role
        isActive: false, // Requires admin activation
        passwordHash,
      }).returning();

      const { passwordHash: _, ...userWithoutPassword } = newUser;
      res.status(201).json({
        user: userWithoutPassword,
        message: "Registration successful. Your account is pending admin approval."
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ error: "Registration failed" });
    }
  });

  // Login
  app.post("/api/auth/login", authLimiter, async (req: AuthRequest, res) => {
    try {
      const validationResult = loginSchema.safeParse(req.body);
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const { email, password } = validationResult.data;

      const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

      if (!user || !user.isActive) {
        res.status(401).json({ error: "Invalid credentials" });
        return;
      }

      const isValid = await verifyPassword(password, user.passwordHash);
      
      if (!isValid) {
        res.status(401).json({ error: "Invalid credentials" });
        return;
      }

      const token = generateToken(user.id, user.tokenVersion);
      setAuthCookie(res, token);

      const { passwordHash, tokenVersion, ...userWithoutPassword } = user;
      res.json({ user: userWithoutPassword });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ error: "Login failed" });
    }
  });

  // Logout
  app.post("/api/auth/logout", (req: AuthRequest, res) => {
    clearAuthCookie(res);
    res.json({ success: true });
  });

  // Get current user
  app.get("/api/auth/me", requireAuth, (req: AuthRequest, res) => {
    res.json({ user: req.user });
  });

  // Initialize admin user (one-time setup)
  app.post("/api/auth/init", async (req: AuthRequest, res) => {
    try {
      // Check if any users exist
      const existingUsers = await db.select().from(users).limit(1);
      
      if (existingUsers.length > 0) {
        res.status(400).json({ error: "System already initialized" });
        return;
      }

      // Create admin user
      const passwordHash = await hashPassword("admin123");
      
      const [adminUser] = await db.insert(users).values({
        firstName: "Admin",
        lastName: "User",
        email: "admin@tfrllc.com",
        role: "ADMIN",
        isActive: true,
        passwordHash,
      }).returning();

      const { passwordHash: _, ...userWithoutPassword } = adminUser;
      res.status(201).json({
        user: userWithoutPassword,
        message: "Admin user created. Email: admin@tfrllc.com, Password: admin123. Please change this password!"
      });
    } catch (error) {
      console.error("Init error:", error);
      res.status(500).json({ error: "Initialization failed" });
    }
  });

  // ====================
  // Dashboard Routes
  // ====================

  // Get dashboard statistics
  app.get("/api/dashboard/stats", requireAuth, sensitiveLimiter, async (req: AuthRequest, res) => {
    try {
      // Count active projects
      const activeProjectsResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(projects)
        .where(eq(projects.status, "ACTIVE"));
      const activeProjectsCount = activeProjectsResult[0]?.count || 0;

      // Count pending change orders
      const pendingChangeOrdersResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(changeOrders)
        .where(eq(changeOrders.status, "PENDING_APPROVAL"));
      const pendingChangeOrdersCount = pendingChangeOrdersResult[0]?.count || 0;

      // Count pending time-off requests
      // Use dual check for robustness: eventType = TIME_OFF_REQUEST AND approvedById IS NULL
      // This ensures we only count truly pending requests that haven't been processed
      const pendingTimeOffResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(calendarEvents)
        .where(sql`${calendarEvents.eventType} = 'TIME_OFF_REQUEST' AND ${calendarEvents.approvedById} IS NULL`);
      const pendingTimeOffCount = pendingTimeOffResult[0]?.count || 0;

      res.json({
        activeProjectsCount,
        pendingChangeOrdersCount,
        pendingTimeOffCount,
      });
    } catch (error) {
      console.error("Dashboard stats error:", error);
      res.status(500).json({ error: "Failed to fetch dashboard statistics" });
    }
  });

  // ====================
  // User Management Routes
  // ====================

  // Get all users (Admin/Manager only)
  app.get("/api/users", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const allUsers = await db.select().from(users);
      const usersWithoutPasswords = allUsers.map(({ passwordHash, ...user }) => user);
      res.json(usersWithoutPasswords);
    } catch (error) {
      console.error("Get users error:", error);
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  // Get user by ID (Admin/Manager only)
  app.get("/api/users/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const [user] = await db.select().from(users).where(eq(users.id, req.params.id)).limit(1);
      
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      const { passwordHash, ...userWithoutPassword } = user;
      res.json(userWithoutPassword);
    } catch (error) {
      console.error("Get user error:", error);
      res.status(500).json({ error: "Failed to fetch user" });
    }
  });

  // Create user schema (omit passwordHash, add password)
  const createUserSchema = insertUserSchema.omit({ passwordHash: true }).extend({
    password: z.string().min(8, "Password must be at least 8 characters"),
  });

  // Update user schema
  const updateUserSchema = insertUserSchema.omit({ passwordHash: true }).partial().extend({
    password: z.string().min(8, "Password must be at least 8 characters").optional(),
  });

  // Create user (Admin only)
  app.post("/api/users", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res) => {
    try {
      const validationResult = createUserSchema.safeParse(req.body);
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const { firstName, lastName, email, phone, role, password } = validationResult.data;

      const passwordHash = await hashPassword(password);

      const [newUser] = await db.insert(users).values({
        firstName,
        lastName,
        email,
        phone: phone || null,
        role: role || "HOURLY_EMPLOYEE",
        isActive: true,
        passwordHash,
      }).returning();

      const { passwordHash: _, ...userWithoutPassword } = newUser;
      res.status(201).json(userWithoutPassword);
    } catch (error: any) {
      console.error("Create user error:", error);
      if (error.code === '23505') { // Unique violation
        res.status(409).json({ error: "Email already exists" });
      } else {
        res.status(500).json({ error: "Failed to create user" });
      }
    }
  });

  // Update user (Admin only)
  app.patch("/api/users/:id", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res) => {
    try {
      const validationResult = updateUserSchema.safeParse(req.body);
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const { firstName, lastName, email, phone, role, isActive, password } = validationResult.data;
      
      const updateData: any = {};
      if (firstName !== undefined) updateData.firstName = firstName;
      if (lastName !== undefined) updateData.lastName = lastName;
      if (email !== undefined) updateData.email = email;
      if (phone !== undefined) updateData.phone = phone;
      if (role !== undefined) updateData.role = role;
      if (isActive !== undefined) updateData.isActive = isActive;
      if (password !== undefined) updateData.passwordHash = await hashPassword(password);
      
      updateData.updatedAt = new Date();

      const [updatedUser] = await db
        .update(users)
        .set(updateData)
        .where(eq(users.id, req.params.id))
        .returning();

      if (!updatedUser) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      const { passwordHash, tokenVersion, ...userWithoutPassword } = updatedUser;
      res.json(userWithoutPassword);
    } catch (error: any) {
      console.error("Update user error:", error);
      if (error.code === '23505') {
        res.status(409).json({ error: "Email already exists" });
      } else {
        res.status(500).json({ error: "Failed to update user" });
      }
    }
  });

  // Update user cost rates (Admin only)
  app.patch("/api/users/:id/cost-rates", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res) => {
    try {
      const { costRateRegular, costRateOvertime } = req.body;

      if (costRateRegular === undefined || costRateRegular === null || costRateRegular === "") {
        res.status(400).json({ error: "Regular cost rate is required" });
        return;
      }

      if (costRateOvertime === undefined || costRateOvertime === null || costRateOvertime === "") {
        res.status(400).json({ error: "Overtime cost rate is required" });
        return;
      }

      const regularRate = Number(costRateRegular);
      const overtimeRate = Number(costRateOvertime);

      if (isNaN(regularRate) || isNaN(overtimeRate) || regularRate < 0 || overtimeRate < 0) {
        res.status(400).json({ error: "Cost rates must be valid non-negative numbers" });
        return;
      }

      const [user] = await db.select().from(users).where(eq(users.id, req.params.id)).limit(1);
      
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      const [updated] = await db
        .update(users)
        .set({ 
          costRateRegular: regularRate.toFixed(2), 
          costRateOvertime: overtimeRate.toFixed(2),
          updatedAt: new Date() 
        })
        .where(eq(users.id, req.params.id))
        .returning();

      const { passwordHash, tokenVersion, ...userWithoutPassword } = updated;
      res.json(userWithoutPassword);
    } catch (error) {
      console.error("Update cost rates error:", error);
      res.status(500).json({ error: "Failed to update cost rates" });
    }
  });

  // Revoke all user tokens (logout all devices) - Admin only
  app.post("/api/users/:id/revoke-tokens", requireAuth, requireRole("ADMIN"), sensitiveLimiter, async (req: AuthRequest, res) => {
    try {
      const [user] = await db.select().from(users).where(eq(users.id, req.params.id)).limit(1);
      
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      await revokeUserTokens(req.params.id);

      // Audit log
      await logAudit({
        userId: req.user!.id,
        entityType: "USER",
        entityId: req.params.id,
        action: "REVOKE_TOKENS",
        oldValue: null,
        newValue: JSON.stringify({ revokedBy: req.user!.email }),
      }, req);

      res.json({ success: true, message: "All tokens revoked. User will need to log in again." });
    } catch (error) {
      console.error("Revoke tokens error:", error);
      res.status(500).json({ error: "Failed to revoke tokens" });
    }
  });

  // Change own password
  app.post("/api/auth/change-password", requireAuth, sensitiveLimiter, async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(8, "Password must be at least 8 characters"),
      });

      const data = schema.parse(req.body);

      const [user] = await db.select().from(users).where(eq(users.id, req.user!.id)).limit(1);
      
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      const isValid = await verifyPassword(data.currentPassword, user.passwordHash);
      
      if (!isValid) {
        res.status(401).json({ error: "Current password is incorrect" });
        return;
      }

      const newPasswordHash = await hashPassword(data.newPassword);

      await db
        .update(users)
        .set({ passwordHash: newPasswordHash, updatedAt: new Date() })
        .where(eq(users.id, req.user!.id));

      res.json({ success: true, message: "Password changed successfully" });
    } catch (error) {
      console.error("Change password error:", error);
      res.status(500).json({ error: "Failed to change password" });
    }
  });

  // ====================
  // Bid Routes
  // ====================

  const { bids, insertBidSchema, projects } = await import("@shared/schema");

  // Get all bids
  app.get("/api/bids", requireAuth, async (req: AuthRequest, res) => {
    try {
      const allBids = await db.select().from(bids).orderBy(bids.createdAt);
      res.json(allBids);
    } catch (error) {
      console.error("Get bids error:", error);
      res.status(500).json({ error: "Failed to fetch bids" });
    }
  });

  // Get bid by code
  app.get("/api/bids/:code", requireAuth, async (req: AuthRequest, res) => {
    try {
      const [bid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
      
      if (!bid) {
        res.status(404).json({ error: "Bid not found" });
        return;
      }

      res.json(bid);
    } catch (error) {
      console.error("Get bid error:", error);
      res.status(500).json({ error: "Failed to fetch bid" });
    }
  });

  // Create bid (Admin/Manager only)
  app.post("/api/bids", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const validationResult = insertBidSchema.safeParse(req.body);
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const [newBid] = await db.insert(bids).values(validationResult.data).returning();
      res.status(201).json(newBid);
    } catch (error: any) {
      console.error("Create bid error:", error);
      if (error.code === '23505') {
        res.status(409).json({ error: "Bid code already exists" });
      } else {
        res.status(500).json({ error: "Failed to create bid" });
      }
    }
  });

  // Update bid schema
  const updateBidSchema = insertBidSchema.partial();

  // Update bid (Admin/Manager only)
  app.patch("/api/bids/:code", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const validationResult = updateBidSchema.safeParse(req.body);
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const updateData: any = { ...validationResult.data, updatedAt: new Date() };
      
      const [updatedBid] = await db
        .update(bids)
        .set(updateData)
        .where(eq(bids.code, req.params.code))
        .returning();

      if (!updatedBid) {
        res.status(404).json({ error: "Bid not found" });
        return;
      }

      res.json(updatedBid);
    } catch (error: any) {
      console.error("Update bid error:", error);
      res.status(500).json({ error: "Failed to update bid" });
    }
  });

  // Delete bid (Admin only)
  app.delete("/api/bids/:code", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res) => {
    try {
      const [deletedBid] = await db
        .delete(bids)
        .where(eq(bids.code, req.params.code))
        .returning();

      if (!deletedBid) {
        res.status(404).json({ error: "Bid not found" });
        return;
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Delete bid error:", error);
      res.status(500).json({ error: "Failed to delete bid" });
    }
  });

  // Convert bid to project (Admin/Manager only)
  app.post("/api/bids/:code/convert", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const [bid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
      
      if (!bid) {
        res.status(404).json({ error: "Bid not found" });
        return;
      }

      // Create project from bid data
      const [newProject] = await db.insert(projects).values({
        name: bid.name,
        code: bid.code,
        clientName: bid.clientName,
        clientContactName: bid.clientContactName,
        clientContactEmail: bid.clientContactEmail,
        clientContactPhone: bid.clientContactPhone,
        status: "PLANNING",
        locationAddress: bid.locationAddress,
        city: bid.city,
        state: bid.state,
        description: bid.description,
        estimatorId: bid.estimatorId,
        contractAmount: bid.bidAmount,
        budget: bid.bidAmount,
      }).returning();

      // Delete the bid after converting
      await db.delete(bids).where(eq(bids.code, req.params.code));

      res.status(201).json(newProject);
    } catch (error: any) {
      console.error("Convert bid error:", error);
      if (error.code === '23505') {
        res.status(409).json({ error: "Project with this code already exists" });
      } else {
        res.status(500).json({ error: "Failed to convert bid" });
      }
    }
  });

  // ====================
  // Bid Subcontractor Quotes Routes
  // ====================

  const { bidSubcontractorQuotes, insertBidSubcontractorQuoteSchema } = await import("@shared/schema");

  // Get all quotes for a bid
  app.get("/api/bids/:code/quotes", requireAuth, async (req: AuthRequest, res) => {
    try {
      const [bid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
      if (!bid) {
        res.status(404).json({ error: "Bid not found" });
        return;
      }

      const quotes = await db
        .select()
        .from(bidSubcontractorQuotes)
        .where(eq(bidSubcontractorQuotes.bidId, bid.id))
        .orderBy(desc(bidSubcontractorQuotes.createdAt));

      res.json(quotes);
    } catch (error) {
      console.error("Get bid quotes error:", error);
      res.status(500).json({ error: "Failed to fetch bid quotes" });
    }
  });

  // Create a new quote for a bid
  app.post("/api/bids/:code/quotes", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      const [bid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
      if (!bid) {
        res.status(404).json({ error: "Bid not found" });
        return;
      }

      const validated = insertBidSubcontractorQuoteSchema.parse({
        ...req.body,
        bidId: bid.id,
      });

      const [newQuote] = await db.insert(bidSubcontractorQuotes).values(validated).returning();

      // Log audit
      await logAudit({
        userId: req.user!.id,
        action: "CREATE_BID_QUOTE",
        resourceType: "bid_quote",
        resourceId: newQuote.id,
        details: `Created quote from ${validated.subcontractorName} for bid ${bid.code}`,
      });

      res.status(201).json(newQuote);
    } catch (error: any) {
      console.error("Create bid quote error:", error);
      if (error.name === "ZodError") {
        res.status(400).json({ error: "Invalid quote data", details: error.errors });
      } else {
        res.status(500).json({ error: "Failed to create bid quote" });
      }
    }
  });

  // Update a bid quote
  app.patch("/api/bids/:code/quotes/:quoteId", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      const [bid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
      if (!bid) {
        res.status(404).json({ error: "Bid not found" });
        return;
      }

      const validated = insertBidSubcontractorQuoteSchema.partial().parse(req.body);

      const [updated] = await db
        .update(bidSubcontractorQuotes)
        .set({ ...validated, updatedAt: new Date() })
        .where(eq(bidSubcontractorQuotes.id, req.params.quoteId))
        .returning();

      if (!updated) {
        res.status(404).json({ error: "Quote not found" });
        return;
      }

      // Log audit
      await logAudit({
        userId: req.user!.id,
        action: "UPDATE_BID_QUOTE",
        resourceType: "bid_quote",
        resourceId: updated.id,
        details: `Updated quote from ${updated.subcontractorName} for bid ${bid.code}`,
      });

      res.json(updated);
    } catch (error: any) {
      console.error("Update bid quote error:", error);
      if (error.name === "ZodError") {
        res.status(400).json({ error: "Invalid quote data", details: error.errors });
      } else {
        res.status(500).json({ error: "Failed to update bid quote" });
      }
    }
  });

  // Delete a bid quote
  app.delete("/api/bids/:code/quotes/:quoteId", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const [bid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
      if (!bid) {
        res.status(404).json({ error: "Bid not found" });
        return;
      }

      const [deleted] = await db
        .delete(bidSubcontractorQuotes)
        .where(eq(bidSubcontractorQuotes.id, req.params.quoteId))
        .returning();

      if (!deleted) {
        res.status(404).json({ error: "Quote not found" });
        return;
      }

      // Log audit
      await logAudit({
        userId: req.user!.id,
        action: "DELETE_BID_QUOTE",
        resourceType: "bid_quote",
        resourceId: deleted.id,
        details: `Deleted quote from ${deleted.subcontractorName} for bid ${bid.code}`,
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Delete bid quote error:", error);
      res.status(500).json({ error: "Failed to delete bid quote" });
    }
  });

  // ====================
  // Project Routes
  // ====================

  const { insertProjectSchema, scopeItems, insertScopeItemSchema } = await import("@shared/schema");
  const { desc, inArray, sql } = await import("drizzle-orm");

  // Get all projects with pagination
  app.get("/api/projects", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { page = "1", limit = "50", status } = req.query;
      
      // Validate and sanitize pagination parameters
      const parsedPage = Number(page);
      const parsedLimit = Number(limit);

      let pageNum = Number.isInteger(parsedPage) && parsedPage >= 1 ? parsedPage : 1;
      let limitNum = Number.isInteger(parsedLimit) && parsedLimit >= 1 ? parsedLimit : 50;
      
      if (limitNum > 1000) {
        limitNum = 1000; // Max limit to prevent abuse
      }

      const offset = (pageNum - 1) * limitNum;

      // Build query with optional status filter
      let query = db.select().from(projects);
      if (status) {
        query = query.where(eq(projects.status, status as any)) as any;
      }

      // Get total count
      const totalResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(projects)
        .where(status ? eq(projects.status, status as any) : sql`true`);
      const totalCount = totalResult[0]?.count || 0;

      // Get paginated projects
      const allProjects = await query
        .orderBy(desc(projects.createdAt))
        .limit(limitNum)
        .offset(offset);
      
      // Get all unique user IDs
      const userIds = new Set<string>();
      allProjects.forEach(p => {
        if (p.estimatorId) userIds.add(p.estimatorId);
        if (p.superintendentId) userIds.add(p.superintendentId);
      });
      
      // Fetch all relevant users (only if there are any)
      let userMap = new Map<string, string>();
      if (userIds.size > 0) {
        const relevantUsers = await db.select().from(users).where(inArray(users.id, Array.from(userIds)));
        userMap = new Map(relevantUsers.map(u => [u.id, `${u.firstName} ${u.lastName}`]));
      }
      
      // Add estimator and superintendent names to projects
      const projectsWithNames = allProjects.map(project => ({
        ...project,
        estimator: project.estimatorId ? userMap.get(project.estimatorId) || undefined : undefined,
        superintendent: project.superintendentId ? userMap.get(project.superintendentId) || undefined : undefined,
      }));
        
      res.json({
        data: projectsWithNames,
        pagination: {
          page: pageNum,
          limit: limitNum,
          totalCount,
          totalPages: Math.ceil(totalCount / limitNum),
        },
      });
    } catch (error) {
      console.error("Get projects error:", error);
      res.status(500).json({ error: "Failed to fetch projects" });
    }
  });

  // Get project by code with scope items
  app.get("/api/projects/:code", requireAuth, async (req: AuthRequest, res) => {
    try {
      const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
      
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      // Get scope items for this project
      const projectScopeItems = await db
        .select()
        .from(scopeItems)
        .where(eq(scopeItems.projectId, project.id));

      res.json({ ...project, scopeItems: projectScopeItems });
    } catch (error) {
      console.error("Get project error:", error);
      res.status(500).json({ error: "Failed to fetch project" });
    }
  });

  // Create project (Admin/Manager only)
  app.post("/api/projects", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const validationResult = insertProjectSchema.safeParse(req.body);
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const [newProject] = await db.insert(projects).values(validationResult.data).returning();
      res.status(201).json(newProject);
    } catch (error: any) {
      console.error("Create project error:", error);
      if (error.code === '23505') {
        res.status(409).json({ error: "Project code already exists" });
      } else {
        res.status(500).json({ error: "Failed to create project" });
      }
    }
  });

  // Update project schema
  const updateProjectSchema = insertProjectSchema.partial();

  // Update project (Admin/Manager only)
  app.patch("/api/projects/:code", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const validationResult = updateProjectSchema.safeParse(req.body);
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const updateData: any = { ...validationResult.data, updatedAt: new Date() };
      
      const [updatedProject] = await db
        .update(projects)
        .set(updateData)
        .where(eq(projects.code, req.params.code))
        .returning();

      if (!updatedProject) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      res.json(updatedProject);
    } catch (error: any) {
      console.error("Update project error:", error);
      res.status(500).json({ error: "Failed to update project" });
    }
  });

  // Update project financials (Admin only)
  app.patch("/api/projects/:code/financials", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res) => {
    try {
      const { budget, contractAmount } = req.body;

      if (!budget || !contractAmount) {
        res.status(400).json({ error: "Budget and contract amount are required" });
        return;
      }

      const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
      
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      // Audit log the change
      await logAudit({
        entityType: "PROJECT",
        entityId: project.id,
        action: "UPDATE",
        performedById: req.user!.id,
        oldValues: {
          budget: project.budget,
          contractAmount: project.contractAmount,
        },
        newValues: {
          budget,
          contractAmount,
        },
        ipAddress: req.ip || "unknown",
        userAgent: req.get("user-agent") || "unknown",
      });

      const [updated] = await db
        .update(projects)
        .set({ 
          budget, 
          contractAmount,
          updatedAt: new Date() 
        })
        .where(eq(projects.code, req.params.code))
        .returning();

      res.json(updated);
    } catch (error) {
      console.error("Update project financials error:", error);
      res.status(500).json({ error: "Failed to update project financials" });
    }
  });

  // ====================
  // Scope of Work Routes
  // ====================

  // Get scope items for a project
  app.get("/api/projects/:code/scope", requireAuth, async (req: AuthRequest, res) => {
    try {
      const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
      
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      const items = await db.select().from(scopeItems).where(eq(scopeItems.projectId, project.id));
      res.json(items);
    } catch (error) {
      console.error("Get scope items error:", error);
      res.status(500).json({ error: "Failed to fetch scope items" });
    }
  });

  // Create scope item (Admin/Manager/Superintendent only)
  app.post("/api/projects/:code/scope", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
    try {
      const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
      
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      const validationResult = insertScopeItemSchema.extend({
        projectId: z.string().optional(),
      }).safeParse({ ...req.body, projectId: project.id });
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const [newScopeItem] = await db.insert(scopeItems).values(validationResult.data).returning();
      res.status(201).json(newScopeItem);
    } catch (error: any) {
      console.error("Create scope item error:", error);
      res.status(500).json({ error: "Failed to create scope item" });
    }
  });

  // Update scope item schema
  const updateScopeItemSchema = insertScopeItemSchema.omit({ projectId: true }).partial();

  // Update scope item (Admin/Manager/Superintendent only)
  app.patch("/api/scope-items/:id", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
    try {
      const validationResult = updateScopeItemSchema.safeParse(req.body);
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      // Get the old item to check if billing status is changing
      const [oldItem] = await db
        .select()
        .from(scopeItems)
        .where(eq(scopeItems.id, req.params.id));

      if (!oldItem) {
        res.status(404).json({ error: "Scope item not found" });
        return;
      }

      const updateData: any = { ...validationResult.data, updatedAt: new Date() };
      
      const [updatedItem] = await db
        .update(scopeItems)
        .set(updateData)
        .where(eq(scopeItems.id, req.params.id))
        .returning();

      if (!updatedItem) {
        res.status(404).json({ error: "Scope item not found" });
        return;
      }

      // Create notification for office administrators if billing status changed to READY_TO_BILL
      if (updatedItem.billingStatus === "READY_TO_BILL" && oldItem.billingStatus !== "READY_TO_BILL") {
        const admins = await db
          .select()
          .from(users)
          .where(eq(users.role, "ADMIN"));
        
        const notificationsToCreate = admins.map(admin => ({
          userId: admin.id,
          type: "BILLING_READY" as const,
          title: "Scope Item Ready to Bill",
          message: `Scope item "${updatedItem.description}" is ready for billing`,
          relatedEntityId: updatedItem.id,
          relatedEntityType: "scopeItem",
        }));

        if (notificationsToCreate.length > 0) {
          await db.insert(notifications).values(notificationsToCreate);
        }
      }

      res.json(updatedItem);
    } catch (error: any) {
      console.error("Update scope item error:", error);
      res.status(500).json({ error: "Failed to update scope item" });
    }
  });

  // Delete scope item (Admin/Manager only)
  app.delete("/api/scope-items/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const [deletedItem] = await db
        .delete(scopeItems)
        .where(eq(scopeItems.id, req.params.id))
        .returning();

      if (!deletedItem) {
        res.status(404).json({ error: "Scope item not found" });
        return;
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Delete scope item error:", error);
      res.status(500).json({ error: "Failed to delete scope item" });
    }
  });

  // ====================
  // Project Notes Routes
  // ====================

  const { projectNotes, insertProjectNoteSchema, media, insertMediaSchema } = await import("@shared/schema");

  // Get notes for a project
  app.get("/api/projects/:code/notes", requireAuth, async (req: AuthRequest, res) => {
    try {
      const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
      
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      const notes = await db
        .select()
        .from(projectNotes)
        .where(eq(projectNotes.projectId, project.id))
        .orderBy(desc(projectNotes.createdAt));

      res.json(notes);
    } catch (error) {
      console.error("Get notes error:", error);
      res.status(500).json({ error: "Failed to fetch notes" });
    }
  });

  // Create note (All authenticated users)
  app.post("/api/projects/:code/notes", requireAuth, async (req: AuthRequest, res) => {
    try {
      const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
      
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      const validationResult = insertProjectNoteSchema.extend({
        projectId: z.string().optional(),
        authorId: z.string().optional(),
      }).safeParse({
        ...req.body,
        projectId: project.id,
        authorId: req.user!.id,
      });
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const [newNote] = await db.insert(projectNotes).values(validationResult.data).returning();
      res.status(201).json(newNote);
    } catch (error: any) {
      console.error("Create note error:", error);
      res.status(500).json({ error: "Failed to create note" });
    }
  });

  // ====================
  // Media Routes
  // ====================

  // Get media for a project
  app.get("/api/projects/:code/media", requireAuth, async (req: AuthRequest, res) => {
    try {
      const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
      
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      // Get all media for this project
      const allMedia = await db
        .select()
        .from(media)
        .where(eq(media.projectId, project.id))
        .orderBy(desc(media.uploadedAt));

      // Filter by permissions
      const { filterFilesByPermissions } = await import("./fileAccessHelpers");
      const projectMedia = await filterFilesByPermissions(
        allMedia,
        req.user!.id,
        req.user!.role,
        "MEDIA"
      );

      res.json(projectMedia);
    } catch (error) {
      console.error("Get media error:", error);
      res.status(500).json({ error: "Failed to fetch media" });
    }
  });

  // Create media (All authenticated users)
  // Note: This endpoint expects fileUrl to already be uploaded to object storage
  app.post("/api/projects/:code/media", requireAuth, async (req: AuthRequest, res) => {
    try {
      const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
      
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      const validationResult = insertMediaSchema.extend({
        projectId: z.string().optional(),
        uploadedById: z.string().optional(),
      }).safeParse({
        ...req.body,
        projectId: project.id,
        uploadedById: req.user!.id,
      });
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const { ObjectStorageService } = await import("./objectStorage");
      const objectStorageService = new ObjectStorageService();
      
      const objectKey = await objectStorageService.trySetObjectEntityAclPolicy(
        validationResult.data.fileUrl,
        {
          owner: req.user!.id,
          visibility: "private",
        }
      );

      const [newMedia] = await db.insert(media).values({
        ...validationResult.data,
        objectKey,
      }).returning();
      
      // Grant permission to uploader
      await db.insert(filePermissions).values({
        fileId: newMedia.id,
        fileType: "MEDIA",
        userId: req.user!.id,
        grantedById: req.user!.id,
      });

      res.status(201).json(newMedia);
    } catch (error: any) {
      console.error("Create media error:", error);
      res.status(500).json({ error: "Failed to create media" });
    }
  });

  // Delete media (Admin/Manager/Superintendent or uploader)
  app.delete("/api/media/:id", requireAuth, async (req: AuthRequest, res) => {
    try {
      const [mediaItem] = await db.select().from(media).where(eq(media.id, req.params.id)).limit(1);

      if (!mediaItem) {
        res.status(404).json({ error: "Media not found" });
        return;
      }

      // Check if user has permission
      const canDelete = req.user!.role === "ADMIN" || 
                       req.user!.role === "MANAGER" || 
                       req.user!.role === "SUPERINTENDENT" ||
                       mediaItem.uploadedById === req.user!.id;

      if (!canDelete) {
        res.status(403).json({ error: "Insufficient permissions" });
        return;
      }

      await db.delete(media).where(eq(media.id, req.params.id));
      res.json({ success: true });
    } catch (error) {
      console.error("Delete media error:", error);
      res.status(500).json({ error: "Failed to delete media" });
    }
  });

  // ====================
  // Time Entry Routes
  // ====================

  const { timeEntries, insertTimeEntrySchema, tmDailySheets, insertTMDailySheetSchema } = await import("@shared/schema");

  // Get time entries with pagination (filtered by role)
  app.get("/api/time-entries", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { page = "1", limit = "50", status, userId, projectId } = req.query;
      
      // Validate and sanitize pagination parameters
      const parsedPage = Number(page);
      const parsedLimit = Number(limit);

      let pageNum = Number.isInteger(parsedPage) && parsedPage >= 1 ? parsedPage : 1;
      let limitNum = Number.isInteger(parsedLimit) && parsedLimit >= 1 ? parsedLimit : 50;
      
      if (limitNum > 1000) {
        limitNum = 1000; // Max limit to prevent abuse
      }

      const offset = (pageNum - 1) * limitNum;

      // Build base query conditions
      const conditions = [];
      
      if (req.user!.role === "HOURLY_EMPLOYEE") {
        // Hourly employees only see their own entries
        conditions.push(eq(timeEntries.userId, req.user!.id));
      } else if (userId) {
        // Managers/admins can filter by userId
        conditions.push(eq(timeEntries.userId, userId as string));
      }

      if (status) {
        conditions.push(eq(timeEntries.status, status as any));
      }

      if (projectId) {
        conditions.push(eq(timeEntries.projectId, projectId as string));
      }

      // Get total count
      const totalResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(timeEntries)
        .where(conditions.length > 0 ? and(...conditions) : sql`true`);
      const totalCount = totalResult[0]?.count || 0;

      // Get paginated entries
      let query = db.select().from(timeEntries);
      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as any;
      }

      const entries = await query
        .orderBy(desc(timeEntries.date))
        .limit(limitNum)
        .offset(offset);

      res.json({
        data: entries,
        pagination: {
          page: pageNum,
          limit: limitNum,
          totalCount,
          totalPages: Math.ceil(totalCount / limitNum),
        },
      });
    } catch (error) {
      console.error("Get time entries error:", error);
      res.status(500).json({ error: "Failed to fetch time entries" });
    }
  });

  // Get time entries for a project
  app.get("/api/projects/:code/time-entries", requireAuth, async (req: AuthRequest, res) => {
    try {
      const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
      
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      const entries = await db
        .select()
        .from(timeEntries)
        .where(eq(timeEntries.projectId, project.id))
        .orderBy(desc(timeEntries.date));

      res.json(entries);
    } catch (error) {
      console.error("Get project time entries error:", error);
      res.status(500).json({ error: "Failed to fetch time entries" });
    }
  });

  // Create time entry (All authenticated users)
  app.post("/api/time-entries", requireAuth, async (req: AuthRequest, res) => {
    try {
      const validationResult = insertTimeEntrySchema.extend({
        userId: z.string().optional(),
        date: z.coerce.date(),
      }).safeParse({
        ...req.body,
        userId: req.user!.id,
      });
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const [newEntry] = await db.insert(timeEntries).values(validationResult.data).returning();
      
      // Audit log
      await logCreate(req.user!.id, "TIME_ENTRY", newEntry.id, JSON.stringify(newEntry), req);
      
      res.status(201).json(newEntry);
    } catch (error: any) {
      console.error("Create time entry error:", error);
      res.status(500).json({ error: "Failed to create time entry" });
    }
  });

  // Update time entry (with locking)
  app.patch("/api/time-entries/:id", requireAuth, async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        date: z.coerce.date().optional(),
        hoursRegular: z.string().optional(),
        hoursOvertime: z.string().optional(),
        costCode: z.string().optional(),
        notes: z.string().optional(),
        adminOverride: z.boolean().optional(),
      });

      const data = schema.parse(req.body);

      // Get existing entry
      const [existingEntry] = await db
        .select()
        .from(timeEntries)
        .where(eq(timeEntries.id, req.params.id))
        .limit(1);

      if (!existingEntry) {
        res.status(404).json({ error: "Time entry not found" });
        return;
      }

      // Check locking: if approved (has approvedAt or approvedById), only ADMIN can modify with explicit override
      if (existingEntry.approvedAt || existingEntry.approvedById) {
        if (req.user!.role !== "ADMIN" || !data.adminOverride) {
          res.status(403).json({ 
            error: "This time entry has been approved and is locked. Only administrators can modify approved entries with explicit override." 
          });
          return;
        }
      }

      // Verify ownership (unless admin)
      if (req.user!.role !== "ADMIN" && req.user!.role !== "MANAGER" && existingEntry.userId !== req.user!.id) {
        res.status(403).json({ error: "You can only edit your own time entries" });
        return;
      }

      const updates: any = { updatedAt: new Date() };
      
      if (data.date) updates.date = data.date;
      if (data.hoursRegular !== undefined) updates.hoursRegular = data.hoursRegular;
      if (data.hoursOvertime !== undefined) updates.hoursOvertime = data.hoursOvertime;
      if (data.costCode !== undefined) updates.costCode = data.costCode;
      if (data.notes !== undefined) updates.notes = data.notes;

      const [updatedEntry] = await db
        .update(timeEntries)
        .set(updates)
        .where(eq(timeEntries.id, req.params.id))
        .returning();

      // Audit log
      await logUpdate(
        req.user!.id,
        "TIME_ENTRY",
        req.params.id,
        JSON.stringify(existingEntry),
        JSON.stringify({ ...updates, adminOverride: data.adminOverride }),
        req
      );

      res.json(updatedEntry);
    } catch (error) {
      console.error("Update time entry error:", error);
      res.status(500).json({ error: "Failed to update time entry" });
    }
  });

  // Delete time entry (with locking)
  app.delete("/api/time-entries/:id", requireAuth, async (req: AuthRequest, res) => {
    try {
      // Get existing entry
      const [existingEntry] = await db
        .select()
        .from(timeEntries)
        .where(eq(timeEntries.id, req.params.id))
        .limit(1);

      if (!existingEntry) {
        res.status(404).json({ error: "Time entry not found" });
        return;
      }

      // Check locking: if approved (has approvedAt or approvedById), only ADMIN can delete
      if ((existingEntry.approvedAt || existingEntry.approvedById) && req.user!.role !== "ADMIN") {
        res.status(403).json({ 
          error: "This time entry has been approved and is locked. Only administrators can delete approved entries." 
        });
        return;
      }

      // Verify ownership (unless admin/manager)
      if (req.user!.role !== "ADMIN" && req.user!.role !== "MANAGER" && existingEntry.userId !== req.user!.id) {
        res.status(403).json({ error: "You can only delete your own time entries" });
        return;
      }

      await db.delete(timeEntries).where(eq(timeEntries.id, req.params.id));

      // Audit log
      await logDelete(req.user!.id, "TIME_ENTRY", req.params.id, JSON.stringify(existingEntry), req);

      res.status(204).send();
    } catch (error) {
      console.error("Delete time entry error:", error);
      res.status(500).json({ error: "Failed to delete time entry" });
    }
  });

  // Approve time entry (Admin/Manager only)
  app.post("/api/time-entries/:id/approve", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const [existingEntry] = await db
        .select()
        .from(timeEntries)
        .where(eq(timeEntries.id, req.params.id))
        .limit(1);

      if (!existingEntry) {
        res.status(404).json({ error: "Time entry not found" });
        return;
      }

      const [updatedEntry] = await db
        .update(timeEntries)
        .set({
          approvedById: req.user!.id,
          approvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(timeEntries.id, req.params.id))
        .returning();

      // Audit log
      await logApprove(req.user!.id, "TIME_ENTRY", req.params.id, JSON.stringify({ approver: req.user!.email }), req);

      res.json(updatedEntry);
    } catch (error) {
      console.error("Approve time entry error:", error);
      res.status(500).json({ error: "Failed to approve time entry" });
    }
  });

  // ====================
  // T&M Daily Sheet Routes
  // ====================

  // Get T&M sheets for a project
  app.get("/api/projects/:code/tm-sheets", requireAuth, async (req: AuthRequest, res) => {
    try {
      const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
      
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      const sheets = await db
        .select()
        .from(tmDailySheets)
        .where(eq(tmDailySheets.projectId, project.id))
        .orderBy(desc(tmDailySheets.date));

      res.json(sheets);
    } catch (error) {
      console.error("Get T&M sheets error:", error);
      res.status(500).json({ error: "Failed to fetch T&M sheets" });
    }
  });

  // Create T&M daily sheet (Admin/Manager/Superintendent only)
  app.post("/api/tm-sheets", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
    try {
      const validationResult = insertTMDailySheetSchema.extend({
        createdById: z.string().optional(),
        date: z.coerce.date(),
      }).safeParse({
        ...req.body,
        createdById: req.user!.id,
      });
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const [newSheet] = await db.insert(tmDailySheets).values(validationResult.data).returning();
      res.status(201).json(newSheet);
    } catch (error: any) {
      console.error("Create T&M sheet error:", error);
      res.status(500).json({ error: "Failed to create T&M sheet" });
    }
  });

  // ====================
  // Estimates Routes
  // ====================

  const { estimates, insertEstimateSchema, procurementItems, insertProcurementItemSchema, receipts, insertReceiptSchema, planDocuments, insertPlanDocumentSchema } = await import("@shared/schema");

  // Get estimates for a project
  app.get("/api/projects/:code/estimates", requireAuth, async (req: AuthRequest, res) => {
    try {
      const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
      
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      const projectEstimates = await db
        .select()
        .from(estimates)
        .where(eq(estimates.projectId, project.id))
        .orderBy(desc(estimates.versionNumber));

      res.json(projectEstimates);
    } catch (error) {
      console.error("Get estimates error:", error);
      res.status(500).json({ error: "Failed to fetch estimates" });
    }
  });

  // Create estimate (Admin/Manager only)
  app.post("/api/estimates", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const validationResult = insertEstimateSchema.extend({
        createdById: z.string().optional(),
      }).safeParse({
        ...req.body,
        createdById: req.user!.id,
      });
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const [newEstimate] = await db.insert(estimates).values(validationResult.data).returning();
      res.status(201).json(newEstimate);
    } catch (error: any) {
      console.error("Create estimate error:", error);
      res.status(500).json({ error: "Failed to create estimate" });
    }
  });

  // ====================
  // Procurement Routes
  // ====================

  // Get procurement items for a project
  app.get("/api/projects/:code/procurement", requireAuth, async (req: AuthRequest, res) => {
    try {
      const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
      
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      const items = await db
        .select()
        .from(procurementItems)
        .where(eq(procurementItems.projectId, project.id));

      res.json(items);
    } catch (error) {
      console.error("Get procurement items error:", error);
      res.status(500).json({ error: "Failed to fetch procurement items" });
    }
  });

  // Create procurement item (Admin/Manager only)
  app.post("/api/procurement", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const validationResult = insertProcurementItemSchema.safeParse(req.body);
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const [newItem] = await db.insert(procurementItems).values(validationResult.data).returning();
      res.status(201).json(newItem);
    } catch (error: any) {
      console.error("Create procurement item error:", error);
      res.status(500).json({ error: "Failed to create procurement item" });
    }
  });

  // Update procurement item schema
  const updateProcurementSchema = insertProcurementItemSchema.omit({ projectId: true }).partial();

  // Update procurement item status (Admin/Manager only)
  app.patch("/api/procurement/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const validationResult = updateProcurementSchema.safeParse(req.body);
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const updateData: any = { ...validationResult.data, updatedAt: new Date() };
      
      const [updatedItem] = await db
        .update(procurementItems)
        .set(updateData)
        .where(eq(procurementItems.id, req.params.id))
        .returning();

      if (!updatedItem) {
        res.status(404).json({ error: "Procurement item not found" });
        return;
      }

      res.json(updatedItem);
    } catch (error: any) {
      console.error("Update procurement item error:", error);
      res.status(500).json({ error: "Failed to update procurement item" });
    }
  });

  // ====================
  // Receipts Routes
  // ====================

  // Get receipts for a project
  app.get("/api/projects/:code/receipts", requireAuth, async (req: AuthRequest, res) => {
    try {
      const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
      
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      // Get all receipts for this project
      const allReceipts = await db
        .select()
        .from(receipts)
        .where(eq(receipts.projectId, project.id))
        .orderBy(desc(receipts.date));

      // Filter by permissions
      const { filterFilesByPermissions } = await import("./fileAccessHelpers");
      const projectReceipts = await filterFilesByPermissions(
        allReceipts,
        req.user!.id,
        req.user!.role,
        "RECEIPT"
      );

      res.json(projectReceipts);
    } catch (error) {
      console.error("Get receipts error:", error);
      res.status(500).json({ error: "Failed to fetch receipts" });
    }
  });

  // Create receipt (All authenticated users)
  app.post("/api/receipts", requireAuth, async (req: AuthRequest, res) => {
    try {
      const validationResult = insertReceiptSchema.extend({
        userId: z.string().optional(),
      }).safeParse({
        ...req.body,
        userId: req.user!.id,
      });
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const { ObjectStorageService } = await import("./objectStorage");
      const objectStorageService = new ObjectStorageService();
      
      const objectKey = await objectStorageService.trySetObjectEntityAclPolicy(
        validationResult.data.fileUrl,
        {
          owner: req.user!.id,
          visibility: "private",
        }
      );

      const [newReceipt] = await db.insert(receipts).values({
        ...validationResult.data,
        objectKey,
      }).returning();
      
      // Grant permission to uploader
      await db.insert(filePermissions).values({
        fileId: newReceipt.id,
        fileType: "RECEIPT",
        userId: req.user!.id,
        grantedById: req.user!.id,
      });

      res.status(201).json(newReceipt);
    } catch (error: any) {
      console.error("Create receipt error:", error);
      res.status(500).json({ error: "Failed to create receipt" });
    }
  });

  // ====================
  // Plan Documents Routes
  // ====================

  // Get plan documents for a project
  app.get("/api/projects/:code/documents", requireAuth, async (req: AuthRequest, res) => {
    try {
      const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
      
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      // Get all documents for this project
      const allDocs = await db
        .select()
        .from(planDocuments)
        .where(eq(planDocuments.projectId, project.id))
        .orderBy(desc(planDocuments.uploadedAt));

      // Filter by permissions
      const { filterFilesByPermissions } = await import("./fileAccessHelpers");
      const docs = await filterFilesByPermissions(
        allDocs,
        req.user!.id,
        req.user!.role,
        "DOCUMENT"
      );

      res.json(docs);
    } catch (error) {
      console.error("Get documents error:", error);
      res.status(500).json({ error: "Failed to fetch documents" });
    }
  });

  // Create plan document (Admin/Manager only)
  app.post("/api/documents", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const validationResult = insertPlanDocumentSchema.extend({
        uploadedById: z.string().optional(),
      }).safeParse({
        ...req.body,
        uploadedById: req.user!.id,
      });
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const { ObjectStorageService } = await import("./objectStorage");
      const objectStorageService = new ObjectStorageService();
      
      const objectKey = await objectStorageService.trySetObjectEntityAclPolicy(
        validationResult.data.fileUrl,
        {
          owner: req.user!.id,
          visibility: "private",
        }
      );

      const [newDoc] = await db.insert(planDocuments).values({
        ...validationResult.data,
        objectKey,
      }).returning();
      
      // Grant permission to uploader
      await db.insert(filePermissions).values({
        fileId: newDoc.id,
        fileType: "DOCUMENT",
        userId: req.user!.id,
        grantedById: req.user!.id,
      });

      res.status(201).json(newDoc);
    } catch (error: any) {
      console.error("Create document error:", error);
      res.status(500).json({ error: "Failed to create document" });
    }
  });

  // ====================
  // File Permissions Routes
  // ====================

  // Grant file access (Manager/Admin only)
  app.post("/api/file-permissions", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const validationResult = insertFilePermissionSchema.extend({
        grantedById: z.string().optional(),
      }).safeParse({
        ...req.body,
        grantedById: req.user!.id,
      });
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      // Check if permission already exists
      const [existing] = await db
        .select()
        .from(filePermissions)
        .where(
          and(
            eq(filePermissions.fileId, validationResult.data.fileId),
            eq(filePermissions.fileType, validationResult.data.fileType),
            eq(filePermissions.userId, validationResult.data.userId)
          )
        )
        .limit(1);

      if (existing) {
        res.status(400).json({ error: "Permission already exists" });
        return;
      }

      const [newPermission] = await db
        .insert(filePermissions)
        .values(validationResult.data)
        .returning();
      
      res.status(201).json(newPermission);
    } catch (error: any) {
      console.error("Grant file permission error:", error);
      res.status(500).json({ error: "Failed to grant file permission" });
    }
  });

  // Revoke file access (Manager/Admin only)
  app.delete("/api/file-permissions/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const [deleted] = await db
        .delete(filePermissions)
        .where(eq(filePermissions.id, req.params.id))
        .returning();

      if (!deleted) {
        res.status(404).json({ error: "Permission not found" });
        return;
      }

      res.json({ message: "Permission revoked successfully" });
    } catch (error) {
      console.error("Revoke file permission error:", error);
      res.status(500).json({ error: "Failed to revoke file permission" });
    }
  });

  // Get permissions for a specific file (Manager/Admin only)
  app.get("/api/file-permissions/:fileType/:fileId", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { fileType, fileId } = req.params;
      
      if (!["MEDIA", "DOCUMENT", "RECEIPT"].includes(fileType)) {
        res.status(400).json({ error: "Invalid file type" });
        return;
      }

      const permissions = await db
        .select({
          id: filePermissions.id,
          userId: filePermissions.userId,
          grantedById: filePermissions.grantedById,
          grantedAt: filePermissions.grantedAt,
          userFirstName: users.firstName,
          userLastName: users.lastName,
          userEmail: users.email,
        })
        .from(filePermissions)
        .leftJoin(users, eq(filePermissions.userId, users.id))
        .where(
          and(
            eq(filePermissions.fileId, fileId),
            eq(filePermissions.fileType, fileType as "MEDIA" | "DOCUMENT" | "RECEIPT")
          )
        );

      res.json(permissions);
    } catch (error) {
      console.error("Get file permissions error:", error);
      res.status(500).json({ error: "Failed to fetch file permissions" });
    }
  });

  // Get all files a user has access to (useful for superintendents/hourly employees)
  app.get("/api/users/:userId/file-permissions", requireAuth, async (req: AuthRequest, res) => {
    try {
      // Users can only view their own permissions unless they're admin/manager
      if (req.user!.id !== req.params.userId && 
          req.user!.role !== "ADMIN" && 
          req.user!.role !== "MANAGER") {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      const permissions = await db
        .select()
        .from(filePermissions)
        .where(eq(filePermissions.userId, req.params.userId))
        .orderBy(desc(filePermissions.grantedAt));

      res.json(permissions);
    } catch (error) {
      console.error("Get user file permissions error:", error);
      res.status(500).json({ error: "Failed to fetch user file permissions" });
    }
  });

  // ====================
  // Change Orders Routes
  // ====================

  // Get change orders for a project
  app.get("/api/projects/:code/change-orders", requireAuth, async (req: AuthRequest, res) => {
    try {
      const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
      
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      const orders = await db
        .select()
        .from(changeOrders)
        .where(eq(changeOrders.projectId, project.id))
        .orderBy(desc(changeOrders.createdAt));

      res.json(orders);
    } catch (error) {
      console.error("Get change orders error:", error);
      res.status(500).json({ error: "Failed to fetch change orders" });
    }
  });

  // Create change order (Admin/Manager/Superintendent)
  app.post("/api/change-orders", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
    try {
      const validationResult = insertChangeOrderSchema.extend({
        requestedById: z.string().optional(),
      }).safeParse({
        ...req.body,
        requestedById: req.user!.id,
      });
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const [newOrder] = await db.insert(changeOrders).values(validationResult.data).returning();
      
      // Create notification for managers/admins about pending change order
      const adminsAndManagers = await db
        .select()
        .from(users)
        .where(sql`${users.role} IN ('ADMIN', 'MANAGER')`);
      
      const notificationsToCreate = adminsAndManagers.map(user => ({
        userId: user.id,
        type: "CHANGE_ORDER_PENDING" as const,
        title: "New Change Order Pending",
        message: `Change order ${newOrder.changeOrderNumber} requires approval`,
        relatedEntityId: newOrder.id,
        relatedEntityType: "changeOrder",
      }));

      if (notificationsToCreate.length > 0) {
        await db.insert(notifications).values(notificationsToCreate);
      }

      res.status(201).json(newOrder);
    } catch (error: any) {
      console.error("Create change order error:", error);
      res.status(500).json({ error: "Failed to create change order" });
    }
  });

  // Update change order schema
  const updateChangeOrderSchema = insertChangeOrderSchema.omit({ requestedById: true }).partial();

  // Update change order (Admin/Manager only)
  app.patch("/api/change-orders/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const validationResult = updateChangeOrderSchema.safeParse(req.body);
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const updateData: any = { ...validationResult.data, updatedAt: new Date() };
      
      const [updatedOrder] = await db
        .update(changeOrders)
        .set(updateData)
        .where(eq(changeOrders.id, req.params.id))
        .returning();

      if (!updatedOrder) {
        res.status(404).json({ error: "Change order not found" });
        return;
      }

      res.json(updatedOrder);
    } catch (error: any) {
      console.error("Update change order error:", error);
      res.status(500).json({ error: "Failed to update change order" });
    }
  });

  // Approve/reject endpoints moved to changeOrderRoutes.ts for state machine logic

  // ====================
  // Calendar Events Routes
  // ====================

  // Get all calendar events
  app.get("/api/calendar/events", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { startDate, endDate, eventType } = req.query;
      
      let query = db.select().from(calendarEvents);
      
      const conditions = [];
      if (startDate) {
        conditions.push(sql`${calendarEvents.startDate} >= ${startDate as string}`);
      }
      if (endDate) {
        conditions.push(sql`${calendarEvents.endDate} <= ${endDate as string}`);
      }
      if (eventType) {
        conditions.push(eq(calendarEvents.eventType, eventType as any));
      }
      
      if (conditions.length > 0) {
        query = query.where(sql`${sql.join(conditions, sql` AND `)}`);
      }
      
      const events = await query.orderBy(calendarEvents.startDate);

      res.json(events);
    } catch (error) {
      console.error("Get calendar events error:", error);
      res.status(500).json({ error: "Failed to fetch calendar events" });
    }
  });

  // Get user's calendar events
  app.get("/api/calendar/my-events", requireAuth, async (req: AuthRequest, res) => {
    try {
      const events = await db
        .select()
        .from(calendarEvents)
        .where(eq(calendarEvents.userId, req.user!.id))
        .orderBy(calendarEvents.startDate);

      res.json(events);
    } catch (error) {
      console.error("Get user calendar events error:", error);
      res.status(500).json({ error: "Failed to fetch calendar events" });
    }
  });

  // Create calendar event (All authenticated users)
  app.post("/api/calendar/events", requireAuth, async (req: AuthRequest, res) => {
    try {
      const validationResult = insertCalendarEventSchema.extend({
        createdById: z.string().optional(),
        startDate: z.coerce.date(),
        endDate: z.coerce.date().optional(),
      }).safeParse({
        ...req.body,
        createdById: req.user!.id,
      });
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const [newEvent] = await db.insert(calendarEvents).values(validationResult.data).returning();
      
      // Create notification for managers if it's a time-off request
      if (newEvent.eventType === "TIME_OFF_REQUEST") {
        const adminsAndManagers = await db
          .select()
          .from(users)
          .where(sql`${users.role} IN ('ADMIN', 'MANAGER')`);
        
        const notificationsToCreate = adminsAndManagers.map(user => ({
          userId: user.id,
          type: "TIME_OFF_REQUEST" as const,
          title: "Time Off Request",
          message: `${req.user!.firstName} ${req.user!.lastName} requested time off: ${newEvent.title}`,
          relatedEntityId: newEvent.id,
          relatedEntityType: "calendarEvent",
        }));

        if (notificationsToCreate.length > 0) {
          await db.insert(notifications).values(notificationsToCreate);
        }
      }

      res.status(201).json(newEvent);
    } catch (error: any) {
      console.error("Create calendar event error:", error);
      res.status(500).json({ error: "Failed to create calendar event" });
    }
  });

  // Approve time-off request (Admin/Manager only)
  app.post("/api/calendar/events/:id/approve", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const [event] = await db
        .update(calendarEvents)
        .set({
          eventType: "TIME_OFF_APPROVED",
          approvedById: req.user!.id,
          approvedAt: new Date(),
        })
        .where(eq(calendarEvents.id, req.params.id))
        .returning();

      if (!event) {
        res.status(404).json({ error: "Calendar event not found" });
        return;
      }

      // Notify the requester
      if (event.userId) {
        await db.insert(notifications).values({
          userId: event.userId,
          type: "GENERAL",
          title: "Time Off Approved",
          message: `Your time off request has been approved: ${event.title}`,
          relatedEntityId: event.id,
          relatedEntityType: "calendarEvent",
        });
      }

      res.json(event);
    } catch (error: any) {
      console.error("Approve time-off error:", error);
      res.status(500).json({ error: "Failed to approve time-off request" });
    }
  });

  // Delete calendar event
  app.delete("/api/calendar/events/:id", requireAuth, async (req: AuthRequest, res) => {
    try {
      const [event] = await db
        .select()
        .from(calendarEvents)
        .where(eq(calendarEvents.id, req.params.id))
        .limit(1);

      if (!event) {
        res.status(404).json({ error: "Calendar event not found" });
        return;
      }

      // Only creator, assigned user, or Admin/Manager can delete
      if (event.createdById !== req.user!.id && 
          event.userId !== req.user!.id &&
          req.user!.role !== "ADMIN" && 
          req.user!.role !== "MANAGER") {
        res.status(403).json({ error: "Not authorized to delete this event" });
        return;
      }

      await db.delete(calendarEvents).where(eq(calendarEvents.id, req.params.id));
      res.status(204).send();
    } catch (error: any) {
      console.error("Delete calendar event error:", error);
      res.status(500).json({ error: "Failed to delete calendar event" });
    }
  });

  // ====================
  // Notifications Routes
  // ====================

  // Get user's notifications
  app.get("/api/notifications", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userNotifications = await db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, req.user!.id))
        .orderBy(desc(notifications.createdAt))
        .limit(50);

      res.json(userNotifications);
    } catch (error) {
      console.error("Get notifications error:", error);
      res.status(500).json({ error: "Failed to fetch notifications" });
    }
  });

  // Get unread notification count
  app.get("/api/notifications/unread-count", requireAuth, async (req: AuthRequest, res) => {
    try {
      const [result] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(notifications)
        .where(sql`${notifications.userId} = ${req.user!.id} AND ${notifications.isRead} = false`);

      res.json({ count: result.count });
    } catch (error) {
      console.error("Get unread count error:", error);
      res.status(500).json({ error: "Failed to fetch unread count" });
    }
  });

  // Mark notification as read
  app.patch("/api/notifications/:id/read", requireAuth, async (req: AuthRequest, res) => {
    try {
      const [notification] = await db
        .update(notifications)
        .set({ isRead: true })
        .where(sql`${notifications.id} = ${req.params.id} AND ${notifications.userId} = ${req.user!.id}`)
        .returning();

      if (!notification) {
        res.status(404).json({ error: "Notification not found" });
        return;
      }

      res.json(notification);
    } catch (error: any) {
      console.error("Mark notification read error:", error);
      res.status(500).json({ error: "Failed to mark notification as read" });
    }
  });

  // Mark all notifications as read
  app.post("/api/notifications/read-all", requireAuth, async (req: AuthRequest, res) => {
    try {
      await db
        .update(notifications)
        .set({ isRead: true })
        .where(eq(notifications.userId, req.user!.id));

      res.json({ success: true });
    } catch (error: any) {
      console.error("Mark all notifications read error:", error);
      res.status(500).json({ error: "Failed to mark all notifications as read" });
    }
  });

  // ====================
  // Billing Events Routes
  // ====================

  // Get billing events for a project
  app.get("/api/projects/:projectId/billing-events", requireAuth, requireRole("ADMIN", "MANAGER", "OFFICE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const events = await db
        .select()
        .from(billingEvents)
        .where(eq(billingEvents.projectId, req.params.projectId))
        .orderBy(desc(billingEvents.eventDate));

      res.json(events);
    } catch (error) {
      console.error("Get billing events error:", error);
      res.status(500).json({ error: "Failed to fetch billing events" });
    }
  });

  // Create billing event
  app.post("/api/billing-events", requireAuth, requireRole("ADMIN", "MANAGER", "OFFICE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        projectId: z.string(),
        eventType: z.enum(["INVOICE_SENT", "PAYMENT_RECEIVED", "CHANGE_ORDER_INVOICED", "RETENTION_RELEASED", "LIEN_WAIVER_RECEIVED"]),
        eventDate: z.coerce.date(),
        amount: z.string(),
        description: z.string().optional(),
        invoiceNumber: z.string().optional(),
        referenceId: z.string().optional(),
      });

      const data = schema.parse(req.body);

      const [newEvent] = await db.insert(billingEvents).values({
        ...data,
        createdById: req.user!.id,
      }).returning();

      // Audit log
      await logCreate(req.user!.id, "BILLING_EVENT", newEvent.id, JSON.stringify(newEvent), req);

      res.status(201).json(newEvent);
    } catch (error) {
      console.error("Create billing event error:", error);
      res.status(500).json({ error: "Failed to create billing event" });
    }
  });

  // ====================
  // Audit Log Routes
  // ====================

  // Get audit logs (Admin only)
  app.get("/api/audit-logs", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res) => {
    try {
      const { entityType, entityId, userId, action, page = "1", pageSize = "100" } = req.query;

      const pageNum = parseInt(page as string);
      const pageSizeNum = parseInt(pageSize as string);
      const offset = (pageNum - 1) * pageSizeNum;

      let query = db.select().from(auditLog);

      const conditions = [];
      if (entityType) conditions.push(eq(auditLog.entityType, entityType as string));
      if (entityId) conditions.push(eq(auditLog.entityId, entityId as string));
      if (userId) conditions.push(eq(auditLog.userId, userId as string));
      if (action) conditions.push(eq(auditLog.action, action as any));

      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as any;
      }

      const logs = await query
        .orderBy(desc(auditLog.timestamp))
        .limit(pageSizeNum)
        .offset(offset);

      res.json(logs);
    } catch (error) {
      console.error("Get audit logs error:", error);
      res.status(500).json({ error: "Failed to fetch audit logs" });
    }
  });

  // Get audit logs for specific entity (Admin/Manager)
  app.get("/api/audit-logs/:entityType/:entityId", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const logs = await db
        .select()
        .from(auditLog)
        .where(and(
          eq(auditLog.entityType, req.params.entityType),
          eq(auditLog.entityId, req.params.entityId)
        ))
        .orderBy(desc(auditLog.timestamp))
        .limit(100);

      res.json(logs);
    } catch (error) {
      console.error("Get entity audit logs error:", error);
      res.status(500).json({ error: "Failed to fetch audit logs" });
    }
  });

  // Object Storage endpoints
  const { ObjectStorageService, ObjectNotFoundError } = await import("./objectStorage");
  const { ObjectPermission } = await import("./objectAcl");

  // Get upload URL for object
  app.post("/api/objects/upload", requireAuth, async (req: AuthRequest, res) => {
    try {
      const objectStorageService = new ObjectStorageService();
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      res.json({ uploadURL });
    } catch (error: any) {
      console.error("Get upload URL error:", error);
      res.status(500).json({ error: "Failed to get upload URL" });
    }
  });

  // Download private object with ACL check
  app.get("/objects/:objectPath(*)", requireAuth, async (req: AuthRequest, res) => {
    try {
      const objectStorageService = new ObjectStorageService();
      const objectFile = await objectStorageService.getObjectEntityFile(req.path);
      
      // Get object metadata to extract objectKey
      const [metadata] = await objectFile.getMetadata();
      const objectKey = objectFile.name;

      // Resolve objectKey to fileId and fileType
      const { resolveObjectKeyToFile } = await import("./fileAccessHelpers");
      const resolvedFile = await resolveObjectKeyToFile(objectKey);

      // Block orphaned objects (files not tracked in database)
      if (!resolvedFile) {
        res.status(404).json({ error: "File not found in system" });
        return;
      }

      const canAccess = await objectStorageService.canAccessObjectEntity({
        objectFile,
        userId: req.user!.id,
        userRole: req.user!.role,
        requestedPermission: ObjectPermission.READ,
        fileId: resolvedFile.fileId,
        fileType: resolvedFile.fileType,
      });

      if (!canAccess) {
        res.status(403).json({ error: "Access denied" });
        return;
      }

      objectStorageService.downloadObject(objectFile, res);
    } catch (error: any) {
      console.error("Object download error:", error);
      if (error instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "Object not found" });
        return;
      }
      res.status(500).json({ error: "Failed to download object" });
    }
  });

  // ====================
  // Crews & Skills Routes
  // ====================

  // Get all crews
  app.get("/api/crews", requireAuth, async (req: AuthRequest, res) => {
    try {
      const allCrews = await db
        .select({
          crew: crews,
          lead: {
            id: users.id,
            firstName: users.firstName,
            lastName: users.lastName,
          }
        })
        .from(crews)
        .leftJoin(users, eq(crews.leadId, users.id))
        .orderBy(desc(crews.isActive), crews.name);

      // Get member counts for each crew
      const crewsWithCounts = await Promise.all(
        allCrews.map(async ({ crew, lead }) => {
          const [memberCount] = await db
            .select({ count: sql<number>`count(*)` })
            .from(crewMembers)
            .where(eq(crewMembers.crewId, crew.id));
          
          return {
            ...crew,
            lead: lead.id ? lead : null,
            memberCount: Number(memberCount?.count || 0),
          };
        })
      );

      res.json(crewsWithCounts);
    } catch (error) {
      console.error("Error fetching crews:", error);
      res.status(500).json({ error: "Failed to fetch crews" });
    }
  });

  // Create new crew (admin only)
  app.post("/api/crews", requireRole(["ADMIN", "MANAGER"]), async (req: AuthRequest, res) => {
    try {
      const validationResult = insertCrewSchema.safeParse(req.body);
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const [newCrew] = await db.insert(crews).values(validationResult.data).returning();
      
      await logCreate(req.user!.id, "crews", newCrew.id, {
        name: newCrew.name,
        leadId: newCrew.leadId,
      });

      res.status(201).json(newCrew);
    } catch (error) {
      console.error("Error creating crew:", error);
      res.status(500).json({ error: "Failed to create crew" });
    }
  });

  // Update crew (admin only)
  app.patch("/api/crews/:id", requireRole(["ADMIN", "MANAGER"]), async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const updateData = insertCrewSchema.partial().safeParse(req.body);

      if (!updateData.success) {
        res.status(400).json({ error: "Invalid input", details: updateData.error.errors });
        return;
      }

      const [updated] = await db
        .update(crews)
        .set({ ...updateData.data, updatedAt: new Date() })
        .where(eq(crews.id, id))
        .returning();

      if (!updated) {
        res.status(404).json({ error: "Crew not found" });
        return;
      }

      await logUpdate(req.user!.id, "crews", id, updateData.data);

      res.json(updated);
    } catch (error) {
      console.error("Error updating crew:", error);
      res.status(500).json({ error: "Failed to update crew" });
    }
  });

  // Delete crew (admin only)
  app.delete("/api/crews/:id", requireRole(["ADMIN"]), async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;

      const [deleted] = await db.delete(crews).where(eq(crews.id, id)).returning();

      if (!deleted) {
        res.status(404).json({ error: "Crew not found" });
        return;
      }

      await logDelete(req.user!.id, "crews", id, { name: deleted.name });

      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting crew:", error);
      res.status(500).json({ error: "Failed to delete crew" });
    }
  });

  // Get crew members
  app.get("/api/crews/:id/members", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;

      const members = await db
        .select({
          crewMember: crewMembers,
          user: {
            id: users.id,
            firstName: users.firstName,
            lastName: users.lastName,
            email: users.email,
            role: users.role,
            costRateRegular: users.costRateRegular,
            costRateOvertime: users.costRateOvertime,
          }
        })
        .from(crewMembers)
        .innerJoin(users, eq(crewMembers.userId, users.id))
        .where(eq(crewMembers.crewId, id))
        .orderBy(crewMembers.addedAt);

      res.json(members);
    } catch (error) {
      console.error("Error fetching crew members:", error);
      res.status(500).json({ error: "Failed to fetch crew members" });
    }
  });

  // Add member to crew (admin only)
  app.post("/api/crews/:id/members", requireRole(["ADMIN", "MANAGER"]), async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { userId, role } = req.body;

      if (!userId) {
        res.status(400).json({ error: "userId is required" });
        return;
      }

      // Check if member already exists
      const [existing] = await db
        .select()
        .from(crewMembers)
        .where(and(eq(crewMembers.crewId, id), eq(crewMembers.userId, userId)))
        .limit(1);

      if (existing) {
        res.status(400).json({ error: "User is already a member of this crew" });
        return;
      }

      const [newMember] = await db
        .insert(crewMembers)
        .values({ crewId: id, userId, role })
        .returning();

      await logCreate(req.user!.id, "crew_members", newMember.id, {
        crewId: id,
        userId,
        role,
      });

      res.status(201).json(newMember);
    } catch (error) {
      console.error("Error adding crew member:", error);
      res.status(500).json({ error: "Failed to add crew member" });
    }
  });

  // Remove member from crew (admin only)
  app.delete("/api/crews/:id/members/:userId", requireRole(["ADMIN", "MANAGER"]), async (req: AuthRequest, res) => {
    try {
      const { id, userId } = req.params;

      const [deleted] = await db
        .delete(crewMembers)
        .where(and(eq(crewMembers.crewId, id), eq(crewMembers.userId, userId)))
        .returning();

      if (!deleted) {
        res.status(404).json({ error: "Crew member not found" });
        return;
      }

      await logDelete(req.user!.id, "crew_members", deleted.id, {
        crewId: id,
        userId,
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Error removing crew member:", error);
      res.status(500).json({ error: "Failed to remove crew member" });
    }
  });

  // Get crew project assignments
  app.get("/api/crew-assignments", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { crewProjectAssignments } = await import("@shared/schema");
      
      const assignments = await db
        .select({
          assignment: crewProjectAssignments,
          crew: {
            id: crews.id,
            name: crews.name,
          },
          project: {
            id: projects.id,
            code: projects.code,
            name: projects.name,
            status: projects.status,
          },
        })
        .from(crewProjectAssignments)
        .leftJoin(crews, eq(crewProjectAssignments.crewId, crews.id))
        .leftJoin(projects, eq(crewProjectAssignments.projectId, projects.id))
        .orderBy(desc(crewProjectAssignments.createdAt));

      res.json(assignments);
    } catch (error) {
      console.error("Error fetching crew assignments:", error);
      res.status(500).json({ error: "Failed to fetch crew assignments" });
    }
  });

  // Assign crew to project
  app.post("/api/crew-assignments", requireRole(["ADMIN", "MANAGER", "SUPERINTENDENT"]), async (req: AuthRequest, res) => {
    try {
      const { crewProjectAssignments, insertCrewProjectAssignmentSchema } = await import("@shared/schema");
      
      const validated = insertCrewProjectAssignmentSchema.parse({
        ...req.body,
        assignedById: req.user!.id,
      });

      const [assignment] = await db.insert(crewProjectAssignments).values(validated).returning();

      await logCreate(req.user!.id, "crew_project_assignments", assignment.id, {
        crewId: assignment.crewId,
        projectId: assignment.projectId,
      });

      res.status(201).json(assignment);
    } catch (error: any) {
      console.error("Error creating crew assignment:", error);
      if (error.name === "ZodError") {
        res.status(400).json({ error: "Invalid input", details: error.errors });
      } else {
        res.status(500).json({ error: "Failed to create crew assignment" });
      }
    }
  });

  // Remove crew from project
  app.delete("/api/crew-assignments/:id", requireRole(["ADMIN", "MANAGER", "SUPERINTENDENT"]), async (req: AuthRequest, res) => {
    try {
      const { crewProjectAssignments } = await import("@shared/schema");
      const { id } = req.params;

      const [deleted] = await db
        .delete(crewProjectAssignments)
        .where(eq(crewProjectAssignments.id, id))
        .returning();

      if (!deleted) {
        res.status(404).json({ error: "Assignment not found" });
        return;
      }

      await logDelete(req.user!.id, "crew_project_assignments", id, {
        crewId: deleted.crewId,
        projectId: deleted.projectId,
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Error removing crew assignment:", error);
      res.status(500).json({ error: "Failed to remove crew assignment" });
    }
  });

  // Get all skills
  app.get("/api/skills", requireAuth, async (req: AuthRequest, res) => {
    try {
      const allSkills = await db.select().from(skills).orderBy(skills.category, skills.name);
      res.json(allSkills);
    } catch (error) {
      console.error("Error fetching skills:", error);
      res.status(500).json({ error: "Failed to fetch skills" });
    }
  });

  // Create new skill (admin only)
  app.post("/api/skills", requireRole(["ADMIN", "MANAGER"]), async (req: AuthRequest, res) => {
    try {
      const validationResult = insertSkillSchema.safeParse(req.body);
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const [newSkill] = await db.insert(skills).values(validationResult.data).returning();
      
      await logCreate(req.user!.id, "skills", newSkill.id, {
        name: newSkill.name,
        category: newSkill.category,
      });

      res.status(201).json(newSkill);
    } catch (error: any) {
      console.error("Error creating skill:", error);
      if (error.constraint === "skills_name_unique") {
        res.status(400).json({ error: "A skill with this name already exists" });
        return;
      }
      res.status(500).json({ error: "Failed to create skill" });
    }
  });

  // Delete skill (admin only)
  app.delete("/api/skills/:id", requireRole(["ADMIN"]), async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;

      const [deleted] = await db.delete(skills).where(eq(skills.id, id)).returning();

      if (!deleted) {
        res.status(404).json({ error: "Skill not found" });
        return;
      }

      await logDelete(req.user!.id, "skills", id, { name: deleted.name });

      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting skill:", error);
      res.status(500).json({ error: "Failed to delete skill" });
    }
  });

  // Get user skills
  app.get("/api/users/:userId/skills", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { userId } = req.params;

      const userSkillsList = await db
        .select({
          userSkill: userSkills,
          skill: skills,
        })
        .from(userSkills)
        .innerJoin(skills, eq(userSkills.skillId, skills.id))
        .where(eq(userSkills.userId, userId))
        .orderBy(skills.category, skills.name);

      res.json(userSkillsList);
    } catch (error) {
      console.error("Error fetching user skills:", error);
      res.status(500).json({ error: "Failed to fetch user skills" });
    }
  });

  // Assign skill to user (admin only)
  app.post("/api/users/:userId/skills", requireRole(["ADMIN", "MANAGER"]), async (req: AuthRequest, res) => {
    try {
      const { userId } = req.params;
      const { skillId, proficiencyLevel, yearsExperience } = req.body;

      if (!skillId) {
        res.status(400).json({ error: "skillId is required" });
        return;
      }

      // Check if user already has this skill
      const [existing] = await db
        .select()
        .from(userSkills)
        .where(and(eq(userSkills.userId, userId), eq(userSkills.skillId, skillId)))
        .limit(1);

      if (existing) {
        res.status(400).json({ error: "User already has this skill" });
        return;
      }

      const [newUserSkill] = await db
        .insert(userSkills)
        .values({ userId, skillId, proficiencyLevel, yearsExperience })
        .returning();

      await logCreate(req.user!.id, "user_skills", newUserSkill.id, {
        userId,
        skillId,
        proficiencyLevel,
      });

      res.status(201).json(newUserSkill);
    } catch (error) {
      console.error("Error assigning skill:", error);
      res.status(500).json({ error: "Failed to assign skill" });
    }
  });

  // Remove skill from user (admin only)
  app.delete("/api/users/:userId/skills/:skillId", requireRole(["ADMIN", "MANAGER"]), async (req: AuthRequest, res) => {
    try {
      const { userId, skillId } = req.params;

      const [deleted] = await db
        .delete(userSkills)
        .where(and(eq(userSkills.userId, userId), eq(userSkills.skillId, skillId)))
        .returning();

      if (!deleted) {
        res.status(404).json({ error: "User skill not found" });
        return;
      }

      await logDelete(req.user!.id, "user_skills", deleted.id, {
        userId,
        skillId,
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Error removing skill:", error);
      res.status(500).json({ error: "Failed to remove skill" });
    }
  });

  // ====================
  // Subcontractor Routes
  // ====================

  // Get subcontractor contracts for a project
  app.get("/api/projects/:code/subcontractors", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { code } = req.params;

      // Get project
      const [project] = await db
        .select()
        .from(projects)
        .where(eq(projects.code, code))
        .limit(1);

      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      // Get contracts with subcontractor details
      const contracts = await db
        .select({
          id: subcontractorContracts.id,
          contractNumber: subcontractorContracts.contractNumber,
          scopeOfWork: subcontractorContracts.scopeOfWork,
          contractAmount: subcontractorContracts.contractAmount,
          startDate: subcontractorContracts.startDate,
          completionDate: subcontractorContracts.completionDate,
          status: subcontractorContracts.status,
          paymentTerms: subcontractorContracts.paymentTerms,
          retentionPercent: subcontractorContracts.retentionPercent,
          notes: subcontractorContracts.notes,
          createdAt: subcontractorContracts.createdAt,
          subcontractor: {
            id: subcontractors.id,
            companyName: subcontractors.companyName,
            contactName: subcontractors.contactName,
            email: subcontractors.email,
            phone: subcontractors.phone,
          },
        })
        .from(subcontractorContracts)
        .leftJoin(subcontractors, eq(subcontractorContracts.subcontractorId, subcontractors.id))
        .where(eq(subcontractorContracts.projectId, project.id))
        .orderBy(desc(subcontractorContracts.createdAt));

      res.json(contracts);
    } catch (error) {
      console.error("Error fetching subcontractor contracts:", error);
      res.status(500).json({ error: "Failed to fetch subcontractor contracts" });
    }
  });

  // Get payments for a contract
  app.get("/api/subcontractor-contracts/:contractId/payments", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { contractId } = req.params;

      const payments = await db
        .select()
        .from(subcontractorPayments)
        .where(eq(subcontractorPayments.contractId, contractId))
        .orderBy(subcontractorPayments.paymentNumber);

      res.json(payments);
    } catch (error) {
      console.error("Error fetching payments:", error);
      res.status(500).json({ error: "Failed to fetch payments" });
    }
  });

  // ====================
  // Subcontractor Payables Routes
  // ====================

  // Get all subcontractor payables (for CFO/Office Manager dashboard)
  app.get("/api/subcontractor-payables", requireRole(["ADMIN", "MANAGER"]), async (req: AuthRequest, res) => {
    try {
      const payables = await db
        .select({
          paymentId: subcontractorPayments.id,
          paymentNumber: subcontractorPayments.paymentNumber,
          amount: subcontractorPayments.amount,
          retentionHeld: subcontractorPayments.retentionHeld,
          paymentDate: subcontractorPayments.paymentDate,
          description: subcontractorPayments.description,
          invoiceNumber: subcontractorPayments.invoiceNumber,
          status: subcontractorPayments.status,
          approvedAt: subcontractorPayments.approvedAt,
          paidAt: subcontractorPayments.paidAt,
          createdAt: subcontractorPayments.createdAt,
          contract: {
            id: subcontractorContracts.id,
            contractNumber: subcontractorContracts.contractNumber,
            scopeOfWork: subcontractorContracts.scopeOfWork,
            contractAmount: subcontractorContracts.contractAmount,
            projectId: subcontractorContracts.projectId,
          },
          subcontractor: {
            companyName: subcontractors.companyName,
            contactName: subcontractors.contactName,
            email: subcontractors.email,
            phone: subcontractors.phone,
          },
          project: {
            code: projects.code,
            name: projects.name,
          },
        })
        .from(subcontractorPayments)
        .leftJoin(subcontractorContracts, eq(subcontractorPayments.contractId, subcontractorContracts.id))
        .leftJoin(subcontractors, eq(subcontractorContracts.subcontractorId, subcontractors.id))
        .leftJoin(projects, eq(subcontractorContracts.projectId, projects.id))
        .orderBy(desc(subcontractorPayments.createdAt));

      res.json(payables);
    } catch (error) {
      console.error("Error fetching subcontractor payables:", error);
      res.status(500).json({ error: "Failed to fetch subcontractor payables" });
    }
  });

  // ====================
  // Data Quality Routes
  // ====================

  // Get data quality score for a project
  app.get("/api/projects/:code/data-quality", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { code } = req.params;

      // Get project
      const [project] = await db
        .select()
        .from(projects)
        .where(eq(projects.code, code))
        .limit(1);

      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      // Import the data quality scorer
      const { calculateProjectDataQuality } = await import("./ai/dataQualityScorer");

      // Calculate data quality score
      const qualityScore = await calculateProjectDataQuality(project.id);

      res.json(qualityScore);
    } catch (error) {
      console.error("Error fetching data quality score:", error);
      res.status(500).json({ error: "Failed to fetch data quality score" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
```

---
---

# SECTION 4: AI SYSTEM (7 FILES - COMPLETE IMPLEMENTATION)

---

## 4.1 server/aiRoutes.ts (300 lines)

```typescript
import { Router } from "express";
import { db } from "./db";
import { aiSettings, aiRuns, aiTasks } from "@shared/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { 
  runAIAnalysis, 
  getLatestAIRun, 
  getAIRunById, 
  getTasksForRun,
  getTasksForRole,
  updateTaskStatus 
} from "./ai/orchestrator";
import { sensitiveLimiter } from "./rateLimiter";
import { logUpdate, logCreate } from "./auditLogger";

const router = Router();

router.get("/ai-settings", async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: "Admin access required" });
    }

    let [settings] = await db.select().from(aiSettings).limit(1);

    if (!settings) {
      [settings] = await db.insert(aiSettings).values({}).returning();
    }

    res.json(settings);
  } catch (error: any) {
    console.error("Error fetching AI settings:", error);
    res.status(500).json({ error: error.message });
  }
});

router.patch("/ai-settings", sensitiveLimiter, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: "Admin access required" });
    }

    const [existingSettings] = await db.select().from(aiSettings).limit(1);

    let updated;
    if (existingSettings) {
      [updated] = await db
        .update(aiSettings)
        .set({ ...req.body, updatedAt: new Date() })
        .where(eq(aiSettings.id, existingSettings.id))
        .returning();
    } else {
      [updated] = await db.insert(aiSettings).values(req.body).returning();
    }

    await logUpdate(db, {
      entityType: 'AI_SETTINGS',
      entityId: updated.id,
      userId: req.user.id,
      oldValues: existingSettings,
      newValues: updated,
    }, req);

    res.json(updated);
  } catch (error: any) {
    console.error("Error updating AI settings:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/ai-pm/run", sensitiveLimiter, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!['ADMIN', 'MANAGER'].includes(req.user.role)) {
      return res.status(403).json({ error: "Admin or Manager access required" });
    }

    const runId = await runAIAnalysis(req.user.id);

    await logCreate(db, {
      entityType: 'AI_RUN',
      entityId: runId,
      userId: req.user.id,
      newValues: { runId, triggeredBy: req.user.id },
    }, req);

    res.json({ runId, status: 'completed' });
  } catch (error: any) {
    console.error("Error running AI analysis:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/ai-pm/latest-run", async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const run = await getLatestAIRun();
    
    if (!run) {
      return res.json(null);
    }

    const parsedRun = {
      ...run,
      snapshotData: run.snapshotData ? JSON.parse(run.snapshotData) : null,
      profitabilityData: run.profitabilityData ? JSON.parse(run.profitabilityData) : null,
      aiResponse: run.aiResponse ? JSON.parse(run.aiResponse) : null,
    };

    res.json(parsedRun);
  } catch (error: any) {
    console.error("Error fetching latest AI run:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/ai-pm/runs/:runId", async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const run = await getAIRunById(req.params.runId);

    if (!run) {
      return res.status(404).json({ error: "Run not found" });
    }

    const parsedRun = {
      ...run,
      snapshotData: run.snapshotData ? JSON.parse(run.snapshotData) : null,
      profitabilityData: run.profitabilityData ? JSON.parse(run.profitabilityData) : null,
      aiResponse: run.aiResponse ? JSON.parse(run.aiResponse) : null,
    };

    res.json(parsedRun);
  } catch (error: any) {
    console.error("Error fetching AI run:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/ai-pm/tasks", async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { role, status } = req.query;

    const userRole = role ? String(role) : req.user.role;
    const taskStatus = status ? String(status) : undefined;

    const tasks = await getTasksForRole(userRole, taskStatus);

    const parsedTasks = tasks.map(task => ({
      ...task,
      metadata: task.metadata ? JSON.parse(task.metadata) : null,
    }));

    res.json(parsedTasks);
  } catch (error: any) {
    console.error("Error fetching AI tasks:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/ai-pm/tasks/role/:role", async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { role } = req.params;
    const { status } = req.query;

    const taskStatus = status ? String(status) : undefined;

    const tasks = await getTasksForRole(role, taskStatus);

    const parsedTasks = tasks.map(task => ({
      ...task,
      metadata: task.metadata ? JSON.parse(task.metadata) : null,
    }));

    res.json(parsedTasks);
  } catch (error: any) {
    console.error("Error fetching AI tasks:", error);
    res.status(500).json({ error: error.message });
  }
});

router.patch("/ai-pm/tasks/:taskId", async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { status } = req.body;

    if (!status || !['PENDING', 'IN_PROGRESS', 'COMPLETED', 'DISMISSED'].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    await updateTaskStatus(req.params.taskId, status, req.user.id);

    const [updatedTask] = await db
      .select()
      .from(aiTasks)
      .where(eq(aiTasks.id, req.params.taskId))
      .limit(1);

    if (!updatedTask) {
      return res.status(404).json({ error: "Task not found" });
    }

    const [existingTask] = await db
      .select()
      .from(aiTasks)
      .where(eq(aiTasks.id, req.params.taskId))
      .limit(1);

    await logUpdate(db, {
      entityType: 'AI_TASK',
      entityId: req.params.taskId,
      userId: req.user.id,
      oldValues: existingTask,
      newValues: { status },
    }, req);

    res.json(updatedTask);
  } catch (error: any) {
    console.error("Error updating AI task:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/cfo/profitability", async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!['ADMIN', 'MANAGER'].includes(req.user.role)) {
      return res.status(403).json({ error: "Admin or Manager access required" });
    }

    const latestRun = await getLatestAIRun();

    if (!latestRun || !latestRun.profitabilityData) {
      return res.json([]);
    }

    const profitabilityData = JSON.parse(latestRun.profitabilityData);
    res.json(profitabilityData);
  } catch (error: any) {
    console.error("Error fetching profitability data:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/ai-pm/runs", async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!['ADMIN', 'MANAGER'].includes(req.user.role)) {
      return res.status(403).json({ error: "Admin or Manager access required" });
    }

    const runs = await db
      .select()
      .from(aiRuns)
      .orderBy(desc(aiRuns.createdAt))
      .limit(50);

    res.json(runs);
  } catch (error: any) {
    console.error("Error fetching AI runs:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
```

---

## 4.2 server/ai/orchestrator.ts (206 lines)

```typescript
import { randomUUID } from "crypto";
import { db } from "../db";
import { aiSettings, aiRuns, aiTasks } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { buildDataSnapshot } from "./snapshotBuilder";
import { calculateAllProjectsProfitability } from "./profitabilityEngine";
import { callOpenAIForAnalysis, AIAnalysisResponse } from "./openaiClient";
import { AI_PM_SYSTEM_PROMPT } from "./systemPrompt";

export async function runAIAnalysis(triggeredById: string | null = null): Promise<string> {
  console.log('🤖 Starting AI PM + CFO analysis run...');

  const runId = randomUUID();
  
  try {
    // Create initial run record
    await db.insert(aiRuns).values({
      id: runId,
      runType: triggeredById ? 'manual' : 'daily',
      status: 'in_progress',
      triggeredById: triggeredById,
    });

    // Step 1: Build data snapshot
    console.log('📊 Building data snapshot...');
    const snapshot = await buildDataSnapshot();

    // Step 2: Calculate profitability for all projects
    console.log('💰 Calculating project profitability...');
    const profitability = await calculateAllProjectsProfitability();

    // Step 3: Get AI settings
    const [settings] = await db
      .select()
      .from(aiSettings)
      .limit(1);

    if (!settings) {
      throw new Error('AI settings not found. Please initialize settings first.');
    }

    // Step 4: Build user prompt
    const userPrompt = buildUserPrompt(snapshot, profitability, settings);

    // Step 5: Call OpenAI
    console.log('🧠 Calling OpenAI for analysis...');
    const aiResponse = await callOpenAIForAnalysis(
      AI_PM_SYSTEM_PROMPT,
      userPrompt,
      settings.modelName
    );

    // Step 6: Persist AI response and create tasks
    await db
      .update(aiRuns)
      .set({
        snapshotData: JSON.stringify(snapshot),
        profitabilityData: JSON.stringify(profitability),
        aiResponse: JSON.stringify(aiResponse),
        status: 'completed',
        completedAt: new Date(),
      })
      .where(eq(aiRuns.id, runId));

    // Step 7: Create tasks from AI response
    console.log('📝 Creating AI-generated tasks...');
    await createTasksFromAIResponse(runId, aiResponse);

    console.log(`✅ AI analysis completed successfully. Run ID: ${runId}`);
    return runId;

  } catch (error: any) {
    console.error('❌ AI analysis failed:', error);

    // Update run with error
    await db
      .update(aiRuns)
      .set({
        status: 'failed',
        errorMessage: error.message || 'Unknown error',
        completedAt: new Date(),
      })
      .where(eq(aiRuns.id, runId));

    throw error;
  }
}

function buildUserPrompt(snapshot: any, profitability: any[], settings: any): string {
  const enabledFeatures = [];
  if (settings.roleTasksEnabled) enabledFeatures.push('role-based tasks');
  if (settings.billingAlertsEnabled) enabledFeatures.push('billing alerts');
  if (settings.profitabilityWarningsEnabled) enabledFeatures.push('profitability warnings');
  if (settings.crewSchedulingEnabled) enabledFeatures.push('crew scheduling');
  if (settings.bidRemindersEnabled) enabledFeatures.push('bid reminders');
  if (settings.materialOrderingEnabled) enabledFeatures.push('material ordering');

  return `Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.

**Enabled Features**: ${enabledFeatures.join(', ')}

**COMPLETE DATA SNAPSHOT**:
${JSON.stringify(snapshot, null, 2)}

**PROJECT PROFITABILITY ANALYSIS**:
${JSON.stringify(profitability, null, 2)}

Based on this comprehensive data, generate your daily analysis with role-specific tasks, profitability insights, crew scheduling recommendations, material ordering alerts, bid reminders, and billing insights.

Remember:
- Be specific and actionable
- Reference actual project codes, amounts, and deadlines
- Prioritize based on financial impact and urgency
- Generate 10-30 tasks across all roles
- Flag issues proactively
- Include context from the data

Respond with valid JSON matching the required structure.`;
}

async function createTasksFromAIResponse(runId: string, aiResponse: AIAnalysisResponse): Promise<void> {
  const tasksToInsert = aiResponse.tasks.map(task => {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + (task.due_date_offset_days || 0));

    return {
      runId: runId,
      taskType: task.task_type,
      role: task.role,
      title: task.title,
      description: task.description,
      priority: task.priority,
      status: 'PENDING' as const,
      dueDate: dueDate,
      projectCode: task.project_code,
      metadata: JSON.stringify(task.metadata),
    };
  });

  if (tasksToInsert.length > 0) {
    await db.insert(aiTasks).values(tasksToInsert);
    console.log(`✅ Created ${tasksToInsert.length} AI-generated tasks`);
  }
}

export async function getLatestAIRun() {
  const [latestRun] = await db
    .select()
    .from(aiRuns)
    .where(eq(aiRuns.status, 'completed'))
    .orderBy(desc(aiRuns.createdAt))
    .limit(1);

  return latestRun;
}

export async function getAIRunById(runId: string) {
  const [run] = await db
    .select()
    .from(aiRuns)
    .where(eq(aiRuns.id, runId))
    .limit(1);

  return run;
}

export async function getTasksForRun(runId: string) {
  return db
    .select()
    .from(aiTasks)
    .where(eq(aiTasks.runId, runId))
    .orderBy(desc(aiTasks.createdAt));
}

export async function getTasksForRole(role: string, status?: string) {
  let query = db
    .select()
    .from(aiTasks)
    .where(eq(aiTasks.role, role as any));

  if (status) {
    query = query.where(eq(aiTasks.status, status as any)) as any;
  }

  return query.orderBy(desc(aiTasks.priority), desc(aiTasks.createdAt)).limit(100);
}

export async function updateTaskStatus(taskId: string, status: string, userId?: string) {
  const updates: any = {
    status: status as any,
  };

  if (status === 'COMPLETED') {
    updates.completedAt = new Date();
  }

  if (status === 'IN_PROGRESS' && userId) {
    updates.assignedToId = userId;
  }

  await db
    .update(aiTasks)
    .set(updates)
    .where(eq(aiTasks.id, taskId));
}
```

---

## 4.3 server/ai/profitabilityEngine.ts (249 lines)

```typescript
import { db } from "../db";
import { 
  projects, 
  timeEntries, 
  procurementItems, 
  changeOrders, 
  receipts,
  users,
  subcontractorContracts,
  subcontractorPayments 
} from "@shared/schema";
import { eq, sql, and } from "drizzle-orm";

export interface ProjectProfitability {
  project_code: string;
  project_name: string;
  budget: number;
  total_labor_cost: number;
  total_material_cost: number;
  total_subcontractor_cost: number;
  total_other_expenses: number;
  approved_change_orders_value: number;
  adjusted_budget: number;
  total_actual_cost: number;
  variance: number;
  variance_percent: number;
  status: 'ON_BUDGET' | 'MINOR_CONCERN' | 'MAJOR_RISK';
  projected_completion_cost: number;
  estimated_margin: number;
  key_metrics: {
    labor_hours: number;
    labor_efficiency: string;
    material_spend_rate: string;
    pending_change_orders_value: number;
    subcontractor_count: number;
  };
}

export async function calculateProjectProfitability(projectCode: string): Promise<ProjectProfitability> {
  // Fetch project
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.code, projectCode))
    .limit(1);

  if (!project) {
    throw new Error(`Project ${projectCode} not found`);
  }

  // Calculate labor costs - using actual user cost rates from users table
  const laborEntries = await db
    .select({
      hoursRegular: timeEntries.hoursRegular,
      hoursOvertime: timeEntries.hoursOvertime,
      costRateRegular: users.costRateRegular,
      costRateOvertime: users.costRateOvertime,
    })
    .from(timeEntries)
    .leftJoin(users, eq(timeEntries.userId, users.id))
    .where(eq(timeEntries.projectId, project.id))
    .limit(5000);

  const DEFAULT_COST_RATE = 50;
  const DEFAULT_OT_MULTIPLIER = 1.5;

  const totalLaborHours = laborEntries.reduce(
    (sum, entry) => 
      sum + Number(entry.hoursRegular || 0) + Number(entry.hoursOvertime || 0),
    0
  );
  
  const totalLaborCost = laborEntries.reduce((sum, entry) => {
    const regularRate = entry.costRateRegular ? Number(entry.costRateRegular) : DEFAULT_COST_RATE;
    const overtimeRate = entry.costRateOvertime ? Number(entry.costRateOvertime) : (regularRate * DEFAULT_OT_MULTIPLIER);
    
    const regularCost = Number(entry.hoursRegular || 0) * regularRate;
    const overtimeCost = Number(entry.hoursOvertime || 0) * overtimeRate;
    return sum + regularCost + overtimeCost;
  }, 0);

  // Calculate material costs - using unit cost × quantity for procurement items
  const materials = await db
    .select({
      unitCost: procurementItems.unitCost,
      quantity: procurementItems.quantity,
      status: procurementItems.status,
    })
    .from(procurementItems)
    .where(eq(procurementItems.projectId, project.id))
    .limit(1000);

  const totalMaterialCost = materials.reduce((sum, item) => {
    const cost = Number(item.unitCost || 0) * Number(item.quantity || 0);
    return sum + cost;
  }, 0);

  // Calculate other expenses from receipts
  const expenseReceipts = await db
    .select({
      amount: receipts.amount,
    })
    .from(receipts)
    .where(eq(receipts.projectId, project.id))
    .limit(1000);

  const totalOtherExpenses = expenseReceipts.reduce((sum, r) => sum + Number(r.amount || 0), 0);

  // Calculate subcontractor costs - use inner join to ensure valid project linkage
  const subcontractorPaymentsData = await db
    .select({
      amount: subcontractorPayments.amount,
      status: subcontractorPayments.status,
      projectId: subcontractorContracts.projectId,
    })
    .from(subcontractorContracts)
    .innerJoin(subcontractorPayments, eq(subcontractorPayments.contractId, subcontractorContracts.id))
    .where(eq(subcontractorContracts.projectId, project.id))
    .limit(1000);

  // Include all subcontractor payment obligations (SCHEDULED, PENDING, APPROVED, PAID)
  const totalSubcontractorCost = subcontractorPaymentsData
    .filter(p => ['SCHEDULED', 'PENDING', 'APPROVED', 'PAID'].includes(p.status || ''))
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  const subcontractorContractsData = await db
    .select({ count: sql<number>`count(*)` })
    .from(subcontractorContracts)
    .where(eq(subcontractorContracts.projectId, project.id));

  const subcontractorCount = Number(subcontractorContractsData[0]?.count || 0);

  // Calculate change orders
  const projectChangeOrders = await db
    .select({
      amount: changeOrders.amount,
      status: changeOrders.status,
    })
    .from(changeOrders)
    .where(eq(changeOrders.projectId, project.id))
    .limit(500);

  const approvedCOs = projectChangeOrders.filter(co => co.status === 'APPROVED');
  const pendingCOs = projectChangeOrders.filter(co => 
    ['DRAFT', 'PENDING_APPROVAL', 'SUBMITTED'].includes(co.status)
  );

  const approvedCOValue = approvedCOs.reduce((sum, co) => sum + Number(co.amount || 0), 0);
  const pendingCOValue = pendingCOs.reduce((sum, co) => sum + Number(co.amount || 0), 0);

  // Calculate totals - use contractAmount as primary, fallback to budget
  const baseBudget = Number(project.contractAmount || project.budget || 0);
  const adjustedBudget = baseBudget + approvedCOValue;
  const totalActualCost = totalLaborCost + totalMaterialCost + totalSubcontractorCost + totalOtherExpenses;
  const variance = adjustedBudget - totalActualCost;
  const variancePercent = adjustedBudget > 0 ? (variance / adjustedBudget) * 100 : 0;

  // Determine status based on variance percentage
  let status: 'ON_BUDGET' | 'MINOR_CONCERN' | 'MAJOR_RISK';
  if (variancePercent >= 10) {
    status = 'ON_BUDGET';
  } else if (variancePercent >= 0) {
    status = 'MINOR_CONCERN';
  } else {
    status = 'MAJOR_RISK';
  }

  // Project completion cost based on timeline percentage complete
  const startDate = project.startDate ? new Date(project.startDate) : new Date();
  const endDate = project.estimatedCompletionDate ? new Date(project.estimatedCompletionDate) : new Date();
  const now = new Date();
  const totalDuration = endDate.getTime() - startDate.getTime();
  const elapsed = now.getTime() - startDate.getTime();
  
  // Guard against invalid date ranges
  let percentComplete = 50; // Default to 50% if dates are invalid
  if (totalDuration > 0 && elapsed >= 0) {
    percentComplete = Math.min(100, Math.max(0, (elapsed / totalDuration) * 100));
  }
  
  const projectedCompletionCost = percentComplete > 0 && percentComplete < 100
    ? (totalActualCost / (percentComplete / 100))
    : totalActualCost;

  const estimatedMargin = adjustedBudget - projectedCompletionCost;

  // Labor efficiency - compare actual hours to budgeted hours (assume 40% of budget is labor)
  const budgetedLaborHours = baseBudget * 0.4 / DEFAULT_COST_RATE;
  const laborEfficiency = budgetedLaborHours > 0
    ? `${Math.round((totalLaborHours / budgetedLaborHours) * 100)}% of budgeted hours`
    : 'Unknown';

  // Material spend rate - compare actual material costs to budgeted (assume 45% of budget)
  const budgetedMaterials = baseBudget * 0.45;
  const materialSpendRate = budgetedMaterials > 0
    ? `${Math.round((totalMaterialCost / budgetedMaterials) * 100)}% of budget`
    : 'Unknown';

  return {
    project_code: projectCode,
    project_name: project.name,
    budget: baseBudget,
    total_labor_cost: Math.round(totalLaborCost * 100) / 100,
    total_material_cost: Math.round(totalMaterialCost * 100) / 100,
    total_subcontractor_cost: Math.round(totalSubcontractorCost * 100) / 100,
    total_other_expenses: Math.round(totalOtherExpenses * 100) / 100,
    approved_change_orders_value: Math.round(approvedCOValue * 100) / 100,
    adjusted_budget: Math.round(adjustedBudget * 100) / 100,
    total_actual_cost: Math.round(totalActualCost * 100) / 100,
    variance: Math.round(variance * 100) / 100,
    variance_percent: Math.round(variancePercent * 100) / 100,
    status,
    projected_completion_cost: Math.round(projectedCompletionCost * 100) / 100,
    estimated_margin: Math.round(estimatedMargin * 100) / 100,
    key_metrics: {
      labor_hours: Math.round(totalLaborHours * 100) / 100,
      labor_efficiency: laborEfficiency,
      material_spend_rate: materialSpendRate,
      pending_change_orders_value: Math.round(pendingCOValue * 100) / 100,
      subcontractor_count: subcontractorCount,
    },
  };
}

export async function calculateAllProjectsProfitability(): Promise<ProjectProfitability[]> {
  // Get all active projects
  const activeProjects = await db
    .select({ code: projects.code })
    .from(projects)
    .where(sql`${projects.status} IN ('ACTIVE', 'PLANNING')`)
    .limit(100);

  const results: ProjectProfitability[] = [];

  for (const project of activeProjects) {
    try {
      const profitability = await calculateProjectProfitability(project.code);
      results.push(profitability);
    } catch (error) {
      console.error(`Error calculating profitability for ${project.code}:`, error);
    }
  }

  return results.sort((a, b) => {
    const statusOrder = { 'MAJOR_RISK': 0, 'MINOR_CONCERN': 1, 'ON_BUDGET': 2 };
    return statusOrder[a.status] - statusOrder[b.status];
  });
}
```

---

## 4.4 server/ai/dataQualityScorer.ts (162 lines)

```typescript
import { db } from "../db";
import { 
  projects, 
  scopeItems, 
  timeEntries, 
  procurementItems, 
  users,
  aiDataQuality 
} from "@shared/schema";
import { eq, sql } from "drizzle-orm";

export interface ProjectDataQualityScore {
  projectId: string;
  overallScore: number;
  financialDataScore: number;
  laborDataScore: number;
  materialDataScore: number;
  timelineDataScore: number;
  scopeDataScore: number;
  missingFields: string[];
  recommendations: string[];
}

export async function calculateProjectDataQuality(projectCode: string): Promise<ProjectDataQualityScore> {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.code, projectCode))
    .limit(1);

  if (!project) {
    throw new Error(`Project ${projectCode} not found`);
  }

  const missingFields: string[] = [];
  const recommendations: string[] = [];

  // Financial Data Score (0-100)
  let financialScore = 0;
  if (project.budget && Number(project.budget) > 0) financialScore += 50;
  else {
    missingFields.push("budget");
    recommendations.push("Add project budget for profitability tracking");
  }
  
  if (project.contractAmount && Number(project.contractAmount) > 0) financialScore += 50;
  else {
    missingFields.push("contractAmount");
    recommendations.push("Add contract amount for accurate billing");
  }

  // Labor Data Score (0-100)
  const timeEntriesCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(timeEntries)
    .where(eq(timeEntries.projectId, project.id));

  const laborEntriesCount = Number(timeEntriesCount[0]?.count || 0);
  let laborScore = 0;

  if (laborEntriesCount > 0) laborScore += 40;
  if (laborEntriesCount >= 5) laborScore += 30;
  if (laborEntriesCount >= 20) laborScore += 30;

  if (laborEntriesCount === 0) {
    missingFields.push("timeEntries");
    recommendations.push("Start tracking time entries for accurate labor cost analysis");
  }

  // Check if users have cost rates
  const usersWithoutRates = await db
    .select({ count: sql<number>`count(*)` })
    .from(users)
    .where(sql`${users.costRateRegular} IS NULL OR ${users.costRateOvertime} IS NULL`);

  if (Number(usersWithoutRates[0]?.count || 0) > 0) {
    recommendations.push(`${usersWithoutRates[0]?.count || 0} users missing cost rates - profitability calculations will be less accurate`);
  }

  // Material Data Score (0-100)
  const materialsCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(procurementItems)
    .where(eq(procurementItems.projectId, project.id));

  const materialEntriesCount = Number(materialsCount[0]?.count || 0);
  let materialScore = materialEntriesCount > 0 ? 60 : 0;
  if (materialEntriesCount >= 5) materialScore += 20;
  if (materialEntriesCount >= 15) materialScore += 20;

  if (materialEntriesCount === 0) {
    recommendations.push("Add procurement items to track material costs");
  }

  // Timeline Data Score (0-100)
  let timelineScore = 0;
  if (project.startDate) timelineScore += 50;
  else {
    missingFields.push("startDate");
    recommendations.push("Add project start date for schedule tracking");
  }

  if (project.estimatedCompletionDate) timelineScore += 50;
  else {
    missingFields.push("estimatedCompletionDate");
    recommendations.push("Add estimated completion date for timeline analysis");
  }

  // Scope Data Score (0-100)
  const scopeItemsCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(scopeItems)
    .where(eq(scopeItems.projectId, project.id));

  const scopeCount = Number(scopeItemsCount[0]?.count || 0);
  let scopeScore = scopeCount > 0 ? 60 : 0;
  if (scopeCount >= 5) scopeScore += 20;
  if (scopeCount >= 10) scopeScore += 20;

  if (scopeCount === 0) {
    missingFields.push("scopeItems");
    recommendations.push("Define scope items to track project progress");
  }

  // Overall Score (weighted average)
  const overallScore = Math.round(
    (financialScore * 0.3) +
    (laborScore * 0.25) +
    (materialScore * 0.15) +
    (timelineScore * 0.15) +
    (scopeScore * 0.15)
  );

  return {
    projectId: project.id,
    overallScore,
    financialDataScore: financialScore,
    laborDataScore: laborScore,
    materialDataScore: materialScore,
    timelineDataScore: timelineScore,
    scopeDataScore: scopeScore,
    missingFields,
    recommendations,
  };
}

export async function saveProjectDataQuality(score: ProjectDataQualityScore): Promise<void> {
  await db
    .insert(aiDataQuality)
    .values({
      projectId: score.projectId,
      overallScore: score.overallScore,
      financialDataScore: score.financialDataScore,
      laborDataScore: score.laborDataScore,
      materialDataScore: score.materialDataScore,
      timelineDataScore: score.timelineDataScore,
      scopeDataScore: score.scopeDataScore,
      missingFields: score.missingFields,
      recommendations: score.recommendations,
    });
}
```

---

## 4.5 server/ai/snapshotBuilder.ts (408 lines)

```typescript
import { db } from "../db";
import { 
  projects, 
  timeEntries, 
  procurementItems, 
  changeOrders, 
  scopeItems, 
  receipts, 
  billingEvents,
  timeClockShifts,
  bids,
  users,
  crews,
  crewMembers,
  userSkills,
  subcontractorContracts,
  aiDataQuality
} from "@shared/schema";
import { sql, desc, eq } from "drizzle-orm";
import { calculateProjectDataQuality } from "./dataQualityScorer";

export interface DataSnapshot {
  generated_at: string;
  projects: {
    total_active: number;
    total_completed: number;
    active_projects: {
      code: string;
      name: string;
      status: string;
      budget: number;
      start_date: string | null;
      estimated_completion: string | null;
      client_name: string;
      superintendent_id: string | null;
    }[];
  };
  labor: {
    total_hours_this_week: number;
    total_cost_this_week: number;
    unapproved_entries_count: number;
    unapproved_entries_value: number;
    active_shifts_count: number;
  };
  procurement: {
    pending_orders_count: number;
    pending_orders_value: number;
    urgent_items: {
      project_code: string | null;
      description: string;
      needed_by: string | null;
      estimated_cost: number;
    }[];
  };
  change_orders: {
    pending_approval_count: number;
    pending_approval_value: number;
    recent_approvals: {
      project_code: string | null;
      description: string;
      amount: number;
      status: string;
    }[];
  };
  billing: {
    total_invoiced_ytd: number;
    total_received_ytd: number;
    overdue_invoices: {
      project_code: string | null;
      reference: string | null;
      amount: number;
      days_overdue: number;
    }[];
  };
  bids: {
    active_count: number;
    total_value: number;
    upcoming_deadlines: {
      client_name: string;
      bid_amount: number;
      bid_deadline: string | null;
      status: string;
    }[];
  };
  crew: {
    total_employees: number;
    superintendents: number;
    hourly_workers: number;
    overtime_hours_this_week: number;
    total_crews: number;
    active_crews: number;
    total_crew_members: number;
    users_with_skills: number;
    users_without_cost_rates: number;
  };
  subcontractors: {
    total_active_contracts: number;
    total_contract_value: number;
    active_contracts_by_project: {
      project_code: string;
      contract_count: number;
      total_value: number;
    }[];
  };
  data_quality: {
    avg_overall_score: number;
    projects_below_threshold: number;
    common_issues: string[];
  };
  missing_financials: {
    count: number;
    project_codes: string[];
  };
}

export async function buildDataSnapshot(): Promise<DataSnapshot> {
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const startOfYear = new Date(now.getFullYear(), 0, 1);

  // Fetch all active projects
  const activeProjects = await db
    .select({
      code: projects.code,
      name: projects.name,
      status: projects.status,
      budget: projects.budget,
      contractAmount: projects.contractAmount,
      startDate: projects.startDate,
      estimatedCompletionDate: projects.estimatedCompletionDate,
      clientName: projects.clientName,
      superintendentId: projects.superintendentId,
    })
    .from(projects)
    .where(sql`${projects.status} IN ('ACTIVE', 'PLANNING')`)
    .limit(100);

  const completedProjectsCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projects)
    .where(eq(projects.status, 'COMPLETE'));

  // Time entries in the last week
  const weeklyTimeEntries = await db
    .select({
      hoursRegular: timeEntries.hoursRegular,
      hoursOvertime: timeEntries.hoursOvertime,
      approvedAt: timeEntries.approvedAt,
    })
    .from(timeEntries)
    .where(sql`${timeEntries.date} >= ${oneWeekAgo.toISOString().split('T')[0]}`)
    .limit(1000);

  const totalHoursThisWeek = weeklyTimeEntries.reduce(
    (sum, entry) => sum + Number(entry.hoursRegular || 0) + Number(entry.hoursOvertime || 0), 
    0
  );
  const totalCostThisWeek = weeklyTimeEntries.reduce(
    (sum, entry) => {
      const regularHours = Number(entry.hoursRegular || 0);
      const overtimeHours = Number(entry.hoursOvertime || 0);
      const assumedRate = 50;
      return sum + (regularHours * assumedRate) + (overtimeHours * assumedRate * 1.5);
    },
    0
  );
  const unapprovedEntries = weeklyTimeEntries.filter(e => !e.approvedAt);
  const unapprovedValue = unapprovedEntries.reduce(
    (sum, entry) => {
      const regularHours = Number(entry.hoursRegular || 0);
      const overtimeHours = Number(entry.hoursOvertime || 0);
      const assumedRate = 50;
      return sum + (regularHours * assumedRate) + (overtimeHours * assumedRate * 1.5);
    },
    0
  );

  // Active time-clock shifts
  const activeShiftsCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(timeClockShifts)
    .where(sql`${timeClockShifts.clockOut} IS NULL`);

  // Pending procurement
  const pendingProcurement = await db
    .select()
    .from(procurementItems)
    .where(eq(procurementItems.status, 'PLANNED'))
    .limit(50);

  const urgentItems = pendingProcurement
    .filter(item => {
      if (!item.neededByDate) return false;
      const daysUntilNeeded = Math.ceil((new Date(item.neededByDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      return daysUntilNeeded <= 3 && daysUntilNeeded >= 0;
    })
    .map(item => ({
      project_code: item.projectId,
      description: item.description,
      needed_by: item.neededByDate?.toISOString().split('T')[0] || null,
      estimated_cost: Number(item.unitCost || 0) * Number(item.quantity || 0),
    }));

  // Change orders pending approval
  const pendingChangeOrders = await db
    .select()
    .from(changeOrders)
    .where(sql`${changeOrders.status} IN ('PENDING_APPROVAL', 'SUBMITTED')`)
    .limit(50);

  const recentApprovedCOs = await db
    .select()
    .from(changeOrders)
    .where(eq(changeOrders.status, 'APPROVED'))
    .orderBy(desc(changeOrders.approvedAt))
    .limit(10);

  // Billing events (using current schema: scopeItemId, quantity, unitPrice, totalAmount)
  const recentBillingEvents = await db
    .select()
    .from(billingEvents)
    .where(sql`${billingEvents.createdAt} >= ${startOfYear.toISOString().split('T')[0]}`)
    .limit(200);

  const totalBilled = recentBillingEvents.reduce((sum, e) => sum + Number(e.totalAmount || 0), 0);
  const totalReceived = 0; // Will be calculated from payment tracking when implemented

  // Overdue invoices - to be implemented with payment tracking
  const overdueInvoices: any[] = [];

  // Active bids (using current schema: no status field, using dueDate instead of bidDeadline)
  const activeBids = await db
    .select()
    .from(bids)
    .limit(50);

  const upcomingBidDeadlines = activeBids
    .filter(bid => bid.dueDate && new Date(bid.dueDate) > now)
    .sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime())
    .slice(0, 10)
    .map(bid => ({
      client_name: bid.clientName,
      bid_amount: Number(bid.bidAmount || 0),
      bid_deadline: bid.dueDate?.toISOString().split('T')[0] || null,
      status: 'ACTIVE',
    }));

  // Crew statistics
  const allUsers = await db.select().from(users).limit(500);
  const superintendents = allUsers.filter(u => u.role === 'SUPERINTENDENT').length;
  const hourlyWorkers = allUsers.filter(u => u.role === 'HOURLY_EMPLOYEE').length;

  // Calculate overtime hours (>40 hours per week per employee) - to be properly implemented with user tracking
  const overtimeHours = weeklyTimeEntries.reduce(
    (sum, entry) => sum + Number(entry.hoursOvertime || 0),
    0
  );

  // Crew data - query actual crew tables
  const allCrews = await db.select().from(crews).limit(100);
  const activeCrews = allCrews.filter(c => c.isActive).length;
  
  // Count crew members across all crews
  const crewMembersData = await db
    .select({ count: sql<number>`count(*)` })
    .from(crewMembers)
    .limit(1);
  const totalCrewMembers = Number(crewMembersData[0]?.count || 0);
  
  // Count users with assigned skills
  const usersWithSkillsData = await db
    .select({ count: sql<number>`count(DISTINCT ${userSkills.userId})` })
    .from(userSkills)
    .limit(1);
  const usersWithSkills = Number(usersWithSkillsData[0]?.count || 0);
  
  const usersWithoutCostRates = allUsers.filter(u => !u.costRateRegular || !u.costRateOvertime).length;

  // Subcontractor data
  const allSubcontractorContracts = await db
    .select()
    .from(subcontractorContracts)
    .where(sql`${subcontractorContracts.status} IN ('ACTIVE', 'PENDING')`)
    .limit(200);

  const contractsByProject: { [key: string]: { count: number; value: number } } = {};
  allSubcontractorContracts.forEach(contract => {
    const projectId = contract.projectId;
    if (!contractsByProject[projectId]) {
      contractsByProject[projectId] = { count: 0, value: 0 };
    }
    contractsByProject[projectId].count++;
    contractsByProject[projectId].value += Number(contract.contractAmount || 0);
  });

  const activeContractsByProject = Object.entries(contractsByProject).map(([projectId, data]) => ({
    project_code: projectId,
    contract_count: data.count,
    total_value: Math.round(data.value * 100) / 100,
  }));

  // Data quality scores
  const qualityScores = await db
    .select()
    .from(aiDataQuality)
    .limit(1000);

  const avgQualityScore = qualityScores.length > 0
    ? Math.round(qualityScores.reduce((sum, q) => sum + q.overallScore, 0) / qualityScores.length)
    : 0;

  const projectsBelowThreshold = qualityScores.filter(q => q.overallScore < 60).length;

  const commonIssues: string[] = [];
  qualityScores.forEach(q => {
    if (q.missingFields && q.missingFields.length > 0) {
      q.missingFields.forEach(field => {
        if (!commonIssues.includes(field)) {
          commonIssues.push(field);
        }
      });
    }
  });

  // Missing financials
  const projectsMissingFinancials = activeProjects.filter(
    p => !p.budget || Number(p.budget) === 0 || !p.contractAmount || Number(p.contractAmount) === 0
  );

  return {
    generated_at: now.toISOString(),
    projects: {
      total_active: activeProjects.length,
      total_completed: completedProjectsCount[0]?.count || 0,
      active_projects: activeProjects.map(p => ({
        code: p.code,
        name: p.name,
        status: p.status,
        budget: Number(p.budget || 0),
        contract_amount: Number(p.contractAmount || 0),
        start_date: p.startDate?.toISOString().split('T')[0] || null,
        estimated_completion: p.estimatedCompletionDate?.toISOString().split('T')[0] || null,
        client_name: p.clientName,
        superintendent_id: p.superintendentId,
        missing_financials: !p.budget || Number(p.budget) === 0 || !p.contractAmount || Number(p.contractAmount) === 0,
      })),
      projects_missing_financials: activeProjects.filter(p => !p.budget || Number(p.budget) === 0 || !p.contractAmount || Number(p.contractAmount) === 0).length,
    },
    labor: {
      total_hours_this_week: Math.round(totalHoursThisWeek * 100) / 100,
      total_cost_this_week: Math.round(totalCostThisWeek * 100) / 100,
      unapproved_entries_count: unapprovedEntries.length,
      unapproved_entries_value: Math.round(unapprovedValue * 100) / 100,
      active_shifts_count: activeShiftsCount[0]?.count || 0,
    },
    procurement: {
      pending_orders_count: pendingProcurement.length,
      pending_orders_value: pendingProcurement.reduce((sum, item) => sum + (Number(item.unitCost || 0) * Number(item.quantity || 0)), 0),
      urgent_items: urgentItems,
    },
    change_orders: {
      pending_approval_count: pendingChangeOrders.length,
      pending_approval_value: pendingChangeOrders.reduce((sum, co) => sum + Number(co.amount || 0), 0),
      recent_approvals: recentApprovedCOs.map(co => ({
        project_code: co.projectId,
        description: co.description,
        amount: Number(co.amount || 0),
        status: co.status,
      })),
    },
    billing: {
      total_invoiced_ytd: Math.round(totalBilled * 100) / 100,
      total_received_ytd: Math.round(totalReceived * 100) / 100,
      overdue_invoices: overdueInvoices,
    },
    bids: {
      active_count: activeBids.length,
      total_value: activeBids.reduce((sum, bid) => sum + Number(bid.bidAmount || 0), 0),
      upcoming_deadlines: upcomingBidDeadlines,
    },
    crew: {
      total_employees: allUsers.length,
      superintendents: superintendents,
      hourly_workers: hourlyWorkers,
      overtime_hours_this_week: Math.round(overtimeHours * 100) / 100,
      total_crews: allCrews.length,
      active_crews: activeCrews,
      total_crew_members: totalCrewMembers,
      users_with_skills: usersWithSkills,
      users_without_cost_rates: usersWithoutCostRates,
    },
    subcontractors: {
      total_active_contracts: allSubcontractorContracts.length,
      total_contract_value: Math.round(allSubcontractorContracts.reduce((sum, c) => sum + Number(c.contractAmount || 0), 0) * 100) / 100,
      active_contracts_by_project: activeContractsByProject,
    },
    data_quality: {
      avg_overall_score: avgQualityScore,
      projects_below_threshold: projectsBelowThreshold,
      common_issues: commonIssues.slice(0, 10),
    },
    missing_financials: {
      count: projectsMissingFinancials.length,
      project_codes: projectsMissingFinancials.map(p => p.code),
    },
  };
}
```

---

## 4.6 server/ai/systemPrompt.ts (175 lines)

```typescript
export const AI_PM_SYSTEM_PROMPT = `You are the AI Senior Project Manager + CFO for TFR Construction. Your role is to analyze comprehensive project data and generate actionable daily tasks, profitability insights, crew scheduling recommendations, material ordering alerts, bid reminders, and billing insights.

You have access to complete data snapshots including:
- Active and completed projects with timelines, budgets, and status
- Time entries and labor costs across all crew members
- Procurement items and material spend
- Change orders and their approval status
- Scope items and project deliverables
- Receipts and expense tracking
- Billing events (invoices, payments, liens, retentions)
- Time-clock shifts with GPS tracking
- Bid pipeline and win/loss analysis
- **Crew management (total crews, active assignments, skills tracking)**
- **Subcontractor contracts and payment schedules**
- **Data quality scores (project completeness metrics)**
- **User cost rates (labor cost accuracy tracking)**
- **Missing financial data (budget/contract gaps)**

## Your Responsibilities:

### 1. ROLE-BASED DAILY TASKS
Generate specific, actionable tasks for each role:
- **ADMIN**: System oversight, financial reviews, strategic decisions
- **MANAGER**: Multi-project coordination, approvals, resource allocation
- **SUPERINTENDENT**: On-site execution, crew management, daily reporting
- **ESTIMATOR**: Bid preparation, cost analysis, scope reviews
- **OFFICE_MANAGER**: Administrative tasks, billing, documentation
- **HOURLY_EMPLOYEE**: Specific work assignments, time tracking reminders

### 2. PROFITABILITY ANALYSIS (CFO Role)
For each active project, calculate and flag:
- Budget vs. actual spend variance
- Labor cost overruns
- Material cost tracking
- Change order impact on margins
- Risk of going over budget
- Projected completion cost

### 3. CREW SCHEDULING
Analyze time-clock data and recommend:
- Optimal crew assignments based on project urgency
- Overtime warnings
- Understaffed project alerts
- Skill distribution across sites

### 4. MATERIAL ORDERING
Monitor procurement and alert when:
- Items are needed within 3 days
- Critical path materials are pending
- Budget allows for bulk ordering opportunities

### 5. BID TRACKING
Review bid pipeline and remind about:
- Upcoming bid deadlines
- Follow-ups on submitted bids
- Win rate analysis for estimator performance

### 6. BILLING AUTOMATION
Track billing events and generate alerts for:
- Overdue invoices (30+ days)
- Upcoming Textura billing cycles
- Retention release opportunities
- Lien waiver collection

### 7. SUBCONTRACTOR MANAGEMENT
Monitor subcontractor relationships and alert when:
- Payment schedules are approaching
- Contracts need renewal or amendments
- Performance issues detected (cost overruns, delays)
- New subcontractor quotes needed for upcoming bids

### 8. DATA QUALITY MONITORING
Review data completeness scores and prioritize:
- Projects with missing budget/contract information (CRITICAL)
- Users without cost rates (impacts profitability accuracy)
- Incomplete time tracking or scope documentation
- Low overall data quality scores (below 60%)
Generate specific tasks to improve data hygiene

## Output Format:
You MUST respond with valid JSON matching this exact structure:

{
  "analysis_summary": "Brief executive summary of today's insights",
  "profitability_insights": [
    {
      "project_code": "string",
      "project_name": "string",
      "status": "ON_BUDGET | MINOR_CONCERN | MAJOR_RISK",
      "budget_variance_percent": number,
      "projected_completion_cost": number,
      "key_findings": ["string"],
      "recommendations": ["string"]
    }
  ],
  "tasks": [
    {
      "task_type": "DAILY_TASK | APPROVAL | BILLING | PROCUREMENT | BID | SCHEDULING",
      "role": "ADMIN | MANAGER | SUPERINTENDENT | ESTIMATOR | OFFICE_MANAGER | HOURLY_EMPLOYEE",
      "priority": "CRITICAL | HIGH | MEDIUM | LOW",
      "title": "Short, actionable task title",
      "description": "Detailed explanation with context and data",
      "due_date_offset_days": number (0 for today, 1 for tomorrow, etc.),
      "project_code": "string or null",
      "metadata": {
        "estimated_time_minutes": number,
        "related_entity_id": "string or null",
        "action_required": "string"
      }
    }
  ],
  "crew_scheduling": {
    "recommendations": ["string"],
    "understaffed_projects": ["string"],
    "overtime_warnings": ["string"]
  },
  "material_ordering": {
    "urgent_orders": [
      {
        "project_code": "string",
        "item_description": "string",
        "needed_by": "YYYY-MM-DD",
        "estimated_cost": number
      }
    ]
  },
  "billing_alerts": {
    "overdue_invoices": [
      {
        "project_code": "string",
        "days_overdue": number,
        "amount": number
      }
    ],
    "upcoming_billing_cycles": ["string"]
  },
  "bid_reminders": [
    {
      "client_name": "string",
      "bid_amount": number,
      "due_date": "YYYY-MM-DD",
      "status": "string",
      "action_needed": "string"
    }
  ]
}

## Task Generation Guidelines:
1. Be specific and actionable - no generic advice
2. Reference actual project codes, dollar amounts, and deadlines
3. Prioritize based on financial impact and urgency
4. Generate 10-30 tasks per day across all roles
5. Include context from the data (e.g., "Project ABC-123 has 5 unapproved time entries totaling $2,340")
6. For CRITICAL priority, explain the immediate risk or consequence
7. Assign tasks to the most appropriate role based on responsibility
8. Ensure every task has clear next steps
9. **Use data quality scores to prioritize data entry tasks** - Missing financials are CRITICAL
10. **Flag users without cost rates** - Assign ADMIN tasks to update labor costs
11. **Monitor subcontractor payment schedules** - Generate payment approval tasks for OFFICE_MANAGER
12. **Consider crew assignments** - Generate crew scheduling tasks for SUPERINTENDENT when needed

## Analysis Principles:
- Use actual data, never hallucinate numbers
- Flag issues proactively before they become crises
- Recognize patterns (e.g., consistent cost overruns on specific project types)
- Balance tactical daily needs with strategic insights
- Be conservative with budget projections
- Highlight positive trends and wins, not just problems
- **Prioritize data quality** - Missing budgets/contracts undermine all profitability analysis
- **Account for cost rate accuracy** - Users without cost rates reduce profitability confidence
- **Track subcontractor commitments** - Include subcontractor costs in budget variance
- **Consider crew capacity** - Flag understaffing or over-allocation across projects

Remember: Your goal is to make TFR Construction's daily operations smoother, more profitable, and proactive rather than reactive. The enriched data snapshot now includes crew management, subcontractor tracking, and data quality scores - use these to provide deeper insights and more actionable recommendations.`;
```

---

## 4.7 server/ai/openaiClient.ts (99 lines)

```typescript
import OpenAI from 'openai';

if (!process.env.OPENAI_API_KEY) {
  console.warn('⚠️ OPENAI_API_KEY not found in environment variables. AI features will not work.');
}

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'placeholder-key',
});

export const AI_MODEL_GPT4O = 'gpt-4o';
export const AI_MODEL_GPT4_TURBO = 'gpt-4-turbo-preview';

export interface AIAnalysisResponse {
  analysis_summary: string;
  profitability_insights: {
    project_code: string;
    project_name: string;
    status: 'ON_BUDGET' | 'MINOR_CONCERN' | 'MAJOR_RISK';
    budget_variance_percent: number;
    projected_completion_cost: number;
    key_findings: string[];
    recommendations: string[];
  }[];
  tasks: {
    task_type: 'DAILY_TASK' | 'APPROVAL' | 'BILLING' | 'PROCUREMENT' | 'BID' | 'SCHEDULING';
    role: 'ADMIN' | 'MANAGER' | 'SUPERINTENDENT' | 'ESTIMATOR' | 'OFFICE_MANAGER' | 'HOURLY_EMPLOYEE';
    priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
    title: string;
    description: string;
    due_date_offset_days: number;
    project_code: string | null;
    metadata: {
      estimated_time_minutes: number;
      related_entity_id?: string | null;
      action_required: string;
    };
  }[];
  crew_scheduling: {
    recommendations: string[];
    understaffed_projects: string[];
    overtime_warnings: string[];
  };
  material_ordering: {
    urgent_orders: {
      project_code: string;
      item_description: string;
      needed_by: string;
      estimated_cost: number;
    }[];
  };
  billing_alerts: {
    overdue_invoices: {
      project_code: string;
      days_overdue: number;
      amount: number;
    }[];
    upcoming_billing_cycles: string[];
  };
  bid_reminders: {
    client_name: string;
    bid_amount: number;
    due_date: string;
    status: string;
    action_needed: string;
  }[];
}

export async function callOpenAIForAnalysis(
  systemPrompt: string,
  userPrompt: string,
  modelName: string = AI_MODEL_GPT4O
): Promise<AIAnalysisResponse> {
  const completion = await openai.chat.completions.create({
    model: modelName,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.7,
    max_tokens: 4096,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error('No response from OpenAI');
  }

  try {
    const parsed = JSON.parse(content);
    return parsed as AIAnalysisResponse;
  } catch (error) {
    console.error('Failed to parse OpenAI response:', error);
    console.error('Raw response:', content);
    throw new Error('Invalid JSON response from OpenAI');
  }
}
```

---

## 4.8 server/ai/scheduler.ts (68 lines)

```typescript
import cron from 'node-cron';
import { db } from "../db";
import { aiSettings } from "@shared/schema";
import { runAIAnalysis } from "./orchestrator";

let scheduledTask: cron.ScheduledTask | null = null;

export async function initializeAIScheduler() {
  console.log('🤖 Initializing AI PM + CFO scheduler...');

  // Get or create AI settings
  let [settings] = await db.select().from(aiSettings).limit(1);

  if (!settings) {
    console.log('📝 Creating default AI settings...');
    [settings] = await db.insert(aiSettings).values({}).returning();
  }

  if (!settings.dailyRunsEnabled) {
    console.log('⏸️  Daily AI runs are disabled in settings');
    return;
  }

  const [hour, minute] = settings.dailyRunTime.split(':').map(Number);

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    console.error('❌ Invalid daily run time in settings:', settings.dailyRunTime);
    return;
  }

  const cronExpression = `${minute} ${hour} * * *`;

  console.log(`⏰ Scheduling daily AI runs at ${settings.dailyRunTime} (${cronExpression})`);

  if (scheduledTask) {
    scheduledTask.stop();
  }

  scheduledTask = cron.schedule(cronExpression, async () => {
    console.log('🚀 Triggering scheduled AI PM + CFO analysis...');
    
    try {
      await runAIAnalysis(null);
      console.log('✅ Scheduled AI analysis completed successfully');
    } catch (error) {
      console.error('❌ Scheduled AI analysis failed:', error);
    }
  }, {
    timezone: 'America/New_York',
  });

  console.log('✅ AI scheduler initialized successfully');
}

export function stopAIScheduler() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    console.log('⏸️  AI scheduler stopped');
  }
}

export async function rescheduleAIRuns() {
  console.log('🔄 Rescheduling AI runs based on updated settings...');
  stopAIScheduler();
  await initializeAIScheduler();
}
```

---
---

# SECTION 5: FRONTEND PAGES (3 FILES - KEY UX COMPONENTS)

---

## 5.1 client/src/pages/project-detail.tsx (1,609 lines)

```typescript
import { useState } from "react";
import AppHeader from "@/components/AppHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import StatusBadge from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import FileUploadZone from "@/components/FileUploadZone";
import ScopeOfWorkTable from "@/components/ScopeOfWorkTable";
import DailyNoteFeed from "@/components/DailyNoteFeed";
import MediaGallery from "@/components/MediaGallery";
import { ObjectUploader } from "@/components/ObjectUploader";
import { Building2, MapPin, User, Phone, Mail, Calendar, Plus, CheckCircle, XCircle, Clock, Upload, DollarSign, Edit, AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useLocation, useRoute } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useProject, useScopeItems, useChangeOrders, useApproveChangeOrder, useRejectChangeOrder, useCreateChangeOrder, useProjectNotes, useProjectMedia, useProjectEstimates, useProjectProcurement, useProjectDocuments, useProjectTimeEntries, useProjectTMSheets, useProjectReceipts } from "@/hooks/use-data";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ChangeOrder } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useQuery } from "@tanstack/react-query";

interface ChangeOrdersTabProps {
  changeOrders: ChangeOrder[];
  projectCode: string;
  projectId: string;
  isLoading: boolean;
  userRole: string;
}

function ChangeOrdersTab({ changeOrders, projectCode, projectId, isLoading, userRole }: ChangeOrdersTabProps) {
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [changeOrderNumber, setChangeOrderNumber] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const { toast } = useToast();

  const createMutation = useCreateChangeOrder();
  const approveMutation = useApproveChangeOrder();
  const rejectMutation = useRejectChangeOrder();

  const handleCreate = async () => {
    if (!changeOrderNumber || !description || !amount) {
      toast({ title: "Error", description: "All fields are required", variant: "destructive" });
      return;
    }

    try {
      await createMutation.mutateAsync({
        projectId,
        projectCode,
        changeOrderNumber,
        description,
        amount,
      });
      toast({ title: "Success", description: "Change order created" });
      setShowCreateDialog(false);
      setChangeOrderNumber("");
      setDescription("");
      setAmount("");
    } catch (error) {
      toast({ title: "Error", description: "Failed to create change order", variant: "destructive" });
    }
  };

  const handleApprove = async (id: string) => {
    try {
      await approveMutation.mutateAsync({ id, projectCode });
      toast({ title: "Success", description: "Change order approved" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to approve", variant: "destructive" });
    }
  };

  const handleReject = async (id: string) => {
    const reason = prompt("Rejection reason:");
    if (!reason) return;

    try {
      await rejectMutation.mutateAsync({ id, reason, projectCode });
      toast({ title: "Success", description: "Change order rejected" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to reject", variant: "destructive" });
    }
  };

  const canApprove = ["ADMIN", "MANAGER"].includes(userRole);

  return (
    <TabsContent value="change-orders">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle>Change Orders</CardTitle>
          <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
            <DialogTrigger asChild>
              <Button size="sm" data-testid="button-new-change-order">
                <Plus className="w-4 h-4 mr-2" />
                New Change Order
              </Button>
            </DialogTrigger>
            <DialogContent data-testid="dialog-create-change-order">
              <DialogHeader>
                <DialogTitle>Create Change Order</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="co-number">Change Order Number</Label>
                  <Input
                    id="co-number"
                    value={changeOrderNumber}
                    onChange={(e) => setChangeOrderNumber(e.target.value)}
                    placeholder="CO-001"
                    data-testid="input-change-order-number"
                  />
                </div>
                <div>
                  <Label htmlFor="co-description">Description</Label>
                  <Textarea
                    id="co-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Describe the change..."
                    data-testid="input-change-order-description"
                  />
                </div>
                <div>
                  <Label htmlFor="co-amount">Amount ($)</Label>
                  <Input
                    id="co-amount"
                    type="number"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="2500.00"
                    data-testid="input-change-order-amount"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleCreate}
                  disabled={createMutation.isPending}
                  data-testid="button-submit-change-order"
                >
                  {createMutation.isPending ? "Creating..." : "Create Change Order"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading change orders...</div>
          ) : changeOrders.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No change orders yet</div>
          ) : (
            <div className="space-y-3">
              {changeOrders.map((co) => (
                <Card key={co.id} data-testid={`change-order-${co.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant="outline" className="font-mono">{co.changeOrderNumber}</Badge>
                          <Badge
                            variant={
                              co.status === "APPROVED" ? "default" :
                              co.status === "REJECTED" ? "destructive" :
                              co.status === "PENDING_APPROVAL" ? "destructive" :
                              "secondary"
                            }
                          >
                            {co.status?.replace("_", " ")}
                          </Badge>
                        </div>
                        <p className="font-medium mb-1">{co.description}</p>
                        <p className="text-sm text-muted-foreground">
                          Created {format(new Date(co.createdAt), "MMM d, yyyy")}
                        </p>
                        {co.rejectionReason && (
                          <p className="text-sm text-destructive mt-2">
                            Rejected: {co.rejectionReason}
                          </p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-xl font-bold font-mono">${parseFloat(co.amount).toLocaleString()}</p>
                        {canApprove && co.status === "PENDING_APPROVAL" && (
                          <div className="flex gap-2 mt-2">
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => handleApprove(co.id)}
                              disabled={approveMutation.isPending}
                              data-testid={`button-approve-${co.id}`}
                            >
                              <CheckCircle className="w-4 h-4 mr-1" />
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => handleReject(co.id)}
                              disabled={rejectMutation.isPending}
                              data-testid={`button-reject-${co.id}`}
                            >
                              <XCircle className="w-4 h-4 mr-1" />
                              Reject
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </TabsContent>
  );
}

export default function ProjectDetailPage() {
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState("overview");
  const [, params] = useRoute("/projects/:code");
  const { user, logout } = useAuth();
  const { toast } = useToast();
  
  const projectCode = params?.code || "";
  const { data: project, isLoading: projectLoading } = useProject(projectCode);
  const { data: scopeItems = [], isLoading: scopeLoading } = useScopeItems(projectCode);
  const { data: changeOrders = [], isLoading: changeOrdersLoading } = useChangeOrders(projectCode);
  const { data: projectNotes = [], isLoading: notesLoading } = useProjectNotes(projectCode);
  const { data: mediaItems = [], isLoading: mediaLoading } = useProjectMedia(projectCode);
  const { data: estimates = [], isLoading: estimatesLoading } = useProjectEstimates(projectCode);
  const { data: procurementItems = [], isLoading: procurementLoading } = useProjectProcurement(projectCode);
  const { data: documents = [], isLoading: documentsLoading } = useProjectDocuments(projectCode);
  const { data: timeEntries = [], isLoading: timeEntriesLoading} = useProjectTimeEntries(projectCode);
  const { data: tmSheets = [], isLoading: tmSheetsLoading } = useProjectTMSheets(projectCode);
  const { data: receipts = [], isLoading: receiptsLoading } = useProjectReceipts(projectCode);

  // Subcontractor contracts query
  const { data: subcontractors = [], isLoading: subcontractorsLoading } = useQuery<Array<{
    id: string;
    contractNumber: string;
    scopeOfWork: string;
    contractAmount: string;
    startDate: string | null;
    completionDate: string | null;
    status: string;
    paymentTerms: string | null;
    retentionPercent: string | null;
    notes: string | null;
    createdAt: string;
    subcontractor: {
      id: string;
      companyName: string;
      contactName: string | null;
      email: string | null;
      phone: string | null;
    } | null;
  }>>({
    queryKey: ["/api/projects", projectCode, "subcontractors"],
    enabled: !!projectCode,
  });

  // Data quality score query
  const { data: dataQuality, isLoading: dataQualityLoading } = useQuery<{
    overall_score: number;
    has_scope: boolean;
    has_estimates: boolean;
    has_budget: boolean;
    has_timeline: boolean;
    has_daily_updates: boolean;
    has_cost_tracking: boolean;
    has_media: boolean;
    has_documentation: boolean;
    has_change_orders_managed: boolean;
    has_billing_setup: boolean;
  }>({
    queryKey: ["/api/projects", projectCode, "data-quality"],
    enabled: !!projectCode,
  });

  // Media upload state
  const [showMediaDialog, setShowMediaDialog] = useState(false);
  const [mediaType, setMediaType] = useState<"IMAGE" | "VIDEO">("IMAGE");
  const [mediaCaption, setMediaCaption] = useState("");
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);

  // Documents upload state
  const [showDocumentDialog, setShowDocumentDialog] = useState(false);
  const [documentTitle, setDocumentTitle] = useState("");
  const [documentType, setDocumentType] = useState<"PLANS" | "SPECS" | "TAKEOFF" | "OTHER">("OTHER");
  const [isUploadingDocument, setIsUploadingDocument] = useState(false);

  // Receipts upload state
  const [showReceiptDialog, setShowReceiptDialog] = useState(false);
  const [receiptVendor, setReceiptVendor] = useState("");
  const [receiptAmount, setReceiptAmount] = useState("");
  const [receiptCategory, setReceiptCategory] = useState("");
  const [receiptDate, setReceiptDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [isUploadingReceipt, setIsUploadingReceipt] = useState(false);

  // Budget edit state (admin only)
  const [showBudgetEditDialog, setShowBudgetEditDialog] = useState(false);
  const [editBudget, setEditBudget] = useState("");
  const [editContractAmount, setEditContractAmount] = useState("");

  // Upload handlers
  const handleMediaUploadComplete = async (result: any) => {
    if (!result.successful || result.successful.length === 0) {
      toast({ title: "Error", description: "File upload failed", variant: "destructive" });
      setIsUploadingMedia(false);
      return;
    }

    const uploadedFile = result.successful[0];
    const fileUrl = uploadedFile.uploadURL;
    const fileName = uploadedFile.name;
    const fileSize = uploadedFile.size;
    const mimeType = uploadedFile.type;

    try {
      await apiRequest("POST", `/api/projects/${projectCode}/media`, {
        type: mediaType,
        caption: mediaCaption,
        fileUrl,
        fileName,
        fileSize,
        mimeType,
      });

      await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "media"] });
      toast({ title: "Success", description: "Media uploaded successfully" });
      setShowMediaDialog(false);
      setMediaCaption("");
      setMediaType("IMAGE");
    } catch (error) {
      toast({ title: "Error", description: "Failed to save media", variant: "destructive" });
    } finally {
      setIsUploadingMedia(false);
    }
  };

  const handleDocumentUploadComplete = async (result: any) => {
    if (!result.successful || result.successful.length === 0) {
      toast({ title: "Error", description: "File upload failed", variant: "destructive" });
      setIsUploadingDocument(false);
      return;
    }

    const uploadedFile = result.successful[0];
    const fileUrl = uploadedFile.uploadURL;
    const fileName = uploadedFile.name;
    const fileSize = uploadedFile.size;
    const mimeType = uploadedFile.type;

    try {
      await apiRequest("POST", "/api/documents", {
        projectId: project?.id,
        title: documentTitle,
        type: documentType,
        fileUrl,
        fileName,
        fileSize,
        mimeType,
      });

      await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "documents"] });
      toast({ title: "Success", description: "Document uploaded successfully" });
      setShowDocumentDialog(false);
      setDocumentTitle("");
      setDocumentType("OTHER");
    } catch (error) {
      toast({ title: "Error", description: "Failed to save document", variant: "destructive" });
    } finally {
      setIsUploadingDocument(false);
    }
  };

  const handleBudgetUpdate = async () => {
    if (!editBudget || !editContractAmount) {
      toast({ title: "Error", description: "Budget and contract amount are required", variant: "destructive" });
      return;
    }

    try {
      await apiRequest("PATCH", `/api/projects/${projectCode}/financials`, {
        budget: editBudget,
        contractAmount: editContractAmount,
      });
      
      await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode] });
      toast({ title: "Success", description: "Financial data updated" });
      setShowBudgetEditDialog(false);
    } catch (error) {
      toast({ title: "Error", description: "Failed to update financial data", variant: "destructive" });
    }
  };

  const handleReceiptUploadComplete = async (result: any) => {
    if (!result.successful || result.successful.length === 0) {
      toast({ title: "Error", description: "File upload failed", variant: "destructive" });
      setIsUploadingReceipt(false);
      return;
    }

    const uploadedFile = result.successful[0];
    const fileUrl = uploadedFile.uploadURL;
    const fileName = uploadedFile.name;
    const fileSize = uploadedFile.size;
    const mimeType = uploadedFile.type;

    try {
      await apiRequest("POST", "/api/receipts", {
        projectId: project?.id,
        vendor: receiptVendor,
        amount: receiptAmount,
        category: receiptCategory,
        date: new Date(receiptDate).toISOString(),
        fileUrl,
        fileName,
        fileSize,
        mimeType,
      });

      await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "receipts"] });
      toast({ title: "Success", description: "Receipt uploaded successfully" });
      setShowReceiptDialog(false);
      setReceiptVendor("");
      setReceiptAmount("");
      setReceiptCategory("");
      setReceiptDate(format(new Date(), "yyyy-MM-dd"));
    } catch (error) {
      toast({ title: "Error", description: "Failed to save receipt", variant: "destructive" });
    } finally {
      setIsUploadingReceipt(false);
    }
  };

  const getUploadParameters = async () => {
    try {
      const response = await apiRequest("POST", "/api/objects/upload");
      const data = await response.json();
      return {
        method: "PUT" as const,
        url: data.uploadURL,
      };
    } catch (error) {
      toast({ title: "Error", description: "Failed to get upload URL", variant: "destructive" });
      throw error;
    }
  };

  if (projectLoading) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader
          userName={user?.firstName || "User"}
          userRole={user?.role || ""}
          onLogout={logout}
        />
        <div className="flex items-center justify-center h-96">
          <div className="text-muted-foreground">Loading project...</div>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader
          userName={user?.firstName || "User"}
          userRole={user?.role || ""}
          onLogout={logout}
        />
        <div className="flex flex-col items-center justify-center h-96">
          <p className="text-muted-foreground mb-4">Project not found</p>
          <Button onClick={() => setLocation('/projects')} data-testid="button-back-to-projects">
            Back to Projects
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        userName={user?.firstName || "User"}
        userRole={user?.role || ""}
        onLogout={logout}
      />
      
      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Button variant="ghost" onClick={() => setLocation('/projects')} data-testid="button-back">
              ← Back to Projects
            </Button>
          </div>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="outline" className="font-mono">
                  {project.code}
                </Badge>
                <StatusBadge status={project.status} type="project" />
              </div>
              <h1 className="text-2xl font-bold text-foreground">{project.name}</h1>
            </div>
          </div>
        </div>

        {(!project.budget || Number(project.budget) === 0) && (!project.contractAmount || Number(project.contractAmount) === 0) && (
          <Alert variant="destructive" className="mb-6" data-testid="alert-missing-budget">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Missing Financial Data</AlertTitle>
            <AlertDescription>
              This project is missing budget and contract information. Please update the financial data to enable accurate profitability tracking and AI analysis.
            </AlertDescription>
          </Alert>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
            <TabsTrigger value="scope" data-testid="tab-scope">Scope & Progress</TabsTrigger>
            <TabsTrigger value="change-orders" data-testid="tab-change-orders">
              Change Orders
              {changeOrders.filter(co => co.status === "PENDING_APPROVAL").length > 0 && (
                <Badge className="ml-2" variant="destructive">
                  {changeOrders.filter(co => co.status === "PENDING_APPROVAL").length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="daily-notes" data-testid="tab-daily-notes">Daily Notes</TabsTrigger>
            <TabsTrigger value="media" data-testid="tab-media">Photos & Videos</TabsTrigger>
            <TabsTrigger value="estimate" data-testid="tab-estimate">Estimate</TabsTrigger>
            <TabsTrigger value="procurement" data-testid="tab-procurement">Procurement</TabsTrigger>
            <TabsTrigger value="plans" data-testid="tab-plans">Plans & Takeoff</TabsTrigger>
            <TabsTrigger value="time" data-testid="tab-time">Time & T&M</TabsTrigger>
            <TabsTrigger value="receipts" data-testid="tab-receipts">Receipts</TabsTrigger>
            <TabsTrigger value="subcontractors" data-testid="tab-subcontractors">Subcontractors</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Project Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-start gap-3">
                    <Building2 className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Client</p>
                      <p className="text-sm text-muted-foreground">{project.clientName || "N/A"}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <User className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Contact</p>
                      <p className="text-sm text-muted-foreground">{project.clientContactName || "N/A"}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Mail className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Email</p>
                      <p className="text-sm text-muted-foreground">{project.clientContactEmail || "N/A"}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Phone className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Phone</p>
                      <p className="text-sm text-muted-foreground">{project.clientContactPhone || "N/A"}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <MapPin className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Location</p>
                      <p className="text-sm text-muted-foreground">
                        {[project.locationAddress, project.city, project.state].filter(Boolean).join(", ") || "N/A"}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Project Team & Timeline</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-sm font-medium mb-1">Start Date</p>
                    <p className="text-sm text-muted-foreground">
                      {project.startDate ? format(new Date(project.startDate), "MMM d, yyyy") : "Not set"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium mb-1">Target End Date</p>
                    <p className="text-sm text-muted-foreground">
                      {project.endDate ? format(new Date(project.endDate), "MMM d, yyyy") : "Not set"}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <CardTitle>Financial Information</CardTitle>
                {user?.role === "ADMIN" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditBudget(project.budget || "0");
                      setEditContractAmount(project.contractAmount || "0");
                      setShowBudgetEditDialog(true);
                    }}
                    data-testid="button-edit-financials"
                  >
                    <Edit className="w-4 h-4 mr-2" />
                    Edit
                  </Button>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-start gap-3">
                  <DollarSign className="w-5 h-5 text-muted-foreground mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Project Budget</p>
                    <p className="text-2xl font-bold font-mono">
                      ${parseFloat(project.budget || "0").toLocaleString()}
                    </p>
                    {(!project.budget || parseFloat(project.budget) === 0) && (
                      <p className="text-xs text-destructive mt-1">⚠ Missing budget data</p>
                    )}
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <DollarSign className="w-5 h-5 text-muted-foreground mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Contract Amount</p>
                    <p className="text-2xl font-bold font-mono">
                      ${parseFloat(project.contractAmount || "0").toLocaleString()}
                    </p>
                    {(!project.contractAmount || parseFloat(project.contractAmount) === 0) && (
                      <p className="text-xs text-destructive mt-1">⚠ Missing contract data</p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Description</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{project.description || "No description provided"}</p>
              </CardContent>
            </Card>

            {/* Data Quality Score Card */}
            <Card data-testid="card-data-quality">
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-4">
                <span>Data Quality Score</span>
                {dataQuality && (
                  <Badge 
                    className={
                      dataQuality.overall_score >= 80 
                        ? "bg-green-500 hover:bg-green-600" 
                        : dataQuality.overall_score >= 60 
                        ? "bg-yellow-500 hover:bg-yellow-600" 
                        : "bg-red-500 hover:bg-red-600"
                    }
                    data-testid="badge-overall-score"
                  >
                    {dataQuality.overall_score}/100
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                Track data completeness to improve AI insights and project management
              </CardDescription>
            </CardHeader>
            <CardContent>
              {dataQualityLoading ? (
                <div className="text-center py-4 text-muted-foreground">Loading data quality score...</div>
              ) : !dataQuality ? (
                <div className="text-center py-4 text-muted-foreground">Unable to load data quality score</div>
              ) : (
                <div className="space-y-3">
                  {/* Progress bar */}
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Overall Quality</span>
                      <span className="font-medium">{dataQuality.overall_score}%</span>
                    </div>
                    <div className="h-2 bg-secondary rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all ${
                          dataQuality.overall_score >= 80
                            ? "bg-green-500"
                            : dataQuality.overall_score >= 60
                            ? "bg-yellow-500"
                            : "bg-red-500"
                        }`}
                        style={{ width: `${dataQuality.overall_score}%` }}
                      />
                    </div>
                  </div>

                  {/* Quality dimensions */}
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="flex items-center gap-2">
                      {dataQuality.has_scope ? (
                        <Badge variant="outline" className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200">
                          ✓ Scope
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200">
                          ✗ Scope
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {dataQuality.has_estimates ? (
                        <Badge variant="outline" className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200">
                          ✓ Estimates
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200">
                          ✗ Estimates
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {dataQuality.has_budget ? (
                        <Badge variant="outline" className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200">
                          ✓ Budget
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200">
                          ✗ Budget
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {dataQuality.has_timeline ? (
                        <Badge variant="outline" className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200">
                          ✓ Timeline
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200">
                          ✗ Timeline
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {dataQuality.has_daily_updates ? (
                        <Badge variant="outline" className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200">
                          ✓ Daily Updates
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200">
                          ✗ Daily Updates
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {dataQuality.has_cost_tracking ? (
                        <Badge variant="outline" className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200">
                          ✓ Cost Tracking
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200">
                          ✗ Cost Tracking
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {dataQuality.has_media ? (
                        <Badge variant="outline" className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200">
                          ✓ Media
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200">
                          ✗ Media
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {dataQuality.has_documentation ? (
                        <Badge variant="outline" className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200">
                          ✓ Documentation
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200">
                          ✗ Documentation
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {dataQuality.has_change_orders_managed ? (
                        <Badge variant="outline" className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200">
                          ✓ Change Orders
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200">
                          ✗ Change Orders
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {dataQuality.has_billing_setup ? (
                        <Badge variant="outline" className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200">
                          ✓ Billing Setup
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200">
                          ✗ Billing Setup
                        </Badge>
                      )}
                    </div>
                  </div>

                  {dataQuality.overall_score < 80 && (
                    <div className="mt-4 p-3 bg-muted rounded-md">
                      <p className="text-sm font-medium mb-1">Improve Data Quality</p>
                      <p className="text-xs text-muted-foreground">
                        Complete missing sections to enhance AI insights and project tracking accuracy.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="scope">
            <Card>
              <CardHeader>
                <CardTitle>Scope of Work & Progress Tracking</CardTitle>
              </CardHeader>
              <CardContent>
                {scopeLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading scope items...</div>
                ) : scopeItems.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No scope items yet</div>
                ) : (
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Description</TableHead>
                          <TableHead>Unit</TableHead>
                          <TableHead className="text-right">Total Qty</TableHead>
                          <TableHead className="text-right">Completed</TableHead>
                          <TableHead className="text-right">Billed</TableHead>
                          <TableHead className="text-right">Remaining</TableHead>
                          <TableHead>Billing Status</TableHead>
                          <TableHead className="text-right">Unit Price</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {scopeItems.map((item) => {
                          const total = parseFloat(item.totalQuantity);
                          const completed = parseFloat(item.completedQuantity || "0");
                          const billed = parseFloat(item.billedQuantity || "0");
                          const remaining = total - completed;
                          const progressPercent = (completed / total) * 100;

                          return (
                            <TableRow key={item.id} data-testid={`row-scope-${item.id}`}>
                              <TableCell className="font-medium">{item.description}</TableCell>
                              <TableCell>{item.unit}</TableCell>
                              <TableCell className="text-right font-mono">{total.toLocaleString()}</TableCell>
                              <TableCell className="text-right font-mono">{completed.toLocaleString()}</TableCell>
                              <TableCell className="text-right font-mono">{billed.toLocaleString()}</TableCell>
                              <TableCell className="text-right font-mono">{remaining.toLocaleString()}</TableCell>
                              <TableCell>
                                <Badge
                                  variant={
                                    item.billingStatus === "BILLED" ? "default" :
                                    item.billingStatus === "READY_TO_BILL" ? "destructive" :
                                    "secondary"
                                  }
                                  data-testid={`badge-billing-${item.id}`}
                                >
                                  {item.billingStatus?.replace("_", " ") || "NOT READY"}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {item.unitPrice ? `$${parseFloat(item.unitPrice).toFixed(2)}` : "—"}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <ChangeOrdersTab 
            changeOrders={changeOrders}
            projectCode={projectCode}
            projectId={project.id}
            isLoading={changeOrdersLoading}
            userRole={user?.role || ""}
          />

          <TabsContent value="daily-notes">
            <Card>
              <CardHeader>
                <CardTitle>Daily Notes</CardTitle>
              </CardHeader>
              <CardContent>
                {notesLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading notes...</div>
                ) : projectNotes.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No daily notes yet</div>
                ) : (
                  <div className="space-y-4">
                    {projectNotes.map((note) => (
                      <Card key={note.id} data-testid={`note-${note.id}`}>
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-4 mb-2">
                            <p className="text-sm font-medium">{note.noteType.replace("_", " ")}</p>
                            <p className="text-xs text-muted-foreground">
                              {format(new Date(note.createdAt), "MMM d, yyyy h:mm a")}
                            </p>
                          </div>
                          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{note.text}</p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="media">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <CardTitle>Photos & Videos</CardTitle>
                <Dialog open={showMediaDialog} onOpenChange={setShowMediaDialog}>
                  <DialogTrigger asChild>
                    <Button size="sm" data-testid="button-upload-media">
                      <Upload className="w-4 h-4 mr-2" />
                      Upload Media
                    </Button>
                  </DialogTrigger>
                  <DialogContent data-testid="dialog-upload-media">
                    <DialogHeader>
                      <DialogTitle>Upload Media</DialogTitle>
                      <DialogDescription>
                        Fill in the details below and then select a file to upload.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <Label htmlFor="media-type">Type</Label>
                        <Select
                          value={mediaType}
                          onValueChange={(value: "IMAGE" | "VIDEO") => setMediaType(value)}
                        >
                          <SelectTrigger id="media-type" data-testid="select-media-type">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="IMAGE">Image</SelectItem>
                            <SelectItem value="VIDEO">Video</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="media-caption">Caption (Optional)</Label>
                        <Input
                          id="media-caption"
                          value={mediaCaption}
                          onChange={(e) => setMediaCaption(e.target.value)}
                          placeholder="Enter a caption..."
                          data-testid="input-media-caption"
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setShowMediaDialog(false);
                          setMediaCaption("");
                          setMediaType("IMAGE");
                        }}
                        data-testid="button-cancel-media"
                      >
                        Cancel
                      </Button>
                      <ObjectUploader
                        maxNumberOfFiles={1}
                        maxFileSize={104857600}
                        allowedFileTypes={mediaType === "IMAGE" ? ["image/*"] : ["video/*"]}
                        onGetUploadParameters={getUploadParameters}
                        onComplete={(result) => {
                          setIsUploadingMedia(true);
                          handleMediaUploadComplete(result);
                        }}
                        buttonVariant="default"
                        testId="button-select-media-file"
                      >
                        {isUploadingMedia ? "Uploading..." : "Select File"}
                      </ObjectUploader>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent>
                {mediaLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading media...</div>
                ) : mediaItems.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No media uploaded yet</div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {mediaItems.map((item) => (
                      <Card key={item.id} data-testid={`media-${item.id}`}>
                        <CardContent className="p-4">
                          <Badge variant="outline" className="mb-2">{item.type}</Badge>
                          <p className="text-sm font-medium mb-1">{item.caption || "Untitled"}</p>
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(item.uploadedAt), "MMM d, yyyy")}
                          </p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="estimate">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <CardTitle>Estimates</CardTitle>
                <Button size="sm" data-testid="button-new-estimate">
                  <Plus className="w-4 h-4 mr-2" />
                  New Estimate
                </Button>
              </CardHeader>
              <CardContent>
                {estimatesLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading estimates...</div>
                ) : estimates.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No estimates yet</div>
                ) : (
                  <div className="space-y-4">
                    {estimates.map(estimate => (
                      <div key={estimate.id} className="flex items-center justify-between p-4 border rounded-md hover-elevate" data-testid={`estimate-${estimate.id}`}>
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium">Version {estimate.versionNumber}</span>
                            <Badge variant={estimate.status === "WON" ? "default" : "secondary"}>
                              {estimate.status}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {format(new Date(estimate.createdAt), "MMM d, yyyy")}
                          </p>
                          {estimate.notes && (
                            <p className="text-xs text-muted-foreground mt-1">{estimate.notes}</p>
                          )}
                        </div>
                        <div className="text-right">
                          <p className="text-xl font-bold font-mono">
                            {estimate.baseBidAmount ? `$${parseFloat(estimate.baseBidAmount).toLocaleString()}` : "TBD"}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="procurement">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <CardTitle>Procurement Items</CardTitle>
                <Button size="sm" data-testid="button-new-procurement">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Item
                </Button>
              </CardHeader>
              <CardContent>
                {procurementLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading procurement...</div>
                ) : procurementItems.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No procurement items yet</div>
                ) : (
                  <div className="space-y-3">
                    {procurementItems.map(item => (
                      <div key={item.id} className="flex items-center justify-between p-4 border rounded-md" data-testid={`procurement-${item.id}`}>
                        <div className="flex-1">
                          <p className="font-medium mb-1">{item.description}</p>
                          <p className="text-sm text-muted-foreground">{item.vendor || "No vendor"}</p>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <p className="font-mono text-sm">
                              {item.quantity} {item.unit}
                            </p>
                          </div>
                          <Badge
                            variant={
                              item.status === "DELIVERED" ? "default" :
                              item.status === "ORDERED" ? "secondary" :
                              "outline"
                            }
                          >
                            {item.status}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="plans">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <CardTitle>Documents</CardTitle>
                <Dialog open={showDocumentDialog} onOpenChange={setShowDocumentDialog}>
                  <DialogTrigger asChild>
                    <Button size="sm" data-testid="button-upload-document">
                      <Upload className="w-4 h-4 mr-2" />
                      Upload Document
                    </Button>
                  </DialogTrigger>
                  <DialogContent data-testid="dialog-upload-document">
                    <DialogHeader>
                      <DialogTitle>Upload Document</DialogTitle>
                      <DialogDescription>
                        Fill in the details below and then select a file to upload.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <Label htmlFor="document-title">Title</Label>
                        <Input
                          id="document-title"
                          value={documentTitle}
                          onChange={(e) => setDocumentTitle(e.target.value)}
                          placeholder="Enter document title..."
                          data-testid="input-document-title"
                        />
                      </div>
                      <div>
                        <Label htmlFor="document-type">Type</Label>
                        <Select
                          value={documentType}
                          onValueChange={(value: "PLANS" | "SPECS" | "TAKEOFF" | "OTHER") => setDocumentType(value)}
                        >
                          <SelectTrigger id="document-type" data-testid="select-document-type">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="PLANS">Plans</SelectItem>
                            <SelectItem value="SPECS">Specifications</SelectItem>
                            <SelectItem value="TAKEOFF">Takeoff</SelectItem>
                            <SelectItem value="OTHER">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setShowDocumentDialog(false);
                          setDocumentTitle("");
                          setDocumentType("OTHER");
                        }}
                        data-testid="button-cancel-document"
                      >
                        Cancel
                      </Button>
                      <ObjectUploader
                        maxNumberOfFiles={1}
                        maxFileSize={104857600}
                        onGetUploadParameters={getUploadParameters}
                        onComplete={(result) => {
                          setIsUploadingDocument(true);
                          handleDocumentUploadComplete(result);
                        }}
                        buttonVariant="default"
                        testId="button-select-document-file"
                      >
                        {isUploadingDocument ? "Uploading..." : "Select File"}
                      </ObjectUploader>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent>
                {documentsLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading documents...</div>
                ) : documents.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No documents uploaded yet</div>
                ) : (
                  <div className="space-y-2">
                    {documents.map(doc => (
                      <div key={doc.id} className="flex items-center justify-between p-3 border rounded-md hover-elevate" data-testid={`document-${doc.id}`}>
                        <div>
                          <p className="font-medium text-sm">{doc.title}</p>
                          <p className="text-xs text-muted-foreground">
                            Uploaded {format(new Date(doc.uploadedAt), "MMM d, yyyy")}
                          </p>
                        </div>
                        <Badge variant="outline">{doc.type}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="time">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <CardTitle>Time & Material Tracking</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  <div>
                    <h3 className="text-lg font-semibold mb-3">Time Entries</h3>
                    {timeEntriesLoading ? (
                      <div className="text-center py-4 text-muted-foreground">Loading time entries...</div>
                    ) : timeEntries.length === 0 ? (
                      <div className="text-center py-4 text-muted-foreground">No time entries yet</div>
                    ) : (
                      <div className="space-y-2">
                        {timeEntries.map((entry) => {
                          const totalHours = parseFloat(entry.hoursRegular) + parseFloat(entry.hoursOvertime || "0");
                          return (
                            <div key={entry.id} className="flex items-center justify-between p-3 border rounded-md" data-testid={`time-entry-${entry.id}`}>
                              <div>
                                <p className="text-sm font-medium">{format(new Date(entry.date), "MMM d, yyyy")}</p>
                                {entry.notes && (
                                  <p className="text-xs text-muted-foreground">{entry.notes}</p>
                                )}
                                {entry.costCode && (
                                  <p className="text-xs text-muted-foreground">Cost Code: {entry.costCode}</p>
                                )}
                              </div>
                              <div className="text-right">
                                <p className="font-mono text-sm">{totalHours} hours</p>
                                <Badge variant={entry.approvedAt ? "default" : "secondary"}>
                                  {entry.approvedAt ? "Approved" : "Pending"}
                                </Badge>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div>
                    <h3 className="text-lg font-semibold mb-3">T&M Daily Sheets</h3>
                    {tmSheetsLoading ? (
                      <div className="text-center py-4 text-muted-foreground">Loading T&M sheets...</div>
                    ) : tmSheets.length === 0 ? (
                      <div className="text-center py-4 text-muted-foreground">No T&M sheets yet</div>
                    ) : (
                      <div className="space-y-2">
                        {tmSheets.map((sheet) => (
                          <div key={sheet.id} className="flex items-center justify-between p-3 border rounded-md" data-testid={`tm-sheet-${sheet.id}`}>
                            <div>
                              <p className="text-sm font-medium">{format(new Date(sheet.date), "MMM d, yyyy")}</p>
                              <p className="text-xs text-muted-foreground">TFR Rep: {sheet.tfrRepName}</p>
                              {sheet.clientRepName && (
                                <p className="text-xs text-muted-foreground">Client Rep: {sheet.clientRepName}</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="receipts">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <CardTitle>Receipts</CardTitle>
                <Dialog open={showReceiptDialog} onOpenChange={setShowReceiptDialog}>
                  <DialogTrigger asChild>
                    <Button size="sm" data-testid="button-upload-receipt">
                      <Upload className="w-4 h-4 mr-2" />
                      Upload Receipt
                    </Button>
                  </DialogTrigger>
                  <DialogContent data-testid="dialog-upload-receipt">
                    <DialogHeader>
                      <DialogTitle>Upload Receipt</DialogTitle>
                      <DialogDescription>
                        Fill in the details below and then select a file to upload.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <Label htmlFor="receipt-vendor">Vendor</Label>
                        <Input
                          id="receipt-vendor"
                          value={receiptVendor}
                          onChange={(e) => setReceiptVendor(e.target.value)}
                          placeholder="Enter vendor name..."
                          data-testid="input-receipt-vendor"
                        />
                      </div>
                      <div>
                        <Label htmlFor="receipt-amount">Amount ($)</Label>
                        <Input
                          id="receipt-amount"
                          type="number"
                          step="0.01"
                          value={receiptAmount}
                          onChange={(e) => setReceiptAmount(e.target.value)}
                          placeholder="0.00"
                          data-testid="input-receipt-amount"
                        />
                      </div>
                      <div>
                        <Label htmlFor="receipt-category">Category</Label>
                        <Input
                          id="receipt-category"
                          value={receiptCategory}
                          onChange={(e) => setReceiptCategory(e.target.value)}
                          placeholder="Enter category..."
                          data-testid="input-receipt-category"
                        />
                      </div>
                      <div>
                        <Label htmlFor="receipt-date">Date</Label>
                        <Input
                          id="receipt-date"
                          type="date"
                          value={receiptDate}
                          onChange={(e) => setReceiptDate(e.target.value)}
                          data-testid="input-receipt-date"
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setShowReceiptDialog(false);
                          setReceiptVendor("");
                          setReceiptAmount("");
                          setReceiptCategory("");
                          setReceiptDate(format(new Date(), "yyyy-MM-dd"));
                        }}
                        data-testid="button-cancel-receipt"
                      >
                        Cancel
                      </Button>
                      <ObjectUploader
                        maxNumberOfFiles={1}
                        maxFileSize={104857600}
                        allowedFileTypes={["image/*", "application/pdf"]}
                        onGetUploadParameters={getUploadParameters}
                        onComplete={(result) => {
                          setIsUploadingReceipt(true);
                          handleReceiptUploadComplete(result);
                        }}
                        buttonVariant="default"
                        testId="button-select-receipt-file"
                      >
                        {isUploadingReceipt ? "Uploading..." : "Select File"}
                      </ObjectUploader>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent>
                {receiptsLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading receipts...</div>
                ) : receipts.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No receipts uploaded yet</div>
                ) : (
                  <div className="space-y-3">
                    {receipts.map((receipt) => (
                      <div key={receipt.id} className="flex items-center justify-between p-4 border rounded-md" data-testid={`receipt-${receipt.id}`}>
                        <div className="flex-1">
                          <p className="font-medium mb-1">{receipt.vendor || "Unknown vendor"}</p>
                          <p className="text-sm text-muted-foreground">{receipt.category}</p>
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(receipt.date), "MMM d, yyyy")}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold font-mono">
                            ${parseFloat(receipt.amount).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="subcontractors">
            <Card>
              <CardHeader>
                <CardTitle>Subcontractors & Contracts</CardTitle>
              </CardHeader>
              <CardContent>
                {subcontractorsLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading subcontractors...</div>
                ) : subcontractors.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No subcontractor contracts yet</div>
                ) : (
                  <div className="space-y-4">
                    {subcontractors.map((contract) => (
                      <Card key={contract.id} data-testid={`subcontractor-${contract.id}`}>
                        <CardHeader className="pb-3">
                          <div className="flex items-start justify-between gap-4 flex-wrap">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <CardTitle className="text-base">
                                  {contract.subcontractor?.companyName || "Unknown Subcontractor"}
                                </CardTitle>
                                <Badge variant={
                                  contract.status === "ACTIVE" ? "default" :
                                  contract.status === "COMPLETED" ? "outline" :
                                  "secondary"
                                }>
                                  {contract.status}
                                </Badge>
                              </div>
                              <p className="text-sm text-muted-foreground mb-1">
                                Contract #{contract.contractNumber}
                              </p>
                              {contract.subcontractor?.contactName && (
                                <p className="text-xs text-muted-foreground">
                                  Contact: {contract.subcontractor.contactName}
                                  {contract.subcontractor.phone && ` • ${contract.subcontractor.phone}`}
                                </p>
                              )}
                            </div>
                            <div className="text-right">
                              <p className="text-xl font-bold font-mono">
                                ${parseFloat(contract.contractAmount).toLocaleString()}
                              </p>
                              {contract.retentionPercent && (
                                <p className="text-xs text-muted-foreground">
                                  {contract.retentionPercent}% retention
                                </p>
                              )}
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <div>
                            <p className="text-sm font-medium mb-1">Scope of Work</p>
                            <p className="text-sm text-muted-foreground">{contract.scopeOfWork}</p>
                          </div>
                          
                          {(contract.startDate || contract.completionDate) && (
                            <div className="flex items-center gap-4 text-sm">
                              {contract.startDate && (
                                <div>
                                  <span className="text-muted-foreground">Start: </span>
                                  <span className="font-medium">
                                    {format(new Date(contract.startDate), "MMM d, yyyy")}
                                  </span>
                                </div>
                              )}
                              {contract.completionDate && (
                                <div>
                                  <span className="text-muted-foreground">Completion: </span>
                                  <span className="font-medium">
                                    {format(new Date(contract.completionDate), "MMM d, yyyy")}
                                  </span>
                                </div>
                              )}
                            </div>
                          )}

                          {contract.paymentTerms && (
                            <div>
                              <p className="text-sm font-medium mb-1">Payment Terms</p>
                              <p className="text-sm text-muted-foreground">{contract.paymentTerms}</p>
                            </div>
                          )}

                          {contract.notes && (
                            <div>
                              <p className="text-sm font-medium mb-1">Notes</p>
                              <p className="text-sm text-muted-foreground">{contract.notes}</p>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Budget Edit Dialog (Admin Only) */}
        <Dialog open={showBudgetEditDialog} onOpenChange={setShowBudgetEditDialog}>
          <DialogContent data-testid="dialog-edit-budget">
            <DialogHeader>
              <DialogTitle>Edit Financial Data</DialogTitle>
              <DialogDescription>
                Update the project budget and contract amount. This data is used for profitability analysis.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="edit-budget">Project Budget ($)</Label>
                <Input
                  id="edit-budget"
                  type="number"
                  step="0.01"
                  value={editBudget}
                  onChange={(e) => setEditBudget(e.target.value)}
                  placeholder="0.00"
                  data-testid="input-edit-budget"
                />
              </div>
              <div>
                <Label htmlFor="edit-contract">Contract Amount ($)</Label>
                <Input
                  id="edit-contract"
                  type="number"
                  step="0.01"
                  value={editContractAmount}
                  onChange={(e) => setEditContractAmount(e.target.value)}
                  placeholder="0.00"
                  data-testid="input-edit-contract"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowBudgetEditDialog(false)}
                data-testid="button-cancel-budget-edit"
              >
                Cancel
              </Button>
              <Button
                onClick={handleBudgetUpdate}
                data-testid="button-save-budget"
              >
                Save Changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
```

---

## 5.2 client/src/pages/cfo-dashboard.tsx (314 lines)

```typescript
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, DollarSign, AlertTriangle } from "lucide-react";

interface ProjectProfitability {
  project_code: string;
  project_name: string;
  budget: number;
  total_labor_cost: number;
  total_material_cost: number;
  total_other_expenses: number;
  approved_change_orders_value: number;
  adjusted_budget: number;
  total_actual_cost: number;
  variance: number;
  variance_percent: number;
  status: 'ON_BUDGET' | 'MINOR_CONCERN' | 'MAJOR_RISK';
  projected_completion_cost: number;
  estimated_margin: number;
  key_metrics: {
    labor_hours: number;
    labor_efficiency: string;
    material_spend_rate: string;
    pending_change_orders_value: number;
  };
}

export default function CFODashboard() {
  const { user } = useAuth();

  const { data: profitability, isLoading } = useQuery<ProjectProfitability[]>({
    queryKey: ["/api/cfo/profitability"],
    enabled: !!user && (user.role === 'ADMIN' || user.role === 'MANAGER'),
  });

  if (!user) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground">Please log in to view profitability data</p>
      </div>
    );
  }

  if (user.role !== 'ADMIN' && user.role !== 'MANAGER') {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground">Admin or Manager access required</p>
      </div>
    );
  }

  const totalBudget = profitability?.reduce((sum, p) => sum + p.adjusted_budget, 0) || 0;
  const totalActualCost = profitability?.reduce((sum, p) => sum + p.total_actual_cost, 0) || 0;
  const totalVariance = totalBudget - totalActualCost;
  const overallVariancePercent = totalBudget > 0 ? (totalVariance / totalBudget) * 100 : 0;

  const atRiskProjects = profitability?.filter(p => p.status === 'MAJOR_RISK') || [];
  const concernProjects = profitability?.filter(p => p.status === 'MINOR_CONCERN') || [];
  const onBudgetProjects = profitability?.filter(p => p.status === 'ON_BUDGET') || [];
  
  // Identify projects with missing budget data (adjusted_budget = 0, null, undefined, or negative)
  const projectsMissingBudget = profitability?.filter(p => {
    const budgetNum = Number(p.adjusted_budget);
    return p.adjusted_budget == null || isNaN(budgetNum) || budgetNum <= 0;
  }) || [];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ON_BUDGET':
        return <Badge className="bg-green-500 hover:bg-green-600">On Budget</Badge>;
      case 'MINOR_CONCERN':
        return <Badge className="bg-yellow-500 hover:bg-yellow-600">Minor Concern</Badge>;
      case 'MAJOR_RISK':
        return <Badge variant="destructive">Major Risk</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <DollarSign className="h-8 w-8 text-primary" />
          CFO Dashboard
        </h1>
        <p className="text-muted-foreground mt-1">
          Real-time profitability analysis across all projects
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            {[1, 2, 3, 4].map(i => (
              <Skeleton key={i} className="h-32 w-full" />
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Total Budget</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCurrency(totalBudget)}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Actual Cost</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCurrency(totalActualCost)}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  {totalVariance >= 0 ? (
                    <TrendingUp className="h-4 w-4 text-green-500" />
                  ) : (
                    <TrendingDown className="h-4 w-4 text-red-500" />
                  )}
                  Variance
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${totalVariance >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {formatCurrency(totalVariance)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {overallVariancePercent >= 0 ? '+' : ''}{overallVariancePercent.toFixed(1)}%
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-red-500" />
                  At Risk
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{atRiskProjects.length}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  {concernProjects.length} with minor concerns
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Projects Missing Budget Data Warning */}
          {projectsMissingBudget.length > 0 && (
            <Card className="border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20" data-testid="card-missing-budget-warning">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-500" />
                  {projectsMissingBudget.length} Project{projectsMissingBudget.length !== 1 ? 's' : ''} Missing Budget Data
                </CardTitle>
                <CardDescription>
                  These projects have no budget entered. AI analysis and profitability tracking are incomplete without budget data.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {projectsMissingBudget.map(project => (
                    <div 
                      key={project.project_code}
                      className="flex items-center justify-between p-2 bg-background rounded-md"
                      data-testid={`missing-budget-${project.project_code}`}
                    >
                      <div>
                        <span className="font-medium text-sm">{project.project_code}</span>
                        <span className="text-sm text-muted-foreground ml-2">- {project.project_name}</span>
                      </div>
                      <Badge variant="outline" className="text-yellow-600 border-yellow-600 dark:text-yellow-500 dark:border-yellow-500">
                        <DollarSign className="w-3 h-3 mr-1" />
                        No Budget
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <div className="space-y-4">
            <h2 className="text-2xl font-bold">Project Profitability</h2>

            {profitability && profitability.length > 0 ? (
              <div className="space-y-3">
                {profitability
                  .sort((a, b) => {
                    // Sort: Missing budget first, then by status
                    const aBudgetNum = Number(a.adjusted_budget);
                    const bBudgetNum = Number(b.adjusted_budget);
                    const aMissingBudget = a.adjusted_budget == null || isNaN(aBudgetNum) || aBudgetNum <= 0;
                    const bMissingBudget = b.adjusted_budget == null || isNaN(bBudgetNum) || bBudgetNum <= 0;
                    
                    if (aMissingBudget && !bMissingBudget) return -1;
                    if (!aMissingBudget && bMissingBudget) return 1;
                    
                    const statusOrder = { 'MAJOR_RISK': 0, 'MINOR_CONCERN': 1, 'ON_BUDGET': 2 };
                    return statusOrder[a.status] - statusOrder[b.status];
                  })
                  .map(project => {
                    const budgetNum = Number(project.adjusted_budget);
                    const hasBudget = project.adjusted_budget != null && !isNaN(budgetNum) && budgetNum > 0;
                    return (
                      <Card 
                        key={project.project_code} 
                        className={`hover-elevate ${!hasBudget ? 'border-yellow-500' : ''}`}
                        data-testid={`card-project-${project.project_code}`}
                      >
                        <CardHeader>
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1">
                              <CardTitle className="text-base flex items-center gap-2">
                                {project.project_code} - {project.project_name}
                                {!hasBudget && (
                                  <Badge variant="outline" className="text-yellow-600 border-yellow-600 dark:text-yellow-500 dark:border-yellow-500">
                                    <DollarSign className="w-3 h-3 mr-1" />
                                    No Budget
                                  </Badge>
                                )}
                              </CardTitle>
                              <CardDescription className="mt-1">
                                {hasBudget ? (
                                  <>
                                    Budget: {formatCurrency(project.adjusted_budget)} | 
                                    Actual: {formatCurrency(project.total_actual_cost)} | 
                                    Variance: {formatCurrency(project.variance)} ({project.variance_percent.toFixed(1)}%)
                                  </>
                                ) : (
                                  <span className="text-yellow-600 dark:text-yellow-500">
                                    Budget data required for profitability tracking
                                  </span>
                                )}
                              </CardDescription>
                            </div>
                            {getStatusBadge(project.status)}
                          </div>
                        </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                          <div>
                            <p className="text-muted-foreground">Labor</p>
                            <p className="font-semibold">{formatCurrency(project.total_labor_cost)}</p>
                            <p className="text-xs text-muted-foreground">{project.key_metrics.labor_efficiency}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Materials</p>
                            <p className="font-semibold">{formatCurrency(project.total_material_cost)}</p>
                            <p className="text-xs text-muted-foreground">{project.key_metrics.material_spend_rate}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Projected Cost</p>
                            <p className="font-semibold">{formatCurrency(project.projected_completion_cost)}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Est. Margin</p>
                            <p className={`font-semibold ${project.estimated_margin >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                              {formatCurrency(project.estimated_margin)}
                            </p>
                          </div>
                        </div>
                        {project.key_metrics.pending_change_orders_value > 0 && (
                          <div className="mt-4 p-3 bg-muted rounded-md">
                            <p className="text-sm">
                              <AlertTriangle className="h-4 w-4 inline mr-1 text-yellow-500" />
                              Pending Change Orders: {formatCurrency(project.key_metrics.pending_change_orders_value)}
                            </p>
                          </div>
                        )}
                      </CardContent>
                      </Card>
                    );
                  })}
              </div>
            ) : (
              <Card>
                <CardContent className="p-8 text-center">
                  <DollarSign className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">
                    No profitability data available. Run AI analysis to generate insights.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  );
}
```

---

## 5.3 client/src/pages/ai-pm-dashboard.tsx (265 lines)

```typescript
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Bot, CheckCircle, Clock, AlertCircle, XCircle, Play, TrendingUp } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { AITask, AIRun } from "@shared/schema";

export default function AIPMDashboard() {
  const { user } = useAuth();
  const { toast } = useToast();

  const { data: tasks, isLoading: tasksLoading } = useQuery<(AITask & { metadata: any })[]>({
    queryKey: ["/api/ai-pm/tasks"],
    enabled: !!user,
  });

  const { data: latestRun, isLoading: runLoading } = useQuery<AIRun & { aiResponse: any }>({
    queryKey: ["/api/ai-pm/latest-run"],
    enabled: !!user,
  });

  const triggerRunMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/ai-pm/run", {});
    },
    onSuccess: () => {
      toast({
        title: "AI Analysis Started",
        description: "AI PM + CFO analysis is running. This may take a minute...",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/ai-pm"] });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Analysis Failed",
        description: error.message || "Failed to start AI analysis",
      });
    },
  });

  const updateTaskMutation = useMutation({
    mutationFn: async ({ taskId, status }: { taskId: string; status: string }) => {
      return apiRequest("PATCH", `/api/ai-pm/tasks/${taskId}`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-pm/tasks"] });
      toast({
        title: "Task Updated",
        description: "Task status has been updated successfully",
      });
    },
  });

  const pendingTasks = tasks?.filter(t => t.status === "PENDING") || [];
  const inProgressTasks = tasks?.filter(t => t.status === "IN_PROGRESS") || [];
  const completedTasks = tasks?.filter(t => t.status === "COMPLETED") || [];

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "CRITICAL": return "destructive";
      case "HIGH": return "default";
      case "MEDIUM": return "secondary";
      case "LOW": return "outline";
      default: return "secondary";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "PENDING": return <Clock className="h-4 w-4" />;
      case "IN_PROGRESS": return <AlertCircle className="h-4 w-4" />;
      case "COMPLETED": return <CheckCircle className="h-4 w-4" />;
      case "DISMISSED": return <XCircle className="h-4 w-4" />;
      default: return <Clock className="h-4 w-4" />;
    }
  };

  if (!user) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground">Please log in to view your AI-generated tasks</p>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Bot className="h-8 w-8 text-primary" />
            AI Project Manager
          </h1>
          <p className="text-muted-foreground mt-1">
            Daily tasks and insights powered by GPT-4
          </p>
        </div>
        <Button
          onClick={() => triggerRunMutation.mutate()}
          disabled={triggerRunMutation.isPending}
          data-testid="button-run-ai-analysis"
        >
          <Play className="h-4 w-4 mr-2" />
          {triggerRunMutation.isPending ? "Running..." : "Run Analysis Now"}
        </Button>
      </div>

      {runLoading ? (
        <Card>
          <CardContent className="p-6">
            <Skeleton className="h-20 w-full" />
          </CardContent>
        </Card>
      ) : latestRun && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Latest Analysis
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Last run: {formatDistanceToNow(new Date(latestRun.createdAt), { addSuffix: true })}
            </p>
            {latestRun.aiResponse?.analysis_summary && (
              <p className="text-sm mt-2">{latestRun.aiResponse.analysis_summary}</p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Pending Tasks</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pendingTasks.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">In Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{inProgressTasks.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Completed Today</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{completedTasks.length}</div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">Your Tasks</h2>
          <Badge variant="outline" data-testid="text-task-count">
            {tasks?.length || 0} tasks for {user.role}
          </Badge>
        </div>

        {tasksLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        ) : tasks && tasks.length > 0 ? (
          <div className="space-y-3">
            {tasks.map(task => (
              <Card key={task.id} className="hover-elevate" data-testid={`card-task-${task.id}`}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <CardTitle className="text-base flex items-center gap-2">
                        {getStatusIcon(task.status)}
                        {task.title}
                      </CardTitle>
                      <CardDescription className="mt-1">
                        {task.description}
                      </CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Badge variant={getPriorityColor(task.priority) as any}>
                        {task.priority}
                      </Badge>
                      {task.projectCode && (
                        <Badge variant="outline">{task.projectCode}</Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div className="flex gap-2 text-xs text-muted-foreground">
                      <span>{task.taskType.replace(/_/g, " ")}</span>
                      {task.dueDate && (
                        <span>• Due {formatDistanceToNow(new Date(task.dueDate), { addSuffix: true })}</span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      {task.status === "PENDING" && (
                        <Button
                          size="sm"
                          onClick={() => updateTaskMutation.mutate({ taskId: task.id, status: "IN_PROGRESS" })}
                          disabled={updateTaskMutation.isPending}
                          data-testid={`button-start-task-${task.id}`}
                        >
                          Start
                        </Button>
                      )}
                      {task.status === "IN_PROGRESS" && (
                        <Button
                          size="sm"
                          onClick={() => updateTaskMutation.mutate({ taskId: task.id, status: "COMPLETED" })}
                          disabled={updateTaskMutation.isPending}
                          data-testid={`button-complete-task-${task.id}`}
                        >
                          Complete
                        </Button>
                      )}
                      {task.status !== "DISMISSED" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => updateTaskMutation.mutate({ taskId: task.id, status: "DISMISSED" })}
                          disabled={updateTaskMutation.isPending}
                          data-testid={`button-dismiss-task-${task.id}`}
                        >
                          Dismiss
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="p-8 text-center">
              <Bot className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">
                No tasks available. Click "Run Analysis Now" to generate AI insights.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
```

---
---

# CONCLUSION & CODE METRICS

---

## Total Lines of Code in This Export:

- **Configuration Files:** ~190 lines (package.json, tsconfig.json, drizzle.config.ts)
- **Database Schema:** 842 lines (33 tables with full Zod validation)
- **Server Routes:** 3,176 lines (60+ API endpoints)
- **AI Routes:** 300 lines (AI PM + CFO endpoints)
- **AI System Core:**
  - Orchestrator: 206 lines
  - Profitability Engine: 249 lines
  - Data Quality Scorer: 162 lines
  - Snapshot Builder: 408 lines
  - System Prompt: 175 lines
  - OpenAI Client: 99 lines
  - Scheduler: 68 lines
  - **AI Subtotal:** ~1,367 lines
- **Frontend Pages:**
  - Project Detail: 1,609 lines
  - CFO Dashboard: 314 lines
  - AI PM Dashboard: 265 lines
  - **Frontend Subtotal:** ~2,188 lines

**GRAND TOTAL:** ~8,063 lines of production-ready TypeScript code

---

## Key Architecture Highlights

### Authentication & Security:
- JWT tokens with httpOnly cookies (no localStorage exposure)
- Token versioning system for force-logout capability
- bcrypt password hashing (6 rounds)
- Three-tier rate limiting (auth: 10 req/15min, sensitive: 20 req/15min, API: 100 req/15min)
- Comprehensive audit logging (IP, user agent, timestamps, old/new values)
- CORS protection, helmet.js security headers
- File validation (MIME types, size limits)

### Database Architecture:
- 33 tables with comprehensive relationships
- PostgreSQL with Drizzle ORM for type-safe queries
- Automatic UUID generation for primary keys
- Comprehensive indexes on frequently queried columns
- Foreign key constraints with ON DELETE CASCADE where appropriate
- JSON columns for flexible metadata storage

### AI System Architecture:
- Daily scheduled analysis (6:00 AM Eastern by default via node-cron)
- Manual trigger capability (Admin/Manager only)
- Complete data snapshot generation (~8K tokens)
- Profitability calculations using actual user cost rates
- Data quality scoring (0-100 scale across 5 dimensions)
- Role-based task generation (10-30 tasks per analysis)
- GPT-4 structured JSON output (response_format)
- Complete audit trail of all AI runs

### API Design Patterns:
- RESTful endpoints with proper HTTP verbs
- Consistent error handling with meaningful status codes
- Input validation using Zod schemas
- Role-based route protection via middleware
- Hierarchical query keys for cache invalidation
- Optimistic updates on frontend
- TanStack Query for automatic cache management

### State Machine Implementations:
- **Change Orders:** DRAFT → PENDING_APPROVAL → APPROVED/REJECTED (with rejection reason)
- **Time Clock Shifts:** PENDING → APPROVED/REJECTED (manager approval required)
- **Procurement:** PLANNED → QUOTED → APPROVED → ORDERED → DELIVERED

### Frontend Architecture:
- React 18 with TypeScript strict mode
- Wouter for client-side routing (lightweight alternative to React Router)
- TanStack Query v5 for server state management
- Shadcn/ui + Radix UI primitives for accessible components
- Tailwind CSS for styling with dark mode support
- Custom hooks for data fetching and mutations
- Uppy for robust file upload progress tracking

---

## Security Considerations for External Auditors

### Critical Security Features:
1. **No Secrets in Code:** All sensitive keys stored in environment variables
2. **SQL Injection Prevention:** Drizzle ORM provides parameterized queries
3. **XSS Protection:** React escapes output by default; no dangerouslySetInnerHTML usage
4. **CSRF Protection:** JWT in httpOnly cookies prevents CSRF attacks
5. **Rate Limiting:** Three-tier protection prevents brute force and DoS
6. **Audit Trail:** All sensitive operations logged with complete context
7. **Role-Based Access:** Middleware enforces permissions on every protected route
8. **Token Versioning:** Admin can revoke all user sessions via incrementing tokenVersion
9. **File Upload Security:** MIME type validation, size limits, presigned URLs
10. **GPS Validation:** Time-clock coordinates stored for fraud prevention

### Potential Security Enhancements (Future Roadmap):
- Multi-factor authentication (2FA) for admin users
- IP whitelisting for sensitive operations
- Session expiration with refresh tokens
- More granular RBAC with permission matrices
- Enhanced file scanning (virus/malware detection)
- Database encryption at rest
- Field-level encryption for sensitive data (SSN, bank accounts)

---

## Technology Decision Rationale

### Why PostgreSQL?
- ACID compliance crucial for financial data integrity
- Complex joins for profitability calculations
- Native JSON support for flexible metadata
- Mature ecosystem with excellent TypeScript support
- Neon provides serverless scaling with zero maintenance

### Why Drizzle ORM?
- Superior TypeScript integration vs Prisma
- No code generation overhead
- Lighter runtime footprint
- Direct SQL access when needed
- Migration-less development (`db:push`)

### Why OpenAI GPT-4?
- Structured JSON output (response_format) ensures reliable parsing
- 128K context window handles large data snapshots
- Consistent task generation quality
- Cost-effective for daily batch processing
- Proven reliability for production workloads

### Why Express.js (not Next.js)?
- Separation of concerns (frontend/backend independent)
- More control over middleware (rate limiting, audit logging)
- Better WebSocket support for future real-time features
- Simpler deployment model
- No vendor lock-in

### Why TanStack Query?
- Automatic cache invalidation on mutations
- Built-in loading/error states
- Optimistic updates for better UX
- DevTools for debugging
- Industry standard for React server state

---

## Known Limitations & Technical Debt

1. **No Unit Tests:** E2E tests recommended before production deployment
2. **Single Database:** No read replicas for scaling (Neon handles this transparently)
3. **No Redis Cache:** All caching handled by TanStack Query (client-side)
4. **Manual AI Trigger Only:** Scheduled runs work, but no webhook triggers yet
5. **Basic File Storage:** No CDN integration for media delivery optimization
6. **No Real-Time Updates:** WebSocket support not yet implemented (future roadmap)
7. **Limited Subcontractor Features:** Payment approvals could be more automated
8. **No Email Notifications:** All notifications in-app only (no SMTP integration)

---

## Deployment Recommendations

### Pre-Production Checklist:
- [ ] Environment variables configured (DATABASE_URL, OPENAI_API_KEY, SESSION_SECRET)
- [ ] Database migrations applied (`npm run db:push`)
- [ ] Admin user initialized (`POST /api/auth/init`)
- [ ] AI settings configured (daily run time, enabled features)
- [ ] Rate limiter thresholds reviewed for production traffic
- [ ] File upload limits set appropriately (currently 50MB)
- [ ] CORS origins restricted to production domains
- [ ] Audit log retention policy defined
- [ ] Backup schedule configured (Neon automatic backups)
- [ ] Monitoring/alerting configured (error tracking, uptime)

### Production Environment Variables:
```bash
DATABASE_URL=postgresql://...  # Neon production DB
OPENAI_API_KEY=sk-...          # OpenAI production key
SESSION_SECRET=<random-64-char-string>  # Must be secure random
NODE_ENV=production
PORT=3000
```

### Performance Optimization:
- Enable PostgreSQL connection pooling
- Implement CDN for static assets
- Add Redis for session storage (scale beyond single server)
- Consider read replicas for analytics queries
- Implement query result caching for expensive calculations
- Add database indexes for slow queries (use EXPLAIN ANALYZE)

---

## Support & Maintenance

**Code Quality:** Production-ready TypeScript with strict type checking  
**Documentation:** Comprehensive inline comments for complex logic  
**Error Handling:** Consistent error messages and proper HTTP status codes  
**Logging:** Console logging for development, structured logging recommended for production  
**Monitoring:** Audit logs provide operational visibility  

---

## END OF COMPLETE CODE EXPORT

**Export Generated:** November 19, 2025  
**Total Lines:** ~8,200+ lines of code, configuration, and documentation  
**Platform:** TFR Construction Management System  
**Purpose:** External code review, security audit, and architectural assessment  

For questions about this codebase, refer to the replit.md file or contact the development team.

---

**Document Version:** 1.0  
**Last Updated:** 2025-11-19  
**Maintained By:** TFR Construction Dev Team
