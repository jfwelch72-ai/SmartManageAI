import { useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  TrendingUp,
  Calendar,
  BarChart3,
  Search,
  Filter,
  ChevronDown,
  ChevronUp,
  Activity,
  Building2,
  Target,
  Info,
} from "lucide-react";
import type { ProductionRate, ProductionRatesResponse, DatePreset, SortField, SortDirection } from "./types";

interface BenchmarksTabProps {
  data: ProductionRatesResponse | undefined;
  isLoading: boolean;
  error: Error | null;
  searchTerm: string;
  setSearchTerm: (v: string) => void;
  selectedUnit: string;
  setSelectedUnit: (v: string) => void;
  datePreset: DatePreset;
  setDatePreset: (v: DatePreset) => void;
  onViewDetails: (rate: ProductionRate) => void;
}

export function BenchmarksTab({
  data,
  isLoading,
  error,
  searchTerm,
  setSearchTerm,
  selectedUnit,
  setSelectedUnit,
  datePreset,
  setDatePreset,
  onViewDetails,
}: BenchmarksTabProps) {
  const isMobile = useIsMobile();
  const [sortField, setSortField] = useState<SortField>("totalQuantity");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const filteredRates = (data?.rates || [])
    .filter(rate => rate.description.toLowerCase().includes(searchTerm.toLowerCase()))
    .sort((a, b) => {
      const multiplier = sortDirection === "asc" ? 1 : -1;
      if (sortField === "description") {
        return multiplier * a.description.localeCompare(b.description);
      }
      return multiplier * (a[sortField] - b[sortField]);
    });

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return sortDirection === "asc" ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />;
  };

  if (isLoading) {
    return <div className="text-center py-12 text-muted-foreground">Loading production rates...</div>;
  }

  if (error) {
    return <div className="text-center py-12 text-destructive">Failed to load production rates</div>;
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Card data-testid="card-kpi-sow-types">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">SOW Types Tracked</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data?.summary.totalSOWTypes || 0}</div>
            <p className="text-xs text-muted-foreground">Unique work categories</p>
          </CardContent>
        </Card>

        <Card data-testid="card-kpi-work-days">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Total Work Days</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data?.summary.totalWorkDays || 0}</div>
            <p className="text-xs text-muted-foreground">Days with recorded progress</p>
          </CardContent>
        </Card>

        <Card data-testid="card-kpi-projects">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Projects Contributing</CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data?.summary.totalProjects || 0}</div>
            <p className="text-xs text-muted-foreground">Projects with data</p>
          </CardContent>
        </Card>

        <Card data-testid="card-kpi-entries">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Daily Entries</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data?.summary.totalEntries || 0}</div>
            <p className="text-xs text-muted-foreground">Field progress reports</p>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <CardTitle>Production Rate Benchmarks</CardTitle>
              <CardDescription>Average daily production by scope of work type</CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search SOW..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8 w-[200px]"
                  data-testid="input-search-sow"
                />
              </div>
              <Select value={selectedUnit} onValueChange={setSelectedUnit}>
                <SelectTrigger className="w-[120px]" data-testid="select-unit-filter">
                  <Filter className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="Unit" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Units</SelectItem>
                  {data?.availableUnits.map(unit => (
                    <SelectItem key={unit} value={unit}>{unit}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={datePreset} onValueChange={(v) => setDatePreset(v as DatePreset)}>
                <SelectTrigger className="w-[140px]" data-testid="select-date-filter">
                  <Calendar className="w-4 h-4 mr-2" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7d">Last 7 Days</SelectItem>
                  <SelectItem value="30d">Last 30 Days</SelectItem>
                  <SelectItem value="90d">Last 90 Days</SelectItem>
                  <SelectItem value="ytd">Year to Date</SelectItem>
                  <SelectItem value="all">All Time</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredRates.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Target className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No production data found</p>
              <p className="text-sm mt-2">
                Daily progress entries from field workers will appear here
              </p>
            </div>
          ) : isMobile ? (
            <div className="space-y-3">
              {filteredRates.map((rate, index) => (
                <Card key={`${rate.description}-${rate.unit}`} data-testid={`row-rate-${index}`}>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium text-sm" title={rate.description}>{rate.description}</span>
                      <Badge variant="secondary">{rate.unit}</Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-muted-foreground">Avg/Day:</span>{" "}
                        <span className="font-semibold">{rate.avgPerDay.toLocaleString()}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Min/Max:</span>{" "}
                        <span>{rate.minPerDay.toLocaleString()} - {rate.maxPerDay.toLocaleString()}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Total Qty:</span>{" "}
                        <span>{rate.totalQuantity.toLocaleString()}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Days:</span>{" "}
                        <span>{rate.totalDays}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Projects:</span>{" "}
                        <span>{rate.totalProjects}</span>
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onViewDetails(rate)}
                        data-testid={`button-view-details-${index}`}
                      >
                        <Info className="w-4 h-4 mr-1" />
                        Details
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead
                      className="cursor-pointer hover-elevate"
                      onClick={() => handleSort("description")}
                    >
                      <div className="flex items-center gap-1">
                        Description <SortIcon field="description" />
                      </div>
                    </TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead
                      className="cursor-pointer hover-elevate text-right"
                      onClick={() => handleSort("avgPerDay")}
                    >
                      <div className="flex items-center justify-end gap-1">
                        Avg/Day <SortIcon field="avgPerDay" />
                      </div>
                    </TableHead>
                    <TableHead className="text-right">Min/Max</TableHead>
                    <TableHead
                      className="cursor-pointer hover-elevate text-right"
                      onClick={() => handleSort("totalQuantity")}
                    >
                      <div className="flex items-center justify-end gap-1">
                        Total Qty <SortIcon field="totalQuantity" />
                      </div>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer hover-elevate text-right"
                      onClick={() => handleSort("totalDays")}
                    >
                      <div className="flex items-center justify-end gap-1">
                        Days <SortIcon field="totalDays" />
                      </div>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer hover-elevate text-right"
                      onClick={() => handleSort("totalProjects")}
                    >
                      <div className="flex items-center justify-end gap-1">
                        Projects <SortIcon field="totalProjects" />
                      </div>
                    </TableHead>
                    <TableHead className="w-[80px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRates.map((rate, index) => (
                    <TableRow key={`${rate.description}-${rate.unit}`} data-testid={`row-rate-${index}`}>
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
                      <TableCell className="text-right">
                        {rate.totalProjects}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onViewDetails(rate)}
                          data-testid={`button-view-details-${index}`}
                        >
                          <Info className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5" />
            How to Use Production Rates
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            <strong>For Estimating:</strong> Use the average daily rates to calculate crew-days needed for a bid.
            For example, if you need 1,000 SF of 4" Sidewalk and your average is 200 SF/day, budget for 5 crew-days.
          </p>
          <p>
            <strong>For Scheduling:</strong> Min/Max ranges help identify variability. High variability may indicate
            weather sensitivity or site-specific factors to consider.
          </p>
          <p>
            <strong>For Pricing:</strong> Combine production rates with labor costs from the Cost Rates page to
            calculate accurate per-unit costs for bidding.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
