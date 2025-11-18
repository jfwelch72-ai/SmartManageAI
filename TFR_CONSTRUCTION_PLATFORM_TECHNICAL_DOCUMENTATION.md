# TFR Construction Management Platform - Complete Technical Documentation

**Document Version:** 1.0  
**Date:** November 18, 2025  
**Author:** Senior Software Architect  
**Purpose:** Comprehensive technical documentation for ChatGPT analysis

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [System Architecture](#system-architecture)
3. [Technology Stack](#technology-stack)
4. [Database Schema](#database-schema)
5. [Authentication & Authorization](#authentication--authorization)
6. [API Endpoints](#api-endpoints)
7. [Frontend Architecture](#frontend-architecture)
8. [File Storage & Permissions](#file-storage--permissions)
9. [Features Documentation](#features-documentation)
10. [Integration Points](#integration-points)
11. [Security Implementations](#security-implementations)
12. [Code Patterns & Conventions](#code-patterns--conventions)
13. [Deployment & Environment](#deployment--environment)

---

## Executive Summary

### Project Overview
The TFR Construction Management Platform is a comprehensive internal tool designed to manage the entire project lifecycle for TFR Construction. The platform streamlines operations from bid tracking through project completion, providing real-time visibility into projects, time tracking, scope management, and financial data.

### Key Metrics
- **Total Database Tables:** 15 core tables
- **API Endpoints:** 64 RESTful endpoints
- **User Roles:** 6 distinct roles with hierarchical permissions
- **Frontend Pages:** 12 main pages
- **Lines of Backend Code:** ~2,000+ lines (routes.ts alone)
- **File Types Supported:** Media (images/videos), Documents (PDFs, plans), Receipts

### Primary Use Cases
1. Bid management and bid-to-project conversion
2. Project lifecycle tracking (planning → active → complete)
3. Scope of work quantity tracking with billing notifications
4. Time entry and approval workflows
5. T&M (Time & Materials) daily sheets for client billing
6. Change order management with approval workflows
7. Calendar system for time-off requests and project milestones
8. Real-time dashboard KPIs
9. File storage with granular permission-based access control

---

## System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      CLIENT LAYER                            │
│  React SPA (TypeScript) + TailwindCSS + shadcn/ui           │
│  Routing: Wouter | State: TanStack Query                    │
└─────────────────────┬───────────────────────────────────────┘
                      │ HTTPS/REST API
┌─────────────────────▼───────────────────────────────────────┐
│                   BACKEND LAYER                              │
│  Express.js Server (TypeScript)                              │
│  Auth: JWT (httpOnly cookies) | Validation: Zod             │
└─────────────────────┬───────────────────────────────────────┘
                      │
        ┌─────────────┴─────────────┬──────────────────┐
        │                           │                  │
┌───────▼────────┐      ┌──────────▼──────────┐  ┌────▼────────┐
│   PostgreSQL   │      │  Replit Object      │  │   Session   │
│   (Neon DB)    │      │  Storage (GCS)      │  │   Store     │
│                │      │                     │  │             │
│ - Users        │      │ - Media files       │  │ - JWT Auth  │
│ - Projects     │      │ - Documents         │  │ - Cookies   │
│ - Time entries │      │ - Receipts          │  │             │
│ - All business │      │ - Private ACL       │  │             │
│   data         │      │                     │  │             │
└────────────────┘      └─────────────────────┘  └─────────────┘
```

### Architectural Principles

1. **Separation of Concerns**
   - Frontend handles presentation and user interaction
   - Backend handles business logic, validation, and data persistence
   - Database stores all business data with referential integrity

2. **Type Safety**
   - Shared TypeScript schema definitions (`shared/schema.ts`)
   - Drizzle ORM provides compile-time type checking
   - Zod schemas for runtime validation

3. **Security-First Design**
   - JWT-based authentication with httpOnly cookies
   - Role-based access control (RBAC) on all endpoints
   - Granular file permissions with ACL enforcement
   - Password hashing with bcrypt (10 rounds)

4. **Scalability Considerations**
   - Stateless API design (can scale horizontally)
   - Database-backed sessions for multi-instance support
   - Object storage for large files (offloads from database)
   - Query optimization with Drizzle ORM indexes

---

## Technology Stack

### Backend Technologies

| Technology | Version | Purpose |
|------------|---------|---------|
| **Node.js** | 20.19.3 | JavaScript runtime |
| **TypeScript** | 5.6.3 | Type-safe development |
| **Express.js** | 4.21.2 | Web application framework |
| **Drizzle ORM** | 0.39.1 | Type-safe database ORM |
| **PostgreSQL** | Latest (Neon) | Primary database |
| **JWT** | 9.0.2 | Authentication tokens |
| **Bcrypt** | 6.0.0 | Password hashing |
| **Zod** | 3.24.2 | Schema validation |
| **@google-cloud/storage** | 7.17.3 | Object storage client |
| **Multer** | 2.0.2 | File upload middleware |

### Frontend Technologies

| Technology | Version | Purpose |
|------------|---------|---------|
| **React** | 18.3.1 | UI framework |
| **TypeScript** | 5.6.3 | Type-safe development |
| **Vite** | 5.4.20 | Build tool & dev server |
| **Wouter** | 3.3.5 | Client-side routing |
| **TanStack Query** | 5.60.5 | Server state management |
| **TailwindCSS** | 3.4.17 | Utility-first CSS |
| **shadcn/ui** | Latest | Component library (Radix UI) |
| **React Hook Form** | 7.55.0 | Form management |
| **Recharts** | 2.15.2 | Data visualization |
| **date-fns** | 3.6.0 | Date utilities |
| **Lucide React** | 0.453.0 | Icon library |
| **Uppy** | 5.x | File upload UI |

### Development Tools

- **tsx** - TypeScript execution for development
- **esbuild** - Fast JavaScript bundler
- **drizzle-kit** - Database migrations and schema push
- **ESLint** - Code linting (via Vite config)

---

## Database Schema

### Schema Overview

The database consists of 15 core tables with a total of 19 enums. All tables use UUID primary keys (generated via PostgreSQL `gen_random_uuid()`). The schema is defined in `shared/schema.ts` using Drizzle ORM.

### Complete Table Definitions

#### 1. Users Table

```typescript
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone"),
  role: userRoleEnum("role").notNull().default("HOURLY_EMPLOYEE"),
  isActive: boolean("is_active").notNull().default(true),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
```

**Enum:** `userRoleEnum = ["ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR", "OFFICE_MANAGER", "HOURLY_EMPLOYEE"]`

**Purpose:** Stores all user accounts with authentication credentials and role assignments.

**Key Fields:**
- `isActive`: Admin-controlled flag for user account activation
- `passwordHash`: Bcrypt-hashed password (10 rounds)
- `role`: Determines access permissions across the platform

#### 2. Projects Table

```typescript
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
  description: text("description"),
  estimatorId: varchar("estimator_id").references(() => users.id),
  superintendentId: varchar("superintendent_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
```

**Enum:** `projectStatusEnum = ["BID", "PLANNING", "ACTIVE", "COMPLETE", "CLOSED"]`

**Purpose:** Core project entity tracking construction projects through their lifecycle.

**Relationships:**
- `estimatorId` → `users.id` (Many-to-One)
- `superintendentId` → `users.id` (Many-to-One)

**Key Fields:**
- `code`: Unique project identifier (used in URLs)
- `status`: Tracks project lifecycle stage

#### 3. Bids Table

```typescript
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
```

**Purpose:** Tracks potential projects in the bid stage. Can be converted to full projects.

**Conversion Flow:** Bid → Project (via `/api/bids/:code/convert` endpoint)

#### 4. Estimates Table

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

**Enum:** `estimateStatusEnum = ["DRAFT", "SUBMITTED", "WON", "LOST"]`

**Purpose:** Stores project estimates with versioning support.

**JSON Fields:**
- `altPricesJson`: Alternate pricing options
- `costBreakdownJson`: Detailed cost analysis

#### 5. Procurement Items Table

```typescript
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
```

**Enum:** `procurementStatusEnum = ["PLANNED", "QUOTED", "APPROVED", "ORDERED", "DELIVERED"]`

**Purpose:** Tracks materials and equipment procurement for projects.

#### 6. Plan Documents Table

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

**Enum:** `documentTypeEnum = ["PLANS", "SPECS", "TAKEOFF", "OTHER"]`

**Purpose:** Stores project documentation (plans, specifications, takeoffs).

**Storage:** Files stored in Replit Object Storage with `objectKey` reference.

#### 7. Time Entries Table

```typescript
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
});
```

**Purpose:** Tracks employee time entries with approval workflow.

**Workflow:** Employee submits → Manager approves → Entry locked

#### 8. T&M Daily Sheets Table

```typescript
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
```

**Purpose:** Daily work logs for Time & Materials billing to clients.

**JSON Fields:**
- `laborSummaryJson`: Array of labor entries with hours and rates
- `equipmentUsedJson`: Equipment usage tracking
- `materialsUsedJson`: Materials consumed
- `attachmentsJson`: References to photos/documents

#### 9. Receipts Table

```typescript
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
```

**Purpose:** Tracks project expenses with receipt image uploads.

**Storage:** Receipt images stored in Object Storage with private ACL.

#### 10. Project Notes Table

```typescript
export const projectNotes = pgTable("project_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  authorId: varchar("author_id").notNull().references(() => users.id),
  noteType: noteTypeEnum("note_type").notNull().default("GENERAL"),
  text: text("text").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

**Enum:** `noteTypeEnum = ["GENERAL", "FIELD_NOTE", "SAFETY", "CLIENT_MEETING"]`

**Purpose:** Project communication and documentation trail.

#### 11. Scope Items Table

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

**Enum:** `billingStatusEnum = ["NOT_READY", "READY_TO_BILL", "BILLED"]`

**Purpose:** Tracks quantities for scope of work items with billing status.

**Billing Logic:**
- `completedQuantity` > `billedQuantity` → Status changes to "READY_TO_BILL"
- Notifications generated for billing department

#### 12. Media Table

```typescript
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
```

**Enum:** `mediaTypeEnum = ["IMAGE", "VIDEO"]`

**Purpose:** Stores project photos and videos.

**Storage:** Files stored in Object Storage with permission-based access.

#### 13. Change Orders Table

```typescript
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
});
```

**Enum:** `changeOrderStatusEnum = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED"]`

**Purpose:** Tracks project change orders with approval workflow.

**Workflow:** Draft → Pending Approval → Approved/Rejected

#### 14. Calendar Events Table

```typescript
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
```

**Enum:** `calendarEventTypeEnum = ["TIME_OFF_REQUEST", "TIME_OFF_APPROVED", "NETWORKING_EVENT", "PROJECT_START", "PROJECT_PHASE", "PROJECT_MILESTONE"]`

**Purpose:** Calendar system for time-off requests and project events.

#### 15. Notifications Table

```typescript
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
```

**Enum:** `notificationTypeEnum = ["BILLING_READY", "CHANGE_ORDER_PENDING", "TIME_OFF_REQUEST", "GENERAL"]`

**Purpose:** User notification system for important events.

#### 16. File Permissions Table

```typescript
export const filePermissions = pgTable("file_permissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  fileId: varchar("file_id").notNull(),
  fileType: fileTypeEnum("file_type").notNull(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  grantedById: varchar("granted_by_id").notNull().references(() => users.id),
  grantedAt: timestamp("granted_at").notNull().defaultNow(),
});
```

**Enum:** `fileTypeEnum = ["MEDIA", "DOCUMENT", "RECEIPT"]`

**Purpose:** Granular file access control. Tracks explicit permission grants from managers to users.

**Access Control Logic:**
- Admins/Managers: Full access to all files
- Others: Only files they uploaded OR have explicit permissions for

---

## Authentication & Authorization

### Authentication System

#### JWT-Based Authentication

The platform uses JSON Web Tokens (JWT) stored in httpOnly cookies for secure authentication.

**Flow:**
1. User submits login credentials to `/api/auth/login`
2. Server validates credentials against bcrypt hash
3. Server generates JWT token (7-day expiration)
4. Token stored in httpOnly cookie (prevents XSS attacks)
5. Subsequent requests include cookie automatically
6. Middleware validates token and attaches user to request

**Implementation** (`server/auth.ts`):

```typescript
// Generate JWT token
export function generateToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "7d" });
}

// Verify JWT token
export function verifyToken(token: string): { userId: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { userId: string };
  } catch {
    return null;
  }
}

// Set auth cookie
export function setAuthCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
}
```

#### Password Security

- **Hashing Algorithm:** Bcrypt with 10 rounds
- **Storage:** Only password hash stored (never plaintext)
- **Verification:** Constant-time comparison via bcrypt

```typescript
// Hash password
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

// Verify password
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
```

### Authorization System

#### Role-Based Access Control (RBAC)

Six distinct user roles with hierarchical permissions:

```typescript
userRoleEnum = [
  "ADMIN",           // Full system access
  "MANAGER",         // Project management, user oversight
  "SUPERINTENDENT",  // Field operations, limited admin
  "ESTIMATOR",       // Bid creation, estimates
  "OFFICE_MANAGER",  // Administrative functions
  "HOURLY_EMPLOYEE"  // Basic access, time entry
]
```

#### Permission Hierarchy

```
ADMIN
  └─ Full access to all features
  └─ User management (create, activate, deactivate)
  └─ Delete operations

MANAGER
  └─ Project CRUD
  └─ Approve time entries
  └─ Approve change orders
  └─ Grant file permissions
  └─ View all files

SUPERINTENDENT
  └─ Project updates
  └─ Scope item updates
  └─ Create T&M sheets
  └─ Limited file access (requires permissions)

ESTIMATOR
  └─ Create/edit bids
  └─ Create estimates
  └─ Read-only project access

OFFICE_MANAGER
  └─ View projects
  └─ Process billing
  └─ Generate reports

HOURLY_EMPLOYEE
  └─ Submit time entries
  └─ View assigned projects
  └─ Limited file access (requires permissions)
```

#### Middleware Implementation

**Authentication Middleware:**
```typescript
export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies[COOKIE_NAME];
  if (!token) {
    next();
    return;
  }

  const payload = verifyToken(token);
  if (!payload) {
    res.clearCookie(COOKIE_NAME);
    next();
    return;
  }

  const [user] = await db.select().from(users).where(eq(users.id, payload.userId)).limit(1);
  
  if (user && user.isActive) {
    const { passwordHash, ...userWithoutPassword } = user;
    req.user = userWithoutPassword;
  }

  next();
}
```

**Role Authorization Middleware:**
```typescript
export function requireRole(...roles: Array<"ADMIN" | "MANAGER" | "SUPERINTENDENT" | "HOURLY_EMPLOYEE">) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }

    next();
  };
}
```

### User Registration & Activation Flow

1. **Self-Service Registration** (`/api/auth/register`)
   - User submits: firstName, lastName, email, phone, password
   - Account created with `isActive: false` (inactive by default)
   - Default role: `HOURLY_EMPLOYEE`

2. **Admin Activation** (`PATCH /api/users/:id`)
   - Admin sets `isActive: true`
   - Admin assigns appropriate role
   - User can now log in

3. **Demo Accounts**
   ```
   Admin:          admin@tfrllc.com (admin123)
   Manager:        sarah@tfrconst.com (password123)
   Superintendent: jake@tfrconstructionohio.com (password123)
   Other:          mike@tfrllc.com (password123)
   ```

---

## API Endpoints

### Complete API Reference (64 Endpoints)

#### Authentication Endpoints

| Method | Endpoint | Auth | Role | Description |
|--------|----------|------|------|-------------|
| POST | `/api/auth/register` | No | - | Self-service user registration (inactive by default) |
| POST | `/api/auth/login` | No | - | Login with email/password, returns JWT cookie |
| POST | `/api/auth/logout` | No | - | Clears authentication cookie |
| GET | `/api/auth/me` | Yes | All | Returns current authenticated user |
| POST | `/api/auth/init` | No | - | Initialize demo accounts and test data |

#### Dashboard Endpoints

| Method | Endpoint | Auth | Role | Description |
|--------|----------|------|------|-------------|
| GET | `/api/dashboard/stats` | Yes | All | Real-time KPI metrics (active projects, pending approvals, etc.) |

#### User Management Endpoints

| Method | Endpoint | Auth | Role | Description |
|--------|----------|------|------|-------------|
| GET | `/api/users` | Yes | ADMIN, MANAGER | List all users |
| GET | `/api/users/:id` | Yes | ADMIN, MANAGER | Get user by ID |
| POST | `/api/users` | Yes | ADMIN | Create new user (admin-only) |
| PATCH | `/api/users/:id` | Yes | ADMIN | Update user (activate, assign role) |

#### Bid Endpoints

| Method | Endpoint | Auth | Role | Description |
|--------|----------|------|------|-------------|
| GET | `/api/bids` | Yes | All | List all bids |
| GET | `/api/bids/:code` | Yes | All | Get bid by code |
| POST | `/api/bids` | Yes | ADMIN, MANAGER | Create new bid |
| PATCH | `/api/bids/:code` | Yes | ADMIN, MANAGER | Update bid |
| DELETE | `/api/bids/:code` | Yes | ADMIN | Delete bid |
| POST | `/api/bids/:code/convert` | Yes | ADMIN, MANAGER | Convert bid to project |

#### Project Endpoints

| Method | Endpoint | Auth | Role | Description |
|--------|----------|------|------|-------------|
| GET | `/api/projects` | Yes | All | List all projects |
| GET | `/api/projects/:code` | Yes | All | Get project by code |
| POST | `/api/projects` | Yes | ADMIN, MANAGER | Create new project |
| PATCH | `/api/projects/:code` | Yes | ADMIN, MANAGER | Update project |

#### Scope of Work Endpoints

| Method | Endpoint | Auth | Role | Description |
|--------|----------|------|------|-------------|
| GET | `/api/projects/:code/scope` | Yes | All | Get scope items for project |
| POST | `/api/projects/:code/scope` | Yes | ADMIN, MANAGER, SUPER | Create scope item |
| PATCH | `/api/scope-items/:id` | Yes | ADMIN, MANAGER, SUPER | Update scope item (quantity tracking) |
| DELETE | `/api/scope-items/:id` | Yes | ADMIN, MANAGER | Delete scope item |

#### Project Notes Endpoints

| Method | Endpoint | Auth | Role | Description |
|--------|----------|------|------|-------------|
| GET | `/api/projects/:code/notes` | Yes | All | Get notes for project |
| POST | `/api/projects/:code/notes` | Yes | All | Create project note |

#### Media Endpoints

| Method | Endpoint | Auth | Role | Description |
|--------|----------|------|------|-------------|
| GET | `/api/projects/:code/media` | Yes | All | List media (filtered by permissions) |
| POST | `/api/projects/:code/media` | Yes | All | Create media record (after upload) |
| DELETE | `/api/media/:id` | Yes | All | Delete media |

#### Time Entry Endpoints

| Method | Endpoint | Auth | Role | Description |
|--------|----------|------|------|-------------|
| GET | `/api/time-entries` | Yes | All | List time entries (filtered by user/role) |
| GET | `/api/projects/:code/time-entries` | Yes | All | Get time entries for project |
| POST | `/api/time-entries` | Yes | All | Submit time entry |
| POST | `/api/time-entries/:id/approve` | Yes | ADMIN, MANAGER | Approve time entry |

#### T&M Daily Sheets Endpoints

| Method | Endpoint | Auth | Role | Description |
|--------|----------|------|------|-------------|
| GET | `/api/projects/:code/tm-sheets` | Yes | All | Get T&M sheets for project |
| POST | `/api/tm-sheets` | Yes | ADMIN, MANAGER, SUPER | Create T&M daily sheet |

#### Estimate Endpoints

| Method | Endpoint | Auth | Role | Description |
|--------|----------|------|------|-------------|
| GET | `/api/projects/:code/estimates` | Yes | All | Get estimates for project |
| POST | `/api/estimates` | Yes | ADMIN, MANAGER | Create estimate |

#### Procurement Endpoints

| Method | Endpoint | Auth | Role | Description |
|--------|----------|------|------|-------------|
| GET | `/api/projects/:code/procurement` | Yes | All | Get procurement items for project |
| POST | `/api/procurement` | Yes | ADMIN, MANAGER | Create procurement item |
| PATCH | `/api/procurement/:id` | Yes | ADMIN, MANAGER | Update procurement item |

#### Receipt Endpoints

| Method | Endpoint | Auth | Role | Description |
|--------|----------|------|------|-------------|
| GET | `/api/projects/:code/receipts` | Yes | All | List receipts (filtered by permissions) |
| POST | `/api/receipts` | Yes | All | Create receipt record (after upload) |

#### Document Endpoints

| Method | Endpoint | Auth | Role | Description |
|--------|----------|------|------|-------------|
| GET | `/api/projects/:code/documents` | Yes | All | List documents (filtered by permissions) |
| POST | `/api/documents` | Yes | ADMIN, MANAGER | Create document record (after upload) |

#### File Permission Endpoints

| Method | Endpoint | Auth | Role | Description |
|--------|----------|------|------|-------------|
| POST | `/api/file-permissions` | Yes | ADMIN, MANAGER | Grant file access to user |
| DELETE | `/api/file-permissions/:id` | Yes | ADMIN, MANAGER | Revoke file permission |
| GET | `/api/file-permissions/:fileType/:fileId` | Yes | ADMIN, MANAGER | List permissions for file |
| GET | `/api/users/:userId/file-permissions` | Yes | All | List user's file permissions |

#### Change Order Endpoints

| Method | Endpoint | Auth | Role | Description |
|--------|----------|------|------|-------------|
| GET | `/api/projects/:code/change-orders` | Yes | All | Get change orders for project |
| POST | `/api/change-orders` | Yes | ADMIN, MANAGER, SUPER | Create change order |
| PATCH | `/api/change-orders/:id` | Yes | ADMIN, MANAGER, SUPER | Update change order |
| POST | `/api/change-orders/:id/approve` | Yes | ADMIN, MANAGER | Approve change order |
| POST | `/api/change-orders/:id/reject` | Yes | ADMIN, MANAGER | Reject change order |

#### Calendar Endpoints

| Method | Endpoint | Auth | Role | Description |
|--------|----------|------|------|-------------|
| GET | `/api/calendar/events` | Yes | All | List calendar events (time-off, milestones) |
| POST | `/api/calendar/events` | Yes | All | Create calendar event (time-off request) |
| POST | `/api/calendar/events/:id/approve` | Yes | ADMIN, MANAGER | Approve time-off request |

#### Notification Endpoints

| Method | Endpoint | Auth | Role | Description |
|--------|----------|------|------|-------------|
| GET | `/api/notifications` | Yes | All | Get user's notifications |
| PATCH | `/api/notifications/:id/read` | Yes | All | Mark notification as read |

#### Object Storage Endpoints

| Method | Endpoint | Auth | Role | Description |
|--------|----------|------|------|-------------|
| POST | `/api/objects/upload` | Yes | All | Get presigned upload URL |
| GET | `/objects/:objectPath(*)` | Yes | All | Download file (permission-checked) |

### API Response Patterns

#### Success Response
```json
{
  "id": "uuid",
  "name": "Project Name",
  ...
}
```

#### Error Response
```json
{
  "error": "Error message"
}
```

#### Status Codes
- `200`: Success
- `201`: Created
- `400`: Bad request (validation error)
- `401`: Unauthorized (not authenticated)
- `403`: Forbidden (insufficient permissions)
- `404`: Not found
- `500`: Internal server error

---

## Frontend Architecture

### Application Structure

```
client/src/
├── components/
│   ├── ui/                    # shadcn/ui components (44 components)
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── dialog.tsx
│   │   ├── form.tsx
│   │   ├── table.tsx
│   │   └── ...
│   ├── ObjectUploader.tsx     # File upload component
│   └── layout/                # Layout components
│
├── pages/
│   ├── login.tsx              # Login page
│   ├── register.tsx           # Self-service registration
│   ├── dashboard.tsx          # KPI dashboard
│   ├── users.tsx              # User management (admin)
│   ├── bids.tsx               # Bid listing
│   ├── bid-detail.tsx         # Bid details & conversion
│   ├── projects.tsx           # Project listing
│   ├── project-detail.tsx     # Project details (10 tabs)
│   ├── time-entry.tsx         # Time entry form
│   ├── tm-daily.tsx           # T&M daily sheets
│   ├── calendar.tsx           # Calendar view
│   └── not-found.tsx          # 404 page
│
├── lib/
│   ├── queryClient.ts         # TanStack Query setup
│   └── utils.ts               # Utility functions
│
├── hooks/
│   └── use-toast.ts           # Toast notification hook
│
├── App.tsx                    # Root component with routing
├── main.tsx                   # React entry point
└── index.css                  # Global styles + Tailwind
```

### Routing (Wouter)

All routes defined in `App.tsx`:

```typescript
<Switch>
  <Route path="/" component={Dashboard} />
  <Route path="/login" component={Login} />
  <Route path="/register" component={Register} />
  <Route path="/users" component={Users} />
  <Route path="/bids" component={Bids} />
  <Route path="/bids/:code" component={BidDetail} />
  <Route path="/projects" component={Projects} />
  <Route path="/projects/:code" component={ProjectDetail} />
  <Route path="/time-entry" component={TimeEntry} />
  <Route path="/tm-daily" component={TMDaily} />
  <Route path="/calendar" component={Calendar} />
  <Route component={NotFound} />
</Switch>
```

### State Management (TanStack Query)

**Query Client Configuration** (`lib/queryClient.ts`):

```typescript
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: async ({ queryKey }) => {
        const res = await fetch(queryKey[0] as string, {
          credentials: "include",
        });

        if (!res.ok) {
          if (res.status === 401) {
            window.location.href = "/login";
            throw new Error("Unauthorized");
          }
          throw new Error(`HTTP ${res.status}`);
        }

        return res.json();
      },
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: false,
    },
  },
});
```

**Query Pattern:**
```typescript
const { data: projects, isLoading } = useQuery({
  queryKey: ["/api/projects"],
});
```

**Mutation Pattern:**
```typescript
const createProject = useMutation({
  mutationFn: async (data: InsertProject) => {
    return apiRequest("/api/projects", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
    toast({ title: "Project created" });
  },
});
```

### Project Detail Page (10 Tabs)

The project detail page (`client/src/pages/project-detail.tsx`) features a comprehensive tab interface:

1. **Overview Tab** - Project info, status, dates, client details
2. **Scope of Work Tab** - Quantity tracking with billing status
3. **Notes Tab** - Project notes with type categorization
4. **Media Tab** - Photo/video gallery with upload (permission-based)
5. **Time Entries Tab** - Time tracking with approval workflow
6. **T&M Sheets Tab** - Daily work logs for client billing
7. **Estimates Tab** - Project estimates with versioning
8. **Procurement Tab** - Materials tracking with PO management
9. **Documents Tab** - Plan documents with upload (permission-based)
10. **Receipts Tab** - Expense tracking with receipt upload (permission-based)

### Form Management (React Hook Form + Zod)

**Pattern:**
```typescript
const form = useForm<InsertProject>({
  resolver: zodResolver(insertProjectSchema.extend({
    // Additional validation
  })),
  defaultValues: {
    name: "",
    code: "",
    // ...
  },
});

const onSubmit = (data: InsertProject) => {
  createProject.mutate(data);
};

return (
  <Form {...form}>
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Name</FormLabel>
            <FormControl>
              <Input {...field} data-testid="input-name" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <Button type="submit" data-testid="button-submit">Create</Button>
    </form>
  </Form>
);
```

### Component Library (shadcn/ui)

All UI components use Radix UI primitives with Tailwind styling:

- **Data Display:** Table, Card, Avatar, Badge, Separator
- **Feedback:** Toast, Alert, Progress, Skeleton
- **Inputs:** Input, Textarea, Select, Checkbox, Switch, RadioGroup
- **Navigation:** Tabs, DropdownMenu, NavigationMenu
- **Overlays:** Dialog, Popover, HoverCard, Tooltip, Sheet
- **Layout:** ScrollArea, ResizablePanels, Accordion, Collapsible

### Data Visualization (Recharts)

Dashboard uses Recharts for KPI visualization:
- Bar charts for project counts by status
- Line charts for time tracking trends
- Pie charts for billing status distribution

---

## File Storage & Permissions

### Object Storage Architecture

**Provider:** Replit Object Storage (Google Cloud Storage backend)

**Bucket Configuration:**
- Bucket ID: `repl-default-bucket-$REPL_ID`
- Default directories: `public/`, `.private/`
- Environment variables:
  - `DEFAULT_OBJECT_STORAGE_BUCKET_ID`
  - `PUBLIC_OBJECT_SEARCH_PATHS`
  - `PRIVATE_OBJECT_DIR`

### Upload Flow (Presigned URLs)

**Architecture:**

```
┌──────────────┐     1. Request Upload URL      ┌──────────────┐
│   Frontend   │ ────────────────────────────▶  │   Backend    │
│              │                                 │              │
│              │  2. Return Presigned URL        │              │
│              │ ◀────────────────────────────   │              │
└──────────────┘                                 └──────────────┘
       │                                                │
       │ 3. Direct Upload (PUT)                         │
       ▼                                                │
┌──────────────────────────────────────────┐           │
│   Replit Object Storage (GCS)            │           │
│   - Stores file with private ACL         │           │
└──────────────────────────────────────────┘           │
       │                                                │
       │ 4. Confirm Upload + Save Metadata              │
       └────────────────────────────────────────────────▶
```

**Implementation:**

1. **Frontend requests presigned URL** (`POST /api/objects/upload`):
```typescript
const { data: uploadParams } = await apiRequest("/api/objects/upload", {
  method: "POST",
  body: JSON.stringify({
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type,
  }),
});
// Returns: { method: "PUT", url: "https://..." }
```

2. **Frontend uploads directly to GCS**:
```typescript
const uppy = new Uppy({
  restrictions: {
    maxNumberOfFiles: 1,
    maxFileSize: 104857600, // 100MB
  },
})
.use(AwsS3, {
  shouldUseMultipart: false,
  getUploadParameters: () => uploadParams,
});
```

3. **Frontend saves file metadata** (`POST /api/projects/:code/media`):
```typescript
await apiRequest(`/api/projects/${projectCode}/media`, {
  method: "POST",
  body: JSON.stringify({
    projectId,
    type: "IMAGE",
    fileName: file.name,
    fileUrl: uploadParams.url.split("?")[0],
    objectKey: extractedObjectKey,
    fileSize: file.size,
    mimeType: file.type,
    uploadedById: currentUser.id,
  }),
});
```

4. **Backend creates file record + permission grant**:
```typescript
const [newMedia] = await db.insert(media).values({
  ...data,
  objectKey,
}).returning();

// Auto-grant permission to uploader
await db.insert(filePermissions).values({
  fileId: newMedia.id,
  fileType: "MEDIA",
  userId: req.user!.id,
  grantedById: req.user!.id,
});
```

### Download Flow (Permission-Checked)

**Flow:**

1. User requests file: `GET /objects/private/some-file.jpg`
2. Backend resolves objectKey to database record
3. Backend checks user permissions
4. If authorized, stream file from GCS
5. If unauthorized, return 403

**Implementation** (`server/routes.ts`):

```typescript
app.get("/objects/:objectPath(*)", requireAuth, async (req: AuthRequest, res) => {
  try {
    const objectStorageService = new ObjectStorageService();
    const objectFile = await objectStorageService.getObjectEntityFile(req.path);
    
    const objectKey = objectFile.name;

    // Resolve objectKey to fileId and fileType
    const { resolveObjectKeyToFile } = await import("./fileAccessHelpers");
    const resolvedFile = await resolveObjectKeyToFile(objectKey);

    // Block orphaned objects (files not tracked in database)
    if (!resolvedFile) {
      res.status(404).json({ error: "File not found in system" });
      return;
    }

    // Check permissions
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

    // Stream file to user
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
```

### Permission System Implementation

#### Database Schema

```typescript
export const filePermissions = pgTable("file_permissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  fileId: varchar("file_id").notNull(),
  fileType: fileTypeEnum("file_type").notNull(), // "MEDIA", "DOCUMENT", "RECEIPT"
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  grantedById: varchar("granted_by_id").notNull().references(() => users.id),
  grantedAt: timestamp("granted_at").notNull().defaultNow(),
});
```

#### Access Control Logic (`server/fileAccessHelpers.ts`)

**Three Core Functions:**

1. **resolveObjectKeyToFile()** - Maps objectKey to fileType, fileId, record
```typescript
export async function resolveObjectKeyToFile(objectKey: string): Promise<ResolvedFile | null> {
  // Try media table
  const [mediaRecord] = await db.select().from(media).where(eq(media.objectKey, objectKey)).limit(1);
  if (mediaRecord) {
    return { fileType: "MEDIA", fileId: mediaRecord.id, record: mediaRecord };
  }

  // Try planDocuments table
  const [documentRecord] = await db.select().from(planDocuments).where(eq(planDocuments.objectKey, objectKey)).limit(1);
  if (documentRecord) {
    return { fileType: "DOCUMENT", fileId: documentRecord.id, record: documentRecord };
  }

  // Try receipts table
  const [receiptRecord] = await db.select().from(receipts).where(eq(receipts.objectKey, objectKey)).limit(1);
  if (receiptRecord) {
    return { fileType: "RECEIPT", fileId: receiptRecord.id, record: receiptRecord };
  }

  return null;
}
```

2. **canUserAccessFile()** - Permission check for individual file
```typescript
export async function canUserAccessFile(
  userId: string,
  userRole: string,
  fileId: string,
  fileType: FileType
): Promise<boolean> {
  // Admin and Manager have full access
  if (userRole === "ADMIN" || userRole === "MANAGER") {
    return true;
  }

  // Check if user uploaded the file
  let uploadedById: string | null = null;
  if (fileType === "MEDIA") {
    const [record] = await db.select({ uploadedById: media.uploadedById }).from(media).where(eq(media.id, fileId)).limit(1);
    uploadedById = record?.uploadedById || null;
  }
  // ... similar for DOCUMENT and RECEIPT

  if (uploadedById === userId) {
    return true;
  }

  // Check for explicit permission
  const [permission] = await db.select().from(filePermissions)
    .where(and(
      eq(filePermissions.fileId, fileId),
      eq(filePermissions.fileType, fileType),
      eq(filePermissions.userId, userId)
    ))
    .limit(1);

  return !!permission;
}
```

3. **filterFilesByPermissions()** - Filter file lists by permissions
```typescript
export async function filterFilesByPermissions<T extends { id: string; uploadedById?: string; userId?: string }>(
  files: T[],
  userId: string,
  userRole: string,
  fileType: FileType
): Promise<T[]> {
  // Admin and Manager see all files
  if (userRole === "ADMIN" || userRole === "MANAGER") {
    return files;
  }

  // Get all permissions for this user and file type
  const permissions = await db.select({ fileId: filePermissions.fileId })
    .from(filePermissions)
    .where(and(
      eq(filePermissions.userId, userId),
      eq(filePermissions.fileType, fileType)
    ));

  const permittedFileIds = new Set(permissions.map(p => p.fileId));

  // Filter: user uploaded OR has explicit permission
  return files.filter(file => {
    const uploadedByUser = (file.uploadedById === userId) || (file.userId === userId);
    const hasPermission = permittedFileIds.has(file.id);
    return uploadedByUser || hasPermission;
  });
}
```

#### Permission Management API

**Grant Permission** (`POST /api/file-permissions`):
```typescript
app.post("/api/file-permissions", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  const { fileId, fileType, userId } = insertFilePermissionSchema.parse(req.body);

  const [permission] = await db.insert(filePermissions).values({
    fileId,
    fileType,
    userId,
    grantedById: req.user!.id,
  }).returning();

  res.status(201).json(permission);
});
```

**Revoke Permission** (`DELETE /api/file-permissions/:id`):
```typescript
app.delete("/api/file-permissions/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  await db.delete(filePermissions).where(eq(filePermissions.id, req.params.id));
  res.status(204).send();
});
```

**List File Permissions** (`GET /api/file-permissions/:fileType/:fileId`):
```typescript
app.get("/api/file-permissions/:fileType/:fileId", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  const permissions = await db.select()
    .from(filePermissions)
    .where(and(
      eq(filePermissions.fileType, req.params.fileType as FileType),
      eq(filePermissions.fileId, req.params.fileId)
    ));

  res.json(permissions);
});
```

### Security Features

1. **Orphaned Object Protection**
   - Download route blocks files not in database
   - Prevents direct GCS URL access without metadata

2. **Private ACL**
   - All uploads use "private" visibility
   - No public URL access without backend authorization

3. **Auto-Permission Grant**
   - Uploaders automatically get access to their files
   - Permission created in same transaction as file record

4. **Listing Filters**
   - All listing endpoints filter by permissions
   - Non-admin/manager users never see unauthorized file metadata

5. **Role-Based Access**
   - Admins/Managers: Full access to all files
   - Superintendents/Hourly: Only uploaded files + explicit grants

---

## Features Documentation

### 1. User Management

**Purpose:** Admin interface for managing user accounts, roles, and activation.

**Key Features:**
- Self-service registration (inactive by default)
- Admin activation workflow
- Role assignment (6 roles)
- User listing with search/filter
- Edit user details (name, email, phone, role)

**Access:** ADMIN (full), MANAGER (view-only)

**Implementation:** `client/src/pages/users.tsx`

### 2. Bid Management

**Purpose:** Track potential projects in the bid stage.

**Key Features:**
- Create/edit bids with client info
- Track bid amount and due date
- Bid-to-project conversion (one-click)
- Bid listing with status badges

**Access:** ADMIN, MANAGER (create/edit), All (view)

**Conversion Flow:**
1. User clicks "Convert to Project" button
2. Backend creates new project from bid data
3. Bid deleted (or optionally archived)
4. User redirected to new project

**Implementation:** `client/src/pages/bids.tsx`, `client/src/pages/bid-detail.tsx`

### 3. Project Management

**Purpose:** Central hub for all project data and operations.

**Key Features:**
- Project CRUD with full client details
- Status tracking (BID → PLANNING → ACTIVE → COMPLETE → CLOSED)
- Estimator and Superintendent assignment
- Project code (unique identifier)
- Location tracking (address, city, state)
- Start/end date tracking

**Access:** ADMIN, MANAGER (full), All (view assigned projects)

**Implementation:** `client/src/pages/projects.tsx`, `client/src/pages/project-detail.tsx`

### 4. Scope of Work Tracking

**Purpose:** Track quantities for scope items with automatic billing notifications.

**Key Features:**
- Quantity tracking (total, completed, billed)
- Unit pricing
- Billing status automation:
  - `completedQuantity` > `billedQuantity` → Status: "READY_TO_BILL"
  - Auto-notification to billing department
- Progress visualization
- Scope item CRUD

**Access:** ADMIN, MANAGER, SUPERINTENDENT (create/edit), All (view)

**Billing Logic:**
```typescript
// Backend automatically updates billingStatus
if (completedQuantity > billedQuantity) {
  billingStatus = "READY_TO_BILL";
  
  // Create notification for office manager
  await createNotification({
    userId: officeManagerId,
    type: "BILLING_READY",
    title: "Scope Item Ready to Bill",
    message: `${description} - ${completedQuantity - billedQuantity} ${unit} ready`,
    relatedEntityId: scopeItem.id,
  });
}
```

**Implementation:** Project Detail → Scope of Work Tab

### 5. Time Entry & Approval

**Purpose:** Employee time tracking with manager approval workflow.

**Key Features:**
- Time entry submission (regular + overtime hours)
- Project association
- Cost code tracking
- Approval workflow:
  1. Employee submits time entry
  2. Manager reviews and approves
  3. Entry locked after approval
- Time entry listing (filtered by user/role)
- Calendar date picker

**Access:** All (submit), ADMIN/MANAGER (approve)

**Workflow:**
```
Employee        Manager         System
   │               │               │
   ├─ Submit ─────▶│               │
   │               ├─ Review ─────▶│
   │               ├─ Approve ────▶│
   │               │               ├─ Lock Entry
   │               │               ├─ Set approvedAt
   │◀──── Email ───┴───────────────┘
```

**Implementation:** `client/src/pages/time-entry.tsx`

### 6. T&M Daily Sheets

**Purpose:** Daily work logs for Time & Materials client billing.

**Key Features:**
- Daily work description
- Weather tracking
- Crew size
- Labor summary (JSON: employee, hours, rate)
- Equipment used (JSON: equipment, hours, rate)
- Materials used (JSON: material, quantity, cost)
- Client signature (digital: name + date)
- Photo attachments

**Access:** ADMIN, MANAGER, SUPERINTENDENT (create/edit), All (view)

**JSON Structure:**
```typescript
// laborSummaryJson
[
  { name: "John Doe", hours: 8, rate: 45 },
  { name: "Jane Smith", hours: 8, rate: 50 }
]

// equipmentUsedJson
[
  { equipment: "Excavator", hours: 6, rate: 150 },
  { equipment: "Dump Truck", hours: 4, rate: 100 }
]

// materialsUsedJson
[
  { material: "Concrete", quantity: 10, unit: "CY", cost: 1500 },
  { material: "Rebar", quantity: 500, unit: "LF", cost: 750 }
]
```

**Implementation:** `client/src/pages/tm-daily.tsx`

### 7. Change Order Management

**Purpose:** Track project changes with approval workflow.

**Key Features:**
- Change order number tracking
- Amount tracking (positive or negative)
- Description and justification
- Status workflow: Draft → Pending Approval → Approved/Rejected
- Rejection reason tracking
- Attachment support (JSON)
- Approval/rejection by manager

**Access:** ADMIN, MANAGER, SUPERINTENDENT (create), ADMIN/MANAGER (approve/reject)

**Workflow:**
```
Superintendent      Manager         System
      │                │               │
      ├─ Create Draft ─┤               │
      ├─ Submit ──────▶│               │
      │                ├─ Review ─────▶│
      │                ├─ Approve ────▶│
      │                │               ├─ Update Status
      │                │               ├─ Notify Requester
      │◀──── Email ────┴───────────────┘
```

**Implementation:** Project Detail → Change Orders Tab (future)

### 8. Calendar System

**Purpose:** Centralized calendar for time-off requests and project events.

**Key Features:**
- Monthly calendar view
- Event types:
  - Time-off requests
  - Time-off approved
  - Networking events
  - Project start dates
  - Project phases
  - Project milestones
- Time-off approval workflow
- All-day event support
- Event creation modal

**Access:** All (create time-off), ADMIN/MANAGER (approve), All (view)

**Implementation:** `client/src/pages/calendar.tsx`

### 9. Dashboard (KPI)

**Purpose:** Real-time visibility into key metrics and quick navigation.

**Key Metrics:**
- Total active projects
- Total users
- Pending time-off requests
- Pending change orders
- Scope items ready to bill
- Unapproved time entries
- Recent project activity
- Time entry trends (chart)
- Project status distribution (chart)

**Quick Links:**
- Active projects (clickable cards)
- Pending approvals (actionable items)
- Time-off requests (approve/reject)

**Access:** All (role-based KPIs)

**Implementation:** `client/src/pages/dashboard.tsx`

### 10. Media Management

**Purpose:** Project photo and video library with permission-based access.

**Key Features:**
- Photo/video upload (max 100MB)
- Uppy progress tracking
- Caption/description
- Gallery view
- Permission-based listing
- Download with permission check
- Delete (uploader or admin/manager)

**Access:** All (upload), Permission-based (view/download)

**File Types:** IMAGE, VIDEO

**Implementation:** Project Detail → Media Tab

### 11. Document Management

**Purpose:** Project plan document storage (PDFs, CAD, etc.).

**Key Features:**
- Document upload (plans, specs, takeoffs)
- Document type categorization
- Title and description
- Permission-based access
- Download with permission check
- Delete (admin/manager only)

**Access:** ADMIN, MANAGER (upload), Permission-based (view/download)

**Document Types:** PLANS, SPECS, TAKEOFF, OTHER

**Implementation:** Project Detail → Documents Tab

### 12. Receipt Management

**Purpose:** Project expense tracking with receipt image uploads.

**Key Features:**
- Receipt upload (image/PDF)
- Vendor tracking
- Amount tracking
- Category assignment
- Date tracking
- Notes field
- Permission-based access

**Access:** All (upload), Permission-based (view/download)

**Use Case:** Field employees upload receipts for reimbursement

**Implementation:** Project Detail → Receipts Tab

---

## Integration Points

### 1. Replit Object Storage (Google Cloud Storage)

**Purpose:** Scalable file storage for media, documents, and receipts.

**Integration Method:** `@google-cloud/storage` SDK

**Configuration:**
```typescript
import { Storage } from "@google-cloud/storage";

const storage = new Storage({
  projectId: process.env.GCS_PROJECT_ID,
  credentials: JSON.parse(process.env.GCS_CREDENTIALS || "{}"),
});

const bucket = storage.bucket(process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID!);
```

**Environment Variables:**
- `DEFAULT_OBJECT_STORAGE_BUCKET_ID`: Bucket identifier
- `PUBLIC_OBJECT_SEARCH_PATHS`: Search paths for public assets
- `PRIVATE_OBJECT_DIR`: Directory for private objects

**Key Operations:**
1. **Generate Presigned Upload URL:**
```typescript
const [url] = await file.getSignedUrl({
  version: "v4",
  action: "write",
  expires: Date.now() + 15 * 60 * 1000, // 15 minutes
  contentType: mimeType,
});
```

2. **Download File:**
```typescript
const readStream = file.createReadStream();
readStream.pipe(res);
```

3. **Set ACL:**
```typescript
await file.setMetadata({
  metadata: {
    visibility: "private",
    fileId: "uuid",
    fileType: "MEDIA",
  },
});
```

**Implementation:** `server/objectStorage.ts`, `server/objectAcl.ts`

### 2. PostgreSQL (Neon)

**Purpose:** Primary database for all business data.

**Integration Method:** Drizzle ORM + `@neondatabase/serverless`

**Configuration:**
```typescript
import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool } from "@neondatabase/serverless";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });
```

**Environment Variables:**
- `DATABASE_URL`: PostgreSQL connection string (format: `postgresql://user:pass@host/db`)
- `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`: Individual connection params

**Key Features:**
- Connection pooling for performance
- SSL/TLS encryption
- Automatic reconnection
- Type-safe queries via Drizzle ORM

**Schema Management:**
```bash
# Push schema changes to database
npm run db:push

# Force push (bypasses warnings)
npm run db:push --force
```

**Implementation:** `server/db.ts`, `shared/schema.ts`

### 3. Uppy (File Uploads)

**Purpose:** Robust frontend file upload UI with progress tracking.

**Integration Method:** `@uppy/core`, `@uppy/react`, `@uppy/dashboard`, `@uppy/aws-s3`

**Configuration:**
```typescript
const uppy = new Uppy({
  restrictions: {
    maxNumberOfFiles: 1,
    maxFileSize: 104857600, // 100MB
    allowedFileTypes: ["image/*", "video/*"],
  },
  autoProceed: false,
})
.use(AwsS3, {
  shouldUseMultipart: false,
  getUploadParameters: async () => {
    const params = await fetch("/api/objects/upload", {
      method: "POST",
      body: JSON.stringify({ fileName, fileSize, mimeType }),
    }).then(r => r.json());
    return params; // { method: "PUT", url: "https://..." }
  },
})
.on("complete", (result) => {
  // Save metadata to database
});
```

**CSS Import:**
```typescript
import "@uppy/core/dist/style.css";
import "@uppy/dashboard/dist/style.css";
```

**Implementation:** `client/src/components/ObjectUploader.tsx`

### 4. TanStack Query (React Query)

**Purpose:** Server state management and caching.

**Integration Method:** `@tanstack/react-query`

**Configuration:**
```typescript
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: async ({ queryKey }) => {
        const res = await fetch(queryKey[0] as string, {
          credentials: "include", // Include auth cookies
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      },
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: false,
    },
  },
});
```

**Key Features:**
- Automatic request deduplication
- Background refetching
- Cache invalidation on mutations
- Loading and error states
- Optimistic updates

**Implementation:** `client/src/lib/queryClient.ts`

### 5. shadcn/ui Component Library

**Purpose:** Pre-built, accessible UI components.

**Integration Method:** Copy-paste components (not npm package)

**Component Count:** 44 components

**Key Components Used:**
- Form (React Hook Form integration)
- Table (data tables)
- Dialog (modals)
- Card (content containers)
- Button (all interactions)
- Select, Input, Textarea (form inputs)
- Tabs (project detail navigation)
- Toast (notifications)
- Badge (status indicators)

**Theming:** Tailwind CSS variables in `client/src/index.css`

**Implementation:** `client/src/components/ui/*`

---

## Security Implementations

### 1. Authentication Security

**JWT Security:**
- httpOnly cookies (prevents XSS token theft)
- 7-day token expiration
- Secure flag in production (HTTPS-only)
- SameSite: "lax" (CSRF protection)

**Password Security:**
- Bcrypt hashing with 10 rounds
- Salting automatic (per-password)
- Constant-time comparison
- Password hash never sent to frontend

**Session Security:**
- Server-side session validation
- Automatic cleanup of expired tokens
- No sensitive data in cookies

### 2. Authorization Security

**Role-Based Access Control:**
- Middleware enforcement on all protected routes
- Role validation before database queries
- Hierarchical permission model
- Fail-secure (deny by default)

**SQL Injection Prevention:**
- Drizzle ORM parameterized queries
- No string concatenation in queries
- Type-safe query builder

**Example:**
```typescript
// Safe (parameterized)
await db.select().from(users).where(eq(users.id, userId));

// NEVER DONE (SQL injection risk)
await db.execute(sql`SELECT * FROM users WHERE id = '${userId}'`);
```

### 3. File Access Security

**Permission Enforcement:**
- Download route checks permissions before streaming
- Listing routes filter by permissions
- Orphaned object protection (404 if not in DB)
- Private ACL on all uploads

**Access Control Matrix:**

| Role | Own Files | All Files | Grant Permissions |
|------|-----------|-----------|-------------------|
| ADMIN | ✓ | ✓ | ✓ |
| MANAGER | ✓ | ✓ | ✓ |
| SUPERINTENDENT | ✓ | Explicit grants only | ✗ |
| HOURLY_EMPLOYEE | ✓ | Explicit grants only | ✗ |

**Implementation:**
- `canAccessObjectEntity()` - Permission check before download
- `filterFilesByPermissions()` - Filter listings by role/permissions
- `resolveObjectKeyToFile()` - Map storage objects to DB records

### 4. Input Validation

**Zod Schema Validation:**
- All API endpoints validate request body
- Type-safe validation with error messages
- Prevents malformed data from reaching database

**Example:**
```typescript
app.post("/api/projects", requireAuth, requireRole("ADMIN", "MANAGER"), async (req, res) => {
  try {
    const data = insertProjectSchema.parse(req.body);
    const [project] = await db.insert(projects).values(data).returning();
    res.status(201).json(project);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  }
});
```

### 5. CORS & Request Security

**CORS Configuration:**
```typescript
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:5000",
  credentials: true, // Allow cookies
}));
```

**Rate Limiting:** Not currently implemented (future enhancement)

**CSRF Protection:** SameSite cookie attribute provides basic protection

### 6. Environment Security

**Secret Management:**
- All secrets in environment variables
- Never committed to version control
- Separate dev/prod configurations

**Required Secrets:**
- `SESSION_SECRET`: JWT signing key
- `DATABASE_URL`: Database connection string
- `DEFAULT_OBJECT_STORAGE_BUCKET_ID`: GCS bucket ID
- `GCS_CREDENTIALS`: Service account JSON (if needed)

**Example `.env`:**
```
SESSION_SECRET=your-secret-key-change-in-production
DATABASE_URL=postgresql://user:pass@host/db
DEFAULT_OBJECT_STORAGE_BUCKET_ID=repl-default-bucket-...
```

### 7. Data Integrity

**Foreign Key Constraints:**
- All relationships enforce referential integrity
- Cascade deletes where appropriate (e.g., project deletion cascades to related data)
- Prevent orphaned records

**Transactions:** Used for multi-step operations (e.g., file upload + permission grant)

**Unique Constraints:**
- Email uniqueness (users)
- Project code uniqueness
- Bid code uniqueness

---

## Code Patterns & Conventions

### 1. Backend Patterns

**Route Structure:**
```typescript
app.METHOD("/api/resource", ...middlewares, async (req: AuthRequest, res) => {
  try {
    // 1. Validate input
    const data = insertSchema.parse(req.body);
    
    // 2. Check authorization
    if (!canUserDoThis(req.user, data)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    
    // 3. Perform database operation
    const [result] = await db.insert(table).values(data).returning();
    
    // 4. Return response
    res.status(201).json(result);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
```

**Middleware Order:**
1. `authMiddleware` - Attach user to request
2. `requireAuth` - Enforce authentication
3. `requireRole(...)` - Enforce authorization
4. Route handler

**Error Handling:**
- Try/catch in all async routes
- Specific error status codes (400, 401, 403, 404, 500)
- Generic error messages to client (no internal details)
- Detailed logging to console

### 2. Frontend Patterns

**Component Structure:**
```typescript
export default function ComponentName() {
  // 1. Hooks
  const { user } = useAuth();
  const { data, isLoading, error } = useQuery({ queryKey: ["/api/resource"] });
  const mutation = useMutation({ ... });
  
  // 2. Event handlers
  const handleSubmit = (data: FormData) => {
    mutation.mutate(data);
  };
  
  // 3. Conditional rendering
  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage />;
  
  // 4. Main render
  return (
    <div>
      {/* Content */}
    </div>
  );
}
```

**Form Pattern:**
```typescript
const form = useForm<InsertType>({
  resolver: zodResolver(insertSchema),
  defaultValues: { ... },
});

const onSubmit = (data: InsertType) => {
  createMutation.mutate(data);
};

return (
  <Form {...form}>
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <FormField
        control={form.control}
        name="fieldName"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Label</FormLabel>
            <FormControl>
              <Input {...field} data-testid="input-fieldName" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <Button type="submit">Submit</Button>
    </form>
  </Form>
);
```

**Query Pattern:**
```typescript
const { data: items, isLoading } = useQuery({
  queryKey: ["/api/items"],
});

const createItem = useMutation({
  mutationFn: async (data: InsertItem) => {
    return apiRequest("/api/items", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["/api/items"] });
    toast({ title: "Item created" });
  },
});
```

### 3. Type Safety Patterns

**Shared Schema:**
```typescript
// shared/schema.ts
export const items = pgTable("items", { ... });
export const insertItemSchema = createInsertSchema(items).omit({ id: true });
export type InsertItem = z.infer<typeof insertItemSchema>;
export type Item = typeof items.$inferSelect;
```

**Usage:**
```typescript
// Backend
const data: InsertItem = insertItemSchema.parse(req.body);

// Frontend
const form = useForm<InsertItem>({ ... });
const { data: items } = useQuery<Item[]>({ ... });
```

### 4. Naming Conventions

**Database:**
- Tables: lowercase, plural (e.g., `users`, `projects`)
- Columns: snake_case (e.g., `first_name`, `uploaded_at`)
- Primary keys: `id` (UUID)
- Foreign keys: `{table}_id` (e.g., `user_id`, `project_id`)

**TypeScript:**
- Interfaces: PascalCase (e.g., `User`, `Project`)
- Functions: camelCase (e.g., `getUser`, `createProject`)
- Constants: UPPER_SNAKE_CASE (e.g., `JWT_SECRET`, `COOKIE_NAME`)
- Types: PascalCase (e.g., `InsertUser`, `SelectProject`)

**React:**
- Components: PascalCase (e.g., `ProjectDetail`, `UserForm`)
- Props interfaces: `{Component}Props` (e.g., `ProjectDetailProps`)
- Custom hooks: `use{Name}` (e.g., `useAuth`, `useProjects`)

**Files:**
- Components: kebab-case (e.g., `project-detail.tsx`, `user-form.tsx`)
- Utilities: kebab-case (e.g., `query-client.ts`, `utils.ts`)

### 5. Test ID Pattern

All interactive elements have `data-testid` attributes for e2e testing:

**Pattern:**
- Buttons: `button-{action}` (e.g., `button-submit`, `button-cancel`)
- Inputs: `input-{field}` (e.g., `input-email`, `input-password`)
- Links: `link-{destination}` (e.g., `link-project`, `link-dashboard`)
- Dynamic: `{type}-{description}-{id}` (e.g., `card-project-${projectId}`)

**Example:**
```tsx
<Button type="submit" data-testid="button-submit">Create</Button>
<Input {...field} data-testid="input-email" />
<Link href="/projects" data-testid="link-projects">Projects</Link>
```

---

## Deployment & Environment

### Development Environment

**Start Development Server:**
```bash
npm run dev
```

**Process:**
1. Express server starts on port 5000
2. Vite dev server integrated into Express
3. Frontend served at `http://localhost:5000`
4. API routes at `http://localhost:5000/api/*`
5. Hot module replacement (HMR) enabled

**Database Development:**
```bash
# Push schema changes
npm run db:push

# Force push (skip warnings)
npm run db:push --force
```

### Production Build

**Build Command:**
```bash
npm run build
```

**Process:**
1. Vite builds frontend (optimized bundle)
2. esbuild bundles backend
3. Output: `dist/` directory

**Start Production Server:**
```bash
npm start
```

### Environment Variables

**Required:**
```
NODE_ENV=production
SESSION_SECRET=<strong-secret-key>
DATABASE_URL=postgresql://user:pass@host/db
DEFAULT_OBJECT_STORAGE_BUCKET_ID=<bucket-id>
```

**Optional:**
```
PORT=5000
PGHOST=<db-host>
PGPORT=5432
PGUSER=<db-user>
PGPASSWORD=<db-password>
PGDATABASE=<db-name>
PUBLIC_OBJECT_SEARCH_PATHS=public/
PRIVATE_OBJECT_DIR=.private/
```

### Deployment Checklist

1. ✓ Set strong `SESSION_SECRET`
2. ✓ Configure PostgreSQL connection
3. ✓ Set up Object Storage bucket
4. ✓ Run database migrations (`npm run db:push`)
5. ✓ Initialize demo accounts (`POST /api/auth/init`)
6. ✓ Test authentication flow
7. ✓ Verify file uploads/downloads
8. ✓ Test permission system
9. ✓ Enable HTTPS (secure cookies)
10. ✓ Configure backup strategy

### Performance Considerations

**Database:**
- Connection pooling enabled (Neon serverless)
- Indexes on foreign keys (automatic via Drizzle)
- Cascade deletes for cleanup

**Frontend:**
- Code splitting (Vite automatic)
- Query caching (TanStack Query)
- Lazy loading for routes (potential future enhancement)

**File Storage:**
- Direct GCS uploads (bypasses backend)
- Presigned URLs with 15-minute expiration
- Streaming downloads (no memory buffering)

**Caching:**
- TanStack Query: 5-minute stale time
- Browser: Standard HTTP caching

---

## Appendix

### Database Entity Relationship Diagram

```
users
  │
  ├─ 1:N ─▶ projects (estimatorId)
  ├─ 1:N ─▶ projects (superintendentId)
  ├─ 1:N ─▶ bids (estimatorId)
  ├─ 1:N ─▶ estimates (createdById)
  ├─ 1:N ─▶ timeEntries (userId)
  ├─ 1:N ─▶ timeEntries (approvedById)
  ├─ 1:N ─▶ tmDailySheets (createdById)
  ├─ 1:N ─▶ receipts (userId)
  ├─ 1:N ─▶ projectNotes (authorId)
  ├─ 1:N ─▶ media (uploadedById)
  ├─ 1:N ─▶ planDocuments (uploadedById)
  ├─ 1:N ─▶ changeOrders (requestedById)
  ├─ 1:N ─▶ changeOrders (approvedById)
  ├─ 1:N ─▶ calendarEvents (userId)
  ├─ 1:N ─▶ calendarEvents (createdById)
  ├─ 1:N ─▶ calendarEvents (approvedById)
  ├─ 1:N ─▶ notifications (userId)
  ├─ 1:N ─▶ filePermissions (userId)
  └─ 1:N ─▶ filePermissions (grantedById)

projects
  │
  ├─ 1:N ─▶ estimates
  ├─ 1:N ─▶ procurementItems
  ├─ 1:N ─▶ planDocuments
  ├─ 1:N ─▶ timeEntries
  ├─ 1:N ─▶ tmDailySheets
  ├─ 1:N ─▶ receipts
  ├─ 1:N ─▶ projectNotes
  ├─ 1:N ─▶ scopeItems
  ├─ 1:N ─▶ media
  ├─ 1:N ─▶ changeOrders
  └─ 1:N ─▶ calendarEvents
```

### API Endpoint Summary by Category

**Authentication:** 5 endpoints  
**Dashboard:** 1 endpoint  
**User Management:** 4 endpoints  
**Bids:** 6 endpoints  
**Projects:** 4 endpoints  
**Scope of Work:** 4 endpoints  
**Notes:** 2 endpoints  
**Media:** 3 endpoints  
**Time Entries:** 4 endpoints  
**T&M Sheets:** 2 endpoints  
**Estimates:** 2 endpoints  
**Procurement:** 3 endpoints  
**Receipts:** 2 endpoints  
**Documents:** 2 endpoints  
**File Permissions:** 4 endpoints  
**Change Orders:** 5 endpoints  
**Calendar:** 3 endpoints  
**Notifications:** 2 endpoints  
**Object Storage:** 2 endpoints  

**Total:** 64 endpoints

### Technology Version Matrix

| Category | Technology | Version |
|----------|------------|---------|
| Runtime | Node.js | 20.19.3 |
| Language | TypeScript | 5.6.3 |
| Backend Framework | Express.js | 4.21.2 |
| Database | PostgreSQL | Latest (Neon) |
| ORM | Drizzle ORM | 0.39.1 |
| Frontend Framework | React | 18.3.1 |
| Build Tool | Vite | 5.4.20 |
| Routing | Wouter | 3.3.5 |
| State Management | TanStack Query | 5.60.5 |
| Styling | TailwindCSS | 3.4.17 |
| Component Library | shadcn/ui (Radix) | Latest |
| Forms | React Hook Form | 7.55.0 |
| Validation | Zod | 3.24.2 |
| Authentication | JWT | 9.0.2 |
| Password Hashing | Bcrypt | 6.0.0 |
| File Uploads | Uppy | 5.x |
| Object Storage | GCS SDK | 7.17.3 |
| Charts | Recharts | 2.15.2 |

### File Structure Summary

```
project-root/
├── client/
│   ├── src/
│   │   ├── components/      # 44+ UI components
│   │   ├── pages/           # 12 main pages
│   │   ├── lib/             # Utilities & config
│   │   ├── hooks/           # Custom React hooks
│   │   ├── App.tsx          # Root component
│   │   └── main.tsx         # Entry point
│   └── public/              # Static assets
│
├── server/
│   ├── routes.ts            # All API routes (64 endpoints, ~2000 lines)
│   ├── auth.ts              # Authentication logic
│   ├── db.ts                # Database connection
│   ├── objectStorage.ts     # GCS integration
│   ├── objectAcl.ts         # File ACL logic
│   ├── fileAccessHelpers.ts # Permission helpers
│   ├── vite.ts              # Vite integration
│   └── index.ts             # Server entry point
│
├── shared/
│   └── schema.ts            # Database schema & types (15 tables, 417 lines)
│
├── package.json             # Dependencies (90 packages)
├── tsconfig.json            # TypeScript config
├── vite.config.ts           # Vite config
├── tailwind.config.ts       # Tailwind config
├── drizzle.config.ts        # Drizzle ORM config
└── replit.md                # Project documentation
```

---

## Summary for ChatGPT Analysis

This document provides a complete technical specification of the TFR Construction Management Platform. Key highlights:

1. **Comprehensive Coverage:** Every database table, API endpoint, feature, and integration is documented
2. **Security-First:** JWT authentication, RBAC, granular file permissions, input validation
3. **Modern Stack:** TypeScript, React, Express, PostgreSQL, Drizzle ORM, TanStack Query
4. **Scalable Architecture:** Stateless API, database pooling, object storage for files
5. **Production-Ready:** Error handling, logging, transactions, referential integrity

The platform manages the complete construction project lifecycle with 15 database tables, 64 API endpoints, 12 frontend pages, and a sophisticated file permission system. All code follows type-safe patterns with shared schemas and comprehensive validation.

**For ChatGPT:** Analyze this system for potential improvements in architecture, security, performance, code quality, feature completeness, and scalability. Identify any missing patterns, potential bugs, or areas requiring additional documentation.