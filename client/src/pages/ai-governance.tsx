import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Brain, Zap, DollarSign, Activity, Loader2 } from "lucide-react";

interface AIUsage {
  actionCount: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCost: number;
}

interface AuditEntry {
  id: string;
  actionType: string;
  actorUserId: string | null;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costEstimate: string | null;
  rationale: string | null;
  approvalRequired: boolean;
  approvalStatus: string | null;
  createdAt: string;
}

export default function AIGovernancePage() {
  const [actionFilter, setActionFilter] = useState<string>("all");

  const { data: usage, isLoading: usageLoading } = useQuery<AIUsage>({
    queryKey: ["/api/ai-governance/usage"],
  });

  const { data: auditLog, isLoading: auditLoading } = useQuery<AuditEntry[]>({
    queryKey: ["/api/ai-governance/audit"],
  });

  const isLoading = usageLoading || auditLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const totalTokens = (Number(usage?.totalTokensIn) || 0) + (Number(usage?.totalTokensOut) || 0);

  const usageCards = [
    {
      label: "Actions Today",
      value: Number(usage?.actionCount) || 0,
      icon: Activity,
      color: "text-blue-500",
      format: (v: number) => v.toLocaleString(),
    },
    {
      label: "Tokens Used",
      value: totalTokens,
      icon: Zap,
      color: "text-yellow-500",
      format: (v: number) => v.toLocaleString(),
    },
    {
      label: "Cost Today",
      value: Number(usage?.totalCost) || 0,
      icon: DollarSign,
      color: "text-green-500",
      format: (v: number) => `$${v.toFixed(2)}`,
    },
  ];

  const actionTypes = Array.from(new Set((auditLog || []).map(e => e.actionType)));

  const filteredAudit = actionFilter === "all"
    ? (auditLog || [])
    : (auditLog || []).filter(e => e.actionType === actionFilter);

  return (
    <div className="px-3 sm:px-6 py-4 sm:py-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-ai-governance-title">AI Governance</h1>
        <p className="text-muted-foreground" data-testid="text-ai-governance-description">
          Monitor AI usage, enforce limits, and review the audit trail
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {usageCards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.label} data-testid={`card-usage-${card.label.toLowerCase().replace(/\s+/g, "-")}`}>
              <CardContent className="flex items-center gap-3 py-4">
                <div className="p-2 rounded-lg bg-muted">
                  <Icon className={`h-5 w-5 ${card.color}`} />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{card.label}</p>
                  <p className="text-2xl font-bold" data-testid={`text-usage-value-${card.label.toLowerCase().replace(/\s+/g, "-")}`}>
                    {card.format(card.value)}
                  </p>
                </div>
              </CardContent>
            </Card>
          );
        })}
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

        {filteredAudit.length === 0 ? (
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
      </div>
    </div>
  );
}
