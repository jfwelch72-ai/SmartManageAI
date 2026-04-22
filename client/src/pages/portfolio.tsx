import { useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useSearch, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, X, ChevronRight, ArrowUp, ArrowDown, Minus } from "lucide-react";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";

type GroupBy = "program" | "division" | "trade" | "pm" | "none";
type ViewKey = "heatmap" | "gantt" | "financial";

interface DeltaPair { fourWeek: number | null; twelveWeek: number | null }
interface KpiCell { key: string; label: string; value: number; sparkline: number[]; tab: string; delta4w?: number | null }
interface HeatmapCell {
  projectId: string; code: string; name: string; status: string;
  pmName: string | null; clientName: string; state: string | null;
  health: number; spi: number; cpi: number; budgetVariancePct: number;
  openRfis: number; openCos: number; openPunch: number;
  schedulePct: number; expectedPct: number;
  daysToNextMilestone: number | null;
  deltas?: { health?: DeltaPair; spi?: DeltaPair; cpi?: DeltaPair };
  kpis: KpiCell[];
}
interface HeatmapGroup {
  key: string; label: string; cells: HeatmapCell[];
  summary: { projectCount: number; avgHealth: number; avgSpi: number; avgCpi: number;
    totalOpenRfis: number; totalOpenCos: number; totalOpenPunch: number; };
}
interface GanttBar {
  projectId: string; code: string; name: string; status: string;
  pmName: string | null; clientName: string; state: string | null;
  start: string; end: string;
  milestones: { name: string; plannedEndDate: string | null; percentComplete: number }[];
  group: { key: string; label: string };
}
interface GanttGroup { key: string; label: string; bars: GanttBar[]; }
interface FinancialCell {
  projectId: string; code: string; name: string; status: string;
  pmName: string | null; clientName: string; state: string | null;
  contractAmount: number; actualCost: number; forecastFinal: number;
  variance: number; variancePct: number; margin: number;
  status_health: string; weeklyBurn: number; sparkline: number[];
  deltas?: { burn?: DeltaPair };
}
interface FinancialGroup {
  key: string; label: string; cells: FinancialCell[];
  summary: { projectCount: number; totalContract: number; totalActual: number;
    totalForecast: number; totalVariance: number; variancePct: number; };
}

const STATUS_OPTIONS = ["PLANNING", "ACTIVE", "COMPLETE", "CLOSED", "BID"];

function useUrlState() {
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const get = (k: string) => params.get(k);
  const set = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(search);
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    setLocation(qs ? `${location}?${qs}` : location);
  };
  return { get, set };
}

function fmtCurrency(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);
}

function healthBgColor(h: number) {
  if (h >= 80) return "bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-300";
  if (h >= 60) return "bg-amber-500/15 border-amber-500/40 text-amber-700 dark:text-amber-300";
  return "bg-red-500/15 border-red-500/40 text-red-700 dark:text-red-300";
}

function formatDeltaNumber(n: number): string {
  const abs = Math.abs(n);
  const fixed = abs >= 100 ? abs.toFixed(0) : abs.toFixed(abs >= 10 ? 1 : 2);
  const trimmed = fixed.replace(/\.?0+$/, "");
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${trimmed || "0"}`;
}

function DeltaBadge({
  value,
  label,
  inverse = false,
  testId,
}: {
  value: number | null | undefined;
  label?: string;
  inverse?: boolean;
  testId?: string;
}) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return (
      <span
        className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground"
        title={label ? `${label}: insufficient history` : "Insufficient history"}
        data-testid={testId}
      >
        <Minus className="h-2.5 w-2.5" />—
      </span>
    );
  }
  const rounded = Math.round(value * 100) / 100;
  if (rounded === 0) {
    return (
      <span
        className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground"
        title={label ? `${label}: no change` : "No change"}
        data-testid={testId}
      >
        <Minus className="h-2.5 w-2.5" />0
      </span>
    );
  }
  const isUp = rounded > 0;
  const good = inverse ? !isUp : isUp;
  const colorClass = good
    ? "text-emerald-700 dark:text-emerald-400"
    : "text-red-700 dark:text-red-400";
  const Icon = isUp ? ArrowUp : ArrowDown;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[10px] font-medium ${colorClass}`}
      title={label ? `${label} ${formatDeltaNumber(rounded)}` : undefined}
      data-testid={testId}
    >
      <Icon className="h-2.5 w-2.5" />
      {formatDeltaNumber(rounded)}
    </span>
  );
}

function Sparkline({ data, stroke = "currentColor" }: { data: number[]; stroke?: string }) {
  const series = data.map((v, i) => ({ i, v }));
  if (series.length === 0) return <div className="h-6" />;
  return (
    <div className="h-6 w-full" data-testid="sparkline">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={series}>
          <Line type="monotone" dataKey="v" stroke={stroke} strokeWidth={1.5} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function buildQs(filters: PortfolioFilters): string {
  const u = new URLSearchParams();
  u.set("groupBy", filters.groupBy);
  if (filters.statuses.length) u.set("status", filters.statuses.join(","));
  if (filters.ownerId) u.set("ownerId", filters.ownerId);
  if (filters.startAfter) u.set("startAfter", filters.startAfter);
  if (filters.endBefore) u.set("endBefore", filters.endBefore);
  if (filters.minHealth !== null) u.set("minHealth", String(filters.minHealth));
  return u.toString();
}

interface PortfolioFilters {
  groupBy: GroupBy;
  statuses: string[];
  ownerId: string | null;
  startAfter: string | null;
  endBefore: string | null;
  minHealth: number | null;
}

interface OwnerOption { id: string; name: string }

function FilterBar({
  view, filters, owners, onChangeView, onChangeFilter, onToggleStatus, onClear,
}: {
  view: ViewKey;
  filters: PortfolioFilters;
  owners: OwnerOption[];
  onChangeView: (v: ViewKey) => void;
  onChangeFilter: (patch: Partial<PortfolioFilters>) => void;
  onToggleStatus: (s: string) => void;
  onClear: () => void;
}) {
  const hasFilters =
    filters.statuses.length > 0 || !!filters.ownerId || !!filters.startAfter || !!filters.endBefore || filters.minHealth !== null;
  return (
    <div className="space-y-3 mb-4">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={view} onValueChange={(v) => onChangeView(v as ViewKey)}>
          <TabsList>
            <TabsTrigger value="heatmap" data-testid="tab-heatmap">Health Heatmap</TabsTrigger>
            <TabsTrigger value="gantt" data-testid="tab-gantt">Portfolio Gantt</TabsTrigger>
            <TabsTrigger value="financial" data-testid="tab-financial">Financial Rollup</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Group by:</span>
          <Select value={filters.groupBy} onValueChange={(v) => onChangeFilter({ groupBy: v as GroupBy })}>
            <SelectTrigger className="w-[170px]" data-testid="select-groupby">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="program">Program (Client)</SelectItem>
              <SelectItem value="division">Division (State)</SelectItem>
              <SelectItem value="trade">Trade</SelectItem>
              <SelectItem value="pm">Project Manager</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">Status:</span>
        {STATUS_OPTIONS.map((s) => {
          const active = filters.statuses.includes(s);
          return (
            <Badge
              key={s}
              variant={active ? "default" : "outline"}
              className="cursor-pointer select-none"
              onClick={() => onToggleStatus(s)}
              data-testid={`chip-status-${s}`}
            >
              {s}
            </Badge>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase text-muted-foreground">PM:</span>
          <Select
            value={filters.ownerId ?? "all"}
            onValueChange={(v) => onChangeFilter({ ownerId: v === "all" ? null : v })}
          >
            <SelectTrigger className="w-[180px]" data-testid="select-owner">
              <SelectValue placeholder="Any" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any PM</SelectItem>
              {owners.map((o) => (
                <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase text-muted-foreground">Start after:</span>
          <Input
            type="date"
            className="h-9 w-[150px]"
            value={filters.startAfter ?? ""}
            onChange={(e) => onChangeFilter({ startAfter: e.target.value || null })}
            data-testid="input-start-after"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase text-muted-foreground">End before:</span>
          <Input
            type="date"
            className="h-9 w-[150px]"
            value={filters.endBefore ?? ""}
            onChange={(e) => onChangeFilter({ endBefore: e.target.value || null })}
            data-testid="input-end-before"
          />
        </div>
        <div className="flex items-center gap-2 min-w-[220px]">
          <span className="text-xs uppercase text-muted-foreground whitespace-nowrap">Min health:</span>
          <Slider
            min={0}
            max={100}
            step={5}
            value={[filters.minHealth ?? 0]}
            onValueChange={(v) => onChangeFilter({ minHealth: v[0] === 0 ? null : v[0] })}
            className="w-[140px]"
            data-testid="slider-min-health"
          />
          <span className="text-xs w-8 text-right" data-testid="text-min-health">{filters.minHealth ?? 0}</span>
        </div>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={onClear} data-testid="button-clear-filters">
            <X className="h-3 w-3 mr-1" /> Clear filters
          </Button>
        )}
      </div>
    </div>
  );
}

function HeatmapView({ filters }: { filters: PortfolioFilters }) {
  const qs = useMemo(() => buildQs(filters), [filters]);
  const { data, isLoading } = useQuery<{ groups: HeatmapGroup[]; kpiKeys: string[] }>({
    queryKey: ["/api/portfolio/health-heatmap", qs],
    queryFn: async () => {
      const res = await fetch(`/api/portfolio/health-heatmap?${qs}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load heatmap");
      return res.json();
    },
  });
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  const groups = data?.groups || [];
  if (groups.length === 0) return <p className="text-muted-foreground" data-testid="text-empty-heatmap">No projects match the selected filters.</p>;

  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <Card key={g.key} data-testid={`group-heatmap-${g.key}`}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base" data-testid={`text-group-label-${g.key}`}>{g.label}</CardTitle>
              <div className="flex gap-3 text-xs text-muted-foreground">
                <span data-testid={`text-group-count-${g.key}`}>{g.summary.projectCount} projects</span>
                <span>Avg health <strong className="text-foreground">{g.summary.avgHealth}</strong></span>
                <span>SPI <strong className="text-foreground">{g.summary.avgSpi}</strong></span>
                <span>CPI <strong className="text-foreground">{g.summary.avgCpi}</strong></span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th className="text-left font-medium py-1 sticky left-0 bg-background">Project</th>
                  {(g.cells[0]?.kpis || []).map((k) => (
                    <th key={k.key} className="text-left font-medium py-1 px-2">{k.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {g.cells.map((c) => (
                  <tr key={c.projectId} className="border-t" data-testid={`row-heatmap-${c.code}`}>
                    <td className="py-2 sticky left-0 bg-background min-w-[200px]">
                      <Link href={`/projects/${c.code}?tab=overview`}>
                        <div className="cursor-pointer hover-elevate -mx-1 px-1 rounded">
                          <div className="font-mono text-[10px] text-muted-foreground">{c.code}</div>
                          <div className="font-semibold leading-tight" data-testid={`text-project-name-${c.code}`}>{c.name}</div>
                          <div className="text-[10px] text-muted-foreground">{c.pmName ?? "—"} · {c.status}</div>
                        </div>
                      </Link>
                    </td>
                    {c.kpis.map((k) => {
                      const pair = (c.deltas as Record<string, DeltaPair | undefined> | undefined)?.[k.key];
                      const delta4 = pair?.fourWeek ?? k.delta4w ?? null;
                      const delta12 = pair?.twelveWeek ?? null;
                      const hasDeltaContract = pair !== undefined || k.delta4w !== undefined;
                      return (
                        <td key={k.key} className="py-2 px-2 align-middle min-w-[140px]" data-testid={`cell-kpi-${c.code}-${k.key}`}>
                          <Link href={`/projects/${c.code}?tab=${k.tab}`}>
                            <div className={`p-2 rounded border ${k.key === "health" ? healthBgColor(k.value) : "bg-muted/40 border-transparent"} hover-elevate cursor-pointer`}>
                              <div className="flex items-baseline justify-between gap-2">
                                <span className="text-base font-semibold" data-testid={`text-kpi-value-${c.code}-${k.key}`}>{k.value}</span>
                                {hasDeltaContract && (
                                  <DeltaBadge
                                    value={delta4}
                                    label={`${k.label} vs 4 wks ago`}
                                    testId={`delta-4w-${c.code}-${k.key}`}
                                  />
                                )}
                              </div>
                              <Sparkline data={k.sparkline} />
                              {hasDeltaContract && (
                                <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                                  <span>vs 12w</span>
                                  <DeltaBadge
                                    value={delta12}
                                    label={`${k.label} vs 12 wks ago`}
                                    testId={`delta-12w-${c.code}-${k.key}`}
                                  />
                                </div>
                              )}
                            </div>
                          </Link>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function GanttView({ filters }: { filters: PortfolioFilters }) {
  const qs = useMemo(() => buildQs(filters), [filters]);
  const { data, isLoading } = useQuery<{ groups: GanttGroup[] }>({
    queryKey: ["/api/portfolio/gantt", qs],
    queryFn: async () => {
      const res = await fetch(`/api/portfolio/gantt?${qs}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load gantt");
      return res.json();
    },
  });
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  const groups = data?.groups || [];
  if (groups.length === 0) return <p className="text-muted-foreground" data-testid="text-empty-gantt">No projects with start/end dates.</p>;

  const allBars = groups.flatMap((g) => g.bars);
  const minTime = Math.min(...allBars.map((b) => new Date(b.start).getTime()));
  const maxTime = Math.max(...allBars.map((b) => new Date(b.end).getTime()));
  const span = Math.max(1, maxTime - minTime);

  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <Card key={g.key} data-testid={`group-gantt-${g.key}`}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{g.label} <span className="text-xs text-muted-foreground">({g.bars.length})</span></CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {g.bars.map((b) => {
                const startPct = ((new Date(b.start).getTime() - minTime) / span) * 100;
                const widthPct = ((new Date(b.end).getTime() - new Date(b.start).getTime()) / span) * 100;
                return (
                  <div key={b.projectId} className="flex items-center gap-3" data-testid={`gantt-row-${b.code}`}>
                    <Link href={`/projects/${b.code}?tab=schedule`} className="w-56 truncate text-sm hover:underline" data-testid={`link-gantt-${b.code}`}>
                      <span className="font-mono text-xs text-muted-foreground mr-2">{b.code}</span>{b.name}
                    </Link>
                    <div className="relative flex-1 h-6 bg-muted/40 rounded">
                      <div
                        className="absolute top-1 h-4 rounded bg-primary/70"
                        style={{ left: `${startPct}%`, width: `${widthPct}%` }}
                        title={`${b.start.slice(0,10)} → ${b.end.slice(0,10)}`}
                      />
                      {b.milestones.map((m, idx) =>
                        m.plannedEndDate ? (
                          <div
                            key={idx}
                            className="absolute top-0 h-6 w-2 -translate-x-1"
                            style={{
                              left: `${((new Date(m.plannedEndDate).getTime() - minTime) / span) * 100}%`,
                            }}
                            title={m.name}
                          >
                            <div className="w-2 h-2 rotate-45 bg-amber-500 mt-2" />
                          </div>
                        ) : null
                      )}
                    </div>
                    <div className="w-16 text-right text-xs text-muted-foreground">{b.status}</div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function FinancialView({ filters }: { filters: PortfolioFilters }) {
  const qs = useMemo(() => buildQs(filters), [filters]);
  const { data, isLoading } = useQuery<{ groups: FinancialGroup[]; totals: { projectCount: number; totalContract: number; totalActual: number; totalForecast: number; totalVariance: number } }>({
    queryKey: ["/api/portfolio/financial-rollup", qs],
    queryFn: async () => {
      const res = await fetch(`/api/portfolio/financial-rollup?${qs}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load financial rollup");
      return res.json();
    },
  });
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  const groups = data?.groups || [];
  if (groups.length === 0) return <p className="text-muted-foreground" data-testid="text-empty-financial">No financial data.</p>;

  return (
    <div className="space-y-4">
      {data?.totals && (
        <Card data-testid="card-portfolio-totals">
          <CardContent className="pt-6 grid grid-cols-2 md:grid-cols-5 gap-4">
            <div><div className="text-xs uppercase text-muted-foreground">Projects</div><div className="text-xl font-semibold" data-testid="text-total-projects">{data.totals.projectCount}</div></div>
            <div><div className="text-xs uppercase text-muted-foreground">Contract</div><div className="text-xl font-semibold" data-testid="text-total-contract">{fmtCurrency(data.totals.totalContract)}</div></div>
            <div><div className="text-xs uppercase text-muted-foreground">Actual</div><div className="text-xl font-semibold" data-testid="text-total-actual">{fmtCurrency(data.totals.totalActual)}</div></div>
            <div><div className="text-xs uppercase text-muted-foreground">Forecast</div><div className="text-xl font-semibold" data-testid="text-total-forecast">{fmtCurrency(data.totals.totalForecast)}</div></div>
            <div><div className="text-xs uppercase text-muted-foreground">Variance</div><div className={`text-xl font-semibold ${data.totals.totalVariance < 0 ? "text-red-600" : "text-emerald-600"}`} data-testid="text-total-variance">{fmtCurrency(data.totals.totalVariance)}</div></div>
          </CardContent>
        </Card>
      )}
      {groups.map((g) => (
        <Card key={g.key} data-testid={`group-financial-${g.key}`}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">{g.label}</CardTitle>
              <div className="flex gap-4 text-xs text-muted-foreground">
                <span>Contract <strong className="text-foreground">{fmtCurrency(g.summary.totalContract)}</strong></span>
                <span>Actual <strong className="text-foreground">{fmtCurrency(g.summary.totalActual)}</strong></span>
                <span>Forecast <strong className="text-foreground">{fmtCurrency(g.summary.totalForecast)}</strong></span>
                <span>Var % <strong className={g.summary.variancePct < 0 ? "text-red-600" : "text-emerald-600"}>{g.summary.variancePct}%</strong></span>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="text-left py-1">Project</th>
                  <th className="text-left py-1">PM</th>
                  <th className="text-right py-1">Contract</th>
                  <th className="text-right py-1">Actual</th>
                  <th className="text-right py-1">Forecast</th>
                  <th className="text-right py-1">Var %</th>
                  <th className="text-right py-1">Margin %</th>
                  <th className="text-left py-1">12-wk Burn</th>
                  <th className="py-1"></th>
                </tr>
              </thead>
              <tbody>
                {g.cells.map((c) => (
                  <tr key={c.projectId} className="border-t" data-testid={`row-fin-${c.code}`}>
                    <td className="py-2"><div className="font-mono text-xs text-muted-foreground">{c.code}</div><div>{c.name}</div></td>
                    <td className="py-2">{c.pmName ?? "—"}</td>
                    <td className="py-2 text-right">{fmtCurrency(c.contractAmount)}</td>
                    <td className="py-2 text-right">{fmtCurrency(c.actualCost)}</td>
                    <td className="py-2 text-right">{fmtCurrency(c.forecastFinal)}</td>
                    <td className={`py-2 text-right ${c.variancePct < 0 ? "text-red-600" : "text-emerald-600"}`} data-testid={`text-fin-var-${c.code}`}>{c.variancePct}%</td>
                    <td className="py-2 text-right">{c.margin}%</td>
                    <td className="py-2 min-w-[140px]">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex-1"><Sparkline data={c.sparkline} /></div>
                        <DeltaBadge
                          value={c.deltas?.burn?.fourWeek ?? null}
                          label="Burn vs 4 wks ago"
                          inverse
                          testId={`delta-burn-4w-${c.code}`}
                        />
                      </div>
                      <div className="mt-0.5 flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>vs 12w</span>
                        <DeltaBadge
                          value={c.deltas?.burn?.twelveWeek ?? null}
                          label="Burn vs 12 wks ago"
                          inverse
                          testId={`delta-burn-12w-${c.code}`}
                        />
                      </div>
                    </td>
                    <td className="py-2 text-right">
                      <Link href={`/projects/${c.code}?tab=financials`}>
                        <Button variant="ghost" size="sm" data-testid={`button-drill-${c.code}`}>
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function PortfolioPage() {
  const { get, set } = useUrlState();
  const view = (get("view") as ViewKey) || "heatmap";

  const filters: PortfolioFilters = {
    groupBy: ((get("groupBy") as GroupBy) || "none"),
    statuses: (get("status") || "").split(",").filter(Boolean),
    ownerId: get("ownerId"),
    startAfter: get("startAfter"),
    endBefore: get("endBefore"),
    minHealth: get("minHealth") ? Number(get("minHealth")) : null,
  };

  const { data: ownerData } = useQuery<{ owners: OwnerOption[] }>({
    queryKey: ["/api/portfolio/owners"],
    queryFn: async () => {
      const res = await fetch("/api/portfolio/owners", { credentials: "include" });
      if (!res.ok) return { owners: [] };
      return res.json();
    },
  });

  const onChangeView = (v: ViewKey) => set({ view: v === "heatmap" ? null : v });
  const onChangeFilter = (patch: Partial<PortfolioFilters>) => {
    const updates: Record<string, string | null> = {};
    if ("groupBy" in patch) updates.groupBy = patch.groupBy === "none" ? null : (patch.groupBy as string);
    if ("ownerId" in patch) updates.ownerId = patch.ownerId ?? null;
    if ("startAfter" in patch) updates.startAfter = patch.startAfter ?? null;
    if ("endBefore" in patch) updates.endBefore = patch.endBefore ?? null;
    if ("minHealth" in patch) updates.minHealth = patch.minHealth === null ? null : String(patch.minHealth);
    set(updates);
  };
  const onToggleStatus = (s: string) => {
    const next = filters.statuses.includes(s) ? filters.statuses.filter((x) => x !== s) : [...filters.statuses, s];
    set({ status: next.length ? next.join(",") : null });
  };
  const onClear = () => set({ status: null, ownerId: null, startAfter: null, endBefore: null, minHealth: null });

  const { toast } = useToast();

  const handleExport = useCallback(async () => {
    const qs = buildQs(filters);
    try {
      const res = await fetch(`/api/portfolio/summary-pdf?${qs}`, { credentials: "include" });
      if (!res.ok) {
        let detail = "";
        try {
          const ct = res.headers.get("content-type") || "";
          if (ct.includes("application/json")) {
            const body = await res.json();
            detail = body?.detail || body?.error || "";
          }
        } catch {}
        const isRendererOffline = res.status === 503 || res.status === 500;
        toast({
          variant: "destructive",
          title: isRendererOffline ? "Portfolio export unavailable" : "Export failed",
          description: isRendererOffline
            ? (detail || "The PDF renderer is offline. Please contact an administrator to restore portfolio exports.")
            : (detail || `The export request failed (status ${res.status}). Please try again.`),
          action: (
            <ToastAction altText="Retry export" onClick={() => { void handleExport(); }} data-testid="button-retry-export">
              Retry
            </ToastAction>
          ),
        });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const ct = res.headers.get("content-type") || "";
      a.download = `portfolio-summary.${ct.includes("pdf") ? "pdf" : "html"}`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Export failed",
        description: "Could not reach the server. Check your connection and try again.",
        action: (
          <ToastAction altText="Retry export" onClick={() => { void handleExport(); }} data-testid="button-retry-export">
            Retry
          </ToastAction>
        ),
      });
    }
  }, [filters, toast]);

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Portfolio Rollup</h1>
          <p className="text-sm text-muted-foreground">Cross-project health, schedule, and financial view for executives.</p>
        </div>
        <Button onClick={handleExport} data-testid="button-export-pdf">
          <Download className="h-4 w-4 mr-2" /> Export Summary
        </Button>
      </div>

      <FilterBar
        view={view}
        filters={filters}
        owners={ownerData?.owners || []}
        onChangeView={onChangeView}
        onChangeFilter={onChangeFilter}
        onToggleStatus={onToggleStatus}
        onClear={onClear}
      />

      <div className="mt-2">
        {view === "heatmap" && <HeatmapView filters={filters} />}
        {view === "gantt" && <GanttView filters={filters} />}
        {view === "financial" && <FinancialView filters={filters} />}
      </div>
    </div>
  );
}
