import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart3, DollarSign } from "lucide-react";
import { format, subDays, subMonths, startOfYear } from "date-fns";
import { BenchmarksTab } from "@/components/production-rates/BenchmarksTab";
import { CostAnalyticsTab } from "@/components/production-rates/CostAnalyticsTab";
import { ProductionRateDetailDialog } from "@/components/production-rates/ProductionRateDetail";
import type {
  ProductionRate,
  ProductionRatesResponse,
  ProductionRateDetail,
  CostMetricsResponse,
  DatePreset,
  PageTab,
} from "@/components/production-rates/types";

export default function ProductionRatesPage({ embedded }: { embedded?: boolean } = {}) {
  const [activeTab, setActiveTab] = useState<PageTab>("benchmarks");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedUnit, setSelectedUnit] = useState<string>("all");
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
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
  if (selectedUnit && selectedUnit !== "all")
    queryParams.set("unit", selectedUnit);

  const { data, isLoading, error } = useQuery<ProductionRatesResponse>({
    queryKey: ["/api/production-rates", startDate, selectedUnit],
    queryFn: async () => {
      const url = `/api/production-rates${queryParams.toString() ? `?${queryParams.toString()}` : ""}`;
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch production rates");
      return response.json();
    },
  });

  const { data: detailData, isLoading: detailLoading } =
    useQuery<ProductionRateDetail>({
      queryKey: [
        "/api/production-rates/detail",
        selectedRate?.description,
        selectedRate?.unit,
        startDate,
      ],
      queryFn: async () => {
        if (!selectedRate) return null;
        const params = new URLSearchParams({
          description: selectedRate.description,
          unit: selectedRate.unit,
        });
        if (startDate) params.set("startDate", startDate);
        const response = await fetch(
          `/api/production-rates/detail?${params.toString()}`,
          { credentials: "include" },
        );
        if (!response.ok) throw new Error("Failed to fetch rate details");
        return response.json();
      },
      enabled: !!selectedRate && detailDialogOpen,
    });

  const costQueryParams = new URLSearchParams();
  if (startDate) costQueryParams.set("startDate", startDate);
  if (selectedUnit && selectedUnit !== "all")
    costQueryParams.set("unit", selectedUnit);

  const { data: costData, isLoading: costLoading } =
    useQuery<CostMetricsResponse>({
      queryKey: ["/api/production-rates/metrics", startDate, selectedUnit],
      queryFn: async () => {
        const url = `/api/production-rates/metrics${costQueryParams.toString() ? `?${costQueryParams.toString()}` : ""}`;
        const response = await fetch(url, { credentials: "include" });
        if (!response.ok) throw new Error("Failed to fetch cost metrics");
        return response.json();
      },
      enabled: activeTab === "cost-analytics",
    });

  const handleViewDetails = (rate: ProductionRate) => {
    setSelectedRate(rate);
    setDetailDialogOpen(true);
  };

  if (embedded) {
    return (
      <div className="space-y-6">
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as PageTab)}
          className="mb-6"
        >
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="benchmarks" data-testid="tab-benchmarks">
              <BarChart3 className="w-4 h-4 mr-2" />
              Benchmarks
            </TabsTrigger>
            <TabsTrigger
              value="cost-analytics"
              data-testid="tab-cost-analytics"
            >
              <DollarSign className="w-4 h-4 mr-2" />
              Cost Analytics
            </TabsTrigger>
          </TabsList>

          <TabsContent value="benchmarks" className="mt-6">
            <BenchmarksTab
              data={data}
              isLoading={isLoading}
              error={error}
              searchTerm={searchTerm}
              setSearchTerm={setSearchTerm}
              selectedUnit={selectedUnit}
              setSelectedUnit={setSelectedUnit}
              datePreset={datePreset}
              setDatePreset={setDatePreset}
              onViewDetails={handleViewDetails}
            />
          </TabsContent>

          <TabsContent value="cost-analytics" className="mt-6">
            <CostAnalyticsTab
              costData={costData}
              costLoading={costLoading}
              searchTerm={searchTerm}
              setSearchTerm={setSearchTerm}
              selectedUnit={selectedUnit}
              setSelectedUnit={setSelectedUnit}
              datePreset={datePreset}
              setDatePreset={setDatePreset}
            />
          </TabsContent>
        </Tabs>

        <ProductionRateDetailDialog
          open={detailDialogOpen}
          onOpenChange={setDetailDialogOpen}
          selectedRate={selectedRate}
          detailData={detailData}
          detailLoading={detailLoading}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-full px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1
              className="text-2xl font-bold text-foreground mb-1"
              data-testid="text-page-title"
            >
              Production Rates
            </h1>
            <p className="text-sm text-muted-foreground">
              Historical production benchmarks and cost analytics
            </p>
          </div>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as PageTab)}
          className="mb-6"
        >
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="benchmarks" data-testid="tab-benchmarks">
              <BarChart3 className="w-4 h-4 mr-2" />
              Benchmarks
            </TabsTrigger>
            <TabsTrigger
              value="cost-analytics"
              data-testid="tab-cost-analytics"
            >
              <DollarSign className="w-4 h-4 mr-2" />
              Cost Analytics
            </TabsTrigger>
          </TabsList>

          <TabsContent value="benchmarks" className="mt-6">
            <BenchmarksTab
              data={data}
              isLoading={isLoading}
              error={error}
              searchTerm={searchTerm}
              setSearchTerm={setSearchTerm}
              selectedUnit={selectedUnit}
              setSelectedUnit={setSelectedUnit}
              datePreset={datePreset}
              setDatePreset={setDatePreset}
              onViewDetails={handleViewDetails}
            />
          </TabsContent>

          <TabsContent value="cost-analytics" className="mt-6">
            <CostAnalyticsTab
              costData={costData}
              costLoading={costLoading}
              searchTerm={searchTerm}
              setSearchTerm={setSearchTerm}
              selectedUnit={selectedUnit}
              setSelectedUnit={setSelectedUnit}
              datePreset={datePreset}
              setDatePreset={setDatePreset}
            />
          </TabsContent>
        </Tabs>
      </main>

      <ProductionRateDetailDialog
        open={detailDialogOpen}
        onOpenChange={setDetailDialogOpen}
        selectedRate={selectedRate}
        detailData={detailData}
        detailLoading={detailLoading}
      />
    </div>
  );
}
