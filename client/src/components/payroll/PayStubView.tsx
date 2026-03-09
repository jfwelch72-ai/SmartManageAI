import { useState, Fragment } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { useIsMobile } from "@/hooks/use-mobile";
import { useQuery } from "@tanstack/react-query";
import { FileText, Printer, ChevronLeft, DollarSign } from "lucide-react";

interface PayStubEarning {
  projectName: string;
  regularHours: number;
  regularRate: number;
  regularPay: number;
  overtimeHours: number;
  overtimeRate: number;
  overtimePay: number;
  grossAmount: number;
}

interface PayStubDeduction {
  deductionTypeId: string;
  name: string;
  category: string;
  isPreTax: boolean;
  amount: number;
  ytdAmount: number;
}

interface PayStub {
  userId: string;
  employeeName: string;
  employeeEmail: string;
  payPeriodStart: string;
  payPeriodEnd: string;
  payRunNumber: string | null;
  earnings: PayStubEarning[];
  deductions: PayStubDeduction[];
  totalGross: number;
  totalDeductions: number;
  netPay: number;
}

const formatCurrency = (val: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val || 0);

export default function PayStubView({ payRunId, payRunNumber }: { payRunId: string; payRunNumber: string | null }) {
  const isMobile = useIsMobile();
  const [selectedStub, setSelectedStub] = useState<PayStub | null>(null);
  const [stubDetailOpen, setStubDetailOpen] = useState(false);

  const { data: payStubs, isLoading } = useQuery<PayStub[]>({
    queryKey: ["/api/payroll/pay-runs", payRunId, "pay-stubs"],
    enabled: !!payRunId,
  });

  const printPayStub = (stub: PayStub) => {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`
      <html><head><title>Pay Stub - ${stub.employeeName}</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 700px; margin: 20px auto; padding: 20px; }
        table { width: 100%; border-collapse: collapse; margin: 10px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 13px; }
        th { background: #f5f5f5; font-weight: 600; }
        .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 15px; }
        .section-title { font-weight: bold; font-size: 14px; margin: 15px 0 5px; }
        .totals { font-weight: bold; font-size: 15px; }
        .net-pay { font-size: 18px; color: #16a34a; font-weight: bold; text-align: right; margin-top: 15px; padding: 10px; border: 2px solid #16a34a; border-radius: 6px; }
        @media print { button { display: none; } }
      </style></head><body>
      <div class="header">
        <h2 style="margin:0">Pay Stub</h2>
        <p style="margin:5px 0">Pay Run: ${stub.payRunNumber || "N/A"}</p>
        <p style="margin:5px 0">Period: ${stub.payPeriodStart} to ${stub.payPeriodEnd}</p>
      </div>
      <p><strong>Employee:</strong> ${stub.employeeName}</p>
      <p><strong>Email:</strong> ${stub.employeeEmail}</p>
      <div class="section-title">Earnings</div>
      <table>
        <thead><tr><th>Project</th><th>Reg Hrs</th><th>Reg Rate</th><th>Reg Pay</th><th>OT Hrs</th><th>OT Rate</th><th>OT Pay</th><th>Gross</th></tr></thead>
        <tbody>
          ${stub.earnings.map(e => `<tr><td>${e.projectName}</td><td>${e.regularHours}</td><td>$${e.regularRate.toFixed(2)}</td><td>$${e.regularPay.toFixed(2)}</td><td>${e.overtimeHours}</td><td>$${e.overtimeRate.toFixed(2)}</td><td>$${e.overtimePay.toFixed(2)}</td><td>$${e.grossAmount.toFixed(2)}</td></tr>`).join("")}
          <tr class="totals"><td colspan="7" style="text-align:right">Total Gross</td><td>$${stub.totalGross.toFixed(2)}</td></tr>
        </tbody>
      </table>
      ${stub.deductions.length > 0 ? `
        <div class="section-title">Deductions</div>
        <table>
          <thead><tr><th>Type</th><th>Pre-Tax</th><th>Amount</th><th>YTD</th></tr></thead>
          <tbody>
            ${stub.deductions.map(d => `<tr><td>${d.name}</td><td>${d.isPreTax ? "Yes" : "No"}</td><td>$${d.amount.toFixed(2)}</td><td>$${d.ytdAmount.toFixed(2)}</td></tr>`).join("")}
            <tr class="totals"><td colspan="2" style="text-align:right">Total Deductions</td><td>$${stub.totalDeductions.toFixed(2)}</td><td></td></tr>
          </tbody>
        </table>
      ` : ""}
      <div class="net-pay">Net Pay: $${stub.netPay.toFixed(2)}</div>
      <br><button onclick="window.print()" style="padding:8px 16px;cursor:pointer">Print</button>
      </body></html>
    `);
    w.document.close();
  };

  const printAll = () => {
    if (!payStubs?.length) return;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`
      <html><head><title>Pay Stubs - ${payRunNumber || "Pay Run"}</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 700px; margin: 20px auto; padding: 20px; }
        table { width: 100%; border-collapse: collapse; margin: 10px 0; }
        th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; font-size: 12px; }
        th { background: #f5f5f5; font-weight: 600; }
        .stub { page-break-after: always; border-bottom: 2px dashed #999; padding-bottom: 20px; margin-bottom: 20px; }
        .stub:last-child { page-break-after: auto; border-bottom: none; }
        .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 8px; margin-bottom: 12px; }
        .section-title { font-weight: bold; font-size: 13px; margin: 12px 0 4px; }
        .totals { font-weight: bold; }
        .net-pay { font-size: 16px; color: #16a34a; font-weight: bold; text-align: right; margin-top: 10px; padding: 8px; border: 2px solid #16a34a; border-radius: 4px; }
        @media print { button { display: none; } }
      </style></head><body>
      ${payStubs.map(stub => `
        <div class="stub">
          <div class="header">
            <h3 style="margin:0">Pay Stub</h3>
            <p style="margin:3px 0;font-size:12px">Pay Run: ${stub.payRunNumber || "N/A"} | Period: ${stub.payPeriodStart} to ${stub.payPeriodEnd}</p>
          </div>
          <p><strong>${stub.employeeName}</strong> (${stub.employeeEmail})</p>
          <div class="section-title">Earnings</div>
          <table>
            <thead><tr><th>Project</th><th>Reg</th><th>Rate</th><th>Pay</th><th>OT</th><th>Rate</th><th>Pay</th><th>Gross</th></tr></thead>
            <tbody>
              ${stub.earnings.map(e => `<tr><td>${e.projectName}</td><td>${e.regularHours}</td><td>$${e.regularRate.toFixed(2)}</td><td>$${e.regularPay.toFixed(2)}</td><td>${e.overtimeHours}</td><td>$${e.overtimeRate.toFixed(2)}</td><td>$${e.overtimePay.toFixed(2)}</td><td>$${e.grossAmount.toFixed(2)}</td></tr>`).join("")}
              <tr class="totals"><td colspan="7" style="text-align:right">Total Gross</td><td>$${stub.totalGross.toFixed(2)}</td></tr>
            </tbody>
          </table>
          ${stub.deductions.length > 0 ? `
            <div class="section-title">Deductions</div>
            <table>
              <thead><tr><th>Type</th><th>Pre-Tax</th><th>Amount</th><th>YTD</th></tr></thead>
              <tbody>
                ${stub.deductions.map(d => `<tr><td>${d.name}</td><td>${d.isPreTax ? "Yes" : "No"}</td><td>$${d.amount.toFixed(2)}</td><td>$${d.ytdAmount.toFixed(2)}</td></tr>`).join("")}
                <tr class="totals"><td colspan="2" style="text-align:right">Total Deductions</td><td>$${stub.totalDeductions.toFixed(2)}</td><td></td></tr>
              </tbody>
            </table>
          ` : ""}
          <div class="net-pay">Net Pay: $${stub.netPay.toFixed(2)}</div>
        </div>
      `).join("")}
      <button onclick="window.print()" style="padding:8px 16px;cursor:pointer">Print All</button>
      </body></html>
    `);
    w.document.close();
  };

  if (isLoading) {
    return <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div>;
  }

  if (!payStubs?.length) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <FileText className="w-10 h-10 mx-auto mb-3 opacity-50" />
        <p>No pay stubs available</p>
        <p className="text-sm">Pay stubs are generated when a pay run includes employee line items</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Pay Stubs ({payStubs.length})</h3>
        <Button variant="outline" size="sm" onClick={printAll} data-testid="button-print-all-stubs">
          <Printer className="w-4 h-4 mr-1" />
          Print All
        </Button>
      </div>

      {isMobile ? (
        <div className="space-y-3">
          {payStubs.map(stub => (
            <Card key={stub.userId} data-testid={`card-stub-${stub.userId}`}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{stub.employeeName}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Gross</p>
                    <p className="font-medium">{formatCurrency(stub.totalGross)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Deductions</p>
                    <p className="font-medium text-red-600">{stub.totalDeductions > 0 ? `-${formatCurrency(stub.totalDeductions)}` : "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Net Pay</p>
                    <p className="font-semibold text-green-600">{formatCurrency(stub.netPay)}</p>
                  </div>
                </div>
                <div className="flex gap-2 pt-1">
                  <Button variant="ghost" size="sm" className="flex-1" onClick={() => { setSelectedStub(stub); setStubDetailOpen(true); }} data-testid={`button-view-stub-${stub.userId}`}>
                    View Details
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => printPayStub(stub)} data-testid={`button-print-stub-${stub.userId}`}>
                    <Printer className="w-3 h-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Projects</TableHead>
                <TableHead>Gross Pay</TableHead>
                <TableHead>Deductions</TableHead>
                <TableHead>Net Pay</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payStubs.map(stub => (
                <TableRow key={stub.userId} data-testid={`row-stub-${stub.userId}`}>
                  <TableCell>
                    <div>
                      <p className="font-medium">{stub.employeeName}</p>
                      <p className="text-xs text-muted-foreground">{stub.employeeEmail}</p>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{stub.earnings.map(e => e.projectName).join(", ")}</TableCell>
                  <TableCell className="font-medium">{formatCurrency(stub.totalGross)}</TableCell>
                  <TableCell className="text-red-600">{stub.totalDeductions > 0 ? `-${formatCurrency(stub.totalDeductions)}` : "—"}</TableCell>
                  <TableCell className="font-semibold text-green-600">{formatCurrency(stub.netPay)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => { setSelectedStub(stub); setStubDetailOpen(true); }} data-testid={`button-view-stub-${stub.userId}`}>
                        <FileText className="w-4 h-4 mr-1" /> View
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => printPayStub(stub)} data-testid={`button-print-stub-${stub.userId}`}>
                        <Printer className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={stubDetailOpen} onOpenChange={(open) => { setStubDetailOpen(open); if (!open) setSelectedStub(null); }}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          {selectedStub && (
            <>
              <DialogHeader>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <DialogTitle>Pay Stub - {selectedStub.employeeName}</DialogTitle>
                  <Button variant="outline" size="sm" onClick={() => printPayStub(selectedStub)} data-testid="button-print-stub-detail">
                    <Printer className="w-4 h-4 mr-1" /> Print
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground">
                  Pay Run: {selectedStub.payRunNumber || "N/A"} | Period: {selectedStub.payPeriodStart} to {selectedStub.payPeriodEnd}
                </p>
              </DialogHeader>

              <div className="space-y-4 py-2">
                <div>
                  <h4 className="font-semibold text-sm mb-2 flex items-center gap-1">
                    <DollarSign className="w-4 h-4" /> Earnings
                  </h4>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Project</TableHead>
                          <TableHead>Reg Hrs</TableHead>
                          <TableHead>Rate</TableHead>
                          <TableHead>Reg Pay</TableHead>
                          <TableHead>OT Hrs</TableHead>
                          <TableHead>OT Rate</TableHead>
                          <TableHead>OT Pay</TableHead>
                          <TableHead>Gross</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedStub.earnings.map((e, i) => (
                          <TableRow key={i}>
                            <TableCell className="font-medium">{e.projectName}</TableCell>
                            <TableCell>{e.regularHours}</TableCell>
                            <TableCell>{formatCurrency(e.regularRate)}</TableCell>
                            <TableCell>{formatCurrency(e.regularPay)}</TableCell>
                            <TableCell>{e.overtimeHours > 0 ? e.overtimeHours : "—"}</TableCell>
                            <TableCell>{e.overtimeHours > 0 ? formatCurrency(e.overtimeRate) : "—"}</TableCell>
                            <TableCell>{e.overtimePay > 0 ? formatCurrency(e.overtimePay) : "—"}</TableCell>
                            <TableCell className="font-semibold">{formatCurrency(e.grossAmount)}</TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="bg-muted/50">
                          <TableCell colSpan={7} className="text-right font-semibold">Total Gross</TableCell>
                          <TableCell className="font-bold">{formatCurrency(selectedStub.totalGross)}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </div>

                {selectedStub.deductions.length > 0 && (
                  <div>
                    <h4 className="font-semibold text-sm mb-2">Deductions</h4>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Type</TableHead>
                            <TableHead>Category</TableHead>
                            <TableHead>Pre-Tax</TableHead>
                            <TableHead>Amount</TableHead>
                            <TableHead>YTD</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {selectedStub.deductions.map((d, i) => (
                            <TableRow key={i}>
                              <TableCell className="font-medium">{d.name}</TableCell>
                              <TableCell><Badge variant="outline" className="text-xs">{d.category}</Badge></TableCell>
                              <TableCell>{d.isPreTax ? "Yes" : "No"}</TableCell>
                              <TableCell className="text-red-600">-{formatCurrency(d.amount)}</TableCell>
                              <TableCell className="text-muted-foreground">{formatCurrency(d.ytdAmount)}</TableCell>
                            </TableRow>
                          ))}
                          <TableRow className="bg-muted/50">
                            <TableCell colSpan={3} className="text-right font-semibold">Total Deductions</TableCell>
                            <TableCell className="font-bold text-red-600">-{formatCurrency(selectedStub.totalDeductions)}</TableCell>
                            <TableCell></TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}

                <Separator />

                <div className="flex items-center justify-between p-4 bg-green-50 dark:bg-green-950 rounded-lg border border-green-200 dark:border-green-800">
                  <span className="font-semibold text-lg">Net Pay</span>
                  <span className="font-bold text-2xl text-green-600 dark:text-green-400" data-testid="text-net-pay">
                    {formatCurrency(selectedStub.netPay)}
                  </span>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
