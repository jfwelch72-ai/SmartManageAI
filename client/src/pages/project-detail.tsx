import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import StatusBadge from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import ScopeProgressTracker from "@/components/ScopeProgressTracker";
import DailyNoteFeed from "@/components/DailyNoteFeed";
import AiSchedulingPanel from "@/components/AiSchedulingPanel";
import AiJobsiteAnalysis from "@/components/AiJobsiteAnalysis";
import ClientPortal from "@/components/ClientPortal";
import ProjectEstimate from "@/components/ProjectEstimate";
import JobInformationForm from "@/components/JobInformationForm";
import DelaysSection from "@/components/DelaysSection";
import InspectionsSection from "@/components/InspectionsSection";
import MaterialBudgetTracker from "@/components/MaterialBudgetTracker";
import ProjectRFIs from "@/components/ProjectRFIs";
import ProjectTransmittals from "@/components/ProjectTransmittals";
import ProjectSubmittals from "@/components/ProjectSubmittals";
import SubcontractorPortalManager from "@/components/SubcontractorPortalManager";
import {
  AlertTriangle,
  Package,
  Calendar as CalendarIcon,
  Clock,
  LayoutDashboard,
  ListChecks,
  FileEdit,
  Bot,
  NotebookPen,
  Camera,
  Calculator,
  ShoppingCart,
  Receipt,
  Info,
  Banknote,
  HardHat,
  CloudRain,
  CalendarCheck,
  Mail,
  Ruler,
  Truck,
  HelpCircle,
  Send,
  FileCheck,
  ExternalLink,
  Users,
  TrendingUp,
  DollarSign,
  BarChart3,
  ClipboardList,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  ChevronDown,
  FileSpreadsheet,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useLocation, useRoute } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import {
  FeaturePermissions,
  hasManagementAccess,
  hasFinancialAccess,
} from "@/lib/rbac";
import {
  useProject,
  useScopeItems,
  useChangeOrders,
  useProjectNotes,
  useProjectEstimates,
} from "@/hooks/use-data";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import ChangeOrdersTab from "@/components/project-tabs/ChangeOrdersTab";
import OverviewTab from "@/components/project-tabs/OverviewTab";
import SubcontractorsTab from "@/components/project-tabs/SubcontractorsTab";
import LaborTab from "@/components/project-tabs/LaborTab";
import PlansTab from "@/components/project-tabs/PlansTab";
import ProcurementTab from "@/components/project-tabs/ProcurementTab";
import ReceiptsTab from "@/components/project-tabs/ReceiptsTab";
import MediaTab from "@/components/project-tabs/MediaTab";
import TimeTab from "@/components/project-tabs/TimeTab";
import ProjectEmailTab from "@/components/project-tabs/ProjectEmailTab";
import ProjectPayrollTab from "@/components/project-tabs/ProjectPayrollTab";
import ProjectEquipmentTab from "@/components/project-tabs/ProjectEquipmentTab";
import ProfitabilityTab from "@/components/project-tabs/ProfitabilityTab";
import BudgetTab from "@/components/project-tabs/BudgetTab";
import CostLedgerTab from "@/components/project-tabs/CostLedgerTab";
import PunchListTab from "@/components/PunchListTab";
import WarrantyTab from "@/components/WarrantyTab";
import SovTab from "@/components/project-tabs/SovTab";
import type { LucideIcon } from "lucide-react";

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

interface MaterialBudgetSummary {
  totalItems: number;
  totalBudgetedCost: number;
  totalActualCost: number;
  variance: number;
  variancePercent: number;
  itemsAtRisk: number;
  alertsTriggered: number;
}

interface TabConfig {
  value: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
  visible: boolean;
}

function buildTabConfigs(
  userRole: string | undefined,
  submittedCOCount: number,
): TabConfig[] {
  return [
    {
      value: "overview",
      label: "Overview",
      icon: LayoutDashboard,
      visible: true,
    },
    {
      value: "scope",
      label: "Scope & Progress",
      icon: ListChecks,
      visible: true,
    },
    { value: "materials", label: "Materials", icon: Package, visible: true },
    {
      value: "change-orders",
      label: "Change Orders",
      icon: FileEdit,
      badge: submittedCOCount > 0 ? submittedCOCount : undefined,
      visible: true,
    },
    { value: "schedule", label: "Schedule", icon: CalendarIcon, visible: true },
    { value: "delays", label: "Delays", icon: CloudRain, visible: true },
    {
      value: "inspections",
      label: "Inspections",
      icon: CalendarCheck,
      visible: true,
    },
    {
      value: "jobsite-ai",
      label: "AI Jobsite",
      icon: Bot,
      visible: hasManagementAccess(userRole),
    },
    {
      value: "email-communications",
      label: "Email",
      icon: Mail,
      visible: hasManagementAccess(userRole),
    },
    {
      value: "daily-notes",
      label: "Daily Notes",
      icon: NotebookPen,
      visible: true,
    },
    { value: "media", label: "Photos & Videos", icon: Camera, visible: true },
    {
      value: "estimate",
      label: "Estimate",
      icon: Calculator,
      visible: FeaturePermissions.VIEW_ESTIMATES_TAB(userRole),
    },
    {
      value: "procurement",
      label: "Procurement",
      icon: ShoppingCart,
      visible: FeaturePermissions.VIEW_PROCUREMENT_TAB(userRole),
    },
    { value: "plans", label: "Plans & Takeoff", icon: Ruler, visible: true },
    {
      value: "time",
      label: "Time & T&M",
      icon: Clock,
      visible: FeaturePermissions.VIEW_TIME_ENTRIES_TAB(userRole),
    },
    {
      value: "labor",
      label: "Labor",
      icon: HardHat,
      visible: FeaturePermissions.VIEW_TIME_ENTRIES_TAB(userRole),
    },
    {
      value: "receipts",
      label: "Receipts",
      icon: Receipt,
      visible: FeaturePermissions.VIEW_RECEIPTS_TAB(userRole),
    },
    {
      value: "subcontractors",
      label: "Subcontractors",
      icon: Users,
      visible: FeaturePermissions.VIEW_SUBCONTRACTORS_TAB(userRole),
    },
    { value: "job-info", label: "Job Info", icon: Info, visible: true },
    {
      value: "payroll",
      label: "Payroll",
      icon: Banknote,
      visible: hasManagementAccess(userRole),
    },
    {
      value: "equipment",
      label: "Equipment",
      icon: Truck,
      visible: FeaturePermissions.VIEW_EQUIPMENT(userRole),
    },
    {
      value: "rfis",
      label: "RFIs",
      icon: HelpCircle,
      visible: hasManagementAccess(userRole),
    },
    {
      value: "transmittals",
      label: "Transmittals",
      icon: Send,
      visible: hasManagementAccess(userRole),
    },
    {
      value: "submittals",
      label: "Submittals",
      icon: FileCheck,
      visible: hasManagementAccess(userRole),
    },
    {
      value: "portal-access",
      label: "Portal Access",
      icon: ExternalLink,
      visible: hasManagementAccess(userRole),
    },
    {
      value: "budget",
      label: "Budget",
      icon: DollarSign,
      visible: FeaturePermissions.VIEW_BUDGET_TAB(userRole),
    },
    {
      value: "cost-ledger",
      label: "Cost Ledger",
      icon: BarChart3,
      visible: hasFinancialAccess(userRole),
    },
    {
      value: "financials",
      label: "Live Financials",
      icon: TrendingUp,
      visible: hasFinancialAccess(userRole),
    },
    {
      value: "sov",
      label: "Schedule of Values",
      icon: FileSpreadsheet,
      visible: hasFinancialAccess(userRole),
    },
    {
      value: "punch-list",
      label: "Punch List",
      icon: ClipboardList,
      visible: hasManagementAccess(userRole),
    },
    {
      value: "warranty",
      label: "Warranty",
      icon: ShieldCheck,
      visible: hasManagementAccess(userRole),
    },
  ];
}

export default function ProjectDetailPage() {
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState("overview");
  const [, params] = useRoute("/projects/:code");
  const { user } = useAuth();
  const { toast } = useToast();
  const [showCloseoutDialog, setShowCloseoutDialog] = useState(false);

  const searchParams = new URLSearchParams(window.location.search);
  const fromCFO = searchParams.get("from") === "cfo";
  const backPath = fromCFO ? "/cfo" : "/projects";
  const backLabel = fromCFO ? "Back to CFO" : "Back to Projects";

  const projectCode = params?.code || "";
  const { data: project, isLoading: projectLoading } = useProject(projectCode);
  const { data: scopeItems = [], isLoading: scopeLoading } =
    useScopeItems(projectCode);
  const { data: changeOrders = [], isLoading: changeOrdersLoading } =
    useChangeOrders(projectCode);
  const { data: projectNotes = [], isLoading: notesLoading } =
    useProjectNotes(projectCode);
  const { data: estimates = [], isLoading: estimatesLoading } =
    useProjectEstimates(projectCode);

  const { data: financials, isLoading: financialsLoading } =
    useQuery<ProjectFinancials>({
      queryKey: ["/api/projects", projectCode, "financials"],
      enabled:
        !!projectCode && FeaturePermissions.VIEW_PROJECT_FINANCIALS(user?.role),
    });

  const { data: allUsers = [] } = useQuery<
    Array<{
      id: string;
      firstName: string;
      lastName: string;
      role?: string;
      costRateRegular?: string;
    }>
  >({
    queryKey: ["/api/users"],
  });

  const { data: materialBudgetSummary } = useQuery<MaterialBudgetSummary>({
    queryKey: ["/api/projects", project?.id, "material-budgets", "summary"],
    enabled: !!project?.id,
  });

  const submittedCOCount = changeOrders.filter(
    (co) => co.status === "SUBMITTED",
  ).length;
  const tabConfigs = buildTabConfigs(user?.role, submittedCOCount);
  const visibleTabs = tabConfigs.filter((t) => t.visible);

  const { data: closeoutReadiness } = useQuery<{
    openPunchListItems: number;
    pendingChangeOrders: number;
    submittedTmTickets: number;
  }>({
    queryKey: ["/api/projects", projectCode, "closeout-readiness"],
    enabled: !!projectCode && project?.status === "ACTIVE" && hasManagementAccess(user?.role),
  });

  const updateStatusMutation = useMutation({
    mutationFn: async (newStatus: string) => {
      const res = await apiRequest("PATCH", `/api/projects/${projectCode}`, { status: newStatus });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      setShowCloseoutDialog(false);
      toast({ title: "Status updated", description: "Project status has been updated." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to update status", variant: "destructive" });
    },
  });

  if (projectLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="flex items-center justify-center h-96">
          <div className="text-muted-foreground">Loading project...</div>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-background">
        <div className="flex flex-col items-center justify-center h-96">
          <p className="text-muted-foreground mb-4">Project not found</p>
          <Button
            onClick={() => setLocation(backPath)}
            data-testid="button-back-to-projects"
          >
            {backLabel}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-full px-6 py-8">
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Button
              variant="ghost"
              onClick={() => setLocation(backPath)}
              data-testid="button-back"
            >
              ← {backLabel}
            </Button>
          </div>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="outline" className="font-mono">
                  {project.code}
                </Badge>
                <StatusBadge status={project.status} type="project" />
              </div>
              <h1 className="text-2xl font-bold text-foreground">
                {project.name}
              </h1>
            </div>
            {hasManagementAccess(user?.role) && (
              <div className="flex items-center gap-2 mt-1">
                {project.status === "PLANNING" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => updateStatusMutation.mutate("ACTIVE")}
                    disabled={updateStatusMutation.isPending}
                    data-testid="button-activate-project"
                  >
                    <CheckCircle2 className="w-4 h-4 mr-2 text-green-600" />
                    Activate Project
                  </Button>
                )}
                {project.status === "ACTIVE" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowCloseoutDialog(true)}
                    data-testid="button-mark-complete"
                  >
                    <CheckCircle2 className="w-4 h-4 mr-2 text-blue-600" />
                    Mark Complete
                  </Button>
                )}
                {project.status === "COMPLETE" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => updateStatusMutation.mutate("CLOSED")}
                    disabled={updateStatusMutation.isPending}
                    data-testid="button-close-project"
                  >
                    <XCircle className="w-4 h-4 mr-2 text-muted-foreground" />
                    Close Project
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>

        {FeaturePermissions.VIEW_PROJECT_BUDGET(user?.role) &&
          (!project.budget || Number(project.budget) === 0) &&
          (!project.contractAmount || Number(project.contractAmount) === 0) && (
            <Alert
              variant="destructive"
              className="mb-6"
              data-testid="alert-missing-budget"
            >
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Missing Financial Data</AlertTitle>
              <AlertDescription className="flex items-center justify-between gap-4 flex-wrap">
                <span>
                  This project is missing budget and contract information.
                  Please update the financial data to enable accurate
                  profitability tracking and AI analysis.
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setActiveTab("financials")}
                  data-testid="button-go-to-financials"
                >
                  Set Up Financials
                </Button>
              </AlertDescription>
            </Alert>
          )}

        {materialBudgetSummary && materialBudgetSummary.alertsTriggered > 0 && (
          <Alert
            variant="destructive"
            className="mb-6"
            data-testid="alert-material-budget"
          >
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Material Budget Alert</AlertTitle>
            <AlertDescription className="flex items-center justify-between gap-4 flex-wrap">
              <span>
                {materialBudgetSummary.alertsTriggered} material
                {materialBudgetSummary.alertsTriggered > 1 ? "s" : ""} have
                reached 90%+ of budgeted quantity. Consider creating a change
                order to cover additional materials.
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setActiveTab("materials")}
                data-testid="button-view-materials-alert"
              >
                <Package className="h-4 w-4 mr-2" />
                View Materials
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="space-y-6"
        >
          <div className="lg:hidden">
            <Select value={activeTab} onValueChange={setActiveTab}>
              <SelectTrigger className="w-full" data-testid="select-tab-mobile">
                <SelectValue placeholder="Select tab" />
              </SelectTrigger>
              <SelectContent>
                {visibleTabs.map((tab) => (
                  <SelectItem key={tab.value} value={tab.value}>
                    {tab.label} {tab.badge ? `(${tab.badge})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <TabsList className="hidden lg:flex flex-wrap gap-1 h-auto w-full justify-start p-1">
            {visibleTabs.map((tab) => {
              const IconComp = tab.icon;
              return (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  data-testid={`tab-${tab.value}`}
                >
                  <IconComp className="h-4 w-4 mr-1" />
                  {tab.label}
                  {tab.badge !== undefined && (
                    <Badge className="ml-2" variant="secondary">
                      {tab.badge}
                    </Badge>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <OverviewTab
              project={project}
              projectCode={projectCode}
              changeOrders={changeOrders}
              financials={financials}
              financialsLoading={financialsLoading}
              setActiveTab={setActiveTab}
            />
          </TabsContent>

          <TabsContent value="scope">
            <Card>
              <CardHeader>
                <CardTitle>Scope of Work & Progress Tracking</CardTitle>
              </CardHeader>
              <CardContent>
                <ScopeProgressTracker
                  scopeItems={scopeItems}
                  isLoading={scopeLoading}
                  projectCode={projectCode}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="materials">
            <MaterialBudgetTracker
              projectId={project.id}
              projectCode={projectCode}
              scopeItems={scopeItems}
            />
          </TabsContent>

          <TabsContent value="change-orders">
            <ChangeOrdersTab
              changeOrders={changeOrders}
              projectCode={projectCode}
              projectId={project.id}
              projectName={project.name}
              isLoading={changeOrdersLoading}
              userRole={user?.role || ""}
            />
          </TabsContent>

          <TabsContent value="schedule">
            <AiSchedulingPanel
              projectId={project.id}
              projectCode={projectCode}
              projectName={project.name}
              tradeType={(project as { tradeType?: string }).tradeType}
            />
          </TabsContent>

          <TabsContent value="delays">
            <DelaysSection
              projectId={project.id}
              projectCode={projectCode}
              userRole={user?.role || ""}
            />
          </TabsContent>

          <TabsContent value="inspections">
            <InspectionsSection
              projectId={project.id}
              projectCode={projectCode}
              userRole={user?.role || ""}
            />
          </TabsContent>

          <TabsContent value="jobsite-ai">
            <AiJobsiteAnalysis
              projectId={project.id}
              projectName={project.name}
            />
          </TabsContent>

          <TabsContent value="email-communications">
            <ProjectEmailTab
              projectId={project.id}
              projectCode={projectCode}
              userRole={user?.role || ""}
            />
          </TabsContent>

          <TabsContent value="daily-notes">
            <DailyNoteFeed projectId={project.id} availableUsers={allUsers} />
          </TabsContent>

          <TabsContent value="media">
            <MediaTab projectCode={projectCode} project={project} />
          </TabsContent>

          <TabsContent value="estimate">
            <ProjectEstimate />
          </TabsContent>

          <TabsContent value="procurement">
            <ProcurementTab projectCode={projectCode} project={project} />
          </TabsContent>

          <TabsContent value="plans" className="space-y-0">
            <PlansTab projectCode={projectCode} project={project} />
          </TabsContent>

          <TabsContent value="time">
            <TimeTab
              projectCode={projectCode}
              project={project}
              userRole={user?.role || ""}
            />
          </TabsContent>

          <TabsContent value="labor">
            <LaborTab
              projectCode={projectCode}
              project={project}
              financials={financials}
            />
          </TabsContent>

          <TabsContent value="receipts">
            <ReceiptsTab projectCode={projectCode} project={project} />
          </TabsContent>

          <TabsContent value="subcontractors">
            <SubcontractorsTab projectCode={projectCode} />
          </TabsContent>

          <TabsContent value="job-info">
            <JobInformationForm projectCode={project.code} />
          </TabsContent>

          <TabsContent value="payroll">
            <ProjectPayrollTab projectId={project.id} />
          </TabsContent>

          <TabsContent value="equipment">
            <ProjectEquipmentTab
              projectId={project.id}
              projectCode={project.code}
              userRole={user?.role || ""}
            />
          </TabsContent>

          <TabsContent value="rfis">
            <ProjectRFIs
              projectId={project.id}
              projectCode={project.code}
              userRole={user?.role || ""}
            />
          </TabsContent>

          <TabsContent value="transmittals">
            <ProjectTransmittals
              projectId={project.id}
              projectCode={project.code}
              userRole={user?.role || ""}
            />
          </TabsContent>

          <TabsContent value="submittals">
            <ProjectSubmittals
              projectId={project.id}
              projectCode={project.code}
              userRole={user?.role || ""}
            />
          </TabsContent>

          <TabsContent value="portal-access">
            <Tabs defaultValue="client-portal" className="space-y-4">
              <TabsList>
                <TabsTrigger
                  value="client-portal"
                  data-testid="tab-portal-client"
                >
                  Client Portal
                </TabsTrigger>
                <TabsTrigger
                  value="subcontractor-portal"
                  data-testid="tab-portal-subcontractor"
                >
                  Subcontractor Portal
                </TabsTrigger>
              </TabsList>
              <TabsContent value="client-portal">
                <ClientPortal
                  projectId={project.id}
                  projectName={project.name}
                />
              </TabsContent>
              <TabsContent value="subcontractor-portal">
                <SubcontractorPortalManager
                  projectId={project.id}
                  projectCode={project.code}
                  userRole={user?.role || ""}
                />
              </TabsContent>
            </Tabs>
          </TabsContent>

          <TabsContent value="budget">
            <BudgetTab
              projectCode={projectCode}
              userRole={user?.role || ""}
              projectBudget={Number(
                project.budget || project.contractAmount || 0,
              )}
            />
          </TabsContent>

          <TabsContent value="cost-ledger">
            <CostLedgerTab projectCode={projectCode} />
          </TabsContent>

          <TabsContent value="financials">
            <ProfitabilityTab projectCode={project.code} />
          </TabsContent>

          <TabsContent value="sov">
            <SovTab projectId={project.id} projectCode={project.code} />
          </TabsContent>

          <TabsContent value="punch-list">
            <PunchListTab
              projectId={project.id}
              projectCode={project.code}
              userRole={user?.role ?? "VIEWER"}
            />
          </TabsContent>

          <TabsContent value="warranty">
            <WarrantyTab
              projectId={project.id}
              projectCode={project.code}
              userRole={user?.role ?? "VIEWER"}
            />
          </TabsContent>
        </Tabs>
      </main>

      <Dialog open={showCloseoutDialog} onOpenChange={setShowCloseoutDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-blue-600" />
              Close Out Project
            </DialogTitle>
            <DialogDescription>
              Review the items below before marking this project complete.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            {!closeoutReadiness ? (
              <div className="text-sm text-muted-foreground py-2">Checking project status...</div>
            ) : (closeoutReadiness.openPunchListItems === 0 && closeoutReadiness.pendingChangeOrders === 0 && closeoutReadiness.submittedTmTickets === 0) ? (
              <div className="flex items-center gap-3 p-3 rounded-lg border border-green-200 bg-green-50 dark:bg-green-950/20">
                <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />
                <p className="text-sm text-green-800 dark:text-green-300">
                  All checklist items are resolved. This project is ready to be marked complete.
                </p>
              </div>
            ) : (
              <>
                {closeoutReadiness.openPunchListItems > 0 && (
                  <div className="flex items-center justify-between p-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20">
                    <div className="flex items-center gap-2">
                      <XCircle className="w-4 h-4 text-amber-600" />
                      <span className="text-sm font-medium">Open Punch List Items</span>
                    </div>
                    <span className="text-sm font-bold text-amber-700 dark:text-amber-400">
                      {closeoutReadiness.openPunchListItems}
                    </span>
                  </div>
                )}

                {closeoutReadiness.pendingChangeOrders > 0 && (
                  <div className="flex items-center justify-between p-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20">
                    <div className="flex items-center gap-2">
                      <XCircle className="w-4 h-4 text-amber-600" />
                      <span className="text-sm font-medium">Pending Change Orders</span>
                    </div>
                    <span className="text-sm font-bold text-amber-700 dark:text-amber-400">
                      {closeoutReadiness.pendingChangeOrders}
                    </span>
                  </div>
                )}

                {closeoutReadiness.submittedTmTickets > 0 && (
                  <div className="flex items-center justify-between p-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20">
                    <div className="flex items-center gap-2">
                      <XCircle className="w-4 h-4 text-amber-600" />
                      <span className="text-sm font-medium">Unapproved T&M Tickets</span>
                    </div>
                    <span className="text-sm font-bold text-amber-700 dark:text-amber-400">
                      {closeoutReadiness.submittedTmTickets}
                    </span>
                  </div>
                )}

                <p className="text-xs text-muted-foreground pt-1">
                  These items are still open. You can still mark the project complete, but it is recommended to resolve them first.
                </p>
              </>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setShowCloseoutDialog(false)}
              data-testid="button-cancel-closeout"
            >
              Cancel
            </Button>
            <Button
              onClick={() => updateStatusMutation.mutate("COMPLETE")}
              disabled={updateStatusMutation.isPending || !closeoutReadiness}
              data-testid="button-confirm-complete"
            >
              <CheckCircle2 className="w-4 h-4 mr-2" />
              {updateStatusMutation.isPending ? "Updating..." : "Mark as Complete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
