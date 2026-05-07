import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  FileSearch, Upload, Sparkles, Clock, CheckCircle2,
  AlertTriangle, FileText, Calendar, DollarSign, Target, Archive
} from "lucide-react";
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
  JobProgressBanner,
} from "@/components/ai-document/DocumentAnalysisPage";

interface BidDocumentAnalysis extends AnalysisItem {
  bidId: string;
  bidCode: string;
  bidName: string;
  analyzedByName: string | null;
}

export default function AIBidAnalysisPage() {
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

  if (!user) return <div className="p-8 text-center"><p className="text-muted-foreground">Please log in to access AI Bid Analysis</p></div>;
  if (!roles.includes(user.role)) return <div className="p-8 text-center"><p className="text-muted-foreground">You don't have access to AI Bid Analysis</p></div>;

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2"><FileSearch className="h-8 w-8 text-primary" />AI Bid Document Analysis</h1>
          <p className="text-muted-foreground mt-1">Upload bid invitations, RFPs, and scope documents for AI-powered analysis</p>
        </div>
        <Button onClick={() => setShowUploadDialog(true)} data-testid="button-new-analysis"><Upload className="h-4 w-4 mr-2" />Analyze New Document</Button>
      </div>

      <JobProgressBanner
        jobId={mutations.analyzeMutation.data?.jobId}
        label="Analyzing bid document"
        onDismiss={() => mutations.analyzeMutation.reset()}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2"><Sparkles className="h-4 w-4" />Total Analyses</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{analyses.length}</div><p className="text-xs text-muted-foreground">Documents analyzed</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2"><Clock className="h-4 w-4" />In Progress</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{pendingAnalyses.length}</div><p className="text-xs text-muted-foreground">Currently processing</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />Completed</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{completedAnalyses.length}</div><p className="text-xs text-muted-foreground">Ready for review</p></CardContent></Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList data-testid="tabs-bid-analysis">
          <TabsTrigger value="new" data-testid="tab-bid-recent"><Sparkles className="h-4 w-4 mr-2" />Recent</TabsTrigger>
          <TabsTrigger value="completed" data-testid="tab-bid-completed"><CheckCircle2 className="h-4 w-4 mr-2" />Completed ({completedAnalyses.length})</TabsTrigger>
          {failedAnalyses.length > 0 && <TabsTrigger value="failed" data-testid="tab-bid-failed"><AlertTriangle className="h-4 w-4 mr-2" />Failed ({failedAnalyses.length})</TabsTrigger>}
          <TabsTrigger value="archived" data-testid="tab-bid-archived"><Archive className="h-4 w-4 mr-2" />Archived ({archivedAnalyses.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="new" className="mt-6">
          <RecentAnalysisList analyses={analyses} loading={isLoading} onUpload={() => setShowUploadDialog(true)} openResult={openResult} archiveMutation={mutations.archiveMutation} emptyIcon={FileSearch} emptyLabel="Upload a bid document to get AI-powered insights" firstButtonTestId="button-first-analysis" />
        </TabsContent>
        <TabsContent value="completed" className="mt-6">
          <CompletedAnalysisTable analyses={completedAnalyses} openResult={openResult} getCode={(a) => a.bidCode} getName={(a) => a.bidName} />
        </TabsContent>
        <TabsContent value="failed" className="mt-6"><FailedAnalysisList analyses={failedAnalyses} reanalyzeMutation={mutations.reanalyzeMutation} /></TabsContent>
        <TabsContent value="archived" className="mt-6">
          <ArchivedAnalysisList analyses={archivedAnalyses} loading={loadingArchived} restoreMutation={mutations.restoreMutation!} deleteMutation={mutations.deleteMutation!} />
        </TabsContent>
      </Tabs>

      <UploadDialog open={showUploadDialog} onOpenChange={setShowUploadDialog} title="Analyze Bid Document" description="Upload a bid invitation, RFP, or scope document for AI analysis" entityLabel="Bid" entities={bids} selectedEntityId={selectedBidId} onEntityChange={setSelectedBidId} entitySelectTestId="select-bid" helpText="Upload bid invitation, RFP, or scope document (PDF or image)" analyzePending={mutations.analyzeMutation.isPending} jobId={mutations.analyzeMutation.data?.jobId ?? null} onUploadComplete={handleUploadComplete} />

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
