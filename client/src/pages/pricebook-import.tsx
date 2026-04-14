import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Upload, FileText, Clock, CheckCircle2, XCircle, AlertCircle,
  Play, Eye, Check, X, FileSpreadsheet, Building2, DollarSign
} from "lucide-react";
import { format } from "date-fns";

interface ImportJob {
  id: string;
  crmOrganisationId: string;
  vendorName: string | null;
  fileName: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  itemsExtracted: number | null;
  itemsApproved: number | null;
  errorMessage: string | null;
  effectiveQuarter: string | null;
  effectiveDate: string | null;
  processedAt: string | null;
  createdAt: string;
  createdBy: { id: string; firstName: string; lastName: string } | null;
}

interface ExtractedItem {
  id: string;
  itemName: string;
  itemCode: string | null;
  category: string;
  description: string | null;
  unit: string;
  unitPrice: string;
  minimumOrder: string | null;
  deliveryFee: string | null;
  approvalStatus: "PENDING_REVIEW" | "APPROVED" | "REJECTED";
}

interface CRMEntity {
  id: string;
  name: string;
  type: string;
}

export default function PricebookImportPage() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [showJobDetailDialog, setShowJobDetailDialog] = useState(false);
  const [selectedJob, setSelectedJob] = useState<ImportJob | null>(null);
  const [selectedVendor, setSelectedVendor] = useState<string>("");
  const [effectiveQuarter, setEffectiveQuarter] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: jobsData, isLoading } = useQuery<{ jobs: ImportJob[]; pagination: { total: number } }>({
    queryKey: ["/api/vendor/pricebook-imports", statusFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      const queryString = params.toString();
      return fetch(`/api/vendor/pricebook-imports${queryString ? `?${queryString}` : ""}`, { credentials: "include" }).then(r => r.json());
    },
  });

  const { data: jobDetail, isLoading: isLoadingDetail } = useQuery<{ job: ImportJob; extractedItems: ExtractedItem[] }>({
    queryKey: ["/api/vendor/pricebook-imports", selectedJob?.id],
    enabled: !!selectedJob && showJobDetailDialog,
    queryFn: () => fetch(`/api/vendor/pricebook-imports/${selectedJob!.id}`, { credentials: "include" }).then(r => r.json()),
  });

  const { data: vendors } = useQuery<CRMEntity[]>({
    queryKey: ["/api/crm"],
    queryFn: () => fetch("/api/crm", { credentials: "include" }).then(r => r.json()),
  });

  const supplierVendors = vendors?.filter(v => ["SUPPLIER", "VENDOR"].includes(v.type)) || [];

  const uploadMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const response = await fetch("/api/vendor/pricebook-imports", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!response.ok) throw new Error("Upload failed");
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/vendor/pricebook-imports"] });
      toast({ title: "Pricebook uploaded", description: "AI extraction will begin shortly." });
      setShowUploadDialog(false);
      setSelectedVendor("");
      setEffectiveQuarter("");
    },
    onError: () => {
      toast({ title: "Upload failed", variant: "destructive" });
    },
  });

  const processMutation = useMutation({
    mutationFn: (jobId: string) => apiRequest("POST", `/api/vendor/pricebook-imports/${jobId}/process`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vendor/pricebook-imports"] });
      toast({ title: "AI extraction started" });
    },
    onError: () => {
      toast({ title: "Failed to start extraction", variant: "destructive" });
    },
  });

  const approveItemMutation = useMutation({
    mutationFn: ({ jobId, itemId }: { jobId: string; itemId: string }) => 
      apiRequest("POST", `/api/vendor/pricebook-imports/${jobId}/items/${itemId}/approve`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vendor/pricebook-imports", selectedJob?.id] });
      toast({ title: "Item approved" });
    },
    onError: () => {
      toast({ title: "Failed to approve item", variant: "destructive" });
    },
  });

  const rejectItemMutation = useMutation({
    mutationFn: ({ jobId, itemId }: { jobId: string; itemId: string }) => 
      apiRequest("POST", `/api/vendor/pricebook-imports/${jobId}/items/${itemId}/reject`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vendor/pricebook-imports", selectedJob?.id] });
      toast({ title: "Item rejected" });
    },
    onError: () => {
      toast({ title: "Failed to reject item", variant: "destructive" });
    },
  });

  const approveAllMutation = useMutation({
    mutationFn: (jobId: string) => apiRequest("POST", `/api/vendor/pricebook-imports/${jobId}/approve-all`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vendor/pricebook-imports", selectedJob?.id] });
      toast({ title: "All items approved" });
    },
    onError: () => {
      toast({ title: "Failed to approve all items", variant: "destructive" });
    },
  });

  const handleUpload = () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file || !selectedVendor) {
      toast({ title: "Please select a vendor and file", variant: "destructive" });
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("crmOrganisationId", selectedVendor);
    if (effectiveQuarter) formData.append("effectiveQuarter", effectiveQuarter);
    
    uploadMutation.mutate(formData);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "PENDING":
        return <Badge variant="outline" className="gap-1"><Clock className="h-3 w-3" /> Pending</Badge>;
      case "PROCESSING":
        return <Badge variant="secondary" className="gap-1"><AlertCircle className="h-3 w-3" /> Processing</Badge>;
      case "COMPLETED":
        return <Badge className="gap-1 bg-green-500"><CheckCircle2 className="h-3 w-3" /> Completed</Badge>;
      case "FAILED":
        return <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> Failed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getCurrentQuarter = () => {
    const now = new Date();
    const year = now.getFullYear();
    const quarter = Math.ceil((now.getMonth() + 1) / 3);
    return `${year}-Q${quarter}`;
  };

  return (
    <div className="container py-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Pricebook Import</h1>
          <p className="text-muted-foreground">Upload vendor price lists and extract pricing with AI</p>
        </div>
        <Button onClick={() => setShowUploadDialog(true)} data-testid="button-upload-pricebook">
          <Upload className="mr-2 h-4 w-4" />
          Upload Pricebook
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]" data-testid="select-status-filter">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Statuses</SelectItem>
            <SelectItem value="PENDING">Pending</SelectItem>
            <SelectItem value="PROCESSING">Processing</SelectItem>
            <SelectItem value="COMPLETED">Completed</SelectItem>
            <SelectItem value="FAILED">Failed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-20 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : !jobsData?.jobs?.length ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileSpreadsheet className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No Pricebook Imports Yet</h3>
            <p className="text-muted-foreground mb-4">
              Upload a vendor pricebook PDF to automatically extract pricing items using AI.
            </p>
            <Button onClick={() => setShowUploadDialog(true)} data-testid="button-upload-first">
              <Upload className="mr-2 h-4 w-4" />
              Upload Your First Pricebook
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {jobsData.jobs.map((job) => (
            <Card key={job.id} className="hover-elevate">
              <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
                <div className="flex-1 min-w-0">
                  <CardTitle className="text-base truncate" data-testid={`text-job-vendor-${job.id}`}>
                    {job.vendorName || "Unknown Vendor"}
                  </CardTitle>
                  <CardDescription className="truncate">
                    <FileText className="inline h-3 w-3 mr-1" />
                    {job.fileName}
                  </CardDescription>
                </div>
                {getStatusBadge(job.status)}
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    {job.effectiveQuarter || "N/A"}
                  </div>
                  {job.itemsExtracted !== null && (
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <FileSpreadsheet className="h-4 w-4" />
                      {job.itemsExtracted} items
                    </div>
                  )}
                </div>

                {job.status === "COMPLETED" && job.itemsExtracted !== null && (
                  <div className="flex items-center gap-2 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    <span>{job.itemsApproved || 0} / {job.itemsExtracted} approved</span>
                  </div>
                )}

                {job.errorMessage && (
                  <p className="text-sm text-destructive truncate">{job.errorMessage}</p>
                )}

                <div className="flex items-center gap-2 pt-2">
                  {job.status === "PENDING" && (
                    <Button 
                      size="sm" 
                      onClick={() => processMutation.mutate(job.id)}
                      disabled={processMutation.isPending}
                      data-testid={`button-process-${job.id}`}
                    >
                      <Play className="h-4 w-4 mr-1" />
                      Extract
                    </Button>
                  )}
                  {job.status === "COMPLETED" && (
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={() => {
                        setSelectedJob(job);
                        setShowJobDetailDialog(true);
                      }}
                      data-testid={`button-view-${job.id}`}
                    >
                      <Eye className="h-4 w-4 mr-1" />
                      Review Items
                    </Button>
                  )}
                </div>

                <p className="text-xs text-muted-foreground">
                  Uploaded {format(new Date(job.createdAt), "MMM d, yyyy 'at' h:mm a")}
                  {job.createdBy && ` by ${job.createdBy.firstName} ${job.createdBy.lastName}`}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Upload Vendor Pricebook</DialogTitle>
            <DialogDescription>
              Upload a PDF pricebook and our AI will extract all pricing items automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="vendor">Vendor</Label>
              <Select value={selectedVendor} onValueChange={setSelectedVendor}>
                <SelectTrigger data-testid="select-upload-vendor">
                  <SelectValue placeholder="Select a vendor" />
                </SelectTrigger>
                <SelectContent>
                  {supplierVendors.map((vendor) => (
                    <SelectItem key={vendor.id} value={vendor.id}>
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4" />
                        {vendor.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="quarter">Effective Quarter (optional)</Label>
              <Input 
                id="quarter"
                placeholder={getCurrentQuarter()}
                value={effectiveQuarter}
                onChange={(e) => setEffectiveQuarter(e.target.value)}
                data-testid="input-effective-quarter"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="file">PDF File</Label>
              <Input 
                id="file"
                type="file"
                accept=".pdf"
                ref={fileInputRef}
                data-testid="input-file"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUploadDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleUpload}
              disabled={uploadMutation.isPending || !selectedVendor}
              data-testid="button-submit-upload"
            >
              {uploadMutation.isPending ? "Uploading..." : "Upload Pricebook"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showJobDetailDialog} onOpenChange={setShowJobDetailDialog}>
        <DialogContent className="sm:max-w-4xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              Review Extracted Items
            </DialogTitle>
            <DialogDescription>
              {selectedJob?.vendorName} - {selectedJob?.fileName}
            </DialogDescription>
          </DialogHeader>
          
          {isLoadingDetail ? (
            <div className="space-y-4 py-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : jobDetail?.extractedItems?.length ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                  {jobDetail.extractedItems.filter(i => i.approvalStatus === "APPROVED").length} / {jobDetail.extractedItems.length} items approved
                </div>
                <Button 
                  size="sm"
                  onClick={() => approveAllMutation.mutate(selectedJob!.id)}
                  disabled={approveAllMutation.isPending || jobDetail.extractedItems.every(i => i.approvalStatus === "APPROVED")}
                  data-testid="button-approve-all"
                >
                  <Check className="h-4 w-4 mr-1" />
                  Approve All Pending
                </Button>
              </div>
              
              <ScrollArea className="h-[400px] rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {jobDetail.extractedItems.map((item) => (
                      <TableRow key={item.id} data-testid={`row-item-${item.id}`}>
                        <TableCell>
                          <div className="font-medium">{item.itemName}</div>
                          {item.itemCode && <div className="text-xs text-muted-foreground">{item.itemCode}</div>}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {item.category}
                          </Badge>
                        </TableCell>
                        <TableCell>{item.unit}</TableCell>
                        <TableCell className="text-right font-medium">
                          <div className="flex items-center justify-end gap-1">
                            <DollarSign className="h-3 w-3" />
                            {parseFloat(item.unitPrice).toFixed(2)}
                          </div>
                        </TableCell>
                        <TableCell>
                          {item.approvalStatus === "APPROVED" && (
                            <Badge className="bg-green-500 gap-1"><CheckCircle2 className="h-3 w-3" />Approved</Badge>
                          )}
                          {item.approvalStatus === "REJECTED" && (
                            <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" />Rejected</Badge>
                          )}
                          {item.approvalStatus === "PENDING_REVIEW" && (
                            <Badge variant="outline" className="gap-1"><Clock className="h-3 w-3" />Pending</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {item.approvalStatus === "PENDING_REVIEW" && (
                            <div className="flex items-center justify-end gap-1">
                              <Button 
                                size="icon" 
                                variant="ghost"
                                className="h-8 w-8 text-green-500"
                                onClick={() => approveItemMutation.mutate({ jobId: selectedJob!.id, itemId: item.id })}
                                disabled={approveItemMutation.isPending}
                                data-testid={`button-approve-item-${item.id}`}
                              >
                                <Check className="h-4 w-4" />
                              </Button>
                              <Button 
                                size="icon" 
                                variant="ghost"
                                className="h-8 w-8 text-destructive"
                                onClick={() => rejectItemMutation.mutate({ jobId: selectedJob!.id, itemId: item.id })}
                                disabled={rejectItemMutation.isPending}
                                data-testid={`button-reject-item-${item.id}`}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </div>
          ) : (
            <div className="py-8 text-center text-muted-foreground">
              No items found for this import job.
            </div>
          )}
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowJobDetailDialog(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
