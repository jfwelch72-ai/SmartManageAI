import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Plus, Shield, Loader2 } from "lucide-react";
import { format } from "date-fns";
import type { SovProject, SOV } from "./types";

export function SovLienWaiverPanel({ projects, sovs }: { projects: SovProject[]; sovs: SOV[] }) {
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    projectId: projects.length === 1 ? projects[0].id : "",
    sovId: "",
    waiverType: "CONDITIONAL_PARTIAL" as string,
    recipientName: "",
    recipientCompany: "",
    throughDate: "",
    amount: "",
    notes: "",
  });

  const { data: allWaivers = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/sov/lien-waivers"],
  });

  const projectIds = new Set(projects.map(p => p.id));
  const waivers = projects.length > 0
    ? allWaivers.filter((w: any) => projectIds.has(w.projectId))
    : allWaivers;

  const singleProject = projects.length === 1 ? projects[0] : null;

  const createMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const res = await apiRequest("POST", "/api/sov/lien-waivers", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sov/lien-waivers"] });
      toast({ title: "Lien waiver created" });
      setShowCreate(false);
      setForm({ projectId: singleProject?.id ?? "", sovId: "", waiverType: "CONDITIONAL_PARTIAL", recipientName: "", recipientCompany: "", throughDate: "", amount: "", notes: "" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await apiRequest("PATCH", `/api/sov/lien-waivers/${id}`, { status });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sov/lien-waivers"] });
      toast({ title: "Waiver updated" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const waiverTypeLabel = (t: string) => {
    const map: Record<string, string> = {
      CONDITIONAL_PARTIAL: "Conditional Partial",
      UNCONDITIONAL_PARTIAL: "Unconditional Partial",
      CONDITIONAL_FINAL: "Conditional Final",
      UNCONDITIONAL_FINAL: "Unconditional Final",
    };
    return map[t] || t;
  };

  const statusColor = (s: string) => {
    const map: Record<string, string> = {
      PENDING: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
      SENT: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
      RECEIVED: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
      APPROVED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
      REJECTED: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    };
    return map[s] || "bg-gray-100 text-gray-800";
  };

  const nextStatus = (current: string): string | null => {
    const flow: Record<string, string> = { PENDING: "SENT", SENT: "RECEIVED", RECEIVED: "APPROVED" };
    return flow[current] || null;
  };

  const projectSovs = sovs.filter(s => s.projectId === form.projectId);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Shield className="h-5 w-5" /> Lien Waivers
        </h2>
        <Button onClick={() => setShowCreate(true)} data-testid="button-create-lien-waiver" className="w-full sm:w-auto">
          <Plus className="h-4 w-4 mr-2" /> New Waiver
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-16" />)}</div>
      ) : waivers.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">No lien waivers yet</CardContent></Card>
      ) : (
        <>
          <div className="hidden md:block">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Project</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Recipient</TableHead>
                      <TableHead>Through Date</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {waivers.map((w: any) => (
                      <TableRow key={w.id} data-testid={`row-waiver-${w.id}`}>
                        <TableCell>
                          <span className="font-medium">{w.projectName}</span>
                          {w.projectCode && <span className="text-xs text-muted-foreground ml-1">({w.projectCode})</span>}
                        </TableCell>
                        <TableCell><Badge variant="outline">{waiverTypeLabel(w.waiverType)}</Badge></TableCell>
                        <TableCell>
                          <span>{w.recipientName}</span>
                          {w.recipientCompany && <span className="text-xs text-muted-foreground block">{w.recipientCompany}</span>}
                        </TableCell>
                        <TableCell>{w.throughDate ? format(new Date(w.throughDate), "MMM d, yyyy") : "—"}</TableCell>
                        <TableCell className="text-right font-medium">${parseFloat(w.amount || "0").toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                        <TableCell><Badge className={statusColor(w.status)}>{w.status}</Badge></TableCell>
                        <TableCell className="text-right">
                          {nextStatus(w.status) && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => updateStatusMutation.mutate({ id: w.id, status: nextStatus(w.status)! })}
                              disabled={updateStatusMutation.isPending}
                              data-testid={`button-advance-waiver-${w.id}`}
                            >
                              {nextStatus(w.status) === "SENT" ? "Mark Sent" : nextStatus(w.status) === "RECEIVED" ? "Mark Received" : "Approve"}
                            </Button>
                          )}
                          {w.status === "RECEIVED" && (
                            <Button
                              variant="destructive"
                              size="sm"
                              className="ml-1"
                              onClick={() => updateStatusMutation.mutate({ id: w.id, status: "REJECTED" })}
                              disabled={updateStatusMutation.isPending}
                              data-testid={`button-reject-waiver-${w.id}`}
                            >
                              Reject
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
          <div className="md:hidden space-y-3">
            {waivers.map((w: any) => (
              <div key={w.id} className="border rounded-lg p-3 space-y-2" data-testid={`card-waiver-${w.id}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{w.recipientName}</p>
                    {w.recipientCompany && <p className="text-xs text-muted-foreground">{w.recipientCompany}</p>}
                    <p className="text-xs text-muted-foreground truncate">{w.projectName}</p>
                  </div>
                  <Badge className={`${statusColor(w.status)} text-xs flex-shrink-0`}>{w.status}</Badge>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="text-xs">{waiverTypeLabel(w.waiverType)}</Badge>
                  <span className="text-xs text-muted-foreground">{w.throughDate ? format(new Date(w.throughDate), "MMM d, yyyy") : "—"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <p className="font-mono font-semibold text-sm">${parseFloat(w.amount || "0").toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                  <div className="flex gap-1.5">
                    {nextStatus(w.status) && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => updateStatusMutation.mutate({ id: w.id, status: nextStatus(w.status)! })}
                        disabled={updateStatusMutation.isPending}
                        data-testid={`button-advance-waiver-m-${w.id}`}
                      >
                        {nextStatus(w.status) === "SENT" ? "Send" : nextStatus(w.status) === "RECEIVED" ? "Received" : "Approve"}
                      </Button>
                    )}
                    {w.status === "RECEIVED" && (
                      <Button
                        variant="destructive"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => updateStatusMutation.mutate({ id: w.id, status: "REJECTED" })}
                        disabled={updateStatusMutation.isPending}
                        data-testid={`button-reject-waiver-m-${w.id}`}
                      >
                        Reject
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Lien Waiver</DialogTitle>
            <DialogDescription>Track a conditional or unconditional lien waiver</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className={singleProject ? "space-y-2" : "grid grid-cols-2 gap-4"}>
              {!singleProject && (
                <div className="space-y-2">
                  <Label>Project</Label>
                  <Select value={form.projectId} onValueChange={(v) => setForm(f => ({ ...f, projectId: v, sovId: "" }))}>
                    <SelectTrigger data-testid="select-waiver-project"><SelectValue placeholder="Select project..." /></SelectTrigger>
                    <SelectContent>
                      {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-2">
                <Label>Linked SOV (optional)</Label>
                <Select value={form.sovId} onValueChange={(v) => setForm(f => ({ ...f, sovId: v }))}>
                  <SelectTrigger data-testid="select-waiver-sov"><SelectValue placeholder="Select SOV..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {projectSovs.map(s => <SelectItem key={s.id} value={s.id}>{s.sovNumber} - {s.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Waiver Type</Label>
              <Select value={form.waiverType} onValueChange={(v) => setForm(f => ({ ...f, waiverType: v }))}>
                <SelectTrigger data-testid="select-waiver-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="CONDITIONAL_PARTIAL">Conditional Partial</SelectItem>
                  <SelectItem value="UNCONDITIONAL_PARTIAL">Unconditional Partial</SelectItem>
                  <SelectItem value="CONDITIONAL_FINAL">Conditional Final</SelectItem>
                  <SelectItem value="UNCONDITIONAL_FINAL">Unconditional Final</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Recipient Name</Label>
                <Input value={form.recipientName} onChange={(e) => setForm(f => ({ ...f, recipientName: e.target.value }))} data-testid="input-waiver-recipient" />
              </div>
              <div className="space-y-2">
                <Label>Company (optional)</Label>
                <Input value={form.recipientCompany} onChange={(e) => setForm(f => ({ ...f, recipientCompany: e.target.value }))} data-testid="input-waiver-company" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Through Date</Label>
                <Input type="date" value={form.throughDate} onChange={(e) => setForm(f => ({ ...f, throughDate: e.target.value }))} data-testid="input-waiver-date" />
              </div>
              <div className="space-y-2">
                <Label>Amount ($)</Label>
                <Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm(f => ({ ...f, amount: e.target.value }))} data-testid="input-waiver-amount" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} data-testid="input-waiver-notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} data-testid="button-cancel-waiver">Cancel</Button>
            <Button
              onClick={() => createMutation.mutate({ ...form, sovId: form.sovId === "none" ? "" : form.sovId })}
              disabled={!form.projectId || !form.recipientName || !form.throughDate || !form.amount || createMutation.isPending}
              data-testid="button-submit-waiver"
            >
              {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create Waiver
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
