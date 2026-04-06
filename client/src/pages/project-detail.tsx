import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertTriangle,
  Package,
  Calendar as CalendarIcon,
  Clock,
  LayoutDashboard,
  ListChecks,
  Bot,
  NotebookPen,
  Camera,
  Calculator,
  ShoppingCart,
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
  DollarSign,
  ClipboardList,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  FileText,
  Archive,
  Building2,
  Wrench,
  ClipboardCheck,
  Shield,
  ShieldAlert,
  ShieldOff,
  MapPin,
  Loader2,
  Search,
  Pin,
  Star,
} from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { format } from "date-fns";
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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import OverviewTab from "@/components/project-tabs/OverviewTab";
import SubcontractorsTab from "@/components/project-tabs/SubcontractorsTab";
import LaborTab from "@/components/project-tabs/LaborTab";
import PlansTab from "@/components/project-tabs/PlansTab";
import ProcurementTab from "@/components/project-tabs/ProcurementTab";
import MediaTab from "@/components/project-tabs/MediaTab";
import TimeTab from "@/components/project-tabs/TimeTab";
import ProjectEmailTab from "@/components/project-tabs/ProjectEmailTab";
import ProjectPayrollTab from "@/components/project-tabs/ProjectPayrollTab";
import ProjectEquipmentTab from "@/components/project-tabs/ProjectEquipmentTab";
import PunchListTab from "@/components/PunchListTab";
import WarrantyTab from "@/components/WarrantyTab";
import AssetHandoverTab from "@/components/AssetHandoverTab";
import MaintenanceLogsTab from "@/components/MaintenanceLogsTab";
import ContractsTab from "@/components/project-tabs/ContractsTab";
import FinancialsTab from "@/components/project-tabs/FinancialsTab";
import SafetyTrainingTab from "@/components/project-tabs/SafetyTrainingTab";
import ProjectVaultTab from "@/components/project-tabs/ProjectVaultTab";
import RisksTab from "@/components/project-tabs/RisksTab";
import LocationManagerTab from "@/components/project-tabs/LocationManagerTab";
import FieldTakeoffTab from "@/components/project-tabs/FieldTakeoffTab";
import { useFeaturePermission } from "@/hooks/use-dashboard-customization";
import HealthScoreBadge from "@/components/HealthScoreBadge";
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

type TabGroup = "General" | "Field Operations" | "Documents & Communication" | "Resources & Workforce" | "Financial" | "Asset Management" | "AI";

const TAB_GROUP_ORDER: TabGroup[] = [
  "General",
  "Field Operations",
  "Documents & Communication",
  "Resources & Workforce",
  "Financial",
  "Asset Management",
  "AI",
];

interface TabConfig {
  value: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
  visible: boolean;
  group: TabGroup;
}

interface TabGroupEntry {
  group: TabGroup;
  tabs: TabConfig[];
}

function buildTabConfigs(
  userRole: string | undefined,
  canAccessSOV: boolean,
  projectStatus?: string,
): TabConfig[] {
  const isProjectComplete = projectStatus === "COMPLETE" || projectStatus === "CLOSED";
  const showAssetMgmt = isProjectComplete || hasManagementAccess(userRole);
  return [
    {
      value: "overview",
      label: "Overview",
      icon: LayoutDashboard,
      visible: true,
      group: "General",
    },
    {
      value: "job-info",
      label: "Job Info",
      icon: Info,
      visible: true,
      group: "General",
    },
    {
      value: "scope",
      label: "Scope & Progress",
      icon: ListChecks,
      visible: true,
      group: "General",
    },
    {
      value: "schedule",
      label: "Schedule",
      icon: CalendarIcon,
      visible: true,
      group: "General",
    },
    {
      value: "daily-notes",
      label: "Daily Notes",
      icon: NotebookPen,
      visible: true,
      group: "Field Operations",
    },
    {
      value: "delays",
      label: "Delays",
      icon: CloudRain,
      visible: true,
      group: "Field Operations",
    },
    {
      value: "inspections",
      label: "Inspections",
      icon: CalendarCheck,
      visible: true,
      group: "Field Operations",
    },
    {
      value: "punch-list",
      label: "Punch List",
      icon: ClipboardList,
      visible: hasManagementAccess(userRole),
      group: "Field Operations",
    },
    {
      value: "asset-handover",
      label: "Handover",
      icon: ClipboardCheck,
      visible: showAssetMgmt,
      group: "Asset Management",
    },
    {
      value: "warranty",
      label: "Warranty",
      icon: ShieldCheck,
      visible: showAssetMgmt,
      group: "Asset Management",
    },
    {
      value: "maintenance-logs",
      label: "Maintenance",
      icon: Wrench,
      visible: showAssetMgmt,
      group: "Asset Management",
    },
    {
      value: "field-takeoff",
      label: "Field Takeoff",
      icon: ClipboardCheck,
      visible: true,
      group: "Field Operations",
    },
    {
      value: "locations",
      label: "Locations",
      icon: MapPin,
      visible: hasManagementAccess(userRole),
      group: "Field Operations",
    },
    {
      value: "risks",
      label: "Risks",
      icon: AlertTriangle,
      visible: hasManagementAccess(userRole),
      group: "Field Operations",
    },
    {
      value: "safety-training",
      label: "Safety Training",
      icon: ShieldCheck,
      visible: hasManagementAccess(userRole),
      group: "Field Operations",
    },
    {
      value: "email-communications",
      label: "Email",
      icon: Mail,
      visible: hasManagementAccess(userRole),
      group: "Documents & Communication",
    },
    {
      value: "rfis",
      label: "RFIs",
      icon: HelpCircle,
      visible: hasManagementAccess(userRole),
      group: "Documents & Communication",
    },
    {
      value: "submittals",
      label: "Submittals",
      icon: FileCheck,
      visible: hasManagementAccess(userRole),
      group: "Documents & Communication",
    },
    {
      value: "transmittals",
      label: "Transmittals",
      icon: Send,
      visible: hasManagementAccess(userRole),
      group: "Documents & Communication",
    },
    {
      value: "contracts",
      label: "Contracts",
      icon: FileText,
      visible: ["ADMIN", "MANAGER", "SUPERINTENDENT"].includes(userRole || ""),
      group: "Documents & Communication",
    },
    {
      value: "plans",
      label: "Plans & Takeoff",
      icon: Ruler,
      visible: true,
      group: "Documents & Communication",
    },
    {
      value: "media",
      label: "Photos & Videos",
      icon: Camera,
      visible: true,
      group: "Documents & Communication",
    },
    {
      value: "project-vault",
      label: "Project Vault",
      icon: Archive,
      visible: hasManagementAccess(userRole),
      group: "Documents & Communication",
    },
    {
      value: "time",
      label: "Time & T&M",
      icon: Clock,
      visible: FeaturePermissions.VIEW_TIME_ENTRIES_TAB(userRole),
      group: "Resources & Workforce",
    },
    {
      value: "labor",
      label: "Labor",
      icon: HardHat,
      visible: FeaturePermissions.VIEW_TIME_ENTRIES_TAB(userRole),
      group: "Resources & Workforce",
    },
    {
      value: "equipment",
      label: "Equipment",
      icon: Truck,
      visible: FeaturePermissions.VIEW_EQUIPMENT(userRole),
      group: "Resources & Workforce",
    },
    {
      value: "subcontractors",
      label: "Subcontractors",
      icon: Users,
      visible: FeaturePermissions.VIEW_SUBCONTRACTORS_TAB(userRole),
      group: "Resources & Workforce",
    },
    {
      value: "project-financials",
      label: "Financials",
      icon: DollarSign,
      visible:
        FeaturePermissions.VIEW_BUDGET_TAB(userRole) ||
        hasFinancialAccess(userRole) ||
        FeaturePermissions.VIEW_CHANGE_ORDERS_TAB(userRole) ||
        canAccessSOV ||
        FeaturePermissions.VIEW_RECEIPTS_TAB(userRole),
      group: "Financial",
    },
    {
      value: "estimate",
      label: "Estimate",
      icon: Calculator,
      visible: FeaturePermissions.VIEW_ESTIMATES_TAB(userRole),
      group: "Financial",
    },
    {
      value: "payroll",
      label: "Payroll",
      icon: Banknote,
      visible: hasManagementAccess(userRole),
      group: "Financial",
    },
    {
      value: "procurement",
      label: "Procurement",
      icon: ShoppingCart,
      visible: FeaturePermissions.VIEW_PROCUREMENT_TAB(userRole),
      group: "Financial",
    },
    {
      value: "materials",
      label: "Materials",
      icon: Package,
      visible: true,
      group: "Financial",
    },
    {
      value: "portal-access",
      label: "Portal Access",
      icon: ExternalLink,
      visible: hasManagementAccess(userRole),
      group: "Documents & Communication",
    },
    {
      value: "jobsite-ai",
      label: "AI Jobsite",
      icon: Bot,
      visible: hasManagementAccess(userRole),
      group: "AI",
    },
  ];
}

const ROLE_DEFAULT_TABS: Record<string, string[]> = {
  SUPER_ADMIN: ["overview", "project-financials", "schedule", "risks"],
  ADMIN: ["overview", "project-financials", "schedule", "procurement"],
  MANAGER: ["overview", "project-financials", "schedule", "daily-notes"],
  SUPERINTENDENT: ["overview", "daily-notes", "inspections", "time", "field-takeoff"],
  ESTIMATOR: ["overview", "estimate", "plans", "project-financials"],
  FIELD_WORKER: ["overview", "daily-notes", "time"],
  HOURLY_EMPLOYEE: ["overview", "daily-notes", "time"],
};

function getPinnedTabs(userId: string): string[] {
  try {
    const stored = localStorage.getItem(`pinned-tabs-${userId}`);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function setPinnedTabs(userId: string, tabs: string[]) {
  localStorage.setItem(`pinned-tabs-${userId}`, JSON.stringify(tabs));
}

function groupTabs(tabs: TabConfig[]): TabGroupEntry[] {
  const grouped: TabGroupEntry[] = [];
  for (const groupName of TAB_GROUP_ORDER) {
    const groupTabs = tabs.filter((t) => t.group === groupName);
    if (groupTabs.length > 0) {
      grouped.push({ group: groupName, tabs: groupTabs });
    }
  }
  return grouped;
}

export default function ProjectDetailPage() {
  const [, setLocation] = useLocation();
  const searchParams = new URLSearchParams(window.location.search);
  const urlTab = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState(urlTab || "overview");
  const [activeCategory, setActiveCategory] = useState<TabGroup>("General");
  const [financialSubTab, setFinancialSubTab] = useState("live-financials");
  const [, params] = useRoute("/projects/:code");
  const { user } = useAuth();
  const { toast } = useToast();
  const [showCloseoutDialog, setShowCloseoutDialog] = useState(false);
  const canAccessFinancialsPerms = useFeaturePermission("canAccessFinancials");
  const [pinnedTabValues, setPinnedTabValuesState] = useState<string[]>(() => {
    const stored = getPinnedTabs(user?.id || "default");
    if (stored.length > 0) return stored;
    return ROLE_DEFAULT_TABS[user?.role || ""] || [];
  });
  const [tabSearchOpen, setTabSearchOpen] = useState(false);
  const [tabSearchQuery, setTabSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const togglePinnedTab = useCallback((tabValue: string) => {
    setPinnedTabValuesState(prev => {
      const next = prev.includes(tabValue)
        ? prev.filter(v => v !== tabValue)
        : [...prev, tabValue];
      setPinnedTabs(user?.id || "default", next);
      return next;
    });
  }, [user?.id]);

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

  const { data: healthSnapshot } = useQuery<{
    overallScore: number;
    trendDirection: string | null;
    costScore: number | null;
    budgetScore: number;
    scheduleScore: number;
    safetyScore: number;
    aiExplanation: string | null;
  }>({
    queryKey: ["/api/project-health", project?.id],
    enabled: !!project?.id,
  });

  const { data: handoverSignoffs = [] } = useQuery<Array<{ id: string; role: string; signedByName: string; signedAt: string }>>({
    queryKey: ["/api/projects", projectCode, "handover", "signoffs"],
    queryFn: () => apiRequest("GET", `/api/projects/${projectCode}/handover/signoffs`).then(r => r.json()),
    enabled: !!projectCode && (project?.status === "COMPLETE" || project?.status === "CLOSED" || hasManagementAccess(user?.role)),
  });
  const handoverComplete = handoverSignoffs.some(s => s.role === "CONTRACTOR") && handoverSignoffs.some(s => s.role === "OWNER");

  const canAccessSOV =
    user?.role === "ADMIN" ||
    user?.role === "MANAGER" ||
    user?.role === "SUPERINTENDENT" ||
    canAccessFinancialsPerms === true;
  const tabConfigs = buildTabConfigs(user?.role, canAccessSOV, project?.status);
  const visibleTabs = tabConfigs.filter((t) => t.visible);
  const groupedTabs = groupTabs(visibleTabs);

  useEffect(() => {
    const currentParams = new URLSearchParams(window.location.search);
    const urlTab = currentParams.get("tab");
    if (urlTab && visibleTabs.length > 0) {
      const matched = visibleTabs.find(t => t.value === urlTab);
      if (matched) {
        setActiveTab(urlTab);
        if (matched.group) setActiveCategory(matched.group);
      }
    }
  }, [visibleTabs]);

  const financialSubTabMap: Record<string, string> = {
    "financials": "live-financials",
    "budget": "budget",
    "cost-ledger": "cost-ledger",
    "change-orders": "change-orders",
    "sov": "sov",
    "receipts": "receipts",
    "billing": "billing",
    "production-rates": "production-rates",
    "revenue-wip": "revenue-wip",
  };

  const findCategoryForTab = (tabValue: string): TabGroup | undefined => {
    const matchedTab = visibleTabs.find((t) => t.value === tabValue);
    return matchedTab?.group;
  };

  const handleSetActiveTab = (tab: string) => {
    if (tab in financialSubTabMap) {
      setActiveTab("project-financials");
      setFinancialSubTab(financialSubTabMap[tab]);
      setActiveCategory("Financial");
    } else {
      const category = findCategoryForTab(tab);
      if (category) {
        setActiveTab(tab);
        setActiveCategory(category);
      }
    }
  };

  const handleCategoryClick = (category: TabGroup) => {
    setActiveCategory(category);
    const categoryGroup = groupedTabs.find((g) => g.group === category);
    if (categoryGroup && categoryGroup.tabs.length > 0) {
      setActiveTab(categoryGroup.tabs[0].value);
    }
  };

  const { data: closeoutReadiness } = useQuery<{
    openPunchListItems: number;
    pendingChangeOrders: number;
    submittedTmTickets: number;
    pendingPayApplications: number;
    openRfis: number;
    unpaidVendorInvoices: number;
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
      <main className="mx-auto max-w-full px-3 py-4 sm:px-6 sm:py-8">
        <div className="mb-4 sm:mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLocation(backPath)}
              data-testid="button-back"
            >
              ← {backLabel}
            </Button>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
            <div>
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <Badge variant="outline" className="font-mono">
                  {project.code}
                </Badge>
                <StatusBadge status={project.status} type="project" />
                {healthSnapshot && healthSnapshot.overallScore > 0 && (
                  <HealthScoreBadge
                    score={healthSnapshot.overallScore}
                    trendDirection={healthSnapshot.trendDirection}
                    size="sm"
                  />
                )}
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-foreground">
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
                  onClick={() => handleSetActiveTab("financials")}
                  data-testid="button-go-to-financials"
                >
                  Set Up Financials
                </Button>
              </AlertDescription>
            </Alert>
          )}

        {project.status === "COMPLETE" && hasManagementAccess(user?.role) && (
          <Alert className="mb-6 border-blue-200 bg-blue-50 dark:bg-blue-950/20" data-testid="alert-handover-prompt">
            <Building2 className="h-4 w-4 text-blue-600" />
            <AlertTitle className="text-blue-800 dark:text-blue-300">Project Complete — Begin Asset Handover</AlertTitle>
            <AlertDescription className="flex items-center justify-between gap-4 flex-wrap">
              <span className="text-blue-700 dark:text-blue-400">
                This project is complete. Start the handover process to transfer keys, documents, and equipment to the owner.
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleSetActiveTab("asset-handover")}
                data-testid="button-go-to-handover"
              >
                <ClipboardCheck className="h-4 w-4 mr-2" />
                Start Handover
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
                onClick={() => handleSetActiveTab("materials")}
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
          onValueChange={handleSetActiveTab}
          className="space-y-6"
        >
          <div className="lg:hidden">
            <Select value={activeTab} onValueChange={handleSetActiveTab}>
              <SelectTrigger className="w-full" data-testid="select-tab-mobile">
                <SelectValue placeholder="Select tab" />
              </SelectTrigger>
              <SelectContent>
                {groupedTabs.map((entry) => (
                  <SelectGroup key={entry.group}>
                    <SelectLabel data-testid={`select-group-${entry.group}`}>{entry.group}</SelectLabel>
                    {entry.tabs.map((tab) => (
                      <SelectItem key={tab.value} value={tab.value}>
                        {tab.label} {tab.badge ? `(${tab.badge})` : ""}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="hidden lg:flex flex-col gap-0 w-full">
            {pinnedTabValues.length > 0 && (
              <div className="flex items-center gap-1 px-2 py-1.5 bg-primary/5 border border-border rounded-t-md" data-testid="pinned-tabs-row">
                <Star className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mr-1">Pinned</span>
                {pinnedTabValues.map(pv => {
                  const tab = visibleTabs.find(t => t.value === pv);
                  if (!tab) return null;
                  const IconComp = tab.icon;
                  return (
                    <button
                      key={pv}
                      type="button"
                      onClick={() => {
                        handleSetActiveTab(pv);
                      }}
                      className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded-sm transition-all select-none ${
                        activeTab === pv
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "bg-background text-foreground hover:bg-muted shadow-sm border border-border/50"
                      }`}
                      data-testid={`pinned-tab-${pv}`}
                    >
                      <IconComp className="h-3.5 w-3.5" />
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            )}

            <div className={`flex items-center gap-1 bg-muted p-1 border-b border-border ${pinnedTabValues.length > 0 ? "rounded-none" : "rounded-t-md"}`} data-testid="category-tabs-row">
              {groupedTabs.map((entry) => (
                <button
                  key={entry.group}
                  type="button"
                  onClick={() => handleCategoryClick(entry.group)}
                  className={`px-4 py-2 text-xs font-semibold uppercase tracking-wider rounded-sm transition-all select-none ${
                    activeCategory === entry.group
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                  }`}
                  data-testid={`category-tab-${entry.group}`}
                >
                  {entry.group}
                </button>
              ))}
              <div className="ml-auto">
                <Popover open={tabSearchOpen} onOpenChange={(open) => {
                  setTabSearchOpen(open);
                  if (open) setTimeout(() => searchInputRef.current?.focus(), 100);
                  else setTabSearchQuery("");
                }}>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" data-testid="button-tab-search">
                      <Search className="h-3.5 w-3.5" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 p-2" align="end" data-testid="tab-search-popover">
                    <Input
                      ref={searchInputRef}
                      placeholder="Search tabs..."
                      value={tabSearchQuery}
                      onChange={(e) => setTabSearchQuery(e.target.value)}
                      className="h-8 text-sm mb-2"
                      data-testid="input-tab-search"
                    />
                    <ScrollArea className="max-h-64">
                      <div className="space-y-0.5">
                        {visibleTabs
                          .filter(t => t.label.toLowerCase().includes(tabSearchQuery.toLowerCase()) || t.group.toLowerCase().includes(tabSearchQuery.toLowerCase()))
                          .map(tab => {
                            const IconComp = tab.icon;
                            const isPinned = pinnedTabValues.includes(tab.value);
                            return (
                              <div key={tab.value} className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    handleSetActiveTab(tab.value);
                                    setTabSearchOpen(false);
                                    setTabSearchQuery("");
                                  }}
                                  className={`flex-1 flex items-center gap-2 px-2 py-1.5 text-xs rounded-sm hover:bg-muted transition-colors text-left ${
                                    activeTab === tab.value ? "bg-muted font-medium" : ""
                                  }`}
                                  data-testid={`search-result-${tab.value}`}
                                >
                                  <IconComp className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                  <span>{tab.label}</span>
                                  <span className="text-[10px] text-muted-foreground ml-auto">{tab.group}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => togglePinnedTab(tab.value)}
                                  className={`p-1 rounded-sm hover:bg-muted transition-colors ${isPinned ? "text-amber-500" : "text-muted-foreground/40 hover:text-muted-foreground"}`}
                                  data-testid={`pin-tab-${tab.value}`}
                                  title={isPinned ? "Unpin tab" : "Pin tab"}
                                >
                                  <Star className={`h-3 w-3 ${isPinned ? "fill-amber-500" : ""}`} />
                                </button>
                              </div>
                            );
                          })}
                        {visibleTabs.filter(t => t.label.toLowerCase().includes(tabSearchQuery.toLowerCase()) || t.group.toLowerCase().includes(tabSearchQuery.toLowerCase())).length === 0 && (
                          <p className="text-xs text-muted-foreground text-center py-3">No tabs found</p>
                        )}
                      </div>
                    </ScrollArea>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {groupedTabs
              .filter((entry) => entry.group === activeCategory)
              .map((entry) => (
                <TabsList
                  key={entry.group}
                  className="flex flex-wrap gap-1 h-auto w-full justify-start rounded-t-none rounded-b-md bg-muted/50 p-1"
                  data-testid={`tab-group-${entry.group}`}
                >
                  {entry.tabs.map((tab) => {
                    const IconComp = tab.icon;
                    const isPinned = pinnedTabValues.includes(tab.value);
                    return (
                      <TabsTrigger
                        key={tab.value}
                        value={tab.value}
                        className="group relative"
                        data-testid={`tab-${tab.value}`}
                      >
                        <IconComp className="h-4 w-4 mr-1" />
                        {tab.label}
                        {tab.badge !== undefined && (
                          <Badge className="ml-2" variant="secondary">
                            {tab.badge}
                          </Badge>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            togglePinnedTab(tab.value);
                          }}
                          className={`ml-1 opacity-0 group-hover:opacity-100 transition-opacity ${isPinned ? "opacity-100 text-amber-500" : "text-muted-foreground/50"}`}
                          data-testid={`pin-inline-${tab.value}`}
                          title={isPinned ? "Unpin" : "Pin to top"}
                        >
                          <Star className={`h-3 w-3 ${isPinned ? "fill-amber-500" : ""}`} />
                        </button>
                      </TabsTrigger>
                    );
                  })}
                </TabsList>
              ))}
          </div>

          <TabsContent value="overview" className="space-y-6">
            <OverviewTab
              project={project}
              projectCode={projectCode}
              changeOrders={changeOrders}
              financials={financials}
              financialsLoading={financialsLoading}
              setActiveTab={handleSetActiveTab}
            />
            <GeofenceEnforcementCard project={project} projectCode={projectCode} />
            <AutoChangeOrderSettingsCard project={project} projectCode={projectCode} />
            {hasManagementAccess(user?.role) && (
              <GeofenceComplianceSection projectId={project.id as string} />
            )}
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

          <TabsContent value="field-takeoff">
            <FieldTakeoffTab
              projectId={project.id}
              projectCode={projectCode}
            />
          </TabsContent>

          <TabsContent value="locations">
            <LocationManagerTab
              projectId={project.id}
              projectCode={projectCode}
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
            <DailyNoteFeed projectId={project.id} projectCode={projectCode} availableUsers={allUsers} />
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

          <TabsContent value="project-vault">
            <ProjectVaultTab
              projectCode={project.code}
              projectId={project.id}
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

          <TabsContent value="project-financials">
            <FinancialsTab
              project={project}
              projectCode={projectCode}
              userRole={user?.role || ""}
              changeOrders={changeOrders}
              changeOrdersLoading={changeOrdersLoading}
              canAccessSOV={canAccessSOV}
              activeSubTab={financialSubTab}
              onSubTabChange={setFinancialSubTab}
            />
          </TabsContent>

          <TabsContent value="punch-list">
            <PunchListTab
              projectId={project.id}
              projectCode={project.code}
              userRole={user?.role ?? "VIEWER"}
            />
          </TabsContent>

          <TabsContent value="contracts">
            <ContractsTab
              projectId={project.id}
              projectCode={project.code}
              userRole={user?.role || ""}
            />
          </TabsContent>

          <TabsContent value="asset-handover">
            <AssetHandoverTab
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
              handoverComplete={handoverComplete}
            />
          </TabsContent>

          <TabsContent value="maintenance-logs">
            <MaintenanceLogsTab
              projectId={project.id}
              projectCode={project.code}
              userRole={user?.role ?? "VIEWER"}
              handoverComplete={handoverComplete}
            />
          </TabsContent>

          <TabsContent value="risks">
            <RisksTab
              projectId={project.id}
              projectCode={project.code}
              userRole={user?.role ?? "VIEWER"}
            />
          </TabsContent>

          <TabsContent value="safety-training">
            <SafetyTrainingTab
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
            ) : (closeoutReadiness.openPunchListItems === 0 && closeoutReadiness.pendingChangeOrders === 0 && closeoutReadiness.submittedTmTickets === 0 && closeoutReadiness.pendingPayApplications === 0 && closeoutReadiness.openRfis === 0 && closeoutReadiness.unpaidVendorInvoices === 0) ? (
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

                {closeoutReadiness.pendingPayApplications > 0 && (
                  <div className="flex items-center justify-between p-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20">
                    <div className="flex items-center gap-2">
                      <XCircle className="w-4 h-4 text-amber-600" />
                      <span className="text-sm font-medium">Open SOV Pay Applications (Draft / Submitted)</span>
                    </div>
                    <span className="text-sm font-bold text-amber-700 dark:text-amber-400">
                      {closeoutReadiness.pendingPayApplications}
                    </span>
                  </div>
                )}

                {closeoutReadiness.openRfis > 0 && (
                  <div className="flex items-center justify-between p-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20">
                    <div className="flex items-center gap-2">
                      <XCircle className="w-4 h-4 text-amber-600" />
                      <span className="text-sm font-medium">Open RFIs (Submitted / Under Review)</span>
                    </div>
                    <span className="text-sm font-bold text-amber-700 dark:text-amber-400">
                      {closeoutReadiness.openRfis}
                    </span>
                  </div>
                )}

                {closeoutReadiness.unpaidVendorInvoices > 0 && (
                  <div className="flex items-center justify-between p-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20">
                    <div className="flex items-center gap-2">
                      <XCircle className="w-4 h-4 text-amber-600" />
                      <span className="text-sm font-medium">Unpaid Vendor Invoices</span>
                    </div>
                    <span className="text-sm font-bold text-amber-700 dark:text-amber-400">
                      {closeoutReadiness.unpaidVendorInvoices}
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

function GeofenceEnforcementCard({ project, projectCode }: { project: Record<string, unknown>; projectCode: string }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const canManage = user && hasManagementAccess(user.role, FeaturePermissions.PROJECT_MANAGEMENT);
  const currentMode = (project.geofenceEnforcement as string) || "OFF";
  const updateMutation = useMutation({
    mutationFn: async (mode: string) => {
      await apiRequest("PATCH", `/api/projects/${projectCode}`, { geofenceEnforcement: mode });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode] });
      toast({ title: "Geofence enforcement updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Update Failed", description: err.message, variant: "destructive" });
    },
  });

  const modeConfig = {
    OFF: { icon: ShieldOff, label: "Off", desc: "No geofence checks on clock-in", color: "text-muted-foreground" },
    WARN: { icon: Shield, label: "Warn", desc: "Clock-in allowed but flagged if out of range", color: "text-amber-600 dark:text-amber-400" },
    BLOCK: { icon: ShieldAlert, label: "Block", desc: "Clock-in blocked if out of geofence range", color: "text-red-600 dark:text-red-400" },
  };
  const current = modeConfig[currentMode as keyof typeof modeConfig] || modeConfig.OFF;
  const CurrentIcon = current.icon;

  return (
    <Card data-testid="card-geofence-settings">
      <CardHeader>
        <div className="flex items-center gap-2">
          <CurrentIcon className={`w-5 h-5 ${current.color}`} />
          <CardTitle className="text-base">Geo-fence Enforcement</CardTitle>
        </div>
        <CardDescription>{current.desc}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Label className="text-sm font-medium">Enforcement Mode:</Label>
            <Badge variant={currentMode === "BLOCK" ? "destructive" : currentMode === "WARN" ? "outline" : "secondary"} data-testid="badge-geofence-mode">
              {current.label}
            </Badge>
          </div>
          {canManage && (
            <div className="flex gap-2">
              {(["OFF", "WARN", "BLOCK"] as const).map((mode) => {
                const cfg = modeConfig[mode];
                const ModeIcon = cfg.icon;
                return (
                  <Button
                    key={mode}
                    variant={currentMode === mode ? "default" : "outline"}
                    size="sm"
                    disabled={updateMutation.isPending}
                    onClick={() => updateMutation.mutate(mode)}
                    data-testid={`button-geofence-${mode.toLowerCase()}`}
                  >
                    <ModeIcon className="w-4 h-4 mr-1" />
                    {cfg.label}
                  </Button>
                );
              })}
            </div>
          )}
          {project.siteLatitude && project.siteLongitude && (
            <div className="text-xs text-muted-foreground mt-2" data-testid="text-geofence-site-coords">
              Site: {(project.siteLatitude as number).toFixed(6)}, {(project.siteLongitude as number).toFixed(6)}
              {project.geofenceRadius && ` · Radius: ${project.geofenceRadius}m`}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function AutoChangeOrderSettingsCard({ project, projectCode }: { project: Record<string, unknown>; projectCode: string }) {
  const canManage = hasManagementAccess(useAuth().user?.role);
  const { toast } = useToast();
  const [thresholdInput, setThresholdInput] = useState(String(project.autoChangeOrderThreshold || "0"));

  const toggleMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      await apiRequest("PATCH", `/api/projects/${projectCode}`, { autoChangeOrderEnabled: enabled });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode] });
      toast({ title: "Auto change order setting updated" });
    },
    onError: () => { toast({ title: "Failed to update setting", variant: "destructive" }); },
  });

  const thresholdMutation = useMutation({
    mutationFn: async (threshold: string) => {
      await apiRequest("PATCH", `/api/projects/${projectCode}`, { autoChangeOrderThreshold: threshold });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode] });
      toast({ title: "Cost threshold updated" });
    },
    onError: () => { toast({ title: "Failed to update threshold", variant: "destructive" }); },
  });

  const isEnabled = project.autoChangeOrderEnabled !== false;

  return (
    <Card data-testid="card-auto-co-settings">
      <CardHeader>
        <div className="flex items-center gap-2">
          <FileCheck className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          <CardTitle className="text-base">Auto Change Orders from Plan Revisions</CardTitle>
        </div>
        <CardDescription>Automatically generate draft change orders when takeoff sheets are superseded with quantity/cost changes.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="auto-co-toggle" className="text-sm font-medium">Enable Auto-Generation</Label>
            {canManage ? (
              <Switch
                id="auto-co-toggle"
                checked={isEnabled}
                onCheckedChange={(checked) => toggleMutation.mutate(checked)}
                disabled={toggleMutation.isPending}
                data-testid="switch-auto-co-enabled"
              />
            ) : (
              <Badge variant={isEnabled ? "default" : "secondary"} data-testid="badge-auto-co-status">
                {isEnabled ? "Enabled" : "Disabled"}
              </Badge>
            )}
          </div>
          {isEnabled && canManage && (
            <div className="space-y-2">
              <Label htmlFor="co-threshold" className="text-sm">Cost Threshold ($)</Label>
              <p className="text-xs text-muted-foreground">Minimum absolute cost delta to trigger a change order. Set to 0 to always create.</p>
              <div className="flex gap-2">
                <Input
                  id="co-threshold"
                  type="number"
                  min="0"
                  step="0.01"
                  value={thresholdInput}
                  onChange={(e) => setThresholdInput(e.target.value)}
                  className="w-40"
                  data-testid="input-co-threshold"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => thresholdMutation.mutate(thresholdInput)}
                  disabled={thresholdMutation.isPending}
                  data-testid="button-save-co-threshold"
                >
                  Save
                </Button>
              </div>
            </div>
          )}
          {isEnabled && !canManage && (
            <div className="text-sm text-muted-foreground" data-testid="text-co-threshold-value">
              Cost threshold: ${Number(project.autoChangeOrderThreshold || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function GeofenceComplianceSection({ projectId }: { projectId: string }) {
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split("T")[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split("T")[0]);

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (startDate) params.set("startDate", new Date(startDate).toISOString());
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      params.set("endDate", end.toISOString());
    }
    return params.toString();
  }, [startDate, endDate]);

  const { data, isLoading } = useQuery<{
    shifts: Array<{
      id: string;
      userId: string;
      userName: string;
      clockIn: string;
      clockOut: string | null;
      geofenceStatus: string | null;
      clockOutGeofenceStatus: string | null;
    }>;
    summary: {
      totalShifts: number;
      clockInViolations: number;
      clockOutViolations: number;
    };
  }>({
    queryKey: [`/api/time-clock/project/${projectId}/geofence-compliance`, queryParams],
    queryFn: async () => {
      const res = await fetch(`/api/time-clock/project/${projectId}/geofence-compliance?${queryParams}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch compliance data");
      return res.json();
    },
  });

  const getStatusBadge = (status: string | null, label: string) => {
    if (!status || status === "NOT_CONFIGURED") {
      return <Badge variant="secondary" data-testid={`badge-${label}-not-configured`}>N/A</Badge>;
    }
    if (status === "WITHIN_RANGE") {
      return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" data-testid={`badge-${label}-within`}>Within Range</Badge>;
    }
    if (status === "OUT_OF_RANGE") {
      return <Badge variant="destructive" data-testid={`badge-${label}-out`}>Out of Range</Badge>;
    }
    if (status === "NO_GPS") {
      return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200" data-testid={`badge-${label}-no-gps`}>No GPS</Badge>;
    }
    return <Badge variant="secondary">{status}</Badge>;
  };

  return (
    <Card data-testid="card-geofence-compliance">
      <CardHeader>
        <div className="flex items-center gap-2">
          <MapPin className="w-5 h-5 text-primary" />
          <CardTitle className="text-base">Geo-fence Compliance</CardTitle>
        </div>
        <CardDescription>Recent shift geo-fence statuses for this project</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-end gap-4 mb-4">
          <div className="space-y-1">
            <Label className="text-xs">Start Date</Label>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-40 h-8 text-sm"
              data-testid="input-compliance-start-date"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">End Date</Label>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-40 h-8 text-sm"
              data-testid="input-compliance-end-date"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Loading compliance data...
          </div>
        ) : data && data.shifts.length > 0 ? (
          <>
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="p-3 rounded-lg bg-muted/50 text-center">
                <p className="text-2xl font-bold" data-testid="text-total-shifts">{data.summary.totalShifts}</p>
                <p className="text-xs text-muted-foreground">Total Shifts</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/50 text-center">
                <p className="text-2xl font-bold text-red-600 dark:text-red-400" data-testid="text-clockin-violations">{data.summary.clockInViolations}</p>
                <p className="text-xs text-muted-foreground">Clock-In Violations</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/50 text-center">
                <p className="text-2xl font-bold text-red-600 dark:text-red-400" data-testid="text-clockout-violations">{data.summary.clockOutViolations}</p>
                <p className="text-xs text-muted-foreground">Clock-Out Violations</p>
              </div>
            </div>

            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-2 font-medium">Employee</th>
                    <th className="text-left p-2 font-medium">Clock In</th>
                    <th className="text-left p-2 font-medium">Clock In Status</th>
                    <th className="text-left p-2 font-medium">Clock Out</th>
                    <th className="text-left p-2 font-medium">Clock Out Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.shifts.map((shift) => {
                    const hasViolation =
                      shift.geofenceStatus === "OUT_OF_RANGE" ||
                      shift.geofenceStatus === "NO_GPS" ||
                      shift.clockOutGeofenceStatus === "OUT_OF_RANGE" ||
                      shift.clockOutGeofenceStatus === "NO_GPS";
                    return (
                      <tr
                        key={shift.id}
                        className={`border-b last:border-b-0 ${hasViolation ? "bg-red-50 dark:bg-red-950/20" : ""}`}
                        data-testid={`row-compliance-shift-${shift.id}`}
                      >
                        <td className="p-2" data-testid={`text-employee-${shift.id}`}>{shift.userName}</td>
                        <td className="p-2 text-muted-foreground">
                          {format(new Date(shift.clockIn), "MMM d, h:mm a")}
                        </td>
                        <td className="p-2">{getStatusBadge(shift.geofenceStatus, `clockin-${shift.id}`)}</td>
                        <td className="p-2 text-muted-foreground">
                          {shift.clockOut ? format(new Date(shift.clockOut), "MMM d, h:mm a") : "Active"}
                        </td>
                        <td className="p-2">{getStatusBadge(shift.clockOutGeofenceStatus, `clockout-${shift.id}`)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="text-center py-8 text-muted-foreground" data-testid="text-no-compliance-data">
            No shifts found for this date range.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
