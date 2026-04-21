import { useRef, useState } from "react";
import Papa from "papaparse";
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
import { Loader2, Plus, Trash2, Copy, ExternalLink, AlertTriangle, Upload, BarChart3, Zap, Calendar, FileText, Clock } from "lucide-react";

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

const TARGET_FIELDS: Record<string, { value: string; label: string }[]> = {
  CONTACT: [
    { value: "fullName", label: "Full name" },
    { value: "firstName", label: "First name" },
    { value: "lastName", label: "Last name" },
    { value: "email", label: "Email" },
    { value: "phone", label: "Phone" },
    { value: "title", label: "Title / Job title" },
    { value: "company", label: "Company / Organisation" },
  ],
  ORGANISATION: [
    { value: "name", label: "Name" },
    { value: "type", label: "Type" },
    { value: "website", label: "Website" },
    { value: "phone", label: "Phone" },
    { value: "address", label: "Address" },
  ],
  OPPORTUNITY: [
    { value: "name", label: "Name" },
    { value: "stage", label: "Stage" },
    { value: "dealValue", label: "Deal value" },
    { value: "source", label: "Source" },
  ],
};

const SKIP_VALUE = "__skip__";

function guessTargetField(header: string, entity: string): string {
  const h = header.toLowerCase().replace(/[\s_\-]+/g, "");
  const targets = TARGET_FIELDS[entity] || [];
  const targetValues = new Set(targets.map((t) => t.value));
  const aliases: Record<string, string[]> = {
    fullName: ["fullname", "name", "contactname", "contact"],
    firstName: ["firstname", "first", "fname", "givenname"],
    lastName: ["lastname", "last", "lname", "surname", "familyname"],
    email: ["email", "emailaddress", "mail", "e-mail", "emailid"],
    phone: ["phone", "phonenumber", "mobile", "cell", "cellphone", "tel", "telephone", "contactnumber"],
    title: ["title", "jobtitle", "position", "role"],
    company: ["company", "companyname", "organisation", "organization", "organisationname", "organizationname", "employer", "business"],
    name: ["name", "companyname", "organisationname", "organizationname", "dealname", "opportunityname"],
    type: ["type", "category", "kind"],
    website: ["website", "url", "site", "web"],
    address: ["address", "streetaddress", "street", "location"],
    stage: ["stage", "status", "pipelinestage"],
    dealValue: ["dealvalue", "value", "amount", "price", "dealamount"],
    source: ["source", "leadsource", "channel"],
  };
  for (const target of targets) {
    if (target.value.toLowerCase() === h) return target.value;
  }
  for (const target of targets) {
    const list = aliases[target.value] || [];
    if (list.includes(h)) return target.value;
  }
  for (const target of targets) {
    const list = aliases[target.value] || [];
    if (list.some((a) => h.includes(a) || a.includes(h))) {
      if (targetValues.has(target.value)) return target.value;
    }
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
  const [entity, setEntity] = useState<string>("CONTACT");
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<{ headers: string[]; rows: Record<string, any>[] } | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [mappingOverrides, setMappingOverrides] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const parseTokenRef = useRef(0);
  const [isDragOver, setIsDragOver] = useState(false);

  const headers = parsedData?.headers ?? [];
  const showMapping = headers.length > 0;

  const effectiveMapping: Record<string, string> = {};
  for (const h of headers) {
    const override = mappingOverrides[`${entity}:${h}`];
    effectiveMapping[h] = override ?? guessTargetField(h, entity);
  }

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

  const handleFileChange = async (f: File | null) => {
    const token = ++parseTokenRef.current;
    setFile(f);
    setParsedData(null);
    setParseError(null);
    setMappingOverrides({});
    if (!f) {
      setIsParsing(false);
      return;
    }
    setIsParsing(true);
    try {
      const result = await parseCsvFile(f);
      if (parseTokenRef.current !== token) return;
      setParsedData(result);
    } catch (e: any) {
      if (parseTokenRef.current !== token) return;
      setParseError(e?.message || "Failed to parse CSV");
    } finally {
      if (parseTokenRef.current === token) setIsParsing(false);
    }
  };

  const submit = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Please choose a CSV file");
      if (!parsedData || parsedData.rows.length === 0) throw new Error("Need header + at least 1 row");
      const mapping: Record<string, string> = {};
      for (const [csvCol, target] of Object.entries(effectiveMapping)) {
        if (target && target !== SKIP_VALUE) mapping[csvCol] = target;
      }
      return apiRequest("POST", "/api/crm/csv-imports", { entityType: entity, mapping, rows: parsedData.rows, filename: file.name });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/csv-imports"] });
      setFile(null);
      setParsedData(null);
      setParseError(null);
      setMappingOverrides({});
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
      <CardHeader><CardTitle>CSV Import</CardTitle><CardDescription>Drag and drop or choose a CSV file (with header row), then map your columns to the right fields. Quoted fields, embedded commas, and CRLF line endings are supported. Large files are processed in the background — you can leave this page and come back.</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <Select value={entity} onValueChange={(v) => { setEntity(v); setMappingOverrides({}); }}>
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
            const isCsv = dropped.type === "text/csv" || dropped.name.toLowerCase().endsWith(".csv");
            if (!isCsv) {
              setFile(null);
              setParsedData(null);
              setMappingOverrides({});
              if (fileInputRef.current) fileInputRef.current.value = "";
              setParseError("Please drop a .csv file");
              return;
            }
            handleFileChange(dropped);
          }}
          data-testid="dropzone-csv"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
            data-testid="input-csv-file"
          />
          <Upload className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
          <div className="text-sm mb-2">Drag and drop a .csv file here, or</div>
          <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} data-testid="button-choose-file">
            <Upload className="h-4 w-4 mr-1" />Choose file
          </Button>
          <div className="text-sm text-muted-foreground mt-2 flex items-center justify-center gap-2 flex-wrap">
            <span data-testid="text-csv-filename">{file ? file.name : "No file selected"}</span>
            {parsedData && (
              <span data-testid="text-csv-rowcount">
                · {parsedData.rows.length.toLocaleString()} rows detected
              </span>
            )}
            {isParsing && <Loader2 className="h-4 w-4 animate-spin" />}
          </div>
        </div>
        {parseError && (
          <div className="text-sm text-destructive border border-destructive/50 rounded p-2" data-testid="text-csv-parse-error">
            {parseError}
          </div>
        )}
        {parsedData && (
          <div className="border rounded overflow-x-auto" data-testid="table-csv-preview">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  {parsedData.headers.map((h) => (
                    <th key={h} className="text-left px-2 py-1 font-medium whitespace-nowrap" data-testid={`th-preview-${h}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parsedData.rows.slice(0, 5).map((r, i) => (
                  <tr key={i} className="border-t" data-testid={`row-preview-${i}`}>
                    {parsedData.headers.map((h) => (
                      <td key={h} className="px-2 py-1 whitespace-nowrap">{r[h] != null ? String(r[h]) : ""}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {parsedData.rows.length > 5 && (
              <div className="text-xs text-muted-foreground px-2 py-1 border-t">
                Showing first 5 of {parsedData.rows.length.toLocaleString()} rows
              </div>
            )}
          </div>
        )}
        {showMapping && parsedData && (
          <div className="border rounded p-3 space-y-2" data-testid="mapping-panel">
            <div className="flex items-center justify-between">
              <h4 className="font-medium text-sm">Map columns ({parsedData.rows.length} row{parsedData.rows.length === 1 ? "" : "s"})</h4>
              <p className="text-xs text-muted-foreground">Pick the field each CSV column should populate. Unmapped columns are ignored.</p>
            </div>
            <div className="space-y-2">
              {headers.map((h) => {
                const value = effectiveMapping[h] || SKIP_VALUE;
                const sample = parsedData.rows[0]?.[h] ?? "";
                return (
                  <div key={h} className="grid grid-cols-12 gap-2 items-center" data-testid={`row-mapping-${h}`}>
                    <div className="col-span-5">
                      <div className="text-sm font-medium truncate" title={h}>{h}</div>
                      {sample && <div className="text-xs text-muted-foreground truncate" title={String(sample)}>e.g. {String(sample)}</div>}
                    </div>
                    <div className="col-span-7">
                      <Select value={value} onValueChange={(v) => setMappingOverrides((prev) => ({ ...prev, [`${entity}:${h}`]: v }))}>
                        <SelectTrigger data-testid={`select-mapping-${h}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={SKIP_VALUE}>— Skip this column —</SelectItem>
                          {(TARGET_FIELDS[entity] || []).map((t) => (
                            <SelectItem key={t.value} value={t.value}>{t.label} ({t.value})</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {showMapping && parsedData && (() => {
          const targets = TARGET_FIELDS[entity] || [];
          const usedTargetValues = new Set(
            Object.values(effectiveMapping).filter((t) => t && t !== SKIP_VALUE)
          );
          const previewColumns = targets.filter((t) => usedTargetValues.has(t.value));
          const previewRows = parsedData.rows.slice(0, 5).map((row) => {
            const out: Record<string, string> = {};
            for (const [csvCol, target] of Object.entries(effectiveMapping)) {
              if (!target || target === SKIP_VALUE) continue;
              const v = row[csvCol];
              if (v === undefined || v === null || v === "") continue;
              const s = typeof v === "string" ? v.trim() : String(v);
              if (out[target] === undefined || out[target] === "") out[target] = s;
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
                            <div className="text-xs text-muted-foreground font-normal">{c.value}</div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row, i) => (
                        <tr key={i} className="border-b last:border-0" data-testid={`preview-row-${i}`}>
                          {previewColumns.map((c) => (
                            <td key={c.value} className="py-1 pr-3 align-top" data-testid={`preview-cell-${i}-${c.value}`}>
                              {row[c.value] ? (
                                <span className="truncate inline-block max-w-[16rem]" title={row[c.value]}>{row[c.value]}</span>
                              ) : (
                                <span className="text-muted-foreground italic">—</span>
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })()}
        <Button onClick={() => submit.mutate()} disabled={!file || !parsedData || isParsing || !!parseError || submit.isPending} data-testid="button-import">
          {submit.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}Import
        </Button>
        <div className="pt-3 border-t">
          <h4 className="font-medium mb-2">Recent imports</h4>
          {(jobs as any[]).map((j) => {
            const total = Number(j.totalRows ?? 0);
            const processed = Number(j.processedRows ?? 0);
            const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
            const isActive = j.status === "PENDING" || j.status === "PROCESSING";
            return (
              <div key={j.id} className="border rounded p-2 mb-2" data-testid={`row-job-${j.id}`}>
                <div className="flex items-center justify-between">
                  <div className="text-sm">
                    <span data-testid={`text-job-status-${j.id}`}>{j.entityType} · {j.status}</span>
                    {" · "}
                    <span data-testid={`text-job-counts-${j.id}`}>{j.insertedRows ?? 0} inserted, {j.updatedRows ?? 0} updated, {j.skippedRows ?? 0} skipped, {j.errorRows ?? 0} errors</span>
                  </div>
                  {j.status === "COMPLETED" && (
                    <Button size="sm" variant="outline" onClick={() => revert.mutate(j.id)} data-testid={`button-revert-${j.id}`}>Revert</Button>
                  )}
                </div>
                {isActive && total > 0 && (
                  <div className="mt-2">
                    <div className="h-1.5 w-full bg-muted rounded overflow-hidden">
                      <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} data-testid={`progress-bar-${j.id}`} />
                    </div>
                    <div className="text-xs text-muted-foreground mt-1" data-testid={`text-job-progress-${j.id}`}>{processed} / {total} rows ({pct}%)</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
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
