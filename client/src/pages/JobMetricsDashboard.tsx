import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, RefreshCw, XCircle, Activity, AlertTriangle, Bell, Trash2, PlayCircle, Check, BellOff, Mail, MailWarning, MoonStar, Send } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface JobMetricSample {
  timestamp: number;
  counters: Record<string, number>;
}

interface JobMetricsResponse {
  job: string;
  windowMs: number;
  samples: JobMetricSample[];
  totals: Record<string, number>;
  latest: JobMetricSample | null;
}

interface JobsListResponse {
  jobs: JobMetricsResponse[];
  range: RangeKey;
}

type RangeKey = "24h" | "7d" | "30d";

const RANGE_OPTIONS: Array<{ value: RangeKey; label: string }> = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
];

const ALERTS_KEY = ["/api/admin/metrics/jobs/alerts"] as const;
const DIGESTS_KEY = ["/api/admin/metrics/jobs/alerts/digests"] as const;
const REFRESH_INTERVAL_MS = 60_000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

interface RangeConfig {
  bucketCount: number;
  bucketMs: number;
  formatLabel: (ts: number) => string;
  tooltipLabel: (label: string) => string;
  xAxisInterval: number;
  emptyMessage: string;
}

const RANGE_CONFIG: Record<RangeKey, RangeConfig> = {
  "24h": {
    bucketCount: 24,
    bucketMs: HOUR_MS,
    formatLabel: (ts) => `${new Date(ts).getHours().toString().padStart(2, "0")}:00`,
    tooltipLabel: (label) => `Hour ${label}`,
    xAxisInterval: 3,
    emptyMessage: "No samples in the last 24h.",
  },
  "7d": {
    bucketCount: 7,
    bucketMs: DAY_MS,
    formatLabel: (ts) => new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    tooltipLabel: (label) => `Day ${label}`,
    xAxisInterval: 0,
    emptyMessage: "No samples in the last 7 days.",
  },
  "30d": {
    bucketCount: 30,
    bucketMs: DAY_MS,
    formatLabel: (ts) => new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    tooltipLabel: (label) => `Day ${label}`,
    xAxisInterval: 4,
    emptyMessage: "No samples in the last 30 days.",
  },
};

const COUNTER_PALETTE = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  if (days > 0) return `${days}d`;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}h${m ? ` ${m}m` : ""}`;
  if (m > 0) return `${m}m`;
  return `${totalSec}s`;
}

function formatRelative(ts: number | null): string {
  if (!ts) return "Never";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function rangeStart(range: RangeKey, now: number): number {
  // Use a rolling cutoff that matches the backend's `now - rangeMs` query
  // so the bucket totals on the chart line up with the per-counter totals
  // returned by the API (no calendar-day alignment skew).
  const cfg = RANGE_CONFIG[range];
  return now - cfg.bucketCount * cfg.bucketMs;
}

function bucketSamples(samples: JobMetricSample[], counters: string[], range: RangeKey) {
  const cfg = RANGE_CONFIG[range];
  const now = Date.now();
  const start = rangeStart(range, now);
  const buckets: Array<Record<string, number | string>> = [];
  for (let i = 0; i < cfg.bucketCount; i++) {
    const bucketStart = start + i * cfg.bucketMs;
    const row: Record<string, number | string> = {
      ts: bucketStart,
      label: cfg.formatLabel(bucketStart),
    };
    for (const c of counters) row[c] = 0;
    buckets.push(row);
  }
  for (const s of samples) {
    if (s.timestamp < start) continue;
    const idx = Math.min(
      cfg.bucketCount - 1,
      Math.max(0, Math.floor((s.timestamp - start) / cfg.bucketMs)),
    );
    for (const c of counters) {
      const v = s.counters[c];
      if (typeof v === "number") {
        buckets[idx][c] = (buckets[idx][c] as number) + v;
      }
    }
  }
  return buckets;
}

function counterKeys(job: JobMetricsResponse): string[] {
  const set = new Set<string>();
  for (const k of Object.keys(job.totals)) set.add(k);
  for (const s of job.samples) for (const k of Object.keys(s.counters)) set.add(k);
  return Array.from(set).sort();
}

function JobCard({ job, range, activeAlerts }: { job: JobMetricsResponse; range: RangeKey; activeAlerts: number }) {
  const counters = useMemo(() => counterKeys(job), [job]);
  const chartData = useMemo(() => bucketSamples(job.samples, counters, range), [job, counters, range]);
  const sampleCount = job.samples.length;
  const cfg = RANGE_CONFIG[range];

  return (
    <Card data-testid={`card-job-${job.job}`} className={activeAlerts > 0 ? "border-destructive" : undefined}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle
              className="flex items-center gap-2 font-mono text-base"
              data-testid={`text-job-name-${job.job}`}
            >
              <Activity className="h-4 w-4" /> {job.job}
              {activeAlerts > 0 && (
                <Badge variant="destructive" className="gap-1" data-testid={`badge-active-alerts-${job.job}`}>
                  <AlertTriangle className="h-3 w-3" /> {activeAlerts} alert{activeAlerts === 1 ? "" : "s"}
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              Window: {formatDuration(job.windowMs)} · Samples:{" "}
              <span data-testid={`text-sample-count-${job.job}`}>{sampleCount}</span> · Last tick:{" "}
              <span data-testid={`text-last-tick-${job.job}`}>
                {formatRelative(job.latest?.timestamp ?? null)}
              </span>
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {counters.length === 0 ? (
          <div
            className="text-sm text-muted-foreground"
            data-testid={`text-no-counters-${job.job}`}
          >
            No counters recorded yet.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 text-sm">
              {counters.map((c, idx) => (
                <div key={c} data-testid={`stat-${job.job}-${c}`}>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: COUNTER_PALETTE[idx % COUNTER_PALETTE.length] }}
                    />
                    {c}
                  </div>
                  <div
                    className="font-medium text-lg"
                    data-testid={`text-total-${job.job}-${c}`}
                  >
                    {job.totals[c] ?? 0}
                  </div>
                  {job.latest && (
                    <div
                      className="text-xs text-muted-foreground"
                      data-testid={`text-latest-${job.job}-${c}`}
                    >
                      Last tick: {job.latest.counters[c] ?? 0}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {sampleCount === 0 ? (
              <div
                className="h-32 flex items-center justify-center text-sm text-muted-foreground border rounded-md"
                data-testid={`text-no-samples-${job.job}`}
              >
                {cfg.emptyMessage}
              </div>
            ) : (
              <div className="h-32 w-full" data-testid={`chart-${job.job}`}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 10 }}
                      interval={cfg.xAxisInterval}
                      stroke="currentColor"
                      className="text-muted-foreground"
                    />
                    <YAxis
                      tick={{ fontSize: 10 }}
                      allowDecimals={false}
                      width={28}
                      stroke="currentColor"
                      className="text-muted-foreground"
                    />
                    <Tooltip
                      contentStyle={{ fontSize: 12 }}
                      labelFormatter={(label) => cfg.tooltipLabel(String(label))}
                    />
                    {counters.map((c, idx) => (
                      <Line
                        key={c}
                        type="monotone"
                        dataKey={c}
                        name={c}
                        stroke={COUNTER_PALETTE[idx % COUNTER_PALETTE.length]}
                        strokeWidth={1.5}
                        dot={false}
                        isAnimationActive={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface AlertRule {
  id: string;
  job: string;
  counter: string | null;
  kind: "spike" | "stall";
  threshold: string;
  minAbsolute: number;
  dedupeMinutes: number;
  enabled: boolean;
  emailWhenAbove: string | null;
}

interface AlertEvent {
  id: string;
  job: string;
  counter: string | null;
  kind: "spike" | "stall";
  message: string;
  observedValue: number | null;
  baselineValue: number | null;
  triggeredAt: number;
  notifiedUserCount: number;
  acknowledgedAt: number | null;
  acknowledgedById: string | null;
  acknowledgedByName: string | null;
  snoozedUntil: number | null;
  snoozedById: string | null;
  snoozedByName: string | null;
  emailed: boolean;
  emailedRecipientCount: number;
  // Task #744 — email attempt outcome. `emailAttempted && !emailed`
  // means SendGrid was contacted but delivery failed; `emailError` carries
  // the failure reason for the warning badge tooltip.
  emailAttempted: boolean;
  emailError: string | null;
}

const SNOOZE_OPTIONS: Array<{ hours: number; label: string }> = [
  { hours: 1, label: "1 hour" },
  { hours: 4, label: "4 hours" },
  { hours: 8, label: "8 hours" },
  { hours: 24, label: "24 hours" },
];

interface AlertsResponse {
  rules: AlertRule[];
  events: AlertEvent[];
  activeByJob: Record<string, number>;
  defaults: {
    spike: { multiplier: number; minAbsolute: number; dedupeMinutes: number; emailWhenAbove: number };
    stall: { hours: number; dedupeMinutes: number; emailWhenAbove: number };
  };
  lastEvaluatedAt: number | null;
}

function AlertsPanel({ data }: { data: AlertsResponse | undefined }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    job: "",
    counter: "",
    kind: "spike" as "spike" | "stall",
    threshold: "",
    minAbsolute: "",
    dedupeMinutes: "",
    emailEnabled: false,
    emailWhenAbove: "",
  });

  const evaluateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/metrics/jobs/alerts/run");
      return res.json();
    },
    onSuccess: (result: { alertsFired: unknown[]; alertsSuppressed: number; notifiedAdmins: number }) => {
      toast({
        title: "Alerts evaluated",
        description: `${result.alertsFired.length} fired, ${result.alertsSuppressed} suppressed, ${result.notifiedAdmins} admins notified.`,
      });
      queryClient.invalidateQueries({ queryKey: ALERTS_KEY });
    },
    onError: (err: Error) => {
      toast({ title: "Evaluation failed", description: err.message, variant: "destructive" });
    },
  });

  const upsertMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/admin/metrics/jobs/alerts/rules", payload);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Rule saved" });
      setForm({ job: "", counter: "", kind: "spike", threshold: "", minAbsolute: "", dedupeMinutes: "", emailEnabled: false, emailWhenAbove: "" });
      queryClient.invalidateQueries({ queryKey: ALERTS_KEY });
    },
    onError: (err: Error) => {
      toast({ title: "Could not save rule", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/admin/metrics/jobs/alerts/rules/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Rule deleted" });
      queryClient.invalidateQueries({ queryKey: ALERTS_KEY });
    },
    onError: (err: Error) => {
      toast({ title: "Could not delete rule", description: err.message, variant: "destructive" });
    },
  });

  const acknowledgeMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/admin/metrics/jobs/alerts/events/${id}/acknowledge`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Alert acknowledged" });
      queryClient.invalidateQueries({ queryKey: ALERTS_KEY });
    },
    onError: (err: Error) => {
      toast({ title: "Could not acknowledge", description: err.message, variant: "destructive" });
    },
  });

  const snoozeMutation = useMutation({
    mutationFn: async ({ id, hours }: { id: string; hours: number }) => {
      const res = await apiRequest("POST", `/api/admin/metrics/jobs/alerts/events/${id}/snooze`, { hours });
      return res.json();
    },
    onSuccess: (_data, vars) => {
      toast({ title: `Snoozed for ${vars.hours}h` });
      queryClient.invalidateQueries({ queryKey: ALERTS_KEY });
    },
    onError: (err: Error) => {
      toast({ title: "Could not snooze", description: err.message, variant: "destructive" });
    },
  });

  const unsnoozeMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/admin/metrics/jobs/alerts/events/${id}/unsnooze`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Snooze cleared" });
      queryClient.invalidateQueries({ queryKey: ALERTS_KEY });
    },
    onError: (err: Error) => {
      toast({ title: "Could not clear snooze", description: err.message, variant: "destructive" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async (rule: AlertRule) => {
      const res = await apiRequest("POST", "/api/admin/metrics/jobs/alerts/rules", {
        id: rule.id,
        job: rule.job,
        counter: rule.counter,
        kind: rule.kind,
        threshold: Number(rule.threshold),
        minAbsolute: rule.minAbsolute,
        dedupeMinutes: rule.dedupeMinutes,
        enabled: !rule.enabled,
        emailWhenAbove: rule.emailWhenAbove === null ? null : Number(rule.emailWhenAbove),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ALERTS_KEY });
    },
  });

  const [emailedOnly, setEmailedOnly] = useState(false);

  const now = Date.now();
  const recentActive = (data?.events ?? []).filter(
    (e) =>
      now - e.triggeredAt < 60 * 60 * 1000 &&
      e.acknowledgedAt === null &&
      (e.snoozedUntil === null || e.snoozedUntil <= now) &&
      (!emailedOnly || e.emailed),
  );

  const recentEvents = (data?.events ?? []).filter((e) => !emailedOnly || e.emailed);

  return (
    <div className="space-y-4">
      {recentActive.length > 0 && (
        <Alert variant="destructive" data-testid="alert-active-job-alerts">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>
            {recentActive.length} active job metric alert{recentActive.length === 1 ? "" : "s"}
          </AlertTitle>
          <AlertDescription>
            <ul className="mt-2 space-y-2 text-sm">
              {recentActive.slice(0, 5).map((a) => (
                <li
                  key={a.id}
                  data-testid={`text-active-alert-${a.id}`}
                  className="flex items-start justify-between gap-3 flex-wrap"
                >
                  <span className="flex-1 min-w-[12rem]">
                    <span className="font-mono">{a.job}</span>
                    {a.counter ? ` · ${a.counter}` : ""} · {a.kind} · {formatRelative(a.triggeredAt)}
                    {a.emailed && (
                      <Badge
                        variant="destructive"
                        className="ml-1 gap-1"
                        data-testid={`badge-active-emailed-${a.id}`}
                        title={`Emailed ${a.emailedRecipientCount} Super Admin${a.emailedRecipientCount === 1 ? "" : "s"}`}
                      >
                        <Mail className="h-3 w-3" /> Emailed
                        {a.emailedRecipientCount > 0 ? ` · ${a.emailedRecipientCount}` : ""}
                      </Badge>
                    )}
                    {a.emailAttempted && !a.emailed && (
                      <Badge
                        variant="destructive"
                        className="ml-1 gap-1 bg-amber-600 hover:bg-amber-700"
                        data-testid={`badge-active-email-failed-${a.id}`}
                        title={
                          a.emailError
                            ? `Email delivery failed: ${a.emailError}. Check SendGrid or inbox rules.`
                            : "Email delivery failed. Check SendGrid or inbox rules."
                        }
                      >
                        <MailWarning className="h-3 w-3" /> Email failed
                      </Badge>
                    )}
                    {" — "}{a.message}
                  </span>
                  <span className="flex items-center gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7"
                      onClick={() => acknowledgeMutation.mutate(a.id)}
                      disabled={acknowledgeMutation.isPending}
                      data-testid={`button-acknowledge-${a.id}`}
                    >
                      <Check className="h-3 w-3 mr-1" /> Acknowledge
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7"
                          disabled={snoozeMutation.isPending}
                          data-testid={`button-snooze-${a.id}`}
                        >
                          <BellOff className="h-3 w-3 mr-1" /> Snooze
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {SNOOZE_OPTIONS.map((opt) => (
                          <DropdownMenuItem
                            key={opt.hours}
                            onSelect={() => snoozeMutation.mutate({ id: a.id, hours: opt.hours })}
                            data-testid={`option-snooze-${a.id}-${opt.hours}h`}
                          >
                            {opt.label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </span>
                </li>
              ))}
              {recentActive.length > 5 && <li>…and {recentActive.length - 5} more.</li>}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <Card data-testid="card-alert-rules">
        <CardHeader>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Bell className="h-4 w-4" /> Alert thresholds
              </CardTitle>
              <CardDescription>
                Super Admins are notified when a counter spikes vs its 24h baseline or when a job goes silent.
                Defaults: spike ≥ {data?.defaults.spike.multiplier ?? 3}× baseline (min {data?.defaults.spike.minAbsolute ?? 5}/hr), stall ≥ {data?.defaults.stall.hours ?? 4}h, dedupe {data?.defaults.spike.dedupeMinutes ?? 60}m.
                High-severity alerts also email every Super Admin — defaults: spike ≥ {data?.defaults.spike.emailWhenAbove ?? 10}× baseline, stall ≥ {data?.defaults.stall.emailWhenAbove ?? 12}h.
                {data?.lastEvaluatedAt && <> Last evaluated {formatRelative(data.lastEvaluatedAt)}.</>}
              </CardDescription>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <Switch
                  id="switch-emailed-only"
                  checked={emailedOnly}
                  onCheckedChange={setEmailedOnly}
                  data-testid="switch-emailed-only"
                />
                <Label htmlFor="switch-emailed-only" className="text-xs flex items-center gap-1 cursor-pointer">
                  <Mail className="h-3 w-3" /> Emailed only
                </Label>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => evaluateMutation.mutate()}
                disabled={evaluateMutation.isPending}
                data-testid="button-evaluate-alerts"
              >
                <PlayCircle className="h-4 w-4 mr-1" /> Evaluate now
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {data?.rules && data.rules.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Job</TableHead>
                    <TableHead>Counter</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead>Threshold</TableHead>
                    <TableHead>Min/hr</TableHead>
                    <TableHead>Dedupe (m)</TableHead>
                    <TableHead>Email ≥</TableHead>
                    <TableHead>Enabled</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rules.map((rule) => (
                    <TableRow key={rule.id} data-testid={`row-rule-${rule.id}`}>
                      <TableCell className="font-mono text-xs">{rule.job}</TableCell>
                      <TableCell className="font-mono text-xs">{rule.counter ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant={rule.kind === "stall" ? "secondary" : "default"}>{rule.kind}</Badge>
                      </TableCell>
                      <TableCell>
                        {Number(rule.threshold).toString()}
                        {rule.kind === "stall" ? "h" : "×"}
                      </TableCell>
                      <TableCell>{rule.minAbsolute}</TableCell>
                      <TableCell>{rule.dedupeMinutes}</TableCell>
                      <TableCell data-testid={`text-email-threshold-${rule.id}`}>
                        {rule.emailWhenAbove === null || rule.emailWhenAbove === undefined
                          ? "—"
                          : `${Number(rule.emailWhenAbove)}${rule.kind === "stall" ? "h" : "×"}`}
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={rule.enabled}
                          onCheckedChange={() => toggleMutation.mutate(rule)}
                          data-testid={`switch-enabled-${rule.id}`}
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => deleteMutation.mutate(rule.id)}
                          data-testid={`button-delete-rule-${rule.id}`}
                          aria-label="Delete rule"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground" data-testid="text-no-rules">
              No custom rules — built-in defaults apply to every job and counter.
            </p>
          )}

          <div className="border-t pt-4">
            <p className="text-sm font-medium mb-2">Add rule</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-9 gap-2 items-end">
              <div className="space-y-1">
                <Label htmlFor="rule-job" className="text-xs">Job (or *)</Label>
                <Input
                  id="rule-job"
                  value={form.job}
                  onChange={(e) => setForm({ ...form, job: e.target.value })}
                  placeholder="crm_birthday_digest"
                  data-testid="input-rule-job"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="rule-counter" className="text-xs">Counter (spike only)</Label>
                <Input
                  id="rule-counter"
                  value={form.counter}
                  onChange={(e) => setForm({ ...form, counter: e.target.value })}
                  placeholder="skippedDedupe"
                  disabled={form.kind === "stall"}
                  data-testid="input-rule-counter"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Kind</Label>
                <Select
                  value={form.kind}
                  onValueChange={(v) => setForm({ ...form, kind: v as "spike" | "stall" })}
                >
                  <SelectTrigger data-testid="select-rule-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="spike">spike</SelectItem>
                    <SelectItem value="stall">stall</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="rule-threshold" className="text-xs">
                  {form.kind === "stall" ? "Hours" : "Multiplier"}
                </Label>
                <Input
                  id="rule-threshold"
                  type="number"
                  step="0.1"
                  min="0.1"
                  value={form.threshold}
                  onChange={(e) => setForm({ ...form, threshold: e.target.value })}
                  placeholder={form.kind === "stall" ? "4" : "3"}
                  data-testid="input-rule-threshold"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="rule-min" className="text-xs">Min/hr</Label>
                <Input
                  id="rule-min"
                  type="number"
                  min="0"
                  value={form.minAbsolute}
                  onChange={(e) => setForm({ ...form, minAbsolute: e.target.value })}
                  placeholder="5"
                  disabled={form.kind === "stall"}
                  data-testid="input-rule-min"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="rule-dedupe" className="text-xs">Dedupe (min)</Label>
                <Input
                  id="rule-dedupe"
                  type="number"
                  min="1"
                  value={form.dedupeMinutes}
                  onChange={(e) => setForm({ ...form, dedupeMinutes: e.target.value })}
                  placeholder="60"
                  data-testid="input-rule-dedupe"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="rule-email-toggle" className="text-xs">Email Super Admins</Label>
                <div className="h-10 flex items-center">
                  <Switch
                    id="rule-email-toggle"
                    checked={form.emailEnabled}
                    onCheckedChange={(v) => setForm({ ...form, emailEnabled: v })}
                    data-testid="switch-rule-email"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="rule-email-threshold" className="text-xs">
                  {form.kind === "stall" ? "Email if ≥ (h)" : "Email if ≥ (×)"}
                </Label>
                <Input
                  id="rule-email-threshold"
                  type="number"
                  step="0.1"
                  min="0.1"
                  value={form.emailWhenAbove}
                  onChange={(e) => setForm({ ...form, emailWhenAbove: e.target.value })}
                  placeholder={form.kind === "stall" ? "12" : "10"}
                  disabled={!form.emailEnabled}
                  data-testid="input-rule-email-threshold"
                />
              </div>
              <Button
                onClick={() => {
                  const threshold = parseFloat(form.threshold);
                  if (!form.job.trim() || !Number.isFinite(threshold) || threshold <= 0) {
                    toast({
                      title: "Missing fields",
                      description: "Job and a positive threshold are required.",
                      variant: "destructive",
                    });
                    return;
                  }
                  let emailWhenAbove: number | null | undefined = undefined;
                  if (form.emailEnabled) {
                    const ewa = parseFloat(form.emailWhenAbove);
                    if (!Number.isFinite(ewa) || ewa <= 0) {
                      toast({
                        title: "Email threshold required",
                        description: "Enter a positive value for the email-escalation threshold or turn off email.",
                        variant: "destructive",
                      });
                      return;
                    }
                    emailWhenAbove = ewa;
                  } else {
                    emailWhenAbove = null;
                  }
                  upsertMutation.mutate({
                    job: form.job.trim(),
                    counter: form.kind === "stall" ? null : form.counter.trim() || null,
                    kind: form.kind,
                    threshold,
                    minAbsolute: form.minAbsolute ? parseInt(form.minAbsolute, 10) : undefined,
                    dedupeMinutes: form.dedupeMinutes ? parseInt(form.dedupeMinutes, 10) : undefined,
                    emailWhenAbove,
                  });
                }}
                disabled={upsertMutation.isPending}
                data-testid="button-add-rule"
              >
                Add rule
              </Button>
            </div>
          </div>

          {data?.events && data.events.length > 0 && (
            <div className="border-t pt-4">
              <p className="text-sm font-medium mb-2">
                Recent alerts (last 24h)
                {emailedOnly && (
                  <span className="ml-2 text-xs text-muted-foreground" data-testid="text-emailed-only-indicator">
                    · emailed only ({recentEvents.length} of {data.events.length})
                  </span>
                )}
              </p>
              {recentEvents.length === 0 ? (
                <p className="text-xs text-muted-foreground" data-testid="text-no-emailed-events">
                  No emailed alerts in the last 24h.
                </p>
              ) : (
              <ul className="space-y-1 text-xs text-muted-foreground" data-testid="list-recent-events">
                {recentEvents.slice(0, 10).map((e) => {
                  const snoozeActive = e.snoozedUntil !== null && e.snoozedUntil > Date.now();
                  const ackName = e.acknowledgedByName ?? (e.acknowledgedById ? "unknown admin" : null);
                  const snoozeName = e.snoozedByName ?? (e.snoozedById ? "unknown admin" : null);
                  return (
                    <li key={e.id} data-testid={`text-event-${e.id}`} className="flex items-start gap-2 flex-wrap">
                      <span className="flex-1 min-w-[12rem]">
                        <span className="font-mono">{e.job}</span>
                        {e.counter ? ` · ${e.counter}` : ""} · {e.kind} · {formatRelative(e.triggeredAt)} · notified {e.notifiedUserCount} admin{e.notifiedUserCount === 1 ? "" : "s"}
                        {e.emailed && (
                          <Badge
                            variant="destructive"
                            className="ml-1 gap-1"
                            data-testid={`badge-emailed-${e.id}`}
                            title={`Emailed ${e.emailedRecipientCount} Super Admin${e.emailedRecipientCount === 1 ? "" : "s"}`}
                          >
                            <Mail className="h-3 w-3" /> Emailed
                            {e.emailedRecipientCount > 0 ? ` · ${e.emailedRecipientCount}` : ""}
                          </Badge>
                        )}
                        {e.emailAttempted && !e.emailed && (
                          <Badge
                            variant="destructive"
                            className="ml-1 gap-1 bg-amber-600 hover:bg-amber-700"
                            data-testid={`badge-email-failed-${e.id}`}
                            title={
                              e.emailError
                                ? `Email delivery failed: ${e.emailError}. Check SendGrid or inbox rules.`
                                : "Email delivery failed. Check SendGrid or inbox rules."
                            }
                          >
                            <MailWarning className="h-3 w-3" /> Email failed
                          </Badge>
                        )}
                        {e.acknowledgedAt && (
                          <Badge
                            variant="secondary"
                            className="ml-1"
                            data-testid={`badge-ack-${e.id}`}
                            title={ackName ? `Acknowledged by ${ackName} at ${new Date(e.acknowledgedAt).toLocaleString()}` : undefined}
                          >
                            acknowledged{ackName ? ` by ${ackName}` : ""} · {formatRelative(e.acknowledgedAt)}
                          </Badge>
                        )}
                        {snoozeActive && (
                          <Badge
                            variant="outline"
                            className="ml-1"
                            data-testid={`badge-snooze-${e.id}`}
                            title={snoozeName ? `Snoozed by ${snoozeName} until ${new Date(e.snoozedUntil!).toLocaleString()}` : undefined}
                          >
                            snoozed{snoozeName ? ` by ${snoozeName}` : ""} until {new Date(e.snoozedUntil!).toLocaleTimeString()}
                          </Badge>
                        )}
                        {" — "}{e.message}
                      </span>
                      {snoozeActive && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-xs"
                          onClick={() => unsnoozeMutation.mutate(e.id)}
                          disabled={unsnoozeMutation.isPending}
                          data-testid={`button-unsnooze-${e.id}`}
                        >
                          Unsnooze
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface DigestSend {
  id: string;
  userId: string;
  recipientName: string | null;
  recipientEmail: string;
  sentAt: number;
  alertCount: number;
  windowStart: number | null;
  windowEnd: number | null;
  subject: string;
  isTest: boolean;
}

interface DigestsResponse {
  sends: DigestSend[];
}

function formatTimestamp(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

interface DigestEventRow {
  id: string;
  job: string;
  counter: string | null;
  kind: string;
  message: string;
  triggeredAt: number;
  observedValue: string | null;
  baselineValue: string | null;
}

interface DigestEventsResponse {
  digestId: string;
  events: DigestEventRow[];
}

function DigestEventsList({ sendId }: { sendId: string }) {
  const { data, isLoading, isError } = useQuery<DigestEventsResponse>({
    queryKey: ["/api/admin/metrics/jobs/alerts/digests", sendId, "events"],
    queryFn: async () => {
      const res = await fetch(`/api/admin/metrics/jobs/alerts/digests/${sendId}/events`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed to load events: ${res.status}`);
      return res.json();
    },
  });
  if (isLoading) {
    return (
      <p className="text-xs text-muted-foreground" data-testid={`text-digest-events-loading-${sendId}`}>
        Loading underlying alert events…
      </p>
    );
  }
  if (isError) {
    return (
      <p className="text-xs text-destructive" data-testid={`text-digest-events-error-${sendId}`}>
        Could not load alert events for this digest.
      </p>
    );
  }
  const events = data?.events ?? [];
  if (events.length === 0) {
    return (
      <p className="text-xs text-muted-foreground" data-testid={`text-digest-no-events-${sendId}`}>
        No matching `job_metric_alert_events` rows fall inside this digest's window.
      </p>
    );
  }
  return (
    <ul className="space-y-1 text-xs" data-testid={`list-digest-events-${sendId}`}>
      {events.slice(0, 50).map((e) => (
        <li key={e.id} data-testid={`text-digest-event-${sendId}-${e.id}`}>
          <span className="font-mono">{e.job}</span>
          {e.counter ? ` · ${e.counter}` : ""} · {e.kind} ·{" "}
          {new Date(e.triggeredAt).toLocaleString()} — {e.message}
          <span className="ml-2 text-muted-foreground font-mono">#{e.id.slice(0, 8)}</span>
        </li>
      ))}
      {events.length > 50 && (
        <li className="text-muted-foreground">…and {events.length - 50} more.</li>
      )}
    </ul>
  );
}

function DigestsPanel({
  data,
}: {
  data: DigestsResponse | undefined;
}) {
  const { toast } = useToast();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const testMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/metrics/jobs/alerts/digests/test");
      return res.json();
    },
    onSuccess: (summary: { digestsSent: number; digestsSkippedNoEvents: number; digestsSkippedDisabled: number }) => {
      if (summary.digestsSent > 0) {
        toast({
          title: "Test digest sent",
          description: `Delivered ${summary.digestsSent} email to your address.`,
        });
      } else if (summary.digestsSkippedNoEvents > 0) {
        toast({
          title: "Nothing to digest",
          description: "No alerts have fired in the last 24h, so no test email was sent.",
        });
      } else {
        toast({
          title: "Test digest skipped",
          description:
            "Make sure you have job-metric alert emails enabled in your notification preferences.",
          variant: "destructive",
        });
      }
      queryClient.invalidateQueries({ queryKey: DIGESTS_KEY });
    },
    onError: (err: Error) => {
      toast({ title: "Test digest failed", description: err.message, variant: "destructive" });
    },
  });

  const sends = data?.sends ?? [];

  return (
    <Card data-testid="card-quiet-hours-digests">
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <MoonStar className="h-4 w-4" /> Quiet-hours digests
            </CardTitle>
            <CardDescription>
              Recent digest emails summarizing alerts that fired while a Super Admin was inside
              their quiet-hours window. Use the test button to verify delivery without affecting the
              regular cadence.
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending}
            data-testid="button-send-test-digest"
          >
            <Send className="h-4 w-4 mr-1" /> Send test digest
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {sends.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="text-no-digests">
            No quiet-hours digests have been sent yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead className="text-right">Alerts</TableHead>
                  <TableHead>Window covered</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sends.map((s) => {
                  const isExpanded = expandedId === s.id;
                  return (
                    <DigestRowGroup key={s.id}>
                      <TableRow data-testid={`row-digest-${s.id}`}>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-medium" data-testid={`text-digest-recipient-${s.id}`}>
                              {s.recipientName ?? s.recipientEmail}
                            </span>
                            {s.recipientName && (
                              <span className="text-xs text-muted-foreground font-mono">
                                {s.recipientEmail}
                              </span>
                            )}
                          </div>
                          {s.isTest && (
                            <Badge variant="secondary" className="mt-1" data-testid={`badge-digest-test-${s.id}`}>
                              test
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell data-testid={`text-digest-sent-${s.id}`}>
                          <div className="flex flex-col">
                            <span>{formatRelative(s.sentAt)}</span>
                            <span className="text-xs text-muted-foreground">{formatTimestamp(s.sentAt)}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right" data-testid={`text-digest-count-${s.id}`}>
                          {s.alertCount}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground" data-testid={`text-digest-window-${s.id}`}>
                          {s.windowStart || s.windowEnd ? (
                            <>
                              {formatTimestamp(s.windowStart)} → {formatTimestamp(s.windowEnd)}
                            </>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7"
                            onClick={() => setExpandedId(isExpanded ? null : s.id)}
                            data-testid={`button-digest-events-${s.id}`}
                          >
                            {isExpanded ? "Hide events" : "View events"}
                          </Button>
                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow data-testid={`row-digest-events-row-${s.id}`}>
                          <TableCell colSpan={5} className="bg-muted/30">
                            <DigestEventsList sendId={s.id} />
                          </TableCell>
                        </TableRow>
                      )}
                    </DigestRowGroup>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Helper: groups paired <TableRow> children for a digest row + its
// expanded events row without breaking <tbody> hierarchy. React
// Fragments work as <tbody> children but eslint complains about the
// missing key when using shorthand syntax.
function DigestRowGroup({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export default function JobMetricsDashboard() {
  const [range, setRange] = useState<RangeKey>("24h");

  const { data, isLoading, isError, refetch, isFetching, dataUpdatedAt } =
    useQuery<JobsListResponse>({
      queryKey: ["/api/admin/metrics/jobs", { range }],
      refetchInterval: REFRESH_INTERVAL_MS,
    });

  const { data: alertsData } = useQuery<AlertsResponse>({
    queryKey: ALERTS_KEY,
    refetchInterval: REFRESH_INTERVAL_MS,
  });

  const { data: digestsData } = useQuery<DigestsResponse>({
    queryKey: DIGESTS_KEY,
    refetchInterval: REFRESH_INTERVAL_MS,
  });

  const jobs = (data?.jobs ?? []).slice().sort((a, b) => a.job.localeCompare(b.job));
  const activeByJob = alertsData?.activeByJob ?? {};

  const rangeDescription =
    range === "24h"
      ? "Rolling 24h trend (hourly buckets)"
      : range === "7d"
      ? "Last 7 days (daily buckets)"
      : "Last 30 days (daily buckets)";

  return (
    <div className="container mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-3">
          <Link href="/admin">
            <Button variant="ghost" size="sm" data-testid="link-back-admin">
              <ArrowLeft className="h-4 w-4 mr-1" /> Back to admin
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-semibold" data-testid="text-page-title">
              Job metrics dashboard
            </h1>
            <p className="text-sm text-muted-foreground">
              {rangeDescription} of counters published by background jobs via{" "}
              <code>recordJobMetrics</code>. Auto-refreshes every minute.
              {dataUpdatedAt > 0 && (
                <>
                  {" "}Updated {formatRelative(dataUpdatedAt)}.
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ToggleGroup
            type="single"
            value={range}
            onValueChange={(v) => {
              if (v === "24h" || v === "7d" || v === "30d") setRange(v);
            }}
            size="sm"
            variant="outline"
            data-testid="toggle-range"
          >
            {RANGE_OPTIONS.map((opt) => (
              <ToggleGroupItem
                key={opt.value}
                value={opt.value}
                aria-label={`Show ${opt.label} window`}
                data-testid={`toggle-range-${opt.value}`}
              >
                {opt.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-refresh"
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {isError && (
        <Alert variant="destructive" data-testid="alert-error">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Failed to load job metrics</AlertTitle>
          <AlertDescription>Try refreshing or check server logs.</AlertDescription>
        </Alert>
      )}

      {isLoading && !data ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : jobs.length === 0 ? (
        <Card data-testid="card-empty">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No jobs have published metrics yet. Once a background job calls{" "}
            <code>recordJobMetrics</code>, it will appear here.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2" data-testid="grid-jobs">
          {jobs.map((job) => (
            <JobCard key={job.job} job={job} range={range} activeAlerts={activeByJob[job.job] ?? 0} />
          ))}
        </div>
      )}

      <AlertsPanel data={alertsData} />

      <DigestsPanel data={digestsData} />
    </div>
  );
}
