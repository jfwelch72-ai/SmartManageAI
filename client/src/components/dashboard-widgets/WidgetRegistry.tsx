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

export interface WidgetComponentProps {
  config?: Record<string, unknown>;
}

export type WidgetComponent = (props: WidgetComponentProps) => JSX.Element;

export interface WidgetDefinition {
  type: string;
  label: string;
  description: string;
  icon: LucideIcon;
  component: WidgetComponent;
  defaultW: number;
  defaultH: number;
  minW: number;
  minH: number;
  maxW: number;
  maxH: number;
  singleton: boolean;
  roleGate?: string;
  featurePerm?: FeaturePermissionKey;
  hasSettings?: boolean;
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
  },
  {
    type: "KPI_SUMMARY",
    label: "KPI Summary Card",
    description: "Configurable KPI metric with trend comparison - labor cost, revenue, margin, and more",
    icon: TrendingUp,
    component: KPISummaryWidgetWrapper,
    defaultW: 6,
    defaultH: 4,
    minW: 2,
    minH: 3,
    maxW: 12,
    maxH: 6,
    singleton: false,
    hasSettings: true,
  },
  {
    type: "TREND_CHART",
    label: "Trend Chart",
    description: "Line or bar chart showing metrics over time — labor cost, revenue, bid win rate, overtime, cash flow",
    icon: LineChart,
    component: TrendChartWidgetWrapper,
    defaultW: 12,
    defaultH: 6,
    minW: 4,
    minH: 4,
    maxW: 12,
    maxH: 10,
    singleton: false,
    hasSettings: true,
  },
  {
    type: "DATA_LIST",
    label: "Data List",
    description: "Filtered, sorted list of projects, organizations, time entries, pay runs, subcontracts, or change orders",
    icon: List,
    component: ListWidgetWrapper,
    defaultW: 6,
    defaultH: 6,
    minW: 4,
    minH: 4,
    maxW: 12,
    maxH: 12,
    singleton: false,
    hasSettings: true,
  },
  {
    type: "ALERTS",
    label: "Alerts",
    description: "Dynamic alerts for insurance expiry, budget overruns, unapproved time, late payments, and low margins",
    icon: AlertTriangle,
    component: AlertsWidget,
    defaultW: 6,
    defaultH: 6,
    minW: 4,
    minH: 4,
    maxW: 12,
    maxH: 12,
    singleton: false,
    hasSettings: false,
  },
  {
    type: "WORKFORCE_SNAPSHOT",
    label: "Workforce Snapshot",
    description: "Today's workforce metrics — active workers, overtime %, labor cost, and absent workers",
    icon: HardHat,
    component: WorkforceSnapshotWidget,
    defaultW: 6,
    defaultH: 4,
    minW: 4,
    minH: 3,
    maxW: 12,
    maxH: 6,
    singleton: false,
    featurePerm: "canManagePayroll",
    hasSettings: false,
  },
  {
    type: "CASH_POSITION",
    label: "Cash Position",
    description: "Financial snapshot — accounts receivable, payable, payroll liability, and net cash flow",
    icon: Landmark,
    component: CashPositionWidget,
    defaultW: 6,
    defaultH: 4,
    minW: 4,
    minH: 3,
    maxW: 12,
    maxH: 6,
    singleton: false,
    featurePerm: "canAccessFinancials",
    hasSettings: false,
  },
  {
    type: "SOV_PROGRESS",
    label: "SOV Progress",
    description: "Schedule of Values progress — % billed vs % complete, labor cost vs SOV, and retainage held",
    icon: ClipboardList,
    component: SOVProgressWidget,
    defaultW: 6,
    defaultH: 5,
    minW: 4,
    minH: 4,
    maxW: 12,
    maxH: 8,
    singleton: false,
    featurePerm: "canAccessFinancials",
    hasSettings: false,
  },
  {
    type: "BID_PIPELINE",
    label: "Bid Pipeline",
    description: "Active bids, pipeline value, win rate, and estimated labor exposure",
    icon: Briefcase,
    component: BidPipelineWidget,
    defaultW: 6,
    defaultH: 4,
    minW: 4,
    minH: 3,
    maxW: 12,
    maxH: 6,
    singleton: false,
    hasSettings: false,
  },
  {
    type: "COST_CODE_BREAKDOWN",
    label: "Cost Code Breakdown",
    description: "Labor by cost code (pie chart) or budget vs actual comparison (bar chart)",
    icon: PieChart,
    component: CostCodeBreakdownWidgetWrapper,
    defaultW: 6,
    defaultH: 5,
    minW: 4,
    minH: 4,
    maxW: 12,
    maxH: 8,
    singleton: false,
    featurePerm: "canAccessFinancials",
    hasSettings: true,
  },
  {
    type: "SCHEDULE_IMPACT",
    label: "Schedule Impact",
    description: "Labor allocation next 7 days, project manpower forecast, and overbooking conflicts",
    icon: CalendarDays,
    component: ScheduleImpactWidget,
    defaultW: 6,
    defaultH: 6,
    minW: 4,
    minH: 4,
    maxW: 12,
    maxH: 8,
    singleton: false,
    hasSettings: false,
  },
  {
    type: "WEATHER",
    label: "Weather Forecast",
    description: "Current weather and 7-day forecast for your location",
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
    icon: Sparkles,
    component: WrappedAIInsightsWidget,
    defaultW: 12,
    defaultH: 5,
    minW: 2,
    minH: 3,
    maxW: 12,
    maxH: 8,
    singleton: true,
    roleGate: "management",
    featurePerm: "canUseAiFeatures",
  },
  {
    type: "MESSAGES",
    label: "Messages",
    description: "Recent conversations and unread message count",
    icon: MessageSquare,
    component: MessagesWidget,
    defaultW: 4,
    defaultH: 6,
    minW: 2,
    minH: 4,
    maxW: 8,
    maxH: 10,
    singleton: true,
  },
  {
    type: "NOTIFICATIONS",
    label: "Notifications",
    description: "Unread notifications and alerts",
    icon: Bell,
    component: NotificationsWidget,
    defaultW: 4,
    defaultH: 6,
    minW: 2,
    minH: 4,
    maxW: 8,
    maxH: 10,
    singleton: true,
  },
  {
    type: "CALENDAR_EVENTS",
    label: "Calendar Events",
    description: "Upcoming events and schedule",
    icon: Calendar,
    component: CalendarWidget,
    defaultW: 4,
    defaultH: 6,
    minW: 2,
    minH: 4,
    maxW: 8,
    maxH: 10,
    singleton: true,
  },
  {
    type: "AI_TASKS",
    label: "AI Tasks",
    description: "Pending AI-generated tasks and action items",
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
  },
  {
    type: "OUTSTANDING_ITEMS",
    label: "Outstanding Items",
    description: "Pending change orders, time-off requests, and delays",
    icon: AlertCircle,
    component: OutstandingItemsWidget,
    defaultW: 4,
    defaultH: 6,
    minW: 2,
    minH: 4,
    maxW: 8,
    maxH: 10,
    singleton: true,
    roleGate: "management",
    featurePerm: "canAccessFinancials",
  },
  {
    type: "ACTIVE_PROJECTS",
    label: "Active Projects",
    description: "List of currently active projects",
    icon: Briefcase,
    component: ActiveProjectsWidget,
    defaultW: 4,
    defaultH: 6,
    minW: 2,
    minH: 4,
    maxW: 8,
    maxH: 10,
    singleton: true,
  },
  {
    type: "ACTIVE_BIDS",
    label: "Active Bids",
    description: "Current bid pipeline and due dates",
    icon: FileText,
    component: ActiveBidsWidget,
    defaultW: 4,
    defaultH: 6,
    minW: 2,
    minH: 4,
    maxW: 8,
    maxH: 10,
    singleton: true,
    roleGate: "management",
  },
  {
    type: "CREW_OVERVIEW",
    label: "Crew Overview",
    description: "Crew assignments and scheduling summary",
    icon: Users,
    component: CrewOverviewWidget,
    defaultW: 4,
    defaultH: 5,
    minW: 2,
    minH: 3,
    maxW: 6,
    maxH: 8,
    singleton: true,
    roleGate: "superintendent",
  },
  {
    type: "PROJECT_ASSIGNMENTS",
    label: "Project Assignments",
    description: "New project assignment notifications",
    icon: HardHat,
    component: ProjectAssignmentsWidget,
    defaultW: 12,
    defaultH: 4,
    minW: 2,
    minH: 3,
    maxW: 12,
    maxH: 6,
    singleton: true,
  },
  {
    type: "QUICK_ACTIONS",
    label: "Quick Actions",
    description: "Role-specific shortcut buttons for common tasks",
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
    icon: Activity,
    component: LaborUtilizationWidget,
    defaultW: 6,
    defaultH: 5,
    minW: 4,
    minH: 4,
    maxW: 12,
    maxH: 7,
    singleton: false,
    featurePerm: "canManagePayroll",
    hasSettings: false,
  },
  {
    type: "PROJECT_HEALTH_SUMMARY",
    label: "Project Health Summary",
    description: "Health score distribution (healthy / at-risk / critical) across all active projects",
    icon: HeartPulse,
    component: ProjectHealthSummaryWidget,
    defaultW: 6,
    defaultH: 6,
    minW: 4,
    minH: 5,
    maxW: 12,
    maxH: 10,
    singleton: false,
    roleGate: "management",
    hasSettings: false,
  },
  {
    type: "RFI_STATUS",
    label: "RFI Status",
    description: "Open RFIs awaiting response — count, oldest first, with age indicator",
    icon: HelpCircle,
    component: RFIStatusWidget,
    defaultW: 6,
    defaultH: 6,
    minW: 4,
    minH: 5,
    maxW: 12,
    maxH: 10,
    singleton: false,
    roleGate: "management",
    hasSettings: false,
  },
  {
    type: "CHANGE_ORDERS_PENDING",
    label: "Change Orders Pending",
    description: "Change orders awaiting approval — count, total value, and days pending",
    icon: FileEdit,
    component: ChangeOrdersPendingWidget,
    defaultW: 6,
    defaultH: 5,
    minW: 4,
    minH: 4,
    maxW: 12,
    maxH: 8,
    singleton: false,
    featurePerm: "canAccessFinancials",
    hasSettings: false,
  },
  {
    type: "SAFETY_ALERTS",
    label: "Safety Alerts",
    description: "Safety training completion rate, overdue assignments, and upcoming due dates",
    icon: ShieldCheck,
    component: SafetyAlertsWidget,
    defaultW: 6,
    defaultH: 6,
    minW: 4,
    minH: 5,
    maxW: 12,
    maxH: 10,
    singleton: false,
    roleGate: "management",
    hasSettings: false,
  },
];

export function getWidgetDefinition(type: string): WidgetDefinition | undefined {
  return WIDGET_REGISTRY.find((w) => w.type === type);
}

export function getWidgetComponent(type: string): WidgetComponent | undefined {
  return getWidgetDefinition(type)?.component;
}
