import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Target,
  BarChart3,
  Plus,
  Calendar,
  Activity,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface KpiAssignmentWithDetails {
  id: string;
  organizationId: string;
  kpiTemplateId: string;
  userId: string;
  targetValue: string;
  periodType: string;
  startDate: string;
  endDate: string | null;
  isActive: boolean;
  assignedBy: string;
  createdAt: string;
  updatedAt: string;
  templateName: string;
  templateDescription: string | null;
  templateCategory: string;
  templateUnit: string;
  templateDirection: string;
}

interface KpiSummaryItem {
  assignmentId: string;
  templateName: string;
  category: string;
  unit: string;
  direction: string;
  targetValue: number;
  actualValue: number;
  achievement: number;
  trend: "improving" | "declining" | "stable";
  periodType: string;
  latestPeriodEnd: string | null;
  entryCount: number;
}

interface KpiEntry {
  id: string;
  organizationId: string;
  kpiAssignmentId: string;
  actualValue: string;
  periodStart: string;
  periodEnd: string;
  notes: string | null;
  source: string;
  recordedBy: string;
  createdAt: string;
}

const entryFormSchema = z.object({
  actualValue: z.string().min(1, "Value is required"),
  periodStart: z.string().min(1, "Period start is required"),
  periodEnd: z.string().min(1, "Period end is required"),
  notes: z.string().max(1000).optional(),
});

type EntryFormValues = z.infer<typeof entryFormSchema>;

function getAchievementColor(achievement: number): string {
  if (achievement >= 80) return "text-green-600 dark:text-green-400";
  if (achievement >= 50) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
}

function getProgressColor(achievement: number): string {
  if (achievement >= 80) return "bg-green-500";
  if (achievement >= 50) return "bg-yellow-500";
  return "bg-red-500";
}

function TrendIcon({ trend, direction }: { trend: string; direction: string }) {
  if (trend === "improving") {
    return <TrendingUp className="w-4 h-4 text-green-600 dark:text-green-400" />;
  }
  if (trend === "declining") {
    return <TrendingDown className="w-4 h-4 text-red-600 dark:text-red-400" />;
  }
  return <Minus className="w-4 h-4 text-muted-foreground" />;
}

function TrendBadge({ trend }: { trend: string }) {
  if (trend === "improving") {
    return <Badge variant="secondary" className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" data-testid="badge-trend-improving">Improving</Badge>;
  }
  if (trend === "declining") {
    return <Badge variant="secondary" className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" data-testid="badge-trend-declining">Declining</Badge>;
  }
  return <Badge variant="secondary" data-testid="badge-trend-stable">Stable</Badge>;
}

function CategoryBadge({ category }: { category: string }) {
  const colors: Record<string, string> = {
    Productivity: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    Safety: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
    Financial: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    Quality: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
    Attendance: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400",
    Custom: "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400",
  };
  return (
    <Badge variant="secondary" className={colors[category] || colors.Custom} data-testid={`badge-category-${category.toLowerCase()}`}>
      {category}
    </Badge>
  );
}

function RecordEntryDialog({ assignmentId, onSuccess }: { assignmentId: string; onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  const form = useForm<EntryFormValues>({
    resolver: zodResolver(entryFormSchema),
    defaultValues: {
      actualValue: "",
      periodStart: new Date().toISOString().split("T")[0],
      periodEnd: new Date().toISOString().split("T")[0],
      notes: "",
    },
  });

  const createEntry = useMutation({
    mutationFn: async (values: EntryFormValues) => {
      const res = await apiRequest("POST", "/api/kpis/entries", {
        kpiAssignmentId: assignmentId,
        ...values,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Entry recorded successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/kpis/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/kpis/entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/kpis/assignments/my"] });
      form.reset();
      setOpen(false);
      onSuccess();
    },
    onError: (error: Error) => {
      toast({ title: "Failed to record entry", description: error.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" data-testid={`button-record-entry-${assignmentId}`}>
          <Plus className="w-3 h-3 mr-1" />
          Record
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record KPI Entry</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => createEntry.mutate(v))} className="space-y-4">
            <FormField
              control={form.control}
              name="actualValue"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Actual Value</FormLabel>
                  <FormControl>
                    <Input type="number" step="any" placeholder="Enter value" {...field} data-testid="input-entry-value" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="periodStart"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Period Start</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} data-testid="input-entry-period-start" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="periodEnd"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Period End</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} data-testid="input-entry-period-end" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes (optional)</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Add any notes..." {...field} data-testid="input-entry-notes" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" className="w-full" disabled={createEntry.isPending} data-testid="button-submit-entry">
              {createEntry.isPending ? "Recording..." : "Record Entry"}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function KpiHistoryChart({ assignmentId }: { assignmentId: string }) {
  const { data: entries, isLoading } = useQuery<KpiEntry[]>({
    queryKey: ["/api/kpis/entries", assignmentId],
    queryFn: async () => {
      const res = await fetch(`/api/kpis/entries?assignmentId=${assignmentId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch entries");
      return res.json();
    },
  });

  if (isLoading) {
    return <Skeleton className="h-48 w-full" />;
  }

  if (!entries || entries.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-muted-foreground text-sm" data-testid="text-no-history">
        No entries recorded yet
      </div>
    );
  }

  const sortedEntries = [...entries]
    .sort((a, b) => new Date(a.periodEnd).getTime() - new Date(b.periodEnd).getTime());

  const chartData = sortedEntries.map((entry) => ({
      date: new Date(entry.periodEnd).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      value: Number(entry.actualValue),
    }));

  return (
    <div className="space-y-3">
      <div className="h-48" data-testid={`chart-history-${assignmentId}`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="date" className="text-xs" tick={{ fontSize: 11 }} />
            <YAxis className="text-xs" tick={{ fontSize: 11 }} />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "6px",
                fontSize: "12px",
              }}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="space-y-1 max-h-32 overflow-y-auto">
        {sortedEntries.slice().reverse().slice(0, 5).map((entry) => (
          <div key={entry.id} className="flex items-center justify-between gap-2 text-xs py-1 border-b last:border-b-0" data-testid={`entry-row-${entry.id}`}>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">
                {new Date(entry.periodEnd).toLocaleDateString()}
              </span>
              <span className="font-medium">{Number(entry.actualValue).toFixed(2)}</span>
              {entry.source === "auto" && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0" data-testid={`badge-auto-${entry.id}`}>
                  Auto
                </Badge>
              )}
            </div>
            {entry.notes && (
              <span className="text-muted-foreground truncate max-w-[120px]">{entry.notes}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function KpiCard({ kpi }: { kpi: KpiSummaryItem }) {
  const [showHistory, setShowHistory] = useState(false);
  const progressValue = Math.min(kpi.achievement, 100);

  return (
    <Card data-testid={`card-kpi-${kpi.assignmentId}`}>
      <CardHeader className="flex flex-row items-start justify-between gap-2 pb-3">
        <div className="space-y-1 min-w-0">
          <CardTitle className="text-base font-semibold truncate" data-testid={`text-kpi-name-${kpi.assignmentId}`}>
            {kpi.templateName}
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <CategoryBadge category={kpi.category} />
            <Badge variant="outline" className="text-xs" data-testid={`badge-period-${kpi.assignmentId}`}>
              {kpi.periodType}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <TrendBadge trend={kpi.trend} />
          <RecordEntryDialog
            assignmentId={kpi.assignmentId}
            onSuccess={() => {
              queryClient.invalidateQueries({ queryKey: ["/api/kpis/summary"] });
            }}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Target:</span>
            <span className="text-sm font-medium" data-testid={`text-target-${kpi.assignmentId}`}>
              {kpi.targetValue} {kpi.unit}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Actual:</span>
            <span className="text-sm font-medium" data-testid={`text-actual-${kpi.assignmentId}`}>
              {kpi.actualValue} {kpi.unit}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <TrendIcon trend={kpi.trend} direction={kpi.direction} />
            <span className={`text-sm font-bold ${getAchievementColor(kpi.achievement)}`} data-testid={`text-achievement-${kpi.assignmentId}`}>
              {kpi.achievement}%
            </span>
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">Achievement</span>
            <span className="text-xs text-muted-foreground">
              {kpi.direction === "higher_is_better" ? "Higher is better" : "Lower is better"}
            </span>
          </div>
          <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full transition-all ${getProgressColor(kpi.achievement)}`}
              style={{ width: `${progressValue}%` }}
              data-testid={`progress-bar-${kpi.assignmentId}`}
            />
          </div>
        </div>

        {kpi.latestPeriodEnd && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Calendar className="w-3 h-3" />
            <span data-testid={`text-last-updated-${kpi.assignmentId}`}>
              Last updated: {new Date(kpi.latestPeriodEnd).toLocaleDateString()}
            </span>
            <span className="mx-1">|</span>
            <span>{kpi.entryCount} {kpi.entryCount === 1 ? "entry" : "entries"} recorded</span>
          </div>
        )}

        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowHistory(!showHistory)}
          className="w-full"
          data-testid={`button-toggle-history-${kpi.assignmentId}`}
        >
          <BarChart3 className="w-4 h-4 mr-1" />
          {showHistory ? "Hide History" : "Show History"}
        </Button>

        {showHistory && <KpiHistoryChart assignmentId={kpi.assignmentId} />}
      </CardContent>
    </Card>
  );
}

export default function MyKpisPage() {
  const { user } = useAuth();
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const { data: summary, isLoading } = useQuery<KpiSummaryItem[]>({
    queryKey: ["/api/kpis/summary"],
    enabled: !!user,
  });

  const filteredKpis = summary?.filter(
    (kpi) => categoryFilter === "all" || kpi.category === categoryFilter
  ) || [];

  const categories = summary
    ? Array.from(new Set(summary.map((k) => k.category)))
    : [];

  const overallAchievement =
    summary && summary.length > 0
      ? Math.round(summary.reduce((acc, k) => acc + k.achievement, 0) / summary.length)
      : 0;

  const improvingCount = summary?.filter((k) => k.trend === "improving").length || 0;
  const decliningCount = summary?.filter((k) => k.trend === "declining").length || 0;

  if (isLoading) {
    return (
      <div className="p-6 space-y-6" data-testid="loading-my-kpis">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6" data-testid="page-my-kpis">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-page-title">My KPIs</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Track your performance against assigned key performance indicators
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card data-testid="card-overall-achievement">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-md bg-primary/10">
              <Target className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Overall Achievement</p>
              <p className={`text-2xl font-bold ${getAchievementColor(overallAchievement)}`} data-testid="text-overall-achievement">
                {overallAchievement}%
              </p>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="card-total-kpis">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-md bg-blue-500/10">
              <BarChart3 className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Active KPIs</p>
              <p className="text-2xl font-bold" data-testid="text-active-kpis-count">{summary?.length || 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="card-trends">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-md bg-green-500/10">
              <TrendingUp className="w-5 h-5 text-green-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Trends</p>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-green-600 dark:text-green-400 font-medium" data-testid="text-improving-count">
                  {improvingCount} improving
                </span>
                <span className="text-muted-foreground">/</span>
                <span className="text-red-600 dark:text-red-400 font-medium" data-testid="text-declining-count">
                  {decliningCount} declining
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {categories.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-muted-foreground mr-1">Filter:</span>
          <Button
            variant={categoryFilter === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setCategoryFilter("all")}
            data-testid="button-filter-all"
          >
            All
          </Button>
          {categories.map((cat) => (
            <Button
              key={cat}
              variant={categoryFilter === cat ? "default" : "outline"}
              size="sm"
              onClick={() => setCategoryFilter(cat)}
              data-testid={`button-filter-${cat.toLowerCase()}`}
            >
              {cat}
            </Button>
          ))}
        </div>
      )}

      {filteredKpis.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <Target className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2" data-testid="text-no-kpis-title">No KPIs Assigned</h3>
            <p className="text-muted-foreground text-sm" data-testid="text-no-kpis-description">
              You don't have any KPIs assigned yet. Your manager will assign KPIs with target values for you to track.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filteredKpis.map((kpi) => (
            <KpiCard key={kpi.assignmentId} kpi={kpi} />
          ))}
        </div>
      )}
    </div>
  );
}
