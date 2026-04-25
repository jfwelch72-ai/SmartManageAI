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
  FileCheck, Upload, Clock, Scale, FileText,
  Eye, Calendar, DollarSign, Shield, AlertCircle,
  FileWarning, Download, Sparkles, AlertTriangle, Trash2
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
  ResultTextSection,
  ResultListSection,
  ResultDateListSection,
  ResultSectionCard,
} from "@/components/ai-document/DocumentAnalysisPage";

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

export default function AIContractAnalysisPage() {
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

  if (!user) return <div className="p-8 text-center"><p className="text-muted-foreground">Please log in to access AI Contract Analysis</p></div>;
  if (!roles.includes(user.role)) return <div className="p-8 text-center"><p className="text-muted-foreground">You don't have access to AI Contract Analysis</p></div>;

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2"><FileCheck className="h-8 w-8 text-primary" />AI Contract Analysis</h1>
          <p className="text-muted-foreground mt-1">Analyze contracts, award letters, and amendments for key terms and obligations</p>
        </div>
        <Button onClick={() => setShowUploadDialog(true)} data-testid="button-new-contract-analysis"><Upload className="h-4 w-4 mr-2" />Analyze Contract</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2"><FileCheck className="h-4 w-4" />Total Analyzed</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{analyses.length}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2"><Scale className="h-4 w-4" />Contracts</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{analyses.filter(a => a.documentType === "CONTRACT").length}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2"><FileText className="h-4 w-4" />Award Letters</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{analyses.filter(a => a.documentType === "AWARD_LETTER").length}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2"><Clock className="h-4 w-4" />Processing</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{pendingAnalyses.length}</div></CardContent></Card>
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
        helpText="Upload contract document (PDF or image)" analyzePending={mutations.analyzeMutation.isPending} onUploadComplete={handleUploadComplete}
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
