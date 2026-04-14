import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Search, Package, Filter, Loader2, Upload, Download, FileSpreadsheet, AlertCircle, CheckCircle2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isVendor } from "@/lib/rbac";
import { Redirect } from "wouter";

interface VendorPricingItem {
  id: string; itemName: string; itemCode: string | null; category: string | null;
  description: string | null; unit: string; unitPrice: string; minimumOrder: number | null;
  deliveryFee: string | null; leadTimeDays: number | null; approvalStatus: string;
  createdAt: string; organizationId: string;
}

interface RentalPricingItem {
  id: string; name: string; equipmentType: string; make: string | null; model: string | null;
  description: string | null; dailyRate: string | null; weeklyRate: string | null;
  monthlyRate: string | null; deliveryFee: string | null; pickupFee: string | null;
  minimumRentalDays: number | null; leadTimeDays: number | null; approvalStatus: string | null;
  createdAt: string;
}

interface ServicePricingItem {
  id: string; serviceName: string; serviceCode: string | null; category: string;
  description: string | null; unit: string; rate: string; minimumHours: string | null;
  travelFee: string | null; leadTimeDays: number | null; approvalStatus: string | null;
  createdAt: string;
}

interface VendorEnrollment {
  id: string; contractorOrgId: string; contractorOrgName: string; status: string;
}

interface PricingSubmitPayload {
  items: Record<string, string | number | null>[];
  contractorOrgIds?: string[];
}

interface BulkUploadPayload {
  csvData: string;
  contractorOrgIds?: string[];
}

interface FilterState {
  searchTerm: string;
  categoryOrType: string;
  status: string;
}

const MATERIAL_CATEGORIES = [
  "General Materials", "Roofing Materials", "Electrical Supplies", "Plumbing Supplies",
  "HVAC Equipment", "Concrete & Masonry", "Lumber & Framing", "Drywall & Finishing",
  "Paint & Coatings", "Flooring", "Safety Equipment", "Tools & Equipment",
  "Fasteners & Hardware", "Insulation", "Windows & Doors", "Landscaping", "Other",
];
const MATERIAL_UNITS = ["EA","SF","SY","LF","CY","TON","LB","GAL","HR","LS","SQ","BD FT","ROLL","BOX","PALLET"];
const EQUIPMENT_TYPES = ["HEAVY_EQUIPMENT","POWER_TOOL","HAND_TOOL","VEHICLE","TRAILER","CONCRETE","COMPACTION","SURVEYING","SAFETY","OTHER"];
const SERVICE_CATEGORIES = ["Excavation","Demolition","Electrical Work","Plumbing","HVAC","Painting","Concrete Work","Framing","Roofing","Landscaping","General Labor","Specialty Trade","Other"];
const SERVICE_UNITS = ["HR","DAY","SF","SY","LF","LS","EA","JOB"];

type PricingTab = "materials" | "rental" | "services";

function getStatusBadge(status: string | null) {
  switch (status) {
    case "AUTO_APPROVED": case "APPROVED": return <Badge variant="default">Approved</Badge>;
    case "PENDING_REVIEW": return <Badge variant="secondary">Pending Review</Badge>;
    case "REJECTED": return <Badge variant="destructive">Rejected</Badge>;
    default: return <Badge variant="outline">{status || "Unknown"}</Badge>;
  }
}

function formatEquipmentType(type: string) {
  return type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function ClientSelector({ enrollments, selected, onChange, testIdPrefix }: {
  enrollments: VendorEnrollment[]; selected: string[]; onChange: (ids: string[]) => void; testIdPrefix: string;
}) {
  if (enrollments.length === 0) return null;
  return (
    <div className="space-y-2">
      <Label>Submit to Clients</Label>
      <p className="text-xs text-muted-foreground mb-2">Select specific clients or leave empty to submit to all enrolled clients</p>
      <div className="space-y-2 max-h-40 overflow-y-auto border rounded-md p-2">
        {enrollments.map(enrollment => (
          <label key={enrollment.id} className="flex items-center gap-2 p-2 rounded hover-elevate cursor-pointer">
            <input type="checkbox" checked={selected.includes(enrollment.contractorOrgId)}
              onChange={(e) => { if (e.target.checked) onChange([...selected, enrollment.contractorOrgId]); else onChange(selected.filter(id => id !== enrollment.contractorOrgId)); }}
              className="rounded" data-testid={`${testIdPrefix}-${enrollment.contractorOrgId}`} />
            <span className="text-sm">{enrollment.contractorOrgName}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function useDownloadFile() {
  const { toast } = useToast();
  return async (url: string, filename: string) => {
    try {
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to download");
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = blobUrl; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      window.URL.revokeObjectURL(blobUrl);
    } catch {
      toast({ title: "Download failed", description: "Could not download the file.", variant: "destructive" });
    }
  };
}

function buildExportUrl(baseUrl: string, filters: FilterState, filterParamName: string) {
  const params = new URLSearchParams();
  if (filters.searchTerm) params.set("search", filters.searchTerm);
  if (filters.categoryOrType && filters.categoryOrType !== "all") params.set(filterParamName, filters.categoryOrType);
  if (filters.status && filters.status !== "all") params.set("status", filters.status);
  const qs = params.toString();
  return qs ? `${baseUrl}?${qs}` : baseUrl;
}

function BulkUploadDialog({ open, onClose, templateUrl, templateFilename, uploadEndpoint, queryKeyToInvalidate, activeEnrollments, title }: {
  open: boolean; onClose: () => void; templateUrl: string; templateFilename: string;
  uploadEndpoint: string; queryKeyToInvalidate: string; activeEnrollments: VendorEnrollment[]; title: string;
}) {
  const download = useDownloadFile();
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [bulkSelectedClients, setBulkSelectedClients] = useState<string[]>([]);

  useEffect(() => {
    if (!open) { setUploadedFile(null); setUploadError(null); setUploadSuccess(null); setBulkSelectedClients([]); }
  }, [open]);

  const bulkUploadMutation = useMutation({
    mutationFn: async (data: BulkUploadPayload) => {
      const response = await apiRequest("POST", uploadEndpoint, data); return response.json();
    },
    onSuccess: (data: { itemsCreated: number }) => { setUploadSuccess(`Items added successfully. ${data.itemsCreated} items uploaded.`); setUploadError(null); queryClient.invalidateQueries({ queryKey: [queryKeyToInvalidate] }); },
    onError: (error: Error) => {
      let errorMessage = "Failed to upload items";
      try {
        const jsonMatch = (error.message || "").match(/^\d+:\s*(.+)$/);
        if (jsonMatch) {
          const errorData = JSON.parse(jsonMatch[1]);
          errorMessage = errorData.error === "EMPTY_FILE" ? "You uploaded an empty file." : errorData.error === "INVALID_FORMAT" ? "File does not match the required format." : errorData.message || errorMessage;
        }
      } catch { errorMessage = error.message || errorMessage; }
      setUploadError(errorMessage); setUploadSuccess(null);
    },
  });

  const handleBulkUpload = () => {
    if (!uploadedFile) { setUploadError("Please select a file"); return; }
    const reader = new FileReader();
    reader.onload = (e) => { bulkUploadMutation.mutate({ csvData: e.target?.result as string, contractorOrgIds: bulkSelectedClients.length > 0 ? bulkSelectedClients : undefined }); };
    reader.readAsText(uploadedFile);
  };

  const fileInputId = `bulk-file-${title.replace(/\s/g, '-').toLowerCase()}`;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>Upload multiple pricing items at once using a CSV file</DialogDescription></DialogHeader>
        {uploadSuccess ? (
          <div className="py-6">
            <Alert className="border-green-500 bg-green-50 dark:bg-green-950"><CheckCircle2 className="h-4 w-4 text-green-600" /><AlertTitle className="text-green-600">Success</AlertTitle><AlertDescription className="text-green-600">{uploadSuccess}</AlertDescription></Alert>
            <div className="flex justify-end mt-6"><Button onClick={onClose} data-testid="button-bulk-done">Done</Button></div>
          </div>
        ) : uploadError ? (
          <div className="py-6">
            <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Error</AlertTitle><AlertDescription>{uploadError}</AlertDescription></Alert>
            <div className="flex justify-end gap-2 mt-6">
              <Button variant="outline" onClick={() => { setUploadError(null); setUploadedFile(null); }} data-testid="button-try-again">Try Again</Button>
              <Button variant="outline" onClick={onClose}>Close</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-6 py-4">
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground text-sm font-medium shrink-0">1</div>
                <div className="space-y-2 flex-1">
                  <h4 className="font-medium">Download CSV Template</h4>
                  <p className="text-sm text-muted-foreground">Download the template file to ensure your data matches the required format.</p>
                  <button onClick={() => download(templateUrl, templateFilename)} className="text-primary hover:underline text-sm font-medium flex items-center gap-1" data-testid="link-download-csv"><Download className="h-4 w-4" /> Download CSV</button>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground text-sm font-medium shrink-0">2</div>
                <div className="space-y-2 flex-1"><h4 className="font-medium">Fill Out the CSV File</h4><p className="text-sm text-muted-foreground">Open the downloaded file in Excel or Google Sheets and fill in your item details.</p></div>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground text-sm font-medium shrink-0">3</div>
                <div className="space-y-2 flex-1">
                  <h4 className="font-medium">Upload CSV File</h4>
                  <div className="border-2 border-dashed rounded-lg p-6 text-center hover-elevate cursor-pointer"
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const f = e.dataTransfer.files?.[0]; if (f?.name.endsWith(".csv")) { setUploadedFile(f); setUploadError(null); } else setUploadError("Please upload a CSV file"); }}
                    onClick={() => document.getElementById(fileInputId)?.click()}>
                    <FileSpreadsheet className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
                    <p className="text-sm text-muted-foreground mb-3">Drag and drop your CSV file here, or click to browse</p>
                    <input type="file" accept=".csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setUploadedFile(f); setUploadError(null); setUploadSuccess(null); } }} className="hidden" id={fileInputId} data-testid="input-bulk-file" />
                    <Button type="button" variant="outline" onClick={(e) => { e.stopPropagation(); document.getElementById(fileInputId)?.click(); }} data-testid="button-select-csv">Select CSV File</Button>
                    {uploadedFile && <p className="text-sm text-primary mt-3 font-medium">Selected: {uploadedFile.name}</p>}
                  </div>
                </div>
              </div>
              {activeEnrollments.length > 0 && (
                <div className="flex items-start gap-3">
                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground text-sm font-medium shrink-0">4</div>
                  <div className="space-y-2 flex-1">
                    <h4 className="font-medium">Select Clients (Optional)</h4>
                    <p className="text-sm text-muted-foreground">Choose specific clients or leave empty to submit to all enrolled clients.</p>
                    <div className="space-y-2 max-h-32 overflow-y-auto border rounded-md p-2">
                      {activeEnrollments.map(enrollment => (
                        <label key={enrollment.id} className="flex items-center gap-2 p-2 rounded hover-elevate cursor-pointer">
                          <input type="checkbox" checked={bulkSelectedClients.includes(enrollment.contractorOrgId)}
                            onChange={(e) => { if (e.target.checked) setBulkSelectedClients([...bulkSelectedClients, enrollment.contractorOrgId]); else setBulkSelectedClients(bulkSelectedClients.filter(id => id !== enrollment.contractorOrgId)); }}
                            className="rounded" data-testid={`checkbox-bulk-client-${enrollment.contractorOrgId}`} />
                          <span className="text-sm">{enrollment.contractorOrgName}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={handleBulkUpload} disabled={!uploadedFile || bulkUploadMutation.isPending} data-testid="button-upload-csv">
                {bulkUploadMutation.isPending ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" />Uploading...</>) : (<><Upload className="h-4 w-4 mr-2" />Upload</>)}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MaterialPricingContent({ activeEnrollments, addDialogOpen, setAddDialogOpen, bulkDialogOpen, setBulkDialogOpen, filters }: {
  activeEnrollments: VendorEnrollment[]; addDialogOpen: boolean; setAddDialogOpen: (v: boolean) => void; bulkDialogOpen: boolean; setBulkDialogOpen: (v: boolean) => void; filters: FilterState;
}) {
  const { toast } = useToast();
  const download = useDownloadFile();
  const [selectedClients, setSelectedClients] = useState<string[]>([]);
  const [formData, setFormData] = useState({ itemName: "", itemCode: "", category: "", description: "", unit: "EA", unitPrice: "", minimumOrder: "", deliveryFee: "", leadTimeDays: "" });

  const { data: pricingItems, isLoading } = useQuery<VendorPricingItem[]>({ queryKey: ["/api/vendor/pricing"] });

  const submitMutation = useMutation({
    mutationFn: async (data: PricingSubmitPayload) => { const r = await apiRequest("POST", "/api/vendor/pricing", data); return r.json(); },
    onSuccess: () => { toast({ title: "Pricing submitted", description: "Your pricing has been submitted." }); queryClient.invalidateQueries({ queryKey: ["/api/vendor/pricing"] }); setAddDialogOpen(false); resetForm(); },
    onError: (error: Error) => { toast({ title: "Error", description: error.message || "Failed to submit", variant: "destructive" }); },
  });

  const resetForm = () => { setFormData({ itemName: "", itemCode: "", category: "", description: "", unit: "EA", unitPrice: "", minimumOrder: "", deliveryFee: "", leadTimeDays: "" }); setSelectedClients([]); };

  const handleSubmit = () => {
    if (!formData.itemName || !formData.unitPrice) { toast({ title: "Validation error", description: "Item name and unit price are required", variant: "destructive" }); return; }
    submitMutation.mutate({ items: [{ itemName: formData.itemName, itemCode: formData.itemCode || null, category: formData.category || null, description: formData.description || null, unit: formData.unit, unitPrice: formData.unitPrice, minimumOrder: formData.minimumOrder ? parseInt(formData.minimumOrder) : null, deliveryFee: formData.deliveryFee || null, leadTimeDays: formData.leadTimeDays ? parseInt(formData.leadTimeDays) : null }], contractorOrgIds: selectedClients.length > 0 ? selectedClients : undefined });
  };

  const filteredItems = pricingItems?.filter(item => {
    const matchesSearch = !filters.searchTerm || item.itemName.toLowerCase().includes(filters.searchTerm.toLowerCase()) || (item.itemCode?.toLowerCase().includes(filters.searchTerm.toLowerCase()));
    return (filters.categoryOrType === "all" || item.category === filters.categoryOrType) && (filters.status === "all" || item.approvalStatus === filters.status) && matchesSearch;
  }) || [];

  return (
    <>
      <div className="flex gap-2 mb-4">
        <Button variant="outline" size="sm" onClick={() => download(buildExportUrl("/api/vendor/pricing/export", filters, "category"), "material_pricing_export.csv")} data-testid="button-export-materials"><Download className="h-4 w-4 mr-2" />Export CSV</Button>
      </div>
      <Card>
        <CardContent className="pt-6">
          {isLoading ? <div className="space-y-2">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
          : filteredItems.length > 0 ? (
            <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Code</TableHead><TableHead>Category</TableHead><TableHead>Unit</TableHead><TableHead className="text-right">Price</TableHead><TableHead>Status</TableHead><TableHead>Submitted</TableHead></TableRow></TableHeader><TableBody>
              {filteredItems.map(item => (<TableRow key={item.id} data-testid={`row-pricing-${item.id}`}><TableCell className="font-medium">{item.itemName}</TableCell><TableCell className="text-muted-foreground">{item.itemCode || "-"}</TableCell><TableCell>{item.category || "-"}</TableCell><TableCell>{item.unit}</TableCell><TableCell className="text-right font-medium">${parseFloat(item.unitPrice).toFixed(2)}</TableCell><TableCell>{getStatusBadge(item.approvalStatus)}</TableCell><TableCell className="text-muted-foreground">{new Date(item.createdAt).toLocaleDateString()}</TableCell></TableRow>))}
            </TableBody></Table></div>
          ) : <div className="text-center py-12 text-muted-foreground"><Package className="h-12 w-12 mx-auto mb-4 opacity-50" /><p className="text-lg font-medium">No pricing items found</p><p className="text-sm">{pricingItems?.length === 0 ? "Add your first pricing item to get started" : "Try adjusting your search or filters"}</p></div>}
        </CardContent>
      </Card>

      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Add Material Pricing Item</DialogTitle><DialogDescription>Add a new pricing item to submit to your enrolled contractor clients</DialogDescription></DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label htmlFor="itemName">Item Name *</Label><Input id="itemName" value={formData.itemName} onChange={(e) => setFormData({...formData, itemName: e.target.value})} placeholder="e.g., 2x4x8 Stud" data-testid="input-item-name" /></div>
              <div className="space-y-2"><Label htmlFor="itemCode">Item Code</Label><Input id="itemCode" value={formData.itemCode} onChange={(e) => setFormData({...formData, itemCode: e.target.value})} placeholder="e.g., LBR-2X4X8" data-testid="input-item-code" /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Category</Label><Select value={formData.category} onValueChange={(v) => setFormData({...formData, category: v})}><SelectTrigger data-testid="select-category"><SelectValue placeholder="Select category" /></SelectTrigger><SelectContent>{MATERIAL_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label>Unit *</Label><Select value={formData.unit} onValueChange={(v) => setFormData({...formData, unit: v})}><SelectTrigger data-testid="select-unit"><SelectValue /></SelectTrigger><SelectContent>{MATERIAL_UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <div className="space-y-2"><Label>Description</Label><Textarea value={formData.description} onChange={(e) => setFormData({...formData, description: e.target.value})} placeholder="Describe the product..." data-testid="input-description" /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Unit Price ($) *</Label><Input type="number" step="0.01" value={formData.unitPrice} onChange={(e) => setFormData({...formData, unitPrice: e.target.value})} placeholder="0.00" data-testid="input-unit-price" /></div>
              <div className="space-y-2"><Label>Minimum Order</Label><Input type="number" value={formData.minimumOrder} onChange={(e) => setFormData({...formData, minimumOrder: e.target.value})} placeholder="1" data-testid="input-minimum-order" /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Delivery Fee ($)</Label><Input type="number" step="0.01" value={formData.deliveryFee} onChange={(e) => setFormData({...formData, deliveryFee: e.target.value})} placeholder="0.00" data-testid="input-delivery-fee" /></div>
              <div className="space-y-2"><Label>Lead Time (days)</Label><Input type="number" value={formData.leadTimeDays} onChange={(e) => setFormData({...formData, leadTimeDays: e.target.value})} placeholder="1" data-testid="input-lead-time" /></div>
            </div>
            <ClientSelector enrollments={activeEnrollments} selected={selectedClients} onChange={setSelectedClients} testIdPrefix="checkbox-client" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={submitMutation.isPending} data-testid="button-submit-pricing">{submitMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Submit Pricing</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BulkUploadDialog open={bulkDialogOpen} onClose={() => setBulkDialogOpen(false)} templateUrl="/api/vendor/pricing/csv-template" templateFilename="pricing_template.csv" uploadEndpoint="/api/vendor/pricing/bulk" queryKeyToInvalidate="/api/vendor/pricing" activeEnrollments={activeEnrollments} title="Add Bulk Material Items" />
    </>
  );
}

function RentalPricingContent({ activeEnrollments, addDialogOpen, setAddDialogOpen, bulkDialogOpen, setBulkDialogOpen, filters }: {
  activeEnrollments: VendorEnrollment[]; addDialogOpen: boolean; setAddDialogOpen: (v: boolean) => void; bulkDialogOpen: boolean; setBulkDialogOpen: (v: boolean) => void; filters: FilterState;
}) {
  const { toast } = useToast();
  const download = useDownloadFile();
  const [selectedClients, setSelectedClients] = useState<string[]>([]);
  const [formData, setFormData] = useState({ name: "", equipmentType: "", make: "", model: "", description: "", dailyRate: "", weeklyRate: "", monthlyRate: "", deliveryFee: "", pickupFee: "", minimumRentalDays: "", leadTimeDays: "" });

  const { data: rentalItems, isLoading } = useQuery<RentalPricingItem[]>({ queryKey: ["/api/vendor/rental-pricing"] });

  const submitMutation = useMutation({
    mutationFn: async (data: PricingSubmitPayload) => { const r = await apiRequest("POST", "/api/vendor/rental-pricing", data); return r.json(); },
    onSuccess: () => { toast({ title: "Rental pricing submitted", description: "Your rental pricing has been submitted." }); queryClient.invalidateQueries({ queryKey: ["/api/vendor/rental-pricing"] }); setAddDialogOpen(false); resetForm(); },
    onError: (error: Error) => { toast({ title: "Error", description: error.message || "Failed to submit", variant: "destructive" }); },
  });

  const resetForm = () => { setFormData({ name: "", equipmentType: "", make: "", model: "", description: "", dailyRate: "", weeklyRate: "", monthlyRate: "", deliveryFee: "", pickupFee: "", minimumRentalDays: "", leadTimeDays: "" }); setSelectedClients([]); };

  const handleSubmit = () => {
    if (!formData.name || !formData.equipmentType) { toast({ title: "Validation error", description: "Name and equipment type are required", variant: "destructive" }); return; }
    submitMutation.mutate({ items: [{ name: formData.name, equipmentType: formData.equipmentType, make: formData.make || null, model: formData.model || null, description: formData.description || null, dailyRate: formData.dailyRate || null, weeklyRate: formData.weeklyRate || null, monthlyRate: formData.monthlyRate || null, deliveryFee: formData.deliveryFee || null, pickupFee: formData.pickupFee || null, minimumRentalDays: formData.minimumRentalDays || null, leadTimeDays: formData.leadTimeDays || null }], contractorOrgIds: selectedClients.length > 0 ? selectedClients : undefined });
  };

  const filteredItems = rentalItems?.filter(item => {
    const matchesSearch = !filters.searchTerm || item.name.toLowerCase().includes(filters.searchTerm.toLowerCase()) || (item.make?.toLowerCase().includes(filters.searchTerm.toLowerCase())) || (item.model?.toLowerCase().includes(filters.searchTerm.toLowerCase()));
    return (filters.categoryOrType === "all" || item.equipmentType === filters.categoryOrType) && (filters.status === "all" || item.approvalStatus === filters.status) && matchesSearch;
  }) || [];

  return (
    <>
      <div className="flex gap-2 mb-4">
        <Button variant="outline" size="sm" onClick={() => download(buildExportUrl("/api/vendor/rental-pricing/export", filters, "type"), "rental_pricing_export.csv")} data-testid="button-export-rental"><Download className="h-4 w-4 mr-2" />Export CSV</Button>
      </div>
      <Card>
        <CardContent className="pt-6">
          {isLoading ? <div className="space-y-2">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
          : filteredItems.length > 0 ? (
            <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>Make/Model</TableHead><TableHead className="text-right">Daily Rate</TableHead><TableHead className="text-right">Weekly Rate</TableHead><TableHead className="text-right">Monthly Rate</TableHead><TableHead>Status</TableHead><TableHead>Submitted</TableHead></TableRow></TableHeader><TableBody>
              {filteredItems.map(item => (<TableRow key={item.id} data-testid={`row-rental-${item.id}`}><TableCell className="font-medium">{item.name}</TableCell><TableCell>{formatEquipmentType(item.equipmentType)}</TableCell><TableCell className="text-muted-foreground">{[item.make, item.model].filter(Boolean).join(" ") || "-"}</TableCell><TableCell className="text-right font-medium">{item.dailyRate ? `$${parseFloat(item.dailyRate).toFixed(2)}` : "-"}</TableCell><TableCell className="text-right font-medium">{item.weeklyRate ? `$${parseFloat(item.weeklyRate).toFixed(2)}` : "-"}</TableCell><TableCell className="text-right font-medium">{item.monthlyRate ? `$${parseFloat(item.monthlyRate).toFixed(2)}` : "-"}</TableCell><TableCell>{getStatusBadge(item.approvalStatus)}</TableCell><TableCell className="text-muted-foreground">{new Date(item.createdAt).toLocaleDateString()}</TableCell></TableRow>))}
            </TableBody></Table></div>
          ) : <div className="text-center py-12 text-muted-foreground"><Package className="h-12 w-12 mx-auto mb-4 opacity-50" /><p className="text-lg font-medium">No rental equipment items found</p><p className="text-sm">{rentalItems?.length === 0 ? "Add your first rental equipment item" : "Try adjusting your search or filters"}</p></div>}
        </CardContent>
      </Card>

      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Add Rental Equipment Item</DialogTitle><DialogDescription>Add rental equipment pricing to submit to your enrolled contractor clients</DialogDescription></DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Equipment Name *</Label><Input value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} placeholder="e.g., CAT 320 Excavator" data-testid="input-rental-name" /></div>
              <div className="space-y-2"><Label>Equipment Type *</Label><Select value={formData.equipmentType} onValueChange={(v) => setFormData({...formData, equipmentType: v})}><SelectTrigger data-testid="select-equipment-type"><SelectValue placeholder="Select type" /></SelectTrigger><SelectContent>{EQUIPMENT_TYPES.map(t => <SelectItem key={t} value={t}>{formatEquipmentType(t)}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Make</Label><Input value={formData.make} onChange={(e) => setFormData({...formData, make: e.target.value})} placeholder="e.g., Caterpillar" data-testid="input-rental-make" /></div>
              <div className="space-y-2"><Label>Model</Label><Input value={formData.model} onChange={(e) => setFormData({...formData, model: e.target.value})} placeholder="e.g., 320" data-testid="input-rental-model" /></div>
            </div>
            <div className="space-y-2"><Label>Description</Label><Textarea value={formData.description} onChange={(e) => setFormData({...formData, description: e.target.value})} placeholder="Describe the equipment..." data-testid="input-rental-description" /></div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2"><Label>Daily Rate ($)</Label><Input type="number" step="0.01" value={formData.dailyRate} onChange={(e) => setFormData({...formData, dailyRate: e.target.value})} placeholder="0.00" data-testid="input-daily-rate" /></div>
              <div className="space-y-2"><Label>Weekly Rate ($)</Label><Input type="number" step="0.01" value={formData.weeklyRate} onChange={(e) => setFormData({...formData, weeklyRate: e.target.value})} placeholder="0.00" data-testid="input-weekly-rate" /></div>
              <div className="space-y-2"><Label>Monthly Rate ($)</Label><Input type="number" step="0.01" value={formData.monthlyRate} onChange={(e) => setFormData({...formData, monthlyRate: e.target.value})} placeholder="0.00" data-testid="input-monthly-rate" /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Delivery Fee ($)</Label><Input type="number" step="0.01" value={formData.deliveryFee} onChange={(e) => setFormData({...formData, deliveryFee: e.target.value})} placeholder="0.00" data-testid="input-rental-delivery-fee" /></div>
              <div className="space-y-2"><Label>Pickup Fee ($)</Label><Input type="number" step="0.01" value={formData.pickupFee} onChange={(e) => setFormData({...formData, pickupFee: e.target.value})} placeholder="0.00" data-testid="input-pickup-fee" /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Min Rental Days</Label><Input type="number" value={formData.minimumRentalDays} onChange={(e) => setFormData({...formData, minimumRentalDays: e.target.value})} placeholder="1" data-testid="input-min-rental-days" /></div>
              <div className="space-y-2"><Label>Lead Time (days)</Label><Input type="number" value={formData.leadTimeDays} onChange={(e) => setFormData({...formData, leadTimeDays: e.target.value})} placeholder="1" data-testid="input-rental-lead-time" /></div>
            </div>
            <ClientSelector enrollments={activeEnrollments} selected={selectedClients} onChange={setSelectedClients} testIdPrefix="checkbox-rental-client" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={submitMutation.isPending} data-testid="button-submit-rental">{submitMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Submit Pricing</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BulkUploadDialog open={bulkDialogOpen} onClose={() => setBulkDialogOpen(false)} templateUrl="/api/vendor/rental-pricing/csv-template" templateFilename="rental_pricing_template.csv" uploadEndpoint="/api/vendor/rental-pricing/bulk" queryKeyToInvalidate="/api/vendor/rental-pricing" activeEnrollments={activeEnrollments} title="Add Bulk Rental Equipment Items" />
    </>
  );
}

function ServicePricingContent({ activeEnrollments, addDialogOpen, setAddDialogOpen, bulkDialogOpen, setBulkDialogOpen, filters }: {
  activeEnrollments: VendorEnrollment[]; addDialogOpen: boolean; setAddDialogOpen: (v: boolean) => void; bulkDialogOpen: boolean; setBulkDialogOpen: (v: boolean) => void; filters: FilterState;
}) {
  const { toast } = useToast();
  const download = useDownloadFile();
  const [selectedClients, setSelectedClients] = useState<string[]>([]);
  const [formData, setFormData] = useState({ serviceName: "", serviceCode: "", category: "", description: "", unit: "HR", rate: "", minimumHours: "", travelFee: "", leadTimeDays: "" });

  const { data: serviceItems, isLoading } = useQuery<ServicePricingItem[]>({ queryKey: ["/api/vendor/service-pricing"] });

  const submitMutation = useMutation({
    mutationFn: async (data: PricingSubmitPayload) => { const r = await apiRequest("POST", "/api/vendor/service-pricing", data); return r.json(); },
    onSuccess: () => { toast({ title: "Service pricing submitted", description: "Your service pricing has been submitted." }); queryClient.invalidateQueries({ queryKey: ["/api/vendor/service-pricing"] }); setAddDialogOpen(false); resetForm(); },
    onError: (error: Error) => { toast({ title: "Error", description: error.message || "Failed to submit", variant: "destructive" }); },
  });

  const resetForm = () => { setFormData({ serviceName: "", serviceCode: "", category: "", description: "", unit: "HR", rate: "", minimumHours: "", travelFee: "", leadTimeDays: "" }); setSelectedClients([]); };

  const handleSubmit = () => {
    if (!formData.serviceName || !formData.rate || !formData.category) { toast({ title: "Validation error", description: "Service name, category, and rate are required", variant: "destructive" }); return; }
    submitMutation.mutate({ items: [{ serviceName: formData.serviceName, serviceCode: formData.serviceCode || null, category: formData.category, description: formData.description || null, unit: formData.unit, rate: formData.rate, minimumHours: formData.minimumHours || null, travelFee: formData.travelFee || null, leadTimeDays: formData.leadTimeDays || null }], contractorOrgIds: selectedClients.length > 0 ? selectedClients : undefined });
  };

  const filteredItems = serviceItems?.filter(item => {
    const matchesSearch = !filters.searchTerm || item.serviceName.toLowerCase().includes(filters.searchTerm.toLowerCase()) || (item.serviceCode?.toLowerCase().includes(filters.searchTerm.toLowerCase()));
    return (filters.categoryOrType === "all" || item.category === filters.categoryOrType) && (filters.status === "all" || item.approvalStatus === filters.status) && matchesSearch;
  }) || [];

  return (
    <>
      <div className="flex gap-2 mb-4">
        <Button variant="outline" size="sm" onClick={() => download(buildExportUrl("/api/vendor/service-pricing/export", filters, "category"), "service_pricing_export.csv")} data-testid="button-export-services"><Download className="h-4 w-4 mr-2" />Export CSV</Button>
      </div>
      <Card>
        <CardContent className="pt-6">
          {isLoading ? <div className="space-y-2">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
          : filteredItems.length > 0 ? (
            <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Service Name</TableHead><TableHead>Code</TableHead><TableHead>Category</TableHead><TableHead>Unit</TableHead><TableHead className="text-right">Rate</TableHead><TableHead>Status</TableHead><TableHead>Submitted</TableHead></TableRow></TableHeader><TableBody>
              {filteredItems.map(item => (<TableRow key={item.id} data-testid={`row-service-${item.id}`}><TableCell className="font-medium">{item.serviceName}</TableCell><TableCell className="text-muted-foreground">{item.serviceCode || "-"}</TableCell><TableCell>{item.category}</TableCell><TableCell>{item.unit}</TableCell><TableCell className="text-right font-medium">${parseFloat(item.rate).toFixed(2)}</TableCell><TableCell>{getStatusBadge(item.approvalStatus)}</TableCell><TableCell className="text-muted-foreground">{new Date(item.createdAt).toLocaleDateString()}</TableCell></TableRow>))}
            </TableBody></Table></div>
          ) : <div className="text-center py-12 text-muted-foreground"><Package className="h-12 w-12 mx-auto mb-4 opacity-50" /><p className="text-lg font-medium">No service items found</p><p className="text-sm">{serviceItems?.length === 0 ? "Add your first service item" : "Try adjusting your search or filters"}</p></div>}
        </CardContent>
      </Card>

      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Add Service Pricing Item</DialogTitle><DialogDescription>Add service pricing to submit to your enrolled contractor clients</DialogDescription></DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Service Name *</Label><Input value={formData.serviceName} onChange={(e) => setFormData({...formData, serviceName: e.target.value})} placeholder="e.g., Foundation Excavation" data-testid="input-service-name" /></div>
              <div className="space-y-2"><Label>Service Code</Label><Input value={formData.serviceCode} onChange={(e) => setFormData({...formData, serviceCode: e.target.value})} placeholder="e.g., EXC-001" data-testid="input-service-code" /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Category *</Label><Select value={formData.category} onValueChange={(v) => setFormData({...formData, category: v})}><SelectTrigger data-testid="select-service-category"><SelectValue placeholder="Select category" /></SelectTrigger><SelectContent>{SERVICE_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label>Unit *</Label><Select value={formData.unit} onValueChange={(v) => setFormData({...formData, unit: v})}><SelectTrigger data-testid="select-service-unit"><SelectValue /></SelectTrigger><SelectContent>{SERVICE_UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <div className="space-y-2"><Label>Description</Label><Textarea value={formData.description} onChange={(e) => setFormData({...formData, description: e.target.value})} placeholder="Describe the service..." data-testid="input-service-description" /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Rate ($) *</Label><Input type="number" step="0.01" value={formData.rate} onChange={(e) => setFormData({...formData, rate: e.target.value})} placeholder="0.00" data-testid="input-service-rate" /></div>
              <div className="space-y-2"><Label>Minimum Hours</Label><Input type="number" step="0.5" value={formData.minimumHours} onChange={(e) => setFormData({...formData, minimumHours: e.target.value})} placeholder="1" data-testid="input-minimum-hours" /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Travel Fee ($)</Label><Input type="number" step="0.01" value={formData.travelFee} onChange={(e) => setFormData({...formData, travelFee: e.target.value})} placeholder="0.00" data-testid="input-travel-fee" /></div>
              <div className="space-y-2"><Label>Lead Time (days)</Label><Input type="number" value={formData.leadTimeDays} onChange={(e) => setFormData({...formData, leadTimeDays: e.target.value})} placeholder="1" data-testid="input-service-lead-time" /></div>
            </div>
            <ClientSelector enrollments={activeEnrollments} selected={selectedClients} onChange={setSelectedClients} testIdPrefix="checkbox-service-client" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={submitMutation.isPending} data-testid="button-submit-service">{submitMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Submit Pricing</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BulkUploadDialog open={bulkDialogOpen} onClose={() => setBulkDialogOpen(false)} templateUrl="/api/vendor/service-pricing/csv-template" templateFilename="service_pricing_template.csv" uploadEndpoint="/api/vendor/service-pricing/bulk" queryKeyToInvalidate="/api/vendor/service-pricing" activeEnrollments={activeEnrollments} title="Add Bulk Service Items" />
    </>
  );
}

function getCategoryOptions(tab: PricingTab): string[] {
  switch (tab) {
    case "materials": return MATERIAL_CATEGORIES;
    case "rental": return EQUIPMENT_TYPES;
    case "services": return SERVICE_CATEGORIES;
  }
}

function getCategoryLabel(tab: PricingTab): string {
  switch (tab) {
    case "materials": return "Category";
    case "rental": return "Type";
    case "services": return "Category";
  }
}

function getCategoryPlaceholder(tab: PricingTab): string {
  switch (tab) {
    case "materials": return "All Categories";
    case "rental": return "All Types";
    case "services": return "All Categories";
  }
}

function getSearchPlaceholder(tab: PricingTab): string {
  switch (tab) {
    case "materials": return "Search items...";
    case "rental": return "Search equipment...";
    case "services": return "Search services...";
  }
}

export default function VendorPricing() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<PricingTab>("materials");
  const [materialAddOpen, setMaterialAddOpen] = useState(false);
  const [materialBulkOpen, setMaterialBulkOpen] = useState(false);
  const [rentalAddOpen, setRentalAddOpen] = useState(false);
  const [rentalBulkOpen, setRentalBulkOpen] = useState(false);
  const [serviceAddOpen, setServiceAddOpen] = useState(false);
  const [serviceBulkOpen, setServiceBulkOpen] = useState(false);

  const [filters, setFilters] = useState<FilterState>({ searchTerm: "", categoryOrType: "all", status: "all" });

  if (!isVendor(user?.role)) {
    return <Redirect to="/dashboard" />;
  }

  const { data: enrollments } = useQuery<VendorEnrollment[]>({ queryKey: ["/api/vendor/enrollments"] });
  const activeEnrollments = enrollments?.filter(e => e.status === "ACTIVE") || [];

  const handleTabChange = (newTab: string) => {
    setActiveTab(newTab as PricingTab);
    setFilters({ searchTerm: "", categoryOrType: "all", status: "all" });
  };

  const tabConfig: Record<PricingTab, { addLabel: string; bulkLabel: string; openAdd: () => void; openBulk: () => void }> = {
    materials: { addLabel: "Add Pricing Item", bulkLabel: "Add Bulk Items", openAdd: () => setMaterialAddOpen(true), openBulk: () => setMaterialBulkOpen(true) },
    rental: { addLabel: "Add Equipment Item", bulkLabel: "Add Bulk Equipment", openAdd: () => setRentalAddOpen(true), openBulk: () => setRentalBulkOpen(true) },
    services: { addLabel: "Add Service Item", bulkLabel: "Add Bulk Services", openAdd: () => setServiceAddOpen(true), openBulk: () => setServiceBulkOpen(true) },
  };

  const categoryOptions = getCategoryOptions(activeTab);
  const formatOption = activeTab === "rental" ? formatEquipmentType : (v: string) => v;

  return (
    <div className="min-h-screen bg-background">
      <main className="container mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground" data-testid="text-vendor-pricing-title">My Pricing</h1>
            <p className="text-muted-foreground">Manage your pricing items for enrolled contractor clients</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={tabConfig[activeTab].openBulk} data-testid="button-add-bulk-items"><Upload className="h-4 w-4 mr-2" />{tabConfig[activeTab].bulkLabel}</Button>
            <Button onClick={tabConfig[activeTab].openAdd} data-testid="button-add-pricing"><Plus className="h-4 w-4 mr-2" />{tabConfig[activeTab].addLabel}</Button>
          </div>
        </div>

        <div className="flex flex-col md:flex-row gap-4 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder={getSearchPlaceholder(activeTab)} value={filters.searchTerm} onChange={(e) => setFilters(f => ({ ...f, searchTerm: e.target.value }))} className="pl-10" data-testid="input-search-pricing" />
          </div>
          <div className="flex gap-2">
            <Select value={filters.categoryOrType} onValueChange={(v) => setFilters(f => ({ ...f, categoryOrType: v }))}>
              <SelectTrigger className="w-[180px]" data-testid="select-filter-category"><Filter className="h-4 w-4 mr-2" /><SelectValue placeholder={getCategoryLabel(activeTab)} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{getCategoryPlaceholder(activeTab)}</SelectItem>
                {categoryOptions.map(c => <SelectItem key={c} value={c}>{formatOption(c)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.status} onValueChange={(v) => setFilters(f => ({ ...f, status: v }))}>
              <SelectTrigger className="w-[150px]" data-testid="select-filter-status"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="AUTO_APPROVED">Auto Approved</SelectItem>
                <SelectItem value="APPROVED">Approved</SelectItem>
                <SelectItem value="PENDING_REVIEW">Pending</SelectItem>
                <SelectItem value="REJECTED">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
          <TabsList className="mb-4" data-testid="tabs-pricing">
            <TabsTrigger value="materials" data-testid="tab-materials">Material Pricing</TabsTrigger>
            <TabsTrigger value="rental" data-testid="tab-rental">Rental Equipment Pricing</TabsTrigger>
            <TabsTrigger value="services" data-testid="tab-services">Service Pricing</TabsTrigger>
          </TabsList>
          <TabsContent value="materials">
            <MaterialPricingContent activeEnrollments={activeEnrollments} addDialogOpen={materialAddOpen} setAddDialogOpen={setMaterialAddOpen} bulkDialogOpen={materialBulkOpen} setBulkDialogOpen={setMaterialBulkOpen} filters={filters} />
          </TabsContent>
          <TabsContent value="rental">
            <RentalPricingContent activeEnrollments={activeEnrollments} addDialogOpen={rentalAddOpen} setAddDialogOpen={setRentalAddOpen} bulkDialogOpen={rentalBulkOpen} setBulkDialogOpen={setRentalBulkOpen} filters={filters} />
          </TabsContent>
          <TabsContent value="services">
            <ServicePricingContent activeEnrollments={activeEnrollments} addDialogOpen={serviceAddOpen} setAddDialogOpen={setServiceAddOpen} bulkDialogOpen={serviceBulkOpen} setBulkDialogOpen={setServiceBulkOpen} filters={filters} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
