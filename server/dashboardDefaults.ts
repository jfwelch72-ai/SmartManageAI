import type { DashboardLayoutConfig } from "@shared/schema";

export const KNOWN_WIDGET_TYPES = [
  'QUICK_STATS', 'KPI_SUMMARY', 'TREND_CHART', 'DATA_LIST', 'ALERTS', 'WORKFORCE_SNAPSHOT', 'CASH_POSITION', 'SOV_PROGRESS', 'BID_PIPELINE', 'COST_CODE_BREAKDOWN', 'SCHEDULE_IMPACT', 'WEATHER', 'AI_INSIGHTS', 'MESSAGES', 'NOTIFICATIONS',
  'CALENDAR_EVENTS', 'AI_TASKS', 'OUTSTANDING_ITEMS', 'ACTIVE_PROJECTS',
  'ACTIVE_BIDS', 'CREW_OVERVIEW', 'PROJECT_ASSIGNMENTS'
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

const DEFAULT_WIDGETS: DashboardLayoutConfig = {
  sections: [
    {
      id: 'section-key-metrics',
      title: 'Key Metrics',
      columns: 1,
      collapsed: false,
      widgets: [
        { id: 'quick-stats', type: 'QUICK_STATS', x: 0, y: 0, w: 12, h: 3, visible: true, minW: 2, minH: 2, maxW: 12, maxH: 4 },
      ],
    },
    {
      id: 'section-weather-insights',
      title: 'Weather & Insights',
      columns: 1,
      collapsed: false,
      widgets: [
        { id: 'weather', type: 'WEATHER', x: 0, y: 0, w: 12, h: 4, visible: true, minW: 2, minH: 3, maxW: 12, maxH: 6 },
        { id: 'ai-insights', type: 'AI_INSIGHTS', x: 0, y: 4, w: 12, h: 5, visible: true, minW: 2, minH: 3, maxW: 12, maxH: 8 },
      ],
    },
    {
      id: 'section-communications',
      title: 'Communications',
      columns: 3,
      collapsed: false,
      widgets: [
        { id: 'messages', type: 'MESSAGES', x: 0, y: 0, w: 4, h: 6, visible: true, minW: 2, minH: 4, maxW: 8, maxH: 10 },
        { id: 'notifications', type: 'NOTIFICATIONS', x: 4, y: 0, w: 4, h: 6, visible: true, minW: 2, minH: 4, maxW: 8, maxH: 10 },
        { id: 'calendar-events', type: 'CALENDAR_EVENTS', x: 8, y: 0, w: 4, h: 6, visible: true, minW: 2, minH: 4, maxW: 8, maxH: 10 },
      ],
    },
    {
      id: 'section-operations',
      title: 'Operations',
      columns: 3,
      collapsed: false,
      widgets: [
        { id: 'ai-tasks', type: 'AI_TASKS', x: 0, y: 0, w: 4, h: 5, visible: true, minW: 2, minH: 3, maxW: 8, maxH: 8 },
        { id: 'outstanding-items', type: 'OUTSTANDING_ITEMS', x: 4, y: 0, w: 4, h: 6, visible: true, minW: 2, minH: 4, maxW: 8, maxH: 10 },
        { id: 'active-projects', type: 'ACTIVE_PROJECTS', x: 8, y: 0, w: 4, h: 6, visible: true, minW: 2, minH: 4, maxW: 8, maxH: 10 },
      ],
    },
    {
      id: 'section-pipeline',
      title: 'Pipeline',
      columns: 2,
      collapsed: false,
      widgets: [
        { id: 'active-bids', type: 'ACTIVE_BIDS', x: 0, y: 0, w: 4, h: 6, visible: true, minW: 2, minH: 4, maxW: 8, maxH: 10 },
        { id: 'project-assignments', type: 'PROJECT_ASSIGNMENTS', x: 4, y: 0, w: 8, h: 4, visible: true, minW: 2, minH: 3, maxW: 12, maxH: 6 },
      ],
    },
  ],
  gridCols: 12,
  version: 3
};

const FIELD_WORKER_LAYOUT: DashboardLayoutConfig = {
  sections: [
    {
      id: 'section-my-work',
      title: 'My Work',
      columns: 2,
      collapsed: false,
      widgets: [
        { id: 'fw-time-week', type: 'KPI_SUMMARY', x: 0, y: 0, w: 6, h: 4, visible: true, minW: 3, minH: 3, maxW: 12, maxH: 6, config: { metric: 'TOTAL_LABOR_COST', dateRange: 'THIS_WEEK', comparison: 'LAST_WEEK' } },
        { id: 'fw-active-projects', type: 'ACTIVE_PROJECTS', x: 6, y: 0, w: 6, h: 6, visible: true, minW: 2, minH: 4, maxW: 8, maxH: 10 },
      ],
    },
    {
      id: 'section-schedule-safety',
      title: 'Schedule & Safety',
      columns: 2,
      collapsed: false,
      widgets: [
        { id: 'fw-schedule', type: 'SCHEDULE_IMPACT', x: 0, y: 0, w: 6, h: 6, visible: true, minW: 4, minH: 4, maxW: 12, maxH: 8 },
        { id: 'fw-alerts', type: 'ALERTS', x: 6, y: 0, w: 6, h: 6, visible: true, minW: 3, minH: 4, maxW: 12, maxH: 8 },
      ],
    },
    {
      id: 'section-time',
      title: 'Time & Calendar',
      columns: 2,
      collapsed: false,
      widgets: [
        { id: 'fw-overtime', type: 'KPI_SUMMARY', x: 0, y: 0, w: 6, h: 4, visible: true, minW: 3, minH: 3, maxW: 12, maxH: 6, config: { metric: 'TOTAL_LABOR_COST', dateRange: 'THIS_WEEK', comparison: 'LAST_WEEK' } },
        { id: 'fw-calendar', type: 'CALENDAR_EVENTS', x: 6, y: 0, w: 6, h: 6, visible: true, minW: 2, minH: 4, maxW: 8, maxH: 10 },
      ],
    },
  ],
  gridCols: 12,
  version: 3,
};

const SUPERINTENDENT_LAYOUT: DashboardLayoutConfig = {
  sections: [
    {
      id: 'section-my-crew',
      title: 'My Crew',
      columns: 2,
      collapsed: false,
      widgets: [
        { id: 'sup-crew', type: 'CREW_OVERVIEW', x: 0, y: 0, w: 4, h: 5, visible: true, minW: 2, minH: 3, maxW: 6, maxH: 8 },
        { id: 'sup-active-projects', type: 'ACTIVE_PROJECTS', x: 6, y: 0, w: 6, h: 6, visible: true, minW: 2, minH: 4, maxW: 8, maxH: 10 },
      ],
    },
    {
      id: 'section-schedule-safety',
      title: 'Schedule & Safety',
      columns: 2,
      collapsed: false,
      widgets: [
        { id: 'sup-schedule', type: 'SCHEDULE_IMPACT', x: 0, y: 0, w: 6, h: 6, visible: true, minW: 4, minH: 4, maxW: 12, maxH: 8 },
        { id: 'sup-alerts', type: 'ALERTS', x: 6, y: 0, w: 6, h: 6, visible: true, minW: 3, minH: 4, maxW: 12, maxH: 8 },
      ],
    },
    {
      id: 'section-financial-overview',
      title: 'Financial Overview',
      columns: 2,
      collapsed: false,
      widgets: [
        { id: 'sup-cash', type: 'CASH_POSITION', x: 0, y: 0, w: 6, h: 4, visible: true, minW: 4, minH: 3, maxW: 12, maxH: 6 },
        { id: 'sup-labor', type: 'KPI_SUMMARY', x: 6, y: 0, w: 6, h: 4, visible: true, minW: 3, minH: 3, maxW: 12, maxH: 6, config: { metric: 'TOTAL_LABOR_COST', dateRange: 'THIS_WEEK', comparison: 'LAST_WEEK' } },
      ],
    },
    {
      id: 'section-calendar',
      title: 'Calendar',
      columns: 1,
      collapsed: false,
      widgets: [
        { id: 'sup-calendar', type: 'CALENDAR_EVENTS', x: 0, y: 0, w: 4, h: 6, visible: true, minW: 2, minH: 4, maxW: 8, maxH: 10 },
      ],
    },
  ],
  gridCols: 12,
  version: 3,
};

const EQUIPMENT_FOCUSED_LAYOUT: DashboardLayoutConfig = {
  sections: [
    {
      id: 'section-overview',
      title: 'Overview',
      columns: 1,
      collapsed: false,
      widgets: [
        { id: 'eq-quick-stats', type: 'QUICK_STATS', x: 0, y: 0, w: 12, h: 3, visible: true, minW: 2, minH: 2, maxW: 12, maxH: 4 },
      ],
    },
    {
      id: 'section-projects-alerts',
      title: 'Projects & Alerts',
      columns: 2,
      collapsed: false,
      widgets: [
        { id: 'eq-active-projects', type: 'ACTIVE_PROJECTS', x: 0, y: 0, w: 6, h: 6, visible: true, minW: 2, minH: 4, maxW: 8, maxH: 10 },
        { id: 'eq-alerts', type: 'ALERTS', x: 6, y: 0, w: 6, h: 6, visible: true, minW: 3, minH: 4, maxW: 12, maxH: 8 },
      ],
    },
    {
      id: 'section-communications',
      title: 'Communications',
      columns: 3,
      collapsed: false,
      widgets: [
        { id: 'eq-messages', type: 'MESSAGES', x: 0, y: 0, w: 4, h: 6, visible: true, minW: 2, minH: 4, maxW: 8, maxH: 10 },
        { id: 'eq-notifications', type: 'NOTIFICATIONS', x: 4, y: 0, w: 4, h: 6, visible: true, minW: 2, minH: 4, maxW: 8, maxH: 10 },
        { id: 'eq-calendar', type: 'CALENDAR_EVENTS', x: 8, y: 0, w: 4, h: 6, visible: true, minW: 2, minH: 4, maxW: 8, maxH: 10 },
      ],
    },
  ],
  gridCols: 12,
  version: 3,
};

const BASIC_LAYOUT: DashboardLayoutConfig = {
  sections: [
    {
      id: 'section-overview',
      title: 'Overview',
      columns: 2,
      collapsed: false,
      widgets: [
        { id: 'basic-quick-stats', type: 'QUICK_STATS', x: 0, y: 0, w: 6, h: 3, visible: true, minW: 2, minH: 2, maxW: 12, maxH: 4 },
        { id: 'basic-weather', type: 'WEATHER', x: 6, y: 0, w: 6, h: 4, visible: true, minW: 2, minH: 3, maxW: 12, maxH: 6 },
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

const PROJECT_MANAGER_LAYOUT: DashboardLayoutConfig = {
  sections: [
    {
      id: 'section-project-kpis',
      title: 'Project KPIs',
      columns: 2,
      collapsed: false,
      widgets: [
        { id: 'pm-quick-stats', type: 'QUICK_STATS', x: 0, y: 0, w: 6, h: 3, visible: true, minW: 2, minH: 2, maxW: 12, maxH: 4 },
        { id: 'pm-workforce', type: 'WORKFORCE_SNAPSHOT', x: 6, y: 0, w: 6, h: 4, visible: true, minW: 4, minH: 3, maxW: 12, maxH: 6 },
      ],
    },
    {
      id: 'section-financial',
      title: 'Financial',
      columns: 2,
      collapsed: false,
      widgets: [
        { id: 'pm-cost-code', type: 'COST_CODE_BREAKDOWN', x: 0, y: 0, w: 6, h: 5, visible: true, minW: 4, minH: 4, maxW: 12, maxH: 8, config: { mode: 'budget_vs_actual' } },
        { id: 'pm-margin', type: 'KPI_SUMMARY', x: 6, y: 0, w: 6, h: 4, visible: true, minW: 3, minH: 3, maxW: 12, maxH: 6, config: { metric: 'GROSS_MARGIN', dateRange: 'THIS_MONTH', comparison: 'LAST_MONTH' } },
      ],
    },
    {
      id: 'section-operations',
      title: 'Operations',
      columns: 2,
      collapsed: false,
      widgets: [
        { id: 'pm-subcontracts', type: 'DATA_LIST', x: 0, y: 0, w: 6, h: 5, visible: true, minW: 3, minH: 4, maxW: 12, maxH: 8, config: { entity: 'SUBCONTRACTS', status: '', sortBy: 'created_at', sortDir: 'desc', limit: 10 } },
        { id: 'pm-sov', type: 'SOV_PROGRESS', x: 6, y: 0, w: 6, h: 5, visible: true, minW: 4, minH: 4, maxW: 12, maxH: 8 },
      ],
    },
  ],
  gridCols: 12,
  version: 3,
};

const ESTIMATOR_LAYOUT: DashboardLayoutConfig = {
  sections: [
    {
      id: 'section-bid-overview',
      title: 'Bid Overview',
      columns: 2,
      collapsed: false,
      widgets: [
        { id: 'est-pipeline', type: 'BID_PIPELINE', x: 0, y: 0, w: 6, h: 4, visible: true, minW: 4, minH: 3, maxW: 12, maxH: 6 },
        { id: 'est-winrate', type: 'KPI_SUMMARY', x: 6, y: 0, w: 6, h: 4, visible: true, minW: 3, minH: 3, maxW: 12, maxH: 6, config: { metric: 'GROSS_MARGIN', dateRange: 'THIS_QUARTER', comparison: 'LAST_QUARTER' } },
      ],
    },
    {
      id: 'section-cost-analysis',
      title: 'Cost Analysis',
      columns: 2,
      collapsed: false,
      widgets: [
        { id: 'est-cost-code', type: 'COST_CODE_BREAKDOWN', x: 0, y: 0, w: 6, h: 5, visible: true, minW: 4, minH: 4, maxW: 12, maxH: 8, config: { mode: 'labor' } },
        { id: 'est-trend', type: 'TREND_CHART', x: 6, y: 0, w: 6, h: 5, visible: true, minW: 4, minH: 4, maxW: 12, maxH: 8, config: { metric: 'LABOR_COST', chartType: 'line', period: '90D', groupBy: 'none' } },
      ],
    },
  ],
  gridCols: 12,
  version: 3,
};

const CFO_LAYOUT: DashboardLayoutConfig = {
  sections: [
    {
      id: 'section-financial-position',
      title: 'Financial Position',
      columns: 2,
      collapsed: false,
      widgets: [
        { id: 'cfo-cash', type: 'CASH_POSITION', x: 0, y: 0, w: 6, h: 4, visible: true, minW: 4, minH: 3, maxW: 12, maxH: 6 },
        { id: 'cfo-margin', type: 'KPI_SUMMARY', x: 6, y: 0, w: 6, h: 4, visible: true, minW: 3, minH: 3, maxW: 12, maxH: 6, config: { metric: 'GROSS_MARGIN', dateRange: 'THIS_MONTH', comparison: 'LAST_MONTH' } },
      ],
    },
    {
      id: 'section-liabilities-risk',
      title: 'Liabilities & Risk',
      columns: 2,
      collapsed: false,
      widgets: [
        { id: 'cfo-revenue', type: 'KPI_SUMMARY', x: 0, y: 0, w: 6, h: 4, visible: true, minW: 3, minH: 3, maxW: 12, maxH: 6, config: { metric: 'REVENUE_THIS_MONTH', dateRange: 'THIS_MONTH', comparison: 'LAST_MONTH' } },
        { id: 'cfo-alerts', type: 'ALERTS', x: 6, y: 0, w: 6, h: 6, visible: true, minW: 3, minH: 4, maxW: 12, maxH: 8 },
      ],
    },
    {
      id: 'section-trending',
      title: 'Trending',
      columns: 2,
      collapsed: false,
      widgets: [
        { id: 'cfo-cashflow-trend', type: 'TREND_CHART', x: 0, y: 0, w: 6, h: 5, visible: true, minW: 4, minH: 4, maxW: 12, maxH: 8, config: { metric: 'CASH_FLOW', chartType: 'line', period: '90D', groupBy: 'none' } },
        { id: 'cfo-projects', type: 'DATA_LIST', x: 6, y: 0, w: 6, h: 5, visible: true, minW: 3, minH: 4, maxW: 12, maxH: 8, config: { entity: 'PROJECTS', status: 'active', sortBy: 'created_at', sortDir: 'desc', limit: 10 } },
      ],
    },
  ],
  gridCols: 12,
  version: 3,
};

const EXECUTIVE_LAYOUT: DashboardLayoutConfig = {
  sections: [
    {
      id: 'section-executive-summary',
      title: 'Executive Summary',
      columns: 2,
      collapsed: false,
      widgets: [
        { id: 'exec-revenue', type: 'KPI_SUMMARY', x: 0, y: 0, w: 6, h: 4, visible: true, minW: 3, minH: 3, maxW: 12, maxH: 6, config: { metric: 'REVENUE_THIS_MONTH', dateRange: 'THIS_YEAR', comparison: 'LAST_QUARTER' } },
        { id: 'exec-margin', type: 'KPI_SUMMARY', x: 6, y: 0, w: 6, h: 4, visible: true, minW: 3, minH: 3, maxW: 12, maxH: 6, config: { metric: 'GROSS_MARGIN', dateRange: 'THIS_MONTH', comparison: 'LAST_MONTH' } },
      ],
    },
    {
      id: 'section-pipeline-projects',
      title: 'Pipeline & Projects',
      columns: 2,
      collapsed: false,
      widgets: [
        { id: 'exec-pipeline', type: 'BID_PIPELINE', x: 0, y: 0, w: 6, h: 4, visible: true, minW: 4, minH: 3, maxW: 12, maxH: 6 },
        { id: 'exec-projects', type: 'ACTIVE_PROJECTS', x: 6, y: 0, w: 6, h: 6, visible: true, minW: 2, minH: 4, maxW: 8, maxH: 10 },
      ],
    },
    {
      id: 'section-risk-trends',
      title: 'Risk & Trends',
      columns: 2,
      collapsed: false,
      widgets: [
        { id: 'exec-alerts', type: 'ALERTS', x: 0, y: 0, w: 6, h: 6, visible: true, minW: 3, minH: 4, maxW: 12, maxH: 8 },
        { id: 'exec-labor-trend', type: 'TREND_CHART', x: 6, y: 0, w: 6, h: 5, visible: true, minW: 4, minH: 4, maxW: 12, maxH: 8, config: { metric: 'LABOR_COST', chartType: 'bar', period: '6M', groupBy: 'none' } },
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
      return DEFAULT_WIDGETS;
    case 'ADMIN':
    case 'HUSTLER':
      return EXECUTIVE_LAYOUT;
    case 'MANAGER':
      return PROJECT_MANAGER_LAYOUT;
    case 'SUPERINTENDENT':
      return SUPERINTENDENT_LAYOUT;
    case 'ESTIMATOR':
      return ESTIMATOR_LAYOUT;
    case 'OFFICE_MANAGER':
      return CFO_LAYOUT;
    case 'HOURLY_EMPLOYEE':
      return FIELD_WORKER_LAYOUT;
    case 'MAINTENANCE_MANAGER':
    case 'EQUIPMENT_MANAGER':
      return EQUIPMENT_FOCUSED_LAYOUT;
    case 'SAFETY_MANAGER':
    case 'HR_MANAGER':
    case 'PROJECT_ENGINEER':
    case 'SALES':
    case 'MARKETING':
    case 'VENDOR':
    case 'DISPATCHER':
    case 'PROCUREMENT_MANAGER':
    default:
      return BASIC_LAYOUT;
  }
}
