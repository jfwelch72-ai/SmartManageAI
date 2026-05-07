import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Loader2, Download, Upload, AlertTriangle, CheckCircle2, FileDown, Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";

const ENTITY_OPTIONS = [
  { value: "subcontractors", label: "Subcontractors" },
  { value: "vendors", label: "Vendors" },
  { value: "cost_codes", label: "Cost Codes" },
  { value: "employees", label: "Employees" },
  { value: "equipment", label: "Equipment" },
  { value: "projects", label: "Projects" },
  { value: "historical_bids", label: "Historical Bids" },
];

interface ImportPreviewResult {
  jobId: string;
  status: string;
  totalRows: number;
  validRows: number;
  errorRows: number;
  insertedRows?: number;
  errors?: Array<{ row: number; field?: string; message: string }>;
  preview?: any[];
}

function ImportTab() {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [entityType, setEntityType] = useState<string>("subcontractors");
  const [csvText, setCsvText] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");
  const [dryRun, setDryRun] = useState<ImportPreviewResult | null>(null);

  const [xlsxBase64, setXlsxBase64] = useState<string>("");

  const importMutation = useMutation({
    mutationFn: async (commit: boolean) => {
      const body: any = { entityType, fileName, commit };
      if (xlsxBase64) body.xlsxBase64 = xlsxBase64;
      else body.csv = csvText;
      const res = await apiRequest("POST", "/api/org/imports", body);
      return res.json() as Promise<ImportPreviewResult>;
    },
    onSuccess: (data, commit) => {
      setDryRun(data);
      if (commit) {
        toast({ title: "Import complete", description: `Inserted ${data.insertedRows ?? 0} rows.` });
        setCsvText(""); setFileName(""); setDryRun(null);
        queryClient.invalidateQueries({ queryKey: ["/api/org/imports"] });
      } else {
        toast({ title: "Dry run complete", description: `${data.validRows}/${data.totalRows} rows valid` });
      }
    },
    onError: (e: any) => toast({ title: "Import failed", description: e?.message ?? "Unknown error", variant: "destructive" }),
  });

  const history = useQuery<any[]>({ queryKey: ["/api/org/imports"] });

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    setFileName(f.name);
    setDryRun(null);
    const isExcel = /\.(xlsx|xls)$/i.test(f.name);
    const reader = new FileReader();
    if (isExcel) {
      reader.onload = () => {
        // ArrayBuffer → base64
        const bytes = new Uint8Array(reader.result as ArrayBuffer);
        let bin = "";
        for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
        setXlsxBase64(btoa(bin));
        setCsvText("");
      };
      reader.readAsArrayBuffer(f);
    } else {
      reader.onload = () => { setCsvText(String(reader.result ?? "")); setXlsxBase64(""); };
      reader.readAsText(f);
    }
  };

  const downloadTemplate = () => {
    window.location.href = `/api/org/imports/templates/${entityType}.csv`;
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Upload className="w-5 h-5" /> CSV Import</CardTitle>
          <CardDescription>Upload a CSV to bulk-import. Run a dry-run first to preview validation errors per row before committing.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="entity-type">Data type</Label>
              <Select value={entityType} onValueChange={(v) => { setEntityType(v); setDryRun(null); }}>
                <SelectTrigger id="entity-type" data-testid="select-import-entity"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ENTITY_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value} data-testid={`option-entity-${o.value}`}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2 flex gap-2 items-end">
              <Button variant="outline" onClick={downloadTemplate} data-testid="button-download-template">
                <FileDown className="w-4 h-4 mr-1" /> Download template
              </Button>
              <Button variant="outline" onClick={() => fileRef.current?.click()} data-testid="button-pick-csv">
                <Upload className="w-4 h-4 mr-1" /> Choose CSV
              </Button>
              <input ref={fileRef} type="file" accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" className="hidden" onChange={onPickFile} data-testid="input-csv-file" />
              {fileName && <span className="text-sm text-muted-foreground" data-testid="text-csv-filename">{fileName}</span>}
            </div>
          </div>

          <div>
            <Label htmlFor="csv-text">Or paste CSV</Label>
            <Textarea id="csv-text" value={csvText} onChange={(e) => { setCsvText(e.target.value); setDryRun(null); }}
              rows={8} placeholder="header1,header2,..." className="font-mono text-xs" data-testid="textarea-csv" />
          </div>

          <div className="flex gap-2">
            <Button onClick={() => importMutation.mutate(false)} disabled={(!csvText && !xlsxBase64) || importMutation.isPending} data-testid="button-dry-run">
              {importMutation.isPending && !importMutation.variables ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
              Dry run
            </Button>
            <Button variant="default" onClick={() => importMutation.mutate(true)} disabled={!dryRun || (dryRun.errorRows ?? 0) > 0 || importMutation.isPending} data-testid="button-commit-import">
              {importMutation.isPending && importMutation.variables ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
              Commit import
            </Button>
          </div>

          {dryRun && (
            <Alert className="mt-2" data-testid="alert-dry-run-result">
              <AlertTitle className="flex items-center gap-2">
                {dryRun.errorRows ? <AlertTriangle className="w-4 h-4 text-destructive" /> : <CheckCircle2 className="w-4 h-4 text-green-600" />}
                Dry run: {dryRun.validRows}/{dryRun.totalRows} rows valid
                {dryRun.errorRows ? <Badge variant="destructive" className="ml-2">{dryRun.errorRows} errors</Badge> : null}
              </AlertTitle>
              {dryRun.errors && dryRun.errors.length > 0 && (
                <AlertDescription>
                  <div className="max-h-48 overflow-auto mt-2 text-xs font-mono">
                    {dryRun.errors.slice(0, 100).map((e, i) => (
                      <div key={i} data-testid={`error-row-${i}`}>row {e.row}{e.field ? ` · ${e.field}` : ""}: {e.message}</div>
                    ))}
                  </div>
                  {dryRun.jobId && (
                    <Button variant="outline" size="sm" className="mt-3" asChild data-testid="button-download-error-report">
                      <a href={`/api/org/imports/${dryRun.jobId}/errors.csv`}>
                        <FileDown className="w-3 h-3 mr-1" /> Download error report (CSV)
                      </a>
                    </Button>
                  )}
                </AlertDescription>
              )}
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Recent imports</CardTitle></CardHeader>
        <CardContent>
          {history.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
            <div className="space-y-2">
              {(history.data ?? []).map((row) => (
                <div key={row.id} className="flex items-center justify-between border rounded-md p-2 text-sm" data-testid={`row-import-${row.id}`}>
                  <div>
                    <div className="font-medium">{row.entityType} <Badge variant="outline" className="ml-2">{row.status}</Badge></div>
                    <div className="text-xs text-muted-foreground">{row.fileName ?? "(pasted)"} · {new Date(row.createdAt).toLocaleString()}</div>
                  </div>
                  <div className="text-xs text-right">
                    <div>{row.insertedRows} inserted / {row.totalRows} rows</div>
                    {row.errorRows > 0 && (
                      <>
                        <div className="text-destructive">{row.errorRows} errors</div>
                        <a href={`/api/org/imports/${row.id}/errors.csv`} className="text-xs underline" data-testid={`link-error-report-${row.id}`}>
                          download error report
                        </a>
                      </>
                    )}
                  </div>
                </div>
              ))}
              {(history.data ?? []).length === 0 && <div className="text-sm text-muted-foreground" data-testid="text-no-imports">No imports yet.</div>}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ExportTab() {
  const { toast } = useToast();
  const exports = useQuery<any[]>({ queryKey: ["/api/org/exports"], refetchInterval: (q) => (q.state.data ?? []).some((r: any) => r.status === "PENDING") ? 3000 : false });
  const startExport = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/org/exports", {});
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Export queued", description: "We'll email you a download link when it's ready." });
      queryClient.invalidateQueries({ queryKey: ["/api/org/exports"] });
    },
    onError: (e: any) => toast({ title: "Export failed", description: e?.message ?? "Unknown error", variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Download className="w-5 h-5" /> Export my organization</CardTitle>
          <CardDescription>One-click export of all your organization data as a ZIP of CSVs. We'll email you a 24-hour download link when the job finishes.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => startExport.mutate()} disabled={startExport.isPending} data-testid="button-start-export">
            {startExport.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Download className="w-4 h-4 mr-1" />}
            Start export
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Recent exports</CardTitle></CardHeader>
        <CardContent>
          {exports.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
            <div className="space-y-2">
              {(exports.data ?? []).map((row) => (
                <div key={row.id} className="flex items-center justify-between border rounded-md p-2 text-sm" data-testid={`row-export-${row.id}`}>
                  <div>
                    <div className="font-medium">Export <Badge variant="outline" className="ml-2">{row.status}</Badge></div>
                    <div className="text-xs text-muted-foreground">{new Date(row.createdAt).toLocaleString()}{row.bytes ? ` · ${(row.bytes / 1024 / 1024).toFixed(2)} MB` : ""}</div>
                    {row.errorMessage && <div className="text-xs text-destructive">{row.errorMessage}</div>}
                  </div>
                  {row.status === "COMPLETED" && (
                    <Button asChild variant="outline" size="sm" data-testid={`link-download-export-${row.id}`}>
                      <a href={`/api/org/exports/${row.id}`} onClick={async (e) => {
                        e.preventDefault();
                        const r = await fetch(`/api/org/exports/${row.id}`); const j = await r.json();
                        if (j.downloadUrl) window.location.href = j.downloadUrl;
                      }}>
                        <Download className="w-3 h-3 mr-1" /> Download
                      </a>
                    </Button>
                  )}
                </div>
              ))}
              {(exports.data ?? []).length === 0 && <div className="text-sm text-muted-foreground" data-testid="text-no-exports">No exports yet.</div>}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DeleteTab() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [confirmEmail, setConfirmEmail] = useState("");
  const [reason, setReason] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);

  const status = useQuery<any | null>({ queryKey: ["/api/org/deletion-request"] });

  const requestMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/org/deletion-request", { confirmEmail, reason })).json(),
    onSuccess: () => {
      toast({ title: "Confirmation email sent", description: `Check ${confirmEmail} to confirm deletion.` });
      queryClient.invalidateQueries({ queryKey: ["/api/org/deletion-request"] });
    },
    onError: (e: any) => toast({ title: "Request failed", description: e?.message ?? "Unknown error", variant: "destructive" }),
  });

  const cancelMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/org/deletion-request/cancel", {})).json(),
    onSuccess: () => {
      toast({ title: "Deletion cancelled" });
      queryClient.invalidateQueries({ queryKey: ["/api/org/deletion-request"] });
    },
  });

  const existing = status.data;
  const isPending = existing && (existing.status === "AWAITING_CONFIRMATION" || existing.status === "SCHEDULED_HARD_DELETE");

  return (
    <div className="space-y-6">
      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive"><Trash2 className="w-5 h-5" /> Delete organization</CardTitle>
          <CardDescription>Soft-deletes your organization immediately upon email confirmation. All data is permanently destroyed 30 days later. We strongly recommend running an export first.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isPending && existing ? (
            <Alert variant="destructive" data-testid="alert-deletion-pending">
              <AlertTriangle className="w-4 h-4" />
              <AlertTitle>Deletion {existing.status === "SCHEDULED_HARD_DELETE" ? "scheduled" : "awaiting confirmation"}</AlertTitle>
              <AlertDescription>
                {existing.status === "AWAITING_CONFIRMATION" && <>Confirmation sent to <strong>{existing.confirmationSentTo}</strong> on {new Date(existing.createdAt).toLocaleString()}. Link expires after 24 hours.</>}
                {existing.status === "SCHEDULED_HARD_DELETE" && <>Hard-delete scheduled for <strong>{new Date(existing.hardDeleteScheduledAt).toLocaleString()}</strong>.</>}
                <div className="mt-3">
                  <Button variant="outline" onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending} data-testid="button-cancel-deletion">
                    {cancelMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
                    Cancel deletion
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <div>
                <Label htmlFor="confirm-email">Type your account email to confirm</Label>
                <Input id="confirm-email" value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} placeholder={user?.email ?? "you@example.com"} data-testid="input-confirm-email" />
              </div>
              <div>
                <Label htmlFor="delete-reason">Reason (optional, helps us improve)</Label>
                <Textarea id="delete-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} data-testid="textarea-delete-reason" />
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} data-testid="checkbox-acknowledge" />
                <span>I understand my organization will be soft-deleted upon email confirmation and permanently destroyed after 30 days. This is irreversible.</span>
              </label>
              <Button variant="destructive" disabled={!confirmEmail || !acknowledged || requestMutation.isPending} onClick={() => requestMutation.mutate()} data-testid="button-request-deletion">
                {requestMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Trash2 className="w-4 h-4 mr-1" />}
                Send confirmation email
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function DataManagementPage() {
  return (
    <div className="container max-w-5xl mx-auto py-8 px-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold" data-testid="heading-data-management">Data Management</h1>
        <p className="text-sm text-muted-foreground">Import, export, and lifecycle controls for your organization's data.</p>
      </div>
      <Tabs defaultValue="import" className="space-y-4">
        <TabsList>
          <TabsTrigger value="import" data-testid="tab-import"><Upload className="w-4 h-4 mr-1" /> Import</TabsTrigger>
          <TabsTrigger value="export" data-testid="tab-export"><Download className="w-4 h-4 mr-1" /> Export</TabsTrigger>
          <TabsTrigger value="delete" data-testid="tab-delete"><Trash2 className="w-4 h-4 mr-1" /> Delete org</TabsTrigger>
        </TabsList>
        <TabsContent value="import"><ImportTab /></TabsContent>
        <TabsContent value="export"><ExportTab /></TabsContent>
        <TabsContent value="delete"><DeleteTab /></TabsContent>
      </Tabs>
    </div>
  );
}
