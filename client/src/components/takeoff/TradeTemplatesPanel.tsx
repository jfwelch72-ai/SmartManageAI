import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Wrench, Plus } from "lucide-react";

interface TemplateOption {
  key: string;
  label: string;
  type: "number" | "select" | "boolean";
  default: number | string | boolean;
  choices?: string[];
  min?: number;
  max?: number;
}

interface TemplateSummary {
  id: string;
  label: string;
  trade: string;
  description: string;
  drivingMeasurementType: "AREA" | "LINEAR" | "COUNT";
  drivingUnit: string;
  options: TemplateOption[];
}

interface LineItem {
  code: string;
  label: string;
  category: "PRIMARY" | "ACCESSORY";
  isAccessory: boolean;
  quantity: number;
  unit: string;
  notes?: string;
}

interface ApplyResult {
  templateId: string;
  templateLabel: string;
  drivingQuantity: number;
  drivingUnit: string;
  lineItems: LineItem[];
}

interface ApplyToBidResult {
  result: ApplyResult;
  sheetId: string;
  insertedMeasurementIds: string[];
}

export function TradeTemplatesPanel({ bidId }: { bidId?: string }) {
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<string>("");
  const [quantity, setQuantity] = useState<string>("100");
  const [options, setOptions] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<ApplyResult | null>(null);

  const templatesQ = useQuery<{ templates: TemplateSummary[] }>({
    queryKey: ["/api/ai-estimator/trade-templates"],
  });
  const templates = templatesQ.data?.templates ?? [];
  const current = templates.find((t) => t.id === selectedId);

  const previewMut = useMutation<ApplyResult, Error, void>({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        `/api/ai-estimator/trade-templates/${selectedId}/apply`,
        { quantity: Number(quantity) || 0, options: coerceOptions(current, options) },
      );
      return (await res.json()) as ApplyResult;
    },
    onSuccess: (data) => setPreview(data),
    onError: (err) =>
      toast({ title: "Preview failed", description: err.message, variant: "destructive" }),
  });

  const applyMut = useMutation<ApplyToBidResult, Error, void>({
    mutationFn: async () => {
      if (!bidId) throw new Error("No bid selected");
      const res = await apiRequest(
        "POST",
        `/api/ai-estimator/trade-templates/${selectedId}/apply-to-bid`,
        {
          bidId,
          quantity: Number(quantity) || 0,
          options: coerceOptions(current, options),
        },
      );
      return (await res.json()) as ApplyToBidResult;
    },
    onSuccess: (data) => {
      toast({
        title: "Template applied",
        description: `${data.insertedMeasurementIds.length} line items added as DRAFT measurements.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/takeoff/measurements"] });
      queryClient.invalidateQueries({ queryKey: ["/api/takeoff/measurements", bidId] });
    },
    onError: (err) =>
      toast({ title: "Apply failed", description: err.message, variant: "destructive" }),
  });

  return (
    <Card className="p-3 space-y-3" data-testid="card-trade-templates">
      <div className="flex items-center gap-2">
        <Wrench className="w-4 h-4 text-muted-foreground" />
        <h4 className="text-sm font-semibold">Trade Material Templates</h4>
      </div>
      <p className="text-xs text-muted-foreground">
        Apply a packaged trade recipe (primary materials + accessories) to this bid.
      </p>

      <div className="space-y-2">
        <Label className="text-xs">Template</Label>
        <Select value={selectedId} onValueChange={setSelectedId}>
          <SelectTrigger data-testid="select-trade-template">
            <SelectValue placeholder="Select a template..." />
          </SelectTrigger>
          <SelectContent>
            {templates.map((t) => (
              <SelectItem key={t.id} value={t.id} data-testid={`option-trade-template-${t.id}`}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {current && (
          <p className="text-[11px] text-muted-foreground">{current.description}</p>
        )}
      </div>

      {current && (
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2">
            <Label className="text-xs">
              Driving quantity ({current.drivingUnit})
            </Label>
            <Input
              type="number"
              min={0}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              data-testid="input-template-quantity"
            />
          </div>
          {current.options.map((o) => (
            <div key={o.key} className="col-span-1">
              <Label className="text-xs">{o.label}</Label>
              {o.type === "select" && o.choices ? (
                <Select
                  value={String(options[o.key] ?? o.default)}
                  onValueChange={(v) => setOptions((s) => ({ ...s, [o.key]: v }))}
                >
                  <SelectTrigger data-testid={`select-template-option-${o.key}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {o.choices.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : o.type === "boolean" ? (
                <Select
                  value={String(options[o.key] ?? o.default)}
                  onValueChange={(v) => setOptions((s) => ({ ...s, [o.key]: v }))}
                >
                  <SelectTrigger data-testid={`select-template-option-${o.key}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">Yes</SelectItem>
                    <SelectItem value="false">No</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  type="number"
                  value={String(options[o.key] ?? o.default)}
                  onChange={(e) => setOptions((s) => ({ ...s, [o.key]: e.target.value }))}
                  data-testid={`input-template-option-${o.key}`}
                />
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!selectedId || previewMut.isPending}
          onClick={() => previewMut.mutate()}
          data-testid="button-preview-template"
        >
          {previewMut.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
          Preview
        </Button>
        <Button
          size="sm"
          disabled={!selectedId || !bidId || applyMut.isPending}
          onClick={() => applyMut.mutate()}
          data-testid="button-apply-template"
        >
          {applyMut.isPending ? (
            <Loader2 className="w-3 h-3 animate-spin mr-1" />
          ) : (
            <Plus className="w-3 h-3 mr-1" />
          )}
          Add to takeoff
        </Button>
      </div>

      {preview && (
        <div className="space-y-1 border-t pt-2" data-testid="list-template-preview">
          <div className="text-xs font-medium">
            {preview.templateLabel} — {preview.drivingQuantity} {preview.drivingUnit}
          </div>
          {preview.lineItems.map((li) => (
            <div
              key={li.code}
              className="flex items-center justify-between text-[11px]"
              data-testid={`row-template-line-${li.code}`}
            >
              <div className="flex items-center gap-1 truncate">
                <Badge
                  variant={li.category === "PRIMARY" ? "default" : "secondary"}
                  className="text-[10px] px-1 py-0"
                >
                  {li.category === "PRIMARY" ? "P" : "A"}
                </Badge>
                <span className="truncate">{li.label}</span>
              </div>
              <span className="tabular-nums">
                {li.quantity} {li.unit}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function coerceOptions(
  tpl: TemplateSummary | undefined,
  raw: Record<string, string>,
): Record<string, number | string | boolean> {
  if (!tpl) return {};
  const out: Record<string, number | string | boolean> = {};
  for (const o of tpl.options) {
    const v = raw[o.key];
    if (v === undefined || v === "") continue;
    if (o.type === "number") {
      const n = Number(v);
      if (Number.isFinite(n)) out[o.key] = n;
    } else if (o.type === "boolean") {
      out[o.key] = v === "true";
    } else {
      out[o.key] = v;
    }
  }
  return out;
}
