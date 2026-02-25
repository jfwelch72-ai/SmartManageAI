import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, ChevronRight } from "lucide-react";
import { useLocation } from "wouter";
import { useBids } from "@/hooks/use-data";
import { format } from "date-fns";

export function ActiveBidsWidget() {
  const [, setLocation] = useLocation();
  const { data: bids = [], isLoading } = useBids();

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
          <p className="text-sm text-muted-foreground text-center py-4">
            Loading...
          </p>
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
