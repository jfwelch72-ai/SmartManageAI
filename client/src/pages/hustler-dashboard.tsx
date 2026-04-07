import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Building2, Users, ArrowRightLeft, Plus, MapPin, Mail, Check, X, Loader2, UserPlus, Crown, Briefcase, TrendingUp, FileText, DollarSign, ClipboardList, Lightbulb, AlertCircle, Download, Target, ListChecks, BarChart3, Shield } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Link, useLocation } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { getRoleDisplayName } from "@/lib/rbac";

const ROLE_DEFAULT_PERMISSIONS: Record<string, Record<string, boolean>> = {
  ADMIN: {
    canAccessDashboard: true, canAccessProjects: true, canAccessActiveProjectsOnly: false,
    canCreateProjects: true, canEditProjects: true, canAccessCalendar: true,
    canAccessTasks: true, canAccessMessages: true, canAccessBulletins: true,
    canAccessEmailAssistant: true, canViewBids: true, canEditBids: true,
    canDeleteBids: true, canGenerateBidPDFs: true, canConvertBidToProject: true,
    canAccessBidNetworkGC: true, canAccessBidNetworkInbox: true,
    canManageBidResponses: true, canDeleteBidRequests: true,
    canAccessHistoricalCosts: true, canAccessScopeSettings: true,
    canUseAiBidAnalysis: true, canUseAiContractAnalysis: true,
    canViewFinancials: true, canEditFinancials: true,
    canAccessCostRates: true, canAccessCFODashboard: true,
    canAccessTMBilling: true, canAccessProgressBilling: true,
    canManageContracts: true, canAccessSubcontracts: true, canAccessOverheadCosts: true,
    canAccessProductionRates: true, canAccessVendorPricing: true,
    canAccessTimeClock: true, canManageTimeClock: true, canApproveTime: true,
    canAccessTMDaily: true, canManagePayroll: true, canManageCrews: true,
    canManageWorkforce: true, canManageLeave: true, canManageSafety: true,
    canManageScheduling: true, canAccessKPIs: true, canLockDailyReports: true,
    canManageEquipment: true, canManageProcurement: true,
    canAccessCRM: true, canCreateCRMContacts: true, canAccessMarketplace: true,
    canManageHiring: true, canAccessHiringInterviews: true, canManageHiringSettings: true,
    canPostSocialMedia: true, canManageWebsite: true, canAccessExecutiveDigest: true,
    canUseAiFeatures: true, canAccessCompanySettings: true, canManageUsers: true,
    canAccessApprovals: true, canAccessAuditLogs: true, canAccessReports: true,
    canAccessEnterpriseSettings: true, canManageAISettings: true,
    canViewProjectBudget: true, canViewProjectEstimates: true,
    canViewProjectProcurement: true, canViewProjectReceipts: true,
    canViewProjectTimeEntries: true, canViewProjectSubcontractors: true,
    canCreateChangeOrders: true, canDeleteScopeItems: true, canEditProjectHandoff: true,
  },
  MANAGER: {
    canAccessDashboard: true, canAccessProjects: true, canAccessActiveProjectsOnly: false,
    canCreateProjects: true, canEditProjects: true, canAccessCalendar: true,
    canAccessTasks: true, canAccessMessages: true, canAccessBulletins: true,
    canAccessEmailAssistant: true, canViewBids: true, canEditBids: true,
    canDeleteBids: true, canGenerateBidPDFs: true, canConvertBidToProject: true,
    canAccessBidNetworkGC: true, canAccessBidNetworkInbox: true,
    canManageBidResponses: true, canDeleteBidRequests: true,
    canAccessHistoricalCosts: true, canAccessScopeSettings: true,
    canUseAiBidAnalysis: true, canUseAiContractAnalysis: true,
    canViewFinancials: true, canEditFinancials: false,
    canAccessCFODashboard: true,
    canAccessTMBilling: true, canAccessProgressBilling: true,
    canManageContracts: true, canAccessSubcontracts: true, canAccessOverheadCosts: true,
    canAccessProductionRates: true, canAccessVendorPricing: true,
    canAccessTimeClock: true, canManageTimeClock: true, canApproveTime: true,
    canAccessTMDaily: true, canManagePayroll: true, canManageCrews: true,
    canManageWorkforce: true, canManageLeave: true, canManageSafety: true,
    canManageScheduling: true, canAccessKPIs: true, canLockDailyReports: true,
    canManageEquipment: true, canManageProcurement: true,
    canAccessCRM: true, canCreateCRMContacts: true, canAccessMarketplace: true,
    canManageHiring: true, canAccessHiringInterviews: true,
    canPostSocialMedia: true, canAccessExecutiveDigest: true,
    canUseAiFeatures: true, canAccessCompanySettings: true,
    canAccessApprovals: true, canAccessAuditLogs: true, canAccessReports: true,
    canViewProjectBudget: true, canViewProjectEstimates: true,
    canViewProjectProcurement: true, canViewProjectReceipts: true,
    canViewProjectTimeEntries: true, canViewProjectSubcontractors: true,
    canCreateChangeOrders: true, canDeleteScopeItems: true, canEditProjectHandoff: true,
  },
  SUPERINTENDENT: {
    canAccessDashboard: true, canAccessProjects: true, canAccessCalendar: true,
    canAccessTasks: true, canAccessMessages: true, canAccessBulletins: true,
    canViewBids: true, canAccessHistoricalCosts: true,
    canViewFinancials: true,
    canAccessCFODashboard: true, canManageContracts: true, canAccessSubcontracts: true,
    canAccessProductionRates: true,
    canAccessTimeClock: true, canManageTimeClock: true, canApproveTime: true,
    canAccessTMDaily: true, canManageWorkforce: true, canManageSafety: true,
    canManageScheduling: true, canAccessKPIs: true, canLockDailyReports: true,
    canManageEquipment: true, canManageProcurement: true,
    canAccessCRM: true, canCreateCRMContacts: true,
    canAccessCompanySettings: true, canAccessApprovals: true, canAccessReports: true,
    canViewProjectBudget: true, canViewProjectEstimates: true, canViewProjectProcurement: true,
    canViewProjectReceipts: true, canViewProjectTimeEntries: true, canViewProjectSubcontractors: true,
    canCreateChangeOrders: true,
  },
  ESTIMATOR: {
    canAccessDashboard: true, canAccessProjects: true, canAccessCalendar: true,
    canAccessTasks: true, canAccessMessages: true, canAccessBulletins: true,
    canViewBids: true, canEditBids: true, canGenerateBidPDFs: true,
    canConvertBidToProject: true, canAccessBidNetworkGC: true, canAccessBidNetworkInbox: true,
    canAccessHistoricalCosts: true, canAccessScopeSettings: true, canUseAiBidAnalysis: true,
    canCreateProjects: true,
    canViewFinancials: true,
    canEditProjects: true, canAccessCostRates: true, canAccessProductionRates: true,
    canAccessTimeClock: true,
    canAccessCRM: true, canCreateCRMContacts: true,
    canUseAiFeatures: true,
    canAccessCompanySettings: true, canAccessReports: true,
    canViewProjectBudget: true, canViewProjectEstimates: true, canViewProjectProcurement: true,
    canViewProjectReceipts: true, canViewProjectTimeEntries: true, canViewProjectSubcontractors: true,
  },
  FIELD_WORKER: {
    canAccessDashboard: true, canAccessProjects: true, canAccessActiveProjectsOnly: true,
    canAccessCalendar: true, canAccessTasks: true, canAccessMessages: true,
    canAccessBulletins: true, canAccessTimeClock: true, canManageLeave: true,
    canViewProjectTimeEntries: true,
  },
  HUSTLER: {
    canAccessDashboard: true, canAccessProjects: true, canAccessMessages: true,
    canAccessCalendar: true, canManageUsers: true,
    canViewFinancials: true, canEditFinancials: true,
    canAccessKPIs: true, canAccessCFODashboard: true,
    canManageHiring: true, canAccessHiringInterviews: true,
    canAccessReports: true, canManagePayroll: true,
    canUseAiFeatures: true, canAccessAuditLogs: true,
  },
  VENDOR: {
    canAccessDashboard: true, canAccessMessages: true,
    canAccessBidNetworkInbox: true,
  },
};

function getPermissionCountForRole(role: string): number {
  const perms = ROLE_DEFAULT_PERMISSIONS[role];
  if (!perms) return 0;
  return Object.values(perms).filter(v => v === true).length;
}

interface PortfolioStats {
  totalOrganizations: number;
  totalActiveProjects: number;
  totalOpenBids: number;
  totalPendingChangeOrders: number;
  totalPendingTasks: number;
  estimatedBidValue: number;
  bidsAwarded: number;
  bidsLost: number;
  bidWinRate: number;
  organizationBreakdown: Array<{
    id: string;
    name: string;
    tradeType: string;
    logoUrl: string | null;
    activeProjects: number;
    openBids: number;
    employees: number;
    pendingTasks: number;
    healthStatus: "ACTIVE" | "BIDDING" | "PENDING_TASKS" | "IDLE";
  }>;
}

interface AIPortfolioSummary {
  summary: string;
  insights: string[];
  recommendations: string[];
  metrics?: {
    projects: { active: number; planning: number; completed: number };
    bids: { total: number; totalValue: string };
    pendingApprovals: number;
  };
}

interface Organization {
  id: string;
  organizationId: string;
  roleOverride: string | null;
  isActive: boolean;
  createdAt: string;
  organization: {
    id: string;
    name: string;
    slug: string;
    tradeType: string;
    tradeName: string | null;
    logoUrl: string | null;
    primaryColor: string | null;
    region: string | null;
  };
}

interface HustlerOrganizationsResponse {
  organizations: Organization[];
  currentOrganizationId: string | null;
  count: number;
}

interface PendingInvite {
  id: string;
  organizationId: string;
  requestType: string;
  status: string;
  roleOverride: string | null;
  message: string | null;
  expiresAt: string | null;
  createdAt: string;
  organization: {
    id: string;
    name: string;
    slug: string;
    tradeType: string;
    logoUrl: string | null;
  };
  invitedBy: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string;
  };
}

interface Delegate {
  id: string;
  delegateRole: string;
  delegateEmail: string | null;
  status: string;
  canCreateOrganizations: boolean;
  canManageAllOrganizations: boolean;
  financialsAccess: string;
  canInviteOtherDelegates: boolean;
  expiresAt: string | null;
  acceptedAt: string | null;
  isActive: boolean;
  createdAt: string;
  delegateUser: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string;
  } | null;
}

export default function HustlerDashboard() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [showInviteDelegateDialog, setShowInviteDelegateDialog] = useState(false);
  const [delegateEmail, setDelegateEmail] = useState("");
  const [delegateRole, setDelegateRole] = useState<string>("COO");
  const [switchingOrgId, setSwitchingOrgId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<HustlerOrganizationsResponse>({
    queryKey: ["/api/hustler/organizations"],
    staleTime: 30000,
  });

  const { data: pendingInvitesData, isLoading: loadingInvites } = useQuery<{ invites: PendingInvite[] }>({
    queryKey: ["/api/hustler/link-requests/pending"],
    staleTime: 30000,
  });

  const { data: delegatesData } = useQuery<{ delegates: Delegate[] }>({
    queryKey: ["/api/hustler/delegates"],
    staleTime: 30000,
  });

  const { data: portfolioStats, isLoading: loadingStats } = useQuery<PortfolioStats>({
    queryKey: ["/api/hustler/portfolio/stats"],
    staleTime: 60000,
  });

  const { data: aiSummary, isLoading: loadingAISummary } = useQuery<AIPortfolioSummary>({
    queryKey: ["/api/hustler/portfolio/ai-summary"],
    staleTime: 120000,
  });

  const inviteDelegateMutation = useMutation({
    mutationFn: async (data: { email: string; delegateRole: string }) => {
      const response = await apiRequest("POST", "/api/hustler/delegates/invite", data);
      return response.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/hustler/delegates"] });
      setShowInviteDelegateDialog(false);
      setDelegateEmail("");
      toast({
        title: "Invite Sent",
        description: result.message,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed",
        description: error.message || "Failed to invite delegate",
        variant: "destructive",
      });
    },
  });

  const revokeDelegateMutation = useMutation({
    mutationFn: async (delegateId: string) => {
      const response = await apiRequest("POST", `/api/hustler/delegates/${delegateId}/revoke`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hustler/delegates"] });
      toast({
        title: "Access Revoked",
        description: "Delegate access has been revoked",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed",
        description: error.message || "Failed to revoke delegate",
        variant: "destructive",
      });
    },
  });

  const respondMutation = useMutation({
    mutationFn: async ({ requestId, action }: { requestId: string; action: "approve" | "reject" }) => {
      const response = await apiRequest("POST", `/api/hustler/link-requests/${requestId}/respond`, { action });
      return response.json();
    },
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/hustler/link-requests/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/hustler/organizations"] });
      toast({
        title: variables.action === "approve" ? "Invite Accepted" : "Invite Declined",
        description: result.message,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed",
        description: error.message || "Failed to respond to invite",
        variant: "destructive",
      });
    },
  });

  const switchMutation = useMutation({
    mutationFn: async (organizationId: string) => {
      setSwitchingOrgId(organizationId);
      const response = await apiRequest("POST", "/api/hustler/switch-organization", {
        organizationId,
      });
      return response.json();
    },
    onSuccess: (result, organizationId) => {
      queryClient.invalidateQueries();
      // Navigate to organization detail page
      setLocation(`/hustler/org/${organizationId}`);
    },
    onError: (error: any) => {
      setSwitchingOrgId(null);
      toast({
        title: "Switch Failed",
        description: error.message || "Failed to switch organization",
        variant: "destructive",
      });
    },
  });

  // Handle clicking an organization row to drill down
  const handleOrgClick = (orgId: string) => {
    if (switchingOrgId) return; // Prevent double-clicks
    switchMutation.mutate(orgId);
  };

  if (error) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-muted-foreground">
              Unable to load organizations. You may not have Hustler access.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="container mx-auto px-3 sm:px-6 py-4 sm:py-6">
        <div className="mb-6">
          <Skeleton className="h-8 w-64 mb-2" />
          <Skeleton className="h-4 w-full sm:w-96" />
        </div>
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-6 w-40" />
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-10 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-3 sm:px-6 py-4 sm:py-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2" data-testid="text-hustler-title">
            <Building2 className="h-7 w-7 sm:h-8 sm:w-8" />
            My Organizations
          </h1>
          <p className="text-muted-foreground mt-1 text-sm sm:text-base">
            Manage and switch between your {data?.count || 0} organizations
          </p>
        </div>
        <Link href="/onboarding">
          <Button data-testid="button-add-org" className="w-full sm:w-auto">
            <Plus className="h-4 w-4 mr-2" />
            Add Organization
          </Button>
        </Link>
      </div>

      {/* Executive Dashboard - Portfolio Overview */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            Portfolio Overview
          </h2>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              try {
                const res = await apiRequest("GET", "/api/hustler/portfolio/export");
                const blob = await res.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `portfolio-report-${new Date().toISOString().slice(0, 10)}.csv`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                window.URL.revokeObjectURL(url);
                toast({ title: "Report Downloaded", description: "Portfolio CSV report has been downloaded." });
              } catch (err: any) {
                toast({ title: "Export Failed", description: err.message, variant: "destructive" });
              }
            }}
            data-testid="button-export-portfolio"
          >
            <Download className="h-4 w-4 mr-2" />
            Export Report
          </Button>
        </div>

        {/* KPI Cards */}
        <div className="grid gap-3 sm:gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 mb-6">
          <Card data-testid="card-stat-orgs">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
              <CardTitle className="text-sm font-medium">Organizations</CardTitle>
              <Building2 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {loadingStats ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <div className="text-2xl font-bold" data-testid="text-stat-orgs">
                  {portfolioStats?.totalOrganizations || 0}
                </div>
              )}
            </CardContent>
          </Card>

          <Card data-testid="card-stat-projects">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
              <CardTitle className="text-sm font-medium">Active Projects</CardTitle>
              <ClipboardList className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {loadingStats ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <div className="text-2xl font-bold" data-testid="text-stat-projects">
                  {portfolioStats?.totalActiveProjects || 0}
                </div>
              )}
            </CardContent>
          </Card>

          <Card data-testid="card-stat-bids">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
              <CardTitle className="text-sm font-medium">Open Bids</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {loadingStats ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <div className="text-2xl font-bold" data-testid="text-stat-bids">
                  {portfolioStats?.totalOpenBids || 0}
                </div>
              )}
            </CardContent>
          </Card>

          <Card data-testid="card-stat-change-orders">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
              <CardTitle className="text-sm font-medium">Pending COs</CardTitle>
              <AlertCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {loadingStats ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <div className="text-2xl font-bold" data-testid="text-stat-cos">
                  {portfolioStats?.totalPendingChangeOrders || 0}
                </div>
              )}
            </CardContent>
          </Card>

          <Card data-testid="card-stat-tasks">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
              <CardTitle className="text-sm font-medium">Pending Tasks</CardTitle>
              <ListChecks className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {loadingStats ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <div className="text-2xl font-bold" data-testid="text-stat-tasks">
                  {portfolioStats?.totalPendingTasks || 0}
                </div>
              )}
            </CardContent>
          </Card>

          <Card data-testid="card-stat-bid-value">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
              <CardTitle className="text-sm font-medium">Bid Pipeline</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {loadingStats ? (
                <Skeleton className="h-8 w-24" />
              ) : (
                <div className="text-2xl font-bold" data-testid="text-stat-pipeline">
                  ${(portfolioStats?.estimatedBidValue || 0).toLocaleString()}
                </div>
              )}
            </CardContent>
          </Card>

          <Card data-testid="card-stat-win-rate">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
              <CardTitle className="text-sm font-medium">Bid Win Rate</CardTitle>
              <Target className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {loadingStats ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <>
                  <div className="text-2xl font-bold" data-testid="text-stat-win-rate">
                    {portfolioStats?.bidWinRate || 0}%
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {portfolioStats?.bidsAwarded || 0}W / {portfolioStats?.bidsLost || 0}L
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Organization Portfolio Table */}
        {portfolioStats?.organizationBreakdown && portfolioStats.organizationBreakdown.length > 0 && (
          <Card className="mb-6" data-testid="card-org-breakdown">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Building2 className="h-5 w-5 text-primary" />
                Organization Health
              </CardTitle>
              <CardDescription>Performance overview of each organization in your portfolio</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 font-medium">Organization</th>
                      <th className="text-center py-2 font-medium">Trade</th>
                      <th className="text-center py-2 font-medium">Active Projects</th>
                      <th className="text-center py-2 font-medium">Open Bids</th>
                      <th className="text-center py-2 font-medium">Tasks</th>
                      <th className="text-center py-2 font-medium">Employees</th>
                      <th className="text-center py-2 font-medium">Health</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portfolioStats.organizationBreakdown.map((org) => {
                      const isLoading = switchingOrgId === org.id;
                      const hs = org.healthStatus || "IDLE";
                      return (
                        <tr 
                          key={org.id} 
                          className="border-b hover-elevate cursor-pointer transition-colors" 
                          onClick={() => handleOrgClick(org.id)}
                          data-testid={`row-org-${org.id}`}
                        >
                          <td className="py-3">
                            <div className="flex items-center gap-2">
                              {isLoading ? (
                                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                              ) : org.logoUrl ? (
                                <img src={org.logoUrl} alt={org.name} className="h-6 w-6 rounded" />
                              ) : (
                                <Building2 className="h-5 w-5 text-muted-foreground" />
                              )}
                              <span className="font-medium">{org.name}</span>
                              {isLoading && <span className="text-xs text-muted-foreground">Switching...</span>}
                            </div>
                          </td>
                          <td className="text-center py-3">
                            <Badge variant="secondary" className="text-xs">
                              {org.tradeType.replace(/_/g, " ")}
                            </Badge>
                          </td>
                          <td className="text-center py-3 font-semibold" data-testid={`text-org-projects-${org.id}`}>
                            {org.activeProjects}
                          </td>
                          <td className="text-center py-3" data-testid={`text-org-bids-${org.id}`}>
                            {org.openBids}
                          </td>
                          <td className="text-center py-3" data-testid={`text-org-tasks-${org.id}`}>
                            {org.pendingTasks}
                          </td>
                          <td className="text-center py-3" data-testid={`text-org-employees-${org.id}`}>
                            {org.employees}
                          </td>
                          <td className="text-center py-3">
                            <Badge 
                              variant={hs === "ACTIVE" ? "default" : hs === "BIDDING" || hs === "PENDING_TASKS" ? "secondary" : "outline"}
                              data-testid={`badge-org-health-${org.id}`}
                            >
                              {hs === "PENDING_TASKS" ? "TASKS" : hs}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Access Summary Card */}
        {data?.organizations && data.organizations.length > 0 && (
          <Card className="mb-6" data-testid="card-access-summary">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Shield className="h-5 w-5 text-purple-500" />
                Access Summary
              </CardTitle>
              <CardDescription>Your effective role and permission level across all linked organizations</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 font-medium">Organization</th>
                      <th className="text-center py-2 font-medium">Effective Role</th>
                      <th className="text-center py-2 font-medium">Permissions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.organizations.map((org) => {
                      const effectiveRole = org.roleOverride || "ADMIN";
                      const permCount = getPermissionCountForRole(effectiveRole);
                      return (
                        <tr key={org.organizationId} className="border-b" data-testid={`row-access-${org.organizationId}`}>
                          <td className="py-3">
                            <div className="flex items-center gap-2">
                              {org.organization.logoUrl ? (
                                <img src={org.organization.logoUrl} alt={org.organization.name} className="h-6 w-6 rounded" />
                              ) : (
                                <Building2 className="h-5 w-5 text-muted-foreground" />
                              )}
                              <span className="font-medium" data-testid={`text-access-org-name-${org.organizationId}`}>{org.organization.name}</span>
                            </div>
                          </td>
                          <td className="text-center py-3">
                            <Badge
                              variant="outline"
                              className="border-purple-300 text-purple-600 dark:border-purple-600 dark:text-purple-400"
                              data-testid={`badge-access-role-${org.organizationId}`}
                            >
                              <Shield className="h-3 w-3 mr-1" />
                              {getRoleDisplayName(effectiveRole)}
                            </Badge>
                          </td>
                          <td className="text-center py-3">
                            <Badge variant="secondary" data-testid={`badge-access-perms-${org.organizationId}`}>
                              {permCount} permissions
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* AI Insights Section */}
        {(aiSummary?.summary || loadingAISummary) && (
          <Card className="mb-6" data-testid="card-ai-insights">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Lightbulb className="h-5 w-5 text-yellow-500" />
                AI Executive Insights
              </CardTitle>
              <CardDescription>
                {loadingAISummary ? (
                  <Skeleton className="h-4 w-3/4" />
                ) : (
                  aiSummary?.summary
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingAISummary ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                  <Skeleton className="h-4 w-4/6" />
                </div>
              ) : (
                <div className="space-y-4">
                  {aiSummary?.metrics && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 rounded-lg bg-muted/50">
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground">Active Projects</p>
                        <p className="text-lg font-bold" data-testid="text-ai-metric-active">{aiSummary.metrics.projects.active}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground">Planning</p>
                        <p className="text-lg font-bold" data-testid="text-ai-metric-planning">{aiSummary.metrics.projects.planning}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground">Total Bids</p>
                        <p className="text-lg font-bold" data-testid="text-ai-metric-bids">{aiSummary.metrics.bids.total}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground">Pending Approvals</p>
                        <p className="text-lg font-bold" data-testid="text-ai-metric-approvals">{aiSummary.metrics.pendingApprovals}</p>
                      </div>
                    </div>
                  )}

                  <div className="grid gap-4 md:grid-cols-2">
                    {aiSummary?.insights && aiSummary.insights.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold mb-2 flex items-center gap-1">
                          <TrendingUp className="h-4 w-4 text-blue-500" />
                          Key Insights
                        </h4>
                        <ul className="space-y-1">
                          {aiSummary.insights.map((insight, i) => (
                            <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                              <span className="text-blue-500 mt-1">•</span>
                              {insight}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {aiSummary?.recommendations && aiSummary.recommendations.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold mb-2 flex items-center gap-1">
                          <AlertCircle className="h-4 w-4 text-orange-500" />
                          Recommendations
                        </h4>
                        <ul className="space-y-1">
                          {aiSummary.recommendations.map((rec, i) => (
                            <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                              <span className="text-orange-500 mt-1">•</span>
                              {rec}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {(pendingInvitesData?.invites?.length || 0) > 0 && (
        <div className="mb-6 space-y-4">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" />
            Pending Invites
            <Badge variant="secondary" className="ml-2">
              {pendingInvitesData?.invites.length}
            </Badge>
          </h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {pendingInvitesData?.invites.map((invite) => (
              <Card key={invite.id} className="border-primary/20 bg-primary/5" data-testid={`card-invite-${invite.id}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-lg">{invite.organization.name}</CardTitle>
                      <CardDescription className="mt-1">
                        <Badge variant="secondary" className="text-xs">
                          {invite.organization.tradeType.replace(/_/g, " ")}
                        </Badge>
                      </CardDescription>
                    </div>
                    {invite.organization.logoUrl && (
                      <img
                        src={invite.organization.logoUrl}
                        alt={invite.organization.name}
                        className="h-10 w-10 rounded object-contain"
                      />
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-sm text-muted-foreground">
                    <p>
                      Invited by {invite.invitedBy.firstName || invite.invitedBy.email} {" "}
                      {formatDistanceToNow(new Date(invite.createdAt), { addSuffix: true })}
                    </p>
                    {invite.roleOverride && (
                      <p className="flex items-center gap-1 mt-1">
                        <Users className="h-3 w-3" />
                        Role: {invite.roleOverride}
                      </p>
                    )}
                  </div>
                  {invite.message && (
                    <p className="text-sm italic text-muted-foreground border-l-2 pl-2">
                      "{invite.message}"
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => respondMutation.mutate({ requestId: invite.id, action: "approve" })}
                      disabled={respondMutation.isPending}
                      className="flex-1"
                      data-testid={`button-accept-${invite.id}`}
                    >
                      {respondMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <Check className="h-4 w-4 mr-1" />
                          Accept
                        </>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => respondMutation.mutate({ requestId: invite.id, action: "reject" })}
                      disabled={respondMutation.isPending}
                      data-testid={`button-decline-${invite.id}`}
                    >
                      <X className="h-4 w-4 mr-1" />
                      Decline
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {data?.count === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <Building2 className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-semibold mb-2">No Organizations Yet</h3>
            <p className="text-muted-foreground mb-4">
              Get started by creating your first organization
            </p>
            <Link href="/onboarding">
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Create Organization
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {data?.organizations.map((org) => {
            const isCurrent = org.organizationId === data.currentOrganizationId;
            return (
              <Card
                key={org.organizationId}
                className={isCurrent ? "ring-2 ring-primary" : ""}
                data-testid={`card-org-${org.organizationId}`}
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-lg">{org.organization.name}</CardTitle>
                      <CardDescription className="flex items-center gap-1 mt-1">
                        <Badge variant="secondary" className="text-xs">
                          {org.organization.tradeName || org.organization.tradeType}
                        </Badge>
                        {isCurrent && (
                          <Badge variant="default" className="text-xs">
                            Active
                          </Badge>
                        )}
                      </CardDescription>
                    </div>
                    {org.organization.logoUrl && (
                      <img
                        src={org.organization.logoUrl}
                        alt={org.organization.name}
                        className="h-10 w-10 rounded object-contain"
                      />
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {org.organization.region && (
                    <p className="text-sm text-muted-foreground flex items-center gap-1 mb-3">
                      <MapPin className="h-3 w-3" />
                      {org.organization.region}
                    </p>
                  )}
                  <div className="flex items-center gap-2">
                    {isCurrent ? (
                      <Link href="/" className="flex-1">
                        <Button variant="secondary" className="w-full" data-testid={`button-go-dashboard-${org.organizationId}`}>
                          Go to Dashboard
                        </Button>
                      </Link>
                    ) : (
                      <Button
                        onClick={() => switchMutation.mutate(org.organizationId)}
                        disabled={switchMutation.isPending}
                        className="flex-1"
                        data-testid={`button-switch-${org.organizationId}`}
                      >
                        <ArrowRightLeft className="h-4 w-4 mr-2" />
                        Switch to This Org
                      </Button>
                    )}
                  </div>
                  {org.roleOverride && (
                    <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      Role: {org.roleOverride}
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Delegate Management Section */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Crown className="h-5 w-5 text-primary" />
              Executive Team
            </h2>
            <p className="text-sm text-muted-foreground">
              Invite COO, CFO or other executives to manage your companies
            </p>
          </div>
          <Dialog open={showInviteDelegateDialog} onOpenChange={setShowInviteDelegateDialog}>
            <DialogTrigger asChild>
              <Button variant="outline" data-testid="button-invite-delegate">
                <UserPlus className="h-4 w-4 mr-2" />
                Invite Executive
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Invite Executive</DialogTitle>
                <DialogDescription>
                  Invite a COO, CFO, or other executive to help manage your organizations
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="delegate-email">Email Address</Label>
                  <Input
                    id="delegate-email"
                    type="email"
                    placeholder="coo@company.com"
                    value={delegateEmail}
                    onChange={(e) => setDelegateEmail(e.target.value)}
                    data-testid="input-delegate-email"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="delegate-role">Role</Label>
                  <Select value={delegateRole} onValueChange={setDelegateRole}>
                    <SelectTrigger data-testid="select-delegate-role">
                      <SelectValue placeholder="Select role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="COO">COO - Chief Operating Officer</SelectItem>
                      <SelectItem value="CFO">CFO - Chief Financial Officer</SelectItem>
                      <SelectItem value="OPERATIONS_MANAGER">Operations Manager</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setShowInviteDelegateDialog(false)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={() => inviteDelegateMutation.mutate({ email: delegateEmail, delegateRole })}
                    disabled={!delegateEmail || inviteDelegateMutation.isPending}
                    data-testid="button-send-delegate-invite"
                  >
                    {inviteDelegateMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <UserPlus className="h-4 w-4 mr-2" />
                    )}
                    Send Invite
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {delegatesData?.delegates && delegatesData.delegates.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {delegatesData.delegates.map((delegate) => (
              <Card key={delegate.id} data-testid={`card-delegate-${delegate.id}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Briefcase className="h-4 w-4" />
                        {delegate.delegateRole}
                      </CardTitle>
                      <CardDescription>
                        {delegate.delegateUser
                          ? `${delegate.delegateUser.firstName || ""} ${delegate.delegateUser.lastName || ""}`.trim() || delegate.delegateUser.email
                          : delegate.delegateEmail}
                      </CardDescription>
                    </div>
                    <Badge
                      variant={delegate.status === "APPROVED" ? "default" : delegate.status === "PENDING" ? "secondary" : "outline"}
                    >
                      {delegate.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-xs text-muted-foreground space-y-1 mb-3">
                    <p className="flex items-center gap-1">
                      {delegate.canCreateOrganizations && <Check className="h-3 w-3 text-green-500" />}
                      {!delegate.canCreateOrganizations && <X className="h-3 w-3 text-red-500" />}
                      Can create organizations
                    </p>
                    <p className="flex items-center gap-1">
                      {delegate.financialsAccess !== "none" && <Check className="h-3 w-3 text-green-500" />}
                      {delegate.financialsAccess === "none" && <X className="h-3 w-3 text-red-500" />}
                      Financials: {delegate.financialsAccess === "manage" ? "Manage" : delegate.financialsAccess === "view" ? "View" : "None"}
                    </p>
                  </div>
                  {delegate.status !== "REVOKED" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => revokeDelegateMutation.mutate(delegate.id)}
                      disabled={revokeDelegateMutation.isPending}
                      className="w-full"
                      data-testid={`button-revoke-delegate-${delegate.id}`}
                    >
                      <X className="h-4 w-4 mr-1" />
                      Revoke Access
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="py-8 text-center">
              <Users className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-muted-foreground">
                No executives invited yet. Invite a COO or CFO to help manage your companies.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
