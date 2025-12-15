import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { 
  Loader2, 
  CheckCircle2, 
  XCircle,
  Upload,
  FileText,
  RefreshCw,
  Search,
  Sparkles,
  Clock,
  AlertTriangle,
  Check,
  X
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { format, parseISO } from "date-fns";

interface ExtractedItem {
  id: string;
  sku: string;
  name: string;
  description?: string;
  category: string;
  unitPrice: number;
  uom: string;
  confidence: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
}

interface ImportJob {
  id: string;
  vendorName: string;
  fileName: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  itemCount: number;
  approvedCount: number;
  rejectedCount: number;
  createdAt: string;
  completedAt?: string;
  error?: string;
}

export function VendorPricebookUpload() {
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState<string | null>(null);
  const [vendorName, setVendorName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  
  const { toast } = useToast();

  const { data: jobs = [], isLoading: jobsLoading, refetch: refetchJobs } = useQuery<ImportJob[]>({
    queryKey: ['/api/vendor/pricebook-imports'],
  });

  const { data: jobDetails, isLoading: detailsLoading } = useQuery<{ job: ImportJob; items: ExtractedItem[] }>({
    queryKey: ['/api/vendor/pricebook-imports', selectedJob],
    enabled: !!selectedJob,
  });

  const uploadMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const response = await fetch("/api/vendor/pricebook-imports", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Upload failed");
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/vendor/pricebook-imports'] });
      setUploadDialogOpen(false);
      setVendorName("");
      setSelectedJob(data.job?.id);
      toast({
        title: "PDF Uploaded",
        description: "Processing will begin shortly. Click 'Extract with AI' to start.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Upload Failed",
        description: error.message || "Failed to upload file",
        variant: "destructive",
      });
    },
  });

  const processMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const response = await apiRequest("POST", `/api/vendor/pricebook-imports/${jobId}/process`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/vendor/pricebook-imports'] });
      toast({
        title: "Extraction Started",
        description: "AI is extracting pricing data from the PDF.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Processing Failed",
        description: error.message || "Failed to process file",
        variant: "destructive",
      });
    },
  });

  const approveMutation = useMutation({
    mutationFn: async ({ jobId, itemId, action }: { jobId: string; itemId: string; action: 'approve' | 'reject' }) => {
      const response = await apiRequest("POST", `/api/vendor/pricebook-imports/${jobId}/items/${itemId}/${action}`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/vendor/pricebook-imports', selectedJob] });
    },
  });

  const bulkApproveMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const response = await apiRequest("POST", `/api/vendor/pricebook-imports/${jobId}/approve-all`);
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/vendor/pricebook-imports'] });
      queryClient.invalidateQueries({ queryKey: ['/api/vendor/pricebook-imports', selectedJob] });
      toast({
        title: "Items Approved",
        description: `${data.approvedCount} items have been approved and added to the pricebook.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Approval Failed",
        description: error.message || "Failed to approve items",
        variant: "destructive",
      });
    },
  });

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!vendorName.trim()) {
      toast({
        title: "Vendor Name Required",
        description: "Please enter the vendor name before uploading.",
        variant: "destructive",
      });
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("vendorName", vendorName);
    uploadMutation.mutate(formData);
  };

  const items = jobDetails?.items || [];
  const filteredItems = items.filter(item => 
    item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const pendingItems = items.filter(i => i.status === 'PENDING');
  const activeJob = jobs.find(j => j.id === selectedJob);

  const getStatusBadge = (status: ImportJob['status']) => {
    switch (status) {
      case 'PENDING':
        return <Badge variant="outline"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
      case 'PROCESSING':
        return <Badge variant="secondary"><Loader2 className="w-3 h-3 mr-1 animate-spin" />Processing</Badge>;
      case 'COMPLETED':
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"><CheckCircle2 className="w-3 h-3 mr-1" />Completed</Badge>;
      case 'FAILED':
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Failed</Badge>;
    }
  };

  const getConfidenceBadge = (confidence: number) => {
    if (confidence >= 0.9) return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">{Math.round(confidence * 100)}%</Badge>;
    if (confidence >= 0.7) return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300">{Math.round(confidence * 100)}%</Badge>;
    return <Badge variant="destructive">{Math.round(confidence * 100)}%</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">AI Pricebook Import</h2>
          <p className="text-muted-foreground">
            Upload vendor price lists and extract pricing with AI
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => refetchJobs()} data-testid="button-refresh-jobs">
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-upload-pdf">
                <Upload className="w-4 h-4 mr-2" />
                Upload PDF
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Upload Vendor Price List</DialogTitle>
                <DialogDescription>
                  Upload a PDF price list and let AI extract the pricing data
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div>
                  <Label htmlFor="vendorName">Vendor Name</Label>
                  <Input
                    id="vendorName"
                    placeholder="e.g., ABC Supply Co."
                    value={vendorName}
                    onChange={(e) => setVendorName(e.target.value)}
                    data-testid="input-vendor-name"
                  />
                </div>
                <div className="border-2 border-dashed rounded-lg p-8 text-center">
                  <Sparkles className="w-12 h-12 mx-auto text-primary mb-4" />
                  <p className="text-sm text-muted-foreground mb-4">
                    Upload a PDF and AI will extract product names, SKUs, prices, and units
                  </p>
                  <Input
                    type="file"
                    accept=".pdf"
                    onChange={handleFileUpload}
                    disabled={uploadMutation.isPending || !vendorName.trim()}
                    className="max-w-xs mx-auto"
                    data-testid="input-file-upload"
                  />
                  <p className="text-xs text-muted-foreground mt-4">
                    Supported format: PDF
                  </p>
                </div>
                {uploadMutation.isPending && (
                  <div className="flex items-center justify-center gap-2 text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Uploading...</span>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setUploadDialogOpen(false)}>
                  Cancel
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-lg">Import Jobs</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[500px]">
              <div className="space-y-2">
                {jobsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : jobs.length === 0 ? (
                  <div className="text-center py-8">
                    <FileText className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                    <p className="text-sm text-muted-foreground">No import jobs yet</p>
                    <p className="text-xs text-muted-foreground">Upload a PDF to get started</p>
                  </div>
                ) : (
                  jobs.map(job => (
                    <div
                      key={job.id}
                      className={cn(
                        "p-3 rounded-lg border cursor-pointer transition-colors",
                        selectedJob === job.id 
                          ? "bg-primary/10 border-primary" 
                          : "hover-elevate"
                      )}
                      onClick={() => setSelectedJob(job.id)}
                      data-testid={`job-${job.id}`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <p className="font-medium text-sm truncate">{job.vendorName}</p>
                        {getStatusBadge(job.status)}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {job.fileName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {format(parseISO(job.createdAt), "MMM d, h:mm a")}
                      </p>
                      {job.status === 'COMPLETED' && (
                        <div className="flex gap-2 mt-1 text-xs">
                          <span className="text-green-600">{job.approvedCount} approved</span>
                          {job.rejectedCount > 0 && (
                            <span className="text-red-600">{job.rejectedCount} rejected</span>
                          )}
                        </div>
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
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <CardTitle className="text-lg">
                  {activeJob ? activeJob.vendorName : "Select an Import Job"}
                </CardTitle>
                {activeJob && (
                  <CardDescription>
                    {activeJob.fileName} - {items.length} items extracted
                  </CardDescription>
                )}
              </div>
              {activeJob && (
                <div className="flex gap-2">
                  {activeJob.status === 'PENDING' && (
                    <Button 
                      onClick={() => processMutation.mutate(activeJob.id)}
                      disabled={processMutation.isPending}
                      data-testid="button-extract-ai"
                    >
                      {processMutation.isPending ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Sparkles className="w-4 h-4 mr-2" />
                      )}
                      Extract with AI
                    </Button>
                  )}
                  {activeJob.status === 'COMPLETED' && pendingItems.length > 0 && (
                    <Button 
                      onClick={() => bulkApproveMutation.mutate(activeJob.id)}
                      disabled={bulkApproveMutation.isPending}
                      data-testid="button-approve-all"
                    >
                      {bulkApproveMutation.isPending ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4 mr-2" />
                      )}
                      Approve All ({pendingItems.length})
                    </Button>
                  )}
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {!selectedJob ? (
              <div className="text-center py-12">
                <FileText className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">Select an Import Job</h3>
                <p className="text-muted-foreground">
                  Choose a job from the list to view and review extracted items
                </p>
              </div>
            ) : detailsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            ) : activeJob?.status === 'PENDING' ? (
              <div className="text-center py-12">
                <Clock className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">Ready for Processing</h3>
                <p className="text-muted-foreground mb-4">
                  Click "Extract with AI" to start extracting pricing data from the PDF
                </p>
              </div>
            ) : activeJob?.status === 'PROCESSING' ? (
              <div className="text-center py-12">
                <Loader2 className="w-16 h-16 mx-auto text-primary animate-spin mb-4" />
                <h3 className="text-lg font-semibold mb-2">AI Extraction in Progress</h3>
                <p className="text-muted-foreground mb-4">
                  This may take a minute depending on the PDF size
                </p>
                <Progress value={33} className="w-64 mx-auto" />
              </div>
            ) : activeJob?.status === 'FAILED' ? (
              <div className="text-center py-12">
                <AlertTriangle className="w-16 h-16 mx-auto text-destructive mb-4" />
                <h3 className="text-lg font-semibold mb-2">Extraction Failed</h3>
                <p className="text-muted-foreground mb-4">
                  {activeJob.error || "An error occurred during extraction"}
                </p>
                <Button variant="outline" onClick={() => processMutation.mutate(activeJob.id)}>
                  Try Again
                </Button>
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

                <ScrollArea className="h-[400px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>SKU</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                        <TableHead>UOM</TableHead>
                        <TableHead>Confidence</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="w-[100px]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredItems.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center py-8">
                            <p className="text-muted-foreground">
                              {searchQuery ? "No items match your search" : "No items extracted"}
                            </p>
                          </TableCell>
                        </TableRow>
                      ) : (
                        filteredItems.map(item => (
                          <TableRow key={item.id} data-testid={`row-item-${item.id}`}>
                            <TableCell className="font-mono text-sm">{item.sku}</TableCell>
                            <TableCell className="font-medium max-w-[200px] truncate">{item.name}</TableCell>
                            <TableCell>
                              <Badge variant="outline">{item.category}</Badge>
                            </TableCell>
                            <TableCell className="text-right font-medium">
                              ${item.unitPrice.toFixed(2)}
                            </TableCell>
                            <TableCell>{item.uom}</TableCell>
                            <TableCell>{getConfidenceBadge(item.confidence)}</TableCell>
                            <TableCell>
                              {item.status === 'APPROVED' && (
                                <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">Approved</Badge>
                              )}
                              {item.status === 'REJECTED' && (
                                <Badge variant="destructive">Rejected</Badge>
                              )}
                              {item.status === 'PENDING' && (
                                <Badge variant="outline">Pending</Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              {item.status === 'PENDING' && (
                                <div className="flex gap-1">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => approveMutation.mutate({ jobId: activeJob!.id, itemId: item.id, action: 'approve' })}
                                    disabled={approveMutation.isPending}
                                    data-testid={`button-approve-${item.id}`}
                                  >
                                    <Check className="w-4 h-4 text-green-600" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => approveMutation.mutate({ jobId: activeJob!.id, itemId: item.id, action: 'reject' })}
                                    disabled={approveMutation.isPending}
                                    data-testid={`button-reject-${item.id}`}
                                  >
                                    <X className="w-4 h-4 text-red-600" />
                                  </Button>
                                </div>
                              )}
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
    </div>
  );
}

export default VendorPricebookUpload;
