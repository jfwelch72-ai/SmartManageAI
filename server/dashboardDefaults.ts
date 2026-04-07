import type { DashboardLayoutConfig } from "@shared/schema";

export const KNOWN_WIDGET_TYPES = [
  'QUICK_STATS', 'KPI_SUMMARY', 'TREND_CHART', 'DATA_LIST', 'ALERTS', 'WORKFORCE_SNAPSHOT', 'CASH_POSITION', 'SOV_PROGRESS', 'BID_PIPELINE', 'COST_CODE_BREAKDOWN', 'SCHEDULE_IMPACT', 'WEATHER', 'AI_INSIGHTS', 'MESSAGES', 'NOTIFICATIONS',
  'CALENDAR_EVENTS', 'AI_TASKS', 'OUTSTANDING_ITEMS', 'ACTIVE_PROJECTS',
  'ACTIVE_BIDS', 'CREW_OVERVIEW', 'PROJECT_ASSIGNMENTS', 'QUICK_ACTIONS',
  'LABOR_UTILIZATION', 'PROJECT_HEALTH_SUMMARY', 'RFI_STATUS', 'CHANGE_ORDERS_PENDING', 'SAFETY_ALERTS',
];

export function migrateV2ToV3(config: any): DashboardLayoutConfig {
  return {
    sections: [{
      id: 'section-migrated',
      title: 'Dashboard',
      columns: 1,
      collapsed: false,
      widgets: config.widgets || [],
    }],
    gridCols: config.gridCols || 12,
    version: 3,
  };
}

const ADMIN_LAYOUT: DashboardLayoutConfig = {
  sections: [
    {
      id: 'section-overview',
      title: 'Overview',
      columns: 1,
      collapsed: false,
      widgets: [
        { id: 'admin-quick-stats', type: 'QUICK_STATS', x: 0, y: 0, w: 12, h: 3, visible: true, minW: 2, minH: 2, maxW: 12, maxH: 4 },
      ],
    },
    {
      id: 'section-quick-actions',
      title: 'Quick Actions',
      columns: 1,
      collapsed: false,
      widgets: [
        { id: 'admin-actions', type: 'QUICK_ACTIONS', x: 0, y: 0, w: 12, h: 3, visible: true, minW: 4, minH: 2, maxW: 12, maxH: 4 },
      ],
    },
    {
      id: 'section-financial-kpis',
      title: 'Financial KPIs',
      columns: 2,
      collapsed: false,
      widgets: [
        { id: 'admin-revenue-month', type: 'KPI_SUMMARY', x: 0, y: 0, w: 6, h: 3, visible: true, minW: 3, minH: 2, maxW: 12, maxH: 5, config: { metric: 'REVENUE_THIS_MONTH', dateRange: 'THIS_MONTH', comparison: 'LAST_MONTH' } },
        { id: 'admin-gross-margin', type: 'KPI_SUMMARY', x: 6, y: 0, w: 6, h: 3, visible: true, minW: 3, minH: 2, maxW: 12, maxH: 5, config: { metric: 'GROSS_MARGIN', dateRange: 'THIS_MONTH', comparison: 'LAST_MONTH' } },
      ],
    },
    {
      id: 'section-financial-workforce',
      title: 'Financial & Workforce',
      columns: 2,
      collapsed: false,
      widgets: [
        { id: 'admin-cash', type: 'CASH_POSITION', x: 0, y: 0, w: 6, h: 4, visible: true, minW: 4, minH: 3, maxW: 12, maxH: 6 },
        { id: 'admin-workforce', type: 'WORKFORCE_SNAPSHOT', x: 6, y: 0, w: 6, h: 4, visible: true, minW: 4, minH: 3, maxW: 12, maxH: 6 },
      ],
    },
    {
      id: 'section-pipeline-projects',
      title: 'Pipeline & Projects',
      columns: 2,
      collapsed: false,
      widgets: [
        { id: 'admin-pipeline', type: 'BID_PIPELINE', x: 0, y: 0, w: 6, h: 4, visible: true, minW: 4, minH: 3, maxW: 12, maxH: 6 },
        { id: 'admin-projects', type: 'ACTIVE_PROJECTS', x: 6, y: 0, w: 6, h: 6, visible: true, minW: 2, minH: 4, maxW: 8, maxH: 10 },
      ],
    },
    {
      id: 'section-operations',
      title: 'Operations',
      columns: 3,
      collapsed: false,
      widgets: [
        { id: 'admin-outstanding', type: 'OUTSTANDING_ITEMS', x: 0, y: 0, w: 4, h: 6, visible: true, minW: 2, minH: 4, maxW: 8, maxH: 10 },
        { id: 'admin-alerts', type: 'ALERTS', x: 4, y: 0, w: 4, h: 6, visible: true, minW: 3, minH: 4, maxW: 12, maxH: 8 },
        { id: 'admin-ai-insights', type: 'AI_INSIGHTS', x: 8, y: 0, w: 4, h: 6, visible: true, minW: 2, minH: 3, maxW: 12, maxH: 8 },
      ],
    },
    {
      id: 'section-trends',
      title: 'Trends',
      columns: 2,
      collapsed: false,
      widgets: [
        { id: 'admin-revenue-trend', type: 'TREND_CHART', x: 0, y: 0, w: 6, h: 5, visible: true, minW: 4, minH: 4, maxW: 12, maxH: 8, config: { metric: 'REVENUE', chartType: 'line', period: '90D', groupBy: 'none' } },
        { id: 'admin-cost-code', type: 'COST_CODE_BREAKDOWN', x: 6, y: 0, w: 6, h: 5, visible: true, minW: 4, minH: 4, maxW: 12, maxH: 8, config: { mode: 'budget_vs_actual' } },
      ],
    },
    {
      id: 'section-ops-intelligence',
      title: 'Operations Intelligence',
      columns: 3,
      collapsed: false,
      widgets: [
        { id: 'admin-project-health', type: 'PROJECT_HEALTH_SUMMARY', x: 0, y: 0, w: 4, h: 6, visible: true, minW: 4, minH: 5, maxW: 12, maxH: 10 },
        { id: 'admin-change-orders', type: 'CHANGE_ORDERS_PENDING', x: 4, y: 0, w: 4, h: 5, visible: true, minW: 4, minH: 4, maxW: 12, maxH: 8 },
        { id: 'admin-rfi-status', type: 'RFI_STATUS', x: 8, y: 0, w: 4, h: 6, visible: true, minW: 4, minH: 5, maxW: 12, maxH: 10 },
      ],
    },
    {
      id: 'section-workforce-safety',
      title: 'Workforce & Safety',
      columns: 2,
      collapsed: false,
      widgets: [
        { id: 'admin-labor-util', type: 'LABOR_UTILIZATION', x: 0, y: 0, w: 6, h: 5, visible: true, minW: 4, minH: 4, maxW: 12, maxH: 7 },
        { id: 'admin-safety-alerts', type: 'SAFETY_ALERTS', x: 6, y: 0, w: 6, h: 6, visible: true, minW: 4, minH: 5, maxW: 12, maxH: 10 },
      ],
    },
    {
      id: 'section-communications',
      title: 'Communications',
      columns: 3,
      collapsed: false,
      widgets: [
        { id: 'admin-messages', type: 'MESSAGES', x: 0, y: 0, w: 4, h: 6, visible: true, minW: 2, minH: 4, maxW: 8, maxH: 10 },
        { id: 'admin-notifications', type: 'NOTIFICATIONS', x: 4, y: 0, w: 4, h: 6, visible: true, minW: 2, minH: 4, maxW: 8, maxH: 10 },
        { id: 'admin-calendar', type: 'CALENDAR_EVENTS', x: 8, y: 0, w: 4, h: 6, visible: true, minW: 2, minH: 4, maxW: 8, maxH: 10 },
      ],
    },
  ],
  gridCols: 12,
  version: 3,
};

const HUSTLER_LAYOUT: DashboardLayoutConfig = {
  sections: [
    {
      id: 'section-overview',
      title: 'Overview',
      columns: 1,
      collapsed: false,
      widgets: [
        { id: 'hustler-quick-stats', type: 'QUICK_STATS', x: 0, y: 0, w: 12, h: 3, visible: true, minW: 2, minH: 2, maxW: 12, maxH: 4 },
      ],
    },
    {
      id: 'section-quick-actions',
      title: 'Quick Actions',
      columns: 1,
      collapsed: false,
      widgets: [
        { id: 'hustler-actions', type: 'QUICK_ACTIONS', x: 0, y: 0, w: 12, h: 3, visible: true, minW: 4, minH: 2, maxW: 12, maxH: 4 },
      ],
    },
    {
      id: 'section-financial-kpis',
      title: 'Financial KPIs',
      columns: 2,
      collapsed: false,
      widgets: [
        { id: 'hustler-revenue', type: 'KPI_SUMMARY', x: 0, y: 0, w: 6, h: 3, visible: true, minW: 3, minH: 2, maxW: 12, maxH: 5, config: { metric: 'REVENUE_THIS_MONTH', dateRange: 'THIS_MONTH', comparison: 'LAST_MONTH' } },
        { id: 'hustler-margin', type: 'KPI_SUMMARY', x: 6, y: 0, w: 6, h: 3, visible: true, minW: 3, minH: 2, maxW: 12, maxH: 5, config: { metric: 'GROSS_MARGIN', dateRange: 'THIS_MONTH', comparison: 'LAST_MONTH' } },
      ],
    },
    {
      id: 'section-pipeline',
      title: 'Pipeline & Projects',
      columns: 2,
      collapsed: false,
      widgets: [
        { id: 'hustler-pipeline', type: 'BID_PIPELINE', x: 0, y: 0, w: 6, h: 4, visible: true, minW: 4, minH: 3, maxW: 12, maxH: 6 },
        { id: 'hustler-projects', type: 'ACTIVE_PROJECTS', x: 6, y: 0, w: 6, h: 6, visible: true, minW: 2, minH: 4, maxW: 8, maxH: 10 },
      ],
    },
    {
      id: 'section-financial',
      title: 'Financial',
      columns: 2,
      collapsed: false,
      widgets: [
        { id: 'hustler-cash', type: 'CASH_POSITION', x: 0, y: 0, w: 6, h: 4, visible: true, minW: 4, minH: 3, maxW: 12, maxH: 6 },
        { id: 'hustler-revenue-trend', type: 'TREND_CHART', x: 6, y: 0, w: 6, h: 5, visible: true, minW: 4, minH: 4, maxW: 12, maxH: 8, config: { metric: 'REVENUE', chartType: 'line', period: '90D', groupBy: 'none' } },
      ],
    },
    {
      id: 'section-operations',
      title: 'Operations',
      columns: 2,
      collapsed: false,
      widgets: [
        { id: 'hustler-outstanding', type: 'OUTSTANDING_ITEMS', x: 0, y: 0, w: 6, h: 6, visible: true, minW: 2, minH: 4, maxW: 8, maxH: 10 },
        { id: 'hustler-alerts', type: 'ALERTS', x: 6, y: 0, w: 6, h: 6, visible: true, minW: 3, minH: 4, maxW: 12, maxH: 8 },
      ],
    },
    {
      id: 'section-ai',
      title: 'AI',
      columns: 2,
      collapsed: false,
      widgets: [
        { id: 'hustler-ai-insights', type: 'AI_INSIGHTS', x: 0, y: 0, w: 6, h: 5, visible: true, minW: 2, minH: 3, maxW: 12, maxH: 8 },
        { id: 'hustler-ai-tasks', type: 'AI_TASKS', x: 6, y: 0, w: 6, h: 5, visible: true, minW: 2, minH: 3, maxW: 8, maxH: 8 },
      ],
    },
    {
      id: 'section-communications',
      title: 'Communications',
      columns: 3,
      collapsed: false,
      widgets: [
        { id: 'hustler-messages', type: 'MESSAGES', x: 0, y: 0, w: 4, h: 6, visible: true, minW: 2, minH: 4, maxW: 8, maxH: 10 },
        { id: 'hustler-notifications', type: 'NOTIFICATIONS', x: 4, y: 0, w: 4, h: 6, visible: true, minW: 2, minH: 4, maxW: 8, maxH: 10 },
        { id: 'hustler-calendar', type: 'CALENDAR_EVENTS', x: 8, y: 0, w: 4, h: 6, visible: true, minW: 2, minH: 4, maxW: 8, maxH: 10 },
      ],
    },
  ],
  gridCols: 12,
  version: 3,
};

const MANAGER_LAYOUT: DashboardLayoutConfig = {
  sections: [
    {
      id: 'section-overview',
      title: 'Overview',
      columns: 1,
      collapsed: false,
      widgets: [
        { id: 'mgr-quick-stats', type: 'QUICK_STATS', x: 0, y: 0, w: 12, h: 3, visible: true, minW: 2, minH: 2, maxW: 12, maxH: 4 },
      ],
    },
    {
      id: 'section-quick-actions',
      title: 'Quick Actions',
      columns: 1,
      collapsed: false,
      widgets: [
        { id: 'mgr-actions', type: 'QUICK_ACTIONS', x: 0, y: 0, w: 12, h: 3, visible: true, minW: 4, minH: 2, maxW: 12, maxH: 4 },
      ],
    },
    {
      id: 'section-pipeline',
      title: 'Pipeline & Estimating',
      columns: 2,
      collapsed: false,
      widgets: [
        { id: 'mgr-pipeline', type: 'BID_PIPELINE', x: 0, y: 0, w: 6, h: 4, visible: true, minW: 4, minH: 3, maxW: 12, maxH: 6 },
        { id: 'mgr-active-bids', type: 'ACTIVE_BIDS', x: 6, y: 0, w: 6, h: 6, visible: true, minW: 2, minH: 4, maxW: 8, maxH: 10 },
      ],
    },
    {
      id: 'section-projects-schedule',
      title: 'Projects & Schedule',
      columns: 2,
      collapsed: false,
      widgets: [
        { id: 'mgr-active-projects', type: 'ACTIVE_PROJECTS', x: 0, y: 0, w: 6, h: 6, visible: true, minW: 2, minH: 4, maxW: 8, maxH: 10 },
        { id: 'mgr-schedule', type: 'SCHEDULE_IMPACT', x: 6, y: 0, w: 6, h: 6, visible: true, minW: 4, minH: 4, maxW: 12, maxH: 8 },
      ],
    },
    {
      id: 'section-insights-alerts',
      title: 'Insights & Alerts',
      columns: 2,
      collapsed: false,
      widgets: [
        { id: 'mgr-alerts', type: 'ALERTS', x: 0, y: 0, w: 6, h: 6, visible: true, minW: 3, minH: 4, maxW: 12, maxH: 8 },
        { id: 'mgr-outstanding', type: 'OUTSTANDING_ITEMS', x: 6, y: 0, w: 6, h: 6, visible: true, minW: 2, minH: 4, maxW: 8, maxH: 10 },
      ],
    },
    {
      id: 'section-financial',
      title: 'Financial',
      columns: 2,
      collapsed: false,
      widgets: [
        { id: 'mgr-cash', type: 'CASH_POSITION', x: 0, y: 0, w: 6, h: 4, visible: true, minW: 4, minH: 3, maxW: 12, maxH: 6 },
        { id: 'mgr-cost-code', type: 'COST_CODE_BREAKDOWN', x: 6, y: 0, w: 6, h: 5, visible: true, minW: 4, minH: 4, maxW: 12, maxH: 8, config: { mode: 'budget_vs_actual' } },
      ],
    },
    {
      id: 'section-workforce',
      title: 'Workforce',
      columns: 2,
      collapsed: false,
      widgets: [
        { id: 'mgr-workforce', type: 'WORKFORCE_SNAPSHOT', x: 0, y: 0, w: 6, h: 4, visible: true, minW: 4, minH: 3, maxW: 12, maxH: 6 },
        { id: 'mgr-crew', type: 'CREW_OVERVIEW', x: 6, y: 0, w: 6, h: 5, visible: true, minW: 2, minH: 3, maxW: 6, maxH: 8 },
      ],
    },
    {
      id: 'section-project-intelligence',
      title: 'Project Intelligence',
      columns: 3,
      collapsed: false,
      widgets: [
        { id: 'mgr-project-health', type: 'PROJECT_HEALTH_SUMMARY', x: 0, y: 0, w: 4, h: 6, visible: true, minW: 4, minH: 5, maxW: 12, maxH: 10 },
        { id: 'mgr-rfi-status', type: 'RFI_STATUS', x: 4, y: 0, w: 4, h: 6, visible: true, minW: 4, minH: 5, maxW: 12, maxH: 10 },
        { id: 'mgr-change-orders', type: 'CHANGE_ORDERS_PENDING', x: 8, y: 0, w: 4, h: 5, visible: true, minW: 4, minH: 4, maxW: 12, maxH: 8 },
      ],
    },
    {
      id: 'section-labor-safety',
      title: 'Labor & Safety',
      columns: 2,
      collapsed: false,
      widgets: [
        { id: 'mgr-labor-util', type: 'LABOR_UTILIZATION', x: 0, y: 0, w: 6, h: 5, visible: true, minW: 4, minH: 4, maxW: 12, maxH: 7 },
        { id: 'mgr-safety-alerts', type: 'SAFETY_ALERTS', x: 6, y: 0, w: 6, h: 6, visible: true, minW: 4, minH: 5, maxW: 12, maxH: 10 },
      ],
    },
    {
      id: 'section-ai',
      title: 'AI',
      columns: 2,
      collapsed: false,
      widgets: [
        { id: 'mgr-ai-insights', type: 'AI_INSIGHTS', x: 0, y: 0, w: 6, h: 5, visible: true, minW: 2, minH: 3, maxW: 12, maxH: 8 },
        { id: 'mgr-ai-tasks', type: 'AI_TASKS', x: 6, y: 0, w: 6, h: 5, visible: true, minW: 2, minH: 3, maxW: 8, maxH: 8 },
      ],
    },
    {
      id: 'section-communications',
      title: 'Communications',
      columns: 3,
      collapsed: false,
      widgets: [
        { id: 'mgr-messages', type: 'MESSAGES', x: 0, y: 0, w: 4, h: 6, visible: true, minW: 2, minH: 4, maxW: 8, maxH: 10 },
        { id: 'mgr-notifications', type: 'NOTIFICATIONS', x: 4, y: 0, w: 4, h: 6, visible: true, minW: 2, minH: 4, maxW: 8, maxH: 10 },
        { id: 'mgr-calendar', type: 'CALENDAR_EVENTS', x: 8, y: 0, w: 4, h: 6, visible: true, minW: 2, minH: 4, maxW: 8, maxH: 10 },
      ],
    },
  ],
  gridCols: 12,
  version: 3,
};

const SUPERINTENDENT_LAYOUT: DashboardLayoutConfig = {
  sections: [
    {
      id: 'section-today',
      title: 'Today',
      columns: 1,
      collapsed: false,
      widgets: [
        { id: 'super-quick-stats', type: 'QUICK_STATS', x: 0, y: 0, w: 12, h: 3, visible: true, minW: 2, minH: 2, maxW: 12, maxH: 4 },
      ],
    },
    {
      id: 'section-quick-actions',
      title: 'Quick Actions',
      columns: 1,
      collapsed: false,
      widgets: [
        { id: 'super-actions', type: 'QUICK_ACTIONS', x: 0, y: 0, w: 12, h: 3, visible: true, minW: 4, minH: 2, maxW: 12, maxH: 4 },
      ],
    },
    {
      id: 'section-crew',
      title: 'Crew Management',
      columns: 2,
      collapsed: false,
      widgets: [
        { id: 'super-crew', type: 'CREW_OVERVIEW', x: 0, y: 0, w: 6, h: 5, visible: true, minW: 2, minH: 3, maxW: 6, maxH: 8 },
        { id: 'super-workforce', type: 'WORKFORCE_SNAPSHOT', x: 6, y: 0, w: 6, h: 4, visible: true, minW: 4, minH: 3, maxW: 12, maxH: 6 },
      ],
    },
    {
      id: 'section-jobsite',
      title: 'Jobsite & Schedule',
      columns: 2,
      collapsed: false,
      widgets: [
        { id: 'super-schedule', type: 'SCHEDULE_IMPACT', x: 0, y: 0, w: 6, h: 6, visible: true, minW: 4, minH: 4, maxW: 12, maxH: 8 },
        { id: 'super-active-projects', type: 'ACTIVE_PROJECTS', x: 6, y: 0, w: 6, h: 6, visible: true, minW: 2, minH: 4, maxW: 8, maxH: 10 },
      ],
    },
    {
      id: 'section-labor-safety',
      title: 'Labor & Safety',
      columns: 2,
      collapsed: false,
      widgets: [
        { id: 'super-labor-util', type: 'LABOR_UTILIZATION', x: 0, y: 0, w: 6, h: 5, visible: true, minW: 4, minH: 4, maxW: 12, maxH: 7 },
        { id: 'super-safety-alerts', type: 'SAFETY_ALERTS', x: 6, y: 0, w: 6, h: 6, visible: true, minW: 4, minH: 5, maxW: 12, maxH: 10 },
      ],
    },
    {
      id: 'section-review',
      title: 'Review & Alerts',
      columns: 2,
      collapsed: false,
      widgets: [
        { id: 'super-alerts', type: 'ALERTS', x: 0, y: 0, w: 6, h: 6, visible: true, minW: 3, minH: 4, maxW: 12, maxH: 8 },
        { id: 'super-project-health', type: 'PROJECT_HEALTH_SUMMARY', x: 6, y: 0, w: 6, h: 6, visible: true, minW: 4, minH: 5, maxW: 12, maxH: 10 },
      ],
    },
    {
      id: 'section-communications',
      title: 'Communications',
      columns: 3,
      collapsed: false,
      widgets: [
        { id: 'super-messages', type: 'MESSAGES', x: 0, y: 0, w: 4, h: 6, visible: true, minW: 2, minH: 4, maxW: 8, maxH: 10 },
        { id: 'super-notifications', type: 'NOTIFICATIONS', x: 4, y: 0, w: 4, h: 6, visible: true, minW: 2, minH: 4, maxW: 8, maxH: 10 },
        { id: 'super-calendar', type: 'CALENDAR_EVENTS', x: 8, y: 0, w: 4, h: 6, visible: true, minW: 2, minH: 4, maxW: 8, maxH: 10 },
      ],
    },
  ],
  gridCols: 12,
  version: 3,
};

const ESTIMATOR_LAYOUT: DashboardLayoutConfig = {
  sections: [
    {
      id: 'section-overview',
      title: 'Overview',
      columns: 1,
      collapsed: false,
      widgets: [
        { id: 'est-quick-stats', type: 'QUICK_STATS', x: 0, y: 0, w: 12, h: 3, visible: true, minW: 2, minH: 2, maxW: 12, maxH: 4 },
      ],
    },
    {
      id: 'section-quick-actions',
      title: 'Quick Actions',
      columns: 1,
      collapsed: false,
      widgets: [
        { id: 'est-actions', type: 'QUICK_ACTIONS', x: 0, y: 0, w: 12, h: 3, visible: true, minW: 4, minH: 2, maxW: 12, maxH: 4 },
      ],
    },
    {
      id: 'section-bids',
      title: 'Bids & Pipeline',
      columns: 2,
      collapsed: false,
      widgets: [
        { id: 'est-pipeline', type: 'BID_PIPELINE', x: 0, y: 0, w: 6, h: 4, visible: true, minW: 4, minH: 3, maxW: 12, maxH: 6 },
        { id: 'est-active-bids', type: 'ACTIVE_BIDS', x: 6, y: 0, w: 6, h: 6, visible: true, minW: 2, minH: 4, maxW: 8, maxH: 10 },
      ],
    },
    {
      id: 'section-projects',
      title: 'Projects',
      columns: 2,
      collapsed: false,
      widgets: [
        { id: 'est-active-projects', type: 'ACTIVE_PROJECTS', x: 0, y: 0, w: 6, h: 6, visible: true, minW: 2, minH: 4, maxW: 8, maxH: 10 },
        { id: 'est-assignments', type: 'PROJECT_ASSIGNMENTS', x: 6, y: 0, w: 6, h: 4, visible: true, minW: 2, minH: 3, maxW: 12, maxH: 6 },
      ],
    },
    {
      id: 'section-ai',
      title: 'AI',
      columns: 2,
      collapsed: false,
      widgets: [
        { id: 'est-ai-tasks', type: 'AI_TASKS', x: 0, y: 0, w: 6, h: 5, visible: true, minW: 2, minH: 3, maxW: 8, maxH: 8 },
        { id: 'est-weather', type: 'WEATHER', x: 6, y: 0, w: 6, h: 4, visible: true, minW: 2, minH: 3, maxW: 12, maxH: 6 },
      ],
    },
    {
      id: 'section-communications',
      title: 'Communications',
      columns: 3,
      collapsed: false,
      widgets: [
        { id: 'est-messages', type: 'MESSAGES', x: 0, y: 0, w: 4, h: 6, visible: true, minW: 2, minH: 4, maxW: 8, maxH: 10 },
        { id: 'est-notifications', type: 'NOTIFICATIONS', x: 4, y: 0, w: 4, h: 6, visible: true, minW: 2, minH: 4, maxW: 8, maxH: 10 },
        { id: 'est-calendar', type: 'CALENDAR_EVENTS', x: 8, y: 0, w: 4, h: 6, visible: true, minW: 2, minH: 4, maxW: 8, maxH: 10 },
      ],
    },
  ],
  gridCols: 12,
  version: 3,
};

const FIELD_WORKER_LAYOUT: DashboardLayoutConfig = {
  sections: [
    {
      id: 'section-my-work',
      title: 'My Work',
      columns: 1,
      collapsed: false,
      widgets: [
        { id: 'field-quick-stats', type: 'QUICK_STATS', x: 0, y: 0, w: 12, h: 3, visible: true, minW: 2, minH: 2, maxW: 12, maxH: 4, config: { showActiveBids: false } },
      ],
    },
    {
      id: 'section-quick-actions',
      title: 'Quick Actions',
      columns: 1,
      collapsed: false,
      widgets: [
        { id: 'field-actions', type: 'QUICK_ACTIONS', x: 0, y: 0, w: 12, h: 3, visible: true, minW: 4, minH: 2, maxW: 12, maxH: 4 },
      ],
    },
    {
      id: 'section-schedule-tasks',
      title: 'Schedule & Tasks',
      columns: 2,
      collapsed: false,
      widgets: [
        { id: 'field-assignments', type: 'PROJECT_ASSIGNMENTS', x: 0, y: 0, w: 6, h: 4, visible: true, minW: 2, minH: 3, maxW: 12, maxH: 6 },
        { id: 'field-active-projects', type: 'ACTIVE_PROJECTS', x: 6, y: 0, w: 6, h: 6, visible: true, minW: 2, minH: 4, maxW: 8, maxH: 10 },
      ],
    },
    {
      id: 'section-weather',
      title: 'Weather',
      columns: 1,
      collapsed: false,
      widgets: [
        { id: 'field-weather', type: 'WEATHER', x: 0, y: 0, w: 12, h: 4, visible: true, minW: 2, minH: 3, maxW: 12, maxH: 6 },
      ],
    },
    {
      id: 'section-communications',
      title: 'Communications',
      columns: 3,
      collapsed: false,
      widgets: [
        { id: 'field-messages', type: 'MESSAGES', x: 0, y: 0, w: 4, h: 6, visible: true, minW: 2, minH: 4, maxW: 8, maxH: 10 },
        { id: 'field-notifications', type: 'NOTIFICATIONS', x: 4, y: 0, w: 4, h: 6, visible: true, minW: 2, minH: 4, maxW: 8, maxH: 10 },
        { id: 'field-calendar', type: 'CALENDAR_EVENTS', x: 8, y: 0, w: 4, h: 6, visible: true, minW: 2, minH: 4, maxW: 8, maxH: 10 },
      ],
    },
  ],
  gridCols: 12,
  version: 3,
};

const VENDOR_LAYOUT: DashboardLayoutConfig = {
  sections: [
    {
      id: 'section-overview',
      title: 'Overview',
      columns: 1,
      collapsed: false,
      widgets: [
        { id: 'vendor-quick-stats', type: 'QUICK_STATS', x: 0, y: 0, w: 12, h: 3, visible: true, minW: 2, minH: 2, maxW: 12, maxH: 4, config: { showActiveBids: false, showActiveProjects: false } },
      ],
    },
    {
      id: 'section-quick-actions',
      title: 'Quick Actions',
      columns: 1,
      collapsed: false,
      widgets: [
        { id: 'vendor-actions', type: 'QUICK_ACTIONS', x: 0, y: 0, w: 12, h: 3, visible: true, minW: 4, minH: 2, maxW: 12, maxH: 4 },
      ],
    },
    {
      id: 'section-communications',
      title: 'Communications',
      columns: 2,
      collapsed: false,
      widgets: [
        { id: 'vendor-messages', type: 'MESSAGES', x: 0, y: 0, w: 6, h: 6, visible: true, minW: 2, minH: 4, maxW: 8, maxH: 10 },
        { id: 'vendor-notifications', type: 'NOTIFICATIONS', x: 6, y: 0, w: 6, h: 6, visible: true, minW: 2, minH: 4, maxW: 8, maxH: 10 },
      ],
    },
  ],
  gridCols: 12,
  version: 3,
};

const BASIC_TIER: DashboardLayoutConfig = {
  sections: [
    {
      id: 'section-overview',
      title: 'Overview',
      columns: 1,
      collapsed: false,
      widgets: [
        { id: 'basic-quick-stats', type: 'QUICK_STATS', x: 0, y: 0, w: 12, h: 3, visible: true, minW: 2, minH: 2, maxW: 12, maxH: 4 },
      ],
    },
    {
      id: 'section-quick-actions',
      title: 'Quick Actions',
      columns: 1,
      collapsed: false,
      widgets: [
        { id: 'basic-actions', type: 'QUICK_ACTIONS', x: 0, y: 0, w: 12, h: 3, visible: true, minW: 4, minH: 2, maxW: 12, maxH: 4 },
      ],
    },
    {
      id: 'section-my-projects',
      title: 'My Projects',
      columns: 2,
      collapsed: false,
      widgets: [
        { id: 'basic-active-projects', type: 'ACTIVE_PROJECTS', x: 0, y: 0, w: 6, h: 6, visible: true, minW: 2, minH: 4, maxW: 8, maxH: 10 },
        { id: 'basic-assignments', type: 'PROJECT_ASSIGNMENTS', x: 6, y: 0, w: 6, h: 4, visible: true, minW: 2, minH: 3, maxW: 12, maxH: 6 },
      ],
    },
    {
      id: 'section-communications',
      title: 'Communications',
      columns: 3,
      collapsed: false,
      widgets: [
        { id: 'basic-messages', type: 'MESSAGES', x: 0, y: 0, w: 4, h: 6, visible: true, minW: 2, minH: 4, maxW: 8, maxH: 10 },
        { id: 'basic-notifications', type: 'NOTIFICATIONS', x: 4, y: 0, w: 4, h: 6, visible: true, minW: 2, minH: 4, maxW: 8, maxH: 10 },
        { id: 'basic-calendar', type: 'CALENDAR_EVENTS', x: 8, y: 0, w: 4, h: 6, visible: true, minW: 2, minH: 4, maxW: 8, maxH: 10 },
      ],
    },
  ],
  gridCols: 12,
  version: 3,
};

export const PRESET_PALETTES = {
  default: {
    name: 'Default Blue',
    light: {
      primary: '222 47% 11%',
      primaryForeground: '210 40% 98%',
      secondary: '210 40% 96%',
      secondaryForeground: '222 47% 11%',
      accent: '210 40% 96%',
      accentForeground: '222 47% 11%',
      background: '0 0% 100%',
      foreground: '222 47% 11%',
      muted: '210 40% 96%',
      mutedForeground: '215 16% 43%',
      card: '0 0% 100%',
      cardForeground: '222 47% 11%',
      border: '214 32% 91%',
    },
    dark: {
      primary: '210 40% 98%',
      primaryForeground: '222 47% 11%',
      secondary: '217 33% 17%',
      secondaryForeground: '210 40% 98%',
      accent: '217 33% 17%',
      accentForeground: '210 40% 98%',
      background: '222 47% 11%',
      foreground: '210 40% 98%',
      muted: '217 33% 17%',
      mutedForeground: '215 20% 65%',
      card: '222 47% 11%',
      cardForeground: '210 40% 98%',
      border: '217 33% 17%',
    }
  },
  forest: {
    name: 'Forest Green',
    light: {
      primary: '142 76% 30%',
      primaryForeground: '0 0% 100%',
      secondary: '138 30% 90%',
      secondaryForeground: '142 76% 20%',
      accent: '142 50% 32%',
      accentForeground: '0 0% 100%',
      background: '0 0% 100%',
      foreground: '142 76% 10%',
      muted: '138 30% 90%',
      mutedForeground: '142 20% 36%',
      card: '0 0% 100%',
      cardForeground: '142 76% 10%',
      border: '142 30% 85%',
    },
    dark: {
      primary: '142 70% 50%',
      primaryForeground: '0 0% 0%',
      secondary: '142 30% 20%',
      secondaryForeground: '142 70% 85%',
      accent: '142 50% 30%',
      accentForeground: '0 0% 100%',
      background: '142 30% 8%',
      foreground: '142 10% 95%',
      muted: '142 30% 15%',
      mutedForeground: '142 20% 60%',
      card: '142 30% 10%',
      cardForeground: '142 10% 95%',
      border: '142 30% 20%',
    }
  },
  sunset: {
    name: 'Sunset Orange',
    light: {
      primary: '25 95% 38%',
      primaryForeground: '0 0% 100%',
      secondary: '30 50% 92%',
      secondaryForeground: '25 95% 25%',
      accent: '25 80% 40%',
      accentForeground: '0 0% 100%',
      background: '0 0% 100%',
      foreground: '25 50% 10%',
      muted: '30 50% 92%',
      mutedForeground: '25 30% 40%',
      card: '0 0% 100%',
      cardForeground: '25 50% 10%',
      border: '25 40% 88%',
    },
    dark: {
      primary: '25 95% 60%',
      primaryForeground: '0 0% 0%',
      secondary: '25 40% 18%',
      secondaryForeground: '25 90% 85%',
      accent: '25 80% 38%',
      accentForeground: '0 0% 100%',
      background: '25 30% 8%',
      foreground: '25 10% 95%',
      muted: '25 30% 15%',
      mutedForeground: '25 20% 60%',
      card: '25 30% 10%',
      cardForeground: '25 10% 95%',
      border: '25 30% 20%',
    }
  },
  ocean: {
    name: 'Ocean Blue',
    light: {
      primary: '200 95% 36%',
      primaryForeground: '0 0% 100%',
      secondary: '200 50% 92%',
      secondaryForeground: '200 95% 20%',
      accent: '200 80% 38%',
      accentForeground: '0 0% 100%',
      background: '0 0% 100%',
      foreground: '200 50% 10%',
      muted: '200 50% 92%',
      mutedForeground: '200 30% 40%',
      card: '0 0% 100%',
      cardForeground: '200 50% 10%',
      border: '200 40% 88%',
    },
    dark: {
      primary: '200 90% 55%',
      primaryForeground: '0 0% 0%',
      secondary: '200 40% 18%',
      secondaryForeground: '200 90% 85%',
      accent: '200 70% 33%',
      accentForeground: '0 0% 100%',
      background: '200 30% 8%',
      foreground: '200 10% 95%',
      muted: '200 30% 15%',
      mutedForeground: '200 20% 60%',
      card: '200 30% 10%',
      cardForeground: '200 10% 95%',
      border: '200 30% 20%',
    }
  },
  royal: {
    name: 'Royal Purple',
    light: {
      primary: '271 81% 56%',
      primaryForeground: '0 0% 100%',
      secondary: '270 50% 92%',
      secondaryForeground: '271 81% 25%',
      accent: '271 70% 58%',
      accentForeground: '0 0% 100%',
      background: '0 0% 100%',
      foreground: '271 50% 10%',
      muted: '270 50% 92%',
      mutedForeground: '271 30% 40%',
      card: '0 0% 100%',
      cardForeground: '271 50% 10%',
      border: '271 40% 88%',
    },
    dark: {
      primary: '271 80% 65%',
      primaryForeground: '0 0% 0%',
      secondary: '271 40% 18%',
      secondaryForeground: '271 80% 85%',
      accent: '271 60% 45%',
      accentForeground: '0 0% 100%',
      background: '271 30% 8%',
      foreground: '271 10% 95%',
      muted: '271 30% 15%',
      mutedForeground: '271 20% 60%',
      card: '271 30% 10%',
      cardForeground: '271 10% 95%',
      border: '271 30% 20%',
    }
  }
};

export function getDefaultLayoutForRole(role: string): DashboardLayoutConfig {
  switch (role) {
    case 'SUPER_ADMIN':
    case 'ADMIN':
      return ADMIN_LAYOUT;
    case 'HUSTLER':
      return HUSTLER_LAYOUT;
    case 'MANAGER':
      return MANAGER_LAYOUT;
    case 'SUPERINTENDENT':
      return SUPERINTENDENT_LAYOUT;
    case 'ESTIMATOR':
      return ESTIMATOR_LAYOUT;
    case 'FIELD_WORKER':
      return FIELD_WORKER_LAYOUT;
    case 'VENDOR':
      return VENDOR_LAYOUT;
    default:
      return BASIC_TIER;
  }
}
