import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, Edit2, MapPin, Building2, Layers, DoorOpen, Grid3x3, ChevronRight, ChevronDown } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ProjectLocation {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
  level: "BUILDING" | "FLOOR" | "ROOM" | "ZONE";
  sortOrder: number;
  description: string | null;
}

const LEVEL_ICONS: Record<string, any> = {
  BUILDING: Building2,
  FLOOR: Layers,
  ROOM: DoorOpen,
  ZONE: Grid3x3,
};

const LEVEL_COLORS: Record<string, string> = {
  BUILDING: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  FLOOR: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  ROOM: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  ZONE: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
};

const CHILD_LEVELS: Record<string, string[]> = {
  BUILDING: ["FLOOR", "ROOM", "ZONE"],
  FLOOR: ["ROOM", "ZONE"],
  ROOM: ["ZONE"],
  ZONE: [],
};

function buildTree(locations: ProjectLocation[]): (ProjectLocation & { children: any[] })[] {
  const map = new Map<string, ProjectLocation & { children: any[] }>();
  const roots: (ProjectLocation & { children: any[] })[] = [];

  for (const loc of locations) {
    map.set(loc.id, { ...loc, children: [] });
  }

  for (const loc of locations) {
    const node = map.get(loc.id)!;
    if (loc.parentId && map.has(loc.parentId)) {
      map.get(loc.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

function LocationNode({
  node,
  depth,
  onEdit,
  onDelete,
  onAddChild,
  expandedIds,
  toggleExpand,
}: {
  node: ProjectLocation & { children: any[] };
  depth: number;
  onEdit: (loc: ProjectLocation) => void;
  onDelete: (id: string) => void;
  onAddChild: (parentId: string, parentLevel: string) => void;
  expandedIds: Set<string>;
  toggleExpand: (id: string) => void;
}) {
  const Icon = LEVEL_ICONS[node.level] || MapPin;
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedIds.has(node.id);
  const canAddChild = CHILD_LEVELS[node.level]?.length > 0;

  return (
    <div data-testid={`location-node-${node.id}`}>
      <div
        className={`flex items-center gap-2 py-2 px-3 rounded-md hover:bg-muted/50 group ${depth > 0 ? "ml-6" : ""}`}
        style={{ marginLeft: `${depth * 24}px` }}
      >
        {hasChildren ? (
          <button onClick={() => toggleExpand(node.id)} className="w-5 h-5 flex items-center justify-center" data-testid={`button-toggle-${node.id}`}>
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        ) : (
          <span className="w-5" />
        )}
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium text-sm flex-1">{node.name}</span>
        <Badge variant="outline" className={`text-xs ${LEVEL_COLORS[node.level]}`}>
          {node.level}
        </Badge>
        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity">
          {canAddChild && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onAddChild(node.id, node.level)} data-testid={`button-add-child-${node.id}`}>
              <Plus className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(node)} data-testid={`button-edit-location-${node.id}`}>
            <Edit2 className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => onDelete(node.id)} data-testid={`button-delete-location-${node.id}`}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {isExpanded && node.children.map((child: any) => (
        <LocationNode
          key={child.id}
          node={child}
          depth={depth + 1}
          onEdit={onEdit}
          onDelete={onDelete}
          onAddChild={onAddChild}
          expandedIds={expandedIds}
          toggleExpand={toggleExpand}
        />
      ))}
    </div>
  );
}

export default function LocationManagerTab({ projectId, projectCode, userRole }: { projectId: string; projectCode: string; userRole: string }) {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<ProjectLocation | null>(null);
  const [formName, setFormName] = useState("");
  const [formLevel, setFormLevel] = useState<string>("BUILDING");
  const [formParentId, setFormParentId] = useState<string | null>(null);
  const [formDescription, setFormDescription] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const { data: locations = [], isLoading } = useQuery<ProjectLocation[]>({
    queryKey: ["/api/projects", projectId, "locations"],
    enabled: !!projectId,
  });

  const tree = buildTree(locations);

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/locations`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "locations"] });
      setDialogOpen(false);
      resetForm();
      toast({ title: "Location created" });
    },
    onError: () => toast({ title: "Failed to create location", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const res = await apiRequest("PATCH", `/api/projects/${projectId}/locations/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "locations"] });
      setDialogOpen(false);
      resetForm();
      toast({ title: "Location updated" });
    },
    onError: () => toast({ title: "Failed to update location", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/projects/${projectId}/locations/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "locations"] });
      toast({ title: "Location deleted" });
    },
    onError: () => toast({ title: "Failed to delete location", variant: "destructive" }),
  });

  const resetForm = () => {
    setFormName("");
    setFormLevel("BUILDING");
    setFormParentId(null);
    setFormDescription("");
    setEditingLocation(null);
  };

  const openAddDialog = (parentId?: string, parentLevel?: string) => {
    resetForm();
    if (parentId) {
      setFormParentId(parentId);
      const childLevels = CHILD_LEVELS[parentLevel || "BUILDING"];
      if (childLevels.length > 0) setFormLevel(childLevels[0]);
    }
    setDialogOpen(true);
  };

  const openEditDialog = (loc: ProjectLocation) => {
    setEditingLocation(loc);
    setFormName(loc.name);
    setFormLevel(loc.level);
    setFormParentId(loc.parentId);
    setFormDescription(loc.description || "");
    setDialogOpen(true);
  };

  const handleSave = () => {
    if (!formName.trim()) return;
    const data = {
      name: formName.trim(),
      level: formLevel,
      parentId: formParentId,
      description: formDescription || null,
    };
    if (editingLocation) {
      updateMutation.mutate({ id: editingLocation.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const expandAll = () => {
    setExpandedIds(new Set(locations.map(l => l.id)));
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-12 text-muted-foreground" data-testid="locations-loading">Loading locations...</div>;
  }

  return (
    <div className="space-y-4" data-testid="location-manager-tab">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                Location Hierarchy
              </CardTitle>
              <CardDescription>
                Organize project takeoff by Building, Floor, Room, and Zone
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {locations.length > 0 && (
                <Button variant="outline" size="sm" onClick={expandAll} data-testid="button-expand-all-locations">
                  Expand All
                </Button>
              )}
              <Button onClick={() => openAddDialog()} data-testid="button-add-location">
                <Plus className="h-4 w-4 mr-1" />
                Add Location
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {locations.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground" data-testid="locations-empty">
              <MapPin className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="font-medium text-lg mb-1">No Locations Set Up</p>
              <p className="text-sm mb-4">Create a location hierarchy to organize takeoff measurements by Building, Floor, Room, or Zone.</p>
              <Button onClick={() => openAddDialog()} data-testid="button-add-first-location">
                <Plus className="h-4 w-4 mr-1" />
                Add First Location
              </Button>
            </div>
          ) : (
            <div className="space-y-1">
              {tree.map(node => (
                <LocationNode
                  key={node.id}
                  node={node}
                  depth={0}
                  onEdit={openEditDialog}
                  onDelete={(id) => deleteMutation.mutate(id)}
                  onAddChild={openAddDialog}
                  expandedIds={expandedIds}
                  toggleExpand={toggleExpand}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={(v) => { if (!v) { setDialogOpen(false); resetForm(); } }}>
        <DialogContent data-testid="dialog-location-form">
          <DialogHeader>
            <DialogTitle>{editingLocation ? "Edit Location" : "Add Location"}</DialogTitle>
            <DialogDescription>
              {editingLocation ? "Update location details" : "Add a new location to the project hierarchy"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={formName}
                onChange={e => setFormName(e.target.value)}
                placeholder="e.g., Building A, 2nd Floor, Room 201"
                data-testid="input-location-name"
              />
            </div>
            {!editingLocation && (
              <div className="space-y-2">
                <Label>Level</Label>
                <Select value={formLevel} onValueChange={setFormLevel}>
                  <SelectTrigger data-testid="select-location-level">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(formParentId ? CHILD_LEVELS[locations.find(l => l.id === formParentId)?.level || "BUILDING"] || ["BUILDING", "FLOOR", "ROOM", "ZONE"] : ["BUILDING", "FLOOR", "ROOM", "ZONE"]).map(level => (
                      <SelectItem key={level} value={level}>{level}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {!formParentId && !editingLocation && locations.length > 0 && (
              <div className="space-y-2">
                <Label>Parent Location (Optional)</Label>
                <Select value={formParentId || "none"} onValueChange={v => setFormParentId(v === "none" ? null : v)}>
                  <SelectTrigger data-testid="select-location-parent">
                    <SelectValue placeholder="None (top level)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None (top level)</SelectItem>
                    {locations.filter(l => CHILD_LEVELS[l.level]?.length > 0).map(l => (
                      <SelectItem key={l.id} value={l.id}>{l.name} ({l.level})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label>Description (Optional)</Label>
              <Textarea
                value={formDescription}
                onChange={e => setFormDescription(e.target.value)}
                placeholder="Additional details about this location"
                rows={2}
                data-testid="input-location-description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogOpen(false); resetForm(); }} data-testid="button-cancel-location">
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!formName.trim() || createMutation.isPending || updateMutation.isPending}
              data-testid="button-save-location"
            >
              {createMutation.isPending || updateMutation.isPending ? "Saving..." : editingLocation ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
