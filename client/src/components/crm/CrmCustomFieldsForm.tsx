import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";
import type { CrmCustomFieldDefinition } from "@shared/schema";

export type CustomFieldsValue = Record<string, unknown>;

interface Props {
  entityType: "CONTACT" | "ORGANISATION" | "OPPORTUNITY";
  values: CustomFieldsValue;
  onChange: (next: CustomFieldsValue) => void;
  prefix?: string;
}

export function CrmCustomFieldsForm({ entityType, values, onChange, prefix = "" }: Props) {
  const { data: defs, isLoading } = useQuery<CrmCustomFieldDefinition[]>({
    queryKey: ["/api/crm/custom-field-definitions", { entityType }],
  });

  if (isLoading) return <Skeleton className="h-12 w-full" data-testid={`skeleton-${prefix}custom-fields`} />;
  const active = (defs ?? []).filter(d => d.isActive);
  if (active.length === 0) return null;

  const setVal = (key: string, v: unknown) => onChange({ ...values, [key]: v });

  return (
    <div className="space-y-3 pt-2 border-t" data-testid={`section-${prefix}custom-fields`}>
      <p className="text-sm font-semibold text-muted-foreground">Custom fields</p>
      {active.map(def => {
        const v = values[def.key];
        const id = `${prefix}cf-${def.key}`;
        const required = def.isRequired;
        const help = def.helpText;
        const opts = (def.options as string[] | null) ?? [];
        const labelEl = (
          <Label htmlFor={id}>
            {def.label}{required && <span className="text-destructive ml-0.5">*</span>}
          </Label>
        );
        let input: JSX.Element;
        switch (def.fieldType) {
          case "TEXT":
          case "URL":
          case "EMAIL":
          case "PHONE":
            input = (
              <Input
                id={id}
                type={def.fieldType === "EMAIL" ? "email" : def.fieldType === "URL" ? "url" : def.fieldType === "PHONE" ? "tel" : "text"}
                value={(v as string) ?? ""}
                onChange={e => setVal(def.key, e.target.value)}
                data-testid={`input-${id}`}
              />
            );
            break;
          case "LONG_TEXT":
            input = (
              <Textarea
                id={id}
                value={(v as string) ?? ""}
                onChange={e => setVal(def.key, e.target.value)}
                rows={3}
                data-testid={`textarea-${id}`}
              />
            );
            break;
          case "NUMBER":
          case "CURRENCY":
            input = (
              <Input
                id={id}
                type="number"
                step={def.fieldType === "CURRENCY" ? "0.01" : "any"}
                value={v == null ? "" : String(v)}
                onChange={e => setVal(def.key, e.target.value === "" ? null : Number(e.target.value))}
                data-testid={`input-${id}`}
              />
            );
            break;
          case "DATE":
            input = (
              <Input
                id={id}
                type="date"
                value={(v as string) ?? ""}
                onChange={e => setVal(def.key, e.target.value)}
                data-testid={`input-${id}`}
              />
            );
            break;
          case "CHECKBOX":
            input = (
              <div className="flex items-center gap-2">
                <input
                  id={id}
                  type="checkbox"
                  checked={Boolean(v)}
                  onChange={e => setVal(def.key, e.target.checked)}
                  className="rounded border-input"
                  data-testid={`checkbox-${id}`}
                />
                <span className="text-sm text-muted-foreground">{help || "Yes / No"}</span>
              </div>
            );
            break;
          case "DROPDOWN":
            input = (
              <Select value={(v as string) || "__none__"} onValueChange={val => setVal(def.key, val === "__none__" ? null : val)}>
                <SelectTrigger id={id} data-testid={`select-${id}`}>
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— None —</SelectItem>
                  {opts.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                </SelectContent>
              </Select>
            );
            break;
          case "MULTI_SELECT": {
            const arr = Array.isArray(v) ? (v as string[]) : [];
            input = (
              <div data-testid={`multi-${id}`}>
                <div className="flex flex-wrap gap-1 mb-1">
                  {arr.map(val => (
                    <Badge key={val} variant="secondary" className="gap-1 text-xs">
                      {val}
                      <X className="w-3 h-3 cursor-pointer" onClick={() => setVal(def.key, arr.filter(x => x !== val))} />
                    </Badge>
                  ))}
                </div>
                <Select value="" onValueChange={val => { if (val && !arr.includes(val)) setVal(def.key, [...arr, val]); }}>
                  <SelectTrigger><SelectValue placeholder="Add..." /></SelectTrigger>
                  <SelectContent>
                    {opts.filter(o => !arr.includes(o)).map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            );
            break;
          }
          default:
            input = <Input value={(v as string) ?? ""} onChange={e => setVal(def.key, e.target.value)} data-testid={`input-${id}`} />;
        }
        return (
          <div key={def.id} className="space-y-1.5" data-testid={`field-${id}`}>
            {def.fieldType !== "CHECKBOX" && labelEl}
            {def.fieldType === "CHECKBOX" && labelEl}
            {input}
            {help && def.fieldType !== "CHECKBOX" && <p className="text-xs text-muted-foreground">{help}</p>}
          </div>
        );
      })}
    </div>
  );
}

interface DisplayProps {
  entityType: "CONTACT" | "ORGANISATION" | "OPPORTUNITY";
  values: CustomFieldsValue | undefined | null;
  testIdPrefix?: string;
}

export function CrmCustomFieldsDisplay({ entityType, values, testIdPrefix = "" }: DisplayProps) {
  const { data: defs } = useQuery<CrmCustomFieldDefinition[]>({
    queryKey: ["/api/crm/custom-field-definitions", { entityType }],
  });
  const map = values ?? {};
  const list = (defs ?? [])
    .filter(d => d.isActive || map[d.key] !== undefined)
    .map(d => ({ def: d, val: map[d.key] }))
    .filter(x => x.val !== undefined && x.val !== null && x.val !== "");
  if (list.length === 0) return null;
  return (
    <div className="space-y-2" data-testid={`display-${testIdPrefix}custom-fields`}>
      <p className="text-sm font-semibold">Custom fields</p>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
        {list.map(({ def, val }) => (
          <div key={def.id} data-testid={`row-${testIdPrefix}cf-${def.key}`}>
            <dt className="text-xs text-muted-foreground">{def.label}</dt>
            <dd className="text-sm">{formatVal(def, val)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function formatVal(def: CrmCustomFieldDefinition, v: unknown): string {
  if (v == null || v === "") return "—";
  switch (def.fieldType) {
    case "CHECKBOX": return v ? "Yes" : "No";
    case "CURRENCY": return typeof v === "number" ? `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : String(v);
    case "MULTI_SELECT": return Array.isArray(v) ? v.join(", ") : String(v);
    case "DATE": return typeof v === "string" ? v : String(v);
    default: return String(v);
  }
}
