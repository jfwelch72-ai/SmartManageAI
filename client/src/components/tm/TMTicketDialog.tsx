import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { useToast } from "@/hooks/use-toast";
import { useCreateTMTicket } from "@/hooks/use-data";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { format, parseISO } from "date-fns";
import { Users, Wrench, Package, Ruler, ListChecks, Calendar as CalendarIcon } from "lucide-react";
import StandardizedScopeSelector, { type ScopeSelectionData } from "@/components/StandardizedScopeSelector";
import type { ScopeItem } from "@shared/schema";
import { CostCodeCombobox } from "@/components/CostCodeCombobox";
import TMLaborTab, { type LaborEntry, emptyLaborEntry } from "./TMLaborTab";
import TMEquipmentTab, { type EquipmentEntry, emptyEquipmentEntry } from "./TMEquipmentTab";
import TMMaterialTab, { type MaterialEntry, emptyMaterialEntry } from "./TMMaterialTab";

interface TMTicketDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function TMTicketDialog({ projectId, open, onOpenChange }: TMTicketDialogProps) {
  const { toast } = useToast();
  const createMutation = useCreateTMTicket();

  const { data: projectScopeItems = [] } = useQuery<ScopeItem[]>({
    queryKey: ["/api/projects", projectId, "scope-items"],
    enabled: !!projectId,
  });

  const [workDate, setWorkDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [laborEntries, setLaborEntries] = useState<LaborEntry[]>([emptyLaborEntry()]);
  const [equipmentEntries, setEquipmentEntries] = useState<EquipmentEntry[]>([]);
  const [materialEntries, setMaterialEntries] = useState<MaterialEntry[]>([]);
  const [activeEntryTab, setActiveEntryTab] = useState("labor");
  const [scopeSelection, setScopeSelection] = useState<ScopeSelectionData | null>(null);
  const [scopeQuantity, setScopeQuantity] = useState("");
  const [costCode, setCostCode] = useState("");

  const resetForm = () => {
    setWorkDate(format(new Date(), "yyyy-MM-dd"));
    setDescription("");
    setLocation("");
    setLaborEntries([emptyLaborEntry()]);
    setEquipmentEntries([]);
    setMaterialEntries([]);
    setActiveEntryTab("labor");
    setScopeSelection(null);
    setScopeQuantity("");
    setCostCode("");
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) resetForm();
    onOpenChange(nextOpen);
  };

  const handleCreate = async () => {
    if (!description.trim()) {
      toast({ title: "Error", description: "Description is required", variant: "destructive" });
      return;
    }

    const validLaborEntries = laborEntries.filter(e => e.employeeName.trim() && parseFloat(e.regularHours) > 0);
    const validEquipmentEntries = equipmentEntries.filter(e => e.equipmentType.trim() && parseFloat(e.hours) > 0);
    const validMaterialEntries = materialEntries.filter(e => e.description.trim() && parseFloat(e.quantity) > 0);

    if (validLaborEntries.length === 0 && validEquipmentEntries.length === 0 && validMaterialEntries.length === 0) {
      toast({ title: "Error", description: "At least one labor, equipment, or material entry is required", variant: "destructive" });
      return;
    }

    try {
      await createMutation.mutateAsync({
        projectId,
        workDate,
        description,
        location: location || undefined,
        costCode: costCode || undefined,
        workTypeId: scopeSelection?.workTypeId || undefined,
        workTypeCode: scopeSelection?.workTypeCode || undefined,
        workTypeName: scopeSelection?.workTypeName || undefined,
        categoryName: scopeSelection?.categoryName || undefined,
        scopeModifierIds: scopeSelection ? JSON.stringify(scopeSelection.modifierIds || []) : undefined,
        scopeModifierNames: scopeSelection ? JSON.stringify(scopeSelection.modifierNames || []) : undefined,
        canonicalName: scopeSelection?.canonicalName || undefined,
        scopeUnit: scopeSelection?.unit || undefined,
        scopeQuantity: scopeQuantity || undefined,
        laborEntries: validLaborEntries.map(e => ({
          employeeName: e.employeeName,
          position: e.position || undefined,
          crewName: e.crewName || undefined,
          regularHours: e.regularHours,
          overtimeHours: e.overtimeHours || undefined,
          rate: e.rate,
          overtimeRate: e.overtimeRate || undefined,
        })),
        equipmentEntries: validEquipmentEntries.map(e => ({
          equipmentType: e.equipmentType,
          description: e.description || undefined,
          quantity: e.quantity,
          hours: e.hours,
          rate: e.rate,
        })),
        materialEntries: validMaterialEntries.map(e => ({
          description: e.description,
          quantity: e.quantity,
          unit: e.unit || undefined,
          unitCost: e.unitCost,
        })),
      });
      toast({ title: "Success", description: "T&M ticket created" });
      handleOpenChange(false);
    } catch (error) {
      toast({ title: "Error", description: "Failed to create T&M ticket", variant: "destructive" });
    }
  };

  const updateLaborEntry = (index: number, field: keyof LaborEntry, value: string) => {
    const updated = [...laborEntries];
    updated[index] = { ...updated[index], [field]: value };
    setLaborEntries(updated);
  };

  const updateEquipmentEntry = (index: number, field: keyof EquipmentEntry, value: string) => {
    const updated = [...equipmentEntries];
    updated[index] = { ...updated[index], [field]: value };
    setEquipmentEntries(updated);
  };

  const updateMaterialEntry = (index: number, field: keyof MaterialEntry, value: string) => {
    const updated = [...materialEntries];
    updated[index] = { ...updated[index], [field]: value };
    setMaterialEntries(updated);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" data-testid="dialog-create-tm-ticket">
        <DialogHeader>
          <DialogTitle>Create T&M Work Ticket</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="tm-work-date">Work Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    type="button"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !workDate && "text-muted-foreground"
                    )}
                    data-testid="input-tm-work-date"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {workDate ? format(parseISO(workDate), "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarPicker
                    mode="single"
                    selected={workDate ? parseISO(workDate) : undefined}
                    onSelect={(date) => setWorkDate(date ? format(date, "yyyy-MM-dd") : "")}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <Label htmlFor="tm-location">Location</Label>
              <Input
                id="tm-location"
                className="mt-[8px] mb-[8px]"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Work location (optional)"
                data-testid="input-tm-location"
              />
            </div>
          </div>

          <Card className="p-4 bg-muted/30">
            <div className="flex items-center gap-2 mb-3">
              <Ruler className="w-4 h-4 text-muted-foreground" />
              <Label className="text-sm font-medium">Scope of Work (for Production Rate Tracking)</Label>
            </div>

            {projectScopeItems.length > 0 && (
              <div className="space-y-2 mb-4 p-3 bg-background rounded-md border">
                <div className="flex items-center gap-2">
                  <ListChecks className="w-4 h-4 text-muted-foreground" />
                  <Label className="text-xs text-muted-foreground">Select from Project Scope Items</Label>
                </div>
                <div className="flex flex-wrap gap-2 max-h-28 overflow-y-auto">
                  {projectScopeItems.map((item) => (
                    <Button
                      key={item.id}
                      type="button"
                      variant={scopeSelection?.canonicalName === item.description ? "default" : "outline"}
                      size="sm"
                      className="text-xs h-auto py-1 px-2"
                      onClick={() => {
                        setScopeSelection({
                          workTypeId: "",
                          workTypeName: item.description,
                          workTypeCode: "",
                          categoryName: "",
                          unit: item.unit,
                          modifierIds: [],
                          modifierNames: [],
                          canonicalName: item.description,
                        });
                      }}
                      data-testid={`button-scope-item-${item.id}`}
                    >
                      {item.description} ({item.completedQuantity || 0}/{item.totalQuantity} {item.unit})
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Or use the selector below to create a new scope entry
                </p>
              </div>
            )}

            <StandardizedScopeSelector
              value={scopeSelection || undefined}
              onChange={setScopeSelection}
              showDimensionInputs={false}
            />
            {scopeSelection && (
              <div className="mt-3 grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="tm-scope-quantity">Quantity Completed</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="tm-scope-quantity"
                      type="number"
                      step="0.01"
                      value={scopeQuantity}
                      onChange={(e) => setScopeQuantity(e.target.value)}
                      placeholder="0"
                      data-testid="input-tm-scope-quantity"
                    />
                    <span className="text-sm text-muted-foreground whitespace-nowrap">{scopeSelection.unit}</span>
                  </div>
                </div>
                <div className="flex items-end">
                  <div className="text-sm text-muted-foreground">
                    <span className="font-medium">Selected:</span> {scopeSelection.canonicalName}
                  </div>
                </div>
              </div>
            )}
            {!scopeSelection && (
              <p className="text-xs text-muted-foreground mt-2">
                Select a work type to enable production rate tracking for T&M work.
              </p>
            )}
          </Card>

          <div className="space-y-2">
            <Label>Cost Code</Label>
            <CostCodeCombobox
              value={costCode}
              onChange={setCostCode}
              data-testid="select-cost-code-tm"
            />
          </div>

          <div>
            <Label htmlFor="tm-description">Work Description / Notes</Label>
            <Textarea
              id="tm-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the T&M work performed (required)..."
              data-testid="input-tm-description"
            />
          </div>

          <Tabs value={activeEntryTab} onValueChange={setActiveEntryTab}>
            <TabsList>
              <TabsTrigger value="labor" data-testid="tab-labor-entries">
                <Users className="w-4 h-4 mr-2" />
                Labor ({laborEntries.filter(e => e.employeeName.trim()).length})
              </TabsTrigger>
              <TabsTrigger value="equipment" data-testid="tab-equipment-entries">
                <Wrench className="w-4 h-4 mr-2" />
                Equipment ({equipmentEntries.filter(e => e.equipmentType.trim()).length})
              </TabsTrigger>
              <TabsTrigger value="materials" data-testid="tab-material-entries">
                <Package className="w-4 h-4 mr-2" />
                Materials ({materialEntries.filter(e => e.description.trim()).length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="labor">
              <TMLaborTab
                entries={laborEntries}
                onAdd={() => setLaborEntries([...laborEntries, emptyLaborEntry()])}
                onRemove={(index) => setLaborEntries(laborEntries.filter((_, i) => i !== index))}
                onUpdate={updateLaborEntry}
              />
            </TabsContent>

            <TabsContent value="equipment">
              <TMEquipmentTab
                entries={equipmentEntries}
                onAdd={() => setEquipmentEntries([...equipmentEntries, emptyEquipmentEntry()])}
                onRemove={(index) => setEquipmentEntries(equipmentEntries.filter((_, i) => i !== index))}
                onUpdate={updateEquipmentEntry}
              />
            </TabsContent>

            <TabsContent value="materials">
              <TMMaterialTab
                entries={materialEntries}
                onAdd={() => setMaterialEntries([...materialEntries, emptyMaterialEntry()])}
                onRemove={(index) => setMaterialEntries(materialEntries.filter((_, i) => i !== index))}
                onUpdate={updateMaterialEntry}
                onAddFromCatalog={(entry) => setMaterialEntries([...materialEntries, entry])}
              />
            </TabsContent>
          </Tabs>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>Cancel</Button>
          <Button onClick={handleCreate} disabled={createMutation.isPending} data-testid="button-submit-tm-ticket">
            {createMutation.isPending ? "Creating..." : "Create Ticket"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
