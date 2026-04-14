import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Plus, HardHat, CheckCircle2, XCircle, Loader2, Trash2, Shield, AlertTriangle,
} from "lucide-react";

interface PpeComplianceLog {
  id: string;
  projectId: string;
  checkDate: string;
  workerName: string;
  workerUserId: string | null;
  ppeType: string;
  complianceStatus: string;
  notes: string | null;
  checkedById: string;
  createdAt: string;
}

interface PpeComplianceSectionProps {
  projectId: string;
  projectCode: string;
  userRole: string;
}

const PPE_TYPE_OPTIONS = [
  { value: "HARD_HAT", label: "Hard Hat" },
  { value: "SAFETY_VEST", label: "Safety Vest" },
  { value: "GLOVES", label: "Gloves" },
  { value: "EYE_PROTECTION", label: "Eye Protection" },
  { value: "STEEL_TOES", label: "Steel Toes" },
  { value: "FALL_PROTECTION", label: "Fall Protection" },
];

const STATUS_OPTIONS = [
  { value: "COMPLIANT", label: "Compliant" },
  { value: "VIOLATION", label: "Violation" },
];

function isManagement(role: string) {
  return ["ADMIN", "MANAGER", "SUPERINTENDENT"].includes(role);
}

export default function PpeComplianceSection({ projectId, projectCode, userRole }: PpeComplianceSectionProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [showCreate, setShowCreate] = useState(false);
  const [dateFilter, setDateFilter] = useState("");
  const [ppeFilter, setPpeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const emptyForm = {
    checkDate: new Date().toISOString().split("T")[0],
    workerName: "",
    workerUserId: "",
    ppeType: "",
    complianceStatus: "COMPLIANT",
    notes: "",
  };
  const [form, setForm] = useState(emptyForm);

  const qk = ["/api/projects", projectCode, "ppe-compliance"];

  const { data: logs = [], isLoading } = useQuery<PpeComplianceLog[]>({
    queryKey: qk,
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectCode}/ppe-compliance`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to fetch PPE compliance logs");
      return r.json();
    },
    enabled: !!projectCode,
  });

  const { data: orgUsers = [] } = useQuery<Array<{ id: string; firstName: string; lastName: string }>>({
    queryKey: ["/api/users"],
    queryFn: async () => {
      const r = await fetch("/api/users", { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: qk });

  const createMutation = useMutation({
    mutationFn: (data: typeof form) =>
      apiRequest("POST", `/api/projects/${projectCode}/ppe-compliance`, {
        ...data,
        workerUserId: data.workerUserId || null,
        notes: data.notes || null,
      }),
    onSuccess: () => {
      invalidate();
      setShowCreate(false);
      setForm(emptyForm);
      toast({ title: "PPE check logged" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/projects/${projectCode}/ppe-compliance/${id}`),
    onSuccess: () => {
      invalidate();
      toast({ title: "PPE check log deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const filteredLogs = logs.filter((l) => {
    if (dateFilter && l.checkDate !== dateFilter) return false;
    if (ppeFilter !== "all" && l.ppeType !== ppeFilter) return false;
    if (statusFilter !== "all" && l.complianceStatus !== statusFilter) return false;
    return true;
  });

  const totalChecks = logs.length;
  const compliantCount = logs.filter((l) => l.complianceStatus === "COMPLIANT").length;
  const violationCount = logs.filter((l) => l.complianceStatus === "VIOLATION").length;
  const complianceRate = totalChecks > 0 ? Math.round((compliantCount / totalChecks) * 100) : 0;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-10 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid="ppe-compliance-section">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              PPE Compliance
            </CardTitle>
            <CardDescription>Track PPE checks by date, worker, and equipment type</CardDescription>
          </div>
          {isManagement(userRole) && (
            <Button onClick={() => { setForm(emptyForm); setShowCreate(true); }} data-testid="button-add-ppe-check">
              <Plus className="h-4 w-4 mr-2" />
              Log PPE Check
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {[
              { label: "Total Checks", count: totalChecks, color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-900/20" },
              { label: "Compliant", count: compliantCount, color: "text-green-600", bg: "bg-green-50 dark:bg-green-900/20" },
              { label: "Violations", count: violationCount, color: "text-red-600", bg: "bg-red-50 dark:bg-red-900/20" },
              { label: "Compliance Rate", count: `${complianceRate}%`, color: complianceRate >= 90 ? "text-green-600" : complianceRate >= 70 ? "text-yellow-600" : "text-red-600", bg: "bg-gray-50 dark:bg-gray-900/20" },
            ].map((s) => (
              <Card key={s.label} className={`${s.bg} border-0`}>
                <CardContent className="pt-4 pb-3 text-center">
                  <div className={`text-2xl font-bold ${s.color}`}>{s.count}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="flex flex-wrap gap-3 mb-4">
            <Input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="w-44"
              placeholder="Filter by date"
              data-testid="input-ppe-date-filter"
            />
            <Select value={ppeFilter} onValueChange={setPpeFilter}>
              <SelectTrigger className="w-40" data-testid="select-ppe-type-filter">
                <SelectValue placeholder="PPE Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All PPE Types</SelectItem>
                {PPE_TYPE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40" data-testid="select-ppe-status-filter">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {dateFilter && (
              <Button variant="ghost" size="sm" onClick={() => setDateFilter("")} data-testid="button-clear-date-filter">
                Clear date
              </Button>
            )}
          </div>

          {filteredLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <HardHat className="h-14 w-14 text-muted-foreground/40 mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2">No PPE compliance checks</h3>
              <p className="text-muted-foreground text-sm max-w-xs mb-6">
                Log PPE checks to track worker compliance with safety equipment requirements.
              </p>
              {isManagement(userRole) && (
                <Button onClick={() => { setForm(emptyForm); setShowCreate(true); }} data-testid="button-add-first-ppe-check">
                  <Plus className="h-4 w-4 mr-2" />
                  Log First Check
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredLogs.map((log) => (
                <Card
                  key={log.id}
                  className={`${log.complianceStatus === "VIOLATION" ? "border-l-4 border-l-red-500" : "border-l-4 border-l-green-500"}`}
                  data-testid={`card-ppe-log-${log.id}`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="font-medium text-foreground">{log.workerName}</span>
                          <Badge variant="secondary" className="text-xs">
                            {PPE_TYPE_OPTIONS.find((t) => t.value === log.ppeType)?.label || log.ppeType}
                          </Badge>
                          {log.complianceStatus === "COMPLIANT" ? (
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1 bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                              <CheckCircle2 className="h-3 w-3" />
                              Compliant
                            </span>
                          ) : (
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1 bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                              <XCircle className="h-3 w-3" />
                              Violation
                            </span>
                          )}
                        </div>
                        <div className="flex gap-3 text-xs text-muted-foreground mt-1">
                          <span>{new Date(log.checkDate).toLocaleDateString()}</span>
                          {log.notes && <span className="truncate max-w-xs">{log.notes}</span>}
                        </div>
                      </div>
                      {isManagement(userRole) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={(e) => { e.stopPropagation(); if (confirm("Delete this PPE check?")) deleteMutation.mutate(log.id); }}
                          data-testid={`button-delete-ppe-${log.id}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {showCreate && (
        <Dialog open={true} onOpenChange={() => setShowCreate(false)}>
          <DialogContent className="sm:max-w-md" data-testid="dialog-ppe-compliance-form">
            <DialogHeader>
              <DialogTitle>Log PPE Compliance Check</DialogTitle>
              <DialogDescription>Record a PPE compliance check for a worker.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Check Date *</Label>
                  <Input
                    type="date"
                    value={form.checkDate}
                    onChange={(e) => setForm({ ...form, checkDate: e.target.value })}
                    data-testid="input-ppe-check-date"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Worker *</Label>
                  <Select
                    value={form.workerUserId || "__manual__"}
                    onValueChange={(v) => {
                      if (v === "__manual__") {
                        setForm({ ...form, workerUserId: "", workerName: "" });
                      } else {
                        const user = orgUsers.find((u) => u.id === v);
                        setForm({ ...form, workerUserId: v, workerName: user ? `${user.firstName} ${user.lastName}` : "" });
                      }
                    }}
                  >
                    <SelectTrigger data-testid="select-ppe-worker"><SelectValue placeholder="Select worker" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__manual__">Enter manually</SelectItem>
                      {orgUsers.map((u) => (
                        <SelectItem key={u.id} value={u.id}>{u.firstName} {u.lastName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {(!form.workerUserId) && (
                <div className="space-y-1.5">
                  <Label>Worker Name *</Label>
                  <Input
                    value={form.workerName}
                    onChange={(e) => setForm({ ...form, workerName: e.target.value })}
                    placeholder="Worker name"
                    data-testid="input-ppe-worker-name"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>PPE Type *</Label>
                  <Select value={form.ppeType} onValueChange={(v) => setForm({ ...form, ppeType: v })}>
                    <SelectTrigger data-testid="select-ppe-type"><SelectValue placeholder="Select PPE" /></SelectTrigger>
                    <SelectContent>
                      {PPE_TYPE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Status *</Label>
                  <Select value={form.complianceStatus} onValueChange={(v) => setForm({ ...form, complianceStatus: v })}>
                    <SelectTrigger data-testid="select-ppe-compliance-status"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Notes</Label>
                <Textarea
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Additional observations..."
                  data-testid="input-ppe-notes"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button
                onClick={() => createMutation.mutate(form)}
                disabled={!form.workerName || !form.ppeType || !form.checkDate || createMutation.isPending}
                data-testid="button-submit-ppe-check"
              >
                {createMutation.isPending ? "Saving..." : "Log Check"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
