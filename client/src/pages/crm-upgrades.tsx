import { useRef, useState } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, Plus, Trash2, Copy, ExternalLink, AlertTriangle, Upload, BarChart3, Zap, Calendar, FileText, Clock, ChevronDown, ChevronRight, Download, RotateCcw } from "lucide-react";

const STAGES = ["LEAD", "QUALIFIED", "ESTIMATING", "BID_SUBMITTED", "NEGOTIATION", "WON", "LOST"];

export default function CrmUpgradesPage() {
  return (
    <div className="container mx-auto py-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">CRM Sales Tools</h1>
        <p className="text-muted-foreground">Lead forms, booking links, SLAs, automations, reports, and CSV import.</p>
      </div>
      <Tabs defaultValue="forms" className="w-full">
        <TabsList className="grid grid-cols-7 w-full">
          <TabsTrigger value="forms" data-testid="tab-forms"><FileText className="h-4 w-4 mr-1" />Forms</TabsTrigger>
          <TabsTrigger value="booking" data-testid="tab-booking"><Calendar className="h-4 w-4 mr-1" />Booking</TabsTrigger>
          <TabsTrigger value="sla" data-testid="tab-sla"><Clock className="h-4 w-4 mr-1" />SLAs</TabsTrigger>
          <TabsTrigger value="automations" data-testid="tab-automations"><Zap className="h-4 w-4 mr-1" />Automations</TabsTrigger>
          <TabsTrigger value="reports" data-testid="tab-reports"><BarChart3 className="h-4 w-4 mr-1" />Reports</TabsTrigger>
          <TabsTrigger value="import" data-testid="tab-import"><Upload className="h-4 w-4 mr-1" />Import</TabsTrigger>
          <TabsTrigger value="attention" data-testid="tab-attention"><AlertTriangle className="h-4 w-4 mr-1" />Needs Attention</TabsTrigger>
        </TabsList>
        <TabsContent value="forms"><LeadFormsPanel /></TabsContent>
        <TabsContent value="booking"><BookingLinksPanel /></TabsContent>
        <TabsContent value="sla"><SlaPanel /></TabsContent>
        <TabsContent value="automations"><AutomationsPanel /></TabsContent>
        <TabsContent value="reports"><ReportsPanel /></TabsContent>
        <TabsContent value="import"><ImportPanel /></TabsContent>
        <TabsContent value="attention"><NeedsAttentionPanel /></TabsContent>
      </Tabs>
    </div>
  );
}

function LeadFormsPanel() {
  const { toast } = useToast();
  const { data: forms = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/crm/lead-forms"] });
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/crm/lead-forms", {
      name,
      status: "PUBLISHED",
      fields: [
        { key: "name", label: "Name", type: "TEXT", required: true },
        { key: "email", label: "Email", type: "EMAIL", required: true },
        { key: "phone", label: "Phone", type: "PHONE" },
        { key: "company", label: "Company", type: "TEXT" },
        { key: "message", label: "How can we help?", type: "TEXTAREA" },
      ],
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/lead-forms"] });
      setName("");
      toast({ title: "Form created" });
    },
  });
  const remove = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/crm/lead-forms/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/crm/lead-forms"] }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lead capture forms</CardTitle>
        <CardDescription>Create public forms to capture inbound leads. Each form gets a unique public URL.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input placeholder="New form name" value={name} onChange={(e) => setName(e.target.value)} data-testid="input-form-name" />
          <Button onClick={() => create.mutate()} disabled={!name || create.isPending} data-testid="button-create-form"><Plus className="h-4 w-4 mr-1" />Create with default fields</Button>
        </div>
        {isLoading ? <Loader2 className="animate-spin" /> : (
          <div className="space-y-2">
            {forms.map((f) => (
              <div key={f.id} className="flex items-center justify-between border rounded p-3" data-testid={`row-form-${f.id}`}>
                <div>
                  <div className="font-medium">{f.name} <Badge variant="outline" className="ml-2">{f.status}</Badge></div>
                  <div className="text-sm text-muted-foreground">{(f.fields || []).length} fields</div>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/forms/${f.slug}`); toast({ title: "Public URL copied" }); }} data-testid={`button-copy-${f.id}`}><Copy className="h-4 w-4" /></Button>
                  <a href={`/forms/${f.slug}`} target="_blank" rel="noreferrer"><Button size="sm" variant="outline" data-testid={`button-open-${f.id}`}><ExternalLink className="h-4 w-4" /></Button></a>
                  <Button size="sm" variant="destructive" onClick={() => remove.mutate(f.id)} data-testid={`button-delete-${f.id}`}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
            ))}
            {forms.length === 0 && <p className="text-sm text-muted-foreground">No forms yet.</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BookingLinksPanel() {
  const { toast } = useToast();
  const { data: links = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/crm/meeting-links"] });
  const [name, setName] = useState("");
  const [duration, setDuration] = useState(30);
  const create = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/crm/meeting-links", {
      name,
      durationMinutes: duration,
      timezone: "America/New_York",
      availability: { mon: [{ start: "09:00", end: "17:00" }], tue: [{ start: "09:00", end: "17:00" }], wed: [{ start: "09:00", end: "17:00" }], thu: [{ start: "09:00", end: "17:00" }], fri: [{ start: "09:00", end: "17:00" }] },
      isActive: true,
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/crm/meeting-links"] }); setName(""); toast({ title: "Booking link created" }); },
  });
  const remove = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/crm/meeting-links/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/crm/meeting-links"] }),
  });

  return (
    <Card>
      <CardHeader><CardTitle>Meeting booking links</CardTitle><CardDescription>Public scheduling links with availability windows. Mon–Fri 9–5 default.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input placeholder="Link name (e.g. 'Discovery call')" value={name} onChange={(e) => setName(e.target.value)} data-testid="input-link-name" />
          <Input type="number" className="w-24" value={duration} onChange={(e) => setDuration(Number(e.target.value))} data-testid="input-duration" />
          <Button onClick={() => create.mutate()} disabled={!name || create.isPending} data-testid="button-create-link"><Plus className="h-4 w-4 mr-1" />Create</Button>
        </div>
        {isLoading ? <Loader2 className="animate-spin" /> : (
          <div className="space-y-2">
            {links.map((l) => (
              <div key={l.id} className="flex items-center justify-between border rounded p-3" data-testid={`row-link-${l.id}`}>
                <div>
                  <div className="font-medium">{l.name}</div>
                  <div className="text-sm text-muted-foreground">{l.durationMinutes} min · {l.timezone}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/book/${l.slug}`); toast({ title: "Public URL copied" }); }} data-testid={`button-copy-${l.id}`}><Copy className="h-4 w-4" /></Button>
                  <a href={`/book/${l.slug}`} target="_blank" rel="noreferrer"><Button size="sm" variant="outline" data-testid={`button-open-${l.id}`}><ExternalLink className="h-4 w-4" /></Button></a>
                  <Button size="sm" variant="destructive" onClick={() => remove.mutate(l.id)} data-testid={`button-delete-${l.id}`}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
            ))}
            {links.length === 0 && <p className="text-sm text-muted-foreground">No booking links yet.</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SlaPanel() {
  const { toast } = useToast();
  const { data: slas = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/crm/stage-slas"] });
  const upsert = useMutation({
    mutationFn: async (body: any) => apiRequest("POST", "/api/crm/stage-slas", body),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/crm/stage-slas"] }); toast({ title: "SLA saved" }); },
  });
  const runCheck = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/crm/sla/run-check", {}),
    onSuccess: (data: any) => toast({ title: `Checked. Flagged ${data.flagged ?? 0} deal(s).` }),
  });

  return (
    <Card>
      <CardHeader><CardTitle>Stage SLAs</CardTitle><CardDescription>Maximum days a deal can sit in each stage before it's flagged for attention.</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        {STAGES.filter((s) => s !== "WON" && s !== "LOST").map((stage) => {
          const sla = (slas as any[]).find((x) => x.stage === stage);
          return (
            <div key={stage} className="grid grid-cols-12 gap-2 items-center" data-testid={`row-sla-${stage}`}>
              <Label className="col-span-3">{stage}</Label>
              <Input type="number" placeholder="Max days" defaultValue={sla?.maxDaysInStage ?? 7} className="col-span-3" data-testid={`input-sla-days-${stage}`} id={`sla-${stage}-days`} />
              <div className="col-span-3 flex items-center gap-2"><Switch defaultChecked={sla?.notifyAssignee ?? true} id={`sla-${stage}-notify`} /><Label className="text-sm">Notify owner</Label></div>
              <Button size="sm" className="col-span-3" onClick={() => {
                const days = Number((document.getElementById(`sla-${stage}-days`) as HTMLInputElement).value);
                const notify = (document.getElementById(`sla-${stage}-notify`) as any)?.getAttribute("aria-checked") === "true";
                upsert.mutate({ stage, maxDaysInStage: days, warnAtDays: Math.max(1, days - 2), notifyAssignee: notify });
              }} data-testid={`button-save-sla-${stage}`}>Save</Button>
            </div>
          );
        })}
        <div className="pt-3 border-t">
          <Button variant="outline" onClick={() => runCheck.mutate()} data-testid="button-run-sla-check">Run SLA check now</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AutomationsPanel() {
  const { toast } = useToast();
  const { data: automations = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/crm/automations"] });
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState<string>("STAGE_CHANGE");
  const create = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/crm/automations", {
      name,
      trigger,
      isActive: true,
      triggerConfig: trigger === "STAGE_CHANGE" ? { toStage: "QUALIFIED" } : trigger === "FORM_SUBMIT" ? {} : { idleDays: 7 },
      actions: [{ type: "NOTIFY", config: { userIds: [], title: "Automation triggered", message: "A deal needs attention" } }],
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/crm/automations"] }); setName(""); toast({ title: "Automation created" }); },
  });
  const toggle = useMutation({
    mutationFn: async ({ id, isActive }: any) => apiRequest("PATCH", `/api/crm/automations/${id}`, { isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/crm/automations"] }),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/crm/automations/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/crm/automations"] }),
  });

  return (
    <Card>
      <CardHeader><CardTitle>Automations</CardTitle><CardDescription>If-this-then-that rules for the CRM. Created with default actions; edit JSON via API for advanced config.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} data-testid="input-auto-name" />
          <Select value={trigger} onValueChange={setTrigger}>
            <SelectTrigger className="w-48" data-testid="select-trigger"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="STAGE_CHANGE">Stage change</SelectItem>
              <SelectItem value="IDLE_DAYS">Idle days</SelectItem>
              <SelectItem value="SCORE_THRESHOLD">Score threshold</SelectItem>
              <SelectItem value="FORM_SUBMIT">Form submit</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => create.mutate()} disabled={!name || create.isPending} data-testid="button-create-auto"><Plus className="h-4 w-4 mr-1" />Create</Button>
        </div>
        {isLoading ? <Loader2 className="animate-spin" /> : (
          <div className="space-y-2">
            {automations.map((a) => (
              <div key={a.id} className="flex items-center justify-between border rounded p-3" data-testid={`row-auto-${a.id}`}>
                <div>
                  <div className="font-medium">{a.name} <Badge variant="outline" className="ml-2">{a.trigger}</Badge></div>
                  <div className="text-sm text-muted-foreground">{(a.actions || []).length} action(s)</div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={a.isActive} onCheckedChange={(v) => toggle.mutate({ id: a.id, isActive: v })} data-testid={`switch-active-${a.id}`} />
                  <Button size="sm" variant="destructive" onClick={() => remove.mutate(a.id)} data-testid={`button-delete-${a.id}`}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
            ))}
            {automations.length === 0 && <p className="text-sm text-muted-foreground">No automations yet.</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ReportsPanel() {
  const { data: reports = [] } = useQuery<any[]>({ queryKey: ["/api/crm/reports"] });
  const [dim, setDim] = useState<string>("stage");
  const run = useMutation({ mutationFn: async () => (await apiRequest("POST", "/api/crm/reports/run", { entity: "opportunity", dimensions: [dim], measures: ["count", "sumDealValue"], chart: "bar" })).json() });
  return (
    <Card>
      <CardHeader><CardTitle>Custom reports</CardTitle><CardDescription>Slice opportunities by any dimension. Ad-hoc query plus saved reports.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Select value={dim} onValueChange={setDim}>
            <SelectTrigger className="w-48" data-testid="select-dimension"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="stage">By stage</SelectItem>
              <SelectItem value="source">By source</SelectItem>
              <SelectItem value="assignedToId">By owner</SelectItem>
              <SelectItem value="lostCategory">By loss reason</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => run.mutate()} data-testid="button-run-report">Run report</Button>
        </div>
        {run.data && (
          <div className="border rounded p-3">
            <table className="w-full text-sm">
              <thead><tr><th className="text-left">Dimension</th><th className="text-right">Count</th><th className="text-right">Sum value</th></tr></thead>
              <tbody>
                {((run.data as any).rows || []).map((r: any, i: number) => (
                  <tr key={i} data-testid={`row-report-${i}`}><td>{String(r.dimension ?? "—")}</td><td className="text-right">{r.count}</td><td className="text-right">${Number(r.sumDealValue ?? 0).toLocaleString()}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="pt-3 border-t">
          <h4 className="font-medium mb-2">Saved reports</h4>
          {reports.length === 0 ? <p className="text-sm text-muted-foreground">No saved reports.</p> : reports.map((r: any) => (
            <div key={r.id} className="border rounded p-2 mb-2">{r.name}</div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

type FieldDef = { value: string; label: string; required?: boolean; type?: "text" | "date" | "number" };
type FieldsByEntity = Record<"CONTACT" | "ORGANISATION" | "OPPORTUNITY", FieldDef[]>;
const SKIP_VALUE = "__skip__";

function fieldTypeBadge(t: FieldDef["type"]): string {
  if (t === "date") return "date";
  if (t === "number") return "number";
  return "";
}

function autoMatchField(header: string, fields: FieldDef[]): string {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const h = norm(header);
  if (!h) return SKIP_VALUE;
  const aliases: Record<string, string[]> = {
    fullName: ["fullname", "name", "contactname", "contact"],
    firstName: ["firstname", "first", "fname", "givenname"],
    lastName: ["lastname", "last", "lname", "surname", "familyname"],
    email: ["email", "emailaddress", "mail", "eaddress", "emailid"],
    phone: ["phone", "phonenumber", "mobile", "tel", "telephone", "cell", "cellphone", "contactnumber"],
    title: ["title", "jobtitle", "role", "position"],
    company: ["company", "companyname", "organisation", "organization", "org", "account", "organisationname", "organizationname", "employer", "business"],
    name: ["name", "companyname", "organisation", "organization", "dealname", "opportunityname", "organisationname", "organizationname"],
    type: ["type", "category", "kind"],
    website: ["website", "url", "site", "web"],
    address: ["address", "street", "location", "streetaddress"],
    stage: ["stage", "status", "pipelinestage"],
    dealValue: ["dealvalue", "value", "amount", "price", "revenue", "dealamount", "expectedrevenue", "contractamount"],
    source: ["source", "leadsource", "channel"],
    birthday: ["birthday", "birthdate", "dob", "dateofbirth"],
    expectedCloseDate: ["expectedclosedate", "closedate", "closingdate", "estimatedclosedate", "expectedclose"],
    probability: ["probability", "winprobability", "winchance", "chance"],
    insuranceExpiration: ["insuranceexpiration", "insuranceexpiry", "insexpiration", "insexpiry"],
    insuranceCoverageAmount: ["insurancecoverage", "insurancecoverageamount", "coverageamount", "coverage"],
    licenseExpiration: ["licenseexpiration", "licenseexpiry", "licexpiration"],
    contractExpiration: ["contractexpiration", "contractexpiry", "contractend", "contractenddate"],
  };
  for (const f of fields) {
    const candidates = aliases[f.value] ?? [f.value.toLowerCase()];
    if (candidates.includes(h)) return f.value;
  }
  for (const f of fields) {
    if (h.includes(f.value.toLowerCase())) return f.value;
  }
  return SKIP_VALUE;
}

function ImportPanel() {
  const { toast } = useToast();
  const { data: jobs = [] } = useQuery<any[]>({
    queryKey: ["/api/crm/csv-imports"],
    refetchInterval: (query) => {
      const data = (query.state.data as any[]) || [];
      const hasActive = data.some((j) => j?.status === "PENDING" || j?.status === "PROCESSING");
      return hasActive ? 2000 : false;
    },
  });
  const { data: fieldsByEntity } = useQuery<FieldsByEntity>({ queryKey: ["/api/crm/csv-imports/fields"] });
  const [entity, setEntity] = useState<"CONTACT" | "ORGANISATION" | "OPPORTUNITY">("CONTACT");
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [parsedRows, setParsedRows] = useState<Record<string, any>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const parseTokenRef = useRef(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string | null>(null);
  const workbookRef = useRef<XLSX.WorkBook | null>(null);
  const fields = fieldsByEntity?.[entity] ?? [];

  const parseCsvFile = (f: File) => new Promise<{ headers: string[]; rows: Record<string, any>[] }>((resolve, reject) => {
    Papa.parse<Record<string, any>>(f, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      complete: (results) => {
        if (results.errors && results.errors.length > 0) {
          const first = results.errors[0];
          reject(new Error(`CSV parse error on row ${first.row ?? "?"}: ${first.message}`));
          return;
        }
        const hdrs = (results.meta.fields || []).map((h) => h.trim());
        if (hdrs.length === 0) {
          reject(new Error("CSV is missing a header row"));
          return;
        }
        const rows = (results.data || []).filter((r) => r && Object.keys(r).length > 0);
        if (rows.length === 0) {
          reject(new Error("Need header + at least 1 row"));
          return;
        }
        resolve({ headers: hdrs, rows });
      },
      error: (err) => reject(err),
    });
  });

  const normalizeCellValue = (v: any): any => {
    if (v === undefined || v === null) return "";
    if (v instanceof Date) {
      if (isNaN(v.getTime())) return "";
      const hasTime = v.getUTCHours() !== 0 || v.getUTCMinutes() !== 0 || v.getUTCSeconds() !== 0 || v.getUTCMilliseconds() !== 0;
      return hasTime ? v.toISOString() : v.toISOString().slice(0, 10);
    }
    if (typeof v === "number" || typeof v === "boolean") return v;
    return String(v);
  };

  const parseSheet = (wb: XLSX.WorkBook, sheetName: string): { headers: string[]; rows: Record<string, any>[] } => {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) throw new Error(`Sheet "${sheetName}" not found in workbook`);
    // raw: true keeps native types — numbers stay numeric, formula cells return
    // their cached calculated value (the `v` field) instead of formula text, and
    // date cells come through as Date objects (because we read with cellDates).
    const aoa = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: null, raw: true, blankrows: false });
    if (!aoa || aoa.length === 0) throw new Error("Sheet is empty");
    const rawHeaders = (aoa[0] || []).map((h) => (h == null ? "" : String(h).trim()));
    const headers: string[] = [];
    const seen = new Map<string, number>();
    for (let i = 0; i < rawHeaders.length; i++) {
      let h = rawHeaders[i] || `Column ${i + 1}`;
      if (seen.has(h)) {
        const n = (seen.get(h) || 1) + 1;
        seen.set(h, n);
        h = `${h} (${n})`;
      } else {
        seen.set(h, 1);
      }
      headers.push(h);
    }
    if (headers.length === 0) throw new Error("Sheet is missing a header row");
    const rows: Record<string, any>[] = [];
    for (let r = 1; r < aoa.length; r++) {
      const row = aoa[r] || [];
      const obj: Record<string, any> = {};
      let any = false;
      for (let c = 0; c < headers.length; c++) {
        const v = normalizeCellValue(row[c]);
        if (v !== "" && v !== null && v !== undefined) any = true;
        obj[headers[c]] = v;
      }
      if (any) rows.push(obj);
    }
    if (rows.length === 0) throw new Error("Need header + at least 1 row");
    return { headers, rows };
  };

  const parseExcelFile = async (f: File): Promise<{ wb: XLSX.WorkBook; sheets: string[] }> => {
    const buf = await f.arrayBuffer();
    let wb: XLSX.WorkBook;
    try {
      // cellDates: parse date-formatted cells as JS Date objects (instead of
      // Excel serial numbers). Combined with sheet_to_json's raw:true, formula
      // cells surface their cached calculated value rather than the formula text.
      wb = XLSX.read(buf, { type: "array", cellDates: true });
    } catch (e: any) {
      const msg = String(e?.message || e || "").toLowerCase();
      if (msg.includes("password") || msg.includes("encrypt")) {
        throw new Error("This file is password-protected. Please remove the password and try again.");
      }
      throw e;
    }
    const sheets = wb.SheetNames || [];
    if (sheets.length === 0) throw new Error("Workbook has no sheets");
    return { wb, sheets };
  };

  const EXCEL_MIME_TYPES = new Set([
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "application/vnd.oasis.opendocument.spreadsheet",
  ]);

  const formatPreviewValue = (v: any): string => {
    if (v === null || v === undefined || v === "") return "";
    if (typeof v === "number") {
      if (!Number.isFinite(v)) return String(v);
      return v.toLocaleString(undefined, { maximumFractionDigits: 10 });
    }
    if (typeof v === "boolean") return v ? "true" : "false";
    return String(v);
  };

  const previewValueTypeLabel = (v: any): string | null => {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return "number";
    if (typeof v === "boolean") return "boolean";
    if (typeof v === "string") {
      if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?Z)?$/.test(v)) return "date";
    }
    return null;
  };

  const isExcelFile = (f: File) => {
    const name = f.name.toLowerCase();
    return (
      name.endsWith(".xlsx") ||
      name.endsWith(".xls") ||
      name.endsWith(".ods") ||
      EXCEL_MIME_TYPES.has(f.type)
    );
  };

  const resetParsed = () => {
    setHeaders([]);
    setParsedRows([]);
    setMapping({});
    setParseError(null);
    setSheetNames([]);
    setSelectedSheet(null);
    workbookRef.current = null;
  };

  const applyParsed = (hs: string[], rows: Record<string, any>[]) => {
    setHeaders(hs);
    setParsedRows(rows);
    const initial: Record<string, string> = {};
    hs.forEach((h) => { initial[h] = autoMatchField(h, fields); });
    setMapping(initial);
  };

  const handleFileChange = async (f: File | null) => {
    const token = ++parseTokenRef.current;
    setFile(f);
    resetParsed();
    if (!f) {
      setIsParsing(false);
      return;
    }
    setIsParsing(true);
    try {
      if (isExcelFile(f)) {
        const { wb, sheets } = await parseExcelFile(f);
        if (parseTokenRef.current !== token) return;
        workbookRef.current = wb;
        setSheetNames(sheets);
        const first = sheets[0];
        setSelectedSheet(first);
        const { headers: hs, rows } = parseSheet(wb, first);
        if (parseTokenRef.current !== token) return;
        applyParsed(hs, rows);
      } else {
        const { headers: hs, rows } = await parseCsvFile(f);
        if (parseTokenRef.current !== token) return;
        applyParsed(hs, rows);
      }
    } catch (err: any) {
      if (parseTokenRef.current !== token) return;
      setParseError(err?.message ?? String(err));
    } finally {
      if (parseTokenRef.current === token) setIsParsing(false);
    }
  };

  const handleSheetChange = (name: string) => {
    if (!workbookRef.current) return;
    setSelectedSheet(name);
    setParseError(null);
    setHeaders([]);
    setParsedRows([]);
    setMapping({});
    setIsParsing(true);
    try {
      const { headers: hs, rows } = parseSheet(workbookRef.current, name);
      applyParsed(hs, rows);
    } catch (e: any) {
      setParseError(e?.message || "Failed to parse sheet");
    } finally {
      setIsParsing(false);
    }
  };

  const handleEntityChange = (next: string) => {
    const e = next as "CONTACT" | "ORGANISATION" | "OPPORTUNITY";
    setEntity(e);
    if (headers.length > 0) {
      const nextFields = fieldsByEntity?.[e] ?? [];
      const remapped: Record<string, string> = {};
      headers.forEach((h) => { remapped[h] = autoMatchField(h, nextFields); });
      setMapping(remapped);
    }
  };

  const requiredFieldValues = fields.filter((f) => f.required).map((f) => f.value);
  const mappedTargets = Object.values(mapping).filter((v) => v && v !== SKIP_VALUE);
  const hasRequired = requiredFieldValues.length === 0
    ? mappedTargets.length > 0
    : requiredFieldValues.some((rv) => mappedTargets.includes(rv));

  const duplicates = mappedTargets.filter((v, i, arr) => arr.indexOf(v) !== i);

  const submit = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Please choose a CSV file");
      if (parsedRows.length === 0) throw new Error("No rows to import");
      if (!hasRequired) {
        const labels = fields.filter((f) => f.required).map((f) => f.label).join(" or ");
        throw new Error(`Map at least one column to ${labels || "a target field"}`);
      }
      if (duplicates.length > 0) {
        throw new Error("Each target field can only be mapped from one column");
      }
      const cleanMapping: Record<string, string> = {};
      Object.entries(mapping).forEach(([csvCol, target]) => {
        if (target && target !== SKIP_VALUE) cleanMapping[csvCol] = target;
      });
      return apiRequest("POST", "/api/crm/csv-imports", { entityType: entity, mapping: cleanMapping, rows: parsedRows, filename: file.name });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/csv-imports"] });
      setFile(null);
      resetParsed();
      if (fileInputRef.current) fileInputRef.current.value = "";
      toast({ title: "Import queued", description: "We'll process the rows in the background — progress will update below." });
    },
    onError: (e: any) => toast({ title: "Import failed", description: e.message, variant: "destructive" }),
  });
  const revert = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `/api/crm/csv-imports/${id}/revert`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/crm/csv-imports"] }),
    onError: async (e: any) => {
      let description = e?.message || "Revert failed";
      try {
        if (e?.response && typeof e.response.json === "function") {
          const body = await e.response.json();
          if (body?.error) description = body.error;
        }
      } catch {}
      toast({ title: "Cannot revert", description, variant: "destructive" });
    },
  });

  return (
    <Card>
      <CardHeader><CardTitle>CSV / Excel Import</CardTitle><CardDescription>Drag and drop or choose a CSV or spreadsheet (.xlsx, .xls, .ods) file (with header row), then match each column to a target field. Unmapped columns are skipped. Multi-sheet workbooks let you pick which sheet to import. Large files are processed in the background — you can leave this page and come back.</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <Select value={entity} onValueChange={handleEntityChange}>
          <SelectTrigger className="w-48" data-testid="select-entity"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="CONTACT">Contacts</SelectItem>
            <SelectItem value="ORGANISATION">Organisations</SelectItem>
            <SelectItem value="OPPORTUNITY">Opportunities</SelectItem>
          </SelectContent>
        </Select>
        <div
          className={`border-2 border-dashed rounded p-6 text-center transition-colors ${isDragOver ? "border-primary bg-primary/5" : "border-muted-foreground/25"}`}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); }}
          onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); }}
          onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(false); }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDragOver(false);
            const dropped = e.dataTransfer.files?.[0];
            if (!dropped) return;
            const name = dropped.name.toLowerCase();
            const isCsv = dropped.type === "text/csv" || name.endsWith(".csv");
            const isXlsx = isExcelFile(dropped);
            if (!isCsv && !isXlsx) {
              setFile(null);
              resetParsed();
              if (fileInputRef.current) fileInputRef.current.value = "";
              setParseError("Please drop a .csv, .xlsx, .xls, or .ods file");
              return;
            }
            handleFileChange(dropped);
          }}
          data-testid="dropzone-csv"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xls,application/vnd.ms-excel,.ods,application/vnd.oasis.opendocument.spreadsheet"
            className="hidden"
            onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
            data-testid="input-csv-file"
          />
          <Upload className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
          <div className="text-sm mb-2">Drag and drop a .csv, .xlsx, .xls, or .ods file here, or</div>
          <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} data-testid="button-choose-file">
            <Upload className="h-4 w-4 mr-1" />Choose file
          </Button>
          <div className="text-sm text-muted-foreground mt-2 flex items-center justify-center gap-2 flex-wrap">
            <span data-testid="text-csv-filename">{file ? file.name : "No file selected"}</span>
            {parsedRows.length > 0 && (
              <span data-testid="text-csv-rowcount">
                · {parsedRows.length.toLocaleString()} rows detected
              </span>
            )}
            {isParsing && <Loader2 className="h-4 w-4 animate-spin" data-testid="icon-csv-parsing" />}
          </div>
        </div>
        {sheetNames.length > 0 && (
          <div className="flex items-center gap-2" data-testid="sheet-picker">
            <Label className="text-sm">Sheet</Label>
            <Select value={selectedSheet ?? undefined} onValueChange={handleSheetChange}>
              <SelectTrigger className="w-64" data-testid="select-sheet"><SelectValue placeholder="Choose a sheet" /></SelectTrigger>
              <SelectContent>
                {sheetNames.map((s) => (
                  <SelectItem key={s} value={s} data-testid={`option-sheet-${s}`}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {sheetNames.length > 1 && (
              <span className="text-xs text-muted-foreground">{sheetNames.length} sheets in this workbook</span>
            )}
          </div>
        )}
        {parseError && (
          <div className="text-sm text-destructive border border-destructive/50 rounded p-2" data-testid="text-csv-parse-error">
            {parseError}
          </div>
        )}
        {parsedRows.length > 0 && (
          <div className="border rounded overflow-x-auto" data-testid="table-csv-preview">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  {headers.map((h) => (
                    <th key={h} className="text-left px-2 py-1 font-medium whitespace-nowrap" data-testid={`th-preview-${h}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parsedRows.slice(0, 5).map((r, i) => (
                  <tr key={i} className="border-t" data-testid={`row-preview-${i}`}>
                    {headers.map((h) => {
                      const typeLabel = previewValueTypeLabel(r[h]);
                      return (
                        <td key={h} className="px-2 py-1 whitespace-nowrap" data-testid={`cell-preview-${i}-${h}`}>
                          <span>{formatPreviewValue(r[h])}</span>
                          {typeLabel && <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground">{typeLabel}</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {parsedRows.length > 5 && (
              <div className="text-xs text-muted-foreground px-2 py-1 border-t">
                Showing first 5 of {parsedRows.length.toLocaleString()} rows
              </div>
            )}
          </div>
        )}

        {headers.length > 0 && (
          <div className="border rounded p-3 space-y-2" data-testid="section-column-mapping">
            <div className="flex items-center justify-between">
              <h4 className="font-medium text-sm">Match columns to fields</h4>
              <span className="text-xs text-muted-foreground" data-testid="text-row-count">
                {parsedRows.length} row{parsedRows.length === 1 ? "" : "s"} detected
              </span>
            </div>
            <div className="space-y-2">
              {headers.map((h) => {
                const sampleRaw = parsedRows.find((r) => r?.[h] !== undefined && r?.[h] !== "" && r?.[h] !== null)?.[h];
                const sample = formatPreviewValue(sampleRaw);
                const sampleType = previewValueTypeLabel(sampleRaw);
                return (
                  <div key={h} className="grid grid-cols-12 gap-2 items-center" data-testid={`row-mapping-${h}`}>
                    <div className="col-span-5 min-w-0">
                      <div className="text-sm font-medium truncate" title={h}>{h}</div>
                      {sample && (
                        <div className="text-xs text-muted-foreground truncate" title={sample} data-testid={`text-sample-${h}`}>
                          e.g. {sample}
                          {sampleType && <span className="ml-1 uppercase tracking-wide">[{sampleType}]</span>}
                        </div>
                      )}
                    </div>
                    <div className="col-span-7">
                      <Select
                        value={mapping[h] ?? SKIP_VALUE}
                        onValueChange={(v) => setMapping((prev) => ({ ...prev, [h]: v }))}
                      >
                        <SelectTrigger data-testid={`select-mapping-${h}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={SKIP_VALUE}>— Skip this column —</SelectItem>
                          {fields.map((f) => {
                            const badge = fieldTypeBadge(f.type);
                            return (
                              <SelectItem key={f.value} value={f.value}>
                                {f.label}{f.required ? " *" : ""}
                                {badge && (
                                  <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground" data-testid={`field-type-${f.value}`}>[{badge}]</span>
                                )}
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                );
              })}
            </div>
            {duplicates.length > 0 && (
              <p className="text-xs text-destructive" data-testid="text-mapping-duplicates">
                Each target field can only be mapped from one column.
              </p>
            )}
            {!hasRequired && (
              <p className="text-xs text-destructive" data-testid="text-mapping-missing-required">
                Map at least one column to {fields.filter((f) => f.required).map((f) => f.label).join(" or ") || "a target field"}.
              </p>
            )}
          </div>
        )}
        {headers.length > 0 && parsedRows.length > 0 && (() => {
          const usedTargetValues = new Set(
            Object.values(mapping).filter((t) => t && t !== SKIP_VALUE)
          );
          const previewColumns = fields.filter((t) => usedTargetValues.has(t.value));
          const previewRows = parsedRows.slice(0, 5).map((row) => {
            const out: Record<string, { display: string; type: string | null }> = {};
            for (const [csvCol, target] of Object.entries(mapping)) {
              if (!target || target === SKIP_VALUE) continue;
              const v = row[csvCol];
              if (v === undefined || v === null || v === "") continue;
              const display = typeof v === "string" ? v.trim() : formatPreviewValue(v);
              if (out[target] === undefined || out[target].display === "") {
                out[target] = { display, type: previewValueTypeLabel(v) };
              }
            }
            return out;
          });
          return (
            <div className="border rounded p-3 space-y-2" data-testid="preview-panel">
              <div className="flex items-center justify-between">
                <h4 className="font-medium text-sm">Preview</h4>
                <p className="text-xs text-muted-foreground">
                  First {previewRows.length} {entity.toLowerCase()} record{previewRows.length === 1 ? "" : "s"} as they will be imported. Updates live as you change mappings.
                </p>
              </div>
              {previewColumns.length === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid="text-preview-empty">Map at least one column to see a preview.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="border-b">
                        {previewColumns.map((c) => (
                          <th key={c.value} className="text-left font-medium py-1 pr-3" data-testid={`preview-header-${c.value}`}>
                            {c.label}
                            {fieldTypeBadge(c.type) && (
                              <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground font-normal">[{fieldTypeBadge(c.type)}]</span>
                            )}
                            <div className="text-xs text-muted-foreground font-normal">{c.value}</div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row, i) => (
                        <tr key={i} className="border-b last:border-0" data-testid={`preview-row-${i}`}>
                          {previewColumns.map((c) => {
                            const cell = row[c.value];
                            return (
                              <td key={c.value} className="py-1 pr-3 align-top" data-testid={`preview-cell-${i}-${c.value}`}>
                                {cell && cell.display ? (
                                  <span className="truncate inline-block max-w-[16rem]" title={cell.display}>
                                    {cell.display}
                                    {cell.type && <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground">{cell.type}</span>}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground italic">—</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })()}
        <Button onClick={() => submit.mutate()} disabled={!file || submit.isPending || isParsing || !!parseError || headers.length === 0 || !hasRequired || duplicates.length > 0} data-testid="button-import">
          {submit.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}Import
        </Button>
        <div className="pt-3 border-t">
          <h4 className="font-medium mb-2">Recent imports</h4>
          {(jobs as any[]).map((j) => (
            <RecentImportRow key={j.id} job={j} onRevert={(id) => revert.mutate(id)} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

type ImportRowError = { row: number; error: string; column?: string; value?: string };

function RecentImportRow({ job, onRevert }: { job: any; onRevert: (id: string) => void }) {
  const { toast } = useToast();
  const [showErrors, setShowErrors] = useState(false);
  const retryFileRef = useRef<HTMLInputElement | null>(null);
  const total = Number(job.totalRows ?? 0);
  const processed = Number(job.processedRows ?? 0);
  const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
  const isActive = job.status === "PENDING" || job.status === "PROCESSING";
  const errors: ImportRowError[] = Array.isArray(job.errors) ? job.errors : [];
  const errorCount = Number(job.errorRows ?? 0);
  const truncated = errorCount > errors.length;
  const isFinished = job.status === "COMPLETED" || job.status === "FAILED";
  const canRetry = isFinished && errorCount > 0;

  const retry = useMutation({
    mutationFn: async (rows?: Record<string, any>[]) => {
      const body: any = {};
      if (rows && rows.length > 0) body.rows = rows;
      return apiRequest("POST", `/api/crm/csv-imports/${job.id}/retry`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/csv-imports"] });
      toast({ title: "Retry queued", description: "We'll re-import the rows in the background." });
    },
    onError: async (e: any) => {
      let description = e?.message || "Retry failed";
      try {
        if (e?.response && typeof e.response.json === "function") {
          const body = await e.response.json();
          if (body?.error) description = body.error;
        }
      } catch {}
      toast({ title: "Cannot retry", description, variant: "destructive" });
    },
  });

  const handleRetryFile = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = Papa.parse<Record<string, any>>(text, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h) => h.trim(),
      });
      if (parsed.errors && parsed.errors.length > 0) {
        const first = parsed.errors[0];
        throw new Error(`CSV parse error on row ${first.row ?? "?"}: ${first.message}`);
      }
      const rows = (parsed.data || []).filter((r) => r && Object.keys(r).length > 0);
      if (rows.length === 0) throw new Error("Need header + at least 1 row");
      retry.mutate(rows);
    } catch (err: any) {
      toast({ title: "Could not read file", description: err?.message || String(err), variant: "destructive" });
    } finally {
      if (retryFileRef.current) retryFileRef.current.value = "";
    }
  };

  return (
    <div className="border rounded p-2 mb-2" data-testid={`row-job-${job.id}`}>
      <div className="flex items-center justify-between">
        <div className="text-sm">
          <span data-testid={`text-job-status-${job.id}`}>{job.entityType} · {job.status}</span>
          {" · "}
          <span data-testid={`text-job-counts-${job.id}`}>{job.insertedRows ?? 0} inserted, {job.updatedRows ?? 0} updated, {job.skippedRows ?? 0} skipped, {job.errorRows ?? 0} errors</span>
          {job.parentJobId && (
            <>
              {" · "}
              <span className="text-xs text-muted-foreground" data-testid={`text-job-parent-${job.id}`}>
                Retry of <span className="font-mono">{String(job.parentJobId).slice(0, 8)}</span>
              </span>
            </>
          )}
        </div>
        {job.status === "COMPLETED" && (
          <Button size="sm" variant="outline" onClick={() => onRevert(job.id)} data-testid={`button-revert-${job.id}`}>Revert</Button>
        )}
      </div>
      {isActive && total > 0 && (
        <div className="mt-2">
          <div className="h-1.5 w-full bg-muted rounded overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} data-testid={`progress-bar-${job.id}`} />
          </div>
          <div className="text-xs text-muted-foreground mt-1" data-testid={`text-job-progress-${job.id}`}>{processed} / {total} rows ({pct}%)</div>
        </div>
      )}
      {errorCount > 0 && (
        <div className="mt-2">
          <div className="flex items-center gap-3">
            {errors.length > 0 && (
              <button
                type="button"
                className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setShowErrors((v) => !v)}
                data-testid={`button-toggle-errors-${job.id}`}
              >
                {showErrors ? <ChevronDown className="h-3 w-3 mr-1" /> : <ChevronRight className="h-3 w-3 mr-1" />}
                {showErrors ? "Hide" : "Show"} row errors ({errors.length}{truncated ? ` of ${errorCount}` : ""})
              </button>
            )}
            <a
              href={`/api/crm/csv-imports/${job.id}/errors.csv`}
              download
              className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground"
              data-testid={`link-download-errors-${job.id}`}
            >
              <Download className="h-3 w-3 mr-1" />
              Download errors CSV
            </a>
            {canRetry && (
              <>
                <a
                  href={`/api/crm/csv-imports/${job.id}/error-rows.csv`}
                  download
                  className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground"
                  data-testid={`link-download-error-rows-${job.id}`}
                >
                  <Download className="h-3 w-3 mr-1" />
                  Download error rows
                </a>
                <input
                  ref={retryFileRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleRetryFile(f);
                  }}
                  data-testid={`input-retry-file-${job.id}`}
                />
                <button
                  type="button"
                  className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                  onClick={() => retryFileRef.current?.click()}
                  disabled={retry.isPending}
                  data-testid={`button-retry-upload-${job.id}`}
                >
                  <Upload className="h-3 w-3 mr-1" />
                  Re-upload corrected rows
                </button>
                <button
                  type="button"
                  className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                  onClick={() => retry.mutate(undefined)}
                  disabled={retry.isPending}
                  data-testid={`button-retry-resubmit-${job.id}`}
                >
                  {retry.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RotateCcw className="h-3 w-3 mr-1" />}
                  Re-import errored rows
                </button>
              </>
            )}
          </div>
          {showErrors && (
            <div className="mt-2 border rounded overflow-x-auto" data-testid={`table-errors-${job.id}`}>
              <table className="w-full text-xs">
                <thead className="bg-muted">
                  <tr>
                    <th className="text-left px-2 py-1 font-medium">Row</th>
                    <th className="text-left px-2 py-1 font-medium">Column</th>
                    <th className="text-left px-2 py-1 font-medium">Value</th>
                    <th className="text-left px-2 py-1 font-medium">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {errors.map((e, idx) => (
                    <tr key={idx} className="border-t align-top" data-testid={`row-error-${job.id}-${idx}`}>
                      <td className="px-2 py-1 whitespace-nowrap font-mono" data-testid={`text-error-row-${job.id}-${idx}`}>{e.row}</td>
                      <td className="px-2 py-1 whitespace-nowrap" data-testid={`text-error-column-${job.id}-${idx}`}>
                        {e.column ? e.column : <span className="text-muted-foreground italic">—</span>}
                      </td>
                      <td className="px-2 py-1" data-testid={`text-error-value-${job.id}-${idx}`}>
                        {e.value !== undefined && e.value !== "" ? (
                          <span className="font-mono break-all" title={e.value}>{e.value}</span>
                        ) : (
                          <span className="text-muted-foreground italic">—</span>
                        )}
                      </td>
                      <td className="px-2 py-1 text-destructive" data-testid={`text-error-message-${job.id}-${idx}`}>{e.error}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {truncated && (
                <div className="text-[10px] text-muted-foreground px-2 py-1 border-t">
                  Showing first {errors.length} of {errorCount} errors. Download the CSV above to see them all.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NeedsAttentionPanel() {
  const { data: deals = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/crm/opportunities/needs-attention"] });
  return (
    <Card>
      <CardHeader><CardTitle>Needs attention</CardTitle><CardDescription>Deals that breached your stage SLA — go close them or move them along.</CardDescription></CardHeader>
      <CardContent>
        {isLoading ? <Loader2 className="animate-spin" /> : deals.length === 0 ? <p className="text-sm text-muted-foreground">All clear — no SLA breaches.</p> : (
          <div className="space-y-2">
            {deals.map((d) => (
              <a key={d.id} href={`/crm/deals/${d.id}`} className="block border rounded p-3 hover:bg-muted" data-testid={`row-attention-${d.id}`}>
                <div className="font-medium">{d.name} <Badge variant="destructive" className="ml-2">{d.stage}</Badge></div>
                <div className="text-sm text-muted-foreground">{d.needsAttentionReason}</div>
              </a>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
