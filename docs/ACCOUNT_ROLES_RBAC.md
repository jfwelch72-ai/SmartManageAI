# Account Roles & RBAC

> **Last updated:** May 2026. Source of truth for roles is `client/src/lib/rbac.ts` and `server/auth.ts`. This document reflects the live codebase as of Task #2495 (auth audit events) and Task #2851 (Anthropic primary AI).

## Role Definitions

SmartManageAI uses **18 user roles** with hierarchical permissions, divided into four tiers: Platform, Organization Admin, Management, and Field/External.

---

### SUPER_ADMIN
**Purpose:** Platform-level administrator with cross-tenant access.

**Capabilities:**
- Access all organizations (via explicit `runAsSuperadmin` escape hatch)
- Manage platform settings, feature flags, subscriptions
- View audit logs across all organizations
- Access support tools and job queue admin
- Every cross-tenant DB elevation writes a row to `superadmin_access_log` before elevating

**Data Access:** All data across all organizations — but only through `runAsSuperadmin(reason, fn)`, which fails closed if the audit insert fails.

**Key Files:** `server/platformAdminRoutes.ts`, `server/dbContext.ts`

---

### ADMIN
**Purpose:** Organization administrator with full access within their company.

**Capabilities:**
- Full access to all organization features
- User management (create, edit, deactivate, role assignment)
- Company settings and branding configuration
- Billing and subscription management
- All project and financial access
- AI feature configuration and feature flag management

**Data Access:** All data within their organization

---

### MANAGER
**Purpose:** Project manager overseeing multiple projects.

**Capabilities:**
- Project management (create, edit, status transitions)
- Bid management and estimating
- View and manage all projects within org
- Approve time entries
- Access financial reports and CFO dashboard
- Manage crews and assignments
- CRM access

**Data Access:** All projects within organization

---

### SUPERINTENDENT
**Purpose:** Field supervisor managing daily operations.

**Capabilities:**
- Time clock approval for assigned projects
- Daily notes and progress tracking
- Delay documentation and submission
- Inspection management
- T&M ticket creation
- Equipment assignment
- Crew management
- View-only access to bids

**Data Access:** Assigned projects only

---

### ESTIMATOR
**Purpose:** Specialist in bidding and cost estimation.

**Capabilities:**
- Bid creation and management
- Estimate development
- Takeoff measurements (including AI auto-takeoff)
- Vendor quote collection
- Cost analysis
- Proposal generation
- Can edit projects they are assigned to as estimator

**Data Access:** All bids and related estimates within organization

---

### OFFICE_MANAGER
**Purpose:** Administrative staff handling office operations.

**Capabilities:**
- Payroll processing (pay runs, time approvals)
- Billing and invoicing (SoV, AIA pay applications)
- Document management
- Vendor coordination and payables
- Schedule of values management
- Subcontractor payables
- Calendar management

**Data Access:** Financial and administrative data

---

### PROJECT_ENGINEER
**Purpose:** RFIs, submittals, document control, drawings, change events.

**Capabilities:**
- RFI creation and tracking
- Submittal management
- Drawing management
- Change event initiation
- No payroll or banking access

**Data Access:** Project documents within assigned projects

---

### HOURLY_EMPLOYEE
**Purpose:** Field worker with basic access.

**Capabilities:**
- Clock in/out (GPS-tracked)
- View assigned ACTIVE projects
- Submit time entries
- View own time records
- Basic messaging

**Data Access:** Own records and assigned project info only

---

### MAINTENANCE_MANAGER
**Purpose:** Equipment and maintenance specialist.

**Capabilities:**
- Equipment registry management
- Maintenance scheduling and work orders
- Repair tracking and rental coordination
- Utilization analysis
- Limited access to other modules

**Data Access:** Equipment and maintenance data

---

### HUSTLER
**Purpose:** Multi-organization business owner or executive overseeing several contracting firms.

**Capabilities:**
- Switch between linked organizations
- Executive dashboard with consolidated metrics across all linked orgs
- Consolidated reporting and benchmarking
- Portfolio analysis and cross-org comparison
- Management-level access within each linked organization
- Can delegate access to COO/CFO via link requests

**Data Access:** Management-level access across all linked organizations

**Implementation Details:**
- Role stored as `HUSTLER` on the user's `role` field
- Org membership tracked in `hustler_organizations` table
- `effectiveRole` field in `hustler_organizations` grants the HUSTLER user a scoped privilege level within each linked org
- Org switching via `POST /api/hustler/switch-org` updates the active org context
- Link requests approved via `/hustler/link-requests/respond`, `/accept-invite`, `/accept-token`
- ROLE_GRANTED / ROLE_REVOKED audit entries written on link add/remove

**Key Files:** `server/hustlerRoutes.ts`, `shared/schema/features/hustler.ts`

---

### VENDOR
**Purpose:** External vendor portal access.

**Capabilities:**
- View pricing requests from enrolled clients
- Submit quotes to enrolled clients
- Manage vendor profile
- View purchase orders directed to them
- Communication access

**Data Access:** Vendor-specific data only (no contractor internal data)

---

### Additional Management Roles
| Role | Primary Responsibility |
|------|----------------------|
| **DISPATCHER** | Crew and technician schedules, assignments, daily dispatch plans. No payroll or banking. |
| **SAFETY_MANAGER** | Safety logs, incidents, training, certifications, jobsite roster. No payroll or banking. |
| **HR_MANAGER** | Hiring, onboarding, employee profiles, certifications, performance. No banking or invoices. |
| **EQUIPMENT_MANAGER** | Equipment registry, assignments, maintenance, utilization. No payroll or banking. |
| **PROCUREMENT_MANAGER** | Material requests, POs, vendor catalogs, deliveries. No payroll or banking. |
| **SALES** | CRM, leads, pipeline, proposals. No payroll, banking, or full financials. |
| **MARKETING** | Marketing campaigns, lead sources, CRM analytics. No payroll or banking. |

---

## Permission Matrix

| Feature/Route | SUPER_ADMIN | ADMIN | MANAGER | SUPT | EST | OFFICE | HOURLY | MAINT | VENDOR | HUSTLER |
|--------------|:-----------:|:-----:|:-------:|:----:|:---:|:------:|:------:|:-----:|:------:|:-------:|
| Dashboard | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Projects | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | - | ✅ |
| Project Detail | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🔒 | ✅ | - | ✅ |
| Bids | ✅ | ✅ | ✅ | 👁 | ✅ | - | - | - | - | ✅ |
| Bid Detail | ✅ | ✅ | ✅ | 👁 | ✅ | ✅ | - | - | - | ✅ |
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
| Hustler Dashboard | - | - | - | - | - | - | - | - | - | ✅ |
| Compliance Dashboard | ✅ | ✅ | ✅ | - | - | - | - | - | - | ✅ |
| Platform Admin | ✅ | - | - | - | - | - | - | - | - | - |

Legend:
- ✅ = Full access
- 🔒 = Limited/own records only
- 👁 = View only
- `-` = No access

---

## Data Boundaries

### Organization Scoping (Application Layer)
All data is scoped to organizations through the org context middleware, which sets Postgres session variables consumed by RLS policies.

```typescript
// orgContextMiddleware wraps every authenticated request:
withOrgContext({ organizationId: req.user.organizationId, isSuperadmin: false }, async () => {
  // Every db.select() here is implicitly filtered by RLS
});
```

### Postgres Row-Level Security (Database Layer)
Every multi-tenant table has a `tenant_isolation` RLS policy enabled with `FORCE`:

```sql
CREATE POLICY tenant_isolation ON <table>
  USING (
    current_setting('app.is_superadmin', true) = 'true'
    OR organization_id = current_setting('app.current_org_id', true)
  );
```

Even if application code forgets a WHERE clause, the database drops cross-tenant rows. `STRICT_TENANT_RLS=true` must be set in production; the server fails fast on boot otherwise.

### Project Scoping
Some roles (SUPERINTENDENT, HOURLY_EMPLOYEE) are limited to projects they are explicitly assigned to.

### Cross-Organization Access
Only SUPER_ADMIN (via `runAsSuperadmin`) and HUSTLER (within linked orgs via `hustler_organizations`) can access multiple organizations.

---

## Implementation Details

### Backend Enforcement

**File:** `server/auth.ts`

```typescript
export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const effectiveRole = req.user?.effectiveRole ?? req.user?.role;
    if (!effectiveRole || !roles.includes(effectiveRole)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    next();
  };
}
```

**HUSTLER effectiveRole:** When a HUSTLER switches into an org, `effectiveRole` from `hustler_organizations` (e.g., `MANAGER`) is used instead of the literal `HUSTLER` role for permission checks within that org.

**File:** `server/middleware/orgContext.ts`

```typescript
// Wraps every authenticated request automatically
export const orgContextMiddleware = (req, res, next) => {
  withOrgContext({ organizationId: req.user.organizationId, isSuperadmin: false }, next);
};
```

**SUPER_ADMIN cross-tenant access:**
```typescript
// Must use explicit escape hatch — writes audit row before elevating
await runAsSuperadmin("support-ticket-42", async () => {
  // Queries here see all orgs
}, { actorId: req.user.id });
```

### Frontend Enforcement

**File:** `client/src/lib/rbac.ts`

```typescript
export const RoutePermissions = {
  USERS: ["ADMIN", "MANAGER"],
  BIDS: ["ADMIN", "MANAGER", "ESTIMATOR"],
  TIME_CLOCK_MANAGER: ["ADMIN", "MANAGER", "SUPERINTENDENT", "OFFICE_MANAGER"],
  CFO: ["ADMIN", "OFFICE_MANAGER"],
  HUSTLER: ["HUSTLER"],
  PLATFORM_ADMIN: ["SUPER_ADMIN"],
  // ... more permissions
};
```

---

## Session Management & Token Security

### Token Versioning
Every user has a `tokenVersion` integer. When a password changes or tokens are revoked, `tokenVersion` increments. Auth middleware validates `tokenVersion` on every request — stale JWTs are rejected immediately even within their TTL window.

```typescript
// Force-revoke all sessions for a user:
await db.update(users).set({ tokenVersion: sql`token_version + 1` })
  .where(eq(users.id, userId));
```

### Multi-Factor Authentication (MFA)
- Users can enroll in TOTP-based 2FA via `/api/account/2fa/verify` (enable) and `/api/account/2fa/disable`
- MFA enable/disable events are written to `audit_log` as `MFA_ENABLED` / `MFA_DISABLED` actions
- Enforced based on organization policy

### Account Security Features
| Feature | Description |
|---------|-------------|
| bcrypt(10) | Password hashing |
| `tokenVersion` | Instant revocation — all sessions invalidated on password change |
| Failed login lockout | `failedLoginAttempts` + `lockedUntil` fields |
| Password reset | Token-based, expiring, email via SendGrid |
| Email verification | `verified` flag; required for sensitive operations |
| Rate limiting | `authLimiter` (15/15min) on login, register, forgot-password, reset-password |

---

## Feature Gating (Subscription-Based)

Beyond role-based access, features are gated by subscription tier and add-ons.

### Subscription Tiers
| Tier | Features |
|------|----------|
| FREE | Basic project management, limited users |
| STARTER | More users, basic reporting |
| PROFESSIONAL | Full features, advanced reporting |
| ENTERPRISE | Unlimited, custom integrations, SSO |

### Add-ons
| Add-on | Key | Features |
|--------|-----|----------|
| AI PM | `ai_pm` | AI Project Manager, task automation |
| AI CFO | `ai_cfo` | Financial analysis, forecasting |
| AI Email | `ai_email` | Email classification, task extraction |
| Website Builder | `website_seo` | Website creation, SEO |
| Bid Network | `bid_network` | Platform bid solicitation |
| AI Vision | `ai_vision` | Auto-takeoff, photo analysis |

### Feature Flag Permissions (Per-Org)
Configurable via Super Admin UI:
- `canAccessFinancials`, `canManagePayroll`, `canAccessReports`
- `canUseAiFeatures`, `canManageWebsite`, `canPostSocialMedia`
- `canManageEquipment`, `canManageProcurement`, `canManageContracts`
- `canManageHiring`, `canManageSafety`, `canManageScheduling`
- `canAccessBidNetwork`, `canManageLeave`, `canAccessTimeMaterial`
- `AI_PROVIDER_TAKEOFF`, `AI_PROVIDER_GENERAL` — per-org Claude vs. OpenAI routing

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

---

## Audit Trail Coverage

All permission-sensitive actions are logged to the append-only `audit_log` table. No DELETE or UPDATE routes are exposed on audit_log.

**File:** `server/auditLogger.ts`

### Money-Path Coverage
| Money Path | Covered |
|------------|---------|
| Pay runs (create/status/delete) | ✅ |
| Change orders (create/status/approve) | ✅ |
| Billing events (create) | ✅ |
| AIA pay applications (create/status/record-payment) | ✅ |

### Auth & Security Coverage (added Task #2495)
| Event | Action Written |
|-------|---------------|
| Successful login | `LOGIN` |
| Failed login | `LOGIN_FAILED` |
| Logout | `LOGOUT` |
| Password change | `PASSWORD_CHANGE` |
| Password reset (complete) | `PASSWORD_RESET` |
| Password reset (requested) | `PASSWORD_RESET_REQUESTED` |
| MFA enabled | `MFA_ENABLED` |
| MFA disabled | `MFA_DISABLED` |
| Platform role change (`users.role`) | `ROLE_CHANGED` |
| HUSTLER org link granted | `ROLE_GRANTED` |
| HUSTLER org link revoked | `ROLE_REVOKED` |

**`userId` type guarantee:** `logAudit` runtime-asserts that `userId` is a non-empty string to guard against the "pass the whole Express Request" footgun. A lint script at `scripts/audit-audit-logger-userid.mjs` enforces this.

### Audit Log Table Schema
| Field | Description |
|-------|-------------|
| userId | Who performed the action |
| action | CREATE, UPDATE, DELETE, APPROVE, REJECT, LOGIN, LOGOUT, etc. |
| entityType | What was affected (e.g., "projects", "upload_av_scan") |
| entityId | Specific record ID |
| organizationId | Tenant context |
| newValue | JSON payload with before/after data |
| createdAt | Timestamp |
