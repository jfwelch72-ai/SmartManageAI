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
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
        const headers = (results.meta.fields || []).map((h) => h.trim());
        if (headers.length === 0) {
          reject(new Error("CSV is missing a header row"));
          return;
        }
        const rows = (results.data || []).filter((r) => r && Object.keys(r).length > 0);
        if (rows.length === 0) {
          reject(new Error("Need header + at least 1 row"));
          return;
        }
        resolve({ headers, rows });
      },
      error: (err) => reject(err),
    });
  });

  const submit = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Please choose a CSV file");
      const { headers, rows } = await parseCsvFile(file);
      const mapping: Record<string, string> = {};
      headers.forEach((h) => { mapping[h] = h; });
      return apiRequest("POST", "/api/crm/csv-imports", { entityType: entity, mapping, rows, filename: file.name });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/csv-imports"] });
      setFile(null);
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
      <CardHeader><CardTitle>CSV Import</CardTitle><CardDescription>Upload a CSV file (with header row). Column names should match field names (e.g. fullName, email, phone). Quoted fields, embedded commas, and CRLF line endings are supported. Large files are processed in the background — you can leave this page and come back.</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <Select value={entity} onValueChange={setEntity}>
          <SelectTrigger className="w-48" data-testid="select-entity"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="CONTACT">Contacts</SelectItem>
            <SelectItem value="ORGANISATION">Organisations</SelectItem>
            <SelectItem value="OPPORTUNITY">Opportunities</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            data-testid="input-csv-file"
          />
          <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} data-testid="button-choose-file">
            <Upload className="h-4 w-4 mr-1" />Choose file
          </Button>
          <span className="text-sm text-muted-foreground" data-testid="text-csv-filename">
            {file ? file.name : "No file selected"}
          </span>
        </div>
        <Button onClick={() => submit.mutate()} disabled={!file || submit.isPending} data-testid="button-import">
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
