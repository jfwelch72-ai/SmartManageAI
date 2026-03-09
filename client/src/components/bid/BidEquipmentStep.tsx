import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Truck, Plus, Edit, Trash2, FileText, Wrench, Clock, ChevronRight } from "lucide-react";
import type { BidEquipmentSelection } from "@shared/schema";

interface DerivedEquipmentRequirement {
  id: string;
  category: string;
  description: string;
  equipmentCost: number;
  needsEquipmentSelection: boolean;
}

interface BidEquipmentStepProps {
  equipmentSelections: BidEquipmentSelection[];
  equipmentLoading: boolean;
  totalEquipmentCost: number;
  derivedEquipmentRequirements: DerivedEquipmentRequirement[];
  canEdit: boolean;
  onAddEquipment: () => void;
  onEditEquipment: (selection: BidEquipmentSelection) => void;
  onDeleteEquipment: (selectionId: string) => void;
  onPrevStep: () => void;
  onNextStep: () => void;
}

export default function BidEquipmentStep({
  equipmentSelections,
  equipmentLoading,
  totalEquipmentCost,
  derivedEquipmentRequirements,
  canEdit,
  onAddEquipment,
  onEditEquipment,
  onDeleteEquipment,
  onPrevStep,
  onNextStep,
}: BidEquipmentStepProps) {
  return (
    <Card data-testid="card-equipment-selections">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
            <Truck className="w-5 h-5 shrink-0" />
            Step 4: Equipment Selection
          </CardTitle>
          <CardDescription className="text-xs sm:text-sm">Select equipment identified in the Scope of Work from your fleet or rentals</CardDescription>
        </div>
        {canEdit && (
          <Button onClick={onAddEquipment} size="sm" className="w-full sm:w-auto" data-testid="button-add-equipment">
            <Plus className="w-4 h-4 mr-2" />
            Add Equipment
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {derivedEquipmentRequirements.length > 0 && (
          <div className="mb-6 p-4 bg-purple-50 dark:bg-purple-950/20 rounded-lg border border-purple-200 dark:border-purple-800">
            <h4 className="text-sm font-semibold text-purple-800 dark:text-purple-300 mb-3 flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Equipment Requirements from SOW ({derivedEquipmentRequirements.length} items)
            </h4>
            <div className="space-y-2">
              {derivedEquipmentRequirements.map((req) => (
                <div key={req.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-2 text-sm">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <Badge variant="secondary" className="text-xs shrink-0">{req.category}</Badge>
                    <span className="text-muted-foreground truncate">{req.description}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-mono">${req.equipmentCost.toLocaleString()}</span>
                    {req.needsEquipmentSelection ? (
                      <Badge variant="outline" className="text-orange-600 border-orange-300">Needs Selection</Badge>
                    ) : (
                      <Badge variant="outline" className="text-green-600 border-green-300">Selected</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {equipmentLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading equipment...</div>
        ) : equipmentSelections.length === 0 && derivedEquipmentRequirements.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Truck className="w-12 h-12 mx-auto mb-4 opacity-40" />
            <p className="font-medium mb-1">No equipment requirements yet</p>
            <p className="text-sm mb-4">Add scope items with equipment costs in Step 1 to see requirements here</p>
          </div>
        ) : equipmentSelections.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p className="font-medium mb-1">No equipment selected yet</p>
            <p className="text-sm mb-4">Select equipment from your fleet or add rentals</p>
            {canEdit && (
              <Button onClick={onAddEquipment} variant="outline" data-testid="button-add-first-equipment">
                <Plus className="w-4 h-4 mr-2" />
                Add Equipment
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-muted rounded-md">
              <span className="text-sm font-medium">Total Equipment Cost:</span>
              <span className="text-lg font-bold font-mono">${totalEquipmentCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            <div className="space-y-3">
              {equipmentSelections.map((selection) => (
                <div
                  key={selection.id}
                  className="flex flex-col sm:flex-row sm:items-start sm:justify-between p-3 sm:p-4 border rounded-md"
                  data-testid={`equipment-selection-${selection.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 sm:gap-3 mb-2 flex-wrap">
                      <h4 className="font-medium text-sm sm:text-base">{selection.equipmentName}</h4>
                      <Badge variant={selection.source === "OWNED" ? "default" : "secondary"}>
                        {selection.source === "OWNED" ? (
                          <><Wrench className="w-3 h-3 mr-1" />Owned</>
                        ) : (
                          <><Clock className="w-3 h-3 mr-1" />Rental</>
                        )}
                      </Badge>
                      <Badge variant="outline">{selection.equipmentType}</Badge>
                      {selection.estimatedCost && (
                        <Badge variant="outline" className="font-mono">
                          ${parseFloat(selection.estimatedCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </Badge>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 text-xs text-muted-foreground">
                      {selection.plannedDays && (
                        <div><span className="font-medium">Days:</span> {selection.plannedDays}</div>
                      )}
                      {selection.plannedHours && (
                        <div><span className="font-medium">Hours:</span> {selection.plannedHours}</div>
                      )}
                      {selection.dailyRate && (
                        <div><span className="font-medium">Daily Rate:</span> ${parseFloat(selection.dailyRate).toLocaleString()}</div>
                      )}
                    </div>
                  </div>
                  {canEdit && (
                    <div className="flex gap-2 mt-2 sm:mt-0 sm:ml-4 self-end sm:self-start">
                      <Button size="icon" variant="ghost" onClick={() => onEditEquipment(selection)}>
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => onDeleteEquipment(selection.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="flex flex-col sm:flex-row justify-between gap-2 pt-4">
              <Button variant="outline" className="w-full sm:w-auto" onClick={onPrevStep} data-testid="button-prev-step-4">
                Back to Materials
              </Button>
              <Button className="w-full sm:w-auto" onClick={onNextStep} data-testid="button-next-step-4">
                Continue to Subcontractors
                <ChevronRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
