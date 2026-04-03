import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Save } from "lucide-react";
import { useDashboardCustomization } from "@/hooks/use-dashboard-customization";
import { getWidgetDefinition } from "@/components/dashboard-widgets/WidgetRegistry";
import { QuickStatsSettings, type QuickStatsConfig, DEFAULT_QUICK_STATS_CONFIG } from "@/components/dashboard-widgets/QuickStatsSettings";
import { KPISummarySettings, type KPIConfig, DEFAULT_KPI_CONFIG } from "@/components/dashboard-widgets/KPISummarySettings";
import { TrendChartSettings, type TrendChartConfig, DEFAULT_TREND_CONFIG } from "@/components/dashboard-widgets/TrendChartSettings";
import { ListWidgetSettings, type ListWidgetConfig, DEFAULT_LIST_CONFIG } from "@/components/dashboard-widgets/ListWidgetSettings";
import { CostCodeBreakdownSettings, type CostCodeBreakdownConfig, DEFAULT_COST_CODE_CONFIG } from "@/components/dashboard-widgets/CostCodeBreakdownSettings";
import { RFIStatusSettings, type RFIStatusConfig, DEFAULT_RFI_STATUS_CONFIG } from "@/components/dashboard-widgets/RFIStatusSettings";
import { ChangeOrdersPendingSettings, type ChangeOrdersPendingConfig, DEFAULT_CO_PENDING_CONFIG } from "@/components/dashboard-widgets/ChangeOrdersPendingSettings";
import { SafetyAlertsSettings, type SafetyAlertsConfig, DEFAULT_SAFETY_ALERTS_CONFIG } from "@/components/dashboard-widgets/SafetyAlertsSettings";
import { LaborUtilizationSettings, type LaborUtilizationConfig, DEFAULT_LABOR_UTIL_CONFIG } from "@/components/dashboard-widgets/LaborUtilizationSettings";
import { ProjectHealthSummarySettings, type ProjectHealthSummaryConfig, DEFAULT_PROJECT_HEALTH_CONFIG } from "@/components/dashboard-widgets/ProjectHealthSummarySettings";
import { DisplayLimitSettings, type DisplayLimitConfig, DEFAULT_DISPLAY_LIMIT_CONFIG } from "@/components/dashboard-widgets/DisplayLimitSettings";

interface WidgetSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  widgetId: string;
  widgetType: string;
  sectionId: string;
}

export const WIDGETS_WITH_SETTINGS = new Set([
  "QUICK_STATS",
  "KPI_SUMMARY",
  "TREND_CHART",
  "DATA_LIST",
  "COST_CODE_BREAKDOWN",
  "RFI_STATUS",
  "CHANGE_ORDERS_PENDING",
  "SAFETY_ALERTS",
  "LABOR_UTILIZATION",
  "PROJECT_HEALTH_SUMMARY",
  "ACTIVE_PROJECTS",
  "ACTIVE_BIDS",
  "MESSAGES",
  "NOTIFICATIONS",
  "OUTSTANDING_ITEMS",
]);

export function WidgetSettingsDialog({ open, onOpenChange, widgetId, widgetType, sectionId }: WidgetSettingsDialogProps) {
  const { getWidgetConfig, updateWidgetConfig } = useDashboardCustomization();
  const currentConfig = getWidgetConfig(widgetId, sectionId) || {};
  const [localConfig, setLocalConfig] = useState<Record<string, any>>(currentConfig);
  const widgetDef = getWidgetDefinition(widgetType);

  useEffect(() => {
    if (open) {
      setLocalConfig(getWidgetConfig(widgetId, sectionId) || {});
    }
  }, [open, widgetId, sectionId, getWidgetConfig]);

  const handleSave = () => {
    updateWidgetConfig(widgetId, sectionId, localConfig);
    onOpenChange(false);
  };

  const renderSettings = () => {
    switch (widgetType) {
      case "QUICK_STATS":
        return (
          <QuickStatsSettings
            config={{ ...DEFAULT_QUICK_STATS_CONFIG, ...localConfig } as QuickStatsConfig}
            onChange={(config) => setLocalConfig(config)}
          />
        );
      case "KPI_SUMMARY":
        return (
          <KPISummarySettings
            config={{ ...DEFAULT_KPI_CONFIG, ...localConfig } as KPIConfig}
            onChange={(config) => setLocalConfig(config)}
          />
        );
      case "TREND_CHART":
        return (
          <TrendChartSettings
            config={{ ...DEFAULT_TREND_CONFIG, ...localConfig } as TrendChartConfig}
            onChange={(config) => setLocalConfig(config)}
          />
        );
      case "DATA_LIST":
        return (
          <ListWidgetSettings
            config={{ ...DEFAULT_LIST_CONFIG, ...localConfig } as ListWidgetConfig}
            onChange={(config) => setLocalConfig(config)}
          />
        );
      case "COST_CODE_BREAKDOWN":
        return (
          <CostCodeBreakdownSettings
            config={{ ...DEFAULT_COST_CODE_CONFIG, ...localConfig } as CostCodeBreakdownConfig}
            onChange={(config) => setLocalConfig(config)}
          />
        );
      case "RFI_STATUS":
        return (
          <RFIStatusSettings
            config={{ ...DEFAULT_RFI_STATUS_CONFIG, ...localConfig } as RFIStatusConfig}
            onChange={(config) => setLocalConfig(config)}
          />
        );
      case "CHANGE_ORDERS_PENDING":
        return (
          <ChangeOrdersPendingSettings
            config={{ ...DEFAULT_CO_PENDING_CONFIG, ...localConfig } as ChangeOrdersPendingConfig}
            onChange={(config) => setLocalConfig(config)}
          />
        );
      case "SAFETY_ALERTS":
        return (
          <SafetyAlertsSettings
            config={{ ...DEFAULT_SAFETY_ALERTS_CONFIG, ...localConfig } as SafetyAlertsConfig}
            onChange={(config) => setLocalConfig(config)}
          />
        );
      case "LABOR_UTILIZATION":
        return (
          <LaborUtilizationSettings
            config={{ ...DEFAULT_LABOR_UTIL_CONFIG, ...localConfig } as LaborUtilizationConfig}
            onChange={(config) => setLocalConfig(config)}
          />
        );
      case "PROJECT_HEALTH_SUMMARY":
        return (
          <ProjectHealthSummarySettings
            config={{ ...DEFAULT_PROJECT_HEALTH_CONFIG, ...localConfig } as ProjectHealthSummaryConfig}
            onChange={(config) => setLocalConfig(config)}
          />
        );
      case "ACTIVE_PROJECTS":
      case "ACTIVE_BIDS":
      case "MESSAGES":
        return (
          <DisplayLimitSettings
            config={{ ...DEFAULT_DISPLAY_LIMIT_CONFIG, ...localConfig } as DisplayLimitConfig}
            onChange={(config) => setLocalConfig(config)}
            defaultLimit={4}
          />
        );
      case "NOTIFICATIONS":
        return (
          <DisplayLimitSettings
            config={{ ...DEFAULT_DISPLAY_LIMIT_CONFIG, displayLimit: 5, ...localConfig } as DisplayLimitConfig}
            onChange={(config) => setLocalConfig(config)}
            defaultLimit={5}
          />
        );
      case "OUTSTANDING_ITEMS":
        return (
          <DisplayLimitSettings
            config={{ ...DEFAULT_DISPLAY_LIMIT_CONFIG, displayLimit: 3, ...localConfig } as DisplayLimitConfig}
            onChange={(config) => setLocalConfig(config)}
            defaultLimit={3}
          />
        );
      default:
        return <p className="text-sm text-muted-foreground">No settings available for this widget.</p>;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]" data-testid={`dialog-widget-settings-${widgetId}`}>
        <DialogHeader>
          <DialogTitle>{widgetDef?.label || widgetType} Settings</DialogTitle>
          <DialogDescription>Configure how this widget appears on your dashboard.</DialogDescription>
        </DialogHeader>
        <div className="py-4">
          {renderSettings()}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-widget-settings">
            Cancel
          </Button>
          <Button onClick={handleSave} data-testid="button-save-widget-settings">
            <Save className="w-4 h-4 mr-1" />
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
