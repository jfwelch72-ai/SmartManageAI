import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { 
  Loader2, 
  CheckCircle2, 
  Upload,
  Download,
  RefreshCw,
  Search,
  Plus,
  Pencil,
  Trash2,
  DollarSign,
  Package,
  Clock,
  TrendingUp,
  TrendingDown,
  FileSpreadsheet,
  Building2
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { format, parseISO, differenceInDays } from "date-fns";

interface PricebookItem {
  id: string;
  sku: string;
  name: string;
  description?: string;
  category: string;
  unitPrice: number;
  uom: string;
  lastUpdated: string;
  priceChange?: number;
}

interface Pricebook {
  id: string;
  vendorId: string;
  vendorName: string;
  version: string;
  effectiveDate: string;
  expirationDate?: string;
  itemCount: number;
  isActive: boolean;
  lastSyncedAt?: string;
  createdAt: string;
}

interface VendorPricingSyncProps {
  organizationId?: string;
}

export default function VendorPricingSync({ organizationId }: VendorPricingSyncProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPricebook, setSelectedPricebook] = useState<string | null>(null);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [addItemDialogOpen, setAddItemDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<PricebookItem | null>(null);
  const [selectedVendorId, setSelectedVendorId] = useState<string>("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  
  const { toast } = useToast();

  interface CrmOrganisation {
    id: string;
    name: string;
    type: string;
  }

  const { data: vendors = [] } = useQuery<CrmOrganisation[]>({
    queryKey: ["/api/crm/organisations"],
    select: (data) => data.filter(org => 
      org.type === "SUPPLIER" || org.type === "VENDOR"
    ),
  });

  interface PricebookResponse {
    pricebooks: Pricebook[];
    items: PricebookItem[];
    stats: {
      totalItems: number;
      avgPriceChange: number;
      lastSync: string | null;
    };
  }

  const { data, isLoading, refetch } = useQuery<PricebookResponse>({
    queryKey: ["/api/ai-features/vendor-pricebooks"],
  });

  const { data: selectedItems, isLoading: loadingItems } = useQuery<{ items: PricebookItem[] }>({
    queryKey: ["/api/ai-features/vendor-pricebooks", selectedPricebook, "items"],
    enabled: !!selectedPricebook,
    select: (data: any) => ({
      items: (data?.items || []).map((item: any) => ({
        id: item.id,
        sku: item.vendorCode || item.sku || '',
        name: item.vendorDescription || item.name || '',
        category: item.category || '',
        unitPrice: Number(item.unitPrice) || 0,
        uom: item.unit || item.uom || 'EA',
        lastUpdated: item.lastUpdated,
        priceChange: item.priceChange,
      }))
    })
  });

  const uploadMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const response = await fetch("/api/ai-features/vendor-pricebooks/upload", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Upload failed");
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-features/vendor-pricebooks"] });
      setUploadDialogOpen(false);
      setSelectedVendorId("");
      setUploadFile(null);
      toast({
        title: "Pricebook Uploaded",
        description: `Imported ${data.itemCount || 0} items from the pricebook`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Upload Failed",
        description: error.message || "Failed to upload pricebook",
        variant: "destructive",
      });
    },
  });

  const syncMutation = useMutation({
    mutationFn: async (pricebookId: string) => {
      const response = await apiRequest("POST", `/api/ai-features/vendor-pricebooks/${pricebookId}/sync`, {});
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-features/vendor-pricebooks"] });
      toast({
        title: "Sync Complete",
        description: "Pricebook has been synchronized",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Sync Failed",
        description: error.message || "Failed to sync pricebook",
        variant: "destructive",
      });
    },
  });

  const saveItemMutation = useMutation({
    mutationFn: async (item: Partial<PricebookItem>) => {
      // Map frontend field names to backend field names
      const backendItem = {
        vendorCode: item.sku,
        vendorDescription: item.name,
        category: item.category,
        unitPrice: item.unitPrice,
        unit: item.uom,
      };
      
      if (item.id) {
        const response = await apiRequest("PATCH", `/api/ai-features/vendor-pricebooks/items/${item.id}`, backendItem);
        return response.json();
      } else {
        const response = await apiRequest("POST", `/api/ai-features/vendor-pricebooks/${selectedPricebook}/items`, backendItem);
        return response.json();
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-features/vendor-pricebooks"] });
      if (selectedPricebook) {
        queryClient.invalidateQueries({ queryKey: ["/api/ai-features/vendor-pricebooks", selectedPricebook, "items"] });
      }
      setAddItemDialogOpen(false);
      setEditingItem(null);
      toast({
        title: "Item Saved",
        description: "Pricebook item has been updated",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Save Failed",
        description: error.message || "Failed to save item",
        variant: "destructive",
      });
    },
  });

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setUploadFile(file);
    }
  };

  const handleFileUpload = () => {
    if (!uploadFile || !selectedVendorId) {
      toast({
        title: "Missing Information",
        description: "Please select a vendor and choose a file to upload",
        variant: "destructive",
      });
      return;
    }

    const formData = new FormData();
    formData.append("file", uploadFile);
    formData.append("vendorId", selectedVendorId);
    uploadMutation.mutate(formData);
  };

  const pricebooks = data?.pricebooks || [];
  const stats = data?.stats || { totalItems: 0, avgPriceChange: 0, lastSync: null };
  const items = selectedItems?.items || [];
  
  const filteredItems = items.filter(item => {
    const query = searchQuery.toLowerCase();
    return (
      (item.name?.toLowerCase() || '').includes(query) ||
      (item.sku?.toLowerCase() || '').includes(query) ||
      (item.category?.toLowerCase() || '').includes(query)
    );
  });

  const activePricebook = pricebooks.find(p => p.id === selectedPricebook);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Vendor Pricebooks</h2>
          <p className="text-muted-foreground">
            Manage vendor pricing for accurate estimates
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => refetch()} data-testid="button-refresh-pricebooks">
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-upload-pricebook">
                <Upload className="w-4 h-4 mr-2" />
                Upload Pricebook
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Upload Vendor Pricebook</DialogTitle>
                <DialogDescription>
                  Upload an Excel or CSV file with vendor pricing data
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="vendor-select">Select Vendor *</Label>
                  <Select value={selectedVendorId} onValueChange={setSelectedVendorId}>
                    <SelectTrigger id="vendor-select" data-testid="select-vendor">
                      <SelectValue placeholder="Choose a vendor" />
                    </SelectTrigger>
                    <SelectContent>
                      {vendors.length === 0 ? (
                        <div className="p-2 text-sm text-muted-foreground text-center">
                          No vendors found. Add vendors in CRM first.
                        </div>
                      ) : (
                        vendors.map((vendor) => (
                          <SelectItem key={vendor.id} value={vendor.id}>
                            {vendor.name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="border-2 border-dashed rounded-lg p-6 text-center">
                  <FileSpreadsheet className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
                  <p className="text-sm text-muted-foreground mb-3">
                    Drag and drop your file here, or click to browse
                  </p>
                  <input
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    onChange={handleFileSelect}
                    className="hidden"
                    id="pricebook-file-input"
                    data-testid="input-file-upload"
                  />
                  <Button
                    type="button"
                    className="bg-orange-500 hover:bg-orange-600 text-white"
                    onClick={() => document.getElementById('pricebook-file-input')?.click()}
                    data-testid="button-select-file"
                  >
                    Select File
                  </Button>
                  {uploadFile && (
                    <p className="text-sm text-primary mt-2">
                      Selected: {uploadFile.name}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-3">
                    Supported formats: CSV, Excel (.xlsx, .xls)
                  </p>
                </div>
              </div>
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => {
                  setUploadDialogOpen(false);
                  setSelectedVendorId("");
                  setUploadFile(null);
                }}>
                  Cancel
                </Button>
                <Button 
                  onClick={handleFileUpload}
                  disabled={!selectedVendorId || !uploadFile || uploadMutation.isPending}
                  data-testid="button-upload-submit"
                >
                  {uploadMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4 mr-2" />
                      Upload Pricebook
                    </>
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Building2 className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Active Pricebooks</p>
                <p className="text-2xl font-bold">{pricebooks.filter(p => p.isActive).length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Package className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Items</p>
                <p className="text-2xl font-bold">{stats.totalItems.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className={cn("p-2 rounded-lg", stats.avgPriceChange >= 0 ? "bg-red-100" : "bg-green-100")}>
                {stats.avgPriceChange >= 0 ? (
                  <TrendingUp className="w-5 h-5 text-red-600" />
                ) : (
                  <TrendingDown className="w-5 h-5 text-green-600" />
                )}
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Avg Price Change</p>
                <p className={cn("text-2xl font-bold", stats.avgPriceChange >= 0 ? "text-red-600" : "text-green-600")}>
                  {stats.avgPriceChange >= 0 ? "+" : ""}{stats.avgPriceChange.toFixed(1)}%
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gray-100 rounded-lg">
                <Clock className="w-5 h-5 text-gray-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Last Sync</p>
                <p className="text-lg font-bold">
                  {stats.lastSync ? format(parseISO(stats.lastSync), "MMM d") : "Never"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-lg">Vendor Pricebooks</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px]">
              <div className="space-y-2">
                {pricebooks.length === 0 ? (
                  <div className="text-center py-8">
                    <FileSpreadsheet className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                    <p className="text-sm text-muted-foreground">No pricebooks yet</p>
                    <p className="text-xs text-muted-foreground">Upload a vendor pricebook to get started</p>
                  </div>
                ) : (
                  pricebooks.map(pricebook => (
                    <div
                      key={pricebook.id}
                      className={cn(
                        "p-3 rounded-lg border cursor-pointer transition-colors",
                        selectedPricebook === pricebook.id 
                          ? "bg-primary/10 border-primary" 
                          : "hover-elevate"
                      )}
                      onClick={() => setSelectedPricebook(pricebook.id)}
                      data-testid={`pricebook-${pricebook.id}`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <p className="font-medium text-sm truncate">{pricebook.vendorName}</p>
                        {pricebook.isActive ? (
                          <Badge variant="secondary" className="text-xs">Active</Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs">Inactive</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {pricebook.itemCount} items • v{pricebook.version}
                      </p>
                      {pricebook.effectiveDate && (
                        <p className="text-xs text-muted-foreground">
                          Effective {format(parseISO(pricebook.effectiveDate), "MMM d, yyyy")}
                        </p>
                      )}
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">
                  {activePricebook ? activePricebook.vendorName : "Select a Pricebook"}
                </CardTitle>
                {activePricebook && (
                  <CardDescription>
                    Version {activePricebook.version} • {activePricebook.itemCount} items
                  </CardDescription>
                )}
              </div>
              {activePricebook && (
                <div className="flex gap-2">
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => syncMutation.mutate(activePricebook.id)}
                    disabled={syncMutation.isPending}
                    data-testid="button-sync-pricebook"
                  >
                    {syncMutation.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <RefreshCw className="w-4 h-4 mr-2" />
                    )}
                    Sync
                  </Button>
                  <Button 
                    size="sm" 
                    onClick={() => setAddItemDialogOpen(true)}
                    data-testid="button-add-item"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add Item
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {!selectedPricebook ? (
              <div className="text-center py-12">
                <Package className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">Select a Pricebook</h3>
                <p className="text-muted-foreground">
                  Choose a vendor pricebook from the list to view and manage items
                </p>
              </div>
            ) : loadingItems ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <div className="flex items-center gap-4 mb-4">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Search by name, SKU, or category..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-10"
                      data-testid="input-search-items"
                    />
                  </div>
                </div>

                <ScrollArea className="h-[350px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>SKU</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead className="text-right">Unit Price</TableHead>
                        <TableHead>UOM</TableHead>
                        <TableHead>Change</TableHead>
                        <TableHead className="w-[80px]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredItems.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center py-8">
                            <p className="text-muted-foreground">
                              {searchQuery ? "No items match your search" : "No items in this pricebook"}
                            </p>
                          </TableCell>
                        </TableRow>
                      ) : (
                        filteredItems.map(item => (
                          <TableRow key={item.id} data-testid={`row-item-${item.id}`}>
                            <TableCell className="font-mono text-sm">{item.sku}</TableCell>
                            <TableCell className="font-medium">{item.name}</TableCell>
                            <TableCell>
                              <Badge variant="outline">{item.category}</Badge>
                            </TableCell>
                            <TableCell className="text-right font-medium">
                              ${Number(item.unitPrice || 0).toFixed(2)}
                            </TableCell>
                            <TableCell>{item.uom}</TableCell>
                            <TableCell>
                              {item.priceChange != null && Number(item.priceChange) !== 0 && (
                                <span className={cn(
                                  "text-sm font-medium",
                                  Number(item.priceChange) > 0 ? "text-red-600" : "text-green-600"
                                )}>
                                  {Number(item.priceChange) > 0 ? "+" : ""}{Number(item.priceChange).toFixed(1)}%
                                </span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                  setEditingItem(item);
                                  setAddItemDialogOpen(true);
                                }}
                                data-testid={`button-edit-${item.id}`}
                              >
                                <Pencil className="w-4 h-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={addItemDialogOpen} onOpenChange={(open) => {
        setAddItemDialogOpen(open);
        if (!open) setEditingItem(null);
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingItem ? "Edit Item" : "Add New Item"}</DialogTitle>
            <DialogDescription>
              {editingItem ? "Update the pricing information" : "Add a new item to the pricebook"}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            const item = {
              id: editingItem?.id,
              sku: formData.get("sku") as string,
              name: formData.get("name") as string,
              category: formData.get("category") as string,
              unitPrice: parseFloat(formData.get("unitPrice") as string),
              uom: formData.get("uom") as string,
              description: formData.get("description") as string,
            };
            saveItemMutation.mutate(item);
          }}>
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="sku">SKU</Label>
                  <Input
                    id="sku"
                    name="sku"
                    defaultValue={editingItem?.sku}
                    required
                    data-testid="input-sku"
                  />
                </div>
                <div>
                  <Label htmlFor="category">Category</Label>
                  <Input
                    id="category"
                    name="category"
                    defaultValue={editingItem?.category}
                    required
                    data-testid="input-category"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  name="name"
                  defaultValue={editingItem?.name}
                  required
                  data-testid="input-name"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="unitPrice">Unit Price</Label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="unitPrice"
                      name="unitPrice"
                      type="number"
                      step="0.01"
                      className="pl-10"
                      defaultValue={editingItem?.unitPrice}
                      required
                      data-testid="input-unit-price"
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="uom">Unit of Measure</Label>
                  <Select name="uom" defaultValue={editingItem?.uom || "EA"}>
                    <SelectTrigger data-testid="select-uom">
                      <SelectValue placeholder="Select UOM" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="EA">Each (EA)</SelectItem>
                      <SelectItem value="SF">Square Foot (SF)</SelectItem>
                      <SelectItem value="LF">Linear Foot (LF)</SelectItem>
                      <SelectItem value="SQ">Square (SQ)</SelectItem>
                      <SelectItem value="CY">Cubic Yard (CY)</SelectItem>
                      <SelectItem value="TON">Ton (TON)</SelectItem>
                      <SelectItem value="GAL">Gallon (GAL)</SelectItem>
                      <SelectItem value="LB">Pound (LB)</SelectItem>
                      <SelectItem value="HR">Hour (HR)</SelectItem>
                      <SelectItem value="LS">Lump Sum (LS)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => {
                setAddItemDialogOpen(false);
                setEditingItem(null);
              }}>
                Cancel
              </Button>
              <Button type="submit" disabled={saveItemMutation.isPending}>
                {saveItemMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                )}
                {editingItem ? "Update" : "Add"} Item
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
