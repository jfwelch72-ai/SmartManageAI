import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { AlertTriangle, Download, Mail, ShieldCheck, ShieldAlert } from "lucide-react";

interface DashboardCertRow {
  id: string;
  partyType: string;
  partyId: string;
  partyName: string;
  carrier: string;
  policyNumber: string;
  expiryDate: string;
  daysUntilExpiry: number;
  status: "ACTIVE" | "EXPIRING" | "EXPIRED";
  additionalInsured: boolean;
  waiverOfSubrogation: boolean;
}

interface DashboardPartyRow {
  projectId: string;
  projectName: string;
  partyType: string;
  partyId: string;
  partyName: string;
  status: "COMPLIANT" | "EXPIRING" | "EXPIRED" | "MISSING";
  reasons: string[];
}

interface DashboardResponse {
  summary: { compliant: number; expiring: number; expired: number; missing: number; projectsEvaluated: number };
  parties: DashboardPartyRow[];
  certificates: DashboardCertRow[];
  enforcementEnabled: boolean;
}

type StatusFilter = "ALL" | "ACTIVE" | "EXPIRING" | "EXPIRED";
const STATUS_FILTER_VALUES: readonly StatusFilter[] = ["ALL", "ACTIVE", "EXPIRING", "EXPIRED"];

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  ACTIVE: { label: "Compliant", variant: "default" },
  COMPLIANT: { label: "Compliant", variant: "default" },
  EXPIRING: { label: "Expiring", variant: "secondary" },
  EXPIRED: { label: "Expired", variant: "destructive" },
  MISSING: { label: "Missing", variant: "destructive" },
};

export default function CoiCompliancePage() {
  const { toast } = useToast();
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery<DashboardResponse>({
    queryKey: ["/api/coi/dashboard"],
  });

  const visible = useMemo(() => {
    const certs = data?.certificates ?? [];
    return certs.filter((c) => {
      if (statusFilter !== "ALL" && c.status !== statusFilter) return false;
      if (!filter) return true;
      const hay = `${c.partyName} ${c.carrier} ${c.policyNumber}`.toLowerCase();
      return hay.includes(filter.toLowerCase());
    });
  }, [data, filter, statusFilter]);

  const bulkRemind = useMutation({
    mutationFn: async (ids: string[]) =>
      apiRequest("POST", "/api/coi/reminders/bulk", { certificateIds: ids }),
    onSuccess: async (resp) => {
      const json = await resp.json();
      toast({
        title: "Reminders sent",
        description: `Sent ${json.sent} of ${json.total} (${json.failed} failed)`,
      });
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/coi/dashboard"] });
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Failed to send reminders", description: msg, variant: "destructive" });
    },
  });

  const toggle = (id: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const toggleAll = () => {
    if (selected.size === visible.length) setSelected(new Set());
    else setSelected(new Set(visible.map((v) => v.id)));
  };

  const summary = data?.summary ?? { compliant: 0, expiring: 0, expired: 0, missing: 0, projectsEvaluated: 0 };
  const parties = data?.parties ?? [];
  const nonCompliantParties = useMemo(
    () => parties.filter((p) => p.status !== "COMPLIANT"),
    [parties],
  );

  return (
    <div className="p-6 space-y-6" data-testid="page-coi-compliance">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-coi-title">Insurance / COI Compliance</h1>
          <p className="text-muted-foreground text-sm">
            Track every certificate of insurance, expiry windows, and required endorsements.
          </p>
        </div>
        <a
          href="/api/coi/dashboard.csv"
          className="inline-flex items-center gap-2 px-3 py-2 border rounded-md text-sm hover-elevate"
          data-testid="link-export-csv"
        >
          <Download className="h-4 w-4" /> Export CSV
        </a>
      </div>

      {data && !data.enforcementEnabled && (
        <div
          className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-4 py-2 text-sm text-amber-900 dark:text-amber-200"
          data-testid="banner-enforcement-off"
        >
          COI compliance hold is OFF — non-compliant parties are surfaced here but pay-app, PO, and payable approvals are not blocked.
          A Super Admin can enable the <code>COI_COMPLIANCE_HOLD</code> feature flag to start enforcement.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard label="Compliant parties" value={summary.compliant} tone="success" icon={<ShieldCheck className="h-5 w-5" />} testid="stat-compliant" />
        <SummaryCard label="Expiring (≤30d)" value={summary.expiring} tone="warning" icon={<AlertTriangle className="h-5 w-5" />} testid="stat-expiring" />
        <SummaryCard label="Expired" value={summary.expired} tone="danger" icon={<ShieldAlert className="h-5 w-5" />} testid="stat-expired" />
        <SummaryCard label="Missing" value={summary.missing} tone="danger" icon={<ShieldAlert className="h-5 w-5" />} testid="stat-missing" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Non-compliant project parties ({nonCompliantParties.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {nonCompliantParties.length === 0 ? (
            <div className="text-sm text-muted-foreground" data-testid="text-no-noncompliant">
              All project parties are compliant across {summary.projectsEvaluated} project(s).
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Party</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {nonCompliantParties.map((p) => (
                  <TableRow key={`${p.projectId}-${p.partyType}-${p.partyId}`} data-testid={`row-party-${p.projectId}-${p.partyId}`}>
                    <TableCell>{p.projectName}</TableCell>
                    <TableCell>{p.partyName}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{p.partyType}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_BADGE[p.status]?.variant ?? "outline"} data-testid={`status-party-${p.partyId}`}>
                        {STATUS_BADGE[p.status]?.label ?? p.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{p.reasons.join("; ")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle>Certificates</CardTitle>
          <div className="flex items-center gap-2">
            <Input
              placeholder="Search by party / carrier / policy"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-64"
              data-testid="input-coi-filter"
            />
            <select
              value={statusFilter}
              onChange={(e) => {
                const v = e.target.value;
                if ((STATUS_FILTER_VALUES as readonly string[]).includes(v)) {
                  setStatusFilter(v as StatusFilter);
                }
              }}
              className="px-3 py-2 text-sm border rounded-md bg-background"
              data-testid="select-status-filter"
            >
              <option value="ALL">All</option>
              <option value="ACTIVE">Compliant</option>
              <option value="EXPIRING">Expiring</option>
              <option value="EXPIRED">Expired</option>
            </select>
            <Button
              size="sm"
              onClick={() => bulkRemind.mutate(Array.from(selected))}
              disabled={selected.size === 0 || bulkRemind.isPending}
              data-testid="button-bulk-remind"
            >
              <Mail className="h-4 w-4 mr-1" />
              Remind ({selected.size})
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center text-muted-foreground py-8" data-testid="loading-coi">Loading…</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px]">
                    <Checkbox
                      checked={selected.size > 0 && selected.size === visible.length}
                      onCheckedChange={toggleAll}
                      data-testid="checkbox-select-all"
                    />
                  </TableHead>
                  <TableHead>Party</TableHead>
                  <TableHead>Carrier</TableHead>
                  <TableHead>Policy #</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Days</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Endorsements</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((c) => (
                  <TableRow key={c.id} data-testid={`row-cert-${c.id}`}>
                    <TableCell>
                      <Checkbox
                        checked={selected.has(c.id)}
                        onCheckedChange={() => toggle(c.id)}
                        data-testid={`checkbox-cert-${c.id}`}
                      />
                    </TableCell>
                    <TableCell data-testid={`text-party-${c.id}`}>{c.partyName}</TableCell>
                    <TableCell>{c.carrier}</TableCell>
                    <TableCell>{c.policyNumber}</TableCell>
                    <TableCell>{new Date(c.expiryDate).toLocaleDateString()}</TableCell>
                    <TableCell className={c.daysUntilExpiry < 0 ? "text-destructive" : c.daysUntilExpiry <= 30 ? "text-amber-600" : ""}>
                      {c.daysUntilExpiry}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_BADGE[c.status]?.variant ?? "outline"} data-testid={`status-${c.id}`}>
                        {STATUS_BADGE[c.status]?.label ?? c.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs space-x-1">
                      {c.additionalInsured && <Badge variant="outline">AI</Badge>}
                      {c.waiverOfSubrogation && <Badge variant="outline">WoS</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
                {visible.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                      No certificates match.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
  icon,
  testid,
}: {
  label: string;
  value: number;
  tone?: "success" | "warning" | "danger";
  icon?: React.ReactNode;
  testid: string;
}) {
  const toneClass =
    tone === "danger"
      ? "text-destructive"
      : tone === "warning"
      ? "text-amber-600"
      : tone === "success"
      ? "text-emerald-600"
      : "";
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{label}</span>
          {icon}
        </div>
        <div className={`text-3xl font-bold ${toneClass}`} data-testid={testid}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
