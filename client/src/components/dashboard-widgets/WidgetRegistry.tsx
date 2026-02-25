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
  type LucideIcon,
} from "lucide-react";
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

export interface WidgetDefinition {
  type: string;
  label: string;
  description: string;
  icon: LucideIcon;
  component: () => JSX.Element;
  defaultW: number;
  defaultH: number;
  minW: number;
  minH: number;
  maxW: number;
  maxH: number;
  singleton: boolean;
  roleGate?: string;
}

function WrappedWeatherWidget() {
  return <WeatherForecastWidget />;
}

function WrappedAIInsightsWidget() {
  return <AIInsightsWidget compact />;
}

export const WIDGET_REGISTRY: WidgetDefinition[] = [
  {
    type: "QUICK_STATS",
    label: "Quick Stats",
    description: "Key metrics at a glance - projects, bids, messages, events",
    icon: BarChart3,
    component: QuickStatsWidget,
    defaultW: 12,
    defaultH: 3,
    minW: 6,
    minH: 2,
    maxW: 12,
    maxH: 4,
    singleton: true,
  },
  {
    type: "WEATHER",
    label: "Weather Forecast",
    description: "Current weather and 7-day forecast for your location",
    icon: CloudSun,
    component: WrappedWeatherWidget,
    defaultW: 12,
    defaultH: 4,
    minW: 6,
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
    minW: 6,
    minH: 3,
    maxW: 12,
    maxH: 8,
    singleton: true,
    roleGate: "management",
  },
  {
    type: "MESSAGES",
    label: "Messages",
    description: "Recent conversations and unread message count",
    icon: MessageSquare,
    component: MessagesWidget,
    defaultW: 4,
    defaultH: 6,
    minW: 3,
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
    minW: 3,
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
    minW: 3,
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
    minW: 3,
    minH: 3,
    maxW: 8,
    maxH: 8,
    singleton: true,
  },
  {
    type: "OUTSTANDING_ITEMS",
    label: "Outstanding Items",
    description: "Pending change orders, time-off requests, and delays",
    icon: AlertCircle,
    component: OutstandingItemsWidget,
    defaultW: 4,
    defaultH: 6,
    minW: 3,
    minH: 4,
    maxW: 8,
    maxH: 10,
    singleton: true,
    roleGate: "management",
  },
  {
    type: "ACTIVE_PROJECTS",
    label: "Active Projects",
    description: "List of currently active projects",
    icon: Briefcase,
    component: ActiveProjectsWidget,
    defaultW: 4,
    defaultH: 6,
    minW: 3,
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
    minW: 3,
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
    minW: 3,
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
    minW: 6,
    minH: 3,
    maxW: 12,
    maxH: 6,
    singleton: true,
  },
];

export function getWidgetDefinition(type: string): WidgetDefinition | undefined {
  return WIDGET_REGISTRY.find((w) => w.type === type);
}

export function getWidgetComponent(type: string): (() => JSX.Element) | undefined {
  return getWidgetDefinition(type)?.component;
}
