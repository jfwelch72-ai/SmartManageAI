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
  FileCheck, 
  Upload, 
  Sparkles, 
  Clock, 
  CheckCircle2,
  AlertTriangle,
  FileText,
  Eye,
  Calendar,
  DollarSign,
  Shield,
  Loader2,
  RefreshCw,
  Scale,
  AlertCircle,
  FileWarning,
  Download
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

interface ProjectForAnalysis {
  id: string;
  code: string;
  name: string;
  clientName: string;
  status: string;
}

interface ContractDocumentAnalysis {
  id: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  fileName: string;
  fileUrl: string;
  documentType: string;
  analysisStatus: string;
  analysisResult: any;
  createdAt: string;
  analyzedAt: string | null;
  analyzedByName: string | null;
}

export default function AIContractAnalysisPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("recent");
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [selectedDocType, setSelectedDocType] = useState<string>("CONTRACT");
  const [showResultDialog, setShowResultDialog] = useState(false);
  const [selectedAnalysis, setSelectedAnalysis] = useState<ContractDocumentAnalysis | null>(null);

  const { data: projects = [], isLoading: loadingProjects } = useQuery<ProjectForAnalysis[]>({
    queryKey: ["/api/ai-contract-document/projects"],
    enabled: !!user && ["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(user.role)
  });

  const { data: analyses = [], isLoading: loadingAnalyses } = useQuery<ContractDocumentAnalysis[]>({
    queryKey: ["/api/ai-contract-document"],
    enabled: !!user && ["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(user.role)
  });

  const analyzeMutation = useMutation({
    mutationFn: async (data: { projectId: string; fileUrl: string; fileName: string; documentType: string }) => {
      return await apiRequest("POST", "/api/ai-contract-document/analyze", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-contract-document"] });
      toast({ title: "Analysis started", description: "AI is reviewing your contract document." });
      setShowUploadDialog(false);
      setSelectedProjectId("");
      setSelectedDocType("CONTRACT");
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
      return await apiRequest("POST", `/api/ai-contract-document/${id}/reanalyze`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-contract-document"] });
      toast({ title: "Re-analysis started" });
    },
    onError: (error: any) => {
      toast({ 
        title: "Re-analysis failed", 
        description: error.message || "Failed to re-analyze document", 
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

    if (!selectedProjectId) {
      toast({ title: "Error", description: "Please select a project first", variant: "destructive" });
      return;
    }

    analyzeMutation.mutate({
      projectId: selectedProjectId,
      fileUrl: fileUrl,
      fileName: uploadedFile.name,
      documentType: selectedDocType
    });
  };

  const openResultDialog = (analysis: ContractDocumentAnalysis) => {
    setSelectedAnalysis(analysis);
    setShowResultDialog(true);
  };

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

  const getDocTypeBadge = (docType: string) => {
    switch (docType) {
      case "CONTRACT":
        return <Badge variant="outline"><FileCheck className="h-3 w-3 mr-1" />Contract</Badge>;
      case "AWARD_LETTER":
        return <Badge variant="outline"><FileText className="h-3 w-3 mr-1" />Award Letter</Badge>;
      case "AMENDMENT":
        return <Badge variant="outline"><FileWarning className="h-3 w-3 mr-1" />Amendment</Badge>;
      default:
        return <Badge variant="outline">{docType}</Badge>;
    }
  };

  const pendingAnalyses = analyses.filter(a => a.analysisStatus === "PENDING" || a.analysisStatus === "PROCESSING");
  const completedAnalyses = analyses.filter(a => a.analysisStatus === "COMPLETED");

  if (!user) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground">Please log in to access AI Contract Analysis</p>
      </div>
    );
  }

  if (!["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(user.role)) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground">You don't have access to AI Contract Analysis</p>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <FileCheck className="h-8 w-8 text-primary" />
            AI Contract Analysis
          </h1>
          <p className="text-muted-foreground mt-1">
            Analyze contracts, award letters, and amendments for key terms and obligations
          </p>
        </div>
        <Button onClick={() => setShowUploadDialog(true)} data-testid="button-new-contract-analysis">
          <Upload className="h-4 w-4 mr-2" />
          Analyze Contract
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <FileCheck className="h-4 w-4" />
              Total Analyzed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{analyses.length}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Scale className="h-4 w-4" />
              Contracts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {analyses.filter(a => a.documentType === "CONTRACT").length}
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Award Letters
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {analyses.filter(a => a.documentType === "AWARD_LETTER").length}
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Processing
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pendingAnalyses.length}</div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList data-testid="tabs-contract-analysis">
          <TabsTrigger value="recent" data-testid="tab-recent">
            <Clock className="h-4 w-4 mr-2" />
            Recent
          </TabsTrigger>
          <TabsTrigger value="contracts" data-testid="tab-contracts">
            <Scale className="h-4 w-4 mr-2" />
            Contracts
          </TabsTrigger>
          <TabsTrigger value="awards" data-testid="tab-awards">
            <FileText className="h-4 w-4 mr-2" />
            Award Letters
          </TabsTrigger>
        </TabsList>

        <TabsContent value="recent" className="mt-6">
          {loadingAnalyses ? (
            <div className="space-y-4">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-20" />)}
            </div>
          ) : analyses.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <FileCheck className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium">No analyses yet</h3>
                <p className="text-muted-foreground mt-1 mb-4">
                  Upload a contract or award letter for AI-powered analysis
                </p>
                <Button onClick={() => setShowUploadDialog(true)} data-testid="button-first-contract">
                  <Upload className="h-4 w-4 mr-2" />
                  Analyze Your First Document
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {analyses.slice(0, 10).map(analysis => (
                <Card key={analysis.id} className="hover-elevate cursor-pointer" onClick={() => openResultDialog(analysis)}>
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <div className="flex items-center gap-4 min-w-0">
                        <div className="p-2 bg-primary/10 rounded-lg">
                          <FileCheck className="h-5 w-5 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-medium truncate">{analysis.fileName}</h3>
                          <p className="text-sm text-muted-foreground">
                            {analysis.projectCode} - {analysis.projectName}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0 flex-wrap">
                        {getDocTypeBadge(analysis.documentType)}
                        {getStatusBadge(analysis.analysisStatus)}
                        <span className="text-sm text-muted-foreground">
                          {formatDistanceToNow(new Date(analysis.createdAt), { addSuffix: true })}
                        </span>
                        <Button size="sm" variant="outline" data-testid={`button-view-contract-${analysis.id}`}>
                          <Eye className="h-4 w-4 mr-1" />
                          View
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="contracts" className="mt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Document</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Analyzed</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {analyses.filter(a => a.documentType === "CONTRACT").map(analysis => (
                <TableRow key={analysis.id}>
                  <TableCell className="font-medium">{analysis.fileName}</TableCell>
                  <TableCell>{analysis.projectCode}</TableCell>
                  <TableCell>{getStatusBadge(analysis.analysisStatus)}</TableCell>
                  <TableCell>
                    {analysis.analyzedAt 
                      ? format(new Date(analysis.analyzedAt), "MMM d, yyyy")
                      : "—"
                    }
                  </TableCell>
                  <TableCell className="text-right">
                    <Button 
                      size="sm" 
                      variant="outline" 
                      onClick={() => openResultDialog(analysis)}
                      data-testid={`button-view-contract-table-${analysis.id}`}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="awards" className="mt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Document</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Analyzed</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {analyses.filter(a => a.documentType === "AWARD_LETTER").map(analysis => (
                <TableRow key={analysis.id}>
                  <TableCell className="font-medium">{analysis.fileName}</TableCell>
                  <TableCell>{analysis.projectCode}</TableCell>
                  <TableCell>{getStatusBadge(analysis.analysisStatus)}</TableCell>
                  <TableCell>
                    {analysis.analyzedAt 
                      ? format(new Date(analysis.analyzedAt), "MMM d, yyyy")
                      : "—"
                    }
                  </TableCell>
                  <TableCell className="text-right">
                    <Button 
                      size="sm" 
                      variant="outline" 
                      onClick={() => openResultDialog(analysis)}
                      data-testid={`button-view-award-${analysis.id}`}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>
      </Tabs>

      <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Analyze Contract Document</DialogTitle>
            <DialogDescription>
              Upload a contract, award letter, or amendment for AI analysis
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Select Project</label>
              <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                <SelectTrigger data-testid="select-project">
                  <SelectValue placeholder="Select a project..." />
                </SelectTrigger>
                <SelectContent>
                  {projects.map(project => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.code} - {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Document Type</label>
              <Select value={selectedDocType} onValueChange={setSelectedDocType}>
                <SelectTrigger data-testid="select-doc-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CONTRACT">Contract</SelectItem>
                  <SelectItem value="AWARD_LETTER">Award Letter</SelectItem>
                  <SelectItem value="AMENDMENT">Amendment</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {selectedProjectId && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Upload Document</label>
                <ObjectUploader
                  onGetUploadParameters={onGetUploadParameters}
                  onComplete={handleUploadComplete}
                  allowedFileTypes={["application/pdf", "image/*"]}
                  maxFileSize={50 * 1024 * 1024}
                >
                  Upload contract document (PDF or image, max 50MB)
                </ObjectUploader>
              </div>
            )}

            {analyzeMutation.isPending && (
              <Alert>
                <Loader2 className="h-4 w-4 animate-spin" />
                <AlertDescription>
                  Uploading and analyzing document...
                </AlertDescription>
              </Alert>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showResultDialog} onOpenChange={setShowResultDialog}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Contract Analysis Results
              {selectedAnalysis && getDocTypeBadge(selectedAnalysis.documentType)}
            </DialogTitle>
            <DialogDescription>
              {selectedAnalysis?.fileName} - {selectedAnalysis?.projectCode}
            </DialogDescription>
          </DialogHeader>

          {selectedAnalysis?.analysisStatus === "COMPLETED" && selectedAnalysis.analysisResult ? (
            <div className="space-y-6 py-4">
              {selectedAnalysis.analysisResult.summary && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      Executive Summary
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm">{selectedAnalysis.analysisResult.summary}</p>
                  </CardContent>
                </Card>
              )}

              {selectedAnalysis.analysisResult.contractValue && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <DollarSign className="h-4 w-4" />
                      Contract Value
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold">{selectedAnalysis.analysisResult.contractValue}</p>
                  </CardContent>
                </Card>
              )}

              {selectedAnalysis.analysisResult.scopeOfWork?.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Scale className="h-4 w-4" />
                      Scope of Work
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="list-disc list-inside space-y-1 text-sm">
                      {selectedAnalysis.analysisResult.scopeOfWork.map((item: string, i: number) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {selectedAnalysis.analysisResult.keyDates?.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Calendar className="h-4 w-4" />
                      Key Dates & Milestones
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2 text-sm">
                      {selectedAnalysis.analysisResult.keyDates.map((date: any, i: number) => (
                        <li key={i} className="flex items-center gap-2">
                          <Clock className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium">{date.description}:</span>
                          <span>{date.date}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {selectedAnalysis.analysisResult.obligations?.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Shield className="h-4 w-4" />
                      Key Obligations
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="list-disc list-inside space-y-1 text-sm">
                      {selectedAnalysis.analysisResult.obligations.map((item: string, i: number) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {selectedAnalysis.analysisResult.risks?.length > 0 && (
                <Card className="border-yellow-200 dark:border-yellow-800">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2 text-yellow-700 dark:text-yellow-300">
                      <AlertCircle className="h-4 w-4" />
                      Risk Factors
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="list-disc list-inside space-y-1 text-sm">
                      {selectedAnalysis.analysisResult.risks.map((risk: string, i: number) => (
                        <li key={i}>{risk}</li>
                      ))}
                    </ul>
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
                data-testid="button-retry-contract"
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

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowResultDialog(false)} data-testid="button-close-contract-result">
              Close
            </Button>
            {selectedAnalysis?.fileUrl && (
              <>
                <Button 
                  variant="outline"
                  onClick={() => {
                    const link = document.createElement('a');
                    link.href = selectedAnalysis.fileUrl;
                    link.download = selectedAnalysis.fileName || 'document.pdf';
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                  }} 
                  data-testid="button-download-contract-doc"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download
                </Button>
                <Button onClick={() => window.open(selectedAnalysis.fileUrl, "_blank")} data-testid="button-view-contract-doc">
                  <Eye className="h-4 w-4 mr-2" />
                  View Document
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
