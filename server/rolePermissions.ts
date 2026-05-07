// Extracted from server/dashboardRoutes.ts to break a circular import:
//   server/auth.ts -> dashboardRoutes.ts -> rateLimiter.ts -> auth.ts
// The cycle caused a TDZ ReferenceError on `sensitiveLimiter` when the
// dedicated job worker (server/worker.ts) entered the graph through a
// path that loaded rateLimiter before dashboardRoutes finished
// evaluating. Keeping the permission helpers in a leaf module that
// imports nothing from the route layer avoids the cycle entirely.

export type FeaturePermissionKeys =
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
  | 'canUseAiEstimator' | 'canManageAiEstimator'
  | 'canAccessCompanySettings' | 'canManageUsers' | 'canAccessApprovals' | 'canAccessAuditLogs'
  | 'canAccessReports' | 'canAccessEnterpriseSettings' | 'canManageAISettings'
  | 'canViewProjectBudget' | 'canViewProjectEstimates' | 'canViewProjectProcurement'
  | 'canViewProjectReceipts' | 'canViewProjectTimeEntries' | 'canViewProjectSubcontractors'
  | 'canCreateChangeOrders' | 'canDeleteScopeItems' | 'canEditProjectHandoff'
  | 'canSubmitPeerRatings' | 'canViewPeerRatings'
  | 'canAccessTimeMaterial'
  | 'canViewDotLibrary' | 'canManageDotLibrary'
  | 'canViewDbeGoals' | 'canManageDbeGoals'
  | 'canViewHaulTickets' | 'canManageHaulTickets' | 'canApproveHaulTickets'
  | 'canViewInspectorReports' | 'canSubmitInspectorReports' | 'canManageInspectorReports' | 'canApproveInspectorReports'
  | 'canViewSwppp' | 'canManageSwppp'
  | 'canViewMaterialCertifications' | 'canManageMaterialCertifications' | 'canVerifyMaterialCertifications'
  | 'canViewSuretyBonds' | 'canManageSuretyBonds'
  | 'canViewComplianceDashboard'
  | 'canManageProjectTemplates'
  | 'canViewPortfolio';

export type PermissionSet = Record<FeaturePermissionKeys, boolean> & { projectScope: "ALL" | "ACTIVE_ONLY" };

export const ALL_FALSE: PermissionSet = {
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
  canUseAiEstimator: false, canManageAiEstimator: false,
  canAccessCompanySettings: false, canManageUsers: false, canAccessApprovals: false,
  canAccessAuditLogs: false, canAccessReports: false, canAccessEnterpriseSettings: false,
  canManageAISettings: false,
  canViewProjectBudget: false, canViewProjectEstimates: false, canViewProjectProcurement: false,
  canViewProjectReceipts: false, canViewProjectTimeEntries: false, canViewProjectSubcontractors: false,
  canCreateChangeOrders: false, canDeleteScopeItems: false, canEditProjectHandoff: false,
  canSubmitPeerRatings: false, canViewPeerRatings: false,
  canAccessTimeMaterial: false,
  canViewDotLibrary: false, canManageDotLibrary: false,
  canViewDbeGoals: false, canManageDbeGoals: false,
  canViewHaulTickets: false, canManageHaulTickets: false, canApproveHaulTickets: false,
  canViewInspectorReports: false, canSubmitInspectorReports: false,
  canManageInspectorReports: false, canApproveInspectorReports: false,
  canViewSwppp: false, canManageSwppp: false,
  canViewMaterialCertifications: false,
  canManageMaterialCertifications: false, canVerifyMaterialCertifications: false,
  canViewSuretyBonds: false, canManageSuretyBonds: false,
  canViewComplianceDashboard: false,
  canManageProjectTemplates: false,
  canViewPortfolio: false,
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
  canUseAiEstimator: true, canManageAiEstimator: true,
  canAccessCompanySettings: true, canManageUsers: true, canAccessApprovals: true,
  canAccessAuditLogs: true, canAccessReports: true, canAccessEnterpriseSettings: true,
  canManageAISettings: true,
  canViewProjectBudget: true, canViewProjectEstimates: true, canViewProjectProcurement: true,
  canViewProjectReceipts: true, canViewProjectTimeEntries: true, canViewProjectSubcontractors: true,
  canCreateChangeOrders: true, canDeleteScopeItems: true, canEditProjectHandoff: true,
  canSubmitPeerRatings: true, canViewPeerRatings: true,
  canAccessTimeMaterial: true,
  canViewDotLibrary: true, canManageDotLibrary: true,
  canViewDbeGoals: true, canManageDbeGoals: true,
  canViewHaulTickets: true, canManageHaulTickets: true, canApproveHaulTickets: true,
  canViewInspectorReports: true, canSubmitInspectorReports: true,
  canManageInspectorReports: true, canApproveInspectorReports: true,
  canViewSwppp: true, canManageSwppp: true,
  canViewMaterialCertifications: true,
  canManageMaterialCertifications: true, canVerifyMaterialCertifications: true,
  canViewSuretyBonds: true, canManageSuretyBonds: true,
  canViewComplianceDashboard: true,
  canManageProjectTemplates: true,
  canViewPortfolio: true,
};

export const ROLE_DEFAULT_PERMISSIONS: Record<string, PermissionSet> = {
  ADMIN: ALL_TRUE,
  SUPER_ADMIN: { ...ALL_TRUE },
  HUSTLER: {
    ...ALL_TRUE,
    canAccessEnterpriseSettings: false,
    canManageHiringSettings: false,
    canManageDotLibrary: false,
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
    canManageDotLibrary: false,
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
    canAccessTMDaily: true, canAccessTimeMaterial: true, canManageWorkforce: true, canManageSafety: true,
    canManageScheduling: true, canManageCrews: true, canManageLeave: true,
    canAccessKPIs: true, canLockDailyReports: true,
    canManageEquipment: true, canManageProcurement: true,
    canAccessCRM: true, canCreateCRMContacts: true,
    canAccessApprovals: true, canAccessReports: true,
    canViewProjectBudget: true, canViewProjectEstimates: true, canViewProjectProcurement: true,
    canViewProjectReceipts: true, canViewProjectTimeEntries: true, canViewProjectSubcontractors: true,
    canCreateChangeOrders: true,
    canSubmitPeerRatings: true, canViewPeerRatings: true,
    canManageHaulTickets: true, canApproveHaulTickets: true, canViewHaulTickets: true,
    canManageInspectorReports: true, canApproveInspectorReports: true,
    canSubmitInspectorReports: true, canViewInspectorReports: true,
    canManageSwppp: true, canViewSwppp: true,
    canManageMaterialCertifications: true, canVerifyMaterialCertifications: true,
    canViewMaterialCertifications: true,
    canManageDbeGoals: true, canViewDbeGoals: true,
    canViewSuretyBonds: true, canViewDotLibrary: true,
    canViewComplianceDashboard: true,
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
    canAccessTimeClock: true, canAccessTimeMaterial: true,
    canAccessCRM: true, canCreateCRMContacts: true,
    canAccessMarketplace: true,
    canManageEquipment: true, canManageProcurement: true,
    canUseAiFeatures: true,
    canUseAiEstimator: true,
    canAccessReports: true,
    canViewProjectBudget: true, canViewProjectEstimates: true, canViewProjectProcurement: true,
    canViewProjectReceipts: true, canViewProjectTimeEntries: true, canViewProjectSubcontractors: true,
    canSubmitPeerRatings: true, canViewPeerRatings: true,
    canManageDbeGoals: true, canViewDbeGoals: true,
    canManageSuretyBonds: true, canViewSuretyBonds: true,
    canViewDotLibrary: true, canViewMaterialCertifications: true,
  },
  FIELD_WORKER: {
    ...ALL_FALSE,
    canAccessDashboard: true, canAccessProjects: true, projectScope: "ACTIVE_ONLY" as const,
    canAccessCalendar: true, canAccessTasks: true, canAccessMessages: true,
    canAccessBulletins: true, canAccessTimeClock: true, canManageLeave: true,
    canViewProjectTimeEntries: true, canViewSafety: true, canViewAiSummaries: true,
    canSubmitPeerRatings: true, canViewPeerRatings: true,
    canSubmitInspectorReports: true, canViewInspectorReports: true,
    canViewHaulTickets: true, canViewSwppp: true,
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
