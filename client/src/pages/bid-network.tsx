import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Plus, Send, Eye, Clock, CheckCircle, XCircle, Users, FileText, Calendar as CalendarIcon, DollarSign, Building2, ChevronRight, AlertCircle, Settings } from "lucide-react";
import { format, parseISO } from "date-fns";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const TRADE_OPTIONS = [
  "GENERAL_CONTRACTOR", "ELECTRICAL", "PLUMBING", "HVAC", "ROOFING", "CONCRETE",
  "FRAMING", "DRYWALL", "PAINTING", "FLOORING", "LANDSCAPING", "DEMOLITION",
  "MASONRY", "INSULATION", "WINDOWS_DOORS", "SIDING", "TILE", "CABINETRY",
  "COUNTERTOPS", "FENCING", "DECKING", "SOLAR", "OTHER"
];

interface BidRequest {
  id: string;
  title: string;
  description: string;
  scopeOfWork: string;
  requiredTrades: string[];
  bidDueDate: string;
  projectStartDate?: string;
  projectEndDate?: string;
  projectAddress?: string;
  projectCity?: string;
  projectState?: string;
  budgetRangeMin?: number;
  budgetRangeMax?: number;
  showBudgetToSubs: boolean;
  requiresBonding: boolean;
  requiresInsurance: boolean;
  status: "DRAFT" | "OPEN" | "CLOSED" | "AWARDED" | "CANCELLED";
  viewCount: number;
  inviteCount: number;
  responseCount: number;
  createdAt: string;
  project?: { id: string; name: string; code: string };
}

interface NetworkSettings {
  isNetworkEnabled: boolean;
  canReceiveBidInvites: boolean;
  canSendBidRequests: boolean;
  tradeSpecialties: string[];
  notifyByEmail: boolean;
  notifyInApp: boolean;
  exists: boolean;
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, { color: string; icon: JSX.Element }> = {
    DRAFT: { color: "bg-muted text-muted-foreground", icon: <FileText className="w-3 h-3" /> },
    OPEN: { color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200", icon: <Send className="w-3 h-3" /> },
    CLOSED: { color: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200", icon: <Clock className="w-3 h-3" /> },
    AWARDED: { color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200", icon: <CheckCircle className="w-3 h-3" /> },
    CANCELLED: { color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200", icon: <XCircle className="w-3 h-3" /> },
  };
  const v = variants[status] || variants.DRAFT;
  return (
    <Badge className={`${v.color} gap-1`}>
      {v.icon}
      {status}
    </Badge>
  );
}

function CreateBidRequestDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    scopeOfWork: "",
    requiredTrades: [] as string[],
    bidDueDate: "",
    projectStartDate: "",
    projectAddress: "",
    projectCity: "",
    projectState: "",
    budgetRangeMin: "",
    budgetRangeMax: "",
    showBudgetToSubs: false,
    requiresBonding: false,
    requiresInsurance: true,
    specialRequirements: "",
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await apiRequest("POST", "/api/bid-network/requests", {
        ...data,
        budgetRangeMin: data.budgetRangeMin ? parseFloat(data.budgetRangeMin) : null,
        budgetRangeMax: data.budgetRangeMax ? parseFloat(data.budgetRangeMax) : null,
        status: "DRAFT",
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Bid request created", description: "Your bid request has been saved as a draft." });
      setOpen(false);
      onSuccess();
      setFormData({
        title: "", description: "", scopeOfWork: "", requiredTrades: [], bidDueDate: "",
        projectStartDate: "", projectAddress: "", projectCity: "", projectState: "",
        budgetRangeMin: "", budgetRangeMax: "", showBudgetToSubs: false,
        requiresBonding: false, requiresInsurance: true, specialRequirements: "",
      });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create bid request", variant: "destructive" });
    },
  });

  const handleTradeToggle = (trade: string) => {
    setFormData(prev => ({
      ...prev,
      requiredTrades: prev.requiredTrades.includes(trade)
        ? prev.requiredTrades.filter(t => t !== trade)
        : [...prev.requiredTrades, trade]
    }));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="button-create-bid-request">
          <Plus className="w-4 h-4 mr-2" />
          New Bid Request
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Bid Request</DialogTitle>
          <DialogDescription>
            Create a new bid solicitation to send to subcontractors on the network.
          </DialogDescription>
        </DialogHeader>
        
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="title">Title *</Label>
            <Input
              id="title"
              placeholder="e.g., Electrical Work for Commercial Building"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              data-testid="input-bid-title"
            />
          </div>
          
          <div className="grid gap-2">
            <Label htmlFor="description">Project Description</Label>
            <Textarea
              id="description"
              placeholder="Describe the project and context..."
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              data-testid="input-bid-description"
            />
          </div>
          
          <div className="grid gap-2">
            <Label htmlFor="scopeOfWork">Scope of Work *</Label>
            <Textarea
              id="scopeOfWork"
              placeholder="Detail the specific work required..."
              className="min-h-[100px]"
              value={formData.scopeOfWork}
              onChange={(e) => setFormData({ ...formData, scopeOfWork: e.target.value })}
              data-testid="input-bid-scope"
            />
          </div>
          
          <div className="grid gap-2">
            <Label>Required Trades *</Label>
            <div className="flex flex-wrap gap-2">
              {TRADE_OPTIONS.map(trade => (
                <Badge
                  key={trade}
                  variant={formData.requiredTrades.includes(trade) ? "default" : "outline"}
                  className="cursor-pointer"
                  onClick={() => handleTradeToggle(trade)}
                  data-testid={`badge-trade-${trade.toLowerCase()}`}
                >
                  {trade.replace(/_/g, " ")}
                </Badge>
              ))}
            </div>
          </div>
          
          <Separator />
          
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="bidDueDate">Bid Due Date *</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !formData.bidDueDate && "text-muted-foreground"
                    )}
                    data-testid="input-bid-due-date"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {formData.bidDueDate ? format(new Date(formData.bidDueDate), "PPP p") : "Pick a date and time"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarPicker
                    mode="single"
                    selected={formData.bidDueDate ? new Date(formData.bidDueDate) : undefined}
                    onSelect={(date) => setFormData({ ...formData, bidDueDate: date ? format(date, "yyyy-MM-dd'T'HH:mm") : "" })}
                    initialFocus
                  />
                  <div className="p-3 border-t">
                    <Label className="text-xs text-muted-foreground">Time</Label>
                    <Input
                      type="time"
                      value={formData.bidDueDate ? formData.bidDueDate.split('T')[1] || "" : ""}
                      onChange={(e) => {
                        const date = formData.bidDueDate ? formData.bidDueDate.split('T')[0] : format(new Date(), "yyyy-MM-dd");
                        setFormData({ ...formData, bidDueDate: `${date}T${e.target.value}` });
                      }}
                      className="mt-1"
                    />
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="projectStartDate">Project Start Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !formData.projectStartDate && "text-muted-foreground"
                    )}
                    data-testid="input-project-start-date"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {formData.projectStartDate ? format(parseISO(formData.projectStartDate), "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarPicker
                    mode="single"
                    selected={formData.projectStartDate ? parseISO(formData.projectStartDate) : undefined}
                    onSelect={(date) => setFormData({ ...formData, projectStartDate: date ? format(date, "yyyy-MM-dd") : "" })}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>
          
          <div className="grid grid-cols-3 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="projectAddress">Address</Label>
              <Input
                id="projectAddress"
                placeholder="Street address"
                value={formData.projectAddress}
                onChange={(e) => setFormData({ ...formData, projectAddress: e.target.value })}
                data-testid="input-project-address"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="projectCity">City</Label>
              <Input
                id="projectCity"
                placeholder="City"
                value={formData.projectCity}
                onChange={(e) => setFormData({ ...formData, projectCity: e.target.value })}
                data-testid="input-project-city"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="projectState">State</Label>
              <Input
                id="projectState"
                placeholder="State"
                value={formData.projectState}
                onChange={(e) => setFormData({ ...formData, projectState: e.target.value })}
                data-testid="input-project-state"
              />
            </div>
          </div>
          
          <Separator />
          
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="budgetMin">Budget Range Min ($)</Label>
              <Input
                id="budgetMin"
                type="number"
                placeholder="0"
                value={formData.budgetRangeMin}
                onChange={(e) => setFormData({ ...formData, budgetRangeMin: e.target.value })}
                data-testid="input-budget-min"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="budgetMax">Budget Range Max ($)</Label>
              <Input
                id="budgetMax"
                type="number"
                placeholder="0"
                value={formData.budgetRangeMax}
                onChange={(e) => setFormData({ ...formData, budgetRangeMax: e.target.value })}
                data-testid="input-budget-max"
              />
            </div>
          </div>
          
          <div className="flex items-center justify-between">
            <Label htmlFor="showBudget">Show budget range to subcontractors</Label>
            <Switch
              id="showBudget"
              checked={formData.showBudgetToSubs}
              onCheckedChange={(checked) => setFormData({ ...formData, showBudgetToSubs: checked })}
              data-testid="switch-show-budget"
            />
          </div>
          
          <Separator />
          
          <div className="flex items-center justify-between">
            <Label htmlFor="requiresBonding">Requires Bonding</Label>
            <Switch
              id="requiresBonding"
              checked={formData.requiresBonding}
              onCheckedChange={(checked) => setFormData({ ...formData, requiresBonding: checked })}
              data-testid="switch-requires-bonding"
            />
          </div>
          
          <div className="flex items-center justify-between">
            <Label htmlFor="requiresInsurance">Requires Insurance</Label>
            <Switch
              id="requiresInsurance"
              checked={formData.requiresInsurance}
              onCheckedChange={(checked) => setFormData({ ...formData, requiresInsurance: checked })}
              data-testid="switch-requires-insurance"
            />
          </div>
          
          <div className="grid gap-2">
            <Label htmlFor="specialRequirements">Special Requirements</Label>
            <Textarea
              id="specialRequirements"
              placeholder="Any additional requirements or qualifications..."
              value={formData.specialRequirements}
              onChange={(e) => setFormData({ ...formData, specialRequirements: e.target.value })}
              data-testid="input-special-requirements"
            />
          </div>
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} data-testid="button-cancel-create">
            Cancel
          </Button>
          <Button
            onClick={() => createMutation.mutate(formData)}
            disabled={!formData.title || !formData.scopeOfWork || formData.requiredTrades.length === 0 || !formData.bidDueDate || createMutation.isPending}
            data-testid="button-save-draft"
          >
            {createMutation.isPending ? "Saving..." : "Save as Draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BidRequestCard({ request, onRefresh }: { request: BidRequest; onRefresh: () => void }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  
  const publishMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/bid-network/requests/${request.id}`, { status: "OPEN" });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Bid request published", description: "Subcontractors can now view and respond to this request." });
      onRefresh();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to publish bid request", variant: "destructive" });
    },
  });
  
  const closeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/bid-network/requests/${request.id}`, { status: "CLOSED" });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Bid request closed", description: "No more responses will be accepted." });
      onRefresh();
    },
  });

  return (
    <Card className="hover-elevate cursor-pointer" onClick={() => navigate(`/bid-network/${request.id}`)} data-testid={`card-bid-request-${request.id}`}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-lg truncate">{request.title}</CardTitle>
            <CardDescription className="line-clamp-2 mt-1">
              {request.description || request.scopeOfWork}
            </CardDescription>
          </div>
          <StatusBadge status={request.status} />
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-1 mb-3">
          {request.requiredTrades.slice(0, 3).map(trade => (
            <Badge key={trade} variant="secondary" className="text-xs">
              {trade.replace(/_/g, " ")}
            </Badge>
          ))}
          {request.requiredTrades.length > 3 && (
            <Badge variant="secondary" className="text-xs">+{request.requiredTrades.length - 3}</Badge>
          )}
        </div>
        
        <div className="grid grid-cols-3 gap-2 text-sm text-muted-foreground mb-3">
          <div className="flex items-center gap-1">
            <Eye className="w-3 h-3" />
            <span>{request.viewCount} views</span>
          </div>
          <div className="flex items-center gap-1">
            <Users className="w-3 h-3" />
            <span>{request.inviteCount} invited</span>
          </div>
          <div className="flex items-center gap-1">
            <FileText className="w-3 h-3" />
            <span>{request.responseCount} responses</span>
          </div>
        </div>
        
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-1 text-muted-foreground">
            <Calendar className="w-3 h-3" />
            <span>Due: {format(new Date(request.bidDueDate), "MMM d, yyyy")}</span>
          </div>
          
          <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
            {request.status === "DRAFT" && (
              <Button
                size="sm"
                onClick={() => publishMutation.mutate()}
                disabled={publishMutation.isPending}
                data-testid={`button-publish-${request.id}`}
              >
                <Send className="w-3 h-3 mr-1" />
                Publish
              </Button>
            )}
            {request.status === "OPEN" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => closeMutation.mutate()}
                disabled={closeMutation.isPending}
                data-testid={`button-close-${request.id}`}
              >
                Close Bidding
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function NetworkSettingsDialog() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  
  const settingsDialogUrl = `/api/bid-network/settings/${user?.organizationId}`;
  const { data: settings, refetch } = useQuery<NetworkSettings>({
    queryKey: [settingsDialogUrl],
    enabled: !!user?.organizationId,
  });
  
  const [formData, setFormData] = useState({
    isNetworkEnabled: true,
    canReceiveBidInvites: true,
    canSendBidRequests: true,
    notifyByEmail: true,
    notifyInApp: true,
  });
  
  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await apiRequest("POST", "/api/bid-network/settings", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Settings saved" });
      refetch();
      setOpen(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save settings", variant: "destructive" });
    },
  });
  
  const handleOpen = (isOpen: boolean) => {
    if (isOpen && settings) {
      setFormData({
        isNetworkEnabled: settings.isNetworkEnabled ?? true,
        canReceiveBidInvites: settings.canReceiveBidInvites ?? true,
        canSendBidRequests: settings.canSendBidRequests ?? true,
        notifyByEmail: settings.notifyByEmail ?? true,
        notifyInApp: settings.notifyInApp ?? true,
      });
    }
    setOpen(isOpen);
  };
  
  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" data-testid="button-network-settings">
          <Settings className="w-4 h-4 mr-2" />
          Network Settings
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bid Network Settings</DialogTitle>
          <DialogDescription>
            Configure how your organization participates in the subcontractor bid network.
          </DialogDescription>
        </DialogHeader>
        
        <div className="grid gap-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>Enable Network Participation</Label>
              <p className="text-sm text-muted-foreground">Allow your org to participate in the bid network</p>
            </div>
            <Switch
              checked={formData.isNetworkEnabled}
              onCheckedChange={(checked) => setFormData({ ...formData, isNetworkEnabled: checked })}
              data-testid="switch-network-enabled"
            />
          </div>
          
          <Separator />
          
          <div className="flex items-center justify-between">
            <div>
              <Label>Can Send Bid Requests</Label>
              <p className="text-sm text-muted-foreground">Allow sending bid solicitations to subs</p>
            </div>
            <Switch
              checked={formData.canSendBidRequests}
              onCheckedChange={(checked) => setFormData({ ...formData, canSendBidRequests: checked })}
              data-testid="switch-can-send"
            />
          </div>
          
          <div className="flex items-center justify-between">
            <div>
              <Label>Can Receive Bid Invites</Label>
              <p className="text-sm text-muted-foreground">Allow receiving invitations from GCs</p>
            </div>
            <Switch
              checked={formData.canReceiveBidInvites}
              onCheckedChange={(checked) => setFormData({ ...formData, canReceiveBidInvites: checked })}
              data-testid="switch-can-receive"
            />
          </div>
          
          <Separator />
          
          <div className="flex items-center justify-between">
            <div>
              <Label>Email Notifications</Label>
              <p className="text-sm text-muted-foreground">Receive bid notifications via email</p>
            </div>
            <Switch
              checked={formData.notifyByEmail}
              onCheckedChange={(checked) => setFormData({ ...formData, notifyByEmail: checked })}
              data-testid="switch-notify-email"
            />
          </div>
          
          <div className="flex items-center justify-between">
            <div>
              <Label>In-App Notifications</Label>
              <p className="text-sm text-muted-foreground">Receive bid notifications in the app</p>
            </div>
            <Switch
              checked={formData.notifyInApp}
              onCheckedChange={(checked) => setFormData({ ...formData, notifyInApp: checked })}
              data-testid="switch-notify-app"
            />
          </div>
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => saveMutation.mutate(formData)} disabled={saveMutation.isPending} data-testid="button-save-settings">
            {saveMutation.isPending ? "Saving..." : "Save Settings"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function BidNetworkPage() {
  const { user } = useAuth();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  
  const requestsUrl = statusFilter !== "all" 
    ? `/api/bid-network/requests?status=${statusFilter}` 
    : "/api/bid-network/requests";
  
  const { data: requests = [], isLoading, refetch } = useQuery<BidRequest[]>({
    queryKey: [requestsUrl],
  });
  
  const settingsUrl = `/api/bid-network/settings/${user?.organizationId}`;
  const { data: settings } = useQuery<NetworkSettings>({
    queryKey: [settingsUrl],
    enabled: !!user?.organizationId,
  });
  
  const canSend = settings?.canSendBidRequests !== false;
  
  const draftCount = requests.filter(r => r.status === "DRAFT").length;
  const openCount = requests.filter(r => r.status === "OPEN").length;
  const closedCount = requests.filter(r => r.status === "CLOSED").length;
  const awardedCount = requests.filter(r => r.status === "AWARDED").length;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Bid Network</h1>
          <p className="text-muted-foreground">Manage bid solicitations to subcontractors</p>
        </div>
        <div className="flex gap-2">
          <NetworkSettingsDialog />
          {canSend ? (
            <CreateBidRequestDialog onSuccess={() => refetch()} />
          ) : (
            <Button disabled>
              <AlertCircle className="w-4 h-4 mr-2" />
              Sending Disabled
            </Button>
          )}
        </div>
      </div>
      
      <div className="grid grid-cols-4 gap-4">
        <Card className="cursor-pointer hover-elevate" onClick={() => setStatusFilter("DRAFT")} data-testid="card-stat-draft">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{draftCount}</p>
                <p className="text-sm text-muted-foreground">Drafts</p>
              </div>
              <FileText className="w-8 h-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover-elevate" onClick={() => setStatusFilter("OPEN")} data-testid="card-stat-open">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{openCount}</p>
                <p className="text-sm text-muted-foreground">Open</p>
              </div>
              <Send className="w-8 h-8 text-green-500" />
            </div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover-elevate" onClick={() => setStatusFilter("CLOSED")} data-testid="card-stat-closed">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{closedCount}</p>
                <p className="text-sm text-muted-foreground">Closed</p>
              </div>
              <Clock className="w-8 h-8 text-amber-500" />
            </div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover-elevate" onClick={() => setStatusFilter("AWARDED")} data-testid="card-stat-awarded">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{awardedCount}</p>
                <p className="text-sm text-muted-foreground">Awarded</p>
              </div>
              <CheckCircle className="w-8 h-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>
      </div>
      
      <Tabs value={statusFilter} onValueChange={setStatusFilter}>
        <TabsList>
          <TabsTrigger value="all" data-testid="tab-all">All ({requests.length})</TabsTrigger>
          <TabsTrigger value="DRAFT" data-testid="tab-draft">Draft ({draftCount})</TabsTrigger>
          <TabsTrigger value="OPEN" data-testid="tab-open">Open ({openCount})</TabsTrigger>
          <TabsTrigger value="CLOSED" data-testid="tab-closed">Closed ({closedCount})</TabsTrigger>
          <TabsTrigger value="AWARDED" data-testid="tab-awarded">Awarded ({awardedCount})</TabsTrigger>
        </TabsList>
      </Tabs>
      
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <Card key={i} className="animate-pulse">
              <CardHeader>
                <div className="h-6 bg-muted rounded w-3/4" />
                <div className="h-4 bg-muted rounded w-1/2 mt-2" />
              </CardHeader>
              <CardContent>
                <div className="h-20 bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : requests.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Building2 className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No bid requests yet</h3>
            <p className="text-muted-foreground text-center mb-4">
              Create your first bid request to start soliciting quotes from subcontractors.
            </p>
            {canSend && <CreateBidRequestDialog onSuccess={() => refetch()} />}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {requests.map(request => (
            <BidRequestCard key={request.id} request={request} onRefresh={() => refetch()} />
          ))}
        </div>
      )}
    </div>
  );
}
