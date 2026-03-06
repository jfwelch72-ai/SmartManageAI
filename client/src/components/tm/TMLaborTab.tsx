import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2 } from "lucide-react";

export interface LaborEntry {
  employeeName: string;
  position: string;
  crewName: string;
  regularHours: string;
  overtimeHours: string;
  rate: string;
  overtimeRate: string;
}

export const emptyLaborEntry = (): LaborEntry => ({
  employeeName: "",
  position: "",
  crewName: "",
  regularHours: "0",
  overtimeHours: "0",
  rate: "0",
  overtimeRate: "0",
});

interface TMLaborTabProps {
  entries: LaborEntry[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  onUpdate: (index: number, field: keyof LaborEntry, value: string) => void;
}

export default function TMLaborTab({ entries, onAdd, onRemove, onUpdate }: TMLaborTabProps) {
  return (
    <div className="space-y-3">
      {entries.map((entry, index) => (
        <Card key={index} className="p-3">
          <div className="grid grid-cols-4 gap-2 mb-2">
            <div className="col-span-2">
              <Label className="text-xs">Employee Name</Label>
              <Input
                value={entry.employeeName}
                onChange={(e) => onUpdate(index, "employeeName", e.target.value)}
                placeholder="Name"
                data-testid={`input-labor-name-${index}`}
              />
            </div>
            <div>
              <Label className="text-xs">Position</Label>
              <Input
                value={entry.position}
                onChange={(e) => onUpdate(index, "position", e.target.value)}
                placeholder="Position"
                data-testid={`input-labor-position-${index}`}
              />
            </div>
            <div>
              <Label className="text-xs">Crew</Label>
              <Input
                value={entry.crewName}
                onChange={(e) => onUpdate(index, "crewName", e.target.value)}
                placeholder="Crew"
                data-testid={`input-labor-crew-${index}`}
              />
            </div>
          </div>
          <div className="grid grid-cols-5 gap-2">
            <div>
              <Label className="text-xs">Reg Hours</Label>
              <Input
                type="number"
                step="0.5"
                value={entry.regularHours}
                onChange={(e) => onUpdate(index, "regularHours", e.target.value)}
                data-testid={`input-labor-reg-hours-${index}`}
              />
            </div>
            <div>
              <Label className="text-xs">OT Hours</Label>
              <Input
                type="number"
                step="0.5"
                value={entry.overtimeHours}
                onChange={(e) => onUpdate(index, "overtimeHours", e.target.value)}
                data-testid={`input-labor-ot-hours-${index}`}
              />
            </div>
            <div>
              <Label className="text-xs">Reg Rate</Label>
              <Input
                type="number"
                step="0.01"
                value={entry.rate}
                onChange={(e) => onUpdate(index, "rate", e.target.value)}
                data-testid={`input-labor-rate-${index}`}
              />
            </div>
            <div>
              <Label className="text-xs">OT Rate</Label>
              <Input
                type="number"
                step="0.01"
                value={entry.overtimeRate}
                onChange={(e) => onUpdate(index, "overtimeRate", e.target.value)}
                data-testid={`input-labor-ot-rate-${index}`}
              />
            </div>
            <div className="flex items-end">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onRemove(index)}
                disabled={entries.length === 1}
                data-testid={`button-remove-labor-${index}`}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </Card>
      ))}
      <Button variant="outline" size="sm" onClick={onAdd} data-testid="button-add-labor">
        <Plus className="w-4 h-4 mr-2" />
        Add Labor Entry
      </Button>
    </div>
  );
}
