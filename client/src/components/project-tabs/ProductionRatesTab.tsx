import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Activity, BarChart3, Search, TrendingUp, Target, ExternalLink } from "lucide-react";
import type { ProductionRatesResponse } from "@/components/production-rates/types";

interface ProductionRatesTabProps {
  projectId: string;
  projectCode: string;
}

export default function ProductionRatesTab({ projectId, projectCode }: ProductionRatesTabProps) {
  const [searchTerm, setSearchTerm] = useState("");

  const { data, isLoading, error } = useQuery<ProductionRatesResponse>({
    queryKey: ["/api/production-rates", projectCode],
    queryFn: async () => {
      const res = await fetch(`/api/production-rates?projectCode=${encodeURIComponent(projectCode)}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch production rates");
      return res.json();
    },
  });

  const filteredRates = (data?.rates || [])
    .filter(rate => rate.description.toLowerCase().includes(searchTerm.toLowerCase()))
    .sort((a, b) => b.totalQuantity - a.totalQuantity);

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
            <CardTitle className="text-base">Production Rate Benchmarks</CardTitle>
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
    </div>
  );
}
