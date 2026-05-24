import { useState, useEffect, useRef } from "react";
import { UseFormReturn } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from "@/components/ui/dialog";
import { Plus, FileText, CheckCircle, Calculator, Layers, Tag, Store, Database, Search, Camera, X, Upload, Loader2, Hash, GripVertical, Sparkles } from "lucide-react";
import { PayItemPicker, type SelectedPayItem } from "@/components/dot/PayItemPicker";
import { CostBookPickerButton, CrewTemplatePickerButton } from "@/components/estimate/CostBookCrewPickers";
import { useFeatureFlags } from "@/hooks/use-feature-flags";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import StandardizedScopeSelector, { ScopeSelectionData } from "@/components/StandardizedScopeSelector";
import AiSuggestionAffordance from "@/components/AiSuggestionAffordance";
import HierarchicalLineItemBuilder, { LineItemSelectionData } from "@/components/HierarchicalLineItemBuilder";
import ModifierSelector from "@/components/ModifierSelector";
import { UomSelect } from "@/components/UomSelect";
import MaterialCalculator, { type MaterialCalculatorData } from "@/components/MaterialCalculator";
import { ManualMaterialPricing } from "@/components/ManualMaterialPricing";
import { EnrichmentDrawer } from "@/components/estimate/EnrichmentDrawer";
import { LaborRateSelector } from "@/components/LaborRateSelector";
import { EquipmentRateSelector } from "@/components/EquipmentRateSelector";
import { Checkbox } from "@/components/ui/checkbox";
import type { BidSubcontractorQuote } from "@shared/schema";
import type { LineItemFormValues, CatalogPriceItem, WorkCategory, SubcontractorAssignment } from "@/lib/estimate-utils";
import { shouldAutoShowMaterialCalc } from "@/lib/estimate-utils";

function SubcontractorAssignmentPanel({
  quotes,
  assignments,
  onAssignmentsChange,
  testPrefix = "",
}: {
  quotes: BidSubcontractorQuote[];
  assignments: SubcontractorAssignment[];
  onAssignmentsChange: (assignments: SubcontractorAssignment[]) => void;
  testPrefix?: string;
}) {
  const [compareMode, setCompareMode] = useState(false);

  const toggleQuote = (quoteId: string, checked: boolean) => {
    if (checked) {
      const quote = quotes.find(q => q.id === quoteId);
      onAssignmentsChange([
        ...assignments,
        {
          subcontractorQuoteId: quoteId,
          allocatedCost: Number(quote?.quoteAmount || 0),
          isSelected: true,
        },
      ]);
    } else {
      onAssignmentsChange(assignments.filter(a => a.subcontractorQuoteId !== quoteId));
    }
  };

  const updateAllocatedCost = (quoteId: string, cost: number) => {
    onAssignmentsChange(
      assignments.map(a =>
        a.subcontractorQuoteId === quoteId ? { ...a, allocatedCost: cost } : a
      )
    );
  };

  const totalAllocated = assignments
    .filter(a => a.isSelected)
    .reduce((sum, a) => sum + Number(a.allocatedCost || 0), 0);

  return (
    <div className="col-span-2 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Subcontractor Quotes</h4>
        <Button
          type="button"
          variant={compareMode ? "default" : "outline"}
          size="sm"
          onClick={() => setCompareMode(!compareMode)}
          data-testid={`button-${testPrefix}compare-quotes`}
        >
          {compareMode ? "Hide Comparison" : "Compare Quotes"}
        </Button>
      </div>

      {compareMode && (
        <Card className="border-blue-200 dark:border-blue-800">
          <CardContent className="p-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subcontractor</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead className="text-right">Quote Amount</TableHead>
                  <TableHead>Lead Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quotes.map((quote) => (
                  <TableRow key={quote.id} data-testid={`row-compare-quote-${quote.id}`}>
                    <TableCell className="font-medium">{quote.subcontractorName}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">{quote.scopeOfWork}</TableCell>
                    <TableCell className="text-right font-medium">${Number(quote.quoteAmount).toLocaleString()}</TableCell>
                    <TableCell className="text-sm">{quote.leadTime || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {quotes.map((quote) => {
          const assignment = assignments.find(a => a.subcontractorQuoteId === quote.id);
          const isChecked = !!assignment;

          return (
            <div
              key={quote.id}
              className={`flex items-center gap-3 p-3 rounded-lg border ${isChecked ? "border-primary bg-primary/5" : "border-border"}`}
              data-testid={`sub-assignment-${quote.id}`}
            >
              <Checkbox
                checked={isChecked}
                onCheckedChange={(checked) => toggleQuote(quote.id, !!checked)}
                data-testid={`checkbox-${testPrefix}sub-${quote.id}`}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{quote.subcontractorName}</span>
                  <Badge variant="secondary" className="text-xs">
                    ${Number(quote.quoteAmount).toLocaleString()}
                  </Badge>
                  {quote.leadTime && (
                    <span className="text-xs text-muted-foreground">{quote.leadTime}</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">{quote.scopeOfWork}</p>
              </div>
              {isChecked && (
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground whitespace-nowrap">Allocated $</label>
                  <Input
                    type="text"
                    inputMode="decimal"
                    className="w-28 h-8 text-sm"
                    value={assignment?.allocatedCost ?? ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === "" || /^\d*\.?\d*$/.test(val)) {
                        updateAllocatedCost(quote.id, parseFloat(val) || 0);
                      }
                    }}
                    data-testid={`input-${testPrefix}sub-allocated-${quote.id}`}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {assignments.length > 0 && (
        <div className="flex items-center justify-between px-3 py-2 bg-muted/50 rounded-lg" data-testid={`text-${testPrefix}sub-total`}>
          <span className="text-sm font-medium">Total Allocated</span>
          <span className="font-semibold">${totalAllocated.toLocaleString()}</span>
        </div>
      )}
    </div>
  );
}

function PayItemRow({ form, testPrefix }: { form: UseFormReturn<LineItemFormValues>; testPrefix: string }) {
  const { isEnabled } = useFeatureFlags();
  const [pickerOpen, setPickerOpen] = useState(false);
  const payItemNumber = form.watch("payItemNumber");
  const specSection = form.watch("specSection");
  const dotPayItemId = form.watch("dotPayItemId");
  const seedDescription = form.watch("description");
  const seedUnit = form.watch("unit");
  const seedCategory = form.watch("category");

  // Hide DOT pay-item picker entirely when the org has the flag off, but keep
  // showing existing linkage on legacy lines so users can clear or replace it.
  if (!isEnabled("DOT_PAY_ITEMS") && !dotPayItemId) {
    return null;
  }

  const handleSelect = async (selected: SelectedPayItem) => {
    form.setValue("dotPayItemId", selected.payItem.id, { shouldDirty: true });
    form.setValue("dotSpecBookId", selected.specBook.id, { shouldDirty: true });
    form.setValue("payItemNumber", selected.payItem.itemNumber, { shouldDirty: true });
    form.setValue("specSection", selected.payItem.specSection ?? null, { shouldDirty: true });
    if (!form.getValues("description")) {
      form.setValue("description", selected.payItem.description, { shouldDirty: true });
    }
    if (!form.getValues("unit") && selected.payItem.unit) {
      form.setValue("unit", selected.payItem.unit, { shouldDirty: true });
    }
    // Prefill unit price from the org's most recent estimate that used this
    // pay item, when the line has no cost yet. Splits the historical unit
    // price back into material/labor/equipment components as recorded.
    const currentMat = Number(form.getValues("materialCost")) || 0;
    const currentLabor = Number(form.getValues("laborCost")) || 0;
    const currentEquip = Number(form.getValues("equipmentCost")) || 0;
    if (currentMat === 0 && currentLabor === 0 && currentEquip === 0) {
      try {
        const r = await fetch(`/api/dot/pay-items/${selected.payItem.id}/recent-price`, { credentials: "include" });
        if (r.ok) {
          const data: { unitPrice: number | null; materialCost?: number; laborCost?: number; equipmentCost?: number } = await r.json();
          if (data && data.unitPrice && data.unitPrice > 0) {
            form.setValue("materialCost", data.materialCost ?? data.unitPrice, { shouldDirty: true });
            if (data.laborCost) form.setValue("laborCost", data.laborCost, { shouldDirty: true });
            if (data.equipmentCost) form.setValue("equipmentCost", data.equipmentCost, { shouldDirty: true });
          }
        }
      } catch {
        /* prefill is best-effort */
      }
    }
    setPickerOpen(false);
  };

  const handleClear = () => {
    form.setValue("dotPayItemId", null, { shouldDirty: true });
    form.setValue("dotSpecBookId", null, { shouldDirty: true });
    form.setValue("payItemNumber", null, { shouldDirty: true });
    form.setValue("specSection", null, { shouldDirty: true });
  };

  return (
    <div className="col-span-2 flex flex-wrap items-center gap-2 p-3 bg-muted/30 rounded-md border">
      <Hash className="h-4 w-4 text-primary" />
      <span className="text-sm font-medium">DOT Pay Item</span>
      {dotPayItemId && payItemNumber ? (
        <>
          <Badge variant="secondary" className="font-mono" data-testid={`badge-${testPrefix}pay-item-number`}>
            {payItemNumber}
          </Badge>
          {specSection && (
            <span className="text-xs text-muted-foreground" data-testid={`text-${testPrefix}spec-section`}>
              §{specSection}
            </span>
          )}
          <Button type="button" size="sm" variant="ghost" onClick={() => setPickerOpen(true)} data-testid={`button-${testPrefix}change-pay-item`}>
            Change
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={handleClear} data-testid={`button-${testPrefix}clear-pay-item`}>
            <X className="h-3 w-3" />
          </Button>
        </>
      ) : (
        <Button type="button" size="sm" variant="outline" onClick={() => setPickerOpen(true)} data-testid={`button-${testPrefix}select-pay-item`}>
          <Plus className="h-3 w-3 mr-1" /> Link DOT Pay Item
        </Button>
      )}
      <span className="text-xs text-muted-foreground ml-auto">Optional — required for DOT/heavy-civil bids</span>
      <PayItemPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={handleSelect}
        seedDescription={seedDescription ?? ""}
        seedUnit={seedUnit ?? null}
        seedCategory={seedCategory ?? null}
      />
    </div>
  );
}

interface LineItemFormDialogProps {
  mode: "add" | "edit";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: UseFormReturn<LineItemFormValues>;
  onSubmit: (values: LineItemFormValues) => void;
  isPending: boolean;
  overheadPercent: number;
  profitMarginPercent: number;
  workCategories: WorkCategory[];
  catalogPrices: CatalogPriceItem[];
  subcontractorQuotes: BidSubcontractorQuote[];
  materialCalcData: MaterialCalculatorData;
  onMaterialCalcChange: (data: MaterialCalculatorData) => void;
  catalogPricedMaterials: Set<string>;
  onCatalogPricedMaterialsChange: (materials: Set<string>) => void;
  onCategoryChange: (value: string) => void;
  onApplyCatalogPrice: (item: CatalogPriceItem) => void;
  equipmentSelectorKey: number;
  estimateId?: string;
  lineItemId?: string;
  lineItemSource?: string;
  useHierarchicalBuilder?: boolean;
  onUseHierarchicalBuilderChange?: (value: boolean) => void;
  selectedScopeData?: ScopeSelectionData | null;
  onScopeSelect?: (data: ScopeSelectionData) => void;
  hierarchicalSelection?: LineItemSelectionData | null;
  onHierarchicalSelectionChange?: (data: LineItemSelectionData | null) => void;
  hierarchicalQuantity?: number;
  onHierarchicalQuantityChange?: (q: number) => void;
  hierarchicalUnit?: string;
  onHierarchicalUnitChange?: (u: string) => void;
  aiEstimatorEnabled?: boolean;
  aiEstimatorBidId?: string;
}

interface HistoricalCostRecord {
  id: string;
  description: string;
  scopeCategory: string;
  trade: string | null;
  costCode: string | null;
  quantity: string;
  unit: string;
  unitCost: string;
  totalCost: string;
  projectName: string | null;
}

function LineItemPhotoGallery({
  estimateId,
  lineItemId,
  testPrefix,
  legacyPhotoUrl,
  photoUrls,
  onChange,
}: {
  estimateId: string;
  lineItemId: string;
  testPrefix: string;
  legacyPhotoUrl: string | null;
  photoUrls: string[];
  onChange: (photoUrls: string[], legacyPhotoUrl: string | null) => void;
}) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadQueue, setUploadQueue] = useState<
    Array<{ id: string; name: string; size: number; status: "pending" | "uploading" | "done" | "error"; progress: number; error?: string }>
  >([]);
  const dragCounter = useRef(0);
  const [reorderDragIndex, setReorderDragIndex] = useState<number | null>(null);
  const [reorderOverIndex, setReorderOverIndex] = useState<number | null>(null);
  const reorderSeqRef = useRef(0);
  const reorderLatestSeqRef = useRef(0);

  const allUrls = (() => {
    const set = new Set<string>();
    if (legacyPhotoUrl) set.add(legacyPhotoUrl);
    for (const u of photoUrls) if (u) set.add(u);
    return Array.from(set);
  })();

  const isUploading = uploadQueue.some((q) => q.status === "pending" || q.status === "uploading");

  const uploadOne = (
    file: File,
    onProgress: (pct: number) => void,
  ): Promise<{ photoUrl: string; photoUrls?: string[] }> => {
    return new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append("photo", file);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/estimates/${estimateId}/line-items/${lineItemId}/upload-photo`);
      xhr.withCredentials = true;
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch {
            reject(new Error("Invalid server response"));
          }
        } else {
          let msg = "Upload failed";
          try {
            const parsed = JSON.parse(xhr.responseText);
            if (parsed?.error) msg = parsed.error;
          } catch {}
          reject(new Error(msg));
        }
      };
      xhr.onerror = () => reject(new Error("Network error"));
      xhr.send(formData);
    });
  };

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const MAX_SIZE = 10 * 1024 * 1024;
    const MAX_PHOTOS_PER_LINE_ITEM = 30;
    const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];

    const remaining = Math.max(0, MAX_PHOTOS_PER_LINE_ITEM - allUrls.length);
    if (remaining <= 0) {
      toast({
        title: `Photo limit reached`,
        description: `A line item can have at most ${MAX_PHOTOS_PER_LINE_ITEM} photos.`,
        variant: "destructive",
      });
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    let acceptedFiles = files;
    if (files.length > remaining) {
      acceptedFiles = files.slice(0, remaining);
      toast({
        title: `Only ${remaining} more photo${remaining === 1 ? "" : "s"} allowed`,
        description: `This line item is limited to ${MAX_PHOTOS_PER_LINE_ITEM} photos. ${files.length - remaining} file${files.length - remaining === 1 ? " was" : "s were"} skipped.`,
        variant: "destructive",
      });
    }

    const items = acceptedFiles.map((f) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file: f,
      name: f.name,
      size: f.size,
    }));

    setUploadQueue((prev) => [
      ...prev,
      ...items.map((it) => ({
        id: it.id,
        name: it.name,
        size: it.size,
        status: "pending" as const,
        progress: 0,
      })),
    ]);

    let currentLegacy = legacyPhotoUrl;
    let currentUrls = allUrls.slice();
    let successCount = 0;
    let failCount = 0;

    for (const it of items) {
      if (!allowedTypes.includes(it.file.type)) {
        setUploadQueue((prev) =>
          prev.map((q) =>
            q.id === it.id ? { ...q, status: "error", error: "Unsupported file type" } : q,
          ),
        );
        failCount++;
        continue;
      }
      if (it.size > MAX_SIZE) {
        setUploadQueue((prev) =>
          prev.map((q) => (q.id === it.id ? { ...q, status: "error", error: "Larger than 10MB" } : q)),
        );
        failCount++;
        continue;
      }

      setUploadQueue((prev) =>
        prev.map((q) => (q.id === it.id ? { ...q, status: "uploading", progress: 0 } : q)),
      );

      try {
        const data = await uploadOne(it.file, (pct) => {
          setUploadQueue((prev) => prev.map((q) => (q.id === it.id ? { ...q, progress: pct } : q)));
        });
        const nextUrls: string[] = Array.isArray(data.photoUrls)
          ? data.photoUrls
          : [...currentUrls, data.photoUrl];
        const nextLegacy: string | null = data.photoUrl ?? currentLegacy;
        currentUrls = nextUrls;
        currentLegacy = nextLegacy;
        onChange(nextUrls, nextLegacy);
        setUploadQueue((prev) =>
          prev.map((q) => (q.id === it.id ? { ...q, status: "done", progress: 100 } : q)),
        );
        successCount++;
      } catch (err: any) {
        setUploadQueue((prev) =>
          prev.map((q) =>
            q.id === it.id ? { ...q, status: "error", error: err?.message || "Upload failed" } : q,
          ),
        );
        failCount++;
      }
    }

    if (fileInputRef.current) fileInputRef.current.value = "";

    if (successCount > 0 && failCount === 0) {
      toast({
        title:
          successCount === 1
            ? "Photo attached successfully"
            : `${successCount} photos attached successfully`,
      });
    } else if (successCount > 0 && failCount > 0) {
      toast({
        title: `${successCount} uploaded, ${failCount} failed`,
        variant: "destructive",
      });
    } else if (failCount > 0) {
      toast({
        title: failCount === 1 ? "Photo upload failed" : `${failCount} photo uploads failed`,
        variant: "destructive",
      });
    }

    window.setTimeout(() => {
      setUploadQueue((prev) => prev.filter((q) => q.status !== "done"));
    }, 2500);
  };

  const persistOrder = async (orderedUrls: string[], seq: number, prevUrls: string[], prevLegacy: string | null) => {
    try {
      const res = await apiRequest(
        "PUT",
        `/api/estimates/${estimateId}/line-items/${lineItemId}/photos/order`,
        { photoUrls: orderedUrls },
      );
      const data = await res.json().catch(() => ({}));
      if (seq !== reorderLatestSeqRef.current) return;
      const nextUrls: string[] = Array.isArray(data.photoUrls) ? data.photoUrls : orderedUrls;
      const nextLegacy: string | null =
        typeof data.photoUrl === "string" || data.photoUrl === null
          ? data.photoUrl
          : nextUrls[0] ?? null;
      onChange(nextUrls, nextLegacy);
    } catch (err: any) {
      if (seq !== reorderLatestSeqRef.current) return;
      toast({ title: err?.message || "Failed to reorder photos", variant: "destructive" });
      onChange(prevUrls, prevLegacy);
    }
  };

  const handleReorder = (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0) return;
    if (fromIdx >= allUrls.length || toIdx >= allUrls.length) return;
    const prevUrls = allUrls.slice();
    const prevLegacy = legacyPhotoUrl;
    const next = allUrls.slice();
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    const nextLegacy = next.length > 0 ? next[0] : null;
    reorderSeqRef.current += 1;
    const seq = reorderSeqRef.current;
    reorderLatestSeqRef.current = seq;
    onChange(next, nextLegacy);
    void persistOrder(next, seq, prevUrls, prevLegacy);
  };

  const handleRemove = async (url: string) => {
    try {
      const res = await fetch(
        `/api/estimates/${estimateId}/line-items/${lineItemId}/photo?url=${encodeURIComponent(url)}`,
        { method: "DELETE", credentials: "include" },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Delete failed" }));
        throw new Error(err.error || "Delete failed");
      }
      const data = await res.json().catch(() => ({}));
      const nextUrls: string[] = Array.isArray(data.photoUrls)
        ? data.photoUrls
        : allUrls.filter((u) => u !== url);
      const nextLegacy = legacyPhotoUrl === url ? null : legacyPhotoUrl;
      onChange(nextUrls, nextLegacy);
      toast({ title: "Photo removed" });
    } catch (err: any) {
      toast({ title: err?.message || "Failed to remove photo", variant: "destructive" });
    }
  };

  return (
    <div className="mt-2 space-y-3">
      {allUrls.length > 0 && (
        <div
          className="flex flex-wrap gap-3"
          data-testid={`gallery-${testPrefix}line-item-photos`}
        >
          {allUrls.map((url, idx) => {
            const isDraggingThis = reorderDragIndex === idx;
            const isDropTarget = reorderOverIndex === idx && reorderDragIndex !== null && reorderDragIndex !== idx;
            return (
              <div
                key={url}
                draggable
                onDragStart={(e) => {
                  setReorderDragIndex(idx);
                  e.dataTransfer.effectAllowed = "move";
                  try {
                    e.dataTransfer.setData("text/x-line-item-photo-index", String(idx));
                  } catch {}
                }}
                onDragOver={(e) => {
                  if (reorderDragIndex === null) return;
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = "move";
                  if (reorderOverIndex !== idx) setReorderOverIndex(idx);
                }}
                onDragLeave={(e) => {
                  e.stopPropagation();
                  if (reorderOverIndex === idx) setReorderOverIndex(null);
                }}
                onDrop={(e) => {
                  if (reorderDragIndex === null) return;
                  e.preventDefault();
                  e.stopPropagation();
                  const from = reorderDragIndex;
                  setReorderDragIndex(null);
                  setReorderOverIndex(null);
                  handleReorder(from, idx);
                }}
                onDragEnd={() => {
                  setReorderDragIndex(null);
                  setReorderOverIndex(null);
                }}
                className={`relative group cursor-move rounded-lg ${
                  isDraggingThis ? "opacity-50" : ""
                } ${isDropTarget ? "ring-2 ring-primary ring-offset-1" : ""}`}
                data-testid={`thumb-${testPrefix}line-item-photo-${idx}`}
                aria-grabbed={isDraggingThis}
              >
                <button
                  type="button"
                  onClick={() => setLightboxUrl(url)}
                  className="block focus:outline-none focus:ring-2 focus:ring-ring rounded-lg"
                  data-testid={`button-${testPrefix}view-photo-${idx}`}
                  aria-label="View photo full size"
                >
                  <img
                    src={url}
                    alt={`Line item photo ${idx + 1}`}
                    className="h-24 w-24 rounded-lg border border-border object-cover transition-transform hover:scale-105"
                    data-testid={`img-${testPrefix}line-item-photo-${idx}`}
                    draggable={false}
                  />
                </button>
                <div
                  className="pointer-events-none absolute top-1 left-1 rounded bg-black/60 p-0.5 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-hidden="true"
                  data-testid={`handle-${testPrefix}reorder-photo-${idx}`}
                >
                  <GripVertical className="h-3 w-3" />
                </div>
                {idx === 0 && (
                  <span
                    className="absolute bottom-1 left-1 rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground"
                    data-testid={`badge-${testPrefix}cover-photo`}
                  >
                    Cover
                  </span>
                )}
                <Button
                  type="button"
                  variant="destructive"
                  size="icon"
                  className="absolute -top-2 -right-2 h-6 w-6 rounded-full opacity-90 group-hover:opacity-100"
                  onClick={() => handleRemove(url)}
                  data-testid={`button-${testPrefix}remove-photo-${idx}`}
                  aria-label="Remove photo"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <div
        onDragEnter={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (isUploading) return;
          dragCounter.current += 1;
          if (e.dataTransfer?.types?.includes("Files")) setIsDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (isUploading) return;
          dragCounter.current -= 1;
          if (dragCounter.current <= 0) {
            dragCounter.current = 0;
            setIsDragOver(false);
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (e.dataTransfer) e.dataTransfer.dropEffect = isUploading ? "none" : "copy";
        }}
        onDrop={async (e) => {
          e.preventDefault();
          e.stopPropagation();
          dragCounter.current = 0;
          setIsDragOver(false);
          if (isUploading) {
            toast({
              title: "Please wait for the current upload batch to finish",
              variant: "destructive",
            });
            return;
          }
          const all = Array.from(e.dataTransfer?.files || []);
          const dropped = all.filter((f) => f.type.startsWith("image/"));
          const skipped = all.length - dropped.length;
          if (skipped > 0) {
            toast({
              title:
                skipped === 1
                  ? "Skipped 1 non-image file"
                  : `Skipped ${skipped} non-image files`,
              variant: "destructive",
            });
          }
          if (dropped.length > 0) await handleFiles(dropped);
        }}
        className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors ${
          isDragOver ? "border-primary bg-primary/5" : "border-border bg-muted/30"
        }`}
        data-testid={`dropzone-${testPrefix}line-item-photos`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          multiple
          className="hidden"
          data-testid={`input-${testPrefix}photo-file`}
          onChange={async (e) => {
            const files = Array.from(e.target.files || []);
            if (files.length === 0) return;
            await handleFiles(files);
          }}
        />
        <Upload className="h-5 w-5 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          {isDragOver ? "Drop images to upload" : "Drag & drop images here, or click to select"}
        </p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isUploading}
            onClick={() => fileInputRef.current?.click()}
            data-testid={`button-${testPrefix}upload-photo`}
          >
            {isUploading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Camera className="h-4 w-4 mr-2" />
            )}
            {isUploading
              ? "Uploading..."
              : allUrls.length > 0
                ? "Add More Photos"
                : "Select Photos"}
          </Button>
          {allUrls.length > 0 && (
            <span className="text-xs text-muted-foreground" data-testid={`text-${testPrefix}photo-count`}>
              {allUrls.length} photo{allUrls.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">JPEG, PNG, GIF, or WebP up to 10MB each</p>
      </div>

      {uploadQueue.length > 0 && (
        <div
          className="space-y-2 rounded-md border border-border bg-card p-2"
          data-testid={`list-${testPrefix}upload-progress`}
        >
          {uploadQueue.map((q) => (
            <div
              key={q.id}
              className="flex items-center gap-2 text-xs"
              data-testid={`row-${testPrefix}upload-${q.id}`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate" title={q.name}>
                    {q.name}
                  </span>
                  <span
                    className={
                      q.status === "error"
                        ? "text-destructive shrink-0"
                        : q.status === "done"
                          ? "text-green-600 shrink-0"
                          : "text-muted-foreground shrink-0"
                    }
                    data-testid={`status-${testPrefix}upload-${q.id}`}
                  >
                    {q.status === "error"
                      ? q.error || "Failed"
                      : q.status === "done"
                        ? "Uploaded"
                        : q.status === "uploading"
                          ? `${q.progress}%`
                          : "Queued"}
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-muted">
                  <div
                    className={`h-full transition-all ${
                      q.status === "error"
                        ? "bg-destructive"
                        : q.status === "done"
                          ? "bg-green-600"
                          : "bg-primary"
                    }`}
                    style={{ width: `${q.status === "error" ? 100 : q.progress}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={lightboxUrl !== null} onOpenChange={(open) => !open && setLightboxUrl(null)}>
        <DialogContent
          className="max-w-4xl p-2"
          data-testid={`dialog-${testPrefix}photo-lightbox`}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Photo preview</DialogTitle>
            <DialogDescription>Full-size view of the line item photo</DialogDescription>
          </DialogHeader>
          {lightboxUrl && (
            <img
              src={lightboxUrl}
              alt="Line item photo full size"
              className="w-full h-auto max-h-[80vh] object-contain rounded"
              data-testid={`img-${testPrefix}photo-lightbox`}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function HistoricalCostImportButton({ form }: { form: UseFormReturn<LineItemFormValues> }) {
  const [importOpen, setImportOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const { data: records = [], isLoading } = useQuery<HistoricalCostRecord[]>({
    queryKey: ["/api/historical-costs", searchTerm],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchTerm) params.set("search", searchTerm);
      params.set("limit", "20");
      const res = await fetch(`/api/historical-costs?${params.toString()}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: importOpen,
  });

  const handleSelect = (record: HistoricalCostRecord) => {
    form.setValue("description", record.description);
    form.setValue("unit", record.unit);
    form.setValue("quantity", Number(record.quantity) || 0);
    form.setValue("materialCost", Number(record.unitCost) || 0);
    setImportOpen(false);
    setSearchTerm("");
  };

  return (
    <Dialog open={importOpen} onOpenChange={setImportOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" data-testid="button-import-from-history">
          <Database className="h-4 w-4 mr-2" />
          Import from History
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import from Historical Costs</DialogTitle>
          <DialogDescription>Select a historical cost record to populate line item fields</DialogDescription>
        </DialogHeader>
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search historical costs..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
            data-testid="input-search-history-import"
          />
        </div>
        {isLoading ? (
          <div className="text-center py-6 text-muted-foreground">Loading...</div>
        ) : records.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <Database className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No historical cost records found</p>
          </div>
        ) : (
          <div className="overflow-x-auto border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead className="text-right">$/Unit</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((record) => (
                  <TableRow key={record.id} data-testid={`row-history-import-${record.id}`}>
                    <TableCell className="font-medium text-sm max-w-[200px] truncate">{record.description}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{record.scopeCategory}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      ${Number(record.unitCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-xs">{record.unit}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[100px] truncate">{record.projectName || "—"}</TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleSelect(record)}
                        data-testid={`button-use-history-${record.id}`}
                      >
                        Use
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function LineItemFormDialog({
  mode,
  open,
  onOpenChange,
  form,
  onSubmit,
  isPending,
  overheadPercent,
  profitMarginPercent,
  workCategories,
  catalogPrices,
  subcontractorQuotes,
  materialCalcData,
  onMaterialCalcChange,
  catalogPricedMaterials,
  onCatalogPricedMaterialsChange,
  onCategoryChange,
  onApplyCatalogPrice,
  equipmentSelectorKey,
  estimateId,
  lineItemId,
  lineItemSource,
  useHierarchicalBuilder = false,
  onUseHierarchicalBuilderChange,
  selectedScopeData,
  onScopeSelect,
  hierarchicalSelection,
  onHierarchicalSelectionChange,
  hierarchicalQuantity = 0,
  onHierarchicalQuantityChange,
  hierarchicalUnit = "",
  onHierarchicalUnitChange,
  aiEstimatorEnabled = false,
  aiEstimatorBidId,
}: LineItemFormDialogProps) {
  const isAdd = mode === "add";
  const isEdit = mode === "edit";
  const testPrefix = isEdit ? "edit-" : "";
  const [manualCalcToggle, setManualCalcToggle] = useState(false);
  const [numericDisplayValues, setNumericDisplayValues] = useState<Record<string, string>>({});
  const [enrichmentDrawerOpen, setEnrichmentDrawerOpen] = useState(false);
  const { toast } = useToast();
  
  useEffect(() => {
    if (!open) {
      setManualCalcToggle(false);
      setNumericDisplayValues({});
    }
  }, [open]);

  const currentAssignments = form.watch("subcontractorAssignments") || [];
  const hasMultiSubAssignments = currentAssignments.length > 0;

  type NumericLineItemField = 'quantity' | 'materialCost' | 'laborCost' | 'laborHours'
    | 'equipmentCost' | 'equipmentHours' | 'consumablesCost'
    | 'subcontractCost' | 'overheadAllocation' | 'profitAllocation';

  const setNumericFormValue = (fieldName: NumericLineItemField, value: number) => {
    form.setValue(fieldName, value, { shouldDirty: true, shouldValidate: false });
  };

  const numericInputProps = (field: { value: number; onChange: (v: number) => void; onBlur: () => void; name: string; ref: React.Ref<HTMLInputElement> }) => {
    const displayValue = numericDisplayValues[field.name];
    const showValue = displayValue !== undefined ? displayValue : (field.value != null && field.value !== 0 ? String(field.value) : '');

    return {
      type: "text" as const,
      inputMode: "decimal" as const,
      ref: field.ref,
      name: field.name,
      onBlur: () => {
        const pendingDisplay = numericDisplayValues[field.name];
        if (pendingDisplay !== undefined) {
          const parsed = pendingDisplay === '' ? 0 : parseFloat(pendingDisplay);
          const value = Number.isNaN(parsed) ? 0 : parsed;
          setNumericFormValue(field.name as NumericLineItemField, value);
        }
        setNumericDisplayValues(prev => {
          const next = { ...prev };
          delete next[field.name];
          return next;
        });
        field.onBlur();
      },
      value: showValue,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value;
        if (raw === '' || /^\d*\.?\d*$/.test(raw)) {
          setNumericDisplayValues(prev => ({ ...prev, [field.name]: raw }));
          const parsed = raw === '' ? 0 : parseFloat(raw);
          const value = Number.isNaN(parsed) ? 0 : parsed;
          field.onChange(value);
          setNumericFormValue(field.name as NumericLineItemField, value);
        }
      },
    };
  };

  const numericFieldNames: NumericLineItemField[] = [
    'quantity', 'materialCost', 'laborCost', 'laborHours',
    'equipmentCost', 'equipmentHours', 'consumablesCost',
    'subcontractCost', 'overheadAllocation', 'profitAllocation',
  ];

  const handleSubmitWithFlush = (values: LineItemFormValues) => {
    const flushed: LineItemFormValues = { ...values };
    for (const fieldName of numericFieldNames) {
      const displayVal = numericDisplayValues[fieldName];
      if (displayVal !== undefined) {
        const parsed = displayVal === '' ? 0 : parseFloat(displayVal);
        flushed[fieldName] = Number.isNaN(parsed) ? 0 : parsed;
      }
    }
    onSubmit(flushed);
  };

  const dialogContent = (
    <DialogContent className={`${isAdd ? "sm:max-w-[70rem]" : "sm:max-w-[65rem]"} max-h-[90vh] overflow-y-auto`}>
      <DialogHeader>
        <DialogTitle>{isAdd ? "Add Line Item" : "Edit Line Item"}</DialogTitle>
        <DialogDescription>
          {isAdd ? "Select scope of work and configure pricing details" : "Update the estimate line item details"}
        </DialogDescription>
      </DialogHeader>
      
      {isAdd && (
        <div className="flex items-center gap-2 border-b pb-3 mb-4">
          <Button
            type="button"
            variant={useHierarchicalBuilder ? "default" : "outline"}
            size="sm"
            onClick={() => onUseHierarchicalBuilderChange?.(true)}
            data-testid="button-hierarchical-mode"
          >
            <Layers className="h-4 w-4 mr-2" />
            Guided Selection
          </Button>
          <Button
            type="button"
            variant={!useHierarchicalBuilder ? "default" : "outline"}
            size="sm"
            onClick={() => onUseHierarchicalBuilderChange?.(false)}
            data-testid="button-manual-mode"
          >
            <FileText className="h-4 w-4 mr-2" />
            Manual Entry
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setEnrichmentDrawerOpen(true)}
              data-testid="button-enrich-with-ai"
            >
              <Sparkles className="h-4 w-4 mr-2 text-primary" />
              Enrich with AI
            </Button>
            <HistoricalCostImportButton form={form} />
          </div>
        </div>
      )}
      
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(handleSubmitWithFlush)}
          onKeyDown={(e) => {
            // Prevent Enter inside single-line inputs from submitting the form
            // and dismissing the dialog. Allow Enter inside textareas (multi-line)
            // and on the explicit submit button.
            if (e.key !== "Enter") return;
            const target = e.target as HTMLElement;
            const tag = target.tagName?.toLowerCase();
            if (tag === "textarea") return;
            if (tag === "button" && (target as HTMLButtonElement).type === "submit") return;
            e.preventDefault();
          }}
          className="space-y-6"
          data-testid="form-line-item"
        >
          {isAdd && useHierarchicalBuilder ? (
            <>
              <HierarchicalLineItemBuilder
                onSelectionChange={onHierarchicalSelectionChange!}
                lineItemId={lineItemId}
                quantity={hierarchicalQuantity}
                onQuantityChange={(q) => {
                  onHierarchicalQuantityChange?.(q);
                  form.setValue("quantity", q);
                }}
                unit={hierarchicalUnit}
                onUnitChange={(u) => {
                  onHierarchicalUnitChange?.(u);
                  form.setValue("unit", u);
                }}
                materialCalcData={materialCalcData}
                onMaterialCalcChange={onMaterialCalcChange}
              />
              
              {hierarchicalSelection && (
                <div className="p-3 bg-green-50 dark:bg-green-950/30 rounded-md border border-green-200 dark:border-green-900">
                  <p className="text-sm font-medium text-green-700 dark:text-green-400 flex items-center gap-2">
                    <CheckCircle className="h-4 w-4" />
                    Scope selected: {hierarchicalSelection.canonicalName}
                  </p>
                  <p className="text-xs text-green-600 dark:text-green-500 mt-1">
                    Trade: {hierarchicalSelection.tradeName} → {hierarchicalSelection.subcategoryName} → {hierarchicalSelection.workTypeName}
                  </p>
                </div>
              )}
            </>
          ) : isAdd ? (
            <div className="border rounded-md p-4 bg-muted/30">
              <div className="flex items-center gap-2 mb-3">
                <Layers className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Standardized Scope of Work</span>
                <span className="text-xs text-muted-foreground ml-auto">Optional</span>
              </div>
              <StandardizedScopeSelector
                value={selectedScopeData || undefined}
                onChange={onScopeSelect!}
                showDimensionInputs={false}
                lineItemId={lineItemId}
              />
              {selectedScopeData && (
                <div className="mt-2 p-2 bg-green-50 dark:bg-green-950/30 rounded border border-green-200 dark:border-green-900">
                  <p className="text-xs text-green-700 dark:text-green-400">
                    SOW selected: Description, unit, and category have been auto-filled.
                  </p>
                </div>
              )}
            </div>
          ) : null}

          {isEdit && lineItemId && (
            <div className="border rounded-md p-4 bg-muted/30">
              <div className="flex items-center gap-2 mb-3">
                <Tag className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Modifiers</span>
              </div>
              <ModifierSelector
                trade={form.getValues("category")?.toUpperCase().replace(/ /g, "_")}
                lineItemId={lineItemId}
                onSelectionsChange={() => {}}
              />
            </div>
          )}

          {isEdit && lineItemId && estimateId && (
            <div className="border rounded-md p-4 bg-muted/30 flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium mr-2">Cost sources</span>
              <CostBookPickerButton
                estimateId={estimateId}
                lineItemId={lineItemId}
                defaultQuantity={Number(form.getValues("quantity")) || undefined}
                onApplied={(r) => {
                  form.setValue("materialCost", r.materialCost, { shouldDirty: false });
                  form.setValue("laborCost", r.laborCost, { shouldDirty: false });
                  form.setValue("equipmentCost", r.equipmentCost, { shouldDirty: false });
                }}
              />
              <CrewTemplatePickerButton
                estimateId={estimateId}
                lineItemId={lineItemId}
                onApplied={(r) => {
                  form.setValue("laborCost", r.laborCost, { shouldDirty: false });
                  form.setValue("equipmentCost", r.equipmentCost, { shouldDirty: false });
                  form.setValue("laborHours", r.laborHours, { shouldDirty: false });
                }}
              />
              <span className="text-xs text-muted-foreground ml-auto">
                Applies pricing immediately and stamps source/code/as-of on the line.
              </span>
            </div>
          )}
          
          {(isEdit || (isAdd && !useHierarchicalBuilder)) && (
            <div className="grid grid-cols-2 gap-4">
              <PayItemRow form={form} testPrefix={testPrefix} />
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="e.g., Foundation excavation" 
                        {...field}
                        data-testid={`input-${testPrefix}description`}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <Select onValueChange={onCategoryChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid={`select-${testPrefix}category`}>
                          <SelectValue placeholder="Select a category" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {workCategories.length > 0 ? (
                          workCategories.map((cat) => (
                            <SelectItem key={cat.value} value={cat.value}>
                              {cat.label}
                              {cat.itemCount > 0 && (
                                <span className="ml-2 text-xs text-muted-foreground">
                                  ({cat.itemCount})
                                </span>
                              )}
                            </SelectItem>
                          ))
                        ) : (
                          <>
                            <SelectItem value="CONCRETE">Concrete</SelectItem>
                            <SelectItem value="EXCAVATION">Excavation</SelectItem>
                            <SelectItem value="GRADING">Grading</SelectItem>
                            <SelectItem value="PAVING">Paving</SelectItem>
                            <SelectItem value="PAVERS">Pavers</SelectItem>
                            <SelectItem value="DEMOLITION">Demolition</SelectItem>
                            <SelectItem value="SITEWORK">Sitework</SelectItem>
                            <SelectItem value="STRUCTURAL_STEEL">Structural Steel</SelectItem>
                            <SelectItem value="MASONRY">Masonry</SelectItem>
                            <SelectItem value="FRAMING">Framing</SelectItem>
                            <SelectItem value="CARPENTRY">Carpentry</SelectItem>
                            <SelectItem value="ROOFING">Roofing</SelectItem>
                            <SelectItem value="WATERPROOFING">Waterproofing</SelectItem>
                            <SelectItem value="INSULATION">Insulation</SelectItem>
                            <SelectItem value="DRYWALL">Drywall</SelectItem>
                            <SelectItem value="PAINTING">Painting</SelectItem>
                            <SelectItem value="FLOORING">Flooring</SelectItem>
                            <SelectItem value="WINDOWS_DOORS">Windows & Doors</SelectItem>
                            <SelectItem value="PLUMBING">Plumbing</SelectItem>
                            <SelectItem value="HVAC">HVAC</SelectItem>
                            <SelectItem value="MECHANICAL">Mechanical</SelectItem>
                            <SelectItem value="ELECTRICAL">Electrical</SelectItem>
                            <SelectItem value="FIRE_PROTECTION">Fire Protection</SelectItem>
                            <SelectItem value="ELEVATOR">Elevator</SelectItem>
                            <SelectItem value="BOLLARDS">Bollards</SelectItem>
                            <SelectItem value="STRIPING">Striping</SelectItem>
                            <SelectItem value="SIGNAGE">Signage</SelectItem>
                            <SelectItem value="LANDSCAPING">Landscaping</SelectItem>
                            <SelectItem value="OTHER">Other</SelectItem>
                          </>
                        )}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="unit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Unit</FormLabel>
                    <FormControl>
                      {isAdd ? (
                        <UomSelect
                          value={field.value}
                          onChange={field.onChange}
                          placeholder="Select unit"
                          data-testid="select-unit"
                        />
                      ) : (
                        <Input {...field} placeholder="e.g., CY, SF, LF" data-testid="input-edit-unit" />
                      )}
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="quantity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Quantity</FormLabel>
                    <FormControl>
                      <Input 
                        {...numericInputProps(field)}
                        placeholder="0" 
                        data-testid={`input-${testPrefix}quantity`} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="materialCost"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-2">
                    Material Cost ($)
                    {aiEstimatorEnabled && selectedScopeData?.workTypeCode && form.watch("unit") ? (
                      <AiSuggestionAffordance
                        enabled={aiEstimatorEnabled}
                        metric="unit_cost"
                        costCode={selectedScopeData.workTypeCode}
                        unit={form.watch("unit")}
                        currentValue={Number(field.value) || null}
                        onApply={(v) => form.setValue("materialCost", v, { shouldDirty: true })}
                        bidId={aiEstimatorBidId}
                        estimateId={estimateId}
                      />
                    ) : null}
                  </FormLabel>
                  <FormControl>
                    <Input 
                      {...numericInputProps(field)}
                      placeholder="0.00" 
                      data-testid={`input-${testPrefix}material-cost`} 
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {catalogPrices.length > 0 && (
              <div className="col-span-2 p-3 bg-muted/50 rounded-md border">
                <div className="flex items-center gap-2 mb-2">
                  <Store className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">Catalog Pricing Available</span>
                  <Badge variant="secondary" className="text-xs">{catalogPrices.length} items</Badge>
                </div>
                <div className="space-y-2 max-h-32 overflow-y-auto">
                  {catalogPrices.slice(0, 5).map((item) => (
                    <div 
                      key={item.id}
                      className="flex items-center justify-between p-2 bg-background rounded border hover-elevate cursor-pointer"
                      onClick={() => onApplyCatalogPrice(item)}
                      data-testid={`${testPrefix}catalog-price-${item.id}`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.itemName}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {item.vendorName} | {item.effectiveQuarter}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 ml-2">
                        <Badge variant="outline" className="text-xs whitespace-nowrap">
                          ${parseFloat(item.unitPrice).toFixed(2)}/{item.unit}
                        </Badge>
                        <Tag className="h-3 w-3 text-muted-foreground" />
                      </div>
                    </div>
                  ))}
                </div>
                {catalogPrices.length > 5 && (
                  <p className="text-xs text-muted-foreground mt-2 text-center">
                    +{catalogPrices.length - 5} more items available
                  </p>
                )}
              </div>
            )}

            <div className="col-span-2 space-y-3 p-3 rounded-md border bg-muted/30">
              <h5 className="font-medium text-sm">Labor Costs</h5>
              
              <div className="space-y-2">
                <FormLabel className="text-sm">Labor Classification (from Cost Rates)</FormLabel>
                <LaborRateSelector
                  value={form.watch("jobClassificationId")}
                  onSelect={(classificationId, rate) => {
                    form.setValue("jobClassificationId", classificationId || undefined);
                    form.setValue("laborRateUsed", rate);
                    const laborHours = form.watch("laborHours") || 0;
                    if (rate > 0 && laborHours > 0) {
                      form.setValue("laborCost", laborHours * rate);
                    }
                  }}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="laborHours"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Labor Hours</FormLabel>
                      <FormControl>
                        <Input 
                          {...numericInputProps(field)}
                          placeholder="0.0" 
                          onChange={(e) => {
                            const raw = e.target.value;
                            if (raw === '' || /^\d*\.?\d*$/.test(raw)) {
                              setNumericDisplayValues(prev => ({ ...prev, [field.name]: raw }));
                              const hours = raw === '' ? 0 : parseFloat(raw);
                              const safeHours = Number.isNaN(hours) ? 0 : hours;
                              field.onChange(safeHours);
                              form.setValue("laborHours", safeHours, { shouldDirty: true, shouldValidate: false });
                              const rate = form.watch("laborRateUsed") || 0;
                              if (rate > 0) {
                                form.setValue("laborCost", safeHours * rate, { shouldDirty: true, shouldValidate: false });
                              }
                            }
                          }}
                          data-testid={`input-${testPrefix}labor-hours`}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="laborCost"
                  render={({ field }) => {
                    const rate = form.watch("laborRateUsed");
                    const hasRate = !!(rate && rate > 0);
                    return (
                      <FormItem>
                        <FormLabel>
                          Labor Cost ($)
                          {hasRate && (
                            <span className="text-xs text-muted-foreground ml-1">
                              (auto-calculated, editable)
                            </span>
                          )}
                        </FormLabel>
                        <FormControl>
                          <Input
                            {...numericInputProps(field)}
                            placeholder="0.00"
                            onChange={(e) => {
                              const raw = e.target.value;
                              if (raw === "" || /^\d*\.?\d*$/.test(raw)) {
                                setNumericDisplayValues(prev => ({ ...prev, [field.name]: raw }));
                                const cost = raw === "" ? 0 : parseFloat(raw);
                                const safeCost = Number.isNaN(cost) ? 0 : cost;
                                field.onChange(safeCost);
                                form.setValue("laborCost", safeCost, { shouldDirty: true, shouldValidate: false });
                                // If a rate is set, reverse-derive labor hours from
                                // the manually-entered cost so the two stay
                                // consistent for downstream production-rate logic.
                                const currentRate = form.getValues("laborRateUsed") || 0;
                                if (currentRate > 0) {
                                  const derivedHours = Math.round((safeCost / currentRate) * 100) / 100;
                                  form.setValue("laborHours", derivedHours, { shouldDirty: true, shouldValidate: false });
                                  setNumericDisplayValues(prev => ({ ...prev, laborHours: String(derivedHours) }));
                                }
                              }
                            }}
                            data-testid={`input-${testPrefix}labor-cost`}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    );
                  }}
                />
              </div>

              {form.watch("laborRateUsed") && form.watch("laborRateUsed")! > 0 && form.watch("laborHours") > 0 && (
                <div className="text-xs text-muted-foreground bg-background p-2 rounded border" data-testid={`${testPrefix}labor-calculation-summary`}>
                  {form.watch("laborHours")} hrs × ${form.watch("laborRateUsed")?.toFixed(2)}/hr = ${form.watch("laborCost").toFixed(2)}
                </div>
              )}
            </div>

            <div className="col-span-2 space-y-3 p-3 rounded-md border bg-muted/30">
              <h5 className="font-medium text-sm">Equipment Costs</h5>
              
              <EquipmentRateSelector
                key={`equipment-${mode}-${equipmentSelectorKey}`}
                onSelect={(equipmentData) => {
                  form.setValue("equipmentHours", equipmentData.hours);
                  form.setValue("equipmentCost", equipmentData.totalCost);
                  form.setValue("equipmentSource", equipmentData.source);
                  form.setValue("selectedEquipmentId", equipmentData.equipmentId || undefined);
                  form.setValue("equipmentRateUsed", equipmentData.hourlyRate);
                }}
                initialHours={form.getValues("equipmentHours")}
                initialEquipmentId={form.getValues("selectedEquipmentId")}
                initialSource={form.getValues("equipmentSource") as "OWNED" | "RENTAL" | "MANUAL" | undefined}
              />
              
              {(form.watch("equipmentRateUsed") ?? 0) > 0 && form.watch("equipmentSource") !== "MANUAL" && (
                <div className="text-xs text-muted-foreground bg-background rounded px-2 py-1 border" data-testid="text-equipment-rate-info">
                  Rate: ${form.watch("equipmentRateUsed")?.toFixed(2)}/hr
                  {form.watch("equipmentSource") === "OWNED" ? " (owned)" : " (rental)"}
                  {form.watch("equipmentHours") > 0 && ` × ${form.watch("equipmentHours")} hrs`}
                </div>
              )}

              <FormField
                control={form.control}
                name="equipmentCost"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Equipment Cost ($)
                      <span className="text-xs text-muted-foreground ml-1">
                        {form.watch("selectedEquipmentId") ? "(auto-calculated, override below)" : "(or enter manually)"}
                      </span>
                    </FormLabel>
                    <FormControl>
                      <Input 
                        {...numericInputProps(field)}
                        placeholder="0.00" 
                        data-testid={`input-${testPrefix}equipment-cost`} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="subcontractCost"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Subcontract Cost ($)</FormLabel>
                  <FormControl>
                    <Input 
                      {...numericInputProps(field)}
                      placeholder="0.00"
                      disabled={hasMultiSubAssignments}
                      data-testid={`input-${testPrefix}subcontract-cost`} 
                    />
                  </FormControl>
                  {hasMultiSubAssignments && (
                    <p className="text-xs text-muted-foreground">Auto-calculated from subcontractor allocations below</p>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            {subcontractorQuotes.length > 0 && (
              <SubcontractorAssignmentPanel
                quotes={subcontractorQuotes}
                assignments={form.watch("subcontractorAssignments") || []}
                onAssignmentsChange={(assignments) => {
                  form.setValue("subcontractorAssignments", assignments);
                  const totalAllocated = assignments
                    .filter(a => a.isSelected)
                    .reduce((sum, a) => sum + Number(a.allocatedCost || 0), 0);
                  form.setValue("subcontractCost", assignments.length > 0 ? totalAllocated : 0);
                }}
                testPrefix={testPrefix}
              />
            )}

            {!hasMultiSubAssignments && form.watch("subcontractCost") > 0 && subcontractorQuotes.length > 0 && (
              <FormField
                control={form.control}
                name="subcontractorQuoteId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Assign to Subcontractor (Legacy)</FormLabel>
                    <Select
                      onValueChange={(val) => field.onChange(val === "none" ? "" : val)}
                      value={field.value || ""}
                    >
                      <FormControl>
                        <SelectTrigger data-testid={`select-${testPrefix}subcontractor-quote`}>
                          <SelectValue placeholder="Select subcontractor..." />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {subcontractorQuotes.map((quote) => (
                          <SelectItem key={quote.id} value={quote.id}>
                            {quote.subcontractorName} - ${Number(quote.quoteAmount).toLocaleString()}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel>Notes (Optional)</FormLabel>
                  <FormControl>
                    <Textarea {...field} value={field.value || ""} placeholder="Additional details..." data-testid={`input-${testPrefix}notes`} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {isEdit && estimateId && lineItemId && (
              <div className="col-span-2">
                <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                  Photo Attachments (Optional)
                </label>
                <LineItemPhotoGallery
                  estimateId={estimateId}
                  lineItemId={lineItemId}
                  testPrefix={testPrefix}
                  legacyPhotoUrl={form.watch("photoUrl") ?? null}
                  photoUrls={form.watch("photoUrls") ?? []}
                  onChange={(urls, legacy) => {
                    form.setValue("photoUrls", urls, { shouldDirty: true });
                    form.setValue("photoUrl", legacy, { shouldDirty: true });
                  }}
                />
              </div>
            )}
          </div>

          {(isEdit || (isAdd && !useHierarchicalBuilder)) && (() => {
            const watchedValues = form.watch();
            const unit = watchedValues.unit || "";
            const quantity = Number(watchedValues.quantity) || 0;
            const category = watchedValues.category || "";
            const description = watchedValues.description || "";

            const { unitMatch, autoShow } = shouldAutoShowMaterialCalc({
              unit, category, description, materialCalcData, source: lineItemSource,
            });
            const showMaterialCalc = autoShow || (unitMatch && manualCalcToggle);
            
            if (showMaterialCalc) {
              return (
                <MaterialCalculator
                  unit={unit}
                  quantity={quantity}
                  description={description}
                  value={materialCalcData}
                  onChange={onMaterialCalcChange}
                />
              );
            }
            
            if (unitMatch && !autoShow) {
              return (
                <div className="flex justify-center py-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setManualCalcToggle(true)}
                    data-testid={`button-${testPrefix}show-material-calculator`}
                  >
                    <Calculator className="h-4 w-4 mr-2" />
                    Show Material Calculator
                  </Button>
                </div>
              );
            }
            
            return null;
          })()}

          <CalculatedQuantitiesSummary materialCalcData={materialCalcData} testPrefix={testPrefix} />

          <ManualMaterialPricing
            materialCalcData={materialCalcData}
            onMaterialCostChange={(cost) => form.setValue("materialCost", cost)}
            currentMaterialCost={Number(form.watch("materialCost")) || 0}
            catalogPricedMaterials={catalogPricedMaterials}
          />

          <CostPerUnitPreview
            form={form}
            overheadPercent={overheadPercent}
            profitMarginPercent={profitMarginPercent}
            testPrefix={testPrefix}
          />

          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} data-testid={`button-${testPrefix}cancel`}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending} data-testid={`button-${isAdd ? "submit-line-item" : "submit-edit-line-item"}`}>
              {isPending ? (isAdd ? "Adding..." : "Updating...") : (isAdd ? "Add Line Item" : "Update Line Item")}
            </Button>
          </div>
        </form>
      </Form>
    </DialogContent>
  );

  const enrichmentLineItem = {
    description: form.watch("description") ?? "",
    costCode: form.watch("workTypeCode") ?? null,
    quantity: String(form.watch("quantity") ?? ""),
    unit: form.watch("unit") ?? null,
    manualUnitCostMaterial: String(form.watch("materialCost") ?? ""),
    manualUnitCostLabor: String(form.watch("laborCost") ?? ""),
    notes: form.watch("notes") ?? null,
    mode: "ON_DEMAND" as const,
  };

  if (isAdd) {
    return (
      <>
        <Dialog open={open} onOpenChange={onOpenChange} modal={false}>
          <DialogTrigger asChild>
            <Button data-testid="button-open-add-line-item">
              <Plus className="h-4 w-4 mr-2" />
              Add Line Item
            </Button>
          </DialogTrigger>
          {dialogContent}
        </Dialog>
        <EnrichmentDrawer
          open={enrichmentDrawerOpen}
          onOpenChange={setEnrichmentDrawerOpen}
          lineItem={enrichmentLineItem}
          estimateLineItemId={lineItemId ?? null}
        />
      </>
    );
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange} modal={false}>
        {dialogContent}
      </Dialog>
      <EnrichmentDrawer
        open={enrichmentDrawerOpen}
        onOpenChange={setEnrichmentDrawerOpen}
        lineItem={enrichmentLineItem}
        estimateLineItemId={lineItemId ?? null}
      />
    </>
  );
}

function CalculatedQuantitiesSummary({ materialCalcData, testPrefix }: { materialCalcData: MaterialCalculatorData; testPrefix: string }) {
  const concreteYards = parseFloat(materialCalcData.calculatedConcreteYards || "0");
  const stoneTons = parseFloat(materialCalcData.calculatedStoneTons || "0");
  const excavationYards = parseFloat(materialCalcData.calculatedExcavationYards || "0");
  const wireMeshRolls = parseFloat(materialCalcData.calculatedWireMeshRolls || "0");
  const rebarCount = parseFloat(materialCalcData.calculatedRebarCount || "0");
  const rebarFeet = parseFloat(materialCalcData.calculatedRebarLinearFeet || "0");
  const sealerGallons = parseFloat(materialCalcData.calculatedSealerGallons || "0");
  const dowelCount = parseFloat(materialCalcData.calculatedDowelCount || "0");
  const underlaymentSF = parseFloat(materialCalcData.calculatedUnderlaymentSF || "0");
  
  const hasCalculatedQuantities = concreteYards > 0 || stoneTons > 0 || excavationYards > 0 || 
    wireMeshRolls > 0 || rebarCount > 0 || sealerGallons > 0 || dowelCount > 0 || underlaymentSF > 0;
  
  if (!hasCalculatedQuantities) return null;
  
  return (
    <Card className="border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2 text-green-700 dark:text-green-400">
          <Calculator className="h-4 w-4" />
          Calculated Material Quantities
        </CardTitle>
        <CardDescription className="text-xs">
          These quantities will be used for material cost calculations (not the scope quantity)
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex flex-wrap gap-2">
          {concreteYards > 0 && (
            <Badge variant="outline" className="bg-background" data-testid={`${testPrefix}badge-concrete-yards`}>
              Concrete: {concreteYards.toFixed(2)} CY
            </Badge>
          )}
          {stoneTons > 0 && (
            <Badge variant="outline" className="bg-background" data-testid={`${testPrefix}badge-stone-tons`}>
              Stone: {stoneTons.toFixed(2)} TON
            </Badge>
          )}
          {excavationYards > 0 && (
            <Badge variant="outline" className="bg-background" data-testid={`${testPrefix}badge-excavation-yards`}>
              Excavation: {excavationYards.toFixed(2)} CY
            </Badge>
          )}
          {wireMeshRolls > 0 && (
            <Badge variant="outline" className="bg-background" data-testid={`${testPrefix}badge-wire-mesh-rolls`}>
              Wire Mesh: {wireMeshRolls.toFixed(1)} ROLLS
            </Badge>
          )}
          {rebarCount > 0 && (
            <Badge variant="outline" className="bg-background" data-testid={`${testPrefix}badge-rebar-count`}>
              Rebar: {rebarCount.toFixed(0)} EA ({rebarFeet.toFixed(0)} LF)
            </Badge>
          )}
          {dowelCount > 0 && (
            <Badge variant="outline" className="bg-background" data-testid={`${testPrefix}badge-dowel-count`}>
              Dowels: {dowelCount.toFixed(0)} EA
            </Badge>
          )}
          {sealerGallons > 0 && (
            <Badge variant="outline" className="bg-background" data-testid={`${testPrefix}badge-sealer-gallons`}>
              Sealer: {sealerGallons.toFixed(1)} GAL
            </Badge>
          )}
          {underlaymentSF > 0 && (
            <Badge variant="outline" className="bg-background" data-testid={`${testPrefix}badge-underlayment-sf`}>
              Underlayment: {underlaymentSF.toFixed(0)} SF
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Use catalog pricing or enter manual unit prices below
        </p>
      </CardContent>
    </Card>
  );
}

function CostPerUnitPreview({ 
  form, 
  overheadPercent, 
  profitMarginPercent, 
  testPrefix 
}: { 
  form: UseFormReturn<LineItemFormValues>; 
  overheadPercent: number; 
  profitMarginPercent: number; 
  testPrefix: string;
}) {
  const watchedValues = form.watch();
  const quantity = Number(watchedValues.quantity) || 0;
  const unit = watchedValues.unit || "UNIT";
  const directCost = (Number(watchedValues.materialCost) || 0) + 
                    (Number(watchedValues.laborCost) || 0) + 
                    (Number(watchedValues.equipmentCost) || 0) + 
                    (Number(watchedValues.consumablesCost) || 0) +
                    (Number(watchedValues.subcontractCost) || 0);
  
  if (quantity <= 0) return null;

  const costPerUnit = directCost / quantity;
  const overheadPerUnit = costPerUnit * (overheadPercent / 100);
  const costWithOverhead = costPerUnit + overheadPerUnit;
  const profitPerUnit = costWithOverhead * (profitMarginPercent / 100);
  const bidPricePerUnit = costWithOverhead + profitPerUnit;
  const totalMarkupPercent = costPerUnit > 0 ? ((bidPricePerUnit / costPerUnit) - 1) * 100 : 0;
  const totalOverhead = directCost * (overheadPercent / 100);
  const totalProfit = (directCost + totalOverhead) * (profitMarginPercent / 100);
  
  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Calculator className="h-4 w-4" />
          Cost Per {unit} Breakdown
        </CardTitle>
        <CardDescription className="text-xs">
          Auto-calculated based on quantity and What-If Calculator settings
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-4 gap-3">
          <div className="p-3 bg-background rounded-md border">
            <p className="text-xs text-muted-foreground mb-1">Your Cost</p>
            <p className="text-lg font-semibold" data-testid={`text-${testPrefix}cost-per-unit`}>
              ${costPerUnit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <p className="text-xs text-muted-foreground">per {unit}</p>
          </div>
          <div className="p-3 bg-background rounded-md border">
            <p className="text-xs text-muted-foreground mb-1">+ Overhead ({overheadPercent}%)</p>
            <p className="text-lg font-semibold text-blue-600 dark:text-blue-400" data-testid={`text-${testPrefix}overhead-per-unit`}>
              +${overheadPerUnit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <p className="text-xs text-muted-foreground">per {unit}</p>
          </div>
          <div className="p-3 bg-background rounded-md border">
            <p className="text-xs text-muted-foreground mb-1">+ Profit ({profitMarginPercent}%)</p>
            <p className="text-lg font-semibold text-green-600 dark:text-green-400" data-testid={`text-${testPrefix}profit-per-unit`}>
              +${profitPerUnit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <p className="text-xs text-muted-foreground">per {unit}</p>
          </div>
          <div className="p-3 bg-primary/10 rounded-md border border-primary/20">
            <p className="text-xs text-muted-foreground mb-1">Bid Price</p>
            <p className="text-lg font-bold text-primary" data-testid={`text-${testPrefix}bid-price-per-unit`}>
              ${bidPricePerUnit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <p className="text-xs text-muted-foreground">per {unit}</p>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t">
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 bg-orange-50 dark:bg-orange-950/30 rounded-md border border-orange-200 dark:border-orange-800">
              <p className="text-xs text-muted-foreground mb-1">Total Overhead</p>
              <p className="text-xl font-bold text-orange-600 dark:text-orange-400" data-testid={`text-${testPrefix}total-overhead`}>
                ${totalOverhead.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className="p-3 bg-green-50 dark:bg-green-950/30 rounded-md border border-green-200 dark:border-green-800">
              <p className="text-xs text-muted-foreground mb-1">Total Profit</p>
              <p className="text-xl font-bold text-green-600 dark:text-green-400" data-testid={`text-${testPrefix}total-profit`}>
                ${totalProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className="p-3 bg-primary/10 rounded-md border border-primary/20">
              <p className="text-xs text-muted-foreground mb-1">Total Bid Price</p>
              <p className="text-xl font-bold text-primary" data-testid={`text-${testPrefix}total-bid-price`}>
                ${(quantity * bidPricePerUnit).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t flex justify-between items-center text-xs text-muted-foreground">
          <span>
            {quantity.toLocaleString()} {unit} x ${bidPricePerUnit.toFixed(2)} = <span className="font-semibold text-foreground">${(quantity * bidPricePerUnit).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> total bid
          </span>
          <span className="text-amber-600 dark:text-amber-400 font-medium">
            {totalMarkupPercent.toFixed(1)}% total markup
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
