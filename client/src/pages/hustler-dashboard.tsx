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
import { Building2, Users, ArrowRightLeft, Plus, MapPin, Mail, Check, X, Loader2, UserPlus, Crown, Briefcase, TrendingUp, FileText, DollarSign, ClipboardList, Lightbulb, AlertCircle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Link, useLocation } from "wouter";
import { formatDistanceToNow } from "date-fns";

interface PortfolioStats {
  totalOrganizations: number;
  totalActiveProjects: number;
  totalOpenBids: number;
  totalPendingChangeOrders: number;
  totalPendingTasks: number;
  estimatedBidValue: number;
  organizationBreakdown: Array<{
    id: string;
    name: string;
    tradeType: string;
    logoUrl: string | null;
    activeProjects: number;
    openBids: number;
    employees: number;
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
  canViewFinancials: boolean;
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
      <div className="container mx-auto p-6">
        <div className="mb-6">
          <Skeleton className="h-8 w-64 mb-2" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
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
    <div className="container mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2" data-testid="text-hustler-title">
            <Building2 className="h-8 w-8" />
            My Organizations
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage and switch between your {data?.count || 0} organizations
          </p>
        </div>
        <Link href="/onboarding">
          <Button data-testid="button-add-org">
            <Plus className="h-4 w-4 mr-2" />
            Add Organization
          </Button>
        </Link>
      </div>

      {/* Executive Dashboard - Portfolio Overview */}
      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" />
          Portfolio Overview
        </h2>

        {/* KPI Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5 mb-6">
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
                      <th className="text-center py-2 font-medium">Employees</th>
                      <th className="text-center py-2 font-medium">Health</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portfolioStats.organizationBreakdown.map((org) => {
                      const healthScore = org.activeProjects > 0 ? "ACTIVE" : org.openBids > 0 ? "BIDDING" : "IDLE";
                      const isLoading = switchingOrgId === org.id;
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
                          <td className="text-center py-3" data-testid={`text-org-employees-${org.id}`}>
                            {org.employees}
                          </td>
                          <td className="text-center py-3">
                            <Badge 
                              variant={healthScore === "ACTIVE" ? "default" : healthScore === "BIDDING" ? "secondary" : "outline"}
                              data-testid={`badge-org-health-${org.id}`}
                            >
                              {healthScore}
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
                <div className="grid gap-4 md:grid-cols-2">
                  {/* Insights */}
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

                  {/* Recommendations */}
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
                      {delegate.canViewFinancials && <Check className="h-3 w-3 text-green-500" />}
                      {!delegate.canViewFinancials && <X className="h-3 w-3 text-red-500" />}
                      Can view financials
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
