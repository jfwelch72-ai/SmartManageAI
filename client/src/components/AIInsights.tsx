import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  AlertTriangle, 
  Wrench, 
  CloudRain, 
  FileEdit, 
  Shield, 
  MessageSquare, 
  Info,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Package,
  RefreshCw
} from "lucide-react";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface AIInsight {
  id: string;
  category: string;
  summary: string;
  recommendedActions: string[];
  severity: string;
  recipients: string[];
  sourceType: string;
  sourceId: string;
  projectId: string | null;
  createdAt: string;
  project: {
    code: string;
    name: string;
  } | null;
}

interface AIInsightsProps {
  projectId?: string;
  roleFiltered?: boolean;
  limit?: number;
  title?: string;
  showProject?: boolean;
}

const categoryIcons: Record<string, typeof AlertTriangle> = {
  SUPPLY_NEED: Package,
  EQUIPMENT_REPAIR: Wrench,
  WEATHER_DELAY: CloudRain,
  CHANGE_ORDER: FileEdit,
  SAFETY: Shield,
  CLIENT_COMMUNICATION: MessageSquare,
  OTHER: Info,
};

const categoryLabels: Record<string, string> = {
  SUPPLY_NEED: "Supply Need",
  EQUIPMENT_REPAIR: "Equipment Repair",
  WEATHER_DELAY: "Weather Delay",
  CHANGE_ORDER: "Change Order",
  SAFETY: "Safety",
  CLIENT_COMMUNICATION: "Client Communication",
  OTHER: "Other",
};

const severityColors: Record<string, string> = {
  LOW: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  MEDIUM: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  HIGH: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  CRITICAL: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

export function AIInsights({
  projectId,
  roleFiltered = false,
  limit = 50,
  title = "AI-Generated Insights",
  showProject = true,
}: AIInsightsProps) {
  const [expandedInsights, setExpandedInsights] = useState<Set<string>>(new Set());
  const { user } = useAuth();
  const { toast } = useToast();

  // Only admins and managers can trigger manual analysis
  const canTriggerAnalysis = user && ["ADMIN", "MANAGER"].includes(user.role);

  // Determine which endpoint to use
  const endpoint = projectId
    ? `/api/insights/project/${projectId}?limit=${limit}`
    : roleFiltered
    ? `/api/insights/role?limit=${limit}`
    : `/api/insights?limit=${limit}`;

  const { data, isLoading, error } = useQuery<{ insights: AIInsight[] }>({
    queryKey: ["ai-insights", projectId, roleFiltered, limit],
    queryFn: async () => {
      const response = await fetch(endpoint, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Failed to fetch AI insights");
      }
      return response.json();
    },
  });

  // Mutation for triggering manual AI analysis
  const triggerAnalysisMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/analyze", { hoursBack: 24 });
    },
    onSuccess: (data: any) => {
      toast({
        title: "AI Analysis Complete",
        description: `Generated ${data.insightsGenerated} new insights from recent notes.`,
      });
      // Invalidate insights cache to refresh the list
      queryClient.invalidateQueries({ queryKey: ["ai-insights"] });
    },
    onError: (error) => {
      toast({
        title: "Analysis Failed",
        description: error instanceof Error ? error.message : "Failed to trigger AI analysis",
        variant: "destructive",
      });
    },
  });

  const toggleExpanded = (insightId: string) => {
    setExpandedInsights(prev => {
      const next = new Set(prev);
      if (next.has(insightId)) {
        next.delete(insightId);
      } else {
        next.add(insightId);
      }
      return next;
    });
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          Failed to load AI insights. Please try again later.
        </AlertDescription>
      </Alert>
    );
  }

  const insights = data?.insights || [];

  if (insights.length === 0) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              {title}
            </CardTitle>
            {canTriggerAnalysis && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => triggerAnalysisMutation.mutate()}
                disabled={triggerAnalysisMutation.isPending}
                data-testid="button-trigger-ai-analysis"
                className="gap-2"
              >
                <RefreshCw className={`w-3 h-3 ${triggerAnalysisMutation.isPending ? 'animate-spin' : ''}`} />
                {triggerAnalysisMutation.isPending ? "Analyzing..." : "Analyze Now"}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <Sparkles className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No insights generated yet.</p>
            <p className="text-sm mt-1">AI will analyze daily notes automatically.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            {title}
          </CardTitle>
          <div className="flex items-center gap-2">
            {canTriggerAnalysis && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => triggerAnalysisMutation.mutate()}
                disabled={triggerAnalysisMutation.isPending}
                data-testid="button-trigger-ai-analysis"
                className="gap-2"
              >
                <RefreshCw className={`w-3 h-3 ${triggerAnalysisMutation.isPending ? 'animate-spin' : ''}`} />
                {triggerAnalysisMutation.isPending ? "Analyzing..." : "Analyze Now"}
              </Button>
            )}
            <Badge variant="secondary" data-testid="badge-insights-count">
              {insights.length} insight{insights.length !== 1 ? 's' : ''}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {insights.map((insight) => {
          const Icon = categoryIcons[insight.category] || Info;
          const isExpanded = expandedInsights.has(insight.id);

          return (
            <div
              key={insight.id}
              className="border rounded-lg p-4 space-y-3 hover-elevate"
              data-testid={`insight-card-${insight.id}`}
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 flex-1">
                  <div className="mt-0.5">
                    <Icon className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <Badge variant="outline" className="text-xs" data-testid={`badge-category-${insight.id}`}>
                        {categoryLabels[insight.category]}
                      </Badge>
                      <Badge 
                        className={`text-xs ${severityColors[insight.severity]}`}
                        data-testid={`badge-severity-${insight.id}`}
                      >
                        {insight.severity}
                      </Badge>
                      {showProject && insight.project && (
                        <Badge variant="secondary" className="text-xs" data-testid={`badge-project-${insight.id}`}>
                          {insight.project.code}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm font-medium" data-testid={`text-summary-${insight.id}`}>
                      {insight.summary}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {format(new Date(insight.createdAt), "MMM d, yyyy 'at' h:mm a")}
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => toggleExpanded(insight.id)}
                  data-testid={`button-toggle-${insight.id}`}
                >
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </Button>
              </div>

              {/* Expanded Details */}
              {isExpanded && (
                <div className="space-y-3 pt-2 border-t">
                  {insight.recommendedActions && insight.recommendedActions.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-2">
                        Recommended Actions:
                      </p>
                      <ul className="space-y-1">
                        {insight.recommendedActions.map((action, idx) => (
                          <li
                            key={idx}
                            className="text-sm flex items-start gap-2"
                            data-testid={`action-${insight.id}-${idx}`}
                          >
                            <span className="text-primary mt-1">•</span>
                            <span>{action}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {insight.recipients && insight.recipients.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-2">
                        Notify:
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {insight.recipients.map((recipient) => (
                          <Badge
                            key={recipient}
                            variant="secondary"
                            className="text-xs"
                            data-testid={`recipient-${insight.id}-${recipient}`}
                          >
                            {recipient.replace(/_/g, ' ')}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
