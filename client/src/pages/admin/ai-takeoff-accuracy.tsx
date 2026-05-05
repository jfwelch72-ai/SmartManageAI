import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LineChart,
  Line,
  Legend,
} from "recharts";
import { Sparkles, TrendingUp, ThumbsUp, ThumbsDown, Pencil, Clock, AlertTriangle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface AccuracyResponse {
  windowDays: number;
  totals: { PENDING: number; ACCEPTED: number; REJECTED: number; EDITED: number };
  reviewed: number;
  accuracy: number;
  accuracyByTrade: Array<{
    tradeType: string;
    accepted: number;
    edited: number;
    rejected: number;
    pending: number;
    accuracy: number;
  }>;
  accuracyByBucket: Array<{
    bucket: number;
    accepted: number;
    edited: number;
    rejected: number;
    accuracy: number;
  }>;
  trend: Array<{ day: string; accepted: number; rejected: number; accuracy: number }>;
  rejectReasons: Array<{ reason: string; count: number }>;
  lastCalibratedAt: string | null;
}

const STALE_CALIBRATION_MS = 48 * 60 * 60 * 1000;

const REASON_LABELS: Record<string, string> = {
  WRONG_TRADE: "Wrong trade",
  DUPLICATE: "Duplicate",
  NOT_PRESENT: "Not present",
  WRONG_QUANTITY: "Wrong quantity",
  WRONG_LOCATION: "Wrong location",
  OTHER: "Other",
};

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

export default function AiTakeoffAccuracyPage() {
  const [windowDays, setWindowDays] = useState<string>("30");

  const { data, isLoading } = useQuery<AccuracyResponse>({
    queryKey: [`/api/ai-features/takeoff/accuracy?days=${windowDays}`],
  });

  return (
    <div className="container mx-auto p-6 space-y-6" data-testid="page-ai-takeoff-accuracy">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-primary" />
            AI Takeoff Accuracy
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            How often your team accepts the AI's detected items, broken down by trade and confidence.
          </p>
        </div>
        <div className="w-44">
          <Select value={windowDays} onValueChange={setWindowDays}>
            <SelectTrigger data-testid="select-window-days">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
              <SelectItem value="180">Last 180 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      )}

      {!isLoading && data && (
        <>
          <CalibrationFreshness lastCalibratedAt={data.lastCalibratedAt} />
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card data-testid="card-overall-accuracy">
              <CardHeader className="pb-2">
                <CardDescription>Overall accuracy</CardDescription>
                <CardTitle className="text-3xl">{pct(data.accuracy)}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  {data.reviewed} reviewed of {data.totals.PENDING + data.reviewed} total
                </p>
              </CardContent>
            </Card>
            <Card data-testid="card-totals-accepted">
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1.5"><ThumbsUp className="w-3.5 h-3.5" /> Accepted</CardDescription>
                <CardTitle className="text-3xl">{data.totals.ACCEPTED}</CardTitle>
              </CardHeader>
            </Card>
            <Card data-testid="card-totals-edited">
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1.5"><Pencil className="w-3.5 h-3.5" /> Edited</CardDescription>
                <CardTitle className="text-3xl">{data.totals.EDITED}</CardTitle>
              </CardHeader>
            </Card>
            <Card data-testid="card-totals-rejected">
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1.5"><ThumbsDown className="w-3.5 h-3.5" /> Rejected</CardDescription>
                <CardTitle className="text-3xl">{data.totals.REJECTED}</CardTitle>
              </CardHeader>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" />
                  Accuracy by trade
                </CardTitle>
                <CardDescription>Accepted + edited as a share of reviewed.</CardDescription>
              </CardHeader>
              <CardContent>
                {data.accuracyByTrade.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No reviewed suggestions in the selected window.</p>
                ) : (
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.accuracyByTrade.map(r => ({ ...r, accuracyPct: Math.round(r.accuracy * 100) }))}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="tradeType" tick={{ fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={70} />
                        <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} unit="%" />
                        <Tooltip formatter={(v: number) => `${v}%`} />
                        <Bar dataKey="accuracyPct" fill="#7c3aed" name="Accuracy" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" />
                  Accuracy by reported confidence
                </CardTitle>
                <CardDescription>
                  How well each model-reported confidence bucket maps to acceptance.
                  Used by the nightly calibration job.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.accuracyByBucket.map(r => ({ bucket: `${r.bucket}-${r.bucket + 9}%`, accuracyPct: Math.round(r.accuracy * 100), reviewed: r.accepted + r.edited + r.rejected }))}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} unit="%" />
                      <Tooltip formatter={(v: number) => `${v}%`} />
                      <Bar dataKey="accuracyPct" fill="#0ea5e9" name="Accuracy" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Daily review trend
              </CardTitle>
              <CardDescription>Accepted (incl. edited) vs. rejected per day.</CardDescription>
            </CardHeader>
            <CardContent>
              {data.trend.length === 0 ? (
                <p className="text-sm text-muted-foreground">No reviewed suggestions in the selected window.</p>
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data.trend}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="accepted" stroke="#16a34a" strokeWidth={2} name="Accepted (incl. edited)" />
                      <Line type="monotone" dataKey="rejected" stroke="#ef4444" strokeWidth={2} name="Rejected" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top rejection reasons</CardTitle>
              <CardDescription>Why the team most often turns down a suggestion.</CardDescription>
            </CardHeader>
            <CardContent>
              {data.rejectReasons.length === 0 ? (
                <p className="text-sm text-muted-foreground">No rejections in the selected window.</p>
              ) : (
                <div className="space-y-2">
                  {data.rejectReasons.map((r) => (
                    <div key={r.reason} className="flex items-center justify-between" data-testid={`row-reason-${r.reason}`}>
                      <span className="text-sm">{REASON_LABELS[r.reason] ?? r.reason}</span>
                      <Badge variant="secondary">{r.count}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function CalibrationFreshness({ lastCalibratedAt }: { lastCalibratedAt: string | null }) {
  if (!lastCalibratedAt) {
    return (
      <Card
        className="border-dashed"
        data-testid="card-calibration-freshness"
      >
        <CardContent className="py-3 px-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="w-4 h-4" />
          <span data-testid="text-calibration-status">
            Confidence calibration has not run yet for this organization.
          </span>
        </CardContent>
      </Card>
    );
  }

  const updated = new Date(lastCalibratedAt);
  const ageMs = Date.now() - updated.getTime();
  const isStale = ageMs > STALE_CALIBRATION_MS;
  const relative = formatDistanceToNow(updated, { addSuffix: true });
  const absolute = updated.toLocaleString();

  return (
    <Card
      className={
        isStale
          ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40"
          : undefined
      }
      data-testid="card-calibration-freshness"
    >
      <CardContent className="py-3 px-4 flex items-center justify-between gap-3 text-sm">
        <div className="flex items-center gap-2">
          {isStale ? (
            <AlertTriangle
              className="w-4 h-4 text-amber-600 dark:text-amber-400"
              aria-hidden="true"
            />
          ) : (
            <Clock className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
          )}
          <span
            className={
              isStale
                ? "text-amber-800 dark:text-amber-200"
                : "text-muted-foreground"
            }
            data-testid="text-calibration-status"
          >
            Confidence calibration last updated{" "}
            <span
              className="font-medium"
              title={absolute}
              data-testid="text-calibration-relative"
            >
              {relative}
            </span>
            .
          </span>
        </div>
        {isStale && (
          <Badge
            variant="outline"
            className="border-amber-400 text-amber-800 dark:border-amber-600 dark:text-amber-200"
            data-testid="badge-calibration-stale"
          >
            Stale
          </Badge>
        )}
      </CardContent>
    </Card>
  );
}
