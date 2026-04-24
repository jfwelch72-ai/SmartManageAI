import { useState, useEffect, Fragment } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { useIsMobile } from "@/hooks/use-mobile";
import { useQuery, useMutation } from "@tanstack/react-query";
import { FileText, Printer, Download, AlertTriangle, CheckCircle, FileDown, Loader2, Bell, BellOff } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const VARIANT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "WH_347", label: "Federal WH-347" },
  { value: "CALTRANS_CEM_2502", label: "Caltrans CEM-2502" },
  { value: "ODOT_CA_D_9C", label: "ODOT CA-D-9C" },
  { value: "TXDOT", label: "TxDOT" },
  { value: "FDOT", label: "FDOT" },
  { value: "GENERIC", label: "Generic Certified Payroll" },
];

type PrevailingRateSource = "PROJECT_OVERRIDE" | "DOL_FEED" | "NONE";

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
  prevailingRateSource?: PrevailingRateSource;
  // Task #1450: per-row Davis-Bacon "rate changed recently" flag mirrored
  // from the project prevailing wage panel. Drives the inline badge so a
  // PM signing the certified payroll sees that one of these workers'
  // classifications had its DOL rate change since they last reviewed.
  recentRateChange?: { changeKind: "added" | "changed" | "removed"; detectedAt: string | null } | null;
}

// Task #1450: aggregate per-project list of unacknowledged Davis-Bacon
// rate-change flags surfaced by the certified-report endpoint.
interface CertifiedRecentRateChangeProject {
  projectId: string;
  projectName: string;
  wageDecision: string;
  count: number;
  latestDetectedAt: string | null;
  classifications: string[];
}

interface MissingWageDecision {
  projectName: string;
  wageDecision: string;
}

interface ProjectReport {
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
  projectReports?: ProjectReport[];
  defaultPayrollFormVariant?: string | null;
  missingWageDecisions?: MissingWageDecision[];
  recentRateChanges?: CertifiedRecentRateChangeProject[];
}

const sourceLabel = (s?: PrevailingRateSource): string | null => {
  if (s === "PROJECT_OVERRIDE") return "Project override";
  if (s === "DOL_FEED") return "DOL feed";
  return null;
};

const formatCurrency = (val: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val || 0);

export function CertifiedPayrollButton({ payRunId, payRunNumber }: { payRunId: string; payRunNumber: string | null }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="button-certified-payroll">
        <FileText className="w-4 h-4 mr-1" />
        Certified Payroll
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-y-auto">
          <CertifiedPayrollReportView payRunId={payRunId} payRunNumber={payRunNumber} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function WH347Table({ employees, totals, header }: { employees: CertifiedEmployee[]; totals: ProjectReport["totals"]; header: ProjectReport["header"] }) {
  const hasViolations = employees.some(e => e.belowPrevailingWage);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-muted rounded-lg">
        <div>
          <p className="text-xs text-muted-foreground">Contractor</p>
          <p className="font-medium text-sm">{header.contractorName}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Project</p>
          <p className="font-medium text-sm">{header.projectName}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Payroll Number</p>
          <p className="font-medium text-sm">{header.payrollNumber || "N/A"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Week Ending</p>
          <p className="font-medium text-sm">{header.weekEndingDate}</p>
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
            {employees.map((emp, i) => (
              <TableRow key={i} className={emp.belowPrevailingWage ? "bg-red-50 dark:bg-red-950" : ""} data-testid={`row-certified-${i}`}>
                <TableCell className="font-medium">
                  <div className="flex items-center gap-1">
                    {emp.name}
                    {emp.belowPrevailingWage && <AlertTriangle className="w-3 h-3 text-red-600" />}
                  </div>
                </TableCell>
                <TableCell className="text-sm">
                  <div className="flex items-center gap-2">
                    <span>{emp.workClassification}</span>
                    {/* Task #1450: per-row "rate changed recently" badge
                        mirroring the project prevailing wage panel so PMs
                        signing the certified payroll see classifications
                        whose Davis-Bacon rate just shifted. */}
                    {emp.recentRateChange && (
                      <Badge
                        variant="outline"
                        className="text-[10px] border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-300"
                        data-testid={`badge-rate-changed-${i}`}
                        title={
                          emp.recentRateChange.detectedAt
                            ? `Rate ${emp.recentRateChange.changeKind} on ${new Date(emp.recentRateChange.detectedAt).toLocaleString()}`
                            : `Rate ${emp.recentRateChange.changeKind} on most recent refresh`
                        }
                      >
                        Rate changed recently
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>{emp.regularHours.toFixed(1)}</TableCell>
                <TableCell>{emp.overtimeHours > 0 ? emp.overtimeHours.toFixed(1) : "—"}</TableCell>
                <TableCell className="font-medium">{emp.totalHours.toFixed(1)}</TableCell>
                <TableCell>
                  <div>
                    {formatCurrency(emp.rateOfPay)}
                    {emp.prevailingRate && emp.belowPrevailingWage && (
                      <p className="text-xs text-red-600" data-testid={`text-pw-rate-${i}`}>
                        PW: {formatCurrency(emp.prevailingRate)}
                      </p>
                    )}
                    {sourceLabel(emp.prevailingRateSource) && (
                      <p className="text-[10px] text-muted-foreground" data-testid={`text-rate-source-${i}`}>
                        {sourceLabel(emp.prevailingRateSource)}
                      </p>
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
              <TableCell>{employees.reduce((s, e) => s + e.regularHours, 0).toFixed(1)}</TableCell>
              <TableCell>{employees.reduce((s, e) => s + e.overtimeHours, 0).toFixed(1)}</TableCell>
              <TableCell>{employees.reduce((s, e) => s + e.totalHours, 0).toFixed(1)}</TableCell>
              <TableCell></TableCell>
              <TableCell>{formatCurrency(totals.totalGross)}</TableCell>
              <TableCell>{formatCurrency(employees.reduce((s, e) => s + e.fica, 0))}</TableCell>
              <TableCell>{formatCurrency(employees.reduce((s, e) => s + e.withholdingTax, 0))}</TableCell>
              <TableCell>{formatCurrency(employees.reduce((s, e) => s + e.otherDeductions, 0))}</TableCell>
              <TableCell>{formatCurrency(totals.totalDeductions)}</TableCell>
              <TableCell>{formatCurrency(totals.totalNet)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function buildProjectHtml(pr: ProjectReport): string {
  return `
    <div class="project-section">
      <div class="header-info">
        <div>
          <div><strong>Contractor:</strong> ${pr.header.contractorName}</div>
          <div><strong>Project:</strong> ${pr.header.projectName}</div>
        </div>
        <div>
          <div><strong>Payroll No:</strong> ${pr.header.payrollNumber || "N/A"}</div>
          <div><strong>Week Ending:</strong> ${pr.header.weekEndingDate}</div>
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
          ${pr.employees.map(emp => {
            // Task #1484: surface the unacknowledged Davis-Bacon rate-change
            // signal in the printed view. Adds a "+" suffix on the worker
            // classification cell plus an amber "Rate changed YYYY-MM-DD"
            // caption underneath so a reviewer of the printed report sees
            // the same flag as the on-screen badge.
            const rc = emp.recentRateChange;
            const rcDate = rc?.detectedAt ? rc.detectedAt.slice(0, 10) : null;
            return `
            <tr${emp.belowPrevailingWage ? ' class="below-wage"' : ''}>
              <td class="left">${emp.name}${emp.belowPrevailingWage ? ' *' : ''}</td>
              <td>${emp.workClassification}${rc ? ' +' : ''}${rc ? `<div style="font-size:9px;color:#b45309">Rate changed ${rcDate || 'recently'}</div>` : ''}</td>
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
          `;
          }).join("")}
          <tr class="totals-row">
            <td class="left" colspan="2">TOTALS</td>
            <td>${pr.employees.reduce((s, e) => s + e.regularHours, 0).toFixed(1)}</td>
            <td>${pr.employees.reduce((s, e) => s + e.overtimeHours, 0).toFixed(1)}</td>
            <td>${pr.employees.reduce((s, e) => s + e.totalHours, 0).toFixed(1)}</td>
            <td></td>
            <td>$${pr.totals.totalGross.toFixed(2)}</td>
            <td>$${pr.employees.reduce((s, e) => s + e.fica, 0).toFixed(2)}</td>
            <td>$${pr.employees.reduce((s, e) => s + e.withholdingTax, 0).toFixed(2)}</td>
            <td>$${pr.employees.reduce((s, e) => s + e.otherDeductions, 0).toFixed(2)}</td>
            <td>$${pr.totals.totalDeductions.toFixed(2)}</td>
            <td>$${pr.totals.totalNet.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>
      ${pr.employees.some(e => e.belowPrevailingWage) ? '<p style="color:#dc2626">* Worker is paid below the prevailing wage rate for their classification</p>' : ''}
      ${pr.employees.some(e => e.recentRateChange) ? '<p style="color:#b45309">+ Davis-Bacon rate for this classification changed recently — review and acknowledge on the project prevailing-wage panel before submitting.</p>' : ''}
    </div>
  `;
}

// Task #1485: shape of the 412/409 payload returned by the certified-payroll
// PDF endpoint when there are unacknowledged Davis-Bacon rate changes.
interface SigningGatePayload {
  error: string;
  code: "RATE_CHANGE_BLOCKED" | "RATE_CHANGE_CONFIRM_REQUIRED";
  policy: "OFF" | "WARN" | "BLOCK";
  recentRateChanges: Array<{
    projectId: string;
    projectName: string;
    normalizedClassification: string;
    changeKind: string;
    detectedAt: string | null;
  }>;
  affectedProjects: Array<{ projectId: string; policy: "OFF" | "WARN" | "BLOCK" }>;
}

export default function CertifiedPayrollReportView({ payRunId, payRunNumber }: { payRunId: string; payRunNumber: string | null }) {
  const isMobile = useIsMobile();
  const [variant, setVariant] = useState<string>("");
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  // Task #1485: holds the 412 payload while the soft-confirm dialog is open.
  // Resolving the dialog re-runs the download with `acknowledged=true`.
  const [signingConfirm, setSigningConfirm] = useState<SigningGatePayload | null>(null);

  const { data: report, isLoading } = useQuery<CertifiedReport>({
    queryKey: ["/api/payroll/pay-runs", payRunId, "certified-report"],
    enabled: !!payRunId,
  });

  const { toast } = useToast();
  const importDecisionMutation = useMutation({
    mutationFn: async (decisionNumber: string) => {
      const resp = await apiRequest("POST", "/api/payroll/wage-decisions/sync", { decisionNumber });
      return (await resp.json()) as { status: string; decisionNumber: string };
    },
    onSuccess: (data) => {
      const alreadyCached = data.status === "cached";
      toast({
        title: alreadyCached ? "Wage decision already imported" : "Wage decision imported",
        description: alreadyCached
          ? `${data.decisionNumber} was already cached from the DOL feed; refreshing the report.`
          : `${data.decisionNumber} is now cached from the DOL feed.`,
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/payroll/pay-runs", payRunId, "certified-report"],
      });
    },
    onError: (err) => {
      toast({
        title: "Import failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    },
  });
  const pendingDecision = importDecisionMutation.isPending ? importDecisionMutation.variables : null;

  // Task #1450: clear unacknowledged Davis-Bacon "rate changed recently"
  // flags for one of the projects on this pay run. Mirrors the
  // ProjectPayrollTab acknowledge action so signing the certified
  // payroll can dismiss the badges in one click per project.
  const acknowledgeRateChangesMutation = useMutation({
    mutationFn: async (projectId: string) => {
      const resp = await apiRequest(
        "POST",
        `/api/projects/${projectId}/prevailing-wage-summary/acknowledge-rate-changes`,
        {},
      );
      return (await resp.json()) as { acknowledged: number };
    },
    onSuccess: (data, projectId) => {
      if (data.acknowledged > 0) {
        toast({
          title: "Rate change badges cleared",
          description: `Acknowledged ${data.acknowledged} classification${data.acknowledged === 1 ? "" : "s"}.`,
        });
      }
      queryClient.invalidateQueries({
        queryKey: ["/api/payroll/pay-runs", payRunId, "certified-report"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/projects", projectId, "prevailing-wage-summary"],
      });
    },
    onError: (err) => {
      toast({
        title: "Failed to acknowledge rate changes",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    },
  });
  const pendingAckProjectId =
    acknowledgeRateChangesMutation.isPending ? acknowledgeRateChangesMutation.variables : null;

  useEffect(() => {
    if (!variant && report?.defaultPayrollFormVariant) {
      setVariant(report.defaultPayrollFormVariant);
    }
  }, [report?.defaultPayrollFormVariant, variant]);

  const projectReports = report?.projectReports || [];
  const hasMultipleProjects = projectReports.length > 1;

  const downloadPdf = async (acknowledgeRateChanges = false) => {
    if (!payRunId) return;
    setDownloadingPdf(true);
    try {
      const params = new URLSearchParams();
      if (variant) params.set("variant", variant);
      // Task #1485: when the PM has confirmed the soft-confirm dialog (or
      // is retrying after one), pass `acknowledged=true` so the server-side
      // signing gate lets the PDF generate.
      if (acknowledgeRateChanges) params.set("acknowledged", "true");
      const qs = params.toString();
      const url = `/api/payroll/pay-runs/${payRunId}/certified-payroll-pdf${qs ? `?${qs}` : ""}`;
      const resp = await fetch(url, { credentials: "include" });
      // Task #1485: handle the certified-payroll signing gate.
      //   412 → soft-confirm policy (WARN). Show a dialog summarizing the
      //         affected classifications; on confirm, retry with
      //         `acknowledged=true` so the PDF actually generates.
      //   409 → hard-block policy (BLOCK). PM must acknowledge the
      //         rate-change flags via the banner first; surface a toast
      //         with a pointer to that workflow.
      if (resp.status === 412 || resp.status === 409) {
        let payload: SigningGatePayload | null = null;
        try {
          payload = (await resp.json()) as SigningGatePayload;
        } catch {
          payload = null;
        }
        if (resp.status === 412 && payload) {
          setSigningConfirm(payload);
          return;
        }
        toast({
          title: "Signing blocked",
          description:
            payload?.error
            || "Davis-Bacon rate changes must be acknowledged before signing this certified payroll.",
          variant: "destructive",
        });
        return;
      }
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text || `Failed to generate PDF (${resp.status})`);
      }
      const blob = await resp.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      const disp = resp.headers.get("Content-Disposition") || "";
      const match = disp.match(/filename="?([^";]+)"?/i);
      a.download = match?.[1] || `${variant || "WH_347"}_${payRunNumber || payRunId.slice(0, 8)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      toast({
        title: "Download failed",
        description: err instanceof Error ? err.message : "Failed to download PDF",
        variant: "destructive",
      });
    } finally {
      setDownloadingPdf(false);
    }
  };

  const printReport = () => {
    if (!report) return;
    const w = window.open("", "_blank");
    if (!w) return;

    const sections = hasMultipleProjects
      ? projectReports.map((pr, i) => `
          ${i > 0 ? '<div style="page-break-before:always; margin-top:30px;"></div><hr style="border:2px solid #333; margin:20px 0;" />' : ''}
          <h1>U.S. Department of Labor - Wage and Hour Division</h1>
          <h2>PAYROLL (WH-347)</h2>
          ${buildProjectHtml(pr)}
        `).join("")
      : `
          <h1>U.S. Department of Labor - Wage and Hour Division</h1>
          <h2>PAYROLL (WH-347)</h2>
          ${buildProjectHtml({ header: report.header, employees: report.employees, totals: report.totals })}
        `;

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
        .project-section { margin-bottom: 20px; }
        @media print { button { display: none; } }
      </style></head><body>
      ${sections}
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

    const allEmployees = hasMultipleProjects
      ? projectReports.flatMap(pr => pr.employees)
      : report.employees;

    const csvEscape = (val: string | number | boolean) => {
      const s = String(val);
      if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };
    // Task #1484: include a "Recent Rate Change" column flagging any worker
    // whose Davis-Bacon classification has an unacknowledged rate-change
    // record. Mirrors the on-screen "Rate changed recently" badge so a PM
    // who exports/audits the CSV without scrolling the viewer still sees it.
    const headers = ["Project", "Name", "Classification", "ST Hours", "OT Hours", "Total Hours", "Rate", "Gross", "FICA", "W/H Tax", "Other Ded.", "Total Ded.", "Net Wages", "Below Prevailing Wage", "Prevailing Rate Source", "Recent Rate Change"];
    const rows = allEmployees.map(e => {
      const rc = e.recentRateChange;
      const rcLabel = rc
        ? `Rate ${rc.changeKind} ${rc.detectedAt ? rc.detectedAt.slice(0, 10) : "recently"}`
        : "";
      return [
        e.projectName, e.name, e.workClassification, e.regularHours, e.overtimeHours, e.totalHours,
        e.rateOfPay, e.grossEarned, e.fica, e.withholdingTax, e.otherDeductions,
        e.totalDeductions, e.netWages, e.belowPrevailingWage ? "YES" : "NO",
        sourceLabel(e.prevailingRateSource) ?? "",
        rcLabel,
      ];
    });
    const csv = [headers.map(csvEscape).join(","), ...rows.map(r => r.map(csvEscape).join(","))].join("\n");
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

  return (
    <div className="space-y-4">
      <DialogHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <DialogTitle className="text-lg">Certified Payroll Report</DialogTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={variant} onValueChange={setVariant}>
              <SelectTrigger className="h-8 w-[200px]" data-testid="select-payroll-variant">
                <SelectValue placeholder="Form variant" />
              </SelectTrigger>
              <SelectContent>
                {VARIANT_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value} data-testid={`option-variant-${opt.value}`}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="default" size="sm" onClick={() => downloadPdf(false)} disabled={downloadingPdf} data-testid="button-download-pdf">
              <FileDown className="w-4 h-4 mr-1" /> {downloadingPdf ? "Generating…" : "Download PDF"}
            </Button>
            <Button variant="outline" size="sm" onClick={exportCSV} data-testid="button-export-csv">
              <Download className="w-4 h-4 mr-1" /> CSV
            </Button>
            <Button variant="outline" size="sm" onClick={printReport} data-testid="button-print-report">
              <Printer className="w-4 h-4 mr-1" /> Print
            </Button>
          </div>
        </div>
      </DialogHeader>

      {report.missingWageDecisions && report.missingWageDecisions.length > 0 && (
        <div
          className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg"
          data-testid="banner-missing-wage-decisions"
        >
          <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-red-700 dark:text-red-300">
            <p className="font-medium">
              Wage decision{report.missingWageDecisions.length === 1 ? "" : "s"} not yet imported from DOL
            </p>
            <ul className="mt-1 space-y-1">
              {report.missingWageDecisions.map((m, i) => {
                const isPending = pendingDecision === m.wageDecision;
                return (
                  <li
                    key={`${m.projectName}-${m.wageDecision}-${i}`}
                    className="flex flex-wrap items-center gap-2"
                    data-testid={`text-missing-decision-${i}`}
                  >
                    <span>
                      {m.projectName ? `${m.projectName}: ` : ""}
                      <span className="font-mono">{m.wageDecision}</span>
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-xs"
                      disabled={importDecisionMutation.isPending}
                      onClick={() => importDecisionMutation.mutate(m.wageDecision)}
                      data-testid={`button-import-decision-${i}`}
                    >
                      {isPending ? (
                        <>
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" /> Importing…
                        </>
                      ) : (
                        "Import now"
                      )}
                    </Button>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-xs">
              Davis-Bacon syncs are queued automatically when a project's wage decision is set or
              edited; use Import now to retry after a connection issue.
            </p>
          </div>
        </div>
      )}

      {/* Task #1450: panel-level "rates changed recently" banner mirroring
          the project prevailing wage panel. One row per project on the
          pay run that still has unacknowledged Davis-Bacon rate-change
          flags, each with its own Acknowledge action. */}
      {report.recentRateChanges && report.recentRateChanges.length > 0 && (
        <div
          className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg"
          data-testid="banner-certified-rates-changed"
        >
          <Bell className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 text-sm text-blue-800 dark:text-blue-200">
            <p className="font-medium">Davis-Bacon rates changed recently</p>
            <p className="mt-1">
              The latest auto-refresh updated rates for one or more
              classifications on this pay run. Review the highlighted lines
              before signing this certified payroll.
            </p>
            <ul className="mt-2 space-y-2">
              {report.recentRateChanges.map((p) => {
                const detected = p.latestDetectedAt
                  ? new Date(p.latestDetectedAt).toLocaleDateString()
                  : null;
                const isPending = pendingAckProjectId === p.projectId;
                return (
                  <li
                    key={p.projectId}
                    className="flex flex-wrap items-center gap-2"
                    data-testid={`row-recent-rate-change-${p.projectId}`}
                  >
                    <span
                      className="flex-1 min-w-[200px]"
                      data-testid={`text-recent-rate-change-summary-${p.projectId}`}
                    >
                      {p.projectName ? `${p.projectName}: ` : ""}
                      <span className="font-medium">
                        {p.count} classification{p.count === 1 ? "" : "s"}
                      </span>
                      {" on "}
                      <span className="font-mono">{p.wageDecision}</span>
                      {detected ? <> (detected {detected})</> : null}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      // Disable every Acknowledge button while any project's
                      // mutation is in flight so a PM can't kick off two
                      // overlapping POSTs (and so the disabled state is
                      // consistent across the banner).
                      disabled={acknowledgeRateChangesMutation.isPending}
                      onClick={() => acknowledgeRateChangesMutation.mutate(p.projectId)}
                      data-testid={`button-acknowledge-rate-changes-${p.projectId}`}
                    >
                      {isPending ? (
                        <>
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" /> Acknowledging…
                        </>
                      ) : (
                        <>
                          <BellOff className="w-3 h-3 mr-1" /> Acknowledge
                        </>
                      )}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      {hasMultipleProjects ? (
        projectReports.map((pr, idx) => (
          <Fragment key={idx}>
            {idx > 0 && <Separator className="my-6" />}
            <div>
              <h3 className="font-semibold text-base mb-3" data-testid={`text-project-header-${idx}`}>
                Project {idx + 1}: {pr.header.projectName}
              </h3>
              <WH347Table employees={pr.employees} totals={pr.totals} header={pr.header} />
            </div>
          </Fragment>
        ))
      ) : (
        <WH347Table employees={report.employees} totals={report.totals} header={report.header} />
      )}

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

      {/* Task #1485: soft-confirm dialog shown when the certified-payroll
          PDF endpoint returns 412 because one or more classifications on
          this pay run have unacknowledged Davis-Bacon rate changes and the
          org/project policy is WARN. Confirming retries the download with
          `acknowledged=true` so the PDF actually generates. */}
      <AlertDialog
        open={!!signingConfirm}
        onOpenChange={(open) => {
          if (!open) setSigningConfirm(null);
        }}
      >
        <AlertDialogContent data-testid="dialog-signing-rate-change-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Davis-Bacon rate changes not yet acknowledged</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  {signingConfirm?.error
                    || "One or more classifications on this pay run have a Davis-Bacon rate change that hasn't been acknowledged."}
                </p>
                {signingConfirm && signingConfirm.recentRateChanges.length > 0 && (
                  <ul
                    className="mt-1 max-h-40 overflow-y-auto rounded border border-muted bg-muted/30 p-2 text-xs"
                    data-testid="list-signing-rate-change-classifications"
                  >
                    {signingConfirm.recentRateChanges.map((rc, i) => (
                      <li key={`${rc.projectId}-${rc.normalizedClassification}-${i}`}>
                        <span className="font-medium">{rc.projectName || rc.projectId}</span>:{" "}
                        <span className="font-mono">{rc.normalizedClassification}</span>{" "}
                        <span className="text-muted-foreground">
                          ({rc.changeKind}
                          {rc.detectedAt ? `, ${rc.detectedAt.slice(0, 10)}` : ""})
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-muted-foreground">
                  Confirming will sign and download the PDF anyway. To suppress this prompt
                  permanently, switch the rate-change signing policy to OFF; to require an explicit
                  acknowledgement before signing, switch it to BLOCK.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-signing-rate-change-cancel">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-signing-rate-change-confirm"
              onClick={() => {
                setSigningConfirm(null);
                void downloadPdf(true);
              }}
            >
              Sign anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
