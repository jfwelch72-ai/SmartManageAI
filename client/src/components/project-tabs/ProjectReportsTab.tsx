import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  FileText, Download, Trash2, Plus, Loader2, Calendar,
  ClipboardList, Clock, CheckCircle, XCircle, AlertTriangle,
  BarChart3, Users, Shield, HardHat, Settings, Mail
} from "lucide-react";
import { format, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { useFeatureFlags } from "@/hooks/use-feature-flags";

interface ReportData {
  project: { id: string; name: string; projectCode: string | null; status: string };
  period: { start: string; end: string; type: string };
  dailyNotes: { total: number; entries: Array<{ date: string | null; text: string; type: string | null }> };
  labor: { totalRegularHours: number; totalOvertimeHours: number; totalHours: number; uniqueWorkers: number; entriesCount: number };
  safety: { ppeViolations: number; materialTestsFailed: number; totalIncidents: number };
  schedule: { totalTasks: number; completedTasks: number; inProgressTasks: number; delayedTasks: number; startedTasks: number };
  changeOrders: { total: number; items: Array<{ number: number | null; description: string | null; amount: string | null; status: string }> };
  financials: { budget: number; actualCost: number; variance: number; variancePercent: number; changeOrdersSummary: { approved: number; pending: number } } | null;
  procurement: { totalOrders: number; received: number; pending: number } | null;
  subcontractors: { totalSubcontracts: number; payApplicationsInPeriod: number; totalContractValue: number; billedToDate: number } | null;
  materialsReceived: { totalDeliveries: number; totalAmount: number; items: Array<{ description: string; amount: number; vendor: string | null; deliveryDate: string | null }> } | null;
  weatherSummary: { daysWithData: number; entries: Array<{ date: string; conditions: string }> } | null;
  keyPhotos: { totalPhotos: number; batches: number } | null;
  healthScore: number | null;
}

interface ProjectReport {
  id: string;
  projectId: string;
  reportType: "WEEKLY" | "MONTHLY";
  title: string;
  dateRangeStart: string;
  dateRangeEnd: string;
  status: "GENERATING" | "COMPLETED" | "FAILED";
  generatedById: string | null;
  reportData: ReportData | null;
  generatedAt: string | null;
  createdAt: string;
}

interface ProjectReportsTabProps {
  projectId: string;
}

interface ReportSettings {
  projectId: string;
  autoWeekly: boolean;
  autoMonthly: boolean;
  emailRecipients: string[];
}

export default function ProjectReportsTab({ projectId }: ProjectReportsTabProps) {
  const { toast } = useToast();
  const [showGenerateDialog, setShowGenerateDialog] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [reportType, setReportType] = useState<"WEEKLY" | "MONTHLY">("WEEKLY");
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [expandedReportId, setExpandedReportId] = useState<string | null>(null);
  const [recipientInput, setRecipientInput] = useState("");
  const [emailRecipients, setEmailRecipients] = useState<string[]>([]);

  const { data: reports = [], isLoading } = useQuery<ProjectReport[]>({
    queryKey: ["/api/projects", projectId, "progress-reports"],
    enabled: !!projectId,
  });

  const { data: settings } = useQuery<ReportSettings>({
    queryKey: ["/api/projects", projectId, "progress-reports", "settings"],
    enabled: !!projectId,
  });

  useEffect(() => {
    if (settings) {
      setEmailRecipients(settings.emailRecipients || []);
    }
  }, [settings]);

  const settingsMutation = useMutation({
    mutationFn: async (data: { autoWeekly: boolean; autoMonthly: boolean; emailRecipients: string[] }) => {
      const res = await apiRequest("PUT", `/api/projects/${projectId}/progress-reports/settings`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "progress-reports", "settings"] });
      toast({ title: "Settings Saved", description: "Report automation settings updated." });
    },
    onError: () => {
      toast({ variant: "destructive", title: "Error", description: "Failed to save settings." });
    },
  });

  const generateMutation = useMutation({
    mutationFn: async (data: { reportType: string; dateRangeStart: string; dateRangeEnd: string }) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/progress-reports/generate`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "progress-reports"] });
      setShowGenerateDialog(false);
      toast({ title: "Report Generated", description: "Your progress report has been generated successfully." });
    },
    onError: (err: Error) => {
      toast({ variant: "destructive", title: "Error", description: err.message || "Failed to generate report." });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (reportId: string) => {
      await apiRequest("DELETE", `/api/projects/${projectId}/progress-reports/${reportId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "progress-reports"] });
      toast({ title: "Report Deleted", description: "Report has been removed." });
    },
    onError: (err: Error) => {
      toast({ variant: "destructive", title: "Error", description: err.message || "Failed to delete report." });
    },
  });

  const handleOpenGenerate = () => {
    const now = new Date();
    if (reportType === "WEEKLY") {
      const ws = startOfWeek(subDays(now, 7), { weekStartsOn: 1 });
      const we = endOfWeek(subDays(now, 7), { weekStartsOn: 1 });
      setDateStart(format(ws, "yyyy-MM-dd"));
      setDateEnd(format(we, "yyyy-MM-dd"));
    } else {
      const ms = startOfMonth(subMonths(now, 1));
      const me = endOfMonth(subMonths(now, 1));
      setDateStart(format(ms, "yyyy-MM-dd"));
      setDateEnd(format(me, "yyyy-MM-dd"));
    }
    setShowGenerateDialog(true);
  };

  const handleGenerate = () => {
    if (!dateStart || !dateEnd) return;
    generateMutation.mutate({ reportType, dateRangeStart: dateStart, dateRangeEnd: dateEnd });
  };

  const handleDownloadPdf = async (reportId: string) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/progress-reports/${reportId}/pdf`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("PDF download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `report_${reportId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to download PDF." });
    }
  };

  const [downloadingHcSummary, setDownloadingHcSummary] = useState(false);
  const [hcSummaryStart, setHcSummaryStart] = useState<string>("");
  const [hcSummaryEnd, setHcSummaryEnd] = useState<string>("");
  // Only show the heavy-civil summary controls when the org has the
  // heavy-civil preset on, or has at least one heavy-civil module enabled.
  const { isEnabled: ffEnabled } = useFeatureFlags();
  const showHeavyCivilSummary = ffEnabled("HEAVY_CIVIL_PRESET")
    || ffEnabled("DAILY_INSPECTOR_REPORTS")
    || ffEnabled("HAUL_TICKETS")
    || ffEnabled("DBE_TRACKING")
    || ffEnabled("BUY_AMERICA")
    || ffEnabled("SURETY_BONDS");
  const handleDownloadHeavyCivilSummary = async () => {
    setDownloadingHcSummary(true);
    try {
      const params = new URLSearchParams();
      if (hcSummaryStart) params.set("startDate", hcSummaryStart);
      if (hcSummaryEnd) params.set("endDate", hcSummaryEnd);
      const qs = params.toString() ? `?${params.toString()}` : "";
      const res = await fetch(`/api/projects/${projectId}/heavy-civil-summary/pdf${qs}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || "Heavy-civil summary download failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `heavy-civil-summary-${projectId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to download summary.",
      });
    } finally {
      setDownloadingHcSummary(false);
    }
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case "COMPLETED": return <CheckCircle className="h-4 w-4 text-green-600" />;
      case "FAILED": return <XCircle className="h-4 w-4 text-red-600" />;
      case "GENERATING": return <Loader2 className="h-4 w-4 animate-spin text-blue-600" />;
      default: return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const statusColor = (status: string): "default" | "secondary" | "destructive" | "outline" => {
    switch (status) {
      case "COMPLETED": return "default";
      case "FAILED": return "destructive";
      default: return "secondary";
    }
  };

  const weeklyCount = reports.filter(r => r.reportType === "WEEKLY").length;
  const monthlyCount = reports.filter(r => r.reportType === "MONTHLY").length;
  const completedCount = reports.filter(r => r.status === "COMPLETED").length;

  return (
    <div className="space-y-6" data-testid="project-reports-tab">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold" data-testid="text-reports-heading">Progress Reports</h2>
          <p className="text-sm text-muted-foreground">Generate and view weekly and monthly progress reports</p>
        </div>
        <div className="flex flex-wrap gap-2 items-end">
          {showHeavyCivilSummary && (
          <div className="flex items-end gap-1.5 px-2 py-1 rounded-md border border-border/60 bg-muted/20" data-testid="hc-summary-controls">
            <div className="flex flex-col">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide" htmlFor="hc-summary-start">From</label>
              <input
                id="hc-summary-start"
                type="date"
                value={hcSummaryStart}
                onChange={(e) => setHcSummaryStart(e.target.value)}
                className="h-8 text-xs px-1.5 rounded border border-input bg-background"
                data-testid="input-hc-summary-start"
              />
            </div>
            <div className="flex flex-col">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide" htmlFor="hc-summary-end">To</label>
              <input
                id="hc-summary-end"
                type="date"
                value={hcSummaryEnd}
                onChange={(e) => setHcSummaryEnd(e.target.value)}
                className="h-8 text-xs px-1.5 rounded border border-input bg-background"
                data-testid="input-hc-summary-end"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadHeavyCivilSummary}
              disabled={downloadingHcSummary}
              data-testid="button-download-heavy-civil-summary"
            >
              {downloadingHcSummary ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <HardHat className="h-4 w-4 mr-2" />
              )}
              Heavy-Civil Summary PDF
            </Button>
          </div>
          )}
          <Button variant="outline" onClick={() => setShowSettings(!showSettings)} data-testid="button-report-settings">
            <Settings className="h-4 w-4 mr-2" />
            Settings
          </Button>
          <Button onClick={handleOpenGenerate} data-testid="button-generate-report">
            <Plus className="h-4 w-4 mr-2" />
            Generate Report
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-md">
                <ClipboardList className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-weekly-count">{weeklyCount}</p>
                <p className="text-xs text-muted-foreground">Weekly Reports</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-md">
                <BarChart3 className="h-5 w-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-monthly-count">{monthlyCount}</p>
                <p className="text-xs text-muted-foreground">Monthly Reports</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-md">
                <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-completed-count">{completedCount}</p>
                <p className="text-xs text-muted-foreground">Completed</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {showSettings && (
        <Card data-testid="report-settings-panel">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Settings className="h-4 w-4" />
              Report Automation Settings
            </CardTitle>
            <CardDescription>Configure automatic report generation and email delivery</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>Auto-generate Weekly Reports</Label>
                <p className="text-xs text-muted-foreground">Automatically generate weekly reports every Monday at 7:00 AM</p>
              </div>
              <Switch
                checked={settings?.autoWeekly ?? false}
                onCheckedChange={(checked) => {
                  settingsMutation.mutate({
                    autoWeekly: checked,
                    autoMonthly: settings?.autoMonthly ?? false,
                    emailRecipients,
                  });
                }}
                data-testid="switch-auto-weekly"
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label>Auto-generate Monthly Reports</Label>
                <p className="text-xs text-muted-foreground">Automatically generate monthly reports on the 1st of each month</p>
              </div>
              <Switch
                checked={settings?.autoMonthly ?? false}
                onCheckedChange={(checked) => {
                  settingsMutation.mutate({
                    autoWeekly: settings?.autoWeekly ?? false,
                    autoMonthly: checked,
                    emailRecipients,
                  });
                }}
                data-testid="switch-auto-monthly"
              />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Mail className="h-4 w-4" />
                Email Recipients
              </Label>
              <p className="text-xs text-muted-foreground">Add email addresses to receive auto-generated reports</p>
              <div className="flex gap-2">
                <Input
                  type="email"
                  placeholder="email@example.com"
                  value={recipientInput}
                  onChange={(e) => setRecipientInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && recipientInput.includes("@")) {
                      e.preventDefault();
                      const updated = [...emailRecipients, recipientInput.trim()];
                      setEmailRecipients(updated);
                      setRecipientInput("");
                      settingsMutation.mutate({
                        autoWeekly: settings?.autoWeekly ?? false,
                        autoMonthly: settings?.autoMonthly ?? false,
                        emailRecipients: updated,
                      });
                    }
                  }}
                  data-testid="input-recipient-email"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (recipientInput.includes("@")) {
                      const updated = [...emailRecipients, recipientInput.trim()];
                      setEmailRecipients(updated);
                      setRecipientInput("");
                      settingsMutation.mutate({
                        autoWeekly: settings?.autoWeekly ?? false,
                        autoMonthly: settings?.autoMonthly ?? false,
                        emailRecipients: updated,
                      });
                    }
                  }}
                  data-testid="button-add-recipient"
                >
                  Add
                </Button>
              </div>
              {emailRecipients.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {emailRecipients.map((email, i) => (
                    <Badge key={i} variant="secondary" className="gap-1">
                      {email}
                      <button
                        className="ml-1 hover:text-destructive"
                        onClick={() => {
                          const updated = emailRecipients.filter((_, idx) => idx !== i);
                          setEmailRecipients(updated);
                          settingsMutation.mutate({
                            autoWeekly: settings?.autoWeekly ?? false,
                            autoMonthly: settings?.autoMonthly ?? false,
                            emailRecipients: updated,
                          });
                        }}
                        data-testid={`button-remove-recipient-${i}`}
                      >
                        ×
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : reports.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No Reports Yet</h3>
            <p className="text-sm text-muted-foreground mb-4">Generate your first progress report to track project performance over time.</p>
            <Button onClick={handleOpenGenerate} data-testid="button-generate-report-empty">
              <Plus className="h-4 w-4 mr-2" />
              Generate Report
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {reports.map((report) => (
            <Card key={report.id} data-testid={`card-report-${report.id}`}>
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    {statusIcon(report.status)}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-medium text-sm truncate" data-testid={`text-report-title-${report.id}`}>
                          {report.title}
                        </h4>
                        <Badge variant={report.reportType === "WEEKLY" ? "outline" : "secondary"} className="text-xs">
                          {report.reportType}
                        </Badge>
                        <Badge variant={statusColor(report.status)} className="text-xs">
                          {report.status}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {report.dateRangeStart} to {report.dateRangeEnd}
                        {report.generatedAt && ` · Generated ${format(new Date(report.generatedAt), "MMM d, yyyy h:mm a")}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {report.status === "COMPLETED" && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setExpandedReportId(expandedReportId === report.id ? null : report.id)}
                          data-testid={`button-view-report-${report.id}`}
                        >
                          <FileText className="h-4 w-4 mr-1" />
                          {expandedReportId === report.id ? "Hide" : "View"}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDownloadPdf(report.id)}
                          data-testid={`button-download-pdf-${report.id}`}
                        >
                          <Download className="h-4 w-4 mr-1" />
                          PDF
                        </Button>
                      </>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteMutation.mutate(report.id)}
                      disabled={deleteMutation.isPending}
                      data-testid={`button-delete-report-${report.id}`}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>

                {expandedReportId === report.id && report.reportData && (
                  <ReportDataView data={report.reportData} />
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showGenerateDialog} onOpenChange={setShowGenerateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate Progress Report</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Report Type</Label>
              <Select
                value={reportType}
                onValueChange={(v) => {
                  setReportType(v as "WEEKLY" | "MONTHLY");
                  const now = new Date();
                  if (v === "WEEKLY") {
                    const ws = startOfWeek(subDays(now, 7), { weekStartsOn: 1 });
                    const we = endOfWeek(subDays(now, 7), { weekStartsOn: 1 });
                    setDateStart(format(ws, "yyyy-MM-dd"));
                    setDateEnd(format(we, "yyyy-MM-dd"));
                  } else {
                    const ms = startOfMonth(subMonths(now, 1));
                    const me = endOfMonth(subMonths(now, 1));
                    setDateStart(format(ms, "yyyy-MM-dd"));
                    setDateEnd(format(me, "yyyy-MM-dd"));
                  }
                }}
              >
                <SelectTrigger data-testid="select-report-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="WEEKLY">Weekly Report</SelectItem>
                  <SelectItem value="MONTHLY">Monthly Report</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input
                  type="date"
                  value={dateStart}
                  onChange={(e) => setDateStart(e.target.value)}
                  data-testid="input-report-date-start"
                />
              </div>
              <div className="space-y-2">
                <Label>End Date</Label>
                <Input
                  type="date"
                  value={dateEnd}
                  onChange={(e) => setDateEnd(e.target.value)}
                  data-testid="input-report-date-end"
                />
              </div>
            </div>
            <div className="p-3 bg-muted/50 rounded-md text-sm text-muted-foreground">
              <p className="font-medium mb-1">Report will include:</p>
              <ul className="list-disc list-inside space-y-0.5 text-xs">
                <li>Daily notes & field reports</li>
                <li>Labor hours & workforce summary</li>
                <li>Safety incidents & PPE compliance</li>
                <li>Schedule progress & task status</li>
                <li>Change orders created in period</li>
                {reportType === "MONTHLY" && (
                  <>
                    <li>Budget vs actual cost summary</li>
                    <li>Overall project health score</li>
                  </>
                )}
              </ul>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowGenerateDialog(false)} data-testid="button-cancel-generate">
              Cancel
            </Button>
            <Button
              onClick={handleGenerate}
              disabled={!dateStart || !dateEnd || generateMutation.isPending}
              data-testid="button-confirm-generate"
            >
              {generateMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating...</>
              ) : (
                <><FileText className="h-4 w-4 mr-2" /> Generate</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReportDataView({ data }: { data: ReportData }) {
  return (
    <div className="mt-4 space-y-4 border-t pt-4" data-testid="report-data-view">
      {data.healthScore != null && (
        <div className="flex items-center gap-3">
          <BarChart3 className="h-5 w-5 text-primary" />
          <div>
            <p className="text-sm font-medium">Project Health Score</p>
            <p className={`text-2xl font-bold ${data.healthScore >= 70 ? "text-green-600" : data.healthScore >= 40 ? "text-yellow-600" : "text-red-600"}`}>
              {data.healthScore}/100
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          icon={<Users className="h-4 w-4" />}
          label="Labor"
          values={[
            { k: "Total Hours", v: data.labor?.totalHours ?? 0 },
            { k: "Regular", v: data.labor?.totalRegularHours ?? 0 },
            { k: "Overtime", v: data.labor?.totalOvertimeHours ?? 0 },
            { k: "Workers", v: data.labor?.uniqueWorkers ?? 0 },
          ]}
        />
        <SummaryCard
          icon={<Shield className="h-4 w-4" />}
          label="Safety"
          values={[
            { k: "PPE Violations", v: data.safety?.ppeViolations ?? 0 },
            { k: "Failed Tests", v: data.safety?.materialTestsFailed ?? 0 },
            { k: "Total Incidents", v: data.safety?.totalIncidents ?? 0 },
          ]}
        />
        <SummaryCard
          icon={<Calendar className="h-4 w-4" />}
          label="Schedule"
          values={[
            { k: "Total Tasks", v: data.schedule?.totalTasks ?? 0 },
            { k: "Started (Period)", v: data.schedule?.startedTasks ?? 0 },
            { k: "Completed", v: data.schedule?.completedTasks ?? 0 },
            { k: "In Progress", v: data.schedule?.inProgressTasks ?? 0 },
            { k: "Delayed", v: data.schedule?.delayedTasks ?? 0 },
          ]}
        />
        <SummaryCard
          icon={<ClipboardList className="h-4 w-4" />}
          label="Activity"
          values={[
            { k: "Daily Notes", v: data.dailyNotes?.total ?? 0 },
            { k: "Change Orders", v: data.changeOrders?.total ?? 0 },
          ]}
        />
      </div>

      {data.financials && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Financial Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground text-xs">Budget</p>
                <p className="font-medium">${data.financials.budget?.toLocaleString() ?? "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Actual Cost (Period)</p>
                <p className="font-medium">${data.financials.actualCost?.toLocaleString() ?? "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Variance</p>
                <p className={`font-medium ${data.financials.variance >= 0 ? "text-green-600" : "text-red-600"}`}>
                  ${data.financials.variance?.toLocaleString() ?? "—"} ({data.financials.variancePercent}%)
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Approved COs</p>
                <p className="font-medium">{data.financials.changeOrdersSummary?.approved ?? 0}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Pending COs</p>
                <p className="font-medium">{data.financials.changeOrdersSummary?.pending ?? 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {data.procurement && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <ClipboardList className="h-4 w-4" />
              Procurement Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground text-xs">Total Orders</p>
                <p className="font-medium">{data.procurement.totalOrders}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Received</p>
                <p className="font-medium">{data.procurement.received}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Pending</p>
                <p className="font-medium">{data.procurement.pending}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {data.subcontractors && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Users className="h-4 w-4" />
              Subcontractor Performance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground text-xs">Active Subcontracts</p>
                <p className="font-medium">{data.subcontractors.totalSubcontracts}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Total Contract Value</p>
                <p className="font-medium">${data.subcontractors.totalContractValue?.toLocaleString() ?? "0"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Billed to Date</p>
                <p className="font-medium">${data.subcontractors.billedToDate?.toLocaleString() ?? "0"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Pay Applications (Period)</p>
                <p className="font-medium">{data.subcontractors.payApplicationsInPeriod}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {data.weatherSummary && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Weather Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-2">{data.weatherSummary.daysWithData} day(s) with weather data</p>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {data.weatherSummary.entries?.slice(0, 10).map((w: { date: string; conditions: string }, i: number) => (
                <div key={i} className="flex justify-between text-xs py-1 border-b last:border-0">
                  <span className="font-medium">{w.date}</span>
                  <span className="text-muted-foreground truncate max-w-[300px]">{w.conditions || "N/A"}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {data.materialsReceived && data.materialsReceived.totalDeliveries > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <ClipboardList className="h-4 w-4" />
              Materials Received
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 text-sm mb-2">
              <div>
                <p className="text-muted-foreground text-xs">Total Deliveries</p>
                <p className="font-medium">{data.materialsReceived.totalDeliveries}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Total Amount</p>
                <p className="font-medium">${data.materialsReceived.totalAmount?.toLocaleString() ?? "0"}</p>
              </div>
            </div>
            {data.materialsReceived.items?.length > 0 && (
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {data.materialsReceived.items.slice(0, 10).map((m: { description: string; amount: number; vendor: string | null }, i: number) => (
                  <div key={i} className="flex justify-between text-xs py-1 border-b last:border-0">
                    <span className="truncate max-w-[200px]">{m.description}</span>
                    <span>${m.amount.toLocaleString()}{m.vendor ? ` (${m.vendor})` : ""}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {data.keyPhotos && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Site Photos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground text-xs">Photos Captured</p>
                <p className="font-medium">{data.keyPhotos.totalPhotos}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Analysis Batches</p>
                <p className="font-medium">{data.keyPhotos.batches}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {data.changeOrders?.items?.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Change Orders in Period</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.changeOrders.items.slice(0, 10).map((co: { number: number | null; description: string | null; amount: string | null; status: string }, i: number) => (
                <div key={i} className="flex items-center justify-between text-sm py-1 border-b last:border-0">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">CO #{co.number}</Badge>
                    <span className="truncate max-w-[300px]">{co.description}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">${parseFloat(co.amount || 0).toLocaleString()}</span>
                    <Badge variant={co.status === "APPROVED" ? "default" : "secondary"} className="text-xs">{co.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {data.dailyNotes?.entries?.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Daily Notes ({data.dailyNotes.total})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {data.dailyNotes.entries.slice(0, 15).map((note: { date: string | null; text: string; type: string | null }, i: number) => (
                <div key={i} className="text-sm py-1 border-b last:border-0">
                  <span className="text-xs text-muted-foreground">
                    {note.date ? format(new Date(note.date), "MMM d") : "—"}
                  </span>
                  <p className="text-foreground">{note.text}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SummaryCard({ icon, label, values }: { icon: React.ReactNode; label: string; values: { k: string; v: number | string }[] }) {
  return (
    <Card>
      <CardContent className="pt-3 pb-3">
        <div className="flex items-center gap-2 mb-2">
          {icon}
          <p className="text-sm font-medium">{label}</p>
        </div>
        <div className="space-y-1">
          {values.map((v, i) => (
            <div key={i} className="flex justify-between text-xs">
              <span className="text-muted-foreground">{v.k}</span>
              <span className="font-medium">{v.v}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
