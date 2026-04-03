import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Shield, AlertTriangle, FileCheck } from "lucide-react";
import { AIAnalysisButton } from "@/components/AIAnalysisButton";

interface AIContractAnalysisPanelProps {
  className?: string;
}

export function AIContractAnalysisPanel({ className = "" }: AIContractAnalysisPanelProps) {
  const { data: insights, isLoading } = useQuery<any[]>({
    queryKey: ['/api/ai-insights', 'COSTS'],
  });

  const contractInsights = insights?.filter?.((i: any) => 
    i.module === "COSTS" || i.category === "CONTRACT"
  ) || [];

  const riskItems = contractInsights.filter((i: any) => i.severity === "HIGH" || i.severity === "CRITICAL");

  return (
    <Card className={className} data-testid="card-ai-contract-analysis">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            AI Contract Analysis
          </CardTitle>
          <AIAnalysisButton module="COSTS" variant="outline" size="sm" data-testid="button-ai-contract-analyze" />
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading contract insights...</div>
        ) : contractInsights.length === 0 ? (
          <div className="text-center py-4 space-y-2">
            <FileCheck className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground" data-testid="text-no-contract-insights">
              No contract insights yet. Run AI analysis to identify risks, missing clauses, and optimization opportunities.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {riskItems.length > 0 && (
              <div className="flex items-center gap-2 p-2 rounded bg-destructive/10 text-destructive text-sm" data-testid="text-contract-risk-alert">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{riskItems.length} high-priority contract issue{riskItems.length !== 1 ? 's' : ''} detected</span>
              </div>
            )}
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {contractInsights.slice(0, 5).map((insight: any, index: number) => (
                <div key={insight.id || index} className="flex items-start gap-2 p-2 rounded border text-sm" data-testid={`card-contract-insight-${index}`}>
                  <Shield className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="line-clamp-2 text-foreground">{insight.title || insight.description}</p>
                    {insight.severity && (
                      <Badge variant={insight.severity === "HIGH" || insight.severity === "CRITICAL" ? "destructive" : "secondary"} className="mt-1 text-xs">
                        {insight.severity}
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
