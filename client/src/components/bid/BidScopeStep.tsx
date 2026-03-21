import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Calculator, Plus, FileText, ChevronRight, ChevronLeft, Info, ArrowDownToLine, Layers, Loader2, CheckCircle2, HardHat, History } from "lucide-react";
import type { Estimate, EstimateLineItem } from "@shared/schema";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, bidEstimateKey } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import EstimateRevisionHistory from "@/components/estimate/EstimateRevisionHistory";

interface TakeoffCategory {
  id: string;
  name: string;
}

interface JobClassification {
  id: string;
  name: string;
  code: string | null;
  defaultRegularRate: string | null;
  isActive: boolean;
}

interface BidScopeStepProps {
  estimate: (Estimate & { lineItems: EstimateLineItem[]; totals: any }) | null;
  estimateLoading: boolean;
  canEdit: boolean;
  canViewHistory?: boolean;
  bidId: string;
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
  canViewHistory = false,
  bidId,
  bidCode,
  createEstimatePending,
  onCreateEstimate,
  onNavigateEstimate,
  onPrevStep,
  onNextStep,
}: BidScopeStepProps) {
  const { toast } = useToast();
  const [lastImportCount, setLastImportCount] = useState<number | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [lastLaborRateAppliedCount, setLastLaborRateAppliedCount] = useState<number | null>(null);
  const [lastClassificationName, setLastClassificationName] = useState<string | null>(null);
  const [selectedClassificationId, setSelectedClassificationId] = useState<string>("none");

  const { data: categories = [], isLoading: categoriesLoading } = useQuery<TakeoffCategory[]>({
    queryKey: ["/api/bids", bidId, "takeoff", "categories"],
    queryFn: async () => {
      const res = await fetch(`/api/bids/${bidId}/takeoff/categories`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch takeoff categories");
      return res.json();
    },
    enabled: !!bidId,
  });

  const { data: classifications = [] } = useQuery<JobClassification[]>({
    queryKey: ["/api/labor-rates/classifications"],
    enabled: canEdit,
  });

  const activeClassifications = classifications.filter((c) => c.isActive && c.defaultRegularRate !== null && Number(c.defaultRegularRate) > 0);

  const handleImportSuccess = (data: { count: number; laborRateAppliedCount?: number; classificationName?: string | null }) => {
    setLastImportCount(data.count);
    setLastLaborRateAppliedCount(data.laborRateAppliedCount ?? null);
    setLastClassificationName(data.classificationName ?? null);
    queryClient.invalidateQueries({ queryKey: bidEstimateKey(bidId) });
    queryClient.invalidateQueries({ queryKey: ["/api/bids"] });
  };

  const buildImportDescription = (count: number, laborRateAppliedCount?: number | null, classificationName?: string | null) => {
    const itemText = `${count} line item${count === 1 ? "" : "s"} imported from your takeoff measurements.`;
    if (laborRateAppliedCount && laborRateAppliedCount > 0 && classificationName) {
      return `${itemText} Labor rate from "${classificationName}" applied to ${laborRateAppliedCount} item${laborRateAppliedCount === 1 ? "" : "s"}.`;
    }
    return itemText;
  };

  const createAndImportMutation = useMutation({
    mutationFn: async () => {
      const createRes = await apiRequest("POST", `/api/bids/${bidId}/estimate`, {});
      const newEstimate = await createRes.json();
      const categoryIds = categories.map((c) => c.id);
      const importRes = await apiRequest("POST", `/api/bids/${bidId}/estimate/import-takeoff`, {
        estimateId: newEstimate.id,
        categoryIds,
        jobClassificationId: selectedClassificationId !== "none" ? selectedClassificationId : undefined,
      });
      return importRes.json() as Promise<{ count: number; laborRateAppliedCount?: number; classificationName?: string | null }>;
    },
    onSuccess: (data) => {
      handleImportSuccess(data);
      toast({
        title: "Estimate created",
        description: buildImportDescription(data.count, data.laborRateAppliedCount, data.classificationName),
      });
    },
    onError: (error: Error) => {
      toast({ title: "Import failed", description: error.message, variant: "destructive" });
    },
  });

  const importOnlyMutation = useMutation({
    mutationFn: async () => {
      if (!estimate) throw new Error("No estimate to import into");
      const categoryIds = categories.map((c) => c.id);
      const importRes = await apiRequest("POST", `/api/bids/${bidId}/estimate/import-takeoff`, {
        estimateId: estimate.id,
        categoryIds,
        jobClassificationId: selectedClassificationId !== "none" ? selectedClassificationId : undefined,
      });
      return importRes.json() as Promise<{ count: number; laborRateAppliedCount?: number; classificationName?: string | null }>;
    },
    onSuccess: (data) => {
      handleImportSuccess(data);
      toast({
        title: "Import complete",
        description: buildImportDescription(data.count, data.laborRateAppliedCount, data.classificationName),
      });
    },
    onError: (error: Error) => {
      toast({ title: "Import failed", description: error.message, variant: "destructive" });
    },
  });

  const hasTakeoffData = !categoriesLoading && categories.length > 0;

  const renderLaborClassificationSelector = () => {
    if (!canEdit || activeClassifications.length === 0) return null;
    return (
      <div className="flex flex-col gap-1 mt-3">
        <Label htmlFor="import-classification" className="text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
          <HardHat className="w-3.5 h-3.5" />
          Labor Classification <span className="text-emerald-500 dark:text-emerald-600 font-normal">(optional)</span>
        </Label>
        <Select value={selectedClassificationId} onValueChange={setSelectedClassificationId}>
          <SelectTrigger id="import-classification" className="h-8 text-xs" data-testid="select-import-classification">
            <SelectValue placeholder="None — import without labor rate" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None — import without labor rate</SelectItem>
            {activeClassifications.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}{c.code ? ` (${c.code})` : ""} — ${Number(c.defaultRegularRate).toFixed(2)}/hr
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedClassificationId !== "none" && (
          <p className="text-xs text-emerald-600 dark:text-emerald-500 mt-0.5">
            Labor rate will be pre-filled on all imported line items. Hours are estimated from production history where available.
          </p>
        )}
      </div>
    );
  };

  const renderImportSuccessBanner = () => (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-800 p-3 flex items-start gap-3" data-testid="callout-import-success">
      <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
      <div className="text-sm text-emerald-800 dark:text-emerald-300 space-y-0.5">
        <p>
          <span className="font-semibold">{lastImportCount} line item{lastImportCount === 1 ? "" : "s"}</span> successfully imported from your takeoff measurements.
        </p>
        {lastLaborRateAppliedCount !== null && lastLaborRateAppliedCount > 0 && lastClassificationName && (
          <p className="text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
            <HardHat className="w-3 h-3 shrink-0" />
            Labor rate from &ldquo;{lastClassificationName}&rdquo; applied to {lastLaborRateAppliedCount} item{lastLaborRateAppliedCount === 1 ? "" : "s"}.
          </p>
        )}
      </div>
    </div>
  );

  const renderTakeoffReadyCallout = () => {
    if (!hasTakeoffData) return null;

    if (lastImportCount !== null) {
      return renderImportSuccessBanner();
    }

    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-800 p-4" data-testid="callout-takeoff-ready">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-emerald-100 dark:bg-emerald-900/40 p-1.5 shrink-0 mt-0.5">
            <Layers className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
              {categories.length} takeoff {categories.length === 1 ? "category" : "categories"} ready to import
            </p>
            <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-0.5">
              {canEdit
                ? "Your Step 1 measurements can be pulled in as estimate line items in one click — no manual entry needed."
                : "Step 1 takeoff measurements are available for this bid."}
            </p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {categories.slice(0, 5).map((cat) => (
                <Badge key={cat.id} variant="secondary" className="text-xs bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border-0">
                  {cat.name}
                </Badge>
              ))}
              {categories.length > 5 && (
                <Badge variant="secondary" className="text-xs bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border-0">
                  +{categories.length - 5} more
                </Badge>
              )}
            </div>
            {renderLaborClassificationSelector()}
          </div>
        </div>
        {canEdit && (
          <div className="flex flex-col sm:flex-row gap-2 mt-3">
            <Button
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
              size="sm"
              onClick={() => createAndImportMutation.mutate()}
              disabled={createAndImportMutation.isPending}
              data-testid="button-create-and-import-takeoff"
            >
              {createAndImportMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <ArrowDownToLine className="w-4 h-4 mr-2" />
              )}
              {createAndImportMutation.isPending ? "Creating & Importing..." : "Create Estimate & Import from Takeoff"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onCreateEstimate}
              disabled={createEstimatePending || createAndImportMutation.isPending}
              data-testid="button-create-estimate-only"
            >
              <Plus className="w-4 h-4 mr-1" />
              Create Empty
            </Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
    <Card data-testid="card-bid-estimate">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
            <Calculator className="w-5 h-5 shrink-0" />
            Step 2: Scope of Work
          </CardTitle>
          <CardDescription className="text-xs sm:text-sm">Start by defining the work scope - this will auto-populate material, equipment, and subcontractor requirements</CardDescription>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          {!estimate && canEdit && !hasTakeoffData && (
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
          {estimate && canViewHistory && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowHistory(true)}
              data-testid="button-estimate-history"
            >
              <History className="w-4 h-4 mr-2" />
              History
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
          <div className="space-y-4">
            {hasTakeoffData ? (
              renderTakeoffReadyCallout()
            ) : (
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
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {hasTakeoffData && (
              lastImportCount !== null ? (
                renderImportSuccessBanner()
              ) : canEdit ? (
                <div className="rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-800 p-3 space-y-2" data-testid="callout-import-takeoff">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <ArrowDownToLine className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                      <p className="text-xs text-blue-700 dark:text-blue-300">
                        <span className="font-semibold">{categories.length} takeoff {categories.length === 1 ? "category" : "categories"}</span> from Step 1 can be added as line items.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-blue-300 text-blue-700 hover:bg-blue-100 dark:border-blue-700 dark:text-blue-300 dark:hover:bg-blue-900/30 shrink-0"
                      onClick={() => importOnlyMutation.mutate()}
                      disabled={importOnlyMutation.isPending}
                      data-testid="button-import-takeoff-only"
                    >
                      {importOnlyMutation.isPending ? (
                        <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                      ) : (
                        <ArrowDownToLine className="w-3.5 h-3.5 mr-1.5" />
                      )}
                      {importOnlyMutation.isPending ? "Importing..." : "Import from Takeoff"}
                    </Button>
                  </div>
                  {activeClassifications.length > 0 && (
                    <div className="flex flex-col gap-1 pt-1 border-t border-blue-200 dark:border-blue-800">
                      <Label htmlFor="import-classification-existing" className="text-xs text-blue-700 dark:text-blue-400 flex items-center gap-1">
                        <HardHat className="w-3.5 h-3.5" />
                        Labor Classification <span className="text-blue-500 dark:text-blue-600 font-normal">(optional)</span>
                      </Label>
                      <Select value={selectedClassificationId} onValueChange={setSelectedClassificationId}>
                        <SelectTrigger id="import-classification-existing" className="h-7 text-xs" data-testid="select-import-classification-existing">
                          <SelectValue placeholder="None — import without labor rate" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None — import without labor rate</SelectItem>
                          {activeClassifications.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}{c.code ? ` (${c.code})` : ""} — ${Number(c.defaultRegularRate).toFixed(2)}/hr
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {selectedClassificationId !== "none" && (
                        <p className="text-xs text-blue-600 dark:text-blue-500">
                          Labor rate will be pre-filled. Hours estimated from production history where available.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-800 p-3 flex items-center gap-2" data-testid="callout-takeoff-info">
                  <Layers className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <p className="text-xs text-emerald-700 dark:text-emerald-300">
                    <span className="font-semibold">{categories.length} takeoff {categories.length === 1 ? "category" : "categories"}</span> from Step 1 are associated with this bid.
                  </p>
                </div>
              )
            )}

            <Alert className="border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-800">
              <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <AlertDescription className="text-xs text-blue-700 dark:text-blue-300">
                These costs come directly from your estimate line items. Labor is always sourced from here. If you don't add vendor quotes in steps 3–5, these costs will also be used in the Bid Summary.
              </AlertDescription>
            </Alert>
            <div className="border rounded-md divide-y">
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-muted/30">
                <span className="text-sm font-semibold">Total Estimate</span>
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
              {Number(estimate.totals.equipmentCost) > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <span className="text-sm font-medium">Equipment Cost</span>
                  <span className="font-mono font-semibold min-w-0">
                    ${Number(estimate.totals.equipmentCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              )}
              {Number(estimate.totals.subcontractCost) > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <span className="text-sm font-medium">Subcontract Cost</span>
                  <span className="font-mono font-semibold min-w-0">
                    ${Number(estimate.totals.subcontractCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              )}
              {Number(estimate.totals.consumablesCost) > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <span className="text-sm font-medium">Consumables</span>
                  <span className="font-mono font-semibold min-w-0">
                    ${Number(estimate.totals.consumablesCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              )}
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

            <div className="flex flex-col sm:flex-row justify-between gap-2 pt-4">
              {onPrevStep && (
                <Button variant="outline" className="w-full sm:w-auto" onClick={onPrevStep} data-testid="button-prev-step-2">
                  <ChevronLeft className="w-4 h-4 mr-2" />
                  Back to Plans
                </Button>
              )}
              <div className="sm:ml-auto">
                <Button className="w-full sm:w-auto" onClick={onNextStep} data-testid="button-next-step-2">
                  Continue to Materials
                  <ChevronRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
    {estimate && canViewHistory && (
      <EstimateRevisionHistory
        open={showHistory}
        onOpenChange={setShowHistory}
        bidCode={bidCode}
        estimateId={estimate.id}
      />
    )}
    </>
  );
}
