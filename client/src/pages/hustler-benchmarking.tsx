import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { BarChart3, Building2, Users, Briefcase, DollarSign, TrendingUp, ChevronLeft, Trophy, Target, Activity } from "lucide-react";
import { Link } from "wouter";

interface OrgMetrics {
  organizationId: string;
  name: string;
  tradeType: string;
  logoUrl: string | null;
  metrics: {
    activeProjects: number;
    completedProjects: number;
    totalProjectValue: number;
    totalBids: number;
    bidPipeline: number;
    employees: number;
    pendingChangeOrders: number;
    projectsPerEmployee: number;
    bidWinRate: number;
  };
}

interface BenchmarkingResponse {
  organizations: OrgMetrics[];
  rankings: {
    byActiveProjects: string[];
    byBidPipeline: string[];
    byEmployees: string[];
    byEfficiency: string[];
  };
  portfolioTotals: {
    totalActiveProjects: number;
    totalCompletedProjects: number;
    totalProjectValue: number;
    totalBidPipeline: number;
    totalEmployees: number;
    totalPendingCOs: number;
  };
}

export default function HustlerBenchmarking() {
  const { data, isLoading, error } = useQuery<BenchmarkingResponse>({
    queryKey: ["/api/hustler/benchmarking"],
    staleTime: 60000,
  });

  const getRankBadge = (orgId: string, rankings: string[]) => {
    const rank = rankings.indexOf(orgId) + 1;
    if (rank === 1) return <Badge className="bg-yellow-500 text-white"><Trophy className="h-3 w-3 mr-1" /> 1st</Badge>;
    if (rank === 2) return <Badge variant="secondary">2nd</Badge>;
    if (rank === 3) return <Badge variant="outline">3rd</Badge>;
    return <Badge variant="outline">{rank}th</Badge>;
  };

  const getMaxValue = (orgs: OrgMetrics[], key: keyof OrgMetrics["metrics"]) => {
    return Math.max(...orgs.map(o => o.metrics[key] as number), 1);
  };

  if (error) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-muted-foreground">
              Unable to load benchmarking data. You may not have HUSTLER access.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <div className="flex items-center gap-4 mb-6">
        <Link href="/hustler">
          <Button variant="ghost" size="icon" data-testid="button-back-hustler">
            <ChevronLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2" data-testid="text-benchmarking-title">
            <BarChart3 className="h-8 w-8" />
            Organization Benchmarking
          </h1>
          <p className="text-muted-foreground mt-1">
            Compare performance metrics across all your organizations
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Card key={i}>
                <CardHeader className="pb-2">
                  <Skeleton className="h-4 w-24" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-8 w-16" />
                </CardContent>
              </Card>
            ))}
          </div>
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-48" />
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <>
          {/* Portfolio Totals */}
          <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6 mb-6">
            <Card data-testid="card-total-projects">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Active Projects</CardTitle>
                <Briefcase className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-total-projects">
                  {data?.portfolioTotals.totalActiveProjects || 0}
                </div>
              </CardContent>
            </Card>

            <Card data-testid="card-total-completed">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Completed</CardTitle>
                <Target className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-total-completed">
                  {data?.portfolioTotals.totalCompletedProjects || 0}
                </div>
              </CardContent>
            </Card>

            <Card data-testid="card-total-value">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Project Value</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-total-value">
                  ${((data?.portfolioTotals.totalProjectValue || 0) / 1000000).toFixed(1)}M
                </div>
              </CardContent>
            </Card>

            <Card data-testid="card-total-pipeline">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Bid Pipeline</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-total-pipeline">
                  ${((data?.portfolioTotals.totalBidPipeline || 0) / 1000000).toFixed(1)}M
                </div>
              </CardContent>
            </Card>

            <Card data-testid="card-total-employees">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Employees</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-total-employees">
                  {data?.portfolioTotals.totalEmployees || 0}
                </div>
              </CardContent>
            </Card>

            <Card data-testid="card-total-cos">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Pending COs</CardTitle>
                <Activity className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-total-cos">
                  {data?.portfolioTotals.totalPendingCOs || 0}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Organization Comparison */}
          {data?.organizations && data.organizations.length > 0 ? (
            <Card className="mb-6" data-testid="card-org-comparison">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-primary" />
                  Organization Comparison
                </CardTitle>
                <CardDescription>
                  Side-by-side metrics comparison with performance rankings
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-3 font-medium">Organization</th>
                        <th className="text-center py-3 font-medium">Active Projects</th>
                        <th className="text-center py-3 font-medium">Bid Pipeline</th>
                        <th className="text-center py-3 font-medium">Employees</th>
                        <th className="text-center py-3 font-medium">Efficiency</th>
                        <th className="text-center py-3 font-medium">Pending COs</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.organizations.map((org) => (
                        <tr key={org.organizationId} className="border-b" data-testid={`row-benchmark-${org.organizationId}`}>
                          <td className="py-4">
                            <div className="flex items-center gap-3">
                              {org.logoUrl ? (
                                <img src={org.logoUrl} alt={org.name} className="h-8 w-8 rounded" />
                              ) : (
                                <Building2 className="h-8 w-8 text-muted-foreground" />
                              )}
                              <div>
                                <div className="font-medium">{org.name}</div>
                                <Badge variant="outline" className="text-xs mt-1">
                                  {org.tradeType.replace(/_/g, " ")}
                                </Badge>
                              </div>
                            </div>
                          </td>
                          <td className="text-center py-4">
                            <div className="space-y-2">
                              <div className="flex items-center justify-center gap-2">
                                <span className="font-semibold">{org.metrics.activeProjects}</span>
                                {getRankBadge(org.organizationId, data.rankings.byActiveProjects)}
                              </div>
                              <Progress
                                value={(org.metrics.activeProjects / getMaxValue(data.organizations, "activeProjects")) * 100}
                                className="h-2"
                              />
                            </div>
                          </td>
                          <td className="text-center py-4">
                            <div className="space-y-2">
                              <div className="flex items-center justify-center gap-2">
                                <span className="font-semibold">${(org.metrics.bidPipeline / 1000).toFixed(0)}K</span>
                                {getRankBadge(org.organizationId, data.rankings.byBidPipeline)}
                              </div>
                              <Progress
                                value={(org.metrics.bidPipeline / getMaxValue(data.organizations, "bidPipeline")) * 100}
                                className="h-2"
                              />
                            </div>
                          </td>
                          <td className="text-center py-4">
                            <div className="space-y-2">
                              <div className="flex items-center justify-center gap-2">
                                <span className="font-semibold">{org.metrics.employees}</span>
                                {getRankBadge(org.organizationId, data.rankings.byEmployees)}
                              </div>
                              <Progress
                                value={(org.metrics.employees / getMaxValue(data.organizations, "employees")) * 100}
                                className="h-2"
                              />
                            </div>
                          </td>
                          <td className="text-center py-4">
                            <div className="space-y-2">
                              <div className="flex items-center justify-center gap-2">
                                <span className="font-semibold">{org.metrics.projectsPerEmployee}</span>
                                {getRankBadge(org.organizationId, data.rankings.byEfficiency)}
                              </div>
                              <div className="text-xs text-muted-foreground">projects/employee</div>
                            </div>
                          </td>
                          <td className="text-center py-4">
                            <Badge variant={org.metrics.pendingChangeOrders > 3 ? "destructive" : "secondary"}>
                              {org.metrics.pendingChangeOrders}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-10 text-center">
                <Building2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">
                  No organizations linked yet. Add organizations to see benchmarking data.
                </p>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
