import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calculator, Plus, FileText, ChevronRight, ChevronLeft } from "lucide-react";
import type { Estimate, EstimateLineItem } from "@shared/schema";

interface BidScopeStepProps {
  estimate: (Estimate & { lineItems: EstimateLineItem[]; totals: any }) | null;
  estimateLoading: boolean;
  canEdit: boolean;
  bidCode: string;
  createEstimatePending: boolean;
  onCreateEstimate: () => void;
  onNavigateEstimate: () => void;
  onPrevStep?: () => void;
  onNextStep: () => void;
}

export default function BidScopeStep({
  estimate,
  estimateLoading,
  canEdit,
  bidCode,
  createEstimatePending,
  onCreateEstimate,
  onNavigateEstimate,
  onPrevStep,
  onNextStep,
}: BidScopeStepProps) {
  return (
    <Card data-testid="card-bid-estimate">
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="w-5 h-5" />
            Step 2: Scope of Work
          </CardTitle>
          <CardDescription>Start by defining the work scope - this will auto-populate material, equipment, and subcontractor requirements</CardDescription>
        </div>
        <div className="flex gap-2">
          {!estimate && canEdit && (
            <Button
              onClick={onCreateEstimate}
              disabled={createEstimatePending}
              size="sm"
              data-testid="button-create-estimate"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create Estimate
            </Button>
          )}
          {estimate && (
            <Button
              variant="outline"
              size="sm"
              onClick={onNavigateEstimate}
              data-testid="button-view-estimate"
            >
              <FileText className="w-4 h-4 mr-2" />
              Open Full Estimate
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {estimateLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading estimate...</div>
        ) : !estimate ? (
          <div className="text-center py-12 text-muted-foreground">
            <Calculator className="h-12 w-12 mx-auto mb-4 opacity-40" />
            <p className="font-medium mb-1">No estimate created yet</p>
            <p className="text-sm mb-4">Create an estimate to define scope quantities and track labor costs</p>
            {canEdit && (
              <Button
                onClick={onCreateEstimate}
                disabled={createEstimatePending}
                variant="outline"
                data-testid="button-create-first-estimate"
              >
                <Plus className="w-4 h-4 mr-2" />
                Create Estimate
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="border rounded-md divide-y">
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span className="text-sm font-medium">Total Estimate</span>
                <div className="text-right min-w-0">
                  <span className="text-lg font-bold font-mono" data-testid="text-estimate-total">
                    ${estimate.totals.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span className="text-xs text-muted-foreground ml-2">({estimate.lineItems.length} items)</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span className="text-sm font-medium">Labor Cost</span>
                <div className="text-right min-w-0">
                  <span className="font-mono font-semibold">
                    ${estimate.totals.laborCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span className="text-xs text-muted-foreground ml-2">({estimate.totals.laborHours.toFixed(1)} hrs)</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span className="text-sm font-medium">Material Cost</span>
                <span className="font-mono font-semibold min-w-0">
                  ${estimate.totals.materialCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span className="text-sm font-medium">Status</span>
                <Badge variant={estimate.status === "APPROVED" ? "default" : "secondary"}>
                  {estimate.status}
                </Badge>
              </div>
            </div>

            <Button
              className="w-full"
              variant="outline"
              onClick={onNavigateEstimate}
              data-testid="button-edit-estimate-items"
            >
              <FileText className="w-4 h-4 mr-2" />
              Edit Estimate Line Items
            </Button>

            <div className="flex justify-between pt-4">
              {onPrevStep && (
                <Button variant="outline" onClick={onPrevStep} data-testid="button-prev-step-2">
                  <ChevronLeft className="w-4 h-4 mr-2" />
                  Back to Plans
                </Button>
              )}
              <div className="ml-auto">
                <Button onClick={onNextStep} data-testid="button-next-step-2">
                  Continue to Materials
                  <ChevronRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
