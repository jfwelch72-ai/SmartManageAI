/**
 * Task #2579 — Takeoff Phase D, Step 4: Bid hit-rate &
 * estimated-vs-actual dashboard.
 *
 * Backed by `GET /api/bids/analytics/hit-rate`. Surfaces:
 *   - org-wide hit rate + total estimated/awarded value,
 *   - hit rate by trade / project type / state,
 *   - top variance (estimated vs actual) for converted bids.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, TrendingUp, TrendingDown, Target } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Bucket {
  key: string;
  total: number;
  won: number;
  lost: number;
  pending: number;
  hitRate: number;
  totalValue: number;
  wonValue: number;
}

interface VarianceRow {
  bidId: string;
  projectId: string;
  estimatedValue: number;
  actualValue: number;
  variance: number;
  variancePct: number;
}

interface HitRateResponse {
  summary: {
    totalBids: number;
    wonBids: number;
    lostBids: number;
    pendingBids: number;
    hitRate: number;
    totalEstimatedValue: number;
    totalAwardedValue: number;
  };
  byTrade: Bucket[];
  byProjectType: Bucket[];
  byState: Bucket[];
  variance: VarianceRow[];
}

const fmtMoney = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtPct = (n: number) => `${n.toFixed(1)}%`;

function BucketTable({ title, rows, dataTestId }: { title: string; rows: Bucket[]; dataTestId: string }) {
  return (
    <Card data-testid={`card-${dataTestId}`}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid={`text-empty-${dataTestId}`}>
            No data yet.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{title.replace("Hit rate by ", "")}</TableHead>
                <TableHead className="text-right">Bids</TableHead>
                <TableHead className="text-right">Won</TableHead>
                <TableHead className="text-right">Hit rate</TableHead>
                <TableHead className="text-right">Won value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.key} data-testid={`row-${dataTestId}-${r.key}`}>
                  <TableCell className="font-medium">{r.key}</TableCell>
                  <TableCell className="text-right">{r.total}</TableCell>
                  <TableCell className="text-right">{r.won}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant={r.hitRate >= 50 ? "default" : "secondary"} data-testid={`badge-hitrate-${dataTestId}-${r.key}`}>
                      {fmtPct(r.hitRate)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">{fmtMoney(r.wonValue)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export default function BidHitRatePage() {
  const { data, isLoading, error } = useQuery<HitRateResponse>({
    queryKey: ["/api/bids/analytics/hit-rate"],
  });

  return (
    <div className="container mx-auto p-6 space-y-6" data-testid="page-bid-hit-rate">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/bids">
            <a className="text-sm text-muted-foreground hover:underline inline-flex items-center gap-1" data-testid="link-back-bids">
              <ArrowLeft className="h-4 w-4" /> Back to Bids
            </a>
          </Link>
          <h1 className="text-2xl font-bold mt-2" data-testid="heading-hit-rate">
            Bid hit rate & estimated vs actual
          </h1>
          <p className="text-muted-foreground text-sm">
            Cross-bid insights so you can spot trades and geographies where your win rate is slipping.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" data-testid={`skeleton-summary-${i}`} />
          ))}
        </div>
      ) : error ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-destructive" data-testid="text-error">
              Failed to load hit-rate analytics.
            </p>
          </CardContent>
        </Card>
      ) : data ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card data-testid="card-summary-total">
              <CardHeader className="pb-2"><CardTitle className="text-sm">Total bids</CardTitle></CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-summary-total">{data.summary.totalBids}</div>
              </CardContent>
            </Card>
            <Card data-testid="card-summary-hit-rate">
              <CardHeader className="pb-2 flex-row items-center justify-between">
                <CardTitle className="text-sm">Hit rate</CardTitle>
                <Target className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-summary-hit-rate">
                  {fmtPct(data.summary.hitRate)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {data.summary.wonBids} won · {data.summary.lostBids} lost · {data.summary.pendingBids} pending
                </p>
              </CardContent>
            </Card>
            <Card data-testid="card-summary-est">
              <CardHeader className="pb-2"><CardTitle className="text-sm">Total estimated value</CardTitle></CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-summary-est">
                  {fmtMoney(data.summary.totalEstimatedValue)}
                </div>
              </CardContent>
            </Card>
            <Card data-testid="card-summary-awarded">
              <CardHeader className="pb-2"><CardTitle className="text-sm">Total awarded value</CardTitle></CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-summary-awarded">
                  {fmtMoney(data.summary.totalAwardedValue)}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <BucketTable title="Hit rate by trade" rows={data.byTrade} dataTestId="trade" />
            <BucketTable title="Hit rate by project type" rows={data.byProjectType} dataTestId="projecttype" />
            <BucketTable title="Hit rate by state" rows={data.byState} dataTestId="state" />
          </div>

          <Card data-testid="card-variance">
            <CardHeader>
              <CardTitle>Estimated vs actual — biggest swings</CardTitle>
            </CardHeader>
            <CardContent>
              {data.variance.length === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid="text-empty-variance">
                  No converted bids with actuals yet.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Project</TableHead>
                      <TableHead className="text-right">Estimated</TableHead>
                      <TableHead className="text-right">Actual</TableHead>
                      <TableHead className="text-right">Variance</TableHead>
                      <TableHead className="text-right">Variance %</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.variance.map((v) => (
                      <TableRow key={v.bidId} data-testid={`row-variance-${v.bidId}`}>
                        <TableCell className="font-mono text-xs">{v.projectId.slice(0, 8)}…</TableCell>
                        <TableCell className="text-right">{fmtMoney(v.estimatedValue)}</TableCell>
                        <TableCell className="text-right">{fmtMoney(v.actualValue)}</TableCell>
                        <TableCell className="text-right">
                          <span className={v.variance > 0 ? "text-destructive" : "text-emerald-600"}>
                            {fmtMoney(v.variance)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant={Math.abs(v.variancePct) >= 10 ? "destructive" : "secondary"} data-testid={`badge-variance-${v.bidId}`}>
                            {v.variance > 0 ? <TrendingUp className="h-3 w-3 mr-1 inline" /> : <TrendingDown className="h-3 w-3 mr-1 inline" />}
                            {fmtPct(v.variancePct)}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
