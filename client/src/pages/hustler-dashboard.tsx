import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2, Users, ArrowRightLeft, Plus, MapPin, Mail, Check, X, Loader2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";

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

export default function HustlerDashboard() {
  const { toast } = useToast();

  const { data, isLoading, error } = useQuery<HustlerOrganizationsResponse>({
    queryKey: ["/api/hustler/organizations"],
    staleTime: 30000,
  });

  const { data: pendingInvitesData, isLoading: loadingInvites } = useQuery<{ invites: PendingInvite[] }>({
    queryKey: ["/api/hustler/link-requests/pending"],
    staleTime: 30000,
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
      const response = await apiRequest("POST", "/api/hustler/switch-organization", {
        organizationId,
      });
      return response.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries();
      toast({
        title: "Organization Switched",
        description: result.message || "Successfully switched organization",
      });
      window.location.href = "/";
    },
    onError: (error: any) => {
      toast({
        title: "Switch Failed",
        description: error.message || "Failed to switch organization",
        variant: "destructive",
      });
    },
  });

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
    </div>
  );
}
