import { useState, useEffect, useMemo, useCallback } from "react";
import { ContextualHelpButton } from "@/components/ContextualHelpButton";
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
import MaterialTestingSection from "@/components/MaterialTestingSection";
import MaterialBudgetTracker from "@/components/MaterialBudgetTracker";
import ProjectRFIs from "@/components/ProjectRFIs";
import ProjectTransmittals from "@/components/ProjectTransmittals";
import ProjectSubmittals from "@/components/ProjectSubmittals";
import CloseoutReadinessCard from "@/components/CloseoutReadinessCard";
import SubcontractorPortalManager from "@/components/SubcontractorPortalManager";
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
  ScanLine,
  StickyNote,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Layers,
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
import CertifiedPayrollHistoryTab from "@/components/project-tabs/CertifiedPayrollHistoryTab";
import ProjectEquipmentTab from "@/components/project-tabs/ProjectEquipmentTab";
import PunchListTab from "@/components/PunchListTab";
import WarrantyTab from "@/components/WarrantyTab";
import AssetHandoverTab from "@/components/AssetHandoverTab";
import ProjectCloseoutPage from "@/pages/project-closeout";
import MaintenanceLogsTab from "@/components/MaintenanceLogsTab";
import ContractsTab from "@/components/project-tabs/ContractsTab";
import FinancialsTab from "@/components/project-tabs/FinancialsTab";
import SafetyTrainingTab from "@/components/project-tabs/SafetyTrainingTab";
import ProjectVaultTab from "@/components/project-tabs/ProjectVaultTab";
import RisksTab from "@/components/project-tabs/RisksTab";
import LocationManagerTab from "@/components/project-tabs/LocationManagerTab";
import MapPickerDialog from "@/components/MapPickerDialog";
import FieldTakeoffTab from "@/components/project-tabs/FieldTakeoffTab";
import LidarTab from "@/components/project-tabs/LidarTab";
import ProjectNotesTab from "@/components/project-tabs/ProjectNotesTab";
import MobilizationTab from "@/components/project-tabs/MobilizationTab";
import ProjectReportsTab from "@/components/project-tabs/ProjectReportsTab";
import ScheduledLogEmailsCard from "@/components/project-tabs/ScheduledLogEmailsCard";
import PermitsTab from "@/components/PermitsTab";
import { useFeaturePermission } from "@/hooks/use-dashboard-customization";
import HealthScoreBadge from "@/components/HealthScoreBadge";
import { ComplianceBadge } from "@/components/ComplianceBadge";
import { SuggestedTakeoffsCard } from "@/components/SuggestedTakeoffsCard";
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

type NavGroupId =
  | "overview"
  | "plan-schedule"
  | "scope-cost"
  | "field"
  | "people-time"
  | "communication"
  | "closeout"
  | "sharing";

interface NavGroupDef {
  id: NavGroupId;
  label: string;
}

const NAV_GROUPS: NavGroupDef[] = [
  { id: "overview", label: "Overview" },
  { id: "plan-schedule", label: "Plan & Schedule" },
  { id: "scope-cost", label: "Scope & Cost" },
  { id: "field", label: "Field" },
  { id: "people-time", label: "People & Time" },
  { id: "communication", label: "Communication" },
  { id: "closeout", label: "Closeout" },
  { id: "sharing", label: "Sharing" },
];

interface TabConfig {
  value: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
  visible: boolean;
  group: NavGroupId;
}

interface NavGroupEntry {
  group: NavGroupDef;
  tabs: TabConfig[];
}

function buildTabConfigs(
  userRole: string | undefined,
  canAccessSOV: boolean,
  projectStatus?: string,
  canManagePayrollFlag?: boolean,
): TabConfig[] {
  const isProjectComplete = projectStatus === "COMPLETE" || projectStatus === "CLOSED";
  const showAssetMgmt = isProjectComplete || hasManagementAccess(userRole);
  return [
    { value: "overview", label: "Overview", icon: LayoutDashboard, visible: true, group: "overview" },
    { value: "job-info", label: "Job Info", icon: Info, visible: true, group: "overview" },
    { value: "risks", label: "Risks", icon: AlertTriangle, visible: hasManagementAccess(userRole), group: "overview" },

    { value: "schedule", label: "Schedule", icon: CalendarIcon, visible: true, group: "plan-schedule" },
    { value: "delays", label: "Delays", icon: CloudRain, visible: true, group: "plan-schedule" },
    { value: "mobilization", label: "Mobilization", icon: HardHat, visible: hasManagementAccess(userRole), group: "plan-schedule" },
    { value: "locations", label: "Locations", icon: MapPin, visible: hasManagementAccess(userRole), group: "plan-schedule" },
    { value: "plans", label: "Plans & Takeoff", icon: Ruler, visible: true, group: "plan-schedule" },
    { value: "field-takeoff", label: "Field Takeoff", icon: ClipboardCheck, visible: true, group: "plan-schedule" },

    { value: "scope", label: "Scope & Progress", icon: ListChecks, visible: true, group: "scope-cost" },
    { value: "materials", label: "Materials", icon: Package, visible: true, group: "scope-cost" },
    { value: "estimate", label: "Estimate", icon: Calculator, visible: FeaturePermissions.VIEW_ESTIMATES_TAB(userRole), group: "scope-cost" },
    { value: "procurement", label: "Procurement", icon: ShoppingCart, visible: FeaturePermissions.VIEW_PROCUREMENT_TAB(userRole), group: "scope-cost" },
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
      group: "scope-cost",
    },
    { value: "contracts", label: "Contracts", icon: FileText, visible: ["ADMIN", "MANAGER", "SUPERINTENDENT"].includes(userRole || ""), group: "scope-cost" },

    { value: "daily-notes", label: "Daily Notes", icon: NotebookPen, visible: true, group: "field" },
    { value: "project-notes", label: "Project Notes", icon: StickyNote, visible: ["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"].includes(userRole || ""), group: "field" },
    { value: "inspections", label: "Inspections", icon: CalendarCheck, visible: true, group: "field" },
    { value: "punch-list", label: "Punch List", icon: ClipboardList, visible: hasManagementAccess(userRole), group: "field" },
    { value: "safety-training", label: "Safety Training", icon: ShieldCheck, visible: hasManagementAccess(userRole), group: "field" },
    { value: "permits", label: "Permits", icon: FileCheck, visible: ["ADMIN", "MANAGER", "SUPERINTENDENT", "HUSTLER"].includes(userRole || ""), group: "field" },
    { value: "media", label: "Photos & Videos", icon: Camera, visible: true, group: "field" },
    { value: "lidar-scans", label: "LiDAR Scans", icon: ScanLine, visible: ["ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR", "FIELD_WORKER", "HUSTLER"].includes(userRole || ""), group: "field" },

    { value: "time", label: "Time & T&M", icon: Clock, visible: FeaturePermissions.VIEW_TIME_ENTRIES_TAB(userRole), group: "people-time" },
    { value: "labor", label: "Labor", icon: HardHat, visible: FeaturePermissions.VIEW_TIME_ENTRIES_TAB(userRole), group: "people-time" },
    { value: "subcontractors", label: "Subcontractors", icon: Users, visible: FeaturePermissions.VIEW_SUBCONTRACTORS_TAB(userRole), group: "people-time" },
    { value: "payroll", label: "Payroll", icon: Banknote, visible: hasManagementAccess(userRole), group: "people-time" },
    {
      value: "certified-payroll-history",
      label: "Certified Payroll History",
      icon: FileCheck,
      // Match the backend gate (canManagePayroll) so we never show a tab
      // that 403s for the viewer. Fall back to management access until the
      // permission flag has loaded.
      visible: canManagePayrollFlag ?? hasManagementAccess(userRole),
      group: "people-time",
    },
    { value: "equipment", label: "Equipment", icon: Truck, visible: FeaturePermissions.VIEW_EQUIPMENT(userRole), group: "people-time" },

    { value: "email-communications", label: "Email", icon: Mail, visible: hasManagementAccess(userRole), group: "communication" },
    { value: "jobsite-ai", label: "AI Jobsite", icon: Bot, visible: hasManagementAccess(userRole), group: "communication" },
    { value: "rfis", label: "RFIs", icon: HelpCircle, visible: hasManagementAccess(userRole), group: "communication" },
    { value: "transmittals", label: "Transmittals", icon: Send, visible: hasManagementAccess(userRole), group: "communication" },
    { value: "submittals", label: "Submittals", icon: FileCheck, visible: hasManagementAccess(userRole), group: "communication" },

    { value: "closeout", label: "Closeout Package", icon: Archive, visible: hasManagementAccess(userRole), group: "closeout" },
    { value: "asset-handover", label: "Handover", icon: ClipboardCheck, visible: showAssetMgmt, group: "closeout" },
    { value: "warranty", label: "Warranty", icon: ShieldCheck, visible: showAssetMgmt, group: "closeout" },
    { value: "maintenance-logs", label: "Maintenance", icon: Wrench, visible: showAssetMgmt, group: "closeout" },
    { value: "progress-reports", label: "Reports", icon: FileText, visible: hasManagementAccess(userRole), group: "closeout" },

    { value: "project-vault", label: "Project Vault", icon: Archive, visible: hasManagementAccess(userRole), group: "sharing" },
    { value: "portal-access", label: "Portal Access", icon: ExternalLink, visible: hasManagementAccess(userRole), group: "sharing" },
    { value: "client-portal", label: "Client Portal", icon: Building2, visible: hasManagementAccess(userRole), group: "sharing" },
    { value: "subcontractor-portal", label: "Subcontractor Portal", icon: Users, visible: hasManagementAccess(userRole), group: "sharing" },
  ];
}

function buildNavSections(tabs: TabConfig[]): NavGroupEntry[] {
  const sections: NavGroupEntry[] = [];
  for (const group of NAV_GROUPS) {
    const items = tabs.filter((t) => t.group === group.id);
    if (items.length > 0) sections.push({ group, tabs: items });
  }
  return sections;
}

const NAV_COLLAPSED_KEY = "project-hub-nav-collapsed";
const NAV_GROUPS_KEY = "project-hub-nav-groups";

function loadCollapsedRail(): boolean {
  try {
    return localStorage.getItem(NAV_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function loadGroupCollapseState(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(NAV_GROUPS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

interface ProjectHubNavRailProps {
  sections: NavGroupEntry[];
  activeTab: string;
  onSelect: (value: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  collapsedGroups: Record<string, boolean>;
  onToggleGroup: (groupId: NavGroupId) => void;
}

function ProjectHubNavRail({
  sections,
  activeTab,
  onSelect,
  collapsed,
  onToggleCollapsed,
  collapsedGroups,
  onToggleGroup,
}: ProjectHubNavRailProps) {
  return (
    <nav
      className={`hidden md:flex flex-col shrink-0 border-r border-border bg-card/50 sticky top-4 self-start max-h-[calc(100vh-2rem)] overflow-y-auto rounded-md transition-[width] duration-200 ${
        collapsed ? "w-[56px]" : "w-[220px]"
      }`}
      data-testid="project-hub-nav-rail"
      aria-label="Project sections"
    >
      <div className={`flex items-center ${collapsed ? "justify-center" : "justify-between"} px-2 py-2 border-b border-border`}>
        {!collapsed && (
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-1">
            Sections
          </span>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onToggleCollapsed}
              data-testid="button-toggle-nav-rail"
              aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            >
              {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{collapsed ? "Expand" : "Collapse"}</TooltipContent>
        </Tooltip>
      </div>

      <div className="flex flex-col py-1">
        {sections.map((section) => {
          const isCollapsedGroup = !collapsed && (collapsedGroups[section.group.id] ?? false);
          return (
            <div key={section.group.id} className="py-0.5">
              {!collapsed && (
                <button
                  type="button"
                  onClick={() => onToggleGroup(section.group.id)}
                  className="w-full flex items-center justify-between px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
                  data-testid={`nav-group-header-${section.group.id}`}
                  aria-expanded={!isCollapsedGroup}
                >
                  <span>{section.group.label}</span>
                  <ChevronDown className={`h-3 w-3 transition-transform ${isCollapsedGroup ? "-rotate-90" : ""}`} />
                </button>
              )}
              {collapsed && (
                <div
                  className="mx-2 my-1 border-t border-border/60"
                  data-testid={`nav-group-divider-${section.group.id}`}
                  aria-hidden
                />
              )}
              {(!isCollapsedGroup) && (
                <div className="flex flex-col">
                  {section.tabs.map((tab) => {
                    const Icon = tab.icon;
                    const isActive = activeTab === tab.value;
                    const button = (
                      <button
                        key={tab.value}
                        type="button"
                        onClick={() => onSelect(tab.value)}
                        className={`group relative flex items-center gap-2 ${collapsed ? "justify-center px-0" : "px-3"} py-1.5 mx-1 rounded-md text-sm transition-colors ${
                          isActive
                            ? "bg-primary/10 text-foreground font-medium"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        }`}
                        data-testid={`nav-item-${tab.value}`}
                        aria-current={isActive ? "page" : undefined}
                      >
                        {isActive && (
                          <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-primary" aria-hidden />
                        )}
                        <Icon className="h-4 w-4 shrink-0" />
                        {!collapsed && <span className="truncate">{tab.label}</span>}
                        {!collapsed && tab.badge !== undefined && (
                          <Badge variant="secondary" className="ml-auto h-4 px-1 text-[10px]">
                            {tab.badge}
                          </Badge>
                        )}
                      </button>
                    );
                    if (collapsed) {
                      return (
                        <Tooltip key={tab.value}>
                          <TooltipTrigger asChild>{button}</TooltipTrigger>
                          <TooltipContent side="right">{tab.label}</TooltipContent>
                        </Tooltip>
                      );
                    }
                    return button;
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}

export default function ProjectDetailPage() {
  const [, setLocation] = useLocation();
  const searchParams = new URLSearchParams(window.location.search);
  const urlTab = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState(urlTab || "overview");
  const [financialSubTab, setFinancialSubTab] = useState("live-financials");
  const [portalSubTab, setPortalSubTab] = useState("client-portal");
  const [, params] = useRoute("/projects/:code");
  const { user } = useAuth();
  const { toast } = useToast();
  const [showCloseoutDialog, setShowCloseoutDialog] = useState(false);
  const [showSaveTemplateDialog, setShowSaveTemplateDialog] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateCategory, setTemplateCategory] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");
  const canAccessFinancialsPerms = useFeaturePermission("canViewFinancials");
  const canManagePayrollPerm = useFeaturePermission("canManagePayroll");
  const canManageProjectTemplatesPerm = useFeaturePermission("canManageProjectTemplates");

  const [navCollapsed, setNavCollapsed] = useState<boolean>(() => loadCollapsedRail());
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => loadGroupCollapseState());

  const toggleNavCollapsed = useCallback(() => {
    setNavCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(NAV_COLLAPSED_KEY, next ? "1" : "0"); } catch {}
      return next;
    });
  }, []);

  const toggleNavGroup = useCallback((groupId: NavGroupId) => {
    setCollapsedGroups((prev) => {
      const next = { ...prev, [groupId]: !(prev[groupId] ?? false) };
      try { localStorage.setItem(NAV_GROUPS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

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
  const tabConfigs = buildTabConfigs(user?.role, canAccessSOV, project?.status, canManagePayrollPerm === true);
  const visibleTabs = tabConfigs.filter((t) => t.visible);
  const navSections = useMemo(() => buildNavSections(visibleTabs), [visibleTabs]);

  useEffect(() => {
    const currentParams = new URLSearchParams(window.location.search);
    const urlTabValue = currentParams.get("tab");
    if (urlTabValue && visibleTabs.length > 0) {
      const matched = visibleTabs.find((t) => t.value === urlTabValue);
      if (matched) {
        if (urlTabValue === "client-portal" || urlTabValue === "subcontractor-portal") {
          setActiveTab("portal-access");
          setPortalSubTab(urlTabValue);
        } else {
          setActiveTab(urlTabValue);
        }
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

  const syncTabToUrl = useCallback((tabValue: string) => {
    try {
      const params = new URLSearchParams(window.location.search);
      params.set("tab", tabValue);
      window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
    } catch {}
  }, []);

  const portalSubTabValues = new Set(["client-portal", "subcontractor-portal"]);

  const handleSetActiveTab = (tab: string) => {
    if (tab in financialSubTabMap) {
      setActiveTab("project-financials");
      setFinancialSubTab(financialSubTabMap[tab]);
      syncTabToUrl("project-financials");
    } else if (portalSubTabValues.has(tab)) {
      setActiveTab("portal-access");
      setPortalSubTab(tab);
      syncTabToUrl(tab);
    } else {
      const matched = visibleTabs.find((t) => t.value === tab);
      if (matched) {
        setActiveTab(tab);
        syncTabToUrl(tab);
      }
    }
  };

  const effectiveActiveTab = activeTab === "portal-access" ? portalSubTab : activeTab;
  const activeNavTab = visibleTabs.find((t) => t.value === effectiveActiveTab);

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
                <ComplianceBadge partyType="PROJECT" partyId={project.id} />
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
                {canManageProjectTemplatesPerm && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setTemplateName(`${project.name} Template`);
                      setTemplateCategory("");
                      setTemplateDescription("");
                      setShowSaveTemplateDialog(true);
                    }}
                    data-testid="button-save-as-template"
                  >
                    <Layers className="w-4 h-4 mr-2" />
                    Save as Template
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>

        <Dialog open={showSaveTemplateDialog} onOpenChange={setShowSaveTemplateDialog}>
          <DialogContent data-testid="dialog-save-template">
            <DialogHeader>
              <DialogTitle>Save project as template</DialogTitle>
              <DialogDescription>
                Capture this project's WBS, dependencies, distribution lists,
                cost codes, SoV and folder structure as a reusable template.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div>
                <Label>Template name *</Label>
                <Input
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  data-testid="input-save-template-name"
                />
              </div>
              <div>
                <Label>Category</Label>
                <Input
                  value={templateCategory}
                  onChange={(e) => setTemplateCategory(e.target.value)}
                  placeholder="e.g. Commercial, Heavy Civil, Residential"
                  data-testid="input-save-template-category"
                />
              </div>
              <div>
                <Label>Description</Label>
                <Input
                  value={templateDescription}
                  onChange={(e) => setTemplateDescription(e.target.value)}
                  placeholder="Short description shown in the library"
                  data-testid="input-save-template-description"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowSaveTemplateDialog(false)}
                data-testid="button-save-template-cancel"
              >
                Cancel
              </Button>
              <Button
                onClick={async () => {
                  if (!templateName.trim()) {
                    toast({ title: "Template name required", variant: "destructive" });
                    return;
                  }
                  try {
                    const res = await apiRequest("POST", "/api/project-templates/capture", {
                      projectCode: project.code,
                      name: templateName.trim(),
                      category: templateCategory.trim() || undefined,
                      description: templateDescription.trim() || undefined,
                    });
                    await res.json();
                    toast({ title: "Template saved", description: "Available in the template library." });
                    setShowSaveTemplateDialog(false);
                    queryClient.invalidateQueries({ queryKey: ["/api/project-templates"] });
                  } catch (err: any) {
                    toast({
                      title: "Failed to save template",
                      description: err?.message ?? "Unknown error",
                      variant: "destructive",
                    });
                  }
                }}
                data-testid="button-save-template-confirm"
              >
                Save template
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

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
          <div className="flex flex-col md:flex-row gap-4">
            <ProjectHubNavRail
              sections={navSections}
              activeTab={effectiveActiveTab}
              onSelect={handleSetActiveTab}
              collapsed={navCollapsed}
              onToggleCollapsed={toggleNavCollapsed}
              collapsedGroups={collapsedGroups}
              onToggleGroup={toggleNavGroup}
            />

            <div className="md:hidden">
              <Select value={effectiveActiveTab} onValueChange={handleSetActiveTab}>
                <SelectTrigger className="w-full" data-testid="select-tab-mobile">
                  <SelectValue placeholder="Select section">
                    {activeNavTab ? (
                      <span className="flex items-center gap-2">
                        <activeNavTab.icon className="h-4 w-4" />
                        {activeNavTab.label}
                      </span>
                    ) : (
                      "Select section"
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {navSections.map((section) => (
                    <SelectGroup key={section.group.id}>
                      <SelectLabel data-testid={`select-group-${section.group.id}`}>{section.group.label}</SelectLabel>
                      {section.tabs.map((tab) => (
                        <SelectItem key={tab.value} value={tab.value} data-testid={`select-tab-${tab.value}`}>
                          {tab.label} {tab.badge ? `(${tab.badge})` : ""}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex-1 min-w-0 space-y-6">

          <TabsContent value="overview" className="space-y-6">
            <OverviewTab
              project={project}
              projectCode={projectCode}
              changeOrders={changeOrders}
              financials={financials}
              financialsLoading={financialsLoading}
              setActiveTab={handleSetActiveTab}
            />
            <CloseoutReadinessCard
              projectCode={projectCode}
              onOpenCloseout={() => handleSetActiveTab("closeout")}
              onOpenPunchList={() => handleSetActiveTab("punch-list")}
              onOpenSubmittals={() => handleSetActiveTab("submittals")}
            />
            {/* Task #2404 — Auto-pickup of standalone takeoffs that match this project. */}
            <SuggestedTakeoffsCard destinationKind="project" destinationId={project.id as string} />
            <GeofenceEnforcementCard project={project} projectCode={projectCode} />
            {hasManagementAccess(user?.role) && (
              <GeofenceZonesPanel projectId={project.id as string} />
            )}
            <AutoChangeOrderSettingsCard project={project} projectCode={projectCode} />
            <CertifiedPayrollFormCard project={project} projectCode={projectCode} />
            {hasManagementAccess(user?.role) && (
              <ScheduledLogEmailsCard projectId={project.id as string} />
            )}
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
            <div className="space-y-4">
              <div className="flex justify-end">
                <ContextualHelpButton slugs={["schedule-of-values"]} />
              </div>
              <AiSchedulingPanel
                projectId={project.id}
                projectCode={projectCode}
                projectName={project.name}
                tradeType={(project as { tradeType?: string }).tradeType}
              />
            </div>
          </TabsContent>

          <TabsContent value="delays">
            <DelaysSection
              projectId={project.id}
              projectCode={projectCode}
              userRole={user?.role || ""}
            />
          </TabsContent>

          <TabsContent value="inspections">
            <div className="space-y-6">
              <InspectionsSection
                projectId={project.id}
                projectCode={projectCode}
                userRole={user?.role || ""}
              />
              <MaterialTestingSection
                projectId={project.id}
                projectCode={projectCode}
                userRole={user?.role || ""}
              />
            </div>
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

          <TabsContent value="project-notes">
            <ProjectNotesTab projectId={project.id} />
          </TabsContent>

          <TabsContent value="media">
            <MediaTab projectCode={projectCode} project={project} />
          </TabsContent>

          <TabsContent value="estimate">
            <ProjectEstimate />
          </TabsContent>

          <TabsContent value="procurement">
            <div className="space-y-4">
              <div className="flex justify-end">
                <ContextualHelpButton slugs={["procurement"]} />
              </div>
              <ProcurementTab projectCode={projectCode} project={project} />
            </div>
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
              financials={financials as React.ComponentProps<typeof LaborTab>["financials"]}
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

          <TabsContent value="certified-payroll-history">
            <CertifiedPayrollHistoryTab projectId={project.id} />
          </TabsContent>

          <TabsContent value="equipment">
            <ProjectEquipmentTab
              projectId={project.id}
              projectCode={project.code}
              userRole={user?.role || ""}
            />
          </TabsContent>

          <TabsContent value="rfis">
            <div className="space-y-4">
              <div className="flex justify-end">
                <ContextualHelpButton slugs={["rfis-submittals"]} />
              </div>
              <ProjectRFIs
                projectId={project.id}
                projectCode={project.code}
                userRole={user?.role || ""}
              />
            </div>
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
            <Tabs
              value={portalSubTab}
              onValueChange={(v) => {
                setPortalSubTab(v);
                syncTabToUrl(v);
              }}
              className="space-y-4"
            >
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
            <div className="space-y-4">
              <div className="flex justify-end">
                <ContextualHelpButton slugs={["schedule-of-values"]} />
              </div>
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
            </div>
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

          <TabsContent value="closeout">
            <div className="space-y-4">
              <div className="flex justify-end">
                <ContextualHelpButton slugs={["project-closeout"]} />
              </div>
              <ProjectCloseoutPage projectCode={projectCode} />
            </div>
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

          <TabsContent value="mobilization">
            <MobilizationTab
              projectId={project.id}
              projectCode={project.code}
              userRole={user?.role ?? "VIEWER"}
            />
          </TabsContent>

          <TabsContent value="progress-reports">
            <ProjectReportsTab projectId={project.id} />
          </TabsContent>

          <TabsContent value="lidar-scans">
            <LidarTab
              projectId={project.id}
              projectCode={project.code}
              userRole={user?.role ?? "VIEWER"}
            />
          </TabsContent>

          <TabsContent value="permits">
            <PermitsTab
              projectId={project.id}
              userRole={user?.role ?? "VIEWER"}
            />
          </TabsContent>
            </div>
          </div>
        </Tabs>
      </main>

      <Dialog open={showCloseoutDialog} onOpenChange={setShowCloseoutDialog}>
        <DialogContent className="sm:max-w-md">
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
  const canManage = user && hasManagementAccess(user.role);
  const currentMode = (project.geofenceEnforcement as string) || "OFF";

  const [editingCoords, setEditingCoords] = useState(false);
  const [siteLat, setSiteLat] = useState(String(project.siteLatitude || ""));
  const [siteLng, setSiteLng] = useState(String(project.siteLongitude || ""));
  const [radius, setRadius] = useState(String(project.geofenceRadius || "200"));
  const [pickerOpen, setPickerOpen] = useState(false);

  const updateMutation = useMutation({
    mutationFn: async (updates: Record<string, unknown>) => {
      await apiRequest("PATCH", `/api/projects/${projectCode}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode] });
      toast({ title: "Geofence settings updated" });
      setEditingCoords(false);
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
        <div className="space-y-4">
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
                    onClick={() => updateMutation.mutate({ geofenceEnforcement: mode })}
                    data-testid={`button-geofence-${mode.toLowerCase()}`}
                  >
                    <ModeIcon className="w-4 h-4 mr-1" />
                    {cfg.label}
                  </Button>
                );
              })}
            </div>
          )}

          {!editingCoords ? (
            <div className="space-y-3">
              {project.siteLatitude && project.siteLongitude ? (
                <>
                  <div className="text-xs text-muted-foreground" data-testid="text-geofence-site-coords">
                    Site: {(project.siteLatitude as number).toFixed(6)}, {(project.siteLongitude as number).toFixed(6)}
                    {" · "}Radius: {(project.geofenceRadius as number) || 200}m
                  </div>
                  <div className="border rounded-lg p-3 bg-muted/30" data-testid="geofence-boundary-preview">
                    <svg viewBox="0 0 200 200" className="w-full max-w-[180px] mx-auto" aria-label="Geofence boundary preview">
                      <circle cx="100" cy="100" r="70" fill="none" stroke={currentMode === "BLOCK" ? "#ef4444" : currentMode === "WARN" ? "#f59e0b" : "#94a3b8"} strokeWidth="2" strokeDasharray="6 3" opacity="0.6" />
                      <circle cx="100" cy="100" r="4" fill="#3b82f6" />
                      <text x="100" y="120" textAnchor="middle" fontSize="8" fill="currentColor" opacity="0.6">Site Center</text>
                      <text x="100" y="180" textAnchor="middle" fontSize="7" fill="currentColor" opacity="0.5">
                        Radius: {(project.geofenceRadius as number) || 200}m
                      </text>
                    </svg>
                  </div>
                </>
              ) : (
                <div className="text-xs text-muted-foreground" data-testid="text-no-site-coords">
                  No site coordinates configured
                </div>
              )}
              {canManage && (
                <div className="flex gap-2 flex-wrap">
                  <Button variant="outline" size="sm" onClick={() => setEditingCoords(true)} data-testid="button-edit-geofence-coords">
                    {project.siteLatitude ? "Edit Site Coordinates" : "Set Site Coordinates"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)} data-testid="button-pick-on-map">
                    <MapPin className="w-4 h-4 mr-1" />
                    Pick on map
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3 p-3 border rounded-lg bg-muted/30">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Latitude</Label>
                  <Input
                    type="number"
                    step="0.000001"
                    value={siteLat}
                    onChange={(e) => setSiteLat(e.target.value)}
                    placeholder="e.g., 40.7128"
                    className="h-8 text-sm"
                    data-testid="input-site-latitude"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Longitude</Label>
                  <Input
                    type="number"
                    step="0.000001"
                    value={siteLng}
                    onChange={(e) => setSiteLng(e.target.value)}
                    placeholder="e.g., -74.0060"
                    className="h-8 text-sm"
                    data-testid="input-site-longitude"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Geofence Radius (meters)</Label>
                <Input
                  type="number"
                  min="10"
                  max="10000"
                  value={radius}
                  onChange={(e) => setRadius(e.target.value)}
                  className="h-8 text-sm w-32"
                  data-testid="input-geofence-radius"
                />
                <p className="text-xs text-muted-foreground">
                  50m for tight sites, 200m typical, 2000m+ for highway/civil projects
                </p>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button
                  size="sm"
                  disabled={updateMutation.isPending}
                  onClick={() => {
                    const lat = parseFloat(siteLat);
                    const lng = parseFloat(siteLng);
                    const r = parseInt(radius, 10);
                    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
                      toast({ title: "Invalid coordinates", variant: "destructive" });
                      return;
                    }
                    if (isNaN(r) || r < 10 || r > 10000) {
                      toast({ title: "Radius must be between 10m and 10,000m", variant: "destructive" });
                      return;
                    }
                    updateMutation.mutate({ siteLatitude: lat, siteLongitude: lng, geofenceRadius: r });
                  }}
                  data-testid="button-save-geofence-coords"
                >
                  Save
                </Button>
                <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)} data-testid="button-pick-on-map-edit">
                  <MapPin className="w-4 h-4 mr-1" />
                  Pick on map
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditingCoords(false)} data-testid="button-cancel-geofence-coords">
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
        <MapPickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          initialLat={
            siteLat && !isNaN(parseFloat(siteLat))
              ? parseFloat(siteLat)
              : (project.siteLatitude as number | null | undefined) ?? null
          }
          initialLng={
            siteLng && !isNaN(parseFloat(siteLng))
              ? parseFloat(siteLng)
              : (project.siteLongitude as number | null | undefined) ?? null
          }
          isSaving={updateMutation.isPending}
          onConfirm={async (lat, lng) => {
            setSiteLat(String(lat));
            setSiteLng(String(lng));
            const r = parseInt(radius, 10);
            const safeRadius = isNaN(r) || r < 10 || r > 10000 ? 200 : r;
            await updateMutation.mutateAsync({
              siteLatitude: lat,
              siteLongitude: lng,
              geofenceRadius: safeRadius,
            });
            setPickerOpen(false);
          }}
        />
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

const PAYROLL_FORM_VARIANT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "WH_347", label: "Federal WH-347" },
  { value: "CALTRANS_CEM_2502", label: "Caltrans CEM-2502" },
  { value: "ODOT_CA_D_9C", label: "ODOT CA-D-9C" },
  { value: "TXDOT", label: "TxDOT" },
  { value: "FDOT", label: "FDOT" },
  { value: "GENERIC", label: "Generic Certified Payroll" },
];

function CertifiedPayrollFormCard({ project, projectCode }: { project: Record<string, unknown>; projectCode: string }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const canManage = ["ADMIN", "MANAGER", "ESTIMATOR"].includes(user?.role || "");
  const currentVariant = (project.payrollFormVariant as string) || "WH_347";

  const updateMutation = useMutation({
    mutationFn: async (variant: string) => {
      await apiRequest("PATCH", `/api/projects/${projectCode}`, { payrollFormVariant: variant });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode] });
      toast({ title: "Certified payroll form updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update form", description: err.message, variant: "destructive" });
    },
  });

  const currentLabel = PAYROLL_FORM_VARIANT_OPTIONS.find(o => o.value === currentVariant)?.label || currentVariant;

  return (
    <Card data-testid="card-certified-payroll-form">
      <CardHeader>
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          <CardTitle className="text-base">Certified Payroll Form</CardTitle>
        </div>
        <CardDescription>
          The default form used when generating certified payroll for this project. Choose the federal WH-347 or the appropriate state DOT variant.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {canManage ? (
          <div className="space-y-2 max-w-sm">
            <Label htmlFor="payroll-form-variant" className="text-sm font-medium">Form Variant</Label>
            <Select
              value={currentVariant}
              onValueChange={(v) => updateMutation.mutate(v)}
              disabled={updateMutation.isPending}
            >
              <SelectTrigger id="payroll-form-variant" data-testid="select-payroll-form-variant">
                <SelectValue placeholder="Select form" />
              </SelectTrigger>
              <SelectContent>
                {PAYROLL_FORM_VARIANT_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value} data-testid={`option-payroll-form-${opt.value}`}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div className="text-sm" data-testid="text-payroll-form-variant">{currentLabel}</div>
        )}
      </CardContent>
    </Card>
  );
}

function GeofenceZonesPanel({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const canManage = user && hasManagementAccess(user.role);

  const [newZoneName, setNewZoneName] = useState("");
  const [newZoneType, setNewZoneType] = useState<"circle" | "polygon">("circle");
  const [newZoneLat, setNewZoneLat] = useState("");
  const [newZoneLng, setNewZoneLng] = useState("");
  const [newZoneRadius, setNewZoneRadius] = useState("200");
  const [showAddForm, setShowAddForm] = useState(false);

  const { data: zones = [], isLoading } = useQuery<Array<{
    id: string;
    name: string;
    type: string;
    latitude: number | null;
    longitude: number | null;
    radius: number | null;
    polygon: string | null;
    isActive: boolean;
    createdAt: string;
  }>>({
    queryKey: ["/api/projects", projectId, "geofence-zones"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/geofence-zones`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch zones");
      return res.json();
    },
  });

  const addZoneMutation = useMutation({
    mutationFn: async (data: { name: string; type: string; latitude?: number; longitude?: number; radius?: number }) => {
      const res = await fetch(`/api/projects/${projectId}/geofence-zones`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to add zone");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "geofence-zones"] });
      toast({ title: "Geofence zone added" });
      setNewZoneName("");
      setNewZoneLat("");
      setNewZoneLng("");
      setNewZoneRadius("200");
      setShowAddForm(false);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to add zone", description: err.message, variant: "destructive" });
    },
  });

  const deleteZoneMutation = useMutation({
    mutationFn: async (zoneId: string) => {
      const res = await fetch(`/api/projects/${projectId}/geofence-zones/${zoneId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete zone");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "geofence-zones"] });
      toast({ title: "Geofence zone deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    },
  });

  const handleAddZone = () => {
    if (!newZoneName.trim()) {
      toast({ title: "Zone name is required", variant: "destructive" });
      return;
    }
    if (newZoneType === "circle") {
      const lat = parseFloat(newZoneLat);
      const lng = parseFloat(newZoneLng);
      const r = parseInt(newZoneRadius, 10);
      if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        toast({ title: "Invalid coordinates", variant: "destructive" });
        return;
      }
      if (isNaN(r) || r < 10 || r > 10000) {
        toast({ title: "Radius must be 10-10,000m", variant: "destructive" });
        return;
      }
      addZoneMutation.mutate({ name: newZoneName, type: "circle", latitude: lat, longitude: lng, radius: r });
    }
  };

  return (
    <Card data-testid="card-geofence-zones">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-primary" />
            <CardTitle className="text-base">Geofence Zones</CardTitle>
          </div>
          {canManage && !showAddForm && (
            <Button variant="outline" size="sm" onClick={() => setShowAddForm(true)} data-testid="button-add-geofence-zone">
              Add Zone
            </Button>
          )}
        </div>
        <CardDescription>Additional geofence boundaries for this project (e.g., staging areas, parking lots)</CardDescription>
      </CardHeader>
      <CardContent>
        {showAddForm && (
          <div className="space-y-3 p-3 border rounded-lg bg-muted/30 mb-4">
            <div className="space-y-1">
              <Label className="text-xs">Zone Name</Label>
              <Input
                value={newZoneName}
                onChange={(e) => setNewZoneName(e.target.value)}
                placeholder="e.g., Staging Area, Parking Lot"
                className="h-8 text-sm"
                data-testid="input-zone-name"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Latitude</Label>
                <Input
                  type="number"
                  step="0.000001"
                  value={newZoneLat}
                  onChange={(e) => setNewZoneLat(e.target.value)}
                  placeholder="40.7128"
                  className="h-8 text-sm"
                  data-testid="input-zone-latitude"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Longitude</Label>
                <Input
                  type="number"
                  step="0.000001"
                  value={newZoneLng}
                  onChange={(e) => setNewZoneLng(e.target.value)}
                  placeholder="-74.0060"
                  className="h-8 text-sm"
                  data-testid="input-zone-longitude"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Radius (m)</Label>
                <Input
                  type="number"
                  min="10"
                  max="10000"
                  value={newZoneRadius}
                  onChange={(e) => setNewZoneRadius(e.target.value)}
                  className="h-8 text-sm"
                  data-testid="input-zone-radius"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAddZone} disabled={addZoneMutation.isPending} data-testid="button-save-zone">
                {addZoneMutation.isPending ? "Adding..." : "Add Zone"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowAddForm(false)} data-testid="button-cancel-zone">
                Cancel
              </Button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-4 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            Loading zones...
          </div>
        ) : zones.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2" data-testid="text-no-zones">
            No additional geofence zones configured. The primary site coordinates are used as the default zone.
          </p>
        ) : (
          <div className="space-y-2">
            {zones.map((zone) => (
              <div key={zone.id} className="flex items-center justify-between p-3 border rounded-lg" data-testid={`zone-${zone.id}`}>
                <div>
                  <p className="text-sm font-medium">{zone.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {zone.type === "circle" && zone.latitude && zone.longitude
                      ? `${zone.latitude.toFixed(6)}, ${zone.longitude.toFixed(6)} · Radius: ${zone.radius}m`
                      : zone.type === "polygon"
                      ? "Polygon zone"
                      : "No coordinates"}
                  </p>
                </div>
                {canManage && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-500 hover:text-red-700 hover:bg-red-50"
                    onClick={() => deleteZoneMutation.mutate(zone.id)}
                    disabled={deleteZoneMutation.isPending}
                    data-testid={`button-delete-zone-${zone.id}`}
                  >
                    <XCircle className="w-4 h-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
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
      spoofingFlag: boolean | null;
      geofenceOverride: boolean | null;
    }>;
    summary: {
      totalShifts: number;
      clockInViolations: number;
      clockOutViolations: number;
      spoofingFlagged?: number;
      overrides?: number;
      complianceRate?: number;
    };
    repeatOffenders?: Array<{ userId: string; name: string; violations: number }>;
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
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-4">
              <div className="p-3 rounded-lg bg-muted/50 text-center">
                <p className="text-2xl font-bold" data-testid="text-total-shifts">{data.summary.totalShifts}</p>
                <p className="text-xs text-muted-foreground">Total Shifts</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/50 text-center">
                <p className="text-2xl font-bold text-green-600 dark:text-green-400" data-testid="text-compliance-rate">{data.summary.complianceRate ?? "—"}%</p>
                <p className="text-xs text-muted-foreground">Compliance</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/50 text-center">
                <p className="text-2xl font-bold text-red-600 dark:text-red-400" data-testid="text-clockin-violations">{data.summary.clockInViolations}</p>
                <p className="text-xs text-muted-foreground">Clock-In Issues</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/50 text-center">
                <p className="text-2xl font-bold text-red-600 dark:text-red-400" data-testid="text-clockout-violations">{data.summary.clockOutViolations}</p>
                <p className="text-xs text-muted-foreground">Clock-Out Issues</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/50 text-center">
                <p className="text-2xl font-bold text-amber-600 dark:text-amber-400" data-testid="text-spoofing-flagged">{data.summary.spoofingFlagged ?? 0}</p>
                <p className="text-xs text-muted-foreground">Spoofing Flags</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/50 text-center">
                <p className="text-2xl font-bold text-blue-600 dark:text-blue-400" data-testid="text-overrides">{data.summary.overrides ?? 0}</p>
                <p className="text-xs text-muted-foreground">Overrides</p>
              </div>
            </div>

            {data.repeatOffenders && data.repeatOffenders.length > 0 && (
              <div className="mb-4 p-3 border border-red-200 dark:border-red-900 rounded-lg bg-red-50 dark:bg-red-950/20">
                <p className="text-sm font-medium text-red-700 dark:text-red-400 mb-2">Repeat Offenders (2+ violations)</p>
                <div className="space-y-1">
                  {data.repeatOffenders.map((o) => (
                    <div key={o.userId} className="flex justify-between text-sm" data-testid={`repeat-offender-${o.userId}`}>
                      <span>{o.name}</span>
                      <Badge variant="destructive" className="text-xs">{o.violations} violations</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-2 font-medium">Employee</th>
                    <th className="text-left p-2 font-medium">Clock In</th>
                    <th className="text-left p-2 font-medium">In Status</th>
                    <th className="text-left p-2 font-medium">Clock Out</th>
                    <th className="text-left p-2 font-medium">Out Status</th>
                    <th className="text-left p-2 font-medium">Flags</th>
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
                        <td className="p-2">
                          <div className="flex gap-1">
                            {shift.spoofingFlag && (
                              <Badge variant="destructive" className="text-xs" data-testid={`badge-spoofing-${shift.id}`}>Spoof</Badge>
                            )}
                            {shift.geofenceOverride && (
                              <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 text-xs" data-testid={`badge-override-${shift.id}`}>Override</Badge>
                            )}
                          </div>
                        </td>
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
