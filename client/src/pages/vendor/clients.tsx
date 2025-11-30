import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Search, Building2, CheckCircle, Clock, XCircle, Package } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";
import { Link, Redirect } from "wouter";
import { isVendor } from "@/lib/rbac";

interface VendorEnrollment {
  id: string;
  vendorId: string;
  contractorOrgId: string;
  contractorOrgName: string;
  status: string;
  autoApproveNewPricing: boolean;
  notifyOnPriceUpdate: boolean;
  enrolledAt: string;
  invitedByUserId: string | null;
}

export default function VendorClients() {
  const { user, logout, organizationName } = useAuth();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  if (!isVendor(user?.role)) {
    return <Redirect to="/dashboard" />;
  }

  const { data: enrollments, isLoading } = useQuery<VendorEnrollment[]>({
    queryKey: ["/api/vendor/enrollments"],
  });

  const filteredEnrollments = enrollments?.filter(enrollment => {
    const matchesSearch = enrollment.contractorOrgName.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "all" || enrollment.status === statusFilter;
    return matchesSearch && matchesStatus;
  }) || [];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "ACTIVE":
        return (
          <Badge variant="default" className="gap-1">
            <CheckCircle className="h-3 w-3" />
            Active
          </Badge>
        );
      case "PENDING":
        return (
          <Badge variant="secondary" className="gap-1">
            <Clock className="h-3 w-3" />
            Pending
          </Badge>
        );
      case "SUSPENDED":
        return (
          <Badge variant="destructive" className="gap-1">
            <XCircle className="h-3 w-3" />
            Suspended
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const activeCount = enrollments?.filter(e => e.status === "ACTIVE").length || 0;
  const pendingCount = enrollments?.filter(e => e.status === "PENDING").length || 0;

  return (
    <div className="min-h-screen bg-background">
      <main className="container mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground" data-testid="text-vendor-clients-title">
            Enrolled Clients
          </h1>
          <p className="text-muted-foreground">
            View contractor organizations that have enrolled to receive your pricing
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3 mb-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Clients</CardTitle>
              <Building2 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <div className="text-2xl font-bold" data-testid="text-total-clients">
                  {enrollments?.length || 0}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active</CardTitle>
              <CheckCircle className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <div className="text-2xl font-bold text-green-600" data-testid="text-active-clients">
                  {activeCount}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Pending</CardTitle>
              <Clock className="h-4 w-4 text-amber-600" />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <div className="text-2xl font-bold text-amber-600" data-testid="text-pending-clients">
                  {pendingCount}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
              <div>
                <CardTitle>Client Organizations</CardTitle>
                <CardDescription>
                  Contractors receiving your pricing submissions
                </CardDescription>
              </div>
              <div className="flex gap-2 w-full md:w-auto">
                <div className="relative flex-1 md:w-64">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search clients..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                    data-testid="input-search-clients"
                  />
                </div>
                <div className="flex gap-1">
                  <Button
                    variant={statusFilter === "all" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setStatusFilter("all")}
                    data-testid="button-filter-all"
                  >
                    All
                  </Button>
                  <Button
                    variant={statusFilter === "ACTIVE" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setStatusFilter("ACTIVE")}
                    data-testid="button-filter-active"
                  >
                    Active
                  </Button>
                  <Button
                    variant={statusFilter === "PENDING" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setStatusFilter("PENDING")}
                    data-testid="button-filter-pending"
                  >
                    Pending
                  </Button>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4, 5].map(i => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : filteredEnrollments.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Organization</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Auto-Approve</TableHead>
                      <TableHead>Notifications</TableHead>
                      <TableHead>Enrolled</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredEnrollments.map(enrollment => (
                      <TableRow key={enrollment.id} data-testid={`row-client-${enrollment.id}`}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                              <Building2 className="h-5 w-5 text-primary" />
                            </div>
                            <div>
                              <p className="font-medium">{enrollment.contractorOrgName}</p>
                              <p className="text-xs text-muted-foreground">
                                ID: {enrollment.contractorOrgId.slice(0, 8)}...
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>{getStatusBadge(enrollment.status)}</TableCell>
                        <TableCell>
                          {enrollment.autoApproveNewPricing ? (
                            <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50">
                              Enabled
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground">
                              Manual Review
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {enrollment.notifyOnPriceUpdate ? (
                            <Badge variant="outline" className="text-blue-600 border-blue-200 bg-blue-50">
                              On
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground">
                              Off
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {new Date(enrollment.enrolledAt).toLocaleDateString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <Building2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="text-lg font-medium">No enrolled clients</p>
                <p className="text-sm mb-4">
                  {enrollments?.length === 0 
                    ? "Contractor organizations will invite you to submit pricing"
                    : "No clients match your search criteria"}
                </p>
                {enrollments && enrollments.length > 0 && (
                  <Link href="/vendor/pricing">
                    <Button variant="outline" data-testid="button-view-pricing">
                      <Package className="h-4 w-4 mr-2" />
                      View My Pricing
                    </Button>
                  </Link>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
