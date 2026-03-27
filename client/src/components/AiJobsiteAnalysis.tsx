import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { 
  Sparkles, 
  Loader2, 
  CheckCircle2, 
  AlertCircle, 
  Camera,
  Clock,
  AlertTriangle,
  Shield,
  HardHat,
  Upload,
  Image,
  Eye,
  RefreshCw,
  TrendingUp,
  BarChart3,
  ChevronRight
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { format, parseISO, differenceInHours } from "date-fns";

interface AnalysisResult {
  id: string;
  photoUrl: string;
  thumbnailUrl?: string;
  analysisType: "SAFETY" | "PROGRESS" | "QUALITY" | "GENERAL";
  aiFindings: {
    safetyIssues?: Array<{
      severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
      description: string;
      location?: string;
      recommendation?: string;
    }>;
    progressEstimate?: number;
    qualityIssues?: string[];
    observations?: string[];
  };
  confidenceScore: number;
  reviewStatus: "PENDING" | "CONFIRMED" | "DISMISSED";
  reviewedBy?: string;
  reviewNotes?: string;
  createdAt: string;
}

interface AnalysisBatch {
  id: string;
  projectId: string;
  analysisDate: string;
  batchDate?: string;
  photoCount?: number;
  status: string;
  analysisStatus?: string;
  analysisTypes?: string[];
  safetyScore?: number;
  progressScore?: number;
  summaryJson?: string;
  createdByUserId?: string;
  createdBy?: string;
  createdAt?: string;
  completedAt?: string;
}

interface AiJobsiteAnalysisProps {
  projectId: string;
  projectName: string;
}

const SEVERITY_CONFIG = {
  LOW: { color: "bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300", icon: AlertCircle },
  MEDIUM: { color: "bg-yellow-100 text-yellow-600 dark:bg-yellow-900 dark:text-yellow-300", icon: AlertTriangle },
  HIGH: { color: "bg-orange-100 text-orange-600 dark:bg-orange-900 dark:text-orange-300", icon: AlertTriangle },
  CRITICAL: { color: "bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-300", icon: Shield },
};

const ANALYSIS_TYPE_CONFIG = {
  SAFETY: { icon: HardHat, label: "Safety Inspection", color: "text-orange-500" },
  PROGRESS: { icon: TrendingUp, label: "Progress Tracking", color: "text-blue-500" },
  QUALITY: { icon: Eye, label: "Quality Check", color: "text-green-500" },
  GENERAL: { icon: Camera, label: "General", color: "text-gray-500" },
};

export default function AiJobsiteAnalysis({ projectId, projectName }: AiJobsiteAnalysisProps) {
  const [activeTab, setActiveTab] = useState("overview");
  const [selectedPhoto, setSelectedPhoto] = useState<AnalysisResult | null>(null);
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [reviewNotes, setReviewNotes] = useState("");
  
  const { toast } = useToast();

  interface BatchResponse {
    batches: AnalysisBatch[];
    results: AnalysisResult[];
    stats: {
      totalPhotos: number;
      safetyIssues: number;
      avgConfidence: number;
    };
  }

  const { data, isLoading, refetch } = useQuery<BatchResponse>({
    queryKey: ["/api/ai-features/jobsite/history", projectId],
  });

  const analyzeMutation = useMutation({
    mutationFn: async (photoUrls: string[]) => {
      const response = await apiRequest("POST", "/api/ai-features/jobsite/analyze", {
        projectId,
        date: new Date().toISOString().split("T")[0],
        analysisTypes: ["SAFETY"],
      });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-features/jobsite/history", projectId] });
      toast({
        title: "Analysis Started",
        description: `AI is analyzing ${data.batchId ? "your photos" : "the image"}`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Analysis Failed",
        description: error.message || "Failed to start analysis",
        variant: "destructive",
      });
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ resultId, status, notes }: { resultId: string; status: string; notes?: string }) => {
      const response = await apiRequest("PATCH", `/api/ai-features/jobsite/results/${resultId}`, {
        reviewStatus: status,
        reviewNotes: notes,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-features/jobsite/history", projectId] });
      setReviewDialogOpen(false);
      setSelectedPhoto(null);
      toast({
        title: "Review Saved",
        description: "Your review has been recorded",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Review Failed",
        description: error.message || "Failed to save review",
        variant: "destructive",
      });
    },
  });

  const handleReviewPhoto = (photo: AnalysisResult) => {
    setSelectedPhoto(photo);
    setReviewNotes(photo.reviewNotes || "");
    setReviewDialogOpen(true);
  };

  const handleSubmitReview = (status: "CONFIRMED" | "DISMISSED") => {
    if (!selectedPhoto) return;
    reviewMutation.mutate({ 
      resultId: selectedPhoto.id, 
      status, 
      notes: reviewNotes 
    });
  };

  const batches = data?.batches || [];
  const results = data?.results || [];
  const stats = data?.stats || { totalPhotos: 0, safetyIssues: 0, avgConfidence: 0 };
  
  const safetyIssues = results.flatMap(r => 
    (r.aiFindings?.safetyIssues || []).map(issue => ({ ...issue, photoId: r.id, photo: r }))
  );
  const criticalIssues = safetyIssues.filter(i => i.severity === "CRITICAL" || i.severity === "HIGH");
  const pendingReviews = results.filter(r => r.reviewStatus === "PENDING");

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">AI Jobsite Analysis</h2>
          <p className="text-muted-foreground">
            Safety monitoring and progress tracking
          </p>
        </div>
        <div className="w-full sm:w-auto flex gap-2">
          <Button variant="outline" className="w-full sm:w-auto" onClick={() => refetch()} data-testid="button-refresh-analysis">
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Button className="w-full sm:w-auto" onClick={() => analyzeMutation.mutate([])} disabled={analyzeMutation.isPending} data-testid="button-analyze-photos">
            {analyzeMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                Analyze New Photos
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Camera className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Photos Analyzed</p>
                <p className="text-2xl font-bold">{stats.totalPhotos}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className={cn("p-2 rounded-lg", criticalIssues.length > 0 ? "bg-red-100" : "bg-green-100")}>
                <Shield className={cn("w-5 h-5", criticalIssues.length > 0 ? "text-red-600" : "text-green-600")} />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Critical Issues</p>
                <p className="text-2xl font-bold">{criticalIssues.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-yellow-100 rounded-lg">
                <Clock className="w-5 h-5 text-yellow-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Pending Review</p>
                <p className="text-2xl font-bold">{pendingReviews.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <BarChart3 className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">AI Confidence</p>
                <p className="text-2xl font-bold">{Math.round(stats.avgConfidence * 100)}%</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview" data-testid="tab-analysis-overview">Overview</TabsTrigger>
          <TabsTrigger value="safety" data-testid="tab-analysis-safety">
            Safety Issues
            {safetyIssues.length > 0 && (
              <Badge className="ml-2" variant="secondary">{safetyIssues.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="photos" data-testid="tab-analysis-photos">All Photos</TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-analysis-history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <HardHat className="w-5 h-5 text-orange-500" />
                  Safety Summary
                </CardTitle>
              </CardHeader>
              <CardContent>
                {safetyIssues.length === 0 ? (
                  <div className="text-center py-8">
                    <CheckCircle2 className="w-12 h-12 mx-auto text-green-500 mb-4" />
                    <p className="font-medium">No Safety Issues Detected</p>
                    <p className="text-sm text-muted-foreground">All analyzed photos show safe conditions</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {["CRITICAL", "HIGH", "MEDIUM", "LOW"].map(severity => {
                      const count = safetyIssues.filter(i => i.severity === severity).length;
                      if (count === 0) return null;
                      const config = SEVERITY_CONFIG[severity as keyof typeof SEVERITY_CONFIG];
                      const SeverityIcon = config.icon;
                      return (
                        <div key={severity} className="flex items-center justify-between p-3 rounded-lg border">
                          <div className="flex items-center gap-3">
                            <SeverityIcon className={cn("w-5 h-5", config.color.split(" ")[1])} />
                            <span className="font-medium">{severity}</span>
                          </div>
                          <Badge className={config.color}>{count}</Badge>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-blue-500" />
                  Recent Activity
                </CardTitle>
              </CardHeader>
              <CardContent>
                {batches.length === 0 ? (
                  <div className="text-center py-8">
                    <Camera className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                    <p className="font-medium">No Analysis History</p>
                    <p className="text-sm text-muted-foreground">Upload and analyze project photos to get started</p>
                  </div>
                ) : (
                  <ScrollArea className="h-[200px]">
                    <div className="space-y-3">
                      {batches.slice(0, 5).map(batch => (
                        <div key={batch.id} className="flex items-center justify-between p-3 rounded-lg border hover-elevate">
                          <div>
                            <p className="font-medium text-sm">{batch.photoCount || 0} photos analyzed</p>
                            <p className="text-xs text-muted-foreground">
                              {format(parseISO(batch.analysisDate || batch.createdAt || new Date().toISOString()), "MMM d, yyyy")}
                            </p>
                          </div>
                          <Badge variant={(batch.status || batch.analysisStatus) === "COMPLETE" ? "secondary" : "outline"}>
                            {batch.status || batch.analysisStatus}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="safety" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Safety Issues</CardTitle>
              <CardDescription>
                AI-detected safety concerns requiring attention
              </CardDescription>
            </CardHeader>
            <CardContent>
              {safetyIssues.length === 0 ? (
                <div className="text-center py-12">
                  <Shield className="w-16 h-16 mx-auto text-green-500 mb-4" />
                  <h3 className="text-lg font-semibold mb-2">All Clear</h3>
                  <p className="text-muted-foreground">No safety issues have been detected in your jobsite photos</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {safetyIssues.map((issue, index) => {
                    const config = SEVERITY_CONFIG[issue.severity];
                    const SeverityIcon = config.icon;
                    return (
                      <div 
                        key={`${issue.photoId}-${index}`}
                        className="flex items-start gap-4 p-4 rounded-lg border hover-elevate cursor-pointer"
                        onClick={() => handleReviewPhoto(issue.photo)}
                      >
                        <div className={cn("p-2 rounded-lg flex-shrink-0", config.color)}>
                          <SeverityIcon className="w-5 h-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge className={config.color}>{issue.severity}</Badge>
                            {issue.location && (
                              <span className="text-sm text-muted-foreground">{issue.location}</span>
                            )}
                          </div>
                          <p className="font-medium">{issue.description}</p>
                          {issue.recommendation && (
                            <p className="text-sm text-muted-foreground mt-1">{issue.recommendation}</p>
                          )}
                        </div>
                        <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="photos" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Analyzed Photos</CardTitle>
              <CardDescription>
                Click on a photo to view details and review findings
              </CardDescription>
            </CardHeader>
            <CardContent>
              {results.length === 0 ? (
                <div className="text-center py-12">
                  <Image className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">No Photos Yet</h3>
                  <p className="text-muted-foreground mb-4">Upload and analyze photos to track jobsite conditions</p>
                  <Button onClick={() => analyzeMutation.mutate([])}>
                    <Upload className="w-4 h-4 mr-2" />
                    Start Analysis
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {results.map(result => {
                    const TypeConfig = ANALYSIS_TYPE_CONFIG[result.analysisType];
                    const TypeIcon = TypeConfig.icon;
                    return (
                      <div 
                        key={result.id}
                        className="relative group rounded-lg overflow-hidden border hover-elevate cursor-pointer"
                        onClick={() => handleReviewPhoto(result)}
                        data-testid={`photo-result-${result.id}`}
                      >
                        <div className="aspect-square bg-muted flex items-center justify-center">
                          {result.thumbnailUrl ? (
                            <img 
                              src={result.thumbnailUrl} 
                              alt="Jobsite photo" 
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <Camera className="w-8 h-8 text-muted-foreground" />
                          )}
                        </div>
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <Eye className="w-8 h-8 text-white" />
                        </div>
                        <div className="absolute top-2 left-2">
                          <Badge className={cn("text-white", 
                            result.reviewStatus === "PENDING" ? "bg-yellow-500" :
                            result.reviewStatus === "CONFIRMED" ? "bg-green-500" : "bg-gray-500"
                          )}>
                            {result.reviewStatus}
                          </Badge>
                        </div>
                        <div className="absolute bottom-2 right-2">
                          <div className={cn("p-1 rounded bg-background/80", TypeConfig.color)}>
                            <TypeIcon className="w-4 h-4" />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Analysis History</CardTitle>
              <CardDescription>
                Past analysis batches and their results
              </CardDescription>
            </CardHeader>
            <CardContent>
              {batches.length === 0 ? (
                <div className="text-center py-12">
                  <Clock className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">No History</h3>
                  <p className="text-muted-foreground">Analysis history will appear here</p>
                </div>
              ) : (
                <ScrollArea className="h-[400px]">
                  <div className="space-y-3">
                    {batches.map(batch => (
                      <div key={batch.id} className="flex items-center justify-between p-4 rounded-lg border">
                        <div className="flex items-center gap-4">
                          <div className="p-2 bg-primary/10 rounded-lg">
                            <Camera className="w-5 h-5 text-primary" />
                          </div>
                          <div>
                            <p className="font-medium">{batch.photoCount || 0} photos</p>
                            <p className="text-sm text-muted-foreground">
                              {format(parseISO(batch.analysisDate || batch.createdAt || new Date().toISOString()), "MMMM d, yyyy")}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          {batch.safetyScore !== undefined && (
                            <div className="text-center">
                              <p className="text-xs text-muted-foreground">Safety</p>
                              <p className="font-bold">{batch.safetyScore}%</p>
                            </div>
                          )}
                          <Badge variant={
                            (batch.status || batch.analysisStatus) === "COMPLETE" ? "secondary" :
                            (batch.status || batch.analysisStatus) === "FAILED" ? "destructive" : "outline"
                          }>
                            {batch.status || batch.analysisStatus}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={reviewDialogOpen} onOpenChange={setReviewDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Review Photo Analysis</DialogTitle>
            <DialogDescription>
              Confirm or dismiss AI findings for this photo
            </DialogDescription>
          </DialogHeader>
          {selectedPhoto && (
            <div className="space-y-4 py-4">
              <div className="aspect-video bg-muted rounded-lg overflow-hidden">
                {selectedPhoto.thumbnailUrl ? (
                  <img 
                    src={selectedPhoto.photoUrl || selectedPhoto.thumbnailUrl} 
                    alt="Jobsite photo" 
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Camera className="w-16 h-16 text-muted-foreground" />
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge>{selectedPhoto.analysisType}</Badge>
                  <span className="text-sm text-muted-foreground">
                    Confidence: {Math.round(selectedPhoto.confidenceScore * 100)}%
                  </span>
                </div>
                <Badge variant={
                  selectedPhoto.reviewStatus === "PENDING" ? "secondary" :
                  selectedPhoto.reviewStatus === "CONFIRMED" ? "default" : "outline"
                }>
                  {selectedPhoto.reviewStatus}
                </Badge>
              </div>

              {selectedPhoto.aiFindings?.safetyIssues && selectedPhoto.aiFindings.safetyIssues.length > 0 && (
                <div>
                  <h4 className="font-medium mb-2">Safety Issues Found:</h4>
                  <div className="space-y-2">
                    {selectedPhoto.aiFindings.safetyIssues.map((issue, idx) => (
                      <div key={idx} className="p-3 rounded-lg border bg-muted/50">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge className={SEVERITY_CONFIG[issue.severity].color}>
                            {issue.severity}
                          </Badge>
                        </div>
                        <p className="text-sm">{issue.description}</p>
                        {issue.recommendation && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Recommendation: {issue.recommendation}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedPhoto.aiFindings?.observations && selectedPhoto.aiFindings.observations.length > 0 && (
                <div>
                  <h4 className="font-medium mb-2">Observations:</h4>
                  <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                    {selectedPhoto.aiFindings.observations.map((obs, idx) => (
                      <li key={idx}>{obs}</li>
                    ))}
                  </ul>
                </div>
              )}

              <Separator />

              <div>
                <h4 className="font-medium mb-2">Review Notes</h4>
                <Textarea
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  placeholder="Add notes about this analysis..."
                  rows={3}
                  data-testid="input-review-notes"
                />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setReviewDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={() => handleSubmitReview("DISMISSED")}
              disabled={reviewMutation.isPending}
            >
              Dismiss
            </Button>
            <Button 
              onClick={() => handleSubmitReview("CONFIRMED")}
              disabled={reviewMutation.isPending}
            >
              {reviewMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4 mr-2" />
              )}
              Confirm Findings
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
