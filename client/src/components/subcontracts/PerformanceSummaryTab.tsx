import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart3, TrendingUp, TrendingDown, Loader2, Star, Filter, Sparkles, Award, ShieldCheck, HardHat, DollarSign, Search } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

interface SubRecommendation {
  subcontractorId: string;
  subcontractorName: string;
  rank: number;
  overallScore: number;
  performanceMetrics: {
    avgScheduleAdherence: number | null;
    avgQualityScore: number | null;
    avgWorkCompletion: number | null;
    totalSafetyIncidents: number;
    avgOverallRating: number | null;
  };
  vendorMetrics: {
    avgOnTimeDelivery: number | null;
    avgQuality: number | null;
    avgCommunication: number | null;
    avgReliability: number | null;
    avgPriceCompetitiveness: number | null;
  } | null;
  projectHistory: {
    projectCode: string;
    projectName: string;
    scopeOfWork: string;
    contractAmount: number;
    status: string;
  }[];
  tradeMatch: boolean;
  contractCount: number;
  totalContractValue: number;
}

interface PerformanceSummaryItem {
  contractId: string;
  contractNumber: string;
  subcontractorName: string;
  projectName: string;
  projectId: string;
  latestRating: string | null;
  averageRating: string;
  totalEntries: number;
  latestScheduleAdherence: number | null;
  latestWorkCompletion: number | null;
  latestQuality: number | null;
  latestSafety: number | null;
  trendData?: { period: string; periodDate: string | null; rating: number; schedule: number; quality: number }[];
}

export function PerformanceSummaryTab() {
  const [projectFilter, setProjectFilter] = useState("ALL");
  const [ratingFilter, setRatingFilter] = useState("ALL");
  const [searchTerm, setSearchTerm] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const { data: summaries = [], isLoading, isError, error, refetch } = useQuery<PerformanceSummaryItem[]>({
    queryKey: ["/api/subcontracts/performance/summary"],
    retry: 1,
  });

  const projectOptions = useMemo(() => {
    const projects = new Map<string, string>();
    summaries.forEach(s => projects.set(s.projectId || s.projectName, s.projectName));
    return Array.from(projects.entries());
  }, [summaries]);

  const filteredSummaries = useMemo(() => {
    return summaries.filter(s => {
      if (projectFilter !== "ALL" && (s.projectId || s.projectName) !== projectFilter) return false;
      const avg = parseFloat(s.averageRating);
      if (ratingFilter === "EXCELLENT" && avg < 4) return false;
      if (ratingFilter === "GOOD" && (avg < 3 || avg >= 4)) return false;
      if (ratingFilter === "FAIR" && (avg < 2 || avg >= 3)) return false;
      if (ratingFilter === "POOR" && avg >= 2) return false;
      if (searchTerm && !s.subcontractorName.toLowerCase().includes(searchTerm.toLowerCase()) && !s.contractNumber.toLowerCase().includes(searchTerm.toLowerCase())) return false;
      return true;
    });
  }, [summaries, projectFilter, ratingFilter, searchTerm]);

  const trendChartData = useMemo(() => {
    const allTrends = filteredSummaries.flatMap(s => (s.trendData || [])
      .filter(t => {
        if (!t.periodDate) return true;
        if (dateFrom && t.periodDate < dateFrom) return false;
        if (dateTo && t.periodDate > dateTo) return false;
        return true;
      })
      .map(t => ({ ...t, sub: s.subcontractorName })));
    const periodMap = new Map<string, { period: string; avgRating: number; avgSchedule: number; avgQuality: number; count: number }>();
    allTrends.forEach(t => {
      const existing = periodMap.get(t.period) || { period: t.period, avgRating: 0, avgSchedule: 0, avgQuality: 0, count: 0 };
      existing.avgRating += t.rating;
      existing.avgSchedule += t.schedule;
      existing.avgQuality += t.quality;
      existing.count += 1;
      periodMap.set(t.period, existing);
    });
    return Array.from(periodMap.values())
      .map(p => ({
        period: p.period,
        "Avg Rating": parseFloat((p.avgRating / p.count).toFixed(1)),
        "Schedule %": Math.round(p.avgSchedule / p.count),
        "Quality %": Math.round(p.avgQuality / p.count),
      }))
      .sort((a, b) => a.period.localeCompare(b.period));
  }, [filteredSummaries, dateFrom, dateTo]);

  const getRatingColor = (rating: number) => {
    if (rating >= 4) return "text-green-600";
    if (rating >= 3) return "text-yellow-600";
    if (rating >= 2) return "text-orange-600";
    return "text-red-600";
  };

  const getRatingBadge = (rating: number) => {
    if (rating >= 4) return <Badge className="bg-green-500">Excellent</Badge>;
    if (rating >= 3) return <Badge className="bg-yellow-500">Good</Badge>;
    if (rating >= 2) return <Badge className="bg-orange-500">Fair</Badge>;
    return <Badge variant="destructive">Poor</Badge>;
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin mr-2" />Loading...</div>;
  }

  if (isError) {
    return <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground"><p>Failed to load performance summary.</p>{error?.message && <p className="text-sm">{error.message}</p>}<Button variant="outline" onClick={() => refetch()}>Retry</Button></div>;
  }

  const topPerformers = filteredSummaries.filter(s => parseFloat(s.averageRating) >= 3.5).slice(0, 5);
  const bottomPerformers = [...filteredSummaries].filter(s => parseFloat(s.averageRating) < 3.0).sort((a, b) => parseFloat(a.averageRating) - parseFloat(b.averageRating)).slice(0, 5);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2"><Filter className="h-4 w-4" />Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
            <div className="space-y-1">
              <Label className="text-xs">Search</Label>
              <Input
                placeholder="Search subcontractor or contract..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                data-testid="input-perf-search"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Project</Label>
              <Select value={projectFilter} onValueChange={setProjectFilter}>
                <SelectTrigger data-testid="select-perf-project-filter">
                  <SelectValue placeholder="All Projects" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Projects</SelectItem>
                  {projectOptions.map(([id, name]) => (
                    <SelectItem key={id} value={id}>{name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Rating</Label>
              <Select value={ratingFilter} onValueChange={setRatingFilter}>
                <SelectTrigger data-testid="select-perf-rating-filter">
                  <SelectValue placeholder="All Ratings" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Ratings</SelectItem>
                  <SelectItem value="EXCELLENT">Excellent (4+)</SelectItem>
                  <SelectItem value="GOOD">Good (3-4)</SelectItem>
                  <SelectItem value="FAIR">Fair (2-3)</SelectItem>
                  <SelectItem value="POOR">Poor (&lt;2)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Date From</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                data-testid="input-perf-date-from"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Date To</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                data-testid="input-perf-date-to"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {filteredSummaries.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">No performance data available{summaries.length > 0 ? " matching filters" : ". Record performance scores from individual subcontract views"}.</CardContent></Card>
      ) : (
        <>
          {trendChartData.length > 1 && (
            <Card data-testid="card-performance-trend">
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="h-4 w-4" />Performance Trend</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={trendChartData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="left" domain={[0, 5]} tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Line yAxisId="left" type="monotone" dataKey="Avg Rating" stroke="#2563eb" strokeWidth={2} dot={{ r: 4 }} />
                    <Line yAxisId="right" type="monotone" dataKey="Schedule %" stroke="#16a34a" strokeWidth={2} dot={{ r: 3 }} />
                    <Line yAxisId="right" type="monotone" dataKey="Quality %" stroke="#d97706" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card data-testid="card-top-performers">
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="h-4 w-4 text-green-500" />Top Performers</CardTitle>
              </CardHeader>
              <CardContent>
                {topPerformers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No top performers yet</p>
                ) : (
                  <div className="space-y-2">
                    {topPerformers.map(s => (
                      <div key={s.contractId} className="flex items-center justify-between py-1">
                        <div>
                          <p className="font-medium text-sm">{s.subcontractorName}</p>
                          <p className="text-xs text-muted-foreground">{s.projectName}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Star className="h-3 w-3 text-yellow-500" />
                          <span className={`font-bold ${getRatingColor(parseFloat(s.averageRating))}`}>{parseFloat(s.averageRating).toFixed(1)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card data-testid="card-bottom-performers">
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2"><TrendingDown className="h-4 w-4 text-red-500" />Needs Improvement</CardTitle>
              </CardHeader>
              <CardContent>
                {bottomPerformers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">All subcontractors performing well</p>
                ) : (
                  <div className="space-y-2">
                    {bottomPerformers.map(s => (
                      <div key={s.contractId} className="flex items-center justify-between py-1">
                        <div>
                          <p className="font-medium text-sm">{s.subcontractorName}</p>
                          <p className="text-xs text-muted-foreground">{s.projectName}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`font-bold ${getRatingColor(parseFloat(s.averageRating))}`}>{parseFloat(s.averageRating).toFixed(1)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><BarChart3 className="h-5 w-5" />All Subcontractor Performance ({filteredSummaries.length})</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Contract</TableHead>
                    <TableHead>Subcontractor</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead className="text-center">Schedule</TableHead>
                    <TableHead className="text-center">Completion</TableHead>
                    <TableHead className="text-center">Quality</TableHead>
                    <TableHead className="text-center">Safety</TableHead>
                    <TableHead className="text-center">Avg Rating</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSummaries.map(s => {
                    const avg = parseFloat(s.averageRating);
                    return (
                      <TableRow key={s.contractId} data-testid={`row-perf-summary-${s.contractId}`}>
                        <TableCell className="font-mono text-sm">{s.contractNumber}</TableCell>
                        <TableCell className="font-medium">{s.subcontractorName}</TableCell>
                        <TableCell>{s.projectName}</TableCell>
                        <TableCell className="text-center">{s.latestScheduleAdherence ?? "-"}%</TableCell>
                        <TableCell className="text-center">{s.latestWorkCompletion ?? "-"}%</TableCell>
                        <TableCell className="text-center">{s.latestQuality ?? "-"}%</TableCell>
                        <TableCell className="text-center">{s.latestSafety != null && s.latestSafety > 0 ? <span className="text-red-600">{s.latestSafety}</span> : "0"}</TableCell>
                        <TableCell className="text-center"><span className={`font-bold ${getRatingColor(avg)}`}>{avg.toFixed(1)}</span></TableCell>
                        <TableCell className="text-center">{getRatingBadge(avg)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      <SubRecommendationPanel />
    </div>
  );
}

function SubRecommendationPanel() {
  const [tradeSearch, setTradeSearch] = useState("");
  const [searchTrade, setSearchTrade] = useState("");

  const { data, isLoading } = useQuery<{ recommendations: SubRecommendation[]; total: number }>({
    queryKey: ["/api/ai-features/sub-recommendations", searchTrade],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "10" });
      if (searchTrade) params.set("trade", searchTrade);
      const res = await fetch(`/api/ai-features/sub-recommendations?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch recommendations");
      return res.json();
    },
  });

  const recommendations = data?.recommendations || [];

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-green-600";
    if (score >= 60) return "text-yellow-600";
    if (score >= 40) return "text-orange-600";
    return "text-red-600";
  };

  const getScoreBadge = (score: number) => {
    if (score >= 80) return <Badge className="bg-green-500">Top Tier</Badge>;
    if (score >= 60) return <Badge className="bg-yellow-500">Good</Badge>;
    if (score >= 40) return <Badge className="bg-orange-500">Average</Badge>;
    return <Badge variant="destructive">Below Avg</Badge>;
  };

  return (
    <Card data-testid="card-sub-recommendations">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          AI Subcontractor Recommendations
        </CardTitle>
        <CardDescription>Ranked by composite score from performance history, vendor ratings, and contract track record</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2 mb-4">
          <div className="flex-1">
            <Input
              placeholder="Filter by trade specialty (e.g., Electrical, Plumbing, Concrete)..."
              value={tradeSearch}
              onChange={(e) => setTradeSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') setSearchTrade(tradeSearch); }}
              data-testid="input-trade-search"
            />
          </div>
          <Button
            variant="outline"
            onClick={() => setSearchTrade(tradeSearch)}
            data-testid="button-search-trade"
          >
            <Search className="h-4 w-4 mr-2" />
            Search
          </Button>
          {searchTrade && (
            <Button variant="ghost" onClick={() => { setSearchTrade(""); setTradeSearch(""); }} data-testid="button-clear-trade">
              Clear
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin mr-2" />Loading recommendations...</div>
        ) : recommendations.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <HardHat className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No subcontractor data available{searchTrade ? ` for "${searchTrade}"` : ""}.</p>
            <p className="text-sm mt-1">Recommendations are based on past performance scores and contract history.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {recommendations.map(rec => (
              <div
                key={rec.subcontractorId}
                className="p-4 rounded-lg border hover:bg-muted/30 transition-colors"
                data-testid={`rec-sub-${rec.subcontractorId}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-bold text-lg text-muted-foreground w-8">#{rec.rank}</span>
                      <span className="font-semibold">{rec.subcontractorName}</span>
                      {rec.tradeMatch && searchTrade && (
                        <Badge variant="outline" className="text-xs bg-blue-50 dark:bg-blue-950">Trade Match</Badge>
                      )}
                      {getScoreBadge(rec.overallScore)}
                    </div>
                    <div className="flex flex-wrap items-center gap-4 mt-2 text-sm">
                      {rec.performanceMetrics.avgOverallRating != null && (
                        <span className="flex items-center gap-1">
                          <Star className="h-3 w-3 text-yellow-500" />
                          Rating: {rec.performanceMetrics.avgOverallRating}/5
                        </span>
                      )}
                      {rec.performanceMetrics.avgScheduleAdherence != null && (
                        <span className="flex items-center gap-1">
                          <TrendingUp className="h-3 w-3" />
                          Schedule: {rec.performanceMetrics.avgScheduleAdherence}%
                        </span>
                      )}
                      {rec.performanceMetrics.avgQualityScore != null && (
                        <span className="flex items-center gap-1">
                          <Award className="h-3 w-3" />
                          Quality: {rec.performanceMetrics.avgQualityScore}%
                        </span>
                      )}
                      {rec.performanceMetrics.totalSafetyIncidents > 0 && (
                        <span className="flex items-center gap-1 text-red-600">
                          <ShieldCheck className="h-3 w-3" />
                          {rec.performanceMetrics.totalSafetyIncidents} safety incidents
                        </span>
                      )}
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <DollarSign className="h-3 w-3" />
                        {rec.contractCount} contracts ({rec.totalContractValue > 0 ? `$${(rec.totalContractValue / 1000).toFixed(0)}K total` : 'N/A'})
                      </span>
                    </div>
                    {rec.projectHistory.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {rec.projectHistory.slice(0, 3).map((ph, i) => (
                          <Badge key={i} variant="outline" className="text-xs font-normal">
                            {ph.projectCode}: {ph.scopeOfWork.length > 30 ? ph.scopeOfWork.slice(0, 30) + '...' : ph.scopeOfWork}
                          </Badge>
                        ))}
                        {rec.projectHistory.length > 3 && (
                          <Badge variant="outline" className="text-xs font-normal">+{rec.projectHistory.length - 3} more</Badge>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0 ml-4">
                    <div className={`text-2xl font-bold ${getScoreColor(rec.overallScore)}`}>
                      {rec.overallScore}
                    </div>
                    <p className="text-xs text-muted-foreground">score</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
