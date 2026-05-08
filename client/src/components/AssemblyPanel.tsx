import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Plus,
  Trash2,
  Layers,
  Link2,
  Unlink,
  ChevronDown,
  ChevronRight,
  Loader2,
  Calculator,
} from "lucide-react";
import type { TakeoffAssembly, TakeoffAssemblyItem } from "@shared/schema";
import { FORMULA_HELP } from "@shared/utils/assemblyFormula";

interface AssemblyPanelProps {
  selectedMeasurementId: string | null;
}

interface AssemblyWithItems extends TakeoffAssembly {
  items: TakeoffAssemblyItem[];
}

interface AssemblyItemInput {
  name: string;
  unit: string;
  formula: string;
  wasteFactor: number;
  unitCost: string;
  displayOrder: number;
}

interface ComputedAssemblyResult {
  linkId: string;
  assemblyId: string;
  assemblyName: string;
  items: Array<{
    itemId: string;
    itemName: string;
    unit: string;
    formula: string;
    wasteFactor: number;
    unitCost: string | null;
    quantity: number;
    totalCost: number | null;
  }>;
}

const DEFAULT_ITEM: AssemblyItemInput = {
  name: "",
  unit: "LF",
  formula: "length",
  wasteFactor: 0,
  unitCost: "",
  displayOrder: 0,
};

export default function AssemblyPanel({ selectedMeasurementId }: AssemblyPanelProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [expandedAssemblies, setExpandedAssemblies] = useState<Set<string>>(new Set());
  const [newAssemblyName, setNewAssemblyName] = useState("");
  const [newAssemblyType, setNewAssemblyType] = useState("LINEAR");
  const [newItems, setNewItems] = useState<AssemblyItemInput[]>([{ ...DEFAULT_ITEM }]);
  const { toast } = useToast();

  const { data: assemblies = [], isLoading: assembliesLoading } = useQuery<TakeoffAssembly[]>({
    queryKey: ["/api/assemblies"],
  });

  const { data: computedQuantities = [], isLoading: quantitiesLoading } = useQuery<ComputedAssemblyResult[]>({
    queryKey: ["/api/takeoff/measurements", selectedMeasurementId, "assembly-quantities"],
    enabled: !!selectedMeasurementId,
  });

  const createAssemblyMutation = useMutation({
    mutationFn: async (body: any) => {
      const res = await apiRequest("POST", "/api/assemblies", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/assemblies"] });
      toast({ title: "Assembly Created" });
      setCreateOpen(false);
      resetForm();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create assembly", variant: "destructive" });
    },
  });

  const linkAssemblyMutation = useMutation({
    mutationFn: async (assemblyId: string) => {
      const res = await apiRequest("POST", `/api/takeoff/measurements/${selectedMeasurementId}/assemblies`, { assemblyId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/takeoff/measurements", selectedMeasurementId, "assembly-quantities"] });
      toast({ title: "Assembly Applied" });
      setLinkOpen(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to apply assembly", variant: "destructive" });
    },
  });

  const unlinkAssemblyMutation = useMutation({
    mutationFn: async (linkId: string) => {
      await apiRequest("DELETE", `/api/takeoff/measurement-assemblies/${linkId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/takeoff/measurements", selectedMeasurementId, "assembly-quantities"] });
      toast({ title: "Assembly Removed" });
    },
  });

  const deleteAssemblyMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/assemblies/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/assemblies"] });
      toast({ title: "Assembly Deleted" });
    },
  });

  const resetForm = () => {
    setNewAssemblyName("");
    setNewAssemblyType("LINEAR");
    setNewItems([{ ...DEFAULT_ITEM }]);
  };

  const handleAddItem = () => {
    setNewItems([...newItems, { ...DEFAULT_ITEM, displayOrder: newItems.length }]);
  };

  const handleRemoveItem = (index: number) => {
    if (newItems.length <= 1) return;
    setNewItems(newItems.filter((_, i) => i !== index));
  };

  const handleUpdateItem = (index: number, field: keyof AssemblyItemInput, value: any) => {
    const updated = [...newItems];
    updated[index] = { ...updated[index], [field]: value };
    setNewItems(updated);
  };

  const handleCreateAssembly = () => {
    if (!newAssemblyName.trim()) {
      toast({ title: "Error", description: "Name is required", variant: "destructive" });
      return;
    }
    const validItems = newItems.filter((i) => i.name.trim() && i.formula.trim());
    if (validItems.length === 0) {
      toast({ title: "Error", description: "At least one item with name and formula is required", variant: "destructive" });
      return;
    }
    createAssemblyMutation.mutate({
      name: newAssemblyName,
      measurementType: newAssemblyType,
      items: validItems,
    });
  };

  const toggleExpand = (id: string) => {
    const next = new Set(expandedAssemblies);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedAssemblies(next);
  };

  const alreadyLinked = new Set(computedQuantities.map((q) => q.assemblyId));

  return (
    <div className="space-y-4 min-w-0 overflow-hidden">
      <div className="flex items-center justify-between gap-2 min-w-0">
        <h3 className="font-semibold text-sm flex items-center gap-2 min-w-0 truncate">
          <Layers className="w-4 h-4 shrink-0" /> Assemblies
        </h3>
        <Button size="sm" className="shrink-0" onClick={() => setCreateOpen(true)} data-testid="button-create-assembly">
          <Plus className="w-4 h-4 mr-1" /> New
        </Button>
      </div>

      {selectedMeasurementId && (
        <>
          <div className="flex items-center justify-between gap-2 min-w-0">
            <span className="text-xs text-muted-foreground truncate">Applied to selected measurement</span>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0"
              onClick={() => setLinkOpen(true)}
              disabled={assemblies.length === 0}
              data-testid="button-apply-assembly"
            >
              <Link2 className="w-3 h-3 mr-1" /> Apply
            </Button>
          </div>

          {quantitiesLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="w-4 h-4 animate-spin" />
            </div>
          ) : computedQuantities.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-2 break-words">
              No assemblies applied. Select one to auto-calculate quantities.
            </p>
          ) : (
            <div className="space-y-3">
              {computedQuantities.map((aq) => (
                <Card key={aq.linkId}>
                  <CardContent className="pt-4 pb-3 px-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <button
                        className="flex items-center gap-1 text-sm font-medium hover:underline"
                        onClick={() => toggleExpand(aq.linkId)}
                        data-testid={`button-expand-assembly-${aq.assemblyId}`}
                      >
                        {expandedAssemblies.has(aq.linkId) ? (
                          <ChevronDown className="w-3 h-3" />
                        ) : (
                          <ChevronRight className="w-3 h-3" />
                        )}
                        {aq.assemblyName}
                      </button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        onClick={() => unlinkAssemblyMutation.mutate(aq.linkId)}
                        data-testid={`button-unlink-assembly-${aq.assemblyId}`}
                      >
                        <Unlink className="w-3 h-3" />
                      </Button>
                    </div>

                    {expandedAssemblies.has(aq.linkId) && (
                      <div className="space-y-1.5 pt-1">
                        {aq.items.map((item) => (
                          <div key={item.itemId} className="flex items-center justify-between text-xs">
                            <span className="truncate flex-1">{item.itemName}</span>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <Badge variant="outline" className="text-[10px] px-1.5">
                                {item.quantity.toFixed(2)} {item.unit}
                              </Badge>
                              {item.totalCost !== null && (
                                <span className="text-muted-foreground">
                                  ${item.totalCost.toFixed(2)}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                        <Separator />
                        <div className="flex justify-between text-xs font-medium">
                          <span>Total Cost</span>
                          <span>
                            $
                            {aq.items
                              .reduce((sum, i) => sum + (i.totalCost ?? 0), 0)
                              .toFixed(2)}
                          </span>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          <Separator />
        </>
      )}

      {/* Assembly Library */}
      <div>
        <h4 className="text-xs font-medium text-muted-foreground mb-2">Assembly Library</h4>
        {assembliesLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
        ) : assemblies.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-2 break-words">
            No assemblies yet. Create one to speed up your takeoffs.
          </p>
        ) : (
          <ScrollArea className="max-h-[200px]">
            <div className="space-y-1 pr-3">
              {assemblies.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between p-2 rounded border text-sm hover:bg-muted/50"
                  data-testid={`row-assembly-${a.id}`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Calculator className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    <span className="truncate">{a.name}</span>
                    <Badge variant="secondary" className="text-[10px]">
                      {a.measurementType}
                    </Badge>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 flex-shrink-0"
                    onClick={() => {
                      if (confirm(`Delete assembly "${a.name}"?`)) {
                        deleteAssemblyMutation.mutate(a.id);
                      }
                    }}
                    data-testid={`button-delete-assembly-${a.id}`}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* Create Assembly Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle data-testid="text-create-assembly-title">Create Assembly Template</DialogTitle>
            <DialogDescription>
              Define items with formulas that auto-calculate quantities from your measurements.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>Assembly Name</Label>
              <Input
                value={newAssemblyName}
                onChange={(e) => setNewAssemblyName(e.target.value)}
                placeholder="e.g., Interior Wall Assembly"
                data-testid="input-assembly-name"
              />
            </div>
            <div>
              <Label>Measurement Type</Label>
              <Select value={newAssemblyType} onValueChange={setNewAssemblyType}>
                <SelectTrigger data-testid="select-assembly-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LINEAR">Linear (LF)</SelectItem>
                  <SelectItem value="AREA">Area (SF)</SelectItem>
                  <SelectItem value="VOLUME">Volume (CY)</SelectItem>
                  <SelectItem value="COUNT">Count</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Separator />
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Line Items</Label>
                <Button size="sm" variant="outline" onClick={handleAddItem} data-testid="button-add-assembly-item">
                  <Plus className="w-3 h-3 mr-1" /> Add Item
                </Button>
              </div>

              {newItems.map((item, idx) => (
                <Card key={idx}>
                  <CardContent className="pt-3 pb-3 px-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">Item {idx + 1}</span>
                      {newItems.length > 1 && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-5 w-5"
                          onClick={() => handleRemoveItem(idx)}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs">Name</Label>
                        <Input
                          value={item.name}
                          onChange={(e) => handleUpdateItem(idx, "name", e.target.value)}
                          placeholder="e.g., Studs"
                          className="h-8 text-sm"
                          data-testid={`input-item-name-${idx}`}
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Unit</Label>
                        <Input
                          value={item.unit}
                          onChange={(e) => handleUpdateItem(idx, "unit", e.target.value)}
                          placeholder="LF, SF, EA"
                          className="h-8 text-sm"
                          data-testid={`input-item-unit-${idx}`}
                        />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Formula</Label>
                      <Input
                        value={item.formula}
                        onChange={(e) => handleUpdateItem(idx, "formula", e.target.value)}
                        placeholder="e.g., length / 1.333 + 1"
                        className="h-8 text-sm font-mono"
                        data-testid={`input-item-formula-${idx}`}
                      />
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        Variables: length, area, volume, count, depth
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs">Waste %</Label>
                        <Input
                          type="number"
                          value={item.wasteFactor}
                          onChange={(e) => handleUpdateItem(idx, "wasteFactor", parseFloat(e.target.value) || 0)}
                          className="h-8 text-sm"
                          data-testid={`input-item-waste-${idx}`}
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Unit Cost ($)</Label>
                        <Input
                          value={item.unitCost}
                          onChange={(e) => handleUpdateItem(idx, "unitCost", e.target.value)}
                          placeholder="0.00"
                          className="h-8 text-sm"
                          data-testid={`input-item-cost-${idx}`}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}

              <div className="bg-muted/50 rounded p-2">
                <p className="text-[10px] font-medium text-muted-foreground mb-1">Formula Examples</p>
                <div className="space-y-0.5">
                  {FORMULA_HELP.slice(0, 4).map((h) => (
                    <div key={h.example} className="flex justify-between text-[10px]">
                      <code className="font-mono text-primary">{h.example}</code>
                      <span className="text-muted-foreground">{h.desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateAssembly}
              disabled={createAssemblyMutation.isPending}
              data-testid="button-save-assembly"
            >
              {createAssemblyMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Create Assembly
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Apply Assembly Dialog */}
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle data-testid="text-apply-assembly-title">Apply Assembly</DialogTitle>
            <DialogDescription>
              Choose an assembly template to apply to the selected measurement.
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[300px]">
            <div className="space-y-2">
              {assemblies
                .filter((a) => a.isActive && !alreadyLinked.has(a.id))
                .map((a) => (
                  <Card
                    key={a.id}
                    className="cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => linkAssemblyMutation.mutate(a.id)}
                    data-testid={`button-link-assembly-${a.id}`}
                  >
                    <CardContent className="py-3 px-4 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">{a.name}</p>
                        {a.description && (
                          <p className="text-xs text-muted-foreground">{a.description}</p>
                        )}
                      </div>
                      <Badge variant="secondary" className="text-[10px]">
                        {a.measurementType}
                      </Badge>
                    </CardContent>
                  </Card>
                ))}
              {assemblies.filter((a) => a.isActive && !alreadyLinked.has(a.id)).length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No available assemblies to apply.
                </p>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
