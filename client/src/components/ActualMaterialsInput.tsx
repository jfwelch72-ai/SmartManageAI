import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, CheckCircle, Minus, Plus, Save, Truck, Package, Shovel } from "lucide-react";
import { Separator } from "@/components/ui/separator";

interface MaterialsData {
  estimatedConcreteYards: string | null;
  estimatedStoneTons: string | null;
  estimatedExcavationYards: string | null;
  actualConcreteYards: string | null;
  actualStoneTons: string | null;
  actualExcavationYards: string | null;
  materialResponsibility: string | null;
  overageActionStatus: string | null;
  overageNotes: string | null;
}

interface ActualMaterialsInputProps {
  scopeItemId: string;
  description: string;
  unit: string;
  quantity: string;
  initialData: MaterialsData;
  isSubcontracted?: boolean;
  subcontractorName?: string;
  onSave: (data: {
    actualConcreteYards: string | null;
    actualStoneTons: string | null;
    actualExcavationYards: string | null;
    materialResponsibility: string;
    overageActionStatus: string;
    overageNotes: string;
  }) => Promise<void>;
  disabled?: boolean;
}

export function ActualMaterialsInput({
  scopeItemId,
  description,
  unit,
  quantity,
  initialData,
  isSubcontracted = false,
  subcontractorName,
  onSave,
  disabled = false,
}: ActualMaterialsInputProps) {
  const [actualConcreteYards, setActualConcreteYards] = useState<string>(
    initialData.actualConcreteYards || ""
  );
  const [actualStoneTons, setActualStoneTons] = useState<string>(
    initialData.actualStoneTons || ""
  );
  const [actualExcavationYards, setActualExcavationYards] = useState<string>(
    initialData.actualExcavationYards || ""
  );
  const [materialResponsibility, setMaterialResponsibility] = useState<string>(
    initialData.materialResponsibility || "PENDING"
  );
  const [overageActionStatus, setOverageActionStatus] = useState<string>(
    initialData.overageActionStatus || "NONE"
  );
  const [overageNotes, setOverageNotes] = useState<string>(
    initialData.overageNotes || ""
  );
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  const estimatedConcrete = Number(initialData.estimatedConcreteYards) || 0;
  const estimatedStone = Number(initialData.estimatedStoneTons) || 0;
  const estimatedExcavation = Number(initialData.estimatedExcavationYards) || 0;

  const actualConcrete = Number(actualConcreteYards) || 0;
  const actualStone = Number(actualStoneTons) || 0;
  const actualExcavation = Number(actualExcavationYards) || 0;

  const concreteVariance = actualConcrete - estimatedConcrete;
  const stoneVariance = actualStone - estimatedStone;
  const excavationVariance = actualExcavation - estimatedExcavation;

  const hasConcreteOverage = estimatedConcrete > 0 && concreteVariance > 0;
  const hasStoneOverage = estimatedStone > 0 && stoneVariance > 0;
  const hasExcavationOverage = estimatedExcavation > 0 && excavationVariance > 0;
  const hasAnyOverage = hasConcreteOverage || hasStoneOverage || hasExcavationOverage;

  const hasMaterialEstimates = estimatedConcrete > 0 || estimatedStone > 0 || estimatedExcavation > 0;

  useEffect(() => {
    const originalConcrete = initialData.actualConcreteYards || "";
    const originalStone = initialData.actualStoneTons || "";
    const originalExcavation = initialData.actualExcavationYards || "";
    const originalResponsibility = initialData.materialResponsibility || "PENDING";
    const originalAction = initialData.overageActionStatus || "NONE";
    const originalNotes = initialData.overageNotes || "";

    const isModified =
      actualConcreteYards !== originalConcrete ||
      actualStoneTons !== originalStone ||
      actualExcavationYards !== originalExcavation ||
      materialResponsibility !== originalResponsibility ||
      overageActionStatus !== originalAction ||
      overageNotes !== originalNotes;

    setIsDirty(isModified);
  }, [
    actualConcreteYards,
    actualStoneTons,
    actualExcavationYards,
    materialResponsibility,
    overageActionStatus,
    overageNotes,
    initialData,
  ]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave({
        actualConcreteYards: actualConcreteYards || null,
        actualStoneTons: actualStoneTons || null,
        actualExcavationYards: actualExcavationYards || null,
        materialResponsibility,
        overageActionStatus: hasAnyOverage && overageActionStatus === "NONE" ? "PENDING" : overageActionStatus,
        overageNotes,
      });
      setIsDirty(false);
    } finally {
      setIsSaving(false);
    }
  };

  const getVarianceBadge = (variance: number, label: string, hasEstimate: boolean) => {
    if (!hasEstimate) return null;
    
    if (variance > 0) {
      return (
        <Badge variant="destructive" className="gap-1" data-testid={`badge-overage-${label}`}>
          <Plus className="h-3 w-3" />
          +{variance.toFixed(2)} overage
        </Badge>
      );
    } else if (variance < 0) {
      return (
        <Badge variant="secondary" className="gap-1" data-testid={`badge-savings-${label}`}>
          <Minus className="h-3 w-3" />
          {Math.abs(variance).toFixed(2)} under
        </Badge>
      );
    } else {
      return (
        <Badge variant="outline" className="gap-1" data-testid={`badge-match-${label}`}>
          <CheckCircle className="h-3 w-3" />
          On target
        </Badge>
      );
    }
  };

  if (!hasMaterialEstimates) {
    return null;
  }

  return (
    <Card className={hasAnyOverage ? "border-destructive/50" : ""} data-testid={`card-actual-materials-${scopeItemId}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-medium">{description}</CardTitle>
            <CardDescription className="text-xs">
              {quantity} {unit}
              {isSubcontracted && subcontractorName && (
                <span className="ml-2 text-muted-foreground">
                  Subcontracted to: {subcontractorName}
                </span>
              )}
            </CardDescription>
          </div>
          {hasAnyOverage && (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" />
              Overage Detected
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {estimatedConcrete > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Truck className="h-4 w-4" />
                <span>Concrete (CY)</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <Label className="text-xs text-muted-foreground">Estimated</Label>
                  <div className="font-medium">{estimatedConcrete.toFixed(2)}</div>
                </div>
                <div>
                  <Label className="text-xs">Actual</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={actualConcreteYards}
                    onChange={(e) => setActualConcreteYards(e.target.value)}
                    placeholder="0.00"
                    className="h-8"
                    disabled={disabled}
                    data-testid="input-actual-concrete"
                  />
                </div>
              </div>
              {actualConcrete > 0 && (
                <div className="flex justify-end">
                  {getVarianceBadge(concreteVariance, "concrete", true)}
                </div>
              )}
            </div>
          )}

          {estimatedStone > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Package className="h-4 w-4" />
                <span>Stone Base (Tons)</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <Label className="text-xs text-muted-foreground">Estimated</Label>
                  <div className="font-medium">{estimatedStone.toFixed(2)}</div>
                </div>
                <div>
                  <Label className="text-xs">Actual</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={actualStoneTons}
                    onChange={(e) => setActualStoneTons(e.target.value)}
                    placeholder="0.00"
                    className="h-8"
                    disabled={disabled}
                    data-testid="input-actual-stone"
                  />
                </div>
              </div>
              {actualStone > 0 && (
                <div className="flex justify-end">
                  {getVarianceBadge(stoneVariance, "stone", true)}
                </div>
              )}
            </div>
          )}

          {estimatedExcavation > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Shovel className="h-4 w-4" />
                <span>Excavation (CY)</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <Label className="text-xs text-muted-foreground">Estimated</Label>
                  <div className="font-medium">{estimatedExcavation.toFixed(2)}</div>
                </div>
                <div>
                  <Label className="text-xs">Actual</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={actualExcavationYards}
                    onChange={(e) => setActualExcavationYards(e.target.value)}
                    placeholder="0.00"
                    className="h-8"
                    disabled={disabled}
                    data-testid="input-actual-excavation"
                  />
                </div>
              </div>
              {actualExcavation > 0 && (
                <div className="flex justify-end">
                  {getVarianceBadge(excavationVariance, "excavation", true)}
                </div>
              )}
            </div>
          )}
        </div>

        {hasAnyOverage && (
          <>
            <Separator />
            <div className="space-y-3">
              <div className="text-sm font-medium text-destructive flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Overage Resolution
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs">Responsibility</Label>
                  <Select
                    value={materialResponsibility}
                    onValueChange={setMaterialResponsibility}
                    disabled={disabled}
                  >
                    <SelectTrigger className="h-8" data-testid="select-responsibility">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PENDING">Pending Decision</SelectItem>
                      <SelectItem value="TFR">TFR (Absorb Cost)</SelectItem>
                      {isSubcontracted && (
                        <SelectItem value="SUBCONTRACTOR">Subcontractor (Deduct)</SelectItem>
                      )}
                      <SelectItem value="CUSTOMER">Customer (Bill)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs">Action Status</Label>
                  <Select
                    value={overageActionStatus}
                    onValueChange={setOverageActionStatus}
                    disabled={disabled}
                  >
                    <SelectTrigger className="h-8" data-testid="select-action-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PENDING">Pending</SelectItem>
                      <SelectItem value="BILLED">Billed to Customer</SelectItem>
                      {isSubcontracted && (
                        <SelectItem value="DEDUCTED">Deducted from Sub</SelectItem>
                      )}
                      <SelectItem value="ABSORBED">Absorbed by TFR</SelectItem>
                      <SelectItem value="RESOLVED">Resolved</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Notes</Label>
                <Textarea
                  value={overageNotes}
                  onChange={(e) => setOverageNotes(e.target.value)}
                  placeholder="Document the reason for overage and resolution details..."
                  className="h-20 resize-none"
                  disabled={disabled}
                  data-testid="input-overage-notes"
                />
              </div>
            </div>
          </>
        )}

        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={disabled || isSaving || !isDirty}
            data-testid="button-save-materials"
          >
            {isSaving ? (
              "Saving..."
            ) : (
              <>
                <Save className="h-4 w-4 mr-1" />
                Save Materials
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function MaterialVarianceSummary({
  items,
}: {
  items: Array<{
    description: string;
    estimatedConcreteYards: number;
    estimatedStoneTons: number;
    estimatedExcavationYards: number;
    actualConcreteYards: number;
    actualStoneTons: number;
    actualExcavationYards: number;
    overageActionStatus: string;
  }>;
}) {
  const totals = items.reduce(
    (acc, item) => ({
      estimatedConcrete: acc.estimatedConcrete + item.estimatedConcreteYards,
      estimatedStone: acc.estimatedStone + item.estimatedStoneTons,
      estimatedExcavation: acc.estimatedExcavation + item.estimatedExcavationYards,
      actualConcrete: acc.actualConcrete + item.actualConcreteYards,
      actualStone: acc.actualStone + item.actualStoneTons,
      actualExcavation: acc.actualExcavation + item.actualExcavationYards,
    }),
    {
      estimatedConcrete: 0,
      estimatedStone: 0,
      estimatedExcavation: 0,
      actualConcrete: 0,
      actualStone: 0,
      actualExcavation: 0,
    }
  );

  const concreteVariance = totals.actualConcrete - totals.estimatedConcrete;
  const stoneVariance = totals.actualStone - totals.estimatedStone;
  const excavationVariance = totals.actualExcavation - totals.estimatedExcavation;

  const pendingOverages = items.filter((i) => i.overageActionStatus === "PENDING").length;

  const hasEstimates = 
    totals.estimatedConcrete > 0 || 
    totals.estimatedStone > 0 || 
    totals.estimatedExcavation > 0;

  if (!hasEstimates) {
    return null;
  }

  return (
    <Card data-testid="card-material-variance-summary">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center justify-between">
          <span>Project Material Variance Summary</span>
          {pendingOverages > 0 && (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" />
              {pendingOverages} Pending Overages
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-4 text-sm">
          {totals.estimatedConcrete > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Truck className="h-4 w-4" />
                <span>Concrete (CY)</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-xs text-muted-foreground">Est.</div>
                  <div className="font-medium">{totals.estimatedConcrete.toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Actual</div>
                  <div className="font-medium">{totals.actualConcrete.toFixed(2)}</div>
                </div>
              </div>
              <div className={`text-xs font-medium ${concreteVariance > 0 ? 'text-destructive' : concreteVariance < 0 ? 'text-green-600' : ''}`}>
                Variance: {concreteVariance > 0 ? '+' : ''}{concreteVariance.toFixed(2)} CY
              </div>
            </div>
          )}

          {totals.estimatedStone > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Package className="h-4 w-4" />
                <span>Stone (Tons)</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-xs text-muted-foreground">Est.</div>
                  <div className="font-medium">{totals.estimatedStone.toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Actual</div>
                  <div className="font-medium">{totals.actualStone.toFixed(2)}</div>
                </div>
              </div>
              <div className={`text-xs font-medium ${stoneVariance > 0 ? 'text-destructive' : stoneVariance < 0 ? 'text-green-600' : ''}`}>
                Variance: {stoneVariance > 0 ? '+' : ''}{stoneVariance.toFixed(2)} Tons
              </div>
            </div>
          )}

          {totals.estimatedExcavation > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Shovel className="h-4 w-4" />
                <span>Excavation (CY)</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-xs text-muted-foreground">Est.</div>
                  <div className="font-medium">{totals.estimatedExcavation.toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Actual</div>
                  <div className="font-medium">{totals.actualExcavation.toFixed(2)}</div>
                </div>
              </div>
              <div className={`text-xs font-medium ${excavationVariance > 0 ? 'text-destructive' : excavationVariance < 0 ? 'text-green-600' : ''}`}>
                Variance: {excavationVariance > 0 ? '+' : ''}{excavationVariance.toFixed(2)} CY
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
