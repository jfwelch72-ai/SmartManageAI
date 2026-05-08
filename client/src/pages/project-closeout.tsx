import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Download, RefreshCw, Sparkles, FileDown, Plus, Trash2, FileText,
  CheckCircle2, AlertCircle, Loader2,
} from "lucide-react";

type CloseoutItem = {
  id: string;
  category: string;
  title: string;
  description: string | null;
  required: boolean;
  status: "PENDING" | "IN_PROGRESS" | "READY" | "COMPLETE" | "WAIVED";
  dueDate: string | null;
  notes: string | null;
  sortOrder: number;
  sources: Array<{ type: string; refId?: string; label: string; url?: string }> | null;
  attachments: Array<{ url: string; filename: string }> | null;
};

type CloseoutChecklist = { id: string; projectId: string; templateId: string | null; name: string };

type CloseoutPackage = {
  id: string; status: "BUILDING" | "READY" | "FAILED"; filename: string;
  fileSize: number | null; itemCount: number; fileCount: number;
  generatedAt: string; errorMessage: string | null;
};

type GetResp = { checklist: CloseoutChecklist | null; items: CloseoutItem[]; packages: CloseoutPackage[] };

const CATEGORY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "OM_MANUAL", label: "O&M Manual" },
  { value: "WARRANTY", label: "Warranty" },
  { value: "AS_BUILT", label: "As-Built" },
  { value: "ATTIC_STOCK", label: "Attic Stock" },
  { value: "TRAINING", label: "Training" },
  { value: "LIEN_RELEASE", label: "Lien Release" },
  { value: "FINAL_COI", label: "Final COI" },
  { value: "PUNCH_LIST", label: "Punch List" },
  { value: "INSPECTION", label: "Inspection" },
  { value: "PERMIT", label: "Permit" },
  { value: "OTHER", label: "Other" },
];

const STATUS_BADGES: Record<string, string> = {
  PENDING: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200",
  IN_PROGRESS: "bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-100",
  READY: "bg-blue-200 text-blue-900 dark:bg-blue-900 dark:text-blue-100",
  COMPLETE: "bg-emerald-200 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100",
  WAIVED: "bg-purple-200 text-purple-900 dark:bg-purple-900 dark:text-purple-100",
};

export default function ProjectCloseoutPage({ projectCode }: { projectCode?: string } = {}) {
  const params = useParams<{ code: string }>();
  const code = projectCode ?? params.code;
  const { toast } = useToast();

  const { data, isLoading } = useQuery<GetResp>({
    queryKey: ["/api/projects", code, "closeout"],
    enabled: !!code,
  });
  const { data: summary } = useQuery<{
    hasChecklist: boolean; total: number; complete: number; ready: number;
    pending: number; overdue: number; percent: number;
    byCategory: Array<{ category: string; total: number; complete: number }>;
  }>({
    queryKey: ["/api/projects", code, "closeout", "summary"],
    enabled: !!code,
  });

  const initMut = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/projects/${code}/closeout/init`, {}),
    onSuccess: () => {
      toast({ title: "Closeout checklist initialized" });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", code, "closeout"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", code, "closeout", "summary"] });
    },
    onError: (e: Error) => toast({ title: "Failed to initialize", description: e.message, variant: "destructive" }),
  });

  const autoPullMut = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/projects/${code}/closeout/auto-pull`, {}),
    onSuccess: async (res) => {
      const body = await res.json();
      toast({ title: "Auto-pull complete", description: `Refreshed ${body.updatedCount ?? 0} items from project artifacts.` });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", code, "closeout"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", code, "closeout", "summary"] });
    },
    onError: (e: Error) => toast({ title: "Auto-pull failed", description: e.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<CloseoutItem> }) =>
      apiRequest("PATCH", `/api/projects/${code}/closeout/items/${id}`, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", code, "closeout"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", code, "closeout", "summary"] });
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/projects/${code}/closeout/items/${id}`),
    onSuccess: () => {
      toast({ title: "Item removed" });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", code, "closeout"] });
    },
  });

  const handleExport = async () => {
    try {
      toast({ title: "Building closeout package…", description: "Verifying and storing the package before delivery." });
      const res = await apiRequest("POST", `/api/projects/${code}/closeout/export`, {});
      const body = (await res.json()) as {
        packageId: string;
        status: "READY";
        filename: string;
        downloadUrl: string | null;
        downloadEndpoint: string;
      };
      // Prefer the freshly minted signed URL; fall back to our authenticated
      // re-mint endpoint if the signed URL could not be issued.
      const target = body.downloadUrl ?? body.downloadEndpoint;
      // Use a hidden anchor so the browser handles the download / 302.
      const a = document.createElement("a");
      a.href = target;
      a.rel = "noopener";
      // Only force `download=` on same-origin endpoint; signed GCS URLs
      // already advertise the right Content-Disposition.
      if (!body.downloadUrl) a.download = body.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast({ title: "Closeout package ready", description: body.filename });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", code, "closeout"] });
    } catch (e) {
      toast({ title: "Export failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  if (isLoading) {
    return (
      <div className="p-8 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading closeout…
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6 max-w-7xl mx-auto" data-testid="page-project-closeout">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <Link
            href={`/projects/${code}`}
            className="text-sm text-muted-foreground hover:underline flex items-center gap-1"
            data-testid="link-back-to-project"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to project
          </Link>
          <h1 className="text-2xl font-bold mt-1">Project Closeout</h1>
          <p className="text-sm text-muted-foreground">
            Track all closeout deliverables, auto-pull from project artifacts, and generate the final ZIP package with table of contents.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {!data?.checklist ? (
            <Button onClick={() => initMut.mutate()} disabled={initMut.isPending} data-testid="button-init-closeout">
              {initMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
              Initialize Closeout
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => autoPullMut.mutate()}
                disabled={autoPullMut.isPending}
                data-testid="button-auto-pull"
              >
                {autoPullMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                Auto-pull artifacts
              </Button>
              <Button
                variant="outline"
                asChild
                data-testid="button-export-pdf"
              >
                <a
                  href={`/api/projects/${code}/closeout/export/pdf`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <FileDown className="h-4 w-4 mr-2" /> Print TOC
                </a>
              </Button>
              <Button onClick={handleExport} data-testid="button-export-zip">
                <Download className="h-4 w-4 mr-2" /> Generate ZIP package
              </Button>
            </>
          )}
        </div>
      </div>

      {summary && summary.hasChecklist && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <SummaryStat label="Total" value={summary.total} testid="stat-total" />
          <SummaryStat label="Complete" value={summary.complete} tone="success" testid="stat-complete" />
          <SummaryStat label="Ready" value={summary.ready} tone="info" testid="stat-ready" />
          <SummaryStat label="Pending" value={summary.pending} testid="stat-pending" />
          <SummaryStat label="Overdue" value={summary.overdue} tone={summary.overdue > 0 ? "danger" : undefined} testid="stat-overdue" />
        </div>
      )}

      {summary && summary.hasChecklist && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4" /> Overall completion
            </CardTitle>
            <CardDescription>{summary.percent}% of all closeout items complete or waived</CardDescription>
          </CardHeader>
          <CardContent>
            <Progress value={summary.percent} className="h-3" data-testid="progress-overall" />
          </CardContent>
        </Card>
      )}

      {!data?.checklist ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground space-y-3">
            <FileText className="h-10 w-10 mx-auto text-muted-foreground/50" />
            <p>No closeout checklist exists for this project yet.</p>
            <p className="text-sm">Click <strong>Initialize Closeout</strong> to start with the standard template (O&amp;M, warranties, lien releases, as-builts, punch list, permits, etc.).</p>
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue="items">
          <TabsList>
            <TabsTrigger value="items" data-testid="tab-items">Checklist items</TabsTrigger>
            <TabsTrigger value="packages" data-testid="tab-packages">Generated packages</TabsTrigger>
          </TabsList>
          <TabsContent value="items" className="mt-4">
            <ItemsTable
              items={data.items}
              onUpdate={(id, patch) => updateMut.mutate({ id, patch })}
              onDelete={(id) => deleteMut.mutate(id)}
            />
            <div className="mt-4">
              <NewItemDialog projectCode={code!} />
            </div>
          </TabsContent>
          <TabsContent value="packages" className="mt-4">
            <PackagesTable packages={data.packages} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function SummaryStat({ label, value, tone, testid }: { label: string; value: number; tone?: "success" | "info" | "danger"; testid: string }) {
  const colour =
    tone === "success" ? "text-emerald-600 dark:text-emerald-400" :
    tone === "info" ? "text-blue-600 dark:text-blue-400" :
    tone === "danger" ? "text-red-600 dark:text-red-400" :
    "text-foreground";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
        <div className={`text-2xl font-bold mt-1 ${colour}`} data-testid={testid}>{value}</div>
      </CardContent>
    </Card>
  );
}

function ItemsTable({
  items, onUpdate, onDelete,
}: {
  items: CloseoutItem[];
  onUpdate: (id: string, patch: Partial<CloseoutItem>) => void;
  onDelete: (id: string) => void;
}) {
  if (!items.length) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          No items yet. Initialize from a template or add one below.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <Table data-testid="table-closeout-items">
        <TableHeader>
          <TableRow>
            <TableHead>Category</TableHead>
            <TableHead>Item</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Sources</TableHead>
            <TableHead className="w-[140px]"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((it) => (
            <TableRow key={it.id} data-testid={`row-closeout-item-${it.id}`}>
              <TableCell>
                <Badge variant="outline" className="text-[10px]" data-testid={`badge-category-${it.id}`}>
                  {CATEGORY_OPTIONS.find((c) => c.value === it.category)?.label ?? it.category}
                </Badge>
              </TableCell>
              <TableCell>
                <div className="font-medium" data-testid={`text-title-${it.id}`}>{it.title}</div>
                {it.description && <div className="text-xs text-muted-foreground">{it.description}</div>}
                {it.notes && <div className="text-xs italic text-muted-foreground mt-1">{it.notes}</div>}
              </TableCell>
              <TableCell>
                <Select value={it.status} onValueChange={(v) => onUpdate(it.id, { status: v as CloseoutItem["status"] })}>
                  <SelectTrigger className="h-8 w-[140px]" data-testid={`select-status-${it.id}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["PENDING", "IN_PROGRESS", "READY", "COMPLETE", "WAIVED"] as const).map((s) => (
                      <SelectItem key={s} value={s}>
                        <span className={`px-2 py-0.5 rounded text-xs ${STATUS_BADGES[s]}`}>{s}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                {it.sources && it.sources.length > 0 ? (
                  <div className="space-y-1 text-xs" data-testid={`sources-${it.id}`}>
                    {it.sources.slice(0, 3).map((s, i) => (
                      <div key={i} className="flex items-center gap-1 text-muted-foreground">
                        <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                        <span className="truncate max-w-[280px]">{s.label}</span>
                      </div>
                    ))}
                    {it.sources.length > 3 && (
                      <div className="text-[10px] text-muted-foreground">+{it.sources.length - 3} more</div>
                    )}
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" /> No sources
                  </span>
                )}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onDelete(it.id)}
                  data-testid={`button-delete-${it.id}`}
                >
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function PackagesTable({ packages }: { packages: CloseoutPackage[] }) {
  if (!packages.length) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          No packages have been generated yet. Click <strong>Generate ZIP package</strong> above.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <Table data-testid="table-closeout-packages">
        <TableHeader>
          <TableRow>
            <TableHead>Filename</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Items</TableHead>
            <TableHead>Files</TableHead>
            <TableHead>Size</TableHead>
            <TableHead>Generated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {packages.map((p) => (
            <TableRow key={p.id} data-testid={`row-package-${p.id}`}>
              <TableCell className="font-mono text-xs">{p.filename}</TableCell>
              <TableCell>
                <Badge variant={p.status === "READY" ? "default" : p.status === "FAILED" ? "destructive" : "secondary"}>
                  {p.status}
                </Badge>
              </TableCell>
              <TableCell>{p.itemCount}</TableCell>
              <TableCell>{p.fileCount}</TableCell>
              <TableCell>{p.fileSize ? `${(p.fileSize / 1024 / 1024).toFixed(2)} MB` : "—"}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{new Date(p.generatedAt).toLocaleString()}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function NewItemDialog({ projectCode }: { projectCode: string }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ category: "OTHER", title: "", description: "", required: true });
  const { toast } = useToast();
  const m = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/projects/${projectCode}/closeout/items`, form),
    onSuccess: () => {
      toast({ title: "Item added" });
      setOpen(false);
      setForm({ category: "OTHER", title: "", description: "", required: true });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "closeout"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "closeout", "summary"] });
    },
    onError: (e: Error) => toast({ title: "Failed to add item", description: e.message, variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" data-testid="button-add-closeout-item">
          <Plus className="h-4 w-4 mr-2" /> Add custom item
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add closeout item</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Category</Label>
            <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
              <SelectTrigger data-testid="select-new-category"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORY_OPTIONS.map((c) => (<SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Title</Label>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="input-new-title" />
          </div>
          <div>
            <Label>Description</Label>
            <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="textarea-new-description" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => m.mutate()} disabled={!form.title || m.isPending} data-testid="button-save-new-item">
            {m.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null} Save item
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
