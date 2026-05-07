import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Percent, SlidersHorizontal, Trash2 } from "lucide-react";

const FACTOR_KEYS = [
  "laborBurdenPercent",
  "smallToolsPercent",
  "overheadPercent",
  "profitPercent",
  "bondPercent",
  "escalationPercent",
  "wasteFactorPercent",
] as const;
type FactorKey = (typeof FACTOR_KEYS)[number];

const FACTOR_LABELS: Record<FactorKey, string> = {
  laborBurdenPercent: "Labor Burden",
  smallToolsPercent: "Small Tools",
  overheadPercent: "Overhead",
  profitPercent: "Profit",
  bondPercent: "Bond",
  escalationPercent: "Escalation",
  wasteFactorPercent: "Waste Factor",
};

type OrgFactors = Partial<Record<FactorKey, number>>;

interface OverrideResponse {
  override: Partial<Record<FactorKey, number>> | null;
  orgDefaults: OrgFactors;
}

interface Props {
  estimateId: string;
}

function toPercent(fraction: number | undefined | null): string {
  if (typeof fraction !== "number" || Number.isNaN(fraction)) return "";
  return String(Math.round(fraction * 10000) / 100);
}

function toFraction(percent: string): number {
  const n = Number(percent);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n / 100));
}

// Two factors are "the same" if they round to the same percent at
// 2 decimals. The override drawer only lets users enter values at
// that resolution, so anything tighter would be noise.
function nearlyEqualPct(a: number | undefined, b: number | undefined): boolean {
  const aNum = typeof a === "number" && !Number.isNaN(a) ? a : 0;
  const bNum = typeof b === "number" && !Number.isNaN(b) ? b : 0;
  return Math.abs(aNum - bNum) < 0.0001;
}

const blankValues = (): Record<FactorKey, string> =>
  FACTOR_KEYS.reduce(
    (acc, k) => ({ ...acc, [k]: "" }),
    {} as Record<FactorKey, string>,
  );

export function EstimateFactorsOverrideDrawer({ estimateId }: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<FactorKey, string>>(blankValues);
  const [errors, setErrors] = useState<Partial<Record<FactorKey, string>>>({});

  // Fetched eagerly (not gated on `open`) so the trigger area can
  // render the per-factor breakdown chips when an override is
  // active, and so we know which factors to label as "Overridden"
  // before the user even opens the drawer.
  const { data: overrideData, isLoading: loadingOverride } =
    useQuery<OverrideResponse>({
      queryKey: ["/api/estimates", estimateId, "factors-override"],
    });

  const orgDefaults = overrideData?.orgDefaults;
  const serverOverride = overrideData?.override ?? null;
  const hasOverride = serverOverride !== null;

  // Seed the form whenever the drawer opens (or the server-side
  // override changes while it is open) so the inputs reflect the
  // currently-stored override values rather than starting blank.
  useEffect(() => {
    if (!open) return;
    if (!overrideData) return;
    if (serverOverride) {
      setValues(
        FACTOR_KEYS.reduce(
          (acc, k) => ({ ...acc, [k]: toPercent(serverOverride[k]) }),
          {} as Record<FactorKey, string>,
        ),
      );
    } else {
      setValues(blankValues());
    }
    setErrors({});
    // We intentionally key off the override JSON so that a refetch
    // after a save reseeds the inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, JSON.stringify(serverOverride)]);

  // Per-input "Overridden vs Inherited" reflects what the user is
  // about to save: blank or matching the org default → inherited;
  // any other numeric value → overridden.
  function inputState(k: FactorKey): "overridden" | "inherited" {
    const raw = values[k];
    if (raw === "") return "inherited";
    const n = Number(raw);
    if (Number.isNaN(n)) return "inherited";
    const orgPct = (orgDefaults?.[k] ?? 0) * 100;
    return nearlyEqualPct(n, orgPct) ? "inherited" : "overridden";
  }

  // Server-truth view used by the chips beside the trigger button.
  const overriddenFactors: Array<{ key: FactorKey; pct: number }> = hasOverride
    ? FACTOR_KEYS.flatMap((k) => {
        const val = serverOverride?.[k];
        if (typeof val !== "number") return [];
        if (nearlyEqualPct(val, orgDefaults?.[k])) return [];
        return [{ key: k, pct: Math.round(val * 10000) / 100 }];
      })
    : [];

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<FactorKey, number> = {} as Record<FactorKey, number>;
      const nextErrors: Partial<Record<FactorKey, string>> = {};
      let anyExplicit = false;
      for (const k of FACTOR_KEYS) {
        const raw = values[k];
        if (raw === "") {
          // Blank input → inherit the org default. The backend
          // normalizes missing keys to 0, so we must send the
          // inherited value explicitly to avoid silently zeroing
          // factors the user didn't intend to override.
          payload[k] = typeof orgDefaults?.[k] === "number" ? (orgDefaults[k] as number) : 0;
          continue;
        }
        const n = Number(raw);
        if (Number.isNaN(n) || n < 0 || n > 100) {
          nextErrors[k] = "0–100";
          continue;
        }
        payload[k] = toFraction(raw);
        const orgPct = (orgDefaults?.[k] ?? 0) * 100;
        if (!nearlyEqualPct(n, orgPct)) anyExplicit = true;
      }
      setErrors(nextErrors);
      if (Object.keys(nextErrors).length > 0) {
        throw new Error("Fix validation errors before saving.");
      }
      if (!anyExplicit && !hasOverride) {
        throw new Error("Enter at least one factor to override.");
      }
      const res = await apiRequest("POST", `/api/estimates/${estimateId}/factors-override`, payload);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Override saved", description: "This estimate now uses custom markups." });
      queryClient.invalidateQueries({ queryKey: ["/api/estimates", estimateId, "totals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/estimates", estimateId, "factors-override"] });
      setOpen(false);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save override", description: err.message, variant: "destructive" });
    },
  });

  const clearMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/estimates/${estimateId}/factors-override`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Override cleared", description: "This estimate now uses the org defaults." });
      queryClient.invalidateQueries({ queryKey: ["/api/estimates", estimateId, "totals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/estimates", estimateId, "factors-override"] });
      setValues(blankValues());
      setOpen(false);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to clear override", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="flex items-center gap-2 flex-wrap" data-testid="container-factors-override">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="outline" size="sm" data-testid="button-open-factors-override">
            <SlidersHorizontal className="h-4 w-4 mr-2" />
            Adjust Markups
            {hasOverride && (
              <Badge variant="secondary" className="ml-2" data-testid="badge-override-active">
                Override
              </Badge>
            )}
          </Button>
        </SheetTrigger>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto" data-testid="drawer-factors-override">
          <SheetHeader>
            <SheetTitle>Per-Estimate Markup Override</SheetTitle>
            <SheetDescription>
              Override the org-wide estimating markups for this estimate only.
              Inputs are pre-filled with the current override (or left blank to
              show the org default as a placeholder). Each field shows whether
              its value is overridden or inherited from the org default.
              Changes are audit-logged.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-4 py-4">
            {loadingOverride ? (
              <Skeleton className="h-48 w-full" />
            ) : (
              FACTOR_KEYS.map((k) => {
                const state = inputState(k);
                return (
                  <div key={k} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <Label htmlFor={`override-${k}`} className="text-sm font-medium">
                        {FACTOR_LABELS[k]}
                      </Label>
                      <Badge
                        variant={state === "overridden" ? "default" : "outline"}
                        className="text-[10px] uppercase tracking-wide"
                        data-testid={`badge-factor-state-${k}`}
                      >
                        {state === "overridden" ? "Overridden" : "Inherited"}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        id={`override-${k}`}
                        type="number"
                        inputMode="decimal"
                        min={0}
                        max={100}
                        step="0.01"
                        placeholder={`Org: ${toPercent(orgDefaults?.[k]) || "0"}%`}
                        value={values[k]}
                        onChange={(e) => setValues((prev) => ({ ...prev, [k]: e.target.value }))}
                        className="w-32"
                        data-testid={`input-override-${k}`}
                      />
                      <Percent className="h-4 w-4 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground" data-testid={`text-org-default-${k}`}>
                        Org default: {toPercent(orgDefaults?.[k]) || "0"}%
                      </span>
                      {errors[k] && (
                        <span className="text-xs text-destructive" data-testid={`error-override-${k}`}>
                          {errors[k]}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <SheetFooter className="flex flex-col sm:flex-row gap-2">
            {hasOverride && (
              <Button
                variant="outline"
                onClick={() => clearMutation.mutate()}
                disabled={clearMutation.isPending}
                data-testid="button-clear-factors-override"
              >
                {clearMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-2" />
                )}
                Clear Override
              </Button>
            )}
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              data-testid="button-save-factors-override"
            >
              {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Override
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {hasOverride && overriddenFactors.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-1"
          data-testid="override-breakdown-chips"
        >
          {overriddenFactors.map(({ key, pct }) => (
            <Badge
              key={key}
              variant="outline"
              className="text-[10px] font-normal"
              data-testid={`chip-override-${key}`}
            >
              {FACTOR_LABELS[key]}: {pct}%
            </Badge>
          ))}
        </div>
      )}
      {hasOverride && overriddenFactors.length === 0 && (
        <span
          className="text-xs text-muted-foreground"
          data-testid="text-override-matches-defaults"
        >
          Override pinned, all values match org defaults
        </span>
      )}
    </div>
  );
}

export default EstimateFactorsOverrideDrawer;
