import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import type { LibraryItem } from "@shared/schema";

const UOM_OPTIONS = [
  "LF", "SF", "CY", "SY", "EA", "GAL", "TON", "LB", "SQ", "BF",
  "CF", "HR", "DAY", "LS", "MBF", "SHEET", "ROLL", "BAG", "BOX", "BUNDLE",
];

const COST_TYPE_OPTIONS = [
  { id: "equipment", label: "Equipment" },
  { id: "labor", label: "Labor" },
  { id: "material", label: "Material" },
  { id: "subcontractor", label: "Subcontractor" },
];

interface LibraryItemInitialValues {
  name?: string;
  itemNumber?: string;
  unitOfMeasure?: string;
  costTypes?: string[];
  unitCosts?: Record<string, string>;
  notes?: string;
}

interface LibraryItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: LibraryItem | null;
  libraryId?: string;
  initialValues?: LibraryItemInitialValues;
}

export default function LibraryItemDialog({ open, onOpenChange, item, libraryId, initialValues }: LibraryItemDialogProps) {
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [itemNumber, setItemNumber] = useState("");
  const [measuredCoverage, setMeasuredCoverage] = useState("1");
  const [unitOfMeasure, setUnitOfMeasure] = useState("SF");
  const [purchaseCoverage, setPurchaseCoverage] = useState("1");
  const [purchaseUnit, setPurchaseUnit] = useState("SF");
  const [customPurchaseUnit, setCustomPurchaseUnit] = useState("");
  const [description, setDescription] = useState("");
  const [costTypes, setCostTypes] = useState<string[]>(["material"]);
  const [accountingCodes, setAccountingCodes] = useState<Record<string, string>>({});
  const [unitCosts, setUnitCosts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (item) {
      setName(item.name);
      setItemNumber(item.itemNumber || "");
      setMeasuredCoverage(String(item.measuredCoverage));
      setUnitOfMeasure(item.unitOfMeasure);
      setPurchaseCoverage(String(item.purchaseCoverage));
      setPurchaseUnit(item.purchaseUnit);
      setDescription(item.description || "");
      setCostTypes(item.costTypes || ["material"]);
      setAccountingCodes((item.accountingCodes as Record<string, string>) || {});
      setUnitCosts(
        item.unitCosts
          ? Object.fromEntries(Object.entries(item.unitCosts as Record<string, any>).map(([k, v]) => [k, String(v)]))
          : {}
      );
      setNotes(item.notes || "");
    } else if (initialValues) {
      setName(initialValues.name || "");
      setItemNumber(initialValues.itemNumber || "");
      setMeasuredCoverage("1");
      setUnitOfMeasure(initialValues.unitOfMeasure || "SF");
      setPurchaseCoverage("1");
      setPurchaseUnit(initialValues.unitOfMeasure || "SF");
      setCustomPurchaseUnit("");
      setDescription("");
      setCostTypes(initialValues.costTypes || ["material"]);
      setAccountingCodes({});
      setUnitCosts(initialValues.unitCosts || {});
      setNotes(initialValues.notes || "");
    } else {
      setName("");
      setItemNumber("");
      setMeasuredCoverage("1");
      setUnitOfMeasure("SF");
      setPurchaseCoverage("1");
      setPurchaseUnit("SF");
      setCustomPurchaseUnit("");
      setDescription("");
      setCostTypes(["material"]);
      setAccountingCodes({});
      setUnitCosts({});
      setNotes("");
    }
  }, [item, initialValues, open]);

  const invalidateItems = () => queryClient.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string)?.startsWith("/api/library-items") });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/library-items", data);
      return res.json();
    },
    onSuccess: () => {
      invalidateItems();
      onOpenChange(false);
      toast({ title: "Item created" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PATCH", `/api/library-items/${item!.id}`, data);
      return res.json();
    },
    onSuccess: () => {
      invalidateItems();
      onOpenChange(false);
      toast({ title: "Item updated" });
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
    const finalPurchaseUnit = purchaseUnit === "CUSTOM" ? customPurchaseUnit : purchaseUnit;
    const numericUnitCosts = Object.fromEntries(
      Object.entries(unitCosts).map(([k, v]) => [k, parseFloat(v) || 0])
    );
    const payload = {
      name: name.trim(),
      itemNumber: itemNumber.trim() || null,
      measuredCoverage: parseFloat(measuredCoverage) || 1,
      unitOfMeasure,
      purchaseCoverage: parseFloat(purchaseCoverage) || 1,
      purchaseUnit: finalPurchaseUnit || unitOfMeasure,
      description: description.trim() || null,
      costTypes,
      accountingCodes: Object.keys(accountingCodes).length > 0 ? accountingCodes : null,
      unitCosts: Object.keys(numericUnitCosts).length > 0 ? numericUnitCosts : null,
      notes: notes.trim() || null,
      libraryId: libraryId || null,
    };

    if (item) {
      updateMutation.mutate(payload);
    } else {
      createMutation.mutate(payload);
    }
  };

  const toggleCostType = (type: string) => {
    setCostTypes(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{item ? "Edit Item" : "New Item"}</DialogTitle>
          <DialogDescription>
            {item ? "Update item details and costs." : "Create a new library item with coverage rates and costs."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Item Name *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Portland Cement" data-testid="input-item-name" />
            </div>
            <div>
              <Label>Item Number</Label>
              <Input value={itemNumber} onChange={(e) => setItemNumber(e.target.value)} placeholder="e.g., MAT-001" data-testid="input-item-number" />
            </div>
            <div>
              <Label>Unit of Measure *</Label>
              <Select value={unitOfMeasure} onValueChange={setUnitOfMeasure}>
                <SelectTrigger data-testid="select-item-uom">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UOM_OPTIONS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Measured Coverage</Label>
              <Input type="number" value={measuredCoverage} onChange={(e) => setMeasuredCoverage(e.target.value)} data-testid="input-measured-coverage" />
            </div>
            <div>
              <Label>Purchase Coverage</Label>
              <Input type="number" value={purchaseCoverage} onChange={(e) => setPurchaseCoverage(e.target.value)} data-testid="input-purchase-coverage" />
            </div>
          </div>

          <div>
            <Label>Purchase Unit</Label>
            <div className="flex gap-2">
              <Select value={purchaseUnit} onValueChange={setPurchaseUnit}>
                <SelectTrigger className="flex-1" data-testid="select-purchase-unit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UOM_OPTIONS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                  <SelectItem value="CUSTOM">Custom...</SelectItem>
                </SelectContent>
              </Select>
              {purchaseUnit === "CUSTOM" && (
                <Input
                  value={customPurchaseUnit}
                  onChange={(e) => setCustomPurchaseUnit(e.target.value)}
                  placeholder="Custom unit"
                  className="w-32"
                  data-testid="input-custom-purchase-unit"
                />
              )}
            </div>
          </div>

          <div>
            <Label>Description</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value.substring(0, 255))}
              placeholder="Brief description (max 255 chars)"
              data-testid="input-item-description"
            />
            <span className="text-xs text-muted-foreground">{description.length}/255</span>
          </div>

          <Separator />

          <div>
            <Label className="mb-2 block">Cost Types</Label>
            <div className="flex flex-wrap gap-3">
              {COST_TYPE_OPTIONS.map(ct => (
                <div key={ct.id} className="flex items-center gap-1.5">
                  <Checkbox
                    id={`cost-${ct.id}`}
                    checked={costTypes.includes(ct.id)}
                    onCheckedChange={() => toggleCostType(ct.id)}
                    data-testid={`checkbox-cost-${ct.id}`}
                  />
                  <label htmlFor={`cost-${ct.id}`} className="text-sm cursor-pointer">{ct.label}</label>
                </div>
              ))}
            </div>
          </div>

          {costTypes.length > 0 && (
            <div className="space-y-2">
              {costTypes.map(ct => (
                <div key={ct} className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs capitalize">{ct} Accounting Code</Label>
                    <Input
                      value={accountingCodes[ct] || ""}
                      onChange={(e) => setAccountingCodes(prev => ({ ...prev, [ct]: e.target.value }))}
                      placeholder={`${ct} code`}
                      className="h-8 text-sm"
                      data-testid={`input-accounting-${ct}`}
                    />
                  </div>
                  <div>
                    <Label className="text-xs capitalize">{ct} Unit Cost ($)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={unitCosts[ct] || ""}
                      onChange={(e) => setUnitCosts(prev => ({ ...prev, [ct]: e.target.value }))}
                      placeholder="0.00"
                      className="h-8 text-sm"
                      data-testid={`input-unit-cost-${ct}`}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          <Separator />

          <div>
            <Label>Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional notes..."
              rows={3}
              data-testid="input-item-notes"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={isPending} data-testid="btn-save-item">
            {isPending ? "Saving..." : item ? "Update" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
