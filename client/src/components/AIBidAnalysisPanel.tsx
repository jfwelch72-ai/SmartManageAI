import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkles, FileSearch, AlertTriangle, TrendingUp } from "lucide-react";
import { AIAnalysisButton } from "@/components/AIAnalysisButton";

interface AIBidAnalysisPanelProps {
  className?: string;
}

export function AIBidAnalysisPanel({ className = "" }: AIBidAnalysisPanelProps) {
  const { data: insights, isLoading } = useQuery<any[]>({
    queryKey: ['/api/ai-insights', 'BIDS'],
  });

  const bidInsights = insights?.filter?.((i: any) =>
    i.module === "BIDS" || i.category === "BID"
  ) || [];

  const riskItems = bidInsights.filter((i: any) => i.severity === "HIGH" || i.severity === "CRITICAL");

  return (
    <Card className={className} data-testid="card-ai-bid-analysis">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            AI Bid Analysis
          </CardTitle>
          <AIAnalysisButton module="BIDS" variant="outline" size="sm" data-testid="button-ai-bid-analyze" />
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading bid insights...</div>
        ) : bidInsights.length === 0 ? (
          <div className="text-center py-4 space-y-2">
            <FileSearch className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground" data-testid="text-no-bid-insights">
              No bid insights yet. Run AI analysis to evaluate bid competitiveness, pricing risks, and opportunities.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {riskItems.length > 0 && (
              <div className="flex items-center gap-2 p-2 rounded bg-destructive/10 text-destructive text-sm" data-testid="text-bid-risk-alert">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{riskItems.length} bid risk{riskItems.length !== 1 ? 's' : ''} identified</span>
              </div>
            )}
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {bidInsights.slice(0, 5).map((insight: any, index: number) => (
                <div key={insight.id || index} className="flex items-start gap-2 p-2 rounded border text-sm" data-testid={`card-bid-insight-${index}`}>
                  <TrendingUp className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
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
