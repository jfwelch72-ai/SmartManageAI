import { useQuery } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Truck, Building } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState, useEffect } from "react";

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

export interface EquipmentSelectionData {
  source: "OWNED" | "RENTAL" | "MANUAL";
  equipmentId: string | null;
  equipmentName: string;
  hourlyRate: number;
  totalCost: number;
  hours: number;
  rateType: RateType;
  deliveryFee: number;
}

interface EquipmentRateSelectorProps {
  onSelect: (equipmentData: EquipmentSelectionData) => void;
  disabled?: boolean;
  className?: string;
  initialHours?: number;
  initialEquipmentId?: string;
  initialSource?: "OWNED" | "RENTAL" | "MANUAL";
}

export function EquipmentRateSelector({ 
  onSelect, 
  disabled = false,
  className,
  initialHours = 0,
  initialEquipmentId = "",
  initialSource = "MANUAL"
}: EquipmentRateSelectorProps) {
  // Initialize state from props - component will remount via key when parent resets
  const [selectedSource, setSelectedSource] = useState<"owned" | "rental">(
    initialSource === "RENTAL" ? "rental" : "owned"
  );
  const [selectedEquipmentId, setSelectedEquipmentId] = useState<string>(initialEquipmentId);
  const [rateType, setRateType] = useState<RateType>("hourly");
  const [hoursInput, setHoursInput] = useState<string>(initialHours > 0 ? String(initialHours) : "");

  const { data: equipmentData, isLoading } = useQuery<EquipmentForSelection>({
    queryKey: ["/api/equipment-for-selection"],
  });

  const ownedEquipment = equipmentData?.owned || [];
  const rentalEquipment = equipmentData?.rental || [];
  
  // Emit initial selection when equipment data is loaded and we have an initial selection
  useEffect(() => {
    if (!equipmentData || !initialEquipmentId) return;
    
    const hrs = initialHours || 0;
    let equipment: OwnedEquipment | RentalEquipment | undefined;
    let source: "OWNED" | "RENTAL" = "OWNED";
    
    if (initialSource === "RENTAL") {
      equipment = rentalEquipment.find(e => e.id === initialEquipmentId);
      source = "RENTAL";
    } else if (initialSource === "OWNED") {
      equipment = ownedEquipment.find(e => e.id === initialEquipmentId);
      source = "OWNED";
    }
    
    if (equipment) {
      const hourlyRate = getRate(equipment, "hourly");
      const totalCost = calculateCost(equipment, hrs);
      const deliveryFee = getDeliveryFee(equipment);
      
      onSelect({
        source,
        equipmentId: initialEquipmentId,
        equipmentName: equipment.name,
        hourlyRate,
        totalCost,
        hours: hrs,
        rateType,
        deliveryFee,
      });
    }
  }, [equipmentData, initialEquipmentId, initialSource]);

  const getRate = (equipment: OwnedEquipment | RentalEquipment, type: RateType): number => {
    const rateField = `${type}Rate` as keyof typeof equipment;
    const rate = equipment[rateField as keyof typeof equipment];
    return rate ? parseFloat(rate as string) : 0;
  };

  const getDeliveryFee = (equipment: OwnedEquipment | RentalEquipment): number => {
    if ('deliveryFee' in equipment && equipment.deliveryFee) {
      return parseFloat(equipment.deliveryFee);
    }
    return 0;
  };

  const calculateCost = (equipment: OwnedEquipment | RentalEquipment | undefined, hrs: number): number => {
    if (!equipment || hrs <= 0) return 0;
    const rate = getRate(equipment, rateType);
    const deliveryFee = getDeliveryFee(equipment);
    
    let baseCost = 0;
    switch (rateType) {
      case "hourly":
        baseCost = rate * hrs;
        break;
      case "daily":
        baseCost = rate * Math.ceil(hrs / 8);
        break;
      case "weekly":
        baseCost = rate * Math.ceil(hrs / 40);
        break;
      case "monthly":
        baseCost = rate * Math.ceil(hrs / 160);
        break;
      default:
        baseCost = rate * hrs;
    }
    
    return baseCost + deliveryFee;
  };

  const notifyChange = (
    equipment: OwnedEquipment | RentalEquipment | undefined,
    source: "OWNED" | "RENTAL" | "MANUAL",
    equipmentId: string,
    hrs: number
  ) => {
    if (!equipment) {
      onSelect({
        source: "MANUAL",
        equipmentId: null,
        equipmentName: "",
        hourlyRate: 0,
        totalCost: 0,
        hours: hrs,
        rateType,
        deliveryFee: 0,
      });
      return;
    }

    const hourlyRate = getRate(equipment, "hourly");
    const totalCost = calculateCost(equipment, hrs);
    const deliveryFee = getDeliveryFee(equipment);

    onSelect({
      source,
      equipmentId,
      equipmentName: equipment.name,
      hourlyRate,
      totalCost,
      hours: hrs,
      rateType,
      deliveryFee,
    });
  };

  const handleEquipmentSelect = (equipmentId: string) => {
    if (equipmentId === "none") {
      setSelectedEquipmentId("");
      const hrs = parseFloat(hoursInput) || 0;
      onSelect({
        source: "MANUAL",
        equipmentId: null,
        equipmentName: "",
        hourlyRate: 0,
        totalCost: 0,
        hours: hrs,
        rateType,
        deliveryFee: 0,
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

    const hrs = parseFloat(hoursInput) || 0;
    notifyChange(equipment, source, equipmentId, hrs);
  };

  const handleHoursChange = (value: string) => {
    // Allow empty string, digits, and decimal point for user input
    if (value === "" || /^\d*\.?\d*$/.test(value)) {
      setHoursInput(value);
      
      const hrs = parseFloat(value) || 0;
      
      let equipment: OwnedEquipment | RentalEquipment | undefined;
      let source: "OWNED" | "RENTAL" | "MANUAL" = "MANUAL";
      
      if (selectedEquipmentId) {
        if (selectedSource === "owned") {
          equipment = ownedEquipment.find(e => e.id === selectedEquipmentId);
          source = "OWNED";
        } else {
          equipment = rentalEquipment.find(e => e.id === selectedEquipmentId);
          source = "RENTAL";
        }
      }

      notifyChange(equipment, source, selectedEquipmentId, hrs);
    }
  };

  const handleRateTypeChange = (newRateType: RateType) => {
    setRateType(newRateType);
    
    // Recalculate with new rate type
    const hrs = parseFloat(hoursInput) || 0;
    let equipment: OwnedEquipment | RentalEquipment | undefined;
    let source: "OWNED" | "RENTAL" | "MANUAL" = "MANUAL";
    
    if (selectedEquipmentId) {
      if (selectedSource === "owned") {
        equipment = ownedEquipment.find(e => e.id === selectedEquipmentId);
        source = "OWNED";
      } else {
        equipment = rentalEquipment.find(e => e.id === selectedEquipmentId);
        source = "RENTAL";
      }
    }

    if (equipment) {
      const rate = getRate(equipment, newRateType);
      const deliveryFee = getDeliveryFee(equipment);
      
      let baseCost = 0;
      switch (newRateType) {
        case "hourly":
          baseCost = rate * hrs;
          break;
        case "daily":
          baseCost = rate * Math.ceil(hrs / 8);
          break;
        case "weekly":
          baseCost = rate * Math.ceil(hrs / 40);
          break;
        case "monthly":
          baseCost = rate * Math.ceil(hrs / 160);
          break;
      }

      onSelect({
        source,
        equipmentId: selectedEquipmentId,
        equipmentName: equipment.name,
        hourlyRate: getRate(equipment, "hourly"),
        totalCost: baseCost + deliveryFee,
        hours: hrs,
        rateType: newRateType,
        deliveryFee,
      });
    }
  };

  const selectedEquipment = selectedSource === "owned" 
    ? ownedEquipment.find(e => e.id === selectedEquipmentId)
    : rentalEquipment.find(e => e.id === selectedEquipmentId);

  const currentHours = parseFloat(hoursInput) || 0;

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
          const hrs = parseFloat(hoursInput) || 0;
          onSelect({
            source: "MANUAL",
            equipmentId: null,
            equipmentName: "",
            hourlyRate: 0,
            totalCost: 0,
            hours: hrs,
            rateType,
            deliveryFee: 0,
          });
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
                onValueChange={(v) => handleRateTypeChange(v as RateType)}
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
                value={hoursInput}
                onChange={(e) => handleHoursChange(e.target.value)}
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
            {getDeliveryFee(selectedEquipment) > 0 && (
              <div className="flex justify-between">
                <span>Delivery Fee:</span>
                <span>${getDeliveryFee(selectedEquipment).toFixed(2)}</span>
              </div>
            )}
            {currentHours > 0 && (
              <div className="flex justify-between font-medium mt-1 pt-1 border-t">
                <span>Estimated Cost:</span>
                <span>${calculateCost(selectedEquipment, currentHours).toFixed(2)}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
