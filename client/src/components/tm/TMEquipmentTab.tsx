import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2 } from "lucide-react";

export interface EquipmentEntry {
  equipmentType: string;
  description: string;
  quantity: string;
  hours: string;
  rate: string;
}

export const emptyEquipmentEntry = (): EquipmentEntry => ({
  equipmentType: "",
  description: "",
  quantity: "1",
  hours: "0",
  rate: "0",
});

interface TMEquipmentTabProps {
  entries: EquipmentEntry[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  onUpdate: (index: number, field: keyof EquipmentEntry, value: string) => void;
}

export default function TMEquipmentTab({ entries, onAdd, onRemove, onUpdate }: TMEquipmentTabProps) {
  return (
    <div className="space-y-3">
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">No equipment entries. Click below to add.</p>
      ) : (
        entries.map((entry, index) => (
          <Card key={index} className="p-3">
            <div className="grid grid-cols-6 gap-2">
              <div className="col-span-2">
                <Label className="text-xs">Equipment Type</Label>
                <Input
                  value={entry.equipmentType}
                  onChange={(e) => onUpdate(index, "equipmentType", e.target.value)}
                  placeholder="Type"
                  data-testid={`input-equipment-type-${index}`}
                />
              </div>
              <div>
                <Label className="text-xs">Qty</Label>
                <Input
                  type="number"
                  value={entry.quantity}
                  onChange={(e) => onUpdate(index, "quantity", e.target.value)}
                  data-testid={`input-equipment-qty-${index}`}
                />
              </div>
              <div>
                <Label className="text-xs">Hours</Label>
                <Input
                  type="number"
                  step="0.5"
                  value={entry.hours}
                  onChange={(e) => onUpdate(index, "hours", e.target.value)}
                  data-testid={`input-equipment-hours-${index}`}
                />
              </div>
              <div>
                <Label className="text-xs">Rate/Hr</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={entry.rate}
                  onChange={(e) => onUpdate(index, "rate", e.target.value)}
                  data-testid={`input-equipment-rate-${index}`}
                />
              </div>
              <div className="flex items-end">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onRemove(index)}
                  data-testid={`button-remove-equipment-${index}`}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
            <div className="mt-2">
              <Label className="text-xs">Description</Label>
              <Input
                value={entry.description}
                onChange={(e) => onUpdate(index, "description", e.target.value)}
                placeholder="Additional details (optional)"
                data-testid={`input-equipment-desc-${index}`}
              />
            </div>
          </Card>
        ))
      )}
      <Button variant="outline" size="sm" onClick={onAdd} data-testid="button-add-equipment">
        <Plus className="w-4 h-4 mr-2" />
        Add Equipment Entry
      </Button>
    </div>
  );
}
