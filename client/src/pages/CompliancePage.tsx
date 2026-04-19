import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShieldAlert, AlertTriangle, CalendarClock, Loader2, ExternalLink, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { useFeaturePermission } from "@/hooks/use-dashboard-customization";

type ItemType = "DBE_CERT" | "SURETY_BOND" | "INSURANCE" | "WC_INSURANCE" | "LICENSE" | "PERMIT";
type PartyType = "CRM_ORG" | "PROJECT";
type Status = "ACTIVE" | "EXPIRING" | "EXPIRED";

interface ComplianceItem {
  id: string;
  type: ItemType;
  typeLabel: string;
  partyType: PartyType;
  partyId: string;
  partyName: string;
  identifier: string | null;
  agency: string | null;
  effectiveDate: string | null;
  expirationDate: string | null;
  daysUntilExpiry: number | null;
  status: Status;
  sourceUrl: string;
}

const TYPE_OPTIONS: { value: ItemType | "ALL"; label: string }[] = [
  { value: "ALL", label: "All types" },
  { value: "DBE_CERT", label: "DBE / Certification" },
  { value: "SURETY_BOND", label: "Surety Bond" },
  { value: "INSURANCE", label: "General Insurance" },
  { value: "WC_INSURANCE", label: "Workers Comp" },
  { value: "LICENSE", label: "Business License" },
  { value: "PERMIT", label: "Permit" },
];

const STATUS_OPTIONS: { value: Status | "ALL"; label: string }[] = [
  { value: "ALL", label: "All statuses" },
  { value: "ACTIVE", label: "Active (>45 days)" },
  { value: "EXPIRING", label: "Expiring (≤45 days)" },
  { value: "EXPIRED", label: "Expired" },
];

const PARTY_OPTIONS: { value: PartyType | "ALL"; label: string }[] = [
  { value: "ALL", label: "All parties" },
  { value: "CRM_ORG", label: "CRM organisations" },
  { value: "PROJECT", label: "Projects" },
];

function statusBadge(item: ComplianceItem) {
  if (item.daysUntilExpiry === null) {
    return <Badge variant="outline" data-testid={`badge-status-${item.id}`}>No expiration</Badge>;
  }
  if (item.daysUntilExpiry < 0) {
    return (
      <Badge variant="destructive" data-testid={`badge-status-${item.id}`}>
        Expired {Math.abs(item.daysUntilExpiry)}d ago
      </Badge>
    );
  }
  if (item.daysUntilExpiry <= 14) {
    return (
      <Badge variant="destructive" data-testid={`badge-status-${item.id}`}>
        {item.daysUntilExpiry === 0 ? "Expires today" : `${item.daysUntilExpiry}d left`}
      </Badge>
    );
  }
  if (item.daysUntilExpiry <= 45) {
    return (
      <Badge
        className="bg-amber-500 text-white hover:bg-amber-600"
        data-testid={`badge-status-${item.id}`}
      >
        {item.daysUntilExpiry}d left
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" data-testid={`badge-status-${item.id}`}>
      {item.daysUntilExpiry}d left
    </Badge>
  );
}

export default function CompliancePage() {
  const canView = useFeaturePermission("canViewComplianceDashboard");
  const [type, setType] = useState<ItemType | "ALL">("ALL");
  const [status, setStatus] = useState<Status | "ALL">("ALL");
  const [partyType, setPartyType] = useState<PartyType | "ALL">("ALL");
  const [agency, setAgency] = useState("");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<"type" | "party" | "agency" | "expires" | "status">("expires");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };
  const sortIcon = (key: typeof sortKey) => {
    if (sortKey !== key) return <ArrowUpDown className="inline h-3 w-3 ml-1 opacity-40" />;
    return sortDir === "asc"
      ? <ArrowUp className="inline h-3 w-3 ml-1" />
      : <ArrowDown className="inline h-3 w-3 ml-1" />;
  };

  const { data = [], isLoading, error } = useQuery<ComplianceItem[]>({
    queryKey: ["/api/compliance/expirations"],
    enabled: canView,
  });

  const counts = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let expired = 0;
    let week = 0;
    let month = 0;
    for (const it of data) {
      if (it.daysUntilExpiry === null) continue;
      if (it.daysUntilExpiry < 0) expired++;
      else if (it.daysUntilExpiry <= 7) week++;
      else if (it.daysUntilExpiry <= 30) month++;
    }
    return { expired, week, month, total: data.length };
  }, [data]);

  const agencies = useMemo(() => {
    const set = new Set<string>();
    for (const it of data) {
      if (it.agency) set.add(it.agency);
    }
    return Array.from(set).sort();
  }, [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filteredList = data.filter((it) => {
      if (type !== "ALL" && it.type !== type) return false;
      if (status !== "ALL" && it.status !== status) return false;
      if (partyType !== "ALL" && it.partyType !== partyType) return false;
      if (agency && it.agency !== agency) return false;
      if (q) {
        const hay = `${it.partyName} ${it.identifier ?? ""} ${it.agency ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    const cmp = (a: ComplianceItem, b: ComplianceItem): number => {
      switch (sortKey) {
        case "type":
          return a.typeLabel.localeCompare(b.typeLabel);
        case "party":
          return a.partyName.localeCompare(b.partyName);
        case "agency":
          return (a.agency ?? "").localeCompare(b.agency ?? "");
        case "status": {
          const order: Record<Status, number> = { EXPIRED: 0, EXPIRING: 1, ACTIVE: 2 };
          return order[a.status] - order[b.status];
        }
        case "expires":
        default: {
          const av = a.daysUntilExpiry ?? Number.POSITIVE_INFINITY;
          const bv = b.daysUntilExpiry ?? Number.POSITIVE_INFINITY;
          return av - bv;
        }
      }
    };
    return [...filteredList].sort((a, b) => cmp(a, b) * dir);
  }, [data, type, status, partyType, agency, search, sortKey, sortDir]);

  if (!canView) {
    return (
      <div className="container mx-auto p-6" data-testid="no-access-compliance">
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            You don't have permission to view the Compliance dashboard.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-compliance-heading">Compliance & Expirations</h1>
        <p className="text-sm text-muted-foreground">
          Unified view of DBE certifications, surety bonds, insurance, business licenses, and project permits across the organization.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card data-testid="card-summary-expired">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-destructive" /> Expired
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold text-destructive" data-testid="value-expired">{counts.expired}</div>
          </CardContent>
        </Card>
        <Card data-testid="card-summary-week">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" /> Expiring in 7 days
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold" data-testid="value-week">{counts.week}</div>
          </CardContent>
        </Card>
        <Card data-testid="card-summary-month">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-amber-500" /> Expiring in 30 days
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold" data-testid="value-month">{counts.month}</div>
          </CardContent>
        </Card>
        <Card data-testid="card-summary-total">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total tracked</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold" data-testid="value-total">{counts.total}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <Label className="text-xs text-muted-foreground">Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
              <SelectTrigger data-testid="select-filter-type"><SelectValue /></SelectTrigger>
              <SelectContent>{TYPE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
              <SelectTrigger data-testid="select-filter-status"><SelectValue /></SelectTrigger>
              <SelectContent>{STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Party</Label>
            <Select value={partyType} onValueChange={(v) => setPartyType(v as typeof partyType)}>
              <SelectTrigger data-testid="select-filter-party"><SelectValue /></SelectTrigger>
              <SelectContent>{PARTY_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Agency</Label>
            <Select value={agency || "ALL"} onValueChange={(v) => setAgency(v === "ALL" ? "" : v)}>
              <SelectTrigger data-testid="select-filter-agency"><SelectValue placeholder="All agencies" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All agencies</SelectItem>
                {agencies.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Search</Label>
            <Input
              placeholder="Party, ID, agency…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-filter-search"
            />
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="animate-spin h-5 w-5 mr-2" /> Loading compliance items…
        </div>
      ) : error ? (
        <Card><CardContent className="p-8 text-center text-destructive" data-testid="text-compliance-error">Failed to load compliance items.</CardContent></Card>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={ShieldAlert}
          title={data.length === 0 ? "No compliance items yet" : "No items match the current filters"}
          description={data.length === 0
            ? "Add DBE certifications, surety bonds, insurance, licenses, or permits — they will all appear here."
            : "Adjust the filters above to see more items."}
          testId="empty-compliance"
        />
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm" data-testid="table-compliance">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium">
                    <button type="button" onClick={() => toggleSort("type")} className="hover:underline" data-testid="sort-type">
                      Type{sortIcon("type")}
                    </button>
                  </th>
                  <th className="px-3 py-2 font-medium">
                    <button type="button" onClick={() => toggleSort("party")} className="hover:underline" data-testid="sort-party">
                      Party{sortIcon("party")}
                    </button>
                  </th>
                  <th className="px-3 py-2 font-medium">Identifier</th>
                  <th className="px-3 py-2 font-medium">
                    <button type="button" onClick={() => toggleSort("agency")} className="hover:underline" data-testid="sort-agency">
                      Agency / Carrier{sortIcon("agency")}
                    </button>
                  </th>
                  <th className="px-3 py-2 font-medium">
                    <button type="button" onClick={() => toggleSort("expires")} className="hover:underline" data-testid="sort-expires">
                      Expires{sortIcon("expires")}
                    </button>
                  </th>
                  <th className="px-3 py-2 font-medium">
                    <button type="button" onClick={() => toggleSort("status")} className="hover:underline" data-testid="sort-status">
                      Status{sortIcon("status")}
                    </button>
                  </th>
                  <th className="px-3 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((it) => (
                  <tr key={it.id} className="border-t" data-testid={`row-compliance-${it.id}`}>
                    <td className="px-3 py-2 align-top">{it.typeLabel}</td>
                    <td className="px-3 py-2 align-top">
                      <div className="font-medium" data-testid={`text-party-${it.id}`}>{it.partyName}</div>
                      <div className="text-xs text-muted-foreground">{it.partyType === "PROJECT" ? "Project" : "CRM organisation"}</div>
                    </td>
                    <td className="px-3 py-2 align-top">{it.identifier ?? "—"}</td>
                    <td className="px-3 py-2 align-top">{it.agency ?? "—"}</td>
                    <td className="px-3 py-2 align-top whitespace-nowrap">{it.expirationDate ?? "—"}</td>
                    <td className="px-3 py-2 align-top">{statusBadge(it)}</td>
                    <td className="px-3 py-2 align-top">
                      <Link
                        href={it.sourceUrl}
                        className="inline-flex items-center text-primary hover:underline text-xs"
                        data-testid={`link-source-${it.id}`}
                      >
                        Open <ExternalLink className="ml-1 h-3 w-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
