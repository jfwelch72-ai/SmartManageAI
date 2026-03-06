import { useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Calendar,
  Search,
  Filter,
  ChevronDown,
  ChevronUp,
  Activity,
  Clock,
  DollarSign,
  Users,
  Package,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle,
} from "lucide-react";
import type { CostMetricsResponse, DatePreset, CostSortField, SortDirection } from "./types";

interface CostAnalyticsTabProps {
  costData: CostMetricsResponse | undefined;
  costLoading: boolean;
  searchTerm: string;
  setSearchTerm: (v: string) => void;
  selectedUnit: string;
  setSelectedUnit: (v: string) => void;
  datePreset: DatePreset;
  setDatePreset: (v: DatePreset) => void;
}

export function CostAnalyticsTab({
  costData,
  costLoading,
  searchTerm,
  setSearchTerm,
  selectedUnit,
  setSelectedUnit,
  datePreset,
  setDatePreset,
}: CostAnalyticsTabProps) {
  const isMobile = useIsMobile();
  const [costSortField, setCostSortField] = useState<CostSortField>("avgLaborCostPerUnit");
  const [costSortDirection, setCostSortDirection] = useState<SortDirection>("desc");

  const filteredCostMetrics = (costData?.rates || [])
    .filter(metric => metric.description.toLowerCase().includes(searchTerm.toLowerCase()))
    .sort((a, b) => {
      const multiplier = costSortDirection === "asc" ? 1 : -1;
      if (costSortField === "description") {
        return multiplier * a.description.localeCompare(b.description);
      }
      const aVal = a[costSortField] ?? 0;
      const bVal = b[costSortField] ?? 0;
      return multiplier * (Number(aVal) - Number(bVal));
    });

  const handleCostSort = (field: CostSortField) => {
    if (costSortField === field) {
      setCostSortDirection(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setCostSortField(field);
      setCostSortDirection("desc");
    }
  };

  const CostSortIcon = ({ field }: { field: CostSortField }) => {
    if (costSortField !== field) return null;
    return costSortDirection === "asc" ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />;
  };

  const getConfidenceBadge = (level: string) => {
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
  };

  const formatCurrency = (value: number | null) => {
    if (value === null) return "N/A";
    return `$${value.toFixed(2)}`;
  };

  if (costLoading) {
    return <div className="text-center py-12 text-muted-foreground">Loading cost analytics...</div>;
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Card data-testid="card-cost-sow-types">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">SOW Types with Cost Data</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{costData?.summary.totalSOWTypes || 0}</div>
            <p className="text-xs text-muted-foreground">Scope items tracked</p>
          </CardContent>
        </Card>

        <Card data-testid="card-cost-labor-hours">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Total Labor Hours</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{(costData?.summary.totalLaborHours || 0).toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">Hours tracked</p>
          </CardContent>
        </Card>

        <Card data-testid="card-cost-labor-cost">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Total Labor Cost</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${(costData?.summary.totalLaborCost || 0).toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">{costData?.summary.ratesWithLaborData || 0} items with data</p>
          </CardContent>
        </Card>

        <Card data-testid="card-cost-material-cost">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Total Material Cost</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${(costData?.summary.totalMaterialCost || 0).toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">{costData?.summary.ratesWithMaterialData || 0} items with data</p>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <CardTitle>Cost Per Unit Analytics</CardTitle>
              <CardDescription>Labor cost, material cost, and profitability by scope of work</CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search SOW..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8 w-[200px]"
                  data-testid="input-search-cost-sow"
                />
              </div>
              <Select value={selectedUnit} onValueChange={setSelectedUnit}>
                <SelectTrigger className="w-[120px]" data-testid="select-cost-unit-filter">
                  <Filter className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="Unit" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Units</SelectItem>
                  {costData?.availableUnits.map(unit => (
                    <SelectItem key={unit} value={unit}>{unit}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={datePreset} onValueChange={(v) => setDatePreset(v as DatePreset)}>
                <SelectTrigger className="w-[140px]" data-testid="select-cost-date-filter">
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
          {filteredCostMetrics.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <DollarSign className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No cost data found</p>
              <p className="text-sm mt-2">
                Production data with labor hours and costs will appear here when time clock shifts are approved
              </p>
            </div>
          ) : isMobile ? (
            <div className="space-y-3">
              {filteredCostMetrics.map((metric, index) => (
                <Card key={`${metric.description}-${metric.unit}`} data-testid={`row-cost-${index}`}>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium text-sm" title={metric.description}>{metric.description}</span>
                      <Badge variant="secondary">{metric.unit}</Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-muted-foreground">Labor/Unit:</span>{" "}
                        <span className="font-semibold">{formatCurrency(metric.avgLaborCostPerUnit)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Material/Unit:</span>{" "}
                        <span>{formatCurrency(metric.avgMaterialCostPerUnit)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Profit/Unit:</span>{" "}
                        <span className={`font-semibold ${metric.avgProfitPerUnit !== null && metric.avgProfitPerUnit < 0 ? 'text-destructive' : 'text-green-600'}`}>
                          {metric.avgProfitPerUnit !== null ? formatCurrency(metric.avgProfitPerUnit) : "N/A"}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Total Qty:</span>{" "}
                        <span>{metric.totalQuantity.toLocaleString()}</span>
                      </div>
                    </div>
                    <div className="flex justify-end">
                      {getConfidenceBadge(metric.confidence)}
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
                      onClick={() => handleCostSort("description")}
                    >
                      <div className="flex items-center gap-1">
                        Description <CostSortIcon field="description" />
                      </div>
                    </TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead
                      className="cursor-pointer hover-elevate text-right"
                      onClick={() => handleCostSort("avgLaborCostPerUnit")}
                    >
                      <div className="flex items-center justify-end gap-1">
                        Labor/Unit <CostSortIcon field="avgLaborCostPerUnit" />
                      </div>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer hover-elevate text-right"
                      onClick={() => handleCostSort("avgMaterialCostPerUnit")}
                    >
                      <div className="flex items-center justify-end gap-1">
                        Material/Unit <CostSortIcon field="avgMaterialCostPerUnit" />
                      </div>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer hover-elevate text-right"
                      onClick={() => handleCostSort("avgProfitPerUnit")}
                    >
                      <div className="flex items-center justify-end gap-1">
                        Profit/Unit <CostSortIcon field="avgProfitPerUnit" />
                      </div>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer hover-elevate text-right"
                      onClick={() => handleCostSort("totalQuantity")}
                    >
                      <div className="flex items-center justify-end gap-1">
                        Total Qty <CostSortIcon field="totalQuantity" />
                      </div>
                    </TableHead>
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
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="w-5 h-5" />
            Understanding Cost Analytics
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            <strong>Labor Cost/Unit:</strong> Actual labor cost per unit. Calculated from approved time clock shifts with labor hours and crew wage rates.
          </p>
          <p>
            <strong>Material Cost/Unit:</strong> Material expense per unit based on budgeted estimates from the linked estimate line items. When scope items are linked to estimates with material costs, those budgeted costs are used to calculate per-unit metrics.
          </p>
          <p>
            <strong>Profit/Unit:</strong> Unit revenue (from scope item pricing) minus total costs per unit. Green indicates profitable work, red indicates a loss that needs investigation.
          </p>
          <p>
            <strong>Confidence Level:</strong> Based on data quantity - HIGH (10+ days, 3+ projects), MEDIUM (5-9 days, 2+ projects), LOW (2-4 days). Higher confidence means more reliable benchmarks for future bidding.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
