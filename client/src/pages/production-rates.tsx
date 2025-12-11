import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  Clock,
  Target,
  Info,
  DollarSign,
  Users,
  Package,
  TrendingDown,
  AlertTriangle,
  CheckCircle
} from "lucide-react";
import { format, subDays, subMonths, startOfYear } from "date-fns";

interface ProductionRate {
  description: string;
  unit: string;
  totalQuantity: number;
  totalDays: number;
  totalProjects: number;
  avgPerDay: number;
  minPerDay: number;
  maxPerDay: number;
  medianPerDay: number;
  stdDev: number;
  entryCount: number;
}

interface ProductionRatesResponse {
  rates: ProductionRate[];
  summary: {
    totalSOWTypes: number;
    totalWorkDays: number;
    totalProjects: number;
    totalEntries: number;
  };
  availableUnits: string[];
}

interface ProductionRateDetail {
  description: string;
  unit: string;
  entries: {
    id: string;
    workDate: string;
    quantity: number;
    notes: string | null;
    projectCode: string;
    projectName: string;
    createdBy: string;
  }[];
  dailyTotals: {
    date: string;
    total: number;
    projectCount: number;
  }[];
  projectStats: {
    code: string;
    name: string;
    totalQuantity: number;
    days: number;
    entries: number;
    avgPerDay: number;
  }[];
}

interface CostMetric {
  description: string;
  unit: string;
  totalQuantity: number;
  totalLaborHours: number;
  totalLaborCost: number;
  totalMaterialCost: number;
  totalEquipmentCost: number;
  totalCost: number;
  avgQuantityPerDay: number;
  avgCrewSize: number;
  avgLaborHoursPerUnit: number;
  avgLaborCostPerUnit: number;
  avgMaterialCostPerUnit: number;
  avgEquipmentCostPerUnit: number;
  avgTotalCostPerUnit: number;
  avgRevenuePerUnit: number;
  avgProfitPerUnit: number;
  profitMargin: number;
  totalDays: number;
  totalProjects: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  hasLaborData: boolean;
  hasMaterialData: boolean;
}

interface CostMetricsResponse {
  rates: CostMetric[];
  summary: {
    totalSOWTypes: number;
    totalQuantity: number;
    totalLaborHours: number;
    totalLaborCost: number;
    totalMaterialCost: number;
    totalEquipmentCost: number;
    totalCost: number;
    totalProjects: number;
    ratesWithLaborData: number;
    ratesWithMaterialData: number;
  };
  availableUnits: string[];
}

type DatePreset = "7d" | "30d" | "90d" | "ytd" | "all";
type SortField = "description" | "avgPerDay" | "totalQuantity" | "totalDays" | "totalProjects";
type CostSortField = "description" | "avgLaborCostPerUnit" | "avgMaterialCostPerUnit" | "avgProfitPerUnit" | "totalQuantity";
type SortDirection = "asc" | "desc";
type PageTab = "benchmarks" | "cost-analytics";

export default function ProductionRatesPage() {
  const { user, logout, organizationName } = useAuth();
  const [activeTab, setActiveTab] = useState<PageTab>("benchmarks");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedUnit, setSelectedUnit] = useState<string>("all");
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [sortField, setSortField] = useState<SortField>("totalQuantity");
  const [costSortField, setCostSortField] = useState<CostSortField>("avgLaborCostPerUnit");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [costSortDirection, setCostSortDirection] = useState<SortDirection>("desc");
  const [selectedRate, setSelectedRate] = useState<ProductionRate | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);

  const getDateRange = () => {
    const now = new Date();
    switch (datePreset) {
      case "7d":
        return { startDate: format(subDays(now, 7), "yyyy-MM-dd") };
      case "30d":
        return { startDate: format(subDays(now, 30), "yyyy-MM-dd") };
      case "90d":
        return { startDate: format(subMonths(now, 3), "yyyy-MM-dd") };
      case "ytd":
        return { startDate: format(startOfYear(now), "yyyy-MM-dd") };
      default:
        return {};
    }
  };

  const { startDate } = getDateRange();
  const queryParams = new URLSearchParams();
  if (startDate) queryParams.set("startDate", startDate);
  if (selectedUnit && selectedUnit !== "all") queryParams.set("unit", selectedUnit);

  const { data, isLoading, error } = useQuery<ProductionRatesResponse>({
    queryKey: ["/api/production-rates", startDate, selectedUnit],
    queryFn: async () => {
      const url = `/api/production-rates${queryParams.toString() ? `?${queryParams.toString()}` : ""}`;
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch production rates");
      return response.json();
    },
  });

  const { data: detailData, isLoading: detailLoading } = useQuery<ProductionRateDetail>({
    queryKey: ["/api/production-rates/detail", selectedRate?.description, selectedRate?.unit, startDate],
    queryFn: async () => {
      if (!selectedRate) return null;
      const params = new URLSearchParams({
        description: selectedRate.description,
        unit: selectedRate.unit,
      });
      if (startDate) params.set("startDate", startDate);
      const response = await fetch(`/api/production-rates/detail?${params.toString()}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch rate details");
      return response.json();
    },
    enabled: !!selectedRate && detailDialogOpen,
  });

  const costQueryParams = new URLSearchParams();
  if (startDate) costQueryParams.set("startDate", startDate);
  if (selectedUnit && selectedUnit !== "all") costQueryParams.set("unit", selectedUnit);

  const { data: costData, isLoading: costLoading } = useQuery<CostMetricsResponse>({
    queryKey: ["/api/production-rates/metrics", startDate, selectedUnit],
    queryFn: async () => {
      const url = `/api/production-rates/metrics${costQueryParams.toString() ? `?${costQueryParams.toString()}` : ""}`;
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch cost metrics");
      return response.json();
    },
    enabled: activeTab === "cost-analytics",
  });

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

  const filteredRates = (data?.rates || [])
    .filter(rate => {
      const matchesSearch = rate.description.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesSearch;
    })
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

  const handleViewDetails = (rate: ProductionRate) => {
    setSelectedRate(rate);
    setDetailDialogOpen(true);
  };

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground mb-1" data-testid="text-page-title">
              Production Rates
            </h1>
            <p className="text-sm text-muted-foreground">
              Historical production benchmarks and cost analytics
            </p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as PageTab)} className="mb-6">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="benchmarks" data-testid="tab-benchmarks">
              <BarChart3 className="w-4 h-4 mr-2" />
              Benchmarks
            </TabsTrigger>
            <TabsTrigger value="cost-analytics" data-testid="tab-cost-analytics">
              <DollarSign className="w-4 h-4 mr-2" />
              Cost Analytics
            </TabsTrigger>
          </TabsList>

          <TabsContent value="benchmarks" className="mt-6">
            {isLoading ? (
              <div className="text-center py-12 text-muted-foreground">Loading production rates...</div>
            ) : error ? (
              <div className="text-center py-12 text-destructive">Failed to load production rates</div>
            ) : (
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
                                onClick={() => handleViewDetails(rate)}
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
            )}
          </TabsContent>

          <TabsContent value="cost-analytics" className="mt-6">
            {costLoading ? (
              <div className="text-center py-12 text-muted-foreground">Loading cost analytics...</div>
            ) : (
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
            )}
          </TabsContent>
        </Tabs>
      </main>

      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedRate?.description}
              <Badge variant="secondary">{selectedRate?.unit}</Badge>
            </DialogTitle>
            <DialogDescription>
              Detailed breakdown by project and daily performance
            </DialogDescription>
          </DialogHeader>

          {detailLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading details...</div>
          ) : detailData ? (
            <Tabs defaultValue="summary" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="summary">Summary</TabsTrigger>
                <TabsTrigger value="projects">By Project</TabsTrigger>
                <TabsTrigger value="entries">All Entries</TabsTrigger>
              </TabsList>

              <TabsContent value="summary" className="mt-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Average/Day</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{selectedRate?.avgPerDay.toLocaleString()}</div>
                      <p className="text-xs text-muted-foreground">{selectedRate?.unit}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Median/Day</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{selectedRate?.medianPerDay.toLocaleString()}</div>
                      <p className="text-xs text-muted-foreground">{selectedRate?.unit}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Std Deviation</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{selectedRate?.stdDev.toLocaleString()}</div>
                      <p className="text-xs text-muted-foreground">Variability measure</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Range</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">
                        {selectedRate?.minPerDay} - {selectedRate?.maxPerDay}
                      </div>
                      <p className="text-xs text-muted-foreground">Min - Max per day</p>
                    </CardContent>
                  </Card>
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Recent Daily Totals</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[200px]">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead className="text-right">Total</TableHead>
                            <TableHead className="text-right">Projects</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {detailData.dailyTotals.slice(0, 20).map((day) => (
                            <TableRow key={day.date}>
                              <TableCell>{format(new Date(day.date), "MMM d, yyyy")}</TableCell>
                              <TableCell className="text-right font-medium">
                                {day.total.toLocaleString()} {selectedRate?.unit}
                              </TableCell>
                              <TableCell className="text-right">{day.projectCount}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="projects" className="mt-4">
                <ScrollArea className="h-[400px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Project</TableHead>
                        <TableHead className="text-right">Total Qty</TableHead>
                        <TableHead className="text-right">Days</TableHead>
                        <TableHead className="text-right">Avg/Day</TableHead>
                        <TableHead className="text-right">Entries</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detailData.projectStats.map((project) => (
                        <TableRow key={project.code}>
                          <TableCell>
                            <div className="font-medium">{project.code}</div>
                            <div className="text-sm text-muted-foreground truncate max-w-[200px]">
                              {project.name}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            {project.totalQuantity.toLocaleString()} {selectedRate?.unit}
                          </TableCell>
                          <TableCell className="text-right">{project.days}</TableCell>
                          <TableCell className="text-right font-medium">
                            {project.avgPerDay.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right">{project.entries}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="entries" className="mt-4">
                <ScrollArea className="h-[400px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Project</TableHead>
                        <TableHead className="text-right">Quantity</TableHead>
                        <TableHead>By</TableHead>
                        <TableHead>Notes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detailData.entries.slice(0, 100).map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell>{format(new Date(entry.workDate), "MMM d, yyyy")}</TableCell>
                          <TableCell>
                            <div className="font-medium">{entry.projectCode}</div>
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {entry.quantity.toLocaleString()} {selectedRate?.unit}
                          </TableCell>
                          <TableCell className="text-sm">{entry.createdBy}</TableCell>
                          <TableCell className="text-sm text-muted-foreground truncate max-w-[150px]">
                            {entry.notes || "-"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </TabsContent>
            </Tabs>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
