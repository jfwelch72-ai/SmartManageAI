import { useMemo, useEffect, useState, useRef, useCallback, type ReactNode } from "react";
import { useDashboardCustomization, type DashboardSection as DashboardSectionType } from "@/hooks/use-dashboard-customization";
import { getWidgetDefinition, getWidgetComponent, type WidgetCategory } from "@/components/dashboard-widgets/WidgetRegistry";
import { WidgetErrorBoundary } from "@/components/WidgetErrorBoundary";
import { GripVertical, X, ChevronDown, ChevronRight, ChevronUp, Pencil, Trash2, Check, Columns2, Columns3, Columns4, LayoutList, Settings2, Copy, Plus, RefreshCw, PackageOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { WidgetSettingsDialog, WIDGETS_WITH_SETTINGS } from "@/components/WidgetSettingsDialog";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { queryClient } from "@/lib/queryClient";

interface DashboardSectionProps {
  section: DashboardSectionType;
  sectionIndex: number;
  totalSections: number;
  onAddWidget?: (sectionId: string) => void;
}

const COLUMN_ICONS = [LayoutList, Columns2, Columns3, Columns4];

const GRID_CLASSES: Record<number, string> = {
  1: "grid grid-cols-1 gap-3",
  2: "grid grid-cols-1 sm:grid-cols-2 gap-3",
  3: "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3",
  4: "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3",
};

const CATEGORY_DOT_COLORS: Record<WidgetCategory, string> = {
  Financial: "bg-emerald-500",
  Operational: "bg-blue-500",
  Workforce: "bg-amber-500",
  Communication: "bg-violet-500",
  AI: "bg-purple-500",
  General: "bg-slate-400",
};

const CATEGORY_ACCENT_COLORS: Record<WidgetCategory, string> = {
  Financial: "border-t-emerald-500/60",
  Operational: "border-t-blue-500/60",
  Workforce: "border-t-amber-500/60",
  Communication: "border-t-violet-500/60",
  AI: "border-t-purple-500/60",
  General: "border-t-slate-400/60",
};

function StaggeredWidget({ children, delay }: { children: ReactNode; delay: number }) {
  const [shouldMount, setShouldMount] = useState(delay === 0);
  useEffect(() => {
    if (delay === 0) return;
    const timer = setTimeout(() => setShouldMount(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);
  if (!shouldMount) return null;
  return <>{children}</>;
}

export function DashboardSectionComponent({ section, sectionIndex, totalSections, onAddWidget }: DashboardSectionProps) {
  const { isEditMode, permissions, removeWidget, duplicateWidget, reorderWidgets, updateSectionTitle, updateSectionColumns, toggleSectionCollapse, removeSection, duplicateSection, reorderSections } = useDashboardCustomization();
  const { user } = useAuth();
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(section.title);
  const [settingsWidget, setSettingsWidget] = useState<{ id: string; type: string } | null>(null);
  const [refreshingWidget, setRefreshingWidget] = useState<string | null>(null);
  const [shouldRender, setShouldRender] = useState(!section.collapsed);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTitleDraft(section.title);
  }, [section.title]);

  useEffect(() => {
    if (!section.collapsed) {
      setShouldRender(true);
    }
  }, [section.collapsed]);

  const handleTransitionEnd = useCallback(() => {
    if (section.collapsed) {
      setShouldRender(false);
    }
  }, [section.collapsed]);

  const visibleWidgets = useMemo(() => {
    return section.widgets.filter((w) => {
      if (!w.visible || !getWidgetComponent(w.type)) return false;
      const def = getWidgetDefinition(w.type);
      if (!def) return false;
      const hasAllowedRole = def.allowedRoles
        ? def.allowedRoles.includes(user?.role || "")
        : true;
      const hasFeaturePerm = def.featurePerm
        ? (permissions[def.featurePerm] ?? false)
        : true;
      if (def.allowedRoles && def.featurePerm) {
        if (!hasAllowedRole || !hasFeaturePerm) return false;
      } else if (def.allowedRoles) {
        if (!hasAllowedRole) return false;
      } else if (def.featurePerm) {
        if (!hasFeaturePerm) return false;
      }
      return true;
    });
  }, [section.widgets, permissions, user?.role]);

  const dominantCategory = useMemo((): WidgetCategory => {
    const counts: Partial<Record<WidgetCategory, number>> = {};
    for (const w of visibleWidgets) {
      const def = getWidgetDefinition(w.type);
      if (def) counts[def.category] = (counts[def.category] || 0) + 1;
    }
    let max: WidgetCategory = "General";
    let maxCount = 0;
    for (const [cat, count] of Object.entries(counts)) {
      if (count > maxCount) { max = cat as WidgetCategory; maxCount = count; }
    }
    return max;
  }, [visibleWidgets]);

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

  const handleRefreshWidget = async (widgetId: string, widgetType: string) => {
    setRefreshingWidget(widgetId);
    const def = getWidgetDefinition(widgetType);
    if (def?.queryKeys?.length) {
      await Promise.all(
        def.queryKeys.map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] })
        )
      );
    } else {
      await queryClient.invalidateQueries();
    }
    setTimeout(() => setRefreshingWidget(null), 600);
  };

  return (
    <Card
      className={cn(
        "transition-all",
        isEditMode && "ring-1 ring-dashed ring-primary/30 shadow-sm",
        section.collapsed && "pb-0"
      )}
      data-testid={`dashboard-section-${section.id}`}
    >
      <CardHeader className="py-2 px-3 sm:py-3 sm:px-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 sm:gap-2 flex-1 min-w-0">
            {isEditMode && (
              <div className="section-drag-handle cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded hover:bg-muted">
                <GripVertical className="w-4 h-4" />
              </div>
            )}

            <div className={cn("w-2 h-2 rounded-full shrink-0", CATEGORY_DOT_COLORS[dominantCategory])} />

            <button
              onClick={() => toggleSectionCollapse(section.id)}
              className="text-muted-foreground hover:text-foreground transition-colors"
              data-testid={`button-toggle-section-${section.id}`}
            >
              <div className={cn("transition-transform duration-200", section.collapsed ? "rotate-0" : "rotate-90")}>
                <ChevronRight className="w-4 h-4" />
              </div>
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

            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-1" data-testid={`badge-widget-count-${section.id}`}>
              {visibleWidgets.length}
            </Badge>
          </div>

          {isEditMode && (
            <div className="flex flex-wrap items-center gap-0.5">
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

              <Separator orientation="vertical" className="h-5 mx-0.5" />

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

              <Separator orientation="vertical" className="h-5 mx-0.5" />

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6 sm:h-7 sm:w-7" onClick={() => onAddWidget?.(section.id)} data-testid={`button-add-widget-${section.id}`}>
                    <Plus className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Add widget</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6 sm:h-7 sm:w-7" onClick={() => duplicateSection(section.id)} data-testid={`button-duplicate-section-${section.id}`}>
                    <Copy className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Duplicate section</TooltipContent>
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

      <div
        ref={contentRef}
        className={cn(
          "transition-all duration-200 ease-in-out overflow-hidden",
          section.collapsed ? "max-h-0 opacity-0" : "max-h-[5000px] opacity-100"
        )}
        onTransitionEnd={handleTransitionEnd}
      >
      {shouldRender && (
        <CardContent className="pt-0 px-2 pb-2">
          {visibleWidgets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground border-2 border-dashed rounded-lg gap-3 bg-muted/20">
              <div className="w-12 h-12 rounded-full bg-muted/60 flex items-center justify-center">
                <PackageOpen className="w-6 h-6 text-muted-foreground/60" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium">
                  {isEditMode ? "This section is empty" : "No widgets to display"}
                </p>
                <p className="text-xs text-muted-foreground/70 mt-0.5">
                  {isEditMode ? "Add widgets to populate this section" : "Widgets may be hidden based on your role"}
                </p>
              </div>
              {isEditMode && (
                <Button variant="outline" size="sm" onClick={() => onAddWidget?.(section.id)} data-testid={`button-add-widget-empty-${section.id}`}>
                  <Plus className="w-3.5 h-3.5 mr-1.5" />
                  Add Widget
                </Button>
              )}
            </div>
          ) : (
            <div className={GRID_CLASSES[section.columns] || GRID_CLASSES[1]}>
              {visibleWidgets.map((widget, widgetIndex) => {
                const WidgetComponent = getWidgetComponent(widget.type)!;
                const widgetDef = getWidgetDefinition(widget.type);
                const visibleIndex = widgetIndex;
                const totalVisible = visibleWidgets.length;
                const hasSettings = WIDGETS_WITH_SETTINGS.has(widget.type);
                const isRefreshing = refreshingWidget === widget.id;
                return (
                  <StaggeredWidget key={widget.id} delay={widgetIndex * 150}>
                  <div
                    className={cn(
                      "relative group rounded-lg border-t-2 transition-all",
                      CATEGORY_ACCENT_COLORS[widgetDef?.category || "General"],
                      isEditMode && "ring-1 ring-dashed ring-primary/25 hover:ring-primary/50 hover:shadow-sm"
                    )}
                    data-testid={`widget-container-${widget.id}`}
                  >
                    {isEditMode && (
                      <div className="flex items-center justify-between px-2 py-1 bg-muted/60 rounded-t-lg border-b border-border/50">
                        <div className="flex items-center gap-1.5">
                          <div className="widget-drag-handle cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded hover:bg-muted">
                            <GripVertical className="w-3.5 h-3.5" />
                          </div>
                          <span className="text-xs font-medium text-muted-foreground truncate">
                            {widgetDef?.label || widget.type}
                          </span>
                        </div>
                        <div className="flex items-center gap-0.5">
                          {hasSettings && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={() => setSettingsWidget({ id: widget.id, type: widget.type })}
                                  data-testid={`button-widget-settings-${widget.id}`}
                                >
                                  <Settings2 className="w-3 h-3" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Widget settings</TooltipContent>
                            </Tooltip>
                          )}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => duplicateWidget(widget.id, section.id)}
                                data-testid={`button-duplicate-widget-${widget.id}`}
                              >
                                <Copy className="w-3 h-3" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Duplicate widget</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                disabled={visibleIndex === 0}
                                onClick={() => reorderWidgets(section.id, visibleIndex, visibleIndex - 1)}
                                data-testid={`button-widget-up-${widget.id}`}
                              >
                                <ChevronUp className="w-3 h-3" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Move up</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                disabled={visibleIndex === totalVisible - 1}
                                onClick={() => reorderWidgets(section.id, visibleIndex, visibleIndex + 1)}
                                data-testid={`button-widget-down-${widget.id}`}
                              >
                                <ChevronDown className="w-3 h-3" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Move down</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-destructive hover:text-destructive"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeWidget(widget.id, section.id);
                                }}
                                data-testid={`button-remove-widget-${widget.id}`}
                              >
                                <X className="w-3 h-3" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Remove widget</TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                    )}
                    {!isEditMode && (
                      <div className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 bg-background/80 backdrop-blur-sm shadow-sm border border-border/50"
                              onClick={() => handleRefreshWidget(widget.id, widget.type)}
                              disabled={isRefreshing}
                              data-testid={`button-refresh-widget-${widget.id}`}
                            >
                              <RefreshCw className={cn("w-3.5 h-3.5", isRefreshing && "animate-spin")} />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Refresh</TooltipContent>
                        </Tooltip>
                      </div>
                    )}
                    <WidgetErrorBoundary fallbackTitle={widgetDef?.label || "Widget"}>
                      <WidgetComponent config={widget.config} />
                    </WidgetErrorBoundary>
                  </div>
                  </StaggeredWidget>
                );
              })}

              {settingsWidget && (
                <WidgetSettingsDialog
                  open={!!settingsWidget}
                  onOpenChange={(open) => { if (!open) setSettingsWidget(null); }}
                  widgetId={settingsWidget.id}
                  widgetType={settingsWidget.type}
                  sectionId={section.id}
                />
              )}
            </div>
          )}
        </CardContent>
      )}
      </div>
    </Card>
  );
}
