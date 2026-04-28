import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  ExternalLink,
  Loader2,
  Ruler,
  ShieldCheck,
} from "lucide-react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface ScaleMismatchSheet {
  id: string;
  takeoffSheetId: string | null;
  fileName: string | null;
  tradeType: string;
  projectId: string | null;
  bidId: string | null;
  detectedScaleLabel: string | null;
  calibratedScaleLabel: string | null;
  scaleDeltaPercent: number | null;
  createdAt: string;
}

interface ScaleMismatchSummary {
  sinceDays: number;
  totalAnalyses: number;
  mismatchCount: number;
  mismatchRate: number;
  sheets: ScaleMismatchSheet[];
}

const WINDOW_OPTIONS = [
  { value: "1", label: "Last 24 hours" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

/**
 * Task #2335 — AI takeoff dashboard.
 *
 * Renders the persisted scale-mismatch rollup so estimators / leads can
 * see calibration drift across the org without eyeballing 30 sheets one
 * at a time. The page is intentionally read-only: re-calibration still
 * happens in the takeoff workspace, this page just points at which
 * sheets need attention.
 */
export default function AiTakeoffDashboardPage() {
  const [sinceDays, setSinceDays] = useState<string>("7");

  const { data, isLoading, error } = useQuery<ScaleMismatchSummary>({
    queryKey: ["/api/ai-features/takeoff/scale-mismatches", { sinceDays }],
    queryFn: async () => {
      const res = await fetch(
        `/api/ai-features/takeoff/scale-mismatches?sinceDays=${encodeURIComponent(sinceDays)}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`Failed to load summary: ${res.status}`);
      return res.json();
    },
  });

  const ratePercent = useMemo(() => {
    if (!data) return 0;
    return Math.round(data.mismatchRate * 100);
  }, [data]);

  const windowLabel = useMemo(
    () => WINDOW_OPTIONS.find((o) => o.value === sinceDays)?.label.toLowerCase() ?? "this window",
    [sinceDays],
  );

  return (
    <div className="min-h-screen bg-background" data-testid="page-ai-takeoff-dashboard">
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-4">
          <Link href="/takeoff">
            <Button variant="ghost" size="sm" data-testid="button-back-to-takeoff">
              <ArrowLeft className="w-4 h-4 mr-1" /> Back to Takeoff
            </Button>
          </Link>
        </div>

        <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1
              className="text-2xl font-semibold flex items-center gap-2"
              data-testid="text-ai-takeoff-dashboard-title"
            >
              <Ruler className="w-6 h-6 text-primary" />
              AI Takeoff Dashboard
            </h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
              Tracks AI-detected drawing scales that disagree with the user's
              calibrated scale by more than 5%. Use the list below to triage
              which sheets to recalibrate before quantities ship.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Window</span>
            <Select value={sinceDays} onValueChange={setSinceDays}>
              <SelectTrigger
                className="w-[160px]"
                data-testid="select-scale-mismatch-window"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WINDOW_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {isLoading && (
          <div
            className="flex items-center gap-2 text-muted-foreground py-12 justify-center"
            data-testid="text-ai-takeoff-dashboard-loading"
          >
            <Loader2 className="w-4 h-4 animate-spin" /> Loading scale-mismatch
            summary…
          </div>
        )}

        {error && (
          <div
            className="flex items-center gap-2 text-destructive py-12 justify-center"
            data-testid="text-ai-takeoff-dashboard-error"
          >
            <AlertTriangle className="w-4 h-4" /> Failed to load summary.
          </div>
        )}

        {!isLoading && !error && data && (
          <>
            <div className="grid gap-4 sm:grid-cols-3 mb-6">
              <Card data-testid="tile-scale-mismatch-count">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Scale mismatches
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-end gap-2">
                    <span
                      className="text-3xl font-semibold tabular-nums"
                      data-testid="text-mismatch-count"
                    >
                      {data.mismatchCount}
                    </span>
                    <span className="text-xs text-muted-foreground pb-1">
                      sheets {windowLabel}
                    </span>
                  </div>
                </CardContent>
              </Card>
              <Card data-testid="tile-scale-mismatch-rate">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Mismatch rate
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-end gap-2">
                    <span
                      className="text-3xl font-semibold tabular-nums"
                      data-testid="text-mismatch-rate"
                    >
                      {ratePercent}%
                    </span>
                    <span className="text-xs text-muted-foreground pb-1">
                      of {data.totalAnalyses} analyses
                    </span>
                  </div>
                </CardContent>
              </Card>
              <Card data-testid="tile-total-analyses">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Analyses run
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-end gap-2">
                    <span
                      className="text-3xl font-semibold tabular-nums"
                      data-testid="text-total-analyses"
                    >
                      {data.totalAnalyses}
                    </span>
                    <span className="text-xs text-muted-foreground pb-1">
                      {windowLabel}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>

            {data.sheets.length === 0 ? (
              <Card data-testid="card-scale-mismatch-empty">
                <CardContent className="py-12 text-center text-muted-foreground">
                  <ShieldCheck className="w-10 h-10 mx-auto mb-2 opacity-50" />
                  No scale mismatches recorded {windowLabel}.
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Affected sheets</CardTitle>
                </CardHeader>
                <CardContent className="p-0 overflow-x-auto">
                  <Table data-testid="table-scale-mismatch-sheets">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Sheet</TableHead>
                        <TableHead>Trade</TableHead>
                        <TableHead>Detected scale</TableHead>
                        <TableHead>Calibrated scale</TableHead>
                        <TableHead className="text-right">Delta</TableHead>
                        <TableHead>When</TableHead>
                        <TableHead className="text-right">Open</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.sheets.map((sheet) => {
                        const deltaPct =
                          sheet.scaleDeltaPercent !== null
                            ? Math.round(sheet.scaleDeltaPercent * 100)
                            : null;
                        return (
                          <TableRow
                            key={sheet.id}
                            data-testid={`row-scale-mismatch-${sheet.id}`}
                          >
                            <TableCell className="max-w-[260px]">
                              <div
                                className="font-medium truncate"
                                data-testid={`text-mismatch-sheet-name-${sheet.id}`}
                              >
                                {sheet.fileName || "Untitled sheet"}
                              </div>
                              <div className="text-xs text-muted-foreground truncate">
                                {sheet.takeoffSheetId
                                  ? `Sheet ${sheet.takeoffSheetId.slice(0, 8)}`
                                  : "No linked sheet"}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary" className="text-xs">
                                {sheet.tradeType}
                              </Badge>
                            </TableCell>
                            <TableCell
                              className="text-xs font-mono"
                              data-testid={`text-mismatch-detected-${sheet.id}`}
                            >
                              {sheet.detectedScaleLabel || "—"}
                            </TableCell>
                            <TableCell
                              className="text-xs font-mono"
                              data-testid={`text-mismatch-calibrated-${sheet.id}`}
                            >
                              {sheet.calibratedScaleLabel || "—"}
                            </TableCell>
                            <TableCell
                              className="text-right tabular-nums"
                              data-testid={`text-mismatch-delta-${sheet.id}`}
                            >
                              {deltaPct !== null ? (
                                <Badge
                                  variant={deltaPct >= 25 ? "destructive" : "outline"}
                                  className="text-xs"
                                >
                                  {deltaPct}%
                                </Badge>
                              ) : (
                                "—"
                              )}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {format(new Date(sheet.createdAt), "MMM d, h:mm a")}
                            </TableCell>
                            <TableCell className="text-right">
                              {sheet.bidId ? (
                                <Link href={`/takeoff/${sheet.bidId}`}>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    data-testid={`button-open-takeoff-${sheet.id}`}
                                  >
                                    <ExternalLink className="w-3 h-3 mr-1" />
                                    Open
                                  </Button>
                                </Link>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </main>
    </div>
  );
}
