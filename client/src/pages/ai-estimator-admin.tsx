import { useState, useEffect, Fragment } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Loader2, RefreshCcw, Database, Sparkles, AlertTriangle,
  ChevronDown, ChevronRight, Download, X, Ban, RotateCcw,
  Info, AlertCircle, CheckCircle2, TrendingUp, Settings, Plus, Trash2,
  HelpCircle, Layers, Pencil, BookOpen, Wand2, ArrowUp, ArrowDown
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

interface AccessRow {
  userId: string;
  name: string;
  email: string;
  role: string;
  enabled: boolean;
  canTrain: boolean;
  enabledAt: string | null;
}

interface IngestRun {
  id: string;
  startedAt: string;
  completedAt: string | null;
  status: string;
  bidsIngested: number;
  estimatesIngested: number;
  lineItemsIngested: number;
  takeoffsIngested: number;
  costPostingsIngested: number;
  ratesUpdated: number;
  triggerType: string;
  errorMessage: string | null;
}

interface LearnedRate {
  id: string;
  costCode: string;
  metric: string;
  unit: string;
  sampleSize: number;
  mean: string | null;
  median: string | null;
  p25: string | null;
  p75: string | null;
  confidence: "Strong" | "Mixed" | "Sparse";
  excludedSampleCount: number;
  sampleCount: number;
  lastUpdatedAt: string;
}

interface RateSample {
  id: string;
  value: string;
  sourceType: string;
  sourceRowId: string | null;
  projectId: string | null;
  bidId: string | null;
  recordedAt: string;
  project: { id: string; name: string; code: string } | null;
  bid: { id: string; name: string; code: string } | null;
  // Task #2453 — populated for `library_assignment` rows so the drill-down
  // can show the contributing standalone takeoff.
  standaloneTakeoff: { id: string; title: string } | null;
}

interface ExcludedSource {
  id: string;
  projectId: string | null;
  bidId: string | null;
  reason: string | null;
  excludedAt: string;
  project: { id: string; name: string; code: string } | null;
  bid: { id: string; name: string; code: string } | null;
  excludedBy: { id: string; firstName: string; lastName: string; email: string } | null;
}

interface FeedbackRow {
  id: string;
  createdAt: string;
  surface: string;
  outcome: string;
  costCode: string | null;
  comment: string | null;
}

interface OrgFactors {
  organizationId: string;
  excludeCancelledLostJobs: boolean;
  cityCostIndexDefault?: string | number | null;
  laborProductivityDefault?: string | number | null;
  wasteFactorDefault?: string | number | null;
  notes?: string | null;
}

interface RegionFactor {
  id: string;
  name: string;
  regionType: string;
  code: string | null;
  multiplier: number;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
interface FeedbackStats {
  totalEvents: number;
  acceptanceRate: number | null;
  bySurface: Record<string, { ACCEPTED: number; EDITED: number; REJECTED: number; THUMBS_UP: number; THUMBS_DOWN: number }>;
}

function ConfidenceChip({ confidence, sampleSize }: { confidence: string; sampleSize: number }) {
  if (confidence === "Strong") {
    return (
      <Badge variant="default" className="gap-1" data-testid="chip-confidence-strong">
        <CheckCircle2 className="h-3 w-3" /> Strong
      </Badge>
    );
  }
  if (confidence === "Mixed") {
    return (
      <Badge variant="secondary" className="gap-1" data-testid="chip-confidence-mixed">
        <TrendingUp className="h-3 w-3" /> Mixed
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 text-amber-600 border-amber-300" data-testid="chip-confidence-sparse">
      <AlertCircle className="h-3 w-3" /> Sparse
    </Badge>
  );
}

function ExcludeProjectDialog({
  projectId,
  projectName,
  open,
  onClose,
  onExclude,
}: {
  projectId: string;
  projectName: string;
  open: boolean;
  onClose: () => void;
  onExclude: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Exclude project from learning</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          This will remove all samples from <strong>{projectName}</strong> from the rate pool and recompute affected rates immediately. Future samples from this project will also be skipped.
        </p>
        <div className="space-y-2">
          <Label>Reason (optional)</Label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Money-losing job with atypical scope"
            rows={3}
            data-testid="input-exclude-reason"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-exclude-cancel">Cancel</Button>
          <Button variant="destructive" onClick={() => onExclude(reason)} data-testid="button-exclude-confirm">
            <Ban className="h-4 w-4 mr-2" /> Exclude project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SamplesDrawer({
  rate,
  open,
  onClose,
  excludedProjectIds,
  onExcludeProject,
}: {
  rate: LearnedRate | null;
  open: boolean;
  onClose: () => void;
  excludedProjectIds: Set<string>;
  onExcludeProject: (projectId: string, projectName: string) => void;
}) {
  const [page, setPage] = useState(0);
  const limit = 50;
  const offset = page * limit;

  useEffect(() => { setPage(0); }, [rate?.id]);

  const samplesUrl = rate ? `/api/ai-estimator/admin/learned-rates/${rate.id}/samples?offset=${offset}&limit=${limit}` : null;

  const samplesQuery = useQuery<{ samples: RateSample[]; total: number; limit: number; offset: number }>({
    queryKey: [samplesUrl],
    enabled: !!rate && open && !!samplesUrl,
  });

  if (!rate) return null;

  const samples = samplesQuery.data?.samples ?? [];
  const total = samplesQuery.data?.total ?? 0;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:w-[640px] max-w-full overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-mono text-base">{rate.costCode}</SheetTitle>
          <SheetDescription>
            {rate.metric} / {rate.unit} &middot; {total} sample{total !== 1 ? "s" : ""}
            {rate.excludedSampleCount > 0 && (
              <span className="text-amber-600 ml-2">({rate.excludedSampleCount} excluded)</span>
            )}
          </SheetDescription>
        </SheetHeader>

        {rate.excludedSampleCount > 0 && (
          <div className="mt-4 flex items-start gap-2 p-3 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-sm">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>This rate excludes {rate.excludedSampleCount} sample{rate.excludedSampleCount !== 1 ? "s" : ""} from {rate.excludedSampleCount === 1 ? "1 excluded project" : "excluded projects"}.</span>
          </div>
        )}

        <div className="mt-4 mb-2 flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            Showing {Math.min(page * limit + 1, total)}–{Math.min((page + 1) * limit, total)} of {total}
          </div>
          <a
            href={`/api/ai-estimator/admin/learned-rates/${rate.id}/samples/export.csv`}
            className="flex items-center gap-1 text-xs text-primary hover:underline"
            data-testid="link-export-samples-csv"
          >
            <Download className="h-3 w-3" /> Export CSV
          </a>
        </div>

        {samplesQuery.isLoading ? (
          <Loader2 className="animate-spin h-5 w-5 mt-4" />
        ) : (
          <div className="space-y-2">
            {samples.map((s) => {
              const isExcluded = s.projectId ? excludedProjectIds.has(s.projectId) : false;
              return (
                <div
                  key={s.id}
                  className={`rounded-md border p-3 text-sm ${isExcluded ? "opacity-50 bg-muted" : ""}`}
                  data-testid={`sample-row-${s.id}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-0.5">
                      <div className="font-medium">{Number(s.value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</div>
                      <div className="text-xs text-muted-foreground">
                        <Badge variant="outline" className="text-[10px] mr-1">{s.sourceType.replace(/_/g, " ")}</Badge>
                        {s.standaloneTakeoff ? (
                          <span>
                            Standalone takeoff:{" "}
                            <a
                              href={`/takeoff/standalone/${s.standaloneTakeoff.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-semibold hover:underline"
                              data-testid={`link-sample-standalone-takeoff-${s.standaloneTakeoff.id}`}
                            >
                              {s.standaloneTakeoff.title}
                            </a>
                            {s.project ? (
                              <span> &middot; Project: <strong>{s.project.name}</strong> ({s.project.code})</span>
                            ) : s.bid ? (
                              <span> &middot; Bid: <strong>{s.bid.name}</strong> ({s.bid.code})</span>
                            ) : null}
                          </span>
                        ) : s.project ? (
                          <span>Project: <strong>{s.project.name}</strong> ({s.project.code})</span>
                        ) : s.bid ? (
                          <span>Bid: <strong>{s.bid.name}</strong> ({s.bid.code})</span>
                        ) : (
                          <span className="italic">No source link (legacy)</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">{new Date(s.recordedAt).toLocaleDateString()}</div>
                    </div>
                    {s.projectId && !isExcluded && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0 text-destructive border-destructive hover:bg-destructive hover:text-destructive-foreground"
                        onClick={() => onExcludeProject(s.projectId!, s.project?.name ?? s.projectId!)}
                        data-testid={`button-exclude-project-${s.projectId}`}
                      >
                        <Ban className="h-3 w-3 mr-1" /> Exclude
                      </Button>
                    )}
                    {s.projectId && isExcluded && (
                      <Badge variant="destructive" className="text-[10px] shrink-0">Excluded</Badge>
                    )}
                  </div>
                </div>
              );
            })}
            {samples.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">No samples recorded yet. Run training to populate provenance.</p>
            )}
          </div>
        )}

        {total > limit && (
          <div className="flex gap-2 mt-4 justify-center">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)} data-testid="button-samples-prev">Previous</Button>
            <Button variant="outline" size="sm" disabled={(page + 1) * limit >= total} onClick={() => setPage((p) => p + 1)} data-testid="button-samples-next">Next</Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}


// ======
// Task #2624 — Assemblies catalog management. CRUD over the
// `/api/ai-estimator/assemblies` endpoints. Each assembly has a header
// (name, costCode, tradeType, drivingMeasurementType, drivingUnit,
// wasteFactor) and an ordered list of components (description,
// componentType, qtyPerDrivingUnit, unit, defaultUnitCost, wasteFactor).
// ======
interface AssemblyComponentRow {
  id?: string;
  componentType: "MATERIAL" | "LABOR" | "EQUIPMENT" | "SUB";
  description: string;
  costCode?: string | null;
  qtyPerDrivingUnit: number;
  unit: string;
  defaultUnitCost?: string | null;
  wasteFactor: number;
  sortOrder: number;
}
interface AssemblyRow {
  id: string;
  name: string;
  description: string | null;
  costCode: string | null;
  tradeType: string | null;
  drivingMeasurementType: string;
  drivingUnit: string;
  wasteFactor: number;
  isActive: boolean;
  components: AssemblyComponentRow[];
}

const EMPTY_ASSEMBLY = {
  name: "",
  description: "",
  costCode: "",
  tradeType: "",
  drivingMeasurementType: "AREA",
  drivingUnit: "SF",
  wasteFactor: 0,
  isActive: true,
};

function AssembliesTab() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<AssemblyRow | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const assembliesQuery = useQuery<{ assemblies: AssemblyRow[] }>({
    queryKey: ["/api/ai-estimator/assemblies", { search }],
    queryFn: async () => {
      const url = search.trim()
        ? `/api/ai-estimator/assemblies?search=${encodeURIComponent(search.trim())}`
        : "/api/ai-estimator/assemblies";
      const r = await apiRequest("GET", url);
      return (await r.json()) as { assemblies: AssemblyRow[] };
    },
  });

  const createOrUpdate = useMutation({
    mutationFn: async (vars: {
      id?: string;
      assembly: Record<string, unknown>;
      components: AssemblyComponentRow[];
    }) => {
      if (vars.id) {
        await apiRequest("PUT", `/api/ai-estimator/assemblies/${vars.id}`, vars.assembly);
        return { id: vars.id };
      }
      const r = await apiRequest("POST", "/api/ai-estimator/assemblies", {
        assembly: vars.assembly,
        components: vars.components.map((c) => ({
          componentType: c.componentType,
          description: c.description,
          costCode: c.costCode || null,
          qtyPerDrivingUnit: c.qtyPerDrivingUnit,
          unit: c.unit,
          defaultUnitCost: c.defaultUnitCost || null,
          wasteFactor: c.wasteFactor,
          sortOrder: c.sortOrder,
        })),
      });
      return (await r.json()) as { id: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-estimator/assemblies"] });
      toast({ title: "Assembly saved" });
      setEditorOpen(false);
      setEditing(null);
    },
    onError: (err: Error) =>
      toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) =>
      apiRequest("DELETE", `/api/ai-estimator/assemblies/${id}`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-estimator/assemblies"] });
      toast({ title: "Assembly deleted" });
    },
    onError: (err: Error) =>
      toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
  });

  const assemblies = assembliesQuery.data?.assemblies ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5" /> Assemblies catalog
            </CardTitle>
            <CardDescription>
              Define reusable bundles of materials, labor and equipment driven by a single
              takeoff measurement. The auto-takeoff drafter explodes matching AI-emitted
              lines into parent + component rows with org waste applied.
            </CardDescription>
          </div>
          <Button
            onClick={() => {
              setEditing({
                id: "",
                name: "",
                description: "",
                costCode: "",
                tradeType: "",
                drivingMeasurementType: "AREA",
                drivingUnit: "SF",
                wasteFactor: 0,
                isActive: true,
                components: [],
              });
              setEditorOpen(true);
            }}
            data-testid="button-new-assembly"
          >
            <Plus className="h-4 w-4 mr-2" /> New assembly
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2 mb-4">
          <Input
            placeholder="Search by name, description, or cost code"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
            data-testid="input-assembly-search"
          />
        </div>
        {assembliesQuery.isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : assemblies.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12" data-testid="text-no-assemblies">
            No assemblies yet. Create one to enable auto-explode in the takeoff drafter.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Trade</TableHead>
                <TableHead>Cost code</TableHead>
                <TableHead>Driver</TableHead>
                <TableHead className="text-right">Waste</TableHead>
                <TableHead className="text-right">Components</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assemblies.map((a) => (
                <TableRow key={a.id} data-testid={`row-assembly-${a.id}`}>
                  <TableCell className="font-medium">{a.name}</TableCell>
                  <TableCell>{a.tradeType ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{a.costCode ?? "—"}</TableCell>
                  <TableCell className="text-xs">
                    {a.drivingMeasurementType} / {a.drivingUnit}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {Math.round((Number(a.wasteFactor) || 0) * 100)}%
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{a.components.length}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => {
                          setEditing(a);
                          setEditorOpen(true);
                        }}
                        data-testid={`button-edit-assembly-${a.id}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => {
                          if (confirm(`Delete assembly "${a.name}"?`)) deleteMut.mutate(a.id);
                        }}
                        data-testid={`button-delete-assembly-${a.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {editing && (
        <AssemblyEditorDialog
          open={editorOpen}
          onClose={() => {
            setEditorOpen(false);
            setEditing(null);
          }}
          initial={editing}
          onSave={(assembly, components) =>
            createOrUpdate.mutate({
              id: editing.id || undefined,
              assembly,
              components,
            })
          }
          saving={createOrUpdate.isPending}
        />
      )}
    </Card>
  );
}

function AssemblyEditorDialog(props: {
  open: boolean;
  onClose: () => void;
  initial: AssemblyRow;
  onSave: (assembly: Record<string, unknown>, components: AssemblyComponentRow[]) => void;
  saving: boolean;
}) {
  const { initial } = props;
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description ?? "");
  const [costCode, setCostCode] = useState(initial.costCode ?? "");
  const [tradeType, setTradeType] = useState(initial.tradeType ?? "");
  const [drivingMeasurementType, setDrivingMeasurementType] = useState(initial.drivingMeasurementType);
  const [drivingUnit, setDrivingUnit] = useState(initial.drivingUnit);
  const [wasteFactor, setWasteFactor] = useState(Number(initial.wasteFactor) || 0);
  const [isActive, setIsActive] = useState(initial.isActive);
  const [components, setComponents] = useState<AssemblyComponentRow[]>(
    initial.components.map((c) => ({ ...c })),
  );
  const isEdit = !!initial.id;

  // Pre-existing breakage: the original render body for this dialog
  // was truncated mid-JSX in a prior merge (see git blame on this
  // file ahead of Task #2629). Replaced with a minimal-but-valid
  // form so the file compiles. Field-level editing of components
  // happens through the per-row endpoints; this dialog now just
  // captures the assembly metadata + a Save/Cancel pair so the
  // surrounding admin page keeps building. Rebuilding the full
  // editor UI is tracked separately.
  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit assembly" : "New assembly"}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="flex-1 pr-2">
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="col-span-2">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="input-assembly-name" />
            </div>
            <div className="col-span-2">
              <Label>Description</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                data-testid="input-assembly-description"
              />
            </div>
            <div>
              <Label>Cost code</Label>
              <Input value={costCode} onChange={(e) => setCostCode(e.target.value)} data-testid="input-assembly-costcode" />
            </div>
            <div>
              <Label>Trade type</Label>
              <Input value={tradeType} onChange={(e) => setTradeType(e.target.value)} data-testid="input-assembly-trade" />
            </div>
            <div>
              <Label>Driving measurement type</Label>
              <Select value={drivingMeasurementType} onValueChange={setDrivingMeasurementType}>
                <SelectTrigger data-testid="select-assembly-drivingtype"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="AREA">AREA</SelectItem>
                  <SelectItem value="LINEAR">LINEAR</SelectItem>
                  <SelectItem value="COUNT">COUNT</SelectItem>
                  <SelectItem value="VOLUME">VOLUME</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Driving unit</Label>
              <Input
                value={drivingUnit}
                onChange={(e) => setDrivingUnit(e.target.value)}
                data-testid="input-assembly-drivingunit"
              />
            </div>
            <div>
              <Label>Waste factor</Label>
              <Input
                type="number"
                step="0.01"
                value={wasteFactor}
                onChange={(e) => setWasteFactor(Number(e.target.value) || 0)}
                data-testid="input-assembly-wastefactor"
              />
            </div>
            <div className="col-span-2 flex items-center gap-2">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                data-testid="checkbox-assembly-active"
              />
              <Label>Active</Label>
            </div>
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" onClick={() => props.onClose()} data-testid="button-assembly-cancel">
            Cancel
          </Button>
          <Button
            onClick={() =>
              props.onSave(
                {
                  name,
                  description,
                  costCode,
                  tradeType,
                  drivingMeasurementType,
                  drivingUnit,
                  wasteFactor,
                  isActive,
                },
                components,
              )
            }
            disabled={props.saving}
            data-testid="button-assembly-save"
          >
            {props.saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SettingsTab() {
  const { toast } = useToast();
  const orgFactorsQuery = useQuery<OrgFactors | null>({ queryKey: ["/api/ai-estimator/org-factors"] });
  const regionsQuery = useQuery<{ regionFactors: RegionFactor[] }>({
    queryKey: ["/api/ai-estimator/region-factors", { includeArchived: true }],
    queryFn: async () => {
      const res = await fetch("/api/ai-estimator/region-factors?includeArchived=true", { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  const [excludeFilter, setExcludeFilter] = useState<boolean>(true);
  useEffect(() => {
    if (orgFactorsQuery.data) {
      setExcludeFilter(!!orgFactorsQuery.data.excludeCancelledLostJobs);
    }
  }, [orgFactorsQuery.data]);

  const saveOrgFactors = useMutation({
    mutationFn: async (vars: { excludeCancelledLostJobs: boolean }) =>
      apiRequest("PUT", "/api/ai-estimator/org-factors", vars),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-estimator/org-factors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai-estimator/admin/learned-rates"] });
      toast({ title: "Saved", description: "Quality filter updated; rates recompute on next training run." });
    },
    onError: (err: Error) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const [draft, setDraft] = useState<{ name: string; regionType: string; code: string; multiplier: string; notes: string }>({
    name: "",
    regionType: "METRO",
    code: "",
    multiplier: "1.00",
    notes: "",
  });

  const createRegion = useMutation({
    mutationFn: async () =>
      apiRequest("POST", "/api/ai-estimator/region-factors", {
        name: draft.name.trim(),
        regionType: draft.regionType,
        code: draft.code.trim() || null,
        multiplier: Number(draft.multiplier),
        notes: draft.notes.trim() || null,
        isActive: true,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-estimator/region-factors", { includeArchived: true }] });
      setDraft({ name: "", regionType: "METRO", code: "", multiplier: "1.00", notes: "" });
      toast({ title: "Region added" });
    },
    onError: (err: Error) => toast({ title: "Add failed", description: err.message, variant: "destructive" }),
  });

  const updateRegion = useMutation({
    mutationFn: async (vars: { id: string; patch: Partial<RegionFactor> }) =>
      apiRequest("PUT", `/api/ai-estimator/region-factors/${vars.id}`, vars.patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-estimator/region-factors", { includeArchived: true }] });
      toast({ title: "Region updated" });
    },
    onError: (err: Error) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const deleteRegion = useMutation({
    mutationFn: async (id: string) =>
      apiRequest("DELETE", `/api/ai-estimator/region-factors/${id}`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-estimator/region-factors", { includeArchived: true }] });
      toast({ title: "Region deleted" });
    },
    onError: (err: Error) => toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
  });

  const regions = regionsQuery.data?.regionFactors ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Sample quality filter</CardTitle>
          <CardDescription>
            Hide samples from bids you didn't win. Keeping these out of the rate pool
            stops Lost / Cancelled jobs from skewing your learned medians.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {orgFactorsQuery.isLoading ? (
            <Loader2 className="animate-spin h-5 w-5" />
          ) : (
            <div className="flex items-center justify-between gap-4 max-w-xl">
              <div>
                <Label htmlFor="exclude-lost">Exclude LOST &amp; CANCELLED bid samples</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Default: on. Disable if you specifically want losing bids to inform your learned rates.
                </p>
              </div>
              <Switch
                id="exclude-lost"
                checked={excludeFilter}
                onCheckedChange={(v) => {
                  setExcludeFilter(v);
                  saveOrgFactors.mutate({ excludeCancelledLostJobs: v });
                }}
                data-testid="switch-exclude-cancelled-lost"
              />
            </div>
          )}
        </CardContent>
      </Card>

      <CalibrationFeedbackLoopCard />

      <Card>
        <CardHeader>
          <CardTitle>Region factors</CardTitle>
          <CardDescription>
            Multiplier applied to learned-rate values when shown on a project tagged to that region.
            1.00 = no adjustment. A value of 1.25 means 25% more expensive than your default.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-6 gap-2 items-end" data-testid="form-region-create">
            <div className="sm:col-span-2">
              <Label>Name</Label>
              <Input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Bay Area Metro"
                data-testid="input-region-name"
              />
            </div>
            <div>
              <Label>Type</Label>
              <Select value={draft.regionType} onValueChange={(v) => setDraft({ ...draft, regionType: v })}>
                <SelectTrigger data-testid="select-region-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="METRO">Metro</SelectItem>
                  <SelectItem value="STATE">State</SelectItem>
                  <SelectItem value="CUSTOM">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Code</Label>
              <Input
                value={draft.code}
                onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                placeholder="SFO"
                data-testid="input-region-code"
              />
            </div>
            <div>
              <Label>Multiplier</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                value={draft.multiplier}
                onChange={(e) => setDraft({ ...draft, multiplier: e.target.value })}
                data-testid="input-region-multiplier"
              />
            </div>
            <Button
              onClick={() => createRegion.mutate()}
              disabled={createRegion.isPending || !draft.name.trim() || !(Number(draft.multiplier) > 0)}
              data-testid="button-region-add"
            >
              {createRegion.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
              Add
            </Button>
          </div>

          {regionsQuery.isLoading ? (
            <Loader2 className="animate-spin h-5 w-5" />
          ) : regions.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No region factors yet. Add one above to start adjusting learned rates by location.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Multiplier</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead className="w-[80px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {regions.map((r) => (
                  <TableRow key={r.id} data-testid={`row-region-${r.id}`}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell><Badge variant="outline">{r.regionType}</Badge></TableCell>
                    <TableCell className="font-mono text-xs">{r.code ?? "—"}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.01"
                        min="0.01"
                        defaultValue={r.multiplier}
                        className="w-24"
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (Number.isFinite(v) && v > 0 && v !== r.multiplier) {
                            updateRegion.mutate({ id: r.id, patch: { multiplier: v } });
                          }
                        }}
                        data-testid={`input-multiplier-${r.id}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={r.isActive}
                        onCheckedChange={(v) => updateRegion.mutate({ id: r.id, patch: { isActive: v } })}
                        data-testid={`switch-region-active-${r.id}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => deleteRegion.mutate(r.id)}
                        disabled={deleteRegion.isPending}
                        data-testid={`button-region-delete-${r.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <p className="text-xs text-muted-foreground">
            Assign a region to a project from its detail page. Inline suggestions
            on bids tied to that project will multiply learned medians by the
            region's multiplier and surface the math in the "Why this number?" expander.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}


interface CalibrationNudge {
  id: string;
  tradeType: string | null;
  metric: string;
  unit: string | null;
  suggestedFactor: number;
  basis: string;
  sampleSize: number;
  status: string;
  createdAt: string;
}

interface AccuracySnapshot {
  id: string;
  tradeType: string | null;
  windowStart: string;
  windowEnd: string;
  totalSuggestions: number;
  acceptedCount: number;
  editedCount: number;
  rejectedCount: number;
  acceptanceRate: number | null;
  mape: number | null;
}

function CalibrationFeedbackLoopCard() {
  const { toast } = useToast();
  const nudgesQuery = useQuery<{ nudges: CalibrationNudge[] }>({
    queryKey: ["/api/ai-estimator/calibration-nudges"],
  });
  const trendQuery = useQuery<{ snapshots: AccuracySnapshot[] }>({
    queryKey: ["/api/ai-estimator/accuracy-trend"],
  });
  const accept = useMutation({
    mutationFn: (id: string) =>
      apiRequest("POST", `/api/ai-estimator/calibration-nudges/${id}/accept`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-estimator/calibration-nudges"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai-estimator/org-factors"] });
      toast({ title: "Nudge accepted", description: "Calibration factor saved." });
    },
    onError: (e: unknown) => toast({ title: "Accept failed", description: String(e), variant: "destructive" }),
  });
  const reject = useMutation({
    mutationFn: (id: string) =>
      apiRequest("POST", `/api/ai-estimator/calibration-nudges/${id}/reject`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-estimator/calibration-nudges"] });
      toast({ title: "Nudge rejected" });
    },
  });
  const runAggregator = useMutation({
    mutationFn: () => apiRequest("POST", "/api/ai-estimator/calibration-aggregator/run", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-estimator/calibration-nudges"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai-estimator/accuracy-trend"] });
      toast({ title: "Aggregator triggered" });
    },
  });

  const nudges = nudgesQuery.data?.nudges ?? [];
  const snapshots = trendQuery.data?.snapshots ?? [];
  const overall = snapshots.filter((s) => s.tradeType === null).slice(0, 14);

  return (
    <Card data-testid="card-calibration-feedback-loop">
      <CardHeader>
        <CardTitle>AI takeoff calibration feedback loop</CardTitle>
        <CardDescription>
          Pending bias nudges learned from your team's recent suggestion reviews, plus a 14-day accuracy trend.
          Accepting a nudge writes a per-trade calibration factor that the next AI draft will respect.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Aggregator runs nightly at 04:00 UTC. Trigger manually if you just reviewed a batch.
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => runAggregator.mutate()}
            disabled={runAggregator.isPending}
            data-testid="button-run-calibration-aggregator"
          >
            {runAggregator.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCcw className="h-4 w-4 mr-1" />}
            Run now
          </Button>
        </div>

        <div>
          <div className="text-sm font-medium mb-2">Pending nudges ({nudges.length})</div>
          {nudgesQuery.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : nudges.length === 0 ? (
            <div className="text-sm text-muted-foreground" data-testid="text-no-pending-nudges">
              No pending nudges. The aggregator only proposes a nudge when ≥10 EDITED reviews show a consistent ±5%+ bias.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Trade</TableHead>
                  <TableHead>Metric</TableHead>
                  <TableHead>Factor</TableHead>
                  <TableHead>Sample</TableHead>
                  <TableHead>Basis</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {nudges.map((n) => (
                  <TableRow key={n.id} data-testid={`row-nudge-${n.id}`}>
                    <TableCell>{n.tradeType ?? "—"}</TableCell>
                    <TableCell>{n.metric}</TableCell>
                    <TableCell data-testid={`text-nudge-factor-${n.id}`}>{n.suggestedFactor.toFixed(3)}x</TableCell>
                    <TableCell>{n.sampleSize}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-md">{n.basis}</TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => accept.mutate(n.id)}
                        disabled={accept.isPending}
                        data-testid={`button-accept-nudge-${n.id}`}
                      >
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => reject.mutate(n.id)}
                        disabled={reject.isPending}
                        data-testid={`button-reject-nudge-${n.id}`}
                      >
                        Reject
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        <div>
          <div className="text-sm font-medium mb-2">Overall accuracy (last 14 snapshots)</div>
          {trendQuery.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : overall.length === 0 ? (
            <div className="text-sm text-muted-foreground">No accuracy snapshots yet — they appear after the aggregator's first run.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Window end</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Accepted</TableHead>
                  <TableHead>Edited</TableHead>
                  <TableHead>Rejected</TableHead>
                  <TableHead>Acceptance</TableHead>
                  <TableHead>MAPE</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overall.map((s) => (
                  <TableRow key={s.id} data-testid={`row-snapshot-${s.id}`}>
                    <TableCell>{new Date(s.windowEnd).toLocaleDateString()}</TableCell>
                    <TableCell>{s.totalSuggestions}</TableCell>
                    <TableCell>{s.acceptedCount}</TableCell>
                    <TableCell>{s.editedCount}</TableCell>
                    <TableCell>{s.rejectedCount}</TableCell>
                    <TableCell>{s.acceptanceRate == null ? "—" : `${(s.acceptanceRate * 100).toFixed(1)}%`}</TableCell>
                    <TableCell>{s.mape == null ? "—" : `${(s.mape * 100).toFixed(1)}%`}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Chat Sessions diagnostic tab ───────────────────────────────────────────

interface AdminSession {
  id: string;
  userId: string;
  bidId: string | null;
  estimateId: string | null;
  projectId: string | null;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Skills types ──────────────────────────────────────────────────────────

interface AiEstimatorSkill {
  id: string;
  organizationId: string | null;
  name: string;
  description: string | null;
  ruleBody: string;
  scope: "global" | "trade" | "csi_division" | "project_type";
  scopeValue: string | null;
  priority: number;
  isActive: boolean;
  isReadOnly: boolean;
  sourceType: "user_authored" | "promoted_lesson" | "seeded";
  sourceLessonId: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SessionContextPreview {
  sessionId: string;
  bidId: string | null;
  estimateId: string | null;
  projectId: string | null;
  lineItemCount: number;
  lineItemTotalCost: number;
  measurementCount: number;
  knowledgeIndexRowCount: number;
  learnedRateCount: number;
  notes: string[];
}

function SessionsTab() {
  const sessionsQuery = useQuery<{ sessions: AdminSession[] }>({
    queryKey: ["/api/ai-estimator/admin/sessions"],
  });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, SessionContextPreview | "loading" | "error">>({});

  async function loadPreview(sessionId: string) {
    if (previews[sessionId]) return;
    setPreviews((p) => ({ ...p, [sessionId]: "loading" }));
    try {
      const r = await apiRequest("GET", `/api/ai-estimator/admin/session-preview/${sessionId}`);
      const data = await r.json();
      setPreviews((p) => ({ ...p, [sessionId]: data }));
    } catch {
      setPreviews((p) => ({ ...p, [sessionId]: "error" }));
    }
  }

  function toggleRow(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
    } else {
      setExpandedId(id);
      loadPreview(id);
    }
  }

  const sessions = sessionsQuery.data?.sessions ?? [];

  return (
    <Card data-testid="card-chat-sessions">
      <CardHeader>
        <CardTitle>Recent chat sessions</CardTitle>
        <CardDescription>
          Inspect the data each session had access to. Click "Debug context" on any row to see how many line items, learned rates, and knowledge index entries were available when the AI responded.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {sessionsQuery.isLoading ? (
          <Loader2 className="animate-spin h-5 w-5" />
        ) : sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="text-no-sessions">
            No chat sessions yet. Sessions are created when a user opens the AI estimator chat panel on a bid.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Session</TableHead>
                <TableHead>Bid / Estimate</TableHead>
                <TableHead>Last active</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((s) => {
                const preview = previews[s.id];
                const isOpen = expandedId === s.id;
                return (
                  <Fragment key={s.id}>
                    <TableRow data-testid={`row-session-${s.id}`}>
                      <TableCell>
                        <div className="text-xs font-mono text-muted-foreground">{s.id.slice(0, 8)}</div>
                        {s.title && <div className="text-sm">{s.title}</div>}
                      </TableCell>
                      <TableCell>
                        <div className="space-y-0.5 text-xs text-muted-foreground">
                          {s.bidId && <div>bid: <span className="font-mono">{s.bidId.slice(0, 8)}</span></div>}
                          {s.estimateId && <div>est: <span className="font-mono">{s.estimateId.slice(0, 8)}</span></div>}
                          {s.projectId && <div>proj: <span className="font-mono">{s.projectId.slice(0, 8)}</span></div>}
                          {!s.bidId && !s.estimateId && !s.projectId && <span className="italic">no links</span>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground">
                          {new Date(s.updatedAt).toLocaleString()}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => toggleRow(s.id)}
                          data-testid={`button-debug-session-${s.id}`}
                        >
                          {isOpen ? <ChevronDown className="h-3 w-3 mr-1" /> : <ChevronRight className="h-3 w-3 mr-1" />}
                          Debug context
                        </Button>
                      </TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow key={`${s.id}-preview`} data-testid={`row-session-preview-${s.id}`}>
                        <TableCell colSpan={4} className="bg-muted/20 p-4">
                          {preview === "loading" ? (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Loader2 className="h-4 w-4 animate-spin" /> Loading context snapshot…
                            </div>
                          ) : preview === "error" ? (
                            <div className="flex items-center gap-2 text-sm text-destructive">
                              <AlertCircle className="h-4 w-4" /> Failed to load context preview.
                            </div>
                          ) : preview ? (
                            <div className="space-y-3">
                              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 text-sm">
                                {[
                                  { label: "Line items", value: preview.lineItemCount, testId: "preview-line-items" },
                                  { label: "Total cost", value: `$${preview.lineItemTotalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, testId: "preview-total-cost" },
                                  { label: "Measurements", value: preview.measurementCount, testId: "preview-measurements" },
                                  { label: "Knowledge rows", value: preview.knowledgeIndexRowCount, testId: "preview-knowledge" },
                                  { label: "Learned rates", value: preview.learnedRateCount, testId: "preview-rates" },
                                ].map((c) => (
                                  <div key={c.label} className="rounded border bg-background px-3 py-2" data-testid={c.testId}>
                                    <div className="text-xs text-muted-foreground">{c.label}</div>
                                    <div className="font-semibold tabular-nums">{c.value}</div>
                                  </div>
                                ))}
                              </div>
                              {preview.notes.length > 0 && (
                                <div className="space-y-1">
                                  {preview.notes.map((note, i) => (
                                    <div
                                      key={i}
                                      className="flex items-start gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800"
                                      data-testid={`preview-note-${i}`}
                                    >
                                      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                                      {note}
                                    </div>
                                  ))}
                                </div>
                              )}
                              {preview.notes.length === 0 && (
                                <div className="flex items-center gap-2 text-xs text-green-700" data-testid="preview-ok">
                                  <CheckCircle2 className="h-3.5 w-3.5" /> Context looks complete — no missing data detected.
                                </div>
                              )}
                            </div>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Ingestion status banner + page-level types ──────────────────────────────

interface IngestionStatus {
  lastSuccessAt: string | null;
  knowledgeIndexRows: number;
  learnedRateRows: number;
  neverRun: boolean;
}

interface StatusResponse {
  enabled: boolean;
  canTrain: boolean;
  canManage: boolean;
  featureFlagOn: boolean;
  reason: string;
  ingestion: IngestionStatus;
}

function IngestionStatusBanner({ status }: { status: IngestionStatus | undefined }) {
  if (!status) return null;
  if (!status.neverRun) {
    return (
      <div
        className="flex flex-wrap items-center gap-4 rounded-md border bg-muted/30 px-4 py-3 text-sm"
        data-testid="banner-ingestion-status"
      >
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <span>
            Last ingestion:{" "}
            <strong>{status.lastSuccessAt ? new Date(status.lastSuccessAt).toLocaleString() : "unknown"}</strong>
          </span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Database className="h-3.5 w-3.5" />
          <span>{status.knowledgeIndexRows.toLocaleString()} knowledge rows</span>
          <span>·</span>
          <span>{status.learnedRateRows.toLocaleString()} learned rates</span>
        </div>
      </div>
    );
  }
  return (
    <div
      className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800"
      data-testid="banner-ingestion-never-run"
    >
      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
      <div>
        <strong>Ingestion has never run for this organization.</strong>{" "}
        The AI chat panel will have no learned rates or prior bid context until you run ingestion. Click
        "Re-train from history" above to start a manual run.
      </div>
    </div>
  );
}

interface SkillSuggestion {
  name: string;
  description: string;
  ruleBody: string;
  scope: "global" | "trade" | "csi_division" | "project_type";
  scopeValue: string | null;
  rationale: string;
}

// ─── Skills tab ─────────────────────────────────────────────────────────────

function SkillsTab() {
  const { toast } = useToast();
  const [editingSkill, setEditingSkill] = useState<AiEstimatorSkill | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const [draft, setDraft] = useState<{
    name: string;
    description: string;
    ruleBody: string;
    scope: "global" | "trade" | "csi_division" | "project_type";
    scopeValue: string;
    priority: string;
  }>({
    name: "",
    description: "",
    ruleBody: "",
    scope: "global",
    scopeValue: "",
    priority: "100",
  });

  const skillsQuery = useQuery<{ skills: AiEstimatorSkill[] }>({
    queryKey: ["/api/ai-estimator/skills"],
  });

  const suggestionsQuery = useQuery<{ suggestions: SkillSuggestion[] }>({
    queryKey: ["/api/ai-estimator/skills/suggestions"],
    enabled: showSuggestions,
    staleTime: 0,
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof draft) =>
      apiRequest("POST", "/api/ai-estimator/skills", {
        name: data.name,
        description: data.description || null,
        ruleBody: data.ruleBody,
        scope: data.scope,
        scopeValue: data.scopeValue || null,
        priority: parseInt(data.priority) || 100,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-estimator/skills"] });
      toast({ title: "Skill created" });
      setShowCreate(false);
      setDraft({ name: "", description: "", ruleBody: "", scope: "global", scopeValue: "", priority: "100" });
    },
    onError: (err: Error) => toast({ title: "Failed to create skill", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<AiEstimatorSkill> }) =>
      apiRequest("PATCH", `/api/ai-estimator/skills/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-estimator/skills"] });
      toast({ title: "Skill updated" });
      setEditingSkill(null);
    },
    onError: (err: Error) => toast({ title: "Failed to update skill", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/ai-estimator/skills/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-estimator/skills"] });
      toast({ title: "Skill deleted" });
    },
    onError: (err: Error) => toast({ title: "Failed to delete skill", description: err.message, variant: "destructive" }),
  });

  const reorderMutation = useMutation({
    mutationFn: async (items: Array<{ id: string; priority: number }>) =>
      apiRequest("POST", "/api/ai-estimator/skills/reorder", { items }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-estimator/skills"] });
    },
    onError: (err: Error) => toast({ title: "Reorder failed", description: err.message, variant: "destructive" }),
  });

  const promoteMutation = useMutation({
    mutationFn: async (suggestion: SkillSuggestion) =>
      apiRequest("POST", "/api/ai-estimator/skills", {
        name: suggestion.name,
        description: suggestion.description,
        ruleBody: suggestion.ruleBody,
        scope: suggestion.scope,
        scopeValue: suggestion.scopeValue || null,
        priority: 100,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-estimator/skills"] });
      toast({ title: "Suggestion added as skill" });
    },
    onError: (err: Error) => toast({ title: "Failed to add suggestion", description: err.message, variant: "destructive" }),
  });

  const skills = skillsQuery.data?.skills ?? [];
  const seeded = skills.filter((s) => s.sourceType === "seeded");
  const orgOwned = skills.filter((s) => s.sourceType !== "seeded");

  const scopeLabel = (s: AiEstimatorSkill) => {
    if (s.scope === "global") return "Global";
    const labels: Record<string, string> = { trade: "Trade", csi_division: "CSI Division", project_type: "Project Type" };
    return s.scopeValue ? `${labels[s.scope] ?? s.scope}: ${s.scopeValue}` : labels[s.scope] ?? s.scope;
  };

  function moveSkill(skill: AiEstimatorSkill, direction: "up" | "down") {
    const sorted = [...orgOwned].sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt));
    const idx = sorted.findIndex((s) => s.id === skill.id);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const swapped = sorted[swapIdx];
    const newPriority = swapped.priority;
    const swappedPriority = skill.priority;
    reorderMutation.mutate([
      { id: skill.id, priority: newPriority },
      { id: swapped.id, priority: swappedPriority },
    ]);
  }

  function openCreate() {
    setDraft({ name: "", description: "", ruleBody: "", scope: "global", scopeValue: "", priority: "100" });
    setEditingSkill(null);
    setShowCreate(true);
  }

  function openEdit(skill: AiEstimatorSkill) {
    setDraft({
      name: skill.name,
      description: skill.description ?? "",
      ruleBody: skill.ruleBody,
      scope: skill.scope,
      scopeValue: skill.scopeValue ?? "",
      priority: String(skill.priority),
    });
    setEditingSkill(skill);
    setShowCreate(true);
  }

  function submitForm() {
    if (!draft.name.trim() || !draft.ruleBody.trim()) {
      toast({ title: "Name and rule body are required", variant: "destructive" });
      return;
    }
    if (editingSkill) {
      updateMutation.mutate({
        id: editingSkill.id,
        data: {
          name: draft.name,
          description: draft.description || null,
          ruleBody: draft.ruleBody,
          scope: draft.scope,
          scopeValue: draft.scopeValue || null,
          priority: parseInt(draft.priority) || 100,
        },
      });
    } else {
      createMutation.mutate(draft);
    }
  }

  const activeCount = skills.filter((s) => s.isActive).length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-primary" />
                Estimating Skills
              </CardTitle>
              <CardDescription>
                Persistent methodology rules injected into every AI estimate as firm-wide guidance.{" "}
                {activeCount} active skill{activeCount !== 1 ? "s" : ""} across {skills.length} total.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowSuggestions((v) => !v)}
                data-testid="button-skills-suggestions"
              >
                <Wand2 className="h-4 w-4 mr-1" />
                AI suggestions
              </Button>
              <Button size="sm" onClick={openCreate} data-testid="button-skills-create">
                <Plus className="h-4 w-4 mr-1" />
                New skill
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {skillsQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading skills…
            </div>
          ) : skills.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 text-center" data-testid="text-skills-empty">
              No skills yet. Click "New skill" to author your first rule or use AI suggestions to get started.
            </div>
          ) : (
            <div className="space-y-6">
              {orgOwned.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Your firm's skills</div>
                  <div className="divide-y rounded-md border">
                    {[...orgOwned].sort((a, b) => a.priority - b.priority).map((skill, idx, arr) => (
                      <div key={skill.id} className="flex items-start gap-3 p-3" data-testid={`row-skill-${skill.id}`}>
                        <Switch
                          checked={skill.isActive}
                          onCheckedChange={(checked) =>
                            updateMutation.mutate({ id: skill.id, data: { isActive: checked } })
                          }
                          data-testid={`switch-skill-active-${skill.id}`}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm" data-testid={`text-skill-name-${skill.id}`}>{skill.name}</span>
                            <Badge variant="outline" className="text-xs">{scopeLabel(skill)}</Badge>
                            <Badge variant="outline" className="text-xs">P{skill.priority}</Badge>
                            {skill.sourceType === "promoted_lesson" && (
                              <Badge variant="secondary" className="text-xs">From lesson</Badge>
                            )}
                            {!skill.isActive && (
                              <Badge variant="secondary" className="text-xs">Inactive</Badge>
                            )}
                          </div>
                          {skill.description && (
                            <div className="text-xs text-muted-foreground mt-0.5">{skill.description}</div>
                          )}
                          <div className="text-xs text-muted-foreground mt-1 font-mono whitespace-pre-wrap break-all">
                            {skill.ruleBody.length > 160 ? skill.ruleBody.slice(0, 157) + "…" : skill.ruleBody}
                          </div>
                        </div>
                        <div className="flex flex-col gap-0.5 shrink-0">
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => moveSkill(skill, "up")}
                              disabled={idx === 0 || reorderMutation.isPending}
                              title="Move up"
                              data-testid={`button-skill-up-${skill.id}`}
                            >
                              <ArrowUp className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => moveSkill(skill, "down")}
                              disabled={idx === arr.length - 1 || reorderMutation.isPending}
                              title="Move down"
                              data-testid={`button-skill-down-${skill.id}`}
                            >
                              <ArrowDown className="h-3 w-3" />
                            </Button>
                          </div>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => openEdit(skill)}
                              data-testid={`button-skill-edit-${skill.id}`}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-destructive"
                              onClick={() => deleteMutation.mutate(skill.id)}
                              disabled={deleteMutation.isPending}
                              data-testid={`button-skill-delete-${skill.id}`}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {seeded.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                    Trade-pack defaults (read-only — toggle to disable)
                  </div>
                  <div className="divide-y rounded-md border bg-muted/30">
                    {seeded.map((skill) => (
                      <div key={skill.id} className={`flex items-start gap-3 p-3 ${skill.isActive ? "" : "opacity-50"}`} data-testid={`row-skill-seeded-${skill.id}`}>
                        <Switch
                          checked={skill.isActive}
                          onCheckedChange={(checked) =>
                            updateMutation.mutate({ id: skill.id, data: { isActive: checked } })
                          }
                          data-testid={`switch-skill-seeded-active-${skill.id}`}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">{skill.name}</span>
                            <Badge variant="outline" className="text-xs">{scopeLabel(skill)}</Badge>
                            <Badge variant="outline" className="text-xs">P{skill.priority}</Badge>
                            {!skill.isActive && (
                              <Badge variant="secondary" className="text-xs">Disabled</Badge>
                            )}
                          </div>
                          {skill.description && (
                            <div className="text-xs text-muted-foreground mt-0.5">{skill.description}</div>
                          )}
                          <div className="text-xs text-muted-foreground mt-1 font-mono whitespace-pre-wrap break-all">
                            {skill.ruleBody.length > 160 ? skill.ruleBody.slice(0, 157) + "…" : skill.ruleBody}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {showSuggestions && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Wand2 className="h-4 w-4 text-primary" />
              AI-suggested skills
            </CardTitle>
            <CardDescription>
              Candidates derived from your training data and lessons learned. Click "Add" to promote one to an active skill.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {suggestionsQuery.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Generating suggestions…
              </div>
            ) : (suggestionsQuery.data?.suggestions ?? []).length === 0 ? (
              <div className="text-sm text-muted-foreground" data-testid="text-suggestions-empty">
                No suggestions available yet — run a training pass first.
              </div>
            ) : (
              <div className="divide-y rounded-md border">
                {(suggestionsQuery.data?.suggestions ?? []).map((s, i) => (
                  <div key={i} className="flex items-start gap-3 p-3" data-testid={`row-suggestion-${i}`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{s.name}</span>
                        {s.scope !== "global" && s.scopeValue && (
                          <Badge variant="outline" className="text-xs">{s.scope}: {s.scopeValue}</Badge>
                        )}
                      </div>
                      {s.description && <div className="text-xs text-muted-foreground mt-0.5">{s.description}</div>}
                      <div className="text-xs font-mono text-muted-foreground mt-1 whitespace-pre-wrap break-all">
                        {s.ruleBody.length > 200 ? s.ruleBody.slice(0, 197) + "…" : s.ruleBody}
                      </div>
                      {s.rationale && <div className="text-xs italic text-muted-foreground mt-1">{s.rationale}</div>}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => promoteMutation.mutate(s)}
                      disabled={promoteMutation.isPending}
                      data-testid={`button-suggestion-add-${i}`}
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      Add
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={showCreate} onOpenChange={(open) => { if (!open) { setShowCreate(false); setEditingSkill(null); } }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingSkill ? "Edit skill" : "New skill"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label htmlFor="skill-name">Name</Label>
              <Input
                id="skill-name"
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="e.g. Always check soil bearing capacity for footings"
                data-testid="input-skill-name"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="skill-description">Description (optional)</Label>
              <Input
                id="skill-description"
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                placeholder="Short summary shown in the list"
                data-testid="input-skill-description"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="skill-rule-body">Rule body</Label>
              <Textarea
                id="skill-rule-body"
                rows={5}
                value={draft.ruleBody}
                onChange={(e) => setDraft((d) => ({ ...d, ruleBody: e.target.value }))}
                placeholder="Write the methodology instruction in plain English. This text is injected verbatim into the AI system prompt…"
                data-testid="textarea-skill-rule-body"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Scope</Label>
                <Select value={draft.scope} onValueChange={(v) => setDraft((d) => ({ ...d, scope: v as typeof d.scope, scopeValue: "" }))}>
                  <SelectTrigger data-testid="select-skill-scope">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="global">Global (all estimates)</SelectItem>
                    <SelectItem value="trade">Trade type</SelectItem>
                    <SelectItem value="csi_division">CSI Division</SelectItem>
                    <SelectItem value="project_type">Project type</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {draft.scope !== "global" && (
                <div className="space-y-1">
                  <Label>Scope value</Label>
                  <Input
                    value={draft.scopeValue}
                    onChange={(e) => setDraft((d) => ({ ...d, scopeValue: e.target.value }))}
                    placeholder={
                      draft.scope === "trade" ? "e.g. Concrete" :
                      draft.scope === "csi_division" ? "e.g. 03 00 00" :
                      "e.g. Commercial"
                    }
                    data-testid="input-skill-scope-value"
                  />
                </div>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="skill-priority">Priority (lower fires first)</Label>
              <Input
                id="skill-priority"
                type="number"
                min={1}
                max={9999}
                value={draft.priority}
                onChange={(e) => setDraft((d) => ({ ...d, priority: e.target.value }))}
                data-testid="input-skill-priority"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCreate(false); setEditingSkill(null); }}>Cancel</Button>
            <Button
              onClick={submitForm}
              disabled={createMutation.isPending || updateMutation.isPending}
              data-testid="button-skill-save"
            >
              {(createMutation.isPending || updateMutation.isPending) ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</>
              ) : editingSkill ? "Save changes" : "Create skill"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function AiEstimatorAdminPage() {
  const { toast } = useToast();
  const [tab, setTab] = useState("access");

  const statusQuery = useQuery<StatusResponse>({ queryKey: ["/api/ai-estimator/status"], staleTime: 60_000 });
  const accessQuery = useQuery<{ users: AccessRow[] }>({ queryKey: ["/api/ai-estimator/admin/access"] });
  const runsQuery = useQuery<{ runs: IngestRun[] }>({ queryKey: ["/api/ai-estimator/admin/ingest-runs"] });
  const ratesQuery = useQuery<{ rates: LearnedRate[] }>({ queryKey: ["/api/ai-estimator/admin/learned-rates"] });
  const feedbackQuery = useQuery<{ stats: FeedbackStats; recent: FeedbackRow[] }>({ queryKey: ["/api/ai-estimator/admin/feedback"] });
  const excludedQuery = useQuery<{ excludedSources: ExcludedSource[] }>({ queryKey: ["/api/ai-estimator/admin/excluded-sources"] });

  const [rateFilter, setRateFilter] = useState("");
  const [metricFilter, setMetricFilter] = useState("all");
  const [minSamples, setMinSamples] = useState(0);
  const [selectedRate, setSelectedRate] = useState<LearnedRate | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [excludedOpen, setExcludedOpen] = useState(false);

  const [excludeDialogOpen, setExcludeDialogOpen] = useState(false);
  const [pendingExclude, setPendingExclude] = useState<{ projectId: string; projectName: string } | null>(null);
  const [expandedRunIds, setExpandedRunIds] = useState<Set<string>>(new Set());


  const [expandedRateIds, setExpandedRateIds] = useState<Set<string>>(new Set());
  const toggleRateExpanded = (id: string) => {
    setExpandedRateIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleRunExpanded = (id: string) => {
    setExpandedRunIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const updateAccess = useMutation({
    mutationFn: async (vars: { userId: string; enabled: boolean; canTrain?: boolean }) =>
      apiRequest("PUT", "/api/ai-estimator/admin/access", vars),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-estimator/admin/access"] });
      toast({ title: "Access updated" });
    },
    onError: (err: Error) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const triggerIngest = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/ai-estimator/admin/ingest", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-estimator/admin/ingest-runs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai-estimator/admin/learned-rates"] });
      toast({ title: "Ingestion started", description: "Re-trained from your historical data." });
    },
    onError: (err: Error) => toast({ title: "Ingestion failed", description: err.message, variant: "destructive" }),
  });

  const addExclusion = useMutation({
    mutationFn: async (vars: { projectId?: string; bidId?: string; reason?: string }) =>
      apiRequest("POST", "/api/ai-estimator/admin/excluded-sources", vars),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-estimator/admin/excluded-sources"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai-estimator/admin/learned-rates"] });
      toast({ title: "Project excluded", description: "Rates recomputed excluding this project." });
    },
    onError: (err: Error) => toast({ title: "Exclusion failed", description: err.message, variant: "destructive" }),
  });

  const removeExclusion = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/ai-estimator/admin/excluded-sources/${id}`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-estimator/admin/excluded-sources"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai-estimator/admin/learned-rates"] });
      toast({ title: "Project re-included", description: "Rates recomputed with this project restored." });
    },
    onError: (err: Error) => toast({ title: "Re-include failed", description: err.message, variant: "destructive" }),
  });

  const excludedSources = excludedQuery.data?.excludedSources ?? [];
  const excludedProjectIds = new Set(excludedSources.map((e) => e.projectId).filter(Boolean) as string[]);

  const allRuns = runsQuery.data?.runs ?? [];
  const lastScheduledRun = allRuns.find((r) => r.triggerType === "SCHEDULED") ?? null;
  const lastSuccessfulScheduledRun = allRuns.find(
    (r) => r.triggerType === "SCHEDULED" && (r.status === "SUCCESS" || r.status === "SUCCEEDED"),
  ) ?? null;
  const lastRun = allRuns[0] ?? null;

  const allRates = ratesQuery.data?.rates ?? [];
  const filteredRates = allRates.filter((r) => {
    if (rateFilter && !r.costCode.toLowerCase().includes(rateFilter.toLowerCase())) return false;
    if (metricFilter !== "all" && r.metric !== metricFilter) return false;
    if (minSamples > 0 && r.sampleSize < minSamples) return false;
    return true;
  });

  function openDrawer(rate: LearnedRate) {
    setSelectedRate(rate);
    setDrawerOpen(true);
  }

  function handleExcludeProject(projectId: string, projectName: string) {
    setPendingExclude({ projectId, projectName });
    setExcludeDialogOpen(true);
  }

  function confirmExclude(reason: string) {
    if (!pendingExclude) return;
    addExclusion.mutate({ projectId: pendingExclude.projectId, reason });
    setExcludeDialogOpen(false);
    setPendingExclude(null);
  }

  return (
    <div className="container mx-auto p-6 space-y-6" data-testid="page-ai-estimator-admin">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" /> AI Estimator Admin
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Control which estimators can use the workspace, monitor learned cost-rate health, and review feedback.
          </p>
        </div>
        <Button
          onClick={() => triggerIngest.mutate()}
          disabled={triggerIngest.isPending}
          data-testid="button-trigger-ingest"
        >
          {triggerIngest.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCcw className="h-4 w-4 mr-2" />}
          Re-train from history
        </Button>
      </div>

      <IngestionStatusBanner status={statusQuery.data?.ingestion} />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="access" data-testid="tab-access">User access</TabsTrigger>
          <TabsTrigger value="ingest" data-testid="tab-ingest">Training runs</TabsTrigger>
          <TabsTrigger value="rates" data-testid="tab-rates">Learned rates</TabsTrigger>
          <TabsTrigger value="feedback" data-testid="tab-feedback">Feedback</TabsTrigger>
          <TabsTrigger value="sessions" data-testid="tab-sessions">Chat sessions</TabsTrigger>
          <TabsTrigger value="assemblies" data-testid="tab-assemblies">Assemblies</TabsTrigger>
          <TabsTrigger value="skills" data-testid="tab-skills">Skills</TabsTrigger>
          <TabsTrigger value="settings" data-testid="tab-settings">Settings</TabsTrigger>
          <TabsTrigger value="spend" data-testid="tab-spend">AI spend</TabsTrigger>
        </TabsList>

        <TabsContent value="access" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Per-user enablement</CardTitle>
              <CardDescription>
                The AI Estimator is opt-in. Enable individual users below — only enabled users will see drafts, the chat panel, and inline suggestions.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {accessQuery.isLoading ? (
                <Loader2 className="animate-spin h-5 w-5" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Enabled</TableHead>
                      <TableHead>Can contribute to training</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {accessQuery.data?.users.map((u) => (
                      <TableRow key={u.userId} data-testid={`row-access-${u.userId}`}>
                        <TableCell>
                          <div className="font-medium">{u.name || u.email}</div>
                          <div className="text-xs text-muted-foreground">{u.email}</div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{u.role}</Badge>
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={u.enabled}
                            onCheckedChange={(v) => updateAccess.mutate({ userId: u.userId, enabled: v, canTrain: u.canTrain })}
                            data-testid={`switch-enabled-${u.userId}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={u.canTrain}
                            disabled={!u.enabled}
                            onCheckedChange={(v) => updateAccess.mutate({ userId: u.userId, enabled: u.enabled, canTrain: v })}
                            data-testid={`switch-train-${u.userId}`}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ingest" className="space-y-4">
          <Card data-testid="card-schedule-status">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Info className="h-5 w-5" /> Nightly schedule status
              </CardTitle>
              <CardDescription>
                The ingestion job runs automatically once per day per organization. This panel shows whether the latest scheduled run completed successfully.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {runsQuery.isLoading ? (
                <Loader2 className="animate-spin h-5 w-5" />
              ) : !lastScheduledRun ? (
                <div className="flex items-start gap-2 text-sm text-muted-foreground" data-testid="text-no-scheduled-runs">
                  <Info className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>No scheduled runs recorded yet. The nightly job will record its first run here automatically.</span>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-3" data-testid="summary-last-scheduled-run">
                    <Badge
                      variant={
                        lastScheduledRun.status === "SUCCESS" || lastScheduledRun.status === "SUCCEEDED"
                          ? "default"
                          : lastScheduledRun.status === "FAILED"
                            ? "destructive"
                            : "secondary"
                      }
                      className="gap-1"
                      data-testid="badge-last-scheduled-status"
                    >
                      {lastScheduledRun.status === "SUCCESS" || lastScheduledRun.status === "SUCCEEDED" ? (
                        <CheckCircle2 className="h-3 w-3" />
                      ) : lastScheduledRun.status === "FAILED" ? (
                        <AlertCircle className="h-3 w-3" />
                      ) : (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      )}
                      {lastScheduledRun.status}
                    </Badge>
                    <span className="text-sm">
                      Last scheduled run:{" "}
                      <strong data-testid="text-last-scheduled-started">
                        {new Date(lastScheduledRun.startedAt).toLocaleString()}
                      </strong>
                      {lastScheduledRun.completedAt && (
                        <span className="text-muted-foreground">
                          {" "}
                          (finished {new Date(lastScheduledRun.completedAt).toLocaleString()})
                        </span>
                      )}
                    </span>
                  </div>

                  {lastScheduledRun.status === "FAILED" && lastSuccessfulScheduledRun && (
                    <div className="text-sm text-muted-foreground" data-testid="text-last-successful-scheduled">
                      Last successful scheduled run:{" "}
                      <strong>{new Date(lastSuccessfulScheduledRun.startedAt).toLocaleString()}</strong>
                    </div>
                  )}

                  {lastScheduledRun.status === "FAILED" && !lastSuccessfulScheduledRun && (
                    <div className="text-sm text-amber-700" data-testid="text-no-successful-scheduled">
                      No successful scheduled run on record yet.
                    </div>
                  )}

                  {lastScheduledRun.status === "FAILED" && lastScheduledRun.errorMessage && (
                    <div
                      className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"
                      data-testid="text-last-scheduled-error"
                    >
                      <AlertTriangle className="h-4 w-4 mt-0.5 text-destructive shrink-0" />
                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="font-medium text-destructive">Error from last scheduled run</div>
                        <pre className="whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground bg-background/60 rounded border border-destructive/20 p-2 max-h-40 overflow-auto">
                          {lastScheduledRun.errorMessage}
                        </pre>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" data-testid="grid-last-scheduled-counters">
                    {[
                      { label: "Bids", value: lastScheduledRun.bidsIngested, testId: "counter-bids" },
                      { label: "Estimates", value: lastScheduledRun.estimatesIngested, testId: "counter-estimates" },
                      { label: "Line items", value: lastScheduledRun.lineItemsIngested, testId: "counter-line-items" },
                      { label: "Takeoffs", value: lastScheduledRun.takeoffsIngested, testId: "counter-takeoffs" },
                      { label: "Cost postings", value: lastScheduledRun.costPostingsIngested, testId: "counter-cost-postings" },
                      { label: "Rates updated", value: lastScheduledRun.ratesUpdated, testId: "counter-rates" },
                    ].map((c) => (
                      <div
                        key={c.label}
                        className="rounded-md border bg-muted/30 px-3 py-2"
                        data-testid={c.testId}
                      >
                        <div className="text-xs text-muted-foreground">{c.label}</div>
                        <div className="text-lg font-semibold tabular-nums">{(c.value ?? 0).toLocaleString()}</div>
                      </div>
                    ))}
                  </div>

                  {lastRun && lastRun.id !== lastScheduledRun.id && (
                    <div className="text-xs text-muted-foreground" data-testid="text-most-recent-run-note">
                      Most recent run overall was a {lastRun.triggerType.toLowerCase()} run on{" "}
                      {new Date(lastRun.startedAt).toLocaleString()} ({lastRun.status}).
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" /> Historical training runs
              </CardTitle>
              <CardDescription>
                Each run scans your bids, estimates, takeoffs, and historical-cost data to refresh the learned rates store.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {runsQuery.isLoading ? (
                <Loader2 className="animate-spin h-5 w-5" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Started</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Trigger</TableHead>
                      <TableHead>Bids</TableHead>
                      <TableHead>Estimates</TableHead>
                      <TableHead>Takeoffs</TableHead>
                      <TableHead>Rates updated</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runsQuery.data?.runs.flatMap((r) => {
                      const isFailed = r.status === "FAILED";
                      const hasError = isFailed && !!r.errorMessage;
                      const isExpanded = expandedRunIds.has(r.id);
                      const rows = [
                        <TableRow key={r.id} data-testid={`row-run-${r.id}`}>
                          <TableCell className="whitespace-nowrap">{new Date(r.startedAt).toLocaleString()}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Badge variant={r.status === "SUCCESS" || r.status === "SUCCEEDED" ? "default" : isFailed ? "destructive" : "secondary"}>
                                {r.status}
                              </Badge>
                              {hasError && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-1.5 text-destructive hover:text-destructive"
                                  onClick={() => toggleRunExpanded(r.id)}
                                  aria-label={isExpanded ? "Hide error details" : "Show error details"}
                                  data-testid={`button-toggle-error-${r.id}`}
                                >
                                  {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                  <AlertCircle className="h-3.5 w-3.5 ml-0.5" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-[10px]">{r.triggerType}</Badge>
                          </TableCell>
                          <TableCell>{r.bidsIngested}</TableCell>
                          <TableCell>{r.estimatesIngested}</TableCell>
                          <TableCell>{r.takeoffsIngested}</TableCell>
                          <TableCell>{r.ratesUpdated}</TableCell>
                        </TableRow>,
                      ];
                      if (hasError && isExpanded) {
                        rows.push(
                          <TableRow key={`${r.id}-error`} className="bg-destructive/5 hover:bg-destructive/5">
                            <TableCell colSpan={7} className="py-3">
                              <div className="flex items-start gap-2 text-sm" data-testid={`text-run-error-${r.id}`}>
                                <AlertCircle className="h-4 w-4 mt-0.5 text-destructive shrink-0" />
                                <div className="space-y-1 min-w-0 flex-1">
                                  <div className="font-medium text-destructive">Run failed</div>
                                  <pre className="whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground bg-background/60 rounded border border-destructive/20 p-2 max-h-48 overflow-auto">
                                    {r.errorMessage}
                                  </pre>
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>,
                        );
                      }
                      return rows;
                    })}
                    {runsQuery.data?.runs.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                          No training runs yet. Click <strong>Re-train from history</strong> above to seed the rates store.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rates" className="space-y-4">
          {excludedSources.length > 0 && (
            <Collapsible open={excludedOpen} onOpenChange={setExcludedOpen}>
              <Card>
                <CollapsibleTrigger asChild>
                  <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors rounded-t-lg">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Ban className="h-4 w-4 text-destructive" />
                      Excluded sources
                      <Badge variant="destructive" className="ml-1">{excludedSources.length}</Badge>
                      <span className="ml-auto text-muted-foreground">
                        {excludedOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </span>
                    </CardTitle>
                    <CardDescription>Projects excluded from the rate learning pool</CardDescription>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="pt-0">
                    <div className="space-y-2">
                      {excludedSources.map((e) => (
                        <div key={e.id} className="flex items-center justify-between gap-4 rounded-md border p-3" data-testid={`row-excluded-${e.id}`}>
                          <div className="space-y-0.5 min-w-0">
                            <div className="font-medium truncate">
                              {e.project ? `${e.project.name} (${e.project.code})` : e.bid ? `Bid: ${e.bid.name}` : "Unknown source"}
                            </div>
                            {e.reason && <div className="text-xs text-muted-foreground">{e.reason}</div>}
                            <div className="text-xs text-muted-foreground">
                              Excluded by {e.excludedBy ? `${e.excludedBy.firstName} ${e.excludedBy.lastName}`.trim() || e.excludedBy.email : "unknown"} on {new Date(e.excludedAt).toLocaleDateString()}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => removeExclusion.mutate(e.id)}
                            disabled={removeExclusion.isPending}
                            data-testid={`button-reinclude-${e.id}`}
                          >
                            <RotateCcw className="h-3 w-3 mr-1" /> Re-include
                          </Button>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          )}

          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle>Learned cost rates</CardTitle>
                  <CardDescription>Per cost code / metric / unit, derived only from this organization's data. Click a row to see contributing samples.</CardDescription>
                </div>
                <a
                  href="/api/ai-estimator/admin/learned-rates/export.csv"
                  className="flex items-center gap-1 text-sm text-primary hover:underline whitespace-nowrap"
                  data-testid="link-export-rates-csv"
                >
                  <Download className="h-3.5 w-3.5" /> Export CSV
                </a>
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                <Input
                  placeholder="Filter by cost code…"
                  value={rateFilter}
                  onChange={(e) => setRateFilter(e.target.value)}
                  className="w-44"
                  data-testid="input-rate-filter"
                />
                <Select value={metricFilter} onValueChange={setMetricFilter}>
                  <SelectTrigger className="w-44" data-testid="select-metric-filter">
                    <SelectValue placeholder="All metrics" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All metrics</SelectItem>
                    <SelectItem value="unit_cost">Unit cost</SelectItem>
                    <SelectItem value="labor_hours_per_unit">Labor hours / unit</SelectItem>
                    <SelectItem value="production_rate">Production rate</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={String(minSamples)}
                  onValueChange={(v) => setMinSamples(Number(v))}
                >
                  <SelectTrigger className="w-44" data-testid="select-min-samples">
                    <SelectValue placeholder="Min samples" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Any sample count</SelectItem>
                    <SelectItem value="3">At least 3 samples</SelectItem>
                    <SelectItem value="5">At least 5 samples</SelectItem>
                    <SelectItem value="10">At least 10 samples</SelectItem>
                  </SelectContent>
                </Select>
                {(rateFilter || metricFilter !== "all" || minSamples > 0) && (
                  <Button variant="ghost" size="sm" onClick={() => { setRateFilter(""); setMetricFilter("all"); setMinSamples(0); }} data-testid="button-clear-filters">
                    <X className="h-3.5 w-3.5 mr-1" /> Clear
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {ratesQuery.isLoading ? (
                <Loader2 className="animate-spin h-5 w-5" />
              ) : filteredRates.length === 0 && allRates.length === 0 ? (
                <div className="flex flex-col items-center gap-4 py-12 text-center">
                  <Database className="h-12 w-12 text-muted-foreground/40" />
                  <div>
                    <p className="font-medium text-muted-foreground">No rates learned yet</p>
                    <p className="text-sm text-muted-foreground mt-1">Run training to populate this table from your historical bids and estimates.</p>
                  </div>
                  <Button
                    onClick={() => triggerIngest.mutate()}
                    disabled={triggerIngest.isPending}
                    data-testid="button-run-training-empty"
                  >
                    {triggerIngest.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCcw className="h-4 w-4 mr-2" />}
                    Run training
                  </Button>
                </div>
              ) : (
                <ScrollArea className="h-[60vh]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Cost code</TableHead>
                        <TableHead>Metric</TableHead>
                        <TableHead>Unit</TableHead>
                        <TableHead>n</TableHead>
                        <TableHead>Median</TableHead>
                        <TableHead>P25 – P75</TableHead>
                        <TableHead>Confidence</TableHead>
                        <TableHead>Updated</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>

                      {filteredRates.map((r) => (
                        <TableRow
                          key={r.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => openDrawer(r)}
                          data-testid={`row-rate-${r.id}`}
                        >
                          <TableCell className="font-mono text-xs">
                            {r.costCode}
                            {r.excludedSampleCount > 0 && (
                              <Badge variant="outline" className="ml-1 text-[9px] border-amber-300 text-amber-700">
                                -{r.excludedSampleCount} excl.
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-xs">{r.metric.replace(/_/g, " ")}</TableCell>
                          <TableCell>{r.unit}</TableCell>
                          <TableCell>{r.sampleSize}</TableCell>
                          <TableCell>{r.median ?? r.mean ?? "—"}</TableCell>
                          <TableCell>{r.p25 && r.p75 ? `${r.p25} – ${r.p75}` : "—"}</TableCell>
                          <TableCell>
                            <ConfidenceChip confidence={r.confidence} sampleSize={r.sampleSize} />
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs">{new Date(r.lastUpdatedAt).toLocaleDateString()}</TableCell>
                        </TableRow>
                      ))}

                      {filteredRates.flatMap((r) => {
                        const isExpanded = expandedRateIds.has(r.id);
                        const point = r.median ?? r.mean ?? null;
                        const rangeLabel = r.p25 && r.p75 ? `${r.p25} – ${r.p75}` : null;
                        const rows = [
                          <TableRow
                            key={r.id}
                            className="cursor-pointer hover:bg-muted/50"
                            onClick={() => openDrawer(r)}
                            data-testid={`row-rate-${r.id}`}
                          >
                            <TableCell className="font-mono text-xs">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-5 w-5 p-0 mr-1 align-middle"
                                onClick={(e) => { e.stopPropagation(); toggleRateExpanded(r.id); }}
                                aria-label={isExpanded ? "Hide explanation" : "Why this number?"}
                                data-testid={`button-why-${r.id}`}
                              >
                                {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                              </Button>
                              {r.costCode}
                              {r.excludedSampleCount > 0 && (
                                <Badge variant="outline" className="ml-1 text-[9px] border-amber-300 text-amber-700">
                                  -{r.excludedSampleCount} excl.
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-xs">{r.metric.replace(/_/g, " ")}</TableCell>
                            <TableCell>{r.unit}</TableCell>
                            <TableCell>{r.sampleSize}</TableCell>
                            <TableCell>{point ?? "—"}</TableCell>
                            <TableCell>{rangeLabel ?? "—"}</TableCell>
                            <TableCell>
                              <ConfidenceChip confidence={r.confidence} sampleSize={r.sampleSize} />
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs">{new Date(r.lastUpdatedAt).toLocaleDateString()}</TableCell>
                          </TableRow>,
                        ];
                        if (isExpanded) {
                          rows.push(
                            <TableRow key={`${r.id}-why`} className="bg-muted/20 hover:bg-muted/20">
                              <TableCell colSpan={8} className="py-3">
                                <div className="flex items-start gap-2 text-xs" data-testid={`text-why-${r.id}`}>
                                  <HelpCircle className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                                  <div className="space-y-1.5 min-w-0 flex-1">
                                    <div className="font-medium text-foreground">Why this number?</div>
                                    <ul className="list-disc pl-5 space-y-0.5 text-muted-foreground">
                                      <li>
                                        Median <strong>{point ?? "—"}</strong> across <strong>{r.sampleSize}</strong> sample{r.sampleSize !== 1 ? "s" : ""} from your historical {r.metric.replace(/_/g, " ")} for cost code <span className="font-mono">{r.costCode}</span>.
                                      </li>
                                      {rangeLabel && (
                                        <li>
                                          Middle 50% (P25 – P75) sits in <strong>{rangeLabel}</strong>. Wider ranges = larger natural variability.
                                        </li>
                                      )}
                                      <li>
                                        Confidence <strong>{r.confidence}</strong> (Strong ≥ 10 samples · Mixed ≥ 3 · Sparse &lt; 3).
                                      </li>
                                      {r.excludedSampleCount > 0 && (
                                        <li className="text-amber-700">
                                          {r.excludedSampleCount} sample{r.excludedSampleCount !== 1 ? "s" : ""} excluded by admin or by the Lost/Cancelled bid filter (see <strong>Settings</strong>).
                                        </li>
                                      )}
                                      <li className="italic">
                                        Inline suggestions multiply this by the project's region factor when one is selected.
                                      </li>
                                    </ul>
                                  </div>
                                </div>
                              </TableCell>
                            </TableRow>,
                          );
                        }
                        return rows;
                      })}

                      {filteredRates.length === 0 && allRates.length > 0 && (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">
                            No rates match the current filters.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="feedback">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5" /> Feedback signals</CardTitle>
              <CardDescription>How estimators are reacting to AI suggestions in the last 30 days.</CardDescription>
            </CardHeader>
            <CardContent>
              {feedbackQuery.isLoading ? (
                <Loader2 className="animate-spin h-5 w-5" />
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div className="rounded-md border p-4">
                      <div className="text-xs text-muted-foreground">Total events</div>
                      <div className="text-2xl font-bold" data-testid="text-feedback-total">{feedbackQuery.data?.stats.totalEvents ?? 0}</div>
                    </div>
                    <div className="rounded-md border p-4">
                      <div className="text-xs text-muted-foreground">Acceptance rate</div>
                      <div className="text-2xl font-bold" data-testid="text-acceptance-rate">
                        {feedbackQuery.data?.stats.acceptanceRate != null
                          ? `${(feedbackQuery.data.stats.acceptanceRate * 100).toFixed(0)}%`
                          : "—"}
                      </div>
                    </div>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>When</TableHead>
                        <TableHead>Surface</TableHead>
                        <TableHead>Outcome</TableHead>
                        <TableHead>Cost code</TableHead>
                        <TableHead>Comment</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {feedbackQuery.data?.recent.map((f) => (
                        <TableRow key={f.id} data-testid={`row-feedback-${f.id}`}>
                          <TableCell className="whitespace-nowrap text-xs">{new Date(f.createdAt).toLocaleString()}</TableCell>
                          <TableCell>{f.surface}</TableCell>
                          <TableCell>
                            <Badge variant={f.outcome === "ACCEPTED" || f.outcome === "THUMBS_UP" ? "default" : f.outcome === "REJECTED" || f.outcome === "THUMBS_DOWN" ? "destructive" : "secondary"}>
                              {f.outcome}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs">{f.costCode ?? "—"}</TableCell>
                          <TableCell className="text-xs">{f.comment ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="assemblies" className="space-y-4">
          <AssembliesTab />
        </TabsContent>

        <TabsContent value="skills" className="space-y-4">
          <SkillsTab />
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          <SettingsTab />
          <OrgFactorsCapCard />
        </TabsContent>

        <TabsContent value="sessions" className="space-y-4">
          <SessionsTab />
        </TabsContent>

        <TabsContent value="spend" className="space-y-4">
          <AiSpendCard />
        </TabsContent>
      </Tabs>

      <SamplesDrawer
        rate={selectedRate}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        excludedProjectIds={excludedProjectIds}
        onExcludeProject={handleExcludeProject}
      />

      {pendingExclude && (
        <ExcludeProjectDialog
          projectId={pendingExclude.projectId}
          projectName={pendingExclude.projectName}
          open={excludeDialogOpen}
          onClose={() => { setExcludeDialogOpen(false); setPendingExclude(null); }}
          onExclude={confirmExclude}
        />
      )}
    </div>
  );
}

// Task #2626 — Per-org configurable cap on the number of AI Estimator
// map-reduce batches per discipline. Replaces the historical hardcoded
// MAX_DISCIPLINE_BATCHES constant. Persisted on aiEstimatorOrgFactors.
interface OrgFactorsRow {
  maxDisciplineBatches?: number | null;
}

function OrgFactorsCapCard() {
  const { toast } = useToast();
  const factorsQuery = useQuery<OrgFactorsRow>({
    queryKey: ["/api/ai-estimator/org-factors"],
  });
  const [draftCap, setDraftCap] = useState<string>("");

  useEffect(() => {
    if (factorsQuery.data?.maxDisciplineBatches != null) {
      setDraftCap(String(factorsQuery.data.maxDisciplineBatches));
    }
  }, [factorsQuery.data?.maxDisciplineBatches]);

  const updateCap = useMutation({
    mutationFn: async (newCap: number) => {
      await apiRequest("PUT", "/api/ai-estimator/org-factors", {
        maxDisciplineBatches: newCap,
      });
    },
    onSuccess: () => {
      toast({ title: "Saved", description: "Per-discipline batch cap updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/ai-estimator/org-factors"] });
    },
    onError: (err: Error) =>
      toast({ title: "Failed to save", description: err.message, variant: "destructive" }),
  });

  const parsed = Number(draftCap);
  const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= 200;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" /> AI Estimator drafter cap
        </CardTitle>
        <CardDescription>
          Maximum number of map-reduce batches per discipline. Each batch is one LLM call covering up
          to a few sheets. Lower = cheaper but more sheets get skipped on large plan sets. Default 25,
          allowed range 1–200.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {factorsQuery.isLoading ? (
          <Loader2 className="animate-spin h-5 w-5" />
        ) : (
          <div className="flex items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="cap-input">Max discipline batches</Label>
              <Input
                id="cap-input"
                type="number"
                min={1}
                max={200}
                value={draftCap}
                onChange={(e) => setDraftCap(e.target.value)}
                className="w-32"
                data-testid="input-max-discipline-batches"
              />
            </div>
            <Button
              onClick={() => updateCap.mutate(parsed)}
              disabled={!valid || updateCap.isPending || parsed === factorsQuery.data?.maxDisciplineBatches}
              data-testid="button-save-max-discipline-batches"
            >
              {updateCap.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface SpendByModelRow {
  model: string | null;
  actionType: string;
  provider: string | null;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}
interface SpendByBidRow {
  bidId: string | null;
  bid: { id: string; name: string | null; code: string | null } | null;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  lastRunAt: string;
}
interface SpendByProjectRow {
  projectId: string | null;
  project: { id: string; name: string | null; code: string | null } | null;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  lastRunAt: string;
}
interface SpendByDraftRow {
  draftId: string | null;
  bidId: string | null;
  bid: { id: string; name: string | null; code: string | null } | null;
  projectId: string | null;
  project: { id: string; name: string | null; code: string | null } | null;
  actionType: string;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  startedAt: string;
  finishedAt: string;
}
interface SpendResponse {
  windowDays: number;
  since: string;
  totalsByModel: SpendByModelRow[];
  byBid: SpendByBidRow[];
  byProject: SpendByProjectRow[];
  byDraft: SpendByDraftRow[];
}

function AiSpendCard() {
  const [days, setDays] = useState<number>(30);
  const spendQuery = useQuery<SpendResponse>({
    queryKey: ["/api/ai-estimator/admin/spend", days],
    queryFn: async () => {
      const r = await apiRequest("GET", `/api/ai-estimator/admin/spend?days=${days}`);
      return (await r.json()) as SpendResponse;
    },
  });

  const totalCost =
    spendQuery.data?.totalsByModel.reduce((acc, r) => acc + Number(r.costUsd ?? 0), 0) ?? 0;
  const totalCalls =
    spendQuery.data?.totalsByModel.reduce((acc, r) => acc + Number(r.calls ?? 0), 0) ?? 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" /> AI Estimator drafter spend
          </CardTitle>
          <CardDescription>
            Live spend rollup from governed AI calls on the takeoff drafter (single-shot + map-reduce).
            Sourced from the `ai_action_audit` ledger.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-3 mb-4">
            <div className="space-y-1">
              <Label>Window</Label>
              <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
                <SelectTrigger className="w-40" data-testid="select-spend-window">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">Last 7 days</SelectItem>
                  <SelectItem value="30">Last 30 days</SelectItem>
                  <SelectItem value="90">Last 90 days</SelectItem>
                  <SelectItem value="365">Last 365 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-md border p-3 ml-auto">
              <div className="text-xs text-muted-foreground">Total spend</div>
              <div className="text-2xl font-bold tabular-nums" data-testid="text-spend-total-cost">
                ${totalCost.toFixed(4)}
              </div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">Total calls</div>
              <div className="text-2xl font-bold tabular-nums" data-testid="text-spend-total-calls">
                {totalCalls.toLocaleString()}
              </div>
            </div>
          </div>

          {spendQuery.isLoading ? (
            <Loader2 className="animate-spin h-5 w-5" />
          ) : (
            <>
              <h3 className="text-sm font-semibold mt-2 mb-2">By model + provider</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Model</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="text-right">Tokens in</TableHead>
                    <TableHead className="text-right">Tokens out</TableHead>
                    <TableHead className="text-right">Cost (USD)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(spendQuery.data?.totalsByModel ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground" data-testid="text-spend-empty">
                        No drafter spend in this window.
                      </TableCell>
                    </TableRow>
                  ) : (
                    spendQuery.data!.totalsByModel.map((r, i) => (
                      <TableRow key={`${r.model}-${r.provider}-${r.actionType}-${i}`} data-testid={`row-spend-model-${i}`}>
                        <TableCell className="font-mono text-xs">{r.model ?? "—"}</TableCell>
                        <TableCell className="font-mono text-xs">{r.provider ?? "—"}</TableCell>
                        <TableCell className="font-mono text-xs">{r.actionType}</TableCell>
                        <TableCell className="text-right tabular-nums">{Number(r.calls).toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums">{Number(r.tokensIn).toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums">{Number(r.tokensOut).toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums">${Number(r.costUsd).toFixed(4)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>

              <h3 className="text-sm font-semibold mt-6 mb-2">Top bids by spend</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Bid</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="text-right">Tokens in</TableHead>
                    <TableHead className="text-right">Tokens out</TableHead>
                    <TableHead className="text-right">Cost (USD)</TableHead>
                    <TableHead>Last run</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(spendQuery.data?.byBid ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground" data-testid="text-spend-by-bid-empty">
                        No bid-attributed drafter spend in this window.
                      </TableCell>
                    </TableRow>
                  ) : (
                    spendQuery.data!.byBid.map((r) => (
                      <TableRow key={r.bidId ?? "unknown"} data-testid={`row-spend-bid-${r.bidId ?? "unknown"}`}>
                        <TableCell>
                          <div className="font-medium">{r.bid?.name ?? "(unknown)"}</div>
                          <div className="text-xs text-muted-foreground font-mono">{r.bid?.code ?? r.bidId ?? "—"}</div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{Number(r.calls).toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums">{Number(r.tokensIn).toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums">{Number(r.tokensOut).toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums">${Number(r.costUsd).toFixed(4)}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs">{new Date(r.lastRunAt).toLocaleString()}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>

              {/* Task #2626 (rev 2) — per-project rollup. The drafter resolves
                  `projectId` from `bids.convertedToProjectId` so awarded bids
                  group under the project; un-awarded bids appear under
                  "(unattributed)". */}
              <h3 className="text-sm font-semibold mt-6 mb-2">Top projects by spend</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="text-right">Tokens in</TableHead>
                    <TableHead className="text-right">Tokens out</TableHead>
                    <TableHead className="text-right">Cost (USD)</TableHead>
                    <TableHead>Last run</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(spendQuery.data?.byProject ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground" data-testid="text-spend-by-project-empty">
                        No project-attributed drafter spend in this window.
                      </TableCell>
                    </TableRow>
                  ) : (
                    spendQuery.data!.byProject.map((r) => (
                      <TableRow key={r.projectId ?? "unattributed"} data-testid={`row-spend-project-${r.projectId ?? "unattributed"}`}>
                        <TableCell>
                          <div className="font-medium">{r.project?.name ?? (r.projectId ? "(unknown)" : "(unattributed)")}</div>
                          <div className="text-xs text-muted-foreground font-mono">{r.project?.code ?? r.projectId ?? "—"}</div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{Number(r.calls).toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums">{Number(r.tokensIn).toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums">{Number(r.tokensOut).toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums">${Number(r.costUsd).toFixed(4)}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs">{r.lastRunAt ? new Date(r.lastRunAt).toLocaleString() : "—"}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>

              {/* Per-draft rollup — one row per `draftId` (a single
                  `draftTakeoffFromPlans` / `mapReduceDraftFromPlans`
                  invocation). Lets admins isolate the cost of an
                  individual run instead of summing across the bid. */}
              <h3 className="text-sm font-semibold mt-6 mb-2">Recent drafts by spend</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Draft</TableHead>
                    <TableHead>Bid / Project</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="text-right">Tokens in</TableHead>
                    <TableHead className="text-right">Tokens out</TableHead>
                    <TableHead className="text-right">Cost (USD)</TableHead>
                    <TableHead>Finished</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(spendQuery.data?.byDraft ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground" data-testid="text-spend-by-draft-empty">
                        No draft-attributed drafter spend in this window.
                      </TableCell>
                    </TableRow>
                  ) : (
                    spendQuery.data!.byDraft.map((r) => (
                      <TableRow key={r.draftId ?? "unknown"} data-testid={`row-spend-draft-${r.draftId ?? "unknown"}`}>
                        <TableCell className="font-mono text-xs">{r.draftId ? r.draftId.slice(0, 8) : "—"}</TableCell>
                        <TableCell>
                          <div className="text-xs">{r.bid?.name ?? r.bidId ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">{r.project?.name ?? (r.projectId ? "(project)" : "")}</div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{r.actionType.replace("ai_estimator.", "")}</TableCell>
                        <TableCell className="text-right tabular-nums">{Number(r.calls).toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums">{Number(r.tokensIn).toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums">{Number(r.tokensOut).toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums">${Number(r.costUsd).toFixed(4)}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs">{r.finishedAt ? new Date(r.finishedAt).toLocaleString() : "—"}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
