import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/hooks/use-auth";
import {
  useOvertimeRules,
  useCreateOvertimeRule,
  useUpdateOvertimeRule,
  useDeleteOvertimeRule,
  useProjects,
} from "@/hooks/use-data";
import type { OvertimeRuleResponse } from "@/hooks/use-data";
import { useToast } from "@/hooks/use-toast";
import { Clock, Plus, Pencil, Trash2, Settings, Building2, FolderOpen } from "lucide-react";

interface RuleFormData {
  projectId: string;
  dailyOtThreshold: string;
  dailyDtThreshold: string;
  weeklyOtThreshold: string;
  weeklyDtThreshold: string;
  otMultiplier: string;
  dtMultiplier: string;
  consecutiveDayRule: boolean;
  consecutiveDayThreshold: string;
}

const defaultForm: RuleFormData = {
  projectId: "",
  dailyOtThreshold: "8",
  dailyDtThreshold: "12",
  weeklyOtThreshold: "40",
  weeklyDtThreshold: "60",
  otMultiplier: "1.5",
  dtMultiplier: "2.0",
  consecutiveDayRule: false,
  consecutiveDayThreshold: "7",
};

export default function OvertimeRulesPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<RuleFormData>(defaultForm);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const { data: rules = [], isLoading } = useOvertimeRules();
  const { data: projects = [] } = useProjects();
  const createRule = useCreateOvertimeRule();
  const updateRule = useUpdateOvertimeRule();
  const deleteRule = useDeleteOvertimeRule();

  const handleOpenCreate = () => {
    setForm(defaultForm);
    setEditingId(null);
    setDialogOpen(true);
  };

  const handleOpenEdit = (rule: OvertimeRuleResponse) => {
    setForm({
      projectId: rule.projectId || "",
      dailyOtThreshold: String(rule.dailyOtThreshold ?? 8),
      dailyDtThreshold: String(rule.dailyDtThreshold ?? 12),
      weeklyOtThreshold: String(rule.weeklyOtThreshold ?? 40),
      weeklyDtThreshold: String(rule.weeklyDtThreshold ?? 60),
      otMultiplier: String(rule.otMultiplier ?? 1.5),
      dtMultiplier: String(rule.dtMultiplier ?? 2.0),
      consecutiveDayRule: rule.consecutiveDayRule ?? false,
      consecutiveDayThreshold: String(rule.consecutiveDayThreshold ?? 7),
    });
    setEditingId(rule.id);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    const payload = {
      projectId: form.projectId || null,
      dailyOtThreshold: parseFloat(form.dailyOtThreshold),
      dailyDtThreshold: parseFloat(form.dailyDtThreshold),
      weeklyOtThreshold: parseFloat(form.weeklyOtThreshold),
      weeklyDtThreshold: parseFloat(form.weeklyDtThreshold),
      otMultiplier: parseFloat(form.otMultiplier),
      dtMultiplier: parseFloat(form.dtMultiplier),
      consecutiveDayRule: form.consecutiveDayRule,
      consecutiveDayThreshold: parseInt(form.consecutiveDayThreshold),
    };

    try {
      if (editingId) {
        await updateRule.mutateAsync({ id: editingId, ...payload });
        toast({ title: "Overtime rule updated" });
      } else {
        await createRule.mutateAsync(payload);
        toast({ title: "Overtime rule created" });
      }
      setDialogOpen(false);
      setEditingId(null);
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Failed to save", variant: "destructive" });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteRule.mutateAsync(id);
      toast({ title: "Overtime rule deleted" });
      setDeleteConfirmId(null);
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Failed to save", variant: "destructive" });
    }
  };

  const getProjectName = (projectId: string | null) => {
    if (!projectId) return null;
    const p = projects.find((proj) => proj.id === projectId);
    return p ? `${p.name} (${p.code})` : projectId;
  };

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-full px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground mb-1" data-testid="text-page-title">
              Overtime Rules
            </h1>
            <p className="text-sm text-muted-foreground">
              Configure daily and weekly overtime thresholds and multipliers
            </p>
          </div>
          <Button onClick={handleOpenCreate} data-testid="button-create-rule">
            <Plus className="w-4 h-4 mr-2" />
            Add Rule
          </Button>
        </div>

        <Card data-testid="card-overtime-rules">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5" />
              Overtime Configuration
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-12 text-muted-foreground">Loading rules...</div>
            ) : rules.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Clock className="w-8 h-8 mx-auto mb-3 opacity-50" />
                <p>No overtime rules configured yet.</p>
                <p className="text-xs mt-1">Default: 8h daily / 40h weekly OT at 1.5x</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead>Daily OT</TableHead>
                    <TableHead>Daily DT</TableHead>
                    <TableHead>Weekly OT</TableHead>
                    <TableHead>Weekly DT</TableHead>
                    <TableHead>OT Rate</TableHead>
                    <TableHead>DT Rate</TableHead>
                    <TableHead>Consec. Days</TableHead>
                    <TableHead className="w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rules.map((rule) => (
                    <TableRow key={rule.id} data-testid={`row-rule-${rule.id}`}>
                      <TableCell className="font-medium" data-testid={`cell-name-${rule.id}`}>
                        {rule.projectId ? "Project Override" : "Organization Default"}
                      </TableCell>
                      <TableCell data-testid={`cell-scope-${rule.id}`}>
                        {rule.projectId ? (
                          <Badge variant="outline" className="gap-1">
                            <FolderOpen className="w-3 h-3" />
                            {getProjectName(rule.projectId)}
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="gap-1">
                            <Building2 className="w-3 h-3" />
                            Organization
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>{rule.dailyOtThreshold}h</TableCell>
                      <TableCell>{rule.dailyDtThreshold}h</TableCell>
                      <TableCell>{rule.weeklyOtThreshold}h</TableCell>
                      <TableCell>{rule.weeklyDtThreshold}h</TableCell>
                      <TableCell>{rule.otMultiplier}x</TableCell>
                      <TableCell>{rule.dtMultiplier}x</TableCell>
                      <TableCell data-testid={`cell-consec-${rule.id}`}>
                        {rule.consecutiveDayRule ? (
                          <Badge variant="outline" className="text-xs">
                            {rule.consecutiveDayThreshold}+ days
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">Off</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleOpenEdit(rule)}
                            data-testid={`button-edit-rule-${rule.id}`}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            onClick={() => setDeleteConfirmId(rule.id)}
                            data-testid={`button-delete-rule-${rule.id}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">How Overtime Rules Work</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>Rules are evaluated during pay run generation. Project-specific rules override the organization-level default.</p>
            <p><strong>Daily OT Threshold:</strong> Hours per day before overtime kicks in (default 8h).</p>
            <p><strong>Daily DT Threshold:</strong> Hours per day before double-time kicks in (default 12h).</p>
            <p><strong>Weekly OT Threshold:</strong> Total weekly hours before overtime applies (default 40h).</p>
            <p><strong>Weekly DT Threshold:</strong> Total weekly hours before double-time applies (default 60h).</p>
          </CardContent>
        </Card>
      </main>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent data-testid="dialog-overtime-rule">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5" />
              {editingId ? "Edit Overtime Rule" : "New Overtime Rule"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Scope</Label>
              <Select
                value={form.projectId || "__org__"}
                onValueChange={(v) => setForm({ ...form, projectId: v === "__org__" ? "" : v })}
              >
                <SelectTrigger data-testid="select-rule-scope">
                  <SelectValue placeholder="Organization-wide" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__org__">Organization-wide (default)</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Daily OT Threshold (hrs)</Label>
                <Input
                  type="number"
                  step="0.5"
                  value={form.dailyOtThreshold}
                  onChange={(e) => setForm({ ...form, dailyOtThreshold: e.target.value })}
                  data-testid="input-daily-ot"
                />
              </div>
              <div className="space-y-1">
                <Label>Daily DT Threshold (hrs)</Label>
                <Input
                  type="number"
                  step="0.5"
                  value={form.dailyDtThreshold}
                  onChange={(e) => setForm({ ...form, dailyDtThreshold: e.target.value })}
                  data-testid="input-daily-dt"
                />
              </div>
              <div className="space-y-1">
                <Label>Weekly OT Threshold (hrs)</Label>
                <Input
                  type="number"
                  step="0.5"
                  value={form.weeklyOtThreshold}
                  onChange={(e) => setForm({ ...form, weeklyOtThreshold: e.target.value })}
                  data-testid="input-weekly-ot"
                />
              </div>
              <div className="space-y-1">
                <Label>Weekly DT Threshold (hrs)</Label>
                <Input
                  type="number"
                  step="0.5"
                  value={form.weeklyDtThreshold}
                  onChange={(e) => setForm({ ...form, weeklyDtThreshold: e.target.value })}
                  data-testid="input-weekly-dt"
                />
              </div>
              <div className="space-y-1">
                <Label>OT Multiplier</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={form.otMultiplier}
                  onChange={(e) => setForm({ ...form, otMultiplier: e.target.value })}
                  data-testid="input-ot-multiplier"
                />
              </div>
              <div className="space-y-1">
                <Label>DT Multiplier</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={form.dtMultiplier}
                  onChange={(e) => setForm({ ...form, dtMultiplier: e.target.value })}
                  data-testid="input-dt-multiplier"
                />
              </div>
            </div>

            <div className="border-t pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Consecutive Day Rule</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Apply double-time after consecutive working days
                  </p>
                </div>
                <Button
                  type="button"
                  variant={form.consecutiveDayRule ? "default" : "outline"}
                  size="sm"
                  onClick={() => setForm({ ...form, consecutiveDayRule: !form.consecutiveDayRule })}
                  data-testid="button-consecutive-day"
                >
                  {form.consecutiveDayRule ? "Enabled" : "Disabled"}
                </Button>
              </div>
              {form.consecutiveDayRule && (
                <div className="space-y-1">
                  <Label>Consecutive Days Threshold</Label>
                  <Input
                    type="number"
                    step="1"
                    min="1"
                    value={form.consecutiveDayThreshold}
                    onChange={(e) => setForm({ ...form, consecutiveDayThreshold: e.target.value })}
                    data-testid="input-consecutive-days"
                  />
                  <p className="text-xs text-muted-foreground">
                    Number of consecutive days before all hours become double-time
                  </p>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} data-testid="button-rule-cancel">
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={createRule.isPending || updateRule.isPending}
              data-testid="button-rule-save"
            >
              {(createRule.isPending || updateRule.isPending) ? "Saving..." : editingId ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <DialogContent data-testid="dialog-delete-confirm">
          <DialogHeader>
            <DialogTitle>Delete Overtime Rule</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete this overtime rule? This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)} data-testid="button-delete-cancel">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirmId && handleDelete(deleteConfirmId)}
              disabled={deleteRule.isPending}
              data-testid="button-delete-confirm"
            >
              {deleteRule.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
