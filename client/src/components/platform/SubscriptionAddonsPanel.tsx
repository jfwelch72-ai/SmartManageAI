import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Building2,
  Loader2,
  ArrowUpDown,
  ToggleLeft,
  Trash2,
  Check,
  XCircle,
  AlertTriangle,
  Clock,
} from "lucide-react";

export function planBadgeColor(tier: string) {
  switch (tier) {
    case "enterprise": return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200";
    case "professional": return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
    case "starter": return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
    default: return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200";
  }
}

export function statusBadgeVariant(status: string) {
  switch (status) {
    case "active": return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200";
    case "trialing": return "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200";
    case "past_due": return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
    case "canceled": return "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400";
    default: return "bg-gray-100 text-gray-800";
  }
}

export function statusIcon(status: string) {
  switch (status) {
    case "active": return <Check className="w-3 h-3" />;
    case "trialing": return <Clock className="w-3 h-3" />;
    case "past_due": return <AlertTriangle className="w-3 h-3" />;
    case "canceled": return <XCircle className="w-3 h-3" />;
    default: return null;
  }
}

interface SubDetailData {
  organization: any;
  subscription: any;
  addons: any[];
  usage: any[];
  userCount: number;
  planInfo: any;
  recentAudit: any[];
}

export function SubscriptionDetailDialog({
  orgId,
  open,
  onClose,
}: {
  orgId: string;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [newPlanTier, setNewPlanTier] = useState("");
  const [newStatus, setNewStatus] = useState("");
  const [confirmAction, setConfirmAction] = useState<{ type: string; label: string } | null>(null);

  const { data, isLoading } = useQuery<SubDetailData>({
    queryKey: ["/api/platform/subscriptions", orgId],
    enabled: open && !!orgId,
  });

  const updateSubscription = useMutation({
    mutationFn: async (body: { planTier?: string; status?: string }) => {
      const res = await apiRequest("PATCH", `/api/platform/subscriptions/${orgId}`, body);
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Subscription Updated", description: data.changes?.join(", ") || "Changes saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/platform/subscriptions"] });
      setConfirmAction(null);
      setNewPlanTier("");
      setNewStatus("");
    },
    onError: (err: any) => {
      toast({ title: "Update Failed", description: err.message, variant: "destructive" });
      setConfirmAction(null);
    },
  });

  const toggleAddon = useMutation({
    mutationFn: async ({ addonKey, status }: { addonKey: string; status: string }) => {
      const res = await apiRequest("PATCH", `/api/platform/subscriptions/${orgId}/addons/${addonKey}`, { status });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Add-on Updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/platform/subscriptions", orgId] });
    },
    onError: (err: any) => {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    },
  });

  const deleteSubscription = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/platform/subscriptions/${orgId}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Subscription Deleted", description: "The subscription has been removed." });
      queryClient.invalidateQueries({ queryKey: ["/api/platform/subscriptions"] });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Delete Failed", description: err.message, variant: "destructive" });
      setConfirmAction(null);
    },
  });

  const handlePlanChange = () => {
    if (newPlanTier) {
      setConfirmAction({ type: "plan", label: `Change plan to ${newPlanTier}` });
    }
  };

  const handleStatusChange = () => {
    if (newStatus) {
      setConfirmAction({ type: "status", label: `Change status to ${newStatus}` });
    }
  };

  const executeConfirmedAction = () => {
    if (confirmAction?.type === "plan") {
      updateSubscription.mutate({ planTier: newPlanTier });
    } else if (confirmAction?.type === "status") {
      updateSubscription.mutate({ status: newStatus });
    } else if (confirmAction?.type === "delete") {
      deleteSubscription.mutate();
    }
  };

  if (!open) return null;

  const sub = data?.subscription;
  const allAddonKeys = ["ai_pm", "ai_cfo", "ai_email", "ai_vision", "ai_governance", "website_seo", "bid_network", "integration_qbo"];

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2" data-testid="text-detail-org-name">
              <Building2 className="w-5 h-5" />
              {data?.organization?.name || "Loading..."}
            </DialogTitle>
            <DialogDescription>
              {data?.organization?.tradeType || ""} · {data?.userCount || 0} users
            </DialogDescription>
          </DialogHeader>

          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : !sub ? (
            <p className="text-center text-muted-foreground py-4">No subscription found for this organization.</p>
          ) : (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Current Plan</p>
                  <Badge className={`${planBadgeColor(sub.planTier)} text-sm`} data-testid="text-detail-plan">
                    {data?.planInfo?.name || sub.planTier}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Status</p>
                  <Badge className={`${statusBadgeVariant(sub.status)} text-sm`} data-testid="text-detail-status">
                    {statusIcon(sub.status)} {sub.status}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Billing Provider</p>
                  <p className="text-sm font-medium capitalize">{sub.billingProvider}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Monthly Price</p>
                  <p className="text-sm font-medium">${data?.planInfo?.price || 0}/mo</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Period End</p>
                  <p className="text-sm">{sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toLocaleDateString() : "N/A"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Created</p>
                  <p className="text-sm">{new Date(sub.createdAt).toLocaleDateString()}</p>
                </div>
              </div>

              <div className="border-t pt-4">
                <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <ArrowUpDown className="w-4 h-4" /> Change Plan
                </h4>
                <div className="flex gap-2">
                  <Select value={newPlanTier} onValueChange={setNewPlanTier}>
                    <SelectTrigger className="w-48" data-testid="select-change-plan">
                      <SelectValue placeholder="Select plan..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="free">Trial ($0)</SelectItem>
                      <SelectItem value="starter">Starter ($89)</SelectItem>
                      <SelectItem value="professional">Growth ($229)</SelectItem>
                      <SelectItem value="enterprise">Scale ($579)</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    onClick={handlePlanChange}
                    disabled={!newPlanTier || newPlanTier === sub.planTier || updateSubscription.isPending}
                    data-testid="button-apply-plan-change"
                  >
                    Apply
                  </Button>
                </div>
              </div>

              <div className="border-t pt-4">
                <h4 className="text-sm font-semibold mb-3">Change Status</h4>
                <div className="flex gap-2">
                  <Select value={newStatus} onValueChange={setNewStatus}>
                    <SelectTrigger className="w-48" data-testid="select-change-status">
                      <SelectValue placeholder="Select status..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="trialing">Trialing</SelectItem>
                      <SelectItem value="past_due">Past Due</SelectItem>
                      <SelectItem value="canceled">Canceled</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    onClick={handleStatusChange}
                    disabled={!newStatus || newStatus === sub.status || updateSubscription.isPending}
                    data-testid="button-apply-status-change"
                  >
                    Apply
                  </Button>
                </div>
              </div>

              <div className="border-t pt-4">
                <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <ToggleLeft className="w-4 h-4" /> Add-ons
                </h4>
                <div className="grid grid-cols-1 gap-2">
                  {allAddonKeys.map(key => {
                    const existing = data?.addons?.find((a: any) => a.addonKey === key);
                    const isActive = existing?.status === "active";
                    return (
                      <div key={key} className="flex items-center justify-between py-1.5 px-3 rounded-md border bg-muted/30">
                        <span className="text-sm capitalize">{key.replace(/_/g, " ")}</span>
                        <Button
                          variant={isActive ? "destructive" : "outline"}
                          size="sm"
                          onClick={() => toggleAddon.mutate({ addonKey: key, status: isActive ? "inactive" : "active" })}
                          disabled={toggleAddon.isPending}
                          data-testid={`button-toggle-addon-${key}`}
                        >
                          {isActive ? "Disable" : "Enable"}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {data?.recentAudit && data.recentAudit.length > 0 && (
                <div className="border-t pt-4">
                  <h4 className="text-sm font-semibold mb-3">Recent Changes</h4>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {data.recentAudit.map((entry: any) => (
                      <div key={entry.id} className="text-xs text-muted-foreground flex justify-between py-1 border-b last:border-0">
                        <span>{entry.action} — {entry.newValue ? JSON.parse(entry.newValue).changes?.join(", ") || entry.newValue : ""}</span>
                        <span>{new Date(entry.createdAt).toLocaleDateString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="border-t pt-4">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setConfirmAction({ type: "delete", label: `Delete subscription for ${sub?.organizationName || "this organization"}` })}
                  data-testid="button-delete-subscription"
                >
                  <Trash2 className="w-4 h-4 mr-2" /> Delete Subscription
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmAction} onOpenChange={(v) => !v && setConfirmAction(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirm Change</DialogTitle>
            <DialogDescription>
              Are you sure you want to: <strong>{confirmAction?.label}</strong>?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAction(null)} data-testid="button-cancel-confirm">Cancel</Button>
            <Button
              variant={confirmAction?.type === "delete" ? "destructive" : "default"}
              onClick={executeConfirmedAction}
              disabled={updateSubscription.isPending || deleteSubscription.isPending}
              data-testid="button-confirm-change"
            >
              {(updateSubscription.isPending || deleteSubscription.isPending) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {confirmAction?.type === "delete" ? "Delete" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function AssignSubscriptionDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedOrg, setSelectedOrg] = useState("");
  const [selectedPlan, setSelectedPlan] = useState("free");
  const [selectedStatus, setSelectedStatus] = useState("active");
  const [selectedBillingProvider, setSelectedBillingProvider] = useState("manual");

  const { data: availableOrgs = [], isLoading: orgsLoading } = useQuery<{ id: string; name: string; tradeType: string | null }[]>({
    queryKey: ["/api/platform/organizations-without-subscription"],
    enabled: open,
  });

  const createMutation = useMutation({
    mutationFn: async (body: { organizationId: string; planTier: string; status: string; billingProvider: string }) => {
      const res = await apiRequest("POST", "/api/platform/subscriptions", body);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Subscription Created", description: "Subscription has been assigned to the organization." });
      queryClient.invalidateQueries({ queryKey: ["/api/platform/subscriptions"] });
      setSelectedOrg("");
      setSelectedPlan("free");
      setSelectedStatus("active");
      setSelectedBillingProvider("manual");
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    if (!selectedOrg) {
      toast({ title: "Select an organization", variant: "destructive" });
      return;
    }
    createMutation.mutate({ organizationId: selectedOrg, planTier: selectedPlan, status: selectedStatus, billingProvider: selectedBillingProvider });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle data-testid="text-assign-dialog-title">Assign Subscription</DialogTitle>
          <DialogDescription>Assign a subscription plan to an organization that doesn't have one.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Organization</Label>
            {orgsLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading...</div>
            ) : availableOrgs.length === 0 ? (
              <p className="text-sm text-muted-foreground">All organizations already have subscriptions.</p>
            ) : (
              <Select value={selectedOrg} onValueChange={setSelectedOrg}>
                <SelectTrigger data-testid="select-assign-org">
                  <SelectValue placeholder="Select organization..." />
                </SelectTrigger>
                <SelectContent>
                  {availableOrgs.map(org => (
                    <SelectItem key={org.id} value={org.id}>{org.name}{org.tradeType ? ` (${org.tradeType})` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-2">
            <Label>Plan Tier</Label>
            <Select value={selectedPlan} onValueChange={setSelectedPlan}>
              <SelectTrigger data-testid="select-assign-plan">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="free">Trial</SelectItem>
                <SelectItem value="starter">Starter</SelectItem>
                <SelectItem value="professional">Growth</SelectItem>
                <SelectItem value="enterprise">Scale</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={selectedStatus} onValueChange={setSelectedStatus}>
              <SelectTrigger data-testid="select-assign-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="trialing">Trialing</SelectItem>
                <SelectItem value="past_due">Past Due</SelectItem>
                <SelectItem value="canceled">Canceled</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Billing Provider</Label>
            <Select value={selectedBillingProvider} onValueChange={setSelectedBillingProvider}>
              <SelectTrigger data-testid="select-assign-billing-provider">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manual</SelectItem>
                <SelectItem value="stripe">Stripe</SelectItem>
                <SelectItem value="internal">Internal</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-assign">Cancel</Button>
          <Button onClick={handleSubmit} disabled={createMutation.isPending || !selectedOrg} data-testid="button-confirm-assign">
            {createMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Assign Subscription
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
