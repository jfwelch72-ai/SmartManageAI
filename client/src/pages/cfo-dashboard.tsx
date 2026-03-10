import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useFeaturePermission } from "@/hooks/use-dashboard-customization";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { DollarSign, Sparkles, RefreshCw, Download } from "lucide-react";
import { useLocation } from "wouter";
import { AIAnalysisButton } from "@/components/AIAnalysisButton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { FinancialKPICards } from "@/components/cfo/FinancialKPICards";
import { ProjectProfitabilityTable } from "@/components/cfo/ProjectProfitabilityTable";
import { EquipmentMetrics } from "@/components/cfo/EquipmentMetrics";
import type {
  ProjectProfitability,
  EquipmentMetricsData,
} from "@/components/cfo/types";

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

export default function CFODashboard() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const hasFinancialsPermission = useFeaturePermission('canAccessFinancials');
  const hasAiPermission = useFeaturePermission('canUseAiFeatures');

  const canAccessCFO = !!user && (
    user.role === "ADMIN" || user.role === "MANAGER" || user.role === "SUPER_ADMIN" ||
    hasFinancialsPermission || hasAiPermission
  );

  const { data: profitability, isLoading } = useQuery<ProjectProfitability[]>({
    queryKey: ["/api/cfo/profitability"],
    enabled: canAccessCFO,
  });

  const { data: equipmentMetrics, isLoading: equipmentLoading } =
    useQuery<EquipmentMetricsData>({
      queryKey: ["/api/cfo/equipment-metrics"],
      enabled: canAccessCFO,
    });

  const runFullAnalysis = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/ai-pm/run");
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Full CFO Analysis Complete",
        description:
          "Profitability data and equipment metrics have been updated with AI insights.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/cfo/profitability"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/cfo/equipment-metrics"],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/ai-insights"] });
    },
    onError: (error: any) => {
      toast({
        title: "Analysis Failed",
        description:
          error.message || "Failed to run full CFO analysis. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleProjectClick = (projectCode: string) => {
    setLocation(`/projects/${projectCode}?from=cfo`);
  };

  const handleEquipmentClick = () => {
    setLocation("/equipment");
  };

  const exportToCSV = () => {
    if (!profitability || profitability.length === 0) {
      toast({
        title: "No Data",
        description: "No profitability data to export.",
        variant: "destructive",
      });
      return;
    }
    const headers = [
      "Project Code",
      "Project Name",
      "Budget",
      "Adjusted Budget",
      "Labor Cost",
      "Material Cost",
      "Other Expenses",
      "Approved COs",
      "Total Actual Cost",
      "Variance",
      "Variance %",
      "Status",
      "Projected Completion Cost",
      "Estimated Margin",
      "Labor Hours",
      "Labor Efficiency",
      "Material Spend Rate",
      "Pending COs Value",
    ];
    const rows = profitability.map((p) => [
      p.project_code,
      `"${p.project_name}"`,
      p.budget,
      p.adjusted_budget,
      p.total_labor_cost,
      p.total_material_cost,
      p.total_other_expenses,
      p.approved_change_orders_value,
      p.total_actual_cost,
      p.variance,
      `${p.variance_percent.toFixed(1)}%`,
      p.status,
      p.projected_completion_cost,
      p.estimated_margin,
      p.key_metrics.labor_hours,
      p.key_metrics.labor_efficiency,
      p.key_metrics.material_spend_rate,
      p.key_metrics.pending_change_orders_value,
    ]);
    const csvContent = [
      headers.join(","),
      ...rows.map((r) => r.join(",")),
    ].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `cfo-dashboard-${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast({
      title: "Export Complete",
      description: `Exported ${profitability.length} projects to CSV.`,
    });
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-background">
        <main className="p-8 text-center">
          <p className="text-muted-foreground">
            Please log in to view profitability data
          </p>
        </main>
      </div>
    );
  }

  if (!canAccessCFO) {
    return (
      <div className="min-h-screen bg-background">
        <main className="p-8 text-center">
          <p className="text-muted-foreground">
            You don't have permission to access the CFO Dashboard
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-full px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-6 sm:mb-8 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
              <DollarSign className="h-6 w-6 sm:h-8 sm:w-8 text-primary" />
              CFO Dashboard
            </h1>
            <p className="text-sm sm:text-base text-muted-foreground mt-1">
              Real-time profitability analysis across all projects
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="default"
              size="sm"
              onClick={() => runFullAnalysis.mutate()}
              disabled={runFullAnalysis.isPending}
              data-testid="cfo-run-full-analysis"
            >
              {runFullAnalysis.isPending ? (
                <RefreshCw className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Sparkles className="h-4 w-4 mr-2" />
              )}
              <span className="hidden sm:inline">
                {runFullAnalysis.isPending
                  ? "Running..."
                  : "Run Full CFO Analysis"}
              </span>
              <span className="sm:hidden">
                {runFullAnalysis.isPending ? "Running..." : "CFO Analysis"}
              </span>
            </Button>
            <AIAnalysisButton showDropdown={true} variant="outline" size="sm" />
            <Button
              variant="outline"
              size="sm"
              onClick={exportToCSV}
              disabled={!profitability || profitability.length === 0}
              data-testid="cfo-export-csv"
            >
              <Download className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">Export CSV</span>
              <span className="sm:hidden">Export</span>
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-4">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-32 w-full" />
              ))}
            </div>
          </div>
        ) : (
          <>
            <FinancialKPICards
              profitability={profitability || []}
              formatCurrency={formatCurrency}
              onProjectClick={handleProjectClick}
            />

            <EquipmentMetrics
              equipmentMetrics={equipmentMetrics}
              isLoading={equipmentLoading}
              formatCurrency={formatCurrency}
              onEquipmentClick={handleEquipmentClick}
            />

            <ProjectProfitabilityTable
              profitability={profitability}
              formatCurrency={formatCurrency}
              onProjectClick={handleProjectClick}
              onRunAnalysis={() => runFullAnalysis.mutate()}
              isAnalysisPending={runFullAnalysis.isPending}
            />
          </>
        )}
      </main>
    </div>
  );
}
