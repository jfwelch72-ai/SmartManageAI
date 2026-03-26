import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Activity, BarChart3, Search, TrendingUp, TrendingDown, Target, ExternalLink,
  DollarSign, Clock, Users, Package, AlertTriangle, CheckCircle,
} from "lucide-react";
import type { ProductionRatesResponse, CostMetricsResponse } from "@/components/production-rates/types";

interface ProductionRatesTabProps {
  projectId: string;
  projectCode: string;
}

function formatCurrency(value: number | null) {
  if (value === null) return "N/A";
  return `$${value.toFixed(2)}`;
}

function getConfidenceBadge(level: string) {
  switch (level) {
    case "HIGH":
      return <Badge variant="default" className="bg-green-600"><CheckCircle className="w-3 h-3 mr-1" />High</Badge>;
    case "MEDIUM":
      return <Badge variant="secondary"><Activity className="w-3 h-3 mr-1" />Medium</Badge>;
    case "LOW":
      return <Badge variant="outline"><AlertTriangle className="w-3 h-3 mr-1" />Low</Badge>;
    default:
      return <Badge variant="outline">Unknown</Badge>;
  }
}

export default function ProductionRatesTab({ projectId, projectCode }: ProductionRatesTabProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState("benchmarks");

  const { data, isLoading, error } = useQuery<ProductionRatesResponse>({
    queryKey: ["/api/production-rates", projectCode],
    queryFn: async () => {
      const res = await fetch(`/api/production-rates?projectCode=${encodeURIComponent(projectCode)}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch production rates");
      return res.json();
    },
  });

  const { data: costData, isLoading: costLoading } = useQuery<CostMetricsResponse>({
    queryKey: ["/api/production-rates/metrics", projectCode],
    queryFn: async () => {
      const res = await fetch(`/api/production-rates/metrics?projectCode=${encodeURIComponent(projectCode)}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch cost metrics");
      return res.json();
    },
  });

  const filteredRates = (data?.rates || [])
    .filter(rate => rate.description.toLowerCase().includes(searchTerm.toLowerCase()))
    .sort((a, b) => b.totalQuantity - a.totalQuantity);

  const filteredCostMetrics = (costData?.rates || [])
    .filter(metric => metric.description.toLowerCase().includes(searchTerm.toLowerCase()));

  return (
    <div className="space-y-6" data-testid="project-production-rates-tab">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          <h3 className="font-semibold text-lg">Production Rates</h3>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => window.open("/production-rates", "_blank")}
          data-testid="button-open-production-rates"
        >
          <ExternalLink className="h-3.5 w-3.5 mr-1" />
          Full Dashboard
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList data-testid="production-rates-sub-tabs">
          <TabsTrigger value="benchmarks" data-testid="tab-prod-benchmarks">
            <BarChart3 className="h-4 w-4 mr-1.5" />
            Benchmarks
          </TabsTrigger>
          <TabsTrigger value="cost-analytics" data-testid="tab-prod-cost-analytics">
            <DollarSign className="h-4 w-4 mr-1.5" />
            Cost Analytics
          </TabsTrigger>
        </TabsList>

        <TabsContent value="benchmarks" className="space-y-4 mt-4">
          <div className="grid gap-4 md:grid-cols-3">
            <Card data-testid="card-prod-sow-types">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">SOW Types</CardTitle>
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{isLoading ? "..." : data?.summary.totalSOWTypes || 0}</div>
                <p className="text-xs text-muted-foreground">Tracked work categories</p>
              </CardContent>
            </Card>

            <Card data-testid="card-prod-work-days">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Work Days</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{isLoading ? "..." : data?.summary.totalWorkDays || 0}</div>
                <p className="text-xs text-muted-foreground">Days with progress</p>
              </CardContent>
            </Card>

            <Card data-testid="card-prod-entries">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Daily Entries</CardTitle>
                <Activity className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{isLoading ? "..." : data?.summary.totalEntries || 0}</div>
                <p className="text-xs text-muted-foreground">Field progress reports</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-base">Production Rate Benchmarks</CardTitle>
                  <CardDescription>Average daily production by scope of work for this project</CardDescription>
                </div>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search SOW..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-8 w-[200px]"
                    data-testid="input-search-prod-rates"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading production rates...</div>
              ) : error ? (
                <div className="text-center py-8 text-destructive">Failed to load production rates</div>
              ) : filteredRates.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground" data-testid="empty-production-rates">
                  <Target className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No production data found for this project</p>
                  <p className="text-xs mt-1">Daily progress entries from field workers will appear here.</p>
                </div>
              ) : (
                <Table data-testid="table-project-production-rates">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Description</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead className="text-right">Avg/Day</TableHead>
                      <TableHead className="text-right">Min/Max</TableHead>
                      <TableHead className="text-right">Total Qty</TableHead>
                      <TableHead className="text-right">Days</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRates.slice(0, 25).map((rate, index) => (
                      <TableRow key={`${rate.description}-${rate.unit}`} data-testid={`row-prod-rate-${index}`}>
                        <TableCell className="font-medium max-w-[250px] truncate" title={rate.description}>
                          {rate.description}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{rate.unit}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {rate.avgPerDay.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground text-sm">
                          {rate.minPerDay.toLocaleString()} - {rate.maxPerDay.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          {rate.totalQuantity.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          {rate.totalDays}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="cost-analytics" className="space-y-4 mt-4">
          <div className="grid gap-4 md:grid-cols-4">
            <Card data-testid="card-cost-sow-types">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">SOW Types</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{costLoading ? "..." : costData?.summary.totalSOWTypes || 0}</div>
                <p className="text-xs text-muted-foreground">With cost data</p>
              </CardContent>
            </Card>

            <Card data-testid="card-cost-labor-hours">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Labor Hours</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{costLoading ? "..." : (costData?.summary.totalLaborHours || 0).toLocaleString()}</div>
                <p className="text-xs text-muted-foreground">Hours tracked</p>
              </CardContent>
            </Card>

            <Card data-testid="card-cost-labor-cost">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Labor Cost</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">${(costData?.summary.totalLaborCost || 0).toLocaleString()}</div>
                <p className="text-xs text-muted-foreground">{costData?.summary.ratesWithLaborData || 0} items</p>
              </CardContent>
            </Card>

            <Card data-testid="card-cost-material-cost">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Material Cost</CardTitle>
                <Package className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">${(costData?.summary.totalMaterialCost || 0).toLocaleString()}</div>
                <p className="text-xs text-muted-foreground">{costData?.summary.ratesWithMaterialData || 0} items</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-base">Cost Per Unit Analytics</CardTitle>
                  <CardDescription>Labor cost, material cost, and profitability for this project</CardDescription>
                </div>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search SOW..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-8 w-[200px]"
                    data-testid="input-search-cost-rates"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {costLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading cost analytics...</div>
              ) : filteredCostMetrics.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground" data-testid="empty-cost-analytics">
                  <DollarSign className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No cost data found for this project</p>
                  <p className="text-xs mt-1">Cost data appears when time clock shifts with labor hours are approved.</p>
                </div>
              ) : (
                <Table data-testid="table-project-cost-analytics">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Description</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead className="text-right">Labor/Unit</TableHead>
                      <TableHead className="text-right">Material/Unit</TableHead>
                      <TableHead className="text-right">Profit/Unit</TableHead>
                      <TableHead className="text-right">Total Qty</TableHead>
                      <TableHead className="text-center">Confidence</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredCostMetrics.map((metric, index) => (
                      <TableRow key={`${metric.description}-${metric.unit}`} data-testid={`row-cost-${index}`}>
                        <TableCell className="font-medium max-w-[200px] truncate" title={metric.description}>
                          {metric.description}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{metric.unit}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {formatCurrency(metric.avgLaborCostPerUnit)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(metric.avgMaterialCostPerUnit)}
                        </TableCell>
                        <TableCell className={`text-right font-semibold ${metric.avgProfitPerUnit !== null && metric.avgProfitPerUnit < 0 ? 'text-destructive' : 'text-green-600'}`}>
                          {metric.avgProfitPerUnit !== null ? (
                            <span className="flex items-center justify-end gap-1">
                              {metric.avgProfitPerUnit >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                              {formatCurrency(metric.avgProfitPerUnit)}
                            </span>
                          ) : "N/A"}
                        </TableCell>
                        <TableCell className="text-right">
                          {metric.totalQuantity.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-center">
                          {getConfidenceBadge(metric.confidence)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
