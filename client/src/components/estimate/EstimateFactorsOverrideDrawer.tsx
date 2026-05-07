import { useState } from "react";
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

interface OrgFactors {
  laborBurdenPercent?: number;
  smallToolsPercent?: number;
  overheadPercent?: number;
  profitPercent?: number;
  bondPercent?: number;
  escalationPercent?: number;
  wasteFactorPercent?: number;
}

interface TotalsResponse {
  totals: {
    materialCost: number;
    laborCost: number;
    equipmentCost: number;
    consumablesCost: number;
    subcontractCost: number;
    overhead: number;
    profit: number;
    bond: number;
    escalation: number;
    grandTotal: number;
  };
  source: "estimate_override" | "org_default";
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

export function EstimateFactorsOverrideDrawer({ estimateId }: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<FactorKey, string>>(() =>
    FACTOR_KEYS.reduce(
      (acc, k) => ({ ...acc, [k]: "" }),
      {} as Record<FactorKey, string>,
    ),
  );
  const [errors, setErrors] = useState<Partial<Record<FactorKey, string>>>({});

  const { data: orgFactors, isLoading: loadingOrg } = useQuery<OrgFactors & { updatedAt?: string }>({
    queryKey: ["/api/org/estimating-factors"],
    enabled: open,
  });

  const { data: totals } = useQuery<TotalsResponse>({
    queryKey: ["/api/estimates", estimateId, "totals"],
    enabled: open,
  });

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
          payload[k] = typeof orgFactors?.[k] === "number" ? (orgFactors[k] as number) : 0;
          continue;
        }
        const n = Number(raw);
        if (Number.isNaN(n) || n < 0 || n > 100) {
          nextErrors[k] = "0–100";
          continue;
        }
        payload[k] = toFraction(raw);
        anyExplicit = true;
      }
      setErrors(nextErrors);
      if (Object.keys(nextErrors).length > 0) {
        throw new Error("Fix validation errors before saving.");
      }
      if (!anyExplicit) {
        throw new Error("Enter at least one factor to override.");
      }
      const res = await apiRequest("POST", `/api/estimates/${estimateId}/factors-override`, payload);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Override saved", description: "This estimate now uses custom markups." });
      queryClient.invalidateQueries({ queryKey: ["/api/estimates", estimateId, "totals"] });
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
      setValues(FACTOR_KEYS.reduce((acc, k) => ({ ...acc, [k]: "" }), {} as Record<FactorKey, string>));
      setOpen(false);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to clear override", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" data-testid="button-open-factors-override">
          <SlidersHorizontal className="h-4 w-4 mr-2" />
          Adjust Markups
          {totals?.source === "estimate_override" && (
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
            Leave a field blank to keep the current org default for that
            factor (the inherited value is sent on save). Changes are
            audit-logged.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 py-4">
          {loadingOrg ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            FACTOR_KEYS.map((k) => (
              <div key={k} className="space-y-1">
                <Label htmlFor={`override-${k}`} className="text-sm font-medium">
                  {FACTOR_LABELS[k]}
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id={`override-${k}`}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={100}
                    step="0.01"
                    placeholder={`Org: ${toPercent(orgFactors?.[k]) || "0"}%`}
                    value={values[k]}
                    onChange={(e) => setValues((prev) => ({ ...prev, [k]: e.target.value }))}
                    className="w-32"
                    data-testid={`input-override-${k}`}
                  />
                  <Percent className="h-4 w-4 text-muted-foreground" />
                  {errors[k] && (
                    <span className="text-xs text-destructive" data-testid={`error-override-${k}`}>
                      {errors[k]}
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        <SheetFooter className="flex flex-col sm:flex-row gap-2">
          {totals?.source === "estimate_override" && (
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
  );
}

export default EstimateFactorsOverrideDrawer;
