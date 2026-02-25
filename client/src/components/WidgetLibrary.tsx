import { useState } from "react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Check, Search, LayoutGrid } from "lucide-react";
import { useDashboardCustomization } from "@/hooks/use-dashboard-customization";
import {
  WIDGET_REGISTRY,
  type WidgetDefinition,
} from "@/components/dashboard-widgets/WidgetRegistry";
import { useAuth } from "@/hooks/use-auth";
import { hasManagementAccess } from "@/lib/rbac";

interface WidgetLibraryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function isWidgetAvailableForRole(
  widget: WidgetDefinition,
  userRole?: string
): boolean {
  if (!widget.roleGate) return true;
  if (widget.roleGate === "management") return hasManagementAccess(userRole);
  if (widget.roleGate === "superintendent")
    return userRole === "SUPERINTENDENT";
  return true;
}

export function WidgetLibrary({ open, onOpenChange }: WidgetLibraryProps) {
  const { user } = useAuth();
  const { localLayout, addWidget } = useDashboardCustomization();
  const [searchQuery, setSearchQuery] = useState("");

  const existingWidgetTypes = new Set(
    localLayout?.widgets?.filter((w) => w.visible).map((w) => w.type) || []
  );

  const availableWidgets = WIDGET_REGISTRY.filter((widget) =>
    isWidgetAvailableForRole(widget, user?.role)
  );

  const filteredWidgets = searchQuery
    ? availableWidgets.filter(
        (w) =>
          w.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
          w.description.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : availableWidgets;

  const handleAddWidget = (widget: WidgetDefinition) => {
    addWidget(widget.type);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[360px] sm:w-[400px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <LayoutGrid className="w-5 h-5" />
            Widget Library
          </SheetTitle>
          <SheetDescription>
            Add widgets to customize your dashboard layout
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 mb-4">
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
        </div>

        <ScrollArea className="h-[calc(100vh-200px)]">
          <div className="space-y-3 pr-4">
            {filteredWidgets.map((widget) => {
              const isAdded =
                widget.singleton && existingWidgetTypes.has(widget.type);
              const Icon = widget.icon;

              return (
                <div
                  key={widget.type}
                  className={`p-4 border rounded-lg transition-colors ${
                    isAdded
                      ? "bg-muted/50 border-muted"
                      : "hover:border-primary/50 hover:bg-primary/5"
                  }`}
                  data-testid={`widget-library-item-${widget.type}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <Icon className="w-5 h-5 text-primary" />
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
                        <p className="text-xs text-muted-foreground mt-1">
                          {widget.description}
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          Default size: {widget.defaultW}x{widget.defaultH}
                        </p>
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
                </div>
              );
            })}

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
