import { useState } from "react";
import AppHeader from "@/components/AppHeader";
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
  Info
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

type DatePreset = "7d" | "30d" | "90d" | "ytd" | "all";
type SortField = "description" | "avgPerDay" | "totalQuantity" | "totalDays" | "totalProjects";
type SortDirection = "asc" | "desc";

export default function ProductionRatesPage() {
  const { user, logout, organizationName } = useAuth();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedUnit, setSelectedUnit] = useState<string>("all");
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [sortField, setSortField] = useState<SortField>("totalQuantity");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
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
      <AppHeader
        userName={`${user?.firstName || ""} ${user?.lastName || ""}`.trim() || "User"}
        userRole={user?.role || ""}
        onLogout={logout}
        organizationName={organizationName || undefined}
      />

      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-foreground mb-1" data-testid="text-page-title">
              Production Rates
            </h1>
            <p className="text-sm text-muted-foreground">
              Historical production benchmarks based on daily field reports
            </p>
          </div>
        </div>

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
