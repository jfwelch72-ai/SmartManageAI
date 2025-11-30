import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronLeft, Activity, FileText, Hammer, Clock, TrendingUp } from "lucide-react";
import { Link } from "wouter";
import { format } from "date-fns";
import { useAuth } from "@/hooks/use-auth";

interface PlatformAnalytics {
  weeklyActions: number;
  monthlyProjectsCreated: number;
  monthlyBidsCreated: number;
  monthlyShiftsLogged: number;
  recentActivity: Array<{
    id: string;
    action: string;
    entityType: string;
    entityId: string;
    userId: string;
    oldValue: string | null;
    newValue: string | null;
    createdAt: string;
  }>;
}

export default function PlatformAnalytics() {
  const { user, logout, organizationName } = useAuth();
  const { data: analytics, isLoading } = useQuery<PlatformAnalytics>({
    queryKey: ["/api/platform/analytics"],
  });

  const userName = user ? `${user.firstName} ${user.lastName}` : "Admin";
  const userRole = user?.role || "SUPER_ADMIN";

  const getActionBadge = (action: string) => {
    switch (action) {
      case "CREATE":
        return <Badge variant="default">Created</Badge>;
      case "UPDATE":
        return <Badge variant="secondary">Updated</Badge>;
      case "DELETE":
        return <Badge variant="destructive">Deleted</Badge>;
      default:
        return <Badge variant="outline">{action}</Badge>;
    }
  };

  const formatEntityType = (type: string) => {
    return type
      .replace(/_/g, " ")
      .toLowerCase()
      .replace(/\b\w/g, (l) => l.toUpperCase());
  };

  return (
    <div className="min-h-screen bg-background">
      <main className="p-6 space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/admin">
            <Button variant="ghost" size="sm">
              <ChevronLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-analytics-title">Platform Analytics</h1>
            <p className="text-muted-foreground">Usage metrics and activity across all organizations</p>
          </div>
        </div>

        {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-4" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Weekly Actions</CardTitle>
                <Activity className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-weekly-actions">
                  {analytics?.weeklyActions || 0}
                </div>
                <p className="text-xs text-muted-foreground">Last 7 days</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Projects Created</CardTitle>
                <Hammer className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-monthly-projects">
                  {analytics?.monthlyProjectsCreated || 0}
                </div>
                <p className="text-xs text-muted-foreground">Last 30 days</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Bids Created</CardTitle>
                <FileText className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-monthly-bids">
                  {analytics?.monthlyBidsCreated || 0}
                </div>
                <p className="text-xs text-muted-foreground">Last 30 days</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Shifts Logged</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-monthly-shifts">
                  {analytics?.monthlyShiftsLogged || 0}
                </div>
                <p className="text-xs text-muted-foreground">Last 30 days</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Recent Activity
              </CardTitle>
              <CardDescription>Latest actions across all organizations</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Action</TableHead>
                    <TableHead>Entity Type</TableHead>
                    <TableHead>Entity ID</TableHead>
                    <TableHead>Timestamp</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {analytics?.recentActivity?.slice(0, 20).map((activity) => (
                    <TableRow key={activity.id} data-testid={`row-activity-${activity.id}`}>
                      <TableCell>{getActionBadge(activity.action)}</TableCell>
                      <TableCell>{formatEntityType(activity.entityType)}</TableCell>
                      <TableCell className="font-mono text-sm">{activity.entityId.slice(0, 8)}...</TableCell>
                      <TableCell>
                        {format(new Date(activity.createdAt), "MMM d, yyyy h:mm a")}
                      </TableCell>
                    </TableRow>
                  ))}
                  {(!analytics?.recentActivity || analytics.recentActivity.length === 0) && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                        No recent activity
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
      </main>
    </div>
  );
}
