import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { 
  Star, Plus, TrendingUp, Building2, Award, Clock, MessageSquare, 
  DollarSign, Shield, Trash2, Edit, Users
} from "lucide-react";
import { format } from "date-fns";

interface VendorScoreData {
  score: {
    id: string;
    organizationId: string;
    crmEntityId: string;
    projectId: string | null;
    scoreCategory: string;
    onTimeDeliveryScore: string | null;
    qualityScore: string | null;
    communicationScore: string | null;
    priceCompetitivenessScore: string | null;
    reliabilityScore: string | null;
    overallScore: string | null;
    notes: string | null;
    scoreDate: string;
    scoredById: string;
  };
  vendor: { id: string; name: string; type: string } | null;
  project: { id: string; name: string; code: string } | null;
  scoredBy: { id: string; firstName: string; lastName: string } | null;
}

interface VendorSummary {
  vendorId: string;
  vendorName: string;
  vendorType: string;
  avgOnTimeDelivery: string;
  avgQuality: string;
  avgCommunication: string;
  avgPriceCompetitiveness: string;
  avgReliability: string;
  avgOverall: string;
  scoreCount: number;
}

interface CRMEntity {
  id: string;
  name: string;
  type: string;
}

interface Project {
  id: string;
  name: string;
  code: string;
}

export default function VendorScoresPage() {
  const { toast } = useToast();
  const [vendorFilter, setVendorFilter] = useState<string>("ALL");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedScore, setSelectedScore] = useState<VendorScoreData | null>(null);
  const [activeTab, setActiveTab] = useState("scores");

  const { data: scores, isLoading } = useQuery<VendorScoreData[]>({
    queryKey: ["/api/marketplace/vendor-scores", vendorFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (vendorFilter !== "ALL") params.set("vendorId", vendorFilter);
      const queryString = params.toString();
      return fetch(`/api/marketplace/vendor-scores${queryString ? `?${queryString}` : ""}`, { credentials: "include" }).then(r => r.json());
    },
  });

  const { data: summary } = useQuery<VendorSummary[]>({
    queryKey: ["/api/marketplace/vendor-scores/summary/by-vendor"],
  });

  const { data: vendors } = useQuery<CRMEntity[]>({
    queryKey: ["/api/crm"],
    queryFn: () => fetch("/api/crm", { credentials: "include" }).then(r => r.json()),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/marketplace/vendor-scores/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace/vendor-scores"] });
      toast({ title: "Score deleted" });
      setSelectedScore(null);
    },
    onError: () => {
      toast({ title: "Failed to delete score", variant: "destructive" });
    },
  });

  const getScoreColor = (score: number) => {
    if (score >= 4) return "text-green-500";
    if (score >= 3) return "text-yellow-500";
    if (score >= 2) return "text-orange-500";
    return "text-destructive";
  };

  const renderStars = (score: string | null) => {
    if (!score) return <span className="text-muted-foreground text-sm">N/A</span>;
    const num = parseFloat(score);
    return (
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={`h-4 w-4 ${star <= num ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`}
          />
        ))}
        <span className={`ml-1 text-sm font-medium ${getScoreColor(num)}`}>
          {num.toFixed(1)}
        </span>
      </div>
    );
  };

  return (
    <div className="p-6 space-y-6" data-testid="page-vendor-scores">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Vendor Scoring</h1>
          <p className="text-muted-foreground">Rate and track vendor performance</p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)} data-testid="button-create-score">
          <Plus className="h-4 w-4 mr-2" />
          New Score
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="scores" data-testid="tab-scores">Individual Scores</TabsTrigger>
          <TabsTrigger value="summary" data-testid="tab-summary">Vendor Summary</TabsTrigger>
        </TabsList>

        <TabsContent value="scores" className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Select value={vendorFilter} onValueChange={setVendorFilter}>
              <SelectTrigger className="w-[200px]" data-testid="select-vendor-filter">
                <SelectValue placeholder="Filter by vendor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Vendors</SelectItem>
                {vendors?.filter(v => ["SUBCONTRACTOR", "SUPPLIER", "VENDOR"].includes(v.type)).map((vendor) => (
                  <SelectItem key={vendor.id} value={vendor.id}>{vendor.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <Card key={i}>
                  <CardHeader>
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-4 w-24" />
                  </CardHeader>
                  <CardContent>
                    <Skeleton className="h-16 w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : scores && scores.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {scores.map((item) => (
                <Card 
                  key={item.score.id} 
                  className="cursor-pointer hover-elevate transition-all"
                  onClick={() => setSelectedScore(item)}
                  data-testid={`card-score-${item.score.id}`}
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-base truncate flex items-center gap-2">
                          <Building2 className="h-4 w-4" />
                          {item.vendor?.name || "Unknown Vendor"}
                        </CardTitle>
                        <CardDescription className="text-xs">
                          {format(new Date(item.score.scoreDate), "MMM d, yyyy")}
                        </CardDescription>
                      </div>
                      <Badge variant="outline">{item.score.scoreCategory}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Overall</span>
                      {renderStars(item.score.overallScore)}
                    </div>
                    {item.project && (
                      <div className="text-xs text-muted-foreground">
                        Project: {item.project.name}
                      </div>
                    )}
                    {item.scoredBy && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Users className="h-3 w-3" />
                        {item.scoredBy.firstName} {item.scoredBy.lastName}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="p-12 text-center">
              <Award className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium mb-2">No Vendor Scores</h3>
              <p className="text-muted-foreground mb-4">
                Start rating your vendors to track performance over time.
              </p>
              <Button onClick={() => setShowCreateDialog(true)} data-testid="button-create-first-score">
                <Plus className="h-4 w-4 mr-2" />
                Create First Score
              </Button>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="summary" className="space-y-4">
          {summary && summary.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              {summary.map((vendor) => (
                <Card key={vendor.vendorId} data-testid={`card-summary-${vendor.vendorId}`}>
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <CardTitle className="text-lg flex items-center gap-2">
                          <Building2 className="h-5 w-5" />
                          {vendor.vendorName}
                        </CardTitle>
                        <CardDescription>{vendor.vendorType} - {vendor.scoreCount} reviews</CardDescription>
                      </div>
                      <div className="text-right">
                        <div className="text-2xl font-bold text-primary">
                          {parseFloat(vendor.avgOverall).toFixed(1)}
                        </div>
                        <div className="text-xs text-muted-foreground">Overall</div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <Clock className="h-3 w-3" /> On-Time
                        </span>
                        <span className={getScoreColor(parseFloat(vendor.avgOnTimeDelivery))}>
                          {parseFloat(vendor.avgOnTimeDelivery).toFixed(1)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <Award className="h-3 w-3" /> Quality
                        </span>
                        <span className={getScoreColor(parseFloat(vendor.avgQuality))}>
                          {parseFloat(vendor.avgQuality).toFixed(1)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <MessageSquare className="h-3 w-3" /> Comm.
                        </span>
                        <span className={getScoreColor(parseFloat(vendor.avgCommunication))}>
                          {parseFloat(vendor.avgCommunication).toFixed(1)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <DollarSign className="h-3 w-3" /> Price
                        </span>
                        <span className={getScoreColor(parseFloat(vendor.avgPriceCompetitiveness))}>
                          {parseFloat(vendor.avgPriceCompetitiveness).toFixed(1)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between col-span-2">
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <Shield className="h-3 w-3" /> Reliability
                        </span>
                        <span className={getScoreColor(parseFloat(vendor.avgReliability))}>
                          {parseFloat(vendor.avgReliability).toFixed(1)}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="p-12 text-center">
              <TrendingUp className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium mb-2">No Summary Data</h3>
              <p className="text-muted-foreground">
                Add vendor scores to see aggregated performance metrics.
              </p>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <ScoreDetailDialog 
        score={selectedScore}
        onClose={() => setSelectedScore(null)}
        onDelete={(id) => deleteMutation.mutate(id)}
        isDeleting={deleteMutation.isPending}
        renderStars={renderStars}
      />

      <CreateScoreDialog 
        open={showCreateDialog} 
        onOpenChange={setShowCreateDialog}
        vendors={vendors || []}
      />
    </div>
  );
}

function ScoreDetailDialog({
  score,
  onClose,
  onDelete,
  isDeleting,
  renderStars,
}: {
  score: VendorScoreData | null;
  onClose: () => void;
  onDelete: (id: string) => void;
  isDeleting: boolean;
  renderStars: (s: string | null) => JSX.Element;
}) {
  if (!score) return null;

  return (
    <Dialog open={!!score} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Award className="h-5 w-5" />
            {score.vendor?.name || "Unknown Vendor"}
          </DialogTitle>
          <DialogDescription>
            Scored on {format(new Date(score.score.scoreDate), "MMMM d, yyyy")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-sm text-muted-foreground">On-Time Delivery</Label>
              {renderStars(score.score.onTimeDeliveryScore)}
            </div>
            <div>
              <Label className="text-sm text-muted-foreground">Quality</Label>
              {renderStars(score.score.qualityScore)}
            </div>
            <div>
              <Label className="text-sm text-muted-foreground">Communication</Label>
              {renderStars(score.score.communicationScore)}
            </div>
            <div>
              <Label className="text-sm text-muted-foreground">Price Competitiveness</Label>
              {renderStars(score.score.priceCompetitivenessScore)}
            </div>
            <div>
              <Label className="text-sm text-muted-foreground">Reliability</Label>
              {renderStars(score.score.reliabilityScore)}
            </div>
            <div>
              <Label className="text-sm text-muted-foreground">Overall</Label>
              {renderStars(score.score.overallScore)}
            </div>
          </div>

          {score.project && (
            <div>
              <Label className="text-sm text-muted-foreground">Project</Label>
              <p className="text-sm">{score.project.name} ({score.project.code})</p>
            </div>
          )}

          {score.score.notes && (
            <div>
              <Label className="text-sm text-muted-foreground">Notes</Label>
              <p className="text-sm p-3 bg-muted rounded-lg">{score.score.notes}</p>
            </div>
          )}

          {score.scoredBy && (
            <div className="text-sm text-muted-foreground">
              Scored by: {score.scoredBy.firstName} {score.scoredBy.lastName}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="destructive"
            onClick={() => onDelete(score.score.id)}
            disabled={isDeleting}
            data-testid="button-delete-score"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </Button>
          <Button variant="outline" onClick={onClose} data-testid="button-close-dialog">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateScoreDialog({ 
  open, 
  onOpenChange,
  vendors 
}: { 
  open: boolean; 
  onOpenChange: (open: boolean) => void;
  vendors: CRMEntity[];
}) {
  const { toast } = useToast();
  const [vendorId, setVendorId] = useState("");
  const [category, setCategory] = useState("DELIVERY");
  const [onTimeDelivery, setOnTimeDelivery] = useState([3]);
  const [quality, setQuality] = useState([3]);
  const [communication, setCommunication] = useState([3]);
  const [priceCompetitiveness, setPriceCompetitiveness] = useState([3]);
  const [reliability, setReliability] = useState([3]);
  const [notes, setNotes] = useState("");

  const { data: projects } = useQuery<Project[]>({
    queryKey: ["/api/projects"],
    enabled: open,
  });

  const [projectId, setProjectId] = useState("");

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/marketplace/vendor-scores", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace/vendor-scores"] });
      toast({ title: "Score created" });
      onOpenChange(false);
      resetForm();
    },
    onError: () => {
      toast({ title: "Failed to create score", variant: "destructive" });
    },
  });

  const resetForm = () => {
    setVendorId("");
    setProjectId("");
    setCategory("DELIVERY");
    setOnTimeDelivery([3]);
    setQuality([3]);
    setCommunication([3]);
    setPriceCompetitiveness([3]);
    setReliability([3]);
    setNotes("");
  };

  const handleSubmit = () => {
    if (!vendorId) {
      toast({ title: "Please select a vendor", variant: "destructive" });
      return;
    }
    createMutation.mutate({
      crmEntityId: vendorId,
      projectId: projectId || undefined,
      scoreCategory: category,
      onTimeDeliveryScore: onTimeDelivery[0].toString(),
      qualityScore: quality[0].toString(),
      communicationScore: communication[0].toString(),
      priceCompetitivenessScore: priceCompetitiveness[0].toString(),
      reliabilityScore: reliability[0].toString(),
      notes: notes || undefined,
      scoreDate: new Date().toISOString(),
    });
  };

  const vendorList = vendors.filter(v => ["SUBCONTRACTOR", "SUPPLIER", "VENDOR"].includes(v.type));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New Vendor Score</DialogTitle>
          <DialogDescription>
            Rate a vendor's performance on your project.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
          <div className="space-y-2">
            <Label>Vendor *</Label>
            <Select value={vendorId} onValueChange={setVendorId}>
              <SelectTrigger data-testid="select-vendor">
                <SelectValue placeholder="Select vendor" />
              </SelectTrigger>
              <SelectContent>
                {vendorList.map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Project (optional)</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger data-testid="select-project">
                <SelectValue placeholder="Select project" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">No Project</SelectItem>
                {projects?.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger data-testid="select-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="DELIVERY">Delivery</SelectItem>
                <SelectItem value="QUALITY">Quality</SelectItem>
                <SelectItem value="SERVICE">Service</SelectItem>
                <SelectItem value="OVERALL">Overall</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3">
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label>On-Time Delivery</Label>
                <span className="text-sm font-medium">{onTimeDelivery[0]}/5</span>
              </div>
              <Slider
                value={onTimeDelivery}
                onValueChange={setOnTimeDelivery}
                min={1}
                max={5}
                step={1}
                data-testid="slider-on-time"
              />
            </div>

            <div className="space-y-2">
              <div className="flex justify-between">
                <Label>Quality</Label>
                <span className="text-sm font-medium">{quality[0]}/5</span>
              </div>
              <Slider
                value={quality}
                onValueChange={setQuality}
                min={1}
                max={5}
                step={1}
                data-testid="slider-quality"
              />
            </div>

            <div className="space-y-2">
              <div className="flex justify-between">
                <Label>Communication</Label>
                <span className="text-sm font-medium">{communication[0]}/5</span>
              </div>
              <Slider
                value={communication}
                onValueChange={setCommunication}
                min={1}
                max={5}
                step={1}
                data-testid="slider-communication"
              />
            </div>

            <div className="space-y-2">
              <div className="flex justify-between">
                <Label>Price Competitiveness</Label>
                <span className="text-sm font-medium">{priceCompetitiveness[0]}/5</span>
              </div>
              <Slider
                value={priceCompetitiveness}
                onValueChange={setPriceCompetitiveness}
                min={1}
                max={5}
                step={1}
                data-testid="slider-price"
              />
            </div>

            <div className="space-y-2">
              <div className="flex justify-between">
                <Label>Reliability</Label>
                <span className="text-sm font-medium">{reliability[0]}/5</span>
              </div>
              <Slider
                value={reliability}
                onValueChange={setReliability}
                min={1}
                max={5}
                step={1}
                data-testid="slider-reliability"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional comments..."
              rows={3}
              data-testid="input-notes"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={createMutation.isPending} data-testid="button-submit-score">
            {createMutation.isPending ? "Saving..." : "Save Score"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
