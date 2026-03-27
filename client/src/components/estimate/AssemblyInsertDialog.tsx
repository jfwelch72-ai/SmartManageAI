import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Layers, Search, Package, ArrowRight, CheckCircle, AlertCircle } from "lucide-react";
import { apiRequest, queryClient, bidEstimateKey } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface AssemblyItem {
  id: string;
  name: string;
  formula: string;
  wasteFactor: number;
  unitCost: string | null;
  unit: string | null;
  displayOrder: number;
}

interface Assembly {
  id: string;
  name: string;
  assemblyNumber: string | null;
  unitOfMeasure: string;
  description: string | null;
  items: AssemblyItem[];
}

interface PreviewLineItem {
  name: string;
  formula: string;
  computedQty: number;
  wasteFactor: number;
  adjustedQty: number;
  unitCost: number;
  totalCost: number;
  unit: string;
}

function computePreview(items: AssemblyItem[], baseQty: number): PreviewLineItem[] {
  return items.map(item => {
    let computedQty = baseQty;
    try {
      const formula = (item.formula || "1")
        .replace(/quantity/gi, String(baseQty))
        .replace(/area/gi, String(baseQty))
        .replace(/volume/gi, String(baseQty))
        .replace(/perimeter/gi, String(baseQty * 4))
        .replace(/ridge_length/gi, String(baseQty * 0.3));
      if (/^[\d\s+\-*/().]+$/.test(formula)) {
        computedQty = Function(`"use strict"; return (${formula})`)();
      }
      if (isNaN(computedQty) || !isFinite(computedQty)) computedQty = baseQty;
    } catch {
      computedQty = baseQty;
    }

    const wf = item.wasteFactor || 0;
    const adjustedQty = computedQty * (1 + wf / 100);
    const unitCost = Number(item.unitCost || 0);
    const totalCost = adjustedQty * unitCost;

    return {
      name: item.name,
      formula: item.formula,
      computedQty: Math.round(computedQty * 100) / 100,
      wasteFactor: wf,
      adjustedQty: Math.round(adjustedQty * 100) / 100,
      unitCost,
      totalCost: Math.round(totalCost * 100) / 100,
      unit: item.unit || "EA",
    };
  });
}

function fmt(val: number) {
  return val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function AssemblyInsertDialog({
  estimateId,
  bidId,
  open,
  onOpenChange,
}: {
  estimateId: string;
  bidId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [step, setStep] = useState<"pick" | "preview">("pick");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedAssembly, setSelectedAssembly] = useState<Assembly | null>(null);
  const [baseQuantity, setBaseQuantity] = useState<number>(1);

  const { data: assemblies = [], isLoading } = useQuery<Assembly[]>({
    queryKey: ["/api/library-assemblies"],
    enabled: open,
  });

  const insertMutation = useMutation({
    mutationFn: async () => {
      if (!selectedAssembly) throw new Error("No assembly selected");
      const res = await apiRequest("POST", `/api/estimates/${estimateId}/insert-assembly`, {
        assemblyId: selectedAssembly.id,
        quantity: baseQuantity,
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: bidEstimateKey(bidId) });
      toast({
        title: "Assembly inserted",
        description: `${data.lineItemsCreated} line items created from "${data.assemblyName}"`,
      });
      handleClose();
    },
    onError: () => {
      toast({ title: "Failed to insert assembly", variant: "destructive" });
    },
  });

  const handleClose = () => {
    setStep("pick");
    setSelectedAssembly(null);
    setBaseQuantity(1);
    setSearchTerm("");
    onOpenChange(false);
  };

  const handleSelectAssembly = (assembly: Assembly) => {
    setSelectedAssembly(assembly);
    setStep("preview");
  };

  const filteredAssemblies = assemblies.filter(a =>
    !searchTerm ||
    a.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (a.description || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
    (a.assemblyNumber || "").toLowerCase().includes(searchTerm.toLowerCase())
  );

  const preview = selectedAssembly ? computePreview(selectedAssembly.items, baseQuantity) : [];
  const previewTotal = preview.reduce((sum, p) => sum + p.totalCost, 0);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="w-5 h-5" />
            {step === "pick" ? "Insert Assembly" : "Preview Line Items"}
          </DialogTitle>
          <DialogDescription>
            {step === "pick"
              ? "Select a library assembly to insert its items as estimate line items"
              : "Review the line items that will be created from this assembly"
            }
          </DialogDescription>
        </DialogHeader>

        {step === "pick" && (
          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search assemblies..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
                data-testid="input-search-assemblies"
              />
            </div>

            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading assemblies...</div>
            ) : filteredAssemblies.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Package className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p className="font-medium">No assemblies found</p>
                <p className="text-sm mt-1">Create assemblies in the Library to use them here</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {filteredAssemblies.map((assembly) => (
                  <Card
                    key={assembly.id}
                    className="cursor-pointer hover:border-primary transition-colors"
                    onClick={() => handleSelectAssembly(assembly)}
                    data-testid={`assembly-card-${assembly.id}`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-sm">{assembly.name}</span>
                            {assembly.assemblyNumber && (
                              <Badge variant="outline" className="text-xs">{assembly.assemblyNumber}</Badge>
                            )}
                          </div>
                          {assembly.description && (
                            <p className="text-xs text-muted-foreground line-clamp-2">{assembly.description}</p>
                          )}
                          <div className="flex items-center gap-2 mt-2">
                            <Badge variant="secondary" className="text-xs">
                              {assembly.items?.length || 0} items
                            </Badge>
                            <Badge variant="secondary" className="text-xs">
                              UOM: {assembly.unitOfMeasure}
                            </Badge>
                          </div>
                        </div>
                        <ArrowRight className="w-4 h-4 text-muted-foreground mt-1 shrink-0" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {step === "preview" && selectedAssembly && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg">
              <CheckCircle className="w-4 h-4 text-green-600" />
              <span className="text-sm font-medium">{selectedAssembly.name}</span>
              {selectedAssembly.assemblyNumber && (
                <Badge variant="outline" className="text-xs">{selectedAssembly.assemblyNumber}</Badge>
              )}
            </div>

            <div className="flex items-center gap-4">
              <label className="text-sm font-medium whitespace-nowrap">Base Quantity ({selectedAssembly.unitOfMeasure}):</label>
              <Input
                type="number"
                min={0.01}
                step={0.01}
                value={baseQuantity}
                onChange={(e) => setBaseQuantity(Number(e.target.value) || 1)}
                className="w-32"
                data-testid="input-assembly-quantity"
              />
            </div>

            {preview.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground">
                <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">This assembly has no items</p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto border rounded-lg">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Waste %</TableHead>
                        <TableHead className="text-right">Adj. Qty</TableHead>
                        <TableHead>Unit</TableHead>
                        <TableHead className="text-right">Unit Cost</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.map((item, idx) => (
                        <TableRow key={idx} data-testid={`preview-item-${idx}`}>
                          <TableCell className="font-medium text-sm">{item.name}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmt(item.computedQty)}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{item.wasteFactor}%</TableCell>
                          <TableCell className="text-right tabular-nums font-medium">{fmt(item.adjustedQty)}</TableCell>
                          <TableCell className="text-muted-foreground text-xs">{item.unit}</TableCell>
                          <TableCell className="text-right tabular-nums">${fmt(item.unitCost)}</TableCell>
                          <TableCell className="text-right tabular-nums font-medium">${fmt(item.totalCost)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                  <span className="font-medium text-sm">Total Material Cost</span>
                  <span className="text-lg font-bold font-mono" data-testid="text-assembly-preview-total">
                    ${fmt(previewTotal)}
                  </span>
                </div>
              </>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          {step === "preview" && (
            <Button variant="outline" onClick={() => setStep("pick")} data-testid="button-assembly-back">
              Back
            </Button>
          )}
          <Button variant="outline" onClick={handleClose} data-testid="button-assembly-cancel">
            Cancel
          </Button>
          {step === "preview" && (
            <Button
              onClick={() => insertMutation.mutate()}
              disabled={insertMutation.isPending || preview.length === 0}
              data-testid="button-assembly-confirm"
            >
              {insertMutation.isPending ? "Inserting..." : `Insert ${preview.length} Line Items`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
