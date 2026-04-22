import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ToggleRight, HardHat, ArrowRight } from "lucide-react";
import {
  FEATURE_FLAG_LABELS,
  FEATURE_FLAG_DESCRIPTIONS,
  FEATURE_FLAG_CATEGORIES,
  FEATURE_FLAG_CATEGORY_MAP,
  isHeavyCivilTrade,
  type FeatureFlagKey,
} from "@shared/schema/features";
import { getFeaturePresetForTrade } from "@shared/tradeFeaturePresets";
import type { TradeConfigResponse } from "./types";

interface FlagsResponse {
  flags: Partial<Record<FeatureFlagKey, boolean>>;
  keys: FeatureFlagKey[];
}

interface FlagDiff {
  key: FeatureFlagKey;
  label: string;
  before: boolean;
  after: boolean;
}

export function OrgFeaturePresetsTab() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [selectedTradeType, setSelectedTradeType] = useState<string>("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingTradeType, setPendingTradeType] = useState<string | null>(null);

  const { data: tradeConfig, isLoading: tradeConfigLoading } = useQuery<TradeConfigResponse>({
    queryKey: ["/api/organization/trade-config"],
    enabled: !!user && user.role === "ADMIN",
  });

  const { data: flagsData, isLoading: flagsLoading } = useQuery<FlagsResponse>({
    queryKey: ["/api/feature-flags"],
    enabled: !!user && user.role === "ADMIN",
  });

  const orgTradeType = tradeConfig?.organization.tradeType ?? "";
  const orgId = tradeConfig?.organization.id ?? "";

  const tradeTypeOptions = tradeConfig?.tradeTypes ?? [];
  const tradeLabelMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const t of tradeTypeOptions) map[t.value] = t.label;
    return map;
  }, [tradeTypeOptions]);

  const applyPresetMutation = useMutation({
    mutationFn: async (tradeType: string) => {
      const res = await apiRequest("POST", `/api/feature-flags/${orgId}/apply-preset`, { tradeType });
      return res.json();
    },
    onSuccess: (_data, tradeType) => {
      queryClient.invalidateQueries({ queryKey: ["/api/feature-flags"] });
      const label = tradeLabelMap[tradeType] || tradeType;
      toast({
        title: "Preset applied",
        description: `Feature flags now match the ${label} preset.`,
      });
      setConfirmOpen(false);
      setPendingTradeType(null);
      setSelectedTradeType("");
    },
    onError: (err: Error) => {
      toast({ title: "Failed to apply preset", description: err.message, variant: "destructive" });
    },
  });

  const computeDiff = (tradeType: string): FlagDiff[] => {
    if (!tradeType || !flagsData) return [];
    const preset = getFeaturePresetForTrade(tradeType);
    const diff: FlagDiff[] = [];
    for (const key of flagsData.keys) {
      const before = flagsData.flags[key] ?? false;
      const after = preset[key] ?? false;
      if (before !== after) {
        diff.push({ key, label: FEATURE_FLAG_LABELS[key] ?? key, before, after });
      }
    }
    return diff;
  };

  const openConfirm = (tradeType: string) => {
    setPendingTradeType(tradeType);
    setConfirmOpen(true);
  };

  const pendingDiff = pendingTradeType ? computeDiff(pendingTradeType) : [];
  const enableCount = pendingDiff.filter((d) => d.after).length;
  const disableCount = pendingDiff.filter((d) => !d.after).length;

  if (!user || user.role !== "ADMIN") {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground">Only organization admins can manage feature presets</p>
      </div>
    );
  }

  if (tradeConfigLoading || flagsLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!tradeConfig || !flagsData) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground">Failed to load feature flag configuration</p>
      </div>
    );
  }

  const showHeavyCivilBanner = isHeavyCivilTrade(orgTradeType);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <ToggleRight className="h-5 w-5" />
          Feature Flags & Trade Presets
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Apply a preset to turn on the recommended bundle of features for your trade. Your current
          trade is{" "}
          <span className="font-medium text-foreground">
            {tradeLabelMap[orgTradeType] || orgTradeType || "not set"}
          </span>
          .
        </p>
      </div>

      {showHeavyCivilBanner && (
        <Card data-testid="heavy-civil-preset-banner" className="border-primary/40 bg-primary/5">
          <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-start gap-3">
              <HardHat className="h-6 w-6 text-primary shrink-0 mt-0.5" />
              <div>
                <div className="font-medium">This looks like a Heavy Civil / DOT contractor</div>
                <div className="text-sm text-muted-foreground">
                  Apply the Heavy Civil preset to enable DOT pay items, DBE tracking, WH-347 payroll,
                  haul tickets, IDR, SWPPP, surety bonds, Buy America, and mass-haul analyzer in one click.
                </div>
              </div>
            </div>
            <Button
              onClick={() => openConfirm(orgTradeType)}
              disabled={applyPresetMutation.isPending}
              data-testid="button-apply-heavy-civil-preset"
            >
              {applyPresetMutation.isPending && pendingTradeType === orgTradeType
                ? "Applying..."
                : "Apply Heavy Civil Preset"}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Apply a Trade Preset</CardTitle>
          <CardDescription>
            Pick any trade preset to apply its recommended set of feature flags. You'll see exactly
            which flags will change before confirming.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
            <div className="flex-1">
              <label className="text-sm font-medium mb-1 block" htmlFor="trade-preset-select">
                Trade preset
              </label>
              <Select value={selectedTradeType} onValueChange={setSelectedTradeType}>
                <SelectTrigger id="trade-preset-select" data-testid="select-trade-preset">
                  <SelectValue placeholder="Choose a trade preset to apply" />
                </SelectTrigger>
                <SelectContent>
                  {tradeTypeOptions.map((opt) => (
                    <SelectItem
                      key={opt.value}
                      value={opt.value}
                      data-testid={`select-item-trade-preset-${opt.value}`}
                    >
                      {opt.label}
                      {opt.value === orgTradeType ? " (current trade)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={() => selectedTradeType && openConfirm(selectedTradeType)}
              disabled={!selectedTradeType || applyPresetMutation.isPending}
              data-testid="button-apply-trade-preset"
            >
              Apply Preset
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Current Feature Flags</CardTitle>
          <CardDescription>
            These flags are currently active for your organization. Toggling individual flags is
            limited to platform admins; use a preset above to change the bundle.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {FEATURE_FLAG_CATEGORIES.map((category) => {
              const keysInCategory = flagsData.keys.filter(
                (k) => FEATURE_FLAG_CATEGORY_MAP[k] === category,
              );
              if (keysInCategory.length === 0) return null;
              return (
                <div
                  key={category}
                  data-testid={`feature-flag-category-${category.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`}
                >
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                    {category}
                  </h3>
                  <div className="space-y-2">
                    {keysInCategory.map((key) => {
                      const enabled = flagsData.flags[key] ?? false;
                      const label = FEATURE_FLAG_LABELS[key] ?? key;
                      const description = FEATURE_FLAG_DESCRIPTIONS[key];
                      return (
                        <div
                          key={key}
                          className="flex items-start justify-between gap-4 p-3 rounded-lg border"
                          data-testid={`feature-flag-row-${key}`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="font-medium" data-testid={`feature-flag-label-${key}`}>
                              {label}
                            </div>
                            {description && (
                              <div
                                className="text-sm text-muted-foreground mt-0.5"
                                data-testid={`feature-flag-description-${key}`}
                              >
                                {description}
                              </div>
                            )}
                          </div>
                          <Badge
                            variant={enabled ? "default" : "outline"}
                            data-testid={`feature-flag-status-${key}`}
                          >
                            {enabled ? "On" : "Off"}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={(open) => {
        setConfirmOpen(open);
        if (!open) setPendingTradeType(null);
      }}>
        <AlertDialogContent className="max-w-lg" data-testid="dialog-confirm-apply-preset">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Apply {pendingTradeType ? tradeLabelMap[pendingTradeType] || pendingTradeType : ""} preset?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDiff.length === 0
                ? "All feature flags already match this preset. Re-applying will leave every flag unchanged."
                : `${enableCount} flag${enableCount === 1 ? "" : "s"} will be turned on and ${disableCount} flag${disableCount === 1 ? "" : "s"} will be turned off.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingDiff.length > 0 && (
            <div
              className="max-h-72 overflow-y-auto border rounded-md divide-y"
              data-testid="list-preset-diff"
            >
              {pendingDiff.map((d) => (
                <div
                  key={d.key}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                  data-testid={`diff-row-${d.key}`}
                >
                  <span className="font-medium truncate">{d.label}</span>
                  <span className="flex items-center gap-2 shrink-0">
                    <Badge variant={d.before ? "default" : "outline"}>{d.before ? "On" : "Off"}</Badge>
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    <Badge variant={d.after ? "default" : "outline"}>{d.after ? "On" : "Off"}</Badge>
                  </span>
                </div>
              ))}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-apply-preset">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (pendingTradeType) applyPresetMutation.mutate(pendingTradeType);
              }}
              disabled={applyPresetMutation.isPending}
              data-testid="button-confirm-apply-preset"
            >
              {applyPresetMutation.isPending ? "Applying..." : "Apply Preset"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
