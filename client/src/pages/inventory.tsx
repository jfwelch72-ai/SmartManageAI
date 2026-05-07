import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/EmptyState";
import { Checkbox } from "@/components/ui/checkbox";
import { Boxes, Warehouse, Plus, ScanLine, ArrowDownToLine, ArrowUpFromLine, Repeat, AlertTriangle, ClipboardCheck, Smartphone, WifiOff, Printer } from "lucide-react";

type Material = {
  id: string; sku: string; barcode: string | null; name: string; uom: string;
  category: string | null; reorderPoint: string | null; isActive: boolean;
};
type Location = {
  id: string; code: string; name: string; type: string; isActive: boolean;
};
type StockRow = {
  id: string; materialId: string; locationId: string; onHand: string;
  sku: string; materialName: string; uom: string; reorderPoint: string | null;
  locationCode: string; locationName: string;
};
type LowStockRow = {
  materialId: string; sku: string; name: string; uom: string;
  reorderPoint: string | null; reorderQty: string | null; totalOnHand: string;
};
type SlowMovingRow = {
  materialId: string; sku: string; name: string; uom: string;
  totalOnHand: string; lastMovementAt: string | null;
};
type ProjectLite = { id: string; name: string; code: string; status: string };
type FieldDevice = { deviceId: string; platform: string; deviceModel: string | null; lastSyncAt: string | null };
type FieldTxn = {
  id: string; type: string; quantity: string; performedAt: string;
  referenceNumber: string | null; notes: string | null;
  materialId: string; materialSku: string; materialName: string; uom: string;
  locationId: string; locationCode: string; locationName: string;
  projectId: string | null; performedById: string; performerName: string;
  device: FieldDevice | null;
};
type StaleDevice = {
  id: string; deviceId: string; platform: string; deviceModel: string | null;
  lastSyncAt: string | null; userId: string; userName: string;
};
type FieldActivity = { transactions: FieldTxn[]; staleDevices: StaleDevice[]; staleThresholdHours: number };
type PoItemLite = {
  id: string; description: string | null; quantity: string;
  quantityReceived: string | null; unitOfMeasure: string | null;
};
type PoLite = {
  id: string; poNumber: string; status: string;
  project: { name: string; code: string } | null;
  vendor: { id: string; name: string } | null;
  items: PoItemLite[];
};

export default function InventoryPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState("stock");
  const [scanInput, setScanInput] = useState("");
  const [scanResult, setScanResult] = useState<{ material: Material; stock: StockRow[] } | null>(null);

  const locationsQ = useQuery<Location[]>({ queryKey: ["/api/inventory/locations"] });
  const materialsQ = useQuery<Material[]>({ queryKey: ["/api/inventory/materials"] });
  const stockQ = useQuery<StockRow[]>({ queryKey: ["/api/inventory/stock"] });
  const lowStockQ = useQuery<LowStockRow[]>({ queryKey: ["/api/inventory/reports/low-stock"] });
  const slowQ = useQuery<{ days: number; items: SlowMovingRow[] }>({ queryKey: ["/api/inventory/reports/slow-moving"] });
  const fieldQ = useQuery<FieldActivity>({ queryKey: ["/api/inventory/field-activity"] });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["/api/inventory/stock"] });
    qc.invalidateQueries({ queryKey: ["/api/inventory/reports/low-stock"] });
    qc.invalidateQueries({ queryKey: ["/api/inventory/reports/slow-moving"] });
    qc.invalidateQueries({ queryKey: ["/api/inventory/transactions"] });
    qc.invalidateQueries({ queryKey: ["/api/inventory/field-activity"] });
  };

  const handleScan = async () => {
    const code = scanInput.trim();
    if (!code) return;
    try {
      const res = await fetch(`/api/inventory/materials/by-barcode/${encodeURIComponent(code)}`, { credentials: "include" });
      if (!res.ok) {
        toast({ title: "Not found", description: "No material matched that code", variant: "destructive" });
        setScanResult(null);
        return;
      }
      setScanResult(await res.json());
    } catch {
      toast({ title: "Scan failed", variant: "destructive" });
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-full px-6 py-8 space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
          <div>
            <h1 className="text-3xl font-bold" data-testid="text-page-title">Materials Inventory</h1>
            <p className="text-muted-foreground">Warehouse / yard stock, receiving, issuing, and cycle counts</p>
          </div>
          <div className="flex gap-2">
            <NewLocationDialog onCreated={() => qc.invalidateQueries({ queryKey: ["/api/inventory/locations"] })} />
            <NewMaterialDialog onCreated={() => qc.invalidateQueries({ queryKey: ["/api/inventory/materials"] })} />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <StatCard icon={<Warehouse />} label="Locations" value={locationsQ.data?.length ?? 0} testid="stat-locations" />
          <StatCard icon={<Boxes />} label="SKUs" value={materialsQ.data?.length ?? 0} testid="stat-materials" />
          <StatCard icon={<AlertTriangle />} label="Low Stock" value={lowStockQ.data?.length ?? 0} accent={lowStockQ.data && lowStockQ.data.length > 0 ? "warn" : undefined} testid="stat-low-stock" />
          <StatCard icon={<ClipboardCheck />} label="Slow Moving" value={slowQ.data?.items?.length ?? 0} testid="stat-slow-moving" />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ScanLine className="w-5 h-5" /> Barcode / QR Scan</CardTitle>
            <CardDescription>Type or scan a barcode/SKU to look up a material and see on-hand by location</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Input value={scanInput} onChange={(e) => setScanInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleScan(); }}
                placeholder="Scan or type barcode / SKU"
                data-testid="input-scan" />
              <Button onClick={handleScan} data-testid="button-scan">Look up</Button>
            </div>
            {scanResult && (
              <div className="mt-4 p-3 border rounded-md" data-testid="result-scan">
                <div className="font-medium">{scanResult.material.name} <Badge variant="outline" className="ml-2">{scanResult.material.sku}</Badge></div>
                <div className="text-sm text-muted-foreground mt-1">UOM: {scanResult.material.uom}{scanResult.material.barcode ? ` · barcode ${scanResult.material.barcode}` : ""}</div>
                <div className="mt-2 text-sm">On-hand: {scanResult.stock.length === 0 ? <span className="text-muted-foreground">no stock recorded</span> : null}</div>
                {scanResult.stock.map(s => (
                  <div key={s.id} className="text-sm">{Number(s.onHand)} @ <span className="font-mono">{s.locationId}</span></div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <FieldActivityPanel data={fieldQ.data} loading={fieldQ.isLoading} />

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="stock" data-testid="tab-stock">On-Hand</TabsTrigger>
            <TabsTrigger value="receive" data-testid="tab-receive">Receive</TabsTrigger>
            <TabsTrigger value="issue" data-testid="tab-issue">Issue</TabsTrigger>
            <TabsTrigger value="transfer" data-testid="tab-transfer">Transfer</TabsTrigger>
            <TabsTrigger value="adjust" data-testid="tab-adjust">Adjust</TabsTrigger>
            <TabsTrigger value="labels" data-testid="tab-labels">Labels</TabsTrigger>
            <TabsTrigger value="reports" data-testid="tab-reports">Reports</TabsTrigger>
          </TabsList>

          <TabsContent value="stock">
            <Card>
              <CardHeader><CardTitle>Stock by Location</CardTitle></CardHeader>
              <CardContent>
                {stockQ.isLoading ? <div>Loading…</div> : (stockQ.data?.length ?? 0) === 0 ? (
                  <EmptyState icon={Boxes} title="No stock recorded" description="Add a location and material, then receive stock to populate this view." />
                ) : (
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>SKU</TableHead><TableHead>Material</TableHead>
                      <TableHead>Location</TableHead><TableHead className="text-right">On Hand</TableHead><TableHead>UOM</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {stockQ.data!.map(r => (
                        <TableRow key={r.id} data-testid={`row-stock-${r.id}`}>
                          <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                          <TableCell>{r.materialName}</TableCell>
                          <TableCell>{r.locationCode} — {r.locationName}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {Number(r.onHand)}{r.reorderPoint && Number(r.onHand) <= Number(r.reorderPoint) ? <Badge variant="destructive" className="ml-2">Low</Badge> : null}
                          </TableCell>
                          <TableCell>{r.uom}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="receive"><TxnForm kind="receive" locations={locationsQ.data ?? []} materials={materialsQ.data ?? []} onDone={invalidateAll} /></TabsContent>
          <TabsContent value="issue"><TxnForm kind="issue" locations={locationsQ.data ?? []} materials={materialsQ.data ?? []} onDone={invalidateAll} /></TabsContent>
          <TabsContent value="transfer"><TxnForm kind="transfer" locations={locationsQ.data ?? []} materials={materialsQ.data ?? []} onDone={invalidateAll} /></TabsContent>
          <TabsContent value="adjust"><TxnForm kind="adjust" locations={locationsQ.data ?? []} materials={materialsQ.data ?? []} onDone={invalidateAll} /></TabsContent>

          <TabsContent value="labels">
            <LabelsTab materials={materialsQ.data ?? []} onPrinted={() => qc.invalidateQueries({ queryKey: ["/api/inventory/materials"] })} />
          </TabsContent>

          <TabsContent value="reports">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-orange-500" /> Low Stock Alerts</CardTitle>
                  <CardDescription>SKUs at or below their reorder point</CardDescription></CardHeader>
                <CardContent>
                  {(lowStockQ.data?.length ?? 0) === 0 ? <div className="text-sm text-muted-foreground">All stocked items are above reorder point.</div> : (
                    <Table>
                      <TableHeader><TableRow><TableHead>SKU</TableHead><TableHead>Name</TableHead><TableHead className="text-right">On Hand</TableHead><TableHead className="text-right">Reorder Pt</TableHead></TableRow></TableHeader>
                      <TableBody>{lowStockQ.data!.map((r) => (
                        <TableRow key={r.materialId} data-testid={`row-low-${r.materialId}`}>
                          <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                          <TableCell>{r.name}</TableCell>
                          <TableCell className="text-right tabular-nums">{Number(r.totalOnHand)}</TableCell>
                          <TableCell className="text-right tabular-nums">{Number(r.reorderPoint)}</TableCell>
                        </TableRow>
                      ))}</TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>Slow-Moving Inventory</CardTitle>
                  <CardDescription>SKUs with stock and no issues in {slowQ.data?.days ?? 90} days</CardDescription></CardHeader>
                <CardContent>
                  {(slowQ.data?.items?.length ?? 0) === 0 ? <div className="text-sm text-muted-foreground">No slow-moving stock.</div> : (
                    <Table>
                      <TableHeader><TableRow><TableHead>SKU</TableHead><TableHead>Name</TableHead><TableHead className="text-right">On Hand</TableHead><TableHead>Last Move</TableHead></TableRow></TableHeader>
                      <TableBody>{slowQ.data!.items.map((r) => (
                        <TableRow key={r.materialId} data-testid={`row-slow-${r.materialId}`}>
                          <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                          <TableCell>{r.name}</TableCell>
                          <TableCell className="text-right tabular-nums">{Number(r.totalOnHand)}</TableCell>
                          <TableCell>{r.lastMovementAt ? new Date(r.lastMovementAt).toLocaleDateString() : "Never"}</TableCell>
                        </TableRow>
                      ))}</TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "just now";
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function FieldActivityPanel({ data, loading }: { data: FieldActivity | undefined; loading: boolean }) {
  const txns = data?.transactions ?? [];
  const stale = data?.staleDevices ?? [];
  const threshold = data?.staleThresholdHours ?? 24;
  return (
    <Card data-testid="card-field-activity">
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Smartphone className="w-5 h-5" /> From the Field
            </CardTitle>
            <CardDescription>Recent inventory activity from mobile devices and any trucks that haven&apos;t synced lately.</CardDescription>
          </div>
          {stale.length > 0 && (
            <Badge variant="destructive" className="self-start" data-testid="badge-stale-devices">
              <WifiOff className="w-3.5 h-3.5 mr-1" /> {stale.length} device{stale.length === 1 ? "" : "s"} not synced &gt;{threshold}h
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <div className="text-sm font-medium mb-2">Recent mobile transactions</div>
            {loading ? (
              <div className="text-sm text-muted-foreground">Loading…</div>
            ) : txns.length === 0 ? (
              <EmptyState icon={Smartphone} title="No mobile activity yet" description="Field crews haven't posted any inventory moves from their devices." />
            ) : (
              <div className="border rounded-md overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Material</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Performer</TableHead>
                      <TableHead>Device</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {txns.map(t => (
                      <TableRow key={t.id} data-testid={`row-field-txn-${t.id}`}>
                        <TableCell className="text-xs whitespace-nowrap" title={new Date(t.performedAt).toLocaleString()}>{timeAgo(t.performedAt)}</TableCell>
                        <TableCell><Badge variant="outline">{t.type}</Badge></TableCell>
                        <TableCell>
                          <div className="font-medium text-sm">{t.materialName}</div>
                          <div className="text-xs text-muted-foreground font-mono">{t.materialSku}</div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{Number(t.quantity)} {t.uom}</TableCell>
                        <TableCell className="text-xs">{t.locationCode} — {t.locationName}</TableCell>
                        <TableCell className="text-sm">{t.performerName}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {t.device ? (
                            <>
                              <div>{t.device.platform}{t.device.deviceModel ? ` · ${t.device.deviceModel}` : ""}</div>
                              <div>synced {timeAgo(t.device.lastSyncAt)}</div>
                            </>
                          ) : (
                            <span>—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
          <div>
            <div className="text-sm font-medium mb-2 flex items-center gap-2">
              <WifiOff className="w-4 h-4" /> Devices behind on sync
            </div>
            {loading ? (
              <div className="text-sm text-muted-foreground">Loading…</div>
            ) : stale.length === 0 ? (
              <div className="text-sm text-muted-foreground" data-testid="text-no-stale-devices">All registered devices have synced in the last {threshold}h.</div>
            ) : (
              <div className="space-y-2">
                {stale.map(d => (
                  <div key={d.id} className="border rounded-md p-2" data-testid={`row-stale-device-${d.id}`}>
                    <div className="text-sm font-medium">{d.userName}</div>
                    <div className="text-xs text-muted-foreground">{d.platform}{d.deviceModel ? ` · ${d.deviceModel}` : ""}</div>
                    <div className="text-xs text-muted-foreground">Last sync: {d.lastSyncAt ? `${timeAgo(d.lastSyncAt)} (${new Date(d.lastSyncAt).toLocaleString()})` : "never"}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatCard({ icon, label, value, accent, testid }: { icon: React.ReactNode; label: string; value: number | string; accent?: "warn"; testid: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-muted-foreground">{label}</div>
            <div className={`text-2xl font-semibold ${accent === "warn" ? "text-orange-600" : ""}`} data-testid={testid}>{value}</div>
          </div>
          <div className="text-muted-foreground">{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function NewLocationDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", type: "WAREHOUSE", address: "", notes: "" });
  const { toast } = useToast();
  const create = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/inventory/locations", form),
    onSuccess: () => { toast({ title: "Location created" }); setOpen(false); setForm({ code: "", name: "", type: "WAREHOUSE", address: "", notes: "" }); onCreated(); },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline" data-testid="button-new-location"><Plus className="w-4 h-4 mr-1" />Location</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New Location</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Code</Label><Input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} data-testid="input-location-code" /></div>
          <div><Label>Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} data-testid="input-location-name" /></div>
          <div><Label>Type</Label>
            <Select value={form.type} onValueChange={v => setForm({ ...form, type: v })}>
              <SelectTrigger data-testid="select-location-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="WAREHOUSE">Warehouse</SelectItem>
                <SelectItem value="YARD">Yard</SelectItem>
                <SelectItem value="JOBSITE">Jobsite</SelectItem>
                <SelectItem value="TRUCK">Truck</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>Address</Label><Input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></div>
          <div><Label>Notes</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
        </div>
        <DialogFooter><Button onClick={() => create.mutate()} disabled={create.isPending || !form.code || !form.name} data-testid="button-save-location">Create</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewMaterialDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ sku: "", barcode: "", name: "", uom: "EA", category: "", unitCost: "", reorderPoint: "", reorderQty: "" });
  const { toast } = useToast();
  const create = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/inventory/materials", {
      ...form,
      barcode: form.barcode || null,
      category: form.category || null,
      unitCost: form.unitCost || null,
      reorderPoint: form.reorderPoint || null,
      reorderQty: form.reorderQty || null,
    }),
    onSuccess: () => { toast({ title: "Material created" }); setOpen(false); setForm({ sku: "", barcode: "", name: "", uom: "EA", category: "", unitCost: "", reorderPoint: "", reorderQty: "" }); onCreated(); },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button data-testid="button-new-material"><Plus className="w-4 h-4 mr-1" />Material</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New Material / SKU</DialogTitle></DialogHeader>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>SKU</Label><Input value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} data-testid="input-material-sku" /></div>
            <div><Label>Barcode / QR</Label><Input value={form.barcode} onChange={e => setForm({ ...form, barcode: e.target.value })} data-testid="input-material-barcode" /></div>
          </div>
          <div><Label>Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} data-testid="input-material-name" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>UOM</Label><Input value={form.uom} onChange={e => setForm({ ...form, uom: e.target.value })} placeholder="EA, FT, LB, GAL" /></div>
            <div><Label>Category</Label><Input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Unit Cost</Label><Input type="number" step="0.01" value={form.unitCost} onChange={e => setForm({ ...form, unitCost: e.target.value })} /></div>
            <div><Label>Reorder Point</Label><Input type="number" step="0.01" value={form.reorderPoint} onChange={e => setForm({ ...form, reorderPoint: e.target.value })} /></div>
            <div><Label>Reorder Qty</Label><Input type="number" step="0.01" value={form.reorderQty} onChange={e => setForm({ ...form, reorderQty: e.target.value })} /></div>
          </div>
        </div>
        <DialogFooter><Button onClick={() => create.mutate()} disabled={create.isPending || !form.sku || !form.name} data-testid="button-save-material">Create</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TxnForm({ kind, locations, materials, onDone }: {
  kind: "receive" | "issue" | "transfer" | "adjust";
  locations: Location[]; materials: Material[]; onDone: () => void;
}) {
  const { toast } = useToast();
  const [materialId, setMaterialId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [toLocationId, setToLocationId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [projectId, setProjectId] = useState("");
  const [poId, setPoId] = useState("");
  const [poItemId, setPoItemId] = useState("");
  const [costCode, setCostCode] = useState("");
  const [reason, setReason] = useState("CORRECTION");
  const [notes, setNotes] = useState("");
  const [reference, setReference] = useState("");

  const projectsQ = useQuery<{ data: ProjectLite[] }>({
    queryKey: ["/api/projects", { limit: "200" }],
    enabled: kind === "issue",
  });
  const posQ = useQuery<PoLite[]>({
    queryKey: ["/api/procurement-module/orders"],
    enabled: kind === "receive",
  });
  const selectedPo = posQ.data?.find(p => p.id === poId);

  const submit = useMutation({
    mutationFn: async () => {
      const qty = Number(quantity);
      if (!materialId || !locationId || !qty) throw new Error("Material, location, and quantity are required");
      switch (kind) {
        case "receive":
          return apiRequest("POST", "/api/inventory/receive", {
            materialId, locationId, quantity: qty, unitCost: unitCost ? Number(unitCost) : undefined,
            poId: poId || undefined, poItemId: poItemId || undefined,
            referenceNumber: reference || undefined, notes: notes || undefined,
          });
        case "issue":
          if (!projectId) throw new Error("Project is required for an issue");
          return apiRequest("POST", "/api/inventory/issue", {
            materialId, locationId, quantity: qty, projectId, costCode: costCode || undefined,
            referenceNumber: reference || undefined, notes: notes || undefined,
          });
        case "transfer":
          if (!toLocationId) throw new Error("Destination location is required");
          return apiRequest("POST", "/api/inventory/transfer", {
            materialId, fromLocationId: locationId, toLocationId, quantity: qty,
            referenceNumber: reference || undefined, notes: notes || undefined,
          });
        case "adjust":
          if (!notes) throw new Error("Reason note is required");
          return apiRequest("POST", "/api/inventory/adjust", {
            materialId, locationId, quantity: qty, adjustReason: reason, notes,
          });
      }
    },
    onSuccess: () => {
      toast({ title: "Recorded", description: `${kind} posted to ledger` });
      setQuantity(""); setUnitCost(""); setReference(""); setNotes("");
      setPoId(""); setPoItemId("");
      onDone();
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const ICONS = { receive: ArrowDownToLine, issue: ArrowUpFromLine, transfer: Repeat, adjust: AlertTriangle };
  const Icon = ICONS[kind];
  const titles = { receive: "Receive Stock", issue: "Issue to Project", transfer: "Transfer Between Locations", adjust: "Adjust (with reason)" };

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Icon className="w-5 h-5" /> {titles[kind]}</CardTitle></CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label>Material</Label>
            <Select value={materialId} onValueChange={setMaterialId}>
              <SelectTrigger data-testid={`select-${kind}-material`}><SelectValue placeholder="Select material" /></SelectTrigger>
              <SelectContent>{materials.map(m => <SelectItem key={m.id} value={m.id}>{m.sku} — {m.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>{kind === "transfer" ? "From Location" : "Location"}</Label>
            <Select value={locationId} onValueChange={setLocationId}>
              <SelectTrigger data-testid={`select-${kind}-location`}><SelectValue placeholder="Select location" /></SelectTrigger>
              <SelectContent>{locations.map(l => <SelectItem key={l.id} value={l.id}>{l.code} — {l.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {kind === "transfer" && (
            <div>
              <Label>To Location</Label>
              <Select value={toLocationId} onValueChange={setToLocationId}>
                <SelectTrigger data-testid={`select-${kind}-to-location`}><SelectValue placeholder="Destination" /></SelectTrigger>
                <SelectContent>{locations.filter(l => l.id !== locationId).map(l => <SelectItem key={l.id} value={l.id}>{l.code} — {l.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label>Quantity{kind === "adjust" ? " (signed: + add, − remove)" : ""}</Label>
            <Input type="number" step="0.01" value={quantity} onChange={e => setQuantity(e.target.value)} data-testid={`input-${kind}-quantity`} />
          </div>
          {kind === "receive" && (
            <>
              <div>
                <Label>Unit Cost</Label>
                <Input type="number" step="0.01" value={unitCost} onChange={e => setUnitCost(e.target.value)} data-testid="input-receive-unit-cost" />
              </div>
              <div>
                <Label>Purchase Order (optional)</Label>
                <Select value={poId || "__none"} onValueChange={(v) => { const next = v === "__none" ? "" : v; setPoId(next); setPoItemId(""); }}>
                  <SelectTrigger data-testid="select-receive-po"><SelectValue placeholder="No PO" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">— No PO —</SelectItem>
                    {(posQ.data ?? []).filter(p => ["APPROVED", "SENT", "PARTIALLY_RECEIVED"].includes(p.status)).map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.poNumber} — {p.vendor?.name ?? "Vendor"}{p.project ? ` · ${p.project.code}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {selectedPo && selectedPo.items.length > 0 && (
                <div className="md:col-span-2">
                  <Label>PO Line Item</Label>
                  <Select value={poItemId || "__none"} onValueChange={(v) => setPoItemId(v === "__none" ? "" : v)}>
                    <SelectTrigger data-testid="select-receive-po-item"><SelectValue placeholder="Select PO line" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">— None (receive against PO header only) —</SelectItem>
                      {selectedPo.items.map(it => {
                        const ord = Number(it.quantity);
                        const rcv = Number(it.quantityReceived ?? 0);
                        const remain = ord - rcv;
                        return (
                          <SelectItem key={it.id} value={it.id}>
                            {(it.description ?? "Item")} · ordered {ord}{it.unitOfMeasure ? ` ${it.unitOfMeasure}` : ""} · received {rcv} · remaining {remain}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </>
          )}
          {kind === "issue" && (
            <>
              <div>
                <Label>Project</Label>
                <Select value={projectId} onValueChange={setProjectId}>
                  <SelectTrigger data-testid="select-issue-project"><SelectValue placeholder={projectsQ.isLoading ? "Loading…" : "Select project"} /></SelectTrigger>
                  <SelectContent>
                    {(projectsQ.data?.data ?? []).map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Cost Code</Label>
                <Input value={costCode} onChange={e => setCostCode(e.target.value)} data-testid="input-issue-cost-code" />
              </div>
            </>
          )}
          {kind === "adjust" && (
            <div>
              <Label>Reason</Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger data-testid="select-adjust-reason"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["DAMAGE", "LOSS", "FOUND", "RETURN", "CORRECTION", "EXPIRED", "OTHER"].map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label>Reference #</Label>
            <Input value={reference} onChange={e => setReference(e.target.value)} placeholder="Packing slip / MR-#" data-testid={`input-${kind}-reference`} />
          </div>
          <div className="md:col-span-2">
            <Label>{kind === "adjust" ? "Reason note (required)" : "Notes"}</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} data-testid={`input-${kind}-notes`} />
          </div>
        </div>
        <div className="mt-4">
          <Button onClick={() => submit.mutate()} disabled={submit.isPending} data-testid={`button-submit-${kind}`}>
            {submit.isPending ? "Posting…" : `Post ${kind}`}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function LabelsTab({ materials, onPrinted }: { materials: Material[]; onPrinted: () => void }) {
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [symbology, setSymbology] = useState<"code128" | "qr">("code128");
  const [copies, setCopies] = useState("1");
  const [startOffset, setStartOffset] = useState("0");
  const [search, setSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const filtered = materials.filter(m => {
    if (!m.isActive) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return m.name.toLowerCase().includes(q) || m.sku.toLowerCase().includes(q) || (m.barcode ?? "").toLowerCase().includes(q);
  });

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };
  const allShownSelected = filtered.length > 0 && filtered.every(m => selected.has(m.id));
  const toggleAllShown = () => {
    const next = new Set(selected);
    if (allShownSelected) filtered.forEach(m => next.delete(m.id));
    else filtered.forEach(m => next.add(m.id));
    setSelected(next);
  };

  const print = async () => {
    if (selected.size === 0) {
      toast({ title: "Select at least one material", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/inventory/labels", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          materialIds: Array.from(selected),
          symbology,
          copies: Math.max(1, Math.min(30, Number(copies) || 1)),
          startOffset: Math.max(0, Math.min(29, Number(startOffset) || 0)),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.formErrors?.[0] ?? err.error ?? "Failed to generate labels");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `inventory-labels-${Date.now()}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: "Labels generated", description: `${selected.size} material(s) · ${copies}× each` });
      onPrinted();
    } catch (e) {
      toast({ title: "Print failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Printer className="w-5 h-5" /> Print Barcode / QR Labels</CardTitle>
        <CardDescription>
          Select materials and produce a printable PDF on Avery 5160 (3×10) sheets.
          Materials without a barcode are auto-assigned one (saved to the SKU) before printing.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
          <div className="md:col-span-2">
            <Label>Search</Label>
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter by SKU, name, or barcode" data-testid="input-labels-search" />
          </div>
          <div>
            <Label>Symbology</Label>
            <Select value={symbology} onValueChange={(v) => setSymbology(v as "code128" | "qr")}>
              <SelectTrigger data-testid="select-labels-symbology"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="code128">Code-128 (1-D)</SelectItem>
                <SelectItem value="qr">QR Code</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Copies / SKU</Label>
              <Input type="number" min={1} max={30} value={copies} onChange={e => setCopies(e.target.value)} data-testid="input-labels-copies" />
            </div>
            <div>
              <Label>Skip first</Label>
              <Input type="number" min={0} max={29} value={startOffset} onChange={e => setStartOffset(e.target.value)} data-testid="input-labels-offset" />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between mb-2">
          <div className="text-sm text-muted-foreground" data-testid="text-labels-selected">
            {selected.size} selected · {filtered.length} shown
          </div>
          <Button onClick={print} disabled={submitting || selected.size === 0} data-testid="button-print-labels">
            <Printer className="w-4 h-4 mr-1" />{submitting ? "Generating…" : "Print PDF"}
          </Button>
        </div>

        {filtered.length === 0 ? (
          <EmptyState icon={Boxes} title="No materials" description="Create materials to print barcode labels." />
        ) : (
          <div className="border rounded-md max-h-[480px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox checked={allShownSelected} onCheckedChange={toggleAllShown} data-testid="checkbox-labels-all" />
                  </TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Barcode</TableHead>
                  <TableHead>UOM</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(m => (
                  <TableRow key={m.id} data-testid={`row-label-${m.id}`}>
                    <TableCell>
                      <Checkbox checked={selected.has(m.id)} onCheckedChange={() => toggle(m.id)} data-testid={`checkbox-label-${m.id}`} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{m.sku}</TableCell>
                    <TableCell>{m.name}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {m.barcode ?? <span className="text-muted-foreground italic">auto-assign</span>}
                    </TableCell>
                    <TableCell>{m.uom}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

