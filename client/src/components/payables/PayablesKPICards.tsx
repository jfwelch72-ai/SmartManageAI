import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock, CheckCircle2, Banknote } from "lucide-react";

interface PayableSummary {
  pending: { count: number; total: number };
  approved: { count: number; total: number };
  paid: { count: number; total: number };
  rejected: { count: number; total: number };
  totalPayables: number;
}

interface PayablesKPICardsProps {
  summary: PayableSummary | undefined;
  formatCurrency: (amount: string | number) => string;
}

export function PayablesKPICards({ summary, formatCurrency }: PayablesKPICardsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
      <Card data-testid="card-pending-payables">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Clock className="w-4 h-4 text-yellow-500" />
            Pending Approval
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatCurrency(summary?.pending.total || 0)}</div>
          <p className="text-xs text-muted-foreground mt-1">
            {summary?.pending.count || 0} invoice{summary?.pending.count !== 1 ? 's' : ''}
          </p>
        </CardContent>
      </Card>

      <Card data-testid="card-approved-payables">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-blue-500" />
            Approved (Unpaid)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatCurrency(summary?.approved.total || 0)}</div>
          <p className="text-xs text-muted-foreground mt-1">
            {summary?.approved.count || 0} payment{summary?.approved.count !== 1 ? 's' : ''}
          </p>
        </CardContent>
      </Card>

      <Card data-testid="card-paid-payables">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Banknote className="w-4 h-4 text-green-500" />
            Total Paid (All Time)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-green-500">{formatCurrency(summary?.paid.total || 0)}</div>
          <p className="text-xs text-muted-foreground mt-1">
            {summary?.paid.count || 0} payment{summary?.paid.count !== 1 ? 's' : ''}
          </p>
        </CardContent>
      </Card>

      <Card data-testid="card-total-outstanding">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Total Outstanding</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-500">
            {formatCurrency((summary?.pending.total || 0) + (summary?.approved.total || 0))}
          </div>
          <p className="text-xs text-muted-foreground mt-1">Pending + Approved</p>
        </CardContent>
      </Card>
    </div>
  );
}
