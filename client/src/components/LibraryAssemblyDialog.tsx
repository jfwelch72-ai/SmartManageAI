import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Plus, Trash2, GripVertical, Package } from "lucide-react";
import type { LibraryItem } from "@shared/schema";

const UOM_OPTIONS = [
  "LF", "SF", "CY", "SY", "EA", "GAL", "TON", "LB", "SQ", "BF",
  "CF", "HR", "DAY", "LS", "MBF", "SHEET", "ROLL", "BAG", "BOX", "BUNDLE",
];

interface AssemblyItem {
  name: string;
  formula: string;
  wasteFactor: number;
  unitCost: string;
  unit: string;
  itemId: string | null;
}

interface AssemblyGroup {
  name: string;
  description: string;
  members: { name: string; formula: string; itemId: string | null }[];
}

interface LibraryAssemblyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assembly: any | null;
  libraryId?: string;
  allItems: LibraryItem[];
}

export default function LibraryAssemblyDialog({ open, onOpenChange, assembly, libraryId, allItems }: LibraryAssemblyDialogProps) {
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [assemblyNumber, setAssemblyNumber] = useState("");
  const [unitOfMeasure, setUnitOfMeasure] = useState("SF");
  const [description, setDescription] = useState("");
  const [items, setItems] = useState<AssemblyItem[]>([]);
  const [groups, setGroups] = useState<AssemblyGroup[]>([]);

  useEffect(() => {
    if (assembly) {
      setName(assembly.name);
      setAssemblyNumber(assembly.assemblyNumber || "");
      setUnitOfMeasure(assembly.unitOfMeasure);
      setDescription(assembly.description || "");
      setItems(
        (assembly.items || []).map((i: any) => ({
          name: i.name,
          formula: i.formula || "1",
          wasteFactor: i.wasteFactor || 0,
          unitCost: i.unitCost || "",
          unit: i.unit || "",
          itemId: i.itemId || null,
        }))
      );
      setGroups(
        (assembly.groups || []).map((g: any) => ({
          name: g.name,
          description: g.description || "",
          members: (g.members || []).map((m: any) => ({
            name: m.name,
            formula: m.formula || "1",
            itemId: m.itemId || null,
          })),
        }))
      );
    } else {
      setName("");
      setAssemblyNumber("");
      setUnitOfMeasure("SF");
      setDescription("");
      setItems([]);
      setGroups([]);
    }
  }, [assembly, open]);

  const invalidateAssemblies = () => queryClient.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string)?.startsWith("/api/library-assemblies") });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/library-assemblies", data);
      return res.json();
    },
    onSuccess: () => {
      invalidateAssemblies();
      onOpenChange(false);
      toast({ title: "Assembly created" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PATCH", `/api/library-assemblies/${assembly.id}`, data);
      return res.json();
    },
    onSuccess: () => {
      invalidateAssemblies();
      onOpenChange(false);
      toast({ title: "Assembly updated" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    if (!name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    const payload = {
      name: name.trim(),
      assemblyNumber: assemblyNumber.trim() || null,
      unitOfMeasure,
      description: description.trim() || null,
      libraryId: libraryId || null,
      items: items.map((i, idx) => ({
        name: i.name,
        formula: i.formula || "1",
        wasteFactor: i.wasteFactor || 0,
        unitCost: i.unitCost || null,
        unit: i.unit || null,
        itemId: i.itemId || null,
        displayOrder: idx,
      })),
      groups: groups.map((g, gIdx) => ({
        name: g.name,
        description: g.description || null,
        displayOrder: gIdx,
        members: g.members.map((m, mIdx) => ({
          name: m.name,
          formula: m.formula || "1",
          itemId: m.itemId || null,
          displayOrder: mIdx,
        })),
      })),
    };

    if (assembly) {
      updateMutation.mutate(payload);
    } else {
      createMutation.mutate(payload);
    }
  };

  const addItem = () => {
    setItems(prev => [...prev, { name: "", formula: "1", wasteFactor: 0, unitCost: "", unit: "", itemId: null }]);
  };

  const addItemFromLibrary = (libItem: LibraryItem) => {
    const totalCost = libItem.unitCosts
      ? Object.values(libItem.unitCosts as Record<string, number>).reduce((s, v) => s + (Number(v) || 0), 0)
      : 0;
    setItems(prev => [...prev, {
      name: libItem.name,
      formula: "1",
      wasteFactor: 0,
      unitCost: totalCost > 0 ? totalCost.toFixed(2) : "",
      unit: libItem.unitOfMeasure,
      itemId: libItem.id,
    }]);
  };

  const removeItem = (idx: number) => {
    setItems(prev => prev.filter((_, i) => i !== idx));
  };

  const updateItem = (idx: number, field: string, value: any) => {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: value } : it));
  };

  const addGroup = () => {
    setGroups(prev => [...prev, { name: "", description: "", members: [] }]);
  };

  const removeGroup = (idx: number) => {
    setGroups(prev => prev.filter((_, i) => i !== idx));
  };

  const updateGroup = (idx: number, field: string, value: any) => {
    setGroups(prev => prev.map((g, i) => i === idx ? { ...g, [field]: value } : g));
  };

  const addGroupMember = (groupIdx: number) => {
    setGroups(prev => prev.map((g, i) =>
      i === groupIdx
        ? { ...g, members: [...g.members, { name: "", formula: "1", itemId: null }] }
        : g
    ));
  };

  const removeGroupMember = (groupIdx: number, memberIdx: number) => {
    setGroups(prev => prev.map((g, i) =>
      i === groupIdx
        ? { ...g, members: g.members.filter((_, mi) => mi !== memberIdx) }
        : g
    ));
  };

  const updateGroupMember = (groupIdx: number, memberIdx: number, field: string, value: any) => {
    setGroups(prev => prev.map((g, i) =>
      i === groupIdx
        ? {
            ...g,
            members: g.members.map((m, mi) =>
              mi === memberIdx ? { ...m, [field]: value } : m
            ),
          }
        : g
    ));
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{assembly ? "Edit Assembly" : "New Assembly"}</DialogTitle>
          <DialogDescription>
            {assembly ? "Update assembly details and items." : "Create a new assembly by grouping items with formulas."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Assembly Name *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Standard Foundation" data-testid="input-assembly-name" />
            </div>
            <div>
              <Label>Assembly Number</Label>
              <Input value={assemblyNumber} onChange={(e) => setAssemblyNumber(e.target.value)} placeholder="e.g., ASM-001" data-testid="input-assembly-number" />
            </div>
            <div>
              <Label>Unit of Measure *</Label>
              <Select value={unitOfMeasure} onValueChange={setUnitOfMeasure}>
                <SelectTrigger data-testid="select-assembly-uom">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UOM_OPTIONS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Description</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value.substring(0, 255))}
              placeholder="Brief description"
              data-testid="input-assembly-description"
            />
          </div>

          <Separator />

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-sm font-medium">Required Items</Label>
              <div className="flex gap-1">
                {allItems.length > 0 && (
                  <Select onValueChange={(val) => {
                    const libItem = allItems.find(i => i.id === val);
                    if (libItem) addItemFromLibrary(libItem);
                  }}>
                    <SelectTrigger className="h-7 text-xs w-auto gap-1" data-testid="select-add-library-item">
                      <Package className="h-3 w-3" />
                      <span>From Library</span>
                    </SelectTrigger>
                    <SelectContent>
                      {allItems.map(li => (
                        <SelectItem key={li.id} value={li.id}>{li.name} ({li.unitOfMeasure})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={addItem} data-testid="btn-add-assembly-item">
                  <Plus className="h-3 w-3 mr-1" /> Manual
                </Button>
              </div>
            </div>

            {items.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-3 border border-dashed rounded">
                No items yet. Add items from your library or manually.
              </p>
            )}

            <div className="space-y-1.5">
              {items.map((item, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-1.5 items-center bg-accent/30 p-1.5 rounded text-xs">
                  <div className="col-span-4">
                    <Input
                      value={item.name}
                      onChange={(e) => updateItem(idx, "name", e.target.value)}
                      placeholder="Item name"
                      className="h-7 text-xs"
                      data-testid={`input-asm-item-name-${idx}`}
                    />
                  </div>
                  <div className="col-span-3">
                    <Input
                      value={item.formula}
                      onChange={(e) => updateItem(idx, "formula", e.target.value)}
                      placeholder="Formula (e.g., area * 1.1)"
                      className="h-7 text-xs font-mono"
                      data-testid={`input-asm-item-formula-${idx}`}
                    />
                  </div>
                  <div className="col-span-1">
                    <Input
                      value={item.unit}
                      onChange={(e) => updateItem(idx, "unit", e.target.value)}
                      placeholder="Unit"
                      className="h-7 text-xs"
                      data-testid={`input-asm-item-unit-${idx}`}
                    />
                  </div>
                  <div className="col-span-2">
                    <Input
                      value={item.wasteFactor}
                      onChange={(e) => updateItem(idx, "wasteFactor", parseFloat(e.target.value) || 0)}
                      placeholder="Waste %"
                      type="number"
                      className="h-7 text-xs"
                      data-testid={`input-asm-item-waste-${idx}`}
                    />
                  </div>
                  <div className="col-span-1">
                    <Input
                      value={item.unitCost}
                      onChange={(e) => updateItem(idx, "unitCost", e.target.value)}
                      placeholder="$"
                      type="number"
                      step="0.01"
                      className="h-7 text-xs"
                      data-testid={`input-asm-item-cost-${idx}`}
                    />
                  </div>
                  <div className="col-span-1 flex justify-center">
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeItem(idx)} data-testid={`btn-remove-asm-item-${idx}`}>
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <Separator />

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-sm font-medium">Item Groups</Label>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={addGroup} data-testid="btn-add-group">
                <Plus className="h-3 w-3 mr-1" /> Add Group
              </Button>
            </div>

            {groups.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-3 border border-dashed rounded">
                No item groups. Groups let you organize related items within this assembly.
              </p>
            )}

            <div className="space-y-3">
              {groups.map((group, gIdx) => (
                <div key={gIdx} className="border rounded p-2 space-y-2">
                  <div className="flex items-center gap-2">
                    <Input
                      value={group.name}
                      onChange={(e) => updateGroup(gIdx, "name", e.target.value)}
                      placeholder="Group name"
                      className="h-7 text-xs flex-1"
                      data-testid={`input-group-name-${gIdx}`}
                    />
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeGroup(gIdx)} data-testid={`btn-remove-group-${gIdx}`}>
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </div>
                  <div className="space-y-1">
                    {group.members.map((member, mIdx) => (
                      <div key={mIdx} className="grid grid-cols-12 gap-1 items-center text-xs">
                        <div className="col-span-5">
                          <Input
                            value={member.name}
                            onChange={(e) => updateGroupMember(gIdx, mIdx, "name", e.target.value)}
                            placeholder="Member name"
                            className="h-6 text-xs"
                            data-testid={`input-member-name-${gIdx}-${mIdx}`}
                          />
                        </div>
                        <div className="col-span-5">
                          <Input
                            value={member.formula}
                            onChange={(e) => updateGroupMember(gIdx, mIdx, "formula", e.target.value)}
                            placeholder="Formula"
                            className="h-6 text-xs font-mono"
                            data-testid={`input-member-formula-${gIdx}-${mIdx}`}
                          />
                        </div>
                        <div className="col-span-2 flex justify-center">
                          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => removeGroupMember(gIdx, mIdx)}>
                            <Trash2 className="h-2.5 w-2.5 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    ))}
                    <Button variant="ghost" size="sm" className="w-full h-6 text-xs" onClick={() => addGroupMember(gIdx)} data-testid={`btn-add-member-${gIdx}`}>
                      <Plus className="h-2.5 w-2.5 mr-1" /> Add Member
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={isPending} data-testid="btn-save-assembly">
            {isPending ? "Saving..." : assembly ? "Update" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
