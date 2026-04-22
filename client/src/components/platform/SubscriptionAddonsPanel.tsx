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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
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
  History,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Pause,
  Ban,
  ArrowDown,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
    case "paused": return "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200";
    default: return "bg-gray-100 text-gray-800";
  }
}

export function statusIcon(status: string) {
  switch (status) {
    case "active": return <Check className="w-3 h-3" />;
    case "trialing": return <Clock className="w-3 h-3" />;
    case "past_due": return <AlertTriangle className="w-3 h-3" />;
    case "canceled": return <XCircle className="w-3 h-3" />;
    case "paused": return <Clock className="w-3 h-3" />;
    default: return null;
  }
}

function EventTypeBadge({ type }: { type: string }) {
  const config: Record<string, { label: string; className: string }> = {
    plan_change: { label: "Plan Change", className: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" },
    status_change: { label: "Status Change", className: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200" },
    addon_change: { label: "Add-on", className: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200" },
    created: { label: "Created", className: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
    canceled: { label: "Canceled", className: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" },
  };
  const c = config[type] || { label: type, className: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200" };
  return <Badge className={`${c.className} text-xs whitespace-nowrap`} data-testid={`badge-event-type-${type}`}>{c.label}</Badge>;
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
  const [historyPage, setHistoryPage] = useState(1);
  const [downgradePlan, setDowngradePlan] = useState("");

  const { data, isLoading } = useQuery<SubDetailData>({
    queryKey: ["/api/platform/subscriptions", orgId],
    enabled: open && !!orgId,
  });

  const { data: historyData, isLoading: historyLoading } = useQuery<{
    events: Array<{
      id: string;
      eventType: string;
      previousValue: string | null;
      newValue: string | null;
      description: string;
      performerName: string | null;
      createdAt: string;
    }>;
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }>({
    queryKey: ["/api/platform/subscriptions", orgId, "history", historyPage],
    queryFn: async () => {
      const res = await fetch(`/api/platform/subscriptions/${orgId}/history?page=${historyPage}&limit=20`);
      if (!res.ok) throw new Error("Failed to fetch history");
      return res.json();
    },
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
      setHistoryPage(1);
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

  const cancelSubscription = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/platform/subscriptions/${orgId}/cancel`);
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Subscription Canceled", description: data.message });
      queryClient.invalidateQueries({ queryKey: ["/api/platform/subscriptions"] });
      setConfirmAction(null);
    },
    onError: (err: any) => {
      toast({ title: "Cancel Failed", description: err.message, variant: "destructive" });
      setConfirmAction(null);
    },
  });

  const pauseSubscription = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/platform/subscriptions/${orgId}/pause`);
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Subscription Paused", description: data.message });
      queryClient.invalidateQueries({ queryKey: ["/api/platform/subscriptions"] });
      setConfirmAction(null);
    },
    onError: (err: any) => {
      toast({ title: "Pause Failed", description: err.message, variant: "destructive" });
      setConfirmAction(null);
    },
  });

  const downgradeSubscription = useMutation({
    mutationFn: async (targetPlan: string) => {
      const res = await apiRequest("POST", `/api/platform/subscriptions/${orgId}/downgrade`, { targetPlan });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Subscription Downgraded", description: data.message });
      queryClient.invalidateQueries({ queryKey: ["/api/platform/subscriptions"] });
      setConfirmAction(null);
      setDowngradePlan("");
    },
    onError: (err: any) => {
      toast({ title: "Downgrade Failed", description: err.message, variant: "destructive" });
      setConfirmAction(null);
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
    } else if (confirmAction?.type === "cancel") {
      cancelSubscription.mutate();
    } else if (confirmAction?.type === "pause") {
      pauseSubscription.mutate();
    } else if (confirmAction?.type === "downgrade") {
      downgradeSubscription.mutate(downgradePlan);
    }
  };

  if (!open) return null;

  const sub = data?.subscription;
  const allAddonKeys = ["ai_pm", "ai_cfo", "ai_email", "ai_vision", "ai_governance", "website_seo", "bid_network", "integration_qbo"];

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
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
            <Tabs defaultValue="details" className="w-full">
              <TabsList className="mb-4">
                <TabsTrigger value="details" data-testid="tab-subscription-details">Details</TabsTrigger>
                <TabsTrigger value="history" data-testid="tab-billing-history">
                  <History className="w-3.5 h-3.5 mr-1.5" /> Billing History
                </TabsTrigger>
              </TabsList>

              <TabsContent value="details">
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
                          <SelectItem value="paused">Paused</SelectItem>
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

                  <div className="border-t pt-4">
                    <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                      <ArrowDown className="w-4 h-4" /> Subscription Lifecycle
                    </h4>
                    <div className="space-y-3">
                      {sub.status !== "paused" && sub.status !== "canceled" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setConfirmAction({ type: "pause", label: `Pause subscription for ${data?.organization?.name || "this organization"}` })}
                          disabled={pauseSubscription.isPending}
                          data-testid="button-pause-subscription"
                        >
                          <Pause className="w-4 h-4 mr-2" /> Pause Subscription
                        </Button>
                      )}
                      {sub.status !== "canceled" && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive border-destructive/50 hover:bg-destructive/10 ml-2"
                          onClick={() => setConfirmAction({ type: "cancel", label: `Cancel subscription for ${data?.organization?.name || "this organization"}` })}
                          disabled={cancelSubscription.isPending}
                          data-testid="button-cancel-subscription"
                        >
                          <Ban className="w-4 h-4 mr-2" /> Cancel Subscription
                        </Button>
                      )}
                      <div className="flex items-center gap-2 mt-2">
                        <Select value={downgradePlan} onValueChange={setDowngradePlan}>
                          <SelectTrigger className="w-48" data-testid="select-downgrade-plan">
                            <SelectValue placeholder="Downgrade to..." />
                          </SelectTrigger>
                          <SelectContent>
                            {["free", "starter", "professional", "enterprise"]
                              .filter(p => {
                                const planOrder = ["free", "starter", "professional", "enterprise"];
                                return planOrder.indexOf(p) < planOrder.indexOf(sub.planTier);
                              })
                              .map(p => (
                                <SelectItem key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</SelectItem>
                              ))
                            }
                          </SelectContent>
                        </Select>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            if (downgradePlan) {
                              setConfirmAction({ type: "downgrade", label: `Downgrade plan from ${sub.planTier} to ${downgradePlan}` });
                            }
                          }}
                          disabled={!downgradePlan || downgradeSubscription.isPending}
                          data-testid="button-apply-downgrade"
                        >
                          <ArrowDown className="w-4 h-4 mr-1" /> Downgrade
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="border-t pt-4">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setConfirmAction({ type: "delete", label: `Delete subscription for ${data?.organization?.name || "this organization"}` })}
                      data-testid="button-delete-subscription"
                    >
                      <Trash2 className="w-4 h-4 mr-2" /> Delete Subscription
                    </Button>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="history">
                <div className="space-y-3">
                  {historyLoading ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : !historyData?.events?.length ? (
                    <p className="text-center text-muted-foreground py-6 text-sm" data-testid="text-no-history">No billing history events recorded yet.</p>
                  ) : (
                    <>
                      <div className="space-y-2">
                        {historyData.events.map((event) => (
                          <div key={event.id} className="flex items-start gap-3 p-3 rounded-lg border bg-muted/20" data-testid={`history-event-${event.id}`}>
                            <div className="mt-0.5">
                              <EventTypeBadge type={event.eventType} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium" data-testid={`text-event-desc-${event.id}`}>{event.description}</p>
                              {(event.previousValue || event.newValue) && (
                                <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
                                  {event.previousValue && <span className="font-mono bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 px-1.5 py-0.5 rounded">{event.previousValue}</span>}
                                  {event.previousValue && event.newValue && <ArrowRight className="w-3 h-3" />}
                                  {event.newValue && <span className="font-mono bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 px-1.5 py-0.5 rounded">{event.newValue}</span>}
                                </div>
                              )}
                              <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
                                <span>{new Date(event.createdAt).toLocaleString()}</span>
                                {event.performerName && <span>by {event.performerName}</span>}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                      {historyData.pagination.totalPages > 1 && (
                        <div className="flex items-center justify-between pt-2">
                          <span className="text-xs text-muted-foreground" data-testid="text-history-pagination">
                            Page {historyData.pagination.page} of {historyData.pagination.totalPages} ({historyData.pagination.total} events)
                          </span>
                          <div className="flex gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={historyPage <= 1}
                              onClick={() => setHistoryPage(p => p - 1)}
                              data-testid="button-history-prev"
                            >
                              <ChevronLeft className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={historyPage >= historyData.pagination.totalPages}
                              onClick={() => setHistoryPage(p => p + 1)}
                              data-testid="button-history-next"
                            >
                              <ChevronRight className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmAction} onOpenChange={(v) => !v && setConfirmAction(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirm Change</DialogTitle>
            <DialogDescription>
              Are you sure you want to: <strong>{confirmAction?.label}</strong>?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAction(null)} data-testid="button-cancel-confirm">Cancel</Button>
            <Button
              variant={confirmAction?.type === "delete" || confirmAction?.type === "cancel" ? "destructive" : "default"}
              onClick={executeConfirmedAction}
              disabled={updateSubscription.isPending || deleteSubscription.isPending || cancelSubscription.isPending || pauseSubscription.isPending || downgradeSubscription.isPending}
              data-testid="button-confirm-change"
            >
              {(updateSubscription.isPending || deleteSubscription.isPending || cancelSubscription.isPending || pauseSubscription.isPending || downgradeSubscription.isPending) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {confirmAction?.type === "delete" ? "Delete" : confirmAction?.type === "cancel" ? "Cancel Subscription" : "Confirm"}
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
      <DialogContent className="sm:max-w-md">
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
              <OrgCombobox
                orgs={availableOrgs}
                value={selectedOrg}
                onChange={setSelectedOrg}
              />
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

function OrgCombobox({
  orgs,
  value,
  onChange,
}: {
  orgs: { id: string; name: string; tradeType: string | null }[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = orgs.find((o) => o.id === value);
  const label = (o: { name: string; tradeType: string | null }) =>
    `${o.name}${o.tradeType ? ` (${o.tradeType})` : ""}`;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "w-full justify-between font-normal",
            !selected && "text-muted-foreground",
          )}
          data-testid="select-assign-org"
        >
          <span className="truncate">
            {selected ? label(selected) : "Select organization..."}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="p-0 w-[--radix-popover-trigger-width]"
        align="start"
      >
        <Command
          filter={(itemValue, search) =>
            itemValue.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
          }
        >
          <CommandInput
            placeholder="Search organizations..."
            data-testid="input-search-assign-org"
          />
          <CommandList>
            <CommandEmpty>No organizations found.</CommandEmpty>
            <CommandGroup>
              {orgs.map((org) => (
                <CommandItem
                  key={org.id}
                  value={label(org)}
                  onSelect={() => {
                    onChange(org.id);
                    setOpen(false);
                  }}
                  data-testid={`option-assign-org-${org.id}`}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === org.id ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="truncate">{label(org)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
