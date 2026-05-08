import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, bidEstimateKey } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BookOpen, Loader2, Search, Users } from "lucide-react";

interface CostBookProvider {
  id: string;
  name: string;
  providerKind: string;
  defaultRegion: string | null;
  isActive: boolean;
}

interface CostBookEntry {
  id: string;
  sourceCode: string;
  description: string;
  unit: string;
  materialCost: string | number;
  laborCost: string | number;
  equipmentCost: string | number;
  totalCost: string | number;
  asOfDate: string;
}

interface GeoFactor {
  id: string;
  regionCode: string;
  regionName: string;
}

interface CrewTemplate {
  id: string;
  name: string;
  code: string | null;
  defaultHoursPerDay: string | number | null;
}

interface CrewTemplateDetail {
  template: CrewTemplate;
  workers: Array<{ count: number; hourlyRate: string; burdenPercent: string }>;
  equipment: Array<{ count: number; dailyRate: string; fuelCostPerDay: string }>;
  cost: {
    laborCostPerDay: number;
    equipmentCostPerDay: number;
    totalCostPerDay: number;
  };
}

interface ApplyResultProvenance {
  provider: string;
  sourceCode: string;
  asOfDate: string;
  regionCode: string | null;
  totalFactor: number;
}

function invalidateEstimateQueries(estimateId: string, bidId?: string) {
  if (bidId) {
    queryClient.invalidateQueries({ queryKey: bidEstimateKey(bidId) });
  }
  queryClient.invalidateQueries({ queryKey: ["/api/estimates", estimateId] });
  queryClient.invalidateQueries({
    predicate: (q) => {
      const k = q.queryKey;
      return Array.isArray(k) && typeof k[0] === "string" && k[0].includes(`/api/estimates/${estimateId}`);
    },
  });
}

export function CostBookPickerButton({
  estimateId,
  lineItemId,
  bidId,
  defaultQuantity,
  onApplied,
}: {
  estimateId: string;
  lineItemId: string;
  bidId?: string;
  defaultQuantity?: number;
  onApplied?: (result: { materialCost: number; laborCost: number; equipmentCost: number; provenance: ApplyResultProvenance }) => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [providerId, setProviderId] = useState<string>("");
  const [regionCode, setRegionCode] = useState<string>("");
  const [search, setSearch] = useState("");
  const [quantity, setQuantity] = useState<string>(
    defaultQuantity != null ? String(defaultQuantity) : "",
  );
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const providersQuery = useQuery<CostBookProvider[]>({
    queryKey: ["/api/cost-book/providers"],
    enabled: open,
  });

  useEffect(() => {
    if (!providerId && providersQuery.data && providersQuery.data.length > 0) {
      const active = providersQuery.data.find((p) => p.isActive) ?? providersQuery.data[0];
      setProviderId(active.id);
      if (active.defaultRegion) setRegionCode(active.defaultRegion);
    }
  }, [providersQuery.data, providerId]);

  const geoFactorsQuery = useQuery<GeoFactor[]>({
    queryKey: ["/api/cost-book/providers", providerId, "geo-factors"],
    enabled: open && !!providerId,
  });

  const entriesQuery = useQuery<CostBookEntry[]>({
    queryKey: ["/api/cost-book/providers", providerId, "entries", debouncedSearch],
    enabled: open && !!providerId,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set("q", debouncedSearch);
      params.set("limit", "50");
      const res = await fetch(
        `/api/cost-book/providers/${providerId}/entries?${params.toString()}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to load cost-book entries");
      return res.json();
    },
  });

  const applyMutation = useMutation({
    mutationFn: async (entry: CostBookEntry) => {
      const qtyNum = quantity === "" ? undefined : Number(quantity);
      const res = await apiRequest(
        "POST",
        `/api/estimates/${estimateId}/line-items/${lineItemId}/apply-cost-book-entry`,
        {
          providerId,
          sourceCode: entry.sourceCode,
          regionCode: regionCode || undefined,
          quantity: qtyNum,
        },
      );
      return (await res.json()) as {
        line: {
          materialCost: string;
          laborCost: string;
          equipmentCost: string;
        };
        provenance: ApplyResultProvenance;
      };
    },
    onSuccess: (data) => {
      invalidateEstimateQueries(estimateId, bidId);
      toast({
        title: "Cost-book entry applied",
        description: `${data.provenance.provider} · ${data.provenance.sourceCode}${data.provenance.regionCode ? ` · ${data.provenance.regionCode}` : ""}`,
      });
      onApplied?.({
        materialCost: Number(data.line.materialCost) || 0,
        laborCost: Number(data.line.laborCost) || 0,
        equipmentCost: Number(data.line.equipmentCost) || 0,
        provenance: data.provenance,
      });
      setOpen(false);
    },
    onError: (err: any) => {
      toast({
        title: "Failed to apply cost-book entry",
        description: err?.message ?? "Unexpected error",
        variant: "destructive",
      });
    },
  });

  const entries = entriesQuery.data ?? [];

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        data-testid="button-pick-from-cost-book"
      >
        <BookOpen className="h-3.5 w-3.5 mr-1.5" />
        Pick from cost book
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Pick from cost book</DialogTitle>
            <DialogDescription>
              Search a published cost-book and apply its unit prices to this line item. Source, code, as-of date, and geo factor are stored on the line.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cost-book-provider">Provider</Label>
              <Select value={providerId} onValueChange={setProviderId}>
                <SelectTrigger id="cost-book-provider" data-testid="select-cost-book-provider">
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                  {(providersQuery.data ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cost-book-region">Region</Label>
              <Select
                value={regionCode || "__none__"}
                onValueChange={(v) => setRegionCode(v === "__none__" ? "" : v)}
              >
                <SelectTrigger id="cost-book-region" data-testid="select-cost-book-region">
                  <SelectValue placeholder="No geo factor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No geo factor</SelectItem>
                  {(geoFactorsQuery.data ?? []).map((g) => (
                    <SelectItem key={g.id} value={g.regionCode}>
                      {g.regionName} ({g.regionCode})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cost-book-quantity">Quantity</Label>
              <Input
                id="cost-book-quantity"
                value={quantity}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "" || /^\d*\.?\d*$/.test(v)) setQuantity(v);
                }}
                placeholder="Use line qty"
                inputMode="decimal"
                data-testid="input-cost-book-quantity"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cost-book-search">Search</Label>
            <div className="relative">
              <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
              <Input
                id="cost-book-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by code or description"
                className="pl-8"
                data-testid="input-cost-book-search"
              />
            </div>
          </div>

          <div className="border rounded-md max-h-[40vh] overflow-y-auto">
            {entriesQuery.isLoading ? (
              <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading entries…
              </div>
            ) : entries.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No cost-book entries found.
              </div>
            ) : (
              <ul className="divide-y">
                {entries.map((entry) => {
                  const total = Number(entry.totalCost) || 0;
                  return (
                    <li
                      key={entry.id}
                      className="flex items-start justify-between gap-3 p-3 hover-elevate"
                      data-testid={`row-cost-book-entry-${entry.id}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="font-mono text-xs">
                            {entry.sourceCode}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            as-of {entry.asOfDate}
                          </span>
                        </div>
                        <p className="text-sm mt-1 truncate" title={entry.description}>
                          {entry.description}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          M ${Number(entry.materialCost).toFixed(2)} · L $
                          {Number(entry.laborCost).toFixed(2)} · E $
                          {Number(entry.equipmentCost).toFixed(2)} / {entry.unit}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-medium tabular-nums text-sm">
                          ${total.toFixed(2)}/{entry.unit}
                        </p>
                        <Button
                          type="button"
                          size="sm"
                          className="mt-1"
                          disabled={applyMutation.isPending}
                          onClick={() => applyMutation.mutate(entry)}
                          data-testid={`button-apply-cost-book-entry-${entry.id}`}
                        >
                          {applyMutation.isPending && applyMutation.variables?.id === entry.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            "Apply"
                          )}
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} data-testid="button-cost-book-close">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function CrewTemplatePickerButton({
  estimateId,
  lineItemId,
  bidId,
  onApplied,
}: {
  estimateId: string;
  lineItemId: string;
  bidId?: string;
  onApplied?: (result: { laborCost: number; equipmentCost: number; laborHours: number; templateId: string; crewDays: number }) => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState<string>("");
  const [crewDays, setCrewDays] = useState<string>("1");

  const templatesQuery = useQuery<CrewTemplate[]>({
    queryKey: ["/api/estimating-crew-templates"],
    enabled: open,
  });

  const detailQuery = useQuery<CrewTemplateDetail>({
    queryKey: ["/api/estimating-crew-templates", templateId],
    enabled: open && !!templateId,
  });

  const days = Number(crewDays) || 0;
  const dailyCost = detailQuery.data?.cost;
  const projected = useMemo(() => {
    if (!dailyCost || days <= 0) return null;
    return {
      labor: dailyCost.laborCostPerDay * days,
      equipment: dailyCost.equipmentCostPerDay * days,
      total: dailyCost.totalCostPerDay * days,
    };
  }, [dailyCost, days]);

  const applyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        `/api/estimates/${estimateId}/line-items/${lineItemId}/apply-crew`,
        { crewTemplateId: templateId, crewDays: days },
      );
      return (await res.json()) as {
        line: { laborCost: string; equipmentCost: string; laborHours: string };
        crew: { templateId: string; templateName: string; crewDays: number };
      };
    },
    onSuccess: (data) => {
      invalidateEstimateQueries(estimateId, bidId);
      toast({
        title: "Crew template applied",
        description: `${data.crew.templateName} × ${data.crew.crewDays} day${data.crew.crewDays === 1 ? "" : "s"}`,
      });
      onApplied?.({
        laborCost: Number(data.line.laborCost) || 0,
        equipmentCost: Number(data.line.equipmentCost) || 0,
        laborHours: Number(data.line.laborHours) || 0,
        templateId: data.crew.templateId,
        crewDays: data.crew.crewDays,
      });
      setOpen(false);
    },
    onError: (err: any) => {
      toast({
        title: "Failed to apply crew template",
        description: err?.message ?? "Unexpected error",
        variant: "destructive",
      });
    },
  });

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        data-testid="button-use-crew"
      >
        <Users className="h-3.5 w-3.5 mr-1.5" />
        Use crew
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Use a crew template</DialogTitle>
            <DialogDescription>
              Set labor &amp; equipment cost from a crew template multiplied by the number of crew-days.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="crew-template">Crew template</Label>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger id="crew-template" data-testid="select-crew-template">
                  <SelectValue placeholder="Select a crew template" />
                </SelectTrigger>
                <SelectContent>
                  {(templatesQuery.data ?? []).map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.code ? `${t.code} — ${t.name}` : t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {templatesQuery.data && templatesQuery.data.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No crew templates yet. Create one under Estimating → Crews.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="crew-days">Crew days</Label>
              <Input
                id="crew-days"
                value={crewDays}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "" || /^\d*\.?\d*$/.test(v)) setCrewDays(v);
                }}
                placeholder="1.0"
                inputMode="decimal"
                data-testid="input-crew-days"
              />
            </div>

            {detailQuery.isLoading && templateId && (
              <div className="flex items-center text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> Computing crew cost…
              </div>
            )}

            {dailyCost && (
              <div className="rounded-md border p-3 text-sm space-y-1 bg-muted/30" data-testid="text-crew-projection">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Labor / day</span>
                  <span>${dailyCost.laborCostPerDay.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Equipment / day</span>
                  <span>${dailyCost.equipmentCostPerDay.toFixed(2)}</span>
                </div>
                {projected && (
                  <>
                    <div className="border-t my-1" />
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Labor × {days}d</span>
                      <span className="font-medium">${projected.labor.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Equipment × {days}d</span>
                      <span className="font-medium">${projected.equipment.toFixed(2)}</span>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} data-testid="button-crew-cancel">
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!templateId || days <= 0 || applyMutation.isPending}
              onClick={() => applyMutation.mutate()}
              data-testid="button-crew-apply"
            >
              {applyMutation.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Applying…
                </>
              ) : (
                "Apply"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
