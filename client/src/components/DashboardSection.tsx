import { useMemo, useCallback, useRef, useEffect, useState } from "react";
import { ResponsiveGridLayout, type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { useDashboardCustomization, type DashboardSection as DashboardSectionType } from "@/hooks/use-dashboard-customization";
import { getWidgetDefinition, getWidgetComponent } from "@/components/dashboard-widgets/WidgetRegistry";
import { GripVertical, X, ChevronDown, ChevronRight, Pencil, Trash2, Check, Columns2, Columns3, Columns4, LayoutList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface DashboardSectionProps {
  section: DashboardSectionType;
  sectionIndex: number;
  totalSections: number;
}

const COLUMN_ICONS = [LayoutList, Columns2, Columns3, Columns4];

export function DashboardSectionComponent({ section, sectionIndex, totalSections }: DashboardSectionProps) {
  const { isEditMode, updateSectionLayout, removeWidget, updateSectionTitle, updateSectionColumns, toggleSectionCollapse, removeSection, reorderSections } = useDashboardCustomization();
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(1200);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(section.title);

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

  useEffect(() => {
    setTitleDraft(section.title);
  }, [section.title]);

  const visibleWidgets = useMemo(() => {
    return section.widgets.filter((w) => w.visible && getWidgetComponent(w.type));
  }, [section.widgets]);

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
      updateSectionLayout(section.id, newLayout);
    },
    [isEditMode, updateSectionLayout, section.id]
  );

  const handleSaveTitle = () => {
    if (titleDraft.trim()) {
      updateSectionTitle(section.id, titleDraft.trim());
    } else {
      setTitleDraft(section.title);
    }
    setIsEditingTitle(false);
  };

  const handleMoveUp = () => {
    if (sectionIndex > 0) reorderSections(sectionIndex, sectionIndex - 1);
  };

  const handleMoveDown = () => {
    if (sectionIndex < totalSections - 1) reorderSections(sectionIndex, sectionIndex + 1);
  };

  return (
    <Card
      className={cn(
        "transition-all",
        isEditMode && "ring-1 ring-dashed ring-primary/20",
        section.collapsed && "pb-0"
      )}
      data-testid={`dashboard-section-${section.id}`}
    >
      <CardHeader className="py-2 px-3 sm:py-3 sm:px-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 sm:gap-2 flex-1 min-w-0">
            {isEditMode && (
              <div className="section-drag-handle cursor-grab active:cursor-grabbing text-muted-foreground">
                <GripVertical className="w-4 h-4" />
              </div>
            )}

            <button
              onClick={() => toggleSectionCollapse(section.id)}
              className="text-muted-foreground hover:text-foreground transition-colors"
              data-testid={`button-toggle-section-${section.id}`}
            >
              {section.collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {isEditMode && isEditingTitle ? (
              <div className="flex items-center gap-1 flex-1">
                <Input
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSaveTitle(); if (e.key === 'Escape') { setTitleDraft(section.title); setIsEditingTitle(false); }}}
                  onBlur={handleSaveTitle}
                  className="h-7 text-sm font-semibold"
                  autoFocus
                  data-testid={`input-section-title-${section.id}`}
                />
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleSaveTitle}>
                  <Check className="w-3 h-3" />
                </Button>
              </div>
            ) : (
              <h3
                className={cn("text-sm font-semibold truncate", isEditMode && "cursor-pointer hover:text-primary")}
                onClick={() => isEditMode && setIsEditingTitle(true)}
                data-testid={`text-section-title-${section.id}`}
              >
                {section.title}
              </h3>
            )}

            {isEditMode && !isEditingTitle && (
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setIsEditingTitle(true)} data-testid={`button-edit-title-${section.id}`}>
                <Pencil className="w-3 h-3" />
              </Button>
            )}
          </div>

          {isEditMode && (
            <div className="flex flex-wrap items-center gap-1">
              <div className="flex items-center border rounded-md overflow-hidden mr-1">
                {[1, 2, 3, 4].map((cols) => {
                  const Icon = COLUMN_ICONS[cols - 1];
                  return (
                    <Tooltip key={cols}>
                      <TooltipTrigger asChild>
                        <button
                          className={cn(
                            "px-1.5 py-1 sm:px-2 text-xs transition-colors",
                            section.columns === cols ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"
                          )}
                          onClick={() => updateSectionColumns(section.id, cols)}
                          data-testid={`button-section-cols-${cols}-${section.id}`}
                        >
                          <Icon className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{cols} column{cols > 1 ? 's' : ''}</TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6 sm:h-7 sm:w-7" disabled={sectionIndex === 0} onClick={handleMoveUp} data-testid={`button-move-up-${section.id}`}>
                    <ChevronRight className="w-3 h-3 sm:w-3.5 sm:h-3.5 -rotate-90" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Move up</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6 sm:h-7 sm:w-7" disabled={sectionIndex === totalSections - 1} onClick={handleMoveDown} data-testid={`button-move-down-${section.id}`}>
                    <ChevronRight className="w-3 h-3 sm:w-3.5 sm:h-3.5 rotate-90" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Move down</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6 sm:h-7 sm:w-7 text-destructive hover:text-destructive" onClick={() => removeSection(section.id)} data-testid={`button-delete-section-${section.id}`}>
                    <Trash2 className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Delete section</TooltipContent>
              </Tooltip>
            </div>
          )}

          {!isEditMode && (
            <span className="text-xs text-muted-foreground">
              {visibleWidgets.length} widget{visibleWidgets.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </CardHeader>

      {!section.collapsed && (
        <CardContent className="pt-0 px-2 pb-2" ref={containerRef}>
          {visibleWidgets.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground border-2 border-dashed rounded-lg">
              <p className="text-sm">
                {isEditMode ? "Add widgets to this section from the widget library" : "No widgets in this section"}
              </p>
            </div>
          ) : (
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
              margin={[12, 12]}
            >
              {visibleWidgets.map((widget) => {
                const WidgetComponent = getWidgetComponent(widget.type)!;

                return (
                  <div
                    key={widget.id}
                    className={cn("relative", isEditMode && "ring-2 ring-dashed ring-primary/30 rounded-lg")}
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
                            removeWidget(widget.id, section.id);
                          }}
                          data-testid={`button-remove-widget-${widget.id}`}
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                    )}
                    <div className={cn("h-full overflow-auto", isEditMode && "pt-7")}>
                      <WidgetComponent />
                    </div>
                  </div>
                );
              })}
            </ResponsiveGridLayout>
          )}
        </CardContent>
      )}
    </Card>
  );
}
