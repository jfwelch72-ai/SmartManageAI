import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { format } from "date-fns";
import {
  Plus, Loader2, Trash2, Wrench, Calendar, DollarSign, Filter,
  Clock, AlertTriangle, Shield, BarChart3, CalendarClock, Power, PenLine, Paperclip, Download,
} from "lucide-react";
import { ObjectUploader } from "@/components/ObjectUploader";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

type MaintenanceType = "PREVENTIVE" | "CORRECTIVE" | "EMERGENCY";
type MaintenanceSystem = "HVAC" | "PLUMBING" | "ELECTRICAL" | "ROOFING" | "STRUCTURAL" | "FIRE_PROTECTION" | "ELEVATOR" | "LANDSCAPING" | "GENERAL" | "OTHER";
type RecurringFrequency = "WEEKLY" | "MONTHLY" | "QUARTERLY" | "SEMI_ANNUAL" | "ANNUAL";

interface MaintenanceLog {
  id: string;
  projectId: string;
  date: string;
  type: MaintenanceType;
  system: MaintenanceSystem;
  title: string;
  description?: string | null;
  cost?: string | null;
  vendorName?: string | null;
  documentUrl?: string | null;
  documentFilename?: string | null;
  createdAt: string;
}

interface RecurringSchedule {
  id: string;
  projectId: string;
  title: string;
  system: MaintenanceSystem;
  frequency: RecurringFrequency;
  description?: string | null;
  nextDueDate?: string | null;
  isActive: boolean;
  createdAt: string;
}

interface CostSummary {
  totalCost: number;
  totalEntries: number;
  bySystem: Record<string, number>;
  byType: Record<string, number>;
  costOverTime: Array<{ month: string; cost: number }>;
}

interface MaintenanceLogsTabProps {
  projectId: string;
  projectCode: string;
  userRole: string;
  handoverComplete?: boolean;
}

const MANAGEMENT_ROLES = ["ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR"];
function canManage(role: string) { return MANAGEMENT_ROLES.includes(role); }

const TYPE_OPTIONS: { value: MaintenanceType; label: string; icon: typeof Wrench }[] = [
  { value: "PREVENTIVE", label: "Preventive", icon: Shield },
  { value: "CORRECTIVE", label: "Corrective", icon: Wrench },
  { value: "EMERGENCY", label: "Emergency", icon: AlertTriangle },
];

const SYSTEM_OPTIONS: { value: MaintenanceSystem; label: string }[] = [
  { value: "HVAC", label: "HVAC" },
  { value: "PLUMBING", label: "Plumbing" },
  { value: "ELECTRICAL", label: "Electrical" },
  { value: "ROOFING", label: "Roofing" },
  { value: "STRUCTURAL", label: "Structural" },
  { value: "FIRE_PROTECTION", label: "Fire Protection" },
  { value: "ELEVATOR", label: "Elevator" },
  { value: "LANDSCAPING", label: "Landscaping" },
  { value: "GENERAL", label: "General" },
  { value: "OTHER", label: "Other" },
];

const FREQUENCY_OPTIONS: { value: RecurringFrequency; label: string }[] = [
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "QUARTERLY", label: "Quarterly" },
  { value: "SEMI_ANNUAL", label: "Semi-Annual" },
  { value: "ANNUAL", label: "Annual" },
];

const TYPE_COLORS: Record<string, string> = {
  PREVENTIVE: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  CORRECTIVE: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  EMERGENCY: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

const SYSTEM_COLORS: Record<string, string> = {
  HVAC: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400",
  PLUMBING: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  ELECTRICAL: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  ROOFING: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  STRUCTURAL: "bg-gray-100 text-gray-800 dark:bg-gray-700/30 dark:text-gray-400",
  FIRE_PROTECTION: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  ELEVATOR: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  LANDSCAPING: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  GENERAL: "bg-gray-100 text-gray-700 dark:bg-gray-700/30 dark:text-gray-300",
  OTHER: "bg-gray-100 text-gray-700 dark:bg-gray-700/30 dark:text-gray-300",
};

function fmtDate(d?: string | null) { if (!d) return "—"; return format(new Date(d), "MMM d, yyyy"); }
function fmtCurrency(v?: string | number | null) {
  if (v === null || v === undefined) return "—";
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

export default function MaintenanceLogsTab({ projectId, projectCode, userRole, handoverComplete }: MaintenanceLogsTabProps) {
  const [subTab, setSubTab] = useState("logs");
  const [showLogDialog, setShowLogDialog] = useState(false);
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [editingLog, setEditingLog] = useState<MaintenanceLog | null>(null);
  const [filterType, setFilterType] = useState("all");
  const [filterSystem, setFilterSystem] = useState("all");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [logForm, setLogForm] = useState({ title: "", type: "PREVENTIVE" as MaintenanceType, system: "GENERAL" as MaintenanceSystem, date: "", description: "", cost: "", vendorName: "", documentUrl: "" as string | null, documentFilename: "" as string | null });
  const [scheduleForm, setScheduleForm] = useState({ title: "", system: "GENERAL" as MaintenanceSystem, frequency: "MONTHLY" as RecurringFrequency, description: "", nextDueDate: "" });
  const { toast } = useToast();
  const qc = useQueryClient();

  const logsKey = ["/api/projects", projectCode, "maintenance", "logs"];
  const summaryKey = ["/api/projects", projectCode, "maintenance", "summary"];
  const schedulesKey = ["/api/projects", projectCode, "maintenance", "schedules"];

  const buildLogsUrl = () => {
    const params = new URLSearchParams();
    if (filterType !== "all") params.set("type", filterType);
    if (filterSystem !== "all") params.set("system", filterSystem);
    if (filterDateFrom) params.set("dateFrom", filterDateFrom);
    if (filterDateTo) params.set("dateTo", filterDateTo);
    const qs = params.toString();
    return `/api/projects/${projectCode}/maintenance/logs${qs ? `?${qs}` : ""}`;
  };

  const { data: logs = [], isLoading: logsLoading } = useQuery<MaintenanceLog[]>({
    queryKey: [...logsKey, filterType, filterSystem, filterDateFrom, filterDateTo],
    queryFn: () => apiRequest("GET", buildLogsUrl()).then(r => r.json()),
  });

  const { data: summary } = useQuery<CostSummary>({
    queryKey: summaryKey,
    queryFn: () => apiRequest("GET", `/api/projects/${projectCode}/maintenance/summary`).then(r => r.json()),
  });

  const { data: schedules = [] } = useQuery<RecurringSchedule[]>({
    queryKey: schedulesKey,
    queryFn: () => apiRequest("GET", `/api/projects/${projectCode}/maintenance/schedules`).then(r => r.json()),
  });

  const createLogMutation = useMutation({
    mutationFn: (data: object) => apiRequest("POST", `/api/projects/${projectCode}/maintenance/logs`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: logsKey });
      qc.invalidateQueries({ queryKey: summaryKey });
      setShowLogDialog(false);
      setLogForm({ title: "", type: "PREVENTIVE", system: "GENERAL", date: "", description: "", cost: "", vendorName: "", documentUrl: null, documentFilename: null });
    },
    onError: () => toast({ title: "Error", description: "Failed to create log.", variant: "destructive" }),
  });

  const deleteLogMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/projects/${projectCode}/maintenance/logs/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: logsKey }); qc.invalidateQueries({ queryKey: summaryKey }); },
    onError: () => toast({ title: "Error", description: "Failed to delete log.", variant: "destructive" }),
  });

  const updateLogMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: object }) => apiRequest("PATCH", `/api/projects/${projectCode}/maintenance/logs/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: logsKey });
      qc.invalidateQueries({ queryKey: summaryKey });
      setEditingLog(null);
      toast({ title: "Log updated" });
    },
    onError: () => toast({ title: "Error", description: "Failed to update log.", variant: "destructive" }),
  });

  const createScheduleMutation = useMutation({
    mutationFn: (data: object) => apiRequest("POST", `/api/projects/${projectCode}/maintenance/schedules`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: schedulesKey });
      setShowScheduleDialog(false);
      setScheduleForm({ title: "", system: "GENERAL", frequency: "MONTHLY", description: "", nextDueDate: "" });
    },
    onError: () => toast({ title: "Error", description: "Failed to create schedule.", variant: "destructive" }),
  });

  const toggleScheduleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiRequest("PATCH", `/api/projects/${projectCode}/maintenance/schedules/${id}`, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: schedulesKey }),
  });

  const deleteScheduleMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/projects/${projectCode}/maintenance/schedules/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: schedulesKey }),
    onError: () => toast({ title: "Error", description: "Failed to delete schedule.", variant: "destructive" }),
  });

  const isMgr = canManage(userRole);

  return (
    <div className="space-y-6">
      {handoverComplete === false && (
        <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20" data-testid="card-maintenance-handover-pending">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-amber-600" />
              <div>
                <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Handover In Progress</p>
                <p className="text-xs text-amber-700 dark:text-amber-400">Maintenance logging is available from handover onward. Complete the asset handover signoff to finalize the lifecycle workflow.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      <Tabs value={subTab} onValueChange={setSubTab}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <TabsList>
            <TabsTrigger value="logs" data-testid="tab-maintenance-logs"><Wrench className="w-4 h-4 mr-1" /> Logs</TabsTrigger>
            <TabsTrigger value="schedules" data-testid="tab-maintenance-schedules"><CalendarClock className="w-4 h-4 mr-1" /> Schedules</TabsTrigger>
            <TabsTrigger value="dashboard" data-testid="tab-maintenance-dashboard"><BarChart3 className="w-4 h-4 mr-1" /> Cost Summary</TabsTrigger>
          </TabsList>
          {isMgr && subTab === "logs" && (
            <Button size="sm" onClick={() => setShowLogDialog(true)} disabled={handoverComplete === false} title={handoverComplete === false ? "Complete handover signoff first" : undefined} data-testid="button-add-maintenance-log">
              <Plus className="w-4 h-4 mr-2" /> Log Entry
            </Button>
          )}
          {isMgr && subTab === "schedules" && (
            <Button size="sm" onClick={() => setShowScheduleDialog(true)} disabled={handoverComplete === false} title={handoverComplete === false ? "Complete handover signoff first" : undefined} data-testid="button-add-recurring-schedule">
              <Plus className="w-4 h-4 mr-2" /> Add Schedule
            </Button>
          )}
        </div>

        <TabsContent value="logs" className="space-y-4 mt-4">
          <div className="flex gap-2 flex-wrap">
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-40 h-8 text-sm" data-testid="select-filter-type">
                <Filter className="w-3 h-3 mr-1" /><SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {TYPE_OPTIONS.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterSystem} onValueChange={setFilterSystem}>
              <SelectTrigger className="w-40 h-8 text-sm" data-testid="select-filter-system">
                <Filter className="w-3 h-3 mr-1" /><SelectValue placeholder="System" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Systems</SelectItem>
                {SYSTEM_OPTIONS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={filterDateFrom}
              onChange={e => setFilterDateFrom(e.target.value)}
              className="w-36 h-8 text-sm"
              placeholder="From"
              data-testid="input-filter-date-from"
            />
            <Input
              type="date"
              value={filterDateTo}
              onChange={e => setFilterDateTo(e.target.value)}
              className="w-36 h-8 text-sm"
              placeholder="To"
              data-testid="input-filter-date-to"
            />
          </div>

          {logsLoading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Wrench className="w-12 h-12 text-muted-foreground mb-4 opacity-40" />
              <h3 className="text-lg font-semibold mb-1">No Maintenance Logs</h3>
              <p className="text-muted-foreground text-sm mb-6 max-w-sm">
                Log maintenance events to track work done on this property.
              </p>
              {isMgr && (
                <Button onClick={() => setShowLogDialog(true)} disabled={handoverComplete === false} title={handoverComplete === false ? "Complete handover signoff first" : undefined} data-testid="button-add-maintenance-log-empty">
                  <Plus className="w-4 h-4 mr-2" /> Log First Entry
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {logs.map(log => (
                <Card key={log.id} data-testid={`card-maintenance-log-${log.id}`}>
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${TYPE_COLORS[log.type]}`}>{log.type.replace(/_/g, " ")}</span>
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${SYSTEM_COLORS[log.system]}`}>{log.system.replace(/_/g, " ")}</span>
                        </div>
                        <h3 className="font-semibold text-sm">{log.title}</h3>
                        {log.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{log.description}</p>}
                        <div className="flex items-center gap-3 mt-2 flex-wrap text-xs text-muted-foreground">
                          <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{fmtDate(log.date)}</span>
                          {log.cost && <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" />{fmtCurrency(log.cost)}</span>}
                          {log.vendorName && <span className="flex items-center gap-1"><Wrench className="w-3 h-3" />{log.vendorName}</span>}
                          {log.documentUrl && (
                            <a href={log.documentUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-blue-600 hover:underline" data-testid={`link-log-doc-${log.id}`}>
                              <Paperclip className="w-3 h-3" />{log.documentFilename || "Attachment"}
                            </a>
                          )}
                        </div>
                      </div>
                      {isMgr && (
                        <div className="flex items-center gap-1">
                          <Button
                            size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-primary"
                            onClick={() => { setEditingLog(log); setLogForm({ title: log.title, type: log.type, system: log.system, date: log.date ? log.date.substring(0, 10) : "", description: log.description || "", cost: log.cost || "", vendorName: log.vendorName || "", documentUrl: log.documentUrl || null, documentFilename: log.documentFilename || null }); }}
                            data-testid={`button-edit-log-${log.id}`}
                          >
                            <PenLine className="w-3.5 h-3.5" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" data-testid={`button-delete-log-${log.id}`}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete Log Entry</AlertDialogTitle>
                                <AlertDialogDescription>Delete "{log.title}"? This cannot be undone.</AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => deleteLogMutation.mutate(log.id)} className="bg-destructive hover:bg-destructive/90">Delete</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="schedules" className="space-y-4 mt-4">
          {schedules.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <CalendarClock className="w-12 h-12 text-muted-foreground mb-4 opacity-40" />
              <h3 className="text-lg font-semibold mb-1">No Recurring Schedules</h3>
              <p className="text-muted-foreground text-sm mb-6 max-w-sm">
                Set up recurring maintenance schedules (e.g., HVAC filter changes, annual roof inspections).
              </p>
              {isMgr && (
                <Button onClick={() => setShowScheduleDialog(true)} disabled={handoverComplete === false} title={handoverComplete === false ? "Complete handover signoff first" : undefined} data-testid="button-add-schedule-empty">
                  <Plus className="w-4 h-4 mr-2" /> Add Schedule
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {schedules.map(sched => (
                <Card key={sched.id} className={!sched.isActive ? "opacity-60" : ""} data-testid={`card-schedule-${sched.id}`}>
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${SYSTEM_COLORS[sched.system]}`}>{sched.system.replace(/_/g, " ")}</span>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{sched.frequency.replace(/_/g, " ")}</span>
                          {!sched.isActive && <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400">Paused</span>}
                        </div>
                        <h3 className="font-semibold text-sm">{sched.title}</h3>
                        {sched.description && <p className="text-xs text-muted-foreground mt-1">{sched.description}</p>}
                        {sched.nextDueDate && (
                          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                            <Clock className="w-3 h-3" /> Next due: {fmtDate(sched.nextDueDate)}
                          </p>
                        )}
                      </div>
                      {isMgr && (
                        <div className="flex items-center gap-1">
                          <Button
                            size="icon" variant="ghost" className="h-7 w-7"
                            onClick={() => toggleScheduleMutation.mutate({ id: sched.id, isActive: !sched.isActive })}
                            data-testid={`button-toggle-schedule-${sched.id}`}
                          >
                            <Power className={`w-3.5 h-3.5 ${sched.isActive ? "text-green-600" : "text-muted-foreground"}`} />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" data-testid={`button-delete-schedule-${sched.id}`}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete Schedule</AlertDialogTitle>
                                <AlertDialogDescription>Delete "{sched.title}"? This cannot be undone.</AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => deleteScheduleMutation.mutate(sched.id)} className="bg-destructive hover:bg-destructive/90">Delete</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="dashboard" className="space-y-4 mt-4">
          {!summary ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <Card className="p-4 text-center">
                  <div className="text-2xl font-bold">{summary.totalEntries}</div>
                  <div className="text-xs text-muted-foreground">Total Entries</div>
                </Card>
                <Card className="p-4 text-center">
                  <div className="text-2xl font-bold text-green-600 dark:text-green-400">{fmtCurrency(summary.totalCost)}</div>
                  <div className="text-xs text-muted-foreground">Total Cost</div>
                </Card>
                <Card className="p-4 text-center">
                  <div className="text-2xl font-bold">{schedules.filter(s => s.isActive).length}</div>
                  <div className="text-xs text-muted-foreground">Active Schedules</div>
                </Card>
              </div>

              {Object.keys(summary.bySystem).length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Cost by System</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {Object.entries(summary.bySystem)
                        .sort(([, a], [, b]) => b - a)
                        .map(([system, cost]) => {
                          const pct = summary.totalCost > 0 ? (cost / summary.totalCost) * 100 : 0;
                          return (
                            <div key={system} className="flex items-center gap-3" data-testid={`cost-system-${system}`}>
                              <span className="text-sm w-32 truncate">{system.replace(/_/g, " ")}</span>
                              <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
                                <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-sm font-medium w-24 text-right">{fmtCurrency(cost)}</span>
                            </div>
                          );
                        })}
                    </div>
                  </CardContent>
                </Card>
              )}

              {Object.keys(summary.byType).length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Cost by Type</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {Object.entries(summary.byType)
                        .sort(([, a], [, b]) => b - a)
                        .map(([type, cost]) => {
                          const pct = summary.totalCost > 0 ? (cost / summary.totalCost) * 100 : 0;
                          return (
                            <div key={type} className="flex items-center gap-3" data-testid={`cost-type-${type}`}>
                              <span className="text-sm w-32 truncate">{type.replace(/_/g, " ")}</span>
                              <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
                                <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-sm font-medium w-24 text-right">{fmtCurrency(cost)}</span>
                            </div>
                          );
                        })}
                    </div>
                  </CardContent>
                </Card>
              )}

              {summary.costOverTime && summary.costOverTime.length > 1 && (
                <Card data-testid="card-cost-over-time">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Cost Over Time</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart data={summary.costOverTime}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                        <YAxis tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(v: number) => [fmtCurrency(v), "Cost"]} />
                        <Bar dataKey="cost" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={showLogDialog} onOpenChange={setShowLogDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Log Maintenance Entry</DialogTitle>
            <DialogDescription>Record a maintenance event for this property.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Title</Label>
              <Input value={logForm.title} onChange={e => setLogForm(p => ({ ...p, title: e.target.value }))} placeholder="e.g. HVAC Filter Replacement" data-testid="input-log-title" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Type</Label>
                <Select value={logForm.type} onValueChange={v => setLogForm(p => ({ ...p, type: v as MaintenanceType }))}>
                  <SelectTrigger data-testid="select-log-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TYPE_OPTIONS.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>System</Label>
                <Select value={logForm.system} onValueChange={v => setLogForm(p => ({ ...p, system: v as MaintenanceSystem }))}>
                  <SelectTrigger data-testid="select-log-system"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SYSTEM_OPTIONS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Date</Label>
                <Input type="date" value={logForm.date} onChange={e => setLogForm(p => ({ ...p, date: e.target.value }))} data-testid="input-log-date" />
              </div>
              <div>
                <Label>Cost ($)</Label>
                <Input type="number" step="0.01" value={logForm.cost} onChange={e => setLogForm(p => ({ ...p, cost: e.target.value }))} placeholder="0.00" data-testid="input-log-cost" />
              </div>
            </div>
            <div>
              <Label>Vendor / Contractor</Label>
              <Input value={logForm.vendorName} onChange={e => setLogForm(p => ({ ...p, vendorName: e.target.value }))} placeholder="Who performed the work" data-testid="input-log-vendor" />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea value={logForm.description} onChange={e => setLogForm(p => ({ ...p, description: e.target.value }))} rows={3} data-testid="input-log-description" />
            </div>
            <div>
              <Label>Attachment</Label>
              {logForm.documentUrl ? (
                <div className="flex items-center gap-2 mt-1">
                  <Paperclip className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-sm">{logForm.documentFilename || "Attached file"}</span>
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-destructive" onClick={() => setLogForm(p => ({ ...p, documentUrl: null, documentFilename: null }))} data-testid="button-remove-log-attachment">Remove</Button>
                </div>
              ) : (
                <div className="mt-1">
                  <ObjectUploader
                    maxNumberOfFiles={1}
                    maxFileSize={25 * 1024 * 1024}
                    fileType="DOCUMENT"
                    onComplete={(result) => {
                      const f = result.successful?.[0];
                      if (f) {
                        setLogForm(p => ({ ...p, documentUrl: f.uploadURL ?? "", documentFilename: f.name ?? "attachment" }));
                      }
                    }}
                    buttonVariant="outline"
                    buttonClassName="h-8"
                    testId="button-upload-log-attachment"
                  >
                    <Paperclip className="w-3.5 h-3.5 mr-1" /> Attach File
                  </ObjectUploader>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLogDialog(false)}>Cancel</Button>
            <Button
              onClick={() => createLogMutation.mutate({
                title: logForm.title,
                type: logForm.type,
                system: logForm.system,
                date: logForm.date || new Date().toISOString(),
                description: logForm.description || null,
                cost: logForm.cost || null,
                vendorName: logForm.vendorName || null,
                documentUrl: logForm.documentUrl || null,
                documentFilename: logForm.documentFilename || null,
              })}
              disabled={!logForm.title.trim() || createLogMutation.isPending}
              data-testid="button-submit-log"
            >
              {createLogMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
              Log Entry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showScheduleDialog} onOpenChange={setShowScheduleDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Recurring Schedule</DialogTitle>
            <DialogDescription>Set up a recurring maintenance schedule.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Title</Label>
              <Input value={scheduleForm.title} onChange={e => setScheduleForm(p => ({ ...p, title: e.target.value }))} placeholder="e.g. HVAC Filter Change" data-testid="input-schedule-title" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>System</Label>
                <Select value={scheduleForm.system} onValueChange={v => setScheduleForm(p => ({ ...p, system: v as MaintenanceSystem }))}>
                  <SelectTrigger data-testid="select-schedule-system"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SYSTEM_OPTIONS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Frequency</Label>
                <Select value={scheduleForm.frequency} onValueChange={v => setScheduleForm(p => ({ ...p, frequency: v as RecurringFrequency }))}>
                  <SelectTrigger data-testid="select-schedule-frequency"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FREQUENCY_OPTIONS.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Next Due Date</Label>
              <Input type="date" value={scheduleForm.nextDueDate} onChange={e => setScheduleForm(p => ({ ...p, nextDueDate: e.target.value }))} data-testid="input-schedule-next-due" />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea value={scheduleForm.description} onChange={e => setScheduleForm(p => ({ ...p, description: e.target.value }))} rows={2} data-testid="input-schedule-description" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowScheduleDialog(false)}>Cancel</Button>
            <Button
              onClick={() => createScheduleMutation.mutate({
                title: scheduleForm.title,
                system: scheduleForm.system,
                frequency: scheduleForm.frequency,
                description: scheduleForm.description || null,
                nextDueDate: scheduleForm.nextDueDate || null,
              })}
              disabled={!scheduleForm.title.trim() || createScheduleMutation.isPending}
              data-testid="button-submit-schedule"
            >
              {createScheduleMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
              Add Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingLog} onOpenChange={v => { if (!v) setEditingLog(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Maintenance Entry</DialogTitle>
            <DialogDescription>Update the details of this maintenance log.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Title</Label>
              <Input value={logForm.title} onChange={e => setLogForm(p => ({ ...p, title: e.target.value }))} data-testid="input-edit-log-title" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Type</Label>
                <Select value={logForm.type} onValueChange={v => setLogForm(p => ({ ...p, type: v as MaintenanceType }))}>
                  <SelectTrigger data-testid="select-edit-log-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TYPE_OPTIONS.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>System</Label>
                <Select value={logForm.system} onValueChange={v => setLogForm(p => ({ ...p, system: v as MaintenanceSystem }))}>
                  <SelectTrigger data-testid="select-edit-log-system"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SYSTEM_OPTIONS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Date</Label>
                <Input type="date" value={logForm.date} onChange={e => setLogForm(p => ({ ...p, date: e.target.value }))} data-testid="input-edit-log-date" />
              </div>
              <div>
                <Label>Cost ($)</Label>
                <Input type="number" step="0.01" value={logForm.cost} onChange={e => setLogForm(p => ({ ...p, cost: e.target.value }))} data-testid="input-edit-log-cost" />
              </div>
            </div>
            <div>
              <Label>Vendor / Contractor</Label>
              <Input value={logForm.vendorName} onChange={e => setLogForm(p => ({ ...p, vendorName: e.target.value }))} data-testid="input-edit-log-vendor" />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea value={logForm.description} onChange={e => setLogForm(p => ({ ...p, description: e.target.value }))} rows={3} data-testid="input-edit-log-description" />
            </div>
            <div>
              <Label>Attachment</Label>
              {logForm.documentUrl ? (
                <div className="flex items-center gap-2 mt-1">
                  <Paperclip className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-sm">{logForm.documentFilename || "Attached file"}</span>
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-destructive" onClick={() => setLogForm(p => ({ ...p, documentUrl: null, documentFilename: null }))} data-testid="button-remove-edit-log-attachment">Remove</Button>
                </div>
              ) : (
                <div className="mt-1">
                  <ObjectUploader
                    maxNumberOfFiles={1}
                    maxFileSize={25 * 1024 * 1024}
                    fileType="DOCUMENT"
                    onComplete={(result) => {
                      const f = result.successful?.[0];
                      if (f) {
                        setLogForm(p => ({ ...p, documentUrl: f.uploadURL ?? "", documentFilename: f.name ?? "attachment" }));
                      }
                    }}
                    buttonVariant="outline"
                    buttonClassName="h-8"
                    testId="button-upload-edit-log-attachment"
                  >
                    <Paperclip className="w-3.5 h-3.5 mr-1" /> Attach File
                  </ObjectUploader>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingLog(null)}>Cancel</Button>
            <Button
              onClick={() => editingLog && updateLogMutation.mutate({
                id: editingLog.id,
                data: {
                  title: logForm.title,
                  type: logForm.type,
                  system: logForm.system,
                  date: logForm.date || undefined,
                  description: logForm.description || null,
                  cost: logForm.cost || null,
                  vendorName: logForm.vendorName || null,
                  documentUrl: logForm.documentUrl || null,
                  documentFilename: logForm.documentFilename || null,
                },
              })}
              disabled={!logForm.title.trim() || updateLogMutation.isPending}
              data-testid="button-submit-edit-log"
            >
              {updateLogMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PenLine className="w-4 h-4 mr-2" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
