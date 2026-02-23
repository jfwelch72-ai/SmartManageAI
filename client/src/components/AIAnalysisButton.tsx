import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { 
  Sparkles, 
  RefreshCw,
  Calendar,
  Clock,
  DollarSign,
  Truck,
  TrendingUp,
  BarChart3,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface AIAnalysisButtonProps {
  projectId?: string;
  module?: string;
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "lg" | "icon";
  showDropdown?: boolean;
  className?: string;
}

const moduleOptions = [
  { key: "ALL", label: "Run Full Analysis", icon: Sparkles, description: "Analyze all aspects" },
  { key: "SCHEDULING", label: "Scheduling Analysis", icon: Calendar, description: "Optimize timelines" },
  { key: "DELAYS", label: "Delay Analysis", icon: Clock, description: "Identify delay patterns" },
  { key: "COSTS", label: "Cost Analysis", icon: DollarSign, description: "Find savings opportunities" },
  { key: "EQUIPMENT", label: "Equipment Analysis", icon: Truck, description: "Optimize equipment" },
  { key: "VENDOR_PRICING", label: "Vendor Pricing", icon: TrendingUp, description: "Compare vendor prices" },
  { key: "PROJECT_HEALTH", label: "Health Score", icon: BarChart3, description: "Overall project health" },
];

export function AIAnalysisButton({
  projectId,
  module,
  variant = "outline",
  size = "sm",
  showDropdown = false,
  className = "",
}: AIAnalysisButtonProps) {
  const { toast } = useToast();

  const runAnalysisMutation = useMutation({
    mutationFn: async (selectedModule: string) => {
      const response = await apiRequest('POST', '/api/ai-analyze', { 
        module: selectedModule, 
        projectId, 
        saveResults: true 
      });
      return response.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "AI Analysis Complete",
        description: `Generated ${data.insights?.length || 0} insights for ${data.module} analysis.`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/ai-insights'] });
      queryClient.invalidateQueries({ queryKey: ['/api/ai-insights/dashboard-summary'] });
      queryClient.invalidateQueries({ queryKey: ['/api/cfo/profitability'] });
      queryClient.invalidateQueries({ queryKey: ['/api/cfo/equipment-metrics'] });
    },
    onError: (error: any) => {
      toast({
        title: "Analysis Failed",
        description: error.message || "Failed to run AI analysis. Please try again.",
        variant: "destructive",
      });
    },
  });

  if (showDropdown) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button 
            variant={variant} 
            size={size} 
            className={className}
            disabled={runAnalysisMutation.isPending}
            data-testid="ai-analysis-dropdown-trigger"
          >
            {runAnalysisMutation.isPending ? (
              <RefreshCw className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Sparkles className="h-4 w-4 mr-2" />
            )}
            AI Analysis
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Choose Analysis Type</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {moduleOptions.map((option) => (
            <DropdownMenuItem
              key={option.key}
              onClick={() => runAnalysisMutation.mutate(option.key)}
              disabled={runAnalysisMutation.isPending}
              data-testid={`ai-analysis-option-${option.key.toLowerCase()}`}
            >
              <option.icon className="h-4 w-4 mr-2 text-muted-foreground" />
              <div className="flex flex-col">
                <span className="text-sm font-medium">{option.label}</span>
                <span className="text-xs text-muted-foreground">{option.description}</span>
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <Button 
      variant={variant} 
      size={size} 
      className={className}
      onClick={() => runAnalysisMutation.mutate(module || 'ALL')}
      disabled={runAnalysisMutation.isPending}
      data-testid="ai-analysis-button"
    >
      {runAnalysisMutation.isPending ? (
        <RefreshCw className="h-4 w-4 animate-spin mr-2" />
      ) : (
        <Sparkles className="h-4 w-4 mr-2" />
      )}
      {runAnalysisMutation.isPending ? 'Analyzing...' : 'AI Analysis'}
    </Button>
  );
}

export default AIAnalysisButton;
