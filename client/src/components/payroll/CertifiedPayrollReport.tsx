import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from "@/hooks/use-mobile";
import { useQuery } from "@tanstack/react-query";
import { FileText, Printer, Download, AlertTriangle, CheckCircle } from "lucide-react";

interface CertifiedEmployee {
  name: string;
  workClassification: string;
  regularHours: number;
  overtimeHours: number;
  totalHours: number;
  rateOfPay: number;
  overtimeRate: number;
  grossEarned: number;
  fica: number;
  withholdingTax: number;
  otherDeductions: number;
  totalDeductions: number;
  netWages: number;
  projectName: string;
  prevailingRate: number | null;
  belowPrevailingWage: boolean;
}

interface CertifiedReport {
  header: {
    contractorName: string;
    payrollNumber: string | null;
    weekEndingDate: string;
    projectName: string;
  };
  employees: CertifiedEmployee[];
  totals: {
    totalGross: number;
    totalDeductions: number;
    totalNet: number;
  };
  statementOfCompliance: {
    fringeBenefitsPaidToPlan: boolean;
    fringeBenefitsPaidInCash: boolean;
    noFringeBenefitsRequired: boolean;
  };
}

const formatCurrency = (val: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val || 0);

export function CertifiedPayrollButton({ payRunId, payRunNumber }: { payRunId: string; payRunNumber: string | null }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="button-certified-payroll">
        <FileText className="w-4 h-4 mr-1" />
        WH-347 Report
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-y-auto">
          <CertifiedPayrollReportView payRunId={payRunId} payRunNumber={payRunNumber} />
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function CertifiedPayrollReportView({ payRunId, payRunNumber }: { payRunId: string; payRunNumber: string | null }) {
  const isMobile = useIsMobile();

  const { data: report, isLoading } = useQuery<CertifiedReport>({
    queryKey: ["/api/payroll/pay-runs", payRunId, "certified-report"],
    enabled: !!payRunId,
  });

  const printReport = () => {
    if (!report) return;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`
      <html><head><title>WH-347 Certified Payroll - ${report.header.payrollNumber || ""}</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 15px; font-size: 11px; }
        h1 { text-align: center; font-size: 16px; margin: 0; }
        h2 { text-align: center; font-size: 12px; margin: 5px 0 15px; color: #666; }
        .header-info { display: flex; justify-content: space-between; margin-bottom: 15px; border: 1px solid #333; padding: 8px; }
        .header-info div { margin: 2px 0; }
        table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 10px; }
        th, td { border: 1px solid #333; padding: 4px 6px; text-align: center; }
        th { background: #e5e5e5; font-weight: bold; }
        td.left { text-align: left; }
        .below-wage { background: #fee2e2; color: #dc2626; font-weight: bold; }
        .compliance { border: 1px solid #333; padding: 12px; margin-top: 15px; font-size: 11px; }
        .compliance h3 { margin: 0 0 8px; font-size: 13px; }
        .totals-row { font-weight: bold; background: #f5f5f5; }
        @media print { button { display: none; } }
      </style></head><body>
      <h1>U.S. Department of Labor - Wage and Hour Division</h1>
      <h2>PAYROLL (WH-347)</h2>
      <div class="header-info">
        <div>
          <div><strong>Contractor:</strong> ${report.header.contractorName}</div>
          <div><strong>Project:</strong> ${report.header.projectName}</div>
        </div>
        <div>
          <div><strong>Payroll No:</strong> ${report.header.payrollNumber || "N/A"}</div>
          <div><strong>Week Ending:</strong> ${report.header.weekEndingDate}</div>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th rowspan="2">Name & Classification</th>
            <th rowspan="2">Work<br/>Classification</th>
            <th rowspan="2">ST Hrs</th>
            <th rowspan="2">OT Hrs</th>
            <th rowspan="2">Total<br/>Hrs</th>
            <th rowspan="2">Rate of<br/>Pay</th>
            <th rowspan="2">Gross<br/>Earned</th>
            <th colspan="3">Deductions</th>
            <th rowspan="2">Total<br/>Deductions</th>
            <th rowspan="2">Net<br/>Wages</th>
          </tr>
          <tr>
            <th>FICA</th>
            <th>W/H Tax</th>
            <th>Other</th>
          </tr>
        </thead>
        <tbody>
          ${report.employees.map(emp => `
            <tr${emp.belowPrevailingWage ? ' class="below-wage"' : ''}>
              <td class="left">${emp.name}${emp.belowPrevailingWage ? ' *' : ''}</td>
              <td>${emp.workClassification}</td>
              <td>${emp.regularHours.toFixed(1)}</td>
              <td>${emp.overtimeHours.toFixed(1)}</td>
              <td>${emp.totalHours.toFixed(1)}</td>
              <td>$${emp.rateOfPay.toFixed(2)}</td>
              <td>$${emp.grossEarned.toFixed(2)}</td>
              <td>$${emp.fica.toFixed(2)}</td>
              <td>$${emp.withholdingTax.toFixed(2)}</td>
              <td>$${emp.otherDeductions.toFixed(2)}</td>
              <td>$${emp.totalDeductions.toFixed(2)}</td>
              <td>$${emp.netWages.toFixed(2)}</td>
            </tr>
          `).join("")}
          <tr class="totals-row">
            <td class="left" colspan="2">TOTALS</td>
            <td>${report.employees.reduce((s, e) => s + e.regularHours, 0).toFixed(1)}</td>
            <td>${report.employees.reduce((s, e) => s + e.overtimeHours, 0).toFixed(1)}</td>
            <td>${report.employees.reduce((s, e) => s + e.totalHours, 0).toFixed(1)}</td>
            <td></td>
            <td>$${report.totals.totalGross.toFixed(2)}</td>
            <td>$${report.employees.reduce((s, e) => s + e.fica, 0).toFixed(2)}</td>
            <td>$${report.employees.reduce((s, e) => s + e.withholdingTax, 0).toFixed(2)}</td>
            <td>$${report.employees.reduce((s, e) => s + e.otherDeductions, 0).toFixed(2)}</td>
            <td>$${report.totals.totalDeductions.toFixed(2)}</td>
            <td>$${report.totals.totalNet.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>
      ${report.employees.some(e => e.belowPrevailingWage) ? '<p style="color:#dc2626">* Worker is paid below the prevailing wage rate for their classification</p>' : ''}
      <div class="compliance">
        <h3>STATEMENT OF COMPLIANCE</h3>
        <p>I, the undersigned, do hereby state:</p>
        <p>(1) That I pay or supervise the payment of the persons employed on the above contract; that during the payroll period commencing on the first day and ending on the last day of the period shown above, all persons employed on said contract have been paid the full weekly wages earned.</p>
        <p>(2) That fringe benefits as listed have been or will be paid to appropriate programs:</p>
        <p>[${report.statementOfCompliance.fringeBenefitsPaidToPlan ? 'X' : ' '}] Fringe benefits paid to approved plan(s)</p>
        <p>[${report.statementOfCompliance.fringeBenefitsPaidInCash ? 'X' : ' '}] Fringe benefits paid in cash</p>
        <p>[${report.statementOfCompliance.noFringeBenefitsRequired ? 'X' : ' '}] No fringe benefits required</p>
        <br/>
        <div style="display:flex;justify-content:space-between;margin-top:20px">
          <div>Signature: _________________________</div>
          <div>Title: _________________________</div>
          <div>Date: _________________________</div>
        </div>
      </div>
      <br><button onclick="window.print()" style="padding:8px 16px;cursor:pointer">Print</button>
      </body></html>
    `);
    w.document.close();
  };

  const exportCSV = () => {
    if (!report) return;
    const headers = ["Name", "Classification", "ST Hours", "OT Hours", "Total Hours", "Rate", "Gross", "FICA", "W/H Tax", "Other Ded.", "Total Ded.", "Net Wages", "Below Prevailing Wage"];
    const rows = report.employees.map(e => [
      e.name, e.workClassification, e.regularHours, e.overtimeHours, e.totalHours,
      e.rateOfPay, e.grossEarned, e.fica, e.withholdingTax, e.otherDeductions,
      e.totalDeductions, e.netWages, e.belowPrevailingWage ? "YES" : "NO"
    ]);
    const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `WH-347_${report.header.payrollNumber || "report"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return <div className="space-y-3"><Skeleton className="h-8 w-48" /><Skeleton className="h-40 w-full" /><Skeleton className="h-20 w-full" /></div>;
  }

  if (!report) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <FileText className="w-10 h-10 mx-auto mb-3 opacity-50" />
        <p>Report data not available</p>
      </div>
    );
  }

  const hasViolations = report.employees.some(e => e.belowPrevailingWage);

  return (
    <div className="space-y-4">
      <DialogHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <DialogTitle className="text-lg">WH-347 Certified Payroll Report</DialogTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={exportCSV} data-testid="button-export-csv">
              <Download className="w-4 h-4 mr-1" /> Export CSV
            </Button>
            <Button variant="outline" size="sm" onClick={printReport} data-testid="button-print-report">
              <Printer className="w-4 h-4 mr-1" /> Print
            </Button>
          </div>
        </div>
      </DialogHeader>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-muted rounded-lg">
        <div>
          <p className="text-xs text-muted-foreground">Contractor</p>
          <p className="font-medium text-sm">{report.header.contractorName}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Project</p>
          <p className="font-medium text-sm">{report.header.projectName}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Payroll Number</p>
          <p className="font-medium text-sm">{report.header.payrollNumber || "N/A"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Week Ending</p>
          <p className="font-medium text-sm">{report.header.weekEndingDate}</p>
        </div>
      </div>

      {hasViolations && (
        <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg">
          <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0" />
          <p className="text-sm text-red-700 dark:text-red-300">
            One or more workers are paid below the prevailing wage rate. These rows are highlighted in red.
          </p>
        </div>
      )}

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[120px]">Name</TableHead>
              <TableHead>Classification</TableHead>
              <TableHead>ST Hrs</TableHead>
              <TableHead>OT Hrs</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Rate</TableHead>
              <TableHead>Gross</TableHead>
              <TableHead>FICA</TableHead>
              <TableHead>W/H Tax</TableHead>
              <TableHead>Other</TableHead>
              <TableHead>Total Ded.</TableHead>
              <TableHead>Net Wages</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.employees.map((emp, i) => (
              <TableRow key={i} className={emp.belowPrevailingWage ? "bg-red-50 dark:bg-red-950" : ""} data-testid={`row-certified-${i}`}>
                <TableCell className="font-medium">
                  <div className="flex items-center gap-1">
                    {emp.name}
                    {emp.belowPrevailingWage && <AlertTriangle className="w-3 h-3 text-red-600" />}
                  </div>
                </TableCell>
                <TableCell className="text-sm">{emp.workClassification}</TableCell>
                <TableCell>{emp.regularHours.toFixed(1)}</TableCell>
                <TableCell>{emp.overtimeHours > 0 ? emp.overtimeHours.toFixed(1) : "—"}</TableCell>
                <TableCell className="font-medium">{emp.totalHours.toFixed(1)}</TableCell>
                <TableCell>
                  <div>
                    {formatCurrency(emp.rateOfPay)}
                    {emp.prevailingRate && emp.belowPrevailingWage && (
                      <p className="text-xs text-red-600">PW: {formatCurrency(emp.prevailingRate)}</p>
                    )}
                  </div>
                </TableCell>
                <TableCell className="font-medium">{formatCurrency(emp.grossEarned)}</TableCell>
                <TableCell>{formatCurrency(emp.fica)}</TableCell>
                <TableCell>{formatCurrency(emp.withholdingTax)}</TableCell>
                <TableCell>{formatCurrency(emp.otherDeductions)}</TableCell>
                <TableCell>{formatCurrency(emp.totalDeductions)}</TableCell>
                <TableCell className="font-semibold">{formatCurrency(emp.netWages)}</TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-muted/50 font-bold">
              <TableCell colSpan={2} className="text-right">TOTALS</TableCell>
              <TableCell>{report.employees.reduce((s, e) => s + e.regularHours, 0).toFixed(1)}</TableCell>
              <TableCell>{report.employees.reduce((s, e) => s + e.overtimeHours, 0).toFixed(1)}</TableCell>
              <TableCell>{report.employees.reduce((s, e) => s + e.totalHours, 0).toFixed(1)}</TableCell>
              <TableCell></TableCell>
              <TableCell>{formatCurrency(report.totals.totalGross)}</TableCell>
              <TableCell>{formatCurrency(report.employees.reduce((s, e) => s + e.fica, 0))}</TableCell>
              <TableCell>{formatCurrency(report.employees.reduce((s, e) => s + e.withholdingTax, 0))}</TableCell>
              <TableCell>{formatCurrency(report.employees.reduce((s, e) => s + e.otherDeductions, 0))}</TableCell>
              <TableCell>{formatCurrency(report.totals.totalDeductions)}</TableCell>
              <TableCell>{formatCurrency(report.totals.totalNet)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Statement of Compliance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            {report.statementOfCompliance.fringeBenefitsPaidToPlan ?
              <CheckCircle className="w-4 h-4 text-green-600" /> : <div className="w-4 h-4 border rounded" />}
            <span>Fringe benefits paid to approved plan(s)</span>
          </div>
          <div className="flex items-center gap-2">
            {report.statementOfCompliance.fringeBenefitsPaidInCash ?
              <CheckCircle className="w-4 h-4 text-green-600" /> : <div className="w-4 h-4 border rounded" />}
            <span>Fringe benefits paid in cash</span>
          </div>
          <div className="flex items-center gap-2">
            {report.statementOfCompliance.noFringeBenefitsRequired ?
              <CheckCircle className="w-4 h-4 text-green-600" /> : <div className="w-4 h-4 border rounded" />}
            <span>No fringe benefits required</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
