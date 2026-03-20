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
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Sparkles,
  Loader2, 
  CheckCircle2, 
  AlertCircle,
  FileText,
  DollarSign,
  Clock,
  Pencil,
  Copy,
  ChevronRight,
  Zap,
  RefreshCw,
  Upload,
  ArrowRight
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { format, parseISO } from "date-fns";

interface AiCoDraft {
  id: string;
  projectId: string;
  relatedDelayId?: string;
  relatedInspectionId?: string;
  sourceType: "DELAY" | "INSPECTION" | "MANUAL" | "SCOPE_CHANGE";
  aiGeneratedDescription: string;
  aiGeneratedJustification: string;
  suggestedAmount: number;
  suggestedTimeDays?: number;
  confidenceScore: number;
  status: "DRAFT" | "REVIEWED" | "CONVERTED" | "REJECTED";
  finalChangeOrderId?: string;
  createdAt: string;
}

interface AiChangeOrderGeneratorProps {
  projectId: string;
  projectName: string;
  onCreateChangeOrder?: (draft: AiCoDraft) => void;
}

const SOURCE_TYPE_CONFIG = {
  DELAY: { label: "From Delay", color: "bg-yellow-100 text-yellow-700" },
  INSPECTION: { label: "From Inspection", color: "bg-blue-100 text-blue-700" },
  SCOPE_CHANGE: { label: "Scope Change", color: "bg-purple-100 text-purple-700" },
  MANUAL: { label: "Manual Entry", color: "bg-gray-100 text-gray-700" },
};

export default function AiChangeOrderGenerator({ projectId, projectName, onCreateChangeOrder }: AiChangeOrderGeneratorProps) {
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [selectedDraft, setSelectedDraft] = useState<AiCoDraft | null>(null);
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [sourceType, setSourceType] = useState<"DELAY" | "INSPECTION" | "SCOPE_CHANGE" | "MANUAL">("SCOPE_CHANGE");
  const [description, setDescription] = useState("");
  
  const { toast } = useToast();

  interface DraftResponse {
    drafts: AiCoDraft[];
    stats: {
      totalDrafts: number;
      pendingReview: number;
      converted: number;
      totalSuggestedValue: number;
    };
  }

  const { data, isLoading, refetch } = useQuery<DraftResponse>({
    queryKey: ["/api/ai-features/change-order-drafts", projectId],
  });

  const generateMutation = useMutation({
    mutationFn: async (input: { sourceType: string; description?: string; delayId?: string; inspectionId?: string }) => {
      // Build linkedItems object based on sourceType
      const linkedItems: {
        delayIds?: string[];
        inspectionIds?: string[];
        sowItemIds?: string[];
        photoIds?: string[];
        notes?: string;
      } = {};
      
      if (input.delayId) {
        linkedItems.delayIds = [input.delayId];
      }
      if (input.inspectionId) {
        linkedItems.inspectionIds = [input.inspectionId];
      }
      if (input.description) {
        linkedItems.notes = input.description;
      }
      
      const response = await apiRequest("POST", "/api/ai-features/change-orders/generate", {
        projectId,
        linkedItems,
        pricingSource: "MANUAL",
        includeBreakdown: true,
      });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-features/change-order-drafts", projectId] });
      setGenerateDialogOpen(false);
      setDescription("");
      toast({
        title: "Change Order Draft Generated",
        description: `AI has created a draft with suggested amount of $${(data.draft?.subtotals?.total ?? 0).toLocaleString()}`,
      });
      setSelectedDraft(data.draft);
      setReviewDialogOpen(true);
    },
    onError: (error: any) => {
      toast({
        title: "Generation Failed",
        description: error.message || "Failed to generate change order",
        variant: "destructive",
      });
    },
  });

  const updateDraftMutation = useMutation({
    mutationFn: async ({ draftId, status }: { draftId: string; status: string }) => {
      const response = await apiRequest("PATCH", `/api/ai-features/change-order-drafts/${draftId}`, { status });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-features/change-order-drafts", projectId] });
      toast({
        title: "Draft Updated",
        description: "The draft status has been updated",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error.message || "Failed to update draft",
        variant: "destructive",
      });
    },
  });

  const handleGenerate = () => {
    generateMutation.mutate({
      sourceType,
      description: description || undefined,
    });
  };

  const handleConvertToCO = (draft: AiCoDraft) => {
    updateDraftMutation.mutate({ draftId: draft.id, status: "CONVERTED" });
    if (onCreateChangeOrder) {
      onCreateChangeOrder(draft);
    }
    setReviewDialogOpen(false);
    toast({
      title: "Ready to Create",
      description: "Draft data copied. Create a new change order to continue.",
    });
  };

  const handleRejectDraft = (draft: AiCoDraft) => {
    updateDraftMutation.mutate({ draftId: draft.id, status: "REJECTED" });
    setReviewDialogOpen(false);
  };

  const drafts = data?.drafts || [];
  const stats = data?.stats || { totalDrafts: 0, pendingReview: 0, converted: 0, totalSuggestedValue: 0 };
  const pendingDrafts = drafts.filter(d => d.status === "DRAFT" || d.status === "REVIEWED");

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
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            AI Change Order Generator
          </h2>
          <p className="text-muted-foreground text-sm">
            Generate change order drafts from delays, inspections, or scope changes
          </p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <Button variant="outline" onClick={() => refetch()} size="sm" data-testid="button-refresh-drafts" className="flex-1 sm:flex-none">
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Dialog open={generateDialogOpen} onOpenChange={setGenerateDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" data-testid="button-generate-co" className="flex-1 sm:flex-none">
                <Zap className="w-4 h-4 mr-2" />
                Generate Draft
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Generate Change Order Draft</DialogTitle>
                <DialogDescription>
                  AI will analyze project data and generate a change order draft
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div>
                  <Label>Source Type</Label>
                  <Select value={sourceType} onValueChange={(v: typeof sourceType) => setSourceType(v)}>
                    <SelectTrigger data-testid="select-source-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SCOPE_CHANGE">Scope Change</SelectItem>
                      <SelectItem value="DELAY">From Delay Record</SelectItem>
                      <SelectItem value="INSPECTION">From Inspection</SelectItem>
                      <SelectItem value="MANUAL">Manual Entry</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Description</Label>
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Describe the scope change, issue, or circumstance..."
                    rows={4}
                    data-testid="input-co-description"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    AI will use this to generate a professional justification
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setGenerateDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleGenerate} disabled={generateMutation.isPending}>
                  {generateMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-2" />
                      Generate
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
                <FileText className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Drafts</p>
                <p className="text-2xl font-bold">{stats.totalDrafts}</p>
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
                <p className="text-2xl font-bold">{stats.pendingReview}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Converted</p>
                <p className="text-2xl font-bold">{stats.converted}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <DollarSign className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Value</p>
                <p className="text-xl font-bold">${stats.totalSuggestedValue.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">AI-Generated Drafts</CardTitle>
          <CardDescription>
            Review and convert drafts to actual change orders
          </CardDescription>
        </CardHeader>
        <CardContent>
          {pendingDrafts.length === 0 ? (
            <div className="text-center py-12">
              <Sparkles className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Pending Drafts</h3>
              <p className="text-muted-foreground mb-4">
                Generate AI-powered change order drafts from project data
              </p>
              <Button onClick={() => setGenerateDialogOpen(true)}>
                <Zap className="w-4 h-4 mr-2" />
                Generate First Draft
              </Button>
            </div>
          ) : (
            <ScrollArea className="h-[300px]">
              <div className="space-y-3">
                {pendingDrafts.map(draft => (
                  <div
                    key={draft.id}
                    className="flex items-start justify-between p-4 rounded-lg border hover-elevate cursor-pointer"
                    onClick={() => {
                      setSelectedDraft(draft);
                      setReviewDialogOpen(true);
                    }}
                    data-testid={`draft-${draft.id}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge className={SOURCE_TYPE_CONFIG[draft.sourceType].color}>
                          {SOURCE_TYPE_CONFIG[draft.sourceType].label}
                        </Badge>
                        <Badge variant="outline">
                          {Math.round(draft.confidenceScore * 100)}% confidence
                        </Badge>
                      </div>
                      <p className="text-sm line-clamp-2">{draft.aiGeneratedDescription}</p>
                      <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">
                          ${draft.suggestedAmount.toLocaleString()}
                        </span>
                        {draft.suggestedTimeDays && (
                          <span>{draft.suggestedTimeDays} days extension</span>
                        )}
                        <span>{format(parseISO(draft.createdAt), "MMM d, yyyy")}</span>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0 ml-4" />
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      <Dialog open={reviewDialogOpen} onOpenChange={setReviewDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Review AI Draft</DialogTitle>
            <DialogDescription>
              Review the AI-generated change order and convert it to an actual CO
            </DialogDescription>
          </DialogHeader>
          {selectedDraft && (
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-2">
                <Badge className={SOURCE_TYPE_CONFIG[selectedDraft.sourceType].color}>
                  {SOURCE_TYPE_CONFIG[selectedDraft.sourceType].label}
                </Badge>
                <Badge variant="outline">
                  AI Confidence: {Math.round(selectedDraft.confidenceScore * 100)}%
                </Badge>
              </div>

              <div>
                <Label className="text-muted-foreground">Description</Label>
                <p className="mt-1 text-sm bg-muted p-3 rounded-lg">
                  {selectedDraft.aiGeneratedDescription}
                </p>
              </div>

              <div>
                <Label className="text-muted-foreground">Justification</Label>
                <p className="mt-1 text-sm bg-muted p-3 rounded-lg">
                  {selectedDraft.aiGeneratedJustification}
                </p>
              </div>

              <Separator />

              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-lg border">
                  <div className="flex items-center gap-2 mb-2">
                    <DollarSign className="w-4 h-4 text-muted-foreground" />
                    <Label className="text-muted-foreground">Suggested Amount</Label>
                  </div>
                  <p className="text-2xl font-bold">${selectedDraft.suggestedAmount.toLocaleString()}</p>
                </div>
                {selectedDraft.suggestedTimeDays && (
                  <div className="p-4 rounded-lg border">
                    <div className="flex items-center gap-2 mb-2">
                      <Clock className="w-4 h-4 text-muted-foreground" />
                      <Label className="text-muted-foreground">Time Extension</Label>
                    </div>
                    <p className="text-2xl font-bold">{selectedDraft.suggestedTimeDays} days</p>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 p-3 bg-blue-50 rounded-lg text-sm text-blue-700">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>Review and edit the values as needed before creating the change order</span>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="destructive"
              onClick={() => selectedDraft && handleRejectDraft(selectedDraft)}
              disabled={updateDraftMutation.isPending}
            >
              Reject
            </Button>
            <Button variant="outline" onClick={() => setReviewDialogOpen(false)}>
              Close
            </Button>
            <Button
              onClick={() => selectedDraft && handleConvertToCO(selectedDraft)}
              disabled={updateDraftMutation.isPending}
            >
              {updateDraftMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <ArrowRight className="w-4 h-4 mr-2" />
              )}
              Convert to Change Order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
