import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Plus, Trash2, ChevronsUpDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface LaborEntry {
  employeeName: string;
  position: string;
  crewName: string;
  regularHours: string;
  overtimeHours: string;
  rate: string;
  overtimeRate: string;
  employeeId?: string;
}

export const emptyLaborEntry = (): LaborEntry => ({
  employeeName: "",
  position: "",
  crewName: "",
  regularHours: "0",
  overtimeHours: "0",
  rate: "0",
  overtimeRate: "0",
  employeeId: "",
});

interface TMLaborTabProps {
  entries: LaborEntry[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  onUpdate: (index: number, field: keyof LaborEntry, value: string) => void;
  onSelectEmployee?: (index: number, employee: EmployeeOption) => void;
}

interface EmployeeOption {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  costRateRegular?: string | null;
  costRateOvertime?: string | null;
  tradeSpecialization?: string | null;
  crewName?: string;
}

function EmployeeCombobox({
  value,
  employees,
  onSelect,
  index,
}: {
  value: string;
  employees: EmployeeOption[];
  onSelect: (emp: EmployeeOption) => void;
  index: number;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search) return employees;
    const lower = search.toLowerCase();
    return employees.filter(
      (e) =>
        `${e.firstName} ${e.lastName}`.toLowerCase().includes(lower) ||
        e.role?.toLowerCase().includes(lower) ||
        e.tradeSpecialization?.toLowerCase().includes(lower)
    );
  }, [employees, search]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal h-9 text-sm"
          data-testid={`combobox-labor-employee-${index}`}
        >
          <span className="truncate">{value || "Select employee..."}</span>
          <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search employees..."
            value={search}
            onValueChange={setSearch}
            data-testid={`input-search-employee-${index}`}
          />
          <CommandList>
            <CommandEmpty>No employee found.</CommandEmpty>
            <CommandGroup>
              {filtered.map((emp) => {
                const fullName = `${emp.firstName} ${emp.lastName}`;
                const isSelected = value === fullName;
                return (
                  <CommandItem
                    key={emp.id}
                    value={emp.id}
                    onSelect={() => {
                      onSelect(emp);
                      setOpen(false);
                      setSearch("");
                    }}
                    data-testid={`option-employee-${emp.id}`}
                  >
                    <Check className={cn("mr-2 h-4 w-4", isSelected ? "opacity-100" : "opacity-0")} />
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">{fullName}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatRole(emp.role)}
                        {emp.tradeSpecialization ? ` · ${formatTrade(emp.tradeSpecialization)}` : ""}
                        {emp.costRateRegular && parseFloat(emp.costRateRegular) > 0 ? ` · $${emp.costRateRegular}/hr` : ""}
                      </span>
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function formatRole(role: string): string {
  return role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatTrade(trade: string): string {
  return trade.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function TMLaborTab({ entries, onAdd, onRemove, onUpdate, onSelectEmployee }: TMLaborTabProps) {
  const { data: usersData } = useQuery<EmployeeOption[]>({
    queryKey: ["/api/users"],
  });

  const employees = useMemo(() => {
    if (!usersData) return [];
    return usersData.map((u) => ({ ...u, crewName: "" }));
  }, [usersData]);

  const handleSelectEmployee = (index: number, emp: EmployeeOption) => {
    const fullName = `${emp.firstName} ${emp.lastName}`;
    onUpdate(index, "employeeName", fullName);
    onUpdate(index, "position", formatRole(emp.role));
    onUpdate(index, "crewName", emp.crewName || "");
    if (emp.costRateRegular && parseFloat(emp.costRateRegular) > 0) {
      onUpdate(index, "rate", emp.costRateRegular);
    }
    if (emp.costRateOvertime && parseFloat(emp.costRateOvertime) > 0) {
      onUpdate(index, "overtimeRate", emp.costRateOvertime);
    }
    if (onSelectEmployee) {
      onSelectEmployee(index, emp);
    }
  };

  return (
    <div className="space-y-3">
      {entries.map((entry, index) => (
        <Card key={index} className="p-3">
          <div className="grid grid-cols-4 gap-2 mb-2">
            <div className="col-span-2">
              <Label className="text-xs">Employee Name</Label>
              <EmployeeCombobox
                value={entry.employeeName}
                employees={employees}
                onSelect={(emp) => handleSelectEmployee(index, emp)}
                index={index}
              />
            </div>
            <div>
              <Label className="text-xs">Position</Label>
              <Input
                value={entry.position}
                onChange={(e) => onUpdate(index, "position", e.target.value)}
                placeholder="Auto-filled on select"
                data-testid={`input-labor-position-${index}`}
              />
            </div>
            <div>
              <Label className="text-xs">Crew</Label>
              <Input
                value={entry.crewName}
                onChange={(e) => onUpdate(index, "crewName", e.target.value)}
                placeholder="Enter crew name"
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
