import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowDownLeft, ArrowUpRight, Wallet, TrendingUp, TrendingDown, Landmark, Lock } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useFeaturePermission } from "@/hooks/use-dashboard-customization";

interface CashPosition {
  accountsReceivable: number;
  accountsPayable: number;
  payrollLiability: number;
  netCashFlow: number;
}

function formatCurrency(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1000000) return `$${(abs / 1000000).toFixed(1)}M`;
  if (abs >= 1000) return `$${(abs / 1000).toFixed(1)}K`;
  return `$${abs.toFixed(0)}`;
}

function formatSignedCurrency(value: number): string {
  const formatted = formatCurrency(value);
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return formatted;
}

export function CashPositionWidget() {
  const hasPermission = useFeaturePermission("canAccessFinancials");

  const { data, isLoading } = useQuery<CashPosition>({
    queryKey: ["/api/dashboard/cash-position"],
    refetchInterval: 300000,
    enabled: hasPermission,
  });

  if (!hasPermission) {
    return (
      <Card data-testid="cash-position-no-permission">
        <CardHeader className="pb-2 px-4 pt-4">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">Cash Position</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <p className="text-sm text-muted-foreground text-center py-4">You don't have permission to view financial data.</p>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card data-testid="cash-position-loading">
        <CardHeader className="pb-2 px-4 pt-4">
          <div className="animate-pulse h-4 w-28 bg-muted rounded" />
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="animate-pulse rounded-lg bg-muted/50 p-3 space-y-2">
                <div className="h-3 w-16 bg-muted rounded" />
                <div className="h-6 w-14 bg-muted rounded" />
                <div className="h-2.5 w-20 bg-muted rounded" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const pos = data || { accountsReceivable: 0, accountsPayable: 0, payrollLiability: 0, netCashFlow: 0 };
  const isPositive = pos.netCashFlow >= 0;

  const metrics = [
    {
      key: "ar",
      label: "Receivable",
      value: pos.accountsReceivable,
      formatted: formatCurrency(pos.accountsReceivable),
      subtitle: "outstanding invoices",
      icon: ArrowDownLeft,
      iconColor: "text-green-600 dark:text-green-400",
      bg: "bg-green-500/10",
    },
    {
      key: "ap",
      label: "Payable",
      value: pos.accountsPayable,
      formatted: formatCurrency(pos.accountsPayable),
      subtitle: "owed to vendors",
      icon: ArrowUpRight,
      iconColor: "text-orange-600 dark:text-orange-400",
      bg: "bg-orange-500/10",
    },
    {
      key: "payroll",
      label: "Payroll",
      value: pos.payrollLiability,
      formatted: formatCurrency(pos.payrollLiability),
      subtitle: "pending pay runs",
      icon: Wallet,
      iconColor: "text-yellow-600 dark:text-yellow-500",
      bg: "bg-yellow-500/10",
    },
    {
      key: "net",
      label: "Net Cash Flow",
      value: pos.netCashFlow,
      formatted: formatSignedCurrency(pos.netCashFlow),
      subtitle: "AR - AP - payroll",
      icon: isPositive ? TrendingUp : TrendingDown,
      iconColor: isPositive ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400",
      bg: isPositive ? "bg-green-500/10" : "bg-red-500/10",
    },
  ];

  return (
    <Card data-testid="cash-position-widget">
      <CardHeader className="pb-2 px-4 pt-4">
        <div className="flex items-center gap-2">
          <Landmark className="w-4 h-4 text-muted-foreground" />
          <CardTitle className="text-sm font-medium">Cash Position</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="grid grid-cols-2 gap-3">
          {metrics.map((metric) => {
            const Icon = metric.icon;
            return (
              <div
                key={metric.key}
                className={cn("rounded-lg p-3 transition-colors", metric.bg)}
                data-testid={`metric-${metric.key}`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <Icon className={cn("w-3.5 h-3.5", metric.iconColor)} />
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">{metric.label}</span>
                </div>
                <p className={cn("text-xl font-bold tabular-nums", metric.iconColor)}>
                  {metric.formatted}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{metric.subtitle}</p>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
