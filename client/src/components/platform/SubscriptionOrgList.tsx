import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link } from "wouter";
import {
  Search,
  Users,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Eye,
} from "lucide-react";
import { planBadgeColor, statusBadgeVariant, statusIcon } from "./SubscriptionAddonsPanel";

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
  { value: "paused", label: "Paused" },
];

export interface SubscriptionRow {
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

export function SubscriptionOrgList({
  onSelectOrg,
}: {
  onSelectOrg: (orgId: string) => void;
}) {
  const [planFilter, setPlanFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchText, setSearchText] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [page, setPage] = useState(1);

  const buildParams = () => {
    const p = new URLSearchParams();
    p.set("page", String(page));
    p.set("limit", "15");
    if (planFilter !== "all") p.set("planTier", planFilter);
    if (statusFilter !== "all") p.set("status", statusFilter);
    if (appliedSearch.trim()) p.set("search", appliedSearch.trim());
    return p.toString();
  };

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
                          onClick={() => onSelectOrg(sub.orgId)}
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
  );
}
