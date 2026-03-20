import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Receipt, ExternalLink } from "lucide-react";
import { format } from "date-fns";

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

interface PortalPaymentsTabProps {
  payments: PaymentItem[] | undefined;
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  SENT:    { label: "Sent",    className: "bg-blue-100 text-blue-700" },
  PAID:    { label: "Paid",    className: "bg-green-100 text-green-700" },
  OVERDUE: { label: "Overdue", className: "bg-red-100 text-red-700" },
  VOID:    { label: "Void",    className: "bg-gray-100 text-gray-500" },
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

export function PortalPaymentsTab({ payments }: PortalPaymentsTabProps) {
  const totalPaid = payments
    ?.filter((p) => p.status === "PAID")
    .reduce((sum, p) => sum + parseFloat(p.total || "0"), 0) ?? 0;

  const totalOutstanding = payments
    ?.filter((p) => p.status === "SENT" || p.status === "OVERDUE")
    .reduce((sum, p) => sum + parseFloat(p.total || "0"), 0) ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invoices & Payments</CardTitle>
        <CardDescription>T&M invoices and payment status for this project</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {payments && payments.length > 0 ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground mb-1">Total Paid</p>
                <p className="text-lg font-semibold text-green-600" data-testid="text-total-paid">
                  {fmtCurrency(String(totalPaid))}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground mb-1">Outstanding</p>
                <p className="text-lg font-semibold text-orange-600" data-testid="text-total-outstanding">
                  {fmtCurrency(String(totalOutstanding))}
                </p>
              </div>
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
  );
}
