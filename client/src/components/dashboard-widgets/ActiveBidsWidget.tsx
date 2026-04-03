import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, ChevronRight, AlertCircle, RefreshCw } from "lucide-react";
import { useLocation } from "wouter";
import { useBids } from "@/hooks/use-data";
import { format } from "date-fns";
import { useState } from "react";

export function ActiveBidsWidget({ config }: { config?: Record<string, unknown> }) {
  const [, setLocation] = useLocation();
  const { data: bids = [], isLoading, isError, refetch } = useBids();
  const [showAll, setShowAll] = useState(false);
  const displayLimit = (config?.displayLimit as number) || 4;
  const displayedBids = showAll ? bids : bids.slice(0, displayLimit);
  const hasMore = bids.length > displayLimit;

  return (
    <Card className="h-full" data-testid="card-active-bids">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="w-4 h-4" />
            Active Bids
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocation("/bids")}
            data-testid="button-view-all-bids"
          >
            View All
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="p-3 rounded-md border space-y-2">
                <div className="flex gap-2">
                  <Skeleton className="h-5 w-16" />
                  <Skeleton className="h-5 w-10" />
                </div>
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-6 text-center gap-2" data-testid="active-bids-error">
            <AlertCircle className="w-6 h-6 text-destructive" />
            <p className="text-sm text-muted-foreground">Failed to load bids.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-retry-bids">
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              Retry
            </Button>
          </div>
        ) : bids.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-center" data-testid="active-bids-empty">
            <FileText className="w-6 h-6 text-muted-foreground/50 mb-2" />
            <p className="text-sm text-muted-foreground">No active bids</p>
          </div>
        ) : (
          <div className="space-y-3">
            {displayedBids.map((bid) => {
              const bidAmountNum = Number(bid.bidAmount);
              const hasBudget =
                bid.bidAmount && !isNaN(bidAmountNum) && bidAmountNum > 0;
              return (
                <div
                  key={bid.code}
                  className="p-3 rounded-md border hover-elevate cursor-pointer"
                  onClick={() =>
                    setLocation(`/bids/${encodeURIComponent(bid.code)}`)
                  }
                  data-testid={`bid-item-${bid.code}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline" className="font-mono text-xs">
                      {bid.code}
                    </Badge>
                    <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 text-xs">
                      BID
                    </Badge>
                    {!hasBudget && (
                      <Badge
                        variant="outline"
                        className="text-yellow-600 border-yellow-600 text-xs"
                      >
                        No Budget
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm font-medium truncate">{bid.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {bid.clientName}
                    {bid.dueDate &&
                      ` \u2022 Due: ${format(new Date(bid.dueDate), "MMM d")}`}
                  </p>
                </div>
              );
            })}
            {hasMore && !showAll && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-xs text-muted-foreground"
                onClick={() => setShowAll(true)}
                data-testid="button-show-more-bids"
              >
                Show {bids.length - displayLimit} more
              </Button>
            )}
            {showAll && hasMore && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-xs text-muted-foreground"
                onClick={() => setShowAll(false)}
                data-testid="button-show-less-bids"
              >
                Show less
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
