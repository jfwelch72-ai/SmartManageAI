import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { mapOnboardingTradeIdToLegacy, formatTradeCategoryLabel, getTradeDisplayName } from "@shared/tradeTypeUtils";
import type { Trade } from "@/hooks/use-library-data";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, Wrench, RefreshCw, Loader2 } from "lucide-react";
import type { TradeConfigResponse } from "./types";

export function CompanyTradeConfigTab() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [selectedTradeType, setSelectedTradeType] = useState<string>("");
  const [selectedTradeId, setSelectedTradeId] = useState<string>("");
  const [tradeName, setTradeName] = useState("");
  const [showRebuildConfirm, setShowRebuildConfirm] = useState(false);

  const { data: tradeConfig, isLoading: loadingTradeConfig } = useQuery<TradeConfigResponse>({
    queryKey: ["/api/organization/trade-config"],
    enabled: !!user && ["ADMIN", "HUSTLER"].includes(user.role)
  });

  const { data: allTradesData } = useQuery<{ categories: string[]; trades: Trade[] }>({
    queryKey: ["/api/onboarding-library/trades"],
    enabled: !!user && ["ADMIN", "HUSTLER"].includes(user.role),
    staleTime: 5 * 60 * 1000,
  });

  const groupedLibraryTrades = useMemo(() => {
    if (!allTradesData?.trades) return [];
    const groups: Record<string, Trade[]> = {};
    for (const trade of allTradesData.trades) {
      const cat = trade.trade_category;
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(trade);
    }
    return Object.entries(groups)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, trades]) => ({
        category,
        label: formatTradeCategoryLabel(category),
        trades: trades.sort((a, b) => a.trade_name.localeCompare(b.trade_name)),
      }));
  }, [allTradesData?.trades]);

  const updateTradeTypeMutation = useMutation({
    mutationFn: async (data: { tradeType: string; tradeName?: string }) => {
      return await apiRequest("POST", "/api/organization/update-trade-type", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/organization/trade-config"] });
      toast({ title: "Trade type updated successfully" });
      setSelectedTradeType("");
      setSelectedTradeId("");
      setTradeName("");
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update trade type", variant: "destructive" });
    }
  });

  const reinitializeSowMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/organization/reinitialize-sow", {});
    },
    onSuccess: async (response) => {
      const data = await response.json();
      queryClient.invalidateQueries({ queryKey: ["/api/organization/trade-config"] });
      queryClient.invalidateQueries({ queryKey: ["/api/scope/work-types"] });
      toast({ 
        title: "SOW Items Regenerated", 
        description: `Created ${data.newItemsCreated} items across ${data.categories?.length || 0} categories`
      });
      setShowRebuildConfirm(false);
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to regenerate SOW items", variant: "destructive" });
    }
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Trade Configuration</h2>
          <p className="text-sm text-muted-foreground">
            Manage your organization's trade type and scope of work templates
          </p>
        </div>
      </div>

      {loadingTradeConfig ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      ) : tradeConfig ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Wrench className="h-5 w-5" />
                Current Trade Type
              </CardTitle>
              <CardDescription>
                Your organization's trade specialization
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <Badge 
                  variant="secondary" 
                  className={`text-sm px-3 py-1 ${
                    tradeConfig.organization.tradeType === 'GENERAL_CONTRACTOR' 
                      ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                      : tradeConfig.organization.tradeType === 'OTHER'
                      ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                      : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
                  }`}
                  data-testid="badge-trade-type"
                >
                  {tradeConfig.organization.tradeName || getTradeDisplayName(tradeConfig.organization.tradeType as any)}
                </Badge>
                {tradeConfig.organization.tradeName && (
                  <span className="text-sm text-muted-foreground">
                    ({getTradeDisplayName(tradeConfig.organization.tradeType as any)})
                  </span>
                )}
              </div>
              <div className="text-sm text-muted-foreground">
                <span className="font-medium">{tradeConfig.sowItemCount}</span> active scope items
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Change Trade Type</CardTitle>
              <CardDescription>
                Update your organization's trade specialization
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="trade-type">New Trade Type</Label>
                {groupedLibraryTrades.length > 0 ? (
                  <Select
                    value={selectedTradeId ? `${selectedTradeId}::${tradeName}` : ""}
                    onValueChange={(compositeValue) => {
                      const [tradeId, tradeDisplayName] = compositeValue.split("::");
                      const legacyType = mapOnboardingTradeIdToLegacy(tradeId);
                      setSelectedTradeId(tradeId);
                      setSelectedTradeType(legacyType);
                      setTradeName(tradeDisplayName || "");
                    }}
                  >
                    <SelectTrigger data-testid="select-trade-type">
                      <SelectValue placeholder="Select a trade specialization">
                        {tradeName || (selectedTradeType ? getTradeDisplayName(selectedTradeType as any) : "Select a trade specialization")}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="max-h-80">
                      {groupedLibraryTrades.map((group) => (
                        <SelectGroup key={group.category}>
                          <SelectLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            {group.label}
                          </SelectLabel>
                          {group.trades.map((trade) => (
                            <SelectItem
                              key={trade.trade_id}
                              value={`${trade.trade_id}::${trade.trade_name}`}
                              data-testid={`select-trade-item-${trade.trade_id}`}
                            >
                              {trade.trade_name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Select
                    value={selectedTradeType || tradeConfig.organization.tradeType}
                    onValueChange={(value) => setSelectedTradeType(value)}
                  >
                    <SelectTrigger data-testid="select-trade-type">
                      <SelectValue placeholder="Select trade type" />
                    </SelectTrigger>
                    <SelectContent>
                      {tradeConfig.tradeTypes.map(t => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {selectedTradeType && tradeName && (
                <div className="text-sm text-muted-foreground">
                  Maps to legacy type: <Badge variant="outline" className="text-xs">{getTradeDisplayName(selectedTradeType as any)}</Badge>
                </div>
              )}

              <Button
                onClick={() => {
                  if (selectedTradeType && selectedTradeType !== tradeConfig.organization.tradeType) {
                    updateTradeTypeMutation.mutate({ 
                      tradeType: selectedTradeType,
                      tradeName: tradeName || undefined
                    });
                  } else if (selectedTradeType && tradeName !== tradeConfig.organization.tradeName) {
                    updateTradeTypeMutation.mutate({ 
                      tradeType: selectedTradeType,
                      tradeName: tradeName || undefined
                    });
                  }
                }}
                disabled={
                  updateTradeTypeMutation.isPending || 
                  !selectedTradeType ||
                  (selectedTradeType === tradeConfig.organization.tradeType && tradeName === (tradeConfig.organization.tradeName || ""))
                }
                data-testid="button-update-trade"
              >
                {updateTradeTypeMutation.isPending && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Update Trade Type
              </Button>
            </CardContent>
          </Card>

          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <RefreshCw className="h-5 w-5" />
                Rebuild SOW Templates
              </CardTitle>
              <CardDescription>
                Regenerate scope of work items from trade templates
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  This will regenerate SOW templates based on your current trade type. 
                  Custom items you've created will remain active.
                </AlertDescription>
              </Alert>
              
              {!showRebuildConfirm ? (
                <Button 
                  variant="outline" 
                  onClick={() => setShowRebuildConfirm(true)}
                  data-testid="button-rebuild-sow"
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Rebuild SOW Items from Trade Type
                </Button>
              ) : (
                <div className="flex items-center gap-3">
                  <Button
                    variant="destructive"
                    onClick={() => reinitializeSowMutation.mutate()}
                    disabled={reinitializeSowMutation.isPending}
                    data-testid="button-confirm-rebuild"
                  >
                    {reinitializeSowMutation.isPending && (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    )}
                    Confirm Rebuild
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setShowRebuildConfirm(false)}
                    data-testid="button-cancel-rebuild"
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <Alert>
          <AlertDescription>
            Unable to load trade configuration. Please try again.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
