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
import { Boxes, Warehouse, Plus, ScanLine, ArrowDownToLine, ArrowUpFromLine, Repeat, AlertTriangle, ClipboardCheck } from "lucide-react";

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

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["/api/inventory/stock"] });
    qc.invalidateQueries({ queryKey: ["/api/inventory/reports/low-stock"] });
    qc.invalidateQueries({ queryKey: ["/api/inventory/reports/slow-moving"] });
    qc.invalidateQueries({ queryKey: ["/api/inventory/transactions"] });
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

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="stock" data-testid="tab-stock">On-Hand</TabsTrigger>
            <TabsTrigger value="receive" data-testid="tab-receive">Receive</TabsTrigger>
            <TabsTrigger value="issue" data-testid="tab-issue">Issue</TabsTrigger>
            <TabsTrigger value="transfer" data-testid="tab-transfer">Transfer</TabsTrigger>
            <TabsTrigger value="adjust" data-testid="tab-adjust">Adjust</TabsTrigger>
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
