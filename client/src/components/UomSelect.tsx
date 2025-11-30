import { useQuery } from "@tanstack/react-query";
import { useMemo, useEffect } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface UnitOfMeasure {
  id: string;
  code: string;
  name: string;
  abbreviation: string;
  category: string | null;
  sortOrder: number;
  isActive: boolean;
}

interface UomSelectProps {
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  "data-testid"?: string;
}

const CATEGORY_ORDER = ["AREA", "LINEAR", "VOLUME", "COUNT", "WEIGHT", "TIME", "MISC"];
const CATEGORY_LABELS: Record<string, string> = {
  AREA: "Area Measurements",
  LINEAR: "Linear Measurements",
  VOLUME: "Volume Measurements",
  COUNT: "Count / Units",
  WEIGHT: "Weight Measurements",
  TIME: "Time-Based",
  MISC: "Miscellaneous",
};

function normalizeCategory(cat: string | null | undefined): string {
  if (!cat) return "MISC";
  const upper = cat.toUpperCase().trim();
  if (CATEGORY_ORDER.includes(upper)) return upper;
  return "MISC";
}

export function UomSelect({
  value,
  onChange,
  placeholder = "Select unit",
  disabled = false,
  className,
  "data-testid": testId = "select-uom",
}: UomSelectProps) {
  const { data: units = [], isLoading, isError } = useQuery<UnitOfMeasure[]>({
    queryKey: ["/api/ai/onboarding/units"],
  });

  const validUnitCodes = useMemo(() => new Set(units.map(u => u.code)), [units]);

  useEffect(() => {
    if (isLoading) return;
    
    if (isError) {
      if (value !== "" && value !== undefined) {
        onChange("");
      }
      return;
    }
    
    if (value && (units.length === 0 || !validUnitCodes.has(value))) {
      onChange("");
    }
  }, [isLoading, isError, units.length, value, validUnitCodes, onChange]);

  const groupedUnits = useMemo(() => {
    const groups: Record<string, UnitOfMeasure[]> = {};
    
    for (const unit of units) {
      const category = normalizeCategory(unit.category);
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(unit);
    }
    
    for (const category of Object.keys(groups)) {
      groups[category].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    }
    
    return groups;
  }, [units]);

  const sortedCategories = useMemo(() => {
    const categories = Object.keys(groupedUnits);
    return categories.sort((a, b) => {
      const aIdx = CATEGORY_ORDER.indexOf(a);
      const bIdx = CATEGORY_ORDER.indexOf(b);
      if (aIdx === -1 && bIdx === -1) return a.localeCompare(b);
      if (aIdx === -1) return 1;
      if (bIdx === -1) return -1;
      return aIdx - bIdx;
    });
  }, [groupedUnits]);

  const isDisabled = disabled || isLoading || isError || units.length === 0;
  
  const getPlaceholder = () => {
    if (isLoading) return "Loading units...";
    if (isError) return "Unable to load units";
    if (units.length === 0) return "No units available";
    return placeholder;
  };

  return (
    <Select 
      value={value} 
      onValueChange={onChange} 
      disabled={isDisabled}
    >
      <SelectTrigger className={className} data-testid={testId}>
        <SelectValue placeholder={getPlaceholder()} />
      </SelectTrigger>
      <SelectContent>
        {sortedCategories.map((category) => (
          <SelectGroup key={category}>
            <SelectLabel className="text-xs font-semibold text-muted-foreground">
              {CATEGORY_LABELS[category] || category}
            </SelectLabel>
            {groupedUnits[category].map((unit) => (
              <SelectItem 
                key={unit.id} 
                value={unit.code}
                data-testid={`option-uom-${unit.code}`}
              >
                {unit.code} - {unit.name}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

export function UomBadge({ code }: { code: string }) {
  const { data: units = [], isLoading, isError } = useQuery<UnitOfMeasure[]>({
    queryKey: ["/api/ai/onboarding/units"],
  });

  if (isLoading) {
    return (
      <span className="inline-flex items-center text-xs font-medium text-muted-foreground animate-pulse">
        ...
      </span>
    );
  }

  if (isError) {
    return (
      <span className="inline-flex items-center text-xs font-medium text-destructive">
        {code}
      </span>
    );
  }

  const unit = units.find((u) => u.code === code);
  
  return (
    <span className="inline-flex items-center text-xs font-medium text-muted-foreground">
      {unit ? unit.code : code}
    </span>
  );
}
