import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, ChevronRight, AlertCircle } from "lucide-react";
import { useLocation } from "wouter";
import { useBids } from "@/hooks/use-data";
import { format } from "date-fns";

export function ActiveBidsWidget() {
  const [, setLocation] = useLocation();
  const { data: bids = [], isLoading, isError } = useBids();

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
          <div className="flex flex-col items-center justify-center py-6 text-center" data-testid="active-bids-error">
            <AlertCircle className="w-6 h-6 text-destructive mb-2" />
            <p className="text-sm text-muted-foreground">Failed to load bids.</p>
          </div>
        ) : bids.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No active bids
          </p>
        ) : (
          <div className="space-y-3">
            {bids.slice(0, 4).map((bid) => {
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
          </div>
        )}
      </CardContent>
    </Card>
  );
}
