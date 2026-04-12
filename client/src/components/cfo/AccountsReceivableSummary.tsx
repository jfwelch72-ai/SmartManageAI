import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { DollarSign, Clock, AlertTriangle, TrendingUp, Receipt } from "lucide-react";

interface ARSummaryData {
  totalOutstanding: number;
  totalOverdue: number;
  totalReceivedYTD: number;
  collectionRate: number;
  aging: {
    current: number;
    thirtyDay: number;
    sixtyDay: number;
    ninetyDay: number;
    ninetyPlus: number;
  };
  invoices: Array<{
    invoiceId: string;
    invoiceType: string;
    invoiceNumber: string;
    projectId: string;
    projectName: string;
    totalAmount: number;
    paidAmount: number;
    outstandingAmount: number;
    dueDate: string;
    daysOverdue: number;
    isOverdue: boolean;
    status: string;
  }>;
  invoiceCount: number;
  overdueCount: number;
}

interface AccountsReceivableSummaryProps {
  formatCurrency: (amount: number) => string;
}

export function AccountsReceivableSummary({ formatCurrency }: AccountsReceivableSummaryProps) {
  const { data, isLoading } = useQuery<ARSummaryData>({
    queryKey: ["/api/payments/ar-summary"],
  });

  if (isLoading) {
    return <Skeleton className="h-64 w-full mt-6" data-testid="skeleton-ar-summary" />;
  }

  if (!data) return null;

  const agingTotal = data.aging.current + data.aging.thirtyDay + data.aging.sixtyDay + data.aging.ninetyDay + data.aging.ninetyPlus;

  return (
    <Card className="mt-6" data-testid="card-ar-summary">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Receipt className="w-5 h-5 text-primary" />
          <CardTitle>Accounts Receivable</CardTitle>
        </div>
        <CardDescription>Outstanding invoices and payment collection across all billing types</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <div className="p-3 rounded-lg border bg-card text-center">
            <p className="text-sm text-muted-foreground flex items-center justify-center gap-1">
              <DollarSign className="w-3 h-3" />
              Outstanding
            </p>
            <p className="text-2xl font-bold font-mono" data-testid="text-ar-outstanding">
              {formatCurrency(data.totalOutstanding)}
            </p>
            <p className="text-xs text-muted-foreground">{data.invoiceCount} invoice{data.invoiceCount !== 1 ? 's' : ''}</p>
          </div>
          <div className="p-3 rounded-lg border bg-card text-center">
            <p className="text-sm text-muted-foreground flex items-center justify-center gap-1">
              <AlertTriangle className="w-3 h-3 text-red-500" />
              Overdue
            </p>
            <p className={`text-2xl font-bold font-mono ${data.totalOverdue > 0 ? 'text-red-600 dark:text-red-400' : ''}`} data-testid="text-ar-overdue">
              {formatCurrency(data.totalOverdue)}
            </p>
            <p className="text-xs text-muted-foreground">{data.overdueCount} overdue</p>
          </div>
          <div className="p-3 rounded-lg border bg-card text-center">
            <p className="text-sm text-muted-foreground flex items-center justify-center gap-1">
              <TrendingUp className="w-3 h-3 text-green-500" />
              Received YTD
            </p>
            <p className="text-2xl font-bold font-mono text-green-600 dark:text-green-400" data-testid="text-ar-received">
              {formatCurrency(data.totalReceivedYTD)}
            </p>
          </div>
          <div className="p-3 rounded-lg border bg-card text-center">
            <p className="text-sm text-muted-foreground flex items-center justify-center gap-1">
              <Clock className="w-3 h-3" />
              Collection Rate
            </p>
            <p className="text-2xl font-bold" data-testid="text-ar-collection-rate">
              {data.collectionRate.toFixed(1)}%
            </p>
          </div>
        </div>

        {agingTotal > 0 && (
          <div className="mb-6">
            <p className="text-sm font-medium mb-3">Aging Buckets</p>
            <div className="grid grid-cols-5 gap-2">
              <div className="p-2 rounded border text-center" data-testid="aging-current">
                <p className="text-xs text-muted-foreground">Current</p>
                <p className="text-sm font-bold font-mono">{formatCurrency(data.aging.current)}</p>
              </div>
              <div className="p-2 rounded border text-center border-yellow-300 dark:border-yellow-700" data-testid="aging-30day">
                <p className="text-xs text-yellow-600 dark:text-yellow-400">1-30 Days</p>
                <p className="text-sm font-bold font-mono text-yellow-600 dark:text-yellow-400">{formatCurrency(data.aging.thirtyDay)}</p>
              </div>
              <div className="p-2 rounded border text-center border-orange-300 dark:border-orange-700" data-testid="aging-60day">
                <p className="text-xs text-orange-600 dark:text-orange-400">31-60 Days</p>
                <p className="text-sm font-bold font-mono text-orange-600 dark:text-orange-400">{formatCurrency(data.aging.sixtyDay)}</p>
              </div>
              <div className="p-2 rounded border text-center border-orange-400 dark:border-orange-600" data-testid="aging-90day">
                <p className="text-xs text-orange-700 dark:text-orange-300">61-90 Days</p>
                <p className="text-sm font-bold font-mono text-orange-700 dark:text-orange-300">{formatCurrency(data.aging.ninetyDay)}</p>
              </div>
              <div className="p-2 rounded border text-center border-red-300 dark:border-red-700" data-testid="aging-90plus">
                <p className="text-xs text-red-600 dark:text-red-400">90+ Days</p>
                <p className="text-sm font-bold font-mono text-red-600 dark:text-red-400">{formatCurrency(data.aging.ninetyPlus)}</p>
              </div>
            </div>

            {agingTotal > 0 && (
              <div className="mt-2 h-3 rounded-full overflow-hidden bg-muted flex" data-testid="aging-bar">
                {data.aging.current > 0 && (
                  <div
                    className="bg-green-500 h-full"
                    style={{ width: `${(data.aging.current / agingTotal) * 100}%` }}
                    title={`Current: ${formatCurrency(data.aging.current)}`}
                  />
                )}
                {data.aging.thirtyDay > 0 && (
                  <div
                    className="bg-yellow-500 h-full"
                    style={{ width: `${(data.aging.thirtyDay / agingTotal) * 100}%` }}
                    title={`1-30 Days: ${formatCurrency(data.aging.thirtyDay)}`}
                  />
                )}
                {data.aging.sixtyDay > 0 && (
                  <div
                    className="bg-orange-500 h-full"
                    style={{ width: `${(data.aging.sixtyDay / agingTotal) * 100}%` }}
                    title={`31-60 Days: ${formatCurrency(data.aging.sixtyDay)}`}
                  />
                )}
                {data.aging.ninetyDay > 0 && (
                  <div
                    className="bg-orange-600 h-full"
                    style={{ width: `${(data.aging.ninetyDay / agingTotal) * 100}%` }}
                    title={`61-90 Days: ${formatCurrency(data.aging.ninetyDay)}`}
                  />
                )}
                {data.aging.ninetyPlus > 0 && (
                  <div
                    className="bg-red-500 h-full"
                    style={{ width: `${(data.aging.ninetyPlus / agingTotal) * 100}%` }}
                    title={`90+ Days: ${formatCurrency(data.aging.ninetyPlus)}`}
                  />
                )}
              </div>
            )}
          </div>
        )}

        {data.invoices.length > 0 && (
          <div>
            <p className="text-sm font-medium mb-2">Outstanding Invoices</p>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {data.invoices.slice(0, 10).map((inv) => (
                <div
                  key={`${inv.invoiceType}-${inv.invoiceId}`}
                  className="flex items-center justify-between p-2 rounded border text-sm"
                  data-testid={`row-ar-invoice-${inv.invoiceId}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{inv.invoiceNumber}</span>
                      <Badge variant="outline" className="text-xs shrink-0">
                        {inv.invoiceType === "AIA_PAY_APP" ? "AIA" : inv.invoiceType === "TM_INVOICE" ? "T&M" : "General"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{inv.projectName}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="font-mono font-medium">{formatCurrency(inv.outstandingAmount)}</span>
                    {inv.isOverdue ? (
                      <Badge variant="destructive" className="text-xs" data-testid={`badge-overdue-${inv.invoiceId}`}>
                        {inv.daysOverdue}d overdue
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs text-green-600 border-green-300 dark:text-green-400 dark:border-green-700">
                        Current
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
              {data.invoices.length > 10 && (
                <p className="text-xs text-muted-foreground text-center pt-1">
                  +{data.invoices.length - 10} more invoices
                </p>
              )}
            </div>
          </div>
        )}

        {data.invoices.length === 0 && data.totalReceivedYTD === 0 && (
          <div className="text-center text-muted-foreground py-4">
            <Receipt className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No outstanding invoices or payments recorded yet</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
