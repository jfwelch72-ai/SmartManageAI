# Account Roles & RBAC

## Role Definitions

SmartManageAI uses 10 user roles with hierarchical permissions.

### SUPER_ADMIN
**Purpose:** Platform-level administrator with access to all organizations.

**Capabilities:**
- Access all organizations
- Manage platform settings
- View audit logs across platform
- Access support tools
- Manage subscriptions

**Data Access:** All data across all organizations

---

### ADMIN
**Purpose:** Organization administrator with full access within their company.

**Capabilities:**
- Full access to all organization features
- User management (create, edit, deactivate)
- Company settings configuration
- Billing and subscription management
- All project and financial access
- AI feature configuration

**Data Access:** All data within their organization

---

### MANAGER
**Purpose:** Project manager overseeing multiple projects.

**Capabilities:**
- Project management (create, edit)
- Bid management and estimating
- View and manage all projects
- Approve time entries
- Access financial reports
- Manage crews and assignments
- CRM access

**Data Access:** All projects within organization

---

### SUPERINTENDENT
**Purpose:** Field supervisor managing daily operations.

**Capabilities:**
- Time clock approval for assigned projects
- Daily notes and progress tracking
- Delay documentation
- Inspection management
- T&M ticket creation
- Equipment assignment
- Crew management

**Data Access:** Assigned projects only

---

### ESTIMATOR
**Purpose:** Specialist in bidding and cost estimation.

**Capabilities:**
- Bid creation and management
- Estimate development
- Takeoff measurements
- Vendor quote collection
- Cost analysis
- Proposal generation

**Data Access:** All bids and related estimates

---

### OFFICE_MANAGER
**Purpose:** Administrative staff handling office operations.

**Capabilities:**
- Payroll processing
- Billing and invoicing
- Document management
- Vendor coordination
- Schedule of values
- Subcontractor payables
- Calendar management

**Data Access:** Financial and administrative data

---

### HOURLY_EMPLOYEE
**Purpose:** Field worker with basic access.

**Capabilities:**
- Clock in/out
- View assigned projects
- Submit time entries
- View own time records
- Basic messaging

**Data Access:** Own records and assigned project info

---

### MAINTENANCE_MANAGER
**Purpose:** Equipment and maintenance specialist.

**Capabilities:**
- Equipment management
- Maintenance scheduling
- Work order creation
- Repair tracking
- Rental coordination
- Utilization analysis

**Data Access:** Equipment and maintenance data

---

### VENDOR
**Purpose:** External vendor portal access.

**Capabilities:**
- View pricing requests
- Submit quotes
- Manage vendor profile
- View purchase orders
- Communication access

**Data Access:** Vendor-specific data only

---

### HUSTLER
**Purpose:** Multi-organization business owner.

**Capabilities:**
- Switch between organizations
- Executive dashboard across orgs
- Consolidated reporting
- Delegate access to COO/CFO
- Portfolio analysis
- Benchmarking across companies

**Data Access:** All data across owned organizations

---

## Permission Matrix

| Feature/Route | SUPER_ADMIN | ADMIN | MANAGER | SUPT | EST | OFFICE | HOURLY | MAINT | VENDOR | HUSTLER |
|--------------|:-----------:|:-----:|:-------:|:----:|:---:|:------:|:------:|:-----:|:------:|:-------:|
| Dashboard | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Projects | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | - | ✅ |
| Project Detail | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🔒 | ✅ | - | ✅ |
| Bids | ✅ | ✅ | ✅ | - | ✅ | - | - | - | - | ✅ |
| Bid Detail | ✅ | ✅ | ✅ | - | ✅ | ✅ | - | - | - | ✅ |
| Estimates | ✅ | ✅ | ✅ | - | ✅ | - | - | - | - | ✅ |
| Users | ✅ | ✅ | ✅ | - | - | - | - | - | - | ✅ |
| Time Clock | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | - | ✅ |
| Time Clock Manager | ✅ | ✅ | ✅ | ✅ | - | ✅ | - | - | - | ✅ |
| Time Entry | ✅ | ✅ | ✅ | ✅ | - | ✅ | 🔒 | - | - | ✅ |
| Payroll | ✅ | ✅ | - | - | - | ✅ | - | - | - | ✅ |
| CFO Dashboard | ✅ | ✅ | - | - | - | ✅ | - | - | - | ✅ |
| AI PM | ✅ | ✅ | ✅ | ✅ | - | - | - | - | - | ✅ |
| AI Settings | ✅ | ✅ | - | - | - | - | - | - | - | ✅ |
| Equipment | ✅ | ✅ | ✅ | ✅ | - | - | - | ✅ | - | ✅ |
| CRM | ✅ | ✅ | ✅ | - | - | - | - | - | - | ✅ |
| Crews | ✅ | ✅ | ✅ | ✅ | - | - | - | - | - | ✅ |
| Company Settings | ✅ | ✅ | - | - | - | - | - | - | - | ✅ |
| Delay Claims | ✅ | ✅ | ✅ | ✅ | - | - | - | - | - | ✅ |
| Bid Network | ✅ | ✅ | ✅ | - | ✅ | - | - | - | - | ✅ |
| Website Builder | ✅ | ✅ | - | - | - | - | - | - | - | ✅ |
| Platform Admin | ✅ | - | - | - | - | - | - | - | - | - |

Legend:
- ✅ = Full access
- 🔒 = Limited/own records only
- `-` = No access

---

## Data Boundaries

### Organization Scoping
All data is scoped to organizations. Users can only access data belonging to their organization.

```typescript
// Every query includes org filter
const projects = await db.select()
  .from(projects)
  .where(eq(projects.organizationId, user.organizationId));
```

### Project Scoping
Some roles (SUPERINTENDENT, HOURLY_EMPLOYEE) may be limited to assigned projects:

```typescript
// Check project assignment
const hasAccess = await checkProjectAssignment(userId, projectId);
```

### Cross-Organization Access
Only SUPER_ADMIN and HUSTLER roles can access multiple organizations:

```typescript
// HUSTLER can switch orgs
const orgs = await getHustlerOrganizations(userId);
```

---

## Implementation Details

### Backend Enforcement

**File:** `server/auth.ts`

```typescript
export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    next();
  };
}
```

**File:** `server/orgFilter.ts`

```typescript
export function applyOrgFilter(query: any, organizationId: string) {
  return query.where(eq(table.organizationId, organizationId));
}
```

### Frontend Enforcement

**File:** `client/src/lib/protected-route.tsx`

```typescript
export function ProtectedRoute({ 
  component: Component, 
  permission 
}: ProtectedRouteProps) {
  const { user } = useAuth();
  
  if (permission && !hasPermission(user.role, permission)) {
    return <Navigate to="/dashboard" />;
  }
  
  return <Component />;
}
```

### Route Permissions

**File:** `client/src/App.tsx`

```typescript
const RoutePermissions = {
  USERS: ["ADMIN", "MANAGER"],
  BIDS: ["ADMIN", "MANAGER", "ESTIMATOR"],
  TIME_CLOCK_MANAGER: ["ADMIN", "MANAGER", "SUPERINTENDENT", "OFFICE_MANAGER"],
  CFO: ["ADMIN", "OFFICE_MANAGER"],
  // ... more permissions
};
```

---

## Feature Gating (Subscription-Based)

Beyond role-based access, features are gated by subscription tier and add-ons.

### Subscription Tiers

| Tier | Features |
|------|----------|
| FREE | Basic project management, limited users |
| STARTER | More users, basic reporting |
| PROFESSIONAL | Full features, advanced reporting |
| ENTERPRISE | Unlimited, custom integrations |

### Add-ons

| Add-on | Key | Features |
|--------|-----|----------|
| AI PM | `ai_pm` | AI Project Manager, task automation |
| AI CFO | `ai_cfo` | Financial analysis, forecasting |
| AI Email | `ai_email` | Email classification, task extraction |
| Website Builder | `website_seo` | Website creation, SEO |
| Bid Network | `bid_network` | Platform bid solicitation |
| AI Vision | `ai_vision` | Auto-takeoff, photo analysis |

### Backend Feature Check

**File:** `server/middleware/requireFeature.ts`

```typescript
export function requireFeature(feature: string) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const hasFeature = await checkOrgFeature(req.user.organizationId, feature);
    if (!hasFeature) {
      return res.status(403).json({ error: "Feature not available" });
    }
    next();
  };
}
```

### Frontend Feature Check

**File:** `client/src/hooks/useEntitlements.ts`

```typescript
const { hasFeature } = useEntitlements();

if (hasFeature('ai_pm')) {
  // Show AI PM features
}
```

---

## Audit Trail

All permission-sensitive actions are logged:

**Table:** `auditLog`

| Field | Description |
|-------|-------------|
| userId | Who performed the action |
| action | CREATE, UPDATE, DELETE, etc. |
| entityType | What was affected |
| entityId | Specific record ID |
| organizationId | Tenant context |
| changes | Before/after data |
| createdAt | Timestamp |

**File:** `server/auditLogger.ts`

```typescript
export async function logCreate(
  entityType: string,
  entityId: string,
  userId: string,
  organizationId: string,
  data: any
) {
  await db.insert(auditLog).values({
    userId,
    action: "CREATE",
    entityType,
    entityId,
    organizationId,
    changes: JSON.stringify(data),
  });
}
```
