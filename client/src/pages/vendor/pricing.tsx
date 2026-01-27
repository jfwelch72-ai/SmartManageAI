import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Search, Package, Filter, Loader2, Upload, Download, FileSpreadsheet, AlertCircle, CheckCircle2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isVendor } from "@/lib/rbac";
import { Redirect } from "wouter";

interface VendorPricingItem {
  id: string;
  itemName: string;
  itemCode: string | null;
  category: string | null;
  description: string | null;
  unit: string;
  unitPrice: string;
  minimumOrder: number | null;
  deliveryFee: string | null;
  leadTimeDays: number | null;
  approvalStatus: string;
  createdAt: string;
  organizationId: string;
}

interface VendorEnrollment {
  id: string;
  contractorOrgId: string;
  contractorOrgName: string;
  status: string;
}

const CATEGORIES = [
  "General Materials",
  "Roofing Materials",
  "Electrical Supplies",
  "Plumbing Supplies",
  "HVAC Equipment",
  "Concrete & Masonry",
  "Lumber & Framing",
  "Drywall & Finishing",
  "Paint & Coatings",
  "Flooring",
  "Safety Equipment",
  "Tools & Equipment",
  "Fasteners & Hardware",
  "Insulation",
  "Windows & Doors",
  "Landscaping",
  "Other",
];

const UNITS = [
  "EA", "SF", "SY", "LF", "CY", "TON", "LB", "GAL", "HR", "LS", "SQ", "BD FT", "ROLL", "BOX", "PALLET"
];

export default function VendorPricing() {
  const { user, logout, organizationName } = useAuth();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedClients, setSelectedClients] = useState<string[]>([]);
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [bulkStep, setBulkStep] = useState<number>(1);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [bulkSelectedClients, setBulkSelectedClients] = useState<string[]>([]);

  if (!isVendor(user?.role)) {
    return <Redirect to="/dashboard" />;
  }

  const [formData, setFormData] = useState({
    itemName: "",
    itemCode: "",
    category: "",
    description: "",
    unit: "EA",
    unitPrice: "",
    minimumOrder: "",
    deliveryFee: "",
    leadTimeDays: "",
  });

  const { data: pricingItems, isLoading } = useQuery<VendorPricingItem[]>({
    queryKey: ["/api/vendor/pricing"],
  });

  const { data: enrollments } = useQuery<VendorEnrollment[]>({
    queryKey: ["/api/vendor/enrollments"],
  });

  const activeEnrollments = enrollments?.filter(e => e.status === "ACTIVE") || [];

  const submitPricingMutation = useMutation({
    mutationFn: async (data: { items: any[]; contractorOrgIds?: string[] }) => {
      const response = await apiRequest("POST", "/api/vendor/pricing", data);
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Pricing submitted",
        description: "Your pricing has been submitted to the selected clients.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/vendor/pricing"] });
      setDialogOpen(false);
      resetForm();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to submit pricing",
        variant: "destructive",
      });
    },
  });

  const bulkUploadMutation = useMutation({
    mutationFn: async (data: { csvData: string; contractorOrgIds?: string[] }) => {
      const response = await apiRequest("POST", "/api/vendor/pricing/bulk", data);
      return response.json();
    },
    onSuccess: (data) => {
      setUploadSuccess(`Items added successfully. ${data.itemsCreated} items uploaded.`);
      setUploadError(null);
      queryClient.invalidateQueries({ queryKey: ["/api/vendor/pricing"] });
    },
    onError: (error: any) => {
      // Parse error message - apiRequest throws "statusCode: jsonBody" format
      let errorMessage = "Failed to upload items";
      try {
        const errorText = error.message || "";
        // Try to extract JSON from the error message (format: "400: {...}")
        const jsonMatch = errorText.match(/^\d+:\s*(.+)$/);
        if (jsonMatch) {
          const errorData = JSON.parse(jsonMatch[1]);
          if (errorData.error === "EMPTY_FILE") {
            errorMessage = "You uploaded an empty file. Please fill out the CSV and upload again.";
          } else if (errorData.error === "INVALID_FORMAT") {
            errorMessage = "Error: File does not match the required format. Please download the template and use the correct headers.";
          } else {
            errorMessage = errorData.message || errorData.error || errorMessage;
          }
        }
      } catch {
        // If parsing fails, use the raw error message
        errorMessage = error.message || "Failed to upload items";
      }
      setUploadError(errorMessage);
      setUploadSuccess(null);
    },
  });

  const handleDownloadTemplate = async () => {
    try {
      const response = await fetch("/api/vendor/pricing/csv-template", {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Failed to download template");
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "pricing_template.csv";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      toast({
        title: "Download failed",
        description: "Could not download the CSV template. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setUploadedFile(file);
      setUploadError(null);
      setUploadSuccess(null);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    if (file && file.name.endsWith(".csv")) {
      setUploadedFile(file);
      setUploadError(null);
      setUploadSuccess(null);
    } else {
      setUploadError("Please upload a CSV file");
    }
  };

  const handleBulkUpload = async () => {
    if (!uploadedFile) {
      setUploadError("Please select a file to upload");
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      const csvData = e.target?.result as string;
      bulkUploadMutation.mutate({
        csvData,
        contractorOrgIds: bulkSelectedClients.length > 0 ? bulkSelectedClients : undefined,
      });
    };
    reader.readAsText(uploadedFile);
  };

  const resetBulkDialog = () => {
    setBulkStep(1);
    setUploadedFile(null);
    setUploadError(null);
    setUploadSuccess(null);
    setBulkSelectedClients([]);
  };

  const handleCloseBulkDialog = () => {
    setBulkDialogOpen(false);
    resetBulkDialog();
  };

  const resetForm = () => {
    setFormData({
      itemName: "",
      itemCode: "",
      category: "",
      description: "",
      unit: "EA",
      unitPrice: "",
      minimumOrder: "",
      deliveryFee: "",
      leadTimeDays: "",
    });
    setSelectedClients([]);
  };

  const handleSubmit = () => {
    if (!formData.itemName || !formData.unitPrice) {
      toast({
        title: "Validation error",
        description: "Item name and unit price are required",
        variant: "destructive",
      });
      return;
    }

    const items = [{
      itemName: formData.itemName,
      itemCode: formData.itemCode || null,
      category: formData.category || null,
      description: formData.description || null,
      unit: formData.unit,
      unitPrice: formData.unitPrice,
      minimumOrder: formData.minimumOrder ? parseInt(formData.minimumOrder) : null,
      deliveryFee: formData.deliveryFee || null,
      leadTimeDays: formData.leadTimeDays ? parseInt(formData.leadTimeDays) : null,
    }];

    submitPricingMutation.mutate({
      items,
      contractorOrgIds: selectedClients.length > 0 ? selectedClients : undefined,
    });
  };

  const filteredItems = pricingItems?.filter(item => {
    const matchesSearch = 
      item.itemName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.itemCode?.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesCategory = categoryFilter === "all" || item.category === categoryFilter;
    const matchesStatus = statusFilter === "all" || item.approvalStatus === statusFilter;
    return matchesSearch && matchesCategory && matchesStatus;
  }) || [];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "AUTO_APPROVED":
      case "APPROVED":
        return <Badge variant="default">Approved</Badge>;
      case "PENDING_REVIEW":
        return <Badge variant="secondary">Pending Review</Badge>;
      case "REJECTED":
        return <Badge variant="destructive">Rejected</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <main className="container mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground" data-testid="text-vendor-pricing-title">
              My Pricing
            </h1>
            <p className="text-muted-foreground">
              Manage your pricing items for enrolled contractor clients
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setBulkDialogOpen(true)} data-testid="button-add-bulk-items">
              <Upload className="h-4 w-4 mr-2" />
              Add Bulk Items
            </Button>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button data-testid="button-add-pricing">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Pricing Item
                </Button>
              </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Add Pricing Item</DialogTitle>
                <DialogDescription>
                  Add a new pricing item to submit to your enrolled contractor clients
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="itemName">Item Name *</Label>
                    <Input
                      id="itemName"
                      value={formData.itemName}
                      onChange={(e) => setFormData({...formData, itemName: e.target.value})}
                      placeholder="e.g., 2x4x8 Stud"
                      data-testid="input-item-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="itemCode">Item Code</Label>
                    <Input
                      id="itemCode"
                      value={formData.itemCode}
                      onChange={(e) => setFormData({...formData, itemCode: e.target.value})}
                      placeholder="e.g., LBR-2X4X8"
                      data-testid="input-item-code"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="category">Category</Label>
                    <Select 
                      value={formData.category} 
                      onValueChange={(value) => setFormData({...formData, category: value})}
                    >
                      <SelectTrigger data-testid="select-category">
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        {CATEGORIES.map(cat => (
                          <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="unit">Unit *</Label>
                    <Select 
                      value={formData.unit} 
                      onValueChange={(value) => setFormData({...formData, unit: value})}
                    >
                      <SelectTrigger data-testid="select-unit">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {UNITS.map(unit => (
                          <SelectItem key={unit} value={unit}>{unit}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={formData.description}
                    onChange={(e) => setFormData({...formData, description: e.target.value})}
                    placeholder="Describe the product..."
                    data-testid="input-description"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="unitPrice">Unit Price ($) *</Label>
                    <Input
                      id="unitPrice"
                      type="number"
                      step="0.01"
                      value={formData.unitPrice}
                      onChange={(e) => setFormData({...formData, unitPrice: e.target.value})}
                      placeholder="0.00"
                      data-testid="input-unit-price"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="minimumOrder">Minimum Order</Label>
                    <Input
                      id="minimumOrder"
                      type="number"
                      value={formData.minimumOrder}
                      onChange={(e) => setFormData({...formData, minimumOrder: e.target.value})}
                      placeholder="1"
                      data-testid="input-minimum-order"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="deliveryFee">Delivery Fee ($)</Label>
                    <Input
                      id="deliveryFee"
                      type="number"
                      step="0.01"
                      value={formData.deliveryFee}
                      onChange={(e) => setFormData({...formData, deliveryFee: e.target.value})}
                      placeholder="0.00"
                      data-testid="input-delivery-fee"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="leadTimeDays">Lead Time (days)</Label>
                    <Input
                      id="leadTimeDays"
                      type="number"
                      value={formData.leadTimeDays}
                      onChange={(e) => setFormData({...formData, leadTimeDays: e.target.value})}
                      placeholder="1"
                      data-testid="input-lead-time"
                    />
                  </div>
                </div>

                {activeEnrollments.length > 0 && (
                  <div className="space-y-2">
                    <Label>Submit to Clients</Label>
                    <p className="text-xs text-muted-foreground mb-2">
                      Select specific clients or leave empty to submit to all enrolled clients
                    </p>
                    <div className="space-y-2 max-h-40 overflow-y-auto border rounded-md p-2">
                      {activeEnrollments.map(enrollment => (
                        <label 
                          key={enrollment.id} 
                          className="flex items-center gap-2 p-2 rounded hover-elevate cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={selectedClients.includes(enrollment.contractorOrgId)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedClients([...selectedClients, enrollment.contractorOrgId]);
                              } else {
                                setSelectedClients(selectedClients.filter(id => id !== enrollment.contractorOrgId));
                              }
                            }}
                            className="rounded"
                            data-testid={`checkbox-client-${enrollment.contractorOrgId}`}
                          />
                          <span className="text-sm">{enrollment.contractorOrgName}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button 
                  onClick={handleSubmit} 
                  disabled={submitPricingMutation.isPending}
                  data-testid="button-submit-pricing"
                >
                  {submitPricingMutation.isPending && (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  )}
                  Submit Pricing
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          </div>

          <Dialog open={bulkDialogOpen} onOpenChange={(open) => {
            if (!open) handleCloseBulkDialog();
            else setBulkDialogOpen(true);
          }}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Add Bulk Items</DialogTitle>
                <DialogDescription>
                  Upload multiple pricing items at once using a CSV file
                </DialogDescription>
              </DialogHeader>

              {uploadSuccess ? (
                <div className="py-6">
                  <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <AlertTitle className="text-green-600">Success</AlertTitle>
                    <AlertDescription className="text-green-600">
                      {uploadSuccess}
                    </AlertDescription>
                  </Alert>
                  <div className="flex justify-end mt-6">
                    <Button onClick={handleCloseBulkDialog} data-testid="button-bulk-done">
                      Done
                    </Button>
                  </div>
                </div>
              ) : uploadError ? (
                <div className="py-6">
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>{uploadError}</AlertDescription>
                  </Alert>
                  <div className="flex justify-end gap-2 mt-6">
                    <Button variant="outline" onClick={() => {
                      setUploadError(null);
                      setUploadedFile(null);
                    }} data-testid="button-try-again">
                      Try Again
                    </Button>
                    <Button variant="outline" onClick={handleCloseBulkDialog}>
                      Close
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-6 py-4">
                  <div className="space-y-4">
                    <div className="flex items-start gap-3">
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground text-sm font-medium shrink-0">
                        1
                      </div>
                      <div className="space-y-2 flex-1">
                        <h4 className="font-medium">Download CSV Template</h4>
                        <p className="text-sm text-muted-foreground">
                          Download the template file to ensure your data matches the required format.
                        </p>
                        <button 
                          onClick={handleDownloadTemplate}
                          className="text-primary hover:underline text-sm font-medium flex items-center gap-1"
                          data-testid="link-download-csv"
                        >
                          <Download className="h-4 w-4" />
                          Download CSV
                        </button>
                      </div>
                    </div>

                    <div className="flex items-start gap-3">
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground text-sm font-medium shrink-0">
                        2
                      </div>
                      <div className="space-y-2 flex-1">
                        <h4 className="font-medium">Fill Out the CSV File</h4>
                        <p className="text-sm text-muted-foreground">
                          Open the downloaded file in Excel or Google Sheets and fill in your item details.
                          For multiple categories, separate values with a comma.
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-3">
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground text-sm font-medium shrink-0">
                        3
                      </div>
                      <div className="space-y-2 flex-1">
                        <h4 className="font-medium">Upload CSV File</h4>
                        <div 
                          className="border-2 border-dashed rounded-lg p-6 text-center hover-elevate cursor-pointer"
                          onDragOver={handleDragOver}
                          onDrop={handleDrop}
                          onClick={() => document.getElementById('bulk-file-input')?.click()}
                        >
                          <FileSpreadsheet className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
                          <p className="text-sm text-muted-foreground mb-3">
                            Drag and drop your CSV file here, or click to browse
                          </p>
                          <input
                            type="file"
                            accept=".csv"
                            onChange={handleFileSelect}
                            className="hidden"
                            id="bulk-file-input"
                            data-testid="input-bulk-file"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            onClick={(e) => {
                              e.stopPropagation();
                              document.getElementById('bulk-file-input')?.click();
                            }}
                            data-testid="button-select-csv"
                          >
                            Select CSV File
                          </Button>
                          {uploadedFile && (
                            <p className="text-sm text-primary mt-3 font-medium">
                              Selected: {uploadedFile.name}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    {activeEnrollments.length > 0 && (
                      <div className="flex items-start gap-3">
                        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground text-sm font-medium shrink-0">
                          4
                        </div>
                        <div className="space-y-2 flex-1">
                          <h4 className="font-medium">Select Clients (Optional)</h4>
                          <p className="text-sm text-muted-foreground">
                            Choose specific clients or leave empty to submit to all enrolled clients.
                          </p>
                          <div className="space-y-2 max-h-32 overflow-y-auto border rounded-md p-2">
                            {activeEnrollments.map(enrollment => (
                              <label 
                                key={enrollment.id} 
                                className="flex items-center gap-2 p-2 rounded hover-elevate cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  checked={bulkSelectedClients.includes(enrollment.contractorOrgId)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setBulkSelectedClients([...bulkSelectedClients, enrollment.contractorOrgId]);
                                    } else {
                                      setBulkSelectedClients(bulkSelectedClients.filter(id => id !== enrollment.contractorOrgId));
                                    }
                                  }}
                                  className="rounded"
                                  data-testid={`checkbox-bulk-client-${enrollment.contractorOrgId}`}
                                />
                                <span className="text-sm">{enrollment.contractorOrgName}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <DialogFooter>
                    <Button variant="outline" onClick={handleCloseBulkDialog}>
                      Cancel
                    </Button>
                    <Button 
                      onClick={handleBulkUpload}
                      disabled={!uploadedFile || bulkUploadMutation.isPending}
                      data-testid="button-upload-csv"
                    >
                      {bulkUploadMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Uploading...
                        </>
                      ) : (
                        <>
                          <Upload className="h-4 w-4 mr-2" />
                          Upload
                        </>
                      )}
                    </Button>
                  </DialogFooter>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-col md:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search items..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                  data-testid="input-search-pricing"
                />
              </div>
              <div className="flex gap-2">
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger className="w-[180px]" data-testid="select-filter-category">
                    <Filter className="h-4 w-4 mr-2" />
                    <SelectValue placeholder="Category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    {CATEGORIES.map(cat => (
                      <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[150px]" data-testid="select-filter-status">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="AUTO_APPROVED">Approved</SelectItem>
                    <SelectItem value="PENDING_REVIEW">Pending</SelectItem>
                    <SelectItem value="REJECTED">Rejected</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4, 5].map(i => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : filteredItems.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead>Code</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Submitted</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredItems.map(item => (
                      <TableRow key={item.id} data-testid={`row-pricing-${item.id}`}>
                        <TableCell className="font-medium">{item.itemName}</TableCell>
                        <TableCell className="text-muted-foreground">{item.itemCode || "-"}</TableCell>
                        <TableCell>{item.category || "-"}</TableCell>
                        <TableCell>{item.unit}</TableCell>
                        <TableCell className="text-right font-medium">
                          ${parseFloat(item.unitPrice).toFixed(2)}
                        </TableCell>
                        <TableCell>{getStatusBadge(item.approvalStatus)}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {new Date(item.createdAt).toLocaleDateString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="text-lg font-medium">No pricing items found</p>
                <p className="text-sm">
                  {pricingItems?.length === 0 
                    ? "Add your first pricing item to get started"
                    : "Try adjusting your search or filters"}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
