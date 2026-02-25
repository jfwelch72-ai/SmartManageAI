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

interface WidgetSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  widgetId: string;
  widgetType: string;
  sectionId: string;
}

export const WIDGETS_WITH_SETTINGS = new Set(["QUICK_STATS", "KPI_SUMMARY"]);

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
