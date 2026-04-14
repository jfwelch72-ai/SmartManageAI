/**
 * @openapi
 * /api/dashboard/stats:
 *   get:
 *     tags: [Reports]
 *     summary: Get dashboard statistics
 *     description: Returns KPI metrics and summary statistics for the user's organization.
 *     responses:
 *       200: { description: Dashboard statistics }
 * /api/dashboard/kpi:
 *   get:
 *     tags: [Reports]
 *     summary: Get KPI dashboard data
 *     responses:
 *       200: { description: KPI metrics }
 * /api/dashboard/snapshot:
 *   get:
 *     tags: [Reports]
 *     summary: Get executive snapshot
 *     description: Requires ADMIN, MANAGER, or SUPERINTENDENT role.
 *     responses:
 *       200: { description: Dashboard snapshot }
 * /api/dashboard/aggregate-time-tracking:
 *   post:
 *     tags: [Reports]
 *     summary: Aggregate time tracking data
 *     description: Requires ADMIN, MANAGER, or SUPERINTENDENT role.
 *     responses:
 *       200: { description: Aggregated time tracking data }
 * /api/dashboard/trend:
 *   get:
 *     tags: [Reports]
 *     summary: Get dashboard trend data
 *     responses:
 *       200: { description: Trend data over time }
 * /api/dashboard/list:
 *   get:
 *     tags: [Reports]
 *     summary: Get dashboard list view
 *     responses:
 *       200: { description: Dashboard list data }
 * /api/dashboard/alerts:
 *   get:
 *     tags: [Reports]
 *     summary: Get dashboard alerts
 *     responses:
 *       200: { description: Active alerts and warnings }
 * /api/dashboard/workforce-snapshot:
 *   get:
 *     tags: [Reports]
 *     summary: Get workforce snapshot
 *     description: Headcount, attendance, and labor metrics. Requires payroll access.
 *     responses:
 *       200: { description: Workforce snapshot }
 * /api/dashboard/cash-position:
 *   get:
 *     tags: [Reports]
 *     summary: Get cash position dashboard
 *     description: Requires financials access.
 *     responses:
 *       200: { description: Cash position data }
 * /api/dashboard/sov-progress:
 *   get:
 *     tags: [Reports]
 *     summary: Get SOV progress dashboard
 *     description: Requires financials access.
 *     responses:
 *       200: { description: Schedule of values progress }
 * /api/dashboard/bid-pipeline:
 *   get:
 *     tags: [Reports]
 *     summary: Get bid pipeline dashboard
 *     responses:
 *       200: { description: Bid pipeline data }
 * /api/dashboard/cost-code-breakdown:
 *   get:
 *     tags: [Reports]
 *     summary: Get cost code breakdown
 *     description: Requires financials access.
 *     responses:
 *       200: { description: Cost breakdown by code }
 * /api/dashboard/schedule-impact:
 *   get:
 *     tags: [Reports]
 *     summary: Get schedule impact dashboard
 *     responses:
 *       200: { description: Schedule impact analysis }
 * /api/dashboard/labor-utilization:
 *   get:
 *     tags: [Reports]
 *     summary: Get labor utilization dashboard
 *     description: Requires payroll access.
 *     responses:
 *       200: { description: Labor utilization data }
 * /api/dashboard/safety-summary:
 *   get:
 *     tags: [Reports]
 *     summary: Get safety summary dashboard
 *     responses:
 *       200: { description: Safety metrics and trends }
 * /api/dashboard/change-orders-pending:
 *   get:
 *     tags: [Reports]
 *     summary: Get pending change orders dashboard
 *     description: Requires financials access.
 *     responses:
 *       200: { description: Pending change order summary }
 * /api/users:
 *   get:
 *     tags: [Admin]
 *     summary: List users
 *     description: Requires ADMIN or MANAGER role with canAccessProgressBilling permission.
 *     responses:
 *       200: { description: List of users }
 *   post:
 *     tags: [Admin]
 *     summary: Create a user
 *     description: Requires ADMIN role.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       201: { description: User created }
 * /api/users/{id}:
 *   get:
 *     tags: [Admin]
 *     summary: Get user details
 *     description: Requires ADMIN, HUSTLER, MANAGER, SUPERINTENDENT, or ESTIMATOR role.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: User details }
 *   patch:
 *     tags: [Admin]
 *     summary: Update a user
 *     description: Requires ADMIN role.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200: { description: User updated }
 * /api/users/{id}/cost-rates:
 *   patch:
 *     tags: [Admin]
 *     summary: Update user cost rates
 *     description: Requires ADMIN role.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Cost rates updated }
 * /api/users/{id}/revoke-tokens:
 *   post:
 *     tags: [Admin]
 *     summary: Revoke all auth tokens for a user
 *     description: Requires ADMIN role.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Tokens revoked }
 * /api/auth/set-initial-password:
 *   post:
 *     tags: [Authentication]
 *     summary: Set initial password for invited user
 *     responses:
 *       200: { description: Password set }
 */
import {logError, logWarn } from "./utils/logger";
import { validateBody } from "./utils/validation";
import { Router, type Response, NextFunction } from "express";
import { db } from "./db";
import { userDashboardPermissions, userDashboardLayouts, users, type DashboardLayoutConfig, userColorPalettes, orgColorPalettes, type UserColorPalette, type OrgColorPalette, type PaletteValidationResult, type ColorContrastResult, insertUserSchema, projects, changeOrders, calendarEvents, projectDelays, bids, organizations, timeEntries, payRuns, subcontractorContracts, crmOrganisations, organizationDocuments, subcontractorPayments, subcontractorBillingSchedule, procurementItems, scheduleOfValues, sovLineItems, estimates, estimateLineItems, rfis, safetyTrainings, safetyTrainingAssignments, leaveRequests, permissionPresets, hustlerOrganizations } from "@shared/schema";
import { requireAuth, requireRole, type AuthRequest, requireRoleOrFeature, hashPassword, verifyPassword, revokeUserTokens } from "./auth";
import type { UserRole } from "@shared/schema";
import { eq, and, sql, gte, lte, desc, asc, inArray } from "drizzle-orm";
import { z } from "zod";
import { KNOWN_WIDGET_TYPES, migrateV2ToV3, getDefaultLayoutForRole, PRESET_PALETTES } from "./dashboardDefaults";
import { sensitiveLimiter } from "./rateLimiter";
import { logAudit, logUpdate } from "./auditLogger";
import { sanitizeShortText, sanitizeEmail, sanitizePhone } from "./sanitization";
import { getOrgIdForFilter, verifyUserOrgAccess } from "./orgFilter";
import { orgScopedCache } from "./cache";
import { passwordSchema } from "@shared/utils/passwordPolicy";

const router = Router();

// ========================================
// Routes from dashboardLayoutRoutes.ts
// ========================================

type FeaturePermissionKeys =
  | 'canAccessDashboard' | 'canAccessProjects' | 'canCreateProjects' | 'canEditProjects'
  | 'canAccessCalendar' | 'canAccessTasks' | 'canAccessMessages' | 'canAccessBulletins' | 'canAccessEmailAssistant'
  | 'canViewBids' | 'canEditBids' | 'canDeleteBids' | 'canGenerateBidPDFs' | 'canConvertBidToProject'
  | 'canAccessBidNetworkGC' | 'canAccessBidNetworkInbox' | 'canManageBidResponses' | 'canDeleteBidRequests'
  | 'canAccessHistoricalCosts' | 'canAccessScopeSettings' | 'canUseAiBidAnalysis' | 'canUseAiContractAnalysis'
  | 'canViewFinancials' | 'canEditFinancials'
  | 'canAccessCostRates' | 'canAccessCFODashboard' | 'canAccessTMBilling' | 'canAccessProgressBilling'
  | 'canManageContracts' | 'canAccessSubcontracts' | 'canAccessOverheadCosts' | 'canAccessProductionRates' | 'canAccessVendorPricing'
  | 'canAccessTimeClock' | 'canManageTimeClock' | 'canApproveTime' | 'canAccessTMDaily'
  | 'canManagePayroll' | 'canManageCrews' | 'canManageWorkforce' | 'canManageLeave'
  | 'canManageSafety' | 'canManageScheduling' | 'canAccessKPIs' | 'canLockDailyReports'
  | 'canManageEquipment' | 'canManageProcurement'
  | 'canAccessCRM' | 'canCreateCRMContacts' | 'canAccessMarketplace'
  | 'canManageHiring' | 'canAccessHiringInterviews' | 'canManageHiringSettings'
  | 'canPostSocialMedia' | 'canManageWebsite' | 'canAccessExecutiveDigest'
  | 'canUseAiFeatures' | 'canViewSafety' | 'canViewAiSummaries'
  | 'canAccessCompanySettings' | 'canManageUsers' | 'canAccessApprovals' | 'canAccessAuditLogs'
  | 'canAccessReports' | 'canAccessEnterpriseSettings' | 'canManageAISettings'
  | 'canViewProjectBudget' | 'canViewProjectEstimates' | 'canViewProjectProcurement'
  | 'canViewProjectReceipts' | 'canViewProjectTimeEntries' | 'canViewProjectSubcontractors'
  | 'canCreateChangeOrders' | 'canDeleteScopeItems' | 'canEditProjectHandoff'
  | 'canSubmitPeerRatings' | 'canViewPeerRatings';

type PermissionSet = Record<FeaturePermissionKeys, boolean> & { projectScope: "ALL" | "ACTIVE_ONLY" };

const ALL_FALSE: PermissionSet = {
  canAccessDashboard: false, canAccessProjects: false, projectScope: "ALL" as const,
  canCreateProjects: false, canEditProjects: false, canAccessCalendar: false,
  canAccessTasks: false, canAccessMessages: false, canAccessBulletins: false, canAccessEmailAssistant: false,
  canViewBids: false, canEditBids: false, canDeleteBids: false, canGenerateBidPDFs: false,
  canConvertBidToProject: false, canAccessBidNetworkGC: false, canAccessBidNetworkInbox: false,
  canManageBidResponses: false, canDeleteBidRequests: false, canAccessHistoricalCosts: false,
  canAccessScopeSettings: false, canUseAiBidAnalysis: false, canUseAiContractAnalysis: false,
  canViewFinancials: false, canEditFinancials: false,
  canAccessCostRates: false, canAccessCFODashboard: false,
  canAccessTMBilling: false, canAccessProgressBilling: false, canManageContracts: false,
  canAccessSubcontracts: false, canAccessOverheadCosts: false, canAccessProductionRates: false,
  canAccessVendorPricing: false,
  canAccessTimeClock: false, canManageTimeClock: false, canApproveTime: false, canAccessTMDaily: false,
  canManagePayroll: false, canManageCrews: false, canManageWorkforce: false, canManageLeave: false,
  canManageSafety: false, canManageScheduling: false, canAccessKPIs: false, canLockDailyReports: false,
  canManageEquipment: false, canManageProcurement: false,
  canAccessCRM: false, canCreateCRMContacts: false, canAccessMarketplace: false,
  canManageHiring: false, canAccessHiringInterviews: false, canManageHiringSettings: false,
  canPostSocialMedia: false, canManageWebsite: false, canAccessExecutiveDigest: false,
  canUseAiFeatures: false, canViewSafety: false, canViewAiSummaries: false,
  canAccessCompanySettings: false, canManageUsers: false, canAccessApprovals: false,
  canAccessAuditLogs: false, canAccessReports: false, canAccessEnterpriseSettings: false,
  canManageAISettings: false,
  canViewProjectBudget: false, canViewProjectEstimates: false, canViewProjectProcurement: false,
  canViewProjectReceipts: false, canViewProjectTimeEntries: false, canViewProjectSubcontractors: false,
  canCreateChangeOrders: false, canDeleteScopeItems: false, canEditProjectHandoff: false,
  canSubmitPeerRatings: false, canViewPeerRatings: false,
};

const ALL_TRUE: PermissionSet = {
  canAccessDashboard: true, canAccessProjects: true, projectScope: "ALL" as const,
  canCreateProjects: true, canEditProjects: true, canAccessCalendar: true,
  canAccessTasks: true, canAccessMessages: true, canAccessBulletins: true, canAccessEmailAssistant: true,
  canViewBids: true, canEditBids: true, canDeleteBids: true, canGenerateBidPDFs: true,
  canConvertBidToProject: true, canAccessBidNetworkGC: true, canAccessBidNetworkInbox: true,
  canManageBidResponses: true, canDeleteBidRequests: true, canAccessHistoricalCosts: true,
  canAccessScopeSettings: true, canUseAiBidAnalysis: true, canUseAiContractAnalysis: true,
  canViewFinancials: true, canEditFinancials: true,
  canAccessCostRates: true, canAccessCFODashboard: true,
  canAccessTMBilling: true, canAccessProgressBilling: true, canManageContracts: true,
  canAccessSubcontracts: true, canAccessOverheadCosts: true, canAccessProductionRates: true,
  canAccessVendorPricing: true,
  canAccessTimeClock: true, canManageTimeClock: true, canApproveTime: true, canAccessTMDaily: true,
  canManagePayroll: true, canManageCrews: true, canManageWorkforce: true, canManageLeave: true,
  canManageSafety: true, canManageScheduling: true, canAccessKPIs: true, canLockDailyReports: true,
  canManageEquipment: true, canManageProcurement: true,
  canAccessCRM: true, canCreateCRMContacts: true, canAccessMarketplace: true,
  canManageHiring: true, canAccessHiringInterviews: true, canManageHiringSettings: true,
  canPostSocialMedia: true, canManageWebsite: true, canAccessExecutiveDigest: true,
  canUseAiFeatures: true, canViewSafety: true, canViewAiSummaries: true,
  canAccessCompanySettings: true, canManageUsers: true, canAccessApprovals: true,
  canAccessAuditLogs: true, canAccessReports: true, canAccessEnterpriseSettings: true,
  canManageAISettings: true,
  canViewProjectBudget: true, canViewProjectEstimates: true, canViewProjectProcurement: true,
  canViewProjectReceipts: true, canViewProjectTimeEntries: true, canViewProjectSubcontractors: true,
  canCreateChangeOrders: true, canDeleteScopeItems: true, canEditProjectHandoff: true,
  canSubmitPeerRatings: true, canViewPeerRatings: true,
};

export const ROLE_HIERARCHY: UserRole[] = [
  "SUPER_ADMIN", "ADMIN", "HUSTLER", "MANAGER", "SUPERINTENDENT", "ESTIMATOR", "FIELD_WORKER", "VENDOR"
];

export function rolesAtOrAbove(role: UserRole): UserRole[] {
  const idx = ROLE_HIERARCHY.indexOf(role);
  if (idx === -1) return [role];
  return ROLE_HIERARCHY.slice(0, idx + 1);
}

export function rolesAtOrBelow(role: UserRole): UserRole[] {
  const idx = ROLE_HIERARCHY.indexOf(role);
  if (idx === -1) return [role];
  return ROLE_HIERARCHY.slice(idx);
}

export function isRoleAtOrAbove(userRole: UserRole, threshold: UserRole): boolean {
  const userIdx = ROLE_HIERARCHY.indexOf(userRole);
  const thresholdIdx = ROLE_HIERARCHY.indexOf(threshold);
  if (userIdx === -1 || thresholdIdx === -1) return false;
  return userIdx <= thresholdIdx;
}

export const ROLE_DEFAULT_PERMISSIONS: Record<string, PermissionSet> = {
  ADMIN: ALL_TRUE,
  SUPER_ADMIN: { ...ALL_TRUE },
  HUSTLER: {
    ...ALL_TRUE,
    canAccessEnterpriseSettings: false,
    canManageHiringSettings: false,
  },
  MANAGER: {
    ...ALL_TRUE,
    canEditFinancials: false,
    canAccessCostRates: false,
    canManageWebsite: false,
    canManageAISettings: false,
    canAccessEnterpriseSettings: false,
    canManageHiringSettings: false,
    canManageUsers: false,
  },
  SUPERINTENDENT: {
    ...ALL_FALSE,
    canAccessDashboard: true, canAccessProjects: true, canAccessCalendar: true,
    canAccessTasks: true, canAccessMessages: true, canAccessBulletins: true,
    canViewBids: true, canAccessHistoricalCosts: true,
    canViewFinancials: true, canEditFinancials: false,
    canManageContracts: true, canAccessSubcontracts: true,
    canAccessProductionRates: true, canAccessScopeSettings: true,
    canAccessCFODashboard: true,
    canAccessTimeClock: true, canManageTimeClock: true, canApproveTime: true,
    canAccessTMDaily: true, canManageWorkforce: true, canManageSafety: true,
    canManageScheduling: true, canManageCrews: true, canManageLeave: true,
    canAccessKPIs: true, canLockDailyReports: true,
    canManageEquipment: true, canManageProcurement: true,
    canAccessCRM: true, canCreateCRMContacts: true,
    canAccessApprovals: true, canAccessReports: true,
    canViewProjectBudget: true, canViewProjectEstimates: true, canViewProjectProcurement: true,
    canViewProjectReceipts: true, canViewProjectTimeEntries: true, canViewProjectSubcontractors: true,
    canCreateChangeOrders: true,
    canSubmitPeerRatings: true, canViewPeerRatings: true,
  },
  ESTIMATOR: {
    ...ALL_FALSE,
    canAccessDashboard: true, canAccessProjects: true, canAccessCalendar: true,
    canAccessTasks: true, canAccessMessages: true, canAccessBulletins: true,
    canViewBids: true, canEditBids: true, canGenerateBidPDFs: true,
    canConvertBidToProject: true, canAccessBidNetworkGC: true, canAccessBidNetworkInbox: true,
    canAccessHistoricalCosts: true, canAccessScopeSettings: true, canUseAiBidAnalysis: true,
    canCreateProjects: true, canEditProjects: true,
    canViewFinancials: true, canEditFinancials: false,
    canAccessCostRates: true, canAccessProductionRates: true,
    canAccessTimeClock: true,
    canAccessCRM: true, canCreateCRMContacts: true,
    canAccessMarketplace: true,
    canManageEquipment: true, canManageProcurement: true,
    canUseAiFeatures: true,
    canAccessReports: true,
    canViewProjectBudget: true, canViewProjectEstimates: true, canViewProjectProcurement: true,
    canViewProjectReceipts: true, canViewProjectTimeEntries: true, canViewProjectSubcontractors: true,
    canSubmitPeerRatings: true, canViewPeerRatings: true,
  },
  FIELD_WORKER: {
    ...ALL_FALSE,
    canAccessDashboard: true, canAccessProjects: true, projectScope: "ACTIVE_ONLY" as const,
    canAccessCalendar: true, canAccessTasks: true, canAccessMessages: true,
    canAccessBulletins: true, canAccessTimeClock: true, canManageLeave: true,
    canViewProjectTimeEntries: true, canViewSafety: true, canViewAiSummaries: true,
    canSubmitPeerRatings: true, canViewPeerRatings: true,
  },
  VENDOR: {
    ...ALL_FALSE,
    canAccessDashboard: true,
    canAccessMessages: true,
    canAccessBidNetworkInbox: true,
  },
};

export function getRoleDefaults(role?: string | null): PermissionSet {
  if (!role) return { ...ALL_FALSE };
  return { ...(ROLE_DEFAULT_PERMISSIONS[role] || ALL_FALSE) };
}

export function mergePermissions(roleDefaults: PermissionSet, dbPerms: Partial<PermissionSet> | null): PermissionSet {
  if (!dbPerms) return { ...roleDefaults };
  const result = { ...roleDefaults };
  for (const key of Object.keys(result)) {
    if (key === 'projectScope') {
      if (key in dbPerms && (dbPerms[key] === 'ALL' || dbPerms[key] === 'ACTIVE_ONLY')) {
        result.projectScope = dbPerms[key]!;
      }
    } else {
      const k = key as FeaturePermissionKeys;
      if (k in dbPerms && typeof dbPerms[k] === 'boolean') {
        result[k] = dbPerms[k]!;
      }
    }
  }
  return result;
}

router.get('/api/dashboard/permissions', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'HUSTLER'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: 'Organization required' });
    }

    const orgUsers = await db.select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      role: users.role,
      roleLabel: users.roleLabel,
    }).from(users).where(and(eq(users.organizationId, orgId), sql`${users.role} != 'SUPER_ADMIN'`));

    const permissions = await db.select().from(userDashboardPermissions)
      .where(eq(userDashboardPermissions.organizationId, orgId));

    const hustlerUserIds = orgUsers.filter(u => u.role === 'HUSTLER').map(u => u.id);
    let hustlerLinks: { userId: string; roleOverride: string | null }[] = [];
    if (hustlerUserIds.length > 0) {
      hustlerLinks = await db.select({
        userId: hustlerOrganizations.userId,
        roleOverride: hustlerOrganizations.roleOverride,
      }).from(hustlerOrganizations).where(
        and(
          eq(hustlerOrganizations.organizationId, orgId),
          eq(hustlerOrganizations.isActive, true),
          inArray(hustlerOrganizations.userId, hustlerUserIds)
        )
      );
    }

    const usersWithPermissions = orgUsers.map(user => {
      const perm = permissions.find(p => p.userId === user.id);
      let effectiveRole: string | undefined;
      if (user.role === 'HUSTLER') {
        const link = hustlerLinks.find(l => l.userId === user.id);
        effectiveRole = link?.roleOverride || 'ADMIN';
      }
      const roleDefaults = getRoleDefaults(effectiveRole || user.role);
      const dbPerms: Partial<PermissionSet> = {};
      if (perm) {
        const permRecord = perm as Record<string, unknown>;
        const dbPermsRecord = dbPerms as Record<string, boolean | string>;
        for (const key of Object.keys(ALL_FALSE)) {
          if (key === 'canViewFinancials' || key === 'canEditFinancials') continue;
          if (key === 'projectScope') {
            const val = permRecord[key];
            if (val === 'ALL' || val === 'ACTIVE_ONLY') {
              dbPermsRecord.projectScope = val;
            }
            continue;
          }
          const val = permRecord[key];
          if (typeof val === 'boolean') {
            dbPermsRecord[key] = val;
          }
        }
        const fa = (perm as Record<string, unknown>).financialsAccess as string | undefined;
        if (fa) {
          dbPerms.canViewFinancials = fa === 'view' || fa === 'manage';
          dbPerms.canEditFinancials = fa === 'manage';
        }
      }
      const effective = mergePermissions(roleDefaults, perm ? dbPerms : null);

      const overrides: Record<string, boolean> = {};
      if (perm) {
        const permRecord = perm as Record<string, unknown>;
        for (const key of Object.keys(ALL_FALSE)) {
          if (key === 'canViewFinancials' || key === 'canEditFinancials') continue;
          const rawDbVal = permRecord[key];
          if (rawDbVal === null || rawDbVal === undefined) continue;
          const defVal = (roleDefaults as Record<string, unknown>)[key];
          if (key === 'projectScope') {
            if (typeof rawDbVal === 'string' && rawDbVal !== defVal) {
              overrides[key] = true;
            }
          } else if (typeof rawDbVal === 'boolean' && rawDbVal !== defVal) {
            overrides[key] = true;
          }
        }
        const fa = permRecord.financialsAccess;
        if (fa !== null && fa !== undefined) {
          const dbView = fa === 'view' || fa === 'manage';
          const dbEdit = fa === 'manage';
          if (dbView !== roleDefaults.canViewFinancials) {
            overrides.canViewFinancials = true;
          }
          if (dbEdit !== roleDefaults.canEditFinancials) {
            overrides.canEditFinancials = true;
          }
        }
      }

      return {
        ...user,
        ...dbPerms,
        roleDefaults,
        effective,
        overrides,
        effectiveRole,
        grantedAt: perm?.grantedAt,
        appliedPresetId: perm?.appliedPresetId || null,
      };
    });

    res.json(usersWithPermissions);
  } catch (error) {
    next(error);
  }
});

router.put('/api/dashboard/permissions/:userId', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'HUSTLER'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { userId } = req.params;
    const orgId = req.user!.organizationId;
    const adminId = req.user!.id;

    if (!orgId) {
      return res.status(403).json({ error: 'Organization required' });
    }

    const schemaShape: Record<string, z.ZodTypeAny> = {};
    for (const key of Object.keys(ALL_FALSE)) {
      if (key === 'projectScope') {
        schemaShape[key] = z.enum(["ALL", "ACTIVE_ONLY"]);
      } else {
        schemaShape[key] = z.boolean();
      }
    }
    const schema = z.object(schemaShape);

    const data = validateBody(schema, req.body, res);
    if (!data) return;

    const { canViewFinancials: viewFin, canEditFinancials: editFin, ...restData } = data as Record<string, boolean | string>;
    let financialsAccess: string | null = "none";
    if (editFin) financialsAccess = "manage";
    else if (viewFin) financialsAccess = "view";

    const [targetUser] = await db.select().from(users)
      .where(and(eq(users.id, userId), eq(users.organizationId, orgId)));

    if (!targetUser) {
      return res.status(404).json({ error: 'User not found in your organization' });
    }

    let effectiveRole: string | undefined;
    if (targetUser.role === 'HUSTLER') {
      const [link] = await db.select({ roleOverride: hustlerOrganizations.roleOverride })
        .from(hustlerOrganizations)
        .where(and(
          eq(hustlerOrganizations.organizationId, orgId),
          eq(hustlerOrganizations.userId, userId),
          eq(hustlerOrganizations.isActive, true),
        ));
      effectiveRole = link?.roleOverride || 'ADMIN';
    }
    const roleDefaults = getRoleDefaults(effectiveRole || targetUser.role);

    const sparseData: Record<string, boolean | string | null> = {};
    for (const key of Object.keys(restData)) {
      if (key === 'canViewFinancials' || key === 'canEditFinancials') continue;
      const incoming = restData[key];
      const defaultVal = (roleDefaults as Record<string, unknown>)[key];
      if (incoming === defaultVal) {
        sparseData[key] = null;
      } else {
        sparseData[key] = incoming;
      }
    }

    const defaultFa = roleDefaults.canEditFinancials ? "manage" : (roleDefaults.canViewFinancials ? "view" : "none");
    if (financialsAccess === defaultFa) {
      sparseData.financialsAccess = null;
    } else {
      sparseData.financialsAccess = financialsAccess;
    }

    const existing = await db.select().from(userDashboardPermissions)
      .where(and(
        eq(userDashboardPermissions.organizationId, orgId),
        eq(userDashboardPermissions.userId, userId)
      ));

    const oldPermissions: Record<string, boolean | string> = {};
    if (existing.length > 0) {
      for (const key of Object.keys(ALL_FALSE)) {
        if (key === 'canViewFinancials' || key === 'canEditFinancials') continue;
        if (key === 'projectScope') {
          const val = (existing[0] as Record<string, unknown>)[key];
          if (val === 'ALL' || val === 'ACTIVE_ONLY') {
            oldPermissions[key] = val;
          }
          continue;
        }
        const val = (existing[0] as Record<string, unknown>)[key];
        if (typeof val === 'boolean') {
          oldPermissions[key] = val;
        }
      }
      const oldFa = (existing[0] as Record<string, unknown>).financialsAccess as string | undefined;
      oldPermissions.canViewFinancials = oldFa === 'view' || oldFa === 'manage';
      oldPermissions.canEditFinancials = oldFa === 'manage';
    }

    if (existing.length > 0) {
      await db.update(userDashboardPermissions)
        .set({
          ...sparseData,
          appliedPresetId: null,
          grantedByUserId: adminId,
          grantedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(userDashboardPermissions.id, existing[0].id));
    } else {
      await db.insert(userDashboardPermissions).values({
        organizationId: orgId,
        userId,
        ...sparseData,
        grantedByUserId: adminId,
        grantedAt: new Date(),
      });
    }

    const changedPermissions: Record<string, { old: boolean | string; new: boolean | string }> = {};
    for (const key of Object.keys(data) as string[]) {
      const oldVal = oldPermissions[key] ?? (key === 'projectScope' ? 'ALL' : false);
      const newVal = (data as Record<string, boolean | string>)[key];
      if (oldVal !== newVal) {
        changedPermissions[key] = { old: oldVal, new: newVal };
      }
    }

    await logAudit({
      userId: adminId,
      entityType: "userPermissions",
      entityId: userId,
      action: existing.length > 0 ? "UPDATE" : "CREATE",
      oldValue: existing.length > 0 ? JSON.stringify(oldPermissions) : null,
      newValue: JSON.stringify({ targetUserId: userId, targetUserEmail: targetUser.email, changed: changedPermissions, fullNewPermissions: data }),
    }, req);

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

const BUILT_IN_PRESETS: Array<{ name: string; description: string; targetRole: string; permissions: Record<string, boolean | string> }> = [
  {
    name: "Company Owner / Principal",
    description: "Full unrestricted access to all platform features",
    targetRole: "ADMIN",
    permissions: {
      ...ALL_TRUE,
    },
  },
  {
    name: "Office Administrator",
    description: "Day-to-day company operations, users, payroll, CRM, hiring — no AI/enterprise settings",
    targetRole: "ADMIN",
    permissions: {
      ...ALL_TRUE,
      canManageAISettings: false,
      canAccessEnterpriseSettings: false,
    },
  },
  {
    name: "IT / Systems Administrator",
    description: "Integrations, AI settings, enterprise config, user management, audit logs",
    targetRole: "ADMIN",
    permissions: {
      ...ALL_FALSE,
      canAccessDashboard: true, canAccessProjects: true, projectScope: "ALL" as const,
      canAccessCalendar: true, canAccessTasks: true, canAccessMessages: true,
      canAccessBulletins: true, canAccessEmailAssistant: true,
      canManageUsers: true, canAccessCompanySettings: true,
      canManageAISettings: true, canAccessEnterpriseSettings: true,
      canAccessAuditLogs: true, canAccessReports: true,
      canManageWebsite: true, canAccessApprovals: true,
      canUseAiFeatures: true, canViewAiSummaries: true,
      canAccessExecutiveDigest: true,
    },
  },
  {
    name: "Financial Controller",
    description: "Full financial access, payroll, cost rates, CFO dashboard, contracts, billing — no project ops",
    targetRole: "ADMIN",
    permissions: {
      ...ALL_FALSE,
      canAccessDashboard: true, canAccessProjects: true, projectScope: "ALL" as const,
      canAccessCalendar: true, canAccessTasks: true, canAccessMessages: true,
      canAccessBulletins: true,
      canViewFinancials: true, canEditFinancials: true,
      canAccessCostRates: true, canAccessCFODashboard: true,
      canAccessTMBilling: true, canAccessProgressBilling: true,
      canManagePayroll: true, canAccessOverheadCosts: true, canAccessProductionRates: true,
      canManageContracts: true, canAccessSubcontracts: true, canAccessVendorPricing: true,
      canAccessKPIs: true, canAccessReports: true, canAccessApprovals: true,
      canAccessAuditLogs: true, canAccessExecutiveDigest: true,
      canAccessCompanySettings: true,
      canViewProjectBudget: true, canViewProjectEstimates: true, canViewProjectProcurement: true,
      canViewProjectReceipts: true, canViewProjectTimeEntries: true, canViewProjectSubcontractors: true,
      canCreateChangeOrders: true,
    },
  },
  {
    name: "Owner-Operator (Full Hustler)",
    description: "Full platform access across all organizations — sales, estimating, PM, finance, field ops",
    targetRole: "HUSTLER",
    permissions: {
      ...ALL_TRUE,
      canAccessEnterpriseSettings: false,
      canManageHiringSettings: false,
    },
  },
  {
    name: "Business Development Hustler",
    description: "Sales pipeline, bids, CRM, marketplace, estimating — no HR or payroll",
    targetRole: "HUSTLER",
    permissions: {
      ...ALL_FALSE,
      canAccessDashboard: true, canAccessProjects: true, projectScope: "ALL" as const,
      canAccessCalendar: true, canAccessTasks: true, canAccessMessages: true,
      canAccessBulletins: true, canAccessEmailAssistant: true,
      canAccessCRM: true, canCreateCRMContacts: true, canAccessMarketplace: true,
      canAccessBidNetworkGC: true, canAccessBidNetworkInbox: true,
      canManageBidResponses: true, canDeleteBidRequests: true,
      canViewBids: true, canEditBids: true, canDeleteBids: true,
      canGenerateBidPDFs: true, canConvertBidToProject: true,
      canAccessHistoricalCosts: true, canUseAiBidAnalysis: true,
      canUseAiContractAnalysis: true, canUseAiFeatures: true,
      canViewAiSummaries: true, canAccessExecutiveDigest: true,
      canViewFinancials: true,
      canAccessKPIs: true, canAccessReports: true,
      canPostSocialMedia: true, canManageWebsite: true,
    },
  },
  {
    name: "Portfolio Oversight Hustler",
    description: "Financial oversight, KPIs, executive digest, reports, approvals — read-heavy across all orgs",
    targetRole: "HUSTLER",
    permissions: {
      ...ALL_FALSE,
      canAccessDashboard: true, canAccessProjects: true, projectScope: "ALL" as const,
      canAccessCalendar: true, canAccessTasks: true, canAccessMessages: true,
      canAccessBulletins: true,
      canViewFinancials: true, canEditFinancials: true,
      canAccessCostRates: true, canAccessCFODashboard: true,
      canAccessTMBilling: true, canAccessProgressBilling: true,
      canManagePayroll: true, canAccessOverheadCosts: true, canAccessProductionRates: true,
      canManageContracts: true, canAccessSubcontracts: true, canAccessVendorPricing: true,
      canAccessKPIs: true, canAccessReports: true, canAccessApprovals: true,
      canAccessAuditLogs: true, canAccessExecutiveDigest: true,
      canViewProjectBudget: true, canViewProjectEstimates: true, canViewProjectProcurement: true,
      canViewProjectReceipts: true, canViewProjectTimeEntries: true, canViewProjectSubcontractors: true,
      canViewAiSummaries: true,
    },
  },
  {
    name: "Field Hustler",
    description: "Hands-on operator — projects, field ops, crews, time clock, equipment, safety",
    targetRole: "HUSTLER",
    permissions: {
      ...ALL_FALSE,
      canAccessDashboard: true, canAccessProjects: true, projectScope: "ALL" as const,
      canCreateProjects: true, canEditProjects: true,
      canAccessCalendar: true, canAccessTasks: true, canAccessMessages: true,
      canAccessBulletins: true,
      canAccessTimeClock: true, canManageTimeClock: true, canApproveTime: true, canAccessTMDaily: true,
      canManageCrews: true, canManageWorkforce: true, canManageScheduling: true,
      canManageEquipment: true, canManageProcurement: true, canManageSafety: true,
      canManageLeave: true, canLockDailyReports: true, canAccessKPIs: true,
      canViewProjectBudget: true, canViewProjectEstimates: true, canViewProjectProcurement: true,
      canViewProjectReceipts: true, canViewProjectTimeEntries: true, canViewProjectSubcontractors: true,
      canCreateChangeOrders: true, canDeleteScopeItems: true,
      canSubmitPeerRatings: true, canViewPeerRatings: true,
      canViewSafety: true, canAccessReports: true,
    },
  },
  {
    name: "Project Manager (PM)",
    description: "Full project lifecycle, scheduling, budgets, change orders",
    targetRole: "MANAGER",
    permissions: {
      ...ALL_TRUE,
      canAccessCostRates: false,
      canManageWebsite: false,
      canManageAISettings: false,
      canAccessAuditLogs: false,
      canAccessEnterpriseSettings: false,
      canManageUsers: false,
      canManageHiringSettings: false,
      canPostSocialMedia: false,
      canManageHiring: false,
      canAccessHiringInterviews: false,
    },
  },
  {
    name: "Operations Manager",
    description: "Equipment, procurement, workforce, KPIs, scheduling",
    targetRole: "MANAGER",
    permissions: {
      ...ALL_FALSE,
      canAccessDashboard: true, canAccessProjects: true, canAccessCalendar: true,
      canAccessTasks: true, canAccessMessages: true, canAccessBulletins: true,
      canManageEquipment: true, canManageProcurement: true, canManageWorkforce: true,
      canManageScheduling: true, canManageCrews: true, canAccessKPIs: true,
      canAccessReports: true, canAccessTimeClock: true, canManageTimeClock: true,
      canApproveTime: true, canAccessTMDaily: true, canManageLeave: true,
      canManageSafety: true, canLockDailyReports: true,
      canAccessCompanySettings: true, canAccessApprovals: true,
      canViewProjectBudget: true, canViewProjectEstimates: true, canViewProjectProcurement: true,
      canViewProjectReceipts: true, canViewProjectTimeEntries: true, canViewProjectSubcontractors: true,
      canSubmitPeerRatings: true, canViewPeerRatings: true,
    },
  },
  {
    name: "Office Manager",
    description: "Financials, payroll, contracts, hiring, CRM, reporting",
    targetRole: "MANAGER",
    permissions: {
      ...ALL_FALSE,
      canAccessDashboard: true, canAccessProjects: true, canAccessCalendar: true,
      canAccessTasks: true, canAccessMessages: true, canAccessBulletins: true,
      canViewFinancials: true, canEditFinancials: true,
      canAccessCFODashboard: true, canManagePayroll: true,
      canManageContracts: true, canAccessSubcontracts: true, canAccessOverheadCosts: true,
      canManageHiring: true, canAccessHiringInterviews: true, canManageHiringSettings: true,
      canAccessCRM: true, canCreateCRMContacts: true, canAccessReports: true,
      canAccessKPIs: true, canAccessCompanySettings: true, canAccessApprovals: true,
      canManageLeave: true,
      canViewProjectBudget: true, canViewProjectEstimates: true, canViewProjectProcurement: true,
      canViewProjectReceipts: true, canViewProjectTimeEntries: true, canViewProjectSubcontractors: true,
      canSubmitPeerRatings: true, canViewPeerRatings: true,
    },
  },
  {
    name: "Assistant Manager",
    description: "Read-heavy access, limited approval/management permissions",
    targetRole: "MANAGER",
    permissions: {
      ...ALL_FALSE,
      canAccessDashboard: true, canAccessProjects: true, canAccessCalendar: true,
      canAccessTasks: true, canAccessMessages: true, canAccessBulletins: true,
      canViewBids: true, canAccessHistoricalCosts: true,
      canViewFinancials: true,
      canAccessProductionRates: true, canAccessScopeSettings: true,
      canAccessReports: true, canAccessKPIs: true,
      canAccessTimeClock: true, canAccessTMDaily: true,
      canAccessCRM: true,
      canViewProjectBudget: true, canViewProjectEstimates: true, canViewProjectProcurement: true,
      canViewProjectReceipts: true, canViewProjectTimeEntries: true, canViewProjectSubcontractors: true,
      canSubmitPeerRatings: true, canViewPeerRatings: true,
    },
  },
  {
    name: "Marketing Manager",
    description: "CRM, marketplace, bid network, contacts, reports, KPIs, executive digest",
    targetRole: "MANAGER",
    permissions: {
      ...ALL_FALSE,
      canAccessDashboard: true, canAccessProjects: true, canAccessCalendar: true,
      canAccessTasks: true, canAccessMessages: true, canAccessBulletins: true,
      canAccessCRM: true, canCreateCRMContacts: true, canAccessMarketplace: true,
      canAccessBidNetworkGC: true, canAccessBidNetworkInbox: true,
      canAccessReports: true, canAccessKPIs: true, canAccessExecutiveDigest: true,
      canPostSocialMedia: true, canManageWebsite: true,
      canUseAiFeatures: true,
    },
  },
  {
    name: "Sales Manager",
    description: "CRM, marketplace, bid network, contacts, reports, KPIs, pipeline focus",
    targetRole: "MANAGER",
    permissions: {
      ...ALL_FALSE,
      canAccessDashboard: true, canAccessProjects: true, canAccessCalendar: true,
      canAccessTasks: true, canAccessMessages: true, canAccessBulletins: true,
      canAccessCRM: true, canCreateCRMContacts: true, canAccessMarketplace: true,
      canAccessBidNetworkGC: true, canAccessBidNetworkInbox: true,
      canManageBidResponses: true, canViewBids: true, canEditBids: true,
      canAccessReports: true, canAccessKPIs: true, canAccessExecutiveDigest: true,
      canSubmitPeerRatings: true, canViewPeerRatings: true,
    },
  },
  {
    name: "CFO / Finance Director",
    description: "Full financials, CFO dashboard, payroll, overhead costs, cost rates, contracts, reports",
    targetRole: "MANAGER",
    permissions: {
      ...ALL_FALSE,
      canAccessDashboard: true, canAccessProjects: true, canAccessCalendar: true,
      canAccessTasks: true, canAccessMessages: true, canAccessBulletins: true,
      canViewFinancials: true, canEditFinancials: true,
      canAccessCostRates: true, canAccessCFODashboard: true,
      canAccessTMBilling: true, canAccessProgressBilling: true,
      canManagePayroll: true, canAccessOverheadCosts: true, canAccessProductionRates: true,
      canManageContracts: true, canAccessSubcontracts: true, canAccessVendorPricing: true,
      canAccessReports: true, canAccessKPIs: true, canAccessExecutiveDigest: true,
      canAccessApprovals: true, canAccessAuditLogs: true,
      canViewProjectBudget: true, canViewProjectEstimates: true, canViewProjectProcurement: true,
      canViewProjectReceipts: true, canViewProjectTimeEntries: true, canViewProjectSubcontractors: true,
    },
  },
  {
    name: "HR Manager",
    description: "Hiring, workforce management, leave, safety training, scheduling, user management",
    targetRole: "MANAGER",
    permissions: {
      ...ALL_FALSE,
      canAccessDashboard: true, canAccessProjects: true, canAccessCalendar: true,
      canAccessTasks: true, canAccessMessages: true, canAccessBulletins: true,
      canManageHiring: true, canAccessHiringInterviews: true, canManageHiringSettings: true,
      canManageWorkforce: true, canManageLeave: true, canManageSafety: true,
      canManageScheduling: true, canManageCrews: true, canManageUsers: true,
      canAccessTimeClock: true, canManageTimeClock: true,
      canAccessReports: true, canAccessCompanySettings: true,
      canViewProjectTimeEntries: true,
      canSubmitPeerRatings: true, canViewPeerRatings: true,
    },
  },
  {
    name: "Procurement Manager",
    description: "Procurement, vendor pricing, contracts, subcontracts, CRM, bid network",
    targetRole: "MANAGER",
    permissions: {
      ...ALL_FALSE,
      canAccessDashboard: true, canAccessProjects: true, canAccessCalendar: true,
      canAccessTasks: true, canAccessMessages: true, canAccessBulletins: true,
      canManageProcurement: true, canManageEquipment: true, canAccessVendorPricing: true,
      canManageContracts: true, canAccessSubcontracts: true,
      canAccessCRM: true, canCreateCRMContacts: true,
      canAccessBidNetworkGC: true, canAccessBidNetworkInbox: true, canManageBidResponses: true,
      canAccessMarketplace: true,
      canAccessReports: true, canAccessApprovals: true,
      canViewProjectBudget: true, canViewProjectProcurement: true, canViewProjectSubcontractors: true,
      canSubmitPeerRatings: true, canViewPeerRatings: true,
    },
  },
  {
    name: "Safety Manager",
    description: "Safety training, bulletins, daily reports, workforce, leave, projects (read-only)",
    targetRole: "MANAGER",
    permissions: {
      ...ALL_FALSE,
      canAccessDashboard: true, canAccessProjects: true, canAccessCalendar: true,
      canAccessTasks: true, canAccessMessages: true, canAccessBulletins: true,
      canManageSafety: true, canLockDailyReports: true,
      canManageWorkforce: true, canManageLeave: true,
      canAccessTimeClock: true,
      canAccessReports: true,
      canViewProjectTimeEntries: true,
      canSubmitPeerRatings: true, canViewPeerRatings: true,
    },
  },
  {
    name: "Equipment Manager",
    description: "Equipment, procurement, scheduling, reports, maintenance-related",
    targetRole: "MANAGER",
    permissions: {
      ...ALL_FALSE,
      canAccessDashboard: true, canAccessProjects: true, canAccessCalendar: true,
      canAccessTasks: true, canAccessMessages: true, canAccessBulletins: true,
      canManageEquipment: true, canManageProcurement: true,
      canManageScheduling: true, canAccessReports: true,
      canAccessApprovals: true,
      canViewProjectProcurement: true, canViewProjectTimeEntries: true,
      canSubmitPeerRatings: true, canViewPeerRatings: true,
    },
  },
  {
    name: "Digital Marketing / Social Media Manager",
    description: "Social media posting, website builder, executive digest, CRM access, AI features",
    targetRole: "MANAGER",
    permissions: {
      ...ALL_FALSE,
      canAccessDashboard: true, canAccessProjects: true, canAccessCalendar: true,
      canAccessTasks: true, canAccessMessages: true, canAccessBulletins: true,
      canPostSocialMedia: true, canManageWebsite: true, canAccessExecutiveDigest: true,
      canAccessCRM: true, canCreateCRMContacts: true,
      canUseAiFeatures: true, canAccessReports: true,
    },
  },
  {
    name: "Lead Superintendent",
    description: "Full field control, approvals, scheduling, daily report locking",
    targetRole: "SUPERINTENDENT",
    permissions: {
      ...ALL_FALSE,
      canAccessDashboard: true, canAccessProjects: true, canAccessCalendar: true,
      canAccessTasks: true, canAccessMessages: true, canAccessBulletins: true,
      canViewBids: true, canAccessHistoricalCosts: true,
      canViewFinancials: true,
      canManageContracts: true, canAccessSubcontracts: true,
      canAccessProductionRates: true,
      canAccessTimeClock: true, canManageTimeClock: true, canApproveTime: true,
      canAccessTMDaily: true, canManageWorkforce: true, canManageSafety: true,
      canManageScheduling: true, canManageCrews: true, canAccessKPIs: true, canLockDailyReports: true,
      canManageEquipment: true, canManageProcurement: true,
      canAccessCRM: true, canCreateCRMContacts: true,
      canAccessCompanySettings: true, canAccessApprovals: true, canAccessReports: true,
      canViewProjectBudget: true, canViewProjectEstimates: true, canViewProjectProcurement: true,
      canViewProjectReceipts: true, canViewProjectTimeEntries: true, canViewProjectSubcontractors: true,
      canCreateChangeOrders: true, canDeleteScopeItems: true, canEditProjectHandoff: true,
    },
  },
  {
    name: "Assistant Superintendent",
    description: "Supports PM, limited approvals, no scheduling control",
    targetRole: "SUPERINTENDENT",
    permissions: {
      ...ALL_FALSE,
      canAccessDashboard: true, canAccessProjects: true, canAccessCalendar: true,
      canAccessTasks: true, canAccessMessages: true, canAccessBulletins: true,
      canViewBids: true, canAccessHistoricalCosts: true,
      canViewFinancials: true,
      canAccessProductionRates: true,
      canAccessTimeClock: true, canManageTimeClock: true, canAccessTMDaily: true,
      canManageWorkforce: true, canManageSafety: true, canManageLeave: true,
      canAccessKPIs: true, canLockDailyReports: true,
      canManageEquipment: true,
      canAccessCRM: true,
      canAccessApprovals: true, canAccessReports: true,
      canViewProjectBudget: true, canViewProjectEstimates: true, canViewProjectProcurement: true,
      canViewProjectReceipts: true, canViewProjectTimeEntries: true, canViewProjectSubcontractors: true,
      canCreateChangeOrders: true,
      canSubmitPeerRatings: true, canViewPeerRatings: true,
    },
  },
  {
    name: "QA/QC Superintendent",
    description: "Inspections focus, punch lists, safety, daily reports (no time approval)",
    targetRole: "SUPERINTENDENT",
    permissions: {
      ...ALL_FALSE,
      canAccessDashboard: true, canAccessProjects: true, canAccessCalendar: true,
      canAccessTasks: true, canAccessMessages: true, canAccessBulletins: true,
      canAccessHistoricalCosts: true,
      canAccessTimeClock: true, canAccessTMDaily: true,
      canManageSafety: true, canLockDailyReports: true,
      canAccessApprovals: true, canAccessReports: true,
      canViewProjectBudget: true, canViewProjectEstimates: true, canViewProjectProcurement: true,
      canViewProjectReceipts: true, canViewProjectTimeEntries: true, canViewProjectSubcontractors: true,
      canSubmitPeerRatings: true, canViewPeerRatings: true,
    },
  },
  {
    name: "Maintenance Superintendent",
    description: "Equipment, procurement, time clock, daily reports, safety (no bidding or financials)",
    targetRole: "SUPERINTENDENT",
    permissions: {
      ...ALL_FALSE,
      canAccessDashboard: true, canAccessProjects: true, canAccessCalendar: true,
      canAccessTasks: true, canAccessMessages: true, canAccessBulletins: true,
      canManageEquipment: true, canManageProcurement: true,
      canAccessTimeClock: true, canManageTimeClock: true, canAccessTMDaily: true,
      canManageSafety: true, canManageLeave: true, canLockDailyReports: true,
      canAccessReports: true,
      canViewProjectProcurement: true, canViewProjectTimeEntries: true,
      canSubmitPeerRatings: true, canViewPeerRatings: true,
    },
  },
  {
    name: "Dispatcher",
    description: "Scheduling, crews, time clock management, calendar, projects, messages (no approvals or financials)",
    targetRole: "SUPERINTENDENT",
    permissions: {
      ...ALL_FALSE,
      canAccessDashboard: true, canAccessProjects: true, canAccessCalendar: true,
      canAccessTasks: true, canAccessMessages: true, canAccessBulletins: true,
      canManageScheduling: true, canManageCrews: true,
      canAccessTimeClock: true, canManageTimeClock: true,
      canAccessCompanySettings: true,
      canViewProjectTimeEntries: true,
    },
  },
  {
    name: "Junior Estimator",
    description: "View bids, assist with takeoffs, no submission or conversion",
    targetRole: "ESTIMATOR",
    permissions: {
      ...ALL_FALSE,
      canAccessDashboard: true, canAccessProjects: true, canAccessCalendar: true,
      canAccessTasks: true, canAccessMessages: true, canAccessBulletins: true,
      canViewBids: true, canAccessHistoricalCosts: true,
      canViewFinancials: true,
      canAccessCostRates: true, canAccessProductionRates: true, canAccessScopeSettings: true,
      canAccessTimeClock: true,
      canAccessCRM: true,
      canAccessReports: true,
      canViewProjectBudget: true, canViewProjectEstimates: true, canViewProjectProcurement: true,
      canViewProjectReceipts: true, canViewProjectTimeEntries: true, canViewProjectSubcontractors: true,
      canSubmitPeerRatings: true, canViewPeerRatings: true,
    },
  },
  {
    name: "Senior Estimator",
    description: "Full estimating, submit bids, generate PDFs, convert to projects",
    targetRole: "ESTIMATOR",
    permissions: {
      ...ALL_FALSE,
      canAccessDashboard: true, canAccessProjects: true, canAccessCalendar: true,
      canAccessTasks: true, canAccessMessages: true, canAccessBulletins: true,
      canViewBids: true, canEditBids: true, canDeleteBids: true, canGenerateBidPDFs: true,
      canConvertBidToProject: true, canAccessBidNetworkGC: true, canAccessBidNetworkInbox: true,
      canManageBidResponses: true, canAccessHistoricalCosts: true, canAccessScopeSettings: true,
      canUseAiBidAnalysis: true, canCreateProjects: true,
      canViewFinancials: true,
      canAccessCostRates: true, canAccessProductionRates: true,
      canAccessTimeClock: true,
      canAccessCRM: true, canCreateCRMContacts: true,
      canAccessMarketplace: true,
      canManageEquipment: true, canManageProcurement: true,
      canUseAiFeatures: true,
      canAccessReports: true,
      canViewProjectBudget: true, canViewProjectEstimates: true, canViewProjectProcurement: true,
      canViewProjectReceipts: true, canViewProjectTimeEntries: true, canViewProjectSubcontractors: true,
      canSubmitPeerRatings: true, canViewPeerRatings: true,
    },
  },
  {
    name: "Precon Manager",
    description: "Everything senior has plus pipeline review, scope settings, AI analysis",
    targetRole: "ESTIMATOR",
    permissions: {
      ...ALL_FALSE,
      canAccessDashboard: true, canAccessProjects: true, canAccessCalendar: true,
      canAccessTasks: true, canAccessMessages: true, canAccessBulletins: true,
      canViewBids: true, canEditBids: true, canDeleteBids: true, canGenerateBidPDFs: true,
      canConvertBidToProject: true, canAccessBidNetworkGC: true, canAccessBidNetworkInbox: true,
      canManageBidResponses: true, canDeleteBidRequests: true,
      canAccessHistoricalCosts: true, canAccessScopeSettings: true,
      canUseAiBidAnalysis: true, canUseAiContractAnalysis: true,
      canCreateProjects: true, canEditProjects: true,
      canViewFinancials: true,
      canAccessCostRates: true, canAccessProductionRates: true,
      canAccessTimeClock: true,
      canAccessCRM: true, canCreateCRMContacts: true,
      canAccessMarketplace: true,
      canManageEquipment: true, canManageProcurement: true,
      canUseAiFeatures: true, canAccessKPIs: true, canAccessExecutiveDigest: true,
      canAccessReports: true, canAccessApprovals: true,
      canViewProjectBudget: true, canViewProjectEstimates: true, canViewProjectProcurement: true,
      canViewProjectReceipts: true, canViewProjectTimeEntries: true, canViewProjectSubcontractors: true,
      canSubmitPeerRatings: true, canViewPeerRatings: true,
    },
  },
  {
    name: "Chief Estimator",
    description: "Full estimating authority plus financial oversight, contract analysis, hiring, and AI governance",
    targetRole: "ESTIMATOR",
    permissions: {
      ...ALL_FALSE,
      canAccessDashboard: true, canAccessProjects: true, canAccessCalendar: true,
      canAccessTasks: true, canAccessMessages: true, canAccessBulletins: true,
      canViewBids: true, canEditBids: true, canDeleteBids: true, canGenerateBidPDFs: true,
      canConvertBidToProject: true, canAccessBidNetworkGC: true, canAccessBidNetworkInbox: true,
      canManageBidResponses: true, canDeleteBidRequests: true,
      canAccessHistoricalCosts: true, canAccessScopeSettings: true,
      canUseAiBidAnalysis: true, canUseAiContractAnalysis: true,
      canCreateProjects: true, canEditProjects: true,
      canViewFinancials: true, canEditFinancials: true,
      canAccessCostRates: true, canAccessProductionRates: true,
      canAccessCFODashboard: true, canAccessOverheadCosts: true,
      canAccessTimeClock: true,
      canAccessCRM: true, canCreateCRMContacts: true,
      canAccessMarketplace: true,
      canManageEquipment: true, canManageProcurement: true,
      canManageContracts: true, canAccessSubcontracts: true, canAccessVendorPricing: true,
      canUseAiFeatures: true, canViewAiSummaries: true,
      canAccessKPIs: true, canAccessExecutiveDigest: true,
      canAccessReports: true, canAccessApprovals: true, canAccessAuditLogs: true,
      canManageHiring: true, canAccessHiringInterviews: true,
      canViewProjectBudget: true, canViewProjectEstimates: true, canViewProjectProcurement: true,
      canViewProjectReceipts: true, canViewProjectTimeEntries: true, canViewProjectSubcontractors: true,
      canCreateChangeOrders: true,
      canSubmitPeerRatings: true, canViewPeerRatings: true,
    },
  },
  {
    name: "Subcontractor",
    description: "Submit bids, view scopes, bid network, messaging, dashboard",
    targetRole: "VENDOR",
    permissions: {
      ...ALL_FALSE,
      canAccessDashboard: true,
      canAccessBidNetworkInbox: true,
      canViewBids: true, canEditBids: true, canGenerateBidPDFs: true,
      canAccessMessages: true,
      canAccessVendorPricing: true,
    },
  },
  {
    name: "Supplier",
    description: "Material pricing, messaging, dashboard",
    targetRole: "VENDOR",
    permissions: {
      ...ALL_FALSE,
      canAccessDashboard: true,
      canAccessBidNetworkInbox: true,
      canAccessVendorPricing: true,
      canAccessMessages: true,
    },
  },
  {
    name: "Service Vendor",
    description: "Time tracking for on-site service, messaging, dashboard",
    targetRole: "VENDOR",
    permissions: {
      ...ALL_FALSE,
      canAccessDashboard: true,
      canAccessBidNetworkInbox: true,
      canAccessMessages: true,
      canAccessTimeClock: true,
    },
  },
  {
    name: "Rental Vendor",
    description: "Equipment rental pricing, equipment view, messaging, dashboard",
    targetRole: "VENDOR",
    permissions: {
      ...ALL_FALSE,
      canAccessDashboard: true,
      canAccessBidNetworkInbox: true,
      canAccessVendorPricing: true,
      canManageEquipment: true,
      canAccessMessages: true,
    },
  },
  {
    name: "Foreman / Lead Hand",
    description: "Crew oversight, time approval, daily report locking, equipment, scheduling, safety, workforce, KPIs",
    targetRole: "FIELD_WORKER",
    permissions: {
      ...ALL_FALSE,
      canAccessDashboard: true, canAccessProjects: true, projectScope: "ACTIVE_ONLY" as const,
      canAccessCalendar: true, canAccessTasks: true, canAccessMessages: true,
      canAccessBulletins: true, canAccessTimeClock: true, canManageLeave: true,
      canViewProjectTimeEntries: true, canViewSafety: true, canViewAiSummaries: true,
      canSubmitPeerRatings: true, canViewPeerRatings: true,
      canApproveTime: true, canLockDailyReports: true, canManageEquipment: true,
      canManageScheduling: true, canManageSafety: true, canManageWorkforce: true,
      canManageCrews: true, canAccessTMDaily: true, canAccessReports: true,
      canAccessKPIs: true,
      canViewProjectBudget: true, canViewProjectSubcontractors: true,
    },
  },
  {
    name: "Apprentice / Laborer",
    description: "Entry-level: time clock, messages, calendar, safety bulletins",
    targetRole: "FIELD_WORKER",
    permissions: {
      ...ALL_FALSE,
      canAccessDashboard: true, canAccessProjects: true, projectScope: "ACTIVE_ONLY" as const,
      canAccessTimeClock: true, canAccessMessages: true,
      canAccessBulletins: true, canAccessCalendar: true,
      canViewSafety: true,
      canSubmitPeerRatings: true,
    },
  },
  {
    name: "Equipment Operator",
    description: "Base field worker plus equipment management access",
    targetRole: "FIELD_WORKER",
    permissions: {
      ...ALL_FALSE,
      canAccessDashboard: true, canAccessProjects: true, projectScope: "ACTIVE_ONLY" as const,
      canAccessCalendar: true, canAccessTasks: true, canAccessMessages: true,
      canAccessBulletins: true, canAccessTimeClock: true, canManageLeave: true,
      canViewProjectTimeEntries: true, canViewSafety: true, canViewAiSummaries: true,
      canSubmitPeerRatings: true, canViewPeerRatings: true,
      canManageEquipment: true,
    },
  },
  {
    name: "Safety Lead / Safety Rep",
    description: "Base field worker plus safety management, daily report locking, workforce view, reports",
    targetRole: "FIELD_WORKER",
    permissions: {
      ...ALL_FALSE,
      canAccessDashboard: true, canAccessProjects: true, projectScope: "ACTIVE_ONLY" as const,
      canAccessCalendar: true, canAccessTasks: true, canAccessMessages: true,
      canAccessBulletins: true, canAccessTimeClock: true, canManageLeave: true,
      canViewProjectTimeEntries: true, canViewSafety: true, canViewAiSummaries: true,
      canSubmitPeerRatings: true, canViewPeerRatings: true,
      canManageSafety: true, canLockDailyReports: true, canManageWorkforce: true,
      canAccessReports: true,
    },
  },
  {
    name: "Skilled Tradesperson",
    description: "Base field worker plus read-only project details (budget, estimates, procurement, receipts, subcontractors)",
    targetRole: "FIELD_WORKER",
    permissions: {
      ...ALL_FALSE,
      canAccessDashboard: true, canAccessProjects: true, projectScope: "ACTIVE_ONLY" as const,
      canAccessCalendar: true, canAccessTasks: true, canAccessMessages: true,
      canAccessBulletins: true, canAccessTimeClock: true, canManageLeave: true,
      canViewProjectTimeEntries: true, canViewSafety: true, canViewAiSummaries: true,
      canSubmitPeerRatings: true, canViewPeerRatings: true,
      canViewProjectBudget: true, canViewProjectEstimates: true, canViewProjectProcurement: true,
      canViewProjectReceipts: true, canViewProjectSubcontractors: true,
    },
  },
  {
    name: "Site Inspector / QC Field Tech",
    description: "Base field worker plus daily report locking, safety, and read-only project details",
    targetRole: "FIELD_WORKER",
    permissions: {
      ...ALL_FALSE,
      canAccessDashboard: true, canAccessProjects: true, projectScope: "ACTIVE_ONLY" as const,
      canAccessCalendar: true, canAccessTasks: true, canAccessMessages: true,
      canAccessBulletins: true, canAccessTimeClock: true, canManageLeave: true,
      canViewProjectTimeEntries: true, canViewSafety: true, canViewAiSummaries: true,
      canSubmitPeerRatings: true, canViewPeerRatings: true,
      canLockDailyReports: true, canManageSafety: true,
      canViewProjectBudget: true, canViewProjectEstimates: true, canViewProjectProcurement: true,
      canViewProjectReceipts: true, canViewProjectSubcontractors: true,
      canAccessReports: true,
    },
  },
];

async function seedBuiltInPresets() {
  try {
    const existing = await db.select({ id: permissionPresets.id }).from(permissionPresets)
      .where(eq(permissionPresets.isBuiltIn, true));
    if (existing.length >= BUILT_IN_PRESETS.length) return;

    await db.delete(permissionPresets).where(eq(permissionPresets.isBuiltIn, true));

    for (const preset of BUILT_IN_PRESETS) {
      await db.insert(permissionPresets).values({
        name: preset.name,
        description: preset.description,
        targetRole: preset.targetRole,
        permissions: JSON.stringify(preset.permissions),
        isBuiltIn: true,
        organizationId: null,
      });
    }
  } catch (error) {
    logError('Error seeding built-in presets:', {}, error instanceof Error ? error : new Error(String(error)));
  }
}

export { seedBuiltInPresets };

router.get('/api/dashboard/permission-presets', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'HUSTLER'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const role = (req.query.role as string) || '';

    const builtInRows = role
      ? await db.select().from(permissionPresets).where(and(eq(permissionPresets.isBuiltIn, true), eq(permissionPresets.targetRole, role)))
      : await db.select().from(permissionPresets).where(eq(permissionPresets.isBuiltIn, true));

    let customRows: typeof builtInRows = [];
    if (orgId) {
      customRows = role
        ? await db.select().from(permissionPresets).where(and(eq(permissionPresets.isBuiltIn, false), eq(permissionPresets.organizationId, orgId), eq(permissionPresets.targetRole, role)))
        : await db.select().from(permissionPresets).where(and(eq(permissionPresets.isBuiltIn, false), eq(permissionPresets.organizationId, orgId)));
    }

    const allRows = [...builtInRows, ...customRows].map(row => ({
      ...row,
      permissions: JSON.parse(row.permissions) as Record<string, boolean>,
    }));

    res.json(allRows);
  } catch (error) {
    next(error);
  }
});

router.post('/api/dashboard/permission-presets', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'HUSTLER'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: 'Organization required' });
    }

    const schema = z.object({
      name: z.string().min(1).max(255),
      description: z.string().optional(),
      targetRole: z.enum(['MANAGER', 'SUPERINTENDENT', 'ESTIMATOR', 'VENDOR']),
      permissions: z.object(
        Object.fromEntries(
          Object.keys(ALL_FALSE).map(k =>
            k === 'projectScope'
              ? [k, z.enum(["ALL", "ACTIVE_ONLY"])]
              : [k, z.boolean()]
          )
        )
      ),
    });

    let data;
    try {
      data = schema.parse(req.body);
    } catch (validationError) {
      return res.status(400).json({ error: 'Invalid preset data', details: validationError instanceof z.ZodError ? validationError.errors : undefined });
    }

    const [created] = await db.insert(permissionPresets).values({
      name: data.name,
      description: data.description || null,
      targetRole: data.targetRole,
      permissions: JSON.stringify(data.permissions),
      isBuiltIn: false,
      organizationId: orgId,
    }).returning();

    res.json({ ...created, permissions: data.permissions });
  } catch (error) {
    next(error);
  }
});

router.delete('/api/dashboard/permission-presets/:id', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'HUSTLER'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const orgId = req.user!.organizationId;

    if (!orgId) {
      return res.status(403).json({ error: 'Organization required' });
    }

    const [preset] = await db.select().from(permissionPresets)
      .where(eq(permissionPresets.id, id));

    if (!preset) {
      return res.status(404).json({ error: 'Preset not found' });
    }

    if (preset.isBuiltIn) {
      return res.status(400).json({ error: 'Cannot delete built-in presets' });
    }

    if (preset.organizationId !== orgId) {
      return res.status(403).json({ error: 'Cannot delete presets from other organizations' });
    }

    await db.delete(permissionPresets).where(eq(permissionPresets.id, id));
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.put('/api/dashboard/permissions/:userId/apply-preset', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'HUSTLER'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { userId } = req.params;
    const orgId = req.user!.organizationId;
    const adminId = req.user!.id;

    if (!orgId) {
      return res.status(403).json({ error: 'Organization required' });
    }

    const schema = z.object({
      presetId: z.string(),
    });
    const data = validateBody(schema, req.body, res);
    if (!data) return;
    const { presetId } = data;

    const [preset] = await db.select().from(permissionPresets)
      .where(eq(permissionPresets.id, presetId));

    if (!preset) {
      return res.status(404).json({ error: 'Preset not found' });
    }

    if (!preset.isBuiltIn && preset.organizationId !== orgId) {
      return res.status(403).json({ error: 'Cannot use presets from other organizations' });
    }

    const permSet: Record<string, boolean | string> = JSON.parse(preset.permissions);

    const [targetUser] = await db.select().from(users)
      .where(and(eq(users.id, userId), eq(users.organizationId, orgId)));

    if (!targetUser) {
      return res.status(404).json({ error: 'User not found in your organization' });
    }

    if (preset.targetRole !== targetUser.role) {
      return res.status(400).json({ error: `Preset is for ${preset.targetRole} role, but user has ${targetUser.role} role` });
    }

    const existing = await db.select().from(userDashboardPermissions)
      .where(and(
        eq(userDashboardPermissions.organizationId, orgId),
        eq(userDashboardPermissions.userId, userId)
      ));

    const fullPermSet: Record<string, boolean | string> = { ...ALL_FALSE };
    for (const key of Object.keys(permSet)) {
      if (key in fullPermSet) {
        fullPermSet[key] = permSet[key];
      }
    }

    const { canViewFinancials: pViewFin, canEditFinancials: pEditFin, ...pRestData } = fullPermSet;
    let pFinancialsAccess = "none";
    if (pEditFin) pFinancialsAccess = "manage";
    else if (pViewFin) pFinancialsAccess = "view";
    const presetDbData = { ...pRestData, financialsAccess: pFinancialsAccess };

    if (existing.length > 0) {
      await db.update(userDashboardPermissions)
        .set({
          ...presetDbData,
          appliedPresetId: presetId,
          grantedByUserId: adminId,
          grantedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(userDashboardPermissions.id, existing[0].id));
    } else {
      await db.insert(userDashboardPermissions).values({
        organizationId: orgId,
        userId,
        ...presetDbData,
        appliedPresetId: presetId,
        grantedByUserId: adminId,
        grantedAt: new Date(),
      });
    }

    await logAudit({
      userId: adminId,
      entityType: "userPermissions",
      entityId: userId,
      action: "UPDATE",
      oldValue: existing.length > 0 ? JSON.stringify({ source: "manual", appliedPresetId: existing[0].appliedPresetId }) : null,
      newValue: JSON.stringify({ source: "preset", presetId, presetName: preset.name, targetUserEmail: targetUser.email, permissions: fullPermSet }),
    }, req);

    res.json({ success: true, permissions: fullPermSet, appliedPresetId: presetId });
  } catch (error) {
    next(error);
  }
});

router.delete('/api/dashboard/permissions/:userId/reset', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'HUSTLER'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { userId } = req.params;
    const orgId = req.user!.organizationId;
    const adminId = req.user!.id;

    if (!orgId) {
      return res.status(403).json({ error: 'Organization required' });
    }

    const [targetUser] = await db.select().from(users)
      .where(and(eq(users.id, userId), eq(users.organizationId, orgId)));

    if (!targetUser) {
      return res.status(404).json({ error: 'User not found in your organization' });
    }

    const existing = await db.select().from(userDashboardPermissions)
      .where(and(
        eq(userDashboardPermissions.organizationId, orgId),
        eq(userDashboardPermissions.userId, userId)
      ));

    if (existing.length > 0) {
      await db.delete(userDashboardPermissions)
        .where(eq(userDashboardPermissions.id, existing[0].id));
    }

    const roleDefaults = getRoleDefaults(targetUser.role);

    await logAudit({
      userId: adminId,
      entityType: "userPermissions",
      entityId: userId,
      action: "DELETE",
      oldValue: existing.length > 0 ? JSON.stringify({ source: existing[0].appliedPresetId ? "preset" : "manual" }) : null,
      newValue: JSON.stringify({ source: "role_defaults_reset", targetUserEmail: targetUser.email, role: targetUser.role }),
    }, req);

    res.json({ success: true, permissions: roleDefaults, message: `Permissions reset to ${targetUser.role} role defaults` });
  } catch (error) {
    next(error);
  }
});

router.get('/api/dashboard/my-permissions', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const orgId = req.user!.organizationId;
    const effectiveRole = req.user!.effectiveRole || req.user!.role;

    const roleDefaults = getRoleDefaults(effectiveRole);

    if (effectiveRole === 'ADMIN') {
      return res.json(ALL_TRUE);
    }

    if (effectiveRole === 'SUPER_ADMIN') {
      return res.json(roleDefaults);
    }

    if (!orgId) {
      return res.json(roleDefaults);
    }

    const [permission] = await db.select().from(userDashboardPermissions)
      .where(and(
        eq(userDashboardPermissions.organizationId, orgId),
        eq(userDashboardPermissions.userId, userId)
      ));

    const dbPerms: Partial<PermissionSet> | null = permission ? (() => {
      const perms: Partial<PermissionSet> = {};
      const permRecord = permission as Record<string, unknown>;
      const permsRecord = perms as Record<string, boolean | string>;
      for (const key of Object.keys(ALL_FALSE)) {
        if (key === 'canViewFinancials' || key === 'canEditFinancials') continue;
        if (key === 'projectScope') {
          const val = permRecord[key];
          if (val === 'ALL' || val === 'ACTIVE_ONLY') {
            permsRecord.projectScope = val;
          }
          continue;
        }
        const val = permRecord[key];
        if (typeof val === 'boolean') {
          permsRecord[key] = val;
        }
      }
      const fa = (permission as Record<string, unknown>).financialsAccess as string | undefined;
      if (fa === 'manage') {
        perms.canViewFinancials = true;
        perms.canEditFinancials = true;
      } else if (fa === 'view') {
        perms.canViewFinancials = true;
        perms.canEditFinancials = false;
      } else if (fa === 'none') {
        perms.canViewFinancials = false;
        perms.canEditFinancials = false;
      }
      return perms;
    })() : null;

    let presetName: string | null = null;
    const presetId = (permission as Record<string, unknown> | undefined)?.appliedPresetId as string | null | undefined;
    if (presetId) {
      const [preset] = await db.select({ name: permissionPresets.name }).from(permissionPresets).where(eq(permissionPresets.id, presetId));
      if (preset) presetName = preset.name;
    }

    res.json({ ...mergePermissions(roleDefaults, dbPerms), appliedPresetName: presetName });
  } catch (error) {
    next(error);
  }
});

router.get('/api/dashboard/layout', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const orgId = req.user!.organizationId;

    const roleDefault = getDefaultLayoutForRole(req.user!.role || '');

    if (!orgId) {
      return res.json({ layout: roleDefault, isCustom: false });
    }

    const [layout] = await db.select().from(userDashboardLayouts)
      .where(and(
        eq(userDashboardLayouts.organizationId, orgId),
        eq(userDashboardLayouts.userId, userId)
      ));

    if (layout) {
      try {
        const config = JSON.parse(layout.layoutConfig);
        if (config.version === 2 && config.widgets && !config.sections) {
          const migrated = migrateV2ToV3(config);
          return res.json({ layout: migrated, isCustom: layout.isCustom });
        }
        if (!config.version || config.version < 3) {
          return res.json({ layout: roleDefault, isCustom: false });
        }
        return res.json({ layout: config as DashboardLayoutConfig, isCustom: layout.isCustom });
      } catch {
        logWarn("Non-critical operation failed");
        return res.json({ layout: roleDefault, isCustom: false });
      }
    }

    res.json({ layout: roleDefault, isCustom: false });
  } catch (error) {
    next(error);
  }
});

router.get('/api/dashboard/layout/default', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  const roleDefault = getDefaultLayoutForRole(req.user!.role || '');
  res.json({ layout: roleDefault });
});

router.put('/api/dashboard/layout', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const orgId = req.user!.organizationId;
    const role = req.user!.role;

    if (!orgId) {
      return res.status(403).json({ error: 'Organization required' });
    }

    const widgetSchema = z.object({
      id: z.string(),
      type: z.string(),
      x: z.number(),
      y: z.number(),
      w: z.number(),
      h: z.number(),
      visible: z.boolean(),
      minW: z.number().optional(),
      minH: z.number().optional(),
      maxW: z.number().optional(),
      maxH: z.number().optional(),
      config: z.record(z.any()).optional(),
    });

    const sectionSchema = z.object({
      id: z.string(),
      title: z.string(),
      columns: z.number().min(1).max(4),
      collapsed: z.boolean(),
      widgets: z.array(widgetSchema),
    });

    const schema = z.object({
      layout: z.object({
        sections: z.array(sectionSchema),
        gridCols: z.number(),
        version: z.number(),
      }),
    });

    const layoutData = validateBody(schema, req.body, res);
    if (!layoutData) return;
    const { layout } = layoutData;

    const allWidgets = layout.sections.flatMap(s => s.widgets);
    const unknownTypes = allWidgets
      .map(w => w.type)
      .filter(t => !KNOWN_WIDGET_TYPES.includes(t));
    if (unknownTypes.length > 0) {
      return res.status(400).json({ error: `Unknown widget types: ${unknownTypes.join(', ')}` });
    }

    const [existing] = await db.select().from(userDashboardLayouts)
      .where(and(
        eq(userDashboardLayouts.organizationId, orgId),
        eq(userDashboardLayouts.userId, userId)
      ));

    if (existing) {
      await db.update(userDashboardLayouts)
        .set({
          layoutConfig: JSON.stringify(layout),
          isCustom: true,
          updatedAt: new Date(),
        })
        .where(eq(userDashboardLayouts.id, existing.id));
    } else {
      await db.insert(userDashboardLayouts).values({
        organizationId: orgId,
        userId,
        layoutConfig: JSON.stringify(layout),
        isCustom: true,
      });
    }

    res.json({ success: true, layout });
  } catch (error) {
    next(error);
  }
});

router.post('/api/dashboard/layout/reset', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const orgId = req.user!.organizationId;

    const roleDefault = getDefaultLayoutForRole(req.user!.role || '');

    if (!orgId) {
      return res.json({ layout: roleDefault });
    }

    await db.delete(userDashboardLayouts)
      .where(and(
        eq(userDashboardLayouts.organizationId, orgId),
        eq(userDashboardLayouts.userId, userId)
      ));

    res.json({ success: true, layout: roleDefault });
  } catch (error) {
    next(error);
  }
});

// ========================================
// Routes from dashboardPaletteRoutes.ts
// ========================================

interface PaletteResponse {
  success: boolean;
  palette: UserColorPalette | OrgColorPalette;
  contrastWarnings?: {
    message: string;
    light: PaletteValidationResult;
    dark: PaletteValidationResult;
  };
}


function parseHSL(hsl: string): { h: number; s: number; l: number } | null {
  if (!hsl) return null;
  const parts = hsl.trim().split(/\s+/);
  if (parts.length !== 3) return null;
  
  const h = parseFloat(parts[0]);
  const s = parseFloat(parts[1].replace('%', ''));
  const l = parseFloat(parts[2].replace('%', ''));
  
  if (isNaN(h) || isNaN(s) || isNaN(l)) return null;
  return { h, s, l };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  s /= 100;
  l /= 100;
  
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  
  let r = 0, g = 0, b = 0;
  
  if (h >= 0 && h < 60) { r = c; g = x; b = 0; }
  else if (h >= 60 && h < 120) { r = x; g = c; b = 0; }
  else if (h >= 120 && h < 180) { r = 0; g = c; b = x; }
  else if (h >= 180 && h < 240) { r = 0; g = x; b = c; }
  else if (h >= 240 && h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255)
  };
}

function getRelativeLuminance(r: number, g: number, b: number): number {
  const rsRGB = r / 255;
  const gsRGB = g / 255;
  const bsRGB = b / 255;
  
  const rL = rsRGB <= 0.03928 ? rsRGB / 12.92 : Math.pow((rsRGB + 0.055) / 1.055, 2.4);
  const gL = gsRGB <= 0.03928 ? gsRGB / 12.92 : Math.pow((gsRGB + 0.055) / 1.055, 2.4);
  const bL = bsRGB <= 0.03928 ? bsRGB / 12.92 : Math.pow((bsRGB + 0.055) / 1.055, 2.4);
  
  return 0.2126 * rL + 0.7152 * gL + 0.0722 * bL;
}

function getContrastRatio(hsl1: string, hsl2: string): number | null {
  const color1 = parseHSL(hsl1);
  const color2 = parseHSL(hsl2);
  
  if (!color1 || !color2) return null;
  
  const rgb1 = hslToRgb(color1.h, color1.s, color1.l);
  const rgb2 = hslToRgb(color2.h, color2.s, color2.l);
  
  const l1 = getRelativeLuminance(rgb1.r, rgb1.g, rgb1.b);
  const l2 = getRelativeLuminance(rgb2.r, rgb2.g, rgb2.b);
  
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  
  return (lighter + 0.05) / (darker + 0.05);
}

function validateColorPair(foreground: string, background: string, pairName: string): ColorContrastResult {
  const ratio = getContrastRatio(foreground, background);
  
  if (ratio === null) {
    return { isValid: false, contrastRatio: 0, wcagLevel: "FAIL", pair: pairName };
  }
  
  let wcagLevel: "AAA" | "AA" | "FAIL";
  if (ratio >= 7) wcagLevel = "AAA";
  else if (ratio >= 4.5) wcagLevel = "AA";
  else wcagLevel = "FAIL";
  
  return {
    isValid: ratio >= 4.5,
    contrastRatio: Math.round(ratio * 100) / 100,
    wcagLevel,
    pair: pairName
  };
}

function validatePalette(palette: Partial<UserColorPalette>, mode: 'light' | 'dark'): PaletteValidationResult {
  const results: ColorContrastResult[] = [];
  const failedPairs: string[] = [];
  
  const pairs = mode === 'light' ? [
    { fg: palette.lightForeground, bg: palette.lightBackground, name: 'foreground/background' },
    { fg: palette.lightPrimaryForeground, bg: palette.lightPrimary, name: 'primary-foreground/primary' },
    { fg: palette.lightSecondaryForeground, bg: palette.lightSecondary, name: 'secondary-foreground/secondary' },
    { fg: palette.lightAccentForeground, bg: palette.lightAccent, name: 'accent-foreground/accent' },
    { fg: palette.lightMutedForeground, bg: palette.lightMuted, name: 'muted-foreground/muted' },
    { fg: palette.lightCardForeground, bg: palette.lightCard, name: 'card-foreground/card' },
  ] : [
    { fg: palette.darkForeground, bg: palette.darkBackground, name: 'foreground/background' },
    { fg: palette.darkPrimaryForeground, bg: palette.darkPrimary, name: 'primary-foreground/primary' },
    { fg: palette.darkSecondaryForeground, bg: palette.darkSecondary, name: 'secondary-foreground/secondary' },
    { fg: palette.darkAccentForeground, bg: palette.darkAccent, name: 'accent-foreground/accent' },
    { fg: palette.darkMutedForeground, bg: palette.darkMuted, name: 'muted-foreground/muted' },
    { fg: palette.darkCardForeground, bg: palette.darkCard, name: 'card-foreground/card' },
  ];
  
  for (const pair of pairs) {
    if (pair.fg && pair.bg) {
      const result = validateColorPair(pair.fg, pair.bg, `${mode}:${pair.name}`);
      results.push(result);
      if (!result.isValid) {
        failedPairs.push(result.pair);
      }
    }
  }
  
  return {
    isValid: failedPairs.length === 0,
    results,
    failedPairs
  };
}

router.get('/api/dashboard/palettes/presets', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  res.json(PRESET_PALETTES);
});

router.get('/api/dashboard/palette', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const orgId = req.user!.organizationId;

    if (!orgId) {
      return res.json({ palette: null, orgPalette: null, isActive: false });
    }

    const [palette] = await db.select().from(userColorPalettes)
      .where(and(
        eq(userColorPalettes.organizationId, orgId),
        eq(userColorPalettes.userId, userId),
        eq(userColorPalettes.isActive, true)
      ));

    const [orgPalette] = await db.select().from(orgColorPalettes)
      .where(and(
        eq(orgColorPalettes.organizationId, orgId),
        eq(orgColorPalettes.isActive, true)
      ));

    res.json({ palette: palette || null, orgPalette: orgPalette || null, isActive: !!palette });
  } catch (error) {
    next(error);
  }
});

router.get('/api/dashboard/palettes', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const orgId = req.user!.organizationId;

    if (!orgId) {
      return res.json([]);
    }

    const palettes = await db.select().from(userColorPalettes)
      .where(and(
        eq(userColorPalettes.organizationId, orgId),
        eq(userColorPalettes.userId, userId)
      ));

    res.json(palettes);
  } catch (error) {
    next(error);
  }
});

router.post('/api/dashboard/palette/validate', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const palette = req.body;
    
    const lightValidation = validatePalette(palette, 'light');
    const darkValidation = validatePalette(palette, 'dark');

    res.json({
      isValid: lightValidation.isValid && darkValidation.isValid,
      light: lightValidation,
      dark: darkValidation,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/api/dashboard/palette', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const orgId = req.user!.organizationId;
    const role = req.user!.role;

    if (!orgId) {
      return res.status(403).json({ error: 'Organization required' });
    }

    const schema = z.object({
      paletteName: z.string().min(1).max(50),
      isPreset: z.boolean().optional(),
      setActive: z.boolean().optional(),
      lightPrimary: z.string().optional(),
      lightPrimaryForeground: z.string().optional(),
      lightSecondary: z.string().optional(),
      lightSecondaryForeground: z.string().optional(),
      lightAccent: z.string().optional(),
      lightAccentForeground: z.string().optional(),
      lightBackground: z.string().optional(),
      lightForeground: z.string().optional(),
      lightMuted: z.string().optional(),
      lightMutedForeground: z.string().optional(),
      lightCard: z.string().optional(),
      lightCardForeground: z.string().optional(),
      lightBorder: z.string().optional(),
      darkPrimary: z.string().optional(),
      darkPrimaryForeground: z.string().optional(),
      darkSecondary: z.string().optional(),
      darkSecondaryForeground: z.string().optional(),
      darkAccent: z.string().optional(),
      darkAccentForeground: z.string().optional(),
      darkBackground: z.string().optional(),
      darkForeground: z.string().optional(),
      darkMuted: z.string().optional(),
      darkMutedForeground: z.string().optional(),
      darkCard: z.string().optional(),
      darkCardForeground: z.string().optional(),
      darkBorder: z.string().optional(),
    });

    const data = validateBody(schema, req.body, res);
    if (!data) return;

    const lightValidation = validatePalette(data, 'light');
    const darkValidation = validatePalette(data, 'dark');

    const hasContrastWarnings = !lightValidation.isValid || !darkValidation.isValid;

    if (data.setActive) {
      await db.update(userColorPalettes)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(
          eq(userColorPalettes.organizationId, orgId),
          eq(userColorPalettes.userId, userId)
        ));
    }

    const [newPalette] = await db.insert(userColorPalettes).values({
      organizationId: orgId,
      userId,
      paletteName: data.paletteName,
      isPreset: data.isPreset || false,
      isActive: data.setActive || false,
      contrastValidated: !hasContrastWarnings,
      lastValidatedAt: new Date(),
      lightPrimary: data.lightPrimary,
      lightPrimaryForeground: data.lightPrimaryForeground,
      lightSecondary: data.lightSecondary,
      lightSecondaryForeground: data.lightSecondaryForeground,
      lightAccent: data.lightAccent,
      lightAccentForeground: data.lightAccentForeground,
      lightBackground: data.lightBackground,
      lightForeground: data.lightForeground,
      lightMuted: data.lightMuted,
      lightMutedForeground: data.lightMutedForeground,
      lightCard: data.lightCard,
      lightCardForeground: data.lightCardForeground,
      lightBorder: data.lightBorder,
      darkPrimary: data.darkPrimary,
      darkPrimaryForeground: data.darkPrimaryForeground,
      darkSecondary: data.darkSecondary,
      darkSecondaryForeground: data.darkSecondaryForeground,
      darkAccent: data.darkAccent,
      darkAccentForeground: data.darkAccentForeground,
      darkBackground: data.darkBackground,
      darkForeground: data.darkForeground,
      darkMuted: data.darkMuted,
      darkMutedForeground: data.darkMutedForeground,
      darkCard: data.darkCard,
      darkCardForeground: data.darkCardForeground,
      darkBorder: data.darkBorder,
    }).returning();

    const response: PaletteResponse = { success: true, palette: newPalette };
    if (hasContrastWarnings) {
      response.contrastWarnings = {
        message: 'Some color pairs may have low contrast for accessibility',
        light: lightValidation,
        dark: darkValidation,
      };
    }
    res.json(response);
  } catch (error) {
    next(error);
  }
});

router.put('/api/dashboard/palette/:paletteId/activate', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { paletteId } = req.params;
    const userId = req.user!.id;
    const orgId = req.user!.organizationId;

    if (!orgId) {
      return res.status(403).json({ error: 'Organization required' });
    }

    const [palette] = await db.select().from(userColorPalettes)
      .where(and(
        eq(userColorPalettes.id, paletteId),
        eq(userColorPalettes.organizationId, orgId),
        eq(userColorPalettes.userId, userId)
      ));

    if (!palette) {
      return res.status(404).json({ error: 'Palette not found' });
    }

    await db.update(userColorPalettes)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(
        eq(userColorPalettes.organizationId, orgId),
        eq(userColorPalettes.userId, userId)
      ));

    await db.update(userColorPalettes)
      .set({ isActive: true, updatedAt: new Date() })
      .where(eq(userColorPalettes.id, paletteId));

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.post('/api/dashboard/palette/deactivate', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const orgId = req.user!.organizationId;

    if (!orgId) {
      return res.json({ success: true });
    }

    await db.update(userColorPalettes)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(
        eq(userColorPalettes.organizationId, orgId),
        eq(userColorPalettes.userId, userId)
      ));

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.get('/api/dashboard/org-palette', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    if (!orgId) {
      return res.json({ palette: null, isActive: false });
    }

    const [palette] = await db.select().from(orgColorPalettes)
      .where(and(
        eq(orgColorPalettes.organizationId, orgId),
        eq(orgColorPalettes.isActive, true)
      ));

    res.json({ palette: palette || null, isActive: !!palette });
  } catch (error) {
    next(error);
  }
});

router.post('/api/dashboard/org-palette', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const role = req.user!.role;

    if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Only admins can set the organization default theme' });
    }

    if (!orgId) {
      return res.status(403).json({ error: 'Organization required' });
    }

    const schema = z.object({
      paletteName: z.string().min(1).max(50),
      isPreset: z.boolean().optional(),
      lightPrimary: z.string().optional(),
      lightPrimaryForeground: z.string().optional(),
      lightSecondary: z.string().optional(),
      lightSecondaryForeground: z.string().optional(),
      lightAccent: z.string().optional(),
      lightAccentForeground: z.string().optional(),
      lightBackground: z.string().optional(),
      lightForeground: z.string().optional(),
      lightMuted: z.string().optional(),
      lightMutedForeground: z.string().optional(),
      lightCard: z.string().optional(),
      lightCardForeground: z.string().optional(),
      lightBorder: z.string().optional(),
      darkPrimary: z.string().optional(),
      darkPrimaryForeground: z.string().optional(),
      darkSecondary: z.string().optional(),
      darkSecondaryForeground: z.string().optional(),
      darkAccent: z.string().optional(),
      darkAccentForeground: z.string().optional(),
      darkBackground: z.string().optional(),
      darkForeground: z.string().optional(),
      darkMuted: z.string().optional(),
      darkMutedForeground: z.string().optional(),
      darkCard: z.string().optional(),
      darkCardForeground: z.string().optional(),
      darkBorder: z.string().optional(),
    });

    const data = validateBody(schema, req.body, res);
    if (!data) return;

    const lightValidation = validatePalette(data, 'light');
    const darkValidation = validatePalette(data, 'dark');
    const hasContrastWarnings = !lightValidation.isValid || !darkValidation.isValid;

    await db.update(orgColorPalettes)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(orgColorPalettes.organizationId, orgId));

    const [newPalette] = await db.insert(orgColorPalettes).values({
      organizationId: orgId,
      paletteName: data.paletteName,
      isPreset: data.isPreset || false,
      isActive: true,
      contrastValidated: !hasContrastWarnings,
      lastValidatedAt: new Date(),
      lightPrimary: data.lightPrimary,
      lightPrimaryForeground: data.lightPrimaryForeground,
      lightSecondary: data.lightSecondary,
      lightSecondaryForeground: data.lightSecondaryForeground,
      lightAccent: data.lightAccent,
      lightAccentForeground: data.lightAccentForeground,
      lightBackground: data.lightBackground,
      lightForeground: data.lightForeground,
      lightMuted: data.lightMuted,
      lightMutedForeground: data.lightMutedForeground,
      lightCard: data.lightCard,
      lightCardForeground: data.lightCardForeground,
      lightBorder: data.lightBorder,
      darkPrimary: data.darkPrimary,
      darkPrimaryForeground: data.darkPrimaryForeground,
      darkSecondary: data.darkSecondary,
      darkSecondaryForeground: data.darkSecondaryForeground,
      darkAccent: data.darkAccent,
      darkAccentForeground: data.darkAccentForeground,
      darkBackground: data.darkBackground,
      darkForeground: data.darkForeground,
      darkMuted: data.darkMuted,
      darkMutedForeground: data.darkMutedForeground,
      darkCard: data.darkCard,
      darkCardForeground: data.darkCardForeground,
      darkBorder: data.darkBorder,
    }).returning();

    const response: PaletteResponse = { success: true, palette: newPalette };
    if (hasContrastWarnings) {
      response.contrastWarnings = {
        message: 'Some color pairs may have low contrast for accessibility',
        light: lightValidation,
        dark: darkValidation,
      };
    }
    res.json(response);
  } catch (error) {
    next(error);
  }
});

router.post('/api/dashboard/org-palette/deactivate', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const role = req.user!.role;

    if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Only admins can modify the organization default theme' });
    }

    if (!orgId) {
      return res.json({ success: true });
    }

    await db.update(orgColorPalettes)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(orgColorPalettes.organizationId, orgId));

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.delete('/api/dashboard/palette/:paletteId', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { paletteId } = req.params;
    const userId = req.user!.id;
    const orgId = req.user!.organizationId;

    if (!orgId) {
      return res.status(403).json({ error: 'Organization required' });
    }

    const [palette] = await db.select().from(userColorPalettes)
      .where(and(
        eq(userColorPalettes.id, paletteId),
        eq(userColorPalettes.organizationId, orgId),
        eq(userColorPalettes.userId, userId)
      ));

    if (!palette) {
      return res.status(404).json({ error: 'Palette not found' });
    }

    await db.delete(userColorPalettes)
      .where(eq(userColorPalettes.id, paletteId));

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ========================================
// Routes from dashboardUserRoutes.ts
// ========================================

const DASHBOARD_CACHE_TTL = 60_000;


// ====================
// Dashboard Routes
// ====================

// Get dashboard statistics
router.get("/api/dashboard/stats", requireAuth, sensitiveLimiter, async (req: AuthRequest, res, next) => {
  try {
    const { shouldFilter, orgId, isSuperAdmin: isSuperAdminUser, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.json({
        activeProjectsCount: 0,
        pendingChangeOrdersCount: 0,
        pendingTimeOffCount: 0,
        activeDelaysCount: 0,
        delaysNeedingAckCount: 0,
        pendingInspectionsCount: 0,
        scheduledInspectionsCount: 0,
        aiTasksCount: 0,
        openBidsCount: 0,
        estimatedBidValue: 0
      });
    }

    const result = await orgScopedCache(orgId, "dashboard:stats", DASHBOARD_CACHE_TTL, async () => {
      const orgCondition = shouldFilter && orgId 
        ? eq(projects.gcOrganizationId, orgId) 
        : sql`true`;

      const activeProjectsResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(projects)
        .where(and(eq(projects.status, "ACTIVE"), orgCondition));
      const activeProjectsCount = activeProjectsResult[0]?.count || 0;

      let pendingChangeOrdersCount = 0;
      if (shouldFilter && orgId) {
        const pendingCOResult = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(changeOrders)
          .innerJoin(projects, eq(changeOrders.projectId, projects.id))
          .where(and(
            eq(changeOrders.status, "SUBMITTED"),
            eq(projects.gcOrganizationId, orgId)
          ));
        pendingChangeOrdersCount = pendingCOResult[0]?.count || 0;
      } else {
        const pendingCOResult = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(changeOrders)
          .where(eq(changeOrders.status, "SUBMITTED"));
        pendingChangeOrdersCount = pendingCOResult[0]?.count || 0;
      }

      let pendingTimeOffCount = 0;
      if (shouldFilter && orgId) {
        const pendingTimeOffResult = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(leaveRequests)
          .where(and(eq(leaveRequests.status, "PENDING"), eq(leaveRequests.organizationId, orgId)));
        pendingTimeOffCount = pendingTimeOffResult[0]?.count || 0;
      } else {
        const pendingTimeOffResult = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(leaveRequests)
          .where(eq(leaveRequests.status, "PENDING"));
        pendingTimeOffCount = pendingTimeOffResult[0]?.count || 0;
      }

      let activeDelaysCount = 0;
      if (shouldFilter && orgId) {
        const activeDelaysResult = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(projectDelays)
          .innerJoin(projects, eq(projectDelays.projectId, projects.id))
          .where(sql`${projectDelays.status} IN ('DRAFT', 'SUBMITTED') AND ${projects.gcOrganizationId} = ${orgId}`);
        activeDelaysCount = activeDelaysResult[0]?.count || 0;
      } else {
        const activeDelaysResult = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(projectDelays)
          .where(sql`${projectDelays.status} IN ('DRAFT', 'SUBMITTED')`);
        activeDelaysCount = activeDelaysResult[0]?.count || 0;
      }

      let delaysNeedingAckCount = 0;
      if (shouldFilter && orgId) {
        const delaysNeedingAckResult = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(projectDelays)
          .innerJoin(projects, eq(projectDelays.projectId, projects.id))
          .where(and(
            eq(projectDelays.status, "SUBMITTED"),
            eq(projects.gcOrganizationId, orgId)
          ));
        delaysNeedingAckCount = delaysNeedingAckResult[0]?.count || 0;
      } else {
        const delaysNeedingAckResult = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(projectDelays)
          .where(eq(projectDelays.status, "SUBMITTED"));
        delaysNeedingAckCount = delaysNeedingAckResult[0]?.count || 0;
      }

      let delaysNeedingChangeOrderCount = 0;
      if (shouldFilter && orgId) {
        const delaysNeedingCOResult = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(projectDelays)
          .innerJoin(projects, eq(projectDelays.projectId, projects.id))
          .where(sql`${projectDelays.changeOrderRequired} = true AND ${projectDelays.linkedChangeOrderId} IS NULL AND ${projects.gcOrganizationId} = ${orgId}`);
        delaysNeedingChangeOrderCount = delaysNeedingCOResult[0]?.count || 0;
      } else {
        const delaysNeedingCOResult = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(projectDelays)
          .where(sql`${projectDelays.changeOrderRequired} = true AND ${projectDelays.linkedChangeOrderId} IS NULL`);
        delaysNeedingChangeOrderCount = delaysNeedingCOResult[0]?.count || 0;
      }

      return {
        activeProjectsCount,
        pendingChangeOrdersCount,
        pendingTimeOffCount,
        activeDelaysCount,
        delaysNeedingAckCount,
        delaysNeedingChangeOrderCount,
      };
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Get KPI metric data for dashboard KPI Summary Cards
router.get("/api/dashboard/kpi", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    const metric = req.query.metric as string;
    const dateRange = (req.query.dateRange as string) || "THIS_MONTH";
    const comparison = (req.query.comparison as string) || "LAST_MONTH";

    if (!metric) {
      return res.status(400).json({ error: "metric parameter is required" });
    }

    if (mustDenyAccess) {
      return res.json({ value: 0, previousValue: 0, changePercent: 0, label: metric, dateRangeLabel: dateRange, isEstimated: true });
    }

    const orgCondition = shouldFilter && orgId
      ? eq(projects.status, projects.status)
      : sql`true`;

    const now = new Date();
    let periodStart: Date;
    let periodEnd: Date = now;
    let prevStart: Date;
    let prevEnd: Date;
    let dateRangeLabel: string;

    switch (dateRange) {
      case "THIS_WEEK": {
        const dayOfWeek = now.getDay();
        periodStart = new Date(now);
        periodStart.setDate(now.getDate() - dayOfWeek);
        periodStart.setHours(0, 0, 0, 0);
        prevStart = new Date(periodStart);
        prevStart.setDate(prevStart.getDate() - 7);
        prevEnd = new Date(periodStart);
        dateRangeLabel = "This Week";
        break;
      }
      case "THIS_QUARTER": {
        const quarter = Math.floor(now.getMonth() / 3);
        periodStart = new Date(now.getFullYear(), quarter * 3, 1);
        prevStart = new Date(now.getFullYear(), (quarter - 1) * 3, 1);
        prevEnd = new Date(periodStart);
        dateRangeLabel = `Q${quarter + 1} ${now.getFullYear()}`;
        break;
      }
      case "THIS_YEAR": {
        periodStart = new Date(now.getFullYear(), 0, 1);
        prevStart = new Date(now.getFullYear() - 1, 0, 1);
        prevEnd = new Date(now.getFullYear(), 0, 1);
        dateRangeLabel = `${now.getFullYear()}`;
        break;
      }
      default: {
        periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
        prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        prevEnd = new Date(periodStart);
        dateRangeLabel = now.toLocaleString("default", { month: "long", year: "numeric" });
        break;
      }
    }

    let value = 0;
    let previousValue = 0;
    let label = "";
    let isEstimated = false;

    const orgFilter = shouldFilter && orgId ? eq(projects.gcOrganizationId, orgId) : sql`true`;

    switch (metric) {
      case "ACTIVE_PROJECTS": {
        label = "Active Projects";
        const result = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(projects)
          .where(and(eq(projects.status, "ACTIVE"), orgFilter));
        value = result[0]?.count || 0;
        previousValue = Math.max(0, value - Math.floor(Math.random() * 3));
        isEstimated = true;
        break;
      }
      case "OPEN_RFIS": {
        label = "Open RFIs";
        const rfiOrgFilter = shouldFilter && orgId ? eq(rfis.organizationId, orgId) : sql`true`;
        const result = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(rfis)
          .where(and(sql`${rfis.status} IN ('SUBMITTED', 'UNDER_REVIEW')`, rfiOrgFilter));
        value = result[0]?.count || 0;
        const prevResult = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(rfis)
          .where(and(
            sql`${rfis.status} IN ('ANSWERED', 'CLOSED')`,
            sql`${rfis.dateAnswered} >= ${prevStart.toISOString()}::timestamp`,
            sql`${rfis.dateAnswered} < ${periodStart.toISOString()}::timestamp`,
            rfiOrgFilter
          ));
        previousValue = prevResult[0]?.count || 0;
        isEstimated = false;
        break;
      }
      case "TOTAL_LABOR_COST": {
        label = "Total Labor Cost";
        const activeCount = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(projects)
          .where(and(eq(projects.status, "ACTIVE"), orgFilter));
        const projectCount = activeCount[0]?.count || 0;
        value = projectCount * 12500 + Math.floor(Math.random() * 5000);
        previousValue = Math.floor(value * (0.85 + Math.random() * 0.2));
        isEstimated = true;
        break;
      }
      case "REVENUE_THIS_MONTH": {
        label = "Revenue This Month";
        const revOrgCond = shouldFilter && orgId ? sql`AND p."gc_organization_id" = ${orgId}` : sql``;
        const revTmOrgCond = shouldFilter && orgId ? sql`AND i."organization_id" = ${orgId}` : sql``;
        const revResult = await db.execute(sql`
          SELECT
            COALESCE((
              SELECT SUM(sli."this_period_completed"::numeric)
              FROM "sov_line_items" sli
              JOIN "schedule_of_values" sov ON sli."sov_id" = sov."id"
              JOIN "projects" p ON sov."project_id" = p."id"
              WHERE sli."updated_at" >= ${periodStart.toISOString()}::timestamp
                AND sli."updated_at" < ${periodEnd.toISOString()}::timestamp
                ${revOrgCond}
            ), 0) +
            COALESCE((
              SELECT SUM(i."total"::numeric)
              FROM "tm_invoices" i
              WHERE i."status"::text IN ('SENT', 'PAID')
                AND i."created_at" >= ${periodStart.toISOString()}::timestamp
                AND i."created_at" < ${periodEnd.toISOString()}::timestamp
                ${revTmOrgCond}
            ), 0) as total
        `);
        value = parseFloat((revResult.rows[0] as any)?.total || "0");
        const prevRevResult = await db.execute(sql`
          SELECT
            COALESCE((
              SELECT SUM(sli."this_period_completed"::numeric)
              FROM "sov_line_items" sli
              JOIN "schedule_of_values" sov ON sli."sov_id" = sov."id"
              JOIN "projects" p ON sov."project_id" = p."id"
              WHERE sli."updated_at" >= ${prevStart.toISOString()}::timestamp
                AND sli."updated_at" < ${prevEnd.toISOString()}::timestamp
                ${revOrgCond}
            ), 0) +
            COALESCE((
              SELECT SUM(i."total"::numeric)
              FROM "tm_invoices" i
              WHERE i."status"::text IN ('SENT', 'PAID')
                AND i."created_at" >= ${prevStart.toISOString()}::timestamp
                AND i."created_at" < ${prevEnd.toISOString()}::timestamp
                ${revTmOrgCond}
            ), 0) as total
        `);
        previousValue = parseFloat((prevRevResult.rows[0] as any)?.total || "0");
        isEstimated = false;
        break;
      }
      case "OUTSTANDING_PAYABLES": {
        label = "Outstanding Payables";
        const activeCount = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(projects)
          .where(and(eq(projects.status, "ACTIVE"), orgFilter));
        const projectCount = activeCount[0]?.count || 0;
        value = projectCount * 8200 + Math.floor(Math.random() * 3000);
        previousValue = Math.floor(value * (0.9 + Math.random() * 0.2));
        isEstimated = true;
        break;
      }
      case "GROSS_MARGIN": {
        label = "Gross Margin %";
        const gmOrgCond = shouldFilter && orgId ? sql`AND pps."organization_id" = ${orgId}` : sql``;
        // Use the latest profitability snapshot per project to compute org-wide margin
        const gmResult = await db.execute(sql`
          WITH latest_snapshots AS (
            SELECT DISTINCT ON (pps."project_id")
              pps."adjusted_budget"::numeric as adjusted_budget,
              pps."total_actual_cost"::numeric as total_actual_cost,
              pps."estimated_margin"::numeric as estimated_margin
            FROM "project_profitability_snapshots" pps
            WHERE 1=1 ${gmOrgCond}
            ORDER BY pps."project_id", pps."created_at" DESC
          )
          SELECT
            COALESCE(SUM(adjusted_budget), 0) as total_budget,
            COALESCE(SUM(total_actual_cost), 0) as total_cost,
            COALESCE(SUM(estimated_margin), 0) as total_margin
          FROM latest_snapshots
        `);
        const totalBudget = parseFloat((gmResult.rows[0] as any)?.total_budget || "0");
        const totalCost = parseFloat((gmResult.rows[0] as any)?.total_cost || "0");
        // Derive margin directly from contract (adjusted budget) minus actual cost for accuracy
        value = totalBudget > 0 ? Math.round(((totalBudget - totalCost) / totalBudget) * 100) : 0;

        // Previous period: snapshots created in the previous month window
        const prevGmOrgCond = shouldFilter && orgId ? sql`AND pps."organization_id" = ${orgId}` : sql``;
        const prevGmResult = await db.execute(sql`
          WITH prev_latest AS (
            SELECT DISTINCT ON (pps."project_id")
              pps."adjusted_budget"::numeric as adjusted_budget,
              pps."total_actual_cost"::numeric as total_actual_cost,
              pps."estimated_margin"::numeric as estimated_margin
            FROM "project_profitability_snapshots" pps
            WHERE pps."created_at" < ${prevEnd.toISOString()}::timestamp
              ${prevGmOrgCond}
            ORDER BY pps."project_id", pps."created_at" DESC
          )
          SELECT
            COALESCE(SUM(adjusted_budget), 0) as total_budget,
            COALESCE(SUM(total_actual_cost), 0) as total_cost
          FROM prev_latest
        `);
        const prevBudget = parseFloat((prevGmResult.rows[0] as any)?.total_budget || "0");
        const prevCost = parseFloat((prevGmResult.rows[0] as any)?.total_cost || "0");
        previousValue = prevBudget > 0 ? Math.round(((prevBudget - prevCost) / prevBudget) * 100) : 0;
        isEstimated = false;
        break;
      }
      default: {
        label = metric.replace(/_/g, " ");
        value = 0;
        previousValue = 0;
        isEstimated = true;
      }
    }

    const changePercent = previousValue > 0 ? Math.round(((value - previousValue) / previousValue) * 100) : 0;

    res.json({
      value,
      previousValue,
      changePercent,
      label,
      dateRangeLabel,
      isEstimated,
    });
  } catch (error) {
    next(error);
  }
});

// Get comprehensive dashboard snapshot for AI analysis
router.get("/api/dashboard/snapshot", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res, next) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess || !orgId) {
      return res.status(403).json({ error: "Organization required for dashboard snapshot" });
    }

    const { buildDashboardSnapshot, buildAISnapshotData } = await import("./dataPipelineService");
    
    const snapshot = await buildDashboardSnapshot(orgId);
    const aiData = await buildAISnapshotData(orgId);
    
    res.json({ snapshot, aiData });
  } catch (error) {
    next(error);
  }
});

// Aggregate time tracking data for production rate calculations
router.post("/api/dashboard/aggregate-time-tracking", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res, next) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess || !orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const timeTrackingSchema = z.object({
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    });
    const ttData = validateBody(timeTrackingSchema, req.body, res);
    if (!ttData) return;
    const { startDate, endDate } = ttData;
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      res.status(400).json({ error: "Invalid date format for startDate or endDate" });
      return;
    }

    const { aggregateTimeTrackingToProductionRates } = await import("./dataPipelineService");
    
    const result = await aggregateTimeTrackingToProductionRates(orgId, start, end);
    
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// ====================
// User Management Routes
// ====================

// Create user schema (omit passwordHash, add password)
const createUserSchema = insertUserSchema.omit({ passwordHash: true }).extend({
  password: passwordSchema,
});

const updateUserSchema = insertUserSchema.omit({ passwordHash: true }).partial().extend({
  password: passwordSchema.optional(),
  roleLabel: z.string().max(100, "Display title must be 100 characters or less").optional().nullable(),
});

// Get all users (Admin/Manager/Office Manager)
router.get("/api/users", requireAuth, requireRole("ADMIN", "HUSTLER", "MANAGER", "ESTIMATOR", "SUPERINTENDENT"), async (req: AuthRequest, res, next) => {
  try {
    // Organization filtering: SUPER_ADMIN sees all users, others see only their org's users
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    // SECURITY: Users without org can't see any users
    if (mustDenyAccess) {
      return res.json([]);
    }
    
    let allUsers;
    if (shouldFilter && orgId) {
      allUsers = await db.select().from(users).where(
        and(eq(users.organizationId, orgId), sql`${users.role} != 'SUPER_ADMIN'`)
      );
    } else {
      allUsers = await db.select().from(users);
    }
    const usersWithoutPasswords = allUsers.map(({ passwordHash, ...user }) => user);
    res.json(usersWithoutPasswords);
  } catch (error) {
    next(error);
  }
});

// Get user by ID (aligned with /api/users list endpoint)
router.get("/api/users/:id", requireAuth, requireRole("ADMIN", "HUSTLER", "MANAGER", "SUPERINTENDENT", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
  try {
    const [user] = await db.select().from(users).where(eq(users.id, req.params.id)).limit(1);
    
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    if (!verifyUserOrgAccess(req, res, user)) return;

    const { passwordHash, ...userWithoutPassword } = user;
    res.json(userWithoutPassword);
  } catch (error) {
    next(error);
  }
});

// Create user (Admin only)
router.post("/api/users", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res, next) => {
  try {
    // SECURITY: Sanitize text inputs for data integrity
    const sanitizedBody = {
      ...req.body,
      firstName: sanitizeShortText(req.body.firstName),
      lastName: sanitizeShortText(req.body.lastName),
      email: sanitizeEmail(req.body.email),
      phone: sanitizePhone(req.body.phone),
      password: req.body.password, // Don't sanitize passwords - preserve exact input
    };

    const validationResult = createUserSchema.safeParse(sanitizedBody);
    
    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    const { firstName, lastName, email, phone, role, password } = validationResult.data;

    if (role === "SUPER_ADMIN" && req.user?.role !== "SUPER_ADMIN") {
      res.status(403).json({ error: "Cannot assign Super Admin role" }); return;
    }

    const passwordHash = await hashPassword(password);

    // Auto-assign to requesting admin's organization
    const [newUser] = await db.insert(users).values({
      firstName,
      lastName,
      email,
      phone: phone || null,
      role: role || "FIELD_WORKER",
      isActive: true,
      passwordHash,
      organizationId: req.user!.organizationId,
    }).returning();

    const { passwordHash: _, ...userWithoutPassword } = newUser;
    res.status(201).json(userWithoutPassword);
  } catch (error: any) {
    logError("Create user error:", {}, error instanceof Error ? error : new Error(String(error)));
    if (error.code === '23505') { // Unique violation
      res.status(409).json({ error: "Email already exists" });
    } else {
      next(error);
    }
  }
});

// Update user (Admin only)
router.patch("/api/users/:id", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res, next) => {
  try {
    const [targetUser] = await db.select({ organizationId: users.organizationId, role: users.role, roleLabel: users.roleLabel }).from(users).where(eq(users.id, req.params.id)).limit(1);
    if (!targetUser) { res.status(404).json({ error: "User not found" }); return; }
    if (targetUser.role === "SUPER_ADMIN" && req.user?.role !== "SUPER_ADMIN") {
      res.status(403).json({ error: "Cannot modify a Super Admin user" }); return;
    }
    if (req.body.role === "SUPER_ADMIN" && req.user?.role !== "SUPER_ADMIN") {
      res.status(403).json({ error: "Cannot assign Super Admin role" }); return;
    }
    if (!verifyUserOrgAccess(req, res, targetUser)) return;

    // SECURITY: Sanitize text inputs for data integrity
    const sanitizedBody = {
      ...req.body,
      firstName: req.body.firstName ? sanitizeShortText(req.body.firstName) : undefined,
      lastName: req.body.lastName ? sanitizeShortText(req.body.lastName) : undefined,
      email: req.body.email ? sanitizeEmail(req.body.email) : undefined,
      phone: req.body.phone ? sanitizePhone(req.body.phone) : undefined,
      password: req.body.password, // Don't sanitize passwords - preserve exact input
    };

    const validationResult = updateUserSchema.safeParse(sanitizedBody);
    
    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    const { firstName, lastName, email, phone, role, isActive, password, roleLabel } = validationResult.data;
    
    const updateData: any = {};
    if (firstName !== undefined) updateData.firstName = firstName;
    if (lastName !== undefined) updateData.lastName = lastName;
    if (email !== undefined) updateData.email = email;
    if (phone !== undefined) updateData.phone = phone;
    if (role !== undefined) updateData.role = role;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (password !== undefined) updateData.passwordHash = await hashPassword(password);
    if (roleLabel !== undefined) updateData.roleLabel = roleLabel || null;

    if (email !== undefined || password !== undefined || isActive === false) {
      updateData.tokenVersion = sql`COALESCE(${users.tokenVersion}, 0) + 1`;
    }
    
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

    if (roleLabel !== undefined) {
      await logUpdate(
        req.user!.id,
        "userRoleLabel",
        req.params.id,
        { roleLabel: targetUser.roleLabel || null },
        { roleLabel: roleLabel || null },
        req
      );
    }

    const { passwordHash, tokenVersion, ...userWithoutPassword } = updatedUser;
    res.json(userWithoutPassword);
  } catch (error: any) {
    logError("Update user error:", {}, error instanceof Error ? error : new Error(String(error)));
    if (error.code === '23505') {
      res.status(409).json({ error: "Email already exists" });
    } else {
      next(error);
    }
  }
});

// Update user cost rates (Admin only)
router.patch("/api/users/:id/cost-rates", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res, next) => {
  try {
    const [targetUserCheck] = await db.select({ role: users.role }).from(users).where(eq(users.id, req.params.id)).limit(1);
    if (targetUserCheck?.role === "SUPER_ADMIN" && req.user?.role !== "SUPER_ADMIN") {
      res.status(403).json({ error: "Cannot modify a Super Admin user" }); return;
    }

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

    if (!verifyUserOrgAccess(req, res, user)) return;

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
    next(error);
  }
});

// Revoke all user tokens (logout all devices) - Admin only
router.post("/api/users/:id/revoke-tokens", requireAuth, requireRole("ADMIN"), sensitiveLimiter, async (req: AuthRequest, res, next) => {
  try {
    const [user] = await db.select().from(users).where(eq(users.id, req.params.id)).limit(1);
    
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    if (!verifyUserOrgAccess(req, res, user)) return;

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
    next(error);
  }
});

// Change own password
router.post("/api/auth/change-password", requireAuth, sensitiveLimiter, async (req: AuthRequest, res, next) => {
  try {
    const schema = z.object({
      currentPassword: z.string().min(1),
      newPassword: passwordSchema,
    });

    const data = validateBody(schema, req.body, res);
    if (!data) return;

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
    next(error);
  }
});

router.post("/api/auth/set-initial-password", requireAuth, sensitiveLimiter, async (req: AuthRequest, res, next) => {
  try {
    const schema = z.object({
      password: passwordSchema,
    });

    const data = validateBody(schema, req.body, res);
    if (!data) return;

    const [user] = await db.select().from(users).where(eq(users.id, req.user!.id)).limit(1);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const accountAge = Date.now() - new Date(user.createdAt!).getTime();
    if (accountAge > 24 * 60 * 60 * 1000) {
      return res.status(403).json({ error: "Initial password setup window has expired. Use change password instead." });
    }

    const newPasswordHash = await hashPassword(data.password);

    await db
      .update(users)
      .set({ passwordHash: newPasswordHash, updatedAt: new Date() })
      .where(eq(users.id, req.user!.id));

    res.json({ success: true, message: "Password set successfully" });
  } catch (error) {
    next(error);
  }
});

// ====================
// Dashboard Trend Chart Data
// ====================

const TREND_METRICS = ["LABOR_COST", "REVENUE", "BID_WIN_RATE", "OVERTIME_HOURS", "CASH_FLOW"] as const;
const TREND_PERIODS = ["7D", "30D", "90D", "6M", "1Y"] as const;
const TREND_GROUP_BY = ["NONE", "PROJECT", "TRADE"] as const;

function getPeriodDates(period: string): { start: Date; end: Date; bucketFormat: string } {
  const end = new Date();
  const start = new Date();

  switch (period) {
    case "7D":
      start.setDate(end.getDate() - 7);
      return { start, end, bucketFormat: "YYYY-MM-DD" };
    case "30D":
      start.setDate(end.getDate() - 30);
      return { start, end, bucketFormat: "YYYY-MM-DD" };
    case "90D":
      start.setDate(end.getDate() - 90);
      return { start, end, bucketFormat: "YYYY-\"W\"IW" };
    case "6M":
      start.setMonth(end.getMonth() - 6);
      return { start, end, bucketFormat: "YYYY-\"W\"IW" };
    case "1Y":
      start.setFullYear(end.getFullYear() - 1);
      return { start, end, bucketFormat: "YYYY-MM" };
    default:
      start.setDate(end.getDate() - 30);
      return { start, end, bucketFormat: "YYYY-MM-DD" };
  }
}

router.get("/api/dashboard/trend", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const metric = req.query.metric as string;
    const period = (req.query.period as string) || "30D";
    const groupBy = (req.query.groupBy as string) || "NONE";

    if (!metric || !TREND_METRICS.includes(metric as any)) {
      return res.status(400).json({ error: `Invalid metric. Must be one of: ${TREND_METRICS.join(", ")}` });
    }
    if (!TREND_PERIODS.includes(period as any)) {
      return res.status(400).json({ error: `Invalid period. Must be one of: ${TREND_PERIODS.join(", ")}` });
    }
    if (!TREND_GROUP_BY.includes(groupBy as any)) {
      return res.status(400).json({ error: `Invalid groupBy. Must be one of: ${TREND_GROUP_BY.join(", ")}` });
    }

    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.json({ points: [], metric, period, groupBy });
    }

    const trendCacheKey = `dashboard:trend:${metric}:${period}:${groupBy}`;
    const trendResult = await orgScopedCache(orgId, trendCacheKey, DASHBOARD_CACHE_TTL, async () => {

    const { start, end, bucketFormat } = getPeriodDates(period);

    const orgFilter = shouldFilter && orgId
      ? sql`AND p."gc_organization_id" = ${orgId}`
      : sql``;

    const orgFilterDirect = shouldFilter && orgId
      ? sql`AND "gc_organization_id" = ${orgId}`
      : sql``;

    let groupSelect: ReturnType<typeof sql>;
    let groupByClause: ReturnType<typeof sql>;
    if (groupBy === "PROJECT") {
      groupSelect = sql`p."name" as "group"`;
      groupByClause = sql`GROUP BY bucket, p."name"`;
    } else if (groupBy === "TRADE") {
      groupSelect = sql`COALESCE(o."trade_type"::text, 'UNKNOWN') as "group"`;
      groupByClause = sql`GROUP BY bucket, o."trade_type"::text`;
    } else {
      groupSelect = sql`'All' as "group"`;
      groupByClause = sql`GROUP BY bucket`;
    }

    let points: Array<{ date: string; value: number; group?: string }> = [];

    switch (metric) {
      case "LABOR_COST": {
        const tradeJoin = groupBy === "TRADE"
          ? sql`LEFT JOIN "organizations" o ON p."gc_organization_id" = o."id"`
          : sql``;

        const result = await db.execute(sql`
          SELECT
            to_char(te."date", ${bucketFormat}) as bucket,
            ${groupSelect},
            COALESCE(SUM(
              (CAST(te."hours_regular" AS numeric) * COALESCE(u."cost_rate_regular", 45)) +
              (CAST(te."hours_overtime" AS numeric) * COALESCE(u."cost_rate_overtime", 67.5))
            ), 0) as value
          FROM "time_entries" te
          JOIN "projects" p ON te."project_id" = p."id"
          LEFT JOIN "users" u ON te."user_id" = u."id"
          ${tradeJoin}
          WHERE te."date" >= ${start} AND te."date" <= ${end}
          ${orgFilter}
          ${groupByClause}
          ORDER BY bucket
        `);
        points = (result.rows as any[]).map(r => ({
          date: r.bucket,
          value: parseFloat(r.value) || 0,
          group: groupBy !== "NONE" ? r.group : undefined,
        }));
        break;
      }

      case "REVENUE": {
        const tradeJoin = groupBy === "TRADE"
          ? sql`LEFT JOIN "organizations" o ON p."gc_organization_id" = o."id"`
          : sql``;

        const groupSelectRev = groupBy === "PROJECT"
          ? sql`p."name" as "group"`
          : groupBy === "TRADE"
            ? sql`COALESCE(o."trade_type"::text, 'UNKNOWN') as "group"`
            : sql`'All' as "group"`;

        const groupByRev = groupBy === "PROJECT"
          ? sql`GROUP BY bucket, p."name"`
          : groupBy === "TRADE"
            ? sql`GROUP BY bucket, o."trade_type"::text`
            : sql`GROUP BY bucket`;

        const result = await db.execute(sql`
          SELECT
            to_char(p."created_at", ${bucketFormat}) as bucket,
            ${groupSelectRev},
            COALESCE(SUM(CAST(COALESCE(p."contract_amount", '0') AS numeric)), 0) as value
          FROM "projects" p
          ${tradeJoin}
          WHERE p."created_at" >= ${start} AND p."created_at" <= ${end}
          ${orgFilterDirect.append(sql``)}
          ${groupByRev}
          ORDER BY bucket
        `);
        points = (result.rows as any[]).map(r => ({
          date: r.bucket,
          value: parseFloat(r.value) || 0,
          group: groupBy !== "NONE" ? r.group : undefined,
        }));
        break;
      }

      case "BID_WIN_RATE": {
        const tradeJoin = groupBy === "TRADE"
          ? sql`LEFT JOIN "organizations" o ON b."gc_organization_id" = o."id"`
          : sql``;

        const groupSelectBid = groupBy === "PROJECT"
          ? sql`b."name" as "group"`
          : groupBy === "TRADE"
            ? sql`COALESCE(o."trade_type"::text, 'UNKNOWN') as "group"`
            : sql`'All' as "group"`;

        const groupByBid = groupBy === "PROJECT"
          ? sql`GROUP BY bucket, b."name"`
          : groupBy === "TRADE"
            ? sql`GROUP BY bucket, o."trade_type"::text`
            : sql`GROUP BY bucket`;

        const bidOrgFilter = shouldFilter && orgId
          ? sql`AND b."gc_organization_id" = ${orgId}`
          : sql``;

        const result = await db.execute(sql`
          SELECT
            to_char(b."created_at", ${bucketFormat}) as bucket,
            ${groupSelectBid},
            CASE
              WHEN COUNT(*) = 0 THEN 0
              ELSE ROUND((COUNT(*) FILTER (WHERE b."status" = 'AWARDED')::numeric / COUNT(*)::numeric) * 100, 1)
            END as value
          FROM "bids" b
          ${tradeJoin}
          WHERE b."created_at" >= ${start} AND b."created_at" <= ${end}
          ${bidOrgFilter}
          ${groupByBid}
          ORDER BY bucket
        `);
        points = (result.rows as any[]).map(r => ({
          date: r.bucket,
          value: parseFloat(r.value) || 0,
          group: groupBy !== "NONE" ? r.group : undefined,
        }));
        break;
      }

      case "OVERTIME_HOURS": {
        const tradeJoin = groupBy === "TRADE"
          ? sql`LEFT JOIN "organizations" o ON p."gc_organization_id" = o."id"`
          : sql``;

        const result = await db.execute(sql`
          SELECT
            to_char(te."date", ${bucketFormat}) as bucket,
            ${groupSelect},
            COALESCE(SUM(CAST(te."hours_overtime" AS numeric)), 0) as value
          FROM "time_entries" te
          JOIN "projects" p ON te."project_id" = p."id"
          ${tradeJoin}
          WHERE te."date" >= ${start} AND te."date" <= ${end}
          ${orgFilter}
          ${groupByClause}
          ORDER BY bucket
        `);
        points = (result.rows as any[]).map(r => ({
          date: r.bucket,
          value: parseFloat(r.value) || 0,
          group: groupBy !== "NONE" ? r.group : undefined,
        }));
        break;
      }

      case "CASH_FLOW": {
        const revenueResult = await db.execute(sql`
          SELECT
            to_char(p."created_at", ${bucketFormat}) as bucket,
            COALESCE(SUM(CAST(COALESCE(p."contract_amount", '0') AS numeric)), 0) as value
          FROM "projects" p
          WHERE p."created_at" >= ${start} AND p."created_at" <= ${end}
          ${orgFilterDirect}
          GROUP BY bucket
          ORDER BY bucket
        `);

        const costResult = await db.execute(sql`
          SELECT
            to_char(te."date", ${bucketFormat}) as bucket,
            COALESCE(SUM(
              (CAST(te."hours_regular" AS numeric) * COALESCE(u."cost_rate_regular", 45)) +
              (CAST(te."hours_overtime" AS numeric) * COALESCE(u."cost_rate_overtime", 67.5))
            ), 0) as value
          FROM "time_entries" te
          JOIN "projects" p ON te."project_id" = p."id"
          LEFT JOIN "users" u ON te."user_id" = u."id"
          WHERE te."date" >= ${start} AND te."date" <= ${end}
          ${orgFilter}
          GROUP BY bucket
          ORDER BY bucket
        `);

        const revenueMap = new Map<string, number>();
        (revenueResult.rows as any[]).forEach(r => revenueMap.set(r.bucket, parseFloat(r.value) || 0));
        const costMap = new Map<string, number>();
        (costResult.rows as any[]).forEach(r => costMap.set(r.bucket, parseFloat(r.value) || 0));

        const allBuckets = new Set([...revenueMap.keys(), ...costMap.keys()]);
        points = Array.from(allBuckets)
          .sort()
          .map(bucket => ({
            date: bucket,
            value: (revenueMap.get(bucket) || 0) - (costMap.get(bucket) || 0),
          }));
        break;
      }
    }

    return { points, metric, period, groupBy };
    });

    res.json(trendResult);
  } catch (error) {
    next(error);
  }
});

// ====================
// Dashboard List Widget Data
// ====================

const LIST_ENTITIES = ["PROJECTS", "ORGANIZATIONS", "TIME_ENTRIES", "PAY_RUNS", "SUBCONTRACTS", "CHANGE_ORDERS"] as const;
const LIST_LIMITS = [5, 10, 20] as const;

const ENTITY_SORT_FIELDS: Record<string, string[]> = {
  PROJECTS: ["name", "status", "created_at", "start_date", "contract_amount"],
  ORGANIZATIONS: ["name", "trade_type", "created_at"],
  TIME_ENTRIES: ["date", "hours_regular", "approval_status", "created_at"],
  PAY_RUNS: ["pay_period_start", "status", "total_labor_cost", "created_at"],
  SUBCONTRACTS: ["contract_number", "status", "contract_amount", "start_date", "created_at"],
  CHANGE_ORDERS: ["change_order_number", "status", "amount", "created_at"],
};

router.get("/api/dashboard/list", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const entity = req.query.entity as string;
    const status = (req.query.status as string) || "";
    const sortBy = (req.query.sortBy as string) || "created_at";
    const sortDir = (req.query.sortDir as string) || "desc";
    const limit = parseInt(req.query.limit as string) || 5;

    if (!entity || !LIST_ENTITIES.includes(entity as any)) {
      return res.status(400).json({ error: `Invalid entity. Must be one of: ${LIST_ENTITIES.join(", ")}` });
    }
    if (!LIST_LIMITS.includes(limit as any)) {
      return res.status(400).json({ error: `Invalid limit. Must be one of: ${LIST_LIMITS.join(", ")}` });
    }
    const allowedSorts = ENTITY_SORT_FIELDS[entity] || [];
    const safeSortBy = allowedSorts.includes(sortBy) ? sortBy : "created_at";

    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.json({ items: [], entity, total: 0 });
    }

    const orderDir = sortDir === "asc" ? sql`ASC` : sql`DESC`;
    let items: any[] = [];
    let total = 0;

    switch (entity) {
      case "PROJECTS": {
        const orgCond = shouldFilter && orgId ? sql`AND p."gc_organization_id" = ${orgId}` : sql``;
        const statusCond = status ? sql`AND p."status"::text = ${status}` : sql``;
        const countResult = await db.execute(sql`
          SELECT COUNT(*)::int as count FROM "projects" p WHERE true ${orgCond} ${statusCond}
        `);
        total = (countResult.rows[0] as any)?.count || 0;
        const result = await db.execute(sql`
          SELECT p."id", p."name", p."client_name", p."status"::text, p."start_date",
                 p."contract_amount", p."created_at", p."code"
          FROM "projects" p
          WHERE true ${orgCond} ${statusCond}
          ORDER BY ${sql.raw(`p."${safeSortBy}"`)} ${orderDir} NULLS LAST
          LIMIT ${limit}
        `);
        items = (result.rows as any[]).map(r => ({
          id: r.id,
          code: r.code,
          title: r.name,
          subtitle: r.client_name,
          status: r.status,
          date: r.start_date || r.created_at,
          amount: r.contract_amount ? parseFloat(r.contract_amount) : null,
          link: `/projects/${r.code}`,
        }));
        break;
      }

      case "ORGANIZATIONS": {
        const statusCond = status ? sql`AND o."onboarding_status"::text = ${status}` : sql``;
        const orgCond = shouldFilter && orgId ? sql`AND o."id" = ${orgId}` : sql``;
        const countResult = await db.execute(sql`
          SELECT COUNT(*)::int as count FROM "organizations" o WHERE true ${orgCond} ${statusCond}
        `);
        total = (countResult.rows[0] as any)?.count || 0;
        const result = await db.execute(sql`
          SELECT o."id", o."name", o."trade_type"::text, o."onboarding_status"::text as status,
                 o."created_at", o."slug"
          FROM "organizations" o
          WHERE true ${orgCond} ${statusCond}
          ORDER BY ${sql.raw(`o."${safeSortBy}"`)} ${orderDir} NULLS LAST
          LIMIT ${limit}
        `);
        items = (result.rows as any[]).map(r => ({
          id: r.id,
          title: r.name,
          subtitle: r.trade_type?.replace(/_/g, " ") || "Unknown",
          status: r.status,
          date: r.created_at,
          amount: null,
        }));
        break;
      }

      case "TIME_ENTRIES": {
        const orgCond = shouldFilter && orgId ? sql`AND p."gc_organization_id" = ${orgId}` : sql``;
        const statusCond = status ? sql`AND te."approval_status"::text = ${status}` : sql``;
        const countResult = await db.execute(sql`
          SELECT COUNT(*)::int as count
          FROM "time_entries" te
          JOIN "projects" p ON te."project_id" = p."id"
          WHERE true ${orgCond} ${statusCond}
        `);
        total = (countResult.rows[0] as any)?.count || 0;
        const result = await db.execute(sql`
          SELECT te."id", te."date", te."hours_regular", te."hours_overtime",
                 te."approval_status"::text as status, te."created_at",
                 p."name" as project_name, u."first_name", u."last_name"
          FROM "time_entries" te
          JOIN "projects" p ON te."project_id" = p."id"
          JOIN "users" u ON te."user_id" = u."id"
          WHERE true ${orgCond} ${statusCond}
          ORDER BY ${sql.raw(`te."${safeSortBy}"`)} ${orderDir} NULLS LAST
          LIMIT ${limit}
        `);
        items = (result.rows as any[]).map(r => ({
          id: r.id,
          title: r.project_name,
          subtitle: `${r.first_name} ${r.last_name}`,
          status: r.status,
          date: r.date,
          amount: parseFloat(r.hours_regular || "0") + parseFloat(r.hours_overtime || "0"),
          amountLabel: "hrs",
        }));
        break;
      }

      case "PAY_RUNS": {
        const orgCond = shouldFilter && orgId ? sql`AND pr."organization_id" = ${orgId}` : sql``;
        const statusCond = status ? sql`AND pr."status"::text = ${status}` : sql``;
        const countResult = await db.execute(sql`
          SELECT COUNT(*)::int as count FROM "pay_runs" pr WHERE true ${orgCond} ${statusCond}
        `);
        total = (countResult.rows[0] as any)?.count || 0;
        const result = await db.execute(sql`
          SELECT pr."id", pr."run_number", pr."pay_period_start", pr."pay_period_end",
                 pr."status"::text, pr."total_labor_cost", pr."total_workers", pr."created_at"
          FROM "pay_runs" pr
          WHERE true ${orgCond} ${statusCond}
          ORDER BY ${sql.raw(`pr."${safeSortBy}"`)} ${orderDir} NULLS LAST
          LIMIT ${limit}
        `);
        items = (result.rows as any[]).map(r => ({
          id: r.id,
          title: r.run_number || "Pay Run",
          subtitle: `${new Date(r.pay_period_start).toLocaleDateString()} – ${new Date(r.pay_period_end).toLocaleDateString()}`,
          status: r.status,
          date: r.created_at,
          amount: r.total_labor_cost ? parseFloat(r.total_labor_cost) : null,
        }));
        break;
      }

      case "SUBCONTRACTS": {
        const orgCond = shouldFilter && orgId ? sql`AND p."gc_organization_id" = ${orgId}` : sql``;
        const statusCond = status ? sql`AND sc."status" = ${status}` : sql``;
        const countResult = await db.execute(sql`
          SELECT COUNT(*)::int as count
          FROM "subcontractor_contracts" sc
          JOIN "projects" p ON sc."project_id" = p."id"
          WHERE true ${orgCond} ${statusCond}
        `);
        total = (countResult.rows[0] as any)?.count || 0;
        const result = await db.execute(sql`
          SELECT sc."id", sc."contract_number", sc."status", sc."contract_amount",
                 sc."start_date", sc."created_at",
                 p."name" as project_name,
                 co."name" as sub_name
          FROM "subcontractor_contracts" sc
          JOIN "projects" p ON sc."project_id" = p."id"
          LEFT JOIN "crm_organisations" co ON sc."subcontractor_id" = co."id"
          WHERE true ${orgCond} ${statusCond}
          ORDER BY ${sql.raw(`sc."${safeSortBy}"`)} ${orderDir} NULLS LAST
          LIMIT ${limit}
        `);
        items = (result.rows as any[]).map(r => ({
          id: r.id,
          title: r.contract_number,
          subtitle: `${r.sub_name || "Unknown"} — ${r.project_name}`,
          status: r.status,
          date: r.start_date || r.created_at,
          amount: r.contract_amount ? parseFloat(r.contract_amount) : null,
        }));
        break;
      }

      case "CHANGE_ORDERS": {
        const orgCond = shouldFilter && orgId ? sql`AND p."gc_organization_id" = ${orgId}` : sql``;
        const statusCond = status ? sql`AND co."status"::text = ${status}` : sql``;
        const countResult = await db.execute(sql`
          SELECT COUNT(*)::int as count
          FROM "change_orders" co
          JOIN "projects" p ON co."project_id" = p."id"
          WHERE true ${orgCond} ${statusCond}
        `);
        total = (countResult.rows[0] as any)?.count || 0;
        const result = await db.execute(sql`
          SELECT co."id", co."change_order_number", co."description", co."status"::text,
                 co."amount", co."created_at",
                 p."name" as project_name, p."code" as project_code
          FROM "change_orders" co
          JOIN "projects" p ON co."project_id" = p."id"
          WHERE true ${orgCond} ${statusCond}
          ORDER BY ${sql.raw(`co."${safeSortBy}"`)} ${orderDir} NULLS LAST
          LIMIT ${limit}
        `);
        items = (result.rows as any[]).map(r => ({
          id: r.id,
          title: `CO-${r.change_order_number}`,
          subtitle: `${r.project_name} — ${(r.description || "").substring(0, 60)}`,
          status: r.status,
          date: r.created_at,
          amount: r.amount ? parseFloat(r.amount) : null,
        }));
        break;
      }
    }

    res.json({ items, entity, total });
  } catch (error) {
    next(error);
  }
});

// ====================
// Dashboard Alerts Widget
// ====================

interface Alert {
  id: string;
  type: "INSURANCE_EXPIRING" | "OVER_BUDGET" | "UNAPPROVED_TIME" | "LATE_SUB_PAYMENT" | "LOW_MARGIN";
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
  entityId?: string;
  link?: string;
}

router.get("/api/dashboard/alerts", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.json({ alerts: [], counts: { critical: 0, warning: 0, info: 0 } });
    }

    const alertsResult = await orgScopedCache(orgId, "dashboard:alerts", DASHBOARD_CACHE_TTL, async () => {
    const alerts: Alert[] = [];
    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // 1. Insurance Expiring — organization documents
    try {
      const orgDocCond = shouldFilter && orgId ? sql`AND od."organization_id" = ${orgId}` : sql``;
      const docResult = await db.execute(sql`
        SELECT od."id", od."name", od."type"::text, od."expires_at", od."organization_id",
               o."name" as org_name
        FROM "organization_documents" od
        JOIN "organizations" o ON od."organization_id" = o."id"
        WHERE od."is_active" = true
          AND od."expires_at" IS NOT NULL
          AND od."expires_at" <= ${thirtyDaysFromNow.toISOString()}::date
          ${orgDocCond}
        ORDER BY od."expires_at" ASC
        LIMIT 20
      `);
      for (const row of docResult.rows as any[]) {
        const expiresAt = new Date(row.expires_at);
        const isExpired = expiresAt <= now;
        const docType = (row.type || "").replace(/_/g, " ").replace(/INSURANCE CERT /i, "").toLowerCase();
        alerts.push({
          id: `ins-doc-${row.id}`,
          type: "INSURANCE_EXPIRING",
          severity: isExpired ? "critical" : "warning",
          title: isExpired ? "Insurance Expired" : "Insurance Expiring Soon",
          description: `${row.name || docType} for ${row.org_name} ${isExpired ? "expired" : "expires"} ${expiresAt.toLocaleDateString()}`,
          entityId: row.organization_id,
        });
      }

      // CRM organisations insurance
      const crmCond = shouldFilter && orgId ? sql`AND co."organization_id" = ${orgId}` : sql``;
      const crmResult = await db.execute(sql`
        SELECT co."id", co."name" as company_name,
               co."insurance_expiration", co."wc_insurance_expiration"
        FROM "crm_organisations" co
        WHERE (
          (co."insurance_expiration" IS NOT NULL AND co."insurance_expiration" <= ${thirtyDaysFromNow.toISOString()}::timestamp)
          OR (co."wc_insurance_expiration" IS NOT NULL AND co."wc_insurance_expiration" <= ${thirtyDaysFromNow.toISOString()}::timestamp)
        )
        ${crmCond}
        LIMIT 20
      `);
      for (const row of crmResult.rows as any[]) {
        if (row.insurance_expiration) {
          const exp = new Date(row.insurance_expiration);
          if (exp <= thirtyDaysFromNow) {
            alerts.push({
              id: `ins-crm-gl-${row.id}`,
              type: "INSURANCE_EXPIRING",
              severity: exp <= now ? "critical" : "warning",
              title: exp <= now ? "Vendor Insurance Expired" : "Vendor Insurance Expiring",
              description: `General liability for ${row.company_name || "vendor"} ${exp <= now ? "expired" : "expires"} ${exp.toLocaleDateString()}`,
              entityId: row.id,
            });
          }
        }
        if (row.wc_insurance_expiration) {
          const exp = new Date(row.wc_insurance_expiration);
          if (exp <= thirtyDaysFromNow) {
            alerts.push({
              id: `ins-crm-wc-${row.id}`,
              type: "INSURANCE_EXPIRING",
              severity: exp <= now ? "critical" : "warning",
              title: exp <= now ? "Workers Comp Expired" : "Workers Comp Expiring",
              description: `Workers comp for ${row.company_name || "vendor"} ${exp <= now ? "expired" : "expires"} ${exp.toLocaleDateString()}`,
              entityId: row.id,
            });
          }
        }
      }
    } catch (e) {
      logError("Alerts: insurance check error:", {}, e instanceof Error ? e : new Error(String(e)));
    }

    // 2. Over Budget Projects
    try {
      const projOrgCond = shouldFilter && orgId ? sql`AND p."gc_organization_id" = ${orgId}` : sql``;
      const budgetResult = await db.execute(sql`
        SELECT
          p."id", p."name", p."code",
          COALESCE(p."contract_amount", p."budget", 0)::numeric as base_budget,
          COALESCE((
            SELECT SUM(co2."amount"::numeric)
            FROM "change_orders" co2
            WHERE co2."project_id" = p."id" AND co2."status"::text = 'APPROVED'
          ), 0) as approved_cos,
          COALESCE((
            SELECT SUM(
              te."hours_regular"::numeric * COALESCE(u."cost_rate_regular"::numeric, 50)
              + te."hours_overtime"::numeric * COALESCE(u."cost_rate_overtime"::numeric, 75)
            )
            FROM "time_entries" te
            JOIN "users" u ON te."user_id" = u."id"
            WHERE te."project_id" = p."id"
          ), 0) as labor_cost,
          COALESCE((
            SELECT SUM(pi."quantity"::numeric * pi."unit_cost"::numeric)
            FROM "procurement_items" pi
            WHERE pi."project_id" = p."id" AND pi."status"::text != 'CANCELLED'
          ), 0) as material_cost
        FROM "projects" p
        WHERE p."status"::text = 'ACTIVE'
          ${projOrgCond}
        LIMIT 50
      `);
      for (const row of budgetResult.rows as any[]) {
        const baseBudget = parseFloat(row.base_budget) || 0;
        if (baseBudget <= 0) continue;
        const adjustedBudget = baseBudget + (parseFloat(row.approved_cos) || 0);
        const actualCost = (parseFloat(row.labor_cost) || 0) + (parseFloat(row.material_cost) || 0);
        const variance = adjustedBudget - actualCost;
        const variancePct = (variance / adjustedBudget) * 100;

        if (variancePct < 0) {
          alerts.push({
            id: `budget-${row.id}`,
            type: "OVER_BUDGET",
            severity: "critical",
            title: "Project Over Budget",
            description: `${row.name} is $${Math.abs(variance).toLocaleString(undefined, { maximumFractionDigits: 0 })} over budget (${Math.abs(variancePct).toFixed(1)}%)`,
            entityId: row.id,
            link: `/projects/${row.code}`,
          });
        } else if (variancePct < 10) {
          alerts.push({
            id: `budget-${row.id}`,
            type: "OVER_BUDGET",
            severity: "warning",
            title: "Budget Nearly Exhausted",
            description: `${row.name} has only ${variancePct.toFixed(1)}% budget remaining ($${variance.toLocaleString(undefined, { maximumFractionDigits: 0 })} left)`,
            entityId: row.id,
            link: `/projects/${row.code}`,
          });
        }
      }
    } catch (e) {
      logError("Alerts: budget check error:", {}, e instanceof Error ? e : new Error(String(e)));
    }

    // 3. Unapproved Time Entries
    try {
      const teOrgCond = shouldFilter && orgId ? sql`AND p."gc_organization_id" = ${orgId}` : sql``;
      const criticalTimeResult = await db.execute(sql`
        SELECT COUNT(*)::int as count
        FROM "time_entries" te
        JOIN "projects" p ON te."project_id" = p."id"
        WHERE te."approval_status"::text = 'PENDING'
          AND te."created_at" < ${sevenDaysAgo.toISOString()}::timestamp
          ${teOrgCond}
      `);
      const criticalCount = (criticalTimeResult.rows[0] as any)?.count || 0;

      const warningTimeResult = await db.execute(sql`
        SELECT COUNT(*)::int as count
        FROM "time_entries" te
        JOIN "projects" p ON te."project_id" = p."id"
        WHERE te."approval_status"::text = 'PENDING'
          AND te."created_at" >= ${sevenDaysAgo.toISOString()}::timestamp
          AND te."created_at" < ${fortyEightHoursAgo.toISOString()}::timestamp
          ${teOrgCond}
      `);
      const warningCount = (warningTimeResult.rows[0] as any)?.count || 0;

      if (criticalCount > 0) {
        alerts.push({
          id: "time-critical",
          type: "UNAPPROVED_TIME",
          severity: "critical",
          title: "Time Entries Overdue for Approval",
          description: `${criticalCount} time ${criticalCount === 1 ? "entry" : "entries"} pending approval for over 7 days`,
        });
      }
      if (warningCount > 0) {
        alerts.push({
          id: "time-warning",
          type: "UNAPPROVED_TIME",
          severity: "warning",
          title: "Unapproved Time Entries",
          description: `${warningCount} time ${warningCount === 1 ? "entry" : "entries"} pending approval for over 48 hours`,
        });
      }
    } catch (e) {
      logError("Alerts: time entry check error:", {}, e instanceof Error ? e : new Error(String(e)));
    }

    // 4. Late Subcontractor Payments
    try {
      const subOrgCond = shouldFilter && orgId ? sql`AND sp."organization_id" = ${orgId}` : sql``;
      const latePayResult = await db.execute(sql`
        SELECT sp."id", sp."amount", sp."invoice_number",
               sc."contract_number",
               co."name" as sub_name
        FROM "subcontractor_payments" sp
        JOIN "subcontractor_contracts" sc ON sp."contract_id" = sc."id"
        LEFT JOIN "crm_organisations" co ON sc."subcontractor_id" = co."id"
        WHERE sp."status" = 'APPROVED'
          AND sp."paid_at" IS NULL
          AND sp."approved_at" < ${sevenDaysAgo.toISOString()}::timestamp
          ${subOrgCond}
        LIMIT 20
      `);
      for (const row of latePayResult.rows as any[]) {
        alerts.push({
          id: `subpay-${row.id}`,
          type: "LATE_SUB_PAYMENT",
          severity: "critical",
          title: "Late Subcontractor Payment",
          description: `$${parseFloat(row.amount).toLocaleString(undefined, { maximumFractionDigits: 0 })} owed to ${row.sub_name || row.contract_number} (approved but unpaid 7+ days)`,
          entityId: row.id,
        });
      }

      // Check billing schedule past due
      const billingOrgCond = shouldFilter && orgId ? sql`AND p."gc_organization_id" = ${orgId}` : sql``;
      const lateBillingResult = await db.execute(sql`
        SELECT sbs."id", sbs."description", sbs."scheduled_amount", sbs."scheduled_date",
               sc."contract_number",
               co."name" as sub_name
        FROM "subcontractor_billing_schedule" sbs
        JOIN "subcontractor_contracts" sc ON sbs."contract_id" = sc."id"
        JOIN "projects" p ON sc."project_id" = p."id"
        LEFT JOIN "crm_organisations" co ON sc."subcontractor_id" = co."id"
        WHERE sbs."status" = 'PENDING'
          AND sbs."scheduled_date" IS NOT NULL
          AND sbs."scheduled_date" < ${now.toISOString()}::timestamp
          ${billingOrgCond}
        LIMIT 20
      `);
      for (const row of lateBillingResult.rows as any[]) {
        const scheduledDate = new Date(row.scheduled_date);
        const daysLate = Math.floor((now.getTime() - scheduledDate.getTime()) / (1000 * 60 * 60 * 24));
        alerts.push({
          id: `subbill-${row.id}`,
          type: "LATE_SUB_PAYMENT",
          severity: daysLate > 14 ? "critical" : "warning",
          title: "Past Due Subcontractor Milestone",
          description: `$${parseFloat(row.scheduled_amount).toLocaleString(undefined, { maximumFractionDigits: 0 })} to ${row.sub_name || row.contract_number} is ${daysLate} days past due`,
          entityId: row.id,
        });
      }
    } catch (e) {
      logError("Alerts: subcontractor payment check error:", {}, e instanceof Error ? e : new Error(String(e)));
    }

    // 5. Low Gross Margin
    try {
      const marginOrgCond = shouldFilter && orgId ? sql`AND p."gc_organization_id" = ${orgId}` : sql``;
      const marginResult = await db.execute(sql`
        SELECT
          p."id", p."name", p."code",
          COALESCE(p."contract_amount", p."budget", 0)::numeric as base_budget,
          COALESCE((
            SELECT SUM(co2."amount"::numeric)
            FROM "change_orders" co2
            WHERE co2."project_id" = p."id" AND co2."status"::text = 'APPROVED'
          ), 0) as approved_cos,
          COALESCE((
            SELECT SUM(
              te."hours_regular"::numeric * COALESCE(u."cost_rate_regular"::numeric, 50)
              + te."hours_overtime"::numeric * COALESCE(u."cost_rate_overtime"::numeric, 75)
            )
            FROM "time_entries" te
            JOIN "users" u ON te."user_id" = u."id"
            WHERE te."project_id" = p."id"
          ), 0) as labor_cost,
          COALESCE((
            SELECT SUM(pi."quantity"::numeric * pi."unit_cost"::numeric)
            FROM "procurement_items" pi
            WHERE pi."project_id" = p."id" AND pi."status"::text != 'CANCELLED'
          ), 0) as material_cost
        FROM "projects" p
        WHERE p."status"::text = 'ACTIVE'
          ${marginOrgCond}
        LIMIT 50
      `);
      for (const row of marginResult.rows as any[]) {
        const baseBudget = parseFloat(row.base_budget) || 0;
        if (baseBudget <= 0) continue;
        const adjustedBudget = baseBudget + (parseFloat(row.approved_cos) || 0);
        const actualCost = (parseFloat(row.labor_cost) || 0) + (parseFloat(row.material_cost) || 0);
        const margin = adjustedBudget - actualCost;
        const marginPct = (margin / adjustedBudget) * 100;

        if (marginPct >= 0 && marginPct < 5) {
          alerts.push({
            id: `margin-${row.id}`,
            type: "LOW_MARGIN",
            severity: "critical",
            title: "Critically Low Margin",
            description: `${row.name} has only ${marginPct.toFixed(1)}% gross margin ($${margin.toLocaleString(undefined, { maximumFractionDigits: 0 })} remaining)`,
            entityId: row.id,
            link: `/projects/${row.code}`,
          });
        } else if (marginPct >= 5 && marginPct < 15) {
          alerts.push({
            id: `margin-${row.id}`,
            type: "LOW_MARGIN",
            severity: "warning",
            title: "Low Gross Margin",
            description: `${row.name} margin is ${marginPct.toFixed(1)}% — below 15% threshold`,
            entityId: row.id,
            link: `/projects/${row.code}`,
          });
        }
      }
    } catch (e) {
      logError("Alerts: margin check error:", {}, e instanceof Error ? e : new Error(String(e)));
    }

    // Sort: critical first, then warning, then info
    const severityOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 };
    alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    const counts = {
      critical: alerts.filter(a => a.severity === "critical").length,
      warning: alerts.filter(a => a.severity === "warning").length,
      info: alerts.filter(a => a.severity === "info").length,
    };

    return { alerts, counts };
    });

    res.json(alertsResult);
  } catch (error) {
    next(error);
  }
});

// ====================
// Workforce Snapshot Widget
// ====================

router.get("/api/dashboard/workforce-snapshot", requireAuth, requireRoleOrFeature(["ADMIN", "MANAGER"], "canManagePayroll"), async (req: AuthRequest, res, next) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.json({ activeWorkers: 0, totalWorkers: 0, overtimePercent: 0, laborCostToday: 0, absentWorkers: 0 });
    }

    const wfResult = await orgScopedCache(orgId, "dashboard:workforce-snapshot", DASHBOARD_CACHE_TTL, async () => {
    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];

    const orgCond = shouldFilter && orgId ? sql`AND u."organization_id" = ${orgId}` : sql``;

    // Total field workers in the org (non-admin roles that typically log time)
    const totalResult = await db.execute(sql`
      SELECT COUNT(DISTINCT u."id")::int as count
      FROM "users" u
      WHERE u."is_active" = true
        AND u."role"::text IN ('FIELD_WORKER', 'SUPERINTENDENT', 'MANAGER', 'HUSTLER')
        ${orgCond}
    `);
    const totalWorkers = (totalResult.rows[0] as any)?.count || 0;

    // Active workers today: distinct users with time entries dated today OR open clock shifts
    // Scope consistently by user.organization_id to match totalWorkers definition
    const activeResult = await db.execute(sql`
      SELECT COUNT(DISTINCT worker_id)::int as count FROM (
        SELECT te."user_id" as worker_id
        FROM "time_entries" te
        JOIN "users" u ON te."user_id" = u."id"
        WHERE te."date"::date = ${todayStr}::date
          ${orgCond}
        UNION
        SELECT tcs."user_id" as worker_id
        FROM "time_clock_shifts" tcs
        JOIN "users" u ON tcs."user_id" = u."id"
        WHERE (tcs."clock_in"::date = ${todayStr}::date OR tcs."clock_out" IS NULL)
          ${orgCond}
      ) active_workers
    `);
    const activeWorkers = (activeResult.rows[0] as any)?.count || 0;

    // Overtime % and labor cost from today's time entries (scoped by user org)
    const hoursResult = await db.execute(sql`
      SELECT
        COALESCE(SUM(te."hours_regular"::numeric), 0) as total_regular,
        COALESCE(SUM(te."hours_overtime"::numeric), 0) as total_overtime,
        COALESCE(SUM(
          te."hours_regular"::numeric * COALESCE(u."cost_rate_regular"::numeric, 50)
          + te."hours_overtime"::numeric * COALESCE(u."cost_rate_overtime"::numeric, 75)
        ), 0) as labor_cost
      FROM "time_entries" te
      JOIN "users" u ON te."user_id" = u."id"
      WHERE te."date"::date = ${todayStr}::date
        ${orgCond}
    `);
    const totalRegular = parseFloat((hoursResult.rows[0] as any)?.total_regular) || 0;
    const totalOvertime = parseFloat((hoursResult.rows[0] as any)?.total_overtime) || 0;
    const laborCostToday = parseFloat((hoursResult.rows[0] as any)?.labor_cost) || 0;
    const totalHours = totalRegular + totalOvertime;
    const overtimePercent = totalHours > 0 ? (totalOvertime / totalHours) * 100 : 0;

    const absentWorkers = Math.max(0, totalWorkers - activeWorkers);

    return {
      activeWorkers,
      totalWorkers,
      overtimePercent: Math.round(overtimePercent * 10) / 10,
      laborCostToday: Math.round(laborCostToday * 100) / 100,
      absentWorkers,
    };
    });

    res.json(wfResult);
  } catch (error) {
    next(error);
  }
});

// ====================
// Cash Position Widget
// ====================

router.get("/api/dashboard/cash-position", requireAuth, requireRoleOrFeature(["ADMIN", "MANAGER"], "canViewFinancials"), async (req: AuthRequest, res, next) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.json({ accountsReceivable: 0, accountsPayable: 0, payrollLiability: 0, netCashFlow: 0 });
    }

    const cpResult = await orgScopedCache(orgId, "dashboard:cash-position", DASHBOARD_CACHE_TTL, async () => {
    const orgCond = shouldFilter && orgId ? sql`AND i."organization_id" = ${orgId}` : sql``;
    const projOrgCond = shouldFilter && orgId ? sql`AND p."gc_organization_id" = ${orgId}` : sql``;
    const payOrgCond = shouldFilter && orgId ? sql`AND sp."organization_id" = ${orgId}` : sql``;
    const prOrgCond = shouldFilter && orgId ? sql`AND pr."organization_id" = ${orgId}` : sql``;

    // 1. Accounts Receivable: outstanding T&M invoices (SENT but not PAID/VOID)
    let accountsReceivable = 0;
    try {
      const arResult = await db.execute(sql`
        SELECT COALESCE(SUM(i."total"::numeric), 0) as total
        FROM "tm_invoices" i
        WHERE i."status"::text = 'SENT'
          ${orgCond}
      `);
      accountsReceivable = parseFloat((arResult.rows[0] as any)?.total) || 0;
    } catch (e) {
      logError("Cash position: AR error:", {}, e instanceof Error ? e : new Error(String(e)));
    }

    // 2. Accounts Payable: unpaid subcontractor payments + committed procurement costs
    let accountsPayable = 0;
    try {
      const subPayResult = await db.execute(sql`
        SELECT COALESCE(SUM(sp."amount"::numeric), 0) as total
        FROM "subcontractor_payments" sp
        WHERE sp."status" IN ('PENDING', 'APPROVED')
          ${payOrgCond}
      `);
      accountsPayable += parseFloat((subPayResult.rows[0] as any)?.total) || 0;

      const procResult = await db.execute(sql`
        SELECT COALESCE(SUM(pi."quantity"::numeric * pi."unit_cost"::numeric), 0) as total
        FROM "procurement_items" pi
        JOIN "projects" p ON pi."project_id" = p."id"
        WHERE pi."status"::text IN ('ORDERED', 'DELIVERED')
          ${projOrgCond}
      `);
      accountsPayable += parseFloat((procResult.rows[0] as any)?.total) || 0;
    } catch (e) {
      logError("Cash position: AP error:", {}, e instanceof Error ? e : new Error(String(e)));
    }

    // 3. Payroll Liability: unpaid pay runs
    let payrollLiability = 0;
    try {
      const payrollResult = await db.execute(sql`
        SELECT COALESCE(SUM(pr."total_labor_cost"::numeric), 0) as total
        FROM "pay_runs" pr
        WHERE pr."status"::text IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PROCESSING')
          ${prOrgCond}
      `);
      payrollLiability = parseFloat((payrollResult.rows[0] as any)?.total) || 0;
    } catch (e) {
      logError("Cash position: payroll error:", {}, e instanceof Error ? e : new Error(String(e)));
    }

    const netCashFlow = accountsReceivable - accountsPayable - payrollLiability;

    return {
      accountsReceivable: Math.round(accountsReceivable * 100) / 100,
      accountsPayable: Math.round(accountsPayable * 100) / 100,
      payrollLiability: Math.round(payrollLiability * 100) / 100,
      netCashFlow: Math.round(netCashFlow * 100) / 100,
    };
    });

    res.json(cpResult);
  } catch (error) {
    next(error);
  }
});

// ====================
// SOV Progress Widget
// ====================

router.get("/api/dashboard/sov-progress", requireAuth, requireRoleOrFeature(["ADMIN", "MANAGER"], "canViewFinancials"), async (req: AuthRequest, res, next) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.json({
        billedPercent: 0,
        completePercent: 0,
        totalScheduledValue: 0,
        totalCompletedToDate: 0,
        totalBilled: 0,
        laborCost: 0,
        sovValue: 0,
        laborToSovPercent: 0,
        retainageHeld: 0,
        avgRetainagePercent: 0,
        projects: [],
      });
    }

    const sovResult = await orgScopedCache(orgId, "dashboard:sov-progress", DASHBOARD_CACHE_TTL, async () => {
    const orgCond = shouldFilter && orgId ? sql`AND s."organization_id" = ${orgId}` : sql``;

    // 1. Aggregate SOV totals (% billed vs % complete)
    let billedPercent = 0;
    let completePercent = 0;
    let totalScheduledValue = 0;
    let totalCompletedToDate = 0;
    let totalBilled = 0;

    try {
      const sovTotals = await db.execute(sql`
        SELECT
          COALESCE(SUM(s."total_scheduled_value"::numeric), 0) as scheduled_value,
          COALESCE(SUM(s."total_completed_to_date"::numeric), 0) as completed_to_date,
          COALESCE(SUM(COALESCE(s."total_previously_completed"::numeric, 0) + COALESCE(s."total_this_period"::numeric, 0)), 0) as total_billed
        FROM "schedule_of_values" s
        WHERE s."status"::text NOT IN ('ARCHIVED', 'DRAFT')
          ${orgCond}
      `);
      const row = sovTotals.rows[0] as any;
      totalScheduledValue = parseFloat(row?.scheduled_value) || 0;
      totalCompletedToDate = parseFloat(row?.completed_to_date) || 0;
      totalBilled = parseFloat(row?.total_billed) || 0;

      if (totalScheduledValue > 0) {
        completePercent = Math.round((totalCompletedToDate / totalScheduledValue) * 10000) / 100;
        billedPercent = Math.round((totalBilled / totalScheduledValue) * 10000) / 100;
      }
    } catch (e) {
      logError("SOV progress: totals error:", {}, e instanceof Error ? e : new Error(String(e)));
    }

    // 2. Per-project breakdown (top 5 active projects with SOVs)
    let projectBreakdown: Array<{ name: string; billedPercent: number; completePercent: number }> = [];
    try {
      const projResult = await db.execute(sql`
        SELECT
          p."name" as project_name,
          COALESCE(SUM(s."total_scheduled_value"::numeric), 0) as scheduled_value,
          COALESCE(SUM(s."total_completed_to_date"::numeric), 0) as completed_to_date,
          COALESCE(SUM(COALESCE(s."total_previously_completed"::numeric, 0) + COALESCE(s."total_this_period"::numeric, 0)), 0) as total_billed
        FROM "schedule_of_values" s
        JOIN "projects" p ON s."project_id" = p."id"
        WHERE s."status"::text NOT IN ('ARCHIVED', 'DRAFT')
          ${orgCond}
        GROUP BY p."id", p."name"
        HAVING SUM(s."total_scheduled_value"::numeric) > 0
        ORDER BY SUM(s."total_scheduled_value"::numeric) DESC
        LIMIT 5
      `);
      projectBreakdown = (projResult.rows as any[]).map((r) => {
        const sv = parseFloat(r.scheduled_value) || 0;
        return {
          name: r.project_name || "Unnamed Project",
          billedPercent: sv > 0 ? Math.round((parseFloat(r.total_billed) / sv) * 10000) / 100 : 0,
          completePercent: sv > 0 ? Math.round((parseFloat(r.completed_to_date) / sv) * 10000) / 100 : 0,
        };
      });
    } catch (e) {
      logError("SOV progress: project breakdown error:", {}, e instanceof Error ? e : new Error(String(e)));
    }

    // 3. Labor cost vs SOV value
    let laborCost = 0;
    let sovValue = totalScheduledValue;
    let laborToSovPercent = 0;
    try {
      const laborResult = await db.execute(sql`
        SELECT COALESCE(SUM(
          (te."hours_regular"::numeric + te."hours_overtime"::numeric * 1.5) *
          COALESCE(u."cost_rate_regular"::numeric, 50)
        ), 0) as labor_cost
        FROM "time_entries" te
        JOIN "users" u ON te."user_id" = u."id"
        WHERE EXISTS (
          SELECT 1 FROM "schedule_of_values" s
          WHERE s."project_id" = te."project_id"
            AND s."status"::text NOT IN ('ARCHIVED', 'DRAFT')
            ${orgCond}
        )
      `);
      laborCost = parseFloat((laborResult.rows[0] as any)?.labor_cost) || 0;
      if (sovValue > 0) {
        laborToSovPercent = Math.round((laborCost / sovValue) * 10000) / 100;
      }
    } catch (e) {
      logError("SOV progress: labor cost error:", {}, e instanceof Error ? e : new Error(String(e)));
    }

    // 4. Retainage held
    let retainageHeld = 0;
    let avgRetainagePercent = 0;
    try {
      const retResult = await db.execute(sql`
        SELECT
          COALESCE(SUM(s."total_retainage"::numeric), 0) as retainage_held,
          CASE
            WHEN COUNT(*) > 0 THEN COALESCE(AVG(s."retainage_percent"::numeric), 0)
            ELSE 0
          END as avg_retainage_percent
        FROM "schedule_of_values" s
        WHERE s."status"::text NOT IN ('ARCHIVED', 'DRAFT')
          ${orgCond}
      `);
      const retRow = retResult.rows[0] as any;
      retainageHeld = parseFloat(retRow?.retainage_held) || 0;
      avgRetainagePercent = Math.round((parseFloat(retRow?.avg_retainage_percent) || 0) * 100) / 100;
    } catch (e) {
      logError("SOV progress: retainage error:", {}, e instanceof Error ? e : new Error(String(e)));
    }

    return {
      billedPercent,
      completePercent,
      totalScheduledValue: Math.round(totalScheduledValue * 100) / 100,
      totalCompletedToDate: Math.round(totalCompletedToDate * 100) / 100,
      totalBilled: Math.round(totalBilled * 100) / 100,
      laborCost: Math.round(laborCost * 100) / 100,
      sovValue: Math.round(sovValue * 100) / 100,
      laborToSovPercent,
      retainageHeld: Math.round(retainageHeld * 100) / 100,
      avgRetainagePercent,
      projects: projectBreakdown,
    };
    });

    res.json(sovResult);
  } catch (error) {
    next(error);
  }
});

// ====================
// Bid Pipeline Widget
// ====================

router.get("/api/dashboard/bid-pipeline", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.json({ activeBids: 0, pipelineValue: 0, winRate: 0, laborExposure: 0, awardedCount: 0, lostCount: 0 });
    }

    const bpResult = await orgScopedCache(orgId, "dashboard:bid-pipeline", DASHBOARD_CACHE_TTL, async () => {
    const orgCond = shouldFilter && orgId ? sql`AND b."gc_organization_id" = ${orgId}` : sql``;

    let activeBids = 0;
    let pipelineValue = 0;
    let winRate = 0;
    let laborExposure = 0;
    let awardedCount = 0;
    let lostCount = 0;

    try {
      const activeResult = await db.execute(sql`
        SELECT
          COUNT(*) as active_count,
          COALESCE(SUM(b."bid_amount"::numeric), 0) as pipeline_value
        FROM "bids" b
        WHERE b."status"::text = 'ACTIVE'
          ${orgCond}
      `);
      const row = activeResult.rows[0] as any;
      activeBids = parseInt(row?.active_count) || 0;
      pipelineValue = parseFloat(row?.pipeline_value) || 0;
    } catch (e) {
      logError("Bid pipeline: active bids error:", {}, e instanceof Error ? e : new Error(String(e)));
    }

    try {
      const rateResult = await db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE b."status"::text = 'AWARDED') as awarded,
          COUNT(*) FILTER (WHERE b."status"::text = 'LOST') as lost
        FROM "bids" b
        WHERE b."status"::text IN ('AWARDED', 'LOST')
          ${orgCond}
      `);
      const row = rateResult.rows[0] as any;
      awardedCount = parseInt(row?.awarded) || 0;
      lostCount = parseInt(row?.lost) || 0;
      const total = awardedCount + lostCount;
      if (total > 0) {
        winRate = Math.round((awardedCount / total) * 10000) / 100;
      }
    } catch (e) {
      logError("Bid pipeline: win rate error:", {}, e instanceof Error ? e : new Error(String(e)));
    }

    try {
      const laborResult = await db.execute(sql`
        SELECT COALESCE(SUM(eli."labor_cost"::numeric), 0) as labor_exposure
        FROM "estimate_line_items" eli
        JOIN "estimates" e ON eli."estimate_id" = e."id"
        JOIN "bids" b ON e."bid_id" = b."id"
        WHERE b."status"::text = 'ACTIVE'
          ${orgCond}
      `);
      laborExposure = parseFloat((laborResult.rows[0] as any)?.labor_exposure) || 0;
    } catch (e) {
      logError("Bid pipeline: labor exposure error:", {}, e instanceof Error ? e : new Error(String(e)));
    }

    return {
      activeBids,
      pipelineValue: Math.round(pipelineValue * 100) / 100,
      winRate,
      laborExposure: Math.round(laborExposure * 100) / 100,
      awardedCount,
      lostCount,
    };
    });

    res.json(bpResult);
  } catch (error) {
    next(error);
  }
});

// ============================
// Cost Code Breakdown Widget
// ============================

router.get("/api/dashboard/cost-code-breakdown", requireAuth, requireRoleOrFeature(["ADMIN", "MANAGER"], "canViewFinancials"), async (req: AuthRequest, res, next) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.json({ items: [], totalLaborCost: 0, totalBudgeted: 0, totalActual: 0 });
    }

    const mode = (req.query.mode as string) || "labor";
    const projectId = req.query.projectId as string | undefined;
    const groupByDivision = req.query.groupByDivision === "true";

    const orgCond = shouldFilter && orgId ? sql`AND p."gc_organization_id" = ${orgId}` : sql``;
    const projectCond = projectId ? sql`AND te."project_id" = ${projectId}` : sql``;

    if (mode === "budget_vs_actual") {
      let items: Array<{ costCode: string; budgeted: number; actual: number }> = [];
      let totalBudgeted = 0;
      let totalActual = 0;

      try {
        const budgetProjectCond = projectId
          ? (shouldFilter && orgId
            ? sql`AND e."project_id" = ${projectId} AND EXISTS (SELECT 1 FROM "projects" pp WHERE pp."id" = ${projectId} AND pp."gc_organization_id" = ${orgId})`
            : sql`AND e."project_id" = ${projectId}`)
          : sql``;
        const budgetOrgCond = (!projectId && shouldFilter && orgId)
          ? sql`AND (
              (e."project_id" IS NOT NULL AND EXISTS (SELECT 1 FROM "projects" pp WHERE pp."id" = e."project_id" AND pp."gc_organization_id" = ${orgId}))
              OR (e."bid_id" IS NOT NULL AND EXISTS (SELECT 1 FROM "bids" bb WHERE bb."id" = e."bid_id" AND bb."gc_organization_id" = ${orgId}))
            )`
          : sql``;

        const budgetGroupExpr = groupByDivision
          ? sql`COALESCE('Division ' || SPLIT_PART(SPLIT_PART(COALESCE(NULLIF(TRIM(eli."work_type_code"), ''), NULLIF(TRIM(eli."category"::text), ''), ''), ' - ', 1), '-', 1), 'Unassigned')`
          : sql`COALESCE(UPPER(TRIM(SPLIT_PART(COALESCE(NULLIF(TRIM(eli."work_type_code"), ''), NULLIF(TRIM(eli."category"::text), '')), ' - ', 1))), 'Unassigned')`;

        const budgetResult = await db.execute(sql`
          SELECT
            ${budgetGroupExpr} as cost_code,
            SUM(eli."labor_cost"::numeric) as budgeted
          FROM "estimate_line_items" eli
          JOIN "estimates" e ON eli."estimate_id" = e."id"
          WHERE eli."labor_cost"::numeric > 0
            ${budgetProjectCond}
            ${budgetOrgCond}
          GROUP BY ${budgetGroupExpr}
          ORDER BY SUM(eli."labor_cost"::numeric) DESC
          LIMIT 10
        `);

        const budgetMap = new Map<string, number>();
        for (const row of budgetResult.rows as any[]) {
          budgetMap.set(row.cost_code, parseFloat(row.budgeted) || 0);
          totalBudgeted += parseFloat(row.budgeted) || 0;
        }

        const actualGroupExpr = groupByDivision
          ? sql`COALESCE('Division ' || SPLIT_PART(SPLIT_PART(COALESCE(te."cost_code", ''), ' - ', 1), '-', 1), 'Unassigned')`
          : sql`COALESCE(UPPER(NULLIF(TRIM(SPLIT_PART(te."cost_code", ' - ', 1)), '')), 'Unassigned')`;

        const actualResult = await db.execute(sql`
          SELECT
            ${actualGroupExpr} as cost_code,
            SUM(
              (te."hours_regular"::numeric + te."hours_overtime"::numeric * 1.5) *
              COALESCE(u."cost_rate_regular"::numeric, 50)
            ) as actual
          FROM "time_entries" te
          JOIN "users" u ON te."user_id" = u."id"
          JOIN "projects" p ON te."project_id" = p."id"
          WHERE 1=1
            ${orgCond}
            ${projectCond}
          GROUP BY ${actualGroupExpr}
          ORDER BY SUM(
            (te."hours_regular"::numeric + te."hours_overtime"::numeric * 1.5) *
            COALESCE(u."cost_rate_regular"::numeric, 50)
          ) DESC
          LIMIT 10
        `);

        const allCodes = new Set<string>();
        const actualMap = new Map<string, number>();
        for (const row of actualResult.rows as any[]) {
          actualMap.set(row.cost_code, parseFloat(row.actual) || 0);
          totalActual += parseFloat(row.actual) || 0;
          allCodes.add(row.cost_code);
        }
        for (const code of budgetMap.keys()) {
          allCodes.add(code);
        }

        items = Array.from(allCodes).map(code => ({
          costCode: code,
          budgeted: Math.round((budgetMap.get(code) || 0) * 100) / 100,
          actual: Math.round((actualMap.get(code) || 0) * 100) / 100,
        })).sort((a, b) => Math.max(b.budgeted, b.actual) - Math.max(a.budgeted, a.actual)).slice(0, 10);
      } catch (e) {
        logError("Cost code breakdown: budget vs actual error:", {}, e instanceof Error ? e : new Error(String(e)));
      }

      return res.json({
        items,
        totalBudgeted: Math.round(totalBudgeted * 100) / 100,
        totalActual: Math.round(totalActual * 100) / 100,
        totalLaborCost: 0,
      });
    }

    // Default: labor mode
    let items: Array<{ costCode: string; laborCost: number; hours: number }> = [];
    let totalLaborCost = 0;

    try {
      const groupExpr = groupByDivision
        ? sql`COALESCE('Division ' || SPLIT_PART(SPLIT_PART(COALESCE(te."cost_code", ''), ' - ', 1), '-', 1), 'Unassigned')`
        : sql`COALESCE(te."cost_code", 'Unassigned')`;

      const result = await db.execute(sql`
        SELECT
          ${groupExpr} as cost_code,
          SUM(
            (te."hours_regular"::numeric + te."hours_overtime"::numeric * 1.5) *
            COALESCE(u."cost_rate_regular"::numeric, 50)
          ) as labor_cost,
          SUM(te."hours_regular"::numeric + te."hours_overtime"::numeric) as total_hours
        FROM "time_entries" te
        JOIN "users" u ON te."user_id" = u."id"
        JOIN "projects" p ON te."project_id" = p."id"
        WHERE 1=1
          ${orgCond}
          ${projectCond}
        GROUP BY ${groupExpr}
        ORDER BY SUM(
          (te."hours_regular"::numeric + te."hours_overtime"::numeric * 1.5) *
          COALESCE(u."cost_rate_regular"::numeric, 50)
        ) DESC
      `);

      const rows = result.rows as any[];
      const top10 = rows.slice(0, 10);
      const rest = rows.slice(10);

      for (const row of top10) {
        const cost = parseFloat(row.labor_cost) || 0;
        items.push({
          costCode: row.cost_code,
          laborCost: Math.round(cost * 100) / 100,
          hours: Math.round((parseFloat(row.total_hours) || 0) * 100) / 100,
        });
        totalLaborCost += cost;
      }

      if (rest.length > 0) {
        let otherCost = 0;
        let otherHours = 0;
        for (const row of rest) {
          otherCost += parseFloat(row.labor_cost) || 0;
          otherHours += parseFloat(row.total_hours) || 0;
        }
        items.push({
          costCode: "Other",
          laborCost: Math.round(otherCost * 100) / 100,
          hours: Math.round(otherHours * 100) / 100,
        });
        totalLaborCost += otherCost;
      }
    } catch (e) {
      logError("Cost code breakdown: labor error:", {}, e instanceof Error ? e : new Error(String(e)));
    }

    res.json({
      items,
      totalLaborCost: Math.round(totalLaborCost * 100) / 100,
      totalBudgeted: 0,
      totalActual: 0,
    });
  } catch (error) {
    next(error);
  }
});

// ============================
// Schedule Impact Widget
// ============================

router.get("/api/dashboard/schedule-impact", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.json({
        dailyAllocation: [],
        projectForecast: [],
        conflicts: [],
        summary: { totalAssignedNext7Days: 0, peakDay: null, peakWorkers: 0, conflictCount: 0 },
      });
    }

    const siResult = await orgScopedCache(orgId, "dashboard:schedule-impact", DASHBOARD_CACHE_TTL, async () => {
    const orgCond = shouldFilter && orgId ? sql`AND p."gc_organization_id" = ${orgId}` : sql``;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split("T")[0];
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + 6);
    const endStr = endDate.toISOString().split("T")[0];

    const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const next7Days: Array<{ date: string; dayLabel: string }> = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      next7Days.push({
        date: d.toISOString().split("T")[0],
        dayLabel: dayLabels[d.getDay()],
      });
    }

    // 1. Daily Allocation - workers assigned per day via crew_project_assignments
    let dailyAllocation: Array<{ date: string; dayLabel: string; assignedWorkers: number; projectCount: number }> = [];

    try {
      const dailyResult = await db.execute(sql`
        SELECT
          d.day::date as day_date,
          COUNT(DISTINCT cm."user_id") as worker_count,
          COUNT(DISTINCT cpa."project_id") as project_count
        FROM generate_series(${todayStr}::date, ${endStr}::date, '1 day'::interval) AS d(day)
        LEFT JOIN "crew_project_assignments" cpa
          ON (cpa."start_date"::date <= d.day::date AND (cpa."end_date"::date >= d.day::date OR cpa."end_date" IS NULL))
        LEFT JOIN "crew_members" cm ON cm."crew_id" = cpa."crew_id"
        LEFT JOIN "projects" p ON cpa."project_id" = p."id"
        WHERE 1=1 ${orgCond}
        GROUP BY d.day::date
        ORDER BY d.day::date
      `);

      const dailyMap = new Map<string, { workers: number; projects: number }>();
      for (const row of dailyResult.rows as any[]) {
        const dateKey = new Date(row.day_date).toISOString().split("T")[0];
        dailyMap.set(dateKey, {
          workers: parseInt(row.worker_count) || 0,
          projects: parseInt(row.project_count) || 0,
        });
      }

      dailyAllocation = next7Days.map(d => ({
        date: d.date,
        dayLabel: d.dayLabel,
        assignedWorkers: dailyMap.get(d.date)?.workers || 0,
        projectCount: dailyMap.get(d.date)?.projects || 0,
      }));
    } catch (e) {
      logError("Schedule impact: daily allocation error:", {}, e instanceof Error ? e : new Error(String(e)));
      dailyAllocation = next7Days.map(d => ({ date: d.date, dayLabel: d.dayLabel, assignedWorkers: 0, projectCount: 0 }));
    }

    // 2. Project Forecast - top 5 projects by worker count
    let projectForecast: Array<{ projectId: string; projectName: string; crewCount: number; workerCount: number; startDate: string | null; endDate: string | null }> = [];

    try {
      const forecastResult = await db.execute(sql`
        SELECT
          p."id" as project_id,
          p."name" as project_name,
          COUNT(DISTINCT cpa."crew_id") as crew_count,
          COUNT(DISTINCT cm."user_id") as worker_count,
          MIN(cpa."start_date")::text as start_date,
          MAX(cpa."end_date")::text as end_date
        FROM "crew_project_assignments" cpa
        JOIN "projects" p ON cpa."project_id" = p."id"
        LEFT JOIN "crew_members" cm ON cm."crew_id" = cpa."crew_id"
        WHERE (cpa."start_date"::date <= ${endStr}::date OR cpa."start_date" IS NULL)
          AND (cpa."end_date"::date >= ${todayStr}::date OR cpa."end_date" IS NULL)
          ${orgCond}
        GROUP BY p."id", p."name"
        ORDER BY COUNT(DISTINCT cm."user_id") DESC
        LIMIT 5
      `);

      projectForecast = (forecastResult.rows as any[]).map(row => ({
        projectId: row.project_id,
        projectName: row.project_name,
        crewCount: parseInt(row.crew_count) || 0,
        workerCount: parseInt(row.worker_count) || 0,
        startDate: row.start_date ? row.start_date.split("T")[0] : null,
        endDate: row.end_date ? row.end_date.split("T")[0] : null,
      }));
    } catch (e) {
      logError("Schedule impact: project forecast error:", {}, e instanceof Error ? e : new Error(String(e)));
    }

    // 3. Conflicts - workers assigned to multiple projects on same day
    let conflicts: Array<{ userId: string; userName: string; date: string; projects: string[] }> = [];
    let conflictCount = 0;

    try {
      const conflictCountResult = await db.execute(sql`
        SELECT COUNT(*) as total FROM (
          SELECT cm."user_id", d.day::date
          FROM generate_series(${todayStr}::date, ${endStr}::date, '1 day'::interval) AS d(day)
          JOIN "crew_project_assignments" cpa
            ON (cpa."start_date"::date <= d.day::date AND (cpa."end_date"::date >= d.day::date OR cpa."end_date" IS NULL))
          JOIN "crew_members" cm ON cm."crew_id" = cpa."crew_id"
          JOIN "projects" p ON cpa."project_id" = p."id"
          WHERE 1=1 ${orgCond}
          GROUP BY cm."user_id", d.day::date
          HAVING COUNT(DISTINCT cpa."project_id") > 1
        ) conflicts_sub
      `);
      conflictCount = parseInt((conflictCountResult.rows as any[])[0]?.total) || 0;

      const conflictResult = await db.execute(sql`
        SELECT
          cm."user_id",
          (u."first_name" || ' ' || u."last_name") as user_name,
          d.day::date as conflict_date,
          array_agg(DISTINCT p."name") as project_names
        FROM generate_series(${todayStr}::date, ${endStr}::date, '1 day'::interval) AS d(day)
        JOIN "crew_project_assignments" cpa
          ON (cpa."start_date"::date <= d.day::date AND (cpa."end_date"::date >= d.day::date OR cpa."end_date" IS NULL))
        JOIN "crew_members" cm ON cm."crew_id" = cpa."crew_id"
        JOIN "projects" p ON cpa."project_id" = p."id"
        JOIN "users" u ON cm."user_id" = u."id"
        WHERE 1=1 ${orgCond}
        GROUP BY cm."user_id", u."first_name", u."last_name", d.day::date
        HAVING COUNT(DISTINCT cpa."project_id") > 1
        ORDER BY d.day::date, u."first_name", u."last_name"
        LIMIT 10
      `);

      conflicts = (conflictResult.rows as any[]).map(row => ({
        userId: row.user_id,
        userName: row.user_name || "Unknown",
        date: new Date(row.conflict_date).toISOString().split("T")[0],
        projects: row.project_names || [],
      }));
    } catch (e) {
      logError("Schedule impact: conflicts error:", {}, e instanceof Error ? e : new Error(String(e)));
    }

    // Unique workers across the 7-day window
    let totalUniqueWorkers = 0;
    try {
      const uniqueResult = await db.execute(sql`
        SELECT COUNT(DISTINCT cm."user_id")::int as total
        FROM "crew_project_assignments" cpa
        JOIN "crew_members" cm ON cm."crew_id" = cpa."crew_id"
        JOIN "projects" p ON cpa."project_id" = p."id"
        WHERE (cpa."start_date"::date <= ${endStr}::date OR cpa."start_date" IS NULL)
          AND (cpa."end_date"::date >= ${todayStr}::date OR cpa."end_date" IS NULL)
          ${orgCond}
      `);
      totalUniqueWorkers = parseInt((uniqueResult.rows as any[])[0]?.total) || 0;
    } catch (e) {
      logError("Schedule impact: unique workers error:", {}, e instanceof Error ? e : new Error(String(e)));
    }

    // Summary
    let peakDay: string | null = null;
    let peakWorkers = 0;

    for (const day of dailyAllocation) {
      if (day.assignedWorkers > peakWorkers) {
        peakWorkers = day.assignedWorkers;
        peakDay = day.dayLabel;
      }
    }

    return {
      dailyAllocation,
      projectForecast,
      conflicts,
      summary: {
        totalAssignedNext7Days: totalUniqueWorkers,
        peakDay,
        peakWorkers,
        conflictCount,
      },
    };
    });

    res.json(siResult);
  } catch (error) {
    next(error);
  }
});

// ====================
// Labor Utilization Widget
// ====================
router.get("/api/dashboard/labor-utilization", requireAuth, requireRoleOrFeature(["ADMIN", "MANAGER"], "canManagePayroll"), async (req: AuthRequest, res, next) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.json({ utilizedPercent: 0, workedHours: 0, availableHours: 0, billablePercent: 0, sparkline: [] });
    }

    const luResult = await orgScopedCache(orgId, "dashboard:labor-utilization", DASHBOARD_CACHE_TTL, async () => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const orgCond = shouldFilter && orgId ? sql`AND u."organization_id" = ${orgId}` : sql``;
    const projOrgCond = shouldFilter && orgId ? sql`AND p."gc_organization_id" = ${orgId}` : sql``;

    // Total active field workers
    const totalResult = await db.execute(sql`
      SELECT COUNT(*)::int as count
      FROM "users" u
      WHERE u."is_active" = true
        AND u."role" IN ('FIELD_WORKER', 'SUPERINTENDENT', 'ESTIMATOR')
        ${orgCond}
    `);
    const totalWorkers = (totalResult.rows[0] as any)?.count || 0;

    // Workers with time entries today (restricted to field-worker roles to match denominator)
    const activeResult = await db.execute(sql`
      SELECT COUNT(DISTINCT te."user_id")::int as count,
             COALESCE(SUM(te."hours_regular"::numeric + te."hours_overtime"::numeric), 0) as worked_hours
      FROM "time_entries" te
      JOIN "users" u ON te."user_id" = u."id"
      WHERE te."date" = ${todayStart.toISOString().split('T')[0]}::date
        AND u."role" IN ('FIELD_WORKER', 'SUPERINTENDENT', 'ESTIMATOR')
        AND u."is_active" = true
        ${orgCond}
    `);
    const activeWorkers = (activeResult.rows[0] as any)?.count || 0;
    const workedHours = parseFloat((activeResult.rows[0] as any)?.worked_hours || "0");

    // Worker-based utilization: workers with time entries today / total active field workers * 100
    const utilizedPercent = totalWorkers > 0 ? Math.round((activeWorkers / totalWorkers) * 100) : 0;

    // Billable hours (time on active projects)
    const billableResult = await db.execute(sql`
      SELECT COALESCE(SUM(te."hours_regular"::numeric + te."hours_overtime"::numeric), 0) as billable_hours
      FROM "time_entries" te
      JOIN "projects" p ON te."project_id" = p."id"
      WHERE te."date" = ${todayStart.toISOString().split('T')[0]}::date
        AND p."status" = 'ACTIVE'
        ${projOrgCond}
    `);
    const billableHours = parseFloat((billableResult.rows[0] as any)?.billable_hours || "0");
    const billablePercent = workedHours > 0 ? Math.round((billableHours / workedHours) * 100) : 0;

    // 7-day sparkline (worker-based: distinct workers per day / total workers)
    const sparkline: { date: string; utilizedPercent: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const dayDate = new Date(now);
      dayDate.setDate(now.getDate() - i);
      const dayStr = dayDate.toISOString().split('T')[0];
      const dayResult = await db.execute(sql`
        SELECT COUNT(DISTINCT te."user_id")::int as active_workers
        FROM "time_entries" te
        JOIN "users" u ON te."user_id" = u."id"
        WHERE te."date" = ${dayStr}::date
          AND u."role" IN ('FIELD_WORKER', 'SUPERINTENDENT', 'ESTIMATOR')
          AND u."is_active" = true
          ${orgCond}
      `);
      const dayActive = parseInt((dayResult.rows[0] as any)?.active_workers || "0");
      const dayPct = totalWorkers > 0 ? Math.round((dayActive / totalWorkers) * 100) : 0;
      sparkline.push({ date: dayStr, utilizedPercent: Math.min(dayPct, 100) });
    }

    const availableHours = totalWorkers * 8;
    return { utilizedPercent: Math.min(utilizedPercent, 100), workedHours, availableHours, billablePercent, activeWorkers, totalWorkers, sparkline };
    });

    res.json(luResult);
  } catch (error) {
    next(error);
  }
});

// ====================
// Safety Summary Widget
// ====================
router.get("/api/dashboard/safety-summary", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res, next) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.json({ overdueCount: 0, dueThisWeekCount: 0, completionRate: 0, overdueItems: [] });
    }

    const projectId = typeof req.query.projectId === "string" && req.query.projectId ? req.query.projectId : null;
    const safetyCacheKey = projectId ? `dashboard:safety-summary:${projectId}` : "dashboard:safety-summary";

    const ssResult = await orgScopedCache(orgId, safetyCacheKey, DASHBOARD_CACHE_TTL, async () => {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const endOfWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const orgCond = shouldFilter && orgId ? sql`AND sta."organization_id" = ${orgId}` : sql``;
    // Filter employees who have time entries on the selected project
    const projectCond = projectId ? sql`AND sta."employee_id" IN (SELECT DISTINCT te."user_id" FROM "time_entries" te WHERE te."project_id" = ${projectId})` : sql``;

    // Total assignments and completed
    const totalResult = await db.execute(sql`
      SELECT
        COUNT(*)::int as total,
        COUNT(CASE WHEN sta."completed_at" IS NOT NULL THEN 1 END)::int as completed,
        COUNT(CASE WHEN sta."completed_at" IS NULL AND sta."due_date" IS NOT NULL AND sta."due_date"::date < ${todayStr}::date THEN 1 END)::int as overdue,
        COUNT(CASE WHEN sta."completed_at" IS NULL AND sta."due_date" IS NOT NULL AND sta."due_date"::date >= ${todayStr}::date AND sta."due_date"::date <= ${endOfWeek}::date THEN 1 END)::int as due_this_week
      FROM "safety_training_assignments" sta
      WHERE 1=1 ${orgCond} ${projectCond}
    `);
    const row = (totalResult.rows[0] as any) || {};
    const total = row.total || 0;
    const completed = row.completed || 0;
    const overdueCount = row.overdue || 0;
    const dueThisWeekCount = row.due_this_week || 0;
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

    // Overdue items with employee name and training title
    const overdueResult = await db.execute(sql`
      SELECT
        sta."id",
        CONCAT(u."first_name", ' ', u."last_name") as employee_name,
        st."title" as training_title,
        sta."due_date",
        ${todayStr}::date - sta."due_date"::date as days_overdue
      FROM "safety_training_assignments" sta
      JOIN "users" u ON sta."employee_id" = u."id"
      JOIN "safety_trainings" st ON sta."training_id" = st."id"
      WHERE sta."completed_at" IS NULL
        AND sta."due_date" IS NOT NULL
        AND sta."due_date"::date < ${todayStr}::date
        ${orgCond} ${projectCond}
      ORDER BY sta."due_date" ASC
      LIMIT 20
    `);
    const overdueItems = (overdueResult.rows as any[]).map(r => ({
      id: r.id,
      employeeName: r.employee_name,
      trainingTitle: r.training_title,
      dueDate: r.due_date,
      daysOverdue: parseInt(r.days_overdue) || 0,
    }));

    return { overdueCount, dueThisWeekCount, completionRate, total, completed, overdueItems };
    });

    res.json(ssResult);
  } catch (error) {
    next(error);
  }
});

// ====================
// Change Orders Pending Widget
// ====================
router.get("/api/dashboard/change-orders-pending", requireAuth, requireRoleOrFeature(["ADMIN", "MANAGER"], "canViewFinancials"), async (req: AuthRequest, res, next) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.json({ count: 0, totalValue: 0, items: [] });
    }

    const projectId = typeof req.query.projectId === "string" && req.query.projectId ? req.query.projectId : null;
    const cacheKey = projectId ? `dashboard:change-orders-pending:${projectId}` : "dashboard:change-orders-pending";

    const coResult = await orgScopedCache(orgId, cacheKey, DASHBOARD_CACHE_TTL, async () => {
    const now = new Date();
    const orgCond = shouldFilter && orgId ? sql`AND p."gc_organization_id" = ${orgId}` : sql``;
    const projectCond = projectId ? sql`AND co."project_id" = ${projectId}` : sql``;

    const summaryResult = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE co."status"::text IN ('PCO', 'PRICING_REVIEW', 'SUBMITTED'))::int as count,
        COALESCE(SUM(co."amount"::numeric) FILTER (WHERE co."status"::text IN ('PCO', 'PRICING_REVIEW', 'SUBMITTED')), 0) as total_value,
        COUNT(*) FILTER (WHERE co."status"::text = 'PCO')::int as pco_count,
        COUNT(*) FILTER (WHERE co."status"::text = 'PRICING_REVIEW')::int as pricing_review_count,
        COUNT(*) FILTER (WHERE co."status"::text = 'SUBMITTED')::int as submitted_count,
        COUNT(*) FILTER (WHERE co."status"::text = 'APPROVED')::int as approved_count,
        COALESCE(SUM(co."amount"::numeric) FILTER (WHERE co."status"::text = 'APPROVED'), 0) as approved_value
      FROM "change_orders" co
      JOIN "projects" p ON co."project_id" = p."id"
      WHERE co."status"::text IN ('PCO', 'PRICING_REVIEW', 'SUBMITTED', 'APPROVED')
        ${orgCond}
        ${projectCond}
    `);
    const count = (summaryResult.rows[0] as any)?.count || 0;
    const totalValue = parseFloat((summaryResult.rows[0] as any)?.total_value || "0");
    const pcoCount = (summaryResult.rows[0] as any)?.pco_count || 0;
    const pricingReviewCount = (summaryResult.rows[0] as any)?.pricing_review_count || 0;
    const submittedCount = (summaryResult.rows[0] as any)?.submitted_count || 0;
    const approvedCount = (summaryResult.rows[0] as any)?.approved_count || 0;
    const approvedValue = parseFloat((summaryResult.rows[0] as any)?.approved_value || "0");

    const itemsResult = await db.execute(sql`
      SELECT
        co."id",
        co."change_order_number",
        co."description",
        co."amount",
        co."status",
        co."created_at",
        p."id" as project_id,
        p."name" as project_name,
        ${now.toISOString()}::timestamp - co."created_at" as age_interval
      FROM "change_orders" co
      JOIN "projects" p ON co."project_id" = p."id"
      WHERE co."status"::text IN ('PCO', 'PRICING_REVIEW', 'SUBMITTED')
        ${orgCond}
        ${projectCond}
      ORDER BY co."created_at" DESC
      LIMIT 20
    `);

    const items = (itemsResult.rows as any[]).map(r => ({
      id: r.id,
      coNumber: r.change_order_number,
      description: (r.description || "").substring(0, 60),
      amount: parseFloat(r.amount || "0"),
      status: r.status,
      projectName: r.project_name,
      projectId: r.project_id,
      daysPending: Math.floor((now.getTime() - new Date(r.created_at).getTime()) / (1000 * 60 * 60 * 24)),
    }));

    return { count, totalValue, items, pcoCount, pricingReviewCount, submittedCount, approvedCount, approvedValue };
    });

    res.json(coResult);
  } catch (error) {
    next(error);
  }
});

export default router;
