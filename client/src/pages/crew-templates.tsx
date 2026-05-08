import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Users, Plus, Pencil, Trash2, Loader2, HardHat, Truck } from "lucide-react";

interface CrewTemplate {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  tradeType: string | null;
  description: string | null;
  defaultHoursPerDay: string;
  defaultProductionUnit: string | null;
  defaultProductionPerDay: string | null;
  isActive: boolean;
}

interface CrewWorker {
  id?: string;
  classificationLabel: string;
  count: number;
  hourlyRate: string;
  burdenPercent: string;
}

interface CrewEquipment {
  id?: string;
  equipmentLabel: string;
  count: number;
  dailyRate: string;
  fuelCostPerDay: string;
  notes?: string | null;
}

interface CrewDetail {
  template: CrewTemplate;
  workers: CrewWorker[];
  equipment: CrewEquipment[];
  cost: {
    laborCostPerDay: number;
    equipmentCostPerDay: number;
    totalCostPerDay: number;
  };
}

interface FormState {
  template: {
    code: string;
    name: string;
    tradeType: string;
    description: string;
    defaultHoursPerDay: string;
    defaultProductionUnit: string;
    defaultProductionPerDay: string;
    isActive: boolean;
  };
  workers: CrewWorker[];
  equipment: CrewEquipment[];
}

function emptyForm(): FormState {
  return {
    template: {
      code: "",
      name: "",
      tradeType: "",
      description: "",
      defaultHoursPerDay: "8.00",
      defaultProductionUnit: "",
      defaultProductionPerDay: "",
      isActive: true,
    },
    workers: [],
    equipment: [],
  };
}

function emptyWorker(): CrewWorker {
  return { classificationLabel: "", count: 1, hourlyRate: "0", burdenPercent: "0" };
}

function emptyEquipment(): CrewEquipment {
  return { equipmentLabel: "", count: 1, dailyRate: "0", fuelCostPerDay: "0", notes: "" };
}

function computeCost(workers: CrewWorker[], equipment: CrewEquipment[], hours: number) {
  let labor = 0;
  for (const w of workers) {
    const rate = Number(w.hourlyRate ?? 0);
    const burden = Number(w.burdenPercent ?? 0) / 100;
    labor += Number(w.count ?? 0) * rate * hours * (1 + burden);
  }
  let equip = 0;
  for (const e of equipment) {
    equip += Number(e.count ?? 0) * (Number(e.dailyRate ?? 0) + Number(e.fuelCostPerDay ?? 0));
  }
  return { labor, equip, total: labor + equip };
}

export default function CrewTemplatesPage() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: templates = [], isLoading } = useQuery<CrewTemplate[]>({
    queryKey: ["/api/estimating-crew-templates"],
  });

  const { data: detail } = useQuery<CrewDetail>({
    queryKey: ["/api/estimating-crew-templates", editingId],
    enabled: !!editingId,
  });

  useEffect(() => {
    if (detail && editingId) {
      setForm({
        template: {
          code: detail.template.code,
          name: detail.template.name,
          tradeType: detail.template.tradeType ?? "",
          description: detail.template.description ?? "",
          defaultHoursPerDay: String(detail.template.defaultHoursPerDay ?? "8.00"),
          defaultProductionUnit: detail.template.defaultProductionUnit ?? "",
          defaultProductionPerDay: detail.template.defaultProductionPerDay ?? "",
          isActive: detail.template.isActive,
        },
        workers: detail.workers.map((w) => ({
          classificationLabel: w.classificationLabel,
          count: Number(w.count),
          hourlyRate: String(w.hourlyRate),
          burdenPercent: String(w.burdenPercent),
        })),
        equipment: detail.equipment.map((e) => ({
          equipmentLabel: e.equipmentLabel,
          count: Number(e.count),
          dailyRate: String(e.dailyRate),
          fuelCostPerDay: String(e.fuelCostPerDay),
          notes: e.notes ?? "",
        })),
      });
    }
  }, [detail, editingId]);

  const createMutation = useMutation({
    mutationFn: async (data: FormState) => {
      const payload = {
        template: {
          ...data.template,
          tradeType: data.template.tradeType || null,
          description: data.template.description || null,
          defaultProductionUnit: data.template.defaultProductionUnit || null,
          defaultProductionPerDay: data.template.defaultProductionPerDay || null,
        },
        workers: data.workers,
        equipment: data.equipment,
      };
      const res = await apiRequest("POST", "/api/estimating-crew-templates", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/estimating-crew-templates"] });
      setDialogOpen(false);
      setForm(emptyForm());
      toast({ title: "Crew template created" });
    },
    onError: (err: Error) =>
      toast({ title: "Failed to create template", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: FormState }) => {
      const payload = {
        template: {
          ...data.template,
          tradeType: data.template.tradeType || null,
          description: data.template.description || null,
          defaultProductionUnit: data.template.defaultProductionUnit || null,
          defaultProductionPerDay: data.template.defaultProductionPerDay || null,
        },
        workers: data.workers,
        equipment: data.equipment,
      };
      const res = await apiRequest("PATCH", `/api/estimating-crew-templates/${id}`, payload);
      return res.json();
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/estimating-crew-templates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/estimating-crew-templates", vars.id] });
      setDialogOpen(false);
      setEditingId(null);
      setForm(emptyForm());
      toast({ title: "Crew template updated" });
    },
    onError: (err: Error) =>
      toast({ title: "Failed to update template", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/estimating-crew-templates/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/estimating-crew-templates"] });
      setDeleteId(null);
      toast({ title: "Crew template deleted" });
    },
    onError: (err: Error) =>
      toast({ title: "Failed to delete template", description: err.message, variant: "destructive" }),
  });

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm());
    setDialogOpen(true);
  }

  function openEdit(t: CrewTemplate) {
    setEditingId(t.id);
    setDialogOpen(true);
  }

  function submit() {
    if (!form.template.code.trim() || !form.template.name.trim()) {
      toast({ title: "Code and name are required", variant: "destructive" });
      return;
    }
    if (editingId) {
      updateMutation.mutate({ id: editingId, data: form });
    } else {
      createMutation.mutate(form);
    }
  }

  const liveCost = useMemo(
    () => computeCost(form.workers, form.equipment, Number(form.template.defaultHoursPerDay) || 8),
    [form],
  );

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <Users className="h-7 w-7" />
            Crew Templates
          </h1>
          <p className="text-muted-foreground mt-1">
            Reusable crew compositions for estimating — workers, equipment, and daily roll-up cost.
          </p>
        </div>
        <Button onClick={openCreate} data-testid="button-add-template">
          <Plus className="h-4 w-4 mr-2" />
          New Template
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Templates</CardTitle>
          <CardDescription>
            Click a template to edit its workers and equipment. Daily cost is recomputed automatically.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : templates.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground" data-testid="text-empty-templates">
              No crew templates yet. Create one to standardize your bid pricing.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Trade</TableHead>
                  <TableHead>Hours/Day</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.map((t) => (
                  <TableRow key={t.id} data-testid={`row-template-${t.id}`}>
                    <TableCell className="font-mono text-xs">{t.code}</TableCell>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell>{t.tradeType ?? "—"}</TableCell>
                    <TableCell>{Number(t.defaultHoursPerDay).toFixed(2)}</TableCell>
                    <TableCell>
                      {t.isActive ? (
                        <Badge>Active</Badge>
                      ) : (
                        <Badge variant="secondary">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openEdit(t)}
                        data-testid={`button-edit-${t.id}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setDeleteId(t.id)}
                        data-testid={`button-delete-${t.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) { setEditingId(null); setForm(emptyForm()); } }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Crew Template" : "New Crew Template"}</DialogTitle>
            <DialogDescription>
              Define crew composition. Labor cost = count × hourly × hours × (1 + burden). Equipment cost = count × (daily + fuel).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="tpl-code">Code</Label>
                <Input
                  id="tpl-code"
                  value={form.template.code}
                  onChange={(e) => setForm({ ...form, template: { ...form.template, code: e.target.value } })}
                  placeholder="e.g. CONC-CREW-A"
                  data-testid="input-template-code"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tpl-name">Name</Label>
                <Input
                  id="tpl-name"
                  value={form.template.name}
                  onChange={(e) => setForm({ ...form, template: { ...form.template, name: e.target.value } })}
                  placeholder="e.g. Concrete Pour Crew"
                  data-testid="input-template-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tpl-trade">Trade Type</Label>
                <Input
                  id="tpl-trade"
                  value={form.template.tradeType}
                  onChange={(e) => setForm({ ...form, template: { ...form.template, tradeType: e.target.value } })}
                  placeholder="e.g. Concrete"
                  data-testid="input-template-trade"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tpl-hours">Default Hours / Day</Label>
                <Input
                  id="tpl-hours"
                  type="number"
                  step="0.25"
                  value={form.template.defaultHoursPerDay}
                  onChange={(e) => setForm({ ...form, template: { ...form.template, defaultHoursPerDay: e.target.value } })}
                  data-testid="input-template-hours"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tpl-prod-unit">Production Unit</Label>
                <Input
                  id="tpl-prod-unit"
                  value={form.template.defaultProductionUnit}
                  onChange={(e) => setForm({ ...form, template: { ...form.template, defaultProductionUnit: e.target.value } })}
                  placeholder="e.g. CY, SF, LF"
                  data-testid="input-template-prod-unit"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tpl-prod-day">Production / Day</Label>
                <Input
                  id="tpl-prod-day"
                  type="number"
                  step="0.01"
                  value={form.template.defaultProductionPerDay}
                  onChange={(e) => setForm({ ...form, template: { ...form.template, defaultProductionPerDay: e.target.value } })}
                  data-testid="input-template-prod-day"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="tpl-desc">Description</Label>
              <Textarea
                id="tpl-desc"
                value={form.template.description}
                onChange={(e) => setForm({ ...form, template: { ...form.template, description: e.target.value } })}
                rows={2}
                data-testid="input-template-desc"
              />
            </div>

            <div className="flex items-center gap-3">
              <Switch
                id="tpl-active"
                checked={form.template.isActive}
                onCheckedChange={(v) => setForm({ ...form, template: { ...form.template, isActive: v } })}
                data-testid="switch-template-active"
              />
              <Label htmlFor="tpl-active">Active</Label>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold flex items-center gap-2">
                  <HardHat className="h-4 w-4" /> Workers
                </h3>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setForm({ ...form, workers: [...form.workers, emptyWorker()] })}
                  data-testid="button-add-worker"
                >
                  <Plus className="h-4 w-4 mr-1" /> Add Worker
                </Button>
              </div>
              {form.workers.length === 0 ? (
                <div className="text-sm text-muted-foreground italic">No workers added.</div>
              ) : (
                <div className="border rounded-md overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Classification</TableHead>
                        <TableHead className="w-20">Count</TableHead>
                        <TableHead className="w-28">Hourly Rate</TableHead>
                        <TableHead className="w-28">Burden %</TableHead>
                        <TableHead className="w-12"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {form.workers.map((w, i) => (
                        <TableRow key={i} data-testid={`row-worker-${i}`}>
                          <TableCell>
                            <Input
                              value={w.classificationLabel}
                              onChange={(e) => {
                                const next = [...form.workers];
                                next[i] = { ...next[i], classificationLabel: e.target.value };
                                setForm({ ...form, workers: next });
                              }}
                              placeholder="e.g. Foreman"
                              data-testid={`input-worker-label-${i}`}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min="0"
                              value={w.count}
                              onChange={(e) => {
                                const next = [...form.workers];
                                next[i] = { ...next[i], count: Number(e.target.value) || 0 };
                                setForm({ ...form, workers: next });
                              }}
                              data-testid={`input-worker-count-${i}`}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              step="0.01"
                              value={w.hourlyRate}
                              onChange={(e) => {
                                const next = [...form.workers];
                                next[i] = { ...next[i], hourlyRate: e.target.value };
                                setForm({ ...form, workers: next });
                              }}
                              data-testid={`input-worker-rate-${i}`}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              step="0.01"
                              value={w.burdenPercent}
                              onChange={(e) => {
                                const next = [...form.workers];
                                next[i] = { ...next[i], burdenPercent: e.target.value };
                                setForm({ ...form, workers: next });
                              }}
                              data-testid={`input-worker-burden-${i}`}
                            />
                          </TableCell>
                          <TableCell>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                setForm({ ...form, workers: form.workers.filter((_, j) => j !== i) })
                              }
                              data-testid={`button-remove-worker-${i}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold flex items-center gap-2">
                  <Truck className="h-4 w-4" /> Equipment
                </h3>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setForm({ ...form, equipment: [...form.equipment, emptyEquipment()] })}
                  data-testid="button-add-equipment"
                >
                  <Plus className="h-4 w-4 mr-1" /> Add Equipment
                </Button>
              </div>
              {form.equipment.length === 0 ? (
                <div className="text-sm text-muted-foreground italic">No equipment added.</div>
              ) : (
                <div className="border rounded-md overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Equipment</TableHead>
                        <TableHead className="w-20">Count</TableHead>
                        <TableHead className="w-28">Daily Rate</TableHead>
                        <TableHead className="w-28">Fuel/Day</TableHead>
                        <TableHead className="w-12"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {form.equipment.map((e, i) => (
                        <TableRow key={i} data-testid={`row-equipment-${i}`}>
                          <TableCell>
                            <Input
                              value={e.equipmentLabel}
                              onChange={(ev) => {
                                const next = [...form.equipment];
                                next[i] = { ...next[i], equipmentLabel: ev.target.value };
                                setForm({ ...form, equipment: next });
                              }}
                              placeholder="e.g. Skid Steer"
                              data-testid={`input-equipment-label-${i}`}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min="0"
                              value={e.count}
                              onChange={(ev) => {
                                const next = [...form.equipment];
                                next[i] = { ...next[i], count: Number(ev.target.value) || 0 };
                                setForm({ ...form, equipment: next });
                              }}
                              data-testid={`input-equipment-count-${i}`}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              step="0.01"
                              value={e.dailyRate}
                              onChange={(ev) => {
                                const next = [...form.equipment];
                                next[i] = { ...next[i], dailyRate: ev.target.value };
                                setForm({ ...form, equipment: next });
                              }}
                              data-testid={`input-equipment-rate-${i}`}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              step="0.01"
                              value={e.fuelCostPerDay}
                              onChange={(ev) => {
                                const next = [...form.equipment];
                                next[i] = { ...next[i], fuelCostPerDay: ev.target.value };
                                setForm({ ...form, equipment: next });
                              }}
                              data-testid={`input-equipment-fuel-${i}`}
                            />
                          </TableCell>
                          <TableCell>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                setForm({ ...form, equipment: form.equipment.filter((_, j) => j !== i) })
                              }
                              data-testid={`button-remove-equipment-${i}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>

            <Card className="bg-muted/40">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Daily Cost Roll-Up</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <div className="text-muted-foreground">Labor / Day</div>
                    <div className="text-lg font-semibold" data-testid="text-cost-labor">
                      ${liveCost.labor.toFixed(2)}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Equipment / Day</div>
                    <div className="text-lg font-semibold" data-testid="text-cost-equipment">
                      ${liveCost.equip.toFixed(2)}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Total / Day</div>
                    <div className="text-lg font-semibold" data-testid="text-cost-total">
                      ${liveCost.total.toFixed(2)}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} data-testid="button-cancel-template">
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={createMutation.isPending || updateMutation.isPending}
              data-testid="button-save-template"
            >
              {(createMutation.isPending || updateMutation.isPending) && (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              )}
              {editingId ? "Save Changes" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete crew template?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the template and its workers/equipment. Bids that already
              referenced it keep their snapshot values.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
