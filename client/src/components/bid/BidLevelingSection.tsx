import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart3, CheckCircle2, AlertTriangle, Trophy, ArrowUpDown } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface LevelingQuote {
  id: string;
  subcontractorName: string;
  scopeOfWork: string;
  quoteAmount: string;
  leadTime: string | null;
  inclusions: string | null;
  exclusions: string | null;
  notes: string | null;
  contactName: string | null;
  isSelected: boolean;
  isLowBid: boolean;
  isOutlier: boolean;
  variance: string;
}

interface ScopeGroup {
  scope: string;
  quotes: LevelingQuote[];
  summary: {
    count: number;
    lowBid: number;
    highBid: number;
    average: number;
    spread: number;
    selectedQuote: string | null;
  };
}

interface BidLevelingData {
  bidId: string;
  bidCode: string;
  leveling: ScopeGroup[];
}

function fmt(val: number) {
  return val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function BidLevelingSection({ bidCode, canEdit }: { bidCode: string; canEdit: boolean }) {
  const { toast } = useToast();
  const [selectedScope, setSelectedScope] = useState<string>("all");

  const { data, isLoading } = useQuery<BidLevelingData>({
    queryKey: ["/api/bids", bidCode, "bid-leveling"],
  });

  const selectQuoteMutation = useMutation({
    mutationFn: async ({ quoteId }: { quoteId: string }) => {
      await apiRequest("PATCH", `/api/bids/${bidCode}/quotes/${quoteId}/select`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bids", bidCode, "bid-leveling"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bids", bidCode, "quotes"] });
      toast({ title: "Quote selected successfully" });
    },
    onError: () => {
      toast({ title: "Failed to select quote", variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <Card data-testid="card-bid-leveling">
        <CardContent className="py-8 text-center text-muted-foreground">
          Loading bid leveling data...
        </CardContent>
      </Card>
    );
  }

  const leveling = data?.leveling || [];

  if (leveling.length === 0) {
    return (
      <Card data-testid="card-bid-leveling">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
            <BarChart3 className="w-5 h-5" />
            Bid Leveling
          </CardTitle>
          <CardDescription>Compare subcontractor quotes side-by-side</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <BarChart3 className="w-12 h-12 mx-auto mb-4 opacity-40" />
            <p className="font-medium mb-1">No quotes to compare yet</p>
            <p className="text-sm">Add subcontractor quotes in Step 5 to see bid leveling</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const scopes = leveling.map(g => g.scope);
  const filteredGroups = selectedScope === "all" ? leveling : leveling.filter(g => g.scope === selectedScope);

  return (
    <Card data-testid="card-bid-leveling">
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              <BarChart3 className="w-5 h-5" />
              Bid Leveling
            </CardTitle>
            <CardDescription>Compare subcontractor quotes side-by-side by scope</CardDescription>
          </div>
          {scopes.length > 1 && (
            <Select value={selectedScope} onValueChange={setSelectedScope}>
              <SelectTrigger className="w-[200px]" data-testid="select-leveling-scope">
                <SelectValue placeholder="Filter by scope" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Scopes ({leveling.length})</SelectItem>
                {scopes.map(s => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {filteredGroups.map((group) => (
          <div key={group.scope} className="border rounded-lg overflow-hidden" data-testid={`leveling-scope-${group.scope}`}>
            <div className="bg-muted/50 px-4 py-3 border-b">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h4 className="font-semibold text-sm">{group.scope}</h4>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {group.summary.count} quote{group.summary.count !== 1 ? "s" : ""} | 
                    Spread: ${fmt(group.summary.spread)} | 
                    Avg: ${fmt(group.summary.average)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-green-600 border-green-300 gap-1">
                    <Trophy className="w-3 h-3" />
                    Low: ${fmt(group.summary.lowBid)}
                  </Badge>
                  <Badge variant="outline" className="text-muted-foreground gap-1">
                    High: ${fmt(group.summary.highBid)}
                  </Badge>
                </div>
              </div>
            </div>

            <div className="hidden sm:block overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[150px]">Subcontractor</TableHead>
                    <TableHead className="text-right min-w-[100px]">
                      <span className="flex items-center justify-end gap-1">
                        Amount
                        <ArrowUpDown className="w-3 h-3" />
                      </span>
                    </TableHead>
                    <TableHead className="text-right">Variance</TableHead>
                    <TableHead className="min-w-[120px]">Lead Time</TableHead>
                    <TableHead className="min-w-[150px]">Inclusions</TableHead>
                    <TableHead className="min-w-[150px]">Exclusions</TableHead>
                    <TableHead className="min-w-[120px]">Notes</TableHead>
                    <TableHead className="w-[100px]">Status</TableHead>
                    {canEdit && <TableHead className="w-[80px]"></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.quotes.map((quote) => (
                    <TableRow
                      key={quote.id}
                      className={
                        quote.isSelected ? "bg-green-50 dark:bg-green-950/20" :
                        quote.isLowBid ? "bg-blue-50/50 dark:bg-blue-950/10" :
                        quote.isOutlier ? "bg-orange-50/50 dark:bg-orange-950/10" : ""
                      }
                      data-testid={`leveling-quote-${quote.id}`}
                    >
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {quote.subcontractorName}
                          {quote.isLowBid && (
                            <Badge variant="default" className="bg-green-600 text-xs gap-1">
                              <Trophy className="w-3 h-3" />
                              Low
                            </Badge>
                          )}
                          {quote.isOutlier && (
                            <Badge variant="outline" className="text-orange-600 border-orange-300 text-xs gap-1">
                              <AlertTriangle className="w-3 h-3" />
                              Outlier
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium">
                        ${fmt(Number(quote.quoteAmount))}
                      </TableCell>
                      <TableCell className={`text-right text-sm ${Number(quote.variance) > 0 ? "text-red-600" : Number(quote.variance) < 0 ? "text-green-600" : "text-muted-foreground"}`}>
                        {Number(quote.variance) > 0 ? "+" : ""}{quote.variance}%
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {quote.leadTime || "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                        {quote.inclusions || "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                        {quote.exclusions || "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[150px] truncate">
                        {quote.notes || "—"}
                      </TableCell>
                      <TableCell>
                        {quote.isSelected ? (
                          <Badge variant="default" className="bg-green-600 gap-1 text-xs">
                            <CheckCircle2 className="w-3 h-3" />
                            Selected
                          </Badge>
                        ) : null}
                      </TableCell>
                      {canEdit && (
                        <TableCell>
                          {!quote.isSelected && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => selectQuoteMutation.mutate({ quoteId: quote.id })}
                              disabled={selectQuoteMutation.isPending}
                              data-testid={`button-select-quote-${quote.id}`}
                            >
                              Select
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="sm:hidden divide-y">
              {group.quotes.map((quote) => (
                <div
                  key={quote.id}
                  className={`p-4 space-y-2 ${
                    quote.isSelected ? "bg-green-50 dark:bg-green-950/20" :
                    quote.isLowBid ? "bg-blue-50/50 dark:bg-blue-950/10" :
                    quote.isOutlier ? "bg-orange-50/50 dark:bg-orange-950/10" : ""
                  }`}
                  data-testid={`leveling-quote-mobile-${quote.id}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{quote.subcontractorName}</span>
                      {quote.isLowBid && <Badge variant="default" className="bg-green-600 text-xs">Low Bid</Badge>}
                      {quote.isOutlier && <Badge variant="outline" className="text-orange-600 text-xs">Outlier</Badge>}
                      {quote.isSelected && <Badge variant="default" className="bg-green-600 text-xs">Selected</Badge>}
                    </div>
                    <span className="font-mono font-bold">${fmt(Number(quote.quoteAmount))}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                    <span>Variance: {Number(quote.variance) > 0 ? "+" : ""}{quote.variance}%</span>
                    <span>Lead: {quote.leadTime || "—"}</span>
                  </div>
                  {canEdit && !quote.isSelected && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full mt-2"
                      onClick={() => selectQuoteMutation.mutate({ quoteId: quote.id })}
                      disabled={selectQuoteMutation.isPending}
                      data-testid={`button-select-quote-mobile-${quote.id}`}
                    >
                      Select This Quote
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
