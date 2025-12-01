import { useQuery } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

interface JobClassification {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  defaultRegularRate: string | null;
  defaultOvertimeRate: string | null;
  isActive: boolean;
}

interface LaborRateSelectorProps {
  value?: string;
  onSelect: (classificationId: string | null, rate: number) => void;
  disabled?: boolean;
  className?: string;
}

export function LaborRateSelector({ 
  value, 
  onSelect, 
  disabled = false,
  className 
}: LaborRateSelectorProps) {
  const { data: classifications, isLoading } = useQuery<JobClassification[]>({
    queryKey: ["/api/labor-rates/classifications"],
  });

  const activeClassifications = classifications?.filter(c => c.isActive) || [];
  
  const selectedClassification = activeClassifications.find(c => c.id === value);
  const selectedRate = selectedClassification?.defaultRegularRate 
    ? parseFloat(selectedClassification.defaultRegularRate) 
    : 0;

  const handleSelect = (classificationId: string) => {
    if (classificationId === "none") {
      onSelect(null, 0);
      return;
    }
    const classification = activeClassifications.find(c => c.id === classificationId);
    const rate = classification?.defaultRegularRate 
      ? parseFloat(classification.defaultRegularRate) 
      : 0;
    onSelect(classificationId, rate);
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 h-9 px-3 border rounded-md bg-muted/50">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Loading rates...</span>
      </div>
    );
  }

  return (
    <div className={className}>
      <Select 
        value={value || "none"} 
        onValueChange={handleSelect}
        disabled={disabled}
      >
        <SelectTrigger data-testid="select-labor-rate">
          <SelectValue placeholder="Select labor classification..." />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">No classification (manual entry)</SelectItem>
          {activeClassifications.map((classification) => (
            <SelectItem 
              key={classification.id} 
              value={classification.id}
              data-testid={`select-labor-rate-${classification.id}`}
            >
              <div className="flex items-center justify-between w-full gap-4">
                <span>{classification.name}</span>
                {classification.defaultRegularRate && (
                  <span className="text-muted-foreground">
                    ${parseFloat(classification.defaultRegularRate).toFixed(2)}/hr
                  </span>
                )}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {selectedClassification && selectedRate > 0 && (
        <p className="text-xs text-muted-foreground mt-1" data-testid="text-selected-rate">
          Rate: ${selectedRate.toFixed(2)}/hr
          {selectedClassification.code && ` (${selectedClassification.code})`}
        </p>
      )}
    </div>
  );
}

interface LaborCostCalculatorProps {
  classificationId?: string | null;
  laborHours: number;
  onLaborCostChange: (cost: number, rate: number) => void;
  onClassificationChange: (classificationId: string | null) => void;
  disabled?: boolean;
}

export function LaborCostCalculator({
  classificationId,
  laborHours,
  onLaborCostChange,
  onClassificationChange,
  disabled = false
}: LaborCostCalculatorProps) {
  const { data: classifications } = useQuery<JobClassification[]>({
    queryKey: ["/api/labor-rates/classifications"],
  });

  const activeClassifications = classifications?.filter(c => c.isActive) || [];
  const selectedClassification = activeClassifications.find(c => c.id === classificationId);
  const rate = selectedClassification?.defaultRegularRate 
    ? parseFloat(selectedClassification.defaultRegularRate) 
    : 0;
  
  const calculatedCost = laborHours * rate;

  const handleClassificationSelect = (newClassificationId: string | null, newRate: number) => {
    onClassificationChange(newClassificationId);
    const newCost = laborHours * newRate;
    onLaborCostChange(newCost, newRate);
  };

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-sm">Labor Classification</Label>
        <LaborRateSelector
          value={classificationId || undefined}
          onSelect={handleClassificationSelect}
          disabled={disabled}
        />
      </div>
      
      {classificationId && rate > 0 && laborHours > 0 && (
        <div className="p-3 rounded-md bg-muted/50 border" data-testid="labor-cost-summary">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Calculated Labor Cost:</span>
            <span className="font-medium" data-testid="text-calculated-labor-cost">
              {laborHours} hrs × ${rate.toFixed(2)}/hr = ${calculatedCost.toFixed(2)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
