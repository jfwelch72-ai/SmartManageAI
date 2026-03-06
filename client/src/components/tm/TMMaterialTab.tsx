import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { Plus, Trash2, Search } from "lucide-react";

export interface MaterialEntry {
  description: string;
  quantity: string;
  unit: string;
  unitCost: string;
  category?: string;
}

export const emptyMaterialEntry = (): MaterialEntry => ({
  description: "",
  quantity: "1",
  unit: "",
  unitCost: "0",
  category: "",
});

interface VendorPricingCatalog {
  id: string;
  organizationId: string;
  organizationName?: string;
  itemName: string;
  itemCode?: string;
  category: string;
  unit: string;
  unitPrice: string;
  effectiveQuarter: string;
  leadTimeDays?: number;
  deliveryFee?: string;
}

const MATERIAL_CATEGORIES = [
  { value: "CONCRETE", label: "Concrete" },
  { value: "STONE", label: "Stone/Aggregate" },
  { value: "REBAR", label: "Rebar/Steel" },
  { value: "WIRE_MESH", label: "Wire Mesh" },
  { value: "FORMS", label: "Forms" },
  { value: "SEALERS", label: "Sealers/Cure" },
  { value: "JOINTS", label: "Joints/Caulk" },
  { value: "OTHER", label: "Other Materials" },
];

interface TMMaterialTabProps {
  entries: MaterialEntry[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  onUpdate: (index: number, field: keyof MaterialEntry, value: string) => void;
  onAddFromCatalog: (entry: MaterialEntry) => void;
}

export default function TMMaterialTab({ entries, onAdd, onRemove, onUpdate, onAddFromCatalog }: TMMaterialTabProps) {
  const { toast } = useToast();
  const [selectedMaterialCategory, setSelectedMaterialCategory] = useState<string>("");

  const { data: catalogPrices = [] } = useQuery<VendorPricingCatalog[]>({
    queryKey: ["/api/vendor-pricing/search", { category: selectedMaterialCategory }],
    enabled: !!selectedMaterialCategory,
  });

  const applyCatalogPrice = (catalogItem: VendorPricingCatalog) => {
    const newEntry: MaterialEntry = {
      description: catalogItem.itemName,
      quantity: "1",
      unit: catalogItem.unit,
      unitCost: catalogItem.unitPrice,
      category: catalogItem.category,
    };
    onAddFromCatalog(newEntry);
    toast({ title: "Catalog price applied", description: `Added ${catalogItem.itemName} at $${catalogItem.unitPrice}/${catalogItem.unit}` });
  };

  return (
    <div className="space-y-3">
      <Card className="p-4 bg-muted/30">
        <div className="flex items-center gap-2 mb-3">
          <Search className="w-4 h-4 text-muted-foreground" />
          <h4 className="text-sm font-medium">Vendor Pricing Catalog</h4>
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <Label className="text-xs">Material Category</Label>
            <Select
              value={selectedMaterialCategory}
              onValueChange={setSelectedMaterialCategory}
            >
              <SelectTrigger data-testid="select-material-category">
                <SelectValue placeholder="Select category to search catalog..." />
              </SelectTrigger>
              <SelectContent>
                {MATERIAL_CATEGORIES.map((cat) => (
                  <SelectItem key={cat.value} value={cat.value}>
                    {cat.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {selectedMaterialCategory && catalogPrices.length > 0 && (
          <div className="mt-3 border rounded-md p-3 bg-background max-h-40 overflow-y-auto">
            <p className="text-xs text-muted-foreground mb-2">
              Click to add from vendor catalog:
            </p>
            <div className="space-y-1">
              {catalogPrices.slice(0, 8).map((item) => (
                <div
                  key={item.id}
                  onClick={() => applyCatalogPrice(item)}
                  className="flex items-center justify-between p-2 hover-elevate cursor-pointer rounded text-sm"
                  data-testid={`catalog-item-${item.id}`}
                >
                  <div className="flex-1">
                    <span className="font-medium">{item.itemName}</span>
                    {item.organizationName && (
                      <span className="text-xs text-muted-foreground ml-2">
                        ({item.organizationName})
                      </span>
                    )}
                  </div>
                  <Badge variant="secondary" className="font-mono">
                    ${parseFloat(item.unitPrice).toFixed(2)}/{item.unit}
                  </Badge>
                </div>
              ))}
            </div>
            {catalogPrices.length > 8 && (
              <p className="text-xs text-muted-foreground mt-2 text-center">
                +{catalogPrices.length - 8} more items
              </p>
            )}
          </div>
        )}

        {selectedMaterialCategory && catalogPrices.length === 0 && (
          <p className="text-xs text-muted-foreground mt-2">
            No vendor pricing found for this category. Add items manually below.
          </p>
        )}
      </Card>

      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">No material entries. Select from catalog above or add manually below.</p>
      ) : (
        entries.map((entry, index) => (
          <Card key={index} className="p-3">
            <div className="grid grid-cols-5 gap-2">
              <div className="col-span-2">
                <Label className="text-xs">Description</Label>
                <Input
                  value={entry.description}
                  onChange={(e) => onUpdate(index, "description", e.target.value)}
                  placeholder="Material description"
                  data-testid={`input-material-desc-${index}`}
                />
              </div>
              <div>
                <Label className="text-xs">Quantity</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={entry.quantity}
                  onChange={(e) => onUpdate(index, "quantity", e.target.value)}
                  data-testid={`input-material-qty-${index}`}
                />
              </div>
              <div>
                <Label className="text-xs">Unit</Label>
                <Input
                  value={entry.unit}
                  onChange={(e) => onUpdate(index, "unit", e.target.value)}
                  placeholder="ea, lf, sf..."
                  data-testid={`input-material-unit-${index}`}
                />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <Label className="text-xs">Unit Cost</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={entry.unitCost}
                    onChange={(e) => onUpdate(index, "unitCost", e.target.value)}
                    data-testid={`input-material-cost-${index}`}
                  />
                </div>
                <div className="flex items-end">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onRemove(index)}
                    data-testid={`button-remove-material-${index}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        ))
      )}
      <Button variant="outline" size="sm" onClick={onAdd} data-testid="button-add-material">
        <Plus className="w-4 h-4 mr-2" />
        Add Material Manually
      </Button>
    </div>
  );
}
