import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Box, Loader2, Download, Layers, ArrowRight, FileText, CheckCircle2
} from "lucide-react";
import type { QuantityCategory } from "@shared/schema";
import type { BimExtractionResult, BimElementGroup } from "@/utils/ifc-quantity-parser";
import BimDiffDialog from "./BimDiffDialog";

interface BimQuantityDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  bidId?: string;
  projectId?: string;
  extractionResult: BimExtractionResult | null;
  isExtracting: boolean;
  extractionProgress: number;
  categories: QuantityCategory[];
}

interface GroupSelection {
  selected: boolean;
  categoryId: string | null;
}

export default function BimQuantityDialog({
  open,
  onOpenChange,
  bidId,
  projectId,
  extractionResult,
  isExtracting,
  extractionProgress,
  categories,
}: BimQuantityDialogProps) {
  const { toast } = useToast();
  const [selections, setSelections] = useState<Record<string, GroupSelection>>({});
  const [sheetName, setSheetName] = useState("BIM Takeoff");
  const [showDiff, setShowDiff] = useState(false);
  const [step, setStep] = useState<"review" | "map" | "confirm">("review");

  const entityId = bidId || projectId;
  const entityType = bidId ? "bids" : "projects";
  const apiBase = `/${entityType}/${entityId}`;

  const { data: previousExtractions = [] } = useQuery<any[]>({
    queryKey: [`/api/${entityType}`, entityId, "bim-extractions"],
    enabled: open && !!entityId,
  });

  const latestPreviousExtraction = useMemo(() => {
    if (!previousExtractions.length) return null;
    const imported = previousExtractions.find((e: any) => e.importedAt);
    if (!imported) return null;
    try {
      return JSON.parse(imported.extractedData) as BimExtractionResult;
    } catch (err) {
      console.warn("[BimQuantity] Failed to parse prior extraction data:", err);
      return null;
    }
  }, [previousExtractions]);

  const previousMappings = useMemo(() => {
    const map = new Map<string, string>();
    for (const ext of previousExtractions) {
      if (ext.mappings) {
        try {
          const mappings = JSON.parse(ext.mappings);
          for (const m of mappings) {
            if (m.displayName && m.categoryId) {
              map.set(m.displayName, m.categoryId);
            }
          }
        } catch (err) {
          console.warn("[BimQuantity] Failed to parse previous extraction mappings:", err);
        }
      }
    }
    return map;
  }, [previousExtractions]);

  useEffect(() => {
    if (extractionResult) {
      const initial: Record<string, GroupSelection> = {};
      for (const group of extractionResult.groups) {
        const prevCat = previousMappings.get(group.displayName);
        initial[group.displayName] = {
          selected: true,
          categoryId: prevCat || null,
        };
      }
      setSelections(initial);
      setStep("review");
    }
  }, [extractionResult, previousMappings]);

  const saveExtractionMutation = useMutation({
    mutationFn: async (data: { extractedData: string; documentName?: string; documentId?: string }) => {
      const res = await apiRequest("POST", `/api${apiBase}/bim-extractions`, data);
      return res.json();
    },
  });

  const importMutation = useMutation({
    mutationFn: async (data: { groups: any[]; extractionId: string; sheetName: string }) => {
      const res = await apiRequest("POST", `/api${apiBase}/bim-extractions/import`, data);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [`/api/${entityType}`, entityId, "takeoff", "sheets"] });
      queryClient.invalidateQueries({ queryKey: [`/api/${entityType}`, entityId, "bim-extractions"] });
      toast({
        title: "BIM quantities imported",
        description: `Created ${data.count} takeoff measurement(s) on "${sheetName}"`,
      });
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast({
        title: "Import failed",
        description: error?.message || "Failed to import BIM quantities",
        variant: "destructive",
      });
    },
  });

  const selectedGroups = extractionResult?.groups.filter(g => selections[g.displayName]?.selected) || [];
  const allSelected = extractionResult?.groups.every(g => selections[g.displayName]?.selected) || false;

  const toggleAll = () => {
    if (!extractionResult) return;
    const newVal = !allSelected;
    const next: Record<string, GroupSelection> = {};
    for (const group of extractionResult.groups) {
      next[group.displayName] = {
        ...selections[group.displayName],
        selected: newVal,
      };
    }
    setSelections(next);
  };

  const toggleGroup = (name: string) => {
    setSelections(prev => ({
      ...prev,
      [name]: { ...prev[name], selected: !prev[name]?.selected },
    }));
  };

  const setCategoryForGroup = (name: string, categoryId: string | null) => {
    setSelections(prev => ({
      ...prev,
      [name]: { ...prev[name], categoryId },
    }));
  };

  const handleImport = async () => {
    if (!extractionResult) return;

    const extraction = await saveExtractionMutation.mutateAsync({
      extractedData: JSON.stringify(extractionResult),
      documentName: extractionResult.fileName,
    });

    const groups = selectedGroups.map(g => ({
      ifcType: g.ifcType,
      displayName: g.displayName,
      count: g.count,
      totalLength: g.totalLength,
      totalArea: g.totalArea,
      totalVolume: g.totalVolume,
      materials: g.materials,
      categoryId: selections[g.displayName]?.categoryId || null,
    }));

    await importMutation.mutateAsync({
      groups,
      extractionId: extraction.id,
      sheetName,
    });
  };

  const formatQuantity = (val: number | null, unit: string) => {
    if (val === null || val === 0) return "—";
    return `${val.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${unit}`;
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2" data-testid="text-bim-dialog-title">
              <Box className="w-5 h-5" />
              {isExtracting ? "Extracting BIM Quantities..." : "BIM Quantity Extraction"}
            </DialogTitle>
          </DialogHeader>

          {isExtracting && (
            <div className="py-8 flex flex-col items-center gap-4">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground" data-testid="text-extraction-progress">
                Parsing IFC model... {extractionProgress}%
              </p>
              <Progress value={extractionProgress} className="w-64" />
            </div>
          )}

          {!isExtracting && extractionResult && (
            <>
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="outline" data-testid="badge-element-count">
                  <Layers className="w-3 h-3 mr-1" />
                  {extractionResult.totalElementCount} elements
                </Badge>
                <Badge variant="outline" data-testid="badge-group-count">
                  {extractionResult.groups.length} groups
                </Badge>
                <Badge variant="secondary" data-testid="badge-file-name">
                  <FileText className="w-3 h-3 mr-1" />
                  {extractionResult.fileName}
                </Badge>
                {latestPreviousExtraction && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowDiff(true)}
                    data-testid="button-show-diff"
                  >
                    Show Changes
                  </Button>
                )}
              </div>

              {step === "review" && (
                <>
                  <div className="flex items-center justify-between px-1 mb-1">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={allSelected}
                        onCheckedChange={toggleAll}
                        data-testid="checkbox-select-all"
                      />
                      <span className="text-sm font-medium">Select All</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {selectedGroups.length} of {extractionResult.groups.length} selected
                    </span>
                  </div>

                  <ScrollArea className="flex-1 max-h-[400px]">
                    <div className="space-y-1">
                      {extractionResult.groups.map((group) => (
                        <div
                          key={group.displayName}
                          className="flex items-center gap-3 px-3 py-2 rounded-md border hover:bg-accent/50 transition-colors"
                          data-testid={`row-bim-group-${group.ifcType}`}
                        >
                          <Checkbox
                            checked={selections[group.displayName]?.selected || false}
                            onCheckedChange={() => toggleGroup(group.displayName)}
                            data-testid={`checkbox-group-${group.ifcType}`}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm" data-testid={`text-group-name-${group.ifcType}`}>
                                {group.displayName}
                              </span>
                              <Badge variant="secondary" className="text-xs" data-testid={`badge-count-${group.ifcType}`}>
                                {group.count}
                              </Badge>
                            </div>
                            {group.materials.length > 0 && (
                              <p className="text-xs text-muted-foreground truncate mt-0.5">
                                {group.materials.join(", ")}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-4 text-xs text-muted-foreground shrink-0">
                            {group.totalLength !== null && (
                              <span data-testid={`text-length-${group.ifcType}`}>
                                {formatQuantity(group.totalLength, "ft")}
                              </span>
                            )}
                            {group.totalArea !== null && (
                              <span data-testid={`text-area-${group.ifcType}`}>
                                {formatQuantity(group.totalArea, "ft²")}
                              </span>
                            )}
                            {group.totalVolume !== null && (
                              <span data-testid={`text-volume-${group.ifcType}`}>
                                {formatQuantity(group.totalVolume, "ft³")}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </>
              )}

              {step === "map" && (
                <>
                  <p className="text-sm text-muted-foreground mb-2">
                    Assign each element group to a quantity category (cost code). Previous mappings are remembered.
                  </p>
                  <ScrollArea className="flex-1 max-h-[400px]">
                    <div className="space-y-2">
                      {selectedGroups.map((group) => (
                        <div
                          key={group.displayName}
                          className="flex items-center gap-3 px-3 py-2 rounded-md border"
                          data-testid={`row-map-group-${group.ifcType}`}
                        >
                          <div className="flex-1 min-w-0">
                            <span className="font-medium text-sm">{group.displayName}</span>
                            <span className="text-xs text-muted-foreground ml-2">({group.count})</span>
                          </div>
                          <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
                          <Select
                            value={selections[group.displayName]?.categoryId || "none"}
                            onValueChange={(val) => setCategoryForGroup(group.displayName, val === "none" ? null : val)}
                          >
                            <SelectTrigger className="w-48" data-testid={`select-category-${group.ifcType}`}>
                              <SelectValue placeholder="No category" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">No category</SelectItem>
                              {categories.map((cat) => (
                                <SelectItem key={cat.id} value={cat.id}>
                                  <div className="flex items-center gap-2">
                                    <span
                                      className="w-3 h-3 rounded-full shrink-0"
                                      style={{ backgroundColor: cat.color }}
                                    />
                                    {cat.name}
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </>
              )}

              {step === "confirm" && (
                <div className="py-4 space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="sheet-name">Takeoff Sheet Name</Label>
                    <Input
                      id="sheet-name"
                      value={sheetName}
                      onChange={(e) => setSheetName(e.target.value)}
                      placeholder="BIM Takeoff"
                      data-testid="input-bim-sheet-name"
                    />
                  </div>
                  <Separator />
                  <div className="text-sm space-y-1">
                    <p className="font-medium">Import Summary</p>
                    <p className="text-muted-foreground">
                      {selectedGroups.length} element group(s) will be imported as takeoff measurements.
                    </p>
                    <p className="text-muted-foreground">
                      {selectedGroups.filter(g => selections[g.displayName]?.categoryId).length} group(s) mapped to categories.
                    </p>
                    <p className="text-muted-foreground">
                      Total elements: {selectedGroups.reduce((sum, g) => sum + g.count, 0)}
                    </p>
                  </div>
                </div>
              )}
            </>
          )}

          <DialogFooter className="gap-2">
            {!isExtracting && extractionResult && (
              <>
                {step === "review" && (
                  <>
                    <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-bim">
                      Cancel
                    </Button>
                    <Button
                      onClick={() => setStep("map")}
                      disabled={selectedGroups.length === 0}
                      data-testid="button-next-map"
                    >
                      Next: Map Categories
                      <ArrowRight className="w-4 h-4 ml-1" />
                    </Button>
                  </>
                )}
                {step === "map" && (
                  <>
                    <Button variant="outline" onClick={() => setStep("review")} data-testid="button-back-review">
                      Back
                    </Button>
                    <Button onClick={() => setStep("confirm")} data-testid="button-next-confirm">
                      Next: Confirm Import
                      <ArrowRight className="w-4 h-4 ml-1" />
                    </Button>
                  </>
                )}
                {step === "confirm" && (
                  <>
                    <Button variant="outline" onClick={() => setStep("map")} data-testid="button-back-map">
                      Back
                    </Button>
                    <Button
                      onClick={handleImport}
                      disabled={importMutation.isPending || saveExtractionMutation.isPending}
                      data-testid="button-import-bim"
                    >
                      {importMutation.isPending || saveExtractionMutation.isPending ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                          Importing...
                        </>
                      ) : (
                        <>
                          <Download className="w-4 h-4 mr-1" />
                          Import to Takeoff
                        </>
                      )}
                    </Button>
                  </>
                )}
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {latestPreviousExtraction && extractionResult && (
        <BimDiffDialog
          open={showDiff}
          onOpenChange={setShowDiff}
          previousExtraction={latestPreviousExtraction}
          currentExtraction={extractionResult}
        />
      )}
    </>
  );
}
