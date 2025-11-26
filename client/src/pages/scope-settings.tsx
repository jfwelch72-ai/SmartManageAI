import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Settings, Layers, Tag, ArrowLeft } from "lucide-react";
import { Link } from "wouter";

interface WorkTypeCategory {
  id: string;
  name: string;
  displayOrder: number;
  isActive: boolean;
  workTypes: WorkType[];
}

interface WorkType {
  id: string;
  categoryId: string;
  name: string;
  code: string;
  defaultUnit: string;
  requiresDimensions: boolean;
  dimensionType: string | null;
  displayOrder: number;
  isCustom: boolean;
  isActive: boolean;
}

interface ModifierCategory {
  id: string;
  name: string;
  displayOrder: number;
  isActive: boolean;
  modifiers: Modifier[];
}

interface Modifier {
  id: string;
  categoryId: string;
  name: string;
  code: string;
  displayOrder: number;
  isCustom: boolean;
  isActive: boolean;
}

export default function ScopeSettings() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("work-types");
  const [showWorkTypeDialog, setShowWorkTypeDialog] = useState(false);
  const [showModifierDialog, setShowModifierDialog] = useState(false);
  const [editingWorkType, setEditingWorkType] = useState<WorkType | null>(null);
  const [editingModifier, setEditingModifier] = useState<Modifier | null>(null);

  const [workTypeForm, setWorkTypeForm] = useState({
    categoryId: "",
    name: "",
    code: "",
    defaultUnit: "SF",
    requiresDimensions: false,
    dimensionType: "",
    displayOrder: 100
  });

  const [modifierForm, setModifierForm] = useState({
    categoryId: "",
    name: "",
    code: "",
    displayOrder: 100
  });

  const { data: workTypeCategories = [], isLoading: loadingWorkTypes } = useQuery<WorkTypeCategory[]>({
    queryKey: ["/api/scope/work-types"]
  });

  const { data: modifierCategories = [], isLoading: loadingModifiers } = useQuery<ModifierCategory[]>({
    queryKey: ["/api/scope/modifiers"]
  });

  const createWorkTypeMutation = useMutation({
    mutationFn: async (data: typeof workTypeForm) => {
      return await apiRequest("POST", "/api/scope/work-types", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scope/work-types"] });
      toast({ title: "Work type created successfully" });
      setShowWorkTypeDialog(false);
      resetWorkTypeForm();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to create work type", variant: "destructive" });
    }
  });

  const updateWorkTypeMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: string } & Partial<WorkType>) => {
      return await apiRequest("PUT", `/api/scope/work-types/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scope/work-types"] });
      toast({ title: "Work type updated successfully" });
      setShowWorkTypeDialog(false);
      setEditingWorkType(null);
      resetWorkTypeForm();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update work type", variant: "destructive" });
    }
  });

  const deleteWorkTypeMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/scope/work-types/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scope/work-types"] });
      toast({ title: "Work type deleted successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to delete work type", variant: "destructive" });
    }
  });

  const createModifierMutation = useMutation({
    mutationFn: async (data: typeof modifierForm) => {
      return await apiRequest("POST", "/api/scope/modifiers", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scope/modifiers"] });
      toast({ title: "Modifier created successfully" });
      setShowModifierDialog(false);
      resetModifierForm();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to create modifier", variant: "destructive" });
    }
  });

  const updateModifierMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: string } & Partial<Modifier>) => {
      return await apiRequest("PUT", `/api/scope/modifiers/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scope/modifiers"] });
      toast({ title: "Modifier updated successfully" });
      setShowModifierDialog(false);
      setEditingModifier(null);
      resetModifierForm();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update modifier", variant: "destructive" });
    }
  });

  const deleteModifierMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/scope/modifiers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scope/modifiers"] });
      toast({ title: "Modifier deleted successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to delete modifier", variant: "destructive" });
    }
  });

  const resetWorkTypeForm = () => {
    setWorkTypeForm({
      categoryId: "",
      name: "",
      code: "",
      defaultUnit: "SF",
      requiresDimensions: false,
      dimensionType: "",
      displayOrder: 100
    });
  };

  const resetModifierForm = () => {
    setModifierForm({
      categoryId: "",
      name: "",
      code: "",
      displayOrder: 100
    });
  };

  const handleEditWorkType = (workType: WorkType) => {
    setEditingWorkType(workType);
    setWorkTypeForm({
      categoryId: workType.categoryId,
      name: workType.name,
      code: workType.code,
      defaultUnit: workType.defaultUnit,
      requiresDimensions: workType.requiresDimensions,
      dimensionType: workType.dimensionType || "",
      displayOrder: workType.displayOrder
    });
    setShowWorkTypeDialog(true);
  };

  const handleEditModifier = (modifier: Modifier) => {
    setEditingModifier(modifier);
    setModifierForm({
      categoryId: modifier.categoryId,
      name: modifier.name,
      code: modifier.code,
      displayOrder: modifier.displayOrder
    });
    setShowModifierDialog(true);
  };

  const handleSaveWorkType = () => {
    if (editingWorkType) {
      updateWorkTypeMutation.mutate({ id: editingWorkType.id, ...workTypeForm });
    } else {
      createWorkTypeMutation.mutate(workTypeForm);
    }
  };

  const handleSaveModifier = () => {
    if (editingModifier) {
      updateModifierMutation.mutate({ id: editingModifier.id, ...modifierForm });
    } else {
      createModifierMutation.mutate(modifierForm);
    }
  };

  const unitOptions = ["SF", "LF", "SY", "CY", "EA", "TON", "LS"];
  const dimensionTypeOptions = ["", "length_width_depth", "length_height_thickness"];

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Link href="/projects">
            <Button variant="ghost" size="icon" data-testid="button-back">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Settings className="h-6 w-6" />
              Scope Standardization Settings
            </h1>
            <p className="text-sm text-muted-foreground">
              Manage standardized work types and modifiers for consistent scope tracking
            </p>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-6">
          <TabsTrigger value="work-types" className="flex items-center gap-2" data-testid="tab-work-types">
            <Layers className="h-4 w-4" />
            Work Types
          </TabsTrigger>
          <TabsTrigger value="modifiers" className="flex items-center gap-2" data-testid="tab-modifiers">
            <Tag className="h-4 w-4" />
            Modifiers
          </TabsTrigger>
        </TabsList>

        <TabsContent value="work-types">
          <div className="flex justify-end mb-4">
            <Button
              onClick={() => {
                resetWorkTypeForm();
                setEditingWorkType(null);
                setShowWorkTypeDialog(true);
              }}
              data-testid="button-add-work-type"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Work Type
            </Button>
          </div>

          {loadingWorkTypes ? (
            <div className="text-center py-8">Loading work types...</div>
          ) : (
            <div className="space-y-4">
              {workTypeCategories.map((category) => (
                <Card key={category.id}>
                  <CardHeader className="py-3">
                    <CardTitle className="text-lg">{category.name}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {category.workTypes.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No work types in this category</p>
                    ) : (
                      <div className="grid gap-2">
                        {category.workTypes.map((workType) => (
                          <div
                            key={workType.id}
                            className="flex items-center justify-between p-3 rounded-lg border bg-muted/30"
                            data-testid={`work-type-item-${workType.id}`}
                          >
                            <div className="flex items-center gap-3">
                              <span className="font-medium">{workType.name}</span>
                              <Badge variant="outline">{workType.defaultUnit}</Badge>
                              {workType.requiresDimensions && (
                                <Badge variant="secondary">Dimensions Required</Badge>
                              )}
                              {workType.isCustom && (
                                <Badge>Custom</Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleEditWorkType(workType)}
                                data-testid={`button-edit-work-type-${workType.id}`}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              {workType.isCustom && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => deleteWorkTypeMutation.mutate(workType.id)}
                                  data-testid={`button-delete-work-type-${workType.id}`}
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="modifiers">
          <div className="flex justify-end mb-4">
            <Button
              onClick={() => {
                resetModifierForm();
                setEditingModifier(null);
                setShowModifierDialog(true);
              }}
              data-testid="button-add-modifier"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Modifier
            </Button>
          </div>

          {loadingModifiers ? (
            <div className="text-center py-8">Loading modifiers...</div>
          ) : (
            <div className="space-y-4">
              {modifierCategories.map((category) => (
                <Card key={category.id}>
                  <CardHeader className="py-3">
                    <CardTitle className="text-lg">{category.name}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {category.modifiers.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No modifiers in this category</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {category.modifiers.map((modifier) => (
                          <div
                            key={modifier.id}
                            className="flex items-center gap-2 p-2 rounded-lg border bg-muted/30"
                            data-testid={`modifier-item-${modifier.id}`}
                          >
                            <span>{modifier.name}</span>
                            {modifier.isCustom && (
                              <Badge variant="secondary" className="text-xs">Custom</Badge>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => handleEditModifier(modifier)}
                              data-testid={`button-edit-modifier-${modifier.id}`}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                            {modifier.isCustom && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => deleteModifierMutation.mutate(modifier.id)}
                                data-testid={`button-delete-modifier-${modifier.id}`}
                              >
                                <Trash2 className="h-3 w-3 text-destructive" />
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={showWorkTypeDialog} onOpenChange={setShowWorkTypeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingWorkType ? "Edit Work Type" : "Add New Work Type"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Category</Label>
              <Select
                value={workTypeForm.categoryId}
                onValueChange={(value) => setWorkTypeForm({ ...workTypeForm, categoryId: value })}
              >
                <SelectTrigger data-testid="select-work-type-category">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {workTypeCategories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Name</Label>
              <Input
                value={workTypeForm.name}
                onChange={(e) => setWorkTypeForm({ ...workTypeForm, name: e.target.value })}
                placeholder="e.g., 6 inch Sidewalk"
                data-testid="input-work-type-name"
              />
            </div>
            <div>
              <Label>Code (unique identifier)</Label>
              <Input
                value={workTypeForm.code}
                onChange={(e) => setWorkTypeForm({ ...workTypeForm, code: e.target.value.toLowerCase().replace(/\s+/g, "_") })}
                placeholder="e.g., sidewalk_6in"
                data-testid="input-work-type-code"
              />
            </div>
            <div>
              <Label>Default Unit</Label>
              <Select
                value={workTypeForm.defaultUnit}
                onValueChange={(value) => setWorkTypeForm({ ...workTypeForm, defaultUnit: value })}
              >
                <SelectTrigger data-testid="select-work-type-unit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {unitOptions.map((unit) => (
                    <SelectItem key={unit} value={unit}>
                      {unit}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={workTypeForm.requiresDimensions}
                onCheckedChange={(checked) => setWorkTypeForm({ ...workTypeForm, requiresDimensions: checked })}
                data-testid="switch-requires-dimensions"
              />
              <Label>Requires Dimension Inputs</Label>
            </div>
            {workTypeForm.requiresDimensions && (
              <div>
                <Label>Dimension Type</Label>
                <Select
                  value={workTypeForm.dimensionType}
                  onValueChange={(value) => setWorkTypeForm({ ...workTypeForm, dimensionType: value })}
                >
                  <SelectTrigger data-testid="select-dimension-type">
                    <SelectValue placeholder="Select dimension type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="length_width_depth">Length x Width x Depth (Footings)</SelectItem>
                    <SelectItem value="length_height_thickness">Length x Height x Thickness (Walls)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>Display Order</Label>
              <Input
                type="number"
                value={workTypeForm.displayOrder}
                onChange={(e) => setWorkTypeForm({ ...workTypeForm, displayOrder: parseInt(e.target.value) || 100 })}
                data-testid="input-work-type-order"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowWorkTypeDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveWorkType}
              disabled={!workTypeForm.categoryId || !workTypeForm.name || !workTypeForm.code}
              data-testid="button-save-work-type"
            >
              {editingWorkType ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showModifierDialog} onOpenChange={setShowModifierDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingModifier ? "Edit Modifier" : "Add New Modifier"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Category</Label>
              <Select
                value={modifierForm.categoryId}
                onValueChange={(value) => setModifierForm({ ...modifierForm, categoryId: value })}
              >
                <SelectTrigger data-testid="select-modifier-category">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {modifierCategories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Name</Label>
              <Input
                value={modifierForm.name}
                onChange={(e) => setModifierForm({ ...modifierForm, name: e.target.value })}
                placeholder="e.g., Fiber Mesh"
                data-testid="input-modifier-name"
              />
            </div>
            <div>
              <Label>Code (unique identifier)</Label>
              <Input
                value={modifierForm.code}
                onChange={(e) => setModifierForm({ ...modifierForm, code: e.target.value.toLowerCase().replace(/\s+/g, "_") })}
                placeholder="e.g., fiber_mesh"
                data-testid="input-modifier-code"
              />
            </div>
            <div>
              <Label>Display Order</Label>
              <Input
                type="number"
                value={modifierForm.displayOrder}
                onChange={(e) => setModifierForm({ ...modifierForm, displayOrder: parseInt(e.target.value) || 100 })}
                data-testid="input-modifier-order"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowModifierDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveModifier}
              disabled={!modifierForm.categoryId || !modifierForm.name || !modifierForm.code}
              data-testid="button-save-modifier"
            >
              {editingModifier ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
