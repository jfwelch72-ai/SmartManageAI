import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import {
  Search,
  CreditCard,
  Users,
  Building2,
  DollarSign,
  ChevronLeft,
  ChevronRight,
  Loader2,
  ArrowUpDown,
  Eye,
  ArrowUp,
  ArrowDown,
  X,
  ToggleLeft,
  Check,
  XCircle,
  AlertTriangle,
  Clock,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

const PLAN_TIERS = [
  { value: "all", label: "All Plans" },
  { value: "free", label: "Trial" },
  { value: "starter", label: "Starter" },
  { value: "professional", label: "Growth" },
  { value: "enterprise", label: "Scale" },
];

const STATUSES = [
  { value: "all", label: "All Statuses" },
  { value: "active", label: "Active" },
  { value: "trialing", label: "Trialing" },
  { value: "past_due", label: "Past Due" },
  { value: "canceled", label: "Canceled" },
];

function planBadgeColor(tier: string) {
  switch (tier) {
    case "enterprise": return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200";
    case "professional": return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
    case "starter": return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
    default: return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200";
  }
}

function statusBadgeVariant(status: string) {
  switch (status) {
    case "active": return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200";
    case "trialing": return "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200";
    case "past_due": return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
    case "canceled": return "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400";
    default: return "bg-gray-100 text-gray-800";
  }
}

function statusIcon(status: string) {
  switch (status) {
    case "active": return <Check className="w-3 h-3" />;
    case "trialing": return <Clock className="w-3 h-3" />;
    case "past_due": return <AlertTriangle className="w-3 h-3" />;
    case "canceled": return <XCircle className="w-3 h-3" />;
    default: return null;
  }
}

interface SubStats {
  totalSubscriptions: number;
  byPlanTier: { planTier: string; count: number }[];
  byStatus: { status: string; count: number }[];
  addonAdoption: { addonKey: string; count: number }[];
  estimatedMrr: number;
  recentChanges: any[];
}

interface SubscriptionRow {
  subscriptionId: string;
  orgId: string;
  orgName: string;
  orgSlug: string;
  tradeType: string | null;
  planTier: string;
  status: string;
  billingProvider: string;
  currentPeriodEnd: string | null;
  createdAt: string;
  updatedAt: string;
  userCount: number;
  activeAddonCount: number;
  planPrice: number;
  planName: string;
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

function StatsCards({ stats }: { stats: SubStats }) {
  const getPlanCount = (tier: string) => stats.byPlanTier.find(p => p.planTier === tier)?.count || 0;
  const getStatusCount = (s: string) => stats.byStatus.find(st => st.status === s)?.count || 0;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      <Card>
        <CardContent className="pt-4 pb-3 px-4">
          <p className="text-xs text-muted-foreground">Total Orgs</p>
          <p className="text-2xl font-bold" data-testid="text-total-subscriptions">{stats.totalSubscriptions}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4 pb-3 px-4">
          <p className="text-xs text-muted-foreground">Est. MRR</p>
          <p className="text-2xl font-bold text-emerald-600" data-testid="text-estimated-mrr">${stats.estimatedMrr.toLocaleString()}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4 pb-3 px-4">
          <p className="text-xs text-muted-foreground">Active</p>
          <p className="text-2xl font-bold text-emerald-600">{getStatusCount("active")}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4 pb-3 px-4">
          <p className="text-xs text-muted-foreground">Trialing</p>
          <p className="text-2xl font-bold text-amber-600">{getStatusCount("trialing")}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4 pb-3 px-4">
          <p className="text-xs text-muted-foreground">Past Due</p>
          <p className="text-2xl font-bold text-red-600">{getStatusCount("past_due")}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4 pb-3 px-4">
          <p className="text-xs text-muted-foreground">Canceled</p>
          <p className="text-2xl font-bold text-gray-500">{getStatusCount("canceled")}</p>
        </CardContent>
      </Card>
    </div>
  );
}

function PlanBreakdown({ stats }: { stats: SubStats }) {
  const tiers = [
    { key: "free", label: "Trial", color: "bg-gray-400" },
    { key: "starter", label: "Starter", color: "bg-green-500" },
    { key: "professional", label: "Growth", color: "bg-blue-500" },
    { key: "enterprise", label: "Scale", color: "bg-purple-500" },
  ];
  const total = stats.totalSubscriptions || 1;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Plan Distribution</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {tiers.map(tier => {
          const cnt = stats.byPlanTier.find(p => p.planTier === tier.key)?.count || 0;
          const pct = Math.round((cnt / total) * 100);
          return (
            <div key={tier.key} className="flex items-center gap-2 text-sm">
              <span className="w-16 text-muted-foreground">{tier.label}</span>
              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                <div className={`h-full ${tier.color} rounded-full`} style={{ width: `${pct}%` }} />
              </div>
              <span className="w-8 text-right font-medium">{cnt}</span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function SubscriptionDetailDialog({
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
            <Button onClick={executeConfirmedAction} disabled={updateSubscription.isPending} data-testid="button-confirm-change">
              {updateSubscription.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function PlatformSubscriptions() {
  const [planFilter, setPlanFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchText, setSearchText] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);

  const buildParams = () => {
    const p = new URLSearchParams();
    p.set("page", String(page));
    p.set("limit", "15");
    if (planFilter !== "all") p.set("planTier", planFilter);
    if (statusFilter !== "all") p.set("status", statusFilter);
    if (appliedSearch.trim()) p.set("search", appliedSearch.trim());
    return p.toString();
  };

  const { data: stats, isLoading: statsLoading } = useQuery<SubStats>({
    queryKey: ["/api/platform/subscriptions/stats"],
  });

  const { data: listData, isLoading: listLoading } = useQuery<{
    subscriptions: SubscriptionRow[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }>({
    queryKey: ["/api/platform/subscriptions", { planFilter, statusFilter, appliedSearch, page }],
    queryFn: async () => {
      const res = await fetch(`/api/platform/subscriptions?${buildParams()}`);
      if (!res.ok) throw new Error("Failed to load subscriptions");
      return res.json();
    },
  });

  const handleSearch = () => {
    setAppliedSearch(searchText);
    setPage(1);
  };

  const subs = listData?.subscriptions || [];
  const pagination = listData?.pagination;

  return (
    <div className="px-3 sm:px-6 py-4 sm:py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
          <CreditCard className="h-6 w-6" /> Subscription Management
        </h1>
        <p className="text-muted-foreground mt-1">Manage organization plans, statuses, and add-ons across the platform</p>
      </div>

      {statsLoading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : stats ? (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          <div className="lg:col-span-3">
            <StatsCards stats={stats} />
          </div>
          <PlanBreakdown stats={stats} />
        </div>
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search organizations..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="pl-9"
                data-testid="input-search-subscriptions"
              />
            </div>
            <Select value={planFilter} onValueChange={(v) => { setPlanFilter(v); setPage(1); }}>
              <SelectTrigger className="w-36" data-testid="select-plan-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PLAN_TIERS.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
              <SelectTrigger className="w-36" data-testid="select-status-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button onClick={handleSearch} variant="outline" size="sm" data-testid="button-apply-search">
              <Search className="w-4 h-4 mr-1" /> Search
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {listLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : subs.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No subscriptions found matching your filters.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="pb-2 pr-3 font-medium">Organization</th>
                      <th className="pb-2 pr-3 font-medium">Plan</th>
                      <th className="pb-2 pr-3 font-medium">Status</th>
                      <th className="pb-2 pr-3 font-medium text-center">Users</th>
                      <th className="pb-2 pr-3 font-medium text-center">Add-ons</th>
                      <th className="pb-2 pr-3 font-medium">Provider</th>
                      <th className="pb-2 pr-3 font-medium">Price</th>
                      <th className="pb-2 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subs.map((sub) => (
                      <tr
                        key={sub.subscriptionId}
                        className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                        data-testid={`row-subscription-${sub.orgId}`}
                      >
                        <td className="py-2.5 pr-3">
                          <Link href={`/admin/organizations/${sub.orgId}`}>
                            <span className="font-medium hover:underline cursor-pointer" data-testid={`link-org-${sub.orgId}`}>
                              {sub.orgName}
                            </span>
                          </Link>
                          {sub.tradeType && (
                            <p className="text-xs text-muted-foreground">{sub.tradeType}</p>
                          )}
                        </td>
                        <td className="py-2.5 pr-3">
                          <Badge className={planBadgeColor(sub.planTier)} data-testid={`badge-plan-${sub.orgId}`}>
                            {sub.planName}
                          </Badge>
                        </td>
                        <td className="py-2.5 pr-3">
                          <Badge className={`${statusBadgeVariant(sub.status)} flex items-center gap-1 w-fit`} data-testid={`badge-status-${sub.orgId}`}>
                            {statusIcon(sub.status)} {sub.status}
                          </Badge>
                        </td>
                        <td className="py-2.5 pr-3 text-center">
                          <span className="flex items-center justify-center gap-1">
                            <Users className="w-3.5 h-3.5 text-muted-foreground" />
                            {sub.userCount}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3 text-center">{sub.activeAddonCount}</td>
                        <td className="py-2.5 pr-3">
                          <Badge variant="outline" className="text-xs capitalize">{sub.billingProvider}</Badge>
                        </td>
                        <td className="py-2.5 pr-3 font-medium">
                          ${sub.planPrice}/mo
                        </td>
                        <td className="py-2.5 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedOrgId(sub.orgId)}
                            data-testid={`button-view-detail-${sub.orgId}`}
                          >
                            <Eye className="w-4 h-4 mr-1" /> Details
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {pagination && pagination.totalPages > 1 && (
                <div className="flex items-center justify-between mt-4 pt-3 border-t">
                  <p className="text-sm text-muted-foreground">
                    Showing {(pagination.page - 1) * pagination.limit + 1}–{Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1}
                      onClick={() => setPage(p => p - 1)}
                      data-testid="button-prev-page"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <span className="text-sm">Page {pagination.page} of {pagination.totalPages}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= pagination.totalPages}
                      onClick={() => setPage(p => p + 1)}
                      data-testid="button-next-page"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {selectedOrgId && (
        <SubscriptionDetailDialog
          orgId={selectedOrgId}
          open={!!selectedOrgId}
          onClose={() => setSelectedOrgId(null)}
        />
      )}
    </div>
  );
}
