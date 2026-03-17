import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, AlertCircle, Info, Shield, DollarSign, Clock, CreditCard, TrendingDown, CheckCircle2, ExternalLink } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";

interface AlertItem {
  id: string;
  type: "INSURANCE_EXPIRING" | "OVER_BUDGET" | "UNAPPROVED_TIME" | "LATE_SUB_PAYMENT" | "LOW_MARGIN";
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
  entityId?: string;
  link?: string;
}

interface AlertsResponse {
  alerts: AlertItem[];
  counts: { critical: number; warning: number; info: number };
}

const SEVERITY_STYLES: Record<string, { icon: typeof AlertCircle; bg: string; text: string; border: string }> = {
  critical: {
    icon: AlertCircle,
    bg: "bg-red-500/10",
    text: "text-red-700 dark:text-red-400",
    border: "border-red-200 dark:border-red-800/50",
  },
  warning: {
    icon: AlertTriangle,
    bg: "bg-yellow-500/10",
    text: "text-yellow-700 dark:text-yellow-500",
    border: "border-yellow-200 dark:border-yellow-800/50",
  },
  info: {
    icon: Info,
    bg: "bg-blue-500/10",
    text: "text-blue-700 dark:text-blue-400",
    border: "border-blue-200 dark:border-blue-800/50",
  },
};

const TYPE_ICONS: Record<string, typeof Shield> = {
  INSURANCE_EXPIRING: Shield,
  OVER_BUDGET: DollarSign,
  UNAPPROVED_TIME: Clock,
  LATE_SUB_PAYMENT: CreditCard,
  LOW_MARGIN: TrendingDown,
};

const TYPE_LINKS: Record<string, string> = {
  INSURANCE_EXPIRING: "/crm",
  OVER_BUDGET: "/projects",
  UNAPPROVED_TIME: "/time-entry",
  LATE_SUB_PAYMENT: "/subcontracts",
  LOW_MARGIN: "/projects",
};

export function AlertsWidget() {
  const [, setLocation] = useLocation();
  const { data, isLoading, isError } = useQuery<AlertsResponse>({
    queryKey: ["/api/dashboard/alerts"],
    refetchInterval: 300000,
  });

  if (isLoading) {
    return (
      <Card data-testid="alerts-widget-loading">
        <CardHeader className="pb-2 px-4 pt-4">
          <Skeleton className="h-4 w-24" />
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex gap-3 items-start py-2.5 px-3 rounded-md">
              <Skeleton className="h-4 w-4 rounded-full shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-3/4" />
                <Skeleton className="h-3 w-full" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card data-testid="alerts-widget-error">
        <CardContent className="flex flex-col items-center justify-center py-8 text-center">
          <AlertCircle className="w-6 h-6 text-destructive mb-2" />
          <p className="text-sm text-muted-foreground">Failed to load alerts.</p>
        </CardContent>
      </Card>
    );
  }

  const alerts = data?.alerts || [];
  const counts = data?.counts || { critical: 0, warning: 0, info: 0 };
  const totalAlerts = counts.critical + counts.warning + counts.info;

  return (
    <Card data-testid="alerts-widget">
      <CardHeader className="pb-2 px-4 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">Alerts</CardTitle>
          </div>
          <div className="flex items-center gap-1.5">
            {counts.critical > 0 && (
              <Badge variant="secondary" className="text-[10px] bg-red-500/10 text-red-700 dark:text-red-400" data-testid="badge-alerts-critical">
                {counts.critical} Critical
              </Badge>
            )}
            {counts.warning > 0 && (
              <Badge variant="secondary" className="text-[10px] bg-yellow-500/10 text-yellow-700 dark:text-yellow-500" data-testid="badge-alerts-warning">
                {counts.warning} Warning
              </Badge>
            )}
            {totalAlerts === 0 && (
              <Badge variant="secondary" className="text-[10px]" data-testid="badge-alerts-clear">
                All Clear
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {alerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground" data-testid="alerts-widget-empty">
            <CheckCircle2 className="w-8 h-8 mb-2 text-green-500 opacity-70" />
            <p className="text-sm font-medium">All Clear</p>
            <p className="text-xs mt-1">No active alerts at this time</p>
          </div>
        ) : (
          <div className="space-y-1 max-h-[400px] overflow-y-auto" data-testid="alerts-widget-items">
            {alerts.map((alert) => {
              const severity = SEVERITY_STYLES[alert.severity] || SEVERITY_STYLES.info;
              const SeverityIcon = severity.icon;
              const TypeIcon = TYPE_ICONS[alert.type] || AlertTriangle;
              const navTarget = alert.link || TYPE_LINKS[alert.type];

              return (
                <div
                  key={alert.id}
                  className={cn(
                    "flex items-start gap-3 py-2.5 px-3 rounded-md border",
                    severity.bg,
                    severity.border,
                    "transition-colors",
                    navTarget ? "cursor-pointer hover:opacity-80" : ""
                  )}
                  onClick={navTarget ? () => setLocation(navTarget) : undefined}
                  data-testid={`alert-item-${alert.id}`}
                >
                  <SeverityIcon className={cn("w-4 h-4 shrink-0 mt-0.5", severity.text)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className={cn("text-sm font-medium", severity.text)}>{alert.title}</p>
                      <TypeIcon className="w-3 h-3 text-muted-foreground shrink-0" />
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{alert.description}</p>
                  </div>
                  {navTarget && (
                    <ExternalLink className={cn("w-3.5 h-3.5 shrink-0 mt-0.5 opacity-50", severity.text)} />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
