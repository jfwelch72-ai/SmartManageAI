import { useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Building2, MapPin, User, Phone, Mail, Calendar as CalendarIcon, CheckCircle, DollarSign, Edit, FileSpreadsheet } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/hooks/use-auth";
import { FeaturePermissions, hasManagementAccess } from "@/lib/rbac";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO, differenceInDays } from "date-fns";
import type { ChangeOrder } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useQuery } from "@tanstack/react-query";
import ProjectHealthWidget from "@/components/ProjectHealthWidget";

interface ProjectFinancials {
  budget: number;
  originalContract: number;
  adjustedContract: number;
  contractAdditions: number;
  approvedChangeOrdersTotal: number;
  approvedChangeOrdersCount: number;
  tmCharges: {
    labor: number;
    equipment: number;
    materials: number;
    total: number;
    sheetsCount: number;
  };
  tmTickets?: {
    approved: number;
    approvedTotal: number;
    pending: number;
    pendingTotal: number;
  };
  projectedProfit: number;
  actualProfit: number;
  actualCosts: {
    labor: number;
    laborHours: number;
    laborBaseCost?: number;
    materials: number;
    subcontractors: number;
    otherExpenses: number;
    total: number;
  };
  laborRates?: {
    configured: boolean;
    defaultRegularRate: number | null;
    defaultOvertimeRate: number | null;
    burdenMultiplier: number;
    employeeOverrideCount: number;
  };
  profitVariance: number;
  profitVariancePercent: number;
}

interface OverviewTabProps {
  project: any;
  projectCode: string;
  changeOrders: ChangeOrder[];
  financials?: ProjectFinancials;
  financialsLoading: boolean;
  setActiveTab: (tab: string) => void;
}

export default function OverviewTab({
  project,
  projectCode,
  changeOrders,
  financials,
  financialsLoading,
  setActiveTab,
}: OverviewTabProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const { data: scheduleData } = useQuery<{ schedule: { baselineStartDate: string; baselineEndDate?: string } | null; tasks: { percentComplete: number }[] }>({
    queryKey: ["/api/projects", projectCode, "schedule"],
    enabled: !!projectCode,
  });

  const scheduleDuration = scheduleData?.schedule
    ? differenceInDays(
        parseISO(scheduleData.schedule.baselineEndDate || scheduleData.schedule.baselineStartDate),
        parseISO(scheduleData.schedule.baselineStartDate)
      )
    : null;

  const scheduleProgress = scheduleData?.tasks && scheduleData.tasks.length > 0
    ? Math.round(scheduleData.tasks.reduce((sum, t) => sum + (t.percentComplete || 0), 0) / scheduleData.tasks.length)
    : null;

  const { data: dataQuality, isLoading: dataQualityLoading } = useQuery<{
    overall_score: number;
    has_scope: boolean;
    has_estimates: boolean;
    has_budget: boolean;
    has_timeline: boolean;
    has_daily_updates: boolean;
    has_cost_tracking: boolean;
    has_media: boolean;
    has_documentation: boolean;
    has_change_orders_managed: boolean;
    has_billing_setup: boolean;
  }>({
    queryKey: ["/api/projects", projectCode, "data-quality"],
    enabled: !!projectCode,
  });

  const [showTimelineEditDialog, setShowTimelineEditDialog] = useState(false);
  const [editStartDate, setEditStartDate] = useState("");
  const [editEndDate, setEditEndDate] = useState("");

  const [showBudgetEditDialog, setShowBudgetEditDialog] = useState(false);
  const [editBudget, setEditBudget] = useState("");
  const [editContractAmount, setEditContractAmount] = useState("");
  const [editTexturaDrawDate, setEditTexturaDrawDate] = useState("");
  const [editDrawDayOfMonth, setEditDrawDayOfMonth] = useState<number | "">("");

  const handleTimelineUpdate = async () => {
    try {
      const payload: any = {};
      if (editStartDate) {
        payload.startDate = new Date(editStartDate).toISOString();
      } else {
        payload.startDate = null;
      }
      if (editEndDate) {
        payload.endDate = new Date(editEndDate).toISOString();
      } else {
        payload.endDate = null;
      }

      await apiRequest("PATCH", `/api/projects/${projectCode}`, payload);
      await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode] });
      toast({ title: "Success", description: "Timeline updated" });
      setShowTimelineEditDialog(false);
    } catch (error) {
      toast({ title: "Error", description: "Failed to update timeline", variant: "destructive" });
    }
  };

  const handleBudgetUpdate = async () => {
    if (!editBudget || !editContractAmount) {
      toast({ title: "Error", description: "Budget and contract amount are required", variant: "destructive" });
      return;
    }

    try {
      const payload: any = {
        budget: editBudget,
        contractAmount: editContractAmount,
      };

      if (editTexturaDrawDate) {
        payload.texturaDrawDate = editTexturaDrawDate;
      }

      if (editDrawDayOfMonth !== "") {
        payload.drawDayOfMonth = editDrawDayOfMonth;
      }

      await apiRequest("PATCH", `/api/projects/${projectCode}/financials`, payload);

      await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode] });
      toast({ title: "Success", description: "Financial data updated" });
      setShowBudgetEditDialog(false);
    } catch (error) {
      toast({ title: "Error", description: "Failed to update financial data", variant: "destructive" });
    }
  };

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Project Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-3">
              <Building2 className="w-5 h-5 text-muted-foreground mt-0.5" />
              <div>
                <p className="text-sm font-medium">Client</p>
                <p className="text-sm text-muted-foreground">{project.clientName || "N/A"}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <User className="w-5 h-5 text-muted-foreground mt-0.5" />
              <div>
                <p className="text-sm font-medium">Contact</p>
                <p className="text-sm text-muted-foreground">{project.clientContactName || "N/A"}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Mail className="w-5 h-5 text-muted-foreground mt-0.5" />
              <div>
                <p className="text-sm font-medium">Email</p>
                <p className="text-sm text-muted-foreground">{project.clientContactEmail || "N/A"}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Phone className="w-5 h-5 text-muted-foreground mt-0.5" />
              <div>
                <p className="text-sm font-medium">Phone</p>
                <p className="text-sm text-muted-foreground">{project.clientContactPhone || "N/A"}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <MapPin className="w-5 h-5 text-muted-foreground mt-0.5" />
              <div>
                <p className="text-sm font-medium">Location</p>
                <p className="text-sm text-muted-foreground">
                  {[project.locationAddress, project.city, project.state].filter(Boolean).join(", ") || "N/A"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <CardTitle>Project Team & Timeline</CardTitle>
            {(user?.role === "ADMIN" || user?.role === "MANAGER" || user?.role === "OFFICE_MANAGER") && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditStartDate(project.startDate ? format(new Date(project.startDate), "yyyy-MM-dd") : "");
                  setEditEndDate(project.endDate ? format(new Date(project.endDate), "yyyy-MM-dd") : "");
                  setShowTimelineEditDialog(true);
                }}
                data-testid="button-edit-timeline"
              >
                <Edit className="w-4 h-4 mr-2" />
                Edit
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm font-medium mb-1">Start Date</p>
              <p className="text-sm text-muted-foreground" data-testid="text-start-date">
                {project.startDate ? format(new Date(project.startDate), "MMM d, yyyy") : "Not set"}
              </p>
            </div>
            <div>
              <p className="text-sm font-medium mb-1">Target End Date</p>
              <p className="text-sm text-muted-foreground" data-testid="text-end-date">
                {project.endDate ? format(new Date(project.endDate), "MMM d, yyyy") : "Not set"}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <div className="p-3 rounded-lg border bg-card">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <CalendarIcon className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Duration</p>
                    <p className="text-xl font-bold" data-testid="text-duration">
                      {scheduleDuration !== null ? `${scheduleDuration} days` : "N/A"}
                    </p>
                  </div>
                </div>
              </div>
              <div className="p-3 rounded-lg border bg-card">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-green-100 dark:bg-green-950/50 rounded-lg">
                    <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Progress</p>
                    <p className="text-xl font-bold" data-testid="text-progress">
                      {scheduleProgress !== null ? `${scheduleProgress}%` : "N/A"}
                    </p>
                  </div>
                </div>
                {scheduleProgress !== null && (
                  <Progress value={scheduleProgress} className="mt-3 h-2" />
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {project?.id && (
        <ProjectHealthWidget projectId={project.id} />
      )}

      {FeaturePermissions.VIEW_PROJECT_FINANCIALS(user?.role) && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <CardTitle>Financial Information</CardTitle>
            {(user?.role === "ADMIN" || user?.role === "OFFICE_MANAGER") && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditBudget(project.budget || "0");
                  setEditContractAmount(project.contractAmount || "0");
                  setEditTexturaDrawDate(project.texturaDrawDate || "");
                  setEditDrawDayOfMonth(project.drawDayOfMonth || "");
                  setShowBudgetEditDialog(true);
                }}
                data-testid="button-edit-financials"
              >
                <Edit className="w-4 h-4 mr-2" />
                Edit
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {financialsLoading ? (
              <div className="text-center py-4 text-muted-foreground">Loading financial data...</div>
            ) : financials ? (
              <div className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  <div className="p-4 rounded-lg border bg-card">
                    <div className="flex items-center gap-2 mb-2">
                      <DollarSign className="w-4 h-4 text-muted-foreground" />
                      <p className="text-sm font-medium text-muted-foreground">Budget</p>
                    </div>
                    <p className="text-xl sm:text-2xl font-bold font-mono" data-testid="text-budget">
                      ${financials.budget.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">Direct cost to complete the work</p>
                  </div>

                  <div className="p-4 rounded-lg border bg-card">
                    <div className="flex items-center gap-2 mb-2">
                      <DollarSign className="w-4 h-4 text-muted-foreground" />
                      <p className="text-sm font-medium text-muted-foreground">Contract Amount</p>
                    </div>
                    <p className="text-xl sm:text-2xl font-bold font-mono" data-testid="text-contract-amount">
                      ${financials.originalContract.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">Budget + overhead + profit</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  <div className="p-4 rounded-lg border bg-amber-50 dark:bg-amber-950/30">
                    <div className="flex items-center gap-2 mb-2">
                      <DollarSign className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                      <p className="text-sm font-medium text-amber-600 dark:text-amber-400">COs & T&M</p>
                    </div>
                    <p className="text-xl sm:text-2xl font-bold font-mono text-amber-600 dark:text-amber-400" data-testid="text-contract-additions">
                      {(financials.contractAdditions || 0) >= 0 ? '+' : ''}${(financials.contractAdditions || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    <div className="text-xs text-muted-foreground mt-2 space-y-0.5">
                      <div className="flex justify-between">
                        <span>Change Orders ({financials.approvedChangeOrdersCount}):</span>
                        <span className="font-mono">${financials.approvedChangeOrdersTotal.toLocaleString()}</span>
                      </div>
                      {(financials.tmTickets?.approvedTotal ?? 0) > 0 && (
                        <div className="flex justify-between">
                          <span>T&M Tickets ({financials.tmTickets?.approved ?? 0}):</span>
                          <span className="font-mono">${(financials.tmTickets?.approvedTotal ?? 0).toLocaleString()}</span>
                        </div>
                      )}
                      {(financials.tmTickets?.pending ?? 0) > 0 && (
                        <div className="flex justify-between text-amber-600">
                          <span>Pending T&M ({financials.tmTickets?.pending ?? 0}):</span>
                          <span className="font-mono">${(financials.tmTickets?.pendingTotal ?? 0).toLocaleString()}</span>
                        </div>
                      )}
                      {financials.tmCharges?.total > 0 && (
                        <div className="flex justify-between">
                          <span>Legacy T&M ({financials.tmCharges?.sheetsCount || 0}):</span>
                          <span className="font-mono">${(financials.tmCharges?.total || 0).toLocaleString()}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="p-4 rounded-lg border bg-primary/5">
                    <div className="flex items-center gap-2 mb-2">
                      <DollarSign className="w-4 h-4 text-primary" />
                      <p className="text-sm font-medium text-primary">Adjusted Contract</p>
                    </div>
                    <p className="text-xl sm:text-2xl font-bold font-mono text-primary" data-testid="text-adjusted-contract-amount">
                      ${financials.adjustedContract.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Original contract + COs + T&M
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  <div className="p-4 rounded-lg border bg-green-50 dark:bg-green-950/30">
                    <div className="flex items-center gap-2 mb-2">
                      <DollarSign className="w-4 h-4 text-green-600 dark:text-green-400" />
                      <p className="text-sm font-medium text-green-600 dark:text-green-400">Projected Profit</p>
                    </div>
                    <p className="text-xl sm:text-2xl font-bold font-mono text-green-600 dark:text-green-400" data-testid="text-projected-profit">
                      ${financials.projectedProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">Expected profit (contract - budget)</p>
                  </div>

                  <div className={`p-4 rounded-lg border ${financials.actualProfit >= 0 ? 'bg-green-50 dark:bg-green-950/30' : 'bg-red-50 dark:bg-red-950/30'}`}>
                    <div className="flex items-center gap-2 mb-2">
                      <DollarSign className={`w-4 h-4 ${financials.actualProfit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`} />
                      <p className={`text-sm font-medium ${financials.actualProfit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>Actual Profit</p>
                    </div>
                    <p className={`text-xl sm:text-2xl font-bold font-mono ${financials.actualProfit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`} data-testid="text-actual-profit">
                      ${financials.actualProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">Real-time (adjusted contract - actual costs)</p>
                  </div>
                </div>

                <div className="p-4 rounded-lg border bg-muted/30">
                  <p className="text-sm font-medium mb-3">Actual Costs Incurred</p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <div>
                      <p className="text-muted-foreground">Labor</p>
                      <p className="font-mono font-medium">${financials.actualCosts.labor.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                      <p className="text-xs text-muted-foreground">{financials.actualCosts.laborHours.toFixed(1)} hrs</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Materials</p>
                      <p className="font-mono font-medium">${financials.actualCosts.materials.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Subcontractors</p>
                      <p className="font-mono font-medium">${financials.actualCosts.subcontractors.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Other Expenses</p>
                      <p className="font-mono font-medium">${financials.actualCosts.otherExpenses.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                    </div>
                  </div>
                  <div className="mt-3 pt-3 border-t flex justify-between items-center">
                    <p className="font-medium">Total Actual Costs</p>
                    <p className="font-mono font-bold text-lg">${financials.actualCosts.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                  </div>
                </div>

                {financials.profitVariance !== 0 && (
                  <div className={`p-3 rounded-lg ${financials.profitVariance >= 0 ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200' : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200'}`}>
                    <p className="text-sm font-medium">
                      Profit Variance: {financials.profitVariance >= 0 ? '+' : ''}${financials.profitVariance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 
                      ({financials.profitVariancePercent >= 0 ? '+' : ''}{financials.profitVariancePercent.toFixed(1)}%)
                    </p>
                    <p className="text-xs mt-1">
                      {financials.profitVariance >= 0 
                        ? "Currently tracking above projected profit" 
                        : "Currently tracking below projected profit"
                      }
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <DollarSign className="w-5 h-5 text-muted-foreground mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Project Budget</p>
                    <p className="text-2xl font-bold font-mono">
                      ${parseFloat(project.budget || "0").toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <DollarSign className="w-5 h-5 text-muted-foreground mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Contract Amount</p>
                    <p className="text-2xl font-bold font-mono">
                      ${parseFloat(project.contractAmount || "0").toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {FeaturePermissions.VIEW_PROJECT_FINANCIALS(user?.role) && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5" />
                Schedule of Values
              </CardTitle>
              <CardDescription>Track payment applications against the project contract</CardDescription>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setLocation(`/schedule-of-values?project=${project.id}`)}
              data-testid="button-manage-sov"
            >
              <FileSpreadsheet className="w-4 h-4 mr-2" />
              Manage SOV
            </Button>
          </CardHeader>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Description</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{project.description || "No description provided"}</p>
        </CardContent>
      </Card>

      <Card data-testid="card-data-quality">
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-4">
            <span>Data Quality Score</span>
            {dataQuality && (
              <Badge 
                className={
                  dataQuality.overall_score >= 80 
                    ? "bg-green-500 hover:bg-green-600" 
                    : dataQuality.overall_score >= 60 
                    ? "bg-yellow-500 hover:bg-yellow-600" 
                    : "bg-red-500 hover:bg-red-600"
                }
                data-testid="badge-overall-score"
              >
                {dataQuality.overall_score}/100
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Track data completeness to improve AI insights and project management
          </CardDescription>
        </CardHeader>
        <CardContent>
          {dataQualityLoading ? (
            <div className="text-center py-4 text-muted-foreground">Loading data quality score...</div>
          ) : !dataQuality ? (
            <div className="text-center py-4 text-muted-foreground">Unable to load data quality score</div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Overall Quality</span>
                  <span className="font-medium">{dataQuality.overall_score}%</span>
                </div>
                <div className="h-2 bg-secondary rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all ${
                      dataQuality.overall_score >= 80
                        ? "bg-green-500"
                        : dataQuality.overall_score >= 60
                        ? "bg-yellow-500"
                        : "bg-red-500"
                    }`}
                    style={{ width: `${dataQuality.overall_score}%` }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex items-center gap-2">
                  {dataQuality.has_scope ? (
                    <Badge variant="outline" className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200">
                      ✓ Scope
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200">
                      ✗ Scope
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {dataQuality.has_estimates ? (
                    <Badge variant="outline" className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200">
                      ✓ Estimates
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200">
                      ✗ Estimates
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {dataQuality.has_budget ? (
                    <Badge variant="outline" className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200">
                      ✓ Budget
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200">
                      ✗ Budget
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {dataQuality.has_timeline ? (
                    <Badge variant="outline" className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200">
                      ✓ Timeline
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200">
                      ✗ Timeline
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {dataQuality.has_daily_updates ? (
                    <Badge variant="outline" className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200">
                      ✓ Daily Updates
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200">
                      ✗ Daily Updates
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {dataQuality.has_cost_tracking ? (
                    <Badge variant="outline" className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200">
                      ✓ Cost Tracking
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200">
                      ✗ Cost Tracking
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {dataQuality.has_media ? (
                    <Badge variant="outline" className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200">
                      ✓ Media
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200">
                      ✗ Media
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {dataQuality.has_documentation ? (
                    <Badge variant="outline" className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200">
                      ✓ Documentation
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200">
                      ✗ Documentation
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {dataQuality.has_change_orders_managed ? (
                    <Badge variant="outline" className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200">
                      ✓ Change Orders
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200">
                      ✗ Change Orders
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {dataQuality.has_billing_setup ? (
                    <Badge variant="outline" className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200">
                      ✓ Billing Setup
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200">
                      ✗ Billing Setup
                    </Badge>
                  )}
                </div>
              </div>

              {dataQuality.overall_score < 80 && (
                <div className="mt-4 p-3 bg-muted rounded-md">
                  <p className="text-sm font-medium mb-1">Improve Data Quality</p>
                  <p className="text-xs text-muted-foreground">
                    Complete missing sections to enhance AI insights and project tracking accuracy.
                  </p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-change-orders-summary">
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle>Change Orders</CardTitle>
            <CardDescription>Track status and value of project change orders</CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setActiveTab("change-orders")}
            data-testid="button-view-all-change-orders"
          >
            View All
          </Button>
        </CardHeader>
        <CardContent>
          {changeOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No change orders yet</p>
          ) : (
            <div className="space-y-3">
              {changeOrders.slice(0, 5).map((co) => (
                <div 
                  key={co.id} 
                  className="flex items-center justify-between gap-4 p-3 rounded-md border hover-elevate active-elevate-2 cursor-pointer"
                  onClick={() => setActiveTab("change-orders")}
                  data-testid={`change-order-summary-${co.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className="font-mono text-xs">
                        {co.changeOrderNumber}
                      </Badge>
                      <Badge
                        variant={
                          co.status === "APPROVED" ? "default" :
                          co.status === "REJECTED" ? "destructive" :
                          co.status === "PENDING_APPROVAL" ? "destructive" :
                          co.status === "SUBMITTED" ? "secondary" :
                          "outline"
                        }
                        className="text-xs"
                      >
                        {co.status?.replace("_", " ")}
                      </Badge>
                    </div>
                    <p className="text-sm font-medium truncate">{co.description}</p>
                    <p className="text-xs text-muted-foreground">
                      Created {format(new Date(co.createdAt), "MMM d, yyyy")}
                    </p>
                  </div>
                  {hasManagementAccess(user?.role) && (
                    <div className="text-right">
                      <p className="text-lg font-bold font-mono">
                        ${parseFloat(co.amount).toLocaleString()}
                      </p>
                    </div>
                  )}
                </div>
              ))}
              {changeOrders.length > 5 && (
                <p className="text-xs text-muted-foreground text-center pt-2">
                  + {changeOrders.length - 5} more change order{changeOrders.length - 5 !== 1 ? 's' : ''}
                </p>
              )}
              {hasManagementAccess(user?.role) && (
                <div className="pt-3 border-t mt-3 grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Total Value</p>
                    <p className="text-xl font-bold font-mono">
                      ${changeOrders.reduce((sum, co) => sum + parseFloat(co.amount), 0).toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Approved Value</p>
                    <p className="text-xl font-bold font-mono text-green-600">
                      ${changeOrders
                        .filter(co => co.status === "APPROVED")
                        .reduce((sum, co) => sum + parseFloat(co.amount), 0)
                        .toLocaleString()}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showTimelineEditDialog} onOpenChange={setShowTimelineEditDialog}>
        <DialogContent data-testid="dialog-edit-timeline">
          <DialogHeader>
            <DialogTitle>Edit Project Timeline</DialogTitle>
            <DialogDescription>
              Update the project start date and target end date.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Start Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-start text-left font-normal"
                    data-testid="input-edit-start-date"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {editStartDate ? format(new Date(editStartDate), "PPP") : "Select start date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarPicker
                    mode="single"
                    selected={editStartDate ? new Date(editStartDate) : undefined}
                    onSelect={(date) => setEditStartDate(date ? format(date, "yyyy-MM-dd") : "")}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <Label>Target End Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-start text-left font-normal"
                    data-testid="input-edit-end-date"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {editEndDate ? format(new Date(editEndDate), "PPP") : "Select target end date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarPicker
                    mode="single"
                    selected={editEndDate ? new Date(editEndDate) : undefined}
                    onSelect={(date) => setEditEndDate(date ? format(date, "yyyy-MM-dd") : "")}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowTimelineEditDialog(false)}
              data-testid="button-cancel-timeline-edit"
            >
              Cancel
            </Button>
            <Button
              onClick={handleTimelineUpdate}
              data-testid="button-save-timeline"
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showBudgetEditDialog} onOpenChange={setShowBudgetEditDialog}>
        <DialogContent data-testid="dialog-edit-budget">
          <DialogHeader>
            <DialogTitle>Edit Financial Data</DialogTitle>
            <DialogDescription>
              Update the project budget and contract amount. This data is used for profitability analysis.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="edit-budget">Project Budget ($)</Label>
              <Input
                id="edit-budget"
                type="number"
                step="0.01"
                value={editBudget}
                onChange={(e) => setEditBudget(e.target.value)}
                placeholder="0.00"
                data-testid="input-edit-budget"
              />
            </div>
            <div>
              <Label htmlFor="edit-contract">Contract Amount ($)</Label>
              <Input
                id="edit-contract"
                type="number"
                step="0.01"
                value={editContractAmount}
                onChange={(e) => setEditContractAmount(e.target.value)}
                placeholder="0.00"
                data-testid="input-edit-contract"
              />
            </div>
            <div>
              <Label>Textura Draw Date (Optional Override)</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-start text-left font-normal"
                    data-testid="input-edit-textura-draw-date"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {editTexturaDrawDate ? format(new Date(editTexturaDrawDate), "PPP") : "Select date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarPicker
                    mode="single"
                    selected={editTexturaDrawDate ? new Date(editTexturaDrawDate) : undefined}
                    onSelect={(date) => setEditTexturaDrawDate(date ? format(date, "yyyy-MM-dd") : "")}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              <p className="text-xs text-muted-foreground mt-1">
                Use this to override the recurring draw schedule for a specific month
              </p>
            </div>
            <div>
              <Label htmlFor="edit-draw-day-of-month">Recurring Draw Day of Month</Label>
              <Select 
                value={editDrawDayOfMonth === "" ? "none" : String(editDrawDayOfMonth)}
                onValueChange={(value) => setEditDrawDayOfMonth(value === "none" ? "" : parseInt(value))}
              >
                <SelectTrigger id="edit-draw-day-of-month" data-testid="select-draw-day-of-month">
                  <SelectValue placeholder="Select day of month" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No recurring draw</SelectItem>
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                    <SelectItem key={day} value={String(day)}>
                      {day}{day === 1 ? 'st' : day === 2 ? 'nd' : day === 3 ? 'rd' : 'th'} of each month
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                Set the day each month when Textura draws are due (e.g., 1st, 15th, 30th)
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowBudgetEditDialog(false)}
              data-testid="button-cancel-budget-edit"
            >
              Cancel
            </Button>
            <Button
              onClick={handleBudgetUpdate}
              data-testid="button-save-budget"
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
