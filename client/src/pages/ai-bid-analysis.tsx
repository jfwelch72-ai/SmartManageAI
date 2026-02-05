import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ObjectUploader } from "@/components/ObjectUploader";
import { useToast } from "@/hooks/use-toast";
import { 
  FileSearch, 
  Upload, 
  Sparkles, 
  Clock, 
  CheckCircle2,
  AlertTriangle,
  FileText,
  Eye,
  Calendar,
  DollarSign,
  Target,
  Loader2,
  RefreshCw,
  Trash2,
  Archive,
  RotateCcw
} from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { format, formatDistanceToNow } from "date-fns";

interface BidForAnalysis {
  id: string;
  code: string;
  name: string;
  clientName: string;
  status: string;
  dueDate: string | null;
}

interface BidDocumentAnalysis {
  id: string;
  bidId: string;
  bidCode: string;
  bidName: string;
  fileName: string;
  fileUrl: string;
  analysisStatus: string;
  analysisResult: any;
  createdAt: string;
  analyzedAt: string | null;
  analyzedByName: string | null;
  isArchived: boolean;
  archivedAt: string | null;
}

export default function AIBidAnalysisPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("new");
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [selectedBidId, setSelectedBidId] = useState<string>("");
  const [showResultDialog, setShowResultDialog] = useState(false);
  const [selectedAnalysis, setSelectedAnalysis] = useState<BidDocumentAnalysis | null>(null);

  const { data: bids = [], isLoading: loadingBids } = useQuery<BidForAnalysis[]>({
    queryKey: ["/api/ai-bid-document/bids"],
    enabled: !!user && ["SUPER_ADMIN", "ADMIN", "MANAGER", "ESTIMATOR"].includes(user.role)
  });

  const { data: analyses = [], isLoading: loadingAnalyses } = useQuery<BidDocumentAnalysis[]>({
    queryKey: ["/api/ai-bid-document"],
    enabled: !!user && ["SUPER_ADMIN", "ADMIN", "MANAGER", "ESTIMATOR"].includes(user.role)
  });

  const analyzeMutation = useMutation({
    mutationFn: async (data: { bidId: string; fileUrl: string; fileName: string }) => {
      return await apiRequest("POST", "/api/ai-bid-document/analyze", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-bid-document"] });
      toast({ title: "Analysis started", description: "AI is reviewing your bid document. This may take a moment." });
      setShowUploadDialog(false);
      setSelectedBidId("");
    },
    onError: (error: any) => {
      toast({ 
        title: "Analysis failed", 
        description: error.message || "Failed to analyze document", 
        variant: "destructive" 
      });
    }
  });

  const reanalyzeMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("POST", `/api/ai-bid-document/${id}/reanalyze`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-bid-document"] });
      toast({ title: "Re-analysis started", description: "AI is reviewing the document again." });
    },
    onError: (error: any) => {
      toast({ 
        title: "Re-analysis failed", 
        description: error.message || "Failed to re-analyze document", 
        variant: "destructive" 
      });
    }
  });

  // Query for archived analyses
  const { data: archivedAnalyses = [], isLoading: loadingArchived } = useQuery<BidDocumentAnalysis[]>({
    queryKey: ["/api/ai-bid-document?archived=true"],
    enabled: !!user && ["SUPER_ADMIN", "ADMIN", "MANAGER", "ESTIMATOR"].includes(user.role)
  });

  // Archive (soft delete) mutation
  const archiveMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("PATCH", `/api/ai-bid-document/${id}/archive`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-bid-document"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai-bid-document?archived=true"] });
      toast({ title: "Analysis archived", description: "The analysis has been moved to the archived tab." });
    },
    onError: (error: any) => {
      toast({ 
        title: "Archive failed", 
        description: error.message || "Failed to archive analysis", 
        variant: "destructive" 
      });
    }
  });

  // Restore from archive mutation
  const restoreMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("PATCH", `/api/ai-bid-document/${id}/restore`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-bid-document"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai-bid-document?archived=true"] });
      toast({ title: "Analysis restored", description: "The analysis has been restored from the archive." });
    },
    onError: (error: any) => {
      toast({ 
        title: "Restore failed", 
        description: error.message || "Failed to restore analysis", 
        variant: "destructive" 
      });
    }
  });

  // Permanent delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/ai-bid-document/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-bid-document"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai-bid-document?archived=true"] });
      toast({ title: "Analysis deleted", description: "The analysis has been permanently deleted." });
    },
    onError: (error: any) => {
      toast({ 
        title: "Delete failed", 
        description: error.message || "Failed to delete analysis", 
        variant: "destructive" 
      });
    }
  });

  const onGetUploadParameters = async () => {
    try {
      const response = await apiRequest("POST", "/api/objects/upload");
      const data = await response.json();
      return {
        method: "PUT" as const,
        url: data.uploadURL,
      };
    } catch (error) {
      toast({ title: "Error", description: "Failed to get upload URL", variant: "destructive" });
      throw error;
    }
  };

  const handleUploadComplete = async (result: any) => {
    if (!result.successful || result.successful.length === 0) {
      toast({ title: "Error", description: "Upload failed", variant: "destructive" });
      return;
    }

    const uploadedFile = result.successful[0];
    const fileUrl = uploadedFile.uploadURL?.split('?')[0] || "";

    if (!selectedBidId) {
      toast({ title: "Error", description: "Please select a bid first", variant: "destructive" });
      return;
    }

    analyzeMutation.mutate({
      bidId: selectedBidId,
      fileUrl: fileUrl,
      fileName: uploadedFile.name
    });
  };

  const openResultDialog = (analysis: BidDocumentAnalysis) => {
    setSelectedAnalysis(analysis);
    setShowResultDialog(true);
  };

  const handleCreateClick = () => setShowUploadDialog(true);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "COMPLETED":
        return <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"><CheckCircle2 className="h-3 w-3 mr-1" />Completed</Badge>;
      case "PROCESSING":
        return <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Processing</Badge>;
      case "FAILED":
        return <Badge variant="destructive"><AlertTriangle className="h-3 w-3 mr-1" />Failed</Badge>;
      default:
        return <Badge variant="outline"><Clock className="h-3 w-3 mr-1" />Pending</Badge>;
    }
  };

  const pendingAnalyses = analyses.filter(a => a.analysisStatus === "PENDING" || a.analysisStatus === "PROCESSING");
  const completedAnalyses = analyses.filter(a => a.analysisStatus === "COMPLETED");
  const failedAnalyses = analyses.filter(a => a.analysisStatus === "FAILED");

  if (!user) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground">Please log in to access AI Bid Analysis</p>
      </div>
    );
  }

  if (!["SUPER_ADMIN", "ADMIN", "MANAGER", "ESTIMATOR"].includes(user.role)) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground">You don't have access to AI Bid Analysis</p>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <FileSearch className="h-8 w-8 text-primary" />
            AI Bid Document Analysis
          </h1>
          <p className="text-muted-foreground mt-1">
            Upload bid invitations, RFPs, and scope documents for AI-powered analysis
          </p>
        </div>
        <Button onClick={() => setShowUploadDialog(true)} data-testid="button-new-analysis">
          <Upload className="h-4 w-4 mr-2" />
          Analyze New Document
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              Total Analyses
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{analyses.length}</div>
            <p className="text-xs text-muted-foreground">Documents analyzed</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4" />
              In Progress
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pendingAnalyses.length}</div>
            <p className="text-xs text-muted-foreground">Currently processing</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              Completed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{completedAnalyses.length}</div>
            <p className="text-xs text-muted-foreground">Ready for review</p>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList data-testid="tabs-bid-analysis">
          <TabsTrigger value="new" data-testid="tab-bid-recent">
            <Sparkles className="h-4 w-4 mr-2" />
            Recent
          </TabsTrigger>
          <TabsTrigger value="completed" data-testid="tab-bid-completed">
            <CheckCircle2 className="h-4 w-4 mr-2" />
            Completed ({completedAnalyses.length})
          </TabsTrigger>
          {failedAnalyses.length > 0 && (
            <TabsTrigger value="failed" data-testid="tab-bid-failed">
              <AlertTriangle className="h-4 w-4 mr-2" />
              Failed ({failedAnalyses.length})
            </TabsTrigger>
          )}
          <TabsTrigger value="archived" data-testid="tab-bid-archived">
            <Archive className="h-4 w-4 mr-2" />
            Archived ({archivedAnalyses.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="new" className="mt-6">
          {loadingAnalyses ? (
            <div className="space-y-4">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-20" />)}
            </div>
          ) : analyses.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <FileSearch className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium">No analyses yet</h3>
                <p className="text-muted-foreground mt-1 mb-4">
                  Upload a bid document to get AI-powered insights
                </p>
                <Button onClick={() => setShowUploadDialog(true)} data-testid="button-first-analysis">
                  <Upload className="h-4 w-4 mr-2" />
                  Analyze Your First Document
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {analyses.slice(0, 10).map(analysis => (
                <Card key={analysis.id} className="hover-elevate">
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <div className="flex items-center gap-4 min-w-0 cursor-pointer" onClick={() => openResultDialog(analysis)}>
                        <div className="p-2 bg-primary/10 rounded-lg">
                          <FileText className="h-5 w-5 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-medium truncate">{analysis.fileName}</h3>
                          <p className="text-sm text-muted-foreground">
                            {analysis.bidCode} - {analysis.bidName}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        {getStatusBadge(analysis.analysisStatus)}
                        <span className="text-sm text-muted-foreground">
                          {formatDistanceToNow(new Date(analysis.createdAt), { addSuffix: true })}
                        </span>
                        <Button size="sm" variant="outline" onClick={() => openResultDialog(analysis)} data-testid={`button-view-${analysis.id}`}>
                          <Eye className="h-4 w-4 mr-1" />
                          View
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="sm" variant="outline" className="text-destructive" data-testid={`button-delete-${analysis.id}`}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Archive this analysis?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will move the analysis to the Archived tab. You can restore it later or permanently delete it from there.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction 
                                onClick={() => archiveMutation.mutate(analysis.id)}
                                className="bg-destructive text-destructive-foreground"
                              >
                                Archive
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="completed" className="mt-6">
          {completedAnalyses.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No completed analyses yet
              </CardContent>
            </Card>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Document</TableHead>
                  <TableHead>Bid</TableHead>
                  <TableHead>Analyzed</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {completedAnalyses.map(analysis => (
                  <TableRow key={analysis.id}>
                    <TableCell className="font-medium">{analysis.fileName}</TableCell>
                    <TableCell>{analysis.bidCode} - {analysis.bidName}</TableCell>
                    <TableCell>
                      {analysis.analyzedAt 
                        ? format(new Date(analysis.analyzedAt), "MMM d, yyyy h:mm a")
                        : "—"
                      }
                    </TableCell>
                    <TableCell className="text-right">
                      <Button 
                        size="sm" 
                        variant="outline" 
                        onClick={() => openResultDialog(analysis)}
                        data-testid={`button-view-result-${analysis.id}`}
                      >
                        <Eye className="h-4 w-4 mr-1" />
                        View Results
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        <TabsContent value="failed" className="mt-6">
          {failedAnalyses.map(analysis => (
            <Card key={analysis.id} className="border-destructive/50">
              <CardContent className="py-4">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-4">
                    <AlertTriangle className="h-5 w-5 text-destructive" />
                    <div>
                      <h3 className="font-medium">{analysis.fileName}</h3>
                      <p className="text-sm text-muted-foreground">
                        {analysis.bidCode} - {analysis.bidName}
                      </p>
                    </div>
                  </div>
                  <Button 
                    size="sm" 
                    variant="outline"
                    onClick={() => reanalyzeMutation.mutate(analysis.id)}
                    disabled={reanalyzeMutation.isPending}
                    data-testid={`button-retry-${analysis.id}`}
                  >
                    <RefreshCw className="h-4 w-4 mr-1" />
                    Retry Analysis
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="archived" className="mt-6">
          {loadingArchived ? (
            <div className="space-y-4">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-20" />)}
            </div>
          ) : archivedAnalyses.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                <Archive className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium">No archived analyses</h3>
                <p className="text-sm">Deleted analyses will appear here</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {archivedAnalyses.map(analysis => (
                <Card key={analysis.id} className="opacity-75">
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <div className="flex items-center gap-4 min-w-0">
                        <div className="p-2 bg-muted rounded-lg">
                          <FileText className="h-5 w-5 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-medium truncate">{analysis.fileName}</h3>
                          <p className="text-sm text-muted-foreground">
                            {analysis.bidCode} - {analysis.bidName}
                          </p>
                          {analysis.archivedAt && (
                            <p className="text-xs text-muted-foreground">
                              Archived {formatDistanceToNow(new Date(analysis.archivedAt), { addSuffix: true })}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Button 
                          size="sm" 
                          variant="outline"
                          onClick={() => restoreMutation.mutate(analysis.id)}
                          disabled={restoreMutation.isPending}
                          data-testid={`button-restore-${analysis.id}`}
                        >
                          <RotateCcw className="h-4 w-4 mr-1" />
                          Restore
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button 
                              size="sm" 
                              variant="destructive"
                              data-testid={`button-permanent-delete-${analysis.id}`}
                            >
                              <Trash2 className="h-4 w-4 mr-1" />
                              Delete Forever
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Permanently delete this analysis?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This action cannot be undone. The analysis and all associated data will be permanently removed from the database.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction 
                                onClick={() => deleteMutation.mutate(analysis.id)}
                                className="bg-destructive text-destructive-foreground"
                              >
                                Delete Permanently
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Analyze Bid Document</DialogTitle>
            <DialogDescription>
              Upload a bid invitation, RFP, or scope document for AI analysis
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Select Bid</label>
              <Select value={selectedBidId} onValueChange={setSelectedBidId}>
                <SelectTrigger data-testid="select-bid">
                  <SelectValue placeholder="Select a bid to analyze..." />
                </SelectTrigger>
                <SelectContent>
                  {bids.map(bid => (
                    <SelectItem key={bid.id} value={bid.id}>
                      {bid.code} - {bid.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedBidId && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Upload Document</label>
                <ObjectUploader
                  onGetUploadParameters={onGetUploadParameters}
                  onComplete={handleUploadComplete}
                  allowedFileTypes={["application/pdf", "image/*"]}
                  maxFileSize={50 * 1024 * 1024}
                >
                  Upload bid invitation, RFP, or scope document (PDF or image, max 50MB)
                </ObjectUploader>
              </div>
            )}

            {analyzeMutation.isPending && (
              <Alert>
                <Loader2 className="h-4 w-4 animate-spin" />
                <AlertDescription>
                  Uploading and analyzing document... This may take a moment.
                </AlertDescription>
              </Alert>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showResultDialog} onOpenChange={setShowResultDialog}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Analysis Results</DialogTitle>
            <DialogDescription>
              {selectedAnalysis?.fileName} - {selectedAnalysis?.bidCode}
            </DialogDescription>
          </DialogHeader>

          {selectedAnalysis?.analysisStatus === "COMPLETED" && selectedAnalysis.analysisResult ? (
            <div className="space-y-6 py-4">
              {selectedAnalysis.analysisResult.summary && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Target className="h-4 w-4" />
                      Summary
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm">{selectedAnalysis.analysisResult.summary}</p>
                  </CardContent>
                </Card>
              )}

              {selectedAnalysis.analysisResult.scopeRequirements?.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      Scope Requirements
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="list-disc list-inside space-y-1 text-sm">
                      {selectedAnalysis.analysisResult.scopeRequirements.map((item: string, i: number) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {selectedAnalysis.analysisResult.deadlines?.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Calendar className="h-4 w-4" />
                      Key Deadlines
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2 text-sm">
                      {selectedAnalysis.analysisResult.deadlines.map((deadline: any, i: number) => (
                        <li key={i} className="flex items-center gap-2">
                          <Clock className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium">{deadline.description}:</span>
                          <span>{deadline.date}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {selectedAnalysis.analysisResult.keyTerms?.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4" />
                      Key Terms & Conditions
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="list-disc list-inside space-y-1 text-sm">
                      {selectedAnalysis.analysisResult.keyTerms.map((term: string, i: number) => (
                        <li key={i}>{term}</li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {selectedAnalysis.analysisResult.budgetInsights && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <DollarSign className="h-4 w-4" />
                      Budget Insights
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm">{selectedAnalysis.analysisResult.budgetInsights}</p>
                  </CardContent>
                </Card>
              )}

              {selectedAnalysis.analysisResult.recommendations?.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Sparkles className="h-4 w-4" />
                      AI Recommendations
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="list-disc list-inside space-y-1 text-sm">
                      {selectedAnalysis.analysisResult.recommendations.map((rec: string, i: number) => (
                        <li key={i}>{rec}</li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}
            </div>
          ) : selectedAnalysis?.analysisStatus === "PROCESSING" ? (
            <div className="py-8 text-center">
              <Loader2 className="h-12 w-12 mx-auto animate-spin text-primary mb-4" />
              <p className="text-muted-foreground">Analysis in progress...</p>
            </div>
          ) : selectedAnalysis?.analysisStatus === "FAILED" ? (
            <div className="py-8 text-center">
              <AlertTriangle className="h-12 w-12 mx-auto text-destructive mb-4" />
              <p className="text-muted-foreground">Analysis failed. Please try again.</p>
              <Button 
                className="mt-4"
                onClick={() => {
                  reanalyzeMutation.mutate(selectedAnalysis.id);
                  setShowResultDialog(false);
                }}
                data-testid="button-retry-dialog"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Retry Analysis
              </Button>
            </div>
          ) : (
            <div className="py-8 text-center text-muted-foreground">
              No analysis results available
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowResultDialog(false)} data-testid="button-close-result-dialog">
              Close
            </Button>
            {selectedAnalysis?.fileUrl && (
              <Button onClick={() => window.open(selectedAnalysis.fileUrl, "_blank")} data-testid="button-view-original-document">
                <Eye className="h-4 w-4 mr-2" />
                View Original Document
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
