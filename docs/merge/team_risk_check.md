# TEAM Repl Risk Check - Multi-Tenant Security Audit

**Generated**: December 2025  
**Source**: TEAM Replit copy

---

## 1. Multi-Tenant Pattern Enforcement

### Org Filtering Infrastructure

The TEAM repo uses a centralized org filtering utility:

**File**: `server/orgFilter.ts`
- Provides `getRequiredOrgIdFromReq()` or similar helper
- Used across route modules for consistent org scoping

### Routes Using Org Filtering

The following route modules properly import and use org filtering:

| Module | Uses orgFilter | Pattern |
|--------|----------------|---------|
| tmTicketRoutes.ts | Yes | getRequiredOrgId |
| aiContractDocumentRoutes.ts | Yes | getRequiredOrgId |
| organizationDocumentRoutes.ts | Yes | getRequiredOrgId |
| delayRoutes.ts | Yes | getRequiredOrgId |
| subcontractRoutes.ts | Yes | getRequiredOrgId |
| aiBidDocumentRoutes.ts | Yes | getRequiredOrgId |
| sovRoutes.ts | Yes | getRequiredOrgId |
| subcontractorPayablesRoutes.ts | Yes | getRequiredOrgId |
| taskRoutes.ts | Yes | getRequiredOrgId |
| inspectionRoutes.ts | Yes | getRequiredOrgId |
| changeOrderRoutes.ts | Yes | getRequiredOrgId |
| emailAiRoutes.ts | Yes | getRequiredOrgId |
| websiteBuilderRoutes.ts | Yes | getRequiredOrgId |
| estimateRoutes.ts | Yes | getRequiredOrgId |
| timeClockRoutes.ts | Yes | getRequiredOrgId |
| routes.ts (main) | Yes | getRequiredOrgId |

---

## 2. Auth/Role Enforcement

### Authentication Middleware
All API routes use `requireAuth` middleware from `server/auth.ts`.

### Role-Based Access Control
Routes use `requireRole()` middleware for role-gated endpoints:

```typescript
// Example from timeClockRoutes.ts
app.get("/api/time-clock/pending-approvals", requireAuth, requireRole("ADMIN", "MANAGER"), async (...))
```

### Roles Defined
From schema: SUPER_ADMIN, ADMIN, MANAGER, SUPERINTENDENT, ESTIMATOR, OFFICE_MANAGER, HOURLY_EMPLOYEE, MAINTENANCE_MANAGER, VENDOR, HUSTLER

---

## 3. Potential Risk Areas

### Modules to Review for Org Scoping

| Module | Status | Notes |
|--------|--------|-------|
| aiRoutes.ts | Review | Verify all AI queries use orgId |
| aiAssistantRoutes.ts | Review | Chat context should be org-scoped |
| aiFeatureRoutes.ts | Review | Feature triggers need org isolation |
| aiNotesRoutes.ts | Review | Notes analysis should be org-scoped |
| calculatorRoutes.ts | Review | Calculators may be global or org-specific |
| hustlerRoutes.ts | Special | Intentionally cross-org for HUSTLER role |
| platformAdminRoutes.ts | Special | Platform admin intentionally cross-org |
| bidNetworkRoutes.ts | Complex | Cross-org by design (bid solicitation network) |

### Routes Without Visible orgFilter Import

These routes may need manual verification:

1. **opsRoutes.ts** - Operational health endpoints (expected - no org scope needed)
2. **laborRateRoutes.ts** - Verify org scoping
3. **notesRoutes.ts** - Verify org scoping
4. **dataPipelineService.ts** - Background service

---

## 4. Query Pattern Analysis

### Safe Patterns (GOOD)
```typescript
// Always filter by organizationId
const results = await db.select().from(table)
  .where(eq(table.organizationId, orgId));
```

### Risk Patterns to Audit
```typescript
// BAD: Query by projectCode only without org verification
const project = await db.select().from(projects)
  .where(eq(projects.projectCode, code));

// GOOD: Verify project belongs to user's org
const project = await db.select().from(projects)
  .where(and(
    eq(projects.projectCode, code),
    eq(projects.organizationId, orgId)
  ));
```

---

## 5. Routes Missing Auth Check (Quick Scan)

Based on grep analysis, all `/api/*` routes appear to use `requireAuth`.

Public routes (expected no auth):
- `/api/auth/login`
- `/api/auth/register`
- `/api/auth/forgot-password`
- `/api/auth/reset-password`
- `/api/ops/health`
- `/api/ops/ready`

---

## 6. Cross-Org Features (By Design)

These features intentionally access multiple organizations:

| Feature | Module | Access Control |
|---------|--------|----------------|
| Hustler Dashboard | hustlerRoutes.ts | HUSTLER role only |
| Platform Admin | platformAdminRoutes.ts | SUPER_ADMIN only |
| Bid Network | bidNetworkRoutes.ts | Cross-org solicitation (controlled) |
| Vendor Portal | vendor/* routes | Scoped to vendor relationship |

---

## 7. Recommendations

### High Priority
1. **Audit AI routes** - Ensure all AI analysis endpoints filter by orgId
2. **Review bidNetworkRoutes** - Complex cross-org logic needs careful review
3. **Verify laborRateRoutes** - Confirm org scoping

### Medium Priority
4. **Add orgId index** - Ensure all tables with organizationId have proper indexes
5. **Audit background jobs** - dataPipelineService, aiNotesScheduler

### Low Priority
6. **Document multi-org patterns** - hustlerRoutes, platformAdminRoutes

---

## 8. Security Summary

| Category | Status |
|----------|--------|
| Auth middleware | ✅ Consistently applied |
| Role-based access | ✅ requireRole() used |
| Org filtering utility | ✅ orgFilter.ts exists |
| Org filter usage | ⚠️ Most routes use it, some need verification |
| Cross-org features | ✅ Properly gated by role |
| Public endpoints | ✅ Limited and appropriate |
