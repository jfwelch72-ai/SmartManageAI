import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertCircle,
  AlertTriangle,
  CalendarClock,
  DollarSign,
  CheckCircle2,
  CloudRain,
} from "lucide-react";
import { useLocation } from "wouter";
import { useDashboardStats, useProjects } from "@/hooks/use-data";

export function OutstandingItemsWidget() {
  const [, setLocation] = useLocation();
  const { data: stats } = useDashboardStats();
  const { data: projects = [] } = useProjects();

  const projectsMissingBudget = projects.filter((p) => {
    const budgetNum = Number(p.budget);
    return !p.budget || isNaN(budgetNum) || budgetNum <= 0;
  });

  return (
    <Card className="h-full" data-testid="card-outstanding-items">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          Outstanding Items
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {stats?.pendingChangeOrdersCount ? (
            <div
              className="flex items-center justify-between p-2 rounded-md hover-elevate cursor-pointer"
              onClick={() => setLocation("/projects?changeOrders=pending")}
              data-testid="outstanding-change-orders"
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-yellow-500" />
                <span className="text-sm">Pending Change Orders</span>
              </div>
              <Badge variant="secondary">
                {stats.pendingChangeOrdersCount}
              </Badge>
            </div>
          ) : null}

          {stats?.pendingTimeOffCount ? (
            <div
              className="flex items-center justify-between p-2 rounded-md hover-elevate cursor-pointer"
              onClick={() => setLocation("/calendar?view=timeoff")}
              data-testid="outstanding-timeoff"
            >
              <div className="flex items-center gap-2">
                <CalendarClock className="w-4 h-4 text-blue-500" />
                <span className="text-sm">Time-Off Requests</span>
              </div>
              <Badge variant="secondary">{stats.pendingTimeOffCount}</Badge>
            </div>
          ) : null}

          {projectsMissingBudget.length > 0 && (
            <div
              className="flex items-center justify-between p-2 rounded-md hover-elevate cursor-pointer"
              onClick={() => setLocation("/projects?filter=missingBudget")}
              data-testid="outstanding-missing-budget"
            >
              <div className="flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-orange-500" />
                <span className="text-sm">Missing Budget Data</span>
              </div>
              <Badge variant="secondary">{projectsMissingBudget.length}</Badge>
            </div>
          )}

          {stats?.delaysNeedingAckCount ? (
            <div
              className="flex items-center justify-between p-2 rounded-md hover-elevate cursor-pointer"
              onClick={() => setLocation("/projects?filter=delaysNeedingAck")}
              data-testid="outstanding-delays-ack"
            >
              <div className="flex items-center gap-2">
                <CloudRain className="w-4 h-4 text-blue-500" />
                <span className="text-sm">Delays Awaiting Acknowledgment</span>
              </div>
              <Badge variant="secondary">
                {stats.delaysNeedingAckCount}
              </Badge>
            </div>
          ) : null}

          {stats?.delaysNeedingChangeOrderCount ? (
            <div
              className="flex items-center justify-between p-2 rounded-md hover-elevate cursor-pointer"
              onClick={() => setLocation("/projects?filter=delaysNeedingCO")}
              data-testid="outstanding-delays-co"
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-500" />
                <span className="text-sm">Delays Needing Change Order</span>
              </div>
              <Badge variant="secondary">
                {stats.delaysNeedingChangeOrderCount}
              </Badge>
            </div>
          ) : null}

          {!stats?.pendingChangeOrdersCount &&
            !stats?.pendingTimeOffCount &&
            projectsMissingBudget.length === 0 &&
            !stats?.delaysNeedingAckCount &&
            !stats?.delaysNeedingChangeOrderCount && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                All caught up! No outstanding items.
              </div>
            )}
        </div>
      </CardContent>
    </Card>
  );
}
