import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { Brain, Zap, DollarSign, Activity, Loader2, ChevronLeft, ChevronRight, BarChart3, User, Cpu, ArrowRight, ShieldCheck } from "lucide-react";

interface UsageLimitsData {
  tier: string;
  limits: {
    actionsPerDay: number;
    tokensPerDay: number;
    costPerDay: number;
  };
  usage: {
    actionCount: number;
    totalTokensIn: number;
    totalTokensOut: number;
    totalCost: number;
  };
}

interface AuditEntry {
  id: string;
  actionType: string;
  actorUserId: string | null;
  actorName: string;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costEstimate: string | null;
  rationale: string | null;
  approvalRequired: boolean;
  approvalStatus: string | null;
  createdAt: string;
}

interface AuditResponse {
  rows: AuditEntry[];
  total: number;
}

interface CostBreakdownEntry {
  actionType: string;
  count: number;
  totalCost: number;
  totalTokensIn: number;
  totalTokensOut: number;
}

interface AiModelConfigData {
  primaryModel: { name: string; model: string; provider: string };
  fallbackModel: { name: string; model: string; provider: string };
  routing: {
    takeoffEnabled: boolean;
    generalEnabled: boolean;
    takeoffActive: boolean;
    generalActive: boolean;
  };
}

const PAGE_SIZE = 20;

export default function AIGovernancePage() {
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [dateRange, setDateRange] = useState<string>("today");
  const [page, setPage] = useState(1);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canToggleRouting = user?.role === "ADMIN" || user?.role === "SUPER_ADMIN";

  const { data: modelConfig } = useQuery<AiModelConfigData>({
    queryKey: ["/api/feature-flags/ai-model-config"],
  });

  const routingMutation = useMutation({
    mutationFn: async (update: { takeoffEnabled?: boolean; generalEnabled?: boolean }) => {
      const res = await apiRequest("PATCH", "/api/feature-flags/ai-model-config", update);
      return res.json() as Promise<AiModelConfigData>;
    },
    onMutate: async (update) => {
      await queryClient.cancelQueries({ queryKey: ["/api/feature-flags/ai-model-config"] });
      const previous = queryClient.getQueryData<AiModelConfigData>(["/api/feature-flags/ai-model-config"]);
      queryClient.setQueryData<AiModelConfigData>(["/api/feature-flags/ai-model-config"], (old) => {
        if (!old) return old;
        const newTakeoff = update.takeoffEnabled !== undefined ? update.takeoffEnabled : old.routing.takeoffEnabled;
        const newGeneral = update.generalEnabled !== undefined ? update.generalEnabled : old.routing.generalEnabled;
        return {
          ...old,
          routing: {
            takeoffEnabled: newTakeoff,
            generalEnabled: newGeneral,
            takeoffActive: newTakeoff,
            generalActive: newGeneral,
          },
        };
      });
      return { previous };
    },
    onError: (_err, _update, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["/api/feature-flags/ai-model-config"], context.previous);
      }
      toast({ title: "Failed to update routing", description: "Please try again.", variant: "destructive" });
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/feature-flags/ai-model-config"], data);
      toast({ title: "AI routing updated" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/feature-flags/ai-model-config"] });
    },
  });

  const { data: usageData, isLoading: usageLoading } = useQuery<UsageLimitsData>({
    queryKey: ["/api/ai-governance/usage"],
  });

  const { data: auditData, isLoading: auditLoading } = useQuery<AuditResponse>({
    queryKey: ["/api/ai-governance/audit", { page, dateRange, limit: PAGE_SIZE }],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String((page - 1) * PAGE_SIZE),
        dateRange,
      });
      const res = await fetch(`/api/ai-governance/audit?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch audit log");
      return res.json();
    },
  });

  const { data: costBreakdown, isLoading: costLoading } = useQuery<CostBreakdownEntry[]>({
    queryKey: ["/api/ai-governance/cost-breakdown", { dateRange }],
    queryFn: async () => {
      const params = new URLSearchParams({ dateRange });
      const res = await fetch(`/api/ai-governance/cost-breakdown?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch cost breakdown");
      return res.json();
    },
  });

  const isLoading = usageLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const usage = usageData?.usage;
  const limits = usageData?.limits;
  const tier = usageData?.tier || "starter";

  const totalTokens = (Number(usage?.totalTokensIn) || 0) + (Number(usage?.totalTokensOut) || 0);
  const totalCost = Number(usage?.totalCost) || 0;
  const actionCount = Number(usage?.actionCount) || 0;

  const limitCards = [
    {
      label: "Actions Today",
      current: actionCount,
      max: limits?.actionsPerDay || 10,
      icon: Activity,
      color: "text-blue-500",
      format: (v: number) => v.toLocaleString(),
    },
    {
      label: "Tokens Used",
      current: totalTokens,
      max: limits?.tokensPerDay || 50000,
      icon: Zap,
      color: "text-yellow-500",
      format: (v: number) => v.toLocaleString(),
    },
    {
      label: "Cost Today",
      current: totalCost,
      max: limits?.costPerDay || 1,
      icon: DollarSign,
      color: "text-green-500",
      format: (v: number) => `$${v.toFixed(2)}`,
    },
  ];

  const auditRows = auditData?.rows || [];
  const auditTotal = auditData?.total || 0;
  const totalPages = Math.max(1, Math.ceil(auditTotal / PAGE_SIZE));

  const actionTypes = Array.from(new Set(auditRows.map(e => e.actionType)));
  const filteredAudit = actionFilter === "all"
    ? auditRows
    : auditRows.filter(e => e.actionType === actionFilter);

  const maxBreakdownCost = Math.max(...(costBreakdown || []).map(e => Number(e.totalCost) || 0), 0.001);

  return (
    <div className="px-3 sm:px-6 py-4 sm:py-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-ai-governance-title">AI Governance</h1>
          <p className="text-muted-foreground" data-testid="text-ai-governance-description">
            Monitor AI usage, enforce limits, and review the audit trail
          </p>
        </div>
        <Badge variant="outline" data-testid="badge-plan-tier">
          {tier.charAt(0).toUpperCase() + tier.slice(1)} Plan
        </Badge>
      </div>

      <Card data-testid="card-ai-model-config">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Cpu className="h-4 w-4" />
            AI Model Configuration
          </CardTitle>
          <CardDescription>
            Active provider routing for all AI features in this organization
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="flex-1 min-w-0 p-3 rounded-lg border bg-muted/30" data-testid="section-primary-model">
              <div className="flex items-center justify-between gap-2 mb-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Primary Model</p>
                <Badge
                  variant={modelConfig?.routing.takeoffActive || modelConfig?.routing.generalActive ? "default" : "secondary"}
                  className="text-xs"
                  data-testid="badge-primary-model-status"
                >
                  {modelConfig?.routing.takeoffActive || modelConfig?.routing.generalActive ? "Active" : "Inactive"}
                </Badge>
              </div>
              <p className="font-semibold" data-testid="text-primary-model-name">
                {modelConfig?.primaryModel.name ?? "Claude (Anthropic)"}
              </p>
              <p className="text-xs text-muted-foreground" data-testid="text-primary-model-id">
                {modelConfig?.primaryModel.model ?? "claude-sonnet-4-5"}
              </p>
            </div>

            <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 rotate-90 sm:rotate-0" />

            <div className="flex-1 min-w-0 p-3 rounded-lg border bg-muted/30" data-testid="section-fallback-model">
              <div className="flex items-center justify-between gap-2 mb-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Fallback Model</p>
                <Badge variant="outline" className="text-xs" data-testid="badge-fallback-model-status">
                  Auto-fallback
                </Badge>
              </div>
              <p className="font-semibold" data-testid="text-fallback-model-name">
                {modelConfig?.fallbackModel.name ?? "GPT-4o (OpenAI)"}
              </p>
              <p className="text-xs text-muted-foreground" data-testid="text-fallback-model-id">
                {modelConfig?.fallbackModel.model ?? "gpt-4o"}
              </p>
            </div>

            <div className="flex-1 min-w-0 p-3 rounded-lg border bg-muted/30" data-testid="section-routing-status">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
                {canToggleRouting ? "Routing Controls" : "Routing Status"}
              </p>
              <div className="space-y-3">
                <div className="flex items-center gap-2" data-testid="status-takeoff-routing">
                  <ShieldCheck className={`h-3.5 w-3.5 shrink-0 ${modelConfig?.routing.takeoffActive ? "text-green-500" : "text-muted-foreground"}`} />
                  {canToggleRouting ? (
                    <>
                      <Label htmlFor="toggle-takeoff-routing" className="flex-1 text-sm cursor-pointer">
                        <span className="block">Takeoff / Estimator</span>
                        <span className="text-xs text-muted-foreground font-normal">
                          {modelConfig?.routing.takeoffActive ? "Claude (Anthropic)" : "GPT-4o (OpenAI)"}
                        </span>
                      </Label>
                      <Switch
                        id="toggle-takeoff-routing"
                        checked={modelConfig?.routing.takeoffActive ?? false}
                        disabled={routingMutation.isPending}
                        onCheckedChange={(checked) => routingMutation.mutate({ takeoffEnabled: checked })}
                        data-testid="switch-takeoff-routing"
                      />
                    </>
                  ) : (
                    <>
                      <span className="flex-1 text-sm text-muted-foreground">Takeoff / Estimator</span>
                      <Badge variant={modelConfig?.routing.takeoffActive ? "default" : "secondary"} className="text-xs">
                        {modelConfig?.routing.takeoffActive ? "Claude" : "GPT"}
                      </Badge>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2" data-testid="status-general-routing">
                  <ShieldCheck className={`h-3.5 w-3.5 shrink-0 ${modelConfig?.routing.generalActive ? "text-green-500" : "text-muted-foreground"}`} />
                  {canToggleRouting ? (
                    <>
                      <Label htmlFor="toggle-general-routing" className="flex-1 text-sm cursor-pointer">
                        <span className="block">General AI</span>
                        <span className="text-xs text-muted-foreground font-normal">
                          {modelConfig?.routing.generalActive ? "Claude (Anthropic)" : "GPT-4o (OpenAI)"}
                        </span>
                      </Label>
                      <Switch
                        id="toggle-general-routing"
                        checked={modelConfig?.routing.generalActive ?? false}
                        disabled={routingMutation.isPending}
                        onCheckedChange={(checked) => routingMutation.mutate({ generalEnabled: checked })}
                        data-testid="switch-general-routing"
                      />
                    </>
                  ) : (
                    <>
                      <span className="flex-1 text-sm text-muted-foreground">General AI</span>
                      <Badge variant={modelConfig?.routing.generalActive ? "default" : "secondary"} className="text-xs">
                        {modelConfig?.routing.generalActive ? "Claude" : "GPT"}
                      </Badge>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        {limitCards.map((card) => {
          const Icon = card.icon;
          const pct = Math.min(100, (card.current / card.max) * 100);
          const isNearLimit = pct >= 80;
          return (
            <Card key={card.label} data-testid={`card-usage-${card.label.toLowerCase().replace(/\s+/g, "-")}`}>
              <CardContent className="py-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-muted">
                    <Icon className={`h-5 w-5 ${card.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-muted-foreground">{card.label}</p>
                    <p className="text-2xl font-bold" data-testid={`text-usage-value-${card.label.toLowerCase().replace(/\s+/g, "-")}`}>
                      {card.format(card.current)}
                    </p>
                  </div>
                </div>
                <div className="space-y-1">
                  <Progress
                    value={pct}
                    className={`h-2 ${isNearLimit ? "[&>div]:bg-destructive" : ""}`}
                    data-testid={`progress-${card.label.toLowerCase().replace(/\s+/g, "-")}`}
                  />
                  <p className="text-xs text-muted-foreground text-right" data-testid={`text-limit-${card.label.toLowerCase().replace(/\s+/g, "-")}`}>
                    {card.format(card.current)} / {card.format(card.max)}
                  </p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Separator />

      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold flex items-center gap-2" data-testid="text-cost-breakdown-heading">
            <BarChart3 className="h-5 w-5" />
            Cost by Action Type
          </h2>
          <Select value={dateRange} onValueChange={(v) => { setDateRange(v); setPage(1); }}>
            <SelectTrigger className="w-[160px]" data-testid="select-date-range">
              <SelectValue placeholder="Date range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="week">This Week</SelectItem>
              <SelectItem value="month">This Month</SelectItem>
              <SelectItem value="all">All Time</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {costLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (!costBreakdown || costBreakdown.length === 0) ? (
          <Card>
            <CardContent className="py-6 text-center text-muted-foreground" data-testid="text-no-cost-breakdown">
              No AI activity for this period.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="py-4 space-y-3">
              {costBreakdown.map((entry) => {
                const cost = Number(entry.totalCost) || 0;
                const barWidth = Math.max(2, (cost / maxBreakdownCost) * 100);
                return (
                  <div key={entry.actionType} className="space-y-1" data-testid={`cost-row-${entry.actionType}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{entry.actionType}</Badge>
                        <span className="text-muted-foreground">{Number(entry.count)} calls</span>
                      </div>
                      <span className="font-medium">${cost.toFixed(4)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}
      </div>

      <Separator />

      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-xl font-semibold" data-testid="text-audit-heading">Audit Log</h2>
          <Select value={actionFilter} onValueChange={setActionFilter}>
            <SelectTrigger className="w-[200px]" data-testid="select-action-filter">
              <SelectValue placeholder="Filter by action" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Actions</SelectItem>
              {actionTypes.map((type) => (
                <SelectItem key={type} value={type}>{type}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {auditLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredAudit.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center">
              <Brain className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground" data-testid="text-no-audit">No AI activity recorded yet.</p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="table-audit-log">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-3 font-medium">Action</th>
                      <th className="text-left p-3 font-medium">User</th>
                      <th className="text-left p-3 font-medium">Model</th>
                      <th className="text-right p-3 font-medium">Tokens In</th>
                      <th className="text-right p-3 font-medium">Tokens Out</th>
                      <th className="text-right p-3 font-medium">Cost</th>
                      <th className="text-left p-3 font-medium">Status</th>
                      <th className="text-left p-3 font-medium">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAudit.map((entry) => {
                      const cost = Number(entry.costEstimate) || 0;
                      const status = entry.approvalRequired
                        ? (entry.approvalStatus || "pending")
                        : "completed";
                      return (
                        <tr key={entry.id} className="border-b last:border-0" data-testid={`row-audit-${entry.id}`}>
                          <td className="p-3">
                            <Badge variant="outline" data-testid={`badge-action-type-${entry.id}`}>
                              {entry.actionType}
                            </Badge>
                          </td>
                          <td className="p-3">
                            <span className="flex items-center gap-1 text-muted-foreground" data-testid={`text-actor-${entry.id}`}>
                              <User className="h-3 w-3" />
                              {entry.actorName}
                            </span>
                          </td>
                          <td className="p-3 text-muted-foreground">{entry.model || "—"}</td>
                          <td className="p-3 text-right">{(entry.tokensIn || 0).toLocaleString()}</td>
                          <td className="p-3 text-right">{(entry.tokensOut || 0).toLocaleString()}</td>
                          <td className="p-3 text-right">${cost.toFixed(4)}</td>
                          <td className="p-3">
                            <Badge
                              variant={status === "completed" ? "default" : status === "pending" ? "secondary" : "destructive"}
                              data-testid={`badge-audit-status-${entry.id}`}
                            >
                              {status}
                            </Badge>
                          </td>
                          <td className="p-3 text-muted-foreground" data-testid={`text-audit-date-${entry.id}`}>
                            {new Date(entry.createdAt).toLocaleString()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {auditTotal > PAGE_SIZE && (
          <div className="flex flex-wrap items-center justify-between gap-2" data-testid="pagination-controls">
            <p className="text-sm text-muted-foreground" data-testid="text-pagination-info">
              Showing {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, auditTotal)} of {auditTotal}
            </p>
            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
                data-testid="button-prev-page"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm px-3" data-testid="text-page-number">
                Page {page} of {totalPages}
              </span>
              <Button
                size="icon"
                variant="outline"
                disabled={page >= totalPages}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                data-testid="button-next-page"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
