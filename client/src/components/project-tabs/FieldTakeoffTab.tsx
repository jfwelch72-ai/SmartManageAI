import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  MapPin, ClipboardCheck, AlertTriangle, Camera, Check,
  ChevronDown, ChevronRight, Package, TrendingUp, Filter,
  Building2, Layers, BarChart3,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ProjectLocation {
  id: string;
  name: string;
  level: string;
  parentId: string | null;
  sortOrder: number;
}

interface FieldTakeoffItem {
  id: string;
  label: string;
  type: string;
  locationId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  plannedQuantity: number;
  installedQuantity: number;
  remainingQuantity: number;
  overrunPercent: number;
  isOverrun: boolean;
  costImpact: number;
  unitCost: number | null;
  note: string | null;
  photoUrlsList: string[];
  status: string;
}

function getProgressColor(planned: number, installed: number): string {
  if (planned <= 0) return "[&>div]:bg-gray-400";
  const pct = (installed / planned) * 100;
  if (pct > 100) return "[&>div]:bg-red-500";
  if (pct >= 90) return "[&>div]:bg-amber-500";
  if (pct >= 50) return "[&>div]:bg-blue-500";
  return "[&>div]:bg-green-500";
}

function getStatusLabel(planned: number, installed: number): string {
  if (planned <= 0) return "N/A";
  const pct = (installed / planned) * 100;
  if (pct > 100) return "Overrun";
  if (pct >= 100) return "Complete";
  if (pct > 0) return "In Progress";
  return "Not Started";
}

function getStatusBadgeVariant(planned: number, installed: number): "default" | "destructive" | "outline" | "secondary" {
  if (planned <= 0) return "outline";
  const pct = (installed / planned) * 100;
  if (pct > 100) return "destructive";
  if (pct >= 100) return "default";
  if (pct > 0) return "secondary";
  return "outline";
}

function FieldItemCard({
  item,
  onUpdateInstalled,
  onAddPhoto,
  isPending,
}: {
  item: FieldTakeoffItem;
  onUpdateInstalled: (id: string, qty: number) => void;
  onAddPhoto: (id: string) => void;
  isPending: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(String(item.installedQuantity || 0));

  const pct = item.plannedQuantity > 0 ? Math.min((item.installedQuantity / item.plannedQuantity) * 100, 150) : 0;

  const handleSave = () => {
    const val = parseFloat(editValue);
    if (!isNaN(val) && val >= 0) {
      onUpdateInstalled(item.id, val);
      setEditing(false);
    }
  };

  return (
    <div
      className={`border rounded-lg p-3 sm:p-4 space-y-2 ${item.isOverrun ? "border-red-300 bg-red-50/50 dark:border-red-800 dark:bg-red-950/20" : ""}`}
      data-testid={`field-item-${item.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-medium text-sm truncate">{item.label}</h4>
            {item.categoryName && (
              <Badge
                variant="outline"
                className="text-xs"
                style={item.categoryColor ? { borderColor: item.categoryColor, color: item.categoryColor } : undefined}
              >
                {item.categoryName}
              </Badge>
            )}
            <Badge variant={getStatusBadgeVariant(item.plannedQuantity, item.installedQuantity)} className="text-xs">
              {getStatusLabel(item.plannedQuantity, item.installedQuantity)}
            </Badge>
          </div>
          {item.note && <p className="text-xs text-muted-foreground mt-1 truncate">{item.note}</p>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onAddPhoto(item.id)} data-testid={`button-photo-${item.id}`}>
            <Camera className="h-4 w-4" />
          </Button>
          {item.photoUrlsList.length > 0 && (
            <Badge variant="secondary" className="text-xs">{item.photoUrlsList.length}</Badge>
          )}
        </div>
      </div>

      {item.isOverrun && (
        <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-950/30 rounded px-2 py-1" data-testid={`alert-overrun-${item.id}`}>
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>Overrun: +{item.overrunPercent.toFixed(1)}% → ₱{item.costImpact.toFixed(0)} impact</span>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 text-center text-sm">
        <div>
          <p className="text-xs text-muted-foreground">Planned</p>
          <p className="font-mono font-medium" data-testid={`text-planned-${item.id}`}>{item.plannedQuantity.toFixed(1)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Installed</p>
          {editing ? (
            <div className="flex items-center gap-1">
              <Input
                type="number"
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                className="h-7 text-sm text-center w-20"
                min="0"
                step="0.1"
                autoFocus
                onKeyDown={e => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setEditing(false); }}
                data-testid={`input-installed-${item.id}`}
              />
              <Button size="icon" className="h-7 w-7" onClick={handleSave} disabled={isPending} data-testid={`button-save-installed-${item.id}`}>
                <Check className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <p
              className="font-mono font-medium cursor-pointer hover:text-primary underline-offset-2 hover:underline"
              onClick={() => { setEditValue(String(item.installedQuantity || 0)); setEditing(true); }}
              data-testid={`text-installed-${item.id}`}
            >
              {item.installedQuantity.toFixed(1)}
            </p>
          )}
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Remaining</p>
          <p className={`font-mono font-medium ${item.remainingQuantity <= 0 ? "text-green-600" : ""}`} data-testid={`text-remaining-${item.id}`}>
            {item.remainingQuantity.toFixed(1)}
          </p>
        </div>
      </div>

      <Progress
        value={Math.min(pct, 100)}
        className={`h-2 ${getProgressColor(item.plannedQuantity, item.installedQuantity)}`}
      />
    </div>
  );
}

export default function FieldTakeoffTab({ projectId, projectCode }: { projectId: string; projectCode: string }) {
  const { toast } = useToast();
  const [locationFilter, setLocationFilter] = useState<string | null>(null);
  const [expandedLocations, setExpandedLocations] = useState<Set<string>>(new Set(["unassigned"]));
  const [photoDialogOpen, setPhotoDialogOpen] = useState(false);
  const [photoItemId, setPhotoItemId] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState("");
  const [activeView, setActiveView] = useState<"list" | "breakdown">("list");

  const { data: fieldData, isLoading } = useQuery<{ locations: ProjectLocation[]; items: FieldTakeoffItem[] }>({
    queryKey: ["/api/projects", projectId, "field-takeoff"],
    enabled: !!projectId,
  });

  const { data: breakdownData } = useQuery<{
    locations: ProjectLocation[];
    breakdown: Array<{
      locationId: string | null;
      locationName: string;
      locationLevel: string | null;
      totalItems: number;
      totalLengthFt: number;
      totalAreaFt2: number;
      totalVolumeCy: number;
      totalCost: number;
      plannedQuantity: number;
      installedQuantity: number;
    }>;
  }>({
    queryKey: ["/api/projects", projectId, "location-breakdown"],
    enabled: !!projectId && activeView === "breakdown",
  });

  const updateInstalledMutation = useMutation({
    mutationFn: async ({ id, qty }: { id: string; qty: number }) => {
      const res = await apiRequest("PATCH", `/api/takeoff/measurements/${id}/installed`, { installedQuantity: qty });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "field-takeoff"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "location-breakdown"] });
      if (data.overrunAlert) {
        toast({
          title: data.overrunAlert.type === "OVERRUN" ? "⚠️ Cost Overrun Alert" : "Warning",
          description: data.overrunAlert.message,
          variant: data.overrunAlert.type === "OVERRUN" ? "destructive" : "default",
        });
      } else {
        toast({ title: "Installed quantity updated" });
      }
    },
    onError: () => toast({ title: "Failed to update", variant: "destructive" }),
  });

  const addPhotoMutation = useMutation({
    mutationFn: async ({ id, url }: { id: string; url: string }) => {
      const res = await apiRequest("POST", `/api/takeoff/measurements/${id}/photos`, { photoUrl: url });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "field-takeoff"] });
      setPhotoDialogOpen(false);
      setPhotoUrl("");
      toast({ title: "Photo attached" });
    },
    onError: () => toast({ title: "Failed to attach photo", variant: "destructive" }),
  });

  const handleUpdateInstalled = (id: string, qty: number) => {
    updateInstalledMutation.mutate({ id, qty });
  };

  const handleAddPhoto = (id: string) => {
    setPhotoItemId(id);
    setPhotoDialogOpen(true);
  };

  const toggleLocation = (locId: string) => {
    setExpandedLocations(prev => {
      const next = new Set(prev);
      if (next.has(locId)) next.delete(locId); else next.add(locId);
      return next;
    });
  };

  const locations = fieldData?.locations || [];
  const allItems = fieldData?.items || [];

  const filteredItems = locationFilter
    ? allItems.filter(i => i.locationId === locationFilter)
    : allItems;

  const itemsByLocation = new Map<string, FieldTakeoffItem[]>();
  for (const item of filteredItems) {
    const key = item.locationId || "unassigned";
    if (!itemsByLocation.has(key)) itemsByLocation.set(key, []);
    itemsByLocation.get(key)!.push(item);
  }

  const totalPlanned = allItems.reduce((s, i) => s + i.plannedQuantity, 0);
  const totalInstalled = allItems.reduce((s, i) => s + i.installedQuantity, 0);
  const overrunItems = allItems.filter(i => i.isOverrun);
  const totalOverrunCost = overrunItems.reduce((s, i) => s + i.costImpact, 0);
  const overallProgress = totalPlanned > 0 ? (totalInstalled / totalPlanned) * 100 : 0;

  if (isLoading) {
    return <div className="flex items-center justify-center py-12 text-muted-foreground" data-testid="field-takeoff-loading">Loading field takeoff...</div>;
  }

  return (
    <div className="space-y-4" data-testid="field-takeoff-tab">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-1">
              <Package className="h-4 w-4 text-blue-500" />
              <p className="text-xs text-muted-foreground">Total Items</p>
            </div>
            <p className="text-lg font-bold mt-1" data-testid="text-total-items">{allItems.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-1">
              <TrendingUp className="h-4 w-4 text-green-500" />
              <p className="text-xs text-muted-foreground">Progress</p>
            </div>
            <p className="text-lg font-bold mt-1" data-testid="text-overall-progress">{overallProgress.toFixed(0)}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-1">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              <p className="text-xs text-muted-foreground">Overruns</p>
            </div>
            <p className={`text-lg font-bold mt-1 ${overrunItems.length > 0 ? "text-red-600" : ""}`} data-testid="text-overrun-count">
              {overrunItems.length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-1">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <p className="text-xs text-muted-foreground">Cost Impact</p>
            </div>
            <p className={`text-lg font-bold mt-1 ${totalOverrunCost > 0 ? "text-red-600" : ""}`} data-testid="text-cost-impact">
              ₱{totalOverrunCost.toFixed(0)}
            </p>
          </CardContent>
        </Card>
      </div>

      {overrunItems.length > 0 && (
        <Card className="border-red-300 bg-red-50/50 dark:border-red-800 dark:bg-red-950/20" data-testid="card-overrun-banner">
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-red-500 shrink-0" />
            <div>
              <p className="font-medium text-sm text-red-700 dark:text-red-300">
                {overrunItems.length} item{overrunItems.length > 1 ? "s" : ""} over planned quantity
              </p>
              <p className="text-xs text-red-600/80 dark:text-red-400/80">
                Total cost impact: ₱{totalOverrunCost.toFixed(0)}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs value={activeView} onValueChange={(v) => setActiveView(v as "list" | "breakdown")}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <TabsList>
            <TabsTrigger value="list" data-testid="tab-list-view">
              <ClipboardCheck className="h-4 w-4 mr-1" />
              Field View
            </TabsTrigger>
            <TabsTrigger value="breakdown" data-testid="tab-breakdown-view">
              <BarChart3 className="h-4 w-4 mr-1" />
              Location Breakdown
            </TabsTrigger>
          </TabsList>

          {locations.length > 0 && activeView === "list" && (
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <select
                value={locationFilter || "all"}
                onChange={e => setLocationFilter(e.target.value === "all" ? null : e.target.value)}
                className="h-8 text-sm rounded-md border bg-background px-2"
                data-testid="select-location-filter"
              >
                <option value="all">All Locations</option>
                {locations.map(l => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <TabsContent value="list" className="mt-4">
          {allItems.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <ClipboardCheck className="h-12 w-12 mb-4 opacity-50" />
                <p className="text-lg font-medium mb-1">No Takeoff Items</p>
                <p className="text-sm">Add measurements in the Plans & Takeoff tab to see them here.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {Array.from(itemsByLocation.entries()).map(([locId, items]) => {
                const location = locations.find(l => l.id === locId);
                const isExpanded = expandedLocations.has(locId);
                const locPlanned = items.reduce((s, i) => s + i.plannedQuantity, 0);
                const locInstalled = items.reduce((s, i) => s + i.installedQuantity, 0);
                const locPct = locPlanned > 0 ? (locInstalled / locPlanned) * 100 : 0;

                return (
                  <Card key={locId} data-testid={`card-location-group-${locId}`}>
                    <CardHeader
                      className="cursor-pointer py-3 px-4"
                      onClick={() => toggleLocation(locId)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          <MapPin className="h-4 w-4 text-muted-foreground" />
                          <CardTitle className="text-base">
                            {location?.name || "Unassigned"}
                          </CardTitle>
                          <Badge variant="outline" className="text-xs">{items.length}</Badge>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-2 w-32">
                            <Progress value={Math.min(locPct, 100)} className={`h-2 flex-1 ${getProgressColor(locPlanned, locInstalled)}`} />
                            <span className="text-xs font-medium w-10 text-right">{locPct.toFixed(0)}%</span>
                          </div>
                        </div>
                      </div>
                    </CardHeader>
                    {isExpanded && (
                      <CardContent className="pt-0 space-y-2">
                        {items.map(item => (
                          <FieldItemCard
                            key={item.id}
                            item={item}
                            onUpdateInstalled={handleUpdateInstalled}
                            onAddPhoto={handleAddPhoto}
                            isPending={updateInstalledMutation.isPending}
                          />
                        ))}
                      </CardContent>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="breakdown" className="mt-4">
          {!breakdownData || breakdownData.breakdown.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <BarChart3 className="h-12 w-12 mb-4 opacity-50" />
                <p className="text-lg font-medium mb-1">No Location Breakdown Data</p>
                <p className="text-sm">Assign measurements to locations to see the breakdown.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {breakdownData.breakdown.map((entry, idx) => {
                const pct = entry.plannedQuantity > 0 ? (entry.installedQuantity / entry.plannedQuantity) * 100 : 0;
                return (
                  <Card key={entry.locationId || `unassigned-${idx}`} data-testid={`breakdown-card-${entry.locationId || "unassigned"}`}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          {entry.locationLevel === "BUILDING" ? <Building2 className="h-4 w-4" /> :
                           entry.locationLevel === "FLOOR" ? <Layers className="h-4 w-4" /> :
                           <MapPin className="h-4 w-4" />}
                          <span className="font-medium">{entry.locationName}</span>
                          {entry.locationLevel && (
                            <Badge variant="outline" className="text-xs">{entry.locationLevel}</Badge>
                          )}
                          <Badge variant="secondary" className="text-xs">{entry.totalItems} items</Badge>
                        </div>
                        <span className="font-mono text-sm font-medium">₱{entry.totalCost.toFixed(0)}</span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm mb-3">
                        <div>
                          <p className="text-xs text-muted-foreground">Length (ft)</p>
                          <p className="font-mono">{entry.totalLengthFt.toFixed(1)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Area (ft²)</p>
                          <p className="font-mono">{entry.totalAreaFt2.toFixed(1)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Volume (cy)</p>
                          <p className="font-mono">{entry.totalVolumeCy.toFixed(1)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Progress</p>
                          <p className="font-mono">{pct.toFixed(0)}%</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground w-16">Installed</span>
                        <Progress value={Math.min(pct, 100)} className={`h-2 flex-1 ${getProgressColor(entry.plannedQuantity, entry.installedQuantity)}`} />
                        <span className="text-xs font-mono w-20 text-right">
                          {entry.installedQuantity.toFixed(1)} / {entry.plannedQuantity.toFixed(1)}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={photoDialogOpen} onOpenChange={setPhotoDialogOpen}>
        <DialogContent data-testid="dialog-add-photo">
          <DialogHeader>
            <DialogTitle>Attach Photo</DialogTitle>
            <DialogDescription>Enter the URL of a photo to attach to this takeoff item</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Photo URL</Label>
              <Input
                value={photoUrl}
                onChange={e => setPhotoUrl(e.target.value)}
                placeholder="https://..."
                data-testid="input-photo-url"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPhotoDialogOpen(false)} data-testid="button-cancel-photo">Cancel</Button>
            <Button
              onClick={() => photoItemId && addPhotoMutation.mutate({ id: photoItemId, url: photoUrl })}
              disabled={!photoUrl.trim() || addPhotoMutation.isPending}
              data-testid="button-save-photo"
            >
              {addPhotoMutation.isPending ? "Saving..." : "Attach Photo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
