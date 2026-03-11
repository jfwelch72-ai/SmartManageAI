import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  AlertCircle, 
  AlertTriangle, 
  Lightbulb, 
  Info, 
  RefreshCw, 
  Check, 
  ChevronRight,
  Sparkles,
  TrendingUp,
  Clock,
  DollarSign,
  Truck,
  Calendar,
  BarChart3,
  Lock,
} from "lucide-react";
import { useFeaturePermission } from "@/hooks/use-dashboard-customization";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface AIInsight {
  id: string;
  module: string;
  severity: "INFO" | "SUGGESTION" | "WARNING" | "CRITICAL";
  title: string;
  summary: string;
  details?: string;
  recommendations?: string[];
  metrics?: Record<string, any>;
  estimatedImpact?: string;
  actionItems?: string[];
  isAcknowledged: boolean;
  createdAt: string;
}

interface DashboardSummary {
  recentInsights: AIInsight[];
  countBySeverity: Record<string, number>;
  countByModule: Record<string, number>;
  totalUnacknowledged: number;
}

const severityConfig = {
  CRITICAL: { icon: AlertCircle, color: "text-red-500", bg: "bg-red-500/10", badge: "destructive" },
  WARNING: { icon: AlertTriangle, color: "text-yellow-500", bg: "bg-yellow-500/10", badge: "warning" },
  SUGGESTION: { icon: Lightbulb, color: "text-blue-500", bg: "bg-blue-500/10", badge: "secondary" },
  INFO: { icon: Info, color: "text-gray-500", bg: "bg-gray-500/10", badge: "outline" },
};

const moduleConfig: Record<string, { icon: any; label: string }> = {
  SCHEDULING: { icon: Calendar, label: "Scheduling" },
  DELAYS: { icon: Clock, label: "Delays" },
  COSTS: { icon: DollarSign, label: "Costs" },
  EQUIPMENT: { icon: Truck, label: "Equipment" },
  VENDOR_PRICING: { icon: TrendingUp, label: "Vendor Pricing" },
  PROJECT_HEALTH: { icon: BarChart3, label: "Project Health" },
  GANTT_CHART: { icon: Calendar, label: "Gantt Chart" },
  LABOR: { icon: Clock, label: "Labor" },
  BIDS: { icon: DollarSign, label: "Bids" },
  CHANGE_ORDERS: { icon: BarChart3, label: "Change Orders" },
};

function InsightCard({ insight, onAcknowledge, onClick }: { 
  insight: AIInsight; 
  onAcknowledge: (id: string) => void;
  onClick: () => void;
}) {
  const config = severityConfig[insight.severity] || severityConfig.INFO;
  const Icon = config.icon;
  const moduleInfo = moduleConfig[insight.module] || { icon: Sparkles, label: insight.module };
  const ModuleIcon = moduleInfo.icon;

  return (
    <div 
      className={`p-4 rounded-lg border ${config.bg} cursor-pointer hover-elevate transition-all`}
      onClick={onClick}
      data-testid={`insight-card-${insight.id}`}
    >
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-full ${config.bg}`}>
          <Icon className={`h-4 w-4 ${config.color}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant={config.badge as any} className="text-xs">
              {insight.severity}
            </Badge>
            <Badge variant="outline" className="text-xs flex items-center gap-1">
              <ModuleIcon className="h-3 w-3" />
              {moduleInfo.label}
            </Badge>
          </div>
          <h4 className="font-medium text-sm truncate">{insight.title}</h4>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{insight.summary}</p>
          {insight.estimatedImpact && (
            <p className="text-xs text-primary mt-1 font-medium">{insight.estimatedImpact}</p>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <Button 
            size="sm" 
            variant="ghost" 
            className="h-7 w-7 p-0"
            onClick={(e) => {
              e.stopPropagation();
              onClick();
            }}
            data-testid={`view-insight-${insight.id}`}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          {!insight.isAcknowledged && (
            <Button 
              size="sm" 
              variant="ghost" 
              className="h-7 w-7 p-0"
              onClick={(e) => {
                e.stopPropagation();
                onAcknowledge(insight.id);
              }}
              data-testid={`acknowledge-insight-${insight.id}`}
            >
              <Check className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function AIInsightsWidget({ 
  compact = false,
  projectId,
}: { 
  compact?: boolean;
  projectId?: string;
}) {
  const { toast } = useToast();
  const hasPermission = useFeaturePermission("canUseAiFeatures");
  const [selectedInsight, setSelectedInsight] = useState<AIInsight | null>(null);
  const [selectedModule, setSelectedModule] = useState<string | null>(null);

  const { data: summary, isLoading: summaryLoading, refetch: refetchSummary } = useQuery<DashboardSummary>({
    queryKey: ['/api/ai-insights/dashboard-summary'],
    enabled: hasPermission,
  });

  const { data: insights, isLoading: insightsLoading, refetch: refetchInsights } = useQuery<AIInsight[]>({
    queryKey: ['/api/ai-insights', { module: selectedModule, projectId, acknowledged: 'false' }],
    enabled: !compact && hasPermission,
  });

  const runAnalysisMutation = useMutation({
    mutationFn: async (module: string = 'ALL') => {
      const response = await apiRequest('POST', '/api/ai-analyze', { module, projectId, saveResults: true });
      return response.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "AI Analysis Complete",
        description: `Generated ${data.insights?.length || 0} insights across ${data.module} modules.`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/ai-insights'] });
      refetchSummary();
      refetchInsights();
    },
    onError: (error: any) => {
      toast({
        title: "Analysis Failed",
        description: error.message || "Failed to run AI analysis. Please try again.",
        variant: "destructive",
      });
    },
  });

  const acknowledgeMutation = useMutation({
    mutationFn: async (insightId: string) => {
      return apiRequest('PATCH', `/api/ai-insights/${insightId}/acknowledge`);
    },
    onSuccess: () => {
      toast({
        title: "Insight Acknowledged",
        description: "The insight has been marked as acknowledged.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/ai-insights'] });
      refetchSummary();
      refetchInsights();
    },
  });

  if (!hasPermission) {
    return (
      <Card data-testid="ai-insights-no-permission">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">AI Insights</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">You don't have permission to view AI insights.</p>
        </CardContent>
      </Card>
    );
  }

  const displayInsights = compact 
    ? (summary?.recentInsights || []).slice(0, 5)
    : (insights || []);

  if (summaryLoading && compact) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            AI Insights
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-16 bg-muted rounded-lg" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card data-testid="ai-insights-widget">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                AI Insights
              </CardTitle>
              <CardDescription>
                {summary?.totalUnacknowledged || 0} unacknowledged insights
              </CardDescription>
            </div>
            <Button 
              size="sm" 
              variant="outline"
              onClick={() => runAnalysisMutation.mutate('ALL')}
              disabled={runAnalysisMutation.isPending}
              data-testid="run-ai-analysis-button"
            >
              {runAnalysisMutation.isPending ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              <span className="ml-2">{runAnalysisMutation.isPending ? 'Analyzing...' : 'Run Analysis'}</span>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!compact && (
            <div className="mb-4">
              <div className="flex flex-wrap gap-2 mb-4">
                {summary?.countBySeverity && Object.entries(summary.countBySeverity).map(([severity, count]) => {
                  const config = severityConfig[severity as keyof typeof severityConfig] || severityConfig.INFO;
                  return (
                    <Badge key={severity} variant={config.badge as any} className="gap-1">
                      {severity}: {count}
                    </Badge>
                  );
                })}
              </div>
              <Tabs defaultValue="all" onValueChange={(v) => setSelectedModule(v === 'all' ? null : v)}>
                <TabsList className="flex-wrap h-auto">
                  <TabsTrigger value="all">All</TabsTrigger>
                  {Object.entries(moduleConfig).map(([key, config]) => (
                    <TabsTrigger key={key} value={key} className="gap-1">
                      <config.icon className="h-3 w-3" />
                      {config.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
          )}

          <ScrollArea className={compact ? "h-64" : "h-96"}>
            <div className="space-y-3 pr-4">
              {displayInsights.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No AI insights yet.</p>
                  <p className="text-xs mt-1">Click "Run Analysis" to generate insights.</p>
                </div>
              ) : (
                displayInsights.map((insight) => (
                  <InsightCard 
                    key={insight.id} 
                    insight={insight} 
                    onAcknowledge={(id) => acknowledgeMutation.mutate(id)}
                    onClick={() => setSelectedInsight(insight)}
                  />
                ))
              )}
            </div>
          </ScrollArea>

          {compact && summary && summary.totalUnacknowledged > 5 && (
            <div className="mt-4 pt-4 border-t">
              <Button variant="outline" size="sm" className="w-full" data-testid="view-all-insights-button">
                View All {summary.totalUnacknowledged} Insights
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedInsight} onOpenChange={() => setSelectedInsight(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          {selectedInsight && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant={severityConfig[selectedInsight.severity]?.badge as any}>
                    {selectedInsight.severity}
                  </Badge>
                  <Badge variant="outline" className="flex items-center gap-1">
                    {moduleConfig[selectedInsight.module]?.label || selectedInsight.module}
                  </Badge>
                </div>
                <DialogTitle>{selectedInsight.title}</DialogTitle>
                <DialogDescription>{selectedInsight.summary}</DialogDescription>
              </DialogHeader>

              <div className="space-y-4 mt-4">
                {selectedInsight.details && (
                  <div>
                    <h4 className="font-medium text-sm mb-2">Details</h4>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{selectedInsight.details}</p>
                  </div>
                )}

                {selectedInsight.metrics && Object.keys(selectedInsight.metrics).length > 0 && (
                  <div>
                    <h4 className="font-medium text-sm mb-2">Metrics</h4>
                    <div className="grid grid-cols-2 gap-2">
                      {Object.entries(selectedInsight.metrics).map(([key, value]) => (
                        <div key={key} className="p-2 bg-muted rounded-lg">
                          <p className="text-xs text-muted-foreground">{key.replace(/_/g, ' ')}</p>
                          <p className="font-medium">{typeof value === 'number' ? value.toLocaleString() : String(value)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedInsight.estimatedImpact && (
                  <div>
                    <h4 className="font-medium text-sm mb-2">Estimated Impact</h4>
                    <p className="text-sm text-primary">{selectedInsight.estimatedImpact}</p>
                  </div>
                )}

                {selectedInsight.recommendations && selectedInsight.recommendations.length > 0 && (
                  <div>
                    <h4 className="font-medium text-sm mb-2">Recommendations</h4>
                    <ul className="list-disc list-inside space-y-1">
                      {selectedInsight.recommendations.map((rec, i) => (
                        <li key={i} className="text-sm text-muted-foreground">{rec}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {selectedInsight.actionItems && selectedInsight.actionItems.length > 0 && (
                  <div>
                    <h4 className="font-medium text-sm mb-2">Action Items</h4>
                    <ul className="space-y-2">
                      {selectedInsight.actionItems.map((action, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <Check className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                          <span>{action}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-4 border-t">
                  {!selectedInsight.isAcknowledged && (
                    <Button 
                      onClick={() => {
                        acknowledgeMutation.mutate(selectedInsight.id);
                        setSelectedInsight(null);
                      }}
                      data-testid="acknowledge-insight-dialog-button"
                    >
                      <Check className="h-4 w-4 mr-2" />
                      Acknowledge
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => setSelectedInsight(null)}>
                    Close
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export default AIInsightsWidget;
