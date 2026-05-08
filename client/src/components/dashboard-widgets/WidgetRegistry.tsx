import {
  BarChart3,
  MessageSquare,
  Bell,
  Calendar,
  ClipboardList,
  AlertCircle,
  Briefcase,
  FileText,
  Users,
  HardHat,
  CloudSun,
  Sparkles,
  TrendingUp,
  LineChart,
  List,
  AlertTriangle,
  Landmark,
  PieChart,
  CalendarDays,
  Zap,
  Activity,
  HeartPulse,
  HelpCircle,
  FileEdit,
  ShieldCheck,
  Award,
  Truck,
  ClipboardCheck,
  Flag,
  type LucideIcon,
} from "lucide-react";
import type { FeaturePermissionKey } from "@/hooks/use-dashboard-customization";
import { QuickStatsWidget } from "./QuickStatsWidget";
import { MessagesWidget } from "./MessagesWidget";
import { NotificationsWidget } from "./NotificationsWidget";
import { CalendarWidget } from "./CalendarWidget";
import { AITasksWidget } from "./AITasksWidget";
import { OutstandingItemsWidget } from "./OutstandingItemsWidget";
import { ActiveProjectsWidget } from "./ActiveProjectsWidget";
import { ActiveBidsWidget } from "./ActiveBidsWidget";
import { CrewOverviewWidget } from "./CrewOverviewWidget";
import { ProjectAssignmentsWidget } from "./ProjectAssignmentsWidget";
import { WeatherForecastWidget } from "@/components/WeatherForecastWidget";
import { AIInsightsWidget } from "@/components/AIInsightsWidget";
import { KPISummaryWidget, type KPIConfig } from "./KPISummaryWidget";
import { TrendChartWidget } from "./TrendChartWidget";
import { type TrendChartConfig } from "./TrendChartSettings";
import { ListWidget } from "./ListWidget";
import { type ListWidgetConfig } from "./ListWidgetSettings";
import { AlertsWidget } from "./AlertsWidget";
import { WorkforceSnapshotWidget } from "./WorkforceSnapshotWidget";
import { CashPositionWidget } from "./CashPositionWidget";
import { SOVProgressWidget } from "./SOVProgressWidget";
import { BidPipelineWidget } from "./BidPipelineWidget";
import { CostCodeBreakdownWidget } from "./CostCodeBreakdownWidget";
import { type CostCodeBreakdownConfig } from "./CostCodeBreakdownSettings";
import { type QuickStatsConfig } from "./QuickStatsSettings";
import { ScheduleImpactWidget } from "./ScheduleImpactWidget";
import { QuickActionsWidget } from "./QuickActionsWidget";
import { LaborUtilizationWidget } from "./LaborUtilizationWidget";
import { ProjectHealthSummaryWidget } from "./ProjectHealthSummaryWidget";
import { RFIStatusWidget } from "./RFIStatusWidget";
import { ChangeOrdersPendingWidget } from "./ChangeOrdersPendingWidget";
import { SafetyAlertsWidget } from "./SafetyAlertsWidget";
import {
  DBEParticipationWidget,
  OpenHaulTicketsWidget,
  IDRStreakWidget,
  BuyAmericaWidget,
  BondCertExpirationsWidget,
} from "./HeavyCivilWidgets";

export interface WidgetComponentProps {
  config?: Record<string, unknown>;
}

export type WidgetComponent = (props: WidgetComponentProps) => JSX.Element | null;

export type WidgetCategory = "Financial" | "Operational" | "Workforce" | "Communication" | "AI" | "General";

export interface WidgetDefinition {
  type: string;
  label: string;
  description: string;
  category: WidgetCategory;
  icon: LucideIcon;
  component: WidgetComponent;
  defaultW: number;
  defaultH: number;
  minW: number;
  minH: number;
  maxW: number;
  maxH: number;
  singleton: boolean;
  allowedRoles?: string[];
  featurePerm?: FeaturePermissionKey | FeaturePermissionKey[];
  hasSettings?: boolean;
  queryKeys?: string[];
}

export const MANAGEMENT_ROLES = ["SUPER_ADMIN", "ADMIN", "HUSTLER", "MANAGER"];
export const MANAGEMENT_AND_SUPER_ROLES = ["SUPER_ADMIN", "ADMIN", "HUSTLER", "MANAGER", "SUPERINTENDENT"];
export const ALL_INTERNAL_ROLES = ["SUPER_ADMIN", "ADMIN", "HUSTLER", "MANAGER", "SUPERINTENDENT", "ESTIMATOR", "FIELD_WORKER"];

export function getSizeLabel(defaultW: number): string {
  if (defaultW >= 12) return "Full width";
  if (defaultW >= 6) return "Half width";
  if (defaultW >= 4) return "Third width";
  return "Compact";
}

function WrappedWeatherWidget(_props: WidgetComponentProps) {
  return <WeatherForecastWidget />;
}

function WrappedAIInsightsWidget(_props: WidgetComponentProps) {
  return <AIInsightsWidget compact />;
}

function KPISummaryWidgetWrapper({ config }: WidgetComponentProps) {
  return <KPISummaryWidget config={config as KPIConfig} />;
}

function TrendChartWidgetWrapper({ config }: WidgetComponentProps) {
  return <TrendChartWidget config={config as TrendChartConfig} />;
}

function ListWidgetWrapper({ config }: WidgetComponentProps) {
  return <ListWidget config={config as ListWidgetConfig} />;
}

function CostCodeBreakdownWidgetWrapper({ config }: WidgetComponentProps) {
  return <CostCodeBreakdownWidget config={config as CostCodeBreakdownConfig} />;
}

function QuickStatsWidgetWrapper({ config }: WidgetComponentProps) {
  return <QuickStatsWidget config={config as QuickStatsConfig} />;
}

export const WIDGET_REGISTRY: WidgetDefinition[] = [
  {
    type: "QUICK_STATS",
    label: "Quick Stats",
    description: "Key metrics at a glance - projects, bids, messages, events",
    category: "General",
    icon: BarChart3,
    component: QuickStatsWidgetWrapper,
    defaultW: 12,
    defaultH: 3,
    minW: 2,
    minH: 2,
    maxW: 12,
    maxH: 4,
    singleton: true,
    hasSettings: true,
    queryKeys: ["/api/conversations", "/api/calendar/my-events"],
  },
  {
    type: "KPI_SUMMARY",
    label: "KPI Summary Card",
    description: "Configurable KPI metric with trend comparison - labor cost, revenue, margin, and more",
    category: "Financial",
    icon: TrendingUp,
    component: KPISummaryWidgetWrapper,
    defaultW: 6,
    defaultH: 4,
    minW: 2,
    minH: 3,
    maxW: 12,
    maxH: 6,
    singleton: false,
    allowedRoles: MANAGEMENT_AND_SUPER_ROLES,
    featurePerm: "canViewFinancials",
    hasSettings: true,
    queryKeys: ["/api/dashboard/kpi"],
  },
  {
    type: "TREND_CHART",
    label: "Trend Chart",
    description: "Line or bar chart showing metrics over time — labor cost, revenue, bid win rate, overtime, cash flow",
    category: "Financial",
    icon: LineChart,
    component: TrendChartWidgetWrapper,
    defaultW: 12,
    defaultH: 6,
    minW: 4,
    minH: 4,
    maxW: 12,
    maxH: 10,
    singleton: false,
    allowedRoles: MANAGEMENT_AND_SUPER_ROLES,
    featurePerm: "canViewFinancials",
    hasSettings: true,
    queryKeys: ["/api/dashboard/trend"],
  },
  {
    type: "DATA_LIST",
    label: "Data List",
    description: "Filtered, sorted list of projects, organizations, time entries, pay runs, subcontracts, or change orders",
    category: "General",
    icon: List,
    component: ListWidgetWrapper,
    defaultW: 6,
    defaultH: 6,
    minW: 4,
    minH: 4,
    maxW: 12,
    maxH: 12,
    singleton: false,
    allowedRoles: MANAGEMENT_AND_SUPER_ROLES,
    hasSettings: true,
    queryKeys: ["/api/dashboard/list"],
  },
  {
    type: "ALERTS",
    label: "Alerts",
    description: "Dynamic alerts for insurance expiry, budget overruns, unapproved time, late payments, and low margins",
    category: "Operational",
    icon: AlertTriangle,
    component: AlertsWidget,
    defaultW: 6,
    defaultH: 6,
    minW: 4,
    minH: 4,
    maxW: 12,
    maxH: 12,
    singleton: false,
    allowedRoles: MANAGEMENT_AND_SUPER_ROLES,
    hasSettings: false,
    queryKeys: ["/api/dashboard/alerts"],
  },
  {
    type: "WORKFORCE_SNAPSHOT",
    label: "Workforce Snapshot",
    description: "Today's workforce metrics — active workers, overtime %, labor cost, and absent workers",
    category: "Workforce",
    icon: HardHat,
    component: WorkforceSnapshotWidget,
    defaultW: 6,
    defaultH: 4,
    minW: 4,
    minH: 3,
    maxW: 12,
    maxH: 6,
    singleton: false,
    allowedRoles: MANAGEMENT_AND_SUPER_ROLES,
    featurePerm: "canManagePayroll",
    hasSettings: false,
    queryKeys: ["/api/dashboard/workforce-snapshot"],
  },
  {
    type: "CASH_POSITION",
    label: "Cash Position",
    description: "Financial snapshot — accounts receivable, payable, payroll liability, and net cash flow",
    category: "Financial",
    icon: Landmark,
    component: CashPositionWidget,
    defaultW: 6,
    defaultH: 4,
    minW: 4,
    minH: 3,
    maxW: 12,
    maxH: 6,
    singleton: false,
    allowedRoles: MANAGEMENT_ROLES,
    featurePerm: "canViewFinancials",
    hasSettings: false,
    queryKeys: ["/api/dashboard/cash-position"],
  },
  {
    type: "SOV_PROGRESS",
    label: "SOV Progress",
    description: "Schedule of Values progress — % billed vs % complete, labor cost vs SOV, and retainage held",
    category: "Financial",
    icon: ClipboardList,
    component: SOVProgressWidget,
    defaultW: 6,
    defaultH: 5,
    minW: 4,
    minH: 4,
    maxW: 12,
    maxH: 8,
    singleton: false,
    allowedRoles: MANAGEMENT_ROLES,
    featurePerm: "canViewFinancials",
    hasSettings: false,
    queryKeys: ["/api/dashboard/sov-progress"],
  },
  {
    type: "BID_PIPELINE",
    label: "Bid Pipeline",
    description: "Active bids, pipeline value, win rate, and estimated labor exposure",
    category: "Operational",
    icon: Briefcase,
    component: BidPipelineWidget,
    defaultW: 6,
    defaultH: 4,
    minW: 4,
    minH: 3,
    maxW: 12,
    maxH: 6,
    singleton: false,
    allowedRoles: [...MANAGEMENT_ROLES, "ESTIMATOR"],
    featurePerm: "canViewFinancials",
    hasSettings: false,
    queryKeys: ["/api/dashboard/bid-pipeline"],
  },
  {
    type: "COST_CODE_BREAKDOWN",
    label: "Cost Code Breakdown",
    description: "Labor by cost code (pie chart) or budget vs actual comparison (bar chart)",
    category: "Financial",
    icon: PieChart,
    component: CostCodeBreakdownWidgetWrapper,
    defaultW: 6,
    defaultH: 5,
    minW: 4,
    minH: 4,
    maxW: 12,
    maxH: 8,
    singleton: false,
    allowedRoles: MANAGEMENT_AND_SUPER_ROLES,
    featurePerm: "canViewFinancials",
    hasSettings: true,
    queryKeys: ["/api/dashboard/cost-code-breakdown"],
  },
  {
    type: "SCHEDULE_IMPACT",
    label: "Schedule Impact",
    description: "Labor allocation next 7 days, project manpower forecast, and overbooking conflicts",
    category: "Operational",
    icon: CalendarDays,
    component: ScheduleImpactWidget,
    defaultW: 6,
    defaultH: 6,
    minW: 4,
    minH: 4,
    maxW: 12,
    maxH: 8,
    singleton: false,
    allowedRoles: MANAGEMENT_AND_SUPER_ROLES,
    hasSettings: false,
    queryKeys: ["/api/dashboard/schedule-impact"],
  },
  {
    type: "WEATHER",
    label: "Weather Forecast",
    description: "Current weather and 7-day forecast for your location",
    category: "General",
    icon: CloudSun,
    component: WrappedWeatherWidget,
    defaultW: 12,
    defaultH: 4,
    minW: 2,
    minH: 3,
    maxW: 12,
    maxH: 6,
    singleton: true,
  },
  {
    type: "AI_INSIGHTS",
    label: "AI Insights",
    description: "AI-generated insights for scheduling, costs, and project health",
    category: "AI",
    icon: Sparkles,
    component: WrappedAIInsightsWidget,
    defaultW: 12,
    defaultH: 5,
    minW: 2,
    minH: 3,
    maxW: 12,
    maxH: 8,
    singleton: true,
    allowedRoles: MANAGEMENT_AND_SUPER_ROLES,
    featurePerm: "canUseAiFeatures",
    queryKeys: ["/api/ai-insights"],
  },
  {
    type: "MESSAGES",
    label: "Messages",
    description: "Recent conversations and unread message count",
    category: "Communication",
    icon: MessageSquare,
    component: MessagesWidget,
    defaultW: 4,
    defaultH: 6,
    minW: 2,
    minH: 4,
    maxW: 8,
    maxH: 10,
    singleton: false,
    queryKeys: ["/api/conversations"],
    hasSettings: true,
  },
  {
    type: "NOTIFICATIONS",
    label: "Notifications",
    description: "Unread notifications and alerts",
    category: "Communication",
    icon: Bell,
    component: NotificationsWidget,
    defaultW: 4,
    defaultH: 6,
    minW: 2,
    minH: 4,
    maxW: 8,
    maxH: 10,
    singleton: false,
    queryKeys: ["/api/notifications"],
    hasSettings: true,
  },
  {
    type: "CALENDAR_EVENTS",
    label: "Calendar Events",
    description: "Upcoming events and schedule",
    category: "General",
    icon: Calendar,
    component: CalendarWidget,
    defaultW: 4,
    defaultH: 6,
    minW: 2,
    minH: 4,
    maxW: 8,
    maxH: 10,
    singleton: false,
    queryKeys: ["/api/calendar/my-events"],
  },
  {
    type: "AI_TASKS",
    label: "AI Tasks",
    description: "Pending AI-generated tasks and action items",
    category: "AI",
    icon: ClipboardList,
    component: AITasksWidget,
    defaultW: 4,
    defaultH: 5,
    minW: 2,
    minH: 3,
    maxW: 8,
    maxH: 8,
    singleton: true,
    featurePerm: "canUseAiFeatures",
    queryKeys: ["/api/ai/tasks"],
  },
  {
    type: "OUTSTANDING_ITEMS",
    label: "Outstanding Items",
    description: "Pending change orders, time-off requests, and delays",
    category: "Operational",
    icon: AlertCircle,
    component: OutstandingItemsWidget,
    defaultW: 4,
    defaultH: 6,
    minW: 2,
    minH: 4,
    maxW: 8,
    maxH: 10,
    singleton: true,
    hasSettings: true,
    allowedRoles: MANAGEMENT_ROLES,
    featurePerm: "canViewFinancials",
    queryKeys: ["/api/dashboard/stats", "/api/projects"],
  },
  {
    type: "ACTIVE_PROJECTS",
    label: "Active Projects",
    description: "List of currently active projects",
    category: "Operational",
    icon: Briefcase,
    component: ActiveProjectsWidget,
    defaultW: 4,
    defaultH: 6,
    minW: 2,
    minH: 4,
    maxW: 8,
    maxH: 10,
    singleton: false,
    allowedRoles: ALL_INTERNAL_ROLES,
    hasSettings: true,
    queryKeys: ["/api/projects"],
  },
  {
    type: "ACTIVE_BIDS",
    label: "Active Bids",
    description: "Current bid pipeline and due dates",
    category: "Operational",
    icon: FileText,
    component: ActiveBidsWidget,
    defaultW: 4,
    defaultH: 6,
    minW: 2,
    minH: 4,
    maxW: 8,
    maxH: 10,
    singleton: false,
    hasSettings: true,
    allowedRoles: [...MANAGEMENT_ROLES, "ESTIMATOR"],
    queryKeys: ["/api/bids"],
  },
  {
    type: "CREW_OVERVIEW",
    label: "Crew Overview",
    description: "Crew assignments and scheduling summary",
    category: "Workforce",
    icon: Users,
    component: CrewOverviewWidget,
    defaultW: 4,
    defaultH: 5,
    minW: 2,
    minH: 3,
    maxW: 6,
    maxH: 8,
    singleton: true,
    allowedRoles: [...MANAGEMENT_ROLES, "SUPERINTENDENT"],
    queryKeys: ["/api/crew-assignments", "/api/crews"],
  },
  {
    type: "PROJECT_ASSIGNMENTS",
    label: "Project Assignments",
    description: "New project assignment notifications",
    category: "Operational",
    icon: HardHat,
    component: ProjectAssignmentsWidget,
    defaultW: 12,
    defaultH: 4,
    minW: 2,
    minH: 3,
    maxW: 12,
    maxH: 6,
    singleton: true,
    queryKeys: ["/api/notifications"],
  },
  {
    type: "QUICK_ACTIONS",
    label: "Quick Actions",
    description: "Role-specific shortcut buttons for common tasks",
    category: "General",
    icon: Zap,
    component: QuickActionsWidget,
    defaultW: 12,
    defaultH: 3,
    minW: 4,
    minH: 2,
    maxW: 12,
    maxH: 4,
    singleton: true,
  },
  {
    type: "LABOR_UTILIZATION",
    label: "Labor Utilization",
    description: "Today's workforce utilization %, billable hours ratio, active workers, and 7-day sparkline",
    category: "Workforce",
    icon: Activity,
    component: LaborUtilizationWidget,
    defaultW: 6,
    defaultH: 5,
    minW: 4,
    minH: 4,
    maxW: 12,
    maxH: 7,
    singleton: false,
    allowedRoles: MANAGEMENT_AND_SUPER_ROLES,
    featurePerm: "canManagePayroll",
    hasSettings: true,
    queryKeys: ["/api/dashboard/labor-utilization"],
  },
  {
    type: "PROJECT_HEALTH_SUMMARY",
    label: "Project Health Summary",
    description: "Health score distribution (healthy / at-risk / critical) across all active projects",
    category: "Operational",
    icon: HeartPulse,
    component: ProjectHealthSummaryWidget,
    defaultW: 6,
    defaultH: 6,
    minW: 4,
    minH: 5,
    maxW: 12,
    maxH: 10,
    singleton: false,
    allowedRoles: MANAGEMENT_AND_SUPER_ROLES,
    hasSettings: true,
    queryKeys: ["/api/project-health/overview"],
  },
  {
    type: "RFI_STATUS",
    label: "RFI Status",
    description: "Open RFIs awaiting response — count, oldest first, with age indicator",
    category: "Operational",
    icon: HelpCircle,
    component: RFIStatusWidget,
    defaultW: 6,
    defaultH: 6,
    minW: 4,
    minH: 5,
    maxW: 12,
    maxH: 10,
    singleton: false,
    allowedRoles: MANAGEMENT_AND_SUPER_ROLES,
    hasSettings: true,
    queryKeys: ["/api/rfi"],
  },
  {
    type: "CHANGE_ORDERS_PENDING",
    label: "Change Orders Pending",
    description: "Change orders awaiting approval — count, total value, and days pending",
    category: "Financial",
    icon: FileEdit,
    component: ChangeOrdersPendingWidget,
    defaultW: 6,
    defaultH: 5,
    minW: 4,
    minH: 4,
    maxW: 12,
    maxH: 8,
    singleton: false,
    allowedRoles: MANAGEMENT_AND_SUPER_ROLES,
    featurePerm: "canViewFinancials",
    hasSettings: true,
    queryKeys: ["/api/dashboard/change-orders-pending"],
  },
  {
    type: "SAFETY_ALERTS",
    label: "Safety Alerts",
    description: "Safety training completion rate, overdue assignments, and upcoming due dates",
    category: "Workforce",
    icon: ShieldCheck,
    component: SafetyAlertsWidget,
    defaultW: 6,
    defaultH: 6,
    minW: 4,
    minH: 5,
    maxW: 12,
    maxH: 10,
    singleton: false,
    allowedRoles: MANAGEMENT_AND_SUPER_ROLES,
    featurePerm: "canManageSafety",
    hasSettings: true,
    queryKeys: ["/api/dashboard/safety-summary", "/api/toolbox-talks/summary", "/api/safety-checklists/summary", "/api/osha-incidents/summary"],
  },
  {
    type: "DBE_PARTICIPATION",
    label: "DBE Participation",
    description: "Disadvantaged Business Enterprise goals and participation across heavy-civil projects",
    category: "Operational",
    icon: Award,
    component: DBEParticipationWidget,
    defaultW: 6,
    defaultH: 6,
    minW: 4,
    minH: 4,
    maxW: 12,
    maxH: 10,
    singleton: false,
    allowedRoles: MANAGEMENT_AND_SUPER_ROLES,
    featurePerm: "canViewDbeGoals",
    hasSettings: false,
    queryKeys: ["/api/dashboard/heavy-civil/dbe-progress"],
  },
  {
    type: "OPEN_HAUL_TICKETS",
    label: "Open Haul Tickets",
    description: "Pending haul tickets, totals, and oldest pending alert for heavy-civil dispatch",
    category: "Operational",
    icon: Truck,
    component: OpenHaulTicketsWidget,
    defaultW: 6,
    defaultH: 6,
    minW: 4,
    minH: 4,
    maxW: 12,
    maxH: 10,
    singleton: false,
    allowedRoles: MANAGEMENT_AND_SUPER_ROLES,
    featurePerm: "canViewHaulTickets",
    hasSettings: false,
    queryKeys: ["/api/dashboard/heavy-civil/open-haul-tickets"],
  },
  {
    type: "IDR_STREAK",
    label: "IDR Submission Streak",
    description: "Daily Inspector Report submission streak and 30-day compliance rate",
    category: "Operational",
    icon: ClipboardCheck,
    component: IDRStreakWidget,
    defaultW: 6,
    defaultH: 6,
    minW: 4,
    minH: 4,
    maxW: 12,
    maxH: 10,
    singleton: false,
    allowedRoles: MANAGEMENT_AND_SUPER_ROLES,
    // Any inspector-report permission qualifies for adding the widget;
    // server-side gating still enforces the actual API access.
    featurePerm: ["canViewInspectorReports", "canManageInspectorReports", "canApproveInspectorReports"],
    hasSettings: false,
    queryKeys: ["/api/dashboard/heavy-civil/idr-streak"],
  },
  {
    type: "BUY_AMERICA",
    label: "Buy America Status",
    description: "Material certification compliance with Buy America requirements",
    category: "Operational",
    icon: Flag,
    component: BuyAmericaWidget,
    defaultW: 6,
    defaultH: 6,
    minW: 4,
    minH: 4,
    maxW: 12,
    maxH: 10,
    singleton: false,
    allowedRoles: MANAGEMENT_AND_SUPER_ROLES,
    featurePerm: "canViewMaterialCertifications",
    hasSettings: false,
    queryKeys: ["/api/dashboard/heavy-civil/buy-america"],
  },
  {
    type: "BOND_CERT_EXPIRATIONS",
    label: "Bond & Cert Expirations",
    description: "Surety bonds and DBE/MBE certifications expiring in the next 90 days",
    category: "Operational",
    icon: CalendarDays,
    component: BondCertExpirationsWidget,
    defaultW: 6,
    defaultH: 6,
    minW: 4,
    minH: 4,
    maxW: 12,
    maxH: 10,
    singleton: false,
    allowedRoles: MANAGEMENT_AND_SUPER_ROLES,
    // Either bond or DBE permission qualifies — the widget surfaces both
    // datasets, and the API filters per-dataset based on the user's actual
    // permissions and feature flags.
    featurePerm: ["canViewSuretyBonds", "canViewDbeGoals"],
    hasSettings: false,
    queryKeys: ["/api/dashboard/heavy-civil/expirations"],
  },
];

export function getWidgetDefinition(type: string): WidgetDefinition | undefined {
  return WIDGET_REGISTRY.find((w) => w.type === type);
}

export function getWidgetComponent(type: string): WidgetComponent | undefined {
  return getWidgetDefinition(type)?.component;
}
