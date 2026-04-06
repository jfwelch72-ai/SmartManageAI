import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useIsMobile } from "@/hooks/use-mobile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  FileSearch, FileCheck, Upload, Clock, Scale, FileText,
  Eye, Calendar, DollarSign, Shield, AlertCircle,
  FileWarning, Download, Sparkles, AlertTriangle, Trash2,
  CheckCircle2, Target, Archive
} from "lucide-react";
import { format } from "date-fns";
import {
  type AnalysisItem,
  type EntityItem,
  getStatusBadge,
  useDocumentAnalysisMutations,
  UploadDialog,
  AnalysisResultDialog,
  RecentAnalysisList,
  CompletedAnalysisTable,
  FailedAnalysisList,
  ArchivedAnalysisList,
  ResultTextSection,
  ResultListSection,
  ResultDateListSection,
  ResultSectionCard,
} from "@/components/ai-document/DocumentAnalysisPage";
import { useLocation } from "wouter";

interface BidDocumentAnalysis extends AnalysisItem {
  bidId: string;
  bidCode: string;
  bidName: string;
  analyzedByName: string | null;
}

interface ContractDocumentAnalysis extends AnalysisItem {
  projectId: string;
  projectCode: string;
  projectName: string;
  documentType: string;
  analyzedByName: string | null;
}

function getDocTypeBadge(docType: string) {
  switch (docType) {
    case "CONTRACT": return <Badge variant="outline"><FileCheck className="h-3 w-3 mr-1" />Contract</Badge>;
    case "AWARD_LETTER": return <Badge variant="outline"><FileText className="h-3 w-3 mr-1" />Award Letter</Badge>;
    case "AMENDMENT": return <Badge variant="outline"><FileWarning className="h-3 w-3 mr-1" />Amendment</Badge>;
    default: return <Badge variant="outline">{docType}</Badge>;
  }
}

function ContractFilteredTable({ analyses, openResult, deleteMutation, isMobile, testPrefix }: { analyses: ContractDocumentAnalysis[]; openResult: (a: ContractDocumentAnalysis) => void; deleteMutation: { mutate: (id: string) => void; isPending: boolean }; isMobile: boolean; testPrefix: string }) {
  if (isMobile) {
    return (
      <div className="space-y-3">
        {analyses.map(analysis => (
          <Card key={analysis.id} className="hover-elevate cursor-pointer" onClick={() => openResult(analysis)} data-testid={`card-${testPrefix}-${analysis.id}`}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium text-sm truncate">{analysis.fileName}</p>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); openResult(analysis); }} data-testid={`button-view-${testPrefix}-${analysis.id}`}><Eye className="h-4 w-4" /></Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="outline" className="text-destructive" disabled={deleteMutation.isPending} onClick={(e) => e.stopPropagation()} data-testid={`button-delete-${testPrefix}-${analysis.id}`}><Trash2 className="h-4 w-4" /></Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete this analysis?</AlertDialogTitle>
                        <AlertDialogDescription>This will permanently delete the analysis for "{analysis.fileName}". This action cannot be undone.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => deleteMutation.mutate(analysis.id)} className="bg-destructive text-destructive-foreground">Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">{analysis.projectCode}</p>
              <div className="flex items-center gap-2 flex-wrap">
                {getStatusBadge(analysis.analysisStatus)}
                <span className="text-xs text-muted-foreground">{analysis.analyzedAt ? format(new Date(analysis.analyzedAt), "MMM d, yyyy") : "Not analyzed"}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }
  return (
    <Table>
      <TableHeader><TableRow><TableHead>Document</TableHead><TableHead>Project</TableHead><TableHead>Status</TableHead><TableHead>Analyzed</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
      <TableBody>
        {analyses.map(analysis => (
          <TableRow key={analysis.id}>
            <TableCell className="font-medium">{analysis.fileName}</TableCell>
            <TableCell>{analysis.projectCode}</TableCell>
            <TableCell>{getStatusBadge(analysis.analysisStatus)}</TableCell>
            <TableCell>{analysis.analyzedAt ? format(new Date(analysis.analyzedAt), "MMM d, yyyy") : "\u2014"}</TableCell>
            <TableCell className="text-right">
              <div className="flex items-center justify-end gap-1">
                <Button size="sm" variant="outline" onClick={() => openResult(analysis)} data-testid={`button-view-${testPrefix}-table-${analysis.id}`}><Eye className="h-4 w-4" /></Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" variant="outline" className="text-destructive" disabled={deleteMutation.isPending} data-testid={`button-delete-${testPrefix}-table-${analysis.id}`}><Trash2 className="h-4 w-4" /></Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete this analysis?</AlertDialogTitle>
                      <AlertDialogDescription>This will permanently delete the analysis for "{analysis.fileName}". This action cannot be undone.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => deleteMutation.mutate(analysis.id)} className="bg-destructive text-destructive-foreground">Delete</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function BidAnalysisSection() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("new");
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [selectedBidId, setSelectedBidId] = useState<string>("");
  const [showResultDialog, setShowResultDialog] = useState(false);
  const [selectedAnalysis, setSelectedAnalysis] = useState<BidDocumentAnalysis | null>(null);
  const roles = ["ADMIN", "MANAGER", "ESTIMATOR"];

  const { data: bids = [] } = useQuery<EntityItem[]>({
    queryKey: ["/api/ai-bid-document/bids"],
    enabled: !!user && roles.includes(user.role)
  });
  const { data: analyses = [], isLoading } = useQuery<BidDocumentAnalysis[]>({
    queryKey: ["/api/ai-bid-document"],
    enabled: !!user && roles.includes(user.role)
  });
  const { data: archivedAnalyses = [], isLoading: loadingArchived } = useQuery<BidDocumentAnalysis[]>({
    queryKey: ["/api/ai-bid-document?archived=true"],
    enabled: !!user && roles.includes(user.role)
  });

  const mutations = useDocumentAnalysisMutations({
    analysesEndpoint: "/api/ai-bid-document",
    analyzeEndpoint: "/api/ai-bid-document/analyze",
    reanalyzeEndpointFn: (id) => `/api/ai-bid-document/${id}/reanalyze`,
    archiveEndpointFn: (id) => `/api/ai-bid-document/${id}/archive`,
    restoreEndpointFn: (id) => `/api/ai-bid-document/${id}/restore`,
    deleteEndpointFn: (id) => `/api/ai-bid-document/${id}`,
    archivedEndpoint: "/api/ai-bid-document?archived=true",
    onAnalyzeSuccess: () => { setShowUploadDialog(false); setSelectedBidId(""); },
  });

  const handleUploadComplete = (result: any) => {
    if (!result.successful?.length) { toast({ title: "Error", description: "Upload failed", variant: "destructive" }); return; }
    const f = result.successful[0];
    if (!selectedBidId) { toast({ title: "Error", description: "Please select a bid first", variant: "destructive" }); return; }
    mutations.analyzeMutation.mutate({ bidId: selectedBidId, fileUrl: f.uploadURL?.split('?')[0] || "", fileName: f.name });
  };

  const openResult = (a: BidDocumentAnalysis) => { setSelectedAnalysis(a); setShowResultDialog(true); };
  const pendingAnalyses = analyses.filter(a => a.analysisStatus === "PENDING" || a.analysisStatus === "PROCESSING");
  const completedAnalyses = analyses.filter(a => a.analysisStatus === "COMPLETED");
  const failedAnalyses = analyses.filter(a => a.analysisStatus === "FAILED");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <Button onClick={() => setShowUploadDialog(true)} data-testid="button-new-bid-analysis"><Upload className="h-4 w-4 mr-2" />Analyze Bid Document</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2"><Sparkles className="h-4 w-4" />Total Analyses</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold" data-testid="text-bid-total">{analyses.length}</div><p className="text-xs text-muted-foreground">Documents analyzed</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2"><Clock className="h-4 w-4" />In Progress</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold" data-testid="text-bid-progress">{pendingAnalyses.length}</div><p className="text-xs text-muted-foreground">Currently processing</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />Completed</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold" data-testid="text-bid-completed">{completedAnalyses.length}</div><p className="text-xs text-muted-foreground">Ready for review</p></CardContent></Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList data-testid="tabs-bid-analysis">
          <TabsTrigger value="new" data-testid="tab-bid-recent"><Sparkles className="h-4 w-4 mr-2" />Recent</TabsTrigger>
          <TabsTrigger value="completed" data-testid="tab-bid-completed"><CheckCircle2 className="h-4 w-4 mr-2" />Completed ({completedAnalyses.length})</TabsTrigger>
          {failedAnalyses.length > 0 && <TabsTrigger value="failed" data-testid="tab-bid-failed"><AlertTriangle className="h-4 w-4 mr-2" />Failed ({failedAnalyses.length})</TabsTrigger>}
          <TabsTrigger value="archived" data-testid="tab-bid-archived"><Archive className="h-4 w-4 mr-2" />Archived ({archivedAnalyses.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="new" className="mt-6">
          <RecentAnalysisList analyses={analyses} loading={isLoading} onUpload={() => setShowUploadDialog(true)} openResult={openResult} archiveMutation={mutations.archiveMutation} emptyIcon={FileSearch} emptyLabel="Upload a bid document to get AI-powered insights" firstButtonTestId="button-first-bid-analysis" />
        </TabsContent>
        <TabsContent value="completed" className="mt-6">
          <CompletedAnalysisTable analyses={completedAnalyses} openResult={openResult} getCode={(a) => a.bidCode} getName={(a) => a.bidName} />
        </TabsContent>
        <TabsContent value="failed" className="mt-6"><FailedAnalysisList analyses={failedAnalyses} reanalyzeMutation={mutations.reanalyzeMutation} /></TabsContent>
        <TabsContent value="archived" className="mt-6">
          <ArchivedAnalysisList analyses={archivedAnalyses} loading={loadingArchived} restoreMutation={mutations.restoreMutation!} deleteMutation={mutations.deleteMutation!} />
        </TabsContent>
      </Tabs>

      <UploadDialog open={showUploadDialog} onOpenChange={setShowUploadDialog} title="Analyze Bid Document" description="Upload a bid invitation, RFP, or scope document for AI analysis" entityLabel="Bid" entities={bids} selectedEntityId={selectedBidId} onEntityChange={setSelectedBidId} entitySelectTestId="select-bid" helpText="Upload bid invitation, RFP, or scope document (PDF or image, max 50MB)" analyzePending={mutations.analyzeMutation.isPending} onUploadComplete={handleUploadComplete} />

      <AnalysisResultDialog
        analysis={selectedAnalysis}
        open={showResultDialog}
        onOpenChange={setShowResultDialog}
        reanalyzeMutation={mutations.reanalyzeMutation}
        config={{
          renderResultTitle: () => "Analysis Results",
          renderResultSubtitle: (a) => `${a.fileName} - ${a.bidCode}`,
          renderResultSections: (a) => (
            <>
              <ResultTextSection icon={Target} title="Summary" text={a.analysisResult?.summary} />
              <ResultListSection icon={FileText} title="Scope Requirements" items={a.analysisResult?.scopeRequirements} />
              <ResultDateListSection icon={Calendar} title="Key Deadlines" items={a.analysisResult?.deadlines} />
              <ResultListSection icon={AlertTriangle} title="Key Terms & Conditions" items={a.analysisResult?.keyTerms} />
              <ResultTextSection icon={DollarSign} title="Budget Insights" text={a.analysisResult?.budgetInsights} />
              <ResultListSection icon={Sparkles} title="AI Recommendations" items={a.analysisResult?.recommendations} />
            </>
          ),
          renderResultFooterExtras: (a) => a.fileUrl ? (
            <Button onClick={() => window.open(a.fileUrl, "_blank")} data-testid="button-view-original-document"><span className="h-4 w-4 mr-2">View Original Document</span></Button>
          ) : null,
        }}
      />
    </div>
  );
}

function ContractAnalysisSection() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState("recent");
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [selectedDocType, setSelectedDocType] = useState<string>("CONTRACT");
  const [showResultDialog, setShowResultDialog] = useState(false);
  const [selectedAnalysis, setSelectedAnalysis] = useState<ContractDocumentAnalysis | null>(null);
  const roles = ["ADMIN", "MANAGER"];

  const { data: projects = [] } = useQuery<EntityItem[]>({ queryKey: ["/api/ai-contract-document/projects"], enabled: !!user && roles.includes(user.role) });
  const { data: analyses = [], isLoading } = useQuery<ContractDocumentAnalysis[]>({ queryKey: ["/api/ai-contract-document"], enabled: !!user && roles.includes(user.role) });

  const queryClient = useQueryClient();

  const mutations = useDocumentAnalysisMutations({
    analysesEndpoint: "/api/ai-contract-document",
    analyzeEndpoint: "/api/ai-contract-document/analyze",
    reanalyzeEndpointFn: (id) => `/api/ai-contract-document/${id}/reanalyze`,
    onAnalyzeSuccess: () => { setShowUploadDialog(false); setSelectedProjectId(""); setSelectedDocType("CONTRACT"); },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/ai/contract-document-analysis/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Failed to delete analysis");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-contract-document"] });
      toast({ title: "Analysis deleted successfully" });
    },
    onError: () => {
      toast({ title: "Delete failed", description: "Could not delete the analysis", variant: "destructive" });
    },
  });

  const handleDownload = async (analysisId: string, fileName: string, inline: boolean = false) => {
    try {
      const url = `/api/ai-contract-document/download/${analysisId}${inline ? '?inline=true' : ''}`;
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to download file");
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      if (inline) { window.open(blobUrl, "_blank"); } else {
        const a = document.createElement("a"); a.href = blobUrl; a.download = fileName || "document.pdf"; document.body.appendChild(a); a.click(); document.body.removeChild(a); window.URL.revokeObjectURL(blobUrl);
        toast({ title: "Document downloaded successfully" });
      }
    } catch { toast({ title: "Download failed", description: "Could not download the document", variant: "destructive" }); }
  };

  const handleUploadComplete = (result: any) => {
    if (!result.successful?.length) { toast({ title: "Error", description: "Upload failed", variant: "destructive" }); return; }
    const f = result.successful[0];
    if (!selectedProjectId) { toast({ title: "Error", description: "Please select a project first", variant: "destructive" }); return; }
    mutations.analyzeMutation.mutate({ projectId: selectedProjectId, fileUrl: f.uploadURL?.split('?')[0] || "", fileName: f.name, documentType: selectedDocType });
  };

  const openResult = (a: ContractDocumentAnalysis) => { setSelectedAnalysis(a); setShowResultDialog(true); };
  const pendingAnalyses = analyses.filter(a => a.analysisStatus === "PENDING" || a.analysisStatus === "PROCESSING");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <Button onClick={() => setShowUploadDialog(true)} data-testid="button-new-contract-analysis"><Upload className="h-4 w-4 mr-2" />Analyze Contract</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2"><FileCheck className="h-4 w-4" />Total Analyzed</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold" data-testid="text-contract-total">{analyses.length}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2"><Scale className="h-4 w-4" />Contracts</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold" data-testid="text-contract-contracts">{analyses.filter(a => a.documentType === "CONTRACT").length}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2"><FileText className="h-4 w-4" />Award Letters</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold" data-testid="text-contract-awards">{analyses.filter(a => a.documentType === "AWARD_LETTER").length}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2"><Clock className="h-4 w-4" />Processing</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold" data-testid="text-contract-processing">{pendingAnalyses.length}</div></CardContent></Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList data-testid="tabs-contract-analysis">
          <TabsTrigger value="recent" data-testid="tab-recent"><Clock className="h-4 w-4 mr-2" />Recent</TabsTrigger>
          <TabsTrigger value="contracts" data-testid="tab-contracts"><Scale className="h-4 w-4 mr-2" />Contracts</TabsTrigger>
          <TabsTrigger value="awards" data-testid="tab-awards"><FileText className="h-4 w-4 mr-2" />Award Letters</TabsTrigger>
        </TabsList>
        <TabsContent value="recent" className="mt-6">
          <RecentAnalysisList analyses={analyses} loading={isLoading} onUpload={() => setShowUploadDialog(true)} openResult={openResult} archiveMutation={deleteMutation} emptyIcon={FileCheck} emptyLabel="Upload a contract or award letter for AI-powered analysis" firstButtonTestId="button-first-contract" />
        </TabsContent>
        <TabsContent value="contracts" className="mt-6">
          <ContractFilteredTable analyses={analyses.filter(a => a.documentType === "CONTRACT")} openResult={openResult} deleteMutation={deleteMutation} isMobile={isMobile} testPrefix="contract" />
        </TabsContent>
        <TabsContent value="awards" className="mt-6">
          <ContractFilteredTable analyses={analyses.filter(a => a.documentType === "AWARD_LETTER")} openResult={openResult} deleteMutation={deleteMutation} isMobile={isMobile} testPrefix="award" />
        </TabsContent>
      </Tabs>

      <UploadDialog
        open={showUploadDialog} onOpenChange={setShowUploadDialog} title="Analyze Contract Document" description="Upload a contract, award letter, or amendment for AI analysis"
        entityLabel="Project" entities={projects} selectedEntityId={selectedProjectId} onEntityChange={setSelectedProjectId} entitySelectTestId="select-project"
        helpText="Upload contract document (PDF or image, max 50MB)" analyzePending={mutations.analyzeMutation.isPending} onUploadComplete={handleUploadComplete}
        renderExtras={() => (
          <div className="space-y-2">
            <label className="text-sm font-medium">Document Type</label>
            <Select value={selectedDocType} onValueChange={setSelectedDocType}>
              <SelectTrigger data-testid="select-doc-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="CONTRACT">Contract</SelectItem>
                <SelectItem value="AWARD_LETTER">Award Letter</SelectItem>
                <SelectItem value="AMENDMENT">Amendment</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      />

      <AnalysisResultDialog
        analysis={selectedAnalysis} open={showResultDialog} onOpenChange={setShowResultDialog} reanalyzeMutation={mutations.reanalyzeMutation}
        config={{
          renderResultTitle: (a) => <span className="flex items-center gap-2">Contract Analysis Results{getDocTypeBadge(a.documentType)}</span>,
          renderResultSubtitle: (a) => `${a.fileName} - ${a.projectCode}`,
          renderResultSections: (a) => (
            <>
              <ResultTextSection icon={FileText} title="Executive Summary" text={a.analysisResult?.summary} />
              {a.analysisResult?.contractValue && <ResultSectionCard icon={DollarSign} title="Contract Value"><p className="text-2xl font-bold">{a.analysisResult.contractValue}</p></ResultSectionCard>}
              <ResultListSection icon={Scale} title="Scope of Work" items={a.analysisResult?.scopeOfWork} />
              <ResultDateListSection icon={Calendar} title="Key Dates & Milestones" items={a.analysisResult?.keyDates} />
              <ResultListSection icon={Shield} title="Key Obligations" items={a.analysisResult?.obligations} />
              <ResultListSection icon={AlertCircle} title="Risk Factors" items={a.analysisResult?.risks} className="border-yellow-200 dark:border-yellow-800" />
              <ResultListSection icon={Sparkles} title="AI Recommendations" items={a.analysisResult?.recommendations} />
            </>
          ),
          renderResultFooterExtras: (a) => a.fileUrl ? (
            <>
              <Button variant="outline" onClick={() => handleDownload(a.id, a.fileName, false)} data-testid="button-download-contract-doc"><Download className="h-4 w-4 mr-2" />Download</Button>
              <Button onClick={() => handleDownload(a.id, a.fileName, true)} data-testid="button-view-contract-doc"><Eye className="h-4 w-4 mr-2" />View Document</Button>
            </>
          ) : null,
        }}
      />
    </div>
  );
}

export default function AIDocumentAnalysisPage() {
  const { user } = useAuth();
  const [location] = useLocation();
  const params = new URLSearchParams(window.location.search);
  const initialMode = params.get("mode") === "contract" ? "contract" : "bid";
  const [mode, setMode] = useState<"bid" | "contract">(initialMode);

  if (!user) return <div className="p-8 text-center"><p className="text-muted-foreground">Please log in to access AI Document Analysis</p></div>;

  const bidRoles = ["ADMIN", "MANAGER", "ESTIMATOR"];
  const contractRoles = ["ADMIN", "MANAGER"];
  const hasBidAccess = bidRoles.includes(user.role);
  const hasContractAccess = contractRoles.includes(user.role);
  const hasAccess = hasBidAccess || hasContractAccess;

  if (!hasAccess) return <div className="p-8 text-center"><p className="text-muted-foreground">You don't have access to AI Document Analysis</p></div>;

  const effectiveMode = mode === "contract" && !hasContractAccess ? "bid" : mode === "bid" && !hasBidAccess ? "contract" : mode;

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <FileSearch className="h-8 w-8 text-primary" />
            AI Document Analysis
          </h1>
          <p className="text-muted-foreground mt-1">Upload and analyze bid documents and contracts with AI-powered insights</p>
        </div>
        {hasBidAccess && hasContractAccess && (
          <div className="flex items-center gap-2 bg-muted rounded-lg p-1" data-testid="toggle-analysis-mode">
            <Button
              variant={effectiveMode === "bid" ? "default" : "ghost"}
              size="sm"
              onClick={() => setMode("bid")}
              data-testid="button-mode-bid"
            >
              <FileSearch className="h-4 w-4 mr-2" />
              Bid Analysis
            </Button>
            <Button
              variant={effectiveMode === "contract" ? "default" : "ghost"}
              size="sm"
              onClick={() => setMode("contract")}
              data-testid="button-mode-contract"
            >
              <FileCheck className="h-4 w-4 mr-2" />
              Contract Analysis
            </Button>
          </div>
        )}
      </div>

      {effectiveMode === "bid" && hasBidAccess ? <BidAnalysisSection /> : effectiveMode === "contract" && hasContractAccess ? <ContractAnalysisSection /> : <BidAnalysisSection />}
    </div>
  );
}
