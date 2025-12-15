import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { IssueCapture } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  AlertTriangle, AlertCircle, CheckCircle, Clock, Plus, Camera, MapPin, 
  Tag, Brain, Trash2, Edit, ChevronRight, User, FileText, Activity, XCircle
} from "lucide-react";
import { format } from "date-fns";

interface IssueSummaryStats {
  total: number;
  open: number;
  inProgress: number;
  resolved: number;
  closed: number;
  bySeverity: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
}

export default function IssueCapturesPage() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [severityFilter, setSeverityFilter] = useState<string>("ALL");
  const [selectedIssue, setSelectedIssue] = useState<IssueCapture | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const { data: issues, isLoading } = useQuery<IssueCapture[]>({
    queryKey: ["/api/field-productivity/issue-captures", statusFilter, severityFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      if (severityFilter !== "ALL") params.set("severity", severityFilter);
      const queryString = params.toString();
      return fetch(`/api/field-productivity/issue-captures${queryString ? `?${queryString}` : ""}`, { credentials: "include" }).then(r => r.json());
    },
  });

  const { data: stats } = useQuery<IssueSummaryStats>({
    queryKey: ["/api/field-productivity/issue-captures/stats/summary"],
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/field-productivity/issue-captures/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/field-productivity/issue-captures"] });
      queryClient.invalidateQueries({ queryKey: ["/api/field-productivity/issue-captures/stats/summary"] });
      toast({ title: "Issue deleted" });
      setSelectedIssue(null);
    },
    onError: () => {
      toast({ title: "Failed to delete issue", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<IssueCapture> }) =>
      apiRequest("PATCH", `/api/field-productivity/issue-captures/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/field-productivity/issue-captures"] });
      queryClient.invalidateQueries({ queryKey: ["/api/field-productivity/issue-captures/stats/summary"] });
      toast({ title: "Issue updated" });
    },
    onError: () => {
      toast({ title: "Failed to update issue", variant: "destructive" });
    },
  });

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case "CRITICAL":
        return <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" /> Critical</Badge>;
      case "HIGH":
        return <Badge className="gap-1 bg-orange-500"><AlertCircle className="h-3 w-3" /> High</Badge>;
      case "MEDIUM":
        return <Badge className="gap-1 bg-yellow-500"><AlertCircle className="h-3 w-3" /> Medium</Badge>;
      case "LOW":
        return <Badge variant="secondary" className="gap-1"><AlertCircle className="h-3 w-3" /> Low</Badge>;
      default:
        return <Badge variant="outline">{severity}</Badge>;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "OPEN":
        return <Badge variant="outline" className="gap-1"><Clock className="h-3 w-3" /> Open</Badge>;
      case "IN_PROGRESS":
        return <Badge className="gap-1 bg-blue-500"><Activity className="h-3 w-3" /> In Progress</Badge>;
      case "RESOLVED":
        return <Badge className="gap-1 bg-green-600"><CheckCircle className="h-3 w-3" /> Resolved</Badge>;
      case "CLOSED":
        return <Badge variant="secondary" className="gap-1"><XCircle className="h-3 w-3" /> Closed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="p-6 space-y-6" data-testid="page-issue-captures">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Issue Captures</h1>
          <p className="text-muted-foreground">Document and track field issues</p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)} data-testid="button-create-issue">
          <Plus className="h-4 w-4 mr-2" />
          New Issue
        </Button>
      </div>

      {stats && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Issues</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="stat-total">{stats.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Open</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-500" data-testid="stat-open">{stats.open}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">In Progress</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-500" data-testid="stat-in-progress">{stats.inProgress}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Resolved</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-500" data-testid="stat-resolved">{stats.resolved}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Critical</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-destructive" data-testid="stat-critical">{stats.bySeverity.critical}</div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]" data-testid="select-status-filter">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Status</SelectItem>
            <SelectItem value="OPEN">Open</SelectItem>
            <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
            <SelectItem value="RESOLVED">Resolved</SelectItem>
            <SelectItem value="CLOSED">Closed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={severityFilter} onValueChange={setSeverityFilter}>
          <SelectTrigger className="w-[160px]" data-testid="select-severity-filter">
            <SelectValue placeholder="Filter by severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Severity</SelectItem>
            <SelectItem value="CRITICAL">Critical</SelectItem>
            <SelectItem value="HIGH">High</SelectItem>
            <SelectItem value="MEDIUM">Medium</SelectItem>
            <SelectItem value="LOW">Low</SelectItem>
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
      ) : issues && issues.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {issues.map((issue) => (
            <Card 
              key={issue.id} 
              className="cursor-pointer hover-elevate transition-all"
              onClick={() => setSelectedIssue(issue)}
              data-testid={`card-issue-${issue.id}`}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-base truncate">{issue.title}</CardTitle>
                    <CardDescription className="text-xs">
                      {format(new Date(issue.createdAt), "MMM d, yyyy h:mm a")}
                    </CardDescription>
                  </div>
                  {getSeverityBadge(issue.severity)}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2">
                  {getStatusBadge(issue.status)}
                </div>
                {issue.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {issue.description}
                  </p>
                )}
                {issue.location && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <MapPin className="h-4 w-4" />
                    <span className="truncate">{issue.location}</span>
                  </div>
                )}
                {issue.category && (
                  <Badge variant="outline" className="text-xs">
                    <Tag className="h-3 w-3 mr-1" />
                    {issue.category}
                  </Badge>
                )}
                <div className="flex items-center justify-end text-muted-foreground">
                  <ChevronRight className="h-4 w-4" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="p-12 text-center">
          <Camera className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-medium mb-2">No Issues Captured</h3>
          <p className="text-muted-foreground mb-4">
            Document field issues with photos and descriptions for tracking and resolution.
          </p>
          <Button onClick={() => setShowCreateDialog(true)} data-testid="button-create-first-issue">
            <Plus className="h-4 w-4 mr-2" />
            Create First Issue
          </Button>
        </Card>
      )}

      <IssueDetailDialog 
        issue={selectedIssue} 
        onClose={() => setSelectedIssue(null)}
        onDelete={(id) => deleteMutation.mutate(id)}
        onUpdate={(id, data) => updateMutation.mutate({ id, data })}
        isDeleting={deleteMutation.isPending}
        isUpdating={updateMutation.isPending}
        getSeverityBadge={getSeverityBadge}
        getStatusBadge={getStatusBadge}
      />

      <CreateIssueDialog open={showCreateDialog} onOpenChange={setShowCreateDialog} />
    </div>
  );
}

function IssueDetailDialog({
  issue,
  onClose,
  onDelete,
  onUpdate,
  isDeleting,
  isUpdating,
  getSeverityBadge,
  getStatusBadge,
}: {
  issue: IssueCapture | null;
  onClose: () => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, data: Partial<IssueCapture>) => void;
  isDeleting: boolean;
  isUpdating: boolean;
  getSeverityBadge: (s: string) => JSX.Element;
  getStatusBadge: (s: string) => JSX.Element;
}) {
  if (!issue) return null;

  return (
    <Dialog open={!!issue} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {issue.title}
          </DialogTitle>
          <DialogDescription>
            Created {format(new Date(issue.createdAt), "MMMM d, yyyy 'at' h:mm a")}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh]">
          <Tabs defaultValue="details" className="w-full">
            <TabsList className="mb-4">
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="ai">AI Analysis</TabsTrigger>
              <TabsTrigger value="actions">Actions</TabsTrigger>
            </TabsList>
            
            <TabsContent value="details" className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                {getSeverityBadge(issue.severity)}
                {getStatusBadge(issue.status)}
              </div>

              {issue.description && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Description</Label>
                  <p className="text-sm p-3 bg-muted rounded-lg" data-testid="text-description">
                    {issue.description}
                  </p>
                </div>
              )}

              {issue.location && (
                <div className="flex items-center gap-2 text-sm">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <span>{issue.location}</span>
                </div>
              )}

              {(issue.latitude && issue.longitude) && (
                <div className="text-xs text-muted-foreground">
                  GPS: {issue.latitude.toFixed(6)}, {issue.longitude.toFixed(6)}
                </div>
              )}

              {issue.category && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Category</Label>
                  <Badge variant="outline">{issue.category}</Badge>
                </div>
              )}

              {issue.tradeAffected && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Trade Affected</Label>
                  <span className="text-sm">{issue.tradeAffected}</span>
                </div>
              )}

              {issue.photoUrls && issue.photoUrls.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Photos ({issue.photoUrls.length})</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {issue.photoUrls.map((url, i) => (
                      <img 
                        key={i} 
                        src={url} 
                        alt={`Issue photo ${i + 1}`}
                        className="w-full h-24 object-cover rounded-lg"
                      />
                    ))}
                  </div>
                </div>
              )}

              {issue.resolvedAt && (
                <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg text-sm">
                  <CheckCircle className="h-4 w-4 inline mr-2 text-green-600" />
                  Resolved on {format(new Date(issue.resolvedAt), "MMM d, yyyy h:mm a")}
                </div>
              )}

              {issue.resolutionNotes && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Resolution Notes</Label>
                  <p className="text-sm p-3 bg-muted rounded-lg">
                    {issue.resolutionNotes}
                  </p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="ai" className="space-y-4">
              {issue.aiAnalysis ? (
                <div className="space-y-2">
                  <Label className="text-sm font-medium flex items-center gap-2">
                    <Brain className="h-4 w-4" />
                    AI Analysis
                  </Label>
                  <div className="p-4 bg-primary/5 rounded-lg text-sm border border-primary/10">
                    {issue.aiAnalysis}
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">No AI analysis available</p>
              )}

              {issue.aiRecommendations && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium">AI Recommendations</Label>
                  <div className="p-4 bg-primary/5 rounded-lg text-sm border border-primary/10">
                    {issue.aiRecommendations}
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="actions" className="space-y-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium">Update Status</Label>
                <Select 
                  value={issue.status} 
                  onValueChange={(status) => onUpdate(issue.id, { status: status as any })}
                  disabled={isUpdating}
                >
                  <SelectTrigger data-testid="select-update-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="OPEN">Open</SelectItem>
                    <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                    <SelectItem value="RESOLVED">Resolved</SelectItem>
                    <SelectItem value="CLOSED">Closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">Update Severity</Label>
                <Select 
                  value={issue.severity} 
                  onValueChange={(severity) => onUpdate(issue.id, { severity: severity as any })}
                  disabled={isUpdating}
                >
                  <SelectTrigger data-testid="select-update-severity">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LOW">Low</SelectItem>
                    <SelectItem value="MEDIUM">Medium</SelectItem>
                    <SelectItem value="HIGH">High</SelectItem>
                    <SelectItem value="CRITICAL">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </TabsContent>
          </Tabs>
        </ScrollArea>
        <DialogFooter>
          <Button
            variant="destructive"
            onClick={() => onDelete(issue.id)}
            disabled={isDeleting}
            data-testid="button-delete-issue"
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

function CreateIssueDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState("MEDIUM");
  const [location, setLocation] = useState("");
  const [category, setCategory] = useState("");

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/field-productivity/issue-captures", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/field-productivity/issue-captures"] });
      queryClient.invalidateQueries({ queryKey: ["/api/field-productivity/issue-captures/stats/summary"] });
      toast({ title: "Issue created" });
      onOpenChange(false);
      setTitle("");
      setDescription("");
      setSeverity("MEDIUM");
      setLocation("");
      setCategory("");
    },
    onError: () => {
      toast({ title: "Failed to create issue", variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    if (!title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    createMutation.mutate({
      title,
      description: description || undefined,
      severity,
      status: "OPEN",
      location: location || undefined,
      category: category || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Issue</DialogTitle>
          <DialogDescription>
            Document a field issue for tracking and resolution.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Title *</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Brief description of the issue"
              data-testid="input-title"
            />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Detailed description..."
              rows={3}
              data-testid="input-description"
            />
          </div>
          <div className="space-y-2">
            <Label>Severity</Label>
            <Select value={severity} onValueChange={setSeverity}>
              <SelectTrigger data-testid="select-severity">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="LOW">Low</SelectItem>
                <SelectItem value="MEDIUM">Medium</SelectItem>
                <SelectItem value="HIGH">High</SelectItem>
                <SelectItem value="CRITICAL">Critical</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Location</Label>
            <Input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g., Building A, Floor 2, Room 203"
              data-testid="input-location"
            />
          </div>
          <div className="space-y-2">
            <Label>Category</Label>
            <Input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g., Safety, Quality, Scheduling"
              data-testid="input-category"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel">
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={createMutation.isPending} data-testid="button-submit-issue">
            Create Issue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
