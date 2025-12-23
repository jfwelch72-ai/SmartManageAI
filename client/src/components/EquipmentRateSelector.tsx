import { useQuery } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Truck, Building } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";

interface OwnedEquipment {
  id: string;
  equipmentCode: string | null;
  name: string;
  type: string;
  make: string | null;
  model: string | null;
  status: string;
  hourlyRate: string | null;
  dailyRate: string | null;
  weeklyRate: string | null;
  monthlyRate: string | null;
}

interface RentalEquipment {
  id: string;
  vendorId: string;
  name: string;
  equipmentType: string;
  make: string | null;
  model: string | null;
  hourlyRate: string | null;
  dailyRate: string | null;
  weeklyRate: string | null;
  monthlyRate: string | null;
  deliveryFee: string | null;
  vendorName: string;
  vendorCode: string;
}

interface EquipmentForSelection {
  owned: OwnedEquipment[];
  rental: RentalEquipment[];
}

type RateType = "hourly" | "daily" | "weekly" | "monthly";

interface EquipmentRateSelectorProps {
  onSelect: (equipmentData: {
    source: "OWNED" | "RENTAL" | null;
    equipmentId: string | null;
    equipmentName: string;
    hourlyRate: number;
    totalCost: number;
    hours: number;
  }) => void;
  disabled?: boolean;
  className?: string;
}

export function EquipmentRateSelector({ 
  onSelect, 
  disabled = false,
  className 
}: EquipmentRateSelectorProps) {
  const [selectedSource, setSelectedSource] = useState<"owned" | "rental">("owned");
  const [selectedEquipmentId, setSelectedEquipmentId] = useState<string>("");
  const [rateType, setRateType] = useState<RateType>("hourly");
  const [hours, setHours] = useState<number>(0);

  const { data: equipmentData, isLoading } = useQuery<EquipmentForSelection>({
    queryKey: ["/api/equipment-for-selection"],
  });

  const ownedEquipment = equipmentData?.owned || [];
  const rentalEquipment = equipmentData?.rental || [];

  const getRate = (equipment: OwnedEquipment | RentalEquipment, type: RateType): number => {
    const rateField = `${type}Rate` as keyof typeof equipment;
    const rate = equipment[rateField as keyof typeof equipment];
    return rate ? parseFloat(rate as string) : 0;
  };

  const calculateCost = (equipment: OwnedEquipment | RentalEquipment | undefined, hrs: number): number => {
    if (!equipment || hrs <= 0) return 0;
    const rate = getRate(equipment, rateType);
    
    switch (rateType) {
      case "hourly":
        return rate * hrs;
      case "daily":
        return rate * Math.ceil(hrs / 8);
      case "weekly":
        return rate * Math.ceil(hrs / 40);
      case "monthly":
        return rate * Math.ceil(hrs / 160);
      default:
        return rate * hrs;
    }
  };

  const handleEquipmentSelect = (equipmentId: string) => {
    if (equipmentId === "none") {
      setSelectedEquipmentId("");
      onSelect({
        source: null,
        equipmentId: null,
        equipmentName: "",
        hourlyRate: 0,
        totalCost: 0,
        hours: 0,
      });
      return;
    }

    setSelectedEquipmentId(equipmentId);
    
    let equipment: OwnedEquipment | RentalEquipment | undefined;
    let source: "OWNED" | "RENTAL";
    
    if (selectedSource === "owned") {
      equipment = ownedEquipment.find(e => e.id === equipmentId);
      source = "OWNED";
    } else {
      equipment = rentalEquipment.find(e => e.id === equipmentId);
      source = "RENTAL";
    }

    if (equipment) {
      const hourlyRate = getRate(equipment, "hourly");
      const totalCost = calculateCost(equipment, hours);
      onSelect({
        source,
        equipmentId,
        equipmentName: equipment.name,
        hourlyRate,
        totalCost,
        hours,
      });
    }
  };

  const handleHoursChange = (newHours: number) => {
    setHours(newHours);
    
    let equipment: OwnedEquipment | RentalEquipment | undefined;
    let source: "OWNED" | "RENTAL";
    
    if (selectedSource === "owned") {
      equipment = ownedEquipment.find(e => e.id === selectedEquipmentId);
      source = "OWNED";
    } else {
      equipment = rentalEquipment.find(e => e.id === selectedEquipmentId);
      source = "RENTAL";
    }

    if (equipment) {
      const hourlyRate = getRate(equipment, "hourly");
      const totalCost = calculateCost(equipment, newHours);
      onSelect({
        source,
        equipmentId: selectedEquipmentId,
        equipmentName: equipment.name,
        hourlyRate,
        totalCost,
        hours: newHours,
      });
    }
  };

  const selectedEquipment = selectedSource === "owned" 
    ? ownedEquipment.find(e => e.id === selectedEquipmentId)
    : rentalEquipment.find(e => e.id === selectedEquipmentId);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 h-9 px-3 border rounded-md bg-muted/50">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Loading equipment...</span>
      </div>
    );
  }

  return (
    <div className={className}>
      <Tabs 
        value={selectedSource} 
        onValueChange={(v) => {
          setSelectedSource(v as "owned" | "rental");
          setSelectedEquipmentId("");
        }}
      >
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="owned" className="flex items-center gap-1" data-testid="tab-owned-equipment">
            <Building className="w-3 h-3" />
            <span>Owned ({ownedEquipment.length})</span>
          </TabsTrigger>
          <TabsTrigger value="rental" className="flex items-center gap-1" data-testid="tab-rental-equipment">
            <Truck className="w-3 h-3" />
            <span>Rental ({rentalEquipment.length})</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="owned" className="space-y-3 mt-3">
          <Select 
            value={selectedEquipmentId || "none"} 
            onValueChange={handleEquipmentSelect}
            disabled={disabled}
          >
            <SelectTrigger data-testid="select-owned-equipment">
              <SelectValue placeholder="Select owned equipment..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No equipment (manual entry)</SelectItem>
              {ownedEquipment.map((eq) => (
                <SelectItem 
                  key={eq.id} 
                  value={eq.id}
                  data-testid={`select-owned-equipment-${eq.id}`}
                >
                  <div className="flex items-center justify-between w-full gap-4">
                    <span>{eq.name} {eq.equipmentCode && `(${eq.equipmentCode})`}</span>
                    {eq.hourlyRate && (
                      <span className="text-muted-foreground">
                        ${parseFloat(eq.hourlyRate).toFixed(2)}/hr
                      </span>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </TabsContent>

        <TabsContent value="rental" className="space-y-3 mt-3">
          <Select 
            value={selectedEquipmentId || "none"} 
            onValueChange={handleEquipmentSelect}
            disabled={disabled}
          >
            <SelectTrigger data-testid="select-rental-equipment">
              <SelectValue placeholder="Select rental equipment..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No equipment (manual entry)</SelectItem>
              {rentalEquipment.map((eq) => (
                <SelectItem 
                  key={eq.id} 
                  value={eq.id}
                  data-testid={`select-rental-equipment-${eq.id}`}
                >
                  <div className="flex flex-col">
                    <span>{eq.name} - {eq.vendorName}</span>
                    <span className="text-xs text-muted-foreground">
                      {eq.hourlyRate ? `$${parseFloat(eq.hourlyRate).toFixed(2)}/hr` : ""}
                      {eq.dailyRate ? ` | $${parseFloat(eq.dailyRate).toFixed(2)}/day` : ""}
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </TabsContent>
      </Tabs>

      {selectedEquipment && (
        <div className="mt-3 space-y-3 p-3 rounded-md border bg-muted/30">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Rate Type</Label>
              <Select 
                value={rateType} 
                onValueChange={(v) => setRateType(v as RateType)}
              >
                <SelectTrigger data-testid="select-rate-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hourly">Hourly</SelectItem>
                  <SelectItem value="daily">Daily (8 hrs)</SelectItem>
                  <SelectItem value="weekly">Weekly (40 hrs)</SelectItem>
                  <SelectItem value="monthly">Monthly (160 hrs)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Hours Needed</Label>
              <Input 
                type="text"
                inputMode="decimal"
                pattern="[0-9]*\.?[0-9]*"
                value={hours ?? ""}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "" || /^\d*\.?\d*$/.test(val)) {
                    handleHoursChange(parseFloat(val) || 0);
                  }
                }}
                placeholder="0"
                data-testid="input-equipment-hours"
              />
            </div>
          </div>

          <div className="text-xs text-muted-foreground bg-background p-2 rounded border" data-testid="equipment-cost-summary">
            <div className="flex justify-between">
              <span>Rate ({rateType}):</span>
              <span>${getRate(selectedEquipment, rateType).toFixed(2)}</span>
            </div>
            {hours > 0 && (
              <div className="flex justify-between font-medium mt-1 pt-1 border-t">
                <span>Estimated Cost:</span>
                <span>${calculateCost(selectedEquipment, hours).toFixed(2)}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
