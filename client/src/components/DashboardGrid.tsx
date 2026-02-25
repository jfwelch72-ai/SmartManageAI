import { useMemo, useCallback, useRef, useEffect, useState } from "react";
import { ResponsiveGridLayout, type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { useDashboardCustomization } from "@/hooks/use-dashboard-customization";
import {
  getWidgetDefinition,
  getWidgetComponent,
} from "@/components/dashboard-widgets/WidgetRegistry";
import { GripVertical, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function DashboardGrid() {
  const { isEditMode, localLayout, updateLayout, removeWidget } =
    useDashboardCustomization();
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(1200);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const widgets = localLayout?.widgets || [];

  const visibleWidgets = useMemo(() => {
    return widgets.filter((w) => w.visible && getWidgetComponent(w.type));
  }, [widgets]);

  const layoutItems: Layout[] = useMemo(() => {
    return visibleWidgets.map((w) => {
      const def = getWidgetDefinition(w.type);
      return {
        i: w.id,
        x: w.x,
        y: w.y,
        w: w.w,
        h: w.h,
        minW: w.minW || def?.minW || 2,
        minH: w.minH || def?.minH || 2,
        maxW: w.maxW || def?.maxW || 12,
        maxH: w.maxH || def?.maxH || 12,
        static: !isEditMode,
        isDraggable: isEditMode,
        isResizable: isEditMode,
      };
    });
  }, [visibleWidgets, isEditMode]);

  const handleLayoutChange = useCallback(
    (newLayout: Layout[]) => {
      if (!isEditMode) return;
      updateLayout(newLayout);
    },
    [isEditMode, updateLayout]
  );

  if (!localLayout || visibleWidgets.length === 0) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <p>No widgets on your dashboard. Click "Add Widget" to get started.</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`dashboard-grid ${isEditMode ? "edit-mode" : ""}`}
      data-testid="dashboard-grid"
    >
      <ResponsiveGridLayout
        className="layout"
        layouts={{ lg: layoutItems }}
        breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480 }}
        cols={{ lg: 12, md: 8, sm: 4, xs: 2 }}
        rowHeight={40}
        width={containerWidth}
        isDraggable={isEditMode}
        isResizable={isEditMode}
        onLayoutChange={handleLayoutChange}
        draggableHandle=".widget-drag-handle"
        compactType="vertical"
        margin={[16, 16]}
      >
        {visibleWidgets.map((widget) => {
          const WidgetComponent = getWidgetComponent(widget.type)!;

          return (
            <div
              key={widget.id}
              className={`relative ${isEditMode ? "ring-2 ring-dashed ring-primary/30 rounded-lg" : ""}`}
              data-testid={`widget-container-${widget.id}`}
            >
              {isEditMode && (
                <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-2 py-1 bg-primary/10 rounded-t-lg">
                  <div className="widget-drag-handle cursor-grab active:cursor-grabbing flex items-center gap-1 text-xs text-muted-foreground">
                    <GripVertical className="w-4 h-4" />
                    <span className="font-medium">
                      {getWidgetDefinition(widget.type)?.label || widget.type}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeWidget(widget.id);
                    }}
                    data-testid={`button-remove-widget-${widget.id}`}
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              )}
              <div
                className={`h-full overflow-auto ${isEditMode ? "pt-7" : ""}`}
              >
                <WidgetComponent />
              </div>
            </div>
          );
        })}
      </ResponsiveGridLayout>
    </div>
  );
}
