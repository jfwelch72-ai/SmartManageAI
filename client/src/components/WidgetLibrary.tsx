import { useState, useEffect, useMemo } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Check, Search, LayoutGrid } from "lucide-react";
import { useDashboardCustomization, getAllWidgets, type FeaturePermissionKey } from "@/hooks/use-dashboard-customization";
import {
  WIDGET_REGISTRY,
  getSizeLabel,
  type WidgetDefinition,
  type WidgetCategory,
} from "@/components/dashboard-widgets/WidgetRegistry";
import { useAuth } from "@/hooks/use-auth";
import { hasManagementAccess } from "@/lib/rbac";

interface WidgetLibraryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultSectionId?: string;
}

const CATEGORY_ORDER: WidgetCategory[] = ["Financial", "Operational", "Workforce", "Communication", "AI", "General"];

const CATEGORY_COLORS: Record<WidgetCategory, string> = {
  Financial: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  Operational: "bg-blue-500/10 text-blue-600 border-blue-500/30",
  Workforce: "bg-orange-500/10 text-orange-600 border-orange-500/30",
  Communication: "bg-purple-500/10 text-purple-600 border-purple-500/30",
  AI: "bg-pink-500/10 text-pink-600 border-pink-500/30",
  General: "bg-slate-500/10 text-slate-600 border-slate-500/30",
};

function isWidgetAvailableForRole(
  widget: WidgetDefinition,
  userRole?: string,
  userPermissions?: Record<FeaturePermissionKey, boolean>
): boolean {
  const roleOk = !widget.roleGate
    || (widget.roleGate === "management" && hasManagementAccess(userRole))
    || (widget.roleGate === "superintendent" && userRole === "SUPERINTENDENT")
    || (!["management", "superintendent"].includes(widget.roleGate));

  if (!widget.featurePerm) return roleOk;

  const hasFeaturePerm = userPermissions?.[widget.featurePerm] ?? false;

  return roleOk || hasFeaturePerm;
}

function WidgetPreview({ widget }: { widget: WidgetDefinition }) {
  const Icon = widget.icon;
  return (
    <div className="w-full h-12 rounded-md bg-muted/50 border border-border/50 flex items-center justify-center gap-2 mt-2">
      <Icon className="w-4 h-4 text-muted-foreground/60" />
      <div className="flex gap-1">
        {widget.defaultW >= 12 ? (
          <div className="flex gap-0.5">
            <div className="w-6 h-2 bg-muted-foreground/15 rounded-sm" />
            <div className="w-6 h-2 bg-muted-foreground/15 rounded-sm" />
            <div className="w-6 h-2 bg-muted-foreground/15 rounded-sm" />
            <div className="w-6 h-2 bg-muted-foreground/15 rounded-sm" />
          </div>
        ) : widget.defaultW >= 6 ? (
          <div className="flex gap-0.5">
            <div className="w-8 h-2 bg-muted-foreground/15 rounded-sm" />
            <div className="w-8 h-2 bg-muted-foreground/15 rounded-sm" />
          </div>
        ) : (
          <div className="w-10 h-2 bg-muted-foreground/15 rounded-sm" />
        )}
      </div>
    </div>
  );
}

export function WidgetLibrary({ open, onOpenChange, defaultSectionId }: WidgetLibraryProps) {
  const { user } = useAuth();
  const { localLayout, addWidget, permissions } = useDashboardCustomization();
  const [searchQuery, setSearchQuery] = useState("");
  const [targetSectionId, setTargetSectionId] = useState<string>(defaultSectionId || "");
  const [activeCategory, setActiveCategory] = useState<WidgetCategory | "All">("All");

  useEffect(() => {
    setTargetSectionId(defaultSectionId || "");
  }, [defaultSectionId]);

  const sections = localLayout?.sections || [];
  const allWidgets = getAllWidgets(localLayout);
  const existingWidgetTypes = new Set(
    allWidgets.filter((w) => w.visible).map((w) => w.type)
  );

  const effectiveTargetSection = targetSectionId || (sections.length > 0 ? sections[sections.length - 1].id : "");

  const availableWidgets = WIDGET_REGISTRY.filter((widget) =>
    isWidgetAvailableForRole(widget, user?.role, permissions)
  );

  const filteredWidgets = useMemo(() => {
    let widgets = availableWidgets;
    if (searchQuery) {
      widgets = widgets.filter(
        (w) =>
          w.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
          w.description.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    if (activeCategory !== "All") {
      widgets = widgets.filter((w) => w.category === activeCategory);
    }
    return widgets;
  }, [availableWidgets, searchQuery, activeCategory]);

  const groupedWidgets = useMemo(() => {
    const groups: Record<string, WidgetDefinition[]> = {};
    for (const w of filteredWidgets) {
      if (!groups[w.category]) groups[w.category] = [];
      groups[w.category].push(w);
    }
    return CATEGORY_ORDER
      .filter((cat) => groups[cat]?.length)
      .map((cat) => ({ category: cat, widgets: groups[cat] }));
  }, [filteredWidgets]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const w of availableWidgets) {
      counts[w.category] = (counts[w.category] || 0) + 1;
    }
    return counts;
  }, [availableWidgets]);

  const handleAddWidget = (widget: WidgetDefinition) => {
    addWidget(widget.type, effectiveTargetSection);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:w-[420px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <LayoutGrid className="w-5 h-5" />
            Widget Library
          </SheetTitle>
          <SheetDescription>
            Add widgets to customize your dashboard layout
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-3">
          {sections.length > 1 && (
            <div className="space-y-1.5">
              <Label htmlFor="target-section" className="text-xs text-muted-foreground">Add to section</Label>
              <Select value={effectiveTargetSection} onValueChange={setTargetSectionId}>
                <SelectTrigger id="target-section" className="h-8" data-testid="select-target-section">
                  <SelectValue placeholder="Select section" />
                </SelectTrigger>
                <SelectContent>
                  {sections.map((s) => (
                    <SelectItem key={s.id} value={s.id} data-testid={`section-option-${s.id}`}>
                      {s.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search widgets..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              data-testid="input-search-widgets"
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setActiveCategory("All")}
              className={`px-2.5 py-1 text-xs font-medium rounded-full border transition-colors ${
                activeCategory === "All"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted/50 text-muted-foreground border-border hover:bg-muted"
              }`}
              data-testid="filter-category-all"
            >
              All ({availableWidgets.length})
            </button>
            {CATEGORY_ORDER.filter((cat) => categoryCounts[cat]).map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-2.5 py-1 text-xs font-medium rounded-full border transition-colors ${
                  activeCategory === cat
                    ? "bg-primary text-primary-foreground border-primary"
                    : `${CATEGORY_COLORS[cat]} hover:opacity-80`
                }`}
                data-testid={`filter-category-${cat.toLowerCase()}`}
              >
                {cat} ({categoryCounts[cat]})
              </button>
            ))}
          </div>
        </div>

        <ScrollArea className="h-[calc(100vh-300px)] mt-3">
          <div className="space-y-4 pr-4">
            {groupedWidgets.map(({ category, widgets }) => (
              <div key={category}>
                {activeCategory === "All" && (
                  <div className="flex items-center gap-2 mb-2 sticky top-0 bg-background/95 backdrop-blur-sm py-1 z-10">
                    <Badge variant="outline" className={`text-[10px] ${CATEGORY_COLORS[category]}`}>
                      {category}
                    </Badge>
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-[10px] text-muted-foreground">{widgets.length}</span>
                  </div>
                )}
                <div className="space-y-2">
                  {widgets.map((widget) => {
                    const isAdded =
                      widget.singleton && existingWidgetTypes.has(widget.type);
                    const Icon = widget.icon;

                    return (
                      <div
                        key={widget.type}
                        className={`p-3 border rounded-lg transition-colors ${
                          isAdded
                            ? "bg-muted/50 border-muted"
                            : "hover:border-primary/50 hover:bg-primary/5"
                        }`}
                        data-testid={`widget-library-item-${widget.type}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3 flex-1 min-w-0">
                            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                              <Icon className="w-4 h-4 text-primary" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="font-medium text-sm">{widget.label}</p>
                                {widget.roleGate && (
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] px-1"
                                  >
                                    {widget.roleGate === "management"
                                      ? "Mgmt"
                                      : widget.roleGate === "superintendent"
                                        ? "Supt"
                                        : widget.roleGate}
                                  </Badge>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {widget.description}
                              </p>
                              <div className="flex items-center gap-2 mt-1">
                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                  {getSizeLabel(widget.defaultW)}
                                </Badge>
                                {widget.hasSettings && (
                                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                    Configurable
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </div>
                          <Button
                            variant={isAdded ? "secondary" : "default"}
                            size="sm"
                            disabled={isAdded}
                            onClick={() => handleAddWidget(widget)}
                            data-testid={`button-add-widget-${widget.type}`}
                          >
                            {isAdded ? (
                              <>
                                <Check className="w-4 h-4 mr-1" />
                                Added
                              </>
                            ) : (
                              <>
                                <Plus className="w-4 h-4 mr-1" />
                                Add
                              </>
                            )}
                          </Button>
                        </div>
                        <WidgetPreview widget={widget} />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {filteredWidgets.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <p className="text-sm">No widgets match your search</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
