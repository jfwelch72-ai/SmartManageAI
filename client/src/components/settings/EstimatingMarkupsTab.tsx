import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { DollarSign, Loader2, Percent } from "lucide-react";
import { format } from "date-fns";

const QUERY_KEY = ["/api/org/estimating-factors"] as const;

const FIELDS: {
  key: keyof EstimatingFactorsValues;
  label: string;
  description: string;
}[] = [
  { key: "laborBurdenPercent", label: "Labor Burden", description: "Payroll taxes, insurance, benefits added on top of base wages." },
  { key: "smallToolsPercent", label: "Small Tools & Consumables", description: "Allowance for small tools, blades, fasteners, PPE." },
  { key: "overheadPercent", label: "Overhead", description: "General company overhead allocated to each job." },
  { key: "profitPercent", label: "Profit", description: "Target profit margin applied after overhead." },
  { key: "bondPercent", label: "Bond", description: "Performance and payment bond cost." },
  { key: "escalationPercent", label: "Escalation", description: "Material/labor escalation reserve for projects with long durations." },
  { key: "wasteFactorPercent", label: "Default Waste Factor", description: "Org-wide default waste factor (per-category overrides still win when set)." },
];

export interface EstimatingFactorsValues {
  laborBurdenPercent: number;
  smallToolsPercent: number;
  overheadPercent: number;
  profitPercent: number;
  bondPercent: number;
  escalationPercent: number;
  wasteFactorPercent: number;
}

interface OrgFactorsResponse extends EstimatingFactorsValues {
  updatedAt?: string | null;
}

function toPercent(fraction: number | null | undefined): number {
  if (typeof fraction !== "number" || Number.isNaN(fraction)) return 0;
  return Math.round(fraction * 10000) / 100;
}

function toFraction(percent: number): number {
  if (Number.isNaN(percent)) return 0;
  return Math.max(0, Math.min(1, percent / 100));
}

export function EstimatingMarkupsTab() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<OrgFactorsResponse>({ queryKey: QUERY_KEY });

  const [values, setValues] = useState<Record<keyof EstimatingFactorsValues, string>>({
    laborBurdenPercent: "",
    smallToolsPercent: "",
    overheadPercent: "",
    profitPercent: "",
    bondPercent: "",
    escalationPercent: "",
    wasteFactorPercent: "",
  });
  const [errors, setErrors] = useState<Partial<Record<keyof EstimatingFactorsValues, string>>>({});

  useEffect(() => {
    if (data) {
      setValues({
        laborBurdenPercent: String(toPercent(data.laborBurdenPercent)),
        smallToolsPercent: String(toPercent(data.smallToolsPercent)),
        overheadPercent: String(toPercent(data.overheadPercent)),
        profitPercent: String(toPercent(data.profitPercent)),
        bondPercent: String(toPercent(data.bondPercent)),
        escalationPercent: String(toPercent(data.escalationPercent)),
        wasteFactorPercent: String(toPercent(data.wasteFactorPercent)),
      });
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async (payload: Partial<EstimatingFactorsValues>) => {
      const res = await apiRequest("PUT", "/api/org/estimating-factors", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast({
        title: "Estimating markups saved",
        description: "Your changes were recorded in the audit log.",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save", description: err.message, variant: "destructive" });
    },
  });

  function handleSave() {
    const nextErrors: Partial<Record<keyof EstimatingFactorsValues, string>> = {};
    const payload: Partial<EstimatingFactorsValues> = {};

    for (const f of FIELDS) {
      const raw = values[f.key];
      const num = Number(raw);
      if (raw === "" || Number.isNaN(num)) {
        nextErrors[f.key] = "Enter a number between 0 and 100";
        continue;
      }
      if (num < 0 || num > 100) {
        nextErrors[f.key] = "Must be between 0 and 100";
        continue;
      }
      payload[f.key] = toFraction(num);
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      toast({ title: "Fix validation errors before saving", variant: "destructive" });
      return;
    }
    saveMutation.mutate(payload);
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-64" />
        </CardHeader>
        <CardContent className="space-y-4">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="card-estimating-markups">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <DollarSign className="h-5 w-5" />
          Estimating Markups
        </CardTitle>
        <CardDescription>
          Default markups applied by the AI estimator and bid totals across your
          organization. Estimators can override these per estimate from the
          bid-estimate page. All values are percentages (0–100).
          {data?.updatedAt ? (
            <span className="block text-xs text-muted-foreground mt-1" data-testid="text-factors-updated-at">
              Last updated {format(new Date(data.updatedAt), "MMM d, yyyy h:mm a")}
            </span>
          ) : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {FIELDS.map((f) => (
            <div key={f.key} className="space-y-1">
              <Label htmlFor={`input-${f.key}`} className="text-sm font-medium">
                {f.label}
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id={`input-${f.key}`}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  step="0.01"
                  value={values[f.key]}
                  onChange={(e) =>
                    setValues((prev) => ({ ...prev, [f.key]: e.target.value }))
                  }
                  className="w-32"
                  data-testid={`input-${f.key}`}
                />
                <Percent className="h-4 w-4 text-muted-foreground" />
              </div>
              <p className="text-xs text-muted-foreground">{f.description}</p>
              {errors[f.key] && (
                <p className="text-xs text-destructive" data-testid={`error-${f.key}`}>
                  {errors[f.key]}
                </p>
              )}
            </div>
          ))}
        </div>

        <div className="flex justify-end pt-2">
          <Button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            data-testid="button-save-estimating-markups"
          >
            {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save Markups
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default EstimatingMarkupsTab;
