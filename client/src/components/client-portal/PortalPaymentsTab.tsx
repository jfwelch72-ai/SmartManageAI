import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Receipt, ExternalLink, CheckCircle } from "lucide-react";
import { format } from "date-fns";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";
import { useToast } from "@/hooks/use-toast";

interface PaymentItem {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  total: string;
  subtotal: string;
  taxAmount: string | null;
  status: string;
  sentAt: string | null;
  paidAt: string | null;
  pdfUrl: string | null;
}

interface PayApplicationItem {
  id: string;
  applicationNumber: number;
  periodTo: string | null;
  totalCompletedAndStored: string | null;
  currentPaymentDue: string | null;
  status: string;
  submittedAt: string | null;
  approvedAt: string | null;
}

interface PortalPaymentsTabProps {
  payments: PaymentItem[] | undefined;
  payApplications?: PayApplicationItem[];
  projectId?: string;
  email?: string;
  onApproved?: () => void;
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  SENT:    { label: "Sent",    className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  PAID:    { label: "Paid",    className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  OVERDUE: { label: "Overdue", className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  VOID:    { label: "Void",    className: "bg-gray-100 text-gray-500 dark:bg-gray-800/30 dark:text-gray-400" },
};

const PAY_APP_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  SUBMITTED: { label: "Submitted", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  APPROVED:  { label: "Approved",  className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  REJECTED:  { label: "Rejected",  className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  PAID:      { label: "Paid",      className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
};

const CHART_COLORS: Record<string, string> = {
  paid: "#22c55e",
  outstanding: "#3b82f6",
  overdue: "#ef4444",
};

function fmtCurrency(amount: string | null | undefined): string {
  if (!amount) return "—";
  const num = parseFloat(amount);
  if (isNaN(num)) return amount;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(num);
}

function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try { return format(new Date(dateStr), "MMM d, yyyy"); } catch { return "—"; }
}

export function PortalPaymentsTab({ payments, payApplications, projectId, email, onApproved }: PortalPaymentsTabProps) {
  const { toast } = useToast();
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [localStatuses, setLocalStatuses] = useState<Record<string, string>>({});

  const totalPaid = payments
    ?.filter((p) => p.status === "PAID")
    .reduce((sum, p) => sum + parseFloat(p.total || "0"), 0) ?? 0;

  const totalOutstanding = payments
    ?.filter((p) => p.status === "SENT")
    .reduce((sum, p) => sum + parseFloat(p.total || "0"), 0) ?? 0;

  const totalOverdue = payments
    ?.filter((p) => p.status === "OVERDUE")
    .reduce((sum, p) => sum + parseFloat(p.total || "0"), 0) ?? 0;

  const chartData = [
    { name: "Paid", value: totalPaid, color: CHART_COLORS.paid },
    { name: "Outstanding", value: totalOutstanding, color: CHART_COLORS.outstanding },
    { name: "Overdue", value: totalOverdue, color: CHART_COLORS.overdue },
  ].filter((d) => d.value > 0);

  async function handleApprovePayApp(payAppId: string) {
    if (!projectId || !email) return;
    setApprovingId(payAppId);
    try {
      const res = await fetch(`/api/ai-features/client-portal/public/pay-apps/${payAppId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, email }),
      });
      if (!res.ok) throw new Error("Approval failed");
      setLocalStatuses((prev) => ({ ...prev, [payAppId]: "APPROVED" }));
      toast({ title: "Pay application approved" });
      onApproved?.();
    } catch {
      toast({ title: "Failed to approve pay application", variant: "destructive" });
    } finally {
      setApprovingId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* AIA Pay Applications */}
      {payApplications && payApplications.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>AIA Pay Applications</CardTitle>
            <CardDescription>Submitted pay applications awaiting your review and approval</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>App #</TableHead>
                  <TableHead>Period To</TableHead>
                  <TableHead>Total Completed</TableHead>
                  <TableHead>Current Due</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[120px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payApplications.map((app) => {
                  const effectiveStatus = localStatuses[app.id] ?? app.status;
                  const statusCfg = PAY_APP_STATUS_CONFIG[effectiveStatus] || { label: effectiveStatus, className: "bg-gray-100 text-gray-700" };
                  const isApproved = effectiveStatus === "APPROVED";
                  return (
                    <TableRow key={app.id} data-testid={`row-pay-app-${app.id}`}>
                      <TableCell className="font-medium">#{app.applicationNumber}</TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {fmtDate(app.periodTo)}
                      </TableCell>
                      <TableCell className="font-medium whitespace-nowrap">
                        {fmtCurrency(app.totalCompletedAndStored)}
                      </TableCell>
                      <TableCell className="font-medium whitespace-nowrap">
                        {fmtCurrency(app.currentPaymentDue)}
                      </TableCell>
                      <TableCell>
                        <Badge className={statusCfg.className} variant="outline" data-testid={`badge-pay-app-status-${app.id}`}>
                          {statusCfg.label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {!isApproved && effectiveStatus === "SUBMITTED" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-green-700 border-green-300 hover:bg-green-50"
                            disabled={approvingId === app.id}
                            onClick={() => handleApprovePayApp(app.id)}
                            data-testid={`button-approve-pay-app-${app.id}`}
                          >
                            <CheckCircle className="w-3.5 h-3.5 mr-1" />
                            {approvingId === app.id ? "Approving…" : "Approve"}
                          </Button>
                        )}
                        {isApproved && (
                          <span className="text-xs text-green-600 font-medium">
                            {fmtDate(app.approvedAt)}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* T&M Invoices */}
      <Card>
        <CardHeader>
          <CardTitle>Invoices & Payments</CardTitle>
          <CardDescription>T&M invoices and payment status for this project</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {payments && payments.length > 0 ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground mb-1">Total Paid</p>
                    <p className="text-lg font-semibold text-green-600 dark:text-green-400" data-testid="text-total-paid">
                      {fmtCurrency(String(totalPaid))}
                    </p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground mb-1">Outstanding</p>
                    <p className="text-lg font-semibold text-blue-600 dark:text-blue-400" data-testid="text-total-outstanding">
                      {fmtCurrency(String(totalOutstanding))}
                    </p>
                  </div>
                  <div className="rounded-lg border p-3 col-span-2">
                    <p className="text-xs text-muted-foreground mb-1">Overdue</p>
                    <p className="text-lg font-semibold text-red-600 dark:text-red-400" data-testid="text-total-overdue">
                      {fmtCurrency(String(totalOverdue))}
                    </p>
                  </div>
                </div>

                {chartData.length > 0 && (
                  <div className="h-[180px]" data-testid="payments-pie-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={chartData}
                          cx="50%"
                          cy="50%"
                          innerRadius={40}
                          outerRadius={65}
                          dataKey="value"
                          paddingAngle={2}
                          strokeWidth={0}
                        >
                          {chartData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "8px",
                            color: "hsl(var(--foreground))",
                          }}
                          formatter={(value: number) => [fmtCurrency(String(value))]}
                        />
                        <Legend
                          formatter={(value: string) => (
                            <span className="text-xs text-foreground">{value}</span>
                          )}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              <ScrollArea className="max-h-[420px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice #</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Due</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Paid On</TableHead>
                      <TableHead className="w-[60px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.map((inv) => {
                      const statusCfg = STATUS_CONFIG[inv.status] || { label: inv.status, className: "bg-gray-100 text-gray-700" };
                      return (
                        <TableRow key={inv.id} data-testid={`row-invoice-${inv.id}`}>
                          <TableCell className="font-medium">{inv.invoiceNumber}</TableCell>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                            {fmtDate(inv.invoiceDate)}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                            {fmtDate(inv.dueDate)}
                          </TableCell>
                          <TableCell className="font-medium whitespace-nowrap">
                            {fmtCurrency(inv.total)}
                          </TableCell>
                          <TableCell>
                            <Badge className={statusCfg.className} variant="outline">
                              {statusCfg.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                            {fmtDate(inv.paidAt)}
                          </TableCell>
                          <TableCell>
                            {inv.pdfUrl && (
                              <Button variant="ghost" size="icon" asChild data-testid={`button-view-invoice-${inv.id}`}>
                                <a href={inv.pdfUrl} target="_blank" rel="noopener noreferrer">
                                  <ExternalLink className="w-4 h-4" />
                                </a>
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </ScrollArea>
            </>
          ) : (
            <div className="text-center py-8">
              <Receipt className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-muted-foreground">No invoices available yet.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
