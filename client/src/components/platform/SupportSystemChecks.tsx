import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Database, RefreshCw, CheckCircle, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface SowLinkStats {
  metric: string;
  count: number;
}

interface BackfillResult {
  message: string;
  scopeItemsUpdated: number;
  estimateLineItemsUpdated: number;
  dailyProgressUpdated: number;
  sovLineItemsUpdated: number;
}

export function SupportSystemChecks() {
  const { toast } = useToast();

  const { data: sowLinkStats, isLoading: sowStatsLoading, refetch: refetchSowStats } = useQuery<SowLinkStats[]>({
    queryKey: ["/api/platform/sow-link-stats"],
  });

  const backfillSowLinksMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/platform/backfill-sow-links");
      return response.json() as Promise<BackfillResult>;
    },
    onSuccess: (data) => {
      refetchSowStats();
      toast({ 
        title: "SOW Links Backfill Complete", 
        description: `Updated ${data.scopeItemsUpdated} scope items, ${data.estimateLineItemsUpdated} estimate line items, ${data.dailyProgressUpdated} daily progress entries, and ${data.sovLineItemsUpdated} SOV line items` 
      });
    },
    onError: (error: any) => {
      toast({ title: "Backfill failed", description: error.message, variant: "destructive" });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-5 w-5" />
          SOW Link Backfill Tool
        </CardTitle>
        <CardDescription>
          Link existing scope items and estimate line items to their master SOW items for production rate tracking across projects
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {sowStatsLoading ? (
            <>
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </>
          ) : (
            <>
              <Card className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  {(sowLinkStats?.find(s => s.metric === "scope_items_without_sow")?.count || 0) > 0 ? (
                    <AlertCircle className="h-5 w-5 text-amber-500" />
                  ) : (
                    <CheckCircle className="h-5 w-5 text-green-500" />
                  )}
                  <span className="text-sm font-medium">Scope Items</span>
                </div>
                <div className="text-2xl font-bold">
                  {sowLinkStats?.find(s => s.metric === "scope_items_without_sow")?.count || 0}
                </div>
                <div className="text-xs text-muted-foreground">
                  of {sowLinkStats?.find(s => s.metric === "total_scope_items")?.count || 0} unlinked
                </div>
              </Card>
              <Card className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  {(sowLinkStats?.find(s => s.metric === "estimate_line_items_without_sow")?.count || 0) > 0 ? (
                    <AlertCircle className="h-5 w-5 text-amber-500" />
                  ) : (
                    <CheckCircle className="h-5 w-5 text-green-500" />
                  )}
                  <span className="text-sm font-medium">Estimate Line Items</span>
                </div>
                <div className="text-2xl font-bold">
                  {sowLinkStats?.find(s => s.metric === "estimate_line_items_without_sow")?.count || 0}
                </div>
                <div className="text-xs text-muted-foreground">
                  of {sowLinkStats?.find(s => s.metric === "total_estimate_line_items")?.count || 0} unlinked
                </div>
              </Card>
              <Card className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  {(sowLinkStats?.find(s => s.metric === "daily_progress_without_sow")?.count || 0) > 0 ? (
                    <AlertCircle className="h-5 w-5 text-amber-500" />
                  ) : (
                    <CheckCircle className="h-5 w-5 text-green-500" />
                  )}
                  <span className="text-sm font-medium">Daily Progress</span>
                </div>
                <div className="text-2xl font-bold">
                  {sowLinkStats?.find(s => s.metric === "daily_progress_without_sow")?.count || 0}
                </div>
                <div className="text-xs text-muted-foreground">
                  of {sowLinkStats?.find(s => s.metric === "total_daily_progress")?.count || 0} unlinked
                </div>
              </Card>
              <Card className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  {(sowLinkStats?.find(s => s.metric === "sov_line_items_without_sow")?.count || 0) > 0 ? (
                    <AlertCircle className="h-5 w-5 text-amber-500" />
                  ) : (
                    <CheckCircle className="h-5 w-5 text-green-500" />
                  )}
                  <span className="text-sm font-medium">SOV Line Items</span>
                </div>
                <div className="text-2xl font-bold">
                  {sowLinkStats?.find(s => s.metric === "sov_line_items_without_sow")?.count || 0}
                </div>
                <div className="text-xs text-muted-foreground">
                  of {sowLinkStats?.find(s => s.metric === "total_sov_line_items")?.count || 0} unlinked
                </div>
              </Card>
            </>
          )}
        </div>

        <div className="flex items-center gap-4">
          <Button
            onClick={() => backfillSowLinksMutation.mutate()}
            disabled={backfillSowLinksMutation.isPending}
            data-testid="button-backfill-sow"
          >
            {backfillSowLinksMutation.isPending ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Running Backfill...
              </>
            ) : (
              <>
                <Database className="h-4 w-4 mr-2" />
                Run SOW Link Backfill
              </>
            )}
          </Button>
          <Button
            variant="outline"
            onClick={() => refetchSowStats()}
            data-testid="button-refresh-stats"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh Stats
          </Button>
        </div>

        <div className="text-sm text-muted-foreground p-4 bg-muted rounded-lg">
          <p className="font-medium mb-2">What this tool does:</p>
          <ul className="list-disc list-inside space-y-1">
            <li>Matches existing scope items, estimate line items, and SOV line items to your organization's master SOW library by description</li>
            <li>Updates daily progress entries to inherit the SOW link from their parent scope items</li>
            <li>Enables production rate tracking, billing analytics, and cross-project analytics for historical data</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
