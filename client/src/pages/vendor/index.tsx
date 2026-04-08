import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { Package, Building2, DollarSign, Clock, ChevronRight, Plus } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { isVendor } from "@/lib/rbac";
import { Redirect } from "wouter";

interface VendorEnrollment {
  id: string;
  contractorOrgId: string;
  contractorOrgName: string;
  status: string;
  autoApproveNewPricing: boolean;
  notifyOnPriceUpdate: boolean;
  enrolledAt: string;
}

interface VendorPricingItem {
  id: string;
  itemName: string;
  itemCode: string | null;
  category: string | null;
  unitPrice: string;
  approvalStatus: string;
  createdAt: string;
}

export default function VendorDashboard() {
  const { user, logout, organizationName } = useAuth();

  if (!isVendor(user?.role)) {
    return <Redirect to="/dashboard" />;
  }

  const { data: enrollments, isLoading: enrollmentsLoading } = useQuery<VendorEnrollment[]>({
    queryKey: ["/api/vendor/enrollments"],
  });

  const { data: pricingItems, isLoading: pricingLoading } = useQuery<VendorPricingItem[]>({
    queryKey: ["/api/vendor/pricing"],
  });

  const activeEnrollments = enrollments?.filter(e => e.status === "ACTIVE") || [];
  const pendingReview = pricingItems?.filter(p => p.approvalStatus === "PENDING_REVIEW") || [];
  const approvedItems = pricingItems?.filter(p => p.approvalStatus === "AUTO_APPROVED" || p.approvalStatus === "APPROVED") || [];

  return (
    <div className="min-h-screen bg-background">
      <main className="container mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground" data-testid="text-vendor-dashboard-title">
            Dashboard
          </h1>
          <p className="text-muted-foreground">
            Welcome back! Manage your pricing and view enrolled contractor clients.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Clients</CardTitle>
              <Building2 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {enrollmentsLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <div className="text-2xl font-bold" data-testid="text-active-clients-count">
                  {activeEnrollments.length}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Contractor organizations enrolled
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Items</CardTitle>
              <Package className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {pricingLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <div className="text-2xl font-bold" data-testid="text-total-items-count">
                  {pricingItems?.length || 0}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Pricing items submitted
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Approved</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {pricingLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <div className="text-2xl font-bold text-green-600" data-testid="text-approved-count">
                  {approvedItems.length}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Items active in client catalogs
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Pending Review</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {pricingLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <div className="text-2xl font-bold text-amber-600" data-testid="text-pending-count">
                  {pendingReview.length}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Awaiting contractor approval
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2">
                <span>Recent Pricing Submissions</span>
                <Link href="/vendor/pricing">
                  <Button size="sm" data-testid="button-view-all-pricing">
                    <Plus className="h-4 w-4 mr-1" />
                    Add Pricing
                  </Button>
                </Link>
              </CardTitle>
              <CardDescription>
                Your latest pricing items
              </CardDescription>
            </CardHeader>
            <CardContent>
              {pricingLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map(i => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : pricingItems && pricingItems.length > 0 ? (
                <div className="space-y-3">
                  {pricingItems.slice(0, 5).map(item => (
                    <div 
                      key={item.id} 
                      className="flex items-center justify-between p-3 rounded-md bg-muted/50"
                      data-testid={`row-pricing-item-${item.id}`}
                    >
                      <div>
                        <p className="font-medium text-sm">{item.itemName}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.category || "Uncategorized"} · ${parseFloat(item.unitPrice).toFixed(2)}
                        </p>
                      </div>
                      <Badge 
                        variant={item.approvalStatus === "AUTO_APPROVED" || item.approvalStatus === "APPROVED" ? "default" : "secondary"}
                      >
                        {item.approvalStatus === "AUTO_APPROVED" ? "Approved" : 
                         item.approvalStatus === "APPROVED" ? "Approved" : 
                         item.approvalStatus === "PENDING_REVIEW" ? "Pending" : item.approvalStatus}
                      </Badge>
                    </div>
                  ))}
                  {pricingItems.length > 5 && (
                    <Link href="/vendor/pricing">
                      <Button variant="ghost" className="w-full" data-testid="button-view-more-pricing">
                        View all {pricingItems.length} items
                        <ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                    </Link>
                  )}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Package className="h-10 w-10 mx-auto mb-2 opacity-50" />
                  <p>No pricing items yet</p>
                  <Link href="/vendor/pricing">
                    <Button variant="outline" className="mt-2" data-testid="button-add-first-pricing">
                      Add Your First Pricing
                    </Button>
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2">
                <span>Enrolled Clients</span>
                <Link href="/vendor/clients">
                  <Button variant="outline" size="sm" data-testid="button-view-all-clients">
                    View All
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </Link>
              </CardTitle>
              <CardDescription>
                Contractor organizations receiving your pricing
              </CardDescription>
            </CardHeader>
            <CardContent>
              {enrollmentsLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map(i => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : activeEnrollments.length > 0 ? (
                <div className="space-y-3">
                  {activeEnrollments.slice(0, 5).map(enrollment => (
                    <div 
                      key={enrollment.id} 
                      className="flex items-center justify-between p-3 rounded-md bg-muted/50"
                      data-testid={`row-client-${enrollment.id}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                          <Building2 className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                          <p className="font-medium text-sm">{enrollment.contractorOrgName}</p>
                          <p className="text-xs text-muted-foreground">
                            Enrolled {new Date(enrollment.enrolledAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {enrollment.autoApproveNewPricing && (
                          <Badge variant="outline" className="text-xs">Auto-approve</Badge>
                        )}
                        <Badge variant="default">Active</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Building2 className="h-10 w-10 mx-auto mb-2 opacity-50" />
                  <p>No enrolled clients yet</p>
                  <p className="text-xs mt-1">
                    Contractors will invite you to submit pricing
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
