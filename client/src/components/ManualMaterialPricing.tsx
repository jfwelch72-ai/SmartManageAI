import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DollarSign, Calculator, Check, Plus, RefreshCw } from "lucide-react";
import { MaterialCalculatorData } from "@/components/MaterialCalculator";

interface ManualMaterialPricingProps {
  materialCalcData: MaterialCalculatorData;
  onMaterialCostChange: (totalCost: number) => void;
  currentMaterialCost: number;
  catalogPricedMaterials?: Set<string>;
}

interface MaterialPricingItem {
  key: string;
  label: string;
  quantity: number;
  unit: string;
  unitPrice: number;
}

export function ManualMaterialPricing({
  materialCalcData,
  onMaterialCostChange,
  currentMaterialCost,
  catalogPricedMaterials = new Set(),
}: ManualMaterialPricingProps) {
  const [materialPrices, setMaterialPrices] = useState<Record<string, number>>({
    concrete: 0,
    stone: 0,
    excavation: 0,
    wireMesh: 0,
    rebar: 0,
    dowels: 0,
    sealer: 0,
    underlayment: 0,
  });

  const [isApplied, setIsApplied] = useState(false);
  const [appliedMode, setAppliedMode] = useState<"add" | "replace" | null>(null);

  const concreteYards = parseFloat(materialCalcData.calculatedConcreteYards || "0");
  const stoneTons = parseFloat(materialCalcData.calculatedStoneTons || "0");
  const excavationYards = parseFloat(materialCalcData.calculatedExcavationYards || "0");
  const wireMeshRolls = parseFloat(materialCalcData.calculatedWireMeshRolls || "0");
  const rebarCount = parseFloat(materialCalcData.calculatedRebarCount || "0");
  const dowelCount = parseFloat(materialCalcData.calculatedDowelCount || "0");
  const sealerGallons = parseFloat(materialCalcData.calculatedSealerGallons || "0");
  const underlaymentSF = parseFloat(materialCalcData.calculatedUnderlaymentSF || "0");

  const materials: MaterialPricingItem[] = [
    { key: "concrete", label: "Concrete", quantity: concreteYards, unit: "CY", unitPrice: materialPrices.concrete },
    { key: "stone", label: "Stone Base", quantity: stoneTons, unit: "TON", unitPrice: materialPrices.stone },
    { key: "excavation", label: "Excavation/Hauling", quantity: excavationYards, unit: "CY", unitPrice: materialPrices.excavation },
    { key: "wireMesh", label: "Wire Mesh", quantity: wireMeshRolls, unit: "ROLL", unitPrice: materialPrices.wireMesh },
    { key: "rebar", label: "Rebar", quantity: rebarCount, unit: "EA", unitPrice: materialPrices.rebar },
    { key: "dowels", label: "Dowels", quantity: dowelCount, unit: "EA", unitPrice: materialPrices.dowels },
    { key: "sealer", label: "Sealer", quantity: sealerGallons, unit: "GAL", unitPrice: materialPrices.sealer },
    { key: "underlayment", label: "Underlayment", quantity: underlaymentSF, unit: "SF", unitPrice: materialPrices.underlayment },
  ];

  // Filter out materials that already have catalog prices applied
  const activeMaterials = materials.filter(m => m.quantity > 0 && !catalogPricedMaterials.has(m.key));

  const calculateTotal = () => {
    return activeMaterials.reduce((sum, m) => sum + (m.quantity * m.unitPrice), 0);
  };

  const totalCalculatedCost = calculateTotal();

  const handlePriceChange = (key: string, value: string) => {
    const numValue = parseFloat(value) || 0;
    setMaterialPrices(prev => ({ ...prev, [key]: numValue }));
    setIsApplied(false);
    setAppliedMode(null);
  };

  const handleAddToExisting = () => {
    const newTotal = currentMaterialCost + totalCalculatedCost;
    onMaterialCostChange(newTotal);
    setIsApplied(true);
    setAppliedMode("add");
  };

  const handleReplaceTotal = () => {
    onMaterialCostChange(totalCalculatedCost);
    setIsApplied(true);
    setAppliedMode("replace");
  };

  if (activeMaterials.length === 0) {
    return null;
  }

  return (
    <Card className="border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2 text-amber-700 dark:text-amber-400">
          <DollarSign className="h-4 w-4" />
          Manual Material Pricing
        </CardTitle>
        <CardDescription className="text-xs">
          Enter unit prices for calculated materials when catalog pricing is unavailable
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <div className="grid gap-2">
          {activeMaterials.map((material) => (
            <div
              key={material.key}
              className="flex items-center gap-3 p-2 bg-background rounded-md border"
              data-testid={`material-pricing-row-${material.key}`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{material.label}</span>
                  <Badge variant="outline" className="text-xs">
                    {material.quantity.toFixed(2)} {material.unit}
                  </Badge>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">$</span>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  className="w-24 h-8 text-sm"
                  value={material.unitPrice || ""}
                  onChange={(e) => handlePriceChange(material.key, e.target.value)}
                  data-testid={`input-price-${material.key}`}
                />
                <span className="text-xs text-muted-foreground">/{material.unit}</span>
              </div>
              <div className="w-24 text-right">
                <span className="text-sm font-medium" data-testid={`text-subtotal-${material.key}`}>
                  ${(material.quantity * material.unitPrice).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                  })}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="pt-2 border-t space-y-2">
          <div className="flex items-center gap-2">
            <Calculator className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Calculated Total:</span>
            <span className="text-lg font-bold text-primary" data-testid="text-total-material-cost">
              ${totalCalculatedCost.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
              })}
            </span>
          </div>

          {currentMaterialCost > 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Current material cost:</span>
              <span className="font-medium" data-testid="text-current-material-cost">
                ${currentMaterialCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            {currentMaterialCost > 0 && totalCalculatedCost > 0 && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleAddToExisting}
                disabled={totalCalculatedCost === 0 || (isApplied && appliedMode === "add")}
                className={isApplied && appliedMode === "add" ? "border-green-500 text-green-600" : ""}
                data-testid="button-add-material-cost"
              >
                {isApplied && appliedMode === "add" ? (
                  <>
                    <Check className="h-3 w-3 mr-1" />
                    Added
                  </>
                ) : (
                  <>
                    <Plus className="h-3 w-3 mr-1" />
                    Add to Existing (${(currentMaterialCost + totalCalculatedCost).toFixed(2)})
                  </>
                )}
              </Button>
            )}
            
            <Button
              type="button"
              size="sm"
              onClick={handleReplaceTotal}
              disabled={totalCalculatedCost === 0 || (isApplied && appliedMode === "replace")}
              className={isApplied && appliedMode === "replace" ? "bg-green-600 hover:bg-green-700" : ""}
              data-testid="button-replace-material-cost"
            >
              {isApplied && appliedMode === "replace" ? (
                <>
                  <Check className="h-3 w-3 mr-1" />
                  Applied
                </>
              ) : currentMaterialCost > 0 ? (
                <>
                  <RefreshCw className="h-3 w-3 mr-1" />
                  Replace with ${totalCalculatedCost.toFixed(2)}
                </>
              ) : (
                "Apply to Material Cost"
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default ManualMaterialPricing;
